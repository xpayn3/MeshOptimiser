// node tests/e2e-save-recent.mjs [model, default inbox/GearboxAssy.glb]
//
// A saved scene leads Recent and opens from there after the page is loaded again, and the material a saved scene had (metalness,
// roughness) comes back, also for the copies of a shape that are drawn as one instanced mesh. Needs the app served on
// http://localhost:4242 (python app/serve.py --no-browser --port 4242), Chrome installed and Node 22+.
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


const load = async () => {
  await evalJS("document.getElementById('welcome-close')?.click()");
  await evalJS(`(async () => { const r = await fetch(${JSON.stringify(MODEL)}); const b = await r.blob(); const f = new File([b], ${JSON.stringify(path.basename(MODEL))}); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  for (let i = 0; i < 160; i++) { const n = await evalJS("document.querySelectorAll('#tree .tree-node').length"); if (n > 3) break; await sleep(500); }
  await sleep(3000);
};
try {
  await attach();
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  await ready();
  // the file the scene was opened from is in Recent already: the STEP of the same name, with its picture
  await evalJS("localStorage.setItem('stepopt-recents', JSON.stringify([{ id: 'rseed', name: 'my-saved-scene.step', size: 123456, ts: Date.now() - 60000, thumb: 'data:image/png;base64,AAAA' }]))");
  await load();
  const n0 = await evalJS("window.state.parts.filter(p => !p.deleted).length");
  check('a model is open', n0 > 3, n0);

  // the look of the instanced copies, and of one plain part, is changed the way the material editor does it
  const edit = await evalJS(`(() => { const st = window.state; let inst = 0; for (const g of st.instancedGroups) { const m = g.instanced && g.instanced.material; if (m && !Array.isArray(m)) { m.metalness = 0.9; m.roughness = 0.1; inst++; } }
    const p = st.parts.find(p => !p.deleted && p.mesh); if (p) { const m = Array.isArray(p.mesh.material) ? p.mesh.material[0] : p.mesh.material; m.metalness = 0.8; m.roughness = 0.2; m.color.setHex(0x3b1a7a); }      // (the colour as a paint preset sets it: the part's originalColor is left as it was)
    return { inst, groups: st.instancedGroups.length }; })()`);
  console.log('   edited', JSON.stringify(edit));

  // the scene is saved to a blob the way "Duplicate scene" does it, and Recent is told about it the way a save does
  await evalJS(`window.__F = window.File; window.File = function (parts, name, opts) { const f = new window.__F(parts, name, opts); if (/ copy\.glb$/.test(name)) window.__capt = f; return f; }; window.File.prototype = window.__F.prototype; true`);
  await evalJS('window.__moDuplicateScene()');
  await sleep(4000);
  await evalJS('window.File = window.__F; true');
  const size = await evalJS('window.__capt && window.__capt.size');
  check('the scene was written', size > 1000, size);
  const fm = await evalJS(`(async (f) => { const b = await f.arrayBuffer(); const dv = new DataView(b); const jl = dv.getUint32(12, true); const j = JSON.parse(new TextDecoder().decode(new Uint8Array(b, 20, jl))); return (j.materials || []).map(m => (m.pbrMetallicRoughness || {}).metallicFactor); })(window.__capt)`);
  check('the saved file carries metallicFactor 0.8', fm.some(v => Math.abs((v ?? -1) - 0.8) < 0.01), fm);
  const bc = await evalJS(`(async (f) => { const b = await f.arrayBuffer(); const dv = new DataView(b); const jl = dv.getUint32(12, true); const j = JSON.parse(new TextDecoder().decode(new Uint8Array(b, 20, jl))); return (j.materials || []).filter(m => m.pbrMetallicRoughness && Math.abs((m.pbrMetallicRoughness.metallicFactor ?? -1) - 0.8) < 0.01).map(m => m.pbrMetallicRoughness.baseColorFactor); })(window.__capt)`);
  check('and the colour the material has (not the old one of the part): violet 3b1a7a', bc.length > 0 && bc.every(c => c && Math.abs(c[0] - 0.0437) < 0.01 && Math.abs(c[2] - 0.1946) < 0.01), bc);
  await evalJS(`window.__moRememberSaved('my-saved-scene.glb', window.__capt, null)`);
  const rec = await evalJS("JSON.parse(localStorage.getItem('stepopt-recents') || '[]').map(r => r.name)");
  check('Recent lists the saved scene first', rec[0] === 'my-saved-scene.glb', rec);
  check('and not the STEP it came from as a second card of the same model', !rec.includes('my-saved-scene.step') && rec.filter(n => /^my-saved-scene\./.test(n)).length === 1, rec);
  const ent = await evalJS("JSON.parse(localStorage.getItem('stepopt-recents') || '[]')[0]");
  check('the card keeps the picture of the one it replaced and is marked as a scene', ent && ent.thumb === 'data:image/png;base64,AAAA' && ent.saved === true, ent);

  // the page is loaded again: it is still there, and opens
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  await ready();
  await sleep(1500);
  const card = await evalJS("(() => { const c = document.querySelector('#welcome-recents .welcome-recent'); return c ? { name: c.querySelector('.wr-name')?.textContent, sub: c.querySelector('.wr-sub')?.textContent } : null; })()");
  console.log('   first card after a reload', JSON.stringify(card));
  check('after a reload the first card is the saved scene', card && /my-saved-scene/.test(card.name), card);
  check('and it is not called "converted"', card && !/converted/.test(card.sub || ''), card);
  await evalJS("document.querySelector('#welcome-recents .welcome-recent').click()");
  for (let i = 0; i < 120; i++) { await sleep(500); const n = await evalJS("window.state.parts.filter(p => !p.deleted).length"); if (n > 3) { await sleep(2500); break; } }
  const n1 = await evalJS("window.state.parts.filter(p => !p.deleted).length");
  check('the card opens it', n1 === n0, [n0, n1]);

  // the look came back
  const back = await evalJS(`(() => { const st = window.state; const mats = []; for (const g of st.instancedGroups) { const m = g.instanced && g.instanced.material; if (m && !Array.isArray(m)) mats.push(+m.metalness.toFixed(2)); }
    const own = []; for (const p of st.parts) { if (p.deleted || !p.mesh) continue; const m = Array.isArray(p.mesh.material) ? p.mesh.material[0] : p.mesh.material; own.push(+m.metalness.toFixed(2)); }
    return { inst: [...new Set(mats)], plain: [...new Set(own)] }; })()`);
  console.log('   metalness after reopening', JSON.stringify(back));
  if (edit.inst > 0) check('the instanced copies kept metalness 0.9', back.inst.some(v => Math.abs(v - 0.9) < 0.02), back);
  else console.log('   (this model has no instanced shapes: that case was not exercised)');
  check('a plain part kept metalness 0.8', back.plain.some(v => Math.abs(v - 0.8) < 0.02), back);

  // ── repeated shapes: 40 copies of one bolt-like shape, metal, in a file this app saved (its nodes carry soName) ──
  const glb = (() => {
    const pos = new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10]), idx = new Uint16Array([0, 1, 2, 0, 1, 3, 0, 2, 3, 1, 2, 3]);
    const bin = Buffer.concat([Buffer.from(pos.buffer), Buffer.from(idx.buffer)]);
    const nodes = Array.from({ length: 40 }, (_, i) => ({ mesh: 0, name: 'bolt_' + i, translation: [i * 20, 0, 0], extras: { soName: 'bolt ' + i } }));
    const json = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }], nodes,
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
      materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.8, 0.2, 0.2, 1], metallicFactor: 0.9, roughnessFactor: 0.2 }, doubleSided: true }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [0, 0, 0], max: [10, 10, 10] }, { bufferView: 1, componentType: 5123, count: 12, type: 'SCALAR' }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 48 }, { buffer: 0, byteOffset: 48, byteLength: 24 }], buffers: [{ byteLength: bin.length }] };
    let js = Buffer.from(JSON.stringify(json)); while (js.length % 4) js = Buffer.concat([js, Buffer.from(' ')]);
    const head = Buffer.alloc(12); head.write('glTF', 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
    const c1 = Buffer.alloc(8); c1.writeUInt32LE(js.length, 0); c1.write('JSON', 4); const c2 = Buffer.alloc(8); c2.writeUInt32LE(bin.length, 0); c2.writeUInt32LE(0x004E4942, 4);
    return Buffer.concat([head, c1, js, c2, bin]).toString('base64');
  })();
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  await ready();
  await evalJS("document.getElementById('welcome-close')?.click()");
  await evalJS(`(async () => { const bin = Uint8Array.from(atob(${JSON.stringify(glb)}), c => c.charCodeAt(0)); const f = new File([bin], 'bolts.glb'); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  for (let i = 0; i < 60; i++) { await sleep(500); if (await evalJS("window.state.parts.filter(p => !p.deleted).length") >= 40) break; }
  await sleep(1500);
  const bolts = await evalJS(`(() => { const st = window.state; const m = st.instancedGroups.map(g => g.instanced && g.instanced.material).filter(Boolean); return { parts: st.parts.filter(p => !p.deleted).length, groups: st.instancedGroups.length, metal: [...new Set(m.map(x => +x.metalness.toFixed(2)))], rough: [...new Set(m.map(x => +x.roughness.toFixed(2)))] }; })()`);
  console.log('   40 saved bolts', JSON.stringify(bolts));
  check('40 copies became one instanced group', bolts.parts === 40 && bolts.groups === 1, bolts);
  check('the instanced copies keep the file\'s metalness 0.9 and roughness 0.2', bolts.metal.length === 1 && Math.abs(bolts.metal[0] - 0.9) < 0.02 && Math.abs(bolts.rough[0] - 0.2) < 0.02, bolts);
} catch (e) { fail++; console.log('HARNESS ERROR:', e.message); }
console.log(`\n${pass} passed, ${fail} failed`);
console.log('page exceptions:', errors.length); errors.slice(0, 12).forEach(e => console.log('  ' + e));
try { ws && ws.close(); } catch (_) {}
chrome.kill();
process.exit(fail ? 1 : 0);
