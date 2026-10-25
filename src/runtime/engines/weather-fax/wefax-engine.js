/* WEFAX processing with fldigi DSP and MMSSTV picture/audio utilities. */
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
    const modes = [
        { id: 46, name: 'WEFAX IOC576', width: 1809 },
        { id: 47, name: 'WEFAX IOC288', width: 904 }
    ].map((m) => ({ ...m, height: 0, txHeight: 512, family: 'WEFAX' }));
    const isFax = (mode) => mode === 46 || mode === 47;
    let loading;
    async function loadCore() {
        const version =
            root.MMSAssetVersion ||
            (typeof location !== 'undefined' ? new URLSearchParams(location.search).get('v') : '') ||
            '';
        if (!root.createWEFAX) {
            loading ||= new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = new URL('../../../wasm/weather-fax.js', runtimeBase).href + '?v=' + version;
                script.onload = resolve;
                script.onerror = () => reject(Error('Could not load WEFAX core.'));
                document.head.append(script);
            });
            await loading;
        }
        return root.createWEFAX({ locateFile: (name, dir) => dir + name + (version ? '?v=' + version : '') });
    }
    class FaxCore {
        static async create(encoder = false) {
            const m = await loadCore();
            return new FaxCore(m, encoder);
        }
        constructor(core, encoder) {
            this.core = core;
            this.encoder = encoder;
            this.mode = 46;
            this.pointer = core._malloc(65536 * 4);
            this.revision = -1;
            this.completed = core._fax_completed();
            if (!encoder) core._fax_reset(0);
        }
        call(action, args = {}) {
            switch (action) {
                case 'reset':
                    this.reset(args);
                    break;
                case 'option':
                    if (this.setOption(args)) return {};
                    break;
                case 'finish':
                    this.core._fax_finish(args.automatic ? 0 : 1);
                    break;
                case 'process':
                    this.processSamples(args.samples);
                    break;
                case 'start':
                    return this.startTransmission(args);
                case 'read':
                    return this.readTransmission();
                case 'cancel':
                    return this.cancelTransmission();
            }
            return this.snapshotAfterAction(action, args);
        }
        /** Reset the selected fax mode and refresh its completion counters. */
        reset(args) {
            const m = this.core;
            this.mode = args.mode;
            m._fax_reset(this.mode - 46);
            this.revision = -1;
            this.completed = m._fax_completed();
        }
        /** Apply a fax option and report whether it needs no follow-up snapshot. */
        setOption(args) {
            this.core._fax_option(args.id, args.value);
            return [0, 1, 5, 7].includes(args.id);
        }
        /** Feed input samples to the fax decoder in bounded native blocks. */
        processSamples(samples) {
            const m = this.core;
            for (let i = 0; i < samples.length; i += 65536) {
                const part = samples.subarray(i, i + 65536);
                m.HEAPF32.set(part, this.pointer / 4);
                m._fax_process(this.pointer, part.length);
            }
        }
        /** Validate picture dimensions and start the native fax transmitter. */
        startTransmission(args) {
            if (
                !isFax(args.mode) ||
                !Number.isInteger(args.width) ||
                !Number.isInteger(args.height) ||
                args.height < 1 ||
                args.height > 8192 ||
                !Number.isInteger(args.lpm ?? 1) ||
                !args.pixels ||
                args.pixels.length !== args.width * args.height * 4
            )
                throw Error('Invalid WEFAX image.');
            const m = this.core,
                p = m._malloc(args.pixels.length);
            try {
                m.HEAPU8.set(args.pixels, p);
                if (!m._fax_encode_start(args.mode - 46, p, args.width, args.height, args.lpm ?? 1))
                    throw Error('Invalid WEFAX dimensions, line speed, or duration (maximum 30 minutes).');
            } finally {
                m._free(p);
            }
            return {};
        }
        /** Read the next native fax PCM block and report progress. */
        readTransmission() {
            const m = this.core,
                count = m._fax_encode_read(this.pointer, 32768);
            return {
                pcm: m.HEAPU8.slice(this.pointer, this.pointer + count * 2),
                progress: m._fax_encode_progress(),
                done: !!m._fax_encode_done()
            };
        }
        /** Cancel native fax transmission. */
        cancelTransmission() {
            this.core._fax_encode_cancel();
            return {};
        }
        /** Retain a completed picture when the current image page has already reset. */
        snapshotAfterAction(action, args) {
            const m = this.core,
                result = this.snapshot();
            // Native APT can already have opened an empty next page. Keep the most
            // recently completed picture visible when the file/input ends.
            if (
                (action === 'finish' || (action === 'option' && args.id === 4)) &&
                !result.line &&
                m._fax_finished_width() &&
                46 + m._fax_finished_mode() === this.mode
            ) {
                result.width = m._fax_finished_width();
                result.height = m._fax_finished_height();
                result.line = result.height;
                result.pixels = m.HEAPU8.slice(
                    m._fax_finished_pixels(),
                    m._fax_finished_pixels() + result.width * result.height * 4
                );
                result.serial = m._fax_finished_serial();
            }
            return result;
        }
        snapshot() {
            const m = this.core,
                width = m._fax_width(),
                height = m._fax_height(),
                revision = m._fax_revision();
            const result = {
                mode: this.mode,
                width,
                height,
                revision,
                serial: m._fax_serial(),
                completed: m._fax_completed(),
                line: m._fax_line(),
                receiving: m._fax_state() === 3,
                faxState: m._fax_state(),
                level: m._fax_level(),
                afc: m._fax_frequency() - 1900,
                fsk: '',
                spectrum: m.HEAP32.slice(m._fax_spectrum() / 4, m._fax_spectrum() / 4 + 1024)
            };
            result.faxDetected = m._fax_detected();
            if (revision !== this.revision) {
                this.revision = revision;
                result.pixels = m.HEAPU8.slice(m._fax_pixels(), m._fax_pixels() + width * height * 4);
            }
            if (result.completed !== this.completed) {
                this.completed = result.completed;
                const w = m._fax_finished_width(),
                    h = m._fax_finished_height();
                result.finished = {
                    width: w,
                    height: h,
                    line: h,
                    fraction: 1,
                    mode: 46 + m._fax_finished_mode(),
                    serial: m._fax_finished_serial(),
                    pixels: m.HEAPU8.slice(m._fax_finished_pixels(), m._fax_finished_pixels() + w * h * 4)
                };
            }
            return result;
        }
    }
    async function createFaxEngine(encoder = false) {
        if (typeof Worker !== 'undefined' && typeof location !== 'undefined' && location.protocol !== 'file:') {
            const worker = new Worker(runtimePath('wefax-worker.js') + '?v=' + (root.MMSAssetVersion || ''));
            const engine = encoder ? new MMSEncoderEngine(worker) : new MMSDecoderEngine(worker);
            try {
                await engine.call('init', { encoder });
                return engine;
            } catch (error) {
                worker.terminate();
                console.warn('Using main-thread WEFAX.', error);
            }
        }
        const local = await FaxCore.create(encoder);
        return encoder ? new MMSEncoderEngine(null, local) : new MMSDecoderEngine(null, local);
    }
    class SharedDecoder {
        static async create() {
            const analog = await MMSDecoderEngine.create();
            return new SharedDecoder(analog);
        }
        constructor(analog) {
            this.analog = analog;
            this.modes = [...analog.modes, ...modes];
            this.mode = -1;
            this.completed = 0;
            this.options = {};
            this.faxOptions = { 1: 1 };
            this.queue = Promise.resolve();
        }
        call(action, args = {}) {
            // Loading a new worker must finish before input/settings reach that mode.
            const pending = this.queue.then(() => this.handle(action, args));
            this.queue = pending.catch(() => {});
            return pending;
        }
        async handle(action, args) {
            if (action === 'reset') {
                this.mode = args.mode;
                this.autoActive = this.autoDisplay = null;
                this.autoNeedsReset = true;
            }
            switch (action) {
                case 'fax-option':
                    return this.handleFaxOption(args);
                case 'option': {
                    const result = await this.handleOption(args);
                    if (result.handled) return result.value;
                    break;
                }
                case 'process':
                    if (this.mode === -1) return this.processAuto(args.samples);
                    break;
                case 'snapshot':
                case 'finish':
                case 'redraw': {
                    const result = await this.handleAutomaticAction(action, args);
                    if (result.handled) return result.value;
                    break;
                }
            }
            const engine = await this.engineForMode();
            if (isFax(this.mode) && action === 'reset') return this.resetFax(engine, args);
            return this.adapt(await engine.call(action, args));
        }
        /** Cache fax controls and route them to the active fax decoders. */
        async handleFaxOption(args) {
            if ([1, 5, 6].includes(args.id)) this.faxOptions[args.id] = args.value;
            if (this.mode === -1 && this.autoCandidates) {
                if ([1, 5].includes(args.id)) {
                    for (const engine of this.autoCandidates) await engine.call('option', args);
                    return {};
                }
                return this.autoDisplay == null
                    ? {}
                    : this.adapt(await this.autoCandidates[this.autoDisplay].call('option', args));
            }
            if (!isFax(this.mode)) return {};
            return this.adapt(await this.fax.call('option', args));
        }
        /** Cache general controls and route only those handled by the active fax mode. */
        async handleOption(args) {
            this.options[args.id] = args.value;
            if (isFax(this.mode)) {
                const value = args.id === 0
                    ? this.adapt(await this.fax.call('option', { id: 0, value: args.value }))
                    : {};
                return { handled: true, value };
            }
            if (this.mode === -1 && args.id === 0 && this.autoCandidates)
                for (const engine of this.autoCandidates) await engine.call('option', args);
            return { handled: false };
        }
        /** Forward snapshots, finish and redraw to the currently selected automatic candidate. */
        async handleAutomaticAction(action, args) {
            if (
                this.mode !== -1 ||
                this.autoDisplay === null ||
                this.autoDisplay === undefined
            )
                return { handled: false };
            const candidateAction = action === 'redraw' ? 'snapshot' : action,
                result = await this.autoCandidates[this.autoDisplay].call(candidateAction, args);
            return { handled: true, value: this.adapt(result) };
        }
        /** Return the analog receiver or lazily create the selected fax receiver. */
        async engineForMode() {
            if (!isFax(this.mode)) return this.analog;
            this.fax ||= await createFaxEngine();
            return this.fax;
        }
        /** Reset a selected fax engine and restore its cached control values. */
        async resetFax(engine, args) {
            await engine.call('reset', args);
            for (const [id, value] of Object.entries(this.faxOptions))
                await engine.call('option', { id: Number(id), value });
            await engine.call('option', { id: 0, value: this.options[0] ?? 1 });
            return this.adapt(await engine.call('snapshot'));
        }
        async resetAutoCandidates() {
            this.autoCandidates ||= await Promise.all([createFaxEngine(), createFaxEngine()]);
            for (let index = 0; index < 2; index++) {
                const engine = this.autoCandidates[index];
                await engine.call('reset', { mode: 46 + index });
                for (const id of [1, 5])
                    if (this.faxOptions[id] !== undefined)
                        await engine.call('option', { id, value: this.faxOptions[id] });
                await engine.call('option', { id: 0, value: this.options[0] ?? 1 });
                await engine.call('option', { id: 7, value: 1 });
            }
            this.autoNeedsReset = false;
        }
        async processAuto(samples) {
            let result, finished;
            for (let pos = 0; pos < samples.length; pos += 4096) {
                const part = samples.subarray(pos, pos + 4096);
                // Workers transfer input buffers. Each decoder receives its own copy.
                const analog = await this.analog.call('process', { samples: part.slice() });
                if (analog.receiving || analog.finished) {
                    this.autoActive = this.autoDisplay = null;
                    this.autoNeedsReset = true;
                    result = analog;
                } else {
                    if (this.autoNeedsReset || !this.autoCandidates) await this.resetAutoCandidates();
                    const indices =
                        this.autoActive === null || this.autoActive === undefined ? [0, 1] : [this.autoActive];
                    const states = [];
                    for (const index of indices)
                        states[index] = await this.autoCandidates[index].call('process', { samples: part.slice() });
                    const detected = indices.find((index) => states[index].faxDetected === 2);
                    if (detected !== undefined) this.autoActive = this.autoDisplay = detected;
                    if (this.autoDisplay !== null && this.autoDisplay !== undefined) {
                        result =
                            states[this.autoDisplay] || (await this.autoCandidates[this.autoDisplay].call('snapshot'));
                        if (!result.faxDetected) this.autoActive = null;
                    } else result = analog;
                }
                if (result.finished) {
                    finished = result.finished;
                    ++this.completed;
                }
            }
            result ||= await this.analog.call('snapshot');
            if (finished) result.finished = finished;
            return this.adapt(result, false);
        }
        adapt(result, count = true) {
            if (result.serial === undefined) return result;
            const prefix = isFax(result.mode) ? 'wefax-' : 'sstv-';
            result.serial = prefix + result.serial;
            if (result.finished) {
                result.finished.serial = (isFax(result.finished.mode) ? 'wefax-' : 'sstv-') + result.finished.serial;
                if (count) ++this.completed;
            }
            result.completed = this.completed;
            return result;
        }
    }
    class SharedEncoder {
        static async create() {
            return new SharedEncoder();
        }
        async call(action, args = {}) {
            if (action === 'start') {
                this.active = isFax(args.mode)
                    ? (this.fax ||= await createFaxEngine(true))
                    : (this.analog ||= await MMSEncoderEngine.create());
            }
            return this.active ? this.active.call(action, args) : {};
        }
    }
    Object.assign(root, {
        WEFAXCore: FaxCore,
        WEFAXModes: modes,
        isWEFAXMode: isFax,
        MMSSharedDecoder: SharedDecoder,
        MMSSharedEncoder: SharedEncoder
    });
})(globalThis);
