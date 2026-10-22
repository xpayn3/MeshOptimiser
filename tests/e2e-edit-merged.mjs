// node tests/e2e-edit-merged.mjs
//
// Edit mesh on a merged part of more than 40,000 points: Select all and a box must draw every point and edge they pick. (Both were
// drawn up to 40,000 a part: Select all lit only some points, and a box being dragged seemed to pick and drop lines in it.)
// Three boxes of 60 x 60 squares a side are opened, merged into one part of 64,806 points, and measured.
// Needs the app on http://localhost:4242 (APP_PORT to change it), Chrome, Node 22+.
import { spawn } from 'child_process';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9391, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-mergeedit-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--remote-allow-origins=*', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const call = async (name, args = {}) => evalJS(`(async () => { try { const r = await window.__moBridgeTools[${JSON.stringify(name)}](${JSON.stringify(args)}); return { ok: true, r }; } catch (e) { return { ok: false, e: e.message || String(e) }; } })()`);
const until = async (expr, tries = 40, ms = 250) => { for (let i = 0; i < tries; i++) { if (await evalJS(expr).catch(() => false)) return true; await sleep(ms); } return false; };
async function attach() {
  let target;
  for (let i = 0; i < 60 && !target; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); target = l.find(t => t.type === 'page'); } catch (_) {} if (!target) await sleep(250); }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); } else if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception?.description || '').split('\n').slice(0, 3).join(' | ')); };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
}
// three closed boxes made of grids per side (so polygons pair into quads), one rotated, one mirrored
function model() {
  const out = []; let base = 0;
  const box = (name, f) => {
    out.push('o ' + name); const N = 60, vs = [];
    const add = (p) => { const q = f(p); out.push(`v ${q[0].toFixed(4)} ${q[1].toFixed(4)} ${q[2].toFixed(4)}`); return ++base; };
    for (const [ax, s] of [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]]) {
      const u = (ax + 1) % 3, w = (ax + 2) % 3, g = [];
      for (let j = 0; j <= N; j++) { g.push([]); for (let i = 0; i <= N; i++) { const p = [0, 0, 0]; p[ax] = s * 5; p[u] = -5 + 10 * i / N; p[w] = -5 + 10 * j / N; g[j].push(add(p)); } }
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = g[j][i], b = g[j][i + 1], c = g[j + 1][i], d = g[j + 1][i + 1]; if (s > 0) { out.push(`f ${a} ${b} ${d}`, `f ${a} ${d} ${c}`); } else { out.push(`f ${a} ${d} ${b}`, `f ${a} ${c} ${d}`); } }
    }
  };
  box('a', p => p);
  box('b', p => [p[0] + 14, p[1] * 0.8 + p[2] * 0.6, -p[1] * 0.6 + p[2] * 0.8]);
  box('c', p => [-p[0] - 14, p[1], p[2]]);
  return out.join('\n');
}
const parts = () => evalJS("window.state.parts.filter(p => !p.deleted && p.mesh).map(p => ({ id: p.partId, name: p.name, tris: (p.mesh.geometry.index ? p.mesh.geometry.index.count : p.mesh.geometry.attributes.position.count) / 3, verts: p.mesh.geometry.attributes.position.count }))");
const picked = () => evalJS("window.__moElements.picked().map(x => ({ id: x.partId, points: x.points.length, edges: x.edges.length, faces: x.faces.length }))");
async function measure(label) {
  const out = {};
  for (const m of ['points', 'edges', 'faces']) {
    await evalJS(`window.__moElements.mode(${JSON.stringify(m)}); true`); await sleep(400);
    await evalJS('window.__moElements.clear(); true');
    await evalJS('window.__moElements.selectAll(); true'); await sleep(800);
    const all = await picked(); await sleep(600); const allM = await evalJS('window.__moElements.pickedDrawn()');
    await evalJS('window.__moElements.clear(); true');
    const n = await evalJS(`(() => { const r = document.getElementById('canvas').getBoundingClientRect(); return window.__moElements.boxPick(r.left + 2, r.top + 2, r.right - 2, r.bottom - 2, 'set'); })()`);
    await sleep(400);
    await sleep(600); const bx = await picked(); const bxM = await evalJS('window.__moElements.pickedDrawn()');
    out[m] = { all: all.map(x => x[m]), allDrawn: allM[m], box: bx.map(x => x[m]), boxDrawn: bxM[m] };
  }
  console.log(label, JSON.stringify(out));
  return out;
}
try {
  await attach();
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await evalJS("document.getElementById('welcome-close')?.click()");
  {
    await evalJS(`(async () => { const f = new File([${JSON.stringify(model())}], 'boxes.obj'); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  }
  if (await until("document.getElementById('import-modal').classList.contains('show')", 20)) await evalJS("document.querySelector('#import-modal-confirm')?.click()");
  await until("window.state && window.state.parts.filter(p => !p.deleted && p.mesh).length >= 2", 240, 500);
  await sleep(2500);
  const ps = await parts(); console.log('parts', ps.length, JSON.stringify(ps.slice(0, 5)));
  const ids = ps.slice(0, 3).map(p => p.id);
  await call('select_parts', { ids }); await call('frame_selection'); await sleep(1200);
  await measure('unmerged');
  await evalJS("window.__moElements.mode('model'); true").catch(() => {}); await sleep(600);
  await evalJS('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); true'); await sleep(300);
  await call('select_parts', { ids });
  const mr = await call('merge_parts', { ids }); console.log('merge', JSON.stringify(mr).slice(0, 200));
  await sleep(1500);
  const ps2 = await parts(); console.log('parts after', JSON.stringify(ps2.slice(-2)));
  await call('select_parts', { ids: [ps2[ps2.length - 1].id] }); await call('frame_selection'); await sleep(1200);
  const o = await measure('merged');
  check('merged into one part of 64,806 points', o.points.all.length === 1 && o.points.all[0] === 64806, o.points.all);
  check('Select all: every picked point is drawn', o.points.allDrawn === o.points.all[0], o.points);
  check('box: every picked point is drawn', o.points.boxDrawn === o.points.box[0], o.points);
  check('box: every picked edge is drawn (more than 40,000)', o.edges.box[0] > 40000 && Math.abs(o.edges.boxDrawn - o.edges.box[0]) <= o.edges.box[0] * 0.01, o.edges);
  check('Select all: the edges facing the camera are drawn (more than 40,000)', o.edges.allDrawn > 40000, o.edges);
  const errs = errors.filter(e => !/ResizeObserver/.test(e));
  check('no page errors', errs.length === 0, errs.slice(0, 3));
} catch (e) { fail++; console.log('FAIL', e && e.message || e); }
console.log(fail ? fail + ' failed' : 'all passed');
try { chrome.kill(); } catch (_) {}
process.exit(fail ? 1 : 0);
