import { icon } from './icons.js';
import { esc } from './dom.js';
import { timeLabel } from './audio.js';

/** Compact waveform controls backed by a native audio element. */
export class AudioPlayer {
    /** Player container and its playback element. */
    root;
    /** Native media element, also used by paced decoding. */
    audio;
    /** PCM samples retained by the application, without taking ownership. */
    samples;
    /** Listener lifetime for this rendered player. */
    controller;
    /** Observer keeping the waveform sharp as its container changes size. */
    observer;
    /** Pending animation frame while playing. */
    frame;
    /** Duration from decoded samples, available before media metadata loads. */
    duration;
    /** Accessible native seek slider over the waveform. */
    seek;
    /** Play/pause button. */
    playButton;
    /** Secondary playback and download controls. */
    menu;
    /** Playback time display. */
    time;

    /** Build a single audio unit; names and metadata are escaped as plain text.
     * @param {Object} options Media URL, name, duration, specs and input/output kind.
     * @returns {string} Player markup with a hidden native audio element.
     */
    static html({ kind, url, name, duration, specs, disabled = false }) {
        const id = `${kind}-player`;
        const safeName = esc(name);
        const downloadName = esc(name.replace(/[\/\\\x00-\x1f]/g, '_'));
        const trackName = kind === 'input'
            ? `<button type="button" class="audio-player-name" data-action="upload-audio" title="Replace recording: ${safeName}" ${disabled ? 'disabled' : ''}>${safeName}</button>`
            : `<a class="audio-player-name" href="${esc(url)}" download="${downloadName}" title="Download audio: ${safeName}">${safeName}</a>`;
        const trackAction = kind === 'input'
            ? `<button type="button" class="audio-player-action" data-action="clear-audio" aria-label="Clear recording" title="Clear recording" ${disabled ? 'disabled' : ''}>${icon('close')}</button>`
            : `<a class="audio-player-action" href="${esc(url)}" download="${downloadName}" aria-label="Download audio" title="Download audio">${icon('download')}</a>`;
        return `<div class="audio-player" data-audio-kind="${kind}" data-duration="${duration}" role="group" aria-label="${safeName}">
            <audio id="${id}" preload="metadata" src="${esc(url)}" aria-label="${safeName}" hidden></audio>
            <div class="audio-player-header">${icon('file')}${trackName}${trackAction}
                <details class="audio-player-options"><summary aria-label="Audio options for ${safeName}" title="Audio options">${icon('more')}</summary>
                    <div class="audio-player-menu">
                        <div class="audio-volume-row"><button type="button" data-audio-action="mute" aria-label="Mute" title="Mute">${icon('volume')}</button><label class="audio-volume-label">Volume<input class="audio-volume" type="range" min="0" max="1" step="0.01" value="1"></label></div>
                        <label class="audio-speed-label">Playback speed<select class="audio-speed"><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1" selected>1× (normal)</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label>
                        <a class="audio-menu-action" href="${esc(url)}" download="${downloadName}">${icon('download')}Download audio</a>
                        ${kind === 'input' ? `<button type="button" class="audio-menu-action" data-action="upload-audio" ${disabled ? 'disabled' : ''}>${icon('file')}Replace recording</button>` : ''}
                    </div>
                </details>
            </div>
            <div class="audio-player-transport"><button type="button" class="audio-play" data-audio-action="play" aria-label="Play ${safeName}" title="Play">${icon('play')}</button>
                <div class="audio-timeline"><canvas class="audio-wave" aria-hidden="true"></canvas><canvas class="audio-wave audio-wave-played" aria-hidden="true"></canvas><span class="audio-playhead" aria-hidden="true"></span><input class="audio-seek" type="range" min="0" max="${duration}" step="0.01" value="0" aria-label="Playback position for ${safeName}" aria-valuetext="0:00 of ${timeLabel(duration)}"></div>
                <span class="audio-time">0:00 / ${timeLabel(duration)}</span>
            </div>
            <p class="audio-specs">${esc(specs)}</p><p class="audio-playback-error" role="status" hidden></p>
        </div>`;
    }

