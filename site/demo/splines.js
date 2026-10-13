// splines.js — splines and the shapes made from them (Sweep, Extrude, Lathe, Loft).
//
// Pure maths on plain arrays: no three.js, no DOM, so it runs in the page, in a
// worker and in node (tests/splines.test.mjs).
//
// A spline is   { type, closed, points: [{ p:[x,y,z], tIn?:[x,y,z], tOut?:[x,y,z] }] }
//   type 'linear'   straight pieces between the points
//   type 'cubic'    a smooth curve through the points (cardinal spline; `tension` 0 is Catmull-Rom, 1 is straight)
//   type 'bspline'  a smooth curve pulled towards the points (uniform cubic B-spline,
//                   clamped: it starts and ends on the first and last point)
//   type 'bezier'   a curve through the points with handles: `tOut` leaves a point,
//                   `tIn` arrives at it, both as offsets from the point (as in C4D)
// Every curved type is turned into Bezier pieces first, then sampled.
//
// A sweep carries a flat profile along a path. The profile's frame is moved
// along the path by parallel transport (the double-reflection method), so it
// never flips or spins the way a Frenet frame does; on a closed path the left
// over twist is spread along the path so the end meets the start.
//
// Everything that builds a mesh returns { positions: Float32Array, index: Uint32Array }
// with outward-facing triangles for a closed solid.

const V = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]); return l > 1e-30 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]; },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
};

// ── Splines → polylines ─────────────────────────────────────────────────────

// The Bezier pieces of a spline: [[p0, c1, c2, p3], ...] (a straight piece for 'linear').
export function bezierPieces(spline) {
  const pts = spline.points.map(q => q.p);
  const n = pts.length, closed = !!spline.closed;
  const out = [];
  if (n < 2) return out;
  const at = (i) => closed ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))];
  const pieces = closed ? n : n - 1;
  const type = spline.type || 'linear';
  if (type === 'linear') {
    for (let i = 0; i < pieces; i++) { const a = at(i), b = at(i + 1); out.push([a, V.lerp(a, b, 1 / 3), V.lerp(a, b, 2 / 3), b, true]); }
  } else if (type === 'bezier') {
    for (let i = 0; i < pieces; i++) {
      const A = spline.points[i % n], B = spline.points[(i + 1) % n];
      out.push([A.p, V.add(A.p, A.tOut || [0, 0, 0]), V.add(B.p, B.tIn || [0, 0, 0]), B.p]);
    }
  } else if (type === 'cubic') {
    const k = (1 - (spline.tension == null ? 0 : spline.tension)) / 2;         // cardinal: tension 0 is Catmull-Rom, 1 is straight
    const slope = (i) => {
      // an open curve's end points look at their one neighbour
      if (!closed && i === 0) return V.mul(V.sub(at(1), at(0)), 2 * k);
      if (!closed && i === n - 1) return V.mul(V.sub(at(n - 1), at(n - 2)), 2 * k);
      return V.mul(V.sub(at(i + 1), at(i - 1)), k);
    };
    for (let i = 0; i < pieces; i++) {
      const a = at(i), b = at(i + 1);
      out.push([a, V.add(a, V.mul(slope(i), 1 / 3)), V.sub(b, V.mul(slope((i + 1) % n === 0 && closed ? 0 : i + 1), 1 / 3)), b]);
    }
  } else if (type === 'bspline') {
    // control points padded so an open curve starts and ends on its end points
    const ctrl = closed ? pts.slice() : [pts[0], pts[0], ...pts, pts[n - 1], pts[n - 1]];
    const m = ctrl.length;
    const c = (i) => closed ? ctrl[((i % m) + m) % m] : ctrl[i];
    const count = closed ? m : m - 3;
    for (let i = 0; i < count; i++) {
      const A = c(i), B = c(i + 1), C = c(i + 2), D = c(i + 3);
      const p0 = V.mul(V.add(V.add(A, V.mul(B, 4)), C), 1 / 6);
      const p3 = V.mul(V.add(V.add(B, V.mul(C, 4)), D), 1 / 6);
      const c1 = V.mul(V.add(V.mul(B, 2), C), 1 / 3);
      const c2 = V.mul(V.add(B, V.mul(C, 2)), 1 / 3);
      out.push([p0, c1, c2, p3]);
    }
  }
  return out;
}

const bez = (P, t) => {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * P[0][0] + b * P[1][0] + c * P[2][0] + d * P[3][0],
          a * P[0][1] + b * P[1][1] + c * P[2][1] + d * P[3][1],
          a * P[0][2] + b * P[1][2] + c * P[2][2] + d * P[3][2]];
};

// How a spline is turned into the polyline that is drawn and swept (C4D's "Interpolation"):
//   none        only the points of the spline, joined by straight lines
//   natural     `points` points on each piece, evenly in the curve's own parameter
//   uniform     `points` points on each piece, evenly along its length
//   adaptive    as many as the curve needs: a piece is cut until the direction changes by no more than `angle` degrees
//   subdivided  adaptive, and no piece longer than `maxLength`
export const INTERPOLATIONS = ['none', 'natural', 'uniform', 'adaptive', 'subdivided'];
const bezTan = (P, t) => {
  const u = 1 - t, a = 3 * u * u, b = 6 * u * t, c = 3 * t * t;
  return [a * (P[1][0] - P[0][0]) + b * (P[2][0] - P[1][0]) + c * (P[3][0] - P[2][0]),
          a * (P[1][1] - P[0][1]) + b * (P[2][1] - P[1][1]) + c * (P[3][1] - P[2][1]),
          a * (P[1][2] - P[0][2]) + b * (P[2][2] - P[1][2]) + c * (P[3][2] - P[2][2])];
};
const turnBetween = (a, b) => {
  const la = V.len(a), lb = V.len(b);
  if (la < 1e-18 || lb < 1e-18) return 0;
  return Math.acos(Math.max(-1, Math.min(1, V.dot(a, b) / (la * lb))));
};

