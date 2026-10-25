import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { ROOT } from '../../tooling.mjs';
import { EngineToolchain } from '../toolchain.mjs';
import { SourceText } from '../source-text.mjs';
import { VoiceBuilder } from './build-voice.mjs';

/** Builds packet, weak-signal, sound, signaling, voice and sensor engines. */
export class ModemBuilder {
    /** Engine units sharing the focused compiler recipe. */
    static units = ['weak-signal', 'sound-messages', 'signaling', 'packet-radio', 'digital-voice', 'sensor-radio'];

    /** Preserve native sensor protocol IDs while excluding the unsupported FLEX device source. */
    static prepareSensor(root) {
        const generated = EngineToolchain.directory(root, 'generated');
        const files = SourceText.files(join(root, 'src/devices'), false)
            .filter((path) => path.endsWith('.c') && basename(path) !== 'flex.c').sort();
        const declared = new Set();
        for (const path of files) {
            const source = SourceText.read(path);
            for (const match of source.matchAll(/r_device\s+const\s+(\w+)\s*=|const\s+r_device\s+(\w+)\s*=/g))
                declared.add(match[1] || match[2]);
        }
        const header = SourceText.read(join(root, 'include/rtl_433_devices.h')).split('#define DEVICES')[1].split('#define DECL')[0];
        const ids = [...header.matchAll(/DECL\((\w+)\)/g)].map((match, index) => [index + 1, match[1]])
            .filter(([, name]) => declared.has(name));
        let catalog = ids.map(([, name]) => 'extern r_device const ' + name + ';').join('\n');
        catalog += '\nstatic const r_device *sensor_catalog[]={' + ids.map(([, name]) => '&' + name).join(',') + '};\n';
        catalog += 'static int sensor_ids[]={' + ids.map(([index]) => index).join(',') + '};\n';
        SourceText.write(join(generated, 'sensor-catalog.h'), catalog);
        return files;
    }

    /** Prepare the selected native subset before compiling it. */
    static prepare(name, root = join(ROOT, 'src/engines/modems', name)) {
        const generated = EngineToolchain.directory(root, 'generated');
        switch (name) {
            case 'weak-signal':
                SourceText.write(join(generated, 'gfsk.c'), SourceText.read(join(root, 'gen_ft8.c')).split('void usage()')[0]);
                break;
            case 'packet-radio': {
                let source = SourceText.read(join(root, 'src/decode_aprs.c'));
                const start = SourceText.index(source, 'static void aprs_raw_nmea (decode_aprs_t *A, unsigned char *info, int ilen)');
                const body = SourceText.index(source, '{', start);
                const end = SourceText.index(source, '} /* end aprs_raw_nmea */', body) + 1;
                source = source.slice(0, body) + '{ strlcpy(A->g_data_type_desc, "Raw GPS sentence (shown without interpretation)", sizeof(A->g_data_type_desc)); }' + source.slice(end);
                SourceText.write(join(generated, 'decode_aprs.c'), source);
                break;
            }
            case 'sensor-radio':
                ModemBuilder.prepareSensor(root);
                break;
            case 'digital-voice':
                VoiceBuilder.prepare(root);
                break;
        }
        return generated;
    }

