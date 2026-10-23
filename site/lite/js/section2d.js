// section2d.js — work on a cross-section in its own plane (loops of [x, y], outlines counter-clockwise, chambers clockwise, material
// on the left), for Profile: clean outline (profile.js):
//
//   regionBoundary  the outline of where a set of loops winds at least k times: k = 1 joins them (a union), k = 2 keeps where two
//                   overlap (an intersection). Loops that cross themselves are taken apart the same way.
//   offsetLoops     the section grown (or shrunk, d < 0) by d: walls thicker, chambers smaller, two outlines that come within 2d join.
//   roundCorners    every corner of a loop rounded with radius r (less where the edges beside it are short).
//   findMirror      the line the section is (nearly) symmetric about, and how far it is from symmetric.
//   makeSymmetric   one half of the section mirrored onto the other, so it is exact.
//   matchSection    the move (turn, and mirror) that lays one section on another, or null when they are not the same shape.
//   groupShapes     loops to [{ outer, holes }]: each chamber with the smallest outline round it.
//
// Nothing here touches three.js or the page.

const cross2 = (ax, ay, bx, by) => ax * by - ay * bx;
export const area2 = l => { let s = 0; for (let i = 0; i < l.length; i++) { const p = l[i], q = l[(i + 1) % l.length]; s += p[0] * q[1] - q[0] * p[1]; } return s / 2; };
export const inside = (p, L) => {
  let c = false;
  for (let i = 0, j = L.length - 1; i < L.length; j = i++) {
    const a = L[i], b = L[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
};
// The farthest any point of profile B is from profile A.
export function profileDistance(A, B) {
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
// how many times the loops wind round p (counter-clockwise counts +1)
function winding(p, loops) {
  let w = 0;
  for (const L of loops) for (let i = 0, n = L.length; i < n; i++) {
    const a = L[i], b = L[(i + 1) % n];
    if (a[1] <= p[1]) { if (b[1] > p[1] && cross2(b[0] - a[0], b[1] - a[1], p[0] - a[0], p[1] - a[1]) > 0) w++; }
    else if (b[1] <= p[1] && cross2(b[0] - a[0], b[1] - a[1], p[0] - a[0], p[1] - a[1]) < 0) w--;
  }
  return w;
}
// Drop points closer than eps and points on a straight line.
export function tidy(l, eps) {
  let pts = l;
  for (let pass = 0; pass < 3; pass++) {
    const out = [];
    for (const p of pts) { const q = out[out.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > eps) out.push(p); }
    while (out.length > 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= eps) out.pop();
    pts = [];
    for (let i = 0; i < out.length; i++) {
      const a = out[(i - 1 + out.length) % out.length], b = out[i], c = out[(i + 1) % out.length];
      const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1];
      if (Math.abs(cross2(ux, uy, vx, vy)) / (Math.hypot(ux, uy) * Math.hypot(vx, vy)) < 1e-6 && ux * vx + uy * vy > 0) continue;
      pts.push(b);
    }
  }
  return pts;
}

// ── where the loops wind at least k times ───────────────────────────────────
// Every edge is cut where it meets another (or runs along it); a piece is kept when the loops wind at least k times just to its left
// and less than k just to its right, and the pieces are chained into loops again (at a point where several go on, the one turning
// most to the left: two pieces that touch at a corner stay two loops). eps: points this close are one.
export function regionBoundary(loops, k, eps) {
  const E = [];
  for (const L of loops) for (let i = 0; i < L.length; i++) {
    const a = L[i], b = L[(i + 1) % L.length];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) > eps * 1e-3) E.push({ a, b, ts: [0, 1], x0: Math.min(a[0], b[0]) - eps, x1: Math.max(a[0], b[0]) + eps, y0: Math.min(a[1], b[1]) - eps, y1: Math.max(a[1], b[1]) + eps });
  }
  for (let i = 0; i < E.length; i++) {
    const A = E[i], rx = A.b[0] - A.a[0], ry = A.b[1] - A.a[1], rl = Math.hypot(rx, ry);
    for (let j = i + 1; j < E.length; j++) {
      const B = E[j];
      if (B.x0 > A.x1 || B.x1 < A.x0 || B.y0 > A.y1 || B.y1 < A.y0) continue;
      const sx = B.b[0] - B.a[0], sy = B.b[1] - B.a[1], sl = Math.hypot(sx, sy);
      const den = cross2(rx, ry, sx, sy), qx = B.a[0] - A.a[0], qy = B.a[1] - A.a[1];
      if (Math.abs(den) > 1e-12 * rl * sl) {
        const t = cross2(qx, qy, sx, sy) / den, u = cross2(qx, qy, rx, ry) / den, et = eps / rl, eu = eps / sl;
        if (t < -et || t > 1 + et || u < -eu || u > 1 + eu) continue;
        A.ts.push(Math.max(0, Math.min(1, t))); B.ts.push(Math.max(0, Math.min(1, u)));
      } else if (Math.abs(cross2(rx, ry, qx, qy)) / rl <= eps) {          // along the same line: each is cut where the other ends
        const r2 = rl * rl, s2 = sl * sl;
        for (const p of [B.a, B.b]) { const t = ((p[0] - A.a[0]) * rx + (p[1] - A.a[1]) * ry) / r2; if (t > 0 && t < 1) A.ts.push(t); }
        for (const p of [A.a, A.b]) { const u = ((p[0] - B.a[0]) * sx + (p[1] - B.a[1]) * sy) / s2; if (u > 0 && u < 1) B.ts.push(u); }
      }
    }
  }
  // the points: the same place reached twice is one point
  const pts = [], grid = new Map(), cell = eps * 2;
  const pid = (p) => {
    const gx = Math.floor(p[0] / cell), gy = Math.floor(p[1] / cell);
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) for (const id of grid.get((gx + ox) + ',' + (gy + oy)) || []) {
      if (Math.abs(pts[id][0] - p[0]) <= eps && Math.abs(pts[id][1] - p[1]) <= eps) return id;
    }
    const id = pts.length; pts.push(p); const g = gx + ',' + gy; if (!grid.has(g)) grid.set(g, []); grid.get(g).push(id);
    return id;
  };
  const keep = new Map(), d = eps * 8;
  for (const e of E) {
    const ts = e.ts.sort((x, y) => x - y), at = t => [e.a[0] + t * (e.b[0] - e.a[0]), e.a[1] + t * (e.b[1] - e.a[1])];
    let prev = pid(at(ts[0])), pt = ts[0];
    for (let m = 1; m < ts.length; m++) {
      const id = pid(at(ts[m])); if (id === prev) continue;
      const P = pts[prev], Q = pts[id], dx = Q[0] - P[0], dy = Q[1] - P[1], l = Math.hypot(dx, dy) || 1;
      const mid = at((pt + ts[m]) / 2), nx = -dy / l * d, ny = dx / l * d;
      const wl = winding([mid[0] + nx, mid[1] + ny], loops), wr = winding([mid[0] - nx, mid[1] - ny], loops);
      if (wl >= k && wr < k) keep.set(prev + '>' + id, [prev, id]);
      else if (wr >= k && wl < k) keep.set(id + '>' + prev, [id, prev]);
      prev = id; pt = ts[m];
    }
  }
  const from = new Map();
  for (const [key, [a]] of keep) { if (!from.has(a)) from.set(a, []); from.get(a).push(key); }
  const used = new Set(), out = [];
  for (const [key0, [s0]] of keep) {
    if (used.has(key0)) continue;
    const ids = []; let key = key0, closed = false;
    for (let guard = 0; guard <= keep.size; guard++) {
      used.add(key); const [a, b] = keep.get(key); ids.push(a);
      if (b === s0) { closed = true; break; }
      const nexts = (from.get(b) || []).filter(x => !used.has(x)); if (!nexts.length) break;
      const P = pts[a], Q = pts[b], ux = Q[0] - P[0], uy = Q[1] - P[1];
      let best = null, bestAng = -Infinity;
      for (const x of nexts) { const R = pts[keep.get(x)[1]], vx = R[0] - Q[0], vy = R[1] - Q[1], ang = Math.atan2(cross2(ux, uy, vx, vy), ux * vx + uy * vy); if (ang > bestAng) { bestAng = ang; best = x; } }
      key = best;
    }
    if (!closed) continue;
    const L = tidy(ids.map(i => pts[i]), eps);
    if (L.length >= 3 && Math.abs(area2(L)) > eps * eps) out.push(L);
  }
  return out;
}

