"""Build the original MMSSTV analog slow-scan DSP with Emscripten."""
from pathlib import Path
import json
import subprocess
from prepare_core import prepare

import sys
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from _toolchain import run, generated_dir, objects_dir, wasm_dir

REPO = Path(__file__).resolve().parents[4]
ROOT = REPO / 'src/engines' / Path(__file__).resolve().parents[1].name / Path(__file__).resolve().parents[0].name


def build(command, env, debug=False):
    prepare()
    names = [
        'init', 'reset', 'process', 'mode_count', 'mode_name', 'mode', 'width', 'height',
        'pixels', 'sync_pixels', 'revision', 'serial', 'completed', 'receiving', 'line',
        'level', 'afc', 'fsk', 'spectrum', 'option', 'redraw', 'finish', 'mode_width', 'mode_height',
        'completed_pixels', 'completed_width', 'completed_height', 'completed_mode', 'completed_serial',
        'completed_line', 'completed_fraction', 'mode_tx_height', 'encode_start', 'encode_read',
        'encode_progress', 'encode_cancel'
    ]
    exports = ['_web_' + name for name in names] + ['_malloc', '_free']
    flags = [
        '-std=c++17', '-I' + str(ROOT / 'adapters'), '-I' + str(generated_dir(ROOT)),
        '-Wno-unknown-pragmas', '-Wno-unused-value', '-Wno-parentheses', '-Wno-delete-non-abstract-non-virtual-dtor'
    ]
    flags += ['-O1', '-g3', '-sASSERTIONS=2', '-sSAFE_HEAP=1'] if debug else ['-O3']
    files = [ROOT / 'adapters/receiver.cpp', ROOT / 'adapters/encoder.cpp'] + [generated_dir(ROOT) / name for name in ['sstv.cpp', 'fir.cpp', 'Fft.cpp']]
    # Emit the JavaScript loader and WebAssembly files under build/wasm.
    flags += [
        '-sMODULARIZE=1', '-sEXPORT_NAME=createMMSSTV', '-sENVIRONMENT=web,worker,node',
        '-sALLOW_MEMORY_GROWTH=1', '-sINITIAL_MEMORY=33554432', '-sSTACK_SIZE=2097152',
        '-sFILESYSTEM=0', '-sEXPORTED_FUNCTIONS=' + json.dumps(exports),
        '-sEXPORTED_RUNTIME_METHODS=["UTF8ToString","HEAPF32","HEAPU8","HEAP32"]'
    ]
    subprocess.run(command + flags + [str(p) for p in files] + ['-o', str(wasm_dir(ROOT) / 'analog-sstv.js')], env=env, check=True, cwd=ROOT)


if __name__ == '__main__':
    run(ROOT, build, prepare)
