const assert = require('node:assert/strict');
(async () => {
    const { loadCore } = require('../load-legacy.cjs');
    const m = await loadCore('jpeg2000')(),
        w = 128,
        h = 96,
        pixels = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            pixels.set([x * 2, y * 2, (x + y) % 256, 255], i);
        }
    const p = m._malloc(pixels.length);
    m.HEAPU8.set(pixels, p);
    const sizes = [];
    for (const ratio of [1, 10, 40]) {
        const size = m._jp2_encode(p, w, h, ratio);
        assert(size > 0);
        sizes.push(size);
        const data = m.HEAPU8.slice(m._jp2_file(), m._jp2_file() + size),
            q = m._malloc(size);
        m.HEAPU8.set(data, q);
        assert.equal(m._jp2_decode(q, size), 1);
        assert.equal(m._jp2_width(), w);
        assert.equal(m._jp2_height(), h);
        const decoded = m.HEAPU8.slice(m._jp2_pixels(), m._jp2_pixels() + pixels.length);
        if (ratio === 1) assert.deepEqual(decoded, pixels, 'lossless RGB round trip');
        else {
            let mse = 0;
            for (let i = 0; i < pixels.length; i++) mse += (pixels[i] - decoded[i]) ** 2;
            assert(Math.sqrt(mse / pixels.length) < 15, 'lossy color fidelity');
        }
        assert.equal(m._jp2_decode(q, Math.floor(size / 2)), 0, 'truncated image rejected');
        m._free(q);
    }
    assert(sizes[2] < sizes[0]);
    assert.equal(m._jp2_encode(p, 0, h, 1), 0);
    assert.equal(m._jp2_decode(p, 256), 0);
    m._free(p);
    console.log('JPEG 2000 lossless, lossy compression, dimensions, color fidelity and malformed image checks passed.');
})().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
