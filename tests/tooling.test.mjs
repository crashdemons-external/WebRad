import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import { pathToFileURL } from 'node:url';
import { previewServer } from '../scripts/serve.mjs';
import { verifyAssets } from '../scripts/verify.mjs';
import { ApplicationBuilder, missingCores } from '../scripts/build.mjs';
import { engineCommands } from '../scripts/build-engines.mjs';
import { ROOT, ENGINES, inside, filesUnder } from '../scripts/tooling.mjs';

async function temporary(t) {
    const path = await mkdtemp(join(tmpdir(), 'webrad-tooling-'));
    t.after(async () => {
        assert.ok(inside(tmpdir(), resolve(path)) && resolve(path) !== resolve(tmpdir()));
        await rm(path, { recursive: true, force: true });
    });
    return path;
}
const json = (path, value) => writeFile(path, JSON.stringify(value));
function get(server, path, { method = 'GET', headers = {} } = {}) {
    return new Promise((resolveResponse, reject) => {
        const req = request(
            { host: '127.0.0.1', port: server.address().port, path, method, headers, agent: false },
            (res) => {
                const chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () =>
                    resolveResponse({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks) })
                );
                res.on('error', reject);
            }
        );
        req.on('error', reject);
        req.end();
    });
}
async function serverFixture(t) {
    const temp = await temporary(t),
        root = join(temp, 'site');
    await mkdir(join(root, 'folder'), { recursive: true });
    await mkdir(join(root, 'empty'));
    await writeFile(join(root, 'index.html'), '<h1>WebRad</h1>');
    await writeFile(join(root, 'folder/index.html'), 'nested');
    await writeFile(join(root, 'core.wasm'), Buffer.from([0, 97, 115, 109]));
    await writeFile(join(root, 'audio.wav'), Buffer.from(Array.from({ length: 100 }, (_, i) => i)));
    await writeFile(join(temp, 'secret.txt'), 'outside site');
    const server = await previewServer({ root });
    await new Promise((ok, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', ok);
    });
    t.after(
        () =>
            new Promise((ok) => {
                server.close(ok);
                server.closeAllConnections();
            })
    );
    return { server, temp, root };
}

async function buildFixture(t, version = '1.1') {
    const root = await temporary(t);
    for (const directory of ['src/app', 'src/runtime', 'src/engines', 'scripts', 'licenses', 'build/wasm', 'tests'])
        await mkdir(join(root, directory), { recursive: true });
    await cp(join(ROOT, 'src/app'), join(root, 'src/app'), { recursive: true });
    await cp(join(ROOT, 'src/runtime'), join(root, 'src/runtime'), { recursive: true });
    await cp(join(ROOT, 'scripts'), join(root, 'scripts'), { recursive: true });
    await cp(join(ROOT, 'licenses'), join(root, 'licenses'), { recursive: true });
    await cp(join(ROOT, 'build/wasm'), join(root, 'build/wasm'), { recursive: true });
    await json(join(root, 'build.config.json'), { version });
    await mkdir(join(root, 'build/out'), { recursive: true });
    await writeFile(join(root, 'build/out/stale-from-last-build.txt'), 'stale');
    await writeFile(join(root, 'src/engines/unused-native-source.c'), 'source must not be deployed');
    await writeFile(join(root, 'tests/unused.test.mjs'), 'test source must not be deployed');
    const output = await ApplicationBuilder.assemble(root);
    await json(join(output, 'formats.json'), { schema: 1, formats: [{ id: 'fixture' }] });
    return { root, output };
}

test('Node preview serves the entrypoint and WASM, supports HEAD, and never lists directories', async (t) => {
    const { server } = await serverFixture(t);
    const home = await get(server, '/?preview=1');
    assert.equal(home.status, 200);
    assert.equal(home.bytes.toString(), '<h1>WebRad</h1>');
    assert.match(home.headers['content-type'], /text\/html/);
    assert.equal(home.headers['cache-control'], 'no-cache');
    assert.equal(home.headers['x-content-type-options'], 'nosniff');
    const wasm = await get(server, '/core.wasm', { method: 'HEAD' });
    assert.equal(wasm.status, 200);
    assert.equal(wasm.headers['content-type'], 'application/wasm');
    assert.equal(wasm.headers['content-length'], '4');
    assert.equal(wasm.bytes.length, 0);
    const redirect = await get(server, '/folder?x=1');
    assert.equal(redirect.status, 301);
    assert.equal(redirect.headers.location, '/folder/?x=1');
    assert.equal((await get(server, '/folder/')).bytes.toString(), 'nested');
    assert.equal((await get(server, '/empty/')).status, 404);
    assert.equal((await get(server, '/missing')).status, 404);
    assert.equal((await get(server, '/', { method: 'POST' })).status, 405);
});

