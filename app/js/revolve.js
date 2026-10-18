// revolve.js — fill the grooves of a round part (a body of revolution) and build it again clean.
//
// A turned part — a spool, a bushing, a pulley, a grommet — is one profile spun around an axis. Its ridges
// and grooves are dents in that profile. This works on the profile, not on the triangles:
//
//   1. The axis. The part's surface is weighed by area; a round part has two equal moments and the third
//      is the axis. Each of the three principal directions is tried, and the one around which the part
//      is roundest wins (cross-sections at several angles that agree). A part that is round around none
//      of them is refused: anything off the axis (bolt holes in a flange, a flat, a key way) would be lost.
//   2. The profile. The mesh is cut with a half-plane through the axis, close to a column of vertices so
//      the radii are the real ones, and the cut is chained into closed loops in (h, r): h along the axis,
//      r away from it. Material is on the left of every loop.
//   3. The grooves. At every convex corner of the profile the edge that arrives there is carried on
//      straight; if it meets the profile again within the width limit, what lies between is a dent narrower
//      than the limit, and the straight line takes its place (the same with the edge that leaves, carried
//      backwards). Ridge tops are carried across the grooves, flush; a step or a wall stays sharp, since
//      nothing is carried into a corner, and wide recesses (a channel, a counterbore, the bore) stay.
//      A point that hardly bends the new profile (a hair-thin step, a wall left a few hundredths proud) is
//      dropped (simplifyLoop), so no ring of edges is left that does nothing.
//   4. The rebuild. The new profile is spun around the axis with the part's own number of segments, at
//      the same angle as its vertices: one ring of quads per profile edge, normals smooth around the
//      axis and hard at the profile's corners. Closed, without gaps.
//
// Everything is in the part's own coordinates. Nothing here touches three.js or the page.

const TAU = Math.PI * 2;

// ── small vector helpers ────────────────────────────────────────────────────
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// Eigenvectors of a symmetric 3×3 (Jacobi). Returns [{ val, vec }] sorted by value.
function eigen3(m) {
  const a = [[m[0], m[1], m[2]], [m[1], m[3], m[4]], [m[2], m[4], m[5]]];
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
    if (off < 1e-14 * (Math.abs(a[0][0]) + Math.abs(a[1][1]) + Math.abs(a[2][2]) + 1e-30)) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(a[p][q]) < 1e-30) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
      for (let k = 0; k < 3; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < 3; k++) { const vkp = v[k][p], vkq = v[k][q]; v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq; }
    }
  }
  return [0, 1, 2].map(i => ({ val: a[i][i], vec: norm([v[0][i], v[1][i], v[2][i]]) })).sort((x, y) => x.val - y.val);
}

// Snap a direction to a world axis when it is within a hair of one (CAD parts usually sit square).
function snapAxis(d) {
  for (let i = 0; i < 3; i++) if (Math.abs(d[i]) > Math.cos(0.5 * Math.PI / 180)) { const s = [0, 0, 0]; s[i] = Math.sign(d[i]); return s; }
  return d;
}

function basis(a) {
  const t = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e1 = norm(cross(a, t)), e2 = cross(a, e1);
  return [e1, e2];
}

// ── 1. surface moments ──────────────────────────────────────────────────────
function moments(P, I) {
  let A = 0; const m = [0, 0, 0];
  const tris = I.length / 3, cen = new Float64Array(tris * 3), area = new Float64Array(tris);
  for (let t = 0; t < tris; t++) {
    const a = I[3 * t] * 3, b = I[3 * t + 1] * 3, c = I[3 * t + 2] * 3;
    const u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], w = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
    const ar = Math.hypot(...cross(u, w)) / 2; area[t] = ar; A += ar;
    for (let k = 0; k < 3; k++) { cen[3 * t + k] = (P[a + k] + P[b + k] + P[c + k]) / 3; m[k] += ar * cen[3 * t + k]; }
  }
  if (!(A > 0)) return null;
  for (let k = 0; k < 3; k++) m[k] /= A;
  const C = [0, 0, 0, 0, 0, 0];
  for (let t = 0; t < tris; t++) {
    const x = cen[3 * t] - m[0], y = cen[3 * t + 1] - m[1], z = cen[3 * t + 2] - m[2], ar = area[t];
    C[0] += ar * x * x; C[1] += ar * x * y; C[2] += ar * x * z; C[3] += ar * y * y; C[4] += ar * y * z; C[5] += ar * z * z;
  }
  return { center: m, cov: C.map(v => v / A), area: A };
}

// ── 2. the profile: cut with the half-plane at angle th ─────────────────────
// Returns closed loops of [h, r] with material on the left (outer loops counter-clockwise), or null.
function slice(P, I, c, a, th, eps) {
  const [e1, e2] = basis(a);
  const u = [Math.cos(th) * e1[0] + Math.sin(th) * e2[0], Math.cos(th) * e1[1] + Math.sin(th) * e2[1], Math.cos(th) * e1[2] + Math.sin(th) * e2[2]];
  const w = cross(a, u);               // the plane's normal
  const nv = P.length / 3, d = new Float64Array(nv), H = new Float64Array(nv), R = new Float64Array(nv);
  for (let i = 0; i < nv; i++) {
    const p = [P[3 * i] - c[0], P[3 * i + 1] - c[1], P[3 * i + 2] - c[2]];
    d[i] = dot(p, w); H[i] = dot(p, a); R[i] = dot(p, u);
  }
  // A point on edge (i, j), the same whichever triangle asks (endpoints in a fixed order).
  const pt = (i, j) => {
    const lo = (P[3 * i] < P[3 * j] || (P[3 * i] === P[3 * j] && (P[3 * i + 1] < P[3 * j + 1] || (P[3 * i + 1] === P[3 * j + 1] && P[3 * i + 2] <= P[3 * j + 2])))) ? [i, j] : [j, i];
    const [x, y] = lo, t = d[x] / (d[x] - d[y]);
    return [H[x] + t * (H[y] - H[x]), R[x] + t * (R[y] - R[x])];
  };
  const segs = [];
  for (let t = 0; t < I.length; t += 3) {
    const v = [I[t], I[t + 1], I[t + 2]], s = v.map(i => d[i] >= 0);
    if (s[0] === s[1] && s[1] === s[2]) continue;
    // The lone vertex k; the cut runs between its two edges. Orientation: material on the left in (h, r).
    let k = s[0] !== s[1] && s[0] !== s[2] ? 0 : s[1] !== s[0] && s[1] !== s[2] ? 1 : 2;
    const vk = v[k], vn = v[(k + 1) % 3], vp = v[(k + 2) % 3];
    let A = pt(vk, vn), B = pt(vp, vk);
    if (A[1] < 0 && B[1] < 0) continue;                // the other half
    // The triangle's outward normal, seen in the plane, must point to the right of A→B.
    const n = cross(sub([P[3 * vn], P[3 * vn + 1], P[3 * vn + 2]], [P[3 * vk], P[3 * vk + 1], P[3 * vk + 2]]), sub([P[3 * vp], P[3 * vp + 1], P[3 * vp + 2]], [P[3 * vk], P[3 * vk + 1], P[3 * vk + 2]]));
    const nh = dot(n, a), nr = dot(n, u), dh = B[0] - A[0], dr = B[1] - A[1];
    if (nh * dr - nr * dh < 0) [A, B] = [B, A];        // right of (dh, dr) is (dr, -dh)
    // A piece that crosses the axis (the end face of a solid part, cut through its middle) ends on the axis: what lies beyond it
    // belongs to the other half-plane. (Without this the chain ends below the axis and the part is taken for one with gaps.)
    if (A[1] < 0 || B[1] < 0) { const t = A[1] / (A[1] - B[1]), X = [A[0] + t * (B[0] - A[0]), 0]; if (A[1] < 0) A = X; else B = X; }
    segs.push([A, B]);
  }
  // Points within eps of each other are one point (the same place reached from two triangles, or the ends of a sliver of a piece
  // next to a vertex the plane runs just past), and the pieces are chained by those points; a piece whose two ends became one
  // point is no piece. (Rounding to a grid instead put two points a hair apart into different cells, and the chain broke there.)
  const pts = [], grid = new Map(), cell = eps * 2;
  const pid = (p) => {
    const gx = Math.floor(p[0] / cell), gy = Math.floor(p[1] / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const id of grid.get((gx + dx) + ',' + (gy + dy)) || []) {
      if (Math.abs(pts[id][0] - p[0]) <= eps && Math.abs(pts[id][1] - p[1]) <= eps) return id;
    }
    const id = pts.length; pts.push(p); const k = gx + ',' + gy; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(id);
    return id;
  };
  const sg = []; for (const [A, B] of segs) { const x = pid(A), y = pid(B); if (x !== y) sg.push([x, y]); }
  const from = new Map();
  sg.forEach((e, i) => { if (!from.has(e[0])) from.set(e[0], []); from.get(e[0]).push(i); });
  const used = new Uint8Array(sg.length), loops = [], open = [];
  // chains that end on the axis are walked from their start (a point no piece runs into), so they are not cut into pieces; the
  // closed loops after that, from anywhere
  const into = new Uint32Array(pts.length); for (const e of sg) into[e[1]]++;
  const order = [...sg.keys()].sort((x, y) => (into[sg[x][0]] === 0 ? 0 : 1) - (into[sg[y][0]] === 0 ? 0 : 1));
  for (const i0 of order) {
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
    (closed ? loops : open).push(ids.map(id => pts[id]));
  }
  // Chains that end on the axis (a solid part has no bore): close them along it.
  for (const ch of open) {
    const a0 = ch[0], a1 = ch[ch.length - 1];
    if (Math.abs(a0[1]) < eps * 4 && Math.abs(a1[1]) < eps * 4 && ch.length > 2) loops.push(ch);
    else return { loops: null, why: 'the cut through the part does not close (the mesh has gaps)' };
  }
  return { loops: loops.map(l => clean(l, eps)).filter(l => l.length >= 3 && Math.abs(area2(l)) > eps * eps) };
}

