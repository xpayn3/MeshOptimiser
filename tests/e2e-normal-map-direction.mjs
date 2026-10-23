// node tests/e2e-normal-map-direction.mjs
//
// Normal maps point their bumps the right way, whatever the file format. A square carries a normal map that tilts every normal towards
// the top of its picture (OpenGL convention, as glTF, Blender and most libraries write them: green is up in the picture). The square is
// opened as a GLB (three's own glTF reading, the reference) and as an OBJ with the map beside it (found by its name, texsets.js; OBJ
// counts V from the bottom, and the app turns its UVs on import). In each, every light of the app is put out, the environment taken
// away, and one light is set on the side of the picture's top, half-way between it and the square's front: a normal tilted the right way
// faces that light more than a flat one does and comes out brighter; tilted the wrong way, darker. The middle of the square is read
// from a render with the map, and with the map taken off, and compared. Also: the map is read as plain data (NoColorSpace), not as a
// colour. Last, the GLB written out by the app (export_model) as an OBJ (the .obj, its .mtl with map lines, the pictures beside it) and
// as an FBX (the pictures inside it), each opened again with its files: the bumps must still face the top of the picture. The same OBJ with the map drawn the DirectX way (green down: square_Normal_DX.png) must come out the same.
// Needs the app served on http://localhost:4242, or another port in APP_PORT, Chrome and Node 22+.
import { spawn } from 'child_process';
import zlib from 'zlib';
import fs from 'fs';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9375, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-nrm-' + Date.now();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const GPU_FLAGS = process.env.CAPTURE_GPU === '1' ? ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, ...GPU_FLAGS, '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name, extra === undefined ? '' : JSON.stringify(extra)); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };

// An 8x8 PNG of one colour.
function png(r, g, b) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), cr = Buffer.alloc(4); len.writeUInt32BE(data.length); cr.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, cr]); };
  const N = 8, raw = Buffer.alloc(N * (N * 3 + 1));
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const o = y * (N * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// tangent-space normal (0, 0.6, 0.8): towards the top of the picture
const NRM = png(128, 204, 230);
// the same normal as a DirectX map draws it: green the other way up
const NRM_DX = png(128, 51, 230);
// The square: 0..1 in X and Y, facing +Z; the picture's top at +Y. glTF's V runs from the top, so V = 1 - y.
const P = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], UV = P.map(([x, y]) => [x, 1 - y]);
function glb() {
  const pos = new Float32Array(P.flat()), nor = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), uv = new Float32Array(UV.flat()), idx = new Uint16Array([0, 1, 2, 0, 2, 3]);
  const pad = (b) => Buffer.concat([b, Buffer.alloc((4 - b.length % 4) % 4)]);
  const parts = [Buffer.from(pos.buffer), Buffer.from(nor.buffer), Buffer.from(uv.buffer), pad(Buffer.from(idx.buffer)), pad(NRM)];
  const views = []; let off = 0;
  for (const p of parts) { views.push({ buffer: 0, byteOffset: off, byteLength: p.length }); off += p.length; }
  views[3].byteLength = idx.byteLength; views[4].byteLength = NRM.length;
  const bin = Buffer.concat(parts);
  const json = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'Square' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
    materials: [{ name: 'Square', pbrMetallicRoughness: { baseColorFactor: [0.8, 0.8, 0.8, 1], metallicFactor: 0, roughnessFactor: 1 }, normalTexture: { index: 0 } }],
    textures: [{ source: 0 }], images: [{ bufferView: 4, mimeType: 'image/png' }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5126, count: 4, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: 4, type: 'VEC2' },
      { bufferView: 3, componentType: 5123, count: 6, type: 'SCALAR' },
    ],
    bufferViews: views, buffers: [{ byteLength: bin.length }],
  };
  const j = Buffer.from(JSON.stringify(json)), jp = Buffer.concat([j, Buffer.alloc((4 - j.length % 4) % 4, 0x20)]);
  const head = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
  head.write('glTF', 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + jp.length + 8 + bin.length, 8);
  jh.writeUInt32LE(jp.length, 0); jh.write('JSON', 4); bh.writeUInt32LE(bin.length, 0); bh.write('BIN\0', 4);
  return Buffer.concat([head, jh, jp, bh, bin]);
}
// OBJ counts V from the bottom: vt = y.
const OBJ = ['o Square', ...P.map(p => 'v ' + p.join(' ')), ...P.map(([x, y]) => `vt ${x} ${y}`), 'vn 0 0 1', 'usemtl Square', 'f 1/1/1 2/2/1 3/3/1', 'f 1/1/1 3/3/1 4/4/1', ''].join('\n');

