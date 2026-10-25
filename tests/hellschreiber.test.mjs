import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { WebRadApplication } from '../src/app/application.js';
import { formatGroups } from '../src/app/catalog.js';

const formats = JSON.parse(await readFile(new URL('../build/out/formats.json', import.meta.url))).formats;
const hellModes = formats.filter((format) => format.family === 'Hellschreiber');

function applicationFor(format = hellModes[0]) {
    const previousLocation = globalThis.location;
    globalThis.location = { search: '' };
    const application = new WebRadApplication();
    if (previousLocation === undefined) delete globalThis.location;
    else globalThis.location = previousLocation;
    application.state.formats = formats;
    application.state.formatId = format.id;
    return application;
}

test('every Hellschreiber variant encodes text and recovers a savable printed image', () => {
    assert.equal(hellModes.length, 7);
    const pictureFormats = formatGroups(formats, 'picture', 'decode').flatMap((group) => group.formats);
    const textFormats = formatGroups(formats, 'text', 'decode').flatMap((group) => group.formats);
    for (const format of hellModes) {
        assert.deepEqual(format.inputs, ['text']);
        assert.deepEqual(format.outputs, ['picture']);
        assert.ok(pictureFormats.some((entry) => entry.id === format.id));
        assert.ok(!textFormats.some((entry) => entry.id === format.id));
        const application = applicationFor(format);
        application.state.content = 'text';
        assert.equal(application.testOutputContent(format), 'picture');
        application.state.content = 'picture';
        application.state.direction = 'decode';
        application.ensureFormat();
        assert.equal(application.state.formatId, format.id);
        const html = application.view.decodeMain();
        assert.match(html, /Recovered printed text/);
        assert.match(html, /received-print/);
        assert.match(html, /data-action="save-picture"/);
        assert.doesNotMatch(html, /id="received-text"|data-action="save-text"|data-action="copy-text"/);
    }
});

test('Hellschreiber columns become upright RGBA pixels and append in receive order', () => {
    const application = applicationFor();
    const received = application.state.received;
    application.consumeRaster({ raster: Uint8Array.from([10, 20, 30, 40, 50, 60]), rasterHeight: 3 }, received);
    application.consumeRaster({ raster: Uint8Array.from([70, 80, 90]), rasterHeight: 3 }, received);
    assert.deepEqual([received.current.width, received.current.height], [3, 3]);
    const expected = [30, 60, 90, 20, 50, 80, 10, 40, 70].flatMap((value) => [value, value, value, 255]);
    assert.deepEqual([...received.current.pixels], expected);
    application.consumeRaster({ raster: Uint8Array.from([1, 2]), rasterHeight: 2 }, received);
    assert.deepEqual([received.current.width, received.current.height], [1, 2]);
    assert.deepEqual([...received.current.pixels], [2, 2, 2, 255, 1, 1, 1, 255]);
});

test('printed text continues scrolling after the retained strip reaches its width limit', () => {
    const application = applicationFor();
    const received = application.state.received;
    application.consumeRaster({ raster: new Uint8Array(8190).fill(11), rasterHeight: 1 }, received);
    application.consumeRaster({ raster: Uint8Array.from([21, 22, 23, 24, 25, 26, 27, 28]), rasterHeight: 1 }, received);
    assert.equal(received.current.width, 8192);
    assert.equal(received.current.pixels[0], 11);
    assert.deepEqual([...received.current.pixels.slice(-32)].filter((_value, index) => index % 4 === 0), [21, 22, 23, 24, 25, 26, 27, 28]);
    const oversized = Uint8Array.from({ length: 9000 }, (_value, index) => index % 256);
    application.consumeRaster({ raster: oversized, rasterHeight: 1 }, received);
    assert.equal(received.current.width, 8192);
    assert.equal(received.current.pixels[0], oversized[808]);
    assert.equal(received.current.pixels.at(-4), oversized.at(-1));
});

test('returning from a Hellschreiber loopback restores its text encoder', (t) => {
    const application = applicationFor();
    const previousDocument = globalThis.document;
    globalThis.document = { querySelector: () => null };
    t.after(() => {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    });
    const output = {
        content: 'text',
        format: application.current()
    };
    application.state.output = output;
    application.state.direction = 'decode';
    application.state.content = 'picture';
    application.persist = () => {};
    application.view.render = () => {};

    application.changeDirection('encode');

    assert.equal(application.state.content, 'text');
    assert.equal(application.state.formatId, output.format.id);
    assert.equal(application.state.output, output);
});

test('printed raster dimensions keep Hellschreiber-specific status wording', (t) => {
    const application = applicationFor();
    const previousDocument = globalThis.document;
    const status = {};
    globalThis.document = {
        querySelector: (selector) => selector === '#picture-status' ? status : null,
        querySelectorAll: () => []
    };
    t.after(() => {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    });
    application.state.received.current = {
        width: 120,
        height: 42,
        pixels: new Uint8ClampedArray(120 * 42 * 4),
        complete: false
    };
    application.view.paintAnalysis = () => {};

    application.view.paintReceived();

    assert.equal(status.textContent, '120 × 42 · printed text');
});
