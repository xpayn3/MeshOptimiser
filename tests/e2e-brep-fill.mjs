// node tests/e2e-brep-fill.mjs [model.stp]
//
// A STEP part keeps its CAD faces through Remove holes: opens the STEP in the real app in headless Chrome (converted by the server with its
// B-rep), checks the biggest part has CAD faces, runs Remove holes (fill_holes) on it, checks the new geometry still has a record that fits
// its triangles (faces in order, every triangle in one face), then runs Simplify round faces and Remove fillets, which need the CAD faces,
// and checks neither says the part has none. Then undo, and the part is back with its faces. Along the way, the status under CAD lines on the
// Shading card: real CAD edges for the STEP, off when switched off, found by angle for a plain GLB (the app's GearboxAssy sample).
// Default model: the NIST CTC 01 part in inbox/benchmark. Needs the app on http://localhost:4242 (APP_PORT), Chrome, Node 22+.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ROOT = path.resolve(path.dirname(new globalThis.URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const MODEL = process.argv[2] || path.join(ROOT, 'inbox/benchmark/nist/NIST-PMI-STEP-Files/nist_ctc_01_asme1_ap242-e1.stp');
const PORT = 9363, URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(os.tmpdir(), 'cdp-brepfill-' + Date.now())}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 600)); } };
const call = async (name, args = {}) => {
  const r = await ev(`(async () => { try { const r = await window.__moBridgeTools[${JSON.stringify(name)}](${JSON.stringify(args)}); return { ok: true, t: r.map(x => x.type === 'text' ? x.text : '').join('\\n') }; } catch (e) { return { ok: false, e: e.message || String(e) }; } })()`);
  let j = null; if (r.ok) { try { j = JSON.parse(r.t); } catch (_) {} } return { ...r, j };
};
// what the record of a part says: faces, triangles, whether it fits
const recOf = (pid) => ev(`(() => {
  const p = window.state.parts.find(x => x.partId === ${JSON.stringify(pid)}); const g = p && p.mesh && p.mesh.geometry; if (!g) return null;
  const tris = g.index ? g.index.count / 3 : g.attributes.position.count / 3, r = window._Brep.record(g);
  if (!r) return { tris, rec: false };
  let inOrder = true, covered = 0, last = -1, empty = 0;
  for (const f of r.faces) { if (f[1] < last) inOrder = false; last = f[1]; covered += f[2]; if (!f[2]) empty++; }
  return { tris, rec: true, faces: r.faces.length, nonEmpty: r.faces.length - empty, recTris: r.tris, covered, inOrder, rows: r.rows.length, plane: !!window._Brep.planePoly(g) };
})()`);
try {
  let t; for (let i = 0; i < 60 && !t; i++) { try { t = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find(x => x.type === 'page'); } catch (_) {} if (!t) await sleep(500); }
  ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { const p = pend.get(d.id); pend.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); } };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await ev("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1200); await ev("document.getElementById('welcome-close')?.click(); window.__moQuietToasts = true; 1");
  const b64 = fs.readFileSync(MODEL).toString('base64');
  await ev(`(() => { const bin = Uint8Array.from(atob(${JSON.stringify(b64)}), c => c.charCodeAt(0)); window.__moOpenFile(new File([bin], ${JSON.stringify(path.basename(MODEL))})); return 1; })()`);
  for (let i = 0; i < 480; i++) {
    if (await ev("document.getElementById('import-modal')?.classList.contains('show')")) await ev("document.querySelector('#import-modal-confirm').click()");
    if (await ev('window.state.parts.filter(p => !p.deleted).length') > 0 && await ev('!!(window._Brep && window._Brep.info.on)')) break;
    await sleep(500);
  }
  await sleep(2500);
  check('the STEP opened with its CAD faces', await ev('window._Brep.info.on'), await ev('window._Brep.info'));
  const parts = await ev("window.state.parts.filter(p => !p.deleted && p.mesh).map(p => ({ id: p.partId, name: p.name, tris: p.triCount })).sort((a, b) => b.tris - a.tris)");
  const P = parts[0];
  console.log('part', P);
  const status = async () => { await sleep(150); return ev("(() => { const e = document.getElementById('shade-lines-status'); return e ? { kind: e.dataset.kind, text: e.textContent } : null; })()"); };
  const st0 = await status(); console.log('status:', st0);
  check('status: real CAD edges for the STEP', st0 && st0.kind === 'cad' && /CAD edges/.test(st0.text), st0);
  check('one CAD lines switch: on the Shading card, not in the CAD pill or Settings', await ev("!!document.getElementById('shade-outlines') && !document.getElementById('bp-lines') && document.getElementById('shade-outlines-lbl').textContent === 'CAD lines'"));
  await ev("(() => { const c = document.getElementById('shade-outlines'); c.checked = false; c.dispatchEvent(new Event('change')); return 1; })()");
  const stOff = await status(); console.log('status off:', stOff);
  check('status: off when switched off', stOff && stOff.kind === 'off' && /^Off/.test(stOff.text) && await ev("window.state.parts.every(p => !p.mesh || !p.mesh.children.some(c => c.userData && c.userData.cadEdge))"), stOff);
  await ev("(() => { const c = document.getElementById('shade-outlines'); c.checked = true; c.dispatchEvent(new Event('change')); return 1; })()");
  const stOn = await status(); console.log('status on again:', stOn); check('status: back to real CAD edges', stOn && stOn.kind === 'cad', stOn);
  const r0 = await recOf(P.id);
  check('before: the part has a record that fits', r0 && r0.rec && r0.recTris === r0.tris && r0.covered === r0.tris && r0.inOrder, r0);

  const fh = await call('fill_holes', { ids: [P.id], max_hole_mm: 1000 });
  console.log('fill_holes:', (fh.t || fh.e || '').slice(0, 300));
  const r1 = await recOf(P.id);
  check('Remove holes changed the part', fh.ok && r1 && r1.tris !== r0.tris, { r0, r1 });
  check('after Remove holes: the part still has CAD faces', r1 && r1.rec && r1.nonEmpty > 0, r1);
  check('the record fits the new triangles (count, in order, every triangle in one face)', r1 && r1.recTris === r1.tris && r1.covered === r1.tris && r1.inOrder, r1);
  check('some faces went (the holes) and some edges with them', r1 && r1.nonEmpty < r0.nonEmpty && r1.rows < r0.rows, { before: r0, after: r1 });
  check('the plane faces are still known to Remove holes and Untriangulate', r1 && r1.plane, r1);

  const rf = await call('simplify_round_faces', { ids: [P.id] });
  const rfs = rf.t || rf.e || '';
  console.log('simplify_round_faces:', rfs.slice(0, 400));
  check('Simplify round faces does not say the part has no CAD faces', rf.ok && !/no CAD faces/i.test(rfs), rfs.slice(0, 400));
  const r2 = await recOf(P.id);
  check('…and the part still has its faces after it', r2 && r2.rec && r2.nonEmpty > 0 && r2.recTris === r2.tris, r2);

  const df = await call('remove_fillets', { ids: [P.id] });
  const dfs = df.t || df.e || '';
  console.log('remove_fillets:', dfs.slice(0, 400));
  check('Remove fillets does not say the part has no CAD faces', df.ok && !/no CAD faces/i.test(dfs), dfs.slice(0, 400));

  // back to before Remove holes
  for (let i = 0; i < 3; i++) { await call('undo'); await sleep(400); }
  const r3 = await recOf(P.id);
  console.log('after undo:', r3);
  check('undo: the part is back with its triangles and its CAD faces', r3 && r3.tris === r0.tris && r3.rec && r3.nonEmpty === r0.nonEmpty, { r0, r3 });
  // a plain GLB has no CAD data
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await ev("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1200); await ev("document.getElementById('welcome-close')?.click(); window.__moQuietToasts = true; 1");
  const g64 = fs.readFileSync(path.join(ROOT, 'inbox/GearboxAssy.glb')).toString('base64');
  await ev(`(() => { const bin = Uint8Array.from(atob(${JSON.stringify(g64)}), c => c.charCodeAt(0)); window.__moOpenFile(new File([bin], 'GearboxAssy.glb')); return 1; })()`);
  for (let i = 0; i < 120; i++) { if (await ev("document.getElementById('import-modal')?.classList.contains('show')")) await ev("document.querySelector('#import-modal-confirm').click()"); if (await ev('window.state.parts.filter(p => !p.deleted).length') > 0) break; await sleep(500); }
  await sleep(2500);
  const stG = await ev("(() => { const e = document.getElementById('shade-lines-status'); return e ? { kind: e.dataset.kind, text: e.textContent } : null; })()"); console.log('status GLB:', stG);
  check('status: found by angle for a plain GLB', stG && stG.kind === 'angle' && /by angle/.test(stG.text), stG);
} catch (e) { fail++; console.log('HARNESS ERROR', e.stack || e.message); }
try { ws && ws.close(); } catch (_) {}
chrome.kill();
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
