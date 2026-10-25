// node tests/e2e-cad-cut.mjs [model.stp]
//
// Remove CAD faces: opens a STEP in the real app in headless Chrome (converted by the server with its B-rep), picks the biggest part,
// finds a hole's wall on it (one or more cylinder faces of one radius, side by side, whose other neighbours are planes: STEP often
// makes a hole of two half cylinders), and in Edit mesh › Polygons with CAD faces on picks it with one click per face (the whole face
// is picked), then removes it with Delete. Checks: the CAD edit pill and card show; the triangles changed in one undo step, the part
// still has a CAD record that fits its triangles, the wall's face has no triangles, its CAD edges went, the surface has no more open
// edges than before; the card's Remesh with nothing picked remeshes the whole part as a step of its own; with Remesh set to Off a
// removal closes the gap and remeshes nothing; undo puts the part back; the pill's click leaves CAD edit.
// Default model: the NIST CTC 01 part in inbox/benchmark. Needs the app on http://localhost:4242 (APP_PORT), Chrome, Node 22+.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ROOT = path.resolve(path.dirname(new globalThis.URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const MODEL = process.argv[2] || path.join(ROOT, 'inbox/benchmark/nist/NIST-PMI-STEP-Files/nist_ctc_01_asme1_ap242-e1.stp');
const PORT = 9364, URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--mute-audio', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(os.tmpdir(), 'cdp-cadcut-' + Date.now())}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 600)); } };
// the part's record, and its open edges once joined by position
const stateOf = (pid, face) => ev(`(() => {
  const p = window.state.parts.find(x => x.partId === ${JSON.stringify(pid)}); const g = p && p.mesh && p.mesh.geometry; if (!g) return null;
  const pa = g.attributes.position, I = g.index ? g.index.array : null, tris = I ? I.length / 3 : pa.count / 3, r = window._Brep.record(g);
  const key = new Map(), idOf = (v) => { const k = pa.getX(v).toFixed(4) + ',' + pa.getY(v).toFixed(4) + ',' + pa.getZ(v).toFixed(4); let c = key.get(k); if (c === undefined) { c = key.size; key.set(k, c); } return c; };
  const edges = new Map();
  for (let t = 0; t < tris; t++) for (let k = 0; k < 3; k++) { const a = idOf(I ? I[t * 3 + k] : t * 3 + k), b = idOf(I ? I[t * 3 + (k + 1) % 3] : t * 3 + (k + 1) % 3); if (a === b) continue; const e = a < b ? a + ',' + b : b + ',' + a; edges.set(e, (edges.get(e) || 0) + 1); }
  let open = 0; for (const n of edges.values()) if (n === 1) open++;
  if (!r) return { tris, rec: false, open };
  let at = 0, fits = true; for (const f of r.faces) { if (f[2] && f[1] !== at) fits = false; at += f[2]; }
  return { tris, rec: true, fits: fits && at === tris && r.tris === tris, faces: r.faces.length, rows: r.rows.length, faceTris: ${face == null ? 'null' : 'r.faces[' + face + '] ? r.faces[' + face + '][2] : null'}, rowsOfFace: ${face == null ? 0 : 'r.rows.filter(x => x[3] === ' + face + ' || x[4] === ' + face + ').length'}, open, hist: window.state.history.length };
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
  check('the STEP opened with its CAD faces', await ev('window._Brep.info.on'));
  const P = (await ev("window.state.parts.filter(p => !p.deleted && p.mesh && window._Brep.record(p.mesh.geometry)).map(p => ({ id: p.partId, name: p.name, tris: p.triCount })).sort((a, b) => b.tris - a.tris)"))[0];
  console.log('part', P);
  // a hole's wall: the cylinder faces of one radius that touch each other, whose other neighbours are all planes (two of them,
  // the top and the bottom); the smallest such wall
  const hole = await ev(`(() => {
    const p = window.state.parts.find(x => x.partId === ${JSON.stringify(P.id)}), g = p.mesh.geometry, r = window._Brep.record(g), kinds = window._Brep.info.kinds;
    const cyl = kinds.indexOf('cylinder'), plane = kinds.indexOf('plane'), nbOf = (i) => { const nb = new Set(); for (const x of r.rows) { if (x[3] === i && x[4] !== i) nb.add(x[4]); if (x[4] === i && x[3] !== i) nb.add(x[3]); } return nb; };
    const same = (i, j) => r.faces[j] && r.faces[j][0] === cyl && Math.abs((r.faces[j][4] || 0) - (r.faces[i][4] || 0)) < 1e-6 * Math.max(1, r.faces[i][4] || 0);
    const seen = new Set(), best = [];
    r.faces.forEach((f, i) => {
      if (f[0] !== cyl || !f[2] || seen.has(i)) return;
      const wall = [i], todo = [i]; seen.add(i);
      while (todo.length) { const a = todo.pop(); for (const n of nbOf(a)) if (n >= 0 && !seen.has(n) && same(i, n)) { seen.add(n); wall.push(n); todo.push(n); } }
      const others = new Set(); for (const a of wall) for (const n of nbOf(a)) if (!wall.includes(n)) others.add(n);
      if (others.size === 2 && [...others].every(n => n >= 0 && r.faces[n][0] === plane) && wall.every(a => r.faces[a][2])) best.push([wall.reduce((s, a) => s + r.faces[a][3], 0), wall]);
    });
    best.sort((a, b) => a[0] - b[0]);
    if (!best.length) return { none: true, faces: r.faces.length, kinds: r.faces.reduce((m, f) => { m[kinds[f[0]]] = (m[kinds[f[0]]] || 0) + 1; return m; }, {}) };
    const pa = g.attributes.position, I = g.index.array;
    const picks = best[0][1].map(i => { const f = r.faces[i], tri = f[1], pt = [0, 0, 0]; for (let k = 0; k < 3; k++) { const v = I[tri * 3 + k]; pt[0] += pa.getX(v) / 3; pt[1] += pa.getY(v) / 3; pt[2] += pa.getZ(v) / 3; } return { face: i, tri, pt, tris: f[2] }; });
    return { face: picks[0].face, picks, tris: picks.reduce((s, x) => s + x.tris, 0), area: best[0][0], count: best.length };
  })()`);
  console.log('hole wall', hole);
  check('the part has a hole wall to take out', hole && !hole.none, hole);
  const s0 = await stateOf(P.id, hole.face);
  console.log('before', s0);
  // Edit mesh, Polygons, CAD faces on, one click on the wall
  await ev(`(() => { window.state.selected.clear(); window.state.selected.add(${JSON.stringify(P.id)}); return 1; })()`);
  await ev("(() => { window.__moElements.mode('faces'); return 1; })()"); await sleep(600);
  check('Edit mesh is on, in Polygons mode', await ev("window.__moElements.mode() === 'faces'"));
  await ev("window.__moElements.cadFaces(true)");
  check('the CAD faces toggle shows in Polygons mode, on, in the tools bar (and only once)', await ev("!document.getElementById('el-cad-btn').hidden && document.getElementById('el-cad').checked && document.querySelectorAll('#el-cad').length === 1 && !document.getElementById('btn-el-cadcut')"));
  const shown = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && !e.hidden && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0; })()`;
  check('the CAD edit pill shows at the top', await ev(shown('#vp-cadedit-pill')) && /CAD edit/.test(await ev("document.getElementById('vp-cadedit-pill').textContent")));
  check('the CAD edit card shows at the bottom left, its settings in it', await ev(shown('#el-cad-pane')) && await ev("document.getElementById('el-card-title').textContent === 'CAD edit' && !!document.getElementById('el-cad-close') && !!document.getElementById('el-cad-scope') && !!document.getElementById('el-cad-len') && !!document.getElementById('el-cad-rounds')"));
  await ev("window.__moElements.cadSettings({ close: 'smooth', scope: 'local', rings: 1, length: 0, rounds: 5 })");
  const pickHole = async () => { let k = 0, m = 0; for (const x of hole.picks) m = await ev(`window.__moElements.pickAt(${JSON.stringify(P.id)}, ${x.tri}, ${JSON.stringify(x.pt)}, { cad: true, add: ${k++ > 0} })`); return m; };
  const n = await pickHole();
  const pickedTris = await ev(`(() => { const R = window.__moElements.read(${JSON.stringify(P.id)}), x = window.__moElements.picked()[0]; let t = 0; for (const q of x.faces) t += R.pg.pStart[q + 1] - R.pg.pStart[q]; return t; })()`);
  check('one click a face picks the whole CAD face', n > 1 && pickedTris >= hole.tris, { polygons: n, pickedTris, faceTris: hole.tris, faces: hole.picks.length });
  const info = await ev("document.getElementById('el-cad-info').textContent");
  check('the card counts the picked CAD faces, Remove is on', new RegExp('^' + hole.picks.length + ' CAD face').test(info) && await ev("!document.getElementById('btn-el-cad-remove').disabled"), info);
  const res = await ev("(async () => { const r = await window.__moElements.delete(); return r && { parts: r.parts, results: r.results }; })()");      // (Delete, with CAD faces on)
  console.log('remove:', JSON.stringify(res).slice(0, 500));
  const s1 = await stateOf(P.id, hole.face);
  console.log('after', s1);
  check('Remove CAD faces changed the part, in one undo step', res && res.parts === 1 && s1.tris !== s0.tris && s1.hist === s0.hist + 1, { s0, s1 });
  check('the part still has CAD faces, and the record fits its triangles', s1.rec && s1.fits && s1.faces >= s0.faces, s1);
  check('the wall\'s face has no triangles, its CAD edges went', s1.faceTris === 0 && s1.rowsOfFace === 0, s1);
  check('no more open edges than before (the hole is closed)', s1.open <= s0.open, { before: s0.open, after: s1.open });
  check('the summary says the two rims were closed and remeshed', res && /2 gaps closed/.test(res.results[0].summary || '') && /remeshed round the cut/.test(res.results[0].summary || ''), res && res.results[0]);
  check('no card of the mesh tools opened (the settings are in the CAD edit card)', !(await ev("(() => { const c = document.querySelector('.section-cmd[data-cmd=\"meshop\"]'); return !!c && !c.hidden; })()")));
  // Remesh when asked, with nothing picked: the whole part, a step of its own
  const rm = await ev("(async () => { document.getElementById('btn-el-cad-remesh').click(); await new Promise(r => setTimeout(r, 300)); for (let i = 0; i < 480 && window.__moAgent.meshOpBusy(); i++) await new Promise(r => setTimeout(r, 250)); return document.getElementById('el-cad-info').textContent; })()");
  await sleep(500);
  const s2 = await stateOf(P.id, hole.face);
  console.log('remesh:', rm, s2);
  check('Remesh with nothing picked: the whole part, a step of its own, the record fitting', s2.hist === s1.hist + 1 && s2.tris !== s1.tris && s2.rec && s2.fits && s2.faceTris === 0 && /whole part remeshed/.test(rm), { s2, rm });
  check('…no more open edges than before, and about as many triangles as it had (not the cut\'s short edge)', s2.open <= s0.open && s2.tris <= 3 * s1.tris, { before: s1.tris, after: s2.tris, open: s2.open });
  for (let i = 0; i < 2; i++) { await ev("(async () => { await window.__moBridgeTools.undo({}); return 1; })()"); await sleep(800); }
  const s3 = await stateOf(P.id, hole.face);
  check('undo twice: the part is back as it was, with its CAD faces', s3.tris === s0.tris && s3.rec && s3.faceTris === hole.picks[0].tris, { s0, s3 });
  // Remesh Off: the removal closes the gap and remeshes nothing
  await ev("window.__moElements.cadSettings({ scope: 'none' })");
  await pickHole();
  const res2 = await ev("(async () => { const r = await window.__moElements.delete(); return r && { parts: r.parts, results: r.results }; })()");
  const s4 = await stateOf(P.id, hole.face);
  console.log('off:', res2 && res2.results[0].summary, s4);
  check('Remesh Off: the wall goes and the gaps close, nothing remeshed (only the patches added)', res2 && res2.parts === 1 && /not remeshed/.test(res2.results[0].summary) && s4.faceTris === 0 && s4.open <= s0.open && s4.tris < s1.tris && s4.fits, { s1: s1.tris, s4 });
  await ev("(async () => { await window.__moBridgeTools.undo({}); return 1; })()"); await sleep(800);
  await ev("window.__moElements.cadSettings({ scope: 'local' })");
  // the pill's click leaves CAD edit
  await ev("document.getElementById('vp-cadedit-pill').click()"); await sleep(200);
  check('the pill\'s click leaves CAD edit: the pill and the card go, the toggle is off', !(await ev(shown('#vp-cadedit-pill'))) && !(await ev(shown('#el-cad-pane'))) && !(await ev("document.getElementById('el-cad').checked")) && await ev("window.__moElements.mode() === 'faces'"));
} catch (e) { fail++; console.log('HARNESS ERROR', e.stack || e.message); }
try { ws && ws.close(); } catch (_) {}
chrome.kill();
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
