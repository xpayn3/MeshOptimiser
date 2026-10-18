// convex.js — Convex hull and Convex pieces: simple closed shells around a part, for collision shapes in games and simulation.
//
//   convexHull: the smallest convex shell round all of a part's points (an incremental hull: a tetrahedron of extreme points,
//     then every point outside it added in turn, the faces it can see replaced by a fan from it to their outline). maxPoints
//     keeps only the points that are furthest out in that many even directions, so the shell stays small enough for a game engine
//     (most want 255 points or fewer); the shell is then a little inside the true hull, never outside the part's extent.
//   convexPieces: a few convex shells that together follow a concave part (an approximate convex decomposition). The part is
//     filled as solid cells (voxel.js); a set of cells whose hull holds much more than the cells (more than `concavity` of it
//     empty) is cut in two where it is narrowest across one of its axes (its waist), and so on, up to maxPieces; each set then
//     gets its hull.
//
// Nothing here touches three.js or the page.

import { voxelSolid } from './voxel.js?v=2';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);

// Directions spread evenly over the sphere (a Fibonacci lattice).
function directions(n) {
  const out = [], g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) { const y = 1 - 2 * (i + 0.5) / n, r = Math.sqrt(1 - y * y), a = g * i; out.push([r * Math.cos(a), y, r * Math.sin(a)]); }
  return out;
}

// The hull of points ([x, y, z] each). Returns { points, faces ([a, b, c] into points, counter-clockwise seen from outside) } or null.
export function hullOf(pts, maxPoints = 0) {
  // without repeats
  const seen = new Map(); let P = [];
  for (const p of pts) { const k = p.map(x => Math.round(x * 1e6)).join(','); if (!seen.has(k)) { seen.set(k, 1); P.push(p); } }
  if (maxPoints > 0 && P.length > maxPoints) {
    const keep = new Set();
    for (const d of directions(maxPoints)) { let b = -1, bv = -Infinity; P.forEach((p, i) => { const v = dot(p, d); if (v > bv) { bv = v; b = i; } }); keep.add(b); }
    P = [...keep].map(i => P[i]);
  }
  if (P.length < 4) return null;
  let size = 0; for (const p of P) size = Math.max(size, len(sub(p, P[0])));
  const eps = size * 1e-9;
  // a first tetrahedron: two far apart, the furthest from their line, the furthest from their plane
  let a = 0, b = 0; for (let i = 0; i < P.length; i++) if (len(sub(P[i], P[a])) > len(sub(P[b], P[a]))) b = i;
  for (let i = 0; i < P.length; i++) if (len(sub(P[i], P[b])) > len(sub(P[a], P[b]))) a = i;
  let c = -1, cd = 0; for (let i = 0; i < P.length; i++) { const d = len(cross(sub(P[b], P[a]), sub(P[i], P[a]))); if (d > cd) { cd = d; c = i; } }
  if (c < 0 || cd <= eps) return null;
  const n0 = cross(sub(P[b], P[a]), sub(P[c], P[a]));
  let d = -1, dd = 0; for (let i = 0; i < P.length; i++) { const v = Math.abs(dot(n0, sub(P[i], P[a]))); if (v > dd) { dd = v; d = i; } }
  if (d < 0 || dd <= eps * len(n0)) return null;
  const faces = [];
  const mk = (x, y, z) => { const n = cross(sub(P[y], P[x]), sub(P[z], P[x])), l = len(n) || 1e-30; return { v: [x, y, z], n: [n[0] / l, n[1] / l, n[2] / l], o: dot([n[0] / l, n[1] / l, n[2] / l], P[x]), alive: true }; };
  if (dot(n0, sub(P[d], P[a])) > 0) faces.push(mk(a, c, b), mk(a, b, d), mk(b, c, d), mk(c, a, d));
  else faces.push(mk(a, b, c), mk(a, d, b), mk(b, d, c), mk(c, d, a));
  const used = new Set([a, b, c, d]);
  for (let i = 0; i < P.length; i++) {
    if (used.has(i)) continue;
    const p = P[i], vis = faces.filter(f => f.alive && dot(f.n, p) - f.o > eps);
    if (!vis.length) continue;
    // the outline of the visible faces: their edges whose other side is not visible
    const ec = new Map();
    for (const f of vis) for (let k = 0; k < 3; k++) { const x = f.v[k], y = f.v[(k + 1) % 3]; ec.set(x + ',' + y, [x, y]); }
    for (const f of vis) f.alive = false;
    for (const [key, [x, y]] of ec) if (!ec.has(y + ',' + x)) faces.push(mk(x, y, i));
    used.add(i);
  }
  const live = faces.filter(f => f.alive);
  const map = new Map(), points = [];
  const out = live.map(f => f.v.map(v => { if (!map.has(v)) { map.set(v, points.length); points.push(P[v]); } return map.get(v); }));
  return { points, faces: out };
}

const volumeOf = (h) => { let v = 0; for (const [a, b, c] of h.faces) v += dot(h.points[a], cross(h.points[b], h.points[c])); return v / 6; };

