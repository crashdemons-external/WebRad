import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ROOT, ENGINES, exists, run, isMain, fail } from './tooling.mjs';

/** Selects the engines to compile with the Python build scripts. */
export class EngineBuilder {
    /**
     * Get compiler commands for the selected engines.
     * @param {Object} options Engine selection and compiler options.
     * @param {boolean} options.missing Skip engines whose loader and WASM files already exist.
     * @param {string} root Project directory.
     * @returns {Promise<Object[]>} Executables and their arguments.
     */
    static async engineCommands(
        { engine = 'all', missing = false, emsdk, python = process.env.PYTHON || 'python' } = {},
        root = ROOT
    ) {
        if (!['all', ...ENGINES.map((unit) => unit.name)].includes(engine)) throw Error(`Unknown engine: ${engine}`);
        const commands = [];
        for (const { name } of ENGINES) {
            if (engine !== 'all' && engine !== name) continue;
            const base = join(root, 'build/wasm', name);
            if (missing && (await exists(base + '.js')) && (await exists(base + '.wasm'))) continue;
            commands.push({
                command: python,
                args: [
                    '-B',
                    join(root, 'scripts/engines/build.py'),
                    '--engine',
                    name,
                    ...(emsdk ? ['--emsdk', resolve(emsdk)] : [])
                ]
            });
        }
        return commands;
    }
}
if (isMain(import.meta.url)) {
    try {
        const { values } = parseArgs({
            options: {
                engine: { type: 'string', default: 'all' },
                missing: { type: 'boolean' },
                emsdk: { type: 'string' },
                python: { type: 'string' },
                help: { type: 'boolean' }
            }
        });
        if (values.help)
            console.log(
                `Compile WASM using an existing Emscripten installation.\nUsage: npm run build:engines -- [--emsdk PATH] [--engine NAME] [--missing] [--python EXECUTABLE]\nEngines: all, ${ENGINES.map((unit) => unit.name).join(', ')}\nRun npm run build afterward to refresh build/out.`
            );
        else {
            const commands = await EngineBuilder.engineCommands(values);
            for (const { command, args } of commands) await run(command, args);
            console.log(
                commands.length
                    ? 'Engine compilation complete. Run npm run build to refresh build/out.'
                    : 'All selected compiled pairs already exist.'
            );
        }
    } catch (error) {
        fail(error);
    }
}
export const engineCommands = EngineBuilder.engineCommands.bind(EngineBuilder);
