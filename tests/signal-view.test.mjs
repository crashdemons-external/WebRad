import test from 'node:test';
import assert from 'node:assert/strict';
import { ApplicationView } from '../src/app/application-view.js';
import { WebRadApplication } from '../src/app/application.js';
import { Spectrogram } from '../src/app/spectrogram.js';

function createReceiver() {
    const application = {
        state: { received: {}, busy: false, job: 1 },
        current: () => ({ engine: 'fldigi' }),
        settings: () => ({ frequency: 1500 })
    };
    application.view = new ApplicationView(application);
    return application;
}

function tone(rate, duration, frequency = 700, amplitude = 1) {
    return Float32Array.from({ length: Math.round(rate * duration) }, (_, i) => amplitude * Math.sin(2 * Math.PI * frequency * i / rate));
}

function intensity(graph, time, frequency) {
    const y = Math.min(Spectrogram.HEIGHT - 1, Math.floor(Math.log(4000 / frequency) / Math.log(4000 / 80) * Spectrogram.HEIGHT));
    const x = Math.min(Spectrogram.WIDTH - 1, Math.floor(time / graph.duration * Spectrogram.WIDTH));
    return graph.levels[y * Spectrogram.WIDTH + x];
}

test('signal disclosure places a time/frequency spectrogram below the spectrum with the requested hint', () => {
    const markup = createReceiver().view.signalDiagnostics();
    assert.ok(markup.includes('<p class="hint">Click the graph to tune to the center of the signal.</p>'));
    assert.ok(markup.indexOf('id="spectrum"') < markup.indexOf('id="spectrogram"'));
    assert.match(markup, /aria-label="Received signal spectrogram, time from left to right, frequency from bottom to top"/);
    assert.match(markup, /id="spectrogram-time"/);
    assert.match(markup, /aria-label="Frequency in hertz"/);
});

test('short tone pulses remain distinct along the time axis with low frequencies below high frequencies', () => {
    const samples = tone(8000, 0.6);
    samples.fill(0, 800, 1600);
    samples.fill(0, 3200);
    const graph = new Spectrogram(8000, 0.6);
    graph.append(samples);
    graph.finish();
    assert.ok(intensity(graph, 0.05, 700) > 245);
    assert.ok(intensity(graph, 0.15, 700) < 10, 'the gap between Morse pulses stays dark');
    assert.ok(intensity(graph, 0.3, 700) > 245);
    assert.equal(intensity(graph, 0.5, 700), 0);
    assert.ok(intensity(graph, 0.3, 2000) < 20, 'the tone stays in its frequency band');
    assert.equal(graph.frames, 60);
    assert.equal(Spectrogram.frequencyAt(0), 4000);
    assert.equal(Spectrogram.frequencyAt(1), 80);
    assert.ok(Spectrogram.frequencyAt(0.25) > Spectrogram.frequencyAt(0.75));
});

test('analysis is independent of decoder chunk boundaries at common input rates', () => {
    for (const rate of [8000, 11025, 44100, 48000]) {
        const samples = tone(rate, 0.21, 1537, 0.3);
        const expected = new Spectrogram(rate, 0.21);
        expected.append(samples);
        expected.finish();
        const actual = new Spectrogram(rate, 0.21);
        for (let i = 0; i < samples.length; i += 137) actual.append(samples.subarray(i, i + 137));
        actual.finish();
        assert.deepEqual(actual.levels, expected.levels, `${rate} Hz`);
        assert.equal(actual.frames, expected.frames);
        assert.ok(intensity(actual, 0.1, 1537) > 200);
        assert.equal(actual.pending.length, 0);
    }
});

test('intensity uses a consistent decibel scale, with silence and invalid samples staying dark', () => {
    const graph = new Spectrogram(8000, 0.6);
    const samples = tone(8000, 0.6);
    for (let i = 1600; i < 3200; i++) samples[i] *= 0.1;
    samples.fill(NaN, 3200);
    graph.append(samples);
    graph.finish();
    const loud = intensity(graph, 0.1, 700);
    const quiet = intensity(graph, 0.3, 700);
    assert.ok(loud - quiet > 50 && loud - quiet < 65, 'a 20 dB change affects brightness across time');
    assert.equal(intensity(graph, 0.5, 700), 0);
    const short = new Spectrogram(8000, 0.001);
    short.append(tone(8000, 0.001));
    short.finish();
    assert.equal(short.frames, 1, 'sub-window clips are analyzed with padding');
    short.finish();
    assert.equal(short.frames, 1, 'finishing twice does not append artificial time');
});

