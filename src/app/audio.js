import { Resampler } from '../runtime/engines/multimode/resampler.js';
/** Reads recordings, converts PCM and creates portable WAV files. */
export class AudioTools {
    /** Maximum accepted/generated audio duration in seconds. */
    static MAX_SECONDS = 1800;
    /**
     * Encode bounded mono floating-point samples as a little-endian 16-bit PCM WAV.
     * @param {Float32Array} samples PCM samples in their existing order.
     * @param {number} rate PCM sample rate in samples per second.
     * @returns {Uint8Array} Complete mono PCM WAV bytes.
     */
    static makeWav(samples, rate) {
        if (!samples.length || samples.length > rate * AudioTools.MAX_SECONDS)
            throw Error('Audio must be between one sample and 30 minutes.');
        const bytes = new Uint8Array(44 + samples.length * 2),
            v = new DataView(bytes.buffer);
        const tag = (at, s) => {
            for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i);
        };
        tag(0, 'RIFF');
        v.setUint32(4, bytes.length - 8, true);
        tag(8, 'WAVE');
        tag(12, 'fmt ');
        v.setUint32(16, 16, true);
        v.setUint16(20, 1, true);
        v.setUint16(22, 1, true);
        v.setUint32(24, rate, true);
        v.setUint32(28, rate * 2, true);
        v.setUint16(32, 2, true);
        v.setUint16(34, 16, true);
        tag(36, 'data');
        v.setUint32(40, samples.length * 2, true);
        for (let i = 0; i < samples.length; i++) {
            const s = Math.max(-1, Math.min(1, Number.isFinite(samples[i]) ? samples[i] : 0));
            v.setInt16(44 + i * 2, Math.round(s * (s < 0 ? 32768 : 32767)), true);
        }
        return bytes;
    }
    /**
     * Read supported PCM/float WAV channels while validating layout, truncation and memory bounds.
     * @param {ArrayBuffer} buffer Recording bytes to parse.
     * @returns {Object|null} PCM channels/rate/duration, or null for a non-PCM format.
     */
    static parseWav(buffer) {
        const v = new DataView(buffer),
            tag = (at) => String.fromCharCode(...new Uint8Array(buffer, at, 4));
        if (v.byteLength < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
        const { fmt, data } = AudioTools.readWavChunks(v, tag);
        const layout = AudioTools.readWavLayout(v, fmt, data);
        if (!layout) return null;
        const channels = AudioTools.readWavChannels(v, data.at, layout);
        return { channels, rate: layout.rate, duration: layout.count / layout.rate };
    }
    /** Find the format and sample chunks, including any RIFF padding. */
    static readWavChunks(v, tag) {
        let fmt, data;
        for (let at = 12; at + 8 <= v.byteLength;) {
            const size = v.getUint32(at + 4, true);
            if (at + 8 + size > v.byteLength) throw Error('This WAV is truncated.');
            const name = tag(at);
            if (name === 'fmt ') fmt = { at: at + 8, size };
            if (name === 'data') data = { at: at + 8, size };
            at += 8 + size + (size & 1);
        }
        if (!fmt || fmt.size < 16 || !data) throw Error('The WAV has no audio samples or format information.');
        return { fmt, data };
    }
    /** Read the sample layout and check its format and memory limits. */
    static readWavLayout(v, fmt, data) {
        let encoding = v.getUint16(fmt.at, true);
        const channels = v.getUint16(fmt.at + 2, true),
            rate = v.getUint32(fmt.at + 4, true),
            align = v.getUint16(fmt.at + 12, true),
            bits = v.getUint16(fmt.at + 14, true);
        if (encoding === 65534 && fmt.size >= 40) encoding = v.getUint16(fmt.at + 24, true);
        if (![1, 3].includes(encoding)) return null;
        if (
            channels < 1 ||
            channels > 32 ||
            rate < 1000 ||
            rate > 4000000 ||
            ![8, 16, 24, 32, 64].includes(bits) ||
            (encoding === 1 && bits === 64) ||
            align !== (channels * bits) / 8
        )
            throw Error('Unsupported or invalid PCM WAV layout.');
        const count = Math.floor(data.size / align);
        if (count > rate * AudioTools.MAX_SECONDS || count * channels > 128000000)
            throw Error('Recording exceeds the 30-minute or memory limit.');
        return { encoding, channels, rate, align, bits, count };
    }
    /** Deinterleave WAV samples into normalized floating-point channels. */
    static readWavChannels(v, start, { encoding, channels, align, bits, count }) {
        const values = Array.from({ length: channels }, () => new Float32Array(count));
        for (let i = 0; i < count; i++)
            for (let c = 0; c < channels; c++) {
                const at = start + i * align + (c * bits) / 8;
                const value = AudioTools.readWavSample(v, at, encoding, bits);
                values[c][i] = Number.isFinite(value) ? value : 0;
            }
        return values;
    }
    /** Read one PCM sample; unsupported float widths produce a silent sample. */
    static readWavSample(v, at, encoding, bits) {
        if (encoding === 3) {
            switch (bits) {
                case 64: return v.getFloat64(at, true);
                case 32: return v.getFloat32(at, true);
                default: return NaN;
            }
        }
        switch (bits) {
            case 8: return (v.getUint8(at) - 128) / 128;
            case 16: return v.getInt16(at, true) / 32768;
            case 24: {
                let x = v.getUint8(at) | (v.getUint8(at + 1) << 8) | (v.getUint8(at + 2) << 16);
                if (x & 0x800000) x -= 0x1000000;
                return x / 8388608;
            }
            default: return v.getInt32(at, true) / 2147483648;
        }
    }
    /**
     * Read PCM WAV/MMV directly or decode other browser-supported recordings with Web Audio.
     * @param {File} file Recording file to read.
     * @returns {Promise<Object>} Bounded recording channels and file metadata.
     */
    static async readAudio(file) {
        if (file.size > 512 * 1024 * 1024) throw Error('Choose a recording smaller than 512 MB.');
        const bytes = await file.arrayBuffer(),
            wav = AudioTools.parseWav(bytes);
        if (wav) return { ...wav, name: file.name };
        if (/\.mmv$/i.test(file.name)) {
            if (bytes.byteLength % 2) throw Error('MMV data must contain complete 16-bit samples.');
            const s = new Int16Array(bytes),
                f = Float32Array.from(s, (x) => x / 32768);
            if (f.length > 11025 * AudioTools.MAX_SECONDS) throw Error('Recording exceeds 30 minutes.');
            return { channels: [f], rate: 11025, duration: f.length / 11025, name: file.name };
        }
        const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!Ctx) throw Error('This browser cannot open this audio format. Try PCM WAV.');
        const ctx = new Ctx();
        try {
            const audio = await ctx.decodeAudioData(bytes);
            if (audio.duration > AudioTools.MAX_SECONDS || audio.length * audio.numberOfChannels > 128000000)
                throw Error('Recording exceeds the 30-minute or memory limit.');
            return {
                channels: Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i).slice()),
                rate: audio.sampleRate,
                duration: audio.duration,
                name: file.name
            };
        } finally {
            await ctx.close();
        }
    }
    /**
     * Select left/right PCM or average all channels for the mix option.
     * @param {Object} audio Recording channels, rate and duration metadata.
     * @param {string} channel Left, right or mixed channel selection.
     * @returns {Float32Array} Selected channel or newly mixed PCM.
     */
    static selectChannel(audio, channel = 'left') {
        if (channel === 'right') return audio.channels[1] || audio.channels[0];
        if (channel !== 'mix' || audio.channels.length === 1) return audio.channels[0];
        const out = new Float32Array(audio.channels[0].length);
        for (const c of audio.channels) for (let i = 0; i < out.length; i++) out[i] += c[i] / audio.channels.length;
        return out;
    }
    /**
     * Convert PCM to a requested sample rate, preserving the original array when rates match.
     * @param {Float32Array} samples PCM samples in their existing order.
     * @param {number} from Original PCM sample rate.
     * @param {number} to Requested PCM sample rate.
     * @returns {Float32Array} PCM at the requested rate.
     */
    static resample(samples, from, to) {
        if (from === to) return samples;
        const r = new Resampler(from, to);
        return r.process(samples);
    }
    /**
     * Concatenate floating-point PCM blocks in order without altering their samples.
     * @param {Float32Array[]} chunks PCM blocks in transmission or reception order.
     * @returns {Float32Array} Concatenated PCM in input order.
     */
    static joinChunks(chunks) {
        const n = chunks.reduce((a, c) => a + c.length, 0),
            out = new Float32Array(n);
        let at = 0;
        for (const c of chunks) {
            out.set(c, at);
            at += c.length;
        }
        return out;
    }
    /**
     * Convert little-endian signed 16-bit PCM bytes to normalized floating-point samples.
     * @param {Uint8Array} bytes PCM bytes to normalize.
     * @returns {Float32Array} Normalized signed-16 PCM.
     */
    static pcmFloat(bytes) {
        const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
            out = new Float32Array(bytes.length / 2);
        for (let i = 0; i < out.length; i++) out[i] = v.getInt16(i * 2, true) / 32768;
        return out;
    }
    /**
     * Format a finite duration as minutes and two-digit seconds.
     * @param {number} seconds Duration to format in minutes and seconds.
     * @returns {string} Duration label, with 0:00 for a nonfinite input.
     */
    static timeLabel(seconds) {
        if (!Number.isFinite(seconds)) return '0:00';
        const s = Math.max(0, Math.floor(seconds));
        return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }
}
/** Shifts PCM by a fixed frequency while retaining filter state across blocks.
 * @property {number} rate PCM sample rate in samples per second.
 * @property {number} hz Frequency translation in hertz.
 * @property {Float32Array} ring Circular buffer for filter history.
 * @property {number} at Next position in the circular buffer.
 * @property {number} phase Oscillator phase carried between samples.
 * @property {Float32Array} taps Hilbert filter coefficients.
 */
