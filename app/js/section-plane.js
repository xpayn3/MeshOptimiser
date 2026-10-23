// section-plane.js — Section view, stage 1: one plane through the whole scene, the parts cut by it, and the inside of the cut drawn flat.
//
// three.js r186's WebGPURenderer ignores `renderer.clippingPlanes` and `material.clippingPlanes`: it clips only what is inside a
// ClippingGroup (three.webgpu.js: ClippingContext.getGroupContext). So state.partsRoot is a ClippingGroup (made where it is created in
// app.js), switched off until the section is on; its planes are world planes (the group's own matrix is not applied to them).
//
// A cut shows the inside of a hollow solid as nothing: the back faces are culled. So every part mesh gets a TWIN while the section is
// on: the same geometry, one flat colour, only its BACK faces, drawn first (render order -1000) inside a second ClippingGroup with the
// same plane. Where a front face is nearer it wins the depth test; where the plane has cut it away the flat back face behind it stays,
// and that reads as the cut face of the solid. It is all one pass of the normal frame, so it holds for the screenshot, the capture and
// Photo mode too, and the MSAA buffer is not asked to keep a first pass (a second render() into the same frame loses it: tried).
// It is right for closed solids, which is what a CAD part is; it draws no outline or hatching, and a part with an open mesh shows its
// inside in the same flat colour.
//
// Light: only the meshes the plane passes through get a twin (made when first needed; the others are whole or gone and a twin would
// only cost draws). Each frame checks every part's world matrix, geometry and visibility against what it was (a few numbers each,
// no scene walk) and takes up the ones that changed, so Explode, a move or a hide carries the cut faces with it; moving the plane is
// a comparison per mesh.
//
// It is for looking at the cut, so nothing can be selected while it is on: the view's mouse events (the camera uses the pointer
// events, which are left alone) and the rows of the tree are swallowed, so there is no pick and no hover, and the selection is
// cleared when it is turned on. The panels are not touched: Explode, the scale of the view and the rest work.
//
// Not yet: the selection outlines, wireframes and CAD edges that sit in the scene beside partsRoot are not cut; an exploded part's twin
// is where the part was (the explode moves it in its material, not in its matrix); transparent parts get no twin.
import * as THREE from 'three';

const AX = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