test('Node preview supports byte ranges for audio seeking and rejects unsatisfiable ranges', async (t) => {
    const { server } = await serverFixture(t);
    for (const [header, start, end] of [
        ['bytes=10-19', 10, 19],
        ['bytes=90-', 90, 99],
        ['bytes=-5', 95, 99],
        ['bytes=98-200', 98, 99]
    ]) {
        const response = await get(server, '/audio.wav', { headers: { Range: header } });
        assert.equal(response.status, 206);
        assert.equal(response.headers['content-range'], `bytes ${start}-${end}/100`);
        assert.equal(response.headers['content-type'], 'audio/wav');
        assert.deepEqual(
            [...response.bytes],
            Array.from({ length: end - start + 1 }, (_, i) => i + start)
        );
    }
    const head = await get(server, '/audio.wav', { method: 'HEAD', headers: { Range: 'bytes=5-9' } });
    assert.equal(head.status, 206);
    assert.equal(head.headers['content-length'], '5');
    assert.equal(head.bytes.length, 0);
    for (const range of ['bytes=100-', 'bytes=5-2', 'bytes=-0', 'bytes=1-2,4-5', 'bytes=-']) {
        const response = await get(server, '/audio.wav', { headers: { Range: range } });
        assert.equal(response.status, 416);
        assert.equal(response.headers['content-range'], 'bytes */100');
    }
});

