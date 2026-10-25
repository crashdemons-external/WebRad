"""Extend prepared MMSSTV copies with QSSTV AVT24/94 timing parameters."""
from pathlib import Path
import re

def extend(out: Path):
    header = (out / 'sstv.h').read_text(encoding='utf-8')
    header = header.replace('\tsmEND,', '\tsmAVT24,\n\tsmAVT94,\n\tsmFAX480,\n\tsmEND,')
    header = header.replace(
        'extern BOOL __fastcall IsNarrowMode(int mode);',
        'inline bool IsAVTMode(int mode) { return mode==smAVT || mode==smAVT24 || mode==smAVT94; }\nextern BOOL __fastcall IsNarrowMode(int mode);'
    )
    (out / 'sstv.h').write_text(header, encoding='utf-8')
    text = (out / 'sstv.cpp').read_text(encoding='utf-8')
    text = text.replace('"MC110-N","MC140-N","MC180-N",', '"MC110-N","MC140-N","MC180-N", "AVT 24", "AVT 94", "FAX480",')
    text = text.replace('    smMC180,\n};', '    smMC180, smAVT24, smAVT94, smFAX480,\n};')
    # Use all existing AVT drawing and synchronization paths for the family.
    text = re.sub(r'(SSTVSET\.m_Mode|m_NextMode)\s*==\s*smAVT', r'IsAVTMode(\1)', text)
    text = re.sub(r'(SSTVSET\.m_Mode)\s*!=\s*smAVT', r'!IsAVTMode(\1)', text)
    text = text.replace('m_MS[2] = 0;', 'm_MS[2] = m_MS[smAVT24] = m_MS[smAVT94] = m_MS[smFAX480] = 0;')
    text = text.replace(
        'switch(mode){\n\t\tcase smPD120:',
        'switch(mode){\n        case smFAX480: w=512; h=500; break;\n        case smAVT24: w=128; h=120; break;\n        case smAVT94: w=320; h=200; break;\n\t\tcase smPD120:',
        1
    )
    text = text.replace(
        'case smAVT:\n\t\t\tm_KS = 125.0',
        'case smAVT24:\n        case smAVT94:\n\t\tcase smAVT:\n\t\t\tm_KS = (m_Mode==smAVT24 ? 62.504444444444 : m_Mode==smAVT94 ? 156.25 : 125.0)'
    )
    avt = text.index('case smAVT24:', text.index('void CSSTVSET::SetSampFreq'))
    end = text.index('break;', avt)
    text = text[:avt] + text[avt:end].replace('m_L = 240;', 'm_L = m_Mode==smAVT24 ? 120 : m_Mode==smAVT94 ? 200 : 240;') + text[end:]
    text = text.replace(
        'case smAVT:\n\t\t\treturn 375;',
        'case smAVT24: return 187.513333333333;\n        case smAVT94: return 468.75;\n\t\tcase smAVT:\n\t\t\treturn 375;'
    )
    text = text.replace(
        'case 0x44:      // AVT',
        'case 0xc0: m_NextMode=smAVT24; break;\n                                    case 0x48: m_NextMode=smAVT94; break;\n\t\t\t\t\t\t\t\t\tcase 0x44:      // AVT'
    )
    # Accept both legacy MMSSTV AVT90 and normal AVT synchronization words.
    text = text.replace('(l >= 0xa0) && (l <= 0xbf) && (h >= 0x40) && (h <= 0x5f)', '((h&0xe0)==0x40 || (h&0xe0)==0x60 || (h&0xe0)==0xa0)')
    text = text.replace('if( h != 0x40 )', 'if( h&0x1f )').replace('double(h - 0x40)', 'double(h&0x1f)')
    text = text.replace('switch(m_Mode){', 'switch(m_Mode){\n        case smFAX480: m_KS=262.146*m_SampFreq/1000.; m_OF=m_OFP=m_SG=m_CG=m_SB=m_CB=0; m_L=500; break;', 1)
    text = text.replace('switch(mode){\n\t\tcase smR36:', 'switch(mode){\n        case smFAX480: return 267.266;\n\t\tcase smR36:', 1)
    (out / 'sstv.cpp').write_text(text, encoding='utf-8')
    text = (out / 'receive_image.inc').read_text(encoding='utf-8')
    text = text.replace('SSTVSET.m_Mode == smAVT', 'IsAVTMode(SSTVSET.m_Mode)').replace('SSTVSET.m_Mode != smAVT', '!IsAVTMode(SSTVSET.m_Mode)')
    (out / 'receive_image.inc').write_text(text, encoding='utf-8')
    text = (out / 'encode_image.inc').read_text(encoding='utf-8')
    text=text.replace('void WebEncoder::writeLine() { CSSTVMOD *mp = mod.get();', 'void WebEncoder::writeLine() { CSSTVMOD *mp = mod.get();\n    if(SSTVSET.m_TxMode==smFAX480){for(int x=0;x<image.Width;x++){const BYTE* p=image.rgba.data()+(size_t(mp->m_wLine)*image.Width+x)*4; int gray=(p[0]*299+p[1]*587+p[2]*114+500)/1000; mp->Write(short(ColorToFreq(gray)),262.146/image.Width);}mp->Write(1200,5.12);mp->m_wLine++;return;}')
    text=text.replace('SSTVSET.m_TxMode == smAVT','IsAVTMode(SSTVSET.m_TxMode)')
    text=text.replace('case smAVT:', 'case smAVT24:\n                case smAVT94:\n                case smAVT:')
    text=text.replace('d = 0x44;', 'd = SSTVSET.m_TxMode==smAVT24 ? 0xc0 : SSTVSET.m_TxMode==smAVT94 ? 0x48 : 0x44;')
    text=text.replace('int sd = 0x5fa0;', 'int sd = SSTVSET.m_TxMode==smAVT24 ? 0x5fa0 : SSTVSET.m_TxMode==smAVT94 ? 0x7f80 : 0xbf40;')
    start = text.index('void __fastcall WebEncoder::LineAVT(')
    end = text.index('\nvoid ', start + 1)
    avt = text[start:end].replace('int x;', 'int x;\n    int width=image.Width; double scan=SSTVSET.GetTiming(SSTVSET.m_TxMode)/3.;')
    avt = avt.replace('x < 320', 'x < width').replace('125.0/320.0', 'scan/width')
    text = text[:start] + avt + text[end:]
    (out / 'encode_image.inc').write_text(text, encoding='utf-8')
