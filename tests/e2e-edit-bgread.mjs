// node tests/e2e-edit-bgread.mjs
//
// Edit mesh reads a part of more than 60,000 triangles on a worker, from the moment it first draws it (read on the page, a part of two and
// a half million triangles held everything up for three seconds at the first click). Three plates of 204,800 triangles each, in one
// GLB written here: entering Points mode on the first does not hold the page up, its points show when the worker has answered, and
// the worker's reading is the same as one made on the page (meshedit.js). On a plate not read yet, a click, a box and Pick all made
// at once are made when it has been read. Needs the app served on http://localhost:4242, Chrome and Node 22+.
import { spawn } from 'child_process';
import fs from 'fs';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9375, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-bgread-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const GFX = process.env.GPU ? ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, ...GFX, '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [], toasts = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const call = async (name, args = {}) => evalJS(`(async () => { try { await window.__moBridgeTools[${JSON.stringify(name)}](${JSON.stringify(args)}); return { ok: true }; } catch (e) { return { ok: false, e: e.message || String(e) }; } })()`);
const until = async (expr, tries = 40, ms = 250) => { for (let i = 0; i < tries; i++) { if (await evalJS(expr).catch(() => false)) return true; await sleep(ms); } return false; };
const attach = async () => {
  let target;
  for (let i = 0; i < 60 && !target; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); target = l.find(t => t.type === 'page'); } catch (_) {} if (!target) await sleep(250); }
  if (!target) throw new Error('Chrome did not start');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
    else if (d.method === 'Runtime.consoleAPICalled' && /\[gpu\]|buffer slot|GPUBuffer|not found on geometry|after read/i.test((d.params.args || []).map(a => a.value).join(' '))) errors.push('console: ' + (d.params.args || []).map(a => a.value).join(' ').slice(0, 200));
    else if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text || '').split('\n').slice(0, 3).join(' | '));
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
};

// three plates of N × N squares in one GLB, side by side, gently waved
function glb(file, N = 320) {
  const V = (N + 1) * (N + 1), meshes = [], nodes = [], views = [], accs = [], bins = [];
  let off = 0;
  for (let m = 0; m < 3; m++) {
    const pos = new Float32Array(V * 3), idx = new Uint32Array(N * N * 6);
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) { const k = (j * (N + 1) + i) * 3; pos[k] = i * 0.5 + m * (N * 0.5 + 40); pos[k + 1] = Math.sin(i / 17 + m) * Math.cos(j / 23) * 4; pos[k + 2] = j * 0.5; }
    let o = 0; for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1; idx.set([a, c, b, b, c, d], o); o += 6; }
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < V; k++) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], pos[k * 3 + a]); mx[a] = Math.max(mx[a], pos[k * 3 + a]); }
    views.push({ buffer: 0, byteOffset: off, byteLength: pos.byteLength, target: 34962 }); off += pos.byteLength; bins.push(Buffer.from(pos.buffer));
    views.push({ buffer: 0, byteOffset: off, byteLength: idx.byteLength, target: 34963 }); off += idx.byteLength; bins.push(Buffer.from(idx.buffer));
    accs.push({ bufferView: m * 2, componentType: 5126, count: V, type: 'VEC3', min: mn, max: mx }, { bufferView: m * 2 + 1, componentType: 5125, count: idx.length, type: 'SCALAR' });
    meshes.push({ name: 'plate' + (m + 1), primitives: [{ attributes: { POSITION: m * 2 }, indices: m * 2 + 1 }] });
    nodes.push({ mesh: m, name: 'plate' + (m + 1) });
  }
  const bin = Buffer.concat(bins);
  const json = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0, 1, 2] }], nodes, meshes, buffers: [{ byteLength: bin.length }], bufferViews: views, accessors: accs };
  let js = Buffer.from(JSON.stringify(json)); js = Buffer.concat([js, Buffer.alloc((4 - js.length % 4) % 4, 0x20)]);
  const head = Buffer.alloc(12); head.writeUInt32LE(0x46546C67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
  const ch = (t, b) => { const h = Buffer.alloc(8); h.writeUInt32LE(b.length, 0); h.writeUInt32LE(t, 4); return Buffer.concat([h, b]); };
  fs.writeFileSync(file, Buffer.concat([head, ch(0x4E4F534A, js), ch(0x004E4942, bin)]));
}
const partOf = (name) => `window.state.parts.find(p => !p.deleted && p.mesh && p.name === '${name}')`;
const select = async (name) => { await evalJS(`(() => { const p = ${partOf(name)}; window.state.selected.clear(); return true; })()`); await call('select_parts', { name_contains: name }); await call('frame_selection'); await sleep(900); };
const isRead = (name) => `!!window.__moElements.read(${partOf(name)}.partId)`;
// how long the page takes to draw a frame from now (the page is not held up when this is short)
const FRAME = `new Promise(r => { const t = performance.now(); requestAnimationFrame(() => r(Math.round(performance.now() - t))); })`;