// The points strictly between t0 and t1 (t0 and t1 themselves are the caller's), in order.
function cutPiece(P, t0, t1, angle, maxLen, depth, out) {
  if (depth > 14) return;
  const tm = (t0 + t1) / 2, a = bez(P, t0), b = bez(P, t1);
  const ta = bezTan(P, t0), tb = bezTan(P, t1), tm_ = bezTan(P, tm);
  const turn = Math.max(turnBetween(ta, tb), turnBetween(ta, tm_), turnBetween(tm_, tb));
  const chord = V.len(V.sub(b, a));
  if (chord < 1e-14) return;
  if (turn > angle || (maxLen > 0 && chord > maxLen)) {
    cutPiece(P, t0, tm, angle, maxLen, depth + 1, out);
    out.push(bez(P, tm));
    cutPiece(P, tm, t1, angle, maxLen, depth + 1, out);
  }
}

// A spline as a polyline. A straight piece (a linear spline, or a straight edge) never gets points between its ends.
// `opts`: mode (see above), points, angle (degrees), maxLength; or just `steps`, which is `natural` with that many.
// A closed spline returns its points without repeating the first at the end.
export function sampleSpline(spline, opts = {}) {
  const mode = opts.mode || 'natural';
  const per = Math.max(1, Math.round(opts.points != null ? opts.points : opts.steps != null ? opts.steps : 12));
  const angle = (opts.angle == null ? 5 : Math.max(0.05, opts.angle)) * Math.PI / 180;
  const maxLen = mode === 'subdivided' ? Math.max(0, opts.maxLength || 0) : 0;
  const pieces = bezierPieces(spline), closed = !!spline.closed;
  const pts = [];
  pieces.forEach((P, i) => {
    const straight = P[4] === true;
    pts.push(P[0]);
    if (!straight && mode !== 'none') {
      if (mode === 'natural') { for (let s = 1; s < per; s++) pts.push(bez(P, s / per)); }
      else if (mode === 'uniform') {
        // evenly along the length: a fine walk along the piece, then the points at equal distances
        const N = 96, run = [0], walk = [P[0]];
        for (let k = 1; k <= N; k++) { const q = bez(P, k / N); walk.push(q); run.push(run[k - 1] + V.len(V.sub(q, walk[k - 1]))); }
        const total = run[N];
        for (let s = 1; s < per; s++) {
          const want = total * s / per;
          let k = 1; while (k < N && run[k] < want) k++;
          const f = run[k] > run[k - 1] ? (want - run[k - 1]) / (run[k] - run[k - 1]) : 0;
          pts.push(V.lerp(walk[k - 1], walk[k], f));
        }
      } else {
        // adaptive / subdivided: cut the piece into as many equal parts as its bending needs (the turn, added up over
        // a coarse walk so an S that bends there and back is not taken for straight), then refine any part that still is too much
        let bend = 0, prevT = bezTan(P, 0);
        for (let k = 1; k <= 8; k++) { const tk = bezTan(P, k / 8); bend += turnBetween(prevT, tk); prevT = tk; }
        const parts = Math.max(4, Math.min(256, Math.ceil(bend / angle)));
        for (let q = 0; q < parts; q++) {
          cutPiece(P, q / parts, (q + 1) / parts, angle, maxLen, 0, pts);
          if (q < parts - 1) pts.push(bez(P, (q + 1) / parts));
        }
      }
    }
    if (!closed && i === pieces.length - 1) pts.push(P[3]);
  });
  return { points: pts, closed };
}

export function polylineLength(points, closed) {
  let L = 0;
  for (let i = 0; i + 1 < points.length; i++) L += V.len(V.sub(points[i + 1], points[i]));
  if (closed && points.length > 1) L += V.len(V.sub(points[0], points[points.length - 1]));
  return L;
}

// ── Frames along a path ─────────────────────────────────────────────────────