    /** Resolve the native sources, include directories and public exports for one engine. */
    static recipe(name, root, generated) {
        const native = join(root, 'adapters');
        const source = join(root, 'src');
        switch (name) {
            case 'weak-signal':
                return {
                    paths: [...SourceText.files(join(root, 'ft8'), false).filter((path) => path.endsWith('.c')).sort(),
                        join(root, 'fft/kiss_fft.c'), join(root, 'fft/kiss_fftr.c'), join(root, 'common/monitor.c'),
                        join(generated, 'gfsk.c'), join(native, 'weak-signal.c')],
                    includes: [root], exports: ['wr_encode', 'wr_audio', 'wr_decode']
                };
            case 'sound-messages':
                return {
                    paths: [join(root, 'src/ggwave.cpp'), join(native, 'sound-messages.cpp')],
                    includes: [join(root, 'include'), source], exports: ['wr_init', 'wr_encode', 'wr_audio', 'wr_process']
                };
            case 'signaling': {
                const names = ['uart', 'pocsag', 'selcall', 'hdlc', 'costabi', 'costabf', 'clip', 'fms', 'cJSON', 'bch',
                    'gen_pocsag', 'gen_flex', 'gen_dtmf', 'gen_zvei'];
                return {
                    paths: [...SourceText.files(root, false).filter((path) => /^demod_.*\.c$/.test(basename(path))).sort(),
                        ...names.map((item) => join(root, item + '.c')), join(native, 'signaling.c')]
                        .filter((path) => !['demod_display.c', 'demod_sdl_scope.c'].includes(basename(path))),
                    includes: [root],
                    exports: ['wr_count', 'wr_name', 'wr_rate', 'wr_option', 'wr_init', 'wr_process', 'wr_tx_start', 'wr_tx_read'],
                    options: ['-DNO_X11', '-DNO_SDL3', '-DUSE_BUILTIN_POPCOUNT', '-DMAX_VERBOSE_LEVEL=0']
                };
            }
            case 'packet-radio': {
                const names = ['multi_modem', 'demod', 'demod_afsk', 'demod_psk', 'demod_9600', 'dsp', 'fsk_demod_state',
                    'hdlc_rec', 'hdlc_rec2', 'hdlc_send', 'ax25_pad', 'fcs_calc', 'gen_tone', 'fx25_init', 'fx25_rec',
                    'fx25_send', 'fx25_encode', 'fx25_decode', 'il2p_init', 'il2p_rec', 'il2p_send', 'il2p_payload',
                    'il2p_scramble', 'il2p_header', 'il2p_codec', 'il2p_encode', 'il2p_decode', 'textcolor', 'dtime',
                    'audio_stats', 'rrbb', 'ais', 'encode_aprs', 'latlong', 'symbols', 'telemetry', 'deviceid'];
                const paths = names.map((item) => join(source, item + '.c')).filter(existsSync);
                paths.push(...['dtime_now.c', 'ax25_pad2.c', 'fx25_extract.c'].map((name) => join(source, name)),
                    join(root, 'external/misc/strlcpy.c'), join(root, 'external/misc/strlcat.c'), join(native, 'packet-radio.c'));
                return {
                    paths: [...paths.filter(existsSync), join(generated, 'decode_aprs.c')],
                    includes: [source, join(native, 'packet-radio')],
                    exports: ['wr_init', 'wr_process', 'wr_encode', 'wr_audio', 'wr_audio_size', 'wr_option', 'wr_aprs_position'],
                    options: ['-include', 'string.h', '-DMAJOR_VERSION=1', '-DMINOR_VERSION=8', '-DUSE_REGEX', '-D__EMSCRIPTEN__']
                };
            }
            case 'sensor-radio': {
                const names = ['bitbuffer', 'bit_util', 'data', 'decoder_util', 'abuf', 'pulse_slicer', 'pulse_detect', 'pulse_detect_fsk', 'baseband'];
                const devices = SourceText.files(join(source, 'devices'), false)
                    .filter((path) => path.endsWith('.c') && basename(path) !== 'flex.c').sort();
                return {
                    paths: [...names.map((item) => join(source, item + '.c')), ...devices, join(native, 'sensor-radio.c')],
                    includes: [join(root, 'include'), join(native, 'sensor-radio'), generated],
                    exports: ['wr_init', 'wr_count', 'wr_name', 'wr_protocol', 'wr_disabled', 'wr_decode', 'wr_events', 'wr_iq', 'wr_option'],
                    options: ['-DHAVE_CONFIG_H']
                };
            }
            default:
                throw Error(`Unknown focused engine: ${name}`);
        }
    }

    /** Prepare and compile one focused engine using the existing runtime settings. */
    static async build(name, options = {}) {
        const root = join(ROOT, 'src/engines/modems', name);
        const generated = ModemBuilder.prepare(name, root);
        if (options.prepareOnly) return;
        const compiler = EngineToolchain.compiler(options);
        if (name === 'digital-voice') {
            await VoiceBuilder.build(root, compiler, options.debug);
            return;
        }
        const recipe = ModemBuilder.recipe(name, root, generated);
        await EngineToolchain.compileCore(root, name, recipe.paths, recipe.includes, recipe.exports,
            compiler, recipe.options || [], options.debug);
    }
}
