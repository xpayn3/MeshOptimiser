// Photo mode's stage: the floor under the model and what is behind it.
//
//   contact shadow  the floor darkens where the model stands on it or comes close to it: the model is drawn from under the floor into a
//                   small picture of how near each point of it is to the floor, softened twice (a tight blur for where it touches, a wide
//                   one for the shade under it), and the floor's colour is darkened by it. Made again only when the model changes.
//   reflection      the floor is a little glossy: it shows the model mirrored in it (three's reflector, at half the resolution), stronger
//                   towards grazing angles. Each frame of Photo mode's average looks it up a fraction to the side, so the average blurs it.
//                   (The floor is hidden while its own reflection is drawn, so "bounces" draws no reflection in a reflection.)
//   backdrop        what is behind the model: the dark of the viewport, a soft grey studio sweep, or white; a gradient that the floor
//                   fades into.
//
// createStage({ THREE }) -> { material, updateContact, sample, backdrop, setBackdrop, backdropKind, set, get, setOn, isOn, dispose }

export const STAGE_DEFAULTS = Object.freeze({ contact: 0.75, refl: 0.2 });
export const STAGE_BACKDROPS = Object.freeze(['dark', 'studio', 'white']);
// The colours of each backdrop (sRGB): the floor, the middle of the backdrop and its edges. A value over 1 is brighter than white on the
// way into the tone curve (so the white backdrop still reads as white after it).
const LOOKS = {
  dark: { floor: 0xb4b4b8, mid: null, edge: null },
  studio: { floor: 0xc8c9cc, mid: [0.74, 0.745, 0.76], edge: [0.30, 0.305, 0.32] },
  white: { floor: 0xf2f2f2, mid: [1.35, 1.35, 1.35], edge: [0.95, 0.95, 0.96] },
};
const N = 512;                 // the contact shadow's picture, N x N
// The reflection's blur: it is read from a smaller copy of itself (a mip level) about REFL_SOFT of the picture's height across per texel,
// and each frame of the average looks it up up to REFL_JITTER to the side, which smooths the steps between those texels. (Only shifting
// it, 32 copies of a gear's teeth made ripples across the floor.)
const REFL_SOFT = 0.008;
const REFL_JITTER = 0.003;

