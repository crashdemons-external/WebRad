#include "fftw3.h"
extern "C" {
#include "kiss_fft.h"
}
#include <cstdlib>
#include <vector>
// A narrow adapter to WebRad's existing KISS FFT; no FFTW code or library is used.
struct WebRadFftPlan {
    int size;
    float *real;
    fftwf_complex *complex;
    fftwf_complex *output;
    kiss_fft_cfg config;
    std::vector<kiss_fft_cpx> input;
    std::vector<kiss_fft_cpx> result;
};
extern "C" {
void *fftwf_malloc(size_t size) { return malloc(size); }
void fftwf_free(void *pointer) { free(pointer); }
fftwf_plan fftwf_plan_dft_1d(int n, fftwf_complex *input, fftwf_complex *output, int direction, unsigned) {
    if (n < 2 || n > 32768 || direction != FFTW_FORWARD) return nullptr;
    auto *plan = new WebRadFftPlan{n, nullptr, input, output, kiss_fft_alloc(n, 0, nullptr, nullptr)};
    if (!plan->config) { delete plan; return nullptr; }
    plan->input.resize(n);
    plan->result.resize(n);
    return plan;
}
fftwf_plan fftwf_plan_many_dft_r2c(int rank, const int *n, int count, float *input, const int *, int stride, int, fftwf_complex *output, const int *, int ostride, int, unsigned flags) {
    if (rank != 1 || count != 1 || stride != 1 || ostride != 1) return nullptr;
    auto plan = fftwf_plan_dft_1d(*n, nullptr, output, FFTW_FORWARD, flags);
    if (plan) plan->real = input;
    return plan;
}
void fftwf_execute(fftwf_plan plan) {
    for (int i = 0; i < plan->size; i++) {
        plan->input[i].r = plan->real ? plan->real[i] : plan->complex[i][0];
        plan->input[i].i = plan->real ? 0 : plan->complex[i][1];
    }
    kiss_fft(plan->config, plan->input.data(), plan->result.data());
    int count = plan->real ? plan->size / 2 + 1 : plan->size;
    for (int i = 0; i < count; i++) {
        plan->output[i][0] = plan->result[i].r;
        plan->output[i][1] = plan->result[i].i;
    }
}
void fftwf_destroy_plan(fftwf_plan plan) {
    if (!plan) return;
    free(plan->config);
    delete plan;
}
}
