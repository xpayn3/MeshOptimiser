// node tests/e2e-update.mjs [shots folder]
//
// The in-app updater, whole: a copy of this app in a temp folder (version 0.21.0), a "0.22.0" release built from it with
// tools/app/build-update.py, a feed for it on 127.0.0.1, and headless Chrome on the copy. It checks the corner card, Settings ›
// Updates (switches, skip, later, channel), an update that restarts the server and reloads the page, the notice afterwards,
// the way back, the unsaved-changes question, and a feed whose checksum is wrong. Nothing here touches the real app folder or
// the server you may have open on 4242. Needs Chrome, Python and Node 22+.
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SRC = path.resolve('.');
const SHOTS = process.argv[2] || process.env.SHOTS || os.tmpdir();
const APP = 4350, FEED = 4351, DBG = 9371;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mo-update-e2e-'));
const A = path.join(TMP, 'app'), B = path.join(TMP, 'build'), D = path.join(B, 'dist');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); } };
const procs = [];
const cleanup = () => { for (const p of procs) { try { p.kill(); } catch (_) {} } try { spawnSync('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'mo-update-e2e' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`]); } catch (_) {} };
process.on('exit', cleanup);

// ── 1. two copies: the installed app (0.21.0) and the one the release is built from ──
const SKIP = new Set(['.git', '.venv', 'inbox', 'exports', '__pycache__', '.update', 'dist', 'node_modules', '.claude', 'server.log', 'tests', 'docs']);
const copy = (from, to) => { fs.mkdirSync(to, { recursive: true }); for (const e of fs.readdirSync(from, { withFileTypes: true })) { if (SKIP.has(e.name)) continue; const s = path.join(from, e.name), d = path.join(to, e.name); e.isDirectory() ? copy(s, d) : fs.copyFileSync(s, d); } };
copy(path.join(SRC, 'app'), A);
fs.mkdirSync(path.join(A, 'inbox'), { recursive: true }); fs.writeFileSync(path.join(A, 'inbox', 'keep-me.glb'), 'MY MODEL');
fs.writeFileSync(path.join(A, 'version.json'), JSON.stringify({ version: '0.21.0', launcher: 1 }));
copy(A, path.join(B, 'app')); fs.mkdirSync(path.join(B, 'tools'), { recursive: true }); fs.copyFileSync(path.join(SRC, 'tools', 'build-update.py'), path.join(B, 'tools', 'build-update.py'));
fs.copyFileSync(path.join(SRC, '.gitignore'), path.join(B, '.gitignore'));
// the new version: a marker file, a visible version, a changelog with notes
fs.writeFileSync(path.join(B, 'app', 'e2e-marker.txt'), 'new version');
let html = fs.readFileSync(path.join(B, 'app', 'index.html'), 'utf8'); html = html.replace('id="brand-menu-ver">v0.21.0<', 'id="brand-menu-ver">v0.22.0<'); fs.writeFileSync(path.join(B, 'app', 'index.html'), html);
fs.writeFileSync(path.join(B, 'CHANGELOG.md'), '# Changelog\n\n## v0.22.0\n\nReleased 20 Oct 2026.\n\n- ![new][new] **Test feature one.** Something.\n- ![fix][fix] **Test fix two.** Something else.\n');
const git = (args) => spawnSync('git', args, { cwd: B, encoding: 'utf8' });
git(['init', '-q']); git(['add', '-A']);
const bu = spawnSync('python', ['tools/app/build-update.py', '--out', 'dist', '--url-base', `http://127.0.0.1:${FEED}/`, '--headline', 'Two things for the test.'], { cwd: B, encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
console.log((bu.stdout || '') + (bu.stderr || ''));
check('build-update.py builds the archive and the feed', bu.status === 0 && fs.existsSync(path.join(D, 'latest.json')), bu.stderr);
const feed0 = JSON.parse(fs.readFileSync(path.join(D, 'latest.json'), 'utf8'));
check('the feed names 0.22.0 with two notes and a checksum', feed0.stable.version === '0.22.0' && feed0.stable.notes.length === 2 && /^[0-9a-f]{64}$/.test(feed0.stable.archive.sha256), feed0.stable);
const zipList = spawnSync('python', ['-c', `import zipfile,sys;n=zipfile.ZipFile(sys.argv[1]).namelist();print('\\n'.join(n))`, path.join(D, feed0.stable.archive.url.split('/').pop())], { encoding: 'utf8' }).stdout.split(/\r?\n/);
check('the archive holds the app and nothing private', zipList.includes('serve.py') && zipList.includes('updater.py') && zipList.includes('e2e-marker.txt') && !zipList.some(n => /^(inbox|exports|\.venv|\.git|tests|tools)\//.test(n) || /^start\.(bat|command)$/.test(n) || n === 'version.json'), zipList.filter(n => /inbox|exports|venv|\.git|tests|tools|start|version/.test(n)));

// ── 2. servers: the feed, and the installed app ──
procs.push(spawn('python', ['-m', 'http.server', String(FEED), '--bind', '127.0.0.1', '--directory', D], { stdio: 'ignore' }));
const srvLog = fs.openSync(path.join(TMP, 'server.out'), 'w');
procs.push(spawn('python', ['serve.py', '--no-browser', '--keep-running', '--port', String(APP)], { cwd: A, stdio: ['ignore', srvLog, srvLog], env: { ...process.env, MO_UPDATE_DEV: '1', MO_UPDATE_FEED: `http://127.0.0.1:${FEED}/latest.json`, PYTHONIOENCODING: 'utf-8' } }));
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${APP}/api/update/status`)).ok) break; } catch (_) {} await sleep(250); }

// ── 3. the browser ──
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${DBG}`, `--user-data-dir=${path.join(TMP, 'profile')}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
procs.push(chrome);
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const evq = (expr) => ev(expr).catch(() => null);                              // (the page may be reloading)
const shot = async (name) => { try { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(r.data, 'base64')); } catch (_) {} };
const until = async (what, fn, ms = 20000, step = 250) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await evq(fn); if (v) return v; await sleep(step); } return null; };
const cardText = () => evq("(() => { const c = document.getElementById('mo-update-card'); return c && !c.hidden ? c.innerText : ''; })()");
const paneText = () => evq("(document.getElementById('set-pane-updates') || {}).innerText || ''");
const click = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`);
const status = async () => (await fetch(`http://127.0.0.1:${APP}/api/update/status`)).json();
const post = async (p, b = {}) => (await fetch(`http://127.0.0.1:${APP}/api/update/${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).json();

try {
  let target;
  for (let i = 0; i < 60 && !target; i++) { try { const l = await (await fetch(`http://127.0.0.1:${DBG}/json`)).json(); target = l.find(t => t.type === 'page'); } catch (_) {} if (!target) await sleep(250); }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); } else if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text || '').split('\n').slice(0, 2).join(' | ')); };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${APP}/index.html` });
  await until('ready', "document.body && document.body.classList.contains('app-ready')", 90000, 500);
  await evq("document.getElementById('welcome-close')?.click()");

  // — the card —
  let t = await until('card', "(() => { const c = document.getElementById('mo-update-card'); return c && !c.hidden && c.innerText.includes('0.22.0'); })()", 25000);
  const ct = await cardText();
  check('on start the corner card says 0.22.0 is available', !!t && /Version 0\.22\.0 is available/.test(ct), ct);
  check('…with what is new, the size, and the buttons', /Test feature one/.test(ct) && /Test fix two/.test(ct) && /MB download|KB/.test(ct) === true || /download/.test(ct), ct);
  check('…and Update now, Later, Details and Skip', ['Update now', 'Later', 'Details', 'Skip this version'].every(x => ct.includes(x)), ct);
  check('the logo carries a dot', await ev("document.querySelector('.brand-mark')?.dataset.update") === 'new');
  await sleep(500); await shot('up-1-card');
  const st0 = await status(); check('the server confirmed the page and has no pending update', st0.current === '0.21.0' && st0.phase === 'idle', st0);

  // — Settings › Updates —
  await ev("window.__openSettings('updates')"); await sleep(600);
  let pt = await paneText();
  check('Settings › Updates: headline and notes', /Version 0\.22\.0 is available/.test(pt) && /What is new in 0\.22\.0/.test(pt) && /Test feature one/.test(pt), pt.slice(0, 300));
  check('…the switches and choices are there', ['Check for updates automatically', 'How often', 'Update channel', 'Show a notice in the corner', 'Every start', 'Daily', 'Weekly', 'Stable', 'Beta', 'Privacy', 'Reset'].every(x => pt.toLowerCase().includes(x.toLowerCase())), pt.slice(0, 600));
  check('…and the nav item says New', await ev("(() => { const n = document.getElementById('set-nav-updates'); return !!n && !n.hidden && n.dataset.state === 'new' && /New/.test(n.innerText); })()"));
  await shot('up-2-settings');
  const store = () => ev("JSON.parse(localStorage.getItem('mo-updates') || '{}')");
  await click('#up-auto'); await sleep(300);
  check('Check automatically off is remembered', (await store()).auto === false);
  check('…and "How often" is greyed out', await ev("document.querySelector('#set-pane-updates [data-up=every]').getAttribute('aria-disabled')") === 'true');
  await click('#up-auto'); await sleep(300);
  await click('#set-pane-updates [data-up=every] [data-v=weekly]'); await sleep(200);
  check('Weekly is remembered', (await store()).every === 'weekly');
  await click('#set-pane-updates [data-up=every] [data-v=start]'); await sleep(200);
  await click('#up-notify'); await sleep(200); check('Show a notice off is remembered', (await store()).notify === false); await click('#up-notify'); await sleep(200);

  // — Later, Skip —
  await ev("document.getElementById('settings-modal').classList.remove('show')");
  if (!(await cardText())) await ev("window.MOUpdater.check({ manual: true })"), await sleep(1200);
  check('the card is on screen', /Version 0\.22\.0/.test(await cardText()));
  await click('#mo-update-card [data-act=later]'); await sleep(500);
  check('Later hides the card and sets a reminder', !(await cardText()) && (await store()).remindAt > Date.now());
  await ev("window.__openSettings('updates')"); await sleep(400);
  check('…and Settings shows the reminder', /Reminder/.test(await paneText()));
  await click('[data-up-act=unremind]'); await sleep(500);
  check('Remind me now brings the card back', /Version 0\.22\.0/.test(await cardText()));
  await click('#mo-update-card [data-act=skip]'); await sleep(500);
  check('Skip hides the card and remembers the version', !(await cardText()) && (await store()).skipped === '0.22.0');
  await ev("window.__openSettings('updates')"); await sleep(400);
  check('…Settings shows "Skipped version" with a way back', /Skipped version/.test(await paneText()) && /Offer it again/.test(await paneText()));
  await click('[data-up-act=unskip]'); await sleep(500);
  check('Offer it again brings the card back', /Version 0\.22\.0/.test(await cardText()) && !(await store()).skipped);
  // channel: beta has nothing in this feed, stable's 0.22.0 is still offered
  await click('#set-pane-updates [data-up=channel] [data-v=beta]'); await sleep(1500);
  check('Beta channel also offers the newer stable release', (await store()).channel === 'beta' && /0\.22\.0/.test(await paneText()));
  await click('#set-pane-updates [data-up=channel] [data-v=stable]'); await sleep(1500);
  await click('[data-up-act=reset]'); await sleep(300); const rs = await store(); check('Reset puts the choices back', rs.auto === true && rs.every === 'start' && rs.channel === 'stable' && rs.notify === true, rs);
  await ev("document.getElementById('settings-modal').classList.remove('show')");

  // — the unsaved-changes question —
  await ev("window.__moHasUnsaved = () => true");
  if (!/Version 0\.22\.0/.test(await cardText())) await ev("window.MOUpdater.check({ manual: true })"), await sleep(1200);
  await click('#mo-update-card [data-act=update]'); await sleep(500);
  const ut = await cardText(); check('with unsaved changes it asks first', /Save your scene first/.test(ut) && /Update anyway/.test(ut), ut);
  await shot('up-3-unsaved');
  await click('#mo-update-card [data-act=later]'); await sleep(300);
  check('Cancel there changes nothing', (await status()).current === '0.21.0');
  await ev("window.__moHasUnsaved = () => false"); await ev("window.MOUpdater.set('notify', true)");
  await ev("(() => { const s = JSON.parse(localStorage.getItem('mo-updates')); s.remindAt = 0; localStorage.setItem('mo-updates', JSON.stringify(s)); })()");

  // — a feed with the wrong checksum: refused, nothing changed —
  const goodFeed = fs.readFileSync(path.join(D, 'latest.json'), 'utf8');
  const bad = JSON.parse(goodFeed); bad.stable.archive.sha256 = '0'.repeat(64); fs.writeFileSync(path.join(D, 'latest.json'), JSON.stringify(bad));
  await ev("window.MOUpdater.check({ manual: true })"); await sleep(1500);
  await click('#mo-update-card [data-act=update]'); await sleep(200);
  const failed = await until('error', "(() => { const c = document.getElementById('mo-update-card'); return c && !c.hidden && /did not go through/.test(c.innerText); })()", 20000);
  const et = await cardText();
  check('a wrong checksum is refused with a plain message', !!failed && /checksum/i.test(et), et);
  await shot('up-4-error');
  check('…and no file changed', (await status()).current === '0.21.0' && !fs.existsSync(path.join(A, 'e2e-marker.txt')) && !(await status()).backup);
  fs.writeFileSync(path.join(D, 'latest.json'), goodFeed);
  await click('#mo-update-card [data-act=close]'); await sleep(300);

  // — the update itself —
  await ev("window.MOUpdater.check({ manual: true })"); await sleep(1500);
  await ev('window.__e2eOldPage = true');                                           // (only the page from before the update has this)
  await click('#mo-update-card [data-act=update]');
  const seen = new Set();
  for (let i = 0; i < 160; i++) { const c = await cardText(); if (c) seen.add(c.split('\n')[0]); const v = await evq("!window.__e2eOldPage && (document.getElementById('brand-menu-ver') || {}).textContent"); if (v && v.trim() === 'v0.22.0') break; await sleep(250); }
  console.log('   card headlines during the update:', [...seen].join(' | '));
  check('the card showed progress', [...seen].some(s => /Download|Checking|Installing|Restarting/.test(s)), [...seen]);
  const up = await until('0.22.0', "!window.__e2eOldPage && (document.getElementById('brand-menu-ver') || {}).textContent.trim() === 'v0.22.0'", 90000, 500);
  check('the server restarted and the page reloaded on 0.22.0', !!up);
  await until('ready', "document.body && document.body.classList.contains('app-ready')", 60000, 500);
  const st1 = await status();
  check('the server runs 0.22.0 and idles', st1.current === '0.22.0' && st1.phase === 'idle', st1);
  check('the new file arrived, the user\'s model is untouched', fs.existsSync(path.join(A, 'e2e-marker.txt')) && fs.readFileSync(path.join(A, 'inbox', 'keep-me.glb'), 'utf8') === 'MY MODEL');
  check('the launcher is untouched and version.json keeps its level', JSON.parse(fs.readFileSync(path.join(A, 'version.json'), 'utf8')).launcher === 1);
  check('a backup of 0.21.0 is kept', st1.backup && st1.backup.version === '0.21.0', st1.backup);
  const nt = await until('notice', "(() => { const c = document.getElementById('mo-update-card'); return c && !c.hidden && /Updated to/.test(c.innerText); })()", 20000);
  check('after the reload the card says "Updated to 0.22.0"', !!nt && /Updated to 0\.22\.0/.test(await cardText()), await cardText());
  await shot('up-5-updated');
  await click('#mo-update-card [data-act=dismiss]'); await sleep(500);
  check('the notice is shown once (the server forgot it)', !(await status()).notice);
  const pend = fs.existsSync(path.join(A, '.update', 'pending.json'));
  check('the page confirmed the update (nothing is pending)', !pend);
  await ev("window.__openSettings('updates')"); await sleep(800);
  pt = await paneText();
  check('Settings › Updates: up to date, with a way back', /up to date/.test(pt) && /Restore 0\.21\.0/.test(pt), pt.slice(0, 400));
  await shot('up-6-uptodate');

  // — the way back —
  await click('[data-up-act=rollback]'); await sleep(300);
  check('going back asks for a second press', /Press again to restore 0\.21\.0/.test(await paneText()));
  await ev('window.__e2eOldPage = true');
  await click('[data-up-act=rollback]');
  const back = await until('back', "!window.__e2eOldPage && (document.getElementById('brand-menu-ver') || {}).textContent.trim() === 'v0.21.0'", 90000, 500);
  check('the earlier version is back and the page reloaded', !!back);
  await until('ready', "document.body && document.body.classList.contains('app-ready')", 60000, 500);
  const st2 = await status();
  check('0.21.0 runs again and the new file is gone', st2.current === '0.21.0' && !fs.existsSync(path.join(A, 'e2e-marker.txt')) && fs.readFileSync(path.join(A, 'inbox', 'keep-me.glb'), 'utf8') === 'MY MODEL', st2);
  const rb = await until('rolled', "(() => { const c = document.getElementById('mo-update-card'); return c && !c.hidden && /Back on/.test(c.innerText); })()", 20000);
  check('the card says "Back on 0.21.0"', !!rb);
  await click('#mo-update-card [data-act=dismiss]');
  check('page exceptions', errors.length === 0, errors);
} catch (e) { fail++; console.log('HARNESS ERROR:', e.stack || e.message); }
console.log(`\n${pass} passed, ${fail} failed`);
try { ws && ws.close(); } catch (_) {}
cleanup();
await sleep(500);
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
process.exit(fail ? 1 : 0);
