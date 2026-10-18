// The marks Edit mesh draws (points, picked edges and polygons, the piece under the pointer) and the Wireframe view's lines, drawn in
// the real app: screenshots to look at, plus the checks a script can make (no failed frame, no shader error, the marks are in the
// scene and not on the canvas over it).
//   node tests/e2e-edit-marks.mjs [model]          (GPU=1: WebGPU on the graphics card instead of WebGL2 in SwiftShader; SHOTS=<folder> for the pictures)
// Needs the app served on http://localhost:4242, or another port in APP_PORT (the mo-e2e runner uses 4343), Chrome installed and Node 22+.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const GPU = process.env.GPU === '1';
const SHOTS = process.env.SHOTS || path.join(process.env.TEMP || '.', 'mo-edit-marks');
fs.mkdirSync(SHOTS, { recursive: true });
const PORT = 9353, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-marks-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// (WebGPU on the machine's own graphics card: SwiftShader gives headless Chrome no WebGPU adapter here, and three.js then falls back to WebGL)
const flags = GPU ? ['--enable-unsafe-webgpu']
                  : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, ...flags, '--ignore-gpu-blocklist', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [], warns = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const call = async (name, args = {}) => {
  const r = await evalJS(`(async () => { try { const f = window.__moBridgeTools[${JSON.stringify(name)}]; if (!f) return { ok: false, e: 'no such tool' }; const r = await f(${JSON.stringify(args)}); return { ok: true, t: r.map(x => x.type === 'text' ? x.text : '[' + x.type + ']') }; } catch (e) { return { ok: false, e: e.message || String(e) }; } })()`);
  if (r.ok) { const s = r.t.join('\n'); let j = null; try { j = JSON.parse(s); } catch (_) {} return { ok: true, s, j }; }
  return { ok: false, e: r.e };
};
const shot = async (name) => { await sleep(900); const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SHOTS, (GPU ? 'gpu-' : 'gl-') + name + '.png'), Buffer.from(s.data, 'base64')); };
// how many pixels of the canvas laid over the view (where the marks used to be painted) are not empty
const overlayInk = () => evalJS(`(() => { const c = document.getElementById('elem-overlay'); if (!c) return -1; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; })()`);
const marks = () => evalJS('window.__moElements.marks()');
try {
  let target;
  for (let i = 0; i < 60 && !target; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); target = l.find(t => t.type === 'page'); } catch (_) {} if (!target) await sleep(250); }
  if (!target) throw new Error('Chrome did not start');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
    else if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text || '').split('\n').slice(0, 3).join(' | '));
    else if (d.method === 'Runtime.consoleAPICalled' && (d.params.type === 'error' || d.params.type === 'warning')) warns.push(d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await evalJS("document.getElementById('welcome-close')?.click()");
  const backend = await evalJS("(() => { const r = window._appFns && window._appFns.renderer; return r && r.backend ? (r.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL') : '?'; })()");
  check('the renderer is the one asked for (' + (GPU ? 'WebGPU' : 'WebGL') + ')', backend === (GPU ? 'WebGPU' : 'WebGL'), backend);
  await evalJS(`(async () => { const r = await fetch(${JSON.stringify(encodeURI(MODEL))}); const b = await r.blob(); const f = new File([b], ${JSON.stringify(path.basename(MODEL))}); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  for (let i = 0; i < 400; i++) { const n = await evalJS("document.querySelectorAll('#tree .tree-node').length"); if (n > 3) break; await sleep(500); }
  await sleep(4000);

  // ── the Wireframe view, head on and at a steep angle ──
  await call('set_view_mode', { mode: 'wire' }); await sleep(2500);
  await call('set_camera_view', { view: 'front' }); await shot('wire-front');
  await call('set_camera_view', { view: 'perspective' }); await shot('wire-perspective');
  await call('set_view_mode', { mode: 'solid' }); await sleep(800);

  // ── Edit mesh on the biggest part (Points mode showed no points at all on a part of over 20,000 points) ──
  const lp = await call('list_parts', { sort_by: 'triangles', limit: 40 });
  const parts = (lp.j && (lp.j.parts || lp.j)) || [];
  const big = Array.isArray(parts) && parts.length ? parts[0] : null;
  if (big) console.log('  editing', big.name, big.vertices, 'vertices');
  check('a part to edit', !!big, lp.s && lp.s.slice(0, 200));
  if (big) {
    await call('select_parts', { ids: [big.id] });
    await call('frame_selection'); await sleep(1200);
    await evalJS("window.__moElements.mode('points')"); await sleep(1500);
    let m = await marks();
    check('Points mode: the points are sprites in the scene', m && m.dots > 0, m);
    await shot('points');
    // the piece under the pointer: the pointer goes round the middle of the view until it is over the part
    const c0 = await evalJS("(() => { const c = document.getElementById('canvas'); const b = c.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; })()");
    const base = (await marks()).dots;
    let r = c0;
    for (const [dx, dy] of [[0, 0], [40, 0], [-40, 0], [0, 40], [0, -40], [90, 0], [-90, 0], [0, 90], [0, -90], [140, 60], [-140, -60], [60, -140], [-60, 140]]) {
      r = [c0[0] + dx, c0[1] + dy];
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r[0], y: r[1] }); await sleep(500);
      if ((await marks()).dots > base) break;
    }
    m = await marks();
    check('Points mode: the point under the pointer is a dot in the scene', m.dots > base, { base, now: m });
    console.log('  under the pointer (points):', JSON.stringify(m));
    await shot('points-hover');
    await evalJS("window.__moElements.mode('edges')"); await sleep(800);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r[0] + 3, y: r[1] + 2 }); await sleep(800);
    m = await marks();
    console.log('  under the pointer (edges):', JSON.stringify(m));
    await shot('edges-hover');
    check('Edges mode: the edge under the pointer is a wide line in the scene', m.wide > 0, m);
    // every edge of the part picked (Ctrl+A), the pointer moved off it
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 270, y: 120 }); await sleep(400);
    await evalJS("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', ctrlKey: true, bubbles: true }))"); await sleep(900);
    m = await marks();
    check('Edges mode: a picked edge is a wide line in the scene', m && m.wide > 0, m);
    await shot('edges-picked');
    check('nothing painted on the canvas over the view (only the box and the brush are)', (await overlayInk()) <= 0, await overlayInk());
    await evalJS("window.__moElements.mode('faces')"); await sleep(800);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r[0] + 6, y: r[1] + 4 }); await sleep(800);
    m = await marks();
    console.log('  under the pointer (faces):', JSON.stringify(m));
    check('Polygons mode: the polygon under the pointer is a fill in the scene', m.fills > 0, m);
    await shot('faces-hover');
    // ── a move of picked polygons, then Undo: the blue lines and the picked polygons follow the shape back without a click ──
    // (they stayed where the move had left them until the next click or turn of the view)
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 270, y: 120 }); await sleep(300);
    await evalJS("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', ctrlKey: true, bubbles: true }))"); await sleep(600);
    const moved = await evalJS('window.__moElements.nudge(0, 0, 40)'); await sleep(400);
    m = await marks();
    const linesBefore = m.lines, pickedBefore = m.picked;
    console.log('  after the move:', JSON.stringify(m));
    check('a move of the picked polygons is drawn where they went', moved && m.stale === 0, { moved, m });
    await shot('faces-moved');
    const key = async (k, code, vk) => { await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers: 2, key: k, code, windowsVirtualKeyCode: vk }); await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: k, code, windowsVirtualKeyCode: vk }); };
    await key('z', 'KeyZ', 90); await sleep(500);
    m = await marks();
    console.log('  after Ctrl+Z:', JSON.stringify(m));
    check('Ctrl+Z: nothing is left drawn for the moved shape', m.stale === 0, m);
    check('Ctrl+Z: every part keeps its blue lines and its picked polygons', m.lines === linesBefore && m.picked === pickedBefore, { linesBefore, pickedBefore, m });
    await shot('faces-undone');
    await key('y', 'KeyY', 89); await sleep(500);
    m = await marks();
    check('Ctrl+Y: nothing is left drawn for the shape before the move', m.stale === 0, m);
    await evalJS("document.getElementById('btn-undo').click()"); await sleep(500);
    m = await marks();
    console.log('  after the Undo button:', JSON.stringify(m));
    check('the Undo button: nothing is left drawn for the moved shape', m.stale === 0, m);
    check('the Undo button: every part keeps its blue lines', m.lines === linesBefore, { linesBefore, m });
    await call('set_camera_view', { view: 'side' }); await sleep(600);
    await evalJS("window.__moElements.mode('points')"); await sleep(1200);
    await shot('points-side');
    await evalJS("window.__moElements.mode('model')"); await sleep(600);
    m = await marks();
    check('back in Model mode the marks are gone', !m || (m.dots === 0 && m.wide === 0 && m.fills === 0), m);
  }
  const bad = warns.filter(w => /\[render\] frame failed|TSL|WGSL|shader|GLSL|Error/i.test(w));
  check('no failed frame or shader message', bad.length === 0, bad.slice(0, 6));
  check('no exception', errors.length === 0, errors.slice(0, 6));
} catch (e) { console.log('HARNESS ERROR:', e.message); fail++; }
console.log(pass + ' passed, ' + fail + ' failed · pictures in ' + SHOTS);
try { ws && ws.close(); } catch (_) {}
chrome.kill();
process.exit(fail ? 1 : 0);
