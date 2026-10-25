/** Picture import, preparation, preview and portable image export. */
export class PictureTools {
    /**
     * Read a bounded browser picture or delegate JPEG 2000 decoding to its WASM adapter.
     * @param {File} file Browser file selected by the user.
     * @param {Function} jp2 Asynchronous JPEG 2000 decoder supplied by the engine bridge.
     * @returns {Promise<Object>} Decoded picture dimensions and RGBA pixels.
     */
    static async readPicture(file, jp2) {
        if (file.size > 20 * 1024 * 1024) throw Error('Choose a picture smaller than 20 MB.');
        if (/\.(jp2|j2k|jpc)$/i.test(file.name)) {
            const result = await jp2({
                action: 'decode',
                bytes: new Uint8Array(await file.arrayBuffer())
            });
            return { ...result, name: file.name };
        }
        const url = URL.createObjectURL(file),
            img = new Image();
        try {
            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = () => reject(Error('This browser cannot open this picture.'));
                img.src = url;
            });
            if (img.naturalWidth * img.naturalHeight > 16000000)
                throw Error('Choose a picture with at most 16 million pixels.');
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            return {
                name: file.name,
                width: canvas.width,
                height: canvas.height,
                pixels: ctx.getImageData(0, 0, canvas.width, canvas.height).data
            };
        } finally {
            URL.revokeObjectURL(url);
        }
    }
    /** Print a bounded message as white letters on a black spectrogram picture. */
    static textPicture(text, settings) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.trunc(settings.spectralWidth);
        canvas.height = Math.trunc(settings.spectralHeight);
        const context = canvas.getContext('2d');
        const lines = text.split('\n');
        if (lines.length > 8 || text.length > 160) throw Error('Use up to eight lines and 160 characters for a readable hidden picture.');
        context.fillStyle = '#000';
        context.fillRect(0, 0, canvas.width, canvas.height);
        const fontSize = Math.max(8, Math.min(24, Math.floor((canvas.height - 8) / lines.length)));
        context.font = `bold ${fontSize}px monospace`;
        context.textBaseline = 'middle';
        context.fillStyle = '#fff';
        for (let i = 0; i < lines.length; i++) {
            if (context.measureText(lines[i]).width > canvas.width - 8) throw Error('This line is too wide. Add a line break or increase Picture width in Advanced.');
            context.fillText(lines[i], 4, (i + 0.5) * canvas.height / lines.length);
        }
        return { width: canvas.width, height: canvas.height, pixels: context.getImageData(0, 0, canvas.width, canvas.height).data };
    }
    /**
     * Create a canvas populated from a picture's RGBA pixels.
     * @param {Object} picture Picture dimensions and RGBA pixels.
     * @returns {HTMLCanvasElement} Canvas containing the picture pixels.
     */
    static pictureCanvas(picture) {
        const canvas = document.createElement('canvas');
        canvas.width = picture.width;
        canvas.height = picture.height;
        canvas
            .getContext('2d')
            .putImageData(new ImageData(new Uint8ClampedArray(picture.pixels), picture.width, picture.height), 0, 0);
        return canvas;
    }
    /**
     * Generate the deterministic mountain/lake picture used by the sample action.
     * @returns {Object} Deterministic sample picture and filename.
     */
    static samplePicture() {
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 400;
        const c = canvas.getContext('2d');
        PictureTools.paintSampleSky(c);
        PictureTools.paintSampleMountains(c);
        PictureTools.paintSampleLake(c);
        PictureTools.paintSampleTrees(c);
        return {
            width: 640,
            height: 400,
            pixels: c.getImageData(0, 0, 640, 400).data,
            name: 'mountain-lake-sample.png'
        };
    }
    /** Paint the sample picture's background sky. */
    static paintSampleSky(c) {
        const sky = c.createLinearGradient(0, 0, 0, 220);
        sky.addColorStop(0, '#2984c8');
        sky.addColorStop(1, '#b2ddf0');
        c.fillStyle = sky;
        c.fillRect(0, 0, 640, 400);
    }
    /** Fill a closed polygon used by the sample's mountains and trees. */
    static paintSamplePolygon(c, points, color) {
        c.fillStyle = color;
        c.beginPath();
        c.moveTo(...points[0]);
        for (const p of points.slice(1)) c.lineTo(...p);
        c.closePath();
        c.fill();
    }
    /** Paint the mountain range and snow caps. */
    static paintSampleMountains(c) {
        PictureTools.paintSamplePolygon(c,
            [
                [0, 245],
                [85, 90],
                [150, 185],
                [225, 35],
                [340, 195],
                [400, 65],
                [530, 195],
                [575, 110],
                [640, 230]
            ],
            '#526f91'
        );
        PictureTools.paintSamplePolygon(c,
            [
                [180, 110],
                [225, 35],
                [270, 105],
                [238, 86],
                [220, 98],
                [205, 82]
            ],
            '#f2f8fd'
        );
        PictureTools.paintSamplePolygon(c,
            [
                [358, 117],
                [400, 65],
                [440, 113],
                [410, 102],
                [396, 109]
            ],
            '#e4f3fa'
        );
    }
    /** Paint the lake gradient and its reflection lines. */
    static paintSampleLake(c) {
        const lake = c.createLinearGradient(0, 235, 0, 400);
        lake.addColorStop(0, '#338a9c');
        lake.addColorStop(1, '#165664');
        c.fillStyle = lake;
        c.fillRect(0, 235, 640, 165);
        for (let i = 0; i < 70; i++) {
            c.strokeStyle = i % 2 ? '#70b3c34d' : '#bbdcec45';
            c.beginPath();
            c.moveTo((i * 83) % 640, 240 + i * 2.2);
            c.lineTo(((i * 83) % 640) + 80, 240 + i * 2.2);
            c.stroke();
        }
    }
    /** Paint the trees along the shoreline. */
    static paintSampleTrees(c) {
        for (let i = 0; i < 24; i++) {
            const x = (i * 73) % 640,
                h = 30 + ((i * 17) % 70);
            PictureTools.paintSamplePolygon(c,
                [
                    [x - 18, 250],
                    [x, 250 - h],
                    [x + 18, 250]
                ],
                i % 2 ? '#254f43' : '#173c39'
            );
        }
    }
    /**
     * Fit or crop a picture to the native format geometry and convert its color layout.
     * @param {string|Object} source Original asset text or source picture.
     * @param {Object} format Catalog format, including native mode and preset controls.
     * @param {Object} s Validated format compatibility settings.
     * @param {string} fit Fit/crop picture placement choice.
     * @returns {Object} Native RGB/RGBA pixels, preview pixels and transmit geometry.
     */
    static preparePicture(source, format, s, fit) {
        const { width, height, gray, imageFormat, spp } = PictureTools.pictureGeometry(source, format, s);
        const preview = PictureTools.fitPicturePixels(source, width, height, fit);
        if (gray) PictureTools.makeGrayscale(preview, format);
        const pixels = format.engine === 'fldigi' ? PictureTools.rgbPixels(preview, width, height) : preview;
        return { width, height, pixels, preview, gray, format: imageFormat, spp };
    }
    /** Select the picture dimensions and color layout used by the native format. */
    static pictureGeometry(source, format, s) {
        let width = source.width,
            height = source.height,
            gray = false,
            imageFormat = 0,
            spp = 8;
        switch (format.engine) {
            case 'spectrum':
                width = Math.trunc(s.spectralWidth);
                height = Math.trunc(s.spectralHeight);
                gray = true;
                break;
            case 'apt':
                width = 909;
                height = Math.trunc(s.aptHeight);
                gray = true;
                break;
            case 'sstv':
                width = format.width;
                height = format.txHeight || format.height;
                break;
            case 'fax':
                width = format.width;
                height = Math.max(1, Math.round((source.height * width) / source.width));
                gray = true;
                break;
            case 'fldigi':
                gray = s.imageColor === 'gray';
                switch (format.family) {
                    case 'MFSK':
                        width = s.imageWidth;
                        height = Math.round((source.height * width) / source.width);
                        spp = s.imageSpp;
                        break;
                    case 'THOR':
                    case 'IFKP': {
                        const sizes = [
                            [59, 74],
                            [120, 150],
                            [240, 300],
                            [160, 120],
                            [320, 240],
                            [640, 480]
                        ];
                        [width, height] = sizes[s.imageSize];
                        imageFormat = s.imageSize;
                        break;
                    }
                    case 'FSQ': {
                        const sizes = [
                            [160, 120, false],
                            [320, 240, false],
                            [640, 480, true],
                            [640, 480, false],
                            [240, 300, false],
                            [240, 300, true],
                            [120, 150, false],
                            [120, 150, true]
                        ];
                        [width, height, gray] = sizes[s.fsqImageSize];
                        imageFormat = s.fsqImageSize;
                        if (!/^[a-z0-9/]{3,20}$/i.test(s.callsign))
                            throw Error('FSQ pictures require a sender callsign of 3–20 letters, numbers, or /.');
                        break;
                    }
                }
                break;
        }
        if (width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > 16000000)
            throw Error('The prepared picture is too large. Reduce its width or choose another format.');
        return { width, height, gray, imageFormat, spp };
    }
    /** Fit or crop a picture onto white, then read its RGBA pixels. */
    static fitPicturePixels(source, width, height, fit) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const c = canvas.getContext('2d');
        c.fillStyle = '#fff';
        c.fillRect(0, 0, width, height);
        const scale =
                fit === 'crop'
                    ? Math.max(width / source.width, height / source.height)
                    : Math.min(width / source.width, height / source.height),
            w = source.width * scale,
            h = source.height * scale;
        c.drawImage(PictureTools.pictureCanvas(source), (width - w) / 2, (height - h) / 2, w, h);
        return c.getImageData(0, 0, width, height).data;
    }
    /**
     * Convert RGBA colors using the modem's luminance weights and rounding.
     * @param {Uint8ClampedArray} pixels RGBA pixels converted in place, preserving alpha.
     * @param {Object} format Engine and modem family selecting native luminance conversion.
     */
    static makeGrayscale(pixels, format = {}) {
        const videoWeights = format.engine === 'fldigi' && ['THOR', 'IFKP', 'FSQ'].includes(format.family);
        const weights = videoWeights ? [30, 60, 10] : [31, 61, 8];
        const truncate = format.engine === 'fldigi' || format.engine === 'fax';
        for (let offset = 0; offset < pixels.length; offset += 4) {
            const luminance = (pixels[offset] * weights[0] + pixels[offset + 1] * weights[1] + pixels[offset + 2] * weights[2]) / 100;
            const value = truncate ? Math.floor(luminance) : Math.round(luminance);
            pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = value;
        }
    }
    /** Copy RGBA colors to the packed RGB layout used by fldigi. */
    static rgbPixels(pixels, width, height) {
        const rgb = new Uint8Array(width * height * 3);
        for (let i = 0, j = 0; i < pixels.length; i += 4) {
            rgb[j++] = pixels[i];
            rgb[j++] = pixels[i + 1];
            rgb[j++] = pixels[i + 2];
        }
        return rgb;
    }
    /**
     * Resample retained modem scan components without changing the decoded source pixels.
     * @param {Object} image RGBA image with scan channel count and RGB/BGR ordering.
     * @param {number} phase Scan-component positions to shift right, across channel and row boundaries.
     * @param {number} ppm Sample-clock correction in parts per million.
     * @returns {Uint8ClampedArray} Corrected RGBA pixels, with unavailable scan positions black.
     */
    static correctModemPicture(image, phase = 0, ppm = 0) {
        phase = Number(phase);
        ppm = Number(ppm);
        if (!Number.isFinite(phase) || !Number.isFinite(ppm) || ppm <= -1000000)
            throw Error('Choose finite picture phase and clock corrections.');
        if (!phase && !ppm) return image.pixels.slice();
        const channels = image.channels === 1 ? 1 : 3;
        const components = image.width * image.height * channels;
        const pixels = new Uint8ClampedArray(image.pixels.length);
        const ratio = 1 + ppm / 1000000;
        for (let offset = 3; offset < pixels.length; offset += 4) pixels[offset] = 255;
        for (let component = 0; component < components; component++) {
            const source = Math.round(component * ratio - phase);
            if (source < 0 || source >= components) continue;
            const row = Math.floor(component / (image.width * channels));
            const sourceRow = Math.floor(source / (image.width * channels));
            const column = component % image.width;
            const sourceColumn = source % image.width;
            const targetPixel = (row * image.width + column) * 4;
            const sourcePixel = (sourceRow * image.width + sourceColumn) * 4;
            if (channels === 1) {
                const value = image.pixels[sourcePixel];
                pixels[targetPixel] = pixels[targetPixel + 1] = pixels[targetPixel + 2] = value;
            } else {
                const plane = Math.floor(component / image.width) % 3;
                const sourcePlane = Math.floor(source / image.width) % 3;
                const channel = image.reverse ? 2 - plane : plane;
                const sourceChannel = image.reverse ? 2 - sourcePlane : sourcePlane;
                pixels[targetPixel + channel] = image.pixels[sourcePixel + sourceChannel];
            }
        }
        return pixels;
    }
    /**
     * Export a picture as PNG/JPEG through canvas or as an explicitly encoded BMP.
     * @param {Object} picture Picture dimensions and RGBA pixels.
     * @param {string|number} type Picture export type or native sensor sample representation.
     * @param {number} quality Canvas JPEG export quality from zero through one.
     * @returns {Promise<Blob>} Encoded image ready for download.
     */
    static async pictureBlob(picture, type = 'png', quality = 0.9) {
        const canvas = PictureTools.pictureCanvas(picture);
        if (type === 'bmp') return new Blob([PictureTools.pictureBmp(picture)], { type: 'image/bmp' });
        return new Promise((resolve, reject) =>
            canvas.toBlob((b) => (b ? resolve(b) : reject(Error('Picture export failed.'))), 'image/' + type, quality)
        );
    }
    /**
     * Encode RGBA pixels as a bottom-up, row-aligned 24-bit BMP.
     * @returns {Uint8Array} Complete BMP file bytes.
     */
    static pictureBmp({ width, height, pixels }) {
        const stride = (width * 3 + 3) & ~3,
            bytes = new Uint8Array(54 + stride * height),
            v = new DataView(bytes.buffer);
        bytes[0] = 66;
        bytes[1] = 77;
        v.setUint32(2, bytes.length, true);
        v.setUint32(10, 54, true);
        v.setUint32(14, 40, true);
        v.setInt32(18, width, true);
        v.setInt32(22, height, true);
        v.setUint16(26, 1, true);
        v.setUint16(28, 24, true);
        v.setUint32(34, stride * height, true);
        for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++) {
                const p = (y * width + x) * 4,
                    o = 54 + (height - 1 - y) * stride + x * 3;
                bytes[o] = pixels[p + 2];
                bytes[o + 1] = pixels[p + 1];
                bytes[o + 2] = pixels[p];
            }
        return bytes;
    }
}
export const readPicture = PictureTools.readPicture.bind(PictureTools);
export const pictureCanvas = PictureTools.pictureCanvas.bind(PictureTools);
export const samplePicture = PictureTools.samplePicture.bind(PictureTools);
export const preparePicture = PictureTools.preparePicture.bind(PictureTools);
export const pictureBlob = PictureTools.pictureBlob.bind(PictureTools);
export const pictureBmp = PictureTools.pictureBmp.bind(PictureTools);