const area2 = l => { let s = 0; for (let i = 0; i < l.length; i++) { const p = l[i], q = l[(i + 1) % l.length]; s += p[0] * q[1] - q[0] * p[1]; } return s / 2; };

// Drop points closer than eps and points on a straight line.
// (atAxis: the second number is a distance from an axis and may not go below 0; off for plain coordinates in a plane)
function clean(l, eps, atAxis = true) {
  let pts = l.map(p => [p[0], atAxis ? Math.max(0, p[1]) : p[1]]);
  for (let pass = 0; pass < 3; pass++) {
    const out = [];
    for (const p of pts) { const q = out[out.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > eps) out.push(p); }
    while (out.length > 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= eps) out.pop();
    pts = [];
    for (let i = 0; i < out.length; i++) {
      const a = out[(i - 1 + out.length) % out.length], b = out[i], c = out[(i + 1) % out.length];
      const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1];
      const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
      if (Math.abs(ux * vy - uy * vx) / (lu * lv) < 1e-3 && ux * vx + uy * vy > 0) continue;   // straight on
      pts.push(b);
    }
  }
  return pts;
}

// ── 3. fill the gaps along the axis narrower than W ─────────────────────────
// The profile is cut into strips at every vertex's height (r). Within a strip each edge is a straight piece,
// so the empty gap between the material on its left and the material on its right has a width that changes
// linearly with r: where it is under W the strip is filled, and the strip is cut again where it reaches W.
// The fills are joined to the material exactly (a union of trapezoids with the profile): an edge piece that
// a fill covers drops out, and on each strip line the horizontal pieces are added up with their direction.
// Corners outside the fills stay exactly as they were.
export function fillGrooves(loops, W, eps) {
  const E = [];
  for (const L of loops) for (let i = 0; i < L.length; i++) E.push({ p: L[i], q: L[(i + 1) % L.length] });
  const flat = e => Math.abs(e.q[1] - e.p[1]) <= eps;
  const merge = arr => { arr.sort((x, y) => x - y); const o = []; for (const v of arr) if (!o.length || v - o[o.length - 1] > eps) o.push(v); return o; };
  const hAt = (e, r) => {
    if (Math.abs(r - e.p[1]) <= eps) return e.p[0];
    if (Math.abs(r - e.q[1]) <= eps) return e.q[0];
    return e.p[0] + (r - e.p[1]) / (e.q[1] - e.p[1]) * (e.q[0] - e.p[0]);
  };
  const across = (lo, hi) => E.filter(e => !flat(e) && Math.min(e.p[1], e.q[1]) <= lo + eps && Math.max(e.p[1], e.q[1]) >= hi - eps);
  // The bounded gaps of a strip: an edge going up ends the material on its left (smaller h); the next
  // edge, going down, starts material again.
  const gaps = (lo, hi) => {
    const rm = (lo + hi) / 2, xs = across(lo, hi).map(e => ({ e, h: hAt(e, rm) })).sort((a, b) => a.h - b.h), out = [];
    for (let i = 0; i + 1 < xs.length; i++) if (xs[i].e.q[1] > xs[i].e.p[1] && xs[i + 1].e.q[1] < xs[i + 1].e.p[1]) out.push([xs[i].e, xs[i + 1].e]);
    return out;
  };
  let levels = merge(E.map(e => e.p[1]));
  const cuts = [];
  for (let k = 0; k + 1 < levels.length; k++) {
    const lo = levels[k], hi = levels[k + 1];
    for (const [U, D] of gaps(lo, hi)) {
      const wl = hAt(D, lo) - hAt(U, lo), wh = hAt(D, hi) - hAt(U, hi);
      if ((wl - W) * (wh - W) < 0) cuts.push(lo + (W - wl) / (wh - wl) * (hi - lo));
    }
  }
  levels = merge(levels.concat(cuts));
  const fills = [];
  for (let k = 0; k + 1 < levels.length; k++) {
    const lo = levels[k], hi = levels[k + 1], rm = (lo + hi) / 2;
    for (const [U, D] of gaps(lo, hi)) if (hAt(D, rm) - hAt(U, rm) < W) fills.push({ k, U, D, lo, hi });
  }
  if (!fills.length) return { loops, grooves: 0, filledArea: 0 };

  // Points, snapped so the same place is one point whichever piece names it.
  const pts = [], grid = new Map(), cell = eps * 4;
  const pid = (h, r) => {
    const gx = Math.floor(h / cell), gy = Math.floor(r / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const id of grid.get((gx + dx) + ',' + (gy + dy)) || []) {
      if (Math.abs(pts[id][0] - h) <= eps && Math.abs(pts[id][1] - r) <= eps) return id;
    }
    const id = pts.length; pts.push([h, r]);
    const g = gx + ',' + gy; if (!grid.has(g)) grid.set(g, []); grid.get(g).push(id);
    return id;
  };
  const levelOf = r => { let lo = 0, hi = levels.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (levels[m] <= r) lo = m; else hi = m; } return Math.abs(levels[hi] - r) < Math.abs(levels[lo] - r) ? hi : lo; };
  // Edge pieces, one per edge per strip; a fill removes the pieces along both its sides.
  const eid = new Map(E.map((e, i) => [e, i]));
  const covered = new Set(fills.flatMap(f => [eid.get(f.U) + ':' + f.k, eid.get(f.D) + ':' + f.k]));
  const out = [];
  E.forEach((e, ei) => {
    if (flat(e)) return;
    const up = e.q[1] > e.p[1], a = levelOf(Math.min(e.p[1], e.q[1])), b = levelOf(Math.max(e.p[1], e.q[1]));
    const ks = []; for (let k = a; k < b; k++) ks.push(k);
    if (!up) ks.reverse();
    for (const k of ks) {
      if (covered.has(ei + ':' + k)) continue;
      const r0 = up ? levels[k] : levels[k + 1], r1 = up ? levels[k + 1] : levels[k];
      out.push([pid(hAt(e, r0), r0), pid(hAt(e, r1), r1)]);
    }
  });
  // Horizontal pieces per strip line: +1 runs toward +h (material above), −1 toward −h (material below).
  const lines = new Map();
  const addH = (k, h0, h1, s) => { if (Math.abs(h1 - h0) <= eps) return; if (!lines.has(k)) lines.set(k, []); lines.get(k).push([Math.min(h0, h1), Math.max(h0, h1), s]); };
  for (const e of E) if (flat(e)) addH(levelOf(e.p[1]), e.p[0], e.q[0], e.q[0] > e.p[0] ? 1 : -1);
  for (const f of fills) {
    addH(f.k, hAt(f.U, f.lo), hAt(f.D, f.lo), 1);         // bottom of the fill, material above it
    addH(f.k + 1, hAt(f.U, f.hi), hAt(f.D, f.hi), -1);    // top of the fill, material below it
  }
  for (const [k, iv] of lines) {
    const r = levels[k], xs = merge(iv.flatMap(([a, b]) => [a, b]));
    for (let i = 0; i + 1 < xs.length; i++) {
      const m = (xs[i] + xs[i + 1]) / 2;
      let s = 0; for (const [a, b, d] of iv) if (a < m && m < b) s += d;
      if (s > 0) out.push([pid(xs[i], r), pid(xs[i + 1], r)]);
      else if (s < 0) out.push([pid(xs[i + 1], r), pid(xs[i], r)]);
    }
  }
  // Chain the pieces into loops.
  const from = new Map();
  for (const s of out) { if (s[0] === s[1]) continue; if (!from.has(s[0])) from.set(s[0], []); from.get(s[0]).push(s); }
  const used = new Set(), result = [];
  let broken = 0;
  for (const s0 of out) {
    if (used.has(s0) || s0[0] === s0[1]) continue;
    const loop = []; let s = s0;
    for (let guard = 0; guard <= out.length; guard++) {
      used.add(s); loop.push(pts[s[0]]);
      if (s[1] === s0[0]) break;
      s = (from.get(s[1]) || []).find(x => !used.has(x));
      if (!s) { loop.length = 0; broken++; break; }
    }
    if (loop.length >= 3) result.push(clean(loop, eps));
  }
  if (broken) return { loops, grooves: 0, filledArea: 0, why: 'the filled profile did not close' };
  // Grooves: fills that touch across a strip line count as one.
  const parent = fills.map((_, i) => i), find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
  const byK = new Map(); fills.forEach((f, i) => { if (!byK.has(f.k)) byK.set(f.k, []); byK.get(f.k).push(i); });
  fills.forEach((f, i) => {
    for (const j of byK.get(f.k + 1) || []) {
      const g = fills[j], a0 = hAt(f.U, f.hi), a1 = hAt(f.D, f.hi), b0 = hAt(g.U, g.lo), b1 = hAt(g.D, g.lo);
      if (Math.min(a1, b1) - Math.max(a0, b0) > -eps) parent[find(i)] = find(j);
    }
  });
  const grooves = new Set(fills.map((_, i) => find(i))).size;
  const before = loops.reduce((s, L) => s + area2(L), 0), after = result.reduce((s, L) => s + area2(L), 0);
  return { loops: result.filter(L => L.length >= 3), grooves, filledArea: after - before };
}

