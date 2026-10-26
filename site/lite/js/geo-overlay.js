// geo-overlay.js — draws where the faults of a mesh are (the lists meshcheck.js gives with opts.detail), on top of the model.
//
//   KINDS      what can be shown: its label, the token its colour comes from (--geo-*), and how it is drawn
//   countOf(r, kind)   how many of that kind a checkMesh result has (0: nothing to show)
//   build(THREE, geometry, detail, kind, color)   a THREE.Object3D in the mesh's own coordinates, or null when there is nothing to draw
//
// Edges are lines, and so are the corners of triangles with no area (with a point on each corner, so a collapsed triangle can be seen
// at all); triangles that are wrong in some other way are filled; pinched corners are points. Lines and points are drawn over the model
// (they are few, and a fault behind a part is still one); filled triangles sit on the surface, pulled a little towards the eye.
// Nothing here can be picked or exported: it is a view of the check, not part of the scene.

export const KINDS = [
  { key: 'open',     label: 'Open edges',                  note: 'Edges that only one triangle has: the rim of a hole or a sheet', color: '--geo-open',   count: (r) => r.openEdges,           draw: 'edges' },
  { key: 'nonman',   label: 'Edges with 3+ triangles',     note: 'Ribs, doubled faces, pieces glued along an edge',               color: '--geo-nonman', count: (r) => r.nonManifoldEdges,    draw: 'edges' },
  { key: 'flip',     label: 'Faces turned the wrong way',  note: 'Triangles that disagree with their neighbours about which side is out', color: '--geo-flip', count: (r) => r.inconsistent,   draw: 'tris+edges' },
  { key: 'inside',   label: 'Parts turned inside out',     note: 'Closed pieces whose faces all point inward',                    color: '--geo-inside', count: (r) => r.insideOut,           draw: 'tris' },
  { key: 'degen',    label: 'Triangles with no area',      note: 'Collapsed to a line or a point',                                color: '--geo-degen',  count: (r) => r.degenerate,          draw: 'degenerate' },
  { key: 'dup',      label: 'The same triangle twice',     note: 'Stacked faces that flicker',                                    color: '--geo-dup',    count: (r) => r.duplicate,           draw: 'tris' },
  { key: 'pinch',    label: 'Pinched corners',             note: 'Two surfaces touching at a point',                              color: '--geo-pinch',  count: (r) => r.nonManifoldVertices, draw: 'points' },
  { key: 'sliver',   label: 'Long thin triangles',         note: 'Needles: not always a fault (a fine fillet has them)',          color: '--geo-sliver', count: (r) => r.slivers,             draw: 'tris' },
];
export const kindOf = (key) => KINDS.find((k) => k.key === key);

const TRIS = { flip: 'inconsistentTris', inside: 'insideOutTris', dup: 'duplicate', sliver: 'sliver' };

function mark(o, name) { o.name = name; o.raycast = () => {}; o.frustumCulled = false; o.userData.noPick = true; o.userData.noExport = true; return o; }

// the three corners of each of the triangles in `list`, as indices into the geometry's position attribute
function cornersOf(geometry, list) {
  const ix = geometry.index ? geometry.index.array : null, out = new Uint32Array(list.length * 3);
  for (let i = 0; i < list.length; i++) { const t = list[i]; for (let k = 0; k < 3; k++) out[i * 3 + k] = ix ? ix[t * 3 + k] : t * 3 + k; }
  return out;
}

export function build(THREE, geometry, detail, kind, color) {
  const K = kindOf(kind); if (!K || !detail || !geometry) return null;
  const group = new THREE.Group();
  const lines = (arr, order) => {
    if (!arr || !arr.length) return;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(arr), 3));
    const m = new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true });
    group.add(mark(Object.assign(new THREE.LineSegments(g, m), { renderOrder: order }), '__geo_lines'));
  };
  const points = (arr, size) => {
    if (!arr || !arr.length) return;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(arr), 3));
    const m = new THREE.PointsMaterial({ color, size, sizeAttenuation: false, depthTest: false, transparent: true });
    group.add(mark(Object.assign(new THREE.Points(g, m), { renderOrder: 999 }), '__geo_points'));
  };
  const fill = (list) => {
    if (!list || !list.length) return;
    const pa = geometry.attributes && geometry.attributes.position; if (!pa) return;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', pa); g.setIndex(new THREE.BufferAttribute(cornersOf(geometry, list), 1));
    const m = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    group.add(mark(Object.assign(new THREE.Mesh(g, m), { renderOrder: 997 }), '__geo_tris'));
  };
  if (K.key === 'open') lines(detail.openEdges, 998);
  else if (K.key === 'nonman') lines(detail.nonManifoldEdges, 998);
  else if (K.key === 'flip') { fill(detail[TRIS.flip]); lines(detail.inconsistentEdges, 998); }
  else if (K.key === 'degen') {
    const pa = geometry.attributes.position, ix = geometry.index ? geometry.index.array : null, e = [], c = [];
    for (const t of detail.degenerate) {
      const v = [0, 1, 2].map((k) => ix ? ix[t * 3 + k] : t * 3 + k), P = v.map((i) => [pa.getX(i), pa.getY(i), pa.getZ(i)]);
      for (let k = 0; k < 3; k++) { e.push(...P[k], ...P[(k + 1) % 3]); }
      c.push((P[0][0] + P[1][0] + P[2][0]) / 3, (P[0][1] + P[1][1] + P[2][1]) / 3, (P[0][2] + P[1][2] + P[2][2]) / 3);
    }
    lines(e, 998); points(c, 7);
  }
  else if (K.key === 'pinch') points(detail.pinched, 8);
  else fill(detail[TRIS[K.key]]);
  if (!group.children.length) return null;
  return mark(group, '__geo_' + kind);
}

// A copy of a built overlay for one more part: the buffers and materials are shared with it, only the nodes are new. (Object3D.clone does not
// carry the no-pick override, so it is put back.)
export function instance(tpl) {
  const c = tpl.clone();
  c.traverse((o) => { o.raycast = () => {}; o.frustumCulled = false; o.userData.noPick = true; o.userData.noExport = true; });
  return c;
}

// Frees what an overlay made (its own buffers and materials; the position attribute of a filled one belongs to the mesh).
export function dispose(obj) {
  obj.traverse((o) => {
    if (o.material) { try { o.material.dispose(); } catch (_) {} }
    if (o.geometry && o.name !== '__geo_tris') { try { o.geometry.dispose(); } catch (_) {} }
    else if (o.geometry) { try { o.geometry.index = null; } catch (_) {} }
  });
}
