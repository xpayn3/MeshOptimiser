// node tests/e2e-texture-anisotropy.mjs
//
// Textures stay sharp at a slant. three loads a model's textures with anisotropy 1, so a surface seen at a grazing angle (a table top
// going away from the camera) is read from the small mip levels and blurs to a smear. _sharpTex gives every texture of a loaded model
// what the graphics card can do (at most 16). A small GLB is built here (one textured square, its colour, normal and roughness maps
// one 8x8 PNG), loaded through the file input, and the anisotropy of each of its maps is read back.
// Then the two switches of Settings › Performance › Picture quality: Sharp textures at an angle off (every map back to 1, sent to the
// card again) and on, and Finer shadows (the sun's shadow map 4096 px, 2048 again when off), each with no error.
// Needs the app on http://localhost:4242, Chrome, Node 22+. CAPTURE_GPU=1 uses the machine's own GPU (WebGPU) instead of SwiftShader.
import { spawn } from 'child_process';
import zlib from 'zlib';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9351, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-aniso-' + Date.now();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const GPU_FLAGS = process.env.CAPTURE_GPU === '1' ? ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, ...GPU_FLAGS, '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name, extra === undefined ? '' : JSON.stringify(extra)); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };

// An 8x8 RGBA checker as a PNG.
function png() {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), cr = Buffer.alloc(4); len.writeUInt32BE(data.length); cr.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, cr]); };
  const N = 8, raw = Buffer.alloc(N * (N * 4 + 1));
  for (let y = 0; y < N; y++) { raw[y * (N * 4 + 1)] = 0; for (let x = 0; x < N; x++) { const v = (x + y) & 1 ? 230 : 40, o = y * (N * 4 + 1) + 1 + x * 4; raw[o] = v; raw[o + 1] = v; raw[o + 2] = v; raw[o + 3] = 255; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// One square with UVs and a material whose colour, normal and roughness maps are that PNG.
function glb() {
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), uv = new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]), idx = new Uint16Array([0, 1, 2, 0, 2, 3]);
  const img = png(), pad = (b) => Buffer.concat([b, Buffer.alloc((4 - b.length % 4) % 4)]);
  const parts = [Buffer.from(pos.buffer), Buffer.from(uv.buffer), pad(Buffer.from(idx.buffer)), pad(img)];
  const views = []; let off = 0;
  for (const p of parts) { views.push({ buffer: 0, byteOffset: off, byteLength: p.length }); off += p.length; }
  views[2].byteLength = idx.byteLength; views[3].byteLength = img.length;
  const bin = Buffer.concat(parts);
  const json = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'Table top' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicRoughnessTexture: { index: 0 } }, normalTexture: { index: 0 } }],
    textures: [{ source: 0, sampler: 0 }], samplers: [{ magFilter: 9729, minFilter: 9987 }], images: [{ bufferView: 3, mimeType: 'image/png' }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5126, count: 4, type: 'VEC2' },
      { bufferView: 2, componentType: 5123, count: 6, type: 'SCALAR' },
    ],
    bufferViews: views, buffers: [{ byteLength: bin.length }],
  };
  const j = Buffer.from(JSON.stringify(json)), jp = Buffer.concat([j, Buffer.alloc((4 - j.length % 4) % 4, 0x20)]);
  const head = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
  head.write('glTF', 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + jp.length + 8 + bin.length, 8);
  jh.writeUInt32LE(jp.length, 0); jh.write('JSON', 4); bh.writeUInt32LE(bin.length, 0); bh.write('BIN\0', 4);
  return Buffer.concat([head, jh, jp, bh, bin]);
}

try {
  let target;
  for (let i = 0; i < 60 && !target; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); target = l.find(t => t.type === 'page'); } catch (_) {} if (!target) await sleep(250); }
  if (!target) throw new Error('Chrome did not start');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
    else if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text || '').split('\n').slice(0, 3).join(' | '));
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await evalJS("document.getElementById('welcome-close')?.click()");
  const b64 = glb().toString('base64');
  await evalJS(`(async () => { const bin = atob(${JSON.stringify(b64)}); const u = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) u[k] = bin.charCodeAt(k); const f = new File([u], 'textured-square.glb'); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  let maps = [];
  for (let i = 0; i < 80; i++) {
    maps = await evalJS(`(() => { const out = []; window._appFns.camera.parent.traverse(o => { if (!o.isMesh) return; for (const m of [].concat(o.material || [])) for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) if (m && m[k] && m[k].isTexture) out.push([k, m[k].anisotropy]); }); return out; })()`);
    if (maps.length >= 4) break; await sleep(500);
  }
  const want = await evalJS('Math.min(16, window._appFns.renderer.getMaxAnisotropy() || 1)');
  console.log('renderer:', await evalJS("window._appFns.renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2'"), 'max anisotropy:', want);
  check('the model loaded with its four texture slots', maps.length >= 4, maps);
  check('the graphics card offers more than plain filtering', want > 1, { want });
  check('every texture of the model is filtered at the card\'s best (at most 16)', maps.length > 0 && maps.every(([, a]) => a === want), { maps, want });
  const readMaps = `(() => { const out = []; window._appFns.camera.parent.traverse(o => { if (!o.isMesh) return; for (const m of [].concat(o.material || [])) for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) if (m && m[k] && m[k].isTexture) out.push(m[k].anisotropy); }); return out; })()`;
  const flip = (id, on) => evalJS(`(() => { const c = document.getElementById('${id}'); if (!c) return false; c.checked = ${on}; c.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await evalJS('window.__openSettings("perf")'); await sleep(400);
  check('Settings › Performance has both Picture quality switches, Sharp textures on and Finer shadows off',
    await evalJS("(() => { const a = document.getElementById('set-sharp-tex'), b = document.getElementById('set-fine-shadows'); return !!a && !!b && a.checked && !b.checked; })()"));
  await flip('set-sharp-tex', false); await sleep(600);
  check('Sharp textures off: every map back to plain filtering', (await evalJS(readMaps)).every(a => a === 1), await evalJS(readMaps));
  check('and remembered', await evalJS("localStorage.getItem('stepopt-gfx-sharp-tex') === '0'"));
  await flip('set-sharp-tex', true); await sleep(600);
  check('Sharp textures on again: every map at the card\'s best', (await evalJS(readMaps)).every(a => a === want), await evalJS(readMaps));
  await evalJS("(() => { const t = document.getElementById('toggle-shadows'); if (t && !t.checked) t.click(); return true; })()"); await sleep(2500);
  const mapSize = "(() => { const s = window.state._lights.dir.shadow; return [s.mapSize.x, s.map ? s.map.width : 0]; })()";
  check('the shadows are drawn from a 2048 px map by default', (await evalJS(mapSize))[0] === 2048, await evalJS(mapSize));
  await flip('set-fine-shadows', true); await sleep(2500);
  const fine = await evalJS(mapSize);
  check('Finer shadows: a 4096 px map, drawn', fine[0] === 4096 && fine[1] === 4096, fine);
  await flip('set-fine-shadows', false); await sleep(2500);
  check('Finer shadows off: 2048 again', (await evalJS(mapSize))[0] === 2048, await evalJS(mapSize));
  await evalJS("localStorage.removeItem('stepopt-gfx-sharp-tex'); localStorage.removeItem('stepopt-gfx-fine-shadows'); true");
  check('no uncaught errors', errors.length === 0, errors.slice(0, 5));
} catch (e) {
  fail++; console.log('FAIL', e.message);
} finally {
  try { ws && ws.close(); } catch (_) {}
  chrome.kill();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
}