// loops → [{ outer, holes }]: an outline is a shape, each chamber goes with the smallest outline round it
export function groupShapes(loops) {
  const outs = loops.filter(L => area2(L) > 0).map(L => ({ outer: L, holes: [], a: area2(L) }));
  for (const H of loops.filter(L => area2(L) < 0)) {
    let host = null; for (const S of outs) if (inside(H[0], S.outer) && (!host || S.a < host.a)) host = S;
    if (host) host.holes.push(H);
  }
  return outs.map(S => ({ outer: S.outer, holes: S.holes }));
}

// ── grow or shrink ──────────────────────────────────────────────────────────
// Each edge moved out by d (to its right: away from the material), corners that open up mitred (cut off where the mitre would be
// longer than four times d), corners that close joined through the old corner; the loops that this makes cross themselves are
// then taken apart by where they wind, as Clipper does.
export function offsetLoops(loops, d, eps) {
  if (!d) return loops;
  const raw = loops.map(L => {
    const out = [], n = L.length;
    for (let i = 0; i < n; i++) {
      const p = L[(i - 1 + n) % n], v = L[i], q = L[(i + 1) % n];
      let ux = v[0] - p[0], uy = v[1] - p[1], wx = q[0] - v[0], wy = q[1] - v[1];
      const lu = Math.hypot(ux, uy), lw = Math.hypot(wx, wy); if (!(lu > 0 && lw > 0)) continue;
      ux /= lu; uy /= lu; wx /= lw; wy /= lw;
      const n1 = [uy, -ux], n2 = [wy, -wx], c = cross2(ux, uy, wx, wy), dt = ux * wx + uy * wy;
      if (Math.abs(c) < 1e-9 && dt > 0) { out.push([v[0] + n1[0] * d, v[1] + n1[1] * d]); continue; }
      if (c * d > 0) {
        const kk = 1 + n1[0] * n2[0] + n1[1] * n2[1];
        if (kk > 2 / 16) out.push([v[0] + (n1[0] + n2[0]) * d / kk, v[1] + (n1[1] + n2[1]) * d / kk]);
        else out.push([v[0] + n1[0] * d, v[1] + n1[1] * d], [v[0] + n2[0] * d, v[1] + n2[1] * d]);
      } else out.push([v[0] + n1[0] * d, v[1] + n1[1] * d], [v[0], v[1]], [v[0] + n2[0] * d, v[1] + n2[1] * d]);
    }
    return out;
  });
  return regionBoundary(raw, 1, eps);
}

