"""Build the selected OpenJPEG library sources for the browser."""
from pathlib import Path
import json
import subprocess
import sys
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from _toolchain import generated_dir, run, wasm_dir

REPO = Path(__file__).resolve().parents[4]
ROOT = REPO / 'src/engines' / Path(__file__).resolve().parents[1].name / Path(__file__).resolve().parents[0].name


def prepare():
    source = ROOT / 'lib/openjp2'
    config = generated_dir(ROOT)
    config.mkdir(parents=True, exist_ok=True)
    (config / 'opj_config.h').write_text(
        '#define OPJ_VERSION_MAJOR 2\n#define OPJ_VERSION_MINOR 5\n#define OPJ_VERSION_BUILD 4\n'
    )
    (config / 'opj_config_private.h').write_text(
        '#define OPJ_PACKAGE_VERSION "2.5.4"\n#define OPJ_HAVE_STDINT_H 1\n'
        '#define OPJ_HAVE_INTTYPES_H 1\n#define OPJ_HAVE_FSEEKO 1\n#define OPJ_HAVE_POSIX_MEMALIGN 1\n'
    )
    names = 'thread bio cio dwt event ht_dec image invert j2k jp2 mct mqc openjpeg opj_clock pi t1 t2 tcd tgt function_list opj_malloc sparse_array'.split()
    for name in names:
        path = source / (name + '.c')
        if not path.is_file():
            raise FileNotFoundError(path)
    return source, config, names


def build(command, env, debug=False):
    source, config, names = prepare()
    exports = ['_jp2_' + name for name in ['decode', 'width', 'height', 'pixels', 'encode', 'file']]
    exports += ['_malloc', '_free']
    flags = [
        '-x', 'c', '-std=c11', '-DOPJ_STATIC', '-D_POSIX_C_SOURCE=200112L',
        '-I' + str(source), '-I' + str(config), '-sMODULARIZE=1', '-sEXPORT_NAME=createJPEG2000',
        '-sENVIRONMENT=web,worker,node', '-sALLOW_MEMORY_GROWTH=1', '-sINITIAL_MEMORY=33554432',
        '-sSTACK_SIZE=2097152', '-sFILESYSTEM=0', '-sEXPORTED_FUNCTIONS=' + json.dumps(exports),
        '-sEXPORTED_RUNTIME_METHODS=["HEAPU8"]'
    ]
    flags += ['-O1', '-g3', '-sASSERTIONS=2', '-sSAFE_HEAP=1'] if debug else ['-O3']
    files = [ROOT / 'adapters/jpeg2000.c'] + [source / (name + '.c') for name in names]
    output = wasm_dir(ROOT) / 'jpeg2000.js'
    subprocess.run(command + flags + [str(path) for path in files] + ['-o', str(output)], env=env, check=True, cwd=ROOT)


if __name__ == '__main__':
    run(ROOT, build, prepare)
