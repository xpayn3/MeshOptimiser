// node tools/capture-claude-jobs.mjs <folder> [model, default inbox/GearboxAssy.glb]
//
// Two pictures for the website's page about Claude, as 2400 x 1350 PNG: a job in progress (the badge's dropdown with its progress bar and the
// Stop button, while batch_optimise works through a folder) and the before and after picture compare_images makes after optimise_to_target
// has taken the model to the web limits. Both come from the real app in headless Chrome, on a server of its own (port 4343). The website turns
// them into WebP (Images/apps/meshoptimiser-claude-job.webp and -compare.webp). Also prints what optimise_to_target answered, for the page's numbers.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = process.argv[2]; if (!OUT) { console.log('usage: node tools/capture-claude-jobs.mjs <folder> [model]'); process.exit(2); }
const MODEL = process.argv[3] || 'inbox/GearboxAssy.glb';
const APP = 4343, DBG = 9378, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-jobs-' + Date.now();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
const srv = spawn('python', ['serve.py', '--no-browser', '--port', String(APP)], { cwd: path.resolve('.'), stdio: 'ignore' });
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${DBG}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1920,1080', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0, rpcId = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, 'base64')); console.log('wrote', name); };
const rpc = async (method, params) => {
  const r = await fetch(`http://127.0.0.1:${APP}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) });
  const t = await r.text(); return JSON.parse(t.startsWith('event') ? t.split('\n').find(l => l.startsWith('data:')).slice(5) : t);
};
const tool = async (name, args = {}) => { const r = await rpc('tools/call', { name, arguments: args }); const res = r.result || {}; const txt = (res.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n'); let j = null; try { j = JSON.parse(txt.split('\n').pop()); } catch (_) {} return { txt, j, err: !!res.isError }; };
const calm = () => evalJS("document.querySelectorAll('.toast, #toast-host > *, .toasts > *').forEach(e => e.remove()); true");
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${APP}/index.html`)).ok) break; } catch (_) {} await sleep(250); }
  let target; for (let i = 0; i < 60 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${DBG}/json`)).json()).find(t => t.type === 'page'); } catch (_) {} if (!target) await sleep(250); }
  ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); } };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1.25, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${APP}/index.html?t=` + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500); await evalJS("document.getElementById('welcome-close')?.click()");
  await evalJS(`(async () => { const r = await fetch(${JSON.stringify(MODEL)}); const b = await r.blob(); const f = new File([b], ${JSON.stringify(path.basename(MODEL))}); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  for (let i = 0; i < 160; i++) { if ((await evalJS("document.querySelectorAll('#tree .tree-node').length")) > 3) break; await sleep(500); }
  await sleep(4000);
  await evalJS("localStorage.setItem('stepopt-claude-ask', '0'); window.__moBridge.setEnabled(true, true)"); await sleep(1500);

  // before and after: to the web limits, then compare
  await tool('set_camera_view', { view: 'perspective' }); await sleep(800);
  const o = await tool('optimise_to_target', { preset: 'web', level: 'light' });
  console.log('optimise_to_target ->', o.txt);
  const c = await tool('compare_images', { width: 1200, height: 1230, mode: 'solid', background: 'dark', quality: 'smooth' });
  const cj = (() => { try { return JSON.parse(c.txt.split('\n').pop()); } catch (_) { return null; } })();
  console.log('compare_images ->', c.txt.split('\n').pop().slice(0, 400));
  if (cj && cj.file) fs.copyFileSync(cj.file.path, `${OUT}/claude-compare.png`);
  await tool('undo', { steps: 20 }); await sleep(800);

  // a job in progress, with the dropdown open and the Stop button
  const BD = (process.env.TEMP || '.') + '/mo-jobshot-' + Date.now(); fs.mkdirSync(BD, { recursive: true });
  for (let k = 1; k <= 4; k++) fs.copyFileSync(path.resolve(MODEL), BD + '/Gearbox-' + k + '.glb');
  const run = tool('batch_optimise', { folder: BD.replace(/\\/g, '/'), preset: 'web', level: 'light' });
  let seen = null;
  for (let i = 0; i < 240 && !seen; i++) { await sleep(500); seen = await evalJS("(() => { const t = document.getElementById('claude-pill')?.textContent || ''; return /File 1 of 4 .*(reducing|Smart|tidying|exporting)/.test(t) ? t.trim() : null; })()"); }
  console.log('pill:', seen);
  await evalJS("(() => { const f = [...document.querySelectorAll('iframe.mo-tab-frame')].find(x => x.style.display === 'block'); const p = (f && f.contentDocument || document).getElementById('claude-pill'); p && p.click(); })()");
  await sleep(900); await calm();
  await evalJS("(() => { const f = [...document.querySelectorAll('iframe.mo-tab-frame')].find(x => x.style.display === 'block'); const d = f && f.contentDocument || document; const l = d.getElementById('loader'); if (l) l.style.display = 'none'; })()"); await sleep(300);
  await shot('claude-job');
  await evalJS("(() => { const f = [...document.querySelectorAll('iframe.mo-tab-frame')].find(x => x.style.display === 'block'); const b = (f && f.contentDocument || document).getElementById('clp-stop'); b && b.click(); })()");
  const r = await run; console.log('batch ->', r.txt.slice(0, 500));
  try { fs.rmSync(BD, { recursive: true, force: true }); } catch (_) {}
} catch (e) { console.log('ERROR:', e.message); }
try { ws && ws.close(); } catch (_) {}
chrome.kill(); srv.kill(); process.exit(0);
