// node tests/e2e-tex-drop.mjs
//
// A picture dragged from the file explorer onto a texture slot of the material editor (the small square at the end of the Colour row)
// loads into that slot, as Load… in its popover does. Gives a cube a new material, opens its editor, and drops a PNG on the Colour slot:
// the material gets the map, the slot shows the picture and is marked while the file is over it, the viewport underneath does not take
// the drop as a model to open, and a file that is not a picture leaves the slot as it was.
// Needs the app served on APP_PORT (default 4242), Chrome and Node 22+.
import { spawn } from 'child_process';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9378, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-texdrop-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
try {
  let t;
  for (let i = 0; i < 60 && !t; i++) { try { t = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find(x => x.type === 'page'); } catch (_) {} if (!t) await sleep(250); }
  if (!t) throw new Error('Chrome did not start');
  ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
    else if (d.method === 'Page.javascriptDialogOpening') { console.log('dialog:', d.params.type, d.params.message); send('Page.handleJavaScriptDialog', { accept: true }); }
    else if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text || '').split('\n').slice(0, 3).join(' | ')); };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await ev("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await ev("document.getElementById('welcome-start-empty')?.click()"); await sleep(300);
  await ev("document.getElementById('welcome-close')?.click()"); await sleep(300);
  await ev("Promise.resolve(window._addPrimitive('cube')).then(() => 1)"); await sleep(800);

  // a new material on the cube, its editor open (as the selftest's texture test does it)
  const opened = await ev(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const part = state.parts.find(p => !p.deleted && p.mesh && p.name === 'Cube');
    const row = [...document.querySelectorAll('.tree-node')].find(r => r.textContent.trim().startsWith('Cube'));
    row.dispatchEvent(new MouseEvent('click', { bubbles: true })); await sleep(300);
    const dock = document.getElementById('vp-materials-pop');
    if (!dock.classList.contains('show')) { document.getElementById('tg-materials').click(); await sleep(450); }
    const m0 = part.mesh.material; document.getElementById('mat-act-add').click();
    for (let i = 0; i < 30 && part.mesh.material === m0; i++) await sleep(100);
    const m = part.mesh.material; window.__texDropMat = m;
    let cell; for (let i = 0; i < 30 && !cell; i++) { cell = [...dock.querySelectorAll('.mat-cell, .mat-row')].find(c => c._mat === m); if (!cell) await sleep(100); }
    cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); await sleep(700);
    return document.querySelector('.mat-edit-preview-name')?.textContent === m.name && !!document.querySelector('#_mat-editor-popup .mat-row-tex[data-tex-prop="map"]');
  })()`);
  check('the editor of the new material is open, with a Colour texture slot', opened);

  const drag = (fileExpr) => `(async () => {
    const slot = document.querySelector('#_mat-editor-popup .mat-row-tex[data-tex-prop="map"]');
    const file = await (${fileExpr});
    const dt = new DataTransfer(); dt.items.add(file);
    let viewportGot = false; const vp = document.getElementById('viewport'); const spy = () => { viewportGot = true; };
    vp?.addEventListener('drop', spy); document.addEventListener('drop', spy);
    const opt = { bubbles: true, cancelable: true, dataTransfer: dt };
    slot.dispatchEvent(new DragEvent('dragenter', opt));
    const over = new DragEvent('dragover', opt); slot.dispatchEvent(over);
    const marked = slot.classList.contains('tex-drop-over');
    const drop = new DragEvent('drop', opt); slot.dispatchEvent(drop);
    vp?.removeEventListener('drop', spy); document.removeEventListener('drop', spy);
    const m = window.__texDropMat;
    for (let i = 0; i < 40 && !(m.map && m.map.name === file.name); i++) await new Promise(r => setTimeout(r, 100));
    await new Promise(r => setTimeout(r, 200));
    const s2 = document.querySelector('#_mat-editor-popup .mat-row-tex[data-tex-prop="map"]');
    return { accepted: over.defaultPrevented && drop.defaultPrevented, marked, unmarked: !s2.classList.contains('tex-drop-over'), viewportGot,
      map: m.map ? m.map.name : null, colourSpace: m.map ? m.map.colorSpace : null, pic: getComputedStyle(s2).backgroundImage.slice(0, 12) };
  })()`;
  const png = `(async () => { const c = document.createElement('canvas'); c.width = 32; c.height = 32; const g = c.getContext('2d'); g.fillStyle = '#e02020'; g.fillRect(0, 0, 32, 32);
    return new File([await new Promise(r => c.toBlob(r, 'image/png'))], 'red.png', { type: 'image/png' }); })()`;
  const r = await ev(drag(png));
  check('the slot takes the drag (dragover and drop accepted)', r.accepted, r);
  check('the slot is marked while the file is over it, and not after the drop', r.marked && r.unmarked, r);
  check('the dropped picture is the material\'s colour map, in sRGB', r.map === 'red.png' && r.colourSpace === 'srgb', r);
  check('the slot shows the picture', r.pic.startsWith('url('), r);
  check('the drop does not reach the viewport (it is not opened as a model)', !r.viewportGot, r);

  const txt = `Promise.resolve(new File(['solid x'], 'part.stl', { type: '' }))`;
  const r2 = await ev(drag(txt));
  check('a file that is not a picture leaves the slot as it was', r2.map === 'red.png' && !r2.viewportGot, r2);

  // ── undo: every material change goes back, the texture too ──
  const state = `(() => { const m = window.__texDropMat, s = document.querySelector('#_mat-editor-popup .mat-row-tex[data-tex-prop="map"]');
    return { map: m.map ? m.map.name : null, pic: s ? getComputedStyle(s).backgroundImage.slice(0, 3) : null, color: m.color.getHexString(), rough: m.roughness }; })()`;
  const act = (id) => ev(`(async () => { window._appFns._Actions.list.find(a => a.id === '${id}').run(); await new Promise(r => setTimeout(r, 450)); return 1; })()`);
  await act('undo');
  const u1 = await ev(state);
  check('Undo takes the dropped texture off (the slot is empty again)', u1.map === null && u1.pic !== 'url', u1);
  await act('redo');
  const r3 = await ev(state);
  check('Redo puts it back, and the slot shows the picture', r3.map === 'red.png' && r3.pic === 'url', r3);
  // a second drop over the first: Undo brings the first back (its picture is still there to show)
  const blue = `(async () => { const c = document.createElement('canvas'); c.width = 32; c.height = 32; const g = c.getContext('2d'); g.fillStyle = '#2040e0'; g.fillRect(0, 0, 32, 32);
    return new File([await new Promise(r => c.toBlob(r, 'image/png'))], 'blue.png', { type: 'image/png' }); })()`;
  await ev(drag(blue));
  await act('undo');
  const u2 = await ev(state);
  const firstOk = await ev(`(async () => { const m = window.__texDropMat; const src = m.map && m.map.userData && m.map.userData.dataUrl; if (!src) return false;
    try { const r = await fetch(src); return r.ok; } catch (_) { return false; } })()`);
  check('a texture replaced by another comes back on Undo, with its picture still readable', u2.map === 'red.png' && u2.pic === 'url' && firstOk, { u2, firstOk });
  // Clear in the popover is a step too
  await ev(`(async () => { document.querySelector('#_mat-editor-popup .mat-row-tex[data-tex-prop="map"]').click(); await new Promise(r => setTimeout(r, 250));
    document.querySelector('#_mat-tex-pop [data-pop-clear]').click(); await new Promise(r => setTimeout(r, 300)); return 1; })()`);
  const c1 = (await ev(state)).map;
  await act('undo');
  const c2 = (await ev(state)).map;
  check('Clear takes the texture off, and Undo puts it back', c1 === null && c2 === 'red.png', { c1, c2 });
  // a field the old snapshot left out: the specular colour of a physical material (and roughness, which it had)
  // (changed while the editor is open, as a control of it would; Undo records the pending edit first and then takes it back)
  const sp = await ev(`(async () => { const m = window.__texDropMat;
    const was = { spec: m.specularColor ? m.specularColor.getHex() : null, depth: m.depthWrite, rough: m.roughness };
    if (m.specularColor) m.specularColor.setHex(0x00ff00); m.depthWrite = !m.depthWrite; m.roughness = 0.123;
    window._appFns._Actions.list.find(a => a.id === 'undo').run(); await new Promise(r => setTimeout(r, 450));
    return { was, now: { spec: m.specularColor ? m.specularColor.getHex() : null, depth: m.depthWrite, rough: m.roughness }, map: m.map ? m.map.name : null }; })()`);
  check('Undo puts back every field of a material edit (specular colour, depth write, roughness), and only that edit',
    JSON.stringify(sp.was) === JSON.stringify(sp.now) && sp.map === 'red.png', sp);

  check('no script errors', errors.length === 0, errors);
} catch (e) { fail++; console.log('FAIL', e.message); }
finally { try { ws?.close(); } catch (_) {} chrome.kill(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }
