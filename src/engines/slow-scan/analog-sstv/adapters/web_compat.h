// Small browser platform boundary for the original MMSSTV DSP. LGPL-3.0-or-later.
#pragma once
#include <cmath>
#include <cstdint>
#include <cstring>
#include <cstdlib>
#include <cstdio>
#include <algorithm>
#include <vector>
#define __fastcall
#define TRUE 1
#define FALSE 0
#define WM_USER 1024
#define CLOCKMAX 48500
#define ABS(x) std::abs(x)
using BYTE = uint8_t;
using WORD = uint16_t;
using DWORD = uint32_t;
using TColor = uint32_t;
union COLD {
    struct { BYTE r, g, b, d; } b;
    TColor c;
    DWORD d;
};
using UINT = unsigned int;
using BOOL = int;
using LPCSTR = const char*;
using HWND = void*;
inline void VirtualLock(void*, size_t) {}
inline void VirtualUnlock(void*, size_t) {}
inline void PostMessage(HWND, int, int, int) {}
extern double SampFreq, SampBase, FFTSamp;
extern int FFT_SIZE, FFTSampType;
constexpr int DisPaint = 0;
struct BrowserSettings {
    double m_SampFreq = 11025, m_TxSampOff = 0;
    int m_bCQ100 = 0, m_UseRxBuff = 0, m_TestDem = 0, m_Repeater = 0;
    int m_RepSenseLvl = 1, m_RepTimeA = 0, m_RepTimeB = 0, m_RepTimeC = 0, m_RepTimeD = 0;
    int m_FFTPriority = 0, m_FFTType = 0, m_FFTGain = 1;
    int m_AutoStop = 1, m_AutoSync = 1, m_echo = 0, m_DemCalibration = 0;
    int m_Differentiator = 0;
    double m_DemOff = 0, m_DemWhite = 128.0 / 16384, m_DemBlack = 128.0 / 16384;
    double m_DiffLevelP = 1, m_DiffLevelM = 1.0 / 3;
};
extern BrowserSettings sys;
inline double NormalSampFreq(double d, double m) { return std::round(d * m) / m; }
int Limit256(int d);
void LimitRGB(int &r, int &g, int &b);
void YCtoRGB(int &r, int &g, int &b, int y, int ry, int by);
inline const char* SkipSpace(const char* value) {
    while (*value == ' ' || *value == '\t') ++value;
    return value;
}
inline void StrCopy(char* to, const char* from, int count) {
    std::strncpy(to, from, count);
    to[count] = 0;
}
inline void clipsp(char* value) {
    size_t n = std::strlen(value);
    while (n && (value[n - 1] == ' ' || value[n - 1] == '\t')) value[--n] = 0;
}
