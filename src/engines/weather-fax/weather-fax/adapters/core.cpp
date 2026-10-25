// GPL-3.0-or-later. WEFAX browser boundary adapted from fldigi-web.
#include <emscripten/emscripten.h>
#include <memory>
#include "web_compat.h"
#include "wefax.h"
#include "web_wefax.h"

WebConfiguration progdefaults;
WebStatus progStatus;
waterfall waterfall_instance;
waterfall* wf = &waterfall_instance;
modem* active_modem = nullptr;
bool web_fax_auto = false;
static std::unique_ptr<wefax> fax;
static int mode = 0, width = 1809, height = 1, line = 0, serial = 0, revision = 0, completed = 0;
static int finishedWidth = 0, finishedHeight = 0, finishedMode = 0, finishedSerial = 0;
static bool closed = false, txDone = true, manual = false;
static std::vector<unsigned char> pixels, finishedPixels, txPixels;
static std::vector<float> txSamples;
static size_t txRead = 0;
static size_t pixelCount = 0;
static std::array<size_t, 256> grayCounts{};
static double txTotal = 0, level = 0;
static g_fft<double> fft(8192);
static std::array<double, 8192> fft_ring{};
static std::array<cmplx, 8192> fft_buffer{};
static std::array<int, 1024> spectrum{};
static int fft_write = 0, fft_count = 0;

void web_fax_new_page(int w) {
    width = w;
    height = 1;
    line = 0;
    pixels.assign(size_t(width) * 4, 255);
    pixelCount = 0;
    grayCounts.fill(0);
    closed = false;
    ++serial;
    ++revision;
}
void web_fax_begin_image(int w) {
    if (closed) web_fax_new_page(w);
}
void web_fax_complete(bool force) {
    if (closed || !line) return;
    closed = true;
    // Native phasing may briefly enter image state. Its black/white edge bars
    // should not create history pages; explicit Stop still retains blank pages.
    size_t count = 0;
    for (const auto n : grayCounts) count += n;
    const size_t trim = count / 50;
    size_t sum = 0;
    int low = 0, high = 255;
    for (; low < 255; low++) {
        sum += grayCounts[low];
        if (sum > trim) break;
    }
    sum = 0;
    for (; high > 0; high--) {
        sum += grayCounts[high];
        if (sum > trim) break;
    }
    if (!force && high - low < 16) {
        line = 0;
        height = 1;
        pixels.assign(size_t(width) * 4, 255);
        ++revision;
        return;
    }
    finishedPixels = pixels;
    finishedWidth = width;
    finishedHeight = height;
    finishedMode = mode;
    finishedSerial = serial;
    ++completed;
}
void web_image_gray(int value, int offset, int w) {
    if (closed || offset < 0 || offset % 3 || w != width) return;
    const size_t pixel = size_t(offset) / 3;
    if (pixel >= size_t(width) * 8192) return;
    const int rows = int(pixel / width) + 1;
    if (rows > height) {
        height = rows;
        pixels.resize(size_t(width) * height * 4, 255);
    }
    const unsigned char gray = clamp(value, 0, 255);
    if (pixel % width > size_t(width / 10) && pixel % width < size_t(width * 9 / 10)) ++grayCounts[gray];
    for (int c = 0; c < 3; c++) pixels[pixel * 4 + c] = gray;
    pixelCount = std::max(pixelCount, pixel + 1);
    line = rows;
    ++revision;
}
void web_tx_audio(const double* data, int length) {
    for (int i = 0; i < length; i++) txSamples.push_back(std::isfinite(data[i]) ? float(data[i]) : 0);
}
void put_Status1(const char*, int, int) {}
void put_Status2(const char*, int, int) {}
void put_MODEstatus(trx_mode) {}
void put_echo_char(unsigned int) {}
void put_rx_char(unsigned int, int) {}
void set_scope_mode(Digiscope::scope_mode) {}
int get_tx_char() { return GET_TX_CHAR_ETX; }

