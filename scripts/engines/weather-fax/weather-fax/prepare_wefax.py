"""Prepare the selected fldigi WEFAX sources for the browser build."""
from pathlib import Path
import re
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from _toolchain import generated_dir

REPO = Path(__file__).resolve().parents[4]
ROOT = REPO / 'src/engines' / Path(__file__).resolve().parents[1].name / Path(__file__).resolve().parents[0].name
UPSTREAM = ROOT
GENERATED = generated_dir(ROOT)
HEADERS = ['globals.h', 'complex.h', 'misc.h', 'ascii.h', 'filters.h', 'fftfilt.h', 'gfft.h', 'mbuffer.h', 'wefax.h', 're.h', 'morse.h', 'modem.h', 'strutil.h']
SOURCES = ['wefax/wefax.cxx', 'filters/filters.cxx', 'filters/fftfilt.cxx', 'misc/strutil.cxx']


def isolate_receive_state(text):
    # Keep receive history on the modem instance so resets clear it.
    text = text.replace('static fir_filter_pair_set m_rx_filters ;', 'fir_filter_pair_set m_rx_filters;')
    text = text.replace('fir_filter_pair_set fax_implementation::m_rx_filters ;', '')
    fields = []
    for name in ['noise', 'apt_start', 'phasing', 'image', 'black', 'apt_stop']:
        start=text.index(f'double power_usb_{name}(void) const')
        end=text.index('\n\t}',start)
        body = text[start:end].replace('static double avg_pwr = 0.0 ;', '').replace('avg_pwr', f'web_power_{name}')
        fields.append(f'mutable double web_power_{name}=0;')
        text = text[:start] + body + text[end:]
    declarations = {
        'static fax_state stable_state = IDLE ;': 'mutable fax_state stable_state=IDLE;',
        'static int curr_freq = 0 ;': 'int curr_freq=0;',
        'static int cr_1_freq = 0 ;': 'int cr_1_freq=0;',
        'static int cr_2_freq = 0 ;': 'int cr_2_freq=0;',
        'static int cr_3_freq = 0 ;': 'int cr_3_freq=0;',
        'static size_t phasing_count = 0 ;': 'size_t phasing_count=0;',
        'static int phasing_history[ phasing_width ];': 'int phasing_history[16]{};',
        'static int prev_row = -1 ;': 'mutable int prev_row=-1;',
        'static int total_img_rows = 0 ;': 'mutable int total_img_rows=0;',
        'static int stable_carrier = 0 ;': 'mutable int stable_carrier=0;',
        'static double median_freqs[ max_median_freqs ];': 'mutable double median_freqs[20]{};',
        'static int nb_median_freqs = 0 ;': 'mutable int nb_median_freqs=0;',
        'static long long stable_rfcarrier = 0 ;': 'mutable long long stable_rfcarrier=0;',
        'static bool prevWasRight = true ;': 'mutable bool prevWasRight=true;'
    }
    for old, new in declarations.items():
        if text.count(old) != 1:
            raise RuntimeError('Changed WEFAX state declaration: ' + old)
        text = text.replace(old, '')
        fields.append(new)
    return text.replace('class fax_implementation {', 'class fax_implementation {\n' + '\n'.join(fields))

