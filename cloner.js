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
        // Hide the source mesh(es) from the viewport so only generated clones
        // render. Useful for symmetric arrays where the source-at-origin is
        // already represented by clone-0.
        hideSources: false,
        // Center the array on the cloner's origin (linear/grid only). When
        // false, clones grow in +direction from the source.
        centerArray: false,
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
      const center = !!c.centerArray;
      if (c.mode === 'linear') {
        const L = c.linear;
        // When centered, shift every clone back by half the array span so the
        // array straddles the origin. mid = (count - 1) / 2.
        const mid = center ? (Math.max(1, L.count | 0) - 1) / 2 : 0;
        const k = i - mid;
        if (k === 0 && !center) return out.identity();
        _V.set(L.dx * k, L.dy * k, L.dz * k);
        _E.set(L.rxDeg * k * Math.PI / 180, L.ryDeg * k * Math.PI / 180, L.rzDeg * k * Math.PI / 180, 'XYZ');
        _Q.setFromEuler(_E);
        _S.set(Math.pow(L.sxStep, k), Math.pow(L.syStep, k), Math.pow(L.szStep, k));
        return out.compose(_V, _Q, _S);
      }
      if (c.mode === 'radial') {
        // Radial is inherently centered around the cloner origin; centerArray
        // is a no-op here.
        if (i === 0) return out.identity();
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
        const nx = Math.max(1, G.nx | 0), ny = Math.max(1, G.ny | 0), nz = Math.max(1, G.nz | 0);
        const ix = i % nx;
        const iy = Math.floor(i / nx) % ny;
        const iz = Math.floor(i / (nx * ny));
        const cx = center ? (nx - 1) / 2 : 0;
        const cy = center ? (ny - 1) / 2 : 0;
        const cz = center ? (nz - 1) / 2 : 0;
        _V.set((ix - cx) * G.dx, (iy - cy) * G.dy, (iz - cz) * G.dz);
        if (i === 0 && !center) return out.identity();
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
      // Source role differs by mode + the centerArray pref:
      //   linear / grid (uncentered): source IS clone-0 (visible at offset
      //     0). N-1 synthetic clones at offsets 1..N-1.
      //   linear / grid (centered): source is hidden — every position is a
      //     synthetic clone at offsets 0..N-1 so the array straddles the
      //     cloner origin instead of growing in +direction.
      //   radial: source is the instance GENERATOR (hidden). N synthetic
      //     clones cover the full circle at offsets 0..N-1 — no clone at
      //     the cloner-Group origin (would sit at the centre of the radial
      //     pattern, looking wrong).
      const radial = c.mode === 'radial';
      // True when the source mesh visibly serves as clone-0; false when it
      // becomes a hidden generator.
      const sourceIsClone0 = !radial && !c.centerArray;
      const cloneCount = sourceIsClone0 ? Math.max(0, count - 1) : count;
      const startIdx   = sourceIsClone0 ? 1 : 0;
      // Final source visibility: only when (a) source is clone-0 AND (b) the
      // user hasn't asked to hide sources for symmetric setups.
      const sourceVisible = sourceIsClone0 && !c.hideSources;

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
            src.visible = sourceVisible;
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
            src.visible = sourceVisible;
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

    // sourceIds may be empty / null to create a "standalone" cloner with no
    // sources yet — the user then drags parts into the cloner row in the
    // tree to register them (C4D-style). The rebuild emits nothing for an
    // empty source list but the cloner is fully functional otherwise.
    function _clonerCreateFromParts(sourceIds, opts) {
      sourceIds = Array.isArray(sourceIds) ? sourceIds : [];
      const valid = [];
      for (const sid of sourceIds) {
        const sp = getPart(sid);
        if (!sp || sp.deleted || !sp.mesh) continue;
        if (sp.instancedMesh) continue;
        if (sp.isCloner) continue;
        valid.push(sp);
      }
      const standalone = !valid.length;
      if (standalone && sourceIds.length > 0) {
        // Caller passed ids but every one was filtered (instanced / deleted /
        // cloner) — warn, but still proceed to create an empty cloner so the
        // user can drag valid parts in instead.
        toast('Cloner', 'Selection skipped (instanced / cloner) — empty cloner created. Drag parts into it.', 'info', 2400);
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
      if (standalone) {
        toast('Cloner created', 'Empty — drag parts into the Cloner row in the tree to add sources', 'info', 2600);
      } else {
        toast('Cloner created', `${valid.length} source · ${_clonerCount(partInfo.cloner)} clones`, 'info', 1800);
      }
      return partInfo;
    }

    // Append `sourceIds` to an existing cloner's source list, reparent the
    // source meshes under the cloner Group, and rebuild. Used by the
    // tree-drop integration so dropping parts onto a cloner row registers
    // them — same effect as if they'd been part of the original selection.
    function _clonerAddSources(clonerPart, sourceIds) {
      if (!clonerPart?.isCloner || clonerPart.deleted) return 0;
      if (!Array.isArray(sourceIds) || !sourceIds.length) return 0;
      const grp = clonerPart.mesh;
      if (!grp) return 0;
      const c = clonerPart.cloner;
      const already = new Set(c.sources || []);
      const added = [];
      const _prevParents = new Map();
      for (const sid of sourceIds) {
        const sp = getPart(sid);
        if (!sp || sp.deleted || !sp.mesh) continue;
        if (sp.instancedMesh || sp.isCloner) continue;
        if (already.has(sid)) continue;
        _prevParents.set(sid, sp.mesh.parent || state.partsRoot);
        // attach() preserves world transform — the source visibly stays put
        // while its parent flips to the cloner Group.
        grp.attach(sp.mesh);
        c.sources = c.sources || [];
        c.sources.push(sid);
        already.add(sid);
        added.push(sp);
      }
      if (!added.length) return 0;
      // Reparent the matching tree nodes under the cloner so the tree visually
      // reflects the new ownership.
      try {
        const clonerNode = (state.treeNodes || []).find(n => n.kind === 'cloner' && n.obj3d === grp);
        if (clonerNode) {
          for (const sp of added) {
            let idx = state.treeNodes.findIndex(n => n.kind === 'part' && n.partId === sp.partId);
            if (idx >= 0) {
              const tn = state.treeNodes[idx];
              tn.parentId = clonerNode.id;
              tn.depth = (clonerNode.depth || 0) + 1;
              state.treeNodes.splice(idx, 1);
              const insertAt = state.treeNodes.findIndex(n => n.id === clonerNode.id) + 1;
              state.treeNodes.splice(insertAt, 0, tn);
            } else {
              const insertAt = state.treeNodes.findIndex(n => n.id === clonerNode.id) + 1;
              state.treeNodes.splice(insertAt, 0, {
                id: sp.partId, kind: 'part', name: sp.name,
                depth: (clonerNode.depth || 0) + 1,
                parentId: clonerNode.id, partId: sp.partId, instanceCount: 0,
                obj3d: sp.mesh,
              });
            }
          }
        }
      } catch (_) {}
      _clonerRebuild(clonerPart);
      try {
        pushUndo({
          type: 'clonerAddSources',
          partId: clonerPart.partId,
          sources: added.map(sp => ({
            partId: sp.partId,
            prevParent: _prevParents.get(sp.partId) || state.partsRoot,
            prevLocalMat: sp.mesh.matrix.elements.slice(),
          })),
        });
      } catch (_) {}
      try { F.rebuildTree?.(); } catch (_) {}
      try { F.refreshPropertiesPanel?.(); } catch (_) {}
      try { F.applySelectionColors?.(); } catch (_) {}
      requestRender();
      toast('Cloner', `+${added.length} source${added.length === 1 ? '' : 's'} (${_clonerCount(c)} clones)`, 'info', 1600);
      return added.length;
    }

    // Drop `sourceIds` from a cloner's source list. Called when the user
    // drags a source row OUT of the cloner in the tree. Without this, the
    // rebuild's "stray re-attach" path (which exists to defend against
    // accidental post-gizmo detachment) would yank the part right back into
    // the Group on the next rebuild and the user couldn't free it.
    //
    // We DON'T reparent the mesh here — the standard DnD splice already
    // moves the THREE.Object3D for us; this function just edits the source
    // list and rebuilds the clones to drop the now-orphaned generator.
    function _clonerRemoveSources(clonerPart, sourceIds) {
      if (!clonerPart?.isCloner || clonerPart.deleted) return 0;
      if (!Array.isArray(sourceIds) || !sourceIds.length) return 0;
      const c = clonerPart.cloner;
      if (!c.sources || !c.sources.length) return 0;
      const drop = new Set(sourceIds.map(n => +n));
      const before = c.sources.slice();
      c.sources = c.sources.filter(sid => !drop.has(+sid));
      const removed = before.length - c.sources.length;
      if (!removed) return 0;
      // Restore the source meshes' own visibility flag — when sourceIsClone0
      // was false (centerArray on, or hideSources on), the rebuild forced
      // src.visible=false. Now that the source is no longer a clone
      // generator, it should be visible again wherever the DnD placed it.
      for (const sid of drop) {
        const sp = getPart(sid);
        if (sp && sp.mesh) sp.mesh.visible = sp.visible !== false;
      }
      _clonerRebuild(clonerPart);
      try { F.refreshPropertiesPanel?.(); } catch (_) {}
      requestRender();
      return removed;
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

    // ── UI: Cloner card — replaces the full Properties body when a cloner
    // is selected. The standard triangle/vertex/material stats don't apply
    // to a Group container, so we render a dedicated card instead.
    function _renderClonerCard(p) {
      if (!p?.isCloner) return '';
      const c = p.cloner;
      const u = _UNIT_LABEL[state.displayUnit] || 'mm';
      // Mode picker — icon cards instead of text tabs. Each card shows an
      // icon + label; the active one gets the accent treatment.
      const modeCard = (id, icon, label) => `
        <button type="button" class="cln-mode-card${c.mode === id ? ' active' : ''}" data-cln-mode="${id}" title="${escapeHtml(label)} cloner">
          <i data-lucide="${icon}"></i>
          <span>${label}</span>
        </button>`;
      // Slider row — reuses .prim-row + .prim-slider + .prim-value classes
      // so the cloner sliders are pixel-identical to the custom-shape sliders
      // elsewhere. data-cln-* hooks keep the wiring distinct from primitives.
      const slider = (label, key, val, min, max, step, suffix='') => `
        <div class="prim-row" data-cln-field="${key}">
          <label class="prim-label">${escapeHtml(label)}</label>
          <input type="range" data-cln-input min="${min}" max="${max}" step="${step}" value="${val}" class="prim-slider">
          <span class="prim-val-wrap"><input type="number" class="prim-value" data-cln-value min="${min}" max="${max}" step="${step}" value="${val}">${suffix ? `<span class="prim-unit">${escapeHtml(suffix)}</span>` : ''}</span>
        </div>`;
      const intSlider = (label, key, val, min, max) => slider(label, key, val, min, max, 1, '');
      const distSlider = (label, key, val) => slider(label, key, val, -500, 500, 1, u);
      const angSlider = (label, key, val, min=-360, max=360) => slider(label, key, val, min, max, 1, '°');
      const scaleSlider = (label, key, val) => slider(label, key, val, 0.1, 3, 0.05, '×');
      const axisSel = (val) => `
        <div class="prim-row">
          <label class="prim-label">Axis</label>
          <select class="prim-select" data-cln-axis>
            <option value="x"${val==='x'?' selected':''}>X</option>
            <option value="y"${val==='y'?' selected':''}>Y</option>
            <option value="z"${val==='z'?' selected':''}>Z</option>
          </select>
        </div>`;
      const toggle = (label, key, val, hint='') => `
        <div class="prim-row cln-toggle-row" data-cln-toggle-row="${key}">
          <label class="prim-label">${escapeHtml(label)}${hint ? `<span class="cln-hint">${escapeHtml(hint)}</span>` : ''}</label>
          <label class="prim-toggle"><input type="checkbox" data-cln-toggle="${key}" ${val ? 'checked' : ''}><span></span></label>
        </div>`;
      const subhead = (label) => `<div class="cln-subhead">${escapeHtml(label)}</div>`;

      let modeBody = '';
      if (c.mode === 'linear') {
        const L = c.linear;
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
          toggle('Face center', 'radial.faceCenter', R.faceCenter, 'Rotate each clone so its front points at the centre');
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
      const sourceCount = (c.sources || []).filter(sid => {
        const sp = getPart(sid); return sp && !sp.deleted && sp.mesh;
      }).length;
      const hasSources = sourceCount > 0;
      const emptyHint = hasSources ? '' : `
        <div class="cln-empty">
          <i data-lucide="mouse-pointer-2" class="cln-empty-icon"></i>
          <div class="cln-empty-text">No sources yet</div>
          <div class="cln-empty-sub">Drag a part onto the <strong>Cloner</strong> row in the tree to add it.</div>
        </div>`;
      const sourcesChip = hasSources
        ? `<span class="cln-source-chip" title="Source parts feeding this cloner"><i data-lucide="link"></i>${sourceCount} source${sourceCount === 1 ? '' : 's'}</span>`
        : '';
      // centerArray only makes sense for linear/grid — radial is centred by
      // construction. Hide the toggle in radial mode to avoid confusion.
      const centerToggle = (c.mode === 'radial') ? '' : toggle('Center array', 'centerArray', c.centerArray, 'Straddle the cloner origin instead of growing in +direction');

      return `
        <div class="cln-card">
          <div class="cln-card-head">
            <div class="cln-card-head-row">
              <div class="cln-card-icon"><i data-lucide="copy"></i></div>
              <div class="cln-card-titles">
                <div class="cln-card-title">${escapeHtml(p.name || 'Cloner')}</div>
                <div class="cln-card-sub">
                  <span class="cln-count-badge">${totalCount} clone${totalCount === 1 ? '' : 's'}</span>
                  ${sourcesChip}
                </div>
              </div>
            </div>
          </div>

          ${emptyHint}

          <div class="cln-mode-picker">
            ${modeCard('linear', 'move-horizontal', 'Linear')}
            ${modeCard('radial', 'rotate-cw', 'Radial')}
            ${modeCard('grid',   'grid-3x3', 'Grid')}
          </div>

          <div class="cln-section-body">
            ${modeBody}
          </div>

          <div class="cln-divider"></div>

          <div class="cln-section-body">
            ${centerToggle}
            ${toggle('Hide sources', 'hideSources', c.hideSources, 'Only render generated clones')}
            ${toggle('Use instancing', 'useInstancing', c.useInstancing, 'One GPU draw call per source — faster for big arrays')}
          </div>

          <div class="cln-foot">
            <button type="button" class="cln-btn" data-cln-act="reset" title="Reset all parameters for the current mode"><i data-lucide="rotate-ccw"></i> Reset</button>
            <button type="button" class="cln-btn cln-btn-warn" data-cln-act="dissolve" title="Dissolve cloner — restore source(s) to the scene"><i data-lucide="layers-2"></i> Dissolve</button>
          </div>
        </div>`;
    }
    // Backward-compat alias — earlier code paths called this name.
    function _renderClonerSection(p) { return _renderClonerCard(p); }

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
      rootEl.querySelectorAll('.cln-mode-card').forEach(btn => {
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
      rootEl.querySelectorAll('.prim-row[data-cln-field]').forEach(row => {
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
      // Reset — restore defaults for the currently-active mode while keeping
      // unrelated mode params + sources + the cloner identity intact. One
      // undo entry so Ctrl+Z brings the previous values back atomically.
      rootEl.querySelector('[data-cln-act="reset"]')?.addEventListener('click', () => {
        const before = JSON.parse(JSON.stringify(c));
        const defaults = _clonerDefaults();
        c[c.mode] = defaults[c.mode];
        _clonerRebuild(p);
        try { pushUndo({ type: 'clonerParams', partId: p.partId, before, after: JSON.parse(JSON.stringify(c)) }); } catch (_) {}
        F.refreshPropertiesPanel?.();
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
    // Replace the entire Properties panel body when a cloner is selected.
    // The standard part stats (triangles, vertices, material thumbnail,
    // bbox/diag/volume) don't apply to a Group container — surfacing them
    // is just visual noise. The cloner card is a complete, self-contained
    // UI: header, mode picker, parameter sliders, options, action buttons.
    H.propsRenderHooks.push((sel, el) => {
      if (!el) return;
      const cloner = _activeCloner(sel);
      if (!cloner) return;
      el.innerHTML = _renderClonerCard(cloner);
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
          const ti = row.querySelector('.tree-typeicon');
          if (ti) {
            ti.classList.remove('asm');
            ti.classList.add('cln');
            // Lucide replaces <i data-lucide="..."> with an <svg> at render
            // time, so by the time the MutationObserver fires the original
            // archive svg is already in place. Wipe the inner content and
            // drop in a fresh <i data-lucide="copy"> so the next _lucide()
            // pass renders the cloner icon instead.
            ti.innerHTML = '<i data-lucide="copy"></i>';
          }
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
      if (op.type === 'clonerAddSources') {
        // Undo a drag-into-cloner: detach the dropped sources from the
        // cloner Group, restore their original parents + local matrices,
        // and pop them off the cloner.sources list. Tree rows snap back
        // to top level (parentId=null) so the rebuild reflects reality.
        state.history.pop();
        const p = getPart(op.partId);
        if (p?.isCloner) {
          const removeIds = new Set((op.sources || []).map(s => s.partId));
          for (const s of op.sources || []) {
            const sp = getPart(s.partId);
            if (!sp || !sp.mesh) continue;
            (s.prevParent || state.partsRoot).attach(sp.mesh);
            sp.mesh.matrix.fromArray(s.prevLocalMat);
            sp.mesh.matrix.decompose(sp.mesh.position, sp.mesh.quaternion, sp.mesh.scale);
            sp.mesh.visible = sp.visible !== false;
            sp.mesh.updateMatrixWorld(true);
          }
          if (p.cloner) p.cloner.sources = (p.cloner.sources || []).filter(sid => !removeIds.has(sid));
          // Detach tree rows so they no longer appear under the cloner.
          for (const sid of removeIds) {
            const tn = (state.treeNodes || []).find(n => n.kind === 'part' && n.partId === sid);
            if (tn) { tn.parentId = null; tn.depth = 0; }
          }
          _clonerRebuild(p);
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
      if (op.type === 'clonerAddSources') {
        state.redo.pop();
        const p = getPart(op.partId);
        if (p?.isCloner) {
          _clonerAddSources(p, (op.sources || []).map(s => s.partId));
          // _clonerAddSources pushed a fresh undo entry — replace it with
          // the original op so subsequent undo→redo cycles stay consistent.
          if (state.history[state.history.length - 1]?.type === 'clonerAddSources') {
            state.history.pop();
          }
        }
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

    // With nothing selected, creates an empty standalone cloner (the user
    // drags parts in afterward). With a selection, behaves as before —
    // wrapping the cloneable parts as sources.
    function _clonerCreateFromSelection() {
      const ids = [...(state.selected || [])];
      return _clonerCreateFromParts(ids);
    }

    // Surface in the cmd-K command palette. Label adapts to whether a usable
    // selection exists, but the action is always runnable.
    try {
      const Actions = F._Actions;
      if (Actions && Actions.list) {
        Actions.list.push({
          id: 'cloner', group: 'Edit', label: 'Cloner from selection (or empty)',
          run: () => { try { _clonerCreateFromSelection(); } catch (e) { console.warn('[cloner] create failed:', e); } },
        });
      }
    } catch (_) {}

    // Toolbar button (#btn-cloner). Always enabled — nothing-selected creates
    // an empty cloner the user can drag parts into. Tooltip flips between the
    // two modes so it's clear what will happen.
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
        btnCloner.disabled = false;
        btnCloner.title = hasCloneable
          ? 'Wrap the selection in a live C4D-style cloner (Linear / Radial / Grid)'
          : 'Create an empty Cloner — drag parts into it in the tree to add sources';
      };
      setInterval(_refreshClonerBtn, 200);
      _refreshClonerBtn();
    }

    if (!document.getElementById('_cloner-style')) {
      const s = document.createElement('style');
      s.id = '_cloner-style';
      s.textContent = `
        /* ════ Cloner card — a dedicated property-panel layout that replaces
           the standard part stats (triangles/vertices/material) when a cloner
           is selected. Sliders reuse .prim-row classes so they're pixel-
           identical to the custom-shape sliders. ════ */

        .cln-card{display:flex;flex-direction:column;padding:0}

        /* ── Card header ── accent strip + icon tile + title + count chips */
        .cln-card-head{padding:var(--space-lg) var(--space-md) var(--space-md);background:linear-gradient(180deg,var(--ac-tint-08) 0%,transparent 100%);border-bottom:1px solid var(--bd)}
        .cln-card-head-row{display:flex;align-items:center;gap:10px}
        .cln-card-icon{flex:0 0 36px;width:36px;height:36px;border-radius:var(--r-md);background:linear-gradient(135deg,var(--ac),var(--ac-active));display:grid;place-items:center;color:#fff;box-shadow:0 6px 18px var(--ac-tint-35),inset 0 1px 0 rgba(255,255,255,.18)}
        .cln-card-icon svg{width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:2}
        .cln-card-titles{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
        .cln-card-title{font-size:var(--fs-md);font-weight:var(--fw-semibold);color:var(--tx);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.2}
        .cln-card-sub{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
        .cln-count-badge{display:inline-flex;align-items:center;font-size:var(--fs-10);color:var(--ac);background:var(--ac-tint-12);padding:2px 9px;border-radius:var(--r-pill);font-weight:var(--fw-semibold);letter-spacing:.02em;font-variant-numeric:tabular-nums}
        .cln-source-chip{display:inline-flex;align-items:center;gap:4px;font-size:var(--fs-10);color:var(--tx3);background:var(--s2);padding:2px 8px;border-radius:var(--r-pill);font-weight:var(--fw-medium)}
        .cln-source-chip svg{width:10px;height:10px;stroke:currentColor;fill:none;stroke-width:2}

        /* ── Mode picker — three icon cards with a clear active state. */
        .cln-mode-picker{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:var(--space-md) var(--space-md) var(--space-sm)}
        .cln-mode-card{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:9px 6px;background:var(--bg2);color:var(--tx3);border:1px solid var(--bd);border-radius:var(--r-md);cursor:pointer;transition:background var(--dur-fast) var(--ease-out),color var(--dur-fast) var(--ease-out),border-color var(--dur-fast) var(--ease-out),box-shadow var(--dur-fast) var(--ease-out);font:inherit}
        .cln-mode-card svg{width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:1.7;transition:transform var(--dur-fast) var(--ease-out)}
        .cln-mode-card span{font-size:var(--fs-11);font-weight:var(--fw-medium);letter-spacing:.01em}
        .cln-mode-card:hover{background:var(--bg3);color:var(--tx2);border-color:var(--bd2)}
        .cln-mode-card:hover svg{transform:scale(1.08)}
        .cln-mode-card.active{background:var(--ac-tint-12);color:var(--ac);border-color:var(--ac-line);box-shadow:inset 0 0 0 1px var(--ac-tint-25)}
        .cln-mode-card.active svg{stroke-width:2}

        /* ── Section bodies — wrap sliders / toggles with consistent padding. */
        .cln-section-body{padding:0 var(--space-md);display:flex;flex-direction:column}
        .cln-section-body .prim-row{padding:5px 0}

        /* ── Section subheads — small caps to group Pos/Rot/Scale clusters. */
        .cln-subhead{font-size:var(--fs-10);font-weight:var(--fw-semibold);color:var(--tx3);text-transform:uppercase;letter-spacing:var(--tracking-wide);margin:10px 0 2px;padding-top:8px;border-top:1px solid var(--s2)}
        .cln-subhead:first-child{margin-top:2px;padding-top:0;border-top:0}

        /* ── Inline secondary hint (sits under the toggle label). */
        .cln-hint{display:block;font-size:var(--fs-10);color:var(--tx3);font-weight:var(--fw-regular);margin-top:2px;line-height:var(--lh-base);max-width:200px;white-space:normal}

        /* ── Toggle row — overrides .prim-row defaults to give the label
              breathing room when it carries a hint underneath. */
        .cln-toggle-row{padding:7px 0!important;align-items:start!important}

        /* ── Divider between sections inside the card. */
        .cln-divider{height:1px;background:var(--bd);margin:var(--space-md) var(--space-md) 0;opacity:.6}

        /* ── Empty state — pop-out invite to drag a part in. */
        .cln-empty{display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px 12px;margin:var(--space-md);font-size:var(--fs-11);color:var(--tx3);background:var(--ac-tint-04);border:1px dashed var(--ac-line);border-radius:var(--r-md);text-align:center;line-height:var(--lh-base)}
        .cln-empty-icon{width:22px;height:22px;color:var(--ac);stroke:currentColor;fill:none;stroke-width:1.6;margin-bottom:2px}
        .cln-empty-text{font-size:var(--fs-12);font-weight:var(--fw-semibold);color:var(--tx2)}
        .cln-empty-sub{font-size:var(--fs-11);color:var(--tx3)}
        .cln-empty strong{color:var(--ac);font-weight:var(--fw-semibold)}

        /* ── Foot — Reset + Dissolve, right-aligned. */
        .cln-foot{display:flex;gap:8px;padding:var(--space-md);justify-content:flex-end;border-top:1px solid var(--bd);margin-top:var(--space-md)}
        .cln-btn{display:inline-flex;align-items:center;gap:5px;padding:6px 12px;font:inherit;font-size:var(--fs-11);font-weight:var(--fw-medium);background:var(--bg2);border:1px solid var(--bd);color:var(--tx2);border-radius:var(--r-sm);cursor:pointer;transition:background var(--dur-fast) var(--ease-out),color var(--dur-fast) var(--ease-out),border-color var(--dur-fast) var(--ease-out)}
        .cln-btn:hover{background:var(--bg3);color:var(--tx);border-color:var(--bd2)}
        .cln-btn-warn:hover{background:var(--er-soft);border-color:var(--er-line);color:var(--er)}
        .cln-btn svg{width:12px;height:12px;stroke:currentColor;fill:none;stroke-width:2}

        /* ── Tree-row affordances (unchanged from prior session) ── */
        .tree-node.is-cloner.cln-drop-active{outline:2px dashed var(--ac);outline-offset:-2px;background:var(--ac-tint-15)!important;border-radius:3px}
        .tree-typeicon.cln{color:var(--ac);background:var(--ac-tint-12)}
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
      addSources: _clonerAddSources,
      removeSources: _clonerRemoveSources,
      rebuild: _clonerRebuild,
      dissolve: _clonerDissolve,
      stress: _stress,
    };
    console.log('[cloner] ready — _Cloner.createFromSelection() or cmd-K → "Cloner from selection". Stress-test: _Cloner.stress()');
  }

  _whenReady();
})();
