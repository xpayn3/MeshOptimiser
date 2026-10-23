// node tests/e2e-profile-options.mjs [shot.png]
//
// Drives the options of Profile: clean outline added in 0.37 in the real app in headless Chrome: two copies of an L profile (the
// second turned a quarter about its length and moved), both selected. The card shows its new fields (Round corners, Grow outline,
// Ends, Extend, Keep chambers wider than, Keep holes wider than, Make symmetric, Same edit on matching profiles); Mitre shows its
// angle and side; Extend and Round change the preview; an edit by hand to the first profile goes to the second, turned to fit; Apply
// builds both, one undo puts both back. Optional picture of the card.
// Needs the app served on http://localhost:4242 (or APP_PORT), Chrome installed and Node 22+.
import { spawn } from 'child_process';
import fs from 'fs';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SHOT = process.argv[2];
const PORT = 9353, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-opts-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── the model: an L with two chambers and a narrow slot, 300 long along Z, twice (B turned 90° about Z and moved 200 along X) ──
const outer = [[0, 0], [38.5, 0], [38.5, 10], [41.5, 10], [41.5, 0], [100, 0], [100, 80], [80, 80], [80, 20], [0, 20]];
const holes = [[[5, 5], [5, 12], [25, 12], [25, 5]], [[88, 30], [88, 75], [95, 75], [95, 30]]];
const inPoly = (p, L) => { let c = false; for (let i = 0, j = L.length - 1; i < L.length; j = i++) { const a = L[i], b = L[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
const LEN = 300, v = [], f = [];
const write = (name, place) => {
  f.push('o ' + name);
  const V = (x, y, z) => { const p = place(x, y); v.push(`v ${p[0]} ${p[1]} ${z}`); return v.length; };
  for (const L of [outer, ...holes]) {
    const n = L.length, a = L.map(p => V(p[0], p[1], 0)), b = L.map(p => V(p[0], p[1], LEN));
    for (let k = 0; k < n; k++) { const k1 = (k + 1) % n; f.push(`f ${a[k]} ${a[k1]} ${b[k1]} ${b[k]}`); }
  }
  const xs = [...new Set([outer, ...holes].flat().map(p => p[0]))].sort((p, q) => p - q), ys = [...new Set([outer, ...holes].flat().map(p => p[1]))].sort((p, q) => p - q);
  for (let i = 0; i + 1 < xs.length; i++) for (let j = 0; j + 1 < ys.length; j++) {
    const c = [(xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2];
    if (!inPoly(c, outer) || holes.some(h => inPoly(c, h))) continue;
    const q = [[xs[i], ys[j]], [xs[i + 1], ys[j]], [xs[i + 1], ys[j + 1]], [xs[i], ys[j + 1]]];
    const top = q.map(p => V(p[0], p[1], LEN)), bot = q.map(p => V(p[0], p[1], 0));
    f.push(`f ${top.join(' ')}`, `f ${bot.reverse().join(' ')}`);
  }
};
write('ProfileA', (x, y) => [x, y]);
write('ProfileB', (x, y) => [200 - y, x]);
const objText = v.join('\n') + '\n' + f.join('\n') + '\n';

const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,1100', 'about:blank'], { stdio: 'ignore' });
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
const until = async (expr, ms = 8000) => { for (let t = 0; t < ms; t += 150) { if (await evalJS(expr).catch(() => false)) return true; await sleep(150); } return false; };
const stats = () => evalJS("document.getElementById('pf-stats').textContent");
const area = (L) => { let s = 0; for (let i = 0; i < L.length; i++) { const p = L[i], q = L[(i + 1) % L.length]; s += p[0] * q[1] - q[0] * p[1]; } return s / 2; };
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
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1100, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await evalJS("document.getElementById('welcome-close')?.click()");
  await evalJS(`(() => { window.__moOpenFile(new File([${JSON.stringify(objText)}], 'two-profiles.obj')); return true; })()`);
  for (let i = 0; i < 20; i++) {
    if (await evalJS("document.getElementById('import-modal')?.classList.contains('show')").catch(() => false)) { await evalJS("document.querySelector('#import-modal-confirm')?.click()"); break; }
    await sleep(250);
  }
  let s0 = null;
  for (let i = 0; i < 120; i++) { s0 = await sum(); if (s0 && s0.parts >= 2 && s0.triangles > 0) break; await sleep(500); }
  await sleep(1500);
  check('two profiles are open', s0 && s0.parts === 2, s0);
  const ids = (await call('list_parts', { sort_by: 'triangles', limit: 5 })).j.parts.map(p => p.id).sort((a, b) => a - b);
  await evalJS(`window.__moAgent.cleanProfile({ ids: ${JSON.stringify(ids)}, width_mm: 5, keep_chambers: false, ends: 'found', extend_mm: 0, round_mm: 0, offset_mm: 0, symmetric: false, match: true })`);
  await sleep(400);
  check('the card opens on both', (await evalJS('window.__moAgent.profileState().summary.profiles')) === 2);
  check('the new fields are there', await evalJS("['pf-round-scrub', 'pf-offset-scrub', 'pf-extend-scrub', 'pf-keepch-scrub', 'pf-keepholes-scrub'].every(id => document.getElementById(id).textContent.length > 0) && !!document.getElementById('pf-ends') && !!document.getElementById('pf-sym')"));
  check('Same edit on matching profiles shows with two profiles; the mitre fields wait for Mitre', await evalJS("!document.getElementById('pf-match-row').hidden && document.getElementById('pf-mitre-row').hidden"));
  check('Keep holes waits for Fill holes and cuts across', await evalJS("document.getElementById('pf-keepholes-row').hidden === !document.getElementById('pf-machining').checked"));

  // ends and length
  await evalJS("document.querySelector('#pf-ends button[data-e=\"mitre\"]').click()"); await sleep(200);
  check('Mitre: the angle and the side show, the ends read 45°', await evalJS("!document.getElementById('pf-mitre-row').hidden") && /45° and 45°/.test(await stats()), await stats());
  await evalJS("document.querySelector('#pf-ends button[data-e=\"found\"]').click()"); await sleep(150);
  await evalJS("window.__moAgent.profileSet('extend', 10)"); await sleep(150);
  check('Extend each end by 10: the length reads 300 → 320', /300 mm → 320 mm/.test(await stats()), await stats());
  await evalJS("window.__moAgent.profileSet('extend', 0)");
  const n0 = await evalJS('window.__moAgent.profileSection()[0].outer.length');
  await evalJS("window.__moAgent.profileSet('round', 2)"); await sleep(150);
  const n1 = await evalJS('window.__moAgent.profileSection()[0].outer.length');
  check('Round corners 2: the section has arcs (more points)', n1 > n0 + 8, { n0, n1 });
  await evalJS("window.__moAgent.profileSet('round', 0)");

  // Shift held while dragging a bar: it snaps to twentieths of the range, and onto 0 in the middle of one that goes both ways
  await evalJS("(() => { const l = document.getElementById('loader'); if (l) l.style.display = 'none'; })()");
  const dragOn = async (id, from, to, shift) => {
    await evalJS(`document.querySelector('#${id} .scrub-range').scrollIntoView({ block: 'center' })`); await sleep(150);
    const b = await evalJS(`(() => { const r = document.querySelector('#${id} .scrub-range').getBoundingClientRect(); return { x: r.left, y: r.top + r.height / 2, w: r.width }; })()`);
    const m = shift ? 8 : 0;
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: b.x + b.w * from, y: b.y, button: 'left', buttons: 1, clickCount: 1, modifiers: m });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.x + b.w * to, y: b.y, button: 'left', buttons: 1, modifiers: m });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x + b.w * to, y: b.y, button: 'left', buttons: 0, clickCount: 1, modifiers: m });
    await sleep(250);
    return evalJS('window.__moAgent.profileState().options');
  };
  const o1 = await dragOn('pf-offset-scrub', 0.7, 0.515, true);
  check('Shift-drag on Grow outline near the middle lands on 0', o1.offset === 0, o1.offset);
  const o2 = await dragOn('pf-offset-scrub', 0.5, 0.515, false);
  check('without Shift the same drag stops off 0', o2.offset !== 0, o2.offset);
  const o3 = await dragOn('pf-width-scrub', 0.2, 0.33, true);
  const wMax = await evalJS("(() => { const r = document.querySelector('#pf-width-scrub .scrub-range'); return +r.max; })()");
  const wStepNow = await evalJS("(() => { const r = document.querySelector('#pf-width-scrub .scrub-range'); return +r.value; })()");
  check('Shift-drag on Fill gaps lands on a twentieth of its range', wStepNow % Math.max(1, Math.round(wMax / 20)) === 0, { step: wStepNow, max: wMax, width: o3.width });
  await evalJS("window.__moAgent.profileSet('offset', 0)"); await evalJS("window.__moAgent.profileSet('width', 5)");

  // an edit by hand goes to the other profile, turned to fit
  const sec = await evalJS('window.__moAgent.profileSection()');
  const edited = [{ outer: sec[0].outer.filter((_, i) => i !== 1), holes: [] }];      // (a corner taken out)
  const sA = await evalJS(`window.__moAgent.profileEdit(${JSON.stringify(edited)})`);
  check('the edit goes to the matching profile', sA && sA.same_edit_on === 1, sA);
  check('the readout says so', /Same edit on1 matching profile/.test(await stats()), await stats());
  const sB = await evalJS('window.__moAgent.profileStep(1)');
  const secB = await evalJS('window.__moAgent.profileSection()');
  check('the second profile shows it, from the first', sB && sB.edited && !!sB.edit_from, sB);
  check('its section is the edited one (same area, turned)', secB && Math.abs(Math.abs(area(secB[0].outer)) - Math.abs(area(edited[0].outer))) < 1e-3 * Math.abs(area(edited[0].outer)), { a: secB && area(secB[0].outer), b: area(edited[0].outer) });
  await evalJS('window.__moAgent.profileStep(-1)');
  if (SHOT) {
    await evalJS("(() => { const l = document.getElementById('loader'); if (l) l.style.visibility = 'hidden'; })()");
    await evalJS("window.__moAgent.profileSet('ends', 'mitre')"); await evalJS("document.getElementById('pf-adv').open = true"); await sleep(400);
    const r = await evalJS("(() => { const b = document.querySelector('.section-cmd[data-cmd=\"profile\"]').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()");
    const img = await send('Page.captureScreenshot', { format: 'png', clip: { x: r.x, y: r.y, width: r.w, height: Math.min(r.h, 1100 - r.y), scale: 1 } });
    fs.writeFileSync(SHOT, Buffer.from(img.data, 'base64')); console.log('picture:', SHOT);
    // (the card scrolls: its lower half as a second picture)
    await evalJS("(() => { for (const e of document.querySelectorAll('.section-cmd[data-cmd=\"profile\"] *')) if (e.scrollHeight > e.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(e).overflowY)) e.scrollTop = e.scrollHeight; })()"); await sleep(300);
    const img2 = await send('Page.captureScreenshot', { format: 'png', clip: { x: r.x, y: r.y, width: r.w, height: Math.min(r.h, 1100 - r.y), scale: 1 } });
    fs.writeFileSync(SHOT.replace(/\.png$/, '-2.png'), Buffer.from(img2.data, 'base64'));
    // (the first bar under the pointer: its handle grows)
    await evalJS("(() => { for (const e of document.querySelectorAll('.section-cmd[data-cmd=\"profile\"] *')) if (e.scrollTop) e.scrollTop = 0; })()"); await sleep(200);
    const bar = await evalJS("(() => { const b = document.querySelector('#pf-width-scrub .scrub-range').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()");
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: bar.x + bar.w * 0.6, y: bar.y + bar.h / 2 }); await sleep(300);
    const img3 = await send('Page.captureScreenshot', { format: 'png', clip: { x: bar.x - 8, y: bar.y - 24, width: bar.w + 110, height: bar.h + 32, scale: 2 } });
    fs.writeFileSync(SHOT.replace(/\.png$/, '-hover.png'), Buffer.from(img3.data, 'base64'));
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
    await evalJS("window.__moAgent.profileSet('ends', 'found')");
  }

  // Apply: both built; one undo
  await evalJS("document.getElementById('pf-run').click()");
  await until(`window.__moAgent.profileState() && window.__moAgent.profileState().applied && !document.getElementById('pf-run').disabled`);
  const s1 = await sum();
  check('Apply builds both: fewer triangles, still two parts', s1.triangles < s0.triangles && s1.parts === 2, { s0: s0.triangles, s1: s1.triangles });
  await evalJS("window.__moAgent.profileSet('extend', -50)");
  // (built again when the option rests: the part's box tells when)
  await until(`(() => { const p = window.state.parts.find(q => q.partId === ${ids[0]}); p.mesh.geometry.computeBoundingBox(); const b = p.mesh.geometry.boundingBox; return Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z) < 250 && !document.getElementById('pf-run').disabled; })()`);
  // (the OBJ came in Y up, so the bar's length is along whichever axis it is now: the longest side of its box)
  const box = await evalJS(`(() => { const p = window.state.parts.find(q => q.partId === ${ids[0]}); p.mesh.geometry.computeBoundingBox(); const b = p.mesh.geometry.boundingBox; return [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z]; })()`);
  check('after Apply, Extend −50 builds it again 200 long', Math.abs(Math.max(...box) - 200) < 1e-3, box);
  await evalJS("document.getElementById('pf-run').click()"); await sleep(300);
  await call('undo'); await sleep(500);
  check('one undo puts both back', (await sum()).triangles === s0.triangles);
} catch (e) { fail++; console.log('HARNESS ERROR:', e.message); }
console.log(`\n${pass} passed, ${fail} failed`);
console.log('page exceptions:', errors.length); errors.slice(0, 12).forEach(e => console.log('  ' + e));
try { ws && ws.close(); } catch (_) {}
chrome.kill();
process.exit(fail ? 1 : 0);