// In the page: every light out, no environment, one light on the side of the picture's top (worked out from the square's own UVs as the
// app holds them: in the scene V runs from the top, so the top is where V is smallest), and the middle of the square read with and
// without its normal map.
const PROBE = `(async () => {
  const A = window._appFns, T = A.THREE, r = A.renderer, scene = A.camera.parent;
  const mesh = window.state.parts.find(p => p && !p.deleted && p.mesh).mesh;
  mesh.updateMatrixWorld(true);
  const g = mesh.geometry, pa = g.attributes.position, uv = g.attributes.uv;
  let lo = 0, hi = 0; for (let i = 1; i < uv.count; i++) { if (uv.getY(i) < uv.getY(lo)) lo = i; if (uv.getY(i) > uv.getY(hi)) hi = i; }
  const W = (i) => new T.Vector3(pa.getX(i), pa.getY(i), pa.getZ(i)).applyMatrix4(mesh.matrixWorld);
  const box = new T.Box3().setFromObject(mesh), c = box.getCenter(new T.Vector3()), size = box.getSize(new T.Vector3()).length();
  const n = new T.Vector3(g.attributes.normal.getX(0), g.attributes.normal.getY(0), g.attributes.normal.getZ(0)).transformDirection(mesh.matrixWorld).normalize();
  const top = W(lo).sub(W(hi)); top.addScaledVector(n, -top.dot(n)).normalize();
  const mat = [].concat(mesh.material)[0];
  const was = { env: scene.environment, bg: scene.background, lights: [] };
  scene.traverse(o => { if (o.isLight) { was.lights.push([o, o.intensity]); o.intensity = 0; } });
  scene.environment = null; scene.background = new T.Color(0);
  const L = new T.DirectionalLight(0xffffff, 3); L.position.copy(c).addScaledVector(n.clone().add(top).normalize(), size * 4); L.target.position.copy(c);
  scene.add(L, L.target);
  const cam = new T.PerspectiveCamera(30, 1, size * 0.01, size * 100); cam.position.copy(c).addScaledVector(n, size * 3); cam.up.copy(top); cam.lookAt(c); cam.updateMatrixWorld();
  const N = 32, rt = new T.RenderTarget(N, N, { type: T.UnsignedByteType });
  const read = async () => { r.setRenderTarget(rt); r.render(scene, cam); const px = await r.readRenderTargetPixelsAsync(rt, 0, 0, N, N); r.setRenderTarget(null); const k = (N / 2 * N + N / 2) * 4; return px[k] + px[k + 1] + px[k + 2]; };
  const nm = mat.normalMap;
  const withMap = await read();
  mat.normalMap = null; mat.needsUpdate = true;
  const flat = await read();
  mat.normalMap = nm; mat.needsUpdate = true;
  scene.remove(L, L.target); rt.dispose();
  for (const [o, k] of was.lights) o.intensity = k; scene.environment = was.env; scene.background = was.bg;
  return { withMap, flat, hasMap: !!nm, colorSpace: nm ? nm.colorSpace : null, flipY: nm ? nm.flipY : null, normalScale: mat.normalScale ? mat.normalScale.toArray() : null };
})()`;

const open = async (files) => {
  await evalJS(`(async () => { const list = ${JSON.stringify(files.map(f => [f.name, f.data.toString('base64')]))};
    const dt = new DataTransfer();
    for (const [name, b64] of list) { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) u[k] = bin.charCodeAt(k); dt.items.add(new File([u], name)); }
    document.getElementById('viewport').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    return true; })()`);
  for (let i = 0; i < 40; i++) {
    if (await evalJS("document.getElementById('import-modal')?.classList.contains('show')").catch(() => false)) { await evalJS("document.querySelector('#import-modal-confirm')?.click()"); }
    if (await evalJS("!!(window.state && window.state.parts.some(p => p && !p.deleted && p.mesh && [].concat(p.mesh.material)[0].normalMap))").catch(() => false)) break;
    await sleep(500);
  }
  await sleep(1500);
};

