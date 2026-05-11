// ════════════════════════════════════════════════════════════════════════════
// Path tracer — three-gpu-pathtracer, on-demand button render.
//
// Loads as an ES module AFTER app-v2.js + cloner.js. Boots when
// window._appFns is present. The host viewport runs WebGPU; the pathtracer
// requires WebGL2, so we spin up a SEPARATE offscreen WebGLRenderer just for
// the render pass, mirror the live scene + camera into it, accumulate samples
// inside a modal, and tear the GPU resources down on close.
//
// The button (#tg-render) is wired here, not in app-v2.js, so this whole
// feature lives in one file and stays out of the 29k-line host.
// ════════════════════════════════════════════════════════════════════════════

import * as THREE from 'three';
// The host loads three.webgpu.js which omits the legacy WebGLRenderer.
// Pull everything renderer-side from the classic build. We don't touch the
// host scene — instead we build a parallel classic-namespace scene with
// proxy Meshes that share the host's geometries but wear fresh classic
// MeshStandardMaterials. This sidesteps every WebGPU/TSL incompatibility.
import * as THREE_CLASSIC from 'three-classic';
import { WebGLPathTracer } from 'three-gpu-pathtracer';
const {
  WebGLRenderer, Scene, Mesh, InstancedMesh,
  MeshStandardMaterial, Color, AmbientLight, DirectionalLight,
  PerspectiveCamera, Matrix4,
} = THREE_CLASSIC;

const SAMPLE_TARGET_DEFAULT = 256;
const RESOLUTION_SCALE      = 1.0;   // multiplier on viewport pixels (cap DPR)
const MAX_DPR               = 1.5;

let _booted    = false;
let _attempts  = 0;
let _F         = null;   // window._appFns
let _btn       = null;
let _modal     = null;   // active modal element (when open)
let _session   = null;   // active render session (when open)

function _whenReady() {
  const fns = window._appFns;
  const ready = fns && fns.THREE && fns.camera && fns.renderer;
  if (ready) { _init(); return; }
  if (++_attempts > 200) { console.warn('[pathtracer] init failed — _appFns never appeared'); return; }
  setTimeout(_whenReady, 100);
}

function _init() {
  if (_booted) return;
  _booted = true;
  _F = window._appFns;

  _btn = document.getElementById('tg-render');
  if (!_btn) { console.warn('[pathtracer] #tg-render button not found'); return; }
  _btn.addEventListener('click', _openRenderModal);

  // Expose for command palette / external triggers.
  window.openPathTraceModal = _openRenderModal;
}

// ── Modal --------------------------------------------------------------------

