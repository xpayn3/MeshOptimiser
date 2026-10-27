// node tests/e2e-part-rotation-in-group.mjs [model, default inbox/GearboxAssy.glb]
//
// A part in a turned group: the Transform panel's rotation fields count from the group's axes (0, 0, 0 for a part that was turned
// with its group), and a typed angle is written relative to the group. Needs the app served on http://localhost:4242, or APP_PORT.
import { spawn } from 'child_process';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9338, PROFILE = process.env.TEMP + '/cdp-profile-' + Date.now();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--mute-audio', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let failed = 0;
const ok = (cond, what, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + what + (extra ? '  ' + extra : '')); if (!cond) failed++; };
const near = (a, b, tol = 1e-3) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol * (1 + Math.abs(b[i])));
try {
  let target;
  for (let i = 0; i < 60 && !target; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); target = l.find(t => t.type === 'page'); } catch (_) {} if (!target) await sleep(250); }
  if (!target) throw new Error('Chrome did not start');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
    else if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text || '').split('\n')[0]);
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await evalJS("document.getElementById('welcome-close')?.click()");
  const openFile = (expr, name) => evalJS(`(async () => { const b = await (${expr}); const f = new File([b], ${JSON.stringify(name)}); const dt = new DataTransfer(); dt.items.add(f); const inp = document.getElementById('file-input') || document.querySelector('input[type=file]'); inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await openFile(`fetch(${JSON.stringify(MODEL)}).then(r => r.blob())`, MODEL.split('/').pop());
  for (let i = 0; i < 160; i++) { const n = await evalJS("document.querySelectorAll('#tree .tree-node').length"); if (n > 3) break; await sleep(500); }
  await evalJS(`(() => {
    const A = window._appFns, T = A.THREE;
    window.__r = {
      pick: () => { for (const n of state.treeNodes) { if (n.kind !== 'group' || n.depth < 1) continue; const own = state.treeNodes.filter(k => k.kind === 'part' && k.parentId === n.id && A.getPart(k.partId) && A.getPart(k.partId).mesh); if (own.length >= 1) return { gid: n.id, pid: own[0].partId }; } return null; },
      // the group is turned 30 degrees about Z, and so is the part with it (what dragging the group's gizmo does)
      turn: (gid, pid, deg) => { const q = new T.Quaternion().setFromEuler(new T.Euler(0, 0, deg * Math.PI / 180, 'XYZ')); A._groupRotations.set(gid, q.clone()); const m = A.getPart(pid).mesh; m.updateWorldMatrix(true, false); const wq = m.getWorldQuaternion(new T.Quaternion()), pq = m.parent.getWorldQuaternion(new T.Quaternion()); m.quaternion.copy(pq.invert().multiply(q).multiply(wq)); m.updateMatrixWorld(true); },
      show: (pid) => { state.selectedGroupIds = new Set(); state.selected = new Set([pid]); A._transformPanelRefresh(); return ['tform-rx', 'tform-ry', 'tform-rz'].map(k => parseFloat(document.getElementById(k).value)); },
      type: (id, v) => { const el = document.getElementById(id); el.value = String(v); el.dispatchEvent(new Event('change', { bubbles: true })); },
      world: (pid) => { const m = A.getPart(pid).mesh; m.updateWorldMatrix(true, false); return m.getWorldQuaternion(new T.Quaternion()).toArray(); },
      angle: (a, b) => new T.Quaternion(...a).angleTo(new T.Quaternion(...b)) * 180 / Math.PI,
    };
  })()`);
  const g = await evalJS('__r.pick()');
  ok(!!g, 'a group with a part', JSON.stringify(g));
  // (the part starts unturned inside its parent: obj.rotation is 0, 0, 0)
  await evalJS(`(() => { const m = _appFns.getPart(${g.pid}).mesh; m.quaternion.identity(); m.updateMatrixWorld(true); })()`);
  const w0 = await evalJS(`__r.world(${g.pid})`);
  await evalJS(`__r.turn(${g.gid}, ${g.pid}, 30)`);
  const w1 = await evalJS(`__r.world(${g.pid})`);
  const a01 = await evalJS(`__r.angle(${JSON.stringify(w0)}, ${JSON.stringify(w1)})`);
  ok(Math.abs(a01 - 30) < 0.5, 'the part is turned 30 degrees with its group', a01.toFixed(2));
  await evalJS(`__r.show(${g.pid})`); await sleep(500);
  await evalJS(`state.pivot && state.gizmo && _appFns._detachGizmo && _appFns._detachGizmo()`);
  const f1 = await evalJS(`__r.show(${g.pid})`);
  ok(f1.every(x => Math.abs(x) < 0.05), 'the part turned with its group reads 0, 0, 0', JSON.stringify(f1));
  await evalJS(`__r.type('tform-rz', 10)`); await sleep(400);
  const f2 = await evalJS(`__r.show(${g.pid})`);
  ok(Math.abs(f2[2] - 10) < 0.05 && Math.abs(f2[0]) < 0.05 && Math.abs(f2[1]) < 0.05, 'a typed 10 reads 10 again, the others as they were', JSON.stringify(f2));
  const aw = await evalJS(`(() => { const T = _appFns.THREE, m = _appFns.getPart(${g.pid}).mesh, P = m.parent.getWorldQuaternion(new T.Quaternion()), g = _appFns._groupRotations.get(${g.gid}), gf = P.clone().invert().multiply(g).multiply(P); const want = gf.multiply(new T.Quaternion().setFromEuler(new T.Euler(0, 0, 10 * Math.PI / 180, 'XYZ'))); return want.angleTo(m.quaternion) * 180 / Math.PI; })()`);
  ok(aw < 0.1, 'the part stands where the group turn and the typed angle put it (off by ' + aw.toFixed(3) + ' degrees)');
  // with the gizmo holding the part (the pivot reads in the scene's axes)
  await evalJS(`__r.show(${g.pid})`); await sleep(800);
  const held = await evalJS(`_appFns.getPart(${g.pid}).mesh.parent === state.pivot`);
  if (!held) await evalJS(`(() => { state.selectedGroupIds = new Set(); state.selected = new Set([${g.pid}]); try { _appFns.updateGizmo && _appFns.updateGizmo(); } catch (_) {} })()`), await sleep(800);
  const held2 = await evalJS(`_appFns.getPart(${g.pid}).mesh.parent === state.pivot`);
  console.log('gizmo holds the part:', held2);
  if (held2) {
    const fp = await evalJS(`__r.show(${g.pid})`);
    const exp = await evalJS(`(() => { const T = _appFns.THREE, m = _appFns.getPart(${g.pid}).mesh, w = m.getWorldQuaternion(new T.Quaternion()), g = _appFns._groupRotations.get(${g.gid}).clone().invert().multiply(w), e = new T.Euler().setFromQuaternion(g, 'XYZ'); return [e.x, e.y, e.z].map(x => x * 180 / Math.PI); })()`);
    ok(near(fp, exp, 1e-2), 'with the gizmo on the part the fields are its turn in the axes of the group', JSON.stringify([fp, exp]));
  }
} catch (e) { console.log('FAIL the run itself:', e.message); failed++; }
finally { try { ws && ws.close(); } catch (_) {} chrome.kill(); }
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks pass');
console.log('page exceptions:', errors.length, errors.slice(0, 3));
process.exit(failed ? 1 : 0);
