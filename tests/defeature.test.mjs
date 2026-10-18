// node tests/defeature.test.mjs — checks defeature.js (fillets and chamfers off, edges sharp again) on parts built here with the
// CAD face and edge records the converter would give them: a block with one filleted edge, the same with a chamfer, and a round
// boss on a round plate with a fillet at its foot (a torus between a plane and a cylinder).
import { removeBlends } from '../app/js/defeature.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };

// ── a builder: faces as lists of triangles (each with its own vertices, like CAD), wound outward by a normal hint ──
function builder() {
  const pos = [], idx = [], faces = [], rows = [], pts = [];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return {
    // tris: [[p, q, r]...]; outward(centroid) → the outward normal there; kind and nums as the converter writes them
    face(kind, nums, tris, outward) {
      const first = idx.length / 3; let area = 0;
      for (let [p, q, r] of tris) {
        const n = cross(sub(q, p), sub(r, p)), c = [(p[0] + q[0] + r[0]) / 3, (p[1] + q[1] + r[1]) / 3, (p[2] + q[2] + r[2]) / 3];
        if (dot(n, outward(c)) < 0) [q, r] = [r, q];
        area += Math.hypot(...n) / 2;
        const b = pos.length / 3; pos.push(...p, ...q, ...r); idx.push(b, b + 1, b + 2);
      }
      faces.push([kind, first, tris.length, area, ...nums]);
      return faces.length - 1;
    },
    edge(fa, fb, tangent, points) { rows.push([pts.length / 3, points.length, tangent ? 1 : 0, fa, fb]); for (const p of points) pts.push(...p); },
    done() { return { positions: new Float32Array(pos), index: new Uint32Array(idx), cad: { faces, rows, pts: new Float32Array(pts) } }; },
  };
}
const quad = (a, b, c, d) => [[a, b, c], [a, c, d]];
const fan = (loop) => { const out = []; for (let i = 1; i + 1 < loop.length; i++) out.push([loop[0], loop[i], loop[i + 1]]); return out; };
const strip = (lower, upper) => { const out = []; for (let i = 0; i + 1 < lower.length; i++) out.push(...quad(lower[i], lower[i + 1], upper[i + 1], upper[i])); return out; };

function volume(P, I) {
  let v = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    v += (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) / 6;
  }
  return v;
}
// open edges after joining vertices by position (a CAD mesh is closed that way, not by shared vertex numbers)
function openEdges(P, I) {
  const r5 = (x) => Math.round(x * 1e5) / 1e5 + 0;        // (+ 0: a negative zero would be another key)
  const key = new Map(), id = (v) => { const k = r5(P[v * 3]) + ',' + r5(P[v * 3 + 1]) + ',' + r5(P[v * 3 + 2]); let c = key.get(k); if (c === undefined) { c = key.size; key.set(k, c); } return c; };
  const edges = new Map();
  for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) { const a = id(I[t + k]), b = id(I[t + (k + 1) % 3]); if (a === b) continue; const e = a < b ? a + ',' + b : b + ',' + a; edges.set(e, (edges.get(e) || 0) + (a < b ? 1 : -1)); }
  let open = 0; for (const v of edges.values()) if (v !== 0) open++;
  return open;
}
const axisAligned = (P, I) => {
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], v = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(...n);
    if (l === 0) continue;
    if (n.filter(x => Math.abs(x / l) > 1e-6).length !== 1) return false;
  }
  return true;
};

