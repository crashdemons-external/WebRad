import { AdditionalFormats } from './additional-formats.js';
import { AdditionalEngineHost } from './additional-engines.js';
import { createDecoderSession, options as modemOptions } from '../runtime/engines/multimode/decoder-session.js';
import { defaults as modemDefaults } from '../runtime/engines/multimode/configuration.js';
import { Resampler } from '../runtime/engines/multimode/resampler.js';
import { Resampler as SstvResampler } from '../runtime/engines/analog-sstv/resampler.js';
import { FrequencyShift, joinChunks, resample } from './audio.js';
import { PictureTools } from './pictures.js';
/** WASM loading, heap ownership and native capability discovery shared by engine hosts. */
export class EngineCore {
    /** Relative WASM loader paths indexed by engine capability. */
    static urls = {
        fldigi: 'multimode.js',
        sstv: 'analog-sstv.js',
        fax: 'weather-fax.js',
        drm: 'hamdrm.js',
        jp2: 'jpeg2000.js',
        packet: 'packet-radio.js',
        weak: 'weak-signal.js',
        sound: 'sound-messages.js',
        signaling: 'signaling.js',
        voice: 'digital-voice.js',
        sensor: 'sensor-radio.js',
        ...AdditionalFormats.urls
    };
    /**
     * Load the selected native core and resolve its WASM assets relative to this module.
     * @param {string} engine Native engine capability identifier.
     * @returns {Promise<Object>} Initialized WASM module with native heap views.
     */
    static async loadCore(engine) {
        const url = EngineCore.assetUrl('../wasm/' + EngineCore.urls[engine]),
            module = await import(url),
            core = await module.default({
                locateFile: (name) => EngineCore.assetUrl(name, url).href,
                print: () => {},
                printErr: () => {}
            });
        if (!core.HEAP16) Object.defineProperty(core, 'HEAP16', { get: () => new Int16Array(core.HEAPU8.buffer) });
        return core;
    }
    /** Resolve native assets with the cache version carried by the importing module. */
    static assetUrl(name, base = import.meta.url) {
        const url = new URL(name, base);
        const version = new URL(base).searchParams.get('v');
        if (version !== null) url.searchParams.set('v', version);
        return url;
    }
    /**
     * Allocate and copy a null-terminated UTF-8 string into the native heap.
     * @param {Object} m WASM module exposing memory and native functions.
     * @param {string} text String passed to the native engine.
     * @returns {number} Owned native UTF-8 allocation address.
     */
    static putString(m, text) {
        const bytes = new TextEncoder().encode(String(text) + '\0'),
            p = m._malloc(bytes.length);
        if (!p) throw Error('Not enough memory.');
        m.HEAPU8.set(bytes, p);
        return p;
    }
    /**
     * Allocate and copy typed-array bytes into the native heap.
     * @param {Object} m WASM module exposing memory and native functions.
     * @param {Uint8Array} bytes Bytes to copy into native memory.
     * @returns {number} Owned native byte allocation address.
     */
    static putBytes(m, bytes) {
        const p = m._malloc(bytes.byteLength || 1);
        if (!p) throw Error('Not enough memory.');
        m.HEAPU8.set(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), p);
        return p;
    }
    /**
     * Copy a typed native-heap range into JavaScript-owned memory.
     * @param {Object} m WASM module exposing memory and native functions.
     * @param {number} p Native heap allocation address.
     * @param {number} n Number of native elements to copy.
     * @param {string} kind Native typed-heap name to copy from.
     * @returns {TypedArray} JavaScript-owned copy of native heap elements.
     */
    static arr(m, p, n, kind = 'HEAPU8') {
        return m[kind].slice(p / m[kind].BYTES_PER_ELEMENT, p / m[kind].BYTES_PER_ELEMENT + n);
    }
    /**
     * Copy native signed 16-bit PCM into normalized floating-point samples.
     * @param {Object} m WASM module exposing memory and native functions.
     * @param {number} p Native heap allocation address.
     * @param {number} n Number of native elements to copy.
     * @returns {Float32Array} Normalized copy of native signed-16 PCM.
     */
    static pcm(m, p, n) {
        return Float32Array.from(EngineCore.arr(m, p, n, 'HEAP16'), (x) => x / 32768);
    }
    /**
     * Map a packet-radio variant name to native modulation and baud settings.
     * @param {string} name Packet-radio modulation name.
     * @returns {Object} Native packet modulation type and baud.
     */
    static toneMode(name) {
        switch (name) {
            case '300 AFSK':
                return { nativeType: 0, baud: 300 };
            case '1200 AFSK':
                return { nativeType: 0, baud: 1200 };
            case '2400 QPSK':
                return { nativeType: 3, baud: 2400 };
            case '4800 8PSK':
                return { nativeType: 4, baud: 4800 };
            case 'AIS':
                return { nativeType: 8, baud: 9600 };
            default:
                return { nativeType: 2, baud: 9600 };
        }
    }
    /** Supported native FreeDV speech mode numbers/names. */
    static speechModes = [
        [0, '1600'],
        [3, '2400A'],
        [4, '2400B'],
        [5, '800XA'],
        [6, '700C'],
        [7, '700D'],
        [13, '700E']
    ];
    /** Supported native FreeDV raw-data mode numbers/names. */
    static dataModes = [
        [14, 'DATAC0'],
        [10, 'DATAC1'],
        [12, 'DATAC3'],
        [18, 'DATAC4'],
        [19, 'DATAC13'],
        [20, 'DATAC14'],
        [9, 'FSK-LDPC']
    ];
    /** Fallback MMSSTV receiver controls in native option order. */
    static sstvOptionDefaults = [1, 0, 1, 2, 1, 1, 1, 0, 0, 0, 0, 1];
    /**
     * Read native capabilities and expose the supported application modes.
     * @param {string} engine Native engine capability identifier.
     * @param {Object} m WASM module exposing memory and native functions.
     * @returns {Object[]} Compiled capabilities offered by the application.
     */
    static coreCatalog(engine, m) {
        switch (engine) {
            case 'fldigi':
                return EngineCore.fldigiCatalog(engine, m);
            case 'sstv':
                return EngineCore.sstvCatalog(engine, m);
            case 'fax':
                return EngineCore.faxCatalog(engine);
            case 'drm':
                return EngineCore.drmCatalog(engine);
            case 'packet':
                return EngineCore.packetCatalog(engine);
            case 'weak':
                return EngineCore.weakCatalog(engine);
            case 'sound':
                return EngineCore.soundCatalog(engine);
            case 'signaling':
                return EngineCore.signalingCatalog(engine, m);
            case 'voice':
                return EngineCore.voiceCatalog(engine);
            case 'sensor':
                return EngineCore.sensorCatalog(engine, m);
            default:
                return AdditionalFormats.catalog(engine);
        }
    }
    /** Build the fldigi catalog and expose its text/image capabilities. */
    static fldigiCatalog(engine, m) {
        return JSON.parse(m.UTF8ToString(m._web_modes()))
            .filter((f) => f.enabled)
            .map((f) => ({
                ...f,
                id: `fldigi-${f.id}`,
                mode: f.id,
                engine,
                inputs: [
                    ...(m._web_tx_supported(f.id) ? ['text'] : []),
                    ...(m._web_tx_image_supported(f.id) && f.family !== 'WEFAX' ? ['picture'] : [])
                ],
                outputs: ['Hellschreiber', 'WEFAX'].includes(f.family)
                    ? ['picture']
                    : ['text', ...(['MFSK', 'THOR', 'IFKP', 'FSQ'].includes(f.family) ? ['picture'] : [])],
                imageTx: !!m._web_tx_image_supported(f.id),
                decode: true
            }))
            .filter((f) => f.family !== 'WEFAX');
    }
    /** Initialize and describe the native SSTV modes. */
    static sstvCatalog(engine, m) {
        m._web_init();
        return Array.from({ length: m._web_mode_count() }, (_, mode) => ({
            id: `sstv-${mode}`,
            engine,
            mode,
            name: m.UTF8ToString(m._web_mode_name(mode)),
            family: 'SSTV',
            width: m._web_mode_width(mode),
            height: m._web_mode_height(mode),
            txHeight: m._web_mode_tx_height(mode),
            inputs: ['picture'],
            outputs: ['picture'],
            decode: true
        }));
    }
    /** Describe the two supported weather-fax geometries. */
    static faxCatalog(engine) {
        return [0, 1].map((mode) => ({
            id: `fax-${mode}`,
            engine,
            mode,
            name: mode ? 'IOC288' : 'IOC576',
            family: 'WEFAX',
            width: mode ? 904 : 1809,
            inputs: ['picture'],
            outputs: ['picture'],
            decode: true
        }));
    }
    /** Describe the supported HAMDRM file and picture capabilities. */
    static drmCatalog(engine) {
        return [
            {
                id: 'drm',
                engine,
                mode: 2,
                name: 'HAMDRM',
                family: 'HAMDRM',
                inputs: ['file', 'picture'],
                outputs: ['file', 'picture'],
                decode: true
            }
        ];
    }
    /** Describe packet-radio modes using their native modulation settings. */
    static packetCatalog(engine) {
        const formats = ['1200 AFSK', '300 AFSK', '2400 QPSK', '4800 8PSK', '9600 G3RUH', 'AIS'].map((name, mode) => ({
            id: `packet-${mode}`,
            engine,
            mode,
            name,
            ...EngineCore.toneMode(name),
            family: 'AX.25',
            inputs: name === 'AIS' ? [] : ['text'],
            outputs: ['text'],
            decode: true
        }));
        formats.push({
            ...formats[0], id: 'packet-aprs', name: 'APRS · locations, messages & telemetry', family: 'APRS', aprs: true,
            presetSettings: { aprsInterpret: true },
            presetDescription: 'Read APRS locations, addressed messages, objects, weather, telemetry and compact Mic-E positions from packet audio. To send a location, enter a short comment and set the sender, latitude and longitude in Advanced. Choose Raw packet there to send any complete SOURCE>DESTINATION:payload, including <0xHH> byte escapes. Raw GPS sentences are shown without interpretation.'
        });
        return formats;
    }
    /** Describe the FT8 and FT4 message modes. */
    static weakCatalog(engine) {
        return [0, 1].map((mode) => ({
            id: `weak-${mode}`,
            engine,
            mode,
            name: mode ? 'FT4' : 'FT8',
            family: 'FT',
            inputs: ['text'],
            outputs: ['text'],
            decode: true
        }));
    }
    /** Describe the supported ggwave sound protocols. */
    static soundCatalog(engine) {
        return [
            'Audible normal',
            'Audible fast',
            'Audible fastest',
            'Ultrasonic normal',
            'Ultrasonic fast',
            'Ultrasonic fastest',
            'Dual-tone normal',
            'Dual-tone fast',
            'Dual-tone fastest',
            'Multi-tone normal',
            'Multi-tone fast',
            'Multi-tone fastest'
        ].map((name, mode) => ({
            id: `sound-${mode}`,
            engine,
            mode,
            name,
            family: 'ggwave',
            inputs: ['text'],
            outputs: ['text'],
            decode: true
        }));
    }
    /** Read supported signaling modes and omit the internal CSV dump mode. */
    static signalingCatalog(engine, m) {
        return Array.from({ length: m._wr_count() }, (_, mode) => {
            const name = m.UTF8ToString(m._wr_name(mode));
            return {
                id: `signaling-${mode}`,
                engine,
                mode,
                name,
                family: 'Signaling',
                inputs: /^(POCSAG|FLEX$|DTMF$|ZVEI1$)/.test(name) ? ['text'] : [],
                outputs: ['text'],
                decode: true,
                rate: m._wr_rate(mode)
            };
        }).filter((f) => f.name !== 'DUMPCSV');
    }
    /** Combine Codec2, FreeDV speech and FreeDV data mode descriptors. */
    static voiceCatalog(engine) {
        return [
            ...[
                [0, '3200'],
                [1, '2400'],
                [2, '1600'],
                [3, '1400'],
                [4, '1300'],
                [5, '1200'],
                [8, '700C']
            ].map(([mode, name]) => ({
                id: `codec2-${mode}`,
                engine,
                mode,
                name: `Codec2 ${name}`,
                family: 'Codec2',
                inputs: ['voice'],
                outputs: ['voice'],
                decode: true,
                codec: true
            })),
            ...EngineCore.speechModes.map(([mode, name]) => ({
                id: `freedv-${mode}`,
                engine,
                mode,
                name: `FreeDV ${name}`,
                family: 'FreeDV',
                inputs: ['voice'],
                outputs: ['voice'],
                decode: true
            })),
            ...EngineCore.dataModes.map(([mode, name]) => ({
                id: `freedv-data-${mode}`,
                engine,
                mode,
                name: `FreeDV ${name}`,
                family: 'FreeDV data',
                inputs: ['file'],
                outputs: ['file'],
                decode: true,
                data: true
            }))
        ];
    }
    /** Read supported sensor protocols and omit template-only decoders. */
    static sensorCatalog(engine, m) {
        return Array.from({ length: m._wr_count() }, (_, mode) => ({
            id: `sensor-${mode}`,
            engine,
            mode,
            name: `${m._wr_protocol(mode)} · ${m.UTF8ToString(m._wr_name(mode))}`,
            family: 'Sensors',
            inputs: [],
            outputs: ['sensor'],
            decode: true,
            disabled: !!m._wr_disabled(mode)
        })).filter((f) => !f.name.endsWith('Template decoder'));
    }
    /**
     * Copy a receiver profile string and release its allocation after native initialization.
     * @param {Object} m WASM module exposing memory and native functions.
     * @param {string} text Profile string copied during receiver initialization.
     * @returns {number} Native string address, scheduled for release after initialization.
     */
    static putStringFree(m, text) {
        const p = EngineCore.putString(m, text); // receiver copies the profile string during initialization
        queueMicrotask(() => m._free(p));
        return p;
    }
}
/** Owns native engine resources and adapts streaming operations to worker requests.
 * @property {string} engine Engine capability served by this host.
 * @property {Object|null} m Loaded WebAssembly module.
 * @property {number} block Reusable native scratch allocation.
 * @property {number} serial Current receive operation identifier.
 * @property {number} finishedSerial Last completed receive operation identifier.
 * @property {number} voice Active FreeDV handle, if configured.
 * @property {number} codec Active Codec2 handle, if configured.
 * @property {Object|null} lastPayload Last encoded payload retained for replay.
 * @property {boolean} loaded Whether engine initialization has completed.
 * @property {number} targetRate Native receiver or transmitter sample rate.
 * @property {number} speechRate Native speech sample rate.
 * @property {number} frame Speech samples per codec frame.
 * @property {number} frameBytes Encoded bytes per codec frame.
 * @property {Float32Array} voicePending Speech samples waiting for a full frame.
 * @property {Float32Array[]} voiceBlocks Decoded speech blocks awaiting output.
 * @property {number} syncedFrames Number of synchronized data frames received.
 * @property {number} allFrames Total data frames received.
 * @property {number} rxPacketCount Received packet count.
 * @property {Object} format Selected catalog format.
 * @property {Object} settings Validated settings for the current operation.
 * @property {number} rate Input sample rate.
 * @property {Object|null} image Current decoded image state.
 * @property {string} text Current decoded text.
 * @property {Object[]} rxFiles Received files awaiting assembly.
 * @property {Object|null} decoded Most recent decoded payload.
 * @property {FrequencyShift|null} inputShift Retained input-rate frequency translator.
 * @property {string|null} pictureWinner Engine selected by automatic picture detection.
 * @property {Object|null} session Active multimode decoder session.
 * @property {Float32Array} weakPending Weak-signal samples awaiting a slot.
 * @property {Set<string>} weakSeen Weak-signal messages already reported.
 * @property {number} weakTime Weak-signal input time in samples.
 * @property {number} weakSkip Initial samples skipped for slot alignment.
 * @property {boolean} sensorWasRaw Whether sensor input is raw sample data.
 * @property {Object|null} resampler Input sample-rate converter.
 * @property {FrequencyShift} shift Input translator for configured receiver frequency.
 * @property {boolean} encoding Whether a transmit operation is active.
 * @property {number} total Total output samples expected.
 * @property {Float32Array|null} output Encoded PCM output.
 * @property {number} outputAt Next output sample position.
 * @property {Uint8Array|null} dataInput Source bytes for packetized transmission.
 * @property {Object|null} dataPlan Packetization plan for the source bytes.
 * @property {number} outputRate Encoded PCM sample rate.
 * @property {number} dataPos Next source byte position.
 * @property {Float32Array|null} voiceInput Resampled speech input.
 * @property {number} voicePos Next speech input position.
 * @property {Uint8Array[]|null} codecBytes Encoded Codec2 frames.
 * @property {EngineHost} sstv SSTV receiver used by automatic picture detection.
 * @property {EngineHost} fax Weather-fax receiver used by automatic picture detection.
 */
