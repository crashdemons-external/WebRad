/* QSSTV DRM worker boundary. Original DSP runs in the separate qsstv-core.wasm. */
(function (root) {
    // Resolve runtime assets beside this script, even when the application page
    // lives elsewhere. Workers resolve assets beside their own entry point.
    const runtimeBase =
        typeof document !== 'undefined' && document.currentScript?.src
            ? new URL('.', document.currentScript.src).href
            : typeof self !== 'undefined' && self.location?.href
              ? new URL('.', self.location.href).href
              : null;
    const runtimePath = (name) => (runtimeBase ? new URL(name, runtimeBase).href : name);

    ('use strict');
    class DigitalCore {
        static async create() {
            const core = await createQSSTV({
                locateFile: (name, dir) => dir + name + (typeof location === 'undefined' ? '' : location.search)
            });
            core._drm_rx_reset(1);
            return new DigitalCore(core);
        }
        constructor(core) {
            this.core = core;
            this.input = core._malloc(65536 * 4);
            this.output = core._malloc(65536 * 2);
            this.serial = core._drm_rx_status(13);
        }
        bytes(bytes) {
            const p = this.core._malloc(bytes.length);
            this.core.HEAPU8.set(bytes, p);
            return p;
        }
        string(value) {
            return this.bytes(new TextEncoder().encode(String(value) + '\0'));
        }
        call(action, args = {}) {
            switch (action) {
                case 'reset':
                    return this.reset(args.clear);
                case 'process':
                    return this.processSamples(args.samples);
                case 'bsr':
                    return { text: this.core.UTF8ToString(this.core._drm_rx_bsr()) };
                case 'start':
                    return this.startTransmission(args);
                case 'read':
                    return this.readTransmission();
                case 'cancel':
                    return this.cancelTransmission();
                default:
                    return this.snapshot();
            }
        }
        /** Reset the receiver and return its current snapshot. */
        reset(clear) {
            this.core._drm_rx_reset(clear ? 1 : 0);
            return this.snapshot();
        }
        /** Feed input samples to the DRM decoder in bounded native blocks. */
        processSamples(samples) {
            const m = this.core;
            for (let i = 0; i < samples.length; i += 65536) {
                const block = samples.subarray(i, i + 65536);
                m.HEAPF32.set(block, this.input / 4);
                m._drm_rx_process(this.input, block.length);
            }
            return this.snapshot();
        }
        /** Validate file input, prepare native buffers and start DRM transmission. */
        startTransmission(args) {
            this.validateTransmission(args);
            const m = this.core,
                nativeBytes = this.bytes(args.bytes),
                nativeName = this.string(args.name),
                nativeCall = this.string(args.call || 'NOCALL');
            const fix = new Int32Array(args.fix || []),
                blocks = fix.length ? m._malloc(fix.byteLength) : 0,
                pointers = { bytes: nativeBytes, name: nativeName, call: nativeCall, encoded: 0, rsName: 0, blocks };
            try {
                if (blocks) m.HEAPU8.set(new Uint8Array(fix.buffer), blocks);
                m._drm_tx_fix(blocks, fix.length);
                const payload = this.prepareTransmissionPayload(args, pointers),
                    frames = m._drm_tx_start(
                        payload.pointer,
                        payload.count,
                        payload.filename,
                        nativeCall,
                        args.mode ?? 2,
                        args.bandwidth ?? 1,
                        args.qam ?? 1,
                        args.protection ?? 0,
                        args.interleave ?? 0,
                        args.transport ?? 0
                    );
                if (!frames) throw Error('Invalid digital mode or file.');
                return { frames };
            } finally {
                for (const p of [pointers.bytes, pointers.name, pointers.call, pointers.encoded, pointers.rsName, pointers.blocks])
                    if (p) m._free(p);
            }
        }
        /** Normalize the caller's filename and callsign before native allocation. */
        validateTransmission(args) {
            if (!args.bytes?.length || args.bytes.length > 16 * 1024 * 1024)
                throw Error('Digital file must be 1 byte to 16 MB.');
            args.name = String(args.name || 'file.bin')
                .replace(/[\/\x00-\x1f]/g, '_')
                .slice(0, 80);
            args.call = String(args.call || 'NOCALL').slice(0, 9);
            if (args.name === 'bsr.bin') args.rs = 0;
        }
        /** Build an optional recovery-coded payload and its transmitted filename. */
        prepareTransmissionPayload(args, pointers) {
            const m = this.core;
            let pointer = pointers.bytes,
                count = args.bytes.length,
                filename = pointers.name;
            if (args.rs) {
                const ext = this.string(args.name.split('.').pop().slice(0, 3));
                try {
                    count = m._drm_rs_encode(pointers.bytes, count, ext, args.rs);
                } finally {
                    m._free(ext);
                }
                if (!count) throw Error('Could not encode Reed–Solomon data.');
                pointers.encoded = this.bytes(m.HEAPU8.slice(m._drm_rs_file(), m._drm_rs_file() + count));
                pointer = pointers.encoded;
                pointers.rsName = this.string(args.name.replace(/\.[^.]*$/, '') + '.rs' + args.rs);
                filename = pointers.rsName;
            }
            return { pointer, count, filename };
        }
        /** Read the next native DRM audio block and report transmission progress. */
        readTransmission() {
            const m = this.core,
                count = m._drm_tx_read(this.output, 65536);
            if (count < 0) throw Error('DRM encoder did not finish.');
            return {
                pcm: m.HEAPU8.slice(this.output, this.output + count * 2),
                done: count === 0,
                progress: m._drm_tx_progress()
            };
        }
        /** Stop native DRM transmission. */
        cancelTransmission() {
            this.core._drm_tx_cancel();
            return {};
        }
        snapshot() {
            const m = this.core,
                status = Array.from({ length: 15 }, (_, i) => m._drm_rx_status(i));
            const constellations = [0, 1].map((kind) => {
                const p = m._drm_rx_constellation(kind),
                    count = m._drm_rx_constellation_count(kind);
                return m.HEAPF32.slice(p / 4, p / 4 + 2 * count);
            });
            const result = {
                constellations,
                status,
                snr: m._drm_rx_snr(),
                offset: m._drm_rx_offset(),
                call: m.UTF8ToString(m._drm_rx_call())
            };
            if (status[13] !== this.serial) {
                this.serial = status[13];
                const p = m._drm_rx_file();
                result.file = {
                    name: m.UTF8ToString(m._drm_rx_name()),
                    bytes: m.HEAPU8.slice(p, p + m._drm_rx_size())
                };
            }
            return result;
        }
    }
    class DigitalEngine {
        static async create() {
            const worker = new Worker(runtimePath('digital-worker.js') + '?v=' + (root.MMSAssetVersion || '')),
                engine = new DigitalEngine(worker);
            await engine.call('init');
            return engine;
        }
        constructor(worker) {
            this.worker = worker;
            this.nextId = 1;
            this.pending = new Map();
            this.failure = null;
            worker.onmessage = ({ data }) => {
                const p = this.pending.get(data.id);
                if (!p) return;
                this.pending.delete(data.id);
                data.error ? p.reject(Error(data.error)) : p.resolve(data.result);
            };
            worker.onerror = (event) => {
                this.failure = Error(event.message || 'Digital modem worker failed.');
                for (const p of this.pending.values()) p.reject(this.failure);
                this.pending.clear();
                worker.terminate();
            };
        }
        call(action, args = {}) {
            if (this.failure) return Promise.reject(this.failure);
            return new Promise((resolve, reject) => {
                const id = this.nextId++;
                this.pending.set(id, { resolve, reject });
                try {
                    this.worker.postMessage({ id, action, args }, args.samples ? [args.samples.buffer] : []);
                } catch (error) {
                    this.pending.delete(id);
                    reject(error);
                }
            });
        }
    }
    root.QSSTVDigitalCore = DigitalCore;
    root.QSSTVDigitalEngine = DigitalEngine;
})(globalThis);
