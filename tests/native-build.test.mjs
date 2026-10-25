import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { NativeEngineBuilder } from '../scripts/engines/build.mjs';
import { EngineToolchain } from '../scripts/engines/toolchain.mjs';
import { SourceText } from '../scripts/engines/source-text.mjs';
import { AdditionalBuilder } from '../scripts/engines/additional/build.mjs';

async function temporary(t) {
    const root = await mkdtemp(join(tmpdir(), 'webrad-native-'));
    t.after(async () => {
        assert.ok(relative(tmpdir(), root).startsWith('webrad-native-'));
        await rm(root, { recursive: true, force: true });
    });
    return root;
}

test('Node preparation preserves every generated source from the original native recipes', async (t) => {
    const root = await temporary(t);
    const originalRoot = EngineToolchain.root;
    EngineToolchain.root = root;
    t.after(() => { EngineToolchain.root = originalRoot; });
    await NativeEngineBuilder.build({ prepareOnly: true, python: 'not-needed-for-source-preparation' });
    const expected = JSON.parse(await readFile(new URL('./fixtures/native-preparation.json', import.meta.url))).files;
    const generated = join(root, 'build/generated');
    const files = SourceText.files(generated).map((path) => relative(generated, path).replaceAll('\\', '/')).sort();
    assert.deepEqual(files, Object.keys(expected).sort());
    for (const name of files) {
        const bytes = await readFile(join(generated, name));
        const normalized = Buffer.from(bytes.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
        assert.equal(createHash('sha256').update(normalized).digest('hex'), expected[name], name);
    }
});

test('source patches preserve literal dollar characters and enforce upstream markers', () => {
    assert.equal(SourceText.replace('x x x', 'x', '$&'), '$& $& $&');
    assert.equal(SourceText.replace('x x x', 'x', '$1', 1), '$1 x x');
    assert.equal(SourceText.replaceOnce('left marker right', 'marker', '$`'), 'left $` right');
    assert.throws(() => SourceText.replaceOnce('missing', 'marker', ''), /pattern changed/);
    assert.throws(() => SourceText.replaceOnce('twice twice', 'twice', ''), /pattern changed/);
    assert.throws(() => SourceText.function('void f() {', 'void f()'), /Unterminated/);
    assert.throws(() => SourceText.index('text', 'missing'), /not found/);
    assert.equal(SourceText.function('prefix switch(value) { if (x) { run(); } } suffix', 'switch(value)'),
        'switch(value) { if (x) { run(); } }');
});

test('configuration extraction retains commas inside nested expressions and quoted strings', () => {
    const source = 'ELEM_(int, count, "count", "label, with comma", min(2, max(3, 4)))\n' +
        'ELEM_(std::string, message, "message", "escaped \\"quote\\"", "a,b")';
    const elements = SourceText.elements(source);
    assert.equal(elements.length, 2);
    assert.equal(elements[0][4], 'min(2, max(3, 4))');
    assert.equal(elements[1][4], '"a,b"');
});

test('compiler setup keeps paths with spaces in separate arguments and leaves the process environment unchanged', async (t) => {
    const root = await temporary(t);
    const originalRoot = EngineToolchain.root;
    EngineToolchain.root = root;
    t.after(() => { EngineToolchain.root = originalRoot; });
    const sdk = join(root, 'SDK with spaces');
    const driver = join(sdk, 'upstream/emscripten/em++.py');
    SourceText.write(driver, '# compiler driver fixture\n');
    const previousCache = process.env.EM_CACHE;
    const compiler = EngineToolchain.compiler({ emsdk: sdk, python: process.execPath });
    assert.equal(compiler.command, resolve(process.execPath));
    assert.deepEqual(compiler.args, [driver]);
    assert.equal(compiler.env.EM_CACHE, join(root, 'build/emcache'));
    assert.equal(process.env.EM_CACHE, previousCache);
    const config = await readFile(compiler.env.EM_CONFIG, 'utf8');
    assert.ok(config.includes(JSON.stringify(join(sdk, 'upstream/bin'))));
    assert.ok(config.includes(JSON.stringify(process.execPath)));
    assert.throws(() => EngineToolchain.compiler({ emsdk: sdk, python: join(root, 'missing-python') }), /not found/);
});

test('native compile scheduling preserves link order and drains workers before reporting failure', async () => {
    let active = 0, peak = 0, finished = 0;
    const values = Array.from({ length: 9 }, (_, index) => index);
    const operation = async (value) => {
        peak = Math.max(peak, ++active);
        await new Promise((done) => setTimeout(done, 9 - value));
        active--;
        finished++;
        return value * 2;
    };
    assert.deepEqual(await EngineToolchain.parallel(values, operation), values.map((value) => value * 2));
    assert.equal(peak, 4);
    assert.equal(active, 0);
    await assert.rejects(EngineToolchain.parallel(values, async (value) => {
        await operation(value);
        if (value === 1) throw Error('compile failed');
    }), /compile failed/);
    assert.equal(active, 0);
    assert.equal(finished, values.length * 2);
});

test('an explicit compiler interpreter overrides an activated non-batch em++ launcher', async (t) => {
    const root = await temporary(t);
    const launcher = join(root, 'em++');
    const driver = join(root, 'em++.py');
    SourceText.write(launcher, '#!/usr/bin/env python3\n');
    SourceText.write(driver, '# compiler driver fixture\n');
    await chmod(launcher, 0o755);
    const previousPath = process.env.PATH;
    process.env.PATH = root;
    try {
        assert.equal(EngineToolchain.compiler().command, launcher);
        const compiler = EngineToolchain.compiler({ python: process.execPath });
        assert.equal(compiler.command, resolve(process.execPath));
        assert.deepEqual(compiler.args, [driver]);
        assert.throws(() => EngineToolchain.compiler({ python: join(root, 'missing-python') }), /not found/);
    } finally {
        if (previousPath === undefined) delete process.env.PATH;
        else process.env.PATH = previousPath;
    }
});

test('pinned source verification rejects modified files and paths outside the engine', async (t) => {
    const root = await temporary(t);
    const engine = join(root, 'engine');
    SourceText.write(join(engine, 'source.c'), 'original');
    const record = { path: 'source.c', sha256: EngineToolchain.digest('original') };
    SourceText.write(join(engine, 'SOURCE.json'), JSON.stringify({ files: [record] }));
    AdditionalBuilder.verifySources(engine);
    await writeFile(join(engine, 'source.c'), 'changed');
    assert.throws(() => AdditionalBuilder.verifySources(engine), /Upstream source changed/);
    await writeFile(join(root, 'outside.c'), 'original');
    SourceText.write(join(engine, 'SOURCE.json'), JSON.stringify({ files: [{ ...record, path: '../outside.c' }] }));
    assert.throws(() => AdditionalBuilder.verifySources(engine), /Unsafe source record/);
    SourceText.write(join(engine, 'SOURCE.json'), JSON.stringify({ files: [{ ...record, path: join(root, 'outside.c') }] }));
    assert.throws(() => AdditionalBuilder.verifySources(engine), /Unsafe source record/);
});
