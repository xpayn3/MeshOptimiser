// profile.js — clean a straight profile (an extrusion: a window frame, a T-slot bar, a seal strip) and build it again solid.
//
// A profile is one cross-section carried straight along an axis. Its chambers (the hollow cells inside) and its notches (the
// teeth of a clip, the slots for a seal) are holes and dents in that cross-section. This works on the cross-section, not on
// the triangles:
//
//   1. The axis. Each principal direction of the surface is tried. Along the right one every triangle is either a side (its
//      normal across the axis) or lies on one of the two end cuts, each one flat plane: square, or at an angle (a mitred frame
//      member); the longest such direction wins. A part with anything else (a hole drilled across, a step, a notch in an end)
//      is refused: it is not one profile.
//   2. The cross-section. The mesh is cut with a plane across the middle and the cut is chained into closed loops, material on
//      the left (outer loops counter-clockwise). Loops that run the other way are the chambers: they are dropped, so the
//      section is solid, and so is anything inside them.
//   3. The gaps. At every convex corner the edge that arrives there is carried on straight (and the edge that leaves it,
//      backwards); if it meets the outline again within the width, what lies between is a notch narrower than that and the
//      straight line takes its place. Tooth tops are carried across, flush; a step or an inside corner stays sharp, since
//      nothing is carried into a corner, and openings wider than the width stay. Points that hardly bend the outline go.
//   4. The rebuild. The outline is extruded again from one end cut to the other, with a flat cap on each: closed, without gaps.
//
// Everything is in the part's own coordinates. Nothing here touches three.js or the page.

import { simplifyLoop } from './revolve.js?v=8';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross2 = (ax, ay, bx, by) => ax * by - ay * bx;
const area2 = l => { let s = 0; for (let i = 0; i < l.length; i++) { const p = l[i], q = l[(i + 1) % l.length]; s += p[0] * q[1] - q[0] * p[1]; } return s / 2; };

// Eigenvectors of a symmetric 3×3 (Jacobi), as in revolve.js.
function eigenVectors(m) {
  const a = [[m[0], m[1], m[2]], [m[1], m[3], m[4]], [m[2], m[4], m[5]]], v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    if (Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]) < 1e-14 * (Math.abs(a[0][0]) + Math.abs(a[1][1]) + Math.abs(a[2][2]) + 1e-30)) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(a[p][q]) < 1e-30) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) { const x = a[k][p], y = a[k][q]; a[k][p] = c * x - s * y; a[k][q] = s * x + c * y; }
      for (let k = 0; k < 3; k++) { const x = a[p][k], y = a[q][k]; a[p][k] = c * x - s * y; a[q][k] = s * x + c * y; }
      for (let k = 0; k < 3; k++) { const x = v[k][p], y = v[k][q]; v[k][p] = c * x - s * y; v[k][q] = s * x + c * y; }
    }
  }
  const out = [0, 1, 2].map(i => norm([v[0][i], v[1][i], v[2][i]]));
  out.vals = [a[0][0], a[1][1], a[2][2]];
  return out;
}
// A direction made exact from the sides: the faces that run nearly along it (their normals within 6° of square to it) are taken, and
// the direction their normals are all square to is the axis (the least of Σ area·n·nᵀ). The spread of the surface only comes near it
// when the part is long and even: a mitred end or a notch tilted it by a degree, and a tilted cut is a different section.
function refineAxis(P, I, a0) {
  let a = a0;
  for (let pass = 0; pass < 3; pass++) {
    const M = [0, 0, 0, 0, 0, 0]; let w = 0;
    for (let t = 0; t < I.length; t += 3) {
      const A = I[t] * 3, B = I[t + 1] * 3, C = I[t + 2] * 3;
      const n = cross([P[B] - P[A], P[B + 1] - P[A + 1], P[B + 2] - P[A + 2]], [P[C] - P[A], P[C + 1] - P[A + 1], P[C + 2] - P[A + 2]]);
      const ar = Math.hypot(n[0], n[1], n[2]); if (!(ar > 0)) continue;
      const x = n[0] / ar, y = n[1] / ar, z = n[2] / ar;
      if (Math.abs(x * a[0] + y * a[1] + z * a[2]) > 0.1) continue;
      M[0] += ar * x * x; M[1] += ar * x * y; M[2] += ar * x * z; M[3] += ar * y * y; M[4] += ar * y * z; M[5] += ar * z * z; w += ar;
    }
    if (!(w > 0)) return a0;
    const e = eigenVectors(M), k = e.vals.indexOf(Math.min(...e.vals));
    let b = e[k]; if (dot(b, a) < 0) b = b.map(v => -v);
    a = snapAxis(b);
  }
  return a;
}
// a direction within half a degree of a world axis is that axis (CAD parts usually sit square)
const snapAxis = d => { for (let i = 0; i < 3; i++) if (Math.abs(d[i]) > Math.cos(0.5 * Math.PI / 180)) { const s = [0, 0, 0]; s[i] = Math.sign(d[i]); return s; } return d; };
const basis = a => { const t = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]; const e1 = norm(cross(a, t)); return [e1, cross(a, e1)]; };   // (e1 × e2 = a)

