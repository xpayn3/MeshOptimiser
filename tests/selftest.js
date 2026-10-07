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
    await T.undoable('smart fit', async () => { T.act('smartFit'); }, { wait: 1200 });
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
    const icon = document.querySelector('#tree .tree-node svg');
    T.assert(!!icon, 'no rendered icon found in the tree');
    icon.__keep = true;
    const t0 = performance.now();
    for (const n of ['Sphere', 'Torus', 'Cone', 'Cylinder', 'Cube']) T.row(n).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const per = (performance.now() - t0) / 5;
    T.assert(per < 40, 'a selection click took ' + per.toFixed(1) + ' ms');
    await T.sleep(300);
    T.assert(document.querySelector('#tree .tree-node svg').__keep === true, 'tree icons were re-created by a selection change');
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

    const box = document.createElement('div');
    box.id = 'selftest-panel';
    box.style.cssText = 'position:fixed;right:12px;bottom:34px;z-index:99999;width:440px;max-height:60vh;overflow:auto;background:#161616;border:1px solid #333;border-radius:10px;padding:10px 12px;font:11.5px/1.5 ui-monospace,Consolas,monospace;color:#ddd;box-shadow:0 12px 36px rgba(0,0,0,.6);white-space:pre-wrap';
    document.body.appendChild(box);
    const line = (txt, color) => { const d = document.createElement('div'); d.textContent = txt; if (color) d.style.color = color; box.appendChild(d); box.scrollTop = box.scrollHeight; };
    line('MeshOptimiser self-test — ' + list.length + ' tests', '#4db5ff');

    // wait for the app to finish booting
    for (let i = 0; i < 100 && !(window._appFns && window._addPrimitive && window.state && state.partsRoot); i++) await T.sleep(100);
    await T.sleep(600);

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
    res.done = true;
    line('\n' + res.passed + ' passed, ' + res.failed + ' failed' + (res.skipped ? ', ' + res.skipped + ' skipped' : ''), res.failed ? '#ff6b6b' : '#34c759');
    console.log('[selftest] done: ' + res.passed + ' passed, ' + res.failed + ' failed, ' + res.skipped + ' skipped');
  }
  run();
})();
