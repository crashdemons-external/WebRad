"""Prepare generated QSSTV sources for the browser build."""
from pathlib import Path
import re
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from _toolchain import generated_dir

REPO = Path(__file__).resolve().parents[4]
ROOT = REPO / 'src/engines' / Path(__file__).resolve().parents[1].name / Path(__file__).resolve().parents[0].name
RX = ['demodulator', 'drm', 'channeldecode', 'bits2bytes', 'crc8_c', 'crc16_bytewise',
      'deinterleaver', 'filter1', 'filter1c', 'getfoffsint', 'getmode', 'getofdm',
      'getofdmsync', 'getsymbolidx', 'lubksb', 'ludcmp', 'mkfacmap', 'mkmscmap',
      'msdhardfac', 'msdhardmsc', 'newfft', 'nrutil', 'psdmean', 'psdcmean', 'viterbi_decode']


def prepare():
    src, dst = ROOT, generated_dir(ROOT)
    files = list((src / 'drmtx/common').rglob('*.h')) + list((src / 'drmtx/common').rglob('*.cpp'))
    files += [src / 'drmtx/config.h', src / 'utils/vector.h', src / 'utils/rs.h', src / 'utils/rs.cpp', src / 'appdefs.h']
    files += [src / 'drmrx' / (n + '.cpp') for n in RX]
    files += list((src / 'drmrx').glob('*.h'))
    for file in files:
        if file.name in ('sourcedecoder.h', 'csoundout.cpp'):
            continue
        path = dst / file.relative_to(src)
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            data = file.read_text(encoding='utf-8-sig')
        except UnicodeDecodeError:
            data = file.read_text(encoding='latin1')
        if file.name == 'CDrmTransmitter.h':
            data = data.replace('virtual ~CDRMTransmitter() {}', 'virtual ~CDRMTransmitter() { delete pSoundOutInterface; }')
        if file.name == 'DABMOT.cpp':
            # Desktop's FIX loop reads counter before initialization.
            data = data.replace('for(m=0;m<fixBlockList.count();m++)', 'for(m=0,counter=0;m<fixBlockList.count();m++,counter++)')
            data = data.replace('if(counter%30==0)', 'if(fixBlockList.at(m)<0 || fixBlockList.at(m)>=numBodySegments) continue;\n              if(counter%30==0)')
            data = data.replace('segmentList.append(fixBlockList.at(m));', 'if(fixBlockList.at(m)>=0 && fixBlockList.at(m)<numBodySegments) segmentList.append(fixBlockList.at(m));')
            data = data.replace('/* end special hamcode */', 'if(browserTransportID>2 && strFileName!="bsr.bin") txTransportID=browserTransportID;\n  /* end special hamcode */')
            data = data.replace('string strFormat;', 'string strFormat(NewMOTObject.strFormat.size(), char(0));')
        if file.name == 'channeldecode.cpp':
            data = data.replace('float MSC_cells_sequence[2 * 2959];', 'float browserFAC[130]={0};\nfloat MSC_cells_sequence[2 * 2959];')
            data = data.replace('transfer_function_FAC[i * 2] =', 'browserFAC[2*i]=received_real[i]; browserFAC[2*i+1]=received_imag[i];\n      transfer_function_FAC[i * 2] =')
        if file.name in ('msdhardfac.cpp', 'msdhardmsc.cpp'):
            # lastiter is a byte buffer, sometimes not aligned for int loads.
            # Compare every byte, including the tail omitted by the old loop.
            data, count = re.subn(
                r'diff = 0;\s*for \(sample_index = 0;.*?/\*diff = memcmp \(lastiter,hardpoints,2 \* N\); \*/',
                'diff = memcmp(lastiter, hardpoints, (2 - HMmix) * N);',
                data,
                flags=re.S
            )
            if count != 1:
                raise ValueError(f'Unexpected comparison in {file.name}')
            # The optional double buffer follows the byte workspace.
            data = data.replace('no_of_bits * sizeof(char);', 'no_of_bits * sizeof(char);\n  msd_mem_size = (msd_mem_size + 7) & ~7;')
        if file.name == 'MOTSlideShow.cpp':
            # PPI has an eight-bit length. Keep a padded MOT data unit <=255
            # bytes even when high-rate MSC packets have more space available.
            data = data.replace('bytesToBeUsed=(TParam.iNumDecodedBitsMSC/SIZEOF__BYTE);', 'bytesToBeUsed=std::min(256,(TParam.iNumDecodedBitsMSC/SIZEOF__BYTE));')
        path.write_text(data, encoding='utf-8')
    # Original coefficients, used by the portable streaming Hilbert boundary.
    data = (src / 'dsp/filterparam.cpp').read_text()
    coef = re.search(
        r'const FILTERPARAMTYPE drmHilbertCoef\[DRMHILBERTTAPS\]\s*=\s*(\{.*?\});', data, re.S
    ).group(1)
    (dst / 'hilbert.inc').write_text('static const double hilbert[] = ' + coef + ';\n')
    return dst

if __name__ == '__main__':
    prepare()
