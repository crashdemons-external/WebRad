import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { ROOT } from './tooling.mjs';

/** Builds the format catalog from engine capabilities and app presets. */
export class CatalogBuilder {
    /**
     * Read the engines' formats, expand their presets and write formats.json.
     * @param {string} output Directory containing the assembled browser application.
     */
    static async build(output = join(ROOT, 'build/out')) {
        const { formats, expandPresets } = await CatalogBuilder.readEngineFormats(output);
        CatalogBuilder.addAutomaticFormats(formats);
        const choices = expandPresets(formats);
        await writeFile(join(output, 'formats.json'), JSON.stringify({ schema: 1, formats: choices }, null, 2) + '\n');
        console.log(
            `Catalog: ${choices.length} formats and settings presets from ${formats.length} engine/automatic entries.`
        );
    }
    /** Read each engine's supported formats, including FreeDV packet capacities. */
    static async readEngineFormats(output) {
        const { loadCore, coreCatalog, EngineHost } = await import(pathToFileURL(join(output, 'app/engine-host.js')));
        const { defaultsFor } = await import(pathToFileURL(join(output, 'app/settings.js')));
        const { expandPresets } = await import(pathToFileURL(join(output, 'app/presets.js')));
        const formats = [];
        for (const engine of [
            'fldigi',
            'sstv',
            'fax',
            'drm',
            'packet',
            'weak',
            'sound',
            'signaling',
            'voice',
            'sensor',
            'beacon',
            'aircraft',
            'terminal',
            'spectrum',
            'dispatch',
            'apt'
        ]) {
            const core = await loadCore(engine),
                entries = coreCatalog(engine, core);
            if (engine === 'voice') {
                const host = new EngineHost(engine, core);
                for (const f of entries.filter((f) => f.data)) {
                    host.setupVoice(f, defaultsFor(f));
                    f.payloadBytes = host.frameBytes - 2;
                }
                if (host.voice) core._freedv_close(host.voice);
                core._free(host.block);
            }
            formats.push(...entries);
        }
        return { formats, expandPresets };
    }
    /** Add the automatic picture and sensor choices around the native formats. */
    static addAutomaticFormats(formats) {
        formats.unshift({
            id: 'pictures-auto',
            engine: 'pictures-auto',
            mode: -1,
            name: 'Automatic SSTV / weather fax',
            family: 'Pictures',
            inputs: [],
            outputs: ['picture'],
            decode: true
        });
        formats.push({
            id: 'sensor-auto',
            engine: 'sensor',
            mode: -1,
            name: 'Automatic enabled sensor protocols',
            family: 'Sensors',
            inputs: [],
            outputs: ['sensor'],
            decode: true
        });
    }
}

const { values } = parseArgs({ options: { output: { type: 'string' } } });
await CatalogBuilder.build(values.output ? resolve(values.output) : undefined);
