// node tests/undo-redo.test.mjs — the undo history keeps the user's steps, whatever is undone and redone.
//
// The app needs a browser, so the pieces that matter are taken out of app.js and run here on a small stand-in scene:
//   1. a compound step (one call of Claude's) takes only its own entries off the stacks: a step inside that cannot be redone (Split)
//      or that is handled by a module's hook (the cloner) no longer takes an older step of the user's with it;
//   2. an undo that cannot be redone drops the redo steps that were made on top of it;
//   3. the redo of a duplicate brings back the same copies (same ids), so a redo step made on a copy (a move) still works;
// and, read from the source, the guards around them (gizmo drag, the material editor's pending edit, Smart fit's late redo,
// compare_images and Claude's undo / redo counting the steps really taken back).
import fs from 'fs';

const src = fs.readFileSync(new URL('../app/js/app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
let failed = 0;
const ok = (cond, msg) => { if (!cond) { failed++; console.error('FAIL  ' + msg); } };
const take = (re, name) => { const m = src.match(re); ok(m, 'could not find ' + name); return m ? m[0] : ''; };

const pieces = [
  take(/const _UndoOps = \(\(\) => \{[\s\S]*?\n\}\)\(\);/, '_UndoOps'),
  take(/function undoLast\(\) \{[\s\S]*?\n\}\n/, 'undoLast'),
  take(/function _dropRedo\(\) \{[\s\S]*?\nfunction redoLast\(\) \{[\s\S]*?\n\}\n/, '_dropRedo and redoLast'),
  take(/  const _compoundSub = [\s\S]*?\n  _UndoOps\.register\('compound', \{[\s\S]*?\n  \}\);/, 'the compound handler'),
  take(/function _stashOut\([\s\S]*?\n(?=function _clonePart)/, '_stashOut / _stashIn'),
  take(/_UndoOps\.register\('duplicate', \{[\s\S]*?\n\}\);/, 'the duplicate handler'),
];

function scene() {
  const state = { history: [], redo: [], parts: [], partById: new Map(), treeNodes: [], userGroups: [], selected: new Set() };
  const window = { _appHooks: { undoHandlers: [], redoHandlers: [] } };
  const env = {
    state, window,
    _finalizeUndo() {}, _refreshUndoRedoButtons() {}, requestRender() {}, toast() {}, _geomSweepSoon() {}, recomputeStats() {},
    $: () => ({ textContent: '' }),
    getPart: (id) => state.partById.get(id),
    _clonePart: () => { throw new Error('the redo made a new copy instead of bringing the old one back'); },
    console: { warn() {}, log: console.log },
  };
  const names = Object.keys(env);
  const body = 'let _undoKeepAll = false;\n' + pieces.join('\n') + '\nreturn { _UndoOps, undoLast, redoLast };';
  const api = new Function(...names, body)(...names.map(k => env[k]));
  // a stand-in scene: parts with an x, a move step, and Split (undone for good, no redo)
  const group = { children: [], add(o) { o.parent = this; this.children.push(o); }, remove(o) { this.children = this.children.filter(c => c !== o); o.parent = null; } };
  const part = (id) => { const p = { partId: id, x: 0, mesh: { parent: null } }; group.add(p.mesh); state.parts.push(p); state.partById.set(id, p); state.treeNodes.push({ kind: 'part', partId: id }); return p; };
  api._UndoOps.register('move', {
    undo(op) { const p = env.getPart(op.partId); if (!p) return false; p.x = op.before; state.redo.push(op); },
    redo(op) { const p = env.getPart(op.partId); if (!p) return false; p.x = op.after; state.history.push(op); },
  });
  api._UndoOps.register('split', { undo(op) { op.undone = true; } });
  return { ...api, state, window, part };
}
const move = (p, to) => { const op = { type: 'move', partId: p.partId, before: p.x, after: to }; p.x = to; return op; };

// 1a. a compound with Split inside: the user's older step stays, and nothing redoes it by mistake
{
  const s = scene(); const a = s.part(1), b = s.part(2);
  const A = move(a, 5), sp = { type: 'split' }, mb = move(b, 7), X = move(a, 9);
  s.state.history.push(A, { type: 'compound', ops: [sp, mb] }, X);
  s.undoLast();                                         // X
  s.undoLast();                                         // the compound
  ok(s.state.history.length === 1 && s.state.history[0] === A, 'compound undo keeps the step under it (got ' + s.state.history.length + ' steps)');
  ok(sp.undone && b.x === 0, 'every step in the compound was undone');
  ok(s.state.redo.length === 0, 'a compound that cannot be redone drops the redo steps above it');
  ok(a.x === 5, 'the user\'s older step is still in effect');
  s.undoLast();
  ok(a.x === 0 && s.state.history.length === 0, 'and can still be undone');
}
// 1b. a compound that can be redone: redo puts back only its own steps, the user's redo steps stay
{
  const s = scene(); const a = s.part(1), b = s.part(2);
  const A = move(a, 1), m1 = move(a, 2), m2 = move(b, 3), X = move(b, 4);
  const C = { type: 'compound', ops: [m1, m2] };
  s.state.history.push(A, C, X);
  s.undoLast(); s.undoLast();
  ok(s.state.redo.length === 2 && s.state.redo[1] === C && s.state.redo[0] === X, 'undo of a compound leaves [X, compound] to redo');
  ok(a.x === 1 && b.x === 0, 'the compound was undone');
  s.redoLast();
  ok(s.state.history.length === 2 && s.state.history[0] === A && s.state.history[1] === C, 'redo of a compound puts back only the compound (got ' + s.state.history.map(o => o.type).join(',') + ')');
  ok(s.state.redo.length === 1 && s.state.redo[0] === X, 'the user\'s redo step stays');
  ok(a.x === 2 && b.x === 3, 'the compound was redone');
  s.redoLast();
  ok(b.x === 4 && s.state.redo.length === 0, 'and the next redo is the user\'s step');
}
// 1c. a step inside a compound handled by a module's hook (the cloner) is undone too, and pops only itself
{
  const s = scene(); const a = s.part(1);
  const A = move(a, 1), hooked = { type: 'clonerParams', v: 'after' }, Y = move(a, 2);
  s.window._appHooks.undoHandlers.push((op) => { if (op.type !== 'clonerParams') return false; s.state.history.pop(); op.v = 'before'; s.state.redo.push(op); return true; });
  s.window._appHooks.redoHandlers.push((op) => { if (op.type !== 'clonerParams') return false; s.state.redo.pop(); op.v = 'after'; s.state.history.push(op); return true; });
  s.state.history.push(A, { type: 'compound', ops: [hooked, Y] });
  s.undoLast();
  ok(hooked.v === 'before' && a.x === 1, 'a hooked step inside a compound is undone');
  ok(s.state.history.length === 1 && s.state.history[0] === A, 'the hooked step took no older step with it');
  s.redoLast();
  ok(hooked.v === 'after' && a.x === 2 && s.state.history.length === 2, 'and redone');
}
// 2. Split undone for good: the redo steps above it go too
{
  const s = scene(); const a = s.part(1);
  const sp = { type: 'split' }, M = move(a, 3);
  s.state.history.push(sp, M);
  s.undoLast(); s.undoLast();
  ok(s.state.redo.length === 0, 'undoing Split drops the redo steps made on its parts');
}
// 3. duplicate: redo brings the same copy back, and the move of the copy can be redone
{
  const s = scene(); s.part(1); const copy = s.part(2);
  const dup = { type: 'duplicate', partIds: [2], sourceIds: [1] }, M = move(copy, 6);
  s.state.history.push(dup, M);
  s.undoLast(); s.undoLast();
  ok(!s.state.partById.has(2) && !s.state.parts.includes(copy) && copy.mesh.parent === null, 'undo of a duplicate takes the copy out');
  s.redoLast();
  ok(s.state.partById.get(2) === copy && s.state.parts[1] === copy && copy.mesh.parent, 'redo brings the same copy back (same id, same place)');
  ok(s.state.treeNodes.some(n => n.partId === 2), 'with its row in the tree');
  s.redoLast();
  ok(copy.x === 6 && s.state.redo.length === 0, 'the move of the copy is redone (it used to be dropped)');
}

// ── the guards around them, read from the source ──
const wrap = take(/const _undoOne = undoLast, _redoOne = redoLast;[\s\S]*?function _explodeRestMoved\(\)/, 'the outermost undo / redo wrapper');
ok(/undoLast = function[\s\S]*?if \(_dragging\(\)\)[\s\S]*?redoLast = function[\s\S]*?if \(_dragging\(\)\)/.test(wrap), 'undo and redo wait for the gizmo to be let go');
ok(/redoLast = function[\s\S]*?_flushMatEditor\(\);[\s\S]*?_redoOne\.apply/.test(wrap), 'redo records the material editor\'s pending edit first');
ok(/nxt\.auto[\s\S]*?if \(_Tasks\.busy\(\)\) break;/.test(wrap), 'the auto loop of redo waits for a job that is still redoing');
ok(/asyncRedo: true,\n\}\);/.test(take(/_UndoOps\.register\('boxify', \{[\s\S]*?\n\}\);/, 'the boxify handler')), 'Smart fit\'s redo says it finishes later');
ok(src.includes("find(o => !_UndoOps.canRedo(o, true))"), 'compare_images checks every step it walks back with canRedo');
ok(/while \(state\.history\.length > stop\) \{ const len = state\.history\.length; await undoLast\(\);[^\n]*if \(state\.history\.length >= len\) break; undone\+\+; \}/.test(src), 'compare_images counts the steps really undone');
ok(/async undo\(a\) \{[\s\S]*?if \(state\.history\.length >= len\) break;/.test(src), 'Claude\'s undo counts only the steps taken back');
ok(/async redo\(a\) \{[\s\S]*?if \(state\.redo\.length >= len\) break;/.test(src), 'Claude\'s redo counts only the steps done again');
ok(/function _purgeDropped\(op\)[\s\S]*?op\.type === 'compound'/.test(src) && /while \(state\.history\.length > 1 && state\.history\[0\]\.auto\)/.test(src), 'the far end of the history frees deletes in a compound and drops an auto step left alone');
ok(/function _uiSliderSet\(id, v\) \{[\s\S]*?_uiSliderLast\.set\(id, el\.value\);/.test(src) && src.includes('const last = _uiSliderLast;'), 'a slider set by undo is the baseline of its next change');

if (failed) { console.error(failed + ' check(s) failed'); process.exit(1); }
console.log('undo-redo: all checks passed');
