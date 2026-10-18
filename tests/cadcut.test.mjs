// node tests/cadcut.test.mjs — checks cadcut.js (whole CAD faces out, the gap patched, the triangles made even, the CAD faces kept)
// on parts built here with the CAD face and edge records the converter would give them: a washer whose hole wall is taken out (the
// hole closes into the top and bottom faces), and a cube with one side taken out (the patch is a new face of its own).
import { removeCadFaces, remeshCadFaces } from '../app/js/cadcut.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };

// faces as lists of triangles, each with its own vertices (as CAD gives them), wound outward by a normal hint
function builder() {
  const pos = [], idx = [], faces = [], rows = [], pts = [];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return {
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
function volume(P, I) {
  let v = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    v += (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) / 6;
  }
  return v;
}
function openEdges(P, I) {
  const r5 = (x) => Math.round(x * 1e5) / 1e5 + 0;
  const key = new Map(), id = (v) => { const k = r5(P[v * 3]) + ',' + r5(P[v * 3 + 1]) + ',' + r5(P[v * 3 + 2]); let c = key.get(k); if (c === undefined) { c = key.size; key.set(k, c); } return c; };
  const edges = new Map();
  for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) { const a = id(I[t + k]), b = id(I[t + (k + 1) % 3]); if (a === b) continue; const e = a < b ? a + ',' + b : b + ',' + a; edges.set(e, (edges.get(e) || 0) + (a < b ? 1 : -1)); }
  let open = 0; for (const v of edges.values()) if (v !== 0) open++;
  return open;
}
// the faces' runs cover the triangles in order, one after the other
const runsOk = (faces, T) => { let at = 0; for (const f of faces) { if (f[2] && f[1] !== at) return false; at += f[2]; } return at === T; };
const trisOf = (r, f) => { const out = []; const fc = r.cad.faces[f]; for (let t = fc[1]; t < fc[1] + fc[2]; t++) out.push(t); return out; };
const zsOf = (r, f) => trisOf(r, f).flatMap(t => [0, 1, 2].map(k => r.positions[r.index[t * 3 + k] * 3 + 2]));

// ── a washer: outer radius 15, hole radius 5, 4 thick; faces 0 top, 1 bottom, 2 outer wall, 3 hole wall ──
function washer(N = 32, R = 15, r = 5, h = 4) {
  const B = builder(), ang = (i) => 2 * Math.PI * i / N;
  const at = (rad, i, z) => [rad * Math.cos(ang(i)), rad * Math.sin(ang(i)), z];
  const ring = (z) => { const out = []; for (let i = 0; i < N; i++) out.push(...quad(at(r, i, z), at(R, i, z), at(R, i + 1, z), at(r, i + 1, z))); return out; };
  const wall = (rad) => { const out = []; for (let i = 0; i < N; i++) out.push(...quad(at(rad, i, -h / 2), at(rad, i + 1, -h / 2), at(rad, i + 1, h / 2), at(rad, i, h / 2))); return out; };
  const top = B.face(0, [], ring(h / 2), () => [0, 0, 1]);
  const bot = B.face(0, [], ring(-h / 2), () => [0, 0, -1]);
  const out = B.face(1, [R], wall(R), (c) => [c[0], c[1], 0]);
  const hole = B.face(1, [r], wall(r), (c) => [-c[0], -c[1], 0]);
  const circle = (rad, z) => { const p = []; for (let i = 0; i <= N; i++) p.push(at(rad, i, z)); return p; };
  B.edge(top, out, false, circle(R, h / 2)); B.edge(bot, out, false, circle(R, -h / 2));
  B.edge(top, hole, false, circle(r, h / 2)); B.edge(bot, hole, false, circle(r, -h / 2));
  return { ...B.done(), faces: { top, bot, out, hole } };
}