double waterfall::powerDensity(double f, double span) const {
    const int low = int(f - span / 2), high = int(f + span / 2);
    if (low < 0 || high > 4000 || span < 0) return 0;
    double sum = 0;
    for (int i = low; i <= high; i++) sum += powers[i];
    return sum / (span + 1);
}
double waterfall::powerDensityMaximum(int count, const int (*bands)[2]) const {
    if (count < 1) return carrier;
    std::vector<int> peaks(count, int(carrier));
    std::vector<double> energy(count, 0);
    double total = 0;
    for (int i = 0; i < count; i++) {
        double maximum = 0;
        for (int hz = std::max(0, int(carrier + bands[i][0])); hz < std::min(4000, int(carrier + bands[i][1])); hz++) {
            energy[i] += powers[hz];
            if (powers[hz] > maximum) {
                maximum = powers[hz];
                peaks[i] = hz;
            }
        }
        if (energy[i] == 0) return carrier;
        total += energy[i];
    }
    int mid = 0;
    for (int i = 0; i < count; i++) mid += peaks[i] * energy[i] / total;
    return mid;
}
static void update_spectrum(const double* data, int length) {
    double sum = 0;
    for (int i = 0; i < length; i++) {
        sum += data[i] * data[i];
        fft_ring[fft_write] = data[i];
        fft_write = (fft_write + 1) % 8192;
    }
    level = std::sqrt(sum / length);
    fft_count += length;
    if (fft_count < 512) return;
    fft_count %= 512;
    static std::array<double, 8192> window{};
    static bool ready = false;
    if (!ready) {
        BlackmanWindow(window.data(), 8192);
        ready = true;
    }
    for (int i = 0; i < 8192; i++) fft_buffer[i] = fft_ring[(fft_write + i) % 8192] * window[i] * (2.0 / 8192);
    fft.ComplexFFT(fft_buffer.data());
    for (int hz = 0; hz < 8192; hz++) {
        int bin = int(std::round(hz * 8192.0 / 11025));
        wf->powers[hz] = hz > progdefaults.LowFreqCutoff && bin < 4096 ? std::norm(fft_buffer[bin]) : 0;
    }
    // Match the shared 2048-point spectrum's bin spacing and display height.
    for (int i = 0; i < 1024; i++) spectrum[i] = int(clamp((10 * log10(std::norm(fft_buffer[i * 4]) + 1e-10) + 80) * 2.5, 0.0, 200.0));
}
extern "C" {
EMSCRIPTEN_KEEPALIVE int fax_reset(int selected) {
    if (selected < 0 || selected > 1) return 0;
    fax.reset();
    active_modem = nullptr;
    mode = selected;
    closed = true;
    manual = false;
    web_fax_auto = false;
    finishedWidth = finishedHeight = 0;
    finishedPixels.clear();
    wf->carrier = 1900;
    wf->powers.fill(0);
    fft_ring.fill(0);
    spectrum.fill(0);
    fft_write = fft_count = 0;
    level = 0;
    progdefaults.WEFAX_MaxRows = 8192;
    fax = std::make_unique<wefax>(selected ? MODE_WEFAX_288 : MODE_WEFAX_576);
    active_modem = fax.get();
    fax->init();
    return 1;
}
EMSCRIPTEN_KEEPALIVE void fax_process(const float* data, int length) {
    if (!fax || !data || length < 1 || length > 65536) return;
    for (int pos = 0; pos < length; pos += 512) {
        double block[512];
        int n = std::min(512, length - pos);
        for (int i = 0; i < n; i++) block[i] = std::isfinite(data[pos + i]) ? data[pos + i] : 0;
        update_spectrum(block, n);
        fax->rx_process(block, n);
    }
}
EMSCRIPTEN_KEEPALIVE void fax_option(int id, double value) {
    if (!std::isfinite(value)) return;
    if (id == 0) progStatus.afconoff = bool(value);
    if (id == 1 && value >= 0 && value <= 3 && value == int(value)) {
        progdefaults.wefax_lpm_576 = progdefaults.wefax_lpm_288 = int(value);
        if (fax) fax->set_lpm();
    }
    if (id == 2 && fax) fax->skip_apt();
    if (id == 3 && fax) fax->skip_phasing(false);
    if (id == 4 && fax) {
        web_fax_complete(true);
        fax->end_reception();
        if (manual) {
            fax->skip_apt();
            fax->skip_phasing(false);
        }
    }
    if (id == 5 && fax && value >= 1500 && value <= 2300) fax->set_freq(value);
    if (id == 6 && fax) {
        manual = bool(value);
        fax->set_rx_manual_mode(manual);
        if (manual && fax->web_rx_state() != 3) {
            fax->skip_apt();
            fax->skip_phasing(false);
        } else if (!manual && fax->web_rx_state() == 3) {
            web_fax_complete(true);
            fax->end_reception();
        }
    }
    if (id == 7) web_fax_auto = bool(value);
}
EMSCRIPTEN_KEEPALIVE void fax_finish(int force) {
    web_fax_complete(force || manual);
    if (fax) fax->end_reception();
}
EMSCRIPTEN_KEEPALIVE int fax_state() {
    return fax ? fax->web_rx_state() : 0;
}
EMSCRIPTEN_KEEPALIVE int fax_detected() {
    return fax ? fax->web_rx_detected() : 0;
}
EMSCRIPTEN_KEEPALIVE int fax_width() { return width; }
EMSCRIPTEN_KEEPALIVE int fax_height() { return height; }
EMSCRIPTEN_KEEPALIVE int fax_line() { return line; }
EMSCRIPTEN_KEEPALIVE int fax_serial() { return serial; }
EMSCRIPTEN_KEEPALIVE int fax_revision() { return revision; }
EMSCRIPTEN_KEEPALIVE int fax_completed() { return completed; }
EMSCRIPTEN_KEEPALIVE const unsigned char* fax_pixels() { return pixels.data(); }
EMSCRIPTEN_KEEPALIVE const unsigned char* fax_finished_pixels() { return finishedPixels.data(); }
EMSCRIPTEN_KEEPALIVE int fax_finished_width() { return finishedWidth; }
EMSCRIPTEN_KEEPALIVE int fax_finished_height() { return finishedHeight; }
EMSCRIPTEN_KEEPALIVE int fax_finished_mode() { return finishedMode; }
EMSCRIPTEN_KEEPALIVE int fax_finished_serial() { return finishedSerial; }
EMSCRIPTEN_KEEPALIVE double fax_level() { return level; }
EMSCRIPTEN_KEEPALIVE double fax_frequency() { return modem::frequency; }
EMSCRIPTEN_KEEPALIVE const int* fax_spectrum() { return spectrum.data(); }
EMSCRIPTEN_KEEPALIVE int fax_encode_start(int selected, const unsigned char* rgba, int w, int h, int format) {
    if (selected < 0 || selected > 1 || !rgba || w != (selected ? 904 : 1809) || h < 1 || h > 8192 || format < 0 || format > 3) return 0;
    const int lpm = all_lpm_values[format].m_value;
    txTotal = 11025 * 20 + int(11025 * 60.0 / lpm) * (h + 21);
    if (txTotal > 11025 * 1800) return 0;
    progdefaults.wefax_lpm_576 = progdefaults.wefax_lpm_288 = format;
    fax_reset(selected);
    txPixels.resize(size_t(w) * h * 3);
    for (size_t i = 0; i < size_t(w) * h; i++) {
        int gray = (31 * rgba[i * 4] + 61 * rgba[i * 4 + 1] + 8 * rgba[i * 4 + 2]) / 100;
        gray = (gray * rgba[i * 4 + 3] + 255 * (255 - rgba[i * 4 + 3]) + 127) / 255;
        for (int c = 0; c < 3; c++) txPixels[i * 3 + c] = gray;
    }
    txDone = false;
    txSamples.clear();
    txRead = 0;
    modem::tx_sample_count = 0;
    progdefaults.TxOffset = 0;
    progStatus.txlevel = 0;
    trx_state = STATE_TX;
    fax->set_stopflag(false);
    fax->tx_init();
    fax->set_tx_parameters(lpm, txPixels.data(), false, w, h);
    return 1;
}
EMSCRIPTEN_KEEPALIVE int fax_encode_read(short* output, int maximum) {
    if (!output || maximum < 1 || maximum > 32768) return 0;
    int count = 0;
    while (count < maximum) {
        if (txRead == txSamples.size()) {
            txSamples.clear();
            txRead = 0;
            if (txDone) break;
            if (!fax || fax->tx_process() < 0) txDone = true;
            if (txSamples.empty() && txDone) break;
        }
        const size_t n = std::min(size_t(maximum - count), txSamples.size() - txRead);
        for (size_t i = 0; i < n; i++) output[count + i] = short(std::round(clamp(txSamples[txRead + i], -1.0f, 1.0f) * 32767));
        txRead += n;
        count += int(n);
    }
    return count;
}
EMSCRIPTEN_KEEPALIVE int fax_encode_done() {
    return txDone && txRead == txSamples.size();
}
EMSCRIPTEN_KEEPALIVE double fax_encode_progress() {
    return txTotal ? std::min(1.0, double(modem::tx_sample_count) / txTotal) : 0;
}
EMSCRIPTEN_KEEPALIVE void fax_encode_cancel() {
    if (fax) fax->set_tx_abort_flag();
    txDone = true;
    txSamples.clear();
    txRead = 0;
    txPixels.clear();
}
}

