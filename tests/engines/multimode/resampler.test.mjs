import assert from 'node:assert/strict';
import { Resampler } from '../../../src/runtime/engines/multimode/resampler.js';
function sine(rate, hz, seconds = 1) {
    return Float32Array.from({ length: rate * seconds }, (_, i) => Math.sin((2 * Math.PI * hz * i) / rate));
}
function convert(rate, hz, chunk = 2048, outputRate = 8000) {
    const input = sine(rate, hz),
        r = new Resampler(rate, outputRate),
        result = [];
    for (let i = 0; i < input.length; i += chunk) result.push(...r.process(input.subarray(i, i + chunk)));
    return result;
}
function rms(samples) {
    return Math.sqrt(samples.slice(100, -100).reduce((a, v) => a + v * v, 0) / (samples.length - 200));
}
for (const rate of [8000, 11025, 16000, 44100, 48000]) {
    const whole = convert(rate, 1500, rate),
        chunks = convert(rate, 1500, 137);
    assert.ok(Math.abs(chunks.length - 8000) < 32, `Output timing at ${rate}`);
    assert.equal(chunks.length, whole.length, `Block boundary timing at ${rate}`);
    assert.ok(
        chunks.every((v, i) => Math.abs(v - whole[i]) < 0.004),
        `Signal continuity at ${rate}`
    );
    assert.ok(Math.abs(rms(chunks) - Math.SQRT1_2) < 0.01, `Passband amplitude at ${rate}`);
}
assert.ok(rms(convert(48000, 12000)) < 0.001, 'Frequencies above modem Nyquist must not alias into decoding');
assert.deepEqual(convert(8000, 1371, 131, 12000), convert(8000, 1371, 8000, 12000), 'FSQ input upsampling keeps identical fractional phases across receive chunk sizes');
console.log('Passed: streaming conversion at 8/11.025/16/44.1/48 kHz, chunk continuity, and alias suppression.');
