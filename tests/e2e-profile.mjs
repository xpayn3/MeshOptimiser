// node tests/e2e-profile.mjs [shot.png]
//
// Drives the Profile: clean outline card in the real app in headless Chrome. It writes a CAD-like L profile as an OBJ (two chambers,
// five teeth, a narrow slot and a wide channel that must stay; caps made of rectangles; the far end mitred), opens it, opens the card
// (preview and readout before anything changes), applies it, checks the part is lighter and still one part, that Fill chambers off
// builds it again in the same step with the chambers (more triangles), and that one undo puts it all back. Optional pictures.
// Needs the app served on http://localhost:4242 (or APP_PORT), Chrome installed and Node 22+.
import { spawn } from 'child_process';
import fs from 'fs';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SHOT = process.argv[2];
const PORT = 9352, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-clean-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── the model ──
const outer = [[0, 0], [38.5, 0], [38.5, 10], [41.5, 10], [41.5, 0], [100, 0], [100, 80], [80, 80]];
for (const y of [70, 60, 50, 40, 30]) outer.push([80, y], [83, y], [83, y - 2], [80, y - 2]);
outer.push([80, 20], [60, 20], [60, 15], [30, 15], [30, 20], [0, 20]);
const holes = [[[5, 5], [5, 12], [25, 12], [25, 5]], [[88, 30], [88, 75], [95, 75], [95, 30]]];
const inPoly = (p, L) => { let c = false; for (let i = 0, j = L.length - 1; i < L.length; j = i++) { const a = L[i], b = L[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
const LEN = 300, v = [], f = [];
const Z1 = (x, y) => LEN + 0.5 * y;          // the far end is cut at an angle (26.6°)
const V = (x, y, z) => { v.push(`v ${x} ${y} ${z}`); return v.length; };
for (const L of [outer, ...holes]) {           // side walls (holes run clockwise, so their walls face into the chamber)
  const n = L.length, a = L.map(p => V(p[0], p[1], 0)), b = L.map(p => V(p[0], p[1], Z1(p[0], p[1])));
  for (let k = 0; k < n; k++) { const k1 = (k + 1) % n; f.push(`f ${a[k]} ${a[k1]} ${b[k1]} ${b[k]}`); }
}
const xs = [...new Set([outer, ...holes].flat().map(p => p[0]))].sort((p, q) => p - q), ys = [...new Set([outer, ...holes].flat().map(p => p[1]))].sort((p, q) => p - q);
for (let i = 0; i + 1 < xs.length; i++) for (let j = 0; j + 1 < ys.length; j++) {      // caps: the grid cells that are material
  const c = [(xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2];
  if (!inPoly(c, outer) || holes.some(h => inPoly(c, h))) continue;
  const q = [[xs[i], ys[j]], [xs[i + 1], ys[j]], [xs[i + 1], ys[j + 1]], [xs[i], ys[j + 1]]];
  const top = q.map(p => V(p[0], p[1], Z1(p[0], p[1]))), bot = q.map(p => V(p[0], p[1], 0));
  f.push(`f ${top.join(' ')}`, `f ${bot.reverse().join(' ')}`);
}
const objText = v.join('\n') + '\n' + f.join('\n') + '\n';

const chrome = spawn(CH, ['--headless=new', '--mute-audio', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
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
// wait until the page says yes (a build runs in the background and the panel catches up after it), up to 5 s
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
  await evalJS(`(() => { window.__moOpenFile(new File([${JSON.stringify(objText)}], 'l-profile.obj')); return true; })()`);
  for (let i = 0; i < 20; i++) {             // (an OBJ asks how to bring it in first)
    if (await evalJS("document.getElementById('import-modal')?.classList.contains('show')").catch(() => false)) { await evalJS("document.querySelector('#import-modal-confirm')?.click()"); break; }
    await sleep(250);
  }
  let s0 = null;
  for (let i = 0; i < 120; i++) { s0 = await sum(); if (s0 && s0.parts > 0 && s0.triangles > 0) break; await sleep(500); }
  await sleep(1500);
  check('the profile is open', s0 && s0.parts === 1, s0);
  const pid = (await call('list_parts', { sort_by: 'triangles', limit: 1 })).j.parts[0].id;
  await call('select_parts', { ids: [pid] });
  if (SHOT) { await call('set_view_mode', { mode: 'wireframe' }).catch(() => {}); await shot(SHOT.replace(/\.png$/, '-before.png')); }
  await evalJS(`window.state.parts.find(q => q.partId === ${pid}).shadeAngle = 45`);      // (as if set in Properties)
  const o = await evalJS(`(() => { const r = window.__moAgent.cleanProfile({ ids: [${pid}], width_mm: 5, keep_chambers: false }); return r; })()`);
  await sleep(400);
  check('the card opens on a profile', o && o.ok && await evalJS("!document.querySelector('.section-cmd[data-cmd=\"profile\"]').hidden"), o);
  check('the preview draws the section before and after', await evalJS("document.querySelectorAll('#pf-svg path:not(.pf-grid)').length === 3 && !!document.querySelector('#pf-svg .pf-grid') && document.querySelector('#pf-svg .pf-now').getAttribute('d').length > 20"));
  const st = await evalJS("document.getElementById('pf-stats').textContent");
  check('the readout: the mitred end, two chambers, six gaps', /26.6°/.test(st) && /2 filled/.test(st) && /Gaps closed6/.test(st), st);
  { const fit = await evalJS("(() => { const s = document.getElementById('pf-svg').getBoundingClientRect(), b = document.querySelector('#pf-svg .pf-was').getBoundingClientRect(); return { sw: s.width, sh: s.height, bw: b.width, bh: b.height, inside: b.left >= s.left - 1 && b.right <= s.right + 1 && b.top >= s.top - 1 && b.bottom <= s.bottom + 1 }; })()");
    check('the section fills the preview (fitted, inside it)', fit.inside && Math.max(fit.bw / fit.sw, fit.bh / fit.sh) > 0.8, fit); }
  check('nothing changed before Apply', (await sum()).triangles === s0.triangles);
  check('the Fill gaps, Straighten and Smooth sliders are there', await evalJS("['pf-width-scrub', 'pf-straight-scrub', 'pf-smooth-scrub'].every(id => document.getElementById(id).textContent.length > 0)"));
  check('the card starts from the part\'s own Shading angle (45°)', (await evalJS('window.__moAgent.profileState().options.smooth')) === 45);
  if (SHOT) await shot(SHOT.replace(/\.png$/, '-card.png'));
  await evalJS("document.getElementById('pf-run').click()");
  for (let i = 0; i < 20 && (await sum()).triangles === s0.triangles; i++) await sleep(250);
  const s1 = await sum();
  check('Apply: fewer triangles, still one part', s1.triangles < s0.triangles && s1.parts === s0.parts, { s0: s0.triangles, s1: s1.triangles });
  await until(`(() => { const f = document.querySelector('#prop-shade .scrub-value'); return !f || f.textContent === '45'; })()`);
  const sh = await evalJS(`(() => { const p = window.state.parts.find(q => q.partId === ${pid}); const f = document.querySelector('#prop-shade .scrub-value'); return { a: p.shadeAngle, field: f ? f.textContent : null }; })()`);
  check('the part keeps its Shading angle, and Properties shows it', sh.a === 45 && (sh.field === null || sh.field === '45'), sh);
  // at 2° every face is lit flat: each corner's normal is its face's own
  await evalJS("window.__moAgent.profileSet('smooth', 2)");
  await until(`window.state.parts.find(q => q.partId === ${pid}).shadeAngle === 2 && !document.getElementById('pf-run').disabled`);
  const flat = await evalJS(`(() => { const g = window.state.parts.find(q => q.partId === ${pid}).mesh.geometry, P = g.attributes.position.array, N = g.attributes.normal.array, I = g.index.array; let ok = 0;
    for (let t = 0; t < I.length; t += 3) { const v = [I[t], I[t + 1], I[t + 2]], u = [0, 1, 2].map(k => P[3 * v[1] + k] - P[3 * v[0] + k]), w = [0, 1, 2].map(k => P[3 * v[2] + k] - P[3 * v[0] + k]);
      const f = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], l = Math.hypot(...f) || 1;
      if (v.every(i => (N[3 * i] * f[0] + N[3 * i + 1] * f[1] + N[3 * i + 2] * f[2]) / l > 0.9999)) ok++; }
    return { share: ok / (I.length / 3), angle: window.state.parts.find(q => q.partId === ${pid}).shadeAngle }; })()`);
  check('Shading angle 2°: every face lit flat, and the part says 2°', flat.share > 0.999 && flat.angle === 2, flat);
  await evalJS("window.__moAgent.profileSet('smooth', 45)");
  await until(`window.state.parts.find(q => q.partId === ${pid}).shadeAngle === 45 && !document.getElementById('pf-run').disabled`);
  check('the button says Done', (await evalJS("document.getElementById('pf-run-lbl').textContent")) === 'Done');
  if (SHOT) await shot(SHOT);
  await evalJS("window.__moAgent.profileSet('fill', false)");
  for (let i = 0; i < 20 && (await sum()).triangles === s1.triangles; i++) await sleep(250);
  const s2 = await sum();
  check('Fill chambers off: built again with the chambers (more triangles)', s2.triangles > s1.triangles, { s1: s1.triangles, s2: s2.triangles });
  check('the preview shows the chambers kept', await evalJS("/kept/.test(document.getElementById('pf-stats').textContent)"));
  await until("!document.getElementById('pf-run').disabled");
  await evalJS("document.getElementById('pf-run').click()"); await sleep(300);
  check('Done closes the card', await evalJS("document.querySelector('.section-cmd[data-cmd=\"profile\"]').hidden"));
  await call('undo'); await sleep(500);
  check('one undo puts the part back', (await sum()).triangles === s0.triangles);
  check('and the Shading angle it had', (await evalJS(`window.state.parts.find(q => q.partId === ${pid}).shadeAngle`)) === 45);
} catch (e) { fail++; console.log('HARNESS ERROR:', e.message); }
console.log(`\n${pass} passed, ${fail} failed`);
console.log('page exceptions:', errors.length); errors.slice(0, 12).forEach(e => console.log('  ' + e));
try { ws && ws.close(); } catch (_) {}
chrome.kill();
process.exit(fail ? 1 : 0);
