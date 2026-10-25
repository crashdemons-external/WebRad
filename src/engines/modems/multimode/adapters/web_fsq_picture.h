#pragma once
#include <algorithm>
#include <array>
#include <cmath>
#include <vector>

// Retains the end-of-transmission tones until the picture header has been decoded.
class FsqPictureHistory {
    struct ToneMoments {
        double real = 0.0;
        double imaginary = 0.0;
        double cosinePower = 0.0;
        double sinePower = 0.0;
        double cross = 0.0;
        double energy = 0.0;
    };

    std::vector<double> samples;
    int sampleCount = 0;
    int headerSample = -1;
    std::array<double, 3> frequencies{};

    double sample(int position) const {
        return samples[position % samples.size()];
    }

    std::vector<ToneMoments> fitTone(int first, int last, double frequency, int sampleRate) const {
        std::vector<ToneMoments> sums(last - first + 1);
        const double step = 2.0 * std::acos(-1.0) * frequency / sampleRate;
        const double stepCos = std::cos(step);
        const double stepSin = std::sin(step);
        double phaseCos = 1.0;
        double phaseSin = 0.0;
        for (int position = first; position < last; position++) {
            const double value = sample(position);
            auto next = sums[position - first];
            next.real += value * phaseCos;
            next.imaginary += value * phaseSin;
            next.cosinePower += phaseCos * phaseCos;
            next.sinePower += phaseSin * phaseSin;
            next.cross += phaseCos * phaseSin;
            next.energy += value * value;
            sums[position - first + 1] = next;
            const double nextCos = phaseCos * stepCos - phaseSin * stepSin;
            phaseSin = phaseCos * stepSin + phaseSin * stepCos;
            phaseCos = nextCos;
        }
        return sums;
    }

    double residual(const std::vector<ToneMoments>& sums, int first, int last) const {
        const auto& start = sums[first];
        const auto& end = sums[last];
        const double real = end.real - start.real;
        const double imaginary = end.imaginary - start.imaginary;
        const double cosinePower = end.cosinePower - start.cosinePower;
        const double sinePower = end.sinePower - start.sinePower;
        const double cross = end.cross - start.cross;
        const double energy = end.energy - start.energy;
        const double determinant = cosinePower * sinePower - cross * cross;
        if (determinant <= 1e-12 || energy <= 1e-12) return 1.0;
        const double fitted = (sinePower * real * real + cosinePower * imaginary * imaginary - 2.0 * cross * real * imaginary) / determinant;
        return std::max(0.0, (energy - fitted) / energy);
    }

    // Estimate the actual tone, including integer-Hz transmit rounding and recording clock error.
    double measureFrequency(int first, int last, int sampleRate) const {
        double numerator = 0.0;
        double denominator = 0.0;
        for (int position = first + 1; position + 1 < last; position++) {
            const double value = sample(position);
            numerator += value * (sample(position - 1) + sample(position + 1));
            denominator += 2.0 * value * value;
        }
        if (denominator <= 1e-12) return 0.0;
        return std::acos(std::clamp(numerator / denominator, -1.0, 1.0)) * sampleRate / (2.0 * std::acos(-1.0));
    }

    int findClock(int first, int last, int symbolLength, int sampleRate, double maximumError) const {
        std::array<std::vector<ToneMoments>, 3> fits;
        for (int tone = 0; tone < 3; tone++) {
            fits[tone] = fitTone(first, last + 3 * symbolLength, frequencies[tone], sampleRate);
        }
        double bestError = maximumError;
        int bestStart = -1;
        for (int start = first; start <= last; start++) {
            double error = 0.0;
            for (int tone = 0; tone < 3; tone++) {
                const int offset = start - first + tone * symbolLength;
                error += residual(fits[tone], offset, offset + symbolLength);
            }
            if (error < bestError) {
                bestError = error;
                bestStart = start;
            }
        }
        return bestStart;
    }

public:
    void reset(int sampleRate) {
        samples.assign(2 * sampleRate, 0.0);
        sampleCount = 0;
        headerSample = -1;
    }

    void push(double value) {
        samples[sampleCount % samples.size()] = value;
        sampleCount++;
    }

    void arm(int currentBin, int baseBin, int sampleRate, int symbolLength) {
        headerSample = sampleCount - 1;
        const int toneRange = 33 * 3;
        for (int tone = 0; tone < 3; tone++) {
            const int bin = baseBin + (currentBin - baseBin + tone * 3 + toneRange) % toneRange;
            frequencies[tone] = double(bin) * sampleRate / symbolLength;
        }
    }

    bool pending() const {
        return headerSample >= 0;
    }

    bool ready(int symbolLength) const {
        return pending() && sampleCount > headerSample + 3 * symbolLength + 256;
    }

    int size() const {
        return sampleCount;
    }

    double retainedSample(int position) const {
        return sample(position);
    }

    int originalStart() const {
        return headerSample + 1;
    }

    // The decoded backspace still has two complete space symbols after it.
    int findImageStart(int sampleRate, int symbolLength, double markerFrequency) {
        const int first = std::max({0, headerSample - 2 * symbolLength, sampleCount - int(samples.size())});
        const int last = std::min(headerSample, sampleCount - 3 * symbolLength - 256);
        int start = findClock(first, last, symbolLength, sampleRate, 0.8);
        if (start < 0) return -1;
        for (int tone = 0; tone < 3; tone++) {
            const int middle = start + tone * symbolLength + symbolLength / 4;
            const double measured = measureFrequency(middle, middle + symbolLength / 2, sampleRate);
            if (std::abs(measured - frequencies[tone]) > 2.0) return -1;
            frequencies[tone] = measured;
        }
        start = findClock(std::max(first, start - 512), std::min(last, start + 512), symbolLength, sampleRate, 0.15);
        if (start < 0) return -1;
        const int headerEnd = start + 3 * symbolLength;
        const auto marker = fitTone(headerEnd, headerEnd + 200, markerFrequency, sampleRate);
        // Older fldigi emits only 10 of its 200 generated preroll samples.
        const int preroll = residual(marker, 0, 200) < 0.08 ? 200 : 10;
        return headerEnd + preroll;
    }

    void finish() {
        headerSample = -1;
    }
};
