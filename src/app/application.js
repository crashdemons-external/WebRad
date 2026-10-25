import { PictureTools } from './pictures.js';
import { icon } from './icons.js';
import { Bridge } from './bridge.js';
import { groupsFor, defaultsFor, validateSettings, restoreSettings, settingsVersion } from './settings.js';
import { formatGroups } from './catalog.js';
import { readAudio, selectChannel, makeWav, joinChunks, resample, timeLabel } from './audio.js';
import { readPicture, samplePicture, preparePicture, pictureBlob } from './pictures.js';
import { prepareTransmitText } from '../runtime/engines/multimode/transmit-audio.js';
import { parseRecovery } from './recovery.js';
import { $, esc } from './dom.js';
import { ApplicationState } from './application-state.js';
import { ApplicationView } from './application-view.js';
import { Spectrogram } from './spectrogram.js';
/** Owns workflow state, worker lifetimes, processing operations and user actions. */
export class WebRadApplication {
    /** Plain-language labels for supported content types. */
    contentNames;
    /** Initial URL query used for workflow and panel deep links. */
    q;
    /** Initialized worker bridges keyed by engine and operation role. */
    bridges;
    /** Timeout handle for the current notification. */
    toastTimer;
    /** Last receiver repaint time, used to limit rendering work. */
    lastPaint;
    /** Worker bridge currently holding receiver state. */
    decodeHost;
    /** Temporary Blob URLs awaiting release. */
    downloadUrls;
    /** Retained original HAMDRM payload for missing-segment repair. */
    lastTransfer;
    /** Parsed repair request and compatible transport controls. */
    recoveryRequest;
    /** Promise settled after the active operation completes or is canceled. */
    operationDone;
    /** Guard against concurrent Stop requests. */
    stopping;
    /** Pending recovered-picture preview conversions. */
    pictureTasks;
    /** Revision used to discard loopback reads superseded by navigation or input changes. */
    loopbackRevision;
    /** Mutable workflow state. */
    state;
    /** Workflow presentation and canvas rendering. */
    view;
    /** Initialize workflow state, view, and event handlers. */
    constructor() {
        this.contentNames = {
            text: 'Text',
            picture: 'Picture',
            file: 'File',
            voice: 'Speech',
            sensor: 'Sensors'
        };
        this.q = new URLSearchParams(location.search);
        this.state = new ApplicationState(this.q);
        this.state.storeSettings = this.storagePreference();
        this.bridges = new Map();
        this.toastTimer = undefined;
        this.lastPaint = 0;
        this.decodeHost = null;
        this.downloadUrls = new Set();
        this.lastTransfer = null;
        this.recoveryRequest = null;
        this.operationDone = Promise.resolve();
        this.stopping = false;
        this.pictureTasks = new Set();
        this.loopbackRevision = 0;
        this.view = new ApplicationView(this);
    }
    /**
     * Return the selected catalog entry without changing the selection.
     * @returns {Object|undefined} Selected catalog entry, if available.
     */
    current() {
        return this.state.formats.find((f) => f.id === this.state.formatId);
    }
    /**
     * Return the selected format's saved controls, creating its defaults on first access.
     * @returns {Object} Validated controls for the selected format.
     */
    settings() {
        return (
            this.state.settings[this.state.formatId] ||
            (this.state.settings[this.state.formatId] = defaultsFor(this.current()))
        );
    }
    /**
     * Filter signal families by the current workflow and content type.
     * @returns {Object[]} Compatible families in catalog order.
     */
    selectedGroups() {
        return formatGroups(this.state.formats, this.state.content, this.state.direction);
    }
    /**
     * Display a temporary status toast, replacing the previous timeout.
     * @param {string} message Plain-language notification text.
     */
    notify(message) {
        const toast = $('#toast');
        toast.textContent = message;
        toast.classList.add('show');
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => toast.classList.remove('show'), 4500);
    }
    /**
     * Save compatible format controls and the live-device choice to local storage.
     * @returns {boolean} Whether the preferences were saved.
     */
    persist() {
        if (!this.state.storeSettings || !this.storagePreference()) return false;
        try {
            localStorage.setItem(
                'webrad.settings.v1',
                JSON.stringify({
                    version: settingsVersion,
                    settings: this.state.settings,
                    liveDevice: this.state.liveDevice
                })
            );
            return true;
        } catch {
            return false;
        }
    }
    /** Read the storage choice, retaining the session choice if storage is unavailable.
     * @returns {boolean} Whether local storage is enabled.
     */
    storagePreference() {
        try {
            return localStorage.getItem('webrad.storage') !== 'off';
        } catch {
            return this.state.storeSettings;
        }
    }
    /**
     * Clear stale errors and discard generated output when encoder inputs change.
     * @param {boolean} preserveOutput Retain playback and downloads during navigation.
     */
    invalidate(preserveOutput = false) {
        this.loopbackRevision++;
        this.state.error = '';
        if (preserveOutput || this.state.direction === 'decode') return;
        this.revokeOutput();
        document.querySelector('.result-card')?.remove();
    }
    /**
     * Select a known format, validate its controls and persist the choice.
     * @param {string} id Stable catalog format identifier.
     * @param {boolean} preserveOutput Retain generated output during navigation.
     */
    chooseFormat(id, preserveOutput = false) {
        const f = this.state.formats.find((f) => f.id === id);
        if (!f) return;
        this.state.formatId = id;
        this.state.settings[id] = validateSettings(f, this.state.settings[id] || {});
        this.invalidate(preserveOutput);
        this.persist();
    }
    /**
     * Choose the usual compatible format when the current selection is unavailable.
     * @param {boolean} preserveOutput Retain generated output during navigation.
     */
    ensureFormat(preserveOutput = false) {
        const choices = this.selectedGroups().flatMap((g) => g.formats);
        if (!choices.some((f) => f.id === this.state.formatId)) {
            const preferred = this.preferredFormat();
            this.chooseFormat(
                (
                    choices.find((f) => f.id === preferred || f.name === preferred || f.nativeName === preferred) ||
                    choices[0]
                )?.id,
                preserveOutput
            );
        }
    }
    /** Select the usual compatible format for the current content and direction. */
    preferredFormat() {
        if (this.state.direction === 'decode' && this.state.content === 'picture') return 'pictures-auto';
        const defaults = {
            picture: 'Robot 36',
            text: 'CW',
            voice: 'FreeDV 700D',
            sensor: 'sensor-auto',
            file: 'HAMDRM'
        };
        return defaults[this.state.content] || 'HAMDRM';
    }
    /**
     * Acquire an initialized worker for an engine/role, evicting an unused worker if needed.
     * @param {string} engine Native engine capability identifier.
     * @param {string} role Encode/decode worker role used for cache separation.
     * @returns {Promise<Bridge>} Ready worker bridge for the requested engine and role.
     */
    async bridge(engine, role = 'decode') {
        const key = engine + ':' + role;
        let b = this.bridges.get(key);
        if (!b) {
            if (this.bridges.size >= 3) {
                const victim = [...this.bridges.keys()].find(
                    (k) => !k.startsWith('drm:') && k !== key && this.bridges.get(k) !== this.decodeHost
                );
                if (victim) {
                    this.bridges.get(victim).close();
                    this.bridges.delete(victim);
                }
            }
            b = new Bridge(engine);
            this.bridges.set(key, b);
        }
        try {
            await b.ready;
        } catch (error) {
            b.close();
            this.bridges.delete(key);
            throw error;
        }
        if (b.failure) {
            this.bridges.delete(key);
            throw b.failure;
        }
        return b;
    }
    /**
     * Update processing status and clamp displayed progress to zero through 100 percent.
     * @param {string} status Plain-language processing status.
     * @param {number} progress Completion percentage before clamping.
     */
    operationUpdate(status, progress) {
        if (status) this.state.status = status;
        if (Number.isFinite(progress)) this.state.progress = Math.max(0, Math.min(100, progress));
        if ($('#operation-status')) $('#operation-status').textContent = this.state.status;
        if ($('#operation-percent'))
            $('#operation-percent').textContent = this.state.busy ? `${Math.round(this.state.progress)}%` : '';
        for (const el of document.querySelectorAll('.operation .progress')) {
            el.setAttribute('aria-valuenow', this.state.progress);
            el.firstElementChild.style.width = this.state.progress + '%';
        }
    }
    /**
     * Merge one native receiver result into retained text, files, pictures and speech.
     * @param {Object} result One normalized native receiver result.
     */
    consume(result) {
        const r = this.state.received;
        this.consumeTextAndPictures(result, r);
        this.consumeRaster(result, r);
        this.consumeFilesAndAudio(result, r);
        this.consumeStatusAndDiagnostics(result, r);
        if (performance.now() - this.lastPaint > 120) {
            this.lastPaint = performance.now();
            this.view.paintReceived();
        }
    }
    /** Append decoded text and preserve current or completed picture state. */
    consumeTextAndPictures(result, received) {
        if (result.text) received.text = (received.text + result.text).slice(-2000000);
        if (result.width && result.height && result.pixels && result.line !== 0)
            received.current = {
                width: result.width,
                height: result.height,
                pixels: result.pixels,
                serial: result.imageSerial,
                complete:
                    result.imageSerial !== undefined && received.current?.serial === result.imageSerial && !!received.current.complete
            };
        if (result.finished) {
            received.current = result.finished;
            received.images.push(result.finished);
            if (received.images.length > 20) received.images.shift();
        }
    }
    /** Append bottom-up raster columns, retaining the most recent 8192 columns. */
    consumeRaster(result, received) {
        if (!result.raster?.length) return;
        const height = result.rasterHeight;
        if (!Number.isInteger(height) || height < 1) return;
        const incomingWidth = result.raster.length / height;
        if (!Number.isInteger(incomingWidth)) return;
        const old = received.current?.height === height ? received.current : null,
            oldWidth = old?.width || 0,
            width = Math.min(8192, oldWidth + incomingWidth),
            firstColumn = oldWidth + incomingWidth - width,
            pixels = new Uint8ClampedArray(width * height * 4);
        for (let y = 0; y < height; y++) {
            const retainedWidth = Math.max(0, oldWidth - firstColumn);
            if (retainedWidth) {
                const start = (y * oldWidth + firstColumn) * 4;
                pixels.set(old.pixels.subarray(start, start + retainedWidth * 4), y * width * 4);
            }
            for (let x = retainedWidth; x < width; x++) {
                const column = firstColumn + x - oldWidth,
                    value = result.raster[column * height + height - 1 - y],
                    at = (y * width + x) * 4;
                pixels[at] = pixels[at + 1] = pixels[at + 2] = value;
                pixels[at + 3] = 255;
            }
        }
        received.current = { width, height, pixels, complete: false };
    }
    /** Retain recovered files and speech blocks, enforcing the speech duration limit. */
    consumeFilesAndAudio(result, received) {
        if (result.file) this.receiveFile(result.file);
        if (result.files) result.files.forEach(this.receiveFile.bind(this));
        if (received.files.length > 50) received.files.shift();
        if (result.audio?.length) {
            received.audio.push(result.audio);
            received.rate = result.rate;
            if (received.audio.reduce((n, c) => n + c.length, 0) > received.rate * 1800)
                throw Error('Recovered speech exceeds 30 minutes. Stop and save this session.');
        }
    }
    /** Merge engine status, spectrum and diagnostics into the retained receiver state. */
    consumeStatusAndDiagnostics(result, received) {
        if (result.bsr !== undefined) received.bsr = result.bsr;
        if (result.status) {
            received.status = Array.isArray(result.status)
                ? `Time sync ${result.status[0] ? 'yes' : 'no'} · frame sync ${result.status[1] ? 'yes' : 'no'} · file segments ${result.status[11]} / ${result.status[12]} · signal/noise ${Number(result.snr).toFixed(1)} dB`
                : result.status;
        }
        if (result.syncedFrames !== undefined)
            received.status = `${result.syncedFrames} synchronized voice frames / ${result.totalFrames} processed`;
        if (result.detectedEngine)
            received.status = `Detected ${result.detectedEngine === 'fax' ? 'weather fax' : 'slow-scan picture'}`;
        if (result.spectrum?.length) {
            received.spectrum = result.spectrum;
            received.spectrumMax = result.spectrumMax || 4000;
        }
        if (result.sync) received.sync = result.sync;
        received.diagnostics ||= { mode: this.current().name };
        for (const [key, value] of Object.entries({
            frequency: result.frequency,
            signalStrength: result.metric,
            offset: result.offset,
            snr: result.snr,
            sender: result.sender || undefined,
            scope: result.scope
                ? { mode: result.scope.mode, quality: result.scope.quality, phase: result.scope.phase }
                : undefined,
            channels: result.channels?.filter((c) => c.text)
        }))
            if (value !== undefined) received.diagnostics[key] = value;
        if (result.secondary)
            received.diagnostics.secondaryText = ((received.diagnostics.secondaryText || '') + result.secondary).slice(-20000);
    }
    /**
     * Retain a recovered file and asynchronously preview recognized picture formats.
     * @param {File} file Recovered file to retain and preview.
     */
    receiveFile(file) {
        const received = this.state.received;
        received.files.push(file);
        // HAMDRM can shorten the JPEG extension to three characters in transit.
        if (this.state.content === 'picture' && /\.(png|jpe?g|jpe|bmp|gif|webp|jp2|j2k|jpc)$/i.test(file.name)) {
            const task = readPicture(new File([file.bytes], file.name), async (args) =>
                (await this.bridge('jp2')).call('imageCodec', args)
            )
                .then((p) => {
                    if (received !== this.state.received) return;
                    p.complete = true;
                    received.current = p;
                    received.images.push(p);
                    if (received.images.length > 20) received.images.shift();
                    this.view.paintReceived();
                })
                .catch(() => {})
                .finally(() => this.pictureTasks.delete(task));
            this.pictureTasks.add(task);
        }
    }
    /**
     * Open the format-specific Advanced drawer with all compatible controls.
     */
    openAdvanced() {
        const f = this.current(),
            dialog = $('#advanced-dialog');
        const modemPicture = f.engine === 'fldigi' && ['THOR', 'IFKP', 'FSQ'].includes(f.family);
        const slowScanPicture = ['sstv', 'pictures-auto'].includes(f.engine) && f.name !== 'FAX480';
        const canCorrectPicture = this.state.direction === 'decode' && (modemPicture || slowScanPicture);
        dialog.innerHTML = `<div class="drawer-head"><h2 id="advanced-title">Advanced ${this.state.direction === 'decode' ? 'decoding' : 'encoding'}</h2><button class="close" data-action="close" aria-label="Close advanced settings">${icon('close')}</button><p>${esc(f.name)} · changes apply to the next operation</p></div><div class="drawer-body">${groupsFor(
            f,
            this.state.direction
        )
            .map(
                (g, i) =>
                    `<details class="settings-group" ${i < 2 ? 'open' : ''}><summary>${esc(g.title)}</summary>${g.fields.map((field) => this.view.fieldHtml(field, this.settings(), 'advanced-setting-')).join('')}</details>`
            )
            .join(
                ''
            )}<div class="drawer-actions">${canCorrectPicture ? '<button class="button primary" data-action="redraw">Apply picture correction</button>' : ''}${f.engine === 'drm' ? '<button class="button" data-action="repair-open">Resend missing file segments…</button>' : ''}<button class="button" data-action="reset-settings">Reset this format</button></div><p class="session-note">${this.state.storeSettings ? 'Changed settings are saved on this device.' : 'Changed settings last only for this page.'} Reset returns this format to its usual defaults.</p></div>`;
        dialog.showModal();
    }
    /**
     * Open the format explorer with the current selection and content filter.
     */
    openFormats() {
        this.state.chooserContent = this.state.content;
        this.state.search = '';
        this.state.candidate = this.state.formatId;
        this.state.chooserAll = false;
        const dialog = $('#format-dialog');
        dialog.innerHTML = `<div class="modal-head"><h2 id="format-title">Explore signal formats</h2><p>Find a format that fits your content and receiver.</p><button class="close" data-action="close" aria-label="Close format chooser">${icon('close')}</button></div><div class="modal-content"><div class="search-wrap">${icon('search')}<input id="format-search" type="search" placeholder="Search names, acronyms, or descriptions…" aria-label="Search formats"></div><div class="filter-chips">${Object.entries(
            this.contentNames
        )
            .filter(([k]) => this.state.direction === 'decode' || k !== 'sensor')
            .map(
                ([type, label]) =>
                    `<button data-filter="${type}" class="${type === this.state.content ? 'active' : ''}">${label}</button>`
            )
            .join(
                ''
            )}<button data-action="all-formats">All formats</button></div><div class="format-columns"><div id="format-list" class="format-list"></div><section id="format-detail" class="format-detail"></section></div></div>`;
        this.view.paintFormats();
        dialog.showModal();
    }
    /**
     * Open a shared informational dialog using supplied heading and body markup.
     * @param {string} title Dialog heading.
     * @param {string} body Prepared dialog body markup.
     */
    utility(title, body) {
        const d = $('#utility-dialog');
        d.innerHTML = `<div class="modal-head"><h2 id="utility-title">${title}</h2><button class="close" data-action="close" aria-label="Close dialog">${icon('close')}</button></div><div class="modal-content">${body}</div>`;
        d.showModal();
    }
    /**
     * Ask whether to encode an oversized FreeDV file as multiple packets; Cancel and Escape decline.
     * @param {Object} format Catalog format, including native mode and preset controls.
     * @param {string} name File name shown in the confirmation dialog.
     * @param {Object} plan Measured FreeDV payload, packet count, duration and padding.
     * @returns {Promise<boolean>} True only when Split and encode is chosen.
     */
    confirmPacketSplit(format, name, plan) {
        const d = $('#packet-dialog');
        d.returnValue = '';
        d.innerHTML = `<form method="dialog"><div class="modal-head"><h2 id="packet-title">Split this file into FreeDV packets?</h2><button class="close" value="cancel" aria-label="Cancel packet encoding">${icon('close')}</button></div><div class="modal-content" id="packet-guidance"><p><strong>${esc(format.name)}</strong> carries up to <strong>${plan.payloadBytes.toLocaleString()} bytes of file data per packet</strong>. <strong class="packet-filename">${esc(name)}</strong> contains ${plan.size.toLocaleString()} bytes.</p><p>Continue to split your file into <strong>${plan.packetCount.toLocaleString()} packets</strong> in one WAV recording, about ${timeLabel(plan.seconds)} long.</p><p>FreeDV receives these as separate packets. It does not include the original filename or automatically rebuild the file. To rebuild it, join the recovered packets in transmission order${plan.paddingBytes ? ` and keep only the original ${plan.size.toLocaleString()} bytes; the last packet is filled with ${plan.paddingBytes.toLocaleString()} padding bytes` : ''}. Missing packets are not automatically recovered.</p><div class="modal-actions"><button class="button" value="cancel" autofocus>Cancel</button><button class="button primary" value="continue">Split and encode</button></div></div></form>`;
        return new Promise((resolve) => {
            d.addEventListener('close', () => resolve(d.returnValue === 'continue'), { once: true });
            d.showModal();
        });
    }
    /**
     * Release the generated playback URL and clear the retained output.
     */
    revokeOutput() {
        this.view.disposeAudioPlayers('output');
        if (this.state.output?.url) URL.revokeObjectURL(this.state.output.url);
        this.state.output = null;
    }
    /**
     * Release recovered speech playback and start a fresh result collection.
     */
    resetReceived() {
        if (this.state.received.voiceUrl) URL.revokeObjectURL(this.state.received.voiceUrl);
        this.state.received = {
            text: '',
            images: [],
            files: [],
            audio: [],
            rate: 8000,
            current: null,
            bsr: '',
            status: ''
        };
    }
    /**
     * Serialize an operation, expose its cancellation token and restore idle controls on completion.
     * @param {string} label Status message shown while the operation runs.
     * @param {Function} fn Asynchronous operation receiving the cancellation token.
     */
    async runOperation(label, fn) {
        if (this.state.busy) return;
        this.state.busy = true;
        this.state.job++;
        const job = this.state.job;
        let complete;
        this.operationDone = new Promise((resolve) => (complete = resolve));
        this.state.error = '';
        this.state.progress = 0;
        this.state.status = label;
        this.view.render();
        try {
            await fn(job);
        } catch (error) {
            if (job === this.state.job) {
                this.state.error = error.message;
                this.state.status = 'Processing could not finish.';
            }
        } finally {
            try {
                if (job === this.state.job) {
                    $('#input-player')?.pause();
                    await this.closeLive();
                    await Promise.allSettled([...this.pictureTasks]);
                    this.state.busy = false;
                    this.view.paintReceived();
                    this.view.render();
                }
            } finally {
                complete();
            }
        }
    }
    /**
     * Encode the selected content, obtaining FreeDV splitting consent before generating oversized data.
     * @param {Object|undefined} fix Optional retained payload, segments and transport controls for repair.
     */
    async generate(fix) {
        await this.runOperation('Loading the encoder…', async (job) => {
            const f = { ...this.current() },
                s = { ...this.settings() },
                b = await this.bridge(f.engine, 'encode');
            const args = this.createGenerationArguments(f, s, fix);
            if (this.state.content === 'text') this.prepareTextInput(args, f, s);
            if (this.state.content === 'picture') {
                const preparation = this.preparePictureInput(args, f, s);
                if (preparation) await preparation;
            }
            if (this.state.content === 'file') this.prepareFileInput(args);
            if (this.state.content === 'voice') this.prepareVoiceInput(args, s);
            if (fix?.payload) {
                args.bytes = fix.payload.bytes;
                args.name = fix.payload.name;
                Object.assign(s, fix.payload.settings || fix.settings || {});
            }
            if (f.engine === 'voice' && f.data && !(await this.preparePacketSplit(b, f, s, args, job))) return;
            if (job !== this.state.job) return;
            const initial = await b.call('encodeStart', args);
            if (job !== this.state.job) {
                await b.call('cancel');
                return;
            }
            if (f.engine === 'drm' && args.name !== 'bsr.bin' && !fix)
                this.lastTransfer = { bytes: args.bytes.slice(), name: args.name, settings: { ...s } };
            const encoded = await this.readEncoderOutput(b, f, initial, job);
            if (!encoded) return;
            if (job !== this.state.job) {
                await b.call('cancel');
                return;
            }
            this.storeEncoderOutput(encoded, f, s, args, fix, initial);
        });
    }
    /** Create common encoder request fields from a format snapshot and repair state.
     * @param {Object} format Snapshot of the selected catalog format.
     * @param {Object} settings Snapshot of its validated controls.
     * @param {Object|undefined} fix Optional retained repair payload and controls.
     * @returns {Object} Common arguments for the encoder start request.
     */
    createGenerationArguments(format, settings, fix) {
        return {
            format,
            settings,
            text: this.state.text,
            fix: fix?.segments,
            transport: fix?.transport
        };
    }
    /** Validate a text message and prepare the fldigi transmit form.
     * @param {Object} args Encoder request receiving the prepared text.
     * @param {Object} format Selected format metadata.
     * @param {Object} settings Selected format controls.
     */
    prepareTextInput(args, format, settings) {
        if (!this.state.text.trim()) throw Error('Write a message first.');
        if (new TextEncoder().encode(this.state.text).length > 100000)
            throw Error('Message exceeds 100,000 UTF-8 bytes.');
        if (format.engine === 'spectrum') args.image = PictureTools.textPicture(this.state.text, settings);
        if (format.engine === 'fldigi') args.text = prepareTransmitText(this.state.text, format, settings);
    }
    /** Convert a picture to encoder pixels or an attached DRM image file.
     * @param {Object} args Encoder request receiving picture data.
     * @param {Object} format Selected format metadata.
     * @param {Object} settings Selected format controls.
     * @returns {Promise<void>|undefined} Resolves after DRM encoding or returns for local pixels.
     */
    preparePictureInput(args, format, settings) {
        if (!this.state.picture) throw Error('Choose a picture first.');
        if (format.engine !== 'drm') {
            args.image = preparePicture(this.state.picture, format, settings, this.state.fit);
            return undefined;
        }
        return this.prepareDrmPictureInput(args, settings);
    }
    /** Encode a DRM picture attachment as JPEG 2000 or a browser image format.
     * @param {Object} args Encoder request receiving the picture bytes and name.
     * @param {Object} settings Selected DRM controls.
     * @returns {Promise<void>} Resolves after the selected picture encoding is complete.
     */
    async prepareDrmPictureInput(args, settings) {
        if (settings.imageEncoding === 'jp2') {
            const picture = preparePicture(this.state.picture, { engine: 'drm' }, settings, 'fit');
            const codec = await this.bridge('jp2');
            args.bytes = (
                await codec.call('imageCodec', {
                    action: 'encode',
                    pixels: picture.pixels,
                    width: picture.width,
                    height: picture.height,
                    ratio: settings.jp2Ratio
                })
            ).bytes;
            args.name = this.state.picture.name.replace(/\.[^.]*$/, '') + '.jp2';
            return;
        }
        const blob = await pictureBlob(this.state.picture, settings.imageEncoding, settings.jpegQuality);
        args.bytes = new Uint8Array(await blob.arrayBuffer());
        args.name = this.state.picture.name.replace(/\.[^.]*$/, '') + '.' + settings.imageEncoding;
    }
    /** Attach the selected file bytes and name to an encoder request.
     * @param {Object} args Encoder request receiving the file.
     */
    prepareFileInput(args) {
        if (!this.state.file) throw Error('Choose a file first.');
        args.bytes = this.state.file.bytes;
        args.name = this.state.file.name;
    }
    /** Select the configured speech channel and attach its sample rate.
     * @param {Object} args Encoder request receiving audio samples.
     * @param {Object} settings Selected format controls.
     */
    prepareVoiceInput(args, settings) {
        if (!this.state.audio || this.state.audio.codecBytes)
            throw Error('Choose an ordinary speech audio recording first.');
        args.audio = {
            samples: selectChannel(this.state.audio, settings.channel),
            rate: this.state.audio.rate
        };
    }
    /** Plan FreeDV output and request consent when the file needs multiple packets.
     * @param {Bridge} bridge Initialized encoder bridge.
     * @param {Object} format Selected format snapshot.
     * @param {Object} settings Selected format controls.
     * @param {Object} args Prepared encoder request.
     * @param {number} job Operation cancellation token.
     * @returns {Promise<boolean>} Whether encoding should continue.
     */
    async preparePacketSplit(bridge, format, settings, args, job) {
        if (format.engine !== 'voice' || !format.data) return true;
        if (job !== this.state.job) return false;
        const plan = await bridge.call('voiceDataPlan', {
            format,
            settings,
            size: args.bytes?.length
        });
        if (job !== this.state.job) return false;
        if (plan.packetCount <= 1) return true;
        this.operationUpdate('Waiting for your FreeDV packet choice…', 0);
        const confirmed = await this.confirmPacketSplit(format, args.name, plan);
        if (job !== this.state.job) return false;
        if (!confirmed) {
            this.state.status = 'Encoding canceled. Your file is still selected.';
            return false;
        }
        args.splitPackets = true;
        return true;
    }
    /** Read encoder chunks in order and cancel the worker when the job becomes stale.
     * @param {Bridge} bridge Initialized encoder bridge.
     * @param {Object} format Selected format snapshot.
     * @param {Object} initial Encoder start response.
     * @param {number} job Operation cancellation token.
     * @returns {Promise<Object|null>} Collected chunks and file, or null after cancellation.
     */
    async readEncoderOutput(bridge, format, initial, job) {
        const chunks = [];
        let outputFile, total = 0;
        while (job === this.state.job) {
            const result = await bridge.call('encodeRead');
            if (job !== this.state.job) break;
            if (result.samples?.length) {
                chunks.push(result.samples);
                total += result.samples.length;
            }
            if (result.file) outputFile = result.file;
            this.operationUpdate(
                `Creating ${format.codec ? 'speech file' : 'audio'}…${total ? ' ' + timeLabel(total / initial.rate) + ' generated' : ''}`,
                result.progress * 100
            );
            if (result.done) break;
        }
        if (job !== this.state.job) {
            await bridge.call('cancel');
            return null;
        }
        return { chunks, outputFile };
    }
    /** Join and store generated audio or binary output for preview and download.
     * @param {Object} encoded Collected PCM chunks and optional native file.
     * @param {Object} format Selected format snapshot.
     * @param {Object} settings Selected format controls.
     * @param {Object} args Prepared encoder request.
     * @param {Object|undefined} fix Optional repair request.
     * @param {Object} initial Encoder start response.
     */
    storeEncoderOutput(encoded, format, settings, args, fix, initial) {
        this.revokeOutput();
        const joined = joinChunks(encoded.chunks),
            samples =
                format.engine === 'fldigi' && settings.txPpm
                    ? resample(joined, initial.rate * (1 + settings.txPpm / 1e6), initial.rate)
                    : joined,
            baseName = this.state.content === 'picture' ? this.state.picture.name : args.name || 'webrad-message',
            name = this.generatedOutputName(baseName, format, fix),
            outputFile = encoded.outputFile;
        const blob = outputFile
            ? new Blob([outputFile.bytes], { type: 'application/octet-stream' })
            : new Blob([makeWav(samples, initial.rate)], { type: 'audio/wav' });
        this.state.output = {
            samples,
            rate: initial.rate,
            file: outputFile,
            name,
            blob,
            url: outputFile ? null : URL.createObjectURL(blob),
            format,
            settings,
            content: this.state.content,
            packetPlan: initial.packetPlan
        };
        this.state.status = 'Ready to preview and download.';
        this.state.progress = 100;
    }
    /** Build a filename from its content name, repair state and selected format.
     * @param {string} baseName Original content name.
     * @param {Object} format Selected format snapshot.
     * @param {Object|undefined} fix Optional repair request.
     * @returns {string} Output filename including its extension.
     */
    generatedOutputName(baseName, format, fix) {
        const contentName = baseName.replace(/\.[^.]*$/, '').trim();
        const formatName = format.name.toLowerCase()
            .replace(/\(\s*(?:usual|default|standard|recommended|slower|long tones)\s*\)/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/\bwords-(?:per-)?minute\b/g, 'wpm')
            .replace(/\bbeats-(?:per-)?minute\b/g, 'bpm');
        const stem = [contentName, fix ? 'repair' : '', formatName].filter(Boolean).join('-')
            .replace(/-+/g, '-').replace(/^-+|-+$/g, '') || 'webrad-audio';
        return stem + (format.codec ? '.c2' : '.wav');
    }
    /**
     * Recover content from a recording, binary speech file or live input using the selected controls.
     */
    async decode() {
        await this.runOperation('Loading the decoder…', async (job) => {
            const context = await this.prepareDecoder(job);
            if (!context || job !== this.state.job) return;
            const { format, settings, bridge } = context;
            if (this.state.content === 'sensor') {
                await this.decodeSensor(bridge, format, settings, job);
                return;
            }
            if (format.codec) {
                await this.decodeCodecFile(bridge, format, settings, job);
                return;
            }
            if (this.state.source === 'live') {
                await this.decodeLive(bridge, format, settings, job);
                return;
            }
            await this.decodeRecording(bridge, format, settings, job);
        });
    }
    /** Reset result state, snapshot the selected controls and initialize the decoder.
     * @param {number} job Operation cancellation token.
     * @returns {Promise<Object|null>} Decoder context or null if the job was canceled.
     */
    async prepareDecoder(job) {
        this.resetReceived();
        const format = { ...this.current() },
            settings = { ...this.settings() },
            bridge = await this.bridge(format.engine);
        if (job !== this.state.job) return null;
        this.decodeHost = bridge;
        return { format, settings, bridge };
    }
    /** Decode a binary Codec2 file and prepare its recovered speech preview.
     * @param {Bridge} bridge Initialized decoder bridge.
     * @param {Object} format Selected codec format.
     * @param {Object} settings Selected format controls.
     * @param {number} job Operation cancellation token.
     */
    async decodeCodecFile(bridge, format, settings, job) {
        if (!this.state.audio?.codecBytes)
            throw Error('Choose a .c2 speech file. Codec2 receives binary speech data, rather than modem audio.');
        const result = await bridge.call('decodeCodec', {
            bytes: this.state.audio.codecBytes,
            format,
            settings
        });
        if (job !== this.state.job) return;
        this.consume(result);
        await this.finishVoice();
        this.state.progress = 100;
        this.state.status = 'Speech file decoded.';
    }
    /** Decode the selected recording and update its final result status.
     * @param {Bridge} bridge Initialized decoder bridge.
     * @param {Object} format Selected format snapshot.
     * @param {Object} settings Selected format controls.
     * @param {number} job Operation cancellation token.
     */
    async decodeRecording(bridge, format, settings, job) {
        if (!this.state.audio || this.state.audio.codecBytes) throw Error('Choose an audio recording first.');
        const audio = this.state.audio,
            samples = selectChannel(audio, settings.channel),
            start = Math.round(settings.startSeconds * audio.rate),
            end = settings.endSeconds ? Math.min(samples.length, Math.round(settings.endSeconds * audio.rate)) : samples.length;
        if (start >= end) throw Error('The selected recording range is empty.');
        const setup = await bridge.call('setup', {
            format,
            settings,
            rate: audio.rate,
            preserve: true
        });
        const chunk = Math.max(256, Math.min(8192, Math.floor((32768 * audio.rate) / (setup.rate || 48000))));
        const player = await this.startRecordingPlayback(settings, audio, start, job);
        if (job !== this.state.job) {
            player?.pause();
            return;
        }
        this.state.received.spectrogram = new Spectrogram(audio.rate, (end - start) / audio.rate, start / audio.rate);
        await this.decodeRecordingChunks(bridge, samples, start, end, chunk, audio.rate, player, job);
        player?.pause();
        if (job !== this.state.job) return;
        await this.finishRecordingDecode(bridge, job);
    }
    /** Start optional paced playback from the selected recording offset.
     * @param {Object} settings Selected format controls.
     * @param {Object} audio Selected recording metadata.
     * @param {number} start First sample offset.
     * @param {number} job Operation cancellation token.
     * @returns {Promise<HTMLAudioElement|undefined>} Active player when pacing is enabled.
     */
    async startRecordingPlayback(settings, audio, start, job) {
        if (job !== this.state.job || !settings.paced) return undefined;
        const player = $('#input-player');
        if (!player) throw Error('Recording playback is unavailable. Disable playback pacing in Advanced.');
        player.currentTime = start / audio.rate;
        await player.play();
        return player;
    }
    /** Send bounded recording blocks to the decoder, waiting for paced playback when requested.
     * @param {Bridge} bridge Initialized decoder bridge.
     * @param {Float32Array} samples Selected channel samples.
     * @param {number} start First sample offset.
     * @param {number} end Exclusive sample limit.
     * @param {number} chunk Samples per processing request.
     * @param {number} rate Recording sample rate.
     * @param {HTMLAudioElement|undefined} player Optional paced playback player.
     * @param {number} job Operation cancellation token.
     */
    async decodeRecordingChunks(bridge, samples, start, end, chunk, rate, player, job) {
        for (let pos = start; pos < end && job === this.state.job; pos += chunk) {
            if (player) {
                const target = Math.min(pos + chunk, end) / rate;
                while (job === this.state.job && player.currentTime < target && !player.ended) {
                    if (player.currentTime < pos / rate - 0.25)
                        throw Error('Playback moved backwards. Stop and start decoding again at the desired time.');
                    await new Promise((resolve) => setTimeout(resolve, 40));
                }
            }
            if (job !== this.state.job) break;
            const block = samples.slice(pos, Math.min(pos + chunk, end));
            this.state.received.spectrogram?.append(block);
            const result = await bridge.call('process', { samples: block }, [block.buffer]);
            if (job !== this.state.job) break;
            this.consume(result);
            this.operationUpdate('Decoding recording…', ((Math.min(pos + chunk, end) - start) / (end - start)) * 100);
        }
    }
    /** Flush the decoder and set a final status for the recorded input.
     * @param {Bridge} bridge Initialized decoder bridge.
     * @param {number} job Operation cancellation token.
     */
    async finishRecordingDecode(bridge, job) {
        if (job !== this.state.job) return;
        this.state.received.spectrogram?.finish();
        const finished = await bridge.call('finish');
        if (job !== this.state.job) return;
        this.consume(finished);
        await this.finishVoice();
        this.view.paintReceived();
        const received = this.state.received,
            found = !!(received.text || received.current || received.files.length || received.audio.length);
        this.state.status = found
            ? 'Recording processed. Results are ready to save.'
            : 'Recording processed. No content recovered. Check the format and Advanced settings.';
        this.state.progress = 100;
    }
    /**
     * Join recovered speech blocks and create a downloadable PCM WAV preview.
     */
    async finishVoice() {
        const r = this.state.received;
        if (!r.audio.length) return;
        if (r.voiceUrl) URL.revokeObjectURL(r.voiceUrl);
        r.voiceBlob = new Blob([makeWav(joinChunks(r.audio), r.rate)], { type: 'audio/wav' });
        r.voiceUrl = URL.createObjectURL(r.voiceBlob);
    }
    /**
     * Capture microphone PCM, queue bounded worker requests and retain decoded results until stopped.
     * @param {Bridge} b Initialized worker RPC bridge.
     * @param {Object} f Selected catalog format and native mode.
     * @param {Object} s Validated format compatibility settings.
     * @param {number} job Operation cancellation token captured at startup.
     */
    async decodeLive(b, f, s, job) {
        if (!navigator.mediaDevices?.getUserMedia)
            throw Error('Live input requires HTTPS or localhost and browser microphone support.');
        const stream = await this.requestLiveStream(job);
        if (!stream) return;
        const { ctx, node } = await this.startLiveAudio(stream, s);
        await b.call('setup', { format: f, settings: s, rate: ctx.sampleRate, preserve: true });
        if (this.state.live?.ctx !== ctx) return;
        this.state.received.spectrogram = new Spectrogram(ctx.sampleRate);
        const queue = this.queueLiveSamples(node, b, job);
        this.state.live.node = node;
        this.state.live.queue = queue;
        this.operationUpdate('Listening to live input…', 0);
        await this.waitForLiveInput(stream, queue, job);
        await this.finishLiveInput(node, b, queue, job);
    }
    /** Request microphone access while tracking the operation that opened the prompt.
     * @param {number} job Operation cancellation token.
     * @returns {Promise<MediaStream|null>} Live stream or null when canceled during permission.
     */
    async requestLiveStream(job) {
        this.state.permissionJob = job;
        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    deviceId: this.state.liveDevice !== 'default' ? { exact: this.state.liveDevice } : undefined,
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                    channelCount: 2
                }
            });
        } finally {
            if (this.state.permissionJob === job) this.state.permissionJob = null;
        }
        if (job !== this.state.job) {
            stream.getTracks().forEach((t) => t.stop());
            return null;
        }
        return stream;
    }
    /** Resume microphone capture and route worklet output to a silent sink.
     * @param {MediaStream} stream Authorized microphone stream.
     * @param {Object} settings Selected receiver controls.
     * @returns {Promise<Object>} Audio context and worklet node.
     */
    async startLiveAudio(stream, settings) {
        const Ctx = window.AudioContext || window.webkitAudioContext,
            ctx = new Ctx();
        this.state.live = { stream, ctx };
        await ctx.resume();
        // Refresh processors cached before the partial-batch flush protocol.
        await ctx.audioWorklet.addModule(new URL('./mic-worklet.js', import.meta.url));
        const source = ctx.createMediaStreamSource(stream),
            node = new AudioWorkletNode(ctx, 'webrad-input'),
            silence = ctx.createGain();
        silence.gain.value = 0;
        source.connect(node);
        node.connect(silence);
        silence.connect(ctx.destination);
        node.port.postMessage({ channel: settings.channel });
        return { ctx, node };
    }
    /** Queue worklet blocks in order and cap outstanding receiver requests.
     * @param {AudioWorkletNode} node Active microphone worklet.
     * @param {Bridge} bridge Initialized decoder bridge.
     * @param {number} job Operation cancellation token.
     * @returns {Object} Mutable processing queue state.
     */
    queueLiveSamples(node, bridge, job) {
        const queue = { chain: Promise.resolve(), pending: 0, error: null, spectrogram: this.state.received.spectrogram };
        node.port.onmessage = ({ data }) => {
            if (data.type === 'flushed') {
                queue.resolveFlush?.();
                return;
            }
            if (job !== this.state.job || queue.error) return;
            if (queue.pending >= 12) {
                queue.error = Error(
                    'This device cannot decode live input at the incoming rate. Record audio and use fast file decoding.'
                );
                return;
            }
            queue.pending++;
            queue.chain = queue.chain
                .then(async () => {
                    if (job !== this.state.job) return;
                    let max = 0;
                    for (const x of data.samples) max = Math.max(max, Math.abs(x));
                    const bar = $('#input-level-bar');
                    if (bar) bar.style.width = Math.min(100, max * 100) + '%';
                    queue.spectrogram?.append(data.samples);
                    const result = await bridge.call('process', { samples: data.samples }, [data.samples.buffer]);
                    if (job === this.state.job) this.consume(result);
                })
                .catch((error) => {
                    queue.error = error;
                })
                .finally(() => queue.pending--);
        };
        return queue;
    }
    /** Stop capture and wait until the worklet has delivered its partial final batch.
     * @param {AudioWorkletNode} node Active microphone worklet.
     * @param {Object} queue Live processing queue state.
     * @returns {Promise<void>} Resolves after the ordered flush acknowledgement.
     */
    flushLiveSamples(node, queue) {
        if (queue.flush) return queue.flush;
        queue.flush = new Promise((resolve) => {
            const timer = setTimeout(() => {
                queue.error ||= Error('Microphone capture did not finish before the audio context stopped.');
                resolve();
            }, 1000);
            queue.resolveFlush = () => {
                clearTimeout(timer);
                resolve();
            };
            node.port.postMessage({ type: 'flush' });
        });
        return queue.flush;
    }
    /** Wait for capture to stop or for the ordered receiver queue to fail.
     * @param {MediaStream} stream Active microphone stream.
     * @param {Object} queue Live processing queue state.
     * @param {number} job Operation cancellation token.
     * @returns {Promise<void>} Resolves after cancellation or microphone track end.
     */
    async waitForLiveInput(stream, queue, job) {
        await new Promise((resolve, reject) => {
            const timer = setInterval(() => {
                if (queue.error) {
                    clearInterval(timer);
                    reject(queue.error);
                } else if (job !== this.state.job || !stream.getAudioTracks().some((t) => t.readyState === 'live')) {
                    clearInterval(timer);
                    resolve();
                }
            }, 100);
        });
    }
    /** Drain queued microphone blocks and flush any final speech result.
     * @param {AudioWorkletNode} node Active microphone worklet.
     * @param {Bridge} bridge Initialized decoder bridge.
     * @param {Object} queue Live processing queue state.
     * @param {number} job Operation cancellation token.
     */
    async finishLiveInput(node, bridge, queue, job) {
        await this.flushLiveSamples(node, queue);
        node.port.onmessage = null;
        await queue.chain;
        queue.spectrogram?.finish();
        if (!queue.error && job === this.state.job) {
            const result = await bridge.call('finish');
            if (job === this.state.job) {
                this.consume(result);
                await this.finishVoice();
            }
        }
        if (queue.error) throw queue.error;
    }
    /**
     * Stop microphone tracks and close the live AudioContext.
     */
    async closeLive() {
        const live = this.state.live;
        if (!live) return;
        this.state.live = null;
        try {
            if (live.node && live.queue) await this.flushLiveSamples(live.node, live.queue);
        } finally {
            live.stream.getTracks().forEach((t) => t.stop());
            await live.ctx.close();
        }
    }
    /**
     * Drain live reception or cancel other active work, then retain completed results.
     */
    async stop() {
        if (this.stopping || !this.state.busy) return;
        this.stopping = true;
        const done = this.operationDone,
            permissionPending = this.state.permissionJob === this.state.job,
            drainLiveInput = !!this.state.live && !permissionPending;
        if (!drainLiveInput) this.state.job++;
        if ($('#packet-dialog').open) $('#packet-dialog').close('cancel');
        $('#input-player')?.pause();
        this.operationUpdate('Stopping processing…', this.state.progress);
        try {
            await this.closeLive();
            if (!permissionPending) await done;
            this.state.busy = false;
            this.state.status = 'Stopped. Recovered results are retained.';
            this.state.error = '';
            await this.finishVoice();
            this.view.render();
        } finally {
            this.stopping = false;
        }
    }
    /**
     * Validate and decode pulse packages or raw I/Q/baseband samples in bounded blocks.
     * @param {Bridge} b Initialized worker RPC bridge.
     * @param {Object} f Selected catalog format and native mode.
     * @param {Object} s Validated format compatibility settings.
     * @param {number} job Operation cancellation token captured at startup.
     */
    async decodeSensor(b, f, s, job) {
        if (!this.state.sensor) throw Error('Choose raw radio samples or pulse data first.');
        const file = this.state.sensor;
        await b.call('setup', { format: f, settings: s, rate: s.sensorRate });
        if (s.sensorInput === 'pulses') await this.decodePulsePackages(b, f, s, file, job);
        else await this.decodeRawSensorSamples(b, s, file, job);
        await this.finishSensorDecode(b, s, job);
    }
    /** Parse pulse text or JSON into pulse/gap packages and their receiver settings.
     * @param {File} file Sensor pulse input file.
     * @param {Object} settings Selected sensor controls.
     * @returns {Object} Pulse packages, sample rate and modulation.
     */
    parsePulsePackages(file, settings) {
        const text = new TextDecoder().decode(file.bytes);
        let packages = [],
            rate = settings.sensorRate,
            modulation = settings.sensorModulation;
        if (text.trimStart().startsWith('{') || text.trimStart().startsWith('[')) {
            let data = JSON.parse(text);
            if (Array.isArray(data)) data = { pulses: data };
            rate = Number(data.sampleRate || 1000000);
            if (data.modulation === 'FSK') modulation = 1;
            else if (data.modulation === 'OOK') modulation = 0;
            packages = data.packages || [data.pulses];
            if (!packages.every(Array.isArray))
                throw Error('Pulse JSON needs pulses: [[pulse,gap],…] or packages with that structure.');
        } else {
            const pairs = [];
            for (const line of text.split(/\r?\n/)) {
                if (line.trim().startsWith(';') || line.trim().startsWith('#')) {
                    if (/fsk/i.test(line)) modulation = 1;
                    continue;
                }
                const match = line.trim().match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)/);
                if (match) pairs.push([Number(match[1]), Number(match[2])]);
            }
            packages = [pairs];
            rate = 1000000;
        }
        if (rate < 8000 || rate > 4000000) throw Error('Pulse sampleRate must be between 8,000 and 4,000,000.');
        return { packages, rate, modulation };
    }
    /** Configure the pulse receiver and process each validated package in order.
     * @param {Bridge} bridge Initialized sensor bridge.
     * @param {Object} format Selected sensor format.
     * @param {Object} settings Selected sensor controls.
     * @param {File} file Pulse input file.
     * @param {number} job Operation cancellation token.
     */
    async decodePulsePackages(bridge, format, settings, file, job) {
        const { packages, rate, modulation } = this.parsePulsePackages(file, settings);
        await bridge.call('setup', {
            format,
            settings: { ...settings, sensorRate: rate, sensorModulation: modulation },
            rate
        });
        for (let i = 0; i < packages.length && job === this.state.job; i++) {
            const pairs = packages[i];
            if (
                !pairs.length ||
                pairs.length > 1200 ||
                pairs.some(
                    (pair) =>
                        !Array.isArray(pair) ||
                        pair.length !== 2 ||
                        pair.some((value) => !Number.isFinite(value) || value < 0 || value > 2000000000)
                )
            )
                throw Error('Each pulse package needs 1–1,200 nonnegative pulse/gap pairs.');
            const result = await bridge.call('sensorPulses', {
                pairs: pairs.flat().map(Math.round),
                settings: { ...settings, sensorModulation: modulation }
            });
            if (job !== this.state.job) break;
            this.consume(result);
            this.operationUpdate('Decoding pulse packages…', ((i + 1) / packages.length) * 100);
        }
    }
    /** Read bounded raw I/Q or baseband sample blocks and send them to the sensor worker.
     * @param {Bridge} bridge Initialized sensor bridge.
     * @param {Object} settings Selected sensor controls.
     * @param {File} file Raw sensor input file.
     * @param {number} job Operation cancellation token.
     */
    async decodeRawSensorSamples(bridge, settings, file, job) {
        const bytes = file.bytes,
            type = settings.sensorInput,
            bytesPerSample = this.sensorBytesPerSample(type);
        if (bytes.length % bytesPerSample) throw Error('Raw recording ends inside a sample. Check its representation.');
        const count = bytes.length / bytesPerSample;
        if (count / settings.sensorRate > 1800) throw Error('Raw recording exceeds 30 minutes.');
        for (let pos = 0; pos < count && job === this.state.job; pos += 32768) {
            const countInBlock = Math.min(32768, count - pos),
                block = bytes.slice(pos * bytesPerSample, (pos + countInBlock) * bytesPerSample),
                converted = this.convertSensorBlock(block, countInBlock, type);
            const result = await bridge.call(
                'sensorSamples',
                { bytes: converted.bytes, count: countInBlock, type: converted.nativeType, settings },
                [converted.bytes.buffer]
            );
            if (job !== this.state.job) break;
            this.consume(result);
            this.operationUpdate('Reading radio samples…', ((pos + countInBlock) / count) * 100);
        }
    }
    /** Return the encoded bytes occupied by one input sample.
     * @param {string} type Selected sensor input representation.
     * @returns {number} Bytes per input sample.
     */
    sensorBytesPerSample(type) {
        switch (type) {
            case 'cu8':
            case 'am':
            case 'fm': return 2;
            case 'cf32': return 8;
            default: return 4;
        }
    }
    /** Convert one raw sensor block to the native worker's interleaved sample layout.
     * @param {Uint8Array} bytes Raw bytes for the block.
     * @param {number} count Number of input samples.
     * @param {string} type Selected sensor input representation.
     * @returns {{bytes: Uint8Array, nativeType: number}} Worker data and representation code.
     */
    convertSensorBlock(bytes, count, type) {
        let nativeType = type === 'cu8' ? 0 : 1;
        if (type === 'cf32') {
            const input = new DataView(bytes.buffer),
                converted = new Int16Array(count * 2);
            for (let i = 0; i < converted.length; i++)
                converted[i] = Math.round(Math.max(-1, Math.min(1, input.getFloat32(i * 4, true))) * 32767);
            bytes = new Uint8Array(converted.buffer);
        }
        if (type === 'am' || type === 'fm') {
            const input = new DataView(bytes.buffer),
                converted = new Int16Array(count * 2);
            for (let i = 0; i < count; i++) {
                const sample = input.getInt16(i * 2, true);
                converted[i * 2] = type === 'am' ? Math.max(0, sample) : 16384;
                converted[i * 2 + 1] = type === 'fm' ? sample : 0;
            }
            bytes = new Uint8Array(converted.buffer);
            nativeType = 2;
        }
        return { bytes, nativeType };
    }
    /** Flush non-pulse sensor decoding and set the final result status.
     * @param {Bridge} bridge Initialized sensor bridge.
     * @param {Object} settings Selected sensor controls.
     * @param {number} job Operation cancellation token.
     */
    async finishSensorDecode(bridge, settings, job) {
        if (job !== this.state.job) return;
        if (settings.sensorInput !== 'pulses') {
            const result = await bridge.call('finish');
            if (job !== this.state.job) return;
            this.consume(result);
        }
        this.view.paintReceived();
        this.state.status = this.state.received.text
            ? 'Radio data processed. Sensor events are ready to save.'
            : 'Radio data processed. No packets recovered. Check sample rate, representation and sensor protocol.';
        this.state.progress = 100;
    }
    /**
     * Download a Blob with a sanitized filename and release its temporary URL afterward.
     * @param {Blob} blob File contents offered for download.
     * @param {string} name Download filename.
     */
    download(blob, name) {
        const url = URL.createObjectURL(blob),
            a = document.createElement('a');
        a.href = url;
        a.download = name.replace(/[\/\\\x00-\x1f]/g, '_');
        document.body.append(a);
        a.click();
        a.remove();
        this.downloadUrls.add(url);
        setTimeout(() => {
            URL.revokeObjectURL(url);
            this.downloadUrls.delete(url);
        }, 30000);
    }
    /**
     * Read a recording or Codec2 file, retain its metadata and refresh the workflow.
     * @param {File} file Browser file selected by the user.
     */
    async loadAudio(file) {
        if (this.state.audio?.url) URL.revokeObjectURL(this.state.audio.url);
        if (/\.c2$/i.test(file.name)) {
            const bytes = new Uint8Array(await file.arrayBuffer());
            if (bytes.length > 16 * 1024 * 1024) throw Error('Speech file exceeds 16 MB.');
            this.state.audio = { name: file.name, codecBytes: bytes };
            if (bytes[0] === 0xc0 && bytes[1] === 0xde && bytes[2] === 0xc2) {
                this.state.content = 'voice';
                this.chooseFormat('codec2-' + bytes[5]);
                this.settings().codecGray = !(bytes[6] & 1);
            }
        } else {
            this.state.audio = await readAudio(file);
            this.state.audio.url = URL.createObjectURL(file);
        }
        this.invalidate();
        this.state.status = 'Recording loaded. Choose a format, then start decoding.';
        this.view.render();
    }
    /** Stop playback and release the imported recording before showing the file picker prompt. */
    clearAudio() {
        if (this.state.busy || !this.state.audio) return;
        this.view.disposeAudioPlayers('input');
        if (this.state.audio.url) URL.revokeObjectURL(this.state.audio.url);
        this.state.audio = null;
        this.invalidate();
        this.state.status = 'Choose an audio recording.';
        this.view.render();
    }
    /**
     * Feed generated content back into a compatible receiver with unpaced default input processing.
     */
    async testOutput() {
        const o = this.state.output;
        if (!o || this.state.busy) return;
        const revision = ++this.loopbackRevision,
            job = this.state.job;
        // Test the same PCM bytes that playback and Download use, including WAV quantization.
        const audio = o.file
            ? { name: o.name, codecBytes: o.file.bytes }
            : await readAudio(new File([o.blob], o.name, { type: o.blob.type }));
        if (this.state.output !== o || this.state.busy || this.state.job !== job || this.loopbackRevision !== revision) return;
        this.state.direction = 'decode';
        this.state.content = this.testOutputContent(o.format);
        this.chooseFormat(o.format.id);
        this.state.settings[o.format.id] = {
            ...o.settings,
            paced: false,
            startSeconds: 0,
            endSeconds: 0,
            frequencyShift: 0,
            inputGain: 0,
            rxPpm: 0
        };
        if (this.state.audio?.url) URL.revokeObjectURL(this.state.audio.url);
        this.state.audio = o.file
            ? audio
            : { ...audio, url: URL.createObjectURL(o.blob) };
        this.state.source = 'recording';
        this.view.render();
        await this.decode();
    }
    /** Choose the receiver content that matches the generated output when possible.
     * @param {Object} format Generated format entry.
     * @returns {string} Content type for the receiver.
     */
    testOutputContent(format) {
        if (format.codec) return 'voice';
        if (format.outputs.includes('picture') && this.state.content === 'picture') return 'picture';
        if (format.outputs.includes('file') && this.state.content === 'file') return 'file';
        return format.outputs[0];
    }
    /**
     * Open missing-segment repair controls using a retained transfer or parsed recovery request.
     * @param {string} text Imported QSSTV recovery request, when provided.
     */
    repairDialog(text) {
        this.recoveryRequest = text ? parseRecovery(text) : null;
        this.utility(
            'Resend missing file segments',
            `<p>Use the exact original file and the same transfer settings. The last generated transfer is retained for this session.</p><p class="hint">Retained file: ${esc(this.lastTransfer?.name || 'none')}. Loaded file: ${esc(this.state.file?.name || 'none')}.</p><label class="text-label" for="repair-segments">Missing segment numbers</label><textarea id="repair-segments" placeholder="0, 3, 4, 5">${this.recoveryRequest?.segments.join(', ') || ''}</textarea><label class="field-label" for="repair-transport">Transfer ID (0 = legacy filename ID)</label><input id="repair-transport" type="number" min="0" max="65535" value="${this.recoveryRequest?.transport || 0}"><p id="repair-request-name" class="hint">${esc(this.recoveryRequest?.name || 'Import a recovery request to read the segment list and transfer ID.')}</p>${this.lastTransfer && this.state.file ? '<label class="switch-row"><input id="repair-loaded" type="checkbox">Use the loaded file instead of the retained transfer</label>' : ''}<div class="modal-actions"><button class="button" data-action="upload-repair">Open recovery request</button><button class="button primary" data-action="repair-generate">Create repair audio</button></div>`
        );
    }
    /**
     * Dispatch a user action to workflow, encoding, decoding, download or dialog operations.
     * @param {string} action UI action identifier.
     * @param {Element} el DOM control that triggered the action.
     */
    async perform(action, el) {
        switch (action) {
            case 'encode':
            case 'decode':
                return this.changeDirection(action);
            case 'advanced': return this.openAdvanced();
            case 'formats': return this.openFormats();
            case 'close': return el.closest('dialog')?.close();
            case 'all-formats':
                this.state.chooserAll = !this.state.chooserAll;
                this.view.paintFormats();
                return;
            case 'use-format': return this.useCandidateFormat();
            case 'fit':
            case 'crop': return this.choosePictureFit(action);
            case 'sample': return this.chooseSamplePicture();
            case 'upload-picture':
            case 'upload-audio':
            case 'upload-file':
            case 'upload-sensor': return this.openUpload(action);
            case 'clear-audio': return this.clearAudio();
            case 'generate': return this.generate();
            case 'decode-start': return this.decode();
            case 'stop': return this.stop();
            case 'download': return this.downloadOutput();
            case 'test': return this.testOutput();
            case 'repair-open': return this.openRepair(el);
            case 'repair-generate': return this.generateRepair();
            case 'bsr-audio': return this.generateBsrAudio();
            case 'save-text':
            case 'copy-text':
            case 'save-picture':
            case 'save-voice':
            case 'save-bsr':
            case 'redraw': return this.performResultAction(action);
            case 'reset-settings': return this.resetCurrentSettings();
            case 'devices': return this.refreshDevices();
            case 'settings': return this.openSettings();
            case 'settings-advanced':
                $('#utility-dialog').close();
                return this.openAdvanced();
            case 'export-settings': return this.exportSettings();
            case 'import-settings': return this.importSettings();
            case 'help': return this.openHelp();
        }
    }
    /** Change workflow direction and restore a compatible format selection.
     * @param {string} direction The selected encode or decode direction.
     */
    changeDirection(direction) {
        this.state.direction = direction;
        if (direction === 'encode' && this.state.output?.format) {
            this.state.content = this.state.output.content || this.state.output.format.inputs?.[0] || this.state.content;
            this.chooseFormat(this.state.output.format.id, true);
        }
        if (this.state.content === 'sensor' && direction === 'encode') this.state.content = 'picture';
        this.invalidate(true);
        this.ensureFormat(true);
        this.state.status = 'Choose your content and signal format.';
        this.view.render();
    }
    /** Apply the format candidate selected in the explorer. */
    useCandidateFormat() {
        this.state.content = this.state.chooserContent;
        this.chooseFormat(this.state.candidate);
        $('#format-dialog').close();
        this.view.render();
    }
    /** Select fit or crop for the current picture and refresh its preview.
     * @param {string} fit Picture fitting mode.
     */
    choosePictureFit(fit) {
        this.state.fit = fit;
        this.invalidate();
        this.view.render();
    }
    /** Load the bundled sample picture into the current workflow. */
    chooseSamplePicture() {
        this.state.picture = samplePicture();
        this.invalidate();
        this.view.render();
    }
    /** Open the upload picker associated with an upload action.
     * @param {string} action Upload action identifier.
     */
    openUpload(action) {
        $('#' + action.replace('upload-', '') + '-upload')?.click();
    }
    /** Download the generated output when one is available. */
    downloadOutput() {
        if (this.state.output) this.download(this.state.output.blob, this.state.output.name);
    }
    /** Close the current dialog and open the recovery request editor.
     * @param {Element} element Action element inside a dialog.
     */
    openRepair(element) {
        element.closest('dialog')?.close();
        this.repairDialog();
    }
    /** Validate the missing segment list and start a repair transmission. */
    generateRepair() {
        const segments = $('#repair-segments')
                .value.split(/[\s,]+/)
                .filter(Boolean)
                .map(Number),
            transport = Number($('#repair-transport').value);
        if (
            !segments.length ||
            segments.length > 8192 ||
            segments.some((n) => !Number.isInteger(n) || n < 0 || n > 8191)
        )
            throw Error('Enter missing segment numbers from 0 to 8191.');
        if (!Number.isInteger(transport) || transport < 0 || transport > 65535 || (transport > 0 && transport < 3))
            throw Error('Use a transfer ID from 3 to 65535, or 0.');
        const payload = $('#repair-loaded')?.checked ? this.state.file : this.lastTransfer || this.state.file;
        if (!payload || payload.name === 'bsr.bin') throw Error('Choose the original file first.');
        this.state.direction = 'encode';
        this.state.content = 'file';
        this.chooseFormat('drm');
        this.state.file = payload;
        $('#utility-dialog').close();
        this.view.render();
        return this.generate({
            segments: [...new Set(segments)],
            transport,
            payload,
            settings: this.recoveryRequest?.settings
        });
    }
    /** Prepare a saved BSR as a zero-redundancy DRM file transmission. */
    generateBsrAudio() {
        const text = this.state.received.bsr;
        if (!text) return;
        this.state.direction = 'encode';
        this.state.content = 'file';
        this.chooseFormat('drm');
        this.state.file = { name: 'bsr.bin', bytes: new TextEncoder().encode(text) };
        this.settings().rs = 0;
        this.view.render();
        return this.generate();
    }
    /** Save or refresh received content in response to a result action.
     * @param {string} action Result action identifier.
     * @returns {Promise<void>|undefined} Pending save action, when asynchronous.
     */
    async performResultAction(action) {
        switch (action) {
            case 'save-text': {
                const sensor = this.state.content === 'sensor';
                return this.download(
                    new Blob([this.state.received.text], {
                        type: sensor ? 'application/x-ndjson' : 'text/plain;charset=utf-8'
                    }),
                    sensor ? 'webrad-sensors.jsonl' : 'webrad-messages.txt'
                );
            }
            case 'copy-text':
                await navigator.clipboard.writeText(this.state.received.text);
                return this.notify('Recovered text copied.');
            case 'save-picture':
                if (this.state.received.current) {
                    const type = $('#picture-export').value;
                    return this.download(
                        await pictureBlob(this.state.received.current, type),
                        'webrad-picture.' + (type === 'jpeg' ? 'jpg' : type)
                    );
                }
                return;
            case 'save-voice':
                if (this.state.received.voiceBlob)
                    return this.download(this.state.received.voiceBlob, 'webrad-speech.wav');
                return;
            case 'save-bsr':
                return this.download(
                    new Blob([this.state.received.bsr], { type: 'application/octet-stream' }),
                    'bsr.bin'
                );
            case 'redraw':
                if (!this.decodeHost || !this.state.received.current) throw Error('Decode a picture first.');
                this.consume(
                    await this.decodeHost.call('redraw', {
                        ppm: this.current().engine === 'fldigi' ? this.settings().pictureSlantPpm : this.settings().slantPpm,
                        phase: this.current().engine === 'fldigi' ? this.settings().picturePhasePixels : this.settings().phasePixels
                    })
                );
                this.view.paintReceived();
                return;
        }
    }
    /** Reset current format controls, persist them and reopen Advanced. */
    resetCurrentSettings() {
        this.state.settings[this.state.formatId] = defaultsFor(this.current());
        this.invalidate();
        this.persist();
        $('#advanced-dialog').close();
        this.view.render();
        this.openAdvanced();
    }
    /** Refresh the available audio input devices. */
    async refreshDevices() {
        if (!navigator.mediaDevices?.enumerateDevices)
            throw Error('Audio input devices require HTTPS or localhost.');
        this.state.inputDevices = (await navigator.mediaDevices.enumerateDevices()).filter(
            (device) => device.kind === 'audioinput'
        );
        this.view.render();
    }
    /** Open storage choices, backup actions and the current format's Advanced shortcut. */
    openSettings() {
        this.utility(
            'Settings',
            `<fieldset class="storage-options"><legend>Remember your settings</legend><label class="storage-option"><input type="radio" name="settings-storage" value="local" ${this.state.storeSettings ? 'checked' : ''}><span><strong>Save on this device</strong><small>Remember format settings, audio input, and appearance in this browser.</small></span></label><label class="storage-option"><input type="radio" name="settings-storage" value="session" ${this.state.storeSettings ? '' : 'checked'}><span><strong>Don’t save settings</strong><small>Remove stored copies. Keep your current settings for this page.</small></span></label></fieldset><p class="hint storage-note">Only your save / don’t save choice is always remembered. Audio and files are never stored.</p><p class="hint" id="storage-status" role="status"></p><section class="settings-advanced"><h3>Fine-tune your signal</h3><p>Adjust advanced controls for ${esc(this.current().name)}.</p><button class="button" data-action="settings-advanced">${icon('gear')}Advanced settings</button></section><div class="settings-backup"><span>Settings backup</span><div class="settings-buttons"><button class="link" data-action="import-settings">Import JSON</button><button class="link" data-action="export-settings">Export JSON</button></div></div>`
        );
    }
    /** Change persistence without discarding the current page's controls or other apps' data.
     * @param {boolean} enabled Whether to save preferences on this device.
     */
    setSettingsStorage(enabled) {
        this.state.storeSettings = enabled;
        let storageFailed = false;
        try {
            if (enabled) localStorage.removeItem('webrad.storage');
            else localStorage.setItem('webrad.storage', 'off');
        } catch {
            storageFailed = true;
        }
        if (!enabled) {
            for (const key of ['webrad.settings.v1', 'webrad.theme']) {
                try {
                    localStorage.removeItem(key);
                } catch {
                    storageFailed = true;
                }
            }
        } else if (!this.persist()) storageFailed = true;
        window.dispatchEvent(new CustomEvent('webrad-storage-change', { detail: { enabled } }));
        let message = enabled ? 'Your current settings are now saved.' : 'Stored copies removed. Your current settings are still available on this page.';
        if (storageFailed) message = 'Your browser could not update local storage. Your choice applies to this page, but may not be remembered after reload.';
        this.paintStoragePreference(message);
    }
    /** Update open storage choices without moving focus or reopening the dialog.
     * @param {string} message Optional feedback about a storage change.
     */
    paintStoragePreference(message = '') {
        document.querySelectorAll('input[name="settings-storage"]').forEach((input) => {
            input.checked = (input.value === 'local') === this.state.storeSettings;
        });
        const status = $('#storage-status');
        if (status) status.textContent = message;
    }
    /** Export current format controls, including changes kept only for this page. */
    exportSettings() {
        return this.download(
            new Blob(
                [JSON.stringify({ schema: 1, version: settingsVersion, settings: this.state.settings }, null, 2)],
                { type: 'application/json' }
            ),
            'webrad-settings.json'
        );
    }
    /** Open a file picker and restore compatible settings from JSON. */
    importSettings() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async () => {
            try {
                const file = input.files[0];
                if (!file || file.size > 1024 * 1024) throw Error('Choose a settings JSON smaller than 1 MB.');
                const data = JSON.parse(await file.text());
                for (const format of this.state.formats)
                    if (data.settings?.[format.id])
                        this.state.settings[format.id] = restoreSettings(format, data.settings[format.id], data.version || 1);
                this.persist();
                $('#utility-dialog').close();
                this.view.render();
                this.notify('Settings imported.');
            } catch (error) {
                this.notify(error.message);
            }
        };
        input.click();
    }
    /** Open the application usage guide. */
    openHelp() {
        this.utility(
            'Using WebRad',
            `<p><strong>Encode</strong> turns text, pictures, files, or speech into a downloadable signal or speech file. <strong>Decode</strong> recovers content from a recording or live audio input.</p><p>Choose the same signal format as the sender or intended receiver. Automatic detection is available for slow-scan pictures, weather-fax headers, and enabled sensor protocols; text formats require a selection.</p><p>Recordings decode quickly by default. To listen in step with decoding, enable <strong>Decode alongside playback</strong> in Advanced. Listening separately does not alter decoding.</p><p><strong>If recovery fails:</strong> check the recording channel, signal center, speed, tone spacing, tone order, and clock correction. Partial weather fax recordings need manual reception. Use the signal view to inspect and tune text signals.</p><p>Sensor decoding needs raw radio samples or pulse data. FreeDV needs the exact voice mode; Codec2 uses binary .c2 files. FT messages use timed slots and a limited alphabet.</p><p>All processing runs locally. Serving these files requires HTTP(S); microphone access requires HTTPS or localhost. <a href="licenses.html">Engine sources and licenses</a></p>`
        );
    }
    /** Register event groups in their original order before loading the catalog. */
    bindEvents() {
        this.bindDialogEvents();
        this.bindActionEvents();
        this.bindInputEvents();
        this.bindChangeEvents();
        this.bindUploadEvents();
        this.bindSpectrumEvents();
        this.bindDropEvents();
        this.bindLifecycleEvents();
    }
    /** Register dialog close and recovery-request upload handlers. */
    bindDialogEvents() {
        $('#advanced-dialog').addEventListener('close', () => {
            if (this.state.formats.length && !this.state.busy) this.view.render();
        });
        $('#repair-upload').addEventListener('change', (event) => this.loadRepairRequest(event));
    }
    /** Parse a selected repair request and update its editor fields.
     * @param {Event} event Repair request file input change event.
     */
    async loadRepairRequest(event) {
        const file = event.target.files[0];
        event.target.value = '';
        if (!file) return;
        try {
            if (file.size > 65536) throw Error('Choose a recovery request smaller than 64 KB.');
            this.recoveryRequest = parseRecovery(await file.text());
            $('#repair-segments').value = this.recoveryRequest.segments.join(', ');
            $('#repair-transport').value = this.recoveryRequest.transport;
            $('#repair-request-name').textContent = this.recoveryRequest.name;
        } catch (error) {
            this.notify(error.message);
        }
    }
    /** Register the shared action listener. */
    bindActionEvents() {
        document.addEventListener('click', this.handleApplicationClick.bind(this));
    }
    /** Apply each action and data attribute carried by a clicked control.
     * @param {MouseEvent} event Document click event.
     */
    async handleApplicationClick(event) {
        const element = event.target.closest('button,a[data-action]');
        if (!element) return;
        try {
            if (element.dataset.action) await this.perform(element.dataset.action, element);
            if (element.dataset.content && element.dataset.content !== this.state.content) {
                this.state.content = element.dataset.content;
                this.state.formatId = '';
                this.invalidate();
                this.ensureFormat();
                this.view.render();
            }
            if (element.dataset.source) {
                this.loopbackRevision++;
                this.state.source = element.dataset.source;
                this.view.render();
            }
            if (element.dataset.filter) {
                this.state.chooserContent = element.dataset.filter;
                $('#format-dialog .filter-chips')
                    .querySelectorAll('[data-filter]')
                    .forEach((button) => button.classList.toggle('active', button.dataset.filter === this.state.chooserContent));
                this.view.paintFormats();
            }
            if (element.dataset.candidate) {
                this.state.candidate = element.dataset.candidate;
                this.view.paintFormats();
            }
            if (element.dataset.fileIndex !== undefined) {
                const file = this.state.received.files[Number(element.dataset.fileIndex)];
                this.download(new Blob([file.bytes]), file.name);
            }
            if (element.dataset.imageIndex !== undefined) {
                this.state.received.current = this.state.received.images[Number(element.dataset.imageIndex)];
                this.view.paintReceived();
            }
        } catch (error) {
            this.state.error = error.message;
            this.notify(error.message);
            if (!this.state.busy) this.view.render();
        }
    }
    /** Register text, search and settings input handlers. */
    bindInputEvents() {
        document.addEventListener('input', (event) => this.handleInput(event));
    }
    /** Update message text, format search or a setting as it is edited.
     * @param {InputEvent} event Document input event.
     */
    handleInput(event) {
        const element = event.target;
        if (element.id === 'message') {
            this.state.text = element.value;
            this.invalidate();
            $('#character-count').textContent = this.state.text.length;
            const summary = $('.content-summary .hint');
            if (summary) summary.textContent = this.state.text.length + ' characters ready to encode';
            return;
        }
        if (element.id === 'format-search') {
            this.state.search = element.value;
            this.view.paintFormats();
            return;
        }
        if (element.dataset.setting) this.updateSettingInput(element);
    }
    /** Read and persist a changed setting control.
     * @param {HTMLInputElement} element Setting control.
     */
    updateSettingInput(element) {
        const field = groupsFor(this.current(), 'decode')
            .flatMap((group) => group.fields)
            .find((item) => item.key === element.dataset.setting);
        if (!field) return;
        const value = this.settingInputValue(field, element);
        this.settings()[field.key] = value;
        this.state.settings[this.state.formatId] = validateSettings(this.current(), this.settings());
        this.invalidate();
        this.persist();
        this.view.paintSources();
        this.view.paintPresetStatus();
        this.view.refreshFormatOptionLabels();
    }
    /** Convert a setting input value according to its declared control type.
     * @param {Object} field Setting descriptor.
     * @param {HTMLInputElement} element Setting control.
     * @returns {boolean|number|string} Typed setting value.
     */
    settingInputValue(field, element) {
        switch (field.type) {
            case 'checkbox': return element.checked;
            case 'number': return Number(element.value);
            default: return element.value;
        }
    }
    /** Register format, device and sensor selection handlers. */
    bindChangeEvents() {
        document.addEventListener('change', (event) => this.handleChange(event));
    }
    /** Apply a format, device or sensor input selection.
     * @param {Event} event Document change event.
     */
    handleChange(event) {
        const element = event.target;
        if (element.name === 'settings-storage') {
            this.setSettingsStorage(element.value === 'local');
            return;
        }
        if (element.id === 'format-family') {
            const group = this.selectedGroups().find((item) => item.id === element.value);
            this.chooseFormat(group.formats[0].id);
            this.view.render();
        }
        if (element.id === 'format-variant') {
            this.chooseFormat(element.value);
            this.view.render();
        }
        if (element.id === 'candidate-variant') {
            this.state.candidate = element.value;
            this.view.paintFormats();
        }
        if (element.id === 'live-device') {
            this.state.liveDevice = element.value;
            this.persist();
        }
        if (element.id === 'sensor-input') {
            this.settings().sensorInput = element.value;
            this.persist();
        }
    }
    /** Register content file pickers in picture, audio, file and sensor order. */
    bindUploadEvents() {
        const loaders = [
            ['picture-upload', (file) => this.loadPicture(file)],
            ['audio-upload', this.loadAudio.bind(this)],
            ['file-upload', (file) => this.loadFile(file)],
            ['sensor-upload', (file) => this.loadSensorFile(file)]
        ];
        for (const [id, load] of loaders)
            $('#' + id).addEventListener('change', (event) => this.handleUploadChange(event, load));
    }
    /** Read a picture and refresh its source preview.
     * @param {File} file Selected image file.
     */
    async loadPicture(file) {
        this.state.picture = await readPicture(file, async (args) =>
            (await this.bridge('jp2')).call('imageCodec', args)
        );
        this.invalidate();
        this.view.render();
    }
    /** Read a bounded file for transmission.
     * @param {File} file Selected file.
     */
    async loadFile(file) {
        if (file.size > 16 * 1024 * 1024) throw Error('Files are limited to 16 MB.');
        this.state.file = { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
        this.invalidate();
        this.view.render();
    }
    /** Read raw sensor data and infer its representation from a recognized extension.
     * @param {File} file Selected radio data file.
     */
    async loadSensorFile(file) {
        if (file.size > 512 * 1024 * 1024) throw Error('Radio recordings are limited to 512 MB.');
        this.state.sensor = { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
        const extension = file.name.split('.').pop().toLowerCase();
        this.settings().sensorInput = this.sensorInputForExtension(extension);
        this.persist();
        this.view.render();
    }
    /** Choose a sensor representation for a recognized filename extension.
     * @param {string} extension Lowercase file extension.
     * @returns {string} Sensor input representation to select.
     */
    sensorInputForExtension(extension) {
        const inputTypes = {
            json: 'pulses',
            ook: 'pulses',
            txt: 'pulses',
            cu8: 'cu8',
            cs16: 'cs16',
            cf32: 'cf32',
            am: 'am',
            fm: 'fm'
        };
        return inputTypes[extension] || this.settings().sensorInput;
    }
    /** Handle one upload picker change and display errors from its loader.
     * @param {Event} event File input change event.
     * @param {Function} load File-specific loader bound to this application.
     */
    async handleUploadChange(event, load) {
        const file = event.target.files[0];
        event.target.value = '';
        if (!file || this.state.busy) return;
        try {
            await load(file);
        } catch (error) {
            this.state.error = error.message;
            this.state.status = 'The selected file could not be opened.';
            this.view.render();
        }
    }
    /** Register spectrum and spectrogram tuning clicks. */
    bindSpectrumEvents() {
        document.addEventListener('click', (event) => this.handleSpectrumClick(event));
    }
    /** Apply a signal graph click as the text modem's selected signal center.
     * @param {MouseEvent} event Document click event.
     */
    handleSpectrumClick(event) {
        if (['spectrum', 'spectrogram'].includes(event.target.id) && this.current().engine === 'fldigi' && !this.state.busy) {
            const bounds = event.target.getBoundingClientRect();
            const frequency = event.target.id === 'spectrogram'
                ? Spectrogram.frequencyAt((event.clientY - bounds.top) / bounds.height)
                : Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)) * 4000;
            this.settings().frequency = Math.round(frequency);
            this.persist();
            this.view.render();
            this.notify(`Signal center set to ${this.settings().frequency} Hz. Start decoding again to apply.`);
        }
    }
    /** Register drag/drop file loading. */
    bindDropEvents() {
        document.addEventListener('dragover', (event) => event.preventDefault());
        document.addEventListener('drop', (event) => this.handleFileDrop(event));
    }
    /** Load a dropped recording, picture or data file for the current workflow.
     * @param {DragEvent} event Document drop event.
     */
    async handleFileDrop(event) {
        event.preventDefault();
        if (this.state.busy) return;
        const file = event.dataTransfer.files[0];
        if (!file) return;
        try {
            if (
                (this.state.direction === 'decode' && this.state.content !== 'sensor') ||
                this.state.content === 'voice'
            )
                await this.loadAudio(file);
            else if (this.state.content === 'picture') {
                this.state.picture = await readPicture(file, async (args) =>
                    (await this.bridge('jp2')).call('imageCodec', args)
                );
                this.view.render();
            } else if (this.state.content === 'file') {
                if (file.size > 16 * 1024 * 1024) throw Error('Files are limited to 16 MB.');
                this.state.file = { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
                this.view.render();
            } else this.notify('Use the raw radio file picker to open sensor data.');
        } catch (error) {
            this.notify(error.message);
        }
    }
    /** Register worker cleanup, resize redraws and diagnostic disclosure updates. */
    bindLifecycleEvents() {
        window.addEventListener('storage', (event) => {
            if (event.key !== 'webrad.storage' && event.key !== null) return;
            this.state.storeSettings = this.storagePreference();
            this.paintStoragePreference();
        });
        window.addEventListener('beforeunload', () => {
            for (const bridge of this.bridges.values()) bridge.close();
            this.state.live?.stream.getTracks().forEach((track) => track.stop());
            for (const url of this.downloadUrls) URL.revokeObjectURL(url);
        });
        window.addEventListener('resize', () => {
            this.view.paintSources();
            this.view.paintAnalysis();
        });
        document.addEventListener(
            'toggle',
            (event) => {
                if (event.target.matches('.signal-card') && event.target.open) this.view.paintAnalysis();
            },
            true
        );
    }
    /** Load the format catalog, restore saved controls and render the initial workflow.
     * @returns {Promise<void>} Resolves after startup or the existing startup error view.
     */
    async start() {
        this.bindEvents();
        try {
            const response = await fetch(new URL('../formats.json', import.meta.url));
            if (!response.ok) throw Error('The format catalog is missing. Rebuild build/out/.');
            this.state.formats = (await response.json()).formats;
            try {
                const saved = this.state.storeSettings
                    ? JSON.parse(localStorage.getItem('webrad.settings.v1') || '{}')
                    : {};
                for (const f of this.state.formats)
                    if (saved.settings?.[f.id])
                        this.state.settings[f.id] = restoreSettings(f, saved.settings[f.id], saved.version || 1);
                this.state.liveDevice = saved.liveDevice || 'default';
            } catch {}
            this.ensureFormat();
            this.persist();
            this.view.render();
            if (this.q.get('view') === 'formats') this.openFormats();
            if (this.q.get('panel') === 'advanced') this.openAdvanced();
        } catch (error) {
            $('#app').innerHTML =
                `<div class="boot-message"><h1>WebRad could not start</h1><p>${esc(error.message)}</p><p>Serve build/out/ over HTTP(S), rather than opening index.html as a local file.</p></div>`;
        }
    }
}
