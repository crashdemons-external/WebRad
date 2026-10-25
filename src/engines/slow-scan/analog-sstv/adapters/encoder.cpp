// Original MMSSTV audio modulation, exported as PCM for files. LGPL-3.0-or-later.
#include "encoder.h"
#include <emscripten/emscripten.h>

#include "encode_image.inc"

bool WebEncoder::start(int selected, const BYTE* pixels, int width, int height, const char* id) {
    if (selected < 0 || selected >= smEND || !pixels) return false;
    int expectedWidth, bitmapHeight, pictureHeight;
    SSTVSET.GetPictureSize(expectedWidth, bitmapHeight, pictureHeight, selected);
    if (width != expectedWidth || height != pictureHeight) return false;

    mode = selected;
    footer = done = false;
    call.clear();
    if (id) {
        for (int n = 0; n < 32 && id[n]; n++) {
            unsigned char c = id[n];
            if (c >= 32 && c <= 95) call.push_back(c);
        }
    }
    SSTVSET.SetTxMode(selected);
    image.Width = width;
    image.Height = height;
    image.rgba.assign(pixels, pixels + size_t(width) * height * 4);
    mod = std::make_unique<CSSTVMOD>();
    mod->OpenTXBuf(14);
    mod->InitTXBuf();
    mod->Write(0,100);
    if (selected == smFAX480) {
        for (int i = 0; i < 1220; i++) {
            mod->Write(1500, 2.05);
            mod->Write(2300, 2.05);
        }
        return true;
    }
    // Default MMSSTV header (OutHEAD, VOX off).
    const int wide[]={1900,1500,1900,1500,2300,1500,2300,1500};
    const int narrow[]={1900,2300,1900,2300};
    if (SSTVSET.m_fTxNarrow) {
        for (int f : narrow) mod->Write(short(f), 100);
    } else {
        for (int f : wide) mod->Write(short(f), 100);
    }
    writeHeader();
    return true;
}

void WebEncoder::writeFooter() {
    auto& mp=*mod;
    if(call.empty()) {
        mp.WriteC(short(SSTVSET.m_fTxNarrow ? 1900 : 1500), std::min(SSTVSET.m_TTW, SampFreq / 2));
        if (!SSTVSET.m_fTxNarrow) {
            mp.Write(1900, 100);
            mp.Write(1500, 100);
            mp.Write(1900, 100);
            mp.Write(1500, 100);
        }
    } else {
        mp.Write(short(SSTVSET.m_fTxNarrow ? 1900 : 1500), 300);
        mp.Write(FSKSPACE, FSKGARD);
        mp.Write(1900, FSKINTVAL);
        mp.WriteFSK(0x2a);
        BYTE checksum = 0;
        for (unsigned char c : call) {
            BYTE value = c - 32;
            checksum ^= value;
            mp.WriteFSK(value);
        }
        mp.WriteFSK(1);
        mp.WriteFSK(checksum);
        mp.Write(FSKSPACE, FSKGARD);
    }
    mp.Write(0,300);
    footer=true;
}

int WebEncoder::read(short* output, int capacity) {
    if (!mod || !output || capacity < 1 || capacity > 65536 || done) return 0;
    int n = 0;
    while (n < capacity) {
        if (!mod->m_Cnt) {
            if (mod->m_wLine < SSTVSET.m_TL) writeLine();
            else if (!footer) writeFooter();
            else {
                done = true;
                break;
            }
        }
        if (mod->m_Cnt) output[n++] = short(std::clamp(mod->Do(), -32768.0, 32767.0));
    }
    return n;
}

static std::unique_ptr<WebEncoder> encoder;
extern "C" {
EMSCRIPTEN_KEEPALIVE int web_mode_tx_height(int mode) {
    if (mode < 0 || mode >= smEND) return 0;
    int width, height, picture;
    SSTVSET.GetPictureSize(width, height, picture, mode);
    return picture;
}
EMSCRIPTEN_KEEPALIVE int web_encode_start(int mode, const BYTE* rgba, int width, int height, const char* call) {
    encoder = std::make_unique<WebEncoder>();
    if (!encoder->start(mode, rgba, width, height, call)) {
        encoder.reset();
        return 0;
    }
    return 1;
}
EMSCRIPTEN_KEEPALIVE int web_encode_read(short* output, int capacity) {
    return encoder ? encoder->read(output, capacity) : 0;
}
EMSCRIPTEN_KEEPALIVE double web_encode_progress() {
    return encoder && encoder->mod ? std::min(1.0, double(encoder->mod->m_wLine) / SSTVSET.m_TL) : 0;
}
EMSCRIPTEN_KEEPALIVE void web_encode_cancel() {
    encoder.reset();
}
}
