import { join } from 'node:path';
import { ROOT } from '../../../tooling.mjs';
import { EngineToolchain } from '../../toolchain.mjs';
import { SourceText } from '../../source-text.mjs';

/** Prepares MMSSTV's original Shift-JIS sources and image scan routines. */
export class SstvSources {
    /** Remove desktop drawing and keying while retaining the native DSP and modulator. */
    static prepareFile(name, text) {
        for (const marker of ['#include <vcl.h>', '#include <inifiles.hpp>', '#include "ComLib.h"'])
            text = SourceText.replace(text, marker, '#include "web_compat.h"');
        text = SourceText.replace(text, '"Fir.h"', '"fir.h"');
        text = SourceText.replace(text, '"fft.h"', '"Fft.h"');
        // No serialized DSP structs cross the boundary; double arrays use natural alignment.
        text = text.replace(/^#pragma pack\(.*?\)\s*$/gm, '');
        for (const variable of ['Z', 'D', 'm_MSyncList'])
            text = SourceText.replace(text, 'memcpy(' + variable + ', &' + variable + '[1]', 'memmove(' + variable + ', &' + variable + '[1]');
        if (name === 'fir.cpp') {
            for (const signature of ['void DrawGraph(', 'void DrawGraphIIR(']) {
                while (text.includes(signature)) text = SourceText.replace(text, SourceText.function(text, signature), '');
            }
            text = SourceText.replace(text, SourceText.function(text, 'double asinh('), '');
            text = SourceText.replace(text, 'memcpy(zp, &zp[1]', 'memmove(zp, &zp[1]');
        }
        if (name === 'sstv.cpp') {
            text = SourceText.replace(text, SourceText.function(text, 'void CSSTVMOD::WriteCWID('), '');
            text = SourceText.replace(text, 'm_TXBuf = NULL;\n\n\tm_bpf',
                'm_TXBuf = NULL;\n\tm_TXBufLen = 0;\n\tm_VariR = 298; m_VariG = 588; m_VariB = 110;\n\n\tm_bpf');
        }
        if (name === 'fir.h') text = text.replace(/^void DrawGraph.*?;\s*$/gm, '');
        for (const variable of ['ptbl[0]', 'ptbl[1]', 'pSinTbl', 'pScopeData', 'bp', 'op', 'm_B12', 'm_Buf', 'm_StgB12', 'm_StgBuf', 'Z', 'D', 'H', 'A', 'B', 'm_pZ', 'm_pH', 'm_tSinCos', 'm_tWindow', 'pStgBuf', 'm_Work', 'm_TXBuf'])
            text = SourceText.replace(text, 'delete ' + variable + ';', 'delete[] ' + variable + ';');
        return SourceText.replace(text, 'memcpy(m_AutoStopAPos, &m_AutoStopAPos[1]', 'memmove(m_AutoStopAPos, &m_AutoStopAPos[1]');
    }

    /** Extract native receive-image drawing and synchronization routines. */
    static receiveImage(main, drawing) {
        const chunks = [];
        for (const name of ['SyncSSTV', 'InitAutoStop', 'GetSqerrPos', 'AutoStopJob', 'GetPixelLevel', 'GetPictureLevel', 'GetPictureLevelDiff', 'DrawSSTVNormal', 'DrawSSTVDiff']) {
            const signature = main.match(new RegExp('(?:void|int) __fastcall TMmsstv::' + name + '\\('))[0];
            chunks.push(SourceText.replace(SourceText.function(main, signature), 'TMmsstv::', 'WebReceiver::'));
        }
        for (const name of ['Limit256', 'LimitRGB', 'YCtoRGB']) {
            const signature = drawing.match(new RegExp('(?:void|int) __fastcall ' + name + '\\('))[0];
            chunks.push(SourceText.function(drawing, signature));
        }
        let text = SourceText.replace(chunks.join('\n\n'), 'delete bp;', 'delete[] bp;');
        text = SourceText.replace(text, 'memcpy(m_AutoStopAPos, &m_AutoStopAPos[1]', 'memmove(m_AutoStopAPos, &m_AutoStopAPos[1]');
        text = SourceText.replace(text, 'AutoStopJob();', 'if (SSTVSET.m_Mode != smRM8 || m_AY >= 48) AutoStopJob();');
        return '// Extracted from MMSSTV Main.cpp and ComLib.cpp. LGPL-3.0-or-later.\n' + text;
    }

    /** Extract native VIS headers and image modulation, retaining paired Robot 24 rows. */
    static encodeImage(main, drawing) {
        const tx = [];
        for (const name of ['LineR24', 'LineR36', 'LineR72', 'LineAVT', 'LineSCT', 'LineMRT', 'LineSC2180', 'LinePD', 'LineP', 'LineMP', 'LineMR', 'LineRM', 'LineMN', 'LineMC']) {
            let source = SourceText.function(main, 'void __fastcall TMmsstv::' + name + '(');
            if (name === 'LineR24') {
                const declaration = 'int Y, RY[320], BY[320];';
                const pixelRead = 'GetRY(Y, RY[x], BY[x], pBitmapTX->Canvas->Pixels[x][mp->m_wLine]);';
                source = SourceText.replaceOnce(source, declaration, 'int Y, RY[320], BY[320], nextY, nextRY, nextBY;');
                source = SourceText.replaceOnce(source, pixelRead,
                    pixelRead + '\n\t\tGetRY(nextY, nextRY, nextBY, pBitmapTX->Canvas->Pixels[x][mp->m_wLine + 1]);\n' +
                    '\t\tY = (Y + nextY + 1) / 2;\n\t\tRY[x] = (RY[x] + nextRY + 1) / 2;\n\t\tBY[x] = (BY[x] + nextBY + 1) / 2;');
            }
            tx.push(SourceText.replace(source, 'TMmsstv::', 'WebEncoder::'));
        }
        for (const signature of ['int __fastcall ColorToFreq(', 'int __fastcall ColorToFreqNarrow(', 'void __fastcall GetRY('])
            tx.unshift(SourceText.function(drawing, signature));
        const startTx = SourceText.function(main, 'void __fastcall TMmsstv::ToTX(');
        const header = startTx.slice(SourceText.index(startTx, '// VIS'), SourceText.index(startTx, 'mp->m_sCnt ='));
        tx.push('void WebEncoder::writeHeader() { CSSTVMOD *mp = mod.get();\n' + header + '}');
        const send = SourceText.function(main, 'void __fastcall TMmsstv::SendSSTV(');
        tx.push('void WebEncoder::writeLine() { CSSTVMOD *mp = mod.get();\n' + SourceText.function(send, 'switch(SSTVSET.m_TxMode)') + '\nmp->m_wLine++;\n}');
        return '// Extracted from MMSSTV Main.cpp and ComLib.cpp. LGPL-3.0-or-later.\n' + tx.join('\n\n');
    }

    /** Add QSSTV AVT24/94 timing and FAX480 to the prepared MMSSTV copies. */
    static extendModes(out) {
        let header = SourceText.read(join(out, 'sstv.h'));
        header = SourceText.replace(header, '\tsmEND,', '\tsmAVT24,\n\tsmAVT94,\n\tsmFAX480,\n\tsmEND,');
        header = SourceText.replace(header, 'extern BOOL __fastcall IsNarrowMode(int mode);',
            'inline bool IsAVTMode(int mode) { return mode==smAVT || mode==smAVT24 || mode==smAVT94; }\nextern BOOL __fastcall IsNarrowMode(int mode);');
        SourceText.write(join(out, 'sstv.h'), header);
        let text = SourceText.read(join(out, 'sstv.cpp'));
        text = SourceText.replace(text, '"MC110-N","MC140-N","MC180-N",', '"MC110-N","MC140-N","MC180-N", "AVT 24", "AVT 94", "FAX480",');
        text = SourceText.replace(text, '    smMC180,\n};', '    smMC180, smAVT24, smAVT94, smFAX480,\n};');
        text = text.replace(/(SSTVSET\.m_Mode|m_NextMode)\s*==\s*smAVT/g, 'IsAVTMode($1)');
        text = text.replace(/(SSTVSET\.m_Mode)\s*!=\s*smAVT/g, '!IsAVTMode($1)');
        text = SourceText.replace(text, 'm_MS[2] = 0;', 'm_MS[2] = m_MS[smAVT24] = m_MS[smAVT94] = m_MS[smFAX480] = 0;');
        text = SourceText.replace(text, 'switch(mode){\n\t\tcase smPD120:', 'switch(mode){\n        case smFAX480: w=512; h=500; break;\n        case smAVT24: w=128; h=120; break;\n        case smAVT94: w=320; h=200; break;\n\t\tcase smPD120:', 1);
        text = SourceText.replace(text, 'case smAVT:\n\t\t\tm_KS = 125.0', 'case smAVT24:\n        case smAVT94:\n\t\tcase smAVT:\n\t\t\tm_KS = (m_Mode==smAVT24 ? 62.504444444444 : m_Mode==smAVT94 ? 156.25 : 125.0)');
        const avt = SourceText.index(text, 'case smAVT24:', SourceText.index(text, 'void CSSTVSET::SetSampFreq'));
        const end = SourceText.index(text, 'break;', avt);
        text = text.slice(0, avt) + SourceText.replace(text.slice(avt, end), 'm_L = 240;', 'm_L = m_Mode==smAVT24 ? 120 : m_Mode==smAVT94 ? 200 : 240;') + text.slice(end);
        text = SourceText.replace(text, 'case smAVT:\n\t\t\treturn 375;', 'case smAVT24: return 187.513333333333;\n        case smAVT94: return 468.75;\n\t\tcase smAVT:\n\t\t\treturn 375;');
        text = SourceText.replace(text, 'case 0x44:      // AVT', 'case 0xc0: m_NextMode=smAVT24; break;\n                                    case 0x48: m_NextMode=smAVT94; break;\n\t\t\t\t\t\t\t\t\tcase 0x44:      // AVT');
        text = SourceText.replace(text, '(l >= 0xa0) && (l <= 0xbf) && (h >= 0x40) && (h <= 0x5f)', '((h&0xe0)==0x40 || (h&0xe0)==0x60 || (h&0xe0)==0xa0)');
        text = SourceText.replace(text, 'if( h != 0x40 )', 'if( h&0x1f )');
        text = SourceText.replace(text, 'double(h - 0x40)', 'double(h&0x1f)');
        text = SourceText.replace(text, 'switch(m_Mode){', 'switch(m_Mode){\n        case smFAX480: m_KS=262.146*m_SampFreq/1000.; m_OF=m_OFP=m_SG=m_CG=m_SB=m_CB=0; m_L=500; break;', 1);
        text = SourceText.replace(text, 'switch(mode){\n\t\tcase smR36:', 'switch(mode){\n        case smFAX480: return 267.266;\n\t\tcase smR36:', 1);
        SourceText.write(join(out, 'sstv.cpp'), text);
        text = SourceText.read(join(out, 'receive_image.inc'));
        text = SourceText.replace(text, 'SSTVSET.m_Mode == smAVT', 'IsAVTMode(SSTVSET.m_Mode)');
        text = SourceText.replace(text, 'SSTVSET.m_Mode != smAVT', '!IsAVTMode(SSTVSET.m_Mode)');
        SourceText.write(join(out, 'receive_image.inc'), text);
        text = SourceText.read(join(out, 'encode_image.inc'));
        text = SourceText.replace(text, 'void WebEncoder::writeLine() { CSSTVMOD *mp = mod.get();', 'void WebEncoder::writeLine() { CSSTVMOD *mp = mod.get();\n    if(SSTVSET.m_TxMode==smFAX480){for(int x=0;x<image.Width;x++){const BYTE* p=image.rgba.data()+(size_t(mp->m_wLine)*image.Width+x)*4; int gray=(p[0]*299+p[1]*587+p[2]*114+500)/1000; mp->Write(short(ColorToFreq(gray)),262.146/image.Width);}mp->Write(1200,5.12);mp->m_wLine++;return;}');
        text = SourceText.replace(text, 'SSTVSET.m_TxMode == smAVT', 'IsAVTMode(SSTVSET.m_TxMode)');
        text = SourceText.replace(text, 'case smAVT:', 'case smAVT24:\n                case smAVT94:\n                case smAVT:');
        text = SourceText.replace(text, 'd = 0x44;', 'd = SSTVSET.m_TxMode==smAVT24 ? 0xc0 : SSTVSET.m_TxMode==smAVT94 ? 0x48 : 0x44;');
        text = SourceText.replace(text, 'int sd = 0x5fa0;', 'int sd = SSTVSET.m_TxMode==smAVT24 ? 0x5fa0 : SSTVSET.m_TxMode==smAVT94 ? 0x7f80 : 0xbf40;');
        const start = SourceText.index(text, 'void __fastcall WebEncoder::LineAVT(');
        const stop = SourceText.index(text, '\nvoid ', start + 1);
        let line = SourceText.replace(text.slice(start, stop), 'int x;', 'int x;\n    int width=image.Width; double scan=SSTVSET.GetTiming(SSTVSET.m_TxMode)/3.;');
        line = SourceText.replace(line, 'x < 320', 'x < width');
        line = SourceText.replace(line, '125.0/320.0', 'scan/width');
        text = text.slice(0, start) + line + text.slice(stop);
        SourceText.write(join(out, 'encode_image.inc'), text);
    }

    /** Generate portable source copies and include files without modifying upstream bytes. */
    static prepare(root = join(ROOT, 'src/engines/slow-scan/analog-sstv')) {
        const out = EngineToolchain.directory(root, 'generated');
        for (const name of ['sstv.cpp', 'sstv.h', 'fir.cpp', 'fir.h', 'Fft.cpp', 'Fft.h'])
            SourceText.write(join(out, name), SstvSources.prepareFile(name, SourceText.read(join(root, name), 'shift_jis')));
        const main = SourceText.read(join(root, 'Main.cpp'), 'shift_jis');
        const drawing = SourceText.read(join(root, 'ComLib.cpp'), 'shift_jis');
        SourceText.write(join(out, 'receive_image.inc'), SstvSources.receiveImage(main, drawing));
        SourceText.write(join(out, 'encode_image.inc'), SstvSources.encodeImage(main, drawing));
        SstvSources.extendModes(out);
        return out;
    }
}