{
  const w = washer(), v0 = volume(w.positions, w.index);
  for (const scope of ['local', 'whole']) {
    const r = removeCadFaces(w.positions, w.index, { cad: w.cad, remove: [w.faces.hole], scope });
    ok(r.ok, scope + ': the hole wall is taken out');
    if (!r.ok) { console.log(r.why); continue; }
    const T = r.index.length / 3, disc = Math.PI * 15 * 15 * 4 * (32 / (2 * Math.PI)) * Math.sin(2 * Math.PI / 32);      // (the 32-gon's area times the height)
    ok(r.loops === 2 && r.patched === 2 && r.joined === 2 && r.newFaces === 0, scope + ': two rims, both closed into the face round them (' + r.loops + ', ' + r.patched + ', ' + r.joined + ')');
    ok(openEdges(r.positions, r.index) === 0, scope + ': the part is closed');
    ok(Math.abs(volume(r.positions, r.index) - disc) < disc * 2e-3, scope + ': the volume is the solid disc\'s (' + volume(r.positions, r.index).toFixed(2) + ' / ' + disc.toFixed(2) + ', was ' + v0.toFixed(2) + ')');
    ok(r.cad.faces.length === 4 && r.cad.faces[w.faces.hole][2] === 0, scope + ': the hole wall is kept as a face with no triangles');
    ok(runsOk(r.cad.faces, T), scope + ': every face is one run of triangles, in order');
    ok(zsOf(r, w.faces.top).every(z => Math.abs(z - 2) < 1e-4) && zsOf(r, w.faces.bot).every(z => Math.abs(z + 2) < 1e-4), scope + ': the top and bottom faces are flat, the patches in them');
    const area0 = Math.PI * 15 * 15 * (32 / (2 * Math.PI)) * Math.sin(2 * Math.PI / 32);
    ok(Math.abs(r.cad.faces[w.faces.top][3] - area0) < area0 * 1e-3, scope + ': the top face\'s area is measured again (' + r.cad.faces[w.faces.top][3].toFixed(2) + ')');
    ok(r.cad.rows.length === 2 && r.cad.rows.every(x => x[3] !== w.faces.hole && x[4] !== w.faces.hole), scope + ': the hole\'s CAD edges go, the outer ones stay');
    ok(r.remeshed, scope + ': remeshed (edge ' + r.length.toFixed(3) + ', ' + r.before + ' → ' + T + ' triangles)');
    if (scope === 'local') ok(r.cad.faces[w.faces.out][2] === w.cad.faces[w.faces.out][2], 'local: the outer wall, away from the cut, is as it was');
    else {
      const outR = trisOf(r, w.faces.out).flatMap(t => [0, 1, 2].map(k => { const v = r.index[t * 3 + k] * 3; return Math.hypot(r.positions[v], r.positions[v + 1]); }));
      ok(outR.every(x => x > 14.5 && x < 15.0001), 'whole: the outer wall\'s triangles are still on it');
    }
  }
  const none = removeCadFaces(w.positions, w.index, { cad: w.cad, remove: [] });
  ok(!none.ok, 'nothing picked: nothing done (' + none.why + ')');
  const all = removeCadFaces(w.positions, w.index, { cad: w.cad, remove: [0, 1, 2, 3] });
  ok(!all.ok, 'every face picked: nothing done (' + all.why + ')');
}

