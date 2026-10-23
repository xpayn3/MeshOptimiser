// node tests/e2e-profile-scene.mjs [shot.png]
//
// Drives the Profile: clean outline card on a whole scene, in the real app in headless Chrome. It writes an OBJ with three objects: a
// CAD-like L profile (two chambers, five teeth, a narrow slot and a wide channel; caps made of rectangles; the far end mitred), a
// plain bar, and a pyramid (not a profile). With nothing selected the card looks at the whole scene and keeps the two profiles; it
// checks the stepper, the readout, the editor (a point dragged by the pointer snaps onto the profile as it was; Delete takes a point
// out, not a part; the edited part is built from its section; Reset points goes back), Apply to both in one undo step (the pyramid
// left alone), and one undo putting both back. (tests/e2e-profile.mjs covers one part: the options, the Shading angle, Done.)
// Needs the app served on http://localhost:4242 (or APP_PORT), Chrome installed and Node 22+.
import { spawn } from 'child_process';
import fs from 'fs';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SHOT = process.argv[2];
const PORT = 9353, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-scene-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── the model ──
const outer = [[0, 0], [38.5, 0], [38.5, 10], [41.5, 10], [41.5, 0], [100, 0], [100, 80], [80, 80]];
for (const y of [70, 60, 50, 40, 30]) outer.push([80, y], [83, y], [83, y - 2], [80, y - 2]);
outer.push([80, 20], [60, 20], [60, 15], [30, 15], [30, 20], [0, 20]);
const holes = [[[5, 5], [5, 12], [25, 12], [25, 5]], [[88, 30], [88, 75], [95, 75], [95, 30]]];
const inPoly = (p, L) => { let c = false; for (let i = 0, j = L.length - 1; i < L.length; j = i++) { const a = L[i], b = L[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
const LEN = 300, v = [], f = [];
const Z1 = (x, y) => LEN + 0.5 * y;          // the far end of the L is cut at an angle (26.6°)
const V = (x, y, z) => { v.push(`v ${x} ${y} ${z}`); return v.length; };
f.push('o profile_L');
for (const L of [outer, ...holes]) {
  const n = L.length, a = L.map(p => V(p[0], p[1], 0)), b = L.map(p => V(p[0], p[1], Z1(p[0], p[1])));
  for (let k = 0; k < n; k++) { const k1 = (k + 1) % n; f.push(`f ${a[k]} ${a[k1]} ${b[k1]} ${b[k]}`); }
}
const xs = [...new Set([outer, ...holes].flat().map(p => p[0]))].sort((p, q) => p - q), ys = [...new Set([outer, ...holes].flat().map(p => p[1]))].sort((p, q) => p - q);
for (let i = 0; i + 1 < xs.length; i++) for (let j = 0; j + 1 < ys.length; j++) {
  const c = [(xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2];
  if (!inPoly(c, outer) || holes.some(h => inPoly(c, h))) continue;
  const q = [[xs[i], ys[j]], [xs[i + 1], ys[j]], [xs[i + 1], ys[j + 1]], [xs[i], ys[j + 1]]];
  const top = q.map(p => V(p[0], p[1], Z1(p[0], p[1]))), bot = q.map(p => V(p[0], p[1], 0));
  f.push(`f ${top.join(' ')}`, `f ${bot.reverse().join(' ')}`);
}
{ // a plain bar 30 x 10, 200 long, beside it
  f.push('o bar_B');
  const q = [[200, 0], [230, 0], [230, 10], [200, 10]], a = q.map(p => V(p[0], p[1], 0)), b = q.map(p => V(p[0], p[1], 200));
  for (let k = 0; k < 4; k++) { const k1 = (k + 1) % 4; f.push(`f ${a[k]} ${a[k1]} ${b[k1]} ${b[k]}`); }
  f.push(`f ${b.join(' ')}`, `f ${a.slice().reverse().join(' ')}`);
}
{ // a pyramid: not a profile
  f.push('o pyramid_C');
  const a = V(300, 0, 0), b = V(340, 0, 0), c = V(340, 40, 0), d = V(300, 40, 0), t = V(320, 20, 50);
  f.push(`f ${a} ${d} ${c} ${b}`, `f ${a} ${b} ${t}`, `f ${b} ${c} ${t}`, `f ${c} ${d} ${t}`, `f ${d} ${a} ${t}`);
}
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
const tris = (name) => evalJS(`(window.state.parts.find(p => p.name === ${JSON.stringify(name)}) || {}).triCount`);
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
  await evalJS(`(() => { window.__moOpenFile(new File([${JSON.stringify(objText)}], 'profiles.obj')); return true; })()`);
  for (let i = 0; i < 20; i++) {             // (an OBJ asks how to bring it in first)
    if (await evalJS("document.getElementById('import-modal')?.classList.contains('show')").catch(() => false)) { await evalJS("document.querySelector('#import-modal-confirm')?.click()"); break; }
    await sleep(250);
  }
  let s0 = null;
  for (let i = 0; i < 120; i++) { s0 = await sum(); if (s0 && s0.parts >= 3 && s0.triangles > 0) break; await sleep(500); }
  await sleep(1500);
  check('the three parts are open', s0 && s0.parts === 3, s0 && s0.parts);
  const L0 = await tris('profile_L'), B0 = await tris('bar_B'), C0 = await tris('pyramid_C');
  await evalJS('window.state.selected.clear()');

  // ── the whole scene, nothing selected ──
  const o = await evalJS(`window.__moAgent.cleanProfile({ width_mm: 5, keep_chambers: false, fill_machining: true })`);
  await sleep(400);
  check('nothing selected: the scene is looked at, two profiles kept, the pyramid left out', o && o.ok && o.parts === 2 && o.skipped.length === 1 && /pyramid/.test(o.skipped[0].name), o);
  check('the card opens', await evalJS("!document.querySelector('.section-cmd[data-cmd=\"profile\"]').hidden"));
  check('the stepper shows 1 of 2', (await evalJS("(() => { const s = document.getElementById('pf-step'); return !s.hidden && document.getElementById('pf-pos').textContent; })()")) === '1 of 2');
  check('the Apply button says how many', (await evalJS("document.getElementById('pf-run-lbl').textContent")) === 'Apply to 2');
  let st = await evalJS('window.__moAgent.profileState()');
  if (st.summary.name !== 'profile_L') { await evalJS('window.__moAgent.profileStep(1)'); st = await evalJS('window.__moAgent.profileState()'); }
  check('the L is shown', st.summary.name === 'profile_L', st.summary);
  const txt = await evalJS("document.getElementById('pf-stats').textContent");
  check('the readout: two profiles, one part left, the mitred end, two chambers, six gaps', /Profiles2 · 1 other part/.test(txt) && /26\.6°/.test(txt) && /2 filled/.test(txt) && /Gaps closed6/.test(txt), txt);
  check('nothing changed before Apply', (await sum()).triangles === s0.triangles);
  const other = await evalJS('window.__moAgent.profileStep(1)');
  check('› steps to the other profile', other.name !== 'profile_L' && /2 of 2/.test(await evalJS("document.getElementById('pf-pos').textContent")), other);
  await evalJS('window.__moAgent.profileStep(1)');

  // ── the editor ──
  await evalJS("document.getElementById('pf-edit').click()"); await sleep(200);
  const pts = await evalJS("document.querySelectorAll('#pf-svg .pf-pt').length");
  const sec0 = await evalJS('window.__moAgent.profileSection()');
  check('Edit points shows a handle on every point of the new section', pts > 0 && pts === sec0.reduce((n, S) => n + S.outer.length + S.holes.reduce((m, H) => m + H.length, 0), 0), { pts });
  // the first handle, dragged by the pointer to 3 px from a corner of the section as it was, lands on that corner exactly
  const corner = await evalJS('(() => { const s = window.__moAgent.profileSection(); return s[0].outer[3]; })()');
  const drag = await evalJS(`(async () => {
    const svg = document.getElementById('pf-svg'), c = svg.querySelector('.pf-pt'), M = svg.getScreenCTM();
    const at = (x, y) => { const p = svg.createSVGPoint(); p.x = x; p.y = -y; const q = p.matrixTransform(M); return [q.x, q.y]; };
    const r = c.getBoundingClientRect(), from = [r.left + r.width / 2, r.top + r.height / 2], to = at(${corner[0]}, ${corner[1]});
    const ev = (type, x, y, el) => (el || svg).dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, clientX: x, clientY: y, button: 0, buttons: 1 }));
    ev('pointerdown', from[0], from[1], c); ev('pointermove', to[0] + 3, to[1] - 2); const snapMark = !!svg.querySelector('.pf-snap'); ev('pointerup', to[0] + 3, to[1] - 2);
    await new Promise(r => setTimeout(r, 300));
    return { p: window.__moAgent.profileSection()[0].outer[0], snapMark };
  })()`);
  check('a dragged point snaps onto a corner of the profile as it was', drag.snapMark && Math.abs(drag.p[0] - corner[0]) < 1e-6 && Math.abs(drag.p[1] - corner[1]) < 1e-6, { drag, corner });
  check('the readout says the section is edited, and Reset points shows', /as edited/.test(await evalJS("document.getElementById('pf-stats').textContent")) && !(await evalJS("document.getElementById('pf-edit-reset').hidden")));
  // pick the second handle and press Delete: one point fewer, and the scene keeps its parts
  const before = (await evalJS('window.__moAgent.profileSection()'))[0].outer.length;
  await evalJS(`(() => { const svg = document.getElementById('pf-svg'), c = svg.querySelectorAll('.pf-pt')[1], r = c.getBoundingClientRect(); const ev = (t, el) => el.dispatchEvent(new PointerEvent(t, { bubbles: true, pointerId: 8, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, buttons: 1 })); ev('pointerdown', c); ev('pointerup', svg); svg.focus(); svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true })); })()`);
  await sleep(300);
  check('Delete takes the picked point out, not a part', (await evalJS('window.__moAgent.profileSection()'))[0].outer.length === before - 1 && (await sum()).parts === 3);
  if (SHOT) await shot(SHOT.replace(/\.png$/, '-card.png'));

  // ── Apply ──
  await evalJS("document.getElementById('pf-run').click()");
  for (let i = 0; i < 40 && (await tris('bar_B')) === B0; i++) await sleep(250);
  const L1 = await tris('profile_L'), B1 = await tris('bar_B');
  check('Apply builds both profiles and leaves the pyramid', L1 !== L0 && B1 > 0 && (await tris('pyramid_C')) === C0 && (await sum()).parts === 3, { L0, L1, B0, B1 });
  check('the L is built from the section as edited', (await evalJS('window.__moAgent.profileState().summary.edited')) === true);
  if (SHOT) await shot(SHOT);
  await evalJS("document.getElementById('pf-edit-reset').click()"); await sleep(900);
  check('Reset points: the L is built from the options again, in the same step', (await evalJS('window.__moAgent.profileState().summary.edited')) === false && (await tris('profile_L')) !== L1);
  await evalJS("document.getElementById('pf-run').click()"); await sleep(300);
  await call('undo'); await sleep(500);
  check('one undo puts both parts back', (await tris('profile_L')) === L0 && (await tris('bar_B')) === B0 && (await sum()).triangles === s0.triangles);

  // ── the card follows the selection ──
  await call('select_parts', { name_contains: 'profile_L' }); await sleep(200);
  await evalJS('window.__moAgent.cleanProfile({})'); await sleep(300);
  await evalJS("document.getElementById('pf-run').click()");
  for (let i = 0; i < 40 && !(await evalJS('window.__moAgent.profileState()'))?.applied; i++) await sleep(250);
  check('opened on the L and applied', (await evalJS('window.__moAgent.profileState()'))?.applied === true);
  const L2 = await tris('profile_L'), B2 = await tris('bar_B');
  await call('select_parts', { name_contains: 'bar_B' }); await sleep(700);
  let fs1 = await evalJS('window.__moAgent.profileState()');
  check('another part selected after Apply: the card moves to it, at Apply again', fs1 && fs1.summary.name === 'bar_B' && !fs1.applied && fs1.summary.profiles === 1
    && (await evalJS("document.getElementById('pf-run-lbl').textContent")) === 'Apply' && (await evalJS("document.getElementById('pf-name').textContent")) === 'bar_B', fs1);
  check('the L keeps what Apply made', (await tris('profile_L')) === L2 && (await tris('bar_B')) === B2);
  await call('select_parts', { name_contains: 'pyramid_C' }); await sleep(700);
  fs1 = await evalJS('window.__moAgent.profileState()');
  check('a part that is no profile selected: the card stays on the bar', fs1 && fs1.summary.name === 'bar_B', fs1);
  await evalJS('window.state.selected.clear()'); await evalJS("document.querySelector('.section-cmd[data-cmd=\"profile\"] .cmd-close')?.click()");
} catch (e) { fail++; console.log('HARNESS ERROR:', e.message); }
console.log(`\n${pass} passed, ${fail} failed`);
console.log('page exceptions:', errors.length); errors.slice(0, 12).forEach(e => console.log('  ' + e));
try { ws && ws.close(); } catch (_) {}
chrome.kill();
process.exit(fail ? 1 : 0);