// ── 3b. no loops that do nothing ────────────────────────────────────────────
// Every point of the profile becomes a ring of edges round the part, so a point that hardly bends the profile is a loop for
// nothing: a hair-thin step where the fill meets a ledge, a wall the CAD tessellation left a few hundredths proud, a chamfer cut
// in two. The point that is nearest the line between its neighbours goes, again and again, while every point taken out so far
// along that stretch stays within tol of the new line (so a gentle curve made of many points cannot creep away bit by bit).
export function simplifyLoop(L, tol) {
  let pts = L.map(p => ({ p, gone: [] }));
  const off = (a, b, q) => {
    const ex = b[0] - a[0], ey = b[1] - a[1], l2 = ex * ex + ey * ey;
    if (!l2) return Math.hypot(q[0] - a[0], q[1] - a[1]);
    const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * ex + (q[1] - a[1]) * ey) / l2));
    return Math.hypot(a[0] + t * ex - q[0], a[1] + t * ey - q[1]);
  };
  // (each point keeps `gone`: the points dropped between the point before it and itself)
  // the error of dropping point i: it, and what was dropped on both sides of it, against the line from i-1 to i+1
  const cost = i => {
    const n = pts.length, a = pts[(i - 1 + n) % n].p, nx = pts[(i + 1) % n], b = nx.p, x = pts[i];
    let e = off(a, b, x.p);
    for (const q of x.gone) e = Math.max(e, off(a, b, q));
    for (const q of nx.gone) e = Math.max(e, off(a, b, q));
    return e;
  };
  for (let guard = 0; guard < L.length && pts.length > 3; guard++) {
    let best = -1, bc = tol;
    for (let i = 0; i < pts.length; i++) { const c = cost(i); if (c <= bc) { bc = c; best = i; } }
    if (best < 0) break;
    const n = pts.length, x = pts[best], next = pts[(best + 1) % n];
    next.gone = [...x.gone, x.p, ...next.gone];
    pts.splice(best, 1);
  }
  return pts.map(x => x.p);
}

// ── 4. spin a profile around the axis ───────────────────────────────────────
export function revolveLoops(loops, c, a, N, phase, eps, smoothDeg = 30) {
  const [e1, e2] = basis(a);
  const cosS = Math.cos(smoothDeg * Math.PI / 180);
  const pos = [], nor = [], idx = [];
  const P3 = (h, r, th) => { const ct = Math.cos(th), st = Math.sin(th); return [c[0] + a[0] * h + r * (ct * e1[0] + st * e2[0]), c[1] + a[1] * h + r * (ct * e1[1] + st * e2[1]), c[2] + a[2] * h + r * (ct * e1[2] + st * e2[2])]; };
  const N3 = (nh, nr, th) => { const ct = Math.cos(th), st = Math.sin(th); return norm([a[0] * nh + nr * (ct * e1[0] + st * e2[0]), a[1] * nh + nr * (ct * e1[1] + st * e2[1]), a[2] * nh + nr * (ct * e1[2] + st * e2[2])]); };
  // Round the axis the same angle decides (the Phong angle): neighbouring segments meet at 360° / N. Under the angle the
  // shading is smooth round the part; over it each segment is lit as the flat face it is (it has its own corners, and its
  // normal is the face's own: the profile seen at the middle of the segment, where the face is cos(π/N) nearer the axis).
  const flatAround = 360 / N > smoothDeg + 1e-9, cosH = flatAround ? Math.cos(Math.PI / N) : 1;
  for (const L of loops) {
    const n = L.length;
    // outward normal of edge k (material on the left: outward is the right of the edge)
    const en = L.map((p, k) => { const q = L[(k + 1) % n], dh = q[0] - p[0], dr = (q[1] - p[1]) * cosH, l = Math.hypot(dh, dr) || 1; return [dr / l, -dh / l]; });
    for (let k = 0; k < n; k++) {
      const p = L[k], q = L[(k + 1) % n];
      if (p[1] < eps && q[1] < eps) continue;          // along the axis: no surface
      // normals at both ends: shared with the neighbouring edge when the turn is gentle
      const nP = (() => { const o = en[(k - 1 + n) % n], m = en[k]; return o[0] * m[0] + o[1] * m[1] > cosS ? norm([o[0] + m[0], o[1] + m[1], 0]) : m; })();
      const nQ = (() => { const o = en[(k + 1) % n], m = en[k]; return o[0] * m[0] + o[1] * m[1] > cosS ? norm([o[0] + m[0], o[1] + m[1], 0]) : m; })();
      const base = pos.length / 3;
      if (flatAround) {
        for (let s = 0; s < N; s++) {
          const t0 = phase + s * TAU / N, t1 = phase + ((s + 1) % N) * TAU / N, tm = phase + (s + 0.5) * TAU / N;
          pos.push(...P3(p[0], p[1], t0), ...P3(q[0], q[1], t0), ...P3(p[0], p[1], t1), ...P3(q[0], q[1], t1));
          const a0 = N3(nP[0], nP[1], tm), b0 = N3(nQ[0], nQ[1], tm);
          nor.push(...a0, ...b0, ...a0, ...b0);
          const p0 = base + 4 * s, q0 = p0 + 1, p1 = p0 + 2, q1 = p0 + 3;
          if (p[1] >= eps) idx.push(p0, q0, p1);
          if (q[1] >= eps) idx.push(q0, q1, p1);
        }
        continue;
      }
      for (let s = 0; s <= N; s++) {
        const th = phase + (s % N) * TAU / N;
        pos.push(...P3(p[0], p[1], th), ...P3(q[0], q[1], th));
        nor.push(...N3(nP[0], nP[1], th), ...N3(nQ[0], nQ[1], th));
      }
      for (let s = 0; s < N; s++) {
        const p0 = base + 2 * s, q0 = p0 + 1, p1 = p0 + 2, q1 = p0 + 3;
        // winding so the face points along the outward normal
        if (p[1] >= eps) idx.push(p0, q0, p1);
        if (q[1] >= eps) idx.push(q0, q1, p1);
      }
    }
  }
  const positions = new Float32Array(pos), normals = new Float32Array(nor);
  let index = new Uint32Array(idx);
  // Check the winding once by volume; flip all if inside out.
  let vol = 0;
  for (let t = 0; t < index.length; t += 3) {
    const A = index[t] * 3, B = index[t + 1] * 3, C = index[t + 2] * 3;
    vol += dot([positions[A] - c[0], positions[A + 1] - c[1], positions[A + 2] - c[2]], cross([positions[B] - c[0], positions[B + 1] - c[1], positions[B + 2] - c[2]], [positions[C] - c[0], positions[C + 1] - c[1], positions[C + 2] - c[2]]));
  }
  if (vol < 0) for (let t = 0; t < index.length; t += 3) { const x = index[t + 1]; index[t + 1] = index[t + 2]; index[t + 2] = x; }
  return { positions, normals, index };
}

