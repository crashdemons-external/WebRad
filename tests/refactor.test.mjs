import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createContext, runInContext } from 'node:vm';
import { parse } from 'acorn';
import { transform } from 'esbuild';
import { WebRadApplication } from '../src/app/application.js';
import { icon } from '../src/app/icons.js';
import { esc } from '../src/app/dom.js';
import { groupsFor } from '../src/app/settings.js';
import { Bridge } from '../src/app/bridge.js';
import { AssetMinifier } from '../scripts/minify.mjs';
import { SourceInspector } from '../scripts/check-source.mjs';
import { ROOT, filesUnder } from '../scripts/tooling.mjs';
import { join } from 'node:path';

test('encode/decode workflow and Advanced controls match reviewed reference cases with compatibility corrections', async (t) => {
    const previous = globalThis.location;
    globalThis.location = { search: '' };
    t.after(() => {
        if (previous === undefined) delete globalThis.location;
        else globalThis.location = previous;
    });
    const baseline = JSON.parse(await readFile(new URL('./fixtures/ui-before-classes.json', import.meta.url)));
    const formats = JSON.parse(await readFile(new URL('../build/out/formats.json', import.meta.url))).formats;
    const application = new WebRadApplication();
    // Keep this historical comparison limited to the original engines and controls.
    application.state.formats = formats.filter((format) => !['terminal', 'spectrum', 'dispatch', 'apt', 'beacon', 'aircraft'].includes(format.engine) && !format.aprs);
    for (const scenario of baseline.cases) {
        Object.assign(application.state, {
            formatId: scenario.id,
            direction: scenario.direction,
            content: scenario.content,
            settings: {}
        });
        const view = application.view,
            names = [
                'header',
                'intro',
                ...(scenario.direction === 'encode' ? ['encodeSetup', 'encodeMain'] : ['decodeSetup', 'decodeMain'])
            ];
        // Retain historical intro copy so the baseline still checks the surrounding workflow.
        const historicalEncodeHeadings = {
            text: 'Create audio from text',
            picture: 'Turn a picture into audio',
            file: 'Turn a file into a signal',
            voice: 'Encode a speech recording'
        };
        const historicalDecodeHeadings = {
            text: 'Recover messages from audio',
            picture: 'Recover pictures from audio',
            file: 'Recover files from audio',
            voice: 'Recover speech from a recording',
            sensor: 'Read sensor and weather-station packets'
        };
        let historicalHeading, historicalDescription;
        if (scenario.direction === 'encode') {
            assert.match(view.intro(), /<h1>Create audio from your data<\/h1>/);
            assert.match(view.intro(), /<p>Turn text, pictures, files, and speech into audio you can play and share\.<\/p>/);
            historicalHeading = historicalEncodeHeadings[scenario.content];
            historicalDescription = 'Choose your content and a compatible format, then create a file you can save.';
        } else {
            assert.match(view.intro(), /<h1>Recover data from a recording<\/h1>/);
            assert.match(view.intro(), /<p>Use a recording or your mic to recover text, images, or files\.<\/p>/);
            historicalHeading = historicalDecodeHeadings[scenario.content];
            historicalDescription = scenario.content === 'sensor'
                ? 'Open a raw radio recording or pulse data.'
                : 'Open a recording or use an audio input. Files decode as quickly as your device allows.';
        }
        const intro = `<section class="intro"><h1>${historicalHeading}</h1><p>${historicalDescription}</p></section>`;
        const workflowMarkup = names.map((name) => name === 'intro' ? intro : view[name]()).join('');
        const actionIcon = icon(scenario.direction);
        assert.ok(workflowMarkup.includes(actionIcon), `${scenario.direction} action uses its conversion icon`);
        // Dedicated view tests cover additions to the historical workflow baseline.
        const historicalSignal = `<details class="card signal-card"><summary>${icon('down')}Signal view & diagnostics</summary><p class="hint">Audio frequencies, rather than radio frequencies. Click the spectrum to tune supported text modems.</p><canvas id="spectrum" class="signal-spectrum" aria-label="Received signal spectrum"></canvas><div class="frequency-axis"><span>0</span><span>1000</span><span>2000</span><span>3000</span><span>4000 Hz</span></div><canvas id="sync-view" aria-label="Picture synchronization" hidden></canvas><pre id="diagnostics" class="diagnostics"></pre></details>`;
        // Family selector tests cover the new labels and order; retain the original controls for this historical comparison.
        const historicalGroups = application.selectedGroups().sort((left, right) =>
            application.state.formats.indexOf(left.formats[0]) - application.state.formats.indexOf(right.formats[0])
        );
        const currentFormat = application.current();
        const currentGroup = historicalGroups.find((group) => group.id === view.groupId(currentFormat));
        const historicalFormatControls = `${view.selectHtml(
            'format-family',
            'Signal family',
            historicalGroups.map((group) => [group.id, `${group.title} · ${group.family}`]),
            view.groupId(currentFormat)
        )}<div class="format-variant-label"><label class="field-label" for="format-variant">Format / variant</label><button class="format-info" type="button" data-action="formats" aria-label="Explore ${esc(currentFormat.name)} details" title="Explore this format and variant" ${view.disabled()}>${icon('info')}</button></div><div class="select-wrap"><select id="format-variant" ${view.disabled()}>${view.optionsHtml(
            currentGroup.formats.map((format) => [format.id, view.formatOptionName(format)]),
            currentFormat.id
        )}</select>${icon('down')}</div>`;
        const markup = workflowMarkup.replace(actionIcon, icon('play'))
            .replace(/<button type="button" class="theme-toggle"[^>]*>[\s\S]*?<\/button>/, '')
            .replace(view.formatControls(), historicalFormatControls + '<p class="hint" id="preset-status" hidden>Preset adjusted: your current controls override the listed starting settings. Reset in Advanced restores this preset.</p>')
            .replace(view.signalDiagnostics(), historicalSignal);
        const fields = groupsFor(application.current(), 'decode')
            .flatMap((group) => group.fields)
            .filter((field) => field.key !== 'aprsInterpret')
            .map((field) => {
                const settings = application.settings();
                // Mode-default tests cover the corrected widths; keep the old
                // bandwidth value here to compare the surrounding UI baseline.
                if (field.key === 'hellBandwidth')
                    return view.fieldHtml({ ...field, value: 245, help: '' }, { ...settings, hellBandwidth: 245 });
                return view.fieldHtml(field, settings);
            })
            .join('');
        const actual = createHash('sha256')
            .update(markup + fields)
            .digest('hex');
        assert.equal(actual, scenario.html, `${scenario.id}: ${scenario.direction} ${scenario.content}`);
    }
});

