// MeshOptimiser self-test — a regression suite that runs inside the live app.
//
// Open  http://localhost:4242/?selftest          to run everything
//       http://localhost:4242/?selftest=groups   to run tests whose name contains "groups"
//
// Each test starts from an empty scene, drives the app the way a user would
// (tree clicks, toolbar actions, context menu, dialogs) and compares the
// result with what should have happened. Nothing is downloaded: exports and
// Save scene are captured in memory. Results appear in a panel at the bottom
// right, in the console, and on window.__selftest for automation.
//
// The suite exists because of a class of bug that is invisible in normal
// use: an action that works, but whose undo, export or saved file is wrong.
// Add a test here whenever such a bug is fixed.
(() => {
  'use strict';
  const T = {};            // helpers
  const tests = [];
  const test = (name, fn) => tests.push({ name, fn });

  // ── plumbing ──────────────────────────────────────────────────────────
  T.sleep = (ms) => new Promise(r => setTimeout(r, ms));
  T.F = () => window._appFns;
  T.act = (id) => T.F()._Actions.list.find(a => a.id === id).run();
  T.live = () => state.parts.filter(p => !p.deleted);
  T.part = (name) => state.parts.find(p => p.name === name && !p.deleted);
  T.rows = () => [...document.querySelectorAll('#tree .tree-node')].filter(n => !n.classList.contains('is-hidden') && n.offsetHeight > 0);
  T.label = (n) => (n.querySelector('.tree-label')?.textContent || '').trim();
  T.row = (name) => T.rows().find(n => T.label(n) === name);
  T.tree = () => T.rows().map(n => '  '.repeat(+n.dataset.depth || 0) + (n.classList.contains('is-group') ? '[G] ' : '') + T.label(n)).join('\n');
  T.undo = async () => { T.F().undoLast(); await T.sleep(350); };
  T.redo = async () => { T.F().redoLast(); await T.sleep(350); };
  T.errors = [];

  // Confirm dialogs: press the OK button if one shows up.
  T.ok = async () => {
    for (let i = 0; i < 10; i++) {
      const b = [...document.querySelectorAll('.dlg-btn-ok')].find(x => x.offsetParent);
      if (b) { b.click(); await T.sleep(150); return true; }
      await T.sleep(50);
    }
    return false;
  };
  T.pick = async (names) => {
    T.act('selClear'); await T.sleep(80);
    names.forEach((nm, k) => {
      const r = T.row(nm);
      if (!r) throw new Error('no tree row named "' + nm + '"');
      r.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: k > 0 }));
    });
    await T.sleep(250);
  };
  T.group = async (names) => { await T.pick(names); T.act('group'); await T.sleep(450); };
  T.ctx = async (name, label) => {
    const r = T.row(name);
    if (!r) throw new Error('no tree row named "' + name + '"');
    const b = r.getBoundingClientRect();
    r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.left + 40, clientY: b.top + 8, button: 2 }));
    await T.sleep(200);
    const it = [...document.querySelectorAll('#ctx-menu .ctx-menu-row')].find(x => x.textContent.trim().startsWith(label));
    if (!it) throw new Error('no "' + label + '" in the context menu of ' + name);
    it.click();
    await T.sleep(350);
  };
  // Start from an empty scene with the given primitives.
  T.fresh = async (kinds = []) => {
    window.__moNoTabs = true;            // the suite works in one scene; the tabs test lifts this itself
    document.getElementById('welcome-start-empty')?.offsetParent && document.getElementById('welcome-start-empty').click();
    await T.sleep(150);
    T.act('newscene'); await T.sleep(250); await T.ok(); await T.sleep(400);
    document.getElementById('welcome-close')?.offsetParent && document.getElementById('welcome-close').click();
    for (const k of kinds) await Promise.race([Promise.resolve(window._addPrimitive(k)), T.sleep(2000)]);
    await T.sleep(350);
    T.act('selClear'); await T.sleep(150);
  };
  // World-space fingerprint of every mesh part: a tool that must not move
  // anything on screen has to leave this unchanged.
  T.world = () => {
    const THREE = T.F().THREE, v = new THREE.Vector3();
    return T.live().filter(p => p.mesh && p.mesh.geometry?.attributes?.position).map(p => {
      p.mesh.updateWorldMatrix(true, false);
      const a = p.mesh.geometry.attributes.position;
      let s = 0; const step = Math.max(1, Math.floor(a.count / 120));
      // weighted by vertex index, so a rotation about the part's own centre shows up too
      for (let i = 0; i < a.count; i += step) { v.fromBufferAttribute(a, i).applyMatrix4(p.mesh.matrixWorld); s += (v.x * 1.3 + v.y * 2.7 + v.z * 3.1) * ((i % 7) + 1); }
      return p.name + '=' + s.toFixed(0);
    }).sort().join(' ');
  };
  // Everything a correct undo must restore.
  T.sig = () => {
    const L = T.live();
    return JSON.stringify({
      n: L.length, tris: L.reduce((a, p) => a + (p.triCount || 0), 0), vis: L.filter(p => p.visible).length,
      world: T.world(), tree: T.tree(),
    });
  };
  // Run an action and check that it is undoable and redoable.
  T.undoable = async (label, fn, { wait = 600, mustChange = true, redo = true } = {}) => {
    const h0 = state.history.length, before = T.sig();
    await fn(); await T.ok(); await T.sleep(wait);
    const after = T.sig();
    if (mustChange) T.assert(after !== before, label + ': nothing changed');
    if (after === before) return;
    T.assert(state.history.length > h0, label + ': changed the scene but pushed no undo entry');
    await T.undo();
    T.assert(T.sig() === before, label + ': undo did not restore the scene');
    if (redo) { await T.redo(); T.assert(T.sig() === after, label + ': redo did not re-apply the action'); }
  };
  T.assert = (cond, msg) => { if (!cond) throw new Error(msg); };
  T.eq = (got, want, msg) => { if (got !== want) throw new Error(msg + '\n      expected: ' + JSON.stringify(want) + '\n      got:      ' + JSON.stringify(got)); };

  // ── exports are captured, never downloaded ───────────────────────────
  T.blobs = [];
  T.capture = () => {
    if (T._cap) return;
    T._cap = true;
    window.showSaveFilePicker = undefined;
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function (b) { if (b instanceof Blob && !(b.type || '').includes('javascript')) T.blobs.push(b); return orig(b); };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { if (this.hasAttribute('download')) { T.lastDownload = this.getAttribute('download'); return; } return click.call(this); };
  };
  T.exportAs = async (fmt, maxMs = 20000) => {
    T.capture(); T.blobs.length = 0;
    const t0 = performance.now();
    document.getElementById('btn-export').click(); await T.sleep(300);
    const menu = [...document.querySelectorAll('.export-menu-item[data-fmt="' + fmt + '"]')].find(x => x.offsetParent);
    if (menu) { menu.click(); await T.sleep(400); }
    const card = document.querySelector('.fmt-card[data-fmt="' + fmt + '"]');
    if (card && card.offsetParent) { card.click(); await T.sleep(200); }
    const go = document.getElementById('export-confirm');
    if (go && go.offsetParent) go.click();
    while (!T.blobs.length && performance.now() - t0 < maxMs) await T.sleep(200);
    await T.sleep(500);
    T.assert(T.blobs.length > 0, fmt.toUpperCase() + ' export produced no file');
    T.assert(!document.getElementById('loader')?.offsetParent, fmt.toUpperCase() + ' export left the loader on screen');
    return T.blobs[T.blobs.length - 1];
  };
  T.gltf = async () => {
    await T.exportAs('gltf');
    const blob = T.blobs.find(b => (b.type || '').includes('json')) || T.blobs[0];
    return JSON.parse(await blob.text());
  };
  // mesh node name → world translation, from an exported glTF
  T.gltfNodes = (j) => {
    const out = {};
    const walk = (i, off) => {
      const n = j.nodes[i], m = n.matrix;
      const t = n.translation || (m ? [m[12], m[13], m[14]] : [0, 0, 0]);
      const w = [off[0] + t[0], off[1] + t[1], off[2] + t[2]];
      if (n.mesh !== undefined) out[n.name] = w.map(x => Math.round(x));
      (n.children || []).forEach(c => walk(c, w));
    };
    j.scenes[0].nodes.forEach(i => walk(i, [0, 0, 0]));
    return out;
  };
  T.saveScene = async () => {
    T.capture(); T.blobs.length = 0;
    T.act('savescene'); await T.sleep(500);
    document.getElementById('save-scene-confirm')?.click();
    const t0 = performance.now();
    while (!T.blobs.length && performance.now() - t0 < 20000) await T.sleep(200);
    await T.sleep(500);
    T.assert(T.blobs.length > 0, 'Save scene produced no file');
    return T.blobs[T.blobs.length - 1];
  };
  T.dropFile = async (blob, name, { append = false } = {}) => {
    const file = new File([blob], name, { type: blob.type || 'model/gltf-binary' });
    const dt = new DataTransfer(); dt.items.add(file);
    const before = state.parts.length;
    if (append) state._importMode = true;
    document.getElementById('viewport').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    const t0 = performance.now();
    while (performance.now() - t0 < 25000) {
      const l = document.getElementById('loader');
      if (state.parts.length > (append ? before : 0) && !(l && l.offsetParent)) break;
      await T.sleep(300);
    }
    await T.sleep(1200);
  };
  T.flatten = async (mode, { preserve = null, scopeRow = null } = {}) => {
    T.act('selClear'); await T.sleep(150);
    if (scopeRow) { T.row(scopeRow).click(); await T.sleep(250); }
    document.getElementById('tree-flatten').click(); await T.sleep(400);
    const d = document.getElementById('_flat-dialog');
    const r = d.querySelector('input[name=flat-mode][value=' + mode + ']');
    r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true }));
    const pu = d.querySelector('#_flat-preserve-ug');
    if (preserve !== null && pu.checked !== preserve) { pu.checked = preserve; pu.dispatchEvent(new Event('change', { bubbles: true })); }
    await T.sleep(150);
    d.querySelector('#_flat-ok').click(); await T.sleep(300); await T.ok(); await T.sleep(600);
  };
  // The transform panel wires its inputs the first time it is opened.
  T.openTransformPanel = async () => {
    const panel = document.getElementById('transform-panel');
    if (panel && !panel.classList.contains('show')) { document.getElementById('tg-transform')?.click(); await T.sleep(300); }
  };
  T.typeInto = async (id, value) => {
    await T.openTransformPanel();
    const el = document.getElementById(id);
    T.assert(el && !el.disabled, 'input #' + id + ' is not available');
    el.value = String(value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await T.sleep(400);
  };
  // Give a part a transform the way a user would: select it, type into the panel.
  T.move = async (name, x, y, z) => {
    await T.pick([name]);
    await T.typeInto('tform-px', x); await T.typeInto('tform-py', y); await T.typeInto('tform-pz', z);
    T.act('selClear'); await T.sleep(250);
  };

  // ══════════════════════════════ tests ═════════════════════════════════

  test('primitives: every shape adds one part and one row', async () => {
    const kinds = ['cube', 'sphere', 'cylinder', 'cone', 'torus', 'plane', 'capsule'];
    await T.fresh(kinds);
    T.eq(T.live().length, kinds.length, 'part count');
    T.eq(T.rows().length, kinds.length, 'tree rows');
    T.eq(document.getElementById('tree-summary').textContent, kinds.length + ' parts in hierarchy', 'summary');
    await Promise.race([Promise.resolve(window._addPrimitive('torus')), T.sleep(2000)]); await T.sleep(300);
    const selRows = T.rows().filter(r => r.classList.contains('selected')).map(T.label);
    T.eq(selRows.join(','), 'Torus.001', 'the tree highlights the part that was just added');
    await T.fresh(['cube']);
    T.eq(document.getElementById('tree-summary').textContent, '1 part in hierarchy', 'singular summary');
  });

  test('selection: all, invert, clear, similar', async () => {
    await T.fresh(['cube', 'cube', 'sphere', 'torus']);
    T.act('selAll'); await T.sleep(200); T.eq(state.selected.size, 4, 'select all');
    T.act('selInvert'); await T.sleep(200); T.eq(state.selected.size, 0, 'invert all');
    await T.pick(['Cube']);
    document.getElementById('sel-similar').click(); await T.sleep(300);
    T.eq(state.selected.size, 2, 'select similar picks both cubes');
    T.act('selClear'); await T.sleep(150); T.eq(state.selected.size, 0, 'clear');
  });

  test('visibility: eye, isolate, hide unselected, group eye — all undoable', async () => {
    await T.fresh(['cube', 'sphere', 'torus', 'cone']);
    await T.undoable('eye icon on a part', async () => { T.row('Cube').querySelector('.tree-vis').click(); });
    T.assert(T.part('Cube').visible === false && T.part('Cube').mesh.visible === false, 'eye icon did not hide the part');
    await T.undo(); T.assert(T.part('Cube').visible === true, 'undo did not show the part again');
    await T.pick(['Sphere']);
    await T.undoable('isolate', async () => { T.act('isolate'); });
    T.eq(T.live().filter(p => p.visible).length, 1, 'isolate leaves one part visible');
    await T.undoable('show all', async () => { T.act('showAll'); });
    await T.pick(['Torus']);
    await T.undoable('hide unselected', async () => { T.act('hideUnsel'); });
    T.act('showAll'); await T.sleep(300);
    await T.group(['Cube', 'Sphere']);
    T.act('selClear'); await T.sleep(200);
    await T.undoable('eye icon on a group', async () => { T.row('Group 1').querySelector('.tree-vis').click(); });
    T.eq(T.live().filter(p => !p.visible).length, 2, 'group eye hides both members');
  });

  test('groups: group, ungroup, nest — undo and redo', async () => {
    await T.fresh(['cube', 'cube', 'cube', 'cube', 'cube']);
    await T.undoable('group two parts', () => T.group(['Cube', 'Cube.001']), { wait: 200 });
    T.eq(T.tree(), '[G] Group 1\n  Cube\n  Cube.001\nCube.002\nCube.003\nCube.004', 'grouped tree');
    await T.undoable('ungroup', () => T.ctx('Group 1', 'Ungroup'), { wait: 200 });
    await T.undo();   // back to grouped
    // nest: the group row plus a part
    T.act('selClear'); await T.sleep(80);
    T.row('Group 1').click(); await T.sleep(150);
    T.row('Cube.002').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })); await T.sleep(200);
    T.act('group'); await T.sleep(450);
    T.eq(T.tree(), '[G] Group 2\n  [G] Group 1\n    Cube\n    Cube.001\n  Cube.002\nCube.003\nCube.004', 'nested tree');
    await T.undoable('ungroup the outer group', () => T.ctx('Group 2', 'Ungroup'), { wait: 200 });
  });

  test('groups: grouping across levels uses the shared parent; names are unique', async () => {
    await T.fresh(['cube', 'cube', 'cube', 'cube']);
    await T.group(['Cube', 'Cube.001']);
    await T.group(['Cube', 'Cube.003']);          // one inside Group 1, one at the top
    T.eq(T.tree(), '[G] Group 2\n  Cube\n  Cube.003\n[G] Group 1\n  Cube.001\nCube.002', 'cross-level group');
    await T.flatten('total', { preserve: false });
    await T.group(['Cube', 'Cube.001']);
    await T.group(['Cube.002', 'Cube.003']);
    const names = T.rows().filter(r => r.classList.contains('is-group')).map(T.label);
    T.eq(new Set(names).size, names.length, 'group names are unique: ' + names.join(', '));
  });

  test('groups: a group survives its parts being selected (tree is the truth)', async () => {
    await T.fresh(['cube', 'cube', 'cube']);
    await T.group(['Cube', 'Cube.001']);
    for (const n of ['Cube', 'Cube.001', 'Group 1']) { T.row(n).click(); await T.sleep(300); }
    T.act('selClear'); await T.sleep(350);
    document.getElementById('btn-clean-empty-groups').click(); await T.sleep(300); await T.ok(); await T.sleep(400);
    T.eq(T.tree(), '[G] Group 1\n  Cube\n  Cube.001\nCube.002', 'Delete empty groups removed a group that has live parts');
  });

  test('groups: delete contents, tidy empty groups, undo in order', async () => {
    await T.fresh(['cube', 'cube', 'cube']);
    await T.group(['Cube', 'Cube.001']);
    const grouped = T.tree();
    await T.pick(['Cube', 'Cube.001']);
    await T.undoable('delete both members', async () => { T.act('delete'); }, { redo: true });
    T.eq(T.live().length, 1, 'two parts deleted');
    const h0 = state.history.length;
    document.getElementById('btn-clean-empty-groups').click(); await T.sleep(300); await T.ok(); await T.sleep(400);
    T.assert(state.history.length > h0, 'Delete empty groups pushed no undo entry');
    T.eq(state.treeNodes.filter(n => n.kind === 'group').length, 0, 'empty group removed');
    await T.undo(); await T.undo();
    T.eq(T.tree(), grouped, 'two undos restore the group and its parts');
    await T.undoable('delete group + contents', () => T.ctx('Group 1', 'Delete group'), { wait: 300 });
  });

  test('flatten: every mode, scoped and whole-tree, with undo/redo', async () => {
    await T.fresh(['cube', 'cube', 'cube', 'cube', 'cube', 'cube']);
    await T.group(['Cube', 'Cube.001']);
    T.act('selClear'); await T.sleep(80);
    T.row('Group 1').click(); await T.sleep(150);
    T.row('Cube.002').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })); await T.sleep(200);
    T.act('group'); await T.sleep(450);
    await T.group(['Cube.003', 'Cube.004']);
    const nested = '[G] Group 2\n  [G] Group 1\n    Cube\n    Cube.001\n  Cube.002\n[G] Group 3\n  Cube.003\n  Cube.004\nCube.005';
    T.eq(T.tree(), nested, 'setup');
    // every mesh takes a trip through the gizmo pivot first
    for (const n of ['Cube', 'Cube.001', 'Cube.002', 'Cube.003', 'Cube.004', 'Cube.005']) { T.row(n).click(); await T.sleep(220); }
    T.act('selClear'); await T.sleep(300);
    const check = async (label, mode, opts, want) => {
      await T.flatten(mode, opts);
      T.eq(T.tree(), want, label);
      await T.undo(); T.eq(T.tree(), nested, label + ' → undo');
      await T.redo(); T.eq(T.tree(), want, label + ' → redo');
      await T.undo();
    };
    await check('last level', 'last', {}, '[G] Group 2\n  Cube\n  Cube.001\n  Cube.002\nCube.003\nCube.004\nCube.005');
    await check('keep top level', 'keep', {}, '[G] Group 2\n  Cube\n  Cube.001\n  Cube.002\n[G] Group 3\n  Cube.003\n  Cube.004\nCube.005');
    await check('total', 'total', {}, 'Cube\nCube.001\nCube.002\nCube.003\nCube.004\nCube.005');
    await check('total inside one group', 'total', { scopeRow: 'Group 2' }, '[G] Group 2\n  Cube\n  Cube.001\n  Cube.002\n[G] Group 3\n  Cube.003\n  Cube.004\nCube.005');
    await check('ungroup scope', 'ungroup', { scopeRow: 'Group 2' }, '[G] Group 1\n  Cube\n  Cube.001\nCube.002\n[G] Group 3\n  Cube.003\n  Cube.004\nCube.005');
    const h0 = state.history.length;
    await T.flatten('total', { preserve: true });
    T.eq(T.tree(), nested, 'preserve-user-groups flatten must leave the tree alone');
    T.eq(state.history.length, h0, 'a flatten that changed nothing pushed an undo entry');
  });

  test('transform panel: typed values are undoable', async () => {
    await T.fresh(['cube', 'sphere']);
    await T.pick(['Cube']);
    const x0 = T.world();
    const h0 = state.history.length;
    await T.typeInto('tform-px', 250);
    T.assert(T.world() !== x0, 'typing a position did not move the part');
    T.assert(state.history.length > h0, 'typing a position pushed no undo entry');
    await T.undo(); T.eq(T.world(), x0, 'undo of a typed position');
    await T.redo(); T.assert(T.world() !== x0, 'redo of a typed position');
    await T.undo();
    await T.typeInto('tform-rz', 30);
    T.assert(T.world() !== x0, 'typing a rotation did not rotate the part');
    await T.undo(); T.eq(T.world(), x0, 'undo of a typed rotation');
  });

  test('tree drag-and-drop: a move is undoable', async () => {
    await T.fresh(['cube', 'cube', 'cube']);
    await T.group(['Cube', 'Cube.001']);
    T.act('selClear'); await T.sleep(200);
    const before = T.tree();
    const drop = T.F()._dndCommitHier;
    T.assert(typeof drop === 'function', 'drag-and-drop hook is not exposed');
    const h0 = state.history.length;
    drop([T.row('Cube.002')], { kind: 'row', row: T.row('Group 1'), intent: 'into' });
    await T.sleep(400);
    T.eq(T.tree(), '[G] Group 1\n  Cube\n  Cube.001\n  Cube.002', 'dropped into the group');
    T.assert(state.history.length > h0, 'a tree move pushed no undo entry');
    await T.undo(); T.eq(T.tree(), before, 'undo of a tree move');
    await T.redo(); T.eq(T.tree(), '[G] Group 1\n  Cube\n  Cube.001\n  Cube.002', 'redo of a tree move');
  });

  test('status messages: everyday edits stay quiet, clean-ups report', async () => {
    await T.fresh(['cube', 'cube', 'sphere']);
    const stack = document.getElementById('toasts');
    const shown = () => [...stack.querySelectorAll('.toast')].map(t => t.textContent);
    const clear = () => stack.querySelectorAll('.toast').forEach(t => t.remove());
    clear();
    // delete, duplicate, group, add a shape: no toast, but a line in the log
    const logged = () => window.Log.entries().filter(e => /^\[done\]/.test(e.msg || '')).length;
    const l0 = logged();
    await T.pick(['Cube']); T.act('delete'); await T.sleep(350);
    await T.pick(['Cube.001']); T.act('duplicate'); await T.sleep(350);
    await T.group(['Cube.001', 'Sphere']);
    await Promise.race([Promise.resolve(window._addPrimitive('cone')), T.sleep(1500)]); await T.sleep(300);
    T.eq(shown().join(' | '), '', 'an everyday edit showed a status message');
    T.assert(logged() >= l0 + 2, 'quiet messages are not kept in the log console');
    // a clean-up that finds nothing still says so, and so does one that does something
    document.getElementById('btn-clean-dupes').click(); await T.sleep(300); await T.ok(); await T.sleep(400);
    T.assert(shown().length >= 1, 'a clean-up gave no feedback at all');
    clear();
    T.F().toast('Could not read file', 'broken.glb', 'error'); T.F().toast('Careful', '', 'warn');
    T.eq(shown().length, 2, 'warnings and errors must always be shown');
    clear();
  });

  test('tree drag-and-drop: a group emptied by hand stays in the tree', async () => {
    await T.fresh(['cube', 'cube', 'cube']);
    await T.group(['Cube', 'Cube.001']);
    T.act('selClear'); await T.sleep(200);
    const drop = T.F()._dndCommitHier;
    for (const n of ['Cube.001', 'Cube']) {
      drop([T.row(n)], { kind: 'row', row: T.row('Cube.002'), intent: 'after' });
      await T.sleep(400);
    }
    const g = T.row('Group 1');
    T.assert(!!g, 'the group disappeared from the tree once its last part was dragged out');
    T.eq(+g.dataset.depth || 0, 0, 'the emptied group moved');
    T.assert(T.tree().split('\n').every(l => !l.startsWith('  ')), 'a part is still shown inside the emptied group:\n' + T.tree());
    // (the tree shows names only: an empty group is told by its dimmed name, not by a word beside it)
    T.assert(g.classList.contains('is-empty-group'), 'the emptied group is not marked as empty');
    T.assert(!g.classList.contains('hidden-vis'), 'the emptied group is drawn as hidden');
    // it still takes a drop
    drop([T.row('Cube.002')], { kind: 'row', row: T.row('Group 1'), intent: 'into' });
    await T.sleep(400);
    T.assert(T.tree().includes('[G] Group 1\n  Cube.002'), 'dropping into the emptied group failed:\n' + T.tree());
    await T.undo(); await T.undo(); await T.undo();
    T.eq(T.tree(), '[G] Group 1\n  Cube\n  Cube.001\nCube.002', 'three undos put everything back');
    const grouped = T.tree();
    // deleting the parts inside a group leaves the group, empty — nothing is hidden
    await T.pick(['Cube', 'Cube.001']); T.act('delete'); await T.sleep(450);
    T.assert(!!T.row('Group 1') && T.row('Group 1').classList.contains('is-empty-group'), 'a group whose parts were deleted is no longer listed');
    await T.undo(); T.eq(T.tree(), grouped, 'undo of deleting the parts in a group');
    // deleting the group itself removes the row too, and one undo brings back both
    T.act('selClear'); await T.sleep(150);
    T.row('Group 1').querySelector('.tree-label').dispatchEvent(new MouseEvent('click', { bubbles: true })); await T.sleep(250);
    T.act('delete'); await T.sleep(500);
    T.eq(T.tree(), 'Cube.002', 'deleting a selected group left something behind');
    await T.undo(); T.eq(T.tree(), grouped, 'one undo did not restore a deleted group with its parts');
    await T.redo(); T.eq(T.tree(), 'Cube.002', 'one redo did not delete the group and its parts again');
    await T.undo();
    await T.ctx('Group 1', 'Delete group'); await T.ok(); await T.sleep(500);
    T.eq(T.tree(), 'Cube.002', '"Delete group" left something behind');
    await T.undo(); T.eq(T.tree(), grouped, 'one undo did not restore "Delete group"');
    // "Delete empty groups" removes a group that was emptied by hand
    for (const n of ['Cube.001', 'Cube']) { drop([T.row(n)], { kind: 'row', row: T.row('Cube.002'), intent: 'after' }); await T.sleep(400); }
    document.getElementById('btn-clean-empty-groups').click(); await T.sleep(300); await T.ok(); await T.sleep(400);
    T.assert(!T.row('Group 1'), '"Delete empty groups" left an emptied group behind');
  });

  test('settings: "Delete groups when they become empty" removes them with the action', async () => {
    const P = T.F()._Prefs;
    T.assert(!!P, 'preferences are not exposed to the tests');
    try {
      await T.fresh(['cube', 'cube', 'cube']);
      await T.group(['Cube', 'Cube.001']);
      T.act('selClear'); await T.sleep(250);
      const grouped = T.tree();
      P.set('autoDeleteEmptyGroups', true);
      const drop = T.F()._dndCommitHier;
      drop([T.row('Cube.001')], { kind: 'row', row: T.row('Cube.002'), intent: 'after' }); await T.sleep(450);
      T.assert(!!T.row('Group 1'), 'a group that still holds a part was removed');
      const mid = T.tree();
      drop([T.row('Cube')], { kind: 'row', row: T.row('Cube.002'), intent: 'after' }); await T.sleep(500);
      T.assert(!T.row('Group 1'), 'the emptied group was not removed although the setting is on');
      await T.undo(); T.eq(T.tree(), mid, 'one undo did not bring back the group with the part in it');
      await T.redo(); T.assert(!T.row('Group 1'), 'redo did not remove the emptied group again');
      await T.undo(); await T.undo(); T.eq(T.tree(), grouped, 'two undos did not restore the starting tree');
      // deleting the last parts in a group counts as emptying it
      await T.pick(['Cube', 'Cube.001']); T.act('delete'); await T.sleep(500);
      T.eq(T.tree(), 'Cube.002', 'deleting the parts of a group did not remove the group with the setting on');
      await T.undo(); T.eq(T.tree(), grouped, 'one undo did not restore the parts and their group');
      // with the setting off again the group stays
      P.set('autoDeleteEmptyGroups', false);
      await T.pick(['Cube', 'Cube.001']); T.act('delete'); await T.sleep(500);
      T.assert(!!T.row('Group 1'), 'the group was removed although the setting is off');
    } finally { P.set('autoDeleteEmptyGroups', false); }
  });

  test('geometry tools: recenter, bake, center pivot, normals — undoable, nothing jumps', async () => {
    await T.fresh(['cube', 'sphere', 'cylinder', 'torus']);
    await T.move('Cylinder', 150, 40, -60);
    await T.move('Torus', -200, 10, 90);
    await T.pick(['Cylinder']);          // recenter with a live selection
    await T.undoable('recenter on origin', async () => { document.getElementById('btn-recenter').click(); });
    T.act('selClear'); await T.sleep(200);
    const w0 = T.world();
    const h0 = state.history.length;
    document.getElementById('btn-bake-transforms').click(); await T.sleep(700);
    T.eq(T.world(), w0, 'Bake transforms moved geometry on screen');
    T.assert(state.history.length > h0, 'Bake transforms pushed no undo entry');
    await T.undo(); T.eq(T.world(), w0, 'undo of Bake transforms');
    await T.redo(); T.eq(T.world(), w0, 'redo of Bake transforms');
    // shared geometry: a duplicate must not be disturbed by a pivot change on the original
    await T.pick(['Cylinder']); T.act('duplicate'); await T.sleep(450);
    await T.pick(['Cylinder']);
    const w1 = T.world();
    const h1 = state.history.length;
    document.getElementById('btn-center-pivot').click(); await T.sleep(700);
    T.eq(T.world(), w1, 'Center pivot moved geometry on screen (shared geometry?)');
    T.assert(state.history.length > h1, 'Center pivot pushed no undo entry');
    await T.undo(); T.eq(T.world(), w1, 'undo of Center pivot');
    const h2 = state.history.length;
    document.getElementById('btn-recompute-normals').click(); await T.sleep(400);
    T.assert(state.history.length > h2, 'Recompute normals pushed no undo entry');
  });

  test('edit tools: duplicate, paste, delete, merge, smart fit', async () => {
    await T.fresh(['cube', 'sphere', 'cylinder', 'torus', 'cone']);
    await T.pick(['Cube']);
    await T.undoable('duplicate', async () => { T.act('duplicate'); });
    await T.pick(['Sphere']);
    await T.undoable('copy + paste', async () => { T.act('copy'); await T.sleep(100); T.act('paste'); });
    await T.pick(['Cone']);
    await T.undoable('delete', async () => { T.act('delete'); });
    await T.pick(['Cylinder', 'Torus']);
    await T.undoable('merge', async () => { T.act('merge'); }, { wait: 900, redo: false });
    await T.pick(['Sphere']);
    // the command opens its panel; the panel's main button runs it
    await T.undoable('smart fit', async () => { T.act('smartFit'); await T.sleep(100); document.getElementById('btn-bbox-selected').click(); }, { wait: 1200 });
    T.F()._Actions && document.querySelector('.section-cmd[data-cmd="smartfit"] .cmd-close')?.click();
  });

  test('decimate: removes the share it says, keeps the part, undoes, reaches the export', async () => {
    await T.fresh(['sphere', 'torus']);
    const tri = (n) => T.part(n).triCount;
    const before = [tri('Sphere'), tri('Torus')];
    const stl0 = (await T.exportAs('stl')).size;
    await T.pick(['Sphere', 'Torus']);
    const sel = document.getElementById('decimate-strength');
    sel.value = '0.5'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    const h0 = state.history.length;
    document.getElementById('btn-decimate-sel').click(); await T.sleep(300); await T.ok(); await T.sleep(3000);
    for (const [i, n] of ['Sphere', 'Torus'].entries()) {
      const ratio = tri(n) / before[i];
      T.assert(tri(n) > 0, n + ' was reduced to zero triangles');
      T.assert(ratio > 0.35 && ratio < 0.65, n + ': −50% left ' + Math.round(ratio * 100) + '% of the triangles');
    }
    T.assert(state.history.length > h0, 'Decimate pushed no undo entry');
    const dg = T.part('Sphere').mesh.geometry;
    T.assert(!!dg.attributes.normal && !!dg.attributes.uv, 'Decimate dropped the normals or UVs');
    const stl1 = (await T.exportAs('stl')).size;
    T.assert(stl1 < stl0 * 0.7, 'the exported file did not shrink after Decimate (' + stl0 + ' → ' + stl1 + ' bytes)');
    await T.undo();
    T.eq(tri('Sphere') + '/' + tri('Torus'), before.join('/'), 'undo of Decimate');
    await T.redo();
    T.assert(tri('Sphere') < before[0], 'redo of Decimate');
  });

  test('decimate: a triangle target for the whole selection', async () => {
    await T.fresh(['sphere', 'torus']);
    const total = () => T.part('Sphere').triCount + T.part('Torus').triCount;
    const before = total();
    await T.pick(['Sphere', 'Torus']);
    const sel = document.getElementById('decimate-strength');
    sel.value = 'target'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    const want = 2000;
    document.getElementById('decimate-target').value = String(want);
    document.getElementById('btn-decimate-sel').click(); await T.sleep(300); await T.ok(); await T.sleep(3000);
    const after = total();
    T.assert(after < before, 'a triangle target did not reduce anything');
    T.assert(Math.abs(after - want) / want < 0.2, 'target ' + want + ' triangles gave ' + after);
    sel.value = '0.5'; sel.dispatchEvent(new Event('change', { bubbles: true }));
  });

  test('selection: clicking stays fast and icons are not re-rendered', async () => {
    await T.fresh(['cube', 'sphere', 'torus', 'cone', 'cylinder']);
    await T.pick(['Cube']);
    const icon = document.querySelector('#tree .tree-node .ti, #tree .tree-node svg');
    T.assert(!!icon, 'no rendered icon found in the tree');
    icon.__keep = true;
    const t0 = performance.now();
    for (const n of ['Sphere', 'Torus', 'Cone', 'Cylinder', 'Cube']) T.row(n).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const per = (performance.now() - t0) / 5;
    T.assert(per < 40, 'a selection click took ' + per.toFixed(1) + ' ms');
    await T.sleep(300);
    T.assert(document.querySelector('#tree .tree-node .ti, #tree .tree-node svg').__keep === true, 'tree icons were re-created by a selection change');
    // pressing an unselected row selects it at once, without waiting for the release
    T.act('selClear'); await T.sleep(150);
    T.row('Torus').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    T.assert(state.selected.size === 1 && state.selected.has(T.part('Torus').partId), 'pressing a tree row did not select it immediately');
    T.row('Torus').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    T.eq(state.selected.size, 1, 'the click after the press changed the selection');
    // the highlight is rebuilt before the next frame, not one frame later
    await Promise.resolve(); await Promise.resolve();
    T.assert(!!state._selMergedGeom || T.part('Torus').mesh.children.some(c => c._isPrimWireframe), 'the highlight was not built in the same turn as the selection');
  });

  test('selection: clicking a group brightens the group row only', async () => {
    await T.fresh(['cube', 'sphere', 'torus']);
    await T.group(['Cube', 'Sphere']);
    T.act('selClear'); await T.sleep(150);
    T.row('Group 1').querySelector('.tree-label').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await T.sleep(250);
    const cls = n => T.row(n).classList;
    T.assert(cls('Group 1').contains('selected'), 'the clicked group row is not highlighted');
    T.eq(state.selected.size, 2, 'clicking a group selects the parts inside it');
    for (const n of ['Cube', 'Sphere']) {
      T.assert(!cls(n).contains('selected'), n + ' is as bright as the group that was clicked');
      T.assert(cls(n).contains('ancestor-selected'), n + ' has no hint that it belongs to the clicked group');
    }
    T.assert(!cls('Torus').contains('selected') && !cls('Torus').contains('ancestor-selected'), 'a part outside the group is highlighted');
    // the same after a full tree rebuild
    T.F().rebuildTree(); await T.sleep(200);
    T.assert(cls('Group 1').contains('selected') && !cls('Cube').contains('selected') && cls('Cube').contains('ancestor-selected'), 'a tree rebuild changed which row is bright');
    // clicking a part inside the group makes that part the bright one
    T.row('Sphere').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    T.row('Sphere').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await T.sleep(250);
    T.assert(cls('Sphere').contains('selected') && !cls('Cube').contains('selected'), 'clicking a part inside a selected group did not select just that part');
    T.assert(!cls('Group 1').contains('selected'), 'the group stayed bright after one of its parts was clicked');
  });

  test('top bar: Export opens its own menu and leaves File alone', async () => {
    await T.fresh(['cube']);
    const exp = document.getElementById('btn-export'), file = document.getElementById('btn-file');
    const expWrap = exp.closest('.export-wrap'), fileWrap = file.closest('.export-wrap');
    T.assert(expWrap !== fileWrap, 'Export and File share a wrapper');
    exp.click(); await T.sleep(150);
    T.assert(document.getElementById('export-menu').classList.contains('show'), 'the Export menu did not open');
    T.assert(expWrap.classList.contains('open'), 'the Export arrow did not flip');
    T.assert(!fileWrap.classList.contains('open'), 'opening Export flipped the File arrow');
    file.click(); await T.sleep(150);
    T.assert(!document.getElementById('export-menu').classList.contains('show') && !expWrap.classList.contains('open'), 'opening File left Export open');
    T.eq(file.getAttribute('aria-expanded'), 'true', 'the File menu did not open');
    file.click(); await T.sleep(150);
    T.assert(!fileWrap.classList.contains('open') && file.getAttribute('aria-expanded') === 'false', 'the File menu did not close');
  });

  test('measure: a plain click picks; the card follows the list', async () => {
    await T.fresh(['cube']);
    T.act('fit'); await T.sleep(500);
    const card = document.getElementById('msr-list').closest('.section');
    T.assert(card.hidden, 'Measurements card should be hidden with no measurements');
    window._Measure.toggle(); await T.sleep(200);
    const cv = document.getElementById('canvas'), r = cv.getBoundingClientRect();
    const click = async (fx, fy) => {
      const o = { bubbles: true, cancelable: true, button: 0, clientX: r.left + r.width * fx, clientY: r.top + r.height * fy };
      // mouse events only: a synthetic pointer event has no real pointer
      // behind it and the camera controls reject it
      cv.dispatchEvent(new MouseEvent('mousedown', o));
      cv.dispatchEvent(new MouseEvent('mouseup', o));
      await T.sleep(300);
    };
    const sel0 = state.selected.size;
    await click(0.47, 0.47); await click(0.53, 0.55);
    T.eq(window._Measure.getSerialized().length, 1, 'two clicks make one measurement');
    T.eq(state.selected.size, sel0, 'picking a point changed the selection');
    T.assert(!card.hidden, 'Measurements card should appear once a measurement exists');
    window._Measure.clearAll(); await T.sleep(200);
    T.assert(card.hidden, 'Measurements card should hide again after Clear all');
    if (window._Measure.isActive()) window._Measure.toggle();
  });

  test('export: every format writes a file; hierarchy, hidden and deleted parts are right', async () => {
    await T.fresh(['cube', 'sphere', 'cylinder', 'torus', 'cone']);
    await T.group(['Cube', 'Sphere']);
    await T.pick(['Cone']); T.act('delete'); await T.ok(); await T.sleep(400);
    T.act('selClear'); await T.sleep(150);
    T.row('Torus').querySelector('.tree-vis').click(); await T.sleep(300);
    for (const f of ['glb', 'fbx', 'usdz', 'obj', 'stl', 'ply', 'csv']) {
      const b = await T.exportAs(f);
      T.assert(b.size > 50, f.toUpperCase() + ' export is empty');
    }
    const j = await T.gltf();
    const names = j.nodes.map(n => n.name);
    T.assert(names.includes('Group 1'), 'the group is missing from the export');
    T.assert(!names.includes('Cone'), 'a deleted part was exported');
    T.assert(!names.includes('Torus'), 'a hidden part was exported with "Visible only" on');
    T.eq(j.meshes.length, 3, 'exported mesh count');
  });

  test('export: view modes are not baked in; Recenter reaches the file', async () => {
    await T.fresh(['cube', 'cylinder']);
    await T.move('Cylinder', 180, 0, 0);
    T.act('wire'); await T.sleep(250);
    const jw = await T.gltf();
    const modes = [...new Set(jw.meshes.flatMap(m => m.primitives.map(p => p.mode === undefined ? 4 : p.mode)))];
    T.eq(modes.join(','), '4', 'wireframe view exported line primitives');
    T.eq(state.viewMode, 'wire', 'the view mode was not restored after export');
    T.act('solid'); await T.sleep(250);
    const a = T.gltfNodes(await T.gltf());
    document.getElementById('btn-recenter').click(); await T.sleep(600);
    const b = T.gltfNodes(await T.gltf());
    T.assert(JSON.stringify(a.Cylinder) !== JSON.stringify(b.Cylinder), 'the exported position did not change after Recenter');
    T.eq(a.Cylinder[0] - a.Cube[0], b.Cylinder[0] - b.Cube[0], 'Recenter changed the spacing between parts in the export');
  });

  test('export: cloner copies are written', async () => {
    await T.fresh(['cube']);
    if (!window._Cloner) return 'skipped (no cloner module)';
    await T.pick(['Cube']);
    window._Cloner.createFromSelection(); await T.sleep(900);
    T.act('selClear'); await T.sleep(300);
    const j = await T.gltf();
    const meshNodes = j.nodes.filter(n => n.mesh !== undefined);
    T.assert(meshNodes.length > 1, 'only ' + meshNodes.length + ' mesh node exported for a cloner — the copies are missing');
  });

  test('save scene: names, hierarchy and hidden parts survive two round trips', async () => {
    await T.fresh(['cube', 'sphere', 'cylinder', 'torus', 'cube']);
    await T.group(['Cube', 'Sphere']);
    T.act('selClear'); await T.sleep(80);
    T.row('Group 1').click(); await T.sleep(150);
    T.row('Cylinder').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })); await T.sleep(200);
    T.act('group'); await T.sleep(450);
    T.act('selClear'); await T.sleep(150);
    T.row('Torus').querySelector('.tree-vis').click(); await T.sleep(300);
    const want = T.tree() + ' | hidden: ' + T.live().filter(p => !p.visible).map(p => p.name).join(',');
    for (let pass = 1; pass <= 2; pass++) {
      const blob = await T.saveScene();
      T.act('newscene'); await T.sleep(250); await T.ok(); await T.sleep(400);
      await T.dropFile(blob, 'scene.glb');
      const got = T.tree() + ' | hidden: ' + T.live().filter(p => !p.visible).map(p => p.name).join(',');
      T.eq(got, want, 'round trip ' + pass);
    }
  });

  test('import → append keeps the existing tree', async () => {
    await T.fresh(['cube', 'sphere']);
    const blob = await T.exportAs('glb');
    await T.fresh(['torus', 'cone']);
    await T.group(['Torus', 'Cone']);
    T.act('selClear'); await T.sleep(150);
    const before = T.tree();
    await T.dropFile(blob, 'extra.glb', { append: true });
    const after = T.tree();
    T.assert(after.startsWith(before), 'the existing tree was not kept:\n' + after);
    T.assert(!/Untraced/.test(after), 'existing parts were moved into "Untraced"');
    T.eq(T.live().length, 4, 'part count after append');
    const ids = state.treeNodes.map(n => n.kind + ':' + n.id);
    T.eq(new Set(ids).size, ids.length, 'tree row ids are unique after append');
  });

  test('materials panel: Add (assign) is undoable', async () => {
    await T.fresh(['cube', 'sphere']);
    const btn = document.getElementById('mat-act-add');
    if (!btn) return 'skipped (no materials panel button)';
    window._populateMaterialsList?.();      // the panel wires its buttons when it is first filled
    await T.sleep(200);
    await T.pick(['Cube']);
    const m0 = T.part('Cube').mesh.material;
    const h0 = state.history.length;
    btn.click(); await T.sleep(400);
    T.assert(T.part('Cube').mesh.material !== m0, 'Add material did not assign to the selection');
    T.assert(state.history.length > h0, 'Add material pushed no undo entry');
    await T.undo();
    T.assert(T.part('Cube').mesh.material === m0, 'undo did not give the part its material back');
    await T.redo();
    T.assert(T.part('Cube').mesh.material !== m0, 'redo did not re-assign the new material');
  });

  test('delete small parts: the slider recounts on release, the button says so meanwhile', async () => {
    await T.fresh(['cube', 'sphere']);
    const range = document.querySelector('#thr-scrub .scrub-range'), btn = document.getElementById('btn-delete-small');
    if (!range || !btn) return 'skipped (no threshold slider)';
    const t0 = state.threshold, v0 = range.value;
    range.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    range.value = String(+range.value + 200); range.dispatchEvent(new Event('input', { bubbles: true }));
    await T.sleep(350);
    T.eq(state.threshold, t0, 'the threshold was applied while the slider was still held');
    T.assert(btn.disabled && btn.classList.contains('is-busy'), 'the Delete button does not show that its count is stale');
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    await T.sleep(300);
    T.assert(state.threshold !== t0, 'releasing the slider did not apply the threshold');
    T.assert(!btn.disabled && !btn.classList.contains('is-busy'), 'the Delete button stayed in its Calculating state');
    // typing-style change (no pointer): commits too, and the old value comes back
    range.value = v0; range.dispatchEvent(new Event('input', { bubbles: true })); range.dispatchEvent(new Event('change', { bubbles: true }));
    await T.sleep(300);
    T.assert(Math.abs(state.threshold - t0) < 0.05, 'a change without a drag did not commit: ' + state.threshold);
    T.assert(!btn.disabled, 'the Delete button is still disabled');
  });

  test('materials dock: slides in like the console, filters, inspects', async () => {
    await T.fresh(['cube', 'sphere']);
    const dock = document.getElementById('vp-materials-pop'), tg = document.getElementById('tg-materials');
    if (!dock || !tg) return 'skipped (no materials dock)';
    if (dock.classList.contains('show')) { tg.click(); await T.sleep(300); }
    const bar = document.querySelector('#vp-overlay .vpc.tr');
    const barBottom0 = bar.getBoundingClientRect().bottom;
    tg.click(); await T.sleep(450);
    T.assert(dock.classList.contains('show') && document.body.classList.contains('mat-dock-open'), 'the dock did not open');
    const vp = document.getElementById('viewport').getBoundingClientRect(), d = dock.getBoundingClientRect();
    T.assert(Math.abs(d.left - vp.left) < 2 && Math.abs(d.right - vp.right) < 14, 'the dock does not span the viewport: ' + [d.left, d.right, vp.left, vp.right].map(Math.round));
    T.assert(bar.getBoundingClientRect().bottom < barBottom0 - 100 && bar.getBoundingClientRect().bottom <= d.top, 'the bottom toolbar is covered by the dock');
    // a new material shows up, can be found by name, and is described in the inspector
    await T.pick(['Cube']);
    document.getElementById('mat-act-add').click(); await T.sleep(400);
    const name = T.part('Cube').mesh.material.name;
    const cells = () => [...dock.querySelectorAll('.mat-cell, .mat-row')];
    T.assert(cells().some(c => c._mat === T.part('Cube').mesh.material), 'the new material is not listed');
    T.assert(document.getElementById('mat-inspector').textContent.includes(name), 'the inspector does not show the picked material');
    T.assert(/Roughness/.test(document.getElementById('mat-inspector').textContent), 'the inspector lists no properties');
    const search = document.getElementById('mat-search');
    search.value = 'zzz-no-such-material'; search.dispatchEvent(new Event('input', { bubbles: true })); await T.sleep(250);
    T.eq(cells().length, 0, 'the filter did not narrow the list');
    T.assert(/No material matches/.test(dock.textContent), 'no message for an empty filter result');
    search.value = name.slice(0, 6); search.dispatchEvent(new Event('input', { bubbles: true })); await T.sleep(250);
    T.assert(cells().length >= 1, 'filtering by name found nothing');
    search.value = ''; search.dispatchEvent(new Event('input', { bubbles: true })); await T.sleep(250);
    // the console and the dock take turns
    document.getElementById('sb-console-btn').click(); await T.sleep(400);
    T.assert(!dock.classList.contains('show'), 'the dock stayed open under the console');
    document.getElementById('sb-console-btn').click(); await T.sleep(300);
    tg.click(); await T.sleep(350);
    document.getElementById('mat-dock-close').click(); await T.sleep(350);
    T.assert(!dock.classList.contains('show') && !document.body.classList.contains('mat-dock-open'), 'the close button did not close the dock');
    await T.undo();
  });

  test('fill holes: a recess in a flat face is closed, undo brings it back', async () => {
    await T.fresh(['cube', 'sphere']);
    const THREE = T.F().THREE, p = T.part('Cube');
    // a 17 × 17 plate with a plus-shaped recess, one quad per grid cell
    const rows = ['.....', '..#..', '.###.', '..#..', '.....'], PAD = 6, TOP = 4, D = 1.5;
    const pit = (x, y) => { const r = rows[y - PAD]; return !!r && r[x - PAD] === '#'; };
    const pos = [];
    const quad = (a, b, c, d) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    const N = rows.length + PAD * 2;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const z = pit(x, y) ? TOP - D : TOP;
      quad([x, y, z], [x + 1, y, z], [x + 1, y + 1, z], [x, y + 1, z]);
      if (!pit(x, y)) continue;
      if (!pit(x + 1, y)) quad([x + 1, y, TOP - D], [x + 1, y, TOP], [x + 1, y + 1, TOP], [x + 1, y + 1, TOP - D]);
      if (!pit(x - 1, y)) quad([x, y + 1, TOP - D], [x, y + 1, TOP], [x, y, TOP], [x, y, TOP - D]);
      if (!pit(x, y + 1)) quad([x + 1, y + 1, TOP - D], [x + 1, y + 1, TOP], [x, y + 1, TOP], [x, y + 1, TOP - D]);
      if (!pit(x, y - 1)) quad([x, y, TOP - D], [x, y, TOP], [x + 1, y, TOP], [x + 1, y, TOP - D]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
    p.mesh.geometry = g; p.hash = 'selftest_plate'; state.geomByHash.set(p.hash, g);
    p.triCount = pos.length / 9; p.vertCount = pos.length / 3;
    const tris0 = p.triCount, sphere0 = T.part('Sphere').triCount;
    const lowest = () => { const a = p.mesh.geometry.attributes.position, ix = p.mesh.geometry.index; let z = Infinity; const n = ix ? ix.count : a.count; for (let i = 0; i < n; i++) z = Math.min(z, a.getZ(ix ? ix.getX(i) : i)); return z; };
    T.eq(lowest(), TOP - D, 'test plate has no recess');
    const btn = document.getElementById('btn-fill-holes'), size = document.getElementById('fill-holes-size');
    T.assert(!!btn && !!size, 'no Fill holes control');
    await T.pick(['Cube']);
    const run = async () => { btn.click(); await T.sleep(200); for (let i = 0; i < 100 && btn.disabled; i++) await T.sleep(50); await T.sleep(300); };
    // too small a limit: nothing happens and nothing lands on the undo stack
    size.value = '1'; const h0 = state.history.length;
    await run();
    T.eq(p.triCount, tris0, 'a hole over the size limit was filled');
    T.eq(state.history.length, h0, 'a fill that changed nothing pushed an undo entry');
    size.value = '12';
    await run();
    T.assert(p.triCount < tris0, 'the recess was not filled (' + document.getElementById('fill-holes-info').textContent + ')');
    T.eq(lowest(), TOP, 'geometry is left below the surface');
    T.assert(/1 hole filled/.test(document.getElementById('fill-holes-info').textContent), 'readout: ' + document.getElementById('fill-holes-info').textContent);
    T.assert(state.geomByHash.get(p.hash) === p.mesh.geometry, 'the filled geometry is not registered for export');
    // The renderer tells geometries apart by attribute versions, not identity:
    // a swapped-in geometry with the same versions as the old one is never
    // uploaded and every frame fails. Each swap must carry versions of its own.
    const ver = (geo) => geo.attributes.position.version + ':' + (geo.index ? geo.index.version : '-');
    T.assert(ver(p.mesh.geometry) !== ver(g), 'the new geometry has the same buffer versions as the one it replaced: ' + ver(g));
    const first = p.mesh.geometry;
    T.eq(T.part('Sphere').triCount, sphere0, 'a part outside the selection changed');
    const filled = p.triCount;
    await T.undo(); T.eq(p.triCount, tris0, 'undo did not restore the triangle count'); T.eq(lowest(), TOP - D, 'undo did not bring the recess back');
    await T.redo(); T.eq(p.triCount, filled, 'redo did not fill it again');
    T.assert(p.mesh.geometry === first && ver(first) !== ver(g), 'redo put back a geometry the renderer cannot tell from the previous one');
    // decimate swaps geometry the same way
    const vBefore = ver(p.mesh.geometry), gBefore = p.mesh.geometry;
    document.getElementById('decimate-strength').value = '0.5';
    document.getElementById('btn-decimate-sel').click();
    for (let i = 0; i < 80 && p.mesh.geometry === gBefore; i++) await T.sleep(100);
    T.assert(p.mesh.geometry !== gBefore, 'decimate did not replace the geometry');
    T.assert(ver(p.mesh.geometry) !== vBefore, 'decimate swapped in a geometry with the same buffer versions');
    size.value = '12';
  });

  test('properties: with nothing selected the card describes the scene; counters follow shapes', async () => {
    await T.fresh(['cube', 'sphere']);
    const txt = () => document.getElementById('prop-body').innerText.replace(/\s+/g, ' ');
    const tris = () => T.live().reduce((a, p) => a + p.triCount, 0);
    await T.sleep(200);
    T.assert(/Parts 2\b/.test(txt()) && txt().includes(tris().toLocaleString() + ' triangles'), 'no scene totals with nothing selected: ' + txt());
    T.assert(!/No selection/.test(txt()), 'the card still says "No selection"');
    T.eq(document.getElementById('vp-tris').textContent, tris().toLocaleString(), 'viewport triangle count for a scene made of shapes');
    T.eq(document.getElementById('sb-tris').textContent, tris().toLocaleString(), 'status-bar triangle count for a scene made of shapes');
    await T.pick(['Cube']);
    T.assert(/Cube/.test(txt()) && /% of scene/.test(txt()), 'a selected part is not described: ' + txt());
    // deleting says what it saved, and the scene card follows
    const before = tris();
    await T.pick(['Sphere']); T.act('delete'); await T.sleep(500);
    const d = document.getElementById('vp-tris-delta');
    T.assert(d.classList.contains('show') && d.textContent.startsWith('\u2212') && d.textContent.includes((before - tris()).toLocaleString()), 'no triangle delta after a delete: "' + d.textContent + '"');
    T.assert(/Parts 1\b/.test(txt()) && /% of original/.test(txt()) && document.querySelector('#prop-body .prop-hero-badge'), 'the scene card did not follow the delete: ' + txt());
    await T.undo(); await T.sleep(200);
    T.assert(d.classList.contains('show') && d.textContent.startsWith('+'), 'undo did not show the triangles coming back: "' + d.textContent + '"');
  });

  test('shape parameters: one line each, dragging the number changes the shape in one undo step', async () => {
    await T.fresh(['sphere']);
    await T.pick(['Sphere']);
    const p = T.part('Sphere');
    const row = [...document.querySelectorAll('.prim-row')].find(r => r.querySelector('input[type=range]:not([data-prim-size])'));
    if (!row) return 'skipped (no numeric shape parameter)';
    T.eq(getComputedStyle(row.querySelector('.prim-slider')).display, 'none', 'the slider row');
    const fid = row.dataset.primField, f = row.querySelector('.prim-value'), v0 = +f.value, tri0 = p.triCount, h0 = state.history.length;
    const b = f.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height / 2;
    const ev = (type, cx) => f.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, button: 0, clientX: cx, clientY: y }));
    ev('pointerdown', x); ev('pointermove', x + 5); ev('pointermove', x + 65);
    await T.sleep(250);
    T.assert(+f.value > v0 && document.activeElement !== f, 'dragging the number did not change it (or focused the field): ' + f.value);
    ev('pointerup', x + 65); await T.sleep(500);
    T.assert(p.primParams[fid] > v0 && p.triCount !== tri0, 'the shape did not follow the drag');
    T.eq(state.history.length - h0, 1, 'undo entries for one drag');
    await T.undo();
    T.eq(p.triCount, tri0, 'triangles after undo');
    // a press without a move opens the field for typing
    const f2 = document.querySelector('.prim-row[data-prim-field="' + fid + '"] .prim-value');
    f2.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 8, button: 0, clientX: x, clientY: y }));
    f2.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 8, button: 0, clientX: x, clientY: y }));
    await T.sleep(100);
    T.assert(document.activeElement === f2, 'a click on the number did not focus it');
    f2.blur();
  });

  test('command panels: Split and Fill holes show on demand, Esc leaves the panel before the selection', async () => {
    await T.fresh(['cube', 'sphere']);
    const key = (k) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    const split = document.querySelector('.section-cmd[data-cmd="split"]'), fill = document.querySelector('.section-cmd[data-cmd="fillholes"]');
    if (!split || !fill) return 'skipped (no command panels)';
    T.assert(split.hidden && fill.hidden, 'a command panel is showing before its command ran');
    T.assert(!document.querySelector('#sidebar-right .section-cmd'), 'a command panel is still in the sidebar');
    await T.pick(['Cube']);
    key('x'); await T.sleep(300);
    T.assert(!split.hidden && split.closest('#vp-overlay'), 'X did not open the Split panel over the viewport');
    key('p'); await T.sleep(300);
    T.assert(!fill.hidden && split.hidden, 'P did not swap to the Fill holes panel');
    T.assert(document.getElementById('tg-fill-holes').classList.contains('active'), 'the toolbar button is not lit while its panel is open');
    T.assert(fill.contains(document.getElementById('btn-fill-holes')), 'Fill holes is not in its own panel');
    const clip = fill.querySelector('video');
    T.assert(clip && clip.muted && clip.loop && /fill-holes\.webm/.test(clip.getAttribute('src')), 'the Fill holes panel has no looping clip');
    key('Escape'); await T.sleep(250);
    T.assert(fill.hidden && state.selected.size === 1, 'Esc did not just close the panel (selection ' + state.selected.size + ')');
    T.assert(!clip || clip.paused, 'the clip keeps playing after its panel was put away');
    key('Escape'); await T.sleep(250);
    T.eq(state.selected.size, 0, 'selection after the second Esc');
    T.act('split'); await T.sleep(250);
    T.assert(!split.hidden, 'the Split command did not open its panel');
    split.querySelector('.cmd-foot .cmd-close').click(); await T.sleep(200);
    T.assert(split.hidden, 'Cancel did not close the panel');
    document.getElementById('tg-fill-holes').click(); await T.sleep(200);
    T.assert(!fill.hidden, 'the toolbar button did not open Fill holes');
    document.getElementById('tg-fill-holes').click(); await T.sleep(200);
    T.assert(fill.hidden, 'the toolbar button did not close Fill holes');
  });

  test('isolate: the viewport says so, the pill leaves the mode, undo returns to it', async () => {
    await T.fresh(['cube', 'sphere']);
    const pill = document.getElementById('vp-isolate-pill');
    if (!pill) return 'skipped (no isolate pill)';
    T.assert(pill.hidden, 'the pill shows with nothing isolated');
    await T.pick(['Cube']); T.act('isolate'); await T.sleep(350);
    T.assert(!pill.hidden && /1 of 2/.test(pill.textContent), 'no isolate indicator: "' + pill.textContent.trim() + '"');
    pill.click(); await T.sleep(350);
    T.assert(pill.hidden && T.part('Sphere').visible, 'clicking the pill did not show everything again');
    await T.undo(); await T.sleep(200);
    T.assert(!pill.hidden && !T.part('Sphere').visible, 'undo did not go back to the isolated view with its indicator');
    T.act('showAll'); await T.sleep(300);
    T.assert(pill.hidden, 'Show all left the indicator up');
  });

  test('materials: a colour name follows the colour; a preset and its undo refresh the open editor', async () => {
    await T.fresh(['cube', 'sphere']);
    const dock = document.getElementById('vp-materials-pop'), tg = document.getElementById('tg-materials');
    if (!dock || !tg) return 'skipped (no materials dock)';
    if (!dock.classList.contains('show')) { tg.click(); await T.sleep(450); }
    const cells = () => [...dock.querySelectorAll('.mat-cell, .mat-row')].filter(c => c._mat);
    await T.pick(['Cube']);
    document.getElementById('mat-act-add').click(); await T.sleep(400);
    const m = T.part('Cube').mesh.material;
    T.eq(m.name, 'mat_' + m.color.getHexString(), 'name of a new material');
    cells().find(c => c._mat === m).dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); await T.sleep(700);
    const nameEl = () => document.querySelector('.mat-edit-preview-name');
    if (!nameEl()) return 'skipped (material editor did not open)';
    const hex = document.getElementById('mat-edit-color-hex');
    hex.value = '1CDA4D'; hex.dispatchEvent(new Event('change', { bubbles: true })); await T.sleep(700);
    T.eq(m.name, 'mat_1cda4d', 'name after a colour change');
    T.eq(nameEl().textContent, 'mat_1cda4d', 'name shown in the editor');
    T.assert(cells().find(c => c._mat === m).textContent.includes('1cda4d'), 'the dock still lists the old colour');
    // a preset from the dock, with the editor open
    cells().find(c => c._mat === m).click(); await T.sleep(200);
    document.getElementById('mat-act-presets').click(); await T.sleep(250);
    [...document.querySelectorAll('#mat-presets-menu .mat-preset')].find(r => /Ceramic/.test(r.textContent)).click(); await T.sleep(700);
    T.eq(nameEl().textContent, m.name, 'editor name after a preset');
    T.eq(document.getElementById('mat-edit-color-hex').value.toLowerCase(), m.color.getHexString(), 'editor colour after a preset');
    await T.undo(); await T.sleep(500);
    T.eq(m.color.getHexString(), '1cda4d', 'colour after undoing the preset');
    T.eq(m.name, 'mat_1cda4d', 'name after undoing the preset');
    T.eq(nameEl().textContent, 'mat_1cda4d', 'editor name after undoing the preset');
    // the dock can be made taller and its inspector wider, and both reset
    const drag = (el, dx, dy) => { const b = el.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + 2;
      const ev = (type, cx, cy) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 5, button: 0, clientX: cx, clientY: cy }));
      ev('pointerdown', x, y); ev('pointermove', x + dx, y + dy); ev('pointerup', x + dx, y + dy); };
    const g1 = document.getElementById('mat-dock-grip'), g2 = document.getElementById('mat-insp-grip'), insp = document.getElementById('mat-inspector');
    // start from the default sizes: a size remembered from earlier use of this browser is not what a reset returns to
    g1.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); g2.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); await T.sleep(150);
    const h0 = dock.getBoundingClientRect().height, w0 = insp.getBoundingClientRect().width;
    drag(g1, 0, -60); await T.sleep(150);
    T.assert(dock.getBoundingClientRect().height > h0 + 30, 'dragging the top edge did not make the dock taller');
    if (g2.offsetParent) { drag(g2, -60, 0); await T.sleep(150); T.assert(insp.getBoundingClientRect().width > w0 + 30, 'dragging the inspector edge did not widen it'); }
    g1.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); g2.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); await T.sleep(150);
    T.assert(Math.abs(dock.getBoundingClientRect().height - h0) < 2, 'double-click did not reset the dock height');
    const pop = document.getElementById('_mat-editor-popup');
    [...(pop?.querySelectorAll('button') || [])].find(b => /close/i.test(b.className + ' ' + (b.title || '') + ' ' + (b.getAttribute('aria-label') || '')))?.click();
    await T.sleep(200);
    tg.click(); await T.sleep(300);
  });

  test('scene tabs: New scene never replaces a scene with something in it', async () => {
    await T.fresh(['cube']);
    const Tabs = T.F()._Tabs;
    if (!Tabs) return 'skipped (no tabs)';
    const strip = document.getElementById('doc-tabs');
    T.eq(Tabs.count(), 1, 'tabs at the start');
    // the Unsaved pill: shown with an edit in the history, gone when the scene is as saved
    const pill = document.getElementById('doc-unsaved');
    T.assert(pill.offsetParent !== null, 'no Unsaved pill on a scene with an unsaved cube');
    await T.undo(); await T.sleep(150);
    T.assert(pill.offsetParent === null, 'the Unsaved pill is still drawn on a scene with nothing in it');
    await T.redo(); await T.sleep(150);
    T.assert(strip.querySelector('.doc-tab-add') && !strip.querySelector('.doc-tab.other'), 'the strip does not show one tab and a + button');
    window.__moNoTabs = false;
    try {
      T.act('newscene'); await T.sleep(300);
      T.eq(Tabs.count(), 2, 'tabs after New scene on a scene with a cube');
      T.assert(T.part('Cube'), 'New scene replaced the scene it was pressed in');
      const fr = document.querySelector('iframe.mo-tab-frame');
      T.assert(fr, 'no second copy of the app was started for the new tab');
      T.assert(strip.querySelector('.doc-tab.other'), 'the strip of the first tab does not list the second');
      // (the copy is shown when it reports ready; here it is switched to by hand)
      delete fr.dataset.booting; fr.style.opacity = ''; fr.style.pointerEvents = '';
      Tabs.activate(fr.dataset.tab); await T.sleep(150);
      T.eq(fr.style.display, 'block', 'second tab after switching to it');
      Tabs.activate('main'); await T.sleep(150);
      T.eq(fr.style.display, 'none', 'second tab after switching back');
      strip.querySelector('.doc-tab.other .doc-tab-x').click(); await T.sleep(300);
      T.eq(Tabs.count(), 1, 'tabs after closing the second');
      T.assert(!document.querySelector('iframe.mo-tab-frame'), 'the closed tab left its frame behind');
      // an empty scene is reused, not multiplied
      window.__moNoTabs = true; T.act('newscene'); await T.sleep(300); window.__moNoTabs = false;
      T.act('newscene'); await T.sleep(200);
      T.eq(Tabs.count(), 1, 'tabs after New scene on an empty scene');
    } finally {
      window.__moNoTabs = true;
      document.querySelectorAll('iframe.mo-tab-frame').forEach(f => f.remove());
      if (window.__moTabs) { window.__moTabs.spare = null; window.__moTabs.pending = null; window.__moTabs.tabs = window.__moTabs.tabs.filter(x => x.id === 'main'); window.__moTabs.active = 'main'; }
    }
  });

  test('shortcuts: nothing acts on the scene behind a dialog; Ctrl+S does not isolate', async () => {
    await T.fresh(['cube', 'sphere']);
    await T.pick(['Cube']);
    document.getElementById('btn-export').click(); await T.sleep(300);
    const menu = [...document.querySelectorAll('.export-menu-item[data-fmt="glb"]')].find(x => x.offsetParent);
    if (menu) { menu.click(); await T.sleep(400); }
    T.assert(!!document.querySelector('.modal-bg.show'), 'export dialog did not open');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    await T.sleep(400); await T.ok(); await T.sleep(200);
    T.eq(T.live().length, 2, 'Delete removed a part while a dialog was open');
    document.getElementById('export-close')?.click(); await T.sleep(300);
    const vis = T.live().filter(p => p.visible).length;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
    await T.sleep(400);
    document.getElementById('save-scene-cancel')?.click(); await T.sleep(200);
    T.eq(T.live().filter(p => p.visible).length, vis, 'Ctrl+S hid parts (Isolate fired)');
  });

  test('groups: undo and redo leave every part where it was, whatever is selected by then', async () => {
    await T.fresh(['cube', 'cube', 'cube', 'sphere']);
    await T.move('Cube', 300, 0, 0); await T.move('Cube.001', 0, 200, 0); await T.move('Sphere', -150, -150, 40);
    const world = T.world(), tree = T.tree();
    await T.group(['Cube', 'Cube.001']);
    T.eq(T.world(), world, 'grouping moved a part');
    await T.pick(['Sphere']);                         // the gizmo is now somewhere else
    await T.undo();
    T.eq(T.world(), world, 'undoing a group after selecting something else moved its parts');
    T.eq(T.tree(), tree, 'tree after undoing the group');
    await T.redo();
    T.eq(T.world(), world, 'redoing the group moved its parts');
    // a group grouped together with a part: what is inside the group must stay put
    T.act('selClear'); await T.sleep(100);
    T.row('Group 1').click(); await T.sleep(150);
    T.row('Cube.002').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })); await T.sleep(200);
    T.act('group'); await T.sleep(450);
    T.eq(T.world(), world, 'grouping a group moved a part');
    await T.pick(['Sphere']);
    await T.undo(); T.eq(T.world(), world, 'undoing a group of a group moved parts');
    await T.redo(); T.eq(T.world(), world, 'redoing a group of a group moved parts');
    await T.pick(['Cube.002']);
    await T.undo(); await T.undo();
    T.eq(T.world(), world, 'undoing both groups moved parts');
    T.eq(T.tree(), tree, 'tree after undoing both groups');
  });

  test('visibility: Hide selected is one undo step', async () => {
    await T.fresh(['cube', 'cube', 'sphere']);
    await T.pick(['Cube', 'Sphere']);
    await T.undoable('hide selected', () => T.act('hideSel'), { wait: 300 });
    T.eq(T.live().filter(p => p.visible).length, 1, 'visible parts after Hide');
  });

  test('tree: a rebuild keeps its rows, and the kept tree equals one built from nothing', async () => {
    await T.fresh(['cube', 'cube', 'cube', 'sphere', 'cube', 'cube']);
    const tree = document.getElementById('tree');
    const rowsOf = () => [...tree.children].filter(r => r.classList.contains('tree-node'));
    // (the row of a deleted part is out of sight either way: only that it is gone is compared)
    const snap = () => rowsOf().map(r => r.classList.contains('is-gone') ? 'gone|' + (r.dataset.partId || '') : [[...r.classList].sort().join('.'), r.dataset.depth, r.dataset.ancestorGroups, r.dataset.groupId || '', r.dataset.partId || '', r._filled ? r.innerHTML : ''].join('|')).join('\n');
    const same = async (label) => {
      await T.sleep(250);
      const kept = snap();
      if (tree._rows) {                       // a hierarchy: a rebuild with nothing changed must not replace a single row
        const before = rowsOf();
        T.F().rebuildTree(); await T.sleep(80);
        const after = rowsOf();
        T.assert(after.length === before.length && after.every((r, i) => r === before[i]), label + ': a rebuild with nothing changed replaced rows');
        T.eq(snap(), kept, label + ': a rebuild with nothing changed altered the tree');
      }
      tree._rows = null; T.F().rebuildTree(); await T.sleep(150);
      T.eq(kept, snap(), label + ': the tree on screen differs from one built from nothing');
    };
    await same('new scene');
    await T.group(['Cube', 'Cube.001']);            await same('group');
    await T.undo();                                 await same('undo group');
    await T.redo();                                 await same('redo group');
    await T.pick(['Sphere']); T.act('hideSel');     await same('hide');
    T.act('showAll');                               await same('show all');
    await T.pick(['Cube.002']); T.act('isolate');   await same('isolate');
    T.act('showAll');                               await same('show all again');
    await T.pick(['Cube.003']); T.act('delete'); await T.ok(); await same('delete');
    await T.undo();                                 await same('undo delete');
    await T.group(['Group 1', 'Cube.004']);         await same('nest');
    await T.ctx('Group 2', 'Ungroup');              await same('ungroup');
    await T.undo();                                 await same('undo ungroup');
  });

  test('group dots: every group has one, and they are all one draw', async () => {
    await T.fresh(['cube', 'cube', 'cube', 'cube']);
    await T.group(['Cube', 'Cube.001']);
    await T.group(['Cube.002', 'Cube.003']);
    T.act('selClear'); await T.sleep(350);
    let scene = state.partsRoot; while (scene.parent) scene = scene.parent;
    const dots = []; scene.traverse(o => { if (o.isSprite && typeof o.count === 'number') dots.push(o); });
    T.eq(dots.length, 1, 'sprites that draw group dots');
    T.eq(dots[0].count, 2, 'dots drawn for two groups');
    T.assert(dots[0].visible, 'the dots are hidden');
    T.row('Group 1').click(); await T.sleep(350);
    const again = []; scene.traverse(o => { if (o.isSprite && typeof o.count === 'number') again.push(o); });
    T.eq(again.length, 1, 'sprites that draw group dots after selecting a group');
    T.eq(again[0].count, 2, 'dots drawn after selecting a group');
  });

  // ══════════════════════════════ runner ════════════════════════════════
  async function run() {
    const want = (new URLSearchParams(location.search).get('selftest') || '').toLowerCase();
    const list = want ? tests.filter(t => t.name.toLowerCase().includes(want)) : tests;
    const res = window.__selftest = { done: false, passed: 0, failed: 0, skipped: 0, results: [], total: list.length };

    // In a background tab animation frames never fire and gizmo / render
    // code never runs. Drive them from a timer so the suite behaves the
    // same whether or not the window is visible.
    if (document.visibilityState === 'hidden' || new URLSearchParams(location.search).has('rafshim')) {
      let id = 0; const timers = new Map();
      window.requestAnimationFrame = (cb) => { const k = ++id; timers.set(k, setTimeout(() => { timers.delete(k); cb(performance.now()); }, 16)); return k; };
      window.cancelAnimationFrame = (k) => { clearTimeout(timers.get(k)); timers.delete(k); };
    }
    window.addEventListener('error', e => T.errors.push(e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno));
    window.addEventListener('unhandledrejection', e => T.errors.push('unhandled rejection: ' + String(e.reason && (e.reason.message || e.reason)).slice(0, 200)));

    // CSS transitions only advance with frames, so in a hidden window a
    // sliding panel never arrives and layout checks read the starting
    // position. The suite checks where things end up, not how they move:
    // run it without transitions.
    {
      const st = document.createElement('style');
      st.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}';
      document.head.appendChild(st);
    }

    const box = document.createElement('div');
    box.id = 'selftest-panel';
    box.style.cssText = 'position:fixed;right:12px;bottom:34px;z-index:99999;width:440px;max-height:60vh;overflow:auto;background:#161616;border:1px solid #333;border-radius:10px;padding:10px 12px;font:11.5px/1.5 ui-monospace,Consolas,monospace;color:#ddd;box-shadow:0 12px 36px rgba(0,0,0,.6);white-space:pre-wrap';
    document.body.appendChild(box);
    const line = (txt, color) => { const d = document.createElement('div'); d.textContent = txt; if (color) d.style.color = color; box.appendChild(d); box.scrollTop = box.scrollHeight; };
    line('MeshOptimiser self-test — ' + list.length + ' tests', '#4db5ff');

    // wait for the app to finish booting
    for (let i = 0; i < 100 && !(window._appFns && window._addPrimitive && window.state && state.partsRoot); i++) await T.sleep(100);
    await T.sleep(600);

    const prefs = window._appFns._Prefs;
    const autoEmptyWas = prefs ? prefs.get('autoDeleteEmptyGroups') === true : false;
    if (prefs) prefs.set('autoDeleteEmptyGroups', false);

    for (const t of list) {
      T.errors.length = 0;
      const t0 = performance.now();
      let status = 'pass', detail = '';
      try {
        const out = await t.fn();
        if (typeof out === 'string' && out.startsWith('skipped')) { status = 'skip'; detail = out; }
        if (T.errors.length) { status = 'fail'; detail = 'console error: ' + T.errors.join(' | '); }
      } catch (e) {
        status = 'fail'; detail = (e && e.message) || String(e);
        // leave no dialog or mode behind for the next test
        try { document.querySelectorAll('.modal-bg.show .x, #_flat-cancel').forEach(b => b.click()); } catch (_) {}
        try { if (window._Measure?.isActive()) window._Measure.toggle(); } catch (_) {}
      }
      const ms = Math.round(performance.now() - t0);
      res.results.push({ name: t.name, status, detail, ms });
      if (status === 'pass') res.passed++; else if (status === 'skip') res.skipped++; else res.failed++;
      line((status === 'pass' ? '✓ ' : status === 'skip' ? '– ' : '✗ ') + t.name + '  (' + ms + ' ms)' + (detail ? '\n    ' + detail : ''),
           status === 'pass' ? '#34c759' : status === 'skip' ? '#9a9a9a' : '#ff6b6b');
      (status === 'fail' ? console.error : console.log)('[selftest] ' + status.toUpperCase() + ' ' + t.name + (detail ? ' — ' + detail : ''));
    }
    if (prefs) prefs.set('autoDeleteEmptyGroups', autoEmptyWas);
    res.done = true;
    line('\n' + res.passed + ' passed, ' + res.failed + ' failed' + (res.skipped ? ', ' + res.skipped + ' skipped' : ''), res.failed ? '#ff6b6b' : '#34c759');
    console.log('[selftest] done: ' + res.passed + ' passed, ' + res.failed + ' failed, ' + res.skipped + ' skipped');
  }
  run();
})();
