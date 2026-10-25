'use strict';
const assert = require('node:assert/strict');
const { loadCore, loadRuntime } = require('../load-legacy.cjs');
global.location = { protocol: 'http:', search: '' };
global.createMMSSTV = loadCore('analog-sstv');
global.createWEFAX = loadCore('weather-fax');
loadRuntime('analog-sstv', 'engine.js');
loadRuntime('weather-fax', 'wefax-engine.js');
const lpm = [240, 120, 90, 60];
function image(mode, height = 16) {
    const width = mode === 46 ? 1809 : 904,
        pixels = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
            const gray = x < width / 2 ? 40 : 220;
            pixels.set([gray, gray, gray, 255], (y * width + x) * 4);
        }
    return { mode, width, height, pixels };
}
async function main() {
    const rx = await WEFAXCore.create(),
        enc = await WEFAXCore.create(true),
        auto = await MMSSharedDecoder.create();
    const render = (input, format, maximum = 32768) => {
        enc.call('start', { ...input, lpm: format });
        const chunks = [];
        let count = 0,
            done = false;
        while (!done) {
            const m = enc.core,
                n = m._fax_encode_read(enc.pointer, maximum);
            chunks.push(m.HEAPU8.slice(enc.pointer, enc.pointer + n * 2));
            count += n;
            done = !!m._fax_encode_done();
            assert(n > 0 || done, 'encoder must make progress');
        }
        const pcm = new Int16Array(count);
        let pos = 0;
        for (const chunk of chunks) {
            const values = new Int16Array(chunk.buffer);
            pcm.set(values, pos);
            pos += values.length;
        }
        return Float32Array.from(pcm, (v) => v / 32768);
    };
    const decode = (mode, samples, format, manual = false, chunk = 4096, afc = false, automatic = false) => {
        rx.call('reset', { mode });
        rx.call('option', { id: 0, value: Number(afc) });
        rx.call('option', { id: 1, value: format });
        if (manual) {
            rx.call('option', { id: 2, value: 1 });
            rx.call('option', { id: 3, value: 1 });
        }
        const pictures = [];
        let last;
        for (let i = 0; i < samples.length; i += chunk) {
            last = rx.call('process', { samples: samples.subarray(i, i + chunk) });
            if (last.finished) pictures.push(last.finished);
        }
        last = rx.call('finish', { automatic });
        if (last.finished) pictures.push(last.finished);
        rx.call('finish');
        assert.equal(rx.snapshot().completed, last.completed, 'finish is idempotent');
        return pictures;
    };
    let fixture;
    for (const mode of [46, 47])
        for (let format = 0; format < 4; format++) {
            const input = image(mode),
                samples = render(input, format),
                pictures = decode(mode, samples, format);
            const expected = 11025 * 20 + Math.floor((11025 * 60) / lpm[format]) * (input.height + 21);
            assert(Math.abs(samples.length - expected) <= 1, 'native APT/phasing/image/stop timing');
            assert(samples.every(Number.isFinite));
            assert(samples.some((v) => Math.abs(v) > 0.1));
            let goodRows = 0;
            for (const picture of pictures) {
                assert.equal(picture.width, input.width);
                assert.equal(picture.pixels.length, picture.width * picture.height * 4);
                for (let y = 0; y < picture.height; y++) {
                    const a = (y * picture.width + Math.floor(picture.width / 4)) * 4,
                        b = (y * picture.width + Math.floor((picture.width * 3) / 4)) * 4;
                    if (Math.abs(picture.pixels[a] - 40) < 20 && Math.abs(picture.pixels[b] - 220) < 20) goodRows++;
                    assert.equal(picture.pixels[a], picture.pixels[a + 1]);
                    assert.equal(picture.pixels[a + 3], 255);
                }
            }
            assert(
                goodRows >= input.height - 3,
                `IOC ${mode}, ${lpm[format]} LPM: decoded grayscale rows (${goodRows})`
            );
            await auto.call('reset', { mode: -1 });
            let detected = false,
                autoPicture;
            for (let i = 0; i < samples.length; i += 32768) {
                const result = await auto.call('process', { samples: samples.subarray(i, i + 32768) });
                if (result.mode === mode) detected = true;
                if (result.finished) autoPicture = result.finished;
            }
            const ended = await auto.call('finish', { automatic: true });
            autoPicture = ended.finished || autoPicture;
            assert(detected, `Auto detects IOC ${mode} at ${lpm[format]} LPM`);
            assert.equal(autoPicture?.mode, mode, 'Auto selects the IOC matching the APT start');
            assert(autoPicture.height >= input.height - 3, 'Auto preserves the beginning of the image');
            console.log(
                `WEFAX ${input.width}px / ${lpm[format]} LPM: ${goodRows} grayscale rows, ${pictures.length} completed page(s)`
            );
            if (mode === 46 && format === 1) fixture = { input, samples };
        }
    assert.deepEqual(render(fixture.input, 1, 511), fixture.samples, 'TX PCM is independent of pull size');
    const withAfc = decode(46, fixture.samples, 1, false, 4096, true);
    assert.equal(withAfc.length, 1, 'AFC phasing artifacts do not produce history pages');
    const displayed = rx.call('finish');
    assert(displayed.height >= 16, 'last completed page remains visible after APT opens an empty page');
    rx.call('reset', { mode: 46 });
    assert.equal(rx.call('finish').line, 0, 'reset must not restore an older recording');
    const longer = decode(46, render(image(46, 32), 1), 1, false, 3859, true, true);
    assert.equal(longer.length, 1, 'end of file must discard a blank stop-tone page');
    assert(rx.call('finish', { automatic: true }).height >= 32, 'real completed page remains on display');
    const start = 11025 * 5 + 23 * Math.floor((11025 * 60) / 120);
    // Missing preamble: start two lines into the image and select LPM manually.
    const manual = decode(
        46,
        fixture.samples.subarray(start, start + Math.floor((11025 * 60) / 120) * 10),
        1,
        true,
        777
    );
    assert(
        manual.some((p) => p.height >= 8),
        'manual reception without APT/phasing'
    );
    const long = image(47, 520),
        longSamples = render(long, 0);
    const longStart = 11025 * 5 + 21 * Math.floor((11025 * 60) / 240);
    const growing = decode(
        47,
        longSamples.subarray(longStart, longStart + 520 * Math.floor((11025 * 60) / 240)),
        0,
        true
    );
    assert(
        growing.some((p) => p.height > 512),
        'receive image must grow beyond 512 rows'
    );
    assert.throws(() => enc.call('start', { ...image(46), width: 904 }), /Invalid WEFAX/);
    assert.throws(() => enc.call('start', { ...image(47), lpm: 4 }), /Invalid WEFAX/);
    assert.throws(() => enc.call('start', { ...image(47, 2000), lpm: 3 }), /maximum 30 minutes/);
    enc.call('start', { ...image(47), lpm: 3 });
    enc.call('read');
    enc.call('cancel');
    assert(enc.call('read').done);
    const shared = await MMSSharedDecoder.create();
    assert.equal(shared.modes.length, 48);
    await shared.call('option', { id: 0, value: 0 });
    await shared.call('fax-option', { id: 1, value: 1 });
    const initial = await Promise.all([
        shared.call('reset', { mode: 46 }),
        shared.call('fax-option', { id: 5, value: 1900 }),
        shared.call('process', { samples: new Float32Array(512) })
    ]);
    let state = initial[0];
    assert.equal(state.mode, 46);
    assert.equal(initial[2].mode, 46, 'input waits for lazy worker initialization');
    let finished = 0;
    for (let i = 0; i < fixture.samples.length; i += 32768) {
        state = await shared.call('process', { samples: fixture.samples.subarray(i, i + 32768) });
        if (state.finished) finished++;
    }
    assert(finished > 0);
    const total = state.completed;
    state = await shared.call('reset', { mode: 7 });
    assert.equal(state.mode, 7);
    assert.equal(state.completed, total);
    state = await shared.call('reset', { mode: 47 });
    assert.equal(state.mode, 47);
    assert.equal(state.completed, total);
    await shared.call('fax-option', { id: 6, value: 1 });
    state = await shared.call('reset', { mode: 46 });
    assert.equal(state.faxState, 3, 'manual reception preference survives source reset');
    const sharedEncoder = await MMSSharedEncoder.create();
    for (const input of [image(47), { mode: 7, width: 320, height: 256, pixels: new Uint8Array(320 * 256 * 4) }]) {
        await sharedEncoder.call('start', input);
        assert((await sharedEncoder.call('read')).pcm.length > 0);
        await sharedEncoder.call('cancel');
    }
    // Tones and noise alone must never claim WEFAX, even with manual RX saved.
    await auto.call('fax-option', { id: 6, value: 1 });
    await auto.call('reset', { mode: -1 });
    let seed = 123;
    const unrelated = new Float32Array(11025 * 24);
    for (let i = 0; i < unrelated.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
        unrelated[i] =
            i < 11025 * 8
                ? 0.8 * Math.sin((2 * Math.PI * 300 * i) / 11025)
                : i < 11025 * 16
                  ? 0.8 * Math.sin((2 * Math.PI * 1500 * i) / 11025)
                  : (seed / 2147483648) * 0.1;
    }
    for (let i = 0; i < unrelated.length; i += 32768)
        assert(
            !isWEFAXMode((await auto.call('process', { samples: unrelated.subarray(i, i + 32768) })).mode),
            'tones/noise without a matching phasing sequence'
        );
    const analogEncoder = await MMSCoreEncoder.create(),
        analogChunks = [];
    analogEncoder.call('start', { mode: 7, width: 320, height: 256, pixels: new Uint8Array(320 * 256 * 4) });
    let block;
    do {
        block = analogEncoder.call('read');
        analogChunks.push(Float32Array.from(new Int16Array(block.pcm.buffer), (v) => v / 32768));
    } while (!block.done);
    await auto.call('reset', { mode: -1 });
    let analogComplete = false;
    for (const samples of analogChunks) {
        const result = await auto.call('process', { samples });
        assert(!isWEFAXMode(result.mode), 'SSTV keeps priority in Auto');
        if (result.finished) {
            assert.equal(result.finished.mode, 7);
            analogComplete = true;
        }
    }
    assert(analogComplete, 'Auto still completes SSTV');
    let followingFax = false;
    for (let i = 0; i < fixture.samples.length; i += 32768) {
        const result = await auto.call('process', { samples: fixture.samples.subarray(i, i + 32768) });
        if (result.finished?.mode === 46) followingFax = true;
    }
    assert(followingFax, 'Auto resumes WEFAX detection after SSTV without reset');
    await auto.call('reset', { mode: -1 });
    await auto.call('process', { samples: fixture.samples.subarray(0, 11025 * 12) });
    assert.equal((await auto.call('snapshot')).mode, 46);
    let preempted = false;
    for (const samples of analogChunks) {
        const result = await auto.call('process', { samples });
        if (result.receiving && result.mode === 7) preempted = true;
        if (result.finished) assert.equal(result.finished.mode, 7);
    }
    assert(preempted, 'SSTV preempts an active lower-priority WEFAX receiver');
    console.log(
        'Auto IOC detection at all speeds, SSTV priority, mixed streams, tone/noise rejection and saved manual settings passed.'
    );
    console.log(
        'WEFAX chunk continuity, manual RX, growing images, bounds, cancellation and SSTV/WEFAX switching passed.'
    );
}
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