// ── 1. the axis and the two ends ────────────────────────────────────────────
// Along the right axis every triangle is a side (its normal across a) or lies on one of the two end cuts. An end may be square or
// cut at an angle (a mitred frame member), but it is one flat cut: the triangles that are not sides are split into the half nearer
// each end, and each half must lie in one plane, tilted less than 75° from square. Returns { planes: [near, far] as { n, d } with
// n·x = d and n·a > 0, inner: [where the near cut ends along a, where the far one starts] } or { why }. An end with no faces at all
// (an open tube, a surface model) is closed square.
function endPlanes(P, I, a, h0, h1, tol) {
  const groups = [[], []], len = h1 - h0;
  let side = 0, all = 0;
  for (let t = 0; t < I.length; t += 3) {
    const A = I[t] * 3, B = I[t + 1] * 3, C = I[t + 2] * 3;
    const n = cross([P[B] - P[A], P[B + 1] - P[A + 1], P[B + 2] - P[A + 2]], [P[C] - P[A], P[C + 1] - P[A + 1], P[C + 2] - P[A + 2]]);
    const ar = Math.hypot(n[0], n[1], n[2]); if (!(ar > 0)) continue;
    all += ar;
    if (Math.abs(dot(n, a)) / ar < 0.02) { side += ar; continue; }
    const hm = ((P[A] + P[B] + P[C]) * a[0] + (P[A + 1] + P[B + 1] + P[C + 1]) * a[1] + (P[A + 2] + P[B + 2] + P[C + 2]) * a[2]) / 3;
    groups[hm < h0 + len / 2 ? 0 : 1].push({ t, n, ar });
  }
  if (!(all > 0)) return { why: 'the part has no surface' };
  const planes = [], inner = [];
  for (let e = 0; e < 2; e++) {
    if (!groups[e].length) { planes.push({ n: a.slice(), d: e ? h1 : h0 }); inner.push(e ? h1 : h0); continue; }
    // the plane: the area-weighted normal (turned to point along a), through the area-weighted middle
    let N = [0, 0, 0], Q = [0, 0, 0], W = 0;
    for (const g of groups[e]) {
      const s = dot(g.n, a) >= 0 ? 1 : -1, A = I[g.t] * 3, B = I[g.t + 1] * 3, C = I[g.t + 2] * 3;
      for (let k = 0; k < 3; k++) { N[k] += s * g.n[k]; Q[k] += g.ar * (P[A + k] + P[B + k] + P[C + k]) / 3; }
      W += g.ar;
    }
    N = norm(N); Q = Q.map(v => v / W);
    if (dot(N, a) < Math.cos(75 * Math.PI / 180)) return { why: 'an end is cut at more than 75° from square' };
    const d = dot(N, Q);
    let lo = Infinity, hi = -Infinity;
    for (const g of groups[e]) for (let j = 0; j < 3; j++) {
      const v = I[g.t + j] * 3, x = [P[v], P[v + 1], P[v + 2]];
      if (Math.abs(dot(N, x) - d) > tol) return { why: 'an end is not one flat cut (a step, a notch or a hole near the end)' };
      const h = dot(x, a); lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    planes.push({ n: N, d }); inner.push(e === 0 ? hi : lo);
  }
  if (!(inner[0] < inner[1])) return { why: 'the two end cuts overlap' };
  return { planes, inner, sideShare: side / all };
}

// ── 2. the cross-section at height h ────────────────────────────────────────
// Closed loops of [x, y] (along e1, e2) with material on the left, or { why } when the cut does not close.
export function sectionLoops(P, I, a, h, eps) {
  const [e1, e2] = basis(a);
  const nv = P.length / 3, d = new Float64Array(nv), X = new Float64Array(nv), Y = new Float64Array(nv);
  for (let i = 0; i < nv; i++) {
    const p = [P[3 * i], P[3 * i + 1], P[3 * i + 2]];
    d[i] = dot(p, a) - h; X[i] = dot(p, e1); Y[i] = dot(p, e2);
  }
  const pt = (i, j) => { const t = d[i] / (d[i] - d[j]); return [X[i] + t * (X[j] - X[i]), Y[i] + t * (Y[j] - Y[i])]; };
  const segs = [];
  for (let t = 0; t < I.length; t += 3) {
    const v = [I[t], I[t + 1], I[t + 2]], s = v.map(i => d[i] >= 0);
    if (s[0] === s[1] && s[1] === s[2]) continue;
    const k = s[0] !== s[1] && s[0] !== s[2] ? 0 : s[1] !== s[0] && s[1] !== s[2] ? 1 : 2;
    const vk = v[k], vn = v[(k + 1) % 3], vp = v[(k + 2) % 3];
    let A = pt(vk, vn), B = pt(vp, vk);
    // the triangle's outward normal, seen in the plane, points to the right of A→B
    const n = cross([P[3 * vn] - P[3 * vk], P[3 * vn + 1] - P[3 * vk + 1], P[3 * vn + 2] - P[3 * vk + 2]], [P[3 * vp] - P[3 * vk], P[3 * vp + 1] - P[3 * vk + 1], P[3 * vp + 2] - P[3 * vk + 2]]);
    const nx = dot(n, e1), ny = dot(n, e2), dx = B[0] - A[0], dy = B[1] - A[1];
    if (nx * dy - ny * dx < 0) [A, B] = [B, A];
    segs.push([A, B]);
  }
  // the same place reached from two triangles is one point
  const pts = [], grid = new Map(), cell = eps * 2;
  const pid = (p) => {
    const gx = Math.floor(p[0] / cell), gy = Math.floor(p[1] / cell);
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) for (const id of grid.get((gx + ox) + ',' + (gy + oy)) || []) {
      if (Math.abs(pts[id][0] - p[0]) <= eps && Math.abs(pts[id][1] - p[1]) <= eps) return id;
    }
    const id = pts.length; pts.push(p); const g = gx + ',' + gy; if (!grid.has(g)) grid.set(g, []); grid.get(g).push(id);
    return id;
  };
  const sg = []; for (const [A, B] of segs) { const x = pid(A), y = pid(B); if (x !== y) sg.push([x, y]); }
  const from = new Map();
  sg.forEach((e, i) => { if (!from.has(e[0])) from.set(e[0], []); from.get(e[0]).push(i); });
  const used = new Uint8Array(sg.length), loops = [];
  for (let i0 = 0; i0 < sg.length; i0++) {
    if (used[i0]) continue;
    const ids = [sg[i0][0]]; let i = i0, closed = false;
    for (let guard = 0; guard <= sg.length; guard++) {
      used[i] = 1; const end = sg[i][1];
      if (end === sg[i0][0]) { closed = true; break; }
      ids.push(end);
      const nx = (from.get(end) || []).find(j => !used[j]);
      if (nx === undefined) break;
      i = nx;
    }
    if (!closed) return { why: 'the cut through the part does not close (the mesh has gaps)' };
    loops.push(clean(ids.map(id => pts[id]), eps));
  }
  return { loops: loops.filter(l => l.length >= 3 && Math.abs(area2(l)) > eps * eps), e1, e2 };
}

// Drop points closer than eps and points on a straight line.
function clean(l, eps) {
  let pts = l;
  for (let pass = 0; pass < 3; pass++) {
    const out = [];
    for (const p of pts) { const q = out[out.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > eps) out.push(p); }
    while (out.length > 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= eps) out.pop();
    pts = [];
    for (let i = 0; i < out.length; i++) {
      const a = out[(i - 1 + out.length) % out.length], b = out[i], c = out[(i + 1) % out.length];
      const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1];
      if (Math.abs(cross2(ux, uy, vx, vy)) / (Math.hypot(ux, uy) * Math.hypot(vx, vy)) < 1e-4 && ux * vx + uy * vy > 0) continue;   // straight on
      pts.push(b);
    }
  }
  return pts;
}

