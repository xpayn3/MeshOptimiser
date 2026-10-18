// node tests/e2e-export-uv.mjs
// Export keeps the UVs. A UV sphere is opened in the real app and exported with Claude's export tool (into the exports folder):
//   - as binary FBX and as ASCII FBX, read back with three's FBXLoader: the same set of (u, v) pairs, to four decimals;
//   - with its UVs tiled 500 times, as a Draco GLB and a Meshopt GLB, read back with three's GLTFLoader: every u and v within 0.02 of a
//     tile of the original (the compressors' default 12 bits would be 0.12 of a tile off).
// Needs the app served on http://localhost:4242 (python app/serve.py --no-browser --port 4242), or another port in APP_PORT, Chrome installed and Node 22+.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9359, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-exportuv-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const ROOT = path.resolve(path.dirname(new globalThis.URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const ready = async () => { for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); } await sleep(1500); };
const attach = async () => {
  let target;
  for (let i = 0; i < 60 && !target; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); target = l.find(t => t.type === 'page'); } catch (_) {} if (!target) await sleep(500); }
  if (!target) throw new Error('Chrome did not start');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
    else if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text || '').split('\n').slice(0, 3).join(' | '));
  };
  await send('Page.enable'); await send('Runtime.enable');
};
const LAT = 12, LON = 24;
function sphereObj() {
  const out = ['o uvball'];
  for (let i = 0; i <= LAT; i++) for (let j = 0; j <= LON; j++) { const th = i / LAT * Math.PI, ph = j / LON * Math.PI * 2; out.push('v ' + (Math.sin(th) * Math.cos(ph) * 50).toFixed(6) + ' ' + (Math.cos(th) * 50).toFixed(6) + ' ' + (Math.sin(th) * Math.sin(ph) * 50).toFixed(6)); }
  for (let i = 0; i <= LAT; i++) for (let j = 0; j <= LON; j++) out.push('vt ' + (j / LON).toFixed(6) + ' ' + (1 - i / LAT).toFixed(6));
  const vid = (i, j) => i * (LON + 1) + j + 1;
  for (let i = 0; i < LAT; i++) for (let j = 0; j < LON; j++) { const a = vid(i, j), b = vid(i + 1, j), c = vid(i + 1, j + 1), d = vid(i, j + 1); out.push('f ' + a + '/' + a + ' ' + c + '/' + c + ' ' + b + '/' + b, 'f ' + a + '/' + a + ' ' + d + '/' + d + ' ' + c + '/' + c); }
  return out.join(String.fromCharCode(10));
}
const pairs = (arr) => { const s = new Set(); for (let i = 0; i < arr.length; i += 2) s.add(arr[i].toFixed(4) + ',' + arr[i + 1].toFixed(4)); return s; };

