// A part's geometry rebuilt on a UV layout (bake.js unwrapParts): the vertices of the old one are copied by the layout's vertexSrc, so a
// vertex on the border of a chart is there once for each chart it belongs to and every attribute follows; the UVs are the layout's; the
// old UV sets and the vertex colours are left out (the picture carries the colour); one group.
import * as THREE from 'three';

export function layoutGeometry(low, lay) {
  const g = new THREE.BufferGeometry(), n = lay.vertexSrc.length;
  for (const name of Object.keys(low.attributes)) {
    if (name === 'uv' || /^uv\d/.test(name) || name === 'color') continue;      // (the picture replaces the old UVs and the colours: both would be applied twice)
    const a = low.attributes[name], s = a.itemSize, Ctor = a.array.constructor, arr = new Ctor(n * s), get = ['getX', 'getY', 'getZ', 'getW'];
    for (let i = 0; i < n; i++) { const v = lay.vertexSrc[i]; for (let k = 0; k < s; k++) arr[i * s + k] = a[get[k]](v); }
    g.setAttribute(name, new THREE.BufferAttribute(arr, s, a.normalized));
  }
  g.setAttribute('uv', new THREE.BufferAttribute(lay.uv, 2));
  g.setIndex(new THREE.BufferAttribute(lay.index, 1));
  g.addGroup(0, lay.index.length, 0);
  if (!g.attributes.normal) g.computeVertexNormals();
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}
