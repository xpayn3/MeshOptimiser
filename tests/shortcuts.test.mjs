// node tests/shortcuts.test.mjs — the shortcuts window lists every key the app binds.
//
// The window is drawn from _Actions.list (an action's kbd, and its alt) and from the EXTRA list beside the
// window (gestures, and keys a panel takes while it is open). The keys themselves are bound in three places:
// _KEYMAP, the handler that takes Ctrl+K / Ctrl+N / ?, and a few written out by hand. When a key is bound
// and not listed, this fails, so the window cannot fall behind the app.
import fs from 'fs';

const src = fs.readFileSync(new URL('../app-v2.js', import.meta.url), 'utf8');
let failed = 0;
const ok = (cond, msg) => { if (!cond) { failed++; console.error('FAIL  ' + msg); } };

// what the window lists
const listed = new Set();
const actions = src.match(/const _Actions = \(\(\) => \{([\s\S]*?)\n  \];/);
ok(actions, 'could not find _Actions.list');
for (const m of (actions ? actions[1] : '').matchAll(/\b(?:kbd|alt):'([^']+)'/g)) listed.add(m[1]);
const extra = src.match(/const EXTRA = \[([\s\S]*?)\n  \];/);
ok(extra, 'could not find the EXTRA list of the shortcuts window');
for (const m of (extra ? extra[1] : '').matchAll(/\b(?:kbd|alt):'([^']+)'/g)) listed.add(m[1]);

// every key in _KEYMAP
const km = src.match(/const _KEYMAP = \{([\s\S]*?)\n  \};/);
ok(km, 'could not find _KEYMAP');
const keymapKeys = [...(km ? km[1] : '').matchAll(/^\s*'([^']+)':/gm)].map(m => m[1]);
ok(keymapKeys.length >= 10, `_KEYMAP looks short (${keymapKeys.length} keys)`);
for (const k of keymapKeys) ok(listed.has(k), `_KEYMAP binds ${k}, the shortcuts window does not list it`);

// the keys written out by hand in the handlers (each is checked to still be there, then to be listed)
const byHand = [
  ['Ctrl+K', /e\.key === 'k' \|\| e\.key === 'K'/], ['F1', /e\.key === 'F1'/], ['Ctrl+,', /e\.key === ','/], ['Ctrl+N', /e\.key === 'n' \|\| e\.key === 'N'/],
  ['Ctrl+O', /e\.key === 'o' \|\| e\.key === 'O'/], ['Ctrl+Shift+O', /e\.shiftKey && \(e\.key === 'o' \|\| e\.key === 'O'\)/],
  ['Ctrl+S', /e\.key === 's' \|\| e\.key === 'S'/], ['Ctrl+;', /e\.key === ';'/], ['?', /e\.key === '\?'/], ['F2', /e\.key === 'F2'/],
  ['Ctrl+Z', /e\.key\.toLowerCase\(\) === 'z'/], ['Ctrl+Shift+Z', /e\.shiftKey && e\.key\.toLowerCase\(\) === 'z'/], ['Ctrl+Y', /e\.key\.toLowerCase\(\) === 'y'/],
  ['Ctrl+A', /e\.key === 'a' \|\| e\.key === 'A'/], ['Ctrl+C', /e\.key === 'c' \|\| e\.key === 'C'/], ['Ctrl+V', /e\.key === 'v' \|\| e\.key === 'V'/],
  ['Ctrl+D', /e\.key === 'd' \|\| e\.key === 'D'/], ['Ctrl+G', /e\.key === 'g' \|\| e\.key === 'G'/], ['G', /plain && !e\.shiftKey && \(e\.key === 'g'/],
  ['E', /e\.key === 'e' \|\| e\.key === 'E'/], ['R', /e\.key === 'r' \|\| e\.key === 'R'/], ['T', /e\.key === 't' \|\| e\.key === 'T'/], ['Q', /e\.key === 'q' \|\| e\.key === 'Q'/],
  ['F', /e\.key === 'f' \|\| e\.key === 'F'/], ['Del', /e\.key === 'Delete'/], ['Backspace', /e\.key === 'Backspace'/], ['Esc', /e\.key === 'Escape'/],
  ['1', /e\.key === '1' && !e\.ctrlKey/], ['2', /e\.key === '2' && !e\.ctrlKey/], ['3', /e\.key === '3' && !e\.ctrlKey/],
  ['Ctrl+1', /\['1', '2', '3', '4'\]|e\.key === '1' \|\| e\.key === '2'/],
];
for (const [combo, re] of byHand) {
  ok(re.test(src), `the check for ${combo} no longer finds its handler: update tests/shortcuts.test.mjs`);
  ok(listed.has(combo) || (combo === 'Ctrl+1' && listed.has('Ctrl+1')), `${combo} is bound by hand and not listed`);
}
// the keys 4 and 5 are bound in the shading handlers added later
ok(listed.has('4') && listed.has('5') && listed.has('6'), 'the shading keys 4, 5 and 6 are not listed');
ok(/e\.key === '6'/.test(src), 'the key 6 (CAD view) has no handler');

console.log(failed ? `${failed} problem${failed === 1 ? '' : 's'}` : `ok: ${listed.size} bindings listed, ${keymapKeys.length} in _KEYMAP, ${byHand.length} by hand`);
process.exit(failed ? 1 : 0);