// ── 1. a 20 × 10 × 6 block with its top-back edge filleted (r = 2) ──
function filletedBlock(r = 2, N = 8) {
  const b = builder(), X = 20, Y = 10, Z = 6;
  const arc = Array.from({ length: N + 1 }, (_, i) => { const th = (i / N) * Math.PI / 2; return [Y - r + r * Math.sin(th), Z - r + r * Math.cos(th)]; });   // (y, z) from the top to the back
  const bottom = b.face(0, [], quad([0, 0, 0], [X, 0, 0], [X, Y, 0], [0, Y, 0]), () => [0, 0, -1]);
  const front = b.face(0, [], quad([0, 0, 0], [X, 0, 0], [X, 0, Z], [0, 0, Z]), () => [0, -1, 0]);
  const top = b.face(0, [], quad([0, 0, Z], [X, 0, Z], [X, Y - r, Z], [0, Y - r, Z]), () => [0, 0, 1]);
  const back = b.face(0, [], quad([0, Y, 0], [X, Y, 0], [X, Y, Z - r], [0, Y, Z - r]), () => [0, 1, 0]);
  const fillet = b.face(1, [r], strip(arc.map(([y, z]) => [0, y, z]), arc.map(([y, z]) => [X, y, z])), (c) => [0, c[1] - (Y - r), c[2] - (Z - r)]);
  const profile = [[0, 0], [Y, 0], ...arc.slice().reverse(), [0, Z]];
  const left = b.face(0, [], fan(profile.map(([y, z]) => [0, y, z])), () => [-1, 0, 0]);
  const right = b.face(0, [], fan(profile.map(([y, z]) => [X, y, z])), () => [1, 0, 0]);
  b.edge(top, fillet, true, [[0, Y - r, Z], [X, Y - r, Z]]);
  b.edge(back, fillet, true, [[0, Y, Z - r], [X, Y, Z - r]]);
  b.edge(fillet, left, false, arc.map(([y, z]) => [0, y, z]));
  b.edge(fillet, right, false, arc.map(([y, z]) => [X, y, z]));
  b.edge(top, front, false, [[0, 0, Z], [X, 0, Z]]); b.edge(back, bottom, false, [[0, Y, 0], [X, Y, 0]]);
  b.edge(top, left, false, [[0, 0, Z], [0, Y - r, Z]]); b.edge(top, right, false, [[X, 0, Z], [X, Y - r, Z]]);
  b.edge(back, left, false, [[0, Y, 0], [0, Y, Z - r]]); b.edge(back, right, false, [[X, Y, 0], [X, Y, Z - r]]);
  return b.done();
}
{
  console.log('a block with one filleted edge');
  const g = filletedBlock();
  ok(openEdges(g.positions, g.index) === 0, 'the input is closed');
  const r = removeBlends(g.positions, g.index, { cad: g.cad, maxRadius: 3 });
  ok(r.ok && r.fillets === 1 && r.faces === 1, 'the fillet is found and taken off (' + JSON.stringify({ ok: r.ok, fillets: r.fillets, why: r.why, skipped: r.skipped }) + ')');
  ok(r.ok && Math.abs(volume(r.positions, r.index) - 20 * 10 * 6) < 1e-6, 'the result is the sharp block, volume 1200 (' + (r.ok && volume(r.positions, r.index).toFixed(6)) + ')');
  ok(r.ok && openEdges(r.positions, r.index) === 0, 'the result is closed (' + (r.ok && openEdges(r.positions, r.index)) + ' open edges)');
  ok(r.ok && axisAligned(r.positions, r.index), 'every face left is one of the block\'s six');
  const small = removeBlends(g.positions, g.index, { cad: g.cad, maxRadius: 1 });
  ok(small.ok && small.faces === 0 && /no fillet/.test(small.why || ''), 'a fillet wider than the limit stays (' + small.why + ')');
  const none = removeBlends(g.positions, g.index, { cad: g.cad, maxRadius: 0, maxChamfer: 1 });
  ok(none.ok && none.faces === 0, 'with fillets switched off nothing happens');
}