test('build minification preserves ESM exports, names, numeric behavior and license notices', async () => {
    const source = `/*! Required license notice */
  /* This ordinary documentation is intentionally removed from deployed output.
     Source documentation remains readable in the original module and is not
     served as part of production JavaScript. */
  export class Signal {
    constructor(value) { this.value = value; }
    calculate(amount) { return this.value * amount + (-0); }
  }
  export const literal = '</script>  🚀';
  export const name = Signal.name;
  `;
    const compact = await AssetMinifier.compact(source, 'js', 'signal.js');
    assert.ok(compact.length < source.length);
    assert.match(compact, /Required license notice/);
    const original = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
    const minified = await import('data:text/javascript;base64,' + Buffer.from(compact).toString('base64'));
    assert.deepEqual(Object.keys(minified), Object.keys(original));
    assert.equal(minified.name, original.name);
    assert.equal(minified.literal, original.literal);
    for (const value of [-0, Infinity, -Infinity, NaN, 0.1, 42])
        assert.ok(Object.is(new minified.Signal(value).calculate(3), new original.Signal(value).calculate(3)));
    const css = '/* ordinary comment */\n.sample { width: calc(100% - 24px); --label: "a b"; color: #098596; }';
    const shortCss = await AssetMinifier.compact(css, 'css', 'style.css');
    assert.ok(shortCss.length < css.length);
    assert.match(shortCss, /calc\(100% - 24px\)/);
    assert.match(shortCss, /"a b"/);
});

