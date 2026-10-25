// node tests/e2e-history-card.mjs [model, default inbox/GearboxAssy.glb]
//
// A part moved by hand inside an animated group (or an animated part moved by hand) keeps its new place: the animation goes on from it and
// does not snap the part back to where it started.
// Needs the app served on APP_PORT (default 4242; use 4343 with its own server: python app/serve.py --no-browser --port 4343),
// Chrome installed and Node 22+.
import { spawn } from 'child_process';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9341, PROFILE = process.env.TEMP + '/cdp-profile-' + Date.now();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--mute-audio', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let failed = 0;
const ok = (cond, what, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + what + (extra ? '  ' + extra : '')); if (!cond) failed++; };
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
  await evalJS(`(async () => { const b = await fetch(${JSON.stringify(MODEL)}).then(r => r.blob()); const f = new File([b], ${JSON.stringify(MODEL.split('/').pop())}); const dt = new DataTransfer(); dt.items.add(f); const inp = document.getElementById('file-input') || document.querySelector('input[type=file]'); inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  for (let i = 0; i < 160; i++) { const n = await evalJS("document.querySelectorAll('#tree .tree-node').length"); if (n > 3) break; await sleep(500); }
  await sleep(3000);

  const G = (code) => evalJS(code);
  const grp = await G(`(() => { const n = state.treeNodes.find(k => k.kind === 'group' && k.depth >= 0 && state.parts.filter(p => !p.deleted && p.mesh).length); return n ? n.name : null; })()`);
  // a group of at least two parts that are not instanced
  const pick = await G(`(() => {
    const T = _appFns.THREE;
    for (const n of state.treeNodes) {
      if (n.kind !== 'group') continue;
      const ids = state.treeNodes.filter(k => k.kind === 'part' && k.parentId === n.id).map(k => k.partId);
      const ps = ids.map(i => state.parts.find(p => p.partId === i)).filter(p => p && !p.deleted && p.mesh);
      if (ps.length >= 2) return { name: n.name, ids: ps.map(p => p.partId) };
    }
    return null;
  })()`);
  ok(!!pick, 'there is a group with parts to try', JSON.stringify(pick));
  const T = { wp: (id) => G(`(() => { const p = state.parts.find(q => q.partId === ${'${'}id}); p.mesh.updateWorldMatrix(true, false); return p.mesh.getWorldPosition(new (_appFns.THREE.Vector3)()).toArray(); })()`.replace('${id}', 'ID')) };
  const wp = (id) => G(`(() => { const p = state.parts.find(q => q.partId === ${id}); p.mesh.updateWorldMatrix(true, false); return p.mesh.getWorldPosition(new (_appFns.THREE.Vector3)()).toArray(); })()`);
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const move = (id, dx) => G(`(() => { const p = state.parts.find(q => q.partId === ${id}); const m = p.mesh, W = new (_appFns.THREE.Vector3)(${dx}, 0, 0); m.parent.updateWorldMatrix(true, false); const inv = new (_appFns.THREE.Matrix4)().copy(m.parent.matrixWorld).invert(); const o = m.getWorldPosition(new (_appFns.THREE.Vector3)()).add(W).applyMatrix4(inv); m.position.copy(o); m.updateMatrixWorld(true); })()`);
  const A = '__moAnimTest';
  const id = pick.ids[0], other = pick.ids[1];
  await G(`${A}.api.add({ groups: [${JSON.stringify(pick.name)}], type: 'spin', rpm: 30 })`);
  await sleep(300);
  await G(`${A}.ctl.seek(0)`); await sleep(200);
  const p0 = await wp(id), o0 = await wp(other);
  await G(`${A}.ctl.seek(1)`); await sleep(200);
  const spun = await wp(id);
  await G(`${A}.ctl.seek(0)`); await sleep(100); await G(`${A}.ctl.seek(1)`); await sleep(100);
  ok(dist(await wp(id), spun) < 0.05, 'seeking away and back puts the part in the same place (nothing is taken for a move by hand)', dist(await wp(id), spun).toFixed(3));
  ok(dist(spun, p0) > 1, 'the group spins: the part is somewhere else at 1 s', dist(spun, p0).toFixed(2));
  // the user moves the part by 50 mm along X
  await move(id, 50); await sleep(100);
  const moved = await wp(id);
  ok(Math.abs(dist(moved, spun) - 50) < 0.5, 'the move is 50 mm', dist(moved, spun).toFixed(2));
  await G(`${A}.refresh()`); await sleep(200);
  const kept = await wp(id);
  ok(dist(kept, moved) < 0.05, 'the animation does not snap it back when it goes on', dist(kept, moved).toFixed(3));
  const otherNow = await wp(other);
  await G(`${A}.ctl.seek(0)`); await sleep(200);
  const back0 = await wp(id), other0 = await wp(other);
  ok(dist(back0, p0) > 20, 'at 0 s its start is now the new place, not the old one', dist(back0, p0).toFixed(2));
  ok(dist(other0, o0) < 0.05, 'the other parts of the group are where they were', dist(other0, o0).toFixed(3));
  await G(`${A}.ctl.seek(1)`); await sleep(200);
  ok(dist(await wp(id), moved) < 0.05, 'and at 1 s it is where it was put', dist(await wp(id), moved).toFixed(3));
  // the whole group moved: all parts and the middle it turns about go with it
  await G(`${A}.ctl.seek(0)`); await sleep(200);
  const before = await Promise.all(pick.ids.map(wp));
  for (const i of pick.ids) await move(i, 30);
  await G(`${A}.refresh()`); await sleep(200);
  await G(`${A}.ctl.seek(0.5)`); await sleep(200); await G(`${A}.ctl.seek(0)`); await sleep(200);
  const after = await Promise.all(pick.ids.map(wp));
  ok(pick.ids.every((_, k) => Math.abs(dist(after[k], before[k]) - 30) < 0.5), 'moving every part moves them all by the same, at 0 s', JSON.stringify(pick.ids.map((_, k) => +dist(after[k], before[k]).toFixed(2))));
  // an undone / redone move: the same rule (a move of a part is a move whichever way it is made)
  await G(`${A}.api.clear()`); await sleep(200);
  ok(errors.length === 0, 'no JavaScript errors', errors.slice(0, 3).join(' | '));
} catch (e) { console.log('FAIL the run itself:', e.message); failed++; }
finally { if (errors.length) console.log('page errors:', errors.slice(0, 5)); try { ws && ws.close(); } catch (_) {} chrome.kill(); }
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks pass');
process.exit(failed ? 1 : 0);
