const assert = require('node:assert/strict');
const { loadCore } = require('../load-legacy.cjs');
(async () => {
    const m = await loadCore('hamdrm')(),
        input = m._malloc(65536 * 4),
        out = m._malloc(65536 * 2);
    const alloc = (bytes) => {
        const p = m._malloc(bytes.length);
        m.HEAPU8.set(bytes, p);
        return p;
    };
    const bytes = Buffer.from('QSSTV browser file transfer\n'.repeat(19));
    const data = alloc(bytes),
        name = alloc(Buffer.from('roundtrip.txt\0')),
        call = alloc(Buffer.from('N0CALL\0'));
    function roundTrip(
        pointer,
        size,
        filename,
        mode,
        bw,
        qam,
        protection,
        interleave,
        fix = [],
        clear = 1,
        transport = 0
    ) {
        const fp = alloc(new Uint8Array(new Int32Array(fix).buffer));
        m._drm_tx_fix(fp, fix.length);
        assert(m._drm_tx_start(pointer, size, filename, call, mode, bw, qam, protection, interleave, transport) > 0);
        m._free(fp);
        const chunks = [];
        let count,
            total = 0;
        while ((count = m._drm_tx_read(out, 65536))) {
            assert(count > 0);
            chunks.push(m.HEAP16.slice(out / 2, out / 2 + count));
            total += count;
            assert(total < 48000 * 600);
        }
        m._drm_rx_reset(clear);
        for (const pcm of chunks) {
            const samples = Float32Array.from({ length: pcm.length / 4 }, (_, i) => pcm[i * 4] / 32768);
            m.HEAPF32.set(samples, input / 4);
            m._drm_rx_process(input, samples.length);
        }
        return Buffer.from(m.HEAPU8.slice(m._drm_rx_file(), m._drm_rx_file() + m._drm_rx_size()));
    }
    let profiles = 0;
    for (let mode = 0; mode < 3; mode++)
        for (let bw = 0; bw < 2; bw++)
            for (let qam = 0; qam < 3; qam++)
                for (let protection = 0; protection < 2; protection++)
                    for (let interleave = 0; interleave < 2; interleave++) {
                        if (process.env.DRM_TRACE) console.log('DRM profile', mode, bw, qam, protection, interleave);
                        const transport = 3000 + profiles,
                            decoded = roundTrip(
                                data,
                                bytes.length,
                                name,
                                mode,
                                bw,
                                qam,
                                protection,
                                interleave,
                                [],
                                1,
                                transport
                            );
                        if (!decoded.equals(bytes)) {
                            console.log(
                                'Failed profile status',
                                Array.from({ length: 15 }, (_, i) => m._drm_rx_status(i))
                            );
                            throw Error(
                                `DRM profile ${[mode, bw, qam, protection, interleave]} recovered ${decoded.length} bytes`
                            );
                        }
                        assert.equal(m.UTF8ToString(m._drm_rx_name()), 'roundtrip.txt');
                        assert.equal(m.UTF8ToString(m._drm_rx_call()), 'N0CALL');
                        assert.equal(m._drm_rx_status(9), transport);
                        profiles++;
                    }
    const ext = alloc(Buffer.from('txt\0'));
    const repeatedSerial = m._drm_rx_status(13);
    assert.deepEqual(
        roundTrip(data, bytes.length, name, 2, 1, 2, 1, 1, [], 0, 3071),
        bytes,
        'a new recording can recover an already completed transfer with the same ID'
    );
    assert.equal(m._drm_rx_status(13), repeatedSerial + 1, 'replayed files emit a new completion');
    for (let rs = 1; rs <= 4; rs++) {
        const size = m._drm_rs_encode(data, bytes.length, ext, rs),
            p = alloc(m.HEAPU8.slice(m._drm_rs_file(), m._drm_rs_file() + size)),
            fn = alloc(Buffer.from(`protected.rs${rs}\0`));
        assert.deepEqual(roundTrip(p, size, fn, 2, 1, 1, 0, 0), bytes, `Reed–Solomon RS${rs}`);
        assert.equal(m.UTF8ToString(m._drm_rx_name()), 'protected.txt');
        m._free(p);
        m._free(fn);
        if (process.env.DRM_TRACE) console.log('RS format passed', rs);
    }
    const large = Buffer.from(Array.from({ length: 12000 }, (_, i) => (i * 53 + 19) & 255)),
        lp = alloc(large),
        ln = alloc(Buffer.from('repair.bin\0'));
    assert.equal(
        roundTrip(lp, large.length, ln, 2, 1, 1, 0, 0, [0, 8191], 1, 9001).length,
        0,
        'FIX leaves middle segments missing; out-of-range segment is safely ignored'
    );
    const bsr = m.UTF8ToString(m._drm_rx_bsr()),
        lines = bsr.trim().split('\n'),
        end = lines.indexOf('-99');
    assert.equal(lines[0], '9001');
    assert.equal(lines[1], 'H_OK');
    assert.equal(lines[end + 2], '21010');
    assert(end > 3);
    const missing = lines.slice(3, end).map(Number);
    assert(missing.includes(30));
    assert.deepEqual(
        roundTrip(lp, large.length, ln, 2, 1, 1, 0, 0, missing, 0, 9001),
        large,
        'FIX repairs the retained partial transfer'
    );
    const changed = Buffer.from(large.map((x) => x ^ 127)),
        cp = alloc(changed);
    assert.deepEqual(
        roundTrip(cp, changed.length, ln, 2, 1, 1, 0, 0, [], 0, 9002),
        changed,
        'Unique IDs prevent same-name/size transfers from being suppressed'
    );
    m._free(cp);
    for (let rs = 1; rs <= 4; rs++) {
        const size = m._drm_rs_encode(lp, large.length, ext, rs),
            rp = alloc(m.HEAPU8.slice(m._drm_rs_file(), m._drm_rs_file() + size)),
            rn = alloc(Buffer.from(`erasures.rs${rs}\0`));
        const fix = Array.from({ length: 2000 }, (_, i) => i).filter((i) => i !== 30);
        assert.deepEqual(roundTrip(rp, size, rn, 2, 1, 1, 0, 0, fix), large, `RS${rs} recovers an omitted MOT segment`);
        m._free(rp);
        m._free(rn);
        if (process.env.DRM_TRACE) console.log('RS erasure repair passed', rs);
    }
    assert.equal(m._drm_tx_start(lp, 0, ln, call, 2, 1, 1, 0, 0, 0), 0);
    assert.equal(m._drm_tx_start(lp, large.length, ln, call, 3, 1, 1, 0, 0, 0), 0);
    m._free(lp);
    m._free(ln);
    console.log(
        'BSR, retained partial transfers, FIX, invalid segment bounds, and missing-segment recovery with RS1–RS4 passed.'
    );
    for (const p of [input, out, data, name, call, ext]) m._free(p);
    console.log(`${profiles} DRM profiles and all four Reed–Solomon formats recover exact file bytes and callsign.`);
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