test('every deployed JS/CSS asset is compact and source class members remain documented', async () => {
    const coverage = await SourceInspector.project();
    assert.ok(coverage.classes >= 26 && coverage.methods >= 180 && coverage.properties >= 130);
    assert.throws(() => SourceInspector.module('class Undocumented { method() {} }', 'bad.js'), /lacks JSDoc/);
    assert.throws(
        () =>
            SourceInspector.module(
                '/** A class. */ class MissingProperty { /** Constructor. */ constructor(){this.secret=1;} }',
                'bad.js'
            ),
        /lacks property documentation/
    );
    for (const name of await filesUnder(join(ROOT, 'build/out'))) {
        if (!/\.(js|css)$/.test(name)) continue;
        const source = await readFile(join(ROOT, 'build/out', name), 'utf8');
        const { code: compact } = await transform(source, {
            loader: name.endsWith('.css') ? 'css' : 'js',
            target: 'esnext',
            charset: 'utf8',
            minifyWhitespace: true,
            minifySyntax: false,
            treeShaking: false,
            legalComments: 'inline'
        });
        assert.equal(source, compact, `${name} was not built with the configured minifier`);
    }
});

test('microphone worklet preserves channels, batches full PCM and flushes partial capture once', async () => {
    const source = await readFile(new URL('../src/app/mic-worklet.js', import.meta.url), 'utf8');
    let Processor;
    const context = createContext({
        AudioWorkletProcessor: class {
            constructor() {
                this.messages = [];
                this.port = { postMessage: (message) => this.messages.push(message) };
            }
        },
        registerProcessor: (name, value) => {
            assert.equal(name, 'webrad-input');
            Processor = value;
        }
    });
    runInContext(source, context);
    for (const channel of ['left', 'right', 'mix']) {
        const processor = new Processor();
        processor.port.onmessage({ data: { channel } });
        const left = Float32Array.from({ length: 128 }, (_, i) => i / 128),
            right = Float32Array.from(left, (value) => -value / 2);
        for (let block = 0; block < 16; block++) {
            const output = new Float32Array(128).fill(1);
            assert.equal(processor.process([[left, right]], [[output]]), true);
            assert.ok(output.every((value) => value === 0));
        }
        assert.equal(processor.messages.length, 1);
        assert.equal(processor.messages[0].samples.length, 2048);
        const expected =
            channel === 'left'
                ? left
                : channel === 'right'
                  ? right
                  : Float32Array.from(left, (value, i) => (value + right[i]) / 2);
        assert.deepEqual([...processor.messages[0].samples.slice(0, 128)], [...expected]);
        const partial = Float32Array.from([0.25, 0.5, 0.75]);
        processor.process([[partial, Float32Array.from([-1, -1, -1])]], []);
        processor.port.onmessage({ data: { type: 'flush' } });
        assert.equal(processor.messages.length, 3);
        assert.equal(processor.messages[1].type, undefined);
        assert.deepEqual([...processor.messages[1].samples], [...expectedChannel(channel, partial)]);
        assert.equal(processor.messages[2].type, 'flushed');
        processor.port.onmessage({ data: { type: 'flush' } });
        assert.equal(processor.messages[3].type, 'flushed');
        assert.equal(processor.messages.length, 4, 'an empty repeated flush only acknowledges');
        assert.equal(processor.process([], []), true);
    }
});

