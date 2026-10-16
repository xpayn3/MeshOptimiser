// tools/site/extract-palette-live.mjs - everything the app's search can list, read from the running app.
//
//   node tools/site/extract-palette-live.mjs [address of the online version]
//
// The registered commands can be read out of the app's js/app.js (tools/site/extract-palette.mjs), but the search also lists the buttons and controls of the
// sidebars and the rows of Settings, which the app finds in its own page. So the online version (lite/) is opened in a headless Chrome
// through the DevTools protocol, the search is opened and queried (every letter, then every word of every label found, until nothing new
// turns up) and each row is written down: its label, its section, its kind, its icon and its shortcut.
// Writes site/palette-live.json, which tools/site/extract-palette.mjs merges. Needs the site served (python -m http.server 8080).
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const URL_ = process.argv[2] || 'http://127.0.0.1:8080/site/lite/';
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9341;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'palette-'))}`,
  '--window-size=1500,1000', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', 'about:blank',
], { stdio: 'ignore' });
let targets;
for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.find((t) => t.type === 'page')) break; } catch (_) { /* not up yet */ } await sleep(200); }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const waiting = new Map();
ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } });
const send = (method, params = {}) => new Promise((res) => { const i = ++id; waiting.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: URL_ });
for (let i = 0; i < 60; i++) { if (await ev(`!!document.getElementById('cmdk-input')`)) break; await sleep(500); }
await sleep(3500);
await ev(`document.getElementById('vp-cmdk')?.click()`);
await sleep(500);
if (!(await ev(`document.getElementById('cmdk-modal')?.classList.contains('show')`))) throw new Error('the search did not open');

// one query: the rows it lists, in order, each with the heading it is under
const reader = `(q) => {
  const i = document.getElementById('cmdk-input');
  i.value = q; i.dispatchEvent(new Event('input', { bubbles: true }));
  return new Promise((resolve) => setTimeout(() => {
    const out = []; let section = '';
    for (const e of document.getElementById('cmdk-list').children) {
      if (e.classList.contains('cmdk-section')) { section = e.textContent.trim(); continue; }
      if (!e.classList.contains('cmdk-item')) continue;
      const svg = e.querySelector('svg');
      const label = e.querySelector('.cmdk-item-label');
      const rest = [...e.children].filter((c) => c !== svg && c !== label).map((c) => c.className + '=' + c.textContent.trim().split(/\\s+/).join(' ')).filter((t) => !t.endsWith('='));
      out.push({ label: label ? label.textContent.trim() : '', section, cat: e.dataset.cat || '', icon: svg ? (svg.getAttribute('data-icon') || '') : '', rest });
    }
    resolve(out);
  }, 90));
}`;
await ev(`window.__q = ${reader}`);
const found = new Map();
const queue = [...'abcdefghijklmnopqrstuvwxyz0123456789'];
const asked = new Set();
let n = 0;
while (queue.length && n < 2500) {
  const q = queue.shift();
  if (asked.has(q)) continue;
  asked.add(q); n++;
  const rows = await ev(`window.__q(${JSON.stringify(q)})`);
  for (const r of rows || []) {
    const key = r.section + '|' + r.label;
    if (found.has(key)) continue;
    found.set(key, r);
    for (const w of r.label.toLowerCase().split(/[^a-z0-9]+/)) if (w.length >= 2 && !asked.has(w) && !queue.includes(w)) queue.push(w);
  }
  if (n % 100 === 0) console.log(n, 'queries,', found.size, 'rows,', queue.length, 'to ask');
}
const items = [...found.values()];
writeFileSync(join(here, '..', '..', 'site', 'palette-live.json'), JSON.stringify(items));
const bySection = {};
for (const r of items) bySection[r.section] = (bySection[r.section] || 0) + 1;
console.log(items.length, 'rows after', n, 'queries:', JSON.stringify(bySection));
console.log('sample with extras:', JSON.stringify(items.filter((r) => r.rest.length).slice(0, 4)));
ws.close(); chrome.kill();
process.exit(0);
