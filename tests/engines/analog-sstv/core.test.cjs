'use strict';
const assert = require('node:assert/strict');
const { loadCore, loadRuntime } = require('../load-legacy.cjs');
const create = loadCore('analog-sstv');
const { Signal } = require('./signal.cjs');
(async () => {
    const m = await create();
    m._web_init();
    assert.equal(m._web_mode_count(), 46);
    const pointer = m._malloc(4096 * 4);
    const process = (values) => {
        for (let n = 0; n < values.length; n += 4096) {
            const chunk = values.subarray(n, n + 4096);
            m.HEAPF32.set(chunk, pointer / 4);
            m._web_process(pointer, chunk.length);
        }
    };
    for (let mode = 0; mode < 46; mode++) {
        m._web_reset(mode);
        assert.equal(m._web_mode(), mode);
        assert.ok(m.UTF8ToString(m._web_mode_name(mode)).length);
        assert.ok([128, 320, 512, 640, 800].includes(m._web_mode_width(mode)));
        process(new Float32Array(8192));
    }
    const cases = [
        { name: 'Martin 2', id: 7, signal: new Signal().martin(true) },
        { name: 'Scottie 1', id: 3, signal: new Signal().scottie() },
        { name: 'Robot 36', id: 0, signal: new Signal().robot() },
        { name: 'PD120', id: 13, signal: new Signal().pd120() }
    ];
    for (const test of cases) {
        m._web_reset(-1);
        const before = m._web_completed();
        process(test.signal.data());
        assert.equal(m._web_mode(), test.id, test.name + ' VIS detection');
        assert.ok(m._web_completed() > before, test.name + ' image completes');
        assert.equal(m._web_width(), test.id === 13 ? 640 : 320);
        const width = m._web_width(),
            height = m._web_height(),
            ptr = m._web_pixels();
        const pixels = m.HEAPU8.slice(ptr, ptr + width * height * 4);
        function average(x, y) {
            const sum = [0, 0, 0];
            for (let j = y; j < y + 12; j++)
                for (let i = x; i < x + 12; i++)
                    for (let c = 0; c < 3; c++) sum[c] += pixels[(j * width + i) * 4 + c] / 144;
            return sum;
        }
        if (test.id === 7 || test.id === 3) {
            for (let c = 0; c < 3; c++) {
                const pixel = average(30 + 80 * c, 80);
                assert.ok(pixel[c] > 180, `${test.name} channel ${c} recovered: ${pixel}`);
                assert.ok(pixel[(c + 1) % 3] < 80, `${test.name} color separation: ${pixel}`);
            }
        } else {
            const pixel = average(80, 80);
            assert.ok(
                pixel.every((v) => v > 100 && v < 210),
                `${test.name} luminance recovered: ${pixel}`
            );
        }
        if (test.id === 7) {
            const previous = pixels[80 * width * 4 + 40 * 4];
            m._web_redraw(0, 20);
            const shifted = m._web_pixels();
            assert.notDeepEqual(
                m.HEAPU8.slice(shifted, shifted + pixels.length),
                pixels,
                'phase adjustment redraws signal'
            );
            m._web_redraw(0, 0);
            assert.equal(
                m.HEAPU8[m._web_pixels() + 80 * width * 4 + 40 * 4],
                previous,
                'reset restores original image'
            );
            const done = m._web_completed_pixels(),
                completedImage = m.HEAPU8.slice(done, done + pixels.length);
            m._web_reset(-1);
            process(new Signal().martin(true, 2).data());
            assert.deepEqual(
                m.HEAPU8.slice(m._web_completed_pixels(), m._web_completed_pixels() + pixels.length),
                completedImage,
                'completed history survives the next receive'
            );
            assert.equal(m._web_completed_mode(), 7);
        }
        console.log(test.name + ': auto-detect, full image, correct colors/dimensions passed');
    }
    m._web_reset(-1);
    m._web_option(11, 1);
    process(new Signal().fsk('N0CALL').data());
    assert.equal(m.UTF8ToString(m._web_fsk()), 'N0CALL', 'original FSK ID decoder');
    m._web_reset(-1);
    process(new Float32Array(11025 * 2));
    assert.equal(m._web_receiving(), 0, 'silence does not trigger reception');
    process(new Signal().tone(1900, 1500).data());
    const spectrum = m.HEAP32.slice(m._web_spectrum() / 4, m._web_spectrum() / 4 + 1024),
        peak = spectrum.indexOf(Math.max(...spectrum));
    assert.ok(Math.abs((peak * 11025) / 2048 - 1900) < 10, 'original FFT locates the input tone');
    assert.ok(m._web_level() > 0.2, 'original input level meter follows sample time');
    loadRuntime('analog-sstv', 'engine.js');
    const adapter = new global.MMSCoreEngine(m);
    adapter.call('option', { id: 0, value: 1 });
    const finished = adapter.call('snapshot').finished;
    assert.equal(finished.mode, 13, 'option updates preserve pending completed-image notification');
    assert(
        finished.fraction > 0.9 && finished.fraction <= 1,
        'PD completion uses paired scan lines for the autosave threshold'
    );
    assert.equal(adapter.call('snapshot').finished, undefined, 'completed image transferred once');
    m._free(adapter.pointer);
    m._free(pointer);
    console.log(
        '46 modes, silence rejection, synchronization, phase redraw, FSK ID, completed history, FFT and input level passed.'
    );
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
