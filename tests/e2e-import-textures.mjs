// node tests/e2e-import-textures.mjs
// A file from another tool keeps its textures, and its UVs, when it is opened:
//   1. a GLB box with a colour map and a normal map (made in the page with three's GLTFExporter) opens with both maps on its material and
//      its UVs on the geometry;
//   2. the same with the import dialog's "Keep texture coordinates" switch off: the maps need the UVs, so they stay;
//   3. a GLB with a plain colour material still gets the app's own look (metalness 0.15, roughness 0.55), as before;
//   4. Merge parts on a textured box and a plain ball keeps the texture (each part its material, as a group) and the UVs; plain parts
//      merge into one vertex-colour material as before.
// Needs the app served on http://localhost:4242 (python app/serve.py --no-browser --port 4242), or another port in APP_PORT, Chrome installed and Node 22+.
import { spawn } from 'child_process';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9358, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-imptex-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--mute-audio', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
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

// makes a GLB in the page (a box named `name`, textured or plain) and keeps it as window.__glb
const makeGlb = (name, textured) => evalJS(`(async () => {
  const T = await import('three'), { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
  const tex = (draw) => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); draw(x); const t = new T.CanvasTexture(c); t.flipY = false; return t; };
  const mat = new T.MeshStandardMaterial({ color: 0xffffff, metalness: 0.3, roughness: 0.6 });
  if (${textured}) {
    mat.map = tex((x) => { for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { x.fillStyle = (i + j) % 2 ? '#d02020' : '#f0f0f0'; x.fillRect(i * 8, j * 8, 8, 8); } });
    mat.map.colorSpace = T.SRGBColorSpace;
    mat.normalMap = tex((x) => { x.fillStyle = 'rgb(128,128,255)'; x.fillRect(0, 0, 64, 64); });
  } else mat.color.set(0x3366aa);
  const m = new T.Mesh(new T.BoxGeometry(2, 2, 2), mat); m.name = ${JSON.stringify(name)};
  const sc = new T.Scene(); sc.add(m);
  const buf = await new GLTFExporter().parseAsync(sc, { binary: true });
  window.__glb = new File([buf], ${JSON.stringify(name)} + '.glb');
  return buf.byteLength;
})()`);
const open = async (keepUv) => {
  await evalJS(`(() => { const dt = new DataTransfer(); dt.items.add(window.__glb); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  for (let i = 0; i < 40; i++) { if (await evalJS("document.getElementById('import-modal').classList.contains('show')").catch(() => false)) break; await sleep(250); }
  await evalJS(`(() => { const k = document.getElementById('imp-keep-uv'); if (k) { k.checked = ${keepUv}; k.dispatchEvent(new Event('change', { bubbles: true })); } document.querySelector('#import-modal-confirm')?.click(); return true; })()`);
  await sleep(3000);
};
const makeTwo = () => evalJS(`(async () => {
  const T = await import('three'), { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
  const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d'); x.fillStyle = '#20a040'; x.fillRect(0, 0, 32, 32); x.fillStyle = '#f0f0f0'; x.fillRect(0, 0, 16, 16);
  const t = new T.CanvasTexture(c); t.flipY = false; t.colorSpace = T.SRGBColorSpace;
  const a = new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshStandardMaterial({ map: t })); a.name = 'tbox';
  const b = new T.Mesh(new T.SphereGeometry(0.6, 16, 8), new T.MeshStandardMaterial({ color: 0x3366aa })); b.name = 'pball'; b.position.x = 2;
  const sc = new T.Scene(); sc.add(a, b);
  window.__glb = new File([await new GLTFExporter().parseAsync(sc, { binary: true })], 'two.glb'); return true;
})()`);
const merge = (names) => evalJS(`(async () => { const ids = window.state.parts.filter(p => !p.deleted && ${JSON.stringify(names)}.includes(p.name)).map(p => p.partId); await window.__moBridgeTools.merge_parts({ ids }); const p = window.state.parts.filter(q => !q.deleted).pop(); const ms = [].concat(p.mesh.material), g = p.mesh.geometry;
  return { name: p.name, mats: ms.length, maps: ms.filter(m => m.map).length, vertexColors: ms.some(m => m.vertexColors), groups: g.groups.length, uv: !!g.attributes.uv, tris: g.index.count / 3 }; })()`);
const fresh = async () => { await send('Page.navigate', { url: URL + '?t=' + Date.now() }); await ready(); await evalJS("document.getElementById('welcome-close')?.click()"); };
const look = (name) => evalJS(`(() => {
  const p = window.state.parts.find(q => q.name === ${JSON.stringify(name)} && !q.deleted); if (!p) return { found: false, names: window.state.parts.map(q => q.name) };
  const ms = [].concat(p.mesh.material), m = ms[0], g = p.mesh.geometry;
  return { found: true, type: m.type, map: !!m.map, mapImg: !!(m.map && m.map.image), normalMap: !!m.normalMap, metalness: m.metalness, roughness: m.roughness, uv: !!g.attributes.uv, uvCount: g.attributes.uv ? g.attributes.uv.count : 0 };
})()`);

try {
  await attach();
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  await ready();
  await evalJS("document.getElementById('welcome-close')?.click()");

  await makeGlb('texbox', true); await open(true);
  let r = await look('texbox');
  check('a textured GLB keeps its colour map and normal map', r.found && r.map && r.mapImg && r.normalMap, r);
  check('... and its UVs', r.uv && r.uvCount > 0, r);

  await fresh(); await makeGlb('texbox2', true); await open(false);
  r = await look('texbox2');
  check('with "Keep texture coordinates" off, a textured part still keeps its maps and UVs', r.found && r.map && r.uv, r);

  await fresh(); await makeGlb('plainbox', false); await open(true);
  r = await look('plainbox');
  check('a plain colour GLB still gets the app\'s own look', r.found && !r.map && Math.abs(r.metalness - 0.15) < 1e-6 && Math.abs(r.roughness - 0.55) < 1e-6, r);

  await fresh(); await makeTwo(); await open(true);
  r = await merge(['tbox', 'pball']);
  check('merging a textured part with a plain one keeps the texture, each part its own material, and the UVs', r.mats === 2 && r.maps === 1 && r.groups === 2 && r.uv && !r.vertexColors, r);
  await fresh(); await makeGlb('plainA', false); await open(true);
  await evalJS(`(() => { const p = window.state.parts.find(q => q.name === 'plainA'); return true; })()`);
  r = await evalJS(`(async () => { const ids = window.state.parts.filter(p => !p.deleted).map(p => p.partId); await window.__moBridgeTools.duplicate_parts?.({ ids }); return window.state.parts.filter(p => !p.deleted).length; })()`);
  r = await merge(['plainA', ...(await evalJS("window.state.parts.filter(p => !p.deleted && p.name !== 'plainA').map(p => p.name)"))]);
  // (a part and its copy share one material: the merge keeps that material, with no colours on the vertices and no groups. Merge used to
  // swap the parts' materials for one white one with the colours on the vertices, which a GLB of it lost when it was opened again.)
  check('merging plain parts of one material keeps that material', r.mats === 1 && !r.vertexColors && r.groups === 0, r);
  if (errors.length) console.log('page errors:', errors.slice(0, 5));
} catch (e) { console.log('HARNESS ERROR:', e.message); fail++; }
try { ws && ws.close(); } catch (_) {}
chrome.kill();
console.log(fail ? fail + ' failed, ' + pass + ' passed' : 'ok: ' + pass + ' passed');
process.exit(fail ? 1 : 0);
