/* PCM/file boundary for Dire Wolf. No device, networking or radio control. */
#include "direwolf.h"
#include "audio.h"
#include "multi_modem.h"
#include "gen_tone.h"
#include "hdlc_send.h"
#include "dlq.h"
#include "fx25.h"
#include "il2p.h"
#include "decode_aprs.h"
#include "encode_aprs.h"
#include <emscripten/emscripten.h>
#include <string.h>
#include <stdlib.h>
#include <stdio.h>
#include <math.h>

static struct audio_s config;
static int interpretAprs;
static char aprsPayload[512];
static char result[262144];
static unsigned char *pcm;
static int pcm_size, pcm_capacity;

int audio_get(int device) { return -1; }
int audio_put(int device, int byte) {
    if (pcm_size >= 48000 * 2 * 1800) return -1;
    if (pcm_size == pcm_capacity) {
        pcm_capacity = pcm_capacity ? pcm_capacity * 2 : 65536;
        unsigned char *p = realloc(pcm, pcm_capacity);
        if (!p) return -1;
        pcm = p;
    }
    pcm[pcm_size++] = byte;
    return 0;
}
int audio_flush(int device) { return 0; }
void audio_wait(int device) {}
void ptt_set(int type, int channel, int on) {}
int get_input(int type, int channel) { return 0; }
void dlq_channel_busy(int channel, int type, int status) {}

void dlq_rec_frame(int channel, int sub, int slice, packet_t packet, alevel_t level, fec_type_t fec, retry_t retries,
                   char *spectrum) {
    char addresses[256];
    unsigned char *info;
    int len = ax25_get_info(packet, &info);
    ax25_format_addrs(packet, addresses);
    size_t at = strlen(result);
    if (at + strlen(addresses) + len + 48 < sizeof(result)) {
        snprintf(result + at, sizeof(result) - at, "%s", addresses);
        at = strlen(result);
        for (int i = 0; i < len; i++) {
            result[at++] = (info[i] >= 32 && info[i] < 127) || info[i] == '\n' ? info[i] : '.';
        }
        result[at++] = '\n';
        result[at] = 0;
    }
    if (interpretAprs && len > 0 && len <= 2048 && info[0] != '$') {
        decode_aprs_t decoded;
        decode_aprs(&decoded, packet, 1, NULL);
        at = strlen(result);
        if (sizeof(result) - at > 4096) {
            at += snprintf(result + at, sizeof(result) - at, "APRS: %s\n", decoded.g_data_type_desc);
            if (decoded.g_lat != G_UNKNOWN && decoded.g_lon != G_UNKNOWN && isfinite(decoded.g_lat) && isfinite(decoded.g_lon))
                at += snprintf(result + at, sizeof(result) - at, "Location: %.6f, %.6f\n", decoded.g_lat, decoded.g_lon);
            if (decoded.g_altitude_ft != G_UNKNOWN) at += snprintf(result + at, sizeof(result) - at, "Altitude: %.1f m\n", decoded.g_altitude_ft * 0.3048);
            if (decoded.g_speed_mph != G_UNKNOWN) at += snprintf(result + at, sizeof(result) - at, "Speed: %.1f km/h\n", decoded.g_speed_mph * 1.609344);
            if (decoded.g_course != G_UNKNOWN) at += snprintf(result + at, sizeof(result) - at, "Heading: %.0f degrees\n", decoded.g_course);
            if (decoded.g_name[0]) at += snprintf(result + at, sizeof(result) - at, "Object: %s\n", decoded.g_name);
            if (decoded.g_addressee[0]) at += snprintf(result + at, sizeof(result) - at, "To: %s\n", decoded.g_addressee);
            if (decoded.g_mic_e_status[0]) at += snprintf(result + at, sizeof(result) - at, "Mic-E status: %s\n", decoded.g_mic_e_status);
            if (decoded.g_weather[0]) at += snprintf(result + at, sizeof(result) - at, "Weather: %s\n", decoded.g_weather);
            if (decoded.g_telemetry[0]) at += snprintf(result + at, sizeof(result) - at, "Telemetry: %s\n", decoded.g_telemetry);
            if (decoded.g_comment[0]) snprintf(result + at, sizeof(result) - at, "Message: %s\n", decoded.g_comment);
        }
    }
    ax25_delete(packet);
}

