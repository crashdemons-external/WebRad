'use strict';
importScripts('../../../wasm/hamdrm.js' + self.location.search, 'digital-engine.js' + self.location.search);
let engine,
    queue = Promise.resolve();
onmessage = ({ data }) => {
    queue = queue.then(async () => {
        try {
            if (data.action === 'init') {
                engine = await QSSTVDigitalCore.create();
                postMessage({ id: data.id, result: {} });
                return;
            }
            const result = engine.call(data.action, data.args);
            const transfers = [];
            if (result.pcm) transfers.push(result.pcm.buffer);
            if (result.file) transfers.push(result.file.bytes.buffer);
            postMessage({ id: data.id, result }, transfers);
        } catch (error) {
            postMessage({ id: data.id, error: error.message });
        }
    });
};
