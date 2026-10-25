#include "buffers.h"
extern "C" {
#include "kiss_fft.h"
}
// Image rows are frequency bands; columns are successive windows in time.
extern "C" int wr_run(int encode, const void *input, int length, int width, int height) {
    clearResult();
    imageWidth = integerOption(0, 16, 512);
    imageHeight = integerOption(1, 16, 256);
    double low = std::clamp(options[2], 100.0, 5000.0), high = std::clamp(options[3], 200.0, 5500.0);
    int columnSamples = std::lround(std::clamp(options[4], 40.0, 500.0) * 12);
    if (high <= low || (high - low) / imageHeight < 8) return fail("Use a wider frequency range or fewer picture rows (at least 8 Hz per row).");
    if (length < 0 || length > 12000 * 260) return fail("Use a recording shorter than 260 seconds.");
    auto frequency = [&](int row) { return high - (high - low) * row / (imageHeight - 1); };
    if (encode) {
        if (width != imageWidth || height != imageHeight || length != width * height * 4) return fail("The picture size does not match the selected dimensions.");
        auto rgba = static_cast<const uint8_t *>(input);
        audio.assign(imageWidth * columnSamples, 0);
        for (int row = 0; row < imageHeight; row++) {
            double phase = row * 1.61803398875;
            double increment = tau * frequency(row) / 12000;
            for (int x = 0; x < imageWidth; x++) {
                int p = (row * imageWidth + x) * 4;
                float level = (rgba[p] * 0.2126f + rgba[p + 1] * 0.7152f + rgba[p + 2] * 0.0722f) / 255;
                for (int i = 0; i < columnSamples; i++) {
                    float envelope = std::min(1.0f, std::min(i, columnSamples - i - 1) / (columnSamples * 0.05f));
                    audio[x * columnSamples + i] += level * envelope * sin(phase);
                    phase = fmod(phase + increment, tau);
                }
            }
        }
        float peak = 0;
        for (float value : audio) peak = std::max(peak, fabsf(value));
        if (peak > 0) for (float &value : audio) value *= 0.85f / peak;
        return audio.size();
    }
    if (length == 0) return 0;
    int fftSize = 4096;
    auto config = kiss_fft_alloc(fftSize, 0, nullptr, nullptr);
    if (!config) return fail("Could not create the spectrum analyzer.");
    std::vector<kiss_fft_cpx> fftInput(fftSize), output(fftSize);
    std::vector<float> intensity(imageWidth * imageHeight);
    auto samples = static_cast<const float *>(input);
    float peak = 0;
    // Spread the selected width across the recording; this also reveals arbitrary audio.
    for (int x = 0; x < imageWidth; x++) {
        int center = (static_cast<int64_t>(2 * x + 1) * length) / (2 * imageWidth);
        for (int i = 0; i < fftSize; i++) {
            int at = center + i - fftSize / 2;
            fftInput[i].r = at >= 0 && at < length ? samples[at] * (0.5 - 0.5 * cos(tau * i / fftSize)) : 0;
            fftInput[i].i = 0;
        }
        kiss_fft(config, fftInput.data(), output.data());
        for (int row = 0; row < imageHeight; row++) {
            int bin = std::lround(frequency(row) * fftSize / 12000);
            float value = hypotf(output[bin].r, output[bin].i);
            intensity[row * imageWidth + x] = value;
            peak = std::max(peak, value);
        }
    }
    free(config);
    pixels.resize(imageWidth * imageHeight * 4);
    double gamma = std::clamp(options[5], 0.2, 2.0);
    for (size_t i = 0; i < intensity.size(); i++) {
        int level = peak > 0 ? std::clamp(static_cast<int>(255 * pow(intensity[i] / peak, gamma)), 0, 255) : 0;
        pixels[4 * i] = pixels[4 * i + 1] = pixels[4 * i + 2] = level;
        pixels[4 * i + 3] = 255;
    }
    return imageHeight;
}
