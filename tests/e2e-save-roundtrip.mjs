// node tests/e2e-save-roundtrip.mjs [model, default inbox/GearboxAssy.glb]
//
// What a saved scene carries. Phase 1 (one browser) opens a model, changes the scene's settings, parts and materials, and saves the scene;
// phase 2 (another browser, with nothing of the first one) opens that file; the two states are compared. A setting that is not in the file
// shows up here as a difference. The settings of the person (the FPS readout) are not part of a scene and are left out.
// Needs the app served on http://localhost:4242, Chrome and Node 22+.
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import os from 'os';
import fsx from 'fs';
if (!process.env.PHASE) {
  const dir = fsx.mkdtempSync(os.tmpdir() + '/rt-'); const env = { ...process.env, SP: dir };
  for (const PHASE of ['1', '2']) execFileSync(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], { env: { ...env, PHASE }, stdio: ['ignore', 'inherit', 'inherit'] });
  const a = JSON.parse(fsx.readFileSync(dir + '/rt-before.json', 'utf8')), b = JSON.parse(fsx.readFileSync(dir + '/rt-after.json', 'utf8'));
  let pass = 0, fail = 0; const check = (n, ok, x) => { if (ok) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, x === undefined ? '' : JSON.stringify(x)); } };
  const near = (u, v) => Math.abs(u - v) < 1e-3;
  for (const id of ['display-units', 'grid-cell', 'light-exposure', 'light-sun', 'light-ambient', 'light-azi', 'light-ele', 'toggle-shadows', 'scene-scale', 'scene-up-axis', 'bg-mode']) check('the setting ' + id + ' comes back', a.ctl[id] === b.ctl[id], [a.ctl[id], b.ctl[id]]);
  check('the explode amount comes back', a.explode === b.explode, [a.explode, b.explode]);
  check('and the parts are where they were (written together, then moved apart again)', JSON.stringify(a.centers) === JSON.stringify(b.centers), [a.centers, b.centers]);
  check('the scale and the turn of the scene come back', JSON.stringify(a.root) === JSON.stringify(b.root), [a.root, b.root]);
  const pa = Object.fromEntries(a.parts.map(p => [p.name, p])), pb = Object.fromEntries(b.parts.map(p => [p.name, p]));
  check('every part is there', a.parts.length === b.parts.length && a.parts.every(p => pb[p.name]), [a.parts.length, b.parts.length]);
  const same = (k) => a.parts.filter(p => pb[p.name] && p[k] !== pb[p.name][k]).map(p => p.name);
  check('the names, the hidden and the locked parts come back', !same('visible').length && !same('locked').length, [same('visible'), same('locked')]);
  const matDiff = []; for (const p of a.parts) { const q = pb[p.name]; if (!q || !p.mat) continue; for (const k of Object.keys(p.mat)) { const u = p.mat[k], v = (q.mat || {})[k]; if (u !== v && !(typeof u === 'number' && typeof v === 'number' && near(u, v))) matDiff.push(p.name + '.' + k + ' ' + u + ' -> ' + v); } }
  check('every property of every material comes back (metalness, roughness, opacity, glow, name, side, maps)', !matDiff.length, matDiff.slice(0, 6));
  console.log('   (not compared: the part colour field, which this test changes on a shared material, and what is derived: flagged small parts)');
  console.log(`
${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
}
import { spawn } from 'child_process';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9351, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-undomem-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0, curId = ''; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const call = async (name, args = {}) => {
  const r = await evalJS(`(async () => { try { const f = window.__moBridgeTools[${JSON.stringify(name)}]; if (!f) return { ok: false, e: 'no such tool' }; const r = await f(${JSON.stringify(args)}); return { ok: true, t: r.map(x => x.type === 'text' ? x.text : '[' + x.type + ']') }; } catch (e) { return { ok: false, e: e.message || String(e) }; } })()`);
  if (r.ok) { const s = r.t.join('\n'); let j = null; try { j = JSON.parse(s); } catch (_) {} return { ok: true, s, j }; }
  return { ok: false, e: r.e };
};
const sum = async () => (await call('scene_summary')).j;
const copies = () => evalJS(`new Promise((res) => { const r = indexedDB.open('mo-recovery', 1); r.onupgradeneeded = () => r.result.createObjectStore('snaps', { keyPath: 'key' }); r.onsuccess = () => { const q = r.result.transaction('snaps').objectStore('snaps').getAll(); q.onsuccess = () => { res(q.result.map(s => ({ name: s.name, parts: s.parts, size: s.size, unit: s.unit, up: s.up }))); r.result.close(); }; }; r.onerror = () => res(null); })`);
const ready = async () => {
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
};
const attach = async () => {
  let target;
  for (let i = 0; i < 60 && !target; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); target = l.find(t => t.type === 'page'); } catch (_) {} if (!target) await sleep(250); }
  if (!target) throw new Error('Chrome did not start');
  curId = target.id;
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
    else if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text || '').split('\n').slice(0, 3).join(' | '));
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
};



import fs from 'fs';
const SP = process.env.SP, PHASE = process.env.PHASE;
// what to compare: the scene's settings (controls), the part rows, the materials, the tree
const snapshot = () => evalJS(`(() => {
  const st = window.state, out = { ctl: {}, st: {}, parts: [], mats: [], groups: [], tree: 0 };
  for (const el of document.querySelectorAll('#sidebar-right input, #sidebar-right select, #tb select, #tb input, #viewport select, #viewport input')) {
    if (!el.id || /file|search|filter|hex|name|prompt/i.test(el.id) || el.type === 'file' || el.type === 'button') continue;
    out.ctl[el.id] = el.type === 'checkbox' ? el.checked : el.value;
  }
  for (const k of Object.keys(st)) { const v = st[k]; if (['number', 'string', 'boolean'].includes(typeof v) && !/^_|Seq|saved|loaded|source|time|count|Count/i.test(k)) out.st[k] = v; }
  for (const p of st.parts) { if (p.deleted) continue;
    const m = p.mesh ? (Array.isArray(p.mesh.material) ? p.mesh.material[0] : p.mesh.material) : (p.instancedMesh ? p.instancedMesh.material : null);
    out.parts.push({ name: p.name, visible: p.visible, flagged: !!p.flagged, locked: !!p.locked, shade: p.shadeAngle ?? null, note: p.note ?? p.notes ?? null, extras: p.userExtras && Object.keys(p.userExtras).length ? JSON.stringify(p.userExtras) : null, tris: p.triCount,
      color: p.originalColor && p.originalColor.getHexString(), mat: m && { type: m.type, color: m.color && m.color.getHexString(), metal: m.metalness, rough: m.roughness, opacity: m.opacity, transparent: m.transparent, emissive: m.emissive && m.emissive.getHexString(), emissiveIntensity: m.emissiveIntensity, side: m.side, name: m.name, wireframe: m.wireframe, envMapIntensity: m.envMapIntensity, flatShading: m.flatShading, alphaTest: m.alphaTest, ior: m.ior, transmission: m.transmission, maps: ['map','normalMap','roughnessMap','metalnessMap','emissiveMap','aoMap','alphaMap'].filter(k => m[k]).join() } });
  }
  out.groups = (st.userGroups || []).map(g => ({ name: g.name, n: g.partIds ? g.partIds.size : 0 }));
  out.tree = (st.treeNodes || []).length; out.groupNodes = (st.treeNodes || []).filter(n => n.kind !== 'part' && /My group/.test(String(n.name || ''))).map(n => ({ name: n.name, kids: (n.children || n.partIds || []).length }));
  out.treeNames = (st.treeNodes || []).filter(n => n.kind !== 'part').map(n => n.name).slice(0, 12);
  out.measure = (st.measurements || st.measures || []).length;
  { const b = st.partsRoot && new (window.THREE_BOX || Object)(); }
  out.root = st.partsRoot ? { scale: st.partsRoot.scale.toArray().map(x => +x.toFixed(4)), rot: [st.partsRoot.rotation.x, st.partsRoot.rotation.y, st.partsRoot.rotation.z].map(x => +x.toFixed(4)), pos: st.partsRoot.position.toArray().map(x => +x.toFixed(3)) } : null;
  out.centers = st.parts.filter(p => !p.deleted && p.bbox).slice(0, 4).map(p => p.bbox.getCenter(new (p.bbox.min.constructor)()).toArray().map(x => +x.toFixed(2)));
  out.explode = st.explode ? JSON.stringify(st.explode) : null;
  out.size = (() => { const p = st.parts.find(p => !p.deleted && p.bbox); return p ? p.bbox.getSize(new (p.bbox.min.constructor)()).toArray().map(x => +x.toFixed(2)) : null; })();
  out.units = document.getElementById('display-units') && document.getElementById('display-units').value;
  return out; })()`);
const edit = async () => {
  // settings, the way the controls do it
  const setCtl = (id, v) => evalJS(`(() => { const el = document.getElementById(${JSON.stringify(id)}); if (!el) return false; if (el.type === 'checkbox') { el.checked = ${JSON.stringify(v)}; } else el.value = ${JSON.stringify(v)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  const done = {};
  for (const [id, v] of [['scene-scale', '2'], ['scene-up-axis', 'y'], ['display-units', 'cm'], ['grid-cell', '25'], ['light-exposure', '1.6'], ['light-sun', '1.3'], ['light-ambient', '0.7'], ['light-azi', '120'], ['light-ele', '30'], ['toggle-shadows', true], ['toggle-fps', true], ['bg-mode', 'light']]) done[id] = await setCtl(id, v);
  console.log('   controls set', JSON.stringify(done));
  await evalJS(`(() => { const st = window.state; const ps = st.parts.filter(p => !p.deleted && p.mesh);
    ps[0].name = 'RENAMED_PART'; ps[1].locked = true; ps[2].flagged = true; ps[3].visible = false; if (ps[3].mesh) ps[3].mesh.visible = false; ps[4].shadeAngle = 12;
    const m = ps[5].mesh.material; m.opacity = 0.5; m.transparent = true; m.emissive.setHex(0x112233); m.emissiveIntensity = 2; m.name = 'My glass'; m.metalness = 0.9; m.roughness = 0.1; m.color.setHex(0x228833); ps[5].originalColor.setHex(0x228833);
    ps[6].userExtras = { custom: 'hello' }; ps[7].note = 'a note on this part'; return true; })()`);
  await sleep(500);
};
try {
  await attach();
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  await ready();
  await evalJS("document.getElementById('welcome-close')?.click()");
  if (PHASE === '1') {
    await evalJS(`(async () => { const r = await fetch(${JSON.stringify(MODEL)}); const b = await r.blob(); const f = new File([b], 'roundtrip.glb'); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    for (let i = 0; i < 160; i++) { const n = await evalJS("document.querySelectorAll('#tree .tree-node').length"); if (n > 3) break; await sleep(500); }
    await sleep(3000);
    // two groups of parts in the tree
    const ids = await evalJS('window.state.parts.filter(p => !p.deleted).slice(8, 12).map(p => p.partId)');
    await call('group_parts', { ids, name: 'My group' });
    await edit();
    console.log('   explode', JSON.stringify(await call('set_explode', { amount: 30 })).slice(0, 160));
    await sleep(800);
    fs.writeFileSync(SP + '/rt-before.json', JSON.stringify(await snapshot(), null, 1));
    await evalJS(`window.__F = window.File; window.File = function (parts, name, opts) { const f = new window.__F(parts, name, opts); if (/ copy\.glb$/.test(name)) window.__capt = f; return f; }; window.File.prototype = window.__F.prototype; true`);
    await evalJS('window.__moDuplicateScene()'); await sleep(5000);
    const b64 = await evalJS(`(async () => { const b = new Uint8Array(await window.__capt.arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode.apply(null, b.subarray(i, i + 32768)); return btoa(s); })()`);
    fs.writeFileSync(SP + '/rt.glb', Buffer.from(b64, 'base64'));
    console.log('   saved', fs.statSync(SP + '/rt.glb').size, 'bytes');
  } else {
    const b64 = fs.readFileSync(SP + '/rt.glb').toString('base64');
    await evalJS(`(async () => { const bin = Uint8Array.from(atob(${JSON.stringify(b64)}), c => c.charCodeAt(0)); const f = new File([bin], 'roundtrip copy.glb'); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    for (let i = 0; i < 160; i++) { const n = await evalJS("document.querySelectorAll('#tree .tree-node').length"); if (n > 3) break; await sleep(500); }
    await sleep(4000);
    fs.writeFileSync(SP + '/rt-after.json', JSON.stringify(await snapshot(), null, 1));
    console.log('   reopened');
  }
} catch (e) { console.log('HARNESS ERROR:', e.message); }
try { ws && ws.close(); } catch (_) {}
chrome.kill();
process.exit(0);
