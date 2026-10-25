'use strict';
importScripts('../../../wasm/analog-sstv.js' + self.location.search, 'engine.js' + self.location.search);
let engine,
    queue = Promise.resolve();
self.onmessage = (event) => {
    const { id, action, args } = event.data;
    queue = queue.then(async () => {
        try {
            let result;
            if (action === 'init') {
                engine = await MMSCoreEncoder.create();
                result = {};
            } else result = engine.call(action, args);
            self.postMessage({ id, result }, result.pcm ? [result.pcm.buffer] : []);
        } catch (error) {
            self.postMessage({ id, error: error.message });
        }
    });
};
