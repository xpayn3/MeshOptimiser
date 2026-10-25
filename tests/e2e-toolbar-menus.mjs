// node tests/e2e-history-card.mjs [model, default inbox/GearboxAssy.glb]
//
// The right-click menus of the Animate, Library, Materials and "…" buttons of the viewport toolbar, in the real app in headless Chrome:
//   each opens its own short list (not the list of every command), with the rows that make sense there; a row that needs a selection is dimmed
//   until something is picked; a row runs its command; the menu closes.
// Needs the app served on APP_PORT (default 4242; use 4343 with its own server: python app/serve.py --no-browser --port 4343),
// Chrome installed and Node 22+.
import { spawn } from 'child_process';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9340, PROFILE = process.env.TEMP + '/cdp-profile-' + Date.now();
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

  const menuOf = async (id) => {
    await evalJS(`document.getElementById('ctx-menu') && (document.getElementById('ctx-menu').style.display = 'none'); document.getElementById(${JSON.stringify(id)}).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 500, clientY: 900, button: 2 }))`);
    await sleep(250);
    return evalJS("(() => { const m = document.getElementById('ctx-menu'); if (!m || m.style.display !== 'block') return null; return { commands: m.classList.contains('is-commands'), rows: [...m.querySelectorAll('.ctx-menu-row')].map(r => ({ t: r.querySelector('.ctx-menu-label').textContent, off: r.classList.contains('is-off'), sub: r.classList.contains('has-sub') })) }; })()");
  };
  const has = (m, t) => !!m && m.rows.some(r => r.t === t);
  const off = (m, t) => !!m && m.rows.some(r => r.t === t && r.off);
  const close = () => evalJS("document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))");

  let m = await menuOf('tg-animate');
  ok(m && !m.commands && has(m, 'Open the timeline') && has(m, 'Add to the selection') && has(m, 'Turntable video…'), 'Animate has its own menu', JSON.stringify(m && m.rows.map(r => r.t)));
  ok(off(m, 'Play') && off(m, 'Remove every animation'), 'with nothing animated, Play and Remove every animation are dimmed');
  ok(off(m, 'Add to the selection') && off(m, 'Animate the selection…'), 'and with nothing picked, adding is dimmed');
  await evalJS(`(() => { const ps = state.parts.filter(p => !p.deleted && p.mesh); state.selectedGroupIds = new Set(); state.selected = new Set([ps[0].partId]); })()`);
  m = await menuOf('tg-animate');
  ok(!off(m, 'Add to the selection'), 'with a part picked, adding is on');
  // add a spin through the submenu's own function
  await evalJS("(() => { const m = document.getElementById('ctx-menu'); const r = [...m.querySelectorAll('.ctx-menu-row')].find(x => x.querySelector('.ctx-menu-label').textContent === 'Add to the selection'); r.dispatchEvent(new MouseEvent('mouseenter')); })()");
  await sleep(250);
  await evalJS("[...document.querySelectorAll('#ctx-menu .ctx-sub .ctx-menu-row')].find(x => x.textContent.trim() === 'Spin').click()");
  await sleep(500);
  ok((await evalJS('window.__moAnimStats().animated')) === 1, 'Add to the selection › Spin animates the picked part');
  m = await menuOf('tg-animate');
  ok(!off(m, 'Play') && !off(m, 'Remove every animation'), 'now Play and Remove every animation are on');
  await evalJS("[...document.querySelectorAll('#ctx-menu .ctx-menu-row')].find(x => x.querySelector('.ctx-menu-label').textContent === 'Remove every animation').click()");
  await sleep(400);
  ok((await evalJS('window.__moAnimStats().animated')) === 0, 'Remove every animation takes it away');

  m = await menuOf('tg-library');
  ok(m && !m.commands && has(m, 'Open the library') && has(m, 'Recently used') && has(m, 'Add: Shapes') && has(m, 'Small tiles'), 'Library has its own menu', JSON.stringify(m && m.rows.map(r => r.t)));
  await evalJS("(() => { const m = document.getElementById('ctx-menu'); const r = [...m.querySelectorAll('.ctx-menu-row')].find(x => x.querySelector('.ctx-menu-label').textContent === 'Add: Shapes'); r.dispatchEvent(new MouseEvent('mouseenter')); })()");
  await sleep(250);
  const n0 = await evalJS('state.parts.filter(p => !p.deleted).length');
  await evalJS("[...document.querySelectorAll('#ctx-menu .ctx-sub .ctx-menu-row')][0].click()");
  await sleep(600);
  ok((await evalJS('state.parts.filter(p => !p.deleted).length')) === n0 + 1, 'Add: Shapes › the first shape adds a part');
  m = await menuOf('tg-library');
  ok(!off(m, 'Recently used'), 'and it is under Recently used');

  m = await menuOf('tg-materials');
  ok(m && !m.commands && has(m, 'Open materials') && has(m, 'New material') && has(m, 'Select by colour') && has(m, 'Merge parts of the same colour'), 'Materials has its own menu', JSON.stringify(m && m.rows.map(r => r.t)));
  m = await menuOf('vp-more');
  ok(m && !m.commands && has(m, 'Search commands…') && has(m, 'All commands') && has(m, 'Keyboard shortcuts') && has(m, 'Settings'), '"…" has its own short menu', JSON.stringify(m && m.rows.map(r => r.t)));
  await evalJS("[...document.querySelectorAll('#ctx-menu .ctx-menu-row')].find(x => x.querySelector('.ctx-menu-label').textContent === 'All commands').click()");
  await sleep(300);
  ok(await evalJS("document.getElementById('ctx-menu').classList.contains('is-commands')"), 'All commands opens the full list');
  m = await menuOf('vp-cmdk');
  ok(m && !m.commands && has(m, 'Open command search') && has(m, 'Recent commands') && has(m, 'Search options') && has(m, 'Keyboard shortcuts'), 'the search button has its own menu', JSON.stringify(m && m.rows.map(r => r.t)));
  await evalJS("[...document.querySelectorAll('#ctx-menu .ctx-menu-row')].find(x => x.querySelector('.ctx-menu-label').textContent === 'Open command search').click()");
  await sleep(500);
  ok(await evalJS("document.getElementById('vp-cmdk').classList.contains('active') && document.getElementById('cmdk-modal').classList.contains('show')"), 'Open command search opens it, and the button is lit');
  m = await menuOf('vp-cmdk');
  ok(has(m, 'Close command search'), 'and the menu then offers Close');
  await evalJS("document.getElementById('cmdk-modal').classList.remove('show'); document.getElementById('vp-cmdk').classList.remove('active')");
  m = await menuOf('tg-split');
  ok(m && m.commands, 'another toolbar button still gets the list of every command');
  ok(errors.length === 0, 'no JavaScript errors', errors.slice(0, 3).join(' | '));
} catch (e) { console.log('FAIL the run itself:', e.message); failed++; }
finally { if (errors.length) console.log('page errors:', errors.slice(0, 5)); try { ws && ws.close(); } catch (_) {} chrome.kill(); }
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks pass');
process.exit(failed ? 1 : 0);
