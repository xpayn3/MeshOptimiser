// node tests/e2e-seg-thumb.mjs
//
// The highlight of the two-button view toggles (Library: large / small tiles, Materials: grid / list) stretches as it slides. Its two
// edges move on their own clocks, so on the way across the pill grows wider than a button, lands a hair narrower (the spring of the
// trailing edge) and settles at exactly one button, under the active one. Here: in the library head, a click on Small tiles and then
// on Large tiles is sampled every frame; the pill must stretch past 40 px, squeeze under 28 px, and end at 28 px over the active
// button, both ways; opening the panel does not play the slide. The same goes for every .cmd-seg (Notes' All / Open / Done, the
// Align and Place cards...) and the edit bar's vertical pill, where a click marks the way (data-seg-dir) for the leading edge: a
// three-option .cmd-seg is clicked forward two steps and back one, and a move made by code after the mark has gone still slides
// cleanly (never narrower than a third of a cell). Needs the app served on http://localhost:4242, Chrome and Node 22+.
import { spawn } from 'child_process';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9357, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-segthumb-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const GFX = process.env.GPU ? ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--mute-audio', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, ...GFX, '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, ...extra });
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
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
};


// the pill's left edge and width (relative to the toggle) after clicking button `n` (1 or 2): the pill's transitions are paused and
// stepped through 10 ms at a time, so the samples do not depend on how often headless Chrome draws a frame
const SAMPLE = (n, ms) => `(() => {
  const tg = document.querySelector('#vp-library-pop .lib-view-toggle'), out = [];
  const read = () => { const s = getComputedStyle(tg, '::before'), W = tg.clientWidth; const l = parseFloat(s.left), r = parseFloat(s.right); return { l, w: W - l - r }; };
  tg.children[${n} - 1].click();
  getComputedStyle(tg, '::before').left;
  const anims = document.getAnimations().filter(a => a.effect && a.effect.target === tg && a.effect.pseudoElement === '::before');
  anims.forEach(a => a.pause());
  for (let t = 0; t <= ${ms}; t += 10) { anims.forEach(a => { a.currentTime = Math.min(t, a.effect.getComputedTiming().endTime); }); out.push(read()); }
  anims.forEach(a => a.finish());
  return { out, n: anims.length, btn: tg.children[${n} - 1].offsetLeft, end: read() };
})()`;

// the same, for any element's ::before, along x (left / right) or y (top / bottom); `act` is the code that moves it
const SAMPLE_EL = (sel, act, axis, ms) => `(() => {
  const tg = document.querySelector('${sel}'), out = [], [a, b] = '${axis}' === 'y' ? ['top', 'bottom'] : ['left', 'right'];
  const size = () => '${axis}' === 'y' ? tg.clientHeight : tg.clientWidth;
  const read = () => { const s = getComputedStyle(tg, '::before'); const l = parseFloat(s[a]), r = parseFloat(s[b]); return { l, w: size() - l - r }; };
  ${act};
  getComputedStyle(tg, '::before')[a];
  const anims = document.getAnimations().filter(x => x.effect && x.effect.target === tg && x.effect.pseudoElement === '::before' && x.transitionProperty !== 'opacity');
  anims.forEach(x => x.pause());
  for (let t = 0; t <= ${ms}; t += 10) { anims.forEach(x => { x.currentTime = Math.min(t, x.effect.getComputedTiming().endTime); }); out.push(read()); }
  anims.forEach(x => x.finish());
  return { out, n: anims.length, end: read(), dir: tg.dataset.segDir || null };
})()`;
const shape = (r) => { const ws = r.out.map(s => s.w), maxW = Math.max(...ws), iMax = ws.indexOf(maxW); return { maxW, minAfter: Math.min(...ws.slice(iMax)), minW: Math.min(...ws), end: r.end }; };

