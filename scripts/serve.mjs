import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';
import { ROOT, inside, confinedPath, isMain, fail } from './tooling.mjs';

/** Preview server for the static app, with byte ranges for audio playback. */
export class PreviewServer {
    /** Content types for supported static assets and audio recordings. */
    static mime = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.mjs': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json',
        '.wasm': 'application/wasm',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.webp': 'image/webp',
        '.wav': 'audio/wav',
        '.mp3': 'audio/mpeg',
        '.ogg': 'audio/ogg',
        '.flac': 'audio/flac',
        '.txt': 'text/plain; charset=utf-8',
        '.md': 'text/plain; charset=utf-8'
    };
    /**
     * Read a single HTTP byte range. Invalid or out-of-range requests throw.
     * @param {string|undefined} header HTTP Range header, if supplied.
     * @param {number} size File size in bytes.
     * @returns {Object|null} Inclusive start/end byte positions, or null without a range.
     */
    static byteRange(header, size) {
        if (!header) return null;
        const match = /^bytes=(\d*)-(\d*)$/.exec(header);
        if (!match || (!match[1] && !match[2]) || !size) throw Error('Invalid range');
        let start, end;
        if (!match[1]) {
            const suffix = Number(match[2]);
            if (!Number.isSafeInteger(suffix) || suffix <= 0) throw Error('Invalid range');
            start = Math.max(0, size - suffix);
            end = size - 1;
        } else {
            start = Number(match[1]);
            end = match[2] ? Number(match[2]) : size - 1;
            if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start)
                throw Error('Invalid range');
            end = Math.min(end, size - 1);
        }
        return { start, end };
    }
    /**
     * Create a server restricted to files under root. The caller must start listening.
     * @param {Object} options Server options.
     * @param {string} options.root Directory to serve.
     * @returns {Promise<import("node:http").Server>} Server ready to listen.
     */
    static async previewServer({ root = join(ROOT, 'build/out') } = {}) {
        const servedRoot = resolve(root);
        await confinedPath(servedRoot, servedRoot);
        return createServer((request, response) => PreviewServer.serveRequest(servedRoot, request, response));
    }
    /** Check the request path, find its file and send the response. */
    static async serveRequest(root, request, response) {
        response.setHeader('Cache-Control', 'no-cache');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        if (!['GET', 'HEAD'].includes(request.method))
            return PreviewServer.sendError(request, response, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
        let pathname;
        try {
            pathname = decodeURIComponent(request.url.split('?')[0]);
        } catch {
            return PreviewServer.sendError(request, response, 400, 'Invalid URL');
        }
        if (!PreviewServer.validRequestPath(pathname))
            return PreviewServer.sendError(request, response, 400, 'Invalid URL');
        const path = resolve(root, '.' + pathname);
        if (!inside(root, path)) return PreviewServer.sendError(request, response, 403, 'Forbidden');
        try {
            const file = await PreviewServer.requestedFile(root, path, pathname, request, response);
            if (!file) return;
            if (!file.info.isFile()) return PreviewServer.sendError(request, response, 404, 'Not found');
            await PreviewServer.sendFile(request, response, file.path, file.info);
        } catch (error) {
            if (response.headersSent) response.destroy();
            else {
                const code = PreviewServer.fileErrorStatus(error);
                PreviewServer.sendError(request, response, code, code === 404 ? 'Not found' : 'Unable to serve file');
            }
        }
    }
    /** Reject malformed URLs and Windows path syntax before resolving a file. */
    static validRequestPath(pathname) {
        return pathname.startsWith('/') && !pathname.includes('\0') && !pathname.includes('\\') && !pathname.includes(':');
    }
    /** Resolve files and directory indexes, rejecting symlinks along both paths. */
    static async requestedFile(root, path, pathname, request, response) {
        await confinedPath(root, path);
        let info = await stat(path);
        if (info.isDirectory()) {
            if (!pathname.endsWith('/')) {
                PreviewServer.redirectDirectory(request, response);
                return null;
            }
            path = join(path, 'index.html');
            await confinedPath(root, path);
            info = await stat(path);
        }
        return { path, info };
    }
    /** Add a directory's trailing slash without dropping its query string. */
    static redirectDirectory(request, response) {
        const queryAt = request.url.indexOf('?');
        response.writeHead(301, {
            Location: request.url.slice(0, queryAt < 0 ? undefined : queryAt) + '/' +
                (queryAt < 0 ? '' : request.url.slice(queryAt))
        });
        response.end();
    }
    /** Send a whole file or byte range, including headers for HEAD requests. */
    static async sendFile(request, response, path, info) {
        let range;
        try {
            range = PreviewServer.byteRange(request.headers.range, info.size);
        } catch {
            return PreviewServer.sendError(request, response, 416, 'Requested range not satisfiable', {
                'Content-Range': `bytes */${info.size}`
            });
        }
        const headers = {
            'Content-Type': PreviewServer.mime[extname(path).toLowerCase()] || 'application/octet-stream',
            'Content-Length': range ? range.end - range.start + 1 : info.size,
            'Accept-Ranges': 'bytes'
        };
        if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${info.size}`;
        response.writeHead(range ? 206 : 200, headers);
        if (request.method === 'HEAD' || info.size === 0) return response.end();
        await pipeline(createReadStream(path, range || undefined), response);
    }
    /** Map file lookup failures to their HTTP status. */
    static fileErrorStatus(error) {
        switch (error.code) {
            case 'ENOENT':
            case 'ENOTDIR': return 404;
            case 'EACCES': return 403;
            default: return error.message === 'Unsafe path' ? 403 : 500;
        }
    }
    /** Send an error body, omitting it for HEAD requests. */
    static sendError(request, response, code, text, headers = {}) {
        response.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
        response.end(request.method === 'HEAD' ? undefined : text + '\n');
    }
}
if (isMain(import.meta.url)) {
    try {
        const { values } = parseArgs({
            options: {
                port: { type: 'string', default: '8080' },
                bind: { type: 'string', default: '127.0.0.1' },
                help: { type: 'boolean' }
            }
        });
        if (values.help)
            console.log(
                'Local static preview; application processing happens in the browser.\nUsage: npm start -- [--port 8080] [--bind 127.0.0.1]'
            );
        else {
            if (!/^\d+$/.test(values.port) || Number(values.port) > 65535)
                throw Error('Port must be an integer from 0 to 65535.');
            const server = await PreviewServer.previewServer();
            server.on('error', fail);
            server.listen(Number(values.port), values.bind, () => {
                const host = values.bind.includes(':') ? `[${values.bind}]` : values.bind;
                console.log(`WebRad: http://${host}:${server.address().port}/`);
            });
            for (const signal of ['SIGINT', 'SIGTERM'])
                process.once(signal, () => {
                    server.close();
                    server.closeAllConnections();
                });
        }
    } catch (error) {
        fail(error);
    }
}
export const byteRange = PreviewServer.byteRange.bind(PreviewServer);
export const previewServer = PreviewServer.previewServer.bind(PreviewServer);