const inside = (p, L) => {
  let c = false;
  for (let i = 0, j = L.length - 1; i < L.length; j = i++) {
    const a = L[i], b = L[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
};

// ── 3. fill the notches narrower than W ─────────────────────────────────────
// L counter-clockwise (material on the left). Returns { loop, notches }.
export function fillNotches(L, W, eps) {
  let notches = 0;
  if (!(W > 0)) return { loop: L, notches };
  // the first edge (not one of skip1, skip2) a ray from v along d meets within W: { k, X, t }
  const hit = (L, v, d, skip1, skip2) => {
    let best = null;
    for (let k = 0; k < L.length; k++) {
      if (k === skip1 || k === skip2) continue;
      const a = L[k], b = L[(k + 1) % L.length], ex = b[0] - a[0], ey = b[1] - a[1];
      const den = cross2(d[0], d[1], ex, ey), le = Math.hypot(ex, ey);
      if (Math.abs(den) < 1e-9 * le) continue;                          // along the ray
      const wx = a[0] - v[0], wy = a[1] - v[1];
      const t = cross2(wx, wy, ex, ey) / den, u = cross2(wx, wy, d[0], d[1]) / den;
      if (t <= eps || t > W || u < -1e-9 || u > 1 + 1e-9) continue;
      if (!best || t < best.t) best = { k, t, X: [v[0] + t * d[0], v[1] + t * d[1]] };
    }
    return best;
  };
  for (let guard = 0; guard < 4 * L.length + 16; guard++) {
    const n = L.length; if (n < 4) break;
    const A0 = area2(L);
    let next = null;
    for (let i = 0; i < n && !next; i++) {
      const p = L[(i - 1 + n) % n], v = L[i], q = L[(i + 1) % n];
      const ix = v[0] - p[0], iy = v[1] - p[1], ox = q[0] - v[0], oy = q[1] - v[1], li = Math.hypot(ix, iy), lo = Math.hypot(ox, oy);
      if (!(li > 0 && lo > 0) || cross2(ix, iy, ox, oy) / (li * lo) < 1e-3) continue;      // only convex corners
      const ein = (i - 1 + n) % n, eout = i;
      // the edge that arrives, carried on: the notch is what lies between v and the edge it meets, going forward
      const f = hit(L, v, [ix / li, iy / li], ein, eout);
      if (f) {
        const cut = (f.k - i + n) % n;                                  // points i+1 … k go
        if (cut >= 1 && cut <= n - 3) {
          const cand = [v, f.X]; for (let s = f.k + 1; s < f.k + 1 + (n - cut - 1); s++) cand.push(L[s % n]);
          if (area2(cand) > A0 + eps * eps) next = cand;
        }
      }
      if (next) break;
      // the edge that leaves, carried backwards: the notch lies between the edge it meets and v, going back
      const b = hit(L, v, [-ox / lo, -oy / lo], ein, eout);
      if (b) {
        const cut = (i - b.k - 1 + n) % n;                              // points k+1 … i−1 go
        if (cut >= 1 && cut <= n - 3) {
          const cand = [b.X, v]; for (let s = i + 1; s < i + 1 + (n - cut - 1); s++) cand.push(L[s % n]);
          if (area2(cand) > A0 + eps * eps) next = cand;
        }
      }
    }
    if (!next) break;
    L = clean(next, eps); notches++;
  }
  return { loop: L, notches };
}

// ── 4. extrude ──────────────────────────────────────────────────────────────
// A cap with chambers kept: each hole (clockwise) is joined to the outline by a cut from its rightmost point straight across to a
// point of the outline it can see, so the cap is one loop again (the cut runs both ways; earcut takes it). Returns the loop's points
// as indices into `all` (outer, then the holes), so the cap shares its points with the walls.
function joinHoles(outer, holes) {
  const all = [outer, ...holes], ring = outer.map((_, k) => [0, k]);
  const P = ([l, k]) => all[l][k];
  const order = holes.map((H, h) => { let m = 0; for (let k = 1; k < H.length; k++) if (H[k][0] > H[m][0]) m = k; return { l: h + 1, m }; }).sort((x, y) => P([y.l, y.m])[0] - P([x.l, x.m])[0]);
  for (const { l, m } of order) {
    const M = P([l, m]);
    // the nearest edge of the ring to the right of M, along y = M.y
    let best = null;
    for (let i = 0; i < ring.length; i++) {
      const a = P(ring[i]), b = P(ring[(i + 1) % ring.length]);
      if ((a[1] > M[1]) === (b[1] > M[1]) && a[1] !== M[1] && b[1] !== M[1]) continue;
      if (a[1] === b[1]) continue;
      const x = a[0] + (M[1] - a[1]) / (b[1] - a[1]) * (b[0] - a[0]);
      if (x < M[0] - 1e-12) continue;
      if (!best || x < best.x) best = { x, i: a[0] > b[0] ? i : (i + 1) % ring.length };
    }
    if (!best) continue;
    // a ring point inside the triangle M, (x, M.y), candidate would block the view: the one nearest in angle is taken instead
    let pick = best.i; const C = P(ring[pick]), Ix = [best.x, M[1]];
    let ang = Infinity;
    for (let i = 0; i < ring.length; i++) {
      const p = P(ring[i]); if (i === best.i || p[0] < M[0]) continue;
      const s1 = cross2(Ix[0] - M[0], Ix[1] - M[1], p[0] - M[0], p[1] - M[1]), s2 = cross2(C[0] - Ix[0], C[1] - Ix[1], p[0] - Ix[0], p[1] - Ix[1]), s3 = cross2(M[0] - C[0], M[1] - C[1], p[0] - C[0], p[1] - C[1]);
      if (!((s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0))) continue;
      const a = Math.abs(Math.atan2(p[1] - M[1], p[0] - M[0]));
      if (a < ang) { ang = a; pick = i; }
    }
    const H = all[l], n = H.length, hole = [];
    for (let s = 0; s <= n; s++) hole.push([l, (m + s) % n]);      // round the hole and back to M
    ring.splice(pick + 1, 0, ...hole, ring[pick]);
  }
  return { all, ring };
}

// Ear clipping of one counter-clockwise loop (a loop that runs into a hole and back has two copies of the points of each cut).
function earcut(L) {
  const n = L.length, idx = [...Array(n).keys()], tris = [];
  const convex = (a, b, c) => cross2(b[0] - a[0], b[1] - a[1], c[0] - b[0], c[1] - b[1]) > 0;
  const inTri = (p, a, b, c) => cross2(b[0] - a[0], b[1] - a[1], p[0] - a[0], p[1] - a[1]) >= 0 && cross2(c[0] - b[0], c[1] - b[1], p[0] - b[0], p[1] - b[1]) >= 0 && cross2(a[0] - c[0], a[1] - c[1], p[0] - c[0], p[1] - c[1]) >= 0;
  const same = (p, q) => p[0] === q[0] && p[1] === q[1];
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n) {
    let cut = false;
    for (let k = 0; k < idx.length; k++) {
      const ia = idx[(k - 1 + idx.length) % idx.length], ib = idx[k], ic = idx[(k + 1) % idx.length], a = L[ia], b = L[ib], c = L[ic];
      if (!convex(a, b, c)) continue;
      let ear = true;
      for (const j of idx) { if (j === ia || j === ib || j === ic) continue; const p = L[j]; if (!same(p, a) && !same(p, b) && !same(p, c) && inTri(p, a, b, c)) { ear = false; break; } }
      if (!ear) continue;
      tris.push(ia, ib, ic); idx.splice(k, 1); cut = true; break;
    }
    // No ear: a loop that touches itself, or points a hair off a line. The corner that turns most to the left is clipped; a corner
    // that turns right or not at all is never made a triangle (it would face the wrong way: a black face on the cap), only dropped.
    if (!cut) {
      let bk = -1, bc = 0;
      for (let k = 0; k < idx.length; k++) { const a = L[idx[(k - 1 + idx.length) % idx.length]], b = L[idx[k]], c = L[idx[(k + 1) % idx.length]]; const cr = cross2(b[0] - a[0], b[1] - a[1], c[0] - b[0], c[1] - b[1]); if (cr > bc) { bc = cr; bk = k; } }
      if (bk >= 0) tris.push(idx[(bk - 1 + idx.length) % idx.length], idx[bk], idx[(bk + 1) % idx.length]);
      idx.splice(bk >= 0 ? bk : 0, 1);
    }
  }
  if (idx.length === 3 && convex(L[idx[0]], L[idx[1]], L[idx[2]])) tris.push(idx[0], idx[1], idx[2]);
  return tris;
}

// shapes: outlines (counter-clockwise), or { outer, holes } with the holes clockwise. h0, h1: where the ends are along a, as
// numbers (square ends) or as functions of the point (x, y) of the outline (ends cut at an angle).
export function extrudeLoops(shapes, a, e1, e2, h0, h1) {
  const pos = [], idx = [];
  const H0 = typeof h0 === 'function' ? h0 : () => h0, H1 = typeof h1 === 'function' ? h1 : () => h1;
  const P3 = (p, h) => [p[0] * e1[0] + p[1] * e2[0] + h * a[0], p[0] * e1[1] + p[1] * e2[1] + h * a[1], p[0] * e1[2] + p[1] * e2[2] + h * a[2]];
  for (const S of shapes) {
    const outer = Array.isArray(S) ? S : S.outer, holes = Array.isArray(S) ? [] : (S.holes || []);
    const at = [];                                                      // per loop: where its ring at h0 starts (its ring at h1 follows)
    for (const L of [outer, ...holes]) {
      const n = L.length, base = pos.length / 3; at.push(base);
      for (const p of L) pos.push(...P3(p, H0(p)));
      for (const p of L) pos.push(...P3(p, H1(p)));
      for (let k = 0; k < n; k++) { const k1 = (k + 1) % n; idx.push(base + k, base + k1, base + n + k1, base + k, base + n + k1, base + n + k); }   // (outward: the right of each edge)
    }
    const { all, ring } = joinHoles(outer, holes);
    const t = earcut(ring.map(([l, k]) => all[l][k]));
    const near = ([l, k]) => at[l] + k, far = ([l, k]) => at[l] + all[l].length + k;
    for (let j = 0; j < t.length; j += 3) {
      const A = ring[t[j]], B = ring[t[j + 1]], C = ring[t[j + 2]];
      idx.push(far(A), far(B), far(C));                                 // the far cap faces +a
      idx.push(near(A), near(C), near(B));                              // the near one −a
    }
  }
  return { positions: new Float32Array(pos), index: new Uint32Array(idx) };
}

// ── a bar with machining in it ──────────────────────────────────────────────
// A drilled hole, a slot or a notch cut across the profile means the part is not the same from end to end, so the strict test above
// refuses it. With opts.fillMachining the profile is looked for anyway: the axis is the direction most of the surface runs along, the
// cross-section is cut at many places along it and the fullest cut is the profile (a hole or a slot only takes material away), and
// each end is the largest flat face near that end (a notch in an end is smaller). At least 40 % of the cuts must be that same
// section: the machining may not be most of the part (a bracket, a block with a pocket are not profiles).
function sideShare(P, I, a) {
  let all = 0, side = 0;
  for (let t = 0; t < I.length; t += 3) {
    const A = I[t] * 3, B = I[t + 1] * 3, C = I[t + 2] * 3;
    const n = cross([P[B] - P[A], P[B + 1] - P[A + 1], P[B + 2] - P[A + 2]], [P[C] - P[A], P[C + 1] - P[A + 1], P[C + 2] - P[A + 2]]);
    const ar = Math.hypot(n[0], n[1], n[2]); if (!(ar > 0)) continue;
    all += ar; if (Math.abs(dot(n, a)) / ar < 0.02) side += ar;
  }
  return all > 0 ? side / all : 0;
}
function looseEnds(P, I, a, h0, h1, across) {
  const len = h1 - h0, reach = Math.min(len * 0.25, across * 4), planes = [], qd = across * 2e-4;
  for (let e = 0; e < 2; e++) {
    const buckets = new Map();
    for (let t = 0; t < I.length; t += 3) {
      const A = I[t] * 3, B = I[t + 1] * 3, C = I[t + 2] * 3;
      const n = cross([P[B] - P[A], P[B + 1] - P[A + 1], P[B + 2] - P[A + 2]], [P[C] - P[A], P[C + 1] - P[A + 1], P[C + 2] - P[A + 2]]);
      const ar = Math.hypot(n[0], n[1], n[2]); if (!(ar > 0)) continue;
      let N = n.map(v => v / ar); if (dot(N, a) < 0) N = N.map(v => -v);
      if (dot(N, a) < Math.cos(75 * Math.PI / 180)) continue;
      const hm = ((P[A] + P[B] + P[C]) * a[0] + (P[A + 1] + P[B + 1] + P[C + 1]) * a[1] + (P[A + 2] + P[B + 2] + P[C + 2]) * a[2]) / 3;
      if (e === 0 ? hm > h0 + reach : hm < h1 - reach) continue;
      const d = dot(N, [P[A], P[A + 1], P[A + 2]]);
      const key = N.map(v => Math.round(v * 200)).join(',') + '|' + Math.round(d / qd);
      const b = buckets.get(key) || { n: [0, 0, 0], d: 0, w: 0 };
      for (let k = 0; k < 3; k++) b.n[k] += N[k] * ar;
      b.d += d * ar; b.w += ar; buckets.set(key, b);
    }
    let best = null; for (const b of buckets.values()) if (!best || b.w > best.w) best = b;
    if (!best) { planes.push({ n: a.slice(), d: e ? h1 : h0 }); continue; }   // an open end: closed square
    planes.push({ n: norm(best.n), d: best.d / best.w });
  }
  return planes;
}
function findMachined(P, I, cand, size) {
  let best = null;
  for (const a of cand) {
    if (best && Math.abs(dot(a, best.a)) > 0.9999) continue;
    let h0 = Infinity, h1 = -Infinity;
    for (let i = 0; i < P.length; i += 3) { const h = P[i] * a[0] + P[i + 1] * a[1] + P[i + 2] * a[2]; if (h < h0) h0 = h; if (h > h1) h1 = h; }
    if (!(h1 - h0 > size * 1e-3)) continue;
    const share = sideShare(P, I, a);
    if (share < 0.5) continue;
    if (!best || (h1 - h0) * share > (best.h1 - best.h0) * best.share) best = { a, h0, h1, share };
  }
  if (!best) return { why: 'most of its surface does not run along one direction' };
  const { a, h0, h1 } = best, len = h1 - h0;
  const [u, w] = basis(a); let u0 = Infinity, u1 = -Infinity, w0 = Infinity, w1 = -Infinity;
  for (let i = 0; i < P.length; i += 3) { const x = P[i] * u[0] + P[i + 1] * u[1] + P[i + 2] * u[2], y = P[i] * w[0] + P[i + 1] * w[1] + P[i + 2] * w[2]; if (x < u0) u0 = x; if (x > u1) u1 = x; if (y < w0) w0 = y; if (y > w1) w1 = y; }
  const across = Math.hypot(u1 - u0, w1 - w0), eps = across * 1e-5, N = 23;
  // cuts along the bar, a hair off a round number so they meet no vertex; the fullest is the profile
  const cuts = [];
  for (let k = 1; k <= N; k++) { const s = sectionLoops(P, I, a, h0 + len * (k / (N + 1)) + len * 1.37e-4, eps); if (s.loops && s.loops.length) cuts.push({ s, net: s.loops.reduce((t, L) => t + area2(L), 0) }); }
  if (!cuts.length) return { why: 'no cut through it closes (the mesh has gaps)' };
  const ref = cuts.reduce((b, c) => (c.net > b.net ? c : b));
  const tolD = across * 2e-3;
  const same = cuts.filter(c => profileDistance(ref.s.loops, c.s.loops) <= tolD && profileDistance(c.s.loops, ref.s.loops) <= tolD).length;
  if (same < 0.4 * N) return { why: 'its cross-section changes along most of its length, so it is not a profile with a few cuts in it' };
  const planes = looseEnds(P, I, a, h0, h1, across);
  // the ends may not cross inside the bar
  const e1 = ref.s.e1, e2 = ref.s.e2, at = (q, p) => (q.d - p[0] * dot(q.n, e1) - p[1] * dot(q.n, e2)) / dot(q.n, a);
  for (const L of ref.s.loops) for (const p of L) if (!(at(planes[0], p) < at(planes[1], p))) return { why: 'its two end cuts cross' };
  return { a, h0, h1, across, ends: { planes }, sec: ref.s, machined: same < N };
}
// The farthest any point of profile B is from profile A.
function profileDistance(A, B) {
  let worst = 0;
  for (const L of B) for (const p of L) {
    let d = Infinity;
    for (const M of A) for (let k = 0; k < M.length; k++) {
      const a = M[k], b = M[(k + 1) % M.length], ex = b[0] - a[0], ey = b[1] - a[1], l2 = ex * ex + ey * ey || 1;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / l2));
      d = Math.min(d, Math.hypot(a[0] + t * ex - p[0], a[1] + t * ey - p[1]));
    }
    worst = Math.max(worst, d);
  }
  return worst;
}

