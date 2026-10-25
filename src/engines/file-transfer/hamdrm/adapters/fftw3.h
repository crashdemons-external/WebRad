#pragma once
// FFTW-compatible transforms using mixed-radix Cooley–Tukey.
#include <complex>
#include <vector>
#include <cstdlib>
#include <cmath>
using fftw_complex = double[2];
using fftwf_complex = float[2];
#define FFTW_FORWARD -1
#define FFTW_BACKWARD 1
#define FFTW_ESTIMATE 0
#define FFTW_R2HC 2
#define FFTW_HC2R 3
template<class T>
struct WebFFTPlan {
    int n, kind;
    T* in;
    T* out;
    std::vector<std::complex<double>> roots, input, result;

    WebFFTPlan(int n, T* i, T* o, int kind)
        : n(n), kind(kind), in(i), out(o), roots(n), input(n), result(n) {
        for (int k = 0; k < n; k++) roots[k] = std::polar(1.0, -2 * 3.14159265358979323846 * k / n);
    }

    void transform(std::complex<double>* out, const std::complex<double>* in, int size, int stride, int sign) {
        if (size == 1) {
            *out = *in;
            return;
        }
        int radix = 2;
        while (radix < size && size % radix) radix++;
        int sub = size / radix;
        for (int j = 0; j < radix; j++) transform(out + j * sub, in + j * stride, sub, stride * radix, sign);

        std::vector<std::complex<double>> row(radix);
        for (int k = 0; k < sub; k++) {
            for (int j = 0; j < radix; j++) row[j] = out[j * sub + k];
            for (int r = 0; r < radix; r++) {
                std::complex<double> sum = 0;
                for (int j = 0; j < radix; j++) {
                    auto root = roots[(j * (k + r * sub) * (n / size)) % n];
                    sum += row[j] * (sign == FFTW_FORWARD ? root : std::conj(root));
                }
                out[k + r * sub] = sum;
            }
        }
    }

    void execute() {
        int sign = kind == FFTW_HC2R ? FFTW_BACKWARD : kind == FFTW_R2HC ? FFTW_FORWARD : kind;
        for (int k = 0; k < n; k++) {
            if (kind == FFTW_R2HC)
                input[k] = {double(in[k]), 0};
            else if (kind == FFTW_HC2R)
                input[k] = k <= n / 2
                    ? std::complex<double>(in[k], k == 0 || k * 2 == n ? 0 : in[n - k])
                    : std::complex<double>(in[n - k], -in[k]);
            else
                input[k] = {double(in[k * 2]), double(in[k * 2 + 1])};
        }
        transform(result.data(), input.data(), n, 1, sign);
        for (int k = 0; k < n; k++) {
            if (kind == FFTW_R2HC)
                out[k] = k <= n / 2 ? result[k].real() : result[n - k].imag();
            else if (kind == FFTW_HC2R)
                out[k] = result[k].real();
            else {
                out[k * 2] = result[k].real();
                out[k * 2 + 1] = result[k].imag();
            }
        }
    }
};

using fftw_plan = WebFFTPlan<double>*;
using fftwf_plan = WebFFTPlan<float>*;

inline fftw_plan fftw_plan_dft_1d(int n, fftw_complex* i, fftw_complex* o, int sign, int) {
    return new WebFFTPlan<double>(n, &i[0][0], &o[0][0], sign);
}
inline fftwf_plan fftwf_plan_dft_1d(int n, fftwf_complex* i, fftwf_complex* o, int sign, int) {
    return new WebFFTPlan<float>(n, &i[0][0], &o[0][0], sign);
}
inline fftw_plan fftw_plan_r2r_1d(int n, double* i, double* o, int kind, int) {
    return new WebFFTPlan<double>(n, i, o, kind);
}
inline void fftw_execute(fftw_plan p) { p->execute(); }
inline void fftwf_execute(fftwf_plan p) { p->execute(); }
inline void fftw_destroy_plan(fftw_plan p) { delete p; }
inline void fftwf_destroy_plan(fftwf_plan p) { delete p; }
inline void* fftw_malloc(size_t n) { return malloc(n); }
inline void fftw_free(void* p) { free(p); }
