// node tests/e2e-shade-scrub.mjs [model, default inbox/GearboxAssy.glb]
//
// The Shading angle in Properties is the fill-bar scrubber every value of the app has (the name above, a bar that fills and the
// number at its end), not a name and a box. Here: with nothing selected the row is greyed and shows a dash; a part selected shows its
// angle on a filled bar; a drag of the bar to 60 and letting go sets the part's angle and makes one undo step; a typed 45 is applied
// after a short pause; undo goes back to 60. Needs the app served on http://localhost:4242, Chrome and Node 22+.
import { spawn } from 'child_process';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9359, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-shadescrub-' + Date.now();
const URL = 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html';
const GFX = process.env.GPU ? ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, ...GFX, '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
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

const ROW = `(() => { const h = document.getElementById('prop-shade'); if (!h) return null; const r = h.querySelector('.scrub-range');
  return { off: h.classList.contains('is-off'), bar: h.querySelector('.scrub')?.classList.contains('scrub-bar') && r?.classList.contains('range-bar'), oldBox: !!h.querySelector('.size-field'),
    label: h.querySelector('.scrub-label')?.textContent, value: h.querySelector('.scrub-value')?.textContent, unit: h.querySelector('.scrub-unit')?.textContent, range: r?.value }; })()`;
const key = async (k, code, vk, mod = 0) => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, modifiers: mod, key: k, code, windowsVirtualKeyCode: vk, ...(type === 'keyDown' && k.length === 1 ? { text: k } : {}) }); };
const undos = () => evalJS("(window.state?.history || []).filter(o => o && o.type === 'shading').length");

try {
  await attach();
  await send('Page.navigate', { url: URL + '?t=' + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await evalJS("document.getElementById('welcome-close')?.click()");
  await evalJS(`(async () => { const r = await fetch(${JSON.stringify(MODEL)}); const b = await r.blob(); const f = new File([b], ${JSON.stringify(path.basename(MODEL))}); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  for (let i = 0; i < 160; i++) { const n = await evalJS("document.querySelectorAll('#tree .tree-node[data-part-id]').length"); if (n > 5) break; await sleep(500); }
  await sleep(3000);

  const none = await evalJS(ROW);
  check('nothing selected: the row is the fill-bar scrubber, greyed, with a dash', none && none.bar && none.off && !none.oldBox && none.label === 'Shading angle' && none.value === '—', none);

  const pid = await evalJS("(() => { const r = document.querySelector('#tree .tree-node[data-part-id]'); r.dispatchEvent(new MouseEvent('click', { bubbles: true })); return +r.dataset.partId; })()");
  await sleep(600);
  const on = await evalJS(ROW);
  check('a part selected: its angle on a filled bar, in degrees', on && on.bar && !on.off && on.value === '30' && on.unit === '°' && on.range === '30', on);

  const u0 = await undos();
  await evalJS("(() => { const r = document.querySelector('#prop-shade .scrub-range'); r.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); r.value = '60'; r.dispatchEvent(new Event('input', { bubbles: true })); window.dispatchEvent(new PointerEvent('pointerup')); r.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");
  await until(`window.state.parts.find(q => q.partId === ${pid}).shadeAngle === 60 && document.querySelector('#prop-shade .scrub-value')?.textContent === '60'`, 60);      // (the first apply loads the shading code)
  const a60 = await evalJS(`window.state.parts.find(q => q.partId === ${pid}).shadeAngle`), u1 = await undos();
  check('a drag to 60 and letting go: the part is shaded at 60, one undo step', a60 === 60 && u1 === u0 + 1, { a60, u0, u1 });
  const r60 = await evalJS(ROW); check('the row shows 60', r60.value === '60', r60);

  await evalJS("document.querySelector('#prop-shade .scrub-value').click(); true");
  await sleep(200);
  await evalJS("(() => { const i = document.querySelector('#prop-shade .scrub-input'); i.value = '45'; return true; })()");
  await key('Enter', 'Enter', 13);
  await until(`window.state.parts.find(q => q.partId === ${pid}).shadeAngle === 45`, 40);
  const a45 = await evalJS(`window.state.parts.find(q => q.partId === ${pid}).shadeAngle`), u2 = await undos();
  check('a typed 45 is applied after a short pause, one more undo step', a45 === 45 && u2 === u1 + 1, { a45, u2 });

  await evalJS("document.activeElement?.blur(); document.getElementById('viewport')?.focus?.(); true");
  await key('z', 'KeyZ', 90, 2);
  await sleep(1200);
  const back = await evalJS(`window.state.parts.find(q => q.partId === ${pid}).shadeAngle`);
  check('undo goes back to 60, and the row follows', back === 60 && (await evalJS(ROW)).value === '60', { back, row: await evalJS(ROW) });
  check('no page errors', errors.length === 0, errors);
} catch (e) {
  fail++; console.log('FAIL', e.message || e);
} finally {
  try { ws?.close(); } catch (_) {}
  chrome.kill();
  console.log(`
${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