// ── a bent profile ──────────────────────────────────────────────────────────
// An arched frame member, a bent tube, a curved rail: one cross-section carried along a curve. It is walked: the bar is cut square
// to where it runs, the middle of the cut is the next point of the path, and the way from one middle to the next is where it runs
// on. The walk starts at a cut through the middle of the part (turned until the cut is smallest: square to the bar) and goes both
// ways until the cut no longer is the same section (an end). Every cut is held in a frame carried along the path without twisting,
// so the cuts can be compared; the one in the middle is the profile. The ends are square (the cut at each end, moved out to the last
// of the part). The part is refused when the cuts change along it, or the path is short or hardly bends (a straight bar is
// handled by the straight case).
function shapesOf(loops) {
  // outlines (counter-clockwise) with the chambers inside them
  const outs = loops.filter(L => area2(L) > 0).map(L => ({ outer: L, holes: [], a: area2(L) }));
  for (const H of loops.filter(L => area2(L) < 0)) {
    let host = null; for (const S of outs) if (inside(H[0], S.outer) && (!host || S.a < host.a)) host = S;
    if (host) host.holes.push(H);
  }
  return outs.map(S => {
    let cx = 0, cy = 0, A = 0;
    for (const L of [S.outer, ...S.holes]) for (let i = 0; i < L.length; i++) { const p = L[i], q = L[(i + 1) % L.length], c = p[0] * q[1] - q[0] * p[1]; A += c; cx += (p[0] + q[0]) * c; cy += (p[1] + q[1]) * c; }
    return { ...S, net: A / 2, cx: cx / (3 * A), cy: cy / (3 * A) };
  });
}
// the cut through the plane at c square to t: the piece (outline and chambers) whose middle is nearest c, in 3D and in the plane
function cutAt(P, I, c, t, eps) {
  const h = dot(c, t), s = sectionLoops(P, I, t, h, eps);
  if (!s.loops || !s.loops.length) return null;
  let best = null;
  for (const S of shapesOf(s.loops)) {
    if (!(S.net > 0)) continue;
    const m = [S.cx * s.e1[0] + S.cy * s.e2[0] + h * t[0], S.cx * s.e1[1] + S.cy * s.e2[1] + h * t[1], S.cx * s.e1[2] + S.cy * s.e2[2] + h * t[2]];
    const d = Math.hypot(m[0] - c[0], m[1] - c[1], m[2] - c[2]);
    if (!best || d < best.d) best = { d, S, m, e1: s.e1, e2: s.e2, h };
  }
  return best;
}
// turn the cut at c about two directions square to t until it is smallest (square to the bar)
function squareUp(P, I, c, t, eps) {
  let cut = cutAt(P, I, c, t, eps); if (!cut) return null;
  for (let step = 4 * Math.PI / 180; step > 0.1 * Math.PI / 180; step /= 2) {
    for (let tries = 0; tries < 6; tries++) {
      const [u, w] = basis(t); let moved = false;
      for (const ax of [u, w]) for (const sg of [1, -1]) {
        const t2 = norm([t[0] + sg * Math.tan(step) * ax[0], t[1] + sg * Math.tan(step) * ax[1], t[2] + sg * Math.tan(step) * ax[2]]);
        const c2 = cutAt(P, I, cut.m, t2, eps);
        if (c2 && c2.S.net < cut.S.net * (1 - 1e-6) && c2.d < Math.sqrt(Math.abs(cut.S.net))) { t = t2; cut = c2; moved = true; }
      }
      if (!moved) break;
    }
  }
  return { t, cut };
}
// the points of a cut in the carried frame (o: the path point, f1, f2: the frame there)
const toFrame = (cut, o, f1, f2) => [cut.S.outer, ...cut.S.holes].map(L => L.map(p => {
  const q = [0, 1, 2].map(k => p[0] * cut.e1[k] + p[1] * cut.e2[k] + cut.h * cut.n[k] - o[k]);
  return [dot(q, f1), dot(q, f2)];
}));
function findCurved(P, I, opts, m, axis0, across0) {
  const eps = across0 * 1e-5;
  const sq = squareUp(P, I, m, axis0, eps);
  if (!sq) return { why: 'no cut through its middle closes' };
  let { t, cut } = sq; cut.n = t;
  const A0 = cut.S.net, size0 = Math.sqrt(A0);
  // the section's size across: the box of the first cut
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const p of cut.S.outer) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  const across = Math.hypot(x1 - x0, y1 - y0), ds = Math.max(across * 0.35, 1e-9), tolA = 0.02;
  // walk one way: returns [{ c (the middle), t, cut }] beyond the start. Near an end the steps are halved, down to a sixteenth, so
  // the path follows the curve to close to the end (the rest is closed straight)
  const walk = (dir) => {
    const out = []; let c = cut.m, tt = t.map(v => v * dir), guard = 0, step = ds;
    while (guard++ < 4000) {
      const pc = [c[0] + step * tt[0], c[1] + step * tt[1], c[2] + step * tt[2]];
      let k = cutAt(P, I, pc, tt, eps);
      if (!k || k.d > across * 0.5 || Math.abs(k.S.net - A0) > tolA * A0) { if (step > ds / 16) { step /= 2; continue; } break; }
      // the way on: from the last middle to this one; cut again square to it
      const t2 = norm([k.m[0] - c[0], k.m[1] - c[1], k.m[2] - c[2]]), k2 = cutAt(P, I, k.m, t2, eps);
      if (k2 && Math.abs(k2.S.net - A0) <= tolA * A0 && k2.d < across * 0.5) { k = k2; tt = t2; }
      if (dot(tt, t2) < Math.cos(30 * Math.PI / 180)) { if (step > ds / 16) { step /= 2; continue; } break; }   // (a turn too sharp for the step: an end, or a corner)
      k.n = tt.map(v => v * dir);
      out.push({ c: k.m, t: tt.map(v => v * dir), cut: k }); c = k.m;
    }
    return out;
  };
  const back = walk(-1).reverse(), fwd = walk(1);
  const stations = [...back, { c: cut.m, t, cut }, ...fwd];
  if (stations.length < 5) return { why: 'it is not a bent profile either: no section carries on along it' };
  // the ends: square to the path, moved out to the last of the part beyond the end cuts (within the section's reach of the path)
  const endOut = (s, dir) => {
    let far = 0; const td = s.t.map(v => v * dir);
    for (let i = 0; i < P.length; i += 3) {
      const q = [P[i] - s.c[0], P[i + 1] - s.c[1], P[i + 2] - s.c[2]], along = dot(q, td);
      if (along <= 0 || along > ds * 3) continue;
      const off = Math.hypot(q[0] - along * td[0], q[1] - along * td[1], q[2] - along * td[2]);
      if (off <= across) far = Math.max(far, along);       // (along: at most a step of the walk, which ended within one)
    }
    return [s.c[0] + far * td[0], s.c[1] + far * td[1], s.c[2] + far * td[2]];
  };
  const first = stations[0], last = stations[stations.length - 1];
  const path = [endOut(first, -1), ...stations.map(s => s.c), endOut(last, 1)];
  const tans = [first.t, ...stations.map(s => s.t), last.t];
  // how much it bends: a bar that hardly does is a straight one (with something on it that the straight case refused)
  let turn = 0; for (let i = 1; i < tans.length; i++) turn += Math.acos(Math.max(-1, Math.min(1, dot(tans[i - 1], tans[i]))));
  if (turn < 5 * Math.PI / 180) return { why: 'it hardly bends, and is not the same along its length' };
  // the frame carried along without twist (each step turned by the least that takes one tangent to the next)
  const mid = stations.indexOf(stations.find(s => s.cut === cut));
  const F = new Array(path.length);
  { const [b1] = basis(tans[mid + 1]); F[mid + 1] = [b1, cross(tans[mid + 1], b1)]; }
  const carry = (f, tNew) => { let e1 = [f[0][0] - dot(f[0], tNew) * tNew[0], f[0][1] - dot(f[0], tNew) * tNew[1], f[0][2] - dot(f[0], tNew) * tNew[2]]; e1 = norm(e1); return [e1, cross(tNew, e1)]; };
  for (let i = mid + 2; i < path.length; i++) F[i] = carry(F[i - 1], tans[i]);
  for (let i = mid; i >= 0; i--) F[i] = carry(F[i + 1], tans[i]);
  // every cut in its frame; the one in the middle is the profile, and the others must be the same
  const local = stations.map((s, i) => toFrame(s.cut, path[i + 1], F[i + 1][0], F[i + 1][1]));
  const ref = local[mid], tolD = across * 5e-3;
  let differ = 0; for (const L of local) if (profileDistance(ref, L) > tolD || profileDistance(L, ref) > tolD) differ++;
  if (differ > stations.length * 0.1) return { why: 'its cross-section changes along the curve' };
  let len = 0; for (let i = 1; i < path.length; i++) len += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1], path[i][2] - path[i - 1][2]);
  return { curved: true, path, frames: F, loops: ref, across, length: len, turnDeg: turn * 180 / Math.PI };
}
// a section (outlines counter-clockwise, chambers clockwise, in the carried frame) along an open path, a cap at each end
export function sweepOpen(shapes, path, frames) {
  const pos = [], idx = [], N = path.length;
  for (const S of shapes) {
    const at = [];
    for (const L of [S.outer, ...(S.holes || [])]) {
      const n = L.length, base = pos.length / 3; at.push(base);
      for (let i = 0; i < N; i++) for (const p of L) { const [f1, f2] = frames[i], o = path[i]; pos.push(o[0] + p[0] * f1[0] + p[1] * f2[0], o[1] + p[0] * f1[1] + p[1] * f2[1], o[2] + p[0] * f1[2] + p[1] * f2[2]); }
      for (let i = 0; i + 1 < N; i++) for (let k = 0; k < n; k++) {
        const k1 = (k + 1) % n, a = base + i * n + k, b = base + i * n + k1, c = base + (i + 1) * n + k1, d = base + (i + 1) * n + k;
        idx.push(a, b, c, a, c, d);                                      // (outward: the right of each edge, as extrudeLoops)
      }
    }
    const loops = [S.outer, ...(S.holes || [])], { all, ring } = joinHoles(S.outer, S.holes || []);
    const t = earcut(ring.map(([l, k]) => all[l][k]));
    const v = (end, [l, k]) => at[l] + end * loops[l].length + k;
    for (let j = 0; j < t.length; j += 3) {
      const A = ring[t[j]], B = ring[t[j + 1]], C = ring[t[j + 2]];
      idx.push(v(N - 1, A), v(N - 1, B), v(N - 1, C));                  // the far cap faces along the path
      idx.push(v(0, A), v(0, C), v(0, B));                              // the near one back
    }
  }
  return { positions: new Float32Array(pos), index: new Uint32Array(idx) };
}