// ── the whole job ───────────────────────────────────────────────────────────
// opts.width: grooves narrower than this are filled (part units). Default: 15 % of the part's length along
// the axis or its diameter, whichever is smaller. opts.tolerance: how far the part may be from round.
// opts.dryRun: find and measure only. Returns { ok, why?, axis, center, segments, before, after, filled, ... }.
export function fillRoundGrooves(positions, index, opts = {}) {
  const P = positions, I = index || Uint32Array.from({ length: P.length / 3 }, (_, i) => i);
  const mo = moments(P, I);
  if (!mo) return { ok: false, why: 'the part has no surface' };
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[i + k]); hi[k] = Math.max(hi[k], P[i + k]); }
  const size = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  const eps = size * 1e-5;

  // Try each principal direction; keep the roundest.
  const cand = eigen3(mo.cov).map(e => snapAxis(e.vec));
  let best = null;
  for (const a of cand) {
    const r = tryAxis(P, I, mo.center, a, size, eps);
    if (r && (!best || r.roundness < best.roundness)) best = r;
  }
  if (!best || !best.loops) return { ok: false, why: 'the part is not round around one axis' + (best?.why ? ' (' + best.why + ')' : '') };
  const tol = opts.tolerance ?? Math.max(size * 0.004, best.sag * 2.5);
  if (best.roundness > tol) return { ok: false, why: 'the part is not round around one axis (it is ' + best.roundness.toFixed(3) + ' off; up to ' + tol.toFixed(3) + ' is allowed)', roundness: best.roundness, axis: best.axis };

  const span = best.hSpan, dia = 2 * best.rMax;
  const W = opts.width ?? 0.15 * Math.min(span, dia);
  const filled = fillGrooves(best.loops, W, eps);
  const simplifyTol = opts.simplify ?? size * 6e-4;
  if (simplifyTol > 0) filled.loops = filled.loops.map(L => simplifyLoop(L, simplifyTol));
  const before = { triangles: I.length / 3 };
  const res = { ok: true, axis: best.axis, center: mo.center, segments: best.N, ownSegments: best.N, phase: best.phase, eps, width: W, roundness: best.roundness, profileBefore: best.loops, profileAfter: filled.loops, grooves: filled.grooves, filledArea: filled.filledArea, before };
  if (filled.why) return { ...res, ok: false, why: filled.why };
  if (opts.dryRun) return res;
  const N = opts.segments > 2 ? Math.round(opts.segments) : best.N;
  res.segments = N;
  const g = revolveLoops(filled.loops, mo.center, best.axis, N, best.phase, eps, opts.smoothDeg ?? 30);
  res.after = { triangles: g.index.length / 3 };
  res.positions = g.positions; res.normals = g.normals; res.index = g.index;
  return res;
}

function tryAxis(P, I, c, a, size, eps) {
  const [e1, e2] = basis(a);
  // the outermost vertices give the number of segments and their angle
  const nv = P.length / 3, ang = [], rr = new Float64Array(nv);
  let rMax = 0, hMin = Infinity, hMax = -Infinity;
  for (let i = 0; i < nv; i++) {
    const p = [P[3 * i] - c[0], P[3 * i + 1] - c[1], P[3 * i + 2] - c[2]], h = dot(p, a);
    rr[i] = Math.hypot(dot(p, e1), dot(p, e2)); rMax = Math.max(rMax, rr[i]); hMin = Math.min(hMin, h); hMax = Math.max(hMax, h);
  }
  if (!(rMax > eps)) return null;
  for (let i = 0; i < nv; i++) if (rr[i] > rMax * 0.995) {
    const p = [P[3 * i] - c[0], P[3 * i + 1] - c[1], P[3 * i + 2] - c[2]];
    ang.push(((Math.atan2(dot(p, e2), dot(p, e1)) % TAU) + TAU) % TAU);
  }
  ang.sort((x, y) => x - y);
  const distinct = [];
  for (const t of ang) if (!distinct.length || t - distinct[distinct.length - 1] > 1e-3) distinct.push(t);
  if (distinct.length > 1 && distinct[0] + TAU - distinct[distinct.length - 1] < 1e-3) distinct.pop();
  const N = Math.max(8, Math.min(512, distinct.length));
  const phase = distinct[0] || 0;
  const sag = rMax * (1 - Math.cos(Math.PI / N));
  // Cut near a column of vertices (a hair off, so no vertex lies in the plane), and at other angles to
  // see whether the part is the same all round.
  const main = slice(P, I, c, a, phase + 1e-3, eps);
  if (!main.loops || !main.loops.length) return { roundness: Infinity, why: main.why || 'the cut through the part is empty' };
  let worst = 0;
  const step = TAU / N;
  for (const k of [1, 2, 3, 5, 7]) {
    const th = phase + Math.round(k * N / 8) * step + 1e-3;
    const s = slice(P, I, c, a, th, eps);
    if (!s.loops) return { roundness: Infinity, why: s.why };
    worst = Math.max(worst, profileDistance(main.loops, s.loops), profileDistance(s.loops, main.loops));
  }
  return { axis: a, loops: main.loops, N, phase, sag, rMax, hSpan: hMax - hMin, roundness: worst };
}

// The farthest any point of profile B is from profile A (one-sided Hausdorff on the vertices).
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

