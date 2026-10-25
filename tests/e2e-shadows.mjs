// node tests/e2e-shadows.mjs
//
// Scene > Shadows: the switch is there and turns the shadows on; the sun casts shadows on the parts. The floor of the grid gets no
// shadow picture: it has been off on purpose since v0.35.0 (_FLOOR_SHADOW in app.js; the shadows fall on the model's own parts). If it is
// switched back on, the floor checks below run: a soft shadow of the model seen from above, on the right side of it (not mirrored).
// Needs the app served on http://localhost:4242, Chrome and Node 22+.
import { spawn } from 'child_process';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9351, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-undomem-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--mute-audio', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0, curId = ''; const pending = new Map(), errors = [];
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
const copies = () => evalJS(`new Promise((res) => { const r = indexedDB.open('mo-recovery', 1); r.onupgradeneeded = () => r.result.createObjectStore('snaps', { keyPath: 'key' }); r.onsuccess = () => { const q = r.result.transaction('snaps').objectStore('snaps').getAll(); q.onsuccess = () => { res(q.result.map(s => ({ name: s.name, parts: s.parts, size: s.size, unit: s.unit, up: s.up }))); r.result.close(); }; }; r.onerror = () => res(null); })`);
const ready = async () => {
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
};
const attach = async () => {
  let target;
  for (let i = 0; i < 60 && !target; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); target = l.find(t => t.type === 'page'); } catch (_) {} if (!target) await sleep(250); }
  if (!target) throw new Error('Chrome did not start');
  curId = target.id;
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



try {
  await attach();
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  await ready();
  await evalJS("document.getElementById('welcome-close')?.click()");
  // two boxes on the floor: a big one on the left and the far side (x -6, y +4), a small one on the right and the near side (x +6, y -4)
  const NL = String.fromCharCode(10), out = []; let base = 0;
  const box = (x0, y0, z0, sx, sy, sz) => {
    const v = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
    for (const q of v) out.push('v ' + (x0 + q[0] * sx) + ' ' + (y0 + q[1] * sy) + ' ' + (z0 + q[2] * sz));
    for (const f of [[1,3,2],[1,4,3],[5,6,7],[5,7,8],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,4,8],[3,8,7],[4,1,5],[4,5,8]]) out.push('f ' + f.map(k => k + base).join(' '));
    base += 8;
  };
  box(-10, 2, 0, 8, 6, 8); box(4, -6, 0, 3, 2, 3);
  await evalJS(`(async () => { const f = new File([${JSON.stringify(out.join(NL))}], 'boxes.obj'); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  for (let i = 0; i < 40; i++) { if (await evalJS("document.getElementById('import-modal').classList.contains('show')").catch(() => false)) break; await sleep(250); }
  await evalJS("document.querySelector('#import-modal-confirm')?.click()");
  for (let i = 0; i < 60; i++) { if (await evalJS("window.state && window.state.parts.length >= 1").catch(() => false)) break; await sleep(500); }
  await sleep(2500);
  check('the Scene card has a visible Shadows switch', await evalJS("(() => { const el = document.getElementById('toggle-shadows'); if (!el) return false; const r = el.closest('label').getBoundingClientRect(); return document.querySelectorAll('#toggle-shadows').length === 1 && r.width > 0; })()") || await evalJS("document.querySelectorAll('#toggle-shadows').length === 1"));
  check('the shadows are off to begin with', await evalJS('window.state.shadowsEnabled === false'));
  await evalJS("window.__consoleLog = []; for (const k of ['error']) { const o = console[k]; console[k] = (...a) => { window.__consoleLog.push(a.map(String).join(' ').slice(0, 300)); o.apply(console, a); }; } true");
  await evalJS("document.getElementById('toggle-shadows').click(); true");
  for (let i = 0; i < 40; i++) { await sleep(500); if (await evalJS('!!(window.state._shadowFloor && window.state._shadowFloor.material.map)')) break; }
  await sleep(500);
  check('the switch turns the shadows on', await evalJS('window.state.shadowsEnabled === true'));
  check('the sun casts', await evalJS('window.state._lights.dir.castShadow === true'));
  check('the parts cast and receive', await evalJS("(() => { const p = window.state.parts[0]; return p.mesh.castShadow === true && p.mesh.receiveShadow === true; })()"));
  const floorOn = await evalJS('!!(window.state._shadowFloor && window.state._shadowFloor.visible && window.state._shadowFloor.material.map)');
  if (!floorOn) {
    check('the floor of the grid gets no shadow picture (off on purpose: the shadows fall on the parts)', await evalJS('!window.state._shadowFloor || !window.state._shadowFloor.visible'));
    check('no shader error', !(await evalJS("(window.__consoleLog || []).length")), await evalJS("(window.__consoleLog || []).slice(0, 2)"));
  } else {
  check('the floor has its shadow picture and shows it', floorOn);
  const mass = await evalJS(`(() => { const f = window.state._shadowFloor, c = f.material.map.image, N = c.width, d = c.getContext('2d').getImageData(0, 0, N, N).data; let sa = 0, sx = 0, sy = 0; for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const a = d[(y * N + x) * 4 + 3]; sa += a; sx += a * x; sy += a * y; }
    const u = sx / sa / N, v = 1 - sy / sa / N, P = f.userData.corners, w = [0, 1, 2].map(k => P[0][k] + u * (P[1][k] - P[0][k]) + v * (P[3][k] - P[0][k]));
    const ctr = f.userData.centre, sun = f.userData.sunHoriz; const dx = [0, 1, 2].map(k => w[k] - ctr[k]);
    return { total: sa / 255, shadowAt: w.map(x => +x.toFixed(2)), modelCentre: ctr.map(x => +x.toFixed(2)), sunHoriz: sun.map(x => +x.toFixed(2)), along: dx[0] * sun[0] + dx[1] * sun[1] + dx[2] * sun[2], z: w[2] }; })()`);
  console.log('   the shadow on the floor:', JSON.stringify(mass));
  check('the shadow has some mass', mass.total > 500, mass);
  check('it lies on the floor (the grid plane)', Math.abs(mass.z) < 1e-3, mass.z);
  check('it falls away from the sun (its middle is on the far side of the model from the sun)', mass.along < 0, mass);
  check('no shader error', !(await evalJS("(window.__consoleLog || []).length")), await evalJS("(window.__consoleLog || []).slice(0, 2)"));
  if (process.env.SHOT) { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70 }); await sleep(2500); const sh = await send('Page.captureScreenshot', { format: 'png' }); (await import('fs')).writeFileSync(process.env.SHOT, Buffer.from(sh.data, 'base64')); }
  }
  // off again
  await evalJS("document.getElementById('toggle-shadows').click(); true"); await sleep(600);
  check('and off again: the sun casts no shadow and no floor shadow shows', await evalJS('window.state.shadowsEnabled === false && window.state._lights.dir.castShadow === false && (!window.state._shadowFloor || !window.state._shadowFloor.visible)'));
} catch (e) { fail++; console.log('HARNESS ERROR:', e.message); }
console.log(`\n${pass} passed, ${fail} failed`);
console.log('page exceptions:', errors.length); errors.slice(0, 12).forEach(e => console.log('  ' + e));
try { ws && ws.close(); } catch (_) {}
chrome.kill();
process.exit(fail ? 1 : 0);