try {
  const file = (process.env.TEMP || '.') + '/mo-bgread-plates.glb';
  glb(file);
  await attach();
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await evalJS("document.getElementById('welcome-close')?.click()");
  const o = await call('open_file', { path: file.replace(/\\/g, '/') });
  check('the plates opened', o.ok && await until("window.state && window.state.parts.filter(p => !p.deleted && p.mesh).length === 3", 120, 500), o);
  await sleep(2500);
  check('the workers are there', await evalJS('!!(window.__moElements && true)'));

  // ── Points mode on plate1: the page is not held up, the points come when it has been read ──
  await select('plate1');
  const t0 = Date.now();
  // (asked in the same step that enters the mode: on the software renderer two frames take as long as the worker does)
  const notRead = await evalJS(`(() => { window.__moElements.mode('points'); return !window.__moElements.read(${partOf('plate1')}.partId); })()`);
  const f0 = await evalJS(FRAME), f1 = await evalJS(FRAME);
  check('entering Points mode does not hold the page up', f0 < 400 && f1 < 400, { f0, f1 });
  check('the plate is being read, not read on the page', notRead);
  const came = await until(isRead('plate1'), 120, 100);
  check('the worker\'s reading arrives', came, Date.now() - t0);
  check('its points show', await until("window.__moElements.marks().dots > 50000", 40, 150), await evalJS('window.__moElements.marks()'));
  // the worker's reading against one made on the page
  const cmp = await evalJS(`(async () => {
    const MEDIT = await import('/js/meshedit.js?v=6');
    const p = ${partOf('plate1')}, g = p.mesh.geometry, P = g.attributes.position.array, ix = g.index.array;
    const R = window.__moElements.read(p.partId), T = MEDIT.buildTopology(P, ix), q = MEDIT.pairQuads(T), pg = MEDIT.buildPolygons(T, q.polyOf, q.count);
    const same = (a, b) => { if (!a || !b || a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
    const near = (a, b) => { if (!a || !b || a.length !== b.length) return 1; let d = 0; for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i])); return d; };
    return {
      key: R.key, counts: [R.topo.nVert, T.nVert, R.topo.nEdge, T.nEdge, R.pg.count, pg.count],
      topo: ['weld', 'tri', 'edgeV', 'edgeT', 'triE', 'kind', 'vStart', 'vEdges', 'region'].filter(k => !same(R.topo[k], T[k])),
      normal: near(R.topo.normal, T.normal), pg: ['polyOf', 'pStart', 'pTris', 'oStart', 'oEdges', 'real'].filter(k => !same(R.pg[k], pg[k])),
      lines: same(R.lines, MEDIT.outlineLines(T, pg)), corner: same(R.corner, MEDIT.outlinePoints(T, pg)),
      slope: near(R.slope, MEDIT.lineSlopes(T)), own: R.topo.positions === P && R.topo.index === ix,
    };
  })()`);
  check('the worker\'s reading is the page\'s', cmp.key === 'quads' && cmp.counts[0] === cmp.counts[1] && cmp.counts[2] === cmp.counts[3] && cmp.counts[4] === cmp.counts[5] && !cmp.topo.length && !cmp.pg.length && cmp.normal === 0 && cmp.lines && cmp.corner && cmp.slope === 0 && cmp.own, cmp);

  // ── a click on plate2 while it is being read: made when it has been read ──
  // (framed in Model mode, where nothing is read; the click comes at once after Polygons mode is entered)
  await evalJS("window.__moElements.mode('model'); true");
  await select('plate2');
  await evalJS("window.__moElements.mode('faces'); true");
  check('plate2 is not read yet', !(await evalJS(isRead('plate2'))));
  const c = await evalJS("(() => { const r = document.getElementById('canvas').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()");
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c[0], y: c[1] });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c[0], y: c[1], button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c[0], y: c[1], button: 'left', buttons: 0, clickCount: 1 });
  const early = await evalJS("window.__moElements.count('faces')");
  check('a click on plate2 while it is read picks a polygon when it has been read', await until("window.__moElements.count('faces') === 1", 120, 100), { early, now: await evalJS("window.__moElements.count('faces')") });

  // ── Pick all on plate3 while it is being read ──
  await evalJS("window.__moElements.clear(); window.__moElements.mode('model'); true");
  await select('plate3');
  const notYet = await evalJS(`(() => { window.__moElements.mode('faces'); const p = ${partOf('plate3')}; const was = !!window.__moElements.read(p.partId); window.__moElements.selectAll(); return !was; })()`);
  check('plate3 is not read yet', notYet);
  check('Pick all on plate3 while it is read picks every polygon when it has been read', await until("window.__moElements.count('faces') === 102400", 120, 100), await evalJS("window.__moElements.count('faces')"));

  // ── a box over plate1 in a new shape (moved: read again) — a box made while it is read ──
  await evalJS("window.__moElements.clear(); window.__moElements.mode('model'); true");
  await select('plate1');
  await evalJS(`(() => { const p = ${partOf('plate1')}, g = p.mesh.geometry.clone(); p.mesh.geometry = g; return true; })()`);      // (a geometry nothing has read)
  await evalJS("window.__moElements.mode('edges'); window.__moElements.tool('rect'); true");
  await sleep(50);
  const reading = !(await evalJS(isRead('plate1')));
  const r = await evalJS("(() => { const b = document.getElementById('canvas').getBoundingClientRect(); return [b.left + b.width * .45, b.top + b.height * .45, b.left + b.width * .55, b.top + b.height * .55]; })()");
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r[0], y: r[1] });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r[0], y: r[1], button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 6; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r[0] + (r[2] - r[0]) * i / 6, y: r[1] + (r[3] - r[1]) * i / 6, button: 'left', buttons: 1 }); await sleep(30); }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r[2], y: r[3], button: 'left', buttons: 0, clickCount: 1 });
  check('a box over a part being read picks its edges when it has been read', reading && await until("window.__moElements.count('edges') > 100", 120, 100), { reading, n: await evalJS("window.__moElements.count('edges')") });
  check('no page errors', errors.length === 0, errors.slice(0, 3));
} catch (e) { fail++; console.log('HARNESS ERROR', e); }
finally { console.log(`${pass} passed, ${fail} failed`); try { chrome.kill(); } catch (_) {} process.exit(fail ? 1 : 0); }
