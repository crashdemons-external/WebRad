/** Mutable session state; persisted format controls retain their established schema. */
export class ApplicationState {
    /** Active encode/decode workflow. */
    direction;
    /** Selected content type: text, picture, file, voice or sensor. */
    content;
    /** Stable identifier of the selected catalog variant. */
    formatId;
    /** Native capabilities expanded into user-facing variants. */
    formats;
    /** Validated controls keyed by stable format identifier. */
    settings;
    /** Whether preferences may be saved beyond the current page. */
    storeSettings;
    /** Current message input or retained receiver text. */
    text;
    /** Picture preparation mode: fit or crop. */
    fit;
    /** Loaded source picture and RGBA pixels. */
    picture;
    /** Loaded transfer filename and bytes. */
    file;
    /** Loaded recording, channels and sample-rate metadata. */
    audio;
    /** Loaded raw-radio or pulse-data filename and bytes. */
    sensor;
    /** Recording or live-audio input choice. */
    source;
    /** Whether an encode/decode operation currently owns the controls. */
    busy;
    /** Monotonic operation token used to discard canceled asynchronous results. */
    job;
    /** Displayed operation completion percentage. */
    progress;
    /** Plain-language processing status. */
    status;
    /** Current recoverable workflow error message. */
    error;
    /** Retained encoded audio/file and download metadata. */
    output;
    /** Recovered text, pictures, files, speech blocks and receiver diagnostics. */
    received;
    /** Variant currently highlighted in the format explorer. */
    candidate;
    /** Format explorer search text. */
    search;
    /** Content filter used by the format explorer. */
    chooserContent;
    /** Whether the explorer displays all compatible families. */
    chooserAll;
    /** Active microphone stream, audio graph and pending worker queue. */
    live;
    /** Operation token waiting for microphone permission. */
    permissionJob;
    /** Enumerated audio input choices. */
    inputDevices;
    /** Saved microphone device identifier. */
    liveDevice;
    /** Whether live input monitoring is enabled. */
    monitor;
    /** Initialize workflow defaults from the URL query.
     * @param {URLSearchParams} q Initial workflow/panel query.
     */
    constructor(q) {
        this.direction = q.get('view') === 'decode' ? 'decode' : 'encode';
        this.content = 'text';
        this.formatId = '';
        this.formats = [];
        this.settings = {};
        this.storeSettings = true;
        this.text = '';
        this.fit = 'fit';
        this.picture = null;
        this.file = null;
        this.audio = null;
        this.sensor = null;
        this.source = 'recording';
        this.busy = false;
        this.job = 0;
        this.progress = 0;
        this.status = 'Choose your content to get started.';
        this.error = '';
        this.output = null;
        this.received = {
            text: '',
            images: [],
            files: [],
            audio: [],
            rate: 8000,
            current: null,
            bsr: '',
            status: ''
        };
        this.candidate = '';
        this.search = '';
        this.chooserContent = 'text';
        this.chooserAll = false;
        this.live = null;
        this.permissionJob = null;
        this.inputDevices = [];
        this.liveDevice = 'default';
        this.monitor = false;
    }
}