export function createStage({ THREE }) {
  const T = THREE.TSL;
  const opts = { ...STAGE_DEFAULTS };
  const enabled = { contact: true, refl: true };
  let backdropKind = 'studio';
  const u = {
    contact: T.uniform(opts.contact),
    refl: T.uniform(opts.refl),
    jitter: T.uniform(new THREE.Vector2()),
    origin: T.uniform(new THREE.Vector3()),      // the point of the floor under the middle of the model
    right: T.uniform(new THREE.Vector3(1, 0, 0)), // the contact picture's axes on the floor, and half its width
    across: T.uniform(new THREE.Vector3(0, 1, 0)),
    half: T.uniform(1),
    up: T.uniform(new THREE.Vector3(0, 0, 1)),
    reach: T.uniform(1),                         // a point this high above the floor or higher darkens nothing
    floor: T.uniform(new THREE.Color(LOOKS.studio.floor)),
    has: T.uniform(0),                           // 1 once a contact picture has been made
  };

  // ── Contact shadow ──
  const mk = (depth) => new THREE.RenderTarget(N, N, { type: THREE.HalfFloatType, depthBuffer: depth });
  const rtNear = mk(true), rtTmp = mk(false), rtTight = mk(false), rtWide = mk(false);
  // the model as seen from under the floor: white where it touches, black from `reach` up (the nearest point of it wins the depth test)
  const nearMat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, fog: false, toneMapped: false });
  {
    const h = T.positionWorld.sub(u.origin).dot(u.up);
    const d = T.clamp(T.float(1).sub(h.div(u.reach)), 0, 1);
    nearMat.colorNode = T.vec3(d, d, d);
  }
  // a Gaussian blur along one axis; `pow` sharpens the picture first (the tight blur keeps only what is very near)
  const src = T.texture(rtNear.texture), step = T.uniform(new THREE.Vector2(1 / N, 0)), pw = T.uniform(1);
  const blurMat = new THREE.NodeMaterial();
  {
    const taps = 6, sigma = 3;
    let wsum = 0; const ws = [];
    for (let i = -taps; i <= taps; i++) { const w = Math.exp(-(i * i) / (2 * sigma * sigma)); ws.push([i, w]); wsum += w; }
    let sum = T.float(0);
    for (const [i, w] of ws) sum = sum.add(T.pow(src.sample(T.uv().add(step.mul(i))).r, pw).mul(w / wsum));
    blurMat.fragmentNode = T.vec4(sum, sum, sum, 1);
  }
  const quad = new THREE.QuadMesh(blurMat);
  const texTight = T.texture(rtTight.texture), texWide = T.texture(rtWide.texture);

  // Makes the contact picture again. root: what is drawn (the parts); scene: the scene it hangs in (the rest is put aside meanwhile);
  // up: the floor's normal; origin: a point of the floor; box: the model's bounding box.
  function updateContact(renderer, scene, root, up, origin, box) {
    if (!renderer || !scene || !root || !box || box.isEmpty()) { u.has.value = 0; return false; }
    const size = box.getSize(new THREE.Vector3()), diag = Math.max(size.length(), 1e-6);
    const centre = box.getCenter(new THREE.Vector3());
    const onFloor = centre.clone().addScaledVector(up, -centre.clone().sub(origin).dot(up));
    const half = diag * 0.62, reach = diag * 0.16;
    const cam = new THREE.OrthographicCamera(-half, half, half, -half, 0, reach * 1.02);
    cam.position.copy(onFloor);
    cam.up.copy(Math.abs(up.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0));
    cam.lookAt(onFloor.clone().add(up));
    cam.updateMatrixWorld(true);
    u.origin.value.copy(onFloor); u.up.value.copy(up); u.half.value = half; u.reach.value = reach;
    u.right.value.setFromMatrixColumn(cam.matrixWorld, 0).normalize();
    u.across.value.setFromMatrixColumn(cam.matrixWorld, 1).normalize();
    // only the model is drawn: everything beside the chain from the root up to the scene is put aside for this one picture
    const saved = [];
    for (let node = root; node && node.parent; node = node.parent) for (const c of node.parent.children) if (c !== node && c.visible) { saved.push(c); c.visible = false; }
    root.traverse((o) => { if (o.userData && o.userData.selGlow && o.visible) { saved.push(o); o.visible = false; } });
    const prev = { target: renderer.getRenderTarget(), override: scene.overrideMaterial, bg: scene.background, bgNode: scene.backgroundNode, fog: scene.fog,
      clear: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha() };
    try {
      scene.overrideMaterial = nearMat; scene.background = null; scene.backgroundNode = null; scene.fog = null;
      renderer.setClearColor(0x000000, 1);
      renderer.setRenderTarget(rtNear);
      renderer.render(scene, cam);
      const pass = (from, to, dx, dy, spacing, p) => {
        src.value = from.texture; step.value.set(dx * spacing / N, dy * spacing / N); pw.value = p;
        renderer.setRenderTarget(to); quad.render(renderer);
      };
      pass(rtNear, rtTmp, 1, 0, 1, 4); pass(rtTmp, rtTight, 0, 1, 1, 1);      // tight: where it touches
      pass(rtNear, rtTmp, 1, 0, 5, 1); pass(rtTmp, rtWide, 0, 1, 5, 1);       // wide: the shade under it
    } finally {
      renderer.setRenderTarget(prev.target);
      renderer.setClearColor(prev.clear, prev.alpha);
      scene.overrideMaterial = prev.override; scene.background = prev.bg; scene.backgroundNode = prev.bgNode; scene.fog = prev.fog;
      for (const o of saved) o.visible = true;
    }
    u.has.value = 1;
    return true;
  }

  // ── The floor's material ──
  // Built again only when the reflection is switched on or off (off, the reflector is not in it, so the model is not drawn twice).
  let reflection = null, material = null;
  function build() {
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0, transparent: true, depthWrite: false });
    // a disc, solid to an eighth of its width and gone at its rim
    m.opacityNode = T.float(1).sub(T.smoothstep(0.12, 0.5, T.length(T.uv().sub(0.5))));
    const rel = T.positionWorld.sub(u.origin);
    const cuv = T.vec2(rel.dot(u.right), rel.dot(u.across)).div(u.half.mul(2)).add(0.5);
    const inPic = T.step(0, cuv.x).mul(T.step(cuv.x, 1)).mul(T.step(0, cuv.y)).mul(T.step(cuv.y, 1)).mul(u.has);
    // (the two together: dark where it touches, and the shade under it on top of that)
    const occ = T.float(1).sub(T.float(1).sub(texTight.sample(cuv).r.mul(0.95)).mul(T.float(1).sub(texWide.sample(cuv).r.mul(0.85)))).mul(inPic);
    const base = u.floor.mul(T.float(1).sub(occ.mul(u.contact)));
    if (enabled.refl) {
      if (!reflection) {
        // (at the full size of the picture, and made again for every frame drawn: with bounces off three makes it once per animation
        // frame, and Photo mode draws several frames of its average in one, so the image stayed as it was first made, at the low
        // resolution of a view being moved, blocky)
        reflection = T.reflector({ resolutionScale: 1, bounces: true, generateMipmaps: true });
        reflection.uvNode = reflection.uvNode.add(u.jitter);
      }
      const soft = reflection.level(T.log2(T.max(T.screenSize.y.mul(REFL_SOFT), 1)));
      // a glossy coat: a little of the mirror image seen from above, most of it at grazing angles (and the colour under it a little less)
      const facing = T.abs(T.dot(T.normalView, T.positionViewDirection));
      const k = u.refl.mul(T.mix(T.float(1), T.float(0.3), T.smoothstep(0.0, 0.9, facing)));
      m.colorNode = base.mul(T.float(1).sub(k.mul(0.5)));
      m.emissiveNode = soft.rgb.mul(k);
    } else {
      m.colorNode = base;
    }
    material = m;
    return m;
  }

  // Frame i of Photo mode's average: the reflection looked up a fraction to the side (on a spiral, as the depth of field's taps).
  function sample(i) {
    const a = i * 2.39996323, r = Math.sqrt(((i * 0.618034) % 1)) * REFL_JITTER;
    u.jitter.value.set(Math.cos(a) * r, Math.sin(a) * r);
    return () => u.jitter.value.set(0, 0);
  }

  // ── Backdrop ──
  // The gradient behind the model (null: the dark of the viewport, the scene's own background colour).
  function backdrop() {
    const L = LOOKS[backdropKind] || LOOKS.studio;
    if (!L.mid) return null;
    const mid = T.vec3(...L.mid), edge = T.vec3(...L.edge);
    const aspect = T.screenSize.x.div(T.screenSize.y);
    const d = T.screenUV.sub(T.vec2(0.5, 0.42)).mul(T.vec2(aspect, 1)).length();
    return T.mix(mid, edge, T.smoothstep(0.08, 0.95, d));
  }
  function setBackdrop(kind) {
    if (!LOOKS[kind]) return false;
    backdropKind = kind;
    u.floor.value.set(LOOKS[kind].floor);
    return true;
  }
  setBackdrop(backdropKind);

  function set(key, value) {
    if (!(key in opts)) return;
    opts[key] = Math.min(1, Math.max(0, Number(value) || 0));
    u[key].value = enabled[key] ? opts[key] : 0;
  }
  // Off: the contact shadow's strength is 0; the reflection leaves the floor's material (it is built again).
  function setOn(key, value) {
    if (!(key in enabled)) return false;
    const v = !!value;
    if (enabled[key] === v) return false;
    enabled[key] = v;
    u[key].value = v ? opts[key] : 0;
    return key === 'refl';              // (true: the floor's material has to be built again)
  }

  return {
    build, updateContact, sample, backdrop, setBackdrop,
    get material() { return material; },
    get reflectTarget() { return reflection ? reflection.target : null; },
    // (for tests: the contact pictures and the uniforms)
    get debug() { return { rtNear, rtTight, rtWide, u }; },
    get backdropKind() { return backdropKind; },
    set, setOn,
    get: (key) => opts[key],
    isOn: (key) => !!enabled[key],
    dispose() {
      for (const rt of [rtNear, rtTmp, rtTight, rtWide]) { try { rt.dispose(); } catch (_) {} }
      try { nearMat.dispose(); blurMat.dispose(); } catch (_) {}
      try { material?.dispose(); } catch (_) {}
    },
  };
}
