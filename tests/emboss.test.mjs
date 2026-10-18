// node tests/emboss.test.mjs — lettering that is its own part: found when it sits mostly inside a closed part and stands out little.
import { findEmbossedBodies, findSurfaceMarks, smoothRimNormals } from '../app/js/emboss.js';

let failed = 0;
const ok = (c, msg) => { if (!c) { failed++; console.log('  FAIL ' + msg); } };

// a closed box as a triangle soup (a vertex per corner per face, like CAD output); each face is wound so its normal points outward
function box(cx, cy, cz, hx, hy, hz) {
  const pos = [];
  const tri = (a, b, c, out) => {          // (a,b,c) kept or flipped so that the normal agrees with `out`
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * out[0] + ny * out[1] + nz * out[2] >= 0) pos.push(...a, ...b, ...c); else pos.push(...a, ...c, ...b);
  };
  for (const axis of [0, 1, 2]) for (const sign of [-1, 1]) {
    const u = (axis + 1) % 3, w = (axis + 2) % 3, h = [hx, hy, hz], c = [cx, cy, cz];
    const corner = (su, sw) => { const p = [0, 0, 0]; p[axis] = c[axis] + sign * h[axis]; p[u] = c[u] + su * h[u]; p[w] = c[w] + sw * h[w]; return p; };
    const out = [0, 0, 0]; out[axis] = sign;
    tri(corner(-1, -1), corner(1, -1), corner(1, 1), out); tri(corner(-1, -1), corner(1, 1), corner(-1, 1), out);
  }
  return { positions: new Float32Array(pos), index: null };
}
const vol = (g) => { const P = g.positions; let s = 0; for (let i = 0; i < P.length; i += 9) { const a = i, b = i + 3, c = i + 6; s += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) + P[a + 1] * (P[b + 2] * P[c] - P[b] * P[c + 2]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]); } return s / 6; };
ok(Math.abs(vol(box(0, 0, 0, 1, 1, 1)) - 8) < 1e-6, 'the test box is a closed outward solid (volume 8), got ' + vol(box(0, 0, 0, 1, 1, 1)));

const plate = box(0, 0, 2, 50, 30, 2);                  // 100 x 60 x 4, top at z = 4
const letter = box(10, 0, 4 - 1.5 + 0.2, 5, 1, 1.7);     // 10 x 2 x 3.4: from z = 1 (sunk 3) to z = 4.4 (0.4 proud)
const tall = box(-10, 0, 4 - 1.5 + 1.0, 5, 1, 2.5);      // from z = 0 to z = 6: 2 mm proud
const beside = box(70, 0, 2, 5, 1, 1.7);                 // next to the plate, not in it
const buried = box(-30, 10, 2, 3, 3, 1);                 // entirely inside the plate
const run = (parts, rise = 0.5) => findEmbossedBodies(parts.map((g, i) => ({ id: i, ...g })), { rise });

