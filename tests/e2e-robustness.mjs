// node tests/e2e-robustness.mjs [model, default inbox/GearboxAssy.glb]      ONLY=memory,files
//
// Two things a user meets sooner or later, in the real app (headless Chrome):
//  memory: the same model opened and closed again and again must not keep growing (parts, geometry on the GPU, textures, the
//          JS heap); a tab left open for a day is the same thing as this loop.
//  files:  a broken file (empty, cut short, random bytes, NaN, a count that lies, indices past the end, a huge claim) must end in a
//          message or a model, never a frozen page, a stuck loader or an app that cannot open the next file.
// Needs the app served (python app/serve.py --no-browser --port 4343; APP_PORT overrides 4242), Chrome and Node 22+.
import { spawn } from 'child_process';
import path from 'path';
const CH = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const ONLY = (process.env.ONLY || 'memory,files').split(',');
const PORT = 9361, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-robust-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr, ms = 60000) => {
  const r = await Promise.race([send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }), new Promise((_, j) => setTimeout(() => j(new Error('the page did not answer in ' + ms / 1000 + ' s (frozen?)')), ms))]);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
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
  await send('Page.enable'); await send('Runtime.enable'); await send('HeapProfiler.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
};
const ready = async () => {
  // (app-ready alone is not enough: the page shows itself after a cap even while the app's module is still starting, e.g. on a busy
  // graphics card, and the tools below would not be there yet; so the module's own hooks are waited for too)
  for (let i = 0; i < 120; i++) { if (await evalJS("!!(document.body && document.body.classList.contains('app-ready') && window.__moBridgeTools && window.__moOpenFile)").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await evalJS("document.getElementById('welcome-close')?.click(); true");
};
// open a file in the page (bytes given as base64 or fetched from the server), as if it was dropped
const openBytes = (name, b64, mime = 'application/octet-stream') => evalJS(`(() => { const bin = atob(${JSON.stringify(b64)}); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); window.__moOpenFile(new File([u], ${JSON.stringify(name)}, { type: ${JSON.stringify(mime)} })); return true; })()`);
const openFetched = (url) => evalJS(`(async () => { const r = await fetch(${JSON.stringify(url)}); const b = await r.blob(); window.__moOpenFile(new File([b], ${JSON.stringify(path.basename(url))})); return true; })()`);
// the model cut short in the page: '12', '40', 'third' or 'minus5' (bytes kept, a third, all but the last five)
const openCut = (name, cut) => evalJS(`(async () => { const r = await fetch(${JSON.stringify(MODEL)}); const b = await r.blob(); const n = { '12': 12, '40': 40, third: Math.floor(b.size / 3), minus5: b.size - 5 }[${JSON.stringify(cut)}]; window.__moOpenFile(new File([b.slice(0, n)], ${JSON.stringify(name)})); return true; })()`);
const liveParts = () => evalJS('window.state.parts.filter(p => !p.deleted).length');
const loaderShown = () => evalJS("document.getElementById('loader')?.classList.contains('show') === true");
// wait until the loader is gone and the answer stops changing; returns ms or -1 on a stuck loader
const settle = async (limit = 40000) => {
  const t0 = Date.now(); let quiet = 0;
  while (Date.now() - t0 < limit) {
    await sleep(250);
    if (await loaderShown()) { quiet = 0; continue; }
    if (++quiet >= 6) return Date.now() - t0;
  }
  return -1;
};
const gc = async () => { try { await send('HeapProfiler.collectGarbage'); } catch (_) {} await sleep(300); };
const heapMB = async () => { await gc(); const r = await send('Runtime.getHeapUsage'); return +(r.usedSize / 1048576).toFixed(1); };
const sceneCounts = () => evalJS(`(() => { const st = window.state, gpu = window.__moGpuMemory && window.__moGpuMemory(); let objs = 0; st.partsRoot && st.partsRoot.traverse(() => objs++); return { parts: st.parts.length, geoms: st.geomByHash.size, mats: st.materialByColor.size, objs, history: st.history.length, gpuGeoms: gpu && gpu.geometries, glTex: window.__glTexLive }; })()`);

try {
  await attach();
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  await ready();

  // ── memory: open, clear, open, clear ──
  if (ONLY.includes('memory')) {
    console.log('\n== memory: the same model, opened and cleared again and again ==');
    const ROUNDS = +(process.env.ROUNDS || 6);
    await evalJS(`(() => { window.__glTexLive = 0; const P = WebGL2RenderingContext.prototype, c = P.createTexture, d = P.deleteTexture; P.createTexture = function () { window.__glTexLive++; return c.apply(this, arguments); }; P.deleteTexture = function (t) { if (t) window.__glTexLive--; return d.apply(this, arguments); }; return true; })()`);
    const rows = [];
    for (let i = 0; i < ROUNDS; i++) {
      await openFetched(MODEL);
      const s = await settle(90000);
      if (s < 0) { check('round ' + (i + 1) + ': the model opened', false, 'loader stuck'); break; }
      await sleep(1500);
      const open = await sceneCounts();
      await evalJS('window.__moResetScene(); true');
      await sleep(2500);                                        // (the old buffers are freed at once: _disposeStale; this lets the GPU catch up)
      const cleared = await sceneCounts();
      const heap = await heapMB();
      rows.push({ round: i + 1, open, cleared, heap });
      console.log('   round', i + 1, 'open', JSON.stringify(open), '| cleared', JSON.stringify(cleared), '| heap', heap, 'MB');
    }
    check('every round opened the model', rows.length === ROUNDS && rows.every(r => r.open.parts > 5), rows.map(r => r.open.parts));
    check('the same number of parts comes back each time', new Set(rows.map(r => r.open.parts)).size === 1, rows.map(r => r.open.parts));
    check('clearing leaves no parts', rows.every(r => r.cleared.parts === 0), rows.map(r => r.cleared.parts));
    check('clearing leaves no geometry in the table', rows.every(r => r.cleared.geoms === 0), rows.map(r => r.cleared.geoms));
    check('clearing leaves no objects in the scene', rows.every(r => r.cleared.objs <= 2), rows.map(r => r.cleared.objs));
    if (rows.every(r => r.cleared.gpuGeoms != null)) {
      const g = rows.map(r => r.cleared.gpuGeoms);
      check('the GPU geometry after clearing does not grow from round to round', g[g.length - 1] <= g[1] + 2, g);
      // (renderer.info.memory.textures drifts by the three of every picture taken for the Recents list although WebGL frees them, so the real
      // createTexture / deleteTexture calls are counted instead)
      const t = rows.map(r => r.cleared.glTex);
      check('the WebGL textures really alive after clearing do not grow from round to round', t[t.length - 1] <= t[1] + 2, t);
    } else console.log('   (the GPU counts are not available in this renderer: not checked)');
    if (rows.length >= 4) {
      const h = rows.map(r => r.heap), early = h[1], late = h[h.length - 1];
      check('the JS heap after clearing settles (last round within 25% and 40 MB of the second)', late <= Math.max(early * 1.25, early + 40), h);
    }
  }

  // ── files: broken input ──
  if (ONLY.includes('files')) {
    console.log('\n== files: broken input must not freeze or strand the app ==');
    const enc = (s) => Buffer.from(s, 'utf8').toString('base64');
    const bin = (b) => Buffer.from(b).toString('base64');
    const rnd = (n, seed = 7) => { const u = new Uint8Array(n); let x = seed; for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; u[i] = x >> 16; } return u; };
    const cases = [];
    const add = (name, b64) => cases.push({ name, b64 });
    // empty and noise, for every format
    for (const ext of ['glb', 'gltf', 'obj', 'stl', 'fbx', '3mf']) {
      add('empty.' + ext, '');
      add('noise.' + ext, bin(rnd(4096)));
      add('one-byte.' + ext, bin([0x41]));
    }
    // OBJ
    add('obj-nan.obj', enc('v 0 0 0\nv NaN 1 0\nv 1 Infinity 0\nf 1 2 3\n'));
    add('obj-index-past-end.obj', enc('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 99\nf -50 1 2\n'));
    add('obj-zero-area.obj', enc('v 0 0 0\nv 1 0 0\nv 2 0 0\nf 1 2 3\nf 1 1 1\n'));
    add('obj-no-faces.obj', enc('v 0 0 0\nv 1 0 0\nv 0 1 0\n'));
    add('obj-huge-coords.obj', enc('v 0 0 0\nv 1e38 0 0\nv 0 1e38 0\nf 1 2 3\n'));
    add('obj-binary-junk.obj', bin(rnd(2000, 3)));
    // STL: ascii with junk, binary claiming millions of triangles, binary with NaN
    add('stl-ascii-junk.stl', enc('solid x\n facet normal 0 0 1\n  outer loop\n   vertex a b c\n  endloop\n endfacet\nendsolid x\n'));
    { const b = new Uint8Array(84 + 50); new DataView(b.buffer).setUint32(80, 50000000, true); add('stl-lying-count.stl', bin(b)); }
    { const b = new Uint8Array(84 + 50); const dv = new DataView(b.buffer); dv.setUint32(80, 1, true); for (let i = 0; i < 12; i++) dv.setFloat32(84 + i * 4, NaN, true); add('stl-nan.stl', bin(b)); }
    { const b = new Uint8Array(84 + 50); new DataView(b.buffer).setUint32(80, 1, true); add('stl-all-zero-triangle.stl', bin(b)); }
    // glTF / GLB
    add('gltf-not-json.gltf', enc('{"asset": {"version": "2.0"'));
    add('gltf-no-buffers.gltf', enc(JSON.stringify({ asset: { version: '2.0' }, meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0 })));
    add('gltf-huge-accessor.gltf', enc(JSON.stringify({ asset: { version: '2.0' }, buffers: [{ byteLength: 36, uri: 'data:application/octet-stream;base64,' + bin(new Uint8Array(36)) }], bufferViews: [{ buffer: 0, byteLength: 36 }], accessors: [{ bufferView: 0, componentType: 5126, count: 2000000000, type: 'VEC3' }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0 })));
    add('gltf-node-cycle.gltf', enc(JSON.stringify({ asset: { version: '2.0' }, nodes: [{ children: [1] }, { children: [0] }], scenes: [{ nodes: [0] }], scene: 0 })));
    { // GLB whose header lies about its length
      const b = new Uint8Array(20); const dv = new DataView(b.buffer); dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, 999999999, true); dv.setUint32(12, 4000, true); dv.setUint32(16, 0x4E4F534A, true);
      add('glb-lying-length.glb', bin(b));
    }
    // FBX / 3MF
    add('fbx-header-only.fbx', bin(new TextEncoder().encode('Kaydara FBX Binary  \0\x1a\0\xe8\x1c\0\0')));
    add('fbx-ascii-junk.fbx', enc('; FBX 7.4.0 project file\nFBXHeaderExtension: {\n  Geometry: {\n    Vertices: *3 {\n      a: 1,2\n'));
    add('3mf-not-a-zip.3mf', bin(rnd(1000, 5)));
    add('3mf-zip-header-only.3mf', bin([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]));
    // a truncated copy of a real model, at several cuts
    // a truncated copy of a real model, at several cuts. The page cuts it itself when the case comes (the copies used to be made here as
    // base64, some 10 MB of text for a 5.7 MB model through the DevTools connection: longer than the harness waits, so it stopped there)
    for (const [n, cut] of [['12-bytes', '12'], ['40-bytes', '40'], ['one-third', 'third'], ['last-5-bytes-missing', 'minus5']]) cases.push({ name: 'truncated-' + n + '.glb', cut });

    let before = await sceneCounts();
    for (const c of cases) {
      const t0 = Date.now(); let verdict = 'ok', stuck = false;
      const errN = errors.length;
      try {
        await evalJS('window.__moResetScene(); true', 15000);
        if (c.cut) await openCut(c.name, c.cut); else await openBytes(c.name, c.b64);
        const s = await settle(45000);
        stuck = s < 0;
        // the page must still answer, and a toast, a model or nothing are all fine
        await evalJS('1 + 1', 10000);
      } catch (e) { verdict = e.message; stuck = true; }
      const parts = await liveParts().catch(() => -1);
      const newErrs = errors.length - errN;
      check(c.name + ' → ' + (stuck ? 'STUCK (' + verdict + ')' : parts + ' part(s)') + (newErrs ? ', ' + newErrs + ' uncaught' : '') + ' [' + (Date.now() - t0) + ' ms]', !stuck && newErrs === 0, { verdict, newErrs, err: errors.slice(errN, errN + 2) });
      if (stuck) {                                                  // a stuck loader would fail every case after it: reload and go on
        await send('Page.navigate', { url: URL + '?t=' + Date.now() }); await ready();
      }
    }
    // the app must still open a good file after all that
    await evalJS('window.__moResetScene(); true');
    await openFetched(MODEL);
    const s = await settle(90000);
    const good = await liveParts();
    check('after all of them the real model still opens', s >= 0 && good > 5, { settled: s, parts: good });
  }
} catch (e) { fail++; console.log('HARNESS ERROR:', e.message); }
console.log(`\n${pass} passed, ${fail} failed`);
console.log('page exceptions:', errors.length); errors.slice(0, 12).forEach(e => console.log('  ' + e));
try { ws && ws.close(); } catch (_) {}
chrome.kill();
process.exit(fail ? 1 : 0);