// ── round the corners ───────────────────────────────────────────────────────
// Each corner that turns more than minDeg gets an arc of radius r touching both edges; where the edges beside it are short the
// arc is smaller (it may take at most half of each), so neighbouring arcs never overlap. tol: how far the arc's chords may be from
// the true arc. Outlines and chambers alike (the arc's middle is on the inside of the turn).
export function roundCorners(L, r, tol, minDeg = 20) {
  if (!(r > 0) || L.length < 3) return L;
  const n = L.length, out = [], len = [];
  for (let i = 0; i < n; i++) { const a = L[i], b = L[(i + 1) % n]; len.push(Math.hypot(b[0] - a[0], b[1] - a[1])); }
  for (let i = 0; i < n; i++) {
    const p = L[(i - 1 + n) % n], v = L[i], q = L[(i + 1) % n], lin = len[(i - 1 + n) % n], lout = len[i];
    if (!(lin > 0 && lout > 0)) { out.push(v); continue; }
    const ux = (v[0] - p[0]) / lin, uy = (v[1] - p[1]) / lin, wx = (q[0] - v[0]) / lout, wy = (q[1] - v[1]) / lout;
    const c = cross2(ux, uy, wx, wy), phi = Math.atan2(Math.abs(c), ux * wx + uy * wy);
    if (phi < minDeg * Math.PI / 180 || phi > Math.PI - 1e-3) { out.push(v); continue; }
    const tn = Math.tan(phi / 2);
    let t = r * tn; t = Math.min(t, 0.5 * lin, 0.5 * lout);
    const rr = t / tn; if (!(rr > 0)) { out.push(v); continue; }
    const A = [v[0] - ux * t, v[1] - uy * t], side = c > 0 ? 1 : -1, C = [A[0] - side * uy * rr, A[1] + side * ux * rr];
    const stepMax = Math.max(5, Math.min(22.5, 2 * Math.acos(Math.max(-1, 1 - (tol > 0 ? tol : rr * 0.01) / rr)) * 180 / Math.PI)) * Math.PI / 180;
    const segs = Math.max(2, Math.ceil(phi / stepMax)), a0 = Math.atan2(A[1] - C[1], A[0] - C[0]);
    for (let s = 0; s <= segs; s++) { const an = a0 + side * phi * s / segs; out.push([C[0] + rr * Math.cos(an), C[1] + rr * Math.sin(an)]); }
  }
  // (two arcs that each take half of the edge between them meet in one point)
  let big = 0; for (const l of len) big = Math.max(big, l);
  return out.filter((p, i) => { const q = out[(i + 1) % out.length]; return Math.hypot(p[0] - q[0], p[1] - q[1]) > big * 1e-9; });
}

