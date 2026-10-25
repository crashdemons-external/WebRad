import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { EngineHost } from '../../../build/out/app/engine-host.js';
import { AudioTools } from '../../../src/app/audio.js';
import { defaultsFor } from '../../../src/app/settings.js';

const formats = JSON.parse(readFileSync(new URL('../../../build/out/formats.json', import.meta.url), 'utf8')).formats;
const recordings = [
    {
        key: 'mfsk16',
        filename: 'fldigi-picture-mfsk16.wav',
        mode: 'MFSK16',
        width: 32,
        height: 24,
        sha256: '5906ce320aeaf3cc30a674456a6eae8089850b781c15f7d5d93a070d402790fd',
        checkFourPatches: true
    },
    {
        key: 'thor16',
        filename: 'fldigi-picture-thor16.wav',
        mode: 'THOR16',
        width: 59,
        height: 74,
        sha256: 'cf4a794ee3d32a7c5153a7957dc3ecb2095c52ff6afe9eff3d5cfcf2dcdaf1d2',
        checkFourPatches: true,
        checkCorrection: true
    },
    {
        key: 'thor25',
        filename: 'fldigi-picture-thor25.wav',
        mode: 'THOR25',
        width: 59,
        height: 74,
        sha256: 'de1c02dc69e4f16fe80c545b1bd9c707cc6d8413d903bc55b5a186525362e2b8',
        checkFourPatches: true,
        checkCorrection: true
    },
    {
        key: 'ifkp',
        filename: 'fldigi-picture-ifkp.wav',
        mode: 'IFKP 1.0× · 160 × 120 color (usual)',
        width: 160,
        height: 120,
        sha256: 'ae7d0cae6b95573842bb41f527e45a16427ac6811cb0c89ee3eb3e9e6be5ad60',
        checkFourPatches: true,
        checkCorrection: true
    },
    {
        key: 'fsq160',
        filename: 'fldigi-picture-fsq160.wav',
        mode: 'FSQ picture · 160 × 120 color',
        width: 160,
        height: 120,
        sha256: '85b4a5d687387303900a197b7cf15c2aba62931f10473f0a852fed404abc0621',
        checkFourPatches: true,
        checkCorrection: true
    },
    {
        key: 'fsq320',
        filename: 'fldigi-picture-fsq320.wav',
        mode: 'FSQ-3 · 320 × 240 color (usual)',
        width: 320,
        height: 240,
        sha256: '512d9215f0076bffbfa3717263393f8222612a78891476edc339aa67585cd97f',
        checkFourPatches: true,
        checkCorrection: true
    },
    {
        key: 'fsqEmptySender',
        filename: 'fldigi-picture-fsq-empty-sender.wav',
        mode: 'FSQ picture · 160 × 120 color',
        width: 0,
        height: 0,
        sha256: 'f9ae03287dc697ff1ac03b0e270ae6c49644ec0ebdce555455ab6355f32c5ccb'
    }
];

