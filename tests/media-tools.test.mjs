import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioTools } from '../src/app/audio.js';
import { PictureTools } from '../src/app/pictures.js';
import { FormatPresets } from '../src/app/presets.js';
import { defaultsFor, groupsFor, restoreSettings, settingsVersion, validateSettings } from '../src/app/settings.js';

function wav(encoding, bits, samples, channels = 1) {
    const bytes = new Uint8Array(44 + samples.length);
    const view = new DataView(bytes.buffer);
    const tag = (at, text) => bytes.set(new TextEncoder().encode(text), at);
    tag(0, 'RIFF');
    view.setUint32(4, bytes.length - 8, true);
    tag(8, 'WAVE');
    tag(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, encoding, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, 8000, true);
    view.setUint32(28, 8000 * channels * bits / 8, true);
    view.setUint16(32, channels * bits / 8, true);
    view.setUint16(34, bits, true);
    tag(36, 'data');
    view.setUint32(40, samples.length, true);
    bytes.set(samples, 44);
    return bytes.buffer;
}

test('WAV readers preserve unsigned, signed and floating-point samples across channel layouts', () => {
    const cases = [
        [1, 8, [0, 128, 192], [-1, 0, 0.5]],
        [1, 16, [0, 128, 0, 0, 0, 64], [-1, 0, 0.5]],
        [1, 24, [0, 0, 128, 0, 0, 0, 0, 0, 64], [-1, 0, 0.5]],
        [1, 32, [0, 0, 0, 128, 0, 0, 0, 0, 0, 0, 0, 64], [-1, 0, 0.5]],
        [3, 32, [0, 0, 128, 191, 0, 0, 0, 0, 0, 0, 0, 63], [-1, 0, 0.5]],
        [3, 64, [0, 0, 0, 0, 0, 0, 240, 191, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 224, 63], [-1, 0, 0.5]]
    ];
    for (const [encoding, bits, samples, expected] of cases) {
        const recording = AudioTools.parseWav(wav(encoding, bits, samples));
        assert.deepEqual([...recording.channels[0]], expected, `${encoding}/${bits}`);
        assert.equal(recording.rate, 8000);
        assert.equal(recording.duration, expected.length / 8000);
    }
    const stereo = AudioTools.parseWav(wav(1, 16, [0, 128, 0, 64, 0, 0, 0, 192], 2));
    assert.deepEqual(stereo.channels.map(channel => [...channel]), [[-1, 0], [0.5, -0.5]]);
    assert.deepEqual([...AudioTools.parseWav(wav(3, 32, [0, 0, 128, 127, 0, 0, 192, 127])).channels[0]], [0, 0]);
    assert.equal(AudioTools.parseWav(wav(6, 8, [0, 1])), null);
    assert.throws(() => AudioTools.parseWav(wav(1, 64, [0, 0, 0, 0, 0, 0, 0, 0])), /invalid PCM WAV layout/);
});

test('picture preparation keeps fit/crop placement, grayscale and packed RGB output', t => {
    const previousDocument = globalThis.document;
    const previousImageData = globalThis.ImageData;
    const draws = [];
    globalThis.ImageData = class {
        constructor(data, width, height) { Object.assign(this, { data, width, height }); }
    };
    globalThis.document = {
        createElement(name) {
            assert.equal(name, 'canvas');
            const canvas = { width: 0, height: 0 };
            canvas.getContext = () => ({
                fillRect() {},
                putImageData(image) { canvas.image = image; },
                drawImage(source, ...placement) { draws.push(placement); },
                getImageData() {
                    const data = new Uint8ClampedArray(canvas.width * canvas.height * 4);
                    for (let at = 0; at < data.length; at += 4) data.set([100, 150, 200, 255], at);
                    return { data };
                }
            });
            return canvas;
        }
    };
    t.after(() => {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
        if (previousImageData === undefined) delete globalThis.ImageData;
        else globalThis.ImageData = previousImageData;
    });
    const source = { width: 4, height: 2, pixels: new Uint8ClampedArray(32) };
    const sstv = PictureTools.preparePicture(source, { engine: 'sstv', width: 4, height: 4 }, {}, 'fit');
    assert.deepEqual(draws.pop(), [0, 1, 4, 2]);
    assert.equal(sstv.pixels, sstv.preview);
    PictureTools.preparePicture(source, { engine: 'sstv', width: 4, height: 4 }, {}, 'crop');
    assert.deepEqual(draws.pop(), [-2, 0, 8, 4]);
    const mfsk = PictureTools.preparePicture(source, { engine: 'fldigi', family: 'MFSK' }, {
        imageColor: 'gray', imageWidth: 4, imageSpp: 4
    }, 'fit');
    assert.deepEqual([...mfsk.pixels.slice(0, 3)], [138, 138, 138]);
    assert.deepEqual([...mfsk.preview.slice(0, 4)], [138, 138, 138, 255]);
    assert.equal(mfsk.pixels.length, 4 * 2 * 3);
    assert.equal(mfsk.spp, 4);
    const fax = PictureTools.preparePicture(source, { engine: 'fax', width: 8 }, {}, 'fit');
    assert.equal(fax.height, 4);
    assert.equal(fax.gray, true);
    assert.throws(() => PictureTools.preparePicture(source, { engine: 'fldigi', family: 'FSQ' }, {
        fsqImageSize: 0, callsign: ''
    }, 'fit'), /sender callsign/);
});

