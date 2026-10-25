// node tests/e2e-claude-feed.mjs  (APP_PORT=4343): Claude mode, the feed of what Claude did, through the real MCP path
//
// Drives the Claude (MCP) tools of the real app in headless Chrome (software WebGL2): loads a model through the file input, then
// calls every tool of window.__moBridgeTools (the same functions serve.py hands Claude's calls to; the Allow / Don't allow prompt
// is the layer above them and is not part of this) and checks what each one did, including that the undo tool takes it back.
// Needs the app served on http://localhost:4242 (python app/serve.py --no-browser --port 4242), or another port in APP_PORT, Chrome installed and Node 22+.
// Prints PASS / FAIL per check and every JavaScript error the page threw. Exit code 1 when anything failed.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
// the second model, opened over the first; it has to be under app/ (the server shows nothing else). It was inbox/coral.glb, a customer's model
// that is not on this computer: the server answered 404 with its HTML page, and that page went into the loader ("Unexpected token '<'").
const SECOND = process.env.SECOND_MODEL || 'inbox/Drive_Unit_DU-240.glb';
const isSecond = (file) => String(file || '').toLowerCase().includes(path.basename(SECOND, path.extname(SECOND)).toLowerCase());
const PORT = 9347, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-feed-' + Date.now();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CH, ['--headless=new', '--mute-audio', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
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

  // — Claude mode through the real path: Claude's MCP call → serve.py → the page → the feed —
  const APP = process.env.APP_PORT || 4242;
  let rid = 0;
  const mcp = async (name, args = {}) => {
    const r = await fetch(`http://127.0.0.1:${APP}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method: 'tools/call', params: { name, arguments: args } }) });
    return (await r.json()).result;
  };
  await evalJS("window.__moBridge.setEnabled(true, true)"); await sleep(1500);
  await evalJS("window.__moClaudeMode('feed')"); await sleep(400);
  check('Claude mode: the feed is shown and the body says so', await evalJS("document.body.classList.contains('claude-mode') && getComputedStyle(document.getElementById('claude-feed')).display === 'flex'"));
  check('the session starts with the open model, so no waiting screen', await evalJS("!!document.querySelector('#claude-feed .cf-model') && document.querySelector('#claude-feed .cf-empty').hidden"));
  const say = await mcp('say', { text: 'Looking at the heaviest parts first.' });
  check('say is accepted over MCP', say && !say.isError, say);
  const sum = await mcp('scene_summary'); check('scene_summary over MCP', sum && !sum.isError, sum);
  const shot = await mcp('screenshot', { width: 640 }); check('screenshot over MCP returns a picture', shot && !shot.isError && shot.content.some(c => c.type === 'image'), shot && shot.content && shot.content.map(c => c.type));
  const bad = await mcp('select_parts', { mode: 'banana', ids: [1] }); check('a failing call is refused', bad && bad.isError, bad);
  await sleep(1500);
  const dump = await evalJS(`(() => ({ items: [...document.querySelectorAll('#claude-feed .cf-item')].map(e => e.textContent.slice(0, 110)), notes: document.querySelectorAll('#claude-feed .cf-note').length, imgs: document.querySelectorAll('#claude-feed .cf-img img').length, failed: document.querySelectorAll('#claude-feed .cf-call[data-status="failed"]').length, done: document.querySelectorAll('#claude-feed .cf-call[data-status="done"]').length, running: document.querySelectorAll('#claude-feed .cf-call[data-status="running"]').length }))()`);
  console.log('   feed:', JSON.stringify(dump));
  const mc = await evalJS("(() => { const m = document.querySelector('#claude-feed .cf-model'); return m ? { text: m.textContent, ready: !!m.querySelector('.cf-ready') } : null; })()");
  check('the open model starts the session: name, counts and Ready for Claude', mc && /GearboxAssy/.test(mc.text) && /95/.test(mc.text) && /646,064/.test(mc.text) && mc.ready, mc);
  check('the say message is a note in the feed', dump.notes === 1 && dump.items.some(t => /heaviest parts/.test(t)), dump);
  check('the calls are cards: 2 done, 1 failed, none left running', dump.done === 2 && dump.failed === 1 && dump.running === 0, dump);
  check('the screenshot is shown as a picture', dump.imgs === 1, dump);
  check('the order is the order of the calls', dump.items.length === 5 && /Model opened/.test(dump.items[0]) && /heaviest/.test(dump.items[1]) && /scene summary/i.test(dump.items[2]) && /screenshot/i.test(dump.items[3]), dump.items);
  check('the viewport canvas is still laid out under the feed (screenshots keep their size)', await evalJS("(() => { const r = document.getElementById('viewport').getBoundingClientRect(); return r.width > 400 && r.height > 300; })()"));
  await evalJS("document.getElementById('cf-view').click()");
  // (the feed narrows with a .55 s transition: at a fixed 300 ms it was still wider than 600 px when the machine was busy, so wait for it, up to 3 s)
  const splitOk = "document.body.classList.contains('claude-split') && document.getElementById('claude-feed').getBoundingClientRect().width < 600";
  for (let i = 0; i < 30 && !(await evalJS(splitOk)); i++) await sleep(100);
  check('Show viewport: split mode, the feed is a column', await evalJS(splitOk), await evalJS("[document.body.classList.contains('claude-split'), Math.round(document.getElementById('claude-feed').getBoundingClientRect().width)]"));
  await sleep(1800);
  check('split: the app chrome is gone (top bar, sidebars, status bar, viewport tools)', await evalJS("['tb','sidebar-left','sidebar-right','sb','vp-overlay'].every(i => getComputedStyle(document.getElementById(i)).display === 'none')"));
  check('split: the viewport card fills the rest of the window', await evalJS("(() => { const r = document.getElementById('viewport').getBoundingClientRect(), f = document.getElementById('claude-feed').getBoundingClientRect(); return r.left > f.right && r.left - f.right < 24 && innerWidth - r.right < 24 && r.top < 24 && innerHeight - r.bottom < 24; })()"));
  await sleep(700); check('split: the Properties card floats at the bottom right of the viewport', await evalJS("(() => { const c = document.getElementById('cf-props'), r = c.getBoundingClientRect(); return /Properties/.test(c.textContent) && /[0-9] parts/.test(c.textContent) && r.bottom > innerHeight - 40 && r.right > innerWidth - 40; })()"), await evalJS("(() => { const r = document.getElementById('cf-props').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom, innerWidth, innerHeight]; })()"));
  await evalJS("document.getElementById('cf-set').click()"); await sleep(600);
  check('Settings opens above the feed', await evalJS("(() => { const m = document.getElementById('settings-modal'); if (!m || !m.classList.contains('show')) return false; const r = m.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2).closest('#settings-modal') !== null; })()"));
  await evalJS("document.getElementById('settings-close')?.click()"); await sleep(400);
  check('footer controls: connect and ask switches mirror the bridge', await evalJS("document.getElementById('cf-conn').checked === true && typeof document.getElementById('cf-ask').checked === 'boolean'"));
  await evalJS("document.getElementById('cf-ask').click()"); await sleep(300);
  check('the Ask before edits switch changes the setting', await evalJS("localStorage.getItem('stepopt-claude-ask')") === '0');
  await evalJS("document.getElementById('cf-ask').click()"); await sleep(300);
  check('header icon buttons have names', await evalJS("['cf-view','cf-set','cf-clear','cf-exit','cf-undo','cf-redo','cf-copy'].every(i => document.getElementById(i).getAttribute('aria-label'))"));
  check('the viewport is a rounded card in split', await evalJS("parseFloat(getComputedStyle(document.getElementById('viewport')).borderTopLeftRadius) >= 8"));
  await evalJS("localStorage.setItem('stepopt-recent-test','1')");
  await evalJS("document.getElementById('cf-open').click()"); await sleep(300);
  check('the Open button lists Open file and the recent files', await evalJS("(() => { const p = document.getElementById('cf-pop'); return !p.hidden && !!p.querySelector('#cf-pick') && !!p.querySelector('.cf-rec-h'); })()"));
  await evalJS("document.getElementById('cf-open').click()"); await sleep(200);
  check('it closes again', await evalJS("document.getElementById('cf-pop').hidden"));
  check('the header names the open model', /GearboxAssy/.test(await evalJS("document.querySelector('#claude-feed .cf-state span').textContent")));
  check('Claude mode is marked Alpha in the feed', await evalJS("/alpha/i.test(document.querySelector('#claude-feed .cf-head .cf-alpha').textContent)"));
  check('job chips are there', await evalJS("document.querySelectorAll('.cf-chip').length === 3"));
  check('the welcome screen and the command palette lead here', await evalJS("!!document.getElementById('welcome-claude')"));
  // loading stats: a task in the tab list shows as a card with the step, the percent, the time and Cancel
  const listTop0 = await evalJS("(() => { const l = document.querySelector('#claude-feed .cf-list').getBoundingClientRect(); const e = document.querySelector('#claude-feed .cf-item'); return [Math.round(l.top), Math.round(l.height), e ? Math.round(e.getBoundingClientRect().top) : 0]; })()");
  await evalJS("window.__moTabs.tabs[0].tasks = [{ id: 'load', label: 'Opening Scania', detail: 'Parsing geometry', pct: 42, t0: Date.now() - 4000, cancel: true }]; window.__moClaudeFeed()"); await sleep(400);
  const ld = await evalJS("(() => { const l = document.querySelector('#claude-feed .cf-load'); return { shown: !l.hidden, text: l.textContent, bar: l.querySelector('.cf-ld-bar b').style.width, cancel: !!l.querySelector('.cf-ld-x') }; })()");
  check('loading card shows the file, the step, the percent, the time and Cancel', ld.shown && /Opening Scania/.test(ld.text) && /Parsing geometry/.test(ld.text) && /42%/.test(ld.text) && /\d s/.test(ld.text) && ld.bar === '42%' && ld.cancel, ld);
  const listTop1 = await evalJS("(() => { const l = document.querySelector('#claude-feed .cf-list').getBoundingClientRect(); const e = document.querySelector('#claude-feed .cf-item'); const c = document.querySelector('#claude-feed .cf-load').getBoundingClientRect(), f = document.querySelector('#claude-feed .cf-foot').getBoundingClientRect(); return [Math.round(l.top), Math.round(l.height), e ? Math.round(e.getBoundingClientRect().top) : 0, Math.round(c.bottom), Math.round(f.top)]; })()");
  check('the loading card floats at the bottom above the controls and moves nothing in the feed', listTop1[0] === listTop0[0] && listTop1[1] === listTop0[1] && listTop1[2] === listTop0[2] && listTop1[3] <= listTop1[4], { listTop0, listTop1 });
  const shotL = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync((process.env.SHOTS || '.') + '/claude-feed-loading.png', Buffer.from(shotL.data, 'base64'));
  await evalJS("window.__moTabs.tabs[0].tasks = []; window.__moClaudeFeed()"); await sleep(400);
  check('the loading card goes away when the task ends', await evalJS("document.querySelector('#claude-feed .cf-load').hidden"));
  // opening another model replaces the one in the viewport (no scene tab laid over it) and starts a new "Model opened" card
  const framesBefore = await evalJS("document.querySelectorAll('iframe.mo-tab-frame').length");
  const secondOk = await evalJS(`(async () => { const r = await fetch(${JSON.stringify(SECOND)}); if (!r.ok) return r.status; const b = await r.blob(); const f = new File([b], ${JSON.stringify(path.basename(SECOND))}); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  if (secondOk !== true) console.log('   the second model', SECOND, 'is not served (HTTP ' + secondOk + '): put one under app/ or set SECOND_MODEL');
  let swapped = null;
  for (let i = 0; i < 40; i++) { await sleep(500); swapped = await evalJS("(async () => { const j = JSON.parse((await window.__moBridgeTools.scene_summary())[0].text); return { file: j.file, parts: j.parts, tabs: window.__moTabs.tabs.filter(t => !t.closed).length, frames: document.querySelectorAll('iframe.mo-tab-frame').length, cards: document.querySelectorAll('#claude-feed .cf-model').length }; })()"); if (isSecond(swapped.file) && swapped.cards >= 2) break; }
  check('opening another model replaces it in place: same scene, no new tab, a second Model opened card', swapped && isSecond(swapped.file) && swapped.tabs === 1 && swapped.frames === framesBefore && swapped.cards >= 2, swapped);
  // a scene tab is the viewport card, not the whole app over the window
  await evalJS("window.__moBridgeTools.scene_tabs({ action: 'new' })"); await sleep(5000);
  const fr = await evalJS("(() => { const f = document.querySelector('iframe.mo-tab-frame:not([style*=\"display: none\"])') || document.querySelector('iframe.mo-tab-frame'); if (!f) return null; const r = f.getBoundingClientRect(), fe = document.getElementById('claude-feed').getBoundingClientRect(); let cls = false; try { cls = f.contentDocument.body.classList.contains('claude-mode'); } catch (_) {} return { z: getComputedStyle(f).zIndex, left: Math.round(r.left), feedRight: Math.round(fe.right), top: Math.round(r.top), cls, tb: (() => { try { return getComputedStyle(f.contentDocument.getElementById('tb')).display; } catch (_) { return 'x'; } })() }; })()");
  check('a new scene tab sits in the viewport card, below the feed, with the app chrome hidden', fr && Number(fr.z) < 499 && fr.left > fr.feedRight && fr.top > 0 && fr.cls && fr.tb === 'none', fr);
  await sleep(3000); const shotT = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync((process.env.SHOTS || '.') + '/claude-feed-tab.png', Buffer.from(shotT.data, 'base64'));
  const shot2 = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync((process.env.SHOTS || '.') + '/claude-feed-split.png', Buffer.from(shot2.data, 'base64'));
  await evalJS("document.getElementById('cf-view').click()"); await sleep(300);
  const shot1 = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync((process.env.SHOTS || '.') + '/claude-feed.png', Buffer.from(shot1.data, 'base64'));
  await evalJS("document.getElementById('cf-clear').click()"); await sleep(300);
  check('Clear empties the feed', await evalJS("document.querySelectorAll('#claude-feed .cf-item').length === 0"));
  check('the empty feed shows the recent list', await evalJS("!!document.querySelector('#claude-feed .cf-empty .cf-rec-list')"));
  await evalJS("document.getElementById('cf-open').click()"); await sleep(300);
  const shotR = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync((process.env.SHOTS || '.') + '/claude-feed-open.png', Buffer.from(shotR.data, 'base64'));
  await evalJS("document.getElementById('cf-open').click()");
  await evalJS("document.getElementById('cf-exit').click()"); await sleep(300);
  check('Exit asks first', await evalJS("!!document.querySelector('.cf-exit-ask') && /Exit Claude mode/.test(document.querySelector('.cf-exit-ask').textContent) && document.activeElement.classList.contains('cl-no')"));
  await evalJS("document.querySelector('.cf-exit-ask .cl-no').click()"); await sleep(300);
  check('Stay keeps Claude mode', await evalJS("!document.querySelector('.cf-exit-ask') && document.body.classList.contains('claude-mode')"));
  await evalJS("document.getElementById('cf-exit').click()"); await sleep(200);
  await evalJS("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))"); await sleep(200);
  check('Escape stays too', await evalJS("!document.querySelector('.cf-exit-ask') && document.body.classList.contains('claude-mode')"));
  await evalJS("document.getElementById('cf-exit').click()"); await sleep(200);
  await evalJS("document.querySelector('.cf-exit-ask .cl-yes').click()"); await sleep(300);
  check('Exit Claude mode brings the viewport back', await evalJS("!document.body.classList.contains('claude-mode') && getComputedStyle(document.getElementById('claude-feed')).display === 'none'"));
} catch (e) { fail++; console.log('HARNESS ERROR:', e.message); }
console.log(`\n${pass} passed, ${fail} failed`);
console.log('page exceptions:', errors.length); errors.slice(0, 12).forEach(e => console.log('  ' + e));
console.log('console errors:', consoleErr.length); consoleErr.slice(0, 12).forEach(e => console.log('  ' + e));
try { ws && ws.close(); } catch (_) {}
chrome.kill();
process.exit(fail ? 1 : 0);
