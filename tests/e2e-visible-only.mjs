// node tests/e2e-visible-only.mjs
//
// Edit mesh, "Visible only" switch (el-vis): a box over a small box that stands in front of a big one.
// - on (the default): the box takes only what shows (the front of the small box), in Points, Edges and Polygons;
// - off: it takes everything in the box, the back sides and the big box behind too, however the pieces face;
// - the switch is saved, and Select all is not changed by it.
// Needs the app on http://localhost:4242 (APP_PORT to change it), Chrome, Node 22+.
import { spawn } from 'child_process';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9395, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-visonly-' + Date.now();
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
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); } else if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception?.description || '').split('\n').slice(0, 3).join(' | ')); };
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
  // a small box (half size 4) in front of a big one (half size 10), seen from the front
  await scene(boxes([['front', 0, 0, 30, 4], ['back', 0, 0, -30, 10]]), 'two.obj', 2);
  const f = await idOf('front'), b = await idOf('back');
  await call('select_parts', { ids: [f, b] }); await call('frame_selection'); await sleep(800);
  await evalJS("window.__moElements.mode('faces'); true"); await sleep(600);
  const counts = (m) => evalJS(`(() => { const E = window.__moElements; E.mode(${JSON.stringify(m)}); const r = document.getElementById('canvas').getBoundingClientRect();
    const n = E.boxPick(r.left + 2, r.top + 2, r.right - 2, r.bottom - 2, 'set'); const s = E.state ? E.state() : null; return { n, s }; })()`);
  const sw = (on) => evalJS(`window.__moElements.visibleOnly(${on})`);
  check('Visible only is on to begin with', await sw() === true);
  for (const m of ['points', 'edges', 'faces']) {
    await sw(true); await sleep(200);
    const on = (await counts(m)).n; await sleep(300);
    await sw(false); await sleep(200);
    const off = (await counts(m)).n; await sleep(300);
    check(m + ': Visible only off takes more than on (' + on + ' then ' + off + ')', on > 0 && off > on, { on, off });
  }
  // off: every piece of both boxes (12 triangles each, 6 polygons or 12 triangles, 8 corners, 12 or 18 edges: compare with Select all)
  await sw(false);
  for (const m of ['points', 'edges', 'faces']) {
    await evalJS(`window.__moElements.mode(${JSON.stringify(m)}); window.__moElements.clear(); true`); await sleep(200);
    const all = await evalJS("(() => { window.__moElements.selectAll(); return true; })()"); await sleep(300);
    const nAll = await evalJS("(() => { const r = document.getElementById('canvas').getBoundingClientRect(); return window.__moElements.boxPick(r.left + 2, r.top + 2, r.right - 2, r.bottom - 2, 'set'); })()");
    await evalJS("window.__moElements.clear(); true"); await evalJS("window.__moElements.selectAll(); true"); await sleep(300);
    const sel = await evalJS("(() => { const s = window.__moElements; return s.count ? s.count() : -1; })()");
    check(m + ': Visible only off, a box over everything takes ' + nAll + ' pieces (' + (sel >= 0 ? 'Select all ' + sel : 'Select all count not exposed') + ')', nAll > 0 && (sel < 0 || nAll === sel), { nAll, sel });
  }
  // the switch is kept
  await sw(false); await sleep(200);
  const saved = await evalJS("JSON.parse(localStorage.getItem('stepopt-elements') || '{}').visOnly");
  check('the switch is saved (off)', saved === false, saved);
  await sw(true);
  const box = await evalJS("(() => { const c = document.getElementById('el-vis'); return !!c && c.checked; })()");
  check('the checkbox in the bar follows the switch', box === true, box);

  const errs = errors.filter(e => !/ResizeObserver/.test(e));
  check('no page errors', errs.length === 0, errs.slice(0, 3));
} catch (e) { fail++; console.log('FAIL', e && e.message || e); }
console.log(fail ? fail + ' failed' : 'all passed');
try { chrome.kill(); } catch (_) {}
process.exit(fail ? 1 : 0);
