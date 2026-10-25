/** Parser for native HAMDRM missing-segment requests. */
export class RecoveryRequest {
    /**
     * Validate a QSSTV recovery request, expand missing-segment ranges and recover transport settings.
     * @param {string} text QSSTV recovery request text.
     * @returns {Object} Transport ID, filename, compatible settings and unique missing segments.
     */
    static parseRecovery(text) {
        if (typeof text !== 'string' || text.length > 65536)
            throw Error('Recovery requests must be smaller than 64 KB.');
        const lines = text.trim().split(/\r?\n/);
        const { transport, end } = RecoveryRequest.readHeader(lines);
        const segments = RecoveryRequest.readSegments(lines, end);
        const name = lines[end + 1] || '';
        const settings = RecoveryRequest.readSettings(name, lines[end + 2] || '');
        return { transport, name, settings, segments: [...new Set(segments)] };
    }
    /** Validate the transport ID, segment count and end marker. */
    static readHeader(lines) {
        const transport = Number(lines[0]);
        const size = Number(lines[2]);
        const end = lines.indexOf('-99');
        if (
            lines[1] !== 'H_OK' ||
            !Number.isInteger(transport) ||
            transport < 3 ||
            transport > 65535 ||
            !Number.isInteger(size) ||
            size < 1 ||
            size > 8191 ||
            end < 4
        )
            throw Error('Invalid QSSTV recovery request header.');
        return { transport, end };
    }
    /** Expand individual segment numbers and inclusive missing ranges. */
    static readSegments(lines, end) {
        const segments = [];
        let previous = -1;
        for (let i = 3; i < end; i++) {
            const number = Number(lines[i]);
            if (number === -1) {
                const next = Number(lines[++i]);
                if (previous < 0 || i >= end || !Number.isInteger(next) || next >= 8192 || next <= previous)
                    throw Error('Invalid recovery segment range.');
                for (let n = previous + 1; n <= next; n++) segments.push(n);
                previous = next;
            } else {
                if (!lines[i].trim() || !Number.isInteger(number) || number < 0 || number >= 8192)
                    throw Error('Invalid missing segment number.');
                segments.push(number);
                previous = number;
            }
            if (segments.length > 8192) throw Error('Too many recovery segments.');
        }
        return segments;
    }
    /** Decode a transport profile and the filename's Reed–Solomon suffix. */
    static readSettings(name, code) {
        const rs = /\.rs([1-4])$/i.exec(name);
        if (!/^[0-2][01][01][0-2][01]$/.test(code)) return null;
        return {
            drmMode: Number(code[0]),
            drmBandwidth: Number(code[1]),
            drmProtection: Number(code[2]),
            drmQam: Number(code[3]),
            drmInterleave: Number(code[4]),
            rs: rs ? Number(rs[1]) : 0
        };
    }
}
export const parseRecovery = RecoveryRequest.parseRecovery.bind(RecoveryRequest);
