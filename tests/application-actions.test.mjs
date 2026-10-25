import test from 'node:test';
import assert from 'node:assert/strict';
import { WebRadApplication } from '../src/app/application.js';
import { makeWav, parseWav } from '../src/app/audio.js';
import { readFile } from 'node:fs/promises';

function createApplication() {
    const previousLocation = globalThis.location;
    globalThis.location = { search: '' };
    const application = new WebRadApplication();
    if (previousLocation === undefined) delete globalThis.location;
    else globalThis.location = previousLocation;
    application.state.job = 1;
    application.state.content = 'text';
    application.state.text = 'test message';
    application.state.output = null;
    application.current = () => ({ id: 'test', engine: 'test', name: 'Test', outputs: ['text'] });
    application.settings = () => ({});
    application.runOperation = async (_label, operation) => operation(1);
    return application;
}

test('recovered HAMDRM .jpe attachments render a picture and retain the downloadable file', async t => {
    const previousImage = globalThis.Image;
    const previousDocument = globalThis.document;
    globalThis.Image = class {
        naturalWidth = 2;
        naturalHeight = 1;
        set src(value) {
            assert.match(value, /^blob:/);
            queueMicrotask(() => this.onload());
        }
    };
    const pixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]);
    globalThis.document = {
        createElement: () => ({
            getContext: () => ({ drawImage() {}, getImageData: () => ({ data: pixels }) })
        })
    };
    t.after(() => {
        if (previousImage === undefined) delete globalThis.Image;
        else globalThis.Image = previousImage;
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    });
    const application = createApplication();
    application.state.content = 'picture';
    let painted = 0;
    application.view.paintReceived = () => painted++;
    const file = { name: 'chart.JPE', bytes: new Uint8Array([255, 216, 255, 224]) };

    application.receiveFile(file);
    await Promise.all(application.pictureTasks);

    assert.deepEqual(application.state.received.files, [file]);
    assert.equal(application.state.received.current.complete, true);
    assert.equal(application.state.received.current.width, 2);
    assert.equal(application.state.received.current.height, 1);
    assert.deepEqual(application.state.received.current.pixels, pixels);
    assert.equal(application.state.received.images.length, 1);
    assert.equal(painted, 1);

    application.state.content = 'file';
    application.receiveFile(file);
    assert.equal(application.pictureTasks.size, 0);
    assert.equal(painted, 1, 'file-only reception does not create a picture preview');
});

test('modem picture correction uses its own phase and clock controls without repeating text', async () => {
    const application = createApplication();
    application.current = () => ({ engine: 'fldigi', family: 'FSQ' });
    application.settings = () => ({ picturePhasePixels: 54, pictureSlantPpm: -125, phasePixels: 999, slantPpm: 999 });
    application.state.received.current = { width: 2, height: 1, pixels: new Uint8ClampedArray(8) };
    const calls = [];
    application.decodeHost = {
        call: async (action, options) => {
            calls.push({ action, options });
            return { width: 2, height: 1, pixels: new Uint8ClampedArray(8) };
        }
    };
    application.consume = result => calls.push({ result });
    application.view.paintReceived = () => calls.push('paint');
    await application.performResultAction('redraw');
    assert.deepEqual(calls[0], { action: 'redraw', options: { phase: 54, ppm: -125 } });
    assert.equal(calls[1].result.text, undefined);
    assert.equal(calls[2], 'paint');
});

test('testing generated audio and returning to encode retains playback and download output', async (t) => {
    const application = createApplication();
    const previousDocument = globalThis.document;
    globalThis.document = { querySelector: () => null };
    t.after(() => {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    });
    application.state.formats = JSON.parse(await readFile(new URL('../build/out/formats.json', import.meta.url))).formats;
    const format = application.state.formats.find((entry) => entry.nativeName === 'CW');
    application.state.formatId = format.id;
    application.persist = () => {};
    application.view.render = () => {};
    application.decode = async () => {};
    const samples = new Float32Array(800);
    samples.set([1, 0.2, -0.2]);
    const wav = makeWav(samples, 8000);
    const blob = new Blob([wav], { type: 'audio/wav' });
    const output = {
        format, settings: {}, blob, url: URL.createObjectURL(blob),
        samples, rate: 8000, name: 'message.wav'
    };
    application.state.output = output;
    try {
        await application.testOutput();
        assert.deepEqual(application.state.audio.channels[0], parseWav(wav.buffer).channels[0]);
        assert.notEqual(application.state.audio.channels[0][0], samples[0], 'loopback uses the quantized recording');
        assert.equal(application.state.output, output);
        application.invalidate();
        assert.equal(application.state.output, output, 'receiver changes retain generated audio');
        application.changeDirection('encode');
        assert.equal(application.state.output, output);
        assert.match(application.view.audioResult(), /message.wav/);
        application.invalidate();
        assert.equal(application.state.output, null, 'encoder input changes discard stale output');
    } finally {
        URL.revokeObjectURL(output.url);
        URL.revokeObjectURL(application.state.audio.url);
    }
});

