// node tests/e2e-uv-split.mjs
//
// The UV layout as a split view, in the real app in headless Chrome. A sphere and a box are opened and baked (Bake textures gives them
// UVs and a picture). Then the button at the foot of the tool pill: the pane opens beside the viewport, the left sidebar folds away and
// the viewport gets narrower; nothing selected says so; the selected parts are drawn (islands, edges, the stats), the Colour picture
// shows behind them, a wheel zoom and a double-click fit move the view; closing puts the viewport and the left sidebar back, and a left
// sidebar that was already folded stays folded.
// Needs the app served on http://localhost:4242 (or APP_PORT), Chrome installed and Node 22+.
import { spawn } from 'child_process';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9359, PROFILE = (process.env.TEMP || '.') + '/cdp-uv-split-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const v = [], f = [];
const V = (x, y, z) => { v.push(`v ${x} ${y} ${z}`); return v.length; };
{
  f.push('o sphere_red');
  const nu = 48, nv = 32, r = 20, id = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const a = 2 * Math.PI * i / nu, b = Math.PI * j / nv; id.push(V(r * Math.sin(b) * Math.cos(a), r * Math.cos(b), r * Math.sin(b) * Math.sin(a))); }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + nu + 1; if (j > 0) f.push(`f ${id[a]} ${id[b]} ${id[a + 1]}`); if (j < nv - 1) f.push(`f ${id[a + 1]} ${id[b]} ${id[b + 1]}`); }
}
{
  f.push('o box_blue');
  const s = 15, o = 60, c = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]].map(p => V(o + p[0] * s, p[1] * s, p[2] * s));
  for (const q of [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [3, 0, 4, 7]]) f.push(`f ${c[q[0]]} ${c[q[1]]} ${c[q[2]]} ${c[q[3]]}`);
}
const objText = v.join('\n') + '\n' + f.join('\n') + '\n';

