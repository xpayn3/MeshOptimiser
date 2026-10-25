// node tests/e2e-pivot-orient.mjs [model, default inbox/GearboxAssy.glb]
//
// Align axes (orientPivotsTo), in the real app in headless Chrome (software WebGL2, no window shown): turns each part's own X, Y and Z
// and the vertices the other way, so every part looks exactly as it did; Undo puts the axes and the vertices back.
// Needs the app served on http://localhost:4242 (python app/serve.py --no-browser --port 4242), or another port in APP_PORT, Chrome installed and Node 22+.
import { spawn } from 'child_process';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9337, PROFILE = process.env.TEMP + '/cdp-profile-' + Date.now();
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
  await evalJS(`(async () => { const r = await fetch(${JSON.stringify(MODEL)}); const b = await r.blob(); const f = new File([b], ${JSON.stringify(MODEL.split('/').pop())}); const dt = new DataTransfer(); dt.items.add(f); const inp = document.getElementById('file-input') || document.querySelector('input[type=file]'); inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  for (let i = 0; i < 160; i++) { const n = await evalJS("document.querySelectorAll('#tree .tree-node').length"); if (n > 3) break; await sleep(500); }
  await sleep(4000);

  // Pivot orientation: turns the part's own axes, the vertices turn the other way, so every part looks exactly as it did.
  await evalJS(`(() => {
    window.__p = {
      ids: () => state.parts.filter(p => !p.deleted && p.mesh && !p.locked && p.visible !== false).slice(0, 4).map(p => p.partId),
      // every vertex in the scene, a sample of them, and the part's own rotation
      snap: (ids) => ids.map(i => { const p = state.parts.find(q => q.partId === i); p.mesh.updateWorldMatrix(true, false); const a = p.mesh.geometry.attributes.position, m = p.mesh.matrixWorld, out = [], v = new (window._appFns.THREE).Vector3(); const st = Math.max(1, Math.floor(a.count / 40)); for (let k = 0; k < a.count; k += st) { v.fromBufferAttribute(a, k).applyMatrix4(m); out.push(v.x, v.y, v.z); } const q = new (window._appFns.THREE).Quaternion(); p.mesh.getWorldQuaternion(q); return { pts: out, q: q.toArray(), bb: p.bbox ? [p.bbox.min.x, p.bbox.min.y, p.bbox.min.z, p.bbox.max.x, p.bbox.max.y, p.bbox.max.z] : null, shared: 0 }; }),
      pivotQ: () => { const q = new (window._appFns.THREE).Quaternion(); state.pivot.getWorldQuaternion(q); return q.toArray(); },
    };
  })()`);
  const ids = await evalJS('__p.ids()');
  ok(ids.length >= 3, 'parts with a mesh of their own', JSON.stringify(ids));
  const pick = async (list) => {
    await evalJS(`(async () => {
      const want = ${JSON.stringify(list)};
      for (let n = 0; n < want.length; n++) {
        const row = document.querySelector('#tree .tree-node[data-part-id="' + want[n] + '"]');
        const o = { bubbles: true, cancelable: true, button: 0, ctrlKey: n > 0, view: window };
        row.dispatchEvent(new MouseEvent('mousedown', o)); row.dispatchEvent(new MouseEvent('mouseup', o)); row.dispatchEvent(new MouseEvent('click', o));
        await new Promise(r => setTimeout(r, 250));
      }
      await new Promise(r => setTimeout(r, 400));
    })()`);
  };
  const same = (a, b, eps = 1e-4) => a.every((x, i) => Math.abs(x - b[i]) < eps);
  const keep = async (label, ids) => {
    const before = await evalJS(`__p.snap(${JSON.stringify(ids)})`);
    return async () => {
      await sleep(500);
      const after = await evalJS(`__p.snap(${JSON.stringify(ids)})`);
      ok(before.every((b, i) => same(b.pts, after[i].pts)), label + ': every part looks exactly as it did');
      return after;
    };
  };
  const run = async (mode) => {
    // (the command of the search: it opens the Pivot card on its Orientation tab; the old line asked for _Actions.run, which does not exist, so the card stayed shut)
    await evalJS(`(() => { const a = _appFns._Actions.list.find(x => x.id === 'pivotOrient'); if (a) a.run(); })()`);
    await sleep(400);
    ok(await evalJS(`(() => { const c = document.querySelector('.section-cmd[data-cmd="axis"]'); return !c.hidden && !!c.querySelector('[data-pv-pane="orient"]:not([hidden])'); })()`), mode + ': the Pivot card is open on its Orientation tab');
    await evalJS(`document.querySelector('.section-cmd[data-cmd="axis"] [data-orient="${mode}"]').click()`);
    await sleep(900);
  };
  const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); (await import('fs')).writeFileSync(process.env.SHOTDIR + '/' + name + '.png', Buffer.from(r.data, 'base64')); };
  for (const [mode, list] of [['world', ids.slice(0, 1)], ['object', ids.slice(0, 3)], ['view', ids.slice(0, 3)], ['active', ids.slice(0, 3)], ['spread', ids.slice(0, 4)]]) {
    await pick(list);
    const histBefore = await evalJS('state.history.length');
    const check = await keep(mode, list);
    await run(mode);
    const after = await check();
    if (process.env.SHOTDIR) await shot(mode);
    const hist = await evalJS('state.history.length');
    ok(hist >= histBefore, mode + ': history ok', histBefore + ' -> ' + hist);
    // the gizmo stands on the pivot
    ok(await evalJS('!!(state.gizmo && state.gizmo.object)'), mode + ': the gizmo is still on the selection');
    if (mode === 'world') ok(same(after[0].q, [0, 0, 0, 1]) || same(after[0].q, [0, 0, 0, -1]), 'world: the pivot is on the scene axes', JSON.stringify(after[0].q));
    if (mode === 'view') { const cq = await evalJS('(() => { const q = new (_appFns.THREE).Quaternion(); _appFns.camera.getWorldQuaternion(q); return q.toArray(); })()'); ok(after.every(a => same(a.q, cq) || same(a.q, cq.map(x => -x))), 'view: each pivot is on the screen axes'); }
  }
  // Undo every step, then every part is where and how it was loaded
  const base = await evalJS(`__p.snap(${JSON.stringify(ids)})`);
  await pick(ids.slice(0, 3));
  const h0 = await evalJS('state.history.length');
  await run('view');
  const h1 = await evalJS('state.history.length');
  ok(h1 > h0, 'turning a pivot is an undo step', h0 + ' -> ' + h1);
  const mid = await evalJS(`__p.snap(${JSON.stringify(ids)})`);
  for (let i = 0; i < h1 - h0; i++) { await evalJS(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true }))`); await sleep(500); }
  const back = await evalJS(`__p.snap(${JSON.stringify(ids)})`);
  ok(back.every((b, i) => same(b.pts, mid[i].pts)), 'Undo: the parts look the same');
  ok(back.some((b, i) => !same(b.q, mid[i].q, 1e-3)), 'Undo: the pivot turned back');
  // One engine for every way of turning a pivot (axisSet). What the old turning routine skipped or could not do:
  const openCard = async () => { await evalJS("(() => { const a = _appFns._Actions.list.find(x => x.id === 'pivotOrient'); if (a) a.run(); })()"); await sleep(700); };
  {
    // a part with uneven scale (and turned): its pivot goes to the scene axes and it looks as it did (it used to be skipped)
    const id = ids[0];
    await evalJS(`(() => { const p = state.parts.find(q => q.partId === ${id}); p.mesh.rotation.set(0.4, 0.3, 0.2); p.mesh.scale.set(1, 1.6, 1); p.mesh.updateMatrix(); p.mesh.updateMatrixWorld(true); })()`);
    await pick([id]);
    const h0 = await evalJS('state.history.length');
    const chk = await keep('uneven scale', [id]);
    await run('world');
    const aft = await chk();
    ok(same(aft[0].q, [0, 0, 0, 1]) || same(aft[0].q, [0, 0, 0, -1]), 'uneven scale: the pivot is turned to the scene axes (it was left alone before)', JSON.stringify(aft[0].q));
    ok((await evalJS('state.history.length')) === h0 + 1, 'uneven scale: one undo step');
  }
  {
    // a locked part keeps its pivot
    const id = ids[1];
    await pick([id]);
    await evalJS(`(() => { const p = state.parts.find(q => q.partId === ${id}); p.locked = true; })()`);
    const h0 = await evalJS('state.history.length');
    const before = await evalJS(`__p.snap([${id}])`);
    await run('view');
    const after = await evalJS(`__p.snap([${id}])`);
    ok(same(before[0].q, after[0].q, 1e-6) && same(before[0].pts, after[0].pts), 'a locked part keeps its pivot');
    ok((await evalJS('state.history.length')) === h0, 'a locked part: no undo step');
    await evalJS(`(() => { const p = state.parts.find(q => q.partId === ${id}); p.locked = false; })()`);
  }
  {
    // Spread needs three parts: with two, nothing is turned and nothing is put on the undo list
    await pick(ids.slice(0, 2));
    const h0 = await evalJS('state.history.length');
    const before = await evalJS(`__p.snap(${JSON.stringify(ids.slice(0, 2))})`);
    await run('spread');
    const after = await evalJS(`__p.snap(${JSON.stringify(ids.slice(0, 2))})`);
    ok(before.every((b, i) => same(b.q, after[i].q, 1e-6)), 'Spread with two parts: the pivots stay');
    ok((await evalJS('state.history.length')) === h0, 'Spread with two parts: no undo step');
  }
  {
    // typed angles: the pivot is turned by exactly those (the scene's X, Y, Z), and the part looks as it did
    const id = ids[2];
    await pick([id]);
    const chk = await keep('typed angles', [id]);
    await openCard();
    await evalJS("(() => { document.getElementById('pivot-x').value = '0'; document.getElementById('pivot-y').value = '0'; document.getElementById('pivot-z').value = '30'; document.getElementById('btn-pivot-apply').click(); })()");
    await sleep(900);
    const aft = await chk();
    const exp = await evalJS('(() => { const T = _appFns.THREE; return new T.Quaternion().setFromEuler(new T.Euler(0, 0, Math.PI / 6, "XYZ")).toArray(); })()');
    ok(same(aft[0].q, exp, 1e-3) || same(aft[0].q, exp.map(x => -x), 1e-3), 'typed angles 0, 0, 30: the pivot stands at 30 degrees about Z', JSON.stringify([aft[0].q, exp]));
  }
  ok(errors.length === 0, 'no JavaScript errors', errors.slice(0, 3).join(' | '));
} catch (e) { console.log('FAIL the run itself:', e.message); failed++; }
finally { try { ws && ws.close(); } catch (_) {} chrome.kill(); }
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks pass');
process.exit(failed ? 1 : 0);
