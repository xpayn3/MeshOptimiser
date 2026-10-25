// node tests/e2e-bake-model.mjs
//
// Texture baking on a real model: the Gearbox Assy (inbox/GearboxAssy.glb, every part selected) reduced by 60 % onto one 2048 picture.
// Checks that it is done, that far fewer triangles are left and that every part wears one material; it writes the picture and a
// screenshot of the view to %TEMP% (bake-gearbox-atlas.png, bake-gearbox-view.png) to look at, and prints how long it took.
// Needs the app served on http://localhost:4242 (or APP_PORT), Chrome installed and Node 22+.
import { spawn } from 'child_process';
import fsm from 'fs';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9358, PROFILE = (process.env.TEMP || '.') + '/cdp-bake-model-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--mute-audio', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const tris = (name) => evalJS(`(window.state.parts.find(p => p.name === ${JSON.stringify(name)}) || {}).triCount`);
const info = (name) => evalJS(`(() => {
  const p = window.state.parts.find(q => q.name === ${JSON.stringify(name)}); if (!p) return null;
  const g = p.mesh.geometry, m = Array.isArray(p.mesh.material) ? p.mesh.material[0] : p.mesh.material, uv = g.attributes.uv;
  let lo = 9, hi = -9; if (uv) for (let i = 0; i < uv.array.length; i++) { lo = Math.min(lo, uv.array[i]); hi = Math.max(hi, uv.array[i]); }
  return { attrs: Object.keys(g.attributes).join(','), verts: g.attributes.position.count, indexed: !!g.index, tris: p.triCount, matId: m.uuid, hasMap: !!m.map, mapSize: m.map && m.map.image ? m.map.image.width : 0, uvLo: lo, uvHi: hi, groups: g.groups.length, hasColorAttr: !!g.attributes.color };
})()`);
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
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await evalJS("document.getElementById('welcome-close')?.click()");

  const glb = fsm.readFileSync('inbox/GearboxAssy.glb').toString('base64');
  await evalJS(`(() => { const b = Uint8Array.from(atob(${JSON.stringify(glb)}), c => c.charCodeAt(0)); window.__moOpenFile(new File([b], 'GearboxAssy.glb')); return true; })()`);
  for (let i = 0; i < 160; i++) { const n = await evalJS('window.state.parts.length').catch(() => 0); if (n >= 20) break; await sleep(500); }
  await sleep(3000);
  const n0 = await evalJS('window.state.parts.length'), t0 = await evalJS('window.state.parts.reduce((s, p) => s + (p.triCount|0), 0)');
  console.log('parts', n0, 'triangles', t0);
  await evalJS('window.state.selected.clear(); for (const p of window.state.parts) if (!p.deleted && p.mesh) window.state.selected.add(p.partId)');
  const t = Date.now();
  const r = await evalJS(`window.__moAgent.bakeTextures({ reduce_percent: 60, size: 2048, maps: ['colour', 'normals', 'occlusion'], quiet: true })`);
  console.log('took', ((Date.now() - t) / 1000).toFixed(1), 's', JSON.stringify(r).slice(0, 400));
  check('the whole gearbox is baked', r && r.ok && r.parts > 20, r && { ok: r.ok, parts: r.parts, why: r.why });
  const t1 = await evalJS('window.state.parts.reduce((s, p) => s + (p.triCount|0), 0)');
  check('far fewer triangles', t1 < t0 * 0.6, [t0, t1]);
  const mats = await evalJS('new Set(window.state.parts.filter(p => p.mesh).map(p => (Array.isArray(p.mesh.material) ? p.mesh.material[0] : p.mesh.material).uuid)).size');
  check('all on one material', mats === 1, mats);
  const maps = await evalJS(`(() => { const p = window.state.parts.find(q => q.mesh); const m = Array.isArray(p.mesh.material) ? p.mesh.material[0] : p.mesh.material; return { map: m.map && m.map.image.width, normal: m.normalMap && m.normalMap.image.width, ao: m.aoMap && m.aoMap.image.width, sy: m.normalScale.y }; })()`);
  check('it has the colour, normal and occlusion maps (the last at half the size)', maps.map === 2048 && maps.normal === 2048 && maps.ao === 1024 && maps.sy === -1, maps);
  const dumpMaps = await evalJS(`(() => { const p = window.state.parts.find(q => q.mesh); const m = Array.isArray(p.mesh.material) ? p.mesh.material[0] : p.mesh.material; const out = []; for (const t of [m.normalMap, m.aoMap]) { const c = document.createElement('canvas'); c.width = c.height = 1024; c.getContext('2d').drawImage(t.image, 0, 0, 1024, 1024); out.push(c.toDataURL('image/png')); } return out; })()`);
  fsm.writeFileSync((process.env.TEMP || '.') + '/bake-gearbox-normals.png', Buffer.from(dumpMaps[0].split(',')[1], 'base64'));
  fsm.writeFileSync((process.env.TEMP || '.') + '/bake-gearbox-ao.png', Buffer.from(dumpMaps[1].split(',')[1], 'base64'));
  const dump = await evalJS(`(() => { const p = window.state.parts.find(q => q.mesh); const m = Array.isArray(p.mesh.material) ? p.mesh.material[0] : p.mesh.material; const im = m.map.image; const out = document.createElement('canvas'); out.width = out.height = 1024; out.getContext('2d').drawImage(im, 0, 0, 1024, 1024); return out.toDataURL('image/png'); })()`);
  fsm.writeFileSync((process.env.TEMP || '.') + '/bake-gearbox-atlas.png', Buffer.from(dump.split(',')[1], 'base64'));
  await evalJS("window.state.selected.clear()");
  await sleep(1200);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fsm.writeFileSync((process.env.TEMP || '.') + '/bake-gearbox-view.png', Buffer.from(shot.data, 'base64'));
  // the UV layout beside the viewport, the colour picture behind it
  await evalJS("window.state.selected.clear(); for (const p of window.state.parts) if (!p.deleted && p.mesh) window.state.selected.add(p.partId)");
  await evalJS("window.__moUvSplit.toggle(true)"); await sleep(2500);
  const ob = await evalJS("document.querySelector('#uv-bg button[data-b=\"map\"]')?.click(), 1"); await sleep(800);
  const shotUv = await send('Page.captureScreenshot', { format: 'png' });
  fsm.writeFileSync((process.env.TEMP || '.') + '/bake-gearbox-uv.png', Buffer.from(shotUv.data, 'base64'));
  check('the UV layout shows the whole selection', /95 parts/.test(await evalJS("document.getElementById('uv-which').textContent")));
  // The pointer moving over the layout of the whole Gearbox (258,000 triangles), in each pick mode: a frame must stay cheap
  for (const mode of ['point', 'edge', 'face', 'island']) {
    const ms = await evalJS(`(async () => {
      const T = window.__moUvSplit._t; T.setMode('${mode}'); T.setTool('select'); await new Promise(r => setTimeout(r, 1800));      // (a change between Points and the others draws the layout again once)
      const c = document.getElementById('uv-canvas'), r = c.getBoundingClientRect(), t0 = performance.now(); let n = 0;
      for (let i = 0; i < 40; i++) { c.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + 60 + i * 9, clientY: r.top + 120 + i * 5, pointerId: 1, bubbles: true })); await new Promise(rr => requestAnimationFrame(rr)); n++; }
      return (performance.now() - t0) / n;
    })()`);
    check('moving the pointer over 258,000 triangles in ' + mode + ' mode costs under 60 ms a frame', ms < 60, ms);
    console.log('  hover frame, ' + mode + ': ' + ms.toFixed(1) + ' ms');
  }
  // Dragging one island across the layout of the whole Gearbox: a frame must stay cheap
  {
    const info = await evalJS(`(async () => {
      const T = window.__moUvSplit._t; T.selectNone(); T.setMode('island'); T.setTool('select'); await new Promise(r => setTimeout(r, 300));
      const c = document.getElementById('uv-canvas'), r = c.getBoundingClientRect(), w = T.view, W = c.clientWidth, H = c.clientHeight;
      const px = (u, v) => [r.left + (u - w.cx) * w.s + W / 2, r.top + (v - w.cy) * w.s + H / 2];
      const ev = (t, x, y) => c.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, button: 0, pointerId: 1, bubbles: true }));
      // an island: the one under a few places of the square, the first that has one
      let picked = 0, at = null;
      for (const [u, v] of [[0.2, 0.15], [0.5, 0.2], [0.3, 0.3], [0.6, 0.4], [0.15, 0.5], [0.8, 0.1]]) { const [x, y] = px(u, v); ev('pointerdown', x, y); ev('pointerup', x, y); await new Promise(rr => setTimeout(rr, 120)); picked = T.sel.reduce((a, b) => a + b, 0); if (picked > 3) { at = [x, y]; break; } }
      if (!at) return { picked: 0 };
      T.setTool('move'); await new Promise(rr => setTimeout(rr, 200));
      // (a heavy layout with an island picked: the layout without it is made in the background; a person takes a moment to start a drag)
      let waited = 0; while (!T.prepared && waited < 20000) { await new Promise(rr => setTimeout(rr, 100)); waited += 100; }
      window.__prepWait = waited;
      ev('pointerdown', at[0], at[1]);
      const t0 = performance.now(); let n = 0;
      const fr = []; for (let i = 1; i <= 40; i++) { const f0 = performance.now(); ev('pointermove', at[0] + i * 6, at[1] + i * 3); await new Promise(rr => requestAnimationFrame(rr)); fr.push(performance.now() - f0); if (i === 1) window.__prof1 = Object.assign({}, window.__moUvSplit._t.prof); n++; } window.__fr = fr;
      const ms = (performance.now() - t0) / n;
      ev('pointerup', at[0] + 240, at[1] + 120);
      await new Promise(rr => setTimeout(rr, 1500));
      const frs = window.__fr.slice().sort((x, y) => x - y); return { picked, ms, prepWaitMs: window.__prepWait, first: window.__fr[0], median: frs[20], max: frs[39], prof: window.__prof1 };
    })()`);
    check('an island was picked to drag', info.picked > 3, info);
    check('dragging it over 258,000 triangles costs under 60 ms a frame', info.ms < 60, info);
    console.log('  drag frame: ' + (info.ms || 0).toFixed(1) + ' ms (' + info.picked + ' points picked); first ' + (info.first || 0).toFixed(0) + ' median ' + (info.median || 0).toFixed(0) + ' max ' + (info.max || 0).toFixed(0) + ' ms; prepared after ' + info.prepWaitMs + ' ms; paint ' + JSON.stringify(info.prof));
    await evalJS("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))"); await sleep(1500);
  }
  // Pack on thousands of islands: every triangle must change its UV area by the one factor (nothing dragged across the layout)
  const areasOf = () => evalJS(`(() => { const d = window.__moUvSplit._t.data, U = d.UV, I = d.I, out = []; for (let t = 0; t < I.length; t += 3) { const a = I[t] * 2, b = I[t + 1] * 2, c = I[t + 2] * 2; out.push(Math.abs((U[b] - U[a]) * (U[c + 1] - U[a + 1]) - (U[c] - U[a]) * (U[b + 1] - U[a + 1])) / 2); } return out; })()`);
  const g0 = await areasOf();
  await evalJS("window.__moUvSplit._t.selectNone(); window.__moUvSplit._t.pack()"); await sleep(4000);
  const g1 = await areasOf();
  // (thin triangles are left out: their area is lost in the precision of the numbers; the rest agree to within a few percent)
  { const q = []; for (let i = 0; i < g0.length; i++) if (g0[i] > 5e-7) q.push(g1[i] / g0[i]); q.sort((a, b) => a - b); const med = q[q.length >> 1], p5 = q[Math.floor(q.length * 0.05)], p95 = q[Math.floor(q.length * 0.95)], bad = q.filter(x => x < med * 0.9 || x > med * 1.1).length;
    check('Pack on the Gearbox scales every triangle by the same factor', q.length > 1000 && p5 > med * 0.97 && p95 < med * 1.03 && bad < q.length * 0.005, { med, p5, p95, bad, n: q.length }); }
  // How long each operation takes on the whole layout (258,000 triangles): the numbers to watch
  // (all 258,000 triangles picked in island mode: drawing the pick used to take minutes in headless Chrome, a closePath per triangle; it is drawn in seconds now)
  {
    const times = {};
    await evalJS("(() => { const T = window.__moUvSplit._t; T.setMode('island'); T.setTool('select'); T.selectAll(); return true; })()"); await sleep(500);
    const OPS = [['refresh (read the numbers again)', 'await T.refresh(true, true)'], ['select all', 'T.selectAll()'], ['pack', 'T.pack()'], ['fit', 'T.fitSquare()'], ['density (even out)', 'T.density()'], ['set density', 'T.setDensity(10)'], ['orient', 'T.orient()'], ['distribute', "T.distribute('h')"], ['flip', 'T.flipH()'], ['relax', 'T.relax()'], ['project sphere', "T.projectPoints('sphere')"], ['stretch score', 'T.stretchScore()']];
    for (const [name, code] of OPS) {
      const r = await Promise.race([evalJS(`(async () => { const T = window.__moUvSplit._t; const t0 = performance.now(); ${code}; return Math.round(performance.now() - t0); })()`), sleep(120000).then(() => 'TIMEOUT')]);
      times[name] = r; console.log('    ' + name + ': ' + r + ' ms');
      if (r === 'TIMEOUT') break;
      await sleep(400);
    }
    console.log('  OPERATION TIMES (ms) on the Gearbox layout:', JSON.stringify(times));
    check('no operation on the 258,000-triangle layout takes more than 6 s', Object.values(times).every((v) => typeof v === 'number' && v < 6000), times);
  }
  console.log('pictures: %TEMP%/bake-gearbox-atlas.png, bake-gearbox-view.png and bake-gearbox-uv.png');
} catch (e) { fail++; console.log('HARNESS ERROR:', e.message); }
console.log(`\n${pass} passed, ${fail} failed`);
console.log('page exceptions:', errors.length); errors.slice(0, 12).forEach(e => console.log('  ' + e));
try { ws && ws.close(); } catch (_) {}
chrome.kill();
process.exit(fail ? 1 : 0);
