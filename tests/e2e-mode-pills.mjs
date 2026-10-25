// node tests/e2e-mode-pills.mjs [model.glb]
//
// The status pills right of the camera pill (#vp-mode-pills) move instead of popping (_modePillMotion in app.js): a pill that comes on
// slides out, one that goes off tucks away before it is really hidden, the pills beside it glide, and el.hidden answers what was asked
// for at once. Drives the real app in headless Chrome (the app on http://localhost:4242, or APP_PORT): Isolate through the bridge
// tools (the real way in and out), the other pills by setting el.hidden as their own code does, a quick on-off-on, and reduced motion.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || (fs.existsSync('inbox/GearboxAssy.glb') ? 'inbox/GearboxAssy.glb' : 'tests/fixtures/test-model.glb');
const PORT = parseInt(process.env.CDP_PORT || '9396', 10), PROFILE = (process.env.TEMP || '.') + '/cdp-profile-pills-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--mute-audio', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const call = async (name, args = {}) => {
  const r = await evalJS(`(async () => { try { const f = window.__moBridgeTools[${JSON.stringify(name)}]; if (!f) return { ok: false, e: 'no such tool' }; const r = await f(${JSON.stringify(args)}); return { ok: true, t: r.map(x => x.type === 'text' ? x.text : '[' + x.type + ']') }; } catch (e) { return { ok: false, e: e.message || String(e) }; } })()`);
  if (r.ok) { const s = r.t.join('\n'); let j = null; try { j = JSON.parse(s); } catch (_) {} return { ok: true, s, j }; }
  return { ok: false, e: r.e };
};
// what a pill is: what el.hidden says, whether the attribute is really there, whether it is drawn, and its running animations
const pill = (pid) => evalJS(`(() => { const el = document.getElementById(${JSON.stringify(pid)}); if (!el) return null; return { hidden: el.hidden, attr: el.hasAttribute('hidden'), shown: getComputedStyle(el).display !== 'none', anims: el.getAnimations().filter(a => a.playState === 'running').length, clip: document.getElementById('vp-mode-pills').style.clipPath }; })()`);
// wait (up to 3 s: swiftshader draws slowly with a model in view) until a pill has settled: no animation left running
const settle = async (pid) => { let p; for (let i = 0; i < 60; i++) { p = await pill(pid); if (p && p.anims === 0 && !p.clip) return p; await sleep(50); } return p; };
const setHidden = (pid, v) => evalJS(`(() => { document.getElementById(${JSON.stringify(pid)}).hidden = ${!!v}; return true; })()`);
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } return ok; };
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
  const b64 = fs.readFileSync(MODEL).toString('base64');
  await evalJS(`(async () => { const bin = atob(${JSON.stringify(b64)}); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); const f = new File([u], ${JSON.stringify(path.basename(MODEL))}); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  let s0 = null;
  for (let i = 0; i < 120; i++) { s0 = (await call('scene_summary')).j; if (s0 && s0.parts > 0) break; await sleep(500); }
  await sleep(1500);
  if (!s0 || !s0.parts) throw new Error('the model did not open');
  console.log(`model ${MODEL}: ${s0.parts} parts`);
  check('the pills are wrapped', await evalJS("!!Object.getOwnPropertyDescriptor(document.getElementById('vp-explode-pill'), 'hidden') && !Object.getOwnPropertyDescriptor(document.getElementById('vp-snap-pill'), 'hidden')"));

  // a pill comes on: el.hidden says so at once, it slides in, and settles with the row unclipped
  await setHidden('vp-explode-pill', false);
  let p = await pill('vp-explode-pill');
  check('on: hidden is false at once', p.hidden === false && !p.attr && p.shown, p);
  check('on: it slides in', p.anims > 0 && p.clip !== '', p);
  p = await settle('vp-explode-pill');
  check('on: settled, row unclipped', p.shown && p.anims === 0 && p.clip === '', p);

  // Isolate comes on left of it (the real way, through the bridge): the Exploded pill glides aside
  const lp = await call('list_parts', { limit: 5 });
  const first = lp.j.parts[0].id;
  await call('isolate_parts', { ids: [first] });
  let glided = false, iso = null;
  for (let i = 0; i < 20 && !glided; i++) { await sleep(10); iso = await pill('vp-isolate-pill'); const ex = await pill('vp-explode-pill'); glided = iso.shown && ex.anims > 0; }
  check('isolate: its pill comes and Exploded glides', glided, iso);
  await sleep(450);

  // Isolate goes off: el.hidden is true at once, the pill is still drawn while it tucks away, then really hidden
  await call('show_all');
  let off = null;
  for (let i = 0; i < 20; i++) { off = await pill('vp-isolate-pill'); if (off.hidden) break; await sleep(10); }
  check('off: hidden is true at once and it is still tucking away', off.hidden === true && off.shown && !off.attr, off);
  off = await settle('vp-isolate-pill');
  check('off: then really hidden', off.hidden && off.attr && !off.shown && off.anims === 0, off);

  // on, off, on in one go: shown at the end, nothing left running, no stray hidden attribute later
  await evalJS("(() => { const el = document.getElementById('vp-measure-pill'); el.hidden = false; el.hidden = true; el.hidden = false; return true; })()");
  p = await settle('vp-measure-pill');
  check('on-off-on: shown at the end', p.hidden === false && !p.attr && p.shown && p.anims === 0, p);
  await evalJS("(() => { const el = document.getElementById('vp-measure-pill'); el.hidden = true; return true; })()");
  await sleep(60);
  await setHidden('vp-measure-pill', false);
  p = await settle('vp-measure-pill');
  check('off then on mid-way: shown, not hidden by the cancelled exit', p.hidden === false && !p.attr && p.shown, p);
  await setHidden('vp-measure-pill', true);
  await sleep(450);

  // reduced motion: instant both ways
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await setHidden('vp-explode-pill', true);
  p = await pill('vp-explode-pill');
  check('reduced motion: hidden at once', p.hidden && p.attr && !p.shown && p.anims === 0, p);
  await setHidden('vp-explode-pill', false);
  p = await pill('vp-explode-pill');
  check('reduced motion: shown at once', !p.hidden && p.shown && p.anims === 0, p);
  await setHidden('vp-explode-pill', true);

  const errs = errors.filter(e => !/favicon|net::ERR|ResizeObserver/.test(e));
  check('no page errors', !errs.length, errs.slice(0, 5));
} catch (e) {
  fail++; console.log('FAIL (harness)', e.message || e);
} finally {
  try { ws && ws.close(); } catch (_) {}
  try { chrome.kill(); } catch (_) {}
  setTimeout(() => { try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (_) {} }, 500);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
