"""Generate the Codec2 tables and compile its browser engine."""
from pathlib import Path
import math
import re
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from _toolchain import generated_dir


def prepare_voice(root):
    source = root / 'src'
    destination = generated_dir(root) / 'voice-generated'
    destination.mkdir(parents=True, exist_ok=True)
    (destination / 'codec2').mkdir(exist_ok=True)
    (destination / 'codec2/version.h').write_text(
        '#define CODEC2_VERSION_MAJOR 1\n#define CODEC2_VERSION_MINOR 2\n'
        '#define CODEC2_VERSION_PATCH 0\n#define CODEC2_VERSION "1.2.0"\n',
        encoding='utf-8'
    )
    groups = {
        'codebook': ('lsp_cb', [f'lsp{i}.txt' for i in range(1, 11)]),
        'codebookd': ('lsp_cbd', [f'dlsp{i}.txt' for i in range(1, 11)]),
        'codebookjmv': ('lsp_cbjmv', [f'lspjmv{i}.txt' for i in range(1, 4)]),
        'codebookge': ('ge_cb', ['gecb.txt']),
        'codebooknewamp1': ('newamp1vq_cb', ['train_120_1.txt', 'train_120_2.txt']),
        'codebooknewamp1_energy': ('newamp1_energy_cb', ['newamp1_energy_q.txt']),
        'codebooknewamp2': ('newamp2vq_cb', ['codes_450.txt']),
        'codebooknewamp2_energy': ('newamp2_energy_cb', ['newamp2_energy_q.txt'])
    }
    for filename, (symbol, files) in groups.items():
        code = ['/* Generated from the pinned Codec2 tables. LGPL-2.1. */', '#include "defines.h"']
        structures = []
        for index, name in enumerate(files):
            text = '\n'.join(line.split('#')[0] for line in (source / 'codebook' / name).read_text().splitlines())
            numbers = re.findall(r'[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?', text)
            rows, columns = map(int, numbers[:2])
            values = numbers[2:]
            assert len(values) == rows * columns, (name, len(values), rows * columns)
            code.append(f'static float codes{index}[]={{' + ','.join(values) + '};')
            structures.append('{' + f'{rows},{round(math.log2(columns))},{columns},codes{index}' + '}')
        code.append(f'const struct lsp_codebook {symbol}[]={{' + ','.join(structures) + ',{0,0,0,0}};')
        (destination / (filename + '.c')).write_text('\n'.join(code), encoding='utf-8')

    cmake_path = Path(__file__).resolve().parent / 'digital-voice/CMakeLists.txt'
    cmake = cmake_path.read_text(encoding='utf-8')
    source_block = re.search(r'set\(CODEC2_SRCS(.*?)\)', cmake, re.S)
    names = list(dict.fromkeys(source_block.group(1).split()))
    paths = [source / name if (source / name).exists() else destination / name for name in names]
    paths = [path for path in paths if path.name != 'freedv_2020.c']
    return source, destination, paths

def build_voice(root, command, env, compile_core, debug=False):
    source, destination, paths = prepare_voice(root)
    exports = [
        'freedv_open_advanced', 'codec2_create', 'codec2_destroy', 'codec2_encode', 'codec2_decode',
        'codec2_samples_per_frame', 'codec2_bits_per_frame', 'codec2_bytes_per_frame',
        'codec2_set_natural_or_gray', 'codec2_set_lpc_post_filter', 'codec2_700c_post_filter', 'codec2_700c_eq',
        'freedv_open', 'freedv_close', 'freedv_tx', 'freedv_rx', 'freedv_nin', 'freedv_get_n_speech_samples',
        'freedv_get_n_max_speech_samples', 'freedv_get_n_max_modem_samples', 'freedv_get_n_nom_modem_samples',
        'freedv_get_modem_sample_rate', 'freedv_get_speech_sample_rate', 'freedv_get_sync',
        'freedv_get_rx_status', 'freedv_set_squelch_en', 'freedv_set_snr_squelch_thresh', 'freedv_set_sync',
        'freedv_set_eq', 'freedv_get_modem_stats', 'freedv_set_clip', 'freedv_set_tx_bpf',
        'freedv_get_bits_per_modem_frame', 'freedv_get_n_tx_modem_samples', 'freedv_rawdatatx',
        'freedv_rawdatarx', 'freedv_set_frames_per_burst', 'freedv_set_tuning_range', 'freedv_gen_crc16',
        'freedv_crc16_unpacked', 'freedv_rawdatapreambletx', 'freedv_rawdatapostambletx',
        'freedv_get_n_tx_preamble_modem_samples', 'freedv_get_n_tx_postamble_modem_samples'
    ]
    options = ['-DFREEDV_MODE_2020_EN=0', '-DFREEDV_MODE_2020B_EN=0', '-DGIT_HASH="pinned-webrad"']
    compile_core(root, 'digital-voice', paths, [source, destination], exports, command, env, options, debug)
