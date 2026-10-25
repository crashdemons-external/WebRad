import { AdditionalFormats } from './additional-formats.js';
import { Resampler } from '../runtime/engines/multimode/resampler.js';
import { FrequencyShift, joinChunks } from './audio.js';
import { validateSettings } from './settings.js';

/** Offline PCM host for bounded standalone native operations. */
export class AdditionalEngineHost {
    /** Loaded native module. */
    m;
    /** Capability identifier shared with the catalog. */
    engine;
    /** Active format metadata. */
    format;
    /** Validated controls captured for the operation. */
    settings;
    /** Native sample rate in samples per second. */
    rate;
    /** Streaming input sample-rate converter. */
    resampler;
    /** Stateful audio-frequency translation applied after resampling. */
    shift;
    /** Number of original samples accepted, used to flush the resampler tail exactly. */
    inputSamples = 0;
    /** Effective input sample rate after clock correction. */
    inputRate;
    /** Owned receive chunks retained until finish. */
    chunks = [];
    /** Number of retained native-rate samples. */
    sampleCount = 0;
    /** Whether the current receive job has been finalized. */
    finished = false;
    /** Owned transmit PCM buffer. */
    output = new Float32Array();
    /** Read position in the transmit buffer. */
    position = 0;

    /** Retain the core without sharing native allocations with another host. */
    constructor(engine, core) {
        this.engine = engine;
        this.m = core;
        this.rate = engine === 'dispatch' ? 48000 : 12000;
    }

    /** Return the standalone formats supported by this host. */
    catalog() {
        return AdditionalFormats.catalog(this.engine);
    }

    /** Reset reception and convert incoming chunks to the core's fixed sample rate. */
    setup({ format, settings, rate }) {
        if (format.engine !== this.engine || !format.decode) throw Error('This engine cannot decode that format.');
        if (!Number.isFinite(rate) || rate < 4000 || rate > 384000) throw Error('Unsupported recording sample rate.');
        this.format = format;
        this.settings = validateSettings(format, settings);
        this.inputRate = rate * (1 + (this.settings.rxPpm || 0) / 1e6);
        this.resampler = new Resampler(this.inputRate, this.rate);
        this.shift = new FrequencyShift(this.rate, this.settings.frequencyShift || 0);
        this.inputSamples = 0;
        this.chunks = [];
        this.sampleCount = 0;
        this.finished = false;
        return { rate: this.rate };
    }

    /** Retain finite, gain-adjusted PCM while enforcing a bounded offline recording. */
    process({ samples }) {
        if (this.finished) return {};
        if (!(samples instanceof Float32Array)) throw Error('Expected floating-point audio samples.');
        const limit = this.rate * AdditionalFormats.seconds[this.engine];
        if (Math.round((this.inputSamples + samples.length) * this.rate / this.inputRate) > limit) throw Error('This recording exceeds the format limit. Trim it and try again.');
        const gain = 10 ** ((this.settings.inputGain || 0) / 20) * (this.settings.invertInput ? -1 : 1);
        const input = Float32Array.from(samples, (value) => Number.isFinite(value) ? Math.max(-1, Math.min(1, value * gain)) : 0);
        this.inputSamples += input.length;
        const converted = this.shift.process(this.resampler.process(input));
        if (this.sampleCount + converted.length > limit) throw Error('This recording exceeds the format limit. Trim it and try again.');
        this.sampleCount += converted.length;
        this.chunks.push(converted);
        return {};
    }

    /** Decode once after input ends; return only JavaScript-owned result buffers. */
    finish() {
        if (this.finished) return {};
        this.finished = true;
        const remaining = Math.max(0, Math.round(this.inputSamples * this.rate / this.inputRate) - this.sampleCount);
        if (remaining) {
            const tail = this.resampler.process(new Float32Array(this.resampler.half * 2 + 2)).subarray(0, remaining);
            this.chunks.push(this.shift.process(tail));
        }
        const samples = joinChunks(this.chunks);
        this.chunks = [];
        this.run(false, samples);
        const m = this.m, result = {};
        const text = m.UTF8ToString(m._wr_text());
        if (text) result.text = text;
        const byteCount = m._wr_bytes_size();
        if (byteCount) {
            const bytes = m.HEAPU8.slice(m._wr_bytes(), m._wr_bytes() + byteCount);
            result.text = new TextDecoder().decode(bytes);
            result.file = { bytes, name: 'recovered-serial-data.bin' };
        }
        const width = m._wr_width(), height = m._wr_height();
        if (width && height && m._wr_pixels()) {
            const pixels = m.HEAPU8.slice(m._wr_pixels(), m._wr_pixels() + width * height * 4);
            result.finished = { width, height, pixels, serial: 0, complete: true };
            Object.assign(result, { width, height, pixels });
        }
        return result;
    }

    /** Configure the core and invoke it with an allocation released on success or failure. */
    run(encode, data, width = 0, height = 0) {
        const m = this.m;
        AdditionalFormats.options(this.format, this.settings).forEach((value, index) => m._wr_option(index, value));
        const pointer = m._malloc(data.byteLength || 1);
        if (!pointer) throw Error('Not enough memory for this operation.');
        try {
            m.HEAPU8.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), pointer);
            const count = m._wr_run(Number(encode), pointer, data.length, width, height);
            if (count < 0) throw Error(m.UTF8ToString(m._wr_error()) || 'The native engine rejected this input.');
        } finally {
            m._free(pointer);
        }
    }

    /** Produce native PCM for text, file bytes or a prepared picture. */
    encodeStart({ format, settings, text = '', bytes, image }) {
        if (format.engine !== this.engine || !format.inputs.length) throw Error('This format supports reception only.');
        this.format = format;
        this.settings = validateSettings(format, settings);
        this.output = new Float32Array();
        this.position = 0;
        let input = image ? new Uint8Array(image.pixels) : (bytes || new TextEncoder().encode(text));
        if (this.engine === 'aircraft') {
            const s = this.settings;
            for (const [key, count] of [['aircraftAddress', 7], ['aircraftMode', 1], ['aircraftLabel', 2], ['aircraftAck', 1], ['aircraftBlock', 1]]) {
                if (s[key].length !== count || /[^\x20-\x7e]/.test(s[key])) throw Error(`Set ${key.replace('aircraft', '')} to exactly ${count} printable ASCII character(s) in Advanced.`);
            }
            input = new TextEncoder().encode(s.aircraftMode + s.aircraftAddress + s.aircraftAck + s.aircraftLabel + s.aircraftBlock + '\x02' + text);
        }
        this.run(true, input, image?.width || 0, image?.height || 0);
        const m = this.m;
        this.output = m.HEAPF32.slice(m._wr_audio() / 4, m._wr_audio() / 4 + m._wr_audio_size());
        return { rate: this.rate };
    }

    /** Deliver owned PCM chunks through the encoder worker protocol. */
    encodeRead() {
        const end = Math.min(this.output.length, this.position + 32768);
        const samples = this.output.slice(this.position, end);
        this.position = end;
        return { samples, rate: this.rate, done: end >= this.output.length, progress: this.output.length ? end / this.output.length : 1 };
    }
}
