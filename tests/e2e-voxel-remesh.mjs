// node tests/e2e-voxel-remesh.mjs <model.glb> [shot.png]
//
// Drives Voxel remesh in the real app in headless Chrome: opens a model (handed to the page as a file), remeshes its biggest part,
// checks the card, that Detail, Adaptivity and Close gaps each run it again in the same undo step, that one undo puts the part back
// and that the settings are remembered. Needs the app served on http://localhost:4242 (python app/serve.py --no-browser --port 4242),
// or APP_PORT.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2], SHOT = process.argv[3];
if (!MODEL) { console.log('usage: node tests/e2e-voxel-remesh.mjs <model.glb> [shot.png]'); process.exit(2); }
const PORT = 9351, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-grooves-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const call = async (name, args = {}) => {
  const r = await evalJS(`(async () => { try { const f = window.__moBridgeTools[${JSON.stringify(name)}]; if (!f) return { ok: false, e: 'no such tool' }; const r = await f(${JSON.stringify(args)}); return { ok: true, t: r.map(x => x.type === 'text' ? x.text : '[' + x.type + ']') }; } catch (e) { return { ok: false, e: e.message || String(e) }; } })()`);
  if (r.ok) { const s = r.t.join('\n'); let j = null; try { j = JSON.parse(s); } catch (_) {} return { ok: true, s, j }; }
  return { ok: false, e: r.e };
};
const sum = async () => (await call('scene_summary')).j;
const ready = async () => {
  // (app-ready alone is not enough: the page shows itself after a cap even while the app's module is still starting, e.g. on a busy
  // graphics card, and the tools below would not be there yet; so the module's own hooks are waited for too)
  for (let i = 0; i < 120; i++) { if (await evalJS("!!(document.body && document.body.classList.contains('app-ready') && window.__moBridgeTools && window.__moOpenFile)").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
};
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
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  await ready();
  await evalJS("document.getElementById('welcome-close')?.click()");
  const b64 = fs.readFileSync(MODEL).toString('base64');
  await evalJS(`(async () => { const bin = atob(${JSON.stringify(b64)}); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); const f = new File([u], ${JSON.stringify(path.basename(MODEL))}); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  let s0 = null;
  for (let i = 0; i < 120; i++) { s0 = await sum(); if (s0 && s0.parts > 0 && s0.triangles > 0) break; await sleep(500); }
  await sleep(1500);
  check('the model is open', s0 && s0.parts > 0, s0);
  const lp = await call('list_parts', { sort_by: 'triangles', limit: 1 });
  const pid = lp.j.parts[0].id;
  const waitIdle = async () => { for (let i = 0; i < 120 && await evalJS('window.__moAgent.voxelBusy()'); i++) await sleep(250); await sleep(300); };
  const dry = await evalJS(`window.__moDryRun('voxel_remesh', { ids: [${pid}], dry_run: true }).then(r => JSON.parse(r[0].text))`);
  check('a dry run says what it would do and changes nothing', dry && dry.nothing_changed && dry.would_result.triangles_saved !== 0, dry);
  await call('select_parts', { ids: [pid] });
  const t0 = Date.now();
  await evalJS(`window.__moAgent.voxelRemesh({ ids: [${pid}] })`);
  await waitIdle();
  const s1 = await sum();
  console.log('   (first run ' + (Date.now() - t0) + ' ms)');
  check('the part is rebuilt, one part still', s1.parts === s0.parts && s1.triangles !== s0.triangles, { s0, s1 });
  check('the card opens', await evalJS("!document.querySelector('.section-cmd[data-cmd=\"voxel\"]').hidden"));
  check('the view is Wireframe', s1.view_mode === 'wire');
  check('the info line says the voxel size', /voxel [0-9.]+ mm/.test(await evalJS("document.getElementById('vox-info').textContent")));
  // Detail: fewer voxels, fewer triangles
  await evalJS("window.__moAgent.voxelSet('cells', 64)"); await waitIdle();
  const s2 = await sum();
  check('Detail 64: fewer triangles', s2.triangles < s1.triangles, { s1, s2 });
  // Adaptivity 0: every face of the grid
  await evalJS("window.__moAgent.voxelSet('adapt', 0)"); await waitIdle();
  const s3 = await sum();
  // (the part's own triangles: the scene's minus the other parts', which stay as they were; the model may be an assembly)
  const rest = s0.triangles - lp.j.parts[0].triangles, p2 = s2.triangles - rest, p3 = s3.triangles - rest;
  check('Adaptivity 0: many more triangles', p3 > p2 * 2, { part_at_adapt_half: p2, part_at_adapt_0: p3, s2, s3 });
  await evalJS("window.__moAgent.voxelSet('adapt', 0.5)"); await waitIdle();
  // Close gaps: a share of the length
  await evalJS("window.__moAgent.voxelSet('gap', 0.06)"); await waitIdle();
  check('Close gaps: the info line says so', /gaps up to [0-9.]+ mm closed/.test(await evalJS("document.getElementById('vox-info').textContent")));
  const sliders = await evalJS("[...document.querySelectorAll('#vox-detail-scrub .scrub-value, #vox-adapt-scrub .scrub-value, #vox-gap-scrub .scrub-value')].map(e => e.textContent)");
  check('the sliders show what was set (64, 0.50, 6.0)', sliders[0] === '64' && sliders[1] === '0.50' && sliders[2] === '6.0', sliders);
  if (SHOT) { await call('set_camera_view', { view: 'fit' }); await sleep(800); const img = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(SHOT, Buffer.from(img.data, 'base64')); }
  await call('undo'); await sleep(500);
  check('one undo puts the part back, whatever the sliders did', (await sum()).triangles === s0.triangles);
  // remembered: run again, the card starts where it was left
  await evalJS(`window.__moAgent.voxelRemesh({ ids: [${pid}] })`); await waitIdle();
  const again = await evalJS("[...document.querySelectorAll('#vox-detail-scrub .scrub-value, #vox-adapt-scrub .scrub-value, #vox-gap-scrub .scrub-value')].map(e => e.textContent)");
  check('run again: the settings are remembered', again[0] === '64' && again[1] === '0.50' && again[2] === '6.0', again);
  await call('undo'); await sleep(400);
} catch (e) { fail++; console.log('HARNESS ERROR:', e.message); }
console.log(`\n${pass} passed, ${fail} failed`);
console.log('page exceptions:', errors.length); errors.slice(0, 12).forEach(e => console.log('  ' + e));
try { ws && ws.close(); } catch (_) {}
chrome.kill();
process.exit(fail ? 1 : 0);
