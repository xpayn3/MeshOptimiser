// node tests/e2e-undo-memory.mjs [model, default inbox/GearboxAssy.glb]
//
// Remove holes, then Ctrl+Z, again and again, in the real app (headless Chrome): the geometry each pass makes must be freed once nothing
// in the undo or redo history holds it (names like "unt_12_345" were never swept), and Ctrl+Z / Ctrl+Y must wait while a step is still
// running. Needs the app served on http://localhost:4242 (python serve.py --no-browser --port 4242), Chrome installed and Node 22+.
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
const toolMade = () => evalJS(`(() => { const re = /^(?!idx_)[a-z]+(?:_\\d+)+$/i, old = /^(?!idx_)[a-z]+_\\d+$/i; const k = [...window.state.geomByHash.keys()].filter(h => typeof h === 'string'); return { all: window.state.geomByHash.size, made: k.filter(h => re.test(h)).length, oldMatch: k.filter(h => old.test(h)).length, unt: k.filter(h => /^unt_/.test(h)).length, hf: k.filter(h => /^hf_/.test(h)).length, hist: window.state.history.length, redo: window.state.redo.length }; })()`);
try {
  await attach();
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  await ready();
  await evalJS("document.getElementById('welcome-close')?.click()");
  await evalJS(`(async () => { const r = await fetch(${JSON.stringify(MODEL)}); const b = await r.blob(); const f = new File([b], ${JSON.stringify(path.basename(MODEL))}); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  for (let i = 0; i < 160; i++) { const n = await evalJS("document.querySelectorAll('#tree .tree-node').length"); if (n > 3) break; await sleep(500); }
  await sleep(3000);
  const s0 = await sum();
  check('a model is open', s0 && s0.parts > 5, s0);
  const base = await toolMade();
  console.log('   at the start', JSON.stringify(base));

  // ── 1. Remove holes, Ctrl+Z, again, quickly: nothing may pile up for good ──
  const ROUNDS = 6;
  let tris = [];
  for (let i = 0; i < ROUNDS; i++) {
    const r = await call('fill_holes', { max_hole_mm: 30 });
    if (!r.ok) { check('fill_holes round ' + (i + 1), false, r); break; }
    tris.push((await sum()).triangles);
    await call('undo');
  }
  check('every round changed the model', tris.length === ROUNDS && new Set(tris).size >= 1 && tris[0] < s0.triangles, [s0.triangles, tris]);
  check('and Ctrl+Z put it back each time', (await sum()).triangles === s0.triangles, [(await sum()).triangles, s0.triangles]);
  const piled = await toolMade();
  console.log('   straight after the rounds', JSON.stringify(piled));
  check('the rounds left tool-made geometry behind (so there is something to free)', piled.made > base.made, [base, piled]);
  // the sweep looks twice, a few seconds apart, before it frees anything
  let after = piled;
  for (let i = 0; i < 40; i++) { await sleep(1000); after = await toolMade(); if (after.made <= base.made + Math.ceil(piled.made / ROUNDS) + 2) break; }
  console.log('   after waiting', JSON.stringify(after));
  const oneRound = Math.ceil(piled.made / ROUNDS);
  check('what no history entry holds is freed (at most one round is kept for Redo)', after.made <= base.made + oneRound + 2, { base: base.made, oneRound, after: after.made });
  check('no "unt_" geometry of the dropped rounds is left', after.unt <= Math.ceil(piled.unt / ROUNDS) + 1, { before: piled.unt, after: after.unt });
  check('no half-made "hf_" geometry is left', after.hf <= Math.ceil(piled.hf / ROUNDS) + 1, { before: piled.hf, after: after.hf });
  // Redo still works with what was kept
  await call('redo');
  const sRedo = await sum();
  check('Redo still brings the last round back', sRedo.triangles < s0.triangles, [sRedo.triangles, s0.triangles]);
  await call('undo');

  // ── 1b. one run: the geometry the fill makes before the tidy replaces it is let go at once ──
  const orphans = (minSeq = 0) => evalJS(`(() => { const st = window.state, held = new Set(); for (const p of st.parts) if (p.mesh && p.mesh.geometry) held.add(p.mesh.geometry);
    const scan = (v, d) => { if (!v || d > 6 || typeof v !== 'object') return; if (v.isBufferGeometry) { held.add(v); return; } if (v.isObject3D || v.isMaterial || ArrayBuffer.isView(v)) return; for (const k of Object.keys(v)) scan(v[k], d + 1); };
    scan(st.history, 0); scan(st.redo, 0);
    return [...st.geomByHash].filter(([h, g]) => /^hf_/.test(h) && +h.slice(3) > ${minSeq} && !held.has(g)).map(([h, g]) => h + ':' + (g.index ? g.index.count / 3 : 0)).join(' '); })()`);
  let leftover = await orphans();
  for (let i = 0; i < 30 && leftover !== ''; i++) { await sleep(1000); leftover = await orphans(); }      // (the rounds above: the sweep takes its time)
  check('the rounds above are all swept in the end', leftover === '', leftover);
  const seq0 = await evalJS('window.state._decSeq | 0');
  await call('fill_holes', { max_hole_mm: 30 });
  let orph = await orphans(seq0), t1 = Date.now();
  for (let i = 0; i < 20 && orph !== ''; i++) { await sleep(250); orph = await orphans(seq0); }      // (two frames: slow in software rendering)
  console.log('   the half-made geometry went after', orph === '' ? '<=' + (Date.now() - t1 + 250) + ' ms' : 'never');
  check('after one run no "hf_" geometry is left that nothing holds', orph === '', orph);
  await call('undo');

  // ── 2. Ctrl+Z / Ctrl+Y while a step is running wait ──
  await evalJS("window.__t2 = { toasts: 0, histMin: 1e9 }");
  const key = (k) => evalJS(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', ctrlKey: true, bubbles: true, cancelable: true })); true`);
  const hist0 = await evalJS('window.state.history.length');
  // start the step without waiting for it, press Ctrl+Z over and over while it runs
  await evalJS("window.__run = window.__moBridgeTools.fill_holes({ max_hole_mm: 30 }).then(r => { window.__runDone = true; return r; }); window.__runDone = false; true");
  let presses = 0, sawBusy = 0, lowest = 1e9;
  for (let i = 0; i < 400; i++) {
    const done = await evalJS('window.__runDone === true');
    if (done) break;
    await key('z'); presses++;
    const h = await evalJS('window.state.history.length');
    lowest = Math.min(lowest, h);
    const t = await evalJS("[...document.querySelectorAll('.toast, #toasts *')].filter(e => /Wait until the running step has finished/.test(e.textContent || '') && e.children.length === 0).length");
    if (t) sawBusy = Math.max(sawBusy, t);
    await sleep(10);
  }
  await evalJS('window.__run');
  console.log('   presses while it ran:', presses, '| lowest history length:', lowest, '| base:', hist0, '| busy messages seen:', sawBusy);
  check('Ctrl+Z was pressed while the step was running', presses > 0, presses);
  check('it undid nothing while the step ran', lowest >= hist0, { lowest, hist0 });
  check('it said to wait', sawBusy > 0 || presses === 0, { sawBusy });
  const hist1 = await evalJS('window.state.history.length');
  check('the step was recorded', hist1 === hist0 + 1, { hist0, hist1 });
  await key('z'); await sleep(500);
  check('and Ctrl+Z works again once it is done', (await evalJS('window.state.history.length')) === hist0, { now: await evalJS('window.state.history.length'), hist0 });
  check('back to the opened model', (await sum()).triangles === s0.triangles);
} catch (e) { fail++; console.log('HARNESS ERROR:', e.message); }
console.log(`\n${pass} passed, ${fail} failed`);
console.log('page exceptions:', errors.length); errors.slice(0, 12).forEach(e => console.log('  ' + e));
try { ws && ws.close(); } catch (_) {}
chrome.kill();
process.exit(fail ? 1 : 0);
