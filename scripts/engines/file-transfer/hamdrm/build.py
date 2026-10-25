"""Compile the QSSTV DSP sources for the browser."""
from pathlib import Path
import json
import subprocess
from prepare_qsstv import prepare, RX, ROOT

import sys
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from _toolchain import generated_dir, run, wasm_dir


def build(command, env, debug=False):
    destination = prepare()
    includes = [ROOT / 'adapters', destination, destination / 'utils', destination / 'drmrx', destination / 'drmtx/common']
    files = [ROOT / 'adapters/modem.cpp', destination / 'utils/rs.cpp']
    files += [path for path in (destination / 'drmtx/common').rglob('*.cpp') if path.name != 'csoundout.cpp']
    files += [destination / 'drmrx' / (name + '.cpp') for name in RX]
    names = [
        'rx_reset', 'rx_process', 'rx_status', 'rx_snr', 'rx_offset', 'rx_call', 'rx_name', 'rx_file',
        'rx_size', 'rx_bsr', 'rx_constellation', 'rx_constellation_count', 'tx_start', 'tx_read',
        'tx_progress', 'tx_cancel', 'tx_fix', 'rs_encode', 'rs_file', 'rs_size'
    ]
    exports = ['_drm_' + name for name in names] + ['_malloc', '_free']
    flags = ['-std=c++17', '-DHAVE_STDINT_H=1', '-Wno-narrowing', '-Wno-constant-conversion', '-Wno-unused-value']
    flags += ['-I' + str(path) for path in includes]
    flags += ['-O1', '-g3', '-sASSERTIONS=2', '-sSAFE_HEAP=1'] if debug else ['-O3']
    flags += [
        '-sMODULARIZE=1', '-sEXPORT_NAME=createQSSTV', '-sENVIRONMENT=web,worker,node',
        '-sALLOW_MEMORY_GROWTH=1', '-sINITIAL_MEMORY=67108864', '-sSTACK_SIZE=4194304', '-sFILESYSTEM=0',
        '-sEXPORTED_FUNCTIONS=' + json.dumps(exports),
        '-sEXPORTED_RUNTIME_METHODS=["UTF8ToString","HEAPF32","HEAPU8","HEAP16"]'
    ]
    output = wasm_dir(ROOT) / 'hamdrm.js'
    subprocess.run(command + flags + [str(path) for path in files] + ['-o', str(output)], env=env, check=True, cwd=ROOT)

if __name__ == '__main__':
    run(ROOT, build, prepare)
