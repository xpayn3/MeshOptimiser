// The CAD lines (outlines) and the selection outline keep their whole width when the camera tilts: in the real app, CAD view, the camera
// head on and turned a little and a lot, each view shot three times: lines hidden, lines as drawn, and lines with the faces at their
// points zeroed (the 'normal' attribute that _pulledPosition('edge') reads; zero is the old pull, the depth steps only). The ink of the
// lines is what is darker (or cyan) than the shot without them. The lines as drawn must have at least the ink of the old pull at every
// angle, and more once the camera is off the faces.
//   node tests/e2e-cad-lines.mjs [model]          (GPU=1: WebGPU on the graphics card instead of WebGL2 in SwiftShader; SHOTS=<folder> for the pictures)
// Needs the app served on http://localhost:4242, or another port in APP_PORT (the mo-e2e runner uses 4343), Chrome installed and Node 22+.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const GPU = process.env.GPU === '1';
const SHOTS = process.env.SHOTS || path.join(process.env.TEMP || '.', 'mo-cad-lines');
fs.mkdirSync(SHOTS, { recursive: true });
const PORT = 9355, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-cadlines-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const flags = GPU ? ['--enable-unsafe-webgpu'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
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
// a screenshot, kept in the page (to compare pixels there) and written to SHOTS
const grab = async (key, save) => {
  await sleep(700);
  const s = await send('Page.captureScreenshot', { format: 'png' });
  if (save) fs.writeFileSync(path.join(SHOTS, (GPU ? 'gpu-' : 'gl-') + save + '.png'), Buffer.from(s.data, 'base64'));
  await evalJS(`window.__t.load(${JSON.stringify(key)}, ${JSON.stringify(s.data)})`);
};
const HELPERS = `window.__t = {
  img: {},
  async load(k, b64) {
    const bm = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
    const c = new OffscreenCanvas(bm.width, bm.height), x = c.getContext('2d'); x.drawImage(bm, 0, 0);
    const v = document.getElementById('canvas').getBoundingClientRect();      // (the viewport only, not the panels)
    this.img[k] = { d: x.getImageData(Math.round(v.left), Math.round(v.top), Math.round(v.width), Math.round(v.height)).data };
  },
  // pixels of a that are darker than base by more than 40 (the black CAD lines), or cyan where base is not (the selection's front pass)
  ink(a, base, kind) {
    const A = this.img[a].d, B = this.img[base].d; let n = 0;
    for (let i = 0; i < A.length; i += 4) {
      if (kind === 'cyan') { if (A[i + 2] - A[i] > 150 && !(B[i + 2] - B[i] > 150)) n++; }
      else { const la = A[i] * .3 + A[i + 1] * .59 + A[i + 2] * .11, lb = B[i] * .3 + B[i + 1] * .59 + B[i + 2] * .11; if (lb - la > 40) n++; }
    }
    return n;
  },
  saved: new WeakMap(),
  lineObjs() {
    const st = window.state, hl = new Set(st.activeHighlights || []), out = [];
    window._appFns.camera.parent.traverse(o => { if (o.isLineSegments && (o.userData.cadEdge || hl.has(o))) out.push(o); });
    return out;
  },
  // 'on': as drawn; 'flat': the faces at the points zeroed (the old pull); 'off': hidden. which: 'cad', 'sel' or 'all'.
  lines(mode, which = 'all') {
    const hl = new Set(window.state.activeHighlights || []);
    let n = 0;
    for (const o of this.lineObjs()) {
      const isSel = hl.has(o);
      if (which !== 'all' && (which === 'sel') !== isSel) continue;
      o.visible = mode !== 'off';
      // 'bare': no pull at all (what the selection outline had before: a plain LineBasicMaterial)
      const m = o.material;
      if (m && m.isNodeMaterial && m.depthTest) {
        if (!this.nodes) this.nodes = new Map();
        if (!this.nodes.has(m)) this.nodes.set(m, m.positionNode);
        const want = mode === 'bare' ? null : this.nodes.get(m);
        if (m.positionNode !== want) { m.positionNode = want; m.needsUpdate = true; }
      }
      const a = o.geometry.attributes.normal; if (!a) continue;
      if (!this.saved.has(a)) this.saved.set(a, a.array.slice());
      if (mode === 'flat') a.array.fill(0); else a.array.set(this.saved.get(a));
      a.needsUpdate = true; n++;
    }
    window._appFns.requestRender();
    return n;
  },
  info() {
    let lines = 0, withN = 0, nonZero = 0, pts = 0;
    for (const o of this.lineObjs()) { if (!o.userData.cadEdge) continue; lines++; const a = o.geometry.attributes.normal; if (!a) continue; withN++; pts += a.count; for (let i = 0; i < a.array.length; i += 4) if (a.array[i] | a.array[i + 1] | a.array[i + 2]) nonZero++; }
    return { lines, withN, pts, nonZero };
  },
  // turn the camera round its target: yaw about the scene's up (Z), then pitch about the camera's right
  tilt(yaw, pitch, zoom = 1) {
    const A = window._appFns, cam = A.camera, T = A.THREE, tg = A.controls.target;
    if (!this.base) this.base = cam.position.clone().sub(tg);
    const o = this.base.clone().multiplyScalar(zoom).applyAxisAngle(new T.Vector3(0, 0, 1), yaw * Math.PI / 180);
    const right = new T.Vector3().crossVectors(o, new T.Vector3(0, 0, 1)).normalize();
    o.applyAxisAngle(right, pitch * Math.PI / 180);
    cam.position.copy(tg).add(o); cam.lookAt(tg); cam.updateMatrixWorld();
    try { A.controls.update(); } catch (_) {}
    A.requestRender();
  },
};`;
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
  await evalJS(HELPERS);
  const backend = await evalJS("(() => { const r = window._appFns && window._appFns.renderer; return r && r.backend ? (r.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL') : '?'; })()");
  check('the renderer is the one asked for (' + (GPU ? 'WebGPU' : 'WebGL') + ')', backend === (GPU ? 'WebGPU' : 'WebGL'), backend);
  await evalJS(`(async () => { const r = await fetch(${JSON.stringify(encodeURI(MODEL))}); const b = await r.blob(); const f = new File([b], ${JSON.stringify(path.basename(MODEL))}); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  for (let i = 0; i < 400; i++) { const n = await evalJS("document.querySelectorAll('#tree .tree-node').length"); if (n > 3) break; await sleep(500); }
  await sleep(3000);
  try { await evalJS("window._appFns._Prefs.set('selGlow', false)"); } catch (_) {}

  await call('set_view_mode', { mode: 'cad' });
  await call('set_camera_view', { view: 'front' });
  for (let i = 0; i < 40; i++) { const f = await evalJS('window.__t.info()'); if (f.lines > 3 && f.lines === f.withN) break; await sleep(500); }
  await sleep(1500);
  const info = await evalJS('window.__t.info()');
  console.log('  CAD lines:', JSON.stringify(info));
  check('every CAD line carries the faces at its points', info.lines > 0 && info.withN === info.lines, info);
  check('most points have faces found', info.pts > 0 && info.nonZero / info.pts > 0.9, info);

  // ── the CAD lines, head on and tilted ──
  // (and close up, where a line that came through a part in front would show)
  const angles = [[0, 0], [3, 2], [10, 6], [30, 18], [60, 35], [3, 2, 0.3], [30, 18, 0.3]];
  const rows = [];
  for (const [yaw, pitch, zoom = 1] of angles) {
    await evalJS(`window.__t.tilt(${yaw}, ${pitch}, ${zoom})`);
    const tag = 'cad-' + yaw + '-' + pitch + (zoom !== 1 ? '-near' : '');
    await evalJS("window.__t.lines('off')"); await grab('C');
    await evalJS("window.__t.lines('flat')"); await grab('B', tag + '-old');
    await evalJS("window.__t.lines('on')"); await grab('A', tag);
    const a = await evalJS("window.__t.ink('A', 'C')"), b = await evalJS("window.__t.ink('B', 'C')");
    rows.push({ yaw, pitch, now: a, old: b, ratio: +(a / Math.max(1, b)).toFixed(3) });
  }
  console.log('  CAD line ink (pixels):', JSON.stringify(rows));
  for (const r of rows) check(`CAD lines at ${r.yaw}°/${r.pitch}°: no thinner than with the old pull`, r.now >= r.old * 0.98, r);
  const tilted = rows.filter(r => r.yaw > 0);
  const sumNow = tilted.reduce((s, r) => s + r.now, 0), sumOld = tilted.reduce((s, r) => s + r.old, 0);
  console.log('  tilted views together: now', sumNow, 'old', sumOld, 'ratio', (sumNow / Math.max(1, sumOld)).toFixed(3));

  // ── the selection outline: a few big parts (lines on the parts themselves), then everything (one merged buffer: over 200 parts,
  // so the model is copied twice first, the copies in place) ──
  const lp = await call('list_parts', { sort_by: 'triangles', limit: 1000 });
  const parts = (lp.j && (lp.j.parts || lp.j)) || [];
  const selRows = [];
  const selectMany = async () => {
    const ids = parts.map(p => p.id);
    if (ids.length <= 200) for (let k = 1; k * ids.length <= 200; k++) { const d = await call('duplicate_parts', { ids }); if (!d.ok) console.log('  duplicate_parts:', d.e); }
    await sleep(2500);
    return call('select_all');
  };
  for (const [label, sel] of [['some', async () => call('select_parts', { ids: parts.slice(0, 4).map(p => p.id) })], ['all', selectMany]]) {
    await sel(); await sleep(2500);
    const merged = await evalJS('!!window.state._selMergedGeom && !!window.state._selMergedGeom.attributes.normal');
    for (const [yaw, pitch] of [[10, 6], [30, 18]]) {
      await evalJS(`window.__t.tilt(${yaw}, ${pitch})`);
      await evalJS("window.__t.lines('off', 'sel')"); await grab('C');
      await evalJS("window.__t.lines('flat', 'sel')"); await grab('B', 'sel-' + label + '-' + yaw + '-steps');
      await evalJS("window.__t.lines('bare', 'sel')"); await grab('D', 'sel-' + label + '-' + yaw + '-old');
      await evalJS("window.__t.lines('on', 'sel')"); await grab('A', 'sel-' + label + '-' + yaw);
      const a = await evalJS("window.__t.ink('A', 'C', 'cyan')"), b = await evalJS("window.__t.ink('B', 'C', 'cyan')"), d = await evalJS("window.__t.ink('D', 'C', 'cyan')");
      selRows.push({ label, merged, yaw, pitch, now: a, steps: b, old: d, ratio: +(a / Math.max(1, d)).toFixed(3) });
    }
  }
  console.log('  selection ink (pixels):', JSON.stringify(selRows));
  for (const r of selRows) check(`selection outline (${r.label}) at ${r.yaw}°/${r.pitch}°: drawn, and no thinner than with no pull or the depth steps only`, r.now > 0 && r.now >= r.old * 0.98 && r.now >= r.steps * 0.98, r);
  check('selecting everything makes the merged outline, with the faces at its points', selRows.some(r => r.label === 'all' && r.merged), selRows.map(r => r.merged));

  const bad = warns.filter(w => /\[render\] frame failed|TSL|WGSL|shader|GLSL|Vertex format|NormalNode|Error/i.test(w));
  check('no failed frame or shader message', bad.length === 0, bad.slice(0, 6));
  check('no exception', errors.length === 0, errors.slice(0, 6));
} catch (e) { console.log('HARNESS ERROR:', e.message); fail++; }
console.log(pass + ' passed, ' + fail + ' failed · pictures in ' + SHOTS);
try { ws && ws.close(); } catch (_) {}
chrome.kill();
process.exit(fail ? 1 : 0);