// ── Outline mode: spin the outline of the whole part ────────────────────────
// For a part that is round only in steps (a fan with fins, a clutch with cooling ribs, a gear) or whose mesh has gaps, there
// is no single cut that is the part. Instead every point of its surface is turned onto one half-plane: (h, r) is where it
// lies along the axis and how far from it. On a grid there, the surface is marked (each triangle split until its pieces are
// smaller than half a cell, so the marks join up), the marks are grown by a few cells to seal gaps in the mesh, and the
// outside is flooded in from the ends and from beyond the largest radius (not from the axis). What the flood does not reach
// is solid: fins, the room between them and anything closed inside. The flood is grown back by the same few cells (so the
// part keeps its size), the edge of the solid is traced (material on the left), straightened, and then handled as in
// Fill grooves: narrow gaps filled, loops that do nothing dropped, spun round the axis.
// opts: cells (grid cells along the larger of length and radius, default 900), gap (cells of gap to seal, default 2),
// segments (around the axis, default 64), width (as fillRoundGrooves; 0 = do not fill grooves), dryRun.
export function outlineRevolve(positions, index, opts = {}) {
  const P = positions, I = index || Uint32Array.from({ length: P.length / 3 }, (_, i) => i);
  const mo = moments(P, I);
  if (!mo) return { ok: false, why: 'the part has no surface' };
  // the axis: the principal direction whose other two moments are the most nearly equal
  const ev = eigen3(mo.cov);
  let pick = null;
  for (let i = 0; i < 3; i++) {
    const o = [0, 1, 2].filter(k => k !== i).map(k => ev[k].val), spread = Math.abs(o[0] - o[1]) / (Math.max(o[0], o[1]) || 1);
    if (!pick || spread < pick.spread) pick = { a: snapAxis(ev[i].vec), spread };
  }
  if (pick.spread > 0.2) return { ok: false, why: 'the part is not round enough to spin: it is ' + Math.round(pick.spread * 100) + ' % wider one way than the other across its axis' };
  const a = pick.a, c = mo.center;
  // where every vertex lies
  const nv = P.length / 3, H = new Float64Array(nv), R = new Float64Array(nv);
  let hMin = Infinity, hMax = -Infinity, rMax = 0;
  for (let i = 0; i < nv; i++) {
    const x = P[3 * i] - c[0], y = P[3 * i + 1] - c[1], z = P[3 * i + 2] - c[2], h = x * a[0] + y * a[1] + z * a[2];
    const rx = x - h * a[0], ry = y - h * a[1], rz = z - h * a[2];
    H[i] = h; R[i] = Math.hypot(rx, ry, rz);
    if (h < hMin) hMin = h; if (h > hMax) hMax = h; if (R[i] > rMax) rMax = R[i];
  }
  const res = opts.cells || 900, gap = opts.gap ?? 2;
  const cell = Math.max(hMax - hMin, rMax) / res;
  if (!(cell > 0)) return { ok: false, why: 'the part has no size' };
  const pad = gap + 3, h0 = hMin - pad * cell;
  const NX = Math.ceil((hMax - hMin) / cell) + 2 * pad + 1, NY = Math.ceil(rMax / cell) + pad + 1;
  const grid = new Uint8Array(NX * NY);                          // 1 = surface (then solid), 2 = outside
  const mark = (h, r) => { const i = Math.floor((h - h0) / cell), j = Math.floor(r / cell); if (i >= 0 && i < NX && j >= 0 && j < NY) grid[j * NX + i] = 1; };
  const hr = (x, y, z) => { const dx = x - c[0], dy = y - c[1], dz = z - c[2], h = dx * a[0] + dy * a[1] + dz * a[2]; return [h, Math.hypot(dx - h * a[0], dy - h * a[1], dz - h * a[2])]; };
  // mark the surface. A triangle's shadow in (h, r) is a triangle too as long as r stays nearly linear across it: r bends by at
  // most about L² / (8 r) over an edge of length L at distance r from the axis. So a triangle is split on its longest edge only
  // while that bend is over a quarter of a cell (a fin in a plane through the axis is never split), and the shadow of each
  // piece is filled cell by cell; its corners are marked too, so a sliver thinner than a cell still leaves a line.
  const fillTri = (A, B, C) => {
    mark(A[0], A[1]); mark(B[0], B[1]); mark(C[0], C[1]);
    const i0 = Math.max(0, Math.floor((Math.min(A[0], B[0], C[0]) - h0) / cell)), i1 = Math.min(NX - 1, Math.floor((Math.max(A[0], B[0], C[0]) - h0) / cell));
    const j0 = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1]) / cell)), j1 = Math.min(NY - 1, Math.floor(Math.max(A[1], B[1], C[1]) / cell));
    if (i1 - i0 < 1 && j1 - j0 < 1) return;
    const d = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
    if (Math.abs(d) < 1e-20) {                                    // a shadow with no area: a line, marked along its length
      const seg = (p, q) => { const n = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / (cell * 0.5)); for (let s = 1; s < n; s++) mark(p[0] + (q[0] - p[0]) * s / n, p[1] + (q[1] - p[1]) * s / n); };
      seg(A, B); seg(B, C); seg(C, A); return;
    }
    // a cell is marked when its centre is inside, or an edge of the shadow passes through it (the segments, sampled finely)
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = h0 + (i + 0.5) * cell, y = (j + 0.5) * cell;
      const w0 = ((B[0] - x) * (C[1] - y) - (B[1] - y) * (C[0] - x)) / d, w1 = ((C[0] - x) * (A[1] - y) - (C[1] - y) * (A[0] - x)) / d;
      if (w0 >= 0 && w1 >= 0 && w0 + w1 <= 1) grid[j * NX + i] = 1;
    }
    const seg = (p, q) => { const n = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / (cell * 0.5)); for (let s = 1; s < n; s++) mark(p[0] + (q[0] - p[0]) * s / n, p[1] + (q[1] - p[1]) * s / n); };
    seg(A, B); seg(B, C); seg(C, A);
  };
  const stack = [];
  for (let t = 0; t < I.length; t += 3) {
    const A = I[t] * 3, B = I[t + 1] * 3, C = I[t + 2] * 3;
    stack.push([P[A], P[A + 1], P[A + 2], P[B], P[B + 1], P[B + 2], P[C], P[C + 1], P[C + 2]]);
    while (stack.length) {
      const q = stack.pop();
      const ab = (q[0] - q[3]) ** 2 + (q[1] - q[4]) ** 2 + (q[2] - q[5]) ** 2, bc = (q[3] - q[6]) ** 2 + (q[4] - q[7]) ** 2 + (q[5] - q[8]) ** 2, ca = (q[6] - q[0]) ** 2 + (q[7] - q[1]) ** 2 + (q[8] - q[2]) ** 2;
      const pa = hr(q[0], q[1], q[2]), pb = hr(q[3], q[4], q[5]), pc = hr(q[6], q[7], q[8]);
      const L2 = Math.max(ab, bc, ca), rLow = Math.max(Math.min(pa[1], pb[1], pc[1]), cell * 0.5);
      if (L2 <= (cell * 0.5) ** 2 || L2 / (8 * rLow) <= cell * 0.25 || stack.length > 1e6) { fillTri(pa, pb, pc); continue; }
      let u, v, w;                                               // the edge u–v is split; w is the corner across
      if (ab >= bc && ab >= ca) { u = 0; v = 3; w = 6; } else if (bc >= ca) { u = 3; v = 6; w = 0; } else { u = 6; v = 0; w = 3; }
      const m = [(q[u] + q[v]) / 2, (q[u + 1] + q[v + 1]) / 2, (q[u + 2] + q[v + 2]) / 2];
      stack.push([q[u], q[u + 1], q[u + 2], m[0], m[1], m[2], q[w], q[w + 1], q[w + 2]]);
      stack.push([m[0], m[1], m[2], q[v], q[v + 1], q[v + 2], q[w], q[w + 1], q[w + 2]]);
    }
  }
  // grow the marks by `gap` cells (seals gaps in the mesh), flood the outside, grow the outside back
  const grow = (src, k) => {                                      // cells within k (square) of a cell where src is true
    let cur = src.slice();
    for (let s = 0; s < k; s++) {
      const nx = cur.slice();
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
        if (cur[j * NX + i]) continue;
        let hit = 0;
        for (let dj = -1; dj <= 1 && !hit; dj++) for (let di = -1; di <= 1; di++) {
          const ii = i + di, jj = j + dj;
          if (ii >= 0 && ii < NX && jj >= 0 && jj < NY && cur[jj * NX + ii]) { hit = 1; break; }
        }
        if (hit) nx[j * NX + i] = 1;
      }
      cur = nx;
    }
    return cur;
  };
  const wall = grow(grid, gap);
  const out = new Uint8Array(NX * NY), q = [];
  const seed = (i, j) => { const k = j * NX + i; if (!wall[k] && !out[k]) { out[k] = 1; q.push(k); } };
  for (let j = 0; j < NY; j++) { seed(0, j); seed(NX - 1, j); }
  for (let i = 0; i < NX; i++) seed(i, NY - 1);                 // (not the axis row: inside a hub is not outside)
  while (q.length) {
    const k = q.pop(), i = k % NX, j = (k - i) / NX;
    if (i > 0) seed(i - 1, j); if (i < NX - 1) seed(i + 1, j); if (j > 0) seed(i, j - 1); if (j < NY - 1) seed(i, j + 1);
  }
  const outside = grow(out, gap);
  const solid = new Uint8Array(NX * NY);
  let any = 0;
  for (let k = 0; k < solid.length; k++) if (!outside[k]) { solid[k] = 1; any++; }
  if (!any) return { ok: false, why: 'nothing is left inside the outline (the mesh may be too open: try a larger gap)' };
  // trace the edge of the solid, material on the left; grid points (i, j) are at h0 + i·cell, j·cell
  const S = (i, j) => i >= 0 && i < NX && j >= 0 && j < NY && solid[j * NX + i] === 1;
  const edges = new Map();                                        // start point → [end points]
  const add = (x0, y0, x1, y1) => { const k = x0 + ',' + y0; if (!edges.has(k)) edges.set(k, []); edges.get(k).push([x1, y1]); };
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    if (!S(i, j)) continue;
    if (!S(i, j - 1)) add(i, j, i + 1, j);                        // below empty: run +h
    if (!S(i, j + 1)) add(i + 1, j + 1, i, j + 1);                // above empty: run −h
    if (!S(i - 1, j)) add(i, j + 1, i, j);                        // left empty: run −r
    if (!S(i + 1, j)) add(i + 1, j, i + 1, j + 1);                // right empty: run +r
  }
  const loops = [];
  for (const [k0] of edges) {
    while (edges.get(k0) && edges.get(k0).length) {
      const [sx, sy] = k0.split(',').map(Number), L = [[sx, sy]];
      let px = sx, py = sy, dx = 0, dy = 0;
      for (let guard = 0; guard < 4 * NX * NY; guard++) {
        const list = edges.get(px + ',' + py);
        if (!list || !list.length) break;
        // where two corners touch, turn left first: the two pieces of solid stay apart
        let bi = 0;
        if (list.length > 1) {
          let best = -Infinity;
          list.forEach(([x, y], n) => { const ex = x - px, ey = y - py, turn = dx * ey - dy * ex, str = dx * ex + dy * ey; const sc = turn * 2 + str; if (sc > best) { best = sc; bi = n; } });
        }
        const [nx, ny] = list.splice(bi, 1)[0];
        dx = nx - px; dy = ny - py; px = nx; py = ny;
        if (px === sx && py === sy) break;
        L.push([px, py]);
      }
      if (L.length >= 4) loops.push(L.map(([x, y]) => [h0 + x * cell, y * cell]));
    }
  }
  // straighten the staircase (its corners sit up to a cell either side of the true line, so 1.5 cells), then as in Fill grooves
  const eps = cell * 1e-3;
  let prof = loops.map(L => dp(clean(L, eps), cell * 1.5)).filter(L => L.length >= 3 && Math.abs(area2(L)) > cell * cell * 4);
  const span = hMax - hMin;
  const W = opts.width ?? 0.15 * Math.min(span, 2 * rMax);
  let grooves = 0;
  if (W > 0) { const f = fillGrooves(prof, W, eps); if (!f.why) { prof = f.loops; grooves = f.grooves; } }
  prof = prof.map(L => simplifyLoop(clean(L, eps), cell * 1.5)).filter(L => L.length >= 3);
  // a ring at the axis is no surface: points within half a cell of it go onto it
  prof = prof.map(L => L.map(p => [p[0], p[1] < cell * 0.5 ? 0 : p[1]]));
  const N = opts.segments || 64;
  const result = { ok: true, mode: 'outline', axis: a, center: c, segments: N, phase: 0, eps, width: W, cell, grooves, profileAfter: prof, before: { triangles: I.length / 3 } };
  if (opts.dryRun) return result;
  const g = revolveLoops(prof, c, a, N, 0, eps, opts.smoothDeg ?? 30);
  return { ...result, after: { triangles: g.index.length / 3 }, positions: g.positions, normals: g.normals, index: g.index };
}

