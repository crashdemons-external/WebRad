import { mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { basename, join } from 'node:path';
import { ROOT } from '../../../tooling.mjs';
import { EngineToolchain } from '../../toolchain.mjs';
import { SourceText } from '../../source-text.mjs';
import { MultimodeSources } from '../../modems/multimode/prepare-browser-core.mjs';

/** Browser preparation for the standalone fldigi weather-fax engine. */
export class WefaxSources {
    /** Native headers supplied through the browser overlay. */
    static headers = ['globals.h', 'complex.h', 'misc.h', 'ascii.h', 'filters.h', 'fftfilt.h', 'gfft.h', 'mbuffer.h', 'wefax.h', 're.h', 'morse.h', 'modem.h', 'strutil.h'];
    /** Native translation units supplying WEFAX and its filters. */
    static sources = ['wefax/wefax.cxx', 'filters/filters.cxx', 'filters/fftfilt.cxx', 'misc/strutil.cxx'];

    /** Keep receive history on the modem instance so resets clear it. */
    static isolateReceiveState(text) {
        text = SourceText.replace(text, 'static fir_filter_pair_set m_rx_filters ;', 'fir_filter_pair_set m_rx_filters;');
        text = SourceText.replace(text, 'fir_filter_pair_set fax_implementation::m_rx_filters ;', '');
        const fields = [];
        for (const name of ['noise', 'apt_start', 'phasing', 'image', 'black', 'apt_stop']) {
            const start = SourceText.index(text, `double power_usb_${name}(void) const`);
            const end = SourceText.index(text, '\n\t}', start);
            let body = SourceText.replace(text.slice(start, end), 'static double avg_pwr = 0.0 ;', '');
            body = SourceText.replace(body, 'avg_pwr', `web_power_${name}`);
            fields.push(`mutable double web_power_${name}=0;`);
            text = text.slice(0, start) + body + text.slice(end);
        }
        for (const [old, replacement] of Object.entries({'static fax_state stable_state = IDLE ;': 'mutable fax_state stable_state=IDLE;', 'static int curr_freq = 0 ;': 'int curr_freq=0;', 'static int cr_1_freq = 0 ;': 'int cr_1_freq=0;', 'static int cr_2_freq = 0 ;': 'int cr_2_freq=0;', 'static int cr_3_freq = 0 ;': 'int cr_3_freq=0;', 'static size_t phasing_count = 0 ;': 'size_t phasing_count=0;', 'static int phasing_history[ phasing_width ];': 'int phasing_history[16]{};', 'static int prev_row = -1 ;': 'mutable int prev_row=-1;', 'static int total_img_rows = 0 ;': 'mutable int total_img_rows=0;', 'static int stable_carrier = 0 ;': 'mutable int stable_carrier=0;', 'static double median_freqs[ max_median_freqs ];': 'mutable double median_freqs[20]{};', 'static int nb_median_freqs = 0 ;': 'mutable int nb_median_freqs=0;', 'static long long stable_rfcarrier = 0 ;': 'mutable long long stable_rfcarrier=0;', 'static bool prevWasRight = true ;': 'mutable bool prevWasRight=true;'})) {
            text = SourceText.replaceOnce(text, old, '');
            fields.push(replacement);
        }
        return SourceText.replace(text, 'class fax_implementation {', 'class fax_implementation {\n' + fields.join('\n'));
    }

    /** Retain native APT/phasing evidence for automatic detection and publish completed pages. */
    static prepareReceiver(text) {
        text = MultimodeSources.streamFax(WefaxSources.isolateReceiveState(text));
        text = SourceText.replace(text, '#include "wefax-pic.h"', '#include "web_wefax.h"');
        text = SourceText.replace(text, 'fax_state m_rx_state ;', 'int m_web_detected=0;\n\tfax_state m_rx_state ;');
        const apt = '\t\t\t\tskip_apt_rx();\n\t\t\t\tPUT_STATUS(state_rx_str() << ", " << _("frequency")';
        text = SourceText.replaceOnce(text, apt, '\t\t\t\tskip_apt_rx();\n\t\t\t\tm_web_detected=1;\n\t\t\t\tPUT_STATUS(state_rx_str() << ", " << _("frequency")');
        text = SourceText.replace(text, 'skip_apt_rx();\n\t\t\t\t\tLOG_VERBOSE("Start, start:', 'skip_apt_rx();\n\t\t\t\t\tm_web_detected=1;\n\t\t\t\t\tLOG_VERBOSE("Start, start:');
        text = SourceText.replace(text, '++m_phase_lines;', '++m_phase_lines;\n\t\t\tif(m_web_detected && m_phase_lines>=4)m_web_detected=2;');
        text = SourceText.replace(text, 'if (m_phase_lines >= 4 /* Was 4 */) {', 'if (m_phase_lines >= 4 /* Was 4 */) {\n                if(web_fax_auto && m_web_detected==2) {\n                    const double measured=m_lpm_sum_rx/m_phase_lines;\n                    int best=0;\n                    for(int speed=1;speed<4;speed++)\n                        if(std::abs(measured-all_lpm_values[speed].m_value)<std::abs(measured-all_lpm_values[best].m_value))best=speed;\n                    if(std::abs(measured-all_lpm_values[best].m_value)<all_lpm_values[best].m_value*.08)\n                        progdefaults.wefax_lpm_576=progdefaults.wefax_lpm_288=best;\n                }');
        // Permit the advertised 240 LPM phasing period without widening manual acquisition.
        text = SourceText.replace(text, 'm_curr_phase_len >= 0.4 * m_sample_rate', 'm_curr_phase_len >= (web_fax_auto && m_web_detected && m_rx_state==RXPHASING ? 0.2 : 0.4) * m_sample_rate');
        text = SourceText.replace(text, 'void fax_implementation::end_rx(void)\n{', 'void fax_implementation::end_rx(void)\n{\n\tm_web_detected=0;');
        text = SourceText.replace(text, 'm_lpm_img = all_lpm_values[index].m_value;;', 'm_lpm_img = all_lpm_values[index].m_value;\n\t\tm_default_lpm = m_lpm_img;');
        const start = SourceText.index(text, 'void wefax::qso_rec_save(void)');
        const end = SourceText.index(text, 'void wefax::set_freq(double freq)', start);
        text = text.slice(0, start) + 'void wefax::qso_rec_save(void){}\n' + text.slice(end);
        for (const callback of ['wefax_pic::resize_rx_viewer', 'wefax_pic::update_rx_pic_bw'])
            text = text.replace(new RegExp('REQ\\(\\s*' + callback + '\\s*,', 'g'), () => callback + '(');
        text = SourceText.replace(text, 'void fax_implementation::end_rx(void)\n{', 'void fax_implementation::end_rx(void)\n{\n\tweb_fax_complete();');
        text = SourceText.replace(text, 'void fax_implementation::skip_apt_rx(void)\n{', 'void fax_implementation::skip_apt_rx(void)\n{\n\tweb_fax_complete();\n\tweb_fax_new_page(m_img_width);');
        text = SourceText.replace(text, 'void fax_implementation::skip_phasing_to_image(bool auto_center)\n{', 'void fax_implementation::skip_phasing_to_image(bool auto_center)\n{\n\tweb_fax_begin_image(m_img_width);');
        const save = SourceText.index(text, 'void fax_implementation::save_automatic(');
        const brace = SourceText.index(text, '{', save);
        text = text.slice(0, brace + 1) + '\n\tweb_fax_complete();' + text.slice(brace + 1);
        text = SourceText.replace(text, 'std::string state_string(void) const {', 'int web_rx_detected() const { return m_web_detected; }\n\tint web_rx_state() const { return m_rx_state; }\n\tstd::string state_string(void) const {');
        text += '\nint wefax::web_rx_state() const { return m_impl->web_rx_state(); }\n';
        text += '\nint wefax::web_rx_detected() const { return m_impl->web_rx_detected(); }\n';
        return text;
    }

    /** Generate the include overlay, native source copies and configuration structures. */
    static prepare(root = join(ROOT, 'src/engines/weather-fax/weather-fax')) {
        const generated = EngineToolchain.directory(root, 'generated');
        const include = join(generated, 'include');
        mkdirSync(include, { recursive: true });
        for (const name of readdirSync(include)) if (name.endsWith('.h')) unlinkSync(join(include, name));
        const includes = new Set();
        let combined = '';
        for (const name of WefaxSources.headers) {
            let text = SourceText.read(join(root, 'include', name));
            if (name === 're.h') text = SourceText.replace(text, '"compat/regex.h"', '<regex.h>');
            combined += text;
            for (const match of text.matchAll(/^#include "([^"\n]+)"/gm)) includes.add(match[1]);
            if (name === 'modem.h') text = text.replace(/^#include "(?:threads|sound|digiscope|plot_xy)\.h"/gm, '#include "web_compat.h"');
            SourceText.write(join(include, name), text);
        }
        for (const name of WefaxSources.sources) {
            let text = SourceText.read(join(root, name));
            if (name === 'wefax/wefax.cxx') text = WefaxSources.prepareReceiver(text);
            combined += text;
            for (const match of text.matchAll(/^#include "([^"\n]+)"/gm)) includes.add(match[1]);
            SourceText.write(join(generated, basename(name)), text);
        }
        const header = join(include, 'wefax.h');
        SourceText.write(header, SourceText.replace(SourceText.read(header),
            'std::string state_string(void) const;',
            'int web_rx_detected() const;\n\tint web_rx_state() const;\n\tstd::string state_string(void) const;'));
        for (const name of includes) {
            if (WefaxSources.headers.includes(name) || name === 'web_wefax.h') continue;
            if ((name.endsWith('.h') && !name.includes('/')) || name.startsWith('FL/'))
                SourceText.write(join(include, name), '#pragma once\n#include "web_compat.h"\n');
        }
        SourceText.write(join(include, 'config.h'), '#pragma once\n#define BENCHMARK_MODE 0\n#define HAVE_STD_BIND 1\n#define HAVE_STD_HASH 1\n#define HAVE_CLOCK_GETTIME 1\n#include "web_compat.h"\n');
        const { quality, transmit } = SourceText.modemHelpers(root, include);
        combined += quality + transmit + SourceText.read(join(root, 'adapters/web_modem.cpp'));
        combined += SourceText.read(join(root, 'adapters/core.cpp'));
        MultimodeSources.configuration(root, include, combined, false);
        const source = SourceText.read(join(root, 'globals/globals.cxx'));
        const table = source.match(/const struct mode_info_t mode_info\[NUM_MODES\] = \{(.*?)\n\};/s)[1]
            .replace(/&\w+/g, 'nullptr').replace(/\b(?:DISABLED_IO|ARQ_IO|KISS_IO)\b/g, '0');
        SourceText.write(join(generated, 'mode_table.cpp'), '#include "web_compat.h"\nconst struct mode_info_t mode_info[NUM_MODES] = {' + table + '\n};\n');
        return generated;
    }
}
