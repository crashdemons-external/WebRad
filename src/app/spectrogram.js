/** Computes a bounded time/frequency overview from overlapping windows of mono PCM. */
export class Spectrogram {
    /** Number of time columns retained in the overview. */
    static WIDTH = 1024;
    /** Number of logarithmic frequency bands. */
    static HEIGHT = 256;
    /** Lowest displayed frequency in hertz. */
    static MIN_FREQUENCY = 80;
    /** Highest displayed frequency in hertz. */
    static MAX_FREQUENCY = 4000;
    /** Input samples per second. */
    rate;
    /** Recording offset represented by the left edge, in seconds. */
    startSeconds;
    /** Time span represented by the full width, in seconds. */
    duration;
    /** Whether the timeline expands as live audio arrives. */
    live;
    /** Row-major intensity bytes, with low frequencies at the bottom. */
    levels;
    /** Power-of-two transform length, approximately 46 milliseconds of input. */
    size;
    /** Samples between windows, approximately 10 milliseconds. */
    hop;
    /** Hann window coefficients. */
    window;
    /** Bit-reversed input indices for the radix-two transform. */
    reversed;
    /** Transform real components. */
    real;
    /** Transform imaginary components. */
    imaginary;
    /** One window's frequency-band intensities. */
    bands;
    /** PCM retained across block boundaries, including initial centering padding. */
    pending;
    /** Number of real input samples received. */
    samples;
    /** Number of windows already analyzed. */
    frames;
    /** Whether final centering padding has been processed. */
    finished;

