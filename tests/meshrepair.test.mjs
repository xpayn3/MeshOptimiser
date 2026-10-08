// node tests/meshrepair.test.mjs: the arithmetic of Repair mesh and Remove hidden faces
import { repairMesh, keepNearSeen, weldIds, parseCount, wildcardTest } from '../meshrepair.js';
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
if (fails) { console.error(fails + ' failed'); process.exit(1); }
console.log('meshrepair: all checks pass');
