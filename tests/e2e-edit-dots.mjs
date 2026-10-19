// node tests/e2e-edit-dots.mjs
//
// Edit mesh, Points mode: the dots of a part do not show through another part standing in front of it. A ring (a cylinder seen
// end-on, so its side is edge-on to the camera) sits behind a cover; the ring is put in Points mode and the cover's middle is read
// back from a screenshot: the dark pixels there must be those of the cover alone (a second screenshot, with Edit mesh off, says how
// many that is). Needs the app served on http://localhost:4242, Chrome and Node 22+. SHOT=file.png saves the first screenshot.
import { spawn } from 'child_process';
import fs from 'fs';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9354, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-editdots-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// GPU=1 runs on the real graphics card (WebGPU); without it, on swiftshader (WebGL2).
const GFX = process.env.GPU ? ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, ...GFX, '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const call = async (name, args = {}) => evalJS(`(async () => { try { const r = await window.__moBridgeTools[${JSON.stringify(name)}](${JSON.stringify(args)}); return { ok: true, t: r.map(x => x.type === 'text' ? x.text : '[' + x.type + ']').join('\\n') }; } catch (e) { return { ok: false, e: e.message || String(e) }; } })()`);
const until = async (expr, tries = 40, ms = 250) => { for (let i = 0; i < tries; i++) { if (await evalJS(expr).catch(() => false)) return true; await sleep(ms); } return false; };
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

// An OBJ with two parts: a ring (a cylinder, radius 6, 64 segments, from y 2 to y 12, with its caps) and a cover (a plate 20 wide,
// 2 thick, across y -1 to 1) in front of it. Seen along y, the ring's side is edge-on and its rims lie just behind the cover.
function model() {
  const out = []; let base = 0;
  const N = 64, R = 6, Y0 = 2, Y1 = 12;
  out.push('o ring');
  for (let i = 0; i < N; i++) { const a = i / N * Math.PI * 2, x = (R * Math.cos(a)).toFixed(4), z = (R * Math.sin(a)).toFixed(4); out.push(`v ${x} ${Y0} ${z}`); out.push(`v ${x} ${Y1} ${z}`); }
  out.push(`v 0 ${Y0} 0`); out.push(`v 0 ${Y1} 0`);
  const cb = 2 * N + 1, ct = 2 * N + 2;
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N, b0 = 2 * i + 1, t0 = 2 * i + 2, b1 = 2 * j + 1, t1 = 2 * j + 2;
    out.push(`f ${b0} ${b1} ${t1}`); out.push(`f ${b0} ${t1} ${t0}`);
    out.push(`f ${cb} ${b1} ${b0}`); out.push(`f ${ct} ${t0} ${t1}`);
  }
  base = 2 * N + 2;
  out.push('o cover');
  const x0 = -10, y0 = -1, z0 = -10, sx = 20, sy = 2, sz = 20;
  for (const q of [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]]) out.push('v ' + (x0 + q[0] * sx) + ' ' + (y0 + q[1] * sy) + ' ' + (z0 + q[2] * sz));
  for (const f of [[1,3,2],[1,4,3],[5,6,7],[5,7,8],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,4,8],[3,8,7],[4,1,5],[4,5,8]]) out.push('f ' + f.map(k => k + base).join(' '));
  return out.join('\n');
}
// The camera 150 units in front of the cover (along its thin axis, on the side away from the ring), looking at the ring.
const AIM = `(() => {
  const F = window._appFns, THREE = F.THREE, parts = window.state.parts.filter(p => !p.deleted && p.mesh);
  const ring = parts.find(p => /ring/i.test(p.name)), cover = parts.find(p => /cover/i.test(p.name));
  if (!ring || !cover) return null;
  const bc = new THREE.Box3().setFromObject(cover.mesh), br = new THREE.Box3().setFromObject(ring.mesh);
  const sz = bc.getSize(new THREE.Vector3()), cc = bc.getCenter(new THREE.Vector3()), cr = br.getCenter(new THREE.Vector3());
  const k = ['x', 'y', 'z'].reduce((a, b) => sz[a] <= sz[b] ? a : b);
  const dir = new THREE.Vector3(); dir[k] = Math.sign(cc[k] - cr[k]) || -1;
  F.camera.up.set(0, 0, 1); if (k === 'z') F.camera.up.set(0, 1, 0);
  F.camera.position.copy(cc).add(dir.multiplyScalar(150)); F.controls.target.copy(cr); F.camera.lookAt(cr); F.camera.updateMatrixWorld(true);
  try { F.controls.update(); } catch (_) {}
  F.requestRender();
  window.__coverBox = bc; window.__thinAxis = k;
  return { thin: k, dist: F.camera.position.distanceTo(cr) };
})()`;
// The cover's middle on the screen (its corners projected, the box shrunk to 70 % of itself): how many pixels are dark there.
const DARK = `(async (b64) => {
  const F = window._appFns, THREE = F.THREE, bc = window.__coverBox;
  if (!bc) return { dark: 0, n: 0, box: null };
  const img = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const r = F.renderer.domElement.getBoundingClientRect();
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < 8; i++) {
    const v = new THREE.Vector3(i & 1 ? bc.max.x : bc.min.x, i & 2 ? bc.max.y : bc.min.y, i & 4 ? bc.max.z : bc.min.z).project(F.camera);
    const px = r.left + (v.x + 1) / 2 * r.width, py = r.top + (1 - v.y) / 2 * r.height;
    x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
  }
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, hw = (x1 - x0) / 2 * 0.7, hh = (y1 - y0) / 2 * 0.7;
  const X0 = Math.round(mx - hw), X1 = Math.round(mx + hw), Y0 = Math.round(my - hh), Y1 = Math.round(my + hh);
  const d = g.getImageData(0, 0, c.width, c.height).data, W = c.width;
  let dark = 0, n = 0;
  for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) { const i = (y * W + x) * 4; n++; if (d[i] + d[i + 1] + d[i + 2] < 3 * 45) dark++; }
  return { dark, n, box: [X0, Y0, X1, Y1] };
})`;