// For each point: tangent T, normal N and binormal B (N × B = T), moved along by
// parallel transport. `up` (default the world's Z, else Y) says where the normal
// starts out; `twist` (radians) turns the whole frame about the tangent.
export function pathFrames(points, closed, opts = {}) {
  const n = points.length;
  const T = new Array(n), N = new Array(n), B = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = closed ? points[(i - 1 + n) % n] : points[Math.max(0, i - 1)];
    const b = closed ? points[(i + 1) % n] : points[Math.min(n - 1, i + 1)];
    T[i] = V.norm(V.sub(b, a));
    if (V.len(T[i]) === 0) T[i] = i ? T[i - 1] : [1, 0, 0];
  }
  let up = opts.up && V.len(opts.up) ? V.norm(opts.up) : [0, 0, 1];
  let r0 = V.sub(up, V.mul(T[0], V.dot(up, T[0])));
  if (V.len(r0) < 1e-6) {                              // the path starts along `up`: any other axis will do
    const alt = Math.abs(T[0][0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    r0 = V.sub(alt, V.mul(T[0], V.dot(alt, T[0])));
  }
  N[0] = V.norm(r0);
  for (let i = 0; i + 1 < n; i++) {                    // double reflection
    const v1 = V.sub(points[i + 1], points[i]), c1 = V.dot(v1, v1);
    if (c1 < 1e-30) { N[i + 1] = N[i]; continue; }
    const rL = V.sub(N[i], V.mul(v1, 2 / c1 * V.dot(v1, N[i])));
    const tL = V.sub(T[i], V.mul(v1, 2 / c1 * V.dot(v1, T[i])));
    const v2 = V.sub(T[i + 1], tL), c2 = V.dot(v2, v2);
    N[i + 1] = c2 < 1e-30 ? rL : V.sub(rL, V.mul(v2, 2 / c2 * V.dot(v2, rL)));
  }
  if (closed && n > 2) {
    // carry the first frame once more round the loop: what it has turned by is spread back along the path
    const last = n - 1, v1 = V.sub(points[0], points[last]), c1 = V.dot(v1, v1);
    if (c1 > 1e-30) {
      const rL = V.sub(N[last], V.mul(v1, 2 / c1 * V.dot(v1, N[last])));
      const tL = V.sub(T[last], V.mul(v1, 2 / c1 * V.dot(v1, T[last])));
      const v2 = V.sub(T[0], tL), c2 = V.dot(v2, v2);
      const rEnd = c2 < 1e-30 ? rL : V.sub(rL, V.mul(v2, 2 / c2 * V.dot(v2, rL)));
      const cos = Math.max(-1, Math.min(1, V.dot(rEnd, N[0])));
      const sin = V.dot(V.cross(rEnd, N[0]), T[0]);
      const angle = Math.atan2(sin, cos);                  // what is missing for the end to meet the start
      for (let i = 0; i < n; i++) {
        const a = angle * (i / n), c = Math.cos(a), s = Math.sin(a);
        const Bi = V.cross(T[i], N[i]);
        N[i] = V.norm(V.add(V.mul(N[i], c), V.mul(Bi, s)));
      }
    }
  }
  const tw = opts.twist || 0;
  for (let i = 0; i < n; i++) {
    N[i] = V.norm(V.sub(N[i], V.mul(T[i], V.dot(N[i], T[i]))));
    B[i] = V.cross(T[i], N[i]);
    if (tw) {
      const c = Math.cos(tw), s = Math.sin(tw);
      const n2 = V.add(V.mul(N[i], c), V.mul(B[i], s)), b2 = V.sub(V.mul(B[i], c), V.mul(N[i], s));
      N[i] = n2; B[i] = b2;
    }
  }
  return { T, N, B };
}

// ── Profiles ────────────────────────────────────────────────────────────────

// A flat set of 3D points as a 2D profile: the plane they lie in (Newell's
// normal) gives the axes. Returns { pts:[[u,v]...], closed, origin, u, v, normal }
// with (u, v, normal) a right-handed frame.
export function profileTo2D(points, closed, hint) {
  const n = points.length;
  let c = [0, 0, 0];
  for (const p of points) c = V.add(c, p);
  c = V.mul(c, 1 / Math.max(1, n));
  let nrm = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const a = points[i], b = points[(i + 1) % n];
    nrm = [nrm[0] + (a[1] - b[1]) * (a[2] + b[2]), nrm[1] + (a[2] - b[2]) * (a[0] + b[0]), nrm[2] + (a[0] - b[0]) * (a[1] + b[1])];
  }
  nrm = V.norm(nrm);
  if (V.len(nrm) === 0) nrm = hint ? V.norm(hint) : [0, 0, 1];
  if (hint && V.dot(nrm, hint) < 0) nrm = V.mul(nrm, -1);
  let u = V.sub(points[0], c);
  u = V.sub(u, V.mul(nrm, V.dot(u, nrm)));
  if (V.len(u) < 1e-9) { const alt = Math.abs(nrm[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]; u = V.sub(alt, V.mul(nrm, V.dot(alt, nrm))); }
  u = V.norm(u);
  const v = V.cross(nrm, u);
  return { pts: points.map(p => { const d = V.sub(p, c); return [V.dot(d, u), V.dot(d, v)]; }), closed: !!closed, origin: c, u, v, normal: nrm };
}

export function area2D(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}

// Ear clipping: triangles [i, j, k] (counter-clockwise) filling a simple polygon.
export function triangulatePolygon(pts) {
  const n = pts.length;
  if (n < 3) return [];
  const idx = Array.from({ length: n }, (_, i) => i);
  if (area2D(pts) < 0) idx.reverse();
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (p, a, b, c) => cross(a, b, p) >= -1e-12 && cross(b, c, p) >= -1e-12 && cross(c, a, p) >= -1e-12;
  const out = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k + idx.length - 1) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length];
      const a = pts[i0], b = pts[i1], c = pts[i2];
      if (cross(a, b, c) <= 1e-14) continue;                           // a reflex or flat corner
      let ear = true;
      for (const j of idx) if (j !== i0 && j !== i1 && j !== i2 && inside(pts[j], a, b, c)) { ear = false; break; }
      if (!ear) continue;
      out.push([i0, i1, i2]); idx.splice(k, 1); clipped = true; break;
    }
    if (!clipped) break;                                                // a self-touching outline: stop rather than loop
  }
  if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
  return out;
}

// ── Building meshes ─────────────────────────────────────────────────────────

function volume(pos, idx) {
  let v = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    v += pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1])
       - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c])
       + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c]);
  }
  return v / 6;
}
export const meshVolume = (m) => volume(m.positions, m.index);