const chrome = spawn(CH, ['--headless=new', '--mute-audio', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const canvasW = () => evalJS("document.getElementById('canvas').clientWidth");
const uvPixels = () => evalJS(`(() => {
  const c = document.getElementById('uv-canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let any = 0, red = 0, green = 0, bright = 0;
  for (let i = 0; i < d.length; i += 4) { if (!d[i + 3]) continue; any++; if (d[i] > d[i + 1] + 60 && d[i] > d[i + 2] + 60) red++; else if (d[i + 1] > d[i] + 60 && d[i + 1] > d[i + 2] + 60) green++; if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) bright++; }
  return { any, red, green, bright, w: c.width, h: c.height };
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
  await evalJS(`(() => { window.__moOpenFile(new File([${JSON.stringify(objText)}], 'uv.obj')); return true; })()`);
  for (let i = 0; i < 20; i++) {
    if (await evalJS("document.getElementById('import-modal')?.classList.contains('show')").catch(() => false)) { await evalJS("document.querySelector('#import-modal-confirm')?.click()"); break; }
    await sleep(250);
  }
  for (let i = 0; i < 120; i++) { const n = await evalJS('window.state.parts.length').catch(() => 0); if (n >= 2) break; await sleep(500); }
  await sleep(1500);
  check('the pane is not there to begin with', await evalJS("document.getElementById('uv-pane').hidden && !document.body.classList.contains('uv-split')"));
  check('there is a button for it in the tool pill', await evalJS("!!document.getElementById('tg-uv')"));

  // ── a part with no UVs ──
  await evalJS('window.state.selected.clear(); window.state.selected.add(window.state.parts[0].partId)');
  const w0 = await canvasW(), leftOpen0 = await evalJS("!document.body.classList.contains('left-collapsed')");
  await evalJS("document.getElementById('tg-uv').click()"); await sleep(900);
  for (let i = 0; i < 40; i++) { if (await evalJS("document.getElementById('uv-pane').getBoundingClientRect().width > 300")) break; await sleep(150); }      // (the slide starts on a frame: a busy page may be late)
  check('the button opens the pane beside the viewport', await evalJS("!document.getElementById('uv-pane').hidden && document.body.classList.contains('uv-split') && document.getElementById('tg-uv').getAttribute('aria-pressed') === 'true'"));
  check('the left sidebar is folded away', leftOpen0 && await evalJS("document.body.classList.contains('left-collapsed')"), leftOpen0);
  const geo = await evalJS(`(() => { const a = document.getElementById('viewport').getBoundingClientRect(), b = document.getElementById('uv-pane').getBoundingClientRect(), c = document.getElementById('sidebar-right').getBoundingClientRect(); return { vp: [a.left, a.right], uv: [b.left, b.right, b.height], right: [c.left, c.right] }; })()`);
  check('the viewport is on the left, the layout right of it, the right sidebar after that', geo.vp[1] <= geo.uv[0] + 2 && geo.uv[1] <= geo.right[0] + 2 && geo.uv[1] - geo.uv[0] > 300 && geo.uv[2] > 300, geo);
  await sleep(600);
  const w1 = await canvasW();
  check('the 3D view is narrower by the share the pane took (and was resized to it)', w1 > 300 && w1 < w0 * 0.85, [w0, w1]);
  check('a part with no texture coordinates says so', /has no texture coordinates/.test(await evalJS("document.getElementById('uv-empty').textContent")), await evalJS("document.getElementById('uv-empty').textContent"));

  // ── nothing selected ──
  await evalJS('window.state.selected.clear()'); await sleep(800);
  check('nothing selected says to select a part', /Select a part/.test(await evalJS("document.getElementById('uv-empty').textContent")));

  // ── baked parts have a layout to show ──
  await evalJS('window.state.selected.clear(); for (const p of window.state.parts) window.state.selected.add(p.partId)');
  const bk = await evalJS(`window.__moAgent.bakeTextures({ reduce_percent: 50, size: 1024, maps: ['colour'], quiet: true })`);
  await sleep(1200);
  check('the parts are baked (they now have UVs)', bk && bk.ok, bk);
  await evalJS("document.getElementById('uv-bg').querySelector('button[data-b=\"none\"]').click()"); await sleep(300);
  const which = await evalJS("document.getElementById('uv-which').textContent"), nStats = await evalJS("document.getElementById('uv-stats').children.length");
  check('the selected parts are named and the numbers are there', /2 parts/.test(which) && nStats >= 3, [which, nStats]);
  const p0 = await uvPixels();
  check('the layout is drawn: the square, the edges, the rims', p0.any > 8000 && p0.bright > 200, p0);
  check('Colour is offered now that the parts have a picture', await evalJS("!document.querySelector('#uv-bg button[data-b=\"map\"]').disabled"));
  check('Normal is not offered (none was baked)', await evalJS("document.querySelector('#uv-bg button[data-b=\"normal\"]').disabled"));
  await evalJS("document.querySelector('#uv-bg button[data-b=\"map\"]').click()"); await sleep(500);
  const p1 = await uvPixels();
  check('the Colour picture shows behind the layout (red sphere and blue box colours)', p1.any > p0.any * 0.9, [p0.any, p1.any]);

  // ── zoom and fit ──
  const before = await evalJS("(() => { const c = document.getElementById('uv-canvas'); return c.toDataURL().length; })()");
  await evalJS(`(() => { const c = document.getElementById('uv-canvas'), r = c.getBoundingClientRect(); c.dispatchEvent(new WheelEvent('wheel', { deltaY: -400, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true })); })()`);
  await sleep(300);
  const zoomed = await evalJS("(() => { const c = document.getElementById('uv-canvas'); return c.toDataURL().length; })()");
  check('a wheel zooms the layout', zoomed !== before, [before, zoomed]);
  await evalJS("document.getElementById('uv-canvas').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))"); await sleep(300);
  const fitted = await evalJS("(() => { const c = document.getElementById('uv-canvas'); return c.toDataURL().length; })()");
  check('a double-click fits it again (the same view as a second fit)', fitted !== zoomed && fitted > 0, [before, zoomed, fitted]);

  // ── editing ──
  const T = 'window.__moUvSplit._t';
  const uvOf = (name) => evalJS(`(() => { const p = window.state.parts.find(q => q.name === ${JSON.stringify(name)}); return Array.from(p.mesh.geometry.attributes.uv.array.slice(0, 16)); })()`);
  const clickAt = async (u, v) => { await evalJS(`(() => { const c = document.getElementById('uv-canvas'), r = c.getBoundingClientRect(), w = ${T}.view, W = c.clientWidth, H = c.clientHeight, x = r.left + (${u} - w.cx) * w.s + W / 2, y = r.top + (${v} - w.cy) * w.s + H / 2; for (const t of ['pointerdown', 'pointerup']) c.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, button: 0, pointerId: 1, bubbles: true })); })()`); await sleep(150); };
  check('the toolbar is at the foot of the pane, under the layout', await evalJS("(() => { const a = document.getElementById('uv-canvas').getBoundingClientRect(), b = document.getElementById('uv-tbar') || document.querySelector('.uv-tbar'), r = b.getBoundingClientRect(); return r.top >= a.bottom - 1 && r.height > 60; })()"));
  check('it has the tools, the pick modes and the layout buttons', await evalJS("['select', 'move', 'rotate', 'scale'].every(t => document.querySelector('[data-tool=\"' + t + '\"]')) && ['point', 'edge', 'face', 'island'].every(t => document.querySelector('[data-mode=\"' + t + '\"]')) && ['pack', 'fit', 'density', 'unwrap', 'project'].every(a => document.querySelector('[data-act=\"' + a + '\"]'))"));
  check('with nothing picked the tools that need a pick are off', await evalJS("document.getElementById('uv-f-u').disabled"));
  await evalJS(`${T}.selectAll()`); await sleep(200);
  check('All picks every point, and the numbers show the whole layout', await evalJS(`${T}.sel.every(x => x === 1) && !document.getElementById('uv-f-w').disabled && +document.getElementById('uv-f-w').value > 0.3`));
  await evalJS(`${T}.selectNone()`); await sleep(100);
  check('None picks nothing', await evalJS(`${T}.sel.every(x => x === 0)`));
  // each pick mode picks what it says: one point, one edge, one face, one island
  const counts = () => evalJS(`(() => { const d = ${T}.data, s = ${T}.sel, I = d.I; let pts = 0, faces = 0; for (let i = 0; i < s.length; i++) pts += s[i]; for (let t = 0; t < I.length; t += 3) if (s[I[t]] && s[I[t + 1]] && s[I[t + 2]]) faces++; return { pts, faces, twins: d.gOff[1] - d.gOff[0] }; })()`);
  // (a triangle well inside the square and not tiny: its corners and its middle in UV)
  const tri = await evalJS(`(() => { const d = ${T}.data, U = d.UV, I = d.I; let best = -1, ba = 0; for (let t = 0; t < I.length; t += 3) { const a = I[t] * 2, b = I[t + 1] * 2, c = I[t + 2] * 2, ar = Math.abs((U[b] - U[a]) * (U[c + 1] - U[a + 1]) - (U[c] - U[a]) * (U[b + 1] - U[a + 1])) / 2; if (ar > ba) { ba = ar; best = t; } } const a = I[best] * 2, b = I[best + 1] * 2, c = I[best + 2] * 2; return { a: [U[a], U[a + 1]], b: [U[b], U[b + 1]], c: [U[c], U[c + 1]] }; })()`);
  await evalJS(`${T}.setTool('select')`); await evalJS(`${T}.selectNone()`);
  await evalJS(`${T}.setMode('point')`); await clickAt(tri.a[0], tri.a[1]);
  let c1 = await counts();
  check('a click in Points mode picks one point (and its twins), not a face', c1.pts >= 1 && c1.pts <= 6 && c1.faces === 0, c1);
  await evalJS(`${T}.selectNone()`);
  await evalJS(`${T}.setMode('edge')`); await clickAt((tri.a[0] + tri.b[0]) / 2, (tri.a[1] + tri.b[1]) / 2);
  c1 = await counts();
  check('a click in Edges mode picks the two ends of an edge, not a face', c1.pts >= 2 && c1.pts <= 12 && c1.faces === 0, c1);
  await evalJS(`${T}.selectNone()`);
  await evalJS(`${T}.setMode('face')`); await clickAt((tri.a[0] + tri.b[0] + tri.c[0]) / 3, (tri.a[1] + tri.b[1] + tri.c[1]) / 3);
  c1 = await counts();
  check('a click in Faces mode picks one face (its three points)', c1.faces >= 1 && c1.faces <= 3 && c1.pts >= 3 && c1.pts <= 18, c1);
  await evalJS(`${T}.selectNone()`);
  await evalJS(`${T}.setMode('point')`); await clickAt(tri.a[0], tri.a[1]);
  await evalJS(`(() => { const c = document.getElementById('uv-canvas'), r = c.getBoundingClientRect(), w = ${T}.view, W = c.clientWidth, H = c.clientHeight, x = r.left + (${tri.b[0]} - w.cx) * w.s + W / 2, y = r.top + (${tri.b[1]} - w.cy) * w.s + H / 2; for (const t of ['pointerdown', 'pointerup']) c.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, button: 0, shiftKey: true, pointerId: 1, bubbles: true })); })()`); await sleep(150);
  c1 = await counts();
  check('Shift adds a second point to the first', c1.pts >= 2 && c1.faces === 0, c1);
  await evalJS(`${T}.selectNone()`);

  // what is drawn follows the pick mode: faces are filled only in Faces and Islands, however many points are picked
  await evalJS("document.querySelector('#uv-bg button[data-b=\"none\"]').click()"); await sleep(200);
  // what is drawn follows the pick mode, in the viewport's colours: a face picked is filled orange; three points picked in Points mode are three orange discs
  const pixelAt = (u, v) => evalJS(`(() => { const c = document.getElementById('uv-canvas'), w = ${T}.view, W = c.clientWidth, H = c.clientHeight, k = c.width / W, x = Math.round(((${u} - w.cx) * w.s + W / 2) * k), y = Math.round(((${v} - w.cy) * w.s + H / 2) * k), d = c.getContext('2d').getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2]]; })()`);
  const mid = [(tri.a[0] + tri.b[0] + tri.c[0]) / 3, (tri.a[1] + tri.b[1] + tri.c[1]) / 3];
  const shiftClick = async (u, v) => { await evalJS(`(() => { const c = document.getElementById('uv-canvas'), r = c.getBoundingClientRect(), w = ${T}.view, W = c.clientWidth, H = c.clientHeight, x = r.left + (${u} - w.cx) * w.s + W / 2, y = r.top + (${v} - w.cy) * w.s + H / 2; for (const t of ['pointerdown', 'pointerup']) c.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, button: 0, shiftKey: true, pointerId: 1, bubbles: true })); })()`); await sleep(120); };
  await evalJS(`${T}.selectNone()`); await evalJS(`${T}.setMode('point')`);
  for (const p of [tri.a, tri.b, tri.c]) await shiftClick(p[0], p[1]);
  await sleep(250);
  const inPoints = await pixelAt(mid[0], mid[1]);
  await evalJS(`${T}.selectNone()`); await evalJS(`${T}.setMode('face')`); await clickAt(mid[0], mid[1]); await sleep(250);
  const inFaces = await pixelAt(mid[0], mid[1]);
  await evalJS(`${T}.selectNone()`); await sleep(100);
  const warm = (p) => p[0] - p[2];
  check('three points picked in Points mode leave the face between them unfilled; a face picked in Faces mode is filled orange', warm(inFaces) > 70 && inFaces[0] > 110 && warm(inPoints) < 40, [inPoints, inFaces]);
  await evalJS(`${T}.setMode('face')`);
  // the right-click menu
  const rect = await evalJS("(() => { const r = document.getElementById('uv-canvas').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()");
  const rightClick = async (x, y) => { await evalJS(`(() => { const c = document.getElementById('uv-canvas'); for (const t of ['pointerdown', 'pointerup']) c.dispatchEvent(new PointerEvent(t, { clientX: ${x}, clientY: ${y}, button: 2, pointerId: 1, bubbles: true })); c.dispatchEvent(new MouseEvent('contextmenu', { clientX: ${x}, clientY: ${y}, button: 2, bubbles: true, cancelable: true })); })()`); await sleep(250); };
  await rightClick(rect.l + rect.w / 2, rect.t + rect.h / 2);
  const labels = await evalJS("[...document.querySelectorAll('#ctx-menu > .ctx-menu-row .ctx-menu-label')].map(e => e.textContent)");
  check('a right click opens the menu with the UV commands', ['Pick all', 'Pick none', 'Invert the pick', 'Flip across', 'Arrange', 'Pack the islands', 'Unwrap the parts', 'Project…', 'Pick mode', 'Tool', 'View'].every(l => labels.includes(l)), labels);
  check('the menu names the island under the pointer first', labels.length && /island|face/i.test(labels[0]), labels.slice(0, 3));
  check('with nothing picked the commands that need a pick are dimmed', await evalJS("[...document.querySelectorAll('#ctx-menu > .ctx-menu-row')].filter(r => /^Flip across|^Turn a quarter/.test(r.textContent)).every(r => r.classList.contains('is-off'))"));
  await evalJS("[...document.querySelectorAll('#ctx-menu > .ctx-menu-row')].find(r => /^Pick this island/.test(r.textContent))?.click()"); await sleep(300);
  const pickedPts = await evalJS(`${T}.sel.reduce((a, b) => a + b, 0)`);
  check('Pick this island picks it', pickedPts > 3, pickedPts);
  await rightClick(rect.l + rect.w / 2, rect.t + rect.h / 2);
  check('with a pick the commands are on', await evalJS("[...document.querySelectorAll('#ctx-menu > .ctx-menu-row')].filter(r => /^Flip across|^Turn a quarter/.test(r.textContent)).every(r => !r.classList.contains('is-off'))"));
  await evalJS("document.getElementById('ctx-menu').style.display = 'none'"); await evalJS(`${T}.selectNone()`);
  // a right DRAG pans and does not open the menu
  await evalJS(`(() => { const c = document.getElementById('uv-canvas'); const ev = (t, x, y) => c.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, button: 2, pointerId: 1, bubbles: true })); ev('pointerdown', ${rect.l + 100}, ${rect.t + 100}); ev('pointermove', ${rect.l + 160}, ${rect.t + 140}); ev('pointerup', ${rect.l + 160}, ${rect.t + 140}); })()`); await sleep(200);
  check('a right drag pans and opens no menu', await evalJS("document.getElementById('ctx-menu').style.display !== 'block'"));
  await evalJS("document.getElementById('uv-canvas').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))"); await sleep(200);

  // a box over the middle of the square picks faces
  await evalJS(`${T}.setMode('face')`); await evalJS(`${T}.setTool('select')`);
  await evalJS(`(() => { const c = document.getElementById('uv-canvas'), r = c.getBoundingClientRect(), w = ${T}.view, W = c.clientWidth, H = c.clientHeight, X = (u) => r.left + (u - w.cx) * w.s + W / 2, Y = (v) => r.top + (v - w.cy) * w.s + H / 2; const ev = (t, x, y) => c.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, button: 0, pointerId: 1, bubbles: true })); ev('pointerdown', X(-0.02), Y(-0.02)); ev('pointermove', X(1.02), Y(1.02)); ev('pointerup', X(1.02), Y(1.02)); })()`);
  await sleep(250);
  const picked = await evalJS(`${T}.sel.reduce((a, b) => a + b, 0)`), total = await evalJS(`${T}.sel.length`);
  check('a box over the whole square picks all the faces', picked === total && total > 0, [picked, total]);
  // move: the picked points move, and one undo puts them back
  const uv0 = await uvOf('sphere_red');
  await evalJS(`${T}.setTool('move')`);
  await evalJS(`(() => { const c = document.getElementById('uv-canvas'), r = c.getBoundingClientRect(), w = ${T}.view, W = c.clientWidth, H = c.clientHeight, X = (u) => r.left + (u - w.cx) * w.s + W / 2, Y = (v) => r.top + (v - w.cy) * w.s + H / 2; const ev = (t, x, y) => c.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, button: 0, pointerId: 1, bubbles: true })); ev('pointerdown', X(0.5), Y(0.5)); ev('pointermove', X(0.5) + 20, Y(0.5)); ev('pointermove', X(0.5) + 60, Y(0.5) + 30); window.__uvStaleDuring = ${T}.data.coverStale; ev('pointerup', X(0.5) + 60, Y(0.5) + 30); })()`);
  await sleep(500);
  const uv1 = await uvOf('sphere_red');
  check('while an island is moved the old shape is not left where it was (the covered-area picture is put away, the outline follows the points)', await evalJS("window.__uvStaleDuring === true && window.__moUvSplit._t.data.rim.length > 0"));
  check('Move moves the picked points', Math.abs(uv1[0] - uv0[0]) > 0.01 && Math.abs(uv1[1] - uv0[1]) > 0.005, [uv0.slice(0, 2), uv1.slice(0, 2)]);
  await evalJS("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))"); await sleep(600);
  const uv2 = await uvOf('sphere_red');
  check('one undo puts them back', Math.abs(uv2[0] - uv0[0]) < 1e-6 && Math.abs(uv2[1] - uv0[1]) < 1e-6, [uv0.slice(0, 2), uv2.slice(0, 2)]);
  await evalJS("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }))"); await sleep(600);
  const uv3 = await uvOf('sphere_red');
  check('and one redo does it again', Math.abs(uv3[0] - uv1[0]) < 1e-6, [uv1.slice(0, 2), uv3.slice(0, 2)]);
  await evalJS("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))"); await sleep(600);
  // a drag, frame by frame: a face is picked and moved, and a frame must stay cheap (the layout under it is not drawn again while it moves)
  await evalJS(`${T}.selectNone()`); await evalJS(`${T}.setMode('face')`); await clickAt(mid[0], mid[1]); await sleep(200); await evalJS(`${T}.setTool('move')`);
  const dragAvg = await evalJS(`(async () => {
    const c = document.getElementById('uv-canvas'), rc = c.getBoundingClientRect(), w = ${T}.view, W = c.clientWidth, H = c.clientHeight, X = (u) => rc.left + (u - w.cx) * w.s + W / 2, Y = (v) => rc.top + (v - w.cy) * w.s + H / 2;
    const ev = (t, x, y) => c.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, button: 0, pointerId: 1, bubbles: true }));
    ev('pointerdown', X(${mid[0]}), Y(${mid[1]})); const t0 = performance.now(); let n = 0;
    for (let i = 1; i <= 24; i++) { ev('pointermove', X(${mid[0]}) + i * 4, Y(${mid[1]}) + i * 2); await new Promise(rr => requestAnimationFrame(rr)); n++; }
    const avg = (performance.now() - t0) / n; ev('pointerup', X(${mid[0]}) + 100, Y(${mid[1]}) + 50); await new Promise(rr => setTimeout(rr, 700)); return avg;
  })()`);
  console.log('  drag frame on the small model: ' + dragAvg.toFixed(1) + ' ms');
  check('dragging a picked face costs under 40 ms a frame', dragAvg < 40, dragAvg);
  await evalJS("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))"); await sleep(800);
  await evalJS(`${T}.selectNone()`);

  // the numbers, a flip, the square
  await evalJS(`${T}.selectAll()`); await sleep(200);
  const bb0 = await evalJS(`${T}.selBox()`);
  await evalJS("(() => { const el = document.getElementById('uv-f-w'); el.value = String(+el.value / 2); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()"); await sleep(600);
  const bb1 = await evalJS(`${T}.selBox()`);
  check('typing half the width halves it, about the middle, and keeps the proportions (the link is on)', Math.abs(bb1.w - bb0.w / 2) < 0.01 && Math.abs(bb1.h - bb0.h / 2) < 0.01 && Math.abs(bb1.cu - bb0.cu) < 0.01, [bb0, bb1]);
  await evalJS(`${T}.flipH()`); await sleep(500);
  const bb2 = await evalJS(`${T}.selBox()`);
  check('flip keeps the box', Math.abs(bb2.w - bb1.w) < 1e-3 && Math.abs(bb2.cu - bb1.cu) < 1e-3);
  await evalJS("document.querySelector('[data-act=\"fit\"]').click()"); await sleep(500);
  const bb3 = await evalJS(`${T}.selBox()`);
  check('Fit puts everything into the square, in proportion', bb3.u0 >= -1e-3 && bb3.u1 <= 1 + 1e-3 && bb3.v0 >= -1e-3 && bb3.v1 <= 1 + 1e-3 && Math.max(bb3.w, bb3.h) > 0.98, bb3);
  // (every triangle changes its UV area by the same factor under Pack: one scale for all, and nothing dragged off by a point two islands share)
  const triAreas = () => evalJS(`(() => { const d = ${T}.data, U = d.UV, I = d.I, out = []; for (let t = 0; t < I.length; t += 3) { const a = I[t] * 2, b = I[t + 1] * 2, c = I[t + 2] * 2; out.push(Math.abs((U[b] - U[a]) * (U[c + 1] - U[a + 1]) - (U[c] - U[a]) * (U[b + 1] - U[a + 1])) / 2); } return out; })()`);
  const areas0 = await triAreas();
  await evalJS("document.querySelector('[data-act=\"pack\"]').click()"); await sleep(700);
  const areas1 = await triAreas();
  { let lo = Infinity, hi = 0, n = 0; for (let i = 0; i < areas0.length; i++) { if (areas0[i] < 1e-7) continue; const q = areas1[i] / areas0[i]; if (q < lo) lo = q; if (q > hi) hi = q; n++; } check('Pack scales every triangle by the same factor (no triangle is dragged across the layout)', n > 50 && hi / lo < 1.02, { lo, hi, n }); }
  const bb4 = await evalJS(`${T}.selBox()`);
  check('Pack puts the islands into the square', bb4.u0 >= -1e-3 && bb4.u1 <= 1 + 1e-3 && bb4.v0 >= -1e-3 && bb4.v1 <= 1 + 1e-3, bb4);
  const st = await evalJS("document.getElementById('uv-stats').textContent");
  check('and nothing lies on another island afterwards', /no overlap/.test(st) && !/outside the square/.test(st), st);
  await evalJS("document.querySelector('[data-act=\"density\"]').click()"); await sleep(600);
  check('Density does not push anything out of the square it was in (the numbers are read again)', await evalJS("document.getElementById('uv-stats').children.length > 0"));
  // ── arranging: distribute, orient, line up, density, flipped, relax, stretch, pack with turns ──
  const bigMid = () => evalJS(`(() => { const d = ${T}.data, U = d.UV, I = d.I; let best = -1, ba = 0; for (let t = 0; t < I.length; t += 3) { const a = I[t] * 2, b = I[t + 1] * 2, c = I[t + 2] * 2, ar = Math.abs((U[b] - U[a]) * (U[c + 1] - U[a + 1]) - (U[c] - U[a]) * (U[b + 1] - U[a + 1])) / 2; if (ar > ba) { ba = ar; best = t; } } const a = I[best] * 2, b = I[best + 1] * 2, c = I[best + 2] * 2; return { mid: [(U[a] + U[b] + U[c]) / 3, (U[a + 1] + U[b + 1] + U[c + 1]) / 3], pts: [[U[a], U[a + 1]], [U[b], U[b + 1]], [U[c], U[c + 1]]] }; })()`);
  await evalJS(`${T}.setMode('island')`); await evalJS(`${T}.selectAll()`); await sleep(200);
  await evalJS(`${T}.distribute('h')`); await sleep(900);
  const gp = await evalJS(`(() => { const b = ${T}.boxes().sort((x, y) => (x.u0 + x.u1) - (y.u0 + y.u1)), g = []; for (let i = 0; i + 1 < b.length; i++) g.push(b[i + 1].u0 - b[i].u1); const side = g.every((x) => x >= -1e-9), q = side ? g : b.slice(1).map((x, i) => (x.u0 + x.u1) / 2 - (b[i].u0 + b[i].u1) / 2), mean = q.reduce((a, c) => a + c, 0) / q.length; return { n: b.length, side, maxDev: Math.max(...q.map(x => Math.abs(x - mean))) }; })()`);
  check('Distribute across spaces the islands evenly (equal gaps; their middles when they do not fit side by side)', gp.n >= 3 && gp.maxDev < 1e-4, gp);
  await evalJS(`${T}.distribute('v')`); await sleep(900);
  const gv = await evalJS(`(() => { const b = ${T}.boxes().sort((x, y) => (x.v0 + x.v1) - (y.v0 + y.v1)), g = []; for (let i = 0; i + 1 < b.length; i++) g.push(b[i + 1].v0 - b[i].v1); const side = g.every((x) => x >= -1e-9), q = side ? g : b.slice(1).map((x, i) => (x.v0 + x.v1) / 2 - (b[i].v0 + b[i].v1) / 2), mean = q.reduce((a, c) => a + c, 0) / q.length; return { n: b.length, side, maxDev: Math.max(...q.map(x => Math.abs(x - mean))) }; })()`);
  check('Distribute down spaces the islands evenly (equal gaps; their middles when they do not fit one above the other)', gv.n >= 3 && gv.maxDev < 1e-4, gv);
  // orient: an island turned by 33° and oriented has a smaller box again, long side across
  let bm = await bigMid();
  await evalJS(`${T}.selectNone()`); await clickAt(bm.mid[0], bm.mid[1]);
  await evalJS(`${T}.turn(33)`); await sleep(1000);
  const ob1 = await evalJS(`${T}.selBox()`);
  await evalJS(`${T}.orient()`); await sleep(1000);
  const ob2 = await evalJS(`${T}.selBox()`);
  check('Orient puts a turned island back in its tightest box, the long side across', ob2 && ob1 && ob2.w * ob2.h < ob1.w * ob1.h * 0.98 && ob2.w >= ob2.h - 1e-6, [ob1, ob2]);
  // line up: three points of one face on one horizontal line
  bm = await bigMid();
  await evalJS(`${T}.selectNone()`); await evalJS(`${T}.setMode('point')`);
  for (const p of bm.pts) await shiftClick(p[0], p[1]);
  await evalJS(`${T}.lineUp('h')`); await sleep(700);
  const ln = await evalJS(`(() => { const d = ${T}.data, s = ${T}.sel, vs = []; for (let i = 0; i < s.length; i++) if (s[i]) vs.push(d.UV[2 * i + 1]); return { n: vs.length, spread: Math.max(...vs) - Math.min(...vs) }; })()`);
  check('Line up across puts the picked points on one horizontal line', ln.n >= 3 && ln.spread < 1e-5, ln);
  // texel density as a number: the picked island is scaled to it
  bm = await bigMid();
  await evalJS(`${T}.selectNone()`); await evalJS(`${T}.setMode('island')`); await clickAt(bm.mid[0], bm.mid[1]); await sleep(300);
  await evalJS(`${T}.setDensity(12)`); await sleep(1000);
  const td = await evalJS(`${T}.densityNow()`);
  check('Texel density typed in as 12 px/mm gives 12 px/mm', td && Math.abs(td - 12) < 0.3, td);
  await sleep(400);
  check('and the field shows it', Math.abs(parseFloat(await evalJS("document.getElementById('uv-f-td').value")) - 12) < 0.4, await evalJS("document.getElementById('uv-f-td').value"));
  // mirrored faces: one island flipped is the only thing Pick problems finds
  await evalJS(`${T}.flipH()`); await sleep(1000);
  await evalJS(`${T}.selectNone()`); await evalJS(`${T}.pickFlipped()`); await sleep(200);
  const fl = await evalJS(`(() => ({ n: ${T}.sel.reduce((a, b) => a + b, 0), all: ${T}.sel.length }))()`);
  check('Pick mirrored faces finds the flipped island and not the rest', fl.n > 3 && fl.n < fl.all * 0.9, fl);
  await evalJS("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))"); await sleep(700);
  // stretch: after a sphere projection of everything the heat-map has something to show, and Relax does not make it worse
  await evalJS(`${T}.selectAll()`); await evalJS(`${T}.projectPoints('sphere')`); await sleep(1200);
  const ss0 = await evalJS(`${T}.stretchScore()`);
  await evalJS("document.getElementById('uv-stretch').click()"); await sleep(500);
  const heat = await evalJS(`(() => { const c = document.getElementById('uv-canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let hot = 0, cold = 0; for (let i = 0; i < d.length; i += 4) { if (d[i] > 200 && d[i + 1] < 110 && d[i + 2] < 110) hot++; if (d[i + 2] > 200 && d[i] < 90) cold++; } return { hot, cold }; })()`);
  check('the stretch heat-map colours a distorted layout', heat.hot + heat.cold > 50, heat);
  await evalJS("document.getElementById('uv-stretch').click()"); await sleep(200);
  await evalJS(`${T}.relax()`); await sleep(2000);
  const ss1 = await evalJS(`${T}.stretchScore()`);
  check('Relax does not make the stretch worse (it was ' + ss0.toFixed(3) + ')', Number.isFinite(ss1) && ss1 <= ss0 * 1.05, [ss0, ss1]);
  await evalJS("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))"); await sleep(700);
  await evalJS("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))"); await sleep(700);
  // pack with quarter turns: still one scale for every triangle
  await evalJS("document.getElementById('uv-packrot').click()"); await sleep(200);
  await evalJS(`${T}.selectNone()`); await evalJS(`${T}.setMode('island')`); await sleep(200);
  const ta0 = await triAreas();
  await evalJS("document.querySelector('[data-act=\"pack\"]').click()"); await sleep(1000);
  const ta1 = await triAreas();
  { let lo = Infinity, hi = 0, n = 0; for (let i = 0; i < ta0.length; i++) { if (ta0[i] < 1e-7) continue; const q = ta1[i] / ta0[i]; if (q < lo) lo = q; if (q > hi) hi = q; n++; } check('Pack with quarter turns keeps one scale for every triangle', n > 50 && hi / lo < 1.02, { lo, hi, n }); }
  const bb5 = await evalJS(`${T}.selBox() || (() => { const d = ${T}.data, U = d.UV; let u0 = 9, u1 = -9, v0 = 9, v1 = -9; for (let i = 0; i < d.verts; i++) { u0 = Math.min(u0, U[2 * i]); u1 = Math.max(u1, U[2 * i]); v0 = Math.min(v0, U[2 * i + 1]); v1 = Math.max(v1, U[2 * i + 1]); } return { u0, u1, v0, v1 }; })()`);
  check('and everything is inside the square', bb5.u0 >= -1e-3 && bb5.u1 <= 1 + 1e-3 && bb5.v0 >= -1e-3 && bb5.v1 <= 1 + 1e-3, bb5);
  await evalJS("document.getElementById('uv-packrot').click()"); await sleep(200);

  // the projection dialog: View, Sphere, Cubic
  await evalJS("document.querySelector('[data-act=\"project\"]').click()"); await sleep(300);
  check('Project… opens the dialog with the seven types', await evalJS("!document.getElementById('uv-proj-pop').hidden && [...document.getElementById('uv-proj-type').options].map(o => o.text).join() === 'Cubic,Box,Shrink,Sphere,Cylinder,View,Axis'"));
  for (const kind of ['sphere', 'cylinder', 'shrink', 'axis', 'view']) {
    await evalJS(`(() => { const e = document.getElementById('uv-proj-type'); e.value = '${kind}'; e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await evalJS(`${T}.selectAll()`); await evalJS("document.getElementById('uv-proj-go').click()"); await sleep(500);
    const b = await evalJS(`${T}.selBox()`);
    check('Project ' + kind + ' puts the points inside the square', b && b.u0 >= -1e-3 && b.u1 <= 1 + 1e-3 && b.v0 >= -1e-3 && b.v1 <= 1 + 1e-3 && (b.w > 0.05 || b.h > 0.05), b);
  }
  const trisBefore = await evalJS("window.state.parts.reduce((s, p) => s + (p.triCount | 0), 0)");
  await evalJS(`(() => { const e = document.getElementById('uv-proj-type'); e.value = 'cubic'; e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await evalJS("document.getElementById('uv-proj-go').click()"); await sleep(1500);
  const trisAfter = await evalJS("window.state.parts.reduce((s, p) => s + (p.triCount | 0), 0)");
  const cub = await evalJS(`(() => { const p = window.state.parts.find(q => q.name === 'box_blue'), g = p.mesh.geometry, uv = g.attributes.uv.array; let lo = 9, hi = -9; for (const x of uv) { lo = Math.min(lo, x); hi = Math.max(hi, x); } return { n: g.attributes.position.count, lo, hi }; })()`);
  check('Cubic rebuilds the parts (a vertex for each side), with the same triangles, inside the square', trisAfter === trisBefore && cub.n >= 24 && cub.lo >= -1e-3 && cub.hi <= 1 + 1e-3, [trisBefore, trisAfter, cub]);
  await evalJS("document.getElementById('uv-proj-x').click()");

  // ── closing ──
  await evalJS("document.getElementById('uv-close').click()"); await sleep(900);
  check('closing hides the pane and brings the left sidebar back', await evalJS("document.getElementById('uv-pane').hidden && !document.body.classList.contains('uv-split') && !document.body.classList.contains('left-collapsed')"));
  await sleep(600);
  const w2 = await canvasW();
  check('the 3D view is as wide as before', Math.abs(w2 - w0) < 4, [w0, w2]);

  // ── a left sidebar that was folded stays folded ──
  await evalJS("document.getElementById('btn-toggle-left').click()"); await sleep(700);
  await evalJS("window.__moUvSplit.toggle(true)"); await sleep(700);
  await evalJS("window.__moUvSplit.toggle(false)"); await sleep(900);
  check('a left sidebar that was folded before stays folded', await evalJS("document.body.classList.contains('left-collapsed')"));
  await evalJS("window.__moUvSplit.toggle(true)"); await sleep(500);
  await evalJS("window.__moUvSplit.toggle(false)");
} catch (e) { fail++; console.log('HARNESS ERROR:', e.message); }
console.log(`\n${pass} passed, ${fail} failed`);
console.log('page exceptions:', errors.length); errors.slice(0, 12).forEach(e => console.log('  ' + e));
try { ws && ws.close(); } catch (_) {}
chrome.kill();
process.exit(fail ? 1 : 0);
