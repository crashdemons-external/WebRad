// Offline adapter for the original MMSSTV image-to-audio encoder. LGPL-3.0-or-later.
#pragma once
#include "web_compat.h"
#include "sstv.h"
#include <memory>
#include <string>

struct EncodeBitmap {
    int Width = 0, Height = 0;
    std::vector<BYTE> rgba;
    struct Column {
        EncodeBitmap* owner;
        int x;
        TColor operator[](int y) {
            if (x < 0 || x >= owner->Width || y < 0 || y >= owner->Height) return 0;
            const BYTE* p = owner->rgba.data() + (size_t(y) * owner->Width + x) * 4;
            return TColor(p[0]) | (TColor(p[1]) << 8) | (TColor(p[2]) << 16);
        }
    };
    struct Pixels {
        EncodeBitmap* owner;
        Column operator[](int x) { return {owner, x}; }
    };
    struct CanvasData {
        Pixels Pixels;
    };
    CanvasData canvas{{this}};
    CanvasData* Canvas = &canvas;
};

class WebEncoder {
public:
    std::unique_ptr<CSSTVMOD> mod;
    EncodeBitmap image;
    EncodeBitmap* pBitmapTX = &image;
    std::string call;
    bool footer = false, done = false;
    int mode = 0;
    bool start(int selected, const BYTE* pixels, int width, int height, const char* id);
    int read(short* output, int capacity);
    void writeHeader();
    void writeLine();
    void writeFooter();
    void LineR24(CSSTVMOD*);
    void LineR36(CSSTVMOD*);
    void LineR72(CSSTVMOD*);
    void LineAVT(CSSTVMOD*);
    void LineSCT(CSSTVMOD*, double);
    void LineMRT(CSSTVMOD*, double);
    void LineSC2180(CSSTVMOD*, double, double);
    void LinePD(CSSTVMOD*, double);
    void LineP(CSSTVMOD*, double, double, double);
    void LineMP(CSSTVMOD*, double);
    void LineMR(CSSTVMOD*, double);
    void LineRM(CSSTVMOD*, double, double);
    void LineMN(CSSTVMOD*, double);
    void LineMC(CSSTVMOD*, double);
};