// ── symmetry ────────────────────────────────────────────────────────────────
const mirrorLoops = (loops, c, dir) => loops.map(L => L.map(p => {
  const x = p[0] - c[0], y = p[1] - c[1], t = x * dir[0] + y * dir[1];
  return [c[0] + 2 * t * dir[0] - x, c[1] + 2 * t * dir[1] - y];
}).reverse());
// The line (a point c on it, its direction dir) the loops come nearest to being mirrored about, and how far off they are (off: the
// farthest a point of the mirrored section is from the section). Tried: the two main directions of the section (its least and most
// bending stiffness) and the two of its frame, through its middle and through the middle of its box.
export function findMirror(loops) {
  let A = 0, cx = 0, cy = 0;
  for (const L of loops) for (let i = 0; i < L.length; i++) { const p = L[i], q = L[(i + 1) % L.length], c = p[0] * q[1] - q[0] * p[1]; A += c; cx += (p[0] + q[0]) * c; cy += (p[1] + q[1]) * c; }
  if (!(Math.abs(A) > 0)) return null;
  cx /= 3 * A; cy /= 3 * A;
  let ixx = 0, iyy = 0, ixy = 0;
  for (const L of loops) for (let i = 0; i < L.length; i++) {
    const p = [L[i][0] - cx, L[i][1] - cy], q = [L[(i + 1) % L.length][0] - cx, L[(i + 1) % L.length][1] - cy], c = p[0] * q[1] - q[0] * p[1];
    ixx += (p[1] * p[1] + p[1] * q[1] + q[1] * q[1]) * c; iyy += (p[0] * p[0] + p[0] * q[0] + q[0] * q[0]) * c; ixy += (p[0] * q[1] + 2 * p[0] * p[1] + 2 * q[0] * q[1] + q[0] * p[1]) * c;
  }
  const th = 0.5 * Math.atan2(ixy, iyy - ixx);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const L of loops) for (const p of L) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  let best = null;
  for (const an of [th, th + Math.PI / 2, 0, Math.PI / 2]) {
    const dir = [Math.cos(an), Math.sin(an)];
    for (const c of [[cx, cy], [(x0 + x1) / 2, (y0 + y1) / 2]]) {
      const m = mirrorLoops(loops, c, dir), off = Math.max(profileDistance(loops, m), profileDistance(m, loops));
      if (!best || off < best.off - 1e-12) best = { c, dir, off };
    }
  }
  return best;
}
// The half on the side with more material, mirrored onto the other: an exact mirror image about the line. Worked in the line's own
// frame, where the line is x = 0, so the points on it are exactly on it in both halves.
export function makeSymmetric(loops, mir, eps) {
  const { c, dir } = mir, nx = -dir[1], ny = dir[0];                  // x along the normal, y along −dir (a turn, not a mirror)
  const to = p => [(p[0] - c[0]) * nx + (p[1] - c[1]) * ny, -((p[0] - c[0]) * dir[0] + (p[1] - c[1]) * dir[1])];
  const back = p => [c[0] + p[0] * nx - p[1] * dir[0], c[1] + p[0] * ny - p[1] * dir[1]];
  let loc = loops.map(L => L.map(to));
  let R = 0; for (const L of loc) for (const p of L) R = Math.max(R, Math.abs(p[0]), Math.abs(p[1]));
  R = R * 2 + 1;
  const half = (src) => regionBoundary([...src, [[0, -R], [R, -R], [R, R], [0, R]]], 2, eps);
  const flip = (ls) => ls.map(L => L.map(p => [-p[0], p[1]]).reverse());
  let h = half(loc);
  const hb = half(flip(loc));
  const net = ls => ls.reduce((s, L) => s + area2(L), 0);
  if (net(hb) > net(h)) h = hb;
  h = h.map(L => L.map(p => (Math.abs(p[0]) <= eps ? [0, p[1]] : p)));
  const sym = regionBoundary([...h, ...flip(h)], 1, eps);
  return sym.map(L => L.map(back));
}