test('loopback discards a recording whose encoder output changed while it was being read', async () => {
    const application = createApplication();
    const blob = new Blob([makeWav(new Float32Array([1]), 8000)], { type: 'audio/wav' });
    application.state.output = { blob, name: 'replaced.wav' };
    let decoded = false;
    application.decode = async () => { decoded = true; };

    const loopback = application.testOutput();
    application.state.output = null;
    await loopback;

    assert.equal(application.state.direction, 'encode');
    assert.equal(application.state.audio, null);
    assert.equal(decoded, false);
});

test('loopback respects newer navigation that preserves the generated recording', async () => {
    const application = createApplication();
    const blob = new Blob([makeWav(new Float32Array([1]), 8000)], { type: 'audio/wav' });
    const output = { blob, name: 'retained.wav' };
    application.state.output = output;
    application.view.render = () => {};
    let decoded = false;
    application.decode = async () => { decoded = true; };

    const loopback = application.testOutput();
    application.changeDirection('decode');
    await loopback;

    assert.equal(application.state.output, output);
    assert.equal(application.state.direction, 'decode');
    assert.equal(application.state.audio, null);
    assert.equal(decoded, false);
});

test('loopback respects an intervening operation even after it has finished', async () => {
    const application = createApplication();
    const blob = new Blob([makeWav(new Float32Array([1]), 8000)], { type: 'audio/wav' });
    application.state.output = { blob, name: 'retained.wav' };
    let decoded = false;
    application.decode = async () => { decoded = true; };

    const loopback = application.testOutput();
    application.state.job++;
    application.state.busy = false;
    await loopback;

    assert.equal(application.state.direction, 'encode');
    assert.equal(application.state.audio, null);
    assert.equal(decoded, false);
});

test('returning from an incompatible receiver preserves generated output during default format selection', async () => {
    const application = createApplication();
    application.state.formats = JSON.parse(await readFile(new URL('../build/out/formats.json', import.meta.url))).formats;
    application.state.content = 'picture';
    application.state.direction = 'decode';
    application.state.formatId = 'pictures-auto';
    const output = { name: 'retained.wav' };
    application.state.output = output;
    application.persist = () => {};
    application.view.render = () => {};
    application.changeDirection('encode');
    assert.equal(application.state.output, output);
    assert.notEqual(application.state.formatId, 'pictures-auto');
});

test('generated filenames omit generic format tags and normalize hyphens across the full stem', () => {
    const application = createApplication();
    const format = { name: 'Morse · 18 words/minute (usual)' };
    assert.equal(application.generatedOutputName('webrad-message', format), 'webrad-message-morse-18-wpm.wav');
    assert.equal(application.generatedOutputName('picture.png', { name: '(FSQ)' }, {}), 'picture-repair-fsq.wav');
    assert.equal(application.generatedOutputName('speech.wav', { name: 'Codec2 700C', codec: true }), 'speech-codec2-700c.c2');
    for (const tag of ['usual', 'default', 'standard', 'recommended', 'slower', 'long tones']) {
        assert.equal(application.generatedOutputName('keys', { name: `Keypad tones · 100 ms / 100 ms (${tag})` }), 'keys-keypad-tones-100-ms-100-ms.wav');
    }
    assert.equal(application.generatedOutputName('--my--picture--.png', { name: '--FSQ--' }, {}), 'my-picture-repair-fsq.wav');
    assert.equal(application.generatedOutputName('--speech--.wav', { name: '--Codec2--700C--', codec: true }), 'speech-codec2-700c.c2');
    assert.equal(application.generatedOutputName('--picture--.png', { name: '(Usual)' }), 'picture.wav');
    assert.equal(application.generatedOutputName('--.png', { name: '(usual)' }), 'webrad-audio.wav');
    assert.equal(application.generatedOutputName('usual-message.txt', { name: 'Mode (FSK)' }), 'usual-message-mode-fsk.wav');
});

