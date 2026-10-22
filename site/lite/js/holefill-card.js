// The Remove holes card: its panel (size, the Advanced options and their saved values) and the run that fills holes in the chosen parts,
// one undo step. The finding of holes is holefill.js (and emboss.js for lettering, op 'marks'); this file is the part that touches the
// scene. Moved out of app.js as it was; app.js hands in what it needs (installHoleFillCard below) and gets back the three entry points
// that Lettering and logos, Smart optimise and the Claude tools call.
import * as THREE from 'three';

// app: the objects and functions of app.js this card uses (see the call in app.js), plus loaderBusy(), true while the big loader is up.
export function installHoleFillCard(app) {
  const {
    state, Log, _Job, _Tasks, _MeshWorkers, _Brep, _polyIds, toast, getPart, fmtNum, requestRender, pushUndo, recomputeStats, rebuildTree,
    refreshPropertiesPanel, applySelectionColors, _scrubField, _nextFrame, _stampGeometry, _refreshPartBBox, _safeDispose,
    _disposeEdgesFor, _cadEdgesPartSwapped, _brepAfterFill, _geomFromIndexParts, _decSnap, _untriangulateRun, _enterHeatmap, _exitHeatmap,
    fillFlatHoles, applyHoleFill, flattenRimNormals, findSurfaceMarks, smoothRimNormals,
  } = app;

  // Closes holes in flat faces and leaves the rest of each mesh exactly as it
  // is (see holefill.js for how a hole is told apart from a boss, a bore that
  // is the part's shape, or an opening into a cavity). Works on the selection,
  // or on every visible part when nothing is selected. One undo step.
  // Remove holes shows in the status bar's Tasks list while it runs (not when it is a step of something that already has the loader up:
  // that task is listed as it is).
  async function _fillHoles() { return _Job.run('Remove holes', () => _fillHoles_job(), { task: false }); }
  async function _fillHoles_job() {
    const task = app.loaderBusy() ? () => {} : (patch) => _Tasks.set('fillholes', patch);
    try { return await _fillHolesRun(task); } finally { _Tasks.end('fillholes'); }
  }
  // `over` (optional): another card running the filler with its own settings: { maxSize, adv (merged over the card's), targets,
  // dryRun (count only, change nothing), quiet (no toast or info line; the caller says it), title (for the Tasks list) }.
  // Returns { tally, parts, undoCount }.
  async function _fillHolesRun(task, over) {
    const input = document.getElementById('fill-holes-size');
    const info = over && over.quiet ? null : document.getElementById('fill-holes-info');
    const btn = document.getElementById('btn-fill-holes');
    const label = over ? null : document.getElementById('fill-holes-label');
    const maxSize = over && over.maxSize > 0 ? over.maxSize : parseFloat(String(input ? input.value : '').replace(',', '.'));
    if (!(maxSize > 0)) { toast('Remove holes', 'Type the largest hole to fill, in mm', 'warn', 3000); input && input.focus(); return; }
    const adv = { ..._fillHoleOpts(), ...(over && over.adv ? over.adv : {}) };
    if (!adv.through && !adv.blind && !adv.open && !adv.raised) { toast('Remove holes', 'Every kind of hole is switched off under Advanced', 'warn', 3500); return; }
    if (adv.minSize >= maxSize) { toast('Remove holes', 'The smallest hole to fill is not below the largest', 'warn', 3500); return; }
    const optsFor = (scale) => ({ ...adv, maxSize: maxSize / scale, minSize: adv.minSize / scale, raisedMax: adv.raisedMax / scale, maxDepth: adv.maxDepth > 0 ? adv.maxDepth / scale : 0 });
    const picked = !!(state.selected && state.selected.size);
    const targets = (over && over.targets ? over.targets : (picked ? [...state.selected].map(id => getPart(id)) : state.parts))
      .filter(p => p && !p.deleted && (picked || p.visible !== false));
    if (!targets.length) { if (!(over && over.quiet)) toast('Remove holes', 'There is nothing to work on', 'warn', 2500); return { tally: null, parts: 0, undoCount: 0 }; }
    task({ label: (over && over.title) || 'Removing holes', detail: fmtNum(targets.length) + (targets.length === 1 ? ' part' : ' parts'), pct: 0 });
    if (btn) btn.disabled = true;

    const undoItems = [], failed = [];
    const done = new Map();                 // source geometry (+ scale) → what it became
    const tally = { holes: 0, through: 0, blind: 0, open: 0, flattened: 0, removedTris: 0, addedTris: 0, raised: 0, raisedTall: 0, partOfShape: 0, leaking: 0, tooDeep: 0, tooLarge: 0, tooSmall: 0, kind: 0, uncappable: 0, rim: 0, floating: 0, sealed: 0, enclosed: 0 };
    let parts = 0, instanced = 0, triBefore = 0;
    const wasPoly = new Set();
    const sv = new THREE.Vector3();
    let lastYield = performance.now();
    const keyOf = (p) => {
      const geom = p.mesh.geometry;
      const posAttr = geom && geom.attributes && geom.attributes.position;
      if (!posAttr || posAttr.count < 12) return null;
      p.mesh.updateWorldMatrix(true, false);
      sv.setFromMatrixScale(p.mesh.matrixWorld);
      const scale = Math.cbrt(Math.abs(sv.x * sv.y * sv.z)) || 1;       // the size limit is in world units
      return { geom, posAttr, scale, key: geom.uuid + '|' + scale.toPrecision(6) };
    };
    const plainPositions = (posAttr) => {
      if (!posAttr.isInterleavedBufferAttribute && posAttr.array instanceof Float32Array && posAttr.itemSize === 3) return posAttr.array;
      const out = new Float32Array(posAttr.count * 3);
      for (let v = 0; v < posAttr.count; v++) { out[v * 3] = posAttr.getX(v); out[v * 3 + 1] = posAttr.getY(v); out[v * 3 + 2] = posAttr.getZ(v); }
      return out;
    };
    // The finding of holes — nearly all of the work — runs in background
    // workers, one mesh each, while the page stays responsive. `found` maps a
    // mesh to its result; anything missing from it is done here instead.
    const found = new Map();
    if (_MeshWorkers.available()) {
      const jobs = [], seen = new Set();
      for (const p of targets) {
        if (!p.mesh) continue;
        const k = keyOf(p);
        if (!k || seen.has(k.key)) continue;
        seen.add(k.key); jobs.push(k);
      }
      let finished = 0;
      await Promise.all(jobs.map(j => _MeshWorkers.run(() => {
        const src = plainPositions(j.posAttr);
        const positions = src === j.posAttr.array ? src.slice() : src;      // the worker gets a copy of its own
        const index = j.geom.index ? j.geom.index.array.slice() : null;
        const cadPlane = _Brep.planePoly(j.geom), cadPoly = cadPlane ? cadPlane.slice() : null;     // (the CAD plane faces, when the part came from a STEP with them)
        const transfer = index ? [positions.buffer, index.buffer] : [positions.buffer];
        if (cadPoly) transfer.push(cadPoly.buffer);
        return { msg: { op: (over && over.op) || 'fill', positions, index, opts: { ...optsFor(j.scale), cadPoly } }, transfer };
      }).then(reply => {
        if (reply && reply.ok) found.set(j.key, reply.res);
        finished++;
        if (label && (finished % 8 === 0 || finished === jobs.length)) label.textContent = 'Filling… ' + Math.round(finished / jobs.length * 90) + '%';
        task({ pct: finished / jobs.length * 90 });
      })));
    }
    try {
      for (let i = 0; i < targets.length; i++) {
        const p = targets[i];
        if (!p.mesh) { instanced++; continue; }
        const k0 = keyOf(p);
        if (!k0) continue;
        const { geom, posAttr, scale, key } = k0;
        let hit = done.get(key);
        if (hit === undefined) {
          hit = null;
          try {
            let index = geom.index ? geom.index.array : null;
            const res = found.get(key) || ((over && over.op === 'marks') ? findSurfaceMarks : fillFlatHoles)(plainPositions(posAttr), index, { ...optsFor(scale), cadPoly: _Brep.planePoly(geom) });
            if (over && over.dryRun) hit = { out: null, res, dry: true };            // (counted below, nothing built)
            else if (res.holes > 0 || res.rimVertices > 0 || res.floating > 0 || res.enclosed > 0) {
              let src = geom;
              if (!index) {
                index = new Uint32Array(posAttr.count);
                for (let v = 0; v < index.length; v++) index[v] = v;
                src = geom.clone(); src.setIndex(new THREE.BufferAttribute(index, 1));
              }
              let kept = null;                                                  // (the CAD faces, when the part has them, go on to the new shape)
              try { kept = _brepAfterFill(geom, index, res, geom.groups, posAttr); } catch (_) { kept = null; }
              const out = _geomFromIndexParts(src, kept ? kept.parts : applyHoleFill(index, res, geom.groups));
              if (out && kept) { try { _Brep.adopt(out, kept.cad); } catch (_) {} }
              if (out) {
                // the rim of a closed hole is flat now: its vertices must shade as flat too (a mark's rim lies in a face that may curve:
                // its vertices take the mean of the face's and the cap's normals instead)
                try {
                  const nA = out.attributes.normal, pA = out.attributes.position;
                  if (nA && !nA.isInterleavedBufferAttribute && nA.array instanceof Float32Array && !pA.isInterleavedBufferAttribute && pA.array instanceof Float32Array && res.caps && res.caps.length) {
                    const sp = src.attributes.position, keys = new Set();
                    for (let i = 0; i < res.caps.length; i++) { const v = res.caps[i]; keys.add(sp.getX(v) + ',' + sp.getY(v) + ',' + sp.getZ(v)); }
                    ((over && over.op === 'marks') ? smoothRimNormals : flattenRimNormals)(pA.array, out.index.array, nA.array, keys);
                    nA.needsUpdate = true;
                  }
                } catch (_) {}
                out.computeBoundingBox(); out.computeBoundingSphere();
                const hash = 'hf_' + (state._decSeq = (state._decSeq | 0) + 1);
                state.geomByHash.set(hash, out);
                hit = { out, hash, res };
              }
            } else hit = { out: null, res };
          } catch (e) { failed.push(p.name + ' (' + (e.message || e) + ')'); }
          done.set(key, hit);
        }
        if (hit && hit.res) {
          const k = hit.res.skipped || {};
          tally.raised += k.raised || 0; tally.raisedTall += k.raisedTall || 0; tally.partOfShape += k.partOfShape || 0;
          tally.leaking += k.leaking || 0; tally.tooDeep += k.tooDeep || 0; tally.tooLarge += k.tooLarge || 0;
          tally.tooSmall += k.tooSmall || 0; tally.kind += k.kind || 0; tally.uncappable += k.uncappable || 0;
          if (hit.res.tallest > (tally.tallest || 0)) tally.tallest = hit.res.tallest;         // (the marks finder: the tallest raised mark it left, the deepest engraved one)
          if (hit.res.deepest > (tally.deepest || 0)) tally.deepest = hit.res.deepest;
          if (hit.res.lowestTall > 0 && (!tally.lowestTall || hit.res.lowestTall < tally.lowestTall)) tally.lowestTall = hit.res.lowestTall;
          if (hit.res.shallowestDeep > 0 && (!tally.shallowestDeep || hit.res.shallowestDeep < tally.shallowestDeep)) tally.shallowestDeep = hit.res.shallowestDeep;
        }
        if (hit && hit.dry && hit.res && hit.res.holes > 0) {
          parts++;
          for (const f of ['holes', 'through', 'blind', 'open', 'flattened', 'removedTris', 'addedTris']) tally[f] += hit.res[f] || 0;
        }
        if (hit && hit.out) {
          const before = _decSnap(p);
          triBefore += p.triCount || 0;
          if (_polyIds.has(p.mesh.geometry)) wasPoly.add(p.partId);       // (a part in n-gons stays in n-gons: see below)
          p.mesh.geometry = _stampGeometry(hit.out);
          p.hash = hit.hash;
          p.triCount = hit.out.index.count / 3;
          p.vertCount = hit.out.attributes.position.count;
          _refreshPartBBox(p);
          p._fp = null; p._fpKey = null;
          undoItems.push({ partId: p.partId, before, after: _decSnap(p) });
          parts++;
          for (const f of ['holes', 'through', 'blind', 'open', 'flattened', 'removedTris', 'addedTris']) tally[f] += hit.res[f] || 0;
          tally.rim += hit.res.rimVertices || 0; tally.floating += hit.res.floating || 0; tally.sealed += hit.res.sealed || 0; tally.enclosed += hit.res.enclosed || 0;
        }
        if (performance.now() - lastYield > 60) {
          if (label) label.textContent = 'Filling… ' + Math.round((i + 1) / targets.length * 100) + '%';
          task({ pct: found.size ? 90 + (i + 1) / targets.length * 10 : (i + 1) / targets.length * 100 });
          await _nextFrame();
          lastYield = performance.now();
        }
      }
    } finally {
      if (btn) btn.disabled = false;
      if (label) label.textContent = 'Remove holes';
    }

    // A closed hole leaves the flat face around it cut up for no reason: the ring of triangles that went round the hole, and the
    // vertices that only they used. Untriangulate joins the face again and triangulates its outline with the fewest triangles;
    // both go in one undo step. (The part is not marked as polygons: the view stays as it was.)
    // A part that was in n-gons stays in n-gons: its closed holes become part of the polygon around them (the cap's triangles join
    // it), whether or not the switch is on, and the part is marked as polygons again.
    if (over && over.dryRun) return { tally, parts, undoCount: 0 };          // (a count: nothing was changed)
    let tidied = 0;
    if (undoItems.length && (adv.tidy || wasPoly.size)) {
      task({ detail: 'Tidying the faces', pct: null });
      const extra = [];
      const run = async (ids, noPolys) => {
        if (!ids.length) return;
        try { await _untriangulateRun({ ids, quiet: true, collect: extra, noPolys, tolerance: adv.move }); }
        catch (e) { try { Log.info('[remove holes] tidy failed: ' + (e.message || e)); } catch (_) {} }
      };
      const all = undoItems.map(u => u.partId);
      await run(all.filter(id => wasPoly.has(id)), false);
      if (adv.tidy) await run(all.filter(id => !wasPoly.has(id)), true);
      const mids = new Set();                                         // what the fill made and the tidy then replaced: no undo step holds it
      for (const x of extra) {
        const u = undoItems.find(i => i.partId === x.partId);
        if (u) { u.after = x.after; tidied++; }
        if (x.before && x.before.geom && x.before.geom !== (u && u.before && u.before.geom)) mids.add(x.before);
      }
      if (mids.size) {
        const live = new Set();
        for (const q of state.parts) if (q.mesh && q.mesh.geometry) live.add(q.mesh.geometry);
        const freed = [];
        for (const m of mids) {
          const g = m.geom;
          if (!g || live.has(g) || freed.includes(g)) continue;
          try { if (m.hash != null && state.geomByHash.get(m.hash) === g) state.geomByHash.delete(m.hash); } catch (_) {}
          freed.push(g);
        }
        // (off the table at once; the graphics card lets go of the buffers two frames later, like everywhere else)
        if (freed.length) (async () => {
          await _nextFrame(); await _nextFrame();
          for (const g of freed) {
            try { _disposeEdgesFor(g, false); } catch (_) {}
            try { if (g.boundsTree) g.disposeBoundsTree?.(); } catch (_) {}
            try { _safeDispose(g); } catch (_) {}
          }
        })();
      }
    }
    for (const u of undoItems) { try { _cadEdgesPartSwapped(getPart(u.partId)); } catch (_) {} }
    if (undoItems.length) pushUndo({ type: 'decimate', label: (over && over.undoLabel) || 'Remove holes', items: undoItems });
    try { recomputeStats(); } catch (_) {}
    try { rebuildTree(); } catch (_) {}
    try { refreshPropertiesPanel(); } catch (_) {}
    try { applySelectionColors(); } catch (_) {}
    if (state.viewMode === 'heat') { _exitHeatmap(); _enterHeatmap(); }
    requestRender();

    const n = (k, one, many) => fmtNum(k) + ' ' + (k === 1 ? one : many);
    const left = [];
    if (tally.partOfShape) left.push(n(tally.partOfShape, 'opening that is part of a shape', 'openings that are part of a shape'));
    if (tally.raised) left.push(n(tally.raised, 'raised feature', 'raised features'));
    if (tally.raisedTall) left.push(n(tally.raisedTall, 'raised feature over ' + adv.raisedMax + ' mm high', 'raised features over ' + adv.raisedMax + ' mm high'));
    if (tally.leaking + tally.tooDeep) left.push(n(tally.leaking + tally.tooDeep, 'opening into a cavity', 'openings into a cavity'));
    if (tally.tooLarge) left.push(n(tally.tooLarge, 'opening over the size limit', 'openings over the size limit'));
    if (tally.tooSmall) left.push(n(tally.tooSmall, 'hole under ' + adv.minSize + ' mm', 'holes under ' + adv.minSize + ' mm'));
    if (tally.kind) left.push(n(tally.kind, 'hole of a kind that is switched off', 'holes of a kind that is switched off'));
    if (tally.uncappable) left.push(n(tally.uncappable, 'hole whose outline could not be closed cleanly', 'holes whose outline could not be closed cleanly'));
    // (instanced parts are passed over whether they are selected or not)
    if (instanced) left.push(n(instanced, 'instanced part (a copy of a shared shape: not filled)', 'instanced parts (copies of a shared shape: not filled)'));
    const kinds = [];
    if (tally.through) kinds.push(fmtNum(tally.through) + ' through');
    if (tally.blind) kinds.push(fmtNum(tally.blind) + ' blind');
    if (tally.flattened) kinds.push(fmtNum(tally.flattened) + ' raised');
    if (tally.open) kinds.push(fmtNum(tally.open) + ' open');
    if (tally.sealed) kinds.push(fmtNum(tally.sealed) + ' sealed from outside');
    if (tally.enclosed) kinds.push(fmtNum(tally.enclosed) + (tally.enclosed === 1 ? ' piece' : ' pieces') + ' sealed inside removed');
    if (over && over.quiet) return { tally, parts, undoCount: undoItems.length };
    const saved = tidied ? triBefore - undoItems.reduce((s, u) => s + (getPart(u.partId)?.triCount || 0), 0) : tally.removedTris - tally.addedTris;
    const summary = tally.holes
      ? n(tally.holes, 'hole', 'holes') + ' filled in ' + n(parts, 'part', 'parts') + (kinds.length ? ' (' + kinds.join(', ') + ')' : '') +
        ' · ' + (saved >= 0 ? '−' + fmtNum(saved) : '+' + fmtNum(-saved)) + ' triangles'
      : (tally.rim || tally.floating || tally.enclosed)
        ? 'No holes to close; ' + [tally.rim ? fmtNum(tally.rim) + ' leftover ' + (tally.rim === 1 ? 'vertex' : 'vertices') + ' taken out of flat faces' : '', tally.floating ? fmtNum(tally.floating) + ' loose ' + (tally.floating === 1 ? 'wall' : 'walls') + ' removed' : '', tally.enclosed ? fmtNum(tally.enclosed) + (tally.enclosed === 1 ? ' piece' : ' pieces') + ' sealed inside removed' : ''].filter(Boolean).join(' and ') + ' in ' + n(parts, 'part', 'parts') + ' · −' + fmtNum(Math.max(0, tally.removedTris - tally.addedTris)) + ' triangles'
      : 'No holes ' + (adv.minSize > 0 ? 'from ' + adv.minSize + ' to ' : 'up to ') + maxSize + ' mm in ' + (picked ? 'the selection' : 'the visible parts');
    // The panel and the toast say it short (what was done, and how many were left alone); the whole list is the hover text and the log.
    const leftN = tally.partOfShape + tally.raised + tally.raisedTall + tally.leaking + tally.tooDeep + tally.tooLarge + tally.tooSmall + tally.kind + tally.uncappable + (instanced || 0);
    const brief = tally.holes ? n(tally.holes, 'hole', 'holes') + ' filled in ' + n(parts, 'part', 'parts') + ' · ' + (saved >= 0 ? '−' + fmtNum(saved) : '+' + fmtNum(-saved)) + ' triangles' : summary;
    if (info) { info.textContent = brief + (leftN ? ' · ' + fmtNum(leftN) + ' left alone' : ''); info.title = summary + (left.length ? '. Left alone: ' + left.join(', ') + '.' : '.'); }
    toast(tally.holes ? 'Holes filled' : 'Remove holes', brief + (leftN ? ' · ' + fmtNum(leftN) + ' left alone' : ''), tally.holes || tally.rim || tally.floating || tally.enclosed ? 'success' : 'info', 4500);
    if (failed.length) toast('Failed', failed.slice(0, 3).join(', ') + (failed.length > 3 ? ' +' + (failed.length - 3) + ' more' : ''), 'error', 5000);
    try { Log.info('[remove holes] ' + summary + (left.length ? ' — left alone: ' + left.join(', ') : '')); } catch (_) {}
  }
  // Advanced options of Remove holes (the accordion in its panel). Defaults
  // reproduce what the tool did before the options existed.
  const _FH_DEF = { size: '12', min: '0', depth: '10', flat: '0.57', through: true, blind: true, open: true, shape: true, raised: true, rise: '0.5', tidy: true, seal: true, enclosed: true, move: '0.5' };
  const _fhEl = (k) => document.getElementById(k === 'size' ? 'fill-holes-size' : 'fh-' + k);
  function _fillHoleOpts() {
    const num = (k, lo, hi) => { const v = parseFloat(String(_fhEl(k)?.value ?? '').replace(',', '.')); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : parseFloat(_FH_DEF[k]); };
    const on = (k) => { const el = _fhEl(k); return el ? !!el.checked : true; };
    const flat = num('flat', 0.05, 10), shape = on('shape');
    return {
      minSize: num('min', 0, 1e6),
      depthFactor: num('depth', 1, 100),
      cosTol: Math.abs(flat - 0.57) < 1e-9 ? 0.99995 : Math.cos(flat * Math.PI / 180),
      through: on('through'), blind: on('blind'), open: on('open'), tidy: on('tidy'), rimVertices: true, cleanup: on('tidy'), floating: on('tidy'), seal: on('seal'), move: num('move', 0, 100),
      // pieces of the mesh that end up sealed inside the closed part (the balls of a valve, a pin in a bore): never visible again, so they go
      enclosed: on('enclosed'),
      // lettering and logos that stand proud of a face, up to this height (mm)
      raised: on('raised'), raisedMax: num('rise', 0.01, 1000),
      // off: an opening is filled however much of its face or its part it takes up
      maxFaceRatio: shape ? 0.4 : Infinity, maxPartRatio: shape ? 0.08 : Infinity,
    };
  }
  {
    const KEY = 'stepopt-fillholes';
    const keys = Object.keys(_FH_DEF);
    const put = (vals) => { for (const k of keys) { const el = _fhEl(k); if (!el || vals[k] === undefined) continue; if (el.type === 'checkbox') el.checked = !!vals[k]; else el.value = String(vals[k]); } };
    const take = () => { const o = {}; for (const k of keys) { const el = _fhEl(k); if (el) o[k] = el.type === 'checkbox' ? el.checked : el.value; } return o; };
    const mark = () => {              // a dot on "Advanced" while something there is not at its default
      const v = take(); let changed = false;
      for (const k of keys) if (k !== 'size' && String(v[k]) !== String(_FH_DEF[k])) changed = true;
      document.getElementById('fh-adv')?.classList.toggle('is-changed', changed);
    };
    try { const saved = JSON.parse(localStorage.getItem(KEY) || 'null'); if (saved) { if (!saved._t3) saved.tidy = true; put(saved); } } catch (_) {}      // (an earlier build saved "off" for it)
    mark();
    for (const k of keys) _fhEl(k)?.addEventListener('change', () => { try { localStorage.setItem(KEY, JSON.stringify({ ...take(), _t3: true })); } catch (_) {} mark(); });
    document.getElementById('fh-reset')?.addEventListener('click', () => { const keep = _fhEl('size')?.value; put(_FH_DEF); if (keep != null) _fhEl('size').value = keep; try { localStorage.setItem(KEY, JSON.stringify({ ...take(), _t3: true })); } catch (_) {} mark(); });
    _scrubField(_fhEl('size'),  { min: 1,    max: 2000, step: 1 });
    _scrubField(_fhEl('min'),   { min: 0,    max: 2000, step: 0.5,  decimals: 1 });
    _scrubField(_fhEl('depth'), { min: 1,    max: 100,  step: 1 });
    _scrubField(_fhEl('flat'),  { min: 0.05, max: 10,   step: 0.05, decimals: 2 });
    _scrubField(_fhEl('rise'),  { min: 0.01, max: 1000, step: 0.05, decimals: 2 });
    _scrubField(_fhEl('move'),  { min: 0,    max: 100,  step: 0.1,  decimals: 2 });
  }
  document.getElementById('btn-fill-holes')?.addEventListener('click', _fillHoles);
  window.__moAgent = Object.assign(window.__moAgent || {}, { fillHoles: _Job.strict(_fillHoles) });

  return { _fillHoles, _fillHoles_job, _fillHolesRun };
}
