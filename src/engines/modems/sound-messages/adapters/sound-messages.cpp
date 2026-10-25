/* WebRad C boundary; original ggwave implementation remains unchanged. */
#include "ggwave/ggwave.h"
#include <emscripten/emscripten.h>
#include <vector>
#include <string>

static ggwave_Instance instance = -1;
static std::vector<float> wave;
static float frame[2048];
static int used = 0, frameSize = 1024, silent = 0;
static std::string messages, last;

extern "C" {
EMSCRIPTEN_KEEPALIVE int wr_init(int payload, int dss, float threshold, int frames, int protocol, int freqStart) {
    if (frames < 256 || frames > 2048 || (frames & (frames - 1)) || protocol < 0 || protocol >= 12) return -1;
    if (instance >= 0) ggwave_free(instance);
    instance = -1;
    ggwave_setLogFile(nullptr);
    auto p = ggwave_getDefaultParameters();
    p.sampleRateInp = p.sampleRateOut = p.sampleRate = 48000;
    p.sampleFormatInp = p.sampleFormatOut = GGWAVE_SAMPLE_FORMAT_F32;
    p.payloadLength = payload;
    p.soundMarkerThreshold = threshold;
    p.samplesPerFrame = frames;
    p.operatingMode = GGWAVE_OPERATING_MODE_RX_AND_TX | (dss ? GGWAVE_OPERATING_MODE_USE_DSS : 0);
    for (int i = 0; i < 12; i++) {
        ggwave_rxToggleProtocol((ggwave_ProtocolId)i, protocol == i);
        int start = GGWave::Protocols::kDefault()[i].freqStart;
        ggwave_rxProtocolSetFreqStart((ggwave_ProtocolId)i, start);
        ggwave_txProtocolSetFreqStart((ggwave_ProtocolId)i, start);
    }
    if (protocol >= 0 && freqStart >= 0) {
        ggwave_rxProtocolSetFreqStart((ggwave_ProtocolId)protocol, freqStart);
        ggwave_txProtocolSetFreqStart((ggwave_ProtocolId)protocol, freqStart);
    }
    frameSize = frames;
    used = silent = 0;
    last.clear();
    messages.clear();
    instance = ggwave_init(p);
    return instance;
}

EMSCRIPTEN_KEEPALIVE int wr_encode(const char* text, int n, int protocol, int volume) {
    if (n < 1 || n > 140) return -1;
    int size = ggwave_encode(instance, text, n, (ggwave_ProtocolId)protocol, volume, nullptr, 1);
    if (size <= 0) return -1;
    wave.resize((size + 3) / 4);
    int bytes = ggwave_encode(instance, text, n, (ggwave_ProtocolId)protocol, volume, wave.data(), 0);
    return bytes > 0 ? bytes / 4 : -1;
}

EMSCRIPTEN_KEEPALIVE float* wr_audio() { return wave.data(); }

EMSCRIPTEN_KEEPALIVE const char* wr_process(const float* samples, int n) {
    messages.clear();
    for (int i = 0; i < n; i++) {
        frame[used++] = samples[i];
        if (used < frameSize) continue;
        used = 0;
        float energy = 0;
        for (int j = 0; j < frameSize; j++) {
            energy += frame[j] * frame[j];
        }
        if (energy / frameSize < 0.000001f) {
            if (++silent >= 5) last.clear();
        } else {
            silent = 0;
        }
        char message[257];
        int count = ggwave_decode(instance, frame, frameSize * 4, message);
        if (count > 0) {
            std::string text(message, count);
            if (text != last) {
                messages += text + '\n';
                last = text;
            }
        }
    }
    return messages.c_str();
}
}
