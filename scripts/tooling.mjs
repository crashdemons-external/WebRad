import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import { EOL } from 'node:os';
import { spawn } from 'node:child_process';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** File and process operations shared by the build scripts. */
export class Tooling {
    /** Project directory, independent of the current working directory. */
    static ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    /** Engine names, source categories and loader factories. */
    static ENGINES = [
        { name: 'multimode', category: 'modems' },
        { name: 'analog-sstv', category: 'slow-scan', factory: 'createMMSSTV' },
        { name: 'hamdrm', category: 'file-transfer', factory: 'createQSSTV' },
        { name: 'jpeg2000', category: 'image-codecs', factory: 'createJPEG2000' },
        { name: 'beacon-messages', category: 'modems' },
        { name: 'aircraft-messages', category: 'modems' },
        { name: 'terminal-tones', category: 'modems' },
        { name: 'radio-identifiers', category: 'modems' },
        { name: 'spectral-pictures', category: 'image-codecs' },
        { name: 'satellite-pictures', category: 'slow-scan' },
        { name: 'weather-fax', category: 'weather-fax', factory: 'createWEFAX' },
        ...['packet-radio', 'weak-signal', 'sound-messages', 'signaling', 'digital-voice', 'sensor-radio'].map(
            (name) => ({ name, category: 'modems' })
        )
    ];
    /**
     * Determine whether this module was run as a command.
     * @param {string|URL} url Module URL to compare with the current command.
     * @returns {boolean} Whether this module is the command entry point.
     */
    static isMain(url) {
        return process.argv[1] && fileURLToPath(url) === resolve(process.argv[1]);
    }
    /**
     * Determine whether a path stays inside the given directory.
     * @param {string} root Directory that bounds the path.
     * @param {string} path Absolute or relative filesystem path to check.
     * @returns {boolean} Whether the path is inside the root directory.
     */
    static inside(root, path) {
        const rel = relative(root, path);
        return rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
    }
    /**
     * Read a UTF-8 file with LF line endings.
     * @param {string} path Source file path.
     * @returns {Promise<string>} Source text with normalized newlines.
     */
    static async readText(path) {
        return (await readFile(path, 'utf8')).replace(/\r\n?/g, '\n');
    }
    /**
     * Write text with the platform's line endings.
     * @param {string} path Destination file path.
     * @param {string} text Text to write.
     */
    static writeText(path, text) {
        return writeFile(path, text.replace(/\r\n?/g, '\n').replace(/\n/g, EOL));
    }
    /**
     * List files in sorted order. Symbolic links are not allowed.
     * @param {string} root Directory to search.
     * @param {string} prefix Relative path prefix within the directory.
     * @returns {Promise<string[]>} Paths relative to root.
     */
    static async filesUnder(root, prefix = '') {
        const files = [];
        for (const entry of await readdir(resolve(root, prefix), { withFileTypes: true })) {
            const name = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isSymbolicLink()) throw Error(`Unexpected symbolic link: ${name}`);
            if (entry.isDirectory()) files.push(...(await Tooling.filesUnder(root, name)));
            else if (entry.isFile()) files.push(name);
        }
        return files.sort();
    }
    /**
     * Reject paths outside the root or paths that traverse a symbolic link.
     * @param {string} root Directory that bounds the path.
     * @param {string} path Absolute or relative path to validate.
     * @returns {Promise<string>} The validated path.
     */
    static async confinedPath(root, path) {
        root = resolve(root);
        if (!Tooling.inside(root, path)) throw Error('Unsafe path');
        // Check each component so no symlink or junction is served.
        let current = root;
        if ((await lstat(current)).isSymbolicLink()) throw Error('Unsafe path');
        for (const part of relative(root, path).split(sep).filter(Boolean)) {
            current = resolve(current, part);
            if ((await lstat(current)).isSymbolicLink()) throw Error('Unsafe path');
        }
        return path;
    }
    /**
     * Check an asset path and get its file information.
     * @param {string} root Directory that bounds the asset path.
     * @param {string} name Relative asset filename.
     * @returns {Promise<Object>} Validated file path and stat metadata.
     */
    static async checkedFile(root, name) {
        // Asset inventories use relative, forward-slash paths on every platform.
        if (
            typeof name !== 'string' ||
            !name ||
            name.includes('\\') ||
            name.includes(':') ||
            name.includes('\0') ||
            name.startsWith('/') ||
            name.split('/').some((part) => !part || part === '.' || part === '..')
        ) {
            throw Error(`Unsafe path: ${name}`);
        }
        const path = resolve(root, name);
        try {
            await Tooling.confinedPath(root, path);
        } catch (error) {
            if (error.message === 'Unsafe path') throw Error(`Unsafe path: ${name}`);
            throw error;
        }
        const info = await lstat(path);
        if (!info.isFile()) throw Error(`Missing file: ${name}`);
        return { path, info };
    }
    /**
     * Determine whether a file exists. Errors other than ENOENT still propagate.
     * @param {string} path File path to check.
     * @returns {Promise<boolean>} Whether a regular file exists.
     */
    static async exists(path) {
        try {
            return (await lstat(path)).isFile();
        } catch (error) {
            if (error.code === 'ENOENT') return false;
            throw error;
        }
    }
    /**
     * Run a command with explicit arguments and inherited output.
     * @param {string} command Executable path or name.
     * @param {string[]} args Arguments passed directly to the executable.
     * @param {string} cwd Working directory for the process.
     * @returns {Promise<void>} Rejects if the process fails.
     */
    static run(command, args, cwd = Tooling.ROOT) {
        return new Promise((resolveRun, reject) => {
            const child = spawn(command, args, { cwd, stdio: 'inherit', shell: false });
            child.on('error', reject);
            child.on('exit', (code, signal) =>
                code === 0 ? resolveRun() : reject(Error(`${command} failed (${signal || code}).`))
            );
        });
    }
    /**
     * Report an error and mark the command as failed.
     * @param {Error} error Error to report.
     */
    static fail(error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
export const ROOT = Tooling.ROOT;
export const ENGINES = Tooling.ENGINES;
export const isMain = Tooling.isMain.bind(Tooling);
export const inside = Tooling.inside.bind(Tooling);
export const readText = Tooling.readText.bind(Tooling);
export const writeText = Tooling.writeText.bind(Tooling);
export const filesUnder = Tooling.filesUnder.bind(Tooling);
export const confinedPath = Tooling.confinedPath.bind(Tooling);
export const checkedFile = Tooling.checkedFile.bind(Tooling);
export const exists = Tooling.exists.bind(Tooling);
export const run = Tooling.run.bind(Tooling);
export const fail = Tooling.fail.bind(Tooling);
