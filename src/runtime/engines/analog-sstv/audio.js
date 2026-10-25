/* Browser audio boundary; dependency-free WAV/MMV reading and streaming resampling. */
(function (root) {
    'use strict';
    function readWav(buffer, channel = 'left') {
        const v = new DataView(buffer),
            ascii = (n, s) => String.fromCharCode(...new Uint8Array(buffer, n, s));
        if (v.byteLength < 12 || ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WAVE') return null;
        let format,
            blocks = [];
        for (let p = 12; p + 8 <= v.byteLength;) {
            const tag = ascii(p, 4),
                length = v.getUint32(p + 4, true),
                start = p + 8;
            if (length > v.byteLength - start) throw new Error('The WAV file is truncated.');
            if (tag === 'fmt ') {
                if (length < 16) throw new Error('Invalid WAV format header.');
                let type = v.getUint16(start, true);
                if (type === 0xfffe && length >= 40) type = v.getUint16(start + 24, true);
                format = {
                    type,
                    channels: v.getUint16(start + 2, true),
                    rate: v.getUint32(start + 4, true),
                    align: v.getUint16(start + 12, true),
                    bits: v.getUint16(start + 14, true)
                };
            }
            if (tag === 'data') blocks.push({ start, length });
            p = start + length + (length & 1);
        }
        if (!format || !blocks.length) throw new Error('The WAV file has no audio data.');
        const { type, channels, rate, align, bits } = format;
        if (![1, 3].includes(type)) return null; // Let Web Audio decode compressed WAV formats.
        if (
            channels < 1 ||
            channels > 32 ||
            rate < 4000 ||
            rate > 384000 ||
            ![8, 16, 24, 32, 64].includes(bits) ||
            align < channels * (bits / 8) ||
            (type === 3 && ![32, 64].includes(bits)) ||
            (type === 1 && bits === 64)
        )
            throw new Error('Unsupported WAV format.');
        const count = blocks.reduce((n, b) => n + Math.floor(b.length / align), 0),
            samples = new Float32Array(count);
        const read = (p) => {
            if (type === 3) return bits === 32 ? v.getFloat32(p, true) : v.getFloat64(p, true);
            if (bits === 8) return (v.getUint8(p) - 128) / 128;
            if (bits === 16) return v.getInt16(p, true) / 32768;
            if (bits === 24) {
                let x = v.getUint8(p) | (v.getUint8(p + 1) << 8) | (v.getInt8(p + 2) << 16);
                return x / 8388608;
            }
            return v.getInt32(p, true) / 2147483648;
        };
        let i = 0;
        for (const block of blocks)
            for (let p = block.start; p + align <= block.start + block.length; p += align) {
                let value = 0;
                if (channel === 'mix') {
                    for (let c = 0; c < channels; c++) value += read(p + (c * bits) / 8) / channels;
                } else value = read(p + (channel === 'right' && channels > 1 ? bits / 8 : 0));
                samples[i++] = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
            }
        return { samples, rate, channels, duration: count / rate };
    }

    function readMmv(buffer) {
        // CWaveFile::Rec / Play in the original Sound.cpp: four-byte header,
        // followed by little-endian, signed 16-bit mono PCM. Legacy files are
        // headerless 11025 Hz PCM; select this reader only for the .mmv extension.
        const view = new DataView(buffer),
            rates = [11025, 8000, 6000, 12000, 16000, 18000, 22050, 24000, 44100, 48000];
        const header = view.byteLength >= 4 && view.getUint8(0) === 0x55 && view.getUint8(1) === 0xaa;
        const type = header ? view.getUint8(2) : 0,
            start = header ? 4 : 0;
        if (header && type >= rates.length) throw new Error('Invalid MMV sample-rate header.');
        if ((view.byteLength - start) % 2 || view.byteLength <= start)
            throw new Error('The MMV recording is empty or truncated.');
        const samples = new Float32Array((view.byteLength - start) / 2),
            rate = rates[type];
        for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(start + i * 2, true) / 32768;
        return { samples, rate, channels: 1, duration: samples.length / rate };
    }

    class Resampler {
        constructor(inputRate, outputRate = 11025) {
            if (!Number.isFinite(inputRate) || inputRate < 4000 || inputRate > 384000)
                throw new Error('Invalid input sample rate.');
            this.inputRate = inputRate;
            this.outputRate = outputRate;
            this.step = inputRate / outputRate;
            this.half = Math.ceil(24 * Math.max(1, this.step));
            this.base = 0;
            this.total = 0;
            this.index = 0;
            this.buffer = new Float32Array(0);
            this.ended = false;
            const phases = 1024,
                taps = this.half * 2,
                cutoff = Math.min(1, outputRate / inputRate) * 0.9;
            this.filters = new Float64Array(phases * taps);
            for (let phase = 0; phase < phases; phase++) {
                let sum = 0;
                for (let t = 0; t < taps; t++) {
                    const x = t - this.half + 1 - phase / phases;
                    const sinc = Math.abs(x) < 1e-9 ? cutoff : Math.sin(Math.PI * x * cutoff) / (Math.PI * x);
                    const window =
                        0.42 +
                        0.5 * Math.cos((Math.PI * x) / this.half) +
                        0.08 * Math.cos((2 * Math.PI * x) / this.half);
                    const coefficient = sinc * window;
                    this.filters[phase * taps + t] = coefficient;
                    sum += coefficient;
                }
                for (let t = 0; t < taps; t++) this.filters[phase * taps + t] /= sum;
            }
        }
        push(input, final = false) {
            if (this.ended) throw new Error('The audio resampler has already finished.');
            const joined = new Float32Array(this.buffer.length + input.length);
            joined.set(this.buffer);
            joined.set(input, this.buffer.length);
            this.buffer = joined;
            this.total += input.length;
            const result = [],
                taps = this.half * 2,
                end = final ? Math.round(this.total / this.step) : Infinity;
            while (this.index < end) {
                const position = this.index * this.step,
                    center = Math.floor(position);
                if (!final && center + this.half >= this.total) break;
                const phase = Math.min(1023, Math.floor((position - center) * 1024));
                let value = 0;
                for (let t = 0; t < taps; t++) {
                    const n = center - this.half + 1 + t;
                    const sample = n < 0 ? this.buffer[0] || 0 : n >= this.total ? 0 : this.buffer[n - this.base];
                    value += (sample || 0) * this.filters[phase * taps + t];
                }
                result.push(value);
                this.index++;
            }
            const keep = Math.max(this.base, Math.min(this.total, Math.floor(this.index * this.step) - this.half));
            this.buffer = this.buffer.slice(keep - this.base);
            this.base = keep;
            this.ended = final;
            return new Float32Array(result);
        }
    }
    function downmix(buffer, channel = 'left') {
        const output = new Float32Array(buffer.length);
        if (channel === 'mix')
            for (let c = 0; c < buffer.numberOfChannels; c++) {
                const values = buffer.getChannelData(c);
                for (let i = 0; i < output.length; i++) output[i] += values[i] / buffer.numberOfChannels;
            }
        else output.set(buffer.getChannelData(channel === 'right' && buffer.numberOfChannels > 1 ? 1 : 0));
        return output;
    }
    function bmp(rgba, width, height) {
        const stride = (width * 3 + 3) & ~3,
            out = new Uint8Array(54 + stride * height),
            v = new DataView(out.buffer);
        out[0] = 66;
        out[1] = 77;
        v.setUint32(2, out.length, true);
        v.setUint32(10, 54, true);
        v.setUint32(14, 40, true);
        v.setInt32(18, width, true);
        v.setInt32(22, height, true);
        v.setUint16(26, 1, true);
        v.setUint16(28, 24, true);
        v.setUint32(34, stride * height, true);
        for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++) {
                const i = (y * width + x) * 4,
                    j = 54 + (height - 1 - y) * stride + x * 3;
                out[j] = rgba[i + 2];
                out[j + 1] = rgba[i + 1];
                out[j + 2] = rgba[i];
            }
        return out;
    }
    function wav(chunks, rate = 11025) {
        const length = chunks.reduce((n, chunk) => n + chunk.byteLength, 0);
        if (length > 0xffffffff - 36 || length % 2) throw new Error('Invalid PCM audio length.');
        const header = new Uint8Array(44),
            v = new DataView(header.buffer);
        const ascii = (p, s) => [...s].forEach((c, i) => (header[p + i] = c.charCodeAt(0)));
        ascii(0, 'RIFF');
        v.setUint32(4, length + 36, true);
        ascii(8, 'WAVEfmt ');
        v.setUint32(16, 16, true);
        v.setUint16(20, 1, true);
        v.setUint16(22, 1, true);
        v.setUint32(24, rate, true);
        v.setUint32(28, rate * 2, true);
        v.setUint16(32, 2, true);
        v.setUint16(34, 16, true);
        ascii(36, 'data');
        v.setUint32(40, length, true);
        return new Blob([header, ...chunks], { type: 'audio/wav' });
    }
    const api = { readWav, readMmv, Resampler, downmix, bmp, wav };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.MMSAudio = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
