import { EngineHost } from './engine-host.js';

/** Serializes worker RPC so a native engine is never called concurrently. */
export class EngineWorker {
    /** Native host created by the first initialization request. */
    host;

    /** Promise chain preserving incoming request order, including failures. */
    queue = Promise.resolve();

    /** Register the dedicated-worker message handler. */
    constructor() {
        self.onmessage = ({ data }) => this.enqueue(data);
    }

    /**
     * Append an RPC request to the native execution queue.
     * @param {{id:number, action:string, args:Object}} data Request envelope.
     */
    enqueue(data) {
        this.queue = this.queue.then(() => this.dispatch(data));
    }

    /**
     * Run a queued request and transfer owned result buffers to the UI thread.
     * @param {{id:number, action:string, args:Object}} data Request envelope.
     * @returns {Promise<void>} Resolves after a success or error response is posted.
     */
    async dispatch({ id, action, args }) {
        try {
            let result;
            if (action === 'init') {
                this.host = await EngineHost.create(args.engine);
                result = { ready: true };
            } else {
                if (!this.host) throw Error('Engine is not initialized.');
                result = await this.host[action](args || {});
            }
            const transfers = new Set();
            this.collectTransfers(result, transfers);
            postMessage({ id, result }, [...transfers]);
        } catch (error) {
            postMessage({ id, error: error.message || String(error) });
        }
    }

    /**
     * Collect typed-array backing buffers once, including nested native results.
     * @param {*} value Object or typed array whose buffers are collected.
     * @param {Set<ArrayBuffer>} transfers Unique buffers to transfer.
     */
    collectTransfers(value, transfers) {
        if (ArrayBuffer.isView(value)) transfers.add(value.buffer);
        else if (value && typeof value === 'object') {
            for (const child of Object.values(value)) this.collectTransfers(child, transfers);
        }
    }
}

/** Worker session owning the request queue and native host. */
const worker = new EngineWorker();
