// node tests/e2e-mcp-server.mjs [model, default inbox/Drive_Unit_DU-240.glb]
//
// The whole chain, on a server and a browser of its own (port 4343, so a copy of the app you have open on 4242 is not touched):
// serve.py starts, headless Chrome opens the app and loads a model, the app's "Let Claude connect" is switched on, and then
// JSON-RPC calls go to http://127.0.0.1:4343/mcp exactly as Claude's client would send them. It checks tools/list, the Allow /
// Don't allow prompt (answered by clicking it), the Settings › Claude switches that refuse a kind of edit, the activity log, and the
// connection state shown in Settings. Needs Chrome, Python and Node 22+. Screenshots of the Settings pane go to the folder given
// as SHOTS (default: the temp folder).
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODEL = process.argv[2] || 'inbox/Drive_Unit_DU-240.glb';
const APP = 4343, DBG = 9366, PROFILE = (process.env.TEMP || '.') + '/cdp-profile-srv-' + Date.now();
const SHOTS = process.env.SHOTS || process.env.TEMP || '.';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const srv = spawn('python', ['serve.py', '--no-browser', '--port', String(APP)], { cwd: path.resolve('app'), stdio: ['ignore', 'ignore', process.env.SERVER_LOG ? fs.openSync(process.env.SERVER_LOG, 'w') : 'ignore'] });      // SERVER_LOG=<file>: what the server printed
const chrome = spawn(CH, ['--headless=new', '--mute-audio', '--no-sandbox', `--remote-debugging-port=${DBG}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(), errors = [], consoleErr = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(r.data, 'base64')); };
let pass = 0, fail = 0, rpcId = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const rpc = async (method, params) => {
  const r = await fetch(`http://127.0.0.1:${APP}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) });
  const t = await r.text(); const line = t.startsWith('event') ? t.split('\n').find(l => l.startsWith('data:')).slice(5) : t;
  return JSON.parse(line);
};
const tool = async (name, args = {}) => { const r = await rpc('tools/call', { name, arguments: args }); const res = r.result || {}; const txt = (res.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n'); let j = null; try { j = JSON.parse(txt); } catch (_) {} return { err: !!res.isError || !!r.error, txt: txt || (r.error && r.error.message) || '', j, raw: res }; };
// answer the app's prompt: click Allow (yes) or Don't allow (no) once it is on screen
const answer = async (yes) => { for (let i = 0; i < 60; i++) { const ok = await evalJS(`(() => { const b = document.querySelector('.cl-ask .${yes ? 'cl-yes' : 'cl-no'}'); if (b) { b.click(); return true; } return false; })()`); if (ok) return true; await sleep(100); } return false; };
const setLS = (k, v) => evalJS(`localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)})`);
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${APP}/index.html`)).ok) break; } catch (_) {} await sleep(250); }
  let target;
  for (let i = 0; i < 60 && !target; i++) { try { const l = await (await fetch(`http://127.0.0.1:${DBG}/json`)).json(); target = l.find(t => t.type === 'page'); } catch (_) {} if (!target) await sleep(250); }
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
  await send('Page.navigate', { url: `http://127.0.0.1:${APP}/index.html?t=` + Date.now() });
  for (let i = 0; i < 120; i++) { if (await evalJS("document.body && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  await evalJS("document.getElementById('welcome-close')?.click()");
  await evalJS(`(async () => { const r = await fetch(${JSON.stringify(MODEL)}); const b = await r.blob(); const f = new File([b], ${JSON.stringify(path.basename(MODEL))}); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  for (let i = 0; i < 160; i++) { const n = await evalJS("document.querySelectorAll('#tree .tree-node').length"); if (n > 3) break; await sleep(500); }
  await sleep(3000);

  // — Settings › Claude, connection off —
  await evalJS("window.__openSettings('claude')"); await sleep(600);
  let nav = await evalJS("(() => { const e = document.getElementById('set-nav-claude'); return e ? { state: e.dataset.state, text: e.textContent.trim() } : null; })()");
  check('the Claude nav item shows the state: Off', nav && nav.state === 'off' && /Off/.test(nav.text), nav);
  check('the Claude section has its own pane', await evalJS("!!document.querySelector('#set-main .set-pane[data-pane=\"claude\"].active')"));
  check('General no longer holds the Claude switches', await evalJS("!document.querySelector('#set-pane-general #set-claude')"));
  const noMcp = await tool('scene_summary');
  check('with the connection off the server says so', noMcp.err && /not listening/i.test(noMcp.txt), noMcp.txt);
  await shot('claude-settings-off');

  // — connect —
  await setLS('stepopt-claude-ask', '0');             // edits do not ask, except deleting (its own switch)
  await evalJS("document.getElementById('set-claude').click()"); await sleep(1500);
  nav = await evalJS("(() => { const e = document.getElementById('set-nav-claude'); return { state: e.dataset.state, text: e.textContent.trim() }; })()");
  check('switching on: the nav item says Listening', nav.state === 'idle' && /Listening/.test(nav.text), nav);
  check('the pill is in the top bar', await evalJS("!document.getElementById('claude-pill').hidden"));
  const list = await rpc('tools/list', {});
  const names = (list.result.tools || []).map(t => t.name);
  check('tools/list has the new tools', ['set_explode', 'transform_parts', 'rename_parts', 'split_parts', 'repair_mesh', 'remove_hidden_faces', 'scene_tabs', 'measure_parts'].every(n => names.includes(n)), names);
  check('every tool has an object input schema', list.result.tools.every(t => t.inputSchema && t.inputSchema.type === 'object'));
  const ss = await tool('scene_summary'); check('scene_summary over MCP', !ss.err && ss.j && ss.j.parts > 0, ss);
  const parts = (await tool('list_parts', { sort_by: 'triangles', limit: 5 })).j.parts; const id1 = parts[0].id, id2 = parts[1].id;
  await sleep(300);
  const st = await evalJS("document.getElementById('set-claude-status').textContent");
  check('Settings names the last request', /list parts/i.test(st), st);

  // — a long answer arrives while the nav item shows Working —
  const ex = await tool('set_explode', { amount: 50 }); check('set_explode over MCP', !ex.err, ex);
  const shotP = tool('screenshot'); const sh = await shotP; check('screenshot over MCP is an image', !sh.err && sh.raw.content.some(c => c.type === 'image'), sh.txt);
  await tool('set_explode', { amount: 0 });

  // — permissions —
  await setLS('stepopt-claude-allow-geometry', '0');
  let r = await tool('decimate', { ids: [id1], reduce_percent: 50 });
  check('geometry switched off: decimate is refused', r.err && /turned off in Settings/i.test(r.txt), r.txt);
  r = await tool('repair_mesh', { ids: [id1] }); check('geometry switched off: repair is refused', r.err && /turned off/i.test(r.txt), r.txt);
  await setLS('stepopt-claude-allow-geometry', '1');
  await setLS('stepopt-claude-allow-layout', '0');
  r = await tool('rename_parts', { renames: [{ id: id1, name: 'X' }] }); check('layout switched off: rename is refused', r.err && /turned off/i.test(r.txt), r.txt);
  r = await tool('select_parts', { ids: [id1] }); check('looking and selecting still work', !r.err, r.txt);
  await setLS('stepopt-claude-allow-layout', '1');
  r = await tool('rename_parts', { renames: [{ id: id1, name: 'Renamed by Claude' }] }); check('layout back on: rename works without a prompt', !r.err && r.j && r.j.renamed === 1, r.txt);
  await tool('undo');

  // — the Allow / Don't allow prompt —
  let p = tool('delete_parts', { ids: [id2] }); const noClicked = await answer(false); r = await p;
  check('delete asks (always ask before deleting), and No stops it', noClicked && r.err && /did not allow/i.test(r.txt), { noClicked, t: r.txt });
  const still = (await tool('scene_summary')).j.parts; check('nothing was deleted after No', still === ss.j.parts, { still, was: ss.j.parts });
  await setLS('stepopt-claude-ask-delete', '0');
  r = await tool('delete_parts', { ids: [id2] }); check('with that off, delete goes straight through', !r.err, r.txt);
  await tool('undo'); check('undo brings the part back', (await tool('scene_summary')).j.parts === ss.j.parts);
  await setLS('stepopt-claude-ask-delete', '1'); await setLS('stepopt-claude-ask', '1');
  p = tool('rename_parts', { renames: [{ id: id1, name: 'Asked' }] }); const yes = await answer(true); r = await p;
  check('with asking on, Allow lets an edit through', yes && !r.err && r.j && r.j.renamed === 1, { yes, t: r.txt });
  await tool('undo'); await setLS('stepopt-claude-ask', '0');
  // — Settings shows it —
  await evalJS("window.__openSettings('claude')"); await sleep(500);
  const log = await evalJS("document.getElementById('set-claude-log').innerText");
  check('the request log lists done, you said no and turned off', /delete parts/.test(log) && /you said no/.test(log) && /turned off/.test(log) && /done/.test(log), log);
  await shot('claude-settings-on');
  r = await tool('transform_parts', { ids: [id1], move: [10, 0, 0] }); check('transform over MCP', !r.err && r.j && r.j.transformed === 1, r.txt); await tool('undo');
  r = await tool('split_parts', { ids: [id1] }); check('split_parts over MCP', !r.err, r.txt);
  r = await tool('no_such_tool'); check('unknown tool is an error', r.err);
  // what Claude is told: the brief, hints on every tool, a guide to read, ready-made jobs
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  check('initialize offers tools, resources and prompts', init.result.capabilities.resources && init.result.capabilities.prompts && init.result.capabilities.tools, init.result.capabilities);
  check('the brief points at the playbook, the search and the safety rules', /meshoptimiser:\/\/playbook\/optimise/.test(init.result.instructions) && /search_docs/.test(init.result.instructions) && /undo/.test(init.result.instructions) && /allow/i.test(init.result.instructions), init.result.instructions);
  check('every tool has hints (title, read only, destructive)', list.result.tools.every(t => t.annotations && typeof t.annotations.readOnlyHint === 'boolean' && typeof t.annotations.destructiveHint === 'boolean' && t.annotations.title));
  const byName = Object.fromEntries(list.result.tools.map(t => [t.name, t.annotations]));
  check('reading tools are read only; changing tools are marked destructive', byName.scene_summary.readOnlyHint && byName.screenshot.readOnlyHint && byName.delete_parts.destructiveHint && byName.decimate.destructiveHint && !byName.hide_parts.destructiveHint && !byName.set_explode.readOnlyHint, byName);
  const res = await rpc('resources/list', {});
  const playbooks = res.result.resources.filter(r => /^meshoptimiser:\/\/playbook\//.test(r.uri)), docsRes = res.result.resources.filter(r => /^meshoptimiser:\/\/docs\//.test(r.uri));
  check('resources/list has six playbooks and the help articles', playbooks.length === 6 && docsRes.length >= 40 && playbooks.length + docsRes.length === res.result.resources.length, { playbooks: playbooks.length, docs: docsRes.length });
  // every name a playbook puts in backticks that looks like a tool or a parameter is one the server really has
  const valid = new Set(names);
  for (const t of list.result.tools) { for (const k of Object.keys((t.inputSchema && t.inputSchema.properties) || {})) valid.add(k); const walk = (o) => { if (!o || typeof o !== 'object') return; if (Array.isArray(o.enum)) o.enum.forEach(v => valid.add(String(v))); Object.values(o).forEach(walk); }; walk(t.inputSchema); }
  let totalChars = 0;
  for (const rsc of res.result.resources) {
    const got = await rpc('resources/read', { uri: rsc.uri });
    const txt = got.result && got.result.contents && got.result.contents[0] && got.result.contents[0].text;
    totalChars += (txt || '').length;
    check('resources/read ' + rsc.uri, typeof txt === 'string' && txt.length > 300, txt && txt.length);
    if (/playbook/.test(rsc.uri)) {
      const named = [...txt.matchAll(/`([a-z][a-z_]*_[a-z_]+)`/g)].map(m => m[1]);
      const missing = [...new Set(named.filter(n => !valid.has(n) && n !== 'nothing_changed'))];       // (nothing_changed is a field of smart_optimise's reply)
      check('the playbook ' + rsc.name + ' only names tools and options that exist', missing.length === 0, missing);
    }
  }
  console.log('knowledge base: ' + res.result.resources.length + ' resources, ' + totalChars + ' characters (about ' + Math.round(totalChars / 4) + ' tokens if read in full)');
  check('an unknown resource is an error', !!(await rpc('resources/read', { uri: 'meshoptimiser://nope' })).error);
  // the search and read tools: answered by the server
  const sd = await tool('search_docs', { query: 'screws inside a housing' });
  check('search_docs finds the hidden parts article for screws inside a housing', !sd.err && sd.j && sd.j.results.some(r => r.name === 'select-hidden-parts'), sd.txt.slice(0, 200));
  const sd2 = await tool('search_docs', { query: 'export for unreal' });
  check('search_docs finds the export advice for Unreal', !sd2.err && sd2.j.results.slice(0, 3).some(r => ['export', 'choose-format', 'goals'].includes(r.name)), sd2.txt.slice(0, 200));
  const sd3 = await tool('search_docs', { query: 'flickering surfaces' });
  check('search_docs finds stacked copies for a flicker', !sd3.err && sd3.j.results.slice(0, 3).some(r => r.name === 'stacked-copies'), sd3.txt.slice(0, 200));
  const rd = await tool('read_doc', { name: 'smart-fit' });
  check('read_doc reads an article in full', !rd.err && /# Smart fit/.test(rd.txt) && rd.txt.length > 1500, rd.txt.length);
  const rp = await tool('read_doc', { name: 'optimise' });
  check('read_doc reads a playbook by its short name', !rp.err && /^# Optimising a model/.test(rp.txt), rp.txt.slice(0, 60));
  check('read_doc on nothing is an error with a hint', (await tool('read_doc', { name: 'zzzz-no-such' })).err);
  check('search_docs with nothing found says so', (await tool('search_docs', { query: 'qqqqzzzz' })).err);
  check('the knowledge tools need no app: they answer from the server', !!rd.txt);
  const pr = await rpc('prompts/list', {});
  check('prompts/list has the jobs', ['optimise_for_web', 'smart_optimise_it', 'remove_fasteners', 'make_safe_to_send', 'render_for_client', 'review_scene'].every(n => pr.result.prompts.some(p => p.name === n)), pr.result);
  const pg = await rpc('prompts/get', { name: 'optimise_for_web', arguments: { target_triangles: '250000' } });
  const ptxt = pg.result.messages[0].content.text;
  check('prompts/get fills the target in and points at the playbook', /250000/.test(ptxt) && /read_doc optimise/.test(ptxt) && pg.result.messages[0].role === 'user', ptxt.slice(0, 160));
  check('an unknown prompt is an error', !!(await rpc('prompts/get', { name: 'nope' })).error);
  // the server's own counts, and the numbers Settings shows
  const stat = await (await fetch(`http://127.0.0.1:${APP}/api/bridge/status`)).json();
  check('/api/bridge/status says it is listening and counts the calls', stat.listening === true && stat.calls >= 10 && stat.tools.scene_summary && stat.tools.scene_summary.calls >= 1 && stat.tools_offered === names.length, stat);
  check('the server counted the refused ones as errors', stat.errors >= 3, stat.errors);
  await evalJS("window.__openSettings('claude')"); await sleep(400);
  const nums = await evalJS("document.getElementById('set-claude-stats').innerText.replace(/\\s+/g, ' ')");
  check('Settings shows the request statistics', /Requests/.test(nums) && /Failed/.test(nums) && /Connected/.test(nums), nums);
  const most = await evalJS("document.getElementById('set-claude-tools').textContent");
  check('Settings names the most asked for', /Most asked for/.test(most), most);
  const rep = await evalJS("(async () => { let t = ''; const w = navigator.clipboard.writeText.bind(navigator.clipboard); navigator.clipboard.writeText = async (x) => { t = x; }; document.getElementById('set-claude-report').click(); await new Promise(r => setTimeout(r, 200)); navigator.clipboard.writeText = w; return t; })()");
  check('Copy report puts the numbers and the requests on the clipboard', /Requests: \d+/.test(rep) && /Recent requests/.test(rep), rep.slice(0, 200));
  const topbar = await evalJS("(() => { const r = (id) => document.getElementById(id).getBoundingClientRect(); const e = r('btn-export'), m = r('file-menu-wrap'), p = r('claude-pill'); return { exportRight: e.left > m.left && e.left < 400, shotHidden: getComputedStyle(document.getElementById('tg-screenshot')).display === 'none', filmHidden: getComputedStyle(document.getElementById('tg-turntable')).display === 'none', pillRight: p.left > innerWidth / 2 }; })()");
  check('top bar: Export beside Menu, screenshot and film hidden, Claude badge on the right', topbar.exportRight && topbar.shotHidden && topbar.filmHidden && topbar.pillRight, topbar);

  // the pill opens a dropdown: the numbers and the basic switches, and More opens Settings
  await evalJS("document.getElementById('settings-close')?.click()"); await sleep(300);
  await evalJS("document.getElementById('claude-pill').click()"); await sleep(400);
  const pop = await evalJS("(() => { const p = document.getElementById('claude-pop'); if (!p) return null; const r = p.getBoundingClientRect(), b = document.getElementById('claude-pill').getBoundingClientRect(); return { shown: p.classList.contains('show'), text: p.innerText.replace(/\\s+/g, ' '), beside: r.top >= b.bottom || r.bottom <= b.top, inside: r.right <= innerWidth && r.left >= 0, switches: p.querySelectorAll('input[type=checkbox]').length, expanded: document.getElementById('claude-pill').getAttribute('aria-expanded') }; })()");
  check('the pill opens a dropdown with the numbers and three switches, above or under it', pop && pop.shown && /Requests/.test(pop.text) && /Said no/.test(pop.text) && pop.switches === 3 && pop.beside && pop.inside && pop.expanded === 'true', pop);
  await shot('claude-popover');
  // (the switch sets the mode of each kind of change, Settings › Claude: what it writes is the geometry mode, not the older
  // 'stepopt-claude-ask' alone; and the modes it leaves are cleared after, or every later edit would follow them)
  const modeNow = "localStorage.getItem('stepopt-claude-mode-geometry')";
  const askBefore = await evalJS(modeNow);
  await evalJS("document.getElementById('clp-ask').click()"); await sleep(250);
  const askAfter = await evalJS(modeNow);
  check('a switch in the dropdown changes the setting', askBefore !== askAfter, { askBefore, askAfter });
  await evalJS("document.getElementById('clp-ask').click()"); await sleep(200);
  await evalJS("['geometry','layout','delete','files'].forEach(c => localStorage.removeItem('stepopt-claude-mode-' + c))");
  await evalJS("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))"); await sleep(250);
  check('Escape closes the dropdown', !(await evalJS("document.getElementById('claude-pop').classList.contains('show')")));
  await evalJS("document.getElementById('claude-pill').click()"); await sleep(300);
  await evalJS("document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))"); await sleep(250);
  check('a click elsewhere closes it', !(await evalJS("document.getElementById('claude-pop').classList.contains('show')")));
  await evalJS("document.getElementById('claude-pill').click()"); await sleep(300);
  await evalJS("document.getElementById('clp-more').click()"); await sleep(500);
  check('More opens Settings on Claude and closes the dropdown', await evalJS("document.getElementById('settings-modal').classList.contains('show') && !!document.querySelector('#set-main .set-pane[data-pane=\"claude\"].active') && !document.getElementById('claude-pop').classList.contains('show')"));
  await evalJS("document.getElementById('settings-close')?.click()"); await sleep(300);
  // — dry runs, progress and Stop —
  const T5 = (await rpc('tools/list', {})).result.tools, byName5 = Object.fromEntries(T5.map(t => [t.name, t]));
  check('tools/list: the five new tools are there', ['optimise_to_target', 'compare_images', 'list_folder', 'batch_optimise'].every(n => byName5[n]), T5.length);
  check('dry_run is offered by the tools that can be taken back, with a reason', ['decimate', 'delete_parts', 'smart_optimise', 'optimise_to_target', 'batch_optimise'].every(n => byName5[n].inputSchema.properties.dry_run && byName5[n].inputSchema.properties.dry_run.type === 'boolean') && !byName5.hide_parts.inputSchema.properties.dry_run);
  check('list_folder is marked read only, optimise_to_target as changing the model', byName5.list_folder.annotations.readOnlyHint === true && byName5.optimise_to_target.annotations.destructiveHint === true);
  await setLS('stepopt-claude-ask', '1'); await setLS('stepopt-claude-ask-delete', '1');          // everything asks: a dry run still must not
  const z5_q0 = await tool('scene_summary');
  const z5_lpd = await tool('list_parts', { sort_by: 'triangles', limit: 3 });
  const z5_dd = await tool('delete_parts', { ids: [z5_lpd.j.parts[0].id], dry_run: true });
  check('dry_run delete_parts: no prompt, says what would go, nothing goes', !z5_dd.err && z5_dd.j && z5_dd.j.dry_run === true && z5_dd.j.would_result.parts_removed === 1 && (await tool('scene_summary')).j.parts === z5_q0.j.parts, z5_dd.txt && z5_dd.txt.slice(0, 200));
  const z5_dd2 = await tool('decimate', { ids: [z5_lpd.j.parts[0].id], reduce_percent: 50, dry_run: true });
  check('dry_run decimate over the bridge: numbers, and the scene is as it was', !z5_dd2.err && z5_dd2.j.dry_run === true && z5_dd2.j.nothing_changed === true && (await tool('scene_summary')).j.triangles === z5_q0.j.triangles, z5_dd2.txt && z5_dd2.txt.slice(0, 200));
  await setLS('stepopt-claude-ask', '0'); await setLS('stepopt-claude-ask-delete', '0');

  const z5_BD = (process.env.TEMP || '.') + '/mo-stop-' + Date.now(); fs.mkdirSync(z5_BD, { recursive: true });
  for (let k = 1; k <= 6; k++) fs.copyFileSync(path.resolve('tests/fixtures/repeats-60.glb'), z5_BD + '/part' + k + '.glb');
  const z5_BDp = z5_BD.replace(/\\/g, '/');
  const z5_tabsBefore = (await tool('scene_tabs')).j.length;
  // Stop, from the dropdown of the pill
  const z5_run1 = tool('batch_optimise', { folder: z5_BDp, level: 'light', export_preset: 'web' });
  let z5_seen = null;
  for (let i = 0; i < 80 && !z5_seen; i++) {
    await sleep(500);
    z5_seen = await evalJS("(() => { const b = document.getElementById('claude-pill'); const t = b && b.textContent || ''; return /File \\d of 6/.test(t) ? t.trim() : null; })()");
  }
  check('while a batch runs the pill says which file it is on', !!z5_seen, z5_seen);
  await evalJS("document.getElementById('claude-pill').click()"); await sleep(800);
  const z5_jobUi = await evalJS("(() => { const j = document.querySelector('#claude-pop .clp-job'); const b = document.getElementById('clp-stop'); return j ? { text: j.textContent.trim().slice(0, 120), stop: !!b, bar: !!j.querySelector('.clp-job-bar') } : null; })()");
  check('the dropdown shows the job, its bar and a Stop button', z5_jobUi && z5_jobUi.stop && z5_jobUi.bar && /File/.test(z5_jobUi.text), z5_jobUi);
  await shot('claude-job');
  await evalJS("document.getElementById('clp-stop').click()");
  const z5_r1 = await z5_run1;
  check('Stop: the batch ends early and says it was stopped', z5_r1.j && z5_r1.j.stopped === true && z5_r1.j.files_done < 6 && z5_r1.j.files_done >= 1, z5_r1.txt && z5_r1.txt.slice(0, 300));
  await evalJS("document.getElementById('claude-pop')?.classList.contains('show') && document.getElementById('claude-pill').click()");
  // (the pill goes back to idle a moment after the call returns: it is waited for, up to 5 s)
  let z5_state = null; for (let i = 0; i < 25; i++) { z5_state = await evalJS("document.getElementById('claude-pill').dataset.state"); if (z5_state === 'idle') break; await sleep(200); }
  check('after Stop the tabs are closed again and the pill is idle', (await tool('scene_tabs')).j.length === z5_tabsBefore && z5_state === 'idle', { tabs: (await tool('scene_tabs')).j.length, z5_tabsBefore, z5_state });

  // progress to a client that asks for it, and cancelling from the client
  const z5_sse = async (name, args, cancelAfterMs) => {
    const id = ++rpcId, ev = [];
    const r = await fetch(`http://127.0.0.1:${APP}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args, _meta: { progressToken: 'tok' + id } } }) });
    const ct = r.headers.get('content-type') || '';
    if (cancelAfterMs) setTimeout(() => fetch(`http://127.0.0.1:${APP}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id, reason: 'test' } }) }), cancelAfterMs);
    const txt = await r.text();
    for (const blk of txt.split('\n\n')) { const l = blk.split('\n').find(x => x.startsWith('data:')); if (l) { try { ev.push(JSON.parse(l.slice(5))); } catch (_) {} } }
    return { ct, ev, id };
  };
  const z5_s1 = await z5_sse('batch_optimise', { files: [z5_BDp + '/part1.glb', z5_BDp + '/part2.glb'], level: 'light' });
  const z5_prog = z5_s1.ev.filter(e => e.method === 'notifications/progress'), z5_fin = z5_s1.ev[z5_s1.ev.length - 1];
  check('a client that asks gets an event stream with progress notices and the result last', /event-stream/.test(z5_s1.ct) && z5_prog.length >= 2 && z5_prog.every(e => e.params.progressToken === 'tok' + z5_s1.id) && z5_fin.id === z5_s1.id && z5_fin.result && !z5_fin.result.isError, { ct: z5_s1.ct, n: z5_prog.length, z5_fin: JSON.stringify(z5_fin).slice(0, 200) });
  check('progress grows and carries a message and a total', z5_prog.every((e, i) => i === 0 || e.params.progress > z5_prog[i - 1].params.progress) && z5_prog.some(e => /File 1 of 2/.test(e.params.message)) && z5_prog.some(e => e.params.total === 2), z5_prog.slice(0, 4).map(e => e.params));
  const z5_s2 = await z5_sse('batch_optimise', { folder: z5_BDp, level: 'light' }, 9000);
  const z5_fin2 = z5_s2.ev[z5_s2.ev.length - 1], z5_j2 = (() => { try { return JSON.parse(z5_fin2.result.content[0].text); } catch (_) { return null; } })();
  check('the client cancelling (notifications/cancelled) stops the job', z5_j2 && z5_j2.stopped === true && z5_j2.files_done < 6, z5_fin2 && JSON.stringify(z5_fin2).slice(0, 300));
  const z5_plain = await tool('list_folder', { path: z5_BDp });
  check('list_folder over the bridge', !z5_plain.err && z5_plain.j.total === 6, z5_plain.txt && z5_plain.txt.slice(0, 200));
  try { fs.rmSync(z5_BD, { recursive: true, force: true }); } catch (_) {}
  await sleep(1500);

  // — restart: the connection from scratch, then the whole server —
  const status = async () => (await (await fetch(`http://127.0.0.1:${APP}/api/bridge/status`)).json());
  const waitListening = async (ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if ((await status()).listening) return true; } catch (_) {} await sleep(500); } return false; };
  let rr = await (await fetch(`http://127.0.0.1:${APP}/api/bridge/restart`, { method: 'POST' })).json();
  check('Reconnect: the server starts the connection from scratch', rr.ok && rr.knowledge >= 50 && rr.tools === names.length, rr);
  check('the app takes the connection again by itself', await waitListening(), await status());
  r = await tool('scene_summary'); check('and Claude can work again', !r.err && r.j && r.j.parts > 0, r.txt);
  await evalJS("document.getElementById('claude-pill').click()"); await sleep(300);
  await evalJS("document.getElementById('clp-reconnect').click()"); await sleep(1800);
  check('the dropdown has a restart-connection button that works', await waitListening(15000));
  r = await tool('scene_summary'); check('Claude works after the dropdown button', !r.err, r.txt);
  await evalJS("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))"); await sleep(200);
  const pid0 = (await status()).pid;
  rr = await (await fetch(`http://127.0.0.1:${APP}/api/restart`, { method: 'POST' })).json();
  check('Restart the server: it says it is restarting', rr.ok, rr);
  let pid1 = null;
  for (let i = 0; i < 80 && !pid1; i++) { await sleep(500); try { const st = await status(); if (st.pid !== pid0) pid1 = st.pid; } catch (_) {} }
  check('a new server process answers on the same port', !!pid1 && pid1 !== pid0, { pid0, pid1 });
  check('the page connects to it again by itself', await waitListening(60000), await status().catch(() => null));
  const list2 = await rpc('tools/list', {}); check('tools/list works on the new server', list2.result && list2.result.tools.length === names.length);
  r = await tool('scene_summary'); check('and the open scene was not lost', !r.err && r.j && r.j.parts > 0, r.txt);
  // — switch the pill off, then the connection —
  await evalJS("document.getElementById('set-claude-pill').click()"); await sleep(300);
  check('the pill can be hidden', await evalJS("document.getElementById('claude-pill').hidden"));
  await evalJS("document.getElementById('set-claude-pill').click()"); await sleep(200);
  await evalJS("document.getElementById('set-claude').click()"); await sleep(1200);
  nav = await evalJS("document.getElementById('set-nav-claude').dataset.state"); check('switching off: the nav item says Off', nav === 'off', nav);
  r = await tool('scene_summary'); await sleep(100);
  check('after switching off the server cannot reach the app', r.err, r.txt);
} catch (e) { fail++; console.log('HARNESS ERROR:', e.message, e.cause && (e.cause.message || e.cause.code)); }
console.log(`\n${pass} passed, ${fail} failed`);
console.log('page exceptions:', errors.length); errors.slice(0, 12).forEach(e => console.log('  ' + e));
console.log('console errors:', consoleErr.length); consoleErr.slice(0, 12).forEach(e => console.log('  ' + e));
try { ws && ws.close(); } catch (_) {}
try { await fetch(`http://127.0.0.1:${APP}/api/quit`, { method: 'POST' }); } catch (_) {}      // (a restarted server is not our child: ask it to stop)
await sleep(400);
chrome.kill(); srv.kill();
process.exit(fail ? 1 : 0);