test('Node preview rejects encoded traversal and malformed paths', async (t) => {
    const { server } = await serverFixture(t);
    for (const path of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt'])
        assert.equal((await get(server, path)).status, 403, path);
    for (const path of ['/%zz', '/%00', '/..%5csecret.txt', '/C:/secret.txt'])
        assert.equal((await get(server, path)).status, 400, path);
});

test('Node preview and deployment verification reject directory junctions/symlinks', async (t) => {
    const { server, temp, root } = await serverFixture(t);
    const outside = join(temp, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'data.bin'), 'outside');
    try {
        await symlink(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
        if (['EPERM', 'EACCES'].includes(error.code)) {
            t.skip('Creating links is unavailable on this host');
            return;
        }
        throw error;
    }
    assert.equal((await get(server, '/linked/data.bin')).status, 403);
    await assert.rejects(verifyAssets(root), /Unsafe path|symbolic link|Missing/);
});

test('app assembly removes stale output and deploys only declared app, runtime, WASM, and license files', async (t) => {
    const { root, output } = await buildFixture(t);
    const expected = await ApplicationBuilder.expectedFiles(root);
    assert.deepEqual(await filesUnder(output), expected);
    assert.equal(
        (await filesUnder(output)).some((name) =>
            /(?:tests?|source|build-reference|import-manifest|build-info)/i.test(name)
        ),
        false
    );
    assert.ok((await filesUnder(output)).some((name) => name.startsWith('licenses/engines/')));
    assert.ok((await filesUnder(output)).some((name) => name.startsWith('app/')));
    assert.ok((await filesUnder(output)).some((name) => name.startsWith('runtime/engines/')));
    assert.ok((await filesUnder(output)).some((name) => name.startsWith('wasm/')));
    assert.deepEqual(await verifyAssets(output, root), expected.length);
});

test('build versions reach HTML, transitive modules, workers, the catalog and native assets', async (t) => {
    const { root, output } = await buildFixture(t, '1.1');
    for (const version of ['1.1', '1.2']) {
        if (version === '1.2') {
            await json(join(root, 'build.config.json'), { version });
            await ApplicationBuilder.assemble(root);
            await json(join(output, 'formats.json'), { schema: 1, formats: [{ id: 'fixture' }] });
        }
        for (const [name, references] of [
            ['index.html', ['app/app.js', 'app/theme.js', 'app/styles.css', 'app/application.css', 'app/icon.svg']],
            ['licenses.html', ['app/theme.js', 'app/styles.css']],
            ['app/app.js', ['./application.js']],
            ['app/application.js', ['./mic-worklet.js', '../formats.json', './icons.js']],
            ['app/bridge.js', ['./engine-worker.js']],
            ['app/engine-worker.js', ['./engine-host.js']],
            ['runtime/engines/multimode/decoder-session.js', ['./resampler.js']]
        ]) {
            const source = await readFile(join(output, name), 'utf8');
            for (const reference of references) assert.ok(source.includes(`${reference}?v=${version}`), `${name}: ${reference}`);
        }
        const moduleUrl = pathToFileURL(join(output, 'app/engine-host.js'));
        moduleUrl.searchParams.set('v', version);
        const { EngineCore } = await import(moduleUrl);
        const loader = EngineCore.assetUrl('../wasm/multimode.js');
        assert.equal(loader.searchParams.get('v'), version);
        const wasm = EngineCore.assetUrl('multimode.wasm', loader);
        assert.equal(wasm.searchParams.get('v'), version);
        assert.ok(wasm.pathname.endsWith('/wasm/multimode.wasm'));
        assert.equal(await verifyAssets(output, root), (await ApplicationBuilder.expectedFiles(root)).length);
    }
});

test('version rewriting replaces old versions and preserves query values, fragments and external URLs', () => {
    const source = `import './a.js?mode=fast&v=old#part';
export { a } from './b.js';
const worker = new URL('./worker.js?v=2', import.meta.url);
const remote = import('https://example.com/core.js');
const label = './untouched.js';`;
    const result = ApplicationBuilder.versionJavascript(source, '1.1');
    assert.ok(result.includes('./a.js?mode=fast&v=1.1#part'));
    assert.ok(result.includes('./b.js?v=1.1'));
    assert.ok(result.includes('./worker.js?v=1.1'));
    assert.ok(result.includes("import('https://example.com/core.js')"));
    assert.ok(result.includes("const label = './untouched.js'"));
    assert.equal(ApplicationBuilder.versionJavascript(result, '1.1'), result);
});

test('invalid build versions fail before replacing a previous deployment', async (t) => {
    const { root, output } = await buildFixture(t);
    const entry = await readFile(join(output, 'index.html'), 'utf8');
    for (const version of ['', 1.1, '1.1&other=value', null]) {
        await json(join(root, 'build.config.json'), { version });
        await assert.rejects(ApplicationBuilder.assemble(root), /build.config.json version/);
        assert.equal(await readFile(join(output, 'index.html'), 'utf8'), entry);
    }
});

test('deployment verifier catches stale output, broken browser references, and altered WASM', async (t) => {
    const { root, output } = await buildFixture(t);
    await mkdir(join(output, 'engines/old/docs'), { recursive: true });
    await writeFile(join(output, 'engines/old/docs/README.md'), 'historical source');
    await assert.rejects(verifyAssets(output, root), /Unexpected deployed asset/);
    await rm(join(output, 'engines'), { recursive: true });
    const entry = join(output, 'index.html'),
        original = await (await import('node:fs/promises')).readFile(entry, 'utf8');
    await writeFile(entry, original.replace('app/app.js', 'app/missing.js'));
    await assert.rejects(verifyAssets(output, root), /Broken reference/);
    await writeFile(entry, original);
    const wasm = join(output, 'wasm', `${ENGINES[0].name}.wasm`),
        bytes = await (await import('node:fs/promises')).readFile(wasm);
    await writeFile(wasm, Buffer.from([0, 97, 115, 109]));
    await assert.rejects(verifyAssets(output, root), /Invalid WASM|Changed WASM/);
    await writeFile(wasm, bytes);
    assert.equal(await verifyAssets(output, root), (await ApplicationBuilder.expectedFiles(root)).length);
});

test('app build detects every missing flat core pair before creating output', async (t) => {
    const root = await temporary(t);
    assert.equal((await missingCores(root)).length, ENGINES.length * 2);
    assert.deepEqual(
        ENGINES.map(({ name }) => name),
        [
            'multimode',
            'analog-sstv',
            'hamdrm',
            'jpeg2000',
            'beacon-messages',
            'aircraft-messages',
            'terminal-tones',
            'radio-identifiers',
            'spectral-pictures',
            'satellite-pictures',
            'weather-fax',
            'packet-radio',
            'weak-signal',
            'sound-messages',
            'signaling',
            'digital-voice',
            'sensor-radio'
        ]
    );
    await assert.rejects(ApplicationBuilder.assemble(root), /Missing compiled cores[\s\S]*build:engines/);
});

test('native command planner selects named units and skips complete flat pairs', async (t) => {
    const root = await temporary(t),
        all = await engineCommands({ python: 'python-custom' }, root);
    assert.equal(all.length, ENGINES.length);
    assert.ok(all.every((command) => command.command === 'python-custom' && command.args[0] === '-B'));
    const selected = await engineCommands({ engine: 'sound-messages', emsdk: join(root, 'SDK with spaces') }, root);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].args.at(-1), join(root, 'SDK with spaces'));
    assert.ok(selected[0].args.includes('sound-messages'));
    await assert.rejects(engineCommands({ engine: 'unknown' }, root), /Unknown engine/);
    await mkdir(join(root, 'build/wasm'), { recursive: true });
    for (const { name } of ENGINES)
        for (const suffix of ['.js', '.wasm']) await writeFile(join(root, 'build/wasm', name + suffix), 'compiled');
    assert.deepEqual(await engineCommands({ missing: true }, root), []);
    await rm(join(root, 'build/wasm/sound-messages.js'));
    const missing = await engineCommands({ missing: true }, root);
    assert.equal(missing.length, 1);
    assert.ok(missing[0].args.includes('sound-messages'));
});