// Rings of 3D points joined into a surface. ring[k][j] is point j of ring k; all
// rings have as many points. `corners[j]` true means the profile has a sharp
// corner at point j (its two faces get their own vertices there).
function ringSurface(rings, o) {
  const R = rings.length, J = rings[0].length;
  const closedRing = !!o.closedProfile, closedAlong = !!o.closedPath;
  const corners = o.corners || new Array(J).fill(false);
  const segs = closedRing ? J : J - 1;
  // slots: a smooth point has one vertex, a corner has two (one for each side)
  const slotIn = new Array(J), slotOut = new Array(J);
  let per = 0;
  for (let j = 0; j < J; j++) {
    const sharp = corners[j] && (closedRing || (j > 0 && j < J - 1));
    slotIn[j] = per; slotOut[j] = sharp ? per + 1 : per; per += sharp ? 2 : 1;
  }
  const pos = [], idx = [];
  for (let k = 0; k < R; k++) for (let j = 0; j < J; j++) {
    pos.push(...rings[k][j]);
    if (slotOut[j] !== slotIn[j]) pos.push(...rings[k][j]);
  }
  const vid = (k, slot) => k * per + slot;
  const K = closedAlong ? R : R - 1;
  for (let k = 0; k < K; k++) {
    const k2 = (k + 1) % R;
    for (let j = 0; j < segs; j++) {
      const j2 = (j + 1) % J;
      const a = vid(k, slotOut[j]), b = vid(k, slotIn[j2]), c = vid(k2, slotIn[j2]), d = vid(k2, slotOut[j]);
      idx.push(a, b, c, a, c, d);
    }
  }
  // flat caps at both ends of an open path, when the profile is a closed outline
  if (!closedAlong && closedRing && o.caps !== false) {
    const tri = o.capTriangles || [];
    for (const end of [0, R - 1]) {
      const base = pos.length / 3;
      for (let j = 0; j < J; j++) pos.push(...rings[end][j]);
      for (const [a, b, c] of tri) { if (end === 0) idx.push(base + a, base + c, base + b); else idx.push(base + a, base + b, base + c); }
    }
  }
  return { positions: Float32Array.from(pos), index: Uint32Array.from(idx) };
}

// the corner flags of a polygon: an angle sharper than `crease` degrees between two edges
function cornerFlags(pts, closed, crease) {
  const n = pts.length, flags = new Array(n).fill(false);
  const lim = Math.cos((crease == null ? 30 : crease) * Math.PI / 180);
  for (let j = 0; j < n; j++) {
    if (!closed && (j === 0 || j === n - 1)) continue;
    const a = pts[(j - 1 + n) % n], b = pts[j], c = pts[(j + 1) % n];
    const d1 = [b[0] - a[0], b[1] - a[1]], d2 = [c[0] - b[0], c[1] - b[1]];
    const l1 = Math.hypot(...d1), l2 = Math.hypot(...d2);
    if (l1 < 1e-12 || l2 < 1e-12) continue;
    flags[j] = (d1[0] * d2[0] + d1[1] * d2[1]) / (l1 * l2) < lim;
  }
  return flags;
}

// SWEEP. profile: { pts:[[u,v]...], closed }, path: { points:[[x,y,z]...], closed }.
//   scale        [start, end] size of the profile along the path        (default [1, 1])
//   twist        total turn of the profile about the path, in degrees    (default 0)
//   range        [from, to] part of the path used, 0..1                  (default [0, 1])
//   up           where the profile's first axis points at the start      (default world Z)
//   caps         close the ends of an open path                          (default true)
//   crease       degrees; sharper profile corners stay hard              (default 30)
//   flip         turn the faces round
export function sweep(profile, path, opts = {}) {
  const pts = path.points, closedPath = !!path.closed && !(opts.range && (opts.range[0] > 0 || opts.range[1] < 1));
  if (pts.length < 2 || profile.pts.length < 2) return { positions: new Float32Array(0), index: new Uint32Array(0) };
  const fr = pathFrames(pts, !!path.closed, { up: opts.up });
  // arc length of every point
  const s = [0];
  for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + V.len(V.sub(pts[i], pts[i - 1])));
  const total = s[s.length - 1] + (path.closed ? V.len(V.sub(pts[0], pts[pts.length - 1])) : 0);
  const stations = [];                                     // { p, N, B, t }
  const push = (i, t) => stations.push({ p: pts[i], N: fr.N[i], B: fr.B[i], t });
  const range = opts.range || [0, 1];
  const r0 = Math.max(0, Math.min(1, range[0])) * total, r1 = Math.max(0, Math.min(1, range[1])) * total;
  const full = r0 <= 0 && r1 >= total;
  const lastIdx = pts.length - 1;
  if (full) {
    for (let i = 0; i <= lastIdx; i++) push(i, total ? s[i] / total : 0);
    if (path.closed) { /* the ring after the last one is the first again */ }
  } else {
    const at = (x) => {                                     // a station at arc length x
      let i = 0; while (i < lastIdx - 1 && s[i + 1] < x) i++;
      const seg = s[i + 1] - s[i], f = seg > 0 ? (x - s[i]) / seg : 0;
      const N = V.norm(V.lerp(fr.N[i], fr.N[i + 1], f)), T = V.norm(V.lerp(fr.T[i], fr.T[i + 1], f));
      const Nn = V.norm(V.sub(N, V.mul(T, V.dot(N, T))));
      return { p: V.lerp(pts[i], pts[i + 1], f), N: Nn, B: V.cross(T, Nn), t: x / total };
    };
    stations.push(at(r0));
    for (let i = 0; i <= lastIdx; i++) if (s[i] > r0 + 1e-9 && s[i] < r1 - 1e-9) push(i, s[i] / total);
    stations.push(at(r1));
  }
  const sc = opts.scale || [1, 1], tw = (opts.twist || 0) * Math.PI / 180;
  const rings = stations.map((st) => {
    const k = sc[0] + (sc[1] - sc[0]) * st.t, a = tw * st.t, c = Math.cos(a), sn = Math.sin(a);
    const Np = V.add(V.mul(st.N, c), V.mul(st.B, sn)), Bp = V.sub(V.mul(st.B, c), V.mul(st.N, sn));
    return profile.pts.map(([u, v]) => V.add(st.p, V.add(V.mul(Np, u * k), V.mul(Bp, v * k))));
  });
  const closedProfile = !!profile.closed;
  const corners = cornerFlags(profile.pts, closedProfile, opts.crease);
  const capTriangles = closedProfile && !closedPath ? triangulatePolygon(profile.pts) : [];
  const mesh = ringSurface(rings, { closedProfile, closedPath, corners, caps: opts.caps, capTriangles });
  // faces outward: for a closed solid the volume must come out positive
  const solid = closedProfile && (closedPath || opts.caps !== false);
  if ((solid && volume(mesh.positions, mesh.index) < 0) !== !!opts.flip) {
    const ix = mesh.index;
    for (let t = 0; t < ix.length; t += 3) { const x = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = x; }
  }
  return mesh;
}

