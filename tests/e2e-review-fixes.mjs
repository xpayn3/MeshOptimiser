// node tests/e2e-review-fixes.mjs
//
// Fixes from the review of 2026-10-21, each on a small scene of its own:
// - Bake transforms on a mirrored part: the part stays the right way out, and undo puts it back as it was;
// - merge_by_colour with no ids merges the selection only, not the whole scene;
// - remove_small_parts leaves a locked part alone;
// - clean_up with duplicates deletes the stacked copy, and one undo takes it back;
// - Close open edges counts the open edges of a part over 60,000 triangles at once (it said "No open edges" while a worker read it);
// - Edit mesh, with the history at its cap: Ctrl+Z after a Delete undoes the Delete, not an older pick.
// - Remesh evenly keeps the colours on the vertices of a part that draws them;
// - Subtract with a mirrored part takes the right half away;
// - a STEP converted through the server writes no XCAF cache, and a cancelled conversion leaves nothing of its own in app/inbox/.
// ONLY=new runs the last three alone.
// Needs the app on http://localhost:4242 (APP_PORT to change it), Chrome, Node 22+.
import { spawn } from 'child_process';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9395, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-reviewfix-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--mute-audio', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--remote-allow-origins=*', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const call = async (name, args = {}) => evalJS(`(async () => { try { const r = await window.__moBridgeTools[${JSON.stringify(name)}](${JSON.stringify(args)}); return { ok: true, r: JSON.stringify(r).slice(0, 600) }; } catch (e) { return { ok: false, e: e.message || String(e) }; } })()`);
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
async function attach() {
  let target;
  for (let i = 0; i < 60 && !target; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); target = l.find(t => t.type === 'page'); } catch (_) {} if (!target) await sleep(250); }
  if (!target) throw new Error('Chrome did not start');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
    else if (d.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});      // ("Leave site?" after an edit: the next scene opens all the same)
    else if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception?.description || '').split('\n').slice(0, 3).join(' | ')); };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
}
// an OBJ of closed boxes: [name, cx, cy, cz, half size]
function boxes(list) {
  const out = []; let base = 0;
  for (const [name, cx, cy, cz, h] of list) {
    out.push('o ' + name);
    for (const [x, y, z] of [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]) out.push(`v ${cx + x * h} ${cy + y * h} ${cz + z * h}`);
    const f = (a, b, c) => out.push(`f ${a + base} ${b + base} ${c + base}`);
    f(1, 3, 2); f(1, 4, 3); f(5, 6, 7); f(5, 7, 8); f(1, 2, 6); f(1, 6, 5); f(2, 3, 7); f(2, 7, 6); f(3, 4, 8); f(3, 8, 7); f(4, 1, 5); f(4, 5, 8);
    base += 8;
  }
  return out.join('\n');
}
// an open dome of N x N squares (its rim is open)
function dome(N) {
  const out = ['o dome'];
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) { const x = (i - N / 2) * 40 / N, z = (j - N / 2) * 40 / N; out.push(`v ${x.toFixed(4)} ${(12 - (x * x + z * z) / 40).toFixed(4)} ${z.toFixed(4)}`); }
  const v = (i, j) => j * (N + 1) + i + 1;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { out.push(`f ${v(i, j)} ${v(i, j + 1)} ${v(i + 1, j)}`); out.push(`f ${v(i + 1, j)} ${v(i, j + 1)} ${v(i + 1, j + 1)}`); }
  return out.join('\n');
}
async function scene(text, name, nParts) {
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1200);
  await evalJS("document.getElementById('welcome-close')?.click()");
  await evalJS(`(async () => { const f = new File([${JSON.stringify(text)}], ${JSON.stringify(name)}); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  for (let i = 0; i < 120; i++) { if (await evalJS("document.getElementById('import-modal')?.classList.contains('show')").catch(() => false)) await evalJS("document.querySelector('#import-modal-confirm')?.click()"); if (await evalJS(`window.state && window.state.parts.filter(p => !p.deleted && p.mesh).length >= ${nParts}`)) break; await sleep(500); }
  await sleep(2000);
}
const idOf = (n) => evalJS(`(window.state.parts.find(p => !p.deleted && p.name === ${JSON.stringify(n)}) || {}).partId`);
const liveCount = () => evalJS("window.state.parts.filter(p => !p.deleted && p.mesh).length");
// the signed volume of a part's own geometry (positive: its triangles face out)
const volume = (pid) => evalJS(`(() => { const p = window.state.parts.find(q => q.partId === ${pid}); const g = p.mesh.geometry, P = g.attributes.position, I = g.index; const n = I ? I.count : P.count; let v = 0; const at = (k) => I ? I.getX(k) : k; for (let k = 0; k + 2 < n; k += 3) { const a = at(k), b = at(k + 1), c = at(k + 2); const ax = P.getX(a), ay = P.getY(a), az = P.getZ(a), bx = P.getX(b), by = P.getY(b), bz = P.getZ(b), cx = P.getX(c), cy = P.getY(c), cz = P.getZ(c); v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx); } return v / 6; })()`);
const det = (pid) => evalJS(`(() => { const p = window.state.parts.find(q => q.partId === ${pid}); p.mesh.updateWorldMatrix(true, false); return p.mesh.matrixWorld.determinant(); })()`);
const tris = (pid) => evalJS(`(() => { const p = window.state.parts.find(q => q.partId === ${pid}); const g = p.mesh.geometry; return (g.index ? g.index.count : g.attributes.position.count) / 3; })()`);

try {
  await attach();
  const ONLY = process.env.ONLY || '';
  let pid, r;      // (ONLY=new: the second half alone)

  if (ONLY !== 'new') {
  // ── Bake transforms on a mirrored part
  await scene(boxes([['mirror', 0, 0, 0, 5]]), 'mirror.obj', 1);
  pid = await idOf('mirror');
  const v0 = await volume(pid);
  await evalJS(`(() => { const p = window.state.parts.find(q => q.partId === ${pid}); p.mesh.scale.x = -1; p.mesh.updateMatrix(); p.mesh.updateMatrixWorld(true); window.state.selected = new Set([${pid}]); return true; })()`);
  const d0 = await det(pid);
  await evalJS("window._appFns._Actions.list.find(a => a.id === 'bakeTransforms').run(); true"); await sleep(800);
  const v1 = await volume(pid), d1 = await det(pid);
  check('Bake: the mirrored part was mirrored before, and is not after (its points carry the mirror)', d0 < 0 && d1 > 0, { d0, d1 });
  check('Bake: the part is still the right way out (its triangles face out)', v0 > 0 && v1 > 0, { v0, v1 });
  await call('undo', {}); await sleep(600);
  const v2 = await volume(pid), d2 = await det(pid);
  check('Bake undone: mirrored again, its own triangles as before', d2 < 0 && v2 > 0 && Math.abs(v2 - v0) < 1e-3 * Math.abs(v0), { v2, d2, v0 });

  // ── merge_by_colour on the selection; remove_small_parts and a locked part
  await scene(boxes([['c1', 0, 0, 0, 5], ['c2', 20, 0, 0, 5], ['c3', 40, 0, 0, 5], ['tiny', 60, 0, 0, 0.5]]), 'four.obj', 4);
  const [c1, c2] = [await idOf('c1'), await idOf('c2')];
  await call('select_parts', { ids: [c1, c2] });
  r = await call('merge_by_colour', {}); await sleep(1200);
  const left = await evalJS("window.state.parts.filter(p => !p.deleted && p.mesh).map(p => p.name)");
  check('merge_by_colour with no ids merges the two selected parts and leaves the others', left.includes('c3') && left.includes('tiny') && !left.includes('c1') && !left.includes('c2') && left.length === 3, { left, r });
  const tiny = await idOf('tiny');
  await call('lock_parts', { ids: [tiny], locked: true });
  r = await call('remove_small_parts', { max_size: 2 }); await sleep(600);
  check('remove_small_parts leaves a locked part alone', (await evalJS(`!!window.state.parts.find(p => p.partId === ${tiny} && !p.deleted)`)), r);

  // ── clean_up: the stacked copy goes, and one undo brings it back
  await scene(boxes([['d1', 0, 0, 0, 5], ['d2', 0, 0, 0, 5], ['other', 30, 0, 0, 5]]), 'dupes.obj', 3);
  const n0 = await liveCount();
  r = await call('clean_up', { duplicates: true, empty: true }); await sleep(1200);
  const n1 = await liveCount();
  await call('undo', {}); await sleep(800);
  const n2 = await liveCount();
  check('clean_up deletes the stacked copy', n0 === 3 && n1 === 2, { n0, n1, r });
  check('clean_up: one undo takes it all back', n2 === 3, { n2 });

  // ── Close open edges on a part over 60,000 triangles
  await scene(dome(180), 'bigdome.obj', 1);
  pid = await idOf('dome');
  const t0 = await tris(pid);
  r = await evalJS(`(() => { const x = window.__moElements.closeOpen({ ids: [${pid}], quiet: true }); return x && typeof x === 'object' ? x : null; })()`);
  check('Close open edges counts the open edges of a part of ' + t0 + ' triangles at once', t0 > 60000 && r && r.open_edges > 0 && r.rims >= 1, r);

  // ── Edit mesh with the history at its cap: Ctrl+Z after Delete undoes the Delete
  await scene(dome(40), 'dome.obj', 1);
  pid = await idOf('dome');
  await call('select_parts', { ids: [pid] }); await call('frame_selection'); await sleep(800);
  // (30 heavy steps under the real ones, as after a long session: each new step then drops one from the front)
  await evalJS("(() => { for (let i = 0; i < 30; i++) window.state.history.unshift({ type: 'decimate', label: 'old', _test: true }); return window.state.history.length; })()");
  await evalJS("window.__moElements.mode('faces'); true"); await sleep(800);
  const box = () => evalJS(`(() => { const r = document.getElementById('canvas').getBoundingClientRect(); return window.__moElements.boxPick(r.left + r.width * .40, r.top + r.height * .40, r.left + r.width * .60, r.top + r.height * .60, 'set'); })()`);
  await box(); await sleep(300);
  await evalJS("window.__moElements.clear(); true"); await sleep(200);
  const picked = await box(); await sleep(300);
  const before = await tris(pid);
  await evalJS("(async () => { const x = window.__moElements.delete(); if (x && x.then) await x; return true; })()"); await sleep(900);
  const afterDel = await tris(pid);
  // Ctrl+Z as a person presses it
  for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, modifiers: 2, key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90 });
  await sleep(1200);
  const afterUndo = await tris(pid);
  check('Edit mesh at the history cap: Delete took ' + picked + ' polygons', picked > 0 && afterDel < before, { picked, before, afterDel });
  check('Edit mesh at the history cap: Ctrl+Z undoes the Delete', afterUndo === before, { before, afterDel, afterUndo });

  }

  // ── a mesh tool keeps the colours on the vertices of a part that draws them
  await scene(boxes([['painted', 0, 0, 0, 5]]), 'painted.obj', 1);
  pid = await idOf('painted');
  await evalJS(`(() => { const p = window.state.parts.find(q => q.partId === ${pid}); const g = p.mesh.geometry, n = g.attributes.position.count, c = new Float32Array(n * 3), BA = g.attributes.position.constructor;
    for (let v = 0; v < n; v++) { const x = g.attributes.position.getX(v); c[v * 3] = x > 0 ? 1 : 0; c[v * 3 + 1] = 0.2; c[v * 3 + 2] = x > 0 ? 0 : 1; }
    g.setAttribute('color', new BA(c, 3)); const M = p.mesh.material.constructor; p.mesh.material = new M({ vertexColors: true }); return true; })()`);
  console.log('remesh:', JSON.stringify(await Promise.race([evalJS(`(async () => { const r = await window.__moAgent.meshOp('remeshEvenly', { ids: [${pid}], quiet: true }); return JSON.stringify(r).slice(0, 300); })()`), sleep(60000).then(() => 'timed out')]))); await sleep(1500);
  r = await evalJS(`(() => { const p = window.state.parts.find(q => q.partId === ${pid}); const g = p.mesh.geometry, c = g.attributes.color; if (!c) return { colours: 0, tris: (g.index ? g.index.count : 0) / 3 }; const s = new Set(); for (let i = 0; i < c.count; i++) s.add(c.getX(i).toFixed(1) + ',' + c.getZ(i).toFixed(1)); return { colours: s.size, count: c.count, verts: g.attributes.position.count, tris: (g.index ? g.index.count : 0) / 3 }; })()`);
  check('Remesh evenly keeps the colours on the vertices (both colours, one a vertex)', r.colours >= 2 && r.count === r.verts, r);

  // ── Subtract a mirrored part
  await scene(boxes([['A', 0, 0, 0, 5], ['B', 5, 0, 0, 5]]), 'ab.obj', 2);
  const [pa, pb] = [await idOf('A'), await idOf('B')];
  // (B mirrored in x: it now stands from -10 to 0, over the left half of A)
  await evalJS(`(() => { const p = window.state.parts.find(q => q.partId === ${pb}); p.mesh.scale.x = -1; p.mesh.updateMatrix(); p.mesh.updateMatrixWorld(true); return true; })()`);
  r = await call('boolean_parts', { op: 'subtract', ids: [pa, pb] }); await sleep(1500);
  const va = await volume(pa);
  check('Subtract a mirrored part: half of A is left (500 mm³ of 1000)', Math.abs(va - 500) < 5, { va, r: r.ok ? 'ok' : r.e });

  // ── a STEP conversion through the server writes no XCAF cache, and a cancelled one leaves nothing in inbox/
  const fs = await import('fs');
  const INBOX = new globalThis.URL('../app/inbox/', import.meta.url);      // (URL is the app's address in this file)
  const jobFiles = (jid) => fs.readdirSync(INBOX).filter(f => f.startsWith(jid + '_'));
  const upload = (cancelAfter, quality = 0.5) => evalJS(`(async () => {
    const b = await (await fetch('/inbox/benchmark/as1/as1-md-214.stp')).blob();
    const res = await fetch('/api/convert?name=part.stp&quality=${quality}&colors=on', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: b });
    const j = await res.json(); if (!j.job_id) return { error: j.error || res.status };
    if (${cancelAfter} >= 0) { await new Promise(r => setTimeout(r, ${cancelAfter})); await fetch('/api/cancel/' + j.job_id, { method: 'POST' }); }
    let st = null; for (let i = 0; i < 240; i++) { st = await (await fetch('/api/job/' + j.job_id)).json(); if (['done', 'error', 'cancelled'].includes(st.status)) break; await new Promise(r => setTimeout(r, 500)); }
    return { job: j.job_id, status: st && st.status, log: (st && st.log || []).filter(l => /xcaf.cache|cached in/i.test(l)).slice(0, 3) };
  })()`);
  r = await upload(-1);
  check('a STEP converts through the server', r.status === 'done', r);
  check('the conversion writes no XCAF cache beside the upload', r.job && !jobFiles(r.job).some(f => /xcaf-cache/.test(f)) && !r.log.some(l => /writing XCAF binary cache/i.test(l)), { files: r.job && jobFiles(r.job), log: r.log });
  r = await upload(60, 0.4321); await sleep(3000);      // (another quality: the server's own cache of converted files does not answer it)
  check('a cancelled conversion leaves nothing of its own in inbox/', r.status === 'cancelled' && r.job && jobFiles(r.job).length === 0, { r, files: r.job && jobFiles(r.job) });

  const errs = errors.filter(e => !/ResizeObserver/.test(e));
  check('no page errors', errs.length === 0, errs.slice(0, 3));
} catch (e) { fail++; console.log('FAIL', e && e.message || e); }
console.log(fail ? fail + ' failed' : 'all passed');
try { chrome.kill(); } catch (_) {}
process.exit(fail ? 1 : 0);
