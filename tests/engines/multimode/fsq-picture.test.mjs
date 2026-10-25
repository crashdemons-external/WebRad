import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { EngineHost } from '../../../build/out/app/engine-host.js';
import { AudioTools } from '../../../src/app/audio.js';
import { defaultsFor } from '../../../src/app/settings.js';
import { PictureTools } from '../../../src/app/pictures.js';

const formats = JSON.parse(readFileSync(new URL('../../../build/out/formats.json', import.meta.url), 'utf8')).formats;

async function encodePicture(callsign, size = 0) {
    const format = formats.find(candidate => candidate.family === 'FSQ' && candidate.presetSettings?.fsqImageSize === size);
    assert.ok(format, 'FSQ picture preset exists');
    const settings = { ...defaultsFor(format), callsign, afc: false, sql: false };
    const host = await EngineHost.create('fldigi');
    // Invalid-sender cases exercise the native header parser after bypassing the input field.
    const { width, height, gray } = PictureTools.pictureGeometry({ width: 320, height: 240 }, format, { ...settings, callsign: 'W1TEST' });
    const pixels = new Uint8Array(width * height * 3);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const offset = (y * width + x) * 3;
            const red = Math.round(20 + 200 * x / (width - 1));
            const green = Math.round(30 + 180 * y / (height - 1));
            const blue = x < width / 3 ? 200 : 50;
            const luminance = Math.floor(0.3 * red + 0.6 * green + 0.1 * blue);
            pixels[offset] = gray ? luminance : red;
            pixels[offset + 1] = gray ? luminance : green;
            pixels[offset + 2] = gray ? luminance : blue;
        }
    }
    const start = await host.encodeStart({ format, settings, image: { width, height, pixels, gray, format: size } });
    assert.equal(start.rate, 12000);
    const chunks = [];
    let done = false;
    for (let step = 0; step < 10000; step++) {
        const result = host.encodeRead();
        chunks.push(result.samples);
        if (result.done) {
            done = true;
            break;
        }
    }
    assert.ok(done, 'FSQ picture transmission finishes');
    const samples = AudioTools.joinChunks(chunks);
    const bytes = AudioTools.makeWav(samples, start.rate);
    const wav = AudioTools.parseWav(bytes.buffer);
    return { host, format, settings, samples: wav.channels[0], rate: wav.rate, width, height, expected: pixels };
}

async function decodePicture(audio, host, chunkSize = 4096, leadingSamples = 0, tailSeconds = 5) {
    await host.setup({ format: audio.format, settings: audio.settings, rate: audio.rate, preserve: false });
    const samples = AudioTools.joinChunks([new Float32Array(leadingSamples), audio.samples, new Float32Array(audio.rate * tailSeconds)]);
    let firstPictureAt = null;
    let result;
    for (let offset = 0; offset < samples.length; offset += chunkSize) {
        result = await host.process({ samples: samples.subarray(offset, offset + chunkSize) });
        if (result.pixels && firstPictureAt === null) firstPictureAt = offset;
    }
    result = await host.finish();
    return { result, firstPictureAt };
}

function assertPicture(audio, decoded) {
    const { result, firstPictureAt } = decoded;
    assert.deepEqual([result.width, result.height], [audio.width, audio.height], 'picture header opens the receiver');
    assert.ok(firstPictureAt !== null && firstPictureAt < audio.samples.length / 2, 'picture appears progressively before decoding finishes');
    let error = 0;
    const rowErrors = new Float64Array(audio.height);
    for (let pixel = 0; pixel < audio.width * audio.height; pixel++) {
        for (let channel = 0; channel < 3; channel++) {
            const difference = Math.abs(result.pixels[pixel * 4 + channel] - audio.expected[pixel * 3 + channel]);
            error += difference;
            rowErrors[Math.floor(pixel / audio.width)] += difference;
        }
        assert.equal(result.pixels[pixel * 4 + 3], 255);
    }
    assert.ok(error / audio.expected.length < 4, `full image error ${error / audio.expected.length}`);
    for (const row of [0, audio.height - 1]) {
        assert.ok(rowErrors[row] / (audio.width * 3) < 5, `row ${row} remains aligned`);
    }
}

test('FSQ-3 320 × 240 picture with TEST sender appears from the generated WAV', async () => {
    const audio = await encodePicture('TEST', 1);
    const host = await EngineHost.create('fldigi');
    assertPicture(audio, await decodePicture(audio, host));
    assertPicture(audio, await decodePicture(audio, host));
});

for (const callsign of ['W1ABC', 'test', '123', 'ABC/DEF', 'ABCDEFGHIJKLMNOPQRST']) {
    test(`FSQ picture accepts sender ${callsign}, including replay on the transmitting host`, async () => {
        const audio = await encodePicture(callsign);
        const receiver = await EngineHost.create('fldigi');
        const fresh = await decodePicture(audio, receiver);
        const reused = await decodePicture(audio, audio.host, 1024);
        assertPicture(audio, fresh);
        assertPicture(audio, reused);
        assert.deepEqual(reused.result.pixels, fresh.result.pixels, 'sender identity and receive chunk sizes preserve pixels');
    });
}

for (const callsign of ['AB', 'AB-CD', 'ABCDEFGHIJKLMNOPQRSTU']) {
    test(`FSQ picture rejects sender outside the application contract: ${callsign}`, async () => {
        const audio = await encodePicture(callsign);
        const decoded = await decodePicture(audio, await EngineHost.create('fldigi'));
        assert.equal(decoded.firstPictureAt, null);
        assert.equal(decoded.result.pixels, undefined);
    });
}

for (const size of [2, 3, 4, 5, 6, 7]) {
    test(`FSQ picture format ${size} aligns its full raster without manual phase`, async () => {
        const audio = await encodePicture('W1TEST', size);
        assertPicture(audio, await decodePicture(audio, await EngineHost.create('fldigi'), 4096, 137));
    });
}

test('supplied FSQ browser WAV keeps the photograph and edge columns aligned', async () => {
    const bytes = readFileSync(new URL('../../fixtures/fsq-browser-picture.wav', import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), '104aec042a50565dc7e6eb42a1a92452dcce0fd9760f3fbf1b342a1178455c58');
    const expected = readFileSync(new URL('../../fixtures/fsq-browser-picture-expected.rgb', import.meta.url));
    assert.equal(createHash('sha256').update(expected).digest('hex'), '3e0d370a27d5e008ac44f26d27efd4af47d0f1ddb0ef985141680662f2cf9bc8');
    const wav = AudioTools.parseWav(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const format = formats.find(candidate => candidate.family === 'FSQ' && candidate.presetSettings?.fsqImageSize === 1);
    const settings = { ...defaultsFor(format), afc: false, sql: false };
    const audio = { format, settings, samples: wav.channels[0], rate: wav.rate, width: 320, height: 240, expected };
    const host = await EngineHost.create('fldigi');
    const original = await decodePicture(audio, host, 4096, 0, 0);
    const shifted = await decodePicture(audio, host, 131, 733);
    assertPicture(audio, original);
    assertPicture(audio, shifted);
    let error = 0;
    for (let y = 0; y < audio.height; y++) {
        for (const x of [0, 1, 2, 317, 318, 319]) {
            for (let channel = 0; channel < 3; channel++) {
                error += Math.abs(original.result.pixels[(y * 320 + x) * 4 + channel] - expected[(y * 320 + x) * 3 + channel]);
            }
        }
    }
    assert.ok(error / (audio.height * 6 * 3) < 4, 'left and right edges retain their source colors');
});