// EXTRUDE: the profile pushed along a straight line (default the profile's own normal).
export function extrude(profile, opts = {}) {
  const n = profile.normal || [0, 0, 1], o = profile.origin || [0, 0, 0], u = profile.u || [1, 0, 0];
  const d = opts.vector || V.mul(n, opts.length == null ? 1 : opts.length);
  const path = { points: [o, V.add(o, d)], closed: false };
  // the swept frame must start as the profile's own (u, v, normal)
  return sweep(profile, path, { ...opts, up: u, scale: opts.scale });
}

// LATHE: the profile turned about an axis through the origin of its plane.
// The profile's u is the distance from the axis, v the position along it.
export function lathe(profile, opts = {}) {
  const seg = Math.max(3, Math.round(opts.segments || 32)), ang = (opts.angle == null ? 360 : opts.angle) * Math.PI / 180;
  const full = Math.abs(ang) >= Math.PI * 2 - 1e-9;
  const R = full ? seg : seg + 1;
  const rings = [];
  for (let k = 0; k < R; k++) {
    const a = ang * (k / (full ? seg : seg));
    const c = Math.cos(a), s = Math.sin(a);
    rings.push(profile.pts.map(([r, h]) => [r * c, r * s, h]));
  }
  const closedProfile = !!profile.closed;
  const corners = cornerFlags(profile.pts, closedProfile, opts.crease);
  const mesh = ringSurface(rings, { closedProfile, closedPath: full, corners, caps: false });
  if ((closedProfile && full && volume(mesh.positions, mesh.index) < 0) !== !!opts.flip) {
    const ix = mesh.index;
    for (let t = 0; t < ix.length; t += 3) { const x = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = x; }
  }
  return mesh;
}

// LOFT: a surface through several outlines, each a list of 3D points. Outlines
// with different point counts are resampled to the same number along their length.
export function loft(outlines, opts = {}) {
  const closed = !!opts.closed;
  const count = opts.points || Math.max(...outlines.map(o => o.length));
  const resample = (pts) => {
    if (pts.length === count) return pts;
    const L = [0];
    for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + V.len(V.sub(pts[i], pts[i - 1])));
    const tot = L[L.length - 1] + (closed ? V.len(V.sub(pts[0], pts[pts.length - 1])) : 0);
    const out = [];
    for (let j = 0; j < count; j++) {
      const x = tot * (closed ? j / count : j / (count - 1));
      let i = 0; while (i < pts.length - 1 && L[i + 1] < x) i++;
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const seg = (i + 1 < pts.length ? L[i + 1] : tot) - L[i];
      out.push(V.lerp(a, b, seg > 0 ? Math.min(1, (x - L[i]) / seg) : 0));
    }
    return out;
  };
  const rings = outlines.map(resample);
  const capTriangles = closed && opts.caps !== false ? triangulatePolygonFlat(rings[0]) : [];
  const mesh = ringSurface(rings, { closedProfile: closed, closedPath: false, corners: opts.corners, caps: opts.caps, capTriangles });
  if (closed && opts.caps !== false && volume(mesh.positions, mesh.index) < 0) {
    const ix = mesh.index;
    for (let t = 0; t < ix.length; t += 3) { const x = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = x; }
  }
  return mesh;
}
function triangulatePolygonFlat(pts3) {
  const p = profileTo2D(pts3, true);
  return triangulatePolygon(p.pts);
}

// ── Ready-made shapes (also what the drawing tools will start from) ─────────

export function circle(radius = 1, segments = 32) {
  return { pts: Array.from({ length: segments }, (_, i) => { const a = (i / segments) * Math.PI * 2; return [Math.cos(a) * radius, Math.sin(a) * radius]; }), closed: true };
}
export function rectangle(w = 1, h = 1) {
  return { pts: [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]], closed: true };
}
export function helix(radius = 1, pitch = 1, turns = 3, perTurn = 24) {
  const n = Math.round(turns * perTurn);
  return { points: Array.from({ length: n + 1 }, (_, i) => { const a = (i / perTurn) * Math.PI * 2; return [Math.cos(a) * radius, Math.sin(a) * radius, (i / perTurn) * pitch]; }), closed: false };
}

// ── Drawing: building and editing splines ───────────────────────────────────
// All of these take and return the spline format at the top of this file.

