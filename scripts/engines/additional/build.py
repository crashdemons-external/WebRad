"""Project-owned builds for selected standalone DSP cores; never runs upstream scripts."""
from pathlib import Path
import argparse
import hashlib
import json
import importlib.util
import re
import sys
sys.dont_write_bytecode = True
REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / 'scripts/engines'))
from _toolchain import compiler_for, generated_dir
spec = importlib.util.spec_from_file_location('modem_builder', REPO / 'scripts/engines/modems/build.py')
modems = importlib.util.module_from_spec(spec)
spec.loader.exec_module(modems)
UNITS = {
    'beacon-messages': 'modems',
    'aircraft-messages': 'modems',
    'terminal-tones': 'modems',
    'radio-identifiers': 'modems',
    'spectral-pictures': 'image-codecs',
    'satellite-pictures': 'slow-scan'
}
COMMON = Path(__file__).resolve().parent
EXPORTS = ['wr_run', 'wr_option', 'wr_audio', 'wr_audio_size', 'wr_bytes', 'wr_bytes_size', 'wr_pixels', 'wr_width', 'wr_height', 'wr_text', 'wr_error']


def replace_once(source, old, new):
    if source.count(old) != 1:
        raise RuntimeError('Upstream preparation pattern changed: ' + old[:80])
    return source.replace(old, new)


def verify_sources(root):
    for manifest in root.rglob('SOURCE.json'):
        for record in json.loads(manifest.read_text(encoding='utf-8'))['files']:
            path = (manifest.parent / record['path']).resolve()
            if not path.is_relative_to(root.resolve()):
                raise RuntimeError('Unsafe source record: ' + record['path'])
            if hashlib.sha256(path.read_bytes()).hexdigest() != record['sha256']:
                raise RuntimeError('Upstream source changed; review before rebuilding: ' + str(path.relative_to(REPO)))


def remove_database_blocks(source):
    marker = '    if (options.usehashtable) {'
    if source.count(marker) != 2:
        raise RuntimeError('The WSPR database preparation pattern changed.')
    while marker in source:
        start = source.index(marker)
        stop = start + len(marker)
        depth = 1
        while depth:
            if source[stop] == '{': depth += 1
            if source[stop] == '}': depth -= 1
            stop += 1
        source = source[:start] + source[stop:]
    return source


