// node tests/e2e-grid-far.mjs
//
// The floor grid, seen from far away. The grid is a full-screen shader that unprojects every pixel to a ray; with the camera's
// translation inside the inverse matrix, the pixel's part of the sum was rounded away in 32-bit floats once the camera was a few
// hundred metres from the origin, and the two axis lines came out as stairs. The camera is put 300 m (300,000 units) from its
// target in the empty scene and the red and green axis lines are read back from a screenshot: along a clean line the brightest
// pixel moves by at most one row from one column to the next. Needs the app served on http://localhost:4242, Chrome and Node 22+.
// SHOT=file.png saves the screenshot.
import { spawn } from 'child_process';
import fs from 'fs';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9352, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-gridfar-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const DIST = +(process.env.DIST || 300000);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const ready = async () => {
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
};
const attach = async () => {
  let target;
  for (let i = 0; i < 60 && !target; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); target = l.find(t => t.type === 'page'); } catch (_) {} if (!target) await sleep(250); }
  if (!target) throw new Error('Chrome did not start');
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

// Follow one axis line through the middle 70% of the view. Per column (or per row, whichever the line crosses more of) the pixel
// where the line's colour stands out most; then the largest move between neighbouring columns and the longest run of one value.
const TRACE = `(async (b64, want) => {
  const img = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const r = window._appFns.renderer.domElement.getBoundingClientRect();
  const x0 = Math.round(r.left + r.width * 0.15), x1 = Math.round(r.left + r.width * 0.85);
  const y0 = Math.round(r.top + r.height * 0.15), y1 = Math.round(r.top + r.height * 0.85);
  const d = g.getImageData(0, 0, c.width, c.height).data, W = c.width;
  const score = (x, y) => { const i = (y * W + x) * 4, R = d[i], G = d[i + 1], B = d[i + 2]; return want === 'red' ? R - Math.max(G, B) : G - Math.max(R, B); };
  const trace = (alongX) => {
    const out = [];
    for (let a = alongX ? x0 : y0; a <= (alongX ? x1 : y1); a++) {
      let best = 20, at = -1;
      for (let b = alongX ? y0 : x0; b <= (alongX ? y1 : x1); b++) { const s = alongX ? score(a, b) : score(b, a); if (s > best) { best = s; at = b; } }
      out.push(at);
    }
    return out;
  };
  const pick = (t) => { let hits = 0, jump = 0, run = 1, maxRun = 1; for (let i = 0; i < t.length; i++) { if (t[i] < 0) { run = 1; continue; } hits++; if (i && t[i - 1] >= 0) { jump = Math.max(jump, Math.abs(t[i] - t[i - 1])); run = t[i] === t[i - 1] ? run + 1 : 1; maxRun = Math.max(maxRun, run); } } return { hits, jump, maxRun, n: t.length }; };
  const tx = pick(trace(true)), ty = pick(trace(false));
  return tx.hits >= ty.hits ? { along: 'x', ...tx } : { along: 'y', ...ty };
})`;

try {
  await attach();
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  await ready();
  await evalJS("document.getElementById('welcome-close')?.click()");
  await sleep(500);
  const backend = await evalJS("window._appFns.renderer.backend?.constructor?.name || '?'");
  console.log('backend', backend);
  // The camera 300 m from its target, along the empty scene's own view direction (the floor's axes cross the view diagonally).
  const cam = await evalJS(`(() => { const F = window._appFns, c = F.camera, t = F.controls.target; const dir = c.position.clone().sub(t).normalize(); c.position.copy(t).add(dir.multiplyScalar(${DIST})); c.lookAt(t); c.updateMatrixWorld(true); F.requestRender(); return { dist: c.position.distanceTo(t), grid: !!window.state.showGrid }; })()`);
  check('camera is far out and the grid is on', cam.dist > DIST * 0.99 && cam.grid, cam);
  await sleep(2000);
  await evalJS("window._appFns.requestRender(); new Promise(r => setTimeout(r, 800))");
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (process.env.SHOT) fs.writeFileSync(process.env.SHOT, Buffer.from(shot.data, 'base64'));
  for (const axis of ['red', 'green']) {
    const t = await evalJS(`${TRACE}(${JSON.stringify(shot.data)}, '${axis}')`);
    console.log(axis, t);
    check(`${axis} axis line found across the view`, t.hits > t.n * 0.5, t);
    check(`${axis} axis line has no stairs (moves at most one pixel per column)`, t.jump <= 1, t);
  }
  check('no page errors', errors.length === 0, errors);
} catch (e) {
  fail++; console.log('FAIL', e.message || e);
} finally {
  try { ws?.close(); } catch (_) {}
  chrome.kill();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
