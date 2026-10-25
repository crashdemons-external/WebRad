/** Captures microphone PCM in batches and sends silence to the monitoring graph.
 * @property {Float32Array[]} blocks Captured blocks waiting for a complete batch.
 * @property {number} count Number of captured samples waiting to be sent.
 * @property {string} channel Selected left, right or mixed input channel.
 * @property {boolean} active Whether new microphone samples are accepted.
 */
class WebRadInput extends AudioWorkletProcessor {
    /**
     * Initialize microphone capture buffers and the channel-control message port.
     */
    constructor() {
        super();
        this.blocks = [];
        this.count = 0;
        this.channel = 'left';
        this.active = true;
        this.port.onmessage = ({ data }) => {
            if (data.channel) this.channel = data.channel;
            if (data.type === 'flush') {
                this.active = false;
                this.sendSamples();
                this.port.postMessage({ type: 'flushed' });
            }
        };
    }
    /** Send captured samples, including a partial final batch, in capture order. */
    sendSamples() {
        if (!this.count) return;
        const samples = new Float32Array(this.count);
        let at = 0;
        for (const block of this.blocks) {
            samples.set(block, at);
            at += block.length;
        }
        this.blocks = [];
        this.count = 0;
        this.port.postMessage({ samples }, [samples.buffer]);
    }
    /**
     * Select microphone channels, send full batches to the decoder and silence outputs.
     * @param {Float32Array[][]} inputs AudioWorklet input buses and channels.
     * @param {Float32Array[][]} outputs AudioWorklet output buses, filled with silence.
     * @returns {boolean} Always true to keep microphone capture running.
     */
    process(inputs, outputs) {
        for (const out of outputs) for (const c of out) c.fill(0);
        const channels = inputs[0];
        if (!this.active || !channels?.length) return true;
        const n = channels[0].length,
            block = new Float32Array(n);
        for (let i = 0; i < n; i++)
            block[i] =
                this.channel === 'mix'
                    ? channels.reduce((a, c) => a + c[i] / channels.length, 0)
                    : (channels[this.channel === 'right' ? 1 : 0] || channels[0])[i];
        this.blocks.push(block);
        this.count += n;
        if (this.count >= 2048) this.sendSamples();
        return true;
    }
}
registerProcessor('webrad-input', WebRadInput);
