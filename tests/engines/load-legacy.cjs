'use strict';
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function loadLegacy(filename) {
    const loadedModule = new Module(filename, module.parent);
    loadedModule.filename = filename;
    loadedModule.paths = Module._nodeModulePaths(path.dirname(filename));
    loadedModule._compile(fs.readFileSync(filename, 'utf8'), filename);
    return loadedModule.exports;
}

function loadCore(unit) {
    const filename = path.resolve(__dirname, '../../build/wasm', `${unit}.js`);
    const source = fs.readFileSync(filename, 'utf8');
    if (/^\s*export\s+default\s/m.test(source)) {
        return (...args) => import(pathToFileURL(filename).href).then((module) => (module.default || module)(...args));
    }
    return loadLegacy(filename);
}

function loadRuntime(unit, filename) {
    return loadLegacy(path.resolve(__dirname, '../../src/runtime/engines', unit, filename));
}

module.exports = { loadCore, loadRuntime };
