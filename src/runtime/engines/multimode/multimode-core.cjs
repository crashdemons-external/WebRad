'use strict';
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const target = pathToFileURL(path.resolve(__dirname, '../../../../build/wasm/multimode.js')).href;
module.exports = (...args) => import(target).then((module) => (module.default || module)(...args));