{
  const r = run([plate, letter, tall, beside, buried]);
  const byId = new Map(r.map(x => [x.id, x]));
  ok(byId.has(1) && byId.get(1).host === 0 && !byId.get(1).hidden, 'the letter sunk 3 mm and 0.4 mm proud is found on the plate: ' + JSON.stringify(byId.get(1)));
  ok(byId.get(1) && byId.get(1).proud > 0.35 && byId.get(1).proud < 0.45 && byId.get(1).inside >= 0.45, '…with its rise measured (' + (byId.get(1) && byId.get(1).proud.toFixed(2)) + ') and about half its vertices inside');
  ok(!byId.has(2), 'the one 2 mm proud is not lettering at a rise of 0.5');
  ok(!byId.has(3), 'the box beside the plate is not');
  ok(byId.has(4) && byId.get(4).hidden, 'the box buried in the plate is found and marked hidden: ' + JSON.stringify(byId.get(4)));
  ok(!byId.has(0), 'the plate itself is never a candidate');
  const r2 = run([plate, letter, tall, beside, buried], 2.5);
  ok(r2.some(x => x.id === 2), 'at a rise of 2.5 the taller one is found too');
}
{ // an open plate (one triangle gone) judges nothing
  const open = { positions: plate.positions.slice(9), index: null };
  const r = run([open, letter, buried]);
  ok(r.length === 0, 'an open host judges nothing (' + r.length + ' found)');
}
{ // welded, indexed input is the same as a soup
  const weld = (g) => { const map = new Map(), P = [], idx = []; for (let v = 0; v < g.positions.length / 3; v++) { const k = g.positions[v * 3] + ',' + g.positions[v * 3 + 1] + ',' + g.positions[v * 3 + 2]; let w = map.get(k); if (w === undefined) { w = P.length / 3; map.set(k, w); P.push(g.positions[v * 3], g.positions[v * 3 + 1], g.positions[v * 3 + 2]); } idx.push(w); } return { positions: new Float32Array(P), index: Uint32Array.from(idx) }; };
  const r = run([weld(plate), weld(letter), weld(buried)]);
  ok(r.length === 2 && r.every(x => x.host === 0), 'welded indexed parts give the same answer (' + r.length + ')');
}
{ // maxDiag: a part bigger than the largest mark is not judged, but still serves as a host
  const r = findEmbossedBodies([plate, letter, buried].map((g, i) => ({ id: i, ...g })), { rise: 0.5, maxDiag: 9 });
  ok(r.length === 1 && r[0].id === 2, 'with maxDiag 9 the 10.8 mm letter is not judged and the 8.7 mm buried box still is (' + JSON.stringify(r) + ')');
  const c = findEmbossedBodies([plate, letter, buried].map((g, i) => ({ id: i, ...g })), { rise: 0.5, candidates: new Set([1]) });
  ok(c.length === 1 && c[0].id === 1 && c[0].host === 0, 'with candidates limited to the letter, only it is judged and the plate is still its host (' + JSON.stringify(c) + ')');
}
{ // a body deep inside a thick host is not lettering: a wheel inside a housing's closed shell lies inside, but far from its face
  const block = box(0, 0, 20, 50, 30, 20);                // 100 x 60 x 40, top at z = 40
  const deep = box(0, 0, 20, 4, 4, 1);                      // its middle: 19 mm under the top, 16 mm from the nearest side
  const shallow = box(0, 0, 38, 4, 4, 1);                   // 1 mm under the top
  const r = run([block, deep, shallow]);
  ok(!r.some(x => x.id === 1), 'a body 16 mm inside the block is not lettering (' + JSON.stringify(r) + ')');
  ok(r.some(x => x.id === 2 && x.hidden && x.sunk > 2.5 && x.sunk < 3.5), 'a body 1 to 3 mm under the top is hidden lettering, with its depth measured (' + JSON.stringify(r) + ')');
  const wide = findEmbossedBodies([block, deep].map((g, i) => ({ id: i, ...g })), { rise: 0.5, sink: 30 });
  ok(wide.some(x => x.id === 1), 'with sink raised to 30 mm the deep one counts (' + JSON.stringify(wide) + ')');
}
{ // a part nearly as big as its host is not a detail
  const twin = box(0, 0, 2, 49, 29, 1.9);
  const r = run([plate, twin]);
  ok(r.length === 0, 'a body nearly as large as the host is not judged (' + r.length + ')');
}