test('generated filenames abbreviate familiar rate units while keeping other terms spelled out', () => {
    const application = createApplication();
    for (const unit of ['words per minute', 'Words / Minute', 'words-per-minute', 'WPM']) {
        assert.equal(application.generatedOutputName('--message--.txt', { name: `Morse · 18 ${unit} (usual)` }), 'message-morse-18-wpm.wav');
    }
    for (const unit of ['beats per minute', 'Beats / Minute', 'beats-per-minute', 'BPM']) {
        assert.equal(application.generatedOutputName('rhythm', { name: `Tempo · 120 ${unit}` }), 'rhythm-tempo-120-bpm.wav');
    }
    assert.equal(application.generatedOutputName('message', { name: 'Mode · 3 symbols per second' }), 'message-mode-3-symbols-per-second.wav');
    assert.equal(application.generatedOutputName('words-per-minute.txt', { name: 'Morse · 18 words/minute' }), 'words-per-minute-morse-18-wpm.wav');
});

test('switching content selects its default mode even when the previous mode is compatible', async (t) => {
    const application = createApplication();
    delete application.current;
    delete application.settings;
    const previousDocument = globalThis.document;
    globalThis.document = { querySelector: () => null };
    t.after(() => {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    });
    application.state.formats = JSON.parse(await readFile(new URL('../build/out/formats.json', import.meta.url))).formats;
    application.persist = () => {};
    application.view.render = () => {};
    const clickContent = async (content) => {
        const element = { dataset: { content } };
        await application.handleApplicationClick({ target: { closest: () => element } });
        assert.equal(application.state.error, '');
    };
    const hamdrm = application.state.formats.find((format) => format.nativeName === 'HAMDRM');
    application.state.content = 'file';
    application.state.formatId = hamdrm.id;
    await clickContent('picture');
    assert.equal(application.current().name, 'Robot 36');
    for (const [content, nativeName] of [['file', 'HAMDRM'], ['text', 'CW'], ['voice', 'FreeDV 700D']]) {
        await clickContent(content);
        assert.equal(application.current().nativeName || application.current().name, nativeName);
    }
    application.state.direction = 'decode';
    application.state.content = 'file';
    application.state.formatId = hamdrm.id;
    await clickContent('picture');
    assert.equal(application.state.formatId, 'pictures-auto');
    application.state.formatId = application.state.formats.find((format) => format.name === 'Robot 36').id;
    const selected = application.state.formatId;
    await clickContent('picture');
    assert.equal(application.state.formatId, selected, 'clicking the active content type preserves its selected mode');
});

test('generation skips encodeStart when cancellation occurs during bridge initialization', async () => {
    const application = createApplication();
    let started = false;
    application.bridge = async () => {
        application.state.job++;
        return {
            call: async (action) => {
                if (action === 'encodeStart') started = true;
                return { rate: 48000 };
            }
        };
    };

    await application.generate();

    assert.equal(started, false);
});

test('generation cancels the encoder when cancellation occurs during encodeRead', async () => {
    const application = createApplication();
    let signalReadStarted;
    const readStarted = new Promise((resolve) => (signalReadStarted = resolve));
    let finishRead;
    const readResult = new Promise((resolve) => (finishRead = resolve));
    const calls = [];
    application.bridge = async () => ({
        call: async (action) => {
            calls.push(action);
            if (action === 'encodeStart') return { rate: 48000 };
            if (action === 'encodeRead') {
                signalReadStarted();
                return readResult;
            }
            return {};
        }
    });

    const generation = application.generate();
    await readStarted;
    application.state.job++;
    finishRead({ done: true, progress: 1 });
    await generation;

    assert.deepEqual(calls, ['encodeStart', 'encodeRead', 'cancel']);
    assert.equal(application.state.output, null);
});

test('generation discards completed chunks if canceled before output is stored', async () => {
    const application = createApplication();
    const calls = [];
    application.bridge = async () => ({
        call: async (action) => {
            calls.push(action);
            if (action === 'encodeStart') return { rate: 48000 };
            return { done: true, progress: 1, samples: new Float32Array([0]) };
        }
    });
    application.operationUpdate = () => {
        queueMicrotask(() => application.state.job++);
    };

    await application.generate();

    assert.deepEqual(calls, ['encodeStart', 'encodeRead', 'cancel']);
    assert.equal(application.state.output, null);
});

