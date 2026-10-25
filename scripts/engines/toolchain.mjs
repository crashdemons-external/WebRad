import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, delimiter, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { ROOT } from '../tooling.mjs';
import { SourceText } from './source-text.mjs';

/** Compiler discovery, output directories and bounded parallel native compilation. */
export class EngineToolchain {
    /** Project root determined from the build module's location. */
    static root = ROOT;

    /** Create the generated-source or object directory for one engine. */
    static directory(root, leaf) {
        const directory = join(EngineToolchain.root, 'build', leaf, basename(root));
        mkdirSync(directory, { recursive: true });
        return directory;
    }

    /** Return the shared output directory for JavaScript/WASM pairs. */
    static wasmDirectory() {
        const directory = join(EngineToolchain.root, 'build/wasm');
        mkdirSync(directory, { recursive: true });
        return directory;
    }

    /** Find an executable without invoking a command shell. */
    static executable(name, env = process.env) {
        const extensions = process.platform === 'win32' && !extname(name) ?
            ['', ...(env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';')] : [''];
        const directories = isAbsolute(name) || /[\\/]/.test(name) ? [''] : (env.PATH || env.Path || '').split(delimiter);
        for (const directory of directories) {
            for (const extension of extensions) {
                const candidate = directory ? join(directory.replace(/^"|"$/g, ''), name + extension) : name + extension;
                try {
                    accessSync(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
                    if (!statSync(candidate).isFile()) continue;
                    return resolve(candidate);
                } catch (error) {
                    if (!['ENOENT', 'ENOTDIR', 'EACCES'].includes(error.code)) throw error;
                }
            }
        }
        return undefined;
    }

    /** Select only the Python interpreter needed by Emscripten's own driver. */
    static compilerPython(sdk, requested, env = process.env) {
        for (const name of [requested, env.EMSDK_PYTHON, env.PYTHON].filter(Boolean)) {
            const executable = EngineToolchain.executable(name, env);
            if (!executable) throw Error(`Emscripten Python interpreter not found: ${name}`);
            return executable;
        }
        const bundled = join(sdk, 'python');
        if (existsSync(bundled)) {
            for (const entry of readdirSync(bundled).sort().reverse()) {
                for (const name of ['python.exe', 'bin/python3']) {
                    const executable = EngineToolchain.executable(join(bundled, entry, name), env);
                    if (executable) return executable;
                }
            }
        }
        for (const name of process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python']) {
            const executable = EngineToolchain.executable(name, env);
            if (executable) return executable;
        }
        throw Error('Emscripten requires Python. Activate its SDK or specify --python EXECUTABLE.');
    }

    /** Configure an existing SDK; project source preparation itself runs entirely in Node. */
    static compiler({ emsdk, python } = {}) {
        const env = { ...process.env };
        const activated = EngineToolchain.executable('em++', env);
        const sdk = resolve(emsdk || env.EMSDK || join(EngineToolchain.root, '.tools/emsdk'));
        const cache = join(EngineToolchain.root, 'build/emcache');
        mkdirSync(cache, { recursive: true });
        env.EM_CACHE = cache;
        if (!emsdk && activated && !python && !/\.(bat|cmd)$/i.test(activated))
            return { command: activated, args: [], env };
        const upstream = join(sdk, 'upstream');
        const driver = activated && !emsdk ? join(dirname(activated), 'em++.py') : join(upstream, 'emscripten/em++.py');
        if (!existsSync(driver)) throw Error('Activate Emscripten or specify --emsdk PATH.');
        if (emsdk || !activated) {
            const config = join(EngineToolchain.root, 'build/generated/toolchain/emscripten-config.py');
            // This configuration is consumed by Emscripten, which uses Python internally.
            SourceText.write(config, `LLVM_ROOT = ${JSON.stringify(join(upstream, 'bin'))}\n` +
                `BINARYEN_ROOT = ${JSON.stringify(upstream)}\n` +
                `NODE_JS = [${JSON.stringify(process.execPath)}]\nCACHE = ${JSON.stringify(cache)}\n`);
            env.EM_CONFIG = config;
        }
        return { command: EngineToolchain.compilerPython(sdk, python, env), args: [driver], env };
    }

    /** Run the compiler with argument arrays, capturing diagnostics when requested. */
    static execute(compiler, args, cwd, capture = false) {
        return new Promise((resolveResult, reject) => {
            const child = spawn(compiler.command, [...compiler.args, ...args], {
                cwd, env: compiler.env, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', windowsHide: true
            });
            const stdout = [], stderr = [];
            if (capture) {
                child.stdout.on('data', (chunk) => stdout.push(chunk));
                child.stderr.on('data', (chunk) => stderr.push(chunk));
            }
            child.once('error', reject);
            child.once('close', (code, signal) => {
                const result = { code, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) };
                if (code === 0) resolveResult(result);
                else reject(Object.assign(Error(`Compiler failed (${signal || code})`), result));
            });
        });
    }