EMSCRIPTEN_KEEPALIVE int wr_init(int mode, int mark, int space, int baud, const char *profiles, int correction,
                                 int passall, int v26) {
    interpretAprs = 0;
    memset(&config, 0, sizeof(config));
    config.adev[0].defined = 1;
    config.adev[0].copy_from = -1;
    config.adev[0].num_channels = 1;
    config.adev[0].samples_per_sec = 48000;
    config.adev[0].bits_per_sample = 16;
    config.chan_medium[0] = MEDIUM_RADIO;
    config.achan[0].modem_type = mode;
    config.achan[0].mark_freq = mark;
    config.achan[0].space_freq = space;
    config.achan[0].baud = baud;
    config.achan[0].num_freq = 1;
    config.achan[0].num_slicers = 1;
    config.achan[0].decimate = 1;
    config.achan[0].upsample = 1;
    config.achan[0].v26_alternative = v26;
    config.achan[0].fix_bits = correction;
    config.achan[0].sanity_test = SANITY_AX25;
    config.achan[0].passall = passall;
    snprintf(config.achan[0].profiles, sizeof(config.achan[0].profiles), "%s", profiles);
    result[0] = 0;
    fx25_init(0);
    il2p_init(0);
    multi_modem_init(&config);
    return 48000;
}

EMSCRIPTEN_KEEPALIVE void wr_option(int key, int value) {
    switch (key) {
        case 4:
            interpretAprs = value != 0;
            break;
        case 0:
            config.achan[0].layer2_xmit = value;
            break;
        case 1:
            config.achan[0].fx25_strength = value;
            break;
        case 2:
            config.achan[0].il2p_max_fec = value;
            break;
        case 3:
            config.achan[0].il2p_invert_polarity = value;
            break;
    }
}

EMSCRIPTEN_KEEPALIVE const char *wr_process(const float *samples, int n) {
    result[0] = 0;
    for (int i = 0; i < n; i++) {
        float v = samples[i] * 32767;
        multi_modem_process_sample(0, v > 32767 ? 32767 : v < -32768 ? -32768 : (int)v);
    }
    return result;
}

EMSCRIPTEN_KEEPALIVE int wr_encode(const char *text, int delay, int tail) {
    if (strlen(text) > 2048) return -1;
    packet_t p = ax25_from_text((char*)text, 1);
    if (!p) return -1;
    pcm_size = 0;
    gen_tone_init(&config, 70, 0);
    gen_tone_put_quiet_ms(0, 100);
    layer2_preamble_postamble(0, (delay * config.achan[0].baud) / 8000, 0, &config);
    layer2_send_frame(0, p, 0, &config);
    layer2_preamble_postamble(0, (tail * config.achan[0].baud) / 8000, 1, &config);
    gen_tone_put_quiet_ms(0, 100);
    ax25_delete(p);
    return pcm_size / 2;
}

EMSCRIPTEN_KEEPALIVE unsigned char *wr_audio() { return pcm; }
EMSCRIPTEN_KEEPALIVE int wr_audio_size() { return pcm_size; }

/* Construct an ordinary APRS position; the existing AX.25 encoder adds framing and CRC. */
EMSCRIPTEN_KEEPALIVE const char *wr_aprs_position(double latitude, double longitude, int altitude, int compressed, const char *comment) {
    if (!isfinite(latitude) || !isfinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 || strlen(comment) > 200) return NULL;
    encode_position(0, compressed != 0, latitude, longitude, 0, altitude, '/', '-', 0, 0, 0, "", G_UNKNOWN, G_UNKNOWN, 0, 0, 0, (char *)comment, aprsPayload, sizeof(aprsPayload));
    return aprsPayload;
}
