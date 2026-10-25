/* Browser boundary for the vendored multimon-ng DSP. GPL-3.0-or-later. */
#include "multimon.h"
#undef COS
#include "gen.h"
#include <emscripten/emscripten.h>
#include <stdarg.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

int json_mode = 0;
static const struct demod_param *modes[] = {ALL_DEMOD};
static struct demod_state state;
static int initialized = 0, used = 0;
static float pending[131072];
static short shorts[131072];
static char output[262144];
static struct gen_params gp;
static struct gen_state gs;
extern int pocsag_mode, pocsag_invert_input, pocsag_error_correction, pocsag_show_partial_decodes;
extern int pocsag_heuristic_pruning, pocsag_prune_empty, pocsag_polarity;
extern int cw_dit_length, cw_gap_length, cw_threshold;
extern bool cw_disable_auto_threshold, cw_disable_auto_timing;

void _verbprintf(int level, const char *fmt, ...) {
    if (level > 0) return;
    size_t n = strlen(output);
    va_list args;
    va_start(args, fmt);
    vsnprintf(output + n, sizeof(output) - n, fmt, args);
    va_end(args);
}

void addJsonTimestamp(cJSON *json) { (void)json; }

void printJson(cJSON *json) {
    char *text = cJSON_PrintUnformatted(json);
    _verbprintf(0, "%s\n", text);
    free(text);
    cJSON_Delete(json);
}

void print_json(int argc, char **argv) {
    for (int i = 0; i < argc; i++) {
        _verbprintf(0, "%s ", argv[i]);
    }
}

EMSCRIPTEN_KEEPALIVE int wr_count() { return sizeof(modes) / sizeof(modes[0]); }
EMSCRIPTEN_KEEPALIVE const char* wr_name(int mode) { return modes[mode]->name; }
EMSCRIPTEN_KEEPALIVE int wr_rate(int mode) { return modes[mode]->samplerate; }

EMSCRIPTEN_KEEPALIVE void wr_option(int id, int value) {
    switch (id) {
        case 0:
            pocsag_mode = value;
            break;
        case 1:
            pocsag_invert_input = value;
            break;
        case 2:
            pocsag_error_correction = value;
            break;
        case 3:
            pocsag_show_partial_decodes = value;
            break;
        case 4:
            pocsag_heuristic_pruning = value;
            break;
        case 5:
            pocsag_prune_empty = value;
            break;
        case 6:
            pocsag_polarity = value;
            break;
        case 7:
            cw_dit_length = value;
            break;
        case 8:
            cw_gap_length = value;
            break;
        case 9:
            cw_threshold = value;
            break;
        case 10:
            cw_disable_auto_threshold = value;
            break;
        case 11:
            cw_disable_auto_timing = value;
            break;
    }
}

EMSCRIPTEN_KEEPALIVE int wr_init(int mode) {
    if (mode < 0 || mode >= wr_count()) return -1;
    if (initialized && state.dem_par->deinit) state.dem_par->deinit(&state);
    memset(&state, 0, sizeof(state));
    state.dem_par = modes[mode];
    if (state.dem_par->init) state.dem_par->init(&state);
    initialized = 1;
    used = 0;
    output[0] = 0;
    return wr_rate(mode);
}

EMSCRIPTEN_KEEPALIVE const char* wr_process(const float *samples, int n) {
    output[0] = 0;
    if (!initialized || n < 0 || used + n > 131072) return output;
    memcpy(pending + used, samples, n * 4);
    used += n;
    int count = used - (int)state.dem_par->overlap;
    if (count > 0) {
        for (int i = 0; i < used; i++) {
            float v = pending[i] * 32767;
            shorts[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : (short)v;
        }
        buffer_t buffer = {shorts, pending};
        state.dem_par->demod(&state, buffer, count);
        memmove(pending, pending + count, (used - count) * 4);
        used -= count;
    }
    return output;
}

EMSCRIPTEN_KEEPALIVE int wr_tx_start(int type, const char *text, int address, int function, int baud, int invert,
                                     int duration, int gap) {
    if (strlen(text) > 255) return -1;
    memset(&gp, 0, sizeof(gp));
    memset(&gs, 0, sizeof(gs));
    gp.ampl = 16000;
    gp.type = type;
    if (type == gentype_pocsag) {
        gp.p.pocsag.address = address;
        gp.p.pocsag.function = function;
        gp.p.pocsag.baud = baud;
        gp.p.pocsag.invert = invert;
        strcpy(gp.p.pocsag.message, text);
        gen_init_pocsag(&gp, &gs);
    } else if (type == gentype_flex) {
        gp.p.flex.capcode = address;
        strcpy(gp.p.flex.message, text);
        gen_init_flex(&gp, &gs);
    } else if (type == gentype_dtmf) {
        gp.p.dtmf.duration = duration;
        gp.p.dtmf.pause = gap;
        strcpy(gp.p.dtmf.str, text);
        gen_init_dtmf(&gp, &gs);
    } else if (type == gentype_zvei) {
        gp.p.zvei.duration = duration;
        gp.p.zvei.pause = gap;
        strcpy(gp.p.zvei.str, text);
        gen_init_zvei(&gp, &gs);
    } else {
        return -1;
    }
    return 22050;
}

EMSCRIPTEN_KEEPALIVE int wr_tx_read(short *buf, int n) {
    if (n < 1 || n > 65536) return 0;
    memset(buf, 0, n * sizeof(short));
    switch (gp.type) {
        case gentype_pocsag: return gen_pocsag(buf, n, &gp, &gs);
        case gentype_flex: return gen_flex(buf, n, &gp, &gs);
        case gentype_dtmf: return gen_dtmf(buf, n, &gp, &gs);
        case gentype_zvei: return gen_zvei(buf, n, &gp, &gs);
        default: return 0;
    }
}
