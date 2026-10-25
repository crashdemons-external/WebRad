#include "buffers.h"
extern "C" {
#include "fsk.h"
}
// Raw asynchronous serial frames, least significant bit first; no packet envelope.
extern "C" int wr_run(int encode, const void *input, int length, int, int) {
    clearResult();
    if (length < 0 || length > (encode ? 16384 : 12000 * 180)) return fail("Use at most 16 KiB or three minutes of audio.");
    double baud = std::clamp(options[0], 45.0, 2400.0);
    double mark = std::clamp(options[1], 100.0, 5000.0);
    double space = std::clamp(options[2], 100.0, 5000.0);
    int bits = integerOption(3, 5, 8), parity = integerOption(4, 0, 2), stop = integerOption(5, 1, 2);
    if (fabs(mark - space) < baud * 0.5) return fail("Choose tones separated by at least half the bit rate.");
    double bitSamples = 12000.0 / baud;
    if (encode) {
        auto data = static_cast<const uint8_t *>(input);
        double total = 3600.0 + length * (1 + bits + (parity != 0) + stop) * bitSamples;
        if (total > 12000 * 180) return fail("The message exceeds three minutes at this speed.");
        audio.reserve(static_cast<int>(total) + 16);
        double phase = 0, boundary = 0;
        auto emit = [&](int bit, double duration) {
            boundary += duration;
            while (audio.size() < static_cast<size_t>(std::llround(boundary))) {
                audio.push_back(0.75f * sin(phase));
                phase = fmod(phase + tau * (bit ? mark : space) / 12000, tau);
            }
        };
        emit(1, 2400);
        for (int i = 0; i < length; i++) {
            if (data[i] >= (1 << bits)) return fail("This character needs more data bits. Choose eight data bits for arbitrary files.");
            emit(0, bitSamples);
            int ones = 0;
            for (int b = 0; b < bits; b++) { int bit = (data[i] >> b) & 1; ones += bit; emit(bit, bitSamples); }
            if (parity) emit((ones & 1) ^ (parity == 2), bitSamples);
            emit(1, stop * bitSamples);
        }
        emit(1, 1200);
        return audio.size();
    }
    auto samples = static_cast<const float *>(input);
    std::string pattern = "10" + std::string(bits + (parity != 0), 'd') + "1";
    int frame = std::lround(pattern.size() * bitSamples);
    auto *plan = fsk_plan_new(12000, mark, space, std::min(10.0, baud * 0.45));
    if (!plan) return fail("Could not create the tone detector.");
    bool locked = false;
    int cursor = 0, search = std::ceil(bitSamples * 2), step = std::max(1, static_cast<int>(bitSamples / 8));
    while (cursor + frame + search < length && bytes.size() < 65536) {
        search = std::max(2, static_cast<int>(bitSamples * (locked ? 0.5 : 2.0)));
        unsigned long long decoded = 0;
        unsigned start = 0;
        float amplitude = 0;
        float confidence = fsk_find_frame(plan, const_cast<float *>(samples + cursor), frame, search / 2, search, step, 1e30f, pattern.c_str(), &decoded, &amplitude, &start);
        if (confidence >= std::clamp(options[6], 1.0, 10.0) && amplitude > 0.002f) {
            uint8_t value = (decoded >> 2) & ((1 << bits) - 1);
            int ones = __builtin_popcount(static_cast<unsigned>(value));
            bool valid = !parity || (((decoded >> (bits + 2)) & 1) == ((ones & 1) ^ (parity == 2)));
            if (valid) bytes.push_back(value);
            cursor += start + std::lround((pattern.size() - 1 + stop - 1) * bitSamples - bitSamples * 0.25);
            locked = true;
        } else { cursor += std::max(1, static_cast<int>(bitSamples / 2)); locked = false; }
    }
    fsk_plan_destroy(plan);
    if (!bytes.empty()) text.assign(bytes.begin(), bytes.end());
    return bytes.size();
}