    /** Hash source bytes and compiler options for the local object cache. */
    static digest(...values) {
        const hash = createHash('sha256');
        for (const value of values) hash.update(value);
        return hash.digest('hex');
    }

    /** Compile at most four sources at once while keeping link order stable. */
    static async parallel(items, operation) {
        let next = 0;
        const results = new Array(items.length);
        const errors = [];
        const worker = async () => {
            while (next < items.length) {
                const index = next++;
                try {
                    results[index] = await operation(items[index]);
                } catch (error) {
                    errors.push(error);
                }
            }
        };
        await Promise.all(Array.from({ length: Math.min(4, items.length) }, worker));
        if (errors.length) throw errors[0];
        return results;
    }

    /** Compile the focused C/C++ cores using the existing exports and runtime settings. */
    static async compileCore(root, name, paths, includes, exports, compiler, extra = [], debug = false) {
        const objects = EngineToolchain.directory(root, 'objects');
        const flags = ['-Wno-deprecated-declarations', '-Wno-format', '-Wno-constant-conversion',
            ...includes.map((path) => '-I' + path), ...extra,
            ...(debug ? ['-O0', '-g3', '-sASSERTIONS=2', '-sSAFE_HEAP=1'] : ['-O3'])];
        const version = await EngineToolchain.execute(compiler, ['--version'], root, true);
        const headers = [version.stdout];
        for (const directory of includes) {
            if (existsSync(directory)) {
                for (const path of SourceText.files(directory).filter((path) => path.endsWith('.h')).sort())
                    headers.push(readFileSync(path));
            }
        }
        const headerHash = EngineToolchain.digest(...headers);
        const built = await EngineToolchain.parallel(paths, async (path) => {
            const options = [...flags, ...(extname(path) === '.c' ? ['-x', 'c', '-std=gnu11'] : ['-std=c++17'])];
            const key = EngineToolchain.digest(readFileSync(path), headerHash, JSON.stringify(options)).slice(0, 16);
            const object = join(objects, basename(path, extname(path)) + '-' + key + '.o');
            if (!existsSync(object)) {
                try {
                    await EngineToolchain.execute(compiler, [...options, '-c', path, '-o', object], root, true);
                } catch (error) {
                    const diagnostics = Buffer.concat([error.stdout || Buffer.alloc(0), error.stderr || Buffer.alloc(0)]).toString();
                    SourceText.write(join(objects, basename(path, extname(path)) + '-error.log'), diagnostics);
                    console.error(diagnostics.slice(0, 1600));
                    throw error;
                }
            }
            return object;
        });
        const response = join(objects, 'objects.rsp');
        SourceText.write(response, built.map((path) => '"' + path.replaceAll('\\', '/') + '"').join('\n'));
        const runtime = ['-sMODULARIZE=1', '-sEXPORT_ES6=1', '-sENVIRONMENT=web,worker,node', '-sALLOW_MEMORY_GROWTH=1',
            '-sSTACK_SIZE=8388608', '-sINITIAL_MEMORY=33554432', '-sFILESYSTEM=0',
            '-sEXPORTED_FUNCTIONS=' + JSON.stringify(['_malloc', '_free', ...exports.map((name) => '_' + name)]),
            '-sEXPORTED_RUNTIME_METHODS=["UTF8ToString","HEAPU8","HEAPF32","HEAP16","HEAP32"]'];
        await EngineToolchain.execute(compiler, [...flags, '@' + response, ...runtime,
            '-o', join(EngineToolchain.wasmDirectory(), name + '.js')], root);
        console.log('Built ' + name);
    }
}