    /**
     * Prepare analysis without retaining the full recording.
     * @param {number} rate Input sample rate in hertz.
     * @param {number} duration Recording length in seconds, or zero for live input.
     * @param {number} startSeconds Recording range's starting time in seconds.
     */
    constructor(rate, duration = 0, startSeconds = 0) {
        this.rate = rate;
        this.startSeconds = startSeconds;
        this.duration = duration || 10;
        this.live = !duration;
        this.levels = new Uint8Array(Spectrogram.WIDTH * Spectrogram.HEIGHT);
        this.size = 2 ** Math.max(5, Math.round(Math.log2(rate * 0.046)));
        this.hop = Math.max(1, Math.round(rate * 0.01));
        this.window = Float64Array.from({ length: this.size }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / this.size));
        this.reversed = new Uint32Array(this.size);
        for (let i = 1; i < this.size; i++) {
            this.reversed[i] = (this.reversed[i >> 1] >> 1) | ((i & 1) * (this.size / 2));
        }
        this.real = new Float64Array(this.size);
        this.imaginary = new Float64Array(this.size);
        this.bands = new Uint8Array(Spectrogram.HEIGHT);
        this.pending = new Float32Array(this.size / 2);
        this.samples = 0;
        this.frames = 0;
        this.finished = false;
    }

    /** Convert vertical position (zero at the top) to the displayed frequency in hertz. */
    static frequencyAt(position) {
        const fraction = Math.max(0, Math.min(1, position));
        return Spectrogram.MIN_FREQUENCY * (Spectrogram.MAX_FREQUENCY / Spectrogram.MIN_FREQUENCY) ** (1 - fraction);
    }

    /** Append input before its buffer is transferred to a decoder worker. */
    append(samples) {
        if (this.finished || !samples.length) return;
        this.samples += samples.length;
        this.processWindows(samples);
    }

    /** Analyze the final half-window, including recordings shorter than one window. */
    finish() {
        if (this.finished) return;
        this.processWindows(new Float32Array(this.size / 2));
        this.finished = true;
        this.pending = new Float32Array(0);
    }

    /** Join block edges and analyze centered windows on the input's sample clock. */
    processWindows(samples) {
        const buffer = new Float32Array(this.pending.length + samples.length);
        buffer.set(this.pending);
        buffer.set(samples, this.pending.length);
        let offset = 0;
        while (offset + this.size <= buffer.length && this.frames * this.hop < this.samples) {
            this.transform(buffer, offset);
            this.readBands();
            this.retainColumn();
            this.frames++;
            offset += this.hop;
        }
        this.pending = buffer.slice(offset);
    }

    /** Apply the Hann window and an in-place radix-two FFT without changing input PCM. */
    transform(buffer, offset) {
        for (let i = 0; i < this.size; i++) {
            const sample = buffer[offset + i];
            this.real[this.reversed[i]] = Number.isFinite(sample) ? sample * this.window[i] : 0;
        }
        this.imaginary.fill(0);
        for (let width = 2; width <= this.size; width *= 2) {
            const half = width / 2;
            const rotationReal = Math.cos(-2 * Math.PI / width);
            const rotationImaginary = Math.sin(-2 * Math.PI / width);
            for (let start = 0; start < this.size; start += width) {
                let factorReal = 1;
                let factorImaginary = 0;
                for (let i = start; i < start + half; i++) {
                    const other = i + half;
                    const real = factorReal * this.real[other] - factorImaginary * this.imaginary[other];
                    const imaginary = factorReal * this.imaginary[other] + factorImaginary * this.real[other];
                    this.real[other] = this.real[i] - real;
                    this.imaginary[other] = this.imaginary[i] - imaginary;
                    this.real[i] += real;
                    this.imaginary[i] += imaginary;
                    const nextReal = factorReal * rotationReal - factorImaginary * rotationImaginary;
                    factorImaginary = factorReal * rotationImaginary + factorImaginary * rotationReal;
                    factorReal = nextReal;
                }
            }
        }
    }

    /** Map peak power in each frequency band to a fixed -90 through 0 dBFS color range. */
    readBands() {
        const normalization = 16 / (this.size * this.size);
        for (let y = 0; y < Spectrogram.HEIGHT; y++) {
            const first = Math.max(1, Math.floor(Spectrogram.frequencyAt((y + 1) / Spectrogram.HEIGHT) * this.size / this.rate));
            const last = Math.min(this.size / 2, Math.ceil(Spectrogram.frequencyAt(y / Spectrogram.HEIGHT) * this.size / this.rate));
            let power = 0;
            for (let bin = first; bin <= last; bin++) {
                power = Math.max(power, this.real[bin] ** 2 + this.imaginary[bin] ** 2);
            }
            const decibels = 10 * Math.log10(Math.max(1e-12, power * normalization));
            this.bands[y] = Math.round(Math.max(0, Math.min(1, (decibels + 90) / 90)) * 255);
        }
    }

    /** Keep peak intensity per time pixel, expanding live timelines without dropping older audio. */
    retainColumn() {
        const time = this.frames * this.hop / this.rate;
        const end = Math.min(this.samples / this.rate, time + this.hop / this.rate);
        while (this.live && end > this.duration) this.expandTimeline();
        const first = Math.min(Spectrogram.WIDTH - 1, Math.floor(time / this.duration * Spectrogram.WIDTH));
        const last = Math.min(Spectrogram.WIDTH, Math.ceil(end / this.duration * Spectrogram.WIDTH));
        for (let y = 0; y < Spectrogram.HEIGHT; y++) {
            const row = y * Spectrogram.WIDTH;
            for (let x = first; x < last; x++) {
                this.levels[row + x] = Math.max(this.levels[row + x], this.bands[y]);
            }
        }
    }

    /** Double a live timeline's span by combining adjacent time columns in place. */
    expandTimeline() {
        for (let y = 0; y < Spectrogram.HEIGHT; y++) {
            const row = y * Spectrogram.WIDTH;
            for (let x = 0; x < Spectrogram.WIDTH / 2; x++) {
                this.levels[row + x] = Math.max(this.levels[row + x * 2], this.levels[row + x * 2 + 1]);
            }
            this.levels.fill(0, row + Spectrogram.WIDTH / 2, row + Spectrogram.WIDTH);
        }
        this.duration *= 2;
    }
}
