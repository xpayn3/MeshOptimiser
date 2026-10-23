// Photo mode: the picture of the model drawn the slow, pretty way.
//
// The viewport normally draws straight to the canvas. Photo mode draws the scene into a texture (multisampled, with its depth) and
// runs a short chain of effects over it before the colours are tone-mapped for the screen:
//   ambient occlusion  darkens creases and contact points (read from the depth, then softened)
//   glow               the brightest highlights bleed a little light round themselves
//   lens fringe        a trace of colour split towards the corners
//   vignette           the edges fall off
//   film grain         a little noise takes the digital edge off the gradients
//   depth of field     what is nearer or further than the focus goes soft (off at first; the focus is a point in the scene)
// While the view is still, the picture is drawn again and again and the frames are averaged (the quality preset says how many): each
// frame is moved by a fraction of a pixel (edges come out smooth), the occlusion and the depth of field take their samples at a
// different turn (their noise averages away), and onSample may move the sun a little (its shadow gets a soft edge, as from a sun of
// real size). Anything that moves or changes starts the average again. The film grain is put on after the average.
// The look is the tone curve the picture is finished with: Neutral (colours as they are, for products), AgX (soft, film-like highlights)
// or ACES (contrasty, the look photo mode had before).
// They are written here in three's shader language (TSL). They were first written when the app was on three r172, whose bundle had
// none of them as ready nodes; three's own (GTAO, bloom, depth of field in its add-ons) are still not used on r186, as they do not turn
// their samples from frame to frame for the average, nor keep the occlusion and the blur to each pixel's own surface. Nothing here
// touches the scene: app.js decides when to call render() instead of renderer.render(), and sets the lighting.
//
// Each effect can be switched off (it is then not in the chain at all, so it costs nothing) and has a strength; the quality preset
// sets the multisampling and how many samples the occlusion and the glow take. Strengths are uniforms (moving a slider never rebuilds the
// chain); an effect switch or the quality preset rebuilds it, on the next frame.
//
// createPhoto({ THREE, getRenderer, getScene, getCamera, getFocus, onSample })
//   -> { enable, disable, render, restart, refining, frames, set, get, setOn, isOn, setQuality, quality, setLook, look, enabled, dispose }
// render(reach) draws one frame and adds it to the average; refining is true while the average wants more frames.
// onSample(i) is called before frame i (from 1) of an average and may return a function that undoes what it changed.

export const PHOTO_DEFAULTS = Object.freeze({
  ao: 0.65,          // 0..1   strength of the ambient occlusion
  glow: 0.25,        // 0..1   how much of the bright highlights is let back in as glow
  fringe: 0.25,      // 0..1   colour split towards the corners
  vignette: 0.35,    // 0..1   darkening of the edges
  grain: 0.25,       // 0..1   film grain
  dof: 0.5,          // 0..1   how soft what is out of focus gets (the size of the lens opening)
});
export const PHOTO_EFFECTS = Object.freeze(Object.keys(PHOTO_DEFAULTS));

// msaa: samples of the multisampled picture; ao: samples of the occlusion; glow: half-width of the blur (taps = 2 x glow + 1);
// dof: samples of the out-of-focus blur; frames: how many frames a still view is averaged over (1: none)
export const PHOTO_QUALITY = Object.freeze({
  draft: Object.freeze({ msaa: 0, ao: 8, glow: 2, dof: 16, frames: 1 }),
  good: Object.freeze({ msaa: 2, ao: 12, glow: 3, dof: 28, frames: 16 }),
  best: Object.freeze({ msaa: 4, ao: 16, glow: 4, dof: 40, frames: 32 }),
  max: Object.freeze({ msaa: 4, ao: 24, glow: 6, dof: 64, frames: 64 }),
});
// The tone curves the picture can be finished with (names of three's constants).
export const PHOTO_LOOKS = Object.freeze({ neutral: 'NeutralToneMapping', agx: 'AgXToneMapping', aces: 'ACESFilmicToneMapping' });
// The sub-pixel shift of frame i of an average, in pixels (-0.5..0.5): the Halton sequence in bases 2 and 3, so any number of frames
// covers the pixel evenly. Frame 0 is not moved (a single frame is the picture as it always was).
const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
export const photoJitter = (i) => (i <= 0 ? [0, 0] : [halton(i, 2) - 0.5, halton(i, 3) - 0.5]);
// The widest blur, at 100 %, as a share of the picture's height.
const DOF_MAX = 0.028;
// How fast the blur grows away from the focus: a point this share of its own distance nearer or further is fully soft. (Relative,
// so it reads the same for a watch and for a car: depth of field is a matter of how far apart things are compared with how far away.)
const DOF_SPAN = 0.35;

