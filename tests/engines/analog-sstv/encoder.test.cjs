'use strict';
const assert = require('node:assert/strict');
const { loadCore, loadRuntime } = require('../load-legacy.cjs');
const create = loadCore('analog-sstv');
global.createMMSSTV = create;
loadRuntime('analog-sstv', 'engine.js');
const { wav, readWav } = loadRuntime('analog-sstv', 'audio.js');
function picture(width, height) {
    const colors = [
            [240, 20, 20],
            [20, 240, 20],
            [20, 20, 240],
            [160, 160, 160]
        ],
        out = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
            const c = colors[Math.min(3, Math.floor((x / width) * 4))],
                i = (y * width + x) * 4;
            out.set([...c, 255], i);
        }
    return out;
}
function grayscalePicture(width, height) {
    const out = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
            const value = Math.round((x * 180) / (width - 1) + (y * 70) / (height - 1)),
                i = (y * width + x) * 4;
            out.set([value, value, value, 255], i);
        }
    return out;
}
function robot24Picture(width, height) {
    const out = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
            const base = Math.round(35 + (180 * x) / (width - 1)),
                value = Math.max(0, Math.min(255, base + (y % 2 ? 60 : -60))),
                i = (y * width + x) * 4;
            out.set([value, value, value, 255], i);
        }
    return out;
}
(async () => {
    const encoder = await global.MMSCoreEncoder.create(),
        m = encoder.core;
    for (let mode = 0; mode < 46; mode++) {
        const width = m._web_mode_width(mode),
            height = m._web_mode_tx_height(mode);
        encoder.call('start', { mode, width, height, pixels: picture(width, height) });
        for (let n = 0; n < 4; n++) {
            const block = encoder.call('read');
            assert.ok(block.pcm.length > 0);
            assert.ok(block.pcm.some((value) => value !== 0));
        }
        encoder.call('cancel');
    }
    assert.throws(() => encoder.call('start', { mode: 7, width: 1, height: 1, pixels: new Uint8Array(4) }), /size/);
    const receiver = await create();
    receiver._web_init();
    const input = receiver._malloc(32768 * 4);
    for (const mode of [7, 3, 0, 13, 2, 43, 44]) {
        const width = m._web_mode_width(mode),
            height = m._web_mode_tx_height(mode),
            chunks = [];
        encoder.call('start', {
            mode,
            width,
            height,
            pixels: picture(width, height),
            call: mode === 7 ? 'N0CALL' : ''
        });
        let block;
        do {
            block = encoder.call('read');
            chunks.push(block.pcm);
        } while (!block.done);
        const audio = await wav(chunks).arrayBuffer(),
            decoded = readWav(audio);
        assert.equal(decoded.rate, 11025);
        assert.equal(decoded.channels, 1);
        assert.ok(decoded.duration > 20);
        receiver._web_reset(-1);
        receiver._web_option(11, 1);
        const completed = receiver._web_completed();
        for (let p = 0; p < decoded.samples.length; p += 32768) {
            const samples = decoded.samples.subarray(p, p + 32768);
            receiver.HEAPF32.set(samples, input / 4);
            receiver._web_process(input, samples.length);
        }
        assert.equal(receiver._web_mode(), mode, 'generated VIS identifies mode');
        assert.ok(receiver._web_completed() > completed, 'generated audio completes a received image');
        assert.equal(receiver._web_completed_width(), width);
        const image = receiver.HEAPU8.slice(
            receiver._web_completed_pixels(),
            receiver._web_completed_pixels() + width * receiver._web_completed_height() * 4
        );
        for (let c = 0; c < 3; c++) {
            const x = Math.round(width * (0.1 + 0.25 * c)),
                i = (80 * width + x) * 4,
                color = [...image.subarray(i, i + 3)];
            assert.ok(color[c] > 170, `mode ${mode} channel ${c}: ${color}`);
            assert.ok(color[(c + 1) % 3] < 85, `mode ${mode} color separation: ${color}`);
        }
        if (mode === 7) {
            assert.equal(receiver.UTF8ToString(receiver._web_fsk()), 'N0CALL');
        }
        console.log(
            m.UTF8ToString(m._web_mode_name(mode)) +
                ': original encoder → WAV → original decoder, colors and completion passed'
        );
        encoder.call('cancel');
    }
    const mode = 35,
        width = m._web_mode_width(mode),
        height = m._web_mode_tx_height(mode),
        chunks = [];
    encoder.call('start', { mode, width, height, pixels: grayscalePicture(width, height) });
    let block;
    do {
        block = encoder.call('read');
        chunks.push(block.pcm);
    } while (!block.done);
    const audio = readWav(await wav(chunks).arrayBuffer()),
        completed = receiver._web_completed();
    receiver._web_reset(mode);
    receiver._web_option(5, 1);
    for (let p = 0; p < audio.samples.length; p += 32768) {
        const samples = audio.samples.subarray(p, p + 32768);
        receiver.HEAPF32.set(samples, input / 4);
        receiver._web_process(input, samples.length);
    }
    receiver._web_finish();
    assert.ok(receiver._web_completed() > completed, 'forced B/W 8 receive completes after its VIS header');
    assert.ok(receiver._web_completed_fraction() >= 0.98, 'forced B/W 8 receive reaches the expected image height');
    const received = receiver.HEAPU8.slice(
        receiver._web_completed_pixels(),
        receiver._web_completed_pixels() + width * receiver._web_completed_height() * 4
    );
    const left = received[(80 * width + 32) * 4],
        right = received[(80 * width + 288) * 4];
    assert.ok(right > left + 60, `forced B/W 8 receive preserves grayscale image content (${left} → ${right})`);
    encoder.call('cancel');

    const robot24 = { mode: 34, width: 320, height: 240, pixels: robot24Picture(320, 240) },
        robotChunks = [];
    encoder.call('start', robot24);
    let robotBlock;
    do {
        robotBlock = encoder.call('read');
        robotChunks.push(robotBlock.pcm);
    } while (!robotBlock.done);
    const robotSamples = readWav(await wav(robotChunks).arrayBuffer()).samples,
        robotCompleted = receiver._web_completed();
    receiver._web_reset(robot24.mode);
    for (let p = 0; p < robotSamples.length; p += 32768) {
        const samples = robotSamples.subarray(p, p + 32768);
        receiver.HEAPF32.set(samples, input / 4);
        receiver._web_process(input, samples.length);
    }
    receiver._web_finish();
    assert.ok(receiver._web_completed() > robotCompleted, 'Robot 24 receive completes its image');
    assert.ok(receiver._web_completed_fraction() >= 0.98, 'Robot 24 receive reaches its expected height');
    const robotReceived = receiver.HEAPU8.slice(
        receiver._web_completed_pixels(),
        receiver._web_completed_pixels() + robot24.width * receiver._web_completed_height() * 4
    );
    const robotLeft = robotReceived[(80 * robot24.width + 32) * 4],
        robotCenter = robotReceived[(80 * robot24.width + 160) * 4];
    assert.ok(
        Math.abs(robotCenter - 125) < 18,
        `Robot 24 averages its two source rows (${robotCenter} should be near 125)`
    );
    assert.ok(robotCenter > robotLeft + 40, 'Robot 24 preserves horizontal grayscale detail');
    receiver._free(input);
    m._free(encoder.pointer);
    console.log('All 46 encoders produce audio; nine image/WAV round trips and FSK ID passed.');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
