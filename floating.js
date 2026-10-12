// floating.js — find the small pieces of a mesh that touch nothing.
//
// A mesh is made of pieces: triangles that share corners (the same place, within a hair) belong to one piece. A part is
// usually one big piece, but CAD exports and hole closing leave small loose ones behind: the plug a hole was cut with, a
// shaving, a dot of a thread. They hang in the air next to the part and touch nothing.
//
// This finds them. The biggest piece of the part is always kept; any other piece whose longest side is under `maxSize`
// (in the mesh's own units) is floating and goes. Pure function: the app calls it per part, the tests call it from Node.
//
//   positions   Float32Array, xyz per vertex
//   index       triangle index array (null: every three vertices are a triangle)
//   opts.maxSize        the longest side a loose piece may have to be removed (default: nothing is removed)
//   opts.maxTriangles   (optional) a loose piece with more triangles than this is kept
// Returns { pieces, removedPieces, removedTris, removed, kept } — `removed` is a Uint8Array over the triangles (1 = remove).

export function findFloating(positions, index, opts = {}) {
  const vCount = (positions.length / 3) | 0;
  const T = index ? (index.length / 3) | 0 : (vCount / 3) | 0;
  const result = { pieces: 0, removedPieces: 0, removedTris: 0, removed: new Uint8Array(T), kept: T };
  const maxSize = +opts.maxSize;
  if (!(T > 1) || !(maxSize > 0)) return result;
  const vi = (t, k) => index ? index[t * 3 + k] : t * 3 + k;

  // weld by position: vertices at one place are one corner (CAD tessellation gives every face corners of its own)
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  const diag = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
  if (!(diag > 0)) return result;
  const inv = 1 / (diag * 1e-6);
  const wid = new Int32Array(vCount);
  let cap = 1; while (cap < vCount * 2) cap <<= 1;
  const table = new Int32Array(cap).fill(-1);
  const qx = new Int32Array(vCount), qy = new Int32Array(vCount), qz = new Int32Array(vCount);
  let W = 0;
  for (let v = 0; v < vCount; v++) {
    const ix = Math.round((positions[v * 3] - x0) * inv), iy = Math.round((positions[v * 3 + 1] - y0) * inv), iz = Math.round((positions[v * 3 + 2] - z0) * inv);
    let h = (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) & (cap - 1);
    for (;;) {
      const w = table[h];
      if (w < 0) { table[h] = W; qx[W] = ix; qy[W] = iy; qz[W] = iz; wid[v] = W++; break; }
      if (qx[w] === ix && qy[w] === iy && qz[w] === iz) { wid[v] = w; break; }
      h = (h + 1) & (cap - 1);
    }
  }

  // pieces: union the three corners of every triangle
  const parent = new Int32Array(W);
  for (let i = 0; i < W; i++) parent[i] = i;
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  for (let t = 0; t < T; t++) {
    const a = find(wid[vi(t, 0)]), b = find(wid[vi(t, 1)]), c = find(wid[vi(t, 2)]);
    if (a !== b) parent[b] = a;
    const r = find(a);
    if (c !== r) parent[c] = r;
  }

  // size and triangle count of each piece
  const slot = new Map();                                // root → piece number
  const lo = [], hi = [], tris = [];
  const owner = new Int32Array(T);
  for (let t = 0; t < T; t++) {
    const root = find(wid[vi(t, 0)]);
    let s = slot.get(root);
    if (s === undefined) { s = lo.length; slot.set(root, s); lo.push([Infinity, Infinity, Infinity]); hi.push([-Infinity, -Infinity, -Infinity]); tris.push(0); }
    owner[t] = s; tris[s]++;
    for (let k = 0; k < 3; k++) {
      const v = vi(t, k);
      for (let c = 0; c < 3; c++) { const p = positions[v * 3 + c]; if (p < lo[s][c]) lo[s][c] = p; if (p > hi[s][c]) hi[s][c] = p; }
    }
  }
  const n = lo.length;
  result.pieces = n;
  if (n < 2) return result;
  const size = (s) => Math.max(hi[s][0] - lo[s][0], hi[s][1] - lo[s][1], hi[s][2] - lo[s][2]);
  // the piece the part is made of: the longest (the most triangles breaks a tie)
  let main = 0;
  for (let s = 1; s < n; s++) if (size(s) > size(main) || (size(s) === size(main) && tris[s] > tris[main])) main = s;
  const maxTris = +opts.maxTriangles > 0 ? +opts.maxTriangles : Infinity;
  const drop = new Uint8Array(n);
  for (let s = 0; s < n; s++) if (s !== main && size(s) <= maxSize && tris[s] <= maxTris) { drop[s] = 1; result.removedPieces++; }
  if (!result.removedPieces) return result;
  for (let t = 0; t < T; t++) if (drop[owner[t]]) { result.removed[t] = 1; result.removedTris++; }
  result.kept = T - result.removedTris;
  return result;
}
