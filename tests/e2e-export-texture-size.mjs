// node tests/e2e-export-texture-size.mjs
//
// Exports keep the size of the pictures. A square with a 2048 px colour map (JPEG) and a 2048 px normal map (PNG) is exported through
// Claude's export_model as GLB (plain, meshopt, the web preset with Draco), glTF and USDZ, and the size of every picture in each file is
// read back from its header: none may come out smaller. (three's USDZ writer drew them at most 1024 px unless told.) An OBJ writes
// each picture as a file beside it, named in its .mtl (map_Kd, norm): both files are there, at 2048 px. An FBX carries them inside it:
// opened again, its material has both at 2048 px. The exported files are deleted again.
// Needs the app on http://localhost:4242, Chrome, Node 22+.
import { spawn } from 'child_process';
import zlib from 'zlib';
import fs from 'fs';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9376, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-exptex-' + Date.now();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--mute-audio', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name, extra === undefined ? '' : JSON.stringify(extra)); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };

// A 2048 px PNG (a normal map in stripes, so it is not one colour); the JPEG colour map is made from it by the page.
function png2k() {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), cr = Buffer.alloc(4); len.writeUInt32BE(data.length); cr.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, cr]); };
  const N = 2048, raw = Buffer.alloc(N * (N * 3 + 1));
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const o = y * (N * 3 + 1) + 1 + x * 3; raw[o] = 128; raw[o + 1] = 128 + ((x >> 6) & 1) * 60; raw[o + 2] = 230; }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function glb(colour, normal) {
  const pos = new Float32Array([0, 0, 0, 100, 0, 0, 100, 100, 0, 0, 100, 0]), nor = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), uv = new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]), idx = new Uint16Array([0, 1, 2, 0, 2, 3]);
  const pad = (b) => Buffer.concat([b, Buffer.alloc((4 - b.length % 4) % 4)]);
  const parts = [Buffer.from(pos.buffer), Buffer.from(nor.buffer), Buffer.from(uv.buffer), pad(Buffer.from(idx.buffer)), pad(colour), pad(normal)];
  const views = []; let off = 0;
  for (const p of parts) { views.push({ buffer: 0, byteOffset: off, byteLength: p.length }); off += p.length; }
  views[3].byteLength = idx.byteLength; views[4].byteLength = colour.length; views[5].byteLength = normal.length;
  const bin = Buffer.concat(parts);
  const json = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'Tile' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
    materials: [{ name: 'Tile', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.6 }, normalTexture: { index: 1 } }],
    textures: [{ source: 0 }, { source: 1 }], images: [{ bufferView: 4, mimeType: 'image/jpeg' }, { bufferView: 5, mimeType: 'image/png' }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [0, 0, 0], max: [100, 100, 0] }, { bufferView: 1, componentType: 5126, count: 4, type: 'VEC3' }, { bufferView: 2, componentType: 5126, count: 4, type: 'VEC2' }, { bufferView: 3, componentType: 5123, count: 6, type: 'SCALAR' }],
    bufferViews: views, buffers: [{ byteLength: bin.length }] };
  const j = Buffer.from(JSON.stringify(json)), jp = Buffer.concat([j, Buffer.alloc((4 - j.length % 4) % 4, 0x20)]);
  const head = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
  head.write('glTF', 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + jp.length + 8 + bin.length, 8);
  jh.writeUInt32LE(jp.length, 0); jh.write('JSON', 4); bh.writeUInt32LE(bin.length, 0); bh.write('BIN\0', 4);
  return Buffer.concat([head, jh, jp, bh, bin]);
}
// The width and height a PNG or JPEG header gives.
function dims(b) {
  if (b[0] === 0x89 && b[1] === 0x50) return [b.readUInt32BE(16), b.readUInt32BE(20)];
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1], len = b.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
      i += 2 + len;
    }
  }
  return null;
}
function glbImages(file) {
  const d = fs.readFileSync(file), jl = d.readUInt32LE(12), j = JSON.parse(d.slice(20, 20 + jl).toString()), bin = d.slice(20 + jl + 8);
  return (j.images || []).map(im => { const bv = j.bufferViews[im.bufferView], o = bv.byteOffset || 0; return dims(bin.slice(o, o + bv.byteLength)); });
}
function gltfImages(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  return (j.images || []).map(im => /^data:/.test(im.uri || '') ? dims(Buffer.from(im.uri.split(',')[1], 'base64')) : null);
}
// A USDZ is a zip with every file stored as it is (not compressed): the pictures are read from the local file headers.
function usdzImages(file) {
  const d = fs.readFileSync(file), out = [];
  let i = 0;
  while (i + 30 < d.length && d.readUInt32LE(i) === 0x04034b50) {
    const size = d.readUInt32LE(i + 18), nl = d.readUInt16LE(i + 26), xl = d.readUInt16LE(i + 28), name = d.slice(i + 30, i + 30 + nl).toString(), at = i + 30 + nl + xl;
    if (/\.(png|jpe?g)$/i.test(name)) out.push(dims(d.slice(at, at + size)));
    i = at + size;
  }
  return out;
}
const call = (name, args = {}) => evalJS(`(async () => { try { const t = window.__moTabs, w = t && t.wins && t.wins[t.active]; const f = ((w && w.__moBridgeTools) || window.__moBridgeTools)[${JSON.stringify(name)}]; const r = await f(${JSON.stringify(args)}); return { ok: true, t: r.filter(x => x.type === 'text').map(x => x.text).join('\\n') }; } catch (e) { return { ok: false, e: e.message || String(e) }; } })()`);

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
  const nrm = png2k();
  const jpgB64 = await evalJS(`(async () => { const b = Uint8Array.from(atob(${JSON.stringify(nrm.toString('base64'))}), c => c.charCodeAt(0)); const bm = await createImageBitmap(new Blob([b], { type: 'image/png' })); const c = new OffscreenCanvas(bm.width, bm.height); c.getContext('2d').drawImage(bm, 0, 0); const j = await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 }); const u = new Uint8Array(await j.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); })()`);
  const model = glb(Buffer.from(jpgB64, 'base64'), nrm);
  await evalJS(`(async () => { const bin = atob(${JSON.stringify(model.toString('base64'))}); const u = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) u[k] = bin.charCodeAt(k); const f = new File([u], 'tile.glb'); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  for (let i = 0; i < 60; i++) { if (await evalJS("!!(window.state && window.state.parts.some(p => p && !p.deleted && p.mesh))").catch(() => false)) break; await sleep(500); }
  await sleep(2000);
  const stamp = Date.now().toString(36);
  for (const [label, args, read] of [
    ['GLB', { format: 'glb', compression: 'none' }, glbImages], ['GLB meshopt', { format: 'glb', compression: 'meshopt' }, glbImages],
    ['GLB web preset (Draco)', { preset: 'web' }, glbImages], ['glTF', { format: 'gltf' }, gltfImages], ['USDZ', { format: 'usdz' }, usdzImages]]) {
    const r = await call('export_model', { ...args, file_name: 'texsize-' + stamp + '-' + label.replace(/\W+/g, '-').toLowerCase() });
    const m = r.ok && /"path"\s*:\s*"([^"]+)"/.exec(r.t), file = m ? JSON.parse('"' + m[1] + '"') : null;
    let sizes = null;
    try { sizes = file ? read(file) : null; } catch (e) { sizes = 'unreadable: ' + e.message; }
    check(label + ': both pictures keep their 2048 px', Array.isArray(sizes) && sizes.length >= 2 && sizes.every(s => s && s[0] === 2048 && s[1] === 2048), { sizes, err: r.e });
    try { if (file) fs.unlinkSync(file); } catch (_) {}
  }
  {
    const r = await call('export_model', { format: 'obj', file_name: 'texsize-' + stamp + '-obj' });
    const files = r.ok ? [...r.t.matchAll(/"path"\s*:\s*"([^"]+)"/g)].map(m => JSON.parse('"' + m[1] + '"')) : [];
    const mtl = files.find(f => /\.mtl$/.test(f)), mtlText = mtl ? fs.readFileSync(mtl, 'utf8') : '';
    const pics = files.filter(f => /\.(png|jpe?g)$/i.test(f)).map(f => [f.split(/[\/]/).pop(), dims(fs.readFileSync(f))]);
    check('OBJ: the .mtl names the colour map and the normal map', /^map_Kd\s+\S+/m.test(mtlText) && /^norm\s+\S+/m.test(mtlText), mtlText);
    check('OBJ: both pictures are written beside it at 2048 px', pics.length === 2 && pics.every(([, d]) => d && d[0] === 2048 && d[1] === 2048), { pics, err: r.e });
    for (const f of files) { try { fs.unlinkSync(f); } catch (_) {} }
  }
  {
    // FBX: the pictures go inside the file. It is opened again and the size of the pictures its material comes back with is read.
    const r = await call('export_model', { format: 'fbx', file_name: 'texsize-' + stamp + '-fbx' });
    const m = r.ok && /"path"\s*:\s*"([^"]+)"/.exec(r.t), file = m ? JSON.parse('"' + m[1] + '"') : null;
    const bytes = file ? fs.readFileSync(file) : null;
    if (file) { try { fs.unlinkSync(file); } catch (_) {} }
    let got = null;
    if (bytes) {
      await send('Page.navigate', { url: 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html?t=' + Date.now() });
      for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
      await sleep(1500); await evalJS("document.getElementById('welcome-close')?.click()");
      await evalJS(`(async () => { const bin = atob(${JSON.stringify(bytes.toString('base64'))}); const u = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) u[k] = bin.charCodeAt(k); const f = new File([u], 'tile.fbx'); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
      for (let i = 0; i < 60; i++) {
        if (await evalJS("document.getElementById('import-modal')?.classList.contains('show')").catch(() => false)) await evalJS("document.querySelector('#import-modal-confirm')?.click()");
        got = await evalJS("(() => { const p = window.state && window.state.parts.find(p => p && !p.deleted && p.mesh); if (!p) return null; const m = [].concat(p.mesh.material)[0], sz = (t) => { const i = t && t.image; return i ? [i.naturalWidth || i.width, i.naturalHeight || i.height] : null; }; return { map: sz(m.map), normalMap: sz(m.normalMap) }; })()").catch(() => null);
        if (got && got.map && got.normalMap && got.map[0] && got.normalMap[0]) break;
        await sleep(500);
      }
    }
    check('FBX: the colour map and the normal map come back from inside the file at 2048 px', !!(got && got.map && got.normalMap && got.map[0] === 2048 && got.map[1] === 2048 && got.normalMap[0] === 2048 && got.normalMap[1] === 2048), { got, err: r.e, kb: bytes && Math.round(bytes.length / 1024) });
  }
  check('no page errors', errors.length === 0, errors.slice(0, 5));
} catch (e) {
  fail++; console.log('FAIL', e.message);
} finally {
  try { ws && ws.close(); } catch (_) {}
  chrome.kill();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
}
