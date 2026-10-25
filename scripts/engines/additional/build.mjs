import { readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { ROOT } from '../../tooling.mjs';
import { EngineToolchain } from '../toolchain.mjs';
import { SourceText } from '../source-text.mjs';

/** Builds the selected standalone DSP cores from their pinned source subsets. */
export class AdditionalBuilder {
    /** Native source categories for the standalone engine units. */
    static units = {'beacon-messages': 'modems', 'aircraft-messages': 'modems', 'terminal-tones': 'modems', 'radio-identifiers': 'modems', 'spectral-pictures': 'image-codecs', 'satellite-pictures': 'slow-scan'};
    /** Result-buffer interface shared by the standalone engines. */
    static exports = ['wr_run', 'wr_option', 'wr_audio', 'wr_audio_size', 'wr_bytes', 'wr_bytes_size', 'wr_pixels', 'wr_width', 'wr_height', 'wr_text', 'wr_error'];

    /** Verify imported file hashes and reject manifest paths outside the source root. */
    static verifySources(root) {
        const boundary = realpathSync(root);
        for (const manifest of SourceText.files(root).filter((path) => basename(path) === 'SOURCE.json')) {
            const records = JSON.parse(SourceText.read(manifest)).files;
            for (const record of records) {
                const path = realpathSync(resolve(dirname(manifest), record.path));
                const rel = relative(boundary, path);
                if (rel === '..' || rel.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) || isAbsolute(rel))
                    throw Error('Unsafe source record: ' + record.path);
                if (EngineToolchain.digest(readFileSync(path)) !== record.sha256)
                    throw Error('Upstream source changed; review before rebuilding: ' + relative(ROOT, path));
            }
        }
    }

    /** Remove native on-disk callsign database access from the browser WSPR copy. */
    static removeDatabaseBlocks(source) {
        const marker = '    if (options.usehashtable) {';
        SourceText.requireCount(source, marker, 2);
        while (source.includes(marker)) {
            const start = SourceText.index(source, marker);
            const block = SourceText.function(source, marker);
            source = source.slice(0, start) + source.slice(start + block.length);
        }
        return source;
    }

    /** Keep ACARS parity/CRC validation while delivering accepted blocks synchronously. */
    static prepareAircraft(source) {
        source = SourceText.replace(source, '#include <pthread.h>', '#include <stddef.h>');
        source = SourceText.replace(source, '#include "output.h"', 'void outputmsg(msgblk_t *block);');
        source = SourceText.replace(source, '#include "statsd.h"', '');
        source = source.replace(/\/\* message queue \*\/.*?#include "syndrom.h"/gs, '#include "syndrom.h"');
        const begin = SourceText.index(source, 'static void *blk_thread');
        const end = SourceText.index(source, 'static void resetAcars', begin);
        let body = source.slice(SourceText.index(source, '\t\tchn = blk->chn;', begin), SourceText.index(source, '\n\t} while (1);', begin));
        while (body.includes('if (R.statsd)')) {
            const start = SourceText.index(body, 'if (R.statsd)');
            let at = start + 'if (R.statsd)'.length;
            while (/\s/.test(body[at])) at++;
            const stop = body[at] === '{' ? at + SourceText.function(body.slice(at), '{').length : SourceText.index(body, ';', at) + 1;
            body = body.slice(0, start) + body.slice(stop);
        }
        source = source.slice(0, begin) + 'static void wr_accept(msgblk_t *blk) {\n uint8_t i, pn, chn, pr[MAXPERR]; uint16_t crc;\n' + body + '\n}\n\n' + source.slice(end);
        source = SourceText.replaceOnce(source, '\tif (acars_shutdown) {\n\t\tacars_shutdown = 0;\n\t\tpthread_create(&blkth_id, NULL, blk_thread, NULL);\n\t}\n', '');
        const start = SourceText.index(source, '\t\tpthread_mutex_lock(&blkq_mtx);');
        const stop = SourceText.index(source, '\t\tpthread_mutex_unlock(&blkq_mtx);', start) + '\t\tpthread_mutex_unlock(&blkq_mtx);'.length;
        source = source.slice(0, start) + '\t\twr_accept(ch->blk);' + source.slice(stop);
        return source.slice(0, SourceText.index(source, 'int deinitAcars(void)')) + 'int deinitAcars(void) { return 0; }\n';
    }

    /** Preserve bounded FleetSync blocks and zero-initialized decoder state. */
    static prepareRadioIdentifiers(root, generated) {
        let source = SourceText.read(join(root, 'fleetsync/fsync_decode.c'));
        source = SourceText.replace(source, 'malloc(sizeof(fsync_decoder_t))', 'calloc(1, sizeof(fsync_decoder_t))');
        source = SourceText.replaceOnce(source, 'ec4 != -4', 'ec4 != -1');
        source = SourceText.replaceOnce(source, 'fsync_int_t msglen = decoder->msglen[x];', 'fsync_int_t msglen = decoder->msglen[x];\n    if (msglen < 6 || msglen > 1536) return;');
        source = SourceText.replaceOnce(source, 'static void _procbits(fsync_decoder_t *decoder, int x)\n{', 'static void _procbits(fsync_decoder_t *decoder, int x)\n{\n    if (decoder->msglen[x] < 0 || decoder->msglen[x] > 1530) { decoder->msglen[x] = decoder->shstate[x] = decoder->fs2state[x] = 0; if (decoder->actives > 0) decoder->actives--; return; }');
        let mdc = SourceText.read(join(root, 'mdc_decode.c'));
        mdc = SourceText.replaceOnce(mdc, 'malloc(sizeof(mdc_decoder_t))', 'calloc(1, sizeof(mdc_decoder_t))');
        SourceText.write(join(generated, 'mdc_decode.c'), mdc);
        source = SourceText.replaceOnce(source, '//printf("We have a callback i guess\\n");', '// Delivered blocks can be cleared from the other sampling phases.\n    for (int i = 0; i < FSYNC_ND; i++) { if (decoder->msglen[i] > 0 && decoder->msglen[i] <= msglen && memcmp(decoder->message[i], msg, decoder->msglen[i]) == 0) decoder->msglen[i] = 0; }');
        source = SourceText.replace(source, '#include <stdlib.h>', '#include <stdlib.h>\n#include <string.h>');
        source += '\nvoid wr_fleet_finish(fsync_decoder_t *decoder) { int best = -1; for (int i = 0; i < FSYNC_ND; i++) { if (decoder->msglen[i] >= 6 && (best < 0 || decoder->msglen[i] > decoder->msglen[best])) best = i; } if (best >= 0) _dispatch(decoder, best); }\n';
        SourceText.write(join(generated, 'fsync_decode.c'), source);
    }

    /** Move APT decoder state into resettable file-scope fields. */
    static prepareSatellite(source) {
        const declarations = ['float oscillator_phase = 0.0', 'float inbuff[BLKIN]', 'int idxin = 0', 'int nin = 0', 'float ampbuff[BLKAMP]', 'int nam = 0', 'int idxam = 0', 'float pixels[APT_IMG_WIDTH + SYNC_PATTERN_SIZE]', 'size_t npv', 'int synced = 0', 'float max = 0.0', 'float minDoppler = 1000000000, previous = 0', 'int lastmshift'];
        for (const declaration of declarations) source = SourceText.replaceOnce(source, '    static ' + declaration + ';', '');
        const insert = declarations.map((declaration) => 'static ' + declaration + ';').join('\n') + '\n';
        source = SourceText.replaceOnce(source, 'static float _sample_rate;', insert + 'static float _sample_rate;');
        source = SourceText.replaceOnce(source, 'FreqLine = 1.0 + ((ecorr - lcorr) / corr / APT_IMG_WIDTH / 4.0);', 'FreqLine = fabsf(corr) > 1e-9f ? 1.0 + ((ecorr - lcorr) / corr / APT_IMG_WIDTH / 4.0) : 1.0;\n    if (!isfinite(FreqLine) || FreqLine < 0.995 || FreqLine > 1.005) FreqLine = 1.0;');
        return source + '\nfloat clamp_half(float x, float hi) { return fmaxf(-hi, fminf(hi, x)); }\nvoid wr_apt_reset(void) {\n offset = 0; FreqLine = 1; oscillator_phase = 0; idxin = nin = nam = idxam = synced = lastmshift = 0; npv = 0; max = previous = 0; minDoppler = 1e9; memset(inbuff, 0, sizeof(inbuff)); memset(ampbuff, 0, sizeof(ampbuff)); memset(pixels, 0, sizeof(pixels));\n}\n';
    }

    /** Prepare only the generated sources required by the selected standalone core. */
    static prepare(root, name) {
        const generated = EngineToolchain.directory(root, 'generated');
        switch (name) {
            case 'beacon-messages': {
                let source = SourceText.read(join(root, 'wsprd/wsprd.c'));
                source = SourceText.replaceOnce(source, 'if (!dupe) {', 'if (!dupe && uniques < MAX_UNIQUES) {');
                source = AdditionalBuilder.removeDatabaseBlocks(source);
                source = SourceText.replace(source, '    FILE  *fhash;', '');
                source = SourceText.replace(source, '    int   nh;', '');
                source = source.replace(/    \/\* Recover FFTW optimization settings \*\/.*?    \/\* Hann function \*\//gs, '    /* Hann function */');
                source = source.replace(/    if \(\(fp_fftw_wisdom_file = fopen\("fftw_wisdom.dat", "w"\)\)\) \{.*?    \}/gs, '');
                source = SourceText.replace(source, '#include "./', '#include "');
                SourceText.write(join(generated, 'wsprd.c'), source);
                break;
            }
            case 'aircraft-messages':
                SourceText.write(join(generated, 'acars.c'), AdditionalBuilder.prepareAircraft(SourceText.read(join(root, 'acars.c'))));
                break;
            case 'terminal-tones': {
                const source = SourceText.replaceOnce(SourceText.read(join(root, 'src/fsk.c')),
                    'memcpy(fskp->fftin, samples, bit_nsamples * sizeof(float));',
                    'memset(fskp->fftin, 0, fskp->fftsize * sizeof(float));\n    memcpy(fskp->fftin, samples, bit_nsamples * sizeof(float));');
                SourceText.write(join(generated, 'fsk.c'), source);
                break;
            }
            case 'radio-identifiers':
                AdditionalBuilder.prepareRadioIdentifiers(root, generated);
                break;
            case 'satellite-pictures':
                SourceText.write(join(generated, 'dsp.c'), AdditionalBuilder.prepareSatellite(SourceText.read(join(root, 'src/dsp.c'))));
                break;
        }
        return generated;
    }

    /** Compile one standalone core after verifying its pinned upstream files. */
    static async build(name, options = {}) {
        const category = AdditionalBuilder.units[name];
        if (!category) throw Error(`Unknown standalone engine: ${name}`);
        const root = join(ROOT, 'src/engines', category, name);
        AdditionalBuilder.verifySources(root);
        const generated = AdditionalBuilder.prepare(root, name);
        if (options.prepareOnly) return;
        const common = join(ROOT, 'scripts/engines/additional');
        const paths = [join(root, 'adapters', name + '.cpp')];
        const includes = [common, join(root, 'src'), root, join(root, 'fleetsync')];
        const fft = join(ROOT, 'src/engines/modems/weak-signal/fft');
        if (['terminal-tones', 'spectral-pictures', 'beacon-messages'].includes(name)) {
            paths.push(join(fft, 'kiss_fft.c'));
            includes.push(fft);
        }
        switch (name) {
            case 'beacon-messages':
                includes.push(join(root, 'wsprd'));
                paths.push(join(generated, 'wsprd.c'), join(common, 'fft.cpp'),
                    ...['fano', 'nhash', 'tab', 'wsprd_utils', 'wsprsim_utils'].map((part) => join(root, 'wsprd', part + '.c')));
                break;
            case 'aircraft-messages':
                paths.push(join(root, 'msk.c'), join(generated, 'acars.c'), join(root, 'adapters/receiver.c'));
                break;
            case 'terminal-tones':
                paths.push(join(generated, 'fsk.c'), join(common, 'fft.cpp'));
                break;
            case 'radio-identifiers':
                paths.push(join(generated, 'mdc_decode.c'), join(root, 'mdc_encode.c'), join(generated, 'fsync_decode.c'));
                break;
            case 'satellite-pictures':
                paths.push(join(generated, 'dsp.c'), join(root, 'src/filter.c'));
                break;
        }
        await EngineToolchain.compileCore(root, name, paths, includes, AdditionalBuilder.exports,
            EngineToolchain.compiler(options), [], options.debug);
    }
}
