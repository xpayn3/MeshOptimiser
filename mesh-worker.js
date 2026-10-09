// mesh-worker.js — heavy per-mesh work off the main thread.
//
// The app keeps a small pool of these (see _MeshWorkers in app-v2.js) and
// hands each one mesh at a time: plain typed arrays in, plain typed arrays
// out. Nothing here touches three.js or the page.
//
//   { op: 'fill',     positions, index, opts }            → what fillFlatHoles returns
//   { op: 'simplify', positions, index, groups, keep, url, attrs } → index ranges per material group,
//                                                                  and the error estimate (see simplify-core.js)
//   { op: 'simplify', …, tol } instead of keep: as far as no point moves more than `tol` (in the mesh's units)
//
//   { op: 'ngons',    positions, index, angle, poly }       → the outlines of the polygons (wirelines.js)
//   { op: 'untriangulate', positions, index, groups, angle, normals, threeUrl }
//                                                            → rebuilt triangles per material group (untriangulate.js)
//
// Every reply carries the request's id and ok: true / false.

import { fillFlatHoles } from './holefill.js?v=9';
import { reduceIndex } from './simplify-core.js?v=1';
import { analysePolygons, polygonEdges } from './wirelines.js?v=2';
import { untriangulate } from './untriangulate.js?v=1';

let simplifier = null;          // meshoptimizer's simplifier, loaded on first use
async function getSimplifier(url) {
  if (simplifier) return simplifier;
  const mod = await import(url);
  await mod.MeshoptSimplifier.ready;
  if (!mod.MeshoptSimplifier.supported) throw new Error('meshoptimizer is not supported here');
  simplifier = mod.MeshoptSimplifier;
  simplifier.useExperimentalFeatures = true;       // (simplifyWithAttributes)
  return simplifier;
}

let triangulator = null;         // three.js's polygon triangulator (earcut), loaded on first use
async function getTriangulator(url) {
  if (triangulator) return triangulator;
  const core = await import(url);
  triangulator = (contour, holes) => core.ShapeUtils.triangulateShape(
    contour.map(p => new core.Vector2(p[0], p[1])), holes.map(h => h.map(p => new core.Vector2(p[0], p[1]))));
  return triangulator;
}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.op === 'fill') {
      const res = fillFlatHoles(m.positions, m.index, m.opts);
      const out = { id: m.id, ok: true, res };
      const transfer = [];
      if (res.removed) transfer.push(res.removed.buffer, res.caps.buffer, res.capOwner.buffer);
      self.postMessage(out, transfer);
      return;
    }
    if (m.op === 'simplify') {
      const S = await getSimplifier(m.url);
      const parts = [], transfer = [];
      let err = 0;
      const byTol = m.tol > 0;
      const scale = byTol ? S.getScale(m.positions, 3) : 1;
      for (const g of m.groups) {
        const sub = m.index.subarray(g.start, g.start + g.count);
        if (byTol) {
          // The simplifier's error is relative to the mesh's extent; with no
          // triangle target it stops only when the next step would cross it.
          const [res, rel] = S.simplify(sub, m.positions, 3, 0, Math.min(1, m.tol / scale));
          const idx = res.slice();
          err = Math.max(err, rel * scale);
          parts.push({ idx, materialIndex: g.materialIndex });
          transfer.push(idx.buffer);
          continue;
        }
        const target = Math.max(3, Math.floor((sub.length / 3) * m.keep) * 3);
        let idx;
        if (sub.length <= target) idx = sub.slice();
        else {
          const r = reduceIndex(S, sub, m.positions, target, m.attrs || null);
          idx = r.idx.slice();                     // off the WASM heap, into a buffer of its own
          err = Math.max(err, r.err);
        }
        parts.push({ idx, materialIndex: g.materialIndex });
        transfer.push(idx.buffer);
      }
      self.postMessage({ id: m.id, ok: true, parts, err }, transfer);
      return;
    }
    if (m.op === 'ngons') {
      const a = analysePolygons(m.positions, m.index || null, m.angle || 1, m.poly || null);
      if (!a) { self.postMessage({ id: m.id, ok: true, none: true }); return; }
      const r = polygonEdges(a, m.positions.length / 3);
      self.postMessage({ id: m.id, ok: true, lines: r.lines, tris: r.tris, polys: r.polys }, [r.lines.buffer]);
      return;
    }
    if (m.op === 'untriangulate') {
      const triangulate = await getTriangulator(m.threeUrl);
      const parts = [], transfer = [], stats = { trisBefore: 0, trisAfter: 0, polygons: 0, joined: 0, rebuilt: 0, vertsRemoved: 0, kept: { touching: 0, curved: 0, shading: 0, other: 0 } };
      let polyBase = 0;
      for (const g of m.groups) {
        const sub = m.index.subarray(g.start, g.start + g.count);
        const r = untriangulate(m.positions, sub, { angleDeg: m.angle || 1, normals: m.normals || null, triangulate });
        if (!r) { const n = sub.length / 3; parts.push({ idx: sub.slice(), poly: Int32Array.from({ length: n }, (_, i) => polyBase + i), materialIndex: g.materialIndex }); polyBase += n; stats.trisBefore += sub.length / 3; stats.trisAfter += sub.length / 3; continue; }
        const poly = r.poly;
        for (let i = 0; i < poly.length; i++) poly[i] += polyBase;
        polyBase += r.stats.polygons;
        parts.push({ idx: r.index, poly, materialIndex: g.materialIndex });
        transfer.push(r.index.buffer, poly.buffer);
        for (const k of ['trisBefore', 'trisAfter', 'polygons', 'joined', 'rebuilt', 'vertsRemoved']) stats[k] += r.stats[k];
        for (const k in stats.kept) stats.kept[k] += r.stats.kept[k];
      }
      self.postMessage({ id: m.id, ok: true, parts, stats }, transfer);
      return;
    }
    throw new Error('unknown op ' + m.op);
  } catch (err) {
    self.postMessage({ id: m.id, ok: false, error: String((err && err.message) || err) });
  }
};
