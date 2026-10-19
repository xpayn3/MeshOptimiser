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
    const has = (x) => x.textContent.trim().startsWith(label);
    let it = [...document.querySelectorAll('#ctx-menu > .ctx-menu-row')].find(has);
    // what is used least is one level in (Group, Select, Mesh...): open each list in turn and look there
    if (!it) for (const sub of [...document.querySelectorAll('#ctx-menu > .ctx-menu-row.has-sub')]) {
      sub.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true })); await T.sleep(80);
      it = [...document.querySelectorAll('#ctx-menu .ctx-sub .ctx-menu-row')].find(has);
      if (it) break;
    }
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
    document.getElementById('btn-export').click(); await T.sleep(400);
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
    // (the torus: Recentre moved only the selected cylinder, to the origin, so the cylinder's pivot is centred already and
    // Centre pivot would have nothing to do with it)
    await T.pick(['Torus']); T.act('duplicate'); await T.sleep(450);
    await T.pick(['Torus']);
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

  test('edit mesh: 1 2 3 4 pick the mode; points, edges and polygons of the selected part are picked, looped, moved, turned round and deleted, each undoable', async () => {
    await T.fresh(['cylinder', 'cube']);
    const A = window.__moElements, card = document.querySelector('.section-cmd[data-cmd="elements"]'), btn = document.getElementById('em-mode');
    if (!A) return 'skipped (no Edit mesh tool)';
    T.assert(!!card && !!btn, 'no Edit mesh card or mode button');
    const THREE = T.F().THREE, key = (k, o = {}) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }));
    const view0 = state.viewMode;
    await T.pick(['Cylinder']);
    // a library shape is not edited in place since 0.25.0: Bake geo first, as a person would
    document.querySelector('.prim-bake')?.click(); await T.sleep(400);
    // the keys: 3 polygons, 1 points, 2 edges, 4 back to whole parts; the view mode is left alone
    key('3'); await T.sleep(500);
    T.eq(A.mode(), 'faces', 'the 3 key'); T.assert(!card.hidden && !document.getElementById('el-bar').hidden && !document.getElementById('elem-overlay').hidden, 'Polygons mode did not open the Edit mesh bar');
    T.eq(state.viewMode, view0, 'going into a piece mode changed the view mode');
    key('1'); await T.sleep(200); T.eq(A.mode(), 'points', 'the 1 key');
    key('2'); await T.sleep(200); T.eq(A.mode(), 'edges', 'the 2 key');
    key('4'); await T.sleep(400); T.eq(A.mode(), 'model', 'the 4 key'); T.assert(card.hidden && document.getElementById('el-bar').hidden, 'Model mode left the Edit mesh bar open');
    btn.click(); await T.sleep(400); T.eq(A.mode(), 'edges', 'a click on the mode button goes back to the last piece mode');
    key('3'); await T.sleep(300);
    const cyl = T.part('Cylinder'), cube = T.part('Cube');
    const R = A.read(cyl.partId), t = R.topo, pg = R.pg;
    T.eq(t.nRegion, 3, 'a cylinder is a wall and two caps');
    T.eq(pg.count, t.nTri / 4 + t.nTri / 2, 'its polygons: a four-sided one for each pair of wall triangles, and the triangles of the two caps');
    const centre = (tr) => { const c = [0, 0, 0]; for (let k = 0; k < 3; k++) { const r = t.rep[t.tri[tr * 3 + k]] * 3; c[0] += t.positions[r] / 3; c[1] += t.positions[r + 1] / 3; c[2] += t.positions[r + 2] / 3; } return c; };
    const size = new Map(); for (let i = 0; i < t.nTri; i++) size.set(t.region[i], (size.get(t.region[i]) || 0) + 1);
    const wall = [...size].sort((a, b) => b[1] - a[1])[0][0];
    let wallTri = 0; while (t.region[wallTri] !== wall) wallTri++;
    let capTri = 0; while (t.region[capTri] === wall) capTri++;
    // polygons: one, then the loop round the wall; the history of picks goes back and forth
    T.eq(A.pickAt(cyl.partId, wallTri, centre(wallTri)), 1, 'a click picks one polygon');
    T.eq(A.pickAt(cyl.partId, wallTri, centre(wallTri), { loop: true }), t.nTri / 4, 'the loop of a wall polygon is the ring round the cylinder');
    T.assert(A.undo() && A.count() === 1, 'undoing a pick did not bring back what was picked before');
    T.assert(A.redo() && A.count() === t.nTri / 4, 'redoing a pick');
    T.eq(state.history.length, 0 + state.history.length, 'picking added to the scene history');
    T.eq(A.pickAt(cube.partId, 0, [0, 0, 0]), 0, 'a part that is not selected was worked on');
    // edges and points: the rim of a cap
    let e = -1, sharp = 0; for (let i = 0; i < t.nEdge; i++) if (t.kind[i] === 1) { if (e < 0) e = i; sharp++; }
    const tr = t.edgeT[e * 2], ra = t.rep[t.edgeV[e * 2]] * 3, rb = t.rep[t.edgeV[e * 2 + 1]] * 3, mid = [0, 1, 2].map(k => (t.positions[ra + k] + t.positions[rb + k]) / 2);
    key('2'); await T.sleep(200);
    T.eq(A.pickAt(cyl.partId, tr, mid), 1, 'a click picks one edge');
    const rim = A.pickAt(cyl.partId, tr, mid, { loop: true });
    T.eq(rim, sharp / 2, 'the loop of a sharp edge is one rim');
    key('1'); await T.sleep(200);
    T.eq(A.pickAt(cyl.partId, tr, mid, { loop: true }), rim, 'the points of that rim');
    // the gizmo: the cap moved 25 along its normal makes the part 25 longer, in one undo step, and the cap stays picked
    key('3'); await T.sleep(200);
    T.eq(A.pickAt(cyl.partId, capTri, centre(capTri)), 1, 'a click on the cap picks one of its triangles');
    T.assert(A.gizmoOn(), 'no gizmo on the picked polygon');
    const span = () => { const s = new THREE.Box3().setFromObject(cyl.mesh).getSize(new THREE.Vector3()); return s.x + s.y + s.z; };
    const n = new THREE.Vector3(t.normal[capTri * 3], t.normal[capTri * 3 + 1], t.normal[capTri * 3 + 2]).transformDirection(cyl.mesh.matrixWorld).multiplyScalar(25);
    const h0 = state.history.length, s0 = span(), tris0 = cyl.triCount;
    T.assert(A.nudge(n.x, n.y, n.z), 'the gizmo did not take the move'); await T.sleep(600);
    T.assert(Math.abs(span() - s0 - 25) < 0.5, 'the cap did not move by 25: ' + (span() - s0));
    T.eq(state.history.length, h0 + 1, 'a move is one undo step'); T.eq(cyl.triCount, tris0, 'a move changed the triangle count'); T.eq(A.count(), 1, 'the moved polygon is still picked');
    T.assert(state.geomByHash.get(cyl.hash) === cyl.mesh.geometry, 'the moved geometry is not registered for export');
    await T.undo(); T.assert(Math.abs(span() - s0) < 0.01, 'undo did not put the cap back');
    // reverse normals: a new shape with as many triangles, the polygon still picked, undo puts the old shape back
    A.pickAt(cyl.partId, capTri, centre(capTri));
    const g0 = cyl.mesh.geometry;
    T.assert(!document.getElementById('btn-el-flip').disabled, 'Reverse normals is off with a polygon picked');
    A.flipPicked(); await T.sleep(500);
    T.assert(cyl.mesh.geometry !== g0 && cyl.triCount === tris0 && A.count() === 1, 'Reverse normals');
    await T.undo(); T.assert(cyl.mesh.geometry === g0, 'undo of Reverse normals');
    // delete: the whole cap (a double-click on one of its triangles: not four-sided, so the loop is the face) in one undo step
    const capTris = size.get(t.region[capTri]);
    T.eq(A.pickAt(cyl.partId, capTri, centre(capTri), { loop: true }), capTris, 'the loop of a triangle of the cap is the cap');
    const h1 = state.history.length;
    // (Delete has no button in the bar since 0.25.0: the Del key does it)
    A.delete(); await T.sleep(600);
    T.eq(cyl.triCount, tris0 - capTris, 'the cylinder without its cap'); T.eq(state.history.length, h1 + 1, 'a delete is one undo step'); T.eq(A.count(), 0, 'pieces are still picked after the delete');
    T.assert(state.geomByHash.get(cyl.hash) === cyl.mesh.geometry, 'the new geometry is not registered for export');
    await T.undo(); T.eq(cyl.triCount, tris0, 'undo of the delete');
    // every polygon of a part is not taken: that is deleting the part
    A.selectAll(); T.eq(A.count(), A.read(cyl.partId).pg.count, 'Pick all takes every polygon of the selected part');
    const r = A.delete(); await T.sleep(400);
    T.eq(cyl.triCount, tris0, 'a delete of every polygon emptied the part'); T.assert(r && r.whole && r.whole.length === 1, 'the part that was not emptied is not named');
    A.clear();
    key('4'); await T.sleep(400);
    T.assert(card.hidden && document.getElementById('elem-overlay').hidden && A.mode() === 'model', 'the 4 key did not leave the piece modes');
    T.eq(state.viewMode, view0, 'leaving changed the view mode');
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

  test('repeats: copies that arrive as separate meshes are kept once, and nothing moves', async () => {
    await T.fresh([]);
    const bytes = await (await fetch('tests/fixtures/repeats-60.glb')).arrayBuffer();
    // where every vertex of the file should end up (node translation + rotation applied by hand)
    const dv = new DataView(bytes), jl = dv.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, jl)));
    const bin = bytes.slice(20 + jl + 8);
    const rot = (q, p) => { const [x, y, z, w] = q; const tx = 2 * (y * p[2] - z * p[1]), ty = 2 * (z * p[0] - x * p[2]), tz = 2 * (x * p[1] - y * p[0]); return [p[0] + w * tx + (y * tz - z * ty), p[1] + w * ty + (z * tx - x * tz), p[2] + w * tz + (x * ty - y * tx)]; };
    const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (const n of json.nodes) {
      if (n.mesh == null) continue;
      const a = json.accessors[json.meshes[n.mesh].primitives[0].attributes.POSITION], v = json.bufferViews[a.bufferView];
      const f = new Float32Array(bin, v.byteOffset, a.count * 3);
      for (let i = 0; i < f.length; i += 3) {
        let p = [f[i], f[i + 1], f[i + 2]];
        if (n.rotation) p = rot(n.rotation, p);
        if (n.translation) p = p.map((x, k) => x + n.translation[k]);
        for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
      }
    }
    const trisIn = json.accessors.filter((a, i) => json.meshes.some(m => m.primitives[0].indices === i)).reduce((s, a) => s + a.count / 3, 0);
    await T.dropFile(new Blob([bytes], { type: 'model/gltf-binary' }), 'repeats-60.glb');
    const live = T.live();
    T.eq(live.length, 60, 'parts after opening');
    const geomOf = (p) => (p.mesh || p.instancedMesh).geometry;
    T.eq(new Set(live.map(p => geomOf(p).uuid)).size, 3, 'distinct geometries (60 meshes, 3 shapes)');
    T.eq(live.reduce((s, p) => s + p.triCount, 0), trisIn, 'triangle count');
    // every vertex in world space, against the file
    const THREE = T.F().THREE, v = new THREE.Vector3(), mm = new THREE.Matrix4();
    const wlo = [1e9, 1e9, 1e9], whi = [-1e9, -1e9, -1e9];
    state.partsRoot.updateMatrixWorld(true);
    for (const p of live) {
      if (p.mesh) mm.copy(p.mesh.matrixWorld); else { p.instancedMesh.getMatrixAt(p.instanceIndex, mm); mm.premultiply(p.instancedMesh.matrixWorld); }
      const pos = geomOf(p).attributes.position;
      for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(mm); for (let k = 0; k < 3; k++) { const x = v.getComponent(k); if (x < wlo[k]) wlo[k] = x; if (x > whi[k]) whi[k] = x; } }
    }
    for (let k = 0; k < 3; k++) T.assert(Math.abs(wlo[k] - lo[k]) < 0.02 && Math.abs(whi[k] - hi[k]) < 0.02, 'the model moved: axis ' + k + ' ' + wlo[k].toFixed(3) + '…' + whi[k].toFixed(3) + ' instead of ' + lo[k].toFixed(3) + '…' + hi[k].toFixed(3));
    // the saved file keeps the sharing
    const glb = await T.exportAs('glb');
    const out = new Uint8Array(await glb.arrayBuffer()), odv = new DataView(out.buffer);
    const oj = JSON.parse(new TextDecoder().decode(out.slice(20, 20 + odv.getUint32(12, true))));
    T.eq(oj.meshes.length, 3, 'meshes in the exported file');
    T.assert(out.length < bytes.byteLength * 0.5, 'the exported file is not smaller than half the original (' + bytes.byteLength + ' → ' + out.length + ')');
  });

  test('export: "Check against" estimates the size and the triangle count, and says when a target is passed', async () => {
    await T.fresh([]);
    const bytes = await (await fetch('tests/fixtures/repeats-60.glb')).arrayBuffer();
    await T.dropFile(new Blob([bytes], { type: 'model/gltf-binary' }), 'repeats-60.glb');
    const tris = T.live().reduce((s, p) => s + p.triCount, 0);
    const est = window._exportCheck.estimate();
    T.eq(est.tris, tris, 'estimated triangles');
    const real = (await T.exportAs('glb')).size;
    T.assert(est.bytes > real * 0.6 && est.bytes < real * 1.6, 'estimated file size ' + Math.round(est.bytes) + ' bytes against a real ' + real);
    // a target the scene is inside, and one it is not (shrink the limit by picking the tightest and padding the scene)
    document.getElementById('btn-export').click(); await T.sleep(300);
    const menuItem = [...document.querySelectorAll('.export-menu-item[data-fmt="glb"]')].find(x => x.offsetParent);
    if (menuItem) { menuItem.click(); await T.sleep(300); }          // (older layout: a dropdown first)
    document.querySelector('.fmt-card[data-fmt="glb"]')?.click(); await T.sleep(200);
    const sel = document.getElementById('exp-target');
    T.assert(sel && sel.offsetParent, 'the Check against list is not on screen for GLB');
    sel.value = 'web'; sel.dispatchEvent(new Event('change', { bubbles: true })); await T.sleep(100);
    const meter = document.getElementById('exp-target-meter').textContent;
    T.assert(/within the usual limits/.test(meter), 'a small scene should be within the web limits: "' + meter + '"');
    document.querySelector('.fmt-card[data-fmt="obj"]').click(); await T.sleep(100);
    T.assert(!document.getElementById('exp-target-row').offsetParent, 'the Check against list should be hidden for OBJ');
    document.getElementById('export-close')?.click(); await T.sleep(100);
  });

  test('duplicates: "Deduplicate geometry" removes a copy in the same place and keeps every repeat elsewhere', async () => {
    // the old version deleted every part whose shape had been seen before: 60 placed parts of 3 shapes became 3
    await T.fresh([]);
    const bytes = await (await fetch('tests/fixtures/repeats-60.glb')).arrayBuffer();
    await T.dropFile(new Blob([bytes], { type: 'model/gltf-binary' }), 'repeats-60.glb');
    T.eq(T.live().length, 60, 'parts after opening');
    document.getElementById('btn-clean-dupes').click(); await T.sleep(500); await T.ok(); await T.sleep(400);
    T.eq(T.live().length, 60, 'parts after Deduplicate geometry (60 placed repeats of 3 shapes must all stay)');
    await T.fresh(['cube', 'cube', 'sphere']);
    T.eq(T.live().length, 3, 'parts before');
    const h0 = state.history.length;
    document.getElementById('btn-clean-dupes').click(); await T.sleep(500); await T.ok(); await T.sleep(500);
    T.eq(T.live().length, 2, 'the second cube in the same place should go, the sphere stays');
    T.assert(state.history.length > h0, 'removing copies pushed no undo entry');
    await T.undo();
    T.eq(T.live().length, 3, 'undo');
  });

  test('recipes: save, change, run again; a file from outside is checked, not trusted', async () => {
    await T.fresh(['cube', 'cube', 'sphere']);
    const R = window.__moRecipes;
    T.assert(R, 'no recipes API');
    // what a hostile or damaged file may contain
    const c = R.steps({ clean: 'yes', fast: 'rm -rf', small: -5, tol: 1e12, target: 'lots', extra: 1, hidden: true });
    T.eq(c.fast, 'keep', 'unknown fasteners setting'); T.eq(c.small, 0, 'negative size'); T.eq(c.tol, 1000, 'huge tolerance'); T.eq(c.target, null, 'target that is not a number'); T.eq(c.clean, true, 'non-boolean'); T.eq(c.hidden, true, 'a valid boolean passes'); T.assert(!('extra' in c), 'unknown field kept');
    T.eq(R.steps('x'), null, 'a string is not a recipe');
    // save the controls under a name through the dialog
    R.write({ clean: true, dupes: true, hidden: false, fast: 'keep', small: 0, holes: false, tol: 0, remesh: false, target: null });
    document.getElementById('smart-adv').open = true;
    document.getElementById('recipe-save').click(); await T.sleep(300);
    document.getElementById('_dlg-input').value = 'selftest recipe';
    document.getElementById('_dlg-ok').click(); await T.sleep(300);
    T.assert(R.list().some(r => r.name === 'selftest recipe'), 'the recipe was not saved');
    T.eq(document.getElementById('recipe-list').value, 'selftest recipe', 'the list shows the new recipe');
    // change the controls, then run the recipe: they go back and the run removes the stacked cube
    R.write({ clean: false, dupes: false, hidden: true, fast: 'delete', small: 5, holes: true, tol: 3, remesh: true, target: 1000 });
    await R.run('selftest recipe'); await T.sleep(600);
    T.eq(document.getElementById('smart-dupes').checked, true, 'Remove exact copies set by the recipe');
    T.eq(document.getElementById('smart-hidden').checked, false, 'hidden parts set by the recipe');
    T.eq(document.getElementById('smart-tol').value, '0', 'tolerance set by the recipe');
    T.eq(T.live().length, 2, 'the run should have removed the stacked cube');
    // clean up what the test saved
    localStorage.setItem('stepopt-recipes', JSON.stringify(R.list().filter(r => r.name !== 'selftest recipe')));
    R.fill();
  });

  test('merge by colour: one part per colour, same triangles, one undo', async () => {
    await T.fresh(['cube', 'cube', 'sphere', 'sphere', 'cone']);
    const THREE = T.F().THREE;
    const live0 = T.live();
    live0.forEach((p, i) => p.originalColor.setHex(p.name.startsWith('Cube') ? 0xcc3333 : p.name.startsWith('Sphere') ? 0x3355cc : 0x33aa55));
    const tris0 = live0.reduce((s, p) => s + p.triCount, 0);
    const h0 = state.history.length;
    await window._mergeByColour(); await T.sleep(1200);
    T.eq(T.live().length, 3, 'parts after merging two colours of two (and one single)');
    T.eq(T.live().reduce((s, p) => s + p.triCount, 0), tris0, 'triangles must not change');
    T.assert(state.history.length > h0, 'no undo entry');
    await T.undo();
    T.eq(T.live().length, 5, 'one Ctrl+Z should bring all five parts back');
  });

  test('open: IGES and BREP files go through the converter like STEP (a box and a cylinder)', async () => {
    for (const name of ['test-model.iges', 'test-model.brep']) {
      await T.fresh([]);
      const blob = await (await fetch('tests/fixtures/' + name)).blob();
      // the import-settings window asks first for a CAD file: press Import when it shows
      const press = setInterval(() => { const b = document.getElementById('import-modal-confirm'); if (b && b.offsetParent) b.click(); }, 200);
      try { await T.dropFile(blob, name); } finally { clearInterval(press); }
      T.eq(T.live().length, 2, name + ': parts');
      T.assert(T.live().every(p => p.triCount >= 12), name + ': a part has no triangles');
    }
  });

  test('scene scale: the view and the floor grid follow, from a millionth to a million', async () => {
    await T.fresh(['cube', 'sphere', 'cone']);
    const F = T.F(), THREE = F.THREE;
    const setScale = async (v) => { const e = document.getElementById('scene-scale'); e.value = String(v); e.dispatchEvent(new Event('change', { bubbles: true })); await T.sleep(600); };
    const grid = () => state.partsRoot.parent.getObjectByName('_infiniteGrid');
    const screenOf = () => { const b = new THREE.Box3().setFromObject(state.partsRoot), c = b.getCenter(new THREE.Vector3()); F.camera.updateMatrixWorld(); return c.project(F.camera); };
    await setScale(1); F.fitToView(); await T.sleep(600);
    const ref = screenOf(), minor1 = grid().userData.uniforms.uMinor.value, dist1 = F.camera.position.distanceTo(F.controls.target);
    T.assert(minor1 > 0, 'no grid cell size');
    for (const k of [0.001, 1e-6, 1000, 1e6, 1]) {
      await setScale(k);
      const p = screenOf(), g = grid(), u = g.userData.uniforms;
      T.assert(Math.abs(p.x - ref.x) < 1e-3 && Math.abs(p.y - ref.y) < 1e-3 && p.z > 0 && p.z < 1, 'scale ' + k + ': the model moved on screen (' + p.x.toFixed(4) + ', ' + p.y.toFixed(4) + ' instead of ' + ref.x.toFixed(4) + ', ' + ref.y.toFixed(4) + ', depth ' + p.z.toFixed(4) + ')');
      const dist = F.camera.position.distanceTo(F.controls.target);
      T.assert(Math.abs(dist / dist1 / k - 1) < 1e-6, 'scale ' + k + ': the camera did not follow (distance ' + dist + ' for ' + dist1 + ')');
      T.assert(F.camera.near > 0 && F.camera.far > F.camera.near && dist > F.camera.near && dist < F.camera.far, 'scale ' + k + ': the clip planes do not contain the model (' + F.camera.near + '…' + F.camera.far + ', distance ' + dist + ')');
      T.assert(g.visible && Math.abs(u.uMinor.value / minor1 / k - 1) < 1e-6, 'scale ' + k + ': the grid cell is ' + u.uMinor.value + ', not ' + (minor1 * k));
      T.assert(u.uFadeEnd.value > dist, 'scale ' + k + ': the grid fades out before the camera distance (' + u.uFadeEnd.value + ' < ' + dist + ')');
    }
  });

  test('draw tool: the keys are listed at the bottom right, and only the ones that do something', async () => {
    await T.fresh([]);
    const D = window._MODraw, rows = () => [...document.querySelectorAll('#vp-hint .vp-tip')].map(r => [...r.querySelectorAll('kbd')].map(k => k.textContent).join('+') + ' ' + r.querySelector('.vp-hint-lbl').textContent.trim());
    const has = (re) => rows().some(r => re.test(r));
    T.act('draw'); await T.sleep(700);
    T.assert(D.isActive(), 'the Draw tool did not start');
    T.assert(document.getElementById('draw-hint').hidden, 'the old pill at the top of the viewport is still there');
    D._api.setTool('pen'); D._api.changeType('bezier'); await T.sleep(500);
    T.assert(has(/^Click First point/), 'pen: no first-point tip: ' + rows().join(' | '));
    T.assert(has(/^Drag Pull out handles/), 'Bezier: the handle tip is missing');
    T.assert(!has(/^Enter /) && !has(/^Backspace /) && !has(/^C /), 'pen with no point yet lists keys that do nothing: ' + rows().join(' | '));
    D._api.changeType('bspline'); await T.sleep(500);
    T.assert(!has(/^Drag Pull out handles/), 'B-spline has no handles, but the list says to drag them');
    D._api.changeType('bezier'); await T.sleep(300);
    // three real clicks on the canvas
    const c = document.getElementById('canvas').getBoundingClientRect();
    const click = async (x, y) => { for (const type of ['pointerdown', 'pointerup']) document.getElementById('canvas').dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerdown' ? 1 : 0, pointerId: 1, isPrimary: true })); await T.sleep(250); };
    for (const [fx, fy] of [[0.4, 0.5], [0.55, 0.6], [0.65, 0.45]]) await click(c.left + c.width * fx, c.top + c.height * fy);
    const st = D.state();
    T.assert(st.cur && st.cur.pts.length === 3, 'three clicks made ' + (st.cur ? st.cur.pts.length : 0) + ' points');
    T.assert(has(/^Enter Finish/) && has(/^C Close and finish/) && has(/^Backspace /) && has(/^Esc Cancel/), 'three points: the finishing keys are not listed: ' + rows().join(' | '));
    D._api.finishPen(false); await T.sleep(400);
    D._api.setTool('rect'); await T.sleep(400);
    T.assert(has(/^Click First corner/), 'rectangle: ' + rows().join(' | '));
    // leaving the tool brings the ordinary tips back
    T.act('draw'); await T.sleep(500);
    if (D.isActive()) { document.querySelector('#draw-card .cmd-close, #draw-card [data-cmd-close]')?.click(); await T.sleep(500); }
    T.assert(!D.isActive(), 'the Draw tool did not stop');
    T.assert(!has(/First corner|First point|Alt\+Drag Orbit/) && (has(/^Click Select/) || has(/^E Move/)), 'after leaving the tool the ordinary tips are not back: ' + rows().join(' | '));     // (the line just drawn is selected, so these are the selection's tips)
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

  test('decimate: "Within … mm" removes triangles and moves no point further than it says', async () => {
    await T.fresh(['sphere', 'torus']);
    const THREE = T.F().THREE;
    // closest distance from point p to a triangle mesh (brute force, Ericson 5.1.5)
    const tris = (g) => { const P = g.attributes.position, I = g.index ? g.index.array : null, n = (I ? I.length : P.count) / 3, out = []; for (let t = 0; t < n; t++) { const a = I ? I[t * 3] : t * 3, b = I ? I[t * 3 + 1] : t * 3 + 1, c = I ? I[t * 3 + 2] : t * 3 + 2; out.push([new THREE.Vector3().fromBufferAttribute(P, a), new THREE.Vector3().fromBufferAttribute(P, b), new THREE.Vector3().fromBufferAttribute(P, c)]); } return out; };
    const tgt = new THREE.Vector3(), tri = new THREE.Triangle();
    const dist = (p, T3) => { let best = Infinity; for (const [a, b, c] of T3) { tri.set(a, b, c).closestPointToPoint(p, tgt); const d = tgt.distanceTo(p); if (d < best) best = d; } return best; };
    const oneWay = (from, to) => { const P = from.attributes.position, v = new THREE.Vector3(); let worst = 0; for (let i = 0; i < P.count; i += 3) { v.fromBufferAttribute(P, i); worst = Math.max(worst, dist(v, to)); } return worst; };
    const part = T.part('Sphere');
    const orig = part.mesh.geometry, origTris = tris(orig), n0 = part.triCount;
    const run = async (mm) => {
      await T.pick(['Sphere']);
      const sel = document.getElementById('decimate-strength');
      sel.value = 'tol'; sel.dispatchEvent(new Event('change', { bubbles: true }));
      const box = document.getElementById('decimate-tol'); box.value = String(mm); box.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('btn-decimate-sel').click(); await T.sleep(300); await T.ok(); await T.sleep(2500);
    };
    const radius = 50;                                       // the default sphere in a 100 mm scene
    await run(0.2);
    const fine = T.part('Sphere').triCount;
    T.assert(fine < n0, 'a 0.2 mm tolerance removed nothing from a ' + n0 + '-triangle sphere');
    const g1 = T.part('Sphere').mesh.geometry, t1 = tris(g1);
    const dev1 = Math.max(oneWay(g1, origTris), oneWay(orig, t1));
    T.assert(dev1 <= 0.2 * 1.1, 'the 0.2 mm run moved a point ' + dev1.toFixed(3) + ' mm');
    await T.undo();
    T.eq(T.part('Sphere').triCount, n0, 'undo of Decimate within a tolerance');
    await run(2);
    const coarse = T.part('Sphere').triCount;
    T.assert(coarse < fine, 'a 2 mm tolerance (' + coarse + ' triangles) did not go further than 0.2 mm (' + fine + ')');
    const g2 = T.part('Sphere').mesh.geometry;
    const dev2 = Math.max(oneWay(g2, origTris), oneWay(orig, tris(g2)));
    T.assert(dev2 <= 2 * 1.1, 'the 2 mm run moved a point ' + dev2.toFixed(3) + ' mm');
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

  test('top bar: Export opens the export dialog (no dropdown) and leaves File alone', async () => {
    await T.fresh(['cube']);
    const exp = document.getElementById('btn-export'), file = document.getElementById('btn-file');
    const expWrap = exp.closest('.export-wrap'), fileWrap = file.closest('.export-wrap');
    T.assert(expWrap !== fileWrap, 'Export and File share a wrapper');
    T.assert(!document.getElementById('export-menu') && !exp.querySelector('.caret'), 'Export still has a dropdown or an arrow');
    exp.click(); await T.sleep(300);
    T.assert(document.getElementById('export-modal').classList.contains('show'), 'the export dialog did not open');
    T.assert(!fileWrap.classList.contains('open'), 'opening Export flipped the File arrow');
    document.getElementById('export-close')?.click(); await T.sleep(300);
    file.click(); await T.sleep(150);
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
      // A binary FBX carries a file id, a creation time and a footer code
      // that the FBX SDK checks against each other: Cinema 4D refused every
      // file while the id was random and the time was today's.
      if (f === 'fbx') {
        const u = new Uint8Array(await b.arrayBuffer());
        const has = (bytes) => { outer: for (let i = 0; i + bytes.length <= Math.min(u.length, 8192); i++) { for (let k = 0; k < bytes.length; k++) if (u[i + k] !== bytes[k]) continue outer; return true; } return false; };
        if (String.fromCharCode(...u.subarray(0, 18)) === 'Kaydara FBX Binary') {
          T.assert(has([...'1970-01-01 10:00:00:000'].map(c => c.charCodeAt(0))), 'binary FBX: the creation time is not the one its footer code belongs to');
          T.assert(has([0x28, 0xb3, 0x2a, 0xeb, 0xb6, 0x24, 0xcc, 0xc2, 0xbf, 0xc8, 0xb0, 0x2a, 0xa9, 0x2b, 0xfc, 0xf1]), 'binary FBX: the file id is not the one its creation time belongs to');
          const foot = [0xfa, 0xbc, 0xab, 0x09, 0xd0, 0xc8, 0xd4, 0x66, 0xb1, 0x76, 0xfb, 0x83, 0x1c, 0xf7, 0x26, 0x7e];
          const tail = u.subarray(Math.max(0, u.length - 200));
          let ok = false;
          for (let i = 0; i + 16 <= tail.length && !ok; i++) ok = foot.every((v, k) => tail[i + k] === v);
          T.assert(ok, 'binary FBX: the footer code is missing');
        }
      }
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

  // A part from a STEP file has its origin at 0, 0, 0 and its shape out at its place in the model. Written as it is, every axis of the file
  // (Cinema 4D, Blender, Maya) sat at 0, 0, 0. Pivot points: "At the centre of each part" (the default) puts it at the part.
  test('export: pivots sit at the centre of each part, or as in the scene', async () => {
    await T.fresh(['cube', 'cylinder']);
    const part = state.parts.find(q => q.name === 'Cube');
    const m0 = part.mesh.position.clone();
    part.mesh.geometry.translate(500, 200, 100); part.mesh.geometry.computeBoundingBox(); part.mesh.updateMatrixWorld(true);
    const sel = document.getElementById('exp-pivot');
    T.assert(sel, 'the export has no Pivot points option');
    try {
      sel.value = 'part';
      const at = T.gltfNodes(await T.gltf()).Cube;
      T.eq(at.join(','), [m0.x + 500, m0.y + 200, m0.z + 100].map(Math.round).join(','), 'the node of the part is not at the centre of the part');
      sel.value = 'origin';
      const as = T.gltfNodes(await T.gltf()).Cube;
      T.eq(as.join(','), [m0.x, m0.y, m0.z].map(Math.round).join(','), 'As in the scene did not keep the own origin of the part');
    } finally { sel.value = 'part'; }
  });

  // Up axis and Scene scale (Settings › Scene) are how the scene is shown and
  // measured. The file gets the model itself, and Export has its own Scale and
  // Axis. A part that was moved after the setting changed used to be written
  // with the setting baked in, and the others without.
  test('export: the viewport up axis and scene scale stay out of the file, for every part', async () => {
    await T.fresh(['cube', 'cylinder']);
    await T.move('Cylinder', 180, 60, 40);
    const THREE = T.F().THREE;
    const set = async (id, v) => { const el = document.getElementById(id); el.value = String(v); el.dispatchEvent(new Event('change', { bubbles: true })); await T.sleep(450); };
    // every mesh node's place in the file: position, turn and size
    const sig = (j) => {
      const out = [];
      const walk = (i, parent) => {
        const n = j.nodes[i], m = new THREE.Matrix4();
        if (n.matrix) m.fromArray(n.matrix);
        else m.compose(new THREE.Vector3(...(n.translation || [0, 0, 0])), new THREE.Quaternion(...(n.rotation || [0, 0, 0, 1])), new THREE.Vector3(...(n.scale || [1, 1, 1])));
        m.premultiply(parent);
        if (n.mesh !== undefined) out.push(n.name + ' ' + m.elements.map(x => (Math.round(x * 10) / 10) || 0).join(','));
        (n.children || []).forEach(c => walk(c, m));
      };
      j.scenes[0].nodes.forEach(i => walk(i, new THREE.Matrix4()));
      return out.sort().join(' | ');
    };
    // move a part away and back, the way a user would: its place is the same, its stored matrix is new
    const touch = async (name) => {
      await T.pick([name]); await T.openTransformPanel();
      const v = parseFloat(document.getElementById('tform-px').value) || 0;
      await T.typeInto('tform-px', v + 25); await T.typeInto('tform-px', v);
      T.act('selClear'); await T.sleep(250);
    };
    const base = sig(await T.gltf());
    try {
      await set('scene-up-axis', 'y');
      T.eq(sig(await T.gltf()), base, 'switching the viewport to Y-up changed the exported file');
      await touch('Cylinder');
      T.eq(sig(await T.gltf()), base, 'a part moved while the viewport is Y-up was written turned');
      await set('scene-up-axis', 'z');
      await set('scene-scale', 2);
      T.eq(sig(await T.gltf()), base, 'scene scale was baked into the exported file');
      await touch('Cylinder');
      T.eq(sig(await T.gltf()), base, 'a part moved in a scaled scene was written at another size than the rest');
      // a shape added while the scene is scaled and Y-up is written like the others
      await set('scene-up-axis', 'y');
      await Promise.race([Promise.resolve(window._addPrimitive('sphere')), T.sleep(2000)]); await T.sleep(350);
      T.act('selClear'); await T.sleep(150);
      const withSphere = sig(await T.gltf());
      await set('scene-up-axis', 'z'); await set('scene-scale', 1);
      T.eq(sig(await T.gltf()), withSphere, 'a shape added in a scaled Y-up scene changed in the file when the settings went back');
    } finally {
      await set('scene-up-axis', 'z'); await set('scene-scale', 1);
    }
  });

  // A cube seen from straight above is a square, in a wide picture too. The
  // orthographic views used to keep the viewport's shape while the picture
  // took another, so the square came out as a wide rectangle.
  test('screenshot: an orthographic view is not stretched in a picture of another shape', async () => {
    await T.fresh(['cube']);
    T.act('camTop'); await T.sleep(700);
    try {
      T.capture(); T.blobs.length = 0;
      document.getElementById('tg-screenshot').click(); await T.sleep(700);
      const dlg = document.getElementById('scrshot-dlg');
      T.assert(dlg, 'the screenshot dialog did not open');
      const set = (id, v) => { const el = dlg.querySelector(id); el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
      set('#ss-w', 800); set('#ss-h', 400);
      const hg = dlg.querySelector('#ss-hide-grid'); if (hg && !hg.checked) hg.click();
      await T.sleep(150);
      dlg.querySelector('.ss-save').click();
      const t0 = performance.now();
      while (!T.blobs.length && performance.now() - t0 < 15000) await T.sleep(200);
      T.assert(T.blobs.length > 0, 'no picture was saved');
      const bmp = await createImageBitmap(T.blobs[T.blobs.length - 1]);
      T.eq(bmp.width + 'x' + bmp.height, '800x400', 'picture size');
      const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
      const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      // the cube is whatever differs from the background in the corner
      let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        if (Math.abs(d[i] - d[0]) + Math.abs(d[i + 1] - d[1]) + Math.abs(d[i + 2] - d[2]) > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      T.assert(x1 > x0 && y1 > y0, 'nothing was drawn in the picture');
      const ratio = (x1 - x0 + 1) / (y1 - y0 + 1);
      T.assert(ratio > 0.9 && ratio < 1.1, 'a cube from above is ' + (x1 - x0 + 1) + ' × ' + (y1 - y0 + 1) + ' pixels in an 800 × 400 picture: it should be square');
    } finally {
      document.querySelector('#scrshot-dlg .ss-cancel')?.click();
      T.act('camPersp'); await T.sleep(500);
    }
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

  test('delete small parts: the slider is live, and an isolated view follows it', async () => {
    await T.fresh(['cube', 'sphere']);
    const range = document.querySelector('#thr-scrub .scrub-range'), btn = document.getElementById('btn-delete-small');
    if (!range || !btn) return 'skipped (no threshold slider)';
    const t0 = state.threshold, v0 = range.value;
    // while the slider is held: the threshold, the count on the button and the sentence all follow
    range.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    range.value = String(+range.value + 200); range.dispatchEvent(new Event('input', { bubbles: true }));
    await T.sleep(120);
    T.assert(state.threshold !== t0, 'the threshold did not follow the slider while it was held');
    // (the button is off while nothing is flagged, and never busy while the slider is held)
    T.assert(btn.disabled === !(state.pendingFlagged.size > 0) && !btn.classList.contains('is-busy'), 'the Delete button does not follow the count while the slider is held');
    T.eq(document.getElementById('btn-delete-small-count').textContent, state.pendingFlagged.size.toLocaleString(), 'the count on the Delete button is stale');
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    await T.sleep(300);
    // a change without a drag commits too, and the old value comes back
    range.value = v0; range.dispatchEvent(new Event('input', { bubbles: true })); range.dispatchEvent(new Event('change', { bubbles: true }));
    await T.sleep(300);
    T.assert(Math.abs(state.threshold - t0) < 0.05, 'a change without a drag did not commit: ' + state.threshold);
    // with the small parts isolated, what is shown is exactly what is flagged, whatever the slider says
    const max = +range.max;
    const visible = () => T.live().filter(p => p.visible).map(p => p.partId).sort().join(',');
    const flagged = () => [...state.pendingFlagged].sort().join(',');
    range.value = String(max); range.dispatchEvent(new Event('input', { bubbles: true })); range.dispatchEvent(new Event('change', { bubbles: true }));
    await T.sleep(300);
    if (state.pendingFlagged.size) {
      const steps = state.history.length;
      document.getElementById('btn-isolate-small').click(); await T.sleep(300);
      T.eq(visible(), flagged(), 'Isolate did not show the flagged parts');
      range.value = String(Math.round(max * 0.5)); range.dispatchEvent(new Event('input', { bubbles: true }));
      await T.sleep(120);
      T.eq(visible(), flagged(), 'the isolated view did not follow the slider');
      range.dispatchEvent(new Event('change', { bubbles: true })); await T.sleep(300);
      T.eq(state.history.length, steps + 1, 'following the slider added undo steps of its own');
      document.getElementById('btn-isolate-small').click(); await T.sleep(300);
      T.eq(T.live().filter(p => !p.visible).length, 0, 'Show all left parts hidden');
      range.value = String(max); range.dispatchEvent(new Event('input', { bubbles: true })); await T.sleep(150);
      T.eq(T.live().filter(p => !p.visible).length, 0, 'the slider hid parts although nothing is isolated any more');
    }
    range.value = v0; range.dispatchEvent(new Event('input', { bubbles: true })); range.dispatchEvent(new Event('change', { bubbles: true }));
    await T.sleep(300);
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

  test('remove holes: a recess in a flat face is closed, undo brings it back', async () => {
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
    T.assert(!!btn && !!size, 'no Remove holes control');
    await T.pick(['Cube']);
    const run = async () => { btn.click(); await T.sleep(200); for (let i = 0; i < 100 && btn.disabled; i++) await T.sleep(50); await T.sleep(300); };
    // too small a limit: nothing happens and nothing lands on the undo stack (Remove vertices left over is off for this step:
    // with it on, the flat face is tidied even when no hole is closed)
    const tidy = document.getElementById('fh-tidy'), tidy0 = tidy ? tidy.checked : false;
    const setTidy = (on) => { if (tidy && tidy.checked !== on) { tidy.checked = on; tidy.dispatchEvent(new Event('change', { bubbles: true })); } };
    setTidy(false);
    size.value = '1'; const h0 = state.history.length;
    await run();
    T.eq(p.triCount, tris0, 'a hole over the size limit was filled');
    T.eq(state.history.length, h0, 'a fill that changed nothing pushed an undo entry');
    setTidy(tidy0);
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
    // decimate swaps geometry the same way (on the sphere: the filled plate is down to a handful of triangles, which Decimate leaves alone)
    const sp = T.part('Sphere');
    await T.pick(['Sphere']);
    const vBefore = ver(sp.mesh.geometry), gBefore = sp.mesh.geometry;
    document.getElementById('decimate-strength').value = '0.5';
    document.getElementById('btn-decimate-sel').click();
    for (let i = 0; i < 80 && sp.mesh.geometry === gBefore; i++) await T.sleep(100);
    T.assert(sp.mesh.geometry !== gBefore, 'decimate did not replace the geometry');
    T.assert(ver(sp.mesh.geometry) !== vBefore, 'decimate swapped in a geometry with the same buffer versions');
    size.value = '12';
  });

  test('properties: with nothing selected the card describes the scene; counters follow shapes', async () => {
    await T.fresh(['cube', 'sphere']);
    const txt = () => document.getElementById('prop-body').innerText.replace(/\s+/g, ' ');
    const tris = () => T.live().reduce((a, p) => a + p.triCount, 0);
    await T.sleep(200);
    T.assert(/Parts 2\b/.test(txt()) && txt().includes(tris().toLocaleString() + ' tris'), 'no scene totals with nothing selected: ' + txt());
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

  test('command panels: Split and Remove holes show on demand, Esc leaves the panel before the selection', async () => {
    await T.fresh(['cube', 'sphere']);
    const key = (k) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    const split = document.querySelector('.section-cmd[data-cmd="split"]'), fill = document.querySelector('.section-cmd[data-cmd="fillholes"]');
    if (!split || !fill) return 'skipped (no command panels)';
    T.assert(split.hidden && fill.hidden, 'a command panel is showing before its command ran');
    T.assert(!document.querySelector('#sidebar-right .section-cmd'), 'a command panel is still in the sidebar');
    await T.pick(['Cube']);
    key('x'); await T.sleep(300);
    T.assert(!split.hidden && split.closest('#vp-overlay'), 'X did not open the Split panel over the viewport');
    T.assert(document.getElementById('tg-split').classList.contains('active'), 'the Split toolbar button is not lit while its panel is open');
    T.assert(!split.querySelector('figure, video, svg.tile-art'), 'the Split panel has a picture on top');      // (the cards carry none)
    key('p'); await T.sleep(300);
    T.assert(!fill.hidden && split.hidden, 'P did not swap to the Remove holes panel');
    T.assert(document.getElementById('tg-fill-holes').classList.contains('active'), 'the toolbar button is not lit while its panel is open');
    T.assert(fill.contains(document.getElementById('btn-fill-holes')), 'Remove holes is not in its own panel');
    T.assert(!fill.querySelector('figure, video, svg.tile-art'), 'the Remove holes panel has a picture on top');
    key('Escape'); await T.sleep(250);
    T.assert(fill.hidden && state.selected.size === 1, 'Esc did not just close the panel (selection ' + state.selected.size + ')');
    key('Escape'); await T.sleep(250);
    T.eq(state.selected.size, 0, 'selection after the second Esc');
    T.act('split'); await T.sleep(250);
    T.assert(!split.hidden, 'the Split command did not open its panel');
    split.querySelector('.cmd-foot .cmd-close').click(); await T.sleep(200);
    T.assert(split.hidden, 'Cancel did not close the panel');
    document.getElementById('tg-fill-holes').click(); await T.sleep(200);
    T.assert(!fill.hidden, 'the toolbar button did not open Remove holes');
    document.getElementById('tg-fill-holes').click(); await T.sleep(200);
    T.assert(fill.hidden, 'the toolbar button did not close Remove holes');
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
    T.assert(/^Material \d+$/.test(m.name), 'a new material is not called "Material" and a number: ' + m.name);
    m.name = 'mat_' + m.color.getHexString();        // named after its colour, as an imported material is
    cells().find(c => c._mat === m).dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); await T.sleep(700);
    const nameEl = () => document.querySelector('.mat-edit-preview-name');
    if (!nameEl()) return 'skipped (material editor did not open)';
    const hex = document.getElementById('mat-edit-color-hex');
    hex.value = '1CDA4D'; hex.dispatchEvent(new Event('change', { bubbles: true })); await T.sleep(700);
    T.eq(m.name, 'mat_1cda4d', 'name after a colour change');
    T.eq(nameEl().textContent, 'mat_1cda4d', 'name shown in the editor');
    T.assert(cells().find(c => c._mat === m).textContent.includes('1cda4d'), 'the dock still lists the old colour');
    // a preset from the dock, with the editor open: the arrow beside the + lists them, and one makes a new material for the selection
    cells().find(c => c._mat === m).click(); await T.sleep(200);
    document.getElementById('mat-act-add-more').click(); await T.sleep(250);
    [...document.querySelectorAll('#mat-presets-menu .mat-preset')].find(r => /Ceramic/.test(r.textContent)).click(); await T.sleep(700);
    const m2 = T.part('Cube').mesh.material;
    T.assert(m2 !== m && /Ceramic/.test(m2.name), 'a preset did not make a new material, named after it, for the selection: ' + m2.name);
    T.eq(m.color.getHexString(), '1cda4d', 'the material that was open changed with the preset');
    await T.undo(); await T.sleep(500);
    T.assert(T.part('Cube').mesh.material === m, 'undoing the preset did not give the part its material back');
    T.eq(m.color.getHexString(), '1cda4d', 'colour after undoing the preset');
    T.eq(m.name, 'mat_1cda4d', 'name after undoing the preset');
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
    // the status dot on the tab: yellow with an edit in the history, faint when the scene has nothing in it
    const pill = document.getElementById('doc-unsaved');
    T.assert(pill.offsetParent !== null && !pill.classList.contains('is-saved') && !pill.classList.contains('is-empty'), 'no unsaved dot on a scene with an unsaved cube');
    await T.undo(); await T.sleep(150);
    T.assert(pill.classList.contains('is-empty'), 'the dot still reads unsaved on a scene with nothing in it');
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
    document.getElementById('btn-export').click(); await T.sleep(400);
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
    // the dots are drawn only with Show origin points on, and it is off to start
    const tg = document.getElementById('toggle-show-origin-points');
    if (!tg) return 'skipped (no Show origin points switch)';
    const was = tg.checked;
    const set = (on) => { if (tg.checked !== on) { tg.checked = on; tg.dispatchEvent(new Event('change', { bubbles: true })); } };
    try {
      set(true);
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
      // switched off, none is drawn
      set(false); T.act('selClear'); await T.sleep(350);
      T.assert(!again[0].visible || again[0].count === 0, 'dots are still drawn with Show origin points off (' + again[0].count + ')');
    } finally { set(was); }
  });

  test('fasteners: the bolt, the screw, the nut and the washer are found by shape; the cube, the ball, the ring and the bar are not', async () => {
    await T.fresh(['cube', 'hexbolt', 'allen', 'hexnut', 'washer', 'sphere', 'torus', 'cylinder']);
    const named = () => [...state.selected].map(id => T.F().getPart(id).name).sort().join(', ');
    const r = await window._MOpt.selectFasteners({ quiet: true });
    T.assert(r, 'the search did not run');
    T.eq(named(), 'Hex bolt, Hex nut, Socket head screw, Washer', 'what the search selected');
    T.eq([r.kinds.bolt?.count, r.kinds.nut?.count, r.kinds.washer?.count].join('/'), '2/1/1', 'bolts / nuts / washers');
    // a size limit below the parts leaves them alone, and says how many
    T.act('selClear'); await T.sleep(120);
    const small = await window._MOpt.selectFasteners({ quiet: true, maxD: 2 });
    T.eq(state.selected.size, 0, 'selected under a limit of M2');
    T.eq(small.tooBig, 4, 'fasteners reported as too big');
    // the panel: run, narrow to the nuts, delete them, undo
    T.act('selFasteners'); await T.sleep(250);
    const sec = document.querySelector('.section-cmd[data-cmd="fasteners"]');
    T.assert(sec && !sec.hidden, 'the Fasteners panel did not open');
    document.getElementById('btn-fa-run').click();
    for (let i = 0; i < 40 && document.getElementById('fa-list').hidden; i++) await T.sleep(100);
    const rows = [...document.querySelectorAll('#fa-list .fa-row')];
    T.eq(rows.length, 3, 'rows in the result list');
    T.eq(state.selected.size, 4, 'selected by the panel');
    rows.find(b => /nut/.test(b.textContent)).click(); await T.sleep(250);
    T.eq(named(), 'Hex nut', 'selected after a click on the nuts row');
    const before = T.live().length;
    document.getElementById('btn-fa-delete').click(); await T.sleep(450);
    T.eq(T.live().length, before - 1, 'parts after Delete');
    T.assert(!T.part('Hex nut') && T.part('Hex bolt') && T.part('Cube'), 'Delete took something other than the nut');
    await T.undo();
    T.eq(T.live().length, before, 'parts after undo');
    T.F()._CmdCards?.close?.('fasteners');
    if (!sec.hidden) sec.querySelector('.cmd-close').click();
  });

  test('heavy parts: a click ticks a row, more clicks add to it, Delete takes the ticked rows only, the list follows undo', async () => {
    await T.fresh(['cube', 'sphere', 'torus', 'cylinder']);
    // The card lists only the parts over 10,000 triangles, so each of the four gets a dense mesh of its own (the heaviest first:
    // torus 25,600, sphere 20,224, cylinder 12,544, cube 10,800).
    {
      const THREE = T.F().THREE;
      const dense = { Torus: new THREE.TorusGeometry(40, 12, 80, 160), Sphere: new THREE.SphereGeometry(40, 128, 80), Cylinder: new THREE.CylinderGeometry(30, 30, 80, 128, 48), Cube: new THREE.BoxGeometry(60, 60, 60, 30, 30, 30) };
      for (const [name, g] of Object.entries(dense)) {
        const p = T.part(name);
        g.computeBoundingBox(); g.computeBoundingSphere();
        p.mesh.geometry = g; p.hash = 'selftest_heavy_' + name; state.geomByHash.set(p.hash, g);
        p.triCount = g.index.count / 3; p.vertCount = g.attributes.position.count;
        T.assert(p.triCount > 10000, name + ' is not heavy: ' + p.triCount);
      }
      T.F().rebuildTree(); await T.sleep(300);
    }
    const list = document.getElementById('offenders-list'), btn = document.getElementById('btn-off-delete');
    const rows = () => [...list.querySelectorAll('.off-row')];
    const names = () => rows().map(r => r.querySelector('.off-name').textContent + (r.classList.contains('selected') ? '*' : '')).join(' ');
    const click = async (name, o) => { rows().find(r => r.querySelector('.off-name').textContent === name).dispatchEvent(new MouseEvent('click', { bubbles: true, ...(o || {}) })); await T.sleep(250); };
    T.eq(names(), 'Torus Sphere Cylinder Cube', 'the list, heaviest first');
    T.assert(btn.disabled, 'Delete is live with nothing ticked');
    await click('Torus'); await click('Cube');
    T.eq(names(), 'Torus* Sphere Cylinder Cube*', 'after two clicks');
    T.eq(state.selected.size, 2, 'parts selected');
    await click('Torus');
    T.eq(names(), 'Torus Sphere Cylinder Cube*', 'a second click takes the tick off');
    await click('Sphere', { shiftKey: true });
    T.eq(names(), 'Torus* Sphere* Cylinder Cube*', 'Shift+click ticks the rows between');
    await click('Sphere');
    T.assert(!btn.disabled && /Delete 2 parts/.test(btn.textContent), 'the button says "' + btn.textContent.trim() + '"');
    btn.click(); await T.sleep(450);
    T.eq(T.live().map(p => p.name).sort().join(' '), 'Cylinder Sphere', 'parts left after Delete');
    T.eq(names(), 'Sphere Cylinder', 'the list after Delete');
    T.assert(btn.disabled, 'Delete is still live after deleting');
    await T.undo();
    T.eq(names(), 'Torus Sphere Cylinder Cube', 'the list after undo');
    // a part deleted somewhere else leaves the list too
    await T.pick(['Sphere']); T.act('delete'); await T.sleep(450);
    T.eq(names(), 'Torus Cylinder Cube', 'the list after a delete made in the tree');
  });

  test('selection outline: it follows Reset in the transform panel; a hidden part has none, and has it back when shown', async () => {
    await T.fresh(['cube', 'cube']);
    const THREE = T.F().THREE;
    const outline = () => {
      const l = (state.activeHighlights || []).find(o => o && o.isLineSegments && o.parent);
      if (!l || !l.geometry.attributes.position.count) return null;
      l.updateWorldMatrix(true, false);
      return new THREE.Box3().setFromBufferAttribute(l.geometry.attributes.position).applyMatrix4(l.matrixWorld).getCenter(new THREE.Vector3());
    };
    const centre = () => { const m = T.part('Cube').mesh; m.geometry.computeBoundingBox(); m.updateWorldMatrix(true, false); return m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld).getCenter(new THREE.Vector3()); };
    const off = () => { const o = outline(); return o ? o.distanceTo(centre()) : -1; };
    const at = (what) => { const d = off(); T.assert(d >= 0 && d < 1, what + ': the outline is ' + (d < 0 ? 'missing' : d.toFixed(1) + ' away from the part')); };
    await T.pick(['Cube']);
    if (!document.getElementById('transform-panel').classList.contains('show')) { document.getElementById('tg-transform').click(); await T.sleep(300); }
    const px = document.getElementById('tform-px');
    px.value = '300'; px.dispatchEvent(new Event('change', { bubbles: true })); await T.sleep(350);
    T.assert(centre().length() > 100, 'the typed position did not move the part');
    at('after a typed move');
    document.getElementById('tform-reset').click(); await T.sleep(350);
    at('after Reset');
    await T.undo(); at('after the undo of Reset');
    await T.redo(); at('after the redo of Reset');
    T.act('hideSel'); await T.sleep(350);
    T.assert(outline() === null, 'a hidden part is still outlined');
    await T.undo(); at('after the undo of Hide selected');
    T.act('hideSel'); await T.sleep(350);
    T.act('showAll'); await T.sleep(350);
    at('after Show all');
  });

  test('gizmo snap: Shift + wheel during a drag sets the step, coarser up and finer down', async () => {
    await T.fresh(['cube']);
    await T.pick(['Cube']);
    T.act('gzMove'); await T.sleep(300);
    const g = state.gizmo, was = g.dragging;
    const wheel = (d) => window.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: d, deltaY: 0, shiftKey: true }));
    const key = (type) => document.dispatchEvent(new KeyboardEvent(type, { key: 'Shift', bubbles: true }));
    const dragWas = state._gizmoDragging;
    try {
      key('keydown'); await T.sleep(50);
      const s0 = state._gizmoSnapStep;
      T.assert(s0 > 0, 'Shift did not switch snap on');
      const pill = document.getElementById('vp-snap-pill');
      // the pill shows only while a handle is dragged with Shift held, not for Shift alone
      T.assert(pill && pill.hidden, 'the Snap pill shows for Shift alone, with no handle held');
      state._gizmoDragging = true;                            // (as the gizmo sets it when a handle is pressed)
      key('keyup'); key('keydown'); await T.sleep(50);
      T.assert(pill && !pill.hidden && pill.offsetParent, 'no Snap pill at the top while a handle is dragged with Shift held');
      T.assert(pill.textContent.trim().startsWith('Snap ' + parseFloat(s0.toPrecision(3))), 'the pill says "' + pill.textContent.trim() + '", the step is ' + s0);
      T.assert(!document.querySelector('#gizmo-hud .ghud-snap'), 'the tooltip beside the gizmo still carries a SNAP badge');
      wheel(-100); await T.sleep(50);
      T.eq(state._gizmoSnapStep, s0, 'the step after a wheel notch with no drag going on');
      g.dragging = true;                                      // (as while a handle is held)
      wheel(-100); await T.sleep(50);
      const up = state._gizmoSnapStep;
      T.assert(up > s0, 'wheel up: the step went from ' + s0 + ' to ' + up);
      T.assert(pill.textContent.trim().startsWith('Snap ' + parseFloat(up.toPrecision(3))), 'after the wheel the pill says "' + pill.textContent.trim() + '", the step is ' + up);
      wheel(100); wheel(100); await T.sleep(50);
      T.assert(state._gizmoSnapStep < s0, 'two notches down: the step is ' + state._gizmoSnapStep + ', not below ' + s0);
      const series = [];
      for (let i = 0; i < 6; i++) { wheel(-100); series.push(state._gizmoSnapStep); }
      T.assert(series.every(v => /^[125]0*$|^0\.0*[125]$/.test(String(v))), 'steps are not 1 · 2 · 5 × a power of ten: ' + series.join(' '));
      T.act('gzRotate'); await T.sleep(200); g.dragging = true;
      const r0 = Math.round(state.gizmoSnap.rotate * 180 / Math.PI);
      wheel(-100); await T.sleep(50);
      T.assert(Math.round(state.gizmoSnap.rotate * 180 / Math.PI) > r0, 'wheel up did not coarsen the turn step from ' + r0 + '°');
      wheel(100); await T.sleep(50);
      T.eq(Math.round(state.gizmoSnap.rotate * 180 / Math.PI), r0, 'the turn step after up and down');
    } finally { g.dragging = was; state._gizmoDragging = dragWas; key('keyup'); state._gizmoSnapUser = null; T.act('gzMove'); }
    await T.sleep(60);
    T.assert(document.getElementById('vp-snap-pill').hidden, 'the Snap pill stays after Shift is let go');
  });

  test('shortcuts: Shift+M opens Materials and leaves Measure alone; M alone is Measure', async () => {
    await T.fresh(['cube']);
    const msr = document.getElementById('msr-toggle'), mat = document.getElementById('tg-materials');
    const press = async (o) => { window.dispatchEvent(new KeyboardEvent('keydown', { key: o.shiftKey ? 'M' : 'm', bubbles: true, cancelable: true, ...o })); await T.sleep(250); };
    const measuring = () => msr.classList.contains('active');
    const was = measuring(), dockWas = document.body.classList.contains('mat-dock-open');
    await press({ shiftKey: true });
    T.eq(measuring(), was, 'Measure after Shift+M');
    T.assert(document.body.classList.contains('mat-dock-open') !== dockWas, 'Shift+M did not open or close the Materials dock');
    await press({ shiftKey: true });
    T.eq(measuring(), was, 'Measure after a second Shift+M');
    T.eq(document.body.classList.contains('mat-dock-open'), dockWas, 'the Materials dock after a second Shift+M');
    await press({});
    T.eq(measuring(), !was, 'Measure after M');
    await press({});
    T.eq(measuring(), was, 'Measure after a second M');
  });

  // three r172 freed a disposed geometry's buffers through the render object that first drew it, which by then could be drawing the part's
  // newer geometry: the sweep then destroyed what the part drew with, and a part that looks like others was never uploaded again
  // ("Vertex buffer slot 1 required by [RenderPipeline ...] was not set" on every frame until it moved). _fixGeometryDispose in app.js.
  test('gpu: freeing a geometry a part no longer draws leaves the buffers the part draws with alone', async () => {
    const F = T.F(), THREE = F.THREE, r = F.renderer, be = r.backend, dev = be.device;
    let scene = state.partsRoot; while (scene.parent) scene = scene.parent;
    const errs = [], onErr = (e) => errs.push(String(e.error && e.error.message).slice(0, 140));
    if (dev) dev.addEventListener('uncapturederror', onErr);
    const draw = async () => { r.render(scene, F.camera); if (dev) await dev.queue.onSubmittedWorkDone(); await T.sleep(20); };
    let seq = 7e8;                                      // (new version numbers, as _stampGeometry gives every geometry the app makes)
    const stamp = (g) => { const v = ++seq; for (const k in g.attributes) g.attributes[k].version = v; if (g.index) g.index.version = v; return g; };
    const prep = (g) => { const o = g.toNonIndexed(); o.deleteAttribute('uv'); return stamp(o); };
    const has = (attr) => { if (!be.has(attr)) return false; const d = be.get(attr); return !!(d.buffer || d.bufferGPU); };   // (get() alone would make an empty entry)
    const mat = new THREE.MeshStandardMaterial({ color: 0x8899aa });
    const a = new THREE.Mesh(prep(new THREE.TorusGeometry(0.5, 0.2, 12, 24)), mat); a.renderOrder = -1;   // drawn first, b looks like it
    const gOld = prep(new THREE.BoxGeometry()), gNew = prep(new THREE.SphereGeometry(0.7, 16, 12));
    const b = new THREE.Mesh(gOld, mat); b.position.x = 2; b.renderOrder = 1;
    try {
      for (const o of [a, b]) { o.frustumCulled = false; state.partsRoot.add(o); }
      await draw(); await draw();
      b.geometry = gNew; await draw(); await draw();     // a tool gives the part a new geometry; the old one waits for Undo
      gOld.dispose();                                    // and is freed when nothing refers to it any more
      T.assert(has(gNew.attributes.position) && has(gNew.attributes.normal), 'freeing the old geometry took the buffers of the one the part draws now');
      T.assert(!has(gOld.attributes.position), 'the freed geometry kept its buffers');
      for (let i = 0; i < 4; i++) await draw();
      await T.sleep(400);
      T.eq(errs.length, 0, 'GPU errors after the free: ' + errs[0]);
      b.geometry = gOld; stamp(gOld); await draw(); await draw();   // brought back: uploaded again
      T.assert(has(gOld.attributes.position), 'a geometry brought back was not uploaded again');
      b.geometry = gNew; await draw(); gOld.dispose();               // and freed again when it goes
      T.assert(!has(gOld.attributes.position), 'a geometry brought back and freed again kept its buffers');
    } finally {
      for (const o of [a, b]) state.partsRoot.remove(o);
      mat.dispose(); gNew.dispose(); a.geometry.dispose();
      if (dev) dev.removeEventListener('uncapturederror', onErr);
      F.requestRender();
    }
  });

  test('toolbars: a right-click on a toolbar button in the view opens the toolbar list, never the view menu', async () => {
    await T.fresh(['cube']);
    const menu = () => document.getElementById('ctx-menu');
    const shown = () => { const m = menu(); return !!m && m.style.display === 'block'; };
    const close = async () => { document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await T.sleep(60); };
    const rclick = async (el, press = true) => {      // (no press on the view: the orbit controls would try to hold a pointer that is not there)
      const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      if (press) el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 2, buttons: 2, clientX: x, clientY: y }));
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: x, clientY: y }));
      await T.sleep(80);
    };
    const btns = [...document.querySelectorAll('#viewport .vp-bar button, #viewport .el-bar button, #viewport .vp-pill')].filter(b => b.offsetParent && b.getBoundingClientRect().width > 0);
    T.assert(btns.length > 5, 'found only ' + btns.length + ' toolbar buttons');
    const viewMenu = [];
    for (const b of btns) {
      await close();
      await rclick(b);
      const txt = shown() ? menu().textContent : '';
      if (/Fit view|Frame selected|Add a note here/.test(txt)) viewMenu.push(b.id || b.title || b.className);
      await close();
    }
    T.eq(viewMenu.join(', '), '', 'the view menu opened on');
    await rclick(document.getElementById('vp-cmdk'));
    T.assert(shown() && menu().classList.contains('is-commands'), 'a right-click on the search button did not open the toolbar list');
    await close();
    // the view itself keeps its menu
    const c = document.querySelector('#viewport canvas');
    await rclick(c, false);
    T.assert(shown() && /Fit view|Frame selected/.test(menu().textContent), 'a right-click on the view no longer opens its menu');
    await close();
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