try {
  let target;
  for (let i = 0; i < 60 && !target; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); target = l.find(t => t.type === 'page'); } catch (_) {} if (!target) await sleep(250); }
  if (!target) throw new Error('Chrome did not start');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
    else if (d.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
    else if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text || '').split('\n').slice(0, 3).join(' | '));
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  for (const [label, files] of [['GLB', [{ name: 'square.glb', data: glb() }]], ['OBJ', [{ name: 'square.obj', data: Buffer.from(OBJ) }, { name: 'square_Normal.png', data: NRM }]], ['OBJ with a DirectX map', [{ name: 'square.obj', data: Buffer.from(OBJ) }, { name: 'square_Normal_DX.png', data: NRM_DX }]]]) {
    await send('Page.navigate', { url: 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html?t=' + Date.now() });
    for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
    await sleep(1500);
    await evalJS("document.getElementById('welcome-close')?.click()");
    await open(files);
    const r = await evalJS(PROBE).catch(e => ({ error: e.message }));
    console.log(label, JSON.stringify(r));
    check(label + ': the normal map is on the square', r.hasMap === true, r);
    check(label + ': it is read as plain data, not as a colour', r.colorSpace === '' || r.colorSpace === 'NoColorSpace' || r.colorSpace === undefined, r.colorSpace);
    check(label + ': its bumps face the top of the picture (brighter than flat under a light from there)', r.withMap > r.flat * 1.05, { withMap: r.withMap, flat: r.flat });
  }
  // the GLB out as an OBJ (with its pictures beside it) and as an FBX (with them inside), and back in
  for (const fmt of ['obj', 'fbx']) {
    await send('Page.navigate', { url: 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html?t=' + Date.now() });
    for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
    await sleep(1500); await evalJS("document.getElementById('welcome-close')?.click()");
    await open([{ name: 'square.glb', data: glb() }]);
    const stem = 'nrm-rt-' + fmt + '-' + Date.now().toString(36);
    const r = await evalJS('(async () => { try { const r = await window.__moBridgeTools.export_model({ format: ' + JSON.stringify(fmt) + ', file_name: ' + JSON.stringify(stem) + ' }); return r.filter(x => x.type === "text").map(x => x.text).join(""); } catch (e) { return "ERR " + e.message; } })()');
    const files = [...String(r).matchAll(/"path"\s*:\s*"([^"]+)"/g)].map(m => JSON.parse('"' + m[1] + '"'));
    if (fmt === 'obj') {
      const mtl = files.find(f => /\.mtl$/.test(f));
      const mtlText = mtl ? fs.readFileSync(mtl, 'utf8') : '';
      check('GLB → OBJ: the .mtl names the normal map (norm) and the export writes it', /^norm\s+\S+\.png/m.test(mtlText) && files.some(f => /_Normal\.png$/.test(f)), { files: files.map(f => path.basename(f)), mtlText });
    } else check('GLB → FBX: one file, the pictures inside it', files.length === 1 && /\.fbx$/.test(files[0]), files);
    await send('Page.navigate', { url: 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html?t=' + Date.now() });
    for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
    await sleep(1500); await evalJS("document.getElementById('welcome-close')?.click()");
    await open(files.map(f => ({ name: path.basename(f), data: fs.readFileSync(f) })));
    const q = await evalJS(PROBE).catch(e => ({ error: e.message }));
    console.log('GLB → ' + fmt.toUpperCase() + ' → open', JSON.stringify(q));
    check('GLB → ' + fmt.toUpperCase() + ' → open: the normal map comes back', q.hasMap === true, q);
    check('GLB → ' + fmt.toUpperCase() + ' → open: its bumps still face the top of the picture', q.withMap > q.flat * 1.05, { withMap: q.withMap, flat: q.flat });
    for (const f of files) { try { fs.unlinkSync(f); } catch (_) {} }
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
