import { parseArgs } from 'node:util';
import { ENGINES, isMain, fail } from '../tooling.mjs';
import { AdditionalBuilder } from './additional/build.mjs';
import { ModemBuilder } from './modems/build.mjs';
import { NativeBuilders } from './native-builders.mjs';

/** Selects the project-owned Node recipe for each native engine. */
export class NativeEngineBuilder {
    /** Prepare or compile the named engine, or every registered engine in catalog order. */
    static async build({ engine = 'all', ...options } = {}) {
        const names = ENGINES.map((unit) => unit.name);
        if (engine !== 'all' && !names.includes(engine)) throw Error(`Unknown engine: ${engine}`);
        for (const name of engine === 'all' ? names : [engine]) {
            if (name in AdditionalBuilder.units) await AdditionalBuilder.build(name, options);
            else if (ModemBuilder.units.includes(name)) await ModemBuilder.build(name, options);
            else await NativeBuilders.build(name, options);
        }
    }
}

if (isMain(import.meta.url)) {
    try {
        const { values } = parseArgs({ options: {
            engine: { type: 'string', default: 'all' }, emsdk: { type: 'string' }, python: { type: 'string' },
            debug: { type: 'boolean' }, 'prepare-only': { type: 'boolean' }, help: { type: 'boolean' }
        } });
        if (values.help) console.log('Compile native engines with an existing Emscripten SDK.\n' +
            'Usage: node scripts/engines/build.mjs [--engine NAME] [--emsdk PATH] [--prepare-only] [--debug] [--python EXECUTABLE]');
        else await NativeEngineBuilder.build({ ...values, prepareOnly: values['prepare-only'] });
    } catch (error) {
        fail(error);
    }
}
