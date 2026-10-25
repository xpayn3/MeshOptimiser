// node tests/e2e-wrap-assembly.mjs [model.glb, default inbox/GearboxAssy.glb]
//
// Voxel remesh's "Wrap parts into one" switch: every part selected, made one part ("Wrap") and rebuilt on one grid. Checks the one part
// left, fewer triangles, the card (its info line says the gaps it closed; Detail rebuilds the wrap; the switch turns it off and on),
// that one undo gives every part back, and the same through Claude's voxel_remesh tool with wrap (one part refused). Needs the app served on http://localhost:4242
// (python app/serve.py --no-browser --port 4242), or APP_PORT.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb', SHOT = process.argv[3];
const PORT = 9390, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-wrap-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--mute-audio', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
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
  check('the model is open with several parts', s0 && s0.parts > 5, s0);
  const lp = await call('list_parts', { limit: 1000 });
  const ids = lp.j.parts.map(p => p.id);
  const waitIdle = async () => { for (let i = 0; i < 240 && await evalJS('window.__moAgent.voxelBusy()'); i++) await sleep(250); await sleep(400); };
  check('there is one entry in the search, Voxel remesh, and no second one for wrap', await evalJS("window._appFns._Actions.list.some(a => a.id === 'voxelRemesh') && !window._appFns._Actions.list.some(a => /wrap/i.test(a.id))"));
  await call('select_parts', { ids });
  const t0 = Date.now();
  await evalJS('window.__moAgent.voxelRemesh({ wrap: true })');
  await waitIdle();
  console.log('   (first wrap ' + (Date.now() - t0) + ' ms)');
  const s1 = await sum();
  console.log('   (' + s0.parts + ' parts, ' + s0.triangles + ' triangles -> ' + s1.parts + ' part, ' + s1.triangles + ' triangles)');
  check('the assembly is one part',s1.parts === 1, { before: s0.parts, after: s1.parts });
  check('with fewer triangles than the assembly had', s1.triangles > 0 && s1.triangles < s0.triangles, { before: s0.triangles, after: s1.triangles });
  const lp1 = await call('list_parts', { limit: 5 });
  check('the part is called Wrap', lp1.j.parts.length === 1 && /^Wrap/.test(lp1.j.parts[0].name), lp1.j.parts);
  check('the card opens', await evalJS("!document.querySelector('.section-cmd[data-cmd=\"voxel\"]').hidden"));
  check('the info line says the gaps it closed (3 % by default)', /gaps up to [0-9.]+ mm closed/.test(await evalJS("document.getElementById('vox-info').textContent")), await evalJS("document.getElementById('vox-info').textContent"));
  await evalJS("window.__moAgent.voxelSet('cells', 64)"); await waitIdle();
  const s2 = await sum();
  check('Detail 64 rebuilds the wrap: fewer triangles, still one part', s2.parts === 1 && s2.triangles < s1.triangles, { s1: s1.triangles, s2: s2.triangles });
  check('the card shows the switch, on', await evalJS("(() => { const r = document.getElementById('vox-wrap-row'), c = document.getElementById('vox-wrap'); return !!r && r.style.display !== 'none' && c.checked; })()"));
  await evalJS("(() => { const c = document.getElementById('vox-wrap'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); })()"); await waitIdle(); await sleep(500); await waitIdle();
  const sOff = await sum();
  check('switched off: every part is back, each rebuilt on its own', sOff.parts === s0.parts && sOff.triangles !== s0.triangles && !(await evalJS("document.getElementById('vox-wrap').checked")), { parts: sOff.parts, was: s0.parts, tris: sOff.triangles });
  await evalJS("(() => { const c = document.getElementById('vox-wrap'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); })()"); await waitIdle(); await sleep(500); await waitIdle();
  const sOn = await sum();
  check('switched on again: one part', sOn.parts === 1, { parts: sOn.parts });
  if (SHOT) { await call('set_camera_view', { view: 'fit' }); await sleep(800); const img = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(SHOT, Buffer.from(img.data, 'base64')); }
  await call('undo'); await sleep(600);
  const s3 = await sum();
  check('one undo gives every part back, whatever the card did', s3.parts === s0.parts && s3.triangles === s0.triangles, { s0: [s0.parts, s0.triangles], s3: [s3.parts, s3.triangles] });
  // through Claude's tool
  const one = await call('voxel_remesh', { ids: [ids[0]], wrap: true });
  check('the tool refuses wrap on one part', !one.ok && /two or more/.test(one.e || ''), one);
  const r = await call('voxel_remesh', { ids, wrap: true, detail: 64 }); await sleep(500);
  const s4 = await sum();
  check('voxel_remesh with wrap makes one part', r.ok && s4.parts === 1, { ok: r.ok, e: r.e, parts: s4.parts });
  check('and says so', r.ok && /made one part/.test(r.s), r.s && r.s.slice(0, 200));
  await call('undo'); await sleep(600);
  const s5 = await sum();
  check('one undo takes the whole call back', s5.parts === s0.parts && s5.triangles === s0.triangles, { s5: [s5.parts, s5.triangles] });
} catch (e) { fail++; console.log('HARNESS ERROR:', e.message); }
console.log(`\n${pass} passed, ${fail} failed`);
console.log('page exceptions:', errors.length); errors.slice(0, 12).forEach(e => console.log('  ' + e));
try { ws && ws.close(); } catch (_) {}
chrome.kill();
process.exit(fail ? 1 : 0);
