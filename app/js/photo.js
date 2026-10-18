// Photo mode: the picture of the model drawn the slow, pretty way.
//
// The viewport normally draws straight to the canvas. Photo mode draws the scene into a texture (multisampled, with its depth) and
// runs a short chain of effects over it before the colours are tone-mapped for the screen:
//   ambient occlusion  darkens creases and contact points (read from the depth, then softened)
//   glow               the brightest highlights bleed a little light round themselves
//   lens fringe        a trace of colour split towards the corners
//   vignette           the edges fall off
//   film grain         a little noise takes the digital edge off the gradients
// three.js r172 ships none of these as ready nodes in the bundle this app vendors, so they are written here in its shader language
// (TSL). Nothing here touches the scene: app.js decides when to call render() instead of renderer.render(), and sets the lighting.
//
// Each effect can be switched off (it is then not in the chain at all, so it costs nothing) and has a strength; the quality preset
// sets the multisampling and how many samples the occlusion and the glow take. Strengths are uniforms (moving a slider never rebuilds the
// chain); an effect switch or the quality preset rebuilds it, on the next frame.
//
// createPhoto({ THREE, getRenderer, getScene, getCamera }) -> { enable, disable, render, set, get, setOn, isOn, setQuality, quality, enabled, dispose }

export const PHOTO_DEFAULTS = Object.freeze({
  ao: 0.65,          // 0..1   strength of the ambient occlusion
  glow: 0.25,        // 0..1   how much of the bright highlights is let back in as glow
  fringe: 0.25,      // 0..1   colour split towards the corners
  vignette: 0.35,    // 0..1   darkening of the edges
  grain: 0.25,       // 0..1   film grain
});
export const PHOTO_EFFECTS = Object.freeze(Object.keys(PHOTO_DEFAULTS));

// msaa: samples of the multisampled picture; ao: samples of the occlusion; glow: half-width of the blur (taps = 2 x glow + 1)
export const PHOTO_QUALITY = Object.freeze({
  draft: Object.freeze({ msaa: 0, ao: 8, glow: 2 }),
  good: Object.freeze({ msaa: 2, ao: 12, glow: 3 }),
  best: Object.freeze({ msaa: 4, ao: 16, glow: 4 }),
  max: Object.freeze({ msaa: 4, ao: 24, glow: 6 }),
});

export function createPhoto({ THREE, getRenderer, getScene, getCamera }) {
  const T = THREE.TSL;
  const opts = { ...PHOTO_DEFAULTS };
  const enabledFx = Object.fromEntries(PHOTO_EFFECTS.map((k) => [k, true]));
  let qualityName = 'best';
  let post = null, built = null, on = false, builtCamera = null, dirty = true;

  // Everything the user can move is a uniform: changing a slider never rebuilds the chain.
  const u = {
    ao: T.uniform(opts.ao),
    glow: T.uniform(opts.glow),
    fringe: T.uniform(opts.fringe),
    vignette: T.uniform(opts.vignette),
    grain: T.uniform(opts.grain),
    radius: T.uniform(1),            // occlusion reach in world units (a few percent of the model)
    projY: T.uniform(1),             // camera.projectionMatrix[5]: how big a world length is on screen
    ortho: T.uniform(0),             // 1 when the camera is orthographic
    aspect: T.uniform(1),
    seed: T.uniform(0),
    texel: T.uniform(new THREE.Vector2(1 / 1920, 1 / 1080)),
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
      const gx = mix(xb, xa, step(abs(xa), abs(xb))).div(u.texel.x);
      const gy = mix(yb, ya, step(abs(ya), abs(yb))).div(u.texel.y);
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
        const ang = noise(1.0).mul(6.2831853);
        const ca = cos(ang), sa = sin(ang);
        let occ = float(0);
        for (const [tx, ty] of taps) {
          const rx = ca.mul(tx).sub(sa.mul(ty)), ry = sa.mul(tx).add(ca.mul(ty));
          const off = vec2(rx.div(u.aspect), ry).mul(reach);
          const z = viewZAt(screenUV.add(off));
          // Measured from the pixel's own plane, not from its depth: on a flat panel seen at a slant the far side of the disc is nearer the
          // camera than the pixel without standing in front of it, and the panel used to shade itself in a pattern that followed the noise.
          const diff = z.sub(zOn(off));                             // > 0: that point stands out of this pixel's surface, towards the camera
          const inRange = smoothstep(0, 1, u.radius.mul(1.5).div(max(abs(diff), 1e-6)));
          const blocks = step(u.radius.mul(0.02), diff);
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

    let col = base.mul(ao).add(glow);
    // Vignette (in the aspect of the picture, so it is round, not squashed to the window)
    if (fx.vignette) {
      const vc = fromC.mul(vec2(u.aspect, 1)).mul(1.15);
      col = col.mul(float(1).sub(smoothstep(0.35, 1.1, length(vc)).mul(u.vignette)));
    }
    // Film grain, by luminance so that dark areas are not lit up by it
    if (fx.grain) {
      const g = noise(7.0, true).sub(0.5).mul(u.grain).mul(0.08);
      col = col.add(g.mul(clamp(luminance(col).add(0.15), 0, 1)));
    }
    return { scenePass, node: vec4(col, 1) };
  }

  // (Re)builds the chain when it is missing, the camera changed or a switch or the quality changed. The output transform of the chain
  // reads the renderer's tone mapping once, when it is built: ACES gives a photograph's shoulder on the highlights (the viewport's
  // neutral curve is made for colour accuracy), so the renderer is borrowed for that moment and given back. Screenshots and everything
  // else that draws straight to the canvas keep the viewport's own curve.
  function ensure() {
    const renderer = getRenderer(), scene = getScene(), camera = getCamera();
    if (!renderer || !scene || !camera) return false;
    if (post && builtCamera === camera && !dirty) return true;
    try { built?.scenePass?.dispose?.(); } catch (_) {}
    built = build(scene, camera);
    post = new THREE.PostProcessing(renderer);
    post.outputNode = built.node;
    const tone = renderer.toneMapping, exposure = renderer.toneMappingExposure;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    try { post.needsUpdate = true; post._update(); }
    finally { renderer.toneMapping = tone; renderer.toneMappingExposure = exposure; }
    builtCamera = camera;
    dirty = false;
    return true;
  }

  function enable() {
    if (on) return true;
    if (!ensure()) return false;
    on = true;
    return true;
  }

  function disable() { on = false; }

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
    post.render();
    return true;
  }

  function set(key, value) {
    if (!(key in PHOTO_DEFAULTS)) return;
    const v = Math.min(1, Math.max(0, Number(value) || 0));
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

  return {
    enable, disable, render, set, setOn, setQuality,
    get: (key) => opts[key],
    isOn: (key) => !!enabledFx[key],
    get quality() { return qualityName; },
    get enabled() { return on; },
    dispose() { disable(); try { built?.scenePass?.dispose?.(); } catch (_) {} post = null; built = null; builtCamera = null; },
  };
}
