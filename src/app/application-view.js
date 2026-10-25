import { AdditionalFormats } from './additional-formats.js';
import { icon, logo } from './icons.js';

import { groupsFor, defaultsFor } from './settings.js';
import { describe, formatGroups, matchesFormat } from './catalog.js';
import { timeLabel, joinChunks } from './audio.js';
import { AudioPlayer } from './audio-player.js';
import { Spectrogram } from './spectrogram.js';
import { preparePicture, pictureCanvas } from './pictures.js';

import { $, esc } from './dom.js';
/** Renders workflow markup and canvases; processing remains in the application controller. */
export class ApplicationView {
    /** Controller owning the state displayed by this view. */
    application;
    /** Mounted audio controls, released before their markup is replaced. */
    audioPlayers;
    /** Attach the view to its controller.
     * @param {WebRadApplication} application Workflow controller.
     */
    constructor(application) {
        this.application = application;
        this.audioPlayers = new Map();
    }
    /**
     * Build the stable engine/family key used by family selectors.
     * @param {Object} f Selected catalog format and native mode.
     * @returns {string} Stable engine and family identifier.
     */
    groupId(f) {
        return f.engine + ':' + f.family;
    }
    /**
     * Render escaped select options and mark the current value.
     * @param {Array} items Selector value/label pairs in display order.
     * @param {*} value Current option value.
     */
    optionsHtml(items, value) {
        return items
            .map(
                ([key, label]) =>
                    `<option value="${esc(key)}" ${String(key) === String(value) ? 'selected' : ''}>${esc(label)}</option>`
            )
            .join('');
    }
    /**
     * Describe a format choice, including the active FreeDV packet capacity.
     * @param {Object} f Selected catalog format and native mode.
     */
    formatOptionName(f) {
        const name = f.name;
        if (f.engine !== 'voice' || !f.data) return name;
        const settingsForFormat = this.application.state.settings[f.id] || defaultsFor(f),
            bytes =
                f.mode === 9
                    ? { H_256_512_4: 30, H_128_256_5: 14, HRA_112_112: 12 }[settingsForFormat.voiceFskCode]
                    : { 14: 14, 10: 510, 12: 126, 18: 54, 19: 14, 20: 3 }[f.mode];
        return bytes ? `${name} (${bytes} bytes)` : name;
    }
    /** Refresh variant labels after packet settings change. */
    refreshFormatOptionLabels() {
        document.querySelectorAll('#format-variant,#candidate-variant').forEach((select) =>
            Array.from(select.options).forEach((option) => {
                const f = this.application.state.formats.find((f) => f.id === option.value);
                if (f) option.textContent = this.formatOptionName(f);
            })
        );
    }
    /**
     * Render a labeled selector with its current value and busy state.
     * @param {string} id Selector element ID.
     * @param {string} label Selector label.
     * @param {Array} items Selector value/label pairs in display order.
     * @param {*} value Current option value.
     */
    selectHtml(id, label, items, value) {
        return `<label class="field-label" for="${id}">${esc(label)}</label><div class="select-wrap"><select id="${id}" ${this.application.state.busy ? 'disabled' : ''}>${this.optionsHtml(items, value)}</select>${icon('down')}</div>`;
    }
    /** Count saved controls that differ from a format's own starting settings.
     * @param {Object} format Catalog entry, including any named preset overrides.
     * @returns {number} Number of modified controls.
     */
    changedSettingCount(format = this.application.current()) {
        const defaults = defaultsFor(format);
        const settings = this.application.state.settings[format.id] || defaults;
        return Object.keys(settings).filter((key) => settings[key] !== defaults[key]).length;
    }
    /** Build the Advanced label and its changed-control count. */
    advancedButtonContent(changed) {
        return `${icon('gear')}Advanced${changed ? `<span class="setting-count" aria-label="${changed} changed setting${changed === 1 ? '' : 's'}">${changed}</span>` : ''}`;
    }
    /** Build the Advanced action and emphasize formats with modified settings. */
    advancedButton() {
        const changed = this.changedSettingCount();
        return `<button class="advanced-button${changed ? ' modified' : ''}" data-action="advanced" ${this.disabled()}>${this.advancedButtonContent(changed)}</button>`;
    }
    /** Build the shared header and workflow navigation. */
    header() {
        const dark = globalThis.document?.documentElement?.dataset.theme === 'dark';
        return `<header class="topbar"><a class="brand" href="./" aria-label="WebRad home">${logo()}<span>WebRad</span></a><nav class="mode-tabs" aria-label="Workflow">${['encode', 'decode'].map((d) => `<button data-action="${d}" class="${this.application.state.direction === d ? 'active' : ''}" aria-current="${this.application.state.direction === d ? 'page' : 'false'}" ${this.disabled()}>${d === 'encode' ? 'Encode' : 'Decode'}</button>`).join('')}</nav><div class="header-actions"><button type="button" class="theme-toggle" aria-label="Dark mode" aria-pressed="${dark}" title="Switch to ${dark ? 'light' : 'dark'} mode">${icon('sun', 'theme-sun')}${icon('moon', 'theme-moon')}</button><button data-action="help" aria-label="Help">${icon('help')}<span>Help</span></button><button data-action="settings" aria-label="Settings" ${this.disabled()}>${icon('gear')}<span>Settings</span></button></div></header>`;
    }
    /** Show guidance for the selected workflow. */
    intro() {
        const heading = this.application.state.direction === 'encode'
            ? 'Create audio from your data'
            : 'Recover data from a recording';
        return `<section class="intro"><h1>${heading}</h1><p>${this.introDescription()}</p></section>`;
    }
    /** Explain the selected workflow without depending on content or format. */
    introDescription() {
        if (this.application.state.direction === 'encode')
            return 'Turn text, pictures, files, and speech into audio you can play and share.';
        return 'Use a recording or your mic to recover text, images, or files.';
    }
    /** Build the content choices available for this workflow. */
    contentButtons() {
        return `<div class="segmented content-types" role="group" aria-label="${this.application.state.direction === 'encode' ? 'Content type' : 'Content to recover'}">${Object.entries(
            this.application.contentNames
        )
            .filter(([type]) => this.application.state.direction === 'decode' || type !== 'sensor')
            .map(
                ([type, label]) =>
                    `<button data-content="${type}" class="${this.application.state.content === type ? 'active' : ''}" aria-pressed="${this.application.state.content === type}" ${this.disabled()}>${icon(this.contentIcon(type))}${label}</button>`
            )
            .join('')}</div>`;
    }
    /** Return the icon name used by a content type. */
    contentIcon(type) {
        if (type === 'voice') return 'mic';
        if (type === 'sensor') return 'bars';
        return type;
    }
    /** Build the editor or file picker for the selected content. */
    inputCard() {
        switch (this.application.state.content) {
            case 'text': return this.textInputCard();
            case 'picture': return this.pictureInputCard();
            case 'file': return this.fileInputCard();
            default: return this.voiceInputCard();
        }
    }
    /** Build the text editor for encoding a message. */
    textInputCard() {
        return `<label class="text-label" for="message">Your message</label><textarea id="message" placeholder="Write a message…" ${this.disabled()}>${esc(this.application.state.text)}</textarea><p class="hint"><span id="character-count">${this.application.state.text.length}</span> characters</p>`;
    }
    /** Build the picture picker and optional sample action. */
    pictureInputCard() {
        return `<button class="upload-card upload-button" data-action="upload-picture" ${this.disabled()}><div class="thumbnail actual-thumbnail" id="source-thumbnail">${this.application.state.picture ? '' : icon('picture')}</div><div><p class="filename">${esc(this.application.state.picture?.name || 'Choose a picture')}</p><span class="link">${this.application.state.picture ? 'Change picture' : 'Open picture'}</span></div></button>${!this.application.state.picture ? '<button class="link sample-link" data-action="sample">Try a sample picture</button>' : ''}`;
    }
    /** Build the file picker and selected file size. */
    fileInputCard() {
        return `<button class="upload-card upload-button" data-action="upload-file" ${this.disabled()}>${icon('file')}<div><p class="filename">${esc(this.application.state.file?.name || 'Choose a file')}</p><span class="link">Open file</span>${this.application.state.file ? `<p class="hint">${(this.application.state.file.bytes.length / 1024).toFixed(1)} KB</p>` : ''}</div></button>`;
    }
    /** Build the speech recording picker. */
    voiceInputCard() {
        if (this.application.state.audio?.url && !this.application.state.audio.codecBytes) return this.recordingDetails();
        return `<button class="upload-card upload-button" data-action="upload-audio" ${this.disabled()}>${icon('mic')}<div><p class="filename">${esc(this.application.state.audio?.name || 'Choose a speech recording')}</p><span class="link">Open audio file</span>${this.application.state.audio ? `<p class="hint">${timeLabel(this.application.state.audio.duration)} · ${this.application.state.audio.rate} Hz</p>` : ''}</div></button>`;
    }
    /** Refresh modification cues without replacing controls or interrupting focus. */
    paintPresetStatus() {
        const changed = this.changedSettingCount();
        const button = $('.advanced-button');
        if (button) {
            button.classList.toggle('modified', changed > 0);
            button.innerHTML = this.advancedButtonContent(changed);
        }
        const dialog = $('#advanced-dialog');
        if (dialog) {
            const defaults = defaultsFor(this.application.current());
            const settings = this.application.settings();
            for (const indicator of dialog.querySelectorAll('[data-modified-setting]')) {
                const key = indicator.dataset.modifiedSetting;
                indicator.hidden = settings[key] === defaults[key];
            }
        }
    }
    /**
     * Render compatible family and variant selectors with preset guidance.
     */
    formatControls() {
        const f = this.application.current(),
            groups = this.application.selectedGroups(),
            group = groups.find((g) => g.id === this.groupId(f));
        return `<div class="format-family-label"><label class="field-label" for="format-family">Signal family</label><button class="format-explore" type="button" data-action="formats" ${this.disabled()}>Explore formats</button></div><div class="select-wrap"><select id="format-family" ${this.disabled()}>${this.optionsHtml(
            groups.map((g) => [g.id, g.label]),
            this.groupId(f)
        )}</select>${icon('down')}</div><label class="field-label" for="format-variant">Format / variant</label><div class="select-wrap"><select id="format-variant" ${this.disabled()}>${this.optionsHtml(
            (group?.formats || []).map((f) => [f.id, this.formatOptionName(f)]),
            f.id
        )}</select>${icon('down')}</div><p class="hint">The format and variant must match the recording or receiving device.</p>`;
    }
    /**
     * Render the few controls needed before encoding the selected format.
     */
    basicControls() {
        const f = this.application.current(),
            s = this.application.settings();
        let html = this.pictureFitControls();
        html += this.cwSpeedControl(f, s);
        html += this.frequencyControl(f, s);
        html += this.fsqCallsignControl(f, s);
        html += this.engineHints(f, s);
        return html || '<p class="hint">The receiver must use a compatible format and variant.</p>';
    }
    /** Build picture fit controls when encoding a picture. */
    pictureFitControls() {
        if (this.application.state.content !== 'picture') return '';
        return `<div class="segmented"><button data-action="fit" class="${this.application.state.fit === 'fit' ? 'active' : ''}" ${this.disabled()}>${icon('fit')}Fit</button><button data-action="crop" class="${this.application.state.fit === 'crop' ? 'active' : ''}" ${this.disabled()}>${icon('crop')}Crop</button></div><p class="hint">${this.application.state.fit === 'fit' ? 'Keep the whole picture, with borders if needed.' : 'Fill the frame by cropping the edges.'}</p>`;
    }
    /** Build the speed control for CW formats.
     * @param {Object} format Selected catalog entry.
     * @param {Object} settings Current format settings.
     * @returns {string} CW speed control or an empty string.
     */
    cwSpeedControl(format, settings) {
        if (format.family !== 'CW') return '';
        return this.fieldHtml(
            {
                key: 'cwSpeed',
                label: 'Speed (words per minute)',
                type: 'number',
                min: 5,
                max: 100,
                step: 1
            },
            settings
        );
    }
    /** Build the tuning control for fldigi formats that use frequency.
     * @param {Object} format Selected catalog entry.
     * @param {Object} settings Current format settings.
     * @returns {string} Frequency control or an empty string.
     */
    frequencyControl(format, settings) {
        if (format.engine !== 'fldigi' || format.family === 'DTMF') return '';
        return this.fieldHtml(
            {
                key: 'frequency',
                label: 'Tone / signal center (Hz)',
                type: 'number',
                min: 0,
                max: 4000,
                step: 1
            },
            settings
        );
    }
    /** Build the sender callsign control for FSQ picture headers.
     * @param {Object} format Selected catalog entry.
     * @param {Object} settings Current format settings.
     * @returns {string} Callsign control or an empty string.
     */
    fsqCallsignControl(format, settings) {
        if (format.family !== 'FSQ' || this.application.state.content !== 'picture') return '';
        return this.fieldHtml(
            {
                key: 'callsign',
                label: 'Sender callsign (required)',
                type: 'text',
                help: 'FSQ picture headers identify the sender. Receivers should select 3 baud.'
            },
            settings
        );
    }
    /** Build format-specific guidance and extra payload controls.
     * @param {Object} format Selected catalog entry.
     * @param {Object} settings Current format settings.
     * @returns {string} Applicable format hints and controls.
     */
    engineHints(format, settings) {
        let html = '';
        if (format.engine === 'weak')
            html += '<p class="hint">For example: CQ K1ABC FN42. Short free text is limited to the FT alphabet and 13 characters.</p>';
        if (format.engine === 'packet' && (!format.aprs || settings.aprsPayload === 'raw'))
            html += '<p class="hint">Packet form: SOURCE&gt;DESTINATION[,PATH]:message<br>For example: K1ABC&gt;APRS:Hello from WebRad</p>';
        if (format.aprs && settings.aprsPayload === 'position') html += '<p class="hint">Write a location comment here. Set the sender, latitude and longitude in Advanced.</p>';
        if (format.engine === 'dispatch') html += '<p class="hint">Radio ID: four hexadecimal digits, for example 12AB. Operation and packet options are in Advanced.</p>';
        if (format.engine === 'beacon') html += '<p class="hint">Example: K1ABC FN42 30. This produces one two-minute recording.</p>';
        if (format.engine === 'aircraft') html += '<p class="hint">Enter up to 220 ASCII characters. Set the aircraft address and message label in Advanced.</p>';
        if (format.engine === 'spectrum') html += '<p class="hint">Use short lines of text; the result is a picture in the frequency display, not machine-readable text.</p>';
        if (format.engine === 'sound') {
            if (format.mode >= 6)
                html += this.fieldHtml(
                    {
                        key: 'ggPayload',
                        label: 'Message size in bytes (must match receiver)',
                        type: 'number',
                        min: 1,
                        max: 140,
                        step: 1
                    },
                    settings
                );
            html += `<p class="hint">${format.mode >= 6 ? 'This format sends a fixed number of UTF-8 bytes.' : 'Up to 140 UTF-8 bytes.'} Ultrasonic formats need devices that capture high-frequency sound.</p>`;
        }
        if (format.codec)
            html += '<p class="hint">Creates a compressed .c2 speech file. A Codec2 file is binary data, rather than a modem audio recording.</p>';
        return html;
    }
    /** Build content, format and preparation steps for encoding. */
    encodeSetup() {
        return `<aside class="card setup" aria-label="Encoding setup"><section class="step"><h2><span class="number">1</span>Your content</h2>${this.contentButtons()}${this.inputCard()}</section><section class="step"><h2><span class="number">2</span>Signal format</h2>${this.formatControls()}</section><section class="step"><h2><span class="number">3</span>${this.application.state.content === 'picture' ? 'Picture fit' : 'Prepare the signal'}</h2>${this.basicControls()}</section>${this.advancedButton()}</aside>`;
    }
    /** Show operation status, progress, errors and cancellation. */
    operationBox() {
        return `<div class="operation" aria-live="polite"><div class="operation-header"><span id="operation-status">${esc(this.application.state.status)}</span><span id="operation-percent">${this.application.state.busy ? Math.round(this.application.state.progress) + '%' : ''}</span></div><div class="progress" role="progressbar" aria-label="Processing progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${this.application.state.progress}"><span style="width:${this.application.state.progress}%"></span></div>${this.application.state.error ? `<p class="error-message" role="alert">${esc(this.application.state.error)}</p>` : ''}${this.application.state.busy ? '<button class="button stop-button" data-action="stop">Stop processing</button>' : ''}</div>`;
    }
    /** Build playback and download controls for generated output. */
    audioResult() {
        const o = this.application.state.output;
        if (!o) return '';
        return `<section class="result-card"><h2>${o.file ? 'Your speech file is ready' : 'Your audio is ready'}</h2>${o.url ? '' : `<p class="filename">${esc(o.name)}</p>`}${this.outputAudioPreview(o)}${this.packetPlanHint(o)}${this.outputActions(o)}</section>`;
    }
    /** Build the generated WAV preview when output contains audio.
     * @param {Object} output Generated output state.
     * @returns {string} Audio preview markup or an empty string.
     */
    outputAudioPreview(output) {
        if (!output.url) return '';
        return AudioPlayer.html({
            kind: 'output',
            url: output.url,
            name: output.name,
            duration: output.samples.length / output.rate,
            specs: `WAV · mono · ${output.rate} Hz · 16-bit PCM`
        });
    }
    /** Build the packet summary when output contains a split file transfer.
     * @param {Object} output Generated output state.
     * @returns {string} Packet plan markup or an empty string.
     */
    packetPlanHint(output) {
        const plan = output.packetPlan;
        if (!plan) return '';
        const padding = plan.paddingBytes
            ? ` · final packet padded with ${plan.paddingBytes.toLocaleString()} padding bytes`
            : '';
        return `<p class="hint">${plan.packetCount.toLocaleString()} FreeDV packet${plan.packetCount === 1 ? '' : 's'} · ${plan.payloadBytes.toLocaleString()} bytes per packet · original file: ${plan.size.toLocaleString()} bytes${padding}</p>`;
    }
    /** Build download and loopback test actions for generated output.
     * @param {Object} output Generated output state.
     * @returns {string} Result action markup.
     */
    outputActions(output) {
        const download = output.url ? '' : `<button class="button primary" data-action="download">${icon('download')}Download ${output.file ? 'C2' : 'WAV'}</button>`;
        return `<div class="result-actions">${download}<button class="button" data-action="test">${icon('decode')}Decode this ${output.file ? 'file' : 'audio'}</button></div>`;
    }
    /** Build the encoding preview and generated result section. */
    encodeMain() {
        const heading = this.application.state.content === 'picture' ? 'Picture preview' : 'Ready to encode';
        const preview = this.application.state.content === 'picture' ? this.picturePreview() : this.contentPreview();
        const buttonText = this.application.state.output
            ? 'Create again'
            : 'Create ' + (this.application.current().codec ? 'speech file' : 'audio');
        return `<section class="card preview-card"><h2 class="preview-heading">${heading}</h2>${preview}<button class="button primary generate" data-action="generate" ${this.disabled()}>${icon('encode')}${buttonText}</button>${this.operationBox()}${this.audioResult()}</section>`;
    }
    /** Build the prepared-picture preview container. */
    picturePreview() {
        const empty = this.application.state.picture
            ? ''
            : `<div class="empty-state">${icon('picture')}<h3>Your picture starts here</h3><p>Open a picture or try the sample.</p><button class="button" data-action="upload-picture">Choose a picture</button></div>`;
        return `<div class="picture-stage"><div id="prepared-picture" class="actual-picture">${empty}</div><p class="picture-meta" id="picture-meta"></p></div>`;
    }
    /** Build the non-picture content preview summary. */
    contentPreview() {
        const content = this.application.state.content;
        const detail = content === 'text'
            ? `${this.application.state.text.length} characters ready to encode`
            : this.contentInputName(content);
        return `<div class="empty-preview content-summary">${icon(this.encodeContentIcon(content))}<h3>${esc(describe(this.application.current()).title)}</h3><p>${esc(this.application.current().name)}</p><p class="hint">${content === 'text' ? detail : esc(detail)}</p></div>`;
    }
    /** Return the icon used by the encoding preview. */
    encodeContentIcon(content) {
        return content === 'voice' ? 'mic' : content;
    }
    /** Return the selected file or audio name, falling back to its picker prompt.
     * @param {string} content Selected non-text content type.
     * @returns {string} Preview name or prompt.
     */
    contentInputName(content) {
        if (content === 'file') return this.application.state.file?.name || 'Choose the file you want to transfer.';
        return this.application.state.audio?.name || 'Choose the speech recording you want to encode.';
    }
    /** Build the selected recording, microphone or sensor controls. */
    audioSourceCard() {
        const f = this.application.current();
        if (this.application.state.content === 'sensor') return this.sensorSourceCard(f);
        return `<section class="card audio-card"><h2>Audio source</h2>${this.sourceTabs(f)}${this.application.state.source === 'recording' ? this.recordingSource() : this.liveSource()}</section>`;
    }
    /** Build the raw sample and pulse data picker. */
    sensorSourceCard(format) {
        const choices = groupsFor(format)
            .flatMap((group) => group.fields)
            .find((field) => field.key === 'sensorInput').choices;
        return `<section class="card audio-card"><h2>Radio recording</h2><button class="audio-file" data-action="upload-sensor" ${this.disabled()}>${icon('file')}<span>${esc(this.application.state.sensor?.name || 'Choose raw samples or pulse data')}</span>${icon('more')}</button><p class="hint">Raw I/Q, AM/FM baseband, or pulse/gap durations. Choose the input representation in Advanced.</p>${this.selectHtml(
            'sensor-input',
            'Input representation',
            choices,
            this.application.settings().sensorInput
        )}</section>`;
    }
    /** Build recording and live input tabs. */
    sourceTabs(format) {
        return `<div class="segmented source-tabs"><button data-source="recording" class="${this.application.state.source === 'recording' ? 'active' : ''}" ${this.disabled()}>Recording</button><button data-source="live" class="${this.application.state.source === 'live' ? 'active' : ''}" ${this.disabled()} ${format.codec ? 'disabled' : ''}>Live input</button></div>`;
    }
    /** Build the recording picker, waveform and playback note. */
    recordingSource() {
        if (this.application.state.audio?.url && !this.application.state.audio.codecBytes)
            return `${this.recordingDetails()}<p class="hint">${this.application.settings().paced ? 'Decode alongside playback is enabled.' : 'Fast decoding · playback is independent.'}</p>`;
        return `<button class="audio-file" data-action="upload-audio" ${this.disabled()}>${icon('file')}<span>${esc(this.application.state.audio?.name || 'Choose a recording')}</span>${icon('more')}</button>${this.recordingDetails()}<p class="hint">${this.application.settings().paced ? 'Decode alongside playback is enabled.' : 'Fast decoding · playback is independent.'}</p>`;
    }
    /** Build recording metadata and playback controls when ordinary audio is selected. */
    recordingDetails() {
        const audio = this.application.state.audio;
        if (!audio || audio.codecBytes) return '';
        const channelLabel = audio.channels.length === 1 ? '' : 's';
        const extension = audio.name.split('.').pop().toUpperCase();
        return AudioPlayer.html({
            kind: 'input',
            url: audio.url,
            name: audio.name,
            duration: audio.duration,
            specs: `${extension} · ${audio.channels.length} channel${channelLabel} · ${audio.rate} Hz`,
            disabled: this.application.state.busy
        });
    }
    /** Build the live input device selector and microphone level display. */
    liveSource() {
        const devices = [
            [this.application.state.liveDevice, 'Default / selected device'],
            ...this.application.state.inputDevices
                .filter((device) => device.deviceId !== this.application.state.liveDevice)
                .map((device, index) => [device.deviceId, device.label || `Audio input ${index + 1}`])
        ];
        return `${this.selectHtml('live-device', 'Audio input', devices, this.application.state.liveDevice)}<button class="link" data-action="devices">Refresh input devices</button><p class="hint">Microphone access starts only when you press Start decoding. Browser speech processing is disabled.</p><div class="input-level"><span id="input-level-bar"></span></div>`;
    }
    /** Build decode source and receiver controls. */
    decodeSetup() {
        return `<aside class="decode-sidebar">${this.audioSourceCard()}<section class="card recover-card"><h2>Recover</h2>${this.contentButtons()}${this.formatControls()}${this.application.current().engine === 'fldigi' && this.application.current().family !== 'DTMF' ? this.fieldHtml({ key: 'frequency', label: 'Signal center / tone (Hz)', type: 'number', min: 0, max: 4000, step: 1 }, this.application.settings()) : ''}<button class="button primary pause-button" data-action="decode-start" ${this.disabled()}>${icon('decode')}Start decoding</button>${this.operationBox()}${this.advancedButton()}</section></aside>`;
    }
    /** Build save and copy actions for received text. */
    resultControls() {
        return `<div class="result-actions"><button class="button" data-action="save-text" ${!this.application.state.received.text ? 'disabled' : ''}>${icon('download')}Save ${this.application.state.content === 'sensor' ? 'JSON' : 'text'}</button><button class="button" data-action="copy-text" ${!this.application.state.received.text ? 'disabled' : ''}>Copy text</button></div>`;
    }
    /** Explain when the bounded native receivers produce their results. */
    offlineReceiveHint() {
        if (!AdditionalFormats.urls[this.application.current().engine]) return '';
        return '<p class="hint">Results appear when the recording ends or you press Stop. For live input, stop capture to see the result.</p>';
    }
    /** Describe whether the selected picture receiver can display partial scan lines. */
    pictureReceiveHint(printedText) {
        if (AdditionalFormats.urls[this.application.current().engine]) return 'The finished picture can be saved as PNG, JPEG or BMP.';
        if (printedText) return 'Printed text appears progressively. Save the received strip as an image.';
        return 'Pictures appear progressively. Partial pictures can also be saved.';
    }
    /** Build recovered content and signal diagnostics. */
    decodeMain() {
        const r = this.application.state.received,
            contentName = this.application.current().family === 'Hellschreiber'
                ? 'printed text'
                : this.application.contentNames[this.application.state.content].toLowerCase();
        return `<div class="decode-main"><section class="card receive-card"><h2>Recovered ${contentName}</h2>${this.receivedContentHtml(r)}${this.offlineReceiveHint()}<p id="decoder-status" class="decoder-status" role="status">${esc(r.status)}</p></section>${this.signalDiagnostics()}</div>`;
    }
    /** Select the recovered content markup for the active content type.
     * @param {Object} received Current receiver result state.
     * @returns {string} Recovered content section markup.
     */
    receivedContentHtml(received) {
        switch (this.application.state.content) {
            case 'picture': return this.receivedPictureHtml(received);
            case 'voice': return this.receivedVoiceHtml(received);
            case 'file': return this.receivedFilesHtml();
            default: return this.receivedTextHtml(received);
        }
    }
    /** Build the progressive picture view and picture download controls.
     * @param {Object} received Current receiver result state.
     * @returns {string} Picture result markup.
     */
    receivedPictureHtml(received) {
        const printedText = this.application.current().family === 'Hellschreiber',
            title = printedText ? 'Waiting for printed text' : 'Waiting for a picture',
            description = printedText ? 'Hellschreiber prints letters as an image.' : 'Your recovered picture will appear here.',
            hint = this.pictureReceiveHint(printedText);
        return '<div class="receive-image actual-picture' + (printedText ? ' received-print' : '') + '" id="received-picture"><div class="empty-state">' + icon('picture') + '<h3>' + title + '</h3><p>' + description + '</p></div></div><div class="receive-bottom"><div><p id="picture-status" class="hint">' + hint + '</p></div><div class="save-area"><div class="picture-save"><select id="picture-export" aria-label="Picture download format"><option value="png">PNG</option><option value="jpeg">JPEG</option><option value="bmp">BMP</option></select><button class="button" data-action="save-picture" ' + (!received.current ? 'disabled' : '') + '>' + icon('download') + 'Save picture</button></div></div></div><div id="image-history" class="image-history"></div>';
    }
    /** Build the recovered speech player or its waiting state.
     * @param {Object} received Current receiver result state.
     * @returns {string} Speech result markup.
     */
    receivedVoiceHtml(received) {
        const output = received.voiceUrl
            ? AudioPlayer.html({
                kind: 'speech',
                url: received.voiceUrl,
                name: 'webrad-speech.wav',
                duration: received.audio.reduce((length, chunk) => length + chunk.length, 0) / received.rate,
                specs: `WAV · mono · ${received.rate} Hz · 16-bit PCM`
            })
            : `<div class="empty-state">${icon('mic')}<h3>Waiting for speech</h3><p>Recovered speech will be available to listen to and save.</p></div>`;
        return `<div id="voice-result" class="voice-result">${output}</div>`;
    }
    /** Build the recovered file and repair action containers. */
    receivedFilesHtml() {
        return '<div id="received-files" class="received-files"></div><div id="repair-actions"></div>';
    }
    /** Build recovered text and its save/copy controls.
     * @param {Object} received Current receiver result state.
     * @returns {string} Text result markup.
     */
    receivedTextHtml(received) {
        return `<pre id="received-text" class="received-text" aria-live="off">${esc(received.text || 'Decoded messages will appear here.')}</pre>${this.resultControls()}`;
    }
    /** Build the signal and diagnostics disclosure. */
    signalDiagnostics() {
        const frequencies = [4000, 2000, 1000, 600, 300, 100];
        const frequencyLabels = frequencies.map((frequency) => {
            const position = Math.log(4000 / frequency) / Math.log(4000 / 80) * 100;
            return `<span style="top:${position}%">${frequency}</span>`;
        }).join('');
        return `<details class="card signal-card"><summary>${icon('down')}Signal view & diagnostics</summary><p class="hint">Click the graph to tune to the center of the signal.</p><canvas id="spectrum" class="signal-spectrum" aria-label="Received signal spectrum"></canvas><div class="frequency-axis"><span>0</span><span>1000</span><span>2000</span><span>3000</span><span>4000 Hz</span></div><div class="spectrogram-plot"><div class="spectrogram-frequency" aria-label="Frequency in hertz">${frequencyLabels}</div><canvas id="spectrogram" class="signal-spectrogram" width="${Spectrogram.WIDTH}" height="${Spectrogram.HEIGHT}" aria-label="Received signal spectrogram, time from left to right, frequency from bottom to top"></canvas></div><div id="spectrogram-time" class="frequency-axis spectrogram-time" aria-label="Time in seconds"><span>0 s</span><span></span><span></span><span></span><span></span></div><div class="spectrogram-key"><span>Frequency (Hz) · Time (s)</span><span>Quiet <i aria-hidden="true"></i> Strong</span></div><canvas id="sync-view" aria-label="Picture synchronization" hidden></canvas><pre id="diagnostics" class="diagnostics"></pre></details>`;
    }
    /**
     * Rebuild the workflow view and then restore canvas previews and recovered content.
     */
    render() {
        this.application.ensureFormat();
        this.disposeAudioPlayers();
        $('#app').innerHTML =
            `<div class="shell">${this.header()}<main>${this.intro()}<div class="content-layout"><div class="workspace ${this.application.state.direction === 'decode' ? 'decode-workspace' : ''}">${this.application.state.direction === 'encode' ? this.encodeSetup() + this.encodeMain() : this.decodeSetup() + this.decodeMain()}</div></div></main><footer class="app-footer"><span>${icon('device')}All signal processing stays on your device.</span><a href="licenses.html">Engines & licenses</a></footer></div>`;
        this.paintSources();
        this.paintReceived();
    }
    /**
     * Replace a picture container with an RGBA canvas when image dimensions are valid.
     * @param {Element|null} container Picture container, when present.
     * @param {Object} picture Picture dimensions and RGBA pixels.
     */
    canvasInto(container, picture) {
        if (!container || !picture?.width || !picture?.height) return;
        container.replaceChildren(pictureCanvas(picture));
    }
    /**
     * Refresh input thumbnails, prepared pictures and recording waveforms.
     */
    paintSources() {
        if (this.application.state.picture) {
            this.canvasInto($('#source-thumbnail'), this.application.state.picture);
            if (this.application.state.direction === 'encode' && this.application.state.content === 'picture')
                try {
                    const prepared = preparePicture(
                        this.application.state.picture,
                        this.application.current(),
                        this.application.settings(),
                        this.application.state.fit
                    );
                    this.canvasInto($('#prepared-picture'), { ...prepared, pixels: prepared.preview });
                    $('#picture-meta').textContent =
                        `${prepared.width} × ${prepared.height} pixels · ${prepared.gray ? 'grayscale' : 'color'} · ${this.application.state.fit === 'fit' ? 'fit to frame' : 'cropped to frame'}`;
                } catch (e) {
                    $('#picture-meta').textContent = e.message;
                }
        }
        this.mountAudioPlayers();
    }
    /** Attach controls once per rendered player, retaining native playback during redraws. */
    mountAudioPlayers() {
        for (const [root, player] of this.audioPlayers) {
            if (!root.isConnected) {
                player.dispose();
                this.audioPlayers.delete(root);
            }
        }
        for (const root of document.querySelectorAll('.audio-player')) {
            if (this.audioPlayers.has(root)) continue;
            let samples;
            switch (root.dataset.audioKind) {
                case 'input': samples = this.application.state.audio.channels[0]; break;
                case 'output': samples = this.application.state.output.samples; break;
                case 'speech': samples = joinChunks(this.application.state.received.audio); break;
            }
            this.audioPlayers.set(root, new AudioPlayer(root, samples));
        }
    }
    /** Stop and release players before replacing their markup or revoking their URLs.
     * @param {string} kind Optional input/output/speech kind to release on its own.
     */
    disposeAudioPlayers(kind) {
        for (const [root, player] of this.audioPlayers) {
            if (kind && root.dataset.audioKind !== kind) continue;
            player.dispose();
            this.audioPlayers.delete(root);
        }
    }
    /**
     * Draw spectrum magnitudes and the current signal-center marker.
     * @param {Float32Array} values Spectrum magnitudes in input order.
     * @param {number} maxFrequency Highest displayed spectrum frequency in hertz.
     */
    drawSpectrum(values, maxFrequency = 4000) {
        const canvas = $('#spectrum');
        if (!canvas || !values?.length) return;
        values = values.subarray(
            0,
            Math.max(1, Math.min(values.length, Math.ceil((values.length * 4000) / maxFrequency)))
        );
        const w = (canvas.width = Math.max(300, canvas.clientWidth * devicePixelRatio)),
            h = (canvas.height = 150 * devicePixelRatio),
            c = canvas.getContext('2d');
        c.fillStyle = '#071c29';
        c.fillRect(0, 0, w, h);
        c.strokeStyle = '#39c7cb';
        c.lineWidth = 1.5 * devicePixelRatio;
        c.beginPath();
        let min = Math.min(...values),
            max = Math.max(...values);
        if (!Number.isFinite(min) || max === min) return;
        for (let x = 0; x < w; x++) {
            const v = values[Math.min(values.length - 1, Math.floor((x / w) * values.length))],
                y = h * (1 - ((v - min) / (max - min)) * 0.85);
            x ? c.lineTo(x, y) : c.moveTo(x, y);
        }
        c.stroke();
        const f = this.application.current();
        if (f.engine === 'fldigi') {
            const x = (this.application.settings().frequency / 4000) * w;
            c.strokeStyle = '#e8c65d';
            c.beginPath();
            c.moveTo(x, 0);
            c.lineTo(x, h);
            c.stroke();
        }
    }
    /** Draw time columns and logarithmic frequency bands with a fixed intensity color scale. */
    drawSpectrogram() {
        const canvas = $('#spectrogram');
        if (!canvas) return;
        const context = canvas.getContext('2d');
        const image = context.createImageData(Spectrogram.WIDTH, Spectrogram.HEIGHT);
        const history = this.application.state.received.spectrogram;
        const colors = [[7, 28, 41], [39, 20, 91], [117, 31, 129], [210, 57, 76], [251, 151, 50], [255, 245, 180]];
        for (let y = 0; y < Spectrogram.HEIGHT; y++) {
            for (let x = 0; x < Spectrogram.WIDTH; x++) {
                const value = history ? history.levels[y * Spectrogram.WIDTH + x] : 0;
                const level = value / 255 * (colors.length - 1);
                const low = Math.floor(level);
                const high = Math.min(colors.length - 1, low + 1);
                const blend = level - low;
                const offset = (y * Spectrogram.WIDTH + x) * 4;
                for (let channel = 0; channel < 3; channel++) {
                    image.data[offset + channel] = Math.round(colors[low][channel] * (1 - blend) + colors[high][channel] * blend);
                }
                image.data[offset + 3] = 255;
            }
        }
        context.putImageData(image, 0, 0);
        document.querySelectorAll('#spectrogram-time span').forEach((label, index) => {
            const seconds = history ? history.startSeconds + history.duration * index / 4 : 0;
            label.textContent = `${Number(seconds.toFixed(1))} s`;
        });
    }
    /** Refresh spectrum, spectrogram, synchronization and receiver diagnostics. */
    paintAnalysis() {
        const r = this.application.state.received;
        this.drawSpectrum(r.spectrum, r.spectrumMax);
        this.drawSpectrogram();
        if (r.sync) {
            const canvas = $('#sync-view');
            if (canvas) {
                canvas.hidden = false;
                canvas.width = 320;
                canvas.height = 256;
                canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(r.sync), 320, 256), 0, 0);
            }
        }
        if ($('#diagnostics'))
            $('#diagnostics').textContent = r.diagnostics
                ? JSON.stringify(r.diagnostics, null, 2)
                : 'Signal measurements appear when the selected engine provides them.';
    }
    /**
     * Refresh recovered content, history and save controls without restarting reception.
     */
    paintReceived() {
        const r = this.application.state.received;
        if (r.current) {
            const container = $('#received-picture');
            this.canvasInto(container, r.current);
            if (container?.classList.contains('received-print')) container.scrollLeft = container.scrollWidth;
        }
        const t = $('#received-text');
        if (t) t.textContent = r.text || 'Decoded messages will appear here.';
        document.querySelectorAll('[data-action="save-picture"]').forEach((b) => (b.disabled = !r.current));
        document
            .querySelectorAll('[data-action="save-text"],[data-action="copy-text"]')
            .forEach((b) => (b.disabled = !r.text));
        if ($('#decoder-status')) $('#decoder-status').textContent = r.status;
        const pictureStatus = $('#picture-status');
        if (pictureStatus && r.current) {
            let resultType = 'received picture / possibly partial';
            if (this.application.current().family === 'Hellschreiber') resultType = 'printed text';
            else if (r.current.complete) resultType = 'complete picture';
            pictureStatus.textContent = `${r.current.width} × ${r.current.height} · ${resultType}`;
        }
        const files = $('#received-files');
        if (files)
            files.innerHTML = r.files.length
                ? r.files
                      .map(
                          (f, i) =>
                              `<div class="file-result"><div>${icon('file')}<strong>${esc(f.name)}</strong><span class="hint">${f.bytes.length.toLocaleString()} bytes</span></div><button class="button" data-file-index="${i}">${icon('download')}Download</button></div>`
                      )
                      .join('')
                : `<div class="empty-state">${icon('file')}<h3>Waiting for a file</h3><p>Verified recovered files will appear here.</p></div>`;
        const repair = $('#repair-actions');
        if (repair)
            repair.innerHTML = r.bsr
                ? '<p class="hint">Some file segments are missing. Progress is retained in this session.</p><div class="result-actions"><button class="button" data-action="save-bsr">Save recovery request</button><button class="button" data-action="bsr-audio">Create request audio</button></div>'
                : '';
        const hist = $('#image-history');
        if (hist) {
            hist.replaceChildren();
            r.images.forEach((image, i) => {
                const button = document.createElement('button');
                button.className = 'history-picture';
                button.dataset.imageIndex = i;
                button.setAttribute('aria-label', `View received picture ${i + 1}`);
                button.append(pictureCanvas(image));
                hist.append(button);
            });
        }
        this.paintAnalysis();
    }
    /**
     * Build an advanced-control input from its descriptor and current value.
     * @param {Object} field Control descriptor including key, type and bounds.
     * @param {Object} s Validated format compatibility settings.
     * @param {string} prefix Prefix for the control DOM identifiers.
     */
    fieldHtml(field, s, prefix = 'setting-') {
        const id = prefix + field.key,
            value = s[field.key] ?? field.value,
            indicator = prefix === 'advanced-setting-' ? this.settingModifiedHtml(field.key, s) : '';
        if (field.type === 'checkbox')
            return this.checkboxFieldHtml(field, id, value, indicator);
        return `<div class="setting-field"><label class="field-label" for="${id}">${esc(field.label)}${indicator}</label>${this.settingControlHtml(field, id, value)}${field.help ? `<p class="hint">${esc(field.help)}</p>` : ''}</div>`;
    }
    /** Build a setting indicator using the selected format's own defaults.
     * @param {string} key Saved setting key.
     * @param {Object} settings Current format settings.
     * @returns {string} Indicator hidden until the setting differs from its default.
     */
    settingModifiedHtml(key, settings) {
        const changed = settings[key] !== defaultsFor(this.application.current())[key];
        return `<span class="setting-modified" data-modified-setting="${esc(key)}" ${changed ? '' : 'hidden'}>Modified</span>`;
    }
    /** Build a checkbox field and its optional help text.
     * @param {Object} field Control descriptor.
     * @param {string} id Control DOM identifier.
     * @param {*} value Current setting value.
     * @param {string} indicator Optional modification indicator markup.
     * @returns {string} Checkbox markup.
     */
    checkboxFieldHtml(field, id, value, indicator = '') {
        return `<label class="switch-row" for="${id}"><input id="${id}" data-setting="${field.key}" type="checkbox" class="switch" ${value ? 'checked' : ''} ${this.disabled()}><span>${esc(field.label)}${indicator}${field.help ? `<small>${esc(field.help)}</small>` : ''}</span></label>`;
    }
    /** Build a select or scalar input for a setting descriptor.
     * @param {Object} field Control descriptor.
     * @param {string} id Control DOM identifier.
     * @param {*} value Current setting value.
     * @returns {string} Setting control markup.
     */
    settingControlHtml(field, id, value) {
        if (field.type === 'select')
            return `<div class="select-wrap"><select id="${id}" data-setting="${field.key}" ${this.disabled()}>${this.optionsHtml(field.choices, value)}</select>${icon('down')}</div>`;
        return `<input id="${id}" data-setting="${field.key}" type="${field.type}" value="${esc(value)}" ${this.numberBounds(field)} ${this.disabled()}>`;
    }
    /** Build numeric bounds when the setting uses a number input.
     * @param {Object} field Control descriptor.
     * @returns {string} Numeric input attributes or an empty string.
     */
    numberBounds(field) {
        if (field.type !== 'number') return '';
        return `min="${field.min}" max="${field.max}" step="${field.step || 1}"`;
    }
    /** Refresh format search results and selected variant details. */
    paintFormats() {
        const all = this.application.state.formats.filter(
            (f) =>
                (this.application.state.direction === 'encode'
                    ? f.inputs.includes(this.application.state.chooserContent)
                    : f.outputs.includes(this.application.state.chooserContent)) &&
                matchesFormat(f, this.application.state.search)
        );
        const groups = formatGroups(all, this.application.state.chooserContent, this.application.state.direction);
        const rows = this.application.state.chooserAll
            ? groups.flatMap((group) => group.formats).map((f) => ({
                  id: f.id,
                  name: this.formatOptionName(f),
                  summary: describe(f).title,
                  formats: [f]
              }))
            : groups;
        const f = all.find((f) => f.id === this.application.state.candidate) || rows[0]?.formats[0];
        if (f) this.application.state.candidate = f.id;
        $('#format-list').innerHTML = rows.length
            ? rows
                  .map(
                      (g) =>
                          `<button class="format-option ${g.formats.some((f) => f.id === this.application.state.candidate) ? 'active' : ''}" data-candidate="${g.formats[0].id}">${icon(this.contentIcon(this.application.state.chooserContent))}<span><strong>${esc(g.name)}</strong><small>${esc(g.summary)} · ${g.formats.length} variant${g.formats.length === 1 ? '' : 's'}</small></span>${icon('right')}</button>`
                  )
                  .join('')
            : '<p class="hint">No compatible formats match this search.</p>';
        if (!f) {
            $('#format-detail').innerHTML = '';
            return;
        }
        const group = groups.find((g) => g.id === this.groupId(f));
        $('#format-detail').innerHTML =
            `<div class="format-emblem">${icon(this.application.state.chooserContent)}</div><h3>${esc(describe(f).title)}</h3><p class="chip">${esc(f.family)}</p><p>${esc(describe(f).description)}</p>${this.selectHtml(
                'candidate-variant',
                'Choose a variant',
                (group?.formats || [f]).map((f) => [f.id, this.formatOptionName(f)]),
                f.id
            )}<p class="hint">${this.formatSupportHint(f)}</p><div class="modal-actions"><button class="button primary" data-action="use-format">Use this format</button><button class="button" data-action="close">Cancel</button></div>`;
    }
    /** Describe whether a format is disabled, encodable or receive-only.
     * @param {Object} format Selected catalog entry.
     * @returns {string} Format capability hint.
     */
    formatSupportHint(format) {
        if (format.disabled) return 'This sensor protocol is normally disabled; selecting it explicitly enables it.';
        if (!format.inputs.length) return 'Receive only.';
        return 'Supports ' + format.inputs.map((content) => this.application.contentNames[content].toLowerCase()).join(', ') + ' encoding.';
    }
    /** Return the disabled attribute while an operation is active. */
    disabled() {
        return this.application.state.busy ? 'disabled' : '';
    }
}
