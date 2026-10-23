// node tests/e2e-round-card.mjs [shot.png]
//
// Drives the Round part card in the real app in headless Chrome, on a spool written here as an OBJ (lips at both ends, five V ridges on
// its body, a bore; spun with revolve.js in 48 segments). It checks the card opens on Remove ridges with the profile before and after
// and the readout (grooves filled, segments), that nothing changes before Apply, that Make solid and back changes the preview, that
// Segments around changes the estimate, that a point dragged by the pointer snaps onto the profile as it was, Apply (fewer
// triangles, one part), the mode buttons standing still once applied, Segments after Apply; and from the old Round part card's
// test: the selection outline and glow following the new shape, Wireframe while open, Shading angle 2° lit flat and back, Enter
// closing the card and putting the view back, one undo, Segments around remembered, and the options doing nothing after undo.
// Needs the app served on http://localhost:4242 (or APP_PORT), Chrome installed and Node 22+.
import { spawn } from 'child_process';
import fs from 'fs';
import { revolveLoops } from '../app/js/revolve.js';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SHOT = process.argv[2];
const PORT = 9354, PROFILE = (process.env.TEMP || '.') + '/cdp-round-card-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── the spool (as tests/revolve.test.mjs), spun round Z ──
const prof = [[40, 20], [36, 20], [36, 15]];
for (let i = 0; i < 5; i++) { const h = 33 - i * 6; prof.push([h + 1.5, 15], [h, 17], [h - 1.5, 15]); }
prof.push([4, 15], [4, 20], [0, 20], [0, 5], [40, 5]);
const g = revolveLoops([prof], [0, 0, 0], [0, 0, 1], 48, 0, 1e-6, 0);
const v = [], f = ['o spool'];
for (let i = 0; i < g.positions.length; i += 3) v.push(`v ${g.positions[i]} ${g.positions[i + 1]} ${g.positions[i + 2]}`);
for (let t = 0; t < g.index.length; t += 3) f.push(`f ${g.index[t] + 1} ${g.index[t + 1] + 1} ${g.index[t + 2] + 1}`);
const objText = v.join('\n') + '\n' + f.join('\n') + '\n';

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
const until = async (expr, ms = 5000) => { for (let t = 0; t < ms; t += 150) { if (await evalJS(expr).catch(() => false)) return true; await sleep(150); } return false; };
const shot = async (file) => { await call('set_camera_view', { view: 'fit' }); await evalJS("(() => { const b = document.getElementById('loader-cancel-btn'); for (const e of document.querySelectorAll('body *')) if (e.contains(b) && getComputedStyle(e).position === 'fixed') e.style.visibility = 'hidden'; })()"); await sleep(900); const img = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(file, Buffer.from(img.data, 'base64')); console.log('picture:', file); };
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
  await evalJS(`(() => { window.__moOpenFile(new File([${JSON.stringify(objText)}], 'spool.obj')); return true; })()`);
  for (let i = 0; i < 20; i++) {
    if (await evalJS("document.getElementById('import-modal')?.classList.contains('show')").catch(() => false)) { await evalJS("document.querySelector('#import-modal-confirm')?.click()"); break; }
    await sleep(250);
  }
  let s0 = null;
  for (let i = 0; i < 120; i++) { s0 = await sum(); if (s0 && s0.parts > 0 && s0.triangles > 0) break; await sleep(500); }
  await sleep(1500);
  check('the spool is open', s0 && s0.parts === 1, s0 && s0.parts);
  const pid = (await call('list_parts', { sort_by: 'triangles', limit: 1 })).j.parts[0].id;
  await call('select_parts', { ids: [pid] });

  const o = await evalJS(`window.__moAgent.roundCard({ ids: [${pid}], mode: 'exact', width_mm: 7 })`);
  await sleep(400);
  check('the card opens on Remove ridges', o && o.ok && await evalJS("!document.querySelector('.section-cmd[data-cmd=\"round\"]').hidden") && /remove ridges/.test(await evalJS("document.getElementById('rc-title').textContent")), o);
  check('the preview draws the profile before and after', await evalJS("document.querySelectorAll('#rc-svg path:not(.pf-grid):not(.pf-mirror):not(.pf-axis)').length === 3 && !!document.querySelector('#rc-svg .pf-grid') && document.querySelector('#rc-svg .pf-was:not(.pf-mirror)').getAttribute('d').length > 20 && document.querySelector('#rc-svg .pf-now:not(.pf-mirror)').getAttribute('d').length > 20"));
  // the other half of the part, mirrored across the axis: drawn (lighter), with nothing on it to pick, and the axis between the halves
  const mir = await evalJS(`(() => { const svg = document.getElementById('rc-svg'), a = svg.querySelector('.pf-now:not(.pf-mirror)'), b = svg.querySelector('.pf-now.pf-mirror');
    const ys = (el) => [...el.getAttribute('d').matchAll(/[ML]([-0-9.e]+) ([-0-9.e]+)/g)].map(m => +m[2]);
    const ya = ys(a), yb = ys(b);
    return { has: !!b && !!svg.querySelector('.pf-axis'), same: ya.length === yb.length && ya.every((y, i) => Math.abs(y + yb[i]) < 1e-3), inert: getComputedStyle(b).pointerEvents === 'none', light: +getComputedStyle(b).opacity < 0.6 }; })()`);
  check('the other half is drawn mirrored across the axis, lighter, and cannot be picked', mir.has && mir.same && mir.inert && mir.light, mir);
  // the button in the corner switches the other half off and on again (remembered)
  const mBtn = () => evalJS("(() => { const b = document.getElementById('rc-mirror'); return { shown: !!b && !b.hidden && b.offsetWidth > 0, on: !!b && b.classList.contains('is-on'), paths: document.querySelectorAll('#rc-svg .pf-mirror, #rc-svg .pf-axis').length }; })()");
  const m0 = await mBtn();
  await evalJS("document.getElementById('rc-mirror').click(); true"); await sleep(200);
  const m1 = await mBtn();
  await evalJS("document.getElementById('rc-mirror').click(); true"); await sleep(200);
  const m2 = await mBtn();
  check('the corner button switches the other half off and back on', m0.shown && m0.on && m0.paths === 4 && !m1.on && m1.paths === 0 && m2.on && m2.paths === 4, { m0, m1, m2 });
  if (process.env.PREVIEW_SHOT) { const c = await evalJS("(() => { const r = document.getElementById('rc-svg').parentElement.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height, scale: 2 }; })()"); fs.writeFileSync(process.env.PREVIEW_SHOT, Buffer.from((await send('Page.captureScreenshot', { format: 'png', clip: c })).data, 'base64')); }      // (PREVIEW_SHOT=file.png: a picture of the preview)
  const txt = await evalJS("document.getElementById('rc-stats').textContent");
  check('the readout: the axis, the grooves filled, the segments it had', /Axis[XYZ]/.test(txt) && /Grooves filled[4-6]/.test(txt) && /the part had 48/.test(txt), txt);
  check('nothing changed before Apply', (await sum()).triangles === s0.triangles);
  // Make solid and back: the preview changes and comes back
  const dEx = await evalJS("document.querySelector('#rc-svg .pf-now:not(.pf-mirror)').getAttribute('d')");
  await evalJS("document.querySelector('#rc-mode button[data-m=\"outline\"]').click()"); await sleep(300);
  const dSo = await evalJS("document.querySelector('#rc-svg .pf-now:not(.pf-mirror)').getAttribute('d')");
  check('Solid: the title and the preview change', dSo !== dEx && /make solid/.test(await evalJS("document.getElementById('rc-title').textContent")));
  // Make solid's axis: shown in Solid only; another axis is another profile; Auto gives the first one back
  const axis = await evalJS(`(async () => {
    const wait = () => new Promise(r => setTimeout(r, 250)), d = () => document.querySelector('#rc-svg .pf-now:not(.pf-mirror)').getAttribute('d');
    const shown = !document.getElementById('rc-axis-row').hidden, auto = d(), out = {};
    for (const a of ['x', 'y', 'z']) { document.querySelector('#rc-axis button[data-a="' + a + '"]').click(); await wait(); out[a] = { d: d(), on: document.querySelector('#rc-axis button.active').dataset.a, st: window.__moAgent.roundCardState() }; }
    document.querySelector('#rc-axis button[data-a="auto"]').click(); await wait();
    return { shown, autoBack: d() === auto, differ: new Set(['x', 'y', 'z'].map(a => out[a].d)).size > 1, active: ['x', 'y', 'z'].every(a => out[a].on === a), axes: ['x', 'y', 'z'].map(a => out[a].st && out[a].st.options.axis) };
  })()`);
  check('Solid: the axis row shows, each axis is picked and changes the profile, and Auto gives it back', axis.shown && axis.active && axis.differ && axis.autoBack && axis.axes.join() === 'x,y,z', axis);
  await evalJS("document.querySelector('#rc-mode button[data-m=\"exact\"]').click()"); await sleep(300);
  check('and back to Ridges', (await evalJS("document.querySelector('#rc-svg .pf-now:not(.pf-mirror)').getAttribute('d')")) === dEx && await evalJS("document.getElementById('rc-axis-row').hidden"));
  // Segments around: 16 and the estimate drops
  const est48 = (await evalJS('window.__moAgent.roundCardState().summary')).triangles_after;
  await evalJS("window.__moAgent.roundCardSet('segments', 16)"); await sleep(200);
  const est16 = (await evalJS('window.__moAgent.roundCardState().summary')).triangles_after;
  check('Segments around 16: fewer triangles in the estimate', est16 < est48 && est16 > 0, { est48, est16 });
  // the editor: a handle dragged to 3 px from a corner of the profile as it was lands on it
  await evalJS("document.getElementById('rc-edit').click()"); await sleep(200);
  check('Edit points: the points are on the edited half only (none on the mirrored one)', await evalJS("(() => { const c = [...document.querySelectorAll('#rc-svg .pf-pt')]; return c.length > 0 && c.every(e => +e.getAttribute('cy') <= 1e-6); })()"));
  // a corner of the profile as it was: the first point of the grey outline as drawn (x, −y)
  const corner = await evalJS("(() => { const m = document.querySelector('#rc-svg .pf-was:not(.pf-mirror)').getAttribute('d').match(/M([-0-9.e]+) ([-0-9.e]+)/); return [+m[1], -m[2]]; })()");
  const drag = await evalJS(`(async () => {
    const svg = document.getElementById('rc-svg'), c = svg.querySelector('.pf-pt'), M = svg.getScreenCTM();
    const at = (x, y) => { const p = svg.createSVGPoint(); p.x = x; p.y = -y; const q = p.matrixTransform(M); return [q.x, q.y]; };
    const r = c.getBoundingClientRect(), from = [r.left + r.width / 2, r.top + r.height / 2], to = at(${corner[0]}, ${corner[1]});
    const ev = (type, x, y, el) => (el || svg).dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, clientX: x, clientY: y, button: 0, buttons: 1 }));
    ev('pointerdown', from[0], from[1], c); ev('pointermove', to[0] + 3, to[1] - 2); await new Promise(r => requestAnimationFrame(() => r())); const mark = !!svg.querySelector('.pf-snap'); ev('pointerup', to[0] + 3, to[1] - 2);
    await new Promise(r => setTimeout(r, 300));
    return { p: window.__moAgent.roundCardSection()[0][0], mark };
  })()`);
  check('a dragged point snaps onto a corner of the profile as it was', drag.mark && Math.abs(drag.p[0] - corner[0]) < 1e-3 && Math.abs(drag.p[1] - corner[1]) < 1e-3, drag);
  check('the readout says the profile is edited', /as edited/.test(await evalJS("document.getElementById('rc-stats').textContent")));
  // several points: a box over the whole view picks them all, and a drag on one moves them all as far
  const multi = await evalJS(`(async () => {
    const svg = document.getElementById('rc-svg'), frame = () => new Promise(r => requestAnimationFrame(() => r()));
    const ev = (type, x, y, el, o) => (el || svg).dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 8, clientX: x, clientY: y, button: 0, buttons: 1, ...(o || {}) }));
    const R = svg.getBoundingClientRect();
    ev('pointerdown', R.left - 40, R.top - 40, svg); ev('pointermove', R.right + 40, R.bottom + 40); await frame(); ev('pointerup', R.right + 40, R.bottom + 40);
    const all = svg.querySelectorAll('.pf-pt').length, picked = svg.querySelectorAll('.pf-pt.is-sel').length;
    const before = JSON.parse(JSON.stringify(window.__moAgent.roundCardSection()));
    const c = svg.querySelector('.pf-pt.is-sel'), r = c.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    ev('pointerdown', x, y, c, { shiftKey: false }); ev('pointermove', x + 7, y - 9); await frame(); ev('pointerup', x + 7, y - 9);
    await new Promise(r => setTimeout(r, 300));
    const after = window.__moAgent.roundCardSection();
    const d = before[0].map((p, i) => [after[0][i][0] - p[0], after[0][i][1] - p[1]]);
    const same = d.every(v => Math.abs(v[0] - d[0][0]) < 1e-6 && Math.abs(v[1] - d[0][1]) < 1e-6) && Math.hypot(d[0][0], d[0][1]) > 0;
    return { all, picked, same, n0: before[0].length, n1: after[0].length, d0: d[0] };
  })()`);
  check('a box over the view picks every point, and a drag moves them all as far', multi.all > 3 && multi.picked === multi.all && multi.same && multi.n0 === multi.n1, multi);
  await evalJS("document.getElementById('rc-edit-reset').click()"); await sleep(300);
  if (SHOT) await shot(SHOT.replace(/\.png$/, '-card.png'));
  // Apply
  await evalJS("document.getElementById('rc-run').click()");
  await until(`(window.state.parts.find(p => p.partId === ${pid}) || {}).triCount !== ${s0.triangles} && !document.getElementById('rc-run').disabled`);
  const s1 = await sum();
  check('Apply: fewer triangles, still one part', s1.triangles < s0.triangles && s1.parts === 1, { s0: s0.triangles, s1: s1.triangles });
  check('the button says Done', (await evalJS("document.getElementById('rc-run-lbl').textContent")) === 'Done');
  await evalJS("document.querySelector('#rc-mode button[data-m=\"outline\"]').click()"); await sleep(300);
  check('once applied, the mode stays (a new mode is a new command)', (await evalJS('window.__moAgent.roundCardState().mode')) === 'exact');
  await evalJS("window.__moAgent.roundCardSet('segments', 24)");
  await until(`!document.getElementById('rc-run').disabled && (window.state.parts.find(p => p.partId === ${pid}) || {}).triCount !== ${s1.triangles}`);
  check('Segments after Apply build it again', (await sum()).triangles !== s1.triangles);
  // (from the old Round part card's test) the selection follows the new shape: its outline is the shape's edges, not a box, and its
  // glow is drawn from the part's own geometry
  await call('select_parts', { ids: [pid] });
  const t24 = (await sum()).triangles;
  await evalJS("window.__moAgent.roundCardSet('segments', 20)");
  await until(`!document.getElementById('rc-run').disabled && (window.state.parts.find(p => p.partId === ${pid}) || {}).triCount !== ${t24}`);
  const ov = await evalJS(`(() => { const p = window.state.parts.find(q => q.partId === ${pid}); const kids = p.mesh.children, sel = kids.filter(k => k.userData && k.userData.selChild && !k.userData.selGlow), glow = kids.filter(k => k.userData && k.userData.selGlow); return { sel: sel.length, boxy: sel.some(l => l.geometry.attributes.position.count <= 24), glows: glow.length, same: glow.every(k => k.geometry === p.mesh.geometry) }; })()`);
  check('after a Segments change the selection outline and glow are the new shape', ov.sel > 0 && !ov.boxy && ov.glows > 0 && ov.same, ov);
  check('the view is Wireframe while the card is open, once applied', (await sum()).view_mode === 'wire');
  // Shading angle 2°: every face lit flat; back to 30°: smooth round the part; the shape is the same
  const flatShare = () => evalJS(`(() => { const g = window.state.parts.find(q => q.partId === ${pid}).mesh.geometry, P = g.attributes.position.array, Nn = g.attributes.normal.array, I = g.index.array; let flat = 0;
    for (let t = 0; t < I.length; t += 3) { const v = [I[t], I[t + 1], I[t + 2]]; const u = [0, 1, 2].map(k => P[3 * v[1] + k] - P[3 * v[0] + k]), w = [0, 1, 2].map(k => P[3 * v[2] + k] - P[3 * v[0] + k]);
      const f = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], l = Math.hypot(...f) || 1;
      if (v.every(i => (Nn[3 * i] * f[0] + Nn[3 * i + 1] * f[1] + Nn[3 * i + 2] * f[2]) / l > 0.9999)) flat++; }
    return flat / (I.length / 3); })()`);
  const t20 = (await sum()).triangles;
  await evalJS("window.__moAgent.roundCardSet('smooth', 2)");
  await until(`!document.getElementById('rc-run').disabled && window.state.parts.find(p => p.partId === ${pid}).shadeAngle === 2`);
  check('Shading angle 2°: every face lit flat, same triangles', (await flatShare()) > 0.999 && (await sum()).triangles === t20);
  await evalJS("window.__moAgent.roundCardSet('smooth', 30)");
  await until(`!document.getElementById('rc-run').disabled && window.state.parts.find(p => p.partId === ${pid}).shadeAngle === 30`);
  check('back to 30°: shaded smooth round the part', (await flatShare()) < 0.9);
  if (SHOT) await shot(SHOT);
  // Enter, with a slider of the card in focus, closes it (Done) and puts the view back
  await evalJS("document.querySelector('#rc-seg-scrub input[type=range]')?.focus()");
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await sleep(500);
  check('Enter closes the card', await evalJS("document.querySelector('.section-cmd[data-cmd=\"round\"]').hidden"));
  check('and the view is as it was', (await sum()).view_mode === s0.view_mode, { before: s0.view_mode, now: (await sum()).view_mode });
  await call('undo'); await sleep(500);
  check('one undo puts the spool back', (await sum()).triangles === s0.triangles);
  // Segments around is remembered: opened again, the card starts at 20
  await evalJS(`window.__moAgent.roundCard({ ids: [${pid}], mode: 'exact', width_mm: 7 })`); await sleep(300);
  check('opened again, Segments around is the 20 left last time', (await evalJS('window.__moAgent.roundCardState().options.segments')) === 20);
  // applied, then undone with the card open: the options leave the part alone and say why
  await evalJS("document.getElementById('rc-run').click()");
  await until(`!document.getElementById('rc-run').disabled && (window.state.parts.find(p => p.partId === ${pid}) || {}).triCount !== ${s0.triangles}`);
  await call('undo'); await sleep(400);
  await evalJS("window.__moAgent.roundCardSet('segments', 30)"); await sleep(600);
  check('after undo the options leave the part alone', (await sum()).triangles === s0.triangles);
  check('and say why', /no longer the last one/.test(await evalJS("document.getElementById('rc-info').textContent")));
  await evalJS("document.querySelector('.section-cmd[data-cmd=\"round\"] .cmd-close')?.click()"); await sleep(300);
} catch (e) { fail++; console.log('HARNESS ERROR:', e.message); }
console.log(`\n${pass} passed, ${fail} failed`);
console.log('page exceptions:', errors.length); errors.slice(0, 12).forEach(e => console.log('  ' + e));
try { ws && ws.close(); } catch (_) {}
chrome.kill();
process.exit(fail ? 1 : 0);
