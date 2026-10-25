/* WebRad browser boundary for the pinned ft8_lib sources (MIT). */
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <math.h>
#include "ft8/message.h"
#include "ft8/encode.h"
#include "common/monitor.h"
#include "emscripten/emscripten.h"
void synth_gfsk(const uint8_t*, int, float, float, float, int, float*);
static float *wave;
static int wave_count;
static char result[65536];
EMSCRIPTEN_KEEPALIVE int wr_encode(const char *text, int ft4, float frequency, float offset) {
    ftx_message_t msg;
    if (ftx_message_encode(&msg, NULL, text) != FTX_MESSAGE_RC_OK) return -1;
    int symbols = ft4 ? FT4_NN : FT8_NN;
    float period = ft4 ? FT4_SYMBOL_PERIOD : FT8_SYMBOL_PERIOD;
    int n = (int)(symbols * period * 12000 + 0.5f);
    wave_count = (int)((ft4 ? FT4_SLOT_TIME : FT8_SLOT_TIME) * 12000);
    int start = (int)(offset * 12000);
    if (start < 0 || start + n > wave_count) return -2;
    free(wave);
    wave = calloc(wave_count, sizeof(float));
    if (!wave) return -3;
    uint8_t tones[FT4_NN];
    if (ft4)
        ft4_encode(msg.payload, tones);
    else
        ft8_encode(msg.payload, tones);
    synth_gfsk(tones, symbols, frequency, ft4 ? 1.0f : 2.0f, period, 12000, wave + start);
    for (int i = 0; i < wave_count; i++) {
        wave[i] *= 0.7f;
    }
    return wave_count;
}
EMSCRIPTEN_KEEPALIVE float *wr_audio(void) { return wave; }
EMSCRIPTEN_KEEPALIVE const char *wr_decode(const float *samples, int count, int ft4, float low, float high,
                                           int candidates, int score, int iterations) {
    result[0] = 0;
    monitor_config_t cfg = {low, high, 12000, 2, 2, ft4 ? FTX_PROTOCOL_FT4 : FTX_PROTOCOL_FT8};
    monitor_t mon;
    monitor_init(&mon, &cfg);
    for (int i = 0; i + mon.block_size <= count && mon.wf.num_blocks < mon.wf.max_blocks; i += mon.block_size) {
        monitor_process(&mon, samples + i);
    }
    if (candidates < 1) candidates = 1;
    if (candidates > 500) candidates = 500;
    ftx_candidate_t *heap = calloc(candidates, sizeof(*heap));
    int found = ftx_find_candidates(&mon.wf, candidates, heap, score);
    char seen[100][FTX_MAX_MESSAGE_LENGTH];
    int nseen = 0;
    for (int i = 0; i < found; i++) {
        ftx_message_t msg;
        ftx_decode_status_t status;
        char text[FTX_MAX_MESSAGE_LENGTH];
        ftx_message_offsets_t offsets;
        if (!ftx_decode_candidate(&mon.wf, &heap[i], iterations, &msg, &status)) continue;
        if (ftx_message_decode(&msg, NULL, text, &offsets) != FTX_MESSAGE_RC_OK) continue;
        int duplicate = 0;
        for (int j = 0; j < nseen; j++) {
            if (!strcmp(text, seen[j])) duplicate = 1;
        }
        if (duplicate) continue;
        if (nseen < 100) strcpy(seen[nseen++], text);
        size_t pos = strlen(result);
        if (pos + strlen(text) + 80 >= sizeof(result)) break;
        snprintf(result + pos, sizeof(result) - pos, "%.2fs  %.1f Hz  %s\n", status.time, status.freq, text);
    }
    free(heap);
    monitor_free(&mon);
    return result;
}