// ── 2. the same block with a chamfer instead ──
function chamferedBlock(w = 2) {
  const b = builder(), X = 20, Y = 10, Z = 6;
  const bottom = b.face(0, [], quad([0, 0, 0], [X, 0, 0], [X, Y, 0], [0, Y, 0]), () => [0, 0, -1]);
  const front = b.face(0, [], quad([0, 0, 0], [X, 0, 0], [X, 0, Z], [0, 0, Z]), () => [0, -1, 0]);
  const top = b.face(0, [], quad([0, 0, Z], [X, 0, Z], [X, Y - w, Z], [0, Y - w, Z]), () => [0, 0, 1]);
  const back = b.face(0, [], quad([0, Y, 0], [X, Y, 0], [X, Y, Z - w], [0, Y, Z - w]), () => [0, 1, 0]);
  const cham = b.face(0, [], quad([0, Y - w, Z], [X, Y - w, Z], [X, Y, Z - w], [0, Y, Z - w]), () => [0, 1, 1]);
  const profile = [[0, 0], [Y, 0], [Y, Z - w], [Y - w, Z], [0, Z]];
  const left = b.face(0, [], fan(profile.map(([y, z]) => [0, y, z])), () => [-1, 0, 0]);
  const right = b.face(0, [], fan(profile.map(([y, z]) => [X, y, z])), () => [1, 0, 0]);
  b.edge(top, cham, false, [[0, Y - w, Z], [X, Y - w, Z]]);
  b.edge(back, cham, false, [[0, Y, Z - w], [X, Y, Z - w]]);
  b.edge(cham, left, false, [[0, Y - w, Z], [0, Y, Z - w]]);
  b.edge(cham, right, false, [[X, Y - w, Z], [X, Y, Z - w]]);
  b.edge(top, front, false, [[0, 0, Z], [X, 0, Z]]); b.edge(back, bottom, false, [[0, Y, 0], [X, Y, 0]]);
  b.edge(top, left, false, [[0, 0, Z], [0, Y - w, Z]]); b.edge(top, right, false, [[X, 0, Z], [X, Y - w, Z]]);
  b.edge(back, left, false, [[0, Y, 0], [0, Y, Z - w]]); b.edge(back, right, false, [[X, Y, 0], [X, Y, Z - w]]);
  b.edge(front, left, false, [[0, 0, 0], [0, 0, Z]]); b.edge(front, right, false, [[X, 0, 0], [X, 0, Z]]);
  b.edge(bottom, left, false, [[0, 0, 0], [0, Y, 0]]); b.edge(bottom, right, false, [[X, 0, 0], [X, Y, 0]]);
  return b.done();
}
{
  console.log('a block with one chamfered edge');
  const g = chamferedBlock();
  ok(openEdges(g.positions, g.index) === 0, 'the input is closed');
  const r = removeBlends(g.positions, g.index, { cad: g.cad, maxRadius: 0, maxChamfer: 4 });
  ok(r.ok && r.chamfers === 1 && r.faces === 1, 'the chamfer is found and taken off (' + JSON.stringify({ ok: r.ok, chamfers: r.chamfers, why: r.why, skipped: r.skipped }) + ')');
  ok(r.ok && Math.abs(volume(r.positions, r.index) - 1200) < 1e-6, 'volume 1200 (' + (r.ok && volume(r.positions, r.index).toFixed(6)) + ')');
  ok(r.ok && openEdges(r.positions, r.index) === 0, 'closed');
  ok(r.ok && axisAligned(r.positions, r.index), 'six faces only');
  const narrow = removeBlends(g.positions, g.index, { cad: g.cad, maxRadius: 0, maxChamfer: 2 });
  ok(narrow.ok && narrow.faces === 0, 'a chamfer wider than the limit stays (' + (narrow.why || '') + ')');
  // the thin faces of the block itself are not chamfers: the front (6 wide between top and bottom) with the limit at 8
  const wide = removeBlends(g.positions, g.index, { cad: g.cad, maxRadius: 0, maxChamfer: 8 });
  ok(wide.ok && wide.chamfers === 1 && axisAligned(wide.positions, wide.index), 'a face between two parallel faces is never a chamfer (' + wide.faces + ' taken)');
}

