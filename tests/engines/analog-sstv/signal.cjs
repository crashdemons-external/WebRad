/* Independent SSTV audio fixtures. No encoder is exposed by the application. */
'use strict';
const fs = require('node:fs');
class Signal {
    constructor(rate = 11025) {
        this.rate = rate;
        this.time = 0;
        this.phase = 0;
        this.values = [];
    }
    tone(freq, ms) {
        this.time += (ms * this.rate) / 1000;
        const end = Math.round(this.time);
        for (let n = this.values.length; n < end; n++) {
            this.phase += (2 * Math.PI * freq) / this.rate;
            this.values.push(freq ? Math.sin(this.phase) * 0.65 : 0);
        }
        return this;
    }
    vis(code) {
        this.tone(0, 100).tone(1900, 300).tone(1200, 10).tone(1900, 300).tone(1200, 30);
        let parity = 0;
        for (let i = 0; i < 7; i++) {
            const bit = (code >> i) & 1;
            parity ^= bit;
            this.tone(bit ? 1100 : 1300, 30);
        }
        return this.tone(parity ? 1100 : 1300, 30).tone(1200, 30);
    }
    scan(ms, component) {
        const colors = [
            [240, 20, 20],
            [20, 240, 20],
            [20, 20, 240],
            [160, 160, 160]
        ];
        for (const color of colors) this.tone(1500 + (800 * color[component]) / 256, ms / 4);
        return this;
    }
    martin(two = false, lines = 260) {
        this.vis(two ? 40 : 44);
        const scan = two ? 73.216 : 146.432;
        for (let y = 0; y < lines; y++)
            this.tone(1200, 4.862)
                .tone(1500, 0.572)
                .scan(scan, 1)
                .tone(1500, 0.572)
                .scan(scan, 2)
                .tone(1500, 0.572)
                .scan(scan, 0)
                .tone(1500, 0.572);
        return this.tone(0, 200);
    }
    scottie(two = false, lines = 258) {
        this.vis(two ? 56 : 60);
        const scan = two ? 88.064 : 138.24;
        this.tone(1200, 9);
        for (let y = 0; y < lines; y++)
            this.tone(1500, 1.5)
                .scan(scan, 1)
                .tone(1500, 1.5)
                .scan(scan, 2)
                .tone(1200, 9)
                .tone(1500, 1.5)
                .scan(scan, 0);
        return this.tone(0, 200);
    }
    robot(lines = 245) {
        this.vis(8);
        for (let y = 0; y < lines; y++)
            this.tone(1200, 9)
                .tone(1500, 3)
                .tone(1500 + (800 * 160) / 256, 88)
                .tone(y & 1 ? 2300 : 1500, 4.5)
                .tone(1900, 1.5)
                .tone(1900, 44);
        return this.tone(0, 200);
    }
    pd120(lines = 252) {
        this.vis(95);
        for (let y = 0; y < lines; y++)
            this.tone(1200, 20)
                .tone(1500, 2.08)
                .tone(2000, 121.6)
                .tone(1900, 121.6)
                .tone(1900, 121.6)
                .tone(2000, 121.6);
        return this.tone(0, 200);
    }
    fsk(call) {
        this.tone(0, 100).tone(2100, 100).tone(1900, 22);
        const emit = (c) => {
            for (let i = 0; i < 6; i++) this.tone((c >> i) & 1 ? 1900 : 2100, 22);
        };
        emit(0x2a);
        let sum = 0;
        for (const c of call) {
            const value = c.charCodeAt(0) - 32;
            sum ^= value;
            emit(value);
        }
        emit(1);
        emit(sum);
        return this.tone(2100, 100).tone(0, 200);
    }
    data() {
        return Float32Array.from(this.values);
    }
    wav(path) {
        const data = this.data(),
            bytes = Buffer.alloc(44 + data.length * 2);
        bytes.write('RIFF', 0);
        bytes.writeUInt32LE(bytes.length - 8, 4);
        bytes.write('WAVEfmt ', 8);
        bytes.writeUInt32LE(16, 16);
        bytes.writeUInt16LE(1, 20);
        bytes.writeUInt16LE(1, 22);
        bytes.writeUInt32LE(this.rate, 24);
        bytes.writeUInt32LE(this.rate * 2, 28);
        bytes.writeUInt16LE(2, 32);
        bytes.writeUInt16LE(16, 34);
        bytes.write('data', 36);
        bytes.writeUInt32LE(data.length * 2, 40);
        for (let n = 0; n < data.length; n++) bytes.writeInt16LE(Math.round(data[n] * 32767), 44 + n * 2);
        fs.writeFileSync(path, bytes);
    }
}
module.exports = { Signal };
if (require.main === module) {
    fs.mkdirSync('build/test-fixtures', { recursive: true });
    new Signal(48000).martin(true).fsk('N0CALL').wav('build/test-fixtures/martin2-48000.wav');
    console.log('Generated build/test-fixtures/martin2-48000.wav');
}