try {
  await attach();
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  await ready();
  await evalJS("document.getElementById('welcome-close')?.click()");
  await evalJS(`(async () => { const f = new File([${JSON.stringify(model())}], 'ring-cover.obj'); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  if (await until("document.getElementById('import-modal').classList.contains('show')", 20)) await evalJS("document.querySelector('#import-modal-confirm')?.click()");
  check('two parts opened', await until("window.state && window.state.parts.filter(p => !p.deleted).length === 2", 60, 500), await evalJS('window.state.parts.map(p => p.name)'));
  await sleep(2000);
  console.log('backend', await evalJS("window._appFns.renderer.backend?.constructor?.name || '?'"));
  // ANGLE=1: the view the app chose (the ring seen at an angle, its dots in sight) is kept for the screenshot; the count then says nothing
  const aim = process.env.ANGLE ? { dist: 999, angle: true } : await evalJS(AIM);
  check('the camera looks at the ring through the cover', !!aim && aim.dist > 100, aim);
  const sel = await call('select_parts', { name_contains: 'ring' });
  check('the ring is selected', sel.ok && await evalJS('window.state.selected.size') === 1, sel);
  await evalJS("window.__moElements.mode('points'); true");
  check('Points mode draws the ring\'s dots', await until("window.__moElements.marks().dots > 100", 40, 250), await evalJS('window.__moElements.marks()'));
  await sleep(1500);
  await evalJS("window._appFns.requestRender(); new Promise(r => setTimeout(r, 600))");
  const shotA = await send('Page.captureScreenshot', { format: 'png' });
  if (process.env.SHOT) fs.writeFileSync(process.env.SHOT, Buffer.from(shotA.data, 'base64'));
  const on = await evalJS(`${DARK}(${JSON.stringify(shotA.data)})`);
  await evalJS("window.__moElements.mode('model'); window._appFns.requestRender(); new Promise(r => setTimeout(r, 1200))");
  const shotB = await send('Page.captureScreenshot', { format: 'png' });
  const off = await evalJS(`${DARK}(${JSON.stringify(shotB.data)})`);
  console.log('dark pixels in the cover\'s middle: with the dots', on.dark, '· without', off.dark, '· of', on.n);
  check('the cover shows no dots of the ring behind it', on.dark - off.dark < 40, { on, off });

  // The dots over the lines: in the app's own view of the model (the ring at an angle, its blue lines meeting at every point), the
  // middle of each dot is the dot's own black, never the blue of a line through it.
  await evalJS("window._appFns.fitToView(); window._appFns.requestRender(); new Promise(r => setTimeout(r, 1200))");
  await evalJS("window.__moElements.mode('points'); true");
  await until("window.__moElements.marks().dots > 100", 40, 250);
  await sleep(1500);
  await evalJS("window._appFns.requestRender(); new Promise(r => setTimeout(r, 600))");
  const shotC = await send('Page.captureScreenshot', { format: 'png' });
  if (process.env.SHOT) fs.writeFileSync(process.env.SHOT.replace(/\.png$/i, '') + '-angle.png', Buffer.from(shotC.data, 'base64'));
  const over = await evalJS(`(async (b64) => {
    const F = window._appFns, THREE = F.THREE, ring = window.state.parts.find(p => !p.deleted && /ring/i.test(p.name));
    const img = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data, W = c.width, r = F.renderer.domElement.getBoundingClientRect();
    const px = (x, y) => { const i = (y * W + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
    const dark = (p) => p[0] + p[1] + p[2] < 135, blue = (p) => p[2] - p[0] > 90 && p[2] > 150;
    const count = (cx, cy, rad, f) => { let n = 0; for (let y = cy - rad; y <= cy + rad; y++) for (let x = cx - rad; x <= cx + rad; x++) if (f(px(x, y))) n++; return n; };
    const pa = ring.mesh.geometry.attributes.position; ring.mesh.updateWorldMatrix(true, false);
    const seen = new Set(); let withDot = 0, blueMiddle = 0; const bad = [];
    for (let i = 0; i < pa.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pa, i).applyMatrix4(ring.mesh.matrixWorld);
      const key = v.toArray().map(n => n.toFixed(3)).join(','); if (seen.has(key)) continue; seen.add(key);
      v.project(F.camera);
      const x = Math.round(r.left + (v.x + 1) / 2 * r.width), y = Math.round(r.top + (1 - v.y) / 2 * r.height);
      if (count(x, y, 3, dark) < 4) continue;                 // no dot drawn here (a point on the far side)
      withDot++;
      if (count(x, y, 1, blue) > 0) {
        blueMiddle++;
        // (DEBUG: the 24 × 24 pixels round the dot, 8 times larger, as a PNG)
        if (bad.length < 4) { const z = document.createElement('canvas'); z.width = 192; z.height = 192; const zg = z.getContext('2d'); zg.imageSmoothingEnabled = false; zg.drawImage(c, x - 12, y - 12, 24, 24, 0, 0, 192, 192); bad.push({ x, y, dark7: count(x, y, 3, dark), blue3: count(x, y, 1, blue), png: z.toDataURL('image/png').slice(22) }); }
      }
    }
    return { points: seen.size, withDot, blueMiddle, bad };
  })(${JSON.stringify(shotC.data)})`);
  if (process.env.SHOT) over.bad.forEach((b, i) => fs.writeFileSync(process.env.SHOT.replace(/\.png$/i, '') + '-bad' + i + '.png', Buffer.from(b.png, 'base64')));
  over.bad = over.bad.map(b => ({ x: b.x, y: b.y, dark7: b.dark7, blue3: b.blue3 }));
  console.log('dots found', over.withDot, 'of', over.points, 'points · with a blue line through the middle', over.blueMiddle);
  // (a point right on the silhouette, fading out and cut by the near side, keeps no line out of the few pixels left of it: 2 of 90 here)
  check('the dots are over the lines', over.withDot >= 30 && over.blueMiddle <= 3, over);
  check('no page errors', errors.length === 0, errors);
} catch (e) {
  fail++; console.log('FAIL', e.message || e);
} finally {
  try { ws?.close(); } catch (_) {}
  chrome.kill();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
