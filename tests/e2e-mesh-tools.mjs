// node tests/e2e-mesh-tools.mjs <model.glb>
//
// Drives the mesh tools in the real app in headless Chrome. On the biggest part of the model (handed to the page as a file): Close
// cracks, Remove slivers, Patch holes, Remesh evenly, Smooth surface, Convex hull, Convex pieces and Merge bodies each run, open
// their card, run again from a new setting and go back with one undo. Then on two boxes built here: Union, Subtract and Intersect.
// Needs the app served on http://localhost:4242 (python app/serve.py --no-browser --port 4242), or APP_PORT.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2], SHOT = process.argv[3];
if (!MODEL) { console.log('usage: node tests/e2e-mesh-tools.mjs <model.glb>'); process.exit(2); }
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
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
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
  const waitIdle = async () => { for (let i = 0; i < 240 && await evalJS('window.__moAgent.meshOpBusy()'); i++) await sleep(250); await sleep(300); };
  const TOOLS = [
    ['closeCracks', 'Close cracks', ['tol', 0.05]],
    ['removeSlivers', 'Remove slivers', ['ratio', 8]],
    ['patchHoles', 'Patch holes', ['maxSize', 20]],
    ['remeshEvenly', 'Remesh evenly', ['length', 2]],
    ['smoothSurface', 'Smooth surface', ['strength', 3]],
    ['convexHull', 'Convex hull', ['maxPoints', 64]],
    ['convexPieces', 'Convex pieces', ['maxPieces', 4]],
    ['mergeBodies', 'Merge bodies', null],
  ];
  await call('select_parts', { ids: [pid] });
  for (const [name, title, param] of TOOLS) {
    const t0 = Date.now();
    const r = await evalJS(`window.__moAgent.meshOp(${JSON.stringify(name)}, { ids: [${pid}] }).then(x => JSON.parse(JSON.stringify(x)))`);
    await waitIdle();
    const s1 = await sum(), row = r && r.results && r.results[0];
    // (Merge bodies needs closed bodies: on a part that is not closed it must say so and change nothing)
    const refused = name === 'mergeBodies' && row && !row.ok && /closed/.test(row.why || '') && s1.triangles === s0.triangles;
    check(title + (refused ? ': refuses a part that is not closed, and says why' : ': runs on the part (' + (Date.now() - t0) + ' ms, ' + s0.triangles + ' → ' + s1.triangles + ' triangles)'), refused || (r && r.parts === 1 && row && row.ok && s1.parts === s0.parts), row || r);
    if (param) {
      check(title + ': its card opens', await evalJS(`!document.querySelector('.section-cmd[data-cmd="meshop"]').hidden && document.getElementById('mop-title').textContent === ${JSON.stringify(title)}`));
      await evalJS(`window.__moAgent.meshOpSet(${JSON.stringify(param[0])}, ${param[1]})`); await waitIdle();
      const info = await evalJS("document.getElementById('mop-info').textContent");
      check(title + ': a new setting runs it again', /triangles/.test(info) && !/left as it was|no longer/.test(info), info);
    }
    if (name === 'convexHull') check('Convex hull: a small shell', s1.triangles < 600, s1);
    await call('undo'); await sleep(500);
    check(title + ': one undo puts the part back', (await sum()).triangles === s0.triangles);
    await evalJS("document.querySelector('.section-cmd[data-cmd=\"meshop\"] .cmd-close')?.click()");
  }
  // booleans: two boxes 10 apart overlapping by half, as two parts
  const boxGlb = (() => {
    const meshes = [[0, 0, 0, 10, 10, 10], [5, 5, 5, 15, 15, 15]].map(([x0, y0, z0, x1, y1, z1]) => {
      const P = [], I = [];
      for (const [x, y, z] of [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]) P.push(x, y, z);
      for (const f of [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]]) I.push(...f);
      return { P: new Float32Array(P), I: new Uint32Array(I), lo: [x0, y0, z0], hi: [x1, y1, z1] };
    });
    const bufs = [], views = [], accs = [];
    let off = 0;
    meshes.forEach((m, k) => {
      for (const [arr, type, ct, extra] of [[m.P, 'VEC3', 5126, { min: m.lo, max: m.hi }], [m.I, 'SCALAR', 5125, {}]]) {
        const b = Buffer.from(arr.buffer); bufs.push(b); views.push({ buffer: 0, byteOffset: off, byteLength: b.length }); accs.push({ bufferView: views.length - 1, componentType: ct, count: arr.length / (type === 'VEC3' ? 3 : 1), type, ...extra }); off += b.length;
      }
    });
    const gj = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0, 1] }], nodes: [{ name: 'BoxA', mesh: 0 }, { name: 'BoxB', mesh: 1 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }, { primitives: [{ attributes: { POSITION: 2 }, indices: 3 }] }], accessors: accs, bufferViews: views, buffers: [{ byteLength: off }] };
    let js = Buffer.from(JSON.stringify(gj)); while (js.length % 4) js = Buffer.concat([js, Buffer.from(' ')]);
    let bb = Buffer.concat(bufs); while (bb.length % 4) bb = Buffer.concat([bb, Buffer.alloc(1)]);
    const head = Buffer.alloc(12); head.writeUInt32LE(0x46546C67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + bb.length, 8);
    const ch = (l, t) => { const h = Buffer.alloc(8); h.writeUInt32LE(l, 0); h.writeUInt32LE(t, 4); return h; };
    return Buffer.concat([head, ch(js.length, 0x4E4F534A), js, ch(bb.length, 0x004E4942), bb]).toString('base64');
  })();
  // (a fresh page: a second file would open in a scene tab of its own)
  await send('Page.navigate', { url: URL + '?t=' + Date.now() }); await ready(); await evalJS("document.getElementById('welcome-close')?.click()");
  await evalJS(`(async () => { const bin = atob(${JSON.stringify(boxGlb)}); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); const f = new File([u], 'twoboxes.glb'); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  let b0 = null;
  for (let i = 0; i < 60; i++) { b0 = await sum(); if (b0 && b0.parts === 2 && b0.triangles === 24) break; await sleep(500); }
  check('the two boxes are open as two parts', b0 && b0.parts === 2, b0);
  const parts = (await call('list_parts', {})).j.parts, A = parts.find(p => /BoxA/.test(p.name)), B = parts.find(p => /BoxB/.test(p.name));
  const sizeOf = async (id) => (await call('list_parts', {})).j.parts.find(p => p.id === id).size_longest;
  for (const [op, longest] of [['union', 15 * Math.sqrt(1)], ['subtract', 10], ['intersect', 5]]) {
    const r = await evalJS(`window.__moAgent.meshOp(${JSON.stringify(op)}, { ids: [${A.id}, ${B.id}] }).then(x => JSON.parse(JSON.stringify(x)))`);
    await waitIdle();
    const L = await sizeOf(A.id), s = await sum();
    check(op + ': the first part becomes the result (longest side ' + L + ', expected ' + longest + '), the other stays', r && r.parts === 1 && Math.abs(L - longest) < 0.01 && s.parts === 2, { r, L, s });
    await call('undo'); await sleep(400);
    check(op + ': one undo puts it back', Math.abs((await sizeOf(A.id)) - 10) < 0.01);
  }
} catch (e) { fail++; console.log('HARNESS ERROR:', e.message); }
console.log(`\n${pass} passed, ${fail} failed`);
console.log('page exceptions:', errors.length); errors.slice(0, 12).forEach(e => console.log('  ' + e));
try { ws && ws.close(); } catch (_) {}
chrome.kill();
process.exit(fail ? 1 : 0);