// ── Marks cut into the mesh itself (findSurfaceMarks) ────────────────────────────────────────────────────────────────────────
// A plate whose top face has three features stitched into it, as CAD tessellation does: a raised letter (10 x 2, 0.4 high), an
// engraved pocket (8 x 3, 0.3 deep) and a boss (6 x 6, 2 high). The top face is a grid of cells round the footprints, so the
// features share their rim with the face; the plate's other faces are plain quads. A triangle soup, outward wound.
function markedPlate(features) {
  const pos = [];
  const tri = (a, b, c, out) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * out[0] + ny * out[1] + nz * out[2] >= 0) pos.push(...a, ...b, ...c); else pos.push(...a, ...c, ...b);
  };
  const quad = (a, b, c, d, out) => { tri(a, b, c, out); tri(a, c, d, out); };
  const Z = 4, X = 50, Y = 30;
  // the top: a grid whose lines are the footprints' edges
  const xs = [...new Set([-X, X, ...features.flatMap(f => [f.x0, f.x1])])].sort((a, b) => a - b);
  const ys = [...new Set([-Y, Y, ...features.flatMap(f => [f.y0, f.y1])])].sort((a, b) => a - b);
  for (let i = 0; i + 1 < xs.length; i++) for (let j = 0; j + 1 < ys.length; j++) {
    const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2;
    if (features.some(f => cx > f.x0 && cx < f.x1 && cy > f.y0 && cy < f.y1)) continue;       // a footprint: no face there
    quad([xs[i], ys[j], Z], [xs[i + 1], ys[j], Z], [xs[i + 1], ys[j + 1], Z], [xs[i], ys[j + 1], Z], [0, 0, 1]);
  }
  for (const f of features) {
    const z = Z + f.h;                                   // the top of a raised mark, the floor of an engraved one (h < 0)
    const fx = xs.filter(x => x >= f.x0 && x <= f.x1), fy = ys.filter(y => y >= f.y0 && y <= f.y1);     // the grid lines it meets
    for (let i = 0; i + 1 < fx.length; i++) for (let j = 0; j + 1 < fy.length; j++) quad([fx[i], fy[j], z], [fx[i + 1], fy[j], z], [fx[i + 1], fy[j + 1], z], [fx[i], fy[j + 1], z], [0, 0, 1]);
    const s = f.h > 0 ? 1 : -1;                          // walls face away from a raised mark, into a pocket; in strips, so no edge meets two
    for (let i = 0; i + 1 < fx.length; i++) {
      quad([fx[i], f.y0, Z], [fx[i + 1], f.y0, Z], [fx[i + 1], f.y0, z], [fx[i], f.y0, z], [0, -s, 0]);
      quad([fx[i + 1], f.y1, Z], [fx[i], f.y1, Z], [fx[i], f.y1, z], [fx[i + 1], f.y1, z], [0, s, 0]);
    }
    for (let j = 0; j + 1 < fy.length; j++) {
      quad([f.x1, fy[j], Z], [f.x1, fy[j + 1], Z], [f.x1, fy[j + 1], z], [f.x1, fy[j], z], [s, 0, 0]);
      quad([f.x0, fy[j + 1], Z], [f.x0, fy[j], Z], [f.x0, fy[j], z], [f.x0, fy[j + 1], z], [-s, 0, 0]);
    }
  }
  // bottom and sides
  quad([-X, -Y, 0], [X, -Y, 0], [X, Y, 0], [-X, Y, 0], [0, 0, -1]);
  quad([-X, -Y, 0], [X, -Y, 0], [X, -Y, Z], [-X, -Y, Z], [0, -1, 0]);
  quad([X, -Y, 0], [X, Y, 0], [X, Y, Z], [X, -Y, Z], [1, 0, 0]);
  quad([X, Y, 0], [-X, Y, 0], [-X, Y, Z], [X, Y, Z], [0, 1, 0]);
  quad([-X, Y, 0], [-X, -Y, 0], [-X, -Y, Z], [-X, Y, Z], [-1, 0, 0]);
  return new Float32Array(pos);
}
const mLetter = { x0: 5, x1: 15, y0: -1, y1: 1, h: 0.4 }, pocket = { x0: -20, x1: -12, y0: -1.5, y1: 1.5, h: -0.3 }, boss = { x0: 25, x1: 31, y0: -3, y1: 3, h: 2 };
const P = markedPlate([mLetter, pocket, boss]);
// the triangles of a feature: those with a vertex off the face plane within its footprint
const triCount = (P, fs) => { let n = 0; for (let t = 0; t < P.length / 9; t++) { let hit = false; for (let k = 0; k < 3 && !hit; k++) { const x = P[t * 9 + k * 3], y = P[t * 9 + k * 3 + 1], z = P[t * 9 + k * 3 + 2]; if (Math.abs(z - 4) > 1e-6 && z > 1e-6 && fs.some(f => x >= f.x0 - 1e-6 && x <= f.x1 + 1e-6 && y >= f.y0 - 1e-6 && y <= f.y1 + 1e-6)) hit = true; } if (hit) n++; } return n; };
const capsOk = (P, r) => {        // every cap vertex is one the kept triangles use, every cap lies at z = 4 and faces up
  const kept = new Set(); for (let t = 0; t < P.length / 9; t++) if (!r.removed[t]) for (let k = 0; k < 3; k++) kept.add(t * 3 + k);
  for (let i = 0; i < r.caps.length; i += 3) {
    const a = r.caps[i] * 3, b = r.caps[i + 1] * 3, c = r.caps[i + 2] * 3;
    if (!kept.has(r.caps[i]) || !kept.has(r.caps[i + 1]) || !kept.has(r.caps[i + 2])) return 'a cap uses a vertex of a removed triangle';
    if (Math.abs(P[a + 2] - 4) > 1e-6 || Math.abs(P[b + 2] - 4) > 1e-6 || Math.abs(P[c + 2] - 4) > 1e-6) return 'a cap is not at z = 4';
    const nz = (P[b] - P[a]) * (P[c + 1] - P[a + 1]) - (P[b + 1] - P[a + 1]) * (P[c] - P[a]);
    if (!(nz > 0)) return 'a cap faces down';
    if (r.capOwner[i / 3] < 0 || r.removed[r.capOwner[i / 3]]) return 'a cap owner is not a kept triangle';
  }
  return '';
};
{
  const r = findSurfaceMarks(P, null, { maxSize: 40, raisedMax: 0.6, maxDepth: 0.5 });
  ok(r.holes === 2 && r.flattened === 1, 'the 0.4 mm letter and the 0.3 mm pocket are found, the 2 mm boss is not: ' + r.holes + ' marks, ' + r.flattened + ' raised');
  ok(r.removedTris === triCount(P, [mLetter, pocket]) && r.addedTris === 8, 'their ' + triCount(P, [mLetter, pocket]) + ' triangles go and 8 cap triangles come (2 for the letter, 6 for the pocket, whose rim has 8 corners) (' + r.removedTris + ', ' + r.addedTris + ')');
  ok(r.skipped.raisedTall === 1 && Math.abs(r.tallest - 2) < 1e-3 && Math.abs(r.lowestTall - 2) < 1e-3, 'the boss is left for standing too tall, and its height is reported: ' + JSON.stringify(r.skipped) + ' tallest ' + r.tallest + ' lowest ' + r.lowestTall);
  ok(capsOk(P, r) === '', 'the caps are sound: ' + (capsOk(P, r) || 'yes'));
  const m = r.marks.find(x => x.raised), e = r.marks.find(x => !x.raised);
  ok(m && Math.abs(m.height - 0.4) < 1e-3 && Math.abs(m.size - 10) < 1e-3 && e && Math.abs(e.height - 0.3) < 1e-3, 'heights and sizes are measured (' + JSON.stringify(r.marks) + ')');
}
{
  const a = findSurfaceMarks(P, null, { maxSize: 40, raisedMax: 0, maxDepth: 0.5 });
  ok(a.holes === 1 && a.flattened === 0, 'with the rise at 0 only the pocket is closed (' + a.holes + ')');
  const b = findSurfaceMarks(P, null, { maxSize: 40, raisedMax: 0.6, maxDepth: 0 });
  ok(b.holes === 1 && b.flattened === 1, 'with the depth at 0 only the letter is flattened (' + b.holes + ')');
  const c = findSurfaceMarks(P, null, { maxSize: 40, raisedMax: 2.5, maxDepth: 0.5 });
  ok(c.holes === 3 && c.flattened === 2 && capsOk(P, c) === '', 'at a rise of 2.5 the boss goes too (' + c.holes + ')');
  const d = findSurfaceMarks(P, null, { maxSize: 9, raisedMax: 0.6, maxDepth: 0.5 });
  ok(d.holes === 1 && d.skipped.tooLarge === 1, 'with marks limited to 9 mm the 10 mm letter stays (' + d.holes + ' marks, ' + JSON.stringify(d.skipped) + ')');
  const n = findSurfaceMarks(P, null, { maxSize: 40, raisedMax: 0, maxDepth: 0 });
  ok(n.holes === 0 && n.removed.length === P.length / 9, 'with both at 0 nothing is judged');
}
{ // the caps are well shaped: no sliver even where the rim has corners on a straight run (the pocket's long sides)
  const r = findSurfaceMarks(P, null, { maxSize: 40, raisedMax: 0.6, maxDepth: 0.5 });
  let thinnest = 90;
  for (let i = 0; i < r.caps.length; i += 3) {
    const q = [r.caps[i], r.caps[i + 1], r.caps[i + 2]].map(v => [P[v * 3], P[v * 3 + 1]]);
    const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]), la = d(q[1], q[2]), lb = d(q[0], q[2]), lc = d(q[0], q[1]);
    const ang = (x, y, z) => Math.acos(Math.max(-1, Math.min(1, (y * y + z * z - x * x) / (2 * y * z)))) * 180 / Math.PI;
    thinnest = Math.min(thinnest, ang(la, lb, lc), ang(lb, la, lc), ang(lc, la, lb));
  }
  // (the pocket's rim has points 0.5 mm apart along an 8 mm side: about 3.3 degrees is the best any triangulation can do there)
  ok(thinnest > 3, 'the thinnest cap triangle is as fat as the rim allows, over 3 degrees (' + thinnest.toFixed(1) + ')');
  // the rim's normals: tilted at first (as a CAD export shades the top of a wall), level after smoothRimNormals
  const Pk = P.slice(), Ik = []; for (let t = 0; t < P.length / 9; t++) if (!r.removed[t]) Ik.push(t * 3, t * 3 + 1, t * 3 + 2); for (let i = 0; i < r.caps.length; i++) Ik.push(r.caps[i]);
  const N = new Float32Array(Pk.length); for (let v = 0; v < Pk.length / 3; v++) { N[v * 3] = 0.6; N[v * 3 + 2] = 0.8; }
  const keys = new Set(); for (let i = 0; i < r.caps.length; i++) { const v = r.caps[i]; keys.add(Pk[v * 3] + ',' + Pk[v * 3 + 1] + ',' + Pk[v * 3 + 2]); }
  const changed = smoothRimNormals(Pk, Uint32Array.from(Ik), N, keys);
  let level = true; for (const v of r.caps) if (Math.abs(N[v * 3 + 2] - 1) > 1e-5 || Math.abs(N[v * 3]) > 1e-5) level = false;
  ok(changed > 0 && level, 'smoothRimNormals turns every rim vertex of the flat plate to straight up (' + changed + ' changed)');
}
{ // welded, indexed input gives the same answer
  const map = new Map(), Q = [], idx = [];
  for (let v = 0; v < P.length / 3; v++) { const k = P[v * 3] + ',' + P[v * 3 + 1] + ',' + P[v * 3 + 2]; let w = map.get(k); if (w === undefined) { w = Q.length / 3; map.set(k, w); Q.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); } idx.push(w); }
  const r = findSurfaceMarks(new Float32Array(Q), Uint32Array.from(idx), { maxSize: 40, raisedMax: 0.6, maxDepth: 0.5 });
  ok(r.holes === 2 && r.removedTris === triCount(P, [mLetter, pocket]) && r.addedTris === 8, 'welded indexed input: ' + r.holes + ' marks, ' + r.removedTris + ' gone, ' + r.addedTris + ' caps');
}
{ // a letter at the plate's edge borders two faces (the top and the side) and stays
  const edge = markedPlate([{ x0: 40, x1: 50, y0: -1, y1: 1, h: 0.4 }]);
  const r = findSurfaceMarks(edge, null, { maxSize: 40, raisedMax: 0.6, maxDepth: 0.5 });
  ok(r.holes === 0, 'a mark that runs over the edge of its face is not touched (' + r.holes + ')');
}

if (failed) { console.error(failed + ' check(s) failed'); process.exit(1); }
console.log('emboss: all checks passed');
