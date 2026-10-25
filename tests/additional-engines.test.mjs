import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EngineHost } from '../build/out/app/engine-host.js';
import { defaultsFor, validateSettings, groupsFor } from '../build/out/app/settings.js';
import { joinChunks, makeWav, parseWav } from '../build/out/app/audio.js';
const formats = JSON.parse(await readFile(new URL('../build/out/formats.json', import.meta.url))).formats;
const find = (id) => formats.find((format) => format.id === id);
const hosts = new Map();
async function host(engine) {
    if (!hosts.has(engine)) hosts.set(engine, await EngineHost.create(engine));
    return hosts.get(engine);
}
async function encode(format, args, overrides = {}) {
    const engine = await host(format.engine);
    const settings = validateSettings(format, { ...defaultsFor(format), ...overrides });
    const { rate } = await engine.encodeStart({ format, settings, ...args });
    const chunks = [];
    for (let i = 0; i < 10000; i++) {
        const result = engine.encodeRead();
        chunks.push(result.samples);
        if (result.done) return { samples: joinChunks(chunks), rate, settings };
    }
    throw Error('Encoder did not finish.');
}
async function decode(format, audio, overrides = {}) {
    const engine = await host(format.engine);
    const settings = validateSettings(format, { ...audio.settings, ...overrides });
    await engine.setup({ format, settings, rate: audio.rate });
    const output = { text: '' };
    const capture = (result) => {
        output.text += result.text || '';
        if (result.file) output.file = result.file;
        if (result.finished) output.finished = result.finished;
    };
    for (let at = 0; at < audio.samples.length; at += 997) capture(await engine.process({ samples: audio.samples.subarray(at, at + 997) }));
    capture(await engine.finish());
    return output;
}
for (const format of formats.filter((format) => format.engine === 'terminal')) {
    test(format.name + ' recovers arbitrary bytes from generated WAV', async () => {
        const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
        const audio = await encode(format, { bytes });
        const wav = parseWav(makeWav(audio.samples, audio.rate).buffer);
        const result = await decode(format, { ...audio, samples: wav.channels[0], rate: wav.rate });
        assert.deepEqual(result.file?.bytes, bytes);
    });
}
test('serial parity, seven-bit characters and repeated jobs remain independent', async () => {
    const format = find('terminal-custom');
    for (const parity of [1, 2]) {
        const audio = await encode(format, { text: 'THE KEY IS UNDER THE CLOCK. 1234567890' }, { serialBits: 7, serialParity: parity, serialStop: 2 });
        assert.equal((await decode(format, audio)).text, 'THE KEY IS UNDER THE CLOCK. 1234567890');
    }
    await assert.rejects(encode(format, { bytes: new Uint8Array([255]) }, { serialBits: 7 }), /more data bits/);
});
test('MDC single and double packets recover radio ID, operation and extra bytes', async () => {
    const format = find('dispatch-mdc');
    const simple = await encode(format, { text: '12AB' });
    assert.match((await decode(format, simple)).text, /radio 12AB, operation 01, argument 00/);
    const double = await encode(format, { text: 'FEDC' }, { mdcDouble: true, mdcOperation: 53, mdcArgument: 129, mdcExtra: 0x12345678 });
    assert.match((await decode(format, double)).text, /radio FEDC, operation 35, argument 81, extra bytes 12345678/);
    await assert.rejects(encode(format, { text: 'hello' }), /four hexadecimal/);
});
const picture = (width, height) => ({ width, height, pixels: Uint8Array.from({ length: width * height * 4 }, (_, i) => {
    if (i % 4 === 3) return 255;
    const at = Math.floor(i / 4), x = at % width, y = Math.floor(at / width);
    return ((Math.floor(x / (width / 8)) + Math.floor(y / (height / 4))) % 2) ? 240 : 10;
}) });
test('spectrogram audio reveals the encoded checkerboard as a downloadable picture', async () => {
    const format = find('spectrum-picture'), image = picture(160, 96);
    const audio = await encode(format, { image });
    const decoded = (await decode(format, audio)).finished;
    assert.equal(decoded.width, image.width);
    assert.equal(decoded.height, image.height);
    let bright = 0, dark = 0, brightCount = 0, darkCount = 0;
    for (let y = 6; y < 90; y++) for (let x = 4; x < 156; x++) {
        if (x % 20 < 3 || y % 24 < 3) continue;
        const at = (y * 160 + x) * 4;
        if (image.pixels[at] > 100) { bright += decoded.pixels[at]; brightCount++; }
        else { dark += decoded.pixels[at]; darkCount++; }
    }
    assert.ok(bright / brightCount > dark / darkCount + 70, `Recovered contrast ${bright / brightCount} vs ${dark / darkCount}`);
});
test('satellite picture audio decodes in both channels and resets between recordings', async () => {
    const format = find('apt-picture');
    const image = picture(909, 32);
    const audio = await encode(format, { image }, { aptHeight: 32 });
    for (const aptChannel of [0, 1]) {
        const decoded = (await decode(format, audio, { aptChannel })).finished;
        assert.equal(decoded.width, 909);
        assert.ok(decoded.height >= 30 && decoded.height <= 36);
        const row = decoded.pixels.subarray(909 * 4 * 10, 909 * 4 * 11);
        const values = Array.from(row).filter((_, i) => i % 4 === 0);
        assert.ok(Math.max(...values) - Math.min(...values) > 150);
        let best = 0;
        for (let border = 0; border < 5; border++) {
            let correct = 0, count = 0;
            for (let y = 3; y < 29 && y + border < decoded.height; y += 4) for (let x = 55; x < 909; x += 114) {
                const expected = image.pixels[(y * 909 + x) * 4] > 128;
                const actual = decoded.pixels[((y + border) * 909 + x) * 4] > 128;
                if (expected === actual) correct++;
                count++;
            }
            best = Math.max(best, correct / count);
        }
        assert.ok(best > 0.8, 'The recovered image retains the transmitted checkerboard layout.');
    }
    const blank = await decode(format, { ...audio, samples: new Float32Array(12000) });
    if (blank.finished) assert.ok(blank.finished.height < 3);
});
test('standalone catalogs expose useful controls and reception-only formats cannot be encoded', async () => {
    for (const format of formats.filter((format) => ['terminal', 'spectrum', 'dispatch', 'apt', 'beacon', 'aircraft'].includes(format.engine))) {
        assert.ok(groupsFor(format).length);
        assert.ok(format.presetDescription.length > 100);
    }
    await assert.rejects(encode(find('dispatch-fleet'), { text: '1234' }), /reception only/);
    const format = find('spectrum-picture');
    await assert.rejects(encode(format, { image: picture(160, 96) }, { spectralLow: 4500, spectralHigh: 300 }), /wider frequency/);
});

