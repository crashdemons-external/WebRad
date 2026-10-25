import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioPlayer } from '../src/app/audio-player.js';
import { ApplicationView } from '../src/app/application-view.js';

function createPlayer(t) {
    const previous = {
        ResizeObserver: globalThis.ResizeObserver,
        requestAnimationFrame: globalThis.requestAnimationFrame,
        cancelAnimationFrame: globalThis.cancelAnimationFrame
    };
    let frame;
    let disconnected = false;
    globalThis.ResizeObserver = class {
        observe() {}
        disconnect() { disconnected = true; }
    };
    globalThis.requestAnimationFrame = (callback) => { frame = callback; return 1; };
    globalThis.cancelAnimationFrame = () => { frame = undefined; };
    t.after(() => Object.assign(globalThis, previous));
    const element = (value = '') => Object.assign(new EventTarget(), {
        value, dataset: {}, attributes: {}, textContent: '', hidden: false,
        setAttribute(name, value) { this.attributes[name] = value; },
        matches() { return false; }
    });
    const audio = Object.assign(element(), {
        currentTime: 0, duration: 12, paused: true, ended: false,
        volume: 1, muted: false, playbackRate: 1,
        async play() { this.paused = false; this.dispatchEvent(new Event('play')); },
        pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
    });
    const menu = Object.assign(element(), {
        open: false,
        contains: () => false,
        querySelector: () => ({ focus() { menu.focused = true; } })
    });
    const controls = {
        audio,
        '.audio-seek': element('0'),
        '.audio-play': element(),
        details: menu,
        '.audio-time': element(),
        '.audio-player-name': Object.assign(element(), { textContent: 'test.wav' }),
        '.audio-volume': element('1'),
        '.audio-speed': element('1'),
        '[data-audio-action="mute"]': element(),
        '.audio-playback-error': Object.assign(element(), { hidden: true }),
        '.audio-timeline': { clientWidth: 160, clientHeight: 42 }
    };
    controls['.audio-volume'].matches = (selector) => selector === '.audio-volume';
    controls['.audio-volume'].style = {
        setProperty(name, value) { this[name] = value; }
    };
    controls['.audio-speed'].matches = (selector) => selector === '.audio-speed';
    const root = Object.assign(element(), {
        dataset: { duration: '12' },
        ownerDocument: new EventTarget(),
        style: { setProperty(name, value) { this[name] = value; } },
        querySelector: (selector) => controls[selector],
        querySelectorAll: () => []
    });
    const player = new AudioPlayer(root, new Float32Array());
    const click = (action) => player.handleClick({
        target: { closest: () => ({ dataset: { audioAction: action } }) }
    });
    return { player, audio, root, controls, click, menu, frame: () => frame, disconnected: () => disconnected };
}

test('input and output players share one timeline and escape filenames, specs and downloads', () => {
    for (const kind of ['input', 'output', 'speech']) {
        const html = AudioPlayer.html({ kind, url: 'blob:test', name: '<voice>".wav', duration: 12, specs: 'mono & PCM' });
        assert.match(html, /&lt;voice&gt;&quot;\.wav/);
        assert.match(html, /mono &amp; PCM/);
        assert.match(html, /download="&lt;voice&gt;&quot;\.wav"/);
        assert.match(html, new RegExp(`id="${kind}-player"`));
        assert.match(html, /<audio[^>]+hidden>/);
        assert.doesNotMatch(html, /<audio[^>]+controls/);
        assert.equal((html.match(/class="audio-seek"/g) || []).length, 1);
        assert.equal(html.includes('Replace recording'), kind === 'input');
        assert.ok(html.indexOf('audio-specs') > html.indexOf('audio-timeline'));
    }
});

test('native playback events and animation keep progress, time and play/pause state in sync', async (t) => {
    const { player, audio, root, controls, click, frame } = createPlayer(t);
    await click('play');
    assert.match(player.playButton.attributes['aria-label'], /^Pause/);
    audio.currentTime = 4;
    frame()();
    assert.equal(controls['.audio-seek'].value, 4);
    assert.equal(controls['.audio-time'].textContent, '0:04 / 0:12');
    assert.equal(controls['.audio-seek'].attributes['aria-valuetext'], '0:04 of 0:12');
    assert.ok(root.style['--audio-progress'].startsWith('33.33'));
    audio.pause();
    assert.match(player.playButton.attributes['aria-label'], /^Play/);
    assert.equal(frame(), undefined);
    player.dispose();
});