def prepare(root, name):
    generated = generated_dir(root)
    if name == 'beacon-messages':
        source = (root / 'wsprd/wsprd.c').read_text(encoding='utf-8')
        source = replace_once(source, 'if (!dupe) {', 'if (!dupe && uniques < MAX_UNIQUES) {')
        source = remove_database_blocks(source)
        source = source.replace('    FILE  *fhash;', '').replace('    int   nh;', '')
        # Browser FFT plans have no on-disk tuning or callsign database.
        source = re.sub(r'    /\* Recover FFTW optimization settings \*/.*?    /\* Hann function \*/', '    /* Hann function */', source, flags=re.S)
        source = re.sub(r'    if \(\(fp_fftw_wisdom_file = fopen\("fftw_wisdom.dat", "w"\)\)\) \{.*?    \}', '', source, flags=re.S)
        source = source.replace('#include "./', '#include "')
        (generated / 'wsprd.c').write_text(source, encoding='utf-8')
    if name == 'aircraft-messages':
        source = (root / 'acars.c').read_text(encoding='utf-8')
        source = source.replace('#include <pthread.h>', '#include <stddef.h>')
        source = source.replace('#include "output.h"', 'void outputmsg(msgblk_t *block);')
        source = source.replace('#include "statsd.h"', '')
        source = re.sub(r'/\* message queue \*/.*?#include "syndrom.h"', '#include "syndrom.h"', source, flags=re.S)
        # Retain the upstream parity/CRC validation; deliver accepted blocks synchronously.
        begin = source.index('static void *blk_thread')
        end = source.index('static void resetAcars', begin)
        body = source[source.index('\t\tchn = blk->chn;', begin):source.index('\n\t} while (1);', begin)]
        while 'if (R.statsd)' in body:
            start = body.index('if (R.statsd)')
            at = start + len('if (R.statsd)')
            while body[at].isspace(): at += 1
            if body[at] == '{':
                depth = 1; stop = at + 1
                while depth:
                    if body[stop] == '{': depth += 1
                    if body[stop] == '}': depth -= 1
                    stop += 1
            else: stop = body.index(';', at) + 1
            body = body[:start] + body[stop:]
        source = source[:begin] + 'static void wr_accept(msgblk_t *blk) {\n uint8_t i, pn, chn, pr[MAXPERR]; uint16_t crc;\n' + body + '\n}\n\n' + source[end:]
        source = replace_once(source, '\tif (acars_shutdown) {\n\t\tacars_shutdown = 0;\n\t\tpthread_create(&blkth_id, NULL, blk_thread, NULL);\n\t}\n', '')
        start = source.index('\t\tpthread_mutex_lock(&blkq_mtx);')
        end = source.index('\t\tpthread_mutex_unlock(&blkq_mtx);', start) + len('\t\tpthread_mutex_unlock(&blkq_mtx);')
        source = source[:start] + '\t\twr_accept(ch->blk);' + source[end:]
        start = source.index('int deinitAcars(void)')
        source = source[:start] + 'int deinitAcars(void) { return 0; }\n'
        (generated / 'acars.c').write_text(source, encoding='utf-8')
    if name == 'terminal-tones':
        source = (root / 'src/fsk.c').read_text(encoding='utf-8')
        source = replace_once(source, 'memcpy(fskp->fftin, samples, bit_nsamples * sizeof(float));', 'memset(fskp->fftin, 0, fskp->fftsize * sizeof(float));\n    memcpy(fskp->fftin, samples, bit_nsamples * sizeof(float));')
        (generated / 'fsk.c').write_text(source, encoding='utf-8')
    if name == 'radio-identifiers':
        source = (root / 'fleetsync/fsync_decode.c').read_text(encoding='utf-8')
        source = source.replace('malloc(sizeof(fsync_decoder_t))', 'calloc(1, sizeof(fsync_decoder_t))')
        source = replace_once(source, 'ec4 != -4', 'ec4 != -1')
        source = replace_once(source, 'fsync_int_t msglen = decoder->msglen[x];', 'fsync_int_t msglen = decoder->msglen[x];\n    if (msglen < 6 || msglen > 1536) return;')
        # Discard an oversized message before storing another six-byte codeword.
        source = replace_once(source, 'static void _procbits(fsync_decoder_t *decoder, int x)\n{', 'static void _procbits(fsync_decoder_t *decoder, int x)\n{\n    if (decoder->msglen[x] < 0 || decoder->msglen[x] > 1530) { decoder->msglen[x] = decoder->shstate[x] = decoder->fs2state[x] = 0; if (decoder->actives > 0) decoder->actives--; return; }')
        mdc = (root / 'mdc_decode.c').read_text(encoding='utf-8')
        mdc = replace_once(mdc, 'malloc(sizeof(mdc_decoder_t))', 'calloc(1, sizeof(mdc_decoder_t))')
        (generated / 'mdc_decode.c').write_text(mdc, encoding='utf-8')
        source = replace_once(source, '//printf("We have a callback i guess\\n");', '// Delivered blocks can be cleared from the other sampling phases.\n    for (int i = 0; i < FSYNC_ND; i++) { if (decoder->msglen[i] > 0 && decoder->msglen[i] <= msglen && memcmp(decoder->message[i], msg, decoder->msglen[i]) == 0) decoder->msglen[i] = 0; }')
        source = source.replace('#include <stdlib.h>', '#include <stdlib.h>\n#include <string.h>')
        source += '\nvoid wr_fleet_finish(fsync_decoder_t *decoder) { int best = -1; for (int i = 0; i < FSYNC_ND; i++) { if (decoder->msglen[i] >= 6 && (best < 0 || decoder->msglen[i] > decoder->msglen[best])) best = i; } if (best >= 0) _dispatch(decoder, best); }\n'
        (generated / 'fsync_decode.c').write_text(source, encoding='utf-8')
    if name == 'satellite-pictures':
        source = (root / 'src/dsp.c').read_text(encoding='utf-8')
        declarations = ['float oscillator_phase = 0.0', 'float inbuff[BLKIN]', 'int idxin = 0', 'int nin = 0', 'float ampbuff[BLKAMP]', 'int nam = 0', 'int idxam = 0', 'float pixels[APT_IMG_WIDTH + SYNC_PATTERN_SIZE]', 'size_t npv', 'int synced = 0', 'float max = 0.0', 'float minDoppler = 1000000000, previous = 0', 'int lastmshift']
        for declaration in declarations:
            source = replace_once(source, '    static ' + declaration + ';', '')
        insert = '\n'.join('static ' + declaration + ';' for declaration in declarations) + '\n'
        source = replace_once(source, 'static float _sample_rate;', insert + 'static float _sample_rate;')
        source = replace_once(source, 'FreqLine = 1.0 + ((ecorr - lcorr) / corr / APT_IMG_WIDTH / 4.0);', 'FreqLine = fabsf(corr) > 1e-9f ? 1.0 + ((ecorr - lcorr) / corr / APT_IMG_WIDTH / 4.0) : 1.0;\n    if (!isfinite(FreqLine) || FreqLine < 0.995 || FreqLine > 1.005) FreqLine = 1.0;')
        source += '\nfloat clamp_half(float x, float hi) { return fmaxf(-hi, fminf(hi, x)); }\nvoid wr_apt_reset(void) {\n offset = 0; FreqLine = 1; oscillator_phase = 0; idxin = nin = nam = idxam = synced = lastmshift = 0; npv = 0; max = previous = 0; minDoppler = 1e9; memset(inbuff, 0, sizeof(inbuff)); memset(ampbuff, 0, sizeof(ampbuff)); memset(pixels, 0, sizeof(pixels));\n}\n'
        (generated / 'dsp.c').write_text(source, encoding='utf-8')
    return generated


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--engine', choices=['all', *UNITS], default='all')
    parser.add_argument('--emsdk', type=Path)
    parser.add_argument('--debug', action='store_true')
    parser.add_argument('--prepare-only', action='store_true')
    args = parser.parse_args()
    for name in UNITS if args.engine == 'all' else [args.engine]:
        root = REPO / 'src/engines' / UNITS[name] / name
        verify_sources(root)
        generated = prepare(root, name)
        if args.prepare_only:
            continue
        command, env, _ = compiler_for(root, args.emsdk)
        paths = [root / 'adapters' / (name + '.cpp')]
        includes = [COMMON, root / 'src', root, root / 'fleetsync']
        fft = REPO / 'src/engines/modems/weak-signal/fft'
        if name in ['terminal-tones', 'spectral-pictures', 'beacon-messages']:
            paths += [fft / 'kiss_fft.c']
            includes += [fft]
        if name == 'beacon-messages':
            includes += [root / 'wsprd']
            paths += [generated / 'wsprd.c', COMMON / 'fft.cpp'] + [root / 'wsprd' / (part + '.c') for part in ['fano', 'nhash', 'tab', 'wsprd_utils', 'wsprsim_utils']]
        if name == 'aircraft-messages':
            paths += [root / 'msk.c', generated / 'acars.c', root / 'adapters/receiver.c']
        if name == 'terminal-tones':
            paths += [generated / 'fsk.c', COMMON / 'fft.cpp']
        if name == 'radio-identifiers':
            paths += [generated / 'mdc_decode.c', root / 'mdc_encode.c', generated / 'fsync_decode.c']
        if name == 'satellite-pictures':
            paths += [generated / 'dsp.c', root / 'src/filter.c']
        modems.compile_core(root, name, paths, includes, EXPORTS, command, env, debug=args.debug)


if __name__ == '__main__':
    main()
