const assert = require('node:assert/strict');
const { loadCore, loadRuntime } = require('../load-legacy.cjs');
global.createQSSTV = loadCore('hamdrm');
loadRuntime('hamdrm', 'digital-engine.js');
(async () => {
    const modem = await QSSTVDigitalCore.create();
    for (let i = 0; i < 4; i++) {
        const bytes = new TextEncoder().encode(`9001\nH_OK\n112\n${i}\n-99\nrepair.bin\n`);
        const serial = modem.core._drm_rx_status(13),
            chunks = [];
        modem.call('start', {
            bytes,
            name: 'bsr.bin',
            call: 'N0CALL',
            mode: 2,
            bandwidth: 1,
            qam: 1,
            protection: 0,
            interleave: 0,
            rs: 4,
            transport: 9999
        });
        let block;
        do {
            block = modem.call('read');
            chunks.push(new Int16Array(block.pcm.buffer));
        } while (!block.done);
        modem.call('reset', { clear: false });
        let file,
            notifications = 0;
        for (const pcm of chunks) {
            const samples = Float32Array.from({ length: pcm.length / 4 }, (_, n) => pcm[n * 4] / 32768),
                snapshot = modem.call('process', { samples });
            if (snapshot.file) {
                file = snapshot.file;
                notifications++;
            }
        }
        assert.equal(file?.name, 'bsr.bin', 'BSR requests bypass RS wrapping');
        assert.deepEqual(file.bytes, bytes);
        assert.equal(notifications, 1, 'Repeated headers produce one notification');
        assert.equal(modem.core._drm_rx_status(13), serial + 1);
        assert(modem.core._drm_rx_status(9) <= 2, 'BSR uses a reserved rotating ID');
    }
    console.log('Digital adapter, BSR WAV bytes, RS bypass, rotating ID reuse and duplicate suppression passed.');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
