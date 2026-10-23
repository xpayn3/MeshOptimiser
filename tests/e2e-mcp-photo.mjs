// node tests/e2e-mcp-photo.mjs [model, default inbox/GearboxAssy.glb]
//
// Claude's photo_mode tool and the camera angles of set_camera_view, in the real app in headless Chrome: photo_mode switches Photo mode
// on and sets the lights, backdrop, finish, quality, floor and effects through the card's own controls (the card shows them), refuses a
// value it does not know without changing anything, sets the focus of the depth of field on the middle of the view and on a part, keeps
// its settings through render_image photo_mode true (which does not switch it off), and leaves with on false. set_camera_view turns,
// tilts and moves the camera closer round its pivot, keeping the distance when it only turns.
// Needs the app served on http://localhost:4242, or another port in APP_PORT, Chrome and Node 22+. CAPTURE_GPU=1 uses the machine's GPU.
import { spawn } from 'child_process';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9362, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-mcpphoto-' + Date.now();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const GPU_FLAGS = process.env.CAPTURE_GPU === '1' ? ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, ...GPU_FLAGS, '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [], consoleErr = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
// (a call goes to the active scene tab's tools, as serve.py's bridge picks them: activeWin in app.js)
const call = async (name, args = {}) => {
  const r = await evalJS(`(async () => { try { const t = window.__moTabs, w = t && t.wins && t.wins[t.active]; const f = ((w && w.__moBridgeTools) || window.__moBridgeTools)[${JSON.stringify(name)}]; if (!f) return { ok: false, e: 'no such tool' }; const r = await f(${JSON.stringify(args)}); return { ok: true, t: r.map(x => x.type === 'text' ? x.text : '[' + x.type + ']') }; } catch (e) { return { ok: false, e: e.message || String(e) }; } })()`);
  if (r.ok) { const s = r.t.join('\n'); let j = null; try { j = JSON.parse(s); } catch (_) {} return { ok: true, s, j }; }
  return { ok: false, e: r.e };
};
const sum = async () => (await call('scene_summary')).j;
try {
  let target;
  for (let i = 0; i < 60 && !target; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); target = l.find(t => t.type === 'page'); } catch (_) {} if (!target) await sleep(250); }
  if (!target) throw new Error('Chrome did not start');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
    else if (d.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});      // (the leave-page question of a scene with changes)
    else if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text || '').split('\n').slice(0, 3).join(' | '));
    else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') consoleErr.push(d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 220));
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await evalJS("document.getElementById('welcome-close')?.click()");
  await evalJS(`(async () => { const r = await fetch(${JSON.stringify(MODEL)}); const b = await r.blob(); const f = new File([b], ${JSON.stringify(path.basename(MODEL))}); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  for (let i = 0; i < 160; i++) { const n = await evalJS("document.querySelectorAll('#tree .tree-node').length"); if (n > 3) break; await sleep(500); }
  await sleep(4000);

  const el = (id, prop = 'value') => evalJS(`document.getElementById(${JSON.stringify(id)})?.${prop}`);

  // — the camera —
  const camState = `(() => { const A = window._appFns, c = A.camera, t = window.state && window.state._ctl ? null : null; return { p: c.position.toArray() }; })()`;
  await call('set_camera_view', { view: 'fit' });
  const tgt = await evalJS("(() => { const c = window._appFns.controls || null; return c ? c.target.toArray() : null; })()");
  const dist = async () => evalJS(`(() => { const c = window._appFns.camera, t = window._appFns.controls ? window._appFns.controls.target : null; return t ? c.position.distanceTo(t) : null; })()`);
  const d0 = await dist();
  let r = await call('set_camera_view', { turn_deg: 40 });
  const d1 = await dist();
  check('set_camera_view turns the camera and keeps its distance', r.ok && d0 && Math.abs(d1 - d0) / d0 < 1e-3, { r, d0, d1 });
  r = await call('set_camera_view', { zoom: 2 });
  const d2 = await dist();
  check('zoom 2 halves the distance', r.ok && Math.abs(d2 - d1 / 2) / d1 < 1e-3, { d1, d2 });
  r = await call('set_camera_view', { tilt_deg: 400 });
  check('a tilt past straight down is stopped short of it', r.ok && Number.isFinite(await dist()), r);
  check('zoom out of range is refused', !(await call('set_camera_view', { zoom: 0 })).ok);
  const fovNow = () => evalJS('window._appFns.camera.fov');
  const f0 = await fovNow(), d3 = await dist();
  r = await call('set_camera_view', { lens_mm: 85 });
  const f1 = await fovNow(), d4 = await dist();
  check('lens_mm 85 sets the lens (the Camera card too)', r.ok && Math.abs(f1 - 2 * Math.atan(12 / 85) * 180 / Math.PI) < 0.01 && Number(await el('cam-fov')) === 85, { r, f1 });
  check('and moves the camera back so the model keeps its size', Math.abs(d4 / d3 - Math.tan(f0 * Math.PI / 360) / Math.tan(f1 * Math.PI / 360)) < 1e-3, { d3, d4 });
  check('a lens out of range is refused', !(await call('set_camera_view', { lens_mm: 5 })).ok);
  await call('set_camera_view', { lens_mm: 29 });
  await call('set_camera_view', { view: 'perspective' });

  // — Photo mode —
  const emActive = () => evalJS("document.getElementById('el-bar') ? !document.getElementById('el-bar').hidden : false");
  await evalJS("(() => { const p = window.state.parts.find(p => p && !p.deleted && p.mesh); window.state.selected = new Set([p.partId]); return true; })()");
  await evalJS("window.__moElements.mode('faces')"); await sleep(800);
  const emWas = await emActive();
  check('a value it does not know is refused', !(await call('photo_mode', { lights: 'disco' })).ok);
  check('and Photo mode was not switched on for it', !(await evalJS("document.body.classList.contains('photo-mode')")));
  check('an effect out of range is refused', !(await call('photo_mode', { effects: { dof: 300 } })).ok);
  r = await call('photo_mode', { lights: 'dramatic', backdrop: 'dark', look: 'aces', quality: 'draft', floor: true, effects: { dof: 70, vignette: 40, grain: false, ao: 50 } });
  for (let i = 0; i < 30 && await evalJS("document.getElementById('photo-loading')?.classList.contains('show')"); i++) await sleep(500);
  const edgesShown = () => evalJS("(() => { let n = 0, v = 0; window._appFns.camera.parent.traverse(o => { if (o.userData && o.userData.cadEdge) { n++; if (o.material && o.material.visible !== false && o.visible !== false) v++; } }); return [n, v]; })()");
  { const e = await edgesShown(); console.log('edge lines (all, drawn):', e); check('no edge lines are drawn in Photo mode', e[0] > 0 && e[1] === 0, e); }
  check('photo_mode switches Photo mode on', r.ok && r.j && r.j.on === true && await evalJS("document.body.classList.contains('photo-mode')"), r);
  check('Photo mode leaves Edit mesh', emWas && !(await emActive()), { emWas });
  await evalJS("window.__moElements.mode('faces')"); await sleep(600);
  check('and Edit mesh cannot be opened in it', !(await emActive()));
  check('the softboxes are on by default', r.j.softboxes === true, r.j);
  const envId = () => evalJS('window._appFns.camera.parent.environment ? window._appFns.camera.parent.environment.uuid : null');
  const e1 = await envId();
  let rs = await call('photo_mode', { softboxes: false });
  const e2 = await envId();
  check('softboxes false puts the plain studio back as the environment', rs.ok && rs.j.softboxes === false && e2 && e2 !== e1 && (await el('photo-softbox', 'checked')) === false, { e1, e2 });
  rs = await call('photo_mode', { softboxes: true });
  check('and true makes them again', rs.ok && rs.j.softboxes === true && (await envId()) !== e2);
  check('the card shows the lights, backdrop, finish and quality', (await el('photo-lights')) === 'dramatic' && (await el('photo-backdrop')) === 'dark' && (await el('photo-look')) === 'aces' && (await el('photo-quality')) === 'draft');
  check('depth of field is on at 70', (await el('photo-fx-dof', 'checked')) === true && Number(await el('photo-dof')) === 70 && r.j.effects.dof === 70, r.j && r.j.effects);
  check('grain is off, vignette 40, occlusion 50', (await el('photo-fx-grain', 'checked')) === false && r.j.effects.grain === 0 && r.j.effects.vignette === 40 && r.j.effects.ao === 50, r.j && r.j.effects);
  r = await call('photo_mode', { focus: 'centre' });
  check('focus centre picks the model in the middle of the view', r.ok && r.j.focus !== 'orbit pivot' && (await el('photo-focus-val', 'textContent')) !== 'Orbit pivot', r.j);
  const someName = await evalJS("(() => { const p = window.state.parts.find(p => p && !p.deleted && p.name); return p ? p.name : ''; })()");
  r = await call('photo_mode', { focus_name_contains: someName });
  check('focus on a part by name', r.ok && r.j.focus !== 'orbit pivot', { someName, r: r.j || r.e });
  r = await call('photo_mode', { focus: 'pivot' });
  check('focus pivot puts it back', r.ok && r.j.focus === 'orbit pivot');
  r = await call('photo_mode', {});
  check('called with nothing it only reports, all as set', r.ok && r.j.lights === 'dramatic' && r.j.effects.dof === 70);
  r = await call('render_image', { width: 640, height: 360, photo_mode: true, fit: false, preview: false, quality: 'draft' });
  check('render_image photo_mode true draws', r.ok, r.e);
  check('and leaves Photo mode on, with its settings', await evalJS("document.body.classList.contains('photo-mode')") && (await el('photo-lights')) === 'dramatic' && Number(await el('photo-dof')) === 70);
  r = await call('photo_mode', { on: false });
  check('on false leaves Photo mode', r.ok && r.j.on === false && !(await evalJS("document.body.classList.contains('photo-mode')")) && (await el('toggle-photo', 'checked')) === false);
  { const [n, v] = await edgesShown(); check('the edge lines are back after Photo mode', n === 0 || v > 0, { n, v }); }
  check('no page errors', errors.length === 0, errors.slice(0, 5));
  for (const f of (r.j && r.j.files) || []) {}
} catch (e) { fail++; console.log('FAIL exception', e.message); }
finally { try { ws && ws.close(); } catch (_) {} chrome.kill(); }
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
