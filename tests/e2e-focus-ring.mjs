// node tests/e2e-focus-ring.mjs [model, default inbox/GearboxAssy.glb]
//
// Photo mode: the left sidebar steps aside, and the focus ring. Here: with the left sidebar open, Photo mode folds it and leaving puts
// it back; with it folded before, it stays folded after; the choice the user made is not overwritten. With depth of field on, Ctrl+press
// on the model and dragging up shows the focus ring where the press was: the distance in its middle grows, the round distances on its
// scale move along it (it turns), the aperture the depth of field matches is lit; a press alone shows nothing; the wheel goes to the
// aperture ring (whole stops, and the depth of field with them) and the zoom ring (the lens; the camera stays put) and back; letting go hides it.
// SHOT=folder saves two pictures of the ring while it turns. Needs the app served on http://localhost:4242, Chrome and Node 22+.
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9366, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-focusring-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const GFX = process.env.GPU ? ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--mute-audio', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, ...GFX, '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, ...extra });
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
    else if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text || '').split('\n').slice(0, 3).join(' | '));
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
};

const ALT = 0, SHIFT = 8;      // (ALT: no modifier: the rings are held open with V since they moved off Ctrl)
const FOLDED = "document.body.classList.contains('left-collapsed')";
const photo = async (want) => {
  await evalJS("document.getElementById('tg-photo-mode').click(); true");
  return until(want ? "document.body.classList.contains('photo-mode') && !document.getElementById('photo-loading')?.classList.contains('show')" : "!document.body.classList.contains('photo-mode')", 120);
};
const shot = async (name) => {
  if (!process.env.SHOT) return;
  const c = await evalJS("(() => { const r = document.querySelector('.photo-focus-ring').getBoundingClientRect(); return { x: r.left - 16, y: r.top - 16, width: r.width + 32, height: r.height + 32, scale: 2 }; })()");
  fs.writeFileSync(path.join(process.env.SHOT, 'focus-ring-' + name + '.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png', clip: c })).data, 'base64'));
};

