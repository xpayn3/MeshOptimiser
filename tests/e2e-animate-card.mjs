// node tests/e2e-animate-card.mjs [model]
//
// The Animation card of the right sidebar: hidden until something is animated, then play / pause, rewind, loop, speed and the scrubber work.
// Needs the app on http://localhost:4242, Chrome and Node 22+.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9344, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-mcp-' + Date.now();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [], consoleErr = [];
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
    else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') consoleErr.push(d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 220));
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await evalJS("document.getElementById('welcome-close')?.click()");
  await evalJS(`(async () => { const r = await fetch(${JSON.stringify(MODEL)}); const b = await r.blob(); const f = new File([b], ${JSON.stringify(path.basename(MODEL))}); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  for (let i = 0; i < 160; i++) { const n = await evalJS("document.querySelectorAll('#tree .tree-node').length"); if (n > 3) break; await sleep(500); }
  await sleep(4000);


  const q = (expr) => evalJS(expr);
  const txt = (id) => q(`document.getElementById('${id}').textContent`);
  const click = (id) => q(`document.getElementById('${id}').click()`);
  check('the card is hidden while nothing is animated', await q("document.getElementById('anim-card').hidden"));
  const lp = await call('list_parts', { sort_by: 'triangles', limit: 3 });
  const id1 = lp.j.parts[0].id;
  let r = await call('animate_parts', { action: 'add', ids: [id1], type: 'spin', rpm: 60, axis: 'Z' });
  check('a part is set to spin', r.ok && r.j && r.j.animated === 1, r);
  await sleep(600);
  check('the card shows', await q("!document.getElementById('anim-card').hidden && document.getElementById('anim-card').offsetParent !== null"));
  check('the miniature timeline has a bar for the clip', await q("document.querySelectorAll('#ac-tl-bars .ac-clip').length") === 1);
  check('it is playing: the button offers Pause', await q("document.getElementById('ac-play').title") === 'Pause');
  check('the pill at the top says Playing', await q("(() => { const t = document.getElementById('vp-animate-pill'); return !t.hidden && /Playing/.test(t.textContent); })()"));
  const t1 = await txt('ac-elapsed'); let t2 = t1; for (let i = 0; i < 20 && t2 === t1; i++) { await sleep(300); t2 = await txt('ac-elapsed'); }      // (software rendering of a big model can take a while per frame)
  check('the time moves while it plays', t1 !== t2, { t1, t2 });
  await click('ac-play'); await sleep(300);
  check('a click pauses it: the button offers Play', await q("document.getElementById('ac-play').title") === 'Play');
  check('paused: the pill at the top is gone', await q("document.getElementById('vp-animate-pill').hidden"));
  const p1 = await txt('ac-elapsed'); await sleep(600);
  check('paused: the time stays', (await txt('ac-elapsed')) === p1);
  // a press on the miniature puts the playhead there (40% of 5 s = 2 s)
  await q("(() => { const t = document.getElementById('ac-tl'), r = t.getBoundingClientRect(); const o = { bubbles: true, clientX: r.left + r.width * 0.4, clientY: r.top + r.height / 2, pointerId: 1, button: 0, isPrimary: true }; t.dispatchEvent(new PointerEvent('pointerdown', o)); t.dispatchEvent(new PointerEvent('pointerup', o)); })()"); await sleep(300);
  check('a press on the miniature seeks to 2 s', /^0:02\.0/.test(await txt('ac-elapsed')), await txt('ac-elapsed'));
  check('the time left is shown', /^\u22120:02\.9|^\u22120:03\.0/.test(await txt('ac-left')), await txt('ac-left'));
  check('there is no camera row or speed button in the card (they live in the Animate window)', await q("!document.getElementById('ac-cam') && !document.getElementById('ac-rate') && !document.getElementById('ac-open')"));
  await click('ac-rew'); await sleep(300);
  check('rewind goes to the start', /^0:00\.00/.test(await txt('ac-elapsed')));
  await click('ac-end'); await sleep(300);
  check('skip goes to the end', /^0:05\.00/.test(await txt('ac-elapsed')), await txt('ac-elapsed'));
  await click('ac-rew'); await sleep(200);
  check('the loop button starts as Loop', await q("document.getElementById('ac-loop').dataset.mode") === 'loop');
  await click('ac-loop'); await sleep(200);
  check('then Ping-pong', await q("document.getElementById('ac-loop').dataset.mode") === 'pingpong');
  await click('ac-loop'); await sleep(200);
  check('then Once', await q("document.getElementById('ac-loop').dataset.mode") === 'once');
  await click('ac-loop'); await sleep(200);
  check('and round to Loop again', await q("document.getElementById('ac-loop').dataset.mode") === 'loop');
  // backwards: from the start, in Loop, the time goes to the end side
  await click('ac-back'); await sleep(200);
  check('reverse is on', await q("document.getElementById('ac-back').getAttribute('aria-pressed')") === 'true');
  await click('ac-play'); await sleep(900);
  const back = await txt('ac-elapsed');
  check('played backwards from the start it comes round to the end of the timeline', /^0:0[34]\./.test(back), back);
  await click('ac-play'); await click('ac-back');
  await call('animate_parts', { action: 'clear' }); await sleep(500);
  check('the miniature shows no clips once the part is no longer animated', await q("document.querySelectorAll('#ac-tl-bars .ac-clip').length === 0 && document.getElementById('anim-card').hidden"));

} catch (e) { fail++; console.log('HARNESS ERROR:', e.message); }
console.log(`
${pass} passed, ${fail} failed`);
console.log('page exceptions:', errors.length); errors.slice(0, 12).forEach(e => console.log('  ' + e));
console.log('console errors:', consoleErr.length); consoleErr.slice(0, 12).forEach(e => console.log('  ' + e));
try { ws && ws.close(); } catch (_) {}
chrome.kill();
process.exit(fail ? 1 : 0);
