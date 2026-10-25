// node tests/e2e-history-card.mjs [model, default inbox/GearboxAssy.glb]
//
// Settings cards: a card of five or more plain switches is shown as tiles with a live summary, All on / None, and a line that reads what the
// tile under the pointer does; a card folds and opens again.
// Needs the app served on APP_PORT (default 4242; use 4343 with its own server: python app/serve.py --no-browser --port 4343),
// Chrome installed and Node 22+.
import { spawn } from 'child_process';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9347, PROFILE = process.env.TEMP + '/cdp-profile-' + Date.now();
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

  await evalJS(`_appFns._Actions.list.find(a => a.id === 'settings').run()`); await sleep(1500);
  await evalJS(`document.querySelector('.set-nav-item[data-pane="general"]').click()`); await sleep(800);
  const card = `[...document.querySelectorAll('#settings-modal .set-card')].find(c => c.querySelector('.set-card-t')?.textContent.trim() === 'Saved in a scene file')`;
  ok(await evalJS(`!!(${card})?.querySelector('.set-tiles')`), 'nine switches are shown as tiles');
  ok((await evalJS(`(${card}).querySelector('.set-card-n').textContent`)) === '8 of 9 on', 'the header says how many are on');
  await evalJS(`(${card}).querySelector('[data-set-all=off]').click()`); await sleep(500);
  ok((await evalJS(`(${card}).querySelector('.set-card-n').textContent`)) === '0 of 9 on' && (await evalJS(`[...(${card}).querySelectorAll('input[type=checkbox]')].every(x => !x.checked)`)), 'None switches them all off, and the summary follows');
  ok((await evalJS(`_appFns._Prefs.get('saveCamera')`)) === false, 'and each switch kept its setting');
  await evalJS(`(${card}).querySelector('[data-set-all=on]').click()`); await sleep(500);
  ok((await evalJS(`(${card}).querySelector('.set-card-n').textContent`)) === '9 of 9 on', 'All on switches them all on');
  await evalJS(`_appFns._Prefs.set('saveShadows', false); document.getElementById('set-sv-shadows').checked = false; (${card}).querySelector('.set-card-n').textContent = '8 of 9 on'`);
  await evalJS(`(() => { const t = (${card}).querySelector('#set-sv-camera').closest('.set-row'); t.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); })()`);
  ok((await evalJS(`(${card}).querySelector('.set-tile-desc').textContent`)).includes('looking from'), 'the line under the tiles reads what the tile does');
  await evalJS(`(${card}).querySelector('.set-card-h').click()`); await sleep(500);
  ok(await evalJS(`(${card}).classList.contains('is-fold') && (${card}).querySelector('.set-card-b').getBoundingClientRect().height < 2`), 'a click on the header folds the card');
  await evalJS(`(${card}).querySelector('.set-card-h').click()`); await sleep(500);
  ok(await evalJS(`!(${card}).classList.contains('is-fold') && (${card}).querySelector('.set-card-b').getBoundingClientRect().height > 100`), 'and opens it again');
  ok(errors.length === 0, 'no JavaScript errors', errors.slice(0, 3).join(' | '));
} catch (e) { console.log('FAIL the run itself:', e.message); failed++; }
finally { if (errors.length) console.log('page errors:', errors.slice(0, 5)); try { ws && ws.close(); } catch (_) {} chrome.kill(); }
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks pass');
process.exit(failed ? 1 : 0);
