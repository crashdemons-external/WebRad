#ifndef WEBRAD_FFT_COMPAT_H
#define WEBRAD_FFT_COMPAT_H
#include <stddef.h>
#include <stdio.h>
#ifdef __cplusplus
extern "C" {
#endif
typedef float fftwf_complex[2];
typedef struct WebRadFftPlan *fftwf_plan;
#define FFTW_ESTIMATE 64
#define FFTW_FORWARD -1
void *fftwf_malloc(size_t size);
void fftwf_free(void *pointer);
fftwf_plan fftwf_plan_many_dft_r2c(int rank, const int *n, int count, float *input, const int *inembed, int stride, int distance, fftwf_complex *output, const int *outembed, int ostride, int odistance, unsigned flags);
fftwf_plan fftwf_plan_dft_1d(int n, fftwf_complex *input, fftwf_complex *output, int direction, unsigned flags);
void fftwf_execute(fftwf_plan plan);
void fftwf_destroy_plan(fftwf_plan plan);
#ifdef __cplusplus
}
#endif
#endif