// ── the whole job ───────────────────────────────────────────────────────────
// opts.width: notches narrower than this are filled, as a share of the cross-section's size (default 0.04; 0 = none);
// opts.widthAbs: the same in the part's units (wins over width). opts.keepChambers: the chambers stay (only the outline is cleaned).
// opts.simplifyAbs: points that bend the outline less than this go (part units; default 0.02 % of the cross-section).
// opts.fillMachining: a bar with holes, slots or notches cut across it is taken too, and they are filled (see findMachined).
// opts.shapes: build from this section instead ([{ outer, holes }] in the section's own (x, y), as shapesAfter gives it: a section
// edited by hand); width, chambers and straightening are then not applied. opts.tolerance: how far an end may be from flat.
// opts.dryRun: find and measure only.
// Returns { ok, why?, axis, axisName, length, chambers (filled), chambersFound, notches, machined, width, sectionSize, endAngles,
// mitred, profileBefore, profileAfter (loops), shapesAfter ([{ outer, holes }]), positions, index }.
export function cleanProfile(positions, index, opts = {}) {
  const P = positions, I = index || Uint32Array.from({ length: P.length / 3 }, (_, i) => i);
  if (!P || P.length < 9 || I.length < 3) return { ok: false, why: 'the part has no surface' };
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[i + k]); hi[k] = Math.max(hi[k], P[i + k]); }
  const size = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  if (!(size > 0)) return { ok: false, why: 'the part has no size' };
  // (tolerances go by the size across the profile, found once the axis is: by the whole size, a profile 15 m long merged points
  // 0.15 mm apart in its cross-section, and thin walls and hairline gaps ran into each other)
  // the surface's spread: its principal directions are the candidates, and the world axes too
  let A = 0; const m = [0, 0, 0], C = [0, 0, 0, 0, 0, 0], cen = [], ars = [];
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ar = Math.hypot(...cross([P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]])) / 2;
    const ce = [0, 1, 2].map(k => (P[a + k] + P[b + k] + P[c + k]) / 3);
    cen.push(ce); ars.push(ar); A += ar; for (let k = 0; k < 3; k++) m[k] += ar * ce[k];
  }
  if (!(A > 0)) return { ok: false, why: 'the part has no surface' };
  for (let k = 0; k < 3; k++) m[k] /= A;
  cen.forEach((ce, i) => { const x = ce[0] - m[0], y = ce[1] - m[1], z = ce[2] - m[2], w = ars[i] / A; C[0] += w * x * x; C[1] += w * x * y; C[2] += w * x * z; C[3] += w * y * y; C[4] += w * y * z; C[5] += w * z * z; });
  const cand = eigenVectors(C).map(a => refineAxis(P, I, snapAxis(a))).concat([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
  let best = null;
  for (const a of cand) {
    if (best && best.a && Math.abs(dot(a, best.a)) > 0.9999) continue;
    let h0 = Infinity, h1 = -Infinity;
    for (let i = 0; i < P.length; i += 3) { const h = P[i] * a[0] + P[i + 1] * a[1] + P[i + 2] * a[2]; if (h < h0) h0 = h; if (h > h1) h1 = h; }
    if (!(h1 - h0 > size * 1e-3)) continue;
    const [u, w] = basis(a); let u0 = Infinity, u1 = -Infinity, w0 = Infinity, w1 = -Infinity;
    for (let i = 0; i < P.length; i += 3) { const x = P[i] * u[0] + P[i + 1] * u[1] + P[i + 2] * u[2], y = P[i] * w[0] + P[i + 1] * w[1] + P[i + 2] * w[2]; if (x < u0) u0 = x; if (x > u1) u1 = x; if (y < w0) w0 = y; if (y > w1) w1 = y; }
    const across = Math.hypot(u1 - u0, w1 - w0);
    const ends = endPlanes(P, I, a, h0, h1, opts.tolerance ?? across * 1e-4);
    if (!ends.planes) { if (!best || (!best.ends && h1 - h0 > best.len)) best = { why: ends.why, len: h1 - h0 }; continue; }
    if (!best || !best.ends || h1 - h0 > best.h1 - best.h0) best = { a, h0, h1, ends, across };
  }
  let found = null;
  if (best && best.ends) {
    const { a, h0, h1, ends } = best, eps = best.across * 1e-5;
    // the cut, between the two end cuts, a little off the middle so it meets no vertex
    const mid = (ends.inner[0] + ends.inner[1]) / 2 + (ends.inner[1] - ends.inner[0]) * 1.37e-4;
    const sec = sectionLoops(P, I, a, mid, eps);
    if (sec.loops && sec.loops.length) found = { a, h0, h1, ends, sec, machined: false };
    else if (!opts.fillMachining) return { ok: false, why: sec.why || 'the cut through the part is empty' };
  }
  if (!found && opts.fillMachining) {
    const f = findMachined(P, I, cand, size);
    if (!f.a) return { ok: false, why: 'it is not a straight profile: ' + f.why };
    found = f;
  }
  let whyStraight = (best && best.why) || 'something on it is not the same from end to end';
  if (!found && opts.curved !== false) {
    // not straight: perhaps bent (the walk starts square to the longest spread of the surface, through its middle)
    const ev = eigenVectors(C), big = ev[ev.vals.indexOf(Math.max(...ev.vals))];
    const f = findCurved(P, I, opts, m, big, size);
    if (f.curved) found = { curved: true, sec: { loops: f.loops }, path: f.path, frames: f.frames, length: f.length, turnDeg: f.turnDeg, machined: false };
    else whyStraight += '; ' + f.why;
  }
  if (!found) return { ok: false, why: 'it is not a profile: ' + whyStraight };
  const { a, h0, h1, ends, sec } = found, len = found.curved ? found.length : h1 - h0;
  // outer loops (counter-clockwise, not inside another one): the rest are chambers, or what sits in them
  const outer = sec.loops.filter(L => area2(L) > 0).filter((L, _, all) => !all.some(M => M !== L && Math.abs(area2(M)) > Math.abs(area2(L)) && inside(L[0], M)));
  if (!outer.length) return { ok: false, why: 'the cross-section has no outside (the faces may point inwards)' };
  const chambersFound = sec.loops.filter(L => area2(L) < 0).length, keep = !!opts.keepChambers;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const L of outer) for (const p of L) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  const secSize = Math.hypot(x1 - x0, y1 - y0);
  const W = opts.widthAbs >= 0 ? opts.widthAbs : (opts.width ?? 0.04) * secSize;
  const tol = opts.simplifyAbs >= 0 ? opts.simplifyAbs : secSize * 2e-4;
  let notches = 0, kept;
  const given = !!(opts.shapes && opts.shapes.length);
  if (given) {
    // a section given (edited by hand): taken as it is, each outline counter-clockwise and each chamber clockwise
    const turn = (L, ccw) => { const c = L.map(p => [p[0], p[1]]); return (area2(c) > 0) === ccw ? c : c.reverse(); };
    kept = opts.shapes.map(S => ({ outer: turn(S.outer, true), holes: (S.holes || []).filter(H => H.length >= 3).map(H => turn(H, false)) })).filter(S => S.outer.length >= 3);
    if (!kept.length) return { ok: false, why: 'the section given has no outline' };
  } else {
    // with the chambers kept every outline is a shape of its own (a core inside a chamber too), and each chamber goes with the
    // smallest outline round it
    const outs = keep ? sec.loops.filter(L => area2(L) > 0) : outer;
    const shapes = outs.map(L => ({ src: L, outer: L, holes: [] }));
    if (keep) for (const H of sec.loops.filter(L => area2(L) < 0)) {
      let host = null;
      for (const S of shapes) if (inside(H[0], S.src) && (!host || Math.abs(area2(S.src)) < Math.abs(area2(host.src)))) host = S;
      if (host) host.holes.push(H);
    }
    for (const S of shapes) {
      const f = fillNotches(S.outer, W, secSize * 1e-6); notches += f.notches;
      S.outer = tol > 0 ? simplifyLoop(f.loop, tol) : f.loop;
      S.holes = S.holes.map(H => (tol > 0 ? simplifyLoop(H, tol) : H)).filter(H => H.length >= 3);
    }
    kept = shapes.filter(S => S.outer.length >= 3).map(S => ({ outer: S.outer, holes: S.holes }));
  }
  // each end: along a, where its plane is at the point (x, y) of the section (a bent profile: square to its path)
  const endAt = ({ n, d }) => (p) => (d - p[0] * dot(n, sec.e1) - p[1] * dot(n, sec.e2)) / dot(n, a);
  const square = found.curved || ends.planes.every(q => dot(q.n, a) > 1 - 1e-9);
  const angles = found.curved ? [0, 0] : ends.planes.map(q => Math.round(Math.acos(Math.min(1, dot(q.n, a))) * 180 / Math.PI * 10) / 10);
  const axisName = found.curved ? null : Math.abs(a[0]) === 1 ? 'X' : Math.abs(a[1]) === 1 ? 'Y' : Math.abs(a[2]) === 1 ? 'Z' : null;
  const res = { ok: true, curved: !!found.curved, pathSegments: found.curved ? found.path.length - 1 : 1, turnDeg: found.curved ? Math.round(found.turnDeg) : 0, axis: found.curved ? null : a, axisName, length: len, chambers: keep || given ? 0 : chambersFound, chambersFound, notches, machined: !!found.machined, width: W, sectionSize: secSize,
    endAngles: angles, mitred: !square, profileBefore: sec.loops, profileAfter: kept.flatMap(S => [S.outer, ...S.holes]), shapesAfter: kept, edited: given, before: { triangles: I.length / 3 } };
  if (opts.dryRun) return res;
  const g = found.curved ? sweepOpen(kept, found.path, found.frames) : extrudeLoops(kept, a, sec.e1, sec.e2, endAt(ends.planes[0]), endAt(ends.planes[1]));
  return { ...res, after: { triangles: g.index.length / 3 }, positions: g.positions, index: g.index };
}
