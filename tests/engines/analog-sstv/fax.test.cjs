const assert = require('node:assert/strict');
const { loadCore, loadRuntime } = require('../load-legacy.cjs');
global.createMMSSTV = loadCore('analog-sstv');
loadRuntime('analog-sstv', 'engine.js');
(async () => {
    const enc = await MMSCoreEncoder.create(),
        rx = await MMSCoreEngine.create(),
        w = 512,
        h = 500,
        pixels = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
            const v = Math.min(255, Math.floor((x / w) * 4) * 80);
            pixels.set([v, v, v, 255], (y * w + x) * 4);
        }
    enc.call('start', { mode: 45, width: w, height: h, pixels });
    rx.call('reset', { mode: 45 });
    let block, last;
    do {
        block = enc.call('read');
        const pcm = new Int16Array(block.pcm.buffer);
        last = rx.call('process', { samples: Float32Array.from(pcm, (x) => x / 32768) });
    } while (!block.done);
    if (!last.finished) last = rx.call('finish');
    console.log(last.mode, last.completed, last.line, last.width, last.height);
    const image = last.pixels || rx.core.HEAPU8.slice(rx.core._web_pixels(), rx.core._web_pixels() + w * h * 4);
    for (const x of [32, 160, 288, 420]) {
        const v = image[(100 * w + x) * 4];
        console.log(x, v);
        assert(Math.abs(v - Math.floor((x / w) * 4) * 80) < 25);
    }
    assert(last.completed > 0);
    assert.equal(last.width, 512);
    assert.equal(last.height, 500);
    console.log('FAX480 grayscale and manual receive passed.');
})().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
