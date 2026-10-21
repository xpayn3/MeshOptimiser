// node tests/explode-undo.test.mjs — undo, redo and an exploded view stay in step.
//
// Source-level (the app needs a browser): checks the pieces that keep these fixed.
//   1. undo / redo put an exploded view back together first (the sliders go to 0), and re-measure the rest positions after;
//   2. a held Ctrl+Z / Ctrl+Y does one step per press (key repeat froze the page);
//   3. a deleted part moves with the exploded view (applyExplode / resetExplode do not skip deleted meshes), and the delete
//      records whether the view was exploded so its undo can put an instance back at rest.
import fs from 'fs';

const src = fs.readFileSync(new URL('../app/js/app.js', import.meta.url), 'utf8');
let failed = 0;
const ok = (cond, msg) => { if (!cond) { failed++; console.error('FAIL  ' + msg); } };
const body = (re, name) => { const m = src.match(re); ok(m, 'could not find ' + name); return m ? m[0] : ''; };

// 1. the outermost undo / redo wrapper
const wrap = body(/const _undoOne = undoLast, _redoOne = redoLast;[\s\S]*?function _explodeRestMoved\(\)[^\n]*/, 'the outermost undo / redo wrapper');
ok(/undoLast = function[\s\S]*?_explodeSettle\(\);[\s\S]*?_undoOne\.apply[\s\S]*?_explodeRestMoved\(\);/.test(wrap), 'undo settles the exploded view before, and re-measures after');
ok(/redoLast = function[\s\S]*?_explodeSettle\(\);[\s\S]*?_redoOne\.apply[\s\S]*?_explodeRestMoved\(\);/.test(wrap), 'redo settles the exploded view before, and re-measures after');
ok(/function _explodeSettle\(\)[\s\S]*?resetExplode\(\)/.test(wrap), '_explodeSettle calls resetExplode');
ok(/function _explodeRestMoved\(\)[\s\S]*?invalidateExplodeBaseline\(\)/.test(wrap), '_explodeRestMoved invalidates the baseline');

// 2. key repeat
ok(src.includes("e.key.toLowerCase() === 'z') { e.preventDefault(); if (!e.repeat) undoLast();"), 'Ctrl+Z ignores key repeat');
ok(src.includes("e.key.toLowerCase() === 'y') { e.preventDefault(); if (!e.repeat) redoLast();"), 'Ctrl+Y ignores key repeat');
ok(/e\.shiftKey && e\.key\.toLowerCase\(\) === 'z'\) \{ e\.preventDefault\(\); if \(!e\.repeat\) redoLast\(\);/.test(src), 'Ctrl+Shift+Z ignores key repeat');

// 3. deleted parts follow the view
const apply = body(/function applyExplode\(\) \{[\s\S]*?\r?\n\}\r?\n/, 'applyExplode');
ok(/\(p\.deleted && !p\.mesh\) \|\| !p\._partCenter\) continue;/.test(apply), 'applyExplode moves a deleted mesh (skips only deleted instances)');
ok(!/if \(p\.deleted \|\| !p\._partCenter\) continue;/.test(apply), 'applyExplode no longer skips every deleted part');
const reset = body(/function resetExplode\(\) \{[\s\S]*?\r?\n\}\r?\n/, 'resetExplode');
ok(/if \(p\.deleted && !p\.mesh\) continue;/.test(reset), 'resetExplode puts a deleted mesh back (skips only deleted instances)');
ok(!/for \(const p of state\.parts\) \{\s*if \(p\.deleted\) continue;\s*if \(p\.mesh && p\._origWorldPos\)/.test(reset), 'resetExplode no longer skips every deleted part');
ok(/pushUndo\(\{ type: 'delete', items: hidden, label, groups, removedGroups, wasExploded:/.test(src), 'a delete records whether the view was exploded');
const del = body(/_UndoOps\.register\('delete', \{\s*undo\(op\) \{[\s\S]*?\n  redo\(op\)/, 'the delete undo handler');
ok(/op\.wasExploded && p && p\.instancedMesh && p\._instOrigMat/.test(del) && /if \(exploded\) applyExplode\(\)/.test(del), 'undoing a delete puts an instance back at rest, or where the view has it');

// 4. tools that change what a part's rest position is put the view together first and explode it again after
const settled = body(/function _settledView\(fn\) \{[\s\S]*?\n\}\r?\n/, '_settledView');
ok(/if \(was\) \{ try \{ resetExplode\(\); \} catch \(_\) \{\} \}/.test(settled) && /state\._explodeBaselineDone = false;[\s\S]*?state\.explode = ex;[\s\S]*?applyExplode\(\);/.test(settled), '_settledView puts the view back, runs, and explodes again');
ok(/async function mergeSelectedIntoOne_job\((\w*)\) \{ return _settledView\(\(\) => _mergeSelectedCore\(\1\)\); \}/.test(src), 'Merge runs with the view together');      // (name: Merge by group names the part after its group)
ok(/function splitSelectedParts\(epsRel, method\) \{[\s\S]*?return _settledView\(\(\) => _splitSelectedPartsCore\(epsRel, method\)\);/.test(src), 'Split runs with the view together');
const flat = body(/async function flattenTree_job\(preset\) \{[\s\S]*?\n\}\r?\n/, 'flattenTree_job');
ok(/return _settledView\(\(\) => _flattenTreeCore\(opts\)\)/.test(flat), 'Flatten runs with the view together once its dialog is answered');
// 5. the export bakes the animation while the parts are together, in the same call that builds the file
const exp = body(/const \{ root, count, meshByPart, postMat: _postMat, settingsOut: _settingsOut \} = _whileTogether\(\(\) => \{[\s\S]*?\n  \}\);/, 'the export root call');
ok(/_clip = _animationClipForExport\(r\.meshByPart, r\.postMat, r\.settingsOut\)/.test(exp), 'the animation clip is baked inside _whileTogether');

if (failed) { console.error(failed + ' check(s) failed'); process.exit(1); }
console.log('explode-undo: all checks passed');
