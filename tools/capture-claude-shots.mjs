// node tools/capture-claude-shots.mjs <folder> [model, default inbox/GearboxAssy.glb]
//
// Takes the three pictures of the Claude feature that the website shows (Settings > Claude, the top-bar badge with its dropdown, and the
// Allow / Don't allow prompt over the model), as 2400 x 1350 PNG (1920 x 1080 at 1.25), by driving the real app in headless Chrome on a server of its own (port 4343).
// Claude's calls are made as JSON-RPC to /mcp, the way Claude's client would, so the request log in Settings is real. The website
// turns the PNGs into WebP (Images/apps/meshoptimiser-claude-*.webp). Needs Chrome, Python and Node 22+.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = process.argv[2]; if (!OUT) { console.log('usage: node tools/capture-claude-shots.mjs <folder> [model]'); process.exit(2); }
const MODEL = process.argv[3] || 'inbox/GearboxAssy.glb';
const APP = 4343, DBG = 9377, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-shots-' + Date.now();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
const srv = spawn('python', ['app/serve.py', '--no-browser', '--port', String(APP)], { cwd: path.resolve('.'), stdio: 'ignore' });
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${DBG}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1920,1080', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0, rpcId = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, 'base64')); console.log('wrote', name); };
const rpc = async (method, params) => {
  const r = await fetch(`http://127.0.0.1:${APP}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) });
  const t = await r.text(); return JSON.parse(t.startsWith('event') ? t.split('\n').find(l => l.startsWith('data:')).slice(5) : t);
};
const tool = async (name, args = {}) => { const r = await rpc('tools/call', { name, arguments: args }); const res = r.result || {}; const txt = (res.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n'); let j = null; try { j = JSON.parse(txt); } catch (_) {} return { err: !!res.isError, txt, j }; };
const answer = async (yes) => { for (let i = 0; i < 80; i++) { if (await evalJS(`(() => { const b = document.querySelector('.cl-ask .${yes ? 'cl-yes' : 'cl-no'}'); if (b) { b.click(); return true; } return false; })()`)) return true; await sleep(100); } return false; };
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
  await evalJS(`(async () => { const r = await fetch(${JSON.stringify(MODEL)}); const b = await r.blob(); const f = new File([b], ${JSON.stringify(path.basename(MODEL))}); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  for (let i = 0; i < 160; i++) { if ((await evalJS("document.querySelectorAll('#tree .tree-node').length")) > 3) break; await sleep(500); }
  await sleep(4000);
  await evalJS("localStorage.setItem('stepopt-claude-ask', '1'); window.__moBridge.setEnabled(true, true)"); await sleep(1500);
  // a short, real session
  await tool('scene_summary');
  await tool('list_parts', { sort_by: 'triangles', limit: 8 });
  await tool('find_fasteners');
  await tool('hide_parts');
  await tool('set_explode', { amount: 50 });
  await tool('screenshot');
  await tool('set_explode', { amount: 0 });
  await tool('show_all');
  await tool('set_camera_view', { view: 'fit' });
  await sleep(1200);
  await evalJS("window.__openSettings('claude')"); await sleep(900); await calm(); await sleep(300);
  await shot('claude-settings');
  await evalJS("document.getElementById('settings-close')?.click()"); await sleep(600);
  await evalJS("document.getElementById('claude-pill').click()"); await sleep(600); await calm(); await shot('claude-popover');
  await evalJS("document.getElementById('claude-pill').click()"); await sleep(400);
  await tool('set_camera_view', { view: 'fit' }); await sleep(900);
  const p = tool('decimate', { reduce_percent: 50, name_contains: 'mesh_' });
  for (let i = 0; i < 80; i++) { if (await evalJS("!!document.querySelector('.cl-ask')")) break; await sleep(100); }
  await sleep(500); await calm(); await shot('claude-allow');
  await answer(false); await p;
} catch (e) { console.log('ERROR:', e.message); }
try { ws && ws.close(); } catch (_) {}
chrome.kill(); srv.kill(); process.exit(0);
