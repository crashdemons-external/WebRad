import { existsSync, mkdirSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { ROOT } from '../../../tooling.mjs';
import { EngineToolchain } from '../../toolchain.mjs';
import { SourceText } from '../../source-text.mjs';

/** Prepares fldigi sources without changing the imported engine snapshot. */
export class MultimodeSources {
    /** Native translation units in their link order. */
    static sources = ['filters/filters.cxx', 'filters/fftfilt.cxx', 'filters/viterbi.cxx', 'psk/psk.cxx', 'psk/pskcoeff.cxx', 'psk/pskvaricode.cxx', 'psk/pskeval.cxx', 'psk/viewpsk.cxx', 'mfsk/interleave.cxx', 'mfsk/mfskvaricode.cxx', 'dominoex/dominoex.cxx', 'dominoex/dominovar.cxx', 'throb/throb.cxx', 'mt63/dsp.cxx', 'mt63/mt63base.cxx', 'mt63/mt63.cxx', 'olivia/olivia.cxx', 'contestia/contestia.cxx', 'rtty/rtty.cxx', 'cw/cw.cxx', 'cw/morse.cxx', 'mfsk/mfsk.cxx', 'thor/thor.cxx', 'thor/thorvaricode.cxx', 'misc/misc.cxx', 'scamp/scamp.cxx', 'scamp/scamp_protocol.cxx', 'ifkp/ifkp.cxx', 'feld/feld.cxx', 'feld/feldfonts.cxx', 'misc/re.cxx', 'navtex/navtex.cxx', 'fsq/fsq.cxx', 'wefax/wefax.cxx', 'misc/strutil.cxx', 'misc/charsetdistiller.cxx', 'libtiniconv/tiniconv.c', 'libtiniconv/tiniconv_desc.c', 'dtmf/dtmf.cxx'];
    /** Native headers supplied through the browser include overlay. */
    static headers = 'globals.h complex.h misc.h ascii.h filters.h fftfilt.h gfft.h viterbi.h psk.h pskcoeff.h pskvaricode.h pskeval.h viewpsk.h mfskvaricode.h interleave.h dominoex.h dominovar.h throb.h mbuffer.h dsp.h mt63.h mt63base.h olivia.h contestia.h rtty.h cw.h morse.h mfsk.h thor.h thorvaricode.h scamp.h scamp_protocol.h ifkp.h feld.h fontdef.h re.h navtex.h fsq.h crc8.h wefax.h strutil.h'.split(' ');

    /** Measure the full-rate CW envelope before decimating its power. */
    static prepareCwReceiver(text, header) {
        const marker = 'int\t\t\tsymbollen;';
        header = SourceText.replaceOnce(header, marker,
            'double webEnvelopePower = 0;\n    int webEnvelopeCount = 0;\n    bool webSpaceSent = true;\n    int webLastElement = 0;\n\t' + marker);
        for (const [old, replacement] of [['cw::cw() : modem()\n{', 'cw::cw() : modem()\n{\n    first_time = true;'], ['void cw::rx_init()\n{', 'void cw::rx_init()\n{\n    webEnvelopePower = 0;\n    webEnvelopeCount = 0;\n    webSpaceSent = true;\n    webLastElement = 0;'], ['static int space_sent = true;', 'bool& space_sent = webSpaceSent;'], ['static int last_element = 0;', 'int& last_element = webLastElement;'], ['n = cw_filter->Irun(fil_in, fil_out);', 'cw_filter->Irun(fil_in, fil_out);\n        webEnvelopePower += fil_out * fil_out;\n        n = ++webEnvelopeCount == FIR_DECIMATE;\n        if (n) {\n            fil_out = sqrt(webEnvelopePower / FIR_DECIMATE);\n            webEnvelopePower = 0;\n            webEnvelopeCount = 0;\n        }']])
            text = SourceText.replaceOnce(text, old, replacement);
        SourceText.requireCount(text, 'init_bandpass(FIR_FILTER_LEN, FIR_DECIMATE,', 2);
        text = SourceText.replace(text, 'init_bandpass(FIR_FILTER_LEN, FIR_DECIMATE,', 'init_bandpass(FIR_FILTER_LEN, 1,');
        return { text, header };
    }

    /** Acquire SCAMP sync before its long-term level estimator has warmed up. */
    static bootstrapScampReceiver(text, header) {
        const state = '    scamp_state sc;';
        const init = '\tsc.protocol = protocol;';
        const decode = '\tscamp_new_sample(&sc, imag1, imag2);';
        header = SourceText.replaceOnce(header, state, state + '\n    // Browser adaptation: retain acquisition levels until the first sync.\n    bool webStartupThreshold;\n    uint16_t webStartupMagnitudes[8 * SCAMP_MAX_DEMODBUFFER];\n    uint16_t webStartupIndex;');
        text = SourceText.replaceOnce(text, init, init + '\n    webStartupThreshold = protocol == PROTOCOL_SCAMP_OOK || protocol == PROTOCOL_SCAMP_FSK_FAST;\n    memset(webStartupMagnitudes, 0, sizeof(webStartupMagnitudes));\n    webStartupIndex = 0;');
        text = SourceText.replaceOnce(text, decode, '    // Browser adaptation: do not clock the first preamble with zero edge thresholds.\n    if (webStartupThreshold) {\n        const uint16_t magnitude = imag1 > imag2 ? imag1 : imag2;\n        const uint16_t window = 8 * sc.demod_samples_per_bit;\n        webStartupMagnitudes[webStartupIndex] = magnitude;\n        if (++webStartupIndex >= window) webStartupIndex = 0;\n        uint16_t edge = 0;\n        for (uint16_t index = 0; index < window; index++) {\n            if (webStartupMagnitudes[index] > edge) edge = webStartupMagnitudes[index];\n        }\n        if (!sc.fsk) edge >>= 2;\n        const uint16_t minimumEdge = sc.fsk ? sc.power_thr_min : sc.power_thr_min >> 1;\n        sc.edge_thr = edge > minimumEdge ? edge : minimumEdge;\n        sc.power_thr = sc.fsk ? sc.edge_thr >> 1 : sc.edge_thr;\n        sc.squelch_thr = sc.fsk ? sc.power_thr : sc.power_thr >> 1;\n    }\n    scamp_new_sample(&sc, imag1, imag2);\n    if (sc.resync) webStartupThreshold = false;');
        return { text, header };
    }

    /** Replay a recent THOR image marker when interleaved text identifies it late. */
    static retainThorPictureHistory(text, header) {
        const headerMarker = '\tstd::string\t\tpic_str;';
        const init = 'void thor::rx_init()\n{';
        const loop = '\twhile (len) {\n\t\tif (state != TEXT) {';
        const parse = '\tstate = IMAGE_START;\n}';
        const sync = '\t\tif (sync > -0.5 * bandwidth) {//-0.51 * bandwidth) {\n\t\t\tstate = IMAGE;';
        const method = 'void thor::parse_pic(int ch)';
        for (const [source, marker] of [[header, headerMarker], [text, init], [text, loop], [text, parse], [text, sync], [text, method]])
            SourceText.requireCount(source, marker, 1);
        header = '#include "web_thor_picture.h"\n' + header;
        header = SourceText.replace(header, headerMarker, headerMarker + '\n    ThorPictureHistory webPictureHistory;\n    bool webPictureMarkerVerified = false;\n    void recoverPictureHistory();');
        text = SourceText.replace(text, init, init + '\n    webPictureHistory.reset(samplerate);\n    webPictureMarkerVerified = false;');
        text = SourceText.replace(text, loop, '\twhile (len) {\n        webPictureHistory.push(*buf);\n\t\tif (state != TEXT) {');
        text = SourceText.replace(text, parse, '\tstate = IMAGE_START;\n    webPictureMarkerVerified = false;\n    recoverPictureHistory();\n}');
        text = SourceText.replace(text, sync, '\t\tif (sync > -0.5 * bandwidth) {\n            if (!webPictureMarkerVerified && webPictureHistory.findMarker(samplerate, frequency - 0.6 * bandwidth, 512) < 0) {\n                state = IMAGE_START;\n                return;\n            }\n            webPictureMarkerVerified = true;\n            state = IMAGE;');
        text = SourceText.replace(text, method, 'void thor::recoverPictureHistory()\n{\n    const int start = webPictureHistory.findMarker(samplerate, frequency - 0.6 * bandwidth);\n    if (start < 0) return;\n    webPictureMarkerVerified = true;\n    picfilter->init_lowpass(257, 1, 1.0 * bandwidth / samplerate);\n    prevz = cmplx(0.0, 0.0);\n    img_phase = 0.0;\n    image_counter = -(257 + IMAGEspp * 2);\n    for (int index = start; index < webPictureHistory.size() && state != TEXT; index++) {\n        recvpic(webPictureHistory.sample(index));\n    }\n}\n\n' + method);
        return { text, header };
    }

    /** Retain the FSQ symbol clock before switching from text to picture samples. */
    static retainFsqPictureHistory(text, header) {
        const headerMarker = '\tSTATE\t\t\tstate;';
        const init = 'void  fsq::rx_init()\n{';
        const loop = '\twhile (len) {\n\t\tif (state == IMAGE) {\n\t\t\trecvpic(*buf);';
        const parse = '\tstate = IMAGE;\n\n\tdisplay_fsq_rx_text';
        const method = 'void fsq::recvpic(double smpl)';
        for (const [source, marker] of [[header, headerMarker], [text, init], [text, loop], [text, parse], [text, method]])
            SourceText.requireCount(source, marker, 1);
        header = '#include "web_fsq_picture.h"\n' + header;
        header = SourceText.replace(header, headerMarker, headerMarker + '\n    FsqPictureHistory webPictureHistory;\n    void recoverPictureHistory();');
        text = SourceText.replace(text, init, init + '\n    webPictureHistory.reset(samplerate);');
        text = SourceText.replace(text, loop, '\twhile (len) {\n        webPictureHistory.push(*buf);\n\t\tif (state == IMAGE) {\n            if (webPictureHistory.pending()) {\n                if (webPictureHistory.ready(FSQ_SYMLEN)) recoverPictureHistory();\n            } else {\n                recvpic(*buf);\n            }');
        text = SourceText.replace(text, parse, '\tstate = IMAGE;\n    const int firstBin = frequency * FSQ_SYMLEN / samplerate - NUMBINS / 2;\n    webPictureHistory.arm(firstBin + symbol, basetone, samplerate, FSQ_SYMLEN);\n\n\tdisplay_fsq_rx_text');
        text = SourceText.replace(text, method, 'void fsq::recoverPictureHistory()\n{\n    const int imageStart = webPictureHistory.findImageStart(samplerate, FSQ_SYMLEN, frequency - 200.0);\n    int start = webPictureHistory.originalStart();\n    if (imageStart >= 0) {\n        start = std::max(0, imageStart - 512);\n        picfilter->init_lowpass(257, 1, 500.0 / samplerate);\n        prevz = cmplx(0.0, 0.0);\n        phase = pixel = amplitude = 0.0;\n        // The 257-tap FIR reads through the preceding sample: its delay is 129 samples.\n        image_counter = -(imageStart - start + 129 + RXspp);\n    }\n    webPictureHistory.finish();\n    for (int index = start; index < webPictureHistory.size() && state == IMAGE; index++) {\n        recvpic(webPictureHistory.retainedSample(index));\n    }\n}\n\n' + method);
        return { text, header };
    }

    /** Preserve image preambles and modulation while yielding after bounded pixel batches. */
    static streamImage(text, family) {
        const start = SourceText.index(text, `void ${family}::send_image()`);
        const end = SourceText.index(text, {
            thor: 'void thor::thor_send_image', ifkp: 'std::string img_str;', fsq: 'void fsq::send_string'
        }[family], start);
        const original = text.slice(start, end);
        const split = SourceText.index(original, {
            thor: 'if (send_gray)', ifkp: 'if (send_color == false)', fsq: 'if (color == false)'
        }[family]);
        const preambleStart = SourceText.index(original, '\tREQ(');
        const head = original.slice(0, preambleStart);
        const preamble = original.slice(preambleStart, split);
        const pixelStart = original.lastIndexOf('tx_pixelnbr = col + row * W;');
        const modulation = original.slice(pixelStart).match(/(?:ModulateXmtr|transmit)\(outbuf, (?:IMAGEspp|10)\);/);
        let pixel = original.slice(pixelStart, pixelStart + modulation.index + modulation[0].length);
        pixel = SourceText.replace(pixel, `tx_pixel = ${family}pic_TxGetPixel(tx_pixelnbr, color);`,
            `tx_pixel = gray ?\n            0.3 * ${family}pic_TxGetPixel(tx_pixelnbr, 0) +\n            0.6 * ${family}pic_TxGetPixel(tx_pixelnbr, 1) +\n            0.1 * ${family}pic_TxGetPixel(tx_pixelnbr, 2) :\n            ${family}pic_TxGetPixel(tx_pixelnbr, color);`);
        const gray = { thor: 'send_gray', ifkp: '!send_color', fsq: '!color' }[family];
        const channel = family === 'fsq' ? '2 - (web_image_position / W) % 3' : '(web_image_position / W) % 3';
        let replacement = head + '\nif (web_image_position == 0) {\n' + preamble + '\n}\n' + `
    const bool gray = ${gray};
    const int channels = gray ? 1 : 3;
    const int total = W * H * channels;
    const int limit = std::min(total, web_image_position + 128);
    for (; web_image_position < limit; ++web_image_position) {
        int row = web_image_position / (W * channels);
        int col = web_image_position % W;
        int color = gray ? 0 : ${channel};
        ${pixel}
    }
    web_image_done = web_image_position == total;
    if (web_image_done) start_deadman();
}

`;
        replacement = replacement.replace(/\bfrequency\b/g, 'get_txfreq_woffset()');
        text = text.slice(0, start) + replacement + text.slice(end);
        switch (family) {
            case 'thor':
                text = SourceText.replace(text, 'case TX_STATE_IMAGE:\n', 'case TX_STATE_IMAGE:\n\t\tif (web_image_position == 0) {\n');
                text = SourceText.replace(text, '\t\tsend_image();', '\t\t}\n\t\tsend_image();\n\t\tif (!web_image_done) return 0;', 1);
                break;
            case 'ifkp':
                text = SourceText.replace(text, '\t\t\tsend_image();', '\t\t\tsend_image();\n\t\t\tif (!web_image_done) return 0;', 1);
                break;
            case 'fsq':
                text = SourceText.replace(text, 'int fsq::tx_process()\n{', 'int fsq::tx_process()\n{\n    if (fsq_tx_image && web_image_position > 0) {\n        send_image();\n        if (!web_image_done) return 0;\n        flush_buffer();\n        fsq_tx_image = false;\n        stopflag = false;\n        return -1;\n    }');
                text = SourceText.replace(text, '\t\tsend_eot = false;', '\t\tsend_eot = false;\n\t\tif (fsq_tx_image && !web_image_done) return 0;', 1);
                break;
        }
        return text;
    }

    /** Accept application sender IDs and self-recordings after validating the native CRC. */
    static adaptFsqSender(text) {
        for (const [marker, replacement] of [['if (max > 20) max = 20;', 'if (max > 21) max = 21;'], ['\t\tif ((crc.sval(substr) == rxcrc) && valid_callsign(substr)) {', '        // Sender IDs follow the browser input contract; recipient calls retain native validation.\n        const bool validSender = substr.length() >= 3 &&\n            substr.find_first_not_of("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/") == std::string::npos;\n        if ((crc.sval(substr) == rxcrc) && validSender) {'], ['\tif (station_calling == mycall) { // do not display any of own rx stream\n\t\tLOG_ERROR("Station calling is mycall: %s", station_calling.c_str());', '    // Recordings may contain our own sender ID. Reject missing or invalid senders instead.\n    if (station_calling.empty()) {']])
            text = SourceText.replaceOnce(text, marker, replacement);
        return text;
    }

    /** Keep the FSQ image preroll continuous and invert its native FM scale. */
    static calibrateFsqImage(text) {
        text = SourceText.replaceOnce(text, 'byte = pixel / 1.5 + 128;', 'byte = (pixel + 200.0) / 1.5;');
        const start = SourceText.index(text, 'void fsq::send_image()');
        const end = SourceText.index(text, 'if (color == false)', start);
        const preamble = SourceText.replaceOnce(text.slice(start, end), 'ModulateXmtr(outbuf, 10);', 'ModulateXmtr(outbuf, PHASE_CORR);');
        return text.slice(0, start) + preamble + text.slice(end);
    }

    /** Retain the native fax modulator while yielding after 32 audio blocks. */
    static streamFax(text) {
        text = SourceText.replace(text, 'fax_state m_tx_state;', 'int m_web_tx_sample_idx = 0;\n\tfax_state m_tx_state;');
        text = SourceText.replace(text, 'void init_tx(int the_smpl_rate);', 'bool web_tx_idle() const { return m_tx_state == IDLE; }\n\tvoid init_tx(int the_smpl_rate);');
        text = SourceText.replace(text, 'm_tx_state = TXAPTSTART;', 'm_tx_state = TXAPTSTART;\n\tm_web_tx_sample_idx = 0;');
        const start = SourceText.index(text, 'bool fax_implementation::trx_do_next(void)');
        const end = SourceText.index(text, 'void fax_implementation::tx_params_set', start);
        let body = text.slice(start, end);
        body = SourceText.replace(body, 'int curr_sample_idx = 0 , nb_samples_to_send  = 0 ;', 'int &curr_sample_idx = m_web_tx_sample_idx;\n\tint nb_samples_to_send = 0;');
        body = SourceText.replace(body, 'for (int num_bytes_to_write = 0; ; ++num_bytes_to_write)', 'int num_bytes_to_write = 0;\n\tfor (; ; ++num_bytes_to_write)');
        body = SourceText.replace(body, 'bool end_of_loop = false ;', 'int web_blocks = 0;\n\tbool end_of_loop = false ;');
        body = SourceText.replace(body, 'num_bytes_to_write = 0 ;', 'num_bytes_to_write = 0;\n\t\t\tif (++web_blocks == 32) { delete [] buf; return true; }');
        body = SourceText.replace(body, 'm_tx_state = TXBLACK;\n\t\t\t\tcurr_sample_idx = 0;\n\t\t\t\tcontinue;', 'm_tx_state = TXBLACK;\n\t\t\t\tcurr_sample_idx = 0;\n\t\t\t\t--num_bytes_to_write;\n\t\t\t\tcontinue;');
        body = SourceText.replace(body, 'm_tx_state = IDLE;\n\t\t\t\tend_of_loop = true ;\n\t\t\t\tcontinue ;', 'm_tx_state = IDLE;\n\t\t\t\tend_of_loop = true;\n\t\t\t\tbreak;');
        body = SourceText.replace(body, '} // loop\n\tdelete [] buf;', '} // loop\n\tif (num_bytes_to_write > 0) modulate(buf, num_bytes_to_write);\n\tdelete [] buf;');
        text = text.slice(0, start) + body + text.slice(end);
        text = SourceText.replace(text, 'bool tx_was_completed = m_impl->trx_do_next();', 'bool tx_was_completed = m_impl->trx_do_next();\n\tif (tx_was_completed && !m_impl->web_tx_idle()) return 0;');
        return text;
    }

    /** Copy native headers and expose instance-owned DTMF controls in the overlay. */
    static prepareHeaders(root, include) {
        mkdirSync(include, { recursive: true });
        for (const name of MultimodeSources.headers) SourceText.copy(join(root, 'include', name), join(include, name));
        let dtmf = SourceText.read(join(root, 'include/dtmf.h'));
        dtmf = SourceText.replace(dtmf, 'NUMTONES', 'DTMF_NUMTONES');
        dtmf = SourceText.replace(dtmf, 'int framesize;', 'int framesize;\n\tsize_t dptr = 0;');
        dtmf = SourceText.replace(dtmf, '~cDTMF() {};', '~cDTMF() { for (auto filter : filt) delete filter; };');
        dtmf = SourceText.replace(dtmf, 'void receive(const float* buf, size_t len);', 'void receive(const float* buf, size_t len);\n\tvoid flush();');
        dtmf = SourceText.replace(dtmf, 'void send();', 'void send(int tone_ms = 50, int gap_ms = 50);');
        SourceText.write(join(include, 'dtmf.h'), dtmf);
        SourceText.copy(join(root, 'include/charsetdistiller.h'), join(include, 'charsetdistiller.h'));
        SourceText.copy(join(root, 'libtiniconv/tiniconv.h'), join(include, 'tiniconv.h'));
        const jalocha = join(root, 'include/jalocha');
        for (const path of SourceText.files(jalocha)) SourceText.copy(path, join(include, 'jalocha', relative(jalocha, path)));
        const modem = join(include, 'modem.h');
        SourceText.write(modem, SourceText.read(join(root, 'include/modem.h'))
            .replace(/^#include "(?:threads|sound|digiscope|plot_xy)\.h"/gm, '#include "web_compat.h"'));
        const regex = join(include, 're.h');
        SourceText.write(regex, SourceText.replace(SourceText.read(regex), '"compat/regex.h"', '<regex.h>'));
    }

    /** Make DTMF receive frames and transmit timing independent of native desktop services. */
    static prepareDtmf(text) {
        text = SourceText.replace(text, '#include <samplerate.h>', '');
        text = SourceText.replace(text, '#include "dtmf.h"', '#include "modem.h"\n#include "dtmf.h"');
        text = SourceText.replace(text, 'NUMTONES', 'DTMF_NUMTONES');
        const start = SourceText.index(text, '\tint x;', SourceText.index(text, 'void cDTMF::receive'));
        const end = SourceText.index(text, '\t\tx = decode();', start) + '\t\tx = decode();'.length;
        text = text.slice(0, start) + '\tif (!progdefaults.DTMFdecode || !buf || !len) return;\n\tframesize = (active_modem->get_samplerate() == 8000) ? 240 : 331;\n\tsize_t bufptr = 0;\n\twhile (bufptr < len) {\n\t\tdata[dptr++] = buf[bufptr++];\n\t\tif (dptr < size_t(framesize)) continue;\n\t\tdptr = 0;\n\t\tint x = decode();' + text.slice(end);
        text = SourceText.replace(text, 'REQ(showDTMF, dtmfchars);', 'showDTMF(dtmfchars);');
        text = SourceText.replace(text, 'void cDTMF::send()', 'void cDTMF::send(int tone_ms, int gap_ms)');
        text = SourceText.replace(text, 'duration = 50;', 'duration = clamp(tone_ms, 40, 2000);\n\tgap_ms = clamp(gap_ms, 30, 2000);');
        text = SourceText.replace(text, '\t\tsilence(duration);\n\t}', '\t\tsilence(gap_ms);\n\t}');
        text = SourceText.replace(text, 'if (maxpower <', 'active_modem->display_metric(clamp(maxpower / 10.0, 0.0, 100.0));\n\tif (maxpower <');
        return text + '\nvoid cDTMF::flush() { if (!dtmfchars.empty()) { showDTMF(dtmfchars); dtmfchars.clear(); } }\n';
    }

    /** Apply the browser boundary changes for one native translation unit. */
    static prepareSource(root, generated, include, name, text) {
        const updateHeader = (headerName, prepare) => {
            const path = join(include, headerName);
            const result = prepare(text, SourceText.read(path));
            text = result.text;
            SourceText.write(path, result.header);
        };
        switch (name) {
            case 'scamp/scamp_protocol.cxx':
                updateHeader('scamp_protocol.h', MultimodeSources.bootstrapScampReceiver);
                break;
            case 'dtmf/dtmf.cxx':
                text = MultimodeSources.prepareDtmf(text);
                SourceText.write(join(generated, 'dtmf.cxx'), text);
                break;
            case 'cw/cw.cxx':
                updateHeader('cw.h', MultimodeSources.prepareCwReceiver);
                text = text.slice(0, SourceText.index(text, 'Cserial CW_KEYLINE_serial;')) + '\nvoid cw::send_CW(int) {}\n';
                break;
        }
        if (['mfsk/mfsk.cxx', 'thor/thor.cxx', 'ifkp/ifkp.cxx'].includes(name))
            text = text.replace(/#include "(?:mfsk|thor|ifkp)-pic.cxx"/g, '#include "web_picture.h"');
        if (name === 'mfsk/mfsk.cxx') {
            text = SourceText.replace(text, 'int i = 0;\n\t\t\tint blocklen = 128;', 'int &i = web_image_position;\n\t\t\tint blocklen = 128;');
            text = SourceText.replace(text, 'while (i < xmtbytes)', 'if (i < xmtbytes)');
            text = SourceText.replace(text, '\t\t\t\ti += blocklen;\n\t\t\t}', '\t\t\t\ti = std::min(xmtbytes, i + blocklen);\n\t\t\t}\n\t\t\tif (i < xmtbytes) return 0;\n\t\t\tweb_image_done = true;');
        }
        if (['thor/thor.cxx', 'ifkp/ifkp.cxx', 'fsq/fsq.cxx'].includes(name)) {
            if (name === 'fsq/fsq.cxx') text = MultimodeSources.calibrateFsqImage(text);
            text = MultimodeSources.streamImage(text, basename(name, '.cxx'));
        }
        switch (name) {
            case 'ifkp/ifkp.cxx':
                text = SourceText.replace(text, 'frequency = (basetone + tone * IFKP_SPACING) * samplerate / symlen;', 'frequency = (basetone + tone * IFKP_SPACING) * samplerate / symlen - progdefaults.TxOffset;');
                // Retain the character-table decoding used by the original preparation.
                text = SourceText.replace(text, '#include "ifkp_varicode.cxx"', SourceText.read(join(root, 'ifkp/ifkp_varicode.cxx'), 'windows-1252'));
                text = text.slice(0, SourceText.index(text, 'static picture *def_ifkp_avatar')) +
                    '\nvoid ifkp::m_ifkp_send_avatar() {}\n' + text.slice(SourceText.index(text, 'int ifkp::tx_process'));
                text += '\nstd::string ifkp::imageheader;\n';
                break;
            case 'feld/feld.cxx':
                text = SourceText.replace(text, 'REQ(put_rx_data,', 'put_rx_data(');
                break;
            case 'navtex/navtex.cxx': {
                text = text.slice(0, SourceText.index(text, 'class NavtexRecord')) +
                    text.slice(SourceText.index(text, '}; // NavtexCatalog') + '}; // NavtexCatalog'.length);
                const start = SourceText.index(text, 'void display( const std::string & alt_string )');
                const end = SourceText.index(text, '} // display', start) + '} // display'.length;
                text = text.slice(0, start) + 'void display(const std::string &alt_string){std::string::operator=(alt_string);cleanup();}\n' + text.slice(end);
                break;
            }
            case 'fsq/fsq.cxx':
                text = MultimodeSources.adaptFsqSender(text);
                text = SourceText.replace(text, 'freq = (tx_basetone + tone * spacing) * samplerate / FSQ_SYMLEN;', 'freq = (tx_basetone + tone * spacing) * samplerate / FSQ_SYMLEN - progdefaults.TxOffset;');
                text = SourceText.replace(text, '#include "fsq-pic.cxx"', '#include "web_picture.h"');
                text = SourceText.replace(text, '#include "fsq_varicode.cxx"', SourceText.read(join(root, 'fsq/fsq_varicode.cxx'), 'windows-1252'));
                text = text.slice(0, SourceText.index(text, 'void  clear_xmt_arrays()\n{')) +
                    '\nvoid fsq::reply(std::string){}\nvoid fsq::delayed_reply(std::string,int){}\nvoid fsq::start_aging(){}\nvoid fsq::stop_aging(){}\nvoid fsq::start_sounder(int){}\nvoid SOUNDER_close(){}\n';
                break;
            case 'wefax/wefax.cxx': {
                text = MultimodeSources.streamFax(text);
                text = SourceText.replace(text, '#include "wefax-pic.h"', '#include "web_wefax.h"');
                const start = SourceText.index(text, 'void wefax::qso_rec_save(void)');
                const end = SourceText.index(text, 'void wefax::set_freq(double freq)', start);
                text = text.slice(0, start) + 'void wefax::qso_rec_save(void){}\n' + text.slice(end);
                break;
            }
        }
        if (['mfsk/mfsk.cxx', 'thor/thor.cxx', 'ifkp/ifkp.cxx', 'fsq/fsq.cxx', 'wefax/wefax.cxx'].includes(name)) {
            for (const callback of ['showRxViewer', 'updateRxPic', 'thor_showRxViewer', 'thor_clear_avatar', 'thor_updateRxPic', 'thor_update_avatar', 'ifkp_showRxViewer', 'ifkp_clear_avatar', 'ifkp_updateRxPic', 'ifkp_update_avatar', 'fsq_showRxViewer', 'fsq_updateRxPic', 'wefax_pic::resize_rx_viewer', 'wefax_pic::update_rx_pic_bw']) {
                text = text.replace(new RegExp('REQ\\(\\s*' + callback + '\\s*,', 'g'), () => callback + '(');
                text = text.replace(new RegExp('REQ\\(\\s*' + callback + '\\s*\\)', 'g'), () => callback + '()');
            }
        }
        if (name === 'misc/misc.cxx') text = text.slice(0, SourceText.index(text, '#include')) +
            '#include "misc.h"\n' + text.slice(SourceText.index(text, 'unsigned char grayencode'));
        if (name === 'thor/thor.cxx') {
            updateHeader('thor.h', MultimodeSources.retainThorPictureHistory);
            text += '\nstd::string thor::imageheader;\nstd::string thor::avatarheader;\nint thor::IMAGEspp=THOR_IMAGESPP;\n';
        }
        if (name === 'fsq/fsq.cxx') updateHeader('fsq.h', MultimodeSources.retainFsqPictureHistory);
        if (['cw/cw.cxx', 'mfsk/mfsk.cxx', 'thor/thor.cxx', 'misc/misc.cxx', 'ifkp/ifkp.cxx', 'feld/feld.cxx',
            'navtex/navtex.cxx', 'fsq/fsq.cxx', 'wefax/wefax.cxx', 'scamp/scamp_protocol.cxx'].includes(name))
            SourceText.write(join(generated, basename(name)), text);
        return text;
    }

    /** Derive configuration and status structures from the fields used by selected sources. */
    static configuration(root, include, combined, multimode = true) {
        combined = combined.replace(/\/\*.*?\*\/|\/\/[^\n]*/gs, '');
        const fields = new Set([...combined.matchAll(/progdefaults\.(\w+)/g)].map((match) => match[1]));
        if (multimode) for (const name of ['wfPreFilter', 'wf_latency', 'TxOffset', 'SoftStart']) fields.add(name);
        const values = new Map(SourceText.elements(SourceText.read(join(root, 'include/configuration.h'), 'utf-8', false)).map((args) => [args[1], args]));
        const config = ['#pragma once', 'struct WebConfiguration {'];
        for (const name of [...fields].sort()) {
            const value = values.get(name);
            if (!value) throw Error(`No default value for ${name}`);
            const defaultValue = multimode ? SourceText.replace(value[4], 'rtty::RTTY_PARITY_NONE', '0') : value[4];
            config.push(`    ${value[0]} ${name} = ${defaultValue};`);
        }
        config.push('};\nextern WebConfiguration progdefaults;\n');
        SourceText.write(join(include, 'web_configuration.h'), config.join('\n'));
        const statusFields = new Set([...combined.matchAll(/progStatus\.(\w+)/g)].map((match) => match[1]));
        if (multimode) statusFields.add('txlevel');
        const statusSource = SourceText.read(join(root, 'include/status.h'), 'utf-8', false);
        const status = ['#pragma once', 'struct WebStatus {'];
        for (const name of [...statusFields].sort()) {
            const match = statusSource.match(new RegExp('\\b(bool|double|float|int|std::string)\\s+' + name + '\\s*;'));
            if (!match) throw Error(`No status type for ${name}`);
            status.push(`    ${match[1]} ${name} {};`);
        }
        status.push('};\nextern WebStatus progStatus;\n');
        SourceText.write(join(include, 'web_status.h'), status.join('\n'));
        return fields.size;
    }

    /** Preserve native mode names and order, replacing desktop modem globals. */
    static modeTable(root, generated) {
        const source = SourceText.read(join(root, 'globals/globals.cxx'), 'utf-8', false);
        let table = source.match(/const struct mode_info_t mode_info\[NUM_MODES\] = \{(.*?)\n\};/s)[1];
        table = table.replace(/\/\*.*?\*\/|\/\/[^\n]*/gs, '');
        const families = new Map();
        for (const match of table.matchAll(/\{\s*(MODE_\w+)\s*,\s*&([\w]+)\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"/g)) {
            const pattern = [['PSK', 'psk|ofdm'], ['DominoEX', 'dominoex'], ['Throb', 'throb'], ['MT63', 'mt63'], ['Olivia', 'olivia'], ['Contestia', 'contestia'], ['RTTY', '^rtty'], ['CW', '^cw_'], ['MFSK', '^mfsk'], ['THOR', '^thor'], ['SCAMP', '^sc(?:amp|fsk|ook)'], ['IFKP', '^ifkp'], ['Hellschreiber', '^feld'], ['NAVTEX', 'navtex|sitorb'], ['FSQ', '^fsq'], ['WEFAX', '^wefax']].find(([, expression]) => new RegExp(expression).test(match[2]));
            families.set(match[1], pattern?.[0]);
        }
        table = table.replace(/&\w+/g, 'nullptr').replace(/\b(?:DISABLED_IO|ARQ_IO|KISS_IO)\b/g, '0');
        const cpp = ['#include "web_compat.h"', 'const struct mode_info_t mode_info[NUM_MODES] = {', table, '};',
            'const char* web_family(int mode) { switch(mode) {'];
        for (const [mode, family] of families) if (family) cpp.push(`case ${mode}: return "${family}";`);
        cpp.push('case WEB_MODE_DTMF: return "DTMF";', 'default: return ""; }}');
        SourceText.write(join(generated, 'mode_table.cpp'), cpp.join('\n'));
        return [...families.values()].filter(Boolean).length;
    }

    /** Generate browser source copies, include stubs and catalog metadata. */
    static prepare(root = join(ROOT, 'src/engines/modems/multimode')) {
        const generated = EngineToolchain.directory(root, 'generated');
        const include = join(generated, 'include');
        MultimodeSources.prepareHeaders(root, include);
        SourceText.modemHelpers(root, include);
        const includes = new Set();
        let combined = '';
        for (const name of MultimodeSources.sources) {
            const text = MultimodeSources.prepareSource(root, generated, include, name,
                SourceText.read(join(root, name), 'utf-8', false));
            combined += text;
            for (const match of text.matchAll(/^#include [<"]([^>"\n]+)[>"]/gm)) includes.add(match[1]);
        }
        for (const name of MultimodeSources.headers) {
            for (const match of SourceText.read(join(include, name), 'utf-8', false).matchAll(/^#include [<"]([^>"\n]+)[>"]/gm))
                includes.add(match[1]);
        }
        for (const name of includes) {
            if (MultimodeSources.headers.includes(name) || ['modem.h', 'dtmf.h', 'charsetdistiller.h', 'tiniconv.h'].includes(name) || name.startsWith('jalocha/')) continue;
            if (name.startsWith('FL/') || existsSync(join(root, 'include', name)))
                SourceText.write(join(include, name), '#pragma once\n#include "web_compat.h"\n');
        }
        SourceText.write(join(include, 'config.h'), '#pragma once\n#define BENCHMARK_MODE 0\n#define HAVE_STD_BIND 1\n#define HAVE_STD_HASH 1\n#define HAVE_CLOCK_GETTIME 1\n#include "web_compat.h"\n');
        const fields = MultimodeSources.configuration(root, include, combined);
        const modes = MultimodeSources.modeTable(root, generated);
        let viewer = SourceText.read(join(root, 'psk/viewpsk.cxx'));
        viewer = SourceText.replace(viewer, 'REQ(&viewaddchr,', 'viewaddchr(');
        viewer = SourceText.replace(viewer, 'REQ(&viewclearchannel,', 'viewclearchannel(');
        SourceText.write(join(generated, 'viewpsk.cxx'), viewer);
        console.log(`Prepared ${fields} configuration defaults and ${modes} receive modes.`);
        return generated;
    }
}
