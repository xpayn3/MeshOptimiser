// node tests/e2e-cloner-clip.mjs
//
// A cloner with a long array: the copies nearer the camera than the source were cut away by the near plane while the view was panned,
// because the cloner's box (p.bbox, which the near and far planes read) was the box of its source alone. Builds a Linear cloner of 40
// cubes 300 mm apart, puts the camera just past the far end of the array looking back at the source, and checks that the cloner's box
// holds the whole array and that the near plane is in front of the nearest copy. Also checks that the old box (the source's) would have
// put the near plane behind that copy, so the check does catch the bug.
// Needs the app served on APP_PORT (default 4242), Chrome and Node 22+.
import { spawn } from 'child_process';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9377, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-clnclip-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
// The camera just past the far end of the array, a little to the side, looking back at the source; returns the near plane and how far
// along the view the nearest copy's nearest corner is.
const probe = `(() => {
  const F = window._appFns, cam = F.camera, ctl = F.controls, p = state.parts.find(q => q.isCloner && !q.deleted);
  cam.position.set(12400, -700, 300); ctl.target.set(0, 0, 0); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(true); ctl.update();
  window._MOpt.fitNear();
  const THREE = cam.position.constructor, f = new THREE(0, 0, -1).applyQuaternion(cam.quaternion);
  let nearest = Infinity;
  for (const x of [11700 - 50, 11700 + 50]) for (const y of [-50, 50]) for (const z of [-50, 50]) {
    const d = (x - cam.position.x) * f.x + (y - cam.position.y) * f.y + (z - cam.position.z) * f.z; if (d < nearest) nearest = d; }
  return { near: cam.near, nearest, box: [p.bbox.min.x, p.bbox.max.x] };
})()`;
try {
  let t;
  for (let i = 0; i < 60 && !t; i++) { try { t = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find(x => x.type === 'page'); } catch (_) {} if (!t) await sleep(250); }
  if (!t) throw new Error('Chrome did not start');
  ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
    else if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text || '').split('\n').slice(0, 3).join(' | ')); };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await ev("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await ev("document.getElementById('welcome-start-empty')?.click()"); await sleep(300);
  await ev("document.getElementById('welcome-close')?.click()"); await sleep(300);
  await ev("Promise.resolve(window._addPrimitive('cube')).then(() => 1)"); await sleep(800);
  await ev(`(() => { const src = state.parts.filter(p => !p.deleted && p.mesh && !p.isCloner).pop();
    src.mesh.position.set(0, 0, 0); src.mesh.updateMatrixWorld(true);
    window._Cloner.createFromParts([src.partId], { mode: 'linear' });
    const p = state.parts.find(q => q.isCloner && !q.deleted);
    Object.assign(p.cloner.linear, { count: 40, dx: 300, dy: 0, dz: 0 }); window._Cloner.rebuild(p); return 1; })()`);
  await sleep(800);

  const r = await ev(probe);
  check('the cloner\'s box holds the whole array (0 to 11700 mm along X)', r.box[0] <= -49 && r.box[1] >= 11749, r.box);
  check('the near plane is in front of the nearest copy', r.near < r.nearest, r);

  // The old box: the source's alone. The near plane then lands behind the nearest copy (what the user saw).
  const old = await ev(`(() => { const p = state.parts.find(q => q.isCloner && !q.deleted); p.bbox.min.set(-50, -50, -50); p.bbox.max.set(50, 50, 50); return 1; })()`);
  await sleep(450);
  const r0 = await ev(probe);
  check('with the source\'s box alone the near plane would cut the nearest copy (the check catches the bug)', old && r0.near > r0.nearest, r0);
  await ev("(() => { const p = state.parts.find(q => q.isCloner && !q.deleted); window._Cloner.rebuild(p); return 1; })()"); await sleep(450);
  const r1 = await ev(probe);
  check('a rebuild gives the cloner its whole box back', r1.near < r1.nearest && r1.box[1] >= 11749, r1);

  check('no script errors', errors.length === 0, errors);
} catch (e) { fail++; console.log('FAIL', e.message); }
finally { try { ws?.close(); } catch (_) {} chrome.kill(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }
