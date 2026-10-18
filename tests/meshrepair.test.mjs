// node tests/meshrepair.test.mjs: the arithmetic of Repair mesh and Remove hidden faces
import { repairMesh, keepNearSeen, weldIds, parseCount, wildcardTest } from '../app/js/meshrepair.js';
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.error('FAIL: ' + msg); } };

// a unit cube as 12 triangles with every corner repeated (24 vertices... here 36, a triangle soup), outward facing
function cubeSoup() {
  const v = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
  const f = [[0,3,2],[0,2,1],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[2,3,7],[2,7,6],[1,2,6],[1,6,5],[3,0,4],[3,4,7]];   // outward
  const pos = []; for (const t of f) for (const i of t) pos.push(...v[i]);
  return { position: Float32Array.from(pos), index: null, f, v };
}
const signedVolume = (r) => { let s = 0; const p = r.position, x = r.index; for (let t = 0; t < x.length; t += 3) { const a = x[t]*3, b = x[t+1]*3, c = x[t+2]*3;
  s += p[a]*(p[b+1]*p[c+2]-p[b+2]*p[c+1]) + p[a+1]*(p[b+2]*p[c]-p[b]*p[c+2]) + p[a+2]*(p[b]*p[c+1]-p[b+1]*p[c]); } return s / 6; };
const edgesConsistent = (r) => { const e = new Map(); const x = r.index; let good = true;
  for (let t = 0; t < x.length; t += 3) for (let k = 0; k < 3; k++) { const u = x[t+k], v = x[t+(k+1)%3], key = u + '>' + v; e.set(key, (e.get(key) || 0) + 1); }
  for (const [k] of e) { const [u, v] = k.split('>'); if (!e.has(v + '>' + u)) good = false; if (e.get(k) > 1) good = false; } return good; };

{ // weld: 36 soup vertices become 8
  const c = cubeSoup(); const r = repairMesh({ position: c.position });
  ok(r.stats.vertsAfter === 8, 'cube welds to 8 vertices, got ' + r.stats.vertsAfter);
  ok(r.stats.trisAfter === 12, '12 triangles stay, got ' + r.stats.trisAfter);
  ok(r.stats.flipped === 0, 'an outward cube turns nothing, turned ' + r.stats.flipped);
  ok(signedVolume(r) > 0.99 && signedVolume(r) < 1.01, 'volume 1, got ' + signedVolume(r));
  ok(edgesConsistent(r), 'edges consistent');
}
{ // three faces turned the wrong way
  const c = cubeSoup(); const pos = c.position.slice();
  for (const t of [0, 5, 9]) { for (let k = 0; k < 3; k++) { const a = (t * 3 + 1) * 3 + k, b = (t * 3 + 2) * 3 + k; const x = pos[a]; pos[a] = pos[b]; pos[b] = x; } }
  const r = repairMesh({ position: pos });
  ok(r.stats.flipped >= 1, 'wrong-way faces are turned: ' + r.stats.flipped);
  ok(edgesConsistent(r), 'edges consistent after');
  ok(signedVolume(r) > 0.99, 'outward again, volume ' + signedVolume(r));
}
{ // a whole cube inside out is turned outward
  const c = cubeSoup(); const pos = c.position.slice();
  for (let t = 0; t < 12; t++) for (let k = 0; k < 3; k++) { const a = (t * 3 + 1) * 3 + k, b = (t * 3 + 2) * 3 + k; const x = pos[a]; pos[a] = pos[b]; pos[b] = x; }
  const r = repairMesh({ position: pos });
  ok(signedVolume(r) > 0.99, 'inside-out cube becomes outward, volume ' + signedVolume(r));
}
{ // degenerate and doubled triangles
  const c = cubeSoup(); const extra = [0,0,0, 1,0,0, 1,0,0,   0,0,0, 0,0,0, 1,1,1];   // two empty ones
  const dup = Array.from(c.position.slice(0, 9));                                       // the first triangle again
  const pos = Float32Array.from([...c.position, ...extra, ...dup]);
  const r = repairMesh({ position: pos });
  ok(r.stats.degenerate === 2, 'two empty triangles, got ' + r.stats.degenerate);
  ok(r.stats.duplicate === 1, 'one doubled triangle, got ' + r.stats.duplicate);
  ok(r.stats.trisAfter === 12, 'back to 12 triangles, got ' + r.stats.trisAfter);
}
{ // switches off
  const c = cubeSoup(); const r = repairMesh({ position: c.position }, { weld: false, degenerate: false, orient: false });
  ok(!r.changed && r.stats.vertsAfter === 36, 'nothing asked, nothing done');
}
{ // materials keep their groups
  const c = cubeSoup();
  const r = repairMesh({ position: c.position, groups: [{ start: 0, count: 18, materialIndex: 0 }, { start: 18, count: 18, materialIndex: 1 }] });
  ok(r.groups.length === 2 && r.groups[0].count === 18 && r.groups[1].materialIndex === 1 && r.groups[1].start === 18, 'two groups kept: ' + JSON.stringify(r.groups));
}
{ // uv seams survive the weld
  const c = cubeSoup(); const uv = new Float32Array(36 * 2); for (let i = 0; i < 36; i++) { uv[i * 2] = i < 18 ? 0 : 0.5; uv[i * 2 + 1] = 0; }
  const r = repairMesh({ position: c.position, uv });
  ok(r.stats.vertsAfter > 8, 'the seam between two uv islands is not welded shut: ' + r.stats.vertsAfter);
}
{ // keepNearSeen: a seen triangle keeps its neighbours at the corners, and not the far ones
  const pos = Float32Array.from([0,0,0, 1,0,0, 0,1,0,   1,0,0, 1,1,0, 0,1,0,   5,5,5, 6,5,5, 5,6,5]);
  const r = keepNearSeen(pos, null, Uint8Array.from([1, 0, 0]), 0, true);
  ok(r.keep[0] === 1 && r.keep[1] === 1 && r.keep[2] === 0, 'the neighbour stays, the far one goes: ' + Array.from(r.keep));
  const r2 = keepNearSeen(pos, null, Uint8Array.from([1, 0, 0]), 0, false);
  ok(r2.kept === 1, 'without the margin only the seen one stays');
}
{ ok(weldIds(Float32Array.from([0,0,0, 0,0,0, 1,0,0]), 1e-6).count === 2, 'weld count'); }
{ ok(parseCount('12') === 12 && parseCount('1.5k') === 1500 && parseCount('2m') === 2e6 && Number.isNaN(parseCount('abc')), 'counts'); }
{ ok(wildcardTest('screw*', 'Screw M4') && wildcardTest('M?', 'm4') && !wildcardTest('M?', 'M44') && wildcardTest('a.b', 'a.b') && !wildcardTest('a.b', 'axb'), 'wildcards'); }
// speed: a grid of 200k triangles
{ const N = 316, pos = []; for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const a = [i, j, 0], b = [i + 1, j, 0], c = [i, j + 1, 0], d = [i + 1, j + 1, 0]; pos.push(...a, ...b, ...c, ...b, ...d, ...c); }
  const t0 = performance.now(); const r = repairMesh({ position: Float32Array.from(pos) }); const ms = performance.now() - t0;
  ok(r.stats.vertsAfter === (N + 1) * (N + 1), 'grid welds to ' + (N + 1) * (N + 1) + ', got ' + r.stats.vertsAfter);
  ok(ms < 8000, '200k triangles in under 8 s, took ' + Math.round(ms) + ' ms'); console.log('200k triangles repaired in ' + Math.round(ms) + ' ms'); }
// far from the origin: two different cells must not wrap to the same number, and doubled triangles are found
{ const off = 3e6, c = cubeSoup(); const pos = Float32Array.from(c.position, (x, i) => x * 1000 + (i % 3 === 0 ? off : 0));
  const r = repairMesh({ position: pos }); ok(r.stats.vertsAfter === 8, 'a cube 3e6 away welds to 8, got ' + r.stats.vertsAfter);
  const dbl = Float32Array.from([...c.position, ...c.position]); const r2 = repairMesh({ position: dbl });
  ok(r2.stats.duplicate === 12 && r2.stats.trisAfter === 12, 'a doubled cube loses 12 triangles, lost ' + r2.stats.duplicate); }
// several material groups come out in their own ranges
{ const c = cubeSoup(); const r = repairMesh({ position: c.position, groups: [{ start: 0, count: 18, materialIndex: 0 }, { start: 18, count: 18, materialIndex: 1 }] });
  ok(r.groups.length === 2 && r.groups[0].start === 0 && r.groups[1].start === r.groups[0].count && r.groups[0].count + r.groups[1].count === 36, 'two groups kept: ' + JSON.stringify(r.groups)); }
if (fails) { console.error(fails + ' failed'); process.exit(1); }
console.log('meshrepair: all checks pass');
// Align: a piece that is inside-out all over, with a gap in it, is turned outward; an open sheet is left as it is
{
  const position = new Float32Array([0,0,0, 1,0,0, 0,1,0, 0,0,1]);
  const open = repairMesh({ position, index: Uint32Array.from([0,1,2, 0,3,1, 0,2,3]) }, { weld: false, degenerate: false, orient: true, outward: true });
  console.assert(open.stats.flipped === 3, 'open inside-out piece is turned outward, got ' + open.stats.flipped);
  const sheet = repairMesh({ position: new Float32Array([0,0,0, 1,0,0, 0,1,0, 1,1,0]), index: Uint32Array.from([0,1,2, 1,3,2]) }, { weld: false, degenerate: false, orient: true, outward: true });
  console.assert(sheet.stats.flipped === 0, 'a flat sheet is not turned, got ' + sheet.stats.flipped);
  console.log('meshrepair: align checks pass');
}

{ // a sound CAD cube: 24 vertices (four per face, each with the face's normal). The weld joins the faces for the topology, but every
  // corner keeps its normal, so the part comes out as it went in and counts as unchanged. (It used to come out with 8 vertices and the
  // first corner's normal on each: every hard edge smoothed, and "repaired".)
  const corners = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
  const faces = [[[0,3,2,1],[0,0,-1]], [[4,5,6,7],[0,0,1]], [[0,1,5,4],[0,-1,0]], [[2,3,7,6],[0,1,0]], [[1,2,6,5],[1,0,0]], [[3,0,4,7],[-1,0,0]]];
  const pos = [], nrm = [], idx = [];
  for (const [q, nn] of faces) { const b = pos.length / 3; for (const c of q) { pos.push(...corners[c]); nrm.push(...nn); } idx.push(b, b + 1, b + 2, b, b + 2, b + 3); }
  const cube = { position: Float32Array.from(pos), normal: Float32Array.from(nrm), index: Uint32Array.from(idx) };
  const r = repairMesh(cube);
  ok(r.stats.vertsAfter === 24, 'a cube with flat normals keeps its 24 vertices, got ' + r.stats.vertsAfter);
  ok(r.changed === false, 'a sound cube is unchanged');
  ok(r.stats.flipped === 0 && r.stats.trisAfter === 12, 'nothing turned, 12 triangles');
  let sameNormal = true;
  for (let t = 0; t < r.index.length; t += 3) {           // each triangle's corners carry the normal of their face
    const a = r.position, nx = r.normal;
    const ax = a[r.index[t] * 3], ay = a[r.index[t] * 3 + 1], az = a[r.index[t] * 3 + 2];
    const bx = a[r.index[t + 1] * 3], by = a[r.index[t + 1] * 3 + 1], bz = a[r.index[t + 1] * 3 + 2];
    const cx = a[r.index[t + 2] * 3], cy = a[r.index[t + 2] * 3 + 1], cz = a[r.index[t + 2] * 3 + 2];
    const fx = (by - ay) * (cz - az) - (bz - az) * (cy - ay), fy = (bz - az) * (cx - ax) - (bx - ax) * (cz - az), fz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const L = Math.hypot(fx, fy, fz);
    for (let k = 0; k < 3; k++) { const v = r.index[t + k] * 3; const d = (nx[v] * fx + nx[v + 1] * fy + nx[v + 2] * fz) / L; if (d < 0.999) sameNormal = false; }
  }
  ok(sameNormal, 'every corner keeps the normal of its face');
  const r2 = repairMesh(cube, { normals: true });
  ok(r2.stats.vertsAfter === 8 && r2.changed === true, 'with the normals to be rebuilt, the corners weld to 8 vertices, got ' + r2.stats.vertsAfter);
  const soup = cubeSoup();
  const flat = []; for (let t = 0; t < 12; t++) { const [a, b, c] = [0, 1, 2].map(k => soup.position.subarray((t * 3 + k) * 3, (t * 3 + k) * 3 + 3)); const u = [b[0]-a[0], b[1]-a[1], b[2]-a[2]], v = [c[0]-a[0], c[1]-a[1], c[2]-a[2]]; const nn = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]]; const L = Math.hypot(...nn); for (let k = 0; k < 3; k++) flat.push(nn[0]/L, nn[1]/L, nn[2]/L); }
  const r3 = repairMesh({ position: soup.position, normal: Float32Array.from(flat) });
  ok(r3.stats.vertsAfter === 24 && edgesConsistent({ index: Uint32Array.from(r3.index) }) === false && r3.stats.trisAfter === 12, 'a soup with flat normals welds to 24 vertices (one per corner and face), got ' + r3.stats.vertsAfter);
  if (fails) { console.error(fails + ' check(s) failed'); process.exit(1); }
  console.log('meshrepair: normal checks pass');
}
{ // Align across uv seams: a cube with every face its own four corners and uvs (as CAD exports do), all faces turned inward
  const faces = [[0,1,2,3],[5,4,7,6],[4,0,3,7],[1,5,6,2],[3,2,6,7],[4,5,1,0]];
  const C = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
  const pos = [], uv = [], idx = [];
  for (const f of faces) { const b = pos.length / 3; f.forEach((k, i) => { pos.push(...C[k]); uv.push(i & 1, i >> 1); }); idx.push(b, b + 1, b + 2, b, b + 2, b + 3); }
  const r = repairMesh({ position: Float32Array.from(pos), uv: Float32Array.from(uv), index: Uint32Array.from(idx) }, { degenerate: false, outward: true });
  ok(r.stats.flipped === 12, 'an inside-out cube with uv seams has all 12 faces turned, turned ' + r.stats.flipped);
  ok(signedVolume(r) > 0.99, 'and faces outward after, volume ' + signedVolume(r));
  ok(r.uv && r.stats.vertsAfter > 8, 'the uv seams stay (more than the 8 corners), got ' + r.stats.vertsAfter);
}
{ // a small patch turned the other way on an open sheet is turned to match the rest, also when the walk starts in the patch
  const N = 10, pos = [], idx = [];
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) pos.push(i, j, 0);
  const at = (i, j) => j * (N + 1) + i;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { idx.push(at(i, j), at(i + 1, j), at(i + 1, j + 1)); idx.push(at(i, j), at(i + 1, j + 1), at(i, j + 1)); }   // facing +z
  for (const t of [0, 1, 2, 3]) { const x = idx[t * 3 + 1]; idx[t * 3 + 1] = idx[t * 3 + 2]; idx[t * 3 + 2] = x; }   // the first four (where the walk starts) face -z
  const r = repairMesh({ position: Float32Array.from(pos), index: Uint32Array.from(idx) }, { degenerate: false, outward: true });
  ok(r.stats.flipped === 4, 'only the 4 triangles of the patch are turned, turned ' + r.stats.flipped);
  let up = 0; const p = r.position, x = r.index;
  for (let t = 0; t < x.length; t += 3) { const a = x[t] * 3, b = x[t + 1] * 3, c = x[t + 2] * 3; if ((p[b] - p[a]) * (p[c + 1] - p[a + 1]) - (p[b + 1] - p[a + 1]) * (p[c] - p[a]) > 0) up++; }
  ok(up === N * N * 2, 'every triangle faces +z after, ' + up + ' of ' + N * N * 2);
  if (fails) { console.error(fails + ' check(s) failed'); process.exit(1); }
  console.log('meshrepair: align checks pass');
}
{ // edges shared by three or more triangles and pinched corners are taken apart, and the Model inspector's check (meshcheck.js) agrees
  const { checkMesh } = await import('../app/js/meshcheck.js');
  // an outward box from (x0,y0,z0) to (x1,y1,z1), as 8 shared corners and 12 triangles
  const box = (P, I, x0, y0, z0, x1, y1, z1) => {
    const b = P.length / 3;
    for (const [x, y, z] of [[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]]) P.push(x, y, z);
    for (const t of [[0,3,2],[0,2,1],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[2,3,7],[2,7,6],[1,2,6],[1,6,5],[3,0,4],[3,4,7]]) I.push(b + t[0], b + t[1], b + t[2]);
  };
  const run = (P, I, extra = {}) => {
    const r = repairMesh({ position: Float32Array.from(P), index: Uint32Array.from(I), ...extra }, { manifold: true });
    return { r, c: checkMesh(r.position, r.index) };
  };
  { // two boxes that share an edge
    const P = [], I = []; box(P, I, 0, 0, 0, 1, 1, 1); box(P, I, 1, 1, 0, 2, 2, 1);
    const before = checkMesh(Float32Array.from(P), Uint32Array.from(I));
    ok(before.nonManifoldEdges > 0, 'two boxes on one edge: the check sees edges shared by more than two triangles, ' + before.nonManifoldEdges);
    const { r, c } = run(P, I);
    ok(c.nonManifoldEdges === 0 && c.nonManifoldVertices === 0, 'after: no such edges or pinched corners, got ' + c.nonManifoldEdges + ' / ' + c.nonManifoldVertices);
    ok(r.stats.trisAfter === 24 && c.insideOut === 0, 'every triangle stays and nothing is inside out');
    ok(r.stats.splitEdges > 0 && r.stats.splitCorners === 2, 'it says what it split: ' + r.stats.splitEdges + ' edges at ' + r.stats.splitCorners + ' points');
  }
  { // two boxes that touch at one corner
    const P = [], I = []; box(P, I, 0, 0, 0, 1, 1, 1); box(P, I, 1, 1, 1, 2, 2, 2);
    const before = checkMesh(Float32Array.from(P), Uint32Array.from(I));
    ok(before.nonManifoldVertices > 0, 'two boxes on one corner: the check sees a pinched corner');
    const { r, c } = run(P, I);
    ok(c.nonManifoldVertices === 0, 'after: no pinched corner, got ' + c.nonManifoldVertices);
    let far = 0; for (let i = 0; i < r.position.length; i++) far = Math.max(far, Math.abs(r.position[i] - Math.round(r.position[i])));
    ok(far > 0 && far < 1e-3, 'the copy moved by a hair only: ' + far);
  }
  { // a fin standing on a sheet, along one edge
    const P = [0,0,0, 1,0,0, 1,1,0, 0,1,0, 2,0,0, 2,1,0, 1,0,1, 1,1,1], I = [0,1,2, 0,2,3, 1,4,5, 1,5,2, 1,2,7, 1,7,6];
    const { r, c } = run(P, I);
    ok(c.nonManifoldEdges === 0 && c.nonManifoldVertices === 0, 'a fin on a sheet: after, no such edges or pinched corners, got ' + c.nonManifoldEdges + ' / ' + c.nonManifoldVertices);
    ok(r.stats.trisAfter === 6, 'the fin stays');
  }
  { // a sound box is left as it is
    const P = [], I = []; box(P, I, 0, 0, 0, 1, 1, 1);
    const { r } = run(P, I);
    ok(!r.changed && r.stats.splitCorners === 0, 'a sound box is not changed');
  }
  { // a triangle stored twice with other uvs is doubled all the same
    const P = [0,0,0, 1,0,0, 0,1,0, 0,0,0, 1,0,0, 0,1,0], UV = [0,0, 1,0, 0,1, .5,.5, .6,.5, .5,.6];
    const r = repairMesh({ position: Float32Array.from(P), uv: Float32Array.from(UV), index: Uint32Array.from([0,1,2, 3,4,5]) });
    ok(r.stats.duplicate === 1 && r.stats.trisAfter === 1, 'a doubled triangle with other uvs is removed, duplicates ' + r.stats.duplicate);
  }
  if (fails) { console.error(fails + ' check(s) failed'); process.exit(1); }
  console.log('meshrepair: manifold checks pass');
}
{ // a turned face keeps its own corners: an inside-out box whose 8 corners are shared by its triangles and carry normals comes out whole
  const { checkMesh } = await import('../app/js/meshcheck.js');
  const V = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
  const F = [[0,3,2],[0,2,1],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[2,3,7],[2,7,6],[1,2,6],[1,6,5],[3,0,4],[3,4,7]];
  const pos = Float32Array.from(V.flat()), nrm = Float32Array.from(V.flat().map(x => (x - 0.5) / Math.sqrt(0.75)));
  const index = Uint32Array.from(F.flatMap(([a, b, c]) => [a, c, b]));          // every face wound inward
  const r = repairMesh({ position: pos, normal: nrm, index }, { manifold: true });
  const ch = checkMesh(r.position, r.index);
  ok(r.stats.flipped === 12, 'all 12 faces turned, turned ' + r.stats.flipped);
  ok(ch.degenerate === 0 && ch.duplicate === 0 && ch.nonManifoldEdges === 0 && ch.insideOut === 0 && ch.inconsistent === 0,
    'and the box is whole after: ' + JSON.stringify({ degenerate: ch.degenerate, duplicate: ch.duplicate, nonManifoldEdges: ch.nonManifoldEdges, insideOut: ch.insideOut, inconsistent: ch.inconsistent }));
  ok(signedVolume(r) > 0.99 && signedVolume(r) < 1.01, 'volume 1 after, got ' + signedVolume(r));
  if (fails) { console.error(fails + ' check(s) failed'); process.exit(1); }
  console.log('meshrepair: turned-corner checks pass');
}
