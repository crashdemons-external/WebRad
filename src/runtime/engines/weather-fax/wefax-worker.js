'use strict';
importScripts(
    '../../../wasm/weather-fax.js' + self.location.search,
    '../analog-sstv/engine.js' + self.location.search,
    'wefax-engine.js' + self.location.search
);
let engine,
    queue = Promise.resolve();
self.onmessage = ({ data }) => {
    queue = queue.then(async () => {
        const { id, action, args } = data;
        try {
            const result =
                action === 'init' ? ((engine = await WEFAXCore.create(args.encoder)), {}) : engine.call(action, args);
            const transfer = [];
            for (const key of ['pixels', 'spectrum', 'pcm']) if (result[key]) transfer.push(result[key].buffer);
            if (result.finished) transfer.push(result.finished.pixels.buffer);
            self.postMessage({ id, result }, transfer);
        } catch (error) {
            self.postMessage({ id, error: error.message });
        }
    });
};
