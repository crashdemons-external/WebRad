/* Sample/pulse boundary for rtl_433. GPL-2.0-or-later. */
#include "decoder.h"
#include "pulse_slicer.h"
#include "baseband.h"
#include "logger.h"
#include "sensor-catalog.h"
#include <emscripten/emscripten.h>
#include <stdarg.h>
#include <stdlib.h>
#include <math.h>

static r_device *devices[600];
static int selected = -1;
static pulse_detect_t *detector;
static pulse_data_t pulses, fsk;
static filter_state_t lowpass;
static demodfm_state_t fmstate;
static uint16_t magnitude[65536];
static int16_t am[65536], fm[65536];
static uint64_t offset;
static int rate = 250000, detector_mode = 2;
static float level = 0, minlevel = -12, snr = 9;
static char events[1048576];

void print_log(log_level_t level, char const *src, char const *message) {}
void print_logf(log_level_t level, char const *src, char const *format, ...) {}

int timeval_subtract(struct timeval *result, const struct timeval *x, const struct timeval *y) {
    long us = x->tv_usec - y->tv_usec;
    result->tv_sec = x->tv_sec - y->tv_sec;
    if (us < 0) {
        us += 1000000;
        result->tv_sec--;
    }
    result->tv_usec = us;
    return result->tv_sec < 0;
}

void pulse_data_clear(pulse_data_t *p) { memset(p, 0, sizeof(*p)); }

void pulse_data_shift(pulse_data_t *p) {
    unsigned n = p->num_pulses / 2;
    memmove(p->pulse, p->pulse + n, (p->num_pulses - n) * sizeof(int));
    memmove(p->gap, p->gap + n, (p->num_pulses - n) * sizeof(int));
    p->num_pulses -= n;
}

static void output(r_device *d, data_t *data) {
    char *json = data_print_jsons_dup(data);
    if (json) {
        size_t n = strlen(events), z = strlen(json);
        if (n + z + 2 < sizeof(events)) {
            memcpy(events + n, json, z);
            events[n + z] = '\n';
            events[n + z + 1] = 0;
        }
        free(json);
    }
    data_free(data);
}

static void logdata(r_device *d, int level, data_t *data) { data_free(data); }

EMSCRIPTEN_KEEPALIVE int wr_count() { return sizeof(sensor_catalog) / sizeof(sensor_catalog[0]); }
EMSCRIPTEN_KEEPALIVE const char *wr_name(int i) { return sensor_catalog[i]->name; }
EMSCRIPTEN_KEEPALIVE int wr_protocol(int i) { return sensor_ids[i]; }
EMSCRIPTEN_KEEPALIVE int wr_disabled(int i) { return sensor_catalog[i]->disabled; }

EMSCRIPTEN_KEEPALIVE void wr_option(int key, float value) {
    if (key == 0) level = value;
    if (key == 1) minlevel = value;
    if (key == 2) snr = value;
}

EMSCRIPTEN_KEEPALIVE int wr_init(int device, int sample_rate, int fm_detector) {
    if (sample_rate < 8000 || sample_rate > 4000000) return -1;
    selected = device;
    rate = sample_rate;
    detector_mode = fm_detector;
    events[0] = 0;
    offset = 0;
    if (detector) pulse_detect_free(detector);
    detector = pulse_detect_create();
    pulse_detect_set_levels(detector, 1, level, minlevel, snr, 0);
    baseband_init();
    baseband_low_pass_filter_reset(&lowpass);
    baseband_demod_FM_reset(&fmstate);
    for (int i = 0; i < wr_count(); i++) {
        if (devices[i]) free(devices[i]);
        const r_device *d = sensor_catalog[i];
        devices[i] = d->create_fn ? d->create_fn(NULL) : decoder_create(d, 0);
        if (devices[i]) {
            devices[i]->protocol_num = sensor_ids[i];
            devices[i]->output_fn = output;
            devices[i]->log_fn = logdata;
        }
    }
    return wr_count();
}

static void slice(pulse_data_t *p, int isfsk, int include_disabled) {
    size_t start = strlen(events);
    for (int priority = 0; priority <= 10; priority++) {
        if (priority > 0 && strlen(events) > start && selected < 0) break;
        for (int i = 0; i < wr_count(); i++) {
            r_device *d = devices[i];
            if (!d || d->priority != priority || (selected >= 0 && selected != i) ||
                (selected < 0 && d->disabled && !include_disabled))
                continue;
            if ((d->modulation >= FSK_DEMOD_MIN_VAL) != isfsk) continue;
            switch (d->modulation) {
                case OOK_PULSE_PCM:
                case FSK_PULSE_PCM:
                    pulse_slicer_pcm(p, d);
                    break;
                case OOK_PULSE_PPM:
                    pulse_slicer_ppm(p, d);
                    break;
                case OOK_PULSE_PWM:
                case FSK_PULSE_PWM:
                    pulse_slicer_pwm(p, d);
                    break;
                case OOK_PULSE_MANCHESTER_ZEROBIT:
                case FSK_PULSE_MANCHESTER_ZEROBIT:
                    pulse_slicer_manchester_zerobit(p, d);
                    break;
                case OOK_PULSE_DMC:
                    pulse_slicer_dmc(p, d);
                    break;
                case OOK_PULSE_PIWM_RAW:
                    pulse_slicer_piwm_raw(p, d);
                    break;
                case OOK_PULSE_PIWM_DC:
                    pulse_slicer_piwm_dc(p, d);
                    break;
                case OOK_PULSE_PWM_OSV1:
                    pulse_slicer_osv1(p, d);
                    break;
                case OOK_PULSE_NRZS:
                    pulse_slicer_nrzs(p, d);
                    break;
                case OOK_PULSE_RZI:
                    pulse_slicer_rzi(p, d);
                    break;
            }
        }
    }
}

EMSCRIPTEN_KEEPALIVE const char *wr_decode(const int *pairs, int n, int isfsk, int include_disabled) {
    events[0] = 0;
    if (n < 1 || n > PD_MAX_PULSES) return events;
    pulse_data_clear(&pulses);
    pulses.sample_rate = rate;
    pulses.num_pulses = n;
    for (int i = 0; i < n; i++) {
        pulses.pulse[i] = pairs[2 * i];
        pulses.gap[i] = pairs[2 * i + 1];
    }
    slice(&pulses, isfsk, include_disabled);
    return events;
}

EMSCRIPTEN_KEEPALIVE const char *wr_events() { return events; }

EMSCRIPTEN_KEEPALIVE const char *wr_iq(const void *samples, int n, int type, int include_disabled) {
    events[0] = 0;
    if (n < 1 || n > 65536) return events;
    if (type == 0) {
        magnitude_est_cu8(samples, magnitude, n);
        baseband_demod_FM(&fmstate, samples, fm, n, rate, 0.1f);
        baseband_low_pass_filter(&lowpass, magnitude, am, n);
    } else if (type == 1) {
        magnitude_est_cs16(samples, magnitude, n);
        baseband_demod_FM_cs16(&fmstate, samples, fm, n, rate, 0.1f);
        baseband_low_pass_filter(&lowpass, magnitude, am, n);
    } else {
        const int16_t *v = samples;
        for (int i = 0; i < n; i++) {
            am[i] = v[2 * i];
            fm[i] = v[2 * i + 1];
        }
    }
    int kind;
    while ((kind = pulse_detect_package(detector, am, fm, n, rate, offset, &pulses, &fsk, detector_mode)))
        slice(kind == PULSE_DATA_FSK ? &fsk : &pulses, kind == PULSE_DATA_FSK, include_disabled);
    offset += n;
    return events;
}
