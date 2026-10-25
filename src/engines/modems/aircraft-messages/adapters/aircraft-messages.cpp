#include "buffers.h"
extern "C" int wr_aircraft_decode(const float *samples, int length);
extern "C" void wr_aircraft_message(const char *message, int length) {
    if (text.size() + length < 262144) text.append(message, length);
}
extern "C" int wr_run(int encode, const void *input, int length, int, int) {
    clearResult();
    if (length < 0 || length > 12000 * 180) return fail("Use at most three minutes of aircraft audio.");
    if (encode) {
        if (length < 13 || length > 233) return fail("Use at most 220 ASCII characters in an aircraft message.");
        auto data = static_cast<const uint8_t *>(input);
        for (int i = 0; i < length; i++) {
            if (data[i] < 32 && !(i == 12 && data[i] == 2) && !(i > 12 && (data[i] == 10 || data[i] == 13))) return fail("Use printable ASCII, line breaks and the required message header.");
            if (data[i] > 126) return fail("Aircraft messages support ASCII text only.");
        }
        if (data[12] != 2) return fail("The aircraft message header is incomplete.");
        std::vector<uint8_t> framed(32, 255);
        framed.insert(framed.end(), {0xAB, 0x2A, 0x16, 0x16, 0x01});
        uint16_t crc = 0;
        for (int i = 0; i <= length; i++) {
            uint8_t value = i < length ? data[i] : 3;
            value |= (__builtin_parity(value) ? 0 : 128);
            framed.push_back(value);
            crc ^= value;
            for (int bit = 0; bit < 8; bit++) crc = (crc >> 1) ^ ((crc & 1) ? 0x8408 : 0);
        }
        framed.push_back(crc & 255);
        framed.push_back(crc >> 8);
        framed.push_back(127);
        framed.insert(framed.end(), 8, 255);
        int previous = 0;
        double phase = 0;
        for (uint8_t value : framed) for (int bit = 0; bit < 8; bit++) {
            int current = (value >> bit) & 1;
            double increment = tau * ((current ^ previous ^ 1) ? 2400 : 1200) / 12000;
            for (int i = 0; i < 5; i++) {
                audio.push_back(0.7 * cos(phase));
                phase = fmod(phase + increment, tau);
            }
            previous = current;
        }
        return audio.size();
    }
    if (wr_aircraft_decode(static_cast<const float *>(input), length)) return fail("Could not initialize the aircraft decoder.");
    return text.size();
}