// ── 3. a round boss on a round plate, filleted at the foot: a torus between a plane and a cylinder ──
function bossPlate(N = 48, rF = 1.5) {
  const b = builder(), Rp = 12, H = 4, Rb = 4, top = 10, cx = 0, cy = 0;
  const ring = (r, z) => Array.from({ length: N + 1 }, (_, i) => { const a = (i / N) * Math.PI * 2; return [cx + r * Math.cos(a), cy + r * Math.sin(a), z]; });
  const bottom = b.face(0, [], fan(ring(Rp, 0).slice(0, N)), () => [0, 0, -1]);
  const pwall = b.face(1, [Rp], strip(ring(Rp, 0), ring(Rp, H)), (c) => [c[0], c[1], 0]);
  const floor = b.face(0, [], strip(ring(Rb + rF, H), ring(Rp, H)), () => [0, 0, 1]);
  // the fillet: tube centre circle at radius Rb + rF, height H + rF; from the wall (psi = 0) down to the floor (psi = pi/2)
  const M = 6, rings = [];
  for (let j = 0; j <= M; j++) { const psi = (j / M) * Math.PI / 2; rings.push(ring(Rb + rF - rF * Math.cos(psi), H + rF - rF * Math.sin(psi))); }
  const ftris = []; for (let j = 0; j + 1 < rings.length; j++) ftris.push(...strip(rings[j], rings[j + 1]));
  const fillet = b.face(4, [Rb + rF, rF], ftris, (c) => { const ang = Math.atan2(c[1], c[0]); const tc = [(Rb + rF) * Math.cos(ang), (Rb + rF) * Math.sin(ang), H + rF]; return [tc[0] - c[0], tc[1] - c[1], tc[2] - c[2]]; });
  const bwall = b.face(1, [Rb], strip(ring(Rb, H + rF), ring(Rb, top)), (c) => [c[0], c[1], 0]);
  const btop = b.face(0, [], fan(ring(Rb, top).slice(0, N)), () => [0, 0, 1]);
  b.edge(floor, fillet, true, ring(Rb + rF, H));
  b.edge(fillet, bwall, true, ring(Rb, H + rF));
  b.edge(floor, pwall, false, ring(Rp, H)); b.edge(pwall, bottom, false, ring(Rp, 0)); b.edge(bwall, btop, false, ring(Rb, top));
  const poly = (r) => N / 2 * r * r * Math.sin(2 * Math.PI / N);
  return { ...b.done(), expected: poly(Rp) * H + poly(Rb) * (top - H) };
}
{
  console.log('a round boss on a round plate, filleted at its foot');
  const g = bossPlate();
  ok(openEdges(g.positions, g.index) === 0, 'the input is closed');
  const r = removeBlends(g.positions, g.index, { cad: g.cad, maxRadius: 2 });
  ok(r.ok && r.fillets === 1, 'the foot fillet is found and taken off (' + JSON.stringify({ ok: r.ok, fillets: r.fillets, why: r.why, skipped: r.skipped }) + ')');
  ok(r.ok && Math.abs(volume(r.positions, r.index) - g.expected) < 1e-6 * g.expected, 'the volume is plate plus boss, sharp (' + (r.ok && volume(r.positions, r.index).toFixed(4)) + ' vs ' + g.expected.toFixed(4) + ')');
  ok(r.ok && openEdges(r.positions, r.index) === 0, 'closed (' + (r.ok && openEdges(r.positions, r.index)) + ' open edges)');
  const keep = removeBlends(g.positions, g.index, { cad: g.cad, maxRadius: 5 });
  ok(keep.ok && keep.fillets === 1, 'the boss wall (r 4, under the limit of 5) is not taken for a fillet: it meets only one face tangent (' + keep.faces + ' face taken)');
}

