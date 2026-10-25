import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createEncoderSession } from '../../../src/runtime/engines/multimode/encoder-session.js';
import { createDecoderSession } from '../../../src/runtime/engines/multimode/decoder-session.js';
import { defaults } from '../../../src/runtime/engines/multimode/configuration.js';

const require = createRequire(import.meta.url);
const createCore = require('../load-legacy.cjs').loadCore('multimode');
const tx = await createCore();
const rx = await createCore();
const mode = JSON.parse(tx.UTF8ToString(tx._web_modes())).find((entry) => entry.name === 'CW');
let output;
const encoder = createEncoderSession(tx, (message) => { output = message; });
let decoded = '';
const decoder = createDecoderSession(rx, (message) => {
    if (message.type === 'decoded') decoded += message.text;
});
let job = 0;
for (const frequency of [700, 800, 1600]) {
    for (const cwSpeed of [5, 18, 21, 25, 40]) {
        for (const text of ['test', 'testt', 'teste', 'testi', 'testa', 'testn', 'testm', '/CAKEWALK/']) {
            const settings = { ...defaults, mode: mode.id, frequency, cwSpeed };
            job++;
            decoded = '';
            decoder.handle({ type: 'reset', generation: job });
            decoder.handle({ type: 'configure', generation: job, sequence: 1, retune: true, settings });
            encoder.handle({ type: 'start', job, text, settings });
            const rate = output.rate;
            do {
                encoder.handle({ type: 'pull', job, maximum: 137 });
                decoder.handle({ type: 'audio', generation: job, rate, samples: output.samples });
            } while (!output.done);
            decoder.handle({ type: 'flush', generation: job });
            assert.equal(decoded.trim(), text.toUpperCase(), `${frequency} Hz, ${cwSpeed} WPM: ${text}`);
            const completed = decoded;
            decoder.handle({ type: 'flush', generation: job });
            assert.equal(decoded, completed, 'repeated flush must not duplicate the last character');
        }
    }
}
// Default speed tracking must acquire a faster sender from its first dash.
for (const frequency of [700, 800, 1600]) {
    for (const cwSpeed of [21, 25]) {
        for (const text of ['DFAS', 'TEST', '/CAKEWALK/']) {
            const settings = { ...defaults, mode: mode.id, frequency, cwSpeed };
            job++;
            decoded = '';
            decoder.handle({ type: 'reset', generation: job });
            decoder.handle({ type: 'configure', generation: job, sequence: 1, retune: true,
                settings: { ...settings, cwSpeed: 18, cwTrack: true } });
            encoder.handle({ type: 'start', job, text, settings });
            const rate = output.rate;
            do {
                encoder.handle({ type: 'pull', job, maximum: 137 });
                decoder.handle({ type: 'audio', generation: job, rate, samples: output.samples });
            } while (!output.done);
            decoder.handle({ type: 'flush', generation: job });
            assert.equal(decoded.trim(), text.toUpperCase(), `default tracking: ${text}, ${frequency} Hz, ${cwSpeed} WPM`);
        }
    }
}
// Reconfiguration and reset must clear per-instance Morse timing state.
{
    const text = 'DFAS';
    const settings = { ...defaults, mode: mode.id, frequency: 800, cwSpeed: 25 };
    encoder.handle({ type: 'start', job: ++job, text, settings });
    const samples = [];
    do {
        encoder.handle({ type: 'pull', job, maximum: 137 });
        samples.push(...output.samples);
    } while (!output.done);
    const audio = Float32Array.from(samples);
    for (let replay = 0; replay < 2; replay++) {
        decoded = '';
        decoder.handle({ type: 'reset', generation: ++job });
        decoder.handle({ type: 'configure', generation: job, sequence: 1, retune: true,
            settings: { ...settings, cwSpeed: 18, cwTrack: true } });
        for (let at = 0; at < audio.length; at += 137)
            decoder.handle({ type: 'audio', generation: job, rate: output.rate, samples: audio.subarray(at, at + 137) });
        decoder.handle({ type: 'flush', generation: job });
        assert.equal(decoded.trim(), text, `reset/reconfigure replay ${replay + 1}`);
    }
}
// Independent keyed sine waves catch carrier-phase failures without relying on the transmitter.
const letters = { T: '-', E: '.', S: '...' };
for (const rate of [8000, 11025, 44100, 48000]) {
    for (const phase of [0, Math.PI / 2]) {
        const segments = [];
        const dot = 1.2 / 21;
        for (const [index, letter] of [...'TEST'].entries()) {
            if (index) segments.push([false, 3]);
            for (const [element, symbol] of [...letters[letter]].entries()) {
                if (element) segments.push([false, 1]);
                segments.push([true, symbol === '.' ? 1 : 3]);
            }
        }
        const samples = [];
        let position = 0;
        for (const [tone, units] of segments) {
            const end = position + Math.round(units * dot * rate);
            while (position < end) {
                samples.push(tone ? 0.8 * Math.sin(2 * Math.PI * 800 * position / rate + phase) : 0);
                position++;
            }
        }
        const audio = Float32Array.from(samples);
        job++;
        decoded = '';
        decoder.handle({ type: 'reset', generation: job });
        decoder.handle({
            type: 'configure', generation: job, sequence: 1, retune: true,
            settings: { ...defaults, mode: mode.id, frequency: 800, cwSpeed: 21 }
        });
        for (let at = 0; at < audio.length; at += 137) {
            decoder.handle({ type: 'audio', generation: job, rate, samples: audio.subarray(at, at + 137) });
        }
        decoder.handle({ type: 'flush', generation: job });
        assert.equal(decoded.trim(), 'TEST', `800 Hz carrier phase ${phase}, ${rate} Hz input`);
    }
}
decoder.dispose();
console.log('Passed: Morse final characters, 700/800/1600 Hz, 5–40 WPM, partial blocks and repeated flush.');
