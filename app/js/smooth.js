// smooth.js — Smooth surface: takes the noise and the faceting out of a surface without rounding its edges.
//
// Feature-preserving smoothing in two steps (Sun et al., "Fast and effective feature-preserving mesh denoising", 2007):
//   1. The faces' directions are filtered: each face takes the area-weighted mean of the directions of the faces round it (those
//      sharing a corner with it), each counted as (n·m − T)² when it faces within the edge angle of it (n·m > T = cos edgeDeg) and
//      not at all otherwise. A face across a sharp edge does not count, so the edge stays sharp; a face on a noisy flat counts fully.
//   2. The points are moved to fit the filtered directions: each point towards the planes of the faces round it, a few times.
// Open edges (an outline) do not move. Strength is how many times the directions are filtered. A part that knows its CAD faces
// (opts.cad) keeps the CAD edges whatever their angle: a face across one does not count, unless the two CAD faces meet tangent.
//
// Nothing here touches three.js or the page.

import { weld, pack } from './meshfix.js?v=4';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);

// opts: strength (rounds of filtering, default 6), edgeDeg (faces turning more than this are on two sides of an edge, default 30),
// moves (point updates per round, default 10), cad ({ faceOf: the CAD face of each triangle of the input, -1 for none; smooth: the
// pairs of faces [a, b] that meet tangent }). Returns positions, index and { moved (the largest a point moved), fromCad }.
export function smoothSurface(positions, index, opts = {}) {
  const P = positions;
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[i + k]); hi[k] = Math.max(hi[k], P[i + k]); }
  const size = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
  const { V, F, T: T0 } = weld(positions, index, size * 1e-7);
  if (!F.length) return { ok: false, why: 'the part has no surface' };
  const T = Math.cos((opts.edgeDeg ?? 30) * Math.PI / 180), rounds = opts.strength ?? 6, moves = opts.moves ?? 10;
  const start = V.map(p => p.slice());
  const vf = V.map(() => []); F.forEach((f, t) => { for (const v of f) vf[v].push(t); });
  // the faces round each face (sharing a corner), and the points on an outline (they stay)
  const cad = opts.cad && opts.cad.faceOf ? opts.cad : null, ekey = (a, b) => (a < b ? a + ',' + b : b + ',' + a);
  const smoothPair = new Set(((cad && cad.smooth) || []).map(([a, b]) => ekey(a, b)));
  const faceId = cad ? F.map((f, t) => { const i = cad.faceOf[T0[t]]; return i >= 0 ? i : -1; }) : null;
  // (two faces on two CAD faces are across a CAD edge, unless the CAD faces meet tangent)
  const acrossCad = (t, u) => faceId !== null && faceId[t] >= 0 && faceId[u] >= 0 && faceId[t] !== faceId[u] && !smoothPair.has(ekey(faceId[t], faceId[u]));
  const ring = F.map((f, t) => { const s = new Set(); for (const v of f) for (const u of vf[v]) if (u !== t && !acrossCad(t, u)) s.add(u); return [...s]; });
  const ecount = new Map(); for (const f of F) for (let k = 0; k < 3; k++) { const a = f[k], b = f[(k + 1) % 3], key = a < b ? a + ',' + b : b + ',' + a; ecount.set(key, (ecount.get(key) || 0) + 1); }
  const pinned = new Uint8Array(V.length); for (const [key, n] of ecount) if (n !== 2) { const [a, b] = key.split(',').map(Number); pinned[a] = pinned[b] = 1; }
  const faceNA = () => F.map(f => { const n = cross(sub(V[f[1]], V[f[0]]), sub(V[f[2]], V[f[0]])), l = len(n) || 1e-30; return { n: [n[0] / l, n[1] / l, n[2] / l], a: l / 2 }; });
  for (let r = 0; r < rounds; r++) {
    const na = faceNA();
    // 1. filter the directions
    const nf = na.map(({ n }, t) => {
      const w0 = na[t].a * (1 - T) * (1 - T);                       // (the face itself counts by the same rule as its neighbours)
      let x = n[0] * w0, y = n[1] * w0, z = n[2] * w0;
      for (const u of ring[t]) { const m = na[u].n, d = dot(n, m); if (d <= T) continue; const w = na[u].a * (d - T) * (d - T); x += m[0] * w; y += m[1] * w; z += m[2] * w; }
      const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l];
    });
    // 2. move the points onto the planes of the filtered faces round them
    for (let it = 0; it < moves; it++) {
      const c = F.map(f => [(V[f[0]][0] + V[f[1]][0] + V[f[2]][0]) / 3, (V[f[0]][1] + V[f[1]][1] + V[f[2]][1]) / 3, (V[f[0]][2] + V[f[1]][2] + V[f[2]][2]) / 3]);
      for (let v = 0; v < V.length; v++) {
        if (pinned[v] || !vf[v].length) continue;
        let dx = 0, dy = 0, dz = 0;
        for (const t of vf[v]) { const n = nf[t], s = dot(n, sub(c[t], V[v])); dx += n[0] * s; dy += n[1] * s; dz += n[2] * s; }
        const k = vf[v].length;
        V[v] = [V[v][0] + dx / k, V[v][1] + dy / k, V[v][2] + dz / k];
      }
    }
  }
  let moved = 0; for (let v = 0; v < V.length; v++) moved = Math.max(moved, len(sub(V[v], start[v])));
  return { ok: true, ...pack(V, F), moved, fromCad: !!cad };
}
