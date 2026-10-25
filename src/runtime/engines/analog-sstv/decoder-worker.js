'use strict';
importScripts('../../../wasm/analog-sstv.js' + self.location.search, 'engine.js' + self.location.search);
let engine;
let queue = Promise.resolve();
self.onmessage = (event) => {
    const { id, action, args } = event.data;
    queue = queue.then(async () => {
        try {
            let result;
            if (action === 'init') {
                engine = await MMSCoreEngine.create();
                result = { modes: engine.modes };
            } else result = engine.call(action, args);
            const transfer = [];
            for (const key of ['pixels', 'sync', 'spectrum']) if (result[key]) transfer.push(result[key].buffer);
            if (result.finished) transfer.push(result.finished.pixels.buffer);
            self.postMessage({ id, result }, transfer);
        } catch (error) {
            self.postMessage({ id, error: error.message });
        }
    });
};