def stream_fax(text):
    # Retain the native APT/phasing/image/stop state machine and FM modulator;
    # Persist its sample cursor and yield after 32 native 256-sample buffers.
    text = text.replace('fax_state m_tx_state;', 'int m_web_tx_sample_idx = 0;\n\tfax_state m_tx_state;')
    text = text.replace('void init_tx(int the_smpl_rate);', 'bool web_tx_idle() const { return m_tx_state == IDLE; }\n\tvoid init_tx(int the_smpl_rate);')
    text = text.replace('m_tx_state = TXAPTSTART;', 'm_tx_state = TXAPTSTART;\n\tm_web_tx_sample_idx = 0;')
    start = text.index('bool fax_implementation::trx_do_next(void)')
    end = text.index('void fax_implementation::tx_params_set', start)
    body = text[start:end]
    body = body.replace('int curr_sample_idx = 0 , nb_samples_to_send  = 0 ;', 'int &curr_sample_idx = m_web_tx_sample_idx;\n\tint nb_samples_to_send = 0;')
    body = body.replace('for (int num_bytes_to_write = 0; ; ++num_bytes_to_write)', 'int num_bytes_to_write = 0;\n\tfor (; ; ++num_bytes_to_write)')
    body = body.replace('bool end_of_loop = false ;', 'int web_blocks = 0;\n\tbool end_of_loop = false ;')
    body = body.replace('num_bytes_to_write = 0 ;', 'num_bytes_to_write = 0;\n\t\t\tif (++web_blocks == 32) { delete [] buf; return true; }')
    body = body.replace('m_tx_state = TXBLACK;\n\t\t\t\tcurr_sample_idx = 0;\n\t\t\t\tcontinue;', 'm_tx_state = TXBLACK;\n\t\t\t\tcurr_sample_idx = 0;\n\t\t\t\t--num_bytes_to_write;\n\t\t\t\tcontinue;')
    body = body.replace('m_tx_state = IDLE;\n\t\t\t\tend_of_loop = true ;\n\t\t\t\tcontinue ;', 'm_tx_state = IDLE;\n\t\t\t\tend_of_loop = true;\n\t\t\t\tbreak;')
    # The final incomplete block belongs to the tail; desktop discards it.
    body = body.replace('} // loop\n\tdelete [] buf;', '} // loop\n\tif (num_bytes_to_write > 0) modulate(buf, num_bytes_to_write);\n\tdelete [] buf;')
    text = text[:start] + body + text[end:]
    text = text.replace('bool tx_was_completed = m_impl->trx_do_next();', 'bool tx_was_completed = m_impl->trx_do_next();\n\tif (tx_was_completed && !m_impl->web_tx_idle()) return 0;')
    return text


def elements(text):
    text = text.replace("\\\n", " ")
    for match in re.finditer(r"ELEM_\(", text):
        start = match.end()
        depth = 0
        quoted = False
        escaped = False
        args = []
        last = start
        for index in range(start, len(text)):
            char = text[index]
            if quoted:
                if escaped:
                    escaped = False
                elif char == "\\":
                    escaped = True
                elif char == '"':
                    quoted = False
            elif char == '"':
                quoted = True
            elif char == "(":
                depth += 1
            elif char == ")":
                if depth == 0:
                    args.append(text[last:index].strip())
                    break
                depth -= 1
            elif char == "," and depth == 0:
                args.append(text[last:index].strip())
                last = index + 1
        if len(args) == 5 and re.fullmatch(r"\w+", args[1]):
            yield args


