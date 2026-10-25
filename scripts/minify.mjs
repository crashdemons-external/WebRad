import { readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { transform } from 'esbuild';
import { filesUnder } from './tooling.mjs';

/** Minifies JavaScript and CSS while preserving names, syntax and license notices. */
export class AssetMinifier {
    /**
     * Minify an asset. Module exports and worker messages must keep their names.
     * @param {string} source Original asset text.
     * @param {'js'|'css'} loader Asset language understood by esbuild.
     * @param {string} sourcefile Relative name used in compiler diagnostics.
     * @returns {Promise<string>} Compact asset text with legal notices retained.
     */
    static async compact(source, loader, sourcefile) {
        const result = await transform(source, {
            loader,
            sourcefile,
            target: 'esnext',
            charset: 'utf8',
            minifyWhitespace: true,
            minifyIdentifiers: true,
            minifySyntax: false,
            keepNames: true,
            treeShaking: false,
            ignoreAnnotations: true,
            legalComments: 'inline'
        });
        return result.code;
    }

    /**
     * Minify the JavaScript and CSS files in a directory.
     * @param {string} root Absolute public output directory.
     * @returns {Promise<{count:number,before:number,after:number}>} Asset count and byte totals.
     */
    static async directory(root) {
        let count = 0,
            before = 0,
            after = 0;
        for (const name of await filesUnder(root)) {
            const extension = extname(name);
            if (!['.js', '.css'].includes(extension)) continue;
            const path = join(root, name),
                source = await readFile(path, 'utf8');
            const compact = await AssetMinifier.compact(source, extension.slice(1), name);
            await writeFile(path, compact);
            count++;
            before += Buffer.byteLength(source);
            after += Buffer.byteLength(compact);
        }
        return { count, before, after };
    }
}
