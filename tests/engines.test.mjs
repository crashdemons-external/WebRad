import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { EngineHost, coreCatalog } from '../build/out/app/engine-host.js';
import {
    defaultsFor,
    groupsFor,
    validateSettings,
    restoreSettings,
    settingsVersion
} from '../build/out/app/settings.js';
import { describe, formatGroups, matchesFormat } from '../build/out/app/catalog.js';
import { joinChunks, makeWav, parseWav, selectChannel, FrequencyShift } from '../build/out/app/audio.js';
import { parseRecovery } from '../build/out/app/recovery.js';
import { WebRadApplication } from '../src/app/application.js';
const formats = JSON.parse(await readFile(new URL('../build/out/formats.json', import.meta.url))).formats;
const find = (engine, name) => formats.find((f) => f.engine === engine && (f.name === name || f.nativeName === name));
const hosts = new Map();
async function host(engine, role = 'decode') {
    const key = engine + ':' + role;
    if (!hosts.has(key)) hosts.set(key, await EngineHost.create(engine));
    return hosts.get(key);
}
async function encode(f, args = {}, override = {}) {
    const h = await host(f.engine, 'encode'),
        settings = { ...defaultsFor(f), ...override },
        start = await h.encodeStart({ format: f, settings, ...args }),
        chunks = [];
    let file;
    for (let i = 0; i < 20000; i++) {
        const r = h.encodeRead();
        if (r.samples.length) chunks.push(r.samples);
        if (r.file) file = r.file;
        if (r.done) return { samples: joinChunks(chunks), rate: start.rate, file, settings };
    }
    throw Error('Encoder did not finish');
}
async function decode(f, audio, override = {}) {
    const h = await host(f.engine),
        settings = { ...defaultsFor(f), ...override };
    await h.setup({ format: f, settings, rate: audio.rate, preserve: false });
    const result = { text: '', files: [], audio: [], images: [] };
    const capture = (r) => {
        result.text += r.text || '';
        if (r.file) result.files.push(r.file);
        if (r.files) result.files.push(...r.files);
        if (r.audio?.length) result.audio.push(r.audio);
        if (r.finished) result.images.push(r.finished);
        result.last = r;
    };
    const all = joinChunks([audio.samples, new Float32Array(audio.rate * 2)]);
    for (let at = 0; at < all.length; at += 4096) capture(await h.process({ samples: all.subarray(at, at + 4096) }));
    capture(await h.finish());
    return result;
}
test('catalog exposes real engines and each important family has compatibility controls', async () => {
    assert.equal(new Set(formats.map((f) => f.id)).size, formats.length);
    for (const engine of ['fldigi', 'sstv', 'fax', 'drm', 'packet', 'weak', 'sound', 'signaling', 'voice', 'sensor']) {
        const h = await host(engine);
        assert.ok(coreCatalog(engine, h.m).length);
    }
    for (const [family, key] of [
        ['Contestia', 'contestiaIntegration'],
        ['Olivia', 'oliviaMargin'],
        ['DominoEX', 'dominoFec'],
        ['Hellschreiber', 'hellBandwidth']
    ])
        assert.ok(
            groupsFor(formats.find((f) => f.family === family)).some((g) => g.fields.some((f) => f.key === key)),
            family
        );
    assert.ok(formats.filter((f) => f.engine === 'sensor').length >= 380);
});
test('single-mode family presets preserve native modes and apply valid compatibility settings', () => {
    for (const [family, count] of [
        ['RTTY', 10],
        ['CW', 5],
        ['FSQ', 12],
        ['IFKP', 14],
        ['DTMF', 3],
        ['HAMDRM', 72]
    ]) {
        const entries = formats.filter((f) => f.family === family && f.engine !== 'signaling');
        assert.equal(entries.length, count, family);
        assert.equal(new Set(entries.map((f) => f.mode)).size, 1, family);
        for (const f of entries) {
            const fields = groupsFor(f).flatMap((g) => g.fields),
                s = defaultsFor(f);
            for (const [key, value] of Object.entries(f.presetSettings)) {
                assert.ok(
                    fields.some((field) => field.key === key),
                    `${f.name}: ${key}`
                );
                assert.equal(s[key], value, f.name);
                assert.equal(validateSettings(f, {})[key], value, f.name);
            }
            assert.equal(describe(f).description, f.presetDescription);
            assert.ok(matchesFormat(f, f.nativeName));
        }
    }
    for (const [family, textCount, pictureCount] of [
        ['FSQ', 5, 8],
        ['IFKP', 3, 12]
    ])
        for (const direction of ['encode', 'decode'])
            for (const [content, count] of [
                ['text', textCount],
                ['picture', pictureCount]
            ])
                assert.equal(
                    formatGroups(formats, content, direction).find((g) => g.family === family).formats.length,
                    count,
                    `${family} ${direction} ${content}`
                );
    const rtty = find('fldigi', 'RTTY');
    assert.equal(rtty.presetSettings.rttyBaud, 1);
    assert.equal(rtty.presetSettings.rttyShift, 3);
    const weather = formats.find((f) => f.id === rtty.id + '-50-450');
    assert.equal(defaultsFor(weather).rttyShift, 10);
    assert.equal(defaultsFor(weather).rttyCustomShift, 450);
    const profiles = formats.filter((f) => f.engine === 'drm');
    assert.equal(
        new Set(
            profiles.map((f) =>
                ['drmMode', 'drmBandwidth', 'drmQam', 'drmProtection', 'drmInterleave']
                    .map((key) => defaultsFor(f)[key])
                    .join('')
            )
        ).size,
        72
    );
    const saved = validateSettings(weather, { rttyCustomShift: 500, rttyParity: 1 });
    assert.equal(saved.rttyCustomShift, 500);
    assert.equal(saved.rttyParity, 1);
    assert.equal(saved.rttyBaud, 2);
});
test('every text/keypad preset encodes and decodes with its selected settings', async () => {
    for (const f of formats.filter((f) => f.engine === 'fldigi' && f.presetSettings && f.inputs.includes('text'))) {
        const text =
            f.family === 'DTMF'
                ? '123A*#'
                : f.family === 'FSQ' || f.family === 'IFKP'
                  ? 'cq cq de webtest 12345\n'.repeat(3)
                  : 'CQ CQ DE WEBTEST 12345\n'.repeat(3);
        const a = await encode(f, { text }, { callsign: 'K1ABC' }),
            r = await decode(f, a, { callsign: 'K1ABC' });
        assert.ok(
            r.text.toUpperCase().includes(f.family === 'DTMF' ? text : 'CQ CQ DE WEBTEST 12345'),
            `${f.name}: ${r.text}`
        );
    }
});
test('WAV PCM, channel selection and frequency correction', () => {
    const a = Float32Array.from([0, 0.5, -0.5, 1, -1]),
        wav = parseWav(makeWav(a, 8000).buffer);
    assert.equal(wav.rate, 8000);
    a.forEach((x, i) => assert.ok(Math.abs(wav.channels[0][i] - x) < 0.00004));
    assert.deepEqual([...selectChannel({ channels: [a, Float32Array.from(a, (x) => -x)] }, 'mix')], [0, 0, 0, 0, 0]);
    const signal = Float32Array.from({ length: 8000 }, (_, i) => Math.cos((2 * Math.PI * 1000 * i) / 8000)),
        shift = new FrequencyShift(8000, 250),
        moved = shift.process(signal);
    let real = 0,
        imag = 0;
    for (let i = 200; i < 8000; i++) {
        real += moved[i] * Math.cos((2 * Math.PI * 1250 * i) / 8000);
        imag += moved[i] * Math.sin((2 * Math.PI * 1250 * i) / 8000);
    }
    assert.ok(Math.hypot(real, imag) > 3000);
    assert.throws(() => parseWav(makeWav(a, 8000).buffer.slice(0, -2)), /truncated/);
});
test('Martin 2 recording remains aligned across automatic selection, chunk sizes and receiver reuse', async () => {
    const bytes = await readFile(new URL('./fixtures/martin2-alignment.wav', import.meta.url));
    assert.equal(
        createHash('sha256').update(bytes).digest('hex'),
        '21e290f85943984b85bcf502ddaa1364413d7434510bd6fe78e1fe743b639c13'
    );
    const wav = parseWav(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    // Reference pixels recovered by MMSSTV with its wide BPF and auto-slant off.
    const expected = '1c8dd0da146b7be490366ed3350cf47cccf20b7d3728d8902b9cb7e4824288dd';
    const manualExpected = '42e06c400767df7aa0a30d4b26695d538b31ece86027d71b08618273925003f4';
    const native = find('sstv', 'Martin 2'),
        auto = formats.find((f) => f.id === 'pictures-auto');
    const direct = await host('sstv'),
        automatic = await host('pictures-auto');
    for (const [h, f, chunk] of [
        [automatic, auto, 8192],
        [direct, native, 4096],
        [automatic, auto, 1024],
        [direct, native, 8192]
    ]) {
        await h.setup({ format: f, settings: defaultsFor(f), rate: wav.rate, preserve: false });
        let image;
        for (let at = 0; at < wav.channels[0].length; at += chunk) {
            const r = await h.process({ samples: wav.channels[0].subarray(at, at + chunk) });
            if (r.finished) image = r.finished;
        }
        const final = await h.finish();
        if (final.finished) image = final.finished;
        assert.ok(image);
        assert.deepEqual([image.width, image.height, image.mode, image.complete], [320, 256, 7, true]);
        assert.equal(
            createHash('sha256').update(image.pixels).digest('hex'),
            f === auto ? expected : manualExpected,
            `${f.name}, ${chunk}-sample chunks`
        );
        if (f === auto) assert.equal(final.detectedEngine, 'sstv');
        assert.equal((await h.finish()).finished, undefined, 'finishing twice must not emit another picture');
    }
});
test('legacy SSTV settings adopt the alignment fix once and keep subsequent advanced opt-ins', () => {
    for (const f of formats.filter((f) => ['sstv', 'pictures-auto'].includes(f.engine))) {
        const old = { ...defaultsFor(f), sstvSlant: true, sstvBpf: 0, inputGain: 3, sstvSense: 2 };
        const migrated = restoreSettings(f, old);
        assert.equal(migrated.sstvSlant, false);
        assert.equal(migrated.sstvBpf, 1);
        assert.equal(migrated.inputGain, 3);
        assert.equal(migrated.sstvSense, 2);
        const chosen = { ...migrated, sstvSlant: true, sstvBpf: 0 };
        assert.deepEqual(restoreSettings(f, chosen, settingsVersion), validateSettings(f, chosen));
        assert.equal(restoreSettings(f, { ...old, sstvBpf: 3 }).sstvBpf, 3);
    }
});
test('fldigi text encoders round-trip through the application host', async () => {
    for (const name of ['CW', 'RTTY', 'BPSK31', 'DTMF']) {
        const f = find('fldigi', name),
            text = name === 'DTMF' ? '123A*#' : 'CQ CQ DE WEBTEST 12345\n'.repeat(3),
            a = await encode(f, { text }),
            r = await decode(f, a);
        assert.ok(r.text.includes(name === 'DTMF' ? text : 'CQ CQ DE WEBTEST 12345'), `${name}: ${r.text}`);
    }
});

test('all Hellschreiber variants deliver visible printed pixels through the application host', async () => {
    for (const format of formats.filter((entry) => entry.family === 'Hellschreiber')) {
        const audio = await encode(format, { text: 'TEST' });
        const receiver = await host('fldigi');
        await receiver.setup({ format, settings: audio.settings, rate: audio.rate });
        const previousLocation = globalThis.location;
        globalThis.location = { search: '' };
        const application = new WebRadApplication();
        if (previousLocation === undefined) delete globalThis.location;
        else globalThis.location = previousLocation;
        application.state.formats = formats;
        application.state.formatId = format.id;
        application.state.content = 'picture';
        application.state.direction = 'decode';
        application.view.paintReceived = () => {};
        for (let at = 0; at < audio.samples.length; at += 4096) {
            application.consume(await receiver.process({ samples: audio.samples.subarray(at, at + 4096) }));
        }
        application.consume(await receiver.finish());
        const printed = application.state.received.current;
        assert.ok(printed?.width > 20 && printed.height >= 28, `${format.name}: missing raster`);
        const shades = new Set();
        for (let at = 0; at < printed.pixels.length; at += 4) shades.add(printed.pixels[at]);
        assert.ok(shades.size > 16, `${format.name}: raster must contain printed marks`);
        assert.equal(application.state.received.text, '');
        assert.match(application.view.decodeMain(), /id="received-picture"/);
    }
});
test('a reused Morse receiver starts fresh after completed and interrupted recordings', async () => {
    const f = find('fldigi', 'CW'),
        text = 'CQ CQ DE WEBRAD TEST 12345\n'.repeat(3),
        a = await encode(f, { text });
    for (let i = 0; i < 3; i++) {
        const r = await decode(f, a);
        assert.ok(r.text.includes('CQ CQ DE WEBRAD TEST 12345'), `run ${i}: ${r.text}`);
        const h = await host('fldigi');
        await h.setup({ format: f, settings: defaultsFor(f), rate: a.rate });
        await h.process({ samples: a.samples.subarray(0, 15000) });
    }
});

test('Morse recordings recover the final character without added silence through the application host', async () => {
    const f = find('fldigi', 'CW');
    for (const frequency of [700, 800]) {
        for (const cwSpeed of [18, 21, 25]) {
            for (const text of ['test', 'testt', 'testa', '/CAKEWALK/']) {
                const settings = { frequency, cwSpeed };
                const audio = await encode(f, { text }, settings);
                const receiver = await host('fldigi');
                await receiver.setup({ format: f, settings: audio.settings, rate: audio.rate });
                let decoded = '';
                for (let at = 0; at < audio.samples.length; at += 137) {
                    decoded += (await receiver.process({ samples: audio.samples.subarray(at, at + 137) })).text || '';
                }
                decoded += (await receiver.finish()).text || '';
                assert.equal(decoded.trim(), text.toUpperCase(), `${frequency} Hz, ${cwSpeed} WPM: ${text}`);
            }
        }
    }
});
test('FT8 and FT4 decode generated slot audio', async () => {
    for (const name of ['FT8', 'FT4']) {
        const f = find('weak', name),
            a = await encode(f, { text: 'CQ K1ABC FN42' }),
            r = await decode(f, a);
        assert.ok(r.text.includes('CQ K1ABC FN42'), `${name}: ${r.text}`);
    }
});
test('all twelve ggwave protocols survive PCM WAV and custom frequency resets', async () => {
    for (const f of formats.filter((f) => f.engine === 'sound')) {
        const s = { ggPayload: f.mode >= 6 ? 5 : 0 },
            a = await encode(f, { text: 'hello' }, s),
            w = parseWav(makeWav(a.samples, a.rate).buffer),
            r = await decode(f, { samples: w.channels[0], rate: w.rate }, s);
        assert.ok(r.text.includes('hello'), `${f.name}: ${r.text}`);
    }
    const f = find('sound', 'Audible normal'),
        a = await encode(f, { text: 'moved' }, { ggFreq: 80 }),
        r = await decode(f, a, { ggFreq: 80 });
    assert.ok(r.text.includes('moved'));
    const standard = await encode(f, { text: 'default' }),
        restored = await decode(f, standard);
    assert.ok(restored.text.includes('default'));
});
test('Dire Wolf packet modem and protected framing round trips', async () => {
    for (const [name, fec] of [
        ['1200 AFSK', 0],
        ['300 AFSK', 0],
        ['2400 QPSK', 0],
        ['4800 8PSK', 0],
        ['9600 G3RUH', 0],
        ['1200 AFSK', 1],
        ['1200 AFSK', 2]
    ]) {
        const f = find('packet', name),
            a = await encode(f, { text: 'K1ABC>APRS:Hello WebRad' }, { packetFec: fec }),
            r = await decode(f, a);
        assert.ok(r.text.includes('Hello WebRad'), `${name} framing ${fec}: ${r.text}`);
    }
});
test('multimon pager and keypad encoders recover messages', async () => {
    for (const name of ['DTMF', 'POCSAG512', 'POCSAG1200', 'POCSAG2400', 'FLEX', 'ZVEI1']) {
        const f = find('signaling', name),
            text = ['DTMF', 'ZVEI1'].includes(name) ? '12345' : 'HELLO WEBRAD',
            a = await encode(f, { text }),
            r = await decode(f, a);
        assert.ok((name === 'DTMF' ? r.text.replace(/DTMF: |\s/g, '') : r.text).includes(text), `${name}: ${r.text}`);
    }
});
test('every signaling receiver processes silence without a trap', async () => {
    for (const f of formats.filter((f) => f.engine === 'signaling')) {
        const h = await host('signaling');
        await h.setup({ format: f, settings: defaultsFor(f), rate: 48000 });
        assert.equal(typeof (await h.process({ samples: new Float32Array(4096) })).text, 'string', f.name);
    }
});
const speech = Float32Array.from(
    { length: 8000 * 5 },
    (_, i) => 0.25 * Math.sin((2 * Math.PI * 120 * i) / 8000) + 0.1 * Math.sin((2 * Math.PI * 600 * i) / 8000)
);
test('all Codec2 modes produce portable files and decoded speech', async () => {
    for (const f of formats.filter((f) => f.codec)) {
        const a = await encode(f, { audio: { samples: speech, rate: 8000 } }),
            h = await host('voice'),
            r = h.decodeCodec({ bytes: a.file.bytes, format: f, settings: defaultsFor(f) });
        assert.equal(r.audio.length, speech.length);
        assert.ok(r.audio.every(Number.isFinite));
        assert.ok(
            r.audio.some((x) => Math.abs(x) > 0.005),
            f.name
        );
    }
});
test('all FreeDV speech modes synchronize and recover speech', async () => {
    for (const f of formats.filter((f) => f.engine === 'voice' && !f.codec && !f.data)) {
        const a = await encode(f, { audio: { samples: speech, rate: 8000 } }),
            r = await decode(f, a);
        assert.ok(r.audio.length, f.name);
        assert.ok(
            joinChunks(r.audio).some((x) => Math.abs(x) > 0.005),
            f.name
        );
    }
});
test('FreeDV burst data frames preserve exact payload bytes and CRC', async () => {
    for (const f of formats.filter((f) => f.data)) {
        const h = await host('voice');
        h.setupVoice(f, defaultsFor(f));
        const bytes = Uint8Array.from({ length: h.frameBytes - 2 }, (_, i) => (i * 17) & 255),
            a = await encode(f, { bytes }),
            r = await decode(f, a);
        assert.ok(r.files.length, f.name);
        assert.deepEqual(r.files[0].bytes, bytes, f.name);
    }
});
test('FreeDV larger files require consent and all data variants recover ordered packets with final padding', async () => {
    const fsk = find('voice', 'FreeDV FSK-LDPC');
    const cases = [
        ...formats.filter((f) => f.data).map((f) => [f, {}]),
        [fsk, { voiceFskCode: 'H_128_256_5' }],
        [fsk, { voiceFskM: 4, voiceFskBaud: 200 }],
        [fsk, { voiceFskCode: 'HRA_112_112' }]
    ];
    for (const [f, override] of cases) {
        const h = await host('voice', 'encode'),
            settings = { ...defaultsFor(f), ...override };
        const single = h.voiceDataPlan({ format: f, settings, size: 1 }),
            bytes = Uint8Array.from({ length: single.payloadBytes * 2 + 3 }, (_, i) => (i * 37 + 11) & 255);
        const plan = h.voiceDataPlan({ format: f, settings, size: bytes.length });
        assert.equal(plan.packetCount, 3);
        assert.equal(plan.paddingBytes, single.payloadBytes - 3);
        await assert.rejects(h.encodeStart({ format: f, settings, bytes }), /Confirm splitting/);
        const a = await encode(f, { bytes, splitPackets: true }, override),
            r = await decode(f, a, override);
        assert.equal(a.samples.length / a.rate, plan.seconds, f.name);
        assert.equal(
            r.files.length,
            plan.packetCount,
            `${f.name} ${JSON.stringify(override)}: packet starts ${r.files.map((p) => p.bytes[0])}`
        );
        const restored = new Uint8Array(plan.packetCount * plan.payloadBytes);
        r.files.forEach((packet, i) => {
            assert.equal(packet.bytes.length, plan.payloadBytes);
            assert.ok(packet.name.endsWith(`-packet-${i + 1}.bin`));
            restored.set(packet.bytes, i * plan.payloadBytes);
        });
        assert.deepEqual(restored.subarray(0, bytes.length), bytes, f.name);
        assert.ok(restored.subarray(bytes.length).every((x) => x === plan.paddingByte));
    }
});
test('FreeDV files below one-packet capacity encode without consent and oversized audio is rejected before allocation', async () => {
    for (const f of formats.filter((f) => f.data)) {
        const bytes = Uint8Array.from([0, 255, 1]),
            a = await encode(f, { bytes }),
            r = await decode(f, a);
        assert.equal(r.files.length, 1, f.name);
        assert.deepEqual(r.files[0].bytes.subarray(0, bytes.length), bytes);
        assert.ok(r.files[0].bytes.subarray(bytes.length).every((x) => x === (f.mode === 9 ? 0x55 : 0)));
        const h = await host('voice', 'encode'),
            settings = defaultsFor(f);
        assert.throws(() => h.voiceDataPlan({ format: f, settings, size: 0 }), /between 1 byte/);
        assert.throws(() => h.voiceDataPlan({ format: f, settings, size: 16 * 1024 * 1024 }), /more than 30 minutes/);
    }
});
test('FSK packet tone counts and error-correction choices round-trip', async () => {
    const f = find('voice', 'FreeDV FSK-LDPC'),
        h = await host('voice');
    for (const override of [
        { voiceFskM: 4, voiceFskBaud: 200 },
        { voiceFskCode: 'H_128_256_5' },
        { voiceFskCode: 'HRA_112_112' }
    ]) {
        h.setupVoice(f, { ...defaultsFor(f), ...override });
        const bytes = Uint8Array.from({ length: h.frameBytes - 2 }, (_, i) => i + 4),
            a = await encode(f, { bytes }, override),
            r = await decode(f, a, override);
        assert.deepEqual(r.files[0]?.bytes, bytes, JSON.stringify(override));
    }
});
test('recovery requests preserve transfer profiles and expand only valid segment ranges', () => {
    const r = parseRecovery('1234\nH_OK\n512\n2\n-1\n5\n8\n-99\npicture.rs2\n21110\n');
    assert.deepEqual(r.segments, [2, 3, 4, 5, 8]);
    assert.equal(r.transport, 1234);
    assert.equal(r.settings.rs, 2);
    assert.equal(r.settings.drmMode, 2);
    for (const request of [
        '2\nH_OK\n512\n1\n-99\nx.txt',
        '1234\nH_OK\n512\n-1\n5\n-99\nx.txt',
        '1234\nH_OK\n512\n3\n-1\n8192\n-99\nx.txt'
    ])
        assert.throws(() => parseRecovery(request));
});
test('slow-scan image completes with real color output', async () => {
    const f = find('sstv', 'Robot 36') || find('sstv', 'Robot36'),
        image = { width: f.width, height: f.txHeight, pixels: new Uint8Array(f.width * f.txHeight * 4) };
    for (let i = 0; i < image.pixels.length; i += 4) image.pixels.set([230, 40, 30, 255], i);
    const a = await encode(f, { image }),
        r = await decode(f, a);
    assert.ok(r.images.length);
    const p = r.images.at(-1);
    assert.equal(p.width, f.width);
    assert.ok(p.pixels.some((x) => x > 200));
    const auto = await decode(
        formats.find((f) => f.id === 'pictures-auto'),
        a
    );
    assert.equal(auto.last.detectedEngine, 'sstv');
    assert.equal(auto.images.at(-1).width, f.width);
    assert.equal(auto.images.at(-1).complete, true);
    await mkdir(new URL('../tests/fixtures/', import.meta.url), { recursive: true });
    await writeFile(new URL('../tests/fixtures/robot36.wav', import.meta.url), makeWav(a.samples, a.rate));
});
test('HAMDRM transfers byte-exact RS-protected files', async () => {
    const f = find('drm', 'HAMDRM'),
        bytes = new TextEncoder().encode('WebRad byte-exact digital transfer.'),
        a = await encode(f, { bytes, name: 'test.txt' }),
        r = await decode(f, a);
    assert.ok(r.files.length);
    assert.deepEqual(r.files[0].bytes, bytes);
    assert.equal(r.files[0].name, 'test.txt');
});
test('weather fax host preserves received pixels and integer spectrum samples', async () => {
    const f = find('fax', 'IOC576'),
        height = 32,
        pixels = new Uint8Array(f.width * height * 4);
    for (let y = 0; y < height; y++)
        for (let x = 0; x < f.width; x++) {
            const v = Math.round((x / f.width) * 255);
            pixels.set([v, v, v, 255], (y * f.width + x) * 4);
        }
    const a = await encode(f, { image: { width: f.width, height, pixels } }),
        r = await decode(f, a);
    assert.ok(r.images.length);
    assert.equal(r.images[0].width, f.width);
    assert.ok(r.last.spectrum instanceof Int32Array);
    assert.equal(r.last.spectrum.length, 1024);
    assert.ok(r.last.spectrum.every(Number.isFinite));
    const auto = await decode(
        formats.find((f) => f.id === 'pictures-auto'),
        a
    );
    assert.equal(auto.last.detectedEngine, 'fax');
    assert.equal(auto.images.at(-1).width, f.width);
});
test('rtl_433 decodes a checksum-protected temperature/humidity packet from pulses and I/Q', async () => {
    const f = formats.find((f) => f.engine === 'sensor' && f.name.includes('Acurite 609TXC')),
        h = await host('sensor'),
        s = { ...defaultsFor(f), sensorRate: 1000000 };
    const bytes = [0x42, 0x20, 0xeb, 55];
    bytes.push(bytes.reduce((n, b) => n + b, 0) & 255);
    const pairs = [];
    for (const b of bytes) for (let bit = 7; bit >= 0; bit--) pairs.push([500, (b >> bit) & 1 ? 2000 : 1000]);
    pairs.push([500, 20000]);
    await h.setup({ format: f, settings: s, rate: s.sensorRate });
    const events = h.sensorPulses({ pairs: pairs.flat(), settings: s }),
        data = JSON.parse(events.text.trim());
    assert.equal(data.model, 'Acurite-609TXC');
    assert.equal(data.humidity, 55);
    assert.equal(data.temperature_C, 23.5);
    const raw = [];
    for (let repeat = 0; repeat < 3; repeat++)
        for (const [pulse, gap] of pairs) {
            for (let n = 0; n < pulse; n++) raw.push(220, 128);
            for (let n = 0; n < gap; n++) raw.push(128, 128);
        }
    const iq = Uint8Array.from(raw);
    await h.setup({ format: f, settings: s, rate: s.sensorRate });
    let text = '';
    for (let i = 0; i < iq.length; i += 65536)
        text += h.sensorSamples({
            bytes: iq.subarray(i, i + 65536),
            count: Math.min(65536, iq.length - i) / 2,
            type: 0,
            settings: s
        }).text;
    assert.ok(text.includes('Acurite-609TXC'));
    const finalPacket = iq.slice((iq.length / 3) * 2, iq.length - 40000);
    await h.setup({ format: f, settings: s, rate: s.sensorRate });
    text = '';
    for (let i = 0; i < finalPacket.length; i += 65536)
        text += h.sensorSamples({
            bytes: finalPacket.subarray(i, i + 65536),
            count: Math.min(65536, finalPacket.length - i) / 2,
            type: 0,
            settings: s
        }).text;
    text += (await h.finish()).text || '';
    assert.ok(
        text.includes('Acurite-609TXC'),
        'the final packet is flushed when a recording ends without a trailing gap'
    );
    await mkdir(new URL('../tests/fixtures/', import.meta.url), { recursive: true });
    await writeFile(
        new URL('../tests/fixtures/acurite609.json', import.meta.url),
        JSON.stringify({ sampleRate: 1000000, modulation: 'OOK', pulses: pairs })
    );
});