def prepare():
    inc = GENERATED / 'include'
    inc.mkdir(parents=True, exist_ok=True)
    # The include directory is regenerated on each prepare.
    for old in inc.glob('*.h'):
        old.unlink()
    combined = ''
    includes = set()
    for name in HEADERS:
        text = (UPSTREAM / 'include' / name).read_text(encoding='utf-8')
        if name == 're.h':
            text = text.replace('"compat/regex.h"', '<regex.h>')
        combined += text
        includes.update(re.findall(r'^#include "([^"\n]+)"', text, re.M))
        if name == 'modem.h':
            text = re.sub(r'^#include "(?:threads|sound|digiscope|plot_xy)\.h"', '#include "web_compat.h"', text, flags=re.M)
        (inc/name).write_text(text, encoding='utf-8')
    for name in SOURCES:
        text = (UPSTREAM/name).read_text(encoding='utf-8')
        if name == 'wefax/wefax.cxx':
            text = stream_fax(isolate_receive_state(text)).replace('#include "wefax-pic.h"', '#include "web_wefax.h"')
            # Auto needs protocol evidence, not the desktop spectrum heuristics
            # which also enter image state on unrelated tones or noise.
            text = text.replace('fax_state m_rx_state ;', 'int m_web_detected=0;\n\tfax_state m_rx_state ;')
            apt = '\t\t\t\tskip_apt_rx();\n\t\t\t\tPUT_STATUS(state_rx_str() << ", " << _("frequency")'
            if text.count(apt) != 1:
                raise RuntimeError('Changed WEFAX APT confirmation')
            text = text.replace(apt, '\t\t\t\tskip_apt_rx();\n\t\t\t\tm_web_detected=1;\n\t\t\t\tPUT_STATUS(state_rx_str() << ", " << _("frequency")')
            text = text.replace('skip_apt_rx();\n\t\t\t\t\tLOG_VERBOSE("Start, start:', 'skip_apt_rx();\n\t\t\t\t\tm_web_detected=1;\n\t\t\t\t\tLOG_VERBOSE("Start, start:')
            text = text.replace('++m_phase_lines;', '++m_phase_lines;\n\t\t\tif(m_web_detected && m_phase_lines>=4)m_web_detected=2;')
            text = text.replace('if (m_phase_lines >= 4 /* Was 4 */) {', '''if (m_phase_lines >= 4 /* Was 4 */) {
                if(web_fax_auto && m_web_detected==2) {
                    const double measured=m_lpm_sum_rx/m_phase_lines;
                    int best=0;
                    for(int speed=1;speed<4;speed++)
                        if(std::abs(measured-all_lpm_values[speed].m_value)<std::abs(measured-all_lpm_values[best].m_value))best=speed;
                    if(std::abs(measured-all_lpm_values[best].m_value)<all_lpm_values[best].m_value*.08)
                        progdefaults.wefax_lpm_576=progdefaults.wefax_lpm_288=best;
                }''')
            # 240 LPM has a 0.25-second phasing period. Desktop's 0.4-second
            # minimum prevents its advertised fast mode from acquiring phasing.
            text = text.replace('m_curr_phase_len >= 0.4 * m_sample_rate', 'm_curr_phase_len >= (web_fax_auto && m_web_detected && m_rx_state==RXPHASING ? 0.2 : 0.4) * m_sample_rate')
            text = text.replace('void fax_implementation::end_rx(void)\n{', 'void fax_implementation::end_rx(void)\n{\n\tm_web_detected=0;')
            # The selected browser line speed also drives native correlation/AFC
            # estimates, which otherwise retain the constructor's old setting.
            text = text.replace('m_lpm_img = all_lpm_values[index].m_value;;', 'm_lpm_img = all_lpm_values[index].m_value;\n\t\tm_default_lpm = m_lpm_img;')
            start = text.index('void wefax::qso_rec_save(void)')
            end = text.index('void wefax::set_freq(double freq)', start)
            text = text[:start]+'void wefax::qso_rec_save(void){}\n'+text[end:]
            for callback in ['wefax_pic::resize_rx_viewer','wefax_pic::update_rx_pic_bw']:
                text = re.sub(r'REQ\(\s*'+re.escape(callback)+r'\s*,', callback+'(', text)
            # Publish every received page before native counters reset, including
            # pages below desktop's automatic-save size/statistics threshold.
            text = text.replace('void fax_implementation::end_rx(void)\n{', 'void fax_implementation::end_rx(void)\n{\n\tweb_fax_complete();')
            text = text.replace('void fax_implementation::skip_apt_rx(void)\n{', 'void fax_implementation::skip_apt_rx(void)\n{\n\tweb_fax_complete();\n\tweb_fax_new_page(m_img_width);')
            text = text.replace('void fax_implementation::skip_phasing_to_image(bool auto_center)\n{', 'void fax_implementation::skip_phasing_to_image(bool auto_center)\n{\n\tweb_fax_begin_image(m_img_width);')
            # Upstream saves and resets even when its UI decides not to keep a page.
            marker = 'void fax_implementation::save_automatic('
            start = text.index(marker)
            brace = text.index('{', start)
            text = text[:brace + 1] + '\n\tweb_fax_complete();' + text[brace + 1:]
            # Expose the native receive state without translating display text.
            text = text.replace('std::string state_string(void) const {', 'int web_rx_detected() const { return m_web_detected; }\n\tint web_rx_state() const { return m_rx_state; }\n\tstd::string state_string(void) const {')
            text += '\nint wefax::web_rx_state() const { return m_impl->web_rx_state(); }\n'
            text += '\nint wefax::web_rx_detected() const { return m_impl->web_rx_detected(); }\n'
        combined += text
        includes.update(re.findall(r'^#include "([^"\n]+)"', text, re.M))
        (GENERATED/Path(name).name).write_text(text, encoding='utf-8')
    header=inc/'wefax.h'
    header.write_text(header.read_text(encoding='utf-8').replace('std::string state_string(void) const;', 'int web_rx_detected() const;\n\tint web_rx_state() const;\n\tstd::string state_string(void) const;'), encoding='utf-8')
    for name in includes:
        if name in HEADERS or name == 'web_wefax.h':
            continue
        if name.endswith('.h') and '/' not in name or name.startswith('FL/'):
            target = inc / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text('#pragma once\n#include "web_compat.h"\n')
    (inc/'config.h').write_text('#pragma once\n#define BENCHMARK_MODE 0\n#define HAVE_STD_BIND 1\n#define HAVE_STD_HASH 1\n#define HAVE_CLOCK_GETTIME 1\n#include "web_compat.h"\n')
    base=(UPSTREAM/'trx/modem.cxx').read_text(encoding='utf-8')
    quality=re.search(r'int modem::get_quality\(int mode\).*?return get_quality\(mode\);\s*}',base,re.S).group(0)
    (inc/'web_modem_quality.h').write_text(quality+'\n')
    modulation=base[base.index('void modem::ModulateXmtr'):]
    envelope=modulation[modulation.index('\tint num ='):modulation.index('\tif (progdefaults.PTTrightchannel)')]
    level=modulation[modulation.index('\tdouble mult ='):modulation.index('\n\ttry {')]
    transmit = 'void modem::ModulateXmtr(double* buffer,int len) {\nif(!buffer||len<1)return;\ntx_sample_rate=samplerate;tx_sample_count+=len;\nconst double SIGLIMIT=0.95;\n' + envelope + level + '\nweb_tx_audio(buffer,len);\n}\n'
    (inc/'web_modem_transmit.h').write_text(transmit)
    combined += quality+transmit+(ROOT/'adapters/web_modem.cpp').read_text(encoding='utf-8')
    combined += (ROOT/'adapters/core.cpp').read_text(encoding='utf-8')
    combined = re.sub(r'/\*.*?\*/|//[^\n]*', '', combined, flags=re.S)
    fields = set(re.findall(r'progdefaults\.(\w+)', combined))
    values = {args[1]: args for args in elements((UPSTREAM / 'include/configuration.h').read_text(encoding='utf-8'))}
    config = ['#pragma once', 'struct WebConfiguration {']
    for name in sorted(fields):
        kind,_,_,_,default=values[name]
        config.append(f'    {kind} {name} = {default};')
    config.append('};\nextern WebConfiguration progdefaults;\n')
    (inc/'web_configuration.h').write_text('\n'.join(config))
    status_fields = set(re.findall(r'progStatus\.(\w+)', combined))
    status_text = (UPSTREAM / 'include/status.h').read_text(encoding='utf-8')
    status = ['#pragma once', 'struct WebStatus {']
    for name in sorted(status_fields):
        match = re.search(r'\b(bool|double|float|int|std::string)\s+' + name + r'\s*;', status_text)
        status.append(f'    {match[1]} {name} {{}};')
    status.append('};\nextern WebStatus progStatus;\n')
    (inc/'web_status.h').write_text('\n'.join(status))
    source = (UPSTREAM / 'globals/globals.cxx').read_text(encoding='utf-8')
    table = re.search(r'const struct mode_info_t mode_info\[NUM_MODES\] = \{(.*?)\n\};', source, re.S).group(1)
    table = re.sub(r'&\w+', 'nullptr', table)
    table = re.sub(r'\b(?:DISABLED_IO|ARQ_IO|KISS_IO)\b', '0', table)
    (GENERATED/'mode_table.cpp').write_text('#include "web_compat.h"\nconst struct mode_info_t mode_info[NUM_MODES] = {'+table+'\n};\n')
    return GENERATED

if __name__ == '__main__':
    prepare()