try {
  await attach();
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await evalJS("document.getElementById('welcome-close')?.click()");
  await evalJS(`(async () => { const r = await fetch(${JSON.stringify(MODEL)}); const b = await r.blob(); const f = new File([b], ${JSON.stringify(path.basename(MODEL))}); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  for (let i = 0; i < 160; i++) { const n = await evalJS("document.querySelectorAll('#tree .tree-node[data-part-id]').length"); if (n > 5) break; await sleep(500); }
  await until("!document.getElementById('loader')?.classList.contains('show')", 120);
  await sleep(1000);

  // the left sidebar
  if (await evalJS(FOLDED)) { await evalJS("document.getElementById('btn-toggle-left').click(); true"); await sleep(400); }
  const saved0 = await evalJS("localStorage.getItem('stepopt-left-collapsed')");
  check('the left sidebar is open to begin with', !(await evalJS(FOLDED)));
  check('Photo mode on', await photo(true));
  check('Photo mode itself makes no sound (sounds are for the viewport gizmos and quick wheels only)', (await evalJS('window.__moUiSound.count')).pop === 0, await evalJS('window.__moUiSound.count'));
  check('it folds the left sidebar away', await evalJS(FOLDED));
  check('without saving that as the choice', (await evalJS("localStorage.getItem('stepopt-left-collapsed')")) === saved0, saved0);
  check('Photo mode off', await photo(false));
  check('the left sidebar is back', !(await evalJS(FOLDED)));
  await evalJS("document.getElementById('btn-toggle-left').click(); true"); await sleep(400);
  check('folded by hand', await evalJS(FOLDED));
  await photo(true); await photo(false);
  check('folded before Photo mode: still folded after', await evalJS(FOLDED));
  await evalJS("document.getElementById('btn-toggle-left').click(); true"); await sleep(400);

  // the focus ring
  await photo(true);
  await sleep(800);
  await evalJS("(() => { const c = document.getElementById('photo-fx-dof'); if (c && !c.checked) c.click(); return true; })()");
  await sleep(500);
  const at = await evalJS("(() => { const r = document.getElementById('canvas').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()");
  await mouse('mouseMoved', at.x, at.y, { buttons: 0 }); await sleep(120);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86, text: 'v' });
  await sleep(250);
  const rp = await evalJS('window.__moFocusRing && window.__moFocusRing()');
  check('holding V shows the rings at once, at the pointer', !!rp && rp.shown, rp);
  await mouse('mouseMoved', at.x, at.y - 6, { button: 'left', buttons: 1, modifiers: ALT }); await sleep(250);
  const r0 = await evalJS('window.__moFocusRing && window.__moFocusRing()');
  check('moving the pointer keeps them where V went down', !!r0 && r0.shown && await evalJS(`(() => { const r = document.querySelector('.photo-focus-ring').getBoundingClientRect(); return Math.abs(r.left + r.width / 2 - ${at.x}) < 2 && Math.abs(r.top + r.height / 2 - ${at.y}) < 2; })()`), r0);
  check('it shows the distance, round distances on its scale, and the aperture in use', !!r0 && +r0.dist > 0 && await evalJS("document.querySelectorAll('.photo-focus-ring [data-ring=\"focus\"] .fr-num').length >= 2") && !!r0.stop, r0);
  // light: the drag below is a dozen moves; the ring's figures are made again only when a new decade comes round, not at every move
  await evalJS("(() => { window.__frMut = 0; new MutationObserver((ms) => { for (const m of ms) if (m.type === 'childList') window.__frMut++; }).observe(document.querySelector('.photo-focus-ring'), { childList: true, subtree: true }); return true; })()");
  await shot('a');
  // speed: what one frame of the ring costs, and what a real drag of 30 moves costs the page (script, style, layout)
  const perFrame = await evalJS('window.__moFocusRingBench(300)');
  console.log('  ring: ' + perFrame.toFixed(3) + ' ms a frame (script and restyle)');
  check('the ring costs well under a millisecond a frame', perFrame < 0.5, perFrame);
  await send('Performance.enable');
  const met = async () => Object.fromEntries((await send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  const m0 = await met();
  for (let i = 1; i <= 30; i++) { await mouse('mouseMoved', at.x, at.y - 6 - i * 2, { button: 'left', buttons: 1, modifiers: ALT }); await sleep(16); }
  const m1 = await met();
  const ms = (k) => ((m1[k] - m0[k]) * 1000 / 30).toFixed(2);
  console.log('  a drag of 30 moves, per move: script ' + ms('ScriptDuration') + ' ms, style ' + ms('RecalcStyleDuration') + ' ms, layout ' + ms('LayoutDuration') + ' ms (the picture itself is drawn on the graphics card)');
  await mouse('mouseMoved', at.x, at.y - 6, { button: 'left', buttons: 1, modifiers: ALT }); await sleep(100);
  for (let i = 1; i <= 8; i++) { await mouse('mouseMoved', at.x, at.y - 6 - i * 12, { button: 'left', buttons: 1, modifiers: ALT }); await sleep(20); }
  await sleep(200);
  const r1 = await evalJS('window.__moFocusRing()');
  await shot('b');
  const moved = Math.abs(r1.rot.focus - r0.rot.focus) > 3, rebuilt = await evalJS('window.__frMut');
  check('dragging up pushes the focus further: the distance grows', +r1.dist > +r0.dist, { before: r0.dist, after: r1.dist });
  check('and the ring turns: the round distances move along it', moved, { r0: r0.rot, r1: r1.rot });
  check('it ticks as its ridges go by', (await evalJS('window.__moUiSound.count')).tick >= 3, await evalJS('window.__moUiSound.count'));
  check('its figures are not made again at every move (a dozen moves: at most two new decades)', rebuilt <= 2 * 3, rebuilt);
  // the wheel goes to the next ring while the drag lasts: aperture, then zoom; each turns with the drag
  const wheel = async (dy) => { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: at.x, y: at.y - 100, deltaX: 0, deltaY: dy, modifiers: ALT, buttons: 1 }); await sleep(220); };
  await wheel(100);
  const ra = await evalJS('window.__moFocusRing()');
  check('the wheel goes to the aperture ring', ra.ring === 'aperture', ra);
  await shot('aperture');
  const dof0 = await evalJS("document.getElementById('photo-dof').value");
  for (let i = 1; i <= 4; i++) { await mouse('mouseMoved', at.x, at.y - 100 + i * 12, { button: 'left', buttons: 1, modifiers: ALT }); await sleep(30); }
  await sleep(150);
  const rb = await evalJS('window.__moFocusRing()'), dof1 = await evalJS("document.getElementById('photo-dof').value");
  check('turning it changes the aperture smoothly (not stop by stop), the ring turns, and the depth of field follows', rb.fraw !== ra.fraw && Math.abs(rb.rot.aperture - ra.rot.aperture) > 3 && dof1 !== dof0, { before: ra.fraw, after: rb.fraw, rot: [ra.rot.aperture, rb.rot.aperture], dof0, dof1 });
  // detents: turned in small steps, it catches on a stop and holds there for the next small steps
  let held = null;
  for (let i = 1; i <= 60 && !held; i++) { await mouse('mouseMoved', at.x, at.y - 52 + i * 2, { button: 'left', buttons: 1, modifiers: ALT }); await sleep(25); const r = await evalJS('window.__moFocusRing()'); if (r.snap) held = { r, i }; }
  check('turned slowly, the aperture catches on a stop', !!held && [1.4, 2, 2.8, 4, 5.6, 8, 11, 16].includes(held.r.fset), held && held.r);
  check('and clicks as it catches', (await evalJS('window.__moUiSound.count')).click >= 1, await evalJS('window.__moUiSound.count'));
  if (held) { await mouse('mouseMoved', at.x, at.y - 52 + held.i * 2 + 1, { button: 'left', buttons: 1, modifiers: ALT }); await sleep(60); const r2 = await evalJS('window.__moFocusRing()'); check('and holds on it for the next small step', r2.fset === held.r.fset, { was: held.r.fset, now: r2.fset }); }
  await wheel(100);
  const rz = await evalJS('window.__moFocusRing()');
  check('the wheel goes on to the zoom ring', rz.ring === 'zoom', rz);
  await shot('zoom');
  const cam0 = await evalJS("(() => { const F = window._appFns; return { fov: F.camera.fov, d: F.camera.position.distanceTo(F.controls.target) }; })()");
  for (let i = 1; i <= 6; i++) { await mouse('mouseMoved', at.x, at.y - 52 - i * 12, { button: 'left', buttons: 1, modifiers: ALT }); await sleep(30); }
  await sleep(150);
  const rz2 = await evalJS('window.__moFocusRing()'), cam1 = await evalJS("(() => { const F = window._appFns; return { fov: F.camera.fov, d: F.camera.position.distanceTo(F.controls.target) }; })()");
  check('turning it zooms: the lens changes, the ring turns, the camera stays where it is (no dolly zoom)', rz2.mm !== rz.mm && Math.abs(rz2.rot.zoom - rz.rot.zoom) > 3 && cam1.fov !== cam0.fov && Math.abs(cam1.d - cam0.d) < 1e-6, { mm: [rz.mm, rz2.mm], cam0, cam1 });
  await wheel(-100); await wheel(-100);
  check('the wheel back up returns to the focus ring', (await evalJS('window.__moFocusRing()')).ring === 'focus');
  // it stops at the ends: up from the outer ring stays on it; down to the inner one, and further down stays there
  await wheel(-100);
  const w1 = (await evalJS('window.__moFocusRing()')).ring;
  await wheel(100); await wheel(100); await wheel(100);
  const w2 = (await evalJS('window.__moFocusRing()')).ring;
  await wheel(-100); await wheel(-100);
  check('the wheel stops at the outer and the inner ring (no going round)', w1 === 'focus' && w2 === 'zoom', { w1, w2 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86 });
  await sleep(300);
  check('letting V go puts them away', !(await evalJS('window.__moFocusRing()')).shown);
  // Ctrl+click: the focus on the point under the pointer, and no rings
  await mouse('mouseMoved', at.x, at.y, { buttons: 0 }); await sleep(100);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, modifiers: 2 });
  await mouse('mousePressed', at.x, at.y, { button: 'left', buttons: 1, clickCount: 1, modifiers: 2 }); await sleep(60);
  await mouse('mouseMoved', at.x, at.y - 30, { button: 'left', buttons: 1, modifiers: 2 }); await sleep(120);
  const rc = await evalJS('window.__moFocusRing()');
  await mouse('mouseReleased', at.x, at.y - 30, { button: 'left', buttons: 0, clickCount: 1, modifiers: 2 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, modifiers: 0 }); await sleep(200);
  const fv = await evalJS("document.getElementById('photo-focus-val')?.textContent");
  check('Ctrl+click sets the focus on what is under the pointer, and shows no rings (even dragged)', !rc.shown && !!fv && fv !== 'Orbit pivot' && fv !== 'Picked point', { shown: rc.shown, fv });
  // the command wheel (Q) over the view: a pop as it opens, a tick on each slice the pointer comes onto, no click when closed with Esc
  await photo(false); await sleep(600);
  const vc = await evalJS("(() => { const r = document.getElementById('canvas').getBoundingClientRect(); return { x: Math.round(r.left + r.width * .4), y: Math.round(r.top + r.height * .5) }; })()");
  await mouse('mouseMoved', vc.x, vc.y, { buttons: 0 }); await sleep(100);
  const q0 = await evalJS('window.__moUiSound.count');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'q', code: 'KeyQ', windowsVirtualKeyCode: 81, text: 'q' }); await sleep(250);
  for (let i = 1; i <= 8; i++) { await mouse('mouseMoved', vc.x + i * 9, vc.y - i * 4, { buttons: 0 }); await sleep(30); }
  await sleep(200);
  const q1 = await evalJS('window.__moUiSound.count');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(100);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'q', code: 'KeyQ', windowsVirtualKeyCode: 81 }); await sleep(200);
  const q2 = await evalJS('window.__moUiSound.count');
  check('the command wheel pops as it opens and ticks on a slice; closed with Esc, no click', q1.pop === q0.pop + 1 && q1.tick > q0.tick && q2.click === q1.click, { q0, q1, q2 });
  // quiet for a moment: the audio is put to sleep (a running one keeps the sound card streaming silence, and some tick); a sound wakes it
  await sleep(2200);
  const st0 = await evalJS('window.__moUiSound.state');
  const c0 = (await evalJS('window.__moUiSound.count')).click;
  await evalJS('window.__moUiSound.click(); true'); await sleep(300);
  const st1 = await evalJS('window.__moUiSound.state'), c1 = (await evalJS('window.__moUiSound.count')).click;
  check('quiet for a moment, the audio sleeps; the next sound wakes it', st0 === 'suspended' && st1 === 'running' && c1 === c0 + 1, { st0, st1, c0, c1 });
  // Settings › General › Interface sounds off: nothing more is played
  await evalJS('window.__openSettings("general")'); await sleep(400);
  await evalJS("(() => { const c = document.getElementById('set-sounds'); if (c && c.checked) c.click(); return !!c; })()");
  const before = await evalJS('window.__moUiSound.count');
  await evalJS("document.querySelector('.set-close, #settings-close, [data-close-settings]')?.click(); true"); await sleep(300);
  await evalJS("window.__moUiSound.click(); window.__moUiSound.tick(); window.__moUiSound.pop(true); true"); await sleep(100);
  const after = await evalJS('window.__moUiSound.count');
  check('with Interface sounds off, nothing is played', after.pop === before.pop && after.click === before.click && after.tick === before.tick, { before, after });
  await evalJS("localStorage.removeItem('stepopt-prefs'); true").catch(() => {});
  check('no page errors', errors.length === 0, errors);
} catch (e) {
  fail++; console.log('FAIL', e.message || e);
} finally {
  try { ws?.close(); } catch (_) {}
  chrome.kill();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