// Douglas–Peucker on a closed loop: split at the point farthest from the first, simplify both halves.
function dp(L, tol) {
  if (L.length < 4) return L;
  let far = 0, fd = -1;
  for (let i = 1; i < L.length; i++) { const d = Math.hypot(L[i][0] - L[0][0], L[i][1] - L[0][1]); if (d > fd) { fd = d; far = i; } }
  const run = (pts) => {
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const st = [[0, pts.length - 1]];
    while (st.length) {
      const [s, e] = st.pop(), A = pts[s], B = pts[e], ex = B[0] - A[0], ey = B[1] - A[1], l = Math.hypot(ex, ey) || 1;
      let bi = -1, bd = tol;
      for (let i = s + 1; i < e; i++) { const d = Math.abs((pts[i][0] - A[0]) * ey - (pts[i][1] - A[1]) * ex) / l; if (d > bd) { bd = d; bi = i; } }
      if (bi > 0) { keep[bi] = 1; st.push([s, bi], [bi, e]); }
    }
    return pts.filter((_, i) => keep[i]);
  };
  const a = run(L.slice(0, far + 1)), b = run(L.slice(far).concat([L[0]]));
  return a.concat(b.slice(1, -1));
}

// ── Belt mode: a band swept along a closed path ─────────────────────────────
// A drive belt (a poly-V belt with ribs on its inside, a flat belt, a seal strip laid round a shape) is one cross-section carried
// along a closed path that lies in a plane: the same idea as a round part, with the path in place of the circle round the axis.
//   1. The plane: the direction in which the part is thinnest (its smallest spread of surface) is the plane's normal, Z.
//   2. The path: every triangle is laid flat on the plane and the shadow filled on a grid (as in outline mode); the outside edge
//      of the shadow is the belt's back. Traced and straightened it is only as good as the grid, so it is then fitted to the mesh:
//      each corner of the path is moved out to the farthest point of the surface beside it (corners with nothing beside them, on
//      a long straight run, move as their neighbours do), twice.
//   3. The cross-section: each point of the mesh gets (z, d): z across the belt (along Z), d in from the back. All the triangles,
//      put in (z, d), are filled on a grid of their own, so the band and its ribs are one shape however the belt runs.
//   4. As in Fill grooves: gaps across the belt narrower than the width are filled (the room between the ribs), loops that do
//      nothing go, and the cross-section is swept along the path again, smooth along it and hard at its corners.
// opts: width (default a quarter of the belt's width), cells (default 700 for the cross-section), smoothDeg, dryRun.
export function sweepBelt(positions, index, opts = {}) {
  const P = positions, I = index || Uint32Array.from({ length: P.length / 3 }, (_, i) => i);
  const mo = moments(P, I);
  if (!mo) return { ok: false, why: 'the part has no surface' };
  const ev = eigen3(mo.cov), Z = snapAxis(ev[0].vec), c = mo.center;
  if (!(ev[0].val < 0.05 * ev[1].val)) return { ok: false, why: 'the part is not flat enough to be a belt: it is not a band lying in one plane' };
  const [e1, e2] = basis(Z);
  const nv = P.length / 3, U = new Float64Array(nv), V = new Float64Array(nv), Zc = new Float64Array(nv);
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity, zMin = Infinity, zMax = -Infinity;
  for (let i = 0; i < nv; i++) {
    const x = P[3 * i] - c[0], y = P[3 * i + 1] - c[1], z = P[3 * i + 2] - c[2];
    U[i] = x * e1[0] + y * e1[1] + z * e1[2]; V[i] = x * e2[0] + y * e2[1] + z * e2[2]; Zc[i] = x * Z[0] + y * Z[1] + z * Z[2];
    uMin = Math.min(uMin, U[i]); uMax = Math.max(uMax, U[i]); vMin = Math.min(vMin, V[i]); vMax = Math.max(vMax, V[i]); zMin = Math.min(zMin, Zc[i]); zMax = Math.max(zMax, Zc[i]);
  }
  // 2. the path: the outside of the shadow on the plane
  const tri2 = (X, Y) => { const t = new Float64Array(I.length * 2); for (let k = 0; k < I.length; k++) { t[2 * k] = X[I[k]]; t[2 * k + 1] = Y[I[k]]; } return t; };
  const plan = rasterLoops(tri2(U, V), { cells: opts.planCells || 1500, gap: 2, holes: true });
  if (!plan.loops.length) return { ok: false, why: 'its shadow on the plane is empty' };
  let outer = plan.loops.reduce((b, L) => (!b || Math.abs(area2(L)) > Math.abs(area2(b)) ? L : b), null);
  if (plan.loops.length < 2) return { ok: false, why: 'it is not a band round an opening (its shadow on the plane has no hole), so there is no path to follow' };
  let path = dp(clean(outer, plan.cell * 1e-3, false), plan.cell * 0.5);
  if (area2(path) < 0) path.reverse();                              // counter-clockwise: the inside is on the left
  // fit the path to the back: move each corner out to the farthest surface point beside it that can be the back (within two grid
  // cells of the traced edge; the ribs and the inside of the band are deeper and say nothing about where the back is)
  const nearest = (u, v) => {                                       // nearest segment: index, along (0..1), signed distance (+ = out)
    let best = null;
    for (let k = 0; k < path.length; k++) {
      const a = path[k], b = path[(k + 1) % path.length], ex = b[0] - a[0], ey = b[1] - a[1], l2 = ex * ex + ey * ey || 1e-30;
      const t = Math.max(0, Math.min(1, ((u - a[0]) * ex + (v - a[1]) * ey) / l2)), px = a[0] + t * ex - u, py = a[1] + t * ey - v, d2 = px * px + py * py;
      if (!best || d2 < best.d2) { const l = Math.sqrt(l2); best = { k, t, d2, s: ((u - a[0]) * ey - (v - a[1]) * ex) / l }; }   // (right of a→b is out)
    }
    return best;
  };
  const vNorm = (k) => {                                            // the outward normal at path corner k (mean of its two segments)
    const n = path.length, a = path[(k - 1 + n) % n], b = path[k], q = path[(k + 1) % n];
    const s1 = norm([b[1] - a[1], -(b[0] - a[0]), 0]), s2 = norm([q[1] - b[1], -(q[0] - b[0]), 0]);
    return norm([s1[0] + s2[0], s1[1] + s2[1], 0]);
  };
  for (let pass = 0; pass < (opts.fitPasses ?? 2); pass++) {
    const n = path.length, out = new Float64Array(n).fill(NaN);
    for (let i = 0; i < nv; i++) {
      const r = nearest(U[i], V[i]); const k = r.t < 0.5 ? r.k : (r.k + 1) % n;
      if (r.s > -2 * plan.cell && !(out[k] >= r.s)) out[k] = r.s;
    }
    // corners with nothing beside them follow their neighbours
    const have = [...out.keys()].filter(k => !Number.isNaN(out[k]));
    if (!have.length) break;
    for (let k = 0; k < n; k++) if (Number.isNaN(out[k])) {
      let a = k, b = k, da = 0, db = 0;
      do { a = (a - 1 + n) % n; da++; } while (Number.isNaN(out[a]));
      do { b = (b + 1) % n; db++; } while (Number.isNaN(out[b]));
      out[k] = (out[a] * db + out[b] * da) / (da + db);
    }
    const moved = path.map((p, k) => { const m = vNorm(k); return [p[0] + m[0] * out[k], p[1] + m[1] * out[k]]; });
    path = moved;
  }
  // 3. the cross-section: (z, d) of every point, d in from the back
  const D = new Float64Array(nv);
  let dMax = 0;
  for (let i = 0; i < nv; i++) { D[i] = -nearest(U[i], V[i]).s; if (D[i] > dMax) dMax = D[i]; }
  const span = zMax - zMin;
  if (!(dMax > 0) || !(span > 0)) return { ok: false, why: 'the band has no thickness' };
  let len = 0; for (let k = 0; k < path.length; k++) { const a = path[k], b = path[(k + 1) % path.length]; len += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  if (dMax > 0.25 * len / (2 * Math.PI) * 2) return { ok: false, why: 'it is too thick for its length to be a belt' };
  const sec = rasterLoops(tri2(Zc, D), { cells: opts.cells || 700, gap: 2 });
  const cell = sec.cell, eps = cell * 1e-3;
  let prof = sec.loops.map(L => dp(clean(L, eps, false), cell * 1.5)).filter(L => L.length >= 3 && Math.abs(area2(L)) > cell * cell * 4);
  if (!prof.length) return { ok: false, why: 'its cross-section came out empty' };
  // (the cross-section is in (z, d): z plays the part of h, d of r; d may dip a hair below 0 at the back)
  const W = opts.width ?? 0.25 * span;
  let grooves = 0;
  const lift = Math.max(0, -Math.min(...prof.flat().map(p => p[1]))) + cell;      // fillGrooves and clean() want r ≥ 0
  prof = prof.map(L => L.map(p => [p[0], p[1] + lift]));
  if (W > 0) { const f = fillGrooves(prof, W, eps); if (!f.why) { prof = f.loops; grooves = f.grooves; } }
  prof = prof.map(L => simplifyLoop(clean(L, eps), cell * 1.5)).filter(L => L.length >= 3).map(L => L.map(p => [p[0], p[1] - lift]));
  // the sweep follows a plainer copy of the path: a corner only where it bends more than opts.pathTol (default a thousandth of
  // the belt's size) away from a straight line; the cross-section was measured on the full one
  const planSize = Math.hypot(uMax - uMin, vMax - vMin);
  const run = dp(path, opts.pathTol ?? planSize * 1e-3);
  const sweep = { path: run, c, e1, e2, Z };
  const result = { ok: true, mode: 'belt', axis: Z, center: c, segments: run.length, width: W, cell, grooves, profileAfter: prof, sweep, pathLength: len, before: { triangles: I.length / 3 } };
  if (opts.dryRun) return result;
  const g = sweepLoops(prof, sweep, opts.smoothDeg ?? 30);
  return { ...result, after: { triangles: g.index.length / 3 }, positions: g.positions, normals: g.normals, index: g.index };
}

// Sweep cross-section loops (z, d) along a closed path (counter-clockwise in the plane, d measured inwards from it).
export function sweepLoops(loops, sw, smoothDeg = 30) {
  const { path, c, e1, e2, Z } = sw, M = path.length;
  const cosS = Math.cos(smoothDeg * Math.PI / 180);
  // at each corner of the path: the inward normal, lengthened so the band keeps its thickness round the corner (a mitre)
  const inN = [], miter = [];
  for (let i = 0; i < M; i++) {
    const a = path[(i - 1 + M) % M], b = path[i], q = path[(i + 1) % M];
    const s1 = norm([-(b[1] - a[1]), b[0] - a[0], 0]), s2 = norm([-(q[1] - b[1]), q[0] - b[0], 0]);
    const nn = norm([s1[0] + s2[0], s1[1] + s2[1], 0]);
    inN.push(nn); miter.push(1 / Math.max(0.5, nn[0] * s1[0] + nn[1] * s1[1]));
  }
  const P3 = (i, z, d) => { const u = path[i][0] + inN[i][0] * d * miter[i], v = path[i][1] + inN[i][1] * d * miter[i]; return [c[0] + u * e1[0] + v * e2[0] + z * Z[0], c[1] + u * e1[1] + v * e2[1] + z * Z[1], c[2] + u * e1[2] + v * e2[2] + z * Z[2]]; };
  const N3 = (i, nz, nd) => { const nu = inN[i][0] * nd, nvv = inN[i][1] * nd; return norm([nu * e1[0] + nvv * e2[0] + nz * Z[0], nu * e1[1] + nvv * e2[1] + nz * Z[1], nu * e1[2] + nvv * e2[2] + nz * Z[2]]); };
  const pos = [], nor = [], idx = [];
  for (const L of loops) {
    const n = L.length;
    const en = L.map((p, k) => { const q = L[(k + 1) % n], dz = q[0] - p[0], dd = q[1] - p[1], l = Math.hypot(dz, dd) || 1; return [dd / l, -dz / l]; });
    for (let k = 0; k < n; k++) {
      const p = L[k], q = L[(k + 1) % n];
      const nP = (() => { const o = en[(k - 1 + n) % n], m = en[k]; return o[0] * m[0] + o[1] * m[1] > cosS ? norm([o[0] + m[0], o[1] + m[1], 0]) : m; })();
      const nQ = (() => { const o = en[(k + 1) % n], m = en[k]; return o[0] * m[0] + o[1] * m[1] > cosS ? norm([o[0] + m[0], o[1] + m[1], 0]) : m; })();
      const base = pos.length / 3;
      for (let s = 0; s <= M; s++) {
        const i = s % M;
        pos.push(...P3(i, p[0], p[1]), ...P3(i, q[0], q[1]));
        nor.push(...N3(i, nP[0], nP[1]), ...N3(i, nQ[0], nQ[1]));
      }
      for (let s = 0; s < M; s++) { const p0 = base + 2 * s, q0 = p0 + 1, p1 = p0 + 2, q1 = p0 + 3; idx.push(p0, q0, p1, q0, q1, p1); }
    }
  }
  const positions = new Float32Array(pos), normals = new Float32Array(nor), index = new Uint32Array(idx);
  // the winding, once, by volume (and the normals with it when inside out)
  let vol = 0;
  for (let t = 0; t < index.length; t += 3) {
    const A = index[t] * 3, B = index[t + 1] * 3, C = index[t + 2] * 3;
    vol += dot([positions[A] - c[0], positions[A + 1] - c[1], positions[A + 2] - c[2]], cross([positions[B] - c[0], positions[B + 1] - c[1], positions[B + 2] - c[2]], [positions[C] - c[0], positions[C + 1] - c[1], positions[C + 2] - c[2]]));
  }
  if (vol < 0) for (let t = 0; t < index.length; t += 3) { const x = index[t + 1]; index[t + 1] = index[t + 2]; index[t + 2] = x; }
  // normals that point inwards (a profile traced the other way round) are turned over
  let agree = 0;
  for (let t = 0; t < index.length; t += 3) {
    const A = index[t] * 3, B = index[t + 1] * 3, C = index[t + 2] * 3;
    const fn = cross([positions[B] - positions[A], positions[B + 1] - positions[A + 1], positions[B + 2] - positions[A + 2]], [positions[C] - positions[A], positions[C + 1] - positions[A + 1], positions[C + 2] - positions[A + 2]]);
    agree += dot(fn, [normals[A], normals[A + 1], normals[A + 2]]);
  }
  if (agree < 0) for (let i = 0; i < normals.length; i++) normals[i] = -normals[i];
  return { positions, normals, index };
}

// Fill 2D triangles (6 numbers each) on a grid, seal gaps of `gap` cells, flood the outside in from all four sides and trace what is
// left: loops with the filled side on the left. Returns { loops, cell }.
function rasterLoops(tris, { cells = 900, gap = 2, holes = false } = {}) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < tris.length; i += 2) { x0 = Math.min(x0, tris[i]); x1 = Math.max(x1, tris[i]); y0 = Math.min(y0, tris[i + 1]); y1 = Math.max(y1, tris[i + 1]); }
  const cell = Math.max(x1 - x0, y1 - y0) / cells;
  if (!(cell > 0)) return { loops: [], cell: 0 };
  const pad = gap + 3, gx = x0 - pad * cell, gy = y0 - pad * cell;
  const NX = Math.ceil((x1 - x0) / cell) + 2 * pad + 1, NY = Math.ceil((y1 - y0) / cell) + 2 * pad + 1;
  const grid = new Uint8Array(NX * NY);
  const mark = (x, y) => { const i = Math.floor((x - gx) / cell), j = Math.floor((y - gy) / cell); if (i >= 0 && i < NX && j >= 0 && j < NY) grid[j * NX + i] = 1; };
  const seg = (ax, ay, bx, by) => { const n = Math.ceil(Math.hypot(bx - ax, by - ay) / (cell * 0.5)); for (let s = 0; s <= n; s++) mark(ax + (bx - ax) * s / n, ay + (by - ay) * s / n); };
  for (let t = 0; t < tris.length; t += 6) {
    const ax = tris[t], ay = tris[t + 1], bx = tris[t + 2], by = tris[t + 3], cx = tris[t + 4], cy = tris[t + 5];
    seg(ax, ay, bx, by); seg(bx, by, cx, cy); seg(cx, cy, ax, ay);
    const d = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(d) < 1e-20) continue;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - gx) / cell)), i1 = Math.min(NX - 1, Math.floor((Math.max(ax, bx, cx) - gx) / cell));
    const j0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - gy) / cell)), j1 = Math.min(NY - 1, Math.floor((Math.max(ay, by, cy) - gy) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = gx + (i + 0.5) * cell, y = gy + (j + 0.5) * cell;
      const w0 = ((bx - x) * (cy - y) - (by - y) * (cx - x)) / d, w1 = ((cx - x) * (ay - y) - (cy - y) * (ax - x)) / d;
      if (w0 >= 0 && w1 >= 0 && w0 + w1 <= 1) grid[j * NX + i] = 1;
    }
  }
  const grow = (src, k) => {
    let cur = src;
    for (let s = 0; s < k; s++) {
      const nx = cur.slice();
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
        if (cur[j * NX + i]) continue;
        for (let dj = -1, hit = 0; dj <= 1 && !hit; dj++) for (let di = -1; di <= 1; di++) {
          const ii = i + di, jj = j + dj;
          if (ii >= 0 && ii < NX && jj >= 0 && jj < NY && cur[jj * NX + ii]) { nx[j * NX + i] = 1; hit = 1; break; }
        }
      }
      cur = nx;
    }
    return cur;
  };
  const wall = grow(grid, gap), out = new Uint8Array(NX * NY), q = [];
  const seed = (i, j) => { const k = j * NX + i; if (!wall[k] && !out[k]) { out[k] = 1; q.push(k); } };
  for (let j = 0; j < NY; j++) { seed(0, j); seed(NX - 1, j); }
  for (let i = 0; i < NX; i++) { seed(i, 0); seed(i, NY - 1); }
  while (q.length) { const k = q.pop(), i = k % NX, j = (k - i) / NX; if (i > 0) seed(i - 1, j); if (i < NX - 1) seed(i + 1, j); if (j > 0) seed(i, j - 1); if (j < NY - 1) seed(i, j + 1); }
  const outside = grow(out, gap);
  // holes: true — an empty room the outer flood could not reach (the opening in a band, seen from above) is outside as well,
  // grown back the same way. Off for a cross-section, whose inside is empty because its surfaces only draw its outline.
  const hole = new Uint8Array(NX * NY);
  if (holes) for (let k = 0; k < hole.length; k++) if (!wall[k] && !out[k] && !hole[k]) {
    const st = [k]; hole[k] = 1;
    while (st.length) { const m = st.pop(), i = m % NX, j = (m - i) / NX;
      for (const [ii, jj] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) if (ii >= 0 && ii < NX && jj >= 0 && jj < NY) { const kk = jj * NX + ii; if (!wall[kk] && !out[kk] && !hole[kk]) { hole[kk] = 1; st.push(kk); } } }
  }
  const holeG = holes ? grow(hole, gap) : hole;
  const S = (i, j) => i >= 0 && i < NX && j >= 0 && j < NY && !outside[j * NX + i] && !holeG[j * NX + i];
  const edges = new Map();
  const add = (a0, b0, a1, b1) => { const k = a0 + ',' + b0; if (!edges.has(k)) edges.set(k, []); edges.get(k).push([a1, b1]); };
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    if (!S(i, j)) continue;
    if (!S(i, j - 1)) add(i, j, i + 1, j);
    if (!S(i, j + 1)) add(i + 1, j + 1, i, j + 1);
    if (!S(i - 1, j)) add(i, j + 1, i, j);
    if (!S(i + 1, j)) add(i + 1, j, i + 1, j + 1);
  }
  const loops = [];
  for (const [k0] of edges) {
    while (edges.get(k0) && edges.get(k0).length) {
      const [sx, sy] = k0.split(',').map(Number), L = [[sx, sy]];
      let px = sx, py = sy, dx = 0, dy = 0;
      for (let guard = 0; guard < 4 * NX * NY; guard++) {
        const list = edges.get(px + ',' + py);
        if (!list || !list.length) break;
        let bi = 0;
        if (list.length > 1) { let best = -Infinity; list.forEach(([x, y], n) => { const ex = x - px, ey = y - py, sc = (dx * ey - dy * ex) * 2 + (dx * ex + dy * ey); if (sc > best) { best = sc; bi = n; } }); }
        const [nx, ny] = list.splice(bi, 1)[0];
        dx = nx - px; dy = ny - py; px = nx; py = ny;
        if (px === sx && py === sy) break;
        L.push([px, py]);
      }
      if (L.length >= 4) loops.push(L.map(([x, y]) => [gx + x * cell, gy + y * cell]));
    }
  }
  return { loops, cell };
}
