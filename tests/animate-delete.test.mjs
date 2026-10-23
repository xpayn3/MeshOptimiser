// node tests/animate-delete.test.mjs — Animate keeps the record of a deleted part, so an undo of the delete brings it back moving.
//
// Source-level (the app needs a browser): checks the pieces that keep this fixed.
//   1. applyRec answers −1 (nothing moved, keep the record) for a part that exists but is deleted, 0 only for one that is gone;
//      a group whose members are all deleted waits for them the same way;
//   2. applyAll drops a record only on 0;
//   3. dropRec puts a deleted part's hidden mesh back to rest too, so the undo of the delete finds it there.
import fs from 'fs';

const src = ['app.js', 'anim.js'].map(f => fs.readFileSync(new URL('../app/js/' + f, import.meta.url), 'utf8')).join('\n');      // (Animate is in anim.js since 2026-10-23)
let failed = 0;
const ok = (cond, msg) => { if (!cond) { failed++; console.error('FAIL  ' + msg); } };
const body = (re, name) => { const m = src.match(re); ok(m, 'could not find ' + name); return m ? m[0] : ''; };

const rec = body(/  function applyRec\(rec\) \{[\s\S]*?\n  \}\r?\n/, 'applyRec');
ok(/const p = live\(rec\.partId\); if \(!p\) return getPart\(rec\.partId\) \? -1 : 0;/.test(rec), 'a deleted part keeps its record (−1), a part that is gone drops it (0)');
ok(/if \(!p\) \{ if \(getPart\(id\)\) gone\+\+; continue; \}/.test(rec) && /return n \|\| \(gone \? -1 : 0\);/.test(rec), 'a group whose members are deleted waits for them');
const all = body(/  function applyAll\(recs\) \{[\s\S]*?\n  \}\r?\n/, 'applyAll');
ok(/if \(k === 0\) items\.delete\(rec\.key\); else if \(k > 0\) n \+= k;/.test(all), 'applyAll drops a record only when nothing is left to move');
const drop = body(/  function dropRec\(rec\) \{[^\n]*/, 'dropRec');
ok(/const p = getPart\(id\); if \(p && p\.mesh\) place\(p\.mesh, restE\(id, rec\)\);/.test(drop), 'dropRec puts a deleted part back to rest as well');

if (failed) { console.error(failed + ' check(s) failed'); process.exit(1); }
console.log('animate-delete: all checks passed');