function expectedChannel(channel, left) {
    return channel === 'right'
        ? Float32Array.from(left, () => -1)
        : channel === 'mix'
          ? Float32Array.from(left, (value) => (value - 1) / 2)
          : left;
}

test('engine worker keeps RPC order, deduplicates transfer buffers and continues after an error', async () => {
    const source = await readFile(new URL('../src/app/engine-worker.js', import.meta.url), 'utf8');
    const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }),
        removals = ast.body.filter((node) => ['ImportDeclaration', 'ExportNamedDeclaration'].includes(node.type));
    let script = source;
    for (const node of removals.reverse()) {
        const replacement =
            node.type === 'ExportNamedDeclaration' && node.declaration
                ? source.slice(node.declaration.start, node.declaration.end)
                : '';
        script = script.slice(0, node.start) + replacement + script.slice(node.end);
    }
    const order = [],
        responses = [],
        buffer = new Uint8Array([1, 2, 3]);
    let finished;
    const done = new Promise((resolve) => (finished = resolve));
    const FakeHost = {
        create: async () => ({
            async process() {
                order.push('process');
                await Promise.resolve();
                return { bytes: buffer, nested: { same: buffer } };
            },
            fail() {
                order.push('fail');
                throw Error('expected');
            },
            next() {
                order.push('next');
                return { text: 'ok' };
            }
        })
    };
    const context = createContext({
        self: {},
        postMessage: (result, transfers) => {
            responses.push({ result, transfers });
            if (result.id === 4) finished();
        }
    });
    for (const node of ast.body.filter((node) => node.type === 'ImportDeclaration'))
        for (const specifier of node.specifiers) context[specifier.local.name] = FakeHost;
    runInContext(script, context);
    for (const [id, action] of [
        [1, 'init'],
        [2, 'process'],
        [3, 'fail'],
        [4, 'next']
    ])
        context.self.onmessage({ data: { id, action, args: { engine: 'fake' } } });
    await done;
    assert.deepEqual(order, ['process', 'fail', 'next']);
    assert.deepEqual(
        responses.map((response) => response.result.id),
        [1, 2, 3, 4]
    );
    assert.equal(responses[1].transfers.length, 1);
    assert.equal(responses[1].transfers[0], buffer.buffer);
    assert.equal(responses[2].result.error, 'expected');
    assert.equal(responses[3].result.result.text, 'ok');
});

test('worker bridge preserves request IDs, transfer lists and cancellation rejection', async (t) => {
    const previous = globalThis.Worker;
    const workers = [];
    globalThis.Worker = class {
        constructor(url, options) {
            this.url = url;
            this.options = options;
            this.messages = [];
            workers.push(this);
        }
        postMessage(message, transfers) {
            this.messages.push({ message, transfers });
        }
        terminate() {
            this.terminated = true;
        }
    };
    t.after(() => {
        if (previous === undefined) delete globalThis.Worker;
        else globalThis.Worker = previous;
    });
    const bridge = new Bridge('sstv'),
        worker = workers[0];
    assert.equal(worker.options.type, 'module');
    assert.ok(worker.url.href.endsWith('/engine-worker.js'));
    assert.equal(worker.messages[0].message.id, 1);
    worker.onmessage({ data: { id: 1, result: { ready: true } } });
    await bridge.ready;
    const bytes = new Uint8Array([1, 2]),
        pending = bridge.call('process', { bytes }, [bytes.buffer]);
    assert.equal(worker.messages[1].message.id, 2);
    assert.equal(worker.messages[1].transfers[0], bytes.buffer);
    worker.onmessage({ data: { id: 2, result: { text: 'ready' } } });
    assert.deepEqual(await pending, { text: 'ready' });
    const canceled = bridge.call('finish');
    bridge.close();
    await assert.rejects(canceled, /Operation canceled/);
    await assert.rejects(bridge.call('process'), /Operation canceled/);
    assert.equal(worker.terminated, true);
});