async function loadRecording(recording) {
    const bytes = await readFile(new URL(`../../fixtures/${recording.filename}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), recording.sha256, `${recording.key}: fixture hash`);
    const wav = AudioTools.parseWav(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    assert.equal(wav.rate, 8000, `${recording.key}: sample rate`);
    assert.equal(wav.channels.length, 1, `${recording.key}: channel count`);
    return wav;
}

function formatFor(recording) {
    const format = formats.find(candidate => candidate.engine === 'fldigi' && candidate.name === recording.mode);
    assert.ok(format, `${recording.key}: missing ${recording.mode} catalog preset`);
    return format;
}

async function decode(recording, wav, chunkSize) {
    const format = formatFor(recording);
    const host = await EngineHost.create('fldigi');
    await host.setup({
        format,
        settings: { ...defaultsFor(format), frequency: 1500, afc: false, sql: false },
        rate: wav.rate,
        preserve: false
    });
    const samples = wav.channels[0];
    let text = '';
    for (let offset = 0; offset < samples.length; offset += chunkSize) {
        const result = await host.process({ samples: samples.subarray(offset, offset + chunkSize) });
        text += result.text || '';
    }
    for (let offset = 0; offset < wav.rate * 5; offset += chunkSize) {
        const length = Math.min(chunkSize, wav.rate * 5 - offset);
        const result = await host.process({ samples: new Float32Array(length) });
        text += result.text || '';
    }
    const result = await host.finish();
    text += result.text || '';

    const raw = host.image
        ? { width: host.image.width, height: host.image.height, pixels: host.image.pixels.slice() }
        : null;
    return { host, raw, text };
}

function assertFourPatchColors(image, name) {
    const expectedColors = [
        [220, 180, 30],
        [40, 180, 210],
        [220, 70, 30],
        [40, 70, 210]
    ];
    const positions = [
        [0.25, 0.25],
        [0.75, 0.25],
        [0.25, 0.75],
        [0.75, 0.75]
    ];
    for (let patch = 0; patch < positions.length; patch++) {
        const [xRatio, yRatio] = positions[patch];
        const offset = (Math.floor(yRatio * image.height) * image.width + Math.floor(xRatio * image.width)) * 4;
        for (let channel = 0; channel < 3; channel++)
            assert.ok(
                Math.abs(image.pixels[offset + channel] - expectedColors[patch][channel]) <= 2,
                `${name}: patch ${patch + 1} channel ${channel} expected ${expectedColors[patch][channel]}, got ${image.pixels[offset + channel]}`
            );
    }
}

function meanFourPatchError(image) {
    let error = 0;
    for (let row = 0; row < image.height; row++) {
        for (let column = 0; column < image.width; column++) {
            const expected = [column < image.width / 2 ? 220 : 40, row < image.height / 2 ? 180 : 70, column < image.width / 2 ? 30 : 210];
            const offset = (row * image.width + column) * 4;
            for (let channel = 0; channel < 3; channel++) error += Math.abs(image.pixels[offset + channel] - expected[channel]);
        }
    }
    return error / (image.width * image.height * 3);
}

for (const recording of recordings) {
    test(`${recording.key} decodes its independent desktop picture capture`, async () => {
        const wav = await loadRecording(recording);
        const { host, raw, text } = await decode(recording, wav, 4096);
        if (recording.width) {
            assert.ok(raw, `${recording.key}: picture header was not recognized`);
            assert.deepEqual([raw.width, raw.height], [recording.width, recording.height]);
            if (recording.checkFourPatches) assertFourPatchColors(raw, recording.key);
            if (recording.key.startsWith('thor'))
                assert.ok(meanFourPatchError(raw) < 3, `${recording.key}: marker acquisition recovers the full source raster, including boundaries`);
            if (recording.key.startsWith('fsq')) {
                assert.equal(host.image.channels, 3);
                assert.equal(host.image.reverse, true);
                assert.ok(meanFourPatchError(raw) < 2, `${recording.key}: automatic alignment recovers the full source raster, including boundaries`);
            }
            if (recording.checkCorrection) {
                const unchanged = host.image.pixels.slice();
                const zeroCorrection = host.redraw({ phase: 0, ppm: 0 });
                assert.deepEqual(zeroCorrection.pixels, raw.pixels, `${recording.key}: zero correction restores raw pixels`);

                const shifted = host.redraw({ phase: 54, ppm: 0 });
                assert.notDeepEqual(shifted.pixels, raw.pixels, `${recording.key}: manual phase correction moves the source stream`);
                assert.deepEqual(host.image.pixels, unchanged, `${recording.key}: redraw preserves retained source pixels`);
            }
            if (recording.key.startsWith('fsq')) assert.match(text, /W1TEST/i, `${recording.key}: sender header text`);
        } else {
            assert.equal(raw, null, 'empty-sender FSQ must not create an image');
            assert.match(text, /allcall/i, 'empty-sender FSQ still decodes its valid non-picture header');
        }
    });
}

test('FSQ160 desktop picture is independent of receive chunk boundaries', async () => {
    const recording = recordings.find(candidate => candidate.key === 'fsq160');
    const wav = await loadRecording(recording);
    const largeChunks = await decode(recording, wav, 4096);
    const smallChunks = await decode(recording, wav, 131);
    assert.deepEqual([smallChunks.raw?.width, smallChunks.raw?.height], [recording.width, recording.height]);
    for (let index = 0; index < largeChunks.raw.pixels.length; index++)
        assert.ok(
            Math.abs(smallChunks.raw.pixels[index] - largeChunks.raw.pixels[index]) <= 1,
            `FSQ160 pixel component ${index} differs by more than one level across chunk sizes`
        );
});