try {
  await attach();
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  await ready();
  await evalJS("document.getElementById('welcome-close')?.click()");
  await evalJS(`(() => { const f = new File([${JSON.stringify(sphereObj())}], 'uvball.obj'); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  for (let i = 0; i < 40; i++) { if (await evalJS("document.getElementById('import-modal').classList.contains('show')").catch(() => false)) break; await sleep(250); }
  await evalJS("document.querySelector('#import-modal-confirm')?.click()");
  for (let i = 0; i < 60; i++) { if (await evalJS("window.state && window.state.parts.length >= 1").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  const src = await evalJS(`Array.from(window.state.parts[0].mesh.geometry.attributes.uv.array)`);
  const want = pairs(src);
  for (const ascii of [false, true]) {
    const kind = ascii ? 'ASCII' : 'binary';
    const name = 'uvtest_' + kind + '_' + Date.now();
    const res = await evalJS(`(async () => { const cb = document.getElementById('exp-fbx-ascii'); if (cb) cb.checked = ${ascii}; const r = await window.__moBridgeTools.export_model({ format: 'fbx', file_name: ${JSON.stringify(name)} }); return r[0].text; })()`);
    const saved = JSON.parse(res).files || [];
    const file = saved.map(f => (typeof f === 'string' ? f : f.path || f.file || f.name)).find(Boolean);
    const p = [file, path.join(ROOT, 'exports', path.basename(String(file || '')))].find(x => x && fs.existsSync(x));
    if (!p) { check(kind + ' FBX: the file is written', false, { res }); continue; }
    const b64 = fs.readFileSync(p).toString('base64');
    const got = await evalJS(`(async () => { const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js'); const bin = Uint8Array.from(atob(${JSON.stringify(b64)}), c => c.charCodeAt(0)); const g = new FBXLoader().parse(bin.buffer, ''); let m = null; g.traverse(o => { if (o.isMesh && !m) m = o; }); const uv = m && m.geometry.attributes.uv; return uv ? Array.from(uv.array) : null; })()`);
    check(kind + ' FBX has UVs', !!got && got.length > 0, { file: p });
    if (got) {
      const have = pairs(got); let missing = 0, extra = 0;
      for (const k of want) if (!have.has(k)) missing++;
      for (const k of have) if (!want.has(k)) extra++;
      check(kind + ' FBX: the UVs are the sphere\'s own', missing === 0 && extra === 0, { want: want.size, have: have.size, missing, extra });
    }
    try { fs.unlinkSync(p); } catch (_) {}
  }
  // compressed GLB with UVs tiled 500 times
  await evalJS(`(() => { const g = window.state.parts[0].mesh.geometry, u = g.attributes.uv; for (let i = 0; i < u.array.length; i++) u.array[i] *= 500; u.needsUpdate = true; return true; })()`);
  const tiled = await evalJS(`Array.from(window.state.parts[0].mesh.geometry.attributes.uv.array)`);
  for (const comp of ['draco', 'meshopt']) {
    const name = 'uvtest_' + comp + '_' + Date.now();
    let res; try { res = await evalJS(`(async () => (await window.__moBridgeTools.export_model({ format: 'glb', compression: ${JSON.stringify(comp)}, file_name: ${JSON.stringify(name)} }))[0].text)()`); } catch (e) { check(comp + ' GLB: exported', false, e.message); continue; }
    const saved = JSON.parse(res).files || [];
    const file = saved.map(f => (typeof f === 'string' ? f : f.path || f.file || f.name)).find(Boolean);
    const p = [file, path.join(ROOT, 'exports', path.basename(String(file || '')))].find(x => x && fs.existsSync(x));
    if (!p) { check(comp + ' GLB: the file is written', false, { res }); continue; }
    const b64 = fs.readFileSync(p).toString('base64');
    const got = await evalJS(`(async () => {
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js'), { DRACOLoader } = await import('three/addons/loaders/DRACOLoader.js'), { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js');
      const L = new GLTFLoader(), D = new DRACOLoader(); D.setDecoderPath('./vendor/draco/'); L.setDRACOLoader(D); L.setMeshoptDecoder(MeshoptDecoder);
      const bin = Uint8Array.from(atob(${JSON.stringify(b64)}), c => c.charCodeAt(0));
      const gl = await L.parseAsync(bin.buffer, ''); let m = null; gl.scene.traverse(o => { if (o.isMesh && !m) m = o; });
      const uv = m && m.geometry.attributes.uv; if (!uv) return null; const out = []; for (let i = 0; i < uv.count; i++) out.push(uv.getX(i), uv.getY(i)); return out; })()`);
    if (!got) { check(comp + ' GLB has UVs', false); continue; }
    // every u (and every v) read back, against the nearest u (v) of the original: how far the encoder moved it (it may reorder and weld)
    const sorted = (arr, k) => arr.filter((_, i) => i % 2 === k).sort((x, y) => x - y);
    const nearest = (A, x) => { let lo = 0, hi = A.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (A[m] < x) lo = m; else hi = m; } return Math.min(Math.abs(A[lo] - x), Math.abs(A[hi] - x)); };
    let worst = 0;
    for (const k of [0, 1]) { const A = sorted(tiled, k); for (let i = k; i < got.length; i += 2) worst = Math.max(worst, nearest(A, got[i])); }
    check(comp + ' GLB keeps tiled UVs within 0.02 of a tile', worst < 0.02, { worst: +worst.toFixed(4), n: [tiled.length / 2, got.length / 2] });
    try { fs.unlinkSync(p); } catch (_) {}
  }
  if (errors.length) console.log('page errors:', errors.slice(0, 5));
} catch (e) { console.log('HARNESS ERROR:', e.message); fail++; }
try { ws && ws.close(); } catch (_) {}
chrome.kill();
console.log(fail ? fail + ' failed, ' + pass + ' passed' : 'ok: ' + pass + ' passed');
process.exit(fail ? 1 : 0);