test('live timeline expands with bounded memory and keeps earlier audio at the left', () => {
    const graph = new Spectrogram(8000);
    graph.append(tone(8000, 0.5));
    const early = intensity(graph, 0.1, 700);
    for (let i = 0; i < 21; i++) graph.append(new Float32Array(8000));
    graph.finish();
    assert.equal(graph.duration, 40);
    assert.equal(graph.levels.length, 1024 * 256);
    assert.equal(intensity(graph, 0.1, 700), early);
    assert.equal(intensity(graph, 15, 700), 0);
});

test('painting preserves left-to-right time columns and labels the selected recording offset', (t) => {
    const application = createReceiver();
    application.current = () => ({ engine: 'sstv' });
    const graph = new Spectrogram(8000, 2, 5);
    graph.levels[20 * 1024 + 100] = 255;
    application.state.received.spectrogram = graph;
    let painted;
    const context = {
        createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
        putImageData: image => { painted = image.data; }
    };
    const labels = Array.from({ length: 5 }, () => ({}));
    const previousDocument = globalThis.document;
    globalThis.document = {
        querySelector: () => ({ getContext: () => context }),
        querySelectorAll: () => labels
    };
    t.after(() => {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    });
    application.view.drawSpectrogram();
    const offset = (20 * 1024 + 100) * 4;
    assert.deepEqual(Array.from(painted.subarray(offset, offset + 4)), [255, 245, 180, 255]);
    assert.deepEqual(labels.map(label => label.textContent), ['5 s', '5.5 s', '6 s', '6.5 s', '7 s']);
    application.view.drawSpectrogram();
    assert.equal(graph.frames, 0, 'redraws do not change the audio timeline');
    WebRadApplication.prototype.resetReceived.call(application);
    assert.equal(application.state.received.spectrogram, undefined);
});

test('spectrum tunes horizontally and spectrogram tunes vertically, with busy and engine guards', () => {
    const application = createReceiver();
    const settings = { frequency: 1500 };
    application.settings = () => settings;
    application.persist = () => {};
    application.view.render = () => {};
    application.notify = () => {};
    for (const id of ['spectrum', 'spectrogram']) {
        const event = {
            target: { id, getBoundingClientRect: () => ({ left: 100, width: 800, top: 20, height: 256 }) },
            clientX: 500,
            clientY: 20 + Math.log(4000 / 700) / Math.log(4000 / 80) * 256
        };
        WebRadApplication.prototype.handleSpectrumClick.call(application, event);
        const expected = id === 'spectrum' ? 2000 : 700;
        assert.equal(settings.frequency, expected);
        application.state.busy = true;
        event.clientX = 300;
        event.clientY = 20;
        WebRadApplication.prototype.handleSpectrumClick.call(application, event);
        assert.equal(settings.frequency, expected);
        application.state.busy = false;
        application.current = () => ({ engine: 'sstv' });
        WebRadApplication.prototype.handleSpectrumClick.call(application, event);
        assert.equal(settings.frequency, expected);
        application.current = () => ({ engine: 'fldigi' });
    }
});

test('recording input is analyzed before worker transfer without changing decoder PCM', async () => {
    const application = createReceiver();
    const samples = tone(8000, 0.15);
    application.state.received.spectrogram = new Spectrogram(8000, 0.15);
    application.consume = () => {};
    application.operationUpdate = () => {};
    const blocks = [];
    const bridge = {
        async call(action, { samples: block }, transfers) {
            assert.equal(action, 'process');
            blocks.push(structuredClone(block, { transfer: transfers }));
            assert.equal(block.byteLength, 0);
            return {};
        }
    };
    await WebRadApplication.prototype.decodeRecordingChunks.call(application, bridge, samples, 0, samples.length, 511, 8000, undefined, 1);
    application.state.received.spectrogram.finish();
    assert.ok(intensity(application.state.received.spectrogram, 0.08, 700) > 245);
    assert.deepEqual(Float32Array.from(blocks.flatMap(block => Array.from(block))), samples);
});