// ── 4. a block whose three edges meet filleted at one corner, with a spherical patch between them ──
function cornerBlock(r = 2, N = 8) {
  const b = builder(), X = 20, Y = 10, Z = 6;
  const cx = X - r, cy = Y - r, cz = Z - r;                     // the centre of the corner sphere, and of the three fillet axes
  const qarc = (f) => Array.from({ length: N + 1 }, (_, i) => f((i / N) * Math.PI / 2));
  // faces
  const bottom = b.face(0, [], fan([[0, 0, 0], [X, 0, 0], [X, cy, 0], ...qarc(s => [cx + r * Math.cos(s), cy + r * Math.sin(s), 0]).slice(1, -1), [cx, Y, 0], [0, Y, 0]]), () => [0, 0, -1]);
  const front = b.face(0, [], fan([[0, 0, 0], [X, 0, 0], [X, 0, cz], ...qarc(t => [cx + r * Math.cos(t), 0, cz + r * Math.sin(t)]).slice(1, -1), [cx, 0, Z], [0, 0, Z]]), () => [0, -1, 0]);
  const left = b.face(0, [], fan([[0, 0, 0], [0, Y, 0], [0, Y, cz], ...qarc(t => [0, cy + r * Math.cos(t), cz + r * Math.sin(t)]).slice(1, -1), [0, cy, Z], [0, 0, Z]]), () => [-1, 0, 0]);
  const top = b.face(0, [], quad([0, 0, Z], [cx, 0, Z], [cx, cy, Z], [0, cy, Z]), () => [0, 0, 1]);
  const back = b.face(0, [], quad([0, Y, 0], [cx, Y, 0], [cx, Y, cz], [0, Y, cz]), () => [0, 1, 0]);
  const right = b.face(0, [], quad([X, 0, 0], [X, cy, 0], [X, cy, cz], [X, 0, cz]), () => [1, 0, 0]);
  // the three fillets: top-back along x, top-right along y, back-right along z (each a quarter cylinder up to the corner centre)
  const arcTB = qarc(t => [cy + r * Math.sin(t), cz + r * Math.cos(t)]);                  // (y, z) from the top to the back
  const fTB = b.face(1, [r], strip(arcTB.map(([y, z]) => [0, y, z]), arcTB.map(([y, z]) => [cx, y, z])), (c) => [0, c[1] - cy, c[2] - cz]);
  const arcTR = qarc(t => [cx + r * Math.sin(t), cz + r * Math.cos(t)]);                  // (x, z) from the top to the right
  const fTR = b.face(1, [r], strip(arcTR.map(([x, z]) => [x, 0, z]), arcTR.map(([x, z]) => [x, cy, z])), (c) => [c[0] - cx, 0, c[2] - cz]);
  const arcBR = qarc(s => [cx + r * Math.cos(s), cy + r * Math.sin(s)]);                  // (x, y) from the right to the back
  const fBR = b.face(1, [r], strip(arcBR.map(([x, y]) => [x, y, 0]), arcBR.map(([x, y]) => [x, y, cz])), (c) => [c[0] - cx, c[1] - cy, 0]);
  // the corner patch: the sphere octant x, y, z >= centre; rows by the angle from +z, columns by the angle from +x
  const sp = (th, ph) => [cx + r * Math.sin(th) * Math.cos(ph), cy + r * Math.sin(th) * Math.sin(ph), cz + r * Math.cos(th)];
  const stris = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const t0 = (j / N) * Math.PI / 2, t1 = ((j + 1) / N) * Math.PI / 2, p0 = (i / N) * Math.PI / 2, p1 = ((i + 1) / N) * Math.PI / 2;
    if (j === 0) stris.push([sp(t0, p0), sp(t1, p0), sp(t1, p1)]);
    else stris.push(...quad(sp(t0, p0), sp(t1, p0), sp(t1, p1), sp(t0, p1)));
  }
  const sphere = b.face(3, [r], stris, (c) => [c[0] - cx, c[1] - cy, c[2] - cz]);
  // the CAD edges: tangent along the fillets' sides and round the corner patch, sharp elsewhere
  b.edge(top, fTB, true, [[0, cy, Z], [cx, cy, Z]]); b.edge(back, fTB, true, [[0, Y, cz], [cx, Y, cz]]);
  b.edge(top, fTR, true, [[cx, 0, Z], [cx, cy, Z]]); b.edge(right, fTR, true, [[X, 0, cz], [X, cy, cz]]);
  b.edge(back, fBR, true, [[cx, Y, 0], [cx, Y, cz]]); b.edge(right, fBR, true, [[X, cy, 0], [X, cy, cz]]);
  b.edge(fTB, sphere, true, arcTB.map(([y, z]) => [cx, y, z])); b.edge(fTR, sphere, true, arcTR.map(([x, z]) => [x, cy, z])); b.edge(fBR, sphere, true, arcBR.map(([x, y]) => [x, y, cz]));
  b.edge(fTB, left, false, arcTB.map(([y, z]) => [0, y, z])); b.edge(fTR, front, false, arcTR.map(([x, z]) => [x, 0, z])); b.edge(fBR, bottom, false, arcBR.map(([x, y]) => [x, y, 0]));
  b.edge(top, left, false, [[0, 0, Z], [0, cy, Z]]); b.edge(top, front, false, [[0, 0, Z], [cx, 0, Z]]);
  b.edge(back, left, false, [[0, Y, 0], [0, Y, cz]]); b.edge(back, bottom, false, [[0, Y, 0], [cx, Y, 0]]);
  b.edge(right, front, false, [[X, 0, 0], [X, 0, cz]]); b.edge(right, bottom, false, [[X, 0, 0], [X, cy, 0]]);
  return b.done();
}
{
  console.log('a block with three fillets meeting at a corner under a spherical patch');
  const g = cornerBlock();
  ok(openEdges(g.positions, g.index) === 0, 'the input is closed');
  const r = removeBlends(g.positions, g.index, { cad: g.cad, maxRadius: 3 });
  ok(r.ok && r.fillets === 1 && r.faces === 4, 'the three fillets and the corner patch go as one group (' + JSON.stringify({ ok: r.ok, fillets: r.fillets, faces: r.faces, why: r.why, skipped: r.skipped }) + ')');
  ok(r.ok && Math.abs(volume(r.positions, r.index) - 1200) < 1e-6, 'the result is the sharp block, volume 1200 (' + (r.ok && volume(r.positions, r.index).toFixed(6)) + ')');
  ok(r.ok && openEdges(r.positions, r.index) === 0, 'the result is closed (' + (r.ok && openEdges(r.positions, r.index)) + ' open edges)');
  ok(r.ok && axisAligned(r.positions, r.index), 'every face left is one of the block\'s six');
}

console.log(fails ? '\n' + fails + ' check(s) failed' : '\nall checks passed');
process.exit(fails ? 1 : 0);