test('seeking uses native playback time and keyboard navigation clamps to recording bounds', (t) => {
    const { player, audio } = createPlayer(t);
    const key = (value) => player.handleKeydown({ target: player.seek, key: value, preventDefault() {} });
    player.seek.value = '3.25';
    player.handleInput({ target: player.seek });
    assert.equal(audio.currentTime, 3.25);
    key('ArrowRight');
    assert.equal(audio.currentTime, 8.25);
    key('ArrowRight');
    assert.equal(audio.currentTime, 12);
    key('Home');
    key('ArrowLeft');
    assert.equal(audio.currentTime, 0);
    key('End');
    assert.equal(audio.currentTime, 12);
    player.dispose();
});

test('volume, mute, speed, menu dismissal and disposal remain independent of decoding', async (t) => {
    const { player, audio, root, controls, click, menu, disconnected, frame } = createPlayer(t);
    assert.equal(controls['.audio-volume'].style['--fill'], '100%');
    controls['.audio-volume'].value = '0.35';
    player.handleInput({ target: controls['.audio-volume'] });
    assert.equal(audio.volume, 0.35);
    assert.equal(controls['.audio-volume'].style['--fill'], '35%');
    await click('mute');
    assert.equal(audio.muted, true);
    assert.equal(controls['.audio-volume'].style['--fill'], '0%');
    await click('mute');
    assert.equal(audio.volume, 0.35);
    assert.equal(audio.muted, false);
    assert.equal(controls['.audio-volume'].style['--fill'], '35%');
    audio.volume = 0;
    await click('mute');
    assert.equal(audio.volume, 1);
    assert.equal(audio.muted, false);
    controls['.audio-speed'].value = '1.5';
    player.handleInput({ target: controls['.audio-speed'] });
    assert.equal(audio.playbackRate, 1.5);
    menu.open = true;
    root.ownerDocument.dispatchEvent(Object.assign(new Event('click'), { composedPath: () => [menu, root] }));
    assert.equal(menu.open, true, 'changing an icon inside the menu must not close it');
    root.ownerDocument.dispatchEvent(new Event('click'));
    assert.equal(menu.open, false);
    menu.open = true;
    player.handleKeydown({ key: 'Escape', preventDefault() {} });
    assert.equal(menu.open, false);
    assert.equal(menu.focused, true);
    await click('play');
    player.dispose();
    assert.equal(audio.paused, true);
    assert.equal(disconnected(), true);
    assert.equal(frame(), undefined);
    assert.equal(player.controller.signal.aborted, true);
});

test('play rejection is visible and delayed playback cannot restart a disposed player', async (t) => {
    const { player, audio, controls, click } = createPlayer(t);
    audio.play = async () => { throw Error('Unsupported media'); };
    await click('play');
    assert.equal(controls['.audio-playback-error'].hidden, false);
    assert.match(controls['.audio-playback-error'].textContent, /Unsupported media/);
    let finish;
    audio.play = () => new Promise((resolve) => { finish = () => { audio.paused = false; resolve(); }; });
    const pending = click('play');
    player.dispose();
    finish();
    await pending;
    assert.equal(audio.paused, true);
});

test('view uses the compact player for speech input, generated WAV and recovered speech while retaining C2 downloads', () => {
    const audio = { name: 'speech.mp3', url: 'blob:input', duration: 12, rate: 48000, channels: [new Float32Array(4)] };
    const view = new ApplicationView({ state: { audio, busy: true } });
    assert.match(view.voiceInputCard(), /data-audio-kind="input"/);
    assert.match(view.recordingDetails(), /data-action="upload-audio" disabled/);
    assert.match(view.outputAudioPreview({ name: 'test.wav', url: 'blob:output', samples: new Float32Array(16), rate: 8000 }), /data-audio-kind="output"/);
    assert.match(view.receivedVoiceHtml({ voiceUrl: 'blob:speech', audio: [new Float32Array(16)], rate: 8000 }), /data-audio-kind="speech"/);
    assert.doesNotMatch(view.outputActions({ url: 'blob:output' }), /data-action="download"/);
    assert.match(view.outputActions({ file: {} }), /Download C2/);
});