// The part's hull. opts.maxPoints (default 255; 0 = all). Returns positions, index and { points }.
export function convexHull(positions, index, opts = {}) {
  const pts = []; for (let i = 0; i < positions.length; i += 3) pts.push([positions[i], positions[i + 1], positions[i + 2]]);
  const h = hullOf(pts, opts.maxPoints ?? 255);
  if (!h) return { ok: false, why: 'the part is flat or has too few points for a hull' };
  return { ok: true, positions: new Float32Array(h.points.flat()), index: new Uint32Array(h.faces.flat()), points: h.points.length, volume: volumeOf(h) };
}

// Convex pieces. opts: maxPieces (default 8), concavity (a piece is cut while more than this share of its hull is empty; default
// 0.1), cells (the grid; default 64 along the longest side), maxPoints (per piece; default 64). Returns positions, index (all the
// shells in one mesh) and { pieces }.
export function convexPieces(positions, index, opts = {}) {
  const G = voxelSolid(positions, index, { cells: opts.cells || 64 });
  if (!G.ok) return G;
  const { NX, NY, NZ, h, gx, gy, gz, inside } = G;
  const maxPieces = opts.maxPieces ?? 8, conc = opts.concavity ?? 0.1, maxPts = opts.maxPoints ?? 64;
  const cellsAll = []; for (let i = 0; i < inside.length; i++) if (inside[i]) cellsAll.push(i);
  if (!cellsAll.length) return { ok: false, why: 'the part has no inside' };
  const ijk = (c) => { const i = c % NX, j = ((c - i) / NX) % NY, k = (c - i - j * NX) / (NX * NY); return [i, j, k]; };
  // the part's own points, by cell (a point on a cell's boundary counts for the cells round it)
  const ptsByCell = new Map();
  for (let v = 0; v < positions.length; v += 3) {
    const p = [positions[v], positions[v + 1], positions[v + 2]], fi = (p[0] - gx) / h - 0.5, fj = (p[1] - gy) / h - 0.5, fk = (p[2] - gz) / h - 0.5;
    for (const i of [Math.floor(fi), Math.ceil(fi)]) for (const j of [Math.floor(fj), Math.ceil(fj)]) for (const k of [Math.floor(fk), Math.ceil(fk)]) {
      if (i < 0 || j < 0 || k < 0 || i >= NX || j >= NY || k >= NZ) continue;
      const c = (k * NY + j) * NX + i; let l = ptsByCell.get(c); if (!l) ptsByCell.set(c, l = []); l.push(p);
    }
  }
  // a set's hull: the part's own points in its cells (they make its outside exact) and the centres of its outer cells (they close
  // it where it was cut from another piece, a half cell short of the cut)
  const hullOfCells = (cells, maxP) => {
    const set = new Set(cells), pts = [];
    for (const c of cells) {
      for (const p of ptsByCell.get(c) || []) pts.push(p);
      const [i, j, k] = ijk(c);
      const out = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].some(([a, b, e]) => !set.has(((k + e) * NY + j + b) * NX + i + a));
      if (out) pts.push([gx + (i + 0.5) * h, gy + (j + 0.5) * h, gz + (k + 0.5) * h]);
    }
    return hullOf(pts, maxP);
  };
  // split while a piece is too concave: at its narrowest waist along one of its axes
  let pieces = [cellsAll];
  while (pieces.length < maxPieces) {
    let worst = -1, wc = conc;
    pieces.forEach((cells, n) => { if (cells.length < 16) return; const hh = hullOfCells(cells, 0); if (!hh) return; const c = 1 - cells.length * h * h * h / volumeOf(hh); if (c > wc) { wc = c; worst = n; } });
    if (worst < 0) break;
    const cells = pieces[worst];
    let best = null;
    for (let ax = 0; ax < 3; ax++) {
      const pos = cells.map(c => ijk(c)[ax]), lo = Math.min(...pos), hi = Math.max(...pos);
      if (hi - lo < 3) continue;
      const count = new Array(hi - lo + 1).fill(0); for (const p of pos) count[p - lo]++;
      const mx = Math.max(...count);
      for (let s = Math.ceil((hi - lo) * 0.15); s <= Math.floor((hi - lo) * 0.85); s++) {
        const score = count[s] / mx;                            // (a waist is a slice with few cells, against the thickest)
        if (!best || score < best.score) best = { ax, at: lo + s, score };
      }
    }
    if (!best) break;
    const a = cells.filter(c => ijk(c)[best.ax] < best.at), b = cells.filter(c => ijk(c)[best.ax] >= best.at);
    if (!a.length || !b.length) break;
    pieces.splice(worst, 1, a, b);
  }
  const pos = [], idx = []; let made = 0;
  for (const cells of pieces) {
    const hh = hullOfCells(cells, maxPts); if (!hh) continue;
    const base = pos.length / 3; for (const p of hh.points) pos.push(p[0], p[1], p[2]); for (const f of hh.faces) idx.push(base + f[0], base + f[1], base + f[2]);
    made++;
  }
  return { ok: true, positions: new Float32Array(pos), index: new Uint32Array(idx), pieces: made, cell: h };
}