export class EngineHost {
    /**
     * Create a host with its native core, or both SSTV/fax receivers for automatic picture detection.
     * @param {string} engine Native engine capability identifier.
     * @returns {Promise<EngineHost>} Initialized receiver/transmitter host.
     */
    static async create(engine) {
        if (engine === 'pictures-auto') {
            const host = new EngineHost(engine, null);
            host.sstv = await EngineHost.create('sstv');
            host.fax = await EngineHost.create('fax');
            return host;
        }
        if (AdditionalFormats.urls[engine]) return new AdditionalEngineHost(engine, await EngineCore.loadCore(engine));
        return new EngineHost(engine, await EngineCore.loadCore(engine));
    }
    /**
     * Create host state and allocate reusable native scratch memory.
     * @param {string} engine Native engine capability identifier.
     * @param {Object|null} core Loaded WebAssembly module, when supplied.
     */
    constructor(engine, core) {
        this.engine = engine;
        this.m = core;
        this.block = core ? core._malloc(65536 * 8) : 0;
        this.serial = -1;
        this.finishedSerial = -1;
        this.voice = 0;
        this.codec = 0;
        this.lastPayload = null;
        this.loaded = false;
    }
    /**
     * Return the capabilities exposed by this host's native core.
     * @returns {Object[]} Capabilities exposed by this native host.
     */
    catalog() {
        return EngineCore.coreCatalog(this.engine, this.m);
    }
    /**
     * Copy bytes into native memory and return an explicit allocation-release callback.
     * @param {Object} data Message envelope or operation data.
     * @returns {Object} Native pointer and release callback.
     */
    use(data) {
        const m = this.m,
            p = EngineCore.putBytes(m, data);
        return { p, free: () => m._free(p) };
    }
    /**
     * Apply fldigi controls before and after native mode creation, then set tuning and sender identity.
     * @param {Object} format Catalog format, including native mode and preset controls.
     * @param {Object} settings Validated native compatibility controls.
     */
    configureModem(format, settings) {
        const m = this.m,
            s = { ...modemDefaults, ...settings };
        const configure = () => {
            for (const [key, index] of Object.entries(modemOptions)) {
                if ([31, 32].includes(index) && format.name !== 'OLIVIA') continue;
                if ([35, 36].includes(index) && format.name !== 'CONTESTIA') continue;
                m._web_set_option(index, Number(s[key]));
            }
            m._web_set_option(44, s.sideband === 'LSB' ? 0 : 1);
        };
        configure();
        if (!m._web_create(format.mode)) throw Error('Could not initialize this modem.');
        configure();
        m._web_set_frequency(s.frequency);
        const p = EngineCore.putString(m, s.callsign);
        m._web_set_callsign(p);
        m._free(p);
    }
    /**
     * Replace codec/modem handles, apply voice/data compatibility controls and reset frame counters.
     * @param {Object} format Catalog format, including native mode and preset controls.
     * @param {Object} s Validated format compatibility settings.
     */
    setupVoice(format, s) {
        const m = this.m;
        this.releaseVoiceHandles(m);
        if (format.mode === 9) this.openFskVoice(m, s);
        if (format.codec) this.configureCodecVoice(m, format, s);
        else this.configureFreeDvVoice(m, format, s);
        if (format.data) this.configureVoiceData(format, s);
        this.resetVoiceReceiveState();
    }
    /** Close active voice and codec handles before configuring another mode. */
    releaseVoiceHandles(m) {
        if (this.voice) m._freedv_close(this.voice);
        if (this.codec) m._codec2_destroy(this.codec);
        this.voice = this.codec = 0;
    }
    /** Open and configure the custom FSK FreeDV variant. */
    openFskVoice(m, settings) {
        if (settings.voiceFskTone + (settings.voiceFskM - 1) * settings.voiceFskSpacing >= 4000)
            throw Error('The FSK tones must fit below 4000 Hz.');
        const code = EngineCore.putString(m, settings.voiceFskCode),
            adv = m._malloc(32);
        try {
            m.HEAP32.set(
                [0, settings.voiceFskM, settings.voiceFskBaud, 8000, settings.voiceFskTone, settings.voiceFskSpacing, code, 0],
                adv / 4
            );
            this.voice = m._freedv_open_advanced(9, adv);
        } finally {
            m._free(adv);
            m._free(code);
        }
    }
    /** Create Codec2 and apply its bit order, post-filter and frame settings. */
    configureCodecVoice(m, format, settings) {
        this.codec = m._codec2_create(format.mode);
        if (!this.codec) throw Error('This speech codec mode is unavailable.');
        m._codec2_set_natural_or_gray(this.codec, settings.codecGray ? 1 : 0);
        m._codec2_set_lpc_post_filter(this.codec, settings.codecPost ? 1 : 0, 1, 0.5, 0.2);
        if (format.mode === 8) {
            m._codec2_700c_post_filter(this.codec, settings.codecPost ? 1 : 0);
            m._codec2_700c_eq(this.codec, settings.codecEq ? 1 : 0);
        }
        this.targetRate = 8000;
        this.speechRate = 8000;
        this.frame = m._codec2_samples_per_frame(this.codec);
        this.frameBytes = m._codec2_bytes_per_frame(this.codec);
    }
    /** Create FreeDV and apply modem settings and speech frame geometry. */
    configureFreeDvVoice(m, format, settings) {
        if (!this.voice) this.voice = m._freedv_open(format.mode);
        if (!this.voice) throw Error('This FreeDV mode requires unavailable external models.');
        m._freedv_set_squelch_en(this.voice, settings.voiceSquelch ? 1 : 0);
        m._freedv_set_snr_squelch_thresh(this.voice, settings.voiceSnr);
        m._freedv_set_sync(this.voice, settings.voiceSync);
        m._freedv_set_eq(this.voice, settings.voiceEq ? 1 : 0);
        m._freedv_set_clip(this.voice, settings.voiceClip ? 1 : 0);
        m._freedv_set_tx_bpf(this.voice, settings.voiceBpf ? 1 : 0);
        this.targetRate = m._freedv_get_modem_sample_rate(this.voice);
        this.speechRate = m._freedv_get_speech_sample_rate(this.voice);
        this.frame = m._freedv_get_n_speech_samples(this.voice);
        this.frameBytes = Math.ceil(m._freedv_get_bits_per_modem_frame(this.voice) / 8);
    }
    /** Apply raw-data burst and tuning controls to the initialized FreeDV handle. */
    configureVoiceData(format, settings) {
        const m = this.m;
        m._freedv_set_frames_per_burst(this.voice, 1);
        if (format.mode !== 9) {
            if (settings.voiceLow >= settings.voiceHigh) throw Error('The lower tuning limit must be below the upper limit.');
            m._freedv_set_tuning_range(this.voice, settings.voiceLow, settings.voiceHigh);
        }
    }
    /** Clear pending receive samples and data-packet counters after mode setup. */
    resetVoiceReceiveState() {
        this.voicePending = new Float32Array(0);
        this.voiceBlocks = [];
        this.syncedFrames = 0;
        this.allFrames = 0;
        this.rxPacketCount = 0;
    }
    /**
     * Measure actual FreeDV payload capacity and packet duration before allocating encoded audio.
     * @returns {Object} Actual packet capacity, count, duration and padding.
     */
    voiceDataPlan({ format, settings, size }) {
        if (this.engine !== 'voice' || !format.data) throw Error('Choose a FreeDV data format.');
        if (!Number.isInteger(size) || size < 1 || size > 16777216)
            throw Error('Choose a file between 1 byte and 16 MB.');
        this.setupVoice(format, settings);
        const payloadBytes = this.frameBytes - 2,
            packetCount = Math.ceil(size / payloadBytes),
            m = this.m;
        const preamble = m._freedv_rawdatapreambletx(this.voice, this.block),
            postamble = m._freedv_rawdatapostambletx(this.voice, this.block);
        const frameSamples = m._freedv_get_n_tx_modem_samples(this.voice),
            gap = Math.floor(this.targetRate / 2);
        // FSK receives through a two-frame window. Keep frames continuous and flush
        // the last one with acquisition tones, preserving the tone estimates.
        const samples =
            format.mode === 9
                ? preamble + packetCount * frameSamples + postamble + frameSamples + gap
                : packetCount * (preamble + frameSamples + postamble + gap);
        const seconds = samples / this.targetRate;
        if (seconds > 1800)
            throw Error(
                'This file would produce more than 30 minutes of FreeDV audio. Choose a smaller file or a faster data variant.'
            );
        return {
            payloadBytes,
            packetCount,
            paddingBytes: packetCount * payloadBytes - size,
            paddingByte: format.mode === 9 ? 0x55 : 0,
            size,
            seconds
        };
    }
    /**
     * Reset reception, apply format controls and initialize the appropriate streaming input conversion.
     * @returns {Promise<Object>} Native PCM rate and optional speech rate.
     */
    async setup({ format, settings, rate = 48000, preserve = true }) {
        this.format = format;
        this.settings = settings;
        this.rate = rate;
        this.serial = -1;
        this.finishedSerial = -1;
        this.image = null;
        this.text = '';
        this.rxFiles = [];
        this.decoded = null;
        this.inputShift = null;
        const m = this.m,
            s = settings,
            e = this.engine;
        if (e === 'pictures-auto') {
            return this.setupPictureDetection(s, rate);
        }
        switch (e) {
            case 'fldigi':
                this.setupFldigiReceiver(format, s, m);
                break;
            case 'sstv':
                this.setupSstvReceiver(format, s, m);
                break;
            case 'fax':
                this.setupFaxReceiver(format, s, m);
                break;
            case 'drm':
                this.setupDrmReceiver(preserve, m);
                break;
            case 'weak':
                this.setupWeakReceiver(s);
                break;
            case 'sound':
                this.setupSoundReceiver(format, s, m);
                break;
            case 'packet':
                this.setupPacketReceiver(format, s, m);
                break;
            case 'signaling':
                this.setupSignalingReceiver(format, s, m);
                break;
            case 'voice':
                this.setupVoice(format, s);
                break;
            case 'sensor':
                this.setupSensorReceiver(format, s, m);
                break;
        }
        const inputRate = rate * (1 + (s.rxPpm || 0) / 1e6);
        this.resampler =
            e === 'sstv' ? new SstvResampler(inputRate, this.targetRate) : new Resampler(inputRate, this.targetRate);
        this.shift = new FrequencyShift(this.targetRate, s.frequencyShift || 0);
        return { rate: this.targetRate, speechRate: this.speechRate };
    }
    /** Configure both picture receivers used by automatic fax/SSTV detection. */
    async setupPictureDetection(settings, rate) {
        this.pictureWinner = null;
        await this.sstv.setup({ format: { engine: 'sstv', mode: -1 }, settings, rate });
        await this.fax.setup({ format: { engine: 'fax', mode: 0 }, settings, rate });
        return { rate };
    }
    /** Create and configure the streaming fldigi decoder session. */
    setupFldigiReceiver(format, settings, m) {
        this.session?.dispose();
        this.session = createDecoderSession(m, (result) => {
            if (result.type === 'decoded') this.decoded = result;
        });
        this.session.handle({ type: 'reset', generation: 1 });
        this.session.handle({
            type: 'configure',
            generation: 1,
            sequence: 1,
            retune: true,
            settings: { ...modemDefaults, ...settings, mode: format.mode }
        });
        this.targetRate = m._web_sample_rate();
    }
    /** Initialize the SSTV receiver and apply its native controls in option order. */
    setupSstvReceiver(format, settings, m) {
        m._web_init();
        m._web_reset(format.mode);
        for (const [id, key] of [
            'sstvAfc',
            'sstvLms',
            'sstvBpf',
            'sstvDemod',
            'sstvSense',
            'sstvStop',
            'sstvSync',
            'sstvSlant',
            'sstvLock',
            'sstvDiff',
            'fftGain',
            'sstvFsk'
        ].entries())
            m._web_option(id, settings[key] ?? EngineCore.sstvOptionDefaults[id]);
        this.targetRate = 11025;
    }
    /** Reset the fax receiver and apply its native controls in their required order. */
    setupFaxReceiver(format, settings, m) {
        m._fax_reset(format.mode);
        for (const [id, key] of [
            [0, 'faxAfc'],
            [1, 'wefaxLpm'],
            [5, 'faxFrequency'],
            [7, 'faxAuto'],
            [6, 'faxManual']
        ])
            m._fax_option(id, Number(settings[key]));
        this.targetRate = 11025;
    }
    /** Reset DRM reception and capture its current sequence identifier. */
    setupDrmReceiver(preserve, m) {
        m._drm_rx_reset(preserve ? 0 : 1);
        this.serial = m._drm_rx_status(13);
        this.targetRate = 12000;
    }
    /** Reset weak-signal slot state using the selected input offset. */
    setupWeakReceiver(settings) {
        this.targetRate = 12000;
        this.weakPending = new Float32Array(0);
        this.weakSeen = new Set();
        this.weakTime = 0;
        this.weakSkip = Math.round(settings.ftSlotOffset * 12000);
    }
    /** Initialize the selected sound-message protocol. */
    setupSoundReceiver(format, settings, m) {
        if (m._wr_init(settings.ggPayload, settings.ggDss ? 1 : 0, settings.ggThreshold, settings.ggFrame, format.mode, settings.ggFreq) < 0)
            throw Error('Cannot initialize sound-message decoder.');
        this.targetRate = 48000;
    }
    /** Initialize packet-radio reception with its configured modem profiles. */
    setupPacketReceiver(format, settings, m) {
        this.targetRate = m._wr_init(
            format.nativeType,
            settings.packetMark,
            settings.packetSpace,
            settings.packetBaud,
            EngineCore.putStringFree(m, settings.packetProfiles),
            settings.packetFix,
            settings.packetPassall ? 1 : 0,
            settings.packetV26
        );
        m._wr_option(4, Number(settings.aprsInterpret));
    }
    /** Initialize the selected pager/signaling mode and apply native options. */
    setupSignalingReceiver(format, settings, m) {
        this.targetRate = m._wr_init(format.mode);
        for (const [id, key] of [
            'pagerMode',
            'pagerInvert',
            'pagerCorrection',
            'pagerPartial',
            'pagerPrune',
            'pagerEmpty',
            'pagerPolarity',
            'mmDit',
            'mmGap',
            'mmThreshold',
            'mmFixedThreshold',
            'mmFixedTiming'
        ].entries())
            m._wr_option(id, Number(settings[key]));
    }
    /** Initialize raw-sample sensor reception and its native detector controls. */
    setupSensorReceiver(format, settings, m) {
        for (const [id, key] of ['sensorLevel', 'sensorMin', 'sensorSnr'].entries()) m._wr_option(id, settings[key]);
        if (m._wr_init(format.mode, settings.sensorRate, settings.sensorDetector) < 0)
            throw Error('The radio input sample rate is invalid.');
        this.targetRate = settings.sensorRate;
        this.sensorWasRaw = false;
    }
    /**
     * Copy current and newly completed SSTV/fax pictures together with synchronization diagnostics.
     * @param {boolean} fax Use the dedicated fax exports instead of SSTV exports.
     * @param {boolean} finish Whether the receiver is being flushed at end of input.
     * @returns {Object} Current/completed picture and receiver diagnostics.
     */
    imageSnapshot(fax = false, finish = false) {
        const m = this.m,
            prefix = fax ? '_fax_' : '_web_',
            width = m[prefix + 'width'](),
            height = m[prefix + 'height']();
        let result = {
            width,
            height,
            line: m[prefix + 'line'](),
            mode: m[prefix + (fax ? 'detected' : 'mode')](),
            level: m[prefix + 'level'](),
            frequency: m[prefix + (fax ? 'frequency' : 'afc')](),
            pixels:
                width && height && width * height <= 16777216
                    ? EngineCore.arr(m, m[prefix + 'pixels'](), width * height * 4)
                    : null
        };
        result.imageSerial = this.engine + ':' + m[prefix + 'serial']();
        if (!fax) result.sync = EngineCore.arr(m, m._web_sync_pixels(), 320 * 256 * 4);
        const serial = m[prefix + (fax ? 'finished_serial' : 'completed_serial')]();
        if (serial !== this.finishedSerial && m[prefix + (fax ? 'completed' : 'completed')]() > 0) {
            this.finishedSerial = serial;
            const w = m[prefix + (fax ? 'finished_width' : 'completed_width')](),
                h = m[prefix + (fax ? 'finished_height' : 'completed_height')]();
            if (w * h > 0 && w * h <= 16777216)
                result.finished = {
                    width: w,
                    height: h,
                    pixels: EngineCore.arr(m, m[prefix + (fax ? 'finished_pixels' : 'completed_pixels')](), w * h * 4),
                    mode: m[prefix + (fax ? 'finished_mode' : 'completed_mode')](),
                    serial: this.engine + ':' + serial,
                    complete: fax ? !finish && !this.settings.faxManual : m._web_completed_fraction() >= 0.98
                };
        }
        result.spectrum = EngineCore.arr(m, fax ? m._fax_spectrum() : m._web_spectrum(), 1024, 'HEAP32');
        result.spectrumMax = 11025 / 2;
        if (!fax) result.sender = m.UTF8ToString(m._web_fsk());
        return result;
    }
    /**
     * Read HAMDRM diagnostics and emit a newly recovered file once per transfer serial.
     * @returns {Object} HAMDRM diagnostics and a newly completed file, when available.
     */
    digitalSnapshot() {
        const m = this.m,
            status = Array.from({ length: 15 }, (_, i) => m._drm_rx_status(i)),
            result = {
                status,
                snr: m._drm_rx_snr(),
                offset: m._drm_rx_offset(),
                call: m.UTF8ToString(m._drm_rx_call()),
                bsr: m.UTF8ToString(m._drm_rx_bsr())
            };
        if (status[13] !== this.serial) {
            this.serial = status[13];
            const size = m._drm_rx_size();
            if (size > 0 && size <= 16777216)
                result.file = {
                    name: m.UTF8ToString(m._drm_rx_name()),
                    bytes: EngineCore.arr(m, m._drm_rx_file(), size)
                };
        }
        return result;
    }
    /**
     * Feed a PCM block to the configured receiver and normalize its results.
     * @returns {Promise<Object>} Normalized receiver result for this input block.
     */
    async process({ samples }) {
        const e = this.engine,
            m = this.m,
            s = this.settings;
        if (e === 'pictures-auto') {
            const a = await this.sstv.process({ samples }),
                b = await this.fax.process({ samples });
            return this.pickPicture(a, b);
        }
        const gain = 10 ** ((s.inputGain || 0) / 20);
        let input = Float32Array.from(samples, (x) => Math.max(-1, Math.min(1, x * gain * (s.invertInput ? -1 : 1))));
        if (e === 'fldigi') {
            input = new FrequencyShiftPass(this, s).process(input);
            this.decoded = null;
            this.session.handle({ type: 'audio', generation: 1, rate: this.rate, samples: input });
            return this.modemSnapshot();
        }
        input = this.shift.process(e === 'sstv' ? this.resampler.push(input) : this.resampler.process(input));
        if (e === 'weak') return this.processWeak(input, false);
        if (e === 'voice') return this.processVoice(input);
        if (e === 'sensor') throw Error('Sensor signals require raw radio samples or pulses.');
        m.HEAPF32.set(input, this.block / 4);
        if (e === 'sstv') {
            m._web_process(this.block, input.length);
            return this.imageSnapshot();
        }
        if (e === 'fax') {
            m._fax_process(this.block, input.length);
            return this.imageSnapshot(true);
        }
        if (e === 'drm') {
            m._drm_rx_process(this.block, input.length);
            return this.digitalSnapshot();
        }
        if (['sound', 'packet', 'signaling'].includes(e))
            return { text: m.UTF8ToString(m._wr_process(this.block, input.length)) };
        return {};
    }
    /**
     * Normalize fldigi receiver messages, images and diagnostics into an application result.
     * @returns {Object} Normalized text/image receiver result.
     */
    modemSnapshot() {
        const r = this.decoded;
        if (!r) return {};
        const m = this.m;
        if (r.imageWidth && r.imageHeight) {
            if (!this.image || this.image.serial !== r.imageSerial) {
                this.image = {
                    width: r.imageWidth,
                    height: r.imageHeight,
                    serial: r.imageSerial,
                    channels: r.imageChannels,
                    reverse: r.imageReverse,
                    pixels: new Uint8ClampedArray(r.imageWidth * r.imageHeight * 4)
                };
                for (let i = 3; i < this.image.pixels.length; i += 4) this.image.pixels[i] = 255;
            }
            for (let i = 0; i < r.imageUpdates.length; i += 2) {
                const p = r.imageUpdates[i],
                    index = Math.floor(p / 3) * 4 + (p % 3);
                if (index < this.image.pixels.length) this.image.pixels[index] = r.imageUpdates[i + 1];
            }
        }
        return {
            text: r.text,
            secondary: r.secondary,
            status: [r.status1, r.status2].filter(Boolean).join(' · '),
            spectrum: r.spectrum,
            spectrumMax: this.targetRate / 2,
            metric: r.metric,
            frequency: r.frequency,
            scope: r.scope,
            channels: r.channels,
            ...(this.image
                ? {
                    width: this.image.width,
                    height: this.image.height,
                    pixels: ['THOR', 'IFKP', 'FSQ'].includes(this.format.family)
                        ? PictureTools.correctModemPicture(this.image, this.settings.picturePhasePixels || 0, this.settings.pictureSlantPpm || 0)
                        : this.image.pixels.slice()
                }
                : {}),
            raster: r.raster,
            rasterHeight: r.rasterHeight
        };
    }
    /**
     * Decode bounded FT8/FT4 time windows and deduplicate recovered messages.
     * @param {Float32Array} input Input PCM block.
     * @param {boolean} finish Whether the receiver is being flushed at end of input.
     * @returns {Object} New weak-signal messages and diagnostics.
     */
    processWeak(input, finish) {
        const m = this.m,
            s = this.settings,
            ft4 = this.format.mode === 1,
            slot = Math.round((ft4 ? 7.5 : 15) * 12000);
        if (this.weakSkip) {
            const n = Math.min(input.length, this.weakSkip);
            input = input.subarray(n);
            this.weakSkip -= n;
        }
        this.weakPending = joinChunks([this.weakPending, input]);
        let text = '';
        while (this.weakPending.length >= slot || (finish && this.weakPending.length > 12000 * 3)) {
            const n = Math.min(slot, this.weakPending.length),
                data = this.use(this.weakPending.subarray(0, n));
            let t;
            try {
                t = m.UTF8ToString(
                    m._wr_decode(data.p, n, ft4 ? 1 : 0, s.ftLow, s.ftHigh, s.ftCandidates, s.ftScore, s.ftIterations)
                );
            } finally {
                data.free();
            }
            for (const line of t.split('\n').filter(Boolean)) {
                const key = this.weakTime + '|' + line;
                if (!this.weakSeen.has(key)) {
                    this.weakSeen.add(key);
                    text += `${this.weakTime.toFixed(1)}s slot · ${line}\n`;
                }
            }
            this.weakTime += slot / 12000;
            this.weakPending = this.weakPending.slice(n);
        }
        return { text, pendingSeconds: this.weakPending.length / 12000 };
    }
    /**
     * Accumulate codec/modem frames and return verified data packets or recovered speech.
     * @param {Float32Array} input Input PCM block.
     * @returns {Object} Verified packets or recovered speech frames.
     */
    processVoice(input) {
        const m = this.m,
            f = this.format;
        this.voicePending = joinChunks([this.voicePending, input]);
        const output = [],
            files = [];
        while (this.voicePending.length >= (f.codec ? this.frame : m._freedv_nin(this.voice))) {
            const n = f.codec ? this.frame : m._freedv_nin(this.voice);
            if (n <= 0) break;
            for (let i = 0; i < n; i++)
                m.HEAP16[this.block / 2 + i] = Math.max(
                    -32768,
                    Math.min(32767, Math.round(this.voicePending[i] * 32767))
                );
            this.voicePending = this.voicePending.slice(n);
            let count;
            if (f.data) {
                count = m._freedv_rawdatarx(this.voice, this.block + 262144, this.block);
                if (count > 0) {
                    const packet = EngineCore.arr(m, this.block + 262144, count),
                        p = this.use(packet);
                    try {
                        if (
                            count >= 2 &&
                            m._freedv_gen_crc16(p.p, count - 2) === ((packet[count - 2] << 8) | packet[count - 1])
                        )
                            files.push({
                                name: `freedv-${f.mode}-packet-${++this.rxPacketCount}.bin`,
                                bytes: packet.slice(0, -2)
                            });
                    } finally {
                        p.free();
                    }
                }
            } else if (!f.codec) {
                count = m._freedv_rx(this.voice, this.block + 262144, this.block);
                if (count > 0) output.push(EngineCore.pcm(m, this.block + 262144, count));
                if (m._freedv_get_sync(this.voice)) this.syncedFrames++;
                this.allFrames++;
            } else break;
        }
        return {
            audio: joinChunks(output),
            rate: this.speechRate,
            files,
            syncedFrames: this.syncedFrames,
            totalFrames: this.allFrames
        };
    }
    /**
     * Select an automatically detected SSTV/fax receiver and retain its winning result.
     * @param {Object} sstv Current SSTV receiver result.
     * @param {boolean} fax Use the dedicated fax exports instead of SSTV exports.
     * @returns {Object} Winning automatic-picture receiver result.
     */
    pickPicture(sstv, fax) {
        if (sstv.line > 0 || sstv.finished) this.pictureWinner = 'sstv';
        else if (!this.pictureWinner && (fax.line > 0 || fax.finished)) this.pictureWinner = 'fax';
        return this.pictureWinner
            ? { ...(this.pictureWinner === 'sstv' ? sstv : fax), detectedEngine: this.pictureWinner }
            : {};
    }
    /**
     * Flush buffered input and return remaining receiver results without emitting completed pictures twice.
     * @returns {Promise<Object>} Final receiver result after flushing pending PCM.
     */
    async finish() {
        if (this.engine === 'pictures-auto') {
            const a = await this.sstv.finish(),
                b = await this.fax.finish();
            return this.pickPicture(a, b);
        }
        const e = this.engine,
            m = this.m;
        if (e === 'fldigi') {
            this.session.handle({ type: 'flush', generation: 1 });
            return this.modemSnapshot();
        }
        if (e === 'sstv') {
            if (!this.resampler.ended) {
                const tail = this.shift.process(this.resampler.push(new Float32Array(0), true));
                if (tail.length) {
                    m.HEAPF32.set(tail, this.block / 4);
                    m._web_process(this.block, tail.length);
                }
            }
            m._web_finish();
            return this.imageSnapshot(false, true);
        }
        if (e === 'fax') {
            m._fax_finish(1);
            return this.imageSnapshot(true, true);
        }
        if (e === 'weak') return this.processWeak(new Float32Array(0), true);
        if (e === 'drm') return this.digitalSnapshot();
        if (e === 'sensor' && this.sensorWasRaw) {
            const quiet = new Uint8Array(65536 * 2).fill(128);
            let text = '';
            for (let at = 0; at < this.targetRate / 5; at += 65536) {
                const count = Math.min(65536, Math.ceil(this.targetRate / 5 - at));
                text += this.sensorSamples({
                    bytes: quiet.subarray(0, count * 2),
                    count,
                    type: 0,
                    settings: this.settings
                }).text;
            }
            this.sensorWasRaw = false;
            return { text };
        }
        return {};
    }
    /**
     * Reconstruct a retained SSTV or modem picture using phase and sample-clock correction.
     * @returns {Object} Corrected retained picture and diagnostics.
     */
    redraw({ ppm, phase }) {
        if (this.engine === 'pictures-auto') return this.sstv.redraw({ ppm, phase });
        if (this.engine === 'fldigi' && ['THOR', 'IFKP', 'FSQ'].includes(this.format.family)) {
            if (!this.image) throw Error('Decode a picture before applying corrections.');
            const pixels = PictureTools.correctModemPicture(this.image, phase, ppm);
            this.settings = { ...this.settings, picturePhasePixels: Number(phase), pictureSlantPpm: Number(ppm) };
            return { width: this.image.width, height: this.image.height, pixels };
        }
        if (this.engine !== 'sstv') throw Error('This mode does not retain signal for picture correction.');
        this.m._web_redraw(ppm, phase);
        return this.imageSnapshot();
    }
    /**
     * Initialize native encoding, enforce FreeDV consent and return output rate/packet metadata.
     * @returns {Promise<Object>} Output rate and optional packet-plan metadata.
     */
    async encodeStart({
        format,
        settings,
        text = '',
        image,
        bytes,
        name = 'file.bin',
        audio,
        fix,
        transport,
        splitPackets = false
    }) {
        this.resetEncodeState(format, settings);
        const args = { format, settings, text, image, bytes, name, audio, fix, transport, splitPackets };
        switch (this.engine) {
            case 'fldigi':
                this.encodeFldigi(args);
                break;
            case 'sstv':
            case 'fax':
                this.encodePicture(args);
                break;
            case 'drm':
                this.encodeDrm(args);
                break;
            case 'weak':
                this.encodeWeakSignal(args);
                break;
            case 'sound':
                this.encodeSoundMessage(args);
                break;
            case 'packet':
                this.encodePacketRadio(args);
                break;
            case 'signaling':
                this.encodeSignaling(args);
                break;
            case 'voice':
                this.encodeVoice(args);
                break;
        }
        return {
            rate: this.outputRate,
            codec: !!format.codec,
            ...(this.dataPlan ? { packetPlan: this.dataPlan } : {})
        };
    }
    /** Reset transmission state before configuring an engine encoder. */
    resetEncodeState(format, settings) {
        this.format = format;
        this.settings = settings;
        this.encoding = true;
        this.total = 0;
        this.output = null;
        this.outputAt = 0;
        this.dataInput = null;
        this.dataPlan = null;
    }
    /** Configure fldigi and start either its text or picture transmitter. */
    encodeFldigi({ format, settings, text, image }) {
        const m = this.m;
        this.configureModem(format, settings);
        if (image) {
            const data = this.use(image.pixels),
                call = EngineCore.putString(m, settings.callsign);
            try {
                this.outputRate = m._web_tx_image_begin(
                    data.p,
                    image.width,
                    image.height,
                    image.gray ? 1 : 0,
                    image.format,
                    image.spp || 8,
                    0,
                    settings.txOffset || 0,
                    call
                );
            } finally {
                data.free();
                m._free(call);
            }
        } else {
            const p = EngineCore.putString(m, text);
            try {
                this.outputRate = m._web_tx_begin(p, 0, settings.txOffset || 0);
            } finally {
                m._free(p);
            }
        }
        if (!this.outputRate) throw Error('This format cannot encode the selected content.');
    }
    /** Start the selected SSTV or weather-fax picture transmitter. */
    encodePicture({ format, settings, image }) {
        const m = this.m,
            pixels = this.use(image.pixels),
            call = EngineCore.putString(m, settings.callsign || '');
        let ok;
        try {
            ok = this.engine === 'sstv'
                ? m._web_encode_start(format.mode, pixels.p, image.width, image.height, call)
                : m._fax_encode_start(format.mode, pixels.p, image.width, image.height, settings.wefaxLpm);
        } finally {
            pixels.free();
            m._free(call);
        }
        if (!ok) throw Error('Invalid picture dimensions or transmission duration.');
        this.outputRate = 11025;
    }
    /** Prepare an optional recovery-coded DRM payload and start native transmission. */
    encodeDrm({ settings, bytes, name, fix, transport }) {
        const m = this.m;
        if (!bytes?.length || bytes.length > 16777216) throw Error('Choose a file between 1 byte and 16 MB.');
        name = name.replace(/[\/\\\x00-\x1f]/g, '_').slice(0, 80);
        this.lastPayload = { bytes: bytes.slice(), name, settings: { ...settings } };
        let payload = bytes,
            filename = name;
        if (settings.rs && name !== 'bsr.bin') {
            const p = this.use(bytes),
                ext = EngineCore.putString(m, name.split('.').pop().slice(0, 3));
            try {
                const count = m._drm_rs_encode(p.p, bytes.length, ext, settings.rs);
                if (!count) throw Error('The recovery encoder rejected this file.');
                payload = EngineCore.arr(m, m._drm_rs_file(), count);
                filename = name.replace(/\.[^.]*$/, '') + '.rs' + settings.rs;
            } finally {
                p.free();
                m._free(ext);
            }
        }
        const p = this.use(payload),
            file = EngineCore.putString(m, filename),
            call = EngineCore.putString(m, settings.callsign || 'NOCALL'),
            blocks = fix?.length ? this.use(Int32Array.from(fix)) : null;
        try {
            m._drm_tx_fix(blocks?.p || 0, fix?.length || 0);
            const frames = m._drm_tx_start(
                p.p,
                payload.length,
                file,
                call,
                settings.drmMode,
                settings.drmBandwidth,
                settings.drmQam,
                settings.drmProtection,
                settings.drmInterleave,
                transport || 0
            );
            if (!frames) throw Error('Cannot initialize digital transmission.');
        } finally {
            p.free();
            m._free(file);
            m._free(call);
            blocks?.free();
        }
        this.outputRate = 48000;
    }
    /** Encode weak-signal text into a complete slot buffer. */
    encodeWeakSignal({ format, settings, text }) {
        const m = this.m,
            p = EngineCore.putString(m, text.toUpperCase());
        let n;
        try {
            n = m._wr_encode(p, format.mode, settings.frequency, settings.ftOffset);
        } finally {
            m._free(p);
        }
        if (n < 0)
            throw Error(
                'Use a supported FT message, such as “CQ K1ABC FN42”, or at most 13 characters from the FT alphabet.'
            );
        this.output = EngineCore.arr(m, m._wr_audio(), n, 'HEAPF32');
        this.outputRate = 12000;
    }
    /** Validate and encode one ggwave text message. */
    encodeSoundMessage({ format, settings, text }) {
        const m = this.m;
        m._wr_init(settings.ggPayload, settings.ggDss ? 1 : 0, settings.ggThreshold, settings.ggFrame, format.mode, settings.ggFreq);
        const encoded = new TextEncoder().encode(text);
        if (encoded.length > 140) throw Error('Sound messages are limited to 140 UTF-8 bytes.');
        if (settings.ggPayload && encoded.length !== settings.ggPayload)
            throw Error('Message length must match the fixed payload length.');
        const p = this.use(encoded);
        let n;
        try {
            n = m._wr_encode(p.p, encoded.length, format.mode, settings.ggVolume);
        } finally {
            p.free();
        }
        if (n < 0) throw Error('This sound-message format rejected the message.');
        this.output = EngineCore.arr(m, m._wr_audio(), n, 'HEAPF32');
        this.outputRate = 48000;
    }
    /** Initialize the packet modem, apply link controls and encode one AX.25 packet. */
    encodePacketRadio({ format, settings, text }) {
        const m = this.m,
            profiles = EngineCore.putString(m, settings.packetProfiles);
        try {
            m._wr_init(
                format.nativeType,
                settings.packetMark,
                settings.packetSpace,
                settings.packetBaud,
                profiles,
                settings.packetFix,
                settings.packetPassall ? 1 : 0,
                settings.packetV26
            );
        } finally {
            m._free(profiles);
        }
        for (const [i, key] of ['packetFec', 'packetFx', 'packetMaxFec', 'packetInvert'].entries())
            m._wr_option(i, Number(settings[key]));
        if (format.aprs && settings.aprsPayload === 'position') text = this.prepareAprsPosition(text, settings);
        const p = EngineCore.putString(m, text);
        let n;
        try {
            n = m._wr_encode(p, settings.packetDelay, settings.packetTail);
        } finally {
            m._free(p);
        }
        if (n < 0) throw Error('Use an AX.25 packet: SOURCE>DESTINATION[,PATH]:message');
        this.output = EngineCore.pcm(m, m._wr_audio(), n);
        this.outputRate = 48000;
    }
    /** Assemble a location packet using the native APRS coordinate encoder. */
    prepareAprsPosition(comment, settings) {
        if (!/^[A-Z0-9]{1,6}(?:-(?:[0-9]|1[0-5]))?$/.test(settings.aprsSender)) throw Error('Use an uppercase sender callsign, optionally followed by -0 to -15.');
        if (/[^\x20-\x7e]/.test(comment) || comment.length > 200) throw Error('Use at most 200 printable ASCII characters for a position comment.');
        const pointer = EngineCore.putString(this.m, comment);
        try {
            const payload = this.m._wr_aprs_position(settings.aprsLatitude, settings.aprsLongitude, Math.round(settings.aprsAltitude / 0.3048), Number(settings.aprsCompressed), pointer);
            if (!payload) throw Error('Could not create this position. Check the coordinates and comment.');
            return settings.aprsSender + '>APRS:' + this.m.UTF8ToString(payload);
        } finally {
            this.m._free(pointer);
        }
    }
    /** Configure signaling type and start native tone generation. */
    encodeSignaling({ format, settings, text }) {
        const m = this.m,
            type = EngineHost.signalingType(format.name),
            baud = EngineHost.signalingBaud(format.name),
            p = EngineCore.putString(m, text);
        try {
            this.outputRate = m._wr_tx_start(
                type,
                p,
                settings.pagerAddress,
                settings.pagerFunction,
                baud,
                settings.pagerInvert ? 1 : 0,
                Math.round(settings.signalDuration * 22.05),
                Math.round(settings.signalGap * 22.05)
            );
        } finally {
            m._free(p);
        }
        if (this.outputRate < 0) throw Error('This signaling format cannot generate the requested text.');
    }
    /** Map pager/tone-code names to native transmitter type numbers. */
    static signalingType(name) {
        if (name.startsWith('POCSAG')) return 7;
        if (name === 'FLEX') return 6;
        if (name === 'DTMF') return 0;
        return 2;
    }
    /** Select the pager bit rate encoded in the signaling format name. */
    static signalingBaud(name) {
        if (name.includes('512')) return 512;
        if (name.includes('2400')) return 2400;
        return 1200;
    }
    /** Prepare either FreeDV packet data or speech for transmission. */
    encodeVoice({ format, settings, bytes, audio, splitPackets }) {
        if (format.data) {
            this.encodeVoiceData(format, settings, bytes, splitPackets);
            return;
        }
        this.encodeVoiceAudio(format, settings, audio);
    }
    /** Plan packet count, require split consent and retain data for bounded reads. */
    encodeVoiceData(format, settings, bytes, splitPackets) {
        this.dataPlan = this.voiceDataPlan({ format, settings, size: bytes?.length });
        if (this.dataPlan.packetCount > 1 && splitPackets !== true)
            throw Error('Confirm splitting this file into multiple FreeDV packets before encoding.');
        this.setupVoice(format, settings);
        this.dataInput = bytes.slice();
        this.dataPos = 0;
        this.outputRate = this.targetRate;
    }
    /** Resample speech and prepare Codec2 file metadata when required. */
    encodeVoiceAudio(format, settings, audio) {
        this.setupVoice(format, settings);
        this.voiceInput = resample(audio.samples, audio.rate, this.speechRate);
        this.voicePos = 0;
        this.outputRate = format.codec ? 8000 : this.targetRate;
        if (format.codec) {
            this.codecBytes = [new Uint8Array([0xc0, 0xde, 0xc2, 1, 2, format.mode, settings.codecGray ? 0 : 1])];
        }
    }
    /**
     * Read the next bounded transmit block, preserving native framing and final-packet padding.
     * @returns {Object} Next PCM block, progress, completion flag and optional file.
     */
    encodeRead() {
        let block;
        if (this.output) {
            block = this.readBufferedOutput();
        } else {
            switch (this.engine) {
                case 'fldigi':
                    block = this.readFldigiOutput();
                    break;
                case 'sstv':
                case 'fax':
                    block = this.readPictureOutput();
                    break;
                case 'drm':
                    block = this.readDrmOutput();
                    break;
                case 'signaling':
                    block = this.readSignalingOutput();
                    break;
                case 'voice':
                    block = this.format.data ? this.readVoiceDataOutput() : this.readVoiceAudioOutput();
                    break;
                default:
                    block = { samples: new Float32Array(0), done: false, progress: 0 };
            }
        }
        return this.finishEncodedBlock(block);
    }
    /** Return the next chunk from a buffered weak-signal or sound-message waveform. */
    readBufferedOutput() {
        const samples = this.output.slice(this.outputAt, this.outputAt + 32768);
        this.outputAt += samples.length;
        return {
            samples,
            done: this.outputAt >= this.output.length,
            progress: this.outputAt / this.output.length
        };
    }
    /** Advance fldigi's transmit worker and copy its next generated block. */
    readFldigiOutput() {
        const m = this.m,
            n = m._web_tx_step(8192);
        if (n < 0) throw Error('Generated audio exceeds 30 minutes.');
        return {
            samples: EngineCore.arr(m, m._web_tx_buffer(), n, 'HEAPF32'),
            done: !!m._web_tx_done(),
            progress: this.format.imageTx ? m._web_tx_image_progress() / 100 : 0
        };
    }
    /** Read and copy the next SSTV or fax PCM block and its progress. */
    readPictureOutput() {
        const m = this.m,
            isFax = this.engine === 'fax',
            n = m[isFax ? '_fax_encode_read' : '_web_encode_read'](this.block, 32768),
            samples = EngineCore.pcm(m, this.block, n);
        return {
            samples,
            done: isFax ? !!m._fax_encode_done() : n < 32768,
            progress: m[isFax ? '_fax_encode_progress' : '_web_encode_progress']()
        };
    }
    /** Read the next DRM block after checking the native completion status. */
    readDrmOutput() {
        const m = this.m,
            n = m._drm_tx_read(this.block, 65536);
        if (n < 0) throw Error('Digital transmission did not finish.');
        return {
            samples: EngineCore.pcm(m, this.block, n),
            done: n === 0,
            progress: m._drm_tx_progress()
        };
    }
    /** Read and copy the next signaling tone block. */
    readSignalingOutput() {
        const m = this.m,
            n = m._wr_tx_read(this.block, 32768);
        return { samples: EngineCore.pcm(m, this.block, n), done: n < 32768, progress: 0 };
    }
    /** Encode one FreeDV packet, including first/last packet framing and padding. */
    readVoiceDataOutput() {
        const m = this.m,
            part = this.dataInput.subarray(this.dataPos, this.dataPos + this.dataPlan.payloadBytes),
            payload = new Uint8Array(this.frameBytes);
        // Alternating bits keep the FSK tone estimates stable in a short final packet.
        payload.fill(this.dataPlan.paddingByte, 0, this.dataPlan.payloadBytes);
        payload.set(part);
        const last = this.dataPos + part.length >= this.dataInput.length,
            fsk = this.format.mode === 9;
        const p = this.use(payload),
            pieces = [];
        try {
            const crc = m._freedv_gen_crc16(p.p, this.dataPlan.payloadBytes);
            m.HEAPU8[p.p + this.frameBytes - 2] = crc >> 8;
            m.HEAPU8[p.p + this.frameBytes - 1] = crc & 255;
            if (!fsk || this.dataPos === 0) {
                const n = m._freedv_rawdatapreambletx(this.voice, this.block);
                pieces.push(EngineCore.pcm(m, this.block, n));
            }
            m._freedv_rawdatatx(this.voice, this.block, p.p);
            const frameSamples = m._freedv_get_n_tx_modem_samples(this.voice);
            pieces.push(EngineCore.pcm(m, this.block, frameSamples));
            if (!fsk || last) {
                const n = m._freedv_rawdatapostambletx(this.voice, this.block);
                pieces.push(EngineCore.pcm(m, this.block, n));
                if (fsk) this.appendFskAcquisitionTail(pieces, frameSamples, m);
                pieces.push(new Float32Array(Math.floor(this.targetRate / 2)));
            }
        } finally {
            p.free();
        }
        const samples = joinChunks(pieces);
        this.dataPos += part.length;
        return {
            samples,
            done: this.dataPos >= this.dataInput.length,
            progress: this.dataPos / this.dataInput.length
        };
    }
    /** Add acquisition tones until the FSK tail reaches one complete data frame. */
    appendFskAcquisitionTail(pieces, frameSamples, m) {
        let tail = frameSamples;
        while (tail > 0) {
            const count = m._freedv_rawdatapreambletx(this.voice, this.block),
                used = Math.min(tail, count);
            pieces.push(EngineCore.pcm(m, this.block, used));
            tail -= used;
        }
    }
    /** Encode up to fifty speech frames into Codec2 bytes or FreeDV audio. */
    readVoiceAudioOutput() {
        const m = this.m,
            chunks = [],
            format = this.format;
        for (let frame = 0; frame < 50 && this.voicePos < this.voiceInput.length; frame++) {
            const n = this.frame;
            for (let i = 0; i < n; i++)
                m.HEAP16[this.block / 2 + i] = Math.max(
                    -32768,
                    Math.min(32767, Math.round((this.voiceInput[this.voicePos + i] || 0) * 32767))
                );
            if (format.codec) {
                m._codec2_encode(this.codec, this.block + 262144, this.block);
                this.codecBytes.push(EngineCore.arr(m, this.block + 262144, this.frameBytes));
            } else {
                m._freedv_tx(this.voice, this.block + 262144, this.block);
                chunks.push(EngineCore.pcm(m, this.block + 262144, m._freedv_get_n_nom_modem_samples(this.voice)));
            }
            this.voicePos += n;
        }
        return {
            samples: joinChunks(chunks),
            done: this.voicePos >= this.voiceInput.length,
            progress: Math.min(1, this.voicePos / this.voiceInput.length)
        };
    }
    /** Apply output limits, update active state and attach a finished Codec2 file. */
    finishEncodedBlock({ samples, done, progress }) {
        this.total += samples.length;
        if (this.total > this.outputRate * 1800) throw Error('Generated audio exceeds the 30-minute limit.');
        this.encoding = !done;
        const result = { samples, rate: this.outputRate, done, progress };
        if (done && this.format.codec) result.file = this.codecFile();
        return result;
    }
    /** Assemble retained Codec2 frames into the downloadable .c2 file. */
    codecFile() {
        const total = this.codecBytes.reduce((sum, chunk) => sum + chunk.length, 0),
            bytes = new Uint8Array(total);
        let at = 0;
        for (const chunk of this.codecBytes) {
            bytes.set(chunk, at);
            at += chunk.length;
        }
        return { name: 'webrad-speech.c2', bytes };
    }
    /**
     * Validate a Codec2 file header/frame layout and recover bounded speech PCM.
     * @returns {Object} Recovered speech PCM and sample rate.
     */
    decodeCodec({ bytes, format, settings }) {
        const start = bytes[0] === 0xc0 && bytes[1] === 0xde && bytes[2] === 0xc2 ? 7 : 0;
        if (start && (bytes.length < 7 || bytes[3] !== 1 || bytes[5] !== format.mode))
            throw Error('The speech file header or codec mode is incompatible.');
        this.setupVoice(format, { ...settings, ...(start ? { codecGray: !(bytes[6] & 1) } : {}) });
        const m = this.m;
        if ((bytes.length - start) % this.frameBytes) throw Error('The speech file ends inside a codec frame.');
        if (((bytes.length - start) / this.frameBytes) * this.frame > 8000 * 1800)
            throw Error('Speech file exceeds the 30-minute limit.');
        const chunks = [];
        for (let at = start; at + this.frameBytes <= bytes.length; at += this.frameBytes) {
            m.HEAPU8.set(bytes.subarray(at, at + this.frameBytes), this.block);
            m._codec2_decode(this.codec, this.block + 262144, this.block);
            chunks.push(EngineCore.pcm(m, this.block + 262144, this.frame));
        }
        return { audio: joinChunks(chunks), rate: 8000 };
    }
    /**
     * Decode one validated pulse/gap package with the selected sensor modulation.
     * @returns {Object} Recovered sensor messages.
     */
    sensorPulses({ pairs, settings }) {
        const m = this.m,
            p = this.use(Int32Array.from(pairs));
        try {
            return {
                text: m.UTF8ToString(
                    m._wr_decode(p.p, pairs.length / 2, settings.sensorModulation, settings.sensorDisabled ? 1 : 0)
                )
            };
        } finally {
            p.free();
        }
    }
    /**
     * Feed raw I/Q or baseband samples into the sensor receiver with acquisition padding.
     * @returns {Object} Recovered sensor messages from raw samples.
     */
    sensorSamples({ bytes, count, type, settings }) {
        const m = this.m;
        if (!this.sensorWasRaw) {
            const lead = Math.min(65536, Math.ceil(this.targetRate / 20));
            m.HEAPU8.fill(128, this.block, this.block + lead * 2);
            m._wr_iq(this.block, lead, 0, settings.sensorDisabled ? 1 : 0);
        }
        this.sensorWasRaw = true;
        const p = this.use(bytes);
        try {
            return { text: m.UTF8ToString(m._wr_iq(p.p, count, type, settings.sensorDisabled ? 1 : 0)) };
        } finally {
            p.free();
        }
    }
    /**
     * Encode or decode JPEG 2000 through owned native allocations.
     * @returns {Object} Decoded RGBA picture or encoded JPEG 2000 bytes.
     */
    imageCodec({ action, bytes, pixels, width, height, ratio }) {
        const m = this.m,
            p = this.use(action === 'decode' ? bytes : pixels);
        try {
            if (action === 'decode') {
                if (!m._jp2_decode(p.p, bytes.length)) throw Error('Unsupported or invalid JPEG 2000 image.');
                width = m._jp2_width();
                height = m._jp2_height();
                return { width, height, pixels: EngineCore.arr(m, m._jp2_pixels(), width * height * 4) };
            }
            const n = m._jp2_encode(p.p, width, height, ratio);
            if (!n) throw Error('JPEG 2000 encoding failed.');
            return { bytes: EngineCore.arr(m, m._jp2_file(), n) };
        } finally {
            p.free();
        }
    }
    /**
     * Stop native transmission and clear pending encoded data while retaining the core.
     * @returns {Object} Empty acknowledgment after native cancellation.
     */
    cancel() {
        const m = this.m,
            e = this.engine;
        if (e === 'drm') m._drm_tx_cancel();
        if (e === 'sstv') m._web_encode_cancel();
        if (e === 'fax') m._fax_encode_cancel();
        this.output = null;
        this.dataInput = null;
        this.encoding = false;
        return {};
    }
}
/** Retains the input-rate frequency translator for one fldigi host.
 * @property {EngineHost} host Receiver host whose translator is reused.
 */
class FrequencyShiftPass {
    /**
     * Attach a retained input-frequency translator to the receiver.
     * @param {EngineHost} host Receiver host.
     * @param {Object} s Receiver settings, including frequencyShift in hertz.
     */
    constructor(host, s) {
        this.host = host;
        if (!host.inputShift) host.inputShift = new FrequencyShift(host.rate, s.frequencyShift || 0);
    }
    /**
     * Translate a PCM block at the receiver input rate.
     * @param {Float32Array} input Input PCM block.
     * @returns {Float32Array} Frequency-translated PCM block.
     */
    process(input) {
        return this.host.inputShift.process(input);
    }
}
export const loadCore = EngineCore.loadCore.bind(EngineCore);
export const coreCatalog = EngineCore.coreCatalog.bind(EngineCore);