test('recording cancellation during playback startup pauses the player', async () => {
    const application = createApplication();
    const previousDocument = globalThis.document;
    let paused = false;
    const player = {
        closest: () => ({}),
        play: async () => application.state.job++,
        pause: () => { paused = true; }
    };
    globalThis.document = { querySelector: () => player };
    application.state.audio = { channels: [new Float32Array(16)], rate: 48000 };
    const calls = [];
    const bridge = {
        call: async (action) => {
            calls.push(action);
            return { rate: 48000 };
        }
    };
    try {
        await application.decodeRecording(bridge, {}, { channel: 0, startSeconds: 0, paced: true }, 1);
        assert.equal(paused, true);
        assert.deepEqual(calls, ['setup']);
    } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    }
});

test('paced recording decode retains the first and final PCM samples after playback jumps ahead', async () => {
    const application = createApplication();
    application.state.job = 1;
    application.operationUpdate = () => {};
    application.view.paintReceived = () => {};
    const source = Float32Array.from({ length: 17 }, (_, index) => index + 1);
    const received = [];
    await application.decodeRecordingChunks({
        call: async (_action, options) => {
            received.push(...options.samples);
            return {};
        }
    }, source, 0, source.length, 5, 48000, { currentTime: 1, ended: false }, 1);
    assert.deepEqual(received, [...source]);
});

test('stopping live input flushes partial PCM before draining and finishing the receiver', async (t) => {
    const application = createApplication();
    const previousDocument = globalThis.document;
    globalThis.document = {
        querySelector: (selector) => selector === '#packet-dialog' ? { open: false } : null,
        querySelectorAll: () => []
    };
    t.after(() => {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    });
    application.state.busy = true;
    application.view.render = () => {};
    application.consume = (result) => {
        application.state.received.text += result.text || '';
    };
    const calls = [],
        events = [],
        node = { port: {
            onmessage: null,
            postMessage(message) {
                if (message.type !== 'flush') return;
                events.push('flush requested');
                this.onmessage({ data: { samples: Float32Array.from([0.1, 0.2]) } });
                queueMicrotask(() => {
                    events.push('ack');
                    this.onmessage({ data: { type: 'flushed' } });
                });
            }
        } },
        bridge = {
            call: async (action) => {
                calls.push(action);
                events.push(action);
                if (action === 'process') return { text: 'partial' };
                return { text: 'final' };
            }
        },
        track = { stop: () => events.push('track stopped') };
    const queue = application.queueLiveSamples(node, bridge, application.state.job);
    application.state.live = {
        node,
        queue,
        stream: { getTracks: () => [track] },
        ctx: { close: async () => events.push('context closed') }
    };
    const finishing = application.finishLiveInput(node, bridge, queue, application.state.job);
    application.operationDone = finishing;

    await application.stop();

    assert.equal(application.state.job, 1);
    assert.deepEqual(calls, ['process', 'finish']);
    assert.equal(application.state.received.text, 'partialfinal');
    assert.equal(application.state.live, null);
    assert.ok(events.indexOf('ack') < events.indexOf('track stopped'));
    assert.ok(events.indexOf('track stopped') < events.indexOf('context closed'));
    assert.equal(events.filter((event) => event === 'flush requested').length, 1);
    assert.equal(events.filter((event) => event === 'ack').length, 1, 'finish and close share one flush');
});

test('live close flushes once and accepts its acknowledgement after cancellation', async () => {
    const application = createApplication();
    let flushes = 0, stops = 0, closes = 0;
    const node = { port: {
        onmessage: null,
        postMessage(message) {
            if (message.type !== 'flush') return;
            flushes++;
            this.onmessage({ data: { type: 'flushed' } });
        }
    } };
    const queue = application.queueLiveSamples(node, { call: async () => ({}) }, application.state.job);
    application.state.job++;
    application.state.live = {
        node,
        queue,
        stream: { getTracks: () => [{ stop: () => stops++ }] },
        ctx: { close: async () => closes++ }
    };
    await Promise.all([application.closeLive(), application.closeLive()]);
    assert.equal(flushes, 1);
    assert.equal(stops, 1);
    assert.equal(closes, 1);
});
