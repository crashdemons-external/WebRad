/** Sends requests to one engine worker and resolves responses by request ID.
 * @property {string} engine Engine capability this bridge serves.
 * @property {number} next Next worker request identifier.
 * @property {Map<number, Object>} requests Pending requests keyed by identifier.
 * @property {Worker} worker Native engine worker.
 * @property {Promise<*>} ready Resolves after engine initialization.
 * @property {Error|undefined} failure Stored worker failure, if any.
 */
export class Bridge {
    /**
     * Start the worker for the selected engine.
     * @param {string} engine Native engine capability identifier.
     */
    constructor(engine) {
        this.engine = engine;
        this.next = 1;
        this.requests = new Map();
        this.worker = new Worker(new URL('./engine-worker.js', import.meta.url), { type: 'module' });
        this.worker.onmessage = ({ data }) => {
            const p = this.requests.get(data.id);
            if (!p) return;
            this.requests.delete(data.id);
            data.error ? p.reject(Error(data.error)) : p.resolve(data.result);
        };
        this.worker.onerror = (e) => this.fail(Error(e.message || 'The signal engine stopped unexpectedly.'));
        this.ready = this.call('init', { engine });
    }
    /**
     * Call one engine operation.
     * @param {string} action Engine operation name.
     * @param {Object} args Operation data.
     * @param {ArrayBuffer[]} transfers Buffers transferred to the worker.
     * @returns {Promise<*>} Result returned by the worker.
     */
    call(action, args = {}, transfers = []) {
        if (this.failure) return Promise.reject(this.failure);
        return new Promise((resolve, reject) => {
            const id = this.next++;
            this.requests.set(id, { resolve, reject });
            try {
                this.worker.postMessage({ id, action, args }, transfers);
            } catch (e) {
                this.requests.delete(id);
                reject(e);
            }
        });
    }
    /**
     * Reject pending calls and stop a failed worker.
     * @param {Error} error Worker or request failure.
     */
    fail(error) {
        this.failure = error;
        for (const p of this.requests.values()) p.reject(error);
        this.requests.clear();
        this.worker.terminate();
    }
    /**
     * Cancel pending calls and stop the worker.
     */
    close() {
        this.fail(Error('Operation canceled.'));
        this.worker.terminate();
    }
}
