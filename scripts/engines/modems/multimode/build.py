"""Compile the multimode decoder and encoder for the browser."""
from pathlib import Path
from prepare_browser_core import SOURCES, main as prepare
import json
import subprocess
import concurrent.futures
import hashlib


import sys
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from _toolchain import generated_dir, objects_dir, run, wasm_dir

REPO = Path(__file__).resolve().parents[4]
ROOT = REPO / 'src/engines' / Path(__file__).resolve().parents[1].name / Path(__file__).resolve().parents[0].name


def build(compiler, env, debug=False):
    prepare()
    paths = [ROOT / p for p in SOURCES]
    paths = [generated_dir(ROOT) / p.name if (generated_dir(ROOT) / p.name).exists() else p for p in paths]
    paths += [ROOT / 'adapters/web_modem.cpp', ROOT / 'adapters/core_api.cpp', generated_dir(ROOT) / 'mode_table.cpp']
    flags = ['-I' + str(generated_dir(ROOT) / 'include'), '-I' + str(ROOT / 'adapters'), '-std=c++17', '-Wno-deprecated-declarations', '-Wno-unused-value', '-Wno-parentheses', '-Wno-vla-cxx-extension', '-fexceptions']
    flags += ['-O0', '-g3'] if debug else ['-O3', '-g1']
    objdir = objects_dir(ROOT)
    objdir.mkdir(exist_ok=True)
    header_hash = hashlib.sha256()
    header_hash.update(subprocess.check_output(compiler+['--version'],env=env,cwd=ROOT))
    headers = list((generated_dir(ROOT) / 'include').rglob('*.h')) + list((ROOT / 'adapters').glob('*.h'))
    for header in sorted(headers):
        header_hash.update(header.read_bytes())

    def compile_source(source):
        source_flags = flags
        if source.suffix == '.c':
            source_flags = [flag for flag in flags if flag != '-std=c++17'] + ['-x', 'c', '-std=c99']
        key = hashlib.sha256(source.read_bytes() + header_hash.digest() + repr(source_flags).encode()).hexdigest()
        obj = objdir / (source.stem + '-' + key[:16] + '.o')
        if obj.exists():
            return obj, ''
        result = subprocess.run(
            compiler + source_flags + ['-c', str(source), '-o', str(obj)],
            env=env,
            cwd=ROOT,
            capture_output=True,
            text=True
        )
        return (obj if result.returncode == 0 else None), result.stdout + result.stderr

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(compile_source, paths))
    for _, output in results:
        if output:
            print(output)
    if any(obj is None for obj, _ in results):
        raise SystemExit(1)
    cmd = compiler + flags + [str(obj) for obj, _ in results]
    if debug:
        cmd += ['-sASSERTIONS=1']
    exports = [
        '_web_create', '_web_process', '_web_set_frequency', '_web_set_option', '_web_sample_rate', '_web_frequency',
        '_web_metric', '_web_bandwidth', '_web_modes', '_web_take_text', '_web_take_secondary', '_web_status1',
        '_web_status2', '_web_spectrum', '_web_spectrum_size', '_web_reset', '_web_channels', '_web_phase',
        '_web_phase_quality', '_malloc', '_free'
    ]
    exports += ['_web_take_raster', '_web_raster_size', '_web_raster_height']
    exports += ['_web_image_channels', '_web_image_reverse']
    exports += ['_web_take_image_updates', '_web_image_updates_size', '_web_image_width', '_web_image_height', '_web_image_serial']
    exports += ['_web_flush', '_web_waterfall_geometry', '_web_scope']
    exports += ['_web_tx_supported', '_web_tx_begin', '_web_tx_append', '_web_tx_finish', '_web_tx_step', '_web_tx_buffer', '_web_tx_done', '_web_tx_ended', '_web_tx_cursor', '_web_tx_frequency']
    exports += ['_web_tx_image_supported', '_web_tx_image_begin', '_web_tx_image_progress']
    exports += ['_web_set_callsign']
    cmd += [
        '-sMODULARIZE=1', '-sEXPORT_ES6=1', '-sENVIRONMENT=web,worker,node', '-sALLOW_MEMORY_GROWTH=1',
        '-sINITIAL_MEMORY=33554432', '-sSTACK_SIZE=5242880', '-sEXPORTED_FUNCTIONS=' + json.dumps(exports),
        '-sEXPORTED_RUNTIME_METHODS=["UTF8ToString","HEAPF32","HEAPU8","HEAPU32"]', '-sFILESYSTEM=0',
        '-o', str(wasm_dir(ROOT) / 'multimode.js')
    ]
    wasm_dir(ROOT).mkdir(exist_ok=True)
    print('Building the original fldigi decoder sources with Emscripten...')
    result = subprocess.run(cmd, env=env, cwd=ROOT)
    if result.returncode:
        raise SystemExit(result.returncode)


if __name__ == '__main__':
    run(ROOT, build, prepare)