    /** Connect controls to native media events and draw the initial waveform.
     * @param {HTMLElement} root Rendered player container.
     * @param {Float32Array} samples Decoded PCM used for the waveform.
     */
    constructor(root, samples) {
        this.root = root;
        this.audio = root.querySelector('audio');
        this.samples = samples;
        this.duration = Number(root.dataset.duration) || 0;
        this.controller = new AbortController();
        this.frame = 0;
        this.seek = root.querySelector('.audio-seek');
        this.playButton = root.querySelector('.audio-play');
        this.menu = root.querySelector('details');
        this.time = root.querySelector('.audio-time');
        const options = { signal: this.controller.signal };
        root.addEventListener('click', (event) => this.handleClick(event), options);
        root.addEventListener('input', (event) => this.handleInput(event), options);
        root.addEventListener('change', (event) => this.handleInput(event), options);
        root.addEventListener('keydown', (event) => this.handleKeydown(event), options);
        root.ownerDocument.addEventListener('click', (event) => {
            if (!event.composedPath().includes(this.menu)) this.menu.open = false;
        }, options);
        for (const name of ['play', 'pause', 'ended', 'timeupdate', 'loadedmetadata', 'durationchange', 'seeked', 'volumechange', 'ratechange']) {
            this.audio.addEventListener(name, () => this.update(), options);
        }
        this.audio.addEventListener('error', () => this.showError('This recording cannot be played by your browser.'), options);
        this.observer = new ResizeObserver(() => this.drawWave());
        this.observer.observe(root.querySelector('.audio-timeline'));
        this.drawWave();
        this.update();
    }

    /** Toggle native playback or mute from a player button. */
    async handleClick(event) {
        const action = event.target.closest('[data-audio-action]')?.dataset.audioAction;
        if (action === 'mute') {
            if (this.audio.volume === 0) {
                this.audio.volume = 1;
                this.audio.muted = false;
            } else {
                this.audio.muted = !this.audio.muted;
            }
            this.update();
        }
        if (action !== 'play') return;
        if (!this.audio.paused) {
            this.audio.pause();
            return;
        }
        const error = this.root.querySelector('.audio-playback-error');
        error.hidden = true;
        try {
            if (this.audio.ended) this.audio.currentTime = 0;
            await this.audio.play();
            if (this.controller.signal.aborted) this.audio.pause();
        } catch (error) {
            if (!this.controller.signal.aborted) this.showError(`Unable to play audio: ${error.message}`);
        }
    }

    /** Apply native range and select changes, including keyboard seeking. */
    handleInput(event) {
        const control = event.target;
        if (control === this.seek) {
            try {
                this.audio.currentTime = Math.max(0, Math.min(this.duration, Number(control.value)));
            } catch (error) {
                this.showError(`Unable to seek: ${error.message}`);
            }
        } else if (control.matches('.audio-volume')) {
            this.audio.volume = Number(control.value);
            this.audio.muted = false;
        } else if (control.matches('.audio-speed')) {
            this.audio.playbackRate = Number(control.value);
        }
        this.update();
    }

    /** Seek with arrow/Home/End keys and dismiss options with Escape. */
    handleKeydown(event) {
        if (event.target === this.seek && event.key !== 'Escape') {
            let position = this.audio.currentTime;
            switch (event.key) {
                case 'ArrowLeft':
                case 'ArrowDown': position -= 5; break;
                case 'ArrowRight':
                case 'ArrowUp': position += 5; break;
                case 'Home': position = 0; break;
                case 'End': position = this.duration; break;
                default: return;
            }
            event.preventDefault();
            this.seek.value = Math.max(0, Math.min(this.duration, position));
            this.handleInput({ target: this.seek });
            return;
        }
        if (event.key !== 'Escape' || !this.menu.open) return;
        event.preventDefault();
        this.menu.open = false;
        this.menu.querySelector('summary').focus();
    }

