#include "buffers.h"
#include <cstdio>
extern "C" {
#include "mdc_encode.h"
#include "mdc_decode.h"
#include "fsync_decode.h"
void wr_fleet_finish(fsync_decoder_t *decoder);
}
static void receiveMdc(int count, unsigned char op, unsigned char arg, unsigned short unit, unsigned char a, unsigned char b, unsigned char c, unsigned char d, void *) {
    char line[256];
    snprintf(line, sizeof(line), "MDC-1200: radio %04X, operation %02X, argument %02X", unit, op, arg);
    text += line;
    if (count == 2) {
        snprintf(line, sizeof(line), ", extra bytes %02X%02X%02X%02X", a, b, c, d);
        text += line;
    }
    text += '\n';
}
static void receiveFleet(int command, int subcommand, int fromFleet, int fromUnit, int toFleet, int toUnit, int all, unsigned char *payload, int length, unsigned char *, int, void *, int second, int fast) {
    if (text.size() > 262144) return;
    char line[256];
    snprintf(line, sizeof(line), "FleetSync%s %d: from %d/%d to %s%d/%d, command %02X/%02X", second ? " II" : "", fast ? 2400 : 1200, fromFleet, fromUnit, all ? "all " : "", toFleet, toUnit, command, subcommand);
    text += line;
    if (length > 0 && length <= 1536) {
        text += ", data: ";
        for (int i = 0; i < length; i++) {
            snprintf(line, sizeof(line), "%02X", payload[i]);
            text += line;
        }
    }
    text += '\n';
}
extern "C" int wr_run(int encode, const void *input, int length, int, int) {
    clearResult();
    if (length < 0 || length > 48000 * 180) return fail("Use at most three minutes of radio audio.");
    if (encode) {
        if (length != 4) return fail("Enter a radio ID as four hexadecimal digits, for example 12AB.");
        std::string id(static_cast<const char *>(input), length);
        if (id.find_first_not_of("0123456789abcdefABCDEF") != std::string::npos) return fail("Use four hexadecimal digits (0–9 and A–F).");
        auto *encoder = mdc_encoder_new(48000);
        if (!encoder) return fail("Could not create the radio ID encoder.");
        mdc_encoder_set_preamble(encoder, integerOption(2, 0, 100));
        int unit = strtoul(id.c_str(), nullptr, 16);
        int op = integerOption(0, 0, 255), arg = integerOption(1, 0, 255);
        int status;
        if (options[3] != 0) {
            uint32_t extra = static_cast<uint32_t>(std::clamp(options[4], 0.0, 4294967295.0));
            status = mdc_encoder_set_double_packet(encoder, op, arg, unit, extra >> 24, extra >> 16, extra >> 8, extra);
        } else status = mdc_encoder_set_packet(encoder, op, arg, unit);
        if (status < 0) { free(encoder); return fail("This operation requires a different packet length."); }
        short block[4096];
        int count;
        while ((count = mdc_encoder_get_samples(encoder, block, 4096)) > 0 && audio.size() < 48000 * 5) {
            for (int i = 0; i < count; i++) audio.push_back(block[i] / 32768.0f);
        }
        free(encoder);
        audio.resize(audio.size() + 4800, 0);
        return audio.size();
    }
    int mode = integerOption(5, 0, 1);
    auto samples = static_cast<const float *>(input);
    if (mode == 0) {
        auto *decoder = mdc_decoder_new(48000);
        if (!decoder) return fail("Could not create the radio ID decoder.");
        mdc_decoder_set_callback(decoder, receiveMdc, nullptr);
        short block[4096];
        for (int at = 0; at < length; at += 4096) {
            int count = std::min(4096, length - at);
            for (int i = 0; i < count; i++) block[i] = std::clamp(samples[at + i], -1.0f, 1.0f) * 32767;
            mdc_decoder_process_samples(decoder, block, count);
        }
        free(decoder);
    } else {
        auto *decoder = fsync_decoder_new(48000);
        if (!decoder) return fail("Could not create the FleetSync decoder.");
        fsync_decoder_set_callback(decoder, receiveFleet, nullptr);
        unsigned char block[4096];
        for (int at = 0; at < length; at += 4096) {
            int count = std::min(4096, length - at);
            for (int i = 0; i < count; i++) block[i] = (std::clamp(samples[at + i], -1.0f, 1.0f) + 1) * 127.5f;
            fsync_decoder_process_samples(decoder, block, count);
        }
        wr_fleet_finish(decoder);
        free(decoder);
    }
    return text.size();
}