const cp = (p) => [p[0], p[1], p[2]];
export const cloneSpline = (sp) => ({ type: sp.type, closed: !!sp.closed, tension: sp.tension,
  points: sp.points.map(q => ({ p: cp(q.p), tIn: q.tIn ? cp(q.tIn) : undefined, tOut: q.tOut ? cp(q.tOut) : undefined })) });

// Any spline as a 'bezier' one: the points sit where the pieces meet and carry the handles that
// give the same curve. (A B-spline does not pass through its control points, so it comes out with
// the points on its curve instead.)
export function toBezier(sp) {
  const pieces = bezierPieces(sp), closed = !!sp.closed, k = pieces.length;
  if (!k) return { type: 'bezier', closed, points: sp.points.map(q => ({ p: cp(q.p), tIn: [0, 0, 0], tOut: [0, 0, 0] })) };
  const count = closed ? k : k + 1;
  const pts = Array.from({ length: count }, (_, i) => ({ p: cp(i < k ? pieces[i][0] : pieces[k - 1][3]), tIn: [0, 0, 0], tOut: [0, 0, 0] }));
  pieces.forEach((P, i) => {
    const j = (i + 1) % count;
    if (P[4] === true) return;                      // a straight piece: the points keep no handles, so they stay sharp corners
    pts[i].tOut = V.sub(P[1], P[0]);
    pts[j].tIn = V.sub(P[2], P[3]);
  });
  if (!closed) { pts[0].tIn = [0, 0, 0]; pts[count - 1].tOut = [0, 0, 0]; }
  return { type: 'bezier', closed, points: pts };
}

// the same spline with another curve type (going to Bezier keeps the shape; leaving it drops the handles)
export function withType(sp, type) {
  if (type === sp.type) return cloneSpline(sp);
  if (type === 'bezier') return toBezier(sp);
  return { type, closed: !!sp.closed, tension: sp.tension, points: sp.points.map(q => ({ p: cp(q.p) })) };
}

// where the points and pieces of a sampled spline are: for each sample point, which piece it
// lies on and how far along it (0..1). Lets a click on the drawn curve find its place in the spline.
export function sampleDetailed(spline, steps = 12) {
  const pieces = bezierPieces(spline), closed = !!spline.closed;
  const points = [], seg = [], t = [];
  pieces.forEach((P, i) => {
    const n = P[4] === true ? 1 : steps;
    for (let s = 0; s < n; s++) { points.push(bez(P, s / n)); seg.push(i); t.push(s / n); }
    if (!closed && i === pieces.length - 1) { points.push(P[3]); seg.push(i); t.push(1); }
  });
  return { points, seg, t, closed };
}

// De Casteljau: a Bezier piece cut at t into two
export function splitPiece(P, t) {
  const a = V.lerp(P[0], P[1], t), b = V.lerp(P[1], P[2], t), c = V.lerp(P[2], P[3], t);
  const d = V.lerp(a, b, t), e = V.lerp(b, c, t), m = V.lerp(d, e, t);
  return [[P[0], a, d, m], [m, e, c, P[3]]];
}

// A point put into the spline on piece `seg` at `t`, without changing the curve for a Bezier or
// linear spline (a cubic or B-spline gets a point on the curve there, and bends a little).
export function insertPoint(sp, seg, t) {
  const n = sp.points.length, j = (seg + 1) % n;
  const piece = bezierPieces(sp)[seg];
  const out = cloneSpline(sp);
  const at = bez(piece, t);
  if (sp.type === 'bezier') {
    const [L, R] = splitPiece(piece, t);
    out.points[seg].tOut = V.sub(L[1], L[0]);
    out.points[j].tIn = V.sub(R[2], R[3]);
    out.points.splice(seg + 1, 0, { p: at, tIn: V.sub(L[2], L[3]), tOut: V.sub(R[1], R[0]) });
  } else {
    out.points.splice(seg + 1, 0, { p: at });
  }
  return out;
}

export function removePoint(sp, i) {
  const out = cloneSpline(sp);
  if (out.points.length <= (out.closed ? 3 : 2)) return out;     // keep a valid spline
  out.points.splice(i, 1);
  return out;
}

export function reverseSpline(sp) {
  const out = cloneSpline(sp);
  out.points.reverse();
  for (const q of out.points) { const a = q.tIn, b = q.tOut; q.tIn = b; q.tOut = a; }
  return out;
}

// Handles for a point from its neighbours (a smooth point)...
export function smoothHandles(sp, i, amount = 1 / 3) {
  const out = cloneSpline(sp), n = out.points.length, closed = out.closed;
  const prev = closed ? out.points[(i - 1 + n) % n] : out.points[i - 1];
  const next = closed ? out.points[(i + 1) % n] : out.points[i + 1];
  const q = out.points[i];
  if (!prev && !next) return out;
  const a = prev ? prev.p : V.sub(q.p, V.sub(next.p, q.p));
  const b = next ? next.p : V.sub(q.p, V.sub(prev.p, q.p));
  const dir = V.norm(V.sub(b, a));
  const lin = prev ? V.len(V.sub(q.p, prev.p)) : 0, lout = next ? V.len(V.sub(next.p, q.p)) : 0;
  q.tIn = V.mul(dir, -lin * amount);
  q.tOut = V.mul(dir, lout * amount);
  return out;
}
// ...or none (a sharp one)
export const sharpPoint = (sp, i) => { const out = cloneSpline(sp); out.points[i].tIn = [0, 0, 0]; out.points[i].tOut = [0, 0, 0]; return out; };
export const isSharp = (q) => V.len(q.tIn || [0, 0, 0]) < 1e-12 && V.len(q.tOut || [0, 0, 0]) < 1e-12;

