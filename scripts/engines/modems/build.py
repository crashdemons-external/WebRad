"""Compile the selected modem engines for the browser."""
from pathlib import Path
import argparse
import concurrent.futures
import hashlib
import json
import re
import subprocess
import sys
sys.dont_write_bytecode = True
REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from _toolchain import compiler_for, generated_dir, objects_dir, wasm_dir

UNITS = ['weak-signal', 'sound-messages', 'signaling', 'packet-radio', 'digital-voice', 'sensor-radio']


def compile_core(root, name, paths, includes, exports, command, env, extra=(), debug=False):
    objects = objects_dir(root)
    flags = [
        '-Wno-deprecated-declarations', '-Wno-format', '-Wno-constant-conversion',
        *['-I' + str(path) for path in includes], *extra
    ]
    flags += ['-O0', '-g3', '-sASSERTIONS=2', '-sSAFE_HEAP=1'] if debug else ['-O3']
    digest = hashlib.sha256()
    digest.update(subprocess.check_output(command + ['--version'], env=env, cwd=root))
    for directory in includes:
        if directory.exists():
            for path in sorted(directory.rglob('*.h')):
                digest.update(path.read_bytes())

    def compile_source(path):
        options = flags + (['-x', 'c', '-std=gnu11'] if path.suffix == '.c' else ['-std=c++17'])
        key = hashlib.sha256(path.read_bytes() + digest.digest() + repr(options).encode()).hexdigest()[:16]
        output = objects / (path.stem + '-' + key + '.o')
        if not output.exists():
            result = subprocess.run(
                command + options + ['-c', str(path), '-o', str(output)],
                env=env,
                cwd=root,
                capture_output=True,
                text=True
            )
            if result.returncode:
                (objects / (path.stem + '-error.log')).write_text(result.stdout + result.stderr, encoding='utf-8')
                print((result.stdout + result.stderr)[:1600])
                return None
        return output

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        objects_built = list(pool.map(compile_source, paths))
    if any(path is None for path in objects_built):
        raise SystemExit('Compilation failed: ' + name)

    runtime = [
        '-sMODULARIZE=1', '-sEXPORT_ES6=1', '-sENVIRONMENT=web,worker,node', '-sALLOW_MEMORY_GROWTH=1',
        '-sSTACK_SIZE=8388608', '-sINITIAL_MEMORY=33554432', '-sFILESYSTEM=0',
        '-sEXPORTED_FUNCTIONS=' + json.dumps(['_malloc', '_free', *['_' + export for export in exports]]),
        '-sEXPORTED_RUNTIME_METHODS=["UTF8ToString","HEAPU8","HEAPF32","HEAP16","HEAP32"]'
    ]
    output = wasm_dir(root) / (name + '.js')
    response = objects / 'objects.rsp'
    response.write_text('\n'.join('"' + path.as_posix() + '"' for path in objects_built), encoding='utf-8')
    subprocess.run(command + flags + ['@' + str(response), *runtime, '-o', str(output)], env=env, check=True, cwd=root)
    print('Built ' + name, flush=True)


def prepare_sensor(root):
    source = root
    generated = generated_dir(root)
    native = root / 'adapters/sensor-radio'
    device_files = [path for path in sorted((source / 'src/devices').glob('*.c')) if path.name != 'flex.c']
    declared = set()
    for path in device_files:
        declarations = re.findall(
            r'r_device\s+const\s+(\w+)\s*=|const\s+r_device\s+(\w+)\s*=',
            path.read_text(encoding='utf-8')
        )
        declared.update(declarations)
    declared = {first or second for first, second in declared}
    header = (source / 'include/rtl_433_devices.h').read_text(encoding='utf-8')
    declarations = header.split('#define DEVICES')[1].split('#define DECL')[0]
    ids = [(index + 1, name) for index, name in enumerate(re.findall(r'DECL\((\w+)\)', declarations)) if name in declared]
    catalog = '\n'.join('extern r_device const ' + name + ';' for _, name in ids)
    catalog += '\nstatic const r_device *sensor_catalog[]={' + ','.join('&' + name for _, name in ids) + '};\n'
    catalog += 'static int sensor_ids[]={' + ','.join(str(index) for index, _ in ids) + '};\n'
    path = generated / 'sensor-catalog.h'
    path.write_text(catalog, encoding='utf-8')
    return device_files


