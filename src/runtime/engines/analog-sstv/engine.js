/* Shared adapter used by the DSP workers and main-thread fallback. */
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
    function createCore() {
        if (typeof location !== 'undefined' && location.protocol === 'file:') {
            throw new Error('Serve the app over HTTP(S) to load the WASM file.');
        }
        // Emscripten resolves mmsstv-core.wasm beside its JavaScript loader.
        const version =
            typeof location === 'undefined'
                ? ''
                : root.MMSAssetVersion || new URLSearchParams(location.search).get('v') || '';
        return createMMSSTV({ locateFile: (name, dir) => dir + name + (version ? '?v=' + version : '') });
    }
    class CoreEngine {
        static async create() {
            const core = await createCore();
            core._web_init();
            return new CoreEngine(core);
        }
        constructor(core) {
            this.core = core;
            this.pointer = core._malloc(65536 * 4);
            this.revision = -1;
            this.completed = 0;
            this.modes = Array.from({ length: core._web_mode_count() }, (_, id) => ({
                id,
                name: core.UTF8ToString(core._web_mode_name(id)),
                width: core._web_mode_width(id),
                height: core._web_mode_height(id),
                txHeight: core._web_mode_tx_height(id)
            }));
        }
        call(action, args = {}) {
            const m = this.core;
            if (action === 'reset') {
                m._web_reset(args.mode);
                this.revision = -1;
            }
            if (action === 'option') {
                m._web_option(args.id, args.value);
                return {};
            }
            if (action === 'finish') m._web_finish();
            if (action === 'redraw') m._web_redraw(args.ppm, args.phase);
            if (action === 'process') {
                const values = args.samples;
                for (let n = 0; n < values.length; n += 65536) {
                    const part = values.subarray(n, n + 65536);
                    m.HEAPF32.set(part, this.pointer / 4);
                    m._web_process(this.pointer, part.length);
                }
            }
            return this.snapshot();
        }
        snapshot() {
            const m = this.core,
                revision = m._web_revision(),
                width = m._web_width(),
                height = m._web_height();
            const result = {
                revision,
                width,
                height,
                mode: m._web_mode(),
                serial: m._web_serial(),
                completed: m._web_completed(),
                receiving: !!m._web_receiving(),
                line: m._web_line(),
                level: m._web_level(),
                afc: m._web_afc(),
                fsk: m.UTF8ToString(m._web_fsk())
            };
            if (result.completed !== this.completed) {
                const w = m._web_completed_width(),
                    h = m._web_completed_height(),
                    p = m._web_completed_pixels();
                result.finished = {
                    width: w,
                    height: h,
                    line: m._web_completed_line(),
                    fraction: m._web_completed_fraction(),
                    mode: m._web_completed_mode(),
                    serial: m._web_completed_serial(),
                    pixels: m.HEAPU8.slice(p, p + w * h * 4)
                };
                this.completed = result.completed;
            }
            if (revision !== this.revision) {
                const p = m._web_pixels(),
                    s = m._web_sync_pixels();
                result.pixels = m.HEAPU8.slice(p, p + width * height * 4);
                result.sync = m.HEAPU8.slice(s, s + 320 * 256 * 4);
                this.revision = revision;
            }
            const spectrum = m._web_spectrum();
            result.spectrum = m.HEAP32.slice(spectrum / 4, spectrum / 4 + 1024);
            return result;
        }
    }
    class DecoderEngine {
        static async create() {
            // Use a worker when available, with the same separately loaded WASM in either path.
            if (location.protocol !== 'file:' && typeof Worker !== 'undefined') {
                let worker;
                try {
                    worker = new Worker(runtimePath('decoder-worker.js') + '?v=' + (root.MMSAssetVersion || ''));
                    const engine = new DecoderEngine(worker);
                    const initialized = await engine.call('init');
                    engine.modes = initialized.modes;
                    return engine;
                } catch (error) {
                    if (worker) worker.terminate();
                    console.warn('Using the main-thread receiver.', error);
                }
            }
            const core = await CoreEngine.create(),
                engine = new DecoderEngine(null, core);
            engine.modes = core.modes;
            return engine;
        }
        constructor(worker, local) {
            this.worker = worker;
            this.local = local;
            this.requests = new Map();
            this.nextId = 1;
            if (worker) {
                worker.onmessage = (event) => {
                    const { id, result, error } = event.data,
                        pending = this.requests.get(id);
                    if (!pending) return;
                    this.requests.delete(id);
                    if (error) pending.reject(new Error(error));
                    else pending.resolve(result);
                };
                worker.onerror = (error) => {
                    for (const pending of this.requests.values())
                        pending.reject(new Error(error.message || 'Decoder worker failed.'));
                    this.requests.clear();
                };
            }
        }
        call(action, args = {}) {
            if (this.local) return Promise.resolve(this.local.call(action, args));
            return new Promise((resolve, reject) => {
                const id = this.nextId++;
                this.requests.set(id, { resolve, reject });
                this.worker.postMessage({ id, action, args }, args.samples ? [args.samples.buffer] : []);
            });
        }
    }
    class CoreEncoder {
        static async create() {
            return new CoreEncoder(await createCore());
        }
        constructor(core) {
            this.core = core;
            this.pointer = core._malloc(32768 * 2);
        }
        call(action, args = {}) {
            const m = this.core;
            if (action === 'start') {
                const pixels = args.pixels,
                    call = String(args.call || '')
                        .toUpperCase()
                        .replace(/[^\x20-\x5f]/g, '')
                        .slice(0, 18);
                if (!pixels || pixels.length !== args.width * args.height * 4)
                    throw new Error('Invalid encoder image.');
                const image = m._malloc(pixels.length),
                    id = m._malloc(call.length + 1);
                try {
                    m.HEAPU8.set(pixels, image);
                    m.HEAPU8.set(Uint8Array.from([...(call + '\0')].map((c) => c.charCodeAt(0))), id);
                    if (!m._web_encode_start(args.mode, image, args.width, args.height, id))
                        throw new Error('Invalid SSTV mode or image size.');
                } finally {
                    m._free(image);
                    m._free(id);
                }
                return {};
            }
            if (action === 'cancel') {
                m._web_encode_cancel();
                return {};
            }
            if (action === 'read') {
                const count = m._web_encode_read(this.pointer, 32768);
                return {
                    pcm: m.HEAPU8.slice(this.pointer, this.pointer + count * 2),
                    progress: m._web_encode_progress(),
                    done: count < 32768
                };
            }
            return {};
        }
    }
    class EncoderEngine extends DecoderEngine {
        static async create() {
            if (location.protocol !== 'file:' && typeof Worker !== 'undefined') {
                let worker;
                try {
                    worker = new Worker(runtimePath('encoder-worker.js') + '?v=' + (root.MMSAssetVersion || ''));
                    const engine = new EncoderEngine(worker);
                    await engine.call('init');
                    return engine;
                } catch (error) {
                    worker?.terminate();
                    console.warn('Using the main-thread audio encoder.', error);
                }
            }
            return new EncoderEngine(null, await CoreEncoder.create());
        }
        call(action, args = {}) {
            if (this.local) return Promise.resolve(this.local.call(action, args));
            return new Promise((resolve, reject) => {
                const id = this.nextId++;
                this.requests.set(id, { resolve, reject });
                this.worker.postMessage({ id, action, args }, args.pixels ? [args.pixels.buffer] : []);
            });
        }
    }
    root.MMSCoreEngine = CoreEngine;
    root.MMSDecoderEngine = DecoderEngine;
    root.MMSCoreEncoder = CoreEncoder;
    root.MMSEncoderEngine = EncoderEngine;
})(globalThis);
