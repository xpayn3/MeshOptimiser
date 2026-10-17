// The vendored Draco decoder for tests that run in Node (it is a plain script that expects to be required). Hands back a promise of
// the ready module: const draco = await require('./draco-node.cjs')();
const path = require('node:path');
const DracoDecoderModule = require(path.join(__dirname, '..', 'app', 'vendor', 'draco', 'draco_decoder.js'));
module.exports = () => new Promise((res) => { const m = DracoDecoderModule({ onModuleLoaded: res }); if (m && typeof m.then === 'function') m.then(res); });