// A circle (or ellipse) about `center` in the plane of (u, v): four Bezier points.
export function circleSpline(center, u, v, radius, radiusV) {
  const k = 0.5522847498307936, rv = radiusV == null ? radius : radiusV;
  const U = V.norm(u), W = V.norm(v);
  const P = (a, b) => V.add(center, V.add(V.mul(U, a), V.mul(W, b)));
  const D = (a, b) => V.add(V.mul(U, a), V.mul(W, b));
  const pts = [[radius, 0, 0, rv * k], [0, rv, -radius * k, 0], [-radius, 0, 0, -rv * k], [0, -rv, radius * k, 0]].map(([x, y, tx, ty]) => ({
    p: P(x, y), tOut: D(tx, ty), tIn: D(-tx, -ty),
  }));
  return { type: 'bezier', closed: true, points: pts };
}

export function rectangleSpline(origin, u, v, w, h) {
  const U = V.norm(u), W = V.norm(v);
  const P = (a, b) => V.add(origin, V.add(V.mul(U, a), V.mul(W, b)));
  return { type: 'linear', closed: true, points: [P(0, 0), P(w, 0), P(w, h), P(0, h)].map(p => ({ p })) };
}

export function polygonSpline(center, u, v, radius, sides, phase = 0) {
  const U = V.norm(u), W = V.norm(v), n = Math.max(3, Math.round(sides));
  return { type: 'linear', closed: true, points: Array.from({ length: n }, (_, i) => {
    const a = phase + (i / n) * Math.PI * 2;
    return { p: V.add(center, V.add(V.mul(U, Math.cos(a) * radius), V.mul(W, Math.sin(a) * radius))) };
  }) };
}

// An arc from a through b to c (three points not on a line) as Bezier pieces of at most 90 degrees.
export function arcSpline(a, b, c) {
  const ab = V.sub(b, a), ac = V.sub(c, a), n = V.cross(ab, ac), nn = V.dot(n, n);
  if (nn < 1e-18) return { type: 'linear', closed: false, points: [a, c].map(p => ({ p: cp(p) })) };      // in a line: a straight piece
  const toC = V.add(V.mul(V.cross(n, ab), V.dot(ac, ac)), V.mul(V.cross(ac, n), V.dot(ab, ab)));
  const centre = V.add(a, V.mul(toC, 1 / (2 * nn)));
  const r = V.len(V.sub(a, centre));
  const nrm = V.norm(n);
  const ex = V.norm(V.sub(a, centre)), ey = V.cross(nrm, ex);
  // angle of a point about the centre, counter-clockwise about the normal, 0 at a
  const ang = (p) => { const d = V.sub(p, centre); return Math.atan2(V.dot(d, ey), V.dot(d, ex)); };
  const TAU = Math.PI * 2;
  let tb = ang(b), tc = ang(c);
  if (tb < 0) tb += TAU;
  if (tc < 0) tc += TAU;
  // going counter-clockwise from a, b comes before c: that way; otherwise go clockwise
  const total = tb <= tc ? tc : tc - TAU;
  const pieces = Math.max(1, Math.ceil(Math.abs(total) / (Math.PI / 2) - 1e-9));
  const step = total / pieces, k = 4 / 3 * Math.tan(step / 4) * r;
  const at = (t) => V.add(centre, V.add(V.mul(ex, Math.cos(t) * r), V.mul(ey, Math.sin(t) * r)));
  const tan = (t) => V.add(V.mul(ex, -Math.sin(t)), V.mul(ey, Math.cos(t)));
  const pts = [];
  for (let i = 0; i <= pieces; i++) {
    const t = step * i, T = tan(t);
    pts.push({ p: at(t), tIn: i ? V.mul(T, -k) : [0, 0, 0], tOut: i < pieces ? V.mul(T, k) : [0, 0, 0] });
  }
  return { type: 'bezier', closed: false, points: pts };
}

// Ramer-Douglas-Peucker: the fewest points of a stroke that stay within `tol` of it
export function simplifyPolyline(points, tol) {
  const n = points.length;
  if (n < 3) return points.map(cp);
  const keep = new Array(n).fill(false);
  keep[0] = keep[n - 1] = true;
  const dist = (p, a, b) => {
    const ab = V.sub(b, a), l2 = V.dot(ab, ab);
    const t = l2 > 0 ? Math.max(0, Math.min(1, V.dot(V.sub(p, a), ab) / l2)) : 0;
    return V.len(V.sub(p, V.add(a, V.mul(ab, t))));
  };
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let best = -1, bd = tol;
    for (let k = i + 1; k < j; k++) { const d = dist(points[k], points[i], points[j]); if (d > bd) { bd = d; best = k; } }
    if (best >= 0) { keep[best] = true; stack.push([i, best], [best, j]); }
  }
  return points.filter((_, i) => keep[i]).map(cp);
}

