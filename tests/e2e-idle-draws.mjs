// node tests/e2e-idle-draws.mjs [model]
//
// An app that is left alone draws nothing: no viewport frame, no canvas in a sidebar or window, no animation-frame loop, no
// running CSS animation, no style or layout work. The app is opened empty, then with the Gearbox assembly, with a part selected,
// with every sidebar section open, and with each window and popup open in turn; in each state it is left alone for a few seconds
// and everything that still ran is counted (WebGL draw calls per canvas, 2D canvas calls, animation-frame callbacks and timers by
// source, running animations, Chrome's own style-recalc and layout counts). WebGPU frames count with the draw calls: a canvas taking a
// new texture, and queue submits. Needs the app served on APP_PORT (default 4242),
// Chrome and Node 22+.
import { spawn } from 'child_process';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9361, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-idledraws-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const GFX = process.env.GPU ? ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const IDLE_MS = +(process.env.IDLE_MS || 3000);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, ...GFX, '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra, null, 1)); } };
const until = async (expr, tries = 40, ms = 250) => { for (let i = 0; i < tries; i++) { if (await evalJS(expr).catch(() => false)) return true; await sleep(ms); } return false; };
const attach = async () => {
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
  await send('Page.enable'); await send('Runtime.enable'); await send('Performance.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
};

// Counters put in before the app's own scripts run.
const HOOK = `(() => {
  const P = window.__probe = { gl: new Map(), c2d: new Map(), raf: new Map(), timers: new Map() };
  const canvasName = (c) => c.id ? '#' + c.id : (c.isConnected ? 'canvas.' + (c.className || '') + ' in ' + (c.parentElement?.id || c.parentElement?.className || '?') : 'offscreen canvas');
  const bump = (m, k, n = 1) => m.set(k, (m.get(k) || 0) + n);
  const src = (f) => (f && (f.name || String(f).replace(/\\s+/g, ' ').slice(0, 110))) || '?';
  const gc = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...a) {
    const ctx = gc.call(this, type, ...a);
    if (!ctx || ctx.__probed) return ctx;
    ctx.__probed = true; const cv = this;
    if (/webgl/.test(type)) for (const fn of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements', 'clear']) {
      const o = ctx[fn]; if (typeof o !== 'function') continue;
      ctx[fn] = function (...x) { bump(P.gl, canvasName(cv) + (fn === 'clear' ? ' (clear)' : '')); return o.apply(this, x); };
    }
    if (type === '2d') for (const fn of ['drawImage', 'fillRect', 'clearRect', 'fill', 'stroke', 'fillText', 'putImageData']) {
      const o = ctx[fn]; ctx[fn] = function (...x) { bump(P.c2d, canvasName(cv)); return o.apply(this, x); };
    }
    return ctx;
  };
  // WebGPU: a frame on a canvas takes a new texture from its context; anything else drawn (a render target) is a queue submit
  if (window.GPUCanvasContext) {
    const gct = GPUCanvasContext.prototype.getCurrentTexture;
    GPUCanvasContext.prototype.getCurrentTexture = function (...x) { bump(P.gl, canvasName(this.canvas) + ' (webgpu frame)'); return gct.apply(this, x); };
  }
  if (window.GPUQueue) {
    const sub = GPUQueue.prototype.submit;
    GPUQueue.prototype.submit = function (...x) { bump(P.gl, 'webgpu queue submit'); return sub.apply(this, x); };
  }
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((t) => { bump(P.raf, src(cb)); return cb(t); });
  const st = window.setTimeout.bind(window), si = window.setInterval.bind(window);
  window.setTimeout = (cb, ms, ...a) => st(typeof cb === 'function' ? (...x) => { bump(P.timers, 'timeout ' + (ms | 0) + 'ms: ' + src(cb)); return cb(...x); } : cb, ms, ...a);
  window.setInterval = (cb, ms, ...a) => si(typeof cb === 'function' ? (...x) => { bump(P.timers, 'interval ' + (ms | 0) + 'ms: ' + src(cb)); return cb(...x); } : cb, ms, ...a);
})()`;

const metrics = async () => Object.fromEntries((await send('Performance.getMetrics')).metrics.filter(m => /^(RecalcStyleCount|LayoutCount|ScriptDuration|TaskDuration)$/.test(m.name)).map(m => [m.name, m.value]));
// Leave the app alone for IDLE_MS and report what still ran.
async function idle(label) {
  await sleep(1500);                                                   // (what a click set going may finish: transitions, a last frame)
  await evalJS('(() => { const P = window.__probe; for (const k of ["gl", "c2d", "raf", "timers"]) P[k].clear(); })()');
  const m0 = await metrics();
  await sleep(IDLE_MS);
  const m1 = await metrics();
  const r = await evalJS(`(() => {
    const P = window.__probe, top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, n]) => n + 'x ' + k);
    const anims = document.getAnimations().filter(a => a.playState === 'running').map(a => { const t = a.effect?.target; const n = t ? (t.id ? '#' + t.id : t.tagName + '.' + String(t.className?.baseVal ?? t.className).split(' ').slice(0, 2).join('.')) : '?'; return (a.animationName || a.transitionProperty || a.constructor.name) + ' on ' + n + (a.effect?.getTiming?.().iterations === Infinity ? ' (forever)' : '') + (t && t.offsetParent === null && getComputedStyle(t).position !== 'fixed' ? ' [not shown]' : ''); });
    return { gl: top(P.gl), c2d: top(P.c2d), raf: top(P.raf), timers: top(P.timers), anims, glTotal: [...P.gl.values()].reduce((s, n) => s + n, 0), c2dTotal: [...P.c2d.values()].reduce((s, n) => s + n, 0) };
  })()`);
  const sec = IDLE_MS / 1000;
  r.styleRecalcs = Math.round(m1.RecalcStyleCount - m0.RecalcStyleCount);
  r.layouts = Math.round(m1.LayoutCount - m0.LayoutCount);
  r.scriptMsPerSec = +(((m1.ScriptDuration - m0.ScriptDuration) * 1000) / sec).toFixed(1);
  // (tick is the app's own loop: it checks for work each frame and draws only when asked; update is three's WebGPURenderer loop, which advances its node frame)
  const rafOther = r.raf.filter(s => !/x (tick|update)$/.test(s));
  const tickN = +(r.raf.find(s => /x tick$/.test(s)) || '0x').split('x')[0];
  // Quiet = nothing that goes on by itself: no draw, no endless animation, no animation-frame loop, no style work every frame.
  // (A one-off after the last click, such as a fading toast or a status bar settling once, is listed but allowed.)
  const rafLoops = rafOther.filter(x => +x.split('x')[0] > 5);
  const quiet = r.glTotal === 0 && r.c2dTotal === 0 && rafLoops.length === 0 && !r.anims.some(x => / (forever)/.test(x)) && r.styleRecalcs <= 20 && r.layouts <= 5;
  console.log(`\n== ${label}: ${quiet ? 'quiet' : 'BUSY'}  (tick ${Math.round(tickN / sec)}/s, script ${r.scriptMsPerSec} ms/s, style ${r.styleRecalcs}, layout ${r.layouts})`);
  for (const k of ['gl', 'c2d', 'raf', 'timers', 'anims']) if (r[k].length) console.log('  ' + k + ':\n    ' + r[k].join('\n    '));
  results.push({ label, quiet, r });
  return r;
}
const results = [];
const click = (sel) => evalJS(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`);
const key = async (k, mods = 0, code) => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: k, code: code || ('Key' + k.toUpperCase()), modifiers: mods, windowsVirtualKeyCode: k.length === 1 ? k.toUpperCase().charCodeAt(0) : (k === 'Escape' ? 27 : 0) }); };
const closeAll = async () => { await key('Escape', 0, 'Escape'); await evalJS("document.querySelectorAll('.modal-bg.show').forEach(m => m.classList.remove('show'))"); };

try {
  await attach();
  await send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(2000);
  await idle('start screen (welcome window)');
  await evalJS("document.getElementById('welcome-close')?.click()");
  await idle('empty scene');

  await evalJS(`(async () => { const r = await fetch(${JSON.stringify(encodeURI(MODEL))}); const b = await r.blob(); const f = new File([b], ${JSON.stringify(path.basename(MODEL))}); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  if (await until("document.getElementById('import-modal').classList.contains('show')", 20)) await evalJS("document.querySelector('#import-modal-confirm')?.click()");
  check('the model opened', await until("window.state && window.state.parts.filter(p => !p.deleted).length > 0", 120, 500));
  await sleep(6000);                                                   // (the warm-up after a load settles)
  await idle('model open');
  await evalJS("window.__moBridgeTools.select_parts({ ids: [window.state.parts.find(p => !p.deleted).partId] })");
  await idle('one part selected');

  // every section of the right sidebar open
  await evalJS("document.querySelectorAll('#sidebar-right .section-h.collapsed').forEach(h => h.click())");
  await idle('every sidebar section open');
  await evalJS("document.getElementById('sidebar-right').scrollTo(0, 1e6)");
  await idle('sidebar scrolled to the bottom');
  await evalJS("document.getElementById('sidebar-right').scrollTo(0, 0)");

  // windows
  await evalJS('window.__openSettings()'); await sleep(300);
  const panes = await evalJS("[...document.querySelectorAll('#set-main .set-pane')].map(b => b.dataset.pane).filter((v, i, a) => a.indexOf(v) === i)");
  for (const p of (panes.length ? panes : [undefined])) { await evalJS(`window.__openSettings(${JSON.stringify(p)})`); await idle('Settings › ' + (p || 'first pane')); }
  await closeAll();
  await key('k', 2); await idle('command search (Ctrl+K)'); await closeAll();
  for (const [name, sel] of [['shortcuts window', '#shortcuts-modal'], ['help window', '#help-modal'], ['export window', '#export-modal'], ['save window', '#save-scene-modal']]) {
    await evalJS(`document.querySelector(${JSON.stringify(sel)})?.classList.add('show')`); await idle(name); await closeAll();
  }
  // popups and panels opened by commands, by the command search's own list
  for (const [name, k, mods] of [['Quick wand (W held is a tap: left open)', 'w', 0], ['Quick colour wheel', 'c', 0]]) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 750, y: 450 });
    await key(k, mods); await idle(name); await key('Escape', 0, 'Escape'); await sleep(300);
  }
  await click('#tg-transform'); await idle('Transform panel'); await click('#tg-transform');
  await click('#sb-console-btn'); await idle('console'); await click('#sb-console-btn');
  await evalJS("(() => { const b = document.querySelector('[data-act=\"inspectModel\"]'); if (b) b.click(); })()");

  // the viewport after an orbit: frames stop once the camera stops (and the counters do see the viewport draw while it moves)
  await evalJS('window.__probe.gl.clear()');
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 750, y: 450, button: 'left', clickCount: 1 });
  for (let i = 0; i < 10; i++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 750 + i * 8, y: 450, button: 'left', buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 830, y: 450, button: 'left', clickCount: 1 });
  check('the viewport draws while the camera moves (the counters see it)', await evalJS('[...window.__probe.gl.values()].reduce((s, n) => s + n, 0)') > 0);
  await idle('after an orbit');
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 760, y: 470 });
  await idle('pointer resting over the model');

  const busy = results.filter(x => !x.quiet).map(x => x.label);
  check('every state is quiet when left alone', busy.length === 0, busy);
  check('no page errors', errors.length === 0, errors.slice(0, 5));
} catch (e) {
  fail++; console.log('FAIL', e.message || e);
} finally {
  try { ws?.close(); } catch (_) {}
  chrome.kill();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