// ── a cube of 10, one side out: the rim runs over four faces, so the patch is a new face, and flat ──
{
  const B = builder(), s = 10, n = 4;
  const grid = (fn) => { const out = []; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out.push(...quad(fn(i / n, j / n), fn((i + 1) / n, j / n), fn((i + 1) / n, (j + 1) / n), fn(i / n, (j + 1) / n))); return out; };
  const c = [s / 2, s / 2, s / 2], outw = (p) => [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
  const sides = [
    (u, v) => [s, u * s, v * s], (u, v) => [0, u * s, v * s], (u, v) => [u * s, s, v * s],
    (u, v) => [u * s, 0, v * s], (u, v) => [u * s, v * s, s], (u, v) => [u * s, v * s, 0],
  ];
  const ids = sides.map(fn => B.face(0, [], grid(fn), outw));
  const cube = B.done();
  const r = removeCadFaces(cube.positions, cube.index, { cad: cube.cad, remove: [ids[0]], otherKind: 10 });
  ok(r.ok, 'cube: one side taken out');
  if (r.ok) {
    ok(r.loops === 1 && r.newFaces === 1 && r.joined === 0, 'cube: one rim, closed with a face of its own');
    ok(openEdges(r.positions, r.index) === 0, 'cube: closed again');
    ok(Math.abs(volume(r.positions, r.index) - 1000) < 0.5, 'cube: the volume is the cube\'s (' + volume(r.positions, r.index).toFixed(3) + ')');
    const nf = r.cad.faces[6];
    ok(nf && nf[0] === 10 && nf[2] > 0, 'cube: the new face is "other" and has triangles');
    const xs = trisOf(r, 6).flatMap(t => [0, 1, 2].map(k => r.positions[r.index[t * 3 + k] * 3]));
    ok(xs.every(x => Math.abs(x - 10) < 1e-4), 'cube: the patch is flat, where the side was (no bulge)');
    ok(runsOk(r.cad.faces, r.index.length / 3), 'cube: every face is one run of triangles');
  }
}

// ── the card's choices: how the gap is closed, whether and where it is remeshed, and remeshing faces without removing any ──
{
  const w = washer(), H = w.faces.hole;
  const op = removeCadFaces(w.positions, w.index, { cad: w.cad, remove: [H], close: 'open', scope: 'none' });
  ok(op.ok && op.patched === 0 && !op.remeshed && op.after === 256 - 64 && openEdges(op.positions, op.index) === 64, 'close open, no remesh: the wall goes, the two rims stay open, nothing else changes (' + op.after + ' triangles)');
  ok(runsOk(op.cad.faces, op.after) && op.cad.faces[H][2] === 0, 'close open: the record still fits');
  const fl = removeCadFaces(w.positions, w.index, { cad: w.cad, remove: [H], close: 'flat', scope: 'none' });
  ok(fl.ok && fl.patched === 2 && !fl.remeshed && openEdges(fl.positions, fl.index) === 0, 'close flat, no remesh: closed, not remeshed (' + fl.after + ' triangles)');
  const r1 = removeCadFaces(w.positions, w.index, { cad: w.cad, remove: [H], rings: 0, length: 2 }), r3 = removeCadFaces(w.positions, w.index, { cad: w.cad, remove: [H], rings: 3, length: 2 });
  ok(r1.ok && r3.ok && r1.remeshed && openEdges(r1.positions, r1.index) === 0 && openEdges(r3.positions, r3.index) === 0, 'rings 0 and 3: both closed and remeshed');
  ok(r1.cad.faces[w.faces.out][2] === 64 && r3.cad.faces[w.faces.out][2] !== 64, 'rings: 0 leaves the outer wall alone, 3 reach it (' + r1.cad.faces[w.faces.out][2] + ', ' + r3.cad.faces[w.faces.out][2] + ')');
  const few = removeCadFaces(w.positions, w.index, { cad: w.cad, remove: [H], length: 3 }), many = removeCadFaces(w.positions, w.index, { cad: w.cad, remove: [H], length: 0.5 });
  ok(few.ok && many.ok && many.after > few.after * 2, 'edge length: shorter, more triangles (' + few.after + ' at 3, ' + many.after + ' at 0.5)');
  // remesh one face, the outer wall, without removing anything
  const rf = remeshCadFaces(w.positions, w.index, { cad: w.cad, faces: [w.faces.out], length: 1 });
  ok(rf.ok && rf.remeshed && openEdges(rf.positions, rf.index) === 0, 'remesh a face: still closed (' + rf.before + ' → ' + rf.after + ')');
  ok(rf.cad.faces[w.faces.top][2] === 64 && rf.cad.faces[H][2] === 64 && rf.cad.faces[w.faces.out][2] > 64, 'remesh a face: only that face changed (top 64, hole 64, outer ' + rf.cad.faces[w.faces.out][2] + ')');
  const vw = volume(w.positions, w.index);
  ok(Math.abs(volume(rf.positions, rf.index) - vw) < vw * 1e-3, 'remesh a face: the volume stays within 0.1% (' + volume(rf.positions, rf.index).toFixed(2) + ' / ' + vw.toFixed(2) + ')');
  ok(rf.cad.rows.length === 4 && runsOk(rf.cad.faces, rf.after), 'remesh a face: the CAD edges stay, the record fits');
  const rw = remeshCadFaces(w.positions, w.index, { cad: w.cad });
  ok(rw.ok && rw.scope === 'whole' && openEdges(rw.positions, rw.index) === 0 && runsOk(rw.cad.faces, rw.after), 'remesh with no faces given: the whole part, closed, the record fits');
}

console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
