'use strict';
importScripts('../../../wasm/jpeg2000.js' + self.location.search);
const ready = createJPEG2000({ locateFile: (name, dir) => dir + name + self.location.search });
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
    queue = queue.then(async () => {
        const { id, action, args } = data;
        try {
            const m = await ready,
                bytes = action === 'decode' ? args.bytes : args.pixels,
                p = m._malloc(bytes.length);
            let result;
            try {
                m.HEAPU8.set(bytes, p);
                if (action === 'decode') {
                    if (!m._jp2_decode(p, bytes.length)) throw Error('Unsupported or invalid JPEG 2000 image.');
                    const width = m._jp2_width(),
                        height = m._jp2_height(),
                        start = m._jp2_pixels();
                    result = { width, height, pixels: m.HEAPU8.slice(start, start + width * height * 4) };
                } else {
                    const size = m._jp2_encode(p, args.width, args.height, args.ratio);
                    if (!size) throw Error('Could not encode JPEG 2000 image.');
                    const start = m._jp2_file();
                    result = m.HEAPU8.slice(start, start + size);
                }
            } finally {
                m._free(p);
            }
            postMessage({ id, result }, result.pixels ? [result.pixels.buffer] : [result.buffer]);
        } catch (error) {
            postMessage({ id, error: error.message || String(error) });
        }
    });
};
