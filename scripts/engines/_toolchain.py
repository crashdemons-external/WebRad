"""Shared Emscripten build support for browser engine capabilities."""
from pathlib import Path
import argparse
import os
import shutil
import subprocess
import sys

REPO = Path(__file__).resolve().parents[2]


def unit_dir(root, leaf):
    path = REPO / 'build' / leaf / root.name
    path.mkdir(parents=True, exist_ok=True)
    return path


def generated_dir(root):
    return unit_dir(root, 'generated')


def objects_dir(root):
    return unit_dir(root, 'objects')


def wasm_dir(root):
    path = REPO / 'build' / 'wasm'
    path.mkdir(parents=True, exist_ok=True)
    return path


def compiler_for(root, sdk_path):
    env = os.environ.copy()
    executable = shutil.which('em++') or shutil.which('em++.bat')
    sdk = sdk_path or Path(env.get('EMSDK', str(REPO / '.tools/emsdk')))
    cache = REPO / 'build/emcache'
    env['EM_CACHE'] = str(cache)
    cache.mkdir(parents=True, exist_ok=True)
    if sdk_path or not executable:
        upstream = sdk.resolve() / 'upstream'
        compiler = upstream / 'emscripten/em++.py'
        if not compiler.is_file():
            raise SystemExit('Activate Emscripten or specify --emsdk PATH.')
        node = shutil.which('node')
        if not node:
            raise SystemExit('Emscripten requires Node.js.')
        config = REPO / 'build/generated/toolchain/emscripten-config.py'
        config.parent.mkdir(parents=True, exist_ok=True)
        config.write_text(
            f'LLVM_ROOT = {str(upstream / "bin")!r}\n'
            f'BINARYEN_ROOT = {str(upstream)!r}\n'
            f'NODE_JS = [{node!r}]\nCACHE = {str(cache)!r}\n',
            encoding='utf-8'
        )
        env['EM_CONFIG'] = str(config)
        return [sys.executable, str(compiler)], env, compiler.parent
    return [executable], env, Path(executable).resolve().parent


def finish_build(root, command, env, compiler_root, debug):
    del command, env, compiler_root, debug
    print(f'Built {root.name} in build/wasm.')


def run(root, build, prepare):
    parser = argparse.ArgumentParser(description=f'Build the {root.name} WASM engine.')
    parser.add_argument('--emsdk', type=Path, help='Path to an existing Emscripten SDK installation')
    parser.add_argument('--debug', action='store_true')
    parser.add_argument('--prepare-only', action='store_true', help='Generate portable sources without compiling')
    args = parser.parse_args()
    if args.prepare_only:
        prepare()
        print(f'Prepared {root.name}.')
        return
    command, env, compiler_root = compiler_for(root, args.emsdk)
    build(command, env, args.debug)
    finish_build(root, command, env, compiler_root, args.debug)
