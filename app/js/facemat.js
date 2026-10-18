// facemat.js: several colours on one part, as Cinema 4D has them (one object, several materials, each on a selection of its faces).
//
// A part with more than one material has an array of materials and geometry groups ({ start, count, materialIndex }, in index
// entries, three.js style). Here the groups are runs: the triangles keep the order they have (Edit mesh numbers its polygons by it,
// the CAD faces of a STEP part are runs of it, the polygons of an OBJ or FBX are numbered by it), each run of triangles that wear the
// same material is one group, and the groups cover every triangle in order. Material 0 is the part's main material: a face that is
// given back goes to it, and a material dropped on the whole part takes its place (the faces in other colours keep theirs, as a
// selection tag keeps its material in Cinema 4D).
//
// Everything here works on plain arrays: no three.js, so the tests run it in node.

// The material of each triangle (0 where no group says).
export function triMaterials(groups, nTri) {
  const out = new Uint16Array(nTri);
  if (!groups) return out;
  for (const g of groups) {
    const mi = g.materialIndex | 0;
    if (!mi) continue;
    const a = Math.max(0, (g.start / 3) | 0), b = Math.min(nTri, ((g.start + g.count) / 3) | 0);
    for (let t = a; t < b; t++) out[t] = mi;
  }
  return out;
}

// The groups for a material a triangle: one run each, in triangle order, covering every triangle.
export function runs(triMat) {
  const out = [];
  const n = triMat.length;
  let t = 0;
  while (t < n) {
    const mi = triMat[t];
    let e = t + 1;
    while (e < n && triMat[e] === mi) e++;
    out.push({ start: t * 3, count: (e - t) * 3, materialIndex: mi });
    t = e;
  }
  return out;
}

// Do the groups already cover every triangle once, in order? (Then a geometry is drawn whole whatever material array it wears.)
export function covers(groups, indexCount) {
  if (!groups || !groups.length) return false;
  let at = 0;
  for (const g of groups) { if (g.start !== at || g.count <= 0) return false; at += g.count; }
  return at === indexCount;
}

// The picked triangles (pick[t] truthy) wear material `mi`.
export function paint(triMat, pick, mi) {
  const out = Uint16Array.from(triMat);
  for (let t = 0; t < out.length && t < pick.length; t++) if (pick[t]) out[t] = mi;
  return out;
}

// One entry a material: the same material twice (by reference, or by `same(a, b)`) becomes one, a material no triangle wears is
// dropped, and the main material (0) stays first whether a triangle wears it or not. Returns { triMat, mats }.
export function tidy(triMat, mats, same) {
  const eq = same || ((a, b) => a === b);
  const n = mats.length;
  const to = new Int32Array(n);
  for (let i = 0; i < n; i++) { to[i] = i; for (let j = 0; j < i; j++) if (to[j] === j && eq(mats[i], mats[j])) { to[i] = j; break; } }
  const used = new Uint8Array(n); used[0] = 1;
  for (let t = 0; t < triMat.length; t++) used[to[triMat[t]] ?? 0] = 1;
  const nu = new Int32Array(n).fill(-1), out = [];
  for (let i = 0; i < n; i++) if (to[i] === i && used[i]) { nu[i] = out.length; out.push(mats[i]); }
  const tm = new Uint16Array(triMat.length);
  for (let t = 0; t < triMat.length; t++) { const k = nu[to[triMat[t]] ?? 0]; tm[t] = k < 0 ? 0 : k; }
  return { triMat: tm, mats: out };
}

// How many triangles wear each material: [{ materialIndex, tris, first }] in material order (first: its first triangle).
export function census(triMat, nMat) {
  const tris = new Uint32Array(nMat), first = new Int32Array(nMat).fill(-1);
  for (let t = 0; t < triMat.length; t++) { const m = triMat[t]; if (m < nMat) { tris[m]++; if (first[m] < 0) first[m] = t; } }
  const out = [];
  for (let m = 0; m < nMat; m++) out.push({ materialIndex: m, tris: tris[m], first: first[m] });
  return out;
}

// Several meshes of one object (the primitives of a glTF mesh: one a material) as one triangle list: the material of each
// triangle, in the order the meshes are joined. counts: the triangles of each mesh; mats: the material number of each.
export function joined(counts, mats) {
  let n = 0;
  for (const c of counts) n += c;
  const out = new Uint16Array(n);
  let o = 0;
  counts.forEach((c, i) => { out.fill(mats[i] | 0, o, o + c); o += c; });
  return out;
}