// A rectangle with its corners rounded (type 'round': true arcs, as a Bezier spline) or cut off
// (type 'bevel': straight chamfers). `r` is how far the corner reaches along each edge; it is held to
// half the shorter side, where a square becomes a circle.
export function roundedRectSpline(origin, u, v, w, h, r, type = 'round') {
  const U = V.norm(u), W = V.norm(v);
  r = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  if (!(r > 1e-12)) return rectangleSpline(origin, u, v, w, h);
  const P = (x, y) => V.add(origin, V.add(V.mul(U, x), V.mul(W, y)));
  const D = (x, y) => V.add(V.mul(U, x), V.mul(W, y));
  if (type === 'bevel') {
    const c = r;
    return { type: 'linear', closed: true, points: [[c, 0], [w - c, 0], [w, c], [w, h - c], [w - c, h], [c, h], [0, h - c], [0, c]].map(([x, y]) => ({ p: P(x, y) })) };
  }
  const k = 0.5522847498307936 * r;
  // counter-clockwise from the bottom edge: each edge ends in a point whose handle starts the corner's arc
  const spec = [
    [r, 0, 0, 0, 0, 0],            // [x, y, inX, inY, outX, outY] (handles as offsets)
    [w - r, 0, 0, 0, k, 0],
    [w, r, 0, -k, 0, 0],
    [w, h - r, 0, 0, 0, k],
    [w - r, h, k, 0, 0, 0],
    [r, h, 0, 0, -k, 0],
    [0, h - r, 0, k, 0, 0],
    [0, r, 0, 0, 0, -k],
  ];
  // the arriving handle of the point after a corner points back along the arc
  const pts = spec.map(([x, y, ix, iy, ox, oy]) => ({ p: P(x, y), tIn: D(ix, iy), tOut: D(ox, oy) }));
  pts[0].tIn = D(-k, 0);           // the bottom-left arc arrives here
  pts[2].tIn = D(0, -k);           // the bottom-right arc ends here
  pts[4].tIn = D(k, 0);            // the top-right arc ends here
  pts[6].tIn = D(0, k);            // the top-left arc ends here
  return { type: 'bezier', closed: true, points: pts };
}

// A star (or, with the inner radius at 1, a polygon): `sides` points on the outer radius, and as many
// between them on `inner` times that radius.
export function starSpline(center, u, v, radius, sides, inner = 0.5, phase = 0) {
  const U = V.norm(u), W = V.norm(v), n = Math.max(3, Math.round(sides));
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = phase + (i / (n * 2)) * Math.PI * 2, rr = i % 2 ? radius * inner : radius;
    pts.push({ p: V.add(center, V.add(V.mul(U, Math.cos(a) * rr), V.mul(W, Math.sin(a) * rr))) });
  }
  return { type: 'linear', closed: true, points: pts };
}

// Fillet (type 'round') or chamfer (type 'bevel') the sharp corners of a spline whose edges are straight.
// `dist` is how far along each edge the corner is cut back (held to half the shorter edge beside it).
// `which` is a list of point numbers, or null for every sharp corner. The result is a Bezier spline: a
// rounded corner is a true arc of the right radius, a chamfer a straight cut.
export function filletCorners(src, dist, type = 'round', which = null) {
  const sp = toBezier(src), n = sp.points.length, closed = sp.closed;
  const want = new Set(which == null ? sp.points.map((_, i) => i) : which);
  const out = [];
  for (let i = 0; i < n; i++) {
    const q = sp.points[i];
    const ends = !closed && (i === 0 || i === n - 1);
    const P = !closed && i === 0 ? null : sp.points[(i - 1 + n) % n], N = !closed && i === n - 1 ? null : sp.points[(i + 1) % n];
    if (!want.has(i) || ends || !P || !N || !isSharp(q)) { out.push({ p: cp(q.p), tIn: q.tIn ? cp(q.tIn) : [0, 0, 0], tOut: q.tOut ? cp(q.tOut) : [0, 0, 0] }); continue; }
    const e1 = V.sub(q.p, P.p), e2 = V.sub(N.p, q.p), l1 = V.len(e1), l2 = V.len(e2);
    const t1 = V.norm(e1), t2 = V.norm(e2);
    const cosPhi = Math.max(-1, Math.min(1, V.dot(t1, t2))), phi = Math.acos(cosPhi);     // how far the path turns here
    // (a straight run, or a turn right back on itself, has nothing to round)
    if (phi < 1e-3 || phi > Math.PI - 1e-3 || l1 < 1e-12 || l2 < 1e-12) { out.push({ p: cp(q.p), tIn: [0, 0, 0], tOut: [0, 0, 0] }); continue; }
    const d = Math.max(0, Math.min(dist, l1 / 2, l2 / 2));
    if (d < 1e-12) { out.push({ p: cp(q.p), tIn: [0, 0, 0], tOut: [0, 0, 0] }); continue; }
    const A = V.sub(q.p, V.mul(t1, d)), B = V.add(q.p, V.mul(t2, d));
    if (type === 'bevel') {
      out.push({ p: A, tIn: [0, 0, 0], tOut: [0, 0, 0] }, { p: B, tIn: [0, 0, 0], tOut: [0, 0, 0] });
    } else {
      const R = d / Math.tan(phi / 2), hl = 4 / 3 * Math.tan(phi / 4) * R;
      out.push({ p: A, tIn: [0, 0, 0], tOut: V.mul(t1, hl) }, { p: B, tIn: V.mul(t2, -hl), tOut: [0, 0, 0] });
    }
  }
  return { type: 'bezier', closed, points: out };
}

// The spline reflected in the plane through `o` with normal `n`, its points in the order that keeps its direction of travel.
export function mirrorSpline(src, o, n) {
  const N = V.norm(n);
  const refP = (p) => V.sub(p, V.mul(N, 2 * V.dot(V.sub(p, o), N)));
  const refD = (t) => V.sub(t, V.mul(N, 2 * V.dot(t, N)));
  const m = cloneSpline(src);
  for (const q of m.points) { q.p = refP(q.p); if (q.tIn) q.tIn = refD(q.tIn); if (q.tOut) q.tOut = refD(q.tOut); }
  return reverseSpline(m);
}