export class FrequencyShift {
    /**
     * Initialize the Hilbert filter and continuous oscillator.
     * @param {number} rate Incoming PCM sample rate in samples per second.
     * @param {number} hz Frequency translation in hertz.
     */
    constructor(rate, hz) {
        this.rate = rate;
        this.hz = hz;
        this.ring = new Float32Array(63);
        this.at = 0;
        this.phase = 0;
        this.taps = Float32Array.from({ length: 63 }, (_, i) => {
            const n = i - 31;
            return n && Math.abs(n) % 2 ? (2 / (Math.PI * n)) * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / 62)) : 0;
        });
    }
    /**
     * Shift this PCM block and retain filter state for the next call.
     * @param {Float32Array} samples PCM samples in their existing order.
     * @returns {Float32Array} Frequency-translated PCM block.
     */
    process(samples) {
        if (!this.hz) return samples;
        const out = new Float32Array(samples.length);
        for (let i = 0; i < samples.length; i++) {
            this.ring[this.at] = samples[i];
            let h = 0;
            for (let j = 0; j < 63; j++) h += this.taps[j] * this.ring[(this.at - j + 63) % 63];
            const x = this.ring[(this.at - 31 + 63) % 63];
            out[i] = x * Math.cos(this.phase) - h * Math.sin(this.phase);
            this.phase = (this.phase + (2 * Math.PI * this.hz) / this.rate) % (2 * Math.PI);
            this.at = (this.at + 1) % 63;
        }
        return out;
    }
}
export const MAX_SECONDS = AudioTools.MAX_SECONDS;
export const makeWav = AudioTools.makeWav.bind(AudioTools);
export const parseWav = AudioTools.parseWav.bind(AudioTools);
export const readAudio = AudioTools.readAudio.bind(AudioTools);
export const selectChannel = AudioTools.selectChannel.bind(AudioTools);
export const resample = AudioTools.resample.bind(AudioTools);
export const joinChunks = AudioTools.joinChunks.bind(AudioTools);
export const pcmFloat = AudioTools.pcmFloat.bind(AudioTools);
export const timeLabel = AudioTools.timeLabel.bind(AudioTools);
