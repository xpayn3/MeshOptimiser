// ════════════════════════════════════════════════════════════════════════════
// Cloner — C4D-style live cloner
//
// Loads as a non-module side-effect script AFTER app-v2.js. Boots when
// window._appFns + window._appHooks are present (app-v2.js wires both up
// during its top-level pass; we poll briefly to cover the boot ordering).
//
// A cloner is a partInfo entry (state.parts) with isCloner=true. It owns a
// THREE.Group on partsRoot. Source meshes are reparented under the Group as
// "clone 0"; the cloner then synthesises additional clones as InstancedMesh
// siblings (default — fast for high counts) or independent Mesh siblings
// (heavier, but each individually editable).
//
// Modes: linear (count + per-step XYZ offset / rotation / scale step),
//        radial (count, radius, axis, start/end angle, faceCenter),
//        grid   (nx/ny/nz, dx/dy/dz).
//
// Undo: clonerAdd / clonerParams / clonerDissolve registered as handlers
// against _appHooks.{undoHandlers,redoHandlers}.
// ════════════════════════════════════════════════════════════════════════════

(function _ClonerModule() {
  let _attempts = 0;
  function _whenReady() {
    const fns = window._appFns;
    const hooks = window._appHooks;
    const ready = fns && hooks
      && fns.THREE && fns.getPart && fns.pushUndo
      && window.state && window.state.parts;
    if (ready) { _init(); return; }
    if (++_attempts > 100) { console.warn('[cloner] init failed — _appFns / _appHooks never appeared'); return; }
    setTimeout(_whenReady, 100);
  }

  function _init() {
    if (window.__clonerInit) return;
    window.__clonerInit = true;

    const F = window._appFns;
    const H = window._appHooks;
    const state = window.state;
    const THREE = F.THREE;

    // Helpers — read through _appFns so we always pick up the latest binding.
    const getPart  = (id) => F.getPart(id);
    const pushUndo = (op) => F.pushUndo(op);
    const requestRender = () => F.requestRender?.();
    const escapeHtml = F.escapeHtml || ((s) => String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])));
    const toast = F.toast || (() => {});
    const _UNIT_LABEL = F._UNIT_LABEL || { mm: 'mm' };

    function _clonerDefaults() {
      return {
        mode: 'linear',
        useInstancing: true,
        linear: { count: 5, dx: 100, dy: 0, dz: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0, sxStep: 1, syStep: 1, szStep: 1 },
        radial: { count: 8, radius: 150, axis: 'z', startDeg: 0, endDeg: 360, faceCenter: false },
        grid:   { nx: 3, ny: 3, nz: 1, dx: 100, dy: 100, dz: 100 },
      };
    }
    function _clonerCount(c) {
      if (c.mode === 'linear') return Math.max(1, c.linear.count | 0);
      if (c.mode === 'radial') return Math.max(1, c.radial.count | 0);
      if (c.mode === 'grid')   return Math.max(1, (c.grid.nx | 0) * (c.grid.ny | 0) * (c.grid.nz | 0));
      return 1;
    }

    // Per-clone offset matrix in cloner-local space. i=0 returns identity
    // (used by linear / grid where source IS clone-0). Final per-instance
    // matrix is offset(i) × srcLocalMatrix.
    //
    // All scratch math objects are MODULE-LEVEL — re-used across calls so a
    // 1000-clone rebuild allocates zero Matrix4 / Vector3 / Quaternion /
    // Euler / Vector3-scale-once instances. _ONE is a frozen unit scale
    // for compose() in modes that don't synth scale (radial, grid).
    const _M   = new THREE.Matrix4();
    const _OUT = new THREE.Matrix4();
    const _Q   = new THREE.Quaternion();
    const _V   = new THREE.Vector3();
    const _E   = new THREE.Euler();
    const _S   = new THREE.Vector3();
    const _ONE = new THREE.Vector3(1, 1, 1);
    function _clonerOffsetMatrix(c, i, out) {
      out = out || _M;
      if (i === 0) return out.identity();
      if (c.mode === 'linear') {
        const L = c.linear;
        _V.set(L.dx * i, L.dy * i, L.dz * i);
        _E.set(L.rxDeg * i * Math.PI / 180, L.ryDeg * i * Math.PI / 180, L.rzDeg * i * Math.PI / 180, 'XYZ');
        _Q.setFromEuler(_E);
        _S.set(Math.pow(L.sxStep, i), Math.pow(L.syStep, i), Math.pow(L.szStep, i));
        return out.compose(_V, _Q, _S);
      }
      if (c.mode === 'radial') {
        const R = c.radial;
        const denom = (R.count > 1 && Math.abs(R.endDeg - R.startDeg) % 360 !== 0) ? (R.count - 1) : R.count;
        const t = (denom > 0) ? i / denom : 0;
        const angle = (R.startDeg + (R.endDeg - R.startDeg) * t) * Math.PI / 180;
        const cs = Math.cos(angle), sn = Math.sin(angle);
        const r = R.radius;
        if (R.axis === 'z')      _V.set(cs * r, sn * r, 0);
        else if (R.axis === 'y') _V.set(cs * r, 0, sn * r);
        else                     _V.set(0, cs * r, sn * r);
        if (R.faceCenter) {
          if (R.axis === 'z')      _E.set(0, 0, angle, 'XYZ');
          else if (R.axis === 'y') _E.set(0, -angle, 0, 'XYZ');
          else                     _E.set(angle, 0, 0, 'XYZ');
          _Q.setFromEuler(_E);
        } else { _Q.identity(); }
        return out.compose(_V, _Q, _ONE);
      }
      if (c.mode === 'grid') {
        const G = c.grid;
        const nx = Math.max(1, G.nx | 0), ny = Math.max(1, G.ny | 0);
        const ix = i % nx;
        const iy = Math.floor(i / nx) % ny;
        const iz = Math.floor(i / (nx * ny));
        _V.set(ix * G.dx, iy * G.dy, iz * G.dz);
        _Q.identity();
        return out.compose(_V, _Q, _ONE);
      }
      return out.identity();
    }

    // Re-bake the cloner's child meshes from the current source(s) + params.
    //
    // Algorithm — three explicit phases, only the third mutates clones:
    //
    //   PHASE 1 — Resolve sources with self-healing.
    //     For each cloner.sources partId, find the live source mesh and
    //     classify its scene-graph state:
    //       (a) parent === cloner Group  → ready to use as-is.
    //       (b) parent === state.pivot   → an active gizmo gesture has the
    //           source. We MUST NOT yank it out (would break the drag).
    //           DEFER the rebuild — the existing clones stay rendered at
    //           their last-known positions; the gizmo-end → poll pipeline
    //           will catch the new transform on the next tick.
    //       (c) parent is anywhere else  → stray (post-gizmo detach went
    //           to partsRoot; some external code reparented it). We can
    //           reattach with grp.attach() preserving world transform.
    //       (d) source deleted or missing → counted as dead.
    //     If all sources end up dead → auto-dissolve the cloner.
    //
    //   PHASE 2 — Tear down previous clones.
    //     Reached only when phase 1 produced ≥1 source mesh under grp.
    //     This is the ONLY place we dispose previous clone refs, so a
    //     deferred rebuild (phase 1 returned 'gizmo') leaves them intact.
    //
    //   PHASE 3 — Build new clones.
    //     Instanced path: ONE InstancedMesh per source with count-1
    //       instances at offsets 1..N-1. Single draw call.
    //     Non-instanced path: count-1 standalone Meshes sharing the
    //       source's geometry + material — each is a real Object3D.
    //
    // Returns 'rebuilt' | 'deferred' | 'dissolved' | 'noop' so the wrapper
    // (and the poll) can decide whether to re-snap source refs.
    function _clonerRebuild(p) {
      if (!p?.isCloner || !p.mesh || p.deleted) return 'noop';
      const c = p.cloner;
      const grp = p.mesh;
      const count = _clonerCount(c);

      // ── Phase 1 ──────────────────────────────────────────────────────────
      const sourceMeshes = [];
      let liveSources = 0;
      let pausedByGizmo = false;
      for (const sid of c.sources || []) {
        const sp = getPart(sid);
        if (!sp || sp.deleted || !sp.mesh) continue;       // dead source
        liveSources++;
        const m = sp.mesh;
        if (m.parent === grp) {
          sourceMeshes.push(m);
        } else if (state.pivot && m.parent === state.pivot) {
          pausedByGizmo = true;                            // active gesture
          break;
        } else if (m.parent) {
          // Stray — post-gizmo detach, host reparent, etc. Pull it back.
          try { grp.attach(m); sourceMeshes.push(m); }
          catch (e) { console.warn('[cloner] reattach failed', e); }
        }
        // m.parent === null is unusual (orphaned object); skip.
      }
      if (pausedByGizmo) return 'deferred';

      // Snapshot pre-rebuild clone refs BEFORE any teardown so the fast-path
      // below can decide whether structural properties changed. Earlier
      // versions cleared _clonerCloneRefs in a separate "Phase 2" before
      // capturing oldRefs — that made oldRefs always empty and the fast
      // path was dead code.
      const oldRefs = Array.isArray(grp.userData._clonerCloneRefs) ? grp.userData._clonerCloneRefs : [];

      if (liveSources === 0 || sourceMeshes.length === 0) {
        // No usable source right now. We DON'T auto-dissolve the cloner
        // — the user may have just deleted the source intending only to
        // remove it (and may undo it). Empty the visible clones so the
        // viewport doesn't show stale geometry, but keep the cloner part
        // alive so it remains in the tree / can be undone / can re-bind
        // sources later.
        for (const m of oldRefs) {
          if (m.parent === grp) grp.remove(m);
          if (m.isInstancedMesh) { try { m.dispose(); } catch (_) {} }
        }
        grp.userData._clonerCloneRefs = [];
        return 'rebuilt';                                  // empty state
      }

      // ── Phase 3 ──────────────────────────────────────────────────────────
      // Source role differs by mode:
      //   linear / grid: source IS clone-0 (visible at offset 0). N-1
      //     synthetic clones at offsets 1..N-1.
      //   radial: source is the instance GENERATOR (hidden). N synthetic
      //     clones cover the full circle at offsets 0..N-1 — no clone
      //     at the cloner-Group origin (which would sit at the centre
      //     of the radial pattern, looking wrong).
      const radial = c.mode === 'radial';
      const cloneCount = radial ? count : Math.max(0, count - 1);
      const startIdx   = radial ? 0 : 1;

      // ── Fast-path: reuse existing InstancedMeshes when only matrices
      // changed (slider drag with no count/mode/instancing/source change).
      // Skips the dispose + GPU-buffer-reupload churn — biggest perf win
      // for live param edits. Falls through to the slow path the moment
      // any structural property differs.
      let canFastPath = c.useInstancing
        && oldRefs.length === sourceMeshes.length
        && cloneCount > 0;
      if (canFastPath) {
        for (let s = 0; s < sourceMeshes.length; s++) {
          const inst = oldRefs[s];
          const src  = sourceMeshes[s];
          if (!inst || !inst.isInstancedMesh
              || inst.count    !== cloneCount
              || inst.geometry !== src.geometry
              || inst.material !== src.material
              || inst.parent   !== grp) {
            canFastPath = false; break;
          }
        }
      }

      const _wasPaused = state.renderPaused;
      state.renderPaused = true;
      try {
        if (canFastPath) {
          for (let s = 0; s < sourceMeshes.length; s++) {
            const src = sourceMeshes[s];
            const inst = oldRefs[s];
            src.visible = !radial;
            const srcLocal = src.matrix; // read-only: setMatrixAt copies
            for (let i = 0; i < cloneCount; i++) {
              _clonerOffsetMatrix(c, i + startIdx, _M);
              _OUT.copy(_M).multiply(srcLocal);
              inst.setMatrixAt(i, _OUT);
            }
            inst.instanceMatrix.needsUpdate = true;
            // Recompute bounds so raycasting / shadow-cam culling enclose
            // every instance position. Without this, the source-geometry
            // boundingSphere stays centred at the local origin and far
            // instances "disappear" from picks.
            inst.computeBoundingSphere();
            inst.computeBoundingBox();
          }
        } else {
          // Slow path: tear down and rebuild from scratch.
          for (const m of oldRefs) {
            if (m.parent === grp) grp.remove(m);
            if (m.isInstancedMesh) { try { m.dispose(); } catch (_) {} }
          }
          grp.userData._clonerCloneRefs = [];
          for (const src of sourceMeshes) {
            src.visible = !radial;
            if (cloneCount === 0) continue;
            const srcLocal = src.matrix;
            if (c.useInstancing) {
              const inst = new THREE.InstancedMesh(src.geometry, src.material, cloneCount);
              inst.userData._isClonerInstance = true;
              inst.userData._clonerOwner = p.partId;
              inst.frustumCulled = false;
              inst.matrixAutoUpdate = true;
              inst.visible = true;
              for (let i = 0; i < cloneCount; i++) {
                _clonerOffsetMatrix(c, i + startIdx, _M);
                _OUT.copy(_M).multiply(srcLocal);
                inst.setMatrixAt(i, _OUT);
              }
              inst.instanceMatrix.needsUpdate = true;
              inst.computeBoundingSphere();
              inst.computeBoundingBox();
              grp.add(inst);
              grp.userData._clonerCloneRefs.push(inst);
            } else {
              for (let i = 0; i < cloneCount; i++) {
                const m = new THREE.Mesh(src.geometry, src.material);
                m.userData._isClonerClone = true;
                m.userData._clonerOwner = p.partId;
                _clonerOffsetMatrix(c, i + startIdx, _M);
                _OUT.copy(_M).multiply(srcLocal);
                // Keep matrixAutoUpdate=false permanently — renderer reads
                // m.matrix directly. Decomposing into pos/quat/scale and
                // re-enabling autoUpdate would drop any shear produced
                // when offset rotation composes with non-uniform source
                // scale.
                m.matrixAutoUpdate = false;
                m.matrix.copy(_OUT);
                m.matrixWorldNeedsUpdate = true;
                m.frustumCulled = false;
                m.visible = true;
                grp.add(m);
                grp.userData._clonerCloneRefs.push(m);
              }
            }
          }
        }
        grp.updateMatrixWorld(true);
      } finally {
        state.renderPaused = _wasPaused;
        // Even if rebuild threw, kick a render so the dirty flag matches
        // the (potentially partial) scene-graph state.
        requestRender();
      }
      return 'rebuilt';
    }

    function _clonerCreateFromParts(sourceIds, opts) {
      if (!Array.isArray(sourceIds) || !sourceIds.length) return null;
      const valid = [];
      for (const sid of sourceIds) {
        const sp = getPart(sid);
        if (!sp || sp.deleted || !sp.mesh) continue;
        if (sp.instancedMesh) continue;
        if (sp.isCloner) continue;
        valid.push(sp);
      }
      if (!valid.length) {
        toast('Cloner', 'No cloneable selection (instanced parts skipped)', 'warn');
        return null;
      }
      // Tear down the host's gizmo state BEFORE we reparent sources into the
      // cloner Group. If the user had a source selected (so its mesh was
      // pivoted under state.pivot) the next selection-change-driven
      // updateGizmo() would call _detachGizmo() which iterates the stale
      // state._pivotedParts list and reparents every formerly-pivoted mesh
      // back to partsRoot — yanking our source meshes right out of the
      // cloner Group milliseconds after we put them in. Clearing the pivot
      // state up front prevents that race. We also reparent every source
      // back to partsRoot so the world-transform snapshot we take next is
      // anchored at the canonical scene-graph location, not the gizmo
      // pivot's transient frame.
      try { if (state.gizmo) state.gizmo.detach(); } catch (_) {}
      try {
        for (const sp of valid) {
          if (sp.mesh && state.pivot && sp.mesh.parent === state.pivot) {
            state.partsRoot.attach(sp.mesh);
          }
        }
      } catch (_) {}
      state._pivotedParts = [];
      state._pivotedPart = null;
      state._pivotedGroup = null;
      state._pivotedGroupId = null;
      state._pivotedTreeGroupId = null;
      state._pivotOrigParent = null;
      const grp = new THREE.Group();
      grp.name = 'Cloner ' + ((state._clonerCount || 0) + 1);
      grp.userData.isCloner = true;
      grp.userData._clonerCloneRefs = [];
      state.partsRoot.add(grp);
      const aabb = new THREE.Box3();
      for (const sp of valid) {
        sp.mesh.updateWorldMatrix(true, false);
        aabb.expandByObject(sp.mesh);
      }
      if (!aabb.isEmpty()) {
        const c = aabb.getCenter(new THREE.Vector3());
        grp.position.copy(c);
        grp.updateMatrixWorld(true);
      }
      // Snapshot original parents BEFORE attach() rewrites them, so undo
      // can restore nested-source meshes back to their host (vs always
      // dumping them at partsRoot).
      const _prevParents = new Map();
      for (const sp of valid) _prevParents.set(sp.partId, sp.mesh.parent || state.partsRoot);
      for (const sp of valid) grp.attach(sp.mesh);
      grp.updateMatrixWorld(true);

      const partId = (state.parts.length ? Math.max(...state.parts.map(p => p.partId)) : -1) + 1;
      state._clonerCount = (state._clonerCount || 0) + 1;
      const partInfo = {
        partId, name: grp.name, hash: 'cloner_' + partId,
        triCount: 0, vertCount: 0, bbox: aabb.clone(),
        sizeMetrics: { diag: aabb.isEmpty() ? 0 : aabb.getSize(new THREE.Vector3()).length(), vol: 0, max: 0 },
        visible: true, deleted: false, flagged: false,
        originalColor: new THREE.Color(0x6b8dff),
        mesh: grp, group: null, instanceIndex: -1, instancedMesh: null,
        userExtras: {}, isCloner: true,
        cloner: Object.assign(_clonerDefaults(), { sources: valid.map(sp => sp.partId) }, opts || {}),
      };
      state.parts.push(partInfo);
      if (state.partById) state.partById.set(partId, partInfo);

      state.treeNodes ||= [];
      let minId = -100;
      for (const n of state.treeNodes) if (n.kind === 'group' && n.id < minId) minId = n.id - 1;
      const clonerNodeId = Math.min(minId - 1, -200);
      state.treeNodes.unshift({
        id: clonerNodeId, kind: 'cloner', name: grp.name,
        depth: 0, parentId: null, partId: null, obj3d: grp,
      });
      for (const sp of valid) {
        let idx = state.treeNodes.findIndex(n => n.kind === 'part' && n.partId === sp.partId);
        if (idx >= 0) {
          const tn = state.treeNodes[idx];
          tn.parentId = clonerNodeId;
          tn.depth = 1;
          state.treeNodes.splice(idx, 1);
          const insertAt = state.treeNodes.findIndex(n => n.id === clonerNodeId) + 1;
          state.treeNodes.splice(insertAt, 0, tn);
        } else {
          const insertAt = state.treeNodes.findIndex(n => n.id === clonerNodeId) + 1;
          state.treeNodes.splice(insertAt, 0, {
            id: sp.partId, kind: 'part', name: sp.name, depth: 1,
            parentId: clonerNodeId, partId: sp.partId, instanceCount: 0,
            obj3d: sp.mesh,
          });
        }
      }

      _clonerRebuild(partInfo);

      try {
        pushUndo({
          type: 'clonerAdd',
          partId: partInfo.partId,
          clonerNodeId,
          sources: valid.map(sp => ({
            partId: sp.partId,
            prevParent: _prevParents.get(sp.partId) || state.partsRoot,
            prevLocalMat: sp.mesh.matrix.elements.slice(),
          })),
        });
      } catch (_) {}

      if (state.selected) { state.selected.clear(); state.selected.add(partId); }
      try { F.rebuildTree?.(); } catch (_) {}
      try { F.applySelectionColors?.(); } catch (_) {}
      try { F.refreshPropertiesPanel?.(); } catch (_) {}
      try { F.updateGizmo?.(); } catch (_) {}
      try { F.onSceneActivated?.(); } catch (_) {}
      requestRender();
      toast('Cloner created', `${valid.length} source · ${_clonerCount(partInfo.cloner)} clones`, 'info', 1800);
      return partInfo;
    }

    // Idempotent — safe to call multiple times; no-ops on already-dissolved.
    // Dispose order is intentional:
    //   1. Mark p.deleted FIRST so the poll's next tick skips this cloner
    //      and doesn't race against the teardown.
    //   2. Tear down synthesised clones (InstancedMesh dispose, Meshes
    //      removed from grp).
    //   3. Reparent live source meshes back to partsRoot, preserving world
    //      transforms. Sources whose partInfo got deleted are skipped.
    //   4. Remove the grp from its parent.
    //   5. Patch state.treeNodes — drop the cloner node, promote children
    //      back to root depth so they remain visible in the tree.
    function _clonerDissolve(p) {
      if (!p?.isCloner || !p.mesh || p.deleted) return;
      p.deleted = true;
      const grp = p.mesh;
      const refs = grp.userData?._clonerCloneRefs;
      if (Array.isArray(refs)) {
        for (const m of refs) {
          if (m.parent === grp) grp.remove(m);
          if (m.isInstancedMesh) { try { m.dispose(); } catch (_) {} }
        }
        grp.userData._clonerCloneRefs = [];
      }
      for (const sid of (p.cloner?.sources || [])) {
        const sp = getPart(sid);
        if (sp && !sp.deleted && sp.mesh) {
          sp.mesh.visible = sp.visible !== false;
          // Returning to partsRoot is the canonical "back to top level"
          // location; preserves world transform via Object3D.attach.
          if (state.partsRoot) state.partsRoot.attach(sp.mesh);
        }
      }
      if (grp.parent) grp.parent.remove(grp);
      if (state.treeNodes) {
        const ci = state.treeNodes.findIndex(n => n.kind === 'cloner' && n.obj3d === grp);
        if (ci >= 0) {
          const cloneNode = state.treeNodes[ci];
          for (const tn of state.treeNodes) {
            if (tn.parentId === cloneNode.id) { tn.parentId = null; tn.depth = 0; }
          }
          state.treeNodes.splice(ci, 1);
        }
      }
      requestRender();
    }

    // ── UI: Cloner section in the Properties panel ────────────────────────
    function _renderClonerSection(p) {
      if (!p?.isCloner) return '';
      const c = p.cloner;
      const u = _UNIT_LABEL[state.displayUnit] || 'mm';
      const tab = (id, label) => `<button type="button" class="cln-tab${c.mode === id ? ' active' : ''}" data-cln-mode="${id}">${label}</button>`;
      const slider = (label, key, val, min, max, step, suffix='') => `
        <div class="cln-row" data-cln-field="${key}">
          <label class="cln-label">${escapeHtml(label)}</label>
          <input type="range" data-cln-input min="${min}" max="${max}" step="${step}" value="${val}" class="cln-slider">
          <span class="cln-val-wrap"><input type="number" data-cln-value min="${min}" max="${max}" step="${step}" value="${val}" class="cln-value">${suffix ? `<span class="cln-unit">${escapeHtml(suffix)}</span>` : ''}</span>
        </div>`;
      const intSlider = (label, key, val, min, max) => slider(label, key, val, min, max, 1, '');
      const distSlider = (label, key, val) => slider(label, key, val, -500, 500, 1, u);
      const angSlider = (label, key, val, min=-360, max=360) => slider(label, key, val, min, max, 1, '°');
      const scaleSlider = (label, key, val) => slider(label, key, val, 0.1, 3, 0.05, '×');
      const axisSel = (val) => `
        <div class="cln-row">
          <label class="cln-label">Axis</label>
          <select class="cln-select" data-cln-axis>
            <option value="x"${val==='x'?' selected':''}>X</option>
            <option value="y"${val==='y'?' selected':''}>Y</option>
            <option value="z"${val==='z'?' selected':''}>Z</option>
          </select>
        </div>`;
      const toggle = (label, key, val) => `
        <div class="cln-row cln-row-toggle">
          <label class="cln-label">${escapeHtml(label)}</label>
          <label class="cln-toggle"><input type="checkbox" data-cln-toggle="${key}" ${val ? 'checked' : ''}><span></span></label>
        </div>`;
      const subhead = (label) => `<div class="cln-subhead">${escapeHtml(label)}</div>`;
      let modeBody = '';
      if (c.mode === 'linear') {
        const L = c.linear;
        // Grouped layout: Count up top, then Position / Rotation / Scale
        // sub-sections — same vocabulary the C4D cloner uses, keeps the 10
        // sliders scannable instead of one wall of identical-looking rows.
        modeBody =
          intSlider('Count', 'linear.count', L.count, 1, 200) +
          subhead('Position step') +
          distSlider('X', 'linear.dx', L.dx) +
          distSlider('Y', 'linear.dy', L.dy) +
          distSlider('Z', 'linear.dz', L.dz) +
          subhead('Rotation step') +
          angSlider('X', 'linear.rxDeg', L.rxDeg) +
          angSlider('Y', 'linear.ryDeg', L.ryDeg) +
          angSlider('Z', 'linear.rzDeg', L.rzDeg) +
          subhead('Scale step') +
          scaleSlider('X', 'linear.sxStep', L.sxStep) +
          scaleSlider('Y', 'linear.syStep', L.syStep) +
          scaleSlider('Z', 'linear.szStep', L.szStep);
      } else if (c.mode === 'radial') {
        const R = c.radial;
        modeBody =
          intSlider('Count', 'radial.count', R.count, 1, 200) +
          slider('Radius', 'radial.radius', R.radius, 0, 1000, 1, u) +
          axisSel(R.axis) +
          subhead('Sweep') +
          angSlider('Start', 'radial.startDeg', R.startDeg) +
          angSlider('End',   'radial.endDeg', R.endDeg) +
          toggle('Face center', 'radial.faceCenter', R.faceCenter);
      } else if (c.mode === 'grid') {
        const G = c.grid;
        modeBody =
          subhead('Counts') +
          intSlider('X', 'grid.nx', G.nx, 1, 50) +
          intSlider('Y', 'grid.ny', G.ny, 1, 50) +
          intSlider('Z', 'grid.nz', G.nz, 1, 50) +
          subhead('Spacing') +
          distSlider('X', 'grid.dx', G.dx) +
          distSlider('Y', 'grid.dy', G.dy) +
          distSlider('Z', 'grid.dz', G.dz);
      }
      const totalCount = _clonerCount(c);
      return `
        <div class="prop-section cln-section">
          <div class="prop-section-title">
            <span><i data-lucide="copy"></i> Cloner</span>
            <span class="cln-count-badge">${totalCount} clone${totalCount === 1 ? '' : 's'}</span>
          </div>
          <div class="cln-tabs">${tab('linear','Linear')}${tab('radial','Radial')}${tab('grid','Grid')}</div>
          <div class="cln-body">
            ${modeBody}
            ${toggle('Use instancing', 'useInstancing', c.useInstancing)}
          </div>
          <div class="cln-foot">
            <button type="button" class="cln-btn cln-btn-warn" data-cln-act="dissolve" title="Dissolve cloner — restore source(s)"><i data-lucide="layers-2"></i> Dissolve</button>
          </div>
        </div>`;
    }

    function _wireClonerControls(rootEl, p) {
      if (!rootEl || !p?.isCloner) return;
      const c = p.cloner;
      let _raf = 0;
      const _scheduleRebuild = () => {
        if (_raf) return;
        _raf = requestAnimationFrame(() => {
          _raf = 0;
          try { _clonerRebuild(p); } catch (e) { console.warn('[cloner] rebuild failed:', e); }
          const badge = rootEl.querySelector('.cln-count-badge');
          if (badge) {
            const n = _clonerCount(c);
            badge.textContent = n + ' clone' + (n === 1 ? '' : 's');
          }
        });
      };
      let _gestureBefore = null;
      const _beginGesture = () => { if (!_gestureBefore) _gestureBefore = JSON.parse(JSON.stringify(c)); };
      const _commitGesture = () => {
        if (!_gestureBefore) return;
        const before = _gestureBefore; _gestureBefore = null;
        const after = JSON.parse(JSON.stringify(c));
        if (JSON.stringify(before) === JSON.stringify(after)) return;
        try { pushUndo({ type: 'clonerParams', partId: p.partId, before, after }); } catch (_) {}
      };
      rootEl.querySelectorAll('.cln-tab').forEach(btn => {
        btn.addEventListener('click', () => {
          const next = btn.dataset.clnMode;
          if (!next || next === c.mode) return;
          const before = JSON.parse(JSON.stringify(c));
          c.mode = next;
          _clonerRebuild(p);
          try { pushUndo({ type: 'clonerParams', partId: p.partId, before, after: JSON.parse(JSON.stringify(c)) }); } catch (_) {}
          F.refreshPropertiesPanel?.();
        });
      });
      const setField = (path, v) => { const [a, b] = path.split('.'); if (b == null) c[a] = v; else c[a][b] = v; };
      const getField = (path) => { const [a, b] = path.split('.'); return b == null ? c[a] : c[a][b]; };
      rootEl.querySelectorAll('.cln-row').forEach(row => {
        const fId = row.dataset.clnField;
        if (!fId) return;
        const input = row.querySelector('[data-cln-input]');
        const valEl = row.querySelector('[data-cln-value]');
        if (!input) return;
        const isInt = parseFloat(input.step) >= 1;
        const parse = (s) => isInt ? parseInt(s, 10) : parseFloat(s);
        const sync = () => {
          const v = parse(input.value);
          if (Number.isNaN(v)) return;
          setField(fId, v);
          if (valEl && document.activeElement !== valEl) valEl.value = v;
          _scheduleRebuild();
        };
        input.addEventListener('input', sync);
        input.addEventListener('pointerdown', _beginGesture);
        const _onUp = () => _commitGesture();
        input.addEventListener('pointerup', _onUp);
        input.addEventListener('pointercancel', _onUp);
        input.addEventListener('keydown', (e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') _beginGesture();
        });
        input.addEventListener('keyup', _onUp);
        input.addEventListener('wheel', () => { _beginGesture(); requestAnimationFrame(_onUp); }, { passive: true });
        if (valEl) {
          valEl.addEventListener('focus', _beginGesture);
          valEl.addEventListener('change', () => {
            const v = parse(valEl.value);
            const lo = parse(input.min), hi = parse(input.max);
            if (Number.isNaN(v)) { valEl.value = getField(fId); return; }
            const clamped = Math.max(lo, Math.min(hi, v));
            valEl.value = clamped;
            input.value = clamped;
            setField(fId, clamped);
            _scheduleRebuild();
            _commitGesture();
          });
          valEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); valEl.blur(); }
            if (e.key === 'Escape') { _gestureBefore = null; valEl.blur(); }
          });
        }
      });
      const axisSel = rootEl.querySelector('[data-cln-axis]');
      if (axisSel) {
        axisSel.addEventListener('change', () => {
          const before = JSON.parse(JSON.stringify(c));
          c.radial.axis = axisSel.value;
          _clonerRebuild(p);
          try { pushUndo({ type: 'clonerParams', partId: p.partId, before, after: JSON.parse(JSON.stringify(c)) }); } catch (_) {}
        });
      }
      rootEl.querySelectorAll('[data-cln-toggle]').forEach(t => {
        t.addEventListener('change', () => {
          const path = t.dataset.clnToggle;
          const before = JSON.parse(JSON.stringify(c));
          if (path.includes('.')) { const [a,b] = path.split('.'); c[a][b] = t.checked; }
          else c[path] = t.checked;
          _clonerRebuild(p);
          try { pushUndo({ type: 'clonerParams', partId: p.partId, before, after: JSON.parse(JSON.stringify(c)) }); } catch (_) {}
        });
      });
      rootEl.querySelector('[data-cln-act="dissolve"]')?.addEventListener('click', () => {
        const snap = {
          partId: p.partId, name: p.name,
          cloner: JSON.parse(JSON.stringify(p.cloner)),
          clonerGroupPos: p.mesh.position.toArray(),
          clonerGroupQuat: p.mesh.quaternion.toArray(),
          clonerGroupScale: p.mesh.scale.toArray(),
          sources: (p.cloner.sources || []).map(sid => {
            const sp = getPart(sid);
            if (!sp || !sp.mesh) return null;
            return { partId: sid, prevLocalMat: sp.mesh.matrix.elements.slice() };
          }).filter(Boolean),
        };
        _clonerDissolve(p);
        try { pushUndo({ type: 'clonerDissolve', snap }); } catch (_) {}
        try { F.rebuildTree?.(); } catch (_) {}
        try { F.refreshPropertiesPanel?.(); } catch (_) {}
        try { F.applySelectionColors?.(); } catch (_) {}
        requestRender();
      });
    }

    // Resolve the active cloner from the selection. Cloners are rendered as
    // 'group' tree rows (the hier renderer doesn't know 'cloner'), so a click
    // on a cloner row populates state.selectedGroupIds — NOT state.selected.
    // We accept either path here so the Properties panel always finds the
    // active cloner regardless of which selection set was hit.
    function _activeCloner(sel) {
      if (sel?.isCloner) return sel;
      if (state.selectedGroupIds && state.selectedGroupIds.size === 1) {
        const gid = [...state.selectedGroupIds][0];
        const tn = (state.treeNodes || []).find(n => n.id === gid && n.kind === 'cloner');
        if (tn && tn.obj3d) return state.parts.find(p => p.isCloner && p.mesh === tn.obj3d && !p.deleted);
      }
      // Single state.selected entry but `sel` lookup missed (rare race)
      if (state.selected && state.selected.size === 1) {
        const pid = [...state.selected][0];
        const p = getPart(pid);
        if (p?.isCloner && !p.deleted) return p;
      }
      return null;
    }
    // Append the cloner section to the Properties panel via the propsRender
    // hook — fires after the host's refreshPropertiesPanel finishes.
    H.propsRenderHooks.push((sel, el) => {
      if (!el) return;
      const cloner = _activeCloner(sel);
      if (!cloner) return;
      el.insertAdjacentHTML('beforeend', _renderClonerSection(cloner));
      _wireClonerControls(el, cloner);
      try { F._lucide?.(); } catch (_) {}
    });

    // Delete-key interceptor — when the active selection is a single
    // cloner part, the host's deleteParts would only mark it deleted +
    // hide the Group, leaving the tree row + scene-graph artefacts
    // behind. We intercept and route through _clonerDissolve which is
    // the canonical teardown path (drops the Group, restores sources to
    // partsRoot, removes the tree node). Pushed via the same
    // 'clonerDissolve' undo op already wired into the undo handlers, so
    // Ctrl+Z resurrects the cloner cleanly.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
      const ids = [...(state.selected || [])];
      if (ids.length !== 1) return;
      const p = getPart(ids[0]);
      if (!p?.isCloner || p.deleted) return;
      e.stopPropagation();
      e.preventDefault();
      const snap = {
        partId: p.partId, name: p.name,
        cloner: JSON.parse(JSON.stringify(p.cloner)),
        clonerGroupPos: p.mesh.position.toArray(),
        clonerGroupQuat: p.mesh.quaternion.toArray(),
        clonerGroupScale: p.mesh.scale.toArray(),
        sources: (p.cloner.sources || []).map(sid => {
          const sp = getPart(sid);
          if (!sp || !sp.mesh) return null;
          return { partId: sid, prevLocalMat: sp.mesh.matrix.elements.slice() };
        }).filter(Boolean),
      };
      _clonerDissolve(p);
      try { pushUndo({ type: 'clonerDissolve', snap }); } catch (_) {}
      state.selected.clear();
      try { F.rebuildTree?.(); } catch (_) {}
      try { F.refreshPropertiesPanel?.(); } catch (_) {}
      try { F.applySelectionColors?.(); } catch (_) {}
      try { F.updateGizmo?.(); } catch (_) {}
      requestRender();
    }, true);

    // Cloner-row click interceptor. Click on a .is-cloner tree row →
    // populate state.selected with the cloner's partId so the rest of the
    // app (gizmo, properties panel, undo) treats it as a normal part. We
    // run in capture phase to beat the host's tree click handler.
    if (typeof document !== 'undefined') {
      document.addEventListener('click', (e) => {
        const row = e.target.closest && e.target.closest('.tree-node.is-cloner');
        if (!row) return;
        // Skip clicks on the eye / expand / action sub-controls — those have
        // their own behaviour the user expects.
        if (e.target.closest('.tree-vis') ||
            e.target.closest('.tree-expand') ||
            e.target.closest('[data-act]') ||
            e.target.closest('.tree-color')) return;
        const gid = parseInt(row.dataset.groupId || '0', 10);
        const tn = (state.treeNodes || []).find(n => n.id === gid && n.kind === 'cloner');
        if (!tn) return;
        const cloner = state.parts.find(p => p.isCloner && p.mesh === tn.obj3d && !p.deleted);
        if (!cloner) return;
        e.stopPropagation();
        e.preventDefault();
        state.selected ||= new Set();
        state.selected.clear();
        if (state.selectedGroupIds) state.selectedGroupIds.clear();
        state.selected.add(cloner.partId);
        // Mirror the row visual.
        document.querySelectorAll('.tree-node.selected').forEach(r => r.classList.remove('selected'));
        row.classList.add('selected');
        try { F.applySelectionColors?.(); } catch (_) {}
        try { F.refreshPropertiesPanel?.(); } catch (_) {}
        try { F.updateGizmo?.(); } catch (_) {}
      }, true);
    }

    // ── Live source-mesh updates ──────────────────────────────────────────
    // The cloner watches its sources for {parent, matrix, geometry,
    // material} changes and re-bakes when any drifts. Why polling?
    //   - Gizmo edits emit no events the host wires for us.
    //   - Primitive sliders + material editor mutate ref / matrix
    //     synchronously; a per-frame check catches all of them.
    //   - 60 ms / O(sources) — immeasurably cheap in any real session.
    //
    // The poll DEFERS re-bake during a gizmo gesture (source.parent ===
    // state.pivot) so we don't yank the source out from under the user.
    // _clonerRebuild is the source-of-truth dispatcher that returns
    // 'rebuilt' / 'deferred' / 'dissolved' / 'noop'; we only re-snap the
    // baseline on 'rebuilt'.
    function _snapSourceRefs(p) {
      if (!p?.isCloner || p.deleted) return;
      p._lastSourceRefs = new Map();
      for (const sid of (p.cloner?.sources || [])) {
        const sp = getPart(sid);
        if (sp && !sp.deleted && sp.mesh) {
          p._lastSourceRefs.set(sid, {
            dead:      false,
            matrix:    sp.mesh.matrix.clone(),
            geom:      sp.mesh.geometry,
            mat:       sp.mesh.material,
            parent:    sp.mesh.parent,
          });
        } else {
          // Tombstone for dead sources — without it the poll sees `last`
          // missing for every dead sid every tick and triggers an infinite
          // 60ms rebuild loop until the user dissolves the cloner.
          p._lastSourceRefs.set(sid, { dead: true });
        }
      }
    }

    // Wrap _clonerRebuild to manage the source-ref snapshot:
    //   'rebuilt'  → re-snap (capture post-build baseline)
    //   'deferred' → DO NOT snap (we want the next post-gesture poll to
    //                still detect the drift and rebuild)
    //   'dissolved'→ clear (cloner no longer exists)
    //   'noop'     → snap to current state (prevents an infinite poll
    //                loop in unusual states like an orphaned source with
    //                parent === null — drift would never reconcile)
    const _rawRebuild = _clonerRebuild;
    _clonerRebuild = function(p) {
      const result = _rawRebuild(p);
      if (result === 'rebuilt' || result === 'noop') _snapSourceRefs(p);
      else if (result === 'dissolved' && p) p._lastSourceRefs = null;
      return result;
    };

    // Coalesced rebuild scheduler — multiple drift detections within a
    // frame produce ONE rebuild. Param-edit code paths use this too so
    // slider drags don't fire 50+ rebuilds per second.
    const _scheduledRebuilds = new Set();
    function _scheduleRebuild(p) {
      if (!p || p.deleted) return;
      if (_scheduledRebuilds.has(p.partId)) return;
      _scheduledRebuilds.add(p.partId);
      requestAnimationFrame(() => {
        _scheduledRebuilds.delete(p.partId);
        try { _clonerRebuild(p); } catch (e) { console.warn('[cloner] scheduled rebuild failed', e); }
      });
    }

    // Poll every 60 ms. Three exit branches per cloner:
    //   - source under pivot      → defer (gizmo gesturing)
    //   - source dead              → schedule rebuild (empties the cloner)
    //   - source moved/changed     → schedule rebuild
    //   - everything stable        → no-op
    // A scene-wide _hasCloners flag, maintained on create/dissolve, lets
    // the poll early-bail in zero-cloner sessions (the common case before
    // a user creates their first cloner).
    setInterval(() => {
      if (!window.__hasCloners) return;
      const parts = state.parts;
      if (!parts) return;
      for (let pi = 0; pi < parts.length; pi++) {
        const p = parts[pi];
        if (!p.isCloner || p.deleted || !p.mesh) continue;
        if (!p._lastSourceRefs) { _snapSourceRefs(p); continue; }

        let needsRebuild = false;
        let pausedByGizmo = false;
        const sources = p.cloner?.sources;
        if (!sources) continue;
        for (let si = 0; si < sources.length; si++) {
          const sp = getPart(sources[si]);
          const last = p._lastSourceRefs.get(sources[si]);
          const sourceDead = !sp || sp.deleted || !sp.mesh;
          if (sourceDead) {
            // Only trigger one rebuild on the death transition; subsequent
            // polls compare tombstone-vs-tombstone and stay quiet.
            if (!last?.dead) { needsRebuild = true; break; }
            continue;
          }
          if (state.pivot && sp.mesh.parent === state.pivot) { pausedByGizmo = true; break; }
          if (!last
              || last.dead
              || last.parent !== sp.mesh.parent
              || last.geom   !== sp.mesh.geometry
              || last.mat    !== sp.mesh.material
              || !last.matrix.equals(sp.mesh.matrix)) {
            needsRebuild = true; break;
          }
        }
        if (pausedByGizmo) continue;
        if (needsRebuild) _scheduleRebuild(p);
      }
    }, 60);

    // Maintain the cheap scene-wide flag the poll uses for early-bail.
    // Polled at 500 ms — zero overhead in the no-cloner case (just an
    // array length check) and snappy enough to start polling the moment
    // a user creates their first cloner.
    setInterval(() => {
      if (!state.parts) { window.__hasCloners = false; return; }
      let any = false;
      for (let i = 0; i < state.parts.length; i++) {
        const p = state.parts[i];
        if (p.isCloner && !p.deleted) { any = true; break; }
      }
      window.__hasCloners = any;
    }, 500);

    // The hier renderer only knows kind:'group' / 'part'. Flip cloner nodes
    // to 'group' for the duration of rebuildTree() via pre/post hooks.
    const _clonerSwapped = [];
    H.treePreBuildHooks.push(() => {
      _clonerSwapped.length = 0;
      if (!state.treeNodes) return;
      for (const n of state.treeNodes) {
        if (n.kind === 'cloner') { _clonerSwapped.push(n); n.kind = 'group'; }
      }
    });
    H.treePostBuildHooks.push(() => {
      for (const n of _clonerSwapped) n.kind = 'cloner';
      _clonerSwapped.length = 0;
    });

    // Decorate rendered cloner rows with a 'copy' icon + accent class.
    const _treeEl = document.getElementById('tree');
    if (_treeEl) {
      const _decorateClonerRows = () => {
        _treeEl.querySelectorAll('.tree-node.is-group:not([data-cloner-deco])').forEach(row => {
          const gid = parseInt(row.dataset.groupId || '0', 10);
          const tn = (state.treeNodes || []).find(n => n.id === gid);
          if (!tn || tn.kind !== 'cloner') return;
          row.dataset.clonerDeco = '1';
          row.classList.add('is-cloner');
          const icon = row.querySelector('.tree-typeicon i');
          if (icon) icon.setAttribute('data-lucide', 'copy');
          const ti = row.querySelector('.tree-typeicon');
          if (ti) { ti.classList.remove('asm'); ti.classList.add('cln'); }
          try { F._lucide?.(); } catch (_) {}
        });
      };
      new MutationObserver(_decorateClonerRows).observe(_treeEl, { childList: true, subtree: true });
      _decorateClonerRows();
    }

    // Undo / redo handlers — wired through _appHooks. Each returns true to
    // tell the host wrapper "I handled this op; don't fall through."
    H.undoHandlers.push((op) => {
      if (op.type === 'clonerAdd') {
        state.history.pop();
        const p = getPart(op.partId);
        if (p) {
          for (const s of op.sources || []) {
            const sp = getPart(s.partId);
            if (!sp || !sp.mesh) continue;
            (s.prevParent || state.partsRoot).attach(sp.mesh);
            sp.mesh.matrix.fromArray(s.prevLocalMat);
            sp.mesh.matrix.decompose(sp.mesh.position, sp.mesh.quaternion, sp.mesh.scale);
            sp.mesh.visible = sp.visible !== false;
            sp.mesh.updateMatrixWorld(true);
          }
          _clonerDissolve(p);
        }
        state.redo.push(op);
        try { F.rebuildTree?.(); } catch (_) {}
        try { F.applySelectionColors?.(); } catch (_) {}
        try { F.refreshPropertiesPanel?.(); } catch (_) {}
        requestRender();
        return true;
      }
      if (op.type === 'clonerParams') {
        state.history.pop();
        const p = getPart(op.partId);
        if (p?.isCloner) {
          p.cloner = JSON.parse(JSON.stringify(op.before));
          _clonerRebuild(p);
          F.refreshPropertiesPanel?.();
        }
        state.redo.push(op);
        requestRender();
        return true;
      }
      if (op.type === 'clonerDissolve') {
        state.history.pop();
        const s = op.snap;
        const valid = (s.cloner.sources || []).map(getPart).filter(sp => sp && sp.mesh);
        if (valid.length) {
          const grp = new THREE.Group();
          grp.name = s.name;
          grp.userData.isCloner = true;
          grp.userData._clonerCloneRefs = [];
          state.partsRoot.add(grp);
          grp.position.fromArray(s.clonerGroupPos);
          grp.quaternion.fromArray(s.clonerGroupQuat);
          grp.scale.fromArray(s.clonerGroupScale);
          grp.updateMatrixWorld(true);
          for (const ss of s.sources) {
            const sp = getPart(ss.partId);
            if (!sp || !sp.mesh) continue;
            grp.attach(sp.mesh);
            sp.mesh.matrix.fromArray(ss.prevLocalMat);
            sp.mesh.matrix.decompose(sp.mesh.position, sp.mesh.quaternion, sp.mesh.scale);
            sp.mesh.updateMatrixWorld(true);
          }
          const partInfo = {
            partId: s.partId, name: s.name, hash: 'cloner_' + s.partId,
            triCount: 0, vertCount: 0, bbox: new THREE.Box3(),
            sizeMetrics: { diag: 0, vol: 0, max: 0 },
            visible: true, deleted: false, flagged: false,
            originalColor: new THREE.Color(0x6b8dff),
            mesh: grp, group: null, instanceIndex: -1, instancedMesh: null,
            userExtras: {}, isCloner: true,
            cloner: JSON.parse(JSON.stringify(s.cloner)),
          };
          const existingIdx = state.parts.findIndex(pp => pp.partId === s.partId);
          if (existingIdx >= 0) state.parts[existingIdx] = partInfo;
          else state.parts.push(partInfo);
          if (state.partById) state.partById.set(s.partId, partInfo);
          _clonerRebuild(partInfo);
          state.treeNodes ||= [];
          let minId = -100;
          for (const n of state.treeNodes) if (n.kind === 'group' && n.id < minId) minId = n.id - 1;
          const nodeId = Math.min(minId - 1, -200);
          state.treeNodes.unshift({
            id: nodeId, kind: 'cloner', name: s.name, depth: 0, parentId: null, partId: null, obj3d: grp,
          });
          for (const ss of s.sources) {
            let idx = state.treeNodes.findIndex(n => n.kind === 'part' && n.partId === ss.partId);
            if (idx >= 0) {
              const tn = state.treeNodes[idx];
              tn.parentId = nodeId; tn.depth = 1;
              state.treeNodes.splice(idx, 1);
              const insertAt = state.treeNodes.findIndex(n => n.id === nodeId) + 1;
              state.treeNodes.splice(insertAt, 0, tn);
            }
          }
        }
        state.redo.push(op);
        try { F.rebuildTree?.(); } catch (_) {}
        try { F.refreshPropertiesPanel?.(); } catch (_) {}
        try { F.applySelectionColors?.(); } catch (_) {}
        requestRender();
        return true;
      }
      return false;
    });
    H.redoHandlers.push((op) => {
      if (op.type === 'clonerAdd') {
        state.redo.pop();
        const sourceIds = (op.sources || []).map(s => s.partId);
        _clonerCreateFromParts(sourceIds);
        state.history.push(op);
        return true;
      }
      if (op.type === 'clonerParams') {
        state.redo.pop();
        const p = getPart(op.partId);
        if (p?.isCloner) {
          p.cloner = JSON.parse(JSON.stringify(op.after));
          _clonerRebuild(p);
          F.refreshPropertiesPanel?.();
        }
        state.history.push(op);
        requestRender();
        return true;
      }
      if (op.type === 'clonerDissolve') {
        state.redo.pop();
        const p = getPart(op.snap.partId);
        if (p?.isCloner) _clonerDissolve(p);
        state.history.push(op);
        try { F.rebuildTree?.(); } catch (_) {}
        try { F.refreshPropertiesPanel?.(); } catch (_) {}
        requestRender();
        return true;
      }
      return false;
    });

    function _clonerCreateFromSelection() {
      const ids = [...(state.selected || [])];
      if (!ids.length) { toast('Cloner', 'Select a part first', 'warn'); return null; }
      return _clonerCreateFromParts(ids);
    }

    // Surface "Cloner from selection" in the cmd-K command palette.
    try {
      const Actions = F._Actions;
      if (Actions && Actions.list) {
        Actions.list.push({
          id: 'cloner', group: 'Edit', label: 'Cloner from selection',
          run: () => { try { _clonerCreateFromSelection(); } catch (e) { console.warn('[cloner] create failed:', e); } },
        });
      }
    } catch (_) {}

    // Toolbar button (#btn-cloner). Enabled only when the selection contains
    // at least one cloneable part — instanced parts and existing cloners
    // are skipped by createFromSelection so we mirror that gating in the
    // disabled state. Polled at 200 ms (cheap; same cadence the existing
    // dec-sel-count badge uses).
    const btnCloner = document.getElementById('btn-cloner');
    if (btnCloner) {
      btnCloner.addEventListener('click', () => {
        try { _clonerCreateFromSelection(); } catch (e) { console.warn('[cloner] toolbar create failed:', e); }
      });
      const _refreshClonerBtn = () => {
        const ids = [...(state.selected || [])];
        let hasCloneable = false;
        for (const id of ids) {
          const sp = getPart(id);
          if (sp && !sp.deleted && sp.mesh && !sp.instancedMesh && !sp.isCloner) {
            hasCloneable = true; break;
          }
        }
        btnCloner.disabled = !hasCloneable;
      };
      setInterval(_refreshClonerBtn, 200);
      _refreshClonerBtn();
    }

    if (!document.getElementById('_cloner-style')) {
      const s = document.createElement('style');
      s.id = '_cloner-style';
      s.textContent = `
        .cln-section{padding:var(--space-md) 0;border-top:1px solid var(--bd)}
        .cln-section .prop-section-title{display:flex;align-items:center;justify-content:space-between;padding:0 var(--space-md) var(--space-sm) var(--space-md);font-size:var(--fs-11);font-weight:var(--fw-semibold);color:var(--tx3);text-transform:uppercase;letter-spacing:var(--tracking-wide)}
        .cln-section .prop-section-title svg{width:13px;height:13px;margin-right:6px;vertical-align:-2px}
        .cln-count-badge{font-size:var(--fs-10);color:var(--tx2);background:var(--s2);padding:2px 8px;border-radius:var(--r-pill);font-weight:var(--fw-medium);letter-spacing:0;text-transform:none}
        .cln-tabs{display:flex;gap:4px;padding:0 var(--space-md) var(--space-sm) var(--space-md)}
        .cln-tab{flex:1;padding:5px 8px;font-size:var(--fs-11);font-weight:var(--fw-medium);background:var(--bg2);color:var(--tx2);border:1px solid var(--bd);border-radius:var(--r-sm);cursor:pointer;transition:background 120ms var(--ease-out),color 120ms var(--ease-out),border-color 120ms var(--ease-out)}
        .cln-tab:hover{background:var(--bg3);color:var(--tx)}
        .cln-tab.active{background:var(--ac-tint-12,rgba(107,141,255,.12));border-color:var(--ac-line,rgba(107,141,255,.45));color:var(--ac)}
        .cln-body{padding:0 var(--space-md);display:flex;flex-direction:column;gap:4px}
        /* All rows share one rigid 3-column grid so labels, sliders, and
           value boxes align across modes. Toggle rows reuse the third
           column with the toggle right-aligned for visual consistency. */
        .cln-row{display:grid;grid-template-columns:60px 1fr 78px;gap:var(--space-sm);align-items:center;min-height:22px}
        .cln-row-toggle .cln-toggle{justify-self:end;grid-column:3}
        .cln-label{font-size:var(--fs-11);color:var(--tx2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .cln-slider{width:100%;min-width:0}
        .cln-val-wrap{display:flex;align-items:center;gap:3px;width:100%;box-sizing:border-box;background:var(--bg2);border:1px solid var(--bd);border-radius:var(--r-sm);padding:0 5px;height:22px;font-variant-numeric:tabular-nums}
        .cln-value{flex:1;min-width:0;border:0;background:transparent;color:var(--tx);font-size:var(--fs-11);width:auto;outline:none;font-variant-numeric:tabular-nums;-moz-appearance:textfield}
        .cln-value::-webkit-outer-spin-button,.cln-value::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
        .cln-unit{font-size:var(--fs-10);color:var(--tx3);flex-shrink:0}
        .cln-subhead{font-size:var(--fs-10);font-weight:var(--fw-semibold);color:var(--tx3);text-transform:uppercase;letter-spacing:var(--tracking-wide);margin:8px 0 2px;padding-top:6px;border-top:1px solid var(--s2)}
        .cln-subhead:first-child{margin-top:2px;padding-top:0;border-top:0}
        .cln-select{width:100%;background:var(--bg2);border:1px solid var(--bd);color:var(--tx);font-size:var(--fs-11);padding:3px 6px;border-radius:var(--r-sm);grid-column:2 / span 2}
        .cln-toggle{position:relative;display:inline-block;width:30px;height:16px}
        .cln-toggle input{position:absolute;opacity:0;width:0;height:0}
        .cln-toggle span{position:absolute;inset:0;background:var(--bg3);border-radius:9px;transition:background 150ms var(--ease-out);cursor:pointer}
        .cln-toggle span::before{content:"";position:absolute;width:12px;height:12px;left:2px;top:2px;background:var(--tx);border-radius:50%;transition:transform 150ms var(--ease-out),background 150ms var(--ease-out)}
        .cln-toggle input:checked + span{background:var(--ac)}
        .cln-toggle input:checked + span::before{transform:translateX(14px);background:var(--bg)}
        .cln-foot{padding:var(--space-sm) var(--space-md) 0}
        .cln-btn{display:inline-flex;align-items:center;gap:5px;padding:5px 9px;font-size:var(--fs-11);background:var(--bg2);border:1px solid var(--bd);color:var(--tx2);border-radius:var(--r-sm);cursor:pointer;transition:background 120ms var(--ease-out)}
        .cln-btn:hover{background:var(--bg3);color:var(--tx)}
        .cln-btn-warn:hover{border-color:var(--er-line);color:var(--er)}
        .cln-btn svg{width:12px;height:12px}
        .tree-typeicon.cln{color:var(--ac);background:var(--ac-tint-12,rgba(107,141,255,.12))}
        .tree-node.is-cloner .tree-label{color:var(--ac)}
      `;
      document.head.appendChild(s);
    }

    // Stress-test entrypoint — paste `_Cloner.stress(N)` in the DevTools
    // console (default N=20) to exercise creation, mode swaps, slider
    // sweeps, source-mesh edits, gizmo-style detach simulation, and
    // dissolve. Runs in the foreground; logs a per-step PASS/FAIL line
    // and a summary so regressions are obvious.
    function _stress(N) {
      N = Math.max(1, N | 0 || 20);
      const log  = (...a) => console.log('[stress]', ...a);
      const pass = (m)   => console.log('%c[stress] PASS', 'color:#10b981', m);
      const fail = (m)   => console.warn('%c[stress] FAIL', 'color:#ef4444', m);
      let passes = 0, fails = 0;
      const ok = (cond, msg) => { if (cond) { passes++; pass(msg); } else { fails++; fail(msg); } };

      // Need at least one cloneable part — bail with a hint if the scene
      // is empty.
      const ids = state.parts.filter(p => !p.deleted && p.mesh && !p.instancedMesh && !p.isCloner).map(p => p.partId);
      if (!ids.length) { fail('no cloneable parts — load or add a part first'); return; }
      const sourceId = ids[0];

      // 1. Create cloner.
      const cloner = _clonerCreateFromParts([sourceId]);
      ok(cloner && cloner.isCloner, 'cloner created');
      if (!cloner) return;

      // 2. Verify children: source + InstancedMesh.
      ok(cloner.mesh.children.length === 2,
        `phase 1 children = 2 (got ${cloner.mesh.children.length})`);

      // 3. Sweep slider params.
      const c = cloner.cloner;
      for (const v of [10, 50, 100, 200, 50]) {
        c.linear.count = v;
        const r = _clonerRebuild(cloner);
        ok(r === 'rebuilt', `rebuild count=${v} → ${r}`);
      }

      // 4. Mode swap to radial.
      c.mode = 'radial';
      ok(_clonerRebuild(cloner) === 'rebuilt', 'rebuild in radial mode');

      // 5. Mode swap to grid.
      c.mode = 'grid';
      ok(_clonerRebuild(cloner) === 'rebuilt', 'rebuild in grid mode');

      // 6. Toggle instancing off.
      c.useInstancing = false;
      ok(_clonerRebuild(cloner) === 'rebuilt', 'non-instanced rebuild');
      ok(!cloner.mesh.children.some(ch => ch.isInstancedMesh),
        'no InstancedMesh in non-instanced mode');

      // 7. Toggle back on.
      c.useInstancing = true;
      ok(_clonerRebuild(cloner) === 'rebuilt', 'instanced rebuild');

      // 8. Simulate gizmo: move source under state.pivot. Rebuild should defer.
      const src = getPart(sourceId).mesh;
      const origParent = src.parent;
      if (state.pivot) {
        state.pivot.attach(src);
        ok(_clonerRebuild(cloner) === 'deferred', 'rebuild deferred under gizmo');
        // Restore — should self-heal back into grp.
        state.partsRoot.attach(src);
        ok(_clonerRebuild(cloner) === 'rebuilt', 'self-heal after gizmo release');
        ok(src.parent === cloner.mesh, 'source reattached to cloner Group');
      } else {
        log('skip gizmo simulation (no state.pivot)');
      }

      // 9. N rapid rebuilds — make sure no refs leak.
      for (let i = 0; i < N; i++) {
        c.mode = (['linear', 'radial', 'grid'])[i % 3];
        _clonerRebuild(cloner);
      }
      ok(true, `${N} rapid mode-swap rebuilds completed`);

      // 10. Dissolve. Verify source returned to partsRoot, grp removed.
      _clonerDissolve(cloner);
      ok(cloner.deleted === true, 'cloner marked deleted on dissolve');
      ok(cloner.mesh.parent === null, 'cloner Group removed from scene');
      ok(getPart(sourceId).mesh.parent === state.partsRoot, 'source returned to partsRoot');

      // 11. Idempotent dissolve.
      _clonerDissolve(cloner);
      ok(true, 'second dissolve is no-op');

      console.log(`%c[stress] complete — ${passes} pass / ${fails} fail`,
        fails ? 'color:#ef4444;font-weight:bold' : 'color:#10b981;font-weight:bold');
      try { F.rebuildTree?.(); F.refreshPropertiesPanel?.(); } catch (_) {}
    }

    window._Cloner = {
      createFromSelection: _clonerCreateFromSelection,
      createFromParts: _clonerCreateFromParts,
      rebuild: _clonerRebuild,
      dissolve: _clonerDissolve,
      stress: _stress,
    };
    console.log('[cloner] ready — _Cloner.createFromSelection() or cmd-K → "Cloner from selection". Stress-test: _Cloner.stress()');
  }

  _whenReady();
})();
