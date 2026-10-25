import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { AudioTools } from '../../../src/app/audio.js';

const require = createRequire(import.meta.url);
const { loadCore } = require('../load-legacy.cjs');
const createCore = loadCore('multimode');
const recordings = [
    ['SCAMPOOK', 'scampook-desktop.wav', 'SCAMPOOK TEST', 'e9526a08a9e6fbc5c4a93798eb799366febeee5b910f993c9f2a1f1bf3e30ab0'],
    ['SCFSKFST', 'scfskfst-desktop.wav', 'SCFSKFST TEST', '25c99f5935a163254f2c97124f44b3fa7b7e97ae33dae5c463fc180753c61ce7']
];

function decode(core, mode, recording, gain, leadingSeconds, chunkSize, burst = false) {
    core._web_create(mode.id);
    core._web_set_frequency(1000);
    core._web_set_option(1, 0);
    const pointer = core._malloc(chunkSize * 4);
    const samples = new Float32Array(Math.ceil(leadingSeconds * recording.rate) + recording.channels[0].length + recording.rate);
    if (burst) {
        for (let index = 0; index < 80; index++) samples[index] = Math.sin(2 * Math.PI * 1000 * index / recording.rate);
    }
    samples.set(Float32Array.from(recording.channels[0], sample => sample * gain), Math.ceil(leadingSeconds * recording.rate));
    let text = '';
    try {
        for (let offset = 0; offset < samples.length; offset += chunkSize) {
            const chunk = samples.subarray(offset, offset + chunkSize);
            core.HEAPF32.set(chunk, pointer / 4);
            core._web_process(pointer, chunk.length);
            text += core.UTF8ToString(core._web_take_text());
        }
        core._web_flush();
        return text + core.UTF8ToString(core._web_take_text());
    } finally {
        core._free(pointer);
    }
}

for (const [name, filename, expected, hash] of recordings) {
    test(`${name} recovers the independent desktop recording from cold state`, async () => {
        const bytes = await readFile(new URL(`../../fixtures/${filename}`, import.meta.url));
        assert.equal(createHash('sha256').update(bytes).digest('hex'), hash);
        const recording = AudioTools.parseWav(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
        assert.equal(recording.rate, 8000);
        assert.equal(recording.channels.length, 1);
        const core = await createCore();
        const mode = JSON.parse(core.UTF8ToString(core._web_modes())).find(candidate => candidate.name === name);
        for (const [gain, leadingSeconds, chunkSize, burst] of [[1, 0, 4096], [0.5, 0, 131], [0.1, 0.5, 512], [1, 3, 2048], [1, 10, 4096], [0.03, 3, 512], [0.1, 0.01, 4096, true], [0.1, 0.06, 512, true], [0.1, 0.11, 131, true], [0.1, 0.21, 2048, true], [0.1, 0.51, 4096, true]]) {
            assert.ok(decode(core, mode, recording, gain, leadingSeconds, chunkSize, burst).includes(expected), `${name}, gain ${gain}, leading quiet ${leadingSeconds}s, chunks ${chunkSize}, loud burst ${!!burst}`);
        }
    });
}
