import { basename, join, relative } from 'node:path';
import { ROOT } from '../../../tooling.mjs';
import { EngineToolchain } from '../../toolchain.mjs';
import { SourceText } from '../../source-text.mjs';

/** Generates portable QSSTV/Dream source copies for the HAMDRM engine. */
export class QsstvSources {
    /** Native receiver translation units in link order. */
    static receiver = ['demodulator', 'drm', 'channeldecode', 'bits2bytes', 'crc8_c', 'crc16_bytewise', 'deinterleaver', 'filter1', 'filter1c', 'getfoffsint', 'getmode', 'getofdm', 'getofdmsync', 'getsymbolidx', 'lubksb', 'ludcmp', 'mkfacmap', 'mkmscmap', 'msdhardfac', 'msdhardmsc', 'newfft', 'nrutil', 'psdmean', 'psdcmean', 'viterbi_decode'];

    /** Apply the existing memory, receive and transport fixes to one copied source. */
    static prepareFile(name, data) {
        switch (name) {
            case 'CDrmTransmitter.h':
                data = SourceText.replace(data, 'virtual ~CDRMTransmitter() {}', 'virtual ~CDRMTransmitter() { delete pSoundOutInterface; }');
                break;
            case 'DABMOT.cpp':
                data = SourceText.replace(data, 'for(m=0;m<fixBlockList.count();m++)', 'for(m=0,counter=0;m<fixBlockList.count();m++,counter++)');
                data = SourceText.replace(data, 'if(counter%30==0)', 'if(fixBlockList.at(m)<0 || fixBlockList.at(m)>=numBodySegments) continue;\n              if(counter%30==0)');
                data = SourceText.replace(data, 'segmentList.append(fixBlockList.at(m));', 'if(fixBlockList.at(m)>=0 && fixBlockList.at(m)<numBodySegments) segmentList.append(fixBlockList.at(m));');
                data = SourceText.replace(data, '/* end special hamcode */', 'if(browserTransportID>2 && strFileName!="bsr.bin") txTransportID=browserTransportID;\n  /* end special hamcode */');
                data = SourceText.replace(data, 'string strFormat;', 'string strFormat(NewMOTObject.strFormat.size(), char(0));');
                break;
            case 'channeldecode.cpp':
                data = SourceText.replace(data, 'float MSC_cells_sequence[2 * 2959];', 'float browserFAC[130]={0};\nfloat MSC_cells_sequence[2 * 2959];');
                data = SourceText.replace(data, 'transfer_function_FAC[i * 2] =', 'browserFAC[2*i]=received_real[i]; browserFAC[2*i+1]=received_imag[i];\n      transfer_function_FAC[i * 2] =');
                break;
            case 'msdhardfac.cpp':
            case 'msdhardmsc.cpp': {
                const expression = /diff = 0;\s*for \(sample_index = 0;.*?\/\*diff = memcmp \(lastiter,hardpoints,2 \* N\); \*\//gs;
                if ([...data.matchAll(expression)].length !== 1) throw Error(`Unexpected comparison in ${name}`);
                data = data.replace(expression, 'diff = memcmp(lastiter, hardpoints, (2 - HMmix) * N);');
                data = SourceText.replace(data, 'no_of_bits * sizeof(char);', 'no_of_bits * sizeof(char);\n  msd_mem_size = (msd_mem_size + 7) & ~7;');
                break;
            }
            case 'MOTSlideShow.cpp':
                data = SourceText.replace(data, 'bytesToBeUsed=(TParam.iNumDecodedBitsMSC/SIZEOF__BYTE);', 'bytesToBeUsed=std::min(256,(TParam.iNumDecodedBitsMSC/SIZEOF__BYTE));');
                break;
        }
        return data;
    }

    /** Copy selected transmitter/receiver files and extract the original Hilbert coefficients. */
    static prepare(root = join(ROOT, 'src/engines/file-transfer/hamdrm')) {
        const generated = EngineToolchain.directory(root, 'generated');
        const common = SourceText.files(join(root, 'drmtx/common'));
        const files = [...common.filter((path) => path.endsWith('.h')), ...common.filter((path) => path.endsWith('.cpp')),
            ...['drmtx/config.h', 'utils/vector.h', 'utils/rs.h', 'utils/rs.cpp', 'appdefs.h'].map((name) => join(root, name)),
            ...QsstvSources.receiver.map((name) => join(root, 'drmrx', name + '.cpp')),
            ...SourceText.files(join(root, 'drmrx'), false).filter((path) => path.endsWith('.h'))];
        for (const file of files) {
            if (['sourcedecoder.h', 'csoundout.cpp'].includes(basename(file))) continue;
            let data;
            try {
                data = SourceText.read(file, 'utf-8-sig');
            } catch (error) {
                if (!(error instanceof TypeError)) throw error;
                data = SourceText.read(file, 'latin1');
            }
            SourceText.write(join(generated, relative(root, file)), QsstvSources.prepareFile(basename(file), data));
        }
        const coefficients = SourceText.read(join(root, 'dsp/filterparam.cpp')).match(
            /const FILTERPARAMTYPE drmHilbertCoef\[DRMHILBERTTAPS\]\s*=\s*(\{.*?\});/s)[1];
        SourceText.write(join(generated, 'hilbert.inc'), 'static const double hilbert[] = ' + coefficients + ';\n');
        return generated;
    }
}
