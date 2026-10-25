// node tests/e2e-history-card.mjs [model, default inbox/GearboxAssy.glb]
//
// Shadows are off every time the app starts (even if they were left on and the page is reloaded), and stay as the user set them across Photo mode.
// Needs the app served on APP_PORT (default 4242; use 4343 with its own server: python app/serve.py --no-browser --port 4343),
// Chrome installed and Node 22+.
import { spawn } from 'child_process';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/GearboxAssy.glb';
const PORT = 9345, PROFILE = process.env.TEMP + '/cdp-profile-' + Date.now();
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
  const boot = async () => {
    await send('Page.navigate', { url: 'http://localhost:' + (process.env.APP_PORT || 4242) + '/index.html?t=' + Date.now() });
    for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
    await sleep(1500);
    await evalJS("document.getElementById('welcome-close')?.click()");
  };
  const st = () => evalJS(`({ box: document.getElementById('toggle-shadows').checked, state: state.shadowsEnabled })`);
  await boot();
  let s = await st();
  ok(s.box === false && s.state === false, 'shadows are off at start', JSON.stringify(s));
  await evalJS(`(() => { const c = document.getElementById('toggle-shadows'); c.click(); })()`); await sleep(500);
  s = await st();
  ok(s.box === true && s.state === true, 'and can be switched on', JSON.stringify(s));
  // Photo mode on and off: they stay as the user had them
  await evalJS(`document.getElementById('toggle-photo').click()`); await sleep(2500);
  s = await st();
  ok(s.state === true, 'in Photo mode they are on', JSON.stringify(s));
  await evalJS(`document.getElementById('toggle-photo').click()`); await sleep(2500);
  s = await st();
  ok(s.box === true && s.state === true, 'back out of Photo mode they are still on (the user had them on)', JSON.stringify(s));
  // a reload: off again
  await boot();
  s = await st();
  ok(s.box === false && s.state === false, 'after a reload they are off again', JSON.stringify(s));
  ok(await evalJS(`document.getElementById('toggle-shadows').autocomplete === 'off'`), 'and the switch is not given back by the browser');
  // what a scene file keeps: Settings › General › "Saved in a scene file"
  const coll = () => evalJS(`(() => { const s = window.__moAgent.sceneState.collect({}); return { cam: !!s.camera, view: !!s.view, ctl: Object.keys(s.controls || {}), expl: !!s.explode, anim: s.anim !== undefined }; })()`);
  const pref = (k, v) => evalJS(`_appFns._Prefs.set(${JSON.stringify(k)}, ${v})`);
  await evalJS(`document.getElementById('toggle-shadows').click()`); await sleep(400);
  let c = await coll();
  ok(c.cam && c.view && c.ctl.includes('light-sun') && c.ctl.includes('display-units') && !c.ctl.includes('toggle-shadows'), 'by default a file keeps the camera, display, lights and units, and not the shadows', JSON.stringify(c));
  await pref('saveShadows', true); c = await coll();
  ok(c.ctl.includes('toggle-shadows'), 'with the Shadows switch on it keeps them too', JSON.stringify(c.ctl));
  await pref('saveLights', false); await pref('saveCamera', false); await pref('saveDisplay', false); await pref('saveUnits', false); c = await coll();
  ok(!c.cam && !c.view && !c.ctl.includes('light-sun') && !c.ctl.includes('display-units'), 'each switch leaves its part out', JSON.stringify(c));
  const f = await evalJS(`(() => { const s = window.__moAgent.sceneState.collect({ full: true }); return { cam: !!s.camera, ctl: Object.keys(s.controls || {}) }; })()`);
  ok(f.cam && f.ctl.includes('light-sun') && f.ctl.includes('toggle-shadows') === true, 'a duplicate or a recovery copy keeps all of it', JSON.stringify(f));
  await evalJS(`_appFns._Actions.list.find(a => a.id === 'settings').run()`); await sleep(800);
  ok((await evalJS(`document.querySelectorAll('[id^="set-sv-"]').length`)) === 9, 'nine switches for it are in Settings › General');
  for (const k of ['saveShadows', 'saveLights', 'saveCamera', 'saveDisplay', 'saveUnits']) await pref(k, k === 'saveShadows' ? false : true);
  ok(errors.length === 0, 'no JavaScript errors', errors.slice(0, 3).join(' | '));
} catch (e) { console.log('FAIL the run itself:', e.message); failed++; }
finally { if (errors.length) console.log('page errors:', errors.slice(0, 5)); try { ws && ws.close(); } catch (_) {} chrome.kill(); }
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks pass');
process.exit(failed ? 1 : 0);
