#include "buffers.h"
#include <cstdio>
#include <cctype>
extern "C" {
#include "wsprd.h"
#include "wsprsim_utils.h"
}
extern "C" int wr_run(int encode, const void *input, int length, int, int) {
    clearResult();
    double center = std::clamp(options[0], 300.0, 3000.0);
    if (encode) {
        if (length < 10 || length > 16) return fail("Enter a standard callsign, four-character locator and power, for example K1ABC FN42 30.");
        std::string message(static_cast<const char *>(input), length);
        char call[16] = {}, grid[16] = {}, trailing = 0;
        int power = -1;
        if (sscanf(message.c_str(), "%15s %15s %d %c", call, grid, &power, &trailing) != 3) return fail("Use CALLSIGN GRID POWER, for example K1ABC FN42 30.");
        int callLength = strlen(call), digit = callLength > 2 && isdigit(call[2]) ? 2 : 1;
        bool valid = callLength >= 4 && callLength <= (digit == 2 ? 6 : 5) && isdigit(call[digit]);
        for (int i = 0; i < callLength; i++) valid &= i < digit ? (isupper(call[i]) || isdigit(call[i])) : (i == digit || isupper(call[i]));
        if (!valid) return fail("Use a standard four- to six-character callsign with a district digit. Compound and hashed callsigns are not supported for sending.");
        if (strlen(grid) != 4 || grid[0] < 'A' || grid[0] > 'R' || grid[1] < 'A' || grid[1] > 'R' || !isdigit(grid[2]) || !isdigit(grid[3])) return fail("Use a four-character location such as FN42 (AA00–RR99).");
        if (power < 0 || power > 60 || (power % 10 != 0 && power % 10 != 3 && power % 10 != 7)) return fail("Power must be 0–60 dBm, ending in 0, 3 or 7.");
        std::vector<char> hashtable(HASHTAB_SIZE * HASHTAB_ENTRY_LEN), locations(HASHTAB_SIZE * LOCTAB_ENTRY_LEN);
        uint8_t symbols[162];
        if (!get_wspr_channel_symbols(message.data(), hashtable.data(), locations.data(), symbols)) return fail("Could not encode this beacon.");
        audio.assign(12000 * 120, 0);
        double phase = 0, spacing = 375.0 / 256;
        for (int symbol = 0; symbol < 162; symbol++) {
            double increment = tau * (center + (symbols[symbol] - 1.5) * spacing) / 12000;
            for (int i = 0; i < 8192; i++) {
                audio[24000 + symbol * 8192 + i] = 0.7 * sin(phase);
                phase = fmod(phase + increment, tau);
            }
        }
        return audio.size();
    }
    if (length < 12000 * 110 || length > 12000 * 120) return fail("Select one aligned two-minute WSPR slot (110–120 seconds). Trim other audio first.");
    auto samples = static_cast<const float *>(input);
    std::vector<float> inPhase(45000), quadrature(45000);
    // Mix the audio carrier to baseband and low-pass before decimating to 375 Hz.
    std::vector<float> real(length), imaginary(length);
    for (int i = 0; i < length; i++) {
        double phase = tau * center * i / 12000;
        real[i] = samples[i] * cos(phase);
        imaginary[i] = -samples[i] * sin(phase);
    }
    float taps[257];
    double sum = 0;
    for (int i = -128; i <= 128; i++) {
        double z = tau * 140 * i / 12000;
        taps[i + 128] = (i == 0 ? 1 : sin(z) / z) * (0.54 + 0.46 * cos(tau * i / 256));
        sum += taps[i + 128];
    }
    for (int j = 0; j < 45000; j++) for (int k = -128; k <= 128; k++) {
        int at = j * 32 + k;
        if (at >= 0 && at < length) {
            float weight = taps[k + 128] / sum;
            inPhase[j] += real[at] * weight;
            quadrature[j] += imaginary[at] * weight;
        }
    }
    decoder_options config{};
    config.npasses = integerOption(1, 1, 3);
    config.quickmode = options[2] != 0;
    config.subtraction = 0;
    decoder_results results[MAX_UNIQUES] = {};
    int count = 0;
    wspr_decode(inPhase.data(), quadrature.data(), 45000, config, results, &count);
    for (int i = 0; i < std::min(count, MAX_UNIQUES); i++) {
        char line[256];
        snprintf(line, sizeof(line), "%s · signal/noise %.0f dB · offset %.1f Hz · time %+.2f s\n", results[i].message, results[i].snr, results[i].freq * 1e6 - 1500, results[i].dt);
        text += line;
    }
    return count;
}