// ── the same section in another part ────────────────────────────────────────
// The move from section A to section B (each a list of loops in its own frame): turned about the middle, perhaps mirrored, and moved
// middle to middle. Tried at the turns that lay the main directions on each other (and quarter turns from them). Returns
// { apply(p), mirrored, off } when every point of each lands within tol of the other, else null.
function middleOf(loops) {
  let A = 0, cx = 0, cy = 0;
  for (const L of loops) for (let i = 0; i < L.length; i++) { const p = L[i], q = L[(i + 1) % L.length], c = p[0] * q[1] - q[0] * p[1]; A += c; cx += (p[0] + q[0]) * c; cy += (p[1] + q[1]) * c; }
  if (!(Math.abs(A) > 0)) return null;
  cx /= 3 * A; cy /= 3 * A;
  let ixx = 0, iyy = 0, ixy = 0;
  for (const L of loops) for (let i = 0; i < L.length; i++) {
    const p = [L[i][0] - cx, L[i][1] - cy], q = [L[(i + 1) % L.length][0] - cx, L[(i + 1) % L.length][1] - cy], c = p[0] * q[1] - q[0] * p[1];
    ixx += (p[1] * p[1] + p[1] * q[1] + q[1] * q[1]) * c; iyy += (p[0] * p[0] + p[0] * q[0] + q[0] * q[0]) * c; ixy += (p[0] * q[1] + 2 * p[0] * p[1] + 2 * q[0] * q[1] + q[0] * p[1]) * c;
  }
  return { c: [cx, cy], th: 0.5 * Math.atan2(ixy, iyy - ixx), area: A / 2 };
}
export function matchSection(A, B, tol) {
  const ma = middleOf(A), mb = middleOf(B);
  if (!ma || !mb || Math.abs(Math.abs(ma.area) - Math.abs(mb.area)) > 0.05 * Math.abs(mb.area)) return null;
  let best = null;
  for (const mirrored of [false, true]) {
    const tha = mirrored ? -ma.th : ma.th;
    for (const base of [mb.th - tha, 0]) for (let k = 0; k < 4; k++) {
      const an = base + k * Math.PI / 2, cs = Math.cos(an), sn = Math.sin(an);
      const apply = (p) => { const x = p[0] - ma.c[0], y = mirrored ? -(p[1] - ma.c[1]) : p[1] - ma.c[1]; return [mb.c[0] + cs * x - sn * y, mb.c[1] + sn * x + cs * y]; };
      const moved = A.map(L => L.map(apply)), off = Math.max(profileDistance(B, moved), profileDistance(moved, B));
      if (off <= tol && (!best || off < best.off)) best = { apply, mirrored, off };
    }
  }
  return best;
}
// shapes ([{ outer, holes }]) moved by a match: a mirrored move turns every loop the other way, so each is reversed back
export const moveShapes = (shapes, m) => shapes.map(S => {
  const mv = L => { const o = L.map(m.apply); return m.mirrored ? o.reverse() : o; };
  return { outer: mv(S.outer), holes: (S.holes || []).map(mv) };
});
