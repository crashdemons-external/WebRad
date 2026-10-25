#ifndef WEBRAD_BUFFERS_H
#define WEBRAD_BUFFERS_H
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
// Each module owns its result until the next operation. Copy before calling it again.
static std::vector<float> audio;
static std::vector<uint8_t> bytes;
static std::vector<uint8_t> pixels;
static std::string text;
static std::string error;
static double options[16] = {};
static int imageWidth = 0;
static int imageHeight = 0;
static constexpr double tau = 6.2831853071795864769;
static void clearResult() {
    audio.clear(); bytes.clear(); pixels.clear(); text.clear(); error.clear();
    imageWidth = imageHeight = 0;
}
static int fail(const char *message) { error = message; return -1; }
static int integerOption(int index, int low, int high) {
    return static_cast<int>(std::clamp(options[index], static_cast<double>(low), static_cast<double>(high)));
}
extern "C" {
void wr_option(int index, double value) {
    if (index >= 0 && index < 16 && std::isfinite(value)) options[index] = value;
}
const float *wr_audio() { return audio.data(); }
int wr_audio_size() { return audio.size(); }
const uint8_t *wr_bytes() { return bytes.data(); }
int wr_bytes_size() { return bytes.size(); }
const uint8_t *wr_pixels() { return pixels.data(); }
int wr_width() { return imageWidth; }
int wr_height() { return imageHeight; }
const char *wr_text() { return text.c_str(); }
const char *wr_error() { return error.c_str(); }
}
#endif
