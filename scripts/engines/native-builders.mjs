import { existsSync, readFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { ROOT } from '../tooling.mjs';
import { EngineToolchain } from './toolchain.mjs';
import { SourceText } from './source-text.mjs';
import { MultimodeSources } from './modems/multimode/prepare-browser-core.mjs';
import { SstvSources } from './slow-scan/analog-sstv/prepare-core.mjs';
import { QsstvSources } from './file-transfer/hamdrm/prepare-qsstv.mjs';
import { WefaxSources } from './weather-fax/weather-fax/prepare-wefax.mjs';

/** Native compiler recipes for the fldigi, MMSSTV, QSSTV and OpenJPEG engines. */
export class NativeBuilders {
    /** Source categories and preparation methods for the larger engines. */
    static units = {
        multimode: ['modems', MultimodeSources.prepare],
        'analog-sstv': ['slow-scan', SstvSources.prepare],
        hamdrm: ['file-transfer', QsstvSources.prepare],
        jpeg2000: ['image-codecs', (root) => NativeBuilders.prepareJpeg(root)],
        'weather-fax': ['weather-fax', WefaxSources.prepare]
    };

    /** Prepare the selected engine and retain its existing compile/link settings. */
    static async build(name, options = {}) {
        const recipe = NativeBuilders.units[name];
        if (!recipe) throw Error(`Unknown native engine: ${name}`);
        const root = join(ROOT, 'src/engines', recipe[0], name);
        const generated = recipe[1](root);
        if (options.prepareOnly) return;
        const compiler = EngineToolchain.compiler(options);
        switch (name) {
            case 'multimode': await NativeBuilders.multimode(root, generated, compiler, options.debug); break;
            case 'analog-sstv': await NativeBuilders.sstv(root, generated, compiler, options.debug); break;
            case 'hamdrm': await NativeBuilders.hamdrm(root, generated, compiler, options.debug); break;
            case 'jpeg2000': await NativeBuilders.jpeg(root, generated, compiler, options.debug); break;
            case 'weather-fax': await NativeBuilders.wefax(root, generated, compiler, options.debug); break;
        }
        console.log(`Built ${name} in build/wasm.`);
    }

    /** Compile fldigi in four parallel jobs, preserving translation-unit and public export order. */
    static async multimode(root, generated, compiler, debug = false) {
        const paths = MultimodeSources.sources.map((name) => {
            const copy = join(generated, basename(name));
            return existsSync(copy) ? copy : join(root, name);
        });
        paths.push(join(root, 'adapters/web_modem.cpp'), join(root, 'adapters/core_api.cpp'), join(generated, 'mode_table.cpp'));
        const flags = ['-I' + join(generated, 'include'), '-I' + join(root, 'adapters'), '-std=c++17',
            '-Wno-deprecated-declarations', '-Wno-unused-value', '-Wno-parentheses', '-Wno-vla-cxx-extension', '-fexceptions',
            ...(debug ? ['-O0', '-g3'] : ['-O3', '-g1'])];
        const objects = EngineToolchain.directory(root, 'objects');
        const version = await EngineToolchain.execute(compiler, ['--version'], root, true);
        const headers = [...SourceText.files(join(generated, 'include')).filter((path) => path.endsWith('.h')),
            ...SourceText.files(join(root, 'adapters'), false).filter((path) => path.endsWith('.h'))].sort();
        const headerHash = EngineToolchain.digest(version.stdout, ...headers.map((path) => readFileSync(path)));
        const built = await EngineToolchain.parallel(paths, async (source) => {
            const options = extname(source) === '.c' ? flags.filter((flag) => flag !== '-std=c++17').concat('-x', 'c', '-std=c99') : flags;
            const key = EngineToolchain.digest(readFileSync(source), headerHash, JSON.stringify(options)).slice(0, 16);
            const object = join(objects, basename(source, extname(source)) + '-' + key + '.o');
            if (!existsSync(object)) {
                try {
                    const result = await EngineToolchain.execute(compiler, [...options, '-c', source, '-o', object], root, true);
                    if (result.stdout.length || result.stderr.length) console.log(Buffer.concat([result.stdout, result.stderr]).toString());
                } catch (error) {
                    console.error(Buffer.concat([error.stdout || Buffer.alloc(0), error.stderr || Buffer.alloc(0)]).toString());
                    throw error;
                }
            }
            return object;
        });
        const exports = [
            '_web_create', '_web_process', '_web_set_frequency', '_web_set_option', '_web_sample_rate', '_web_frequency',
            '_web_metric', '_web_bandwidth', '_web_modes', '_web_take_text', '_web_take_secondary', '_web_status1',
            '_web_status2', '_web_spectrum', '_web_spectrum_size', '_web_reset', '_web_channels', '_web_phase',
            '_web_phase_quality', '_malloc', '_free', '_web_take_raster', '_web_raster_size', '_web_raster_height',
            '_web_image_channels', '_web_image_reverse', '_web_take_image_updates', '_web_image_updates_size',
            '_web_image_width', '_web_image_height', '_web_image_serial', '_web_flush', '_web_waterfall_geometry', '_web_scope',
            '_web_tx_supported', '_web_tx_begin', '_web_tx_append', '_web_tx_finish', '_web_tx_step', '_web_tx_buffer',
            '_web_tx_done', '_web_tx_ended', '_web_tx_cursor', '_web_tx_frequency', '_web_tx_image_supported',
            '_web_tx_image_begin', '_web_tx_image_progress', '_web_set_callsign'
        ];
        const args = [...flags, ...built, ...(debug ? ['-sASSERTIONS=1'] : []),
            '-sMODULARIZE=1', '-sEXPORT_ES6=1', '-sENVIRONMENT=web,worker,node', '-sALLOW_MEMORY_GROWTH=1',
            '-sINITIAL_MEMORY=33554432', '-sSTACK_SIZE=5242880', '-sEXPORTED_FUNCTIONS=' + JSON.stringify(exports),
            '-sEXPORTED_RUNTIME_METHODS=["UTF8ToString","HEAPF32","HEAPU8","HEAPU32"]', '-sFILESYSTEM=0',
            '-o', join(EngineToolchain.wasmDirectory(), 'multimode.js')];
        await EngineToolchain.execute(compiler, args, root);
    }

    /** Compile the MMSSTV receiver and image-to-audio encoder with the original exports. */
    static async sstv(root, generated, compiler, debug = false) {
        const names = ['init', 'reset', 'process', 'mode_count', 'mode_name', 'mode', 'width', 'height', 'pixels', 'sync_pixels', 'revision', 'serial', 'completed', 'receiving', 'line', 'level', 'afc', 'fsk', 'spectrum', 'option', 'redraw', 'finish', 'mode_width', 'mode_height', 'completed_pixels', 'completed_width', 'completed_height', 'completed_mode', 'completed_serial', 'completed_line', 'completed_fraction', 'mode_tx_height', 'encode_start', 'encode_read', 'encode_progress', 'encode_cancel'];
        const exports = [...names.map((name) => '_web_' + name), '_malloc', '_free'];
        const flags = ['-std=c++17', '-I' + join(root, 'adapters'), '-I' + generated,
            '-Wno-unknown-pragmas', '-Wno-unused-value', '-Wno-parentheses', '-Wno-delete-non-abstract-non-virtual-dtor',
            ...(debug ? ['-O1', '-g3', '-sASSERTIONS=2', '-sSAFE_HEAP=1'] : ['-O3']),
            '-sMODULARIZE=1', '-sEXPORT_NAME=createMMSSTV', '-sENVIRONMENT=web,worker,node',
            '-sALLOW_MEMORY_GROWTH=1', '-sINITIAL_MEMORY=33554432', '-sSTACK_SIZE=2097152', '-sFILESYSTEM=0',
            '-sEXPORTED_FUNCTIONS=' + JSON.stringify(exports), '-sEXPORTED_RUNTIME_METHODS=["UTF8ToString","HEAPF32","HEAPU8","HEAP32"]'];
        const files = [join(root, 'adapters/receiver.cpp'), join(root, 'adapters/encoder.cpp'),
            ...['sstv.cpp', 'fir.cpp', 'Fft.cpp'].map((name) => join(generated, name))];
        await EngineToolchain.execute(compiler, [...flags, ...files, '-o', join(EngineToolchain.wasmDirectory(), 'analog-sstv.js')], root);
    }

    /** Compile the QSSTV receiver, transmitter and Reed-Solomon boundary. */
    static async hamdrm(root, generated, compiler, debug = false) {
        const includes = [join(root, 'adapters'), generated, join(generated, 'utils'), join(generated, 'drmrx'), join(generated, 'drmtx/common')];
        const files = [join(root, 'adapters/modem.cpp'), join(generated, 'utils/rs.cpp'),
            ...SourceText.files(join(generated, 'drmtx/common')).filter((path) => path.endsWith('.cpp') && basename(path) !== 'csoundout.cpp'),
            ...QsstvSources.receiver.map((name) => join(generated, 'drmrx', name + '.cpp'))];
        const names = ['rx_reset', 'rx_process', 'rx_status', 'rx_snr', 'rx_offset', 'rx_call', 'rx_name', 'rx_file', 'rx_size', 'rx_bsr', 'rx_constellation', 'rx_constellation_count', 'tx_start', 'tx_read', 'tx_progress', 'tx_cancel', 'tx_fix', 'rs_encode', 'rs_file', 'rs_size'];
        const exports = [...names.map((name) => '_drm_' + name), '_malloc', '_free'];
        const flags = ['-std=c++17', '-DHAVE_STDINT_H=1', '-Wno-narrowing', '-Wno-constant-conversion', '-Wno-unused-value',
            ...includes.map((path) => '-I' + path), ...(debug ? ['-O1', '-g3', '-sASSERTIONS=2', '-sSAFE_HEAP=1'] : ['-O3']),
            '-sMODULARIZE=1', '-sEXPORT_NAME=createQSSTV', '-sENVIRONMENT=web,worker,node', '-sALLOW_MEMORY_GROWTH=1',
            '-sINITIAL_MEMORY=67108864', '-sSTACK_SIZE=4194304', '-sFILESYSTEM=0', '-sEXPORTED_FUNCTIONS=' + JSON.stringify(exports),
            '-sEXPORTED_RUNTIME_METHODS=["UTF8ToString","HEAPF32","HEAPU8","HEAP16"]'];
        await EngineToolchain.execute(compiler, [...flags, ...files, '-o', join(EngineToolchain.wasmDirectory(), 'hamdrm.js')], root);
    }

    /** Generate OpenJPEG's portable version and feature headers. */
    static prepareJpeg(root) {
        const config = EngineToolchain.directory(root, 'generated');
        SourceText.write(join(config, 'opj_config.h'), '#define OPJ_VERSION_MAJOR 2\n#define OPJ_VERSION_MINOR 5\n#define OPJ_VERSION_BUILD 4\n');
        SourceText.write(join(config, 'opj_config_private.h'), '#define OPJ_PACKAGE_VERSION "2.5.4"\n#define OPJ_HAVE_STDINT_H 1\n' +
            '#define OPJ_HAVE_INTTYPES_H 1\n#define OPJ_HAVE_FSEEKO 1\n#define OPJ_HAVE_POSIX_MEMALIGN 1\n');
        return config;
    }

    /** Compile the selected OpenJPEG library and its image buffer interface. */
    static async jpeg(root, config, compiler, debug = false) {
        const source = join(root, 'lib/openjp2');
        const names = 'thread bio cio dwt event ht_dec image invert j2k jp2 mct mqc openjpeg opj_clock pi t1 t2 tcd tgt function_list opj_malloc sparse_array'.split(' ');
        const exports = ['_jp2_decode', '_jp2_width', '_jp2_height', '_jp2_pixels', '_jp2_encode', '_jp2_file', '_malloc', '_free'];
        const flags = ['-x', 'c', '-std=c11', '-DOPJ_STATIC', '-D_POSIX_C_SOURCE=200112L', '-I' + source, '-I' + config,
            '-sMODULARIZE=1', '-sEXPORT_NAME=createJPEG2000', '-sENVIRONMENT=web,worker,node', '-sALLOW_MEMORY_GROWTH=1',
            '-sINITIAL_MEMORY=33554432', '-sSTACK_SIZE=2097152', '-sFILESYSTEM=0', '-sEXPORTED_FUNCTIONS=' + JSON.stringify(exports),
            '-sEXPORTED_RUNTIME_METHODS=["HEAPU8"]', ...(debug ? ['-O1', '-g3', '-sASSERTIONS=2', '-sSAFE_HEAP=1'] : ['-O3'])];
        const files = [join(root, 'adapters/jpeg2000.c'), ...names.map((name) => join(source, name + '.c'))];
        await EngineToolchain.execute(compiler, [...flags, ...files, '-o', join(EngineToolchain.wasmDirectory(), 'jpeg2000.js')], root);
    }

    /** Compile fldigi's standalone WEFAX DSP and streaming image/audio boundary. */
    static async wefax(root, generated, compiler, debug = false) {
        const files = [join(root, 'adapters/core.cpp'), join(root, 'adapters/web_modem.cpp'),
            ...['wefax.cxx', 'filters.cxx', 'fftfilt.cxx', 'strutil.cxx', 'mode_table.cpp'].map((name) => join(generated, name))];
        const names = 'reset process option finish state detected width height line serial revision completed pixels finished_pixels finished_width finished_height finished_mode finished_serial level frequency spectrum encode_start encode_read encode_done encode_progress encode_cancel'.split(' ');
        const exports = [...names.map((name) => '_fax_' + name), '_malloc', '_free'];
        const flags = ['-std=c++17', '-I' + join(root, 'adapters'), '-I' + join(generated, 'include'), '-Wno-unused-value',
            ...(debug ? ['-O1', '-g3', '-sASSERTIONS=2', '-sSAFE_HEAP=1'] : ['-O3']),
            '-sMODULARIZE=1', '-sEXPORT_NAME=createWEFAX', '-sENVIRONMENT=web,worker,node', '-sALLOW_MEMORY_GROWTH=1',
            '-sINITIAL_MEMORY=33554432', '-sSTACK_SIZE=2097152', '-sFILESYSTEM=0', '-sEXPORTED_FUNCTIONS=' + JSON.stringify(exports),
            '-sEXPORTED_RUNTIME_METHODS=["HEAPF32","HEAPU8","HEAP32"]'];
        await EngineToolchain.execute(compiler, [...flags, ...files, '-o', join(EngineToolchain.wasmDirectory(), 'weather-fax.js')], root);
    }
}