export function installSectionPlane(app) {
  const { state } = app;
  const plane = new THREE.Plane(AX.z.clone(), 0);
  const S = { on: false, axis: 'z', t: 0.5, flip: false };
  let span = [0, 0], capMat = null, pill = null, card = null, scrub = null, twinRoot = null, nParts = -1, shownKey = -1;
  const items = [];      // { m: a part mesh, box: its world box, t: its twin or null, e: its world matrix as it was, g: its geometry, iv: its instances' version }

  const group = () => (state.partsRoot && state.partsRoot.isClippingGroup ? state.partsRoot : null);
  const measure = () => {
    if (!state.partsRoot) { span = [0, 0]; return; }
    const b = new THREE.Box3().setFromObject(state.partsRoot);
    span = b.isEmpty() ? [0, 0] : [b.min[S.axis], b.max[S.axis]];
  };
  const at = () => span[0] + (span[1] - span[0]) * S.t;

  // the plane follows the axis, the position and the flip; the group clips with it while the section is on
  function sync() {
    const g = group();
    if (!g) return;
    const sg = S.flip ? -1 : 1;
    plane.normal.copy(AX[S.axis]).multiplyScalar(sg);
    plane.constant = -sg * at();
    g.clippingPlanes = [plane];
    g.enabled = S.on;
    if (S.on) crossing();
    app.requestRender();
  }

  function cap() {
    if (!capMat) capMat = new THREE.MeshBasicNodeMaterial({ color: 0x4f9dde, side: THREE.BackSide, fog: false, toneMapped: false });
    return capMat;
  }

  const meshOk = (m) => m.isMesh && m.geometry && !(Array.isArray(m.material) ? m.material[0] : m.material)?.transparent;
  function makeTwin(m) {
    const t = m.isInstancedMesh ? new THREE.InstancedMesh(m.geometry, cap(), m.count) : new THREE.Mesh(m.geometry, cap());
    if (m.isInstancedMesh) t.instanceMatrix = m.instanceMatrix;
    t.matrixAutoUpdate = false; t.matrixWorldAutoUpdate = false; t.matrixWorld.copy(m.matrixWorld);
    t.frustumCulled = m.frustumCulled; t.renderOrder = -1000; t.castShadow = false; t.receiveShadow = false; t.layers.mask = m.layers.mask;
    t.name = '_sectionTwin';
    return t;
  }
  const shown = (o) => { for (; o && o !== state.partsRoot; o = o.parent) if (!o.visible) return false; return true; };
  const worldBox = (m) => {
    let box;
    if (m.isInstancedMesh) { m.computeBoundingBox(); box = m.boundingBox; }
    else { if (!m.geometry.boundingBox) m.geometry.computeBoundingBox(); box = m.geometry.boundingBox; }
    return box && !box.isEmpty() ? box.clone().applyMatrix4(m.matrixWorld) : null;
  };
  const stamp = (it) => { it.e = it.m.matrixWorld.elements.slice(); it.g = it.m.geometry; it.iv = it.m.isInstancedMesh ? it.m.instanceMatrix.version : 0; };
  const changed = (it) => {
    const m = it.m, e = m.matrixWorld.elements, o = it.e;
    if (m.geometry !== it.g || (m.isInstancedMesh && m.instanceMatrix.version !== it.iv)) return true;
    for (let i = 0; i < 16; i++) if (e[i] !== o[i]) return true;
    return false;
  };
  // every part mesh and its world box (all of them, shown or not: one that is shown later has its place)
  function collect(scene) {
    if (!twinRoot) { twinRoot = new THREE.ClippingGroup(); twinRoot.name = '_sectionTwins'; twinRoot.clippingPlanes = [plane]; }
    if (twinRoot.parent !== scene) scene.add(twinRoot);
    twinRoot.enabled = true;
    clearTwins();
    state.partsRoot.updateMatrixWorld(true);
    const visit = (o) => {
      if (o !== state.partsRoot && meshOk(o)) {
        const box = worldBox(o);
        if (box) { const it = { m: o, box, t: null }; stamp(it); items.push(it); }
      }
      for (const c of o.children) visit(c);
    };
    visit(state.partsRoot);
    nParts = state.parts.length;
  }
  // the twins of the meshes the plane passes through (and that are shown) are shown, made the first time; the others are hidden
  function crossing() {
    if (!items.length) return;
    const a = S.axis, v = at();
    for (const it of items) {
      const hit = it.box.min[a] <= v && it.box.max[a] >= v && shown(it.m);
      if (hit && !it.t) { it.t = makeTwin(it.m); twinRoot.add(it.t); }
      if (it.t) it.t.visible = hit;
    }
  }
  function clearTwins() {
    for (const it of items) if (it.t) twinRoot?.remove(it.t);
    items.length = 0;
  }
  function dropTwins() {
    clearTwins();
    if (twinRoot && twinRoot.parent) twinRoot.parent.remove(twinRoot);
  }

  // a frame: what moved, changed its geometry or was shown or hidden since the last one is taken up (parts that came or went: all
  // again), then the plain render
  function render(scene, camera) {
    if (S.on && group()) {
      if (nParts !== state.parts.length) { collect(scene); crossing(); }
      else {
        let any = false;
        for (const it of items) {
          if (changed(it)) {
            const box = worldBox(it.m);
            if (box) it.box = box;
            if (it.t) { it.t.matrixWorld.copy(it.m.matrixWorld); if (it.t.geometry !== it.m.geometry) it.t.geometry = it.m.geometry; if (it.m.isInstancedMesh) { it.t.count = it.m.count; it.t.instanceMatrix = it.m.instanceMatrix; } }
            stamp(it); any = true;
          }
        }
        let key = 0;
        for (const it of items) if (shown(it.m)) key++;
        if (any || key !== shownKey) { shownKey = key; crossing(); }
      }
    }
    app.renderer.render(scene, camera);
  }

  // nothing can be picked while the section is on: the mouse events of the view and of the tree's rows (not its icons) are swallowed
  // (the orbit controls listen to the pointer events, which are left alone); keys are left alone but for the ones that would select
  const MOUSE = ['mousedown', 'mouseup', 'mousemove', 'click', 'dblclick', 'auxclick', 'contextmenu'];
  const onMouse = (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    const view = t.id === 'canvas';
    const row = !view && t.closest('#tree .tree-node') && !t.closest('svg, button, input, [data-lucide]');
    if (!view && !row) return;
    e.stopImmediatePropagation();
    if (e.type === 'contextmenu') e.preventDefault();
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && !(card && card.contains(e.target))) { e.stopImmediatePropagation(); e.preventDefault(); set(false); return; }
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;      // (typing in a field of a panel)
    if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) { e.stopImmediatePropagation(); e.preventDefault(); }      // (select all)
  };
  function lock(on) {
    const m = on ? 'addEventListener' : 'removeEventListener';
    for (const t of MOUSE) window[m](t, onMouse, true);
    window[m]('keydown', onKey, true);
  }

  function build() {
    pill = document.createElement('button');
    pill.id = 'vp-section-pill'; pill.type = 'button'; pill.hidden = true; pill.className = 'vp-pill vp-pill-mode';
    pill.title = 'Section view is on. Click to turn it off';
    pill.innerHTML = '<i class="vp-pill-icon" data-lucide="scissors-line-dashed" aria-hidden="true"></i><span class="vp-pill-label">Section</span><i class="vp-pill-icon vp-pill-x" data-lucide="x" aria-hidden="true"></i>';
    (document.getElementById('viewport') || document.body).appendChild(pill);      // (not in the mode bar: that one is dimmed and inert while the section is on)
    pill.addEventListener('click', () => set(false));

    card = document.createElement('div');
    card.id = 'vp-section-pop'; card.hidden = true; card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'Section view');
    card.innerHTML = `<div class="bp-h">Section view</div>
      <div class="sec-axes" role="group" aria-label="Axis">${['x', 'y', 'z'].map(a => `<button type="button" class="bp-btn" data-axis="${a}" aria-pressed="false">${a.toUpperCase()}</button>`).join('')}<button type="button" class="bp-btn" data-flip aria-pressed="false" title="Keep the other side">Flip</button></div>
      <div class="field" id="sec-pos"></div>
      <div class="bp-s">One plane through the whole scene. Drag Position to move it; Flip keeps the other side. The inside of the cut is drawn flat. Nothing can be picked while it is on; Esc turns it off.</div>`;
    document.body.appendChild(card);
    card.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.axis) { S.axis = b.dataset.axis; measure(); paint(); sync(); }
      else if (b.hasAttribute('data-flip')) { S.flip = !S.flip; paint(); sync(); }
    });
    scrub = app.initScrubber({ el: card.querySelector('#sec-pos'), label: 'Position', maxSteps: 100, stepToVal: (s) => s, valToStep: (v) => v, format: (v) => ({ value: String(Math.round(v)), unit: '%' }), initialValue: 50, onChange: (v) => { S.t = Math.min(1, Math.max(0, v / 100)); sync(); } });
    try { app._lucide?.(); } catch (_) {}
  }

  function paint() {
    if (!card) return;
    for (const b of card.querySelectorAll('[data-axis]')) b.setAttribute('aria-pressed', String(b.dataset.axis === S.axis));
    card.querySelector('[data-flip]').setAttribute('aria-pressed', String(S.flip));
  }

  function place() {
    const r = (pill || document.body).getBoundingClientRect();
    card.style.left = Math.max(12, Math.min(innerWidth - 292, r.left)) + 'px';
    card.style.top = Math.round(r.bottom + 8) + 'px';
  }

  function set(on) {
    if (on && !group()) { app.toast('Section view', 'The scene is not ready yet.', 'warn'); return false; }
    if (on && !state.parts.some(p => !p.deleted)) { app.toast('Section view', 'Open a model first.', 'info'); return false; }
    S.on = !!on;
    if (!pill) build();
    if (S.on) { measure(); paint(); try { scrub && scrub.setValue(Math.round(S.t * 100)); } catch (_) {} collect(app.scene); try { app.clearSelection && app.clearSelection(); } catch (_) {} }
    pill.hidden = !S.on; card.hidden = !S.on;
    if (S.on) place(); else dropTwins();
    lock(S.on);
    sync();
    return true;
  }

  return { set, toggle: () => set(!S.on), render, get on() { return S.on; }, get plane() { return plane; }, state: S };
}
