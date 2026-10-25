import { readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parse } from 'acorn';
import { ApplicationBuilder } from './build.mjs';
import { ROOT, checkedFile, filesUnder, inside, isMain, fail } from './tooling.mjs';

/** Checks deployment files and the assets they reference. */
export class BuildVerifier {
    /**
     * Find imports and asset URLs written as string literals.
     * @param {string} source JavaScript module text.
     * @returns {string[]} Local or external references to validate.
     */
    static javascriptReferences(source) {
        const references = [];
        const visit = (node) => {
            if (!node || typeof node !== 'object') return;
            if (
                ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) &&
                node.source
            )
                references.push(node.source.value);
            if (node.type === 'ImportExpression' && node.source.type === 'Literal') references.push(node.source.value);
            if (node.type === 'NewExpression' && node.callee?.name === 'URL' && node.arguments[0]?.type === 'Literal')
                references.push(node.arguments[0].value);
            for (const value of Object.values(node)) {
                if (Array.isArray(value)) value.forEach(visit);
                else if (value && typeof value === 'object') visit(value);
            }
        };
        visit(parse(source, { ecmaVersion: 'latest', sourceType: 'module' }));
        return references;
    }
    /**
     * Check that local references point to files inside the deployment.
     * @param {string} root Deployment directory.
     * @param {string} name Referencing asset relative to deployment root.
     * @param {string[]} references Literal paths used by the asset.
     */
    static async checkReferences(root, name, references) {
        for (const reference of references) {
            if (typeof reference !== 'string' || !reference || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(reference))
                continue;
            const path = reference.split(/[?#]/)[0];
            if (!path || path === '.' || path.endsWith('/')) continue;
            const target = path.startsWith('/') ? resolve(root, '.' + path) : resolve(root, dirname(name), path);
            if (!inside(root, target)) throw Error(`Unsafe path in ${name}: ${reference}`);
            try {
                await checkedFile(root, relative(root, target).replaceAll('\\', '/'));
            } catch (error) {
                throw Error(`Broken reference in ${name}: ${reference} (${error.message})`);
            }
        }
    }
    /**
     * Check for missing or extra files, invalid WASM and broken asset references.
     * @param {string} root Deployment directory to inspect.
     * @param {string} sourceRoot Project directory supplying the expected files.
     * @returns {Promise<number>} Number of validated deployment files.
     */
    static async verifyAssets(root = join(ROOT, 'build/out'), sourceRoot = ROOT) {
        const expected = new Set(await ApplicationBuilder.expectedFiles(sourceRoot));
        const actual = await filesUnder(root);
        for (const name of expected) await checkedFile(root, name);
        for (const name of actual) {
            if (!expected.has(name)) throw Error(`Unexpected deployed asset: ${name}`);
            const bytes = await readFile(join(root, name));
            if (name.endsWith('.wasm')) {
                if (!WebAssembly.validate(bytes)) throw Error(`Invalid WASM: ${name}`);
                if (!bytes.equals(await readFile(join(sourceRoot, 'build', name))))
                    throw Error(`Changed WASM: ${name}`);
            }
            if (name.endsWith('.js'))
                await BuildVerifier.checkReferences(
                    root,
                    name,
                    BuildVerifier.javascriptReferences(bytes.toString('utf8'))
                );
            // Original license documents can link to historical upstream downloads.
            if (name.endsWith('.html') && !name.startsWith('licenses/'))
                await BuildVerifier.checkReferences(
                    root,
                    name,
                    [...bytes.toString('utf8').matchAll(/(?:href|src)="([^"<>]+)"/g)].map((match) => match[1])
                );
            if (name.endsWith('.css'))
                await BuildVerifier.checkReferences(
                    root,
                    name,
                    [...bytes.toString('utf8').matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/g)].map((match) => match[1])
                );
        }
        const catalog = JSON.parse(await readFile(join(root, 'formats.json'), 'utf8'));
        if (catalog.schema !== 1 || !Array.isArray(catalog.formats) || !catalog.formats.length)
            throw Error('Missing format catalog');
        if (new Set(catalog.formats.map((format) => format.id)).size !== catalog.formats.length)
            throw Error('Duplicate format IDs');
        return actual.length;
    }
}
if (isMain(import.meta.url)) {
    try {
        const { values } = parseArgs({ options: { help: { type: 'boolean' } } });
        if (values.help)
            console.log(
                'Verify required deployed assets, local references, WASM and the format catalog.\nUsage: npm run verify'
            );
        else console.log(`Verified ${await BuildVerifier.verifyAssets()} required deployment assets.`);
    } catch (error) {
        fail(error);
    }
}
export const verifyAssets = BuildVerifier.verifyAssets.bind(BuildVerifier);