    /** Synchronize controls when either the user or decoder changes native playback. */
    update() {
        cancelAnimationFrame(this.frame);
        if (Number.isFinite(this.audio.duration) && this.audio.duration > 0) this.duration = this.audio.duration;
        const playing = !this.audio.paused && !this.audio.ended;
        const buttonIcon = playing ? 'pause' : 'play';
        if (this.playButton.dataset.icon !== buttonIcon) {
            this.playButton.innerHTML = icon(buttonIcon);
            this.playButton.dataset.icon = buttonIcon;
        }
        this.playButton.setAttribute('aria-label', `${playing ? 'Pause' : 'Play'} ${this.root.querySelector('.audio-player-name').textContent}`);
        this.playButton.title = playing ? 'Pause' : 'Play';
        this.seek.disabled = !this.duration;
        this.updatePosition();
        const muted = this.audio.muted || this.audio.volume === 0;
        const muteButton = this.root.querySelector('[data-audio-action="mute"]');
        muteButton.innerHTML = icon(muted ? 'muted' : 'volume');
        muteButton.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
        muteButton.title = muted ? 'Unmute' : 'Mute';
        const volume = this.root.querySelector('.audio-volume');
        const audibleVolume = this.audio.muted ? 0 : this.audio.volume;
        volume.value = audibleVolume;
        volume.style.setProperty('--fill', `${audibleVolume * 100}%`);
        this.root.querySelector('.audio-speed').value = this.audio.playbackRate;
        if (playing) this.frame = requestAnimationFrame(() => this.animate());
    }

    /** Move the playhead and accessible seek position without redrawing the PCM waveform. */
    updatePosition() {
        const position = Math.min(this.duration, Math.max(0, this.audio.currentTime || 0));
        const progress = this.duration ? position / this.duration : 0;
        this.seek.max = this.duration;
        this.seek.value = position;
        this.seek.setAttribute('aria-valuetext', `${timeLabel(position)} of ${timeLabel(this.duration)}`);
        this.time.textContent = `${timeLabel(position)} / ${timeLabel(this.duration)}`;
        this.root.style.setProperty('--audio-progress', `${progress * 100}%`);
    }

    /** Follow native playback smoothly between media timeupdate events. */
    animate() {
        if (this.controller.signal.aborted || this.audio.paused || this.audio.ended) return;
        this.updatePosition();
        this.frame = requestAnimationFrame(() => this.animate());
    }

    /** Draw pale and played waveforms once per resize; playback only changes their clipping. */
    drawWave() {
        if (!this.samples?.length) return;
        const timeline = this.root.querySelector('.audio-timeline');
        const ratio = globalThis.devicePixelRatio || 1;
        const width = Math.max(1, Math.round(timeline.clientWidth * ratio));
        const height = Math.round(timeline.clientHeight * ratio);
        const canvases = this.root.querySelectorAll('.audio-wave');
        for (const [index, canvas] of Array.from(canvases).entries()) {
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext('2d');
            context.strokeStyle = index ? '#098596' : '#b6c9d9';
            context.lineWidth = Math.max(1, 1.5 * ratio);
            context.lineCap = 'round';
            for (let x = 0; x < width; x += 3 * ratio) {
                const start = Math.floor(x / width * this.samples.length);
                const end = Math.min(this.samples.length, Math.max(start + 1, Math.floor((x + 3 * ratio) / width * this.samples.length)));
                let low = 0;
                let high = 0;
                for (let i = start; i < end; i += Math.max(1, Math.floor((end - start) / 100))) {
                    low = Math.min(low, this.samples[i]);
                    high = Math.max(high, this.samples[i]);
                }
                context.beginPath();
                context.moveTo(x, height * (0.5 - low * 0.44) + ratio / 2);
                context.lineTo(x, height * (0.5 - high * 0.44) - ratio / 2);
                context.stroke();
            }
        }
    }

    /** Report playback failure without interrupting decoding or download access. */
    showError(message) {
        const error = this.root.querySelector('.audio-playback-error');
        error.textContent = message;
        error.hidden = false;
        this.update();
    }

    /** Stop playback and release observers and listeners before replacing the view. */
    dispose() {
        this.controller.abort();
        cancelAnimationFrame(this.frame);
        this.observer.disconnect();
        this.audio.pause();
    }
}
