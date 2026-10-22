// node tests/texsets.test.mjs
// texsets.js: the texture maps beside an FBX or OBJ, found by name.
//   1. readTextureName: the kind at the end of a name, with the resolution before or after it, and the prefix that is left;
//   2. the Fab table folder: one set, colour / normal / roughness / gloss / AO / bump, and Cavity, Displacement, Specular unused;
//   3. planSlots: roughness over gloss, gloss turned over without roughness, bump only without a normal map, DirectX normal flips green,
//      slots already filled are left;
//   4. pickSet: one set for every material; with several, by material name, part name, the material's own picture, the model's name;
//   5. two pictures of one kind: the larger resolution wins; pictures that are not images and names with no kind are left out.
import { readTextureName, groupTextureFiles, planSlots, pickSet } from '../app/js/texsets.js';

let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 1. names
{
  const cases = [
    ['Wooden_Table_veigfjmaw_High_4K_BaseColor.jpg', { kind: 'map', prefix: 'Wooden_Table_veigfjmaw_High', res: 4096 }],
    ['wood_floor_diff_2k.jpg', { kind: 'map', prefix: 'wood_floor', res: 2048 }],
    ['Rock_Normal_DX_4K.png', { kind: 'normalDX', prefix: 'Rock', res: 4096 }],
    ['Rock_Normal-OpenGL.png', { kind: 'normal', prefix: 'Rock', res: 0 }],
    ['metal_plate_rough_1k.jpg', { kind: 'roughness', prefix: 'metal_plate', res: 1024 }],
    ['Barrel Base Color.png', { kind: 'map', prefix: 'Barrel', res: 0 }],
    ['Barrel_Metallic_2048.png', { kind: 'metalness', prefix: 'Barrel', res: 2048 }],
    ['Leaf_Opacity.png', { kind: 'opacity', prefix: 'Leaf', res: 0 }],
    ['Stone_AmbientOcclusion.jpg', { kind: 'ao', prefix: 'Stone', res: 0 }],
    ['C:\\models\\Crate_Glossiness.jpg', { kind: 'gloss', prefix: 'Crate', res: 0 }],
  ];
  for (const [n, want] of cases) { const r = readTextureName(n); check('name ' + n, same(r, want), r); }
  check('no kind -> null', readTextureName('Wooden_Table_4K_Cavity.jpg') === null && readTextureName('Protocol.png') === null && readTextureName('cacao.jpg') === null);
}

// 2. the table folder
const table = ['Wooden_Table_veigfjmaw_High.fbx', 'Wooden_Table_veigfjmaw_High_4K_AO.jpg', 'Wooden_Table_veigfjmaw_High_4K_BaseColor.jpg', 'Wooden_Table_veigfjmaw_High_4K_Bump.jpg',
  'Wooden_Table_veigfjmaw_High_4K_Cavity.jpg', 'Wooden_Table_veigfjmaw_High_4K_Displacement.jpg', 'Wooden_Table_veigfjmaw_High_4K_Gloss.jpg', 'Wooden_Table_veigfjmaw_High_4K_Normal.jpg',
  'Wooden_Table_veigfjmaw_High_4K_Roughness.jpg', 'Wooden_Table_veigfjmaw_High_4K_Specular.jpg', 'veigfjmaw.json'];
const g = groupTextureFiles(table);
check('table: one set', g.sets.length === 1 && g.sets[0].prefix === 'Wooden_Table_veigfjmaw_High', g.sets.map(s => s.prefix));
check('table: its kinds', same(Object.keys(g.sets[0].files).sort(), ['ao', 'bump', 'gloss', 'map', 'normal', 'roughness']), Object.keys(g.sets[0].files));
check('table: unused', same(g.unused.map(n => n.split('_').pop()), ['Cavity.jpg', 'Displacement.jpg', 'Specular.jpg']), g.unused);
check('objects with a name work as names do', groupTextureFiles(table.map(name => ({ name }))).sets[0].files.map.name === 'Wooden_Table_veigfjmaw_High_4K_BaseColor.jpg');

// 3. slots
{
  const p = planSlots(g.sets[0]);
  check('table slots: colour, normal, roughness, AO; no bump, no gloss', same(Object.keys(p).sort(), ['aoMap', 'map', 'normalMap', 'roughnessMap']) && p.roughnessMap.kind === 'roughness', p);
  const gl = planSlots({ files: { map: 'a', gloss: 'b', bump: 'c' } });
  check('gloss turned over when there is no roughness; bump without a normal map', gl.roughnessMap.kind === 'gloss' && gl.roughnessMap.invert === true && gl.bumpMap.kind === 'bump', gl);
  const dx = planSlots({ files: { map: 'a', normalDX: 'b', bump: 'c' } });
  check('a DirectX normal map flips green, and bump is then left', dx.normalMap.kind === 'normalDX' && dx.normalMap.flipGreen === true && !dx.bumpMap, dx);
  const both = planSlots({ files: { normal: 'a', normalDX: 'b' } });
  check('OpenGL normal preferred over DirectX', both.normalMap.kind === 'normal' && !both.normalMap.flipGreen, both);
  const filled = planSlots(g.sets[0], { map: true, normalMap: true });
  check('slots already filled are left', !filled.map && !filled.normalMap && filled.roughnessMap && filled.aoMap, filled);
  const nb = planSlots({ files: { map: 'a', bump: 'c' } }, { normalMap: true });
  check('no bump when the material has a normal map of its own', !nb.bumpMap, nb);
}

// 4. picking
{
  check('one set fits every material', pickSet(g.sets, { materialName: 'lambert1', meshName: 'Object001' }) === g.sets[0]);
  const many = groupTextureFiles(['Chair_Seat_BaseColor.jpg', 'Chair_Seat_Normal.jpg', 'Chair_Legs_BaseColor.jpg', 'Chair_Legs_Roughness.jpg', 'Cushion_Albedo.png']).sets;
  const by = (o) => (pickSet(many, o) || {}).prefix;
  check('three sets', many.length === 3, many.map(s => s.prefix));
  check('by material name', by({ materialName: 'Chair_Legs' }) === 'Chair_Legs' && by({ materialName: 'M_Chair_Seat_01' }) === 'Chair_Seat');
  check('by part name', by({ materialName: 'Material.002', meshName: 'cushion' }) === 'Cushion');
  check('by the material\'s own picture', by({ materialName: 'x', mapName: 'Chair_Legs_BaseColor.jpg' }) === 'Chair_Legs');
  check('nothing fits -> none', pickSet(many, { materialName: 'Material.001', meshName: 'Box', fileStem: 'scene' }) === null);
}

// 5. duplicates and other files
{
  const d = groupTextureFiles(['Wall_BaseColor_2K.jpg', 'Wall_BaseColor_4K.jpg', 'Wall_Normal_4K.tga', 'Wall_Normal_4K.png', 'Wall_Normal_4K.jpg', 'Wall.mtl', 'readme.txt']);
  check('larger resolution wins', d.sets[0].files.map === 'Wall_BaseColor_4K.jpg', d.sets[0].files);
  check('.tga is not read; of the rest, the first JPEG/PNG stays', d.sets[0].files.normal === 'Wall_Normal_4K.png', d.sets[0].files);
  check('a folder with no colour, normal or roughness gives no set', groupTextureFiles(['X_AO.jpg', 'X_Bump.jpg']).sets.length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
