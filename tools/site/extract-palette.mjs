// tools/site/extract-palette.mjs - the commands of the app's search (command palette), for the search section of the site.
//
//   node tools/site/extract-palette-live.mjs     (optional, first: the rows the running app lists, with the sidebars and Settings)
//   node tools/site/extract-palette.mjs [app folder]
//
// Two sources are put together:
//   - the registered actions, read out of <app folder>/js/app.js: id, group, label, shortcut and the hidden words the search also matches
//     ("toggle", "floor"...), with the icon the app gives each (ICON by id, else the icon of its group);
//   - palette-live.json, if there is one: every row the app's search actually listed when it was run (site/palette-live.json
//     from extract-palette-live.mjs): the controls of the sidebars and the rows of Settings are only known to the running page.
// The drawing of each icon comes from the app's own Lucide build and the colour of each kind from the --cat-* tokens in the app's index.html.
// Writes site/palette-data.json, which tools/site/build-app-site.js puts in the page.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SITE = join(here, '..', '..', 'site');
const APP = process.argv[2] || join(here, '..', '..');
const APPJS = ['app/js/app.js', 'js/app.js', 'app-v2.js'].map((f) => join(APP, f)).find(existsSync);      // the app folder, or its parent, or the old layout
const ROOTDIR = APPJS.endsWith(join('js', 'app.js')) ? join(dirname(APPJS), '..') : APP;
const src = readFileSync(APPJS, 'utf8');
const html = readFileSync(join(ROOTDIR, 'index.html'), 'utf8');
const lucide = createRequire(import.meta.url)(join(ROOTDIR, 'vendor', 'lucide', 'lucide.min.js'));

// the icon tables of the palette
const block = (name) => { const m = src.match(new RegExp('const ' + name + ' = \\{([\\s\\S]*?)\\n\\s*\\};')); if (!m) throw new Error(name + ' not found'); return m[1]; };
const pairs = (text) => Object.fromEntries([...text.matchAll(/([A-Za-z0-9_]+):\s*'([^']+)'/g)].map((m) => [m[1], m[2]]));
const ICON = pairs(block('ICON')), GROUP_ICON = pairs(src.match(/const GROUP_ICON = \{([^}]*)\}/)[1]);
const CAT = Object.fromEntries([...html.matchAll(/--cat-([a-z]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));

// ---- the registered actions: one per line, { id:'x', group:'G', label:'L' (or a getter), words:'...', kbd:'K', alt:'A', ... } ----
const start = src.indexOf('const _Actions = (() => {');
const end = src.indexOf('\n  ];', start);
const unq = (s) => s.split("\\'").join("'");
const str = (line, key) => { const m = line.match(new RegExp('[ ,{]' + key + ":\\s*'((?:[^'\\\\]|\\\\.)*)'")); return m ? unq(m[1]) : ''; };
const actions = [];
for (const line of src.slice(start, end).split('\n')) {
  if (!/^\s*\{ id:/.test(line)) continue;
  const id = str(line, 'id'), group = str(line, 'group');
  let label = str(line, 'label');
  if (!label) { const g = line.match(/get label\(\)\s*\{\s*return[^?]*\?\s*'((?:[^'\\]|\\.)*)'/); if (g) label = unq(g[1]); }   // a label that changes with the state: its first form
  if (!id || !label) continue;
  actions.push({ id, group, label, words: str(line, 'words'), kbd: str(line, 'kbd'), alt: str(line, 'alt') });
}

const CATS = ['file', 'view', 'selection', 'edit', 'app'];
// icons the app names but its Lucide build lacks (the app draws them itself): the nearest standard ones stand in
const STAND_IN = { 'cube-solid': 'box', 'cube-wire': 'box', 'cube-xray': 'box', 'sphere-clay': 'circle', 'view-top': 'view', 'view-front': 'view', 'view-side': 'view' };
const pascal = (n) => n.split('-').map((s) => s[0].toUpperCase() + s.slice(1)).join('');
const nodesOf = (name) => { const real = STAND_IN[name] || name; const n = lucide.icons[pascal(real)]; return n ? n.filter(([tag]) => typeof tag === 'string') : null; };
const icons = {};
const iconFor = (name, fallback) => {
  let use = name, nodes = name && nodesOf(name);
  if (!nodes) { use = fallback || 'command'; nodes = nodesOf(use) || nodesOf('command'); use = nodesOf(use) ? use : 'command'; }
  if (nodes) icons[use] = nodes;
  return use;
};
const keysOf = (kbd) => kbd.split('+').filter(Boolean).map((k) => k.trim()).join(' + ').replace(/\s\+\s\+/g, ' + +');

// [label, shortcut, kind, icon, group shown at the right, hidden search words, id]
const list = [];
const seen = new Map();
const add = (row) => { const key = row[0].toLowerCase(); if (seen.has(key)) return; seen.set(key, row); list.push(row); };
for (const a of actions) {
  const cat = CATS.includes(a.group.toLowerCase()) ? a.group.toLowerCase() : 'app';
  add([a.label, keysOf(a.kbd), cat, iconFor(ICON[a.id], GROUP_ICON[a.group]), a.group, a.words, a.id]);
}
// the rows the running app listed that the registry does not hold: the controls of the sidebars, Settings
const livePath = join(SITE, 'palette-live.json');
let extra = 0;
if (existsSync(livePath)) {
  for (const r of JSON.parse(readFileSync(livePath, 'utf8'))) {
    if (r.section === 'Library') continue;                             // the library is every part of site.library, drawn by the generator
    const group = ((r.rest.find((t) => t.startsWith('cmdk-item-group=')) || '').split('=')[1] || '').trim();
    const keys = ((r.rest.find((t) => t.startsWith('cmdk-keys=')) || '').split('=')[1] || '').trim();
    const before = list.length;
    add([r.label, keysOf(keys), r.cat || 'app', iconFor(r.icon, 'settings'), group, '', '']);
    if (list.length > before) extra++;
  }
}
for (const n of ['box', 'blocks', 'ruler', 'search']) { const nodes = nodesOf(n); if (nodes) icons[n] = nodes; }
writeFileSync(join(SITE, 'palette-data.json'), JSON.stringify({ colours: CAT, commands: list, icons }));
const kinds = {};
for (const r of list) kinds[r[2]] = (kinds[r[2]] || 0) + 1;
console.log(`${list.length} rows (${actions.length} registered actions, ${extra} more from the running app), ${Object.keys(icons).length} icons`, JSON.stringify(kinds));
