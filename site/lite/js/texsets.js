// Texture sets found by name beside a model. An FBX or OBJ from a library (Fab, Megascans, Poly Haven, Sketchfab downloads) often names
// no picture at all: the maps sit next to it as <name>_<resolution>_<kind>.jpg (Wooden_Table_veigfjmaw_High_4K_BaseColor.jpg). This
// reads the kind from the end of each picture's name, groups the pictures that share the rest of it into a set, and picks the set for a
// material by its name, its part's name or the model's. No THREE here: app.js loads the pictures and fills the slots.

export const IMAGE_EXT = /\.(jpe?g|png|webp|avif|bmp|gif)$/i;     // (what the browser decodes; .tga, .tif and .exr are not read)

// kind -> the words that name it at the end of a picture's name (separators between the words optional)
const KINDS = [
  ['map',       ['base color', 'basecolour', 'base colour', 'basecolor', 'albedo', 'diffuse', 'diff', 'colour', 'color', 'col']],
  ['normal',    ['normal gl', 'normal opengl', 'normal', 'nrm', 'nor']],
  ['normalDX',  ['normal dx', 'normal directx']],
  ['roughness', ['roughness', 'rough', 'rgh']],
  ['gloss',     ['glossiness', 'gloss']],
  ['ao',        ['ambient occlusion', 'ambientocclusion', 'occlusion', 'ao']],
  ['metalness', ['metalness', 'metallic', 'metal']],
  ['opacity',   ['opacity', 'transparency', 'alpha']],
  ['bump',      ['bump']],
];
const SEP = '[\\s_.\\-]*';
const KIND_RE = KINDS.map(([kind, words]) => [kind, new RegExp('(?:^|[\\s_.\\-])(' + words.map(w => w.split(' ').join(SEP)).join('|') + ')$', 'i')]);
const RES_RE = /(?:^|[\s_.\-])(\d{1,2}k|\d{3,5}(?:px)?)$/i;               // 4K, 8k, 2048, 1024px
const LEFT_SEP = /[\s_.\-]+$/;

// "Wooden_Table_High_4K_BaseColor.jpg" -> { kind: 'map', prefix: 'Wooden_Table_High', res: 4096 }, or null when no kind is named.
export function readTextureName(name) {
  let stem = String(name).split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
  let res = 0;
  const takeRes = () => { const r = RES_RE.exec(stem); if (!r) return; const t = r[1].toLowerCase(); res = /k$/.test(t) ? parseInt(t, 10) * 1024 : parseInt(t, 10); stem = stem.slice(0, r.index).replace(LEFT_SEP, ''); };
  takeRes();                                                                  // ("Wood_Normal_4K": the resolution after the kind)
  for (const [kind, re] of KIND_RE) {
    const m = re.exec(stem);
    if (!m) continue;
    stem = stem.slice(0, m.index + (m[0].length - m[1].length)).replace(LEFT_SEP, '');
    if (!res) takeRes();
    return { kind, prefix: stem, res };
  }
  return null;
}

// Names (or { name } objects) -> the sets: [{ prefix, files: { kind: item } }], the biggest set first. For two pictures of one kind
// the larger resolution wins, then a JPEG or PNG over the rest. Pictures that name no kind (Cavity, Specular, Displacement) are listed
// in `unused` with the set they belong to, so the toast can say they were left.
export function groupTextureFiles(items) {
  const sets = new Map(), unused = [];
  const rank = (n) => /\.(jpe?g|png)$/i.test(n) ? 1 : 0;
  for (const it of items) {
    const name = typeof it === 'string' ? it : it && it.name;
    if (!name || !IMAGE_EXT.test(name)) continue;
    const r = readTextureName(name);
    if (!r) { unused.push(name); continue; }
    const key = r.prefix.toLowerCase();
    let s = sets.get(key);
    if (!s) { s = { prefix: r.prefix, files: {}, res: {} }; sets.set(key, s); }
    const had = s.files[r.kind], hadName = had && (typeof had === 'string' ? had : had.name);
    if (!had || r.res > s.res[r.kind] || (r.res === s.res[r.kind] && rank(name) > rank(hadName))) { s.files[r.kind] = it; s.res[r.kind] = r.res; }
  }
  const out = [...sets.values()].filter(s => s.files.map || s.files.normal || s.files.normalDX || s.files.roughness || s.files.gloss);
  out.sort((a, b) => Object.keys(b.files).length - Object.keys(a.files).length);
  return { sets: out.map(({ prefix, files }) => ({ prefix, files })), unused };
}

const squash = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
// How well a set's prefix fits a name: 0 not at all, else the length of what they share (one inside the other).
function fit(prefix, name) {
  const p = squash(prefix), n = squash(name);
  if (!p || !n) return 0;
  if (p === n) return 1000 + p.length;
  if (n.includes(p)) return p.length;
  if (p.includes(n) && n.length >= 3) return n.length;
  return 0;
}

// The set for one material: the one whose prefix fits the material's name, the part's name, a picture the material already has, or the
// model file's name best; with a single set, that set whatever the names say (a folder of one model and its maps).
export function pickSet(sets, { materialName = '', meshName = '', mapName = '', fileStem = '' } = {}) {
  if (!sets.length) return null;
  if (sets.length === 1) return sets[0];
  let best = null, score = 0;
  for (const s of sets) {
    const own = mapName && s.files.map && squash((typeof s.files.map === 'string' ? s.files.map : s.files.map.name)) === squash(mapName) ? 5000 : 0;
    const f = Math.max(own, fit(s.prefix, materialName), fit(s.prefix, meshName), fit(s.prefix, fileStem) * 0.5);
    if (f > score) { score = f; best = s; }
  }
  return best;
}

// The slots a set fills on a standard material, given the slots it has already: { slot: { kind, invert } }. Roughness comes from Gloss
// turned over when there is no Roughness; Bump is used only when there is no normal map; a DirectX normal map only when there is no
// OpenGL one (its green is turned by the slot's normalScale.y = -1).
export function planSlots(set, filled = {}) {
  const f = set.files, out = {};
  const put = (slot, kind, extra) => { if (!filled[slot] && f[kind]) out[slot] = Object.assign({ kind }, extra); };
  put('map', 'map');
  if (f.normal) put('normalMap', 'normal'); else put('normalMap', 'normalDX', { flipGreen: true });
  if (f.roughness) put('roughnessMap', 'roughness'); else put('roughnessMap', 'gloss', { invert: true });
  put('aoMap', 'ao');
  put('metalnessMap', 'metalness');
  put('alphaMap', 'opacity');
  if (!f.normal && !f.normalDX && !filled.normalMap) put('bumpMap', 'bump');
  return out;
}
