// X-ray isolate. In Filters & flags, the X-ray button next to Highlight and Isolate: the flagged parts stay as they are and every other part
// is drawn as a see-through ghost (its own material, made see-through), so the flagged ones are seen in place, among
// the rest. How much of the ghosts shows is set with the dial: hold the comma key, move the pointer up or down (or turn the wheel); a tick
// goes by for each percent, a click at every ten.
//
// How a ghost is made: the mesh of a part gets, for each of its materials, a copy of that material made see-through (so it is lit and coloured
// as the part is, not drawn another way, and it does not glow); it does not write depth, so it is drawn after the solid parts and what is
// behind it shows. The mesh gets its own material back when it is no longer a ghost.
// Which faces: a closed shell is drawn by its front faces only (its far inside wall would show through the near one, doubling it); an open
// sheet is drawn on both sides (one layer: nothing doubles, and it does not vanish seen from behind). Which of the two a part is, is read once
// from its edges (every edge shared by two triangles: closed); small ones at once, big ones a few at a time in the background.
// The order the ghosts are drawn in: three sorts see-through objects by the origin of each, not by where its shape is, so a part whose origin is
// far from its shape (a CAD part, a sheet) jumped in front of or behind another as the camera moved. They are sorted here instead, from the
// depth of the middle of each one's shape, once before every picture (the scene's onBeforeRender), and given a draw order of their own.
// The parts that are left as they are: the flagged ones, the selected ones (so a material edited on a selected part is the real one), hidden
// ones, parts that are drawn as instances of a shared mesh, groups, cloners and lines. While a job runs, the ghosts are put back (a tool that
// reads the materials sees the real ones), and an export or a save never sees a ghost (see _ghostOrig in app.js).
//
// app: the objects and functions of app.js this uses (see the call in app.js)
export function installXrayGhost(app) {
  const { state, THREE, _Prefs, _UiSound, _Job, toast, requestRender, getScene } = app;
  const btn = document.getElementById('btn-xray-isolate');
  if (!btn || btn._wired) return null;
  btn._wired = true;
  let on = false, timer = 0;
  const ghosts = new Map();       // an original material → { front, double }: its ghosts (front faces only, or both sides)
  const swapped = new Map();      // a mesh → { orig, cast }
  const pct = () => { const v = +_Prefs.get('ghostOpacity'); return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 18; };

  const isGhost = (m) => Array.isArray(m) ? m.some(x => x && x.userData && x.userData.isGhost) : !!(m && m.userData && m.userData.isGhost);
  // The ghost of a material is that material (its colour, its roughness and metal, its pictures, how it is lit) made see-through, not another
  // look: no glow. It does not write depth, so what is behind it shows; its own side setting is kept.
  // At full strength a ghost is the part itself: opaque and writing depth, so the near face hides the far ones (blending a fully opaque
  // copy far to near, with no depth, drew the inside of a shell over its outside). Below that it is see-through and writes no depth.
  function solidify(g, o) {
    const solid = o >= 0.995, was = g.transparent;
    g.opacity = o; g.transparent = !solid; g.depthWrite = solid; g.visible = o > 0.002;
    if (was !== g.transparent) g.needsUpdate = true;
  }
  function ghostOf(m, both) {
    let pair = ghosts.get(m);
    if (!pair) { pair = { front: null, double: null }; ghosts.set(m, pair); }
    const k = both ? 'double' : 'front';
    let g = pair[k];
    if (!g) {
      g = m.clone();
      g.userData = { isGhost: true, _ghostOf: m };
      g.depthTest = true; solidify(g, pct() / 100);
      g.side = both ? THREE.DoubleSide : THREE.FrontSide;
      g.visible = g.opacity > 0.002;      // (at 0 % nothing is drawn at all)
      g.needsUpdate = true;
      pair[k] = g;
    }
    return g;
  }
  const eachGhost = (f) => { for (const p of ghosts.values()) { if (p.front) f(p.front); if (p.double) f(p.double); } };
  // Is the shape closed: no edge with one triangle only? The points are welded by position (to a millionth of the size of the part) first, as a
  // mesh with a seam, or with a point for each corner of each triangle, is closed all the same. Read once for each geometry.
  const closedOf = new WeakMap();
  function isClosed(geom) {
    if (closedOf.has(geom)) return closedOf.get(geom);
    const pos = geom.attributes && geom.attributes.position;
    let closed = true;
    if (pos && pos.count) {
      const idx = geom.index ? geom.index.array : null, n = pos.count, T = idx ? Math.floor(idx.length / 3) : Math.floor(n / 3);
      if (T <= 400000) {
        if (!geom.boundingSphere) geom.computeBoundingSphere();
        const q = 1 / Math.max(1e-12, (geom.boundingSphere ? geom.boundingSphere.radius : 1) * 2e-6);
        const ids = new Int32Array(n), map = new Map();
        for (let i = 0; i < n; i++) {
          const k = Math.round(pos.getX(i) * q) + ',' + Math.round(pos.getY(i) * q) + ',' + Math.round(pos.getZ(i) * q);
          let id = map.get(k); if (id === undefined) { id = map.size; map.set(k, id); } ids[i] = id;
        }
        const N = map.size + 1, edges = new Map();
        const add = (a, b) => { if (a === b) return; const e = a < b ? a * N + b : b * N + a; edges.set(e, (edges.get(e) || 0) + 1); };
        for (let t = 0; t < T; t++) {
          const a = ids[idx ? idx[t * 3] : t * 3], b = ids[idx ? idx[t * 3 + 1] : t * 3 + 1], c = ids[idx ? idx[t * 3 + 2] : t * 3 + 2];
          add(a, b); add(b, c); add(c, a);
        }
        for (const c of edges.values()) if (c === 1) { closed = false; break; }
      }
    }
    closedOf.set(geom, closed);
    return closed;
  }
  const trisOf = (g) => (g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0)) / 3;
  const CLOSED_FRONT_ONLY = false;      // true: a closed shell is drawn by its front faces only (tried; the plain material, both sides, looks better)
  const queue = [];      // the meshes whose shape is not read yet (big ones): a few at a time, in refresh
  const ghostMat = (orig, both) => (Array.isArray(orig) ? orig.map(m => ghostOf(m, both)) : ghostOf(orig, both));
  // Only the nearest surface of a ghost is drawn: before its colour, the same shape is drawn into the depth buffer alone (a child with a material that
  // writes no colour), so the faces behind that surface (the inside of a shell, the far wall) fail the depth test and never blend over it. The
  // child sits in the see-through queue, one step before its ghost.
  let preMat = null;
  function addPre(mesh) {
    if (!preMat) { preMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, depthTest: true, side: THREE.DoubleSide, transparent: true, opacity: 1 }); preMat.userData = { isGhostPre: true }; }
    const pre = new THREE.Mesh(mesh.geometry, preMat);
    pre.userData = { isGhostPre: true };
    pre.matrixAutoUpdate = false; pre.castShadow = false; pre.receiveShadow = false; pre.frustumCulled = mesh.frustumCulled;
    pre.raycast = () => {}; pre.layers.mask = mesh.layers.mask;
    mesh.add(pre);
    return pre;
  }
  function swap(mesh) {
    const orig = mesh.material;
    if (!orig || isGhost(orig)) return;
    swapped.set(mesh, { orig, cast: mesh.castShadow, order: mesh.renderOrder, pre: addPre(mesh) });
    // both sides until the shape is read (a closed one then goes to front faces only): small shapes are read now, big ones in the background
    const g = mesh.geometry;
    let both = true;
    if (!CLOSED_FRONT_ONLY) { mesh.material = ghostMat(orig, true); mesh.castShadow = false; return; }
    if (g && closedOf.has(g)) both = !closedOf.get(g);
    else if (g && trisOf(g) <= 20000) both = !isClosed(g);
    else if (g) queue.push(mesh);
    mesh.material = ghostMat(orig, both);
    mesh.castShadow = false;
  }
  function restore(mesh) {
    const s = swapped.get(mesh); swapped.delete(mesh);
    if (!s) return;
    if (isGhost(mesh.material)) mesh.material = s.orig;      // (a material that was put on since stays)
    mesh.castShadow = s.cast; mesh.renderOrder = s.order;
    if (s.pre) mesh.remove(s.pre);
  }
  const restoreAll = () => { for (const m of [...swapped.keys()]) restore(m); };
  const ghostable = (p, flagged) => !!p && !p.deleted && p.visible !== false && !!p.mesh && p.mesh.isMesh && !p.instancedMesh && !p.isCloner && !p.isSpline
    && !flagged.has(p.partId) && !state.selected.has(p.partId);

  // Far to near by the depth of the middle of each ghost's shape (its bounding sphere, in the camera's space); each gets a draw order of its own, in
  // 100 and up (the selection and the flags draw at 997 and over), so three does not sort them again by the origins. Spread over 800 steps at most.
  const ORDER0 = 100, v3 = new THREE.Vector3();
  function sortGhosts(camera) {
    if (!on || !swapped.size || !camera) return;
    camera.updateMatrixWorld(true);
    const inv = camera.matrixWorldInverse, list = [];
    for (const mesh of swapped.keys()) {
      const g = mesh.geometry; if (!g) continue;
      if (!g.boundingSphere) g.computeBoundingSphere();
      if (!g.boundingSphere) continue;
      mesh.updateWorldMatrix(true, false);
      v3.copy(g.boundingSphere.center).applyMatrix4(mesh.matrixWorld).applyMatrix4(inv);
      list.push([v3.z, mesh]);
    }
    list.sort((a, b) => a[0] - b[0] || a[1].id - b[1].id);      // (the camera looks down -z: the furthest is the most negative, and is drawn first)
    const step = list.length > 800 ? 800 / list.length : 1;
    const solid = pct() / 100 >= 0.995;
    for (let i = 0; i < list.length; i++) {
      const mesh = list[i][1], o = ORDER0 + Math.floor(i * step), s = swapped.get(mesh);
      mesh.renderOrder = o;
      if (s && s.pre) { s.pre.renderOrder = o - 0.5; s.pre.visible = !solid && mesh.visible; }      // (a full-strength ghost is the part itself: no pass needed)
    }
  }
  let hooked = null;
  function hook() {
    const sc = getScene && getScene();
    if (!sc || hooked) return;
    const prev = sc.onBeforeRender;
    sc.onBeforeRender = function (r, s, camera) { try { sortGhosts(camera); } catch (_) {} return prev ? prev.apply(this, arguments) : undefined; };
    hooked = { sc, prev };
  }
  function unhook() { if (hooked) { hooked.sc.onBeforeRender = hooked.prev; hooked = null; } }

  // The ghosts follow the flags, the selection and the visibility (a few times a second, only while it is on).
  function refresh() {
    if (!on || document.hidden) return;
    let busy = ''; try { busy = _Job.busy(); } catch (_) {}
    const flagged = state.pendingFlagged, keep = new Set();
    let changed = false;
    if (flagged && flagged.size && !busy) for (const p of state.parts) if (ghostable(p, flagged)) { keep.add(p.mesh); if (!swapped.has(p.mesh)) { swap(p.mesh); changed = true; } }
    for (const m of [...swapped.keys()]) if (!keep.has(m)) { restore(m); changed = true; }
    // a few of the big shapes are read (40 ms at most), and the ghosts of the closed ones go to front faces only
    const t0 = performance.now();
    while (queue.length && performance.now() - t0 < 40) {
      const mesh = queue.shift(), s = swapped.get(mesh);
      if (!s || !mesh.geometry || !isGhost(mesh.material)) continue;
      mesh.material = ghostMat(s.orig, !isClosed(mesh.geometry)); changed = true;
    }
    if (changed) requestRender();
  }
  function paintButton() { btn.classList.toggle('active', on); btn.setAttribute('aria-pressed', on ? 'true' : 'false'); }
  function setOn(v) {
    v = !!v;
    if (v === on) return;
    if (v && !(state.pendingFlagged && state.pendingFlagged.size)) { toast('Nothing flagged', 'Flag some parts first (Flag low-poly, Flag slivers, or the size threshold)', 'warn', 2800); return; }
    on = v; paintButton();
    if (on) { hook(); refresh(); timer = setInterval(refresh, 250); }
    else { clearInterval(timer); timer = 0; unhook(); restoreAll(); queue.length = 0; eachGhost(g => g.dispose()); ghosts.clear(); hide(); requestRender(); }
  }
  btn.addEventListener('click', () => setOn(!on));

  // ── the dial ──
  const R = 80, W = 24, STEP = 3, RIB = 5;      // (a band of 24 at radius 80; a rib every 3 degrees, so one for each percent over 300 degrees)
  const angleOf = (v) => v * 3 - 150;           // 0 to 100 % over 300 degrees, 50 % at the top
  const ptAt = (deg, r) => { const a = deg * Math.PI / 180; return [r * Math.sin(a), -r * Math.cos(a)]; };
  let dial = null, held = null, px = 0, py = 0;
  function dialMake() {
    if (dial) return dial;
    const ro = R + W / 2, ri = ro - RIB, d = 0.85 / ro * 180 / Math.PI;
    let lo = '', body = '', hi = '';
    const seg = (deg) => { const a = ptAt(deg, ri), b = ptAt(deg, ro); return 'M' + a[0].toFixed(1) + ' ' + a[1].toFixed(1) + 'L' + b[0].toFixed(1) + ' ' + b[1].toFixed(1); };
    for (let deg = 0; deg < 360; deg += STEP) { lo += seg(deg + d); body += seg(deg); hi += seg(deg - d); }
    let figs = '';
    for (let v = 0; v <= 100; v += 10) {
      const deg = angleOf(v), p = ptAt(deg, R - 2);
      figs += '<text class="fr-num" x="' + p[0].toFixed(1) + '" y="' + (p[1] + 3).toFixed(1) + '" transform="rotate(' + deg.toFixed(1) + ' ' + p[0].toFixed(1) + ' ' + p[1].toFixed(1) + ')">' + v + '</text>';
    }
    const m0 = -(R - W / 2 + 3), m1 = -(R + W / 2 - 3);
    dial = document.createElement('div');
    dial.className = 'xray-dial'; dial.setAttribute('aria-hidden', 'true');
    dial.innerHTML = '<svg viewBox="-122 -122 244 244"><g class="fr-ring is-active"><circle class="fr-band" r="' + R + '" stroke-width="' + W + '"/><g class="fr-turn">'
      + '<path class="fr-rib-lo" d="' + lo + '"/><path class="fr-rib" d="' + body + '"/><path class="fr-rib-hi" d="' + hi + '"/><circle class="fr-lip" r="' + ri.toFixed(1) + '"/>' + figs
      + '</g><path class="fr-mark" d="M0 ' + m0.toFixed(1) + 'V' + m1.toFixed(1) + '"/></g>'
      + '<text class="fr-name" y="' + (-(R + 22)) + '"></text><text class="xd-val" y="7"></text></svg>';
    document.body.appendChild(dial);
    dial._turn = dial.querySelector('.fr-turn'); dial._name = dial.querySelector('.fr-name'); dial._val = dial.querySelector('.xd-val');
    return dial;
  }
  const paintDial = () => {
    const D = dialMake(), v = pct();
    D._turn.setAttribute('transform', 'rotate(' + (-angleOf(v)).toFixed(2) + ')');
    const t = Math.round(v) + ' %';
    if (D._val.textContent !== t) D._val.textContent = t;
    if (D._name.textContent !== 'X-ray') D._name.textContent = 'X-ray';
  };
  function show(x, y) {
    const D = dialMake();
    D.style.left = Math.round(x) + 'px'; D.style.top = Math.round(y) + 'px';
    held = { raw: pct(), y, at: Math.round(pct()), snap: false };
    paintDial(); D.classList.add('show');
  }
  function hide() { held = null; if (dial) { dial.classList.remove('show'); dial.classList.remove('is-snap'); } }
  const setPct = (v) => {
    v = Math.max(0, Math.min(100, v));
    _Prefs.set('ghostOpacity', v);
    eachGhost(g => solidify(g, v / 100));
    paintDial(); requestRender();
  };
  // a turn: the raw value follows the pointer; within 1.5 % of a multiple of ten it holds on that (Shift: fine, no holding)
  function turn(dy, fine) {
    if (!held) return;
    held.raw = Math.max(0, Math.min(100, held.raw - dy * (fine ? 0.08 : 0.35)));
    const near = Math.round(held.raw / 10) * 10, onMark = !fine && Math.abs(held.raw - near) <= 1.5;
    const v = onMark ? near : held.raw;
    setPct(v);
    const at = Math.round(v);
    if (onMark && !held.snap) _UiSound.click();
    else if (at !== held.at) _UiSound.tick(Math.abs(dy));
    held.at = at;
    if (held.snap !== onMark) { held.snap = onMark; dial.classList.toggle('is-snap', onMark); }
  }
  const typing = (t) => !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  window.addEventListener('keydown', (e) => {
    if (e.key !== ',' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || typing(e.target)) return;
    if (e.repeat) { if (held) e.preventDefault(); return; }
    if (!on) { toast('X-ray isolate is off', 'Switch X-ray on in Filters & flags first', 'info', 2200); return; }
    e.preventDefault(); show(px, py);
  }, true);
  window.addEventListener('keyup', (e) => { if (e.key === ',') hide(); }, true);
  window.addEventListener('blur', hide);
  window.addEventListener('pointermove', (e) => {
    const dy = e.clientY - py; px = e.clientX; py = e.clientY;
    if (held && dy) turn(dy, e.shiftKey);
  }, true);
  window.addEventListener('wheel', (e) => {
    if (!held) return;
    e.preventDefault(); e.stopImmediatePropagation();      // (the wheel does not zoom the camera meanwhile)
    held.raw = Math.max(0, Math.min(100, Math.round(held.raw / 5) * 5 + (e.deltaY > 0 ? -5 : 5)));
    setPct(held.raw); _UiSound.tick(8);
  }, { capture: true, passive: false });

  paintButton();
  return {
    get on() { return on; }, setOn, refresh,
    get opacity() { return pct(); }, setOpacity: setPct,
    get ghosted() { return swapped.size; },      // (tests)
    sortNow: (camera) => sortGhosts(camera),      // (tests)
    get unread() { return queue.length; },      // (tests: big shapes not read yet)
    get dialShown() { return !!(dial && dial.classList.contains('show')); },
    _t: { show, hide, turn },
  };
}
