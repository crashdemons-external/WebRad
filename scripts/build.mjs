import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parse } from 'acorn';
import { AssetMinifier } from './minify.mjs';
import { SourceInspector } from './check-source.mjs';
import {
    ROOT,
    ENGINES,
    exists,
    filesUnder,
    readText,
    writeText,
    confinedPath,
    inside,
    run,
    isMain,
    fail
} from './tooling.mjs';

/** Builds the static app from its browser modules and compiled engines. */
export class ApplicationBuilder {
    /** Application files copied into the deployment. */
    static APP_FILES = [
        'app.js',
        'application.js',
        'application-view.js',
        'application-state.js',
        'application.css',
        'audio.js',
        'audio-player.js',
        'bridge.js',
        'catalog.js',
        'dom.js',
        'engine-host.js',
        'additional-formats.js',
        'additional-engines.js',
        'engine-worker.js',
        'icons.js',
        'mic-worklet.js',
        'pictures.js',
        'presets.js',
        'recovery.js',
        'settings.js',
        'spectrogram.js',
        'styles.css',
        'theme.js',
        'icon.svg'
    ];
    /** Runtime modules used by the app's workers and audio code. */
    static RUNTIME_FILES = [
        'multimode/configuration.js',
        'multimode/decoder-session.js',
        'multimode/resampler.js',
        'multimode/transmit-audio.js'
    ];
    /**
     * List the files needed by the deployed app.
     * @param {string} root Project source directory.
     * @returns {Promise<Object[]>} Source and deployment paths relative to their roots.
     */
    static async assetFiles(root = ROOT) {
        const files = ApplicationBuilder.APP_FILES.map((name) => ({
            source: `src/app/${name}`,
            target: `app/${name}`
        }));
        files.push(
            ...ApplicationBuilder.RUNTIME_FILES.map((name) => ({
                source: `src/runtime/engines/${name}`,
                target: `runtime/engines/${name}`
            }))
        );
        for (const engine of ENGINES)
            for (const extension of ['js', 'wasm'])
                files.push({
                    source: `build/wasm/${engine.name}.${extension}`,
                    target: `wasm/${engine.name}.${extension}`
                });
        for (const name of await filesUnder(join(root, 'licenses')))
            files.push({ source: `licenses/${name}`, target: `licenses/${name}` });
        return files;
    }
    /**
     * Get the expected deployment paths.
     * @param {string} root Project source directory.
     * @returns {Promise<string[]>} Sorted expected output paths.
     */
    static async expectedFiles(root = ROOT) {
        return [
            ...(await ApplicationBuilder.assetFiles(root)).map((file) => file.target),
            'index.html',
            'licenses.html',
            'formats.json',
            'runtime/engines/analog-sstv/resampler.js'
        ].sort();
    }
    /**
     * Find missing engine loaders and WASM files.
     * @param {string} root Project source directory.
     * @returns {Promise<string[]>} Relative missing loader/WASM names.
     */
    static async missingCores(root = ROOT) {
        const missing = [];
        for (const { name } of ENGINES)
            for (const extension of ['js', 'wasm']) {
                const path = `build/wasm/${name}.${extension}`;
                if (!(await exists(join(root, path)))) missing.push(path);
            }
        return missing;
    }
    /**
     * Check the inputs and replace build/out with the app files.
     * @param {string} root Project source directory.
     * @returns {Promise<string>} Absolute deployment directory, ready for catalog generation.
     */
    static async assemble(root = ROOT) {
        const files = await ApplicationBuilder.checkedInputs(root);
        const version = await ApplicationBuilder.buildVersion(root);
        const output = await ApplicationBuilder.replaceOutputDirectory(root);
        await ApplicationBuilder.copyBrowserAssets(root, output, files);
        await ApplicationBuilder.wrapNativeLoaders(output);
        await ApplicationBuilder.buildSstvResampler(root, output);
        await ApplicationBuilder.versionBrowserAssets(output, version);
        return output;
    }
    /** Read the cache version before replacing the previous build. */
    static async buildVersion(root = ROOT) {
        const { version } = JSON.parse(await readText(join(root, 'build.config.json')));
        if (typeof version !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/i.test(version))
            throw Error('build.config.json version must be a nonempty string using letters, digits, dots, underscores or hyphens.');
        return version;
    }
    /** Add the build version to a local asset, preserving other query values and fragments. */
    static versionedReference(reference, version) {
        if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(reference) ||
            !/\.(?:js|css|svg|json|wasm)(?:[?#]|$)/i.test(reference)) return reference;
        const url = new URL(reference, 'https://webrad.invalid/');
        url.searchParams.set('v', version);
        return reference.split(/[?#]/)[0] + url.search + url.hash;
    }
    /** Version module imports and literal asset URLs without changing unrelated strings. */
    static versionJavascript(source, version) {
        const replacements = [];
        SourceInspector.walk(parse(source, { ecmaVersion: 'latest', sourceType: 'module' }), (node) => {
            let reference;
            if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(node.type))
                reference = node.source;
            if (node.type === 'NewExpression' && node.callee?.name === 'URL') reference = node.arguments[0];
            if (reference?.type !== 'Literal' || typeof reference.value !== 'string') return;
            const value = ApplicationBuilder.versionedReference(reference.value, version);
            if (value !== reference.value) replacements.push({ start: reference.start, end: reference.end, value });
        });
        for (const { start, end, value } of replacements.sort((a, b) => b.start - a.start))
            source = source.slice(0, start) + JSON.stringify(value) + source.slice(end);
        return source;
    }
    /** Version the app's asset graph while leaving native loader sources intact. */
    static async versionBrowserAssets(output, version) {
        for (const name of await filesUnder(output)) {
            const path = join(output, name);
            if (name.endsWith('.js') && (name.startsWith('app/') || name.startsWith('runtime/'))) {
                await writeText(path, ApplicationBuilder.versionJavascript(await readText(path), version));
            } else if (name === 'index.html' || name === 'licenses.html') {
                const html = (await readText(path)).replace(/(href|src)="([^"<>]+)"/g,
                    (match, attribute, reference) => `${attribute}="${ApplicationBuilder.versionedReference(reference, version)}"`);
                await writeText(path, html);
            }
        }
    }
    /** Validate all inputs before changing the deployment directory. */
    static async checkedInputs(root) {
        const missing = await ApplicationBuilder.missingCores(root);
        if (missing.length)
            throw Error(
                `Missing compiled cores:\n${missing.join('\n')}\nRun npm run build:engines -- --missing --emsdk PATH, then npm run build.`
            );
        const files = await ApplicationBuilder.assetFiles(root);
        for (const file of [
            ...files,
            ...['index.html', 'licenses.html'].map((name) => ({ source: `src/app/${name}` })),
            { source: 'src/runtime/engines/analog-sstv/audio.js' }
        ])
            await confinedPath(root, join(root, file.source));
        await SourceInspector.project(root);
        return files;
    }
    /** Recreate build/out only after checking that its path stays inside build. */
    static async replaceOutputDirectory(root) {
        const output = resolve(root, 'build/out');
        if (!inside(resolve(root, 'build'), output) || output === resolve(root, 'build'))
            throw Error('Unsafe output path');
        await mkdir(join(root, 'build'), { recursive: true });
        await confinedPath(root, join(root, 'build'));
        try {
            await confinedPath(root, output);
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        await rm(output, { recursive: true, force: true });
        await mkdir(output, { recursive: true });
        return output;
    }
    /** Copy the declared assets and adjust the entry page's application paths. */
    static async copyBrowserAssets(root, output, files) {
        for (const { source, target } of files) {
            await mkdir(dirname(join(output, target)), { recursive: true });
            await cp(join(root, source), join(output, target));
        }
        const html = (await readText(join(root, 'src/app/index.html'))).replace(
            /(href|src)="(icon\.svg|styles\.css|application\.css|app\.js|theme\.js)"/g,
            '$1="app/$2"'
        );
        await writeText(join(output, 'index.html'), html);
        await writeText(join(output, 'licenses.html'), await readText(join(root, 'src/app/licenses.html')));
    }
    /** Add module exports to engines built with global loader factories. */
    static async wrapNativeLoaders(output) {
        for (const { name, factory } of ENGINES) {
            if (!factory) continue;
            const loader = join(output, 'wasm', `${name}.js`);
            const shim =
                "const require = globalThis.process?.versions?.node ? (await import('node:module')).createRequire(import.meta.url) : undefined;\nconst __dirname = new URL('.', import.meta.url).pathname;\n";
            await writeText(loader, shim + (await readText(loader)) + `\nexport default ${factory};\n`);
        }
    }
    /** Export the streaming SSTV resampler used by the application. */
    static async buildSstvResampler(root, output) {
        const audio = await readText(join(root, 'src/runtime/engines/analog-sstv/audio.js'));
        let resampler;
        SourceInspector.walk(parse(audio, { ecmaVersion: 'latest' }), (node) => {
            if (node.type === 'ClassDeclaration' && node.id?.name === 'Resampler')
                resampler = audio.slice(node.start, node.end);
        });
        if (!resampler) throw Error('SSTV audio source has no streaming Resampler class');
        await mkdir(join(output, 'runtime/engines/analog-sstv'), { recursive: true });
        await writeText(join(output, 'runtime/engines/analog-sstv/resampler.js'), 'export ' + resampler + '\n');
    }
    /**
     * Build the app files and format catalog, then minify JavaScript and CSS.
     * @param {string} root Project source directory.
     */
    static async build(root = ROOT) {
        const output = await ApplicationBuilder.assemble(root);
        await run(process.execPath, [join(ROOT, 'scripts/catalog.mjs'), '--output', output], root);
        const compact = await AssetMinifier.directory(output);
        console.log(`Built ${output}/index.html and ${(await filesUnder(output)).length} required local assets.`);
        console.log(
            `Minified ${compact.count} JS/CSS assets: ${compact.before.toLocaleString()} → ${compact.after.toLocaleString()} bytes.`
        );
    }
}
if (isMain(import.meta.url)) {
    try {
        const { values } = parseArgs({ options: { help: { type: 'boolean' } } });
        if (values.help)
            console.log(
                'Build the browser app into build/out using compiled build/wasm cores.\nUsage: npm run build\nCompile WASM separately with npm run build:engines -- --emsdk PATH.'
            );
        else await ApplicationBuilder.build();
    } catch (error) {
        fail(error);
    }
}
export const missingCores = ApplicationBuilder.missingCores.bind(ApplicationBuilder);
export const build = ApplicationBuilder.build.bind(ApplicationBuilder);
