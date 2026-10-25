// node tests/e2e-history-card.mjs [model, default inbox/GearboxAssy.glb]
//
// The timeline's right-click menu on a clip: copy the properties of a Noise clip and paste them on a clip of another object, or of another kind,
// or as a new animation on the selection.
// Needs the app served on APP_PORT (default 4242; use 4343 with its own server: python app/serve.py --no-browser --port 4343),
// Chrome installed and Node 22+.
import { spawn } from 'child_process';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9342, PROFILE = process.env.TEMP + '/cdp-profile-' + Date.now();
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
  const A = '__moAnimTest';
  const ids = await G(`state.parts.filter(p => !p.deleted && p.mesh).slice(0, 3).map(p => p.partId)`);
  await G(`${A}.api.add({ ids: [${ids[0]}], type: 'noise', shift_mm: 17, turn_degrees: 33, seed: 9, detail: 3 })`);
  await G(`${A}.api.add({ ids: [${ids[1]}], type: 'noise', shift_mm: 2 })`);
  await G(`${A}.api.add({ ids: [${ids[2]}], type: 'spin', rpm: 12 })`);
  await G(`document.getElementById('tg-animate').click()`); await sleep(2500);
  const bars = () => G(`[...document.querySelectorAll('.adk-bar')].map(b => ({ key: b.dataset.key, lid: +b.dataset.lid, type: b.closest('.adk-row').dataset.type }))`);
  let b = await bars();
  ok(b.length >= 3, 'the timeline shows a clip for each animation', JSON.stringify(b));
  const real = async (x, y, button, buttons) => { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons, clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, buttons: 0, clickCount: 1 }); };
  const menuAt = async (lid) => {
    const r = await G(`(() => { const el = document.querySelector('.adk-bar[data-lid="${lid}"]'); const r = el.getBoundingClientRect(); return [r.left + 14, r.top + r.height / 2]; })()`);
    await real(r[0], r[1], 'right', 2);
    await sleep(300);
    return G(`(() => { const m = document.getElementById('ctx-menu'); if (!m || m.style.display !== 'block') return null; return [...m.querySelectorAll('.ctx-menu-row')].map(r => ({ t: r.querySelector('.ctx-menu-label').textContent, off: r.classList.contains('is-off') })); })()`);
  };
  const pickRow = async (label) => {
    const p = await G(`(() => { const r = [...document.querySelectorAll('#ctx-menu .ctx-menu-row')].find(r => r.querySelector('.ctx-menu-label').textContent === ${JSON.stringify(label)}); const b = r.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; })()`);
    await real(p[0], p[1], 'left', 1);
  };
  const layer = async (pid) => (await G(`${A}.api.list()`)).find(x => x.id === pid).layers[0];
  const noiseA = b.find(x => x.type === 'noise'), noiseB = b.filter(x => x.type === 'noise')[1], spin = b.find(x => x.type === 'spin');
  let m = await menuAt(noiseA.lid);
  ok(m && m.some(r => r.t === 'Copy Noise properties') && m.some(r => r.t === 'Paste properties' && r.off), 'a right-click on a clip opens a menu; Paste is dimmed until something is copied', JSON.stringify(m));
  ok(await G(`(() => { const r = [...document.querySelectorAll('#ctx-menu .ctx-menu-row')][0].getBoundingClientRect(); const e = document.elementFromPoint(r.left + 8, r.top + r.height / 2); return !!e && !!e.closest('#ctx-menu'); })()`), 'and the menu is on top of the timeline');
  await pickRow('Copy Noise properties'); await sleep(200);
  m = await menuAt(noiseB.lid);
  ok(m && !m.find(r => r.t === 'Paste properties').off, 'after Copy, Paste is on');
  await pickRow('Paste properties'); await sleep(300);
  const before = (await G(`${A}.api.list()`));
  const lb = before.find(x => x.id === ids[1]).layers[0];
  ok(lb.shift_mm === undefined && lb.pos === 17 && lb.rot === 33 && lb.seed === 9 && lb.detail === 3, 'the other Noise clip has the copied properties', JSON.stringify(lb));
  ok((await G(`+document.querySelector('#adk-insp-body input[data-p="noise.pos"]')?.value`)) === 17, 'and the settings of the window show them too (not the old ones)', await G(`document.querySelector('#adk-insp-body input[data-p="noise.pos"]')?.value`));
  // on a clip of another kind: it becomes Noise
  m = await menuAt(spin.lid);
  await pickRow('Paste properties'); await sleep(300);
  const ls = await layer(ids[2]);
  ok(/^Noise/.test(ls.summary) && ls.pos === 17, 'a Spin clip becomes a Noise clip with them', JSON.stringify(ls));
  // as an extra animation on an object that has another kind
  await G(`${A}.api.add({ ids: [${ids[2]}], type: 'swing', angle_degrees: 20 })`); await sleep(500);
  b = await bars();
  const sw = b.find(x => x.type === 'swing');
  await G(`${A}.api.add({ ids: [${ids[2]}], type: 'oscillate' })`);
  m = await menuAt(sw.lid);
  ok(m && m.some(r => r.t === 'Add as a new animation on this object' && r.off), 'Add is dimmed when the object has that kind already', JSON.stringify(m));
  await G(`document.getElementById('ctx-menu').style.display = 'none'`);
  await G(`${A}.api.add({ ids: [${ids[1]}], type: 'swing', angle_degrees: 20 })`); await sleep(400);
  b = await bars();
  const sw1 = b.find(x => x.type === 'swing' && x.key === 'p:' + ids[1]);
  await G(`${A}.api.remove({ ids: [${ids[1]}], type: 'noise' })`); await sleep(300);
  m = await menuAt(sw1.lid);
  await pickRow('Add as a new animation on this object'); await sleep(400);
  const two = (await G(`${A}.api.list()`)).find(x => x.id === ids[1]);
  ok(two && two.layers.length === 2 && two.layers.some(l => /^Noise/.test(l.summary)) && two.layers.some(l => /^Swing/.test(l.summary)), 'it adds the copied kind next to the one the object has', JSON.stringify(two && two.layers.map(l => l.summary)));
  // the column of names: wider by default, and dragged by its edge
  const hw = () => G(`parseInt(getComputedStyle(document.getElementById('vp-animate-pop')).getPropertyValue('--adk-hw'), 10)`);
  ok((await hw()) === 280, 'the column of names is 280 px by default', await hw());
  const gp = await G(`(() => { const r = document.getElementById('adk-names-grip').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: gp[0], y: gp[1] });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: gp[0], y: gp[1], button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: gp[0] + 35, y: gp[1], button: 'left', buttons: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: gp[0] + 70, y: gp[1], button: 'left', buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: gp[0] + 70, y: gp[1], button: 'left', buttons: 0, clickCount: 1 });
  await sleep(300);
  ok((await hw()) === 350, 'dragging the edge by 70 px makes it 350', await hw());
  ok((await G(`localStorage.getItem('stepopt-anim-names-w')`)) === '350', 'and it is kept');
  await G(`document.getElementById('adk-names-grip').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`); await sleep(200);
  ok((await hw()) === 280, 'a double-click puts it back');
  // Space plays and pauses wherever the focus is while the window is open
  await G(`document.activeElement && document.activeElement.blur(); window.__moAnimStats && 0`);
  const playing = () => G(`window.__moAnimStats().playing`);
  const p0 = await playing();
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await sleep(250);
  ok((await playing()) === !p0, 'Space with the focus outside the window plays or pauses', JSON.stringify([p0, await playing()]));
  await G(`document.getElementById('tg-split') && document.getElementById('tg-split').focus()`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await sleep(250);
  ok((await playing()) === p0 && !(await G(`document.body.classList.contains('cmd-open') || !!document.querySelector('.section-cmd:not([hidden])')`)), 'and with a toolbar button focused, without pressing the button', JSON.stringify([p0, await playing()]));
  // several clips picked with Shift are trimmed together
  b = await bars();
  const bar = (lid) => G(`(() => { const r = document.querySelector('.adk-bar[data-lid="${lid}"]').getBoundingClientRect(); const e = document.querySelector('.adk-bar[data-lid="${lid}"] .adk-be'); const q = e ? e.getBoundingClientRect() : null; return { w: r.width, l: r.left, t: r.top + r.height / 2, endX: q ? q.left + q.width / 2 : r.right - 3, sel: document.querySelector('.adk-bar[data-lid="${lid}"]').closest('.adk-row').classList.contains('is-sel') }; })()`);
  const ids3 = b.slice(0, 3).map(x => x.lid);
  const b0 = await bar(ids3[0]);
  await real(b0.l + 40, b0.t, 'left', 1); await sleep(200);
  const b1 = await bar(ids3[1]);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b1.l + 40, y: b1.t });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: b1.l + 40, y: b1.t, button: 'left', buttons: 1, clickCount: 1, modifiers: 8 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b1.l + 40, y: b1.t, button: 'left', buttons: 0, clickCount: 1, modifiers: 8 });
  await sleep(300);
  const w0 = await Promise.all(ids3.map(bar));
  const sl = (await G(`${A}.sel()`)).lids;
  ok(sl.includes(ids3[0]) && sl.includes(ids3[1]) && !sl.includes(ids3[2]), 'Shift-click picks a second clip as well', JSON.stringify(sl));
  const e0 = w0[0];
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: e0.endX, y: e0.t });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: e0.endX, y: e0.t, button: 'left', buttons: 1, clickCount: 1 });
  for (const dx of [-60, -120, -180]) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: e0.endX + dx, y: e0.t, button: 'left', buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: e0.endX - 180, y: e0.t, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(400);
  const w1 = await Promise.all(ids3.map(bar));
  ok(w0[0].w - w1[0].w > 100 && w0[1].w - w1[1].w > 100, 'dragging the end of one shortens both picked clips', JSON.stringify([w0.map(x => x.w | 0), w1.map(x => x.w | 0)]));
  ok(Math.abs(w1[2].w - w0[2].w) < 1, 'and leaves the third alone');
  // the list on the left keeps its look and its place in Animate mode
  const tree = await G(`(() => { const t = document.getElementById('tree'); const sel = [...document.querySelectorAll('#tree .tree-node.selected')]; return { top: t.scrollTop, n: sel.length, bg: sel.length ? getComputedStyle(sel[0]).backgroundColor : '', lab: sel.length ? getComputedStyle(sel[0].querySelector('.tree-label')).color : '' }; })()`);
  ok(tree.n === 0 || /rgba\(0, 0, 0, 0\)|transparent/.test(tree.bg), 'rows picked in Animate mode have no blue in the list on the left', JSON.stringify(tree));
  await G(`(() => { const t = document.getElementById('tree'); window.__top0 = t.scrollTop; })()`);
  await real(w1[2].l + 30, w1[2].t, 'left', 1); await sleep(400);
  ok((await G(`document.getElementById('tree').scrollTop`)) === (await G('window.__top0')), 'clicking a clip does not scroll the list on the left');
  // Ctrl+C and Ctrl+V copy and paste clips while the window is open
  const ctrl = async (key, code, vk) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, modifiers: 2 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers: 2 }); await sleep(250); };
  const parts0 = await G('state.parts.filter(p => !p.deleted).length');
  b = await bars();
  const src = b.find(x => x.key === 'p:' + ids[0]);
  const sb = await bar(src.lid);
  await real(sb.l + 30, sb.t, 'left', 1); await sleep(250);
  await ctrl('c', 'KeyC', 67);
  const empty = await G(`state.parts.filter(p => !p.deleted && p.mesh).map(p => p.partId).find(i => !${A}.api.list().some(x => x.id === i))`);
  await G(`(() => { state.selectedGroupIds = new Set(); state.selected = new Set([${empty}]); })()`);
  await ctrl('v', 'KeyV', 86);
  const got = (await G(`${A}.api.list()`)).find(x => x.id === empty);
  ok(got && got.layers.length === 1 && /^Noise/.test(got.layers[0].summary) && got.layers[0].pos === 17, 'Ctrl+C on a clip and Ctrl+V on another object puts the clip there', JSON.stringify(got && got.layers.map(l => l.summary)));
  ok((await G('state.parts.filter(p => !p.deleted).length')) === parts0, 'and no part is copied');
  await ctrl('v', 'KeyV', 86);
  const twice = (await G(`${A}.api.list()`)).find(x => x.id === empty);
  ok(twice && twice.layers.length === 2, 'a second Ctrl+V adds another clip (at the playhead)', JSON.stringify(twice && twice.layers.length));
  // the step is one undo
  ok(errors.length === 0, 'no JavaScript errors', errors.slice(0, 3).join(' | '));
} catch (e) { console.log('FAIL the run itself:', e.message); failed++; }
finally { if (errors.length) console.log('page errors:', errors.slice(0, 5)); try { ws && ws.close(); } catch (_) {} chrome.kill(); }
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks pass');
process.exit(failed ? 1 : 0);