def prepare_unit(name):
    root = REPO / 'src/engines/modems' / name
    generated = generated_dir(root)
    if name == 'weak-signal':
        demo = (root / 'gen_ft8.c').read_text(encoding='utf-8')
        (generated / 'gfsk.c').write_text(demo.split('void usage()')[0], encoding='utf-8')
    elif name == 'packet-radio':
        source = (root / 'src/decode_aprs.c').read_text(encoding='utf-8')
        start = source.index('static void aprs_raw_nmea (decode_aprs_t *A, unsigned char *info, int ilen)')
        body = source.index('{', start)
        end = source.index('} /* end aprs_raw_nmea */', body) + 1
        source = source[:body] + '{ strlcpy(A->g_data_type_desc, "Raw GPS sentence (shown without interpretation)", sizeof(A->g_data_type_desc)); }' + source[end:]
        (generated / 'decode_aprs.c').write_text(source, encoding='utf-8')
    elif name == 'sensor-radio':
        prepare_sensor(root)
    elif name == 'digital-voice':
        from build_voice import prepare_voice

        prepare_voice(root)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--emsdk', type=Path)
    parser.add_argument('--engine', choices=['all', *UNITS], default='all')
    parser.add_argument('--debug', action='store_true')
    parser.add_argument('--prepare-only', action='store_true')
    args = parser.parse_args()
    selected = UNITS if args.engine == 'all' else [args.engine]
    if args.prepare_only:
        for name in selected:
            prepare_unit(name)
        print('Prepared ' + ', '.join(selected) + '.')
        return
    for name in selected:
        root = REPO / 'src/engines/modems' / name
        prepare_unit(name)
        command, env, _ = compiler_for(root, args.emsdk)
        source = root
        native = root / 'adapters'
        if name == 'weak-signal':
            ft8 = source / 'ft8'
            generated = generated_dir(root) / 'gfsk.c'
            paths = [*sorted(ft8.glob('*.c')), source / 'fft/kiss_fft.c', source / 'fft/kiss_fftr.c',
                     source / 'common/monitor.c', generated, native / 'weak-signal.c']
            compile_core(root, name, paths, [source], ['wr_encode', 'wr_audio', 'wr_decode'], command, env, debug=args.debug)
        elif name == 'sound-messages':
            paths = [source / 'src/ggwave.cpp', native / 'sound-messages.cpp']
            compile_core(root, name, paths, [source / 'include', source / 'src'],
                         ['wr_init', 'wr_encode', 'wr_audio', 'wr_process'], command, env, debug=args.debug)
        elif name == 'signaling':
            names = ['uart', 'pocsag', 'selcall', 'hdlc', 'costabi', 'costabf', 'clip', 'fms', 'cJSON', 'bch',
                     'gen_pocsag', 'gen_flex', 'gen_dtmf', 'gen_zvei']
            paths = [*sorted(source.glob('demod_*.c')), *[source / (item + '.c') for item in names], native / 'signaling.c']
            paths = [path for path in paths if path.name not in ['demod_display.c', 'demod_sdl_scope.c']]
            exports = ['wr_count', 'wr_name', 'wr_rate', 'wr_option', 'wr_init', 'wr_process', 'wr_tx_start', 'wr_tx_read']
            options = ['-DNO_X11', '-DNO_SDL3', '-DUSE_BUILTIN_POPCOUNT', '-DMAX_VERBOSE_LEVEL=0']
            compile_core(root, name, paths, [source], exports, command, env, options, args.debug)
        elif name == 'packet-radio':
            source_dir = source / 'src'
            names = [
                'multi_modem', 'demod', 'demod_afsk', 'demod_psk', 'demod_9600', 'dsp', 'fsk_demod_state',
                'hdlc_rec', 'hdlc_rec2', 'hdlc_send', 'ax25_pad', 'fcs_calc', 'gen_tone', 'fx25_init', 'fx25_rec',
                'fx25_send', 'fx25_encode', 'fx25_decode', 'il2p_init', 'il2p_rec', 'il2p_send', 'il2p_payload',
                'il2p_scramble', 'il2p_header', 'il2p_codec', 'il2p_encode', 'il2p_decode', 'textcolor', 'dtime',
                'audio_stats', 'rrbb', 'ais', 'encode_aprs', 'latlong', 'symbols', 'telemetry', 'deviceid'
            ]
            paths = [source_dir / (item + '.c') for item in names if (source_dir / (item + '.c')).exists()]
            paths += [source_dir / 'dtime_now.c', source_dir / 'ax25_pad2.c', source_dir / 'fx25_extract.c',
                      source / 'external/misc/strlcpy.c', source / 'external/misc/strlcat.c', native / 'packet-radio.c']
            paths = [path for path in paths if path.exists()]
            paths += [generated_dir(root) / 'decode_aprs.c']
            exports = ['wr_init', 'wr_process', 'wr_encode', 'wr_audio', 'wr_audio_size', 'wr_option', 'wr_aprs_position']
            options = ['-include', 'string.h', '-DMAJOR_VERSION=1', '-DMINOR_VERSION=8', '-DUSE_REGEX', '-D__EMSCRIPTEN__']
            compile_core(root, name, paths, [source_dir, native / 'packet-radio'], exports, command, env, options, args.debug)
        elif name == 'digital-voice':
            from build_voice import build_voice

            build_voice(root, command, env, compile_core, args.debug)
        elif name == 'sensor-radio':
            source_dir = source / 'src'
            device_files = [path for path in sorted((source_dir / 'devices').glob('*.c')) if path.name != 'flex.c']
            generated = generated_dir(root)
            names = ['bitbuffer', 'bit_util', 'data', 'decoder_util', 'abuf', 'pulse_slicer', 'pulse_detect',
                     'pulse_detect_fsk', 'baseband']
            paths = [*[source_dir / (item + '.c') for item in names], *device_files, native / 'sensor-radio.c']
            exports = ['wr_init', 'wr_count', 'wr_name', 'wr_protocol', 'wr_disabled', 'wr_decode', 'wr_events', 'wr_iq', 'wr_option']
            compile_core(root, name, paths, [source / 'include', native / 'sensor-radio', generated], exports,
                         command, env, ['-DHAVE_CONFIG_H'], args.debug)


if __name__ == '__main__':
    main()
