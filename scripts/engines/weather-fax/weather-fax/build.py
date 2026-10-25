"""Compile the selected fldigi WEFAX DSP for the browser."""
from pathlib import Path
import json
import subprocess
from prepare_wefax import prepare, ROOT

import sys
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from _toolchain import generated_dir, run, wasm_dir


def build(command, env, debug=False):
    destination = prepare()
    files = [ROOT / 'adapters/core.cpp', ROOT / 'adapters/web_modem.cpp']
    files += [destination / name for name in ['wefax.cxx', 'filters.cxx', 'fftfilt.cxx', 'strutil.cxx', 'mode_table.cpp']]
    names = 'reset process option finish state detected width height line serial revision completed pixels finished_pixels finished_width finished_height finished_mode finished_serial level frequency spectrum encode_start encode_read encode_done encode_progress encode_cancel'.split()
    flags = ['-std=c++17', '-I' + str(ROOT / 'adapters'), '-I' + str(destination / 'include'), '-Wno-unused-value']
    flags += ['-O1', '-g3', '-sASSERTIONS=2', '-sSAFE_HEAP=1'] if debug else ['-O3']
    exports = ['_fax_' + name for name in names] + ['_malloc', '_free']
    flags += [
        '-sMODULARIZE=1', '-sEXPORT_NAME=createWEFAX', '-sENVIRONMENT=web,worker,node',
        '-sALLOW_MEMORY_GROWTH=1', '-sINITIAL_MEMORY=33554432', '-sSTACK_SIZE=2097152', '-sFILESYSTEM=0',
        '-sEXPORTED_FUNCTIONS=' + json.dumps(exports), '-sEXPORTED_RUNTIME_METHODS=["HEAPF32","HEAPU8","HEAP32"]'
    ]
    output = wasm_dir(ROOT) / 'weather-fax.js'
    subprocess.run(command + flags + [str(path) for path in files] + ['-o', str(output)], env=env, check=True, cwd=ROOT)


if __name__ == '__main__':
    run(ROOT, build, prepare)
