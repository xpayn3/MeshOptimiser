// The Decimate card (Reduce triangles): the run that reduces the selected parts by a share, to a triangle target or within a distance,
// one undo step; the preview of what it would do; and the count under its button. The reduction itself is simplify-core.js and
// mesh-worker.js, and the helpers it shares with Quick remesh, Fit to budget and Remove holes (loading the simplifier, welding,
// _geomFromIndexParts, _decSnap, the 'decimate' undo op) stay in app.js. Moved out of app.js as it was; app.js hands in what it needs
// (installDecimateCard below) and gets back the entry points Smart optimise calls.
import * as THREE from 'three';

// app: the objects and functions of app.js this card uses (see the call in app.js).
export function installDecimateCard(app) {
  const {
    state, _Job, _MeshWorkers, _simpErr, toast, getPart, fmtNum, requestRender, pushUndo, recomputeStats, rebuildTree,
    refreshPropertiesPanel, applySelectionColors, _nextFrame, _stampGeometry, _refreshPartBBox, _enterHeatmap, _exitHeatmap, _decSnap,
    _geomFromIndexParts, _addDeviation, _creaseAfter, _fmtDev, _importMapUrl, _keepsShape, _loadMeshopt, _loadSimplifier, _maxDeviation,
    _mergeVertices, _planDialog, _planFigure, _shapeOf, _sharpOpts, _simplifyKeepingAttributes, _smartPayload, _stripToPositionsOnly,
    _surfaceDeviation, _threeCoreUrl, _weldForReduction, _withCarriedUvs, packAttributes,
  } = app;

  let _decimateBusy = false;
  async function _decimateSelected(over) { return _Job.run('Reduce', () => _decimateSelected_job(over)); }
  async function _decimateSelected_job(over) {
    if (_decimateBusy) return;
    _decimateBusy = true;
    try { return await _decimateSelectedRun(over && over.tolMm ? over : undefined); }
    finally { _decimateBusy = false; }
  }
  async function _decimateSelectedRun(over) {
    const sel = state.selected;
    if (!sel || sel.size === 0) {
      if (typeof toast === 'function') toast('Decimate', 'Select parts first', 'warn', 2500);
      return;
    }
    // Either a share to remove (−25 … −90%) or a triangle budget for the
    // whole selection ("Target…"), which is turned into one keep-ratio so
    // every part gives up the same share.
    const strengthSel = document.getElementById('decimate-strength');
    const ids = [...sel];
    let selTris = 0;
    for (const id of ids) { const sp = getPart(id); if (sp && !sp.deleted && sp.mesh) selTris += sp.triCount || 0; }
    let keep, tolMm = 0;
    if (over && over.tolMm > 0) {                      // asked for by Smart optimise or a recipe, not by the controls
      tolMm = over.tolMm; keep = 0;
    } else if (strengthSel && strengthSel.value === 'tol') {
      tolMm = parseFloat((document.getElementById('decimate-tol')?.value || '').replace(',', '.'));
      if (!(tolMm > 0)) { toast('Decimate', 'Type how far a point may move, in mm', 'warn', 3000); return; }
      keep = 0;
    } else if (strengthSel && strengthSel.value === 'target') {
      const want = parseInt((document.getElementById('decimate-target')?.value || '').replace(/[^0-9]/g, ''), 10);
      if (!(want > 0)) { toast('Decimate', 'Type a target triangle count first', 'warn', 3000); return; }
      if (want >= selTris) { toast('Decimate', `The selection already has ${fmtNum(selTris)} triangles`, 'info', 3000); return; }
      keep = want / selTris;
    } else {
      const strength = parseFloat(strengthSel ? strengthSel.value : '0.5');
      if (!(strength > 0 && strength < 1)) return;
      keep = 1 - strength;
    }
    let SM;
    try { SM = await _loadSimplifier(); }
    catch (e) {
      if (typeof toast === 'function') toast('Decimate failed', 'Simplifier load error: ' + e.message, 'error', 4000);
      return;
    }
    const meshopt = await _loadMeshopt();
    const simp = new SM();
    const skipped = [];
    const failed = [];
    const undoItems = [];
    let trisBefore = 0, trisAfter = 0, parts = 0, gentler = 0;

    // The simplifier runs in background workers, several parts at a time.
    // Each job is queued here and awaited in order below; a part whose job
    // fails (or that the workers cannot take: no index buffer, packed
    // positions) is simplified on the page as before.
    const queued = new Map();               // partId → Promise<index ranges | null>
    const simplifierUrl = meshopt ? _importMapUrl('meshoptimizer-simplifier') : null;
    // In tolerance mode the limit is in world units (mm); a mesh drawn through a
    // scaled node measures it in its own units.
    const _sv = new THREE.Vector3();
    // (the largest of the three scales, not their mean: on a part stretched along one axis the mean let the error along that axis pass the limit)
    const unitsOf = (p) => { p.mesh.updateWorldMatrix(true, false); _sv.setFromMatrixScale(p.mesh.matrixWorld); return Math.max(Math.abs(_sv.x), Math.abs(_sv.y), Math.abs(_sv.z)) || 1; };
    const tolFor = (p, f = 1) => tolMm ? f * tolMm / unitsOf(p) : 0;
    const FIRST_PASS = 0.8;                 // the simplifier's own error runs a little low on curved parts; what counts is measured below
    let measuredAll = true;
    let worstErr = 0;                       // the largest error any part reached, in mm
    if (simplifierUrl && _MeshWorkers.available()) {
      for (const id of ids) {
        const p = getPart(id);
        const geom = p && !p.deleted && p.mesh ? p.mesh.geometry : null;
        const posAttr0 = geom && geom.attributes ? geom.attributes.position : null;
        if (!posAttr0 || (geom.index ? geom.index.count : posAttr0.count) < 36) continue;
        if (posAttr0.isInterleavedBufferAttribute || !(posAttr0.array instanceof Float32Array) || posAttr0.itemSize !== 3) continue;
        let weld = null;
        queued.set(id, _MeshWorkers.run(() => {
          weld = _weldForReduction(geom);                // (welded by position first: see _weldForReduction; a mesh without an index gets one)
          const src = weld.src, posAttr = src.attributes.position;
          const positions = posAttr.array.slice();
          const index = Uint32Array.from(src.index.array);
          const groups = (src.groups && src.groups.length > 1)
            ? src.groups.map(g => ({ start: g.start, count: Math.min(g.count, index.length - g.start), materialIndex: g.materialIndex }))
            : [{ start: 0, count: index.length, materialIndex: src.groups && src.groups[0] ? src.groups[0].materialIndex | 0 : 0 }];
          const ap = packAttributes(src);
          const attrs = ap ? { data: ap.data, stride: ap.stride, weights: ap.weights, layout: ap.layout } : null;
          const sp = _smartPayload(src, _threeCoreUrl());
          const transfer = attrs ? [positions.buffer, index.buffer, attrs.data.buffer] : [positions.buffer, index.buffer];
          if (sp.normals) transfer.push(sp.normals.buffer);
          return { msg: { op: 'simplify', positions, index, groups, keep, tol: tolFor(p, FIRST_PASS), url: simplifierUrl, attrs, sharp: (_sharpOpts() || {}).sharp || 0, update: true, ...sp }, transfer };
        }).then(reply => (reply && reply.ok && weld) ? { parts: reply.parts, err: reply.err || 0, src: weld.src, flat: weld.flat, upd: reply.upd || null } : null));
      }
    }

    for (let i = 0; i < ids.length; i++) {
      const p = getPart(ids[i]);
      if (!p || p.deleted) continue;
      if (!p.mesh) { skipped.push(p.name + ' (instanced)'); continue; }
      const geom = p.mesh.geometry;
      if (!geom || !geom.attributes || !geom.attributes.position) { skipped.push(p.name + ' (no mesh data)'); continue; }
      const triBefore = geom.index ? geom.index.count / 3 : geom.attributes.position.count / 3;
      if (triBefore < 12) { skipped.push(p.name + ' (too few triangles)'); continue; }

      try {
        let reduced = null;
        if (queued.has(p.partId)) {
          const job = await queued.get(p.partId);
          if (p.deleted || !p.mesh) { skipped.push(p.name + ' (deleted while it was being worked out)'); continue; }      // (deleted during the wait: not reduced behind the user's back)
          if (job && p.mesh.geometry === geom) { reduced = _creaseAfter(_geomFromIndexParts(job.src, job.parts, job.upd), job.flat); if (reduced) _simpErr.set(reduced, job.err); }
        }
        if (!reduced && meshopt) reduced = _simplifyKeepingAttributes(meshopt, geom, keep, tolFor(p, FIRST_PASS));
        if (!reduced && tolMm) { skipped.push(p.name + ' (needs the simplifier, which did not load)'); continue; }
        if (reduced && tolMm) {
          // Do not take the simplifier's word for it: measure how far the new
          // surface is from the old one (vertices of each against the other
          // surface) and tighten the setting until it fits. Large parts, where
          // measuring would take a while, keep the simplifier's own figure.
          const lim = tolFor(p);
          let dev = null;
          if (meshopt && triBefore <= 400000) {
            try {
              dev = await _surfaceDeviation(geom, reduced);
              let f = FIRST_PASS, tries = 0;
              while (dev > lim && tries++ < 4) {
                f *= (lim / dev) * 0.95;
                const again = _simplifyKeepingAttributes(meshopt, geom, 0, tolFor(p, f));
                if (!again) break;
                reduced = again; dev = await _surfaceDeviation(geom, reduced);
              }
            } catch (e) { dev = null; console.warn('[decimate] could not measure the deviation:', e); }
          }
          if (dev == null) { measuredAll = false; worstErr = Math.max(worstErr, tolMm); }
          else if (dev > lim * 1.0005) { skipped.push(p.name + ' (no reduction fits within ' + tolMm + ' mm)'); continue; }
          else { worstErr = Math.max(worstErr, dev * unitsOf(p)); _simpErr.set(reduced, dev); }     // (the report's "surface deviation" now holds a measured figure)
        }
        if (!reduced) {
          // Fallback (offline, or no WebAssembly): positions only. The
          // modifier welds coincident vertices and then collapses `count`
          // of them, so the count has to be a share of the WELDED vertices.
          const welded = _mergeVertices(_stripToPositionsOnly(geom));
          const weldedCount = welded.attributes.position.count;
          const targetRemoveCount = Math.min(Math.floor(weldedCount * (1 - keep)), weldedCount - 4);
          if (targetRemoveCount < 1) { skipped.push(p.name + ' (target too low)'); continue; }
          reduced = simp.modify(welded, targetRemoveCount);
          reduced.computeVertexNormals();
          reduced = _withCarriedUvs(geom, reduced);      // (the basic simplifier works on positions only: the UVs are read back from the part as it was)
        }
        const reducedTris = reduced.index ? reduced.index.count / 3 : reduced.attributes.position.count / 3;
        if (!(reducedTris >= 1)) { skipped.push(p.name + ' (would collapse to nothing)'); continue; }
        if (reducedTris >= triBefore) { skipped.push(p.name + ' (cannot be reduced further)'); continue; }
        // The same guard as Quick remesh: a result that has lost most of its surface is tried again at gentler shares, and a part that
        // keeps its shape at none of them is left alone (it used to be taken down to a sliver at −90 %).
        if (!tolMm && meshopt) {
          const s0 = _shapeOf(geom);
          let s1 = _shapeOf(reduced), k = keep, tries = 0;
          while (!_keepsShape(s0, s1) && tries++ < 3 && k < 0.9) {
            k = Math.min(0.9, k * 1.6);
            const again = _simplifyKeepingAttributes(meshopt, geom, k, 0);
            if (!again) break;
            reduced = again; s1 = _shapeOf(reduced);
          }
          if (!_keepsShape(s0, s1)) { skipped.push(p.name + ' (would lose its shape)'); continue; }
          if (k !== keep) gentler++;
        }
        reduced.computeBoundingBox();
        reduced.computeBoundingSphere();

        // The old geometry is kept (not disposed) so undo can put it back.
        // state.geomByHash is left alone — other parts may still reference
        // the same cached geom. This part is now unique to itself.
        const before = _decSnap(p);
        p.mesh.geometry = _stampGeometry(reduced);
        // Export, merge, dedupe and the memory readout all look geometry up
        // by p.hash. Without its own entry the decimated part kept pointing
        // at the original buffer, so the reduction never reached the file.
        p.hash = 'dec_' + p.partId + '_' + (state._decSeq = (state._decSeq | 0) + 1);
        state.geomByHash.set(p.hash, reduced);

        const newTri = reduced.index ? reduced.index.count / 3 : reduced.attributes.position.count / 3;
        const newVert = reduced.attributes.position.count;
        p.triCount = newTri;
        p.vertCount = newVert;
        _refreshPartBBox(p);
        p._fp = null; p._fpKey = null;
        _addDeviation(p, reduced);
        undoItems.push({ partId: p.partId, before, after: _decSnap(p) });

        trisBefore += triBefore;
        trisAfter  += newTri;
        parts++;
      } catch (e) {
        failed.push(p.name + ' (' + (e.message || e) + ')');
      }
      if (i % 4 === 3) await _nextFrame();
    }

    if (undoItems.length) pushUndo({ type: 'decimate', label: 'Decimate', items: undoItems });

    // Refresh aggregates + UI.
    try { recomputeStats(); } catch (_) {}
    try { rebuildTree && rebuildTree(); } catch (_) {}
    try { refreshPropertiesPanel && refreshPropertiesPanel(); } catch (_) {}
    try { applySelectionColors && applySelectionColors(); } catch (_) {}
    if (state.viewMode === 'heat') {
      // Density changed — re-bucket every part.
      _exitHeatmap(); _enterHeatmap();
    }
    if (typeof requestRender === 'function') requestRender();

    const dropped = trisBefore - trisAfter;
    const pct = trisBefore > 0 ? (dropped / trisBefore * 100) : 0;
    if (typeof toast === 'function') {
      if (parts > 0) toast('Decimated', parts + (parts === 1 ? ' part' : ' parts') + ' · −' + dropped.toLocaleString() + ' tris (' + pct.toFixed(1) + '%)' + (tolMm ? (measuredAll ? ' · measured: no point moved more than ' : ' · no point should move more than ') + (worstErr < 0.001 ? '0.001' : worstErr.toPrecision(2)) + ' mm' : (_maxDeviation() > 0 ? ' · surfaces moved ' + _fmtDev(_maxDeviation()) : '')), 'success', 4000);
      if (skipped.length > 0) toast('Skipped', skipped.slice(0, 4).join(', ') + (skipped.length > 4 ? ' +' + (skipped.length-4) + ' more' : ''), 'warn', 4000);
      if (failed.length > 0) toast('Failed', failed.slice(0, 3).join(', ') + (failed.length > 3 ? ' +' + (failed.length-3) + ' more' : ''), 'error', 5000);
    }
  }

  document.getElementById('btn-decimate-sel') && document.getElementById('btn-decimate-sel').addEventListener('click', () => _decimateSelected());
  window.__moDecimateWithin = (mm) => _decimateSelected({ tolMm: mm });
  window.__moAgent = Object.assign(window.__moAgent || {}, { decimate: _Job.strict(() => _decimateSelected()) });

  // ── the preview: what Decimate would do to the selection ──
  function _decimateKeep(selTris) {
    const sel = document.getElementById('decimate-strength');
    if (sel && sel.value === 'tol') return NaN;                                // the result depends on the shape: no estimate
    if (sel && sel.value === 'target') {
      const want = parseInt((document.getElementById('decimate-target')?.value || '').replace(/[^0-9]/g, ''), 10);
      return (want > 0 && want < selTris) ? want / selTris : NaN;
    }
    const s = parseFloat(sel ? sel.value : '0.5');
    return (s > 0 && s < 1) ? 1 - s : NaN;
  }
  function _previewDecimate() {
    if (!state.selected || !state.selected.size) { toast('Decimate', 'Select parts first', 'warn', 2500); return; }
    let selTris = 0;
    const live = [];
    for (const id of state.selected) { const p = getPart(id); if (p && !p.deleted) { live.push(p); if (p.mesh) selTris += p.triCount || 0; } }
    const keep = _decimateKeep(selTris);
    if (document.getElementById('decimate-strength')?.value === 'tol') { toast('Decimate', 'How much goes depends on the shape: run it, and undo with Ctrl+Z if it is not enough', 'info', 4000); return; }
    if (!(keep > 0)) { toast('Decimate', 'Type a target below the triangle count of the selection', 'warn', 3000); return; }
    const rows = [];
    let instanced = 0, tiny = 0, from = 0, to = 0;
    for (const p of live) {
      if (!p.mesh) { instanced++; continue; }
      if ((p.triCount || 0) < 12) { tiny++; continue; }
      const after = Math.max(1, Math.floor(p.triCount * keep));
      rows.push({ name: p.name, from: p.triCount, to: after });
      from += p.triCount; to += after;
    }
    rows.sort((a, b) => (b.from - b.to) - (a.from - a.to));
    const skipped = [];
    if (instanced) skipped.push(`${fmtNum(instanced)} instanced ${instanced === 1 ? 'part' : 'parts'} (Fit to budget can reduce those)`);
    if (tiny) skipped.push(`${fmtNum(tiny)} with fewer than 12 triangles`);
    _planDialog({
      title: 'Decimate',
      summary: rows.length ? `<strong>${fmtNum(from)} → about ${fmtNum(to)} triangles</strong> across ${fmtNum(rows.length)} ${rows.length === 1 ? 'part' : 'parts'}. Every part gives up the same share.` : 'Nothing in the selection can be decimated.',
      rows, skipped,
      note: 'An estimate. Normals, UVs and vertex colours are kept, and the step is undone with Ctrl+Z.',
      okLabel: 'Decimate',
      run: () => document.getElementById('btn-decimate-sel')?.click(),
    });
  }
  document.getElementById('decimate-preview')?.addEventListener('click', _previewDecimate);

  // ── the count under the button ──
  // Keep the count badge on the Decimate button in sync with selection.
  function _updateDecCount() {
    const el = document.getElementById('dec-sel-count'), nSel = state.selected ? state.selected.size : 0;
    if (el && el._shown !== nSel) { el._shown = nSel; el.textContent = nSel; }      // (written on a change only: this runs five times a second)
    // "12,400 → about 6,200 triangles" for the current selection and setting.
    const info = document.getElementById('decimate-info');
    const sel = document.getElementById('decimate-strength');
    const tgt = document.getElementById('decimate-target');
    // Nothing below is visible while the card is closed or the tab is in the background: skip the walk over the selection. (The card is
    // asked, not the estimate's line: that line hides itself while it is empty, so asking it kept it empty for good, and the Target and
    // Within fields below never came up either.)
    const card = info && info.closest('.section-cmd');
    if (document.hidden || !card || card.hidden || !card.getClientRects().length) return;
    const showTgt = (sel && sel.value === 'target') ? '' : 'none';
    if (tgt && tgt.style.display !== showTgt) tgt.style.display = showTgt;
    const tolRow = document.getElementById('decimate-tol-row'), showTol = (sel && sel.value === 'tol') ? '' : 'none';
    if (tolRow && tolRow.style.display !== showTol) tolRow.style.display = showTol;
    if (!info || !sel) return;
    let tris = 0, n = 0;
    for (const id of (state.selected || [])) { const p = getPart(id); if (p && !p.deleted && p.mesh) { tris += p.triCount || 0; n++; } }
    let text = '', html = '';
    if (n > 0) {
      let after;
      if (sel.value === 'tol') after = null;
      else if (sel.value === 'target') {
        const want = parseInt(((tgt && tgt.value) || '').replace(/[^0-9]/g, ''), 10);
        after = want > 0 ? Math.min(want, tris) : null;
      } else after = Math.round(tris * (1 - parseFloat(sel.value)));
      text = sel.value === 'tol' ? `${fmtNum(tris)} triangles selected; as many as possible go`
        : after == null ? `${fmtNum(tris)} triangles selected` : '';
      html = (after != null && sel.value !== 'tol') ? _planFigure(tris, after, `${fmtNum(n)} ${n === 1 ? 'part' : 'parts'} selected`) : '';
    }
    // (what was last written is remembered on the element: read back, an empty text never matched, and the empty text was written
    // again five times a second while nothing was selected, a change of the page each time for the status bar to measure)
    const shown = html ? 'h:' + html : 't:' + text;
    if (info._decShown !== shown) { info._decShown = shown; if (html) info.innerHTML = html; else info.textContent = text; }
    const link = document.getElementById('decimate-preview');
    if (link) link.hidden = !(n > 0);
  }
  setInterval(_updateDecCount, 200);

  return { _decimateSelected, _decimateSelected_job };
}
