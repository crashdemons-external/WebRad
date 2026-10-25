import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { EngineToolchain } from '../toolchain.mjs';
import { SourceText } from '../source-text.mjs';
import { ROOT } from '../../tooling.mjs';

/** Generates Codec2 tables and selects the existing FreeDV build sources. */
export class VoiceBuilder {
    /** Convert the original decimal tokens into native codebooks without rounding their values. */
    static codebooks(source, destination) {
        const groups = {
            codebook: ['lsp_cb', Array.from({ length: 10 }, (_, index) => `lsp${index + 1}.txt`)],
            codebookd: ['lsp_cbd', Array.from({ length: 10 }, (_, index) => `dlsp${index + 1}.txt`)],
            codebookjmv: ['lsp_cbjmv', ['lspjmv1.txt', 'lspjmv2.txt', 'lspjmv3.txt']],
            codebookge: ['ge_cb', ['gecb.txt']],
            codebooknewamp1: ['newamp1vq_cb', ['train_120_1.txt', 'train_120_2.txt']],
            codebooknewamp1_energy: ['newamp1_energy_cb', ['newamp1_energy_q.txt']],
            codebooknewamp2: ['newamp2vq_cb', ['codes_450.txt']],
            codebooknewamp2_energy: ['newamp2_energy_cb', ['newamp2_energy_q.txt']]
        };
        for (const [filename, [symbol, files]] of Object.entries(groups)) {
            const code = ['/* Generated from the pinned Codec2 tables. LGPL-2.1. */', '#include "defines.h"'];
            const structures = [];
            for (const [index, name] of files.entries()) {
                const text = SourceText.read(join(source, 'codebook', name)).split('\n').map((line) => line.split('#')[0]).join('\n');
                const numbers = text.match(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g);
                const [rows, columns] = numbers.slice(0, 2).map(Number);
                const values = numbers.slice(2);
                if (values.length !== rows * columns) throw Error(`Unexpected codebook dimensions: ${name}`);
                code.push(`static float codes${index}[]={` + values.join(',') + '};');
                structures.push(`{${rows},${Math.round(Math.log2(columns))},${columns},codes${index}}`);
            }
            code.push(`const struct lsp_codebook ${symbol}[]={` + structures.join(',') + ',{0,0,0,0}};');
            SourceText.write(join(destination, filename + '.c'), code.join('\n'));
        }
    }

    /** Generate tables and version headers, then resolve the selected CMake source list. */
    static prepare(root) {
        const source = join(root, 'src');
        const destination = join(EngineToolchain.directory(root, 'generated'), 'voice-generated');
        SourceText.write(join(destination, 'codec2/version.h'),
            '#define CODEC2_VERSION_MAJOR 1\n#define CODEC2_VERSION_MINOR 2\n#define CODEC2_VERSION_PATCH 0\n#define CODEC2_VERSION "1.2.0"\n');
        VoiceBuilder.codebooks(source, destination);
        const cmake = SourceText.read(join(ROOT, 'scripts/engines/modems/digital-voice/CMakeLists.txt'));
        const names = [...new Set(cmake.match(/set\(CODEC2_SRCS(.*?)\)/s)[1].trim().split(/\s+/))];
        const paths = names.filter((name) => name !== 'freedv_2020.c')
            .map((name) => existsSync(join(source, name)) ? join(source, name) : join(destination, name));
        return { source, destination, paths };
    }

    /** Compile the existing Codec2/FreeDV API with external LPCNet modes disabled. */
    static async build(root, compiler, debug = false) {
        const { source, destination, paths } = VoiceBuilder.prepare(root);
        const exports = ['freedv_open_advanced', 'codec2_create', 'codec2_destroy', 'codec2_encode', 'codec2_decode', 'codec2_samples_per_frame', 'codec2_bits_per_frame', 'codec2_bytes_per_frame', 'codec2_set_natural_or_gray', 'codec2_set_lpc_post_filter', 'codec2_700c_post_filter', 'codec2_700c_eq', 'freedv_open', 'freedv_close', 'freedv_tx', 'freedv_rx', 'freedv_nin', 'freedv_get_n_speech_samples', 'freedv_get_n_max_speech_samples', 'freedv_get_n_max_modem_samples', 'freedv_get_n_nom_modem_samples', 'freedv_get_modem_sample_rate', 'freedv_get_speech_sample_rate', 'freedv_get_sync', 'freedv_get_rx_status', 'freedv_set_squelch_en', 'freedv_set_snr_squelch_thresh', 'freedv_set_sync', 'freedv_set_eq', 'freedv_get_modem_stats', 'freedv_set_clip', 'freedv_set_tx_bpf', 'freedv_get_bits_per_modem_frame', 'freedv_get_n_tx_modem_samples', 'freedv_rawdatatx', 'freedv_rawdatarx', 'freedv_set_frames_per_burst', 'freedv_set_tuning_range', 'freedv_gen_crc16', 'freedv_crc16_unpacked', 'freedv_rawdatapreambletx', 'freedv_rawdatapostambletx', 'freedv_get_n_tx_preamble_modem_samples', 'freedv_get_n_tx_postamble_modem_samples'];
        const options = ['-DFREEDV_MODE_2020_EN=0', '-DFREEDV_MODE_2020B_EN=0', '-DGIT_HASH="pinned-webrad"'];
        await EngineToolchain.compileCore(root, 'digital-voice', paths, [source, destination], exports, compiler, options, debug);
    }
}
