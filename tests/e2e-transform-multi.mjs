// node tests/e2e-transform-multi.mjs [model, default inbox/GearboxAssy.glb]
//
// The Transform panel with several parts selected, in the real app in headless Chrome (software WebGL2, no window shown): the fields
// are open, a field shows the number when every part has it and "mixed" only when they differ, a number typed in goes to each part
// on its own and leaves its other numbers alone, one part selected afterwards reads the same number, and Undo takes it back.
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

  // helpers in the page
  await evalJS(`(() => {
    const K = ['px','py','pz','rx','ry','rz','sx','sy','sz'];
    window.__t = {
      K,
      field: (k) => document.getElementById('tform-' + k),
      fields: () => Object.fromEntries(K.map(k => { const e = document.getElementById('tform-' + k); return [k, { v: e.value, off: e.disabled, ph: e.placeholder }]; })),
      mats: (ids) => ids.map(i => { const p = state.parts.find(q => q.partId === i); p.mesh.updateWorldMatrix(true, false); return Array.from(p.mesh.matrixWorld.elements); }),
      // the panel is filled again when it is shown
      reopen: async () => { await new Promise(r => setTimeout(r, 500)); },      // (the Transform block of the right sidebar is always shown and reads the selection itself)
      type: async (k, v) => { const e = document.getElementById('tform-' + k); e.focus(); e.value = String(v); e.dispatchEvent(new Event('change', { bubbles: true })); e.blur(); await new Promise(r => setTimeout(r, 350)); },
    };
  })()`);
  const ids = await evalJS(`state.parts.filter(p => !p.deleted && p.mesh && !p.locked && p.visible !== false).slice(0, 3).map(p => p.partId)`);
  ok(ids.length === 3, 'three parts with a mesh of their own', JSON.stringify(ids));
  // selected the way a person does it: a click on the part's row in the tree, Ctrl + click for each one more (so the gizmo and
  // everything else that follows a selection is as it is in use)
  const pick = async (list) => {
    const got = await evalJS(`(async () => {
      const want = ${JSON.stringify(list)};
      for (let n = 0; n < want.length; n++) {
        const row = document.querySelector('#tree .tree-node[data-part-id="' + want[n] + '"]');
        if (!row) return 'no row for part ' + want[n];
        const o = { bubbles: true, cancelable: true, button: 0, ctrlKey: n > 0, view: window };
        row.dispatchEvent(new MouseEvent('mousedown', o)); row.dispatchEvent(new MouseEvent('mouseup', o)); row.dispatchEvent(new MouseEvent('click', o));
        await new Promise(r => setTimeout(r, 250));
      }
      await new Promise(r => setTimeout(r, 300));
      await __t.reopen();
      return [...state.selected].sort((a, b) => a - b).join(',') + '|' + (state.selectedGroupIds ? state.selectedGroupIds.size : 0);
    })()`);
    if (got !== [...list].sort((a, b) => a - b).join(',') + '|0') throw new Error('selection by the tree gave ' + got + ', wanted ' + list.join(','));
  };

  // what each part reads on its own
  const alone = [];
  for (const i of ids) { await pick([i]); alone.push(await evalJS('__t.fields()')); }
  await pick(ids);
  let f = await evalJS('__t.fields()');
  ok(Object.values(f).every(x => !x.off), 'the fields are open with several parts selected');
  for (const k of ['px', 'py', 'pz', 'rx', 'ry', 'rz', 'sx', 'sy', 'sz']) {
    const vals = alone.map(a => a[k].v), same = vals.every(v => v === vals[0]);
    ok(same ? f[k].v === vals[0] : (f[k].v === '' && f[k].ph === 'mixed'), `${k}: ${same ? 'the shared number' : 'mixed'}`, `alone ${JSON.stringify(vals)} together ${JSON.stringify(f[k].v)}`);
  }

  // a position for all of them
  const m0 = await evalJS(`__t.mats(${JSON.stringify(ids)})`);
  const hist0 = await evalJS('state.history.length');
  await evalJS(`__t.type('px', 12.5)`);
  f = await evalJS('__t.fields()');
  ok(f.px.v === '12.5', 'px typed for all: the field shows it, not mixed', JSON.stringify(f.px));
  const m1 = await evalJS(`__t.mats(${JSON.stringify(ids)})`);
  ok(m1.every((m, i) => Math.abs(m[13] - m0[i][13]) < 1e-6 && Math.abs(m[14] - m0[i][14]) < 1e-6), 'the other two axes of each part stayed');
  ok(m1.every((m, i) => [0, 1, 2, 4, 5, 6, 8, 9, 10].every(j => Math.abs(m[j] - m0[i][j]) < 1e-9)), 'no part was turned or scaled by it');
  ok(await evalJS('state.history.length') === hist0 + 1, 'one undo step for the three parts');

  // a rotation for all of them
  await evalJS(`__t.type('ry', 30)`);
  f = await evalJS('__t.fields()');
  ok(f.ry.v === '30', 'ry typed for all: the field shows it', JSON.stringify(f.ry));
  ok(f.px.v === '12.5', 'the position stayed while they were turned', JSON.stringify(f.px));
  const m2 = await evalJS(`__t.mats(${JSON.stringify(ids)})`);
  ok(m2.every((m, i) => [12, 13, 14].every(j => Math.abs(m[j] - m1[i][j]) < 1e-6)), 'each part turned about its own origin');

  // a size for all of them (the Size column, not Scale)
  const scaleOn = await evalJS(`localStorage.getItem('stepopt-tform-scale') === '1'`);
  await evalJS(`__t.type('sx', ${scaleOn ? 2 : 40})`);
  f = await evalJS('__t.fields()');
  ok(f.sx.v === (scaleOn ? '2' : '40'), 'sx typed for all: the field shows it', JSON.stringify(f.sx));
  ok(f.ry.v === '30' && f.px.v === '12.5', 'rotation and position stayed', JSON.stringify([f.ry.v, f.px.v]));

  // one part on its own reads what was typed for all
  for (const i of ids) {
    await pick([i]);
    const a = await evalJS('__t.fields()');
    ok(a.px.v === '12.5' && a.ry.v === '30' && a.sx.v === (scaleOn ? '2' : '40'), `part ${i} alone reads the same numbers`, JSON.stringify([a.px.v, a.ry.v, a.sx.v]));
  }

  // typing the number a field already shows changes nothing
  await pick(ids);
  const m3 = await evalJS(`__t.mats(${JSON.stringify(ids)})`);
  await evalJS(`__t.type('ry', 30)`); await evalJS(`__t.type('px', 12.5)`);
  const m4 = await evalJS(`__t.mats(${JSON.stringify(ids)})`);
  ok(m4.every((m, i) => m.every((x, j) => Math.abs(x - m3[i][j]) < 1e-6)), 'typing the same numbers again moves nothing');

  // junk is refused
  await evalJS(`__t.type('py', 'abc')`);
  const m5 = await evalJS(`__t.mats(${JSON.stringify(ids)})`);
  ok(m5.every((m, i) => m.every((x, j) => Math.abs(x - m4[i][j]) < 1e-9)), 'something that is not a number changes nothing');

  // Undo, as many steps as were made
  const steps = await evalJS('state.history.length') - hist0;
  for (let i = 0; i < steps; i++) { await evalJS(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true }))`); await sleep(400); }
  const m6 = await evalJS(`__t.mats(${JSON.stringify(ids)})`);
  ok(m6.every((m, i) => m.every((x, j) => Math.abs(x - m0[i][j]) < 1e-6)), `Undo (${steps} steps) puts every part back`);
  ok(errors.length === 0, 'no JavaScript errors', errors.slice(0, 3).join(' | '));
} catch (e) { console.log('FAIL the run itself:', e.message); failed++; }
finally { try { ws && ws.close(); } catch (_) {} chrome.kill(); }
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks pass');
process.exit(failed ? 1 : 0);
