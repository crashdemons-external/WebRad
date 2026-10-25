#include "buffers.h"
extern "C" {
#include "apt.h"
void wr_apt_reset();
}
struct Recording { const float *data; int length; int offset; };
static int readSamples(void *context, float *target, int count) {
    auto &recording = *static_cast<Recording *>(context);
    count = std::min(count, recording.length - recording.offset);
    if (count > 0) memcpy(target, recording.data + recording.offset, count * sizeof(float));
    recording.offset += count;
    return count;
}
extern "C" int wr_run(int encode, const void *input, int length, int width, int height) {
    clearResult();
    if (length < 0 || length > 12000 * 900) return fail("Use at most fifteen minutes of satellite audio.");
    if (encode) {
        if (width != 909 || height < 16 || height > 512 || length != width * height * 4) return fail("Satellite pictures must be 909 pixels wide and 16–512 rows tall.");
        auto rgba = static_cast<const uint8_t *>(input);
        audio.resize((height + 4) * 6000);
        for (int row = 0; row < height + 4; row++) {
            for (int i = 0; i < 6000; i++) {
                int column = i * 2080 / 6000;
                int channelColumn = column % 1040;
                float value = 0.05;
                if (channelColumn >= 4 && channelColumn < 32 && column < 1040) value = ((channelColumn - 4) % 4 < 2) ? 1.0 : 0.05;
                else if (channelColumn >= 4 && channelColumn < 39 && column >= 1040) value = ((channelColumn - 4) % 5 < 3) ? 1.0 : 0.05;
                else if (channelColumn >= 39 && channelColumn < 86) value = 1.0;
                else if (channelColumn >= 86 && channelColumn < 995) {
                    int y = std::clamp(row - 2, 0, height - 1);
                    int p = (y * width + channelColumn - 86) * 4;
                    value = 0.05 + 0.9 * (rgba[p] * 0.2126f + rgba[p + 1] * 0.7152f + rgba[p + 2] * 0.0722f) / 255;
                } else if (channelColumn >= 995) value = ((row / 8) % 8 + 1) / 8.0f;
                audio[row * 6000 + i] = value * cos(tau * 2400 * (row * 6000 + i) / 12000);
            }
        }
        return audio.size();
    }
    wr_apt_reset();
    if (apt_init(12000)) return fail("Could not initialize the satellite decoder.");
    int channel = integerOption(0, 0, 2), maxRows = integerOption(1, 16, 1800);
    imageWidth = channel == 2 ? 2080 : 909;
    int offset = channel == 1 ? APT_CHB_OFFSET : (channel == 0 ? APT_CHA_OFFSET : 0);
    Recording recording{static_cast<const float *>(input), length, 0};
    float row[APT_PROW_WIDTH];
    int zenith = 0;
    for (int y = 0; y < maxRows && apt_getpixelrow(row, y, &zenith, y == 0, readSamples, &recording); y++) {
        for (int x = 0; x < imageWidth; x++) {
            float value = std::isfinite(row[x + offset]) ? row[x + offset] : 0;
            uint8_t level = std::clamp(static_cast<int>(value), 0, 255);
            pixels.insert(pixels.end(), {level, level, level, 255});
        }
        imageHeight++;
    }
    if (imageHeight && options[2] != 0) {
        int low = 255, high = 0;
        for (size_t i = 0; i < pixels.size(); i += 4) { low = std::min(low, int(pixels[i])); high = std::max(high, int(pixels[i])); }
        if (high > low) for (size_t i = 0; i < pixels.size(); i += 4) pixels[i] = pixels[i + 1] = pixels[i + 2] = (pixels[i] - low) * 255 / (high - low);
    }
    return imageHeight;
}