export function createPhoto({ THREE, getRenderer, getScene, getCamera, getFocus, onSample }) {
  const T = THREE.TSL;
  const opts = { ...PHOTO_DEFAULTS };
  const enabledFx = Object.fromEntries(PHOTO_EFFECTS.map((k) => [k, k !== 'dof']));      // (depth of field starts off: it hides detail)
  let qualityName = 'best', lookName = 'neutral';
  let post = null, built = null, on = false, builtCamera = null, dirty = true;
  // The average: two half-float targets, one read while the other is written (the newest is `read`); `count` frames are in it.
  // `accIn` is what the averaging pass reads, `accOut` what the finishing pass shows (both swapped to the right target each frame).
  let rts = null, read = 0, count = 0, lastView = null, restartAsked = true, finish = null, accIn = null, accOut = null;
  // The view an average was made for: the size, the reach and the camera's two matrices. The same view when every number is within a
  // millionth of what it was (relative; rounding of a camera worked out again every frame is not a move).
  const viewOf = (size, camera) => [size.x, size.y, u.radius.value, ...camera.matrixWorld.elements, ...camera.projectionMatrix.elements];
  const sameView = (a, b) => !!a && !!b && a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= 1e-6 * (1 + Math.abs(b[i])));

  // Everything the user can move is a uniform: changing a slider never rebuilds the chain.
  const u = {
    ao: T.uniform(opts.ao),
    glow: T.uniform(opts.glow),
    fringe: T.uniform(opts.fringe),
    vignette: T.uniform(opts.vignette),
    grain: T.uniform(opts.grain),
    dof: T.uniform(opts.dof),
    focus: T.uniform(1),             // distance of the focus in front of the camera (world units, positive)
    radius: T.uniform(1),            // occlusion reach in world units (a few percent of the model)
    projY: T.uniform(1),             // camera.projectionMatrix[5]: how big a world length is on screen
    ortho: T.uniform(0),             // 1 when the camera is orthographic
    aspect: T.uniform(1),
    seed: T.uniform(0),
    texel: T.uniform(new THREE.Vector2(1 / 1920, 1 / 1080)),
    frame: T.uniform(0),             // frame of the average (0: the first): turns the occlusion's noise
    rot: T.uniform(0),               // turn of the depth of field's spiral for this frame (radians)
    blend: T.uniform(1),             // share of the new frame in the average (1 / frames so far)
  };

  // n taps on a spiral (golden angle), spread over the disc: the same set for every pixel, turned by a per-pixel angle in the shader.
  const spiral = (n) => {
    const t = [];
    for (let i = 0; i < n; i++) { const a = i * 2.39996323, r = Math.sqrt((i + 0.5) / n); t.push([Math.cos(a) * r, Math.sin(a) * r]); }
    return t;
  };

  function build(scene, camera) {
    const q = PHOTO_QUALITY[qualityName] || PHOTO_QUALITY.best;
    const fx = enabledFx;
    const { pass, Fn, float, vec2, vec3, vec4, screenUV, mix, smoothstep, clamp, max, min, length, sin, cos, step, hash, luminance,
      convertToTexture, perspectiveDepthToViewZ, abs, screenSize } = T;

    const scenePass = pass(scene, camera, { samples: q.msaa });
    const colorTex = scenePass.getTextureNode('output');
    const depthTex = scenePass.getTextureNode('depth');
    const near = scenePass._cameraNear, far = scenePass._cameraFar;

    // The distance in front of the camera (negative, like view space) at a screen position.
    const viewZAt = (uv) => {
      const d = depthTex.sample(uv).r;
      const persp = perspectiveDepthToViewZ(d, near, far);
      const orth = near.add(far.sub(near).mul(d)).negate();
      return mix(persp, orth, u.ortho);
    };

    // Per-pixel noise in 0..1 (the pixel coordinate, not the uv: the pattern must not swim with the window size).
    const px = screenUV.mul(screenSize);
    const noise = (k, animated = false) => hash(px.x.add(px.y.mul(2111.0)).add(animated ? u.seed.mul(k) : float(k * 37)));
    const fromC = screenUV.sub(0.5);

    // The surface around a pixel, as a plane. On a plane the depth is not linear across the screen, but its inverse is (in perspective;
    // with an orthographic camera the depth itself is): `lin` is that quantity, and its slope across and down is taken from the nearer
    // of the two neighbours on each side, so a pixel at the edge of a part takes the slope of its own surface, not a jump to the next.
    // zOn(off) is the depth the plane has at that offset from the pixel: what the depth there would be if nothing stood in front.
    const lin = (z) => mix(float(1).div(z), z, u.ortho);
    const unlin = (l) => mix(float(1).div(l), l, u.ortho);
    const planeAt = (uv) => {
      const z0 = viewZAt(uv), l0 = lin(z0);
      const dx = vec2(u.texel.x, 0), dy = vec2(0, u.texel.y);
      const xa = lin(viewZAt(uv.add(dx))).sub(l0), xb = l0.sub(lin(viewZAt(uv.sub(dx))));
      const ya = lin(viewZAt(uv.add(dy))).sub(l0), yb = l0.sub(lin(viewZAt(uv.sub(dy))));
      // (where the two sides slope opposite ways about as steeply, the pixel is on a crest or in a dip, not at an edge: their mean is the
      // surface's slope there. Taking the gentler one tilted the plane, and every crest and dip of a wavy surface got a dark spot.)
      const slope = (a, b) => {
        const aa = abs(a), ab = abs(b);
        const gentler = mix(b, a, step(aa, ab));
        const turn = step(a.mul(b), 0).mul(step(max(aa, ab), min(aa, ab).mul(4).add(1e-12)));
        return mix(gentler, a.add(b).mul(0.5), turn);
      };
      const gx = slope(xa, xb).div(u.texel.x);
      const gy = slope(ya, yb).div(u.texel.y);
      return { z0, zOn: (off) => unlin(l0.add(gx.mul(off.x)).add(gy.mul(off.y))) };
    };

    // Ambient occlusion
    let ao = float(1);
    if (fx.ao) {
      const taps = spiral(q.ao);
      const aoRaw = Fn(() => {
        const { z0, zOn } = planeAt(screenUV);
        const sky = step(0.99999, depthTex.sample(screenUV).r);
        // how far, in uv, a world length of `radius` reaches at this depth (perspective: shrinks with distance)
        const reach = mix(u.radius.mul(u.projY).mul(0.5).div(max(z0.negate(), 1e-4)), u.radius.mul(u.projY).mul(0.5), u.ortho);
        const ang = T.fract(noise(1.0).add(u.frame.mul(0.618034))).mul(6.2831853);      // (frame 0: the pattern as it always was)
        const ca = cos(ang), sa = sin(ang);
        let occ = float(0);
        for (const [tx, ty] of taps) {
          const tl = Math.max(Math.hypot(tx, ty), 0.05);              // (how far out on the disc this tap is: its distance in the world is tl·radius)
          const rx = ca.mul(tx).sub(sa.mul(ty)), ry = sa.mul(tx).add(ca.mul(ty));
          const off = vec2(rx.div(u.aspect), ry).mul(reach);
          const z = viewZAt(screenUV.add(off));
          // Measured from the pixel's own plane, not from its depth: on a flat panel seen at a slant the far side of the disc is nearer the
          // camera than the pixel without standing in front of it, and the panel used to shade itself in a pattern that followed the noise.
          const diff = z.sub(zOn(off));                             // > 0: that point stands out of this pixel's surface, towards the camera
          const inRange = smoothstep(0, 1, u.radius.mul(1.5).div(max(abs(diff), 1e-6)));
          // It shades by how steeply that point rises over this pixel's surface (the sine of the angle it stands at), and not at all below
          // about 17°: a wall at a corner shades fully, the far rim of a shallow hollow not. (A point a hair above the surface counted in
          // full: every gentle dip of a scanned table top went black, and the triangles of a faceted curve showed.)
          const sinUp = diff.div(max(length(vec2(diff, u.radius.mul(tl))), 1e-6));
          const blocks = clamp(sinUp.sub(0.3).div(0.7), 0, 1);
          occ = occ.add(blocks.mul(inRange));
        }
        const a = float(1).sub(occ.div(taps.length).mul(1.6));
        return mix(clamp(a, 0, 1), float(1), sky);
      })();
      // Softened over a 5x5 block, two pixels apart, that keeps to the pixel's own surface: a sample counts by how close its depth is to
      // the pixel's plane, so the noise of the taps turns into a smooth shade without the shade of one part bleeding onto the part behind.
      const aoTex = convertToTexture(vec4(aoRaw, aoRaw, aoRaw, 1));
      ao = Fn(() => {
        const { z0, zOn } = planeAt(screenUV);
        const tol = max(u.radius.mul(0.05), abs(z0).mul(0.002));
        let sum = float(0), wsum = float(0);
        for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) {
          const off = vec2(x, y).mul(u.texel).mul(2);
          const same = float(1).sub(smoothstep(0, tol, abs(viewZAt(screenUV.add(off)).sub(zOn(off)))));
          const w = same.mul(Math.exp(-(x * x + y * y) / 4.5));
          sum = sum.add(aoTex.sample(screenUV.add(off)).r.mul(w));
          wsum = wsum.add(w);
        }
        return mix(float(1), sum.div(max(wsum, 1e-4)), u.ao);
      })();
    }

    // Lens fringe: red and blue sampled a little further from and nearer to the centre; nothing in the middle.
    let base;
    if (fx.fringe) {
      const fr = fromC.mul(length(fromC)).mul(u.fringe).mul(0.012);
      base = vec3(colorTex.sample(screenUV.add(fr)).r, colorTex.sample(screenUV).g, colorTex.sample(screenUV.sub(fr)).b);
    } else base = colorTex.sample(screenUV).rgb;

    // Glow: what is brighter than the threshold, blurred twice (a narrow and a wide Gaussian, each in two passes, across and down) and
    // added back. A blur of the whole picture is steady from frame to frame and from pixel to pixel; sparse random samples are not (they
    // shimmer, and a speck of highlight on a thin metal edge became white streaks). No single pixel counts for more than a clamped
    // brightness.
    let glow = vec3(0);
    if (fx.glow) {
      const h = q.glow, sigma = Math.max(1, h / 2);
      const weights = []; let wsum = 0;
      for (let i = -h; i <= h; i++) { const w = Math.exp(-(i * i) / (2 * sigma * sigma)); weights.push([i, w]); wsum += w; }
      const blur = (tex, dx, dy, spacing) => {
        let sum = vec3(0);
        for (const [i, w] of weights) sum = sum.add(tex.sample(screenUV.add(vec2(dx, dy).mul(u.texel).mul(i * spacing))).rgb.mul(w / wsum));
        return vec4(sum, 1);
      };
      const c = min(colorTex.sample(screenUV).rgb, vec3(3));
      const bright = convertToTexture(vec4(c.mul(max(luminance(c).sub(1.0), 0).mul(1.2)), 1));
      const narrow = convertToTexture(blur(convertToTexture(blur(bright, 1, 0, 2)), 0, 1, 2));
      const wide = blur(convertToTexture(blur(narrow, 1, 0, 6)), 0, 1, 6);
      glow = narrow.sample(screenUV).rgb.mul(0.5).add(wide.rgb.mul(0.5)).mul(u.glow);
    }

    let col = base.mul(ao);
    // Depth of field: each pixel gathers the pixels round it on a spiral, out to the widest blur. A neighbour counts when its own blur is
    // wide enough to reach this pixel (so a soft background does not spread over a sharp part in front of it: a neighbour further away is
    // let reach no further than twice this pixel's own blur), the gather after D. Gustafsson's single-pass bokeh. The blur of a pixel is
    // its distance from the focus, relative to its distance from the camera.
    if (fx.dof) {
      const preTex = convertToTexture(vec4(col, 1));
      const n = q.dof, maxR = u.dof.mul(DOF_MAX);
      const cocAt = (z) => {
        const dist = z.negate();
        return clamp(abs(dist.sub(u.focus)).div(max(mix(dist, u.focus, u.ortho), 1e-6)).div(DOF_SPAN), 0, 1).mul(maxR);
      };
      const rc = cos(u.rot), rs = sin(u.rot);
      col = Fn(() => {
        const z0 = viewZAt(screenUV), c0 = cocAt(z0);
        const sum = preTex.sample(screenUV).rgb.toVar(), tot = float(1).toVar();
        const edge = u.texel.y;                                    // (a tap's edge softened over a pixel)
        for (let i = 0; i < n; i++) {
          const a = i * 2.39996323, r = Math.sqrt((i + 0.5) / n);
          const rr = maxR.mul(r);
          const cx = Math.cos(a) * r, cy = Math.sin(a) * r;
          const off = vec2(rc.mul(cx).sub(rs.mul(cy)), rs.mul(cx).add(rc.mul(cy))).mul(maxR).mul(vec2(float(1).div(u.aspect), 1));
          const uv = screenUV.add(off), z = viewZAt(uv);
          const cs = cocAt(z);
          const reach = mix(cs, min(cs, c0.mul(2)), step(z, z0));        // (z <= z0: that point is further away than this pixel)
          const m = smoothstep(rr.sub(edge), rr.add(edge), reach);
          sum.addAssign(mix(sum.div(tot), preTex.sample(uv).rgb, m));
          tot.addAssign(1);
        }
        return sum.div(tot);
      })();
    }
    col = col.add(glow);
    // Vignette (in the aspect of the picture, so it is round, not squashed to the window)
    if (fx.vignette) {
      const vc = fromC.mul(vec2(u.aspect, 1)).mul(1.15);
      col = col.mul(float(1).sub(smoothstep(0.35, 1.1, length(vc)).mul(u.vignette)));
    }
    // The average: this frame mixed into what the earlier ones made (blend is 1 on the first frame, so the old content does not count).
    const avg = mix(accIn.sample(screenUV).rgb, col, u.blend);
    // Film grain, by luminance so that dark areas are not lit up by it. Put on the average (averaged, it would be gone).
    let shown = accOut.sample(screenUV).rgb;
    if (fx.grain) {
      const g = noise(7.0, true).sub(0.5).mul(u.grain).mul(0.08);
      shown = shown.add(g.mul(clamp(luminance(shown).add(0.15), 0, 1)));
    }
    return { scenePass, node: vec4(avg, 1), shown: vec4(shown, 1) };
  }

  // (Re)builds the chain when it is missing, the camera changed or a switch, the quality or the look changed.
  // Two passes: `post` draws a frame of the chain and mixes it into the average (linear light, no tone curve: it writes a half-float
  // target); `finish` puts the grain on the average and finishes it with the look's tone curve (at exposure 1) onto the canvas. The
  // curve is applied in the chain, not lent to the renderer: since three r184 a pipeline reads the renderer's tone mapping on every
  // frame. Screenshots and everything else that draws straight to the canvas keep the viewport's own curve.
  function ensure() {
    const renderer = getRenderer(), scene = getScene(), camera = getCamera();
    if (!renderer || !scene || !camera) return false;
    if (post && builtCamera === camera && !dirty) return true;
    try { built?.scenePass?.dispose?.(); } catch (_) {}
    if (!rts) {
      const mk = () => new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
      rts = [mk(), mk()];
      accIn = T.texture(rts[0].texture);
      accOut = T.texture(rts[0].texture);
    }
    built = build(scene, camera);
    post = new THREE.RenderPipeline(renderer);
    post.outputColorTransform = false;
    post.outputNode = built.node;
    finish = new THREE.RenderPipeline(renderer);
    finish.outputColorTransform = false;
    finish.outputNode = T.renderOutput(T.toneMapping(THREE[PHOTO_LOOKS[lookName]] ?? THREE.NeutralToneMapping, T.float(1), built.shown), THREE.NoToneMapping, renderer.outputColorSpace);
    builtCamera = camera;
    dirty = false;
    restartAsked = true;
    return true;
  }

  function enable() {
    if (on) return true;
    if (!ensure()) return false;
    on = true;
    return true;
  }

  function disable() { on = false; restartAsked = true; }

  // One frame. `reach` is the model's size (its bounding box diagonal): the occlusion reach follows it.
  function render(reach) {
    const renderer = getRenderer(), camera = getCamera();
    if (!on || !renderer) return false;
    if (!ensure()) return false;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    u.aspect.value = camera.aspect || (size.x / Math.max(1, size.y));
    u.texel.value.set(1 / Math.max(1, size.x), 1 / Math.max(1, size.y));
    u.projY.value = camera.projectionMatrix.elements[5] || 1;
    u.ortho.value = camera._isOrtho || camera.isOrthographicCamera ? 1 : 0;
    u.radius.value = Math.max(1e-6, (reach || 1) * 0.045);
    u.seed.value = Math.random() * 100;
    {
      // the focus: a point in the scene, measured along the camera's view each frame (so it stays on that point as the camera turns)
      const p = getFocus && getFocus();
      if (p) { camera.updateMatrixWorld(); const v = p.clone().applyMatrix4(camera.matrixWorldInverse); u.focus.value = Math.max(1e-6, -v.z); }
    }
    // The average starts again when the view, the size or the reach changed, or restart() was asked for.
    camera.updateMatrixWorld();
    const view = viewOf(size, camera);
    if (restartAsked || !sameView(view, lastView)) { count = 0; restartAsked = false; lastView = view; }
    const frames = (PHOTO_QUALITY[qualityName] || PHOTO_QUALITY.best).frames;
    if (count < frames) {
      for (const rt of rts) rt.setSize(size.x, size.y);
      const i = count;
      u.blend.value = 1 / (i + 1);
      u.frame.value = i;
      u.rot.value = i * 2.39996323;
      // this frame moved by a fraction of a pixel (in clip space: the perspective matrix moves x and y by z, the orthographic by 1)
      const e = camera.projectionMatrix.elements, ortho = e[15] !== 0, ix = ortho ? 12 : 8, iy = ortho ? 13 : 9;
      const kx = e[ix], ky = e[iy], [jx, jy] = photoJitter(i);
      e[ix] += (2 * jx) / size.x; e[iy] += (2 * jy) / size.y;
      let undo = null;
      try { if (i > 0 && onSample) undo = onSample(i); } catch (_) {}
      const prevTarget = renderer.getRenderTarget();
      try {
        accIn.value = rts[read].texture;
        renderer.setRenderTarget(rts[1 - read]);
        post.render();
      } finally {
        renderer.setRenderTarget(prevTarget);
        e[ix] = kx; e[iy] = ky;
        try { undo?.(); } catch (_) {}
      }
      read = 1 - read;
      count++;
    }
    accOut.value = rts[read].texture;
    finish.render();
    return true;
  }
  function restart() { restartAsked = true; }

  function set(key, value) {
    if (!(key in PHOTO_DEFAULTS)) return;
    const v = Math.min(1, Math.max(0, Number(value) || 0));
    if (opts[key] !== v) restartAsked = true;
    opts[key] = v;
    u[key].value = v;
  }
  function setOn(key, value) {
    if (!(key in enabledFx)) return;
    const v = !!value;
    if (enabledFx[key] !== v) { enabledFx[key] = v; dirty = true; }
  }
  function setQuality(name) {
    if (!PHOTO_QUALITY[name] || name === qualityName) return;
    qualityName = name; dirty = true;
  }
  function setLook(name) {
    if (!PHOTO_LOOKS[name] || name === lookName) return;
    lookName = name; dirty = true;
  }

  return {
    enable, disable, render, restart, set, setOn, setQuality, setLook,
    get: (key) => opts[key],
    isOn: (key) => !!enabledFx[key],
    get quality() { return qualityName; },
    get look() { return lookName; },
    get frames() { return count; },
    get refining() { return on && !restartAsked && count < (PHOTO_QUALITY[qualityName] || PHOTO_QUALITY.best).frames; },
    get enabled() { return on; },
    dispose() {
      disable(); try { built?.scenePass?.dispose?.(); } catch (_) {}
      try { rts?.forEach((rt) => rt.dispose()); } catch (_) {}
      post = null; finish = null; built = null; builtCamera = null; rts = null; accIn = null; accOut = null;
    },
  };
}
