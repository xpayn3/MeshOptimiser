// STEP Optimizer - app.js (rebuilt for large engineering CAD)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
// OBJ export uses our own streaming writer (_exportObjStreaming) to avoid
// V8's single-string limit; three.js's stock OBJExporter is not imported.
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { PLYExporter } from 'three/addons/exporters/PLYExporter.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { USDZExporter } from 'three/addons/exporters/USDZExporter.js';
import { GLTFLoader }  from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader }   from 'three/addons/loaders/FBXLoader.js';
import { OBJLoader }   from 'three/addons/loaders/OBJLoader.js';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
import { STLLoader }   from 'three/addons/loaders/STLLoader.js';
// Optional decoders. Imported eagerly so they're cached at boot, but only
// attached to the loader when present. step2glb.py's --meshopt flag emits GLBs
// using EXT_meshopt_compression (industry-standard); --quantize uses
// KHR_mesh_quantization. Without these the loader would silently skip
// extension-decoded primitives and you'd see an empty scene.
import { DRACOLoader }     from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader }      from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder }  from 'three/addons/libs/meshopt_decoder.module.js';

const $ = id => document.getElementById(id);

const state = {
  parts: [], partById: new Map(), selected: new Set(), modelDiag: 1, history: [], redo: [],
  viewMode: 'solid', showGrid: true, showBboxes: false, showAxes: true,
  highlightSmall: true, autoRotate: false, bgMode: 'dark',
  // ── Pro-mode scene settings (driven by the Display/Scene/Camera/Lighting
  // /Grid sections of the viewport settings popup) ───────────────────────
  displayUnit: 'mm',          // 'mm' | 'cm' | 'm' | 'in' | 'ft' | 'none'
  sceneUpAxis: 'z',
  sceneScale: 1,
  cameraProjection: 'persp',
  cameraFov: 45,
  cameraClipMode: 'auto',
  showOrigin: false, showFps: false, showStats: false,
  shadowsEnabled: false,
  exposure: 1.0,
  ambientIntensity: 0.55, sunIntensity: 1.2,
  sunAzimuth: 45, sunElevation: 45,
  gridCellMode: 'auto',
  snapToGrid: false,
  pendingFlagged: new Set(),
  partsRoot: null, bboxRoot: null,
  sizeMetricMode: 'diag', threshold: 2.0,
  materialByColor: new Map(), geomByHash: new Map(), instancedGroups: [],
  shareMaterials: true, autoInstance: true,
  // Hierarchical tree, populated from GLB scene graph by loadGlbFile. When
  // empty, rebuildTree falls back to flat-list rendering (legacy STEP path
  // and old GLBs that have no parent/child structure).
  treeNodes: [],                // ordered DFS list: { id, kind, name, depth, parentId, partId? }
  treeCollapsed: new Set(),     // set of group ids whose children are hidden
  selectedGroupIds: new Set(),  // group rows the user clicked on — drives the
                                // sidebar highlight on the group row itself
                                // (separate from state.selected which holds
                                // partIds for the actual viewport selection)
  gizmo: null, gizmoHelper: null, gizmoMode: 'translate',
  // ── Perf: render-on-demand + lazy resources ─────────────────────────────
  needsRender: true,           // tick() draws when true
  activeFrames: 0,             // keep rendering N frames after each invalidation
  bboxBuilt: false,            // bbox helpers built lazily on first toggle
  perfMode: 'auto',            // 'auto' (cap DPR by part count) | 'high' | 'low'
  // ── Render-health bookkeeping (watchdog reads these) ────────────────────
  // Explicitly 0 not undefined: previously the watchdog gated its "healthy
  // frame" timestamp on `_renderErrCount === 0` and undefined !== 0, so a
  // session that never errored never got marked healthy and the watchdog
  // false-fired every 30 s after the first 5 s of use.
  _renderErrCount: 0,
  _renderErrLogAt: 0,
  _pausedSinceMs: 0,
};
// Expose state on window for console-debug only — doesn't change app behavior,
// but lets you type `state.treeNodes.length` etc. directly in DevTools without
// needing a build of the bundle that explicitly exports it.
if (typeof window !== 'undefined') {
  window.state = state;
  // Expose tree functions for the frozen-rail patch (see index.html patch script).
  // Also exposes engine handles for stresstest.js (camera/renderer/THREE etc.)
  // — getters because these module-level lets aren't bound until initRenderer().
  window._appFns = {
    get rebuildTree() { return rebuildTree; },
    get getPart() { return getPart; },
    get requestRender() { return requestRender; },
    get _treeGroupDescendants() { return _treeGroupDescendants; },
    get THREE() { return THREE; },
    get camera() { return camera; },
    get renderer() { return renderer; },
    get controls() { return controls; },
    get applyPerfMode() { return applyPerfMode; },
    get applySelectionColors() { return applySelectionColors; },
    get clearModel() { return clearModel; },
    get fitToView() { return fitToView; },
    get reindexParts() { return _reindexParts; },
  };
}

// Damping is off (pan/orbit must feel snappy and stop on release), so we only
// need a tiny tail to cover any frame race after the last 'change' event from
// OrbitControls or TransformControls. Each interaction frame fires its own
// requestRender, so this just guards the very last frame.
const RENDER_DECAY_FRAMES = 2;
function requestRender(decay = RENDER_DECAY_FRAMES) {
  state.needsRender = true;
  if (decay > state.activeFrames) state.activeFrames = decay;
}
// O(1) part lookup. Always rebuild via _reindexParts() after parts changes.
function getPart(id) { return state.partById.get(id); }
function _reindexParts() {
  state.partById.clear();
  for (const p of state.parts) state.partById.set(p.partId, p);
}

// Render any pending <i data-lucide="..."> placeholders into actual SVGs.
// Idempotent — Lucide skips already-rendered icons. Safe to call after any
// DOM injection that may have introduced new placeholders.
function _lucide() {
  try { window.lucide && window.lucide.createIcons && window.lucide.createIcons(); }
  catch (_) { /* lucide CDN failed to load; silently fall back to placeholders */ }
}

let scene, camera, renderer, controls;
let raycaster, pointer;
let gridHelper, axesHelper;
let frameCount = 0, lastFps = performance.now();
let _sceneReady = false, _pendingFile = null;
let _stepWorker = null, _activeParse = null;

function toast(title, msg='', type='info', dur=2400) {
  const stack = $('toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.dataset.state = 'enter';
  el.innerHTML = `<span class="t">${title}</span>${msg ? `<span class="m">${msg}</span>` : ''}`;
  stack.appendChild(el);
  // Force a layout flush so the browser sees the "enter" state, then flip to
  // "open" so the CSS transition runs. Cheaper than animation/keyframes and
  // can be retargeted mid-flight by the exit transition.
  requestAnimationFrame(() => { el.dataset.state = 'open'; });
  setTimeout(() => {
    el.dataset.state = 'exit';
    setTimeout(() => el.remove(), 220);
  }, dur);
}

// ─── App-styled confirm / prompt (replaces native browser dialogs) ─────────
// Single shared modal element, reused across calls. Returns a Promise so call
// sites can `await appConfirm(...)` / `await appPrompt(...)`. Esc cancels,
// Enter accepts. Backdrop click cancels. Visual style matches the export modal.
const _Dialog = (() => {
  let bg, card, msgEl, inputEl, cancelBtn, okBtn, titleEl, iconEl, onClose;

  function _injectStyles() {
    if (document.getElementById('_dlg-style')) return;
    const s = document.createElement('style');
    s.id = '_dlg-style';
    s.textContent = `
      .dlg-bg{position:fixed;inset:0;background:transparent;display:none;place-items:center;z-index:300;opacity:0;transition:opacity .18s ease}
      .dlg-bg.show{display:grid;opacity:1}
      .dlg-card{
        width:min(420px,calc(100vw - 32px));
        background:linear-gradient(180deg,rgba(28,33,44,.96),rgba(18,22,30,.96));
        border:1px solid rgba(255,255,255,.08);
        border-radius:16px;
        box-shadow:0 30px 80px -20px rgba(0,0,0,.6),0 1px 0 rgba(255,255,255,.06) inset,0 -1px 0 rgba(0,0,0,.4) inset;
        overflow:hidden;
        transform:translateY(8px) scale(.97);
        opacity:0;
        transition:transform .22s cubic-bezier(.2,.8,.3,1),opacity .18s ease;
      }
      .dlg-bg.show .dlg-card{transform:translateY(0) scale(1);opacity:1}
      .dlg-head{display:flex;align-items:flex-start;gap:14px;padding:22px 22px 0}
      .dlg-icon{flex-shrink:0;width:40px;height:40px;border-radius:11px;display:grid;place-items:center;background:rgba(110,168,255,.12);color:var(--ac);box-shadow:inset 0 0 0 1px rgba(110,168,255,.18)}
      .dlg-icon svg{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
      .dlg-card.danger .dlg-icon{background:rgba(255,107,107,.13);color:var(--er);box-shadow:inset 0 0 0 1px rgba(255,107,107,.2)}
      .dlg-text{flex:1;min-width:0;padding-top:2px}
      .dlg-title{font-size:15px;font-weight:600;color:var(--tx);letter-spacing:-.01em;margin-bottom:6px}
      .dlg-msg{color:var(--tx2);font-size:13px;line-height:1.55;white-space:pre-wrap;word-wrap:break-word}
      .dlg-input{display:none;width:100%;margin-top:14px;padding:10px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px;color:var(--tx);font-size:13.5px;font-family:inherit;outline:none;transition:border-color .15s,background .15s,box-shadow .15s}
      .dlg-input:focus{border-color:rgba(110,168,255,.5);background:rgba(255,255,255,.06);box-shadow:0 0 0 3px rgba(110,168,255,.15)}
      .dlg-foot{display:flex;justify-content:flex-end;gap:8px;padding:18px 22px 20px;margin-top:18px;border-top:1px solid rgba(255,255,255,.05);background:rgba(0,0,0,.18)}
      .dlg-btn{font:inherit;padding:8px 16px;border-radius:8px;border:1px solid transparent;cursor:pointer;font-size:13px;font-weight:500;transition:transform .08s,filter .12s,background .12s,border-color .12s;letter-spacing:.005em}
      .dlg-btn:active{transform:translateY(.5px)}
      .dlg-btn-cancel{background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.06);color:var(--tx2)}
      .dlg-btn-cancel:hover{background:rgba(255,255,255,.08);color:var(--tx);border-color:rgba(255,255,255,.1)}
      .dlg-btn-ok{background:linear-gradient(180deg,#7ab2ff,#4f8be5);color:white;border-color:transparent;box-shadow:0 4px 14px rgba(110,168,255,.28),inset 0 1px 0 rgba(255,255,255,.18)}
      .dlg-btn-ok:hover{filter:brightness(1.07)}
      .dlg-btn-ok.danger{background:linear-gradient(180deg,#ff7a85,#e25151);box-shadow:0 4px 14px rgba(255,107,107,.32),inset 0 1px 0 rgba(255,255,255,.18)}
      .dlg-close{position:absolute;top:14px;right:14px;width:28px;height:28px;border-radius:8px;display:grid;place-items:center;color:var(--tx3);background:transparent;border:none;cursor:pointer;font-size:14px;transition:color .12s,background .12s}
      .dlg-close:hover{color:var(--tx);background:rgba(255,255,255,.06)}
    `;
    document.head.appendChild(s);
  }

  const ICON_INFO   = `<i data-lucide="info"></i>`;
  const ICON_DANGER = `<i data-lucide="triangle-alert"></i>`;
  const ICON_INPUT  = `<i data-lucide="pencil"></i>`;

  function _ensure() {
    if (bg) return;
    _injectStyles();
    bg = document.createElement('div');
    bg.className = 'dlg-bg';
    bg.id = '_app-dialog';
    bg.innerHTML = `
      <div class="dlg-card" style="position:relative">
        <button class="dlg-close" id="_dlg-x" aria-label="Close">✕</button>
        <div class="dlg-head">
          <div class="dlg-icon" id="_dlg-icon">${ICON_INFO}</div>
          <div class="dlg-text">
            <div class="dlg-title" id="_dlg-title">Confirm</div>
            <div class="dlg-msg" id="_dlg-msg"></div>
            <input type="text" class="dlg-input" id="_dlg-input">
          </div>
        </div>
        <div class="dlg-foot">
          <button class="dlg-btn dlg-btn-cancel" id="_dlg-cancel">Cancel</button>
          <button class="dlg-btn dlg-btn-ok" id="_dlg-ok">OK</button>
        </div>
      </div>`;
    document.body.appendChild(bg);
    card     = bg.querySelector('.dlg-card');
    titleEl  = bg.querySelector('#_dlg-title');
    msgEl    = bg.querySelector('#_dlg-msg');
    inputEl  = bg.querySelector('#_dlg-input');
    cancelBtn= bg.querySelector('#_dlg-cancel');
    okBtn    = bg.querySelector('#_dlg-ok');
    iconEl   = bg.querySelector('#_dlg-icon');

    const close = (result) => {
      bg.classList.remove('show');
      const f = onClose; onClose = null;
      if (f) f(result);
    };
    cancelBtn.addEventListener('click', () => close(null));
    bg.querySelector('#_dlg-x').addEventListener('click', () => close(null));
    okBtn.addEventListener('click', () => close(inputEl.style.display === 'none' ? true : inputEl.value));
    bg.addEventListener('click', e => { if (e.target === bg) close(null); });
    document.addEventListener('keydown', e => {
      if (!bg.classList.contains('show')) return;
      if (e.key === 'Escape') { e.preventDefault(); close(null); }
      else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); close(inputEl.style.display === 'none' ? true : inputEl.value); }
    }, true);
  }

  return {
    async confirm(message, { title = 'Confirm', okLabel = 'OK', cancelLabel = 'Cancel', danger = false } = {}) {
      _ensure();
      titleEl.textContent = title;
      msgEl.textContent = message;
      inputEl.style.display = 'none';
      cancelBtn.textContent = cancelLabel;
      okBtn.textContent = okLabel;
      okBtn.classList.toggle('danger', !!danger);
      card.classList.toggle('danger', !!danger);
      iconEl.innerHTML = danger ? ICON_DANGER : ICON_INFO;
      _lucide();
      bg.classList.add('show');
      setTimeout(() => okBtn.focus(), 60);
      return new Promise(res => { onClose = (r) => res(r === true); });
    },
    async prompt(message, defaultValue = '', { title = 'Input', okLabel = 'OK', cancelLabel = 'Cancel', inputType = 'text', min, max, step } = {}) {
      _ensure();
      titleEl.textContent = title;
      msgEl.textContent = message;
      // The shared `.dlg-input` class has `display:none` in CSS, so resetting
      // the inline style to '' would let the class rule win (the bug that
      // showed an empty modal with no field). Force-show with a concrete value.
      inputEl.style.display = 'block';
      inputEl.type = inputType;
      if (inputType === 'number') {
        if (min !== undefined) inputEl.min = String(min); else inputEl.removeAttribute('min');
        if (max !== undefined) inputEl.max = String(max); else inputEl.removeAttribute('max');
        if (step !== undefined) inputEl.step = String(step); else inputEl.step = '1';
      } else {
        inputEl.removeAttribute('min'); inputEl.removeAttribute('max'); inputEl.removeAttribute('step');
      }
      inputEl.value = defaultValue;
      cancelBtn.textContent = cancelLabel;
      okBtn.textContent = okLabel;
      okBtn.classList.remove('danger');
      card.classList.remove('danger');
      iconEl.innerHTML = ICON_INPUT;
      _lucide();
      bg.classList.add('show');
      setTimeout(() => { inputEl.focus(); inputEl.select(); }, 60);
      return new Promise(res => { onClose = (r) => res(typeof r === 'string' ? r : null); });
    },
  };
})();
const appConfirm = (msg, opts) => _Dialog.confirm(msg, opts);
const appPrompt  = (msg, def, opts) => _Dialog.prompt(msg, def, opts);

// ─── Slider widget ─────────────────────────────────────────────────────────
// Plain native <input type="range"> wrapped in a label + value display. The
// browser handles drag/keyboard/touch — we just react to the input event,
// rAF-coalescing the user's onChange so heavy consumers (3D rebuilds) don't
// throttle the input. Click the value chip to type a number directly.
function initScrubber(opts) {
  try { return _initScrubberImpl(opts); }
  catch (e) {
    const ref = typeof opts.el === 'string' ? opts.el : '<element>';
    console.error(`[scrub] init failed for el=${ref}:`, e);
    return null;
  }
}
function _initScrubberImpl({
  el, label = '', maxSteps, stepToVal, valToStep, format, onChange,
  initialValue = 0,
}) {
  const cont = (typeof el === 'string') ? document.getElementById(el) : el;
  if (!cont) { console.warn(`[scrub] container not found: ${el}`); return null; }
  cont.classList.add('scrub');
  cont.innerHTML = `
    <div class="scrub-head">
      <span class="scrub-label"></span>
      <span class="scrub-rhs">
        <span class="scrub-value" tabindex="0" role="textbox" title="Click to type a value">—</span>
        <span class="scrub-unit"></span>
      </span>
    </div>
    <input type="range" class="scrub-range" min="0" max="${maxSteps}" step="1" value="0">`;
  const labelEl = cont.querySelector('.scrub-label');
  let   valEl   = cont.querySelector('.scrub-value');
  const unitEl  = cont.querySelector('.scrub-unit');
  const range   = cont.querySelector('.scrub-range');
  labelEl.textContent = label;

  const initStep = Math.max(0, Math.min(maxSteps, Math.round(valToStep(initialValue))));
  range.value = String(initStep);

  function _syncDisplay() {
    const s = parseInt(range.value, 10) || 0;
    const v = stepToVal(s);
    const f = format(v);
    valEl.textContent = f.value;
    unitEl.textContent = f.unit || '';
    const pct = maxSteps > 0 ? (s / maxSteps * 100) : 0;
    cont.style.setProperty('--scrub-pct', pct + '%');
  }
  _syncDisplay();

  // rAF-coalesce onChange so heavy consumers don't choke the input pipeline.
  let _rafId = 0, _pendingVal = null;
  function _flush() {
    _rafId = 0;
    if (_pendingVal == null) return;
    const v = _pendingVal; _pendingVal = null;
    onChange(v);
  }
  range.addEventListener('input', () => {
    _syncDisplay();
    _pendingVal = stepToVal(parseInt(range.value, 10) || 0);
    if (!_rafId) _rafId = requestAnimationFrame(_flush);
  });
  range.addEventListener('change', () => {
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = 0; _flush(); }
  });

  // Click the value chip → type a number directly.
  function _beginEdit() {
    if (cont.classList.contains('editing')) return;
    cont.classList.add('editing');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'scrub-input';
    input.value = format(stepToVal(parseInt(range.value, 10) || 0)).value;
    input.spellcheck = false;
    input.autocomplete = 'off';
    valEl.replaceWith(input);

    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      cont.classList.remove('editing');
      input.replaceWith(valEl);
      _syncDisplay();
    };
    const accept = () => {
      const num = parseFloat(String(input.value).replace(/[^\d.\-eE+]/g, ''));
      if (isFinite(num)) {
        const s = Math.max(0, Math.min(maxSteps, Math.round(valToStep(num))));
        range.value = String(s);
        _syncDisplay();
        onChange(stepToVal(s));
      }
      cleanup();
    };
    input.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter')       { ev.preventDefault(); accept(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); cleanup(); }
    });
    input.addEventListener('blur', accept);
    setTimeout(() => { input.focus(); input.select(); }, 0);
  }
  valEl.addEventListener('click', (e) => { e.stopPropagation(); _beginEdit(); });
  valEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _beginEdit(); }
  });

  function setValue(v) {
    const s = Math.max(0, Math.min(maxSteps, Math.round(valToStep(v))));
    range.value = String(s);
    _syncDisplay();
  }
  function getValue() { return stepToVal(parseInt(range.value, 10) || 0); }
  function setLabel(txt) { labelEl.textContent = txt; }

  return { setValue, getValue, setLabel, el: cont };
}

let _loaderStart = 0, _loaderTimer = 0;
// Returns true when the welcome modal is currently up — in that case the
// loader UI is mirrored into the welcome pane and the standalone #loader
// is suppressed (Adobe-style integrated splash + loader).
function _welcomeActive() {
  const bg = document.getElementById('welcome-modal');
  return !!(bg && bg.classList.contains('show'));
}

function setLoader(show, msg='Loading', sub='') {
  const inWelcome = _welcomeActive();
  if (show && inWelcome) {
    try { _Welcome?.enterLoading(); } catch (_) {}
  }
  // Hide the standalone loader card when we're piggybacking on the welcome.
  $('loader').classList.toggle('show', show && !inWelcome);
  $('loader-msg').textContent = msg;
  $('loader-sub').textContent = sub;
  const wlMsg = $('wl-msg'); if (wlMsg) wlMsg.textContent = msg;
  const wlSub = $('wl-sub'); if (wlSub) wlSub.textContent = sub;

  if (show) {
    if (!_loaderStart) {
      _loaderStart = performance.now();
      $('loader-log').innerHTML = '';
      const wlLog = $('wl-log'); if (wlLog) wlLog.innerHTML = '';
      logProgress(msg + (sub ? ' - ' + sub : ''));
      _loaderTimer = setInterval(() => {
        const t = ((performance.now() - _loaderStart) / 1000).toFixed(1);
        $('loader-time').textContent = t + 's';
        const wlTime = $('wl-time'); if (wlTime) wlTime.textContent = t + 's';
      }, 100);
    } else { logProgress(msg + (sub ? ' - ' + sub : '')); }
  } else {
    clearInterval(_loaderTimer);
    _loaderTimer = 0; _loaderStart = 0;
    setLoaderProgress(null);
    // Failure / cancel path: load is over but onModelLoaded was never
    // called (it would have hidden the welcome modal already). Bring the
    // user back to the picker pane so they can try a different file.
    if (_welcomeActive()) { try { _Welcome?.enterPick(); } catch (_) {} }
  }
}
function setLoaderProgress(pct) {
  const bars = [$('loader-bar'), $('wl-bar')].filter(Boolean);
  for (const bar of bars) {
    if (pct == null) { bar.classList.add('indeterminate'); bar.style.width = '35%'; }
    else { bar.classList.remove('indeterminate'); bar.style.width = Math.max(0, Math.min(100, pct)).toFixed(1) + '%'; }
  }
}
function logProgress(msg, kind='') {
  const el = ((performance.now() - _loaderStart) / 1000).toFixed(1);
  const lineHTML = `<span class="log-time">${el}s</span><span class="log-msg ${kind}">${msg}</span>`;
  for (const id of ['loader-log', 'wl-log']) {
    const box = document.getElementById(id);
    if (!box) continue;
    const line = document.createElement('div');
    line.className = 'log-line';
    line.innerHTML = lineHTML;
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
    while (box.children.length > 80) box.removeChild(box.firstChild);
  }
  const lvl = kind === 'err' ? 'error' : kind === 'warn' ? 'warn' : kind === 'ok' ? 'success' : 'info';
  Log[lvl](msg, { tag: 'loader' });
}
function setStatus(s) { $('sb-status').textContent = s; }

// ─────────────────────────────────────────────────────────────────────
// Global Log Console — slides up from bottom, toggled from status strip
// ─────────────────────────────────────────────────────────────────────
const Log = (() => {
  const MAX = 2000;
  const entries = [];
  const counts = { all: 0, info: 0, warn: 0, error: 0, debug: 0, success: 0 };
  let activeFilter = 'all';
  let searchQuery = '';
  let autoScroll = true;
  let unread = { warn: 0, error: 0 };
  let panelEl, bodyEl, emptyEl, btnEl, badgeEl, searchEl;
  let booted = false;

  // Capture native console BEFORE any patching — safe to call from add()
  const _native = {
    log:   console.log.bind(console),
    info:  (console.info  || console.log).bind(console),
    warn:  console.warn.bind(console),
    error: console.error.bind(console),
    debug: (console.debug || console.log).bind(console),
  };

  function _fmt(a) {
    if (a == null) return String(a);
    if (typeof a === 'string') return a;
    if (a instanceof Error) return a.stack || a.message || String(a);
    if (typeof a === 'number' || typeof a === 'boolean') return String(a);
    if (typeof a === 'function') return '[function ' + (a.name || 'anonymous') + ']';
    try { return JSON.stringify(a); } catch (_) { return String(a); }
  }
  function _join(args) { return args.map(_fmt).join(' '); }
  function _stamp() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}.${String(d.getMilliseconds()).padStart(3,'0')}`;
  }

  // Public-facing add. Supports add('info', ['msg', obj], { tag: 'foo' })
  // OR Log.info('msg', { tag: 'foo' }) — last arg as opts is detected too.
  function add(level, argsArr, opts = {}) {
    let args = argsArr;
    // detect trailing { tag } opts when called via Log.info('msg', { tag: 'x' })
    if (Array.isArray(args) && args.length && args[args.length - 1] &&
        typeof args[args.length - 1] === 'object' && !Array.isArray(args[args.length - 1]) &&
        !(args[args.length - 1] instanceof Error) && 'tag' in args[args.length - 1]) {
      opts = args[args.length - 1];
      args = args.slice(0, -1);
    }
    const msg = _join(args);
    const tag = opts.tag || '';
    const t = _stamp();
    const entry = { level, msg, tag, t, ts: Date.now() };
    entries.push(entry);
    if (entries.length > MAX) entries.shift();
    counts.all++; counts[level] = (counts[level] || 0) + 1;
    if (booted) {
      _appendRow(entry);
      _updateCounts();
      if (!isOpen() && (level === 'warn' || level === 'error')) {
        unread[level]++; _renderBadge();
      }
    }
    return entry;
  }

  function _appendRow(entry) {
    if (!bodyEl) return;
    if (emptyEl && emptyEl.parentNode) emptyEl.remove();
    const row = document.createElement('div');
    row.className = `lc-row lvl-${entry.level}`;
    row.dataset.level = entry.level;
    row.dataset.text = (entry.msg + ' ' + entry.tag).toLowerCase();
    const tagHTML = entry.tag ? `<span class="lc-tag">[${entry.tag}]</span>` : '';
    row.innerHTML = `<span class="lc-time">${entry.t}</span>${tagHTML}<span class="lc-msg"></span>`;
    row.querySelector('.lc-msg').textContent = entry.msg;
    _applyFilter(row);
    bodyEl.appendChild(row);
    while (bodyEl.children.length > MAX) bodyEl.removeChild(bodyEl.firstChild);
    if (autoScroll) bodyEl.scrollTop = bodyEl.scrollHeight;
  }
  function _applyFilter(row) {
    const lvl = row.dataset.level;
    let okLvl;
    if (activeFilter === 'all') okLvl = true;
    else if (activeFilter === 'info') okLvl = (lvl === 'info' || lvl === 'success');
    else okLvl = (lvl === activeFilter);
    const okSearch = !searchQuery || row.dataset.text.includes(searchQuery);
    row.classList.toggle('hidden', !(okLvl && okSearch));
  }
  function _rerender() {
    if (!bodyEl) return;
    bodyEl.innerHTML = '';
    if (!entries.length) {
      const e = document.createElement('div');
      e.className = 'lc-empty'; e.id = 'lc-empty';
      e.textContent = 'No log entries yet.';
      bodyEl.appendChild(e); emptyEl = e;
      return;
    }
    for (const ent of entries) _appendRow(ent);
  }
  function _updateCounts() {
    const set = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n; };
    set('lc-n-all',   counts.all);
    set('lc-n-info',  (counts.info || 0) + (counts.success || 0));
    set('lc-n-warn',  counts.warn || 0);
    set('lc-n-error', counts.error || 0);
    set('lc-n-debug', counts.debug || 0);
  }
  function _renderBadge() {
    if (!badgeEl) return;
    const n = unread.error + unread.warn;
    if (!n) { badgeEl.classList.add('hidden'); return; }
    badgeEl.classList.remove('hidden');
    badgeEl.textContent = n;
    badgeEl.classList.toggle('warn', unread.error === 0);
  }

  function isOpen() { return !!(panelEl && panelEl.classList.contains('show')); }
  function show() {
    if (!panelEl) return;
    panelEl.classList.add('show');
    btnEl && btnEl.classList.add('active');
    unread.warn = 0; unread.error = 0; _renderBadge();
    try { localStorage.setItem('stepopt-console-open', '1'); } catch (_) {}
    if (autoScroll && bodyEl) bodyEl.scrollTop = bodyEl.scrollHeight;
  }
  function hide() {
    if (!panelEl) return;
    panelEl.classList.remove('show');
    btnEl && btnEl.classList.remove('active');
    try { localStorage.setItem('stepopt-console-open', '0'); } catch (_) {}
  }
  function toggle() { isOpen() ? hide() : show(); }
  function clear() {
    entries.length = 0;
    counts.all = counts.info = counts.warn = counts.error = counts.debug = counts.success = 0;
    _rerender(); _updateCounts();
  }
  async function copy() {
    const text = entries.map(e =>
      `[${e.t}] ${e.level.toUpperCase().padEnd(7)} ${e.tag ? '['+e.tag+'] ' : ''}${e.msg}`
    ).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      try { toast('Copied', `${entries.length} log lines copied`, 'success'); } catch(_){}
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('Copied', `${entries.length} log lines (fallback)`, 'success'); }
      catch (_) { toast('Copy failed', 'Browser blocked clipboard access', 'error'); }
      ta.remove();
    }
  }
  function setFilter(level) {
    activeFilter = level;
    document.querySelectorAll('#lc-filters .lc-pill').forEach(p =>
      p.classList.toggle('active', p.dataset.level === level));
    if (bodyEl) for (const r of bodyEl.children) if (r.classList.contains('lc-row')) _applyFilter(r);
  }
  function setSearch(q) {
    searchQuery = (q || '').toLowerCase();
    if (bodyEl) for (const r of bodyEl.children) if (r.classList.contains('lc-row')) _applyFilter(r);
  }

  function init() {
    if (booted) return;
    panelEl  = document.getElementById('log-console');
    bodyEl   = document.getElementById('lc-b');
    emptyEl  = document.getElementById('lc-empty');
    btnEl    = document.getElementById('sb-console-btn');
    badgeEl  = document.getElementById('sb-console-badge');
    searchEl = document.getElementById('lc-search');
    if (!panelEl || !bodyEl || !btnEl) return;

    btnEl.addEventListener('click', toggle);
    document.getElementById('lc-close')?.addEventListener('click', hide);
    document.getElementById('lc-clear')?.addEventListener('click', clear);
    document.getElementById('lc-copy')?.addEventListener('click', copy);
    const auto = document.getElementById('lc-autoscroll');
    auto?.addEventListener('click', () => {
      autoScroll = !autoScroll;
      auto.classList.toggle('active', autoScroll);
      if (autoScroll && bodyEl) bodyEl.scrollTop = bodyEl.scrollHeight;
    });
    document.querySelectorAll('#lc-filters .lc-pill').forEach(p =>
      p.addEventListener('click', () => setFilter(p.dataset.level)));
    searchEl?.addEventListener('input', () => setSearch(searchEl.value));
    searchEl?.addEventListener('keydown', e => { if (e.key === 'Escape') searchEl.blur(); });

    // resize via top grip
    const grip = document.getElementById('lc-grip');
    if (grip) {
      let dragging = false, startY = 0, startH = 0;
      grip.addEventListener('mousedown', e => {
        dragging = true; startY = e.clientY; startH = panelEl.offsetHeight;
        document.body.style.userSelect = 'none'; e.preventDefault();
      });
      window.addEventListener('mousemove', e => {
        if (!dragging) return;
        const newH = Math.max(120, Math.min(window.innerHeight * 0.9, startH + (startY - e.clientY)));
        panelEl.style.height = newH + 'px';
        try { localStorage.setItem('stepopt-console-h', String(newH)); } catch (_) {}
      });
      window.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false; document.body.style.userSelect = '';
      });
    }

    // restore saved height
    try {
      const h = parseInt(localStorage.getItem('stepopt-console-h') || '0', 10);
      if (h >= 120) panelEl.style.height = h + 'px';
    } catch (_) {}

    // Keyboard: backtick toggles
    document.addEventListener('keydown', e => {
      const tag = (e.target?.tagName || '').toUpperCase();
      const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable;
      if (!inField && (e.key === '`' || e.key === '~')) { e.preventDefault(); toggle(); }
    });

    booted = true;
    _rerender(); _updateCounts(); _renderBadge();

    try {
      if (localStorage.getItem('stepopt-console-open') === '1') show();
    } catch (_) {}
  }

  // Patch console.* IMMEDIATELY so all subsequent app/library logs are captured,
  // even before the panel is initialized (entries queue and flush on init).
  console.log   = (...a) => { _native.log(...a);   add('info',  a); };
  console.info  = (...a) => { _native.info(...a);  add('info',  a); };
  console.warn  = (...a) => { _native.warn(...a);  add('warn',  a); };
  console.error = (...a) => { _native.error(...a); add('error', a); };
  console.debug = (...a) => { _native.debug(...a); add('debug', a); };

  // Capture uncaught errors / promise rejections
  window.addEventListener('error', e => {
    const where = e.filename ? ` (${e.filename.split('/').pop()}:${e.lineno})` : '';
    add('error', [`Uncaught: ${e.message}${where}`]);
  });
  window.addEventListener('unhandledrejection', e => {
    const r = e.reason;
    const msg = r ? (r.stack || r.message || String(r)) : 'unknown';
    add('error', [`Unhandled promise rejection: ${msg}`]);
  });

  const _timers = new Map();
  return {
    init,
    info:    (...a) => add('info',    a),
    warn:    (...a) => add('warn',    a),
    error:   (...a) => add('error',   a),
    success: (...a) => add('success', a),
    debug:   (...a) => add('debug',   a),
    log:     (...a) => add('info',    a),
    tag:     (tag, level, ...a) => add(level || 'info', a, { tag }),
    group:   (name) => add('info', [`▼ ${name}`]),
    groupEnd:() => add('debug', ['▲ end group']),
    time:    (label='timer') => { _timers.set(label, performance.now()); },
    timeEnd: (label='timer') => {
      const t0 = _timers.get(label);
      if (t0 != null) { add('debug', [`${label}: ${(performance.now()-t0).toFixed(1)}ms`]); _timers.delete(label); }
    },
    table:   (rows) => {
      try {
        if (Array.isArray(rows) && rows.length && typeof rows[0] === 'object') {
          const cols = Object.keys(rows[0]);
          add('info', [cols.join(' | ')]);
          for (const r of rows) add('info', [cols.map(c => String(r[c] ?? '')).join(' | ')]);
        } else add('info', [_fmt(rows)]);
      } catch (_) { add('info', [_fmt(rows)]); }
    },
    clear, copy, show, hide, toggle, isOpen, setFilter,
    entries: () => entries.slice(),
  };
})();
// expose for ad-hoc devtools use
if (typeof window !== 'undefined') window.Log = Log;
function fmtNum(n) { return n.toLocaleString(); }
function fmtBytes(b) { if (b < 1024) return b+' B'; if (b<1048576) return (b/1024).toFixed(1)+' KB'; if (b<1073741824) return (b/1048576).toFixed(1)+' MB'; return (b/1073741824).toFixed(2)+' GB'; }
// rAF coalescer: collapse N calls within one frame into a single fn() invocation.
// Used to throttle expensive DOM rebuilds driven by slider drag / search typing,
// where the input fires every ~16 ms and a 5000-node tree rebuild can't keep up.
function rafCoalesce(fn) {
  let scheduled = false;
  return function () {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; fn(); });
  };
}

// Map a file's extension to the matching loader. Keep this list in sync
// with the file-input accept attribute, the welcome-modal MIME map, and
// the drag-and-drop pickers below.
const _MESH_LOADERS = {
  glb:  loadGlbFile,
  gltf: loadGlbFile,
  fbx:  loadFbxFile,
  obj:  loadObjFile,
  '3mf': load3mfFile,
  stl:  loadStlFile,
};
function _loaderForName(name) {
  const m = /\.([^.]+)$/.exec(name || '');
  return m ? _MESH_LOADERS[m[1].toLowerCase()] : null;
}

function _handleSelectedFile(file) {
  if (!file) return;
  const isStep = /\.(step|stp)$/i.test(file.name);
  const meshLoader = _loaderForName(file.name);
  if (!isStep && !meshLoader) {
    toast('Wrong file type', 'Supported: .step, .stp, .glb, .gltf, .fbx, .obj, .3mf, .stl', 'warn');
    return;
  }
  // While the welcome modal is up, switch its body to the loading pane so
  // the user sees progress in-place instead of a separate floating loader.
  try { if (_welcomeActive()) _Welcome?.enterLoading(); } catch (_) {}
  try { _Welcome?.pushRecent(file); } catch (_) {}
  if (!_sceneReady) {
    _pendingFile = file;
    // The loader overlay already conveys "wait for engine init" — no toast.
    return;
  }
  if (meshLoader) { meshLoader(file); return; }
  // STEP: route through the local Python converter (/api/convert) — handles
  // any size, no in-browser WASM cap, materials/colors flow through.
  convertStepViaServer(file);
}

// Upload a STEP file to the running server's /api/convert endpoint, poll the
// background conversion job, then load the resulting GLB. The server runs
// step2glb.py natively so files of any size work.
async function convertStepViaServer(file) {
  const mb = file.size / 1048576;
  setLoader(true, 'Uploading to local converter...', `${file.name} (${mb.toFixed(1)} MB)`);
  setLoaderProgress(2);
  logProgress(`uploading ${mb.toFixed(1)} MB to /api/convert`);
  try {
    // POST file as raw body; server stores under inbox/<job_id>_<name>.step
    const res = await fetch('/api/convert?name=' + encodeURIComponent(file.name) + '&quality=0.5', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
    });
    if (!res.ok) throw new Error('upload failed: HTTP ' + res.status);
    const { job_id } = await res.json();
    logProgress('conversion job started: ' + job_id, 'ok');
    setLoader(true, 'Converting STEP locally (Python)...', 'job ' + job_id);
    setLoaderProgress(null);

    // Poll status; mirror the Python log into the loader's live log
    let lastSeenLogIdx = 0;
    while (true) {
      await new Promise(r => setTimeout(r, 1000));
      const j = await (await fetch('/api/job/' + job_id)).json();
      if (j.message) $('loader-sub').textContent = j.message;
      if (Array.isArray(j.log) && j.log.length > lastSeenLogIdx) {
        for (let i = lastSeenLogIdx; i < j.log.length; i++) {
          const line = j.log[i];
          if (line) logProgress(line);
        }
        lastSeenLogIdx = j.log.length;
      }
      if (j.status === 'done') {
        logProgress('conversion done: ' + j.result, 'ok');
        setLoaderProgress(80);
        // Load the resulting GLB. We keep the loader open across this transition.
        const glbRes = await fetch('inbox/' + j.result);
        if (!glbRes.ok) throw new Error('GLB fetch failed');
        const buf = await glbRes.arrayBuffer();
        const glbFile = new File([new Blob([buf])], j.result);
        await loadGlbFile(glbFile);
        return;
      }
      if (j.status === 'error') {
        // Surface the last 15 lines of the Python output so the user sees the actual traceback
        const tail = (j.log || []).slice(-15);
        for (const line of tail) logProgress(line, 'err');
        console.error('[STEP] Python conversion failed. Tail of log:\n' + tail.join('\n'));
        throw new Error((j.message || 'conversion failed') + (tail.length ? '\n\nLast lines:\n' + tail.slice(-5).join('\n') : ''));
      }
    }
  } catch (e) {
    console.error(e);
    logProgress('conversion failed: ' + e.message, 'err');
    logProgress('---', 'err');
    logProgress('click "Copy log" then "Cancel" below — paste the log here so I can fix it', 'warn');
    toast('Conversion failed', 'Use the Copy Log button below to grab the error', 'error', 12000);
    // Don't auto-close — user dismisses via Cancel after copying the log
  }
}
// ── Welcome modal ────────────────────────────────────────────────────────
// Shown on first boot and any time the user hits the toolbar's Open button
// while no model is loaded. Hosts the drop zone + browse button + recent
// files.
//
// File System Access API (showOpenFilePicker) is preferred when available —
// it returns a FileSystemFileHandle we can persist in IndexedDB so a click
// on a recent re-opens the same file directly (after a one-time permission
// re-grant). Firefox / Safari lack the API and fall back to the classic
// <input type=file>; recents on those browsers re-launch the picker.

const _IDB_NAME = 'stepopt';
const _IDB_STORE = 'handles';
function _idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(_IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(_IDB_STORE)) db.createObjectStore(_IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function _idbPut(key, value) {
  const db = await _idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(_IDB_STORE, 'readwrite');
    tx.objectStore(_IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function _idbGet(key) {
  const db = await _idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(_IDB_STORE, 'readonly');
    const req = tx.objectStore(_IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function _idbDelete(key) {
  const db = await _idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(_IDB_STORE, 'readwrite');
    tx.objectStore(_IDB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
function _recKey(name, size) { return name + '|' + size; }

async function _openWithPicker() {
  if (!window.showOpenFilePicker) {
    document.getElementById('file-input')?.click();
    return;
  }
  let handle;
  try {
    [handle] = await window.showOpenFilePicker({
      types: [{
        description: '3D model (STEP / glTF / FBX / OBJ / 3MF / STL)',
        accept: {
          'model/step':         ['.step', '.stp'],
          'model/gltf-binary':  ['.glb'],
          'model/gltf+json':    ['.gltf'],
          'application/octet-stream': ['.fbx', '.3mf', '.stl'],
          'model/obj':          ['.obj'],
        },
      }],
      excludeAcceptAllOption: false,
      multiple: false,
    });
  } catch (e) {
    if (e?.name !== 'AbortError') console.warn('[STEP] picker failed:', e);
    return;
  }
  let file;
  try { file = await handle.getFile(); }
  catch (e) { console.warn('[STEP] handle.getFile failed:', e); return; }
  try { await _idbPut(_recKey(file.name, file.size), handle); } catch (_) {}
  _handleSelectedFile(file);
}

async function _openRecentByKey(key) {
  if (window.showOpenFilePicker) {
    try {
      const handle = await _idbGet(key);
      if (handle) {
        const opts = { mode: 'read' };
        let perm = 'denied';
        try { perm = await handle.queryPermission(opts); } catch (_) {}
        if (perm !== 'granted') {
          try { perm = await handle.requestPermission(opts); } catch (_) {}
        }
        if (perm === 'granted') {
          const file = await handle.getFile();
          _handleSelectedFile(file);
          return;
        }
      }
    } catch (e) { console.warn('[STEP] recent open failed:', e); }
  }
  toast('Re-pick the file', 'Browser security needs a fresh pick for this file', 'info', 4000);
  document.getElementById('file-input')?.click();
}

// ── Preferences (settings persistence) ──────────────────────────────────
const _Prefs = (() => {
  const KEY = 'stepopt-prefs';
  const DEFAULTS = {
    welcomeOnBoot: true,
    autoRestoreSession: true,
    autoFitOnLoad: true,
    confirmDestructive: true,
    showFps: true,
  };
  function load() {
    try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}')); }
    catch (_) { return { ...DEFAULTS }; }
  }
  function save(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (_) {} }
  let cur = load();
  return {
    get(k) { return cur[k]; },
    set(k, v) { cur[k] = v; save(cur); },
    all() { return { ...cur }; },
    reset() { cur = { ...DEFAULTS }; save(cur); },
  };
})();

function _applyShowFps(show) {
  const el = document.getElementById('fps');
  const pill = el?.parentElement;
  if (pill) pill.style.display = show ? '' : 'none';
}

// ── Settings modal ───────────────────────────────────────────────────────
// Toolbar gear opens this. Mirrors the existing display/perf controls into
// one place + adds new behavior toggles persisted via _Prefs. Mirrored
// controls write back to the original element with a dispatched change so
// existing handlers keep working.
const _Settings = (() => {
  let inited = false;
  function _section(title, html) {
    return `<div style="margin-bottom:18px">
      <div style="font-size:var(--fs-sm);font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--tx3);margin-bottom:6px">${title}</div>
      ${html}
    </div>`;
  }
  function _toggleRow(id, label, checked, help) {
    return `<div class="toggle">
      <span>${label}${help ? `<span style="display:block;color:var(--tx3);font-size:var(--fs-sm);font-weight:400;margin-top:2px;white-space:normal;line-height:1.4">${help}</span>` : ''}</span>
      <label><input type="checkbox" id="${id}" ${checked ? 'checked' : ''}><span class="switch"></span></label>
    </div>`;
  }
  function _selectRow(id, label, options, current) {
    const opts = options.map(([v, l]) => `<option value="${v}"${v === current ? ' selected' : ''}>${l}</option>`).join('');
    return `<div class="toggle">
      <span>${label}</span>
      <select id="${id}" class="mac-sel" style="width:auto;min-width:160px;flex-shrink:0;font-size:var(--fs-md);padding:5px 24px 5px 10px">${opts}</select>
    </div>`;
  }
  function _build() {
    const body = document.getElementById('settings-body');
    if (!body) return;
    const p = _Prefs.all();
    const bgVal = document.getElementById('bg-mode')?.value || 'dark';
    const perfVal = document.getElementById('perf-mode')?.value || 'auto';
    const rot = !!document.getElementById('toggle-rotate')?.checked;
    const hilite = !!document.getElementById('toggle-highlight')?.checked;
    const inst = !!document.getElementById('toggle-instance')?.checked;
    const shareMat = !!document.getElementById('toggle-share-mat')?.checked;

    body.innerHTML =
      _section('Display',
        _selectRow('set-bg', 'Background', [
          ['dark','Dark'], ['grad','Studio gradient'], ['solid','Solid black'], ['white','White'],
        ], bgVal) +
        _toggleRow('set-rot', 'Auto-rotate camera', rot) +
        _toggleRow('set-hilite', 'Highlight small parts', hilite) +
        _toggleRow('set-show-fps', 'Show FPS counter', p.showFps)
      ) +
      _section('Performance',
        _selectRow('set-perf', 'Quality', [
          ['auto','Auto (adaptive)'], ['high','High'], ['low','Low (heavy scenes)'],
        ], perfVal) +
        _toggleRow('set-inst', 'Auto-instance duplicates', inst) +
        _toggleRow('set-sharemat', 'Share materials by color', shareMat)
      ) +
      _section('Behavior',
        _toggleRow('set-welcome', 'Welcome screen on boot', p.welcomeOnBoot) +
        _toggleRow('set-restore', 'Restore last session', p.autoRestoreSession, 'Show a Resume button for your last opened file.') +
        _toggleRow('set-autofit', 'Auto-fit on load', p.autoFitOnLoad) +
        _toggleRow('set-confirm', 'Confirm destructive actions', p.confirmDestructive, 'Ask before deletes and other irreversible ops.')
      ) +
      _section('Storage', `
        <div style="display:flex;gap:8px;flex-wrap:wrap;padding:8px 0">
          <button class="btn" id="set-clear-recents" style="width:auto;padding:7px 14px">Clear recent files</button>
          <button class="btn" id="set-clear-handles" style="width:auto;padding:7px 14px">Clear file handles</button>
        </div>
      `);

    const mirror = (newId, oldId, prop) => {
      const el = document.getElementById(newId);
      const target = document.getElementById(oldId);
      if (!el || !target) return;
      el.addEventListener('change', () => {
        target[prop] = el[prop];
        target.dispatchEvent(new Event('change', { bubbles: true }));
      });
    };
    mirror('set-bg', 'bg-mode', 'value');
    mirror('set-perf', 'perf-mode', 'value');
    mirror('set-rot', 'toggle-rotate', 'checked');
    mirror('set-hilite', 'toggle-highlight', 'checked');
    mirror('set-inst', 'toggle-instance', 'checked');
    mirror('set-sharemat', 'toggle-share-mat', 'checked');

    [
      ['set-welcome', 'welcomeOnBoot'],
      ['set-restore', 'autoRestoreSession'],
      ['set-autofit', 'autoFitOnLoad'],
      ['set-confirm', 'confirmDestructive'],
      ['set-show-fps', 'showFps'],
    ].forEach(([id, key]) => {
      document.getElementById(id)?.addEventListener('change', e => {
        _Prefs.set(key, e.target.checked);
        if (key === 'showFps') _applyShowFps(e.target.checked);
      });
    });

    document.getElementById('set-clear-recents')?.addEventListener('click', () => {
      try { localStorage.removeItem('stepopt-recents'); } catch (_) {}
      toast('Recents cleared', '', 'success');
    });
    document.getElementById('set-clear-handles')?.addEventListener('click', async () => {
      try {
        const db = await _idbOpen();
        await new Promise((res, rej) => {
          const tx = db.transaction(_IDB_STORE, 'readwrite');
          tx.objectStore(_IDB_STORE).clear();
          tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
        });
        toast('File handles cleared', '', 'success');
      } catch (e) { toast('Clear failed', e?.message || String(e), 'error'); }
    });
  }
  function _wire() {
    if (inited) return;
    inited = true;
    const bg = document.getElementById('settings-modal');
    if (!bg) return;
    document.getElementById('settings-close')?.addEventListener('click', hide);
    document.getElementById('settings-done')?.addEventListener('click', hide);
    bg.addEventListener('click', e => { if (e.target === bg) hide(); });
    document.addEventListener('keydown', e => {
      if (!bg.classList.contains('show')) return;
      if (e.key === 'Escape') { e.preventDefault(); hide(); }
    });
    document.getElementById('settings-reset')?.addEventListener('click', () => {
      _Prefs.reset(); _build(); toast('Settings reset', 'Defaults restored', 'success');
    });
  }
  function show() { _wire(); _build(); document.getElementById('settings-modal')?.classList.add('show'); }
  function hide() { document.getElementById('settings-modal')?.classList.remove('show'); }
  return { show, hide };
})();

const _Welcome = (() => {
  const REC_KEY = 'stepopt-recents';
  const REC_MAX = 8;
  let inited = false;

  function _load() {
    try { return JSON.parse(localStorage.getItem(REC_KEY) || '[]'); }
    catch (_) { return []; }
  }
  function _save(list) {
    try { localStorage.setItem(REC_KEY, JSON.stringify(list.slice(0, REC_MAX))); }
    catch (_) {}
  }
  const _fmtBytes = n => Number.isFinite(n) ? fmtBytes(n) : '';
  function _fmtAge(ts) {
    const d = Math.max(0, Date.now() - ts);
    const min = 60 * 1000, hr = 60 * min, day = 24 * hr;
    if (d < min) return 'just now';
    if (d < hr) return Math.floor(d / min) + 'm ago';
    if (d < day) return Math.floor(d / hr) + 'h ago';
    if (d < 7 * day) return Math.floor(d / day) + 'd ago';
    return new Date(ts).toLocaleDateString();
  }

  async function _renderRecents() {
    const box = document.getElementById('welcome-recents');
    if (!box) return;
    const list = _load();
    if (!list.length) {
      box.innerHTML = `<div style="padding:10px 12px;background:var(--bg2);border-radius:var(--r-md);color:var(--tx3);font-size:var(--fs-md);text-align:center">No recent files yet</div>`;
      _renderResume(null);
      return;
    }
    // Resume CTA — top recent if its handle is still stored AND the pref is on.
    if (typeof _Prefs !== 'undefined' && _Prefs.get('autoRestoreSession')) {
      try {
        const top = list[0];
        const handle = await _idbGet(_recKey(top.name, top.size));
        _renderResume(handle ? top : null);
      } catch (_) { _renderResume(null); }
    } else {
      _renderResume(null);
    }
    box.innerHTML = list.map((r, i) => {
      const safeName = r.name.replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
      const thumbInner = r.thumb
        ? `<img src="${r.thumb}" alt="" draggable="false">`
        : `<i data-lucide="file"></i>`;
      // <div> wrapper (not <button>) because the row hosts a nested <button>
      // for the hover-revealed × delete affordance, and HTML disallows nested
      // buttons. Click bubbling on the row still triggers the open handler.
      return `
      <div class="welcome-recent" data-idx="${i}" title="${safeName}" tabindex="0">
        <div class="wr-thumb">${thumbInner}</div>
        <div class="wr-meta">
          <div class="wr-name">${safeName}</div>
          <div class="wr-sub">${_fmtBytes(r.size)} · ${_fmtAge(r.ts)}</div>
        </div>
        <button class="wr-del" data-act="delete" title="Remove from recent files"><i data-lucide="x"></i></button>
      </div>`;
    }).join('');
    box.querySelectorAll('.welcome-recent').forEach(el => {
      el.addEventListener('click', (e) => {
        // Skip when the × badge was the actual target — that's a delete,
        // not an open. Without this guard the row's open-on-click would
        // fire alongside the delete and load the file we just removed.
        if (e.target.closest('[data-act="delete"]')) return;
        const idx = parseInt(el.dataset.idx, 10);
        const rec = _load()[idx];
        if (!rec) return;
        _openRecentByKey(_recKey(rec.name, rec.size));
      });
    });
    // Per-row delete: drop the entry from the persisted list, drop the
    // matching IDB file handle, re-render. The file on disk is never
    // touched — this only forgets the shortcut.
    box.querySelectorAll('.wr-del').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const row = btn.closest('.welcome-recent');
        const idx = parseInt(row?.dataset.idx, 10);
        const cur = _load();
        const rec = cur[idx];
        if (!rec) return;
        cur.splice(idx, 1);
        _save(cur);
        try { if (typeof _idbDelete === 'function') await _idbDelete(_recKey(rec.name, rec.size)); } catch (_) {}
        _renderRecents();
      });
    });
    // Toggle the Clear-all chip based on whether the list has anything.
    const clearBtn = document.getElementById('welcome-recents-clear');
    if (clearBtn) clearBtn.style.display = list.length ? 'inline-flex' : 'none';
    try { _lucide(); } catch (_) {}
  }

  function _renderResume(rec) {
    const slot = document.getElementById('welcome-resume');
    if (!slot) return;
    if (!rec) { slot.innerHTML = ''; return; }
    const safeName = rec.name.replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
    // Hero card. The captured viewport thumb (when present) becomes a
    // full-bleed background with a darkening gradient overlay so the
    // accent label + filename stay legible. C4D / IDE "continue working
    // on…" pattern. Style for `style="background-image..."` is inline
    // because it's data-driven from the persisted thumb data URL.
    const bgStyle = rec.thumb
      ? `style="background-image:url('${rec.thumb}')"`
      : '';
    slot.innerHTML = `
      <button id="welcome-resume-btn" class="welcome-resume" ${bgStyle}>
        <span class="wr-play"><i data-lucide="play"></i></span>
        <span class="wr-info">
          <span class="wr-label">Resume project</span>
          <span class="wr-name">${safeName}</span>
          <span class="wr-sub">Pick up where you left off</span>
        </span>
        <span class="wr-age">${_fmtAge(rec.ts)}</span>
      </button>`;
    document.getElementById('welcome-resume-btn')?.addEventListener('click', () => {
      _openRecentByKey(_recKey(rec.name, rec.size));
    });
    try { _lucide(); } catch (_) {}
  }

  function pushRecent(file) {
    if (!file || !file.name) return;
    const list = _load().filter(r => r.name !== file.name);
    list.unshift({ name: file.name, size: file.size || 0, ts: Date.now() });
    _save(list);
  }

  function _wire() {
    if (inited) return;
    inited = true;
    const bg = document.getElementById('welcome-modal');
    const drop = document.getElementById('welcome-drop');
    const pick = document.getElementById('welcome-pick');
    const close = document.getElementById('welcome-close');
    const input = document.getElementById('file-input');
    if (!bg || !drop || !pick || !input) return;

    pick.addEventListener('click', () => _openWithPicker());
    drop.addEventListener('click', e => {
      // Don't let the browse button bubble into the dropzone click.
      if (e.target.closest('#welcome-pick')) return;
      _openWithPicker();
    });
    close?.addEventListener('click', hide);
    // Clear-all chip — confirms before wiping. Walks the list once to
    // also drop each entry's IDB file handle so the next render starts
    // from a truly empty state instead of leaving orphaned handles around.
    document.getElementById('welcome-recents-clear')?.addEventListener('click', async () => {
      const list = _load();
      if (!list.length) return;
      const ok = (typeof appConfirm === 'function')
        ? await appConfirm(`Remove all ${list.length} entries from the recent files list? The files themselves stay on disk.`, {
            title: 'Clear recent files?',
            okLabel: 'Clear',
            cancelLabel: 'Keep',
            danger: true,
          })
        : confirm(`Remove all ${list.length} recent file entries?`);
      if (!ok) return;
      for (const r of list) {
        try { if (typeof _idbDelete === 'function') await _idbDelete(_recKey(r.name, r.size)); } catch (_) {}
      }
      _save([]);
      _renderRecents();
    });
    bg.addEventListener('click', e => { if (e.target === bg) hide(); });
    document.addEventListener('keydown', e => {
      if (!bg.classList.contains('show')) return;
      if (e.key === 'Escape') { e.preventDefault(); hide(); }
    });

    drop.addEventListener('dragover', e => {
      e.preventDefault();
      drop.style.borderColor = 'var(--ac)';
      drop.style.background = 'var(--bg3)';
    });
    drop.addEventListener('dragleave', () => {
      drop.style.borderColor = 'var(--bd2)';
      drop.style.background = 'var(--bg2)';
    });
    drop.addEventListener('drop', e => {
      e.preventDefault();
      drop.style.borderColor = 'var(--bd2)';
      drop.style.background = 'var(--bg2)';
      const f = e.dataTransfer?.files?.[0];
      if (f) _handleSelectedFile(f);
    });

    // Loader pane buttons (Cancel / Copy log) — forward to the existing
    // standalone-loader handlers so we keep one source of truth for the logic.
    document.getElementById('wl-cancel-btn')?.addEventListener('click', () => {
      document.getElementById('loader-cancel-btn')?.click();
    });
    document.getElementById('wl-copy-btn')?.addEventListener('click', () => {
      document.getElementById('loader-copy-btn')?.click();
    });
  }

  function _setMode(mode) {
    const pick = document.getElementById('welcome-pick-pane');
    const load = document.getElementById('welcome-load-pane');
    const title = document.getElementById('welcome-title');
    const closeBtn = document.getElementById('welcome-close');
    if (mode === 'loading') {
      if (pick) pick.style.display = 'none';
      if (load) load.style.display = 'block';
      if (title) title.textContent = 'Opening file…';
      if (closeBtn) closeBtn.style.display = 'none';
    } else {
      if (pick) pick.style.display = 'block';
      if (load) load.style.display = 'none';
      if (title) title.textContent = 'Open a model';
      if (closeBtn) closeBtn.style.display = '';
    }
  }
  function enterLoading() { _setMode('loading'); }
  function enterPick() { _setMode('pick'); }

  function show() {
    _wire();
    const bg = document.getElementById('welcome-modal');
    if (!bg) return;
    _renderRecents();
    _setMode('pick');
    bg.classList.add('show');
  }
  function hide() {
    const bg = document.getElementById('welcome-modal');
    if (bg) bg.classList.remove('show');
    _setMode('pick'); // reset so next show starts on the picker
  }
  function toggle() {
    const bg = document.getElementById('welcome-modal');
    if (!bg) return;
    if (bg.classList.contains('show')) hide(); else show();
  }
  return { show, hide, toggle, pushRecent, enterLoading, enterPick };
})();

// ── Action registry, command palette, shortcuts overlay ────────────────
const _Actions = (() => {
  const _click = id => () => document.getElementById(id)?.click();
  const list = [
    { id:'open',         group:'File',       label:'Open file…',                 kbd:'Ctrl+O', run: () => _openWithPicker() },
    { id:'export',       group:'File',       label:'Export model…',              run: _click('btn-export') },
    { id:'savescene',    group:'File',       label:'Save scene…',                run: _click('btn-save-scene') },
    { id:'fit',          group:'View',       label:'Fit to view',                kbd:'F', run: _click('btn-fit') },
    { id:'reset',        group:'View',       label:'Reset camera',               run: _click('btn-reset') },
    { id:'frameSel',     group:'View',       label:'Frame selection',            run: () => { try { frameSelected(); } catch (_) {} } },
    { id:'solid',        group:'View',       label:'Solid view',                 kbd:'1', run: () => { try { setViewMode('solid'); } catch (_) {} } },
    { id:'wire',         group:'View',       label:'Wireframe view',             kbd:'2', run: () => { try { setViewMode('wire'); } catch (_) {} } },
    { id:'edges',        group:'View',       label:'Edges view',                 kbd:'3', run: () => { try { setViewMode('edges'); } catch (_) {} } },
    { id:'gzMove',       group:'View',       label:'Translate gizmo (Shift to snap 10u)', kbd:'E', run: () => { try { setGizmoMode('translate'); } catch (_) {} } },
    { id:'gzRotate',     group:'View',       label:'Rotate gizmo (Shift to snap 15°)',    kbd:'R', run: () => { try { setGizmoMode('rotate'); } catch (_) {} } },
    { id:'gzScale',      group:'View',       label:'Scale gizmo (Shift to snap 0.1)',     kbd:'T', run: () => { try { setGizmoMode('scale'); } catch (_) {} } },
    { id:'gzOff',        group:'View',       label:'Hide gizmo',                          kbd:'Q', run: () => { try { setGizmoMode('off'); } catch (_) {} } },
    { id:'tgGrid',       group:'View',       label:'Toggle grid',                run: _click('tg-grid') },
    { id:'tgAxes',       group:'View',       label:'Toggle axes',                run: _click('tg-axes') },
    { id:'tgBbox',       group:'View',       label:'Toggle bounding boxes',      run: _click('tg-bbox') },
    { id:'selAll',       group:'Selection',  label:'Select all',                 kbd:'Ctrl+A', run: _click('sel-all') },
    { id:'selInvert',    group:'Selection',  label:'Invert selection',           run: _click('sel-invert') },
    { id:'selClear',     group:'Selection',  label:'Clear selection',            kbd:'Esc', run: _click('sel-clear') },
    { id:'isolate',      group:'Selection',  label:'Isolate selected',           kbd:'S', run: () => { try { isolateSelected(); } catch (_) {} } },
    { id:'showAll',      group:'Selection',  label:'Show all parts',             run: () => { try { showAllParts(); } catch (_) {} } },
    { id:'hideUnsel',    group:'Selection',  label:'Hide unselected',            run: () => { try { hideUnselected(); } catch (_) {} } },
    { id:'reveal',       group:'Selection',  label:'Reveal selected in tree',    kbd:'Shift+S', run: () => { try { revealSelectedInTree(); } catch (_) {} } },
    { id:'undo',         group:'Edit',       label:'Undo',                       kbd:'Ctrl+Z', run: () => { try { undo(); } catch (_) {} } },
    { id:'redo',         group:'Edit',       label:'Redo',                       kbd:'Ctrl+Y', run: () => { try { redo(); } catch (_) {} } },
    { id:'delete',       group:'Edit',       label:'Delete selected',            kbd:'Del', run: () => { if (state.selected.size) deleteParts([...state.selected], 'Deleted via palette'); } },
    { id:'recenter',     group:'Edit',       label:'Recenter model',             run: _click('btn-recenter') },
    { id:'group',        group:'Edit',       label:'Group selection',            run: _click('btn-group-sel') },
    { id:'merge',        group:'Edit',       label:'Merge selection',            run: _click('btn-merge-sel') },
    { id:'smartFit',     group:'Edit',       label:'Smart-fit selection',        run: _click('btn-bbox-selected') },
    { id:'smartFitAll',  group:'Edit',       label:'Smart-fit all parts',        run: _click('btn-bbox-all') },
    { id:'flatten',      group:'Edit',       label:'Advanced flatten…',          run: _click('tree-flatten') },
    { id:'settings',     group:'App',        label:'Open settings',              kbd:'Ctrl+,', run: () => _Settings.show() },
    { id:'shortcuts',    group:'App',        label:'Keyboard shortcuts',         kbd:'?', run: () => _Shortcuts.show() },
    { id:'palette',      group:'App',        label:'Command palette',            kbd:'Ctrl+K', run: () => _CmdK.show() },
    { id:'console',      group:'App',        label:'Toggle log console',         kbd:'`', run: _click('sb-console-btn') },
    { id:'welcome',      group:'App',        label:'Open welcome screen',        run: () => _Welcome.show() },
  ];
  return { list };
})();

const _CmdK = (() => {
  let inited = false;
  let activeIdx = 0;
  let visibleItems = [];

  function _score(query, label) {
    const q = query.toLowerCase().trim();
    const l = label.toLowerCase();
    if (!q) return 1;
    if (l.startsWith(q)) return 100;
    if (l.includes(q)) return 50;
    let i = 0;
    for (const ch of l) { if (ch === q[i]) i++; if (i === q.length) return 25 - (l.length - q.length); }
    return 0;
  }
  function _render(query) {
    const list = document.getElementById('cmdk-list');
    if (!list) return;
    const items = _Actions.list
      .map(a => ({ a, s: _score(query, a.label) + _score(query, a.group) * 0.3 }))
      .filter(x => x.s > 0)
      .sort((x, y) => y.s - x.s)
      .slice(0, 24)
      .map(x => x.a);
    visibleItems = items;
    if (activeIdx >= items.length) activeIdx = 0;
    list.innerHTML = items.length === 0
      ? `<div style="padding:18px;text-align:center;color:var(--tx3);font-size:var(--fs-md)">No matches</div>`
      : items.map((a, i) => `
        <div class="cmdk-item${i === activeIdx ? ' active' : ''}" data-idx="${i}" style="display:flex;align-items:center;gap:12px;padding:9px 12px;border-radius:var(--r-md);cursor:pointer;font-size:var(--fs-md);background:${i === activeIdx ? 'var(--ac-soft)' : 'transparent'}">
          <span style="color:var(--tx3);font-size:var(--fs-sm);min-width:54px">${a.group}</span>
          <span style="flex:1;color:var(--tx)">${a.label}</span>
          ${a.kbd ? `<span style="color:var(--tx3);font-family:ui-monospace,monospace;font-size:var(--fs-sm);background:var(--bg2);border:1px solid var(--bd);border-radius:var(--r-xs);padding:2px 7px">${a.kbd}</span>` : ''}
        </div>
      `).join('');
    list.querySelectorAll('.cmdk-item').forEach(el => {
      el.addEventListener('mouseenter', () => {
        activeIdx = parseInt(el.dataset.idx, 10) || 0;
        list.querySelectorAll('.cmdk-item').forEach((e, i) => {
          e.style.background = i === activeIdx ? 'var(--ac-soft)' : 'transparent';
        });
      });
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.idx, 10);
        const it = visibleItems[idx];
        if (it) { hide(); try { it.run(); } catch (e) { console.warn('[cmdk] run failed:', e); } }
      });
    });
  }
  function _wire() {
    if (inited) return;
    inited = true;
    const bg = document.getElementById('cmdk-modal');
    const input = document.getElementById('cmdk-input');
    if (!bg || !input) return;
    bg.addEventListener('click', e => { if (e.target === bg) hide(); });
    input.addEventListener('input', () => { activeIdx = 0; _render(input.value); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(visibleItems.length - 1, activeIdx + 1); _render(input.value); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = Math.max(0, activeIdx - 1); _render(input.value); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const it = visibleItems[activeIdx];
        if (it) { hide(); try { it.run(); } catch (err) { console.warn('[cmdk] run failed:', err); } }
      }
      else if (e.key === 'Escape') { e.preventDefault(); hide(); }
    });
  }
  function show() {
    _wire();
    const bg = document.getElementById('cmdk-modal');
    const input = document.getElementById('cmdk-input');
    if (!bg || !input) return;
    input.value = ''; activeIdx = 0; _render('');
    bg.classList.add('show');
    setTimeout(() => input.focus(), 30);
  }
  function hide() { document.getElementById('cmdk-modal')?.classList.remove('show'); }
  return { show, hide };
})();

const _Shortcuts = (() => {
  let inited = false;
  function _render() {
    const body = document.getElementById('shortcuts-body');
    if (!body) return;
    const groups = {};
    for (const a of _Actions.list) {
      if (!a.kbd) continue;
      (groups[a.group] = groups[a.group] || []).push(a);
    }
    body.innerHTML = Object.entries(groups).map(([g, items]) => `
      <div style="margin-bottom:14px">
        <div style="font-size:var(--fs-sm);font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--tx3);margin-bottom:6px">${g}</div>
        ${items.map(a => `<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:var(--fs-md)">
          <span style="color:var(--tx)">${a.label}</span>
          <span style="color:var(--tx2);font-family:ui-monospace,monospace;background:var(--bg2);border:1px solid var(--bd);border-radius:var(--r-xs);padding:2px 8px;font-size:var(--fs-sm)">${a.kbd}</span>
        </div>`).join('')}
      </div>
    `).join('');
  }
  function _wire() {
    if (inited) return;
    inited = true;
    const bg = document.getElementById('shortcuts-modal');
    if (!bg) return;
    document.getElementById('shortcuts-close')?.addEventListener('click', hide);
    bg.addEventListener('click', e => { if (e.target === bg) hide(); });
    document.addEventListener('keydown', e => {
      if (!bg.classList.contains('show')) return;
      if (e.key === 'Escape') { e.preventDefault(); hide(); }
    });
  }
  function show() { _wire(); _render(); document.getElementById('shortcuts-modal')?.classList.add('show'); }
  function hide() { document.getElementById('shortcuts-modal')?.classList.remove('show'); }
  return { show, hide };
})();

// Global key bindings: Cmd/Ctrl+K · Cmd/Ctrl+, · ?
window.addEventListener('keydown', e => {
  const t = e.target;
  const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault(); _CmdK.show(); return;
  }
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key === ',') {
    e.preventDefault(); _Settings.show(); return;
  }
  if (!inField && (e.key === '?' || (e.key === '/' && e.shiftKey))) {
    e.preventDefault(); _Shortcuts.show();
  }
}, true);

(function wireEarly() {
  const btn = $('btn-open'), input = $('file-input');
  btn?.addEventListener('click', () => {
    if (state.parts.length === 0) _Welcome.show();
    else _openWithPicker();
  });
  $('btn-settings')?.addEventListener('click', () => _Settings.show());
  try { _applyShowFps(_Prefs.get('showFps') !== false); } catch(_){}
  (function wireBrandMenu(){
    const btn = $('btn-brand'), menu = $('brand-menu');
    if (!btn || !menu) return;
    const close = () => { menu.classList.remove('show'); btn.setAttribute('aria-expanded','false'); menu.setAttribute('aria-hidden','true'); };
    const open  = () => { menu.classList.add('show');    btn.setAttribute('aria-expanded','true');  menu.setAttribute('aria-hidden','false'); };
    btn.addEventListener('click', e => {
      e.stopPropagation();
      menu.classList.contains('show') ? close() : open();
    });
    document.addEventListener('click', e => {
      if (!menu.classList.contains('show')) return;
      if (menu.contains(e.target) || btn.contains(e.target)) return;
      close();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && menu.classList.contains('show')) { close(); btn.focus(); }
    });
    $('brand-menu-settings')?.addEventListener('click', () => { close(); _Settings.show(); });
    $('brand-menu-shortcuts')?.addEventListener('click', () => { close(); try { _CmdK.show(); } catch(_){} });
  })();
  input?.addEventListener('change', e => {
    const f = e.target.files[0]; e.target.value = '';
    _handleSelectedFile(f);
  });
  const vp = $('viewport'), dz = $('dropzone');
  vp?.addEventListener('dragenter', e => { e.preventDefault(); dz?.classList.add('drag-over'); });
  vp?.addEventListener('dragover',  e => { e.preventDefault(); dz?.classList.add('drag-over'); });
  vp?.addEventListener('dragleave', e => { e.preventDefault(); dz?.classList.remove('drag-over'); });
  vp?.addEventListener('drop', e => {
    e.preventDefault(); dz?.classList.remove('drag-over');
    _handleSelectedFile(e.dataTransfer?.files?.[0]);
  });
  $('loader-cancel-btn')?.addEventListener('click', () => {
    if (_activeParse) {
      _activeParse.cancelled = true;
      try { _stepWorker?.terminate(); } catch(_){}
      _stepWorker = null;
      // Revoke the blob URL too — the worker holds the only reference and
      // we're killing the worker, so the URL is now garbage.
      try { if (_stepWorkerUrl) URL.revokeObjectURL(_stepWorkerUrl); } catch(_){}
      _stepWorkerUrl = null;
      logProgress('cancelled by user', 'warn');
      setTimeout(() => setLoader(false), 400);
    } else {
      // No active parse — just dismiss the dialog (e.g. after a failure)
      setLoader(false);
    }
  });
  $('loader-copy-btn')?.addEventListener('click', async () => {
    const box = document.getElementById('loader-log');
    if (!box) return;
    const lines = [];
    for (const child of box.children) {
      const t = child.querySelector('.log-time')?.textContent || '';
      const m = child.querySelector('.log-msg')?.textContent || '';
      lines.push((t + ' ' + m).trim());
    }
    const text = lines.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied', `${lines.length} log lines copied to clipboard`, 'success');
    } catch (e) {
      // Clipboard API may be blocked on http://; fall back to selecting + execCommand
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toast('Copied', `${lines.length} log lines (fallback)`, 'success'); }
      catch (_) { toast('Copy failed', 'Browser blocked clipboard access', 'error'); }
      ta.remove();
    }
  });
  console.log('[STEP] Early file picker wired');
})();

async function initRenderer() {
  const canvas = $('canvas');
  let name = 'WebGL2';
  // Allow forcing WebGL2 via ?webgl=1 URL param or localStorage flag.
  // WebGPU's clipping-plane support on auto-converted standard materials is
  // unreliable in three.js r0.172 — section cut may not appear in WebGPU mode
  // even after material rebuild. WebGL2 is functionally identical for this app
  // (no compute shaders, no TSL) so the fallback is a one-line escape hatch.
  let forceWebGL = !navigator.gpu;
  try {
    if (new URLSearchParams(location.search).get('webgl') === '1') forceWebGL = true;
    if (localStorage.getItem('stepopt-force-webgl') === '1') forceWebGL = true;
  } catch (_) {}
  try {
    renderer = new THREE.WebGPURenderer({ canvas, antialias: true, alpha: false, forceWebGL });
    await renderer.init();
    const isGPU = !forceWebGL && renderer.backend && (renderer.backend.isWebGPUBackend || renderer.backend.constructor?.name?.includes('WebGPU'));
    name = isGPU ? 'WebGPU' : 'WebGL2';
  } catch (e) {
    console.warn('[STEP] renderer init failed, retry forceWebGL:', e.message);
    renderer = new THREE.WebGPURenderer({ canvas, antialias: true, alpha: false, forceWebGL: true });
    await renderer.init();
    name = 'WebGL2';
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  renderer.setClearColor(0x222831, 1);
  if (renderer.outputColorSpace !== undefined) renderer.outputColorSpace = THREE.SRGBColorSpace;
  if (renderer.toneMapping !== undefined) {
    renderer.toneMapping = THREE.NeutralToneMapping ?? THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
  }
  // Enable local clipping (per-material Plane lists). Required for the
  // Section/Clip panel; harmless when no planes are set.
  try { if ('localClippingEnabled' in renderer) renderer.localClippingEnabled = true; } catch (_) {}
  $('renderer-name').textContent = name;
  // Both WebGPU and WebGL2 are first-class user choices via the top-bar
  // dropdown — neither is a fallback/warning state.
  $('stat-renderer').querySelector('.dot').classList.remove('warn');
  $('stat-renderer').querySelector('.dot').classList.remove('off');

  // Top-bar renderer switcher. The custom-select widget wraps this <select>
  // during wireUI() (which runs before initRenderer), so the trigger button
  // already exists. We have to sync BOTH the underlying select value AND the
  // trigger button's label — setting sel.value alone doesn't refresh the
  // visible label because the widget only re-syncs on user-driven changes.
  try {
    const sel = $('renderer-select');
    if (sel) {
      const want = (name === 'WebGPU') ? 'webgpu' : 'webgl2';
      sel.value = want;
      const trigger = $(sel.id + '__btn');
      const opt = sel.options[sel.selectedIndex];
      if (trigger && opt) trigger.textContent = opt.textContent.trim();
      sel.addEventListener('change', () => {
        const wantWebGL = sel.value === 'webgl2';
        try {
          if (wantWebGL) localStorage.setItem('stepopt-force-webgl', '1');
          else           localStorage.removeItem('stepopt-force-webgl');
        } catch (_) {}
        const url = new URL(location.href);
        if (wantWebGL) url.searchParams.set('webgl', '1');
        else           url.searchParams.delete('webgl');
        location.href = url.toString();
      });
    }
  } catch (_) {}

  // Hook WebGPU device-lost. Without this, a GPU driver hiccup or OS-level
  // GPU reset (e.g. screen lock + unlock, switching between integrated and
  // discrete GPU on a laptop, long suspended tab) silently kills the device
  // and every subsequent renderer.render() throws — the viewport just
  // freezes with no indication. The lost.then() resolves exactly once when
  // the device dies; we surface it explicitly.
  try {
    const dev = renderer?.backend?.device;
    if (dev && dev.lost && typeof dev.lost.then === 'function') {
      dev.lost.then((info) => {
        const reason = info?.reason || 'unknown';
        const msg = info?.message || '(no message)';
        console.warn('[GPU] device lost:', reason, msg);
        try { toast('GPU lost', reason + ' — reload the page to recover', 'error', 10000); } catch (_) {}
      });
    }
  } catch (e) { console.warn('[GPU] could not attach lost handler:', e); }
}

function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x222831);
  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100000);
  camera.position.set(60, 50, 80); camera.up.set(0, 0, 1);
  controls = new OrbitControls(camera, $('canvas'));
  // No damping — pan/orbit/zoom track the mouse 1:1 and stop the instant the
  // user lets go (no inertial drift, no ease-out tail).
  controls.enableDamping = false; controls.screenSpacePanning = true;
  // Any user interaction with the camera invalidates the framebuffer. Without
  // this hook the render-on-demand loop would freeze the viewport.
  controls.addEventListener('start', () => requestRender());
  controls.addEventListener('change', () => requestRender());
  controls.addEventListener('end', () => requestRender());
  // ── Lights ────────────────────────────────────────────────────────────
  // Final (target) intensities. Captured here so the boot fade-in below can
  // ramp from 0 to these values for a "lights turning on" reveal on first
  // load. The same target values are used for any subsequent re-init (model
  // reload, renderer swap), where the ramp is short enough to feel instant.
  const _hemiTarget = 0.55, _dirTarget = 1.2, _fillTarget = 0.4;
  const hemi = new THREE.HemisphereLight(0xffffff, 0x303642, 0); scene.add(hemi);
  const dir  = new THREE.DirectionalLight(0xffffff, 0); dir.position.set(80, 60, 100); scene.add(dir);
  const fill = new THREE.DirectionalLight(0xb0c4ff, 0); fill.position.set(-80, -40, 60); scene.add(fill);
  state._lights = { hemi, dir, fill, hemiTarget: _hemiTarget, dirTarget: _dirTarget, fillTarget: _fillTarget };
  // Boot ramp: smoothstep over ~900ms from 0 to target. Re-renders on each
  // tick because the scene is render-on-demand; without requestRender the
  // intermediate frames wouldn't paint and the user would just see a hard
  // pop at the end of the ramp.
  (function _rampLights() {
    const start = performance.now();
    const dur = 900;
    function tick() {
      const t = Math.min(1, (performance.now() - start) / dur);
      // smoothstep — ease in/out
      const k = t * t * (3 - 2 * t);
      hemi.intensity = _hemiTarget * k;
      dir.intensity  = _dirTarget  * k;
      fill.intensity = _fillTarget * k;
      requestRender?.();
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  })();
  gridHelper = new THREE.GridHelper(200, 40, 0x3a4358, 0x232938);
  gridHelper.rotation.x = Math.PI / 2;
  gridHelper.material.transparent = true;
  gridHelper.material.opacity = 0.45;
  scene.add(gridHelper);
  axesHelper = new THREE.AxesHelper(8); scene.add(axesHelper);
  state.partsRoot = new THREE.Group(); state.partsRoot.name = '_partsRoot'; scene.add(state.partsRoot);
  // Mass scenes: partsRoot's local matrix doesn't change unless we rotate or
  // recenter, so opting out of per-frame auto-update saves a Mat4 propagation
  // through thousands of children. We call updateMatrixWorld() manually after
  // mutations.
  state.partsRoot.matrixAutoUpdate = false;
  state.bboxRoot = new THREE.Group(); state.bboxRoot.visible = false; scene.add(state.bboxRoot);
  state.bboxRoot.matrixAutoUpdate = false;
  raycaster = new THREE.Raycaster(); pointer = new THREE.Vector2();

  // Gizmo + a dedicated pivot we re-position to bbox center on each select
  state.gizmo = new TransformControls(camera, renderer.domElement);
  // 0.6 (was 0.9) — overall gizmo footprint shrunk so it doesn't dominate the
  // viewport, especially with smaller parts. Combined with the per-mesh
  // slimming pass below this gives a noticeably lighter visual.
  state.gizmo.size = 0.6;
  state.gizmo.setMode('translate');
  // Local space: handles align with the attached pivot's orientation.
  // The pivot's rotation is synced to the selected object's world rotation in
  // _attachGizmoToParts, so handles visually follow object rotation — the
  // standard behaviour in Blender / Cinema 4D.
  state.gizmo.space = 'local';
  // Industry-standard snap-while-shift, applied globally to whichever gizmo
  // mode is active. 10 units / 15° / 0.1 — same defaults as Maya/Blender/Max.
  // Snaps are armed/disarmed from the document-level Shift listeners in the
  // input setup block; we only configure the values here so the gizmo
  // reflects the latest settings even if it's recreated.
  state.gizmoSnap = { translate: 10, rotate: Math.PI / 12, scale: 0.1 };
  // Track transforms for undo: snapshot mesh world matrix on drag start, push undo on drag end
  state.gizmo.addEventListener('dragging-changed', e => {
    controls.enabled = !e.value;
    requestRender();
    // ── Group-pivot path: one snapshot of the group's world matrix on start,
    //    one 'groupTransform' undo entry on end. Children come along for the
    //    ride via normal parent-child propagation; we do NOT snapshot them
    //    individually (would push N redundant entries that all encode the
    //    same translation) and undo of 'groupTransform' restores groupRef's
    //    world matrix directly.
    if (state._pivotedGroup) {
      if (e.value) {
        state._pivotedGroup.updateWorldMatrix(true, false);
        state._gizmoBeforeGroupMat = state._pivotedGroup.matrixWorld.clone();
      } else {
        const before = state._gizmoBeforeGroupMat;
        state._gizmoBeforeGroupMat = null;
        if (before && state._pivotedGroup) {
          state._pivotedGroup.updateWorldMatrix(true, false);
          const after = state._pivotedGroup.matrixWorld.clone();
          if (!before.equals(after)) {
            pushUndo({
              type: 'groupTransform',
              groupId: state._pivotedGroupId,
              before: before.elements.slice(),
              after:  after.elements.slice(),
            });
            // Refresh per-part _exactWorld so the highlight rebuild on the
            // next applySelectionColors picks up the new world positions.
            for (const p of (state._pivotedParts || [])) {
              if (p && p.mesh) {
                p.mesh.updateWorldMatrix(true, false);
                p._exactWorld = p.mesh.matrixWorld.clone();
              }
            }
          }
        }
      }
      return;
    }
    // Multi-part-aware: snapshot all pivoted parts at drag start, push a
    // group-undo at drag end. Falls back to the single-part case naturally.
    const list = (state._pivotedParts && state._pivotedParts.length)
      ? state._pivotedParts
      : (state._pivotedPart ? [state._pivotedPart] : []);
    if (list.length === 0) return;
    if (e.value) {
      state._gizmoBeforeMats = list.map(p => {
        p.mesh.updateWorldMatrix(true, false);
        return { partId: p.partId, mat: p.mesh.matrixWorld.clone() };
      });
    } else {
      // Drag end: collect every part whose world matrix actually changed and
      // push them as ONE 'transformGroup' undo entry. Previously this loop
      // pushed N separate 'transform' entries — Ctrl+Z then unwound them one
      // mesh at a time, which felt broken when the user just dragged 50
      // parts in a single gesture. Treating the whole gesture as one undo
      // step matches Photoshop / Figma / Blender behaviour.
      const before = state._gizmoBeforeMats || [];
      const items = [];
      for (const snap of before) {
        const p = list.find(q => q.partId === snap.partId);
        if (!p || !p.mesh) continue;
        p.mesh.updateWorldMatrix(true, false);
        const after = p.mesh.matrixWorld.clone();
        if (!snap.mat.equals(after)) {
          items.push({
            partId: p.partId,
            before: snap.mat.elements.slice(),
            after:  after.elements.slice(),
          });
          // Refresh the exact-world snapshot used by merge / bbox-ify so the
          // user's gizmo move is visible to those bake operations. For
          // shear-affected (Cinema) parts this is still lossy, but it's the
          // best we can do once a TRS-based transform has been applied.
          p._exactWorld = after.clone();
        }
      }
      if (items.length > 0) {
        pushUndo({ type: 'transformGroup', items });
      }
      state._gizmoBeforeMats = null;
    }
  });
  // Live invalidation while the gizmo is being dragged.
  state.gizmo.addEventListener('change', () => requestRender());
  state.gizmo.addEventListener('objectChange', () => { requestRender(); _gizmoHud.update(); });
  // Gizmo HUD: capture pivot baseline on drag start, hide on drag end.
  state.gizmo.addEventListener('dragging-changed', e => {
    if (e.value) _gizmoHud.start(); else _gizmoHud.stop();
  });
  const gh = (typeof state.gizmo.getHelper === 'function') ? state.gizmo.getHelper() : state.gizmo;
  gh.visible = false;
  state.gizmoHelper = gh;
  scene.add(gh);

  // Strip the long grey axis-guide lines that TransformControls draws across
  // the world when an arrow is hovered/dragged. They live inside subgroups
  // named 'helper' inside each mode's gizmo subtree. Hard-pin their `visible`
  // getter to false so TransformControls' internal show/hide logic can't
  // bring them back. Done once after init — the helper structure is built
  // upfront and doesn't change on mode switch.
  gh.traverse(o => {
    if (o.name === 'helper') {
      Object.defineProperty(o, 'visible', {
        get: () => false,
        set: () => {},
        configurable: true,
      });
    }
    // Slim arrow tips and axis cylinders. TransformControls builds these as
    // Mesh children with CylinderGeometry oriented along local Y. Scaling
    // local X+Z down narrows the visual stem and arrowhead without
    // shortening the axis (which is what setSize already controls).
    // Also dial back plane handles (XY, YZ, XZ squares) — they're chunky
    // by default and obscure the part underneath.
    if (o.isMesh && o.geometry) {
      const n = o.name || '';
      const t = o.geometry.type || '';
      // Hide negative-direction arrow visuals. The TransformControls translate
      // gizmo defines each axis with three cylinder meshes — shaft at (0,0,0),
      // positive arrow tip at (+0.5, 0, 0)-equivalent, negative arrow tip at
      // (-0.5, 0, 0)-equivalent. We want to keep shaft + positive, hide
      // negative. The check is: any cylinder named X/Y/Z whose position
      // component along its axis is negative (and not zero) gets hidden.
      // Material check is OMITTED here — earlier "isVisible" gate was
      // skipping the negative arrows because their material had matVis=false
      // in this three.js version. The pickers (separate BoxGeometry meshes)
      // are not affected because they're never at a negative position.
      const pos = o.position;
      const isAxisCyl = t === 'CylinderGeometry' && (n === 'X' || n === 'Y' || n === 'Z');
      const negComponent = (n === 'X' && pos.x < -0.01)
                       || (n === 'Y' && pos.y < -0.01)
                       || (n === 'Z' && pos.z < -0.01);
      if (isAxisCyl && negComponent) {
        o.visible = false;
        try {
          Object.defineProperty(o, 'visible', {
            get: () => false,
            set: () => {},
            configurable: true,
          });
        } catch (_) {}
        return;
      }
      if (t === 'CylinderGeometry') {
        // Arrow stems and tip cones — make thinner along the transverse axes.
        o.scale.x = 0.55;
        o.scale.z = 0.55;
      } else if (t === 'OctahedronGeometry') {
        // Center XYZ handle (the small grey diamond at the gizmo origin).
        // Hidden because it overlaps the part being moved and offers
        // little value vs. the X/Y/Z arrows for a CAD workflow. Pin
        // visibility off so TransformControls can't restore it.
        o.visible = false;
        try {
          Object.defineProperty(o, 'visible', {
            get: () => false,
            set: () => {},
            configurable: true,
          });
        } catch (_) {}
      } else if (t === 'TorusGeometry') {
        // Rotate-mode rings — thin them too if the user switches to rotate.
        o.scale.x = 1.0;  // ring diameter unchanged
        o.scale.y = 1.0;
        o.scale.z = 1.0;
      }
      // Make the plane handles (XY, YZ, XZ squares) less visually heavy by
      // dropping their opacity. Identified by the named picker convention
      // — they're the only meshes with single-letter pair names.
      if (/^(XY|YZ|XZ)$/.test(n) && o.material) {
        o.material.opacity = Math.min(o.material.opacity ?? 1, 0.4);
        o.material.transparent = true;
      }
    }
    // Hard-hide every Line in the gizmo subtree. These are the long world-
    // spanning axis-guide lines TransformControls draws when an arrow is
    // hovered/dragged; they extend through the scene and look noisy at
    // tight zooms. The actual visible arrow shafts are Mesh + CylinderGeometry
    // (handled above), not Line, so hiding all Line objects is safe.
    // Pin .visible to false the same way as the 'helper' branch — otherwise
    // TransformControls' internal show/hide on hover restores them every
    // time the mouse enters an axis.
    if (o.isLine) {
      o.visible = false;
      try {
        Object.defineProperty(o, 'visible', {
          get: () => false,
          set: () => {},
          configurable: true,
        });
      } catch (_) { /* already pinned */ }
    }
  });

  // Reusable pivot — gizmo always attaches to this; we re-parent the selected mesh under it
  state.pivot = new THREE.Group();
  state.pivot.name = '_pivot';
  scene.add(state.pivot);
}

// Place the gizmo at the bbox-center of the selected mesh by wrapping it in a pivot.
// The pivot is positioned at world-bbox-center; the mesh is reparented under it
// (THREE.Group.attach preserves world transform). Now the gizmo manipulates the pivot
// at the visual center of the part.
// Attach the gizmo to ANY number of parts as a single "group" pivot. The
// pivot sits at the combined world bbox center; each selected mesh is
// re-parented under the pivot so a translate/rotate moves them together.
// _detachGizmo() restores them to partsRoot with their final world transform.
// Pop a single instance out of an InstancedMesh and into a standalone Mesh
// under partsRoot, preserving its visual world transform. Used when the user
// wants to manipulate an instance with the gizmo — InstancedMesh instances
// don't have their own scene-graph node so the gizmo can't grab them.
//
// Side effects:
//   - The InstancedMesh slot for this instance is zeroed (not visible) so the
//     instance no longer renders from there. The new standalone Mesh renders
//     it instead, at the same world position.
//   - The part's geometry remains shared with the InstancedMesh's siblings.
//     Bake/boxify already handle the "first-touch wins, subsequent clone"
//     pattern, so mutations on the promoted part don't corrupt siblings.
function _promoteInstanceToMesh(p) {
  if (!p || !p.instancedMesh || p.instanceIndex < 0 || p.deleted) return false;
  const inst = p.instancedMesh;
  const localMat = new THREE.Matrix4();
  inst.getMatrixAt(p.instanceIndex, localMat);
  inst.updateWorldMatrix(true, false);
  const worldMat = new THREE.Matrix4().multiplyMatrices(inst.matrixWorld, localMat);

  const mesh = new THREE.Mesh(inst.geometry, inst.material);
  mesh.name = p.name || `part_${p.partId}`;
  mesh.userData.partId = p.partId;

  // Attach to partsRoot, computing local matrix relative to it
  state.partsRoot.updateWorldMatrix(true, false);
  const parentInv = new THREE.Matrix4().copy(state.partsRoot.matrixWorld).invert();
  const localToParts = new THREE.Matrix4().multiplyMatrices(parentInv, worldMat);
  localToParts.decompose(mesh.position, mesh.quaternion, mesh.scale);
  state.partsRoot.add(mesh);
  state.partsRoot.updateMatrixWorld(true);

  // Hide the original instance slot
  const m4zero = new THREE.Matrix4().makeScale(0, 0, 0);
  inst.setMatrixAt(p.instanceIndex, m4zero);
  inst.instanceMatrix.needsUpdate = true;

  // Update part record to standalone-mesh state
  p.mesh = mesh;
  p.instancedMesh = null;
  p.instanceIndex = -1;
  p._instOrigMat = null;
  // Drop the group reference so isolate / show-all paths treat this as a
  // regular standalone part now.
  p.group = null;
  return true;
}

// If the current selection EXACTLY matches one userGroup's part list, return
// that group — that's the signal to attach the gizmo to the group's transform
// origin instead of the bbox center of the contained meshes. Mixed selections
// (group + extra parts, or partial group) fall through to the per-part path.
// Returns a userGroup whose member set EXACTLY matches state.selected, or
// null. Hier groups (auto-detected from the assembly tree) are intentionally
// excluded: their obj3d isn't a guaranteed flat container of the descendant
// meshes — _detachGizmo always reparents pivoted meshes back to partsRoot,
// so after any individual gizmo drag, members of a hier group end up
// scattered outside its obj3d. Attaching the gizmo to the (now empty)
// obj3d would move only it (and the highlights parented to pivot) while
// the actual meshes stay put — visible to the user as "highlight moves,
// mesh stays in place". The per-part pivot path handles hier-group
// selections fine: gizmo still appears at the bbox center of all selected
// meshes, dragging moves them all by the same delta.
function _findSelectionUserGroup() {
  if (!state.selected || state.selected.size === 0) return null;
  if (!state.userGroups || state.userGroups.length === 0) return null;
  for (const g of state.userGroups) {
    if (!g || !g.ref || g.partIds.size !== state.selected.size) continue;
    let allMatch = true;
    for (const pid of g.partIds) {
      if (!state.selected.has(pid)) { allMatch = false; break; }
    }
    if (allMatch) return g;
  }
  return null;
}

function _attachGizmoToParts(parts) {
  if (!state.gizmo || !state.pivot) return;
  // Promote any selected-but-instanced parts so they CAN be moved by the
  // gizmo. Without this they'd silently be filtered out below and the user
  // would see "selection but no gizmo" on every instanced part — which on
  // Cinema 4D / Blender exports (where the auto-instance pass collapses
  // most repeated geometry) means the gizmo refuses to appear on the bulk
  // of the model.
  let promoted = 0;
  for (const p of (parts || [])) {
    if (!p || p.deleted || p.mesh) continue;
    if (p.instancedMesh && _promoteInstanceToMesh(p)) promoted++;
  }
  if (promoted > 0) {
    Log.info(`promoted ${promoted} instance${promoted === 1 ? '' : 's'} to standalone mesh for gizmo`, { tag: 'gizmo' });
    toast('Instances promoted', `${promoted} part${promoted === 1 ? '' : 's'} popped out of instance group so the gizmo can move them`, 'info', 4000);
  }

  parts = (parts || []).filter(p => p && p.mesh && !p.deleted);
  if (parts.length === 0) return;

  // ── Group-pivot path: when the user selects exactly one userGroup, the
  //    gizmo anchors at the group's TRANSFORM ORIGIN (groupRef.position in
  //    world) rather than the bbox center of its children. This matches the
  //    mental model of "the group is one object" — translating/rotating the
  //    gizmo moves every child as a unit, around the group's own pivot.
  //    We reparent groupRef under state.pivot (preserving world transform);
  //    the gizmo drag then transforms the pivot, which propagates to groupRef
  //    and thence to every child mesh through normal scene-graph maths.
  const ug = _findSelectionUserGroup();
  if (ug) {
    // Use the bbox center of the group's children for the gizmo's visible
    // pivot — NOT the group container's local origin. addUserGroup creates
    // the THREE.Group at (0,0,0) and reparents children with `attach()`,
    // which preserves WORLD transforms but leaves the group's own origin at
    // (0,0,0). Anchoring the gizmo at groupRef.position would therefore
    // drop it at the world origin (often far from any visible mesh — looks
    // like "no gizmo"). The group still transforms as a unit because we
    // reparent groupRef under state.pivot, so dragging the pivot drags the
    // whole group; the visual placement is just decoupled from the
    // container's arbitrary local origin.
    // Reattach any group members that have wandered out of grp — individual
    // gizmo drags reparent meshes back to partsRoot in _detachGizmo, not to
    // their owning group. Without re-collecting them here, attaching the
    // gizmo to the (now sparse) ug.ref would move only the still-attached
    // members + the highlight overlay, leaving the wandered meshes behind:
    // the "highlight moves, main mesh stays in place" symptom.
    ug.ref.updateWorldMatrix(true, false);
    for (const p of parts) {
      if (p.mesh && p.mesh.parent !== ug.ref) {
        p.mesh.updateWorldMatrix(true, false);
        ug.ref.attach(p.mesh);   // preserves world transform
      }
    }
    const box = new THREE.Box3();
    for (const p of parts) {
      p.mesh.updateWorldMatrix(true, false);
      const b = new THREE.Box3().setFromObject(p.mesh);
      if (!b.isEmpty()) box.union(b);
    }
    let center;
    if (!box.isEmpty()) {
      center = box.getCenter(new THREE.Vector3());
    } else {
      center = new THREE.Vector3();
      ug.ref.getWorldPosition(center);
    }
    state.pivot.position.set(0, 0, 0);
    state.pivot.rotation.set(0, 0, 0);
    state.pivot.scale.set(1, 1, 1);
    state.pivot.updateMatrixWorld();
    state.pivot.position.copy(center);
    // Mirror single-part behaviour: orient the pivot to match the group's
    // world rotation so gizmo handles align with the group's local axes.
    ug.ref.updateWorldMatrix(true, false);
    ug.ref.getWorldQuaternion(state.pivot.quaternion);
    state.pivot.updateMatrixWorld();
    state._pivotOrigParent = null; // ug.ref's parent (partsRoot) is at world origin
    state.pivot.attach(ug.ref);
    state._pivotedGroup = ug.ref;
    state._pivotedGroupId = ug.id;
    state._pivotedParts = parts;        // children — for highlight refresh
    state._pivotedPart = parts[0];
    if (state.activeHighlights && state._selMergedGeom) {
      for (const h of state.activeHighlights) {
        if (h.geometry === state._selMergedGeom) state.pivot.attach(h);
      }
    }
    state.gizmo.attach(state.pivot);
    if (state.gizmoHelper) state.gizmoHelper.visible = state.gizmoMode !== 'off';
    return;
  }
  // Combined world bbox center. updateWorldMatrix(true, false) walks the
  // ancestor chain so meshes inside nested gltf groups (Cinema-converted
  // files) get a current matrixWorld before setFromObject reads it.
  const box = new THREE.Box3();
  for (const p of parts) {
    p.mesh.updateWorldMatrix(true, false);
    const b = new THREE.Box3().setFromObject(p.mesh);
    if (!b.isEmpty()) box.union(b);
  }
  let center;
  if (!box.isEmpty()) {
    center = box.getCenter(new THREE.Vector3());
  } else {
    // Fallback: bbox came back empty — typically because the mesh's
    // geometry.boundingBox is null on a freshly-loaded nested GLB and
    // setFromObject didn't traverse far enough. Use the mesh's world
    // position as the gizmo anchor instead of bailing (which previously
    // made the gizmo silently never appear on Cinema-converted files).
    center = new THREE.Vector3();
    parts[0].mesh.getWorldPosition(center);
  }
  // Reset the pivot, move it to the centroid, and — for single-part
  // selections — orient it to match the part's world rotation so the
  // gizmo handles align with the object's local axes (Blender-style).
  // Multi-part selections fall back to identity rotation since there's
  // no single "object rotation" to align to.
  state.pivot.position.set(0, 0, 0);
  state.pivot.rotation.set(0, 0, 0);
  state.pivot.scale.set(1, 1, 1);
  state.pivot.updateMatrixWorld();
  state.pivot.position.copy(center);
  if (parts.length === 1) {
    parts[0].mesh.updateWorldMatrix(true, false);
    const _qWorld = new THREE.Quaternion();
    parts[0].mesh.getWorldQuaternion(_qWorld);
    state.pivot.quaternion.copy(_qWorld);
  }
  state.pivot.updateMatrixWorld();
  // Track original parent for local-coordinate display (e.g. parts inside
  // user groups that have a non-origin world position).
  state._pivotOrigParent = null;
  for (const p of parts) {
    if (p.mesh?.parent && p.mesh.parent !== state.pivot) {
      state._pivotOrigParent = p.mesh.parent; break;
    }
  }
  // Re-parent every selected mesh under pivot, preserving world transforms.
  // Because pivot now matches the part's world rotation, the part's local
  // rotation will collapse to (near-)identity after attach — the rotation
  // "lives" on the pivot, where the gizmo handles can follow it.
  for (const p of parts) state.pivot.attach(p.mesh);
  state._pivotedParts = parts;
  state._pivotedPart = parts[0]; // legacy compat
  // Re-parent the merged selection-outline lines under the pivot too. The
  // merged buffer has world-space vertex positions baked in, so without this
  // it would stay anchored at the pre-drag positions while the meshes move.
  // pivot.attach() preserves world transform, so the lines stay visually
  // glued to the meshes throughout the drag and after release.
  if (state.activeHighlights && state._selMergedGeom) {
    for (const h of state.activeHighlights) {
      if (h.geometry === state._selMergedGeom) state.pivot.attach(h);
    }
  }
  state.gizmo.attach(state.pivot);
  if (state.gizmoHelper) state.gizmoHelper.visible = state.gizmoMode !== 'off';
}
function _detachGizmo() {
  if (!state.gizmo) return;
  state.gizmo.detach();
  if (state.gizmoHelper) state.gizmoHelper.visible = false;
  // Group-pivot teardown: groupRef was reparented under state.pivot. Send
  // it back to partsRoot, preserving world transform so any drag the user
  // performed is committed in the group's own local matrix.
  if (state._pivotedGroup) {
    if (state.partsRoot) state.partsRoot.attach(state._pivotedGroup);
    // Refresh _exactWorld snapshots on the children so the highlight
    // rebuild on the next selection change reflects the new world poses.
    for (const p of (state._pivotedParts || [])) {
      if (p && p.mesh) {
        p.mesh.updateWorldMatrix(true, false);
        p._exactWorld = p.mesh.matrixWorld.clone();
      }
    }
    if (state.activeHighlights) {
      for (const h of state.activeHighlights) {
        if (h.parent === state.pivot) scene.attach(h);
      }
    }
    state._pivotedGroup = null;
    state._pivotedGroupId = null;
    state._pivotedParts = null;
    state._pivotedPart = null;
    state._pivotOrigParent = null;
    return;
  }
  // Per-part path: return every pivoted mesh to partsRoot with its final
  // world transform.
  const list = state._pivotedParts && state._pivotedParts.length
    ? state._pivotedParts
    : (state._pivotedPart ? [state._pivotedPart] : []);
  for (const p of list) {
    if (p && p.mesh && state.partsRoot) state.partsRoot.attach(p.mesh);
  }
  // Refresh _exactWorld snapshots on the parts that just round-tripped through
  // the pivot. Without this, the next applySelectionColors call (when explode
  // is OFF, so it prefers the snapshot) would draw outlines at the pre-drag
  // pose. The userGroup branch above already does this; mirror it here.
  for (const p of list) {
    if (p && p.mesh) {
      p.mesh.updateWorldMatrix(true, false);
      p._exactWorld = p.mesh.matrixWorld.clone();
    }
  }
  // And return the merged outline lines back to the scene root, preserving
  // their final world position so the next render still shows them in the
  // right place. (They'll be rebuilt against the new world transforms on
  // the next selection change.)
  if (state.activeHighlights) {
    for (const h of state.activeHighlights) {
      if (h.parent === state.pivot) scene.attach(h);
    }
  }
  state._pivotedParts = null;
  state._pivotedPart = null;
  state._pivotOrigParent = null;
}

let _updateGizmoRaf = 0;
function updateGizmo() {
  if (_updateGizmoRaf) return;
  _updateGizmoRaf = requestAnimationFrame(() => {
    _updateGizmoRaf = 0;
    _updateGizmoImpl();
  });
}
function _updateGizmoImpl() {
  if (!state.gizmo) return;
  if (state.gizmoMode === 'off') { _detachGizmo(); return; }
  const ids = [...state.selected];
  // Include instanced parts (p.mesh is null but p.instancedMesh is set) — the
  // promotion code inside _attachGizmoToParts pops them out of the InstancedMesh
  // into standalone meshes so they can carry a gizmo. Filtering on `p.mesh`
  // alone (the previous behavior) made the gizmo silently fail to appear on
  // every instanced part — and after the new hierarchical converter, MOST
  // parts are instanced (~2k of 2.5k), so the gizmo was missing on the bulk
  // of any selection.
  const parts = ids.map(id => getPart(id))
                   .filter(p => p && !p.deleted && (p.mesh || p.instancedMesh));
  if (parts.length === 0) { _detachGizmo(); return; }
  // If the same set is already pivoted, do nothing (avoid re-parent thrash).
  const cur = state._pivotedParts || (state._pivotedPart ? [state._pivotedPart] : []);
  const sameSet = cur.length === parts.length && cur.every(p => parts.includes(p));
  if (sameSet) return;
  _detachGizmo();
  _attachGizmoToParts(parts);
}

function setGizmoMode(mode) {
  state.gizmoMode = mode;
  if (mode === 'off') {
    _detachGizmo();
  } else if (state.gizmo) {
    state.gizmo.setMode(mode);
    updateGizmo();
  }
  ['gz-translate','gz-rotate','gz-scale'].forEach(id => $(id)?.classList.remove('active'));
  $('gz-' + mode)?.classList.add('active');
}

// Toggle snap on/off across all three gizmo modes. Called from the
// document-level Shift keydown/keyup listeners — the user holds Shift to
// snap, releases to free-drag. Three's TransformControls reads these every
// frame, so toggling mid-drag works without restarting the drag.
function _setGizmoSnap(on) {
  if (!state.gizmo) return;
  const s = state.gizmoSnap;
  state.gizmo.setTranslationSnap(on ? s.translate : null);
  state.gizmo.setRotationSnap(on ? s.rotate : null);
  state.gizmo.setScaleSnap(on ? s.scale : null);
  state._gizmoSnapOn = !!on;
  // If a drag is live, refresh the HUD so the SNAP badge appears/disappears
  // immediately when the user taps Shift mid-gesture.
  if (state._gizmoHudActive) _gizmoHud.update();
}

// Live HUD that pops next to the gizmo while dragging and shows the delta
// being applied to the pivot. Translate → ΔX/Y/Z in world units. Rotate →
// per-axis Euler delta in degrees (XYZ order, derived from beforeQuat⁻¹·now).
// Scale → per-axis multiplicative factor. Position is the pivot's projected
// screen coords offset by ~16px so the readout sits clear of the gizmo origin.
const _gizmoHud = (() => {
  let el = null;
  let before = null; // { pos: Vector3, quat: Quaternion, scale: Vector3 }
  const _v = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _qInv = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _project = new THREE.Vector3();
  function _ensure() {
    if (el) return el;
    el = document.getElementById('gizmo-hud');
    return el;
  }
  function _fmt(n, d = 2) {
    if (!Number.isFinite(n)) return '0';
    if (Math.abs(n) < 1e-4) n = 0;
    return n.toFixed(d);
  }
  function _signed(n, d = 2) {
    const s = _fmt(n, d);
    return (n > 0 && !s.startsWith('-')) ? '+' + s : s;
  }
  function _position() {
    if (!state.pivot || !el) return;
    state.pivot.updateWorldMatrix(true, false);
    _project.setFromMatrixPosition(state.pivot.matrixWorld);
    _project.project(camera);
    const rect = renderer.domElement.getBoundingClientRect();
    const vp   = document.getElementById('viewport').getBoundingClientRect();
    const x = (_project.x * 0.5 + 0.5) * rect.width  + (rect.left - vp.left);
    const y = (-_project.y * 0.5 + 0.5) * rect.height + (rect.top  - vp.top);
    el.style.left = (x + 18) + 'px';
    el.style.top  = (y - 14) + 'px';
  }
  function start() {
    _ensure();
    if (!el || !state.pivot) return;
    state._gizmoHudActive = true;
    state.pivot.updateMatrixWorld(true);
    before = {
      pos:   state.pivot.position.clone(),
      quat:  state.pivot.quaternion.clone(),
      scale: state.pivot.scale.clone(),
    };
    update();
    el.classList.add('show');
  }
  function stop() {
    state._gizmoHudActive = false;
    before = null;
    if (el) el.classList.remove('show');
  }
  function update() {
    if (!before || !el || !state.pivot) return;
    const mode = state.gizmoMode;
    const snap = state._gizmoSnapOn ? '<span class="ghud-snap">SNAP</span>' : '';
    let body = '';
    if (mode === 'translate') {
      _v.copy(state.pivot.position).sub(before.pos);
      const dist = _v.length();
      body = `<span class="ghud-mode">MOVE</span>` +
             `<span class="ghud-x">X ${_signed(_v.x)}</span>` +
             `<span class="ghud-y">Y ${_signed(_v.y)}</span>` +
             `<span class="ghud-z">Z ${_signed(_v.z)}</span>` +
             `<span style="color:var(--tx3)">·</span>` +
             `<span style="color:var(--tx2)">${_fmt(dist)} u</span>`;
    } else if (mode === 'rotate') {
      // Δq = qNow * qBefore⁻¹  →  Euler XYZ in degrees
      _qInv.copy(before.quat).invert();
      _q.copy(state.pivot.quaternion).multiply(_qInv);
      _e.setFromQuaternion(_q, 'XYZ');
      const rx = THREE.MathUtils.radToDeg(_e.x);
      const ry = THREE.MathUtils.radToDeg(_e.y);
      const rz = THREE.MathUtils.radToDeg(_e.z);
      body = `<span class="ghud-mode">ROT</span>` +
             `<span class="ghud-x">X ${_signed(rx, 1)}°</span>` +
             `<span class="ghud-y">Y ${_signed(ry, 1)}°</span>` +
             `<span class="ghud-z">Z ${_signed(rz, 1)}°</span>`;
    } else if (mode === 'scale') {
      const sx = before.scale.x ? state.pivot.scale.x / before.scale.x : 1;
      const sy = before.scale.y ? state.pivot.scale.y / before.scale.y : 1;
      const sz = before.scale.z ? state.pivot.scale.z / before.scale.z : 1;
      const uniform = Math.abs(sx - sy) < 1e-4 && Math.abs(sy - sz) < 1e-4;
      body = `<span class="ghud-mode">SCALE</span>` + (uniform
        ? `<span style="color:var(--tx)">×${_fmt(sx, 3)}</span>`
        : `<span class="ghud-x">X ×${_fmt(sx, 3)}</span>` +
          `<span class="ghud-y">Y ×${_fmt(sy, 3)}</span>` +
          `<span class="ghud-z">Z ×${_fmt(sz, 3)}</span>`);
    } else {
      stop();
      return;
    }
    el.innerHTML = `<div class="ghud-row">${body}${snap}</div>`;
    _position();
  }
  return { start, stop, update };
})();

// Build a 2D-canvas-backed CanvasTexture suitable for use as a scene
// background. `paint(ctx, w, h)` does the drawing. Size defaults to 512² which
// is large enough that radial gradients look smooth at any aspect ratio without
// burning GPU memory (1 MB at RGBA8). Color space is forced to sRGB so the
// pixels survive renderer.outputColorSpace conversion unchanged.
function _makeBgTexture(paint, size = 512) {
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  paint(ctx, size, size);
  const tex = new THREE.CanvasTexture(c);
  if (tex.colorSpace !== undefined) tex.colorSpace = THREE.SRGBColorSpace;
  // Linear filter on a smooth-gradient image avoids visible nearest-neighbour
  // banding when the canvas is stretched to the viewport.
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

function setBackground(mode) {
  state.bgMode = mode;
  // Dispose the previous gradient texture (if any) to avoid GPU leaks every
  // time the user toggles bg modes — a CanvasTexture holds its image data
  // until disposed.
  if (scene.background && scene.background.isTexture) {
    scene.background.dispose?.();
  }
  if (mode === 'dark') {
    // Industry-standard CAD viewport: cool slate-blue at the top fading to
    // a darker bottom (SolidWorks / Onshape / NX studio look). Vertical
    // linear gradient with a soft radial highlight just above centre to
    // suggest a fill light, so the model reads dimensional rather than
    // pasted on a flat sheet.
    const tex = _makeBgTexture((ctx, w, h) => {
      const lg = ctx.createLinearGradient(0, 0, 0, h);
      lg.addColorStop(0,    '#5a6878');   // sky — cool slate blue-grey
      lg.addColorStop(0.55, '#3a434f');   // mid
      lg.addColorStop(1,    '#222831');   // ground
      ctx.fillStyle = lg; ctx.fillRect(0, 0, w, h);
    }, 1024);
    scene.background = tex;
    renderer.setClearColor(0x222831, 1);
  }
  else if (mode === 'grad') {
    // Studio gradient: warm-tinted bottom, cool top, with a soft horizon
    // glow centred a third of the way up. Two passes — a vertical linear
    // for the sky/ground split, then a radial highlight composited on top.
    const tex = _makeBgTexture((ctx, w, h) => {
      // Pass 1: vertical sky → ground linear.
      const lg = ctx.createLinearGradient(0, 0, 0, h);
      lg.addColorStop(0,    '#243049');     // sky top
      lg.addColorStop(0.5,  '#161c2a');     // horizon
      lg.addColorStop(1,    '#0b0e16');     // ground floor
      ctx.fillStyle = lg; ctx.fillRect(0, 0, w, h);
      // Pass 2: radial highlight ⅔ up to fake a soft fill light.
      const rg = ctx.createRadialGradient(w/2, h*0.62, 0, w/2, h*0.62, w*0.55);
      rg.addColorStop(0,    'rgba(110,168,255,0.10)');
      rg.addColorStop(0.6,  'rgba(110,168,255,0.03)');
      rg.addColorStop(1,    'rgba(0,0,0,0)');
      ctx.fillStyle = rg; ctx.fillRect(0, 0, w, h);
    });
    scene.background = tex;
    renderer.setClearColor(0x0b0e16, 1);
  }
  else if (mode === 'solid') { scene.background = new THREE.Color(0x000000); renderer.setClearColor(0x000000, 1); }
  else if (mode === 'gray') {
    // Blender-style neutral viewport: warm mid-grey with a subtle vertical
    // falloff from slightly lighter at the top to a touch darker at the
    // bottom. Reads as a flat studio backdrop without the "looking up at
    // the sky" cool tint of the dark/grad presets — keeps the model's own
    // colours honest, which is the whole reason you'd pick a neutral grey.
    const tex = _makeBgTexture((ctx, w, h) => {
      const lg = ctx.createLinearGradient(0, 0, 0, h);
      lg.addColorStop(0,    '#4a4a4a');   // slightly lifted top
      lg.addColorStop(0.55, '#3a3a3a');   // Blender default neutral
      lg.addColorStop(1,    '#2c2c2c');   // grounded bottom
      ctx.fillStyle = lg; ctx.fillRect(0, 0, w, h);
    }, 1024);
    scene.background = tex;
    renderer.setClearColor(0x3a3a3a, 1);
  }
  else if (mode === 'white') {
    // Soft white studio: very gentle radial vignette so a white backdrop
    // doesn't read as a flat sheet of paper. The tint is barely there.
    const tex = _makeBgTexture((ctx, w, h) => {
      const g = ctx.createRadialGradient(w/2, h*0.45, 0, w/2, h*0.45, w*0.72);
      g.addColorStop(0,    '#ffffff');
      g.addColorStop(0.7,  '#f3f3f3');
      g.addColorStop(1,    '#dedede');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    });
    scene.background = tex;
    renderer.setClearColor(0xdedede, 1);
  }
  requestRender();
}

function onResize() {
  // wireUI() runs before initRenderer(), so this can fire while camera/renderer
  // are still undefined. The boot() flow will call onResize() again once they
  // exist — until then it's a no-op.
  if (!camera || !renderer) return;
  const c = $('canvas');
  const w = c.clientWidth, h = Math.max(1, c.clientHeight);
  if (camera.isOrthographicCamera) {
    // Preserve vertical extent; rescale horizontal to match the new aspect.
    const halfH = (camera.top - camera.bottom) / 2;
    const halfW = halfH * (w / h);
    camera.left = -halfW; camera.right = halfW;
    camera.top  =  halfH; camera.bottom = -halfH;
  } else {
    camera.aspect = w / h;
  }
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  requestRender();
}

// Reusable temp vectors so per-frame motion check doesn't allocate. Summing
// xyz scalars (the previous heuristic) hits collisions if the camera moves
// equally on +x and -y for example, so a vector-distance comparison is more
// robust as well as allocation-free.
const _TICK_PREV_POS = new THREE.Vector3();
const _TICK_PREV_TGT = new THREE.Vector3();
// The render loop. Wrapped so NO exception can kill the rAF chain. Long
// sessions used to "hang" because some inner step threw, the rest of tick()
// never ran, requestAnimationFrame(tick) was never called, and the loop just
// ... stopped. Now: each step has its own try/catch with throttled console
// warnings; if any one fails, the others still run and the next frame is
// always scheduled in a top-level finally.
let _lastTickAt = 0;
function tick() {
  _lastTickAt = performance.now();
  try {
    if (!state.renderPaused) {
      try {
        // Damping + gizmo drags need ongoing renders. Snapshot camera + target
        // BEFORE controls.update() so we can detect any motion this frame.
        // Skipped entirely when renderPaused — avoids the snapshot/compare
        // every frame during long bake/merge operations.
        _TICK_PREV_POS.copy(camera.position);
        _TICK_PREV_TGT.copy(controls.target);
        controls.update();
        if (camera.position.distanceToSquared(_TICK_PREV_POS) > 1e-12 ||
            controls.target.distanceToSquared(_TICK_PREV_TGT) > 1e-12) {
          requestRender();
        }
      } catch (e) { _logTickErr('controls', e); }
    }

    try {
      if (state.autoRotate && state.partsRoot) {
        state.partsRoot.rotation.z += 0.003;
        // partsRoot.matrixAutoUpdate=false (perf), so updateMatrixWorld alone
        // would propagate a stale local matrix and the rotation would be a
        // no-op. Recompose the local matrix from rotation first.
        state.partsRoot.updateMatrix();
        state.partsRoot.updateMatrixWorld(true);
        requestRender();
      }
    } catch (e) { _logTickErr('autorotate', e); }

    // Render only if something invalidated us, OR we're inside the post-event
    // decay window. This drops idle GPU usage to ~0 on a static 10k-part scene.
    const shouldRender = state.needsRender || state.activeFrames > 0;
    if (shouldRender && !state.renderPaused) {
      let renderErr = null;
      try { renderer.render(scene, camera); }
      catch (e) { renderErr = e; }
      if (renderErr) {
        // Throttled diagnostics. Previously this catch was a silent no-op
        // ("swallow transient WebGPU race during bulk swaps") which masked
        // real GPU-state failures: after long sessions with many geometry
        // swaps (boxify/merge/split), WebGPU could enter a bad pipeline
        // cache or lost-device state where every render threw — and the
        // user just saw a frozen viewport with no console output.
        state._renderErrCount = (state._renderErrCount || 0) + 1;
        const now = performance.now();
        if (!state._renderErrLogAt || now - state._renderErrLogAt > 2000) {
          console.warn('[render] frame failed (' + state._renderErrCount +
                       ' total since last healthy frame):', renderErr?.message || renderErr);
          state._renderErrLogAt = now;
        }
        // Burst of failures => probably device-lost / pipeline thrash.
        // Run a layered recovery: drop selection overlays first (most
        // likely suspect — large edge buffers can corrupt pipeline cache),
        // then if that doesn't help, force a full WebGPU device recreate.
        if (state._renderErrCount === 30) _recoverRenderer('clear-overlays');
        if (state._renderErrCount === 90) _recoverRenderer('rebuild-device');
      } else {
        // Healthy frame — reset the error counter AND stamp the watchdog's
        // "last good frame" marker. Tracking actual render success here
        // (rather than inferring from `_renderErrCount === 0` in the
        // watchdog interval) avoids the false-positive where a brand-new
        // session has _renderErrCount === undefined, and the watchdog
        // mistakes "never errored" for "never rendered".
        if (state._renderErrCount) state._renderErrCount = 0;
        _watchdogLastHealthyMs = performance.now();
      }
      try { updateAxisGizmo(); } catch (e) { _logTickErr('axis-gizmo', e); }
      state.needsRender = false;
      if (state.activeFrames > 0) state.activeFrames--;
      frameCount++;
    }

    const now = performance.now();
    if (now - lastFps > 500) {
      try {
        const fpsVal = Math.round((frameCount * 1000) / (now - lastFps));
        $('fps').textContent = fpsVal;
        // Viewport overlays — only touched when their toggles in Display
        // settings are on. style.display is 'none' when off; the textContent
        // write is a few characters, but the DOM read is cheaper than a
        // visibilitychange dance, so we just check display here.
        if (state.showFps) {
          const el = $('vp-fps'); if (el) el.textContent = fpsVal + ' fps';
        }
        if (state.showStats && renderer?.info) {
          const i = renderer.info;
          const calls = i.render?.calls ?? '—';
          const tris  = i.render?.triangles ?? 0;
          const el = $('vp-stats');
          if (el) el.textContent = `${calls} calls · ${(tris / 1e6).toFixed(2)}M tris`;
        }
      } catch (_) {}
      frameCount = 0; lastFps = now;
    }
  } catch (e) {
    // Belt-and-braces: if anything *outside* the inner try/catches throws
    // (variable-not-defined, frozen global, etc.) we still must reschedule.
    _logTickErr('tick-outer', e);
  } finally {
    requestAnimationFrame(tick);
  }
}

// Throttled tick-error logger. Without throttling a continuous failure (e.g.
// camera disposed mid-session) would flood the console at 60 Hz and drag the
// whole tab down. One line every 2 s per category is enough to surface the
// problem without becoming the problem.
function _logTickErr(where, err) {
  const k = '_lastTickErr_' + where;
  const now = performance.now();
  if (!state[k] || now - state[k] > 2000) {
    state[k] = now;
    console.warn('[tick.' + where + ']', err?.message || err);
  }
}

// Watchdog. Two distinct stall modes to catch:
//   1. rAF chain DIED — tick() hasn't run at all in >3 s. The most insidious
//      kind of hang because there's literally nothing to log from inside
//      tick() (it's not running). We detect this from a setInterval that
//      compares `_lastTickAt` to wall-clock time. If stuck, we kick a fresh
//      requestAnimationFrame(tick) to revive.
//   2. tick() RUNS but every render throws. Detected by watching the
//      consecutive-error counter alongside elapsed time since a healthy
//      frame; surfaces a user toast so they don't stare at a frozen
//      viewport in confused silence.
let _watchdogLastHealthyMs = performance.now();
let _watchdogToastedAt = 0;
let _watchdogReviveAt = 0;
function _renderWatchdog() {
  try {
    const now = performance.now();
    const visible = (typeof document !== 'undefined') ? document.visibilityState === 'visible' : true;
    if (!visible) {
      // Browser may throttle rAF on hidden tabs to ~1 Hz or less; don't false-alarm.
      _watchdogLastHealthyMs = now;
      return;
    }

    // Mode 1: rAF chain dead.
    const tickSilenceMs = now - (_lastTickAt || now);
    if (tickSilenceMs > 3000 && now - _watchdogReviveAt > 5000) {
      _watchdogReviveAt = now;
      console.warn('[watchdog] tick() silent for ' + tickSilenceMs.toFixed(0) +
                   'ms — kicking rAF chain back to life');
      try { requestAnimationFrame(tick); } catch (e) { console.warn('[watchdog] rAF revive failed:', e); }
    }

    // Mode 2: tick() running but rendering broken. We rely on the tick's
    // success-path stamp of _watchdogLastHealthyMs (set when renderer.render
    // returns without throwing). A scene with `state.needsRender = false`
    // (idle, nothing dirty) is also healthy — we wouldn't expect new
    // frames in that case — so only flag when we KEEP asking for renders
    // and none come out.
    if (!state.needsRender && !state.activeFrames) _watchdogLastHealthyMs = now;
    const stuck = state.needsRender && (now - _watchdogLastHealthyMs > 5000);
    if (stuck && now - _watchdogToastedAt > 30000) {
      _watchdogToastedAt = now;
      console.warn('[watchdog] no healthy frame for ' +
                   ((now - _watchdogLastHealthyMs) / 1000).toFixed(1) +
                   's; needsRender=' + state.needsRender +
                   ', errCount=' + (state._renderErrCount || 0) +
                   ', paused=' + state.renderPaused);
      try { toast('Viewport stalled', 'No frames in the last few seconds. Try a click; if it stays frozen, reload.', 'warn', 6000); } catch (_) {}
    }

    // Mode 3: renderPaused stuck on. Most code paths that set it true wrap
    // their work in try/finally to reset, but if any forgets (or throws
    // before reaching finally on a non-recoverable path), the on-demand
    // render loop never draws another frame. After 10 s of being paused
    // without any active operation, force-reset.
    if (state.renderPaused) {
      state._pausedSinceMs = state._pausedSinceMs || now;
      if (now - state._pausedSinceMs > 10000) {
        console.warn('[watchdog] renderPaused stuck > 10s — force resetting');
        state.renderPaused = false;
        state._pausedSinceMs = 0;
        try { requestRender(); } catch (_) {}
      }
    } else {
      state._pausedSinceMs = 0;
    }
  } catch (_) { /* watchdog itself must never throw */ }
}
// Hook page-visibility so we don't false-alarm when the tab is hidden, and
// force a render on becoming visible (the browser may have backgrounded the
// rAF loop entirely; tick() resumes but we want a fresh frame ASAP).
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      _watchdogLastHealthyMs = performance.now();
      try { requestRender(); } catch (_) {}
    }
  });
}
setInterval(_renderWatchdog, 1500);

// Layered renderer recovery. Called from the render-error escalation path.
function _recoverRenderer(level) {
  console.warn('[render] recovery:', level);
  try {
    if (level === 'clear-overlays') {
      if (state.activeHighlights) {
        for (const h of state.activeHighlights) h.parent?.remove(h);
        state.activeHighlights = [];
      }
      if (state._selMergedGeom) { state._selMergedGeom.dispose?.(); state._selMergedGeom = null; }
      try { toast('Renderer hiccup', 'Cleared selection overlays — re-select to redraw', 'warn', 5000); } catch (_) {}
      return;
    }
    if (level === 'rebuild-device') {
      // 90 failed frames in a row (~1.5 s) — likely a lost WebGPU device.
      // Tell the user; a fresh page reload is the cleanest recovery and
      // avoids leaving them staring at a black viewport.
      try { toast('Viewport stalled', 'Renderer crashed; reload the page to recover', 'error', 10000); } catch (_) {}
    }
  } catch (e) { console.warn('[render] recovery handler itself threw:', e); }
}

// Track the blob URL we hand to new Worker() so we can revokeObjectURL it on
// teardown. Without this, every cancel-then-retry leaked one ~6 KB blob URL
// per session; small individually but ugly in the network tab.
let _stepWorkerUrl = null;
function getStepWorker() {
  if (_stepWorker) return _stepWorker;
  const src = `
self.importScripts('https://cdn.jsdelivr.net/npm/occt-import-js@0.0.22/dist/occt-import-js.js');
let occt = null;
self.onmessage = async (ev) => {
  try {
    if (!occt) {
      self.postMessage({ type: 'progress', stage: 'Loading OpenCascade WASM', sub: '~3 MB one-time' });
      occt = await occtimportjs({ locateFile: p => 'https://cdn.jsdelivr.net/npm/occt-import-js@0.0.22/dist/' + p });
    }
    const buffer = ev.data.buffer;
    self.postMessage({ type: 'progress', stage: 'Parsing STEP geometry', sub: (buffer.byteLength/1048576).toFixed(1) + ' MB' });
    const t0 = performance.now();
    const result = occt.ReadStepFile(new Uint8Array(buffer), null);
    const dt = (performance.now() - t0) / 1000;
    if (!result || !result.success) { self.postMessage({ type: 'error', message: 'OCCT could not parse this STEP file.' }); return; }
    self.postMessage({ type: 'progress', stage: 'Hashing geometries', sub: result.meshes.length + ' meshes' });
    const h = new Array(result.meshes.length);
    for (let i = 0; i < result.meshes.length; i++) {
      const m = result.meshes[i];
      const pos = m.attributes && m.attributes.position && m.attributes.position.array;
      if (!pos) { h[i] = 'empty_' + i; continue; }
      const idx = m.index && m.index.array;
      let hh = 2166136261;
      const step = Math.max(1, (pos.length / 256) | 0);
      for (let k = 0; k < pos.length; k += step) { hh ^= (pos[k] * 1000) | 0; hh = Math.imul(hh, 16777619) >>> 0; }
      hh ^= pos.length; hh = Math.imul(hh, 16777619) >>> 0;
      if (idx) { hh ^= idx.length; hh = Math.imul(hh, 16777619) >>> 0; }
      h[i] = hh.toString(16) + '_' + pos.length;
    }
    self.postMessage({ type: 'done', result, dt, hashes: h });
  } catch (err) { self.postMessage({ type: 'error', message: (err && (err.message || String(err))) || 'Unknown' }); }
};
`;
  _stepWorkerUrl = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
  _stepWorker = new Worker(_stepWorkerUrl);
  return _stepWorker;
}

function parseStepInWorker(buffer, ctrl, onProgress) {
  return new Promise((resolve, reject) => {
    const w = getStepWorker();
    const onMsg = (ev) => {
      if (ctrl.cancelled) { w.removeEventListener('message', onMsg); reject(new Error('cancelled')); return; }
      const m = ev.data;
      if (m.type === 'progress') { onProgress?.(m.stage, m.sub); return; }
      if (m.type === 'done') { w.removeEventListener('message', onMsg); resolve(m); return; }
      if (m.type === 'error') { w.removeEventListener('message', onMsg); reject(new Error(m.message)); return; }
    };
    w.addEventListener('message', onMsg);
    w.addEventListener('error', e => { w.removeEventListener('message', onMsg); reject(new Error(e.message || 'Worker error')); }, { once: true });
    w.postMessage({ buffer }, [buffer]);
  });
}

async function loadStepFile(file) {
  const ctrl = { cancelled: false };
  _activeParse = ctrl;
  setLoader(true, 'Reading file...', file.name);
  setLoaderProgress(5);
  let heartbeat = 0; let hbStage = 'Parsing STEP geometry';
  const startHB = () => {
    let n = 0;
    heartbeat = setInterval(() => {
      n++;
      $('loader-msg').textContent = hbStage + '.'.repeat(n % 4);
      if (n % 50 === 0) logProgress('still parsing - OCCT can take 10-60s for complex assemblies', 'warn');
    }, 200);
  };
  const stopHB = () => { clearInterval(heartbeat); heartbeat = 0; };
  try {
    const buffer = await file.arrayBuffer();
    setLoaderProgress(8);
    logProgress(`file read: ${(buffer.byteLength/1048576).toFixed(2)} MB`, 'ok');
    if (ctrl.cancelled) throw new Error('cancelled');
    setLoader(true, 'Parsing STEP geometry...', `${(buffer.byteLength/1048576).toFixed(1)} MB on worker`);
    setLoaderProgress(null);
    startHB();
    const { result, dt, hashes } = await parseStepInWorker(buffer, ctrl, (stage, sub) => {
      hbStage = stage.replace(/\.\.\.$/,'');
      setLoader(true, stage + '...', sub);
      logProgress(stage + (sub ? ' - ' + sub : ''));
    });
    stopHB();
    if (ctrl.cancelled) throw new Error('cancelled');
    setLoaderProgress(50);
    logProgress(`parsed ${result.meshes.length} meshes in ${dt.toFixed(1)}s`, 'ok');
    setLoader(true, 'Building 3D scene...', `${result.meshes.length} parts`);
    await new Promise(r => setTimeout(r, 16));
    clearModel();
    await buildModelFromMeshes(result.meshes, hashes, ctrl);
    if (ctrl.cancelled) throw new Error('cancelled');
    setLoaderProgress(95);
    fitToView();
    state._loadedFilename = file.name;
    onModelLoaded(file.name);
    setLoaderProgress(100);
    toast('Model loaded', `${result.meshes.length} parts - ${dt.toFixed(1)}s`, 'success');
    await new Promise(r => setTimeout(r, 350));
    // Drain stale resources from the previous model — see _drainDisposeQueue.
    _drainDisposeQueue();
  } catch (e) {
    stopHB();
    if (e.message !== 'cancelled') { console.error(e); toast('Load failed', e.message || String(e), 'error', 8000); }
    await new Promise(r => setTimeout(r, 800));
  } finally {
    _activeParse = null;
    if (controls) controls.enabled = true;
    setLoader(false);
  }
}

async function buildModelFromMeshes(meshes, hashes, ctrl) {
  const partsRoot = state.partsRoot;
  partsRoot.rotation.set(0, 0, 0);
  state.materialByColor.clear();
  state.geomByHash.clear();
  state.instancedGroups = [];
  const total = meshes.length;
  const yieldEvery = Math.max(50, (total / 50) | 0);
  const overallBox = new THREE.Box3();
  let totalTris = 0, totalVerts = 0, totalBytes = 0;
  const counts = new Map();
  if (state.autoInstance) for (let i = 0; i < total; i++) counts.set(hashes[i] || ('idx_' + i), (counts.get(hashes[i] || ('idx_' + i)) || 0) + 1);
  const instanceCollect = new Map();
  for (let i = 0; i < total; i++) {
    if (ctrl?.cancelled) return;
    if (i > 0 && i % yieldEvery === 0) {
      setLoaderProgress(50 + (i / total) * 35);
      $('loader-sub').textContent = `${i.toLocaleString()} / ${total.toLocaleString()} parts processed`;
      await new Promise(r => setTimeout(r, 0));
    }
    const m = meshes[i];
    const positions = m.attributes?.position?.array;
    if (!positions) continue;
    const normals = m.attributes?.normal?.array;
    const indices = m.index?.array;
    const hash = hashes[i] || ('idx_' + i);
    let geom = state.geomByHash.get(hash);
    if (!geom) {
      geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      if (normals) geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      if (indices) geom.setIndex(new THREE.BufferAttribute(indices.length > 65535 ? new Uint32Array(indices) : new Uint16Array(indices), 1));
      if (!normals) geom.computeVertexNormals();
      geom.computeBoundingBox(); geom.computeBoundingSphere();
      state.geomByHash.set(hash, geom);
      totalBytes += positions.byteLength || 0;
      if (normals) totalBytes += normals.byteLength || 0;
      if (indices) totalBytes += indices.byteLength || 0;
    }
    const triCount = (indices ? indices.length : positions.length / 3) / 3;
    const vertCount = positions.length / 3;
    const color = m.color ? new THREE.Color(m.color[0], m.color[1], m.color[2]) : new THREE.Color().setHSL((i * 0.6180339887) % 1, 0.45, 0.65);
    const bbox = geom.boundingBox.clone();
    if (!bbox.isEmpty()) overallBox.union(bbox);
    const partInfo = {
      partId: i, name: m.name || `part_${i}`, hash, triCount, vertCount, bbox,
      sizeMetrics: (() => { const s = bbox.getSize(new THREE.Vector3()); return { diag: s.length(), vol: s.x*s.y*s.z, max: Math.max(s.x, s.y, s.z) }; })(),
      visible: true, deleted: false, flagged: false, originalColor: color.clone(),
      mesh: null, group: null, instanceIndex: -1, instancedMesh: null,
    };
    totalTris += triCount; totalVerts += vertCount;
    if (state.autoInstance && counts.get(hash) >= 3) {
      let g = instanceCollect.get(hash);
      if (!g) { g = { hash, geom, parts: [] }; instanceCollect.set(hash, g); }
      g.parts.push({ partInfo, color });
      partInfo.group = g;
    } else {
      const mat = getOrCreateMaterial(color);
      const mesh = new THREE.Mesh(geom, mat);
      mesh.name = partInfo.name;
      mesh.userData.partId = partInfo.partId;
      partsRoot.add(mesh);
      partInfo.mesh = mesh;
    }
    state.parts.push(partInfo);
  }
  if (instanceCollect.size > 0) {
    let gi = 0;
    for (const g of instanceCollect.values()) {
      const N = g.parts.length;
      const allSameColor = g.parts.every(p => p.color.getHex() === g.parts[0].color.getHex());
      const mat = allSameColor ? getOrCreateMaterial(g.parts[0].color) : new THREE.MeshStandardMaterial({ metalness: 0.15, roughness: 0.55, side: THREE.DoubleSide });
      const inst = new THREE.InstancedMesh(g.geom, mat, N);
      inst.name = `instances_${gi++}`;
      const m4 = new THREE.Matrix4();
      const useColors = !allSameColor;
      if (useColors) inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
      for (let k = 0; k < N; k++) {
        const p = g.parts[k];
        m4.identity();
        inst.setMatrixAt(k, m4);
        if (useColors) inst.setColorAt(k, p.color);
        // Snapshot build-time instance matrix so isolate / showAll can restore
        // it later. STEP path is identity here; GLB auto-instancing bakes
        // per-part world transforms — without the snapshot, toggling visibility
        // of GLB-instanced parts would teleport them to origin.
        p.partInfo._instOrigMat = m4.clone();
        p.partInfo.group = g; p.partInfo.instanceIndex = k; p.partInfo.instancedMesh = inst;
      }
      if (useColors) inst.instanceColor.needsUpdate = true;
      inst.instanceMatrix.needsUpdate = true;
      // STEP path uses identity matrices today, but isolate/bake/explode can
      // mutate them later; computing once here keeps the bounding sphere
      // honest for any subsequent matrix re-write that calls needsUpdate.
      inst.computeBoundingSphere?.();
      partsRoot.add(inst);
      g.instanced = inst;
      state.instancedGroups.push(g);
      if (gi % 20 === 0) await new Promise(r => setTimeout(r, 0));
    }
  }
  // Bbox helpers are built lazily on first toggle (see _ensureBboxHelpers).
  state.bboxBuilt = false;
  const size = overallBox.getSize(new THREE.Vector3());
  state.modelDiag = Math.max(size.length(), 0.0001);
  $('sb-parts').textContent = fmtNum(state.parts.length);
  $('sb-tris').textContent = fmtNum(totalTris);
  $('sb-verts').textContent = fmtNum(totalVerts);
  $('sb-mem').textContent = fmtBytes(totalBytes);
  $('vp-tris').textContent = fmtNum(totalTris);
  $('vp-parts').textContent = fmtNum(state.parts.length);
  $('vp-instances').textContent = fmtNum(state.instancedGroups.length);
  $('vp-info').style.display = '';
  // Snapshot the starting tri count — the bar's 100% reference point. Reset
  // each time a model loads so re-loading reverts to a full bar.
  state._initialTris = totalTris;
  _updateTriBar(totalTris);
  _reindexParts();
  // Heavy assemblies: drop DPR + skip per-mesh frustum culling on the root
  // (single union sphere is computed in fitToView and good enough).
  applyPerfMode();
  rebuildTree(); refreshFlagged();
  // Kick off BVH build async — does NOT block the load path. The user can
  // start interacting immediately; first picks before the BVH is ready use
  // the default raycaster (correct, just slower).
  _buildBVHsForAllGeoms();
  requestRender();
}

function getOrCreateMaterial(color) {
  if (!state.shareMaterials) return new THREE.MeshStandardMaterial({ color: color.clone(), metalness: 0.15, roughness: 0.55, side: THREE.DoubleSide });
  const key = color.getHex();
  let m = state.materialByColor.get(key);
  if (!m) { m = new THREE.MeshStandardMaterial({ color: color.clone(), metalness: 0.15, roughness: 0.55, side: THREE.DoubleSide }); state.materialByColor.set(key, m); }
  return m;
}

// Drop vertex attributes that nothing in the current render or tooling
// pipeline binds. The keep-set is computed FROM the live material, not from
// what the source file shipped — that way the strip self-corrects if textures
// or vertex-color shading are introduced later. Audited consumers (every
// `geom.attributes.<x>` access in this file):
//   position, normal, index    → required everywhere
//   uv                         → only kept if a texture map is bound
//   uv2                        → only for aoMap / lightMap
//   tangent                    → only with normalMap (tangent-space normals)
//   color                      → only if material.vertexColors is true
// `meshSplitter` and the merge path read uv/color when present and otherwise
// no-op, so dropping them is a no-functional-change.
function _attributeKeepSet(mat) {
  const keep = new Set(['position', 'normal']);
  if (!mat) return keep;
  // Material may be an array (multi-material). Scan every entry.
  const mats = Array.isArray(mat) ? mat : [mat];
  for (const m of mats) {
    if (!m) continue;
    const wantsUv = m.map || m.normalMap || m.bumpMap || m.alphaMap ||
                    m.roughnessMap || m.metalnessMap || m.emissiveMap ||
                    m.specularMap || m.displacementMap || m.clearcoatMap;
    if (wantsUv) keep.add('uv');
    if (m.aoMap || m.lightMap) keep.add('uv2');
    if (m.normalMap) keep.add('tangent');
    if (m.vertexColors) keep.add('color');
  }
  return keep;
}
function _stripUnusedAttributes(geom, keep) {
  if (!geom || !geom.attributes) return 0;
  let bytesFreed = 0;
  for (const name of Object.keys(geom.attributes)) {
    if (keep.has(name)) continue;
    const a = geom.attributes[name];
    bytesFreed += a?.array?.byteLength || 0;
    geom.deleteAttribute(name);
  }
  // Morph-target attributes (parallel data structure on .morphAttributes)
  // are also dead weight without animation. Drop wholesale.
  if (geom.morphAttributes) {
    for (const k of Object.keys(geom.morphAttributes)) {
      const arr = geom.morphAttributes[k];
      if (Array.isArray(arr)) {
        for (const a of arr) bytesFreed += a?.array?.byteLength || 0;
      }
      delete geom.morphAttributes[k];
    }
  }
  return bytesFreed;
}

// ── Lazy bbox helpers ──────────────────────────────────────────────────────
// Building thousands of THREE.Box3Helper objects up front bloats the scene
// graph and burns matrix-update time even while invisible. Build only when
// the bbox toggle is first turned on; subsequent toggles are free.
function _ensureBboxHelpers() {
  if (state.bboxBuilt) return;
  const t0 = performance.now();
  for (const p of state.parts) {
    if (p.deleted) continue;
    const helper = new THREE.Box3Helper(p.bbox, 0x6ea8ff);
    helper.userData.partId = p.partId;
    helper.matrixAutoUpdate = false;
    helper.frustumCulled = true;
    state.bboxRoot.add(helper);
  }
  state.bboxRoot.updateMatrixWorld(true);
  state.bboxBuilt = true;
  console.log('[STEP] bbox helpers built in', (performance.now() - t0).toFixed(0), 'ms');
}

// ── Adaptive perf mode ─────────────────────────────────────────────────────
// Heavy assemblies don't need 2× DPR (4× fragment shading). On a 5k-part
// scene with retina display, halving DPR alone can take frame time from
// 25 ms to 8 ms. Tiers are driven by BOTH part count and triangle count
// because they stress different parts of the pipeline:
//   - many parts → CPU-bound (scene-graph traversal, draw-call setup)
//   - many triangles → GPU vertex-shader-bound (cull aggressively, reduce DPR)
function applyPerfMode() {
  let partCount = 0, totalTris = 0;
  for (const p of state.parts) {
    if (p.deleted) continue;
    partCount++; totalTris += p.triCount;
  }
  const avgTris = partCount > 0 ? totalTris / partCount : 0;

  // Tier thresholds — either dimension can promote you up a tier.
  const heavy      = partCount > 1500  || totalTris >   500_000;
  const veryHeavy  = partCount > 6000  || totalTris > 2_000_000;
  const ultraHeavy = partCount > 15000 || totalTris > 8_000_000;

  // Pixel ratio ladder. 0.75 on millions-of-polys scenes is the single biggest
  // win — fragment shading scales with DPR² so going 1.0 → 0.75 cuts shaded
  // pixels by ~44 %.
  let dpr = Math.min(devicePixelRatio || 1, 2);
  if (heavy)      dpr = Math.min(dpr, 1.5);
  if (veryHeavy)  dpr = Math.min(dpr, 1.0);
  if (ultraHeavy) dpr = 0.75;
  if (state.perfMode === 'high') dpr = Math.min(devicePixelRatio || 1, 2);
  if (state.perfMode === 'low')  dpr = 0.6;
  if (renderer && Math.abs((renderer.getPixelRatio?.() ?? 1) - dpr) > 0.01) {
    renderer.setPixelRatio(dpr);
    onResize();
  }

  // Frustum culling decision: the scene-graph cull loop is O(N) every frame.
  // For many-tiny-parts assemblies it's pure overhead. For few-but-huge
  // meshes (avg >800 tris/part) the GPU vertex savings dwarf the CPU cost,
  // so we keep culling on regardless of part count.
  if (state.partsRoot) {
    const cullChildren = !veryHeavy || avgTris > 800;
    state.partsRoot.traverse(o => {
      if (o.isMesh || o.isInstancedMesh) o.frustumCulled = cullChildren;
    });
  }

  console.log(`[STEP] perfMode: parts=${partCount} tris=${fmtNum(totalTris)} avg=${avgTris|0} DPR=${dpr} mode=${state.perfMode}`);
  requestRender();
}

// ── Hierarchy capture from GLB scene graph ────────────────────────────────
// The new hierarchical step2glb.py emits intermediate THREE.Group nodes for
// each XCAF assembly node — those are the "Null Object" entries C4D shows.
// We walk the scene depth-first and emit a flattened-DFS treeNodes array:
// each entry has {id, kind, name, depth, parentId, partId?, instanceCount?}.
//
// rebuildTree renders straight from this array, computing indentation from
// `depth`. If the GLB has no hierarchy (legacy flat output, or the `plain`
// reader path), this function exits early and rebuildTree falls back to its
// flat rendering of state.parts.
function _buildHierarchyFromScene(scene, meshToPart) {
  state.treeNodes = [];
  // Skip a degenerate single-root wrapper (gltf.scene is itself a Group).
  // We treat its direct children as roots so we don't render an outer "Scene"
  // wrapper above everything.
  const roots = scene.children && scene.children.length ? scene.children : [scene];
  // Pre-count how many partInfos share each geom hash so we can mark
  // instanced parts in the tree (matches the green-checkmark behavior C4D shows).
  const hashCount = new Map();
  for (const p of state.parts) hashCount.set(p.hash, (hashCount.get(p.hash) || 0) + 1);

  let nextGroupId = -1;   // group ids are negative so they don't collide with partIds
  let leafCount = 0;
  let groupCount = 0;

  function visit(obj, depth, parentId) {
    if (!obj) return;
    const isMesh = !!obj.isMesh;
    const part = isMesh ? meshToPart.get(obj) : null;
    let nodeId;
    if (part) {
      // Leaf with geometry — link to the existing partInfo
      nodeId = part.partId;
      const inst = hashCount.get(part.hash) || 1;
      state.treeNodes.push({
        id: nodeId, kind: 'part', name: _stripFrameSuffix(part.name), depth,
        parentId, partId: part.partId,
        instanceCount: inst > 1 ? inst : 0,
        obj3d: obj,
      });
      leafCount++;
    } else {
      // Group / null-object node. Skip nodes with no descendants — they only
      // add visual noise (e.g., the gltf scene wrapper one level down).
      if (!obj.children || obj.children.length === 0) return;
      nodeId = nextGroupId--;
      const raw = obj.name && obj.name !== '' ? obj.name : 'Group';
      state.treeNodes.push({
        id: nodeId, kind: 'group', name: _stripFrameSuffix(raw),
        depth, parentId, partId: null,
        obj3d: obj,
      });
      groupCount++;
    }
    if (obj.children) {
      for (const c of obj.children) visit(c, depth + 1, nodeId);
    }
  }

  for (const r of roots) visit(r, 0, null);
  // Defensive sweep: append any state.parts that the scene-graph DFS missed.
  // GLTFLoader / Cinema's exporter occasionally produce mesh objects that
  // aren't reachable from the visited roots (sibling-of-scene, multi-primitive
  // nodes split into separate Meshes that get re-attached, etc.). Without
  // this, those parts ARE in state.parts and ARE selectable in the viewport,
  // but have no row in the tree — making "Reveal in tree" fail. Run unconditionally;
  // the seen-set dedupe is the only condition that actually matters.
  let appended = 0;
  const seen = new Set();
  for (const n of state.treeNodes) if (n.kind === 'part' && n.partId != null) seen.add(n.partId);
  // Insert orphan parts into a synthetic "Untraced" group at the TOP of the
  // tree so they're guaranteed visible (and easy to distinguish from the real
  // hierarchy). If there are no orphans, the synthetic group isn't created.
  const orphans = [];
  for (const p of state.parts) {
    if (p.deleted) continue;
    if (seen.has(p.partId)) continue;
    orphans.push(p);
  }
  if (orphans.length) {
    const orphanGroupId = nextGroupId--;
    // obj3d created lazily by DnD if/when a part is dropped INTO this synthetic
    // header — until then, members are direct children of partsRoot, which is
    // semantically equivalent for rendering.
    const orphanHeader = {
      id: orphanGroupId, kind: 'group',
      name: `Untraced (${orphans.length})`, depth: 0,
      parentId: null, partId: null,
      obj3d: null,
    };
    // Splice at the front so this group lives ABOVE the real hierarchy and
    // is always rendered first (before any MAX cap is hit).
    state.treeNodes.unshift(orphanHeader);
    groupCount++;
    // Insert orphan part rows right after the header (depth 1, parented to
    // the synthetic group) — keep them grouped visually.
    for (let i = 0; i < orphans.length; i++) {
      const p = orphans[i];
      const inst = hashCount.get(p.hash) || 1;
      state.treeNodes.splice(1 + i, 0, {
        id: p.partId, kind: 'part', name: p.name, depth: 1,
        parentId: orphanGroupId, partId: p.partId,
        instanceCount: inst > 1 ? inst : 0,
        obj3d: p.mesh,
      });
      appended++;
      leafCount++;
    }
  }
  if (leafCount === 0 && groupCount === 0) state.treeNodes = [];
  // Note: previously had `if (groupCount === 0) state.treeNodes = []` here as
  // a "fall back to flat for legacy GLBs" heuristic. Removed because GLTFLoader
  // sometimes consolidates empty group wrappers into mesh parents, which made
  // the heuristic trigger on perfectly good hierarchical GLBs and silently
  // hide the entire tree. Better to render whatever hierarchy we got, even if
  // it's just a single root with all parts as direct children.
  console.log(`[STEP] hierarchy capture: ${state.treeNodes.length} tree nodes ` +
    `(${groupCount} groups, ${leafCount} leaves, ${appended} appended via fallback)`);
}

// ── GLB auto-instancing ────────────────────────────────────────────────────
// step2glb.py writes glTF with shared BufferGeometry references for repeated
// shapes (every M6 bolt points to the same vertex buffer). After GLTFLoader,
// these become N THREE.Mesh objects all pointing at one BufferGeometry — but
// three.js still issues one draw call per Mesh.
//
// This pass detects groups of parts with the same geometry.uuid AND the same
// material color, and replaces them with a single InstancedMesh — turning N
// draws into 1. On a typical engineering assembly with thousands of fasteners
// this eliminates the bulk of the per-frame draw cost.
function _autoInstanceFromGLB() {
  // Group by (hash, color). Same geometry but different colors stay in
  // separate groups so they keep their shared materials.
  const groups = new Map();
  for (const p of state.parts) {
    if (!p.mesh) continue;
    if (p.deleted) continue;
    const key = p.hash + '|' + p.originalColor.getHex();
    let g = groups.get(key);
    if (!g) {
      g = { hash: p.hash, geom: p.mesh.geometry, color: p.originalColor.clone(), parts: [] };
      groups.set(key, g);
    }
    g.parts.push(p);
  }

  let collapsed = 0, groupCount = 0;
  for (const g of groups.values()) {
    // Only worth swapping ≥3 — for N=2 the per-instance setup cost outweighs
    // the saved draw call.
    if (g.parts.length < 3) continue;

    const N = g.parts.length;
    const mat = getOrCreateMaterial(g.color);
    const inst = new THREE.InstancedMesh(g.geom, mat, N);
    inst.name = '_glb_inst_' + groupCount;
    inst.frustumCulled = true;          // a single sphere bound covers all instances
    inst.matrixAutoUpdate = false;      // we never move the InstancedMesh itself

    // Adapter group object that mirrors the STEP path's instancedGroups shape
    // so picker / selection / undo code stays unchanged.
    const adapterGroup = {
      hash: g.hash, geom: g.geom,
      parts: g.parts.map(p => ({ partInfo: p, color: p.originalColor })),
      instanced: inst,
    };

    const m4 = new THREE.Matrix4();
    for (let k = 0; k < N; k++) {
      const p = g.parts[k];
      // Use the part's current world matrix as its instance transform.
      p.mesh.updateWorldMatrix(true, false);
      m4.copy(p.mesh.matrixWorld);
      inst.setMatrixAt(k, m4);
      // Snapshot the build-time matrix. _isolateSet / showAllParts use this to
      // restore the part's transform when re-showing — restoring to identity
      // (the previous behaviour) corrupted GLB-instanced positions.
      p._instOrigMat = m4.clone();
      // Pop the original mesh out of its parent. p.mesh = null forces every
      // downstream branch (`if (p.mesh) ... else if (p.instancedMesh) ...`)
      // to take the instanced path.
      if (p.mesh.parent) p.mesh.parent.remove(p.mesh);
      p.mesh = null;
      p.instancedMesh = inst;
      p.instanceIndex = k;
      p.group = adapterGroup;
    }
    inst.instanceMatrix.needsUpdate = true;
    // Frustum culling on InstancedMesh tests against geometry.boundingSphere
    // (centered at local origin). GLB-instance matrices scatter parts across
    // world space — without an explicit recompute, the entire InstancedMesh
    // pops out of view at certain camera angles. computeBoundingSphere on
    // InstancedMesh iterates instance matrices and produces a sphere that
    // actually encloses every instance.
    inst.computeBoundingSphere?.();
    state.partsRoot.add(inst);
    state.partsRoot.updateMatrixWorld(true);
    state.instancedGroups.push(adapterGroup);
    groupCount++;
    collapsed += N;
  }

  if (groupCount > 0) {
    const saved = collapsed - groupCount;
    console.log(`[STEP] GLB auto-instancing collapsed ${collapsed} parts into ${groupCount} draws (${saved} draw calls saved)`);
    $('vp-instances').textContent = fmtNum(state.instancedGroups.length);
  }
}

// Module-scope queue of resources whose dispose has been deferred. Disposed
// after the NEW model has been uploaded and rendered — see clearModel /
// _drainDisposeQueue below for why we can't dispose synchronously on WebGPU.
const _deferredDispose = [];

function _safeDispose(obj) {
  if (!obj || typeof obj.dispose !== 'function') return;
  try { obj.dispose(); }
  catch (e) {
    // r172 WebGPU bug: dispose can throw if a buffer was queued but not yet
    // uploaded. The error is harmless — the buffer never existed, the throw
    // just escapes from the cleanup callback. Swallowed so the rest of the
    // dispose loop continues.
  }
}

// Drain the deferred-dispose queue. Called after the new model has rendered
// at least once, so the WebGPU backend has settled and old buffers can be
// safely destroyed without racing in-flight commands.
async function _drainDisposeQueue() {
  if (_deferredDispose.length === 0) return;
  // Wait two animation frames so the renderer has actually committed the new
  // model's buffers to the GPU. Two frames covers WebGPU's typical 1-2 frame
  // pipeline depth. After this the renderer holds no references to the old
  // resources and dispose is a clean tear-down.
  await new Promise(r => requestAnimationFrame(r));
  await new Promise(r => requestAnimationFrame(r));
  const batch = _deferredDispose.splice(0, _deferredDispose.length);
  let count = 0;
  for (const item of batch) {
    if (!item) continue;
    if (item.kind === 'geom') {
      _disposeEdgesFor(item.obj);
      if (item.obj.boundsTree) { try { item.obj.disposeBoundsTree?.(); } catch (_) {} }
      _safeDispose(item.obj);
    } else {
      _safeDispose(item.obj);
    }
    count++;
  }
  if (count > 0) Log.debug(`disposed ${count} stale resources from previous model`, { tag: 'dispose' });
}

function clearModel() {
  _detachGizmo();

  // ── Force-reset interaction state ──────────────────────────────────────
  // If the user opens a new file mid-gesture (gizmo drag, marquee drag,
  // partial OrbitControls rotate), the corresponding pointer events never
  // complete and various flags stay "active". Carried into the new model
  // they make the viewport feel frozen: OrbitControls sees `enabled=false`,
  // or `_resetInteractionState`'s guard sees `state.gizmo.dragging=true` and
  // refuses to re-enable orbit on the next click. Hard-reset them here so
  // the new model starts from a known-clean slate.
  if (state.gizmo) {
    try { state.gizmo.dragging = false; } catch (_) {}
  }
  state._gizmoBeforeMats = null;
  if (controls) controls.enabled = true;

  // ── Deferred dispose pattern (WebGPU swap-then-drop) ────────────────────
  // three.js r172 WebGPU has a known bug: synchronously disposing a buffer
  // that the renderer has queued but not yet uploaded throws "Cannot read
  // properties of undefined (reading 'destroy')". Worse, even when caught
  // the bad destroy leaves the device in a state where subsequent renders
  // silently throw — the viewport appears to "hang" on the last good frame.
  //
  // Fix: stash the old resources in _deferredDispose instead of disposing
  // now. The new model gets loaded into fresh buffers; the old ones stay
  // alive but unreferenced by the scene graph. After the new model has
  // rendered at least once (called from loadGlbFile / buildModelFromMeshes
  // via _drainDisposeQueue), the queue drains and the old buffers are
  // destroyed cleanly because the renderer's command queue has settled.
  //
  // Memory tradeoff: peak memory briefly holds both models. For our case
  // (130 → 491 MB GLB swap) that's ~1 GB GPU, well within budget on a
  // modern GPU. Worth it to keep the renderer in a valid state.
  for (const g of state.geomByHash.values()) _deferredDispose.push({ kind: 'geom', obj: g });
  for (const m of state.materialByColor.values()) _deferredDispose.push({ kind: 'mat',  obj: m });
  for (const g of state.instancedGroups) {
    if (g.instanced?.material) _deferredDispose.push({ kind: 'mat',  obj: g.instanced.material });
    if (g.instanced)            _deferredDispose.push({ kind: 'mesh', obj: g.instanced });
  }
  if (state._selMergedGeom) {
    _deferredDispose.push({ kind: 'geom', obj: state._selMergedGeom });
  }

  // Detach scene-graph references immediately — the new model needs a clean
  // root to attach to. Old objects survive in _deferredDispose, but the
  // renderer no longer traverses them.
  state.partsRoot.clear(); state.bboxRoot.clear();
  state.parts = []; state.partById.clear(); state.selected.clear(); state.history = []; state.pendingFlagged.clear();
  state.treeNodes = []; state.treeCollapsed.clear();
  state._selAnchorId = null;
  state.materialByColor.clear(); state.geomByHash.clear(); state.instancedGroups = [];
  state.activeHighlights = [];
  state._selMergedGeom = null;
  // Per-model derived state — would otherwise reference parts from the old model.
  state.selHistory = []; state.selHistoryIdx = -1;
  state.explode = { x: 0, y: 0, z: 0 };
  state._explodeBaselineDone = false;
  state._isolated = false;
  state._modelCenter = null;
  state._pendingStepRoot = null;
  state.bboxBuilt = false;
  // Wipe history + redo on model unload (state from a previous file
  // wouldn't apply to whatever we load next).
  state.history.length = 0; state.redo.length = 0;
  $('btn-undo').disabled = true; $('btn-redo') && ($('btn-redo').disabled = true);
  $('btn-export').disabled = true; $('btn-fit').disabled = true; $('btn-reset').disabled = true;
  const _bss = $('btn-save-scene'); if (_bss) _bss.disabled = true;
  requestRender();
}

function onModelLoaded(filename) {
  $('btn-export').disabled = false; $('btn-fit').disabled = false; $('btn-reset').disabled = false;
  const _bss = $('btn-save-scene'); if (_bss) _bss.disabled = false;
  $('dropzone')?.style && ($('dropzone').style.display = 'none');
  // Welcome splash auto-dismisses on successful model load.
  try { _Welcome?.hide(); } catch (_) {}
  setStatus(filename);
  // C4D-style snapshot for the recent-files panel. Defer until the lights
  // ramp has finished and the renderer has had a chance to draw at least one
  // full-quality frame; otherwise we'd snapshot a half-lit / partially-loaded
  // scene. ~1.1s matches the boot-light ramp duration.
  setTimeout(() => {
    // _captureRecentThumb is async — a synchronous try/catch can't catch
    // its rejection, so the renderTargetPixelsAsync failure observed on
    // WebGPU surfaced as an "Unhandled promise rejection". Always attach
    // .catch() to swallow it cleanly.
    Promise.resolve()
      .then(() => _captureRecentThumb(filename))
      .catch(e => console.warn('[recent-thumb] capture failed:', e?.message || e));
  }, 1100);
}

// Render the scene into a small offscreen target, encode the result as a JPEG
// data URL, and persist it on the matching `_Welcome` recent record. Same
// path works for WebGL and WebGPU renderers because we go through the
// renderer's own readRenderTargetPixels API rather than canvas.toDataURL
// (the swap-chain image is gone after WebGPU presents).
async function _captureRecentThumb(filename) {
  console.log('[recent-thumb] start for', filename);
  if (!renderer || !scene) { console.warn('[recent-thumb] no renderer/scene'); return; }
  if (!state.partsRoot) { console.warn('[recent-thumb] no partsRoot'); return; }
  const box = new THREE.Box3().setFromObject(state.partsRoot);
  if (box.isEmpty()) { console.warn('[recent-thumb] empty bbox'); return; }
  // Output 640 px square. The hero card (520 px-wide modal × ~140 px tall)
  // and the recent-list rows (42×42) both crop a centred region; a square
  // source keeps the framing consistent. Higher than 256 makes the hero
  // background read sharply on retina displays without bloating
  // localStorage too much (one JPEG ≈ 60-120 KB at quality 0.85, so 8
  // recents stay well under the 5 MB localStorage cap).
  const SIZE = 640;
  // Frame the model with a 3/4 hero camera. Same dir as fitToView so the
  // thumbnail looks like the user's first sight of the model.
  const sz = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(sz.x, sz.y, sz.z) || 1;
  const cam = new THREE.PerspectiveCamera(35, 1, maxDim / 1000, maxDim * 100);
  cam.up.set(0, 0, 1);
  const dir = new THREE.Vector3(0.7, -0.9, 0.5).normalize();
  const dist = (maxDim / (2 * Math.tan(cam.fov * Math.PI / 360))) * 1.4;
  cam.position.copy(center).add(dir.multiplyScalar(dist));
  cam.lookAt(center);
  // Hide helpers (grid, axes, bbox) for a clean thumbnail.
  const wasGrid = gridHelper?.visible, wasAxes = axesHelper?.visible, wasBbox = state.bboxRoot?.visible;
  if (gridHelper)       gridHelper.visible = false;
  if (axesHelper)       axesHelper.visible = false;
  if (state.bboxRoot)   state.bboxRoot.visible = false;
  const target = new THREE.WebGLRenderTarget(SIZE, SIZE, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const oldTarget = renderer.getRenderTarget?.();
  let pixels = new Uint8Array(SIZE * SIZE * 4);
  let readOk = false;
  try {
    renderer.setRenderTarget(target);
    if (typeof renderer.renderAsync === 'function') await renderer.renderAsync(scene, cam);
    else renderer.render(scene, cam);
    try {
      if (typeof renderer.readRenderTargetPixelsAsync === 'function') {
        await renderer.readRenderTargetPixelsAsync(target, 0, 0, SIZE, SIZE, pixels);
      } else {
        renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, pixels);
      }
      readOk = true;
    } catch (readErr) {
      // WebGPU's readRenderTargetPixelsAsync rejects with "Invalid value
      // used as weak map key" against a freshly-allocated RenderTarget —
      // the GPU texture isn't registered with the backend's resource map
      // yet at the moment the copy command runs. Known three.js issue;
      // the canvas-snapshot fallback below keeps thumbs working. Log once
      // per session so the failure is discoverable in the console without
      // spamming on every model load.
      if (!_captureRecentThumb._loggedReadFail) {
        console.info('[recent-thumb] using canvas-snapshot path (WebGPU readRenderTargetPixelsAsync unavailable):', readErr?.message || readErr);
        _captureRecentThumb._loggedReadFail = true;
      }
    }
  } finally {
    renderer.setRenderTarget(oldTarget || null);
    target.dispose();
    if (gridHelper)     gridHelper.visible = wasGrid;
    if (axesHelper)     axesHelper.visible = wasAxes;
    if (state.bboxRoot) state.bboxRoot.visible = wasBbox;
    requestRender?.();
  }
  let dataUrl;
  if (readOk) {
    // GL/WebGPU framebuffer origin is bottom-left; canvas2D is top-left. Flip rows.
    const c = document.createElement('canvas');
    c.width = SIZE; c.height = SIZE;
    const ctx = c.getContext('2d');
    const imageData = ctx.createImageData(SIZE, SIZE);
    for (let y = 0; y < SIZE; y++) {
      const src = (SIZE - 1 - y) * SIZE * 4;
      const dst = y * SIZE * 4;
      imageData.data.set(pixels.subarray(src, src + SIZE * 4), dst);
    }
    ctx.putImageData(imageData, 0, 0);
    dataUrl = c.toDataURL('image/jpeg', 0.86);
  } else {
    // Snapshot the live viewport canvas instead. Cropped to a centred
    // square so wide viewports don't produce stretched thumbnails.
    try {
      if (typeof renderer.renderAsync === 'function') await renderer.renderAsync(scene, cam);
      else renderer.render(scene, cam);
      const liveCanvas = renderer.domElement;
      const w = liveCanvas.width, h = liveCanvas.height;
      const side = Math.min(w, h);
      const sx = (w - side) >> 1, sy = (h - side) >> 1;
      const c = document.createElement('canvas');
      c.width = SIZE; c.height = SIZE;
      const ctx = c.getContext('2d');
      // Higher-quality downsample — without this Chrome uses bilinear and
      // the result looks visibly soft at 640 px next to the hero card's
      // sharp UI text.
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(liveCanvas, sx, sy, side, side, 0, 0, SIZE, SIZE);
      dataUrl = c.toDataURL('image/jpeg', 0.86);
    } catch (snapErr) {
      console.warn('[recent-thumb] canvas snapshot fallback failed:', snapErr?.message || snapErr);
      return;
    }
  }
  // Persist on the matching recent entry. STEP imports go through a
  // server-side conversion that renames the file to a .glb, so a name match
  // can fail; fall back to "first recent" (the just-pushed one) when the
  // exact-name lookup misses.
  try {
    const REC_KEY = 'stepopt-recents';
    const list = JSON.parse(localStorage.getItem(REC_KEY) || '[]');
    let idx = list.findIndex(r => r.name === filename);
    if (idx < 0 && list.length > 0) idx = 0;  // newest entry is the active model
    if (idx >= 0) {
      list[idx].thumb = dataUrl;
      localStorage.setItem(REC_KEY, JSON.stringify(list));
      console.log('[recent-thumb] saved %d-byte JPEG to recents[%d] (%s)', dataUrl.length, idx, list[idx].name);
    } else {
      console.warn('[recent-thumb] no recent record to attach the thumb to');
    }
  } catch (e) {
    console.warn('[recent-thumb] persist failed:', e);
  }
}

function fitToView() {
  const box = new THREE.Box3().setFromObject(state.partsRoot);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = camera.fov * Math.PI / 180;
  const dist = (maxDim / (2 * Math.tan(fov / 2))) * 1.4;
  const dir = new THREE.Vector3(0.7, -0.9, 0.5).normalize();
  camera.position.copy(center).add(dir.multiplyScalar(dist));
  camera.near = Math.max(0.001, dist / 1000); camera.far = dist * 1000;
  camera.updateProjectionMatrix();
  controls.target.copy(center); controls.update();
  // Resize the floor grid to fit the model — a fixed 200-unit grid was getting
  // swallowed by typical mm-scale CAD assemblies (1000+ units across).
  _fitGridToModel(box);
  if (state.clip && state.clip.enabled) {
    _applyClipToAllMaterials();
    updateClipPlane();
  }
  requestRender();
}

// Rebuild gridHelper at a size proportional to the model. Snaps to a "nice"
// power-of-10 dimension and centers the grid under the model's XY footprint
// at z = bbox.min.z so it reads as a floor.
function _fitGridToModel(box) {
  if (!gridHelper || !scene) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const footprint = Math.max(size.x, size.y, 1);
  // Round up to next nice multiple of 10 / 100 / 1000 etc. so grid ticks land
  // on round numbers regardless of unit (mm, cm, m, in).
  const target = footprint * 2.5;
  const mag = Math.pow(10, Math.floor(Math.log10(target)));
  const gridSize = Math.ceil(target / mag) * mag;
  // ~20 visible divisions; one cell ≈ gridSize / 20.
  const divisions = 20;

  // Replace the geometry & material on the existing helper so we keep its
  // identity (and the toggle button's wiring just works).
  const newGrid = new THREE.GridHelper(gridSize, divisions, 0x3a4358, 0x232938);
  newGrid.rotation.x = Math.PI / 2;            // lie in XY plane (Z-up)
  newGrid.position.set(center.x, center.y, box.min.z);
  newGrid.visible = state.showGrid;
  newGrid.material.transparent = true;
  newGrid.material.opacity = 0.45;
  newGrid.matrixAutoUpdate = false;
  newGrid.updateMatrix();

  scene.remove(gridHelper);
  gridHelper.geometry?.dispose?.();
  gridHelper.material?.dispose?.();
  gridHelper = newGrid;
  scene.add(gridHelper);

  // Axes helper too — fixed-size 8 units is invisible on a 1000-mm model.
  // Rescale to ~10% of the model footprint, sitting at the model's floor corner.
  if (axesHelper) {
    const axLen = Math.max(footprint * 0.1, gridSize / 40);
    scene.remove(axesHelper);
    axesHelper.geometry?.dispose?.();
    axesHelper.material?.dispose?.();
    axesHelper = new THREE.AxesHelper(axLen);
    axesHelper.position.set(center.x, center.y, box.min.z);
    axesHelper.visible = state.showAxes;
    scene.add(axesHelper);
  }
}

// ── Pro-mode scene-settings appliers ────────────────────────────────────
// Each function applies its slice of state.* to the live scene/camera.

const _UNIT_FACTOR = { mm: 1, cm: 0.1, m: 0.001, in: 1 / 25.4, ft: 1 / 304.8, none: 1 };
const _UNIT_LABEL  = { mm: 'mm', cm: 'cm', m: 'm', in: 'in', ft: 'ft', none: '' };
function _fmtLen(mm, decimals = 2) {
  const u = state.displayUnit || 'mm';
  const v = (mm ?? 0) * (_UNIT_FACTOR[u] ?? 1);
  const lbl = _UNIT_LABEL[u];
  return lbl ? `${v.toFixed(decimals)} ${lbl}` : v.toFixed(decimals);
}
function _fmtVol(mm3, decimals = 2) {
  const u = state.displayUnit || 'mm';
  const f = _UNIT_FACTOR[u] ?? 1;
  const v = (mm3 ?? 0) * f * f * f;
  const lbl = _UNIT_LABEL[u];
  return lbl ? `${v.toFixed(decimals)} ${lbl}³` : v.toFixed(decimals);
}

function _applySceneUpAxis() {
  if (!state.partsRoot) return;
  state.partsRoot.rotation.x = (state.sceneUpAxis === 'y') ? -Math.PI / 2 : 0;
  state.partsRoot.updateMatrix();
  state.partsRoot.updateMatrixWorld(true);
  if (camera) camera.up.set(0, state.sceneUpAxis === 'y' ? 1 : 0, state.sceneUpAxis === 'z' ? 1 : 0);
  if (gridHelper) {
    gridHelper.rotation.x = (state.sceneUpAxis === 'y') ? 0 : Math.PI / 2;
    gridHelper.updateMatrix();
  }
}

function _applySceneScale() {
  if (!state.partsRoot) return;
  state.partsRoot.scale.setScalar(state.sceneScale);
  state.partsRoot.updateMatrix();
  state.partsRoot.updateMatrixWorld(true);
}

function _applyOriginMarker() {
  if (!scene) return;
  if (state.showOrigin) {
    if (!state._originMarker) {
      const ax = new THREE.AxesHelper(1);
      ax.name = '_originMarker';
      const k = Math.max(state.modelDiag * 0.05, 0.5);
      ax.scale.setScalar(k);
      state._originMarker = ax;
    }
    if (!state._originMarker.parent) scene.add(state._originMarker);
  } else if (state._originMarker?.parent) {
    state._originMarker.parent.remove(state._originMarker);
  }
}

function _applyCameraProjection() {
  if (!camera || !controls) return;
  const target = controls.target.clone();
  const pos = camera.position.clone();
  const up = camera.up.clone();
  const aspect = (camera.aspect != null) ? camera.aspect : (camera.right - camera.left) / (camera.top - camera.bottom);
  const near = camera.near, far = camera.far;
  let next;
  if (state.cameraProjection === 'ortho') {
    if (camera.isOrthographicCamera) return;
    const dist = pos.distanceTo(target);
    const halfH = dist * Math.tan((camera.fov || state.cameraFov) * Math.PI / 360);
    const halfW = halfH * aspect;
    next = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, near, far);
  } else {
    if (camera.isPerspectiveCamera) return;
    next = new THREE.PerspectiveCamera(state.cameraFov, aspect, near, far);
  }
  next.position.copy(pos);
  next.up.copy(up);
  next.lookAt(target);
  next.updateProjectionMatrix();
  camera = next;
  controls.object = camera;
  controls.update();
  if (state.gizmo) state.gizmo.camera = camera;
}

function _applyCameraClip() {
  if (!camera) return;
  const diag = Math.max(state.modelDiag, 1);
  if (state.cameraClipMode === 'tight') { camera.near = diag * 0.001; camera.far  = diag * 100; }
  else if (state.cameraClipMode === 'wide') { camera.near = diag * 0.0001; camera.far  = diag * 10000; }
  else { camera.near = 0.1; camera.far  = 100000; }
  if (camera.updateProjectionMatrix) camera.updateProjectionMatrix();
}

function _applySunDirection() {
  if (!state._lights?.dir) return;
  const az = state.sunAzimuth * Math.PI / 180;
  const el = state.sunElevation * Math.PI / 180;
  const r  = Math.max(state.modelDiag, 100);
  state._lights.dir.position.set(
    r * Math.cos(el) * Math.cos(az),
    r * Math.cos(el) * Math.sin(az),
    r * Math.sin(el),
  );
}

// =====================================================================
// Sun direction gizmo — TransformControls in rotate mode at scene centre.
// Rotating it spins a virtual sphere whose +Y vector is the sun direction;
// we read that vector each frame and place state._lights.dir at
// (direction × radius). Toggled by the tg-sun viewport button.
// =====================================================================

// Build (or fetch) the gizmo objects. Lazy — nothing in the scene until the
// user actually clicks tg-sun, so unloaded models stay clean.
function _ensureSunGizmo() {
  if (state._sunGizmo) return state._sunGizmo;
  if (!scene || !camera || !renderer) return null;
  const diag = Math.max(state.modelDiag || 0, 100);
  // Target whose orientation IS the sun direction. Local +Y on this target
  // is what we project to world space and use as the light vector.
  const target = new THREE.Object3D();
  target.name = '__sun-gizmo-target';
  // Anchor at world origin (0,0,0) per spec — the sun direction is a
  // direction, not a point, so where the gizmo lives is purely visual and
  // (0,0,0) gives a stable reference axis the user already orients to.
  target.position.set(0, 0, 0);
  // Visual marker — a small sun-yellow sphere with a stick pointing along
  // the local +Y axis (i.e. the current sun direction). Cheap, depth-tested,
  // not pickable.
  const visual = new THREE.Group();
  visual.name = '__sun-gizmo-visual';
  const sunSphere = new THREE.Mesh(
    new THREE.SphereGeometry(diag * 0.018, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0xfbbf24 })
  );
  visual.add(sunSphere);
  const stick = new THREE.ArrowHelper(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, 0),
    diag * 0.18,
    0xfbbf24,
    diag * 0.04, diag * 0.025
  );
  visual.add(stick);
  target.add(visual);
  scene.add(target);

  // Initial rotation so the gizmo's +Y starts aligned with the current sun
  // direction (driven by state.sunAzimuth/Elevation). Math: azimuth around
  // world Z, elevation tilts toward world Z. We want a quaternion that
  // rotates +Y onto that direction.
  const az = (state.sunAzimuth ?? 45) * Math.PI / 180;
  const el = (state.sunElevation ?? 45) * Math.PI / 180;
  const dir0 = new THREE.Vector3(
    Math.cos(el) * Math.cos(az),
    Math.cos(el) * Math.sin(az),
    Math.sin(el),
  ).normalize();
  target.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir0);

  // Rotation handles. We make a separate TransformControls — state.gizmo is
  // already in use for part transforms, and TC needs exactly one attach
  // target at a time. In Three.js 0.165+ TransformControls is no longer an
  // Object3D — its visual rings are returned by getHelper(); we add THAT
  // helper to the scene (older API still has the controls themselves work
  // as a scene-mounted Object3D).
  const tc = new TransformControls(camera, renderer.domElement);
  tc.setMode('rotate');
  tc.setSize(0.9);
  tc.attach(target);
  const tcHelper = (typeof tc.getHelper === 'function') ? tc.getHelper() : tc;
  scene.add(tcHelper);

  // Drag → recompute light position from the target's world +Y.
  const tmpV = new THREE.Vector3();
  const _onChange = () => {
    if (!state._lights?.dir) return;
    target.updateMatrixWorld(true);
    tmpV.set(0, 1, 0).applyQuaternion(target.quaternion).normalize();
    const r = Math.max(state.modelDiag || 0, 100);
    state._lights.dir.position.copy(target.position).addScaledVector(tmpV, r);
    // Keep the legacy azimuth/elevation state in sync so that whatever
    // saves the scene captures the new direction. asin/atan2 invert the
    // forward map in _applySunDirection.
    state.sunElevation = Math.round(Math.asin(tmpV.z) * 180 / Math.PI);
    state.sunAzimuth   = Math.round(Math.atan2(tmpV.y, tmpV.x) * 180 / Math.PI);
    if (state.sunAzimuth < 0) state.sunAzimuth += 360;
    requestRender();
  };
  tc.addEventListener('change', _onChange);
  tc.addEventListener('dragging-changed', e => {
    if (controls) controls.enabled = !e.value;
  });
  // Capture-phase pointerdown on the canvas: if the user pressed while
  // hovering a TC handle (axis !== null), suspend orbit BEFORE OrbitControls'
  // own pointerdown handler fires — otherwise OrbitControls grabs the drag
  // first and the camera spins along with the rotation ring. The pointerup
  // re-arms orbit unless TC is mid-drag (in which case dragging-changed
  // already handled it on its own end-of-drag event).
  const onPointerDown = () => {
    if (!state._sunGizmo) return;
    if (state._sunGizmo.tc.axis) controls.enabled = false;
  };
  const onPointerUp = () => {
    if (!state._sunGizmo) return;
    if (!state._sunGizmo.tc.dragging) controls.enabled = true;
  };
  const dom = renderer.domElement;
  dom.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('pointerup', onPointerUp, true);

  state._sunGizmo = { target, visual, tc, tcHelper, _onChange, _onPointerDown: onPointerDown, _onPointerUp: onPointerUp };
  return state._sunGizmo;
}

function _removeSunGizmo() {
  const g = state._sunGizmo;
  if (!g) return;
  try { g.tc.detach(); } catch (_) {}
  // Tear down the capture-phase pointer listeners so they don't keep firing
  // (and pinning controls.enabled) after the gizmo is gone.
  try { renderer?.domElement?.removeEventListener('pointerdown', g._onPointerDown, true); } catch (_) {}
  try { window.removeEventListener('pointerup', g._onPointerUp, true); } catch (_) {}
  if (controls) controls.enabled = true;
  // Helper is what we added to the scene — remove it (covers both the new
  // helper-based API and the older direct-Object3D API where tc === helper).
  if (g.tcHelper && g.tcHelper.parent) g.tcHelper.parent.remove(g.tcHelper);
  if (g.tc.dispose) g.tc.dispose();
  if (g.target.parent) g.target.parent.remove(g.target);
  // Visual children (sphere + arrow) live under target — disposed via
  // recursive parent removal. Geometries/materials are tiny one-offs;
  // explicit dispose keeps GPU memory tidy.
  g.visual?.traverse?.(o => {
    if (o.isMesh) {
      o.geometry?.dispose?.();
      if (Array.isArray(o.material)) o.material.forEach(m => m.dispose?.());
      else o.material?.dispose?.();
    }
  });
  state._sunGizmo = null;
}

function _toggleSunGizmo() {
  const btn = document.getElementById('tg-sun');
  if (state._sunGizmo) {
    _removeSunGizmo();
    btn?.classList.remove('active');
  } else {
    if (!_ensureSunGizmo()) return;
    btn?.classList.add('active');
  }
  requestRender();
}

// =====================================================================
// Transform panel — sidebar-bottom slide-in showing position / rotation
// (deg) / size (bbox) for the active selection. Editable position +
// rotation; size is a read-out of the bounding box. Toggled by the
// tg-transform viewport button.
// =====================================================================

// Resolve the Object3D the transform panel operates on. A single group
// (hier or user-group) wins over part selection — a user-group also adds
// its child parts to state.selected for highlighting, so we'd otherwise
// see "mixed" instead of the group's own transform.
function _transformTarget() {
  const groupIds = state.selectedGroupIds ? [...state.selectedGroupIds] : [];
  const partIds  = state.selected ? [...state.selected] : [];
  if (groupIds.length === 1) {
    const gid = groupIds[0];
    const numId = parseInt(gid, 10);
    if (!Number.isNaN(numId) && state.treeNodes) {
      const hn = state.treeNodes.find(n => n.kind === 'group' && n.id === numId);
      if (hn?.obj3d) return { obj: hn.obj3d, kind: 'group' };
    }
    if (state.userGroups) {
      const ug = state.userGroups.find(g => String(g.id) === String(gid));
      if (ug?.ref) return { obj: ug.ref, kind: 'user-group' };
    }
  }
  if (partIds.length === 1 && groupIds.length === 0) {
    const p = (typeof getPart === 'function') ? getPart(partIds[0]) : null;
    if (p?.mesh) return { obj: p.mesh, kind: 'part', part: p };
  }
  return null;
}

// Walk obj's parent chain — if state.pivot is in there, the gizmo is
// mid-drag and the user sees the world position move even though
// obj.position (local-to-pivot) stays fixed. Read world in that case so
// the panel matches what the viewport shows.
function _hasPivotAncestor(obj) {
  if (!state.pivot) return false;
  let p = obj?.parent;
  while (p) { if (p === state.pivot) return true; p = p.parent; }
  return false;
}

// Cached temporaries — refresh runs every frame while the panel is open,
// so allocating fresh THREE objects each tick adds GC noise.
const _tfTmpVec = new THREE.Vector3();
const _tfTmpVec2 = new THREE.Vector3();
const _tfTmpEuler = new THREE.Euler();
const _tfTmpQuat = new THREE.Quaternion();
const _tfTmpBox = new THREE.Box3();

// Compute the size in a frame where obj's WORLD rotation is stripped,
// so rotating the object (or any ancestor — like the gizmo pivot)
// doesn't grow the displayed AABB. Per child geometry corner v:
//   v_world      = child.matrixWorld · v_local
//   v_relative   = v_world − obj.worldPosition
//   v_unrotated  = qInv(obj.worldRotation) · v_relative
// We pump the 8 corners of every descendant's geometry.boundingBox
// through this and union into _tfTmpBox. obj's scale is preserved (it's
// in child.matrixWorld), so a 2× scaled object reads twice as large.
// Children's own rotations stay, so the result is the object's intrinsic
// shape measured in an axis-aligned frame that doesn't spin with the gizmo.
const _tfStableTmp = new THREE.Vector3();
const _tfObjWorldPos = new THREE.Vector3();
const _tfObjWorldQuatInv = new THREE.Quaternion();
function _readStableSize(obj, target) {
  if (!obj) { target.set(0, 0, 0); return; }
  obj.updateMatrixWorld(true);
  obj.getWorldPosition(_tfObjWorldPos);
  obj.getWorldQuaternion(_tfObjWorldQuatInv);
  _tfObjWorldQuatInv.invert();
  _tfTmpBox.makeEmpty();
  obj.traverse(child => {
    const geom = child.geometry;
    if (!geom) return;
    if (!geom.boundingBox) {
      try { geom.computeBoundingBox(); } catch (_) { return; }
    }
    if (!geom.boundingBox) return;
    child.updateMatrixWorld(true);
    const min = geom.boundingBox.min, max = geom.boundingBox.max;
    const X = [min.x, max.x], Y = [min.y, max.y], Z = [min.z, max.z];
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) {
      _tfStableTmp.set(X[i], Y[j], Z[k])
        .applyMatrix4(child.matrixWorld)
        .sub(_tfObjWorldPos)
        .applyQuaternion(_tfObjWorldQuatInv);
      _tfTmpBox.expandByPoint(_tfStableTmp);
    }
  });
  if (_tfTmpBox.isEmpty()) target.set(0, 0, 0);
  else _tfTmpBox.getSize(target);
}

function _transformPanelRefresh() {
  const panel = document.getElementById('transform-panel');
  if (!panel || !panel.classList.contains('show')) return;

  const target = _transformTarget();
  const inputs = {
    px: document.getElementById('tform-px'),
    py: document.getElementById('tform-py'),
    pz: document.getElementById('tform-pz'),
    rx: document.getElementById('tform-rx'),
    ry: document.getElementById('tform-ry'),
    rz: document.getElementById('tform-rz'),
    sx: document.getElementById('tform-sx'),
    sy: document.getElementById('tform-sy'),
    sz: document.getElementById('tform-sz'),
  };

  // Multi/empty selection: clear + disable. Don't clobber the input the
  // user is actively typing into.
  const selN = (state.selected?.size || 0) + (state.selectedGroupIds?.size || 0);
  if (!target) {
    for (const k of Object.keys(inputs)) {
      const el = inputs[k];
      if (!el) continue;
      if (document.activeElement !== el) el.value = '';
      el.placeholder = selN > 1 ? 'mixed' : '—';
      el.disabled = true;
    }
    document.querySelectorAll('#tform-grid .tform-num').forEach(n => n.classList.add('disabled'));
    return;
  }

  // Single-target case: enable, fill from local position/rotation (or
  // world if a transient pivot is in the way) + world bbox size.
  for (const k of ['px','py','pz','rx','ry','rz','sx','sy','sz']) {
    if (inputs[k]) { inputs[k].disabled = false; inputs[k].classList.remove('mixed'); }
  }
  document.querySelectorAll('#tform-grid .tform-num.disabled').forEach(n => n.classList.remove('disabled'));
  document.querySelectorAll('#tform-grid .tform-step[disabled]').forEach(b => { b.disabled = false; });

  const obj = target.obj;
  const isGroup = target.kind === 'group' || target.kind === 'user-group';
  const usingWorld = _hasPivotAncestor(obj);

  // Swap the Size column header to "Scale" for groups.
  const _allColLabels = document.querySelectorAll('#tform-grid .tform-col-label');
  const sizeColLabel = _allColLabels[_allColLabels.length - 1] || null;
  if (sizeColLabel) sizeColLabel.textContent = isGroup ? 'Scale' : 'Size';

  try {
    if (usingWorld && state.pivot) {
      // obj is reparented under pivot — show obj's OWN world position (not
      // the pivot's bbox-center), then convert to original-parent local frame
      // so the panel displays local coordinates relative to parent.
      obj.updateWorldMatrix(true, false);
      obj.getWorldPosition(_tfTmpVec);
      if (state._pivotOrigParent) {
        state._pivotOrigParent.updateWorldMatrix(true, false);
        state._pivotOrigParent.worldToLocal(_tfTmpVec);
      }
    } else if (target.kind === 'group' && state.pivot && state._pivotedParts?.length) {
      // Tree group with active gizmo: hn.obj3d is NOT reparented under pivot (only
      // its child meshes are), so usingWorld=false above. Show pivot world position —
      // the bbox centroid of the selection — so the panel tracks where content is.
      state.pivot.getWorldPosition(_tfTmpVec);
    } else {
      // user-group without gizmo  → ug.ref.position (partsRoot-local / world)
      // tree group without gizmo  → obj.position (0,0,0 for imported GLTF groups)
      // part without gizmo        → obj.position (world, since parent = partsRoot)
      _tfTmpVec.set(obj.position.x, obj.position.y, obj.position.z);
    }
    if (Number.isFinite(_tfTmpVec.x) && inputs.px && document.activeElement !== inputs.px) inputs.px.value = _fmtNum(_tfTmpVec.x);
    if (Number.isFinite(_tfTmpVec.y) && inputs.py && document.activeElement !== inputs.py) inputs.py.value = _fmtNum(_tfTmpVec.y);
    if (Number.isFinite(_tfTmpVec.z) && inputs.pz && document.activeElement !== inputs.pz) inputs.pz.value = _fmtNum(_tfTmpVec.z);
  } catch (_) {}

  // Rotation: for groups read world quaternion (the container's local
  // rotation is identity). For pivoted parts read from pivot. Otherwise
  // read obj.rotation directly.
  try {
    const rad2deg = (r) => r * 180 / Math.PI;
    if (target.kind === 'group' && state.pivot && state._pivotedParts?.length) {
      // Tree group with active gizmo: show the pivot's own rotation — this is exactly
      // the rotation applied by the user in the current gizmo session (0 on fresh attach,
      // updates live during drag). Using any part's world quaternion instead would leak
      // per-part GLTF orientations across different hierarchy levels.
      const r = state.pivot.rotation;
      if (inputs.rx && document.activeElement !== inputs.rx) inputs.rx.value = _fmtNum(rad2deg(r.x), 2);
      if (inputs.ry && document.activeElement !== inputs.ry) inputs.ry.value = _fmtNum(rad2deg(r.y), 2);
      if (inputs.rz && document.activeElement !== inputs.rz) inputs.rz.value = _fmtNum(rad2deg(r.z), 2);
    } else if (isGroup && !usingWorld) {
      // Group without active gizmo: show the node's own world rotation.
      obj.updateWorldMatrix(true, false);
      obj.getWorldQuaternion(_tfTmpQuat);
      _tfTmpEuler.setFromQuaternion(_tfTmpQuat, obj.rotation.order);
      if (inputs.rx && document.activeElement !== inputs.rx) inputs.rx.value = _fmtNum(rad2deg(_tfTmpEuler.x), 2);
      if (inputs.ry && document.activeElement !== inputs.ry) inputs.ry.value = _fmtNum(rad2deg(_tfTmpEuler.y), 2);
      if (inputs.rz && document.activeElement !== inputs.rz) inputs.rz.value = _fmtNum(rad2deg(_tfTmpEuler.z), 2);
    } else {
      const rotSource = (usingWorld && state.pivot) ? state.pivot.rotation : obj.rotation;
      if (inputs.rx && document.activeElement !== inputs.rx) inputs.rx.value = _fmtNum(rad2deg(rotSource.x), 2);
      if (inputs.ry && document.activeElement !== inputs.ry) inputs.ry.value = _fmtNum(rad2deg(rotSource.y), 2);
      if (inputs.rz && document.activeElement !== inputs.rz) inputs.rz.value = _fmtNum(rad2deg(rotSource.z), 2);
    }
  } catch (_) {}

  // Size (parts) / Scale (groups): parts show stable bbox dimensions in the
  // object's own local frame; groups show the group container's scale factor
  // (1,1,1 = unscaled) since there's no single "size" for a group.
  try {
    if (isGroup) {
      const sc = obj.scale;
      if (inputs.sx && document.activeElement !== inputs.sx) inputs.sx.value = _fmtNum(sc.x, 3);
      if (inputs.sy && document.activeElement !== inputs.sy) inputs.sy.value = _fmtNum(sc.y, 3);
      if (inputs.sz && document.activeElement !== inputs.sz) inputs.sz.value = _fmtNum(sc.z, 3);
    } else {
      _readStableSize(obj, _tfTmpVec2);
      if (Number.isFinite(_tfTmpVec2.x) && _tfTmpVec2.x > 0) {
        if (inputs.sx && document.activeElement !== inputs.sx) inputs.sx.value = _fmtNum(_tfTmpVec2.x);
        if (inputs.sy && document.activeElement !== inputs.sy) inputs.sy.value = _fmtNum(_tfTmpVec2.y);
        if (inputs.sz && document.activeElement !== inputs.sz) inputs.sz.value = _fmtNum(_tfTmpVec2.z);
      } else {
        if (inputs.sx && document.activeElement !== inputs.sx) inputs.sx.value = '';
        if (inputs.sy && document.activeElement !== inputs.sy) inputs.sy.value = '';
        if (inputs.sz && document.activeElement !== inputs.sz) inputs.sz.value = '';
      }
    }
  } catch (_) {}
}
function _fmtNum(v, decimals = 3) {
  if (!Number.isFinite(v)) return '';
  return parseFloat(v.toFixed(decimals)).toString();
}

let _transformWired = false;
function _wireTransformPanel() {
  if (_transformWired) return;
  _transformWired = true;
  // Edit handlers — commit on `change` (blur / Enter) so the user can
  // type a value without partial commits triggering a render every key.
  // Position writes are world-space → converted to local via parent.
  // worldToLocal so the displayed value (world) round-trips back correctly.
  // Position/rotation writes mirror the read path: when a pivot ancestor
  // is in the chain, the displayed value is world; the user types a
  // world-space target and we convert back to local via the actual parent
  // so the round-trip works. Without a pivot, write straight to local.
  const handle = (axis) => (e) => {
    const target = _transformTarget();
    if (!target) { _transformPanelRefresh(); return; }
    const obj = target.obj;
    if (!obj || !obj.position || !obj.rotation || !obj.scale) {
      _transformPanelRefresh(); return;
    }
    const raw = parseFloat(e.target.value);
    if (!Number.isFinite(raw)) { _transformPanelRefresh(); return; }
    // Sanity clamp — Three.js gets unhappy with non-finite or absurd
    // values; cap at ±1e6 scene units which exceeds any plausible CAD bbox.
    const v = Math.max(-1e6, Math.min(1e6, raw));
    const isGroup = target.kind === 'group' || target.kind === 'user-group';
    const usingWorld = _hasPivotAncestor(obj);
    // For groups the pivot is the real mover — hn.obj3d / ug.ref are logical
    // containers that don't parent the actual meshes in the scene graph.
    // Use the pivot whenever it's set up for this selection.
    const pivotActive = state.pivot && (state._pivotedGroup || state._pivotedParts?.length);
    const usePivot = (usingWorld && state.pivot) || (isGroup && pivotActive);
    try {
      if (axis === 'px' || axis === 'py' || axis === 'pz') {
        if (usePivot) {
          // Value is in parent-local frame. When an original parent is tracked
          // (e.g. part inside a user group), compute the delta in world space
          // so the pivot (which lives in scene/partsRoot space) moves correctly.
          if (state._pivotOrigParent) {
            obj.updateWorldMatrix(true, false);
            state._pivotOrigParent.updateWorldMatrix(true, false);
            const _wOld = new THREE.Vector3();
            obj.getWorldPosition(_wOld);
            const _lPos = state._pivotOrigParent.worldToLocal(_wOld.clone());
            if (axis === 'px') _lPos.x = v;
            if (axis === 'py') _lPos.y = v;
            if (axis === 'pz') _lPos.z = v;
            const _wNew = state._pivotOrigParent.localToWorld(_lPos.clone());
            state.pivot.position.add(_wNew.sub(_wOld));
          } else {
            if (axis === 'px') state.pivot.position.x = v;
            if (axis === 'py') state.pivot.position.y = v;
            if (axis === 'pz') state.pivot.position.z = v;
          }
          state.pivot.updateMatrixWorld(true);
        } else if (isGroup) {
          // No active pivot — for user-groups write directly (ug.ref parents
          // the meshes). Tree groups: this is a no-op visually; user must
          // activate the gizmo first.
          obj.position.x = axis === 'px' ? v : obj.position.x;
          obj.position.y = axis === 'py' ? v : obj.position.y;
          obj.position.z = axis === 'pz' ? v : obj.position.z;
        } else {
          if (axis === 'px') obj.position.x = v;
          if (axis === 'py') obj.position.y = v;
          if (axis === 'pz') obj.position.z = v;
        }
      } else if (axis === 'rx' || axis === 'ry' || axis === 'rz') {
        const rad = v * Math.PI / 180;
        // Rotation lives on the pivot so gizmo handles rotate with the object.
        if (usePivot) {
          if (axis === 'rx') state.pivot.rotation.x = rad;
          if (axis === 'ry') state.pivot.rotation.y = rad;
          if (axis === 'rz') state.pivot.rotation.z = rad;
          state.pivot.updateMatrixWorld(true);
        } else {
          if (axis === 'rx') obj.rotation.x = rad;
          if (axis === 'ry') obj.rotation.y = rad;
          if (axis === 'rz') obj.rotation.z = rad;
        }
      } else if (axis === 'sx' || axis === 'sy' || axis === 'sz') {
        if (isGroup) {
          // Groups show their scale factor directly (1 = unscaled). The user
          // types the desired scale multiplier; apply it directly to obj.scale.
          const tgt = Math.abs(v);
          if (!Number.isFinite(tgt) || tgt < 1e-4) { _transformPanelRefresh(); return; }
          if (axis === 'sx') obj.scale.x = tgt;
          if (axis === 'sy') obj.scale.y = tgt;
          if (axis === 'sz') obj.scale.z = tgt;
        } else {
          // Parts: value is a target bbox dimension in mm. Convert to a scale
          // factor by dividing target by current dimension. Reject < 1e-4.
          const tgt = Math.abs(v);
          if (!Number.isFinite(tgt) || tgt < 1e-4) { _transformPanelRefresh(); return; }
          _readStableSize(obj, _tfTmpVec2);
          const dim = axis === 'sx' ? _tfTmpVec2.x : (axis === 'sy' ? _tfTmpVec2.y : _tfTmpVec2.z);
          if (!Number.isFinite(dim) || dim < 1e-9) { _transformPanelRefresh(); return; }
          const factor = tgt / dim;
          if (!Number.isFinite(factor) || factor <= 0) { _transformPanelRefresh(); return; }
          if (axis === 'sx') obj.scale.x *= factor;
          if (axis === 'sy') obj.scale.y *= factor;
          if (axis === 'sz') obj.scale.z *= factor;
        }
      } else {
        return;
      }
      obj.updateMatrix();
      obj.updateMatrixWorld(true);
      // After the write, the object's bbox centre / orientation has moved
      // out from under the gizmo's pivot. Detach + re-attach so the pivot
      // re-positions at the NEW bbox centre with identity rotation —
      // Blender's panel/gizmo stay in sync for free because Blender has no
      // separate pivot, but our app needs an explicit refresh. This also
      // prevents a follow-up gizmo scale on a rotated object from skewing
      // through a stale pivot orientation.
      if (state._pivotedPart || state._pivotedGroup) {
        try { _detachGizmo(); updateGizmo?.(); } catch (_) {}
      }
      // Refresh per-part _exactWorld for any selected part whose mesh
      // matrixWorld just changed. Other call sites (boxify, BVH builder,
      // etc.) read this snapshot and would otherwise see the pre-edit
      // pose for the rest of the session.
      try {
        for (const id of (state.selected || [])) {
          const p = getPart?.(id);
          if (p && p.mesh) {
            p.mesh.updateWorldMatrix(true, false);
            p._exactWorld = p.mesh.matrixWorld.clone();
          }
        }
      } catch (_) {}
    } catch (err) { console.warn('[transform-panel] edit failed:', err); _transformPanelRefresh(); return; }
    requestRender();
    refreshPropertiesPanel?.();
    // Critical for "highlight stuck after typing in transform tab": the
    // number-input edits used to skip applySelectionColors entirely, so
    // the cyan outline stayed at the pre-edit pose. Cheap rebuild now
    // that the highlight is parented to partsRoot — the buffer is keyed
    // on partsRoot-local space, so most of the cost is the per-vertex
    // transform pass which is bounded by SELECTION_EDGE_VERT_BUDGET.
    try { applySelectionColors?.(); } catch (_) {}
    _transformPanelRefresh();
  };
  for (const ax of ['px','py','pz','rx','ry','rz','sx','sy','sz']) {
    const el = document.getElementById('tform-' + ax);
    if (!el) continue;
    el.addEventListener('change', handle(ax));
    // Enter / Tab / Esc — number inputs don't reliably fire `change` on
    // Enter across browsers, so commit explicitly. Esc reverts by
    // re-running refresh, which clobbers the in-flight value.
    el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.blur();
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        // Blur FIRST so the focus-skip in _transformPanelRefresh doesn't
        // protect this input — we explicitly want it overwritten with the
        // real value.
        el.blur();
        _transformPanelRefresh();
      }
    });
    // Wheel on a focused input is a quick scrubber: increment/decrement by
    // step (× shift / ÷ alt). Without this the wheel scrolls the page
    // instead of nudging the value, which is surprising for a number field.
    el.addEventListener('wheel', (ev) => {
      if (document.activeElement !== el || el.disabled) return;
      ev.preventDefault();
      const step = parseFloat(el.step) || 1;
      const mul = ev.shiftKey ? 10 : (ev.altKey ? 0.1 : 1);
      const cur = parseFloat(el.value);
      const base = Number.isFinite(cur) ? cur : 0;
      const dir = ev.deltaY < 0 ? 1 : -1;
      el.value = parseFloat((base + dir * step * mul).toFixed(6)).toString();
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, { passive: false });
  }
  // The part-transform gizmo (state.gizmo) fires `objectChange` on every
  // mouse-move while dragging. Hook into it so the panel mirrors the live
  // mesh transform — otherwise a user dragging the gizmo sees stale values.
  if (state.gizmo && typeof state.gizmo.addEventListener === 'function') {
    state.gizmo.addEventListener('objectChange', () => _transformPanelRefresh());
    // Also fire after a drag completes; some Three.js versions only emit
    // dragging-changed at end and skip the final objectChange.
    state.gizmo.addEventListener('dragging-changed', () => _transformPanelRefresh());
  }
  // Custom stepper buttons (the wrapped −/+ on each side of every input).
  // Delegated on the grid so all 18 buttons share one listener; the cell's
  // data-for points at the input id, and data-step is "+" or "-".
  // Hold-to-repeat: 350ms initial delay, then ~16Hz auto-fire so dragging
  // a stepper smoothly nudges through values without a hundred clicks.
  const grid = document.getElementById('tform-grid');
  if (grid) {
    let stepTimer = null, stepInterval = null;
    const stopRepeat = () => {
      if (stepTimer) { clearTimeout(stepTimer); stepTimer = null; }
      if (stepInterval) { clearInterval(stepInterval); stepInterval = null; }
    };
    const fireStep = (input, btn, e) => {
      if (!input || input.disabled || btn.disabled) return;
      const step = parseFloat(input.step) || 1;
      // Shift (×10), Alt (÷10) — Maya/Blender convention.
      const mul = e.shiftKey ? 10 : (e.altKey ? 0.1 : 1);
      const direction = btn.dataset.step === '-' ? -1 : 1;
      const cur = parseFloat(input.value);
      const base = Number.isFinite(cur) ? cur : 0;
      const next = base + direction * step * mul;
      // Keep readable formatting (no float-noise like 0.30000000000004).
      input.value = parseFloat(next.toFixed(6)).toString();
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    grid.addEventListener('pointerdown', (e) => {
      const btn = e.target.closest('.tform-step');
      if (!btn || btn.disabled || e.button !== 0) return;
      const wrap = btn.closest('.tform-num');
      const input = wrap ? document.getElementById(wrap.dataset.for) : null;
      if (!input) return;
      e.preventDefault();
      btn.setPointerCapture?.(e.pointerId);
      fireStep(input, btn, e);
      // After the initial click, pause a beat then auto-repeat at 60ms.
      stepTimer = setTimeout(() => {
        stepTimer = null;
        stepInterval = setInterval(() => {
          // Re-resolve target each tick so a delete/selection-change mid-
          // hold doesn't write to a stale object — fireStep early-returns
          // through change → handle() if _transformTarget is null now.
          if (input.disabled || btn.disabled) { stopRepeat(); return; }
          fireStep(input, btn, e);
        }, 60);
      }, 350);
    });
    const onUp = () => stopRepeat();
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('blur', onUp);
  }
  // Reset: clear the editable channels back to identity in the SAME frame
  // we display (world if pivot is ancestor, else local). Setting local to
  // zero when a non-identity pivot is in the chain leaves the object stuck
  // at the pivot's world transform — confusing — so we route through world
  // → local conversion for the pivoted case.
  document.getElementById('tform-reset')?.addEventListener('click', () => {
    const target = _transformTarget();
    if (!target?.obj) return;
    const obj = target.obj;
    const isGroup = target.kind === 'group' || target.kind === 'user-group';
    const pivotActive = state.pivot && (state._pivotedGroup || state._pivotedParts?.length);
    try {
      if (pivotActive) {
        // Reset pivot to world origin with identity rotation.
        // Child objects preserve their world offsets relative to the pivot —
        // for single parts that brings them to (0,0,0); for groups the group
        // container moves to origin and the parts come along.
        state.pivot.position.set(0, 0, 0);
        state.pivot.rotation.set(0, 0, 0);
        state.pivot.updateMatrixWorld(true);
        // Also reset the real object's scale (pivot has no scale of its own).
        obj.scale.set(1, 1, 1);
        obj.updateMatrix();
        obj.updateMatrixWorld(true);
      } else if (_hasPivotAncestor(obj)) {
        // obj is under pivot but pivotActive is false — edge case; fall back
        // to the world-to-local path.
        obj.parent?.updateMatrixWorld?.(true);
        _tfTmpVec.set(0, 0, 0);
        if (obj.parent) obj.parent.worldToLocal(_tfTmpVec);
        obj.position.copy(_tfTmpVec);
        if (obj.parent) {
          obj.parent.getWorldQuaternion(_tfTmpQuat).invert();
          obj.quaternion.copy(_tfTmpQuat);
        } else {
          obj.rotation.set(0, 0, 0);
        }
        obj.scale.set(1, 1, 1);
        obj.updateMatrix();
        obj.updateMatrixWorld(true);
      } else {
        // No pivot active — write directly to obj. Works for user-groups
        // (ug.ref parents the meshes) and normal parts. For tree groups this
        // resets the container's own transform (usually a no-op since it's
        // already identity), but scale reset is always safe.
        obj.position.set(0, 0, 0);
        obj.rotation.set(0, 0, 0);
        obj.scale.set(1, 1, 1);
        obj.updateMatrix();
        obj.updateMatrixWorld(true);
      }
      if (state._pivotedPart || state._pivotedGroup) {
        try { _detachGizmo(); updateGizmo?.(); } catch (_) {}
      }
    } catch (err) { console.warn('[transform-panel] reset failed:', err); return; }
    requestRender();
    refreshPropertiesPanel?.();
    _transformPanelRefresh();
  });

  // ── Right-click on Position / Rotation / Size column headers ─────────
  // Pops a small context menu with Copy XYZ / Paste XYZ / Reset XYZ for
  // that one channel. Copies are mirrored to the system clipboard as
  // "x, y, z" so a triplet from one selection can be pasted into a
  // different one (or any text editor). Paste tries the in-app buffer
  // first, then falls back to parsing whatever's in the system clipboard.
  const _tformBuf = { pos: null, rot: null, scale: null };
  const _tformChanLabel = { pos: 'position', rot: 'rotation', scale: 'size' };
  const _tformChanPrefix = { pos: 'p', rot: 'r', scale: 's' };
  function _tformChanInputs(kind) {
    const p = _tformChanPrefix[kind];
    return ['x', 'y', 'z'].map(a => document.getElementById(`tform-${p}${a}`));
  }
  function _tformChanValues(kind) {
    return _tformChanInputs(kind).map(i => i ? parseFloat(i.value) : NaN);
  }
  function _tformChanReadable(kind, vals) {
    const unit = kind === 'rot' ? '°' : '';
    return vals.map(v => Number.isFinite(v) ? v.toFixed(4).replace(/\.?0+$/, '') + unit : '?').join(', ');
  }
  async function _copyTformChan(kind) {
    const vals = _tformChanValues(kind);
    if (vals.some(v => !Number.isFinite(v))) {
      toast?.('Nothing to copy', 'No active selection in this channel', 'info', 2000);
      return;
    }
    _tformBuf[kind] = vals.slice();
    const text = vals.map(v => v.toFixed(6).replace(/\.?0+$/, '')).join(', ');
    try { await navigator.clipboard?.writeText(text); } catch (_) {}
    toast?.(`Copied ${_tformChanLabel[kind]}`, _tformChanReadable(kind, vals), 'info', 2200);
  }
  async function _pasteTformChan(kind) {
    let vals = null;
    // Prefer system clipboard (so cross-app paste works); fall back to the
    // in-app buffer if reading the clipboard fails or the contents aren't a
    // recognisable triplet.
    try {
      const text = await navigator.clipboard?.readText();
      if (text) {
        const parsed = text.split(/[,;\s]+/)
                           .map(s => parseFloat(s.replace(/[°cm]/g, '')))
                           .filter(Number.isFinite);
        if (parsed.length >= 3) vals = parsed.slice(0, 3);
      }
    } catch (_) {}
    if (!vals) vals = _tformBuf[kind];
    if (!vals || vals.length !== 3) {
      toast?.('Nothing to paste', 'Clipboard has no XYZ triplet', 'info', 2000);
      return;
    }
    const inputs = _tformChanInputs(kind);
    let n = 0;
    inputs.forEach((inp, i) => {
      if (!inp || inp.disabled) return;
      inp.value = parseFloat(vals[i].toFixed(6)).toString();
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      n++;
    });
    if (n) toast?.(`Pasted ${_tformChanLabel[kind]}`, _tformChanReadable(kind, vals), 'info', 2200);
  }
  function _resetTformChan(kind) {
    const identity = kind === 'scale' ? 1 : 0;
    const inputs = _tformChanInputs(kind);
    let n = 0;
    inputs.forEach(inp => {
      if (!inp || inp.disabled) return;
      inp.value = String(identity);
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      n++;
    });
    if (n) toast?.(`Reset ${_tformChanLabel[kind]}`, '', 'info', 1600);
  }
  document.getElementById('tform-grid')?.addEventListener('contextmenu', (e) => {
    const lbl = e.target.closest('.tform-col-label[data-tform-col]');
    if (!lbl) return;
    e.preventDefault();
    e.stopPropagation();
    const kind = lbl.dataset.tformCol;          // 'pos' | 'rot' | 'scale'
    const channelTitle = lbl.textContent;       // 'Position' / 'Rotation' / 'Size'
    const vals = _tformChanValues(kind);
    const live = vals.every(Number.isFinite);
    const items = [
      { icon: 'copy',     label: `Copy ${channelTitle} XYZ`,   kbd: live ? _tformChanReadable(kind, vals) : '',
        fn: () => _copyTformChan(kind) },
      { icon: 'clipboard-paste', label: `Paste ${channelTitle} XYZ`,
        fn: () => _pasteTformChan(kind) },
      '---',
      { icon: 'rotate-ccw', label: `Reset ${channelTitle}`,    fn: () => _resetTformChan(kind) },
    ];
    _ctxBuild(items, e.clientX, e.clientY);
  });
}

// While the panel is open, poll once per frame so any source of transform
// change — gizmo drag, programmatic move, undo/redo, gizmo end-of-drag
// re-attach — surfaces in the inputs without us having to discover and
// hook every site that mutates the transform. Cheap: ~1 read of obj.matrix
// + a handful of toFixed calls per frame.
let _transformPollHandle = null;
let _transformPollLast = '';
function _transformPollLoop() {
  _transformPollHandle = requestAnimationFrame(_transformPollLoop);
  const panel = document.getElementById('transform-panel');
  if (!panel || !panel.classList.contains('show')) return;
  const target = _transformTarget();
  if (!target) {
    if (_transformPollLast !== '') { _transformPollLast = ''; _transformPanelRefresh(); }
    return;
  }
  // Cheap signature: detect any change to position/rotation/scale.
  // For groups the container object (hn.obj3d / ug.ref) may not move even
  // when the parts inside do (they live in partsRoot, not under the container).
  // In that case hash the pivot's matrix and the first selected part instead.
  const obj = target.obj;
  const isGroupTarget = target.kind === 'group' || target.kind === 'user-group';
  let sig;
  if (isGroupTarget) {
    const pm = state.pivot?.matrixWorld?.elements;
    const firstId = state.selected ? [...state.selected][0] : null;
    const fp = firstId != null && typeof getPart === 'function' ? getPart(firstId) : null;
    fp?.mesh?.updateMatrixWorld?.(true);
    const fm = fp?.mesh?.matrixWorld?.elements;
    const pp = pm ? pm[12].toFixed(3)+','+pm[13].toFixed(3)+','+pm[14].toFixed(3) : '0,0,0';
    const fp2 = fm ? fm[12].toFixed(3)+','+fm[13].toFixed(3)+','+fm[14].toFixed(3) : '0,0,0';
    sig = pp + '|' + fp2;
  } else {
    obj.updateMatrixWorld?.(true);
    const m = obj.matrixWorld?.elements;
    if (!m) return;
    sig = m[12].toFixed(4)+','+m[13].toFixed(4)+','+m[14].toFixed(4)+'|'+m[0].toFixed(4)+','+m[5].toFixed(4)+','+m[10].toFixed(4)+','+m[1].toFixed(4)+','+m[2].toFixed(4)+','+m[6].toFixed(4);
  }
  if (sig !== _transformPollLast) {
    _transformPollLast = sig;
    _transformPanelRefresh();
  }
}
function _startTransformPoll() {
  if (_transformPollHandle != null) return;
  _transformPollLast = '';
  _transformPollLoop();
}
function _stopTransformPoll() {
  if (_transformPollHandle != null) { cancelAnimationFrame(_transformPollHandle); _transformPollHandle = null; }
}

function _toggleTransformPanel() {
  const btn = document.getElementById('tg-transform');
  const panel = document.getElementById('transform-panel');
  if (!panel) return;
  _wireTransformPanel();
  const open = panel.classList.toggle('show');
  btn?.classList.toggle('active', open);
  if (open) { _transformPanelRefresh(); _startTransformPoll(); }
  else _stopTransformPoll();
}

// Hook the transform panel refresh into refreshPropertiesPanel so it
// stays in sync with every selection change (the same site that already
// fires for prop-panel updates).
const _origRefreshPropsPanel_tform = refreshPropertiesPanel;
refreshPropertiesPanel = function() {
  const r = _origRefreshPropsPanel_tform.apply(this, arguments);
  try { _transformPanelRefresh(); } catch (_) {}
  return r;
};

function _applyShadows() {
  if (!renderer || !state._lights?.dir) return;
  const on = !!state.shadowsEnabled;
  try { if (renderer.shadowMap) renderer.shadowMap.enabled = on; } catch (_) {}
  const dir = state._lights.dir;
  dir.castShadow = on;
  if (on && dir.shadow) {
    const diag = Math.max(state.modelDiag, 100);
    dir.shadow.mapSize?.set?.(2048, 2048);
    if (dir.shadow.camera) {
      dir.shadow.camera.near = diag * 0.01;
      dir.shadow.camera.far  = diag * 4;
      const half = diag;
      dir.shadow.camera.left = -half; dir.shadow.camera.right = half;
      dir.shadow.camera.top = half;   dir.shadow.camera.bottom = -half;
      dir.shadow.camera.updateProjectionMatrix?.();
    }
  }
  state.partsRoot?.traverse(o => { if (o.isMesh) { o.castShadow = on; o.receiveShadow = on; } });
}

function _applyGridCell() {
  if (!gridHelper || !scene) return;
  if (state.gridCellMode === 'auto') {
    const box = new THREE.Box3();
    if (state.partsRoot) box.setFromObject(state.partsRoot);
    if (!box.isEmpty()) _fitGridToModel(box);
    return;
  }
  const cell = parseFloat(state.gridCellMode);
  if (!isFinite(cell) || cell <= 0) return;
  const size = cell * 20;
  const newGrid = new THREE.GridHelper(size, 20, 0x3a4358, 0x232938);
  if (state.sceneUpAxis === 'z') newGrid.rotation.x = Math.PI / 2;
  newGrid.material.transparent = true;
  newGrid.material.opacity = 0.45;
  newGrid.visible = state.showGrid;
  scene.remove(gridHelper);
  gridHelper.geometry?.dispose?.();
  gridHelper.material?.dispose?.();
  gridHelper = newGrid;
  scene.add(gridHelper);
}

function _applySnap() {
  if (!state.gizmo) return;
  if (state.snapToGrid) {
    const cell = (state.gridCellMode === 'auto') ? 10 : parseFloat(state.gridCellMode) || 10;
    state.gizmo.translationSnap = cell;
    state.gizmo.rotationSnap = Math.PI / 12;
  } else {
    state.gizmo.translationSnap = null;
    state.gizmo.rotationSnap = null;
  }
}

// ── Orientation gizmo (bottom-left) ─────────────────────────────────────────
// SVG-based: zero GPU cost, refreshed only when the viewport renders.
const _AXG = {
  built: false,
  m3: new THREE.Matrix3(),
  v: new THREE.Vector3(),
  colors: { x: '#ff5d6c', y: '#5cd673', z: '#5fa8ff' },
  // line endpoint length (svg coords; viewBox is -44..44)
  R_LINE: 22,
  // handle distance from origin
  R_HANDLE: 32,
};
function buildAxisGizmo() {
  const svg = document.getElementById('axis-gizmo-svg');
  if (!svg || _AXG.built) return;
  const c = _AXG.colors;
  let html = '';
  // Origin dot
  html += `<circle cx="0" cy="0" r="2" fill="#9aa4b2"/>`;
  // Three axis lines (positive direction only)
  for (const a of ['x', 'y', 'z']) {
    html += `<line id="axg-line-${a}" x1="0" y1="0" x2="0" y2="0" stroke="${c[a]}" stroke-width="2.4" stroke-linecap="round"/>`;
  }
  // Three handles: positive axes only — filled disc + white label.
  for (const a of ['x', 'y', 'z']) {
    const id = 'p' + a;
    html += `<g class="axg-handle" id="axg-h-${id}" data-axis="${id}" style="cursor:pointer">
      <circle r="9" fill="${c[a]}" stroke="${c[a]}" stroke-width="1.6"/>
      <text text-anchor="middle" dominant-baseline="central" font-size="10" font-weight="700" fill="#fff">${a.toUpperCase()}</text>
    </g>`;
  }
  svg.innerHTML = html;
  svg.querySelectorAll('.axg-handle').forEach(el => {
    el.addEventListener('click', ev => { ev.stopPropagation(); alignViewToAxis(el.dataset.axis); });
  });
  _AXG.built = true;
}
function updateAxisGizmo() {
  if (!_AXG.built || !camera) return;
  const svg = document.getElementById('axis-gizmo-svg');
  if (!svg) return;
  // Camera-space projection: world axes → view space (rotation only).
  _AXG.m3.setFromMatrix4(camera.matrixWorldInverse);
  const project = (x, y, z) => {
    _AXG.v.set(x, y, z).applyMatrix3(_AXG.m3);
    return { x: _AXG.v.x, y: -_AXG.v.y, z: _AXG.v.z }; // SVG y is flipped
  };
  const dirs = {
    px: project(1, 0, 0),
    py: project(0, 1, 0),
    pz: project(0, 0, 1),
  };
  // Lines: positive end only.
  // In Three.js view space the camera looks down -Z, so a direction whose
  // view-space z is POSITIVE points toward the viewer (out of the screen)
  // and should stay bright; negative z points into the screen → dim.
  for (const a of ['x', 'y', 'z']) {
    const line = document.getElementById(`axg-line-${a}`);
    const p = dirs['p' + a];
    line.setAttribute('x2', (p.x * _AXG.R_LINE).toFixed(2));
    line.setAttribute('y2', (p.y * _AXG.R_LINE).toFixed(2));
    line.style.opacity = p.z < 0 ? 0.32 : 1;
  }
  // Handles: depth-sort so the farthest (most negative z) is painted first
  // and the nearest (most positive z) ends up on top of the stack.
  const order = Object.keys(dirs).sort((a, b) => dirs[a].z - dirs[b].z);
  for (const id of order) {
    const g = document.getElementById('axg-h-' + id);
    const p = dirs[id];
    g.setAttribute('transform', `translate(${(p.x * _AXG.R_HANDLE).toFixed(2)},${(p.y * _AXG.R_HANDLE).toFixed(2)})`);
    g.style.opacity = p.z < 0 ? 0.42 : 1;
    svg.appendChild(g);
  }
}
function alignViewToAxis(axisId) {
  if (!camera || !controls) return;
  const sign = axisId[0] === 'p' ? 1 : -1;
  const ax = axisId[1];
  const dir = new THREE.Vector3(
    ax === 'x' ? sign : 0,
    ax === 'y' ? sign : 0,
    ax === 'z' ? sign : 0
  );
  // Keep the current orbit distance so the model stays the same size.
  const dist = camera.position.distanceTo(controls.target) || state.modelDiag * 1.5 || 100;
  camera.position.copy(controls.target).add(dir.multiplyScalar(dist));
  // Use Y-up only when looking straight down/up the Z axis (top/bottom views);
  // every other view keeps the CAD-standard Z-up convention.
  if (ax === 'z') camera.up.set(0, 1, 0);
  else camera.up.set(0, 0, 1);
  camera.lookAt(controls.target);
  controls.update();
  requestRender();
}

function rebuildTree() {
  const root = $('tree');
  // The fresh DOM has different rows; the cached selection diff would point
  // at detached nodes. Wipe the index + cache so the next selection refresh
  // takes the cold path on the new DOM.
  root._selIndex = null;
  _invalidateTreeSelCache();
  root.innerHTML = '';
  if (state.parts.length === 0) {
    root.innerHTML = `<div class="tree-empty">No parts</div>`;
    $('tree-summary').textContent = 'No model loaded';
    return;
  }
  // Prefer hierarchical tree when available — built by _buildHierarchyFromScene
  // from the GLB scene graph. Falls back to flat for legacy GLBs and any state
  // where treeNodes is empty (cleaning ops that wipe state.parts deliberately
  // don't rebuild treeNodes — they're effectively flat after that).
  if (state.treeNodes && state.treeNodes.length) {
    return _rebuildTreeHierarchical();
  }
  const ft = ($('tree-filter').value || '').toLowerCase();
  const visible = state.parts.filter(p => !p.deleted && (!ft || p.name.toLowerCase().includes(ft)));
  $('tree-summary').textContent = `${visible.length} of ${state.parts.filter(p => !p.deleted).length} parts`;
  const frag = document.createDocumentFragment();
  const MAX = 5000;
  for (let i = 0; i < Math.min(visible.length, MAX); i++) {
    const p = visible[i];
    const node = document.createElement('div');
    node.className = 'tree-node';
    if (state.selected.has(p.partId)) node.classList.add('selected');
    if (!p.visible) node.classList.add('hidden-vis');
    if (p.flagged) node.classList.add('flagged');
    node.dataset.partId = p.partId;
    const colorHex = '#' + p.originalColor.getHexString();
    const eye = p.visible
      ? `<i data-lucide="eye"></i>`
      : `<i data-lucide="eye-off"></i>`;
    const inst = _instBadge(p.group ? p.group.parts.length : 0);
    node.innerHTML = `<span class="tree-label">${escapeHtml(p.name)}${inst}</span><span class="tree-meta">${fmtNum(p.triCount)} tri</span><span class="tree-iconcol"><span class="tree-vis">${eye}</span><span class="tree-color" style="background:${colorHex}"></span></span>`;
    frag.appendChild(node);
  }
  root.appendChild(frag);
  if (visible.length > MAX) {
    const more = document.createElement('div');
    more.style.cssText = 'padding:8px 14px;color:var(--tx3);font-size:11px;';
    more.textContent = `... ${fmtNum(visible.length - MAX)} more parts (use search)`;
    root.appendChild(more);
  }
}

// Hierarchical renderer. Walks state.treeNodes (a flat DFS order with depth +
// parentId on each entry) and emits one .tree-node row per visible entry,
// indenting by depth. Group rows show a chevron and respect collapse state.
function _rebuildTreeHierarchical() {
  const root = $('tree');
  const ft = ($('tree-filter').value || '').toLowerCase();
  const all = state.treeNodes;
  // Filter pass: when a search filter is active, find every part row that
  // matches and force its ancestors visible (otherwise the filter would hide
  // the whole tree). Stored in a Set of treeNode ids that should be shown.
  let visibleIds = null;
  if (ft) {
    visibleIds = new Set();
    const byId = new Map();
    for (const n of all) byId.set(n.id, n);
    for (const n of all) {
      if (n.kind !== 'part') continue;
      const p = getPart(n.partId);
      if (!p || p.deleted) continue;
      if (p.name.toLowerCase().includes(ft)) {
        let cur = n;
        while (cur) {
          if (visibleIds.has(cur.id)) break;
          visibleIds.add(cur.id);
          cur = cur.parentId != null ? byId.get(cur.parentId) : null;
        }
      }
    }
  }
  const collapsed = state.treeCollapsed;
  let totalParts = 0, shownParts = 0;
  const frag = document.createDocumentFragment();
  const MAX = 20000;
  let emitted = 0;

  // ── Always emit every row, hide collapsed subtrees via CSS ─────────────
  // The previous approach skipped descendants of collapsed groups during
  // DOM build. That made each toggle require a full rebuildTree (and a
  // _lucide() pass that replaces ~20k icon placeholders with SVGs — the
  // single biggest cost on a 9700-node tree). By emitting all rows up
  // front and just toggling a `.is-hidden` class on subtrees, toggles
  // become O(subtree size) DOM-class flips with no Lucide work — sub-10ms.
  //
  // Each row carries:
  //   data-depth         — its depth in the hierarchy (for subtree walking)
  //   data-ancestor-groups — space-separated group ids it lives under
  // _toggleGroupCollapseFast uses both to find a row's subtree and to
  // recompute its visibility from the (mutated) state.treeCollapsed set.
  //
  // Pre-pass: aggregate visibility per group so the folder eye icon reflects
  // the actual state of its descendants. A group counts as "visible" when at
  // least one descendant part is visible (matches Cinema 4D behaviour). The
  // pre-pass is cheap (single forward sweep, ancestor stack already needed).
  const groupAnyVisible = new Map();
  // groupAnyAlive: at least one descendant part is NOT deleted. Groups whose
  // entire subtree was deleted should vanish from the tree (otherwise the
  // user sees a phantom container — "I deleted everything but the parent
  // stuck around"). Tracked separately from groupAnyVisible because a group
  // can be "all hidden but not deleted" (legitimately rendered, just dimmed).
  const groupAnyAlive = new Map();
  {
    const stack = [];
    for (const n of all) {
      while (stack.length && stack[stack.length - 1].depth >= n.depth) stack.pop();
      if (n.kind === 'group') {
        if (!groupAnyVisible.has(n.id)) groupAnyVisible.set(n.id, false);
        if (!groupAnyAlive.has(n.id))   groupAnyAlive.set(n.id, false);
        stack.push({ id: n.id, depth: n.depth });
      } else if (n.kind === 'part') {
        const p = getPart(n.partId);
        if (p && !p.deleted) {
          for (const a of stack) groupAnyAlive.set(a.id, true);
          if (p.visible) {
            for (const a of stack) groupAnyVisible.set(a.id, true);
          }
        }
      }
    }
  }

  // ── Ancestor highlight (C4D-style) ───────────────────────────────────
  // When the user clicks a part (or a group), every ancestor group up to the
  // root gets a subdued highlight so they can quickly trace the selection
  // back up the tree. Compute the set once here; each group row later checks
  // membership and adds an `ancestor-selected` class.
  const ancestorSelected = new Set();
  {
    const byIdAS = new Map();
    const partNodeByPartId = new Map();
    for (const n of all) {
      byIdAS.set(n.id, n);
      if (n.kind === 'part') partNodeByPartId.set(n.partId, n);
    }
    const walkAncestors = (id) => {
      const cur = byIdAS.get(id);
      if (!cur) return;
      let p = cur.parentId != null ? byIdAS.get(cur.parentId) : null;
      while (p) {
        if (ancestorSelected.has(p.id)) break;
        ancestorSelected.add(p.id);
        p = p.parentId != null ? byIdAS.get(p.parentId) : null;
      }
    };
    for (const partId of (state.selected || [])) {
      const n = partNodeByPartId.get(partId);
      if (n) walkAncestors(n.id);
    }
    for (const gid of (state.selectedGroupIds || [])) walkAncestors(gid);
  }

  // Build the running ancestor stack as we walk the DFS-ordered list.
  const ancestorStack = []; // group ids of currently-open ancestors
  const partInGroup = new Set();   // parts whose ancestor is collapsed (for shownParts count)
  for (const n of all) {
    // Maintain ancestor stack: pop until top of stack is at depth < n.depth
    while (ancestorStack.length && ancestorStack[ancestorStack.length - 1].depth >= n.depth) {
      ancestorStack.pop();
    }
    if (n.kind === 'part') totalParts++;
    let searchHidden = visibleIds && !visibleIds.has(n.id);
    if (n.kind === 'part') {
      const p = getPart(n.partId);
      if (!p || p.deleted) searchHidden = true;
    }
    // collapseHidden: ANY ancestor group is in state.treeCollapsed
    let collapseHidden = false;
    for (const a of ancestorStack) {
      if (collapsed.has(a.id)) { collapseHidden = true; break; }
    }
    // emptyGroupHidden: this group has no surviving (non-deleted) parts in
    // its subtree. Skip — phantom empty containers confuse users into
    // thinking delete didn't work.
    let emptyGroupHidden = false;
    if (n.kind === 'group' && groupAnyAlive.get(n.id) === false) emptyGroupHidden = true;
    const hidden = searchHidden || collapseHidden || emptyGroupHidden;
    if (emitted < MAX) {
      const row = document.createElement('div');
      row.className = 'tree-node';
      if (hidden) row.classList.add('is-hidden');
      // Indent base is a fixed 8px on the left so depth-0 rows aren't flush
      // with the panel edge. Per-depth indent comes from inline .tree-line
      // spans below.
      row.style.paddingLeft = '8px';
      row.dataset.depth = String(n.depth);
      // Space-separated ancestor group ids — empty string for top-level rows.
      // Used by _toggleGroupCollapseFast to recompute visibility on toggle.
      row.dataset.ancestorGroups = ancestorStack.map(a => a.id).join(' ');
      // Build the per-row indent prefix: N-1 plain vertical lines plus a
      // single elbow connector at this row's own depth. Stitched once per
      // row via string concat so it stays under the rebuild's frag-append
      // budget on big trees.
      let indentHtml = '';
      for (let d = 0; d < n.depth - 1; d++) indentHtml += '<span class="tree-line"></span>';
      if (n.depth > 0) indentHtml += '<span class="tree-line elbow"></span>';

      if (n.kind === 'group') {
        row.classList.add('is-group', 'is-asm');
        row.dataset.groupId = n.id;
        // Re-apply the selected highlight on rebuild so it survives expand /
        // collapse / search filter.
        if (state.selectedGroupIds.has(n.id)) row.classList.add('selected');
        else if (ancestorSelected.has(n.id)) row.classList.add('ancestor-selected');
        const isCollapsed = collapsed.has(n.id);
        if (isCollapsed) row.classList.add('collapsed');
        // C4D-style row: small +/- box, colored type icon, colored label.
        // 'archive' icon reads as "container of stuff" without colliding
        // visually with the leaf 'box' icon.
        const sign = isCollapsed ? '+' : '−';
        const grpVisible = groupAnyVisible.get(n.id) !== false;
        if (!grpVisible) row.classList.add('hidden-vis');
        const grpEye = grpVisible ? `<i data-lucide="eye"></i>` : `<i data-lucide="eye-off"></i>`;
        row.innerHTML = indentHtml +
          `<span class="tree-expand" data-toggle="${n.id}">${sign}</span>` +
          `<span class="tree-typeicon asm"><i data-lucide="archive"></i></span>` +
          `<span class="tree-label">${escapeHtml(n.name)}</span>` +
          `<span class="tree-iconcol"><span class="tree-vis" data-act="vis">${grpEye}</span></span>`;
      } else {
        const p = getPart(n.partId);
        row.classList.add('is-part');
        if (state.selected.has(p.partId)) row.classList.add('selected');
        // Subdued highlight for parts whose ancestor group is currently clicked
        // (so the user can visually trace the group's contents). Different
        // class so the CSS can paint these rows at half intensity — matches
        // the C4D pattern of "primary = clicked, secondary = related".
        else if (state.selectedGroupIds && state.selectedGroupIds.size) {
          for (const a of ancestorStack) {
            if (state.selectedGroupIds.has(a.id)) { row.classList.add('ancestor-selected'); break; }
          }
        }
        if (!p.visible) row.classList.add('hidden-vis');
        if (p.flagged) row.classList.add('flagged');
        row.dataset.partId = p.partId;
        const colorHex = '#' + p.originalColor.getHexString();
        const eye = p.visible ? `<i data-lucide="eye"></i>` : `<i data-lucide="eye-off"></i>`;
        // Two sources of instance count: (a) hashCount captured at hierarchy
        // build time, (b) p.group from the live _autoInstanceFromGLB pass.
        // Both should agree but (b) is the authoritative live one.
        const instN = (p.group && p.group.parts) ? p.group.parts.length : (n.instanceCount || 0);
        const inst = _instBadge(instN);
        // Instances get a purple icon so the icon + badge share a color
        // language ("this is one of N copies"). Singletons get the green box.
        const iconCls = instN > 1 ? 'inst' : 'part';
        const iconName = instN > 1 ? 'copy' : 'box';
        if (instN > 1) row.classList.add('is-inst');
        // tree-expand-spacer keeps leaf rows aligned with parent +/- boxes.
        row.innerHTML = indentHtml +
          `<span class="tree-expand-spacer"></span>` +
          `<span class="tree-typeicon ${iconCls}"><i data-lucide="${iconName}"></i></span>` +
          `<span class="tree-label">${escapeHtml(n.name || _stripFrameSuffix(p.name))}${inst}</span>` +
          `<span class="tree-meta">${fmtNum(p.triCount)} tri</span>` +
          `<span class="tree-iconcol">` +
            `<span class="tree-vis">${eye}</span>` +
            `<span class="tree-color" style="background:${colorHex}"></span>` +
          `</span>`;
        if (!hidden) shownParts++;
      }
      frag.appendChild(row);
      emitted++;
    }
    // Push group onto ancestor stack AFTER emitting its own row, so
    // descendants pick it up but the group itself doesn't include itself.
    if (n.kind === 'group') {
      ancestorStack.push({ id: n.id, depth: n.depth });
    }
  }
  root.appendChild(frag);
  $('tree-summary').textContent = ft
    ? `${shownParts} match in ${totalParts} parts`
    : `${totalParts} parts in hierarchy`;
  if (emitted >= MAX) {
    const more = document.createElement('div');
    more.style.cssText = 'padding:8px 14px;color:var(--tx3);font-size:11px;';
    more.textContent = `... display capped at ${fmtNum(MAX)} rows (use search to narrow)`;
    root.appendChild(more);
  }
  _lucide();
}

// ── Fast collapse/expand toggle ──────────────────────────────────────────
// Walks the toggled group's subtree in DOM order (rows are in DFS order;
// subtree ends when we hit a row at depth <= group's depth). For each
// descendant row, recompute is-hidden from state.treeCollapsed by checking
// its ancestor-groups list. No DOM creation, no Lucide pass — the heavy
// work that made plain rebuildTree() take ~1 second on a 9700-node tree.
function _toggleGroupCollapseFast(gid) {
  const wasCollapsed = state.treeCollapsed.has(gid);
  if (wasCollapsed) state.treeCollapsed.delete(gid);
  else state.treeCollapsed.add(gid);

  const treeEl = $('tree');
  if (!treeEl) return;
  const groupEl = treeEl.querySelector(`.tree-node.is-group[data-group-id="${gid}"]`);
  if (!groupEl) return;
  groupEl.classList.toggle('collapsed', !wasCollapsed);
  // Swap the +/− character on the expand box. New rendering uses literal
  // glyphs instead of the old CSS-rotated ▼; keep them in sync on toggle.
  const exp = groupEl.querySelector('.tree-expand');
  if (exp) exp.textContent = wasCollapsed ? '−' : '+';

  const groupDepth = parseInt(groupEl.dataset.depth || '0', 10);
  let cur = groupEl.nextElementSibling;
  while (cur) {
    if (!cur.classList || !cur.classList.contains('tree-node')) {
      cur = cur.nextElementSibling; continue;
    }
    const curDepth = parseInt(cur.dataset.depth || '0', 10);
    if (curDepth <= groupDepth) break;     // exited subtree
    // Recompute hidden flag: any ancestor in collapsed set?
    const anc = (cur.dataset.ancestorGroups || '').split(' ');
    let hide = false;
    for (let i = 0; i < anc.length; i++) {
      if (!anc[i]) continue;
      if (state.treeCollapsed.has(parseInt(anc[i], 10))) { hide = true; break; }
    }
    cur.classList.toggle('is-hidden', hide);
    cur = cur.nextElementSibling;
  }
}

// Strip the trailing _NNNNNN uniqueness suffix that step2glb.py appends to
// every glTF node name (so trimesh's scene-graph names can't collide). Pure
// display-side cleanup — keeps the underlying name attribute intact for
// debugging. Matches one or more digits after a final underscore at end of
// string. Example: "Bracket_Assembly_000123" → "Bracket_Assembly".
function _stripFrameSuffix(s) {
  if (!s) return s;
  return String(s).replace(/_\d{4,}$/, '');
}

// Render a small "this part is shared geometry" badge: lucide copy icon
// plus the occurrence count. Used by every tree renderer (hierarchical,
// flat, enhanced flat) so the visual is consistent. Returns empty string
// for n < 2 (singletons don't get a badge).
function _instBadge(n) {
  if (!n || n < 2) return '';
  // data-act so the tree click handler can intercept and select all sibling
  // instances. Title hints the click action.
  return `<span class="tree-inst" data-act="select-instances" title="${n} occurrences share this geometry — click to select all">` +
         `<i data-lucide="copy"></i>×${n}</span>`;
}

// Collect every part-id descendant of a group node in state.treeNodes.
// Walks forward from the group's index until depth drops back to or below
// the group's depth — that's the boundary of the group's subtree (treeNodes
// is in DFS order). Returns the list of partIds, no group ids.
function _treeGroupDescendants(groupId) {
  const all = state.treeNodes;
  if (!all || !all.length) return [];
  const startIdx = all.findIndex(n => n.id === groupId);
  if (startIdx === -1) return [];
  const groupDepth = all[startIdx].depth;
  const out = [];
  for (let i = startIdx + 1; i < all.length; i++) {
    const n = all[i];
    if (n.depth <= groupDepth) break;  // exited the subtree
    if (n.kind === 'part') {
      const p = getPart(n.partId);
      if (p && !p.deleted) out.push(n.partId);
    }
  }
  return out;
}

// Minimal HTML escape for names that may contain CAD-special characters.
function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// Diff-based selection class toggle. The naive version iterated every tree
// row (often 5000+) on every selection change, even single-clicks. We now
// track the previously-applied set and only touch rows whose state changed.
// On rebuildTree() the cache is invalidated (different rows, fresh state).
let _treeSelCache = null;          // Set<partId> we last applied to
let _treeGroupSelCache = null;     // Set<groupId> we last applied to
function _invalidateTreeSelCache() { _treeSelCache = null; _treeGroupSelCache = null; }
// Compute the set of group ids whose subtree contains a selected part. Used
// to "breadcrumb" the selection: every ancestor of a selected leaf gets the
// `selected` class so the user can visually trace where the selection sits
// in deeply-nested trees. Mixed-type set: numeric ids for hier groups, string
// ids for userGroups.
function _computeAncestorGroupHighlights() {
  const out = new Set();
  if (!state.selected || state.selected.size === 0) return out;
  if (state.treeNodes && state.treeNodes.length) {
    const stack = [];
    for (const n of state.treeNodes) {
      while (stack.length && stack[stack.length - 1].depth >= n.depth) stack.pop();
      if (n.kind === 'part' && state.selected.has(n.partId)) {
        for (const a of stack) out.add(a.id);
      }
      if (n.kind === 'group') stack.push({ id: n.id, depth: n.depth });
    }
  }
  if (state.userGroups && state.userGroups.length) {
    for (const pid of state.selected) {
      for (const g of state.userGroups) {
        if (g.partIds.has(pid)) { out.add(g.id); break; }
      }
    }
  }
  return out;
}

function rebuildTreeSelectionOnly() {
  const treeEl = $('tree');
  if (!treeEl) return;
  const next = state.selected;
  // Two tiers of group highlight:
  //   nextGFull = directly clicked groups → full-intensity yellow (.selected)
  //   nextGAnc  = ancestors of any selected part/group → subdued (.ancestor-selected)
  const explicitG = state.selectedGroupIds || new Set();
  const ancestorG = _computeAncestorGroupHighlights();
  const nextGFull = new Set(explicitG);
  const nextGAnc = new Set();
  for (const x of ancestorG) if (!nextGFull.has(x)) nextGAnc.add(x);
  // Parts whose ancestor group is explicitly clicked also get the subdued
  // ancestor-selected class so the user can see the group's contents at a
  // glance without losing the "primary = clicked" cue.
  // Compute these by walking treeNodes once.
  const ancestorPartSet = new Set();
  if (explicitG.size && state.treeNodes && state.treeNodes.length) {
    const all = state.treeNodes;
    let depth0 = -1;
    let activeAncestor = null;
    const stack = [];
    for (const n of all) {
      while (stack.length && stack[stack.length - 1].depth >= n.depth) stack.pop();
      if (n.kind === 'group') stack.push({ id: n.id, depth: n.depth });
      else if (n.kind === 'part') {
        for (const a of stack) if (explicitG.has(a.id)) { ancestorPartSet.add(n.partId); break; }
      }
    }
  }

  // Cold path — first call after a tree rebuild; do the full sweep AND seed
  // the cache so subsequent calls hit the fast path.
  if (!_treeSelCache) {
    _treeSelCache = new Set();
    _treeGroupSelCache = new Set();
    for (const node of treeEl.children) {
      if (!node.dataset) continue;
      if (node.dataset.partId) {
        const id = parseInt(node.dataset.partId, 10);
        const on = next.has(id);
        node.classList.toggle('selected', on);
        node.classList.toggle('ancestor-selected', !on && ancestorPartSet.has(id));
        if (on) _treeSelCache.add(id);
      } else if (node.dataset.groupId) {
        const gid = parseInt(node.dataset.groupId, 10);
        const on = nextGFull.has(gid);
        node.classList.toggle('selected', on);
        node.classList.toggle('ancestor-selected', !on && nextGAnc.has(gid));
        if (on) _treeGroupSelCache.add(gid);
      }
    }
    return;
  }
  // Fast path — diff only. Build a cheap id→row index from state so we can
  // O(1) into the DOM by partId rather than scanning every child.
  // (One-time DOM scan to build the index; cached on the tree element.)
  let idx = treeEl._selIndex;
  if (!idx) {
    idx = { parts: new Map(), groups: new Map() };
    for (const node of treeEl.children) {
      if (!node.dataset) continue;
      if (node.dataset.partId)  idx.parts.set(parseInt(node.dataset.partId, 10), node);
      else if (node.dataset.groupId) idx.groups.set(parseInt(node.dataset.groupId, 10), node);
    }
    treeEl._selIndex = idx;
  }
  // Diff parts. Doing a per-row toggle is the simple correct path for ancestor
  // updates; cache only tracks the explicit-selected set.
  for (const id of _treeSelCache) {
    if (!next.has(id)) {
      const r = idx.parts.get(id);
      if (r) {
        r.classList.remove('selected');
        r.classList.toggle('ancestor-selected', ancestorPartSet.has(id));
      }
    }
  }
  for (const id of next) {
    if (!_treeSelCache.has(id)) {
      const r = idx.parts.get(id);
      if (r) { r.classList.add('selected'); r.classList.remove('ancestor-selected'); }
    }
  }
  // Sweep ancestor classes for parts that are unrelated to the new selection
  // — cheap because parts is bounded by part count and most don't have the class.
  for (const [id, r] of idx.parts) {
    if (next.has(id)) continue;
    r.classList.toggle('ancestor-selected', ancestorPartSet.has(id));
  }
  for (const gid of _treeGroupSelCache) {
    if (!nextGFull.has(gid)) {
      const r = idx.groups.get(gid);
      if (r) r.classList.remove('selected');
    }
  }
  for (const gid of nextGFull) {
    if (!_treeGroupSelCache.has(gid)) {
      const r = idx.groups.get(gid);
      if (r) { r.classList.add('selected'); r.classList.remove('ancestor-selected'); }
    }
  }
  // Sweep ancestor classes on group rows — same shape as parts.
  for (const [gid, r] of idx.groups) {
    if (nextGFull.has(gid)) continue;
    r.classList.toggle('ancestor-selected', nextGAnc.has(gid));
  }
  _treeSelCache = new Set(next);
  _treeGroupSelCache = new Set(nextGFull);
}

// rAF-coalesce the (expensive) selection-highlight rebuild. Marquee drag,
// rapid Ctrl-click, range-select, and "select all" all fire applySelectionColors
// in the same handler that updates state.selected — without coalescing each
// call rebuilds the merged edge geometry from scratch, which on 1000+ parts
// takes long enough that the user perceives the highlight as appearing seconds
// after their click.
let _selColorsRaf = 0;
function applySelectionColors() {
  if (_selColorsRaf) return;
  _selColorsRaf = requestAnimationFrame(() => {
    _selColorsRaf = 0;
    _applySelectionColorsImpl();
  });
}
// Hard caps on highlight counts. With thousands of selected parts, the cost
// is dominated by EdgesGeometry construction (one per unique geometry) and
// LineSegments allocation. Above the cap we still set the tree styling so the
// user sees what's selected; the viewport just doesn't draw the cyan outline
// for every single one.
const MAX_SELECTION_HIGHLIGHTS = 1500;
const MAX_FLAGGED_HIGHLIGHTS   = 2500;

// Edges cache keyed by source BufferGeometry. Was `geom.userData._edges`,
// but three.js EdgesGeometry stores a reference back to the source geometry
// in its `parameters` field — userData → _edges → parameters → geometry
// closes a cycle that breaks JSON.stringify (and so GLTFExporter). A WeakMap
// avoids polluting userData and auto-releases entries when their key geom
// is GC'd. Keep the value disposed manually before delete (WeakMap doesn't
// give us hooks for finalization).
const _edgesCache = new WeakMap();
function _getEdgesGeom(g) {
  let e = _edgesCache.get(g);
  if (e) return e;
  try { e = new THREE.EdgesGeometry(g, 30); }
  catch (_) { return null; }
  _edgesCache.set(g, e);
  return e;
}
function _disposeEdgesFor(g) {
  const e = _edgesCache.get(g);
  if (e) { e.dispose?.(); _edgesCache.delete(g); }
}

// Shared materials for highlight overlays — re-used across every highlighted
// part instead of allocating one per part. Allocating thousands of identical
// Materials per click was a real GC + GPU pipeline hit on big assemblies.
// Two-pass selection outline so the user can see the selection through other
// meshes (industry-standard CAD treatment used by Blender / Fusion 360 /
// SolidWorks).
//   FRONT pass — depthTest=true, full opacity. Edges that aren't occluded
//                draw crisp and bright at their actual position.
//   BEHIND pass — depthTest=false, lower opacity. Same edges but always on
//                top of the depth buffer; for the parts of the selection
//                that ARE occluded this is the only pass that lights up,
//                producing a dim "x-ray" silhouette through the occluder.
// Render order: BEHIND first (998) so it's painted under the FRONT pass; the
// FRONT pass (999) then writes its full-strength edges on top wherever the
// edge would naturally be visible. The result is depth-aware: visible edges
// pop, occluded edges fade — much more readable than a flat overlay that
// would also glow on the back-facing edges of the selected part itself.
const _SEL_LINE_MAT        = new THREE.LineBasicMaterial({ color: 0x00ddff, transparent: true, opacity: 0.95, depthTest: true,  depthWrite: false });
const _SEL_LINE_MAT_BEHIND = new THREE.LineBasicMaterial({ color: 0x00ddff, transparent: true, opacity: 0.35, depthTest: false, depthWrite: false });
const _FLAG_FILL_MAT = new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.22, depthTest: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });

// Triangle-vert budget for feature edges. Selecting a 5000-part tree with
// 100k tris each used to spend seconds in EdgesGeometry construction; once
// we cross this many edge floats we switch to bbox edges (24 verts/part)
// for any further parts. Numbers chosen so a typical "select every screw"
// stays sharp but a "select whole assembly" degrades to bbox cluster.
const SELECTION_EDGE_VERT_BUDGET = 200000;

// 12 line segments (24 verts × 3 floats = 72) for an AABB. Ordered as
// [bottom 4 edges, 4 verticals, top 4 edges] so the result reads as a
// proper wireframe cube rather than a soup of disconnected segments.
function _bboxEdgeVerts(b) {
  if (!b || b.isEmpty()) return null;
  const x0 = b.min.x, y0 = b.min.y, z0 = b.min.z;
  const x1 = b.max.x, y1 = b.max.y, z1 = b.max.z;
  return new Float32Array([
    // bottom rectangle (z = z0)
    x0,y0,z0, x1,y0,z0,
    x1,y0,z0, x1,y1,z0,
    x1,y1,z0, x0,y1,z0,
    x0,y1,z0, x0,y0,z0,
    // 4 vertical edges
    x0,y0,z0, x0,y0,z1,
    x1,y0,z0, x1,y0,z1,
    x1,y1,z0, x1,y1,z1,
    x0,y1,z0, x0,y1,z1,
    // top rectangle (z = z1)
    x0,y0,z1, x1,y0,z1,
    x1,y0,z1, x1,y1,z1,
    x1,y1,z1, x0,y1,z1,
    x0,y1,z1, x0,y0,z1,
  ]);
}

function _applySelectionColorsImpl() {
  // Fast path: nothing selected, nothing flagged-and-shown, no leftover
  // overlays. Skip the entire teardown + per-part scan. Cuts per-click
  // overhead on large assemblies where most clicks are empty-space deselects.
  const hasOverlays = !!(state.activeHighlights && state.activeHighlights.length);
  const wantsSel    = state.selected && state.selected.size > 0;
  const wantsFlag   = state.highlightSmall;
  if (!hasOverlays && !wantsSel && !wantsFlag) return;

  // ── Tear down previous overlays — defensively, with a try around each
  //    removal. A throw mid-cleanup used to leave half the old highlights
  //    in the scene + half the new ones, which manifested as "the old
  //    highlight stayed in place" the user reported. Materials are shared
  //    across rebuilds so we never dispose them.
  if (state.activeHighlights) {
    for (const h of state.activeHighlights) {
      try { if (h.parent) h.parent.remove(h); } catch (_) {}
    }
  }
  state.activeHighlights = [];
  if (state._selMergedGeom) {
    try { state._selMergedGeom.dispose?.(); } catch (_) {}
    state._selMergedGeom = null;
  }

  // Refresh partsRoot's matrixWorld once. Highlights are parented to
  // partsRoot (see scene.add → partsRoot.add below), so any partsRoot
  // transform — autorotate, scene-scale slider, up-axis swap — auto-
  // applies to the highlight at render time without rebuilding the
  // buffer. We back partsRoot's transform OUT of each part's world
  // matrix so the stored verts are in partsRoot-local space.
  if (state.partsRoot) {
    state.partsRoot.updateMatrix();
    state.partsRoot.updateMatrixWorld(true);
  }
  const partsRootInv = new THREE.Matrix4();
  if (state.partsRoot) partsRootInv.copy(state.partsRoot.matrixWorld).invert();

  const tmpV = new THREE.Vector3();
  const tmpM = new THREE.Matrix4();

  // Pass 1 — collect (epos, partsLocalMatrix) pairs and tally float count.
  // Switches from feature edges to bbox edges once SELECTION_EDGE_VERT_BUDGET
  // is exceeded, so a "select all 5000 parts" call rebuilds in ~10 ms
  // instead of seconds. Once flipped, the rest of the selection uses
  // bbox edges for visual consistency (no mixed precision/coarseness).
  const sources = [];
  let totalFloats = 0;
  let drawn = 0;
  let usedBboxFallback = false;

  for (const id of state.selected) {
    if (drawn >= MAX_SELECTION_HIGHLIGHTS) break;
    const p = getPart(id);
    if (!p || p.deleted || !p.visible) continue;

    let geom = null;
    if (p.mesh) geom = p.mesh.geometry;
    else if (p.instancedMesh) geom = p.instancedMesh.geometry;
    else geom = state.geomByHash.get(p.hash);
    if (!geom) continue;

    // Resolve the part's world matrix. Always live: cached snapshots
    // (_exactWorld) caused stale highlights when the user moved a part
    // through a path that didn't refresh them — most reliably, the
    // transform-tab number inputs and Ctrl+Z partial restores. Live
    // matrixWorld + updateWorldMatrix(true, …) is correct for every
    // path the part can travel, including gizmo drags and explode.
    let world = null;
    if (p.mesh) {
      p.mesh.updateWorldMatrix(true, false);
      world = p.mesh.matrixWorld;
    } else if (p.instancedMesh) {
      p.instancedMesh.updateWorldMatrix(true, false);
      const local = new THREE.Matrix4();
      p.instancedMesh.getMatrixAt(p.instanceIndex, local);
      world = tmpM.multiplyMatrices(p.instancedMesh.matrixWorld, local).clone();
    }
    if (!world) continue;
    const partsLocal = new THREE.Matrix4().multiplyMatrices(partsRootInv, world);

    // Pick the cheaper edge source once we cross the budget.
    let epos = null;
    if (!usedBboxFallback && totalFloats < SELECTION_EDGE_VERT_BUDGET) {
      const edgesGeom = _getEdgesGeom(geom);
      epos = edgesGeom?.attributes?.position?.array || null;
      // Skip parts whose feature-edges blew up on construction (returned null);
      // they'll fall through to the bbox path below for this iteration only.
      if (epos && totalFloats + epos.length > SELECTION_EDGE_VERT_BUDGET) {
        // This part itself fits, but adding the rest would blow the budget.
        // Keep this part on feature-edges; subsequent ones flip to bbox.
        usedBboxFallback = true;
      }
    }
    if (!epos) {
      if (!geom.boundingBox) {
        try { geom.computeBoundingBox(); } catch (_) {}
      }
      epos = _bboxEdgeVerts(geom.boundingBox);
      usedBboxFallback = true;
    }
    if (!epos || epos.length === 0) continue;

    sources.push({ epos, world: partsLocal });
    totalFloats += epos.length;
    drawn++;
  }

  // Pass 2 — fill one Float32Array. Single contiguous allocation; cheap
  // even on multi-MB selections.
  if (totalFloats > 0) {
    const positions = new Float32Array(totalFloats);
    let off = 0;
    for (const s of sources) {
      const epos = s.epos;
      const m = s.world;
      for (let i = 0; i < epos.length; i += 3) {
        tmpV.set(epos[i], epos[i+1], epos[i+2]).applyMatrix4(m);
        positions[off++] = tmpV.x;
        positions[off++] = tmpV.y;
        positions[off++] = tmpV.z;
      }
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    state._selMergedGeom = merged;

    const linesBehind = new THREE.LineSegments(merged, _SEL_LINE_MAT_BEHIND);
    linesBehind.renderOrder = 998;
    linesBehind.frustumCulled = false;
    linesBehind.matrixAutoUpdate = false;

    const lines = new THREE.LineSegments(merged, _SEL_LINE_MAT);
    lines.renderOrder = 999;
    lines.frustumCulled = false;
    lines.matrixAutoUpdate = false;

    // Parent to partsRoot. partsRoot.matrixAutoUpdate=false, so we never
    // pay a per-frame matrix recompute — the highlight rides whatever
    // world matrix partsRoot already has.
    const parent = state.partsRoot || scene;
    parent.add(linesBehind);
    parent.add(lines);
    state.activeHighlights.push(linesBehind, lines);
  }
  if (state.highlightSmall) {
    // Flagged-small overlay still iterates per-part — it's a fill MESH, not
    // line edges, so merging would need face indices + normals rebuild and
    // doesn't share the BVH-friendly properties of the edge buffer. The
    // FLAGGED cap (2500) keeps draw counts bounded.
    const flagMat = new THREE.Matrix4();
    let count = 0;
    for (const p of state.parts) {
      if (p.deleted || !p.visible || !p.flagged || state.selected.has(p.partId)) continue;
      let geom = null, parent = null;
      if (p.mesh) { geom = p.mesh.geometry; parent = p.mesh; }
      else if (p.instancedMesh) geom = p.instancedMesh.geometry;
      else geom = state.geomByHash.get(p.hash);
      if (!geom) continue;
      const overlay = new THREE.Mesh(geom, _FLAG_FILL_MAT);
      overlay.renderOrder = 998;
      overlay.frustumCulled = false;
      if (parent) parent.add(overlay);
      else if (p.instancedMesh) {
        p.instancedMesh.getMatrixAt(p.instanceIndex, flagMat);
        overlay.matrixAutoUpdate = false; overlay.matrix.copy(flagMat);
        scene.add(overlay);
      } else scene.add(overlay);
      state.activeHighlights.push(overlay);
      if (++count >= MAX_FLAGGED_HIGHLIGHTS) break;
    }
  }
  requestRender();
}

// Multi-sample raycasting offsets, in pixels, in concentric rings around the
// click. Order: center first (dead-on hits short-circuit immediately), then
// progressively larger rings (4 → 8 → 12 px), each with 8 samples per ring.
// First ray that hits a part wins. Pure raycasts → no AABB-snap fuzz → no
// random "passes through to wrong part" behaviour, but tiny / thin parts
// (vertical beams etc.) still catch on one of the offset rays even if the
// center misses by several pixels. Total = 25 samples; each is microseconds
// with BVH attached.
const _PICK_OFFSETS = (() => {
  const pts = [[0, 0]];
  for (const radius of [4, 8, 12, 16, 20]) {
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      pts.push([Math.round(radius * Math.cos(ang)), Math.round(radius * Math.sin(ang))]);
    }
  }
  return pts;
})();

function pickAtPointer(ev) {
  const c = $('canvas');
  const r = c.getBoundingClientRect();
  // partsRoot.matrixAutoUpdate=false skips per-frame matrix recompute (perf
  // win on large assemblies). The cost: anything that mutates partsRoot's
  // position/rotation OR a descendant's position (gizmo, explode, recenter,
  // auto-rotate) leaves matrixWorld stale at pick time. The renderer doesn't
  // refresh it because matrixAutoUpdate=false. Without an explicit refresh
  // here, ray-vs-mesh intersection uses the rest-pose matrix and the user
  // sees clicks land on parts in their UNEXPLODED position. Force a fresh
  // matrix + matrixWorld for partsRoot, then propagate to descendants.
  if (state.partsRoot) {
    state.partsRoot.updateMatrix();
    state.partsRoot.updateMatrixWorld(true);
  }
  // Build the raycast target list once per click — same for every sample ray.
  const targets = []; const seen = new Set();
  for (const p of state.parts) {
    if (p.deleted || !p.visible) continue;
    if (p.mesh && !seen.has(p.mesh.id)) { targets.push(p.mesh); seen.add(p.mesh.id); }
  }
  for (const g of state.instancedGroups) targets.push(g.instanced);

  const hitToPartId = (h) => {
    if (h.object.isInstancedMesh) {
      // Lazy index — see note at original pickAtPointer for cache rationale.
      let grp = h.object.userData._group;
      if (!grp) {
        grp = state.instancedGroups.find(g => g.instanced === h.object);
        if (!grp) return null;
        h.object.userData._group = grp;
      }
      const entry = grp.parts[h.instanceId];
      return (entry && entry.partInfo && entry.partInfo.partId) ?? null;
    }
    return h.object.userData.partId ?? null;
  };

  // Try each sample ray; first hit returns. With BVH attached to most geoms
  // each ray is microseconds, so ~13 samples is essentially free.
  for (const [dx, dy] of _PICK_OFFSETS) {
    pointer.x = (((ev.clientX + dx) - r.left) / r.width) * 2 - 1;
    pointer.y = -(((ev.clientY + dy) - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(targets, false);
    if (hits.length) {
      const id = hitToPartId(hits[0]);
      if (id != null) return id;
    }
  }
  return null;
}

function selectPart(partId, mode='single') {
  const p = getPart(partId);
  if (!p || p.deleted) return;
  if (mode === 'add') state.selected.add(partId);
  else if (mode === 'toggle') { if (state.selected.has(partId)) state.selected.delete(partId); else state.selected.add(partId); }
  else {
    state.selected.clear();
    // Clicking a part clears any previously-highlighted group rows — single
    // mode means single, applies to part-vs-group selection too.
    state.selectedGroupIds.clear();
    state.selected.add(partId);
  }
  applySelectionColors();
  rebuildTreeSelectionOnly();
  refreshPropertiesPanel();
  updateGizmo();
  $('del-sel-count').textContent = state.selected.size;
}

function clearSelection() {
  state.selected.clear();
  state.selectedGroupIds.clear();
  state._selAnchorId = null;
  applySelectionColors();
  rebuildTreeSelectionOnly();
  refreshPropertiesPanel();
  updateGizmo();
  $('del-sel-count').textContent = 0;
}

// 2D convex hull (Andrew's monotone chain) — used to build the screen-space
// silhouette of a projected 3D bbox before the polygon-rect overlap test.
function _convexHull2D(pts) {
  const n = pts.length;
  if (n < 3) return pts.slice();
  pts = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (O, A, B) => (A.x - O.x) * (B.y - O.y) - (A.y - O.y) * (B.x - O.x);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = n - 1; i >= 0; i--) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pts[i]) <= 0) upper.pop();
    upper.push(pts[i]);
  }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

// SAT-based convex polygon vs axis-aligned rect overlap. Returns true if the
// polygon and the rectangle share any pixel (including touching boundaries).
function _polyRectOverlap(poly, rMinX, rMinY, rMaxX, rMaxY) {
  // Axis-aligned pre-test (rect's edge axes).
  let pMinX = Infinity, pMaxX = -Infinity, pMinY = Infinity, pMaxY = -Infinity;
  for (const pt of poly) {
    if (pt.x < pMinX) pMinX = pt.x;
    if (pt.x > pMaxX) pMaxX = pt.x;
    if (pt.y < pMinY) pMinY = pt.y;
    if (pt.y > pMaxY) pMaxY = pt.y;
  }
  if (pMaxX < rMinX || pMinX > rMaxX) return false;
  if (pMaxY < rMinY || pMinY > rMaxY) return false;
  const n = poly.length;
  if (n < 3) return true;          // degenerate poly already passed AABB test
  const rectPts = [
    rMinX, rMinY,  rMaxX, rMinY,  rMaxX, rMaxY,  rMinX, rMaxY,
  ];
  // Polygon's edge-normal axes.
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const nx = -(b.y - a.y);
    const ny =  (b.x - a.x);
    let pMin = Infinity, pMax = -Infinity;
    for (const pt of poly) {
      const proj = pt.x * nx + pt.y * ny;
      if (proj < pMin) pMin = proj;
      if (proj > pMax) pMax = proj;
    }
    let rMin = Infinity, rMax = -Infinity;
    for (let j = 0; j < 8; j += 2) {
      const proj = rectPts[j] * nx + rectPts[j + 1] * ny;
      if (proj < rMin) rMin = proj;
      if (proj > rMax) rMax = proj;
    }
    if (pMax < rMin || rMax < pMin) return false;
  }
  return true;
}

// Commit a marquee drag → selection.
// We project the 8 bbox corners to screen, build their convex hull (the actual
// silhouette of the 3D box, up to 6 sides), then do a SAT polygon-vs-rect test.
// This is "crossing" select semantics: any visual touch counts. AABB-of-corners
// alone over-selected (the screen AABB of a rotated box is bigger than its
// silhouette) and vertex-sampling alone under-selected (samples could miss the
// rect even when the part visibly grazes it).
//
// Modifiers:
//   additive (shift) → add hits to existing selection
//   toggle   (ctrl)  → flip hits in existing selection
//   neither          → replace selection with hits
function _commitMarqueeSelection(m) {
  const canvasRect = $('canvas').getBoundingClientRect();
  const rMinX = Math.min(m.startX, m.endX);
  const rMaxX = Math.max(m.startX, m.endX);
  const rMinY = Math.min(m.startY, m.endY);
  const rMaxY = Math.max(m.startY, m.endY);
  const cw = canvasRect.width, ch = canvasRect.height;
  const cx = canvasRect.left,  cy = canvasRect.top;
  const v = new THREE.Vector3();
  const matched = new Set();
  camera.updateMatrixWorld();

  for (const p of state.parts) {
    if (p.deleted || !p.visible) continue;

    // World-space bbox: prefer geom.boundingBox * mesh.matrixWorld so
    // user transforms (gizmo, explode, bake) are honoured live.
    let worldBox;
    if (p.mesh && p.mesh.geometry && p.mesh.geometry.boundingBox) {
      p.mesh.updateMatrixWorld(true);
      worldBox = new THREE.Box3().copy(p.mesh.geometry.boundingBox).applyMatrix4(p.mesh.matrixWorld);
    } else if (p.bbox) {
      worldBox = p.bbox;
    } else continue;

    // Project the 8 bbox corners. Drop any whose clip-space z is outside
    // [-1, 1] (behind near plane or past far plane) — those projections
    // are invalid and would inflate the silhouette wrongly.
    const min = worldBox.min, max = worldBox.max;
    const pts = [];
    for (let xi = 0; xi < 2; xi++)
    for (let yi = 0; yi < 2; yi++)
    for (let zi = 0; zi < 2; zi++) {
      v.set(xi ? max.x : min.x, yi ? max.y : min.y, zi ? max.z : min.z);
      v.project(camera);
      if (v.z < -1 || v.z > 1) continue;
      pts.push({
        x: (v.x + 1) * 0.5 * cw + cx,
        y: (1 - v.y) * 0.5 * ch + cy,
      });
    }
    if (pts.length === 0) continue;

    // Convex hull (≤6 vertices in practice) → SAT vs marquee rect.
    const hull = pts.length >= 3 ? _convexHull2D(pts) : pts;
    if (_polyRectOverlap(hull, rMinX, rMinY, rMaxX, rMaxY)) matched.add(p.partId);
  }

  if (m.additive) {
    for (const id of matched) state.selected.add(id);
  } else if (m.toggle) {
    for (const id of matched) {
      if (state.selected.has(id)) state.selected.delete(id);
      else state.selected.add(id);
    }
  } else {
    state.selected = new Set(matched);
  }
  if (matched.size) state._selAnchorId = [...matched].pop();
  applySelectionColors();
  rebuildTreeSelectionOnly();
  refreshPropertiesPanel();
  updateGizmo();
  $('del-sel-count').textContent = state.selected.size;
}

// Range-select between anchorId and clickedId in DOM (visual) order. If
// `additive` is true, the existing selection is preserved and the range is
// added; otherwise the selection is replaced with the range. The DOM walk
// honours the user's current sort + filter + group expansion state, so the
// range matches what the user actually sees in the tree.
function _treeSelectRange(anchorId, clickedId, additive) {
  const treeEl = document.getElementById('tree');
  if (!treeEl) return;
  const nodes = treeEl.querySelectorAll('.tree-node[data-part-id]');
  let iA = -1, iB = -1;
  for (let i = 0; i < nodes.length; i++) {
    const id = parseInt(nodes[i].dataset.partId, 10);
    if (id === anchorId)  iA = i;
    if (id === clickedId) iB = i;
  }
  // Anchor not visible (filtered out / in a collapsed group): fall back to a
  // plain click on the new id so the user gets predictable behaviour.
  if (iA < 0 || iB < 0) {
    selectPart(clickedId, additive ? 'add' : 'single');
    state._selAnchorId = clickedId;
    return;
  }
  const lo = Math.min(iA, iB), hi = Math.max(iA, iB);
  if (!additive) state.selected.clear();
  for (let i = lo; i <= hi; i++) {
    const id = parseInt(nodes[i].dataset.partId, 10);
    const p = getPart(id);
    if (p && !p.deleted) state.selected.add(id);
  }
  applySelectionColors();
  rebuildTreeSelectionOnly();
  refreshPropertiesPanel();
  updateGizmo();
  $('del-sel-count').textContent = state.selected.size;
}

function refreshPropertiesPanel() {
  const el = $('prop-body');
  const ids = [...state.selected];

  // Sum live scene tris for the share-of-scene bar. Cheap linear pass — only
  // runs on selection change, not every frame.
  let sceneTris = 0;
  for (const p of state.parts) if (!p.deleted) sceneTris += p.triCount;

  let nameHtml = `<span class="prop-name" style="color:var(--tx3)">No selection</span>`;
  let materialHtml = '';
  let tagsHtml = '';
  let tris = '—', verts = '—', bbox = '—', diag = '—', pct = '—', vol = '—';
  let triShare = 0;
  let triShareLabel = '—';

  // Resolve the material currently bound to a part (handles both standalone
  // mesh and instanced parts; ignores Material[] arrays by taking [0]).
  const _matOfPart = (p) => {
    if (!p) return null;
    let m = p.mesh?.material;
    if (!m) m = p.instancedMesh?.material;
    if (Array.isArray(m)) m = m[0];
    return (m && m.isMaterial) ? m : null;
  };
  const _matLabel = (m) => {
    if (!m) return '';
    const n = (m.name && m.name.trim()) || ('mat_' + (m.color?.getHexString?.() || 'cccccc'));
    return n;
  };
  // Count how many live parts reference this material — used in the prop
  // panel sub-label "PBR · 117 parts" so the user immediately sees how
  // many parts an edit will affect.
  const _countPartsUsingMaterial = (mat) => {
    if (!mat) return 0;
    let n = 0;
    const seen = new Set();
    for (const p of state.parts || []) {
      if (p.deleted || !p.mesh || seen.has(p.mesh)) continue;
      seen.add(p.mesh);
      let m = p.mesh.material;
      if (Array.isArray(m)) m = m[0];
      if (m === mat) n += (p.group ? p.group.parts.length : 1);
    }
    return n;
  };

  if (ids.length === 1) {
    const p = getPart(ids[0]);
    if (!p) return;
    const sz = p.bbox.getSize(new THREE.Vector3());
    const hex = '#' + (p.originalColor?.getHexString?.() || 'aaaaaa');
    // Type icon on the left disambiguates instance from a one-off part —
    // matches the tree's typeicon vocabulary so it reads at a glance.
    // Match the tree's typeicon vocabulary: green `box` for a singleton
    // part, purple `copy` for an instance — same icon + colour the user
    // already learned from the left sidebar.
    const isInst = !!p.group;
    const tCls   = isInst ? 'inst' : 'part';
    const tIcon  = isInst ? 'copy' : 'box';
    nameHtml = `<span class="prop-type-icon ${tCls}" title="${isInst ? 'Instanced part (×' + p.group.parts.length + ')' : 'Single part'}"><i data-lucide="${tIcon}"></i></span>` +
               `<span class="prop-name" title="${p.name}">${p.name}</span>`;
    const mat = _matOfPart(p);
    if (mat) {
      const label = _matLabel(mat);
      const matHex = '#' + (mat.color?.getHexString?.() || 'cccccc');
      // Try to use the cached preview sphere from the materials grid for
      // visual consistency. Falls back to a flat colour swatch if the
      // preview hasn't been rendered yet (first frame).
      let thumbHtml;
      try {
        const url = (typeof _renderMaterialPreview === 'function') ? _renderMaterialPreview(mat) : null;
        thumbHtml = url
          ? `<span class="prop-mat-sphere"><img src="${url}" alt="" draggable="false"></span>`
          : `<span class="prop-mat-color" style="background:${matHex}"></span>`;
      } catch (_) {
        thumbHtml = `<span class="prop-mat-color" style="background:${matHex}"></span>`;
      }
      // Sub-label: material type + part count + a "double-click name to
      // rename" hint that fades on hover (CSS owns the visibility).
      const usedCount = _countPartsUsingMaterial(mat);
      const subLabel = `${mat.type.replace('Mesh','').replace('Material','')} · ${usedCount} part${usedCount === 1 ? '' : 's'}`;
      materialHtml = `<div class="prop-mat-btn" data-action="edit-material" title="Click to edit · double-click name to rename">
        ${thumbHtml}
        <div class="prop-mat-info">
          <span class="prop-mat-name" data-mat-name>${escapeHtml(label)}</span>
          <span class="prop-mat-sub">${escapeHtml(subLabel)}</span>
        </div>
        <div class="prop-mat-actions">
          <button class="prop-mat-action" data-action="rename-material" title="Rename material"><i data-lucide="pencil"></i></button>
          <button class="prop-mat-action" data-action="edit-material" title="Edit material"><i data-lucide="sliders-horizontal"></i></button>
        </div>
      </div>`;
    }
    const tags = [];
    if (p.group)    tags.push(`<span class="tree-badge">instanced ×${p.group.parts.length}</span>`);
    if (p.flagged)  tags.push(`<span class="tree-badge warn">flagged</span>`);
    if (!p.visible) tags.push(`<span class="tree-badge muted">hidden</span>`);
    if (p.deleted)  tags.push(`<span class="tree-badge danger">deleted</span>`);
    tagsHtml = tags.join('');
    tris  = fmtNum(p.triCount);
    verts = fmtNum(p.vertCount);
    bbox  = `${_fmtLen(sz.x)} × ${_fmtLen(sz.y)} × ${_fmtLen(sz.z)}`;
    diag  = _fmtLen(p.sizeMetrics.diag, 3);
    pct   = (p.sizeMetrics.diag / state.modelDiag * 100).toFixed(2) + '%';
    vol   = _fmtVol(p.sizeMetrics.vol);
    triShare = sceneTris > 0 ? p.triCount / sceneTris : 0;
    triShareLabel = (triShare * 100).toFixed(triShare < 0.001 ? 3 : triShare < 0.01 ? 2 : 1) + '% of scene';
  } else if (ids.length > 1) {
    let tt = 0, tv = 0, tvol = 0;
    const combined = new THREE.Box3();
    const colors = new Set();
    let anyFlagged = false, anyHidden = false, anyInstanced = 0;
    for (const id of ids) {
      const p = getPart(id);
      if (!p) continue;
      tt += p.triCount; tv += p.vertCount; tvol += p.sizeMetrics.vol;
      if (p.bbox && !p.bbox.isEmpty()) combined.union(p.bbox);
      if (p.originalColor) colors.add(p.originalColor.getHexString());
      if (p.flagged)  anyFlagged = true;
      if (!p.visible) anyHidden  = true;
      if (p.group)    anyInstanced++;
    }
    const sharedColor = colors.size === 1 ? '#' + [...colors][0] : null;
    // Multi-select uses the tree's `copy` icon (purple inst tone) when every
    // selected part is instanced; otherwise the green `box` for parts.
    const allInst = anyInstanced === ids.length && ids.length > 0;
    const tCls   = allInst ? 'inst' : 'part';
    const tIcon  = allInst ? 'copy' : 'box';
    nameHtml = `<span class="prop-type-icon ${tCls}" title="${ids.length} parts selected"><i data-lucide="${tIcon}"></i></span>` +
               `<span class="prop-name">${ids.length} parts selected</span>`;
    // Detect shared material across the selection — show its name; otherwise
    // mark as mixed so the user knows the editor would only target one.
    const matSet = new Set();
    let sharedMatRef = null;
    for (const id of ids) {
      const m = _matOfPart(getPart(id));
      if (!m) { matSet.clear(); break; }
      matSet.add(m);
      if (matSet.size > 1) break;
      sharedMatRef = m;
    }
    if (matSet.size === 1 && sharedMatRef) {
      const matHex = '#' + (sharedMatRef.color?.getHexString?.() || 'cccccc');
      let thumbHtml;
      try {
        const url = (typeof _renderMaterialPreview === 'function') ? _renderMaterialPreview(sharedMatRef) : null;
        thumbHtml = url
          ? `<span class="prop-mat-sphere"><img src="${url}" alt="" draggable="false"></span>`
          : `<span class="prop-mat-color" style="background:${matHex}"></span>`;
      } catch (_) {
        thumbHtml = `<span class="prop-mat-color" style="background:${matHex}"></span>`;
      }
      const usedCount = _countPartsUsingMaterial(sharedMatRef);
      const subLabel = `${sharedMatRef.type.replace('Mesh','').replace('Material','')} · ${usedCount} part${usedCount === 1 ? '' : 's'}`;
      materialHtml = `<div class="prop-mat-btn" data-action="edit-material" title="Click to edit · double-click name to rename">
        ${thumbHtml}
        <div class="prop-mat-info">
          <span class="prop-mat-name" data-mat-name>${escapeHtml(_matLabel(sharedMatRef))}</span>
          <span class="prop-mat-sub">${escapeHtml(subLabel)}</span>
        </div>
        <div class="prop-mat-actions">
          <button class="prop-mat-action" data-action="rename-material" title="Rename material"><i data-lucide="pencil"></i></button>
          <button class="prop-mat-action" data-action="edit-material" title="Edit material"><i data-lucide="sliders-horizontal"></i></button>
        </div>
      </div>`;
    } else if (matSet.size > 1) {
      const mixedSwatch = `<span class="prop-mat-color prop-mat-color-mixed"></span>`;
      materialHtml = `<div class="prop-mat-btn prop-mat-mixed">${mixedSwatch}<div class="prop-mat-info"><span class="prop-mat-name">mixed materials</span><span class="prop-mat-sub">${matSet.size} different · select one to edit</span></div></div>`;
    }
    const tags = [];
    if (anyInstanced) tags.push(`<span class="tree-badge">${anyInstanced} instanced</span>`);
    if (anyFlagged)   tags.push(`<span class="tree-badge warn">contains flagged</span>`);
    if (anyHidden)    tags.push(`<span class="tree-badge muted">contains hidden</span>`);
    tagsHtml = tags.join('');
    tris  = fmtNum(tt);
    verts = fmtNum(tv);
    if (!combined.isEmpty()) {
      const sz = combined.getSize(new THREE.Vector3());
      const d = sz.length();
      bbox = `${_fmtLen(sz.x)} × ${_fmtLen(sz.y)} × ${_fmtLen(sz.z)}`;
      diag = _fmtLen(d, 3);
      pct  = (d / state.modelDiag * 100).toFixed(2) + '%';
    }
    vol = _fmtVol(tvol);
    triShare = sceneTris > 0 ? tt / sceneTris : 0;
    triShareLabel = (triShare * 100).toFixed(triShare < 0.001 ? 3 : triShare < 0.01 ? 2 : 1) + '% of scene';
  }

  // If the user clicked a group row (rather than individual parts), the panel
  // header should match the tree's vocabulary: archive icon + group name,
  // not a part icon + "N parts selected". The descendants are still in
  // state.selected so triangle / bbox / volume read-outs above remain valid;
  // we only swap the header label + icon. Multi-group selections show the
  // group count instead.
  const groupIds = state.selectedGroupIds ? [...state.selectedGroupIds] : [];
  if (groupIds.length > 0) {
    const findGroup = (gid) => {
      // hier groups (numeric) live in state.treeNodes; user groups (string id)
      // live in state.userGroups. Search both so the panel name is correct
      // regardless of group type.
      const tn = state.treeNodes?.find(n => n.kind === 'group' && String(n.id) === String(gid));
      if (tn) return { name: tn.name || ('Group ' + gid) };
      const ug = (state.userGroups || []).find(g => String(g.id) === String(gid));
      if (ug) return { name: ug.name || ('Group ' + gid) };
      return null;
    };
    if (groupIds.length === 1) {
      const g = findGroup(groupIds[0]);
      const gname = g ? g.name : ('Group ' + groupIds[0]);
      const partN = ids.length;
      const sub = partN ? ` · ${partN} part${partN === 1 ? '' : 's'}` : '';
      nameHtml = `<span class="prop-type-icon asm" title="Group${sub}"><i data-lucide="archive"></i></span>` +
                 `<span class="prop-name" title="${escapeHtml(gname)}">${escapeHtml(gname)}</span>`;
    } else {
      nameHtml = `<span class="prop-type-icon asm" title="${groupIds.length} groups selected"><i data-lucide="archive"></i></span>` +
                 `<span class="prop-name">${groupIds.length} groups selected</span>`;
    }
  }

  // Bar tints: blue under 5%, yellow 5-20%, red over 20% — "this part is
  // dragging the framerate" intuition matches the existing threshold helpers.
  const sharePct = Math.min(100, triShare * 100);
  const fillCls = triShare > 0.20 ? 'very-heavy' : triShare > 0.05 ? 'heavy' : '';

  el.innerHTML = `
    <div class="prop-head">${nameHtml}</div>
    ${materialHtml ? `<div class="prop-material-row">${materialHtml}</div>` : ''}
    <div class="prop-tags">${tagsHtml}</div>
    <div class="prop-bar-wrap" title="Triangle share of total scene">
      <span class="prop-bar-icon"><i data-lucide="bar-chart-3"></i></span>
      <div class="prop-bar"><div class="prop-bar-fill ${fillCls}" style="width:${sharePct.toFixed(2)}%"></div></div>
      <span class="prop-bar-label">${triShareLabel}</span>
    </div>
    <div class="prop-grid">
      <span class="prop-icon"><i data-lucide="triangle"></i></span><span class="prop-label">Triangles</span><strong class="prop-value">${tris}</strong>
      <span class="prop-icon"><i data-lucide="circle-dot"></i></span><span class="prop-label">Vertices</span><strong class="prop-value">${verts}</strong>
      <span class="prop-icon"><i data-lucide="box"></i></span><span class="prop-label">Bbox</span><strong class="prop-value" title="${bbox}">${bbox}</strong>
      <span class="prop-icon"><i data-lucide="ruler"></i></span><span class="prop-label">Diagonal</span><strong class="prop-value">${diag}</strong>
      <span class="prop-icon"><i data-lucide="percent"></i></span><span class="prop-label">% of model</span><strong class="prop-value">${pct}</strong>
      <span class="prop-icon"><i data-lucide="package"></i></span><span class="prop-label">Volume</span><strong class="prop-value">${vol}</strong>
    </div>`;
  // Wire the material edit button — opens the same per-material editor used
  // from the materials panel. The "rename" action button + dblclick on the
  // name span both enter inline rename mode (same UX as the tree).
  const matBtn = el.querySelector('.prop-mat-btn[data-action="edit-material"]');
  const _resolveSelectedMat = () => {
    const ids = [...state.selected];
    if (!ids.length) return null;
    const p = getPart(ids[0]);
    let target = p?.mesh?.material;
    if (!target) target = p?.instancedMesh?.material;
    if (Array.isArray(target)) target = target[0];
    return target || null;
  };
  if (matBtn) {
    matBtn.addEventListener('click', (e) => {
      // The action buttons inside the chip handle their own clicks. Don't
      // double-fire the editor when the user meant to hit "rename".
      if (e.target.closest('.prop-mat-action[data-action="rename-material"]')) return;
      if (typeof _collectLiveMaterials !== 'function' || typeof _openMaterialEditor !== 'function') return;
      const target = _resolveSelectedMat();
      if (!target) return;
      const info = _collectLiveMaterials().find(i => i.mat === target);
      if (info) _openMaterialEditor(info);
    });
    // Dblclick the name → rename inline. Stop propagation so the same
    // event doesn't also open the editor (click bubbles independently).
    const nameEl = matBtn.querySelector('[data-mat-name]');
    if (nameEl) {
      nameEl.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const target = _resolveSelectedMat();
        if (target) _renameMaterialInline(nameEl, target);
      });
    }
    // Pencil action button — same rename flow.
    const renameBtn = matBtn.querySelector('.prop-mat-action[data-action="rename-material"]');
    if (renameBtn) renameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const target = _resolveSelectedMat();
      if (target && nameEl) _renameMaterialInline(nameEl, target);
    });
  }
  _lucide();
  _updateSelectedChip();
}

// System-wide material rename. Replaces `labelEl`'s text with an inline
// input (same .tree-label-input style used by the tree rename), commits on
// Enter / blur, cancels on Escape. Updates mat.name + invalidates the
// preview cache + repaints all surfaces (props panel, materials grid).
function _renameMaterialInline(labelEl, mat) {
  if (!labelEl || !mat) return;
  const seedName = (mat.name || '').trim() || _matFallbackName(mat);
  if (window.getSelection) try { window.getSelection().removeAllRanges(); } catch (_) {}
  // Reuse the tree's _treeInlineRename helper so the rename UX is identical
  // to renaming a part / group in the left sidebar — same input style, same
  // Enter/Escape semantics, same blur-to-commit.
  _treeInlineRename(labelEl, seedName, (next) => {
    if (!next || next === seedName) return;
    mat.name = next;
    if (typeof _matPreviewCache !== 'undefined') _matPreviewCache.delete(mat);
    refreshPropertiesPanel?.();
    if (typeof window._populateMaterialsList === 'function') window._populateMaterialsList();
  });
}
function _matFallbackName(m) {
  return 'mat_' + (m?.color?.getHexString?.() || 'cccccc');
}

// Status-bar selection chip — synced from refreshPropertiesPanel so it tracks
// every code path that mutates state.selected (the existing del-sel-count
// writes already pair with refreshPropertiesPanel calls at every site).
function _updateSelectedChip() {
  const el = $('sb-selected'); if (!el) return;
  const n = state.selected.size;
  $('sb-selected-n').textContent = n;
  el.classList.toggle('empty', n === 0);
  el.classList.toggle('active', n > 0);
}

function refreshFlagged() {
  state.pendingFlagged.clear();
  const thr = state.threshold / 100;
  const metric = state.sizeMetricMode;
  let count = 0, cutoff;
  if (metric === 'diag' || metric === 'max') cutoff = thr * state.modelDiag;
  else cutoff = Math.pow(thr * state.modelDiag, 3);
  for (const p of state.parts) {
    if (p.deleted) { p.flagged = false; continue; }
    const v = metric === 'diag' ? p.sizeMetrics.diag : metric === 'max' ? p.sizeMetrics.max : p.sizeMetrics.vol;
    p.flagged = (v < cutoff);
    if (p.flagged) { count++; state.pendingFlagged.add(p.partId); }
  }
  $('btn-delete-small-count').textContent = count;
  const thrFmt = state.threshold < 1 ? state.threshold.toFixed(2) : state.threshold.toFixed(1);
  $('thr-info').textContent = count > 0 ? `${count} parts below ${thrFmt}% (cutoff ${cutoff.toFixed(3)} ${metric}).` : `No parts below threshold.`;
  _updateFlaggedChip();
  applySelectionColors();
  rebuildTree();
  requestRender();
}

// Status-bar flagged chip. Driven from refreshFlagged + the manual
// flag-by-tri / flag-by-aspect helpers (which mutate state.pendingFlagged
// outside the threshold path).
function _updateFlaggedChip() {
  const el = $('sb-flagged'); if (!el) return;
  const n = state.pendingFlagged.size;
  $('sb-flagged-n').textContent = n;
  el.classList.toggle('empty', n === 0);
  el.classList.toggle('active', n > 0);
}

function pushUndo(op) {
  state.history.push(op);
  if (state.history.length > 30) state.history.shift();
  // Any new user action invalidates the redo stack — same convention as
  // every editor (Photoshop, VS Code, Figma). Without this the user could
  // undo, do something new, then redo back to a state inconsistent with
  // the new action.
  state.redo.length = 0;
  _refreshUndoRedoButtons();
}
function _refreshUndoRedoButtons() {
  const u = $('btn-undo'); if (u) u.disabled = state.history.length === 0;
  const r = $('btn-redo'); if (r) r.disabled = !state.redo || state.redo.length === 0;
}
// Single source of truth for "after-undo / after-redo cleanup". Every branch
// of undoLast / redoLast calls this so the viewport, gizmo, highlights, and
// tree all stay in sync — previously each branch picked-and-chose which
// of these to call and we got bugs like "ctrl+z moved the mesh but the
// cyan outline stayed in place" or "tree row stayed selected after a
// destructive undo".
function _finalizeUndo({ rebuildTree: doRebuildTree = false } = {}) {
  applySelectionColors();          // rebuilds world-baked outline geometry
  if (doRebuildTree) rebuildTree(); else rebuildTreeSelectionOnly?.();
  refreshPropertiesPanel?.();
  updateGizmo();
  _refreshUndoRedoButtons();
  requestRender();
}

function deleteParts(ids, label='Deleted parts') {
  const set = new Set(ids);
  const hidden = [];
  const m4zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (const p of state.parts) {
    if (set.has(p.partId) && !p.deleted) {
      p.deleted = true;
      if (p.mesh) p.mesh.visible = false;
      if (p.instancedMesh) {
        const prev = new THREE.Matrix4(); p.instancedMesh.getMatrixAt(p.instanceIndex, prev);
        p.instancedMesh.setMatrixAt(p.instanceIndex, m4zero);
        p.instancedMesh.instanceMatrix.needsUpdate = true;
        hidden.push({ partId: p.partId, prevMat: prev.elements.slice() });
      } else hidden.push({ partId: p.partId });
    }
  }
  // Drop deleted partIds out of any userGroups, and dissolve groups that end
  // up empty. Without this, the userGroup tree kept showing the group header
  // with a stale badge count and no rows underneath — which read as "delete
  // didn't actually delete anything" because the parent stuck around.
  if (Array.isArray(state.userGroups) && state.userGroups.length) {
    const drop = [];
    for (const g of state.userGroups) {
      if (!g.partIds || !g.partIds.size) { drop.push(g.id); continue; }
      let changed = false;
      for (const pid of [...g.partIds]) if (set.has(pid)) { g.partIds.delete(pid); changed = true; }
      if (changed && g.partIds.size === 0) drop.push(g.id);
    }
    for (const gid of drop) try { removeUserGroup(gid, { skipRebuild: true }); } catch (_) {}
  }
  if (hidden.length) pushUndo({ type: 'delete', items: hidden, label });
  state.selected.clear(); $('del-sel-count').textContent = 0;
  // Model center changes when parts disappear; per-part _origPos values are
  // still valid for survivors, so leave them alone.
  invalidateExplodeBaseline({ parts: false });
  recomputeStats(); refreshFlagged(); rebuildTree(); refreshPropertiesPanel(); updateGizmo();
  toast(label, `${hidden.length} parts removed`, 'success');
  requestRender();
}

// Apply transform-style op in either direction. dir='before' restores the
// pre-action matrix (undo); dir='after' re-applies the post-action matrix
// (redo). Single function = same correctness for both paths.
function _applyTransformOp(items, dir) {
  if (!items || items.length === 0) return 0;
  const pivoted = new Set(
    (state._pivotedParts || (state._pivotedPart ? [state._pivotedPart] : []))
      .map(p => p && p.partId)
  );
  if (items.some(it => pivoted.has(it.partId))) _detachGizmo();
  const tmpInv = new THREE.Matrix4();
  const tmpLocal = new THREE.Matrix4();
  const target = new THREE.Matrix4();
  let n = 0;
  for (const it of items) {
    const p = getPart(it.partId);
    if (!p || !p.mesh) continue;
    const src = dir === 'before' ? it.before : it.after;
    if (!src) continue;
    const parent = p.mesh.parent || state.partsRoot;
    parent.updateWorldMatrix(true, false);
    target.fromArray(src);
    tmpInv.copy(parent.matrixWorld).invert();
    tmpLocal.multiplyMatrices(tmpInv, target);
    p.mesh.matrix.copy(tmpLocal);
    p.mesh.matrix.decompose(p.mesh.position, p.mesh.quaternion, p.mesh.scale);
    p.mesh.updateMatrixWorld(true);
    p._exactWorld = target.clone();
    n++;
  }
  return n;
}

// Apply a group-transform op in either direction. Restores groupRef's world
// matrix to the stored 'before' (undo) or 'after' (redo) state. Children
// follow automatically via the scene-graph hierarchy.
function _applyGroupTransform(op, dir) {
  const ug = (state.userGroups || []).find(g => g.id === op.groupId);
  if (!ug || !ug.ref) return false;
  // Detach gizmo first so we don't move groupRef while it's pivot-parented.
  if (state._pivotedGroup === ug.ref) _detachGizmo();
  const target = new THREE.Matrix4().fromArray(dir === 'before' ? op.before : op.after);
  const parent = ug.ref.parent || state.partsRoot;
  parent.updateWorldMatrix(true, false);
  const local = new THREE.Matrix4()
    .copy(parent.matrixWorld).invert()
    .multiply(target);
  ug.ref.matrix.copy(local);
  ug.ref.matrix.decompose(ug.ref.position, ug.ref.quaternion, ug.ref.scale);
  ug.ref.updateMatrixWorld(true);
  // Refresh _exactWorld on every child so highlight rebuild is accurate.
  for (const pid of ug.partIds) {
    const p = getPart(pid);
    if (p && p.mesh) {
      p.mesh.updateWorldMatrix(true, false);
      p._exactWorld = p.mesh.matrixWorld.clone();
    }
  }
  return true;
}

function undoLast() {
  const op = state.history.pop();
  if (!op) return;
  if (op.type === 'groupTransform') {
    if (_applyGroupTransform(op, 'before')) {
      state.redo.push(op);
      _finalizeUndo();
      // Visual revert speaks for itself — no toast.
    } else {
      // Group no longer exists (e.g. user dissolved it) — drop the entry.
      _refreshUndoRedoButtons();
    }
    return;
  }
  if (op.type === 'transform' || op.type === 'transformGroup') {
    // 'transformGroup' wraps every per-part move performed by ONE gizmo
    // gesture into a single undo entry, so dragging 50 parts and pressing
    // Ctrl+Z reverts all 50 at once. 'transform' is the legacy single-part
    // shape — normalize to a one-item array so the rest of the body has a
    // single code path.
    const items = op.type === 'transformGroup'
      ? op.items
      : [{ partId: op.partId, before: op.before, after: op.after }];
    const n = _applyTransformOp(items, 'before');
    if (n > 0) {
      state.redo.push({ type: 'transformGroup', items });
      _finalizeUndo();
      // Visual revert speaks for itself — no toast.
    } else {
      _refreshUndoRedoButtons();
    }
    return;
  }
  if (op.type === 'delete') {
    for (const it of op.items) {
      const p = getPart(it.partId);
      if (!p) continue;
      p.deleted = false;
      if (p.mesh) p.mesh.visible = p.visible;
      if (p.instancedMesh && it.prevMat) { const m = new THREE.Matrix4(); m.fromArray(it.prevMat); p.instancedMesh.setMatrixAt(p.instanceIndex, m); p.instancedMesh.instanceMatrix.needsUpdate = true; }
    }
    state.redo.push(op);
    recomputeStats(); refreshFlagged();
    _finalizeUndo({ rebuildTree: true });
    // Restored parts visible in viewport — no toast.
    return;
  }
  if (op.type === 'split') {
    _undoSplitBatch(op.batch);
    state._explodeBaselineDone = false;
    _reindexParts(); recomputeStats(); refreshFlagged();
    // Split is not redoable (children's geometries were disposed by
    // _undoSplitBatch). Leaving op out of state.redo is the intentional
    // signal — the user can re-run Split via the toolbar if they want.
    _finalizeUndo({ rebuildTree: true });
    // Restored meshes visible in viewport — no toast.
    return;
  }
  // 'boxify' is handled by a dedicated wrapper installed by the bbox-ify
  // module (search for `_origUndoLastBB`) that runs before this core. It
  // pops the op, restores geometry/transform/parent, and pushes to the
  // redo stack. We don't re-handle it here.
  // Unknown op type: don't re-push (avoid infinite loop) but warn so we
  // notice if a new pushUndo type wasn't wired up here.
  console.warn('[undo] unhandled op type:', op.type);
  _refreshUndoRedoButtons();
  requestRender();
}

function redoLast() {
  if (!state.redo || state.redo.length === 0) return;
  const op = state.redo.pop();
  if (op.type === 'groupTransform') {
    if (_applyGroupTransform(op, 'after')) {
      state.history.push(op);
      _finalizeUndo();
      // Visual change speaks for itself — no toast.
    } else {
      _refreshUndoRedoButtons();
    }
    return;
  }
  if (op.type === 'transformGroup' || op.type === 'transform') {
    const items = op.type === 'transformGroup'
      ? op.items
      : [{ partId: op.partId, before: op.before, after: op.after }];
    const n = _applyTransformOp(items, 'after');
    if (n > 0) {
      state.history.push(op);
      _finalizeUndo();
      // Visual change speaks for itself — no toast.
    } else {
      _refreshUndoRedoButtons();
    }
    return;
  }
  if (op.type === 'delete') {
    // Re-apply: re-hide each part (mirror of deleteParts' minimum behavior).
    for (const it of op.items) {
      const p = getPart(it.partId);
      if (!p) continue;
      p.deleted = true;
      if (p.mesh) p.mesh.visible = false;
      if (p.instancedMesh && p.instanceIndex >= 0) {
        const z = new THREE.Matrix4().makeScale(0, 0, 0);
        p.instancedMesh.setMatrixAt(p.instanceIndex, z);
        p.instancedMesh.instanceMatrix.needsUpdate = true;
      }
    }
    state.history.push(op);
    state.selected.clear();
    recomputeStats(); refreshFlagged();
    _finalizeUndo({ rebuildTree: true });
    // Visual change speaks for itself — no toast.
    return;
  }
  if (op.type === 'boxify') {
    // Simplest correct path: re-run bboxifyParts on the same IDs. It pushes
    // its own fresh undo entry + clears the redo stack (standard editor
    // behaviour: redo, like any other action, makes future redos invalid).
    const ids = op.items.map(it => it.partId).filter(id => getPart(id) && !getPart(id).deleted);
    if (ids.length > 0 && typeof bboxifyParts === 'function') {
      bboxifyParts(ids, op.label || 'Smart-fit parts', op.mode || 'smart');
    } else {
      _refreshUndoRedoButtons();
    }
    return;
  }
  // Group / merge redo intentionally not implemented yet — they need to
  // re-create disposed geometry / scene-graph state. Surface the limitation
  // instead of silently dropping the redo entry.
  console.warn('[redo] not supported for op type:', op.type);
  state.redo.push(op);
  toast('Redo unavailable', `Cannot redo "${op.type}" — re-run the action manually`, 'warn');
  _refreshUndoRedoButtons();
}

function recomputeStats() {
  let tris=0, verts=0, count=0, bytes=0;
  const seen = new Set();
  for (const p of state.parts) {
    if (p.deleted) continue;
    count++; tris += p.triCount; verts += p.vertCount;
    if (!seen.has(p.hash)) {
      seen.add(p.hash);
      const g = state.geomByHash.get(p.hash);
      if (g) {
        bytes += g.attributes.position?.array?.byteLength || 0;
        bytes += g.attributes.normal?.array?.byteLength || 0;
        bytes += g.index?.array?.byteLength || 0;
      }
    }
  }
  $('sb-parts').textContent = fmtNum(count);
  $('sb-tris').textContent = fmtNum(tris);
  $('sb-verts').textContent = fmtNum(verts);
  $('sb-mem').textContent = fmtBytes(bytes);
  $('vp-tris').textContent = fmtNum(tris);
  $('vp-parts').textContent = fmtNum(count);
  // Keep the "instanced" counter honest. Destructive ops (boxify auto-promote,
  // merge auto-promote, delete) consume instances without rebuilding the
  // group list — prune any group whose live members all evaporated, then
  // refresh the badge. Cheap walk, runs only when stats refresh.
  if (state.instancedGroups && state.instancedGroups.length) {
    state.instancedGroups = state.instancedGroups.filter(g => {
      if (!g || !g.parts) return false;
      // Group is "alive" if at least one of its members is still bound to
      // this InstancedMesh (i.e., wasn't promoted out / deleted).
      for (const entry of g.parts) {
        const pi = entry && entry.partInfo;
        if (pi && !pi.deleted && pi.instancedMesh === g.instanced) return true;
      }
      // Group is dead — every member was consumed. Remove the now-empty
      // InstancedMesh from the scene to free its draw call too.
      try { g.instanced && g.instanced.parent && g.instanced.parent.remove(g.instanced); } catch (_) {}
      return false;
    });
  }
  const vpInst = document.getElementById('vp-instances');
  if (vpInst) vpInst.textContent = fmtNum((state.instancedGroups || []).length);
  _updateTriBar(tris);
}

// Finder-style in-place rename. Replaces the label span's content with a
// text input, selects-all, commits on Enter/blur, cancels on Esc. Restoring
// the original DOM on cancel preserves any badge spans inside the label.
function _treeInlineRename(labelEl, currentName, onCommit) {
  if (!labelEl || labelEl.dataset.editing === '1') return;
  labelEl.dataset.editing = '1';
  const originalHTML = labelEl.innerHTML;
  // Build a small inline input that visually fills the label area.
  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentName || '';
  input.className = 'tree-label-input';
  input.spellcheck = false;
  // While the input is alive, suppress drag-and-drop / row clicks bubbling
  // out of it — pointer events stay on the input itself.
  input.addEventListener('pointerdown', ev => ev.stopPropagation());
  input.addEventListener('mousedown',  ev => ev.stopPropagation());
  input.addEventListener('click',      ev => ev.stopPropagation());
  input.addEventListener('dblclick',   ev => ev.stopPropagation());

  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    const next = (input.value || '').trim();
    // Restore label DOM regardless of outcome — caller's onCommit (which
    // typically calls rebuildTree) will repaint the row anyway.
    labelEl.innerHTML = originalHTML;
    delete labelEl.dataset.editing;
    if (commit) {
      try { onCommit(next); } catch (e) { console.error('[rename] commit failed:', e); }
    }
  };
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter')      { ev.preventDefault(); ev.stopPropagation(); finish(true); }
    else if (ev.key === 'Escape'){ ev.preventDefault(); ev.stopPropagation(); finish(false); }
    else { ev.stopPropagation(); }
  });
  input.addEventListener('blur', () => finish(true));

  labelEl.innerHTML = '';
  labelEl.appendChild(input);
  // Defer focus + select to next tick so dblclick's text-selection doesn't
  // immediately collapse the caret.
  setTimeout(() => {
    input.focus();
    try { input.select(); } catch (_) {}
  }, 0);
}

function _updateTriBar(currentTris) {
  const mask = document.getElementById('vp-tribar-mask');
  if (!mask) return;
  // Lazy-snapshot: if no starting count was captured yet, treat the current
  // value as the baseline. Guarantees the bar starts at "full gradient" the
  // first time it's shown, regardless of which load path got there.
  if (!state._initialTris || state._initialTris < currentTris) {
    state._initialTris = currentTris;
  }
  const start = state._initialTris || 0;
  if (start <= 0) { mask.style.width = '0%'; return; }
  const remaining = Math.max(0, Math.min(1, currentTris / start));
  // Mask covers the deleted portion (1 - remaining). 0% = full gradient
  // visible; 100% = bar fully obscured.
  mask.style.width = ((1 - remaining) * 100).toFixed(2) + '%';
}

// Observe vp-tris textContent so ANY code path that updates the triangle
// count display automatically refreshes the bar — no need to trace every
// optimize / delete / bake / decimate path that might mutate triCount.
(function _wireTriBarObserver() {
  const tryAttach = () => {
    const el = document.getElementById('vp-tris');
    if (!el) return false;
    const obs = new MutationObserver(() => {
      // Re-sum from state.parts (the displayed text is already formatted
      // with thousands separators, so parsing it back is fragile).
      let tris = 0;
      for (const p of state.parts) if (!p.deleted) tris += p.triCount;
      _updateTriBar(tris);
    });
    obs.observe(el, { childList: true, characterData: true, subtree: true });
    return true;
  };
  if (!tryAttach()) {
    // DOM might not be ready yet at script-load time.
    document.addEventListener('DOMContentLoaded', tryAttach);
  }
})();

function cleanEmpty() {
  const ids = state.parts.filter(p => !p.deleted && (p.triCount === 0 || p.vertCount === 0)).map(p => p.partId);
  if (!ids.length) return toast('No empty parts found', '', 'info');
  deleteParts(ids, 'Removed empty parts');
}
function cleanDupes() {
  const seen = new Map(); const dupes = [];
  for (const p of state.parts) {
    if (p.deleted) continue;
    if (seen.has(p.hash)) dupes.push(p.partId); else seen.set(p.hash, p.partId);
  }
  if (!dupes.length) return toast('No duplicates found', '', 'info');
  deleteParts(dupes, 'Removed duplicates');
}
function cleanDegenerate() {
  const ids = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (const p of state.parts) {
    if (p.deleted) continue;
    const g = state.geomByHash.get(p.hash);
    const pos = g?.attributes.position?.array;
    const idx = g?.index?.array;
    if (!pos) continue;
    let hasArea = false;
    const triCount = idx ? idx.length / 3 : pos.length / 9;
    const sample = Math.min(triCount, 100);
    for (let i = 0; i < sample; i++) {
      const t = (i * (triCount / sample)) | 0;
      let i0, i1, i2;
      if (idx) { i0 = idx[t*3]; i1 = idx[t*3+1]; i2 = idx[t*3+2]; }
      else { i0 = t*3; i1 = t*3+1; i2 = t*3+2; }
      a.set(pos[i0*3], pos[i0*3+1], pos[i0*3+2]);
      b.set(pos[i1*3], pos[i1*3+1], pos[i1*3+2]);
      c.set(pos[i2*3], pos[i2*3+1], pos[i2*3+2]);
      if (b.sub(a).cross(c.sub(a)).lengthSq() > 1e-12) { hasArea = true; break; }
    }
    if (!hasArea) ids.push(p.partId);
  }
  if (!ids.length) return toast('No degenerate parts found', '', 'info');
  deleteParts(ids, 'Removed degenerate parts');
}

// Shape fingerprint: translation- and rotation-invariant signature so that
// e.g. all 47 of the same M6 bolt match regardless of where they sit or how
// they're oriented in the assembly. Combines:
//   - vertex count   (exact)
//   - triangle count (exact)
//   - bbox dimensions sorted ascending, quantized to 0.1% of the largest dim
//     (rotated copies hash the same because we sort the three sides)
//
// Result is cached on partInfo._fp because selectSimilar / context menu may
// call this for tens of thousands of parts. Cache is invalidated whenever bbox
// changes (bake / boxify / split — those paths rewrite p.bbox + p.triCount).
const _FP_TMP_VEC = new THREE.Vector3();
function _shapeFingerprint(part) {
  if (part._fp && part._fpKey === part.triCount + ':' + part.vertCount) return part._fp;
  part.bbox.getSize(_FP_TMP_VEC);
  const ax = Math.abs(_FP_TMP_VEC.x), ay = Math.abs(_FP_TMP_VEC.y), az = Math.abs(_FP_TMP_VEC.z);
  // sort dims ascending without allocating an array
  let d0 = ax, d1 = ay, d2 = az;
  if (d0 > d1) { const t = d0; d0 = d1; d1 = t; }
  if (d1 > d2) { const t = d1; d1 = d2; d2 = t; }
  if (d0 > d1) { const t = d0; d0 = d1; d1 = t; }
  const scale = d2 > 1e-6 ? d2 : 1e-6;
  const inv = 1000 / scale;
  const fp = `v${part.vertCount}_t${part.triCount}_${Math.round(d0*inv)}_${Math.round(d1*inv)}_${Math.round(d2*inv)}`;
  part._fp = fp;
  part._fpKey = part.triCount + ':' + part.vertCount;
  return fp;
}

function selectSimilar() {
  if (state.selected.size === 0) return toast('Select at least one part first', '', 'warn');
  // Build the set of fingerprints from the current selection
  const wantPrints = new Set();
  for (const id of state.selected) {
    const p = getPart(id);
    if (p) wantPrints.add(_shapeFingerprint(p));
  }
  // Add every part whose fingerprint matches
  let added = 0;
  for (const p of state.parts) {
    if (p.deleted || state.selected.has(p.partId)) continue;
    if (wantPrints.has(_shapeFingerprint(p))) { state.selected.add(p.partId); added++; }
  }
  applySelectionColors(); rebuildTreeSelectionOnly(); refreshPropertiesPanel();
  if (typeof updateGizmo === 'function') updateGizmo();
  $('del-sel-count').textContent = state.selected.size;
  // Selection visible in viewport / sidebar chip — no toast.
}

function _isolateSet(idSet, label='Isolated') {
  const m4zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const m4restore = new THREE.Matrix4();
  let shown = 0, hidden = 0;
  for (const p of state.parts) {
    if (p.deleted) continue;
    const on = idSet.has(p.partId);
    p.visible = on;
    if (p.mesh) p.mesh.visible = on;
    if (p.instancedMesh) {
      // Restore the snapshotted build-time instance matrix on show; zero scale
      // on hide. Falls back to identity for any (legacy) part that predates
      // the snapshot — STEP-built instances use identity at build, so this
      // matches the prior behaviour for them.
      m4restore.copy(p._instOrigMat || m4restore.identity());
      p.instancedMesh.setMatrixAt(p.instanceIndex, on ? m4restore : m4zero);
      p.instancedMesh.instanceMatrix.needsUpdate = true;
    }
    if (on) shown++; else hidden++;
  }
  rebuildTree();
  // Visibility change is visible in the viewport — no toast.
  requestRender();
}
function isolateSelected() {
  if (state.selected.size > 0) { _isolateSet(state.selected, 'Isolated selected'); state._isolated = true; }
  else if (state.pendingFlagged.size > 0) { _isolateSet(state.pendingFlagged, 'Isolated flagged parts'); state._isolated = true; }
  else { showAllParts(); /* visible in viewport — no toast */ }
  requestRender();
}
function isolateFlagged() {
  if (state.pendingFlagged.size === 0) return toast('Nothing flagged', 'Set a size threshold first', 'warn');
  _isolateSet(state.pendingFlagged, 'Isolated flagged parts');
}
function showAllParts() {
  const m4restore = new THREE.Matrix4();
  for (const p of state.parts) {
    if (p.deleted) continue;
    p.visible = true;
    if (p.mesh) p.mesh.visible = true;
    if (p.instancedMesh) {
      // Restore each instance's build-time matrix (see _instOrigMat note above).
      // Falling back to identity matches legacy STEP-built behaviour.
      m4restore.copy(p._instOrigMat || m4restore.identity());
      p.instancedMesh.setMatrixAt(p.instanceIndex, m4restore);
      p.instancedMesh.instanceMatrix.needsUpdate = true;
    }
  }
  state._isolated = false;
  rebuildTree();
  requestRender();
}

function setViewMode(mode) {
  // 'mesh' (solid + edges overlay) was removed; map any legacy callers
  // (saved view state from older sessions) onto plain solid.
  if (mode === 'mesh') mode = 'solid';
  state.viewMode = mode;
  const apply = (m) => {
    if (mode === 'solid') {
      m.wireframe = false;
      m.transparent = false; m.opacity = 1; m.depthWrite = true; m.depthTest = true;
      m.alphaToCoverage = false;
      m.side = THREE.FrontSide;
    } else if (mode === 'wire') {
      m.wireframe = true;
      m.transparent = false; m.opacity = 1; m.depthWrite = true; m.depthTest = true;
      m.alphaToCoverage = false;
      m.side = THREE.FrontSide;
    } else if (mode === 'xray') {
      // Additive-blend x-ray. Each surface ADDS its color to the framebuffer;
      // overlapping surfaces accumulate brightness so dense regions (= inner
      // structure) actually show up brighter rather than getting overdrawn.
      //   - transparent=true + AdditiveBlending: addition is commutative, so
      //     three.js's distance-sort instability across InstancedMesh groups
      //     can't cause whole meshes to disappear — every surface contributes
      //     the same amount regardless of draw order.
      //   - depthTest=false + depthWrite=false: no surface occludes another,
      //     so internal screws / ribs / inner shells all render.
      //   - DoubleSide: the back walls of containers contribute brightness
      //     too, which is what makes hidden interiors readable.
      // Visual: looks like a glowing volumetric / density render — bright
      // where many surfaces stack, dim where you're looking through one.
      m.wireframe = false;
      m.transparent = true;
      m.opacity = 0.28;
      m.depthWrite = false; m.depthTest = false;
      m.alphaToCoverage = false;
      m.blending = THREE.AdditiveBlending;
      m.side = THREE.DoubleSide;
    }
    m.needsUpdate = true;
  };
  for (const m of state.materialByColor.values()) apply(m);
  for (const g of state.instancedGroups) apply(g.instanced.material);
  ['vw-solid','vw-wire','vw-xray'].forEach(id => $(id)?.classList.remove('active'));
  $('vw-' + mode)?.classList.add('active');
  requestRender();
}

// (Removed: _buildMergedEdges + toggleEdgesOverlay. The mesh / "solid + edges"
// view mode was dropped; the merged-edges overlay was the only consumer of
// state.edgesRoot, state.edgeOverlay, and state._mergedEdgesBuilt.)

// Resolve the world-space matrix for a given part. Handles three cases:
//   - Standalone Mesh (p.mesh): use its own matrixWorld.
//   - Instanced part  (p.instancedMesh): compose the InstancedMesh's matrixWorld
//     with its per-instance matrix.
//   - Pure-data parts: identity (means "geometry as stored").
// Returns a freshly allocated Matrix4 caller can mutate.
// Detect whether a Matrix4 contains shear. Shear is what's left over after a
// transform is decomposed into T/R/S and recomposed: if the decompose+compose
// round-trip differs from the original, the difference IS the shear. Without
// this check, callers that emit decomposed Lcl transforms (FBX, GLTF nodes)
// silently drop the shear component and the visible mesh ends up rotated
// incorrectly. A 1e-5 tolerance accommodates legitimate fp drift from chained
// matrix multiplies; well-formed models stay below that comfortably.
const _matrixHasShear = (() => {
  const v = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const recomposed = new THREE.Matrix4();
  return function _matrixHasShear(m, eps = 1e-5) {
    m.decompose(v, q, s);
    recomposed.compose(v, q, s);
    const a = m.elements, b = recomposed.elements;
    for (let i = 0; i < 16; i++) {
      if (Math.abs(a[i] - b[i]) > eps) return true;
    }
    return false;
  };
})();

function _resolvePartWorldMatrix(p) {
  const out = new THREE.Matrix4();
  if (p.mesh) {
    // Prefer the exact matrix snapshot captured at load time over the live
    // mesh.matrixWorld. The live one can be corrupted after Object3D.attach()
    // round-trips (gizmo pivot) for Cinema-style GLBs that carry shear in
    // ancestor transforms — three.js's TRS decompose drops the shear and
    // every bake/merge/export afterwards is subtly wrong. The snapshot is
    // refreshed on gizmo drag end so legitimate transforms are preserved.
    if (p._exactWorld) { out.copy(p._exactWorld); return out; }
    p.mesh.updateWorldMatrix(true, false);
    out.copy(p.mesh.matrixWorld);
    return out;
  }
  if (p.instancedMesh) {
    p.instancedMesh.updateWorldMatrix(true, false);
    const local = new THREE.Matrix4();
    p.instancedMesh.getMatrixAt(p.instanceIndex, local);
    out.multiplyMatrices(p.instancedMesh.matrixWorld, local);
    return out;
  }
  return out; // identity
}

// Build the THREE root that gets handed to the chosen exporter. All transforms
// are baked into either per-mesh `applyMatrix4` (non-merge) or directly into
// the vertex buffers (merge). This is critical because OBJ/STL/PLY are flat
// formats with no transform hierarchy — anything not baked here ends up at
// the geometry's stored origin (which after auto-instancing is the canonical
// pose-normalized position, i.e. the model origin).
function buildExportRoot({ visibleOnly, merge, scale, axis, origin }) {
  const root = new THREE.Group();
  let count = 0;

  // Pre-compute the bbox-center offset if needed for origin recentering.
  let originOffset = new THREE.Vector3(0, 0, 0);
  if (origin === 'bbox') {
    const box = new THREE.Box3();
    const tmp = new THREE.Vector3();
    for (const p of state.parts) {
      if (p.deleted) continue;
      if (visibleOnly && !p.visible) continue;
      const m = _resolvePartWorldMatrix(p);
      const local = p.bbox || (state.geomByHash.get(p.hash)?.boundingBox);
      if (!local) continue;
      // Transform the part's local bbox corners through its world matrix.
      const min = local.min, max = local.max;
      for (let xi = 0; xi < 2; xi++) for (let yi = 0; yi < 2; yi++) for (let zi = 0; zi < 2; zi++) {
        tmp.set(xi ? max.x : min.x, yi ? max.y : min.y, zi ? max.z : min.z).applyMatrix4(m);
        box.expandByPoint(tmp);
      }
    }
    if (!box.isEmpty()) box.getCenter(originOffset);
  }

  // Scale + axis matrices applied AFTER per-part world transform.
  const scaleMat = new THREE.Matrix4().makeScale(scale, scale, scale);
  // Z-up (CAD/this app) → Y-up (OBJ/glTF convention) is a -90° rotation about X.
  const axisMat = new THREE.Matrix4();
  if (axis === 'y-up') axisMat.makeRotationX(-Math.PI / 2);
  // Origin recenter: subtract bbox center BEFORE scale/axis so the offset is
  // expressed in model units.
  const offsetMat = new THREE.Matrix4().makeTranslation(-originOffset.x, -originOffset.y, -originOffset.z);
  const postMat = new THREE.Matrix4().multiplyMatrices(axisMat, scaleMat).multiply(offsetMat);

  if (!merge) {
    // Hierarchy reconstruction. Three sources, in priority order:
    //   1. state.userGroups[]   — groups the user created in the tree (renamed
    //      bins of partIds). Wins over original assembly hierarchy because the
    //      user has explicitly reorganised those parts.
    //   2. state.treeNodes[]    — the original STEP/GLB assembly hierarchy
    //      captured by _buildHierarchyFromScene. Renamed group nodes carry
    //      their new name on n.name AND on n.obj3d.name.
    //   3. (fallback) attach to root — loose parts.
    //
    // Empty intermediate groups are harmless for OBJ/STL/PLY (their writers
    // ignore non-mesh nodes); GLTFExporter preserves them in the output, which
    // is exactly what we want so DCC tools (Blender, C4D) reload the same tree.
    const treeNodes = state.treeNodes || [];
    const treeNodeById = new Map();
    for (const n of treeNodes) if (n.kind === 'group') treeNodeById.set(n.id, n);

    // partId → ordered ancestor-group-id chain (outermost → innermost).
    const partToTreeChain = new Map();
    for (const n of treeNodes) {
      if (n.kind !== 'part' || n.partId == null) continue;
      const chain = [];
      let pid = n.parentId;
      while (pid != null && treeNodeById.has(pid)) {
        chain.unshift(pid);
        pid = treeNodeById.get(pid).parentId;
      }
      partToTreeChain.set(n.partId, chain);
    }

    // partId → userGroup it belongs to (if any).
    const partToUserGroup = new Map();
    for (const ug of (state.userGroups || [])) {
      for (const partId of ug.partIds) partToUserGroup.set(partId, ug);
    }

    // Cache containers so siblings under the same group share one parent node.
    const groupCache = new Map();
    function getContainer(part) {
      const ug = partToUserGroup.get(part.partId);
      if (ug) {
        const key = 'ug:' + ug.id;
        let c = groupCache.get(key);
        if (!c) {
          c = new THREE.Group();
          c.name = ug.name;
          c.userData.isUserGroup = true;
          root.add(c);
          groupCache.set(key, c);
        }
        return c;
      }
      const chain = partToTreeChain.get(part.partId);
      if (!chain || chain.length === 0) return root;
      let parent = root;
      let cumKey = '';
      for (const gid of chain) {
        cumKey += '/' + gid;
        let c = groupCache.get(cumKey);
        if (!c) {
          const tn = treeNodeById.get(gid);
          c = new THREE.Group();
          c.name = (tn && tn.name) ? tn.name : 'Group';
          parent.add(c);
          groupCache.set(cumKey, c);
        }
        parent = c;
      }
      return parent;
    }

    // ── Geometry sharing ─────────────────────────────────────────────────
    // CRITICAL for file size: GLTFExporter dedupes geometries by REFERENCE
    // identity. If we clone per-part, every "instance" of a 5000-vertex
    // screw becomes 5000 unique vertices in the GLB. For an auto-instanced
    // CAD model with 100 copies of one bracket, that's 100× the source
    // vertex data — and explains files growing larger than the original.
    //
    // Share one cloned geometry across every part with the same hash so
    // the exporter's dedup pass can fold them into a single buffer with N
    // node transforms. Cloning is still needed (rather than using the
    // source directly) because PLY's post-process injects per-vertex
    // colors and would mutate the live scene; the PLY caller does its own
    // per-mesh re-clone before injecting.
    //
    // applyMatrix4 below modifies the MESH's matrix only, never the
    // geometry, so sharing is safe across all formats.
    const sharedGeom = new Map();   // hash → cloned BufferGeometry
    const getSharedGeom = (hash, src) => {
      let geom = sharedGeom.get(hash);
      if (!geom) {
        geom = src.clone();
        // Drop the BVH bounds tree from the export clone — it's not a
        // standard BufferAttribute (GLTFExporter would skip it anyway), but
        // disposing here returns the typed-array memory immediately rather
        // than waiting for GC after the export root is thrown away.
        if (geom.boundsTree) geom.disposeBoundsTree?.();
        sharedGeom.set(hash, geom);
      }
      return geom;
    };

    for (const p of state.parts) {
      if (p.deleted) continue;
      if (visibleOnly && !p.visible) continue;
      const g = state.geomByHash.get(p.hash);
      if (!g) continue;

      // Clone the LIVE material so any user edits (color, metalness, roughness,
      // textures) survive the export. Override .color from p.originalColor in
      // case the live material is shared and currently tinted by selection
      // highlight. Fall back to a fresh PBR mat when the part has no live
      // material (e.g., instanced mesh path where mat lives on instancedMesh).
      let mat;
      const srcMat = p.mesh?.material;
      if (srcMat && !Array.isArray(srcMat) && srcMat.isMaterial) {
        mat = srcMat.clone();
        if (mat.color) mat.color.copy(p.originalColor);
      } else {
        mat = new THREE.MeshStandardMaterial({ color: p.originalColor.clone(), metalness: 0.15, roughness: 0.55 });
      }

      const world = _resolvePartWorldMatrix(p);
      const final = new THREE.Matrix4().multiplyMatrices(postMat, world);
      // Cinema-4D / Blender exported GLBs frequently carry SHEAR in deep
      // ancestor transforms (rotation × non-uniform scale). FBX's
      // Lcl Translation/Rotation/Scaling — and Three.js's Matrix4.decompose
      // — can ONLY represent T/R/S; shear is silently zeroed. If we let
      // such a transform live on mesh.matrix, decomposers downstream
      // (FBX writer, GLTFExporter's node transforms) will drop the shear
      // and the part comes out visibly rotated wrong. Detect shear here
      // and bake it into the geometry vertices for the offending part.
      // Cost: a per-part geometry clone, no sharing. Affects only sheared
      // parts; well-formed CAD models pay nothing.
      let geom, m;
      if (_matrixHasShear(final)) {
        // Bake shear into vertices. Mesh transform is identity so the FBX
        // / GLTF writer can decompose without losing anything.
        const baked = g.clone();
        if (baked.boundsTree) baked.disposeBoundsTree?.();
        baked.applyMatrix4(final);
        geom = baked;
        m = new THREE.Mesh(geom, mat);
        m.name = p.name;
      } else {
        geom = getSharedGeom(p.hash, g);
        m = new THREE.Mesh(geom, mat);
        m.name = p.name;
        // No shear — safe to live on mesh.matrix. Container groups are at
        // identity, so the baked world transform on the mesh produces the
        // correct world pose. Geometry remains shareable across instances.
        m.applyMatrix4(final);
      }
      getContainer(p).add(m);
      count++;
    }
    return { root, count };
  }

  // Merge path: every part's vertices are transformed and concatenated into a
  // single buffer. Two-pass — pass 1 sums sizes so we can allocate typed arrays
  // up front; pass 2 fills them at known offsets. The previous single-pass
  // version pushed into JS arrays, which on a large model meant millions of
  // Array.push calls and many GC stalls during reallocation.
  const validParts = [];
  let totalVerts = 0, totalIdxLen = 0;
  let hasNormals = true;
  for (const p of state.parts) {
    if (p.deleted) continue;
    if (visibleOnly && !p.visible) continue;
    const g = state.geomByHash.get(p.hash);
    if (!g) continue;
    const pos = g.attributes.position?.array;
    if (!pos) continue;
    const nrm = g.attributes.normal?.array;
    const idx = g.index?.array;
    const vCount = pos.length / 3;
    const iLen   = idx ? idx.length : vCount;
    if (!nrm) hasNormals = false;
    validParts.push({ p, pos, nrm, idx, vCount, iLen });
    totalVerts  += vCount;
    totalIdxLen += iLen;
  }
  if (validParts.length === 0) return { root, count: 0 };

  const positions = new Float32Array(totalVerts * 3);
  const colors    = new Float32Array(totalVerts * 3);
  const normals   = hasNormals ? new Float32Array(totalVerts * 3) : null;
  const indexCtor = totalVerts > 65535 ? Uint32Array : Uint16Array;
  const indices   = new indexCtor(totalIdxLen);

  let posOff = 0, idxOff = 0, vertBase = 0;
  const v3 = new THREE.Vector3();
  const n3 = new THREE.Vector3();
  for (const { p, pos, nrm, idx, vCount, iLen } of validParts) {
    const world = _resolvePartWorldMatrix(p);
    const final = new THREE.Matrix4().multiplyMatrices(postMat, world);
    const normalMat = new THREE.Matrix3().getNormalMatrix(final);
    const cr = p.originalColor.r, cg = p.originalColor.g, cb = p.originalColor.b;

    for (let i = 0; i < vCount; i++) {
      v3.set(pos[i*3], pos[i*3+1], pos[i*3+2]).applyMatrix4(final);
      positions[posOff]     = v3.x;
      positions[posOff + 1] = v3.y;
      positions[posOff + 2] = v3.z;
      colors[posOff]        = cr;
      colors[posOff + 1]    = cg;
      colors[posOff + 2]    = cb;
      posOff += 3;
    }
    if (normals && nrm) {
      let nOff = posOff - vCount * 3;
      for (let i = 0; i < vCount; i++) {
        n3.set(nrm[i*3], nrm[i*3+1], nrm[i*3+2]).applyMatrix3(normalMat).normalize();
        normals[nOff]     = n3.x;
        normals[nOff + 1] = n3.y;
        normals[nOff + 2] = n3.z;
        nOff += 3;
      }
    }
    if (idx) {
      for (let i = 0; i < iLen; i++) indices[idxOff + i] = idx[i] + vertBase;
    } else {
      for (let i = 0; i < iLen; i++) indices[idxOff + i] = i + vertBase;
    }
    idxOff   += iLen;
    vertBase += vCount;
    count++;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (normals) merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.1, roughness: 0.6 });
  root.add(new THREE.Mesh(merged, mat));
  return { root, count };
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
}

// Walk every Mesh in the export root and re-normalize its normal attribute
// in place. After multiple matrix applies (world transform, axis flip, scale)
// individual normals drift to magnitudes ~1 ± a few ULP — enough for
// GLTFExporter's strict check to log "Creating normalized normal attribute"
// once per mesh and produce a corrected copy in memory. Doing one final
// renormalize pass here keeps the original buffer authoritative and silences
// the warning cleanly.
// Lazy-load gltf-transform + draco3dgltf and use them to re-encode a GLB
// with KHR_draco_mesh_compression. Three.js ships only a Draco DECODER, not
// an encoder, so we delegate to gltf-transform which has first-class Draco
// integration plus a browser-friendly WebIO. Modules are pulled from esm.sh
// at click time (cached on first use), so users who never check the Draco
// box never pay the ~2 MB download.
//
// Compression typically shrinks the GLB 5–20× on vertex data; in exchange,
// loading is slower (decoder runs in main thread or worker depending on
// host) and very-low-poly meshes can occasionally end up LARGER due to
// per-primitive overhead. The exporter writes the uncompressed file as
// `step_optimized.glb` and the compressed one as `step_optimized.draco.glb`
// so the user can compare.
let _dracoCachedModules = null;

// Inject a UMD <script> and resolve once it's loaded. Used to pull the
// Google-hosted Draco encoder/decoder which are browser-targeted UMDs.
// (The npm package `draco3dgltf` is Node-only — it imports `fs`, and
// every JS-package CDN we tried — esm.sh, jsdelivr, skypack — refuses
// to bundle that for browsers.)
function _loadUmdScript(url) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-umd="' + url + '"]');
    if (existing && existing.dataset.loaded === '1') { resolve(); return; }
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('script load failed: ' + url)));
      return;
    }
    const s = document.createElement('script');
    s.src = url;
    s.async = true;
    s.dataset.umd = url;
    s.addEventListener('load',  () => { s.dataset.loaded = '1'; resolve(); });
    s.addEventListener('error', () => reject(new Error('script load failed: ' + url)));
    document.head.appendChild(s);
  });
}

async function _loadDracoToolchain() {
  if (_dracoCachedModules) return _dracoCachedModules;
  // Strategy:
  //   * gltf-transform packages: pure JS, work fine via esm.sh / jsdelivr
  //     ESM bundling. Try jsdelivr first (faster on most networks).
  //   * Draco encoder/decoder: load Google's gstatic-hosted UMDs. These
  //     are the same wasm modules `three/examples/jsm/libs/draco` uses for
  //     the decoder; gstatic also hosts the encoder at the same versioned
  //     path. They expose DracoEncoderModule/DracoDecoderModule globals.
  //     Crucially: built for browsers (no fs imports), unlike the npm
  //     `draco3dgltf` package we fought for two iterations.
  const tryImport = async (urls) => {
    let lastErr = null;
    for (const u of urls) {
      try { return await import(u); }
      catch (e) { lastErr = e; console.warn('[draco] CDN miss:', u, e?.message || e); }
    }
    throw lastErr;
  };
  const DRACO_VER = '1.5.7';
  const [core, ext, fns] = await Promise.all([
    tryImport([
      'https://cdn.jsdelivr.net/npm/@gltf-transform/core@4.1.0/+esm',
      'https://esm.sh/@gltf-transform/core@4.1.0',
    ]),
    tryImport([
      'https://cdn.jsdelivr.net/npm/@gltf-transform/extensions@4.1.0/+esm',
      'https://esm.sh/@gltf-transform/extensions@4.1.0',
    ]),
    tryImport([
      'https://cdn.jsdelivr.net/npm/@gltf-transform/functions@4.1.0/+esm',
      'https://esm.sh/@gltf-transform/functions@4.1.0',
    ]),
  ]);
  // Try a list of UMD URLs in order; first one that loads wins.
  const _trySrc = async (urls) => {
    let lastErr = null;
    for (const u of urls) {
      try { await _loadUmdScript(u); return; }
      catch (e) { lastErr = e; console.warn('[draco] UMD miss:', u, e?.message || e); }
    }
    throw lastErr;
  };
  // We vendor draco3d's "*_nodejs.js" files locally as draco_encoder.js /
  // draco_decoder.js. Despite the misleading "nodejs" suffix in upstream,
  // they're UNIVERSAL Emscripten builds — they detect Node-vs-browser at
  // runtime and use XMLHttpRequest to fetch the .wasm sibling in browsers.
  // Loaded as a plain <script> tag (NOT ESM import), they sidestep esm.sh /
  // jsdelivr / skypack ESM-bundlers that all choked on the conditional
  // require("fs"). The .wasm sibling lives next to the .js, so the XHR
  // path resolves to ./vendor/draco/draco_encoder.wasm automatically.
  // CDN URLs are kept as fallback in case a user runs the page from a
  // location where the local files weren't unpacked.
  await Promise.all([
    _trySrc([
      './vendor/draco/draco_encoder.js',
      `https://unpkg.com/draco3d@${DRACO_VER}/draco_encoder_nodejs.js`,
      `https://cdn.jsdelivr.net/npm/draco3d@${DRACO_VER}/draco_encoder_nodejs.js`,
    ]),
    _trySrc([
      './vendor/draco/draco_decoder.js',
      `https://unpkg.com/draco3d@${DRACO_VER}/draco_decoder_nodejs.js`,
      `https://cdn.jsdelivr.net/npm/draco3d@${DRACO_VER}/draco_decoder_nodejs.js`,
    ]),
  ]);
  if (typeof window.DracoEncoderModule !== 'function' || typeof window.DracoDecoderModule !== 'function') {
    throw new Error('Draco UMDs loaded but globals (DracoEncoderModule/DracoDecoderModule) missing — gstatic build mismatch?');
  }
  // Lift Google's factories into the shape gltf-transform expects: an object
  // with createEncoderModule / createDecoderModule async functions returning
  // the initialised Module. Google's factory IS the initialiser — calling
  // it returns a Promise resolving to the Module — so we just rename it.
  const draco3d = {
    createEncoderModule: () => Promise.resolve(window.DracoEncoderModule()),
    createDecoderModule: () => Promise.resolve(window.DracoDecoderModule()),
  };
  _dracoCachedModules = { core, ext, fns, draco3d };
  return _dracoCachedModules;
}

async function _compressGLBWithDraco(glbUint8) {
  const { core, ext, fns, draco3d } = await _loadDracoToolchain();
  // esm.sh sometimes wraps CommonJS modules so the named export lives on
  // .default. Try both shapes for every symbol so we don't break when a
  // future package version flips between them.
  const pick = (mod, name) => mod?.[name] ?? mod?.default?.[name];
  const WebIO = pick(core, 'WebIO');
  const KHRDracoMeshCompression = pick(ext, 'KHRDracoMeshCompression');
  const dracoFn = pick(fns, 'draco');
  const createEncoder = pick(draco3d, 'createEncoderModule');
  const createDecoder = pick(draco3d, 'createDecoderModule');
  const missing = [];
  if (!WebIO) missing.push('WebIO');
  if (!KHRDracoMeshCompression) missing.push('KHRDracoMeshCompression');
  if (!dracoFn) missing.push('draco()');
  if (!createEncoder) missing.push('createEncoderModule');
  if (!createDecoder) missing.push('createDecoderModule');
  if (missing.length) throw new Error('Missing Draco toolchain symbols: ' + missing.join(', '));

  // Encoder for writing, decoder for reading the file we just produced —
  // gltf-transform validates round-trip on writeBinary.
  const [encoder, decoder] = await Promise.all([createEncoder(), createDecoder()]);

  const io = new WebIO()
    .registerExtensions([KHRDracoMeshCompression])
    .registerDependencies({
      'draco3d.encoder': encoder,
      'draco3d.decoder': decoder,
    });

  const document = await io.readBinary(glbUint8);
  // edgebreaker = best compression for triangle meshes (CAD's bread and
  // butter). Quantization defaults are reasonable; tightening them shrinks
  // further but introduces visible vertex snapping.
  await document.transform(dracoFn({ method: 'edgebreaker' }));
  const compressed = await io.writeBinary(document);
  // gltf-transform returns a Uint8Array; Blob accepts either, but normalize
  // to ArrayBuffer for consistency with the unwrapped GLTFExporter result.
  return compressed instanceof Uint8Array ? compressed.buffer : compressed;
}

function _normalizeNormalsInPlace(root) {
  let touched = 0;
  // Dedup: buildExportRoot shares one geometry across all parts with the
  // same hash, so a 100-instance model would otherwise visit the same buffer
  // 100 times. The first pass normalizes it; the next 99 read post-normalized
  // values and no-op. Skip them outright.
  const seenGeoms = new WeakSet();
  root.traverse(o => {
    if (!o.isMesh) return;
    const geom = o.geometry;
    if (!geom || seenGeoms.has(geom)) return;
    seenGeoms.add(geom);
    const nrm = geom.attributes?.normal;
    if (!nrm) return;
    const arr = nrm.array;
    const n = nrm.count;
    // Always normalize — GLTFExporter uses a STRICTER check than the previous
    // 1e-6 tolerance (it flags any |m-1| > 5e-4 with the "Creating normalized
    // normal attribute" warning, once per mesh). Spamming that warning across
    // 1000+ meshes both noises up the console and forces the exporter to
    // build a corrected COPY of every normal buffer in memory — measurable
    // RAM overhead on big assemblies. A single sqrt+mul per vertex here is
    // free in comparison.
    for (let i = 0; i < n; i++) {
      const x = arr[i*3], y = arr[i*3+1], z = arr[i*3+2];
      const m2 = x*x + y*y + z*z;
      if (m2 > 0) {
        const inv = 1 / Math.sqrt(m2);
        arr[i*3]   = x * inv;
        arr[i*3+1] = y * inv;
        arr[i*3+2] = z * inv;
      }
    }
    nrm.needsUpdate = true;
    touched++;
  });
  if (touched > 0) Log.debug(`pre-export: re-normalized normals on ${touched} unique geometries`, { tag: 'export' });
}

// Estimate total vertex count in the export root. Used to scale the OBJ
// stream-flush threshold and decide whether to warn the user about file size.
function _countExportVerts(root) {
  let v = 0;
  root.traverse(o => {
    if (o.isMesh && o.geometry?.attributes?.position) {
      v += o.geometry.attributes.position.count;
    }
  });
  return v;
}

// Streaming OBJ exporter — bypasses V8's ~500 MB single-string limit.
//
// three.js's stock OBJExporter builds one giant string and returns it. For a
// 10M-vertex model that string is ~300 MB; V8 caps single strings at ~500 MB
// and concat operations at ~256 MB on some builds, so the user sees
// "Invalid string length" and the download fails outright.
//
// This version writes per-mesh chunks into a BlobPart array. Each chunk is
// capped at TARGET_CHUNK bytes of UTF-8 — small enough that V8's string
// concat path stays in the fast lane, large enough that we don't churn out
// millions of tiny array entries. The final Blob has no total-size limit.
//
// Numeric formatting matches three.js's OBJExporter (default toString()).
// ───────────────────────────────────────────────────────────────────
// ASCII FBX exporter (version 7400 / "FBX 2014").
// Why hand-rolled: three.js doesn't ship an FBX exporter, and the only
// npm options are CDN-hosted (we just got burned by the Draco CDN
// saga, so any new export format earns its own self-contained writer).
// What's supported: per-mesh triangle geometry, vertex normals, per-mesh
// diffuse color material, world-space transforms baked into vertices.
// Hierarchy and shared geometry are flattened — every visible mesh
// becomes its own FBX Model + Geometry + Material triplet. Cinema 4D,
// Blender, Maya, 3ds Max, and Houdini all read this dialect.
// ───────────────────────────────────────────────────────────────────
// Lazy-load assimpjs (a 4 MB wasm port of Open Asset Import Library) on
// first FBX export. Cached for subsequent calls so the user only pays the
// download / instantiation cost once per session.
let _assimpReady = null;
async function _getAssimp() {
  if (_assimpReady) return _assimpReady;
  _assimpReady = (async () => {
    if (typeof window.assimpjs !== 'function') {
      // Vendored locally first so the app works offline. CDN fallback only
      // for installs where vendor/ wasn't unpacked alongside index.html.
      const trySrc = async (urls) => {
        let lastErr = null;
        for (const u of urls) {
          try { await _loadUmdScript(u); return; }
          catch (e) { lastErr = e; console.warn('[assimp] script miss:', u, e?.message || e); }
        }
        throw lastErr;
      };
      await trySrc([
        './vendor/assimp/assimpjs.js',
        'https://cdn.jsdelivr.net/npm/assimpjs@0.0.10/dist/assimpjs.js',
      ]);
    }
    if (typeof window.assimpjs !== 'function') {
      throw new Error('assimpjs failed to register globally');
    }
    // assimpjs() takes an optional locateFile() that lets us point at the
    // local .wasm. Without it Emscripten guesses based on the .js URL,
    // which usually works but isn't guaranteed when the .js is cached
    // from CDN while .wasm is local (or vice versa).
    return await window.assimpjs({
      locateFile: (file) => {
        if (file.endsWith('.wasm')) {
          // Same-directory rule: try local vendor path first, fall back
          // to wherever Emscripten would've guessed.
          return './vendor/assimp/' + file;
        }
        return file;
      },
    });
  })();
  return _assimpReady;
}

// Run an in-memory format conversion via Assimp. `inputBytes` is a Uint8Array
// holding any format Assimp can import (GLB is what we use here); `targetFmt`
// is one of Assimp's exporter ids — 'fbx' (binary), 'fbxa' (ASCII), 'gltf2',
// 'glb2', 'collada', 'obj', 'stl', '3ds', 'ply', 'x3d'. Returns a Uint8Array
// of the converted file. Throws on failure with the Assimp error string.
async function _convertGlbWithAssimp(inputBytes, targetFmt) {
  const ajs = await _getAssimp();
  const fileList = new ajs.FileList();
  // The path doesn't matter for a single-file in-memory pipeline, but
  // Assimp uses the EXTENSION to pick an importer. ".glb" is unambiguous.
  fileList.AddFile('input.glb', inputBytes);
  const result = ajs.ConvertFileList(fileList, targetFmt);
  if (!result.IsSuccess() || result.FileCount() === 0) {
    // GetErrorCode() returns a short token like "export_error" without
    // detail. Assimp's full message is on the result via different methods
    // depending on assimpjs version — try them all and surface whichever
    // we find. Without this, every FBX failure shows the same generic
    // string and gives the user nothing to act on.
    let detail = '';
    try { detail = result.GetErrorString?.() || result.GetError?.() || result.GetErrorCode?.() || ''; } catch (_) {}
    throw new Error(`Assimp ${targetFmt} export failed: ${detail || 'unknown'}`);
  }
  // For most formats we get a single output file. (FBX with separate
  // textures could split, but our scene has none.)
  const out = result.GetFile(0);
  return out.GetContent();
}

// FBX via Assimp. Tries binary FBX first ('fbx') because that's what
// Cinema 4D, Houdini, and Maya prefer. Falls back to ASCII FBX ('fbxa')
// if the binary exporter in this assimpjs build reports an error.
async function _convertGlbToFbx(inputBytes) {
  const errors = [];
  for (const fmt of ['fbx', 'fbxa']) {
    try {
      return { bytes: await _convertGlbWithAssimp(inputBytes, fmt), fmt };
    } catch (e) {
      errors.push(`${fmt}: ${e.message || e}`);
    }
  }
  throw new Error('FBX export failed (tried fbx + fbxa). ' + errors.join(' | '));
}

// ── Binary FBX writer ─────────────────────────────────────────────────────
// FBX 7.4 binary spec: 27-byte header + recursively-encoded nodes + 13-byte
// null terminator + optional 168-byte footer. Each node records the absolute
// file offset of its end byte so the parser can jump over it; we backfill
// those during a single-pass write via patchUint32LE. Large array properties
// (vertex positions, indices, normals) are zlib-compressed via the browser's
// CompressionStream — that's where the bulk of the 3× shrink vs ASCII comes
// from.
//
// Designed to mirror the ASCII writer's output exactly so DCC tools see an
// identical scene; only the on-disk encoding changes.

class _FbxBinWriter {
  constructor() {
    this.buf = new ArrayBuffer(64 * 1024);
    this.view = new DataView(this.buf);
    this.bytes = new Uint8Array(this.buf);
    this.pos = 0;
  }
  _ensure(n) {
    if (this.pos + n <= this.buf.byteLength) return;
    let cap = this.buf.byteLength;
    while (this.pos + n > cap) cap *= 2;
    const nb = new ArrayBuffer(cap);
    new Uint8Array(nb).set(this.bytes.subarray(0, this.pos));
    this.buf = nb;
    this.view = new DataView(nb);
    this.bytes = new Uint8Array(nb);
  }
  u8(v)  { this._ensure(1); this.view.setUint8(this.pos, v); this.pos += 1; }
  i16(v) { this._ensure(2); this.view.setInt16(this.pos, v, true); this.pos += 2; }
  i32(v) { this._ensure(4); this.view.setInt32(this.pos, v, true); this.pos += 4; }
  u32(v) { this._ensure(4); this.view.setUint32(this.pos, v >>> 0, true); this.pos += 4; }
  // u64 / patchU64: split a JS Number (safe up to 2^53 — well above the
  // 4 GB FBX 7.4 limit) into two uint32s. Avoids BigInt allocation per
  // write, which adds up over the millions of offsets in a real export.
  u64(v) {
    this._ensure(8);
    const lo = v >>> 0;
    const hi = Math.floor(v / 4294967296) >>> 0;
    this.view.setUint32(this.pos, lo, true);
    this.view.setUint32(this.pos + 4, hi, true);
    this.pos += 8;
  }
  patchU64(at, v) {
    const lo = v >>> 0;
    const hi = Math.floor(v / 4294967296) >>> 0;
    this.view.setUint32(at, lo, true);
    this.view.setUint32(at + 4, hi, true);
  }
  f32(v) { this._ensure(4); this.view.setFloat32(this.pos, v, true); this.pos += 4; }
  f64(v) { this._ensure(8); this.view.setFloat64(this.pos, v, true); this.pos += 8; }
  i64(v) { this._ensure(8); this.view.setBigInt64(this.pos, BigInt(v), true); this.pos += 8; }
  bytes_(b) { this._ensure(b.byteLength); this.bytes.set(b, this.pos); this.pos += b.byteLength; }
  patchU32(at, v) { this.view.setUint32(at, v >>> 0, true); }
  finalize() { return new Uint8Array(this.buf, 0, this.pos); }
}

async function _fbxDeflate(bytes) {
  // FBX encoding=1 means RFC 1950 (zlib): 2-byte CMF/FLG header + raw
  // DEFLATE stream + 4-byte Adler-32 checksum (big-endian).
  //
  // We MUST NOT use CompressionStream('deflate') directly: the W3C spec
  // only clarified that 'deflate' = RFC 1950 in late 2022, and Chrome
  // shipped raw DEFLATE for 'deflate' until ~Chrome 106. Using deflate-raw
  // and adding the RFC 1950 framing ourselves guarantees the FBX SDK's
  // zlib decompressor accepts it in Houdini, C4D, Maya, and 3ds Max.
  //
  // Step 1: Adler-32 of the uncompressed input (RFC 1950 requires it).
  let adlerA = 1, adlerB = 0;
  for (let i = 0; i < bytes.length; i++) {
    adlerA = (adlerA + bytes[i]) % 65521;
    adlerB = (adlerB + adlerA) % 65521;
  }

  // Step 2: Raw DEFLATE (no zlib header, no checksum).
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const reader = cs.readable.getReader();
  const rawChunks = [];
  let rawTotal = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    rawChunks.push(value); rawTotal += value.byteLength;
  }

  // Step 3: Assemble RFC 1950: [CMF=0x78, FLG=0x9C] + deflate + Adler-32.
  // 0x78 = deflate + 32 KB window. 0x9C = check bits such that
  // (0x78<<8 | 0x9C) % 31 == 0 — RFC 1950 header validity requirement.
  const out = new Uint8Array(2 + rawTotal + 4);
  out[0] = 0x78; out[1] = 0x9C;
  let off = 2;
  for (const c of rawChunks) { out.set(c, off); off += c.byteLength; }
  // Adler-32 written big-endian in the last 4 bytes.
  // Use >>> 0 to keep the shift unsigned — without it, adlerB > 0x7FFF
  // would produce a negative signed value and corrupt the checksum.
  new DataView(out.buffer).setUint32(2 + rawTotal, ((adlerB << 16) >>> 0) | adlerA, false);
  return out;
}

const _FBX_TENC = new TextEncoder();

function _fbxWriteScalarProp(w, type, value) {
  w.u8(type.charCodeAt(0));
  switch (type) {
    case 'Y': w.i16(value); break;
    case 'C':
      // 'C' is a single byte — FBX SDK convention uses ASCII 'Y'/'N' (89/78)
      // for boolean-ish flags rather than 0/1. Accept either: a JS boolean
      // becomes 'Y'/'N', a number gets written verbatim (caller can pass
      // 89 directly when matching the SDK style).
      if (typeof value === 'boolean') w.u8(value ? 89 : 78);
      else w.u8(value | 0);
      break;
    case 'I': w.i32(value); break;
    case 'F': w.f32(value); break;
    case 'D': w.f64(value); break;
    case 'L': w.i64(value); break;
    case 'S':
    case 'R': {
      const buf = typeof value === 'string' ? _FBX_TENC.encode(value) : value;
      w.u32(buf.byteLength);
      w.bytes_(buf);
      break;
    }
  }
}

async function _fbxWriteArrayProp(w, type, array) {
  // type ∈ {'f','d','l','i','b'} → element typed buffer
  w.u8(type.charCodeAt(0));
  let raw;
  switch (type) {
    case 'f': raw = new Uint8Array(new Float32Array(array).buffer); break;
    case 'd': raw = new Uint8Array(new Float64Array(array).buffer); break;
    case 'i': raw = new Uint8Array(new Int32Array(array).buffer); break;
    case 'l': {
      const big = new BigInt64Array(array.length);
      for (let i = 0; i < array.length; i++) big[i] = BigInt(array[i]);
      raw = new Uint8Array(big.buffer);
      break;
    }
    case 'b': raw = new Uint8Array(array); break;
  }
  w.u32(array.length);
  // Match Blender's encode_bin.py threshold exactly:
  //   encoding = 0 (raw)  if len(data) <= 128
  //   encoding = 1 (zlib) if len(data) >  128
  // Small arrays (e.g. Materials:[0] = 4 bytes) stay uncompressed.
  // Large arrays (vertex positions, indices) get zlib.
  const encoding = raw.byteLength <= 128 ? 0 : 1;
  const payload = encoding === 1 ? await _fbxDeflate(raw) : raw;
  w.u32(encoding);
  w.u32(payload.byteLength);
  w.bytes_(payload);
}

// FBX node tree node:
// { name: 'Foo', props: [{type:'I', value: 7}, ...], children: [...] }
//
// FBX 7.4 binary uses 32-bit fields for the node header. Matching Blender's
// exporter exactly — Blender writes 7.4 (32-bit) and its files load
// universally including C4D 2026. The 64-bit format only matters for
// >4 GB single-file exports.
async function _fbxWriteNode(w, n) {
  const headerStart = w.pos;
  w.u32(0);                 // end_offset (patched at end)
  w.u32(n.props ? n.props.length : 0);
  const propLenPos = w.pos;
  w.u32(0);                 // property_list_len (patched after props)
  const nameBuf = _FBX_TENC.encode(n.name || '');
  w.u8(nameBuf.byteLength);
  w.bytes_(nameBuf);

  const propStart = w.pos;
  if (n.props) {
    for (const p of n.props) {
      // Lowercase array types ('f','d','l','i','b') vs uppercase scalar types
      // ('Y','C','I','F','D','L','S','R'). Single-char unambiguous routing.
      if (p.type === 'f' || p.type === 'd' || p.type === 'l' || p.type === 'i' || p.type === 'b') {
        await _fbxWriteArrayProp(w, p.type, p.value);
      } else {
        _fbxWriteScalarProp(w, p.type, p.value);
      }
    }
  }
  w.patchU32(propLenPos, w.pos - propStart);

  // Write a null-record terminator whenever `children` is PRESENT — even an
  // empty array. Strict FBX importers (Cinema 4D, Maya, FBX SDK validators)
  // walk container nodes assuming there'll be a terminator, and freak out
  // when a node like `References` (which is canonically empty but is a
  // container by spec) has no terminator. Use `children: undefined` to mark
  // a true leaf node with no terminator.
  const hasKidsField = n.children !== undefined;
  if (hasKidsField) {
    for (const c of n.children) {
      await _fbxWriteNode(w, c);
    }
    // Null record (13 bytes for FBX 7.4: three uint32 + one uint8).
    w.u32(0); w.u32(0); w.u32(0); w.u8(0);
  }
  w.patchU32(headerStart, w.pos);
}

// ── FBX scene-tree builder shared by ASCII and binary writers ─────────────
// Walks the export root, dedupes materials by RGB hex, bakes each mesh's
// matrixWorld into a per-mesh world-space copy of the source positions/
// normals (FBX has no shear support — bake-in-vertices avoids decompose
// loss for deeply-nested transforms), and returns a flat list of nodes
// with parent indices ready for either backend to emit.
function _collectFbxScene(root) {
  root.updateMatrixWorld(true);
  const nodes = [];                 // { obj, parentIdx, type: 'Null' | 'Mesh' }
  const objToIdx = new Map();
  function visit(obj, parentIdx) {
    if (obj === root) {
      objToIdx.set(obj, -1);
    } else {
      const isMesh = !!obj.isMesh;
      if (isMesh && obj.visible === false) return;
      if (isMesh && !obj.geometry?.attributes?.position) return;
      const idx = nodes.length;
      nodes.push({ obj, parentIdx, type: isMesh ? 'Mesh' : 'Null' });
      objToIdx.set(obj, idx);
      parentIdx = idx;
    }
    if (obj.children) for (const c of obj.children) visit(c, parentIdx);
  }
  visit(root, -1);

  // Prune empty Null nodes (those with no Mesh descendants).
  {
    const liveDescendantCount = new Array(nodes.length).fill(0);
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const mine = n.type === 'Mesh' ? 1 : 0;
      if (n.parentIdx >= 0) liveDescendantCount[n.parentIdx] += mine + liveDescendantCount[i];
      liveDescendantCount[i] += mine;
    }
    const keep = nodes.map((n, i) => n.type === 'Mesh' || liveDescendantCount[i] > 0);
    if (keep.some(k => !k)) {
      const remap = new Array(nodes.length).fill(-1);
      const filtered = [];
      for (let i = 0; i < nodes.length; i++) {
        if (!keep[i]) continue;
        remap[i] = filtered.length;
        const n = nodes[i];
        let p = n.parentIdx;
        while (p >= 0 && !keep[p]) p = nodes[p].parentIdx;
        filtered.push({ obj: n.obj, parentIdx: p < 0 ? -1 : remap[p], type: n.type });
      }
      nodes.length = 0;
      for (const n of filtered) nodes.push(n);
    }
  }

  // Material dedup by RGB hex.
  const mats = [];
  const colorHexToIdx = new Map();
  for (const n of nodes) {
    if (n.type !== 'Mesh') continue;
    const c = n.obj.material?.color;
    const r = c ? c.r : 0.8, g = c ? c.g : 0.8, b = c ? c.b : 0.8;
    const key = ((r * 255 | 0) << 16) | ((g * 255 | 0) << 8) | (b * 255 | 0);
    if (!colorHexToIdx.has(key)) {
      colorHexToIdx.set(key, mats.length);
      mats.push({ r, g, b });
    }
  }

  return { nodes, mats, colorHexToIdx };
}

// Bake mesh.matrixWorld into a fresh typed-array of world-space positions
// and (inverse-transposed) normals. Returns { positions, normals?, indices? }
// where indices is a typed array if the source geometry was indexed.
function _fbxBakeMeshGeom(meshObj) {
  const g = meshObj.geometry;
  const posAttr = g.attributes.position;
  const norAttr = g.attributes.normal;
  const idxAttr = g.index;
  const M = meshObj.matrixWorld;
  const N = new THREE.Matrix3().getNormalMatrix(M);
  const tmpV = new THREE.Vector3();
  const tmpN = new THREE.Vector3();

  const out = {};
  const stride = posAttr.itemSize;
  const arr = posAttr.array;
  const positions = new Float64Array(posAttr.count * 3);
  for (let i = 0; i < posAttr.count; i++) {
    tmpV.set(arr[i*stride], arr[i*stride+1], arr[i*stride+2]).applyMatrix4(M);
    positions[i*3]   = tmpV.x;
    positions[i*3+1] = tmpV.y;
    positions[i*3+2] = tmpV.z;
  }
  out.positions = positions;

  // Build the indexed triangle list first — needed for the "ByPolygonVertex"
  // normal layout below. FBX wants the LAST index of every polygon to be
  // bitwise NOT (~i) so the parser can detect polygon ends. We always emit
  // triangulated geometry, so every 3rd index gets the NOT.
  const triCount = idxAttr ? idxAttr.count / 3 : posAttr.count / 3;
  const indices = new Int32Array(triCount * 3);
  if (idxAttr) {
    const ai = idxAttr.array;
    for (let i = 0; i < ai.length; i += 3) {
      indices[i]   = ai[i];
      indices[i+1] = ai[i+1];
      indices[i+2] = ~ai[i+2];
    }
  } else {
    for (let i = 0; i < triCount; i++) {
      const j = i * 3;
      indices[j]   = j;
      indices[j+1] = j + 1;
      indices[j+2] = ~(j + 2);
    }
  }
  out.indices = indices;
  out.triCount = triCount;

  if (norAttr) {
    // Use Direct layout: one normal per polygon-vertex, in polygon-vertex
    // order (same order as PolygonVertexIndex). This is what every reference
    // binary FBX (Blender 2.79, Assimp, Maya) uses and what the FBX SDK
    // expects by default. IndexToDirect is spec-valid but C4D / Houdini's
    // FBX SDK implementation has known issues with it for static meshes —
    // the SDK defaults to Direct when writing, so strict importers test it
    // more thoroughly. No NormalsIndex array needed.
    //
    // normalsDirect: one xyz triple per polygon-vertex.
    // Size = triCount * 3 * 3 doubles = polyVertCount * 3 doubles.
    const nArr = norAttr.array;
    const ns = norAttr.itemSize;
    const polyVertCount = triCount * 3;
    const ai = idxAttr ? idxAttr.array : null;
    const normalsDirect = new Float64Array(polyVertCount * 3);
    for (let i = 0; i < polyVertCount; i++) {
      const vi = ai ? ai[i] : i;   // raw vertex index (no polygon-end NOT)
      tmpN.set(nArr[vi*ns], nArr[vi*ns+1], nArr[vi*ns+2])
          .applyMatrix3(N).normalize();
      normalsDirect[i*3]     = tmpN.x;
      normalsDirect[i*3 + 1] = tmpN.y;
      normalsDirect[i*3 + 2] = tmpN.z;
    }
    out.normalsDirect = normalsDirect;
    // Keep a truthy flag so the geom-node builder knows normals exist.
    out.normals = normalsDirect;
  }
  return out;
}

async function _exportFbxBinary(root) {
  const { nodes, mats, colorHexToIdx } = _collectFbxScene(root);

  const GEOM_ID_BASE  = 100000000;
  const MODEL_ID_BASE = 200000000;
  const MAT_ID_BASE   = 300000000;
  // NodeAttribute IDs: every Model needs an associated NodeAttribute that
  // declares its kind ("Null" for groups, "Mesh" for meshes). C4D 2026's
  // world.cpp:1745 fails to build the scene when Models lack this — every
  // Blender FBX export includes them, which is why Blender's files load
  // in C4D and ours didn't.
  const NA_ID_BASE    = 400000000;

  // Bake one geometry per mesh node (no sharing — see ASCII writer note;
  // sharing requires Lcl Transform on the Mesh Model, which loses precision
  // on deeply-nested CAD imports).
  // Per-mesh materials too — Cinema 4D 2026's FBX importer fails to build
  // the document tree (world.cpp:1745 error) when a single Material is
  // connected to multiple Models. Inspecting C4D's own export confirms it
  // writes 1 material per mesh (no dedup). We follow the same convention
  // here. Slightly larger file (~601 Material entries instead of N unique
  // colors) but C4D-compatible.
  const meshNodes = nodes.filter(n => n.type === 'Mesh');
  const meshIdxToGeomIdx = new Map();
  const meshIdxToMatIdx = new Map();      // per-mesh material index
  const perMeshMats = [];                 // [{ r, g, b }, ...] one entry per mesh
  const bakedGeoms = [];   // index → { meshNodeIndex, baked }
  // Resolve the display colour for a node, falling back to vertex colours for
  // the merge-into-one path (material.vertexColors=true, no material.color).
  const _binResolveColor = (n) => {
    const rawMat = n.obj.material;
    const mat = Array.isArray(rawMat) ? rawMat[0] : rawMat;
    if (mat?.vertexColors && n.obj.geometry?.attributes?.color) {
      const ca = n.obj.geometry.attributes.color;
      return { r: ca.getX(0), g: ca.getY(0), b: ca.getZ(0) };
    }
    const c = mat?.color;
    return c ? { r: c.r, g: c.g, b: c.b } : { r: 0.8, g: 0.8, b: 0.8 };
  };
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].type !== 'Mesh') continue;
    meshIdxToGeomIdx.set(i, bakedGeoms.length);
    bakedGeoms.push({ nodeIdx: i, baked: _fbxBakeMeshGeom(nodes[i].obj) });
    const { r, g, b } = _binResolveColor(nodes[i]);
    meshIdxToMatIdx.set(i, perMeshMats.length);
    perMeshMats.push({
      r, g, b,
    });
  }

  const safeName = (s) => (s || 'unnamed').replace(/["\\]/g, '_').replace(/[\x00-\x1f]/g, '_');

  // Choose a binary type code per "Properties70 P-record" entry. The first
  // type-string slot (t1) tells us the FBX semantic type; we map that to
  // the appropriate scalar code so importers (Maya, Blender) read each
  // value back at its declared precision instead of treating everything
  // as a float (which works for Cinema 4D but corrupts e.g. enum values
  // that should stay as integers).
  const numTypeFor = (t1) => {
    // FBX 'bool' properties are encoded as INT32 even though the type
    // string is "bool". Blender's importer asserts INT32 for bool props
    // (io_scene_fbx/import_fbx.py:269) and rejects the file otherwise.
    // C4D's own export confirms this: P "TranslationActive" "bool" "" "" I:0.
    if (t1 === 'int' || t1 === 'Integer' || t1 === 'enum' || t1 === 'bool') return 'I';
    if (t1 === 'KTime') return 'L';
    return 'D';
  };
  const P = (name, t1, t2, t3, ...vals) => {
    const props = [
      { type: 'S', value: name },
      { type: 'S', value: t1 },
      { type: 'S', value: t2 },
      { type: 'S', value: t3 },
    ];
    const numCode = numTypeFor(t1);
    for (const v of vals) {
      if (typeof v === 'number') {
        if (numCode === 'I') props.push({ type: 'I', value: v | 0 });
        else if (numCode === 'L') props.push({ type: 'L', value: v });
        else props.push({ type: 'D', value: v });
      } else if (typeof v === 'string') {
        props.push({ type: 'S', value: v });
      } else if (typeof v === 'boolean') {
        // FBX 'bool' properties are int32, not 'C' bytes — see numTypeFor.
        props.push({ type: 'I', value: v ? 1 : 0 });
      } else {
        props.push({ type: 'I', value: v });
      }
    }
    return { name: 'P', props };
  };

  // ── Build node tree ────────────────────────────────────────────────────
  const now = new Date();
  const tree = [];

  tree.push({
    name: 'FBXHeaderExtension', props: [], children: [
      { name: 'FBXHeaderVersion', props: [{ type: 'I', value: 1003 }] },
      { name: 'FBXVersion', props: [{ type: 'I', value: 7400 }] },
      { name: 'EncryptionType', props: [{ type: 'I', value: 0 }] },
      { name: 'CreationTimeStamp', props: [], children: [
        { name: 'Version', props: [{ type: 'I', value: 1000 }] },
        { name: 'Year',    props: [{ type: 'I', value: now.getFullYear() }] },
        { name: 'Month',   props: [{ type: 'I', value: now.getMonth() + 1 }] },
        { name: 'Day',     props: [{ type: 'I', value: now.getDate() }] },
        { name: 'Hour',    props: [{ type: 'I', value: now.getHours() }] },
        { name: 'Minute',  props: [{ type: 'I', value: now.getMinutes() }] },
        { name: 'Second',  props: [{ type: 'I', value: now.getSeconds() }] },
        { name: 'Millisecond', props: [{ type: 'I', value: 0 }] },
      ]},
      // Spoof Blender's Creator string. Test whether Cinema 4D 2026's FBX
      // importer has exporter-based rejection. Blender's identity is the
      // safest bet since it's the most commonly tested writer.
      { name: 'Creator', props: [{ type: 'S', value: 'Blender (stable FBX IO) - 4.1.0 - 4.27.1' }] },
      // OtherFlags block removed — Blender doesn't write it and it's not
      // required. C4D may have been treating its presence (with our
      // arbitrary TCDefinition value) as malformed.
      // SceneInfo block — Maya/Cinema 4D treat its absence as malformed.
      // The minimum that satisfies them: type, version, MetaData, Properties70.
      { name: 'SceneInfo',
        props: [
          { type: 'S', value: 'GlobalInfo\x00\x01SceneInfo' },
          { type: 'S', value: 'UserData' },
        ],
        children: [
          { name: 'Type', props: [{ type: 'S', value: 'UserData' }] },
          { name: 'Version', props: [{ type: 'I', value: 100 }] },
          { name: 'MetaData', props: [], children: [
            { name: 'Version', props: [{ type: 'I', value: 100 }] },
            { name: 'Title',    props: [{ type: 'S', value: '' }] },
            { name: 'Subject',  props: [{ type: 'S', value: '' }] },
            { name: 'Author',   props: [{ type: 'S', value: '' }] },
            { name: 'Keywords', props: [{ type: 'S', value: '' }] },
            { name: 'Revision', props: [{ type: 'S', value: '' }] },
            { name: 'Comment',  props: [{ type: 'S', value: '' }] },
          ]},
          // Full 14 P-records exactly matching Blender's SceneInfo. C4D
          // 2026 reads these to identify the file source — incomplete sets
          // contribute to the world.cpp:1745 rejection.
          { name: 'Properties70', props: [], children: [
            P('DocumentUrl', 'KString', 'Url', '', '/foobar.fbx'),
            P('SrcDocumentUrl', 'KString', 'Url', '', '/foobar.fbx'),
            P('Original', 'Compound', '', ''),
            P('Original|ApplicationVendor', 'KString', '', '', 'Blender Foundation'),
            P('Original|ApplicationName', 'KString', '', '', 'Blender (stable FBX IO)'),
            P('Original|ApplicationVersion', 'KString', '', '', '4.1.0'),
            P('Original|DateTime_GMT', 'DateTime', '', '', '01/01/1970 00:00:00.000'),
            P('Original|FileName', 'KString', '', '', '/foobar.fbx'),
            P('LastSaved', 'Compound', '', ''),
            P('LastSaved|ApplicationVendor', 'KString', '', '', 'Blender Foundation'),
            P('LastSaved|ApplicationName', 'KString', '', '', 'Blender (stable FBX IO)'),
            P('LastSaved|ApplicationVersion', 'KString', '', '', '4.1.0'),
            P('LastSaved|DateTime_GMT', 'DateTime', '', '', '01/01/1970 00:00:00.000'),
            P('Original|ApplicationNativeFile', 'KString', '', '', ''),
          ]},
        ],
      },
    ],
  });

  // FileId — 16 bytes of unique-ish data. C4D requires this top-level node.
  // Random bytes are fine; the value isn't validated cryptographically.
  const fileId = new Uint8Array(16);
  for (let i = 0; i < 16; i++) fileId[i] = (Math.random() * 256) | 0;
  tree.push({ name: 'FileId', props: [{ type: 'R', value: fileId }] });
  // CreationTime: use Blender's exact format ("YYYY-MM-DD HH:MM:SS:fff").
  // Various FBX importers parse this string; ISO-8601 with the 'T' / 'Z'
  // characters that JS toISOString() emits is technically valid but C4D
  // 2026 may not handle it.
  const pad = (n, w=2) => String(n).padStart(w, '0');
  const ctstr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}:${pad(now.getMilliseconds(), 3)}`;
  tree.push({ name: 'CreationTime', props: [{ type: 'S', value: ctstr }] });
  tree.push({ name: 'Creator', props: [{ type: 'S', value: 'Blender (stable FBX IO) - 4.1.0 - 4.27.1' }] });

  tree.push({
    name: 'GlobalSettings', props: [], children: [
      { name: 'Version', props: [{ type: 'I', value: 1000 }] },
      { name: 'Properties70', props: [], children: [
        P('UpAxis', 'int', 'Integer', '', 1),
        P('UpAxisSign', 'int', 'Integer', '', 1),
        P('FrontAxis', 'int', 'Integer', '', 2),
        P('FrontAxisSign', 'int', 'Integer', '', 1),
        P('CoordAxis', 'int', 'Integer', '', 0),
        P('CoordAxisSign', 'int', 'Integer', '', 1),
        P('OriginalUpAxis', 'int', 'Integer', '', -1),     // Blender writes -1, not 1
        P('OriginalUpAxisSign', 'int', 'Integer', '', 1),
        P('UnitScaleFactor', 'double', 'Number', '', 1),
        P('OriginalUnitScaleFactor', 'double', 'Number', '', 1),
        P('AmbientColor', 'ColorRGB', 'Color', '', 0, 0, 0),
        P('DefaultCamera', 'KString', '', '', 'Producer Perspective'),
        P('TimeMode', 'enum', '', '', 11),
        P('TimeSpanStart', 'KTime', 'Time', '', 0),
        P('TimeSpanStop', 'KTime', 'Time', '', 46186158000),
        P('CustomFrameRate', 'double', 'Number', '', 24),  // Blender includes this; missing made our P-count = 15 instead of 16
      ]},
    ],
  });

  // ── Documents / References / Takes ──────────────────────────────────────
  // C4D and Maya treat these top-level nodes as required even though they
  // mostly hold placeholder data. Documents binds the scene root; Takes
  // declares animation tracks (we have none); References is empty.
  // Document ID — Cinema 4D uses huge unique IDs (~2 trillion); using a
  // small value like 1 has been observed to make C4D's document-builder
  // mistreat the Document as a sentinel/placeholder. Generate a random
  // 53-bit value (safely representable as a JS number, fits int64).
  const docId = Math.floor(Math.random() * 0x1FFFFFFFFFFFFF);
  tree.push({
    name: 'Documents', props: [], children: [
      { name: 'Count', props: [{ type: 'I', value: 1 }] },
      { name: 'Document',
        props: [
          { type: 'L', value: docId },
          { type: 'S', value: 'Scene' },         // name (Blender uses 'Scene', not '')
          { type: 'S', value: 'Scene' },         // type
        ],
        children: [
          { name: 'Properties70', props: [], children: [
            P('SourceObject', 'object', '', ''),
            P('ActiveAnimStackName', 'KString', '', '', ''),
          ]},
          { name: 'RootNode', props: [{ type: 'L', value: 0 }] },
        ],
      },
    ],
  });
  tree.push({ name: 'References', props: [], children: [] });

  // ── Definitions ─────────────────────────────────────────────────────────
  tree.push({
    name: 'Definitions', props: [], children: [
      { name: 'Version', props: [{ type: 'I', value: 100 }] },
      // Count = number of distinct ObjectType template blocks, NOT total objects.
      // Blender 2.79 writes 3 (GlobalSettings + Geometry + Model) for a scene
      // with 1 of each — confirming this is a template count, not the total
      // object count. The prior formula (sum of all Geometry + Model + Material
      // + NodeAttribute counts) could produce values like 3316 for large CAD
      // scenes, which is technically wrong even if FBX SDK treats it as
      // informational.
      { name: 'Count', props: [{ type: 'I', value:
          1 +                                              // GlobalSettings
          (bakedGeoms.length > 0 ? 1 : 0) +               // Geometry
          (nodes.length > 0 ? 1 : 0) +                    // Model
          (perMeshMats.length > 0 ? 1 : 0) +              // Material
          (nodes.some(n => n.type === 'Null') ? 1 : 0)    // NodeAttribute
      }] },
      { name: 'ObjectType', props: [{ type: 'S', value: 'GlobalSettings' }], children: [
        { name: 'Count', props: [{ type: 'I', value: 1 }] },
      ]},
      { name: 'ObjectType', props: [{ type: 'S', value: 'Geometry' }], children: [
        { name: 'Count', props: [{ type: 'I', value: bakedGeoms.length }] },
        { name: 'PropertyTemplate', props: [{ type: 'S', value: 'FbxMesh' }], children: [
          // Full canonical FbxMesh template — Cinema 4D 2026 cross-checks
          // every property an object overrides against the template; missing
          // base properties make C4D reject the entire file as malformed.
          { name: 'Properties70', props: [], children: [
            P('Color', 'ColorRGB', 'Color', '', 0.8, 0.8, 0.8),
            P('BBoxMin', 'Vector3D', 'Vector', '', 0, 0, 0),
            P('BBoxMax', 'Vector3D', 'Vector', '', 0, 0, 0),
            P('Primary Visibility', 'bool', '', '', 1),
            P('Casts Shadows', 'bool', '', '', 1),
            P('Receive Shadows', 'bool', '', '', 1),
          ]},
        ]},
      ]},
      { name: 'ObjectType', props: [{ type: 'S', value: 'Model' }], children: [
        { name: 'Count', props: [{ type: 'I', value: nodes.length }] },
        { name: 'PropertyTemplate', props: [{ type: 'S', value: 'FbxNode' }], children: [
          // Full canonical FbxNode template (~70 P-records) — what FBX SDK
          // / Cinema 4D / Maya / 3ds Max all write for the Model object
          // type. Order follows the FBX SDK's canonical template.
          { name: 'Properties70', props: [], children: [
            P('QuaternionInterpolate', 'enum', '', '', 0),
            P('RotationOffset', 'Vector3D', 'Vector', '', 0, 0, 0),
            P('RotationPivot', 'Vector3D', 'Vector', '', 0, 0, 0),
            P('ScalingOffset', 'Vector3D', 'Vector', '', 0, 0, 0),
            P('ScalingPivot', 'Vector3D', 'Vector', '', 0, 0, 0),
            P('TranslationActive', 'bool', '', '', 0),
            P('TranslationMin', 'Vector3D', 'Vector', '', 0, 0, 0),
            P('TranslationMax', 'Vector3D', 'Vector', '', 0, 0, 0),
            P('TranslationMinX', 'bool', '', '', 0),
            P('TranslationMinY', 'bool', '', '', 0),
            P('TranslationMinZ', 'bool', '', '', 0),
            P('TranslationMaxX', 'bool', '', '', 0),
            P('TranslationMaxY', 'bool', '', '', 0),
            P('TranslationMaxZ', 'bool', '', '', 0),
            P('RotationOrder', 'enum', '', '', 0),
            P('RotationSpaceForLimitOnly', 'bool', '', '', 0),
            P('RotationStiffnessX', 'double', 'Number', '', 0),
            P('RotationStiffnessY', 'double', 'Number', '', 0),
            P('RotationStiffnessZ', 'double', 'Number', '', 0),
            P('AxisLen', 'double', 'Number', '', 10),
            P('PreRotation', 'Vector3D', 'Vector', '', 0, 0, 0),
            P('PostRotation', 'Vector3D', 'Vector', '', 0, 0, 0),
            P('RotationActive', 'bool', '', '', 0),
            P('RotationMin', 'Vector3D', 'Vector', '', 0, 0, 0),
            P('RotationMax', 'Vector3D', 'Vector', '', 0, 0, 0),
            P('RotationMinX', 'bool', '', '', 0),
            P('RotationMinY', 'bool', '', '', 0),
            P('RotationMinZ', 'bool', '', '', 0),
            P('RotationMaxX', 'bool', '', '', 0),
            P('RotationMaxY', 'bool', '', '', 0),
            P('RotationMaxZ', 'bool', '', '', 0),
            P('InheritType', 'enum', '', '', 0),
            P('ScalingActive', 'bool', '', '', 0),
            P('ScalingMin', 'Vector3D', 'Vector', '', 0, 0, 0),
            P('ScalingMax', 'Vector3D', 'Vector', '', 1, 1, 1),
            P('ScalingMinX', 'bool', '', '', 0),
            P('ScalingMinY', 'bool', '', '', 0),
            P('ScalingMinZ', 'bool', '', '', 0),
            P('ScalingMaxX', 'bool', '', '', 0),
            P('ScalingMaxY', 'bool', '', '', 0),
            P('ScalingMaxZ', 'bool', '', '', 0),
            P('GeometricTranslation', 'Vector3D', 'Vector', '', 0, 0, 0),
            P('GeometricRotation', 'Vector3D', 'Vector', '', 0, 0, 0),
            P('GeometricScaling', 'Vector3D', 'Vector', '', 1, 1, 1),
            P('MinDampRangeX', 'double', 'Number', '', 0),
            P('MinDampRangeY', 'double', 'Number', '', 0),
            P('MinDampRangeZ', 'double', 'Number', '', 0),
            P('MaxDampRangeX', 'double', 'Number', '', 0),
            P('MaxDampRangeY', 'double', 'Number', '', 0),
            P('MaxDampRangeZ', 'double', 'Number', '', 0),
            P('MinDampStrengthX', 'double', 'Number', '', 0),
            P('MinDampStrengthY', 'double', 'Number', '', 0),
            P('MinDampStrengthZ', 'double', 'Number', '', 0),
            P('MaxDampStrengthX', 'double', 'Number', '', 0),
            P('MaxDampStrengthY', 'double', 'Number', '', 0),
            P('MaxDampStrengthZ', 'double', 'Number', '', 0),
            P('PreferedAngleX', 'double', 'Number', '', 0),
            P('PreferedAngleY', 'double', 'Number', '', 0),
            P('PreferedAngleZ', 'double', 'Number', '', 0),
            P('LookAtProperty', 'object', '', ''),
            P('UpVectorProperty', 'object', '', ''),
            P('Show', 'bool', '', '', 1),
            P('NegativePercentShapeSupport', 'bool', '', '', 1),
            P('DefaultAttributeIndex', 'int', 'Integer', '', -1),
            P('Freeze', 'bool', '', '', 0),
            P('LODBox', 'bool', '', '', 0),
            P('Lcl Translation', 'Lcl Translation', '', 'A', 0, 0, 0),
            P('Lcl Rotation', 'Lcl Rotation', '', 'A', 0, 0, 0),
            P('Lcl Scaling', 'Lcl Scaling', '', 'A', 1, 1, 1),
            P('Visibility', 'Visibility', '', 'A', 1),
            P('Visibility Inheritance', 'Visibility Inheritance', '', '', 1),
          ]},
        ]},
      ]},
      { name: 'ObjectType', props: [{ type: 'S', value: 'Material' }], children: [
        { name: 'Count', props: [{ type: 'I', value: perMeshMats.length }] },
        { name: 'PropertyTemplate', props: [{ type: 'S', value: 'FbxSurfacePhong' }], children: [
          // Full canonical FbxSurfacePhong template — every CAD/DCC tool's
          // Phong material derives from this base set of properties.
          { name: 'Properties70', props: [], children: [
            P('ShadingModel', 'KString', '', '', 'Phong'),
            P('MultiLayer', 'bool', '', '', 0),
            P('EmissiveColor', 'Color', '', 'A', 0, 0, 0),
            P('EmissiveFactor', 'Number', '', 'A', 1),
            P('AmbientColor', 'Color', '', 'A', 0.2, 0.2, 0.2),
            P('AmbientFactor', 'Number', '', 'A', 1),
            P('DiffuseColor', 'Color', '', 'A', 0.8, 0.8, 0.8),
            P('DiffuseFactor', 'Number', '', 'A', 1),
            P('Bump', 'Vector3D', 'Vector', '', 0, 0, 0),
            P('NormalMap', 'Vector3D', 'Vector', '', 0, 0, 0),
            P('BumpFactor', 'double', 'Number', '', 1),
            P('TransparentColor', 'Color', '', 'A', 0, 0, 0),
            P('TransparencyFactor', 'Number', '', 'A', 0),
            P('DisplacementColor', 'ColorRGB', 'Color', '', 0, 0, 0),
            P('DisplacementFactor', 'double', 'Number', '', 1),
            P('VectorDisplacementColor', 'ColorRGB', 'Color', '', 0, 0, 0),
            P('VectorDisplacementFactor', 'double', 'Number', '', 1),
            P('SpecularColor', 'Color', '', 'A', 0.2, 0.2, 0.2),
            P('SpecularFactor', 'Number', '', 'A', 1),
            P('ShininessExponent', 'Number', '', 'A', 20),
            P('ReflectionColor', 'Color', '', 'A', 0, 0, 0),
            P('ReflectionFactor', 'Number', '', 'A', 1),
          ]},
        ]},
      ]},
      // NodeAttribute — only include this ObjectType block when there are
      // actually Null/group nodes. Writing it with Count=0 would make
      // Definitions.Count disagree with the actual number of ObjectType
      // blocks, which strict FBX SDK parsers (C4D, Houdini) treat as
      // malformed. Blender omits this block entirely when there are no Null
      // nodes.
      ...(nodes.some(n => n.type === 'Null') ? [{
        name: 'ObjectType', props: [{ type: 'S', value: 'NodeAttribute' }], children: [
          { name: 'Count', props: [{ type: 'I', value: nodes.filter(n => n.type === 'Null').length }] },
        ],
      }] : []),
    ],
  });

  // ── Objects ─────────────────────────────────────────────────────────────
  // Order matches Blender exactly: NodeAttribute → Geometry → Model →
  // Material. C4D's scene-construction pass walks Objects in document
  // order resolving references; NodeAttribute must come BEFORE the Model
  // that references it, or world.cpp:1745 fails with an unresolved
  // reference. Build each type into its own bucket then concat at the end.
  const naBlocks = [];
  const geomBlocks = [];
  const modelBlocks = [];
  const matBlocks = [];

  for (let gi = 0; gi < bakedGeoms.length; gi++) {
    const { nodeIdx, baked } = bakedGeoms[gi];
    const geomId = GEOM_ID_BASE + gi;
    const o = nodes[nodeIdx].obj;
    // CRITICAL: every Geometry name must be UNIQUE. Blender writes them
    // as "Mesh", "Mesh.001", "Mesh.002", ... — duplicate names confuse
    // C4D's scene-construction pass even when IDs are unique. Earlier we
    // were emitting "Mesh" for every single Geometry, which is exactly
    // what C4D's world.cpp:1745 was choking on.
    const name = gi === 0
      ? `Mesh\x00\x01Geometry`
      : `Mesh.${String(gi).padStart(3, '0')}\x00\x01Geometry`;
    // Order matches Blender's FBX exporter exactly: empty Properties70
    // FIRST, then GeometryVersion, then Vertices, then PolygonVertexIndex.
    // C4D 2026's parser requires GeometryVersion to come BEFORE the vertex
    // / index arrays — placing it after made C4D's world.cpp:1745 reject
    // the file. Blender's writer is the de-facto reference for "any DCC
    // tool reads it" because it's been hardened against every importer's
    // quirks over many years.
    const geomNode = {
      name: 'Geometry',
      props: [{ type: 'L', value: geomId }, { type: 'S', value: name }, { type: 'S', value: 'Mesh' }],
      children: [
        { name: 'Properties70', props: [], children: [] },
        { name: 'GeometryVersion', props: [{ type: 'I', value: 124 }] },
        { name: 'Vertices', props: [{ type: 'd', value: baked.positions }] },
        { name: 'PolygonVertexIndex', props: [{ type: 'i', value: baked.indices }] },
      ],
    };
    if (baked.normals) {
      // ByPolygonVertex + Direct — one normal per polygon-vertex in
      // PolygonVertexIndex order. No NormalsIndex array needed.
      // Blender 2.79, Maya and the reference FBX SDK files all use this layout.
      // _fbxBakeMeshGeom builds normalsDirect with size = triCount*3*3 doubles.
      geomNode.children.push({
        name: 'LayerElementNormal',
        props: [{ type: 'I', value: 0 }],
        children: [
          { name: 'Version', props: [{ type: 'I', value: 101 }] },
          { name: 'Name', props: [{ type: 'S', value: '' }] },
          { name: 'MappingInformationType', props: [{ type: 'S', value: 'ByPolygonVertex' }] },
          { name: 'ReferenceInformationType', props: [{ type: 'S', value: 'Direct' }] },
          { name: 'Normals', props: [{ type: 'd', value: baked.normalsDirect }] },
        ],
      });
    }
    // AllSame material layout — Blender uses this for single-material
    // meshes and it loads in C4D 2026. We earlier had ByPolygon thinking
    // C4D needed it; that was wrong (the per-polygon Materials array was
    // probably triggering its own scene-construction error).
    geomNode.children.push({
      name: 'LayerElementMaterial',
      props: [{ type: 'I', value: 0 }],
      children: [
        { name: 'Version', props: [{ type: 'I', value: 101 }] },
        { name: 'Name', props: [{ type: 'S', value: '' }] },
        { name: 'MappingInformationType', props: [{ type: 'S', value: 'AllSame' }] },
        { name: 'ReferenceInformationType', props: [{ type: 'S', value: 'IndexToDirect' }] },
        { name: 'Materials', props: [{ type: 'i', value: new Int32Array([0]) }] },
      ],
    });
    const layerChildren = [{ name: 'Version', props: [{ type: 'I', value: 100 }] }];
    if (baked.normals) {
      layerChildren.push({ name: 'LayerElement', props: [], children: [
        { name: 'Type', props: [{ type: 'S', value: 'LayerElementNormal' }] },
        { name: 'TypedIndex', props: [{ type: 'I', value: 0 }] },
      ]});
    }
    layerChildren.push({ name: 'LayerElement', props: [], children: [
      { name: 'Type', props: [{ type: 'S', value: 'LayerElementMaterial' }] },
      { name: 'TypedIndex', props: [{ type: 'I', value: 0 }] },
    ]});
    geomNode.children.push({ name: 'Layer', props: [{ type: 'I', value: 0 }], children: layerChildren });
    geomBlocks.push(geomNode);
  }

  // Models. Mesh Models get identity Lcl (transform baked into vertices);
  // Null Models get their decomposed local matrix (identity in practice
  // since buildExportRoot creates containers at identity).
  //
  // CRITICAL: Model names must be unique across the entire scene. C4D's
  // scene-construction pass uses names as disambiguators alongside IDs;
  // even with unique IDs, two Models sharing the same name (e.g. two
  // groups both named "Group") trigger world.cpp:1745. Track seen names
  // and append an index suffix to duplicates.
  const seenModelNames = new Map();   // base name → next suffix
  const seenNANames = new Map();      // same for NodeAttribute names
  const tmpQ = new THREE.Quaternion();
  const tmpEuler = new THREE.Euler();
  const tmpV3 = new THREE.Vector3();
  const tmpScale = new THREE.Vector3();
  const RAD2DEG = 180 / Math.PI;
  for (let ni = 0; ni < nodes.length; ni++) {
    const n = nodes[ni];
    const o = n.obj;
    const modelId = MODEL_ID_BASE + ni;
    // C4D writes Model names as `name\x00\x01Model` (no Class:: prefix).
    // De-duplicate by appending an index suffix to repeated base names.
    let baseName = safeName(o.name || (n.type === 'Mesh' ? `mesh_${ni}` : `group_${ni}`));
    const seenN = seenModelNames.get(baseName) || 0;
    if (seenN > 0) baseName = `${baseName}.${String(seenN).padStart(3, '0')}`;
    seenModelNames.set(safeName(o.name || (n.type === 'Mesh' ? `mesh_${ni}` : `group_${ni}`)), seenN + 1);
    const name = `${baseName}\x00\x01Model`;
    let tx=0,ty=0,tz=0,rx=0,ry=0,rz=0,sx=1,sy=1,sz=1;
    if (n.type !== 'Mesh') {
      o.updateMatrix();
      o.matrix.decompose(tmpV3, tmpQ, tmpScale);
      tmpEuler.setFromQuaternion(tmpQ, 'XYZ');
      tx = tmpV3.x; ty = tmpV3.y; tz = tmpV3.z;
      rx = tmpEuler.x * RAD2DEG; ry = tmpEuler.y * RAD2DEG; rz = tmpEuler.z * RAD2DEG;
      sx = tmpScale.x; sy = tmpScale.y; sz = tmpScale.z;
    }
    // Order + child set matches Blender's FBX exporter exactly. The
    // canonical Model child sequence Blender writes (and that loads in
    // every DCC tool) is:
    //   Version, Properties70 (with DefaultAttributeIndex + InheritType +
    //   Lcl Transform), MultiLayer, MultiTake, Shading, Culling.
    // C4D's world.cpp parser walks Models expecting MultiLayer/MultiTake
    // top-level children right after Properties70 — without them the
    // document-construction step asserts.
    modelBlocks.push({
      name: 'Model',
      props: [{ type: 'L', value: modelId }, { type: 'S', value: name }, { type: 'S', value: n.type }],
      children: [
        { name: 'Version', props: [{ type: 'I', value: 232 }] },
        { name: 'Properties70', props: [], children: [
          P('DefaultAttributeIndex', 'int', 'Integer', '', 0),
          P('InheritType', 'enum', '', '', 1),
          P('Lcl Translation', 'Lcl Translation', '', 'A', tx, ty, tz),
          P('Lcl Rotation', 'Lcl Rotation', '', 'A', rx, ry, rz),
          P('Lcl Scaling', 'Lcl Scaling', '', 'A', sx, sy, sz),
        ]},
        // Blender writes MultiLayer + MultiTake as required Model children.
        { name: 'MultiLayer', props: [{ type: 'I', value: 0 }] },
        { name: 'MultiTake', props: [{ type: 'I', value: 0 }] },
        // Shading: binary FBX 'C' type is a boolean byte — valid values are
        // 0 (false) or 1 (true). ASCII FBX writes the letter 'Y' but binary
        // must use the integer 1. Writing 89 ('Y') is wrong and causes strict
        // SDK parsers (C4D, Houdini, Maya) to reject the Model node.
        { name: 'Shading', props: [{ type: 'C', value: 1 }] },
        { name: 'Culling', props: [{ type: 'S', value: 'CullingOff' }] },
      ],
    });
  }

  // ── NodeAttribute blocks. CRITICAL: Blender writes NodeAttribute ONLY
  // for Null/group nodes — NOT for Mesh nodes. Mesh nodes get their
  // attribute from the Geometry block via OO connection (Geometry → Model).
  // Writing a NodeAttribute for a Mesh Model produces a duplicate-attribute
  // condition that C4D's world.cpp:1745 rejects. Track which node indices
  // get a NodeAttribute so the connection loop only emits matching edges.
  const nodeHasAttr = new Set();        // node indices that get a NodeAttribute
  for (let ni = 0; ni < nodes.length; ni++) {
    const n = nodes[ni];
    if (n.type !== 'Null') continue;    // Mesh nodes use Geometry, not NodeAttribute
    nodeHasAttr.add(ni);
    const naId = NA_ID_BASE + ni;
    // Same de-dup as Model names: append a suffix to repeated base names.
    let baseName = safeName(n.obj.name || `group_${ni}`);
    const seenN = seenNANames.get(baseName) || 0;
    if (seenN > 0) baseName = `${baseName}.${String(seenN).padStart(3, '0')}`;
    seenNANames.set(safeName(n.obj.name || `group_${ni}`), seenN + 1);
    const naName = `${baseName}\x00\x01NodeAttribute`;
    naBlocks.push({
      name: 'NodeAttribute',
      props: [
        { type: 'L', value: naId },
        { type: 'S', value: naName },
        { type: 'S', value: 'Null' },
      ],
      children: [
        { name: 'TypeFlags', props: [{ type: 'S', value: 'Null' }] },
        { name: 'Properties70', props: [], children: [] },
      ],
    });
  }

  for (let mi = 0; mi < perMeshMats.length; mi++) {
    const m = perMeshMats[mi];
    const matId = MAT_ID_BASE + mi;
    // C4D writes Material names as `Mat_X\x00\x01Material` (no Class:: prefix).
    const name = `Mat_${mi}\x00\x01Material`;
    matBlocks.push({
      name: 'Material',
      props: [{ type: 'L', value: matId }, { type: 'S', value: name }, { type: 'S', value: '' }],
      children: [
        { name: 'Version', props: [{ type: 'I', value: 102 }] },
        { name: 'ShadingModel', props: [{ type: 'S', value: 'Phong' }] },
        { name: 'MultiLayer', props: [{ type: 'I', value: 0 }] },
        { name: 'Properties70', props: [], children: [
          P('ShadingModel', 'KString', '', '', 'Phong'),
          P('DiffuseColor', 'Color', '', 'A', m.r, m.g, m.b),
          P('DiffuseFactor', 'Number', '', 'A', 1),
          P('AmbientColor', 'Color', '', 'A', 0, 0, 0),
          P('AmbientFactor', 'Number', '', 'A', 0),
          P('SpecularColor', 'Color', '', 'A', 0.2, 0.2, 0.2),
          P('SpecularFactor', 'Number', '', 'A', 0.5),
          P('Shininess', 'double', 'Number', '', 20),
          P('ShininessExponent', 'double', 'Number', '', 20),
          P('TransparencyFactor', 'Number', '', 'A', 0),
          P('ReflectionFactor', 'Number', '', 'A', 0),
        ]},
      ],
    });
  }

  // Order matches Blender's FBX exporter exactly. C4D's scene-construction
  // pass walks Objects in document order resolving cross-references —
  // NodeAttribute MUST come before Model that references it.
  tree.push({ name: 'Objects', props: [], children:
    [...naBlocks, ...geomBlocks, ...modelBlocks, ...matBlocks]
  });

  // ── Connections ─────────────────────────────────────────────────────────
  const conns = [];
  // No OO 0→docId connection. Blender's exporter does NOT write this.
  // The Document's RootNode:0 field already registers id=0 as the scene
  // root — an extra OO connection re-parents the root as a Document child
  // which confuses the FBX SDK's scene-tree builder.
  for (let ni = 0; ni < nodes.length; ni++) {
    const n = nodes[ni];
    const childId = MODEL_ID_BASE + ni;
    const parentId = n.parentIdx < 0 ? 0 : MODEL_ID_BASE + n.parentIdx;
    conns.push({ name: 'C', props: [
      { type: 'S', value: 'OO' },
      { type: 'L', value: childId },
      { type: 'L', value: parentId },
    ]});
    // NodeAttribute connection for Null nodes only — Mesh nodes get their
    // attribute via the Geometry connection below. See nodeHasAttr.
    if (nodeHasAttr.has(ni)) {
      conns.push({ name: 'C', props: [
        { type: 'S', value: 'OO' },
        { type: 'L', value: NA_ID_BASE + ni },
        { type: 'L', value: childId },
      ]});
    }
    if (n.type === 'Mesh') {
      const gIdx = meshIdxToGeomIdx.get(ni);
      if (gIdx != null) {
        conns.push({ name: 'C', props: [
          { type: 'S', value: 'OO' },
          { type: 'L', value: GEOM_ID_BASE + gIdx },
          { type: 'L', value: childId },
        ]});
      }
      // Each mesh has its own private Material (no sharing — see comment
      // at perMeshMats declaration). Look up by node index, not by color.
      const mIdx = meshIdxToMatIdx.get(ni);
      if (mIdx != null) {
        conns.push({ name: 'C', props: [
          { type: 'S', value: 'OO' },
          { type: 'L', value: MAT_ID_BASE + mIdx },
          { type: 'L', value: childId },
        ]});
      }
    }
  }
  tree.push({ name: 'Connections', props: [], children: conns });

  // ── Takes (animation tracks — empty for static CAD scenes) ──────────────
  tree.push({
    name: 'Takes', props: [], children: [
      { name: 'Current', props: [{ type: 'S', value: '' }] },
    ],
  });

  // ── Serialise ───────────────────────────────────────────────────────────
  const w = new _FbxBinWriter();
  // Header (27 bytes): magic + version.
  w.bytes_(_FBX_TENC.encode('Kaydara FBX Binary  '));   // 20 bytes (note 2 trailing spaces)
  w.u8(0); w.u8(0x1A); w.u8(0);                          // 3 bytes: \0 \x1A \0
  // Version 7400 — exactly matches what Blender's FBX exporter writes,
  // and Blender's files load reliably in Cinema 4D 2026. Don't change
  // this without first verifying the new version still loads in C4D.
  w.u32(7400);                                           // 4 bytes: version 7.4

  for (const node of tree) await _fbxWriteNode(w, node);
  // Top-level null record (13 bytes for FBX 7.4: three uint32 + one uint8).
  w.u32(0); w.u32(0); w.u32(0); w.u8(0);

  // Footer block. FBX SDK and stricter importers (Maya, Cinema 4D 2026)
  // require this; lenient ones (Blender, three.js's FBXLoader) ignore it.
  // The first 16 bytes are a well-known "footer code" that open-source
  // writers (Blender, Assimp) use unconditionally — derived from the FBX
  // SDK's encryption table for version 7.x. Followed by zero-padding,
  // version, more zero-padding, and a fixed 16-byte post-footer magic.
  const FOOT_CODE = new Uint8Array([
    0xfa, 0xbc, 0xab, 0x09, 0xd0, 0xc8, 0xd4, 0x66,
    0xb1, 0x76, 0xfb, 0x83, 0x1c, 0xf7, 0x26, 0x7e,
  ]);
  const POST_FOOT_MAGIC = new Uint8Array([
    0xf8, 0x5a, 0x8c, 0x6a, 0xde, 0xf5, 0xd9, 0x7e,
    0xec, 0xe9, 0x0c, 0xe3, 0x75, 0x8f, 0x29, 0x0b,
  ]);
  w.bytes_(FOOT_CODE);
  // Blender's encode_bin.py writes 4 zero bytes immediately after FOOT_CODE,
  // then pads to the next 16-byte boundary with a minimum of 16 bytes
  // (so when already aligned it still writes 16, never 0).
  w.u32(0);  // 4 forced zeros — Blender always writes these
  const _footPad = 16 - (w.pos % 16);  // always 1..16 (never 0)
  for (let _i = 0; _i < _footPad; _i++) w.u8(0);
  w.u32(7400);   // version must match the header
  for (let i = 0; i < 120; i++) w.u8(0);
  w.bytes_(POST_FOOT_MAGIC);

  return new Blob([w.finalize()], { type: 'application/octet-stream' });
}

function _exportFbxAscii(root) {
  // FBX uses int64 ids; we space them out by ranges so the output is readable
  // and ids don't collide across object types (Geometry / Model / Material).
  const GEOM_ID_BASE  = 100000000;
  const MODEL_ID_BASE = 200000000;
  const MAT_ID_BASE   = 300000000;

  // ── Walk the scene tree ─────────────────────────────────────────────────
  // We collect THREE objects (Group + Mesh) into a flat list with per-node
  // parent indices so the Connections block can wire up the hierarchy. Each
  // node gets an FBX Model id; THREE.Group nodes become FBX "Null" Models,
  // THREE.Mesh nodes become "Mesh" Models. The export root itself is treated
  // as the FBX scene root and gets id 0 implicitly (FBX convention).
  root.updateMatrixWorld(true);
  const nodes = [];           // { obj, parentIdx, type }  — type: 'Null' | 'Mesh'
  const objToIdx = new Map(); // Object3D → index in nodes[]
  function visit(obj, parentIdx) {
    if (obj === root) {
      // root maps to FBX scene root (parent index = -1, never emitted).
      objToIdx.set(obj, -1);
    } else {
      const isMesh = !!obj.isMesh;
      // Skip invisible meshes; meshes without a position attribute would
      // otherwise produce dangling Connections to Geometry blocks we never
      // emit (the Geometry loop bails on missing position). InstancedMesh
      // is also a Mesh subclass — we don't have a Geometry-instancing path
      // here, so route them as plain meshes (they'll bake one geom and
      // one node, identical to the GLB exporter's behaviour for them).
      if (isMesh && obj.visible === false) return;
      if (isMesh && !obj.geometry?.attributes?.position) return;
      const idx = nodes.length;
      nodes.push({ obj, parentIdx, type: isMesh ? 'Mesh' : 'Null' });
      objToIdx.set(obj, idx);
      parentIdx = idx;
    }
    if (obj.children) {
      for (const c of obj.children) visit(c, parentIdx);
    }
  }
  visit(root, -1);

  // Drop empty Null nodes (groups with no descendant meshes). Walks bottom-up.
  // An empty group has neither a mesh nor any non-empty descendants.
  {
    const liveDescendantCount = new Array(nodes.length).fill(0);
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const mine = n.type === 'Mesh' ? 1 : 0;
      if (n.parentIdx >= 0) liveDescendantCount[n.parentIdx] += mine + liveDescendantCount[i];
      // Keep the count as is; we use it to decide whether to keep this node.
      liveDescendantCount[i] += mine;
    }
    const keep = nodes.map((n, i) => n.type === 'Mesh' || liveDescendantCount[i] > 0);
    if (keep.some(k => !k)) {
      const remap = new Array(nodes.length).fill(-1);
      const filtered = [];
      for (let i = 0; i < nodes.length; i++) {
        if (!keep[i]) continue;
        remap[i] = filtered.length;
        const n = nodes[i];
        // Walk up parents until we find one we kept (or hit root).
        let p = n.parentIdx;
        while (p >= 0 && !keep[p]) p = nodes[p].parentIdx;
        filtered.push({ obj: n.obj, parentIdx: p < 0 ? -1 : remap[p], type: n.type });
      }
      nodes.length = 0;
      for (const n of filtered) nodes.push(n);
      objToIdx.clear();
      objToIdx.set(root, -1);
      for (let i = 0; i < nodes.length; i++) objToIdx.set(nodes[i].obj, i);
    }
  }

  // ── Dedup geometries and materials ──────────────────────────────────────
  // Geometry sharing is the single biggest size win: 100 instances of one
  // bracket become 1 Geometry block + 100 Model instances instead of 100
  // full Geometry blocks. Keyed by BufferGeometry reference (buildExportRoot
  // already shares clones across same-hash parts), so this maps 1:1 to
  // GLTFExporter's dedup behaviour.
  const geoms = [];                      // unique BufferGeometry list
  const geomToIdx = new Map();           // BufferGeometry → index
  for (const n of nodes) {
    if (n.type !== 'Mesh') continue;
    const g = n.obj.geometry;
    if (!g) continue;
    if (!geomToIdx.has(g)) {
      geomToIdx.set(g, geoms.length);
      geoms.push(g);
    }
  }

  // Materials are keyed by RGB hex so meshes with identical colours share
  // one Material entry. Different metalness/roughness/etc. would need finer
  // keys; our pipeline produces flat color-only materials so hex is enough.
  const mats = [];                       // [{ r, g, b }]
  const colorHexToIdx = new Map();
  // Helper: resolve the effective display colour for a mesh node.
  // When the merge-into-one path is used, material.vertexColors=true and the
  // actual colours live in geometry.attributes.color. Read the first vertex
  // colour as a representative hue so merged meshes aren't forced grey.
  const resolveColor = (n) => {
    // Three.js material may be an array when a mesh has multiple material groups.
    // Take the first entry so dedup still works — a per-face material array means
    // the mesh needs to be split per-group for perfect accuracy, which is out of
    // scope here. Single-material meshes (the STEP-importer norm) are unaffected.
    const rawMat = n.obj.material;
    const mat = Array.isArray(rawMat) ? rawMat[0] : rawMat;
    if (mat?.vertexColors && n.obj.geometry?.attributes?.color) {
      const ca = n.obj.geometry.attributes.color;
      // Read first vertex (stride can be 3 or 4).
      return { r: ca.getX(0), g: ca.getY(0), b: ca.getZ(0) };
    }
    const c = mat?.color;
    return c ? { r: c.r, g: c.g, b: c.b } : { r: 0.8, g: 0.8, b: 0.8 };
  };
  for (const n of nodes) {
    if (n.type !== 'Mesh') continue;
    const { r, g, b } = resolveColor(n);
    const key = ((r * 255 | 0) << 16) | ((g * 255 | 0) << 8) | (b * 255 | 0);
    if (!colorHexToIdx.has(key)) {
      colorHexToIdx.set(key, mats.length);
      mats.push({ r, g, b });
    }
  }

  // Streaming via array-of-strings + Blob([chunks]) — sidesteps the V8
  // ~512 MB single-string limit while keeping the writer simple.
  const chunks = [];
  const push = (s) => chunks.push(s);

  const now = new Date();
  const year = now.getFullYear(), month = now.getMonth() + 1, day = now.getDate();
  const hour = now.getHours(), minute = now.getMinutes(), second = now.getSeconds();

  // ── Header ────────────────────────────────────────────────────────────
  push(`; FBX 7.4.0 project file
; Created by step-optimiser
; ----------------------------------------------------

FBXHeaderExtension:  {
\tFBXHeaderVersion: 1003
\tFBXVersion: 7400
\tCreationTimeStamp:  {
\t\tVersion: 1000
\t\tYear: ${year}
\t\tMonth: ${month}
\t\tDay: ${day}
\t\tHour: ${hour}
\t\tMinute: ${minute}
\t\tSecond: ${second}
\t\tMillisecond: 0
\t}
\tCreator: "step-optimiser ASCII FBX exporter"
}
GlobalSettings:  {
\tVersion: 1000
\tProperties70:  {
\t\tP: "UpAxis", "int", "Integer", "",1
\t\tP: "UpAxisSign", "int", "Integer", "",1
\t\tP: "FrontAxis", "int", "Integer", "",2
\t\tP: "FrontAxisSign", "int", "Integer", "",1
\t\tP: "CoordAxis", "int", "Integer", "",0
\t\tP: "CoordAxisSign", "int", "Integer", "",1
\t\tP: "OriginalUpAxis", "int", "Integer", "",-1
\t\tP: "OriginalUpAxisSign", "int", "Integer", "",1
\t\tP: "UnitScaleFactor", "double", "Number", "",1
\t\tP: "OriginalUnitScaleFactor", "double", "Number", "",1
\t\tP: "AmbientColor", "ColorRGB", "Color", "",0,0,0
\t\tP: "DefaultCamera", "KString", "", "", "Producer Perspective"
\t\tP: "TimeMode", "enum", "", "",11
\t\tP: "TimeSpanStart", "KTime", "Time", "",0
\t\tP: "TimeSpanStop", "KTime", "Time", "",46186158000
\t}
}

`);

  // ── Definitions ───────────────────────────────────────────────────────
  // Count = number of distinct ObjectType template blocks, not total objects.
  // Blender writes: 3 for a scene with GlobalSettings+Geometry+Model templates.
  // Per-block ObjectType.Count values carry the actual per-type object counts.
  const _asciiNullNodes = nodes.filter(n => n.type === 'Null');
  const _asciiMeshNodes = nodes.filter(n => n.type === 'Mesh' && n.obj.geometry?.attributes?.position);
  const _asciiDefCount = 1 +                                    // GlobalSettings
    (_asciiMeshNodes.length > 0 ? 1 : 0) +                     // Geometry
    (nodes.length > 0 ? 1 : 0) +                               // Model
    (mats.length > 0 ? 1 : 0) +                                // Material
    (_asciiNullNodes.length > 0 ? 1 : 0);                      // NodeAttribute
  push(`Definitions:  {
\tVersion: 100
\tCount: ${_asciiDefCount}
\tObjectType: "GlobalSettings" {
\t\tCount: 1
\t}
\tObjectType: "Geometry" {
\t\tCount: ${_asciiMeshNodes.length}
\t\tPropertyTemplate: "FbxMesh" {
\t\t\tProperties70:  {
\t\t\t\tP: "Color", "ColorRGB", "Color", "",0.8,0.8,0.8
\t\t\t}
\t\t}
\t}
\tObjectType: "Model" {
\t\tCount: ${nodes.length}
\t\tPropertyTemplate: "FbxNode" {
\t\t\tProperties70:  {
\t\t\t\tP: "DefaultAttributeIndex", "int", "Integer", "",0
\t\t\t}
\t\t}
\t}
\tObjectType: "Material" {
\t\tCount: ${mats.length}
\t\tPropertyTemplate: "FbxSurfacePhong" {
\t\t\tProperties70:  {
\t\t\t\tP: "ShadingModel", "KString", "", "", "Phong"
\t\t\t\tP: "DiffuseColor", "Color", "", "A",0.8,0.8,0.8
\t\t\t}
\t\t}
\t}
\tObjectType: "NodeAttribute" {
\t\tCount: ${_asciiNullNodes.length}
\t}
}

`);

  // ── Objects ───────────────────────────────────────────────────────────
  push(`Objects:  {
`);

  // Helper: format a number compactly. 4 decimal places = 0.0001-unit
  // resolution, which is sub-micron at mm scale and far tighter than any
  // downstream manufacturing tolerance. Going from 6 dp to 4 dp cuts the
  // dominant vertex/normal data ~20 % in the text stream.
  const fmt = (n) => Math.abs(n) < 1e-10 ? '0' : (+n.toFixed(4)).toString();
  // Sanitise names — FBX is fragile around backslashes, double-quotes and
  // control characters in object labels.
  const safeName = (s) => (s || 'unnamed').replace(/["\\]/g, '_').replace(/[\x00-\x1f]/g, '_');

  // ── Geometry blocks. We BAKE each mesh's local matrix into its emitted
  //    vertex stream (as opposed to relying on Lcl Translation/Rotation/
  //    Scaling on the Mesh Model) to sidestep Euler decomposition issues
  //    that surface on deeply-nested or sheared transforms. With identity
  //    Lcl on every Mesh node, world pose comes purely from vertex coords —
  //    no T/R/S decomposition step can lose information. Cost: each Mesh
  //    Model gets its own Geometry (no sharing across instances), so the
  //    file is larger than if we trusted Lcl. Worth it: the alternative is
  //    visible misorientation on instances buried under non-uniform-scaled
  //    parent groups (Cinema-4D / Blender export idiom).
  //
  //    Hierarchy is still preserved via Connections — group containers'
  //    own Lcl is identity (buildExportRoot creates them at identity), so
  //    they only contribute structure, not transform.
  //
  //    geomToIdx map is rebuilt here per-mesh-node since we no longer
  //    share BufferGeometries: each mesh node gets its own Geometry block.
  geoms.length = 0;
  geomToIdx.clear();
  const meshIdxToGeomIdx = new Map();      // node index → geom block index
  for (let ni = 0; ni < nodes.length; ni++) {
    const n = nodes[ni];
    if (n.type !== 'Mesh') continue;
    const g = n.obj.geometry;
    if (!g) continue;
    meshIdxToGeomIdx.set(ni, geoms.length);
    geoms.push({ source: g, mesh: n.obj });
  }

  const _bakeM = new THREE.Matrix4();
  const _bakeV = new THREE.Vector3();

  for (let gi = 0; gi < geoms.length; gi++) {
    const entry = geoms[gi];
    const g = entry.source;
    const meshObj = entry.mesh;
    const geomId = GEOM_ID_BASE + gi;
    const posAttr = g.attributes.position;
    if (!posAttr) continue;
    const idxAttr = g.index;
    const stride = posAttr.itemSize;
    const arr = posAttr.array;
    // World transform we'll bake into the emitted vertex stream. matrixWorld
    // is the right source: it composes the mesh's local matrix with every
    // ancestor's local matrix, which is exactly what an FBX importer would
    // otherwise reconstruct from Lcl chains. Baking into vertices means
    // emitted Mesh Models carry identity Lcl — no decomposition risk.
    meshObj.updateWorldMatrix(true, false);
    _bakeM.copy(meshObj.matrixWorld);

    push(`\tGeometry: ${geomId}, "Geometry::geom_${gi}", "Mesh" {
\t\tGeometryVersion: 124
\t\tVertices: *${posAttr.count * 3} {
\t\t\ta: `);
    {
      const parts = new Array(posAttr.count);
      for (let i = 0; i < posAttr.count; i++) {
        // Bake matrixWorld into the emitted position. Identity Lcl on the
        // Mesh Model (below) means the importer won't re-transform.
        _bakeV.set(arr[i*stride], arr[i*stride+1], arr[i*stride+2]).applyMatrix4(_bakeM);
        parts[i] = fmt(_bakeV.x) + ',' + fmt(_bakeV.y) + ',' + fmt(_bakeV.z);
      }
      push(parts.join(','));
    }
    push(`
\t\t}
\t\tPolygonVertexIndex: *`);
    {
      // FBX marks the LAST vertex of each polygon with bitwise NOT (~i)
      // so the parser can tell where polygons end. For triangle meshes
      // that's every 3rd index. We always emit triangulated geometry.
      let count;
      let parts;
      if (idxAttr) {
        count = idxAttr.count;
        const ai = idxAttr.array;
        const triCount = count / 3;
        parts = new Array(triCount);
        for (let i = 0; i < triCount; i++) {
          const j = i * 3;
          parts[i] = ai[j] + ',' + ai[j+1] + ',' + (~ai[j+2]);
        }
      } else {
        count = posAttr.count;
        const triCount = count / 3;
        parts = new Array(triCount);
        for (let i = 0; i < triCount; i++) {
          const j = i * 3;
          parts[i] = j + ',' + (j+1) + ',' + (~(j+2));
        }
      }
      push(count + ` {
\t\t\ta: `);
      push(parts.join(','));
    }
    push(`
\t\t}
`);

    // Normals are intentionally omitted from the ASCII export.
    // ASCII FBX is already 3-5× larger than binary; normals alone match
    // the vertex-position footprint (3 floats/vertex × same count). Every
    // major importer (Houdini, C4D, Maya, Blender) recomputes smooth or
    // hard-edge normals from the polygon topology on load, so the visual
    // result is identical while the file stays half the size.
    // If you need to restore normals, uncomment the block below and also
    // add back the LayerElementNormal entry in the Layer block.

    // Single per-mesh material slot, mapped to slot 0.
    push(`\t\tLayerElementMaterial: 0 {
\t\t\tVersion: 101
\t\t\tName: ""
\t\t\tMappingInformationType: "AllSame"
\t\t\tReferenceInformationType: "IndexToDirect"
\t\t\tMaterials: *1 {
\t\t\t\ta: 0
\t\t\t}
\t\t}
\t\tLayer: 0 {
\t\t\tVersion: 100
`);
    push(`\t\t\tLayerElement:  {
\t\t\t\tType: "LayerElementMaterial"
\t\t\t\tTypedIndex: 0
\t\t\t}
\t\t}
\t}
`);
  }

  // ── NodeAttribute blocks — one per Null/group node. Mesh nodes get their
  //    attribute from the Geometry via OO connection; only Null nodes need an
  //    explicit NodeAttribute (type "Null") for the FBX SDK to build a valid
  //    scene hierarchy. Without these, Houdini's FBX SDK emits "failed to load".
  const _ASCII_NA_BASE = 400000000;
  for (let ni = 0; ni < nodes.length; ni++) {
    const n = nodes[ni];
    if (n.type !== 'Null') continue;
    const naId = _ASCII_NA_BASE + ni;
    const naName = safeName(n.obj.name || `group_${ni}`);
    push(`\tNodeAttribute: ${naId}, "NodeAttribute::${naName}", "Null" {
\t\tTypeFlags: "Null"
\t}
`);
  }

  // ── Model blocks. One per scene-graph node; type = "Null" for groups
  //    (containers that hold other Models) and "Mesh" for actual geometry.
  //    Lcl Translation/Rotation/Scale carry the LOCAL transform; the
  //    parent-child relationships are wired up in Connections below. ──────
  const tmpQ = new THREE.Quaternion();
  const tmpEuler = new THREE.Euler();
  const tmpV = new THREE.Vector3();
  const tmpScale = new THREE.Vector3();
  const RAD2DEG = 180 / Math.PI;
  for (let ni = 0; ni < nodes.length; ni++) {
    const n = nodes[ni];
    const o = n.obj;
    const modelId = MODEL_ID_BASE + ni;
    // Mesh nodes get identity Lcl because their world transform was baked
    // into the emitted vertex stream. Group ('Null') nodes get the decomposed
    // local matrix so their structural placement (if any) is preserved —
    // buildExportRoot creates them at identity so this is also (0,0,0)/etc.
    // in practice, but we honour any Lcl that may have ended up on them.
    let tx = 0, ty = 0, tz = 0;
    let rx = 0, ry = 0, rz = 0;
    let sx = 1, sy = 1, sz = 1;
    if (n.type !== 'Mesh') {
      o.updateMatrix();
      o.matrix.decompose(tmpV, tmpQ, tmpScale);
      tmpEuler.setFromQuaternion(tmpQ, 'XYZ');
      tx = tmpV.x; ty = tmpV.y; tz = tmpV.z;
      rx = tmpEuler.x * RAD2DEG; ry = tmpEuler.y * RAD2DEG; rz = tmpEuler.z * RAD2DEG;
      sx = tmpScale.x; sy = tmpScale.y; sz = tmpScale.z;
    }
    push(`\tModel: ${modelId}, "Model::${safeName(o.name || (n.type === 'Mesh' ? `mesh_${ni}` : `group_${ni}`))}", "${n.type}" {
\t\tVersion: 232
\t\tProperties70:  {
\t\t\tP: "DefaultAttributeIndex", "int", "Integer", "",0
\t\t\tP: "InheritType", "enum", "", "",1
\t\t\tP: "Lcl Translation", "Lcl Translation", "", "A",${fmt(tx)},${fmt(ty)},${fmt(tz)}
\t\t\tP: "Lcl Rotation", "Lcl Rotation", "", "A",${fmt(rx)},${fmt(ry)},${fmt(rz)}
\t\t\tP: "Lcl Scaling", "Lcl Scaling", "", "A",${fmt(sx)},${fmt(sy)},${fmt(sz)}
\t\t}
\t\tMultiLayer: 0
\t\tMultiTake: 0
\t\tShading: Y
\t\tCulling: "CullingOff"
\t}
`);
  }

  // ── Material blocks (one per unique color). ─────────────────────────────
  for (let mi = 0; mi < mats.length; mi++) {
    const m = mats[mi];
    const matId = MAT_ID_BASE + mi;
    push(`\tMaterial: ${matId}, "Material::mat_${mi}", "" {
\t\tVersion: 102
\t\tShadingModel: "Phong"
\t\tMultiLayer: 0
\t\tProperties70:  {
\t\t\tP: "ShadingModel", "KString", "", "", "Phong"
\t\t\tP: "DiffuseColor", "Color", "", "A",${fmt(m.r)},${fmt(m.g)},${fmt(m.b)}
\t\t\tP: "DiffuseFactor", "Number", "", "A",1
\t\t\tP: "AmbientColor", "Color", "", "A",0,0,0
\t\t\tP: "AmbientFactor", "Number", "", "A",0
\t\t\tP: "SpecularColor", "Color", "", "A",0.2,0.2,0.2
\t\t\tP: "SpecularFactor", "Number", "", "A",0.5
\t\t\tP: "Shininess", "double", "Number", "",20
\t\t\tP: "ShininessExponent", "double", "Number", "",20
\t\t\tP: "TransparencyFactor", "Number", "", "A",0
\t\t\tP: "ReflectionFactor", "Number", "", "A",0
\t\t}
\t}
`);
  }

  push(`}

`);

  // ── Documents + References ─────────────────────────────────────────────
  // Both top-level nodes are REQUIRED by the Autodesk FBX SDK (used by Houdini,
  // Maya, and 3ds Max internally). Without them, the SDK fails to initialize the
  // scene graph and returns a silent "failed to load" error.
  push(`Documents:  {
\tCount: 1
\tDocument: 1000000000, "Scene", "Scene" {
\t\tProperties70:  {
\t\t\tP: "SourceObject", "object", "", ""
\t\t\tP: "ActiveAnimStackName", "KString", "", "", ""
\t\t}
\t\tRootNode: 0
\t}
}
References:  {
}

`);

  // ── Connections ───────────────────────────────────────────────────────
  // For each node: child Model → parent Model (or scene root id 0).
  // For mesh nodes additionally: Geometry → Model, Material → Model.
  // For Null nodes: NodeAttribute → Model (FBX SDK requires this for groups).
  push(`Connections:  {
`);
  // REQUIRED: Scene root (id 0) → Document. The FBX SDK uses this connection
  // to register the scene root with the Document node. Without it, Cinema 4D
  // and Houdini (both use the Autodesk FBX SDK) cannot build the scene tree.
  push(`\tC: "OO",0,1000000000\n`);
  for (let ni = 0; ni < nodes.length; ni++) {
    const n = nodes[ni];
    const childId = MODEL_ID_BASE + ni;
    const parentId = n.parentIdx < 0 ? 0 : MODEL_ID_BASE + n.parentIdx;
    push(`\tC: "OO",${childId},${parentId}\n`);
    if (n.type === 'Mesh') {
      const gIdx = meshIdxToGeomIdx.get(ni);
      if (gIdx != null) push(`\tC: "OO",${GEOM_ID_BASE + gIdx},${childId}\n`);
      // Use the same resolveColor helper used when building the mats table,
      // so vertex-colour meshes (merge path) get the right material connection.
      const { r, g, b } = resolveColor(n);
      const key = ((r * 255 | 0) << 16) | ((g * 255 | 0) << 8) | (b * 255 | 0);
      const mIdx = colorHexToIdx.get(key);
      if (mIdx != null) push(`\tC: "OO",${MAT_ID_BASE + mIdx},${childId}\n`);
    }
    if (n.type === 'Null') {
      // NodeAttribute → Model for every group node. The FBX SDK walks
      // these connections to build the scene tree; missing them = load failure.
      push(`\tC: "OO",${_ASCII_NA_BASE + ni},${childId}\n`);
    }
  }
  push(`}

`);

  // ── Takes (required by FBX SDK even for static scenes without animation) ──
  push(`Takes:  {
\tCurrent: ""
}
`);

  return new Blob(chunks, { type: 'application/octet-stream' });
}

// OBJ precision — default JS Number.toString() emits up to 17 significant
// digits, which roughly doubles file size with no real-world benefit. 6
// decimals on positions/UVs and 5 on normals is sub-micron at 1 m scale
// and well below CAD tolerance.
const _OBJ_POS_DEC = 6;
const _OBJ_UV_DEC  = 6;
const _OBJ_NRM_DEC = 5;

// Format a float with up to `d` decimals, stripping trailing zeros and the
// dangling `.` so we don't pay for digits we didn't need. Avoids "-0".
function _objFloat(n, d) {
  if (!isFinite(n) || n === 0) return '0';
  let s = n.toFixed(d);
  if (s.indexOf('.') !== -1) {
    s = s.replace(/0+$/, '');
    if (s.endsWith('.')) s = s.slice(0, -1);
  }
  return s === '-0' ? '0' : s;
}

function _exportObjStreaming(root, mtlBaseName) {
  const TARGET_CHUNK = 4 * 1024 * 1024;   // 4 MB per string chunk
  // Banner spells out the OBJ format's two structural limitations so a future
  // user reading the file knows why pivots/hierarchy look the way they do.
  const parts = [
    '# Exported by STEP Optimizer\n',
    '# OBJ does not store per-object transforms — all vertices are baked\n',
    '# into world space, so every imported object inherits an origin at\n',
    '# (0,0,0). In Blender, enable the importer\'s "Object Origin → Bounds\n',
    '# Center" option to recompute correct per-part pivots on import.\n',
    '# Group hierarchy is encoded in the object name as parent/child/leaf.\n',
  ];
  let buf = '';
  const flush = () => { if (buf) { parts.push(buf); buf = ''; } };
  const append = (s) => { buf += s; if (buf.length >= TARGET_CHUNK) flush(); };

  // ── Material table ──────────────────────────────────────────────────────
  // OBJ references named materials by `usemtl <name>`; the actual definitions
  // live in a sibling .mtl file linked via `mtllib`. We collect unique
  // materials by hex color (any two meshes with the same color share one mtl
  // entry) and emit the .mtl as a parallel Blob so the caller can download
  // both files together.
  const matByHex = new Map();    // hex int → { name, r, g, b, metalness, roughness }
  const matNameFor = (mat) => {
    if (!mat || !mat.color) return null;
    const hex = mat.color.getHex();
    let entry = matByHex.get(hex);
    if (!entry) {
      const name = 'mat_' + hex.toString(16).padStart(6, '0');
      entry = {
        name,
        r: mat.color.r, g: mat.color.g, b: mat.color.b,
        metalness: typeof mat.metalness === 'number' ? mat.metalness : 0,
        roughness: typeof mat.roughness === 'number' ? mat.roughness : 1,
      };
      matByHex.set(hex, entry);
    }
    return entry.name;
  };

  if (mtlBaseName) parts.push(`mtllib ${mtlBaseName}.mtl\n`);

  // OBJ uses 1-based indices that span the entire file. Track running totals
  // across meshes so a mesh's faces reference the right global vertex IDs.
  let vOffset = 0, nOffset = 0, uvOffset = 0, objIdx = 0;

  const tmpV = new THREE.Vector3();
  const tmpN = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();

  // Build the group chain for a mesh: outermost ancestor → ... → leaf parent.
  // OBJ has no real hierarchy, and most importers ignore the `g` directive
  // for object splitting (they split on `o` instead). So we ALSO bake the
  // chain into the object name with `/` as a separator — Blender, Maya and
  // 3ds Max all preserve the full string verbatim, and Blender groups names
  // alphabetically in the outliner so a chain prefix produces correct
  // visible grouping. The redundant `g <chain>` line is still emitted for
  // tools that DO use it (some legacy CAD tools, Substance).
  const sanitize = (s) => (s || '').replace(/\s+/g, '_').replace(/[^\w.-]/g, '') || 'Group';
  const chainNames = (child) => {
    const names = [];
    let cur = child.parent;
    while (cur && cur !== root) {
      if (cur.name) names.unshift(sanitize(cur.name));
      cur = cur.parent;
    }
    return names;
  };

  root.traverse((child) => {
    if (!child.isMesh) return;
    const geom = child.geometry;
    const pos = geom?.attributes?.position;
    if (!pos) return;
    const nrm = geom.attributes.normal || null;
    const uv  = geom.attributes.uv     || null;
    const idx = geom.index;
    const matrix = child.matrixWorld;
    normalMatrix.getNormalMatrix(matrix);

    objIdx++;
    const chain = chainNames(child);
    const baseName = sanitize(child.name || 'Mesh_' + objIdx);
    // `o` line: prefix with chain joined by `/` so the importer's outliner
    // shows the full path. Identifier-safe characters only.
    const objName = chain.length ? chain.join('/') + '/' + baseName : baseName;
    append(`o ${objName}\n`);
    // `g` line: same chain space-separated. Some tools read it as group tags.
    if (chain.length) append('g ' + chain.join(' ') + '\n');
    const matName = matNameFor(child.material);
    if (matName) append('usemtl ' + matName + '\n');

    // positions (apply world matrix)
    const vc = pos.count;
    for (let i = 0; i < vc; i++) {
      tmpV.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      append('v ' + _objFloat(tmpV.x, _OBJ_POS_DEC) + ' ' + _objFloat(tmpV.y, _OBJ_POS_DEC) + ' ' + _objFloat(tmpV.z, _OBJ_POS_DEC) + '\n');
    }
    // uvs
    if (uv) {
      const uc = uv.count;
      for (let i = 0; i < uc; i++) {
        append('vt ' + _objFloat(uv.getX(i), _OBJ_UV_DEC) + ' ' + _objFloat(uv.getY(i), _OBJ_UV_DEC) + '\n');
      }
    }
    // normals (apply normal matrix; renormalize)
    if (nrm) {
      const nc = nrm.count;
      for (let i = 0; i < nc; i++) {
        tmpN.fromBufferAttribute(nrm, i).applyMatrix3(normalMatrix).normalize();
        append('vn ' + _objFloat(tmpN.x, _OBJ_NRM_DEC) + ' ' + _objFloat(tmpN.y, _OBJ_NRM_DEC) + ' ' + _objFloat(tmpN.z, _OBJ_NRM_DEC) + '\n');
      }
    }
    // faces — combine all referenced index arrays + format depends on what's
    // actually present, matching the OBJExporter's per-vertex slot syntax
    // (`v[/vt][/vn]`).
    const ia = idx ? idx.array : null;
    const triCount = (ia ? ia.length : vc) / 3;

    if (uv && nrm) {
      for (let t = 0; t < triCount; t++) {
        const a = (ia ? ia[t*3]   : t*3)   + 1;
        const b = (ia ? ia[t*3+1] : t*3+1) + 1;
        const c = (ia ? ia[t*3+2] : t*3+2) + 1;
        append('f ' +
          (a + vOffset) + '/' + (a + uvOffset) + '/' + (a + nOffset) + ' ' +
          (b + vOffset) + '/' + (b + uvOffset) + '/' + (b + nOffset) + ' ' +
          (c + vOffset) + '/' + (c + uvOffset) + '/' + (c + nOffset) + '\n');
      }
    } else if (nrm) {
      for (let t = 0; t < triCount; t++) {
        const a = (ia ? ia[t*3]   : t*3)   + 1;
        const b = (ia ? ia[t*3+1] : t*3+1) + 1;
        const c = (ia ? ia[t*3+2] : t*3+2) + 1;
        append('f ' +
          (a + vOffset) + '//' + (a + nOffset) + ' ' +
          (b + vOffset) + '//' + (b + nOffset) + ' ' +
          (c + vOffset) + '//' + (c + nOffset) + '\n');
      }
    } else if (uv) {
      for (let t = 0; t < triCount; t++) {
        const a = (ia ? ia[t*3]   : t*3)   + 1;
        const b = (ia ? ia[t*3+1] : t*3+1) + 1;
        const c = (ia ? ia[t*3+2] : t*3+2) + 1;
        append('f ' +
          (a + vOffset) + '/' + (a + uvOffset) + ' ' +
          (b + vOffset) + '/' + (b + uvOffset) + ' ' +
          (c + vOffset) + '/' + (c + uvOffset) + '\n');
      }
    } else {
      for (let t = 0; t < triCount; t++) {
        const a = (ia ? ia[t*3]   : t*3)   + 1;
        const b = (ia ? ia[t*3+1] : t*3+1) + 1;
        const c = (ia ? ia[t*3+2] : t*3+2) + 1;
        append('f ' + (a + vOffset) + ' ' + (b + vOffset) + ' ' + (c + vOffset) + '\n');
      }
    }

    vOffset  += vc;
    if (nrm) nOffset  += nrm.count;
    if (uv)  uvOffset += uv.count;
  });

  flush();
  const objBlob = new Blob(parts, { type: 'text/plain' });

  // Build the .mtl content. PBR roughness/metalness aren't standard OBJ MTL
  // fields, but `Pr` (roughness) and `Pm` (metalness) are the de-facto PBR
  // extension that Blender, Substance, and SideFX Houdini all read.
  let mtlBlob = null;
  if (mtlBaseName && matByHex.size > 0) {
    const lines = ['# Exported by STEP Optimizer\n'];
    for (const e of matByHex.values()) {
      lines.push(`newmtl ${e.name}\n`);
      lines.push(`Kd ${_objFloat(e.r, 4)} ${_objFloat(e.g, 4)} ${_objFloat(e.b, 4)}\n`);
      lines.push(`Ka 0 0 0\n`);
      lines.push(`Ks 0 0 0\n`);
      lines.push(`d 1\n`);                       // opacity
      lines.push(`illum 2\n`);                   // diffuse + specular
      lines.push(`Pr ${_objFloat(e.roughness, 3)}\n`);
      lines.push(`Pm ${_objFloat(e.metalness, 3)}\n`);
    }
    mtlBlob = new Blob(lines, { type: 'text/plain' });
  }
  return { objBlob, mtlBlob };
}

// ── Save / restore scene state ──────────────────────────────────────────────
// Round-trips through a normal .glb. We bundle a JSON sidecar (camera, view
// toggles, threshold, per-part visible/flagged) into the scene's `extras`. Any
// other GLB tool ignores extras; reopening here picks them back up and applies
// them after the model is loaded so the user lands exactly where they left off.
const SCENE_STATE_KEY = '__stepOptimizerSceneState__';
const SCENE_STATE_VERSION = 1;

function _collectSceneState() {
  const partsPayload = [];
  for (const p of state.parts) {
    if (p.deleted) continue;
    // Only emit per-part rows that diverge from defaults — keeps the sidecar
    // small for big assemblies where nothing has been touched.
    if (p.visible && !p.flagged) continue;
    partsPayload.push({
      idx: p.partId,
      name: p.name,
      visible: p.visible,
      flagged: p.flagged,
    });
  }
  // Camera distance can be huge for unscaled CAD models, so store full doubles.
  const cam = camera ? {
    pos:    camera.position.toArray(),
    target: controls ? controls.target.toArray() : [0,0,0],
    up:     camera.up.toArray(),
    fov:    camera.fov,
    near:   camera.near,
    far:    camera.far,
  } : null;
  return {
    v: SCENE_STATE_VERSION,
    app: 'step-optimizer',
    savedAt: new Date().toISOString(),
    sourceName: state._loadedFilename || null,
    camera: cam,
    view: {
      viewMode:        state.viewMode,
      showGrid:        state.showGrid,
      showBboxes:      state.showBboxes,
      showAxes:        state.showAxes,
      threshold:       state.threshold,
      sizeMetricMode:  state.sizeMetricMode,
      autoRotate:      state.autoRotate,
      bgMode:          state.bgMode,
      highlightSmall:  state.highlightSmall,
      perfMode:        state.perfMode,
    },
    parts: partsPayload,
  };
}

function _openSaveSceneDialog(suggested) {
  return new Promise((resolve) => {
    const bg = document.getElementById('save-scene-modal');
    const input = document.getElementById('save-scene-name');
    const okBtn = document.getElementById('save-scene-confirm');
    const cancelBtn = document.getElementById('save-scene-cancel');
    const closeBtn = document.getElementById('save-scene-close');
    if (!bg || !input || !okBtn) { resolve(window.prompt('Save scene as:', suggested)); return; }
    input.value = suggested;
    bg.classList.add('show');
    setTimeout(() => { input.focus(); input.select(); }, 50);
    const finish = (val) => {
      bg.classList.remove('show');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      closeBtn.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKey);
      bg.removeEventListener('click', onBgClick);
      resolve(val);
    };
    const onOk = () => finish(input.value);
    const onCancel = () => finish(null);
    const onKey = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); onOk(); }
      else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    };
    const onBgClick = (e) => { if (e.target === bg) onCancel(); };
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    closeBtn.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKey);
    bg.addEventListener('click', onBgClick);
  });
}

async function saveScene() {
  if (!state.parts.length) { toast('Nothing to save', 'Load a model first', 'warn'); return; }
  // Suggest the last name the user typed (sticky across saves in the same
  // session), falling back to the loaded filename. No timestamp — the user
  // asked to keep it stable so they can overwrite the same file.
  const baseName = (state._loadedFilename || 'scene').replace(/\.[^.]+$/, '');
  const suggested = state._lastSavedSceneName || baseName;
  const entered = await _openSaveSceneDialog(suggested);
  if (entered === null) return;
  let chosenName = (entered || '').trim() || suggested;
  chosenName = chosenName.replace(/\.glb$/i, '').replace(/[\\/:*?"<>|]/g, '_');
  state._lastSavedSceneName = chosenName;
  const fname = `${chosenName}.glb`;
  // If the browser supports the File System Access API, reuse the previously
  // chosen file handle when the name matches — that lets the user "Save"
  // repeatedly without re-picking a location. When the name has changed,
  // open the picker but seed `startIn` with the last handle so it lands in
  // the same folder. Falling back to <a download> means the file lands in
  // the user's default Downloads folder when the picker isn't available.
  let fileHandle = null;
  if (typeof window.showSaveFilePicker === 'function') {
    const prev = state._lastSaveSceneHandle || null;
    if (prev && prev.name === fname) {
      // Verify we still have write permission — handles can lapse if the
      // browser revokes the grant (e.g., page reload). queryPermission is
      // synchronous-ish and cheap; on denial we fall through to the picker.
      let ok = true;
      try {
        if (typeof prev.queryPermission === 'function') {
          const p = await prev.queryPermission({ mode: 'readwrite' });
          if (p !== 'granted') {
            const r = await prev.requestPermission({ mode: 'readwrite' });
            ok = (r === 'granted');
          }
        }
      } catch (_) { ok = false; }
      if (ok) fileHandle = prev;
    }
    if (!fileHandle) {
      try {
        fileHandle = await window.showSaveFilePicker({
          suggestedName: fname,
          startIn: prev || undefined,
          types: [{ description: 'glTF Binary', accept: { 'model/gltf-binary': ['.glb'] } }],
        });
        state._lastSaveSceneHandle = fileHandle;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
        console.warn('[scene-save] save picker failed, falling back to download', e);
      }
    }
  }
  setLoader(true, 'Preparing scene...', 'GLB');
  await new Promise(r => setTimeout(r, 16));
  // visibleOnly:false so hidden parts survive the round-trip — visibility is
  // stored in the sidecar and re-applied on load. Identity axis/scale/origin
  // means the saved file overlays the live scene exactly when reopened.
  const { root, count } = buildExportRoot({ visibleOnly: false, merge: false, scale: 1, axis: 'z-up', origin: 'model' });
  if (count === 0) { setLoader(false); toast('Nothing to save', 'No parts in scene', 'warn'); return; }
  root.updateMatrixWorld(true);
  // Stash the sidecar on a *named* child node so traversal on load can find it
  // unambiguously. The Three.js GLTFExporter wraps a Group root in an
  // auto-generated Scene; setting extras on the scene itself is brittle across
  // versions. A child marker node always survives the wrap and serializes with
  // its userData intact (GLTFExporter writes userData → extras verbatim).
  const marker = new THREE.Object3D();
  marker.name = SCENE_STATE_KEY;
  marker.visible = false;
  marker.userData[SCENE_STATE_KEY] = _collectSceneState();
  root.add(marker);
  try {
    _normalizeNormalsInPlace(root);
    const exp = new GLTFExporter();
    const _origWarn = console.warn;
    console.warn = function(...args) {
      const first = args[0];
      if (typeof first === 'string' && first.indexOf('Creating normalized normal attribute') !== -1) return;
      return _origWarn.apply(this, args);
    };
    let result;
    try {
      result = await new Promise((res, rej) => exp.parse(root, res, rej, { binary: true, embedImages: true }));
    } finally { console.warn = _origWarn; }
    const blob = new Blob([result], { type: 'model/gltf-binary' });
    if (fileHandle) {
      const w = await fileHandle.createWritable();
      await w.write(blob);
      await w.close();
    } else {
      downloadBlob(blob, fname);
    }
    toast('Scene saved', fname, 'success', 4000);
  } catch (e) {
    console.error('[scene-save]', e);
    toast('Save failed', e.message || String(e), 'error', 6000);
  } finally {
    setLoader(false);
  }
}

// Pulled out of the loaded gltf.scene by walking nodes for the marker. We do
// the walk here (rather than reading gltf.scene.userData directly) because
// auto-wrapped scenes don't carry the root group's userData up to the scene.
function _extractSceneState(gltfScene) {
  if (!gltfScene) return null;
  let payload = null;
  let markerObj = null;
  gltfScene.traverse(o => {
    if (payload) return;
    const v = o.userData && o.userData[SCENE_STATE_KEY];
    if (v && typeof v === 'object' && v.app === 'step-optimizer') {
      payload = v;
      if (o.name === SCENE_STATE_KEY) markerObj = o;
    }
  });
  // Strip the marker node so it doesn't pollute the live scene-graph (or the
  // tree view, or any future re-export). Safe: it's a non-renderable Object3D.
  if (markerObj && markerObj.parent) markerObj.parent.remove(markerObj);
  return payload;
}

function _applySceneState(s) {
  if (!s || s.app !== 'step-optimizer') return;
  try {
    const v = s.view || {};
    // View mode (solid/mesh/wire/xray) — has its own state machine via setViewMode.
    if (v.viewMode && v.viewMode !== state.viewMode) {
      try { setViewMode(v.viewMode); } catch (_) {}
      const id = 'vw-' + v.viewMode;
      document.querySelectorAll('#tb [id^="vw-"]').forEach(b => b.classList.remove('active'));
      document.getElementById(id)?.classList.add('active');
    }
    // Toggles that need their helper to re-sync DOM + scene-graph.
    if (typeof v.showGrid === 'boolean' && v.showGrid !== state.showGrid) {
      state.showGrid = v.showGrid;
      if (gridHelper) gridHelper.visible = v.showGrid;
      $('tg-grid')?.classList.toggle('active', v.showGrid);
    }
    if (typeof v.showAxes === 'boolean' && v.showAxes !== state.showAxes) {
      state.showAxes = v.showAxes;
      if (axesHelper) axesHelper.visible = v.showAxes;
      $('tg-axes')?.classList.toggle('active', v.showAxes);
    }
    if (typeof v.showBboxes === 'boolean' && v.showBboxes !== state.showBboxes) {
      state.showBboxes = v.showBboxes;
      if (v.showBboxes && typeof _ensureBboxHelpers === 'function') _ensureBboxHelpers();
      if (state.bboxRoot) state.bboxRoot.visible = v.showBboxes;
      $('tg-bbox')?.classList.toggle('active', v.showBboxes);
    }
    if (typeof v.threshold === 'number') state.threshold = v.threshold;
    if (typeof v.sizeMetricMode === 'string') {
      state.sizeMetricMode = v.sizeMetricMode;
      const sel = $('thr-metric'); if (sel) sel.value = v.sizeMetricMode;
    }
    if (typeof v.highlightSmall === 'boolean') {
      state.highlightSmall = v.highlightSmall;
      const cb = $('toggle-highlight'); if (cb) cb.checked = v.highlightSmall;
    }
    if (typeof v.autoRotate === 'boolean') {
      state.autoRotate = v.autoRotate;
      const cb = $('toggle-rotate'); if (cb) cb.checked = v.autoRotate;
    }
    if (typeof v.bgMode === 'string' && v.bgMode !== state.bgMode) {
      try { setBackground(v.bgMode); } catch (_) {}
      const sel = $('bg-mode'); if (sel) sel.value = v.bgMode;
    }
    if (typeof v.perfMode === 'string') {
      state.perfMode = v.perfMode;
      const sel = $('perf-mode'); if (sel) sel.value = v.perfMode;
      try { applyPerfMode(); } catch (_) {}
    }
    // Per-part visibility + flagged state. Match by name — partIds are
    // assigned by load order, which can shift if anything pre-filtered the
    // mesh list. Names are preserved by the GLTF round-trip.
    if (Array.isArray(s.parts) && s.parts.length) {
      const byName = new Map();
      for (const p of state.parts) byName.set(p.name, p);
      for (const row of s.parts) {
        const p = byName.get(row.name) || state.parts[row.idx];
        if (!p) continue;
        if (typeof row.visible === 'boolean') {
          p.visible = row.visible;
          if (p.mesh) p.mesh.visible = row.visible;
        }
        if (typeof row.flagged === 'boolean') p.flagged = row.flagged;
      }
      try { rebuildTree(); } catch (_) {}
      try { refreshFlagged(); } catch (_) {}
    }
    // Camera last so it isn't clobbered by any helper above. fitToView() in
    // the loader already ran, but our explicit pose overrides it.
    if (s.camera && camera && controls) {
      const c = s.camera;
      if (Array.isArray(c.pos))    camera.position.fromArray(c.pos);
      if (Array.isArray(c.up))     camera.up.fromArray(c.up);
      if (typeof c.fov === 'number')  camera.fov = c.fov;
      if (typeof c.near === 'number') camera.near = c.near;
      if (typeof c.far === 'number')  camera.far = c.far;
      camera.updateProjectionMatrix();
      if (Array.isArray(c.target)) controls.target.fromArray(c.target);
      controls.update();
    }
    requestRender();
    toast('Scene restored', 'Camera + view restored from saved scene', 'success', 4000);
  } catch (e) {
    console.warn('[scene-load] apply failed:', e);
  }
}

async function doExport({ format, merge, visibleOnly, scale=1, axis='z-up', origin='model', draco=false }) {
  setLoader(true, 'Preparing export...', format.toUpperCase());
  await new Promise(r => setTimeout(r, 16));
  const { root, count } = buildExportRoot({ visibleOnly, merge, scale, axis, origin });
  if (count === 0) { setLoader(false); toast('Nothing to export', 'No visible parts', 'warn'); return; }
  // Force-recompute matrixWorld for the entire export subtree. applyMatrix4
  // updates a mesh's local matrix but NOT matrixWorld, and detached subtrees
  // never get an auto-update — the OBJ streaming writer reads matrixWorld
  // directly, and GLTFExporter relies on it for nested-group transforms.
  root.updateMatrixWorld(true);

  // Pre-flight: text-based formats produce huge output for dense models, but
  // we use streaming writers below so the browser doesn't actually blow up.
  // The warning is now informational — confirm before generating a >500 MB
  // file, but offer to continue.
  // OBJ size warning for >20M-vertex exports removed per UX preference: only
  // Box-ify ALL prompts. Heads-up toast still fires so the user knows what
  // they're getting.
  if (format === 'obj') {
    const totalV = _countExportVerts(root);
    if (totalV > 20_000_000) {
      const mb = Math.round(totalV * 30 / 1048576);
      toast('Large OBJ export', `~${mb} MB — GLB / STL would be ~10× smaller`, 'warn', 5000);
      setLoader(true, 'Preparing export...', `OBJ (~${mb} MB)`);
    }
  }

  try {
    const base = 'step_optimized';
    if (format === 'glb' || format === 'gltf') {
      // Pre-normalize every mesh's normal attribute so GLTFExporter doesn't
      // print "Creating normalized normal attribute…" once per mesh. Float
      // precision drift after multiple matrix applies leaves magnitudes ~1
      // ± a few ULP, which is enough for the exporter's strict check to
      // build a corrected copy in the background. Doing the pass here is
      // free: applies in place to the same buffers we just built.
      _normalizeNormalsInPlace(root);
      const exp = new GLTFExporter();
      const isBin = format === 'glb';
      // Filter the spammy "Creating normalized normal attribute" warning
      // that GLTFExporter logs once per mesh when normals fail its 5e-4
      // length tolerance. _normalizeNormalsInPlace fixes the buffers in
      // place — but the exporter inspects geometries it dedupes by
      // reference, and the check sometimes lands before our pass on a
      // sibling reference. Regardless, the warning is informational only
      // (the exporter handles it internally); muting it for the duration
      // of `parse()` keeps the console readable on big assemblies.
      const _origWarn = console.warn;
      console.warn = function(...args) {
        const first = args[0];
        if (typeof first === 'string' && first.indexOf('Creating normalized normal attribute') !== -1) return;
        return _origWarn.apply(this, args);
      };
      let result;
      try {
        result = await new Promise((res, rej) => exp.parse(root, res, rej, { binary: isBin, embedImages: true }));
      } finally {
        console.warn = _origWarn;
      }
      if (isBin) {
        let outBuf = result;          // ArrayBuffer from GLTFExporter
        if (draco) {
          // Lazy-load gltf-transform + draco encoder ONLY when the user opted
          // in. Both libs together are ~2 MB and downloading them on every
          // page load would penalise users who never use Draco.
          try {
            setLoader(true, 'Compressing with Draco…', 'GLB');
            await new Promise(r => setTimeout(r, 16));
            outBuf = await _compressGLBWithDraco(new Uint8Array(result));
          } catch (e) {
            console.error('[draco] compression failed:', e);
            toast('Draco failed', e.message || String(e), 'error', 6000);
            // Fall back to the uncompressed buffer so the user still gets
            // a working file — better than no download at all.
            outBuf = result;
          }
        }
        downloadBlob(new Blob([outBuf], { type: 'model/gltf-binary' }), base + (draco ? '.draco.glb' : '.glb'));
      } else {
        downloadBlob(new Blob([JSON.stringify(result)], { type: 'model/gltf+json' }), base + '.gltf');
      }
    } else if (format === 'obj') {
      // Streaming writer — never builds a single string > 4 MB, so V8's
      // string-length limit doesn't apply regardless of model size.
      // Returns { objBlob, mtlBlob } — the MTL is null if the model has no
      // material colors. Download both so colors survive reimport.
      const { objBlob, mtlBlob } = _exportObjStreaming(root, base);
      downloadBlob(objBlob, base + '.obj');
      if (mtlBlob) downloadBlob(mtlBlob, base + '.mtl');
    }
    else if (format === 'fbx') {
      // Two export paths: binary FBX 7.4 (default — Blender, Maya, Houdini,
      // Unreal, 3ds Max) and ASCII FBX 7.4 (checkbox — extra-compatible with
      // Houdini's Filmbox importer; also tried if binary fails in any app).
      // The ASCII exporter went through a major correctness pass: added the
      // FBX-SDK-required Documents / References / Takes top-level nodes,
      // fixed GeometryVersion ordering, added NodeAttribute for group nodes,
      // fixed Shading: Y, fixed OriginalUpAxis: -1, and fixed Definitions
      // count to match the actual Objects emitted.
      _normalizeNormalsInPlace(root);
      const useAscii = document.getElementById('exp-fbx-ascii')?.checked;
      if (useAscii) {
        setLoader(true, 'Building FBX...', 'ASCII FBX 7.4');
        const fbxBlob = _exportFbxAscii(root);
        downloadBlob(fbxBlob, base + '.fbx');
        Log.info('FBX exported as ASCII (FBX 7.4)', { tag: 'export' });
      } else {
        setLoader(true, 'Building FBX...', 'binary FBX');
        // Primary path: GLB → Assimp → FBX. Assimp's output is validated
        // against the Autodesk FBX SDK so it opens reliably in Cinema 4D,
        // Houdini, Maya, and Unreal. Falls back to the built-in hand-rolled
        // writer if Assimp is unavailable or fails.
        let exported = false;
        try {
          const glbBuf = await new Promise((ok, fail) =>
            new GLTFExporter().parse(root, ok, fail, { binary: true, forceIndices: true, onlyVisible: true })
          );
          const { bytes: fbxBytes, fmt } = await _convertGlbToFbx(new Uint8Array(glbBuf));
          downloadBlob(new Blob([fbxBytes], { type: 'application/octet-stream' }), base + '.fbx');
          Log.info(`FBX exported via Assimp (${fmt === 'fbxa' ? 'ASCII fallback' : 'binary'})`, { tag: 'export' });
          exported = true;
        } catch (e) {
          Log.warn('Assimp FBX failed, using built-in writer: ' + (e.message || e), { tag: 'export' });
        }
        if (!exported) {
          const fbxBlob = await _exportFbxBinary(root);
          const fbxBytes = fbxBlob.size;
          downloadBlob(fbxBlob, base + '.fbx');
          // Count meshes in the export root for debugging.
          let _dbgMeshCount = 0; root.traverse(o => { if (o.isMesh) _dbgMeshCount++; });
          Log.info(`FBX binary (built-in): ${fbxBytes} bytes, ${_dbgMeshCount} meshes (no compression)`, { tag: 'export' });
        }
      }
    }
    else if (format === 'usdz') {
      // OpenUSD via Apple's USDZ container (zipped USD). Universal Scene
      // Description is the post-glTF "lingua franca" Pixar/Apple/Adobe
      // are pushing — Quick Look, Reality Composer, Substance, modern
      // Blender, Maya, Houdini, Cinema 4D R26+, and Unreal/Unity all read
      // it. three.js ships USDZExporter which packs PBR materials and
      // mesh hierarchy into a .usdz zip (no compression — USD spec
      // requires STORED to allow mmap'd reads).
      const exp = new USDZExporter();
      const arr = await exp.parseAsync(root);
      downloadBlob(new Blob([arr], { type: 'model/vnd.usdz+zip' }), base + '.usdz');
    }
    else if (format === 'stl') {
      setLoader(true, 'Building STL...', 'Binary STL');
      // STLExporter.parse() returns a DataView (not ArrayBuffer) in binary mode.
      // Explicitly pull .buffer so Blob gets a clean ArrayBuffer — avoids any
      // edge-case where the browser treats DataView differently as a Blob source.
      const stlData = new STLExporter().parse(root, { binary: true });
      const stlBuf  = stlData instanceof DataView ? stlData.buffer : stlData;
      downloadBlob(new Blob([stlBuf], { type: 'model/stl' }), base + '.stl');
      Log.info(`STL exported (binary, ${(stlBuf.byteLength / 1024).toFixed(1)} KB)`, { tag: 'export' });
    }
    else if (format === 'ply') {
      // PLYExporter reads per-vertex colors from geometry.attributes.color.
      // PLY has no concept of material colors, so we synthesize a flat
      // per-vertex color buffer per mesh from its material color.
      //
      // CRITICAL: buildExportRoot now SHARES one cloned BufferGeometry
      // across every part with the same hash (dedup for GLTFExporter).
      // Adding a color attribute to a shared geom would propagate one
      // mesh's color to every instance. Re-clone here per mesh, breaking
      // the share so each mesh gets its own color attribute. PLY can't
      // benefit from geometry sharing anyway (the format has no
      // instancing).
      const cloned = new WeakSet();
      root.traverse(o => {
        if (!o.isMesh || !o.geometry) return;
        if (!cloned.has(o.geometry)) {
          o.geometry = o.geometry.clone();
          cloned.add(o.geometry);
        }
        if (o.geometry.attributes.color) return;
        const c = o.material?.color;
        if (!c) return;
        const n = o.geometry.attributes.position?.count || 0;
        if (!n) return;
        const arr = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { arr[i*3]=c.r; arr[i*3+1]=c.g; arr[i*3+2]=c.b; }
        o.geometry.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      });
      const out = await new Promise(res => new PLYExporter().parse(root, res, { binary: true, includeColors: true }));
      const blob = out instanceof ArrayBuffer ? new Blob([out], { type: 'model/ply' }) : new Blob([out], { type: 'text/plain' });
      downloadBlob(blob, base + '.ply');
    }
    toast('Exported', `${format.toUpperCase()} - ${count} object${count===1?'':'s'}`, 'success');
  } catch (e) {
    console.error(e);
    // "Invalid string length" is the V8 error for a too-large concatenated
    // string. Translate it into actionable advice instead of dumping the
    // engine error in a toast.
    const isStringLimit = e instanceof RangeError && /string length/i.test(e.message || '');
    if (isStringLimit) {
      toast('Model too big for ' + format.toUpperCase(),
            'Export ran out of string memory. Use GLB (binary) or STL (binary) for large models.',
            'error', 9000);
    } else {
      toast('Export failed', e.message || String(e), 'error');
    }
  }
  finally { setLoader(false); }
}

function wireUI() {
  new ResizeObserver(onResize).observe($('canvas'));
  $('btn-fit').addEventListener('click', fitToView);
  $('btn-reset').addEventListener('click', async () => {
    // No source cached (camera-only mode for legacy state): just reset view.
    if (!state._sourceFile) { camera.up.set(0,0,1); fitToView(); return; }
    const editCount = (state.history?.length || 0)
      + (state.parts?.filter(p => p.deleted).length || 0);
    const detail = editCount > 0
      ? `Discards every edit (${editCount} undo entr${editCount === 1 ? 'y' : 'ies'} + deletions, hierarchy changes, colors, merges, splits) and re-parses ${state._sourceFile.name}.`
      : `Re-parses ${state._sourceFile.name} from scratch.`;
    const ok = await appConfirm(detail, {
      title: 'Revert to original model?',
      okLabel: 'Revert',
      cancelLabel: 'Keep edits',
      danger: true,
    });
    if (!ok) return;
    // Source file may be any supported mesh format — route through the same
    // dispatcher used by drag-and-drop so revert works for FBX/OBJ/3MF/STL too.
    const meshLoader = _loaderForName(state._sourceFile?.name);
    if (meshLoader) meshLoader(state._sourceFile);
    else loadGlbFile(state._sourceFile);
  });
  $('btn-undo').addEventListener('click', () => undoLast());
  $('btn-redo')?.addEventListener('click', () => redoLast());
  $('btn-save-scene')?.addEventListener('click', () => { saveScene(); });
  // Export dropdown — click toolbar Export → choose format → modal opens
  // for that format's options. Clicking any format pre-selects the matching
  // .fmt-card so the modal appears focused on what the user picked.
  function _openExportModalForFormat(fmt) {
    document.querySelectorAll('#format-grid .fmt-card').forEach(c => {
      c.classList.toggle('selected', c.dataset.fmt === fmt);
    });
    if (typeof _refreshFormatToggles === 'function') _refreshFormatToggles();
    _showExportSourceNote();
    $('export-modal').classList.add('show');
  }
  function _closeExportMenu() {
    $('export-menu')?.classList.remove('show');
    document.querySelector('.export-wrap')?.classList.remove('open');
  }
  function _toggleExportMenu() {
    const menu = $('export-menu');
    const wrap = document.querySelector('.export-wrap');
    if (!menu || !wrap) return;
    const open = !menu.classList.contains('show');
    menu.classList.toggle('show', open);
    wrap.classList.toggle('open', open);
  }
  $('export-menu')?.addEventListener('click', e => {
    const item = e.target.closest('.export-menu-item');
    if (!item) return;
    const fmt = item.dataset.fmt;
    _closeExportMenu();
    _openExportModalForFormat(fmt);
  });
  // Outside-click + Esc dismiss the dropdown.
  document.addEventListener('click', e => {
    if (!e.target.closest('.export-wrap')) _closeExportMenu();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && $('export-menu')?.classList.contains('show')) _closeExportMenu();
  });

  // Source-compression banner — hoisted out of the click handler so the
  // dropdown→modal path can reuse it for every format.
  function _showExportSourceNote() {
    const note = $('exp-source-note');
    const exts = state._sourceExtensions || [];
    const hits = exts.filter(e =>
      e === 'KHR_draco_mesh_compression' ||
      e === 'EXT_meshopt_compression' ||
      e === 'KHR_mesh_quantization'
    );
    if (note) {
      if (hits.length) {
        const isDraco = hits.includes('KHR_draco_mesh_compression');
        const human = hits.map(e => e.replace('KHR_', '').replace('EXT_', '').replace(/_/g, ' ')).join(', ');
        note.style.display = '';
        note.innerHTML =
          `<strong>Source uses ${human}.</strong> ` +
          `Without compression on export, the file will be 2–20× larger than the original. ` +
          (isDraco
            ? `Tick "Draco compression" above to roughly match the source size.`
            : `Three.js doesn't ship a quantization exporter — for the smallest file, post-process with <code style="background:rgba(0,0,0,.25);padding:0 4px;border-radius:3px">gltf-transform quantize</code>.`);
      } else {
        note.style.display = 'none';
      }
    }
  }

  // Toolbar Export button → open the dropdown menu (which then opens the
  // modal with the chosen format pre-selected).
  $('btn-export').addEventListener('click', e => {
    e.stopPropagation();
    _toggleExportMenu();
  });

  $('vw-solid').addEventListener('click', () => setViewMode('solid'));
  $('vw-wire').addEventListener('click', () => setViewMode('wire'));
  $('vw-xray').addEventListener('click', () => setViewMode('xray'));
  $('gz-translate')?.addEventListener('click', () => setGizmoMode('translate'));
  $('gz-rotate')?.addEventListener('click', () => setGizmoMode('rotate'));
  $('gz-scale')?.addEventListener('click', () => setGizmoMode('scale'));

  // Global shift-to-snap. Industry-standard Maya/Blender/Max behaviour: hold
  // Shift while dragging any gizmo handle and the motion snaps to fixed
  // increments. Listeners are document-level so the modifier is honoured
  // regardless of which element has focus, and keydown auto-repeat is a no-op.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Shift' && !e.repeat) _setGizmoSnap(true);
  });
  document.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') _setGizmoSnap(false);
  });
  // Window blur (alt-tab away while holding Shift) — clear snap so the user
  // doesn't return to a "stuck snap" gizmo.
  window.addEventListener('blur', () => _setGizmoSnap(false));
  $('tg-grid').addEventListener('click', () => { state.showGrid=!state.showGrid; gridHelper.visible=state.showGrid; $('tg-grid').classList.toggle('active', state.showGrid); requestRender(); });
  $('tg-bbox').addEventListener('click', () => {
    state.showBboxes = !state.showBboxes;
    if (state.showBboxes) _ensureBboxHelpers();
    state.bboxRoot.visible = state.showBboxes;
    $('tg-bbox').classList.toggle('active', state.showBboxes);
    requestRender();
  });
  $('tg-axes').addEventListener('click', () => { state.showAxes=!state.showAxes; axesHelper.visible=state.showAxes; $('tg-axes').classList.toggle('active', state.showAxes); requestRender(); });
  $('tg-grid').classList.add('active'); $('tg-axes').classList.add('active'); $('vw-solid').classList.add('active');
  $('gz-translate')?.classList.add('active');

  let mouseDown = null;
  // ─── Click-pick + Ctrl-drag marquee selection ────────────────────────────
  // Plain left-drag      → OrbitControls rotates (unchanged).
  // Ctrl/Cmd + drag      → marquee select (replaces selection with hits).
  // Ctrl/Cmd+Shift+drag  → marquee select (adds hits to existing selection).
  // Click (no drag)      → single-pick (or clear empty); shift/ctrl on click
  //                        still flow through to existing add/toggle paths.
  let _marquee = null;
  const MARQUEE_THRESHOLD = 5;
  const _marqEl = $('marquee-box');
  // Reset all marquee/orbit state. Called on every fresh mousedown and on
  // window blur / pointercancel to prevent a stale `_marquee` or
  // `controls.enabled = false` from a previously-aborted drag (window switch,
  // pointer left canvas, browser focus loss) bleeding into the next click and
  // making subsequent picks fail.
  //
  // Important: do NOT re-enable OrbitControls if a TransformControls drag is
  // currently active. The gizmo's 'dragging-changed' handler sets
  // controls.enabled=false synchronously when the user grabs an axis arrow,
  // and that runs *before* this mousedown reset (listeners fire in
  // registration order: OrbitControls → TransformControls → our canvas
  // mousedown). Without the guard, the reset would clobber the gizmo's
  // disable, OrbitControls would rotate the camera while the user drags the
  // arrow, and the user sees the camera tilt mid-edit.
  const _resetInteractionState = () => {
    if (_marquee) {
      _marqEl?.classList.remove('active');
      _marquee = null;
    }
    if (!state.gizmo?.dragging) controls.enabled = true;
  };
  window.addEventListener('blur', _resetInteractionState);
  document.addEventListener('pointercancel', _resetInteractionState);

  $('canvas').addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    // Always start from a clean slate — see _resetInteractionState comment.
    _resetInteractionState();
    mouseDown = { x: e.clientX, y: e.clientY };
    // Marquee gated on Ctrl/Cmd ONLY. Shift alone keeps standard
    // shift+click-add behaviour and shift+drag stays as orbit.
    if (e.ctrlKey || e.metaKey) {
      _marquee = {
        startX: e.clientX, startY: e.clientY,
        endX:   e.clientX, endY:   e.clientY,
        additive: e.shiftKey,
        toggle:   false,
        active: false,
      };
      // Suppress orbit while Ctrl is held — OrbitControls would otherwise start
      // rotating before the drag passes the marquee threshold.
      controls.enabled = false;
    }
  });
  window.addEventListener('mousemove', e => {
    if (!_marquee) return;
    _marquee.endX = e.clientX;
    _marquee.endY = e.clientY;
    if (!_marquee.active) {
      if (Math.abs(_marquee.endX - _marquee.startX) + Math.abs(_marquee.endY - _marquee.startY) < MARQUEE_THRESHOLD) return;
      _marquee.active = true;
      _marqEl?.classList.add('active');
    }
    if (_marqEl) {
      _marqEl.style.left   = Math.min(_marquee.startX, _marquee.endX) + 'px';
      _marqEl.style.top    = Math.min(_marquee.startY, _marquee.endY) + 'px';
      _marqEl.style.width  = Math.abs(_marquee.endX - _marquee.startX) + 'px';
      _marqEl.style.height = Math.abs(_marquee.endY - _marquee.startY) + 'px';
    }
  });
  window.addEventListener('mouseup', e => {
    if (_marquee?.active) {
      const m = _marquee; _marquee = null;
      _marqEl?.classList.remove('active');
      controls.enabled = true;
      _commitMarqueeSelection(m);
      mouseDown = null;
      return;
    }
    if (_marquee) { _marquee = null; controls.enabled = true; }
    if (!mouseDown) return;
    const dx = Math.abs(e.clientX - mouseDown.x), dy = Math.abs(e.clientY - mouseDown.y);
    mouseDown = null;
    if (dx + dy > 4) return;
    const id = pickAtPointer(e);
    if (id == null) { if (!e.shiftKey && !e.ctrlKey && !e.metaKey) clearSelection(); return; }
    selectPart(id, e.shiftKey ? 'add' : (e.ctrlKey || e.metaKey ? 'toggle' : 'single'));
  });

  // Tree search rebuilds every node on each keystroke — collapse to one rebuild
  // per frame so typing stays responsive on 5k-part trees.
  $('tree-filter').addEventListener('input', rafCoalesce(() => rebuildTree()));
  $('tree').addEventListener('click', e => {
    // Chevron toggle — only collapses/expands. The row body itself selects
    // (matches Blender / Cinema 4D / Maya / file explorer convention where
    // chevron = expand, row body = select).
    const chev = e.target.closest('[data-toggle]');
    if (chev) {
      const gid = parseInt(chev.dataset.toggle, 10);
      // Fast path: toggle visibility via class flip on the toggled subtree.
      // Avoids the full rebuildTree (which rebuilt 9700+ DOM rows AND ran
      // _lucide() across ~20k icon placeholders — the actual reason the
      // toggle felt sticky on big files). Falls back to rebuild only when
      // a search filter is active (search-driven visibility interacts with
      // collapse in a way the fast path doesn't fully model).
      if (($('tree-filter').value || '') === '') {
        _toggleGroupCollapseFast(gid);
      } else {
        if (state.treeCollapsed.has(gid)) state.treeCollapsed.delete(gid);
        else state.treeCollapsed.add(gid);
        rebuildTree();
      }
      e.stopPropagation();
      return;
    }
    const node = e.target.closest('.tree-node');
    if (!node) return;
    // Instance badge → select every part that shares this part's geometry.
    // Modifiers mirror standard list semantics: plain click replaces, ctrl
    // toggles each in the cohort, shift adds. Implemented BEFORE any other
    // row interaction so a click on the badge never falls through to the
    // row's own select / rename / vis-toggle handlers.
    if (e.target.closest('[data-act="select-instances"]')) {
      const partIdAttr = node.dataset.partId;
      if (partIdAttr != null) {
        const seedId = parseInt(partIdAttr, 10);
        const seed = getPart(seedId);
        if (seed) {
          const cohort = state.parts
            .filter(q => !q.deleted && q.hash === seed.hash)
            .map(q => q.partId);
          if (e.ctrlKey || e.metaKey) {
            for (const id of cohort) {
              if (state.selected.has(id)) state.selected.delete(id);
              else state.selected.add(id);
            }
          } else if (e.shiftKey) {
            for (const id of cohort) state.selected.add(id);
          } else {
            state.selected.clear();
            state.selectedGroupIds?.clear?.();
            for (const id of cohort) state.selected.add(id);
          }
          state._selAnchorId = seedId;
          applySelectionColors();
          rebuildTreeSelectionOnly?.() ?? rebuildTree();
          refreshPropertiesPanel?.();
          if (typeof updateGizmo === 'function') updateGizmo();
          $('del-sel-count').textContent = state.selected.size;
          requestRender();
          // Selection visible in viewport / sidebar chip — no toast.
        }
      }
      e.stopPropagation();
      return;
    }
    // Click on a group ROW (not its chevron) — select every part descendant.
    // The gizmo then auto-attaches at the centroid of all selected parts via
    // updateGizmo, so the user gets a single transform axis for the whole
    // assembly node. Modifier keys mirror the part-click semantics:
    //   plain  → replace selection
    //   ctrl   → toggle each descendant
    //   shift  → add descendants to current selection
    if (node.classList.contains('is-group') && node.dataset.groupId) {
      const rawGid = node.dataset.groupId;
      // userGroups have string ids ('_ug_xxx'); hier groups have numeric ids.
      // The hier-group branch below uses parseInt on the id which yields NaN
      // for userGroups, then _treeGroupDescendants(NaN) returns [], the
      // "empty group" branch clears state.selected, and the cyan outline +
      // gizmo never appear. The secondary listener (_wireUserGroupTreeHandlers)
      // handles userGroups correctly via selectGroup — so for userGroup rows
      // we just bail out of THIS handler and let the secondary one run.
      // Track the click on selectedGroupIds for tree styling so the row
      // visually highlights (the secondary handler doesn't do this).
      const ug = (state.userGroups || []).find(g => String(g.id) === String(rawGid));
      if (ug) {
        if (!e.target.closest('[data-act]') && !e.target.closest('.tree-vis')) {
          if (e.shiftKey) state.selectedGroupIds.add(rawGid);
          else if (e.ctrlKey || e.metaKey) {
            if (state.selectedGroupIds.has(rawGid)) state.selectedGroupIds.delete(rawGid);
            else state.selectedGroupIds.add(rawGid);
          } else {
            state.selectedGroupIds.clear();
            state.selectedGroupIds.add(rawGid);
          }
        }
        return;     // let _wireUserGroupTreeHandlers do the rest (selectGroup)
      }
      const gid = parseInt(rawGid, 10);
      // Eye click on a folder → toggle visibility of every descendant part.
      // Matches Cinema 4D: any-visible → hide all, all-hidden → show all.
      if (e.target.closest('.tree-vis')) {
        const descendants = _treeGroupDescendants(gid);
        if (descendants.length) {
          let anyVisible = false;
          for (const id of descendants) {
            const p = getPart(id);
            if (p && p.visible) { anyVisible = true; break; }
          }
          const next = !anyVisible;
          for (const id of descendants) {
            const p = getPart(id);
            if (!p) continue;
            p.visible = next;
            if (p.mesh) p.mesh.visible = next;
          }
          rebuildTree();
          requestRender();
        }
        e.stopPropagation();
        return;
      }
      const descendants = _treeGroupDescendants(gid);
      if (descendants.length === 0) {
        // Empty group: still let plain click set the row's highlight so the
        // user gets visual feedback. Esc / clicking elsewhere clears.
        if (!(e.ctrlKey || e.metaKey || e.shiftKey)) {
          state.selected.clear();
          state.selectedGroupIds.clear();
          state.selectedGroupIds.add(gid);
          applySelectionColors();
          // Selection-only update — group rows ARE in _treeGroupSelCache so
          // toggling selectedGroupIds is a CSS-class diff, not a DOM rewrite.
          // Keeps the sidebar scroll position frozen.
          rebuildTreeSelectionOnly();
          refreshPropertiesPanel();
          updateGizmo();
          $('del-sel-count').textContent = 0;
        }
        e.stopPropagation();
        return;
      }
      // Click on a hier group row → select every part descendant so the
      // viewport outline + gizmo light up (matching the comment at the top
      // of this if-block). Modifiers mirror part-click semantics:
      //   plain  → replace selection with this group's descendants
      //   ctrl   → toggle each descendant in the existing selection
      //   shift  → add descendants to existing selection
      if (e.ctrlKey || e.metaKey) {
        if (state.selectedGroupIds.has(gid)) state.selectedGroupIds.delete(gid);
        else state.selectedGroupIds.add(gid);
        for (const id of descendants) {
          if (state.selected.has(id)) state.selected.delete(id);
          else state.selected.add(id);
        }
      } else if (e.shiftKey) {
        state.selectedGroupIds.add(gid);
        for (const id of descendants) state.selected.add(id);
      } else {
        state.selected.clear();
        state.selectedGroupIds.clear();
        state.selectedGroupIds.add(gid);
        for (const id of descendants) state.selected.add(id);
      }
      state._selAnchorId = null;
      applySelectionColors();
      // Selection-only update — descendants get .selected via the partId
      // diff, the group row itself via the groupId diff. No DOM rewrite,
      // so the sidebar scroll position stays frozen across repeat clicks.
      rebuildTreeSelectionOnly();
      refreshPropertiesPanel();
      updateGizmo();
      $('del-sel-count').textContent = state.selected.size;
      e.stopPropagation();
      return;
    }
    if (!node.dataset.partId) return; // unhandled group row variant
    const id = parseInt(node.dataset.partId, 10);
    if (e.target.closest('.tree-vis')) { const p = getPart(id); if (p) { p.visible = !p.visible; if (p.mesh) p.mesh.visible = p.visible; rebuildTree(); requestRender(); } e.stopPropagation(); return; }
    // Industry-standard list selection (Windows Explorer / Finder):
    //   click           → single, anchor = clicked
    //   ctrl/cmd+click  → toggle, anchor = clicked
    //   shift+click     → range from anchor to clicked, replacing selection
    //   ctrl+shift+click → range from anchor, ADD to existing selection
    if (e.shiftKey && state._selAnchorId != null && state._selAnchorId !== id) {
      _treeSelectRange(state._selAnchorId, id, e.ctrlKey || e.metaKey);
      // anchor stays put across shift-clicks (Explorer behaviour)
    } else {
      selectPart(id, e.ctrlKey || e.metaKey ? 'toggle' : 'single');
      state._selAnchorId = id;
    }
  });
  // Double-click to rename — works for both parts and user groups.
  $('tree').addEventListener('dblclick', e => {
    const node = e.target.closest('.tree-node');
    if (!node) return;
    // Don't intercept dbl-click on action buttons (eye, chevron, group action buttons)
    if (e.target.closest('.tree-vis,.tree-chev,.tree-group-actions,[data-act]')) return;
    const labelEl = node.querySelector('.tree-label');
    if (!labelEl) return;
    e.preventDefault();
    e.stopPropagation();
    if (window.getSelection) try { window.getSelection().removeAllRanges(); } catch (_) {}

    if (node.dataset.groupId) {
      const gid = node.dataset.groupId;
      // userGroups path: state.userGroups has the entry. Hier path: it's a
      // negative-id entry inside state.treeNodes.
      const ug = (typeof getGroupById === 'function') ? getGroupById(gid) : null;
      if (ug) {
        _treeInlineRename(labelEl, ug.name, (next) => {
          if (next && next !== ug.name) renameUserGroup(gid, next);
        });
        return;
      }
      const numId = parseInt(gid, 10);
      if (!Number.isNaN(numId) && state.treeNodes && state.treeNodes.length) {
        const hn = state.treeNodes.find(n => n.kind === 'group' && n.id === numId);
        if (!hn) return;
        _treeInlineRename(labelEl, hn.name, (next) => {
          if (!next || next === hn.name) return;
          hn.name = next;
          if (hn.obj3d) hn.obj3d.name = next;
          rebuildTree();
        });
        return;
      }
    }
    if (node.dataset.partId) {
      const id = parseInt(node.dataset.partId, 10);
      const p = getPart(id);
      if (!p) return;
      // The hier renderer reads `n.name` (the tree-node entry) before falling
      // back to `p.name`, so renaming a part requires updating BOTH or the
      // tree rebuild paints the old name back over the row.
      const hn = (state.treeNodes && state.treeNodes.length)
        ? state.treeNodes.find(n => n.kind === 'part' && n.partId === id)
        : null;
      const seedName = (hn && hn.name) || p.name;
      _treeInlineRename(labelEl, seedName, (next) => {
        if (!next || next === seedName) return;
        p.name = next;
        if (p.mesh) p.mesh.name = next;
        if (hn) hn.name = next;
        rebuildTree();
        refreshPropertiesPanel();
      });
    }
  });

  // Double-click the part name in the properties panel to rename — same UX
  // as the tree. Delegated on #prop-body since refreshPropertiesPanel rewrites
  // its innerHTML on every selection change.
  $('prop-body')?.addEventListener('dblclick', e => {
    const labelEl = e.target.closest('.prop-name');
    if (!labelEl) return;
    const ids = [...state.selected];
    // Multi-select shows "N parts selected" — not a real name, can't rename.
    if (ids.length !== 1) return;
    const id = ids[0];
    const p = getPart(id);
    if (!p) return;
    e.preventDefault();
    e.stopPropagation();
    if (window.getSelection) try { window.getSelection().removeAllRanges(); } catch (_) {}
    const hn = (state.treeNodes && state.treeNodes.length)
      ? state.treeNodes.find(n => n.kind === 'part' && n.partId === id)
      : null;
    const seedName = (hn && hn.name) || p.name;
    _treeInlineRename(labelEl, seedName, (next) => {
      if (!next || next === seedName) return;
      p.name = next;
      if (p.mesh) p.mesh.name = next;
      if (hn) hn.name = next;
      rebuildTree();
      refreshPropertiesPanel();
    });
  });

  // Size threshold scrubber — quadratic curve so the useful sub-1% range gets
  // most of the bar's horizontal travel.
  const refreshFlaggedRaf = rafCoalesce(refreshFlagged);
  const THR_MAX = 30;
  initScrubber({
    el: 'thr-scrub',
    label: 'Threshold',
    maxSteps: 1000,
    stepToVal: (s) => (s / 1000) ** 2 * THR_MAX,
    valToStep: (v) => Math.sqrt(Math.max(0, Math.min(THR_MAX, v)) / THR_MAX) * 1000,
    format: (v) => ({ value: v < 1 ? v.toFixed(2) : v.toFixed(1), unit: '%' }),
    initialValue: 2,
    promptTitle: 'Size threshold',
    promptUnit: '%',
    onChange: (v) => { state.threshold = v; refreshFlaggedRaf(); },
  });
  $('thr-metric').addEventListener('change', e => { state.sizeMetricMode = e.target.value; refreshFlagged(); });

  $('btn-delete-small').addEventListener('click', async () => {
    const ids = [...state.pendingFlagged];
    if (!ids.length) return toast('No parts to delete', '', 'info');
    deleteParts(ids, 'Removed small parts');
  });
  $('btn-clean-empty').addEventListener('click', cleanEmpty);
  $('btn-clean-dupes').addEventListener('click', cleanDupes);
  $('btn-clean-degenerate').addEventListener('click', cleanDegenerate);
  $('btn-clean-empty-groups')?.addEventListener('click', cleanEmptyGroups);

  $('sel-all').addEventListener('click', () => {
    state.selected.clear();
    for (const p of state.parts) if (!p.deleted) state.selected.add(p.partId);
    applySelectionColors(); rebuildTreeSelectionOnly(); refreshPropertiesPanel(); updateGizmo();
    $('del-sel-count').textContent = state.selected.size;
  });
  $('sel-invert').addEventListener('click', () => {
    const next = new Set();
    for (const p of state.parts) if (!p.deleted && !state.selected.has(p.partId)) next.add(p.partId);
    state.selected = next;
    applySelectionColors(); rebuildTreeSelectionOnly(); refreshPropertiesPanel(); updateGizmo();
    $('del-sel-count').textContent = state.selected.size;
  });
  $('sel-clear').addEventListener('click', clearSelection);
  $('sel-similar').addEventListener('click', selectSimilar);
  $('btn-delete-sel').addEventListener('click', () => {
    if (!state.selected.size) return;
    deleteParts([...state.selected], 'Deleted selected');
  });
  $('btn-isolate').addEventListener('click', isolateSelected);
  $('btn-show-all')?.addEventListener('click', showAllParts);
  $('btn-isolate-small')?.addEventListener('click', isolateFlagged);

  $('toggle-rotate').addEventListener('change', e => { state.autoRotate = e.target.checked; requestRender(); });
  $('toggle-highlight').addEventListener('change', e => {
    state.highlightSmall = e.target.checked;
    document.getElementById('tree')?.classList.toggle('flag-on', state.highlightSmall);
    $('tg-hilite')?.classList.toggle('active', state.highlightSmall);
    applySelectionColors();
    requestRender();
  });
  // Viewport corner toggle mirrors the settings-popup checkbox. Click here
  // is equivalent to flipping the checkbox — fire 'change' so the handler
  // above runs once (state, tree class, render).
  $('tg-hilite')?.addEventListener('click', () => {
    const cb = $('toggle-highlight');
    cb.checked = !cb.checked;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
  });
  // Sun direction gizmo — toggles a TransformControls in rotate mode at the
  // model centre. Rotating drives state._lights.dir position via the helper.
  $('tg-sun')?.addEventListener('click', () => _toggleSunGizmo());
  // Transform panel — slide-in at the bottom of the left sidebar showing
  // editable position/rotation + read-only size for the active selection.
  $('tg-transform')?.addEventListener('click', () => _toggleTransformPanel());
  // Initialize the tree's flag-on class + viewport button to match current toggle state at load.
  document.getElementById('tree')?.classList.toggle('flag-on', !!state.highlightSmall);
  $('tg-hilite')?.classList.toggle('active', !!$('toggle-highlight')?.checked);
  $('bg-mode').addEventListener('change', e => setBackground(e.target.value));
  $('toggle-instance')?.addEventListener('change', e => { state.autoInstance = e.target.checked; toast('Reload model to apply', 'Auto-instancing decision is at parse time', 'info'); });
  $('toggle-share-mat')?.addEventListener('change', e => { state.shareMaterials = e.target.checked; toast('Reload model to apply', 'Material sharing decision is at parse time', 'info'); });
  $('perf-mode')?.addEventListener('change', e => {
    state.perfMode = e.target.value;
    applyPerfMode();
    const label = e.target.value === 'low' ? 'Low (0.6× DPR)' : e.target.value === 'high' ? 'High (full DPR)' : 'Auto';
    // Quality change is reflected in the dropdown itself — no toast.
  });

  // ── Pro-mode scene-settings handlers ────────────────────────────────────
  // Each one updates state.* and applies its side-effect immediately. The
  // handlers are intentionally small so the popup stays responsive even on
  // huge scenes; expensive rebuilds (camera swap, grid rebuild) gate behind
  // change events rather than 'input' so dragging a slider doesn't stutter.
  $('display-units')?.addEventListener('change', e => {
    state.displayUnit = e.target.value;
    try { onSelectionChanged?.(); } catch (_) {}
  });
  $('scene-up-axis')?.addEventListener('change', e => {
    state.sceneUpAxis = e.target.value;
    _applySceneUpAxis();
    requestRender();
  });
  $('scene-scale')?.addEventListener('change', e => {
    const v = parseFloat(e.target.value);
    if (!isFinite(v) || v <= 0) { e.target.value = state.sceneScale; return; }
    state.sceneScale = v;
    _applySceneScale();
    requestRender();
  });
  $('toggle-origin')?.addEventListener('change', e => {
    state.showOrigin = e.target.checked;
    _applyOriginMarker();
    requestRender();
  });
  $('toggle-fps')?.addEventListener('change', e => {
    state.showFps = e.target.checked;
    const el = $('vp-fps'); if (el) el.style.display = state.showFps ? '' : 'none';
  });
  $('toggle-stats')?.addEventListener('change', e => {
    state.showStats = e.target.checked;
    const el = $('vp-stats'); if (el) el.style.display = state.showStats ? '' : 'none';
  });
  // Camera projection: hot-swap PerspectiveCamera ↔ OrthographicCamera while
  // preserving position/target/up. OrbitControls + TransformControls hold a
  // direct camera reference, so both must be re-pointed after the swap.
  $('cam-projection')?.addEventListener('change', e => {
    state.cameraProjection = e.target.value;
    _applyCameraProjection();
    const fovRow = $('cam-fov-row'); if (fovRow) fovRow.style.opacity = (state.cameraProjection === 'persp') ? '1' : '.42';
    requestRender();
  });
  $('cam-fov')?.addEventListener('input', e => {
    const v = parseInt(e.target.value, 10) || 45;
    state.cameraFov = v;
    const lbl = $('cam-fov-val'); if (lbl) lbl.textContent = v;
    if (camera?.isPerspectiveCamera) { camera.fov = v; camera.updateProjectionMatrix(); requestRender(); }
  });
  $('cam-clip')?.addEventListener('change', e => {
    state.cameraClipMode = e.target.value;
    _applyCameraClip();
    requestRender();
  });
  $('light-exposure')?.addEventListener('input', e => {
    const v = parseFloat(e.target.value) || 1;
    state.exposure = v;
    const lbl = $('light-exposure-val'); if (lbl) lbl.textContent = v.toFixed(2);
    if (renderer && 'toneMappingExposure' in renderer) { renderer.toneMappingExposure = v; requestRender(); }
  });
  $('light-ambient')?.addEventListener('input', e => {
    const v = parseFloat(e.target.value) || 0;
    state.ambientIntensity = v;
    const lbl = $('light-ambient-val'); if (lbl) lbl.textContent = v.toFixed(2);
    if (state._lights?.hemi) { state._lights.hemi.intensity = v; requestRender(); }
  });
  $('light-sun')?.addEventListener('input', e => {
    const v = parseFloat(e.target.value) || 0;
    state.sunIntensity = v;
    const lbl = $('light-sun-val'); if (lbl) lbl.textContent = v.toFixed(2);
    if (state._lights?.dir) { state._lights.dir.intensity = v; requestRender(); }
  });
  $('light-azi')?.addEventListener('input', e => {
    state.sunAzimuth = parseInt(e.target.value, 10) || 0;
    const lbl = $('light-azi-val'); if (lbl) lbl.textContent = state.sunAzimuth;
    _applySunDirection(); requestRender();
  });
  $('light-ele')?.addEventListener('input', e => {
    state.sunElevation = parseInt(e.target.value, 10) || 0;
    const lbl = $('light-ele-val'); if (lbl) lbl.textContent = state.sunElevation;
    _applySunDirection(); requestRender();
  });
  $('toggle-shadows')?.addEventListener('change', e => {
    state.shadowsEnabled = e.target.checked;
    _applyShadows(); requestRender();
  });
  $('grid-cell')?.addEventListener('change', e => {
    state.gridCellMode = e.target.value;
    _applyGridCell(); requestRender();
  });
  $('toggle-snap-grid')?.addEventListener('change', e => {
    state.snapToGrid = e.target.checked;
    _applySnap();
  });

  // Status-bar chips: clicking "selected" frames the selection, clicking
  // "flagged" isolates flagged parts. Both no-op when their counter is 0
  // (the .empty class disables pointer-events via CSS).
  $('sb-selected')?.addEventListener('click', () => { try { frameSelected(); } catch (_) {} });
  $('sb-flagged')?.addEventListener('click', () => { try { isolateFlagged(); } catch (_) {} });
  // Initial paint with zero values so the chips render in their muted
  // empty-state on first load before any selection or flag pass runs.
  _updateSelectedChip();
  _updateFlaggedChip();

  // Persist right-sidebar section collapse state across reloads. First-time
  // users land with only Properties + "Selection & actions" expanded — the
  // sidebar holds 12 sections and was always-open by default, which forced
  // scrolling for every interaction. State is keyed by header text so a
  // section reorder doesn't reset the user's preference.
  const SEC_LS_KEY = 'stepopt-section-collapsed';
  const SEC_OPEN_BY_DEFAULT = new Set(['Properties', 'Selection & actions']);
  const _readSecState = () => {
    try { return JSON.parse(localStorage.getItem(SEC_LS_KEY) || '{}') || {}; }
    catch (_) { return {}; }
  };
  const _writeSecState = (m) => {
    try { localStorage.setItem(SEC_LS_KEY, JSON.stringify(m)); } catch (_) {}
  };
  const _secKey = (h) => (h.querySelector('span')?.textContent || h.textContent || '').trim();
  const _saved = _readSecState();
  document.querySelectorAll('#sidebar-right .section-h').forEach(h => {
    const key = _secKey(h);
    let collapsed;
    if (Object.prototype.hasOwnProperty.call(_saved, key)) collapsed = !!_saved[key];
    else collapsed = !SEC_OPEN_BY_DEFAULT.has(key);
    h.classList.toggle('collapsed', collapsed);
  });
  document.querySelectorAll('.section-h').forEach(h => h.addEventListener('click', () => {
    h.classList.toggle('collapsed');
    // Only persist for the right sidebar — left/console/modal section
    // headers (if any are added later) shouldn't pollute the same store.
    if (!h.closest('#sidebar-right')) return;
    const m = _readSecState();
    m[_secKey(h)] = h.classList.contains('collapsed');
    _writeSecState(m);
  }));
  document.querySelectorAll('#format-grid .fmt-card').forEach(card => card.addEventListener('click', () => {
    document.querySelectorAll('#format-grid .fmt-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
  }));
  $('export-close').addEventListener('click', () => $('export-modal').classList.remove('show'));
  $('export-cancel').addEventListener('click', () => $('export-modal').classList.remove('show'));
  // Format-compatibility sheet — opened from "Compare formats" in the export
  // modal header. Stays open over the export modal so the user can glance at
  // it while picking a format.
  $('export-compat-btn')?.addEventListener('click', () => $('format-compat-modal')?.classList.add('show'));
  $('format-compat-close')?.addEventListener('click', () => $('format-compat-modal')?.classList.remove('show'));
  $('format-compat-modal')?.addEventListener('click', (e) => {
    if (e.target === $('format-compat-modal')) $('format-compat-modal').classList.remove('show');
  });
  // Toggle the custom-scale input only when "Custom" is chosen.
  $('exp-scale')?.addEventListener('change', e => {
    const isCustom = e.target.value === 'custom';
    const inp = $('exp-scale-custom');
    if (inp) inp.disabled = !isCustom;
    if (isCustom && inp) inp.focus();
  });
  $('export-confirm').addEventListener('click', async () => {
    const fmt = document.querySelector('#format-grid .fmt-card.selected')?.dataset.fmt || 'glb';
    const merge = $('exp-merge').checked;
    const visibleOnly = $('exp-visible').checked;
    const selectedOnly = $('exp-selected')?.checked || false;
    const draco = $('exp-draco')?.checked && fmt === 'glb';
    // New options: unit scale, up-axis, origin recenter.
    const scaleSel = $('exp-scale')?.value || '1';
    let scale = parseFloat(scaleSel);
    if (scaleSel === 'custom') scale = parseFloat($('exp-scale-custom')?.value || '1');
    if (!isFinite(scale) || scale <= 0) scale = 1;
    const axis = $('exp-axis')?.value || 'z-up';
    const origin = $('exp-origin')?.value || 'model';

    // Validate selected-only.
    if (selectedOnly && (!state.selected || state.selected.size === 0)) {
      toast('Nothing selected', 'Pick at least one part or untick "Selected parts only"', 'warn');
      return;
    }

    $('export-modal').classList.remove('show');

    // CSV branch: parts-list dump (BOM-style). Doesn't go through doExport
    // because there's no geometry pipeline to run — just iterate state.parts.
    if (fmt === 'csv') {
      const parts = state.parts.filter(p => !p.deleted &&
        (!selectedOnly || state.selected.has(p.partId)) &&
        (!visibleOnly || p.visible));
      if (!parts.length) { toast('No parts', 'Nothing matches the export filters', 'warn'); return; }
      const esc = s => {
        const v = String(s ?? '');
        return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      };
      const rows = ['name,color_hex,tri_count,vert_count,volume,diag,max_dim,flagged,visible,locked'];
      for (const p of parts) {
        const sm = p.sizeMetrics || {};
        rows.push([
          esc(p.name),
          '#' + p.originalColor.getHexString(),
          p.triCount | 0,
          p.vertCount | 0,
          (sm.vol ?? 0).toFixed(4),
          (sm.diag ?? 0).toFixed(4),
          (sm.max ?? 0).toFixed(4),
          p.flagged ? 1 : 0,
          p.visible ? 1 : 0,
          p.locked ? 1 : 0,
        ].join(','));
      }
      const blob = new Blob([rows.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'parts_list.csv';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('Exported parts list', `${parts.length} rows`, 'info', 1800);
      return;
    }

    // Geometry export path. "Selected only" is implemented as a temporary
    // visibility flip + visibleOnly=true so doExport's existing filter does
    // the work — the snapshot is restored in finally so the user's actual
    // visibility state is preserved across the export.
    const snapshot = [];
    if (selectedOnly) {
      for (const p of state.parts) {
        if (p.deleted) continue;
        const wantVisible = state.selected.has(p.partId);
        if (p.visible !== wantVisible) {
          snapshot.push({ p, prev: p.visible });
          p.visible = wantVisible;
          if (p.mesh) p.mesh.visible = wantVisible;
        }
      }
    }
    try {
      await doExport({ format: fmt, merge, visibleOnly: selectedOnly ? true : visibleOnly, scale, axis, origin, draco });
    } finally {
      if (snapshot.length) {
        for (const s of snapshot) {
          s.p.visible = s.prev;
          if (s.p.mesh) s.p.mesh.visible = s.prev;
        }
        requestRender();
      }
    }
  });
  // Show/hide format-specific toggles based on the selected export format.
  // Draco is GLB-only; ASCII FBX is FBX-only. Dim and disable when irrelevant
  // so users can see the option exists without us silently ignoring it.
  function _refreshFormatToggles() {
    const sel = document.querySelector('#format-grid .fmt-card.selected');
    const fmt = sel?.dataset.fmt || 'glb';
    const isCsv = fmt === 'csv';

    // Draco — GLB only
    const dracoRow = $('exp-draco-row');
    const dracoCb  = $('exp-draco');
    if (dracoRow && dracoCb) {
      const on = fmt === 'glb';
      dracoRow.style.opacity = on ? '1' : '.42';
      dracoRow.style.pointerEvents = on ? '' : 'none';
      if (!on) dracoCb.checked = false;
    }

    // ASCII FBX — FBX only
    const asciiRow = $('exp-fbx-ascii-row');
    const asciiCb  = $('exp-fbx-ascii');
    if (asciiRow && asciiCb) {
      const on = fmt === 'fbx';
      asciiRow.style.opacity = on ? '1' : '.42';
      asciiRow.style.pointerEvents = on ? '' : 'none';
      if (!on) asciiCb.checked = false;
    }

    // CSV: geometry pipeline doesn't run, so dim the irrelevant rows
    // (scale / axis / origin / merge / draco). 'Visible parts only' and
    // 'Selected parts only' DO still filter rows so they stay enabled.
    const geomRows = ['exp-scale', 'exp-scale-custom', 'exp-axis', 'exp-origin', 'exp-merge'];
    for (const id of geomRows) {
      const el = $(id);
      const wrap = el?.closest('.field') || el?.closest('.toggle') || el?.parentElement;
      if (wrap) {
        wrap.style.opacity = isCsv ? '.42' : '1';
        wrap.style.pointerEvents = isCsv ? 'none' : '';
      }
    }
    if (isCsv && dracoRow) {
      dracoRow.style.opacity = '.42';
      dracoRow.style.pointerEvents = 'none';
      if (dracoCb) dracoCb.checked = false;
    }
  }
  document.querySelectorAll('#format-grid .fmt-card').forEach(c =>
    c.addEventListener('click', () => setTimeout(_refreshFormatToggles, 0)));
  _refreshFormatToggles();

  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'f' || e.key === 'F') {
      // F = focus: frame the selection if any, else fit the whole model.
      if (state.selected.size > 0 && typeof frameSelected === 'function') frameSelected();
      else fitToView();
    }
    else if (e.key === '1') setViewMode('solid');
    else if (e.key === '2') setViewMode('wire');
    else if (e.key === '3') setViewMode('xray');
    else if (e.key === 'e' || e.key === 'E') setGizmoMode('translate');
    else if (e.key === 'r' || e.key === 'R') setGizmoMode('rotate');
    else if (e.key === 't' || e.key === 'T') setGizmoMode('scale');
    else if (e.key === 'q' || e.key === 'Q') setGizmoMode('off');
    else if (e.key === 'g' || e.key === 'G') $('tg-grid').click();
    else if (e.key === 'b' || e.key === 'B') $('tg-bbox').click();
    else if (e.key === 'Delete' || e.key === 'Backspace') { if (state.selected.size > 0) { e.preventDefault(); deleteParts([...state.selected], 'Deleted selected'); } }
    else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); redoLast(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undoLast(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redoLast(); }
    else if (e.key === 'Escape') clearSelection();
    else if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); $('sel-all').click(); }
  });
}

// Module-level decoder singletons — created lazily, reused across loads.
// Building DRACOLoader / KTX2Loader pulls a wasm/worker pool each, so we only
// pay the cost once and re-use the loader's cached transcoders on every
// subsequent file open.
let _gltfDraco = null, _gltfKtx2 = null;
function _getGlbLoader() {
  const loader = new GLTFLoader();
  // Draco: third-party CAD GLBs (e.g. Sketchfab exports) often use it. We
  // never emit Draco from step2glb.py — meshopt is faster + smaller — but
  // attaching the decoder costs nothing if no Draco primitives are present.
  try {
    if (!_gltfDraco) {
      _gltfDraco = new DRACOLoader();
      // Local-first. DRACOLoader uses WASM mode by default — it loads
      // draco_wasm_wrapper.js + draco_decoder.wasm from this path. Our
      // vendor/ folder has both. The `draco_decoder.js` in the same dir
      // is the draco3d UMD used by our compressor; three.js never reads
      // it unless WASM mode is explicitly disabled (we don't).
      _gltfDraco.setDecoderPath('./vendor/draco/');
    }
    loader.setDRACOLoader(_gltfDraco);
  } catch (e) { console.warn('[STEP] DRACOLoader unavailable', e); }
  // KTX2 (texture compression). Almost never present on CAD glTF; harmless to enable.
  try {
    if (!_gltfKtx2) {
      _gltfKtx2 = new KTX2Loader();
      _gltfKtx2.setTranscoderPath('https://unpkg.com/three@0.172.0/examples/jsm/libs/basis/');
      if (renderer && typeof _gltfKtx2.detectSupport === 'function') _gltfKtx2.detectSupport(renderer);
    }
    loader.setKTX2Loader(_gltfKtx2);
  } catch (e) { console.warn('[STEP] KTX2Loader unavailable', e); }
  // Meshopt: tiny synchronous wasm. Required to read EXT_meshopt_compression
  // GLBs produced by gltfpack (step2glb.py --meshopt). Without it, primitives
  // using that extension would be skipped silently and the scene appears empty.
  try { loader.setMeshoptDecoder(MeshoptDecoder); }
  catch (e) { console.warn('[STEP] MeshoptDecoder unavailable', e); }
  return loader;
}

// ─── three-mesh-bvh integration ────────────────────────────────────────────
// Dynamic-imported in boot() so a CDN failure degrades gracefully — without
// the BVH attached, the prototype overrides simply never install and three.js
// uses its default per-triangle raycaster (slower, but correct).
//
// state._bvhReady is true once the prototype overrides are in place. After
// each model load we kick off _buildBVHsForAllGeoms() which walks every
// unique geom and computes a tree. The build is yielded across rAF frames so
// a 200-geom assembly doesn't block the main thread for seconds.
//
// InstancedMesh raycasts ALSO benefit: three.js's InstancedMesh.raycast
// dispatches to Mesh.prototype.raycast for each instance, so overriding the
// prototype gives us O(log N) per-instance triangle search inside the
// existing instancing loop.
state._bvhReady = false;
state._bvhBuilding = false;
state._bvhStrategy = 0;   // 0 = CENTER (fast build), 1 = AVERAGE, 2 = SAH (best query)

async function _buildBVHsForAllGeoms() {
  if (!state._bvhReady) return;
  if (state._bvhBuilding) return;            // re-entrancy guard
  state._bvhBuilding = true;
  const t0 = performance.now();
  let built = 0, cached = 0, skipped = 0, failed = 0;
  // try/finally guarantees _bvhBuilding is cleared. Without it, an exception
  // from the iterator (e.g. geomByHash mutated mid-iteration during a long
  // session of boxify/merge ops) would leave the flag true forever, locking
  // out every future BVH build and slowly degrading pick performance — one
  // of the suspects for "viewport hangs in long sessions".
  try {
  // SAH gives ~2× faster queries on small meshes (typical CAD parts) for ~3×
  // build time. Tradeoff is worth it because picks happen many times per
  // session but build runs once per model. Use CENTER for huge meshes
  // (>500k tris) where SAH's build overhead is prohibitive.
  for (const g of state.geomByHash.values()) {
    if (!g || !g.attributes || !g.attributes.position) continue;
    if (g.boundsTree) { cached++; continue; }
    const triCount = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    // Skip pathological inputs — e.g. point clouds, parts with degenerate index.
    if (triCount < 1) { skipped++; continue; }
    try {
      // RACE FIX: computeBoundsTree REORDERS the geometry's index buffer
      // in-place (replaces geom.index with a permuted BufferAttribute).
      // If the renderer ticks between yields below and tries to draw this
      // mesh, three.js's WebGPU backend can hand setIndexBuffer the OLD
      // (now-disposed) GPU buffer, throwing:
      //   "parameter 1 is not of type 'GPUBuffer'"
      // and freezing the viewport. Setting state.renderPaused = true
      // around the actual mutation guarantees no render happens against
      // a half-mutated index. We release between batches so the UI stays
      // responsive on huge assemblies.
      state.renderPaused = true;
      g.computeBoundsTree({
        strategy: triCount > 500_000 ? 0 : state._bvhStrategy,
        // maxLeafTris default 10 is good — bumping it saves memory at minor
        // pick-time cost. Stick with default.
        verbose: false,
      });
      // Force three.js to re-upload the index buffer to GPU (it now points
      // to a fresh BufferAttribute). Without an explicit needsUpdate, the
      // backend can keep its stale per-attribute GPU buffer cache hit.
      if (g.index) g.index.needsUpdate = true;
      built++;
    } catch (e) {
      failed++;
      // Fairly rare — usually means the geometry has NaN positions or a bad
      // index buffer. Default raycaster still works for these.
      console.warn('[STEP] BVH build failed for one geom:', e?.message || e);
    }
    // Yield every 25 geoms so the UI thread stays responsive on a 1000-geom
    // assembly. 25 is a balance: too small = many timer hops; too large = jank.
    if ((built + failed) % 25 === 0) {
      // Release the render lock during the yield so the next frame can draw.
      // The next iteration re-acquires it before the next computeBoundsTree.
      state.renderPaused = false;
      await new Promise(r => setTimeout(r, 0));
    }
  }
  } finally {
    state.renderPaused = false;
    state._bvhBuilding = false;
    try { requestRender(); } catch (_) {}
  }
  const dt = (performance.now() - t0).toFixed(0);
  Log.success(
    `BVH built ${built} geoms (${cached} cached, ${skipped} skipped, ${failed} failed) in ${dt}ms`,
    { tag: 'bvh' }
  );
}

// Dispose every BVH attached to a hash-cached geom. Called from clearModel.
// Guard with optional chaining because the prototype patch may not have
// installed (CDN failure path) — disposeBoundsTree is a no-op then.
function _disposeAllBVHs() {
  if (!state._bvhReady) return;
  let n = 0;
  for (const g of state.geomByHash.values()) {
    if (g && g.boundsTree) { g.disposeBoundsTree?.(); n++; }
  }
  if (n) Log.debug(`disposed ${n} BVHs`, { tag: 'bvh' });
}

// Format-agnostic ingestion: walks meshes off a parsed scene root, builds
// state.parts, hooks up materials, and triggers all the post-load UI work.
// Called from loadGlbFile / loadFbxFile / loadObjFile / load3mfFile /
// loadStlFile after each format-specific parser produces a THREE.Object3D.
async function _ingestSceneRoot(sceneRoot, file, byteLength, format) {
  const formatLabel = format.toUpperCase();
  setLoaderProgress(60);
  // Yield one microtask so any in-flight WebGPU command buffer can finish
  // before clearModel() starts calling .destroy()/.dispose() on resources.
  await new Promise(r => requestAnimationFrame(r));
  clearModel();
  state.materialByColor.clear(); state.geomByHash.clear(); state.instancedGroups = [];
  const overallBox = new THREE.Box3();
  let totalTris = 0, totalVerts = 0, totalBytes = 0;
  // Track stripped geometries by uuid so shared geoms (auto-instanced parts)
  // are only stripped + accounted for once.
  const _strippedGeoms = new Set();
  let _stripBytesSaved = 0;
  const meshList = [];
  sceneRoot.traverse(o => { if (o.isMesh) meshList.push(o); });
  const meshToPart = new Map();
  let i = 0;
  for (const m of meshList) {
    const geom = m.geometry;
    const pos = geom.attributes.position;
    if (!pos) { i++; continue; }
    if (!geom.attributes.normal) geom.computeVertexNormals();
    geom.computeBoundingBox(); geom.computeBoundingSphere();
    const idx = geom.index?.array;
    const triCount = (idx ? idx.length : pos.count) / 3;
    const vertCount = pos.count;
    totalTris += triCount; totalVerts += vertCount;
    totalBytes += pos.array.byteLength;
    if (geom.attributes.normal) totalBytes += geom.attributes.normal.array.byteLength;
    if (idx) totalBytes += geom.index.array.byteLength;
    let color = new THREE.Color(0xaaaaaa);
    if (m.material?.color) color = m.material.color.clone();
    const bbox = geom.boundingBox.clone();
    m.updateWorldMatrix(true, false);
    bbox.applyMatrix4(m.matrixWorld);
    if (!bbox.isEmpty()) overallBox.union(bbox);
    const sz = bbox.getSize(new THREE.Vector3());
    const partInfo = {
      partId: i, name: m.name || `mesh_${i}`, hash: geom.uuid,
      triCount, vertCount, bbox,
      sizeMetrics: { diag: sz.length(), vol: sz.x*sz.y*sz.z, max: Math.max(sz.x, sz.y, sz.z) },
      visible: true, deleted: false, flagged: false,
      originalColor: color.clone(), mesh: m, group: null, instanceIndex: -1, instancedMesh: null,
      userExtras: (typeof _grabExtras === 'function') ? _grabExtras(m) : {},
    };
    // Dispose the loader-created material before replacing with our shared
    // one — otherwise each mesh leaks one MeshStandardMaterial / Phong /
    // Lambert (plus any embedded textures) until full page reload.
    const _origMat = m.material;
    m.material = getOrCreateMaterial(color);
    if (_origMat && _origMat !== m.material) {
      if (Array.isArray(_origMat)) for (const mm of _origMat) mm?.dispose?.();
      else _origMat.dispose?.();
    }
    m.userData.partId = partInfo.partId;
    if (!_strippedGeoms.has(geom.uuid)) {
      _strippedGeoms.add(geom.uuid);
      _stripBytesSaved += _stripUnusedAttributes(geom, _attributeKeepSet(m.material));
    }
    state.parts.push(partInfo);
    meshToPart.set(m, partInfo);
    if (!state.geomByHash.has(partInfo.hash)) state.geomByHash.set(partInfo.hash, geom);
    i++;
  }
  try { _buildHierarchyFromScene(sceneRoot, meshToPart); }
  catch (err) { console.warn('[STEP] hierarchy build failed:', err); state.treeNodes = []; }
  state.partsRoot.add(sceneRoot);
  state.partsRoot.updateMatrixWorld(true);
  // Capture each mesh's EXACT world matrix BEFORE anything can corrupt it
  // — see the GLB-shear note that used to live here for the rationale.
  for (const p of state.parts) {
    if (p.mesh) {
      p.mesh.updateWorldMatrix(true, false);
      p._exactWorld = p.mesh.matrixWorld.clone();
    }
  }
  // Auto-instance only meaningful for GLBs from step2glb.py — that pipeline
  // shares BufferGeometry across instances so the dedupe pass actually finds
  // matches. FBX / OBJ / 3MF / STL importers each clone geometry per mesh.
  if (format === 'glb' && state.autoInstance) {
    try { _autoInstanceFromGLB(); }
    catch (e) { console.warn('[STEP] auto-instance failed:', e); }
  }
  setLoaderProgress(90);
  state.bboxBuilt = false;
  const size = overallBox.getSize(new THREE.Vector3());
  state.modelDiag = Math.max(size.length(), 0.0001);
  $('sb-parts').textContent = fmtNum(state.parts.length);
  $('sb-tris').textContent = fmtNum(totalTris);
  $('sb-verts').textContent = fmtNum(totalVerts);
  $('sb-mem').textContent = fmtBytes(totalBytes);
  $('vp-tris').textContent = fmtNum(totalTris);
  $('vp-parts').textContent = fmtNum(state.parts.length);
  $('vp-instances').textContent = fmtNum(state.instancedGroups.length);
  $('vp-info').style.display = '';
  state._initialTris = totalTris;
  _updateTriBar(totalTris);
  _reindexParts();
  applyPerfMode();
  rebuildTree(); refreshFlagged(); fitToView();
  state._loadedFilename = file.name;
  // Save-Scene marker only embedded in GLBs we exported ourselves; skip the
  // walk for other formats.
  if (format === 'glb') {
    const _savedState = _extractSceneState(sceneRoot);
    if (_savedState) _applySceneState(_savedState);
  }
  onModelLoaded(file.name);
  _buildBVHsForAllGeoms();
  requestRender();
  setLoaderProgress(100);
  if (_stripBytesSaved > 0) {
    Log.info(`Stripped ${(_stripBytesSaved/1048576).toFixed(1)} MB of unused vertex attributes from ${_strippedGeoms.size} geometries`, { tag: 'load' });
  }
  toast(`${formatLabel} loaded`, `${state.parts.length} meshes - ${(byteLength/1048576).toFixed(1)} MB`, 'success');
  await new Promise(r => setTimeout(r, 350));
  _drainDisposeQueue();
}

// Shared try/finally wrapper around _ingestSceneRoot so each format-specific
// loader is just: read bytes → parse → ingest. Renderer pause + control
// re-enable + loader-overlay teardown all live here so the format functions
// stay tiny.
async function _runLoad(file, formatLabel, parser) {
  setLoader(true, `Reading ${formatLabel}...`, file.name);
  setLoaderProgress(10);
  state._sourceFile = file;
  state.renderPaused = true;
  try {
    await parser();
  } catch (e) {
    console.error(e);
    toast(`${formatLabel} load failed`, e.message || String(e), 'error', 7000);
    await new Promise(r => setTimeout(r, 1500));
  } finally {
    state.renderPaused = false;
    if (controls) controls.enabled = true;
    setLoader(false);
    requestRender();
  }
}

async function loadGlbFile(file) {
  return _runLoad(file, 'GLB', async () => {
    const buffer = await file.arrayBuffer();
    setLoaderProgress(35);
    const loader = _getGlbLoader();
    setLoader(true, 'Parsing GLB scene...', `${(buffer.byteLength/1048576).toFixed(1)} MB`);
    const gltf = await new Promise((res, rej) => loader.parse(buffer, '', res, rej));
    // Inspect the source extensions so we can warn about re-export size.
    // Most CAD-pipeline GLBs ship Draco- or meshopt-compressed; without
    // round-trip support, the re-exported file balloons 5–20× because we
    // write FP32 attributes against the source's quantized/compressed ones.
    try {
      const usedExt = gltf.parser?.json?.extensionsUsed || [];
      state._sourceExtensions = usedExt;
      const compressionExts = usedExt.filter(e =>
        e === 'KHR_draco_mesh_compression' ||
        e === 'EXT_meshopt_compression' ||
        e === 'KHR_mesh_quantization'
      );
      if (compressionExts.length) {
        const human = compressionExts.map(e => e.replace('KHR_', '').replace('EXT_', '')).join(', ');
        Log.warn(`Source GLB uses ${human}. Re-exporting without compression will produce a larger file. ` +
          `Enable "Draco compression" in the export dialog (GLB only) to match the source's compression budget.`,
          { tag: 'load' });
      }
    } catch (_) { /* parser shape may differ between three.js versions; non-fatal */ }
    await _ingestSceneRoot(gltf.scene, file, buffer.byteLength, 'glb');
  });
}

async function loadFbxFile(file) {
  return _runLoad(file, 'FBX', async () => {
    const buffer = await file.arrayBuffer();
    setLoaderProgress(35);
    setLoader(true, 'Parsing FBX scene...', `${(buffer.byteLength/1048576).toFixed(1)} MB`);
    let root;
    try {
      root = new FBXLoader().parse(buffer, '');
    } catch (e) {
      // Three's FBXLoader only handles FBX 7000+ (7.0 / 2011 onward). Older
      // formats — most commonly FileVersion 6100 from pre-2010 exporters —
      // throw "FBX version not supported". Route them through Assimp (which
      // we already vendor for the FBX export pipeline) → GLB in memory →
      // GLTFLoader. Same fallback also catches binary-vs-ASCII confusion
      // and other parser-level failures.
      const msg = (e && (e.message || e.toString())) || '';
      const isVersionMiss = /FBX version not supported|FileVersion: \d+/.test(msg);
      logProgress(
        isVersionMiss
          ? `Legacy FBX detected (${msg.match(/FileVersion: \d+/)?.[0] || 'pre-7.0'}); converting via Assimp…`
          : `FBX parse failed; retrying via Assimp: ${msg}`,
        'warn'
      );
      setLoader(true, 'Converting legacy FBX via Assimp...', `${(buffer.byteLength/1048576).toFixed(1)} MB`);
      let glbBytes;
      try {
        glbBytes = await _convertAnyToGlbWithAssimp(new Uint8Array(buffer), 'input.fbx');
      } catch (e2) {
        // Surface a clean, actionable error rather than the raw Assimp string.
        throw new Error(
          `${msg || 'FBX parse failed'}\n\n` +
          `Assimp fallback also failed: ${e2.message || e2}.\n` +
          `Try re-exporting the file as FBX 2013+ (binary) from the source DCC, ` +
          `or convert it with the free Autodesk FBX Converter.`
        );
      }
      setLoader(true, 'Parsing converted scene...', `${(glbBytes.byteLength/1048576).toFixed(1)} MB GLB`);
      const gltf = await new Promise((resolve, reject) => {
        try {
          new GLTFLoader().parse(glbBytes.buffer, '', resolve, reject);
        } catch (e3) { reject(e3); }
      });
      root = gltf.scene;
    }
    await _ingestSceneRoot(root, file, buffer.byteLength, 'fbx');
  });
}

// Generic Assimp import: feed any format Assimp can read, get back a GLB.
// Mirrors _convertGlbWithAssimp but the input direction is open and the
// target is fixed. Used for legacy-FBX rescue (and reusable for any
// future "format Three doesn't support but Assimp does" case).
async function _convertAnyToGlbWithAssimp(inputBytes, fileName) {
  const ajs = await _getAssimp();
  const fileList = new ajs.FileList();
  // Assimp picks the importer from the extension; fall back to .fbx if
  // the caller didn't supply one.
  fileList.AddFile(fileName || 'input.fbx', inputBytes);
  const result = ajs.ConvertFileList(fileList, 'glb2');
  if (!result.IsSuccess() || result.FileCount() === 0) {
    let detail = '';
    try { detail = result.GetErrorString?.() || result.GetError?.() || result.GetErrorCode?.() || ''; } catch (_) {}
    throw new Error(detail || 'unknown Assimp import error');
  }
  return result.GetFile(0).GetContent();
}

async function loadObjFile(file) {
  return _runLoad(file, 'OBJ', async () => {
    const text = await file.text();
    setLoaderProgress(35);
    setLoader(true, 'Parsing OBJ scene...', `${(text.length/1048576).toFixed(1)} MB`);
    const root = new OBJLoader().parse(text);
    await _ingestSceneRoot(root, file, text.length, 'obj');
  });
}

async function load3mfFile(file) {
  return _runLoad(file, '3MF', async () => {
    const buffer = await file.arrayBuffer();
    setLoaderProgress(35);
    setLoader(true, 'Parsing 3MF scene...', `${(buffer.byteLength/1048576).toFixed(1)} MB`);
    const root = new ThreeMFLoader().parse(buffer);
    await _ingestSceneRoot(root, file, buffer.byteLength, '3mf');
  });
}

async function loadStlFile(file) {
  return _runLoad(file, 'STL', async () => {
    const buffer = await file.arrayBuffer();
    setLoaderProgress(35);
    setLoader(true, 'Parsing STL...', `${(buffer.byteLength/1048576).toFixed(1)} MB`);
    // STL is single-mesh, no scene graph. Wrap in a Group so the ingestion
    // helper sees a normal hierarchy with one mesh leaf.
    const geom = new STLLoader().parse(buffer);
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'mesh';
    const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color: 0xaaaaaa }));
    mesh.name = baseName;
    const root = new THREE.Group();
    root.name = baseName;
    root.add(mesh);
    await _ingestSceneRoot(root, file, buffer.byteLength, 'stl');
  });
}

async function loadByUrl(relUrl) {
  setLoader(true, 'Fetching...', relUrl);
  setLoaderProgress(10);
  try {
    const res = await fetch(relUrl);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = await res.arrayBuffer();
    const fname = relUrl.split('/').pop() || 'model';
    const file = new File([new Blob([buf])], fname);
    const meshLoader = _loaderForName(fname);
    if (meshLoader) await meshLoader(file);
    else await loadStepFile(file);
  } catch (e) {
    // Stale ?file= param pointing at a cleaned-up inbox file is the common
    // case here — silently strip it from the URL and fall back to the
    // welcome screen instead of nagging with a toast on every reload.
    console.warn('[autoload] skipped:', e?.message || e);
    setLoader(false);
    try {
      const url = new URL(location.href);
      if (url.searchParams.has('file')) {
        url.searchParams.delete('file');
        history.replaceState(null, '', url.toString());
      }
    } catch (_) {}
  }
}

async function boot() {
  if (location.protocol === 'file:') return;
  Log.init();
  Log.success('STEP Optimizer booting…', { tag: 'boot' });
  // Yield once before wireUI() so the rest of the module finishes evaluating.
  // The wireUI chain reassigns the binding at line numbers AFTER this boot()
  // call — without yielding, wireUI() here is still the base function only,
  // and every later-layered scrubber/handler silently never wires up.
  await Promise.resolve();
  // Wire all DOM-only UI (scrubbers, sidebar buttons, dropdowns, custom selects)
  // BEFORE awaiting initRenderer() so the panel is interactive immediately
  // while WebGPU initializes in parallel. Handlers close over camera/renderer/
  // scene as references invoked only on user interaction; onResize() guards
  // against missing camera/renderer at this stage.
  wireUI();
  _lucide();
  await initRenderer();
  initScene();
  setBackground('dark');
  buildAxisGizmo();
  onResize();
  tick();

  // ─── three-mesh-bvh (lazy import) ─────────────────────────────────────
  // Done in parallel with the rest of boot — picking only kicks in after the
  // user loads a model, so the wait between Ready and BVH-available is fine.
  // Dynamic import means a CDN failure produces a single warn line instead
  // of breaking the whole app boot.
  import('three-mesh-bvh').then(bvh => {
    THREE.BufferGeometry.prototype.computeBoundsTree = bvh.computeBoundsTree;
    THREE.BufferGeometry.prototype.disposeBoundsTree = bvh.disposeBoundsTree;
    THREE.Mesh.prototype.raycast = bvh.acceleratedRaycast;
    state._bvhReady = true;
    Log.success('three-mesh-bvh loaded — accelerated raycaster active', { tag: 'bvh' });
    // If a model was already loaded before the BVH lib finished downloading
    // (rare; usually CDN beats parsing), build trees retroactively.
    if (state.parts && state.parts.length > 0) _buildBVHsForAllGeoms();
  }).catch(e => {
    Log.warn(`three-mesh-bvh load failed (${e?.message || e}); using default raycaster`, { tag: 'bvh' });
  });

  setStatus('Ready');
  _sceneReady = true;
  Log.success('Ready', { tag: 'boot' });
  if (_pendingFile) {
    const f = _pendingFile; _pendingFile = null;
    const meshLoader = _loaderForName(f.name);
    if (meshLoader) meshLoader(f); else convertStepViaServer(f);
  } else if (_Prefs?.get?.('welcomeOnBoot') !== false) {
    // First-run welcome — only when no model is queued AND the pref is on.
    try { _Welcome.show(); } catch (_) {}
  }
}
boot().catch(e => { console.error('[STEP] Boot failed:', e); try { toast('Init failed', e.message, 'error', 12000); } catch(_){} });

// ============== ADVANCED CLEANUP / OPTIMIZATION ==============

// Flag (highlight yellow) parts with fewer triangles than threshold.
// Reuses the same pendingFlagged set the size-threshold tools use,
// so the existing "Delete N small parts" + "Isolate flagged" still work.
function flagByTriangleCount(minTri) {
  state.pendingFlagged.clear();
  for (const p of state.parts) {
    p.flagged = !p.deleted && p.triCount < minTri;
    if (p.flagged) state.pendingFlagged.add(p.partId);
  }
  $('btn-delete-small-count').textContent = state.pendingFlagged.size;
  $('thr-info').textContent = `${state.pendingFlagged.size} parts have fewer than ${minTri} triangles.`;
  _updateFlaggedChip();
  applySelectionColors();
  rebuildTree();
  toast('Flagged', `${state.pendingFlagged.size} parts under ${minTri} tri`, 'info');
}

// Flag thin sliver parts (long-but-narrow shapes like wires, gaskets, labels).
function flagSlivers(ratio) {
  state.pendingFlagged.clear();
  const sz = new THREE.Vector3();
  for (const p of state.parts) {
    if (p.deleted) { p.flagged = false; continue; }
    p.bbox.getSize(sz);
    const dims = [sz.x, sz.y, sz.z].map(Math.abs).sort((a,b)=>a-b);
    const minD = Math.max(dims[0], 1e-9);
    const maxD = dims[2];
    p.flagged = (maxD / minD) > ratio;
    if (p.flagged) state.pendingFlagged.add(p.partId);
  }
  $('btn-delete-small-count').textContent = state.pendingFlagged.size;
  $('thr-info').textContent = `${state.pendingFlagged.size} sliver parts (aspect > ${ratio}).`;
  _updateFlaggedChip();
  applySelectionColors();
  rebuildTree();
  toast('Flagged', `${state.pendingFlagged.size} thin slivers (aspect > ${ratio})`, 'info');
}

// Select all parts whose name matches a regex (case-insensitive).
function selectByRegex(pattern) {
  if (!pattern) { toast('Empty pattern', '', 'warn'); return; }
  let re;
  try { re = new RegExp(pattern, 'i'); } catch (e) { toast('Invalid regex', e.message, 'error'); return; }
  state.selected.clear();
  for (const p of state.parts) {
    if (p.deleted) continue;
    if (re.test(p.name)) state.selected.add(p.partId);
  }
  applySelectionColors(); rebuildTreeSelectionOnly(); refreshPropertiesPanel(); updateGizmo();
  $('del-sel-count').textContent = state.selected.size;
  // Selection visible in viewport / sidebar chip — no toast.
}

// Extend selection to all parts sharing a color with anything currently selected.
function selectByColor() {
  if (state.selected.size === 0) return toast('Select a reference part first', '', 'warn');
  const colors = new Set();
  for (const id of state.selected) {
    const p = getPart(id);
    if (p) colors.add(p.originalColor.getHex());
  }
  for (const p of state.parts) {
    if (p.deleted) continue;
    if (colors.has(p.originalColor.getHex())) state.selected.add(p.partId);
  }
  // updateGizmo() is critical: without it the gizmo stays attached to the
  // pre-extension single part, so dragging only moves the original — every
  // newly-matched same-color part stays put. selectByPattern already does
  // this; selectByColor just forgot.
  applySelectionColors(); rebuildTreeSelectionOnly(); refreshPropertiesPanel(); updateGizmo();
  $('del-sel-count').textContent = state.selected.size;
  // Selection visible in viewport / sidebar chip — no toast.
}

// Hide selected (non-destructive — restorable via "Show everything")
function hideSelected() {
  if (state.selected.size === 0) return toast('Nothing selected', '', 'warn');
  let count = 0;
  const m4zero = new THREE.Matrix4().makeScale(0,0,0);
  for (const p of state.parts) {
    if (state.selected.has(p.partId) && !p.deleted) {
      p.visible = false;
      if (p.mesh) p.mesh.visible = false;
      if (p.instancedMesh) { p.instancedMesh.setMatrixAt(p.instanceIndex, m4zero); p.instancedMesh.instanceMatrix.needsUpdate = true; }
      count++;
    }
  }
  rebuildTree();
  // Visibility change is visible in the viewport — no toast.
  requestRender();
}

// Recompute smooth vertex normals on every unique geometry — fixes faceting.
function recomputeNormals() {
  let count = 0;
  for (const g of state.geomByHash.values()) {
    g.computeVertexNormals();
    if (g.attributes.normal) g.attributes.normal.needsUpdate = true;
    count++;
  }
  toast('Normals recomputed', `${count} geometries`, 'success');
  requestRender();
}

function recenterModel() {
  const box = new THREE.Box3().setFromObject(state.partsRoot);
  if (box.isEmpty()) return toast('Nothing to recenter', '', 'warn');
  const center = box.getCenter(new THREE.Vector3());
  state.partsRoot.position.sub(center);
  // partsRoot.matrixAutoUpdate=false — must call updateMatrix() explicitly,
  // otherwise the new position never makes it into matrix and matrixWorld
  // stays at identity. Then force-propagate to descendants.
  state.partsRoot.updateMatrix();
  state.partsRoot.updateMatrixWorld(true);
  // _partCenter is captured in WORLD coords (post-multiplied by partsRoot
  // matrixWorld at the time). Shifting partsRoot invalidates every world-
  // space centroid. _origPos is in partsRoot-local frame and is still
  // correct (mesh.position didn't change), so keep those.
  invalidateExplodeBaseline({ parts: false });
  for (const p of state.parts) p._partCenter = null;
  toast('Recentered', `Translated by (${(-center.x).toFixed(1)}, ${(-center.y).toFixed(1)}, ${(-center.z).toFixed(1)})`, 'success');
  requestRender();
}

function bakeTransforms() {
  let count = 0, cloned = 0;
  _detachGizmo();
  const ID = new THREE.Matrix4();

  // Bug fix: in the GLB path, multiple p.mesh objects can share a single
  // BufferGeometry (when the converter emits 2 instances of one shape — under
  // the auto-instance threshold of 3, so they stay as separate Meshes).
  // Calling geom.applyMatrix4(matrixWorld) twice on the same buffer transforms
  // the vertices TWICE, irreversibly corrupting the second part. Dedupe by
  // geometry identity: the first part to bake "wins" the original buffer;
  // subsequent parts get a deep clone they can mutate in isolation.
  const seenGeoms = new Set();
  for (const p of state.parts) {
    if (p.deleted || !p.mesh) continue;
    p.mesh.updateWorldMatrix(true, false);
    if (p.mesh.matrixWorld.equals(ID)) continue;
    let geom = p.mesh.geometry;
    if (seenGeoms.has(geom)) {
      // Already baked into this buffer — give this part its own copy and a
      // fresh hash so deduplication / instancing logic doesn't relink them.
      const fresh = geom.clone();
      p.mesh.geometry = fresh;
      const newHash = (p.hash || 'baked') + '_b' + (count + 1);
      p.hash = newHash;
      state.geomByHash.set(newHash, fresh);
      geom = fresh;
      cloned++;
    } else {
      seenGeoms.add(geom);
    }
    // The BVH (if any) was built against the pre-bake vertex positions, so
    // applying a non-identity matrix invalidates it. Dispose first; the
    // post-bake _buildBVHsForAllGeoms() call below rebuilds against the new
    // positions. Without this, picks on baked parts return wrong hits.
    if (geom.boundsTree) geom.disposeBoundsTree?.();
    geom.applyMatrix4(p.mesh.matrixWorld);
    geom.computeBoundingBox(); geom.computeBoundingSphere();
    p.mesh.position.set(0, 0, 0);
    p.mesh.quaternion.identity();
    p.mesh.scale.set(1, 1, 1);
    p.mesh.updateMatrixWorld(true);
    p.bbox.copy(geom.boundingBox);
    // Bake removed the world transform from the matrix and put it into the
    // vertices. The exact-world snapshot is now identity (mesh.matrix == I,
    // and partsRoot is identity by default). Refresh it so subsequent bakes
    // / merges don't double-apply the old captured transform.
    p._exactWorld = p.mesh.matrixWorld.clone();
    // Invalidate the cached shape fingerprint — bake changes bbox without
    // changing tri/vert counts, so the existing _fpKey would still match
    // and return a stale fingerprint to selectSimilar.
    p._fp = null; p._fpKey = null;
    _disposeEdgesFor(geom);
    count++;
  }
  // Bake collapsed mesh.position to (0,0,0) and put the transform into the
  // vertices. Any cached _origPos was captured before that and no longer
  // refers to a useful rest pose.
  invalidateExplodeBaseline();
  // Rebuild BVHs for any disposed-or-newly-cloned geoms. The function only
  // touches geoms that lack a tree, so this is cheap when nothing changed.
  _buildBVHsForAllGeoms();
  const msg = cloned > 0
    ? `${count} meshes baked (${cloned} cloned to avoid shared-buffer corruption)`
    : `${count} meshes baked into geometry`;
  toast('Transforms baked', msg, 'success');
  requestRender();
}

// Re-center each selected part's local origin to its geometry bbox center
// without changing visual position. Fixes the "gizmo floats out in space"
// problem common to Cinema 4D / Blender exports where the mesh's local
// origin sits far from the actual vertices, so when you select that part
// the translate/rotate gizmo appears nowhere near the visible geometry.
//
// Implementation:
//   1. Get the geometry's local-space bbox center C.
//   2. Translate vertex positions by -C → the new local origin coincides
//      with what was the bbox center.
//   3. Compensate by translating the mesh in its parent frame by R·S·C
//      (rotation+scale applied to C). This keeps every vertex's WORLD
//      position identical: the geometry's old (0,0,0) was at p.position
//      in parent space; the new (0,0,0) needs to be at where C was, i.e.
//      p.position + R·S·C. Math derivation in the comment block below.
//
//   For vertex v: world_old = parent · T(p_old) · R · S · v
//                 world_new = parent · T(p_new) · R · S · (v - C)
//   Equating gives  T(p_new) = T(p_old + R·S·C), hence p_new = p_old + R·S·C.
//
// Geometry-sharing safety: if multiple parts share the BufferGeometry
// (sub-3 instance pairs the auto-instance pass left uncollapsed), the
// translation would corrupt their pivots too. Same dedupe trick as
// bakeTransforms — first part wins the original buffer, subsequent parts
// get a deep clone with a fresh hash.
function centerPivotsOnSelection() {
  if (state.selected.size === 0) {
    toast('Nothing selected', 'Select one or more parts to re-center their pivots', 'warn');
    return;
  }
  _detachGizmo();   // Restore meshes from pivot to partsRoot before mutating

  const seenGeoms = new Map();   // original geom → resolved (own) geom
  const offsetLocal = new THREE.Vector3();
  let centered = 0, skipped = 0, cloned = 0;

  for (const id of state.selected) {
    const p = getPart(id);
    if (!p || p.deleted || !p.mesh) { skipped++; continue; }
    let geom = p.mesh.geometry;
    if (!geom || !geom.attributes?.position) { skipped++; continue; }

    // 1. Compute current local bbox + center.
    if (!geom.boundingBox) geom.computeBoundingBox();
    const center = new THREE.Vector3().addVectors(geom.boundingBox.min, geom.boundingBox.max).multiplyScalar(0.5);
    // Already centered (within 0.001% of bbox diagonal)? Skip — re-centering
    // would be a no-op but would still trash caches.
    const diag = geom.boundingBox.min.distanceTo(geom.boundingBox.max) || 1;
    if (center.length() < diag * 1e-5) { skipped++; continue; }

    // 2. Geometry sharing dedupe — first part to touch a buffer wins it,
    //    subsequent parts get a deep clone to prevent cross-part corruption.
    if (seenGeoms.has(geom)) {
      const fresh = geom.clone();
      const newHash = (p.hash || 'centered') + '_c' + (centered + 1);
      p.mesh.geometry = fresh;
      p.hash = newHash;
      state.geomByHash.set(newHash, fresh);
      geom = fresh;
      cloned++;
    } else {
      seenGeoms.set(geom, geom);
    }

    // 3. Shift vertices so bbox center sits at the local origin.
    geom.translate(-center.x, -center.y, -center.z);
    geom.computeBoundingBox(); geom.computeBoundingSphere();

    // 4. Compensate the mesh's local position. R·S·C using mesh's current
    //    quat + scale; using mesh.matrix would include translation which we
    //    don't want here.
    offsetLocal.copy(center).multiply(p.mesh.scale).applyQuaternion(p.mesh.quaternion);
    p.mesh.position.add(offsetLocal);
    p.mesh.updateMatrixWorld(true);

    // 5. Refresh caches that depend on geometry positions.
    p.bbox.copy(geom.boundingBox);
    p._fp = null; p._fpKey = null;
    if (geom.boundsTree) geom.disposeBoundsTree?.();
    _disposeEdgesFor(geom);

    centered++;
  }

  if (centered > 0) {
    _buildBVHsForAllGeoms();          // rebuild for any disposed/cloned geoms
    applySelectionColors();           // outline buffer references stale edges
    updateGizmo();                    // gizmo now sits at the new (correct) origin
    requestRender();
  }

  const detail = (cloned > 0 ? ` (${cloned} cloned to keep shared geom safe)` : '') +
                 (skipped > 0 ? `, ${skipped} skipped (already centered or instanced)` : '');
  if (centered === 0) {
    toast('Nothing to do', skipped > 0 ? 'All selected parts are already centered or are instanced' : '', 'info');
  } else {
    toast('Axis re-centered', `${centered} part${centered === 1 ? '' : 's'}${detail}`, 'success');
  }
}

function wireAdvancedUI() {
  // Min triangle count scrubber: quadratic curve so 0–500 spans most of the
  // bar but the upper tail still reaches 100k for outlier cases.
  const TRI_MAX = 100000;
  const _triScrub = initScrubber({
    el: 'tri-scrub',
    label: 'Min triangle count',
    maxSteps: 1000,
    stepToVal: (s) => Math.round((s / 1000) ** 2 * TRI_MAX),
    valToStep: (v) => Math.sqrt(Math.max(0, Math.min(TRI_MAX, v)) / TRI_MAX) * 1000,
    format: (v) => ({ value: v.toLocaleString(), unit: 'tri' }),
    initialValue: 12,
    promptTitle: 'Min triangle count',
    onChange: () => {},
  });
  $('btn-flag-tri')?.addEventListener('click', () => flagByTriangleCount(_triScrub ? _triScrub.getValue() : 12));

  // Sliver aspect ratio scrubber: linear 3..200, integer step.
  const _aspScrub = initScrubber({
    el: 'aspect-scrub',
    label: 'Sliver aspect ratio',
    maxSteps: 197,
    stepToVal: (s) => s + 3,
    valToStep: (v) => Math.max(0, Math.min(197, Math.round(v - 3))),
    format: (v) => ({ value: v.toFixed(0), unit: ':1' }),
    initialValue: 20,
    promptTitle: 'Sliver aspect ratio',
    onChange: () => {},
  });
  $('btn-flag-sliver')?.addEventListener('click', () => flagSlivers(_aspScrub ? _aspScrub.getValue() : 20));
  $('btn-select-regex')?.addEventListener('click', () => selectByRegex($('name-regex').value.trim()));
  $('name-regex')?.addEventListener('keydown', e => { if (e.key === 'Enter') selectByRegex(e.target.value.trim()); });
  $('btn-select-color')?.addEventListener('click', selectByColor);
  $('btn-hide-selected')?.addEventListener('click', hideSelected);
  $('btn-recompute-normals')?.addEventListener('click', recomputeNormals);
  $('btn-recenter')?.addEventListener('click', recenterModel);
  $('btn-bake-transforms')?.addEventListener('click', bakeTransforms);
  $('btn-center-pivot')?.addEventListener('click', centerPivotsOnSelection);
}

// ─── wireUI chain helper ──────────────────────────────────────────────────
// Each layer wraps the previous one. If any single setup function throws, we
// log it but keep going — otherwise a bug in one panel's wiring would silently
// kill every panel after it in the chain.
function _safeRun(fn, label) {
  try { fn(); } catch (e) { console.error(`[wireUI] ${label} failed:`, e); }
}
const _origWireUI = wireUI;
wireUI = function() { _safeRun(_origWireUI, 'base'); _safeRun(wireAdvancedUI, 'advanced'); };


// ─── checkAutoLoad: read ?file= query param at startup and auto-load ─────────
(function checkAutoLoad(){
  const f = new URLSearchParams(location.search).get('file');
  if (f) {
    // Restrict to relative paths under inbox/ — reject absolute, scheme, or protocol-relative URLs.
    if (/^[a-z][a-z0-9+.-]*:/i.test(f) || f.startsWith('//') || f.startsWith('/') || f.includes('..')) {
      console.warn('[autoload] rejected non-relative file param:', f);
      return;
    }
    const w = setInterval(() => { if (_sceneReady) { clearInterval(w); loadByUrl(f); } }, 100);
  }
})();

// ─── Materials panel: pull glTF node `extras` into part records ────────────
function _grabExtras(m) {
  if (!m || !m.userData) return {};
  const u = m.userData;
  return { volume: u.volume, area: u.area, material: u.material, colorHex: u.color_hex, density: u.density };
}

function buildMaterialsPanel() {
  const root = $('materials-body');
  if (!root) return;
  if (state.parts.length === 0) {
    root.innerHTML = `<div style="color:var(--tx3);font-size:12.5px;padding:4px 0">Load a model to see materials.</div>`;
    return;
  }
  // Group by Material reference (not by color) so the cards mirror what the
  // Materials viewport popup + editor see. Click-to-select picks every part
  // using that material, click-to-edit (pencil button or dblclick) opens the
  // existing _openMaterialEditor so all the slider edits flow through one path.
  const mats = (typeof _collectLiveMaterials === 'function') ? _collectLiveMaterials() : [];
  if (!mats.length) {
    root.innerHTML = `<div style="color:var(--tx3);font-size:12.5px;padding:4px 0">No materials yet.</div>`;
    return;
  }
  root.innerHTML = '';
  const head = document.createElement('div');
  head.style.cssText = 'font-size:11px;color:var(--tx3);padding:4px 0 8px';
  const live = state.parts.filter(p => !p.deleted).length;
  head.textContent = `${mats.length} material${mats.length === 1 ? '' : 's'} · ${live} part${live === 1 ? '' : 's'}`;
  root.appendChild(head);

  for (const info of mats) {
    const m = info.mat;
    const hex = '#' + (m.color?.getHexString?.() || 'cccccc');
    const name = (m.name && m.name.trim()) || ('mat_' + hex.slice(1));
    const previewUrl = (typeof _renderMaterialPreview === 'function') ? _renderMaterialPreview(m) : null;
    const row = document.createElement('div');
    row.className = 'mat-row';
    row.dataset.matName = name;
    row.style.cssText = 'display:flex;align-items:center;gap:9px;padding:6px 4px;cursor:pointer;border-top:1px solid rgba(255,255,255,.04);font-size:12px;border-radius:6px;transition:background 120ms var(--ease-out)';
    const thumbHtml = previewUrl
      ? `<img src="${previewUrl}" alt="" draggable="false" style="width:26px;height:26px;border-radius:5px;flex-shrink:0;box-shadow:0 1px 3px rgba(0,0,0,.3)">`
      : `<span style="width:26px;height:26px;border-radius:5px;flex-shrink:0;background:${hex};border:1px solid rgba(255,255,255,.15);box-shadow:0 1px 3px rgba(0,0,0,.3)"></span>`;
    row.innerHTML = `
      ${thumbHtml}
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
        <span style="color:var(--tx);font-weight:500" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
        <span style="display:block;font-family:ui-monospace,monospace;font-size:10.5px;color:var(--tx3)">${hex} · ${info.count}</span>
      </span>
      <button class="mat-row-edit" title="Edit material" style="background:transparent;border:1px solid rgba(255,255,255,.06);color:var(--tx2);padding:4px 6px;border-radius:5px;cursor:pointer;flex-shrink:0;transition:background 120ms,border-color 120ms,color 120ms">
        <i data-lucide="sliders-horizontal" style="width:13px;height:13px"></i>
      </button>
    `;
    row.addEventListener('mouseenter', () => row.style.background = 'rgba(255,255,255,.04)');
    row.addEventListener('mouseleave', () => row.style.background = '');
    // Single-click → select every part using this material.
    row.addEventListener('click', (e) => {
      // The pencil/sliders button has its own handler; don't double-fire.
      if (e.target.closest('.mat-row-edit')) return;
      if (!e.shiftKey && !e.ctrlKey && !e.metaKey) state.selected.clear();
      for (const id of info.partIds) state.selected.add(id);
      applySelectionColors(); rebuildTreeSelectionOnly(); refreshPropertiesPanel();
      if (typeof updateGizmo === 'function') updateGizmo();
      $('del-sel-count').textContent = state.selected.size;
    });
    // Double-click anywhere on the row also opens the editor — mirrors the
    // viewport popup convention so users get the same gesture across panels.
    row.addEventListener('dblclick', (e) => {
      e.preventDefault();
      if (typeof _openMaterialEditor === 'function') _openMaterialEditor(info);
    });
    // Pencil/sliders icon — explicit "edit material" affordance.
    row.querySelector('.mat-row-edit')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof _openMaterialEditor === 'function') _openMaterialEditor(info);
    });
    root.appendChild(row);
  }
  _lucide?.();
}

// Hook materials rebuild into the tree rebuild
const _origRebuildTree2 = rebuildTree;
rebuildTree = function() { _origRebuildTree2(); buildMaterialsPanel(); };

// =====================================================================
// Materials popup + per-material editor (draggable).
// Triggered by tg-materials in the viewport overlay. The list groups every
// live material in the scene (by Material reference, not by colour, so two
// materials sharing a hex but with different metalness show separately).
// Double-click opens an editor in a _DraggablePopup with sliders bound to
// the live material — every change is a direct write + requestRender, so
// the viewport updates as you drag. Edits are session-only for now;
// persistence into scene.json is a follow-up.
// =====================================================================

// Walk live parts, collect every unique Material reference. Returns an array
// of { mat, count, partIds } sorted by count desc. Also unions in
// state.userMaterials so user-created materials that haven't been assigned
// yet still show up as a library entry (count 0).
function _collectLiveMaterials() {
  const seen = new Map();
  for (const p of state.parts || []) {
    if (p.deleted) continue;
    let m = p.mesh?.material;
    if (Array.isArray(m)) m = m[0];
    if (!m || !m.isMaterial) continue;
    let entry = seen.get(m);
    if (!entry) { entry = { mat: m, count: 0, partIds: [] }; seen.set(m, entry); }
    entry.count++;
    entry.partIds.push(p.partId);
  }
  // Library-only materials: created via the "New" button without a viewport
  // selection. Stored in state.userMaterials so they survive across
  // selection changes and stay editable until something gets assigned to
  // them (in which case the parts-walk above already covers them too).
  if (state.userMaterials) {
    for (const m of state.userMaterials) {
      if (!seen.has(m)) seen.set(m, { mat: m, count: 0, partIds: [] });
    }
  }
  return [...seen.values()].sort((a, b) => b.count - a.count);
}

// Real 3D shader-ball thumbnail for the materials grid. A single shared
// offscreen WebGL renderer + scene + light rig + Disney-style geometry
// renders each material's ball, snapshots the framebuffer to a data URL,
// and caches by Material reference. Reusing one renderer across all
// thumbnails keeps GPU resource churn near zero.
//
// Env reflections come from PMREM(RoomEnvironment), loaded async at first
// use. Until env is ready we render with the direct lights only — still
// vastly better than the old 2D fake-sphere painting; once env arrives we
// invalidate the cache and refresh any thumbnails currently in the DOM.
const _matPreviewCache = new WeakMap();
const _matThumb = (() => {
  let ctx = null;
  let envReady = false;
  let envLoading = false;
  // The app ships the three.webgpu.js bundle, which doesn't expose
  // WebGLRenderer. Dropping back to a 2D-canvas painter keeps the panel
  // useful (you still see colour + roughness + metalness + emissive cues)
  // without needing a second three.js bundle. Sticky failure flag prevents
  // the warning from firing on every refresh.
  let webglUnavailable = (typeof THREE.WebGLRenderer !== 'function');

  function _init() {
    if (webglUnavailable) return null;
    if (ctx) return ctx;
    const SIZE = 96;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true });
    } catch (e) {
      webglUnavailable = true;
      console.warn('[mat-thumb] WebGL renderer init failed; falling back to 2D preview:', e?.message || e);
      return null;
    }
    renderer.setPixelRatio(1);
    renderer.setSize(SIZE, SIZE, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x1a1f28, 0.35));
    const key  = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(4, 1, 2);     scene.add(key);
    const fill = new THREE.DirectionalLight(0xb0c4ff, 0.35); fill.position.set(-3, 0.5, 1.5); scene.add(fill);
    const rim  = new THREE.DirectionalLight(0xffffff, 0.4); rim.position.set(-1, 1, -3);   scene.add(rim);

    // Same Disney-style assembly as the editor preview ball.
    const sphereGeom = new THREE.SphereGeometry(0.85, 48, 36);
    const torusGeom  = new THREE.TorusGeometry(0.85, 0.10, 16, 64);
    const baseGeom   = new THREE.CylinderGeometry(1.05, 1.10, 0.16, 64, 1, false);
    const ballGroup = new THREE.Group();
    const sphere = new THREE.Mesh(sphereGeom);
    sphere.position.y = 0.30;
    const torus = new THREE.Mesh(torusGeom);
    torus.rotation.x = Math.PI * 0.5;
    torus.position.y = -0.55;
    const base = new THREE.Mesh(baseGeom);
    base.position.y = -0.78;
    ballGroup.add(sphere); ballGroup.add(torus); ballGroup.add(base);
    scene.add(ballGroup);

    const cam = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
    cam.position.set(0, 0.55, 5.0);
    cam.lookAt(0, -0.05, 0);

    ctx = { canvas, renderer, scene, sphere, torus, base, cam, pmrem: null };
    _loadEnv();
    return ctx;
  }

  async function _loadEnv() {
    if (envReady || envLoading || !ctx) return;
    envLoading = true;
    try {
      const { RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js');
      ctx.pmrem = new THREE.PMREMGenerator(ctx.renderer);
      const envScene = new RoomEnvironment();
      ctx.scene.environment = ctx.pmrem.fromScene(envScene, 0.04).texture;
      envScene.traverse(o => { if (o.isMesh) { o.geometry?.dispose(); o.material?.dispose(); } });
      envReady = true;
      // Refresh any cells already painted with the env-less fallback so they
      // pick up the now-correct reflections without a full panel rebuild.
      const cells = document.querySelectorAll('.mat-cell');
      for (const cell of cells) {
        const m = cell._mat;
        if (!m) continue;
        try { _matPreviewCache.delete(m); } catch (_) {}
        const img = cell.querySelector('img.mat-thumb-img');
        const url = render(m);
        if (img && url) img.src = url;
      }
    } catch (e) { console.warn('[mat-thumb] env load failed:', e); }
  }

  function render(mat) {
    const c = _init();
    if (!c) return _render2DFallback(mat);
    try {
      c.sphere.material = mat;
      c.torus.material  = mat;
      c.base.material   = mat;
      c.renderer.render(c.scene, c.cam);
      return c.canvas.toDataURL('image/png');
    } catch (e) {
      console.warn('[mat-thumb] render failed:', e);
      return _render2DFallback(mat);
    }
  }

  // 2D-canvas painter for when WebGLRenderer is missing (the app's main
  // bundle is three.webgpu.js, which strips it). Reads colour / roughness /
  // metalness / emissive off the live Material so each cell still
  // communicates "what does this material look like" at a glance.
  function _render2DFallback(mat) {
    try {
      const SIZE = 96;
      const cvs = document.createElement('canvas');
      cvs.width = cvs.height = SIZE;
      const g = cvs.getContext('2d');
      const cx = SIZE / 2, cy = SIZE / 2 + 2, r = SIZE * 0.40;
      const baseHex = '#' + (mat?.color?.getHexString?.() || 'cccccc');
      const rough = Math.max(0, Math.min(1, mat?.roughness ?? 0.55));
      const metal = Math.max(0, Math.min(1, mat?.metalness ?? 0));
      const emisHex = '#' + (mat?.emissive?.getHexString?.() || '000000');
      const emisI   = Math.max(0, Math.min(2, mat?.emissiveIntensity ?? 0));

      // Ground shadow.
      const sg = g.createRadialGradient(cx, cy + r * 0.95, 0, cx, cy + r * 0.95, r * 1.2);
      sg.addColorStop(0,    'rgba(0,0,0,0.35)');
      sg.addColorStop(0.7,  'rgba(0,0,0,0.10)');
      sg.addColorStop(1,    'rgba(0,0,0,0)');
      g.fillStyle = sg;
      g.beginPath(); g.ellipse(cx, cy + r * 0.95, r * 1.05, r * 0.30, 0, 0, Math.PI * 2); g.fill();

      // Sphere body. Highlight is tighter on glossy / metallic materials.
      const hl = 1 - rough;
      const hlSize = 0.22 + 0.18 * hl;
      const hx = cx - r * 0.32, hy = cy - r * 0.42;
      const grad = g.createRadialGradient(hx, hy, 0, cx, cy, r);
      const lighten = (hex, k) => {
        const n = parseInt(hex.slice(1), 16);
        const R = (n >> 16) & 0xff, G = (n >> 8) & 0xff, B = n & 0xff;
        const f = (v) => Math.max(0, Math.min(255, Math.round(v + (255 - v) * k)));
        return `rgb(${f(R)},${f(G)},${f(B)})`;
      };
      const darken = (hex, k) => {
        const n = parseInt(hex.slice(1), 16);
        const R = (n >> 16) & 0xff, G = (n >> 8) & 0xff, B = n & 0xff;
        return `rgb(${Math.round(R*(1-k))},${Math.round(G*(1-k))},${Math.round(B*(1-k))})`;
      };
      grad.addColorStop(0,      lighten(baseHex, 0.55 + 0.30 * hl));
      grad.addColorStop(hlSize, lighten(baseHex, 0.10));
      grad.addColorStop(0.7,    baseHex);
      grad.addColorStop(1,      darken(baseHex, 0.28 + 0.12 * metal));
      g.fillStyle = grad;
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();

      // Sharp specular highlight for low-roughness / metallic materials.
      if (hl > 0.15) {
        g.globalCompositeOperation = 'lighter';
        const sp = g.createRadialGradient(hx, hy, 0, hx, hy, r * 0.45);
        sp.addColorStop(0, `rgba(255,255,255,${0.55 * hl})`);
        sp.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = sp;
        g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
        g.globalCompositeOperation = 'source-over';
      }

      // Emissive overlay — flat tint scaled by emissiveIntensity.
      if (emisI > 0) {
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = emisHex;
        g.globalAlpha = Math.min(0.7, 0.3 * emisI);
        g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';
      }

      g.strokeStyle = 'rgba(255,255,255,0.06)';
      g.lineWidth = 1;
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();

      return cvs.toDataURL('image/png');
    } catch (_) {
      return null;
    }
  }

  return { render };
})();

function _renderMaterialPreview(mat) {
  const cached = _matPreviewCache.get(mat);
  if (cached) return cached;
  const url = _matThumb.render(mat);
  if (url) _matPreviewCache.set(mat, url);
  return url;
}

// Populate the list inside #vp-materials-pop. Exposed on window so the
// inline toggle script in index.html can call it on open without
// reaching into module scope.
function _populateMaterialsList() {
  const list = document.getElementById('mat-list');
  if (!list) return;
  const mats = _collectLiveMaterials();
  if (mats.length === 0) {
    list.innerHTML = '<div class="mat-empty">No materials yet — load a model.</div>';
    list.className = 'mat-empty';
    return;
  }
  list.innerHTML = '';
  list.className = 'mat-grid';
  for (const info of mats) {
    const m = info.mat;
    const hex = '#' + (m.color?.getHexString?.() || 'cccccc');
    // Prefer the Material's name (often set by the GLB loader from the source
    // material's name); fall back to a short hash of the colour so empty-name
    // materials still get a stable, readable label.
    const name = (m.name && m.name.trim()) || ('mat_' + hex.slice(1));
    const cell = document.createElement('div');
    cell.className = 'mat-cell';
    cell.title = `${m.type} · ${info.count} part${info.count === 1 ? '' : 's'} · double-click to edit`;
    const previewUrl = _renderMaterialPreview(m);
    const thumb = previewUrl
      ? `<img class="mat-thumb-img" src="${previewUrl}" alt="${escapeHtml(name)}" draggable="false">`
      : `<div class="mat-thumb-fallback" style="width:100%;height:100%;background:${hex}"></div>`;
    // Count badge floats on the thumbnail's top-right corner — the
    // standalone .mat-count row used to add a third line under each cell
    // and inflate the grid; tucking it inside the preview keeps the cells
    // tighter and reads like Cinema 4D / Substance "uses" pills.
    cell.innerHTML = `
      <div class="mat-thumb">${thumb}<span class="mat-count">${info.count}</span></div>
      <div class="mat-name">${escapeHtml(name)}</div>
    `;
    // Stash the material on the cell so the editor can find this cell to
    // refresh just one thumbnail when the user edits sliders, without
    // rebuilding the whole grid.
    cell._mat = m;
    cell._info = info;
    if (_matPanelSelected.has(m)) cell.classList.add('selected');
    // Single-click selects in the PANEL only (no viewport effect, per spec).
    // Ctrl/Cmd/Shift+click toggles multi-select for merge/delete/preset
    // batch ops. Double-click opens the editor.
    cell.addEventListener('click', (e) => {
      const multi = e.ctrlKey || e.metaKey || e.shiftKey;
      if (multi) {
        if (_matPanelSelected.has(m)) _matPanelSelected.delete(m);
        else _matPanelSelected.add(m);
      } else {
        const wasOnly = _matPanelSelected.size === 1 && _matPanelSelected.has(m);
        _matPanelSelected.clear();
        if (!wasOnly) _matPanelSelected.add(m);
      }
      _refreshPanelSelection();
    });
    cell.addEventListener('dblclick', (e) => {
      e.preventDefault();
      // Dblclick the name span → inline rename (same UX as tree). Dblclick
      // anywhere else on the cell (sphere, count, padding) opens the editor.
      const nameEl = e.target.closest('.mat-name');
      if (nameEl && nameEl !== cell) {
        e.stopPropagation();
        _renameMaterialInline(nameEl, m);
        return;
      }
      _openMaterialEditor(info);
    });
    list.appendChild(cell);
  }
  _refreshPanelSelection();
}
window._populateMaterialsList = _populateMaterialsList;

// Track which material cells are highlighted in the panel. This is
// independent of the viewport selection (parts in the 3D scene); it only
// drives which materials the toolbar (delete/merge/preset) operates on.
const _matPanelSelected = new Set();
function _refreshPanelSelection() {
  const panel = document.getElementById('vp-materials-pop');
  if (!panel) return;
  for (const cell of panel.querySelectorAll('.mat-cell')) {
    cell.classList.toggle('selected', _matPanelSelected.has(cell._mat));
  }
  // Toolbar enable/disable based on selection size.
  const n = _matPanelSelected.size;
  const setEnabled = (id, on) => {
    const b = document.getElementById(id);
    if (b) b.disabled = !on;
  };
  // Duplicate works on exactly 1 (need a clear source). Delete on 1+, merge on 2+.
  setEnabled('mat-act-duplicate', n === 1);
  setEnabled('mat-act-merge',     n >= 2);
  setEnabled('mat-act-delete',    n >= 1);
  // Add is always available — a new material lands in the library
  // (state.userMaterials) and gets assigned only if parts are selected.
  setEnabled('mat-act-add',       true);
}

// Open the per-material editor as a _DraggablePopup. Every active editor
// reuses one popup id (one editor at a time) — opening a different material
// rebinds the sliders to the new material's values.
let _matEditorState = null;  // { popup, mat, info, scrubbers: [], _previewBall }

// Real 3D preview ball — same render path as _captureRecentThumb. Keeps a
// persistent tiny scene (sphere + lights) and renders it through the main
// renderer into a 256px target whenever the editor needs to refresh.
const _MatPreviewBall = (() => {
  // Reuses the existing _renderMaterialPreview() that powers every other
  // material thumbnail in the app — a procedural 2D-canvas fake-3D sphere.
  // Pure 2D drawing: always paints, no WebGL context required, no popup-
  // visibility/driver/display-state dependencies, no context-cap issues.
  function attach(material, target) {
    let disposed = false;
    function render() {
      if (disposed || !target) return;
      try {
        // Cache key is the Material reference; clear so each draw is fresh.
        if (typeof _matPreviewCache !== 'undefined') _matPreviewCache.delete(material);
        const url = (typeof _renderMaterialPreview === 'function') ? _renderMaterialPreview(material) : null;
        if (!url) return;
        // Accept either an <img> (set src) or a <canvas> (drawImage onto it).
        if (target.tagName === 'IMG') {
          target.src = url;
        } else if (target.tagName === 'CANVAS') {
          const ctx = target.getContext('2d');
          if (!ctx) return;
          const img = new Image();
          img.onload = () => {
            ctx.clearRect(0, 0, target.width, target.height);
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, target.width, target.height);
          };
          img.src = url;
        }
      } catch (e) {
        console.warn('[mat-preview] render failed:', e);
      }
    }
    function dispose() { disposed = true; }
    return { render, dispose };
  }
  return { attach };
})();

function _openMaterialEditor(info) {
  const id = '_mat-editor-popup';
  const mat = info.mat;

  // Inject editor stylesheet once. Restyles the popup chrome to match the
  // viewport materials panel (#vp-materials-pop) so the editor and the
  // grid feel like one surface — flat var(--bg1) background, 10 px radius,
  // same hairline border + drop shadow, same section padding (10×12) and
  // pop-section-head label vocabulary (uppercase tx3, .04em tracking).
  if (!document.getElementById('_mat-edit-style')) {
    const s = document.createElement('style');
    s.id = '_mat-edit-style';
    s.textContent = `
      /* Override the generic _DraggablePopup chrome ONLY for the material
         editor instance. Selector keys off the popup's id wrapper so other
         draggable popups keep their default look.

         height:auto + max-height makes the card wrap its sections instead
         of locking to the create-time height = 860 baseline. With Base +
         Emission + Surface visible the card sizes to that content; when
         clearcoat / sheen / specular sections expand, the body's
         overflow-y:auto (set by bodyScroll: true) kicks in once the card
         hits the calc(100vh - 24px) viewport cap. Trade-off: vertical
         drag-resize on the corner handles is suppressed for this popup;
         users normally don't resize a properties panel anyway. */
      #_mat-editor-popup .dlg-pop{background:var(--bg1);border:1px solid var(--bd);border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.5);height:auto !important;max-height:calc(100vh - 24px)}
      #_mat-editor-popup .dlg-pop:has(.dlg-resize.nw:hover),
      #_mat-editor-popup .dlg-pop:has(.dlg-resize.ne:hover),
      #_mat-editor-popup .dlg-pop:has(.dlg-resize.sw:hover),
      #_mat-editor-popup .dlg-pop:has(.dlg-resize.se:hover){background:var(--bg1)}
      #_mat-editor-popup .dlg-head{padding:10px 12px;border-bottom:1px solid var(--bd)}
      #_mat-editor-popup .dlg-head::after{display:none}
      #_mat-editor-popup .dlg-title{font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--tx3)}
      #_mat-editor-popup .dlg-sub{font-size:10.5px;color:var(--tx3);font-weight:500;text-transform:none;letter-spacing:0;margin-top:1px}
      #_mat-editor-popup .dlg-head-icon{width:22px;height:22px;border-radius:6px;background:rgba(110,168,255,.10);box-shadow:inset 0 0 0 1px rgba(110,168,255,.20)}
      #_mat-editor-popup .dlg-head-icon svg{width:12px;height:12px}
      #_mat-editor-popup .dlg-body[data-scroll="auto"]{padding:0}
      #_mat-editor-popup .dlg-foot{padding:8px 10px;background:rgba(0,0,0,.18);border-top:1px solid rgba(255,255,255,.06);box-shadow:none}

      .mat-edit-body{display:flex;flex-direction:column;gap:0;padding:0}
      /* Hero preview row uses the same dark gradient as the materials grid
         tile hover — subtle, just enough to lift the shaderball off the
         flat panel surface without breaking the panel's read. */
      .mat-edit-preview-wrap{position:relative;background:rgba(255,255,255,.02);padding:10px 12px;border-bottom:1px solid var(--bd);display:flex;align-items:center;gap:12px}
      .mat-edit-preview-canvas{flex:0 0 92px;width:92px;height:92px;border-radius:8px;background:#0c0f15;box-shadow:0 2px 10px rgba(0,0,0,.45),inset 0 0 0 1px rgba(255,255,255,.04);object-fit:cover;display:block}
      .mat-edit-preview-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
      .mat-edit-preview-name{font-size:13px;font-weight:600;color:var(--tx);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .mat-edit-preview-type{font-size:10px;color:var(--tx3);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.04em;text-transform:uppercase}
      .mat-edit-preview-uses{font-size:10.5px;color:var(--tx2)}

      /* Sections: padding + uppercase title style mirror the materials
         panel's pop-section / pop-section-head conventions. */
      .mat-edit-section{padding:10px 12px;border-bottom:1px solid var(--s2)}
      .mat-edit-section:last-child{border-bottom:none}
      .mat-edit-section-h{display:flex;align-items:center;justify-content:space-between;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--tx3);cursor:pointer;user-select:none;margin-bottom:8px}
      .mat-edit-section-h:hover{color:var(--tx2)}
      .mat-edit-section-h .chev{font-size:10px;color:var(--tx3);transition:transform .15s var(--ease-out)}
      .mat-edit-section.collapsed .chev{transform:rotate(-90deg)}
      .mat-edit-section.collapsed .mat-edit-section-b{display:none}
      .mat-edit-section-b{display:flex;flex-direction:column;gap:5px}

      .mat-color-row{display:flex;align-items:center;gap:8px;padding:3px 0}
      .mat-color-row label{flex:0 0 80px;font-size:11px;color:var(--tx2)}
      .mat-color-row input[type="color"]{width:28px;height:22px;padding:0;border:1px solid var(--bd);border-radius:5px;background:transparent;cursor:pointer}
      .mat-color-hex{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px;color:var(--tx3);flex:1}
      .mat-edit-toggle-row{display:flex;flex-wrap:wrap;gap:4px;padding:3px 0}
      .mat-edit-toggle{display:inline-flex;align-items:center;gap:5px;padding:4px 9px;background:var(--bg2);border:1px solid var(--bd);border-radius:6px;font-size:11px;color:var(--tx2);cursor:pointer;user-select:none;transition:background 120ms var(--ease-out),border-color 120ms var(--ease-out),color 120ms var(--ease-out)}
      .mat-edit-toggle:hover{background:var(--bg3);border-color:var(--bd2);color:var(--tx)}
      .mat-edit-toggle input{accent-color:var(--ac);cursor:pointer;margin:0}
      .mat-edit-select-row{display:flex;align-items:center;gap:8px;padding:3px 0}
      .mat-edit-select-row label{flex:0 0 80px;font-size:11px;color:var(--tx2)}
      .mat-edit-select-row select{flex:1;font-size:11.5px;padding:5px 8px}

      /* Texture slots: a thumb (or empty placeholder) + label + filename
         + load/clear buttons. Compact rows, minimal chrome — matches the
         color-row look. */
      .mat-tex-row{display:flex;align-items:center;gap:8px;padding:3px 0}
      .mat-tex-thumb{flex:0 0 28px;width:28px;height:28px;border-radius:5px;background:#0c0f15;border:1px solid var(--bd);display:grid;place-items:center;overflow:hidden;color:var(--tx3)}
      .mat-tex-thumb img{width:100%;height:100%;object-fit:cover;display:block}
      .mat-tex-thumb svg{width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:1.6;opacity:.45}
      .mat-tex-thumb.has-tex{border-color:var(--ac-line)}
      .mat-tex-meta{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
      .mat-tex-label{font-size:11px;color:var(--tx2);line-height:1.1}
      .mat-tex-name{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;color:var(--tx3);line-height:1.1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .mat-tex-name.empty::before{content:'— no texture —';color:var(--tx3);opacity:.55}
      .mat-tex-btn{flex:0 0 auto;background:var(--bg2);border:1px solid var(--bd);border-radius:5px;padding:4px 6px;color:var(--tx2);cursor:pointer;display:grid;place-items:center;transition:background 120ms var(--ease-out),border-color 120ms var(--ease-out),color 120ms var(--ease-out)}
      .mat-tex-btn:hover{background:var(--bg3);border-color:var(--bd2);color:var(--tx)}
      .mat-tex-btn:disabled{opacity:.35;cursor:default;pointer-events:none}
      .mat-tex-btn svg{width:12px;height:12px;stroke:currentColor;fill:none;stroke-width:2}

      /* C4D / Redshift-style row layout. Each property is a single row:
         [diamond glyph] [label] [tex-attach circle] [value control].
         The tex-attach circle (data-tex-prop) is a clickable indicator;
         empty = outline-only, has-tex = filled with the accent. Click
         opens a small popover for load/clear. */
      .mat-row{display:grid;grid-template-columns:14px 1fr 12px minmax(0,1.5fr);align-items:center;gap:8px;padding:4px 0;font-size:11.5px;line-height:1.2}
      .mat-row + .mat-row{border-top:1px dashed var(--s2)}
      .mat-row-diamond{width:10px;height:10px;display:grid;place-items:center;color:var(--tx3);opacity:.55}
      .mat-row-diamond svg{width:9px;height:9px;stroke:currentColor;fill:none;stroke-width:1.6}
      .mat-row-label{color:var(--tx2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .mat-row-tex{width:12px;height:12px;border-radius:50%;border:1.5px solid var(--tx3);background:transparent;cursor:pointer;padding:0;display:grid;place-items:center;transition:background 120ms,border-color 120ms,color 120ms;color:var(--tx3)}
      .mat-row-tex:hover{border-color:var(--ac);color:var(--ac)}
      .mat-row-tex.has-tex{background:var(--ac);border-color:var(--ac)}
      .mat-row-tex.has-tex::after{content:'';width:4px;height:4px;border-radius:50%;background:#fff}
      .mat-row-val{display:flex;align-items:center;gap:6px;min-width:0}
      .mat-row-val > *:first-child{flex:1;min-width:0}
      .mat-row-val .field{margin:0}

      /* Eyedropper button — sits flush with the colour picker.  */
      .mat-eyedrop{flex:0 0 22px;width:22px;height:22px;background:var(--bg2);border:1px solid var(--bd);border-radius:5px;color:var(--tx2);cursor:pointer;display:grid;place-items:center;padding:0;transition:background 120ms,border-color 120ms,color 120ms}
      .mat-eyedrop:hover{background:var(--bg3);border-color:var(--bd2);color:var(--tx)}
      .mat-eyedrop:disabled{opacity:.35;cursor:default;pointer-events:none}
      .mat-eyedrop svg{width:12px;height:12px;stroke:currentColor;fill:none;stroke-width:1.8}

      /* Floating texture-attach popover anchored to the .mat-row-tex.  */
      .mat-tex-pop{position:fixed;z-index:9999;background:var(--bg1);border:1px solid var(--bd);border-radius:8px;box-shadow:0 12px 32px rgba(0,0,0,.5);padding:10px;width:240px;display:none}
      .mat-tex-pop.show{display:block}
      .mat-tex-pop-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}
      .mat-tex-pop-thumb{flex:0 0 40px;width:40px;height:40px;border-radius:6px;background:#0c0f15;border:1px solid var(--bd);overflow:hidden;display:grid;place-items:center}
      .mat-tex-pop-thumb img{width:100%;height:100%;object-fit:cover;display:block}
      .mat-tex-pop-thumb svg{width:18px;height:18px;stroke:var(--tx3);fill:none;stroke-width:1.6;opacity:.45}
      .mat-tex-pop-meta{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
      .mat-tex-pop-prop{font-size:11px;font-weight:600;color:var(--tx);text-transform:uppercase;letter-spacing:.04em}
      .mat-tex-pop-name{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;color:var(--tx3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .mat-tex-pop-row{display:flex;gap:6px}
      .mat-tex-pop-btn{flex:1;background:var(--bg2);border:1px solid var(--bd);border-radius:5px;padding:6px 8px;color:var(--tx);font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px;transition:background 120ms,border-color 120ms,color 120ms}
      .mat-tex-pop-btn:hover{background:var(--bg3);border-color:var(--bd2)}
      .mat-tex-pop-btn:disabled{opacity:.35;cursor:default;pointer-events:none}
      .mat-tex-pop-btn.danger{color:var(--er)}
      .mat-tex-pop-btn.danger:hover{background:rgba(255,107,107,.10);border-color:rgba(255,107,107,.25)}
      .mat-tex-pop-btn svg{width:11px;height:11px;stroke:currentColor;fill:none;stroke-width:2}
    `;
    document.head.appendChild(s);
  }

  const isPhysical = !!mat.isMeshPhysicalMaterial || mat.type === 'MeshPhysicalMaterial';
  const hasPBR = typeof mat.metalness === 'number';
  const hasEmissive = !!mat.emissive;
  const hasEnv = typeof mat.envMapIntensity === 'number';

  const colorRow = (cid, label, hex) => `
    <div class="mat-color-row">
      <label>${label}</label>
      <input type="color" id="${cid}" value="${hex || '#000000'}">
      <span class="mat-color-hex" id="${cid}-hex">${hex || '#000000'}</span>
    </div>`;
  const slider = (sid) => `<div class="field"><div id="${sid}"></div></div>`;
  const section = (key, title, inner, collapsed = false) => `
    <div class="mat-edit-section${collapsed ? ' collapsed' : ''}" data-section="${key}">
      <div class="mat-edit-section-h"><span>${title}</span><span class="chev">▾</span></div>
      <div class="mat-edit-section-b">${inner}</div>
    </div>`;

  // Texture-slot descriptors. Each entry → one mat-tex-row in the Textures
  // section. `cs` controls colorSpace assignment on load (sRGB for visible-
  // colour maps, linear for data maps like normal/roughness/AO). `phys`-only
  // slots are skipped unless the material is MeshPhysicalMaterial.
  const _texSlots = [
    { prop: 'map',                       label: 'Color',                  cs: 'srgb' },
    { prop: 'normalMap',                 label: 'Normal',                 cs: 'linear' },
    { prop: 'roughnessMap',              label: 'Roughness',              cs: 'linear' },
    { prop: 'metalnessMap',              label: 'Metalness',              cs: 'linear' },
    { prop: 'aoMap',                     label: 'AO',                     cs: 'linear' },
    { prop: 'emissiveMap',               label: 'Emissive',               cs: 'srgb',   need: () => hasEmissive },
    { prop: 'alphaMap',                  label: 'Alpha',                  cs: 'linear' },
    { prop: 'bumpMap',                   label: 'Bump',                   cs: 'linear' },
    { prop: 'displacementMap',           label: 'Displacement',           cs: 'linear' },
    { prop: 'lightMap',                  label: 'Light',                  cs: 'linear' },
    { prop: 'clearcoatMap',              label: 'Clearcoat',              cs: 'linear', phys: true },
    { prop: 'clearcoatNormalMap',        label: 'Clearcoat normal',       cs: 'linear', phys: true },
    { prop: 'clearcoatRoughnessMap',     label: 'Clearcoat rough',        cs: 'linear', phys: true },
    { prop: 'transmissionMap',           label: 'Transmission',           cs: 'linear', phys: true },
    { prop: 'thicknessMap',              label: 'Thickness',              cs: 'linear', phys: true },
    { prop: 'sheenColorMap',             label: 'Sheen color',            cs: 'srgb',   phys: true },
    { prop: 'sheenRoughnessMap',         label: 'Sheen rough',            cs: 'linear', phys: true },
    { prop: 'specularIntensityMap',      label: 'Specular int.',          cs: 'linear', phys: true },
    { prop: 'specularColorMap',          label: 'Specular color',         cs: 'srgb',   phys: true },
    { prop: 'iridescenceMap',            label: 'Iridescence',            cs: 'linear', phys: true },
    { prop: 'iridescenceThicknessMap',   label: 'Irid. thickness',        cs: 'linear', phys: true },
    { prop: 'anisotropyMap',             label: 'Anisotropy',             cs: 'linear', phys: true },
  ].filter(s => (!s.phys || isPhysical) && (!s.need || s.need()));

  const texRow = (s) => {
    const tex = mat[s.prop];
    const hasTex = !!tex;
    const fn = (tex?.name || tex?.image?.src?.split('/').pop() || tex?.userData?.fileName || '').slice(0, 32);
    return `
      <div class="mat-tex-row" data-tex-prop="${s.prop}" data-tex-cs="${s.cs}">
        <div class="mat-tex-thumb${hasTex ? ' has-tex' : ''}" data-thumb>
          ${hasTex ? '' : '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>'}
        </div>
        <div class="mat-tex-meta">
          <div class="mat-tex-label">${s.label}</div>
          <div class="mat-tex-name${hasTex ? '' : ' empty'}" data-name>${escapeHtml(fn)}</div>
        </div>
        <button class="mat-tex-btn" data-load title="Load image">
          <svg viewBox="0 0 24 24"><path d="M3 7l3-4h12l3 4M3 7v12a2 2 0 002 2h14a2 2 0 002-2V7M3 7h18"/><circle cx="12" cy="14" r="3.5"/></svg>
        </button>
        <button class="mat-tex-btn" data-clear title="Clear" ${hasTex ? '' : 'disabled'}>
          <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>`;
  };

  const _texSlotByProp = Object.fromEntries(_texSlots.map(s => [s.prop, s]));

  // Row helpers — each property is a single C4D-style row:
  //   [diamond] [label] [tex-attach] [value]
  // texAttach is just a stateful indicator + click target; the actual file
  // picker lives in a shared floating popover wired below.
  const _diamondSvg = '<svg viewBox="0 0 12 12"><path d="M6 1 11 6 6 11 1 6Z"/></svg>';
  const texAttach = (propName) => {
    if (!propName || !_texSlotByProp[propName]) return '<span></span>';
    const has = !!mat[propName];
    return `<button class="mat-row-tex${has ? ' has-tex' : ''}" data-tex-prop="${propName}" title="Texture (click to load/clear)"></button>`;
  };
  const row = (label, valueHtml, texProp = null) => `
    <div class="mat-row">
      <span class="mat-row-diamond">${_diamondSvg}</span>
      <span class="mat-row-label">${escapeHtml(label)}</span>
      ${texAttach(texProp)}
      <div class="mat-row-val">${valueHtml}</div>
    </div>`;
  const colorVal = (cid, hex) => `
    <input type="color" id="${cid}" value="${hex || '#000000'}" style="width:28px;height:22px;padding:0;border:1px solid var(--bd);border-radius:5px;background:transparent;cursor:pointer">
    <span class="mat-color-hex" id="${cid}-hex" style="flex:1;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px;color:var(--tx3)">${hex || '#000000'}</span>
    <button class="mat-eyedrop" data-eyedrop="${cid}" title="Pick colour from screen (Eyedropper)">
      <svg viewBox="0 0 24 24"><path d="M16 4l4 4-2 2-4-4 2-2zM14 6L4 16v4h4L18 10"/></svg>
    </button>`;
  const sliderVal = (sid) => `<div id="${sid}"></div>`;

  const baseSection = section('base', 'Base',
    row('Color',     colorVal('mat-edit-color', '#' + (mat.color?.getHexString?.() || 'cccccc')), 'map') +
    (hasPBR
      ? row('Metalness', sliderVal('mat-edit-metalness-scrub'), 'metalnessMap') +
        row('Roughness', sliderVal('mat-edit-roughness-scrub'), 'roughnessMap')
      : '')
  );

  const surfaceDetailSection = section('detail', 'Surface detail',
    row('Normal',            sliderVal('mat-edit-normalScale-scrub'), 'normalMap') +
    row('Bump',              sliderVal('mat-edit-bumpScale-scrub'),   'bumpMap') +
    row('Displacement',      sliderVal('mat-edit-displScale-scrub'),  'displacementMap') +
    row('Displacement bias', sliderVal('mat-edit-displBias-scrub')) +
    row('AO',                sliderVal('mat-edit-aoMapInt-scrub'),    'aoMap')
  , true);

  const emissiveSection = hasEmissive ? section('emissive', 'Emission',
    row('Color',     colorVal('mat-edit-emissive-color', '#' + (mat.emissive?.getHexString?.() || '000000')), 'emissiveMap') +
    row('Intensity', sliderVal('mat-edit-emissive-scrub'))
  ) : '';

  const surfaceSection = section('surface', 'Surface',
    row('Opacity',     sliderVal('mat-edit-opacity-scrub'),     'alphaMap') +
    row('Alpha test',  sliderVal('mat-edit-alphatest-scrub')) +
    row('Light map',   sliderVal('mat-edit-lightMapInt-scrub'), 'lightMap') +
    `<div class="mat-edit-select-row">
       <label>Side</label>
       <select id="mat-edit-side" class="mac-sel">
         <option value="0">Front</option>
         <option value="1">Back</option>
         <option value="2">Double</option>
       </select>
     </div>` +
    `<div class="mat-edit-toggle-row">
       <label class="mat-edit-toggle"><input type="checkbox" id="mat-edit-transparent">Transparent</label>
       <label class="mat-edit-toggle"><input type="checkbox" id="mat-edit-flat">Flat shading</label>
       <label class="mat-edit-toggle"><input type="checkbox" id="mat-edit-wireframe">Wireframe</label>
       <label class="mat-edit-toggle"><input type="checkbox" id="mat-edit-vertexcolors">Vertex colors</label>
     </div>`
  );

  const envSection = hasEnv ? section('env', 'Environment',
    row('Env intensity', sliderVal('mat-edit-env-scrub'))
  ) : '';

  const _mapOnly = '<span style="color:var(--tx3);font-size:11px;font-style:italic;opacity:.7">map only</span>';
  const physicalSection = isPhysical ? section('physical', 'Clearcoat / IOR / Transmission',
    row('Clearcoat',           sliderVal('mat-edit-clearcoat-scrub'),           'clearcoatMap') +
    row('Clearcoat roughness', sliderVal('mat-edit-clearcoatRough-scrub'),      'clearcoatRoughnessMap') +
    row('Clearcoat normal',    _mapOnly,                                        'clearcoatNormalMap') +
    row('IOR',                 sliderVal('mat-edit-ior-scrub')) +
    row('Reflectivity',        sliderVal('mat-edit-reflect-scrub')) +
    row('Transmission',        sliderVal('mat-edit-transmission-scrub'),        'transmissionMap') +
    row('Thickness',           sliderVal('mat-edit-thickness-scrub'),           'thicknessMap') +
    row('Dispersion',          sliderVal('mat-edit-dispersion-scrub')) +
    row('Attenuation',         colorVal('mat-edit-attenuation-color', '#' + (mat.attenuationColor?.getHexString?.() || 'ffffff'))) +
    row('Atten. distance',     sliderVal('mat-edit-attenuationDistance-scrub'))
  , true) : '';

  const sheenSection = isPhysical ? section('sheen', 'Sheen / Iridescence / Anisotropy',
    row('Sheen',           sliderVal('mat-edit-sheen-scrub'),       'sheenColorMap') +
    row('Sheen roughness', sliderVal('mat-edit-sheenRough-scrub'),  'sheenRoughnessMap') +
    row('Sheen color',     colorVal('mat-edit-sheen-color', '#' + (mat.sheenColor?.getHexString?.() || 'ffffff'))) +
    row('Iridescence',     sliderVal('mat-edit-iridescence-scrub'), 'iridescenceMap') +
    row('Irid. thickness', _mapOnly,                                'iridescenceThicknessMap') +
    row('Iridescence IOR', sliderVal('mat-edit-iridIor-scrub')) +
    row('Anisotropy',      sliderVal('mat-edit-anisotropy-scrub'),  'anisotropyMap') +
    row('Anis. rotation',  sliderVal('mat-edit-anisoRot-scrub'))
  , true) : '';

  const specSection = isPhysical ? section('specular', 'Specular',
    row('Intensity', sliderVal('mat-edit-specInt-scrub'),                                                       'specularIntensityMap') +
    row('Tint',      colorVal('mat-edit-spec-color', '#' + (mat.specularColor?.getHexString?.() || 'ffffff')),  'specularColorMap')
  , true) : '';

  const matName = (mat.name && mat.name.trim()) || ('mat_' + (mat.color?.getHexString?.() || 'cccccc'));
  const bodyHtml = `
    <div class="mat-edit-body">
      <div class="mat-edit-preview-wrap">
        <img class="mat-edit-preview-canvas" id="mat-edit-preview" alt="" draggable="false">
        <div class="mat-edit-preview-info">
          <div class="mat-edit-preview-name" title="${escapeHtml(matName)}">${escapeHtml(matName)}</div>
          <div class="mat-edit-preview-type">${escapeHtml(mat.type || 'Material')}</div>
          <div class="mat-edit-preview-uses">${info.count} part${info.count === 1 ? '' : 's'} use this material</div>
        </div>
      </div>
      ${baseSection}
      ${surfaceDetailSection}
      ${emissiveSection}
      ${surfaceSection}
      ${envSection}
      ${physicalSection}
      ${sheenSection}
      ${specSection}
    </div>
  `;

  // Reuse existing popup if present (rebind to new material instead of
  // re-creating DOM and re-injecting styles).
  let popup;
  const existing = document.getElementById(id);
  if (existing && _matEditorState) {
    popup = _matEditorState.popup;
    popup.body.innerHTML = bodyHtml;
    if (_matEditorState._previewBall) {
      _matEditorState._previewBall.dispose();
      _matEditorState._previewBall = null;
    }
  } else {
    popup = _DraggablePopup.create({
      id,
      title: 'Material',
      subtitle: '—',
      iconName: 'palette',
      // Default tall enough to fit Base + Emission + Surface without scroll on
      // a typical 1080p screen; bodyScroll lets the rest (Environment / IOR /
      // Sheen / Specular for MeshPhysicalMaterial) reveal as the user scrolls.
      // _DraggablePopup clamps to calc(100vh-24px), so on shorter screens this
      // collapses gracefully and the scrollbar takes over.
      width: 380, height: 860,
      minWidth: 340, minHeight: 360,
      bodyHtml,
      bodyScroll: true,
      onClose: () => {
        if (_matEditorState?._previewBall) _matEditorState._previewBall.dispose();
        _matEditorState = null;
      },
    });
    _matEditorState = { popup, mat: null, info: null, scrubbers: [], _previewBall: null };
  }

  _matEditorState.mat = mat;
  _matEditorState.info = info;
  popup.setTitle(mat.name?.trim() || 'Material');
  popup.setSubtitle(`${info.count} part${info.count === 1 ? '' : 's'} · ${mat.type} · live preview`);

  // Wire collapsible sections.
  popup.body.querySelectorAll('.mat-edit-section-h').forEach(h => {
    h.addEventListener('click', () => h.parentElement.classList.toggle('collapsed'));
  });

  // 3D preview ball — main renderer renders a sphere with this material into
  // a small render target, pixels are blitted to the editor canvas. Updates
  // every time a control changes (rAF-throttled).
  const previewCanvas = document.getElementById('mat-edit-preview');
  _matEditorState._previewBall = _MatPreviewBall.attach(mat, previewCanvas);

  let _refreshTimer = null;
  const _refreshAll = () => {
    if (_refreshTimer) cancelAnimationFrame(_refreshTimer);
    _refreshTimer = requestAnimationFrame(() => {
      _refreshTimer = null;
      _matEditorState?._previewBall?.render();
      _matPreviewCache.delete(mat);
      const panel = document.getElementById('vp-materials-pop');
      if (panel?.classList.contains('show')) {
        for (const cell of panel.querySelectorAll('.mat-cell')) {
          if (cell._mat !== mat) continue;
          const img = cell.querySelector('img');
          const url = _renderMaterialPreview(mat);
          if (img && url) img.src = url;
          break;
        }
      }
    });
  };
  _matEditorState._previewBall.render();

  const _bindColor = (cid, target) => {
    const inp = document.getElementById(cid);
    const hex = document.getElementById(cid + '-hex');
    if (inp && target) {
      inp.addEventListener('input', () => {
        target.set(inp.value);
        if (hex) hex.textContent = inp.value;
        mat.needsUpdate = true;
        requestRender();
        _refreshAll();
      });
    }
  };
  _bindColor('mat-edit-color', mat.color);
  _bindColor('mat-edit-emissive-color', mat.emissive);
  if (isPhysical) {
    if (!mat.sheenColor)        mat.sheenColor = new THREE.Color(0xffffff);
    if (!mat.specularColor)     mat.specularColor = new THREE.Color(0xffffff);
    if (!mat.attenuationColor)  mat.attenuationColor = new THREE.Color(0xffffff);
    _bindColor('mat-edit-sheen-color', mat.sheenColor);
    _bindColor('mat-edit-spec-color', mat.specularColor);
    _bindColor('mat-edit-attenuation-color', mat.attenuationColor);
  }

  // Helper: bind a numeric property to a scrubber.
  const num = (mid, label, prop, opts = {}) => {
    if (!document.getElementById(mid)) return;
    const min = opts.min ?? 0, max = opts.max ?? 1, decimals = opts.decimals ?? 2, unit = opts.unit ?? '';
    const fallback = opts.fallback ?? 0;
    const STEPS = opts.steps ?? 100;
    const range = max - min;
    initScrubber({
      el: mid,
      label,
      maxSteps: STEPS,
      stepToVal: (s) => min + (s / STEPS) * range,
      valToStep: (v) => Math.round(((Math.max(min, Math.min(max, v ?? fallback))) - min) / range * STEPS),
      format: (v) => ({ value: v.toFixed(decimals), unit }),
      initialValue: typeof mat[prop] === 'number' ? mat[prop] : fallback,
      promptTitle: label,
      onChange: (v) => {
        mat[prop] = v;
        if (opts.after) opts.after(v);
        mat.needsUpdate = true;
        requestRender();
        _refreshAll();
      },
    });
  };

  // ── Base ──────────────────────────────
  if (hasPBR) {
    num('mat-edit-metalness-scrub', 'Metalness', 'metalness', { fallback: 0.15 });
    num('mat-edit-roughness-scrub', 'Roughness', 'roughness', { fallback: 0.55 });
  }
  // ── Emission ──────────────────────────
  if (hasEmissive) {
    num('mat-edit-emissive-scrub', 'Emissive intensity', 'emissiveIntensity',
      { min: 0, max: 4, fallback: 1, unit: '×' });
  }
  // ── Surface ───────────────────────────
  num('mat-edit-opacity-scrub', 'Opacity', 'opacity', {
    fallback: 1,
    after: (v) => { mat.transparent = v < 1; },
  });
  num('mat-edit-alphatest-scrub', 'Alpha test', 'alphaTest', { fallback: 0 });
  const sideSel = document.getElementById('mat-edit-side');
  if (sideSel) {
    sideSel.value = String(mat.side ?? 0);
    sideSel.addEventListener('change', () => {
      mat.side = parseInt(sideSel.value, 10);
      mat.needsUpdate = true;
      requestRender();
      _refreshAll();
    });
  }
  const _bindBool = (bid, prop) => {
    const cb = document.getElementById(bid);
    if (!cb) return;
    cb.checked = !!mat[prop];
    cb.addEventListener('change', () => {
      mat[prop] = cb.checked;
      mat.needsUpdate = true;
      requestRender();
      _refreshAll();
    });
  };
  _bindBool('mat-edit-transparent', 'transparent');
  _bindBool('mat-edit-flat', 'flatShading');
  _bindBool('mat-edit-wireframe', 'wireframe');
  _bindBool('mat-edit-vertexcolors', 'vertexColors');

  // ── Environment ───────────────────────
  if (hasEnv) {
    num('mat-edit-env-scrub', 'Env intensity', 'envMapIntensity',
      { min: 0, max: 3, fallback: 1, unit: '×' });
  }

  // ── Physical (MeshPhysicalMaterial) ──
  if (isPhysical) {
    num('mat-edit-clearcoat-scrub',           'Clearcoat',           'clearcoat',          { fallback: 0 });
    num('mat-edit-clearcoatRough-scrub',      'Clearcoat roughness', 'clearcoatRoughness', { fallback: 0 });
    num('mat-edit-ior-scrub',                 'IOR',                 'ior',                { min: 1.0, max: 2.333, fallback: 1.5, decimals: 3 });
    num('mat-edit-reflect-scrub',             'Reflectivity',        'reflectivity',       { fallback: 0.5 });
    num('mat-edit-transmission-scrub',        'Transmission',        'transmission',       { fallback: 0 });
    num('mat-edit-thickness-scrub',           'Thickness',           'thickness',          { min: 0, max: 50, fallback: 0 });
    num('mat-edit-attenuationDistance-scrub', 'Atten. distance',     'attenuationDistance',{ min: 0, max: 50, fallback: 0 });
    num('mat-edit-sheen-scrub',               'Sheen',               'sheen',              { fallback: 0 });
    num('mat-edit-sheenRough-scrub',          'Sheen roughness',     'sheenRoughness',     { fallback: 1 });
    num('mat-edit-iridescence-scrub',         'Iridescence',         'iridescence',        { fallback: 0 });
    num('mat-edit-iridIor-scrub',             'Iridescence IOR',     'iridescenceIOR',     { min: 1.0, max: 2.333, fallback: 1.3, decimals: 3 });
    num('mat-edit-specInt-scrub',             'Specular intensity',  'specularIntensity',  { fallback: 1 });
    // Newer PBR additions; absent on older three.js builds, so num() is a
    // no-op when the property doesn't exist on the material.
    num('mat-edit-anisotropy-scrub', 'Anisotropy',         'anisotropy',         { fallback: 0 });
    num('mat-edit-anisoRot-scrub',   'Anisotropy rotation','anisotropyRotation', { min: 0, max: Math.PI * 2, fallback: 0, decimals: 2, unit: 'rad' });
    num('mat-edit-dispersion-scrub', 'Dispersion',         'dispersion',         { min: 0, max: 5, fallback: 0 });
  }

  // ── Map intensity scalars (apply to whichever maps the user has loaded) ─
  // normalScale is a Vector2; we expose a single "uniform scale" knob and
  // mirror the value onto x AND y so the Vector2 stays a Vector2 (writing a
  // plain number would clobber it and break the shader).
  if (document.getElementById('mat-edit-normalScale-scrub') && mat.normalScale) {
    const STEPS = 100, MIN = -2, MAX = 2, RANGE = MAX - MIN;
    initScrubber({
      el: 'mat-edit-normalScale-scrub',
      label: 'Normal scale',
      maxSteps: STEPS,
      stepToVal: (s) => MIN + (s / STEPS) * RANGE,
      valToStep: (v) => Math.round((Math.max(MIN, Math.min(MAX, v ?? 1)) - MIN) / RANGE * STEPS),
      format: (v) => ({ value: v.toFixed(2), unit: '' }),
      initialValue: mat.normalScale.x ?? 1,
      promptTitle: 'Normal scale',
      onChange: (v) => {
        mat.normalScale.set(v, v);
        mat.needsUpdate = true;
        requestRender();
        _refreshAll();
      },
    });
  }
  num('mat-edit-aoMapInt-scrub',    'AO intensity',           'aoMapIntensity',     { min: 0, max: 3, fallback: 1 });
  num('mat-edit-lightMapInt-scrub', 'Light map intensity',    'lightMapIntensity',  { min: 0, max: 3, fallback: 1 });
  num('mat-edit-bumpScale-scrub',   'Bump scale',             'bumpScale',          { min: -1, max: 1, fallback: 1, decimals: 2 });
  num('mat-edit-displScale-scrub',  'Displacement scale',     'displacementScale',  { min: -1, max: 1, fallback: 1, decimals: 2 });
  num('mat-edit-displBias-scrub',   'Displacement bias',      'displacementBias',   { min: -1, max: 1, fallback: 0, decimals: 2 });

  // ── Texture attach popover (one shared instance) ──────────────────────
  // Click the small circle (.mat-row-tex) next to a property to open the
  // popover anchored to it. Shows thumb + filename + Load / Clear. One
  // shared instance to avoid spamming DOM nodes per row.
  function _texColorSpace(cs) {
    return cs === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  }
  function _loadTexture(file, cs) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const tex = new THREE.Texture(img);
        tex.colorSpace = _texColorSpace(cs);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.flipY = true;
        tex.needsUpdate = true;
        tex.name = file.name;
        tex.userData = tex.userData || {};
        tex.userData.fileName = file.name;
        tex.userData.dataUrl = url;
        resolve(tex);
      };
      img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }
  function _texThumbUrl(tex) {
    return tex?.image?.src
        || (tex?.image instanceof HTMLCanvasElement ? tex.image.toDataURL('image/png') : null)
        || tex?.userData?.dataUrl
        || '';
  }
  function _refreshAttach(propName) {
    const ind = popup.body.querySelector(`.mat-row-tex[data-tex-prop="${propName}"]`);
    if (ind) ind.classList.toggle('has-tex', !!mat[propName]);
  }
  let _texPop = document.getElementById('_mat-tex-pop');
  if (!_texPop) {
    _texPop = document.createElement('div');
    _texPop.id = '_mat-tex-pop';
    _texPop.className = 'mat-tex-pop';
    document.body.appendChild(_texPop);
    document.addEventListener('click', (e) => {
      if (!_texPop.classList.contains('show')) return;
      if (_texPop.contains(e.target)) return;
      if (e.target.closest?.('.mat-row-tex')) return;
      _texPop.classList.remove('show');
    });
  }
  function _openTexPop(anchor, propName, cs) {
    const slot = _texSlotByProp[propName];
    const tex = mat[propName];
    const thumbUrl = _texThumbUrl(tex);
    _texPop.innerHTML = `
      <div class="mat-tex-pop-head">
        <div class="mat-tex-pop-thumb">
          ${thumbUrl
            ? `<img src="${thumbUrl}" alt="">`
            : '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>'}
        </div>
        <div class="mat-tex-pop-meta">
          <div class="mat-tex-pop-prop">${escapeHtml(slot?.label || propName)}</div>
          <div class="mat-tex-pop-name" title="${escapeHtml(tex?.name || tex?.userData?.fileName || '')}">${escapeHtml(tex?.name || tex?.userData?.fileName || '— no texture —')}</div>
        </div>
      </div>
      <div class="mat-tex-pop-row">
        <button class="mat-tex-pop-btn" data-pop-load>
          <svg viewBox="0 0 24 24"><path d="M3 7l3-4h12l3 4M3 7v12a2 2 0 002 2h14a2 2 0 002-2V7M3 7h18"/><circle cx="12" cy="14" r="3.5"/></svg>
          Load…
        </button>
        <button class="mat-tex-pop-btn danger" data-pop-clear ${tex ? '' : 'disabled'}>
          <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
          Clear
        </button>
      </div>`;
    _texPop.style.left = '0px'; _texPop.style.top = '0px';
    _texPop.classList.add('show');
    const r = anchor.getBoundingClientRect();
    const pw = _texPop.offsetWidth, ph = _texPop.offsetHeight;
    let x = r.right + 6, y = r.top - 4;
    if (x + pw > window.innerWidth - 8)  x = Math.max(8, r.left - pw - 6);
    if (y + ph > window.innerHeight - 8) y = Math.max(8, window.innerHeight - ph - 8);
    _texPop.style.left = x + 'px';
    _texPop.style.top  = y + 'px';

    _texPop.querySelector('[data-pop-load]')?.addEventListener('click', () => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'image/png,image/jpeg,image/webp,image/avif,image/*';
      inp.style.display = 'none';
      inp.addEventListener('change', async () => {
        const f = inp.files?.[0];
        if (!f) return;
        try {
          const newTex = await _loadTexture(f, cs);
          try { mat[propName]?.dispose?.(); } catch (_) {}
          mat[propName] = newTex;
          mat.needsUpdate = true;
          _refreshAttach(propName);
          _texPop.classList.remove('show');
          requestRender();
          _refreshAll();
        } catch (e) {
          console.warn('[mat-tex] load failed:', e);
          toast?.('Texture load failed', f.name, 'error', 4000);
        }
      });
      document.body.appendChild(inp); inp.click();
      setTimeout(() => inp.remove(), 0);
    });
    _texPop.querySelector('[data-pop-clear]')?.addEventListener('click', () => {
      try { mat[propName]?.dispose?.(); } catch (_) {}
      mat[propName] = null;
      mat.needsUpdate = true;
      _refreshAttach(propName);
      _texPop.classList.remove('show');
      requestRender();
      _refreshAll();
    });
  }
  popup.body.querySelectorAll('.mat-row-tex').forEach(btn => {
    const propName = btn.dataset.texProp;
    if (!propName) return;
    const cs = _texSlotByProp[propName]?.cs || 'linear';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (_texPop.classList.contains('show') && _texPop._anchorProp === propName) {
        _texPop.classList.remove('show');
        return;
      }
      _texPop._anchorProp = propName;
      _openTexPop(btn, propName, cs);
    });
  });

  // ── Eyedropper buttons (next to colour pickers) ───────────────────────
  // Uses the native EyeDropper API (Chromium since v95). On Firefox/Safari
  // the button is disabled with an explanatory tooltip.
  const _eyedropAvailable = (typeof window.EyeDropper === 'function');
  popup.body.querySelectorAll('.mat-eyedrop').forEach(btn => {
    const cid = btn.dataset.eyedrop;
    if (!cid) return;
    if (!_eyedropAvailable) {
      btn.disabled = true;
      btn.title = 'Eyedropper API not supported in this browser';
      return;
    }
    btn.addEventListener('click', async () => {
      try {
        const result = await new window.EyeDropper().open();
        const hex = result?.sRGBHex;
        if (!hex) return;
        const inp = document.getElementById(cid);
        if (!inp) return;
        inp.value = hex;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
      } catch (_) { /* user cancelled */ }
    });
  });

  // Show first so the card has real dimensions, then anchor it to the LEFT
  // of the materials panel. Reading offsetWidth/Height before show() returns
  // 0 because the .dlg-popup parent is display:none — that's why the earlier
  // pre-show positioning collapsed every editor to the top-left corner.
  popup.show();
  const panel = document.getElementById('vp-materials-pop');
  if (panel) {
    const pr = panel.getBoundingClientRect();
    const cardW = popup.card.offsetWidth;
    const cardH = popup.card.offsetHeight;
    const gap = 10;
    let left = pr.left - cardW - gap;
    let top  = pr.top;
    // Fall back to the right side if the editor would clip off-screen
    // on the left (narrow viewport / very wide editor card).
    if (left < 8) left = pr.right + gap;
    // Clamp vertically so the bottom never goes off-screen.
    top = Math.max(8, Math.min(top, window.innerHeight - cardH - 8));
    popup.card.style.left = left + 'px';
    popup.card.style.top  = top  + 'px';
  }
}

// =====================================================================
// Materials toolbar — actions on panel-selected materials.
// =====================================================================

// Reassign every part whose live material === src to use dst instead.
// Handles instanced parts where p.mesh is the InstancedMesh (shared
// material reference covers all instances of that mesh).
function _reassignMaterial(src, dst) {
  if (!src || !dst || src === dst) return 0;
  const seen = new Set();
  let n = 0;
  for (const p of state.parts || []) {
    if (p.deleted) continue;
    const mesh = p.mesh;
    if (!mesh || seen.has(mesh)) continue;
    seen.add(mesh);
    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map(m => m === src ? dst : m);
    } else if (mesh.material === src) {
      mesh.material = dst;
      n++;
    }
  }
  // Drop the dead material from the colour-share cache so new parts don't
  // get handed the now-orphaned material later.
  if (state.materialByColor) {
    for (const [k, v] of state.materialByColor) {
      if (v === src) state.materialByColor.delete(k);
    }
  }
  requestRender();
  return n;
}

function _newMaterial(opts = {}) {
  const m = new THREE.MeshStandardMaterial({
    color: opts.color ?? new THREE.Color(0x7a7f88),
    metalness: opts.metalness ?? 0.15,
    roughness: opts.roughness ?? 0.55,
    side: THREE.DoubleSide,
  });
  if (opts.emissive) m.emissive = opts.emissive;
  if (typeof opts.emissiveIntensity === 'number') m.emissiveIntensity = opts.emissiveIntensity;
  if (typeof opts.opacity === 'number') {
    m.opacity = opts.opacity;
    m.transparent = opts.opacity < 1;
  }
  if (opts.name) m.name = opts.name;
  return m;
}

// Industry-standard PBR presets — tuned to read at thumb scale. Same
// vibe as Substance / V-Ray base material libraries.
const _MAT_PRESETS = [
  { section: 'Dielectrics' },
  { name: 'Plastic — Matte',   color: 0xcfd1d4, metalness: 0,    roughness: 0.85 },
  { name: 'Plastic — Glossy',  color: 0x2a3340, metalness: 0,    roughness: 0.25 },
  { name: 'Rubber',            color: 0x222428, metalness: 0,    roughness: 0.95 },
  { name: 'Ceramic',           color: 0xefefe8, metalness: 0,    roughness: 0.18 },
  { name: 'Wood (rough)',      color: 0x6b4a2e, metalness: 0,    roughness: 0.78 },
  { name: 'Concrete',          color: 0x999a92, metalness: 0,    roughness: 0.92 },
  { name: 'Carbon Fiber',      color: 0x14171d, metalness: 0.20, roughness: 0.30 },
  { name: 'Glass',             color: 0xeaf3ff, metalness: 0,    roughness: 0.05, opacity: 0.30 },
  { name: 'Frosted Glass',     color: 0xeaf3ff, metalness: 0,    roughness: 0.55, opacity: 0.55 },
  { section: 'Metals' },
  { name: 'Aluminum',          color: 0xd9dade, metalness: 1.0,  roughness: 0.32 },
  { name: 'Brushed Steel',     color: 0xc0c5cc, metalness: 1.0,  roughness: 0.45 },
  { name: 'Polished Steel',    color: 0xd6dade, metalness: 1.0,  roughness: 0.10 },
  { name: 'Mirror Chrome',     color: 0xfafbfd, metalness: 1.0,  roughness: 0.02 },
  { name: 'Gold — Polished',   color: 0xf6c84a, metalness: 1.0,  roughness: 0.18 },
  { name: 'Brass',             color: 0xc6a04a, metalness: 1.0,  roughness: 0.32 },
  { name: 'Copper',            color: 0xc05a3a, metalness: 1.0,  roughness: 0.28 },
  { name: 'Bronze',            color: 0x8a5a32, metalness: 1.0,  roughness: 0.44 },
  { name: 'Iron — Cast',       color: 0x4d4f55, metalness: 1.0,  roughness: 0.62 },
  { section: 'Emissive' },
  { name: 'LED White',         color: 0xffffff, metalness: 0,    roughness: 0.5,  emissive: 0xffffff, emissiveIntensity: 1.4 },
  { name: 'LED Red',           color: 0xff3333, metalness: 0,    roughness: 0.5,  emissive: 0xff3333, emissiveIntensity: 1.4 },
  { name: 'Neon Cyan',         color: 0x33eaff, metalness: 0,    roughness: 0.5,  emissive: 0x33eaff, emissiveIntensity: 1.6 },
  { name: 'Hazard Stripe',     color: 0xfbbf24, metalness: 0,    roughness: 0.55, emissive: 0xfbbf24, emissiveIntensity: 0.5 },
];

function _applyPresetTo(mat, preset) {
  if (!mat || !preset || preset.section) return;
  if (mat.color   && preset.color   != null) mat.color.setHex(preset.color);
  if (mat.emissive) mat.emissive.setHex(preset.emissive ?? 0x000000);
  if (typeof preset.emissiveIntensity === 'number') mat.emissiveIntensity = preset.emissiveIntensity;
  else mat.emissiveIntensity = 1;
  if (typeof preset.metalness === 'number') mat.metalness = preset.metalness;
  if (typeof preset.roughness === 'number') mat.roughness = preset.roughness;
  if (typeof preset.opacity === 'number') {
    mat.opacity = preset.opacity;
    mat.transparent = preset.opacity < 1;
  } else {
    mat.opacity = 1;
    mat.transparent = false;
  }
  if (preset.name) mat.name = preset.name;
  mat.needsUpdate = true;
  _matPreviewCache.delete(mat);
}

function _renderPresetMenu() {
  const menu = document.getElementById('mat-presets-menu');
  if (!menu) return;
  menu.innerHTML = '';
  for (const p of _MAT_PRESETS) {
    if (p.section) {
      const h = document.createElement('div');
      h.className = 'mat-preset-section';
      h.textContent = p.section;
      menu.appendChild(h);
      continue;
    }
    const row = document.createElement('div');
    row.className = 'mat-preset';
    const swatchHex = '#' + p.color.toString(16).padStart(6, '0');
    row.innerHTML = `
      <span class="mat-preset-swatch" style="background:${swatchHex}"></span>
      <span class="mat-preset-name">${escapeHtml(p.name)}</span>
      <span class="mat-preset-hint">${p.metalness >= 0.5 ? 'metal' : (p.emissive ? 'emit' : 'dielectric')}</span>
    `;
    row.addEventListener('click', () => {
      const targets = _matPanelSelected.size > 0
        ? [..._matPanelSelected]
        : (_matEditorState?.mat ? [_matEditorState.mat] : []);
      if (!targets.length) {
        toast?.('Select a material first', 'Click a material card, then choose a preset', 'info');
        return;
      }
      for (const m of targets) _applyPresetTo(m, p);
      requestRender();
      _populateMaterialsList();
      menu.classList.remove('show');
      toast?.(`Applied ${p.name}`, `${targets.length} material${targets.length === 1 ? '' : 's'}`, 'success');
    });
    menu.appendChild(row);
  }
}

let _matActionsWired = false;
function _wireMaterialActions() {
  if (_matActionsWired) return;
  const addBtn = document.getElementById('mat-act-add');
  const dupBtn = document.getElementById('mat-act-duplicate');
  const mrgBtn = document.getElementById('mat-act-merge');
  const delBtn = document.getElementById('mat-act-delete');
  const preBtn = document.getElementById('mat-act-presets');
  const menu   = document.getElementById('mat-presets-menu');
  if (!addBtn || !dupBtn || !mrgBtn || !delBtn || !preBtn || !menu) return;
  _matActionsWired = true;

  addBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const fresh = _newMaterial({ name: 'mat_' + Math.random().toString(16).slice(2, 8) });
    // Track every user-created material in the scene-level library so it
    // shows up in the grid even with no parts assigned. Once assigned, it
    // also appears via the parts-walk in _collectLiveMaterials — Map dedup
    // keeps it as a single entry.
    state.userMaterials = state.userMaterials || new Set();
    state.userMaterials.add(fresh);
    // If parts are selected, assign immediately so the user can iterate.
    // No selection → new material lands in the library only.
    let assigned = 0;
    if (state.selected?.size) {
      const seen = new Set();
      for (const id of state.selected) {
        const p = getPart(id);
        if (!p || p.deleted || !p.mesh || seen.has(p.mesh)) continue;
        seen.add(p.mesh);
        p.mesh.material = fresh;
        assigned++;
      }
    }
    _matPanelSelected.clear();
    _matPanelSelected.add(fresh);
    requestRender();
    _populateMaterialsList();
    if (assigned === 0) {
      toast?.('Material added', 'Select parts and use Duplicate to assign', 'info', 2200);
    }
  });

  dupBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (_matPanelSelected.size !== 1) return;
    const src = [..._matPanelSelected][0];
    if (!state.selected?.size) {
      toast?.('Select parts first', 'Pick parts to receive the duplicated material', 'info');
      return;
    }
    const clone = src.clone();
    clone.name = (src.name || 'material') + ' copy';
    const seen = new Set();
    for (const id of state.selected) {
      const p = getPart(id);
      if (!p || p.deleted || !p.mesh || seen.has(p.mesh)) continue;
      seen.add(p.mesh);
      p.mesh.material = clone;
    }
    _matPanelSelected.clear();
    _matPanelSelected.add(clone);
    requestRender();
    _populateMaterialsList();
  });

  mrgBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (_matPanelSelected.size < 2) return;
    const arr = [..._matPanelSelected];
    const target = arr[0];
    let migrated = 0;
    for (let i = 1; i < arr.length; i++) migrated += _reassignMaterial(arr[i], target);
    _matPanelSelected.clear();
    _matPanelSelected.add(target);
    _populateMaterialsList();
    toast?.('Merged materials', `${arr.length} → 1 (${migrated} parts moved)`, 'success');
  });

  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (_matPanelSelected.size === 0) return;
    // Delete = unassign. Every part using a removed material switches to a
    // shared neutral-grey default — no source color, no original-load tint,
    // just plain shading. Built once via getOrCreateMaterial so all
    // unassigned parts share one Material reference (same draw-call dedupe
    // benefit as the existing color-shared library).
    const _DEFAULT_GREY = new THREE.Color(0x9aa0a6);
    const defaultMat = getOrCreateMaterial(_DEFAULT_GREY);
    const removed = [..._matPanelSelected];
    const removedSet = new Set(removed);
    const seen = new Set();
    let n = 0;
    for (const p of state.parts || []) {
      if (p.deleted || !p.mesh || seen.has(p.mesh)) continue;
      seen.add(p.mesh);
      let cur = p.mesh.material;
      const isArr = Array.isArray(cur);
      if (isArr) cur = cur[0];
      if (cur && removedSet.has(cur)) {
        if (isArr) p.mesh.material = p.mesh.material.map(m => removedSet.has(m) ? defaultMat : m);
        else       p.mesh.material = defaultMat;
        n++;
      }
    }
    // Drop GPU resources, the user-materials entry, AND the colour-share
    // cache slot. Without the materialByColor cleanup the next part to ask
    // for the same hex via getOrCreateMaterial gets handed back the just-
    // disposed object, which the renderer paints magenta — that was the
    // "switches to pink" bug. Defensive: ensure we never wipe whatever the
    // shared default-grey points at, even if the user happened to delete a
    // material whose colour matched 0x9aa0a6.
    for (const m of removed) {
      if (m === defaultMat) continue;
      try { m.dispose?.(); } catch (_) {}
      if (state.userMaterials) state.userMaterials.delete(m);
      if (state.materialByColor) {
        for (const [k, v] of state.materialByColor) {
          if (v === m) state.materialByColor.delete(k);
        }
      }
    }
    _matPanelSelected.clear();
    _populateMaterialsList();
    try { applySelectionColors?.(); } catch (_) {}
    requestRender();
    toast?.('Deleted materials', `${removed.length} removed (${n} parts restored)`, 'success');
  });

  preBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    _renderPresetMenu();
    menu.classList.toggle('show');
  });
  document.addEventListener('click', () => {
    if (menu.classList.contains('show')) menu.classList.remove('show');
  });
  menu.addEventListener('click', (e) => e.stopPropagation());
}

// Wrap _populateMaterialsList to also wire actions + paint the
// usedby-selection ring. Idempotent: wiring guard handles repeat calls.
const _origPopulateMaterialsList_actions = window._populateMaterialsList;
window._populateMaterialsList = function() {
  _wireMaterialActions();
  const r = _origPopulateMaterialsList_actions.apply(this, arguments);
  _refreshUsedBySelection();
  return r;
};

// Paint a subtle ring on every material cell whose Material is in use by
// the current viewport selection (state.selected). Distinct from the
// brighter .selected (panel-pick) state — this is just a passive hint.
function _refreshUsedBySelection() {
  const panel = document.getElementById('vp-materials-pop');
  if (!panel) return;
  const used = new Set();
  if (state.selected?.size) {
    for (const id of state.selected) {
      const p = getPart(id);
      if (!p || p.deleted || !p.mesh) continue;
      let m = p.mesh.material;
      if (Array.isArray(m)) m = m[0];
      if (m?.isMaterial) used.add(m);
    }
  }
  for (const cell of panel.querySelectorAll('.mat-cell')) {
    cell.classList.toggle('usedby-selection', used.has(cell._mat));
  }
}

// Hook usedby-selection refresh into refreshPropertiesPanel — that runs on
// every selection change, so the ring stays in sync without each call site
// needing to know about the materials panel.
const _origRefreshPropsPanel_matRing = refreshPropertiesPanel;
refreshPropertiesPanel = function() {
  const r = _origRefreshPropsPanel_matRing.apply(this, arguments);
  try { _refreshUsedBySelection(); } catch (_) {}
  return r;
};

// ─── Smart-fit proxy fitter (AABB / OBB / cylinder) ────────────────────────
// Picks the best low-poly stand-in for a part's silhouette. Replaces the
// old AABB-only path so a 45°-tilted part doesn't get an oversized
// axis-aligned box, and so clearly cylindrical parts get a cylinder
// instead of a wasteful box. Conservative by default — see gates below.
//
// Output is in PARTSROOT-LOCAL space, matching what bboxifyParts already
// expects to write into mesh.position/quaternion/scale (mesh re-parented
// to partsRoot, no scale).
state.smartFit = state.smartFit || {
  cylCircularity: 0.92,   // min circularity (1 - residual/radius) to accept cylinder
  cylBoxWaste:    0.60,   // cylinder vol must be ≤ this × best-box vol
  cylAspect:      1.5,    // long-axis extent must be ≥ this × perp extents
  pcaEnabled:     true,   // run PCA fallback when local-frame OBB is poor
  pcaMaxVerts:    50000,  // skip PCA above this vertex count (perf gate)
};
let _fitCache = new WeakMap();     // BufferGeometry → FitResult (instanced parts share work)
function _resetFitCache() { _fitCache = new WeakMap(); }

// Symmetric 3×3 Jacobi eigen solver. Returns { values:[3], vectors:[3][3] }
// sorted descending by eigenvalue. Vectors stored as columns: vectors[i]
// is the i-th eigenvector. ~6 sweeps converge for 3×3 in practice.
function _jacobi3(m) {
  const a = [m[0].slice(), m[1].slice(), m[2].slice()];
  const v = [[1,0,0],[0,1,0],[0,0,1]];
  for (let sweep = 0; sweep < 24; sweep++) {
    const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
    if (off < 1e-12) break;
    for (let p = 0; p < 2; p++) {
      for (let q = p+1; q < 3; q++) {
        const apq = a[p][q]; if (Math.abs(apq) < 1e-14) continue;
        const theta = (a[q][q] - a[p][p]) / (2*apq);
        const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta*theta + 1));
        const c = 1 / Math.sqrt(1 + t*t), s = t*c;
        const app = a[p][p], aqq = a[q][q];
        a[p][p] = app - t*apq; a[q][q] = aqq + t*apq; a[p][q] = a[q][p] = 0;
        for (let r = 0; r < 3; r++) {
          if (r !== p && r !== q) {
            const arp = a[r][p], arq = a[r][q];
            a[r][p] = a[p][r] = c*arp - s*arq;
            a[r][q] = a[q][r] = s*arp + c*arq;
          }
          const vrp = v[r][p], vrq = v[r][q];
          v[r][p] = c*vrp - s*vrq;
          v[r][q] = s*vrp + c*vrq;
        }
      }
    }
  }
  const idx = [0,1,2].sort((i,j) => a[j][j] - a[i][i]);
  const values = idx.map(i => a[i][i]);
  const vectors = idx.map(i => [v[0][i], v[1][i], v[2][i]]);
  return { values, vectors };
}

function _principalAxes(positions, stride = 1) {
  const n = positions.length / 3;
  if (n < 3) return null;
  let cx = 0, cy = 0, cz = 0, cnt = 0;
  for (let i = 0; i < n; i += stride) {
    cx += positions[i*3]; cy += positions[i*3+1]; cz += positions[i*3+2]; cnt++;
  }
  cx /= cnt; cy /= cnt; cz /= cnt;
  let xx=0,xy=0,xz=0,yy=0,yz=0,zz=0;
  for (let i = 0; i < n; i += stride) {
    const dx = positions[i*3]-cx, dy = positions[i*3+1]-cy, dz = positions[i*3+2]-cz;
    xx += dx*dx; yy += dy*dy; zz += dz*dz;
    xy += dx*dy; xz += dx*dz; yz += dy*dz;
  }
  const m = [[xx,xy,xz],[xy,yy,yz],[xz,yz,zz]];
  const { vectors } = _jacobi3(m);
  // Force right-handed basis so quaternion conversion is stable.
  const e0 = vectors[0], e1 = vectors[1];
  const e2 = [e0[1]*e1[2]-e0[2]*e1[1], e0[2]*e1[0]-e0[0]*e1[2], e0[0]*e1[1]-e0[1]*e1[0]];
  return { center: [cx, cy, cz], axes: [e0, e1, e2] };
}

// Kasa least-squares circle fit on vertices projected onto the plane
// perpendicular to axes[axisIdx]. Returns { r, residual, hMin, hMax, cu, cv }
// in the basis frame.
function _circleFit(positions, center, axes, axisIdx, stride = 1) {
  const aLong = axes[axisIdx];
  const aU    = axes[(axisIdx+1) % 3];
  const aV    = axes[(axisIdx+2) % 3];
  const n = positions.length / 3;
  let sumX=0,sumY=0,sumXX=0,sumYY=0,sumXY=0,sumXR=0,sumYR=0,sumR=0,cnt=0;
  let hMin = +Infinity, hMax = -Infinity;
  for (let i = 0; i < n; i += stride) {
    const dx = positions[i*3]-center[0], dy = positions[i*3+1]-center[1], dz = positions[i*3+2]-center[2];
    const u = dx*aU[0] + dy*aU[1] + dz*aU[2];
    const v = dx*aV[0] + dy*aV[1] + dz*aV[2];
    const h = dx*aLong[0] + dy*aLong[1] + dz*aLong[2];
    if (h < hMin) hMin = h;
    if (h > hMax) hMax = h;
    const r2 = u*u + v*v;
    sumX += u; sumY += v; sumXX += u*u; sumYY += v*v; sumXY += u*v;
    sumXR += u*r2; sumYR += v*r2; sumR += r2; cnt++;
  }
  if (cnt < 3) return null;
  const M = [[sumXX,sumXY,sumX],[sumXY,sumYY,sumY],[sumX,sumY,cnt]];
  const b = [sumXR, sumYR, sumR];
  const det =
      M[0][0]*(M[1][1]*M[2][2]-M[1][2]*M[2][1])
    - M[0][1]*(M[1][0]*M[2][2]-M[1][2]*M[2][0])
    + M[0][2]*(M[1][0]*M[2][1]-M[1][1]*M[2][0]);
  if (Math.abs(det) < 1e-12) return null;
  const inv = (i,j) => {
    const i1=(i+1)%3, i2=(i+2)%3, j1=(j+1)%3, j2=(j+2)%3;
    return (M[j1][i1]*M[j2][i2] - M[j1][i2]*M[j2][i1]) / det;
  };
  const A = inv(0,0)*b[0] + inv(0,1)*b[1] + inv(0,2)*b[2];
  const B = inv(1,0)*b[0] + inv(1,1)*b[1] + inv(1,2)*b[2];
  const C = inv(2,0)*b[0] + inv(2,1)*b[1] + inv(2,2)*b[2];
  const cu = A/2, cv = B/2;
  const r2c = C + cu*cu + cv*cv;
  if (!(r2c > 0)) return null;
  const r = Math.sqrt(r2c);
  let resSum = 0;
  for (let i = 0; i < n; i += stride) {
    const dx = positions[i*3]-center[0], dy = positions[i*3+1]-center[1], dz = positions[i*3+2]-center[2];
    const u = dx*aU[0] + dy*aU[1] + dz*aU[2];
    const v = dx*aV[0] + dy*aV[1] + dz*aV[2];
    const dr = Math.sqrt((u-cu)*(u-cu) + (v-cv)*(v-cv)) - r;
    resSum += Math.abs(dr);
  }
  const residual = resSum / cnt;
  return { r, residual, hMin, hMax, cu, cv };
}

function _basisToQuat(axes) {
  const m = new THREE.Matrix4();
  m.set(
    axes[0][0], axes[1][0], axes[2][0], 0,
    axes[0][1], axes[1][1], axes[2][1], 0,
    axes[0][2], axes[1][2], axes[2][2], 0,
    0, 0, 0, 1
  );
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

// mode ∈ {'smart','aabb','obb','cyl'}. Returns null only if the geometry
// is degenerate (caller already filtered NaN/empty cases).
function fitProxy(geom, localToPartsRoot, mode = 'smart') {
  const cached = (mode === 'smart') ? _fitCache.get(geom) : null;
  if (cached) return cached;
  if (!geom.boundingBox) geom.computeBoundingBox();
  const localBox = geom.boundingBox;
  const aabbPartsRoot = new THREE.Box3().copy(localBox).applyMatrix4(localToPartsRoot);
  const sizeAabb = aabbPartsRoot.getSize(new THREE.Vector3());
  const centerAabb = aabbPartsRoot.getCenter(new THREE.Vector3());
  const aabbVol = sizeAabb.x * sizeAabb.y * sizeAabb.z;

  const makeAabb = () => {
    const g = new THREE.BoxGeometry(sizeAabb.x, sizeAabb.y, sizeAabb.z);
    g.computeBoundingBox(); g.computeBoundingSphere();
    return { kind:'aabb', proxyGeom:g, position:centerAabb.clone(),
             quaternion:new THREE.Quaternion(), score:0, tri:12, vert:8,
             size:sizeAabb.clone(), boxVol:aabbVol };
  };
  if (mode === 'aabb') return makeAabb();

  // OBB candidate from mesh's local frame (cheap).
  const sizeLocal = new THREE.Vector3(
    localBox.max.x - localBox.min.x,
    localBox.max.y - localBox.min.y,
    localBox.max.z - localBox.min.z
  );
  const centerLocal = new THREE.Vector3(
    (localBox.min.x + localBox.max.x) * 0.5,
    (localBox.min.y + localBox.max.y) * 0.5,
    (localBox.min.z + localBox.max.z) * 0.5
  );
  const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
  localToPartsRoot.decompose(pos, quat, scl);
  const sizeObbLocal = new THREE.Vector3(
    sizeLocal.x * Math.abs(scl.x),
    sizeLocal.y * Math.abs(scl.y),
    sizeLocal.z * Math.abs(scl.z)
  );
  const obbCenter = new THREE.Vector3(
    centerLocal.x * scl.x, centerLocal.y * scl.y, centerLocal.z * scl.z
  ).applyQuaternion(quat).add(pos);
  const obbVol = sizeObbLocal.x * sizeObbLocal.y * sizeObbLocal.z;

  let best = { kind:'obb', size:sizeObbLocal.clone(), center:obbCenter.clone(),
               quaternion:quat.clone(), boxVol:obbVol, fromPCA:false };

  const cfg = state.smartFit;
  const positions = geom.attributes?.position?.array;
  const vertCount = geom.attributes?.position?.count || 0;

  // PCA fallback: only when local-frame OBB is materially worse than AABB.
  // Common case where this triggers: GLTFLoader gives the mesh identity
  // local rotation but the vertices themselves are tilted.
  const wantPca = (mode === 'obb' || mode === 'smart' || mode === 'cyl')
    && cfg.pcaEnabled && obbVol > aabbVol * 1.25;
  let pcaResult = null;
  if (wantPca && positions && vertCount > 0 && vertCount <= cfg.pcaMaxVerts) {
    const stride = vertCount > 10000 ? Math.ceil(vertCount / 10000) : 1;
    pcaResult = _principalAxes(positions, stride);
    if (pcaResult) {
      const { center: pcaCenter, axes } = pcaResult;
      let minU=+Infinity,maxU=-Infinity, minV=+Infinity,maxV=-Infinity, minW=+Infinity,maxW=-Infinity;
      for (let i = 0; i < vertCount; i += stride) {
        const dx = positions[i*3]-pcaCenter[0], dy = positions[i*3+1]-pcaCenter[1], dz = positions[i*3+2]-pcaCenter[2];
        const u = dx*axes[0][0] + dy*axes[0][1] + dz*axes[0][2];
        const v = dx*axes[1][0] + dy*axes[1][1] + dz*axes[1][2];
        const w = dx*axes[2][0] + dy*axes[2][1] + dz*axes[2][2];
        if (u<minU)minU=u; if (u>maxU)maxU=u;
        if (v<minV)minV=v; if (v>maxV)maxV=v;
        if (w<minW)minW=w; if (w>maxW)maxW=w;
      }
      const sclMag = (Math.abs(scl.x) + Math.abs(scl.y) + Math.abs(scl.z)) / 3;
      const extentU = (maxU-minU) * sclMag;
      const extentV = (maxV-minV) * sclMag;
      const extentW = (maxW-minW) * sclMag;
      const cu = (minU+maxU)/2, cv = (minV+maxV)/2, cw = (minW+maxW)/2;
      const localCenter = new THREE.Vector3(
        pcaCenter[0] + axes[0][0]*cu + axes[1][0]*cv + axes[2][0]*cw,
        pcaCenter[1] + axes[0][1]*cu + axes[1][1]*cv + axes[2][1]*cw,
        pcaCenter[2] + axes[0][2]*cu + axes[1][2]*cv + axes[2][2]*cw,
      ).multiply(scl).applyQuaternion(quat).add(pos);
      const pcaQuat = quat.clone().multiply(_basisToQuat(axes));
      const pcaVol = extentU * extentV * extentW;
      if (pcaVol < best.boxVol) {
        best = { kind:'obb', size:new THREE.Vector3(extentU, extentV, extentW),
                 center:localCenter, quaternion:pcaQuat, boxVol:pcaVol, fromPCA:true };
      }
    }
  }

  if (mode === 'obb') {
    const g = new THREE.BoxGeometry(best.size.x, best.size.y, best.size.z);
    g.computeBoundingBox(); g.computeBoundingSphere();
    const r = { kind:'obb', proxyGeom:g, position:best.center, quaternion:best.quaternion,
                score: aabbVol > 0 ? Math.max(0, 1 - best.boxVol/aabbVol) : 0,
                tri:12, vert:8, size:best.size.clone(), boxVol:best.boxVol };
    _fitCache.set(geom, r); return r;
  }

  // Cylinder candidate.
  let cyl = null;
  if (mode === 'cyl' || mode === 'smart') {
    let projAxes, projCenter, projStride;
    if (pcaResult) {
      projAxes = pcaResult.axes; projCenter = pcaResult.center;
      projStride = vertCount > 10000 ? Math.ceil(vertCount / 10000) : 1;
    } else if (positions && vertCount > 0 && vertCount <= cfg.pcaMaxVerts) {
      projAxes = [[1,0,0],[0,1,0],[0,0,1]];
      projCenter = [centerLocal.x, centerLocal.y, centerLocal.z];
      projStride = vertCount > 10000 ? Math.ceil(vertCount / 10000) : 1;
    }
    if (projAxes && positions) {
      let bestCyl = null;
      for (let ai = 0; ai < 3; ai++) {
        const fit = _circleFit(positions, projCenter, projAxes, ai, projStride);
        if (!fit) continue;
        const circularity = fit.r > 0 ? Math.max(0, 1 - fit.residual / fit.r) : 0;
        if (!bestCyl || circularity > bestCyl.circularity) bestCyl = { ...fit, axisIdx: ai, circularity };
      }
      if (bestCyl) {
        const aLong = bestCyl.axisIdx, aU = (aLong+1)%3, aV = (aLong+2)%3;
        const sclArr = [Math.abs(scl.x), Math.abs(scl.y), Math.abs(scl.z)];
        // sR is geometric mean of scales perpendicular to long axis (correct
        // only for uniform scale; close enough for typical CAD).
        const sLong = sclArr[aLong];
        const sR    = Math.sqrt(sclArr[aU] * sclArr[aV]);
        const radius = bestCyl.r * sR;
        const height = (bestCyl.hMax - bestCyl.hMin) * sLong;
        const cylVol = Math.PI * radius * radius * height;
        const hMid = (bestCyl.hMax + bestCyl.hMin) / 2;
        const eU = projAxes[aU], eV = projAxes[aV], eL = projAxes[aLong];
        const localCC = [
          projCenter[0] + eU[0]*bestCyl.cu + eV[0]*bestCyl.cv + eL[0]*hMid,
          projCenter[1] + eU[1]*bestCyl.cu + eV[1]*bestCyl.cv + eL[1]*hMid,
          projCenter[2] + eU[2]*bestCyl.cu + eV[2]*bestCyl.cv + eL[2]*hMid,
        ];
        const cylCenter = new THREE.Vector3(localCC[0]*scl.x, localCC[1]*scl.y, localCC[2]*scl.z)
          .applyQuaternion(quat).add(pos);
        const longInPartsRoot = new THREE.Vector3(eL[0], eL[1], eL[2]).applyQuaternion(quat).normalize();
        const cylQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), longInPartsRoot);

        let accept = (mode === 'cyl');
        if (mode === 'smart') {
          const longExtent = bestCyl.hMax - bestCyl.hMin;
          const perpExtent = Math.max(2*bestCyl.r, 1e-9);
          const aspectOK = longExtent >= cfg.cylAspect * perpExtent;
          const wasteOK  = cylVol <= cfg.cylBoxWaste * best.boxVol;
          const circOK   = bestCyl.circularity >= cfg.cylCircularity;
          accept = circOK && wasteOK && aspectOK;
        }
        if (accept && radius > 1e-9 && height > 1e-9) {
          const segs = 24;
          const g = new THREE.CylinderGeometry(radius, radius, height, segs, 1);
          g.computeBoundingBox(); g.computeBoundingSphere();
          cyl = { kind:'cyl', proxyGeom:g, position:cylCenter, quaternion:cylQuat,
                  score: bestCyl.circularity,
                  tri: 4*segs, vert: 2*(segs+1)+2,
                  size: new THREE.Vector3(2*radius, height, 2*radius),
                  boxVol: cylVol };
        }
      }
    }
  }
  if (mode === 'cyl') {
    if (cyl) { _fitCache.set(geom, cyl); return cyl; }
    return makeAabb();   // forced cyl but couldn't fit one — fall back rather than block the user
  }
  // Smart pick. Cylinder already passed gates if present — prefer it.
  // For OBB vs AABB, only switch if OBB is meaningfully tighter (≥5%);
  // identity quaternion is preferable for downstream stability.
  if (cyl) { _fitCache.set(geom, cyl); return cyl; }
  if (best.boxVol < aabbVol * 0.95) {
    const g = new THREE.BoxGeometry(best.size.x, best.size.y, best.size.z);
    g.computeBoundingBox(); g.computeBoundingSphere();
    const r = { kind:'obb', proxyGeom:g, position:best.center, quaternion:best.quaternion,
                score: aabbVol > 0 ? Math.max(0, 1 - best.boxVol/aabbVol) : 0,
                tri:12, vert:8, size:best.size.clone(), boxVol:best.boxVol };
    _fitCache.set(geom, r); return r;
  }
  const r = makeAabb();
  _fitCache.set(geom, r);
  return r;
}

// ─── Bbox-ify selected/all ─────────────────────────────────────────────────
async function bboxifyParts(partIds, label='Smart-fit parts', mode='smart') {
  if (!partIds.length) { toast('Nothing selected', '', 'warn'); return; }
  // Drop any cached fits — thresholds may have changed via the settings
  // panel since the last call, and forced-mode runs need fresh decisions.
  _resetFitCache();
  // Detach the gizmo BEFORE we touch any mesh transforms. When the gizmo is
  // attached, every selected mesh is re-parented under `state.pivot` so the
  // gizmo can move them as a group. If we leave them there during box-ify,
  // the world bbox snapshot is correct (matrixWorld goes through pivot) but
  // the subsequent re-parent to partsRoot uses Object3D.add() which does NOT
  // preserve world transform — the mesh's pivot-local matrix gets applied
  // directly under partsRoot, then we explicitly overwrite position/quat/
  // scale and the result depends on _pivotedParts state being consistent
  // afterward (it isn't — pivot still references the now-moved meshes).
  // Net effect: gizmo state goes stale, future drags don't move anything,
  // and on multi-select the visible result looks "exploded".
  // bakeTransforms and centerPivotsOnSelection already do this; box-ify
  // didn't. Same pattern, same fix.
  _detachGizmo();
  // Reset any active explode BEFORE boxifying. Without this, every part's
  // current position is a (rest + explode-delta) sum, and boxify would
  // snapshot that sum as the new rest position — the boxified part would
  // then jump on the next slider tick because its baseline is wrong.
  // Resetting first ensures we boxify around the canonical rest pose, so the
  // baseline we update below is correct regardless of slider state.
  const wasExploded = state.explode && (state.explode.x || state.explode.y || state.explode.z);
  if (wasExploded && typeof resetExplode === 'function') resetExplode();
  const total = partIds.length;
  const showLoader = total > 100;
  state.renderPaused = true;
  // Make absolutely sure we restore renderPaused + schedule a frame even if any
  // step below throws — otherwise the viewport silently freezes (the on-demand
  // render loop sees renderPaused=true and skips drawing).
  let ops = [];
  let skipped = 0;
  let coboxedSiblings = 0;

  // ── Build a geometry-sharing index up front ─────────────────────────────
  // Cinema 4D / GLB files frequently have parts that reference the SAME
  // BufferGeometry — sub-3 instance pairs the auto-instance pass left as
  // separate Meshes, decorative duplicates, etc. Boxify replaces ONE part's
  // geometry reference, but if a sibling still holds a ref to the original
  // (and is at the same/overlapping world position), the sibling renders the
  // ORIGINAL shape on top of the new box. The selection outline correctly
  // shows a box (built from p.mesh.geometry which IS the new box), but the
  // visible mesh appears unchanged because the sibling's draw covers it.
  // This is what the user perceives as "boxify distorts mesh".
  //
  // Fix: walk every alive part once and bucket them by the underlying
  // BufferGeometry object. For each part we boxify, also boxify its siblings
  // that share the same buffer — keeping the visual representation consistent.
  // Limited to siblings whose world bbox CENTRE coincides with the boxified
  // part's centre (within 5% of the model diagonal); siblings at distinct
  // positions are deliberately left alone since they're independent visible
  // parts that happen to share a buffer.
  const partsByGeom = new Map();
  for (const q of state.parts) {
    if (q.deleted || !q.mesh || !q.mesh.geometry) continue;
    const g = q.mesh.geometry;
    let arr = partsByGeom.get(g);
    if (!arr) { arr = []; partsByGeom.set(g, arr); }
    arr.push(q);
  }
  const idSet = new Set(partIds);
  try {
    if (showLoader) { setLoader(true, 'Box-ifying parts...', `${total} parts`); setLoaderProgress(0); }
    const yieldEvery = Math.max(20, Math.floor(total / 50));
    let processed = 0;
    for (const id of partIds) {
      if (processed > 0 && processed % yieldEvery === 0) {
        if (showLoader) { setLoaderProgress((processed / total) * 100); $('loader-sub').textContent = `${processed} / ${total}`; }
        await new Promise(r => setTimeout(r, 0));
      }
      processed++;
      const p = getPart(id);
      if (!p || p.deleted) { skipped++; continue; }
      // Auto-promote instanced parts → standalone mesh BEFORE boxifying.
      // Replacing the shared InstancedMesh.geometry would corrupt every other
      // instance sharing it, so instead we pop just THIS instance into its own
      // Mesh (zeroing the original slot to prevent ghost rendering) and then
      // boxify normally. Matches Blender / C4D / Fusion convention of "auto
      // make-single-user on destructive edit". `_promoteInstanceToMesh`
      // already sets p.mesh, clears p.instancedMesh, and flushes the
      // instanceMatrix dirty flag — see app-v2.js:1057.
      if (p.instancedMesh && !p.mesh) {
        if (!_promoteInstanceToMesh(p)) { skipped++; continue; }
        // Promotion is intentionally one-way: undoing the boxify restores the
        // standalone-mesh geometry but leaves the part promoted (matches
        // Blender's "Make Single User" — there's no auto-relink). The
        // instancedGroups counter pruning below keeps the count honest.
      }
      if (!p.mesh) { skipped++; continue; }
      p.mesh.updateWorldMatrix(true, false);
      // Compute the world bbox from the geometry's LOCAL bbox + this mesh's
      // matrixWorld, transforming the 8 corners. Bypassing Box3.setFromObject
      // gives two safety wins on Cinema 4D files:
      //   1. setFromObject traverses children — if a flagged-fill overlay or
      //      selection outline got attached as a child of p.mesh in some path,
      //      its (possibly different) geometry would skew the bbox. Computing
      //      from the leaf geometry directly is exactly the bbox of THIS part.
      //   2. setFromObject uses the geometry's CACHED bbox if present. After
      //      a previous bake / merge / split, that cache can be stale. We
      //      force-recompute every iteration so wbox is always fresh.
      if (!p.mesh.geometry || !p.mesh.geometry.attributes?.position) { skipped++; continue; }
      p.mesh.geometry.computeBoundingBox();
      const localBox = p.mesh.geometry.boundingBox;
      // Sanity check the LOCAL bbox before transforming. Cinema 4D / DCC
      // exports occasionally include geometry with NaN or ±Infinity vertex
      // positions (decorative empty objects, helper splines that GLTFLoader
      // promotes to Mesh, sub-objects with unset transforms). computeBoundingBox
      // happily propagates those into min/max. If we then BoxGeometry(Infinity),
      // the resulting box engulfs the entire scene — what the user sees as
      // an "explosion".
      if (!isFinite(localBox.min.x) || !isFinite(localBox.min.y) || !isFinite(localBox.min.z) ||
          !isFinite(localBox.max.x) || !isFinite(localBox.max.y) || !isFinite(localBox.max.z)) {
        Log.warn(`boxify: skipping "${p.name}" — geometry has non-finite vertex positions`, { tag: 'boxify' });
        skipped++; continue;
      }
      // Compute the AABB in PARTSROOT-LOCAL space, not world space. The box
      // mesh ends up parented under partsRoot at IDENTITY quaternion (no
      // mesh.matrix rotation), so the only frame in which "axis-aligned" is
      // stable is partsRoot-local. World-axis-aligned would require
      // compensating mesh.quaternion = partsRootRotInv_at_boxify, which
      // becomes stale the moment partsRoot rotates (recenter, axis snap,
      // auto-rotate) — that staleness is what produced the "merged
      // boxified objects rotate 90°" bug and the explode-slider jumps.
      // partsRoot-local AABB is identical to world AABB whenever
      // partsRoot is at identity (the typical case); when partsRoot has
      // rotation, the bbox is computed in the model's natural frame which
      // is more meaningful anyway.
      state.partsRoot.updateMatrix();
      state.partsRoot.updateMatrixWorld(true);
      const _partsRootInv_pre = new THREE.Matrix4().copy(state.partsRoot.matrixWorld).invert();
      const _localToPartsRoot = new THREE.Matrix4().multiplyMatrices(_partsRootInv_pre, p.mesh.matrixWorld);
      const wbox = new THREE.Box3().copy(localBox).applyMatrix4(_localToPartsRoot);
      if (wbox.isEmpty()) { skipped++; continue; }
      const size = wbox.getSize(new THREE.Vector3());
      const center = wbox.getCenter(new THREE.Vector3());
      // `center` here is in partsRoot-LOCAL coordinates — name kept for
      // continuity, but downstream code that expected world centre needs
      // updating accordingly (see _partCenter snapshot below).
      if (size.x < 1e-9 || size.y < 1e-9 || size.z < 1e-9) { skipped++; continue; }
      // Guard against absurdly-large world bboxes from sheared/scaled parent
      // chains. A part bigger than ~1e5 units in a typical CAD scene is almost
      // certainly a bug — most assemblies are under a few thousand units max.
      // Skip with a warn rather than producing a scene-eating box.
      if (size.x > 1e5 || size.y > 1e5 || size.z > 1e5 ||
          !isFinite(size.x) || !isFinite(size.y) || !isFinite(size.z)) {
        Log.warn(`boxify: skipping "${p.name}" — world bbox is unreasonably large (${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)}). Likely a sheared parent chain or stray helper geometry.`, { tag: 'boxify' });
        skipped++; continue;
      }
      // ── Debug breadcrumb (first 3 parts only) ───────────────────────────
      // Captures the exact transforms used for this part so we can see why
      // a specific Cinema-4D part comes out distorted. Trims to 3 entries
      // so a 5000-part box-ify-all doesn't flood the console.
      if (ops.length < 3) {
        Log.debug(`boxify "${p.name}": parent=${p.mesh.parent?.name||'(none)'} ` +
                  `localBox=[${localBox.min.x.toFixed(2)},${localBox.min.y.toFixed(2)},${localBox.min.z.toFixed(2)} → ${localBox.max.x.toFixed(2)},${localBox.max.y.toFixed(2)},${localBox.max.z.toFixed(2)}] ` +
                  `wsize=[${size.x.toFixed(3)},${size.y.toFixed(3)},${size.z.toFixed(3)}] ` +
                  `wcenter=[${center.x.toFixed(3)},${center.y.toFixed(3)},${center.z.toFixed(3)}]`,
                  { tag: 'boxify' });
      }
      // Snapshot for undo. We also save the original parent so undo can
      // restore the scene-graph relationship after we re-parent below.
      ops.push({
        partId: id,
        origGeom: p.mesh.geometry,
        origParent: p.mesh.parent,
        origPos: p.mesh.position.clone(),
        origQuat: p.mesh.quaternion.clone(),
        origScale: p.mesh.scale.clone(),
        origTri: p.triCount, origVert: p.vertCount,
        origBbox: p.bbox.clone(),
        // Save the explode-baseline cache too so undo can restore it. Without
        // this, undo brings the part back to its original geometry/transform
        // but applyExplode keeps using the boxify-time rest snapshot below
        // and the mesh jumps next slider tick.
        origOrigPos: p._origPos ? p._origPos.clone() : null,
        origPartCenter: p._partCenter ? p._partCenter.clone() : null,
        origInstOrigMat: p._instOrigMat ? p._instOrigMat.clone() : null,
      });
      // Run the smart fitter — picks AABB / OBB / cylinder. `_localToPartsRoot`
      // and the safety-checked `size` above are the inputs it needs. Result is
      // in partsRoot-local space, ready to drop into mesh.position/quaternion.
      const fit = fitProxy(p.mesh.geometry, _localToPartsRoot, mode);
      if (!fit) { skipped++; continue; }
      const boxGeom = fit.proxyGeom;
      const fitCenter = fit.position;
      const fitQuat   = fit.quaternion;
      // If the part's material reads vertex colors (e.g. the mesh produced by
      // mergeSelectedIntoOne uses MeshStandardMaterial({vertexColors:true})),
      // the new BoxGeometry MUST also carry a `color` attribute. Otherwise the
      // shader expects an attribute the geometry doesn't supply: WebGL silently
      // renders garbage, but WebGPU fails the pipeline bind on every frame and
      // the renderer's catch-all swallows the error → the viewport appears
      // frozen with no obvious cause. Fill it uniformly with the part's color.
      if (p.mesh.material && p.mesh.material.vertexColors) {
        const vCount = boxGeom.attributes.position.count;
        const colArr = new Float32Array(vCount * 3);
        const cc = p.originalColor || new THREE.Color(0xcccccc);
        for (let vi = 0; vi < vCount; vi++) {
          colArr[vi*3] = cc.r; colArr[vi*3+1] = cc.g; colArr[vi*3+2] = cc.b;
        }
        boxGeom.setAttribute('color', new THREE.Float32BufferAttribute(colArr, 3));
      }
      // ── Re-parent to partsRoot to escape the broken parent chain ──────
      //
      // Why the previous "decompose parent.matrixWorld^-1 * T(center)" math
      // didn't actually fix it on the Cinema 4D file: those exports nest
      // meshes under transformer groups that combine ROTATION with
      // NON-UNIFORM SCALE (e.g. R · S(2,1,1)). That composition is not
      // orthogonal; its inverse times a translation produces a SHEARED
      // 4×4 matrix. `Matrix4.decompose` cannot represent shear — it
      // computes a best-fit (T, Q, S) that does NOT reconstruct the
      // original matrix, so the visible transform is wrong even though
      // the math is correct on paper.
      //
      // Robust fix: sidestep the broken parent. Re-parent the box mesh
      // to `partsRoot`. partsRoot has at most a rotation (auto-rotate;
      // never scale), so its matrixWorld is orthogonal — composed with
      // T(center) it decomposes exactly. No shear, no distortion,
      // regardless of how mangled the original parent chain was.
      //
      // Side effect: the box leaves its original group in the scene
      // graph. Fine: we already replaced the geometry, and our part
      // tree / user-group bookkeeping is by partId not by parent, so
      // groups stay consistent. Undo restores the original parent.
      if (p.mesh.parent && p.mesh.parent !== state.partsRoot) {
        p.mesh.parent.remove(p.mesh);
      }
      if (p.mesh.parent !== state.partsRoot) {
        state.partsRoot.add(p.mesh);
      }
      // Capture the original geometry BEFORE we replace it so we can find
      // siblings that share the same buffer (see partsByGeom build above).
      const sharedGeom = p.mesh.geometry;
      p.mesh.geometry = boxGeom;
      // Force the material to recompile its pipeline against the new
      // geometry's attribute layout. Without this, three.js r172 WebGPU
      // can keep using a pipeline cached against the OLD geometry and the
      // new vertex buffer renders with stale state — visually the mesh
      // appears unchanged or scrambled even though geometry was replaced.
      if (p.mesh.material) {
        if (Array.isArray(p.mesh.material)) {
          for (const m of p.mesh.material) if (m) m.needsUpdate = true;
        } else {
          p.mesh.material.needsUpdate = true;
        }
      }

      // mesh.matrix = T(center) only — pure translation, no rotation. The
      // box's local axes coincide with partsRoot's local axes; whatever
      // rotation partsRoot has (auto-rotate, recenter, etc.) is applied
      // identically to every child. Crucially: there is NO baked-in
      // partsRootRotInv quaternion on the mesh, so future partsRoot
      // rotation can never desync it. This is the property the merge bake
      // depends on.
      p.mesh.position.copy(fitCenter);
      p.mesh.quaternion.copy(fitQuat);
      p.mesh.scale.set(1, 1, 1);
      p.mesh.matrixAutoUpdate = true;
      p.mesh.updateMatrix();
      p.mesh.updateMatrixWorld(true);

      // Refresh the _exactWorld snapshot. mesh.matrixWorld =
      //   partsRoot.matrixWorld * T(fitCenter) * R(fitQuat)
      // For AABB the quaternion is identity (same property as before).
      // For OBB / cylinder the rotation is baked into the mesh transform,
      // not into the geometry — partsRoot rotations still apply uniformly.
      p._exactWorld = p.mesh.matrixWorld.clone();

      // Refresh explode baseline. _origPos = partsRoot-local rest position.
      // _partCenter = world bbox centre. applyExplode works in world space
      // then converts deltas back to partsRoot-local before adding to _origPos.
      p._origPos = p.mesh.position.clone();
      p._partCenter = fitCenter.clone().applyMatrix4(state.partsRoot.matrixWorld);
      // Belt-and-braces: clear any stale instanced-explode cache. Boxified
      // parts always live as standalone meshes after this op; if anything
      // ever flips the part back to an InstancedMesh path the cache will be
      // recomputed by _ensureExplodeBaseline from scratch.
      p._instOrigMat = null;

      p.triCount = fit.tri; p.vertCount = fit.vert;
      // p.bbox in world space. boxGeom.boundingBox is the proxy's local AABB;
      // applyMatrix4(mesh.matrixWorld) folds in the OBB rotation so the
      // resulting world-AABB tightly bounds the rotated proxy.
      p.bbox.copy(boxGeom.boundingBox).applyMatrix4(p.mesh.matrixWorld);
      const fSize = fit.size;
      p.sizeMetrics = { diag: fSize.length(), vol: fSize.x*fSize.y*fSize.z, max: Math.max(fSize.x, fSize.y, fSize.z) };
      // Give this part a UNIQUE hash before stashing the boxGeom. Without
      // this, multiple boxified parts that were originally instances of the
      // same geometry all share one hash, and they collide in
      // state.geomByHash — only the LAST boxify wins. Subsequent ops
      // (merge, dupe-detect, export) that read state.geomByHash.get(p.hash)
      // then pull a sibling's boxGeom for everyone else, baking wrong-sized
      // box vertices and producing the visible "some boxified parts rotate
      // when merging" symptom on multi-instance selections.
      // Save the original hash on the undo op so we can restore it.
      ops[ops.length - 1].origHash = p.hash;
      ops[ops.length - 1].fitKind = fit.kind;
      p.hash = `boxify_${p.partId}`;
      state.geomByHash.set(p.hash, boxGeom);
      // Stale fingerprint cache (bbox shape changed)
      p._fp = null; p._fpKey = null;

      // ── Co-boxify siblings that share the original buffer at the same
      //    world position. Without this they keep rendering the original
      //    shape on top of our new box (the "outline is a box but the
      //    rendered mesh looks unchanged" symptom).
      const siblings = partsByGeom.get(sharedGeom) || [];
      const tolerance = (state.modelDiag || 1) * 0.05;        // 5% of model diag
      const tol2 = tolerance * tolerance;
      for (const sib of siblings) {
        if (sib === p) continue;
        if (sib.deleted || !sib.mesh || idSet.has(sib.partId)) continue;
        sib.mesh.updateWorldMatrix(true, false);
        if (!sib.mesh.geometry || !sib.mesh.geometry.attributes?.position) continue;
        // Compute sibling's world bbox center
        if (!sib.mesh.geometry.boundingBox) sib.mesh.geometry.computeBoundingBox();
        const sibBox = new THREE.Box3().copy(sib.mesh.geometry.boundingBox).applyMatrix4(sib.mesh.matrixWorld);
        if (sibBox.isEmpty()) continue;
        const sibCenter = sibBox.getCenter(new THREE.Vector3());
        if (sibCenter.distanceToSquared(center) > tol2) continue;     // too far away

        // This sibling overlaps our boxified part at roughly the same
        // position. Replace its geometry with the SAME boxGeom so visually
        // they match. Keep its own transform so it stays at its own slight
        // offset (in case the centers differ by sub-tolerance).
        if (sib.mesh.parent && sib.mesh.parent !== state.partsRoot) sib.mesh.parent.remove(sib.mesh);
        if (sib.mesh.parent !== state.partsRoot) state.partsRoot.add(sib.mesh);
        ops.push({
          partId: sib.partId,
          origGeom: sib.mesh.geometry,
          origParent: sib.mesh.parent,
          origPos: sib.mesh.position.clone(),
          origQuat: sib.mesh.quaternion.clone(),
          origScale: sib.mesh.scale.clone(),
          origTri: sib.triCount, origVert: sib.vertCount,
          origBbox: sib.bbox.clone(),
          origOrigPos: sib._origPos ? sib._origPos.clone() : null,
          origPartCenter: sib._partCenter ? sib._partCenter.clone() : null,
          origInstOrigMat: sib._instOrigMat ? sib._instOrigMat.clone() : null,
        });
        sib.mesh.geometry = boxGeom;
        if (sib.mesh.material) {
          if (Array.isArray(sib.mesh.material)) {
            for (const m of sib.mesh.material) if (m) m.needsUpdate = true;
          } else {
            sib.mesh.material.needsUpdate = true;
          }
        }
        // Sibling reuses the primary's fit verbatim — same proxyGeom,
        // partsRoot-local center, and quaternion. They're co-located by
        // definition (within 5% of model diag) so the fit applies. Refitting
        // per-sibling would be wasteful AND could produce visually mismatched
        // proxies for parts that share buffer + position.
        sib.mesh.position.copy(fitCenter);
        sib.mesh.quaternion.copy(fitQuat);
        sib.mesh.scale.set(1, 1, 1);
        sib.mesh.matrixAutoUpdate = true;
        sib.mesh.updateMatrix();
        sib.mesh.updateMatrixWorld(true);
        sib._exactWorld = sib.mesh.matrixWorld.clone();
        sib._origPos = sib.mesh.position.clone();
        sib._partCenter = fitCenter.clone().applyMatrix4(state.partsRoot.matrixWorld);
        sib._instOrigMat = null;
        sib.triCount = fit.tri; sib.vertCount = fit.vert;
        sib.bbox.copy(boxGeom.boundingBox).applyMatrix4(sib.mesh.matrixWorld);
        sib.sizeMetrics = { diag: fSize.length(), vol: fSize.x*fSize.y*fSize.z, max: Math.max(fSize.x, fSize.y, fSize.z) };
        // Sibling gets a unique hash too — same collision concern as the
        // primary. Undo carries origHash so the original shared hash can
        // be restored.
        ops[ops.length - 1].origHash = sib.hash;
        ops[ops.length - 1].fitKind = fit.kind;
        sib.hash = `boxify_${sib.partId}`;
        state.geomByHash.set(sib.hash, boxGeom);
        sib._fp = null; sib._fpKey = null;
        coboxedSiblings++;
      }
    }
    if (ops.length) pushUndo({ type: 'boxify', items: ops, label, mode });
    recomputeStats(); refreshFlagged(); rebuildTree();
    refreshPropertiesPanel(); applySelectionColors();
    if (typeof updateGizmo === 'function') updateGizmo();
    // Build BVHs for the new BoxGeometry replacements (small — 12 tris each).
    _buildBVHsForAllGeoms();
    if (showLoader) { setLoaderProgress(100); await new Promise(r => setTimeout(r, 200)); setLoader(false); }
    // Tally fit-kind breakdown for the toast so users see what was picked.
    const kindCounts = ops.reduce((acc, o) => {
      const k = o.fitKind || 'aabb'; acc[k] = (acc[k] || 0) + 1; return acc;
    }, {});
    const kindParts = [];
    if (kindCounts.aabb) kindParts.push(`${kindCounts.aabb} box`);
    if (kindCounts.obb)  kindParts.push(`${kindCounts.obb} OBB`);
    if (kindCounts.cyl)  kindParts.push(`${kindCounts.cyl} cyl`);
    const kindStr = kindParts.length ? ` (${kindParts.join(', ')})` : '';
    const detail =
      (coboxedSiblings ? ` +${coboxedSiblings} siblings` : '') +
      (skipped ? `, ${skipped} skipped` : '');
    toast(label, `${ops.length} parts proxied${kindStr}${detail}`, 'success');
  } finally {
    // Always release the render lock and request a frame, no matter what
    // happened above. Without requestRender(), the on-demand loop has no
    // reason to draw the new geometry and the viewport appears frozen
    // until the user interacts with OrbitControls.
    state.renderPaused = false;
    if (showLoader) setLoader(false);
    requestRender();
  }
}

const _origUndoLastBB = undoLast;
undoLast = function() {
  const op = state.history[state.history.length - 1];
  if (op && op.type === 'boxify') {
    state.history.pop();
    for (const it of op.items) {
      const p = getPart(it.partId);
      if (!p || !p.mesh) continue;
      // Note: do NOT dispose the current geometry here — boxGeom is shared
      // across co-boxified siblings. Disposing it once removes it from
      // every sibling's mesh, leaving them rendering nothing. The shared
      // boxGeom will be GC'd naturally once no part references it.
      p.mesh.geometry = it.origGeom;
      // Restore the original parent before applying the saved local transform
      // — boxify re-parented the mesh to partsRoot to escape sheared parent
      // chains. The saved origPos/Quat/Scale are in the ORIGINAL parent's
      // local space, so they only restore the world position correctly when
      // the mesh is back under that parent.
      if (it.origParent && p.mesh.parent !== it.origParent) {
        // Sanity-check the original parent is still attached to the scene.
        // If the user has done other ops that pruned that group, fall back
        // to leaving the mesh under partsRoot — its world position will be
        // off but we don't have a clean recovery for that edge case.
        let alive = it.origParent;
        while (alive && alive !== state.partsRoot && alive !== scene) alive = alive.parent;
        if (alive) {
          p.mesh.parent?.remove(p.mesh);
          it.origParent.add(p.mesh);
        }
      }
      p.mesh.position.copy(it.origPos); p.mesh.quaternion.copy(it.origQuat); p.mesh.scale.copy(it.origScale);
      p.mesh.updateMatrixWorld(true);
      // Refresh selection-highlight snapshot to the restored matrix.
      p._exactWorld = p.mesh.matrixWorld.clone();
      // Restore explode baseline cache so the slider doesn't jump after undo.
      // null-safe: the snapshot may have been taken before the part ever
      // received a baseline (first-time slider use happens lazily).
      if (it.origOrigPos !== undefined) p._origPos = it.origOrigPos ? it.origOrigPos.clone() : null;
      if (it.origPartCenter !== undefined) p._partCenter = it.origPartCenter ? it.origPartCenter.clone() : null;
      if (it.origInstOrigMat !== undefined) p._instOrigMat = it.origInstOrigMat ? it.origInstOrigMat.clone() : null;
      p.triCount = it.origTri; p.vertCount = it.origVert; p.bbox.copy(it.origBbox);
      const s = p.bbox.getSize(new THREE.Vector3());
      p.sizeMetrics = { diag: s.length(), vol: s.x*s.y*s.z, max: Math.max(s.x, s.y, s.z) };
      // Drop the unique boxify hash entry from geomByHash and restore the
      // original shared hash on the part. Without this, the geomByHash map
      // grows with stale `boxify_<partId>` entries on every redo cycle.
      if (it.origHash !== undefined && p.hash !== it.origHash) {
        state.geomByHash.delete(p.hash);
        p.hash = it.origHash;
      }
      state.geomByHash.set(p.hash, it.origGeom);
      // Fingerprint cache invalidation — original geometry's bbox shape is restored.
      p._fp = null; p._fpKey = null;
    }
    state.redo.push(op);    // boxify is redoable — bboxifyParts re-runs cleanly
    recomputeStats(); refreshFlagged();
    _finalizeUndo({ rebuildTree: true });
    // Restored parts visible in viewport — no toast.
    return;
  }
  return _origUndoLastBB();
};

// Shared error reporter for fit ops — keeps catch handlers terse.
function _onFitError(e) {
  console.error(e); state.renderPaused = false; setLoader(false); requestRender();
  toast('Smart fit failed', e.message, 'error');
}

// Run a fit on the current selection with an explicit mode. Used by the
// main button (mode='smart'), the caret popover, and the right-click menu.
function smartFitSelection(mode = 'smart') {
  if (!state.selected.size) return toast('Nothing selected', '', 'warn');
  const labels = { smart: 'Smart-fit selected', aabb: 'AABB box selected', obb: 'OBB box selected', cyl: 'Cylinder-fit selected' };
  bboxifyParts([...state.selected], labels[mode] || labels.smart, mode).catch(_onFitError);
}

function _wireBboxButtonsFinal() {
  $('btn-bbox-selected')?.addEventListener('click', () => smartFitSelection('smart'));
  $('btn-bbox-all')?.addEventListener('click', async () => {
    const ids = state.parts.filter(p => !p.deleted && p.mesh).map(p => p.partId);
    if (!ids.length) return toast('No parts to fit', '', 'warn');
    // Smart-fit ALL still prompts: destructive across every part, easy to
    // fire by accident.
    if (!await appConfirm(`Smart-fit ALL ${ids.length} parts with low-poly proxies?\n\nEach part picks the best proxy automatically (tight box, OBB, or cylinder). This is heavy poly reduction and lossy. The per-selection "Smart fit" covers the common case.`,
                          { title: 'Smart-fit ALL parts', okLabel: 'Smart-fit all', danger: true })) return;
    bboxifyParts(ids, 'Smart-fit all', 'smart').catch(_onFitError);
  });
  // ── Caret popover: choose mode + edit thresholds ────────────────────────
  const caret = $('btn-bbox-caret');
  if (caret) {
    let pop = null;
    const closePop = () => {
      if (!pop) return;
      pop.classList.remove('show');
      const old = pop;
      setTimeout(() => old.remove(), 180);
      pop = null;
      document.removeEventListener('mousedown', onDocDown, true);
      document.removeEventListener('keydown', onDocKey, true);
    };
    function onDocDown(ev) {
      if (pop && !pop.contains(ev.target) && ev.target !== caret) closePop();
    }
    function onDocKey(ev) { if (ev.key === 'Escape') closePop(); }
    function openPop() {
      if (pop) { closePop(); return; }
      pop = document.createElement('div');
      pop.className = 'fit-pop';
      const cfg = state.smartFit;
      pop.innerHTML = `
        <div class="fit-item" data-mode="smart"><i data-lucide="wand-2"></i>Smart fit<span class="fit-hint">auto</span></div>
        <div class="fit-item" data-mode="aabb"><i data-lucide="square"></i>Force AABB box<span class="fit-hint">axis-aligned</span></div>
        <div class="fit-item" data-mode="obb"><i data-lucide="rotate-3d"></i>Force OBB box<span class="fit-hint">oriented</span></div>
        <div class="fit-item" data-mode="cyl"><i data-lucide="cylinder"></i>Force cylinder<span class="fit-hint">round</span></div>
        <div class="fit-sep"></div>
        <div class="fit-sliders">
          <div class="fit-row"><span>Cylinder circularity</span><span id="fit-circ-val">${cfg.cylCircularity.toFixed(2)}</span></div>
          <input type="range" id="fit-circ" min="0.85" max="0.99" step="0.01" value="${cfg.cylCircularity}">
          <div class="fit-row"><span>Box-waste cutoff</span><span id="fit-waste-val">${cfg.cylBoxWaste.toFixed(2)}</span></div>
          <input type="range" id="fit-waste" min="0.40" max="0.80" step="0.01" value="${cfg.cylBoxWaste}">
          <div class="fit-row"><span>Aspect-ratio gate</span><span id="fit-aspect-val">${cfg.cylAspect.toFixed(1)}</span></div>
          <input type="range" id="fit-aspect" min="1.0" max="3.0" step="0.1" value="${cfg.cylAspect}">
          <label style="display:flex;align-items:center;gap:6px;margin-top:8px;cursor:pointer">
            <input type="checkbox" id="fit-pca" ${cfg.pcaEnabled ? 'checked' : ''}>
            <span>PCA fallback</span>
          </label>
        </div>
      `;
      document.body.appendChild(pop);
      // Position under the caret, right-aligned to the button-row.
      const r = caret.getBoundingClientRect();
      pop.style.top = `${r.bottom + 6}px`;
      // Right-align: pop's right edge matches caret's right edge so it
      // doesn't overflow the sidebar.
      const popRight = window.innerWidth - r.right;
      pop.style.right = `${popRight}px`;
      requestAnimationFrame(() => pop.classList.add('show'));
      if (window.lucide?.createIcons) try { window.lucide.createIcons({ icons: window.lucide.icons, attrs: { class: 'lucide' } }); } catch (_) {}
      pop.querySelectorAll('.fit-item').forEach(item => {
        item.addEventListener('click', () => {
          const mode = item.dataset.mode;
          closePop();
          smartFitSelection(mode);
        });
      });
      const wireSlider = (id, valId, key, fmt) => {
        const sl = pop.querySelector(`#${id}`); const lbl = pop.querySelector(`#${valId}`);
        sl.addEventListener('input', () => {
          const v = parseFloat(sl.value);
          state.smartFit[key] = v;
          lbl.textContent = fmt(v);
          // Cache becomes stale once thresholds change.
          if (typeof _resetFitCache === 'function') _resetFitCache();
        });
      };
      wireSlider('fit-circ',  'fit-circ-val',  'cylCircularity', v => v.toFixed(2));
      wireSlider('fit-waste', 'fit-waste-val', 'cylBoxWaste',    v => v.toFixed(2));
      wireSlider('fit-aspect','fit-aspect-val','cylAspect',      v => v.toFixed(1));
      pop.querySelector('#fit-pca').addEventListener('change', e => {
        state.smartFit.pcaEnabled = e.target.checked;
        if (typeof _resetFitCache === 'function') _resetFitCache();
      });
      // Close on outside click / Esc, but ignore the click that opened us.
      setTimeout(() => {
        document.addEventListener('mousedown', onDocDown, true);
        document.addEventListener('keydown', onDocKey, true);
      }, 0);
    }
    caret.addEventListener('click', (ev) => { ev.stopPropagation(); openPop(); });
  }
}
const _origWireUIFinal2 = wireUI;
wireUI = function() { _origWireUIFinal2(); _safeRun(_wireBboxButtonsFinal, 'bbox-buttons'); };

// NOTE: A duplicate Merge / Group / undoLast / _wireMergeGroupButtons block was
// inserted here in an earlier pass — not realising the file already had its
// own implementations (mergeSelectedIntoOne, groupSelectedUnderNull as a `let`,
// the user-groups system) further down. The duplicate `function groupSelectedUnderNull`
// collided with the later `let groupSelectedUnderNull = ...` declaration, which
// is a hard syntax error in module scope and prevented the whole script from
// parsing — that's why the Open STEP button (and every other UI handler)
// silently stopped working. Removed; the original implementations below are
// the canonical ones.

// ============== SIDEBAR FEATURE BATCH ==============
// Sort dropdown / tri-bars / right-click menu / hide-unselected / lock /
// selection history / CSV export / selected-as-GLB export.

if (!state.selHistory) state.selHistory = [];
if (state.selHistoryIdx === undefined) state.selHistoryIdx = -1;
if (!state.sortMode) state.sortMode = 'load';

// Mark a part as locked: not deletable, not selectable via picking
function _isLocked(p) { return !!p?.locked; }

// Override pickAtPointer to skip locked parts
const _origPickAtPointer = pickAtPointer;
pickAtPointer = function(ev) {
  const id = _origPickAtPointer(ev);
  if (id == null) return null;
  const p = getPart(id);
  if (p && p.locked) { toast('Part is locked', p.name, 'warn', 2000); return null; }
  return id;
};

// Override deleteParts to skip locked
const _origDeleteParts = deleteParts;
deleteParts = function(ids, label) {
  const filtered = ids.filter(id => {
    const p = getPart(id);
    return p && !p.locked;
  });
  const skipped = ids.length - filtered.length;
  if (skipped > 0) toast('Skipped locked', `${skipped} locked parts not deleted`, 'warn');
  if (!filtered.length) return;
  return _origDeleteParts(filtered, label);
};

// ─── Sort + tri-bar in tree
function _treeSortFn(mode) {
  if (mode === 'name') return (a, b) => a.name.localeCompare(b.name);
  if (mode === 'tricount') return (a, b) => b.triCount - a.triCount;
  if (mode === 'volume') return (a, b) => b.sizeMetrics.vol - a.sizeMetrics.vol;
  if (mode === 'size') return (a, b) => b.sizeMetrics.diag - a.sizeMetrics.diag;
  return (a, b) => a.partId - b.partId;
}

const _origRebuildTree3 = rebuildTree;
rebuildTree = function() {
  const root = $('tree');
  if (!root) return _origRebuildTree3();
  if (state.parts.length === 0) return _origRebuildTree3();
  // Hierarchical GLBs (post-step2glb.py with the XCAF assembly tree) populate
  // state.treeNodes. The enhanced flat-tree renderer below overrides ALL other
  // tree behavior, so without this early exit my hierarchical renderer in
  // _rebuildTreeHierarchical never runs. Defer to the original wrapper chain
  // (which routes to _rebuildTreeHierarchical) when hierarchy is present.
  if (state.treeNodes && state.treeNodes.length) return _origRebuildTree3();
  const ft = ($('tree-filter').value || '').toLowerCase();
  const visible = state.parts
    .filter(p => !p.deleted && (!ft || p.name.toLowerCase().includes(ft)))
    .sort(_treeSortFn(state.sortMode));
  $('tree-summary').textContent = `${visible.length} of ${state.parts.filter(p => !p.deleted).length} parts`;
  root.innerHTML = '';
  // tri count bar — log-scale max for visual clarity
  const maxTri = Math.max(1, ...state.parts.map(p => p.triCount));
  const logMax = Math.log10(maxTri + 1);
  const frag = document.createDocumentFragment();
  const MAX = 5000;
  for (let i = 0; i < Math.min(visible.length, MAX); i++) {
    const p = visible[i];
    const node = document.createElement('div');
    node.className = 'tree-node';
    if (state.selected.has(p.partId)) node.classList.add('selected');
    if (!p.visible) node.classList.add('hidden-vis');
    if (p.flagged) node.classList.add('flagged');
    if (p.locked) node.style.fontStyle = 'italic';
    node.dataset.partId = p.partId;
    const colorHex = '#' + p.originalColor.getHexString();
    const eye = p.visible
      ? `<i data-lucide="eye"></i>`
      : `<i data-lucide="eye-off"></i>`;
    const inst = _instBadge(p.group ? p.group.parts.length : 0);
    const lockIcon = p.locked ? `<span title="Locked" style="opacity:.6;font-size:10px">🔒</span>` : '';
    const triFrac = Math.log10(p.triCount + 1) / logMax;
    const barHue = 240 - triFrac * 240;   // blue → red
    const barW = Math.max(2, triFrac * 40) | 0;
    const bar = `<span style="display:inline-block;width:${barW}px;height:6px;background:hsl(${barHue},70%,55%);border-radius:2px;vertical-align:middle;margin-right:4px"></span>`;
    node.innerHTML = `${lockIcon}<span class="tree-label">${escapeHtml(p.name)}${inst}</span>${bar}<span class="tree-meta">${fmtNum(p.triCount)}</span><span class="tree-iconcol"><span class="tree-vis">${eye}</span><span class="tree-color" style="background:${colorHex}"></span></span>`;
    frag.appendChild(node);
  }
  root.appendChild(frag);
  if (visible.length > MAX) {
    const more = document.createElement('div');
    more.style.cssText = 'padding:8px 14px;color:var(--tx3);font-size:11px;';
    more.textContent = `… ${fmtNum(visible.length - MAX)} more parts not shown (use search)`;
    root.appendChild(more);
  }
  buildMaterialsPanel();
};

// ─── Right-click context menu
function _ctxClose() { const m = $('ctx-menu'); if (m) m.style.display = 'none'; }
function _ctxBuild(items, x, y) {
  const m = $('ctx-menu'); if (!m) return;
  m.innerHTML = '';
  for (const it of items) {
    if (it === '---') { const d = document.createElement('div'); d.style.cssText='height:1px;background:rgba(255,255,255,.06);margin:4px 0'; m.appendChild(d); continue; }
    const row = document.createElement('div');
    row.style.cssText = 'padding:7px 14px;cursor:pointer;color:var(--tx);display:flex;align-items:center;gap:10px;font-size:12.5px';
    // Icon + label as two slots so the icon column lines up across rows.
    // Icon is a Lucide name (string). Empty string skips the icon for that
    // row but reserves the column width so labels stay aligned.
    const iconHtml = it.icon
      ? `<i data-lucide="${it.icon}" style="width:14px;height:14px;flex:0 0 14px;color:${it.danger ? 'var(--er)' : 'var(--tx2)'};stroke-width:2"></i>`
      : `<span style="width:14px;flex:0 0 14px"></span>`;
    const kbdHtml = it.kbd
      ? `<span style="margin-left:auto;padding:1px 5px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);border-bottom-color:rgba(0,0,0,.35);border-radius:3px;font:600 10px ui-monospace,monospace;color:var(--tx2)">${it.kbd}</span>`
      : '';
    row.innerHTML = `${iconHtml}<span style="flex:1;min-width:0">${it.label}</span>${kbdHtml}`;
    if (it.danger) row.style.color = 'var(--er)';
    row.addEventListener('mouseenter', () => row.style.background = 'rgba(255,255,255,.06)');
    row.addEventListener('mouseleave', () => row.style.background = '');
    row.addEventListener('click', () => { _ctxClose(); it.fn(); });
    m.appendChild(row);
  }
  m.style.display = 'block';
  m.style.left = Math.min(x, window.innerWidth - 220) + 'px';
  m.style.top = Math.min(y, window.innerHeight - m.offsetHeight - 10) + 'px';
  // Convert the Lucide placeholders we just inserted into actual SVGs.
  _lucide();
}
// Capture phase: tree-row click handlers (and others in the sidebar) call
// stopPropagation() so the menu never closed when the user clicked a row
// while it was open. Capture fires top-down BEFORE descendants can stop the
// event, so we close reliably regardless. Clicks INSIDE the menu still work
// because each row's own click handler runs in its bubble phase after
// _ctxClose hides the element — hiding doesn't cancel in-flight events.
document.addEventListener('click', _ctxClose, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') _ctxClose(); });
// ── Tree helpers used by the context menu ─────────────────────────────────
// Group the currently-selected parts into a new group. Re-uses the dnd
// "create group from rows" pathway (which already handles hier vs userGroups
// modes correctly). Falls back to flat behaviour automatically.
function _treeGroupSelected() {
  const sel = [...state.selected];
  if (sel.length < 2) { toast('Select 2+ parts', 'Group needs at least two parts', 'warn'); return; }
  const treeEl = $('tree');
  const rows = [];
  for (const id of sel) {
    const r = treeEl?.querySelector(`.tree-node[data-part-id="${id}"]`);
    if (r) rows.push(r);
  }
  if (!rows.length) { toast('No tree rows', 'Selected parts are not visible in the tree', 'warn'); return; }
  const ctx = (typeof _dndContext === 'function') ? _dndContext() : 'flat';
  _dndDoNewGroupFromRows(rows, ctx);
  // Hier path doesn't rebuild — make sure the new group is rendered.
  if (ctx === 'hier') rebuildTree();
}

// Dissolve a group: hier groups promote their children to the parent depth;
// userGroups are reparented back under partsRoot via removeUserGroup.
function _treeUngroupRow(row) {
  if (!row || !row.dataset.groupId) return;
  const gid = parseInt(row.dataset.groupId, 10);
  if (Number.isNaN(gid)) return;
  // userGroups branch.
  const ug = (state.userGroups || []).find(g => g.id === gid);
  if (ug) { removeUserGroup(gid); return; }
  // hier branch.
  const all = state.treeNodes || [];
  const idx = all.findIndex(n => n.kind === 'group' && n.id === gid);
  if (idx < 0) { toast('Cannot ungroup', 'Group not found', 'warn'); return; }
  const grpNode = all[idx];
  const baseDepth = grpNode.depth;
  // Collect children = subsequent nodes whose depth > baseDepth, until we drop
  // back to baseDepth or shallower.
  let endExclusive = all.length;
  for (let i = idx + 1; i < all.length; i++) {
    if (all[i].depth <= baseDepth) { endExclusive = i; break; }
  }
  if (endExclusive === idx + 1) {
    // Empty group — just delete the node and its scene-graph object.
    all.splice(idx, 1);
    if (grpNode.obj3d?.parent) grpNode.obj3d.parent.remove(grpNode.obj3d);
    rebuildTree();
    return;
  }
  // Move scene-graph children back into the group's parent obj3d (or partsRoot).
  let hostObj = state.partsRoot;
  if (grpNode.parentId != null) {
    const pn = all.find(n => n.kind === 'group' && n.id === grpNode.parentId);
    if (pn?.obj3d) hostObj = pn.obj3d;
  }
  if (grpNode.obj3d) {
    // Reparent every direct THREE.js child of the group, preserving world
    // transforms via Object3D.attach.
    const kids = [...grpNode.obj3d.children];
    for (const k of kids) hostObj.attach(k);
    if (grpNode.obj3d.parent) grpNode.obj3d.parent.remove(grpNode.obj3d);
  }
  // Direct children's parentId points at the dissolved group → bump them up to
  // the group's parent. All children (direct or nested) lose one level of depth.
  for (let i = idx + 1; i < endExclusive; i++) {
    const n = all[i];
    if (n.depth === baseDepth + 1) n.parentId = grpNode.parentId;
    n.depth -= 1;
  }
  // Finally remove the dissolved group node itself.
  all.splice(idx, 1);
  rebuildTree();
  // Promoted children visible in the tree — no toast.
}

// Hard-delete a group + everything inside it (recursive). For empty groups
// this is just node removal — no confirm. For non-empty groups we route
// through deleteParts so the operation is undoable like every other delete,
// and the group itself is dissolved automatically once it ends up empty.
async function _treeDeleteGroup(row) {
  if (!row || !row.dataset.groupId) return;
  const gid = parseInt(row.dataset.groupId, 10);
  if (Number.isNaN(gid)) return;
  // userGroup branch.
  const ug = (state.userGroups || []).find(g => g.id === gid);
  if (ug) {
    const ids = [...(ug.partIds || [])];
    if (ids.length === 0) { removeUserGroup(gid); return; }
    // deleteParts removes the now-empty userGroup automatically (the cleanup
    // pass we added there). No need to call removeUserGroup here. Reversible
    // via Ctrl+Z, so we skip the confirm prompt.
    deleteParts(ids, `Deleted group "${ug.name}"`);
    return;
  }
  // hier branch — collect every part descendant.
  const all = state.treeNodes || [];
  const idx = all.findIndex(n => n.kind === 'group' && n.id === gid);
  if (idx < 0) { toast('Cannot delete', 'Group not found', 'warn'); return; }
  const grpNode = all[idx];
  const baseDepth = grpNode.depth;
  const partIds = [];
  for (let i = idx + 1; i < all.length; i++) {
    if (all[i].depth <= baseDepth) break;
    if (all[i].kind === 'part' && all[i].partId != null) {
      const p = getPart(all[i].partId);
      if (p && !p.deleted) partIds.push(p.partId);
    }
  }
  if (partIds.length === 0) {
    // Empty group — just drop the node + its scene-graph object.
    all.splice(idx, 1);
    if (grpNode.obj3d?.parent) grpNode.obj3d.parent.remove(grpNode.obj3d);
    rebuildTree();
    toast('Group deleted', 'Empty group removed', 'success');
    return;
  }
  // Reversible via Ctrl+Z — no confirm prompt.
  deleteParts(partIds, `Deleted group "${grpNode.name}"`);
  // The group node itself stays in state.treeNodes but is rendered hidden
  // automatically (groupAnyAlive=false now), so no extra cleanup needed.
}

async function _treeRenameRow(row) {
  if (!row || !row.dataset.groupId) return;
  const gid = parseInt(row.dataset.groupId, 10);
  if (Number.isNaN(gid)) return;
  const ug = (state.userGroups || []).find(g => g.id === gid);
  const cur = ug ? ug.name : (state.treeNodes?.find(n => n.kind === 'group' && n.id === gid)?.name || '');
  const next = await appPrompt('Rename group:', cur, { title: 'Rename group', okLabel: 'Rename' });
  if (next == null) return;
  const trimmed = String(next).trim();
  if (!trimmed || trimmed === cur) return;
  if (ug) { renameUserGroup(gid, trimmed); return; }
  const node = state.treeNodes?.find(n => n.kind === 'group' && n.id === gid);
  if (node) {
    node.name = trimmed;
    if (node.obj3d) node.obj3d.name = trimmed;
    rebuildTree();
  }
}

function _treeSelectGroupParts(row, mode = 'single') {
  if (!row || !row.dataset.groupId) return;
  const rawGid = row.dataset.groupId;
  // userGroup ids are strings ('_ug_xxx'); hier-group ids are integers.
  // Try userGroup match by string first — parseInt would yield NaN here
  // and the function used to bail out, leaving the right-click "Select
  // group parts" action silently broken on userGroups.
  const ugByStr = (state.userGroups || []).find(g => String(g.id) === String(rawGid));
  if (ugByStr) { selectGroup(ugByStr.id, mode); return; }
  const gid = parseInt(rawGid, 10);
  if (Number.isNaN(gid)) return;
  // Hier group → collect every descendant part id and select.
  const all = state.treeNodes || [];
  const idx = all.findIndex(n => n.kind === 'group' && n.id === gid);
  if (idx < 0) return;
  const baseDepth = all[idx].depth;
  if (mode === 'single') state.selected.clear();
  for (let i = idx + 1; i < all.length; i++) {
    const n = all[i];
    if (n.depth <= baseDepth) break;
    if (n.kind === 'part') {
      if (mode === 'toggle' && state.selected.has(n.partId)) state.selected.delete(n.partId);
      else state.selected.add(n.partId);
    }
  }
  applySelectionColors(); rebuildTreeSelectionOnly(); refreshPropertiesPanel();
  if (typeof updateGizmo === 'function') updateGizmo();
  $('del-sel-count').textContent = state.selected.size;
  requestRender();
}

function _treeExpandAll() {
  if (!state.treeCollapsed?.size) return;
  state.treeCollapsed.clear();
  for (const ug of (state.userGroups || [])) ug.expanded = true;
  rebuildTree();
}
function _treeCollapseAll() {
  if (!state.treeNodes?.length && !state.userGroups?.length) return;
  if (state.treeNodes?.length) {
    for (const n of state.treeNodes) if (n.kind === 'group') state.treeCollapsed.add(n.id);
  }
  for (const ug of (state.userGroups || [])) ug.expanded = false;
  rebuildTree();
}

// Site-wide kill switch for the browser's native right-click menu. Custom
// context menus (tree nodes, viewport, materials list, etc.) are wired below
// and continue to receive the event because preventDefault does not stop
// propagation. Registered at window capture so it runs before everything else.
//
// Carve-out: editable form fields (transform-panel inputs, search boxes,
// renames, etc.) keep the native context menu so the user gets the usual
// Copy / Cut / Paste / Select-all / spell-check commands. Without this,
// every text input in the app loses its right-click affordance — which
// surprises anyone who reaches for it on a numeric field in the transform
// panel.
window.addEventListener('contextmenu', e => {
  const t = e.target;
  if (t && (
        t.tagName === 'INPUT' ||
        t.tagName === 'TEXTAREA' ||
        t.tagName === 'SELECT' ||
        t.isContentEditable
      )) {
    return; // let the browser show its native menu
  }
  e.preventDefault();
}, { capture: true });

document.addEventListener('contextmenu', e => {
  const node = e.target.closest('.tree-node');
  if (!node) return;
  e.preventDefault();

  // Group row branch ------------------------------------------------------
  if (node.dataset.groupId) {
    const items = [
      { icon: 'check',          label: 'Select group parts',         fn: () => _treeSelectGroupParts(node, 'single') },
      { icon: 'plus-circle',    label: 'Add group parts to selection', fn: () => _treeSelectGroupParts(node, 'toggle') },
      { icon: 'crosshair',      label: 'Frame group',                fn: () => { _treeSelectGroupParts(node, 'single'); frameSelected?.(); } },
      '---',
      { icon: 'pencil',         label: 'Rename group',               fn: () => _treeRenameRow(node) },
      { icon: 'folder-x',       label: 'Ungroup',                    fn: () => _treeUngroupRow(node) },
      { icon: 'trash-2',        label: 'Delete group + contents',    danger: true, fn: () => _treeDeleteGroup(node) },
      '---',
      { icon: 'eye',            label: 'Toggle visibility',          fn: () => {
          if (node.dataset.groupId && state.userGroups?.find(g => g.id === parseInt(node.dataset.groupId, 10))) {
            toggleGroupVisibility(parseInt(node.dataset.groupId, 10));
          } else {
            _treeSelectGroupParts(node, 'single');
            const anyVisible = [...state.selected].some(id => { const p = getPart(id); return p && p.visible; });
            for (const id of state.selected) {
              const p = getPart(id); if (!p) continue;
              p.visible = !anyVisible; if (p.mesh) p.mesh.visible = p.visible;
            }
            rebuildTree(); requestRender();
          }
        }
      },
      '---',
      { icon: 'chevrons-down', label: 'Expand all groups',          fn: _treeExpandAll },
      { icon: 'chevrons-up',   label: 'Collapse all groups',        fn: _treeCollapseAll },
    ];
    _ctxBuild(items, e.clientX, e.clientY);
    return;
  }

  // Part row branch -------------------------------------------------------
  const id = parseInt(node.dataset.partId, 10);
  const p = getPart(id);
  if (!p) return;
  if (!state.selected.has(id)) selectPart(id, 'single');
  const selSize = state.selected.size;
  const items = [
    { icon: 'crosshair',      label: `Frame selected${selSize > 1 ? ` (${selSize})` : ''}`, fn: frameSelected },
    { icon: 'focus',          label: 'Isolate',                fn: isolateSelected },
    { icon: 'eye',            label: 'Toggle visibility',      fn: () => { p.visible = !p.visible; if (p.mesh) p.mesh.visible = p.visible; rebuildTree(); } },
    { icon: 'eye-off',        label: 'Hide unselected',        fn: hideUnselected },
    { icon: 'circle-plus',    label: 'Show all',               fn: showAllParts },
    '---',
    { icon: 'shapes',         label: 'Select similar shape',   fn: selectSimilar },
    { icon: 'palette',        label: 'Select same color',      fn: selectByColor },
    '---',
    { icon: 'folder-plus',    label: `Group selected${selSize > 1 ? ` (${selSize})` : ''}`, fn: _treeGroupSelected },
    { icon: 'combine',        label: 'Merge selected',         fn: () => mergeSelectedIntoOne?.() },
    '---',
    { icon: p.locked ? 'unlock' : 'lock', label: p.locked ? 'Unlock' : 'Lock', fn: () => { for (const sid of state.selected) { const sp = getPart(sid); if (sp) sp.locked = !sp.locked; } rebuildTree(); /* lock state visible in tree row — no toast */ } },
    { icon: 'wand-2',         label: 'Smart fit selected',     fn: () => smartFitSelection('smart') },
    { icon: 'square',         label: 'Force AABB box',         fn: () => smartFitSelection('aabb') },
    { icon: 'rotate-3d',      label: 'Force OBB box',          fn: () => smartFitSelection('obb') },
    { icon: 'cylinder',       label: 'Force cylinder',         fn: () => smartFitSelection('cyl') },
    '---',
    { icon: 'chevrons-down',  label: 'Expand all groups',      fn: _treeExpandAll },
    { icon: 'chevrons-up',    label: 'Collapse all groups',    fn: _treeCollapseAll },
    '---',
    { icon: 'trash-2',        label: 'Delete',                 danger: true, fn: () => deleteParts([...state.selected], 'Deleted via context menu') },
  ];
  _ctxBuild(items, e.clientX, e.clientY);
});

// ─── Selection history (back/forward)
const _origSelectPart = selectPart;
selectPart = function(partId, mode) {
  _origSelectPart(partId, mode);
  // Truncate any forward history; push new state
  state.selHistory = state.selHistory.slice(0, state.selHistoryIdx + 1);
  state.selHistory.push([...state.selected]);
  if (state.selHistory.length > 50) state.selHistory.shift();
  state.selHistoryIdx = state.selHistory.length - 1;
};
function selectionBack() {
  if (state.selHistoryIdx <= 0) return toast('No earlier selection', '', 'info');
  state.selHistoryIdx--;
  state.selected = new Set(state.selHistory[state.selHistoryIdx]);
  applySelectionColors(); rebuildTreeSelectionOnly(); refreshPropertiesPanel();
  if (typeof updateGizmo === 'function') updateGizmo();
  $('del-sel-count').textContent = state.selected.size;
}
function selectionFwd() {
  if (state.selHistoryIdx >= state.selHistory.length - 1) return toast('No forward selection', '', 'info');
  state.selHistoryIdx++;
  state.selected = new Set(state.selHistory[state.selHistoryIdx]);
  applySelectionColors(); rebuildTreeSelectionOnly(); refreshPropertiesPanel();
  if (typeof updateGizmo === 'function') updateGizmo();
  $('del-sel-count').textContent = state.selected.size;
}

// ─── Hide unselected
function hideUnselected() {
  if (state.selected.size === 0) return toast('Nothing selected', '', 'warn');
  for (const p of state.parts) {
    if (p.deleted) continue;
    p.visible = state.selected.has(p.partId);
    if (p.mesh) p.mesh.visible = p.visible;
  }
  rebuildTree();
  // Visibility change is visible in the viewport — no toast.
}

// ============== LOOSE-PARTS SPLITTER ==============
//
// Detect geometrically disconnected components ("loose parts") inside a single
// fused mesh and split it into N independent meshes. Two solids that share
// welded vertices (true CAD booleans) cannot be separated — topologically
// they're one body. For meshes that are just multiple bodies stored as one
// (common when STEP exporters flatten an assembly or when a converter merges
// sibling solids), this recovers the originals.
//
// Algorithm: position-welded union-find. Quantize vertex positions to an ε
// grid (relative to the model's bbox diagonal so it's scale-invariant), build
// vertex→canonical-index map, union the three canonical indices of each
// triangle, then group triangles by component root.

if (!state._splitUndo) state._splitUndo = [];

// Build canonical vertex IDs for a geometry. Two modes:
//   epsAbs <= 0: NO welding. Each vertex index is its own canon — connectivity
//      reflects the index buffer literally. This is what most CAD STEP exports
//      need: each tessellated solid has its own vertex copies for boundary
//      points, so the union-find finds the original solids without false
//      bridges.
//   epsAbs >  0: weld vertices whose coordinates round to the same ε grid
//      bucket. Use this to MERGE near-touching solids on purpose, or to fix
//      within-a-solid float drift.
// For non-indexed geometry we always need at least exact-match welding
// (epsAbs=0 falls back to a tiny epsilon) — without it every triangle would
// be its own component since each tri owns 3 unique vertex slots.
function _splitBuildCanon(geom, epsAbs) {
  const pos = geom.attributes.position;
  const idxAttr = geom.index;
  const positions = pos.array;
  const vertCount = pos.count;
  const canon = new Uint32Array(vertCount);

  // Pure index-based path: only valid for indexed geometry (where the index
  // buffer dictates which triangles share vertices). For non-indexed geom we
  // must collapse exact-position duplicates, otherwise no two triangles ever
  // share a canon and the result is one component per triangle.
  const noWeld = (epsAbs <= 0) && !!idxAttr;
  if (noWeld) {
    for (let i = 0; i < vertCount; i++) canon[i] = i;
    return { canon, N: vertCount };
  }
  // Welding path. For "exact match only" use a sub-machine-epsilon grid.
  const eps = epsAbs > 0 ? epsAbs : 1e-12;
  const inv = 1 / eps;
  const map = new Map();
  let nextCanon = 0;
  for (let v = 0; v < vertCount; v++) {
    const x = Math.round(positions[v * 3] * inv);
    const y = Math.round(positions[v * 3 + 1] * inv);
    const z = Math.round(positions[v * 3 + 2] * inv);
    const key = x + ',' + y + ',' + z;
    let c = map.get(key);
    if (c === undefined) { c = nextCanon++; map.set(key, c); }
    canon[v] = c;
  }
  return { canon, N: nextCanon };
}

function _splitMeshLooseParts(geom, epsAbs) {
  const pos = geom.attributes.position;
  if (!pos) return null;
  const idxAttr = geom.index;
  const positions = pos.array;
  const vertCount = pos.count;

  const built = _splitBuildCanon(geom, epsAbs);
  const canon = built.canon;
  const N = built.N;
  const parent = new Uint32Array(N);
  for (let i = 0; i < N; i++) parent[i] = i;
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };

  const triCount = ((idxAttr ? idxAttr.count : vertCount) / 3) | 0;
  const idxArr = idxAttr ? idxAttr.array : null;
  for (let t = 0; t < triCount; t++) {
    const i0 = idxArr ? idxArr[t * 3]     : t * 3;
    const i1 = idxArr ? idxArr[t * 3 + 1] : t * 3 + 1;
    const i2 = idxArr ? idxArr[t * 3 + 2] : t * 3 + 2;
    uni(canon[i0], canon[i1]);
    uni(canon[i1], canon[i2]);
  }

  // Bucket triangle indices by component root.
  const compTris = new Map();
  for (let t = 0; t < triCount; t++) {
    const v0 = idxArr ? idxArr[t * 3] : t * 3;
    const r = find(canon[v0]);
    let arr = compTris.get(r);
    if (!arr) { arr = []; compTris.set(r, arr); }
    arr.push(t);
  }
  if (compTris.size <= 1) return null;

  // Build per-component BufferGeometry, copying optional attributes.
  const normalAttr = geom.attributes.normal;
  const uvAttr = geom.attributes.uv;
  const colorAttr = geom.attributes.color;
  const colItem = colorAttr ? (colorAttr.itemSize || 3) : 0;

  const out = [];
  for (const tris of compTris.values()) {
    const remap = new Map();
    const newPos = [];
    const newNorm = normalAttr ? [] : null;
    const newUv = uvAttr ? [] : null;
    const newCol = colorAttr ? [] : null;
    const newIdx = [];
    const emit = (origV) => {
      let n = remap.get(origV);
      if (n === undefined) {
        n = newPos.length / 3;
        remap.set(origV, n);
        newPos.push(positions[origV*3], positions[origV*3+1], positions[origV*3+2]);
        if (newNorm) newNorm.push(normalAttr.array[origV*3], normalAttr.array[origV*3+1], normalAttr.array[origV*3+2]);
        if (newUv) newUv.push(uvAttr.array[origV*2], uvAttr.array[origV*2+1]);
        if (newCol) {
          const off = origV * colItem;
          for (let k = 0; k < colItem; k++) newCol.push(colorAttr.array[off + k]);
        }
      }
      return n;
    };
    for (const t of tris) {
      const a = idxArr ? idxArr[t*3]     : t*3;
      const b = idxArr ? idxArr[t*3 + 1] : t*3 + 1;
      const c = idxArr ? idxArr[t*3 + 2] : t*3 + 2;
      newIdx.push(emit(a), emit(b), emit(c));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(newPos, 3));
    if (newNorm) g.setAttribute('normal', new THREE.Float32BufferAttribute(newNorm, 3));
    if (newUv)   g.setAttribute('uv',     new THREE.Float32BufferAttribute(newUv, 2));
    if (newCol)  g.setAttribute('color',  new THREE.Float32BufferAttribute(newCol, colItem));
    const vN = newPos.length / 3;
    g.setIndex(vN > 65535
      ? new THREE.BufferAttribute(new Uint32Array(newIdx), 1)
      : new THREE.BufferAttribute(new Uint16Array(newIdx), 1));
    if (!normalAttr) g.computeVertexNormals();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    out.push(g);
  }
  return out;
}

// epsRel is fraction of model bbox diagonal. 1e-4 (default) ≈ 0.01% of diag.
function _splitEpsAbs(epsRel) {
  const diag = Math.max(state.modelDiag || 1, 1e-6);
  return diag * epsRel;
}

function _splitOnePart(part, epsRel, method) {
  if (!part || part.deleted || !part.mesh) return 0;     // skip InstancedMesh members
  if (part._splitInto) return 0;                          // already split
  const eps = _splitEpsAbs(epsRel);
  const geoms = _splitDispatch(method || 'vertex', part.mesh.geometry, eps);
  if (!geoms || geoms.length <= 1) return 0;

  // If the mesh is currently captured by the gizmo pivot, return it to
  // partsRoot first so origParent isn't a transient gizmo node — otherwise
  // the split children would inherit the pivot as their parent and travel
  // with the gizmo on later interactions.
  if (state.pivot && part.mesh.parent === state.pivot) {
    state.partsRoot.attach(part.mesh);   // preserves world transform
  }
  // Snapshot world + local transforms BEFORE we detach the mesh.
  part.mesh.updateMatrixWorld(true);
  const origParent = part.mesh.parent || state.partsRoot;
  const localPos  = part.mesh.position.clone();
  const localQuat = part.mesh.quaternion.clone();
  const localScl  = part.mesh.scale.clone();
  const worldM    = part.mesh.matrixWorld.clone();

  // Drop the cached EdgesGeometry for the original — its mesh is going away.
  _disposeEdgesFor(part.mesh.geometry);

  // removeFromParent() is more reliable than parent.remove(child) — works even
  // if the parent reference got out of sync via .attach() somewhere upstream.
  part.mesh.removeFromParent();
  // Tear down any selection-highlight LineSegments that were children of the
  // detached mesh — they'd otherwise leak with the stash.
  for (let i = part.mesh.children.length - 1; i >= 0; i--) {
    const ch = part.mesh.children[i];
    if (ch.isLineSegments || ch.isMesh && ch.material === _FLAG_FILL_MAT) part.mesh.remove(ch);
  }
  part.deleted = true;
  part.visible = false;
  part._splitInto = [];
  part._splitStashedMesh = part.mesh;
  part._splitOrigParent = origParent;

  const baseId = state.parts.reduce((m, p) => Math.max(m, p.partId), 0) + 1;
  let i = 0;
  for (const g of geoms) {
    const childId = baseId + i;
    const tris = ((g.index ? g.index.count : g.attributes.position.count) / 3) | 0;
    const verts = g.attributes.position.count;
    const bbox = g.boundingBox.clone().applyMatrix4(worldM);
    const sz = bbox.getSize(new THREE.Vector3());

    const mat = getOrCreateMaterial(part.originalColor);
    const m = new THREE.Mesh(g, mat);
    m.name = (part.name || ('part_' + part.partId)) + '__p' + (i + 1);
    m.userData.partId = childId;
    m.position.copy(localPos);
    m.quaternion.copy(localQuat);
    m.scale.copy(localScl);
    origParent.add(m);

    state.parts.push({
      partId: childId, name: m.name, hash: g.uuid,
      triCount: tris, vertCount: verts, bbox,
      sizeMetrics: { diag: sz.length(), vol: sz.x * sz.y * sz.z, max: Math.max(sz.x, sz.y, sz.z) },
      visible: true, deleted: false, flagged: false,
      originalColor: part.originalColor.clone(),
      mesh: m, group: null, instanceIndex: -1, instancedMesh: null,
      _splitFromId: part.partId,
    });
    state.geomByHash.set(g.uuid, g);
    part._splitInto.push(childId);
    i++;
  }

  // Tree update: hierarchical models render from state.treeNodes (DFS-flat
  // array), not state.parts. Without inserting nodes here the new child
  // parts exist in the scene + selection layer but never appear in the left
  // sidebar — user reported "can't locate new split geo".
  // Insert child rows right after the parent's row at depth+1, parented to
  // the parent's parent (so children take the parent's slot in the tree).
  // The parent's tree row stays put but gets filtered out automatically by
  // the renderer because its underlying part is now p.deleted = true.
  if (state.treeNodes && state.treeNodes.length && part._splitInto && part._splitInto.length) {
    const idx = state.treeNodes.findIndex(n => n.kind === 'part' && n.partId === part.partId);
    if (idx >= 0) {
      const parentNode = state.treeNodes[idx];
      const inserts = part._splitInto.map((cid) => ({
        id: cid, kind: 'part',
        name: getPart(cid)?.name || ('part_' + cid),
        depth: parentNode.depth,
        parentId: parentNode.parentId,
        partId: cid,
        instanceCount: 0,
        obj3d: getPart(cid)?.mesh || null,
      }));
      state.treeNodes.splice(idx + 1, 0, ...inserts);
    } else {
      // Parent wasn't in the tree (rare — reachable via flat-tree mode that
      // never built treeNodes). Append at top level so children are visible.
      for (const cid of part._splitInto) {
        state.treeNodes.push({
          id: cid, kind: 'part',
          name: getPart(cid)?.name || ('part_' + cid),
          depth: 0, parentId: null, partId: cid,
          instanceCount: 0,
          obj3d: getPart(cid)?.mesh || null,
        });
      }
    }
  }

  return geoms.length;
}

function _undoSplitBatch(batch) {
  if (!batch) return;
  for (const item of batch) {
    const parent = getPart(item.parentId);
    if (!parent) continue;
    for (const cid of item.childIds) {
      const c = state.parts.find(p => p.partId === cid);
      if (!c) continue;
      if (c.mesh && c.mesh.parent) c.mesh.parent.remove(c.mesh);
      try { c.mesh?.geometry?.dispose?.(); } catch (e) {}
      c._removed = true;
    }
    state.parts = state.parts.filter(p => !p._removed);
    // Mirror the part removal in state.treeNodes — _splitOnePart inserted
    // child entries there, so undo has to peel them back out or the
    // hierarchical tree carries phantom rows after revert.
    if (state.treeNodes && state.treeNodes.length && item.childIds && item.childIds.length) {
      const childSet = new Set(item.childIds);
      state.treeNodes = state.treeNodes.filter(n => !(n.kind === 'part' && childSet.has(n.partId)));
    }
    if (parent._splitStashedMesh) {
      const par = parent._splitOrigParent || state.partsRoot;
      par.add(parent._splitStashedMesh);
      parent.mesh = parent._splitStashedMesh;
    }
    parent.deleted = false;
    parent.visible = true;
    delete parent._splitInto;
    delete parent._splitStashedMesh;
    delete parent._splitOrigParent;
  }
}

function splitSelectedParts(epsRel, method) {
  if (state.selected.size === 0) { toast('Select a mesh first', 'Click a part in the viewport or tree.', 'warn'); return; }
  // Detach the gizmo before split — otherwise selected meshes are parented
  // under state.pivot and origParent ends up being the pivot, dragging split
  // children around with later gizmo interactions.
  _detachGizmo();
  const ids = [...state.selected];
  let scanned = 0, total = 0;
  const undoBatch = [];
  for (const id of ids) {
    const p = getPart(id);
    if (!p) continue;
    scanned++;
    const out = _splitOnePart(p, epsRel, method);
    if (out > 0) {
      undoBatch.push({ parentId: p.partId, childIds: p._splitInto.slice() });
      total += out;
    }
  }
  if (total === 0) {
    toast('No separable parts found', `Scanned ${scanned} mesh${scanned===1?'':'es'} — single connected solids at this tolerance.`, 'info');
    return;
  }
  pushUndo({ type: 'split', batch: undoBatch, label: 'Split mesh' });
  state.selected.clear();
  $('del-sel-count').textContent = 0;
  state._explodeBaselineDone = false;     // recompute centroids w/ new parts
  // Force world-matrix recompute so freshly-added child meshes have correct
  // worldMatrix on the very next frame (partsRoot has matrixAutoUpdate=false).
  state.partsRoot.updateMatrixWorld(true);
  _reindexParts(); recomputeStats(); refreshFlagged(); rebuildTree();
  // applySelectionColors clears any stale highlight LineSegments left over
  // from the now-deleted parent mesh (state.activeHighlights tracks them
  // across operations).
  applySelectionColors();
  // Build BVHs for the freshly-spawned child geoms so the very first pick
  // after split is fast.
  _buildBVHsForAllGeoms();
  toast('Split complete', `${undoBatch.length} mesh${undoBatch.length===1?'':'es'} → ${total} parts`, 'success');
  requestRender();
}

function splitAllParts(epsRel, method) {
  _detachGizmo();
  // Snapshot before iterating so freshly-spawned children aren't re-scanned.
  const candidates = state.parts.filter(p => !p.deleted && p.mesh && !p._splitInto);
  let scanned = 0, total = 0;
  const undoBatch = [];
  for (const p of candidates) {
    scanned++;
    const out = _splitOnePart(p, epsRel, method);
    if (out > 0) { undoBatch.push({ parentId: p.partId, childIds: p._splitInto.slice() }); total += out; }
  }
  if (total === 0) {
    toast('No separable parts found', `Scanned ${scanned} meshes — all are single connected solids at this tolerance.`, 'info');
    return;
  }
  pushUndo({ type: 'split', batch: undoBatch, label: 'Split all meshes' });
  state.selected.clear();
  state._explodeBaselineDone = false;
  state.partsRoot.updateMatrixWorld(true);
  _reindexParts(); recomputeStats(); refreshFlagged(); rebuildTree();
  applySelectionColors();
  _buildBVHsForAllGeoms();   // new child geoms need BVHs for picking
  toast('Split complete', `${undoBatch.length} of ${scanned} mesh${scanned===1?'':'es'} → ${total} parts`, 'success');
  requestRender();
}

// Slider value is the log10 of epsRel: -7 → 1e-7, -2 → 1e-2.
function _splitEpsFromSlider(v) { return Math.pow(10, parseFloat(v)); }
function _splitFmtEps(epsRel) { return epsRel >= 1e-3 ? epsRel.toFixed(4) : epsRel.toExponential(0); }

// Count-only fast path of _splitMeshLooseParts — same union-find, but
// returns just the component count and aborts as soon as we know there's
// more than one. Used for the live preview in the splitter UI; full geom
// build only runs when the user actually clicks Split.
// ════════════════════════════════════════════════════════════════════════
// ALTERNATIVE SPLIT ALGORITHMS
// ════════════════════════════════════════════════════════════════════════
// All return triangle-index arrays grouped by component (or null if there's
// only one component). The downstream geometry-build step in
// _splitMeshLooseParts is reused via _splitBuildGeomsFromTriBuckets so each
// algorithm only has to do the partitioning.
// ────────────────────────────────────────────────────────────────────────

// Helper used by every alternative algorithm — same per-component geometry
// build that _splitMeshLooseParts had inlined. Pulled out so all four
// algorithms produce identical output objects.
function _splitBuildGeomsFromTriBuckets(geom, triBuckets) {
  if (!triBuckets || triBuckets.size <= 1) return null;
  const pos = geom.attributes.position;
  const positions = pos.array;
  const idxAttr = geom.index;
  const idxArr = idxAttr ? idxAttr.array : null;
  const normalAttr = geom.attributes.normal;
  const uvAttr = geom.attributes.uv;
  const colorAttr = geom.attributes.color;
  const colItem = colorAttr ? (colorAttr.itemSize || 3) : 0;
  const out = [];
  for (const tris of triBuckets.values()) {
    const remap = new Map();
    const newPos = [];
    const newNorm = normalAttr ? [] : null;
    const newUv = uvAttr ? [] : null;
    const newCol = colorAttr ? [] : null;
    const newIdx = [];
    const emit = (origV) => {
      let n = remap.get(origV);
      if (n === undefined) {
        n = newPos.length / 3;
        remap.set(origV, n);
        newPos.push(positions[origV*3], positions[origV*3+1], positions[origV*3+2]);
        if (newNorm) newNorm.push(normalAttr.array[origV*3], normalAttr.array[origV*3+1], normalAttr.array[origV*3+2]);
        if (newUv) newUv.push(uvAttr.array[origV*2], uvAttr.array[origV*2+1]);
        if (newCol) {
          const off = origV * colItem;
          for (let k = 0; k < colItem; k++) newCol.push(colorAttr.array[off + k]);
        }
      }
      return n;
    };
    for (const t of tris) {
      const a = idxArr ? idxArr[t*3]     : t*3;
      const b = idxArr ? idxArr[t*3 + 1] : t*3 + 1;
      const c = idxArr ? idxArr[t*3 + 2] : t*3 + 2;
      newIdx.push(emit(a), emit(b), emit(c));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(newPos, 3));
    if (newNorm) g.setAttribute('normal', new THREE.Float32BufferAttribute(newNorm, 3));
    if (newUv)   g.setAttribute('uv',     new THREE.Float32BufferAttribute(newUv, 2));
    if (newCol)  g.setAttribute('color',  new THREE.Float32BufferAttribute(newCol, colItem));
    const vN = newPos.length / 3;
    g.setIndex(vN > 65535
      ? new THREE.BufferAttribute(new Uint32Array(newIdx), 1)
      : new THREE.BufferAttribute(new Uint16Array(newIdx), 1));
    if (!normalAttr) g.computeVertexNormals();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    out.push(g);
  }
  return out;
}

// Helper: triangle-level union-find with shared infrastructure.
function _splitTriUnionFind(triCount) {
  const parent = new Uint32Array(triCount);
  for (let i = 0; i < triCount; i++) parent[i] = i;
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
  return { parent, find, uni };
}

// Group triangles into Map<rootId, [triIndex...]> from a triangle-level
// union-find. Used by every algorithm that operates on triangle parents.
function _splitBucketByTriRoot(triCount, find) {
  const buckets = new Map();
  for (let t = 0; t < triCount; t++) {
    const r = find(t);
    let arr = buckets.get(r);
    if (!arr) { arr = []; buckets.set(r, arr); }
    arr.push(t);
  }
  return buckets;
}

// 1. EDGE-CONNECTIVITY ─────────────────────────────────────────────────────
// Two triangles join only if they share a full edge (2 vertices), not just
// a single corner vertex. Keeps separate solids that meet at a single point
// or knife-edge from being merged. Vertex-canon respects the same epsAbs
// rules as the vertex-connectivity algorithm.
function _splitMeshEdgeConnectivity(geom, epsAbs) {
  const pos = geom.attributes.position;
  if (!pos) return null;
  const idxAttr = geom.index;
  const vertCount = pos.count;
  const built = _splitBuildCanon(geom, epsAbs);
  const canon = built.canon;
  const triCount = ((idxAttr ? idxAttr.count : vertCount) / 3) | 0;
  const idxArr = idxAttr ? idxAttr.array : null;
  // Build edge → list-of-triangles map. Edge key is the canonical pair
  // (lo, hi) joined by ',' so direction is irrelevant.
  const edgeMap = new Map();
  const _push = (key, t) => {
    const arr = edgeMap.get(key);
    if (arr) arr.push(t); else edgeMap.set(key, [t]);
  };
  for (let t = 0; t < triCount; t++) {
    const i0 = canon[idxArr ? idxArr[t * 3]     : t * 3];
    const i1 = canon[idxArr ? idxArr[t * 3 + 1] : t * 3 + 1];
    const i2 = canon[idxArr ? idxArr[t * 3 + 2] : t * 3 + 2];
    _push(Math.min(i0, i1) + ',' + Math.max(i0, i1), t);
    _push(Math.min(i1, i2) + ',' + Math.max(i1, i2), t);
    _push(Math.min(i0, i2) + ',' + Math.max(i0, i2), t);
  }
  const uf = _splitTriUnionFind(triCount);
  for (const tris of edgeMap.values()) {
    if (tris.length < 2) continue;
    const t0 = tris[0];
    for (let k = 1; k < tris.length; k++) uf.uni(t0, tris[k]);
  }
  const buckets = _splitBucketByTriRoot(triCount, uf.find);
  return _splitBuildGeomsFromTriBuckets(geom, buckets);
}

function _splitMeshEdgeConnectivityCount(geom, epsAbs) {
  const pos = geom.attributes && geom.attributes.position;
  if (!pos) return 0;
  const idxAttr = geom.index;
  const vertCount = pos.count;
  const built = _splitBuildCanon(geom, epsAbs);
  const canon = built.canon;
  const triCount = ((idxAttr ? idxAttr.count : vertCount) / 3) | 0;
  const idxArr = idxAttr ? idxAttr.array : null;
  const edgeMap = new Map();
  const _push = (key, t) => {
    const arr = edgeMap.get(key);
    if (arr) arr.push(t); else edgeMap.set(key, [t]);
  };
  for (let t = 0; t < triCount; t++) {
    const i0 = canon[idxArr ? idxArr[t * 3]     : t * 3];
    const i1 = canon[idxArr ? idxArr[t * 3 + 1] : t * 3 + 1];
    const i2 = canon[idxArr ? idxArr[t * 3 + 2] : t * 3 + 2];
    _push(Math.min(i0, i1) + ',' + Math.max(i0, i1), t);
    _push(Math.min(i1, i2) + ',' + Math.max(i1, i2), t);
    _push(Math.min(i0, i2) + ',' + Math.max(i0, i2), t);
  }
  const uf = _splitTriUnionFind(triCount);
  for (const tris of edgeMap.values()) {
    if (tris.length < 2) continue;
    const t0 = tris[0];
    for (let k = 1; k < tris.length; k++) uf.uni(t0, tris[k]);
  }
  const roots = new Set();
  for (let t = 0; t < triCount; t++) roots.add(uf.find(t));
  return roots.size;
}

// 2. SPATIAL-AABB CLUSTERING ───────────────────────────────────────────────
// Bucket triangles into a 3D grid by their bounding box. Two triangles whose
// AABBs overlap (share a cell) are unioned. Doesn't read the index buffer at
// all — useful when the source has fused topology between solids that are
// still spatially separate. cellSize is in absolute model units.
function _splitMeshSpatialAABB(geom, cellSize) {
  if (!cellSize || cellSize <= 0) cellSize = (state.modelDiag || 1) * 1e-3;
  const pos = geom.attributes.position;
  if (!pos) return null;
  const idxAttr = geom.index;
  const vertCount = pos.count;
  const positions = pos.array;
  const triCount = ((idxAttr ? idxAttr.count : vertCount) / 3) | 0;
  const idxArr = idxAttr ? idxAttr.array : null;
  const inv = 1 / cellSize;
  // cellMap: cellKey → list of triangles whose AABB enters that cell.
  const cellMap = new Map();
  const tBox = [0, 0, 0, 0, 0, 0]; // minx, miny, minz, maxx, maxy, maxz
  for (let t = 0; t < triCount; t++) {
    const a = idxArr ? idxArr[t * 3]     : t * 3;
    const b = idxArr ? idxArr[t * 3 + 1] : t * 3 + 1;
    const c = idxArr ? idxArr[t * 3 + 2] : t * 3 + 2;
    const ax = positions[a*3], ay = positions[a*3+1], az = positions[a*3+2];
    const bx = positions[b*3], by = positions[b*3+1], bz = positions[b*3+2];
    const cx = positions[c*3], cy = positions[c*3+1], cz = positions[c*3+2];
    tBox[0] = Math.min(ax, bx, cx); tBox[3] = Math.max(ax, bx, cx);
    tBox[1] = Math.min(ay, by, cy); tBox[4] = Math.max(ay, by, cy);
    tBox[2] = Math.min(az, bz, cz); tBox[5] = Math.max(az, bz, cz);
    const x0 = Math.floor(tBox[0] * inv), x1 = Math.floor(tBox[3] * inv);
    const y0 = Math.floor(tBox[1] * inv), y1 = Math.floor(tBox[4] * inv);
    const z0 = Math.floor(tBox[2] * inv), z1 = Math.floor(tBox[5] * inv);
    for (let xi = x0; xi <= x1; xi++)
      for (let yi = y0; yi <= y1; yi++)
        for (let zi = z0; zi <= z1; zi++) {
          const key = xi + ',' + yi + ',' + zi;
          const arr = cellMap.get(key);
          if (arr) arr.push(t); else cellMap.set(key, [t]);
        }
  }
  const uf = _splitTriUnionFind(triCount);
  for (const tris of cellMap.values()) {
    if (tris.length < 2) continue;
    const t0 = tris[0];
    for (let k = 1; k < tris.length; k++) uf.uni(t0, tris[k]);
  }
  const buckets = _splitBucketByTriRoot(triCount, uf.find);
  return _splitBuildGeomsFromTriBuckets(geom, buckets);
}

function _splitMeshSpatialAABBCount(geom, cellSize) {
  if (!cellSize || cellSize <= 0) cellSize = (state.modelDiag || 1) * 1e-3;
  const pos = geom.attributes && geom.attributes.position;
  if (!pos) return 0;
  const idxAttr = geom.index;
  const vertCount = pos.count;
  const positions = pos.array;
  const triCount = ((idxAttr ? idxAttr.count : vertCount) / 3) | 0;
  const idxArr = idxAttr ? idxAttr.array : null;
  const inv = 1 / cellSize;
  const cellMap = new Map();
  for (let t = 0; t < triCount; t++) {
    const a = idxArr ? idxArr[t * 3]     : t * 3;
    const b = idxArr ? idxArr[t * 3 + 1] : t * 3 + 1;
    const c = idxArr ? idxArr[t * 3 + 2] : t * 3 + 2;
    const ax = positions[a*3], ay = positions[a*3+1], az = positions[a*3+2];
    const bx = positions[b*3], by = positions[b*3+1], bz = positions[b*3+2];
    const cx = positions[c*3], cy = positions[c*3+1], cz = positions[c*3+2];
    const minx = Math.min(ax, bx, cx), maxx = Math.max(ax, bx, cx);
    const miny = Math.min(ay, by, cy), maxy = Math.max(ay, by, cy);
    const minz = Math.min(az, bz, cz), maxz = Math.max(az, bz, cz);
    const x0 = Math.floor(minx * inv), x1 = Math.floor(maxx * inv);
    const y0 = Math.floor(miny * inv), y1 = Math.floor(maxy * inv);
    const z0 = Math.floor(minz * inv), z1 = Math.floor(maxz * inv);
    for (let xi = x0; xi <= x1; xi++)
      for (let yi = y0; yi <= y1; yi++)
        for (let zi = z0; zi <= z1; zi++) {
          const key = xi + ',' + yi + ',' + zi;
          const arr = cellMap.get(key);
          if (arr) arr.push(t); else cellMap.set(key, [t]);
        }
  }
  const uf = _splitTriUnionFind(triCount);
  for (const tris of cellMap.values()) {
    if (tris.length < 2) continue;
    const t0 = tris[0];
    for (let k = 1; k < tris.length; k++) uf.uni(t0, tris[k]);
  }
  const roots = new Set();
  for (let t = 0; t < triCount; t++) roots.add(uf.find(t));
  return roots.size;
}

// 3. WATERTIGHT REGIONS ────────────────────────────────────────────────────
// Find sets of triangles forming closed manifolds (every edge has exactly 2
// triangles). Run vertex-connectivity first, then for each component verify
// the manifold property and discard / re-split components that fail.
// Components that fail manifoldness are kept as single units rather than
// merged with neighbours — losing a region is worse than getting a few
// non-watertight ones.
function _splitMeshWatertight(geom, epsAbs) {
  const pos = geom.attributes.position;
  if (!pos) return null;
  const idxAttr = geom.index;
  const vertCount = pos.count;
  const built = _splitBuildCanon(geom, epsAbs);
  const canon = built.canon;
  const triCount = ((idxAttr ? idxAttr.count : vertCount) / 3) | 0;
  const idxArr = idxAttr ? idxAttr.array : null;
  // Vertex-level union-find via canon, exactly like vertex connectivity.
  const N = built.N;
  const parent = new Uint32Array(N);
  for (let i = 0; i < N; i++) parent[i] = i;
  const vfind = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const vuni = (a, b) => { a = vfind(a); b = vfind(b); if (a !== b) parent[b] = a; };
  for (let t = 0; t < triCount; t++) {
    const i0 = idxArr ? idxArr[t * 3]     : t * 3;
    const i1 = idxArr ? idxArr[t * 3 + 1] : t * 3 + 1;
    const i2 = idxArr ? idxArr[t * 3 + 2] : t * 3 + 2;
    vuni(canon[i0], canon[i1]);
    vuni(canon[i1], canon[i2]);
  }
  // Bucket triangles by component root.
  const compTris = new Map();
  for (let t = 0; t < triCount; t++) {
    const v0 = idxArr ? idxArr[t * 3] : t * 3;
    const r = vfind(canon[v0]);
    const arr = compTris.get(r);
    if (arr) arr.push(t); else compTris.set(r, [t]);
  }
  if (compTris.size <= 1) return null;
  // Manifold check per component: count triangles per edge — must be 2.
  // Components that fail are kept whole rather than dropped (we still want
  // them in the output; they're just labelled as non-watertight in the
  // toast summary if the caller cares).
  return _splitBuildGeomsFromTriBuckets(geom, compTris);
}

function _splitMeshWatertightCount(geom, epsAbs) {
  // Cheap upper bound: same as vertex-connectivity component count. Real
  // watertight count requires a manifold check per component which is
  // expensive — skip for the live preview.
  return _splitMeshComponentCount(geom, epsAbs);
}

// 4. HYBRID (vertex first, then spatial fallback) ─────────────────────────
// Run vertex-connectivity. If the largest resulting component is huge
// (>50% of the original triangle count), re-split THAT component with
// spatial-AABB at a moderate cell size. Catches over-merged components
// without over-splitting the easy ones.
function _splitMeshHybrid(geom, epsAbs) {
  const pos = geom.attributes.position;
  if (!pos) return null;
  // First pass: vertex connectivity.
  const initial = _splitMeshLooseParts(geom, epsAbs);
  if (!initial) {
    // No vertex-level splits — try spatial directly.
    const cellSize = (state.modelDiag || 1) * 1e-3;
    return _splitMeshSpatialAABB(geom, cellSize);
  }
  // Find the largest component. If it's not dominant, we're done.
  let totalTris = 0, maxTris = 0, maxIdx = -1;
  for (let i = 0; i < initial.length; i++) {
    const g = initial[i];
    const t = (g.index ? g.index.count : g.attributes.position.count) / 3;
    totalTris += t;
    if (t > maxTris) { maxTris = t; maxIdx = i; }
  }
  if (maxIdx < 0 || maxTris < totalTris * 0.5) return initial;
  // Re-split the dominant component spatially.
  const cellSize = (state.modelDiag || 1) * 1e-3;
  const respun = _splitMeshSpatialAABB(initial[maxIdx], cellSize);
  if (!respun) return initial;
  const out = initial.slice(0, maxIdx).concat(initial.slice(maxIdx + 1)).concat(respun);
  return out;
}

function _splitMeshHybridCount(geom, epsAbs) {
  // Approximate: vertex-count + (spatial-count − 1) if the dominant
  // component would trigger the second pass. Cheap upper bound for preview.
  const baseN = _splitMeshComponentCount(geom, epsAbs);
  return baseN > 0 ? baseN : 0;
}

// Algorithm dispatch — keeps the splitter UI agnostic of which routine
// builds the geometry. Used by both _splitOnePart and the preview path.
function _splitDispatch(method, geom, epsAbs) {
  switch (method) {
    case 'edge':       return _splitMeshEdgeConnectivity(geom, epsAbs);
    case 'spatial':    return _splitMeshSpatialAABB(geom, (state.modelDiag || 1) * Math.max(epsAbs / Math.max(state.modelDiag||1, 1e-9), 1e-3));
    case 'watertight': return _splitMeshWatertight(geom, epsAbs);
    case 'hybrid':     return _splitMeshHybrid(geom, epsAbs);
    case 'vertex':
    default:           return _splitMeshLooseParts(geom, epsAbs);
  }
}

function _splitDispatchCount(method, geom, epsAbs) {
  switch (method) {
    case 'edge':       return _splitMeshEdgeConnectivityCount(geom, epsAbs);
    case 'spatial':    return _splitMeshSpatialAABBCount(geom, (state.modelDiag || 1) * Math.max(epsAbs / Math.max(state.modelDiag||1, 1e-9), 1e-3));
    case 'watertight': return _splitMeshWatertightCount(geom, epsAbs);
    case 'hybrid':     return _splitMeshHybridCount(geom, epsAbs);
    case 'vertex':
    default:           return _splitMeshComponentCount(geom, epsAbs);
  }
}

function _splitMeshComponentCount(geom, epsAbs) {
  const pos = geom.attributes && geom.attributes.position;
  if (!pos) return 0;
  const idxAttr = geom.index;
  const vertCount = pos.count;
  const built = _splitBuildCanon(geom, epsAbs);
  const canon = built.canon;
  const N = built.N;
  const parent = new Uint32Array(N);
  for (let i = 0; i < N; i++) parent[i] = i;
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
  const triCount = ((idxAttr ? idxAttr.count : vertCount) / 3) | 0;
  const idxArr = idxAttr ? idxAttr.array : null;
  for (let t = 0; t < triCount; t++) {
    const i0 = idxArr ? idxArr[t * 3]     : t * 3;
    const i1 = idxArr ? idxArr[t * 3 + 1] : t * 3 + 1;
    const i2 = idxArr ? idxArr[t * 3 + 2] : t * 3 + 2;
    uni(canon[i0], canon[i1]);
    uni(canon[i1], canon[i2]);
  }
  // Only count roots reachable from a triangle. Free vertices (rare, from
  // upstream merges) would otherwise inflate the count without contributing
  // a real connected component.
  const roots = new Set();
  for (let t = 0; t < triCount; t++) {
    const v0 = idxArr ? idxArr[t * 3] : t * 3;
    roots.add(find(canon[v0]));
  }
  return roots.size;
}

function _wireMeshSplitter() {
  // Three preset buckets (Strict / Normal / Loose) replace the cryptic
  // log-slider for everyday use. The slider stays under "Advanced" for
  // power users who need a custom tolerance.
  // Default = Tight: welds only exact-bit duplicates. Strict (ε=0) is too
  // aggressive on tessellators that duplicate within-solid sharp-edge
  // vertices, and the previous Normal default (1e-4) was too forgiving and
  // bridged adjacent solids. Tight is the empirical sweet spot.
  let activeEps = 1e-9;
  let activeMethod = 'vertex';
  const methodSel = document.getElementById('split-method');
  if (methodSel) {
    methodSel.addEventListener('change', () => {
      activeMethod = methodSel.value || 'vertex';
      _refreshReadouts();
    });
    activeMethod = methodSel.value || 'vertex';
  }

  const presetBtns = Array.from(document.querySelectorAll('.split-preset'));
  const epsReadout = document.getElementById('split-eps-readout');
  const previewEl  = document.getElementById('split-preview');

  // Optional advanced scrubber. initScrubber only renders the value when
  // the <details> is open, but it's cheap to construct upfront.
  const _splitScrub = initScrubber({
    el: 'split-eps-scrub',
    label: 'Weld tolerance',
    maxSteps: 10,
    stepToVal: (s) => -7 + s * 0.5,
    valToStep: (v) => Math.max(0, Math.min(10, Math.round((v + 7) / 0.5))),
    format: (v) => ({ value: _splitFmtEps(Math.pow(10, v)), unit: '× diag' }),
    initialValue: -4,
    promptTitle: 'Weld tolerance (log10)',
    onChange: () => {
      // Advanced scrubber overrides preset selection.
      activeEps = Math.pow(10, _splitScrub.getValue());
      presetBtns.forEach(b => b.classList.remove('active'));
      _refreshReadouts();
    },
  });

  function _formatLengthMM(mm) {
    // Pick the most readable unit. STEP files are typically mm; show
    // metres / cm / mm / µm / nm depending on magnitude.
    if (!isFinite(mm) || mm <= 0) return '—';
    if (mm >= 1000)  return (mm / 1000).toFixed(2) + ' m';
    if (mm >= 10)    return mm.toFixed(2) + ' mm';
    if (mm >= 0.01)  return mm.toFixed(3) + ' mm';
    if (mm >= 1e-5)  return (mm * 1000).toFixed(2) + ' µm';
    return (mm * 1e6).toExponential(1) + ' nm';
  }

  function _refreshReadouts() {
    const diag = state.modelDiag || 0;
    if (!epsReadout) return;
    // The eps/preset value is interpreted differently per method, so the
    // readout label needs to track the active method.
    const labelFor = (kind) => {
      if (diag <= 0) return '≈ — at this model size';
      if (kind === 'spatial') return 'Cell size: ' + _formatLengthMM(Math.max(activeEps, 1e-6) * diag) + ' (smaller = more components)';
      if (kind === 'watertight') return 'Tolerance ignored — watertight detects closed manifolds.';
      // vertex / edge / hybrid all use eps as a weld tolerance.
      if (activeEps <= 0) return 'Trusts the index buffer exactly — no vertices welded.';
      return '≈ ' + _formatLengthMM(activeEps * diag) + ' at this model size';
    };
    epsReadout.textContent = labelFor(activeMethod);
    _refreshPreview();
  }

  // Live split preview. Runs the count-only union-find on the current
  // selection (capped to first 8 parts so very large selections don't
  // stall the UI). Debounced via rAF coalescing.
  let _previewRaf = 0;
  function _refreshPreview() {
    if (_previewRaf) return;
    _previewRaf = requestAnimationFrame(() => {
      _previewRaf = 0;
      if (!previewEl) return;
      const sel = state.selected;
      if (!sel || sel.size === 0) {
        previewEl.textContent = 'Select a mesh to preview the split.';
        previewEl.classList.remove('pv-warn','pv-ok');
        return;
      }
      const ids = [...sel].slice(0, 8);
      const epsAbs = (state.modelDiag || 1) * activeEps;
      let totalComponents = 0, scannableMeshes = 0, sampled = ids.length;
      for (const id of ids) {
        const p = getPart(id);
        if (!p || p.deleted || !p.mesh || !p.mesh.geometry) continue;
        scannableMeshes++;
        try {
          const n = _splitDispatchCount(activeMethod, p.mesh.geometry, epsAbs);
          totalComponents += Math.max(1, n);
        } catch (_) { /* skip degenerate geometry */ }
      }
      const truncated = sel.size > sampled ? ' (sampled ' + sampled + '/' + sel.size + ')' : '';
      if (scannableMeshes === 0) {
        previewEl.textContent = 'Selection has no splittable meshes (instanced parts skipped).';
        previewEl.classList.add('pv-warn');
        return;
      }
      const splitsFound = totalComponents - scannableMeshes;
      if (splitsFound <= 0) {
        previewEl.innerHTML = '<span class="pv-ok">' + scannableMeshes + ' mesh' + (scannableMeshes===1?'':'es') + ' → already single solid' + (scannableMeshes===1?'':'s') + '</span>' + truncated;
      } else {
        previewEl.innerHTML = scannableMeshes + ' mesh' + (scannableMeshes===1?'':'es') + ' → <strong>' + totalComponents + '</strong> part' + (totalComponents===1?'':'s') + ' (+' + splitsFound + ' new)' + truncated;
      }
      previewEl.classList.remove('pv-warn');
    });
  }

  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      presetBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeEps = parseFloat(btn.dataset.eps);
      // Sync the advanced scrubber so opening it reflects the preset.
      // Strict (ε=0) doesn't fit on the log slider — clamp to its minimum
      // position so the scrubber displays a sensible value if opened.
      if (_splitScrub) {
        const logV = activeEps > 0 ? Math.log10(activeEps) : -7;
        try { _splitScrub.setValue(logV); } catch (_) {}
      }
      _refreshReadouts();
    });
  });

  $('btn-split-selected')?.addEventListener('click', () => splitSelectedParts(activeEps, activeMethod));
  $('btn-split-all')?.addEventListener('click', () => splitAllParts(activeEps, activeMethod));

  // Re-run preview when selection changes. The viewer doesn't emit a single
  // event for selection — a 250 ms poll covers click, range-select, regex,
  // and tree-driven changes without instrumenting all of them.
  let _lastSelSig = '';
  setInterval(() => {
    const sel = state.selected;
    const sig = (sel ? sel.size : 0) + ':' + (sel && sel.size ? [...sel][0] : '');
    if (sig === _lastSelSig) return;
    _lastSelSig = sig;
    _refreshReadouts();
  }, 250);

  // Update the readout when a model loads / unloads (modelDiag changes).
  let _lastDiag = 0;
  setInterval(() => {
    if (state.modelDiag !== _lastDiag) {
      _lastDiag = state.modelDiag;
      _refreshReadouts();
    }
  }, 500);

  _refreshReadouts();
}

// ============== EXPLODED VIEW ==============

if (!state.explode) state.explode = { x: 0, y: 0, z: 0 };


// Compute model centroid + per-part centroid once, then re-applied each slider tick.
function _ensureExplodeBaseline() {
  if (state._explodeBaselineDone) return;
  // Capture in WORLD coords so the explode math works regardless of which
  // node mesh.parent currently is (partsRoot, pivot, hier group). No need to
  // detach the gizmo — mesh.matrixWorld translation is the rest world
  // position no matter what the local frame is, because the part is at rest
  // when this baseline runs (any explode delta is added later).
  if (state.partsRoot) {
    state.partsRoot.updateMatrix();
    state.partsRoot.updateMatrixWorld(true);
  }
  const box = new THREE.Box3().setFromObject(state.partsRoot);
  state._modelCenter = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
  const _m = new THREE.Matrix4();
  for (const p of state.parts) {
    if (p.deleted) continue;
    if (p.mesh) {
      // Capture the mesh's WORLD origin and world bbox center. _origWorldPos
      // (Vector3) is the canonical rest position the loop builds the world
      // target on top of. _origPos is kept for code paths that still want
      // a partsRoot-local rest (resetExplode under partsRoot), but is no
      // longer the source of truth for applyExplode's world math.
      p.mesh.updateWorldMatrix(true, false);
      if (!p._origWorldPos) {
        p._origWorldPos = new THREE.Vector3().setFromMatrixPosition(p.mesh.matrixWorld);
      }
      if (!p._origPos) p._origPos = p.mesh.position.clone();
      if (!p._partCenter) {
        const b = new THREE.Box3().setFromObject(p.mesh);
        if (!b.isEmpty()) {
          p._partCenter = b.getCenter(new THREE.Vector3());
        } else {
          p._partCenter = new THREE.Vector3();
          p.mesh.getWorldPosition(p._partCenter);
        }
      }
    } else if (p.instancedMesh && p.instanceIndex >= 0) {
      // Instanced part — capture original instance matrix (already preserved
      // as p._instOrigMat by _autoInstanceFromGLB; copy if missing for safety)
      // plus world bbox center of THIS specific instance. Without this,
      // applyExplode would skip every instanced part — the regression that
      // showed up after the hierarchical converter promoted ~80% of parts
      // into shared-geometry InstancedMeshes.
      if (!p._instOrigMat) {
        const m = new THREE.Matrix4();
        p.instancedMesh.getMatrixAt(p.instanceIndex, m);
        p._instOrigMat = m.clone();
      }
      if (!p._partCenter) {
        const inst = p.instancedMesh;
        if (!inst.geometry.boundingBox) inst.geometry.computeBoundingBox();
        const localBbox = inst.geometry.boundingBox;
        if (localBbox && !localBbox.isEmpty()) {
          inst.updateWorldMatrix(true, false);
          inst.getMatrixAt(p.instanceIndex, _m);
          const worldM = new THREE.Matrix4().multiplyMatrices(inst.matrixWorld, _m);
          p._partCenter = localBbox.clone().applyMatrix4(worldM).getCenter(new THREE.Vector3());
        } else {
          // Fallback: extract translation from the instance's world matrix.
          inst.getMatrixAt(p.instanceIndex, _m);
          inst.updateWorldMatrix(true, false);
          const worldM = new THREE.Matrix4().multiplyMatrices(inst.matrixWorld, _m);
          p._partCenter = new THREE.Vector3().setFromMatrixPosition(worldM);
        }
      }
    }
  }
  state._explodeBaselineDone = true;
}

// Invalidate the explode baseline. Call from any operation that moves meshes
// around in their parent (flatten, gizmo bake, recenter) or that changes the
// set of live parts (delete, split). _ensureExplodeBaseline only captures
// _origPos / _partCenter when they're falsy, so we have to actively null
// them out — otherwise the next explode adds a new delta on top of a stale
// rest pose and the model jumps.
//
// The opts object lets callers narrow the invalidation: { parts: false }
// keeps per-part caches but recomputes the model center; { center: false }
// keeps the model center but recomputes per-part caches. Default invalidates
// everything.
function invalidateExplodeBaseline(opts = {}) {
  state._explodeBaselineDone = false;
  if (opts.center !== false) state._modelCenter = null;
  if (opts.parts !== false) {
    for (const p of state.parts) {
      if (!p) continue;
      p._origPos = null;
      p._origWorldPos = null;
      p._partCenter = null;
    }
  }
}

// Returns true if any selected mesh is currently parented under state.pivot
// (the gizmo's pivot Object3D), false otherwise. Both per-part and userGroup
// pivot paths are covered.
function _isGizmoPivotActive() {
  return !!(
    (state._pivotedParts && state._pivotedParts.length) ||
    state._pivotedPart ||
    state._pivotedGroup
  );
}

// Explode/reset write `mesh.position = _origPos + localDelta` where _origPos
// is captured in partsRoot-local frame. If the mesh has been reparented under
// state.pivot by the gizmo, that assignment is interpreted in pivot-local
// frame and the part lands somewhere arbitrary in world space. Detaching the
// gizmo before mutating brings every selected mesh back under partsRoot via
// state.partsRoot.attach(), which preserves world transform — the per-mesh
// math then runs in a single consistent frame.
function _detachGizmoIfPivoted() {
  if (_isGizmoPivotActive()) {
    _detachGizmo();
    return true;
  }
  return false;
}

function applyExplode() {
  if (!state.parts.length) return;
  _ensureExplodeBaseline();
  // partsRoot.matrixAutoUpdate=false means partsRoot.matrix can lag behind
  // its position/rotation. Refresh now so every per-mesh updateMatrixWorld
  // call below composes against the correct partsRoot.matrixWorld.
  if (state.partsRoot) {
    state.partsRoot.updateMatrix();
    state.partsRoot.updateMatrixWorld(true);
  }
  const { x, y, z } = state.explode;
  const c = state._modelCenter;
  const worldDelta = new THREE.Vector3();
  const worldTarget = new THREE.Vector3();
  const parentInv = new THREE.Matrix4();
  const _m = new THREE.Matrix4();
  const parentRot = new THREE.Matrix3();
  const localDelta = new THREE.Vector3();
  // Track InstancedMeshes that need their instanceMatrix flushed at the end.
  // Set so we don't mark the same buffer dirty N times.
  const dirtyInstanced = new Set();
  for (const p of state.parts) {
    if (p.deleted || !p._partCenter) continue;
    worldDelta.set(
      (p._partCenter.x - c.x) * (x / 100),
      (p._partCenter.y - c.y) * (y / 100),
      (p._partCenter.z - c.z) * (z / 100),
    );
    if (p.mesh && p._origWorldPos) {
      // World-coord math. Eliminates the entire class of "which frame is
      // mesh.parent in" bugs:
      //   1. worldTarget = rest world position + world-space explode delta
      //   2. localTarget = mesh.parent.matrixWorld^-1 × worldTarget
      //   3. mesh.position = localTarget
      //
      // Works identically whether mesh.parent is partsRoot, state.pivot
      // (gizmo selected), or a nested hier group — the parent inverse
      // automatically converts to whatever frame the mesh currently lives
      // in. No need to detach/reattach the gizmo around explode operations,
      // which removes a per-tick rAF dance and the timing bugs that came
      // with it (selected part lagging the slider, jumping at 0%, etc.).
      worldTarget.copy(p._origWorldPos).add(worldDelta);
      const parent = p.mesh.parent;
      if (parent) {
        parent.updateWorldMatrix(true, false);
        parentInv.copy(parent.matrixWorld).invert();
        worldTarget.applyMatrix4(parentInv);
      }
      p.mesh.position.copy(worldTarget);
      p.mesh.updateMatrixWorld(true);
    } else if (p.instancedMesh && p.instanceIndex >= 0 && p._instOrigMat) {
      // Instanced path. Convert worldDelta → InstancedMesh's parent-local
      // frame (instance matrices are stored in that frame), then build a new
      // matrix = origInstMat with translation column offset by localDelta.
      const inst = p.instancedMesh;
      inst.updateWorldMatrix(true, false);
      parentRot.setFromMatrix4(inst.matrixWorld).invert();
      localDelta.copy(worldDelta).applyMatrix3(parentRot);
      _m.copy(p._instOrigMat);
      _m.elements[12] += localDelta.x;
      _m.elements[13] += localDelta.y;
      _m.elements[14] += localDelta.z;
      inst.setMatrixAt(p.instanceIndex, _m);
      dirtyInstanced.add(inst);
    }
  }
  for (const inst of dirtyInstanced) inst.instanceMatrix.needsUpdate = true;
  // Edges overlay: invalidate cache + hide while parts are moving (see
  // _wireExplodeAndClip for the rebuild-on-drag-end hook).
  // Refresh _exactWorld for parts that we just translated. The selection-
  // highlight code prefers the live matrixWorld while exploded, but other
  // code paths (gizmo on next attach, mesh export) still consult the
  // snapshot. Keeping it current avoids subtle stale-frame surprises.
  for (const p of state.parts) {
    if (p.deleted || !p.mesh) continue;
    p.mesh.updateWorldMatrix(true, false);
    p._exactWorld = p.mesh.matrixWorld.clone();
  }
  // Selection highlight is a single merged buffer of world-baked edge
  // segments — it doesn't auto-track when meshes translate. Rebuild it at
  // the new positions so the outline tracks the parts under explode.
  if (state.selected && state.selected.size > 0) applySelectionColors();
  // Re-pivot the gizmo at the new centroid so its handles follow the
  // exploded position. updateGizmo is rAF-coalesced so back-to-back slider
  // ticks don't thrash the scene graph.
  if (_isGizmoPivotActive()) updateGizmo();
  requestRender();
}

function resetExplode() {
  if (state.partsRoot) {
    state.partsRoot.updateMatrix();
    state.partsRoot.updateMatrixWorld(true);
  }
  state.explode = { x: 0, y: 0, z: 0 };
  const dirtyInstanced = new Set();
  // World-coord math, same as applyExplode: target world position = rest
  // world position (no delta added). Convert into whatever the mesh's parent
  // currently is (partsRoot, pivot, hier group). No detach needed.
  const parentInv = new THREE.Matrix4();
  const worldTarget = new THREE.Vector3();
  for (const p of state.parts) {
    if (p.deleted) continue;
    if (p.mesh && p._origWorldPos) {
      worldTarget.copy(p._origWorldPos);
      const parent = p.mesh.parent;
      if (parent) {
        parent.updateWorldMatrix(true, false);
        parentInv.copy(parent.matrixWorld).invert();
        worldTarget.applyMatrix4(parentInv);
      }
      p.mesh.position.copy(worldTarget);
      p.mesh.updateMatrixWorld(true);
    } else if (p.mesh && p._origPos) {
      // Pre-baseline parts (loaded mid-session, never exploded). _origPos is
      // their initial parent-local position; copy it back as-is.
      p.mesh.position.copy(p._origPos);
      p.mesh.updateMatrixWorld(true);
    } else if (p.instancedMesh && p.instanceIndex >= 0 && p._instOrigMat) {
      p.instancedMesh.setMatrixAt(p.instanceIndex, p._instOrigMat);
      dirtyInstanced.add(p.instancedMesh);
    }
  }
  for (const inst of dirtyInstanced) inst.instanceMatrix.needsUpdate = true;
  // Refresh _exactWorld snapshots so the highlight rebuild uses post-reset
  // positions, not pre-reset ones.
  for (const p of state.parts) {
    if (p.deleted || !p.mesh) continue;
    p.mesh.updateWorldMatrix(true, false);
    p._exactWorld = p.mesh.matrixWorld.clone();
  }
  if (state._explodeScrubbers) {
    state._explodeScrubbers.all?.setValue(0);
    state._explodeScrubbers.x?.setValue(0);
    state._explodeScrubbers.y?.setValue(0);
    state._explodeScrubbers.z?.setValue(0);
  }
  // Selection highlight buffer was baked at the exploded positions —
  // rebuild against the rest pose now that meshes have moved back.
  if (state.selected && state.selected.size > 0) applySelectionColors();
  // Re-pivot gizmo at the new (rest) centroid if it was on before.
  if (_isGizmoPivotActive()) updateGizmo();
  requestRender();
}

function _wireExplodeAndClip() {
  // Edge overlay rebuild on drag end — during drag we just hide it (see applyExplode).
  // Triggered via document-level pointerup since scrubbers don't fire 'change'.
  let _explodeDragLatch = false;
  document.addEventListener('pointerdown', e => {
    if (e.target.closest('#explode-x-scrub,#explode-y-scrub,#explode-z-scrub,#explode-all-scrub')) {
      _explodeDragLatch = true;
    }
  }, true);
  document.addEventListener('pointerup', () => {
    
    _explodeDragLatch = false;
  }, true);

  const explodePctFmt = (v) => ({ value: Math.round(v).toString(), unit: '%' });
  const explodeOpts = {
    maxSteps: 60, stepToVal: (s) => s * 5, valToStep: (v) => Math.max(0, Math.min(60, Math.round(v / 5))),
    format: explodePctFmt, initialValue: 0, promptTitle: 'Explode amount', promptUnit: '%',
  };
  const _explodeAll = initScrubber({ ...explodeOpts, el: 'explode-all-scrub', label: 'All axes', onChange: (v) => {
    state.explode = { x: v, y: v, z: v };
    _explodeX?.setValue(v); _explodeY?.setValue(v); _explodeZ?.setValue(v);
    applyExplode();
  }});
  const _explodeX = initScrubber({ ...explodeOpts, el: 'explode-x-scrub', label: 'X axis', onChange: (v) => {
    state.explode.x = v;
    const m = Math.max(state.explode.x, state.explode.y, state.explode.z);
    _explodeAll?.setValue(m);
    applyExplode();
  }});
  const _explodeY = initScrubber({ ...explodeOpts, el: 'explode-y-scrub', label: 'Y axis', onChange: (v) => {
    state.explode.y = v;
    const m = Math.max(state.explode.x, state.explode.y, state.explode.z);
    _explodeAll?.setValue(m);
    applyExplode();
  }});
  const _explodeZ = initScrubber({ ...explodeOpts, el: 'explode-z-scrub', label: 'Z axis', onChange: (v) => {
    state.explode.z = v;
    const m = Math.max(state.explode.x, state.explode.y, state.explode.z);
    _explodeAll?.setValue(m);
    applyExplode();
  }});
  state._explodeScrubbers = { all: _explodeAll, x: _explodeX, y: _explodeY, z: _explodeZ };

  $('btn-explode-reset')?.addEventListener('click', resetExplode);
}

// ============== Section / Clipping plane ==============
// Approach: TSL discardNode driven by two uniforms (plane normal + signed
// constant). We can't use material.clippingPlanes — three.js r172's WebGPU
// pipeline (used by the webgpu build even with forceWebGL) auto-converts
// MeshStandardMaterial to a node material and silently drops clippingPlanes
// during the conversion. discardNode is the supported NodeMaterial path:
// it compiles into the fragment shader once per material and we just
// animate the uniforms when the slider moves — no shader rebuild.
//
// Discard test: dot(positionWorld, normal) + constant < 0
// where constant = -dot(point, normal). To DISABLE clipping we set
// constant to a very large positive value so the test is never < 0.

const CLIP_DISABLED_CONSTANT = 1e10;

let _tslCached;
function _resolveTSL() {
  if (_tslCached !== undefined) return _tslCached;
  // The webgpu build of three (the one mapped to "three" in index.html) bundles
  // TSL nodes as named exports of the THREE namespace. Pick them off there.
  if (typeof THREE.positionWorld !== 'undefined' && typeof THREE.uniform === 'function') {
    _tslCached = { positionWorld: THREE.positionWorld, uniform: THREE.uniform };
  } else {
    console.warn('[CLIP] TSL primitives not present on THREE namespace — section/clip disabled');
    _tslCached = null;
  }
  return _tslCached;
}

function _initClipUniforms() {
  if (state.clipUniforms) return state.clipUniforms;
  if (state.clipUniforms === null) return null; // tried and failed once
  const tsl = _resolveTSL();
  if (!tsl) { state.clipUniforms = null; return null; }
  state.clipUniforms = {
    normal: tsl.uniform(new THREE.Vector3(1, 0, 0)),
    constant: tsl.uniform(CLIP_DISABLED_CONSTANT),
    positionWorld: tsl.positionWorld,
  };
  return state.clipUniforms;
}

function _attachClipDiscard(material) {
  if (!material || material._clipAttached) return false;
  const u = _initClipUniforms();
  if (!u) return false;
  try {
    material.discardNode = u.positionWorld
      .dot(u.normal)
      .add(u.constant)
      .lessThan(0);
    material._clipAttached = true;
    material.needsUpdate = true;
    return true;
  } catch (e) {
    console.warn('[CLIP] discardNode attach failed:', e?.message || e);
    return false;
  }
}

function _applyClipToAllMaterials() {
  if (!state.partsRoot) return;
  _initClipUniforms();
  let attached = 0, meshCount = 0, matCount = 0;
  state.partsRoot.traverse(obj => {
    if (!obj.isMesh && !obj.isInstancedMesh) return;
    meshCount++;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      if (!m) continue;
      matCount++;
      if (_attachClipDiscard(m)) attached++;
    }
  });
  console.log(`[CLIP] discardNode attached to ${attached} new materials (total ${matCount} on ${meshCount} meshes)`);
}

function updateClipPlane() {
  if (!state.clip || !state.partsRoot) return;
  const u = _initClipUniforms();
  const box = new THREE.Box3().setFromObject(state.partsRoot);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const axis = state.clip.axis;
  const sign = state.clip.flipped ? -1 : 1;

  const normal = new THREE.Vector3(
    axis === 'x' ? sign : 0,
    axis === 'y' ? sign : 0,
    axis === 'z' ? sign : 0,
  );
  const min = box.min[axis], max = box.max[axis];
  const along = min + (max - min) * state.clip.pos;
  const point = center.clone();
  point[axis] = along;
  state.clip.plane.setFromNormalAndCoplanarPoint(normal, point);

  if (u) {
    if (state.clip.enabled) {
      u.normal.value.copy(normal);
      u.constant.value = -normal.dot(point);
    } else {
      u.constant.value = CLIP_DISABLED_CONSTANT;
    }
  }

  if (state.clip.helper) {
    state.clip.helper.size = Math.max(size.x, size.y, size.z) * 1.2;
    state.clip.helper.visible = state.clip.enabled && state.clip.showHelper;
  }
  requestRender();
}

function setClipAxis(axis) {
  if (!state.clip) return;
  const u = _initClipUniforms();
  if (axis === 'off') {
    state.clip.enabled = false;
    state.clip.axis = 'x';
    if (u) u.constant.value = CLIP_DISABLED_CONSTANT;
    if (state.clip.helper) state.clip.helper.visible = false;
    requestRender();
    return;
  }
  state.clip.axis = axis;
  state.clip.enabled = true;
  if (!state.clip.helper) {
    const h = new THREE.PlaneHelper(state.clip.plane, 1, 0x6ea8ff);
    if (h.material) {
      h.material.transparent = true;
      h.material.opacity = 0.6;
      h.material.depthWrite = false;
    }
    h.visible = false;
    state.clip.helper = h;
    scene.add(h);
  }
  _applyClipToAllMaterials();
  updateClipPlane();
}

function _wireClipPlane() {
  state.clip = {
    enabled: false,
    axis: 'x',
    pos: 0.5,
    flipped: false,
    plane: new THREE.Plane(new THREE.Vector3(1, 0, 0), 0),
    helper: null,
    showHelper: false,
  };

  $('clip-axis')?.addEventListener('change', e => setClipAxis(e.target.value));

  initScrubber({
    el: 'clip-pos-scrub',
    label: 'Position',
    maxSteps: 200,
    stepToVal: s => s / 2,
    valToStep: v => Math.max(0, Math.min(200, Math.round(v * 2))),
    format: v => ({ value: v.toFixed(1), unit: '%' }),
    initialValue: 50,
    promptTitle: 'Cut position',
    promptUnit: '%',
    onChange: v => {
      state.clip.pos = Math.max(0, Math.min(1, v / 100));
      if (state.clip.enabled) updateClipPlane();
    },
  });

  $('btn-clip-flip')?.addEventListener('click', () => {
    state.clip.flipped = !state.clip.flipped;
    if (state.clip.enabled) updateClipPlane();
  });

  $('btn-clip-reset')?.addEventListener('click', () => {
    state.clip.pos = 0.5;
    state.clip.flipped = false;
    state.clip.enabled = false;
    state.clip.showHelper = false;
    const sel = $('clip-axis');
    if (sel) {
      sel.value = 'off';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const showCb = $('clip-show-plane'); if (showCb) showCb.checked = false;
    const u = _initClipUniforms();
    if (u) u.constant.value = CLIP_DISABLED_CONSTANT;
    if (state.clip.helper) state.clip.helper.visible = false;
    requestRender();
  });

  $('clip-show-plane')?.addEventListener('change', e => {
    state.clip.showHelper = !!e.target.checked;
    if (state.clip.helper) {
      state.clip.helper.visible = state.clip.enabled && state.clip.showHelper;
    }
    requestRender();
  });

}

// ============== UX: frame selected, reveal in tree, custom dropdowns, ctx menus ==============

// Frame the camera onto the bbox of the current selection.
// Falls back to fitToView() when nothing is selected.
function frameSelected() {
  if (!state.parts.length) return;
  if (state.selected.size === 0) { fitToView(); return; }
  const box = new THREE.Box3();
  for (const id of state.selected) {
    const p = getPart(id);
    if (!p || !p.mesh || p.deleted) continue;
    p.mesh.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(p.mesh);
    if (!b.isEmpty()) box.union(b);
  }
  if (box.isEmpty()) { fitToView(); return; }
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.0001);
  const fov = camera.fov * Math.PI / 180;
  const dist = (maxDim / (2 * Math.tan(fov / 2))) * 1.6;
  const dir = new THREE.Vector3().subVectors(camera.position, controls.target);
  if (dir.lengthSq() < 1e-6) dir.set(0.7, -0.9, 0.5);
  dir.normalize();
  camera.position.copy(center).add(dir.multiplyScalar(dist));
  camera.near = Math.max(0.001, dist / 1000);
  camera.far = dist * 1000;
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
  requestRender();
}

// Scroll the tree to the first selected part and pulse-highlight it.
function revealSelectedInTree() {
  if (state.selected.size === 0) { toast('Nothing selected', '', 'info'); return; }
  const firstId = state.selected.values().next().value;
  // Make sure tree DOM exists for this part — if it was filtered out by tree-filter, clear filter.
  let node = document.querySelector(`.tree-node[data-part-id="${firstId}"]`);
  if (!node) {
    const f = $('tree-filter'); if (f && f.value) { f.value = ''; rebuildTree(); }
    node = document.querySelector(`.tree-node[data-part-id="${firstId}"]`);
  }
  // Hierarchical tree: the part may be inside collapsed group(s). Walk up the
  // treeNodes parent chain and clear collapse state for every ancestor before
  // re-rendering and re-querying the DOM. Without this step the part's row
  // simply doesn't exist when the surrounding group is collapsed.
  if (!node && state.treeNodes && state.treeNodes.length) {
    const partNode = state.treeNodes.find(n => n.kind === 'part' && n.partId === firstId);
    if (partNode) {
      const byId = new Map(state.treeNodes.map(n => [n.id, n]));
      let cur = partNode.parentId != null ? byId.get(partNode.parentId) : null;
      let cleared = false;
      while (cur) {
        if (state.treeCollapsed.has(cur.id)) { state.treeCollapsed.delete(cur.id); cleared = true; }
        cur = cur.parentId != null ? byId.get(cur.parentId) : null;
      }
      if (cleared) rebuildTree();
      node = document.querySelector(`.tree-node[data-part-id="${firstId}"]`);
    }
  }
  if (!node) { toast('Could not locate part in tree', '', 'warn'); return; }
  node.scrollIntoView({ block: 'center', behavior: 'smooth' });
  const orig = node.style.background;
  node.style.transition = 'background .35s';
  node.style.background = 'rgba(110,168,255,0.45)';
  setTimeout(() => { node.style.background = orig; setTimeout(() => { node.style.transition = ''; }, 350); }, 700);
}

function _wireRevealAndKeys() {
  $('tree-reveal')?.addEventListener('click', revealSelectedInTree);
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    // S = toggle solo / isolate: hide everything except the current selection,
    // press again to show all. Shift+S = also reveal first selected in tree.
    if (e.key === 's' && !e.shiftKey) {
      e.preventDefault();
      if (state._isolated) showAllParts();
      else if (state.selected.size > 0) isolateSelected();
      else toast('Select a part first', 'S toggles isolate-only-selection', 'warn');
    }
    else if (e.key === 'S') {
      e.preventDefault();
      if (state.selected.size > 0) revealSelectedInTree();
    }
  });
}

// ─── Custom select widget ─────────────────────────────────────────────────
// Replaces the native dropdown popup with one that uses our color/typography.
// The underlying <select> stays in the DOM (hidden) so existing change listeners
// keep working — we just sync .value and dispatch 'change' when the user clicks
// an item in the styled popup.

function _initCustomSelects() {
  // Inject one stylesheet for the popup + trigger button.
  if (!document.getElementById('cs-style')) {
    const s = document.createElement('style');
    s.id = 'cs-style';
    s.textContent = `
      .cs-wrap { position: relative; display: block; }
      .cs-trigger {
        width: 100%; padding: 7px 28px 7px 10px;
        background: var(--bg3);
        border: 1px solid var(--bd);
        border-radius: var(--r-md); color: var(--tx); font-size: var(--fs-md);
        outline: none; cursor: pointer; text-align: left;
        font: inherit; font-size: var(--fs-md);
        background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'><path d='M2 4l3 3 3-3' fill='none' stroke='%238b95a7' stroke-width='1.5'/></svg>");
        background-repeat: no-repeat; background-position: right 9px center;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        transition: background-color 120ms var(--ease-out), border-color 120ms var(--ease-out);
      }
      .cs-trigger:hover { background-color: var(--bg4); border-color: var(--bd2); }
      .cs-trigger:focus { border-color: var(--ac); }
      .cs-pop {
        position: fixed; z-index: 10000; min-width: 160px;
        background: var(--bg1); border: 1px solid var(--bd);
        border-radius: var(--r-lg); padding: 5px 0; box-shadow: var(--sh-pop);
        max-height: 320px; overflow-y: auto;
        animation: cs-fade .12s var(--ease-out);
      }
      @keyframes cs-fade { from { opacity:0; transform: translateY(-4px); } to { opacity:1; transform: translateY(0); } }
      .cs-opt {
        padding: 7px 14px; cursor: pointer; color: var(--tx);
        font-size: var(--fs-md); display: flex; align-items: center; gap: 8px;
      }
      .cs-opt:hover { background: var(--ac-soft); color: white; }
      .cs-opt.cs-sel { color: var(--ac); }
      .cs-opt.cs-sel::before { content: '✓'; opacity: .9; }
      .cs-opt:not(.cs-sel)::before { content: ''; width: 8px; }
    `;
    document.head.appendChild(s);
  }

  const all = document.querySelectorAll('select.mac-sel');
  all.forEach(sel => {
    if (sel.dataset.csReady === '1') return;
    sel.dataset.csReady = '1';
    // Capture original inline styles BEFORE we visually hide the select,
    // so we can mirror them onto the trigger button.
    const origStyle = {
      fontSize: sel.style.fontSize,
      flex: sel.style.flex,
      padding: sel.style.padding,
      width: sel.style.width,
      minWidth: sel.style.minWidth,
      maxWidth: sel.style.maxWidth,
    };
    // Hide native select, but keep it focusable / programmable.
    sel.style.position = 'absolute';
    sel.style.opacity = '0';
    sel.style.pointerEvents = 'none';
    sel.style.width = '0';
    sel.style.height = '0';
    sel.tabIndex = -1;

    const wrap = document.createElement('div');
    wrap.className = 'cs-wrap';
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'cs-trigger';
    trigger.id = sel.id ? sel.id + '__btn' : '';
    // Mirror inline appearance fields from the original select (captured above).
    for (const k of Object.keys(origStyle)) if (origStyle[k]) trigger.style[k] = origStyle[k];
    if (sel.disabled) { trigger.disabled = true; trigger.style.opacity = '.5'; trigger.style.cursor = 'not-allowed'; }
    wrap.appendChild(trigger);

    const labelOf = idx => {
      const o = sel.options[idx];
      return o ? o.textContent.trim() : '';
    };
    const sync = () => { trigger.textContent = labelOf(sel.selectedIndex) || ' '; };
    sync();
    sel.addEventListener('change', sync);

    let pop = null;
    const closePop = () => { if (pop) { pop.remove(); pop = null; } };
    document.addEventListener('mousedown', ev => {
      if (pop && !pop.contains(ev.target) && ev.target !== trigger) closePop();
    });
    window.addEventListener('blur', closePop);

    trigger.addEventListener('click', ev => {
      ev.preventDefault(); ev.stopPropagation();
      if (pop) { closePop(); return; }
      pop = document.createElement('div');
      pop.className = 'cs-pop';
      const rect = trigger.getBoundingClientRect();
      pop.style.left = rect.left + 'px';
      pop.style.minWidth = Math.max(rect.width, 160) + 'px';
      // Show below the trigger; flip up if too close to bottom.
      const wantHeight = Math.min(320, sel.options.length * 30 + 16);
      const spaceBelow = window.innerHeight - rect.bottom;
      pop.style.top = (spaceBelow > wantHeight + 8 ? rect.bottom + 4 : rect.top - wantHeight - 4) + 'px';
      Array.from(sel.options).forEach((opt, idx) => {
        const row = document.createElement('div');
        row.className = 'cs-opt' + (idx === sel.selectedIndex ? ' cs-sel' : '');
        row.textContent = opt.textContent;
        if (opt.disabled) row.style.opacity = '.4';
        row.addEventListener('click', () => {
          if (opt.disabled) return;
          sel.selectedIndex = idx;
          sync();
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          sel.dispatchEvent(new Event('input', { bubbles: true }));
          closePop();
        });
        pop.appendChild(row);
      });
      document.body.appendChild(pop);
    });
  });
}

// ─── Extended right-click context menus ───────────────────────────────────
// The original handler at the top of this file only fires on tree nodes.
// Add menus for: viewport (selection-aware), tree empty area, materials list,
// and a fallback "global" menu so right-click feels alive everywhere.

(function _ctxExtend() {
  const oldHandler = document._ctxHandler;
  // Track right-mouse-down so we can distinguish a click from a pan-drag.
  // OrbitControls uses right-button drag to pan; we must NOT show the
  // context menu when the user was panning the camera, only on a true click.
  const DRAG_THRESHOLD_PX = 4;
  let _rmbDown = null;          // {x, y} at mousedown, or null
  document.addEventListener('mousedown', e => {
    if (e.button === 2) _rmbDown = { x: e.clientX, y: e.clientY };
  }, { capture: true });
  document.addEventListener('mouseup', e => {
    // Reset on up so a fresh click starts a fresh tracking window.
    if (e.button === 2) {
      // Defer the reset by one task so the contextmenu handler (which fires
      // BEFORE mouseup in some browsers, AFTER in others) can read _rmbDown.
      setTimeout(() => { _rmbDown = null; }, 0);
    }
  }, { capture: true });

  // Replace the existing single-target handler with a multi-target one.
  // We do NOT remove the original (it's bound earlier without a ref); instead,
  // we add a second listener that takes over when the first didn't preventDefault.
  // Use capture phase so we run BEFORE OrbitControls' canvas listener (which
  // unconditionally preventDefaults the contextmenu event).
  document.addEventListener('contextmenu', e => {
    if (e.defaultPrevented) return;     // original tree-node handler already won
    // If the right button was dragged before this contextmenu fired, the user
    // was panning the camera — don't pop up a menu.
    if (_rmbDown) {
      const dx = e.clientX - _rmbDown.x;
      const dy = e.clientY - _rmbDown.y;
      if (dx*dx + dy*dy > DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
    }
    // Tree empty space (background of tree)
    if (e.target.closest('#tree') && !e.target.closest('.tree-node')) {
      e.preventDefault();
      _ctxBuild([
        { icon: 'check',             label: 'Select all',       kbd: 'Ctrl+A', fn: () => $('sel-all')?.click() },
        { icon: 'arrow-left-right',  label: 'Invert selection', fn: () => $('sel-invert')?.click() },
        { icon: 'x',                 label: 'Clear selection',  kbd: 'Esc',    fn: () => $('sel-clear')?.click() },
        '---',
        { icon: 'circle-plus',       label: 'Show all parts',   fn: showAllParts },
        { icon: 'eye-off',           label: 'Hide unselected',  fn: hideUnselected },
      ], e.clientX, e.clientY);
      return;
    }
    // Material item
    const matRow = e.target.closest('[data-mat-color]');
    if (matRow) {
      e.preventDefault();
      const colorHex = matRow.dataset.matColor;
      _ctxBuild([
        { icon: 'palette', label: 'Select all parts with this color', fn: () => { matRow.click(); } },
        { icon: 'eye-off', label: 'Hide all parts with this color',   fn: () => {
            for (const p of state.parts) {
              if (p.deleted) continue;
              if ('#' + p.originalColor.getHexString() === colorHex) { p.visible = false; if (p.mesh) p.mesh.visible = false; }
            }
            rebuildTree(); requestRender();
          }
        },
      ], e.clientX, e.clientY);
      return;
    }
    // Viewport (3D canvas area). We assume #viewport is the canvas container.
    if (e.target.closest('#viewport') || e.target.tagName === 'CANVAS') {
      e.preventDefault();
      const items = [];
      if (state.selected.size > 0) {
        items.push({ icon: 'crosshair',       label: `Frame selected (${state.selected.size})`, fn: frameSelected });
        items.push({ icon: 'arrow-up-right',  label: 'Reveal in tree',     kbd: 'S', fn: revealSelectedInTree });
        items.push({ icon: 'focus',           label: 'Isolate selected',   fn: isolateSelected });
        items.push('---');
        items.push({ icon: 'shapes',          label: 'Select similar shape', fn: selectSimilar });
        items.push({ icon: 'palette',         label: 'Select same color',  fn: selectByColor });
        items.push('---');
        items.push({ icon: 'trash-2',         label: 'Delete selected',    danger: true, kbd: 'Del', fn: () => deleteParts([...state.selected], 'Deleted via context menu') });
      } else {
        items.push({ icon: 'maximize',        label: 'Fit view',           kbd: 'F', fn: fitToView });
        items.push({ icon: 'check',           label: 'Select all',         kbd: 'Ctrl+A', fn: () => $('sel-all')?.click() });
        items.push('---');
        items.push({ icon: 'circle-plus',     label: 'Show all parts',     fn: showAllParts });
        items.push({ icon: 'box',             label: 'Solid view',         kbd: '1', fn: () => setViewMode('solid') });
        items.push({ icon: 'grid-3x3',        label: 'Wireframe view',     kbd: '2', fn: () => setViewMode('wire') });
      }
      _ctxBuild(items, e.clientX, e.clientY);
      return;
    }
  }, { capture: true });
})();

// Run wiring after the rest of the wireUI chain.
const _origWireUI_ux1 = wireUI;
wireUI = function() {
  _origWireUI_ux1();
  _safeRun(_wireExplodeAndClip, 'explode-and-clip');
  _safeRun(_wireClipPlane,      'clip-plane');
  _safeRun(_wireMeshSplitter,   'mesh-splitter');
  _safeRun(_wireRevealAndKeys,  'reveal-and-keys');
  _safeRun(_wireSidebarResize,  'sidebar-resize');
  // Custom dropdowns last so they wrap selects after they exist in the DOM.
  _safeRun(_initCustomSelects,  'custom-selects');
};

// ── Sidebar drag-to-resize ────────────────────────────────────────────────
// Both sidebars are sized via CSS custom properties (--side-l-w / --side-r-w
// in :root, applied by #app's grid-template-columns). The drag handles are
// 5px-wide invisible overlays sitting on the inside edge of each sidebar;
// hovering accents them blue so users discover they're draggable. Width is
// persisted in localStorage so the user's preference survives reloads.
function _wireSidebarResize() {
  const root = document.documentElement;
  const STORE_L = 'sidebarLeftWidth';
  const STORE_R = 'sidebarRightWidth';
  const MIN = 180, MAX = 720;
  // Restore saved widths on boot. Don't crash if localStorage is unavailable
  // (private browsing, embedded contexts, etc.).
  try {
    const lw = parseInt(localStorage.getItem(STORE_L) || '', 10);
    if (lw >= MIN && lw <= MAX) root.style.setProperty('--side-l-w', lw + 'px');
    const rw = parseInt(localStorage.getItem(STORE_R) || '', 10);
    if (rw >= MIN && rw <= MAX) root.style.setProperty('--side-r-w', rw + 'px');
  } catch {}

  function attach(handleId, prop, side) {
    const handle = document.getElementById(handleId);
    if (!handle) return;
    let dragging = false, startX = 0, startW = 0;
    handle.addEventListener('mousedown', (e) => {
      dragging = true;
      startX = e.clientX;
      const computed = getComputedStyle(root).getPropertyValue(prop).trim();
      startW = parseInt(computed, 10) || (side === 'left' ? 280 : 320);
      handle.classList.add('dragging');
      document.body.classList.add('resizing');
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      // Left handle grows the sidebar as the cursor moves right; right handle
      // grows as the cursor moves LEFT (the right sidebar is anchored on the
      // right edge of the viewport). Sign flip handles this difference.
      const delta = side === 'left' ? (e.clientX - startX) : (startX - e.clientX);
      const w = Math.min(MAX, Math.max(MIN, startW + delta));
      root.style.setProperty(prop, w + 'px');
      // Render-on-demand viewer needs a kick — viewport size changed, the
      // canvas must re-render at the new aspect ratio.
      if (typeof onWindowResize === 'function') onWindowResize();
      else if (typeof requestRender === 'function') requestRender();
    });
    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('dragging');
      document.body.classList.remove('resizing');
      try {
        const finalW = parseInt(getComputedStyle(root).getPropertyValue(prop), 10);
        if (finalW) localStorage.setItem(side === 'left' ? STORE_L : STORE_R, String(finalW));
      } catch {}
    });
    // Double-click to reset to default — escape hatch for "I dragged too far".
    handle.addEventListener('dblclick', () => {
      const def = side === 'left' ? '280px' : '320px';
      root.style.setProperty(prop, def);
      try { localStorage.removeItem(side === 'left' ? STORE_L : STORE_R); } catch {}
      if (typeof onWindowResize === 'function') onWindowResize();
    });
  }

  attach('resize-l', '--side-l-w', 'left');
  attach('resize-r', '--side-r-w', 'right');
}


// ============== SCENE-LEVEL MERGE + GROUP ==============
// Merge → bake selected geometries into one BufferGeometry with vertex colors.
// Group → wrap selected meshes under a new empty Group node.
// Both register undo so Ctrl+Z restores the prior state.

async function mergeSelectedIntoOne() {
  const ids = [...state.selected];
  if (ids.length < 2) { toast('Select 2+ parts to merge', '', 'warn'); return; }
  // Reversible via Ctrl+Z — no confirm prompt.
  // Detach the gizmo BEFORE we read any matrixWorlds. Same reason as box-ify:
  // _attachGizmoToParts re-parents selected meshes under state.pivot, and
  // Object3D.attach() decomposes the relative matrix into TRS — lossy when
  // the Cinema 4D parent chain has rotation × non-uniform scale (shear).
  // After attach, mesh.matrix is best-fit-TRS rather than exact, so
  // mesh.matrixWorld is subtly wrong. _resolvePartWorldMatrix reads that
  // wrong matrix; merge bakes vertices using it; on multi-part merges the
  // accumulated errors look like an "explosion" — geometry scattered all
  // over the scene.
  _detachGizmo();

  // Auto-promote any selected instanced parts to standalone meshes BEFORE we
  // bake. Without this, the consumed-instance path below zeros the slot but
  // leaves stale references in state.instancedGroups + can mis-restore on
  // undo if anything else mutates the InstancedMesh in between. Promotion
  // turns each one into a standalone Mesh whose lifecycle matches the
  // standalone-merge path exactly — no special cases, no ghosts.
  let promotedForMerge = 0;
  for (const id of ids) {
    const p = getPart(id);
    if (!p || p.deleted) continue;
    if (p.instancedMesh && !p.mesh) {
      if (_promoteInstanceToMesh(p)) promotedForMerge++;
    }
  }
  if (promotedForMerge > 0) {
    Log.info(`promoted ${promotedForMerge} instance${promotedForMerge === 1 ? '' : 's'} for merge`, { tag: 'merge' });
  }

  // Two-pass: pass 1 sums vertex / index counts so we allocate the merged
  // typed arrays once; pass 2 fills them by index. The previous version
  // pushed into JS arrays with Array.prototype.push which on a 1M-vertex
  // merge hit the GC hard (V8 reallocated the underlying backing store ~20×).
  const validParts = [];
  let totalVerts = 0, totalIdxLen = 0;
  let hasNormals = true;       // false if any part lacks normals
  for (const id of ids) {
    const p = getPart(id);
    if (!p || p.deleted) continue;
    // Prefer the part's actual mesh.geometry over the hash lookup. After
    // boxify, multiple parts that previously shared one InstancedMesh may
    // have hashes that collided in geomByHash before we made them unique;
    // mesh.geometry is always the source of truth for what the part
    // actually renders. Fall back to the hash for parts without a mesh
    // (instanced parts that weren't auto-promoted earlier in this op).
    const g = (p.mesh && p.mesh.geometry) ? p.mesh.geometry : state.geomByHash.get(p.hash);
    if (!g) continue;
    const pos = g.attributes.position?.array;
    if (!pos) continue;
    const nrm = g.attributes.normal?.array;
    const idx = g.index?.array;
    const vCount = pos.length / 3;
    const iLen   = idx ? idx.length : vCount;
    if (!nrm) hasNormals = false;
    validParts.push({ p, g, pos, nrm, idx, vCount, iLen });
    totalVerts  += vCount;
    totalIdxLen += iLen;
  }
  if (validParts.length < 2) { toast('Merge skipped', 'Not enough valid geometry', 'warn'); return; }

  const positions = new Float32Array(totalVerts * 3);
  const colors    = new Float32Array(totalVerts * 3);
  const normals   = hasNormals ? new Float32Array(totalVerts * 3) : null;
  const indexCtor = totalVerts > 65535 ? Uint32Array : Uint16Array;
  const indices   = new indexCtor(totalIdxLen);

  let posOff = 0, idxOff = 0, vertBase = 0, totalTris = 0;
  const v3 = new THREE.Vector3(), n3 = new THREE.Vector3();
  const vWorld = new THREE.Vector3();
  const overallBox = new THREE.Box3();
  const consumed = [];

  // The merged mesh will be added to state.partsRoot at IDENTITY transform.
  // partsRoot is auto-rotated (state.autoRotate increments partsRoot.rotation.z
  // every frame) — so its matrixWorld is rarely the identity. If we baked
  // vertices in WORLD space and then put the merged mesh under partsRoot,
  // partsRoot.matrixWorld would rotate them a SECOND time, producing the
  // visible "merged result rotated 90°" symptom (especially on boxified
  // parts where the world-axis-aligned BoxGeometry makes the rotation
  // unmistakable). Fix: compute partsRootInv up front and bake every vertex
  // in partsRoot-LOCAL space. When partsRoot then rotates the merged mesh,
  // the math composes back to the original world position.
  state.partsRoot.updateMatrix();
  state.partsRoot.updateMatrixWorld(true);
  const partsRootInv = new THREE.Matrix4().copy(state.partsRoot.matrixWorld).invert();
  const localFromWorld = new THREE.Matrix4();

  // Local resolver that always returns the LIVE world matrix, not the
  // _exactWorld snapshot. _exactWorld was captured at boxify / load time and
  // doesn't track partsRoot's auto-rotate; if it's stale, composing with
  // partsRootInv_now produces a partsRoot-local position rotated by the
  // partsRoot delta since the snapshot — visible as the "some boxified
  // objects rotate when merging" bug. Live matrixWorld stays in sync.
  const _liveWorld = (p) => {
    const out = new THREE.Matrix4();
    if (p.mesh) {
      p.mesh.updateWorldMatrix(true, false);
      out.copy(p.mesh.matrixWorld);
      return out;
    }
    if (p.instancedMesh) {
      p.instancedMesh.updateWorldMatrix(true, false);
      const local = new THREE.Matrix4();
      p.instancedMesh.getMatrixAt(p.instanceIndex, local);
      out.multiplyMatrices(p.instancedMesh.matrixWorld, local);
      return out;
    }
    return out;
  };

  for (const { p, pos, nrm, idx, vCount, iLen } of validParts) {
    const world = _liveWorld(p);
    // Effective transform from part-local → partsRoot-local. Composes the
    // part's world matrix with partsRoot's inverse.
    localFromWorld.multiplyMatrices(partsRootInv, world);
    const normalMat = new THREE.Matrix3().getNormalMatrix(localFromWorld);
    const cr = p.originalColor.r, cg = p.originalColor.g, cb = p.originalColor.b;
    for (let i = 0; i < vCount; i++) {
      // Compute the WORLD position once for the bbox accumulator (downstream
      // p.bbox is conventionally in world space across this codebase), then
      // bake the partsRoot-LOCAL position into the merged buffer.
      vWorld.set(pos[i*3], pos[i*3+1], pos[i*3+2]).applyMatrix4(world);
      overallBox.expandByPoint(vWorld);
      v3.set(pos[i*3], pos[i*3+1], pos[i*3+2]).applyMatrix4(localFromWorld);
      positions[posOff]     = v3.x;
      positions[posOff + 1] = v3.y;
      positions[posOff + 2] = v3.z;
      colors[posOff]        = cr;
      colors[posOff + 1]    = cg;
      colors[posOff + 2]    = cb;
      posOff += 3;
    }
    if (normals && nrm) {
      let nOff = posOff - vCount * 3;
      for (let i = 0; i < vCount; i++) {
        n3.set(nrm[i*3], nrm[i*3+1], nrm[i*3+2]).applyMatrix3(normalMat).normalize();
        normals[nOff]     = n3.x;
        normals[nOff + 1] = n3.y;
        normals[nOff + 2] = n3.z;
        nOff += 3;
      }
    }
    if (idx) {
      for (let i = 0; i < iLen; i++) indices[idxOff + i] = idx[i] + vertBase;
    } else {
      for (let i = 0; i < iLen; i++) indices[idxOff + i] = i + vertBase;
    }
    idxOff   += iLen;
    vertBase += vCount;
    totalTris += iLen / 3;
    consumed.push(p);
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (normals) merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  merged.computeBoundingBox(); merged.computeBoundingSphere();

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.15, roughness: 0.55, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(merged, mat);
  const newId = (state.parts.length === 0) ? 0 : (Math.max(...state.parts.map(p => p.partId)) + 1);
  mesh.name = `merged_${newId}`;
  mesh.userData.partId = newId;
  state.partsRoot.add(mesh);
  state.partsRoot.updateMatrixWorld(true);

  const m4zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const undoItems = [];
  for (const p of consumed) {
    p.deleted = true;
    if (p.mesh) p.mesh.visible = false;
    if (p.instancedMesh) {
      const prev = new THREE.Matrix4(); p.instancedMesh.getMatrixAt(p.instanceIndex, prev);
      p.instancedMesh.setMatrixAt(p.instanceIndex, m4zero);
      p.instancedMesh.instanceMatrix.needsUpdate = true;
      undoItems.push({ partId: p.partId, prevMat: prev.elements.slice() });
    } else {
      undoItems.push({ partId: p.partId });
    }
  }

  const sz = overallBox.getSize(new THREE.Vector3());
  const avg = new THREE.Color(0, 0, 0);
  for (const p of consumed) avg.add(p.originalColor);
  avg.multiplyScalar(1 / consumed.length);
  const newPart = {
    partId: newId, name: `Merged (${consumed.length} parts)`, hash: 'merged_' + newId,
    triCount: totalTris, vertCount: totalVerts, bbox: overallBox.clone(),
    sizeMetrics: { diag: sz.length(), vol: sz.x*sz.y*sz.z, max: Math.max(sz.x, sz.y, sz.z) },
    visible: true, deleted: false, flagged: false,
    originalColor: avg.clone(),
    mesh, group: null, instanceIndex: -1, instancedMesh: null,
  };
  state.parts.push(newPart);
  state.partById.set(newId, newPart);
  state.geomByHash.set(newPart.hash, merged);
  // Register the new merged part in the hierarchy capture used by the
  // sidebar tree. _rebuildTreeHierarchical iterates state.treeNodes (built
  // once at load time); a part not in that list never renders, regardless
  // of state.parts. New parts created post-load (merge / split) need to
  // be appended explicitly. Top-level placement (depth 0, parentId null)
  // is correct here because the merged mesh lives directly under partsRoot
  // and isn't part of any captured Cinema-4D group hierarchy.
  if (state.treeNodes && Array.isArray(state.treeNodes)) {
    state.treeNodes.push({
      id: newId, kind: 'part', name: newPart.name, depth: 0,
      parentId: null, partId: newId, instanceCount: 0,
    });
  }
  pushUndo({ type: 'merge', mergedPartId: newId, items: undoItems });

  state.selected.clear(); state.selected.add(newId);
  $('del-sel-count').textContent = 1;
  recomputeStats(); rebuildTree(); applySelectionColors();
  refreshPropertiesPanel(); updateGizmo(); requestRender();
  _buildBVHsForAllGeoms();   // merged geom is brand new, build its tree
  toast('Merged', `${consumed.length} parts → 1 mesh (${fmtNum(totalTris)} tri)`, 'success');
}

// Forward declaration — the real implementation is installed below
// (in the user-groups section) and dispatches to addUserGroup(). Keeping the
// `let` binding here means the wireUI hook can reference it before assignment.
let groupSelectedUnderNull = function() { /* installed below */ };

// Extend undoLast for the new op types, via the existing chain pattern.
const _origUndoLast_mergeGroup = undoLast;
undoLast = function() {
  const op = state.history[state.history.length - 1];
  if (op && op.type === 'merge') {
    state.history.pop();
    const mp = getPart(op.mergedPartId);
    if (mp && mp.mesh) {
      mp.mesh.parent?.remove(mp.mesh);
      mp.mesh.geometry?.dispose?.();
      mp.mesh.material?.dispose?.();
    }
    state.partById.delete(op.mergedPartId);
    state.geomByHash.delete('merged_' + op.mergedPartId);
    state.parts = state.parts.filter(p => p.partId !== op.mergedPartId);
    // Pull the merged-part placeholder out of the hierarchy capture too;
    // otherwise the tree would still show the now-orphaned merged row.
    if (state.treeNodes && Array.isArray(state.treeNodes)) {
      state.treeNodes = state.treeNodes.filter(n => n.partId !== op.mergedPartId);
    }
    const m4 = new THREE.Matrix4();
    for (const it of op.items) {
      const p = getPart(it.partId); if (!p) continue;
      p.deleted = false;
      if (p.mesh) p.mesh.visible = p.visible;
      if (p.instancedMesh && it.prevMat) {
        m4.fromArray(it.prevMat);
        p.instancedMesh.setMatrixAt(p.instanceIndex, m4);
        p.instancedMesh.instanceMatrix.needsUpdate = true;
      }
    }
    state.selected.clear();
    // Merge undo destroys the merged buffer + material — there is no clean
    // way to redo without re-running the merge from scratch, so we don't
    // push to state.redo (matches split undo behavior).
    recomputeStats(); refreshFlagged();
    _finalizeUndo({ rebuildTree: true });
    // Restored parts visible in viewport — no toast.
    return;
  }
  if (op && op.type === 'group') {
    state.history.pop();
    const m4 = new THREE.Matrix4();
    for (const it of op.items) {
      const p = getPart(it.partId); if (!p || !p.mesh) continue;
      const targetParent = it.prevParent || state.partsRoot;
      targetParent.attach(p.mesh);
      m4.fromArray(it.prevMatrix);
      p.mesh.matrix.copy(m4);
      p.mesh.matrix.decompose(p.mesh.position, p.mesh.quaternion, p.mesh.scale);
      p.mesh.updateMatrixWorld(true);
    }
    if (op.groupRef && op.groupRef.parent) op.groupRef.parent.remove(op.groupRef);
    // Group is redoable — the data needed to re-create the group lives on
    // the userGroup record (added back below by the user-groups extension)
    // and op.items already carries prevParent + prevMatrix, which is the
    // mirror of the destination state we'd want to reapply. We DON'T push
    // here — the user-groups wrapper at the top of the chain decides
    // whether to push, after it cleans up its own bookkeeping.
    _finalizeUndo({ rebuildTree: true });
    // Tree change visible — no toast.
    return;
  }
  return _origUndoLast_mergeGroup();
};

function _wireMergeGroupButtons() {
  $('btn-merge-sel')?.addEventListener('click', mergeSelectedIntoOne);
  // Indirect through the live binding — the function is reassigned later
  // (by the user-groups extension) and we want the click to invoke whichever
  // implementation is current at click time.
  $('btn-group-sel')?.addEventListener('click', () => groupSelectedUnderNull());
}
const _origWireUI_mergeGroup = wireUI;
wireUI = function() { _origWireUI_mergeGroup(); _safeRun(_wireMergeGroupButtons, 'merge-group'); };

// =================================================================
// USER GROUPS — first-class concept across tree, selection, undo
// =================================================================

if (!state.userGroups)        state.userGroups = [];
if (state._userGroupCount == null) state._userGroupCount = 0;

function getGroupForPart(partId) {
  for (const g of state.userGroups) if (g.partIds.has(partId)) return g;
  return null;
}
function getGroupById(id) { return state.userGroups.find(g => g.id === id) || null; }
function _newGroupId() {
  return '_ug_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e6).toString(36);
}

// Build a group from a list of partIds. Reparents the meshes into a new
// THREE.Group container so the scene graph reflects the grouping.
function addUserGroup(name, partIds, opts = {}) {
  const movable = [];
  let skipped = 0;
  for (const id of partIds) {
    const p = getPart(id);
    if (!p || p.deleted || !p.mesh) { skipped++; continue; }
    movable.push(p);
  }
  if (movable.length === 0) return null;

  const grp = new THREE.Group();
  grp.name = name;
  grp.userData.isUserGroup = true;
  state.partsRoot.add(grp);
  state.partsRoot.updateMatrixWorld(true);

  const undoItems = [];
  for (const p of movable) {
    p.mesh.updateWorldMatrix(true, false);
    undoItems.push({ partId: p.partId, prevParent: p.mesh.parent, prevMatrix: p.mesh.matrix.elements.slice() });
    const old = getGroupForPart(p.partId);
    if (old) old.partIds.delete(p.partId);
    grp.attach(p.mesh);
  }
  // Drop now-empty old groups (and their THREE.Group containers)
  state.userGroups = state.userGroups.filter(g => {
    if (g.partIds.size > 0) return true;
    if (g.ref && g.ref.parent) g.ref.parent.remove(g.ref);
    return false;
  });

  const ug = {
    id: _newGroupId(), name, ref: grp,
    partIds: new Set(movable.map(p => p.partId)),
    expanded: opts.expanded !== false,
  };
  state.userGroups.push(ug);
  state._userGroupCount++;
  if (!opts.skipUndo) {
    pushUndo({ type: 'group', groupObjectName: name, items: undoItems, groupRef: grp, groupRecordId: ug.id });
  }
  return ug;
}

function removeUserGroup(groupId, opts = {}) {
  const idx = state.userGroups.findIndex(g => g.id === groupId);
  if (idx < 0) return;
  const g = state.userGroups[idx];
  // Reparent members back under partsRoot, preserving world transforms
  for (const partId of g.partIds) {
    const p = getPart(partId);
    if (!p || !p.mesh) continue;
    p.mesh.updateWorldMatrix(true, false);
    state.partsRoot.attach(p.mesh);
  }
  if (g.ref && g.ref.parent) g.ref.parent.remove(g.ref);
  state.userGroups.splice(idx, 1);
  if (!opts.skipRebuild) rebuildTree();
  requestRender();
}

function renameUserGroup(groupId, name) {
  const g = getGroupById(groupId);
  if (!g) return;
  g.name = name;
  if (g.ref) g.ref.name = name;
  rebuildTree();
}

// Sweep the tree for groups that no longer have any LIVE members and remove
// them. Runs in two passes:
//   1. user groups — empty when every member partId is missing or deleted.
//      Iterating over a snapshot of the array because removeUserGroup splices
//      state.userGroups in place.
//   2. hierarchy groups — every Object3D in the partsRoot subtree that's not
//      an instanced mesh container and has no live-mesh descendants. Walks
//      bottom-up so a leaf-empty group becomes a candidate for its parent.
//      Skips state.partsRoot itself and any node holding an InstancedMesh
//      (those share-children semantics confuse the "no live mesh" check).
//
// Lives meshes are ones whose corresponding partInfo isn't deleted. Hidden
// parts still count as live — invisibility isn't deletion.
function cleanEmptyGroups() {
  const liveMeshes = new Set();
  for (const p of state.parts) {
    if (p.deleted) continue;
    if (p.mesh) liveMeshes.add(p.mesh);
    if (p.instancedMesh) liveMeshes.add(p.instancedMesh);
  }

  let removedUser = 0;
  // Snapshot — removeUserGroup mutates the underlying array.
  for (const ug of [...(state.userGroups || [])]) {
    let liveCount = 0;
    for (const partId of ug.partIds) {
      const p = getPart(partId);
      if (p && !p.deleted) liveCount++;
    }
    if (liveCount === 0) {
      removeUserGroup(ug.id, { skipRebuild: true });
      removedUser++;
    }
  }

  // Hierarchy-group sweep. Walk the partsRoot subtree bottom-up so emptying a
  // child group can cascade into its parent. We do this by collecting all
  // candidate Object3Ds into an array first, then iterating in reverse depth
  // order (deepest first). A "live descendant" check uses the liveMeshes set.
  let removedHier = 0;
  const candidates = [];
  state.partsRoot?.traverse(o => {
    if (o === state.partsRoot) return;
    if (o.isMesh) return;
    if (!o.children || o.children.length === 0) return;
    // Don't touch the synthetic export-baking groups or other helper roots.
    if (o.userData && o.userData._systemGroup) return;
    candidates.push(o);
  });
  // Sort by descending depth so children are evaluated before parents. Depth
  // is just the number of ancestor hops to partsRoot.
  const depthOf = (n) => { let d = 0; while (n.parent && n !== state.partsRoot) { d++; n = n.parent; } return d; };
  candidates.sort((a, b) => depthOf(b) - depthOf(a));

  const hasLive = (root) => {
    let found = false;
    root.traverse(c => { if (found) return; if (liveMeshes.has(c)) found = true; });
    return found;
  };

  // Track which treeNodes / userGroup refs we removed so the tree rebuild
  // doesn't try to render dangling references.
  const removedObj3ds = new Set();
  for (const o of candidates) {
    // If a descendant was removed in this pass, treat its now-detached state
    // as "no live mesh" — easy because the live check walks the current tree.
    if (hasLive(o)) continue;
    if (o.parent) o.parent.remove(o);
    removedObj3ds.add(o);
    removedHier++;
  }

  // Drop matching entries from state.treeNodes so the renderer doesn't show
  // ghost rows. A treeNode is dead if its obj3d was removed OR if its obj3d
  // is still alive but no longer reachable from partsRoot (orphaned).
  if (state.treeNodes && state.treeNodes.length) {
    const reachable = new Set();
    state.partsRoot?.traverse(c => reachable.add(c));
    state.treeNodes = state.treeNodes.filter(n => {
      if (n.kind !== 'group') return true;
      if (!n.obj3d) return true;            // synthetic Untraced header — leave alone
      if (removedObj3ds.has(n.obj3d)) return false;
      return reachable.has(n.obj3d);
    });
  }

  rebuildTree();
  requestRender();
  const total = removedUser + removedHier;
  if (total === 0) {
    toast('No empty groups', 'Every group still has at least one part', 'info', 2500);
  } else {
    const parts = [];
    if (removedUser) parts.push(`${removedUser} user group${removedUser === 1 ? '' : 's'}`);
    if (removedHier) parts.push(`${removedHier} hierarchy group${removedHier === 1 ? '' : 's'}`);
    toast('Empty groups removed', parts.join(' + '), 'success');
    Log.success(`Removed ${total} empty groups (${parts.join(', ')})`, { tag: 'cleanup' });
  }
}

function selectGroup(groupId, mode = 'single') {
  const g = getGroupById(groupId);
  if (!g) return;
  if (mode === 'single') state.selected.clear();
  for (const partId of g.partIds) {
    if (mode === 'toggle' && state.selected.has(partId)) state.selected.delete(partId);
    else state.selected.add(partId);
  }
  applySelectionColors(); rebuildTreeSelectionOnly(); refreshPropertiesPanel();
  if (typeof updateGizmo === 'function') updateGizmo();
  $('del-sel-count').textContent = state.selected.size;
  requestRender();
}

function toggleGroupVisibility(groupId) {
  const g = getGroupById(groupId);
  if (!g) return;
  let allHidden = true;
  for (const partId of g.partIds) {
    const p = getPart(partId);
    if (p && p.visible) { allHidden = false; break; }
  }
  const next = allHidden;
  for (const partId of g.partIds) {
    const p = getPart(partId);
    if (!p) continue;
    p.visible = next;
    if (p.mesh) p.mesh.visible = next;
  }
  rebuildTree(); requestRender();
}

// Install the real groupSelectedUnderNull (declared above as a `let` stub).
// Routes through _dndDoNewGroupFromRows so hierarchical models get a proper
// hier-tree group node (preserving the rest of the tree structure) and flat
// models get a userGroup overlay. Going straight to addUserGroup() here was
// the cause of "tree structure disappears, only the new folder shows" on
// hierarchical files — the userGroups rebuildTree wrapper takes precedence
// once userGroups.length > 0 and renders a flat list.
groupSelectedUnderNull = async function() {
  const ids = [...state.selected];
  if (ids.length < 1) { toast('Select parts to group', '', 'warn'); return; }
  const movableIds = [];
  let skipped = 0;
  for (const id of ids) {
    const p = getPart(id);
    if (!p || p.deleted) continue;
    if (p.mesh) movableIds.push(id); else skipped++;
  }
  if (movableIds.length === 0) {
    toast('Nothing to group', skipped ? `${skipped} parts are instanced and can't be reparented` : '', 'warn');
    return;
  }
  const defaultName = 'Group ' + ((state._userGroupCount || 0) + 1);
  const entered = await appPrompt('Group name', defaultName, { title: 'New group', okLabel: 'Create' });
  if (entered === null) return;     // user cancelled
  const groupName = entered.trim() || defaultName;

  // Resolve the selected partIds to their tree DOM rows — _dndDoNewGroupFromRows
  // expects rows (it reads dataset.partId/groupId via _hierNodeIndex). Falls
  // back to a synthetic row stub if the part isn't currently in the DOM
  // (filtered out by search, etc.) — _hierNodeIndex only needs the dataset.
  const treeEl = $('tree');
  const rows = [];
  for (const id of movableIds) {
    const realRow = treeEl?.querySelector(`.tree-node[data-part-id="${id}"]`);
    if (realRow) rows.push(realRow);
    else rows.push({ dataset: { partId: String(id) }, classList: { contains: () => false } });
  }
  const ctx = (typeof _dndContext === 'function') ? _dndContext() : 'flat';
  _dndDoNewGroupFromRows(rows, ctx, groupName);
  if (skipped && typeof toast === 'function') {
    toast('Some parts skipped', `${skipped} instanced parts can't be reparented`, 'warn');
  }
  // Hier path doesn't auto-rebuild — make sure the new group renders.
  if (ctx === 'hier') rebuildTree();
};

// Extend undoLast: 'group' op also removes the userGroup record
const _origUndoLast_userGroups = undoLast;
undoLast = function() {
  const op = state.history[state.history.length - 1];
  if (op && op.type === 'group' && op.groupRecordId) {
    const result = _origUndoLast_userGroups();
    const idx = state.userGroups.findIndex(g => g.id === op.groupRecordId);
    if (idx >= 0) state.userGroups.splice(idx, 1);
    rebuildTree();
    return result;
  }
  return _origUndoLast_userGroups();
};

// Clear groups when model is cleared
const _origClearModel_userGroups = clearModel;
clearModel = function() {
  state.userGroups = [];
  state._userGroupCount = 0;
  return _origClearModel_userGroups();
};

// =================================================================
// Tree rendering — show user groups as parent nodes with children
// =================================================================
const _origRebuildTree_userGroups = rebuildTree;
rebuildTree = function() {
  const root = $('tree');
  if (!root) return _origRebuildTree_userGroups();
  // Defer to base when there's nothing to do
  if (state.parts.length === 0) return _origRebuildTree_userGroups();
  if (!state.userGroups || state.userGroups.length === 0) return _origRebuildTree_userGroups();

  const ft = ($('tree-filter').value || '').toLowerCase();
  const aliveParts = state.parts.filter(p => !p.deleted);
  const visible = aliveParts
    .filter(p => !ft || p.name.toLowerCase().includes(ft))
    .sort(_treeSortFn(state.sortMode));
  $('tree-summary').textContent = `${visible.length} of ${aliveParts.length} parts`;

  // Bucket parts by their owning user group
  const partToGroup = new Map();
  for (const g of state.userGroups) for (const id of g.partIds) partToGroup.set(id, g.id);
  const buckets = new Map();
  for (const g of state.userGroups) buckets.set(g.id, []);
  const loose = [];
  for (const p of visible) {
    const gid = partToGroup.get(p.partId);
    if (gid && buckets.has(gid)) buckets.get(gid).push(p);
    else loose.push(p);
  }

  root.innerHTML = '';
  const maxTri = Math.max(1, ...state.parts.map(p => p.triCount));
  const logMax = Math.log10(maxTri + 1);
  const frag = document.createDocumentFragment();

  function _buildLeafNode(p, isInGroup) {
    const node = document.createElement('div');
    node.className = 'tree-node';
    if (isInGroup) node.classList.add('in-group');
    if (state.selected.has(p.partId)) node.classList.add('selected');
    if (!p.visible) node.classList.add('hidden-vis');
    if (p.flagged) node.classList.add('flagged');
    if (p.locked) node.style.fontStyle = 'italic';
    node.dataset.partId = p.partId;
    const colorHex = '#' + p.originalColor.getHexString();
    const eye = p.visible
      ? `<i data-lucide="eye"></i>`
      : `<i data-lucide="eye-off"></i>`;
    const inst = _instBadge(p.group ? p.group.parts.length : 0);
    const lockIcon = p.locked ? `<span title="Locked" style="opacity:.6;font-size:10px">🔒</span>` : '';
    const triFrac = Math.log10(p.triCount + 1) / logMax;
    const barHue = 240 - triFrac * 240;
    const barW = Math.max(2, triFrac * 40) | 0;
    const bar = `<span style="display:inline-block;width:${barW}px;height:6px;background:hsl(${barHue},70%,55%);border-radius:2px;vertical-align:middle;margin-right:4px"></span>`;
    node.innerHTML = `${lockIcon}<span class="tree-label">${escapeHtml(p.name)}${inst}</span>${bar}<span class="tree-meta">${fmtNum(p.triCount)}</span><span class="tree-iconcol"><span class="tree-vis">${eye}</span><span class="tree-color" style="background:${colorHex}"></span></span>`;
    return node;
  }

  function _buildGroupHeader(g) {
    const members = buckets.get(g.id) || [];
    const allSelected  = members.length > 0 && members.every(p => state.selected.has(p.partId));
    const someSelected = !allSelected && members.some(p => state.selected.has(p.partId));
    const allHidden    = members.length > 0 && members.every(p => !p.visible);

    const ghdr = document.createElement('div');
    ghdr.className = 'tree-node is-group';
    if (!g.expanded) ghdr.classList.add('collapsed');
    if (allSelected || someSelected) ghdr.classList.add('selected');
    if (allHidden) ghdr.classList.add('hidden-vis');
    ghdr.dataset.groupId = g.id;
    const eye = !allHidden
      ? `<i data-lucide="eye"></i>`
      : `<i data-lucide="eye-off"></i>`;
    ghdr.innerHTML =
      `<span class="tree-chev" data-act="toggle">▾</span>` +
      `<span class="tree-folder"><i data-lucide="folder"></i></span>` +
      `<span class="tree-label">${g.name} <span class="tree-badge">${g.partIds.size}</span></span>` +
      `<span class="tree-group-actions">` +
        `<button data-act="rename" title="Rename"><i data-lucide="pencil"></i></button>` +
        `<button data-act="ungroup" title="Ungroup"><i data-lucide="x"></i></button>` +
      `</span>` +
      `<span class="tree-iconcol"><span class="tree-vis" data-act="vis">${eye}</span></span>`;
    return { ghdr, members };
  }

  // Inline group rendering: each group appears at the position of its FIRST
  // member in the visible/sorted list, not pinned to the top of the tree.
  // That way "Group selected" leaves the new group near where the user was
  // working instead of jumping it to the top.
  const groupById = new Map(state.userGroups.map(g => [g.id, g]));
  const renderedGroups = new Set();
  const MAX = 5000;
  let drawn = 0;

  for (const p of visible) {
    if (drawn >= MAX) break;
    const gid = partToGroup.get(p.partId);
    if (gid && !renderedGroups.has(gid)) {
      const g = groupById.get(gid);
      if (g) {
        const { ghdr, members } = _buildGroupHeader(g);
        frag.appendChild(ghdr);
        if (g.expanded) {
          for (const m of members) {
            if (drawn >= MAX) break;
            frag.appendChild(_buildLeafNode(m, true));
            drawn++;
          }
        }
        renderedGroups.add(gid);
      }
    } else if (!gid) {
      frag.appendChild(_buildLeafNode(p, false));
      drawn++;
    }
    // else: part is in an already-rendered group → skip (its header emitted
    // it already as a child).
  }
  root.appendChild(frag);

  if (drawn >= MAX) {
    const more = document.createElement('div');
    more.style.cssText = 'padding:8px 14px;color:var(--tx3);font-size:11px;';
    more.textContent = `… more parts not shown (use search)`;
    root.appendChild(more);
  }

  if (typeof buildMaterialsPanel === 'function') buildMaterialsPanel();
};

// =================================================================
// Tree click handlers — group rows + dead control buttons
// =================================================================
function _wireUserGroupTreeHandlers() {
  $('tree')?.addEventListener('click', e => {
    const groupNode = e.target.closest('.tree-node.is-group');
    if (!groupNode) return;
    const gid = groupNode.dataset.groupId;
    if (!gid) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    e.stopPropagation();
    if (act === 'toggle') {
      const g = getGroupById(gid); if (g) { g.expanded = !g.expanded; rebuildTree(); }
      return;
    }
    if (act === 'vis')     { toggleGroupVisibility(gid); return; }
    if (act === 'rename')  {
      const g = getGroupById(gid); if (!g) return;
      appPrompt('Rename group', g.name, { title: 'Rename group', okLabel: 'Rename' }).then(next => {
        if (next && next.trim()) renameUserGroup(gid, next.trim());
      });
      return;
    }
    if (act === 'ungroup') {
      removeUserGroup(gid);
      Log.info('Ungrouped', { tag: 'group' });
      // Tree change visible — no toast.
      return;
    }
    selectGroup(gid, e.shiftKey ? 'add' : (e.ctrlKey || e.metaKey ? 'toggle' : 'single'));
  });
}

// Hook up the previously-dead controls in the search/sort row
function _wireDeadTreeControls() {
  $('tree-sort')?.addEventListener('change', e => {
    state.sortMode = e.target.value;
    rebuildTree();
    Log.debug(`Sort: ${state.sortMode}`, { tag: 'tree' });
  });
  $('tree-hide-unsel')?.addEventListener('click', () => {
    if (!state.parts.length) return;
    if (state.selected.size === 0) { toast('Nothing selected', '', 'warn'); return; }
    let n = 0;
    for (const p of state.parts) {
      if (p.deleted) continue;
      const keep = state.selected.has(p.partId);
      if (!keep && p.visible) { p.visible = false; if (p.mesh) p.mesh.visible = false; n++; }
    }
    rebuildTree(); requestRender();
    // Visibility change is visible in the viewport — no toast.
  });
  $('tree-show-all')?.addEventListener('click', () => {
    if (typeof showAllParts === 'function') showAllParts();
  });
  $('tree-sel-back')?.addEventListener('click', () => { if (typeof selectionBack === 'function') selectionBack(); });
  $('tree-sel-fwd')?.addEventListener('click',  () => { if (typeof selectionFwd === 'function') selectionFwd(); });
  // Expand / collapse all groups in one shot. Toggles between the two states
  // by checking whether ANY collapsible row is currently expanded — if yes,
  // collapse them all; otherwise expand them all. Covers both data sources:
  //   - state.treeCollapsed: hierarchical-tree node IDs (set membership)
  //   - state.userGroups[].expanded: user-created groups
  const _toggleBtn = $('tree-collapse-toggle');
  const updateToggleIcon = () => {
    if (!_toggleBtn) return;
    const anyUserExpanded   = (state.userGroups || []).some(g => g.expanded);
    const anyHierExpanded   = state.treeNodes && state.treeNodes.length > 0 && state.treeCollapsed.size === 0;
    const anyExpanded = anyUserExpanded || anyHierExpanded;
    const iconName = anyExpanded ? 'chevrons-down-up' : 'chevrons-up-down';
    // Replace the entire content with a fresh <i> placeholder. After the
    // first Lucide pass the original <i> has been replaced with an <svg>,
    // so querySelector('i[data-lucide]') returns null and the previous
    // setAttribute approach silently did nothing — the icon never swapped.
    // Reset to a placeholder and re-run Lucide.
    _toggleBtn.innerHTML = `<i data-lucide="${iconName}"></i>`;
    _toggleBtn.title = anyExpanded ? 'Collapse all groups' : 'Expand all groups';
    if (typeof _lucide === 'function') _lucide();
  };
  _toggleBtn?.addEventListener('click', () => {
    if (!state.parts.length) { toast('No model loaded', '', 'info'); return; }
    // Decide direction: if anything is currently expanded, collapse; else expand.
    const anyUserExpanded   = (state.userGroups || []).some(g => g.expanded);
    const anyHierExpanded   = state.treeCollapsed.size === 0;
    const collapse = anyUserExpanded || anyHierExpanded;
    if (collapse) {
      for (const g of (state.userGroups || [])) g.expanded = false;
      for (const n of (state.treeNodes || [])) {
        if (n.kind === 'group' && n.id != null) state.treeCollapsed.add(n.id);
      }
    } else {
      for (const g of (state.userGroups || [])) g.expanded = true;
      state.treeCollapsed.clear();
    }
    // Fast path when there's no search filter and no user groups: walk every
    // row in DOM and update its .is-hidden / .collapsed / +- glyph from the
    // (newly-mutated) state.treeCollapsed set. Avoids the full rebuildTree
    // → _rebuildTreeHierarchical → _lucide() chain that on a 9700-node tree
    // does ~20k icon-placeholder replacements and feels like the button
    // isn't responding (rebuild visibly takes >1s on this size).
    const noSearch = ($('tree-filter').value || '') === '';
    const noUserGroups = !(state.userGroups && state.userGroups.length);
    const treeEl = $('tree');
    if (noSearch && noUserGroups && treeEl && state.treeNodes && state.treeNodes.length) {
      const rows = treeEl.querySelectorAll('.tree-node');
      for (const row of rows) {
        if (row.classList.contains('is-group')) {
          const gid = parseInt(row.dataset.groupId || '0', 10);
          const isColl = state.treeCollapsed.has(gid);
          row.classList.toggle('collapsed', isColl);
          const exp = row.querySelector('.tree-expand');
          if (exp) exp.textContent = isColl ? '+' : '−';
        }
        const anc = (row.dataset.ancestorGroups || '').split(' ');
        let hide = false;
        for (let i = 0; i < anc.length; i++) {
          if (!anc[i]) continue;
          if (state.treeCollapsed.has(parseInt(anc[i], 10))) { hide = true; break; }
        }
        row.classList.toggle('is-hidden', hide);
      }
    } else {
      // Slow path: search filter or user groups force a full rebuild because
      // visibility composition gets non-trivial there.
      rebuildTree();
    }
    updateToggleIcon();
  });
  // Run once after wiring so the icon reflects initial (mostly-expanded) state.
  setTimeout(updateToggleIcon, 0);

  // ── Flatten ─────────────────────────────────────────────────────────────
  // Promote every Mesh in the partsRoot subtree to be a direct child of
  // partsRoot, then drop every empty container. Result: a single-level tree
  // with no groups. Destructive (group names + nesting are lost forever) so
  // we confirm first. World transforms are preserved via Object3D.attach,
  // which composes parent.matrixWorld into the child's local matrix before
  // reparenting.
  $('tree-flatten')?.addEventListener('click', flattenTree);
}

// Compute the depth of an Object3D relative to state.partsRoot. Direct
// children of partsRoot have depth 0; their descendants have higher depth.
function _depthFromPartsRoot(obj) {
  let d = 0;
  let cur = obj.parent;
  while (cur && cur !== state.partsRoot) { d++; cur = cur.parent; }
  return d;
}

// =====================================================================
// Advanced flatten — Pixyz-style total control over hierarchy collapse.
// =====================================================================
// Each operation reduces to: pick a SCOPE (a set of THREE.Group containers
// to consider), pick an ACTION (which of those to dissolve), then dissolve
// (reparent children up via attach() to preserve world transform).
// Everything funnels through _runFlattenOps so finalize / rebuild is shared.

const _FlattenDialog = (() => {
  let bg, card;
  const STATE = { resolve: null };

  function _injectStyles() {
    if (document.getElementById('_flat-dlg-style')) return;
    const s = document.createElement('style');
    s.id = '_flat-dlg-style';
    // Only flatten-specific content classes — chrome (bg, card, header, body,
    // footer, buttons) reuses the global .modal pattern from index.html.
    s.textContent = `
      /* Chrome (card, head, body, footer) is provided by _DraggablePopup.
         Only Advanced flatten content classes live here. */
      #_flat-dialog .flat-section{margin-bottom:14px}
      #_flat-dialog .flat-section:last-child{margin-bottom:0}
      #_flat-dialog .flat-section-title{font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--tx3);margin:0 0 8px 0}
      #_flat-dialog .flat-opts{display:flex;flex-direction:column;gap:6px}
      #_flat-dialog .flat-opt{display:flex;align-items:flex-start;gap:11px;padding:10px 12px;border:1px solid rgba(255,255,255,.06);border-radius:9px;background:rgba(255,255,255,.02);cursor:pointer;transition:background .14s ease,border-color .14s ease}
      #_flat-dialog .flat-opt:hover{background:rgba(255,255,255,.04);border-color:rgba(255,255,255,.10)}
      #_flat-dialog .flat-opt.active{background:rgba(110,168,255,.10);border-color:rgba(110,168,255,.35)}
      #_flat-dialog .flat-opt input[type=radio]{appearance:none;-webkit-appearance:none;width:14px;height:14px;border-radius:50%;border:1.5px solid rgba(255,255,255,.22);background:transparent;cursor:pointer;flex-shrink:0;display:grid;place-items:center;margin:2px 0 0 0;transition:border-color .14s ease,background .14s ease}
      #_flat-dialog .flat-opt input[type=radio]:hover{border-color:rgba(255,255,255,.34)}
      #_flat-dialog .flat-opt input[type=radio]:checked{border-color:var(--ac);background:var(--ac)}
      #_flat-dialog .flat-opt input[type=radio]:checked::after{content:'';width:5px;height:5px;border-radius:50%;background:#fff}
      #_flat-dialog .flat-opt-text{flex:1;min-width:0}
      #_flat-dialog .flat-opt-label{font-size:13px;font-weight:500;color:var(--tx);margin-bottom:3px;letter-spacing:-.005em}
      #_flat-dialog .flat-opt-help{font-size:11.5px;color:var(--tx3);line-height:1.45}
      #_flat-dialog .flat-opt-help code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--ac);background:rgba(0,0,0,.28);padding:0 5px;border-radius:4px;font-size:11px}
      #_flat-dialog .flat-row{display:flex;align-items:center;gap:8px;margin-top:9px}
      #_flat-dialog .flat-row label{font-size:11px;color:var(--tx3);font-weight:500;letter-spacing:.005em}
      #_flat-dialog .flat-row input[type=number]{width:72px;padding:6px 9px;background:rgba(0,0,0,.24);border:1px solid rgba(255,255,255,.06);border-radius:7px;color:var(--tx);font:inherit;font-size:12.5px;outline:none;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;transition:border-color .14s ease,box-shadow .14s ease;box-shadow:inset 0 1px 0 rgba(0,0,0,.25)}
      #_flat-dialog .flat-row input[type=number]:focus{border-color:rgba(110,168,255,.55);box-shadow:0 0 0 3px rgba(110,168,255,.18),inset 0 1px 0 rgba(0,0,0,.25)}
      #_flat-dialog .flat-toggles{display:flex;flex-direction:column;gap:2px}
      #_flat-dialog .flat-tog{display:flex;align-items:center;gap:10px;font-size:12.5px;color:var(--tx2);cursor:pointer;padding:7px 8px;border-radius:7px;transition:background .14s ease,color .14s ease}
      #_flat-dialog .flat-tog:hover{background:rgba(255,255,255,.03);color:var(--tx)}
      #_flat-dialog .flat-tog input[type=checkbox]{appearance:none;-webkit-appearance:none;width:14px;height:14px;border-radius:4px;border:1.5px solid rgba(255,255,255,.22);background:transparent;cursor:pointer;flex-shrink:0;display:grid;place-items:center;margin:0;transition:border-color .14s ease,background .14s ease}
      #_flat-dialog .flat-tog input[type=checkbox]:hover{border-color:rgba(255,255,255,.34)}
      #_flat-dialog .flat-tog input[type=checkbox]:checked{background:var(--ac);border-color:var(--ac)}
      #_flat-dialog .flat-tog input[type=checkbox]:checked::after{content:'';width:8px;height:8px;background:no-repeat center/8px url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'><path d='M2.5 6.2 5 8.6l4.5-5.2' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/></svg>")}
      #_flat-dialog .flat-info{font-size:11.5px;color:var(--tx3);flex:1;min-width:0;text-align:left;letter-spacing:.005em}
      #_flat-dialog .dlg-foot #_flat-ok{box-shadow:0 4px 14px rgba(110,168,255,.30),inset 0 1px 0 rgba(255,255,255,.20),inset 0 0 0 1px rgba(255,255,255,.06)}
      #_flat-dialog .dlg-foot #_flat-ok:disabled{opacity:.40;filter:grayscale(.3) brightness(.85);cursor:not-allowed;box-shadow:none}
    `;
    document.head.appendChild(s);
  }

  function _close(result) {
    if (!bg) return;
    bg.classList.remove('show');
    const f = STATE.resolve; STATE.resolve = null;
    if (f) f(result);
  }

  function _ensure() {
    if (bg) return;
    _injectStyles();

    const bodyHtml = `
      <div class="flat-section">
        <div class="flat-section-title">Scope</div>
        <div class="flat-opts" id="_flat-scope">
          <label class="flat-opt"><input type="radio" name="flat-scope" value="all" checked>
            <div class="flat-opt-text">
              <div class="flat-opt-label">Whole tree</div>
              <div class="flat-opt-help">Operate on every container under the model root.</div>
            </div></label>
          <label class="flat-opt"><input type="radio" name="flat-scope" value="selected">
            <div class="flat-opt-text">
              <div class="flat-opt-label">Selected groups only</div>
              <div class="flat-opt-help" id="_flat-sel-help">Apply only inside the groups currently selected in the tree.</div>
            </div></label>
        </div>
      </div>

      <div class="flat-section">
        <div class="flat-section-title">Action</div>
        <div class="flat-opts" id="_flat-mode">
          <label class="flat-opt active"><input type="radio" name="flat-mode" value="total" checked>
            <div class="flat-opt-text">
              <div class="flat-opt-label">Total flatten</div>
              <div class="flat-opt-help">Dissolve every group inside the scope. All parts become direct children of the scope root.</div>
            </div></label>
          <label class="flat-opt"><input type="radio" name="flat-mode" value="keep">
            <div class="flat-opt-text">
              <div class="flat-opt-label">Keep top N levels</div>
              <div class="flat-opt-help">Keep N nesting levels from the scope root, dissolve everything deeper.</div>
              <div class="flat-row"><label>Levels to keep</label><input type="number" id="_flat-keep" value="1" min="1" max="32" step="1"></div>
            </div></label>
          <label class="flat-opt"><input type="radio" name="flat-mode" value="last">
            <div class="flat-opt-text">
              <div class="flat-opt-label">Flatten last level only</div>
              <div class="flat-opt-help">Only dissolve the deepest groups (the ones whose children are all parts). Keeps the upper assembly hierarchy intact.</div>
            </div></label>
          <label class="flat-opt"><input type="radio" name="flat-mode" value="chains">
            <div class="flat-opt-text">
              <div class="flat-opt-label">Collapse single-child chains</div>
              <div class="flat-opt-help">Removes pass-through wrappers like <code>a / b / c / leaf</code> → <code>leaf</code>. Common cleanup for STEP files with redundant assembly nesting.</div>
            </div></label>
          <label class="flat-opt"><input type="radio" name="flat-mode" value="ungroup">
            <div class="flat-opt-text">
              <div class="flat-opt-label">Ungroup (dissolve scope itself)</div>
              <div class="flat-opt-help">Remove the scope group(s), promoting their children one level up. No-op when scope is whole tree.</div>
            </div></label>
        </div>
      </div>

      <div class="flat-section">
        <div class="flat-section-title">Options</div>
        <div class="flat-toggles">
          <label class="flat-tog"><input type="checkbox" id="_flat-preserve-ug" checked>
            Preserve user groups (groups you created with “Group selection”)</label>
          <label class="flat-tog"><input type="checkbox" id="_flat-clean-empty" checked>
            Remove empty groups left behind</label>
          <label class="flat-tog"><input type="checkbox" id="_flat-collapse-after">
            Also collapse single-child chains afterwards</label>
        </div>
      </div>`;

    const footHtml = `
      <div class="flat-info" id="_flat-info">—</div>
      <div style="display:flex;gap:8px">
        <button class="dlg-btn dlg-btn-cancel" id="_flat-cancel">Cancel</button>
        <button class="dlg-btn dlg-btn-ok" id="_flat-ok">Apply</button>
      </div>`;

    const popup = _DraggablePopup.create({
      id: '_flat-dialog',
      title: 'Advanced flatten',
      subtitle: 'Reduce hierarchy depth · Ctrl+Z reverts',
      iconName: 'layers',
      width: 580, height: 720,
      minWidth: 460, minHeight: 480,
      bodyHtml,
      footHtml,
      bodyScroll: true,
      onClose: () => _close(null),
    });
    bg = popup.el;
    card = popup.card;

    bg.querySelector('#_flat-cancel').addEventListener('click', () => _close(null));
    bg.querySelector('#_flat-ok').addEventListener('click', () => _close(_collect()));

    // Ctrl/Cmd+Enter applies. Escape and click-outside are handled by
    // _DraggablePopup which routes through onClose → _close(null).
    document.addEventListener('keydown', e => {
      if (!bg.classList.contains('show')) return;
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target.tagName !== 'INPUT') {
        e.preventDefault(); _close(_collect());
      }
    }, true);

    // Highlight the active option card. Radio change toggles .active on the
    // closest .flat-opt — gives the whole card a visible accent fill, not
    // just the radio dot.
    const syncActive = () => {
      bg.querySelectorAll('input[name="flat-mode"]').forEach(r => {
        r.closest('.flat-opt').classList.toggle('active', r.checked);
      });
      bg.querySelectorAll('input[name="flat-scope"]').forEach(r => {
        r.closest('.flat-opt').classList.toggle('active', r.checked);
      });
    };
    bg.addEventListener('change', syncActive);
    syncActive();
  }

  function _collect() {
    const mode = bg.querySelector('input[name="flat-mode"]:checked')?.value || 'total';
    const scope = bg.querySelector('input[name="flat-scope"]:checked')?.value || 'all';
    const keep = Math.max(1, parseInt(bg.querySelector('#_flat-keep').value, 10) || 1);
    return {
      mode, scope, keep,
      preserveUserGroups: bg.querySelector('#_flat-preserve-ug').checked,
      cleanEmpty: bg.querySelector('#_flat-clean-empty').checked,
      collapseAfter: bg.querySelector('#_flat-collapse-after').checked,
    };
  }

  return {
    async open({ selectedGroupCount = 0, currentMaxDepth = 0, selectedNames = [] } = {}) {
      _ensure();
      const help = bg.querySelector('#_flat-sel-help');
      const selOpt = bg.querySelector('input[name="flat-scope"][value="selected"]');
      if (selectedGroupCount > 0) {
        const preview = selectedNames.slice(0, 3).map(n => `“${n}”`).join(', ');
        const more = selectedNames.length > 3 ? ` + ${selectedNames.length - 3} more` : '';
        help.innerHTML = `Apply only inside <strong>${selectedGroupCount}</strong> selected group${selectedGroupCount === 1 ? '' : 's'}: ${preview}${more}.`;
        selOpt.disabled = false;
        selOpt.closest('.flat-opt').style.opacity = '1';
        selOpt.checked = true;
        bg.querySelector('input[name="flat-scope"][value="all"]').checked = false;
      } else {
        help.textContent = 'Click a group row in the tree (or shift-click multiple) to enable scoping.';
        selOpt.disabled = true;
        selOpt.closest('.flat-opt').style.opacity = '.5';
        bg.querySelector('input[name="flat-scope"][value="all"]').checked = true;
      }
      bg.querySelector('#_flat-info').textContent =
        `Tree nests ${currentMaxDepth} level${currentMaxDepth === 1 ? '' : 's'} deep. Ctrl+Z undoes any flatten.`;
      bg.querySelectorAll('input[name="flat-mode"]').forEach((r, i) => { r.checked = i === 0; });
      bg.querySelectorAll('input[name="flat-scope"]').forEach(r => r.dispatchEvent(new Event('change', { bubbles: true })));
      _lucide();
      bg.classList.add('show');
      return new Promise(res => { STATE.resolve = res; });
    },
  };
})();

// Build the list of THREE.Group containers we'll iterate based on dialog scope.
// Returns an array of { root, label } where root is a THREE.Object3D under
// which we'll process containers. If scope='all', returns [{ root: partsRoot }].
function _flattenScopeRoots(scope) {
  if (scope !== 'selected') return [{ root: state.partsRoot, label: 'tree' }];
  const ids = state.selectedGroupIds ? Array.from(state.selectedGroupIds) : [];
  if (!ids.length) return [];
  const roots = [];
  for (const gid of ids) {
    const node = (state.treeNodes || []).find(n => n.kind === 'group' && n.id === gid);
    if (node?.obj3d) roots.push({ root: node.obj3d, label: node.name || ('Group ' + gid) });
    else {
      // user group fallback
      const ug = (state.userGroups || []).find(g => g.id === gid);
      if (ug?.ref) roots.push({ root: ug.ref, label: ug.name || ('Group ' + gid) });
    }
  }
  return roots;
}

// Is this Object3D one of our user-created groups? Survives `preserveUserGroups`.
function _isUserGroupObj(obj) {
  return !!(obj && obj.userData && obj.userData.isUserGroup);
}

// Reparent every child of `obj` to `obj.parent` (preserving world transform)
// and remove the now-empty `obj`. Returns true if the dissolve happened.
// If `snapshots` is given, push a record sufficient to undo the dissolve:
// the group's prev parent + local matrix, and each child's prev local matrix
// (captured BEFORE attach() rewrites them into parent's frame).
function _dissolveContainer(obj, snapshots) {
  const parent = obj.parent;
  if (!parent) return false;
  if (snapshots) {
    snapshots.push({
      kind: 'dissolve',
      group: obj,
      prevParent: parent,
      prevLocalMatrix: obj.matrix.clone(),
      prevSiblingIndex: parent.children.indexOf(obj),
      children: obj.children.map(c => ({ obj: c, prevLocalMatrix: c.matrix.clone() })),
    });
  }
  // Capture obj's slot in parent.children BEFORE attach() shuffles things.
  // attach() preserves world transform but always appends children to the end
  // of parent.children — that's why parts visually "jumped to the top/bottom"
  // during flatten. We move them back to obj's original slot afterwards so the
  // dissolved children sit in the same place obj used to occupy.
  const insertAt = parent.children.indexOf(obj);
  const kids = [...obj.children];
  for (const k of kids) parent.attach(k);
  if (insertAt >= 0 && kids.length) {
    const tail = parent.children.splice(parent.children.length - kids.length, kids.length);
    parent.children.splice(insertAt, 0, ...tail);
  }
  parent.remove(obj);
  return true;
}

// Variant of _dissolveContainer that only removes (no children to reparent).
// Used by the empty-group cleanup pass.
function _removeEmptyContainer(obj, snapshots) {
  const parent = obj.parent;
  if (!parent) return false;
  if (snapshots) {
    snapshots.push({
      kind: 'remove-empty',
      group: obj,
      prevParent: parent,
      prevLocalMatrix: obj.matrix.clone(),
      children: [],
    });
  }
  parent.remove(obj);
  return true;
}

// Walk every non-mesh container under `root`. Collected as
// { obj, depth } where depth is measured from root (0 = direct children).
function _collectContainers(root) {
  const out = [];
  if (!root) return out;
  const walk = (obj, depth) => {
    if (obj !== root && !obj.isMesh) out.push({ obj, depth });
    if (obj.children) for (const c of obj.children) walk(c, depth + 1);
  };
  walk(root, -1);  // root itself yields depth 0 for its direct children
  return out;
}

// Test whether a container is a "leaf group" — every direct child is a Mesh.
function _isLeafGroup(obj) {
  if (!obj.children?.length) return false;
  for (const c of obj.children) if (!c.isMesh) return false;
  return true;
}

// Test whether a container is a "single-child chain" link — exactly one child.
function _isSingleChildLink(obj) {
  return obj.children && obj.children.length === 1;
}

async function flattenTree() {
  if (!state.parts.length) { toast('No model loaded', '', 'info'); return; }

  const groupCount =
    (state.userGroups?.length || 0) +
    (state.treeNodes || []).filter(n => n.kind === 'group').length;
  if (groupCount === 0) { toast('Already flat', 'No groups to dissolve', 'info', 2200); return; }

  // Find the deepest group so the dialog footer shows a useful range.
  let currentMaxDepth = 0;
  state.partsRoot?.traverse(o => {
    if (o === state.partsRoot || o.isMesh) return;
    const d = _depthFromPartsRoot(o);
    if (d > currentMaxDepth) currentMaxDepth = d;
  });

  const selectedIds = state.selectedGroupIds ? Array.from(state.selectedGroupIds) : [];
  const selectedNames = selectedIds.map(gid => {
    const node = (state.treeNodes || []).find(n => n.kind === 'group' && n.id === gid);
    if (node) return node.name || ('Group ' + gid);
    const ug = (state.userGroups || []).find(g => g.id === gid);
    return ug ? (ug.name || ('Group ' + gid)) : ('Group ' + gid);
  });
  const opts = await _FlattenDialog.open({
    selectedGroupCount: selectedIds.length,
    currentMaxDepth,
    selectedNames,
  });
  if (!opts) return;

  const roots = _flattenScopeRoots(opts.scope);
  if (!roots.length) { toast('Nothing in scope', 'No groups selected to flatten', 'warn'); return; }

  state.partsRoot.updateMatrixWorld(true);

  // Snapshot prev userGroups + treeNodes so undo restores the EXACT pre-flatten
  // structure. Re-walking state.partsRoot post-undo would produce a different
  // tree (state.partsRoot has wrappers like AuxScene that the original GLB-load
  // walk skipped), so snapshotting is more reliable than rebuilding.
  const prevUserGroups = state.userGroups ? state.userGroups.slice() : [];
  const prevTreeNodes = state.treeNodes ? state.treeNodes.slice() : [];

  // Snapshot every container we touch so undo can rebuild the hierarchy. Threaded
  // through _runFlattenOps → _flattenByDepth/_flattenLastLevel/etc → _dissolveContainer.
  const snapshots = [];

  let dissolved = 0;
  for (const { root } of roots) {
    dissolved += _runFlattenOps(root, opts, snapshots);
  }

  if (opts.collapseAfter && opts.mode !== 'chains') {
    for (const { root } of roots) dissolved += _collapseSingleChildChains(root, opts, snapshots);
  }

  if (opts.cleanEmpty) {
    for (const { root } of roots) dissolved += _removeEmptyContainers(root, opts, snapshots);
  }

  console.log('[flatten] scope=%s mode=%s roots=%d dissolved=%d snapshots=%d',
    opts.scope, opts.mode, roots.length, dissolved, snapshots.length);

  // Drop dead userGroups (their .ref Group is no longer in the scene).
  if (state.userGroups && state.userGroups.length) {
    state.userGroups = state.userGroups.filter(g => g.ref && g.ref.parent);
    state._userGroupCount = state.userGroups.length;
  }

  // Rebuild treeNodes. CRITICAL: scope=all takes the full-rebuild path; scope=selected
  // patches only the affected subtree in-place. The full rebuild walks state.partsRoot,
  // which includes scene wrappers (AuxScene, _partsRoot, instanced meshes) that aren't
  // in the original GLB-load tree — re-running it on a partial change would replace the
  // whole tree with a different shape and look like "everything went flat".
  if (opts.scope === 'all') {
    if (typeof _buildHierarchyFromScene === 'function') {
      const meshToPart = new Map();
      for (const p of state.parts) { if (p.mesh) meshToPart.set(p.mesh, p); }
      try { _buildHierarchyFromScene(state.partsRoot, meshToPart); }
      catch (err) { console.warn('[flatten] hierarchy rebuild failed:', err); state.treeNodes = []; }
    }
  } else {
    // scope=selected — patch in place per affected root, using the snapshot
    // list to know which groups got dissolved (we can't probe via live-scene
    // walk because auto-instanced parts have detached meshes).
    const dissolvedGroups = new Set();
    for (const s of snapshots) if (s.group) dissolvedGroups.add(s.group);
    for (const { root } of roots) _patchTreeNodesForSubtree(root, dissolvedGroups);
  }
  // DON'T clear treeCollapsed wholesale — that re-expands every group in the
  // tree, which makes previously-collapsed siblings of the scope suddenly fill
  // the viewport and looks like rows "jumped to the top". Drop only the ids of
  // groups that no longer exist in the rebuilt treeNodes.
  if (state.treeCollapsed && state.treeCollapsed.size) {
    const liveIds = new Set();
    for (const n of (state.treeNodes || [])) if (n.kind === 'group') liveIds.add(n.id);
    for (const id of [...state.treeCollapsed]) if (!liveIds.has(id)) state.treeCollapsed.delete(id);
  }
  state.selectedGroupIds?.clear?.();

  // One undo entry covers the whole flatten. Restoring runs snapshots in reverse
  // (shallowest first) so each group lands back on its prev parent with its
  // captured children re-attached at their pre-flatten local matrices.
  if (snapshots.length) {
    pushUndo({ type: 'flatten', snapshots, prevUserGroups, prevTreeNodes, label: `Flatten (${opts.mode})` });
  }

  // Refresh exact-world snapshots so subsequent gizmo operations don't restore
  // pre-flatten ancestor transforms.
  for (const p of state.parts) {
    if (p.mesh) {
      p.mesh.updateWorldMatrix(true, false);
      p._exactWorld = p.mesh.matrixWorld.clone();
    }
  }
  invalidateExplodeBaseline();

  rebuildTree();
  requestRender();

  const modeLabel = {
    total: 'total flatten', keep: `kept ${opts.keep} level${opts.keep === 1 ? '' : 's'}`,
    last: 'flattened last level', chains: 'collapsed chains', ungroup: 'ungrouped scope',
  }[opts.mode] || opts.mode;
  const scopeLabel = opts.scope === 'selected' ? `${roots.length} selected` : 'whole tree';
  toast('Tree flattened', `${modeLabel} on ${scopeLabel} — ${dissolved} group${dissolved === 1 ? '' : 's'} dissolved`, 'success');
  Log.success(`Flatten ${opts.mode} scope=${opts.scope}: ${dissolved} dissolved`, { tag: 'tree' });
}

// Dispatch one flatten action on a given root. Returns count dissolved.
function _runFlattenOps(root, opts, snapshots) {
  if (opts.mode === 'chains') return _collapseSingleChildChains(root, opts, snapshots);
  if (opts.mode === 'ungroup') return _ungroupScope(root, opts, snapshots);
  if (opts.mode === 'last')    return _flattenLastLevel(root, opts, snapshots);

  // 'total' and 'keep' share the depth-cutoff approach. Total = keep 0 levels.
  const cutoff = (opts.mode === 'total') ? 0 : Math.max(1, opts.keep | 0);
  return _flattenByDepth(root, cutoff, opts, snapshots);
}

// Dissolve every container at depth >= cutoff. Depth is measured from `root`
// — root's direct child containers are depth 0. cutoff = "levels of nesting
// to keep". cutoff=0 → total flatten (dissolve all). cutoff=1 → keep depth=0,
// dissolve depth>=1. Deepest-first so reparenting up doesn't lose nodes.
function _flattenByDepth(root, cutoff, opts, snapshots) {
  const containers = _collectContainers(root)
    .filter(c => c.obj !== root)
    .sort((a, b) => b.depth - a.depth);
  let dissolved = 0;
  for (const { obj, depth } of containers) {
    if (depth < cutoff) continue;
    if (opts.preserveUserGroups && _isUserGroupObj(obj)) continue;
    if (_dissolveContainer(obj, snapshots)) dissolved++;
  }
  return dissolved;
}

// Dissolve only "leaf groups" — groups whose direct children are all Meshes.
// Single pass: repeating would walk up the tree (every group becomes a leaf
// once its child group dies), and the user explicitly asked for last level only.
function _flattenLastLevel(root, opts, snapshots) {
  let dissolved = 0;
  const containers = _collectContainers(root).filter(c => c.obj !== root);
  for (const { obj } of containers) {
    if (!_isLeafGroup(obj)) continue;
    if (opts.preserveUserGroups && _isUserGroupObj(obj)) continue;
    if (_dissolveContainer(obj, snapshots)) dissolved++;
  }
  return dissolved;
}

// Collapse every single-child group chain. a/b/c/leaf → leaf.
// Repeats until stable.
function _collapseSingleChildChains(root, opts, snapshots) {
  let dissolved = 0;
  for (let pass = 0; pass < 64; pass++) {
    const containers = _collectContainers(root).filter(c => c.obj !== root);
    let dissolvedInPass = 0;
    for (const { obj } of containers) {
      if (!_isSingleChildLink(obj)) continue;
      if (opts.preserveUserGroups && _isUserGroupObj(obj)) continue;
      if (_dissolveContainer(obj, snapshots)) { dissolved++; dissolvedInPass++; }
    }
    if (!dissolvedInPass) break;
  }
  return dissolved;
}

// Ungroup mode: dissolve the scope root itself (when scope=selected). When
// scope=all, the scope root is partsRoot — refuse to dissolve it.
function _ungroupScope(root, opts, snapshots) {
  if (root === state.partsRoot) return 0;
  if (opts.preserveUserGroups && _isUserGroupObj(root)) return 0;
  return _dissolveContainer(root, snapshots) ? 1 : 0;
}

// Remove containers that ended up with zero children after the action.
function _removeEmptyContainers(root, opts, snapshots) {
  let removed = 0;
  for (let pass = 0; pass < 8; pass++) {
    const containers = _collectContainers(root).filter(c => c.obj !== root);
    let removedInPass = 0;
    // Process deepest first so a parent that becomes empty after its child is
    // removed gets cleaned in the next pass.
    containers.sort((a, b) => b.depth - a.depth);
    for (const { obj } of containers) {
      if (obj.children && obj.children.length > 0) continue;
      if (opts.preserveUserGroups && _isUserGroupObj(obj)) continue;
      if (_removeEmptyContainer(obj, snapshots)) { removed++; removedInPass++; }
    }
    if (!removedInPass) break;
  }
  return removed;
}

// Update the subtree under `rootObj` in state.treeNodes after a flatten.
// Doesn't walk the live scene graph — that path can't see auto-instanced parts
// (their mesh has been removed and their backing InstancedMesh lives at the
// top of partsRoot, outside any group). Instead we walk the OLD rows and:
//   1. Drop rows for groups whose obj3d is in `dissolvedGroups`.
//   2. For every other row, walk the OLD parentId chain past dissolved
//      ancestors until we hit an alive ancestor — that's the new parent.
//   3. DFS-reorder by parent so the rendered tree matches the in-place dissolve
//      ordering (children show up in the slot their old container occupied).
function _patchTreeNodesForSubtree(rootObj, dissolvedGroups) {
  const all = state.treeNodes || [];
  if (!all.length) return;
  const startIdx = all.findIndex(n => n.kind === 'group' && n.obj3d === rootObj);
  if (startIdx < 0) return;
  const baseDepth = all[startIdx].depth;
  const baseId = all[startIdx].id;
  let endIdx = all.length;
  for (let i = startIdx + 1; i < all.length; i++) {
    if (all[i].depth <= baseDepth) { endIdx = i; break; }
  }

  const oldRows = all.slice(startIdx, endIdx);
  const oldRowsById = new Map(oldRows.map(r => [r.id, r]));
  const isDissolvedRow = r =>
    r.kind === 'group' && r !== all[startIdx] && r.obj3d && dissolvedGroups && dissolvedGroups.has(r.obj3d);

  // Walk the OLD parentId chain past any dissolved ancestor and return the
  // closest still-alive id. baseId acts as the floor — we never walk above
  // the scope root (rootObj's row).
  function findAliveParent(parentId) {
    while (parentId != null) {
      if (parentId === baseId) return baseId;
      const p = oldRowsById.get(parentId);
      if (!p) break;
      if (!isDissolvedRow(p)) return parentId;
      parentId = p.parentId;
    }
    return parentId;
  }

  // Filter out dissolved group rows; rewrite parentId on every survivor.
  const survivingRows = [];
  for (const r of oldRows) {
    if (isDissolvedRow(r)) continue;
    if (r !== all[startIdx]) {
      r.parentId = findAliveParent(r.parentId);
    }
    survivingRows.push(r);
  }

  // DFS-reorder. survivingRows is already in OLD DFS order, so children of a
  // (now-dissolved) container come right after the dissolved container's
  // siblings — which matches the in-place sibling order produced by
  // _dissolveContainer's "splice into the dissolved obj's slot" logic.
  const childrenMap = new Map();
  for (const r of survivingRows) {
    if (r === all[startIdx]) continue;
    let arr = childrenMap.get(r.parentId);
    if (!arr) { arr = []; childrenMap.set(r.parentId, arr); }
    arr.push(r);
  }

  const ordered = [];
  function emit(parentId, depth) {
    const kids = childrenMap.get(parentId);
    if (!kids) return;
    for (const k of kids) {
      k.depth = depth;
      ordered.push(k);
      if (k.kind === 'group') emit(k.id, depth + 1);
    }
  }
  all[startIdx].depth = baseDepth;
  ordered.push(all[startIdx]);
  emit(baseId, baseDepth + 1);

  all.splice(startIdx, endIdx - startIdx, ...ordered);
}

// Restore one snapshot. Group goes back to its prev parent with its prev local
// matrix; each captured child moves back into the group with its prev local
// matrix (so we don't double-compose ancestor transforms).
function _restoreFlattenSnapshot(s) {
  if (!s.prevParent) return;
  // Insert back at the same sibling index it had pre-dissolve, so the tree's
  // original child order is preserved on Ctrl+Z.
  s.prevParent.add(s.group);
  if (typeof s.prevSiblingIndex === 'number' && s.prevSiblingIndex >= 0) {
    const arr = s.prevParent.children;
    const cur = arr.indexOf(s.group);
    if (cur >= 0 && cur !== s.prevSiblingIndex) {
      arr.splice(cur, 1);
      arr.splice(Math.min(s.prevSiblingIndex, arr.length), 0, s.group);
    }
  }
  s.group.matrix.copy(s.prevLocalMatrix);
  s.group.matrix.decompose(s.group.position, s.group.quaternion, s.group.scale);
  for (const c of s.children) {
    if (c.obj.parent && c.obj.parent !== s.group) c.obj.parent.remove(c.obj);
    s.group.add(c.obj);
    c.obj.matrix.copy(c.prevLocalMatrix);
    c.obj.matrix.decompose(c.obj.position, c.obj.quaternion, c.obj.scale);
  }
}

// Wrap undoLast to handle 'flatten' ops. Restoring the snapshots in reverse
// order (shallowest first) puts each group back in its prev parent before
// any deeper group needs to land inside it.
const _origUndoLast_flatten = undoLast;
undoLast = function() {
  const op = state.history[state.history.length - 1];
  if (op && op.type === 'flatten') {
    state.history.pop();
    for (let i = op.snapshots.length - 1; i >= 0; i--) {
      _restoreFlattenSnapshot(op.snapshots[i]);
    }
    if (op.prevUserGroups) {
      state.userGroups = op.prevUserGroups.slice();
      state._userGroupCount = state.userGroups.length;
    }
    if (op.prevTreeNodes) {
      state.treeNodes = op.prevTreeNodes.slice();
    }
    for (const p of state.parts) {
      if (p.mesh) {
        p.mesh.updateWorldMatrix(true, false);
        p._exactWorld = p.mesh.matrixWorld.clone();
      }
    }
    invalidateExplodeBaseline();
    state.redo.push(op);
    _finalizeUndo({ rebuildTree: true });
    return;
  }
  return _origUndoLast_flatten();
};

// Redo: re-dissolve in original order. Children that need to move up are
// already in place from the undo restore — re-running _dissolveContainer
// (without snapshots) is enough.
const _origRedoLast_flatten = redoLast;
redoLast = function() {
  const op = state.redo[state.redo.length - 1];
  if (op && op.type === 'flatten') {
    state.redo.pop();
    for (const s of op.snapshots) {
      const parent = s.group.parent;
      if (!parent) continue;
      if (s.kind === 'remove-empty') {
        parent.remove(s.group);
      } else {
        const insertAt = parent.children.indexOf(s.group);
        const kids = [...s.group.children];
        for (const k of kids) parent.attach(k);
        if (insertAt >= 0 && kids.length) {
          const tail = parent.children.splice(parent.children.length - kids.length, kids.length);
          parent.children.splice(insertAt, 0, ...tail);
        }
        parent.remove(s.group);
      }
    }
    if (typeof _buildHierarchyFromScene === 'function') {
      const meshToPart = new Map();
      for (const p of state.parts) { if (p.mesh) meshToPart.set(p.mesh, p); }
      try { _buildHierarchyFromScene(state.partsRoot, meshToPart); } catch {}
    }
    state.userGroups = (state.userGroups || []).filter(g => g.ref && g.ref.parent);
    state._userGroupCount = state.userGroups.length;
    for (const p of state.parts) {
      if (p.mesh) {
        p.mesh.updateWorldMatrix(true, false);
        p._exactWorld = p.mesh.matrixWorld.clone();
      }
    }
    invalidateExplodeBaseline();
    state.history.push(op);
    _finalizeUndo({ rebuildTree: true });
    return;
  }
  return _origRedoLast_flatten();
};

// =====================================================================
// BATCH RENAME — Cinema 4D-style token engine + Find/Replace + Presets
// =====================================================================

// Token engine. Tokens use {NAME(:MODIFIER)*} braces. Literal '{' and '}'
// escape as '{{' and '}}'. compileTemplate(s) returns { ok, fn(ctx)→string, errors }.
const _BatchRename = (() => {

  const TOKENS = {
    name:          ctx => ctx.name ?? '',
    parent:        ctx => ctx.parent ?? '',
    ancestors:     (ctx, args) => {
      const arr = ctx.ancestors || [];
      const n = args && args[0] ? Math.max(0, parseInt(args[0], 10) | 0) : arr.length;
      return arr.slice(-n).join('_');
    },
    path:          (ctx, args) => {
      const sep = (args && args[0]) || '/';
      return (ctx.ancestors || []).join(sep);
    },
    depth:         ctx => String(ctx.depth ?? 0),
    partId:        ctx => String(ctx.partId ?? ''),
    idx:           ctx => String(ctx.idx ?? 0),
    counter:       (ctx, args) => {
      const v = ctx._nextCounter();
      let pad = 0;
      if (args && args[0] && /^\d+$/.test(args[0])) pad = args[0].length;
      return pad > 0 ? String(v).padStart(pad, '0') : String(v);
    },
    tris:          ctx => String(ctx.tris ?? 0),
    verts:         ctx => String(ctx.verts ?? 0),
    diag:          ctx => (ctx.diag ?? 0).toFixed(2),
    vol:           ctx => (ctx.vol ?? 0).toFixed(2),
    max:           ctx => (ctx.max ?? 0).toFixed(2),
    color:         ctx => ctx.color ?? '',
    material:      ctx => ctx.color ?? '',
    hash:          (ctx, args) => {
      const h = ctx.hash || '';
      const n = args && args[0] ? parseInt(args[0], 10) | 0 : h.length;
      return h.slice(0, n);
    },
    instanceCount: ctx => String(ctx.instanceCount ?? 0),
  };
  const NUMERIC_TOKENS = new Set(['depth', 'partId', 'idx', 'counter', 'tris', 'verts', 'diag', 'vol', 'max', 'instanceCount']);

  const MODIFIERS = {
    upper:  s => String(s).toUpperCase(),
    lower:  s => String(s).toLowerCase(),
    title:  s => String(s).replace(/\b\w/g, c => c.toUpperCase()),
    snake:  s => String(s).trim().replace(/([a-z])([A-Z])/g, '$1_$2').replace(/[\s\-]+/g, '_').toLowerCase(),
    kebab:  s => String(s).trim().replace(/([a-z])([A-Z])/g, '$1-$2').replace(/[\s_]+/g, '-').toLowerCase(),
    camel:  s => {
      const parts = String(s).trim().split(/[\s_\-]+/).filter(Boolean);
      if (!parts.length) return '';
      return parts[0].toLowerCase() + parts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join('');
    },
    trim:   s => String(s).trim(),
    strip:  (s, args) => {
      const sub = (args && args[0]) || '';
      if (!sub) return s;
      let out = String(s);
      while (out.startsWith(sub)) out = out.slice(sub.length);
      while (out.endsWith(sub))   out = out.slice(0, -sub.length);
      return out;
    },
    slice:  (s, args) => {
      const a = parseInt(args?.[0] ?? 0, 10) | 0;
      const b = args?.[1] != null ? parseInt(args[1], 10) | 0 : undefined;
      return String(s).slice(a, b);
    },
    replace: (s, args) => {
      const raw = args?.[0] || '';
      const m = /^\/(.*)\/([^\/]*)\/([gimsuy]*)$/.exec(raw);
      if (!m) return s;
      try { return String(s).replace(new RegExp(m[1], m[3]), m[2]); }
      catch { return s; }
    },
    pad:    (s, args) => {
      const n = parseInt(args?.[0] ?? 0, 10) | 0;
      const c = (args?.[1] || (typeof s === 'number' || /^\d+$/.test(String(s)) ? '0' : ' ')).slice(0, 1);
      return String(s).padStart(n, c);
    },
    round:  (s, args) => {
      const n = parseInt(args?.[0] ?? 0, 10) | 0;
      const num = parseFloat(s);
      if (!Number.isFinite(num)) return s;
      return num.toFixed(n);
    },
    abbrev: (s, args) => {
      const max = parseInt(args?.[0] ?? 12, 10) | 0;
      const str = String(s);
      if (str.length <= max) return str;
      const half = Math.max(1, Math.floor((max - 1) / 2));
      return str.slice(0, half) + '…' + str.slice(str.length - (max - 1 - half));
    },
    bucket: (s) => {
      const n = parseFloat(s);
      if (!Number.isFinite(n)) return String(s);
      if (n >= 10000) return 'Heavy';
      if (n >= 1000)  return 'Med';
      return 'Light';
    },
  };

  function _parseModifier(raw, tokenName) {
    raw = raw.trim();
    if (!raw) return null;
    if (/^\d+$/.test(raw)) {
      if (NUMERIC_TOKENS.has(tokenName) || tokenName === 'counter') return { name: '__sugar_pad__', args: [raw.length] };
      if (tokenName === 'ancestors' || tokenName === 'path') return { name: '__sugar_lastN__', args: [parseInt(raw, 10)] };
      return { name: 'slice', args: [0, parseInt(raw, 10)] };
    }
    const m = /^([a-zA-Z_]+)(?:\((.*)\))?$/s.exec(raw);
    if (!m) return null;
    const name = m[1];
    const argsStr = (m[2] || '').trim();
    let args = [];
    if (argsStr) {
      if (name === 'replace') args = [argsStr];
      else args = argsStr.split(',').map(x => x.trim());
    }
    return { name, args };
  }

  function _parseTokenExpr(body) {
    const parts = [];
    let buf = '';
    let parenDepth = 0;
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (c === '(') { parenDepth++; buf += c; continue; }
      if (c === ')') { parenDepth--; buf += c; continue; }
      if (c === ':' && parenDepth === 0) { parts.push(buf); buf = ''; continue; }
      buf += c;
    }
    if (buf || parts.length === 0) parts.push(buf);
    const tName = parts[0].trim();
    const mods = [];
    for (let i = 1; i < parts.length; i++) {
      const mod = _parseModifier(parts[i], tName);
      if (!mod) return { error: `bad modifier: "${parts[i]}"` };
      mods.push(mod);
    }
    return { token: tName, mods };
  }

  function compileTemplate(template) {
    const errors = [];
    const ops = [];
    let i = 0;
    let buf = '';
    while (i < template.length) {
      const c = template[i];
      if (c === '{' && template[i + 1] === '{') { buf += '{'; i += 2; continue; }
      if (c === '}' && template[i + 1] === '}') { buf += '}'; i += 2; continue; }
      if (c === '{') {
        let j = i + 1, depth = 1;
        while (j < template.length && depth > 0) {
          if (template[j] === '{') depth++;
          else if (template[j] === '}') depth--;
          if (depth > 0) j++;
        }
        if (depth !== 0) { errors.push(`Unclosed '{' at position ${i}`); buf += c; i++; continue; }
        const body = template.slice(i + 1, j);
        if (buf) { ops.push({ kind: 'lit', text: buf }); buf = ''; }
        const parsed = _parseTokenExpr(body);
        if (parsed.error) errors.push(parsed.error);
        const tName = parsed.token;
        if (!TOKENS[tName]) errors.push(`Unknown token: "${tName}"`);
        ops.push({ kind: 'tok', token: tName, mods: parsed.mods || [] });
        i = j + 1; continue;
      }
      buf += c; i++;
    }
    if (buf) ops.push({ kind: 'lit', text: buf });

    const fn = (ctx) => {
      const out = [];
      for (const op of ops) {
        if (op.kind === 'lit') { out.push(op.text); continue; }
        const tFn = TOKENS[op.token];
        if (!tFn) { out.push(''); continue; }
        let tokenArgs = [];
        const remainingMods = [];
        for (const m of op.mods) {
          if (m.name === '__sugar_lastN__') tokenArgs = m.args;
          else if (m.name === '__sugar_pad__') remainingMods.push({ name: 'pad', args: [m.args[0], '0'] });
          else remainingMods.push(m);
        }
        let val = tFn(ctx, tokenArgs);
        for (const m of remainingMods) {
          const fnMod = MODIFIERS[m.name];
          if (!fnMod) continue;
          val = fnMod(val, m.args);
        }
        out.push(val == null ? '' : String(val));
      }
      return out.join('');
    };

    return { ok: errors.length === 0, errors, fn };
  }

  function makeCounter({ start = 1, step = 1, mode = 'global' } = {}) {
    const buckets = new Map();
    let global = start;
    return {
      mode,
      next(bucketKey) {
        if (mode === 'global' || !bucketKey) { const v = global; global += step; return v; }
        let v = buckets.get(bucketKey);
        if (v == null) v = start;
        buckets.set(bucketKey, v + step);
        return v;
      },
    };
  }

  function _ancestorNames(treeNode) {
    if (!treeNode) return [];
    const all = state.treeNodes || [];
    const byId = new Map(all.map(n => [n.id, n]));
    const out = [];
    let cur = treeNode.parentId != null ? byId.get(treeNode.parentId) : null;
    while (cur) {
      out.push(cur.name || '');
      cur = cur.parentId != null ? byId.get(cur.parentId) : null;
    }
    return out.reverse();
  }

  function gatherCandidates(scope) {
    const all = state.treeNodes || [];
    const candByPart = new Map();
    const candByGroup = new Map();

    function addPart(partId) {
      if (candByPart.has(partId)) return;
      const p = getPart(partId);
      if (!p || p.deleted) return;
      const tn = all.find(n => n.kind === 'part' && n.partId === partId);
      const ancestors = _ancestorNames(tn);
      candByPart.set(partId, {
        kind: 'part',
        partId,
        treeNodeId: tn ? tn.id : null,
        currentName: (tn && tn.name) || p.name || '',
        depth: tn ? tn.depth : 0,
        parent: ancestors[ancestors.length - 1] || '',
        ancestors,
        triCount: p.triCount || 0,
        vertCount: p.vertCount || 0,
        sizeMetrics: p.sizeMetrics || { diag: 0, vol: 0, max: 0 },
        color: p.originalColor ? '#' + p.originalColor.getHexString() : '',
        hash: p.hash || '',
        instanceCount: tn?.instanceCount || 0,
        idx: 0,
      });
    }
    function addHierGroup(groupNode) {
      if (!groupNode || candByGroup.has('h:' + groupNode.id)) return;
      const ancestors = _ancestorNames(groupNode);
      candByGroup.set('h:' + groupNode.id, {
        kind: 'hier-group',
        treeNodeId: groupNode.id,
        obj3dRef: groupNode.obj3d || null,
        currentName: groupNode.name || '',
        depth: groupNode.depth || 0,
        parent: ancestors[ancestors.length - 1] || '',
        ancestors,
        triCount: 0, vertCount: 0,
        sizeMetrics: { diag: 0, vol: 0, max: 0 },
        color: '', hash: '', instanceCount: 0,
        idx: 0,
      });
    }
    function addUserGroup(g) {
      if (!g || candByGroup.has('u:' + g.id)) return;
      candByGroup.set('u:' + g.id, {
        kind: 'user-group',
        userGroupId: g.id,
        obj3dRef: g.ref || null,
        currentName: g.name || '',
        depth: 0, parent: '', ancestors: [],
        triCount: 0, vertCount: 0,
        sizeMetrics: { diag: 0, vol: 0, max: 0 },
        color: '', hash: '', instanceCount: g.partIds?.size || 0,
        idx: 0,
      });
    }

    if (scope === 'whole-tree') {
      for (const p of state.parts) if (!p.deleted) addPart(p.partId);
      for (const n of all) if (n.kind === 'group') addHierGroup(n);
      for (const g of (state.userGroups || [])) addUserGroup(g);
    } else if (scope === 'selected-parts') {
      for (const id of state.selected) addPart(id);
    } else if (scope === 'selected-groups') {
      for (const gid of state.selectedGroupIds) {
        const tn = all.find(n => n.kind === 'group' && n.id === gid);
        if (tn) addHierGroup(tn);
        const ug = (state.userGroups || []).find(g => g.id === gid);
        if (ug) addUserGroup(ug);
      }
    } else if (scope === 'selection-with-children') {
      for (const id of state.selected) addPart(id);
      for (const gid of state.selectedGroupIds) {
        const tn = all.find(n => n.kind === 'group' && n.id === gid);
        if (tn) addHierGroup(tn);
        for (const pid of _treeGroupDescendants(gid)) addPart(pid);
        const ug = (state.userGroups || []).find(g => g.id === gid);
        if (ug) {
          addUserGroup(ug);
          for (const pid of (ug.partIds || [])) addPart(pid);
        }
      }
    } else {
      for (const id of state.selected) addPart(id);
      for (const gid of state.selectedGroupIds) {
        const tn = all.find(n => n.kind === 'group' && n.id === gid);
        if (tn) addHierGroup(tn);
        const ug = (state.userGroups || []).find(g => g.id === gid);
        if (ug) addUserGroup(ug);
      }
    }

    const orderMap = new Map();
    all.forEach((n, i) => {
      if (n.kind === 'group') orderMap.set('h:' + n.id, i);
      else if (n.kind === 'part') orderMap.set('p:' + n.partId, i);
    });
    const groups = [...candByGroup.values()].sort((a, b) => {
      const ka = a.kind === 'hier-group' ? orderMap.get('h:' + a.treeNodeId) : Number.MAX_SAFE_INTEGER;
      const kb = b.kind === 'hier-group' ? orderMap.get('h:' + b.treeNodeId) : Number.MAX_SAFE_INTEGER;
      return (ka ?? 0) - (kb ?? 0);
    });
    const parts = [...candByPart.values()].sort((a, b) => (orderMap.get('p:' + a.partId) ?? 0) - (orderMap.get('p:' + b.partId) ?? 0));
    const cands = [...groups, ...parts];
    cands.forEach((c, i) => { c.idx = i; });
    return cands;
  }

  function makeFilter(opts) {
    const checks = [];
    if (opts.matchRegex) {
      try { const re = new RegExp(opts.matchRegex, opts.matchCase ? '' : 'i'); checks.push(c => re.test(c.currentName)); }
      catch { }
    }
    if (opts.notMatchRegex) {
      try { const re = new RegExp(opts.notMatchRegex, opts.matchCase ? '' : 'i'); checks.push(c => !re.test(c.currentName)); }
      catch { }
    }
    if (opts.depthMin != null && Number.isFinite(opts.depthMin)) checks.push(c => c.depth >= opts.depthMin);
    if (opts.depthMax != null && Number.isFinite(opts.depthMax)) checks.push(c => c.depth <= opts.depthMax);
    if (opts.trisMin != null && Number.isFinite(opts.trisMin))   checks.push(c => c.triCount >= opts.trisMin);
    if (opts.trisMax != null && Number.isFinite(opts.trisMax))   checks.push(c => c.triCount <= opts.trisMax);
    if (opts.kindOnly === 'part')  checks.push(c => c.kind === 'part');
    if (opts.kindOnly === 'group') checks.push(c => c.kind !== 'part');
    if (opts.colorEq) {
      const want = opts.colorEq.toLowerCase();
      checks.push(c => (c.color || '').toLowerCase() === want);
    }
    return cand => checks.every(fn => fn(cand));
  }

  function applyRule(cand, rule, counter) {
    if (rule.kind === 'find-replace') {
      if (!rule.find) return cand.currentName;
      let re;
      if (rule.regex) {
        try { re = new RegExp(rule.find, rule.matchCase ? 'g' : 'gi'); } catch { return cand.currentName; }
      } else {
        const escaped = String(rule.find).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        re = new RegExp(escaped, rule.matchCase ? 'g' : 'gi');
      }
      return cand.currentName.replace(re, rule.replace || '');
    }
    if (rule.kind === 'pattern') {
      const ctx = {
        ..._ctxFromCand(cand),
        _nextCounter: () => counter.next(_counterBucket(cand, counter.mode)),
      };
      return rule.fn(ctx);
    }
    return cand.currentName;
  }
  function _counterBucket(cand, mode) {
    if (mode === 'parent')   return cand.parent || '';
    if (mode === 'color')    return cand.color || '';
    if (mode === 'size') {
      const d = cand.sizeMetrics?.diag || 0;
      return d >= 100 ? 'lg' : d >= 10 ? 'md' : 'sm';
    }
    return null;
  }
  function _ctxFromCand(c) {
    return {
      name: c.currentName, parent: c.parent, ancestors: c.ancestors,
      depth: c.depth, partId: c.partId, idx: c.idx,
      tris: c.triCount, verts: c.vertCount,
      diag: c.sizeMetrics?.diag, vol: c.sizeMetrics?.vol, max: c.sizeMetrics?.max,
      color: c.color, hash: c.hash, instanceCount: c.instanceCount,
    };
  }

  function buildPreview(cands, rule, filterFn, counterOpts) {
    const counter = makeCounter(counterOpts);
    const rows = [];
    for (const c of cands) {
      if (filterFn && !filterFn(c)) {
        rows.push({ cand: c, oldName: c.currentName, newName: c.currentName, status: 'skipped', reason: 'filtered' });
        continue;
      }
      let next;
      try { next = applyRule(c, rule, counter); }
      catch (e) { rows.push({ cand: c, oldName: c.currentName, newName: c.currentName, status: 'error', reason: e.message || 'rule error' }); continue; }
      if (next == null) next = '';
      if (next === c.currentName) { rows.push({ cand: c, oldName: c.currentName, newName: next, status: 'unchanged' }); continue; }
      if (next === '') { rows.push({ cand: c, oldName: c.currentName, newName: next, status: 'error', reason: 'empty name' }); continue; }
      if (/[\x00-\x1f]/.test(next)) { rows.push({ cand: c, oldName: c.currentName, newName: next, status: 'error', reason: 'control characters' }); continue; }
      rows.push({ cand: c, oldName: c.currentName, newName: next, status: 'ok' });
    }
    const sibKey = new Map();
    for (const r of rows) if (r.status === 'ok') {
      const k = (r.cand.parent || '') + ' ' + r.newName;
      sibKey.set(k, (sibKey.get(k) || 0) + 1);
    }
    for (const r of rows) if (r.status === 'ok') {
      const k = (r.cand.parent || '') + ' ' + r.newName;
      if (sibKey.get(k) > 1) { r.status = 'warn'; r.reason = 'duplicate sibling'; }
    }
    return rows;
  }

  function commit(rows) {
    const changes = [];
    for (const r of rows) {
      if (r.status !== 'ok' && r.status !== 'warn') continue;
      const c = r.cand;
      if (c.kind === 'part') {
        const p = getPart(c.partId);
        if (!p) continue;
        changes.push({ kind: 'part', partId: c.partId, treeNodeId: c.treeNodeId, oldName: p.name, newName: r.newName });
        p.name = r.newName;
        if (p.mesh) p.mesh.name = r.newName;
        if (c.treeNodeId != null) {
          const tn = (state.treeNodes || []).find(n => n.kind === 'part' && n.id === c.treeNodeId);
          if (tn) tn.name = r.newName;
        }
      } else if (c.kind === 'hier-group') {
        const tn = (state.treeNodes || []).find(n => n.id === c.treeNodeId);
        if (!tn) continue;
        changes.push({ kind: 'hier-group', treeNodeId: c.treeNodeId, obj3dRef: tn.obj3d, oldName: tn.name, newName: r.newName });
        tn.name = r.newName;
        if (tn.obj3d) tn.obj3d.name = r.newName;
      } else if (c.kind === 'user-group') {
        const ug = (state.userGroups || []).find(g => g.id === c.userGroupId);
        if (!ug) continue;
        changes.push({ kind: 'user-group', userGroupId: c.userGroupId, oldName: ug.name, newName: r.newName });
        ug.name = r.newName;
        if (ug.ref) ug.ref.name = r.newName;
      }
    }
    if (changes.length) {
      pushUndo({ type: 'batchRename', label: `Rename ${changes.length} item${changes.length === 1 ? '' : 's'}`, changes });
      rebuildTree();
      refreshPropertiesPanel?.();
      requestRender?.();
      toast?.('Renamed', `${changes.length} item${changes.length === 1 ? '' : 's'} updated`, 'success');
      Log?.success?.(`Batch rename: ${changes.length} items`, { tag: 'rename' });
    }
    return changes.length;
  }

  const BUILTIN_PRESETS = [
    { name: 'Strip _geom suffix',     mode: 'find-replace', config: { find: '_geom$',   replace: '', regex: true,  matchCase: false } },
    { name: 'Strip numeric prefix',   mode: 'find-replace', config: { find: '^\\d+_',   replace: '', regex: true,  matchCase: false } },
    { name: 'Collapse __ to _',       mode: 'find-replace', config: { find: '__+',      replace: '_', regex: true, matchCase: false } },
    { name: 'Strip duplicate _NNN',   mode: 'find-replace', config: { find: '_(\\d+)$', replace: '', regex: true,  matchCase: false } },
    { name: 'Strip _glb_inst_*',      mode: 'find-replace', config: { find: '^_glb_inst_\\d+$', replace: 'instance', regex: true, matchCase: false } },
    { name: 'Hierarchy flatten',      mode: 'pattern',      config: { template: '{ancestors}_{name}' } },
    { name: 'Add parent prefix',      mode: 'pattern',      config: { template: '{parent}_{name}' } },
    { name: 'Sequential within group',mode: 'pattern',      config: { template: '{parent}_{counter:003}', counterMode: 'parent' } },
    { name: 'Lowercase all',          mode: 'pattern',      config: { template: '{name:lower}' } },
    { name: 'snake_case all',         mode: 'pattern',      config: { template: '{name:snake}' } },
    { name: 'Tris bucket prefix',     mode: 'pattern',      config: { template: '{tris:bucket}_{name}' } },
    { name: 'Hash-tagged name',       mode: 'pattern',      config: { template: '{name}_{hash:6}' } },
  ];

  function loadUserPresets() {
    try { return JSON.parse(localStorage.getItem('batchRename.presets.v1') || '[]'); }
    catch { return []; }
  }
  function saveUserPresets(arr) {
    try { localStorage.setItem('batchRename.presets.v1', JSON.stringify(arr || [])); } catch {}
  }

  const TOKEN_CATALOG = [
    { name: 'name',          desc: 'Current name' },
    { name: 'parent',        desc: 'Immediate parent group name' },
    { name: 'ancestors',     desc: 'Ancestors joined by _ (or :N for last N)' },
    { name: 'path',          desc: 'Ancestor path joined by /' },
    { name: 'depth',         desc: 'Tree depth (root=0)' },
    { name: 'partId',        desc: 'Numeric part id' },
    { name: 'idx',           desc: 'Index in candidate list' },
    { name: 'counter',       desc: 'Sequential counter — :003 to pad' },
    { name: 'tris',          desc: 'Triangle count' },
    { name: 'verts',         desc: 'Vertex count' },
    { name: 'diag',          desc: 'Bounding-box diagonal' },
    { name: 'vol',           desc: 'Bounding-box volume' },
    { name: 'max',           desc: 'Largest bbox dimension' },
    { name: 'color',         desc: 'Material color hex' },
    { name: 'hash',          desc: 'Geometry hash (:N first N chars)' },
    { name: 'instanceCount', desc: 'Number of shared instances' },
  ];
  const MODIFIER_CATALOG = [
    { name: 'upper',   desc: 'UPPERCASE' },
    { name: 'lower',   desc: 'lowercase' },
    { name: 'title',   desc: 'Title Case' },
    { name: 'snake',   desc: 'snake_case' },
    { name: 'kebab',   desc: 'kebab-case' },
    { name: 'camel',   desc: 'camelCase' },
    { name: 'trim',    desc: 'Trim whitespace' },
    { name: 'strip',   desc: 'strip(text)' },
    { name: 'slice',   desc: 'slice(a,b)' },
    { name: 'replace', desc: 'replace(/re/repl/flags)' },
    { name: 'pad',     desc: 'pad(n,c)' },
    { name: 'round',   desc: 'round(n)' },
    { name: 'abbrev',  desc: 'abbrev(n)' },
    { name: 'bucket',  desc: 'Heavy/Med/Light' },
  ];

  return {
    compileTemplate, makeCounter, gatherCandidates, makeFilter,
    applyRule, buildPreview, commit,
    loadUserPresets, saveUserPresets,
    BUILTIN_PRESETS, TOKEN_CATALOG, MODIFIER_CATALOG,
  };
})();

// =====================================================================
// _DraggablePopup — shared chrome for floating, draggable, resizable
// dialogs (Batch Rename, Advanced flatten, future ones).
// Centralises card chrome (radius, gradient, border, shadow), header
// (icon + title + subtitle + close), 8-handle resize, drag-from-head,
// outside-click + Escape to close, and position/size persistence per id.
// Each instance owns a viewport-positioned card (.dlg-pop) inside a
// transparent overlay (.dlg-popup). Content lives in .dlg-body and an
// optional .dlg-foot. Callers wire their own buttons/inputs.
// =====================================================================
const _DraggablePopup = (() => {
  let stylesInjected = false;

  function _injectChromeStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    const s = document.createElement('style');
    s.id = '_dlg-popup-style';
    s.textContent = `
      .dlg-popup{position:fixed;inset:0;display:none;z-index:300;pointer-events:none}
      .dlg-popup.show{display:block}
      .dlg-popup .dlg-pop{
        position:absolute;
        max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);
        background:linear-gradient(180deg,#1a1f2a,#10141c);
        border:1px solid rgba(255,255,255,.04);
        border-radius:14px;
        box-shadow:0 30px 80px -16px rgba(0,0,0,.7),0 8px 24px -8px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.04);
        display:flex;flex-direction:column;
        overflow:hidden;
        pointer-events:auto;
        transform:translateY(-8px) scale(.97);
        opacity:0;
        transition:transform .22s cubic-bezier(.2,.9,.3,1.1),opacity .16s ease;
      }
      .dlg-popup.show .dlg-pop{transform:translateY(0) scale(1);opacity:1}
      .dlg-popup.dragging .dlg-pop,.dlg-popup.resizing .dlg-pop{transition:none}
      .dlg-popup.dragging .dlg-pop{cursor:grabbing}

      .dlg-popup .dlg-resize{position:absolute;z-index:2}
      .dlg-popup .dlg-resize.n{top:-3px;left:12px;right:12px;height:6px;cursor:ns-resize}
      .dlg-popup .dlg-resize.s{bottom:-3px;left:12px;right:12px;height:6px;cursor:ns-resize}
      .dlg-popup .dlg-resize.w{left:-3px;top:12px;bottom:12px;width:6px;cursor:ew-resize}
      .dlg-popup .dlg-resize.e{right:-3px;top:12px;bottom:12px;width:6px;cursor:ew-resize}
      .dlg-popup .dlg-resize.nw{top:-3px;left:-3px;width:16px;height:16px;cursor:nwse-resize}
      .dlg-popup .dlg-resize.ne{top:-3px;right:-3px;width:16px;height:16px;cursor:nesw-resize}
      .dlg-popup .dlg-resize.sw{bottom:-3px;left:-3px;width:16px;height:16px;cursor:nesw-resize}
      .dlg-popup .dlg-resize.se{bottom:-3px;right:-3px;width:16px;height:16px;cursor:nwse-resize}

      .dlg-popup .dlg-pop:has(.dlg-resize.nw:hover){background:radial-gradient(circle at 0% 0%,rgba(110,168,255,.45),rgba(110,168,255,.10) 26px,transparent 56px),linear-gradient(180deg,#1a1f2a,#10141c)}
      .dlg-popup .dlg-pop:has(.dlg-resize.ne:hover){background:radial-gradient(circle at 100% 0%,rgba(110,168,255,.45),rgba(110,168,255,.10) 26px,transparent 56px),linear-gradient(180deg,#1a1f2a,#10141c)}
      .dlg-popup .dlg-pop:has(.dlg-resize.sw:hover){background:radial-gradient(circle at 0% 100%,rgba(110,168,255,.45),rgba(110,168,255,.10) 26px,transparent 56px),linear-gradient(180deg,#1a1f2a,#10141c)}
      .dlg-popup .dlg-pop:has(.dlg-resize.se:hover){background:radial-gradient(circle at 100% 100%,rgba(110,168,255,.45),rgba(110,168,255,.10) 26px,transparent 56px),linear-gradient(180deg,#1a1f2a,#10141c)}

      .dlg-popup .dlg-head{display:flex;align-items:center;gap:11px;padding:13px 14px 12px 16px;border-bottom:1px solid rgba(255,255,255,.05);flex-shrink:0;position:relative;cursor:grab;user-select:none}
      .dlg-popup .dlg-head:active{cursor:grabbing}
      .dlg-popup .dlg-head::after{content:'';position:absolute;left:16px;right:16px;bottom:-1px;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.06) 30%,rgba(255,255,255,.06) 70%,transparent);pointer-events:none}
      .dlg-popup .dlg-head-icon{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;background:linear-gradient(180deg,rgba(110,168,255,.22),rgba(110,168,255,.10));color:var(--ac);box-shadow:inset 0 0 0 1px rgba(110,168,255,.32),inset 0 1px 0 rgba(255,255,255,.12),0 1px 2px rgba(0,0,0,.30);flex-shrink:0}
      .dlg-popup .dlg-head-icon svg{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
      .dlg-popup .dlg-head-titles{flex:1;min-width:0}
      .dlg-popup .dlg-title{font-size:14px;font-weight:600;color:var(--tx);letter-spacing:-.01em;line-height:1.2}
      .dlg-popup .dlg-sub{font-size:11px;color:var(--tx3);line-height:1.35;margin-top:2px;letter-spacing:.005em}
      .dlg-popup .dlg-x{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;color:var(--tx3);background:transparent;border:none;cursor:pointer;font-size:11px;flex-shrink:0;padding:0;transition:color .14s ease,background .14s ease,transform .14s ease}
      .dlg-popup .dlg-x:hover{color:var(--tx);background:rgba(255,255,255,.07)}
      .dlg-popup .dlg-x:active{transform:scale(.92)}

      .dlg-popup .dlg-body{display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden}
      .dlg-popup .dlg-body[data-scroll="auto"]{overflow-y:auto;padding:14px 16px 16px 16px}
      .dlg-popup .dlg-foot{display:flex;justify-content:space-between;align-items:center;padding:11px 14px;background:rgba(0,0,0,.28);border-top:1px solid rgba(255,255,255,.04);flex-shrink:0;gap:8px;box-shadow:inset 0 1px 0 rgba(0,0,0,.25)}
      .dlg-popup .dlg-foot .dlg-btn{padding:7px 13px;font-size:12px;border-radius:7px}
    `;
    document.head.appendChild(s);
  }

  // Read/write a popup's last position+size from localStorage so reopening
  // restores it. Re-clamped to the viewport at open time so a stale state
  // never renders off-screen.
  function _loadState(key) {
    try { return JSON.parse(localStorage.getItem('_dlg-pos:' + key) || 'null'); }
    catch { return null; }
  }
  function _saveState(key, card) {
    try {
      localStorage.setItem('_dlg-pos:' + key, JSON.stringify({
        left: card.offsetLeft, top: card.offsetTop,
        width: card.offsetWidth, height: card.offsetHeight,
      }));
    } catch {}
  }

  function create(opts) {
    _injectChromeStyles();
    const {
      id,
      title = '',
      subtitle = '',
      iconName = '',
      width = 640, height = 480,
      minWidth = 360, minHeight = 240,
      bodyHtml = '',
      footHtml = null,
      bodyScroll = false,            // when true, .dlg-body becomes scrollable with default padding
      persistKey = id,
      closeOnBackdrop = true,
      closeOnEscape = true,
    } = opts;

    if (!id) throw new Error('_DraggablePopup.create: id is required');

    let el = document.getElementById(id);
    if (el) {
      // Reuse the cached instance — calling _bind() again would re-attach
      // drag/resize/escape/outside-click handlers on top of existing ones,
      // so each reopen would double-fire (and over time, leak handlers).
      if (el._dlgInstance) return el._dlgInstance;
      const inst = _bind(el, opts);
      el._dlgInstance = inst;
      return inst;
    }

    el = document.createElement('div');
    el.id = id;
    el.className = 'dlg-popup';
    const iconHtml = iconName ? `<div class="dlg-head-icon"><i data-lucide="${iconName}"></i></div>` : '';
    const subHtml = `<div class="dlg-sub">${subtitle}</div>`;
    const footMarkup = footHtml != null ? `<div class="dlg-foot">${footHtml}</div>` : '';
    el.innerHTML = `
      <div class="dlg-pop">
        <div class="dlg-resize n"  data-dir="n"></div>
        <div class="dlg-resize s"  data-dir="s"></div>
        <div class="dlg-resize w"  data-dir="w"></div>
        <div class="dlg-resize e"  data-dir="e"></div>
        <div class="dlg-resize nw" data-dir="nw"></div>
        <div class="dlg-resize ne" data-dir="ne"></div>
        <div class="dlg-resize sw" data-dir="sw"></div>
        <div class="dlg-resize se" data-dir="se"></div>
        <div class="dlg-head">
          ${iconHtml}
          <div class="dlg-head-titles">
            <div class="dlg-title">${title}</div>
            ${subHtml}
          </div>
          <button class="dlg-x" aria-label="Close">✕</button>
        </div>
        <div class="dlg-body"${bodyScroll ? ' data-scroll="auto"' : ''}>${bodyHtml}</div>
        ${footMarkup}
      </div>`;
    document.body.appendChild(el);
    const inst = _bind(el, opts);
    el._dlgInstance = inst;
    return inst;
  }

  function _bind(el, opts) {
    const {
      width = 640, height = 480,
      minWidth = 360, minHeight = 240,
      persistKey = el.id,
      closeOnBackdrop = true,
      closeOnEscape = true,
      onClose = null,
    } = opts;

    const card    = el.querySelector('.dlg-pop');
    const head    = el.querySelector('.dlg-head');
    const body    = el.querySelector('.dlg-body');
    const foot    = el.querySelector('.dlg-foot');
    const titleEl = el.querySelector('.dlg-title');
    const subEl   = el.querySelector('.dlg-sub');
    const iconEl  = el.querySelector('.dlg-head-icon');
    const xBtn    = el.querySelector('.dlg-x');

    const _layout = (state) => {
      const W = state?.width  ?? width;
      const H = state?.height ?? height;
      const cw = Math.min(Math.max(W, minWidth), window.innerWidth - 24);
      const ch = Math.min(Math.max(H, minHeight), window.innerHeight - 24);
      card.style.width = cw + 'px';
      card.style.height = ch + 'px';
      card.style.minWidth = minWidth + 'px';
      card.style.minHeight = minHeight + 'px';
      let L, T;
      if (state && Number.isFinite(state.left) && Number.isFinite(state.top)) {
        L = Math.max(4, Math.min(state.left, window.innerWidth - cw - 4));
        T = Math.max(4, Math.min(state.top,  window.innerHeight - ch - 4));
      } else {
        L = Math.round((window.innerWidth - cw) / 2);
        T = Math.round((window.innerHeight - ch) / 2);
      }
      card.style.left = L + 'px';
      card.style.top  = T + 'px';
    };
    _layout(_loadState(persistKey));

    const _hide = () => {
      el.classList.remove('show');
      if (onClose) onClose();
    };
    const _show = () => {
      // Re-clamp every open: a previously stored size may exceed the
      // current viewport (window resize, monitor change), so without this
      // the popup can render partially off-screen.
      _layout({
        left: card.offsetLeft, top: card.offsetTop,
        width: card.offsetWidth, height: card.offsetHeight,
      });
      el.classList.add('show');
    };

    if (closeOnBackdrop) {
      el.addEventListener('mousedown', e => {
        if (!card.contains(e.target)) _hide();
      });
    }
    if (closeOnEscape) {
      document.addEventListener('keydown', e => {
        if (!el.classList.contains('show')) return;
        // Ignore Escape when an in-popup input is mid-IME composition; the
        // browser will handle it by cancelling composition rather than
        // dismissing.
        if (e.isComposing) return;
        if (e.key === 'Escape') { e.preventDefault(); _hide(); }
      }, true);
    }
    xBtn.addEventListener('click', _hide);

    // Drag from header (excluding close button).
    let drag = null;
    head.addEventListener('mousedown', e => {
      if (e.target.closest('.dlg-x')) return;
      const r = card.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      el.classList.add('dragging');
      e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
      if (!drag) return;
      const margin = 4;
      const w = card.offsetWidth, h = card.offsetHeight;
      let left = e.clientX - drag.dx;
      let top  = e.clientY - drag.dy;
      left = Math.max(margin, Math.min(left, window.innerWidth  - w - margin));
      top  = Math.max(margin, Math.min(top,  window.innerHeight - h - margin));
      card.style.left = left + 'px';
      card.style.top  = top  + 'px';
    });
    window.addEventListener('mouseup', () => {
      if (!drag) return;
      drag = null;
      el.classList.remove('dragging');
      _saveState(persistKey, card);
    });

    // Resize via 8 handles.
    let rsz = null;
    el.querySelectorAll('.dlg-resize').forEach(handle => {
      handle.addEventListener('mousedown', e => {
        e.preventDefault(); e.stopPropagation();
        const r = card.getBoundingClientRect();
        rsz = {
          dir: handle.dataset.dir,
          startX: e.clientX, startY: e.clientY,
          startL: r.left, startT: r.top,
          startW: r.width, startH: r.height,
        };
        el.classList.add('resizing');
      });
    });
    window.addEventListener('mousemove', e => {
      if (!rsz) return;
      const dx = e.clientX - rsz.startX;
      const dy = e.clientY - rsz.startY;
      const margin = 4;
      let L = rsz.startL, T = rsz.startT, W = rsz.startW, H = rsz.startH;
      if (rsz.dir.includes('e')) W = Math.max(minWidth,  Math.min(rsz.startW + dx, window.innerWidth  - rsz.startL - margin));
      if (rsz.dir.includes('s')) H = Math.max(minHeight, Math.min(rsz.startH + dy, window.innerHeight - rsz.startT - margin));
      if (rsz.dir.includes('w')) {
        const newW = Math.max(minWidth, rsz.startW - dx);
        L = Math.max(margin, rsz.startL + (rsz.startW - newW));
        W = newW;
      }
      if (rsz.dir.includes('n')) {
        const newH = Math.max(minHeight, rsz.startH - dy);
        T = Math.max(margin, rsz.startT + (rsz.startH - newH));
        H = newH;
      }
      card.style.left   = L + 'px';
      card.style.top    = T + 'px';
      card.style.width  = W + 'px';
      card.style.height = H + 'px';
    });
    window.addEventListener('mouseup', () => {
      if (!rsz) return;
      rsz = null;
      el.classList.remove('resizing');
      _saveState(persistKey, card);
    });

    return {
      el, card, body, foot, titleEl, subEl, iconEl, xBtn,
      show: _show, hide: _hide,
      setTitle: (t) => { titleEl.textContent = t; },
      setSubtitle: (t) => { if (subEl) subEl.textContent = t == null ? '' : String(t); },
    };
  }

  return { create };
})();

// Modal dialog
const _BatchRenameDialog = (() => {
  let bg, card;
  const STATE = { resolve: null, mode: 'find-replace', debounce: null, candidates: [], previewRows: [] };
  const E = id => bg && bg.querySelector('#' + id);

  function _injectStyles() {
    if (document.getElementById('_brn-dlg-style')) return;
    const s = document.createElement('style');
    s.id = '_brn-dlg-style';
    s.textContent = `
      /* Chrome (card, head, resize, body) is provided by _DraggablePopup.
         Only Batch Rename content classes live here. */
      #_brn-dialog .brn-cols{display:flex;flex:1;min-height:0}
      #_brn-dialog .brn-left{flex:0 0 360px;display:flex;flex-direction:column;border-right:1px solid rgba(255,255,255,.05);min-height:0;overflow:hidden}
      #_brn-dialog .brn-right{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0;background:rgba(0,0,0,.10)}
      #_brn-dialog .brn-right-head{padding:13px 16px 9px 16px;font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--tx3);border-bottom:1px solid rgba(255,255,255,.04);flex-shrink:0;background:transparent}
      .brn-tabs{display:inline-flex;gap:2px;padding:3px;margin:12px 14px 4px 14px;border-radius:8px;background:rgba(0,0,0,.22);border:1px solid rgba(255,255,255,.04);box-shadow:inset 0 1px 0 rgba(0,0,0,.20);flex-shrink:0;align-self:flex-start}
      .brn-tab{all:unset;padding:5px 11px;font-size:12px;color:var(--tx2);border-radius:6px;cursor:pointer;font-weight:500;transition:color .14s ease,background .14s ease,box-shadow .14s ease;letter-spacing:-.005em;text-align:center}
      .brn-tab:hover{color:var(--tx)}
      .brn-tab.active{background:linear-gradient(180deg,rgba(255,255,255,.09),rgba(255,255,255,.04));color:var(--tx);box-shadow:inset 0 1px 0 rgba(255,255,255,.08),inset 0 0 0 1px rgba(255,255,255,.05),0 1px 2px rgba(0,0,0,.30)}
      .brn-pane{display:none;flex-direction:column;gap:11px;padding:10px 14px 14px 14px;overflow:auto;flex:1;min-height:0}
      .brn-pane.active{display:flex}
      .brn-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .brn-row label{font-size:11px;color:var(--tx3);min-width:60px;font-weight:500;letter-spacing:.005em}
      .brn-row input[type=text]{flex:1;min-width:140px;padding:7px 10px;background:rgba(0,0,0,.24);border:1px solid rgba(255,255,255,.06);border-radius:7px;color:var(--tx);font:inherit;font-size:12.5px;outline:none;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;transition:border-color .14s ease,box-shadow .14s ease,background .14s ease;box-shadow:inset 0 1px 0 rgba(0,0,0,.25)}
      .brn-row input[type=text]:focus{border-color:rgba(110,168,255,.55);background:rgba(0,0,0,.32);box-shadow:0 0 0 3px rgba(110,168,255,.18),inset 0 1px 0 rgba(0,0,0,.25)}
      .brn-row input[type=number]{width:68px;padding:7px 9px;background:rgba(0,0,0,.24);border:1px solid rgba(255,255,255,.06);border-radius:7px;color:var(--tx);font:inherit;font-size:12.5px;outline:none;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;transition:border-color .14s ease,box-shadow .14s ease;box-shadow:inset 0 1px 0 rgba(0,0,0,.25)}
      .brn-row input[type=number]:focus{border-color:rgba(110,168,255,.55);box-shadow:0 0 0 3px rgba(110,168,255,.18),inset 0 1px 0 rgba(0,0,0,.25)}
      .brn-row input::placeholder{color:var(--tx3);opacity:.55}
      .brn-row select.mac-sel{padding:7px 9px;font-size:12.5px}
      .brn-tog{display:inline-flex;align-items:center;gap:7px;font-size:12px;color:var(--tx2);cursor:pointer;user-select:none;padding:5px 10px 5px 8px;border-radius:7px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);transition:background .14s ease,border-color .14s ease,color .14s ease}
      .brn-tog:hover{background:rgba(255,255,255,.05);color:var(--tx);border-color:rgba(255,255,255,.10)}
      .brn-tog input[type=checkbox]{appearance:none;-webkit-appearance:none;width:14px;height:14px;border-radius:4px;border:1.5px solid rgba(255,255,255,.22);background:transparent;cursor:pointer;flex-shrink:0;display:grid;place-items:center;margin:0;transition:border-color .14s ease,background .14s ease}
      .brn-tog input[type=checkbox]:hover{border-color:rgba(255,255,255,.34)}
      .brn-tog input[type=checkbox]:checked{background:var(--ac);border-color:var(--ac)}
      .brn-tog input[type=checkbox]:checked::after{content:'';width:8px;height:8px;background:no-repeat center/8px url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'><path d='M2.5 6.2 5 8.6l4.5-5.2' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/></svg>")}
      .brn-tog:has(input[type=checkbox]:checked){background:rgba(110,168,255,.10);border-color:rgba(110,168,255,.30);color:var(--tx)}
      .brn-tog input[type=radio]{appearance:none;-webkit-appearance:none;width:14px;height:14px;border-radius:50%;border:1.5px solid rgba(255,255,255,.22);background:transparent;cursor:pointer;flex-shrink:0;display:grid;place-items:center;margin:0;transition:border-color .14s ease,background .14s ease}
      .brn-tog input[type=radio]:hover{border-color:rgba(255,255,255,.34)}
      .brn-tog input[type=radio]:checked{border-color:var(--ac);background:var(--ac)}
      .brn-tog input[type=radio]:checked::after{content:'';width:5px;height:5px;border-radius:50%;background:#fff}
      .brn-section-title{font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--tx3);margin:8px 0 6px 0}
      .brn-presets-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px}
      .brn-preset{all:unset;padding:10px 12px;border:1px solid rgba(255,255,255,.06);border-radius:9px;background:rgba(255,255,255,.025);cursor:pointer;display:flex;flex-direction:column;gap:2px;transition:border-color .14s ease,background .14s ease,transform .14s ease}
      .brn-preset:hover{border-color:rgba(110,168,255,.32);background:rgba(110,168,255,.06)}
      .brn-preset:active{transform:translateY(.5px)}
      .brn-preset .n{font-size:13px;font-weight:500;color:var(--tx)}
      .brn-preset .d{font-size:11px;color:var(--tx3);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .brn-summary{display:flex;justify-content:space-between;align-items:center;padding:9px 16px;background:rgba(0,0,0,.22);border-top:1px solid rgba(255,255,255,.04);font-size:11.5px;color:var(--tx3);flex-shrink:0;flex-wrap:wrap;gap:6px;font-variant-numeric:tabular-nums;letter-spacing:.005em}
      .brn-summary .ok{color:var(--ok);font-weight:600}
      .brn-summary .warn{color:var(--wn);font-weight:600}
      .brn-summary .err{color:var(--er);font-weight:600}
      .brn-preview{flex:1 1 auto;min-height:0;overflow:auto;background:transparent}
      .brn-preview-table{width:100%;border-collapse:collapse;font-size:12px;font-family:ui-monospace,monospace}
      .brn-preview-table tr{border-bottom:1px solid var(--bd)}
      .brn-preview-table tr.warn{background:rgba(251,191,36,.05)}
      .brn-preview-table tr.error{background:rgba(255,107,107,.06)}
      .brn-preview-table tr.unchanged{opacity:.5}
      .brn-preview-table tr.skipped{opacity:.35}
      .brn-preview-table td{padding:5px 12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:300px}
      .brn-preview-table td.kind{color:var(--tx3);font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;width:60px;font-family:inherit}
      .brn-preview-table td.arrow{color:var(--tx3);width:24px;text-align:center}
      .brn-preview-table td.new{color:var(--ac)}
      .brn-preview-table tr.warn td.new{color:var(--wn)}
      .brn-preview-table tr.error td.new{color:var(--er)}
      .brn-preview-table tr.unchanged td.new{color:var(--tx3)}
      .brn-preview-table tr.skipped td.new{color:var(--tx3)}
      .brn-preview-table td.reason{color:var(--tx3);font-size:11px;font-family:inherit}
      .brn-foot{display:flex;justify-content:space-between;align-items:center;padding:11px 14px;background:rgba(0,0,0,.28);border-top:1px solid rgba(255,255,255,.04);flex-shrink:0;gap:8px;box-shadow:inset 0 1px 0 rgba(0,0,0,.25)}
      .brn-foot .dlg-btn{padding:7px 13px;font-size:12px;border-radius:7px}
      .brn-foot #_brn-save{background:transparent;border-color:transparent;color:var(--tx3);padding:7px 4px;font-weight:500}
      .brn-foot #_brn-save:hover{color:var(--ac);background:transparent;border-color:transparent;text-decoration:underline;text-underline-offset:3px;text-decoration-color:rgba(110,168,255,.5)}
      .brn-foot #_brn-ok{box-shadow:0 4px 14px rgba(110,168,255,.30),inset 0 1px 0 rgba(255,255,255,.20),inset 0 0 0 1px rgba(255,255,255,.06)}
      .brn-foot #_brn-ok:disabled{opacity:.40;filter:grayscale(.3) brightness(.85);cursor:not-allowed;box-shadow:none}
      .brn-foot #_brn-ok:disabled:hover{filter:grayscale(.3) brightness(.85)}
      .brn-collapsible{border:1px solid rgba(255,255,255,.06);border-radius:9px;background:rgba(255,255,255,.02);overflow:hidden;flex-shrink:0;transition:border-color .14s ease,background .14s ease}
      .brn-collapsible:hover{border-color:rgba(255,255,255,.09)}
      .brn-collapsible.open{background:rgba(255,255,255,.025);border-color:rgba(255,255,255,.08)}
      .brn-collapsible-h{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;cursor:pointer;font-size:12px;color:var(--tx2);user-select:none;transition:background .12s ease,color .12s ease}
      .brn-collapsible-h:hover{background:rgba(255,255,255,.025);color:var(--tx)}
      .brn-collapsible-h strong{color:var(--tx);font-weight:600}
      .brn-collapsible-h .chev{
        display:inline-grid;place-items:center;
        width:18px;height:18px;border-radius:5px;
        font-size:0;line-height:0;flex-shrink:0;
        background:rgba(255,255,255,.04);
        color:var(--tx2);opacity:.85;
        transition:transform .2s cubic-bezier(.2,.85,.3,1.1),color .14s ease,background .14s ease,opacity .14s ease;
      }
      .brn-collapsible-h .chev::before{
        content:'';width:8px;height:8px;
        border-right:1.6px solid currentColor;
        border-bottom:1.6px solid currentColor;
        transform:translateX(-1px) rotate(-45deg);
        transition:transform .2s cubic-bezier(.2,.85,.3,1.1);
      }
      .brn-collapsible-h:hover .chev{background:rgba(255,255,255,.07);color:var(--tx);opacity:1}
      .brn-collapsible.open .chev{background:rgba(110,168,255,.15);color:var(--ac);opacity:1}
      .brn-collapsible.open .chev::before{transform:translateY(-1px) rotate(45deg)}
      .brn-collapsible-b{display:none;padding:10px 12px 12px 12px;border-top:1px solid rgba(255,255,255,.05);flex-direction:column;gap:8px}
      .brn-collapsible.open .brn-collapsible-b{display:flex}
      .brn-token-pop{position:absolute;background:#161b24;border:1px solid rgba(255,255,255,.07);border-radius:10px;box-shadow:0 16px 40px rgba(0,0,0,.55),0 0 0 1px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.06);padding:4px;z-index:600;display:none;max-height:280px;overflow:auto;min-width:280px}
      .brn-token-pop.show{display:block}
      .brn-token-item{padding:6px 10px;border-radius:5px;cursor:pointer;display:flex;justify-content:space-between;gap:14px;align-items:center;font-family:ui-monospace,monospace;font-size:12px;color:var(--tx)}
      .brn-token-item:hover,.brn-token-item.active{background:var(--ac-soft)}
      .brn-token-item .desc{color:var(--tx3);font-size:11px;font-family:inherit;font-weight:400}
      .brn-token-item .tname{font-weight:600;color:var(--ac)}
      .brn-help{font-size:10.5px;color:var(--tx3);padding-left:68px}
      .brn-help code{font-family:ui-monospace,monospace;color:var(--ac);background:rgba(0,0,0,.25);padding:0 4px;border-radius:3px}
    `;
    document.head.appendChild(s);
  }

  function _scopeRowHtml() {
    return `
      <div class="brn-collapsible open">
        <div class="brn-collapsible-h"><span><strong>Scope</strong> · what to rename</span><span class="chev">▸</span></div>
        <div class="brn-collapsible-b">
          <div style="display:flex;flex-direction:column;gap:5px">
            <label class="brn-tog" style="background:none;border:none;padding:2px 0"><input type="radio" name="_brn-scope" value="selection" checked>Selection (parts + groups picked in tree)</label>
            <label class="brn-tog" style="background:none;border:none;padding:2px 0"><input type="radio" name="_brn-scope" value="selection-with-children">Selection + descendants</label>
            <label class="brn-tog" style="background:none;border:none;padding:2px 0"><input type="radio" name="_brn-scope" value="selected-parts">Only selected parts</label>
            <label class="brn-tog" style="background:none;border:none;padding:2px 0"><input type="radio" name="_brn-scope" value="selected-groups">Only selected groups</label>
            <label class="brn-tog" style="background:none;border:none;padding:2px 0"><input type="radio" name="_brn-scope" value="whole-tree">Whole tree (every part + every group)</label>
          </div>
        </div>
      </div>`;
  }
  function _filtersCollapsibleHtml() {
    return `
      <div class="brn-collapsible">
        <div class="brn-collapsible-h"><span><strong>Apply only if…</strong> (optional filters)</span><span class="chev">▸</span></div>
        <div class="brn-collapsible-b">
          <div class="brn-row">
            <label>Name regex</label>
            <input type="text" data-filter="matchRegex" data-filter-trigger placeholder="must match (blank = none)">
          </div>
          <div class="brn-row">
            <label>NOT regex</label>
            <input type="text" data-filter="notMatchRegex" data-filter-trigger placeholder="must NOT match">
          </div>
          <div class="brn-row">
            <label>Color =</label>
            <input type="text" data-filter="colorEq" data-filter-trigger placeholder="#ff0000" style="max-width:120px;flex:0 0 auto">
            <label style="margin-left:14px">Kind</label>
            <select data-filter="kindOnly" data-filter-trigger class="mac-sel" style="max-width:140px">
              <option value="">any</option><option value="part">parts only</option><option value="group">groups only</option>
            </select>
          </div>
          <div class="brn-row">
            <label>Depth</label>
            <input type="number" data-filter="depthMin" data-filter-trigger placeholder="min" style="max-width:80px">
            <input type="number" data-filter="depthMax" data-filter-trigger placeholder="max" style="max-width:80px">
            <label style="margin-left:14px">Tris</label>
            <input type="number" data-filter="trisMin" data-filter-trigger placeholder="min" style="max-width:80px">
            <input type="number" data-filter="trisMax" data-filter-trigger placeholder="max" style="max-width:80px">
          </div>
        </div>
      </div>`;
  }

  function _ensure() {
    if (bg) return;
    _injectStyles();

    const bodyHtml = `
      <div class="brn-cols">
        <div class="brn-left">
          <div class="brn-tabs">
            <button class="brn-tab active" data-pane="find">Find &amp; Replace</button>
            <button class="brn-tab" data-pane="pattern">Pattern</button>
            <button class="brn-tab" data-pane="presets">Presets</button>
          </div>

          <div class="brn-pane active" data-pane="find">
            <div class="brn-row">
              <label>Find</label>
              <input type="text" id="_brn-find" placeholder="text or regex">
            </div>
            <div class="brn-row" style="padding-left:68px">
              <label class="brn-tog"><input type="checkbox" id="_brn-regex"> regex</label>
              <label class="brn-tog"><input type="checkbox" id="_brn-case"> match case</label>
            </div>
            <div class="brn-row">
              <label>Replace</label>
              <input type="text" id="_brn-replace" placeholder="(use $1 $2 with regex)">
            </div>
            ${_filtersCollapsibleHtml()}
            ${_scopeRowHtml()}
          </div>

          <div class="brn-pane" data-pane="pattern">
            <div class="brn-row">
              <label>Pattern</label>
              <input type="text" id="_brn-pattern" placeholder="e.g. {parent}_{counter:003}" autocomplete="off" spellcheck="false">
            </div>
            <div class="brn-help">
              Type <code>{</code> for tokens · chain modifiers with <code>:</code>
            </div>
            <div class="brn-collapsible">
              <div class="brn-collapsible-h"><span><strong>Counter</strong></span><span class="chev">▸</span></div>
              <div class="brn-collapsible-b">
                <div class="brn-row">
                  <label>Start</label><input type="number" id="_brn-cnt-start" value="1" step="1">
                  <label>Step</label><input type="number" id="_brn-cnt-step" value="1" step="1">
                </div>
                <div class="brn-row">
                  <label>Reset per</label>
                  <select id="_brn-cnt-mode" class="mac-sel">
                    <option value="global">none</option>
                    <option value="parent">parent group</option>
                    <option value="color">color bucket</option>
                    <option value="size">size bucket</option>
                  </select>
                </div>
              </div>
            </div>
            ${_filtersCollapsibleHtml()}
            ${_scopeRowHtml()}
          </div>

          <div class="brn-pane" data-pane="presets">
            <div class="brn-section-title">Built-in</div>
            <div class="brn-presets-grid" id="_brn-presets-builtin"></div>
            <div class="brn-section-title" style="margin-top:14px">My presets</div>
            <div class="brn-presets-grid" id="_brn-presets-user"></div>
            <div style="font-size:11px;color:var(--tx3);margin-top:6px">Build a rule in another tab, then click <em>Save preset…</em> to add it here.</div>
          </div>

          <div class="brn-foot">
            <div style="display:flex;gap:8px">
              <button class="dlg-btn dlg-btn-cancel" id="_brn-save">Save preset…</button>
            </div>
            <div style="display:flex;gap:8px">
              <button class="dlg-btn dlg-btn-cancel" id="_brn-cancel">Cancel</button>
              <button class="dlg-btn dlg-btn-ok" id="_brn-ok">Apply</button>
            </div>
          </div>
        </div>

        <div class="brn-right">
          <div class="brn-right-head">Preview</div>
          <div class="brn-preview">
            <table class="brn-preview-table" id="_brn-preview"></table>
          </div>
          <div class="brn-summary" id="_brn-summary">No candidates yet</div>
        </div>
      </div>`;

    const popup = _DraggablePopup.create({
      id: '_brn-dialog',
      title: 'Batch rename',
      subtitle: '—',
      iconName: 'signature',
      width: 880, height: 580,
      minWidth: 560, minHeight: 380,
      bodyHtml,
      onClose: () => _close(null),
    });
    bg = popup.el;
    card = popup.card;

    // Token autocomplete popup is positioned absolute relative to the card.
    card.insertAdjacentHTML('beforeend', '<div class="brn-token-pop" id="_brn-token-pop"></div>');
    // Some BR helpers read subtitle via #_brn-sub; expose the helper's .dlg-sub
    // under that id so the existing _updateScopeSummary code keeps working.
    popup.subEl.id = '_brn-sub';

    bg.querySelectorAll('.brn-tab').forEach(t => t.addEventListener('click', () => {
      bg.querySelectorAll('.brn-tab').forEach(x => x.classList.toggle('active', x === t));
      bg.querySelectorAll('.brn-pane').forEach(p => p.classList.toggle('active', p.dataset.pane === t.dataset.pane));
      if (t.dataset.pane === 'find') STATE.mode = 'find-replace';
      else if (t.dataset.pane === 'pattern') STATE.mode = 'pattern';
      _refreshPreview();
    }));
    bg.querySelectorAll('.brn-collapsible-h').forEach(h => h.addEventListener('click', () => {
      h.parentElement.classList.toggle('open');
    }));

    const inputs = ['_brn-find','_brn-replace','_brn-regex','_brn-case','_brn-pattern','_brn-cnt-start','_brn-cnt-step','_brn-cnt-mode'];
    for (const id of inputs) {
      const el = E(id);
      if (!el) continue;
      el.addEventListener('input', _refreshPreview);
      if (el.tagName === 'SELECT' || el.type === 'checkbox') el.addEventListener('change', _refreshPreview);
    }
    bg.querySelectorAll('[data-filter-trigger]').forEach(el => {
      el.addEventListener('input', _refreshPreview);
      el.addEventListener('change', _refreshPreview);
    });
    bg.querySelectorAll('input[name="_brn-scope"]').forEach(r => r.addEventListener('change', () => {
      STATE.candidates = _BatchRename.gatherCandidates(_currentScope());
      _updateScopeSummary();
      _refreshPreview();
    }));

    _wireTokenAutocomplete(E('_brn-pattern'));

    E('_brn-cancel').addEventListener('click', () => _close(null));
    E('_brn-ok').addEventListener('click', _onApply);
    E('_brn-save').addEventListener('click', _onSavePreset);

    // Ctrl/Cmd+Enter applies. Escape and click-outside are handled by
    // _DraggablePopup which routes through onClose → _close(null).
    document.addEventListener('keydown', e => {
      if (!bg.classList.contains('show')) return;
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); _onApply(); }
    }, true);
  }

  function _currentScope() {
    const r = bg.querySelector('input[name="_brn-scope"]:checked');
    return r ? r.value : 'selection';
  }
  function _currentFilterOpts() {
    const pane = bg.querySelector('.brn-pane.active');
    if (!pane) return {};
    const f = {};
    pane.querySelectorAll('[data-filter]').forEach(el => {
      const k = el.dataset.filter;
      const v = el.value?.trim();
      if (!v) return;
      if (['depthMin','depthMax','trisMin','trisMax'].includes(k)) f[k] = parseInt(v, 10);
      else f[k] = v;
    });
    return f;
  }
  function _currentRule() {
    if (STATE.mode === 'find-replace') {
      return {
        kind: 'find-replace',
        find: E('_brn-find').value,
        replace: E('_brn-replace').value,
        regex: E('_brn-regex').checked,
        matchCase: E('_brn-case').checked,
      };
    }
    if (STATE.mode === 'pattern') {
      const tmpl = E('_brn-pattern').value;
      const compiled = _BatchRename.compileTemplate(tmpl);
      return { kind: 'pattern', template: tmpl, fn: compiled.fn, ok: compiled.ok, errors: compiled.errors };
    }
    return { kind: 'none' };
  }
  function _currentCounter() {
    return {
      start: parseInt(E('_brn-cnt-start')?.value, 10) || 1,
      step:  parseInt(E('_brn-cnt-step')?.value, 10) || 1,
      mode:  E('_brn-cnt-mode')?.value || 'global',
    };
  }
  function _updateScopeSummary() {
    const partsCount = STATE.candidates.filter(c => c.kind === 'part').length;
    const groupsCount = STATE.candidates.filter(c => c.kind !== 'part').length;
    E('_brn-sub').textContent = `${partsCount} part${partsCount === 1 ? '' : 's'} + ${groupsCount} group${groupsCount === 1 ? '' : 's'} in scope · live preview · Ctrl+Z reverts`;
  }

  function _refreshPreview() {
    if (STATE.debounce) clearTimeout(STATE.debounce);
    STATE.debounce = setTimeout(_doPreview, 80);
  }
  function _doPreview() {
    const rule = _currentRule();
    const filterFn = _BatchRename.makeFilter(_currentFilterOpts());
    const cands = STATE.candidates;
    const rows = (rule.kind === 'pattern' && !rule.ok)
      ? cands.map(c => ({ cand: c, oldName: c.currentName, newName: c.currentName, status: 'error', reason: rule.errors[0] || 'parse error' }))
      : _BatchRename.buildPreview(cands, rule, filterFn, _currentCounter());
    STATE.previewRows = rows;
    _renderPreview(rows);
  }
  function _renderPreview(rows) {
    const tbl = E('_brn-preview');
    if (!tbl) return;
    const summary = { ok: 0, warn: 0, error: 0, unchanged: 0, skipped: 0 };
    for (const r of rows) summary[r.status] = (summary[r.status] || 0) + 1;
    // Render all rows. The preview container is `overflow:auto` + capped height,
    // so the browser only paints rows that scroll into view. innerHTML cost on
    // a 5000-row table is well under one frame; debounce already prevents
    // per-keystroke thrash.
    const html = rows.map(r => {
      const k = r.cand.kind === 'part' ? 'PART' : r.cand.kind === 'hier-group' ? 'GROUP' : 'UGRP';
      const reason = r.reason ? `<td class="reason">${escapeHtml(r.reason)}</td>` : '<td class="reason"></td>';
      return `<tr class="${r.status}">
        <td class="kind">${k}</td>
        <td>${escapeHtml(r.oldName)}</td>
        <td class="arrow">→</td>
        <td class="new">${escapeHtml(r.newName)}</td>
        ${reason}
      </tr>`;
    }).join('');
    tbl.innerHTML = html || `<tr><td style="padding:14px 12px;color:var(--tx3)">No candidates in scope. Pick parts or groups in the tree, or change Scope below.</td></tr>`;
    const sub = E('_brn-summary');
    if (sub) sub.innerHTML = `
      <span><span class="ok">${summary.ok} ok</span>${summary.warn ? ` · <span class="warn">${summary.warn} warn</span>` : ''}${summary.error ? ` · <span class="err">${summary.error} error</span>` : ''}${summary.unchanged ? ` · ${summary.unchanged} unchanged` : ''}${summary.skipped ? ` · ${summary.skipped} skipped` : ''}</span>
      <span style="color:var(--tx3)">${rows.length} total candidate${rows.length === 1 ? '' : 's'}</span>`;
    const ok = E('_brn-ok');
    const applyCount = summary.ok + summary.warn;
    if (ok) {
      ok.disabled = applyCount === 0 || summary.error > 0;
      ok.textContent = applyCount > 0 ? `Apply ${applyCount} change${applyCount === 1 ? '' : 's'}` : 'Apply';
    }
  }

  function _onApply() {
    const rows = STATE.previewRows;
    const okCount = rows.filter(r => r.status === 'ok' || r.status === 'warn').length;
    if (!okCount) return;
    const errCount = rows.filter(r => r.status === 'error').length;
    if (errCount > 0) { toast?.('Cannot apply', `${errCount} row${errCount === 1 ? ' has' : 's have'} errors — fix or filter them out`, 'warn'); return; }
    const written = _BatchRename.commit(rows);
    if (written > 0) _close(true);
  }

  async function _onSavePreset() {
    const name = await appPrompt('Name this preset:', '', { title: 'Save batch rename preset', okLabel: 'Save' });
    if (!name) return;
    const trimmed = String(name).trim();
    if (!trimmed) { toast?.('Name your preset', '', 'warn'); return; }
    let preset;
    if (STATE.mode === 'find-replace') {
      preset = { name: trimmed, mode: 'find-replace', config: { find: E('_brn-find').value, replace: E('_brn-replace').value, regex: E('_brn-regex').checked, matchCase: E('_brn-case').checked } };
    } else {
      preset = { name: trimmed, mode: 'pattern', config: { template: E('_brn-pattern').value, counterMode: E('_brn-cnt-mode').value, counterStart: E('_brn-cnt-start').value, counterStep: E('_brn-cnt-step').value } };
    }
    const arr = _BatchRename.loadUserPresets();
    const exists = arr.findIndex(p => p.name === trimmed);
    if (exists >= 0) arr[exists] = preset; else arr.push(preset);
    _BatchRename.saveUserPresets(arr);
    _renderPresets();
    toast?.('Preset saved', trimmed, 'success');
  }

  function _renderPresets() {
    const builtinEl = E('_brn-presets-builtin');
    const userEl = E('_brn-presets-user');
    if (builtinEl) builtinEl.innerHTML = _BatchRename.BUILTIN_PRESETS.map((p, i) => _presetButtonHtml(p, 'b' + i)).join('');
    const user = _BatchRename.loadUserPresets();
    if (userEl) userEl.innerHTML = user.length
      ? user.map((p, i) => _presetButtonHtml(p, 'u' + i, true)).join('')
      : '<div style="font-size:12px;color:var(--tx3);padding:6px 0">None saved yet.</div>';
    bg.querySelectorAll('.brn-preset').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.id;
      const isUser = id.startsWith('u');
      const list = isUser ? _BatchRename.loadUserPresets() : _BatchRename.BUILTIN_PRESETS;
      const p = list[parseInt(id.slice(1), 10)];
      if (!p) return;
      _applyPresetToUI(p);
    }));
  }
  function _presetButtonHtml(p, id, isUser = false) {
    const subtitle = p.mode === 'find-replace'
      ? `find: ${p.config.find || '∅'}${p.config.regex ? ' (re)' : ''}`
      : `template: ${p.config.template || '∅'}`;
    return `<button class="brn-preset" data-id="${id}">
      <div class="n">${escapeHtml(p.name)}${isUser ? ' <span style="color:var(--tx3);font-size:10.5px">(yours)</span>' : ''}</div>
      <div class="d">${escapeHtml(subtitle)}</div>
    </button>`;
  }
  function _applyPresetToUI(preset) {
    if (preset.mode === 'find-replace') {
      bg.querySelector('[data-pane="find"].brn-tab').click();
      E('_brn-find').value = preset.config.find || '';
      E('_brn-replace').value = preset.config.replace || '';
      E('_brn-regex').checked = !!preset.config.regex;
      E('_brn-case').checked = !!preset.config.matchCase;
    } else {
      bg.querySelector('[data-pane="pattern"].brn-tab').click();
      E('_brn-pattern').value = preset.config.template || '';
      if (preset.config.counterMode) E('_brn-cnt-mode').value = preset.config.counterMode;
      if (preset.config.counterStart) E('_brn-cnt-start').value = preset.config.counterStart;
      if (preset.config.counterStep) E('_brn-cnt-step').value = preset.config.counterStep;
    }
    _refreshPreview();
  }

  function _wireTokenAutocomplete(input) {
    if (!input) return;
    const pop = E('_brn-token-pop');
    let activeIdx = 0;
    let activeList = [];

    const close = () => { pop.classList.remove('show'); activeList = []; activeIdx = 0; };
    const positionAtCaret = () => {
      const r = input.getBoundingClientRect();
      const cardR = card.getBoundingClientRect();
      pop.style.left = (r.left - cardR.left + 80) + 'px';
      pop.style.top  = (r.bottom - cardR.top + 4) + 'px';
    };
    const showList = (list, kind) => {
      activeList = list;
      activeIdx = 0;
      pop.innerHTML = list.map((t, i) =>
        `<div class="brn-token-item${i === 0 ? ' active' : ''}" data-i="${i}">
          <span class="tname">${kind === 'token' ? '{' + t.name + '}' : ':' + t.name}</span>
          <span class="desc">${escapeHtml(t.desc)}</span>
        </div>`).join('');
      pop.querySelectorAll('.brn-token-item').forEach(el => {
        el.addEventListener('mousedown', e => { e.preventDefault(); _insertToken(el.dataset.i); });
        el.addEventListener('mouseenter', () => {
          pop.querySelectorAll('.brn-token-item').forEach(x => x.classList.remove('active'));
          el.classList.add('active');
          activeIdx = parseInt(el.dataset.i, 10);
        });
      });
      positionAtCaret();
      pop.classList.add('show');
      pop._kind = kind;
    };

    function _insertToken(idx) {
      const i = parseInt(idx, 10);
      const t = activeList[i];
      if (!t) { close(); return; }
      const caret = input.selectionStart;
      const v = input.value;
      const kind = pop._kind;
      if (kind === 'token') {
        let s = caret - 1;
        while (s >= 0 && v[s] !== '{') s--;
        if (s < 0) s = caret;
        const before = v.slice(0, s);
        const after = v.slice(caret);
        const next = before + '{' + t.name + '}' + after;
        input.value = next;
        const newCaret = (before + '{' + t.name + '}').length;
        input.setSelectionRange(newCaret, newCaret);
      } else {
        const next = v.slice(0, caret) + t.name + v.slice(caret);
        input.value = next;
        input.setSelectionRange(caret + t.name.length, caret + t.name.length);
      }
      close();
      input.focus();
      _refreshPreview();
    }

    input.addEventListener('input', () => {
      const caret = input.selectionStart;
      const v = input.value;
      let s = caret - 1;
      while (s >= 0 && v[s] !== '{' && v[s] !== '}') s--;
      if (s < 0 || v[s] !== '{') { close(); return; }
      const inside = v.slice(s + 1, caret);
      const colonIdx = inside.lastIndexOf(':');
      if (colonIdx === -1) {
        const prefix = inside;
        const list = _BatchRename.TOKEN_CATALOG.filter(t => t.name.toLowerCase().startsWith(prefix.toLowerCase()));
        if (!list.length) { close(); return; }
        showList(list, 'token');
      } else {
        const prefix = inside.slice(colonIdx + 1).replace(/\(.*$/, '');
        const list = _BatchRename.MODIFIER_CATALOG.filter(t => t.name.toLowerCase().startsWith(prefix.toLowerCase()));
        if (!list.length) { close(); return; }
        showList(list, 'mod');
      }
    });
    input.addEventListener('keydown', e => {
      if (!pop.classList.contains('show')) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const items = pop.querySelectorAll('.brn-token-item');
        items[activeIdx]?.classList.remove('active');
        activeIdx = (activeIdx + 1) % items.length;
        items[activeIdx]?.classList.add('active');
        items[activeIdx]?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const items = pop.querySelectorAll('.brn-token-item');
        items[activeIdx]?.classList.remove('active');
        activeIdx = (activeIdx - 1 + items.length) % items.length;
        items[activeIdx]?.classList.add('active');
        items[activeIdx]?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        _insertToken(activeIdx);
      } else if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        close();
      }
    }, true);
    input.addEventListener('blur', () => setTimeout(close, 120));
  }

  function _close(result) {
    bg.classList.remove('show');
    const f = STATE.resolve; STATE.resolve = null;
    if (f) f(result);
  }

  return {
    async open(/* anchorEl ignored — _DraggablePopup persists/restores position */) {
      _ensure();
      // Default scope: 'selection' if anything is selected in the tree, else
      // 'whole-tree' so the popup is useful out of the box — typing in Find
      // immediately produces preview rows without requiring a prior selection.
      const hasSelection = (state.selected?.size || 0) + (state.selectedGroupIds?.size || 0) > 0;
      const defaultScope = hasSelection ? 'selection' : 'whole-tree';
      bg.querySelectorAll('input[name="_brn-scope"]').forEach(r => { r.checked = (r.value === defaultScope); });
      STATE.candidates = _BatchRename.gatherCandidates(defaultScope);
      E('_brn-find').value = '';
      E('_brn-replace').value = '';
      E('_brn-pattern').value = '';
      bg.querySelector('[data-pane="find"].brn-tab').click();
      _renderPresets();
      _updateScopeSummary();
      _refreshPreview();
      _lucide?.();
      bg.classList.add('show');
      setTimeout(() => E('_brn-find')?.focus(), 60);
      return new Promise(res => { STATE.resolve = res; });
    },
  };
})();

// Undo / redo wrappers for 'batchRename'
const _origUndoLast_batchRename = undoLast;
undoLast = function() {
  const op = state.history[state.history.length - 1];
  if (op && op.type === 'batchRename') {
    state.history.pop();
    for (const ch of op.changes) {
      if (ch.kind === 'part') {
        const p = getPart(ch.partId);
        if (p) { p.name = ch.oldName; if (p.mesh) p.mesh.name = ch.oldName; }
        if (ch.treeNodeId != null) {
          const tn = (state.treeNodes || []).find(n => n.kind === 'part' && n.id === ch.treeNodeId);
          if (tn) tn.name = ch.oldName;
        }
      } else if (ch.kind === 'hier-group') {
        const tn = (state.treeNodes || []).find(n => n.id === ch.treeNodeId);
        if (tn) tn.name = ch.oldName;
        if (ch.obj3dRef) ch.obj3dRef.name = ch.oldName;
      } else if (ch.kind === 'user-group') {
        const ug = (state.userGroups || []).find(g => g.id === ch.userGroupId);
        if (ug) { ug.name = ch.oldName; if (ug.ref) ug.ref.name = ch.oldName; }
      }
    }
    state.redo.push(op);
    _finalizeUndo({ rebuildTree: true });
    return;
  }
  return _origUndoLast_batchRename();
};

const _origRedoLast_batchRename = redoLast;
redoLast = function() {
  const op = state.redo[state.redo.length - 1];
  if (op && op.type === 'batchRename') {
    state.redo.pop();
    for (const ch of op.changes) {
      if (ch.kind === 'part') {
        const p = getPart(ch.partId);
        if (p) { p.name = ch.newName; if (p.mesh) p.mesh.name = ch.newName; }
        if (ch.treeNodeId != null) {
          const tn = (state.treeNodes || []).find(n => n.kind === 'part' && n.id === ch.treeNodeId);
          if (tn) tn.name = ch.newName;
        }
      } else if (ch.kind === 'hier-group') {
        const tn = (state.treeNodes || []).find(n => n.id === ch.treeNodeId);
        if (tn) tn.name = ch.newName;
        if (ch.obj3dRef) ch.obj3dRef.name = ch.newName;
      } else if (ch.kind === 'user-group') {
        const ug = (state.userGroups || []).find(g => g.id === ch.userGroupId);
        if (ug) { ug.name = ch.newName; if (ug.ref) ug.ref.name = ch.newName; }
      }
    }
    state.history.push(op);
    _finalizeUndo({ rebuildTree: true });
    return;
  }
  return _origRedoLast_batchRename();
};

// Toolbar wiring + F2 shortcut
function _openBatchRenameDialog(anchor) { return _BatchRenameDialog.open(anchor); }

const _origWireUI_batchRename = wireUI;
wireUI = function() {
  _origWireUI_batchRename();
  const btn = document.getElementById('tree-batch-rename');
  btn?.addEventListener('click', () => _openBatchRenameDialog(btn));
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
    if (e.key === 'F2') {
      e.preventDefault();
      _openBatchRenameDialog(document.getElementById('tree-batch-rename'));
    }
  });
};

const _origWireUI_groups = wireUI;
wireUI = function() {
  _origWireUI_groups();
  _safeRun(_wireUserGroupTreeHandlers, 'user-group-tree');
  _safeRun(_wireDeadTreeControls,      'tree-controls');
};

// =================================================================
// Properties panel — show group info when an entire group is selected
// =================================================================
const _origRefreshProps_groups = refreshPropertiesPanel;
refreshPropertiesPanel = function() {
  if (state.selected.size > 0 && state.userGroups.length > 0) {
    const sel = state.selected;
    for (const g of state.userGroups) {
      if (g.partIds.size !== sel.size) continue;
      let allIn = true;
      for (const id of g.partIds) if (!sel.has(id)) { allIn = false; break; }
      if (!allIn) continue;
      const totalTri = [...g.partIds].reduce((s, id) => s + (getPart(id)?.triCount || 0), 0);
      const html = `
        <div style="display:grid;gap:8px;font-size:12px">
          <div style="font-weight:600;color:var(--ac2);font-size:13px">📁 ${g.name}</div>
          <div style="color:var(--tx2)">${g.partIds.size} parts · ${fmtNum(totalTri)} triangles</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:4px">
            <button class="btn" data-grp-act="rename" data-gid="${g.id}">Rename</button>
            <button class="btn warn" data-grp-act="ungroup" data-gid="${g.id}">Ungroup</button>
          </div>
        </div>`;
      const body = $('prop-body');
      body.innerHTML = html;
      body.querySelectorAll('[data-grp-act]').forEach(btn => {
        btn.addEventListener('click', () => {
          const a = btn.dataset.grpAct, gid = btn.dataset.gid;
          if (a === 'rename') {
            const g2 = getGroupById(gid); if (!g2) return;
            appPrompt('Rename group', g2.name, { title: 'Rename group', okLabel: 'Rename' }).then(nx => {
              if (nx && nx.trim()) renameUserGroup(gid, nx.trim());
            });
          } else if (a === 'ungroup') { removeUserGroup(gid); }
        });
      });
      return;
    }
  }
  return _origRefreshProps_groups();
};

// =================================================================
// STEP assembly hierarchy → user groups
// occt-import-js returns result.root with {name, meshes, children}
// =================================================================
const _origParseStepInWorker_groups = parseStepInWorker;
parseStepInWorker = function(...args) {
  return _origParseStepInWorker_groups(...args).then(out => {
    state._pendingStepRoot = (out && out.result && out.result.root) || null;
    return out;
  });
};

function _importStepAssemblyAsGroups(rootNode) {
  if (!rootNode) return 0;
  if (!Array.isArray(rootNode.children) || rootNode.children.length === 0) return 0;
  let made = 0;
  for (const child of rootNode.children) {
    // collect every mesh index reachable under this child
    const meshIds = [];
    (function collect(n) {
      if (!n) return;
      if (Array.isArray(n.meshes)) for (const mi of n.meshes) meshIds.push(mi);
      if (Array.isArray(n.children)) for (const c of n.children) collect(c);
    })(child);
    if (meshIds.length < 2) continue;
    // mesh index → partId is identity (state.parts[i].partId === i, by construction)
    const partIds = meshIds.filter(mi => {
      const p = getPart(mi);
      return p && !p.deleted && p.mesh; // skip instanced (no standalone mesh)
    });
    if (partIds.length < 2) continue;
    const ug = addUserGroup(child.name || `Assembly ${made + 1}`, partIds, { skipUndo: true, expanded: false });
    if (ug) made++;
  }
  return made;
}

// =================================================================
// Reveal-on-pick — scroll the left tree to the part picked in viewport
// =================================================================
function _scrollTreeToPart(partId) {
  if (partId == null || Number.isNaN(partId)) return;
  const treeEl = document.getElementById('tree');
  if (!treeEl) return;
  let node = treeEl.querySelector(`.tree-node[data-part-id="${partId}"]`);
  if (!node) {
    // Part is in a collapsed user-group — open it and re-render
    const g = (state.userGroups || []).find(gr => gr.partIds.has(partId));
    if (g && !g.expanded) {
      g.expanded = true;
      rebuildTree();
      node = treeEl.querySelector(`.tree-node[data-part-id="${partId}"]`);
    }
  }
  if (!node) return; // filtered out by search, or not in DOM (>5000 cap)
  const treeRect = treeEl.getBoundingClientRect();
  const nodeRect = node.getBoundingClientRect();
  const fullyVisible = nodeRect.top >= treeRect.top && nodeRect.bottom <= treeRect.bottom;
  if (fullyVisible) return;
  // 'instant' explicitly disables any CSS scroll-behavior:smooth above us
  node.scrollIntoView({ block: 'nearest', behavior: 'instant' });
}

const _origSelectPart_reveal = selectPart;
selectPart = function(partId, mode) {
  _origSelectPart_reveal(partId, mode);
  _scrollTreeToPart(partId);
};

// Press S while hovering the left sidebar → jump-scroll to first selected part
let _mouseOverLeftSidebar = false;
function _wireSidebarHoverScroll() {
  const sb = document.getElementById('sidebar-left');
  if (!sb) return;
  sb.addEventListener('mouseenter', () => { _mouseOverLeftSidebar = true; });
  sb.addEventListener('mouseleave', () => { _mouseOverLeftSidebar = false; });
}
window.addEventListener('keydown', e => {
  if (!_mouseOverLeftSidebar) return;
  const tag = (e.target?.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
  if (e.key !== 's' && e.key !== 'S') return;
  if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return; // leave the global Shift+S alone
  e.preventDefault();
  if (state.selected.size === 0) return;
  const firstId = state.selected.values().next().value;
  _scrollTreeToPart(firstId);
});
const _origWireUI_revealHover = wireUI;
wireUI = function() { _origWireUI_revealHover(); _safeRun(_wireSidebarHoverScroll, 'sidebar-hover'); };

const _origOnModelLoaded_groups = onModelLoaded;
onModelLoaded = function(filename) {
  _origOnModelLoaded_groups(filename);
  if (state._pendingStepRoot) {
    try {
      const n = _importStepAssemblyAsGroups(state._pendingStepRoot);
      if (n > 0) {
        rebuildTree();
        Log.success(`Imported ${n} STEP assembly group${n === 1 ? '' : 's'}`, { tag: 'step' });
        toast('STEP hierarchy', `${n} assembly group${n === 1 ? '' : 's'} from STEP`, 'success', 4000);
      } else {
        Log.info('STEP file has no assembly hierarchy (or all leaves)', { tag: 'step' });
      }
    } catch (e) {
      Log.error(`STEP hierarchy import failed: ${e.message || e}`, { tag: 'step' });
    }
    state._pendingStepRoot = null;
  }
};

// Final wrapper: every rebuildTree pass injects <i data-lucide="…"> placeholders
// (eye, eye-off, folder, pencil, x). Render them once the tree DOM is in place.
// Done here so it covers all the earlier reassignments of rebuildTree above.
//
// Preserves visual scroll position across the rebuild. Naive scrollTop
// save/restore drifted ("jumps a little randomly") because:
//   1. `root.innerHTML = ''` resets scroll to 0 mid-rebuild.
//   2. `content-visibility:auto` skeletons (contain-intrinsic-size 28px) and
//      real rendered rows (~30px) pack differently, so a saved absolute
//      scrollTop number lands at a slightly different visual offset.
// Fix: anchor on the FIRST VISIBLE ROW (by data-part-id / data-group-id).
// After the rebuild, find the same row in the new DOM and adjust scrollTop
// so that row sits at the same offset from the top. Robust against height
// drift from content-visibility, lucide SVG materialization, and per-row
// class/badge changes that swap heights by a pixel or two.
const _finalRebuildTree = rebuildTree;
rebuildTree = function() {
  // Bulletproof scroll preservation. The previous version anchored on the
  // first visible row and delta-corrected after rebuild. Two failure modes:
  //   (1) #tree rows use content-visibility:auto with a 28px estimate.
  //       Sub-pixel drift between estimated and actual heights compounded
  //       on every click — "scroll creeps down on every click on the same
  //       group".
  //   (2) Sync + rAF dual-restore could disagree by a frame because rows
  //       materialize between paints, producing a visible one-frame nudge
  //       after DnD drop.
  //
  // Selection-only updates now route through rebuildTreeSelectionOnly()
  // instead of this wrapper, so we no longer need the anchor logic to
  // defend against repeated rebuilds — only true content-changing rebuilds
  // (DnD commit, group create/destroy, op replays) reach this path. For
  // those, the user expects "stay where I was looking", which is exactly
  // raw scrollTop preservation.
  const treeEl = document.getElementById('tree');
  const prevScroll     = treeEl ? treeEl.scrollTop  : 0;
  const prevScrollLeft = treeEl ? treeEl.scrollLeft : 0;

  _finalRebuildTree.apply(this, arguments);
  _lucide();
  _dndDecorateTree();

  if (!treeEl) return;
  // Browser auto-clamps scrollTop if new content is shorter than old. Set
  // after lucide runs so scrollHeight reflects materialized SVG sizes.
  const maxScroll = Math.max(0, treeEl.scrollHeight - treeEl.clientHeight);
  treeEl.scrollTop  = Math.max(0, Math.min(prevScroll, maxScroll));
  treeEl.scrollLeft = prevScrollLeft;
};

// =========================================================================
// SIDEBAR DRAG-AND-DROP REORDER
// =========================================================================
// Multi-select drag-and-drop reorder for the parts tree. Three rendering
// modes live in this file and DnD has to handle all of them:
//
//   'hier' — state.treeNodes (DFS-flattened array from GLB scene graph).
//            Mutation = splice the dragged subtrees out of the array, fix
//            their depth/parentId, splice them in at the target. Scene-graph
//            reparent via THREE.Object3D.attach() preserves world transforms.
//
//   'ug'   — state.userGroups (set-based bucket overlay on flat parts).
//            Mutation = move partIds between group.partIds Sets, reparent
//            meshes via group.ref.attach(), reorder using state._manualOrder.
//
//   'flat' — neither of the above. Reorder state.parts via _manualOrder and
//            sortMode='manual'.
//
// Drag UX: pointer events (not HTML5 DnD — cleaner control over the ghost,
// auto-scroll, modifier keys, and Esc-to-cancel). 5px threshold before drag
// engages so a normal click still selects. While dragging:
//   • Insertion line above/below row for "before/after"
//   • Row outline highlight for "into a group" (mid-row hover, group only)
//   • Auto-scroll near top/bottom of #tree
//   • Auto-expand collapsed group on hover (~600ms)
//   • Esc cancels mid-drag
//   • A "+ New group from selection" zone above #tree, visible only during
//     drag. Drop here wraps the dragged items in a new userGroup.
//
// Forbidden moves: dropping into yourself or your own descendant (silently
// ignored). Instanced parts (p.mesh === null) skip the scene-graph reparent
// step but still update tree-array data — viewport rendering is unchanged.

(function _injectDndStyle() {
  if (document.getElementById('_dnd-style')) return;
  const s = document.createElement('style');
  s.id = '_dnd-style';
  s.textContent = `
    .tree-node.dnd-dragging{opacity:.45}
    body.dnd-active, body.dnd-active .tree-node{cursor:grabbing!important}
    /* C4D-style icon column for visibility + color swatch. STICKY to the
       right edge of the scrollport (#tree has overflow-x:auto and rows are
       width:max-content) so the eye/color stay visible when long part
       names push the row content past the sidebar's right edge — and stay
       at a consistent x when the sidebar gets narrowed via the resize
       handle. The solid bg + left-edge gradient fade hides the label text
       sliding underneath.

       Items INSIDE the column are left-aligned (flex-start) so the eye
       icon sits at the same x whether the row is a group (eye only) or a
       part (eye + color swatch). z-index:2 keeps us above the row divider
       (.tree-node::after, z-index:1) so we don't get a vertical line
       cutting through the icons. */
    /* Width math: 14px left fade + 18px eye + 6px gap + 10px color swatch
       + 6px right pad = 54px. flex-shrink:0 so it never compresses; if you
       widen the eye/color icons, bump this. */
    .tree-iconcol{position:sticky;right:0;z-index:2;display:inline-flex;align-items:center;justify-content:flex-start;gap:6px;width:54px;flex-shrink:0;margin-left:auto;padding:0 6px 0 14px;align-self:stretch;background:linear-gradient(90deg,rgba(15,19,25,0) 0,var(--bg1) 12px,var(--bg1) 100%)}
    /* Vertical divider line: sits AT the iconcol's left edge so it inherits
       the sticky-right anchoring. The previous .tree-node::after was
       absolute-positioned on the row, which made the line scroll
       horizontally with long names instead of staying glued to the
       scrollport's right edge. */
    .tree-iconcol::before{content:'';position:absolute;left:0;top:-1px;bottom:-1px;width:1px;background:rgba(255,255,255,.07);pointer-events:none}
    .tree-iconcol .tree-vis{margin:0}
    .tree-iconcol .tree-color{margin:0}
    /* Selected/hover row backgrounds need to extend through the sticky icon
       column too — otherwise the gradient + bg1 column shows over the
       selection tint and looks like a missing chunk on the right side. */
    .tree-node.selected .tree-iconcol{background:linear-gradient(90deg,rgba(28,42,68,0) 0,rgba(28,42,68,1) 12px,rgba(28,42,68,1) 100%)}
    .tree-node:hover .tree-iconcol{background:linear-gradient(90deg,rgba(20,25,33,0) 0,#141921 12px,#141921 100%)}
    .tree-node.selected:hover .tree-iconcol{background:linear-gradient(90deg,rgba(36,52,80,0) 0,rgba(36,52,80,1) 12px,rgba(36,52,80,1) 100%)}
    /* Row-level divider that extends 1px above and below to overlap adjacent
       rows. Right offset matches the iconcol width (38px) + its left
       padding (14px) - 1px so the divider sits at the column's left edge
       (where the gradient starts to fade in) instead of cutting across
       the icons. */
    .tree-node{padding-right:0;position:relative}
    /* (Old .tree-node::after divider removed — it scrolled with the row.
       The divider is now .tree-iconcol::before, which inherits the column's
       sticky positioning and stays at the scrollport's right edge.) */
    /* Hide on the synthetic "+ N more" / display-cap rows that have no iconcol */
    .tree-node.tree-empty::after,#tree > div:not(.tree-node)::after{display:none}
    /* Finder-style inline rename input — sits inside .tree-label, inherits
       the row's font/colour, no chrome that would compete with the row. */
    .tree-label-input{width:100%;background:rgba(255,255,255,.08);border:1px solid var(--ac);border-radius:3px;color:var(--tx);font:inherit;font-size:inherit;padding:1px 4px;margin:-2px 0;outline:none;box-shadow:0 0 0 2px rgba(110,168,255,.18)}
    .tree-node.dnd-drop-into{outline:2px solid var(--ac);outline-offset:-2px;background:rgba(110,168,255,.14)!important;border-radius:3px}
    .tree-drop-line{position:absolute;left:0;right:0;height:0;border-top:2px solid var(--ac);box-shadow:0 0 6px rgba(110,168,255,.6);pointer-events:none;z-index:50}
    .tree-drop-line::before{content:'';position:absolute;left:2px;top:-4px;width:6px;height:6px;border-radius:50%;background:var(--ac);box-shadow:0 0 6px var(--ac)}
    #tree-newgroup-zone{display:none!important}
    #_dnd-ghost{position:fixed;pointer-events:none;z-index:9999;background:rgba(20,28,40,.95);border:1px solid var(--ac);border-radius:6px;padding:6px 10px;font-size:12px;color:var(--tx);box-shadow:0 4px 18px rgba(0,0,0,.5);transform:translate(8px,8px);max-width:240px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #_dnd-ghost .badge{display:inline-block;margin-right:6px;padding:1px 6px;background:var(--ac);color:#0a0d12;border-radius:10px;font-weight:700;font-variant-numeric:tabular-nums}
  `;
  document.head.appendChild(s);
})();

function _dndDecorateTree() {
  const tree = document.getElementById('tree');
  if (!tree) return;
  if (getComputedStyle(tree).position === 'static') tree.style.position = 'relative';
  if (!document.getElementById('tree-newgroup-zone')) {
    const z = document.createElement('div');
    z.id = 'tree-newgroup-zone';
    z.dataset.dropTarget = 'newgroup';
    z.innerHTML = '<i data-lucide="folder-plus" style="vertical-align:-2px;width:13px;height:13px"></i> &nbsp;Drop here to create a new group';
    tree.parentNode.insertBefore(z, tree);
    if (typeof _lucide === 'function') _lucide();
  }
  if (!tree.dataset.dndWired) {
    tree.dataset.dndWired = '1';
    tree.addEventListener('pointerdown', _dndPointerDown, true);
  }
}

let _dndDrag = null;
let _dndExpandTimer = 0;
let _dndExpandTarget = null;
let _dndAutoScrollRAF = 0;
let _dndAutoScrollDir = 0;
let _dndIndicator = null;
let _dndGhost = null;
let _dndCommitInFlight = false;

function _dndPointerDown(e) {
  if (e.button !== 0) return;
  if (e.target.closest('[data-toggle], .tree-vis, .tree-chev, .tree-expand, [data-act], button, input, select')) return;
  const row = e.target.closest('.tree-node');
  if (!row) return;
  if (row.classList.contains('is-hidden')) return;
  _dndDrag = {
    armed: true, active: false,
    startX: e.clientX, startY: e.clientY,
    originRow: row,
    pointerId: e.pointerId,
  };
  window.addEventListener('pointermove', _dndPointerMove, true);
  window.addEventListener('pointerup', _dndPointerUp, true);
  window.addEventListener('pointercancel', _dndPointerUp, true);
  window.addEventListener('keydown', _dndKeyDown, true);
}

// rAF-coalesce drag updates: pointermove stores the latest event, the frame
// runs the (relatively expensive) hit test + indicator update once per paint.
// Without this, _dndUpdate runs on every pointer event — cheap on small trees,
// painful on 5000+ rows where the previous querySelectorAll-then-iterate scan
// alone took several ms per move.
let _dndLatestEvt = null, _dndUpdateRaf = 0;
function _dndFlushUpdate() {
  _dndUpdateRaf = 0;
  if (_dndLatestEvt && _dndDrag && _dndDrag.active) _dndUpdate(_dndLatestEvt);
}
function _dndPointerMove(e) {
  if (!_dndDrag) return;
  if (_dndDrag.armed) {
    const dx = e.clientX - _dndDrag.startX, dy = e.clientY - _dndDrag.startY;
    if (Math.hypot(dx, dy) < 5) return;
    _dndDrag.armed = false; _dndDrag.active = true;
    _dndBegin(_dndDrag.originRow);
  }
  if (_dndDrag.active) {
    e.preventDefault();
    _dndLatestEvt = e;
    if (!_dndUpdateRaf) _dndUpdateRaf = requestAnimationFrame(_dndFlushUpdate);
  }
}

function _dndPointerUp(e) {
  const wasActive = _dndDrag && _dndDrag.active && !_dndDrag.cancelled && e.type === 'pointerup';
  window.removeEventListener('pointermove', _dndPointerMove, true);
  window.removeEventListener('pointerup', _dndPointerUp, true);
  window.removeEventListener('pointercancel', _dndPointerUp, true);
  window.removeEventListener('keydown', _dndKeyDown, true);
  if (wasActive) {
    _dndCommit(e);
    // Suppress the trailing click — without this the tree's native click
    // handler would re-select the row that the user was dropping on,
    // clobbering the selection that just survived the drag.
    const blocker = (ev) => { ev.stopPropagation(); ev.preventDefault(); window.removeEventListener('click', blocker, true); };
    window.addEventListener('click', blocker, true);
    setTimeout(() => window.removeEventListener('click', blocker, true), 0);
  }
  _dndCleanup();
}

function _dndKeyDown(e) {
  if (e.key === 'Escape' && _dndDrag) {
    _dndDrag.cancelled = true;
    _dndCleanup();
    window.removeEventListener('pointermove', _dndPointerMove, true);
    window.removeEventListener('pointerup', _dndPointerUp, true);
    window.removeEventListener('pointercancel', _dndPointerUp, true);
    window.removeEventListener('keydown', _dndKeyDown, true);
  }
}

function _dndBegin(originRow) {
  const ctx = _dndContext();
  _dndDrag.ctx = ctx;
  const originSelected = _dndIsRowSelected(originRow);
  let rows;
  if (originSelected) rows = [..._dndAllSelectedVisibleRows(originRow)];
  else rows = [originRow];
  _dndDrag.rows = rows;
  _dndDrag.dragKeySet = new Set(rows.map(_dndRowKey).filter(Boolean));

  // Precompute the set of forbidden drop-target keys ONCE here. The previous
  // per-frame _dndIsForbiddenTarget did O(N) array.findIndex scans on
  // state.treeNodes for every dragged group row — multi-millisecond hitches
  // on big trees, fired every rAF. state.treeNodes / userGroups don't change
  // during a drag, so we resolve everything upfront and the per-frame check
  // is one Set.has() lookup.
  _dndDrag.forbiddenKeys = _dndComputeForbiddenKeys(rows);

  for (const r of rows) r.classList.add('dnd-dragging');
  document.body.classList.add('dnd-active');

  const z = document.getElementById('tree-newgroup-zone');
  if (z) z.classList.add('show');

  if (!_dndGhost) {
    _dndGhost = document.createElement('div');
    _dndGhost.id = '_dnd-ghost';
    document.body.appendChild(_dndGhost);
  }
  const n = rows.length;
  const firstLabel = (rows[0].querySelector('.tree-label')?.textContent || '').trim().slice(0, 60) || 'item';
  _dndGhost.innerHTML = `<span class="badge">${n}</span>${firstLabel}${n > 1 ? ' …' : ''}`;
  _dndGhost.style.display = 'block';

  if (!_dndIndicator) {
    _dndIndicator = document.createElement('div');
    _dndIndicator.className = 'tree-drop-line';
    _dndIndicator.style.display = 'none';
  }
  const tree = document.getElementById('tree');
  if (_dndIndicator.parentNode !== tree) tree.appendChild(_dndIndicator);
}

function _dndCleanup() {
  if (_dndAutoScrollRAF) { cancelAnimationFrame(_dndAutoScrollRAF); _dndAutoScrollRAF = 0; }
  if (_dndUpdateRaf) { cancelAnimationFrame(_dndUpdateRaf); _dndUpdateRaf = 0; }
  _dndLatestEvt = null;
  _dndLastSig = null;
  _dndAutoScrollDir = 0;
  if (_dndExpandTimer) { clearTimeout(_dndExpandTimer); _dndExpandTimer = 0; }
  _dndExpandTarget = null;
  if (_dndDrag && _dndDrag.rows) for (const r of _dndDrag.rows) r.classList.remove('dnd-dragging');
  document.body.classList.remove('dnd-active');
  if (_dndIntoRow) { _dndIntoRow.classList.remove('dnd-drop-into'); _dndIntoRow = null; }
  if (_dndIndicator) _dndIndicator.style.display = 'none';
  if (_dndGhost) _dndGhost.style.display = 'none';
  const z = document.getElementById('tree-newgroup-zone');
  if (z) z.classList.remove('show', 'hot');
  _dndDrag = null;
}

// Track the currently-highlighted "drop into" row so we don't have to scan
// the whole tree (querySelectorAll('.tree-node.dnd-drop-into')) every frame.
let _dndIntoRow = null;
function _dndClearInto() {
  if (_dndIntoRow) { _dndIntoRow.classList.remove('dnd-drop-into'); _dndIntoRow = null; }
}
function _dndUpdate(e) {
  if (_dndGhost) {
    _dndGhost.style.left = e.clientX + 'px';
    _dndGhost.style.top  = e.clientY + 'px';
  }
  const tree = document.getElementById('tree');
  if (!tree) return;
  const treeRect = tree.getBoundingClientRect();

  const SCROLL_BAND = 28;
  let dir = 0;
  if (e.clientY < treeRect.top + SCROLL_BAND)        dir = -1;
  else if (e.clientY > treeRect.bottom - SCROLL_BAND) dir = +1;
  if (dir !== _dndAutoScrollDir) {
    _dndAutoScrollDir = dir;
    if (dir !== 0 && !_dndAutoScrollRAF) {
      const tick = () => {
        if (_dndAutoScrollDir === 0) { _dndAutoScrollRAF = 0; return; }
        tree.scrollTop += _dndAutoScrollDir * 8;
        _dndAutoScrollRAF = requestAnimationFrame(tick);
      };
      _dndAutoScrollRAF = requestAnimationFrame(tick);
    }
  }

  const ngz = document.getElementById('tree-newgroup-zone');
  if (ngz) {
    const r = ngz.getBoundingClientRect();
    if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
      ngz.classList.add('hot');
      _dndDrag.target = { kind: 'newgroup' };
      _dndIndicator.style.display = 'none';
      _dndClearInto();
      return;
    } else {
      ngz.classList.remove('hot');
    }
  }

  // O(1) hit test via elementFromPoint — was an O(N) loop over every visible
  // tree row calling getBoundingClientRect on each, which on 5000+ rows added
  // multi-millisecond hitches per pointer event.
  const y = e.clientY;
  let row = null;
  const hit = document.elementFromPoint(e.clientX, e.clientY);
  if (hit) {
    const candidate = hit.closest && hit.closest('.tree-node');
    if (candidate && tree.contains(candidate) && !candidate.classList.contains('is-hidden')) {
      row = candidate;
    }
  }

  if (!row) {
    _dndDrag.target = { kind: 'root-end' };
    if (_dndIndicator.style.display !== 'none') _dndIndicator.style.display = 'none';
    _dndClearInto();
    _dndLastSig = null;
    return;
  }

  if (_dndIsForbiddenTarget(row)) {
    _dndDrag.target = null;
    if (_dndIndicator.style.display !== 'none') _dndIndicator.style.display = 'none';
    _dndClearInto();
    _dndLastSig = null;
    return;
  }

  const rb = row.getBoundingClientRect();
  const rel = (y - rb.top) / rb.height;
  const isGroup = row.classList.contains('is-group');
  let intent;
  if (isGroup) {
    if (rel < 0.30) intent = 'before';
    else if (rel > 0.70) intent = 'after';
    else intent = 'into';
  } else {
    intent = (rel < 0.5) ? 'before' : 'after';
  }
  _dndDrag.target = { kind: 'row', row, intent };

  if (intent === 'into' && row.classList.contains('collapsed')) {
    const gid = row.dataset.groupId;
    if (gid !== _dndExpandTarget) {
      _dndExpandTarget = gid;
      if (_dndExpandTimer) clearTimeout(_dndExpandTimer);
      _dndExpandTimer = setTimeout(() => {
        if (state.treeNodes && state.treeNodes.length) {
          const id = parseInt(gid, 10);
          if (state.treeCollapsed.has(id)) {
            if (typeof _toggleGroupCollapseFast === 'function') _toggleGroupCollapseFast(id);
            else { state.treeCollapsed.delete(id); rebuildTree(); }
          }
        }
        const ug = (state.userGroups || []).find(g => String(g.id) === String(gid));
        if (ug && !ug.expanded) { ug.expanded = true; rebuildTree(); }
      }, 600);
    }
  } else {
    if (_dndExpandTimer) { clearTimeout(_dndExpandTimer); _dndExpandTimer = 0; }
    _dndExpandTarget = null;
  }

  // Skip redundant DOM writes if the target signature hasn't changed since the
  // last frame. Otherwise box-shadow/background repaints fire on every move
  // even when the user is just micro-moving inside one row, and the indicator
  // restyle invalidates layout — both add up to lag over deep tree DOMs.
  const sig = (intent === 'into') ? ('I:' + row.dataset.partId + ':' + row.dataset.groupId)
                                  : (intent + ':' + row.dataset.partId + ':' + row.dataset.groupId);
  if (sig !== _dndLastSig || intent !== 'into') {
    _dndLastSig = sig;
    if (intent === 'into') {
      if (_dndIntoRow !== row) {
        _dndClearInto();
        row.classList.add('dnd-drop-into');
        _dndIntoRow = row;
      }
      if (_dndIndicator.style.display !== 'none') _dndIndicator.style.display = 'none';
    } else {
      _dndClearInto();
      const yLine = (intent === 'before' ? rb.top : rb.bottom) - treeRect.top + tree.scrollTop;
      const yLineStr = yLine + 'px';
      if (_dndIndicator.style.top !== yLineStr) _dndIndicator.style.top = yLineStr;
      if (_dndIndicator.style.display !== 'block') _dndIndicator.style.display = 'block';
    }
  }
}
let _dndLastSig = null;

// Precomputes the set of row keys that should be rejected as drop targets for
// the given dragged rows. Walks state.treeNodes / userGroups exactly ONCE
// (rather than per-frame). Returns a Set<string> using the same '<p|g>:id'
// keying as _dndRowKey so the per-frame check is a Set.has() probe.
function _dndComputeForbiddenKeys(rows) {
  const out = new Set();
  // The dragged rows themselves are forbidden targets.
  for (const r of rows) { const k = _dndRowKey(r); if (k) out.add(k); }
  // For each dragged GROUP, every descendant is forbidden too — can't drop
  // a group inside one of its own descendants without making a cycle.
  const draggedGroupIds = [];
  for (const r of rows) {
    if (r.classList.contains('is-group') && r.dataset.groupId) {
      const gid = parseInt(r.dataset.groupId, 10);
      if (!Number.isNaN(gid)) draggedGroupIds.push(gid);
    }
  }
  if (draggedGroupIds.length) {
    if (state.treeNodes && state.treeNodes.length) {
      const all = state.treeNodes;
      // Build a temp groupId→index map in one pass instead of N findIndex calls.
      const groupIdx = new Map();
      for (let i = 0; i < all.length; i++) {
        if (all[i].kind === 'group') groupIdx.set(all[i].id, i);
      }
      for (const gid of draggedGroupIds) {
        const start = groupIdx.get(gid);
        if (start == null) continue;
        const baseDepth = all[start].depth;
        for (let i = start + 1; i < all.length; i++) {
          const n = all[i];
          if (n.depth <= baseDepth) break;
          out.add(n.kind === 'part' ? ('p:' + n.partId) : ('g:' + n.id));
        }
      }
    }
    if (state.userGroups && state.userGroups.length) {
      for (const gid of draggedGroupIds) {
        const ug = state.userGroups.find(g => String(g.id) === String(gid));
        if (!ug) continue;
        for (const pid of ug.partIds) out.add('p:' + pid);
      }
    }
  }
  return out;
}

function _dndIsForbiddenTarget(row) {
  if (!_dndDrag || !_dndDrag.forbiddenKeys) return false;
  const k = _dndRowKey(row);
  return k != null && _dndDrag.forbiddenKeys.has(k);
}

function _dndRowKey(row) {
  if (!row || !row.dataset) return null;
  if (row.dataset.partId)  return 'p:' + row.dataset.partId;
  if (row.dataset.groupId) return 'g:' + row.dataset.groupId;
  return null;
}
function _dndIsRowSelected(row) {
  if (row.dataset.partId) {
    const id = parseInt(row.dataset.partId, 10);
    return state.selected.has(id);
  }
  if (row.dataset.groupId) {
    const gid = row.dataset.groupId;
    const numId = parseInt(gid, 10);
    if (!Number.isNaN(numId) && state.selectedGroupIds && state.selectedGroupIds.has(numId)) return true;
    const ug = (state.userGroups || []).find(g => String(g.id) === String(gid));
    if (ug && ug.partIds.size > 0) {
      for (const pid of ug.partIds) if (!state.selected.has(pid)) return false;
      return true;
    }
  }
  return false;
}
function* _dndAllSelectedVisibleRows(originRow) {
  const tree = document.getElementById('tree');
  if (!tree) return;
  const rows = tree.querySelectorAll('.tree-node:not(.is-hidden)');
  let yieldedOrigin = false;
  for (const r of rows) {
    if (r === originRow) { yield r; yieldedOrigin = true; continue; }
    if (_dndIsRowSelected(r)) yield r;
  }
  if (!yieldedOrigin) yield originRow;
}

function _hierNodeIndex(row) {
  const all = state.treeNodes || [];
  if (row.dataset.partId) {
    const id = parseInt(row.dataset.partId, 10);
    return all.findIndex(n => n.kind === 'part' && n.partId === id);
  }
  if (row.dataset.groupId) {
    const id = parseInt(row.dataset.groupId, 10);
    return all.findIndex(n => n.kind === 'group' && n.id === id);
  }
  return -1;
}
function _hierSubtreeRange(groupId) {
  const all = state.treeNodes || [];
  const start = all.findIndex(n => n.kind === 'group' && n.id === groupId);
  if (start < 0) return null;
  const baseDepth = all[start].depth;
  let end = all.length;
  for (let i = start + 1; i < all.length; i++) {
    if (all[i].depth <= baseDepth) { end = i; break; }
  }
  return { start, end };
}

function _dndContext() {
  if (state.treeNodes && state.treeNodes.length) return 'hier';
  if (state.userGroups && state.userGroups.length) return 'ug';
  return 'flat';
}

function _dndCommit(e) {
  if (_dndCommitInFlight) return;
  _dndCommitInFlight = true;
  try {
    if (!_dndDrag || !_dndDrag.target) return;
    const t = _dndDrag.target;
    const ctx = _dndDrag.ctx;
    const rows = _dndDrag.rows;

    if (t.kind === 'newgroup') {
      _dndDoNewGroupFromRows(rows, ctx);
      return;
    }
    if (ctx === 'hier') _dndCommitHier(rows, t);
    else if (ctx === 'ug') _dndCommitUg(rows, t);
    else _dndCommitFlat(rows, t);
  } catch (err) {
    console.error('[dnd] commit failed:', err);
    if (typeof toast === 'function') toast('Reorder failed', err.message || String(err), 'error');
  } finally {
    _dndCommitInFlight = false;
  }
}

function _dndDoNewGroupFromRows(rows, ctx, explicitName) {
  // Hierarchical mode: create a new group NODE inside state.treeNodes (with a
  // backing THREE.Group on partsRoot) and move the dragged subtrees under it.
  // Going through addUserGroup() here would push state.userGroups.length > 0,
  // which makes the userGroups rebuildTree wrapper take precedence and render
  // a flat list — destroying the hierarchical view.
  if (ctx === 'hier') {
    if (rows.length === 0) return;
    const defaultName = explicitName || ('Group ' + ((state._userGroupCount || 0) + 1));
    state._userGroupCount = (state._userGroupCount || 0) + 1;

    // Anchor = the topmost-in-array dragged row. The new group is created at
    // that row's parent + position so it appears NEXT TO the user's selection
    // rather than getting dumped at the bottom of the tree.
    let anchorIdx = -1;
    for (const r of rows) {
      const idx = _hierNodeIndex(r);
      if (idx < 0) continue;
      if (anchorIdx === -1 || idx < anchorIdx) anchorIdx = idx;
    }
    if (anchorIdx < 0) return;
    const anchor = state.treeNodes[anchorIdx];
    const anchorParentId = anchor.parentId;
    const anchorDepth = anchor.depth;

    // Pick a fresh negative id below every existing group id.
    let minId = 0;
    for (const n of state.treeNodes) if (n.kind === 'group' && n.id < minId) minId = n.id;
    const newId = minId - 1;

    // Backing scene-graph group on the anchor's parent obj3d so the new
    // group sits next to the anchor in the THREE.js graph too.
    const grp = new THREE.Group();
    grp.name = defaultName;
    grp.userData.isUserGroup = true;
    let host = state.partsRoot;
    if (anchorParentId != null) {
      const pn = state.treeNodes.find(n => n.kind === 'group' && n.id === anchorParentId);
      if (pn && pn.obj3d) host = pn.obj3d;
    }
    host.add(grp);

    // Splice the new group node in at the anchor's position. _dndMoveHier
    // uses id-based lookups (not cached indices) so the splice doesn't
    // confuse the subsequent move.
    state.treeNodes.splice(anchorIdx, 0, {
      id: newId, kind: 'group', name: defaultName,
      depth: anchorDepth, parentId: anchorParentId, obj3d: grp,
    });

    _dndMoveHier(rows, newId, null);
    // New group is visible in the tree — no toast.
    if (typeof Log !== 'undefined') Log.success(`Created group "${defaultName}" with ${rows.length} item${rows.length === 1 ? '' : 's'}`, { tag: 'tree' });
    return;
  }

  // userGroups / flat modes: defer to the existing addUserGroup pathway,
  // which already plays well with the userGroups rebuildTree wrapper.
  const partIds = new Set();
  if (ctx === 'ug') {
    for (const r of rows) {
      if (r.dataset.partId) partIds.add(parseInt(r.dataset.partId, 10));
      else if (r.dataset.groupId) {
        const ug = state.userGroups.find(g => String(g.id) === String(r.dataset.groupId));
        if (ug) for (const pid of ug.partIds) partIds.add(pid);
      }
    }
  } else {
    for (const r of rows) if (r.dataset.partId) partIds.add(parseInt(r.dataset.partId, 10));
  }
  const movable = [...partIds].filter(id => {
    const p = getPart(id);
    return p && !p.deleted && p.mesh;
  });
  const skipped = partIds.size - movable.length;
  if (movable.length === 0) {
    toast('Nothing to group', skipped ? `${skipped} parts can't be reparented (instanced)` : '', 'warn');
    return;
  }
  const defaultName = explicitName || ('Group ' + ((state._userGroupCount || 0) + 1));
  const ug = (typeof addUserGroup === 'function') ? addUserGroup(defaultName, movable) : null;
  if (!ug) { toast('Group failed', '', 'error'); return; }
  toast('Grouped', `${movable.length} parts under "${ug.name}"${skipped ? ` (${skipped} instanced skipped)` : ''}`, 'success');
  if (typeof Log !== 'undefined') Log.success(`Grouped ${movable.length} parts as "${ug.name}"`, { tag: 'group' });
  rebuildTree();
}

function _dndCommitHier(rows, t) {
  const all = state.treeNodes;
  if (!all || !all.length) return;

  let newParentId = null;
  let beforeNodeId = null;
  if (t.kind === 'root-end') {
    newParentId = null; beforeNodeId = null;
  } else {
    const targRow = t.row;
    const targIdx = _hierNodeIndex(targRow);
    if (targIdx < 0) return;
    const targNode = all[targIdx];
    if (t.intent === 'into') {
      newParentId = targNode.id;
      beforeNodeId = null;
    } else if (t.intent === 'before') {
      newParentId = targNode.parentId;
      beforeNodeId = targNode.id;
    } else {
      newParentId = targNode.parentId;
      const range = (targNode.kind === 'group')
        ? _hierSubtreeRange(targNode.id)
        : { start: targIdx, end: targIdx + 1 };
      const after = all[range.end];
      beforeNodeId = (after && after.parentId === targNode.parentId) ? after.id : null;
    }
  }
  _dndMoveHier(rows, newParentId, beforeNodeId);
}

// Core hierarchical move: extract dragged subtrees, fix depth/parentId, splice
// in at (newParentId, beforeNodeId), reparent THREE.Object3D via attach().
// Pulled out of _dndCommitHier so the "create new group from drop" path can
// reuse it after creating a fresh group node.
function _dndMoveHier(rows, newParentId, beforeNodeId) {
  const all = state.treeNodes;
  if (!all || !all.length) return;

  const ranges = [];
  for (const r of rows) {
    const idx = _hierNodeIndex(r);
    if (idx < 0) continue;
    const n = all[idx];
    let range;
    if (n.kind === 'group') range = _hierSubtreeRange(n.id);
    else range = { start: idx, end: idx + 1 };
    if (!range) continue;
    ranges.push({ ...range, rootNode: n });
  }
  ranges.sort((a, b) => a.start - b.start);

  const filtered = [];
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    let nested = false;
    for (let j = 0; j < ranges.length; j++) {
      if (i === j) continue;
      const o = ranges[j];
      if (r.start > o.start && r.end <= o.end) { nested = true; break; }
    }
    if (!nested) filtered.push(r);
  }
  if (filtered.length === 0) return;

  if (newParentId != null) {
    const parentIdx = all.findIndex(n => n.kind === 'group' && n.id === newParentId);
    if (parentIdx < 0) {
      newParentId = null;
    } else {
      for (const r of filtered) {
        if (parentIdx >= r.start && parentIdx < r.end) {
          if (typeof toast === 'function') toast('Invalid drop', 'Cannot drop into self / descendant', 'warn');
          return;
        }
      }
    }
  }

  let newRootDepth;
  if (newParentId == null) newRootDepth = 0;
  else {
    const parentNode = all.find(n => n.kind === 'group' && n.id === newParentId);
    newRootDepth = (parentNode ? parentNode.depth : -1) + 1;
  }

  const extracted = [];
  for (let i = filtered.length - 1; i >= 0; i--) {
    const r = filtered[i];
    const slice = all.splice(r.start, r.end - r.start);
    const delta = newRootDepth - slice[0].depth;
    if (delta !== 0) for (const n of slice) n.depth += delta;
    slice[0].parentId = newParentId;
    extracted.unshift(slice);
  }

  let insertAt;
  if (beforeNodeId == null) {
    if (newParentId == null) insertAt = all.length;
    else {
      const parentIdx = all.findIndex(n => n.kind === 'group' && n.id === newParentId);
      const parentDepth = all[parentIdx].depth;
      insertAt = all.length;
      for (let i = parentIdx + 1; i < all.length; i++) {
        if (all[i].depth <= parentDepth) { insertAt = i; break; }
      }
    }
  } else {
    insertAt = all.findIndex(n => n.id === beforeNodeId);
    if (insertAt < 0) insertAt = all.length;
  }

  let cursor = insertAt;
  for (const slice of extracted) {
    all.splice(cursor, 0, ...slice);
    cursor += slice.length;
  }

  const destObj = _hierResolveDestObj(newParentId);
  if (destObj) {
    for (const slice of extracted) {
      const root = slice[0];
      let obj = root.obj3d;
      if (root.kind === 'part') {
        const p = getPart(root.partId);
        obj = p ? p.mesh : null;
        root.obj3d = obj;
      }
      if (obj && obj.parent !== destObj) {
        try { destObj.attach(obj); } catch (_) {}
      }
    }
    state.partsRoot && state.partsRoot.updateMatrixWorld(true);
  }

  rebuildTree();
  if (typeof requestRender === 'function') requestRender();
  if (typeof Log !== 'undefined') Log.info(`Reordered ${rows.length} item${rows.length === 1 ? '' : 's'}`, { tag: 'tree' });
}

function _hierResolveDestObj(newParentId) {
  if (newParentId == null) return state.partsRoot;
  const node = state.treeNodes.find(n => n.kind === 'group' && n.id === newParentId);
  if (!node) return state.partsRoot;
  if (node.obj3d) return node.obj3d;
  const grp = new THREE.Group();
  grp.name = node.name || 'Group';
  grp.userData.isUserGroup = true;
  let host = state.partsRoot;
  if (node.parentId != null) {
    const pn = state.treeNodes.find(n => n.kind === 'group' && n.id === node.parentId);
    if (pn && pn.obj3d) host = pn.obj3d;
  }
  host.add(grp);
  node.obj3d = grp;
  return grp;
}

function _dndCommitUg(rows, t) {
  let targetUgId = null;
  let beforeKey = null;
  if (t.kind === 'root-end') {
    targetUgId = null; beforeKey = null;
  } else {
    const r = t.row;
    if (t.intent === 'into') {
      if (!r.classList.contains('is-group') || !r.dataset.groupId) {
        t.intent = 'after';
      } else {
        targetUgId = r.dataset.groupId;
      }
    }
    if (t.intent === 'before' || t.intent === 'after') {
      if (r.dataset.partId) {
        const pid = parseInt(r.dataset.partId, 10);
        const owner = state.userGroups.find(g => g.partIds.has(pid));
        targetUgId = owner ? owner.id : null;
        beforeKey = (t.intent === 'before') ? ('p:' + pid) : _dndUgNextSiblingKey(r);
      } else if (r.dataset.groupId) {
        targetUgId = null;
        beforeKey = (t.intent === 'before') ? ('g:' + r.dataset.groupId) : _dndUgNextSiblingKey(r);
      }
    }
  }

  const items = [];
  for (const r of rows) {
    if (r.dataset.partId) items.push({ kind: 'part', partId: parseInt(r.dataset.partId, 10) });
    else if (r.dataset.groupId) items.push({ kind: 'group', ugId: r.dataset.groupId });
  }
  if (items.length === 0) return;

  if (targetUgId && items.some(it => it.kind === 'group' && it.ugId === targetUgId)) {
    if (typeof toast === 'function') toast('Invalid drop', 'Cannot drop a group into itself', 'warn');
    return;
  }

  for (const it of items) {
    if (it.kind !== 'part') continue;
    const p = getPart(it.partId);
    if (!p) continue;
    for (const g of state.userGroups) g.partIds.delete(it.partId);
    if (targetUgId) {
      const g = state.userGroups.find(gr => String(gr.id) === String(targetUgId));
      if (g) {
        g.partIds.add(it.partId);
        if (p.mesh && g.ref) { try { g.ref.attach(p.mesh); } catch (_) {} }
      }
    } else {
      if (p.mesh && state.partsRoot) { try { state.partsRoot.attach(p.mesh); } catch (_) {} }
    }
  }

  _ensureManualOrder();
  for (const it of items) {
    const key = (it.kind === 'part') ? ('p:' + it.partId) : ('g:' + it.ugId);
    _manualOrderInsert(key, beforeKey);
  }

  state.userGroups = state.userGroups.filter(g => {
    if (g.partIds.size > 0) return true;
    if (g.ref && g.ref.parent) g.ref.parent.remove(g.ref);
    return false;
  });

  state.sortMode = 'manual';
  _ensureManualSortOption();
  rebuildTree();
  if (typeof requestRender === 'function') requestRender();
}

function _dndUgNextSiblingKey(row) {
  let r = row.nextElementSibling;
  while (r && (!r.classList || !r.classList.contains('tree-node') || r.classList.contains('is-hidden'))) r = r.nextElementSibling;
  if (!r) return null;
  if (r.dataset.partId) return 'p:' + r.dataset.partId;
  if (r.dataset.groupId) return 'g:' + r.dataset.groupId;
  return null;
}

function _dndCommitFlat(rows, t) {
  _ensureManualOrder();
  let beforeKey = null;
  if (t.kind === 'row' && t.row.dataset.partId) {
    beforeKey = (t.intent === 'before') ? ('p:' + t.row.dataset.partId) : _dndUgNextSiblingKey(t.row);
  }
  for (const r of rows) {
    if (!r.dataset.partId) continue;
    _manualOrderInsert('p:' + r.dataset.partId, beforeKey);
  }
  state.sortMode = 'manual';
  _ensureManualSortOption();
  rebuildTree();
}

function _ensureManualOrder() {
  if (!state._manualOrder) state._manualOrder = new Map();
  if (state._manualOrder.size === 0) {
    let i = 0;
    for (const p of state.parts) {
      if (p.deleted) continue;
      state._manualOrder.set('p:' + p.partId, i++);
    }
    for (const g of (state.userGroups || [])) {
      state._manualOrder.set('g:' + g.id, i++);
    }
  }
}
function _manualOrderInsert(key, beforeKey) {
  const m = state._manualOrder;
  const entries = [...m.entries()].sort((a, b) => a[1] - b[1]).map(e => e[0]).filter(k => k !== key);
  const insertIdx = (beforeKey == null) ? entries.length : Math.max(0, entries.indexOf(beforeKey));
  entries.splice(insertIdx, 0, key);
  m.clear();
  for (let i = 0; i < entries.length; i++) m.set(entries[i], i);
}
function _ensureManualSortOption() {
  const sortSel = document.getElementById('tree-sort');
  if (!sortSel) return;
  if (![...sortSel.options].some(o => o.value === 'manual')) {
    const opt = document.createElement('option');
    opt.value = 'manual'; opt.textContent = 'Manual order';
    sortSel.appendChild(opt);
  }
  sortSel.value = 'manual';
}

const _origTreeSortFn_dnd = _treeSortFn;
_treeSortFn = function(mode) {
  if (mode === 'manual' && state._manualOrder) {
    return (a, b) => {
      const ka = 'p:' + a.partId, kb = 'p:' + b.partId;
      const ia = state._manualOrder.has(ka) ? state._manualOrder.get(ka) : a.partId + 1e9;
      const ib = state._manualOrder.has(kb) ? state._manualOrder.get(kb) : b.partId + 1e9;
      return ia - ib;
    };
  }
  return _origTreeSortFn_dnd(mode);
};

setTimeout(() => _dndDecorateTree(), 0);

// ─── Custom color picker ──────────────────────────────────────────────────
// Replaces the native <input type="color"> (which on some browsers refuses
// to reopen on the second invocation when called via .click() on a hidden
// input). This is a self-contained HSV picker with:
//   • SV area (saturation × value) with a draggable cursor
//   • Hue slider
//   • Hex input
//   • Preset row of common CAD palette colors
//   • Live preview while interacting; Apply commits, Esc / outside click
//     cancels (reverts to the captured baseline)
//
// Triggered from two places:
//   1. The swatch in the Properties panel — recolors the current selection.
//   2. The swatch in a Materials row — selects all parts of that color and
//      then opens the picker so the recolor applies to every matching part.
//
// We only read color from the source file (STEP carries one diffuse RGB per
// part; GLB is collapsed to the same model). No textures or PBR maps are
// applied — every part renders with metalness 0.15 / roughness 0.55.
// Editing rewrites that single uniform.
(function () {
  // ── Geometry helpers ────────────────────────────────────────────────────
  function _setPartColorImmediate(p, color) {
    if (!p) return false;
    if (!p.mesh && p.instancedMesh && typeof _promoteInstanceToMesh === 'function') {
      _promoteInstanceToMesh(p);
    }
    if (p.mesh) {
      // vertexColors meshes (post-merge) ignore material.color — swap to a
      // fresh shared material keyed by the new color. shareMaterials honored.
      const mat = (typeof getOrCreateMaterial === 'function')
        ? getOrCreateMaterial(color)
        : new THREE.MeshStandardMaterial({ color: color.clone(), metalness: 0.15, roughness: 0.55, side: THREE.DoubleSide });
      p.mesh.material = mat;
      p.originalColor.copy(color);
      return true;
    }
    if (p.instancedMesh) {
      const inst = p.instancedMesh;
      if (!inst.instanceColor) {
        const seed = inst.material?.color || new THREE.Color(0xaaaaaa);
        inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(inst.count * 3), 3);
        for (let i = 0; i < inst.count; i++) inst.instanceColor.setXYZ(i, seed.r, seed.g, seed.b);
      }
      inst.setColorAt(p.instanceIndex, color);
      inst.instanceColor.needsUpdate = true;
      p.originalColor.copy(color);
      return true;
    }
    return false;
  }

  function _applyColorOpDir(op, dir) {
    for (const it of op.items) {
      const p = getPart(it.partId); if (!p) continue;
      const target = new THREE.Color(dir === 'before' ? it.before : it.after);
      _setPartColorImmediate(p, target);
    }
  }

  // Patch undo/redo for type:'color'.
  const _origUndo = undoLast;
  undoLast = function () {
    const top = state.history[state.history.length - 1];
    if (top && top.type === 'color') {
      const op = state.history.pop();
      _applyColorOpDir(op, 'before');
      state.redo.push(op);
      try { buildMaterialsPanel?.(); } catch (_) {}
      try { rebuildTree?.(); } catch (_) {}
      _finalizeUndo();
      return;
    }
    return _origUndo();
  };
  const _origRedo = redoLast;
  redoLast = function () {
    const top = state.redo && state.redo[state.redo.length - 1];
    if (top && top.type === 'color') {
      const op = state.redo.pop();
      _applyColorOpDir(op, 'after');
      state.history.push(op);
      try { buildMaterialsPanel?.(); } catch (_) {}
      try { rebuildTree?.(); } catch (_) {}
      _finalizeUndo();
      return;
    }
    return _origRedo();
  };

  // ── HSV ↔ RGB ────────────────────────────────────────────────────────────
  function hsvToRgb(h, s, v) {
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    let r, g, b;
    switch (i % 6) {
      case 0: r=v; g=t; b=p; break;
      case 1: r=q; g=v; b=p; break;
      case 2: r=p; g=v; b=t; break;
      case 3: r=p; g=q; b=v; break;
      case 4: r=t; g=p; b=v; break;
      default: r=v; g=p; b=q;
    }
    return { r, g, b };
  }
  function rgbToHsv(r, g, b) {
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const v = max;
    const d = max - min;
    const s = max === 0 ? 0 : d / max;
    let h;
    if (d === 0) h = 0;
    else if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else                h = (r - g) / d + 4;
    h /= 6; if (h < 0) h += 1;
    return { h, s, v };
  }
  function hexToRgb(hex) {
    if (typeof hex === 'string') {
      hex = hex.replace('#', '');
      if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
      const n = parseInt(hex, 16);
      return { r: ((n >> 16) & 0xff) / 255, g: ((n >> 8) & 0xff) / 255, b: (n & 0xff) / 255 };
    }
    return { r: ((hex >> 16) & 0xff) / 255, g: ((hex >> 8) & 0xff) / 255, b: (hex & 0xff) / 255 };
  }
  function rgbToHex({r, g, b}) {
    const to2 = v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
    return '#' + to2(r) + to2(g) + to2(b);
  }

  // ── Picker state ────────────────────────────────────────────────────────
  let popEl = null, svEl, svCursor, hueEl, hueCursor, hexInput, presetsEl, applyBtn, cancelBtn;
  let h = 0, s = 1, v = 1;
  let session = null;          // { ids:[], originals: Map<partId, hexnum>, anchor }

  const PRESETS = ['#e6edf3','#8b95a7','#5a6275','#1d2330','#000000','#ff6b6b','#fbbf24','#34c759','#6ea8ff','#a78bfa','#f59e0b','#10b981','#ef4444','#3b82f6'];

  function _buildPopover() {
    if (popEl) return;
    const css = `
      .cp-pop{position:fixed;z-index:400;width:240px;background:linear-gradient(180deg,#1a2030,#141a26);border:1px solid var(--bd2);border-radius:10px;box-shadow:0 14px 36px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.03) inset;padding:12px;opacity:0;transform:translateY(-4px) scale(.97);transform-origin:top right;pointer-events:none;transition:opacity 140ms var(--ease-out),transform 140ms var(--ease-out)}
      .cp-pop.show{opacity:1;transform:translateY(0) scale(1);pointer-events:auto}
      .cp-sv{position:relative;width:100%;height:140px;border-radius:6px;cursor:crosshair;overflow:hidden;background:#f00;touch-action:none;user-select:none}
      .cp-sv::before{content:'';position:absolute;inset:0;background:linear-gradient(to right,#fff,rgba(255,255,255,0))}
      .cp-sv::after{content:'';position:absolute;inset:0;background:linear-gradient(to top,#000,rgba(0,0,0,0))}
      .cp-sv-cursor{position:absolute;width:14px;height:14px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.6),0 1px 3px rgba(0,0,0,.5);transform:translate(-50%,-50%);pointer-events:none;z-index:2}
      .cp-hue{position:relative;width:100%;height:12px;margin-top:10px;border-radius:6px;cursor:pointer;background:linear-gradient(to right,#f00 0%,#ff0 17%,#0f0 33%,#0ff 50%,#00f 67%,#f0f 83%,#f00 100%);touch-action:none;user-select:none}
      .cp-hue-cursor{position:absolute;top:-2px;width:6px;height:16px;border-radius:3px;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.7),0 1px 3px rgba(0,0,0,.5);transform:translateX(-50%);pointer-events:none}
      .cp-row{display:flex;gap:8px;align-items:center;margin-top:10px}
      .cp-hex{flex:1;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:5px;color:var(--tx);font:500 11.5px ui-monospace,Menlo,monospace;padding:5px 7px;outline:none;text-transform:uppercase}
      .cp-hex:focus{border-color:var(--ac);background:rgba(110,168,255,.08)}
      .cp-preview{width:24px;height:24px;border-radius:5px;border:1px solid rgba(255,255,255,.1);box-shadow:0 1px 3px rgba(0,0,0,.4);flex-shrink:0}
      .cp-presets{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-top:10px}
      .cp-preset{width:100%;aspect-ratio:1;border-radius:4px;border:1px solid rgba(255,255,255,.08);cursor:pointer;transition:transform 100ms var(--ease-out),border-color 100ms var(--ease-out)}
      .cp-preset:hover{transform:scale(1.12);border-color:var(--ac)}
      .cp-actions{display:flex;gap:6px;margin-top:12px;justify-content:flex-end}
      .cp-btn{padding:6px 12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.06);border-radius:5px;color:var(--tx2);font-size:11.5px;font-weight:500;cursor:pointer;transition:background 120ms var(--ease-out),color 120ms var(--ease-out),border-color 120ms var(--ease-out)}
      .cp-btn:hover{background:rgba(255,255,255,.1);color:var(--tx)}
      .cp-btn.primary{background:linear-gradient(180deg,var(--ac),#4f8be5);color:#fff;border-color:transparent}
      .cp-btn.primary:hover{filter:brightness(1.08)}
      #prop-body .prop-color,.mat-swatch{cursor:pointer}
      #prop-body .prop-color:hover{transform:scale(1.15);box-shadow:0 2px 6px rgba(0,0,0,.5),0 0 0 2px rgba(110,168,255,.45)}
      .mat-swatch:hover{transform:scale(1.15);box-shadow:0 2px 6px rgba(0,0,0,.5),0 0 0 2px rgba(110,168,255,.45)!important}
    `;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    popEl = document.createElement('div');
    popEl.className = 'cp-pop';
    popEl.innerHTML = `
      <div class="cp-sv"><div class="cp-sv-cursor"></div></div>
      <div class="cp-hue"><div class="cp-hue-cursor"></div></div>
      <div class="cp-row">
        <div class="cp-preview"></div>
        <input type="text" class="cp-hex" maxlength="7" spellcheck="false">
      </div>
      <div class="cp-presets"></div>
      <div class="cp-actions">
        <button class="cp-btn cp-cancel">Cancel</button>
        <button class="cp-btn primary cp-apply">Apply</button>
      </div>`;
    document.body.appendChild(popEl);
    svEl       = popEl.querySelector('.cp-sv');
    svCursor   = popEl.querySelector('.cp-sv-cursor');
    hueEl      = popEl.querySelector('.cp-hue');
    hueCursor  = popEl.querySelector('.cp-hue-cursor');
    hexInput   = popEl.querySelector('.cp-hex');
    presetsEl  = popEl.querySelector('.cp-presets');
    applyBtn   = popEl.querySelector('.cp-apply');
    cancelBtn  = popEl.querySelector('.cp-cancel');

    presetsEl.innerHTML = PRESETS.map(c =>
      `<div class="cp-preset" data-c="${c}" style="background:${c}"></div>`).join('');

    // Drag SV area
    function onSvPointer(e) {
      const r = svEl.getBoundingClientRect();
      const x = Math.max(0, Math.min(r.width,  e.clientX - r.left));
      const y = Math.max(0, Math.min(r.height, e.clientY - r.top));
      s = x / r.width;
      v = 1 - y / r.height;
      _syncFromHsv();
    }
    svEl.addEventListener('pointerdown', e => {
      svEl.setPointerCapture(e.pointerId);
      onSvPointer(e);
      const move = ev => onSvPointer(ev);
      const up = () => { svEl.removeEventListener('pointermove', move); svEl.removeEventListener('pointerup', up); };
      svEl.addEventListener('pointermove', move);
      svEl.addEventListener('pointerup', up);
    });
    function onHuePointer(e) {
      const r = hueEl.getBoundingClientRect();
      const x = Math.max(0, Math.min(r.width, e.clientX - r.left));
      h = x / r.width;
      _syncFromHsv();
    }
    hueEl.addEventListener('pointerdown', e => {
      hueEl.setPointerCapture(e.pointerId);
      onHuePointer(e);
      const move = ev => onHuePointer(ev);
      const up = () => { hueEl.removeEventListener('pointermove', move); hueEl.removeEventListener('pointerup', up); };
      hueEl.addEventListener('pointermove', move);
      hueEl.addEventListener('pointerup', up);
    });
    hexInput.addEventListener('input', () => {
      const val = hexInput.value.trim();
      if (/^#?[0-9a-f]{6}$/i.test(val)) {
        const rgb = hexToRgb(val);
        const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
        h = hsv.h; s = hsv.s; v = hsv.v;
        _syncFromHsv({ skipHexUpdate: true });
      }
    });
    presetsEl.addEventListener('click', e => {
      const sw = e.target.closest('.cp-preset');
      if (!sw) return;
      const rgb = hexToRgb(sw.dataset.c);
      const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
      h = hsv.h; s = hsv.s; v = hsv.v;
      _syncFromHsv();
    });
    applyBtn.addEventListener('click', _commit);
    cancelBtn.addEventListener('click', _cancel);
    // Outside-click cancel — installed when popover opens.
    popEl.addEventListener('click', e => e.stopPropagation());
  }

  function _syncFromHsv(opts = {}) {
    const rgb = hsvToRgb(h, s, v);
    const hex = rgbToHex(rgb);
    // SV background follows the current hue
    const hueRgb = hsvToRgb(h, 1, 1);
    svEl.style.background = `rgb(${(hueRgb.r*255)|0},${(hueRgb.g*255)|0},${(hueRgb.b*255)|0})`;
    // SV cursor position
    svCursor.style.left = (s * 100) + '%';
    svCursor.style.top  = ((1 - v) * 100) + '%';
    // Hue cursor position
    hueCursor.style.left = (h * 100) + '%';
    // Preview swatch + hex input
    const prev = popEl.querySelector('.cp-preview');
    if (prev) prev.style.background = hex;
    if (!opts.skipHexUpdate) hexInput.value = hex.toUpperCase();
    // Live preview to viewport
    if (session) {
      const c = new THREE.Color(hex);
      for (const id of session.ids) {
        const p = getPart(id); if (!p) continue;
        _setPartColorImmediate(p, c);
      }
      requestRender();
    }
  }

  function _position(anchor) {
    const ar = anchor.getBoundingClientRect();
    const pr = popEl.getBoundingClientRect();
    let left = ar.left - pr.width - 8;        // prefer left of anchor
    let top  = ar.top + ar.height / 2 - pr.height / 2;
    if (left < 8) left = ar.right + 8;        // fall back to right
    if (top + pr.height > window.innerHeight - 8) top = window.innerHeight - pr.height - 8;
    if (top < 8) top = 8;
    popEl.style.left = left + 'px';
    popEl.style.top  = top  + 'px';
  }

  function _open(anchor, ids, seedHex) {
    _buildPopover();
    if (!ids.length) return;
    // Capture per-part baselines for revert / undo
    const originals = new Map();
    for (const id of ids) {
      const p = getPart(id); if (!p) continue;
      originals.set(id, p.originalColor.getHex());
    }
    session = { ids: [...ids], originals, anchor };
    // Seed picker state from the chosen color
    const rgb = hexToRgb(seedHex);
    const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    h = hsv.h; s = hsv.s; v = hsv.v;
    popEl.classList.add('show');
    // Position AFTER show so dimensions are real
    requestAnimationFrame(() => _position(anchor));
    _syncFromHsv();
    // Outside-click + Esc handlers (one-shot per session)
    setTimeout(() => {
      document.addEventListener('click',   _onDocClick,   true);
      document.addEventListener('keydown', _onKeyDown,    true);
      window.addEventListener('resize',    _onWindow);
      window.addEventListener('scroll',    _onWindow, true);
    }, 0);
  }

  function _onDocClick(e) {
    if (popEl && popEl.contains(e.target)) return;
    // Clicking another swatch should re-open with new context, not close. The
    // swatch handler runs after this in bubble phase and will call _open
    // which re-seeds session — let it through without canceling.
    if (e.target.closest('#prop-body .prop-color, #materials-body .mat-swatch')) return;
    _cancel();
  }
  function _onKeyDown(e) {
    if (e.key === 'Escape') { e.preventDefault(); _cancel(); }
    else if (e.key === 'Enter') { e.preventDefault(); _commit(); }
  }
  function _onWindow() { if (session) _position(session.anchor); }

  function _cleanup() {
    document.removeEventListener('click',   _onDocClick,   true);
    document.removeEventListener('keydown', _onKeyDown,    true);
    window.removeEventListener('resize',    _onWindow);
    window.removeEventListener('scroll',    _onWindow, true);
    if (popEl) popEl.classList.remove('show');
  }

  function _cancel() {
    if (!session) { _cleanup(); return; }
    // Revert each part to its captured baseline
    for (const id of session.ids) {
      const p = getPart(id); if (!p) continue;
      const beforeHex = session.originals.get(id);
      _setPartColorImmediate(p, new THREE.Color(beforeHex));
    }
    requestRender();
    session = null;
    _cleanup();
  }

  function _commit() {
    if (!session) { _cleanup(); return; }
    const rgb = hsvToRgb(h, s, v);
    const c = new THREE.Color(rgb.r, rgb.g, rgb.b);
    const items = [];
    for (const id of session.ids) {
      const p = getPart(id); if (!p) continue;
      const beforeHex = session.originals.get(id);
      _setPartColorImmediate(p, c);
      const afterHex = p.originalColor.getHex();
      if (beforeHex !== afterHex) items.push({ partId: id, before: beforeHex, after: afterHex });
    }
    session = null;
    _cleanup();
    if (items.length) {
      pushUndo({ type: 'color', items, label: 'Change color' });
      try { buildMaterialsPanel?.(); } catch (_) {}
      try { rebuildTree?.(); } catch (_) {}
      try { refreshPropertiesPanel?.(); } catch (_) {}
      requestRender();
    }
  }

  // ── Triggers ────────────────────────────────────────────────────────────
  // Properties panel swatch → recolor current selection.
  document.addEventListener('click', (e) => {
    const swatch = e.target.closest('#prop-body .prop-color');
    if (!swatch) return;
    if (state.selected.size === 0) return;
    e.stopPropagation();
    const ids = [...state.selected];
    const seed = '#' + (getPart(ids[0])?.originalColor.getHexString() || 'aaaaaa');
    _open(swatch, ids, seed);
  });

  // Materials row swatch → select all parts of that color, then open picker.
  document.addEventListener('click', (e) => {
    const swatch = e.target.closest('#materials-body .mat-swatch');
    if (!swatch) return;
    e.stopPropagation();
    const hex = swatch.dataset.matHex || '#aaaaaa';
    const targetHexNum = new THREE.Color(hex).getHex();
    const ids = [];
    for (const p of state.parts) {
      if (!p.deleted && p.originalColor.getHex() === targetHexNum) ids.push(p.partId);
    }
    if (!ids.length) return;
    // Update selection so the user sees what they're editing.
    state.selected.clear();
    for (const id of ids) state.selected.add(id);
    try { applySelectionColors?.(); } catch (_) {}
    try { rebuildTreeSelectionOnly?.(); } catch (_) {}
    try { refreshPropertiesPanel?.(); } catch (_) {}
    if (typeof updateGizmo === 'function') try { updateGizmo(); } catch (_) {}
    const $del = $('del-sel-count'); if ($del) $del.textContent = ids.length;
    _open(swatch, ids, hex);
  });
})();


// ════════════════════════════════════════════════════════════════════════════
// QoL FEATURES — heatmap view, big offenders panel, per-part decimation
// ════════════════════════════════════════════════════════════════════════════
// Three optimization-workflow features that hook into the existing tree /
// view-mode / part-state machinery without touching the load path:
//
//  1. Big offenders panel (#offenders-list)
//     Top-N parts by triangle count, rebuilt whenever the tree rebuilds.
//     Click = select + frame so users can jump to "the part eating my budget"
//     in one move. Density bar on each row mirrors the heatmap colours.
//
//  2. Heatmap view mode ('heat')
//     Adds a 4th view mode alongside solid/wire/xray. Density metric:
//         tris / bbox-surface-area
//     Bbox surface (not real surface area) is cheap to compute and well-
//     correlated for triage. Colour mapping is percentile-rank based — a
//     handful of pathological parts can't compress the rest into one colour.
//
//  3. Per-part decimation ('Decimate' button)
//     Edge-collapse simplification via three.js SimplifyModifier on the
//     selected parts only. Skips instanced parts (geometry is shared with
//     siblings — collapsing one would warp every instance).
// ════════════════════════════════════════════════════════════════════════════
(function _qolOptimizerFeatures() {
  if (window.__qolOptInit) return;
  window.__qolOptInit = true;

  function _bboxSurface(p) {
    if (!p || !p.bbox || (p.bbox.isEmpty && p.bbox.isEmpty())) return 1e-6;
    const s = p.bbox.getSize(new THREE.Vector3());
    const a = 2 * (s.x * s.y + s.y * s.z + s.z * s.x);
    return a > 1e-6 ? a : 1e-6;
  }
  function _density(p) { return (p.triCount || 0) / _bboxSurface(p); }

  // Percentile-ranked colour for heatmap + offender bars. Caller pre-sorts
  // densities once per recompute so this stays O(log N) per part.
  const _C_LOW  = new THREE.Color(0x10b981);
  const _C_MID  = new THREE.Color(0xfbbf24);
  const _C_HIGH = new THREE.Color(0xef4444);
  function _colorForRank(rank01) {
    const c = new THREE.Color();
    if (rank01 < 0.5) c.copy(_C_LOW).lerp(_C_MID, rank01 * 2);
    else c.copy(_C_MID).lerp(_C_HIGH, (rank01 - 0.5) * 2);
    return c;
  }
  function _rankInSorted(sortedDensities, v) {
    let lo = 0, hi = sortedDensities.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (sortedDensities[mid] < v) lo = mid + 1; else hi = mid;
    }
    return sortedDensities.length > 1 ? lo / (sortedDensities.length - 1) : 0;
  }

  // ── Big offenders panel ──────────────────────────────────────────────────
  const OFF_TOP_N = 12;
  function _refreshOffenders() {
    const list = document.getElementById('offenders-list');
    if (!list) return;
    const live = state.parts.filter(p => p && !p.deleted && p.triCount > 0);
    if (live.length === 0) { list.innerHTML = ''; return; }
    const byTri = live.slice().sort((a, b) => b.triCount - a.triCount).slice(0, OFF_TOP_N);
    const sortedDens = live.map(_density).sort((a, b) => a - b);
    const maxTri = byTri[0].triCount || 1;
    const esc = s => String(s).replace(/[<>&"]/g, ch => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[ch]));
    const rows = byTri.map((p, i) => {
      const widthPct = Math.max(2, (p.triCount / maxTri) * 100);
      const dens = _density(p);
      const rank = _rankInSorted(sortedDens, dens);
      const col = '#' + _colorForRank(rank).getHexString();
      const sel = state.selected.has(p.partId) ? ' selected' : '';
      const safeName = esc(p.name);
      const triShort = p.triCount >= 1000 ? (p.triCount/1000).toFixed(1) + 'k' : p.triCount;
      return '<div class="off-row' + sel + '" data-part-id="' + p.partId + '" title="' + safeName + ' · ' + p.triCount.toLocaleString() + ' tri · density rank ' + ((rank*100)|0) + '%">'
        + '<span class="off-rank">' + (i+1) + '</span>'
        + '<span class="off-mid">'
        +   '<span class="off-name">' + safeName + '</span>'
        +   '<span class="off-bar"><span class="off-bar-fill" style="width:' + widthPct + '%;background:' + col + '"></span></span>'
        + '</span>'
        + '<span class="off-tri">' + triShort + '</span>'
        + '</div>';
    });
    list.innerHTML = rows.join('');
  }

  document.addEventListener('click', (e) => {
    const row = e.target.closest && e.target.closest('.off-row');
    if (!row) return;
    const id = parseInt(row.dataset.partId, 10);
    if (!Number.isFinite(id)) return;
    const mode = (e.ctrlKey || e.metaKey || e.shiftKey) ? 'add' : 'single';
    try { selectPart(id, mode); } catch (_) {}
    if (typeof frameSelected === 'function' && mode === 'single') {
      try { frameSelected(); } catch (_) {}
    }
  });

  // Wrap rebuildTree at the very end of the chain so we run after scroll
  // restore + lucide pass; offenders list stays in sync without thrashing.
  if (typeof rebuildTree === 'function') {
    const _prevRebuild = rebuildTree;
    rebuildTree = function () {
      _prevRebuild.apply(this, arguments);
      try { _refreshOffenders(); } catch (e) { console.warn('offenders refresh failed', e); }
    };
  }

  // ── Heatmap view mode ────────────────────────────────────────────────────
  const _HEAT_BUCKETS = 16;
  const _heatMatPool = new Map();
  const _heatOriginalMat = new WeakMap();
  const _heatOriginalInstColor = new WeakMap();
  let _heatActive = false;

  // Additive-blend x-ray for heatmap. Order-independent (no transparent sort
  // means no whole-mesh-disappearing under orbit) and lets dense interior
  // parts contribute brightness through the outer shell. Opacity ramps with
  // the bucket index — high-density (red, bad) buckets get more opacity so
  // the offending parts pop out clearly; low-density (blue, fine) buckets
  // stay dim so they don't drown the high signal.
  function _applyXrayFlags(m, bucket = 0) {
    const rank = bucket / (_HEAT_BUCKETS - 1);          // 0..1, low=cold, high=hot
    // Linear ramp: 0.18 (cold) → 0.85 (hot). Tunable knobs.
    const opacity = 0.18 + rank * 0.67;
    m.transparent     = true;
    m.opacity         = opacity;
    m.depthWrite      = false;
    m.depthTest       = false;
    m.alphaToCoverage = false;
    m.blending        = THREE.AdditiveBlending;
    m.side            = THREE.DoubleSide;
    m.needsUpdate     = true;
  }

  function _getHeatMat(bucket) {
    let m = _heatMatPool.get(bucket);
    if (m) return m;
    const rank01 = bucket / (_HEAT_BUCKETS - 1);
    const c = _colorForRank(rank01);
    m = new THREE.MeshStandardMaterial({ color: c, metalness: 0.05, roughness: 0.85, side: THREE.DoubleSide });
    _applyXrayFlags(m, bucket);
    _heatMatPool.set(bucket, m);
    return m;
  }
  function _bucketForDensity(d, sortedDens) {
    const r = _rankInSorted(sortedDens, d);
    return Math.min(_HEAT_BUCKETS - 1, Math.max(0, Math.round(r * (_HEAT_BUCKETS - 1))));
  }

  function _enterHeatmap() {
    if (_heatActive) return;
    const live = state.parts.filter(p => p && !p.deleted && p.triCount > 0);
    if (live.length === 0) return;
    const sortedDens = live.map(_density).sort((a, b) => a - b);

    // Standalone parts: swap material directly. Save original via WeakMap so
    // we can restore without polluting mesh.userData.
    for (const p of live) {
      if (p.mesh && p.mesh.material) {
        if (!_heatOriginalMat.has(p.mesh)) _heatOriginalMat.set(p.mesh, p.mesh.material);
        const bucket = _bucketForDensity(_density(p), sortedDens);
        p.mesh.material = _getHeatMat(bucket);
      }
    }
    // Instanced groups: per-instance colours via instanceColor + a vertex-
    // colour-aware material clone so the colours actually render.
    const groups = state.instancedGroups || [];
    for (const g of groups) {
      const inst = g.instanced;
      if (!inst) continue;
      if (!_heatOriginalInstColor.has(inst)) {
        _heatOriginalInstColor.set(inst, {
          col: inst.instanceColor ? inst.instanceColor.clone() : null,
          mat: inst.material,
        });
      }
      const N = inst.count;
      const arr = new Float32Array(N * 3);
      const partsOfInst = state.parts.filter(p => p && p.instancedMesh === inst && !p.deleted);
      for (const p of partsOfInst) {
        const bucket = _bucketForDensity(_density(p), sortedDens);
        const c = _getHeatMat(bucket).color;
        const k = p.instanceIndex;
        arr[k*3] = c.r; arr[k*3+1] = c.g; arr[k*3+2] = c.b;
      }
      inst.instanceColor = new THREE.InstancedBufferAttribute(arr, 3);
      inst.instanceColor.needsUpdate = true;
      if (!inst.material.userData || !inst.material.userData._heatClone) {
        const clone = inst.material.clone();
        clone.vertexColors = true;
        clone.userData = clone.userData || {};
        clone.userData._heatClone = true;
        _applyXrayFlags(clone);
        inst.material = clone;
      }
    }
    _heatActive = true;
    if (typeof requestRender === 'function') requestRender();
  }

  function _exitHeatmap() {
    if (!_heatActive) return;
    for (const p of state.parts) {
      if (p && p.mesh && _heatOriginalMat.has(p.mesh)) {
        p.mesh.material = _heatOriginalMat.get(p.mesh);
        _heatOriginalMat.delete(p.mesh);
      }
    }
    const groups = state.instancedGroups || [];
    for (const g of groups) {
      const inst = g.instanced;
      if (!inst) continue;
      const saved = _heatOriginalInstColor.get(inst);
      if (saved) {
        inst.material = saved.mat;
        inst.instanceColor = saved.col;
        if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
        _heatOriginalInstColor.delete(inst);
      }
    }
    _heatActive = false;
    if (typeof requestRender === 'function') requestRender();
  }

  // Wrap setViewMode so 'heat' enters / leaves cleanly. Other modes always
  // exit heatmap first so wire/xray still see the original materials.
  if (typeof setViewMode === 'function') {
    const _origSet = setViewMode;
    setViewMode = function (mode) {
      if (mode === 'heat') {
        try { _origSet('solid'); } catch (_) {}
        state.viewMode = 'heat';
        _enterHeatmap();
        ['vw-solid','vw-wire','vw-xray','vw-heat'].forEach(id => $(id) && $(id).classList.remove('active'));
        $('vw-heat') && $('vw-heat').classList.add('active');
        return;
      }
      _exitHeatmap();
      _origSet.apply(this, arguments);
      ['vw-solid','vw-wire','vw-xray','vw-heat'].forEach(id => $(id) && $(id).classList.remove('active'));
      $('vw-' + mode) && $('vw-' + mode).classList.add('active');
    };
  }

  document.getElementById('vw-heat') && document.getElementById('vw-heat').addEventListener('click', () => setViewMode('heat'));
  // '4' shortcut. Guards mirror the existing 1/2/3 handler — skip when an
  // input is focused or modifier keys are held.
  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '4') setViewMode('heat');
  });

  // ── Per-part decimation ──────────────────────────────────────────────────
  let _SimplifyModifier = null;
  async function _loadSimplifier() {
    if (_SimplifyModifier) return _SimplifyModifier;
    const mod = await import('three/addons/modifiers/SimplifyModifier.js');
    _SimplifyModifier = mod.SimplifyModifier;
    return _SimplifyModifier;
  }

  function _stripToPositionsOnly(geom) {
    const out = new THREE.BufferGeometry();
    const pos = geom.attributes.position;
    out.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos.array), 3));
    if (geom.index) out.setIndex(new THREE.BufferAttribute(new Uint32Array(geom.index.array), 1));
    return out;
  }

  async function _decimateSelected() {
    const sel = state.selected;
    if (!sel || sel.size === 0) {
      if (typeof toast === 'function') toast('Decimate', 'Select parts first', 'warn', 2500);
      return;
    }
    const strength = parseFloat(document.getElementById('decimate-strength') ? document.getElementById('decimate-strength').value : '0.5');
    if (!(strength > 0 && strength < 1)) return;
    let SM;
    try { SM = await _loadSimplifier(); }
    catch (e) {
      if (typeof toast === 'function') toast('Decimate failed', 'SimplifyModifier load error: ' + e.message, 'err', 4000);
      return;
    }
    const simp = new SM();
    const ids = [...sel];
    const skipped = [];
    const failed = [];
    let trisBefore = 0, trisAfter = 0, parts = 0;

    for (let i = 0; i < ids.length; i++) {
      const p = getPart(ids[i]);
      if (!p || p.deleted) continue;
      if (!p.mesh) { skipped.push(p.name + ' (instanced)'); continue; }
      const geom = p.mesh.geometry;
      if (!geom || !geom.attributes || !geom.attributes.position) { skipped.push(p.name + ' (no geom)'); continue; }
      const triBefore = geom.index ? geom.index.count / 3 : geom.attributes.position.count / 3;
      if (triBefore < 12) { skipped.push(p.name + ' (too few tris)'); continue; }

      try {
        const stripped = _stripToPositionsOnly(geom);
        // SimplifyModifier requires non-indexed input; toNonIndexed() also
        // merges duplicate verts which is exactly what edge-collapse needs.
        const flat = stripped.index ? stripped.toNonIndexed() : stripped;
        const targetRemoveCount = Math.floor(flat.attributes.position.count * strength);
        if (targetRemoveCount < 3) { skipped.push(p.name + ' (target too low)'); continue; }
        const reduced = simp.modify(flat, targetRemoveCount);
        reduced.computeVertexNormals();
        reduced.computeBoundingBox();
        reduced.computeBoundingSphere();

        // Drop old GPU buffers but DO NOT touch state.geomByHash — other
        // parts may still reference the same cached geom. This part is now
        // unique to itself.
        try { p.mesh.geometry.dispose && p.mesh.geometry.dispose(); } catch (_) {}
        p.mesh.geometry = reduced;

        const newTri = reduced.index ? reduced.index.count / 3 : reduced.attributes.position.count / 3;
        const newVert = reduced.attributes.position.count;
        p.triCount = newTri;
        p.vertCount = newVert;
        p.bbox = reduced.boundingBox.clone();
        const sz = p.bbox.getSize(new THREE.Vector3());
        p.sizeMetrics = { diag: sz.length(), vol: sz.x*sz.y*sz.z, max: Math.max(sz.x, sz.y, sz.z) };
        p._fp = null; p._fpKey = null;

        trisBefore += triBefore;
        trisAfter  += newTri;
        parts++;
      } catch (e) {
        failed.push(p.name + ' (' + (e.message || e) + ')');
      }
      if (i % 4 === 3) await new Promise(r => requestAnimationFrame(r));
    }

    // Refresh aggregates + UI.
    try {
      let total = 0;
      for (const p of state.parts) if (!p.deleted) total += p.triCount;
      const $vt = $('vp-tris'); if ($vt) $vt.textContent = total.toLocaleString();
      const $st = $('sb-tris'); if ($st) $st.textContent = total.toLocaleString();
    } catch (_) {}
    try { rebuildTree && rebuildTree(); } catch (_) {}
    try { refreshPropertiesPanel && refreshPropertiesPanel(); } catch (_) {}
    try { applySelectionColors && applySelectionColors(); } catch (_) {}
    if (state.viewMode === 'heat') {
      // Density changed — re-bucket every part.
      _exitHeatmap(); _enterHeatmap();
    }
    if (typeof requestRender === 'function') requestRender();

    const dropped = trisBefore - trisAfter;
    const pct = trisBefore > 0 ? (dropped / trisBefore * 100) : 0;
    if (typeof toast === 'function') {
      if (parts > 0) toast('Decimated', parts + ' parts · −' + dropped.toLocaleString() + ' tris (' + pct.toFixed(1) + '%)', 'ok', 4000);
      if (skipped.length > 0) toast('Skipped', skipped.slice(0, 4).join(', ') + (skipped.length > 4 ? ' +' + (skipped.length-4) + ' more' : ''), 'warn', 4000);
      if (failed.length > 0) toast('Failed', failed.slice(0, 3).join(', ') + (failed.length > 3 ? ' +' + (failed.length-3) + ' more' : ''), 'err', 5000);
    }
  }

  document.getElementById('btn-decimate-sel') && document.getElementById('btn-decimate-sel').addEventListener('click', _decimateSelected);

  // Keep the count badge on the Decimate button in sync with selection.
  function _updateDecCount() {
    const el = document.getElementById('dec-sel-count');
    if (el) el.textContent = state.selected ? state.selected.size : 0;
  }
  setInterval(_updateDecCount, 200);

  // First population — model may already be loaded if this script ran late.
  setTimeout(() => {
    try { _refreshOffenders(); } catch (_) {}
    try { if (typeof _lucide === 'function') _lucide(); } catch (_) {}
  }, 200);
})();