test('FSQ preset labels describe the transmitted header color without changing saved IDs', () => {
    const base = { id: 'fldigi-162', engine: 'fldigi', family: 'FSQ', name: 'FSQ', inputs: ['text', 'picture'], outputs: ['text', 'picture'] };
    const presets = FormatPresets.fsqPresets(base).filter(preset => preset.inputs.includes('picture'));
    assert.equal(presets.length, 8);
    for (const preset of presets) {
        const size = preset.presetSettings.fsqImageSize;
        const gray = [2, 5, 7].includes(size);
        const geometry = PictureTools.pictureGeometry({ width: 320, height: 240 }, preset, { fsqImageSize: size, callsign: 'W1ABC' });
        assert.equal(preset.id, size === 1 ? base.id : `${base.id}-picture-${size}`);
        assert.equal(geometry.gray, gray);
        assert.ok(preset.name.includes(gray ? 'grayscale' : 'color'), preset.name);
        assert.ok(preset.presetDescription.includes(gray ? 'grayscale' : 'color'), preset.presetDescription);
        assert.ok(preset.name.includes(`${geometry.width} × ${geometry.height}`));
    }
});

test('grayscale preparation matches fldigi reference colors and preserves alpha', () => {
    const colors = [255, 0, 0, 17, 0, 255, 0, 64, 0, 0, 255, 128, 220, 180, 30, 255];
    for (const [format, expected] of [
        [{ engine: 'fldigi', family: 'MFSK' }, [79, 155, 20, 180]],
        [{ engine: 'fax' }, [79, 155, 20, 180]],
        [{ engine: 'fldigi', family: 'THOR' }, [76, 153, 25, 177]],
        [{ engine: 'fldigi', family: 'IFKP' }, [76, 153, 25, 177]],
        [{ engine: 'fldigi', family: 'FSQ' }, [76, 153, 25, 177]]
    ]) {
        const pixels = new Uint8ClampedArray(colors);
        PictureTools.makeGrayscale(pixels, format);
        for (let index = 0; index < expected.length; index++) {
            assert.deepEqual([...pixels.slice(index * 4, index * 4 + 3)], new Array(3).fill(expected[index]));
            assert.equal(pixels[index * 4 + 3], colors[index * 4 + 3]);
        }
    }
});

test('OFDM3500 defaults and old saved tuning match its native fixed transmitter', () => {
    const format = { engine: 'fldigi', family: 'PSK', name: 'OFDM3500' };
    assert.equal(defaultsFor(format).frequency, 2250);
    assert.equal(validateSettings(format, {}).frequency, 2250);
    assert.equal(restoreSettings(format, { frequency: 1500 }, 2).frequency, 2250);
    assert.equal(restoreSettings(format, { frequency: 2100 }, 2).frequency, 2100);
    assert.equal(restoreSettings(format, { frequency: 1500 }, settingsVersion).frequency, 1500);
    assert.equal(defaultsFor({ ...format, name: 'BPSK31' }).frequency, 1500);
});

test('modem picture correction shifts the serialized RGB/BGR scan without changing the raw image', () => {
    for (const [reverse, raw, expected] of [
        [false, [1, 3, 5, 255, 2, 4, 6, 255], [0, 2, 4, 255, 1, 3, 5, 255]],
        [true, [5, 3, 1, 255, 6, 4, 2, 255], [4, 2, 0, 255, 5, 3, 1, 255]]
    ]) {
        const image = { width: 2, height: 1, channels: 3, reverse, pixels: new Uint8ClampedArray(raw) };
        assert.deepEqual([...PictureTools.correctModemPicture(image, 1, 0)], expected);
        assert.deepEqual([...image.pixels], raw);
        const restored = PictureTools.correctModemPicture(image, 0, 0);
        assert.deepEqual([...restored], raw);
        assert.notEqual(restored, image.pixels);
    }
    const gray = { width: 2, height: 2, channels: 1, pixels: new Uint8ClampedArray([
        10, 10, 10, 255, 20, 20, 20, 255, 30, 30, 30, 255, 40, 40, 40, 255
    ]) };
    assert.deepEqual([...PictureTools.correctModemPicture(gray, 1)], [
        0, 0, 0, 255, 10, 10, 10, 255, 20, 20, 20, 255, 30, 30, 30, 255
    ]);
    assert.deepEqual([...PictureTools.correctModemPicture(gray, 0, 1000000)], [
        10, 10, 10, 255, 30, 30, 30, 255, 0, 0, 0, 255, 0, 0, 0, 255
    ]);
    assert.throws(() => PictureTools.correctModemPicture(gray, NaN), /finite/);
    assert.throws(() => PictureTools.correctModemPicture(gray, 0, -1000000), /finite/);
});

test('modem picture phase and slant controls belong to reception and preserve saved defaults', () => {
    for (const family of ['THOR', 'IFKP', 'FSQ']) {
        const format = { engine: 'fldigi', family, name: family };
        const decodeFields = groupsFor(format, 'decode').flatMap(group => group.fields);
        const encodeFields = groupsFor(format, 'encode').flatMap(group => group.fields);
        assert.ok(decodeFields.some(field => field.key === 'picturePhasePixels'));
        assert.ok(decodeFields.some(field => field.key === 'pictureSlantPpm'));
        assert.ok(!encodeFields.some(field => field.key === 'picturePhasePixels'));
        assert.equal(defaultsFor(format).picturePhasePixels, 0);
        assert.equal(defaultsFor(format).pictureSlantPpm, 0);
        const saved = restoreSettings(format, { picturePhasePixels: 45, pictureSlantPpm: -100 }, settingsVersion);
        assert.equal(saved.picturePhasePixels, 45);
        assert.equal(saved.pictureSlantPpm, -100);
    }
    assert.ok(!groupsFor({ engine: 'fldigi', family: 'MFSK', name: 'MFSK16' }).some(group => group.title === 'Received picture correction'));
});