try {
  await attach();
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await evalJS("document.getElementById('welcome-close')?.click()");
  await sleep(800);
  await evalJS("window._appFns._Actions.list.find(a => a.id === 'library')?.run(); true").catch(() => {});
  check('the library opens', await until("document.getElementById('vp-library-pop')?.classList.contains('show')", 12));
  await sleep(300);
  // put it on Large tiles without sampling, so both runs start from the left
  await evalJS("document.querySelector('#vp-library-pop .lib-view-toggle').children[0].click(); true");
  await sleep(800);

  for (const [n, way] of [[2, 'right'], [1, 'left']]) {
    const { out, n: count, btn, end: last } = await evalJS(SAMPLE(n, 600));
    check(`to the ${way}: both edges move (two transitions)`, count === 2, count);
    const ws = out.map(s => s.w), maxW = Math.max(...ws);
    const iMax = ws.indexOf(maxW), minAfter = Math.min(...ws.slice(iMax));
    check(`to the ${way}: the pill stretches across the gap`, maxW > 40, { maxW });
    check(`to the ${way}: it lands a hair narrower, then settles`, minAfter < 27.5 && minAfter > 22, { minAfter });
    check(`to the ${way}: it ends one button wide under the active button`, Math.abs(last.w - 28) < 0.01 && Math.abs(last.l - btn) < 0.01, { last, btn });
  }

  // opening the panel again does not slide or stretch the pill
  await evalJS("window._appFns._Actions.list.find(a => a.id === 'library')?.run(); true").catch(() => {});
  await sleep(500);
  await evalJS("window._appFns._Actions.list.find(a => a.id === 'library')?.run(); true").catch(() => {});
  const still = await evalJS(`new Promise(res => { const tg = document.querySelector('#vp-library-pop .lib-view-toggle'), ws = []; let k = 0;
    const tick = () => { const s = getComputedStyle(tg, '::before'); ws.push(tg.clientWidth - parseFloat(s.left) - parseFloat(s.right)); if (++k < 20) requestAnimationFrame(tick); else res(ws); }; requestAnimationFrame(tick); })`);
  check('opening the panel does not play the slide', still.every(w => Math.abs(w - 28) < 0.01), still);
  // a three-option .cmd-seg (the one the Notes card's All / Open / Done is), 180 px wide: cells of 58 px
  await evalJS(`(() => { const seg = document.createElement('div'); seg.className = 'cmd-seg'; seg.id = 't-seg'; seg.style.cssText = 'position:fixed;left:40px;top:40px;width:180px;z-index:99999;--seg-pad:3px';
    for (const l of ['All', 'Open', 'Done']) { const b = document.createElement('button'); b.type = 'button'; b.textContent = l; b.addEventListener('click', () => { for (const x of seg.children) x.classList.toggle('active', x === b); }); seg.append(b); }
    seg.children[0].classList.add('active'); document.body.append(seg); return true; })()`);
  await sleep(400);
  const cell = (180 - 6) / 3;
  const f2 = await evalJS(SAMPLE_EL('#t-seg', "tg.children[2].click()", 'x', 700)), F2 = shape(f2);
  check('.cmd-seg forward: the click marks the way', f2.dir === 'fwd', f2.dir);
  check('.cmd-seg forward: it stretches across, squeezes a little, ends one cell under Done', f2.n === 2 && F2.maxW > cell * 2 && F2.minAfter < cell - 0.5 && F2.minAfter > cell * 0.8 && Math.abs(F2.end.w - cell) < 0.1 && Math.abs(F2.end.l - (3 + 2 * cell)) < 0.1, F2);
  const b1 = await evalJS(SAMPLE_EL('#t-seg', "tg.children[1].click()", 'x', 700)), B1 = shape(b1);
  check('.cmd-seg back: the click marks the way', b1.dir === 'back', b1.dir);
  check('.cmd-seg back: it stretches across, squeezes a little, ends one cell under Open', b1.n === 2 && B1.maxW > cell * 1.4 && B1.minAfter < cell - 0.3 && Math.abs(B1.end.w - cell) < 0.1 && Math.abs(B1.end.l - (3 + cell)) < 0.1, B1);
  await sleep(900);
  const c0 = await evalJS(SAMPLE_EL('#t-seg', "for (const x of tg.children) x.classList.toggle('active', x === tg.children[0])", 'x', 700)), C0 = shape(c0);
  check('.cmd-seg moved by code: the mark is gone and it slides without folding up', c0.dir === null && C0.minW > cell / 3 && Math.abs(C0.end.l - 3) < 0.01, { dir: c0.dir, ...C0 });
  await evalJS("document.getElementById('t-seg').remove(); true");

  // the edit bar's vertical pill (pivot orientation: World / Local / Normal)
  await evalJS("(() => { const b = document.getElementById('el-bar'); b.hidden = false; b.style.display = 'flex'; return true; })()");
  await sleep(300);
  const tops = await evalJS("[...document.getElementById('el-space').children].map(b => b.offsetTop)");
  const v = await evalJS(SAMPLE_EL('#el-space', "tg.children[2].click()", 'y', 700)), V = shape(v);
  check('edit bar, down: it stretches and ends under the third button', v.dir === 'fwd' && V.maxW > 50 && Math.abs(V.end.w - 30) < 0.01 && Math.abs(V.end.l - tops[2]) < 0.01, { dir: v.dir, ...V });
  const v1 = await evalJS(SAMPLE_EL('#el-space', "tg.children[1].click()", 'y', 700));
  check('edit bar, up: it ends exactly under the middle button (it used to stop 2 px short)', v1.dir === 'back' && Math.abs(v1.end.w - 30) < 0.01 && Math.abs(v1.end.l - tops[1]) < 0.01, { dir: v1.dir, end: v1.end, tops });
  await evalJS("document.querySelector('#el-space').children[0].click(); true");
  await sleep(800);
  check('no page errors', errors.length === 0, errors);
} catch (e) {
  fail++; console.log('FAIL', e.message || e);
} finally {
  try { ws?.close(); } catch (_) {}
  chrome.kill();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