function _openRenderModal() {
  if (_modal) return;
  const F = _F;
  if (!F.camera || !F.renderer) { F.toast?.('Render unavailable', 'Renderer not ready', 'warn'); return; }
  // Empty scene → friendly toast, don't open the modal. Avoids the cosmetic
  // "Render failed: Scene is empty" error path that previously fired when the
  // user clicked the aperture button before loading or adding any geometry.
  if (!window.state?.parts?.length) { F.toast?.('Nothing to render', 'Load a model or add a primitive first', 'warn'); return; }

  // Aspect ratio of the host viewport — used to keep the render the same
  // shape the user sees. Actual buffer dimensions are computed AFTER the
  // modal lays out so the rendered pixels match the displayed pixels 1:1.
  const hostCanvas = F.renderer.domElement;
  const aspect = (hostCanvas.clientWidth || 16) / (hostCanvas.clientHeight || 9);

  // ── Modal scaffold (design tokens — see CLAUDE.md) ────────────────────
  const overlay = document.createElement('div');
  overlay.className = 'pt-overlay';
  overlay.innerHTML = `
    <div class="pt-modal" role="dialog" aria-label="GPU Path Trace Render">
      <header class="pt-head">
        <div class="pt-title">
          <i data-lucide="aperture"></i>
          <span>Path-traced render</span>
        </div>
        <div class="pt-meta">
          <span class="pt-samples" id="pt-samples">sample 0 / ${SAMPLE_TARGET_DEFAULT}</span>
          <span class="pt-dot"></span>
          <span class="pt-elapsed" id="pt-elapsed">0.0s</span>
        </div>
        <button class="pt-close" id="pt-close" title="Close (Esc)"><i data-lucide="x"></i></button>
      </header>
      <div class="pt-body">
        <div class="pt-main">
          <div class="pt-canvas-wrap" id="pt-canvas-wrap">
            <div class="pt-status" id="pt-status">Building BVH…</div>
          </div>
          <div class="pt-bar"><div class="pt-bar-fill" id="pt-bar"></div></div>
          <footer class="pt-foot">
            <label class="pt-target">
              <span>Target samples</span>
              <input type="number" id="pt-target" value="${SAMPLE_TARGET_DEFAULT}" min="16" max="4096" step="16">
            </label>
            <div class="pt-spacer"></div>
            <button class="tbtn" id="pt-cancel"><i data-lucide="x"></i>Cancel</button>
            <button class="tbtn primary" id="pt-save" disabled><i data-lucide="download"></i>Save PNG</button>
          </footer>
        </div>
        <aside class="pt-side" id="pt-side">
          <div class="section">
            <div class="section-h"><span>Quality</span></div>
            <div class="section-b">
              <label class="pt-ctrl">
                <span>Bounces</span>
                <output id="pt-bounces-out">5</output>
                <input type="range" id="pt-bounces" min="1" max="12" step="1" value="5">
              </label>
              <label class="pt-ctrl">
                <span>Samples / frame</span>
                <output id="pt-spp-out">1</output>
                <input type="range" id="pt-spp" min="1" max="4" step="1" value="1">
              </label>
              <label class="pt-ctrl pt-ctrl-stack">
                <span>Resolution</span>
                <select id="pt-res" class="mac-sel">
                  <option value="0.75">¾× viewport</option>
                  <option value="1" selected>1× viewport</option>
                  <option value="1.5">1.5× viewport</option>
                  <option value="2">2× viewport</option>
                </select>
              </label>
            </div>
          </div>

          <div class="section">
            <div class="section-h"><span>Look</span></div>
            <div class="section-b">
              <label class="pt-ctrl">
                <span>Exposure</span>
                <output id="pt-exposure-out">1.00</output>
                <input type="range" id="pt-exposure" min="0.1" max="3" step="0.05" value="1">
              </label>
              <label class="pt-ctrl pt-ctrl-stack">
                <span>Tone mapping</span>
                <select id="pt-tone" class="mac-sel">
                  <option value="0">None</option>
                  <option value="1">Linear</option>
                  <option value="2">Reinhard</option>
                  <option value="3">Cineon</option>
                  <option value="4" selected>ACES Filmic</option>
                  <option value="6">AgX</option>
                  <option value="7">Neutral</option>
                </select>
              </label>
              <label class="pt-ctrl">
                <span>Filter glossy</span>
                <output id="pt-glossy-out">0.50</output>
                <input type="range" id="pt-glossy" min="0" max="2" step="0.05" value="0.5">
              </label>
            </div>
          </div>

          <div class="section">
            <div class="section-h"><span>Scene</span></div>
            <div class="section-b">
              <label class="pt-ctrl pt-ctrl-row">
                <span>Background</span>
                <input type="color" id="pt-bg" value="#222831">
              </label>
              <label class="pt-ctrl pt-ctrl-stack">
                <span>Lighting</span>
                <select id="pt-light" class="mac-sel">
                  <option value="studio" selected>Studio (3-point)</option>
                  <option value="outdoor">Outdoor (sun + sky)</option>
                  <option value="sunset">Sunset (warm key)</option>
                  <option value="softbox">Soft box (top)</option>
                  <option value="rim">Rim (back light)</option>
                </select>
              </label>
              <label class="pt-ctrl pt-ctrl-toggle">
                <span>Clay mode</span>
                <input type="checkbox" id="pt-clay">
              </label>
            </div>
          </div>

          <div class="pt-side-note">
            Changes restart accumulation. HDRI environment isn't bridged from the host scene — use the lighting presets above.
          </div>
        </aside>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  _modal = overlay;
  _injectStylesOnce();
  window.lucide?.createIcons?.({ attrs: { 'stroke-width': 1.8 } });

  const $$ = (id) => overlay.querySelector('#' + id);
  const closeBtn  = $$('pt-close');
  const cancelBtn = $$('pt-cancel');
  const saveBtn   = $$('pt-save');
  const wrap      = $$('pt-canvas-wrap');
  const statusEl  = $$('pt-status');
  const samplesEl = $$('pt-samples');
  const elapsedEl = $$('pt-elapsed');
  const barEl     = $$('pt-bar');
  const targetIn  = $$('pt-target');
  // Sidebar controls
  const bouncesIn  = $$('pt-bounces');  const bouncesOut = $$('pt-bounces-out');
  const sppIn      = $$('pt-spp');      const sppOut     = $$('pt-spp-out');
  const resIn      = $$('pt-res');
  const exposureIn = $$('pt-exposure'); const exposureOut= $$('pt-exposure-out');
  const toneIn     = $$('pt-tone');
  const glossyIn   = $$('pt-glossy');   const glossyOut  = $$('pt-glossy-out');
  const bgIn       = $$('pt-bg');
  const lightIn    = $$('pt-light');
  const clayIn     = $$('pt-clay');

  const initialOpts = {
    bounces:   parseInt(bouncesIn.value, 10),
    spp:       parseInt(sppIn.value, 10),
    resScale:  parseFloat(resIn.value),
    exposure:  parseFloat(exposureIn.value),
    tone:      parseInt(toneIn.value, 10),
    glossy:    parseFloat(glossyIn.value),
    bg:        bgIn.value,
    lighting:  lightIn.value,
    clay:      clayIn.checked,
  };

  const closeAll = () => _closeRenderModal();
  closeBtn .addEventListener('click', closeAll);
  cancelBtn.addEventListener('click', closeAll);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeAll(); });
  const _esc = (e) => { if (e.key === 'Escape') closeAll(); };
  document.addEventListener('keydown', _esc);

  // Kick the actual render on next tick so the modal lays out first — we
  // measure the canvas-wrap area then to size the GL buffer correctly.
  setTimeout(() => {
    try {
      const wrapW = Math.max(64, wrap.clientWidth  || 800);
      const wrapH = Math.max(64, wrap.clientHeight || 600);
      // Fit a rectangle of host-viewport aspect inside the wrap (letterbox).
      let cssW, cssH;
      if (wrapW / wrapH > aspect) {
        cssH = wrapH;
        cssW = Math.round(wrapH * aspect);
      } else {
        cssW = wrapW;
        cssH = Math.round(wrapW / aspect);
      }
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const pxW = Math.max(64, Math.round(cssW * dpr * RESOLUTION_SCALE));
      const pxH = Math.max(64, Math.round(cssH * dpr * RESOLUTION_SCALE));

      _session = _startRenderSession({
        width: pxW, height: pxH,
        cssWidth: cssW, cssHeight: cssH,
        wrap, statusEl, samplesEl, elapsedEl, barEl, targetIn, saveBtn,
        initialOpts, aspect,
      });

      // Wire sidebar controls — call into the session's api.
      const api = _session.api;
      const _bind = (el, out, fn, fmt) => {
        const sync = () => {
          const v = el.type === 'checkbox' ? el.checked
                  : (el.type === 'range' || el.type === 'number') ? parseFloat(el.value)
                  : el.value;
          if (out) out.textContent = fmt ? fmt(v) : v;
          fn(v);
        };
        el.addEventListener('input', sync);
        if (el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'color') {
          el.addEventListener('change', sync);
        }
      };
      _bind(bouncesIn,  bouncesOut,  (v) => api.setBounces(v|0));
      _bind(sppIn,      sppOut,      (v) => api.setSamplesPerFrame(v|0));
      _bind(resIn,      null,        (v) => api.setResolutionScale(parseFloat(v)));
      _bind(exposureIn, exposureOut, (v) => api.setExposure(v),      (v) => Number(v).toFixed(2));
      _bind(toneIn,     null,        (v) => api.setToneMapping(parseInt(v,10)));
      _bind(glossyIn,   glossyOut,   (v) => api.setFilterGlossy(v),  (v) => Number(v).toFixed(2));
      _bind(bgIn,       null,        (v) => api.setBackground(v));
      _bind(lightIn,    null,        (v) => api.setLightingPreset(v));
      _bind(clayIn,     null,        (v) => api.setClayMode(!!v));
    } catch (err) {
      console.error('[pathtracer]', err);
      statusEl.textContent = 'Render failed: ' + (err?.message || String(err));
      statusEl.classList.add('error');
    }
  }, 50);

  _modal._teardown = () => {
    document.removeEventListener('keydown', _esc);
    if (_session) { _session.stop(); _session = null; }
  };
}

function _closeRenderModal() {
  if (!_modal) return;
  _modal._teardown?.();
  _modal.remove();
  _modal = null;
}

// ── Render session ──────────────────────────────────────────────────────────

function _startRenderSession(opts) {
  const F = _F;
  const liveScene  = window.state?.partsRoot?.parent || null;
  const liveCamera = F.camera;
  if (!liveScene || !liveCamera) throw new Error('No scene or camera available');
  if (!window.state?.parts?.length) throw new Error('Scene is empty');

  // Offscreen WebGL renderer. Headless-ish — its DOM element is the canvas
  // we display in the modal. Comes from the classic three build (the host's
  // three.webgpu.js doesn't export WebGLRenderer).
  const renderer = new WebGLRenderer({
    antialias: false, alpha: false, preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1); // DPR is already baked into opts.width/height
  renderer.setSize(opts.width, opts.height, false);
  // CSS size = the letterboxed area; buffer is that × DPR for crisp output.
  renderer.domElement.style.width  = opts.cssWidth  + 'px';
  renderer.domElement.style.height = opts.cssHeight + 'px';
  renderer.domElement.style.display = 'block';
  renderer.outputColorSpace = THREE_CLASSIC.SRGBColorSpace;
  renderer.toneMapping = (opts.initialOpts?.tone ?? THREE_CLASSIC.ACESFilmicToneMapping);
  renderer.toneMappingExposure = opts.initialOpts?.exposure ?? 1.0;
  opts.wrap.appendChild(renderer.domElement);

  // Classic-namespace camera mirroring the live one.
  const cam = new PerspectiveCamera(
    liveCamera.fov || 45,
    opts.width / opts.height,
    liveCamera.near || 0.1,
    liveCamera.far || 100000,
  );
  liveCamera.updateMatrixWorld(true);
  cam.matrix.copy(liveCamera.matrixWorld);
  cam.matrix.decompose(cam.position, cam.quaternion, cam.scale);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();

  // Build a parallel classic scene with mesh proxies. Geometries are shared,
  // materials are fresh classic MeshStandardMaterials, transforms are baked.
  const renderScene = _buildClassicProxyScene(liveScene);
  // Apply initial lighting / background / clay choices before first setScene.
  _applyLightingPreset(renderScene, opts.initialOpts?.lighting || 'studio');
  if (opts.initialOpts?.bg) renderScene.background = new Color(opts.initialOpts.bg);
  if (opts.initialOpts?.clay) _setClayMode(renderScene, true);

  const pt = new WebGLPathTracer(renderer);
  try { pt.bounces            = opts.initialOpts?.bounces ?? 5; } catch (e) {}
  try { pt.samplesPerFrame    = opts.initialOpts?.spp     ?? 1; } catch (e) {}
  try { pt.minSamples         = 1; } catch (e) {}
  try { pt.renderScale        = 1.0; } catch (e) {}
  try { pt.filterGlossyFactor = opts.initialOpts?.glossy ?? 0.5; } catch (e) {}

  // Resolution scale tracking — remember the natural buffer/css sizes for
  // the host viewport so re-scaling is always relative to that base.
  const baseW = opts.width, baseH = opts.height;
  const baseCssW = opts.cssWidth, baseCssH = opts.cssHeight;
  let curResScale = opts.initialOpts?.resScale ?? 1.0;
  const _applyResolution = (scale) => {
    curResScale = scale;
    const pxW = Math.max(64, Math.round(baseW * scale));
    const pxH = Math.max(64, Math.round(baseH * scale));
    const cssW = Math.round(baseCssW); // displayed size stays the same
    const cssH = Math.round(baseCssH);
    renderer.setSize(pxW, pxH, false);
    renderer.domElement.style.width  = cssW + 'px';
    renderer.domElement.style.height = cssH + 'px';
    cam.aspect = pxW / pxH;
    cam.updateProjectionMatrix();
  };
  if (curResScale !== 1.0) _applyResolution(curResScale);

  let running = true;
  let stopped = false;
  let cancelled = false;
  let elapsedStart = performance.now();
  let raf = 0;

  const updateUI = () => {
    const target = Math.max(16, Math.min(4096, parseInt(opts.targetIn.value, 10) || SAMPLE_TARGET_DEFAULT));
    const samples = pt.samples | 0;
    opts.samplesEl.textContent = `sample ${samples} / ${target}`;
    const elapsed = (performance.now() - elapsedStart) / 1000;
    opts.elapsedEl.textContent = elapsed.toFixed(1) + 's';
    opts.barEl.style.width = Math.min(100, (samples / target) * 100) + '%';
    if (samples >= 1) opts.saveBtn.disabled = false;
    return { samples, target };
  };

  // Async-ish setup so the "Building BVH…" status paints.
  Promise.resolve().then(async () => {
    try {
      // setScene is synchronous in 0.0.24's high-level path. Yield once to
      // let the status text paint, then run the build.
      await new Promise((r) => requestAnimationFrame(r));
      pt.setScene(renderScene, cam);
      if (cancelled) { _disposeSession(renderer, pt, renderScene); return; }
      opts.statusEl.style.opacity = '0';
      setTimeout(() => opts.statusEl.remove(), 200);
      elapsedStart = performance.now();

      const tick = () => {
        if (!running) return;
        const { samples, target } = updateUI();
        if (samples >= target) { running = false; return; }
        pt.renderSample();
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    } catch (err) {
      console.error('[pathtracer] setScene/render failed', err);
      opts.statusEl.textContent = 'Failed: ' + (err?.message || String(err));
      opts.statusEl.classList.add('error');
      _disposeSession(renderer, pt, renderScene);
    }
  });

  // Save handler — pull pixels from the renderer canvas, blob it, route
  // through the existing screenshot save flow if available.
  opts.saveBtn.addEventListener('click', async () => {
    try {
      const canvas = renderer.domElement;
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((b) => b ? resolve(b) : reject(new Error('toBlob returned null')), 'image/png');
      });
      const name = _defaultRenderName();
      const saver = window._saveScreenshotBlob || null;
      if (saver) {
        const finalName = await saver(blob, name);
        F.toast?.('Render saved', `${finalName} (${opts.width}×${opts.height}, ${pt.samples} spp)`, 'info', 2400);
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        F.toast?.('Render saved', name, 'info', 2400);
      }
    } catch (err) {
      console.error('[pathtracer] save failed', err);
      F.toast?.('Save failed', err?.message || String(err), 'warn');
    }
  });

  // ── Live-update API exposed to the sidebar ───────────────────────────
  const reset = () => {
    try { pt.reset?.(); } catch (e) {}
    elapsedStart = performance.now();
    // Make sure the loop keeps ticking — completed runs end with running=false.
    if (!running && !stopped) {
      running = true;
      const tick = () => {
        if (!running) return;
        const { samples, target } = updateUI();
        if (samples >= target) { running = false; return; }
        pt.renderSample();
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }
  };
  const resetScene = () => {
    try { pt.setScene(renderScene, cam); } catch (e) { console.error('[pathtracer] resetScene failed', e); }
    reset();
  };
  const api = {
    setBounces(v)         { try { pt.bounces = v; } catch {} reset(); },
    setSamplesPerFrame(v) { try { pt.samplesPerFrame = Math.max(1, v|0); } catch {} },
    setExposure(v)        { renderer.toneMappingExposure = v; reset(); },
    setToneMapping(v)     { renderer.toneMapping = v; reset(); },
    setFilterGlossy(v)    { try { pt.filterGlossyFactor = v; } catch {} reset(); },
    setBackground(hex)    { renderScene.background = new Color(hex); resetScene(); },
    setLightingPreset(n)  { _applyLightingPreset(renderScene, n); resetScene(); },
    setClayMode(on)       { _setClayMode(renderScene, !!on);     resetScene(); },
    setResolutionScale(s) { _applyResolution(s); resetScene(); },
  };

  return {
    api,
    stop() {
      if (stopped) return;
      stopped = true;
      cancelled = true;
      running = false;
      if (raf) cancelAnimationFrame(raf);
      _disposeSession(renderer, pt, renderScene);
    },
  };
}

// ── Lighting presets ────────────────────────────────────────────────────────

const _LIGHT_TAG = '_pt_light';
function _clearLights(scene) {
  const kill = [];
  scene.traverse((o) => { if (o.userData && o.userData[_LIGHT_TAG]) kill.push(o); });
  for (const o of kill) {
    try { o.parent?.remove(o); } catch (e) {}
    try { o.dispose?.(); } catch (e) {}
  }
}
function _addLight(scene, light) {
  light.userData[_LIGHT_TAG] = true;
  scene.add(light);
}
function _applyLightingPreset(scene, name) {
  _clearLights(scene);
  switch (name) {
    case 'outdoor': {
      _addLight(scene, new AmbientLight(0x8aa6cc, 0.4));
      const sun = new DirectionalLight(0xfff2d0, 3.0);
      sun.position.set(120, 200, 80); _addLight(scene, sun);
      const sky = new DirectionalLight(0x88bbff, 0.6);
      sky.position.set(-40, 200, -100); _addLight(scene, sky);
      break;
    }
    case 'sunset': {
      _addLight(scene, new AmbientLight(0x553344, 0.3));
      const key = new DirectionalLight(0xffb070, 3.2);
      key.position.set(160, 40, 80); _addLight(scene, key);
      const back = new DirectionalLight(0x4477aa, 0.4);
      back.position.set(-80, 60, -120); _addLight(scene, back);
      break;
    }
    case 'softbox': {
      _addLight(scene, new AmbientLight(0xffffff, 0.6));
      const top = new DirectionalLight(0xffffff, 2.6);
      top.position.set(0, 200, 30); _addLight(scene, top);
      const fill = new DirectionalLight(0xffffff, 0.5);
      fill.position.set(0, 50, 200); _addLight(scene, fill);
      break;
    }
    case 'rim': {
      _addLight(scene, new AmbientLight(0xffffff, 0.25));
      const rim = new DirectionalLight(0xffffff, 4.0);
      rim.position.set(-100, 80, -180); _addLight(scene, rim);
      const fill = new DirectionalLight(0xffffff, 0.4);
      fill.position.set(80, 30, 100); _addLight(scene, fill);
      break;
    }
    case 'studio':
    default: {
      _addLight(scene, new AmbientLight(0xffffff, 0.55));
      const key = new DirectionalLight(0xffffff, 2.2);
      key.position.set(80, 100, 60); _addLight(scene, key);
      const fill = new DirectionalLight(0xb0c4ff, 0.6);
      fill.position.set(-80, -40, 60); _addLight(scene, fill);
      break;
    }
  }
}

// ── Clay mode ───────────────────────────────────────────────────────────────

const _CLAY_TAG = '_pt_origMat';
function _setClayMode(scene, on) {
  scene.traverse((obj) => {
    if (!(obj.isMesh || obj.isInstancedMesh)) return;
    if (on) {
      if (obj.userData[_CLAY_TAG]) return; // already in clay mode
      obj.userData[_CLAY_TAG] = obj.material;
      obj.material = new MeshStandardMaterial({ color: 0xbcbcbc, metalness: 0, roughness: 0.55 });
    } else {
      const orig = obj.userData[_CLAY_TAG];
      if (!orig) return;
      try { obj.material?.dispose?.(); } catch {}
      obj.material = orig;
      delete obj.userData[_CLAY_TAG];
    }
  });
}

// Build a fresh classic-namespace scene that mirrors the host's meshes.
// Geometries are shared (no copy — saves memory on big assemblies),
// materials are synthesized as MeshStandardMaterial, world transforms are
// baked. Skips helpers (gizmos, axes, grid) — anything with isHelper or
// names beginning with underscore is excluded.
function _buildClassicProxyScene(srcScene) {
  const scene = new Scene();
  // Background — copy color if it's a Color-like; skip texture/cubemap to
  // keep the renderer simple.
  if (srcScene.background && srcScene.background.isColor) {
    scene.background = new Color().copy(srcScene.background);
  }

  // Lights are added by _applyLightingPreset after the scene is built so we
  // can preset-switch from the sidebar without rebuilding mesh proxies.

  // Walk ONLY under partsRoot — the host's user-content group. Anything
  // outside (transform-control gizmos, helper grids, sky meshes, sun
  // visualizers, debug bbox roots) is excluded by construction. Falls back
  // to the whole scene if partsRoot is missing for some reason.
  const walkRoot = window.state?.partsRoot || srcScene;

  let count = 0;
  srcScene.updateMatrixWorld(true);
  walkRoot.traverse((obj) => {
    if (!obj.visible) return;
    if (obj.isHelper) return;
    if (obj.userData?._isGizmo) return;
    if (obj.userData?._isOriginMarker) return;
    if (obj.userData?._isAxesHelper) return;
    // Constructor-name guard catches three.js helpers that don't set the
    // .isHelper flag (TransformControlsGizmo, AxesHelper, BoxHelper, etc.).
    const ctorName = obj.constructor?.name || '';
    if (/Helper$|Gizmo$|Controls$/.test(ctorName)) return;
    // Skip ancestors that are themselves invisible (catches "Hide sources"
    // cloners where the source mesh is parented under a hidden Group).
    if (_hasInvisibleAncestor(obj, walkRoot)) return;
    if (!(obj.isMesh || obj.isInstancedMesh)) return;
    if (!obj.geometry) return;

    // Bake world transform — proxy lives flat under the new scene so we
    // don't have to walk the parent chain.
    obj.updateWorldMatrix(true, false);
    const worldMat = new Matrix4().copy(obj.matrixWorld);

    const srcMat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    const stdMat = _toStandard(srcMat);

    let proxy;
    if (obj.isInstancedMesh && typeof obj.count === 'number') {
      proxy = new InstancedMesh(obj.geometry, stdMat, obj.count);
      // Copy per-instance matrices.
      const m = new Matrix4();
      for (let i = 0; i < obj.count; i++) {
        obj.getMatrixAt(i, m);
        proxy.setMatrixAt(i, m);
      }
      proxy.instanceMatrix.needsUpdate = true;
    } else {
      proxy = new Mesh(obj.geometry, stdMat);
    }
    proxy.matrixAutoUpdate = false;
    proxy.matrix.copy(worldMat);
    proxy.matrix.decompose(proxy.position, proxy.quaternion, proxy.scale);
    proxy.updateMatrixWorld(true);
    scene.add(proxy);
    count++;
  });
  console.log(`[pathtracer] proxy scene built: ${count} meshes`);
  return scene;
}

// Walk up the parent chain looking for an invisible ancestor. Stops at the
// supplied root so we don't reach into the scene's hidden helper layer
// above partsRoot.
function _hasInvisibleAncestor(obj, root) {
  let p = obj.parent;
  while (p && p !== root) {
    if (!p.visible) return true;
    p = p.parent;
  }
  return false;
}

function _toStandard(src) {
  const m = new MeshStandardMaterial();
  if (!src) return m;
  // Copy whatever we can find — most fields are duck-typed so a TSL
  // NodeMaterial will still have .color / .map / .opacity / etc. on it.
  try {
    if (src.color && src.color.isColor) m.color.copy(src.color);
    else if (src.color !== undefined) m.color = new Color(src.color);
  } catch (e) {}
  try { if (typeof src.opacity === 'number') m.opacity = src.opacity; } catch (e) {}
  try { if (typeof src.transparent === 'boolean') m.transparent = src.transparent; } catch (e) {}
  try { if (typeof src.metalness === 'number') m.metalness = src.metalness; } catch (e) {}
  try { if (typeof src.roughness === 'number') m.roughness = src.roughness; } catch (e) {}
  try { if (src.emissive && src.emissive.isColor) m.emissive.copy(src.emissive); } catch (e) {}
  try { if (typeof src.emissiveIntensity === 'number') m.emissiveIntensity = src.emissiveIntensity; } catch (e) {}
  try { if (src.map && src.map.isTexture) m.map = src.map; } catch (e) {}
  try { if (src.normalMap && src.normalMap.isTexture) m.normalMap = src.normalMap; } catch (e) {}
  try { if (src.roughnessMap && src.roughnessMap.isTexture) m.roughnessMap = src.roughnessMap; } catch (e) {}
  try { if (src.metalnessMap && src.metalnessMap.isTexture) m.metalnessMap = src.metalnessMap; } catch (e) {}
  try { if (typeof src.side === 'number') m.side = src.side; } catch (e) {}
  try { if (typeof src.flatShading === 'boolean') m.flatShading = src.flatShading; } catch (e) {}
  try { if (typeof src.vertexColors === 'boolean') m.vertexColors = src.vertexColors; } catch (e) {}
  m.needsUpdate = true;
  return m;
}

function _disposeProxyScene(scene) {
  if (!scene) return;
  scene.traverse((obj) => {
    if (obj.isMesh || obj.isInstancedMesh) {
      // Both the active material AND any stashed clay-mode original are our
      // own proxies — safe to dispose. Geometry is SHARED with the host
      // scene; do NOT dispose it or the live viewport breaks.
      try { obj.material?.dispose?.(); } catch (e) {}
      try { obj.userData?.[_CLAY_TAG]?.dispose?.(); } catch (e) {}
    }
  });
}

function _disposeSession(renderer, pt, renderScene) {
  _disposeProxyScene(renderScene);
  try { pt?.dispose?.(); } catch (e) { /* swallow */ }
  try { renderer?.dispose?.(); } catch (e) { /* swallow */ }
  try { renderer?.forceContextLoss?.(); } catch (e) { /* swallow */ }
  try { renderer?.domElement?.remove?.(); } catch (e) { /* swallow */ }
}

function _defaultRenderName() {
  const base = window._defaultScreenshotName?.() || 'render';
  return base.replace(/\.png$/i, '') + '_pt.png';
}

// ── Styles (design-token-driven) ───────────────────────────────────────────

let _stylesInjected = false;
function _injectStylesOnce() {
  if (_stylesInjected) return;
  _stylesInjected = true;
  const css = `
.pt-overlay{
  position:fixed;inset:0;z-index:var(--z-modal);
  background:rgba(0,0,0,.55);backdrop-filter:blur(6px);
  display:grid;place-items:center;
  animation:pt-fade var(--dur-fast) var(--ease-out);
}
@keyframes pt-fade{from{opacity:0}to{opacity:1}}
.pt-modal{
  width:min(94vw, 1480px);height:min(90vh, 940px);
  background:var(--bg1);border:1px solid var(--bd);border-radius:var(--r-xl);
  box-shadow:var(--sh-pop);display:flex;flex-direction:column;overflow:hidden;
  font-family:var(--font-sans);color:var(--tx);
}
.pt-head{
  display:flex;align-items:center;gap:var(--space-md);
  padding:var(--space-md) var(--space-lg);
  border-bottom:1px solid var(--bd);
  background:var(--bg2);
}
.pt-title{display:flex;align-items:center;gap:var(--space-xs);font-weight:var(--fw-semibold);font-size:var(--fs-sm)}
.pt-title svg{width:16px;height:16px;color:#c4b5fd}
.pt-meta{
  display:flex;align-items:center;gap:var(--space-sm);
  margin-left:var(--space-lg);font-size:var(--fs-xs);color:var(--tx2);
  font-variant-numeric:tabular-nums;
}
.pt-dot{width:3px;height:3px;border-radius:50%;background:var(--tx3)}
.pt-close{
  margin-left:auto;background:transparent;border:none;color:var(--tx2);
  width:28px;height:28px;border-radius:var(--r-sm);
  display:grid;place-items:center;cursor:pointer;
  transition:background var(--dur-fast) var(--ease-out),color var(--dur-fast) var(--ease-out);
}
.pt-close:hover{background:var(--s2);color:var(--tx)}
.pt-close svg{width:16px;height:16px}
.pt-body{flex:1;min-height:0;display:flex;flex-direction:row;background:var(--bg-checker, var(--bg))}
.pt-main{flex:1;min-width:0;display:flex;flex-direction:column}
.pt-canvas-wrap{
  flex:1;min-height:0;position:relative;
  display:grid;place-items:center;overflow:hidden;
}
/* Sidebar matches #sidebar-right: same background, padding, border, font
   stack, and reuses the .section / .section-h / .section-b shell so groups
   look identical to the rest of the app's right rail. */
.pt-side{
  width:284px;flex:0 0 284px;
  background:var(--bg);
  border-left:1px solid var(--bd);
  display:flex;flex-direction:column;
  overflow-y:auto;
  padding:12px 12px 20px;
  font-family:var(--font-sans);
}
.pt-side .section-b{padding:6px 10px 12px}

/* Control row — single span title on a labelled row. Range sliders span
   full width on the row below with the value readout floating right. */
.pt-ctrl{
  display:grid;grid-template-columns:1fr auto;align-items:center;
  column-gap:var(--space-sm);row-gap:5px;
  margin:6px 0 10px;
  font-size:var(--fs-11);color:var(--tx2);
  font-family:var(--font-sans);
}
.pt-ctrl:last-child{margin-bottom:2px}
.pt-ctrl > span{grid-column:1 / 2}
.pt-ctrl > output{
  grid-column:2 / 3;grid-row:1;
  font-variant-numeric:tabular-nums;font-size:var(--fs-11);
  color:var(--tx);min-width:30px;text-align:right;
}

/* Range — full row width, accent track, low-key thumb. */
.pt-ctrl > input[type="range"]{
  grid-column:1 / -1;grid-row:2;
  width:100%;height:18px;margin:0;
  -webkit-appearance:none;appearance:none;background:transparent;cursor:pointer;
}
.pt-ctrl > input[type="range"]::-webkit-slider-runnable-track{
  height:3px;background:var(--s3);border-radius:var(--r-pill);
}
.pt-ctrl > input[type="range"]::-moz-range-track{
  height:3px;background:var(--s3);border-radius:var(--r-pill);
}
.pt-ctrl > input[type="range"]::-webkit-slider-thumb{
  -webkit-appearance:none;appearance:none;
  width:13px;height:13px;border-radius:50%;
  background:var(--ac);border:2px solid var(--bg1);
  margin-top:-5px;cursor:pointer;
  box-shadow:0 1px 3px rgba(0,0,0,.35);
}
.pt-ctrl > input[type="range"]::-moz-range-thumb{
  width:13px;height:13px;border-radius:50%;
  background:var(--ac);border:2px solid var(--bg1);cursor:pointer;
  box-shadow:0 1px 3px rgba(0,0,0,.35);
}

/* Stacked control — select / number on its own row below the label. */
.pt-ctrl-stack{grid-template-columns:1fr}
.pt-ctrl-stack > span{margin-bottom:2px}
.pt-ctrl-stack > select{
  grid-column:1 / -1;width:100%;
  height:28px;padding:0 28px 0 10px;font-size:10px;line-height:1;
  background:var(--bg2);border:1px solid var(--bd);border-radius:var(--r-sm);
  color:var(--tx);
}

/* Row control — label + small inline control (color picker, etc.). */
.pt-ctrl-row{grid-template-columns:1fr auto;align-items:center}
.pt-ctrl-row > input[type="color"]{
  grid-column:2 / 3;grid-row:1;
  width:32px;height:22px;padding:0;
  border:1px solid var(--bd);border-radius:var(--r-sm);
  background:transparent;cursor:pointer;
}

/* Toggle — pill switch consistent with the rest of the app. */
.pt-ctrl-toggle{grid-template-columns:1fr auto;align-items:center}
.pt-ctrl-toggle > input[type="checkbox"]{
  grid-column:2 / 3;grid-row:1;justify-self:end;
  width:32px;height:18px;-webkit-appearance:none;appearance:none;
  background:var(--s3);border-radius:999px;position:relative;cursor:pointer;border:none;
  transition:background var(--dur-fast) var(--ease-out);
}
.pt-ctrl-toggle > input[type="checkbox"]::after{
  content:'';position:absolute;top:2px;left:2px;
  width:14px;height:14px;border-radius:50%;background:var(--tx);
  transition:transform var(--dur-fast) var(--ease-out),background var(--dur-fast) var(--ease-out);
}
.pt-ctrl-toggle > input[type="checkbox"]:checked{background:var(--ac)}
.pt-ctrl-toggle > input[type="checkbox"]:checked::after{transform:translateX(14px);background:#fff}

.pt-side-note{
  margin:10px 2px 0;padding:8px 10px;
  background:var(--s1);border:1px solid var(--hairline);border-radius:var(--r-sm);
  font-size:var(--fs-11);color:var(--tx3);line-height:var(--lh-relaxed);
}
.pt-canvas-wrap canvas{
  max-width:100%;max-height:100%;
  box-shadow:var(--sh-card);border-radius:var(--r-sm);
}
.pt-status{
  position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
  background:var(--glass-strong);backdrop-filter:blur(10px);
  border:1px solid var(--bd);border-radius:var(--r-md);
  padding:var(--space-sm) var(--space-md);
  font-size:var(--fs-sm);color:var(--tx2);
  transition:opacity var(--dur-slow) var(--ease-out);
}
.pt-status.error{color:var(--er);border-color:var(--er-line);background:var(--er-soft)}
.pt-bar{height:2px;background:var(--bd);position:relative;overflow:hidden}
.pt-bar-fill{
  position:absolute;inset:0 auto 0 0;width:0%;
  background:linear-gradient(90deg, #c4b5fd, var(--ac));
  transition:width var(--dur-base) var(--ease-out);
}
.pt-foot{
  display:flex;align-items:center;gap:var(--space-sm);
  padding:var(--space-md) var(--space-lg);
  border-top:1px solid var(--bd);background:var(--bg2);
}
.pt-target{display:flex;align-items:center;gap:var(--space-xs);font-size:var(--fs-xs);color:var(--tx2)}
.pt-target input{
  width:60px;padding:4px 6px;font-size:var(--fs-xs);
  background:var(--bg);border:1px solid var(--bd);border-radius:var(--r-sm);
  color:var(--tx);font-variant-numeric:tabular-nums;
}
.pt-spacer{flex:1}
.pt-foot .tbtn{font-size:var(--fs-xs)}
.pt-foot .tbtn.primary{background:var(--ac);color:var(--tx-on-accent);border-color:var(--ac)}
.pt-foot .tbtn.primary:disabled{opacity:.5;cursor:not-allowed}
`;
  const s = document.createElement('style');
  s.id = 'pt-styles';
  s.textContent = css;
  document.head.appendChild(s);
}

// ── Boot ────────────────────────────────────────────────────────────────────
_whenReady();