test('WSPR recovers callsign, location and power from a two-minute beacon', async () => {
    const format = find('beacon-wspr');
    const audio = await encode(format, { text: 'K1ABC FN42 30' });
    assert.equal(audio.samples.length, 120 * audio.rate);
    assert.match((await decode(format, audio)).text, /K1ABC FN42 30/);
    await assert.rejects(encode(format, { text: 'nonsense' }), /callsign/);
    await assert.rejects(encode(format, { text: 'K1ABC FN42 31' }), /Power/);
    await assert.rejects(decode(format, { ...audio, samples: audio.samples.subarray(0, 12000) }), /two-minute/);
});
test('ACARS recovers addressed ASCII messages and rejects unsupported text or malformed headers', async () => {
    const format = find('aircraft-acars');
    const audio = await encode(format, { text: 'TEST FLIGHT CLUE\nMEET AT GATE 12' });
    assert.match((await decode(format, audio)).text, /Aircraft \.N12345 · mode 2 · label H1 · block 1: TEST FLIGHT CLUE\nMEET AT GATE 12/);
    const custom = await encode(format, { text: '0123456789'.repeat(22) }, { aircraftAddress: 'N654321', aircraftLabel: 'Q0', aircraftBlock: 'A' });
    assert.match((await decode(format, custom)).text, /Aircraft N654321 · mode 2 · label Q0 · block A:/);
    assert.ok((await decode(format, custom)).text.includes('0123456789'.repeat(22)));
    await assert.rejects(encode(format, { text: 'é' }), /ASCII/);
    await assert.rejects(encode(format, { text: 'OK' }, { aircraftLabel: 'BAD' }), /exactly 2/);
});
test('APRS position builder roundtrips ordinary and compressed coordinates with altitude', async () => {
    const format = find('packet-aprs');
    for (const compressed of [false, true]) {
        const audio = await encode(format, { text: 'MEET HERE' }, { aprsSender: 'K1ABC-9', aprsLatitude: 42.1234, aprsLongitude: -71.2345, aprsAltitude: 1234, aprsCompressed: compressed });
        const result = await decode(format, audio);
        assert.match(result.text, /APRS:/);
        assert.match(result.text, /Location: 42\.123\d+, -71\.234\d+/);
        assert.match(result.text, /MEET HERE/);
        assert.match(result.text, /Altitude: 123[34]/);
    }
});
test('APRS semantics preserve addressed messages, objects, weather, telemetry and Mic-E positions', async () => {
    const format = find('packet-aprs');
    const packets = [
        ['K1ABC>APRS::N0CALL   :THE NEXT CLUE{01', /To: N0CALL[\s\S]*THE NEXT CLUE/],
        ['K1ABC>APRS:;CLUE     *111111z4903.50N/07201.75W-MEET HERE', /Object: CLUE[\s\S]*MEET HERE/],
        ['K1ABC>APRS:!4903.50N/07201.75W_220/010g020t075r000p000P000h50b10150', /Weather:/],
        ['K1ABC>APRS:T#001,111,222,123,234,001,10101010', /Telemetry:/],
        ["N1JDU-9>ECCU8Y:'cZ<0x7f>l#H>/]Go fly a kite!<0x0d>", /Location: [\s\S]*Mic-E status:/]
    ];
    for (const [packet, expected] of packets) {
        const audio = await encode(format, { text: packet }, { aprsPayload: 'raw' });
        assert.match((await decode(format, audio)).text, expected, packet);
    }
});
const fleetCrc = (first, second) => {
    let shift = 0, parity = 0;
    for (let i = 0; i < 48; i++) {
        const bit = (i < 32 ? first >>> (31 - i) : second >>> (63 - i)) & 1;
        parity ^= bit;
        if (bit ^ ((shift >>> 15) & 1)) shift ^= 0x6815;
        shift = (shift << 1) & 65535;
    }
    for (let i = 48; i < 63; i++) parity ^= (second >>> (63 - i)) & 1;
    return ((shift ^ 2) + parity) & 65535;
};
const fleetCodeword = (nibble) => {
    const checks = [0x4045, 0x2067, 0x1076, 0x083b, 0x0458, 0x022c, 0x0116, 0x008b];
    for (let word = 0; word < 32768; word++) {
        if (((word >>> 8) & 15) !== nibble) continue;
        if (checks.every((mask) => {
            let value = word & mask, parity = 0;
            while (value) { parity ^= value & 1; value >>>= 1; }
            return parity === 0;
        })) return word;
    }
    throw Error('No valid FleetSync II codeword.');
};
const fleetAudio = (baud, secondGeneration) => {
    const first = 0x00200101;
    let second = 0x10220000;
    second |= fleetCrc(first, second);
    second = (second & 0xffff0000) | fleetCrc(first, second);
    let words = [first, second];
    if (secondGeneration) {
        const nibbles = [];
        for (const word of words) for (let i = 28; i >= 0; i -= 4) nibbles.push((word >>> i) & 15);
        words = [];
        for (let i = 0; i < nibbles.length; i += 4) {
            words.push((fleetCodeword(nibbles[i + 1]) << 16) | fleetCodeword(nibbles[i]));
            words.push((fleetCodeword(nibbles[i + 3]) << 16) | fleetCodeword(nibbles[i + 2]));
        }
    }
    const bits = [];
    for (const byte of [...new Array(12).fill(0xAA), 0x23, 0xEB]) for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
    for (const word of words) for (let i = 31; i >= 0; i--) bits.push((word >>> i) & 1);
    const samples = new Float32Array(bits.length * 48000 / baud + 4800);
    let phase = 0, at = 0;
    for (const bit of bits) for (let i = 0; i < 48000 / baud; i++) {
        samples[at++] = 0.8 * Math.sin(phase);
        phase += 2 * Math.PI * (baud === 1200 ? (bit ? 1200 : 1800) : (bit ? 1200 : 2400)) / 48000;
    }
    return { samples, rate: 48000, settings: defaultsFor(find('dispatch-fleet')) };
};
test('FleetSync I and II recover CRC-checked radio addressing at both supported speeds', async () => {
    const format = find('dispatch-fleet');
    for (const baud of [1200, 2400]) for (const second of [false, true]) {
        const result = await decode(format, fleetAudio(baud, second));
        assert.match(result.text, new RegExp(`FleetSync${second ? ' II' : ''} ${baud}: from 100/1016 to 100/1033, command 20/00`));
        assert.equal(result.text.trim().split('\n').length, 1, 'Sampling phases do not duplicate the same burst.');
    }
});
test('serial reception respects recording resampling, tone shift, gain and polarity controls', async () => {
    const { resample } = await import('../build/out/app/audio.js');
    const format = find('terminal-bell202');
    const audio = await encode(format, { text: 'CLOCK TOWER AT MIDNIGHT' }, { serialMark: 1300, serialSpace: 2300 });
    const samples = resample(audio.samples, audio.rate, 44100);
    const result = await decode(format, { ...audio, samples, rate: 44100 }, { serialMark: 1200, serialSpace: 2200, frequencyShift: -100, inputGain: -8, invertInput: true });
    assert.equal(result.text, 'CLOCK TOWER AT MIDNIGHT');
});

test('FleetSync preserves separate radio bursts within a recording', async () => {
    const format = find('dispatch-fleet');
    const audio = fleetAudio(1200, false);
    const result = await decode(format, { ...audio, samples: joinChunks([audio.samples, audio.samples]) });
    assert.equal(result.text.trim().split('\n').length, 2);
});
