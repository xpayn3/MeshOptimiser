// anim.js — Animate: spin, swing, noise, path and oscillate layers on parts and groups, the scene's own tracks (explode, camera),
// the timeline and the Animate window (what each kind does: the notes above the installAnim call in app.js). Moved from app.js
// (2026-10-23) verbatim but for camera, renderer, controls, _Elements and _DraggablePopup, read as app.camera … (live: the app sets
// the first three when it starts, and the last two are made after this). The rest it uses comes in through installAnim(app).
import * as THREE from 'three';

export function installAnim(app) {
const { state, _MotionPerf, _UndoOps } = app;
const _finalizeUndo = (...a) => app._finalizeUndo(...a);
const _libShow = (...a) => app._libShow(...a);
const _lucide = (...a) => app._lucide(...a);
const _ctxBuild = (...a) => app._ctxBuild(...a);
const _openTurntableDialog = (...a) => app._openTurntableDialog(...a);
const _partWorldBoxOwn = (...a) => app._partWorldBoxOwn(...a);
const _promoteInstanceToMesh = (...a) => app._promoteInstanceToMesh(...a);
const _treeGroupDescendants = (...a) => app._treeGroupDescendants(...a);
const applyExplode = (...a) => app.applyExplode(...a);
const applySelectionColors = (...a) => app.applySelectionColors(...a);
const getPart = (...a) => app.getPart(...a);
const onResize = (...a) => app.onResize(...a);
const pushUndo = (...a) => app.pushUndo(...a);
const rebuildTreeSelectionOnly = (...a) => app.rebuildTreeSelectionOnly(...a);
const refreshPropertiesPanel = (...a) => app.refreshPropertiesPanel(...a);
const requestRender = (...a) => app.requestRender(...a);
const revealSelectedInTree = (...a) => app.revealSelectedInTree(...a);
const selectPart = (...a) => app.selectPart(...a);
const toast = (...a) => app.toast(...a);
const updateGizmo = (...a) => app.updateGizmo(...a);
return (() => {
  const KEY = 'mo-anim2';
  const TYPES = { spin: ['Spin', 'rotate-cw'], swing: ['Swing', 'arrow-left-right'], noise: ['Noise', 'audio-waveform'], path: ['Path', 'spline'], oscillate: ['Oscillate', 'arrow-up-down'] };
  const DEFAULTS = {
    type: 'spin',
    spin: { axis: 'Z', dir: -1, rpm: 60 },                           // dir -1 is clockwise seen from the tip of the axis (the arrow of the gizmo)
    swing: { axis: 'Z', amp: 45, period: 2 },                        // degrees each way, seconds for there and back
    noise: { type: 'wave', pos: 5, rot: 10, speed: 1, seed: 1, detail: 1, rough: 50, sx: 'xyz', rx: 'xyz' },   // wave / random / steps; mm, degrees, times, a number, layers of finer noise, how strong they are in %, the axes that shift and turn
    path: { shape: 'circle', plane: 'XY', size: 100, period: 6 },    // mm across, seconds for one round
    oscillate: { wave: 'sine', period: 1, tx: 0, ty: 0, tz: 20, ax: 0, ay: 0, az: 0, spread: 0, lag: 0, ratio: 3.5 },   // wave; seconds for one to-and-fro; shift of each axis in mm; turn of each axis in degrees; lag between the axes and of the turn behind the shift, in degrees of the cycle; rod length over crank length (piston)
    loop: { mode: 'loop', repeat: 0, delay: 0, from: 0, to: 100 },   // loop points in % of the cycle
  };
  // Pose and Look are made of keys, not of a cycle: they are drawn on the timeline as diamonds, and are not among the motions the window offers.
  TYPES.keys = ['Pose', 'diamond']; TYPES.look = ['Look', 'eye'];
  const KEYED = new Set(['keys', 'look']);
  let idSeq = 1; const nid = () => idSeq++;                      // (ids of layers and of keys)
  const folded = new Set();      // the objects whose clips are folded away in the timeline's list
  const selLids = new Set(), selKeys = new Set(); let selLid = 0;      // what is selected on the timeline: clips, keys
  const tracks = { explode: null, camera: null };                // the scene's own tracks: { keys: [{ id, t, v, e }], muted }
  const sceneN = () => (tracks.explode && tracks.explode.keys.length ? 1 : 0) + (tracks.camera && tracks.camera.keys.length ? 1 : 0);
  const anyAnim = () => items.size > 0 || sceneN() > 0;
  const LIMITS = { rpm: [1, 600], amp: [1, 180], period: [0.2, 60], pos: [0, 1000], rot: [0, 90], speed: [0.1, 5], seed: [1, 99], detail: [1, 4], rough: [0, 100], size: [1, 5000], tx: [0, 1000], ty: [0, 1000], tz: [0, 1000], ax: [0, 180], ay: [0, 180], az: [0, 180], spread: [0, 360], lag: [0, 360], ratio: [1.5, 8], repeat: [0, 999], delay: [0, 60], from: [0, 100], to: [0, 100] };
  const MM_KEYS = new Set(['noise.pos', 'path.size', 'oscillate.tx', 'oscillate.ty', 'oscillate.tz']);      // (the positions: in mm since the saved defaults and scene files carry u / v 2)
  const cfg = JSON.parse(JSON.stringify(DEFAULTS)); cfg.u = 2;
  const clampKey = (k, v) => { const L = LIMITS[k]; v = +v; if (!Number.isFinite(v)) return null; return L ? Math.max(L[0], Math.min(L[1], v)) : v; };
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (o && typeof o === 'object') {
      if (TYPES[o.type]) cfg.type = o.type;
      for (const g of ['spin', 'swing', 'noise', 'path', 'oscillate', 'loop']) for (const k of Object.keys(DEFAULTS[g])) {
        const v = o[g] && o[g][k]; if (v == null) continue;
        if (o.u !== 2 && MM_KEYS.has(g + '.' + k)) continue;      // (kept in % of the size before mm: not carried over)
        cfg[g][k] = typeof DEFAULTS[g][k] === 'number' ? (clampKey(k, v) ?? DEFAULTS[g][k]) : String(v);
      }
      if (![1, -1].includes(cfg.spin.dir)) cfg.spin.dir = -1;
      if (!['wave', 'random', 'steps'].includes(cfg.noise.type)) cfg.noise.type = 'wave';
      if (!['sine', 'piston', 'eased', 'triangle'].includes(cfg.oscillate.wave)) cfg.oscillate.wave = 'sine';
      for (const k of ['sx', 'rx']) cfg.noise[k] = ['x', 'y', 'z'].filter(c => String(cfg.noise[k]).toLowerCase().includes(c)).join('');
      cfg.noise.detail = Math.round(cfg.noise.detail); cfg.noise.seed = Math.round(cfg.noise.seed);
    }
  } catch (_) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (_) {} };

  const AX = { X: new THREE.Vector3(1, 0, 0), Y: new THREE.Vector3(0, 1, 0), Z: new THREE.Vector3(0, 0, 1) };
  const D2R = Math.PI / 180;
  // key ('p:<part id>' or 'g:<group id>') → { key, kind, label, layers: [{ type, p, loop, t }], rests: Map(part id → place in partsRoot's space), … }
  //   a part:  partId, c = the middle of its geometry (its own space), size = its diagonal
  //   a group: gid, members = part ids, C = the middle of the whole in partsRoot's space, Q = the group's axes there, size
  const items = new Map();
  let reverse = false, raf = 0, last = 0, suspended = false, paused = true, dismissed = false, clock = 0, rate = 1, ver = 0, popup = null, poll = 0, sig = '', listSig = '', headLay = null, headRaf = 0;
  // The timeline: how long it is (0 = as long as the longest cycle, at least 5 s), whether playing wraps round, where it lives (the dock
  // along the bottom, or the small floating window), how far it is zoomed. `popup` is whichever of the two is on screen.
  const TLKEY = 'mo-anim-tl';
  const tlp = (() => { try { return JSON.parse(localStorage.getItem(TLKEY) || '{}') || {}; } catch (_) { return {}; } })();
  // The project's frame rate (24, 30 or 60, like the clip export): the playhead snaps to frames, the arrow keys step one frame, and a clip
  // is exported at it. Kept with the timeline's length, in this browser.
  let projFps = [24, 30, 60].includes(+tlp.fps) ? +tlp.fps : 30, FRAME = 1 / projFps;
  let dur = +tlp.dur > 0 ? Math.min(600, +tlp.dur) : 0, playLoop = tlp.loop !== false, pingpong = !!tlp.pingpong, bounce = 1, mode = tlp.mode === 'mini' ? 'mini' : 'dock', showL = tlp.left !== false, showR = tlp.right !== false, zoom = 1, switching = false, dragBar = false, pps = 60;
  const ui = { dock: null, mini: null };
  const saveTl = () => { try { localStorage.setItem(TLKEY, JSON.stringify({ dur, fps: projFps, loop: playLoop, pingpong, mode, left: showL, right: showR })); } catch (_) {} };
  const M1 = new THREE.Matrix4(), M2 = new THREE.Matrix4(), M3 = new THREE.Matrix4(), M4 = new THREE.Matrix4(), M5 = new THREE.Matrix4();
  const Q1 = new THREE.Quaternion(), V1 = new THREE.Vector3(), E1 = new THREE.Euler();

  // A part that is drawn as its own mesh. An instanced part (most parts of a converted assembly) has none until it is promoted, as the gizmo does.
  const live = (id) => { const p = getPart(id); return p && !p.deleted && p.mesh ? p : null; };
  const exists = (id) => { const p = getPart(id); return p && !p.deleted && (p.mesh || p.instancedMesh) ? p : null; };
  const promote = (p) => { if (p && !p.mesh && p.instancedMesh) { try { _promoteInstanceToMesh(p); } catch (_) {} } return p && p.mesh ? p : null; };

  // What one pass over the animated objects needs again and again (a frame of the animation, a seek, a refresh), worked out once: partsRoot's
  // world matrix, the inverse of its rotation (for the exploded offsets), whether the view is exploded, and the inverse of each parent's matrix.
  const FR = { R: new THREE.Matrix4(), Ri: new THREE.Matrix4(), rot3: new THREE.Matrix3(), exploded: false, exSig: '', parents: new Map() };
  const IDENT = new THREE.Matrix4();
  const beginFrame = () => {
    if (state.partsRoot) state.partsRoot.updateWorldMatrix(true, false);
    FR.R.copy(state.partsRoot ? state.partsRoot.matrixWorld : IDENT);
    FR.rot3.setFromMatrix4(FR.R).invert();
    FR.Ri.copy(FR.R).invert();
    const e = state.explode; FR.exploded = !!(e && (e.x || e.y || e.z));
    FR.exSig = FR.exploded ? e.x + ',' + e.y + ',' + e.z : '';
    FR.parents.clear();
  };
  const parentInv = (par) => {
    let m = FR.parents.get(par);
    if (!m) { par.updateWorldMatrix(true, false); m = new THREE.Matrix4().copy(par.matrixWorld).invert(); FR.parents.set(par, m); }
    return m;
  };
  // The exploded view moves each part away by p._exOff (a vector in the world); an animation works from where the part is in the assembled
  // model, and the offset is added on top, so the two go together (the offset is in partsRoot's space here).
  const OFF = new THREE.Vector3(), RE = new THREE.Matrix4();
  const exOff = (id, out) => {
    const p = getPart(id);
    if (!FR.exploded || !p || !p._exOff) return out.set(0, 0, 0);
    return out.copy(p._exOff).applyMatrix3(FR.rot3);
  };
  // the part's place in the assembled model, as seen from partsRoot (a change of the scene's scale or turn does not spoil it)
  const restOf = (mesh, id) => {
    mesh.updateWorldMatrix(true, false);
    const m = new THREE.Matrix4().copy(FR.R).invert().multiply(mesh.matrixWorld);
    if (id != null && FR.exploded) { exOff(id, OFF); m.premultiply(M1.makeTranslation(-OFF.x, -OFF.y, -OFF.z)); }
    return m;
  };
  // …and with the exploded view's offset on it, as it is now (the rest itself when the view is not exploded: nothing is made)
  const restE = (id, rec) => {
    const r = rec.rests.get(id);
    if (!FR.exploded) return r;
    exOff(id, OFF); return RE.makeTranslation(OFF.x, OFF.y, OFF.z).multiply(r);
  };
  // Put a mesh at `rootMat` (a matrix in partsRoot's space), whatever it is parented to now (the gizmo's pivot, a group, partsRoot).
  const place = (mesh, rootMat) => {
    (mesh.parent ? M3.copy(parentInv(mesh.parent)) : M3.identity()).multiply(FR.R).multiply(rootMat).decompose(mesh.position, mesh.quaternion, mesh.scale);
    mesh.updateMatrixWorld(true);
  };
  const centreOf = (mesh) => {
    const g = mesh.geometry; if (!g) return { c: new THREE.Vector3(), size: 1 };
    if (!g.boundingBox) { try { g.computeBoundingBox(); } catch (_) {} }
    const b = g.boundingBox;
    return b && !b.isEmpty() ? { c: b.getCenter(new THREE.Vector3()), size: Math.max(1e-6, b.getSize(new THREE.Vector3()).length()) } : { c: new THREE.Vector3(), size: 1 };
  };

  // ---- the motions: a layer gives a shift (pos) and a turn (quat), in the object's own axes ----
  const smooth = (t, ch, seed) => { const s = seed * 12.9898 + ch * 78.233; return Math.sin(t + s) * 0.55 + Math.sin(t * 2.31 + s * 1.7) * 0.30 + Math.sin(t * 4.13 + s * 2.9) * 0.15; };
  // three kinds of noise, each a number between −1 and 1 for a time, a channel and a seed: a mix of sines, smooth random values (value noise)
  // and random values held until the next (steps). Detail adds finer layers of the same noise, each as strong as roughness says.
  const nHash = (n, ch, seed) => { const x = Math.sin(n * 127.1 + ch * 74.7 + seed * 311.7) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; };
  const nValue = (t, ch, seed) => { const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f); return nHash(i, ch, seed) * (1 - u) + nHash(i + 1, ch, seed) * u; };
  const nSteps = (t, ch, seed) => nHash(Math.floor(t), ch, seed);
  const NOISE = { wave: smooth, random: nValue, steps: nSteps };
  const fbm = (fn, t, ch, seed, oct, rough) => { let a = 1, f = 1, sum = 0, norm = 0; for (let k = 0; k < oct; k++) { sum += a * fn(t * f + k * 17.31, ch, seed); norm += a; a *= rough; f *= 2.03; } return norm ? sum / norm : 0; };
  const SHAPES = {
    circle:  { closed: true,  pts: Array.from({ length: 8 }, (_, i) => [Math.cos(i / 8 * 2 * Math.PI), Math.sin(i / 8 * 2 * Math.PI)]) },
    figure8: { closed: true,  pts: Array.from({ length: 12 }, (_, i) => [Math.sin(i / 12 * 2 * Math.PI), Math.sin(2 * i / 12 * 2 * Math.PI) * 0.6]) },
    square:  { closed: true,  pts: [[-1, -1], [1, -1], [1, 1], [-1, 1]] },
    wave:    { closed: false, pts: [[-1, 0], [-0.5, 0.6], [0, 0], [0.5, -0.6], [1, 0]] },
    line:    { closed: false, pts: [[-1, 0], [1, 0]] },
  };
  const curveOf = (lay) => {
    const key = lay.p.shape + lay.p.plane;
    if (lay._ck === key) return lay._curve;
    const sh = SHAPES[lay.p.shape] || SHAPES.circle, pl = lay.p.plane;
    const pts = sh.pts.map(([a, b]) => pl === 'XZ' ? new THREE.Vector3(a, 0, b) : pl === 'YZ' ? new THREE.Vector3(0, a, b) : new THREE.Vector3(a, b, 0));
    lay._curve = new THREE.CatmullRomCurve3(pts, sh.closed, 'catmullrom', 0.5); lay._ck = key;
    return lay._curve;
  };
  // Where the cycle is now, 0..1, after the delay, the repeats, the loop mode and the loop points.
  const phase = (lay, openShape) => {
    const L = lay.loop, e = tOf(lay) - L.delay;
    const from = Math.min(L.from, L.to) / 100, to = Math.max(L.from, L.to) / 100;
    if (e <= 0) return from;
    const period = lay.type === 'spin' ? 60 / lay.p.rpm : lay.p.period;
    const mode = openShape && L.mode === 'loop' ? 'pingpong' : L.mode;
    const cyc = e / period, done = L.repeat > 0 && cyc >= L.repeat;
    let u;
    if (mode === 'once') u = Math.min(cyc, 1);
    else if (mode === 'pingpong') { const f = done ? 0 : cyc % 1; u = 1 - Math.abs(1 - 2 * f); }
    else u = done ? 1 : cyc % 1;
    return from + (to - from) * u;
  };
  const layerPose = (lay, size, out) => {
    out.pos.set(0, 0, 0); out.quat.identity();
    const p = lay.p;
    if (lay.muted || (lay.end != null && lay.t > lay.end)) return;      // (a clip that is switched off, or past its end, moves nothing)
    const te = tOf(lay) - (lay.loop.delay || 0);      // (swing, noise and oscillate wait for their delay; spin and path do it in phase)
    if ((lay.type === 'swing' || lay.type === 'noise' || lay.type === 'oscillate') && te < 0) return;
    switch (lay.type) {
      case 'spin': {
        const axis = lay.axisVec || AX[p.axis];
        out.quat.setFromAxisAngle(axis, p.dir * 2 * Math.PI * phase(lay, false));
        break;
      }
      case 'swing':
        out.quat.setFromAxisAngle(AX[p.axis], p.amp * D2R * Math.sin(te * 2 * Math.PI / p.period));
        break;
      case 'noise': {
        const fn = NOISE[p.type] || smooth;
        const t = fn === smooth ? te * p.speed * Math.PI : te * p.speed * 1.5;      // (a speed of 1 is about half a shake a second, or a new random value every two thirds of a second)
        const sh = p.pos, rt = p.rot * D2R, oct = Math.max(1, Math.min(4, Math.round(p.detail || 1))), rg = (p.rough == null ? 50 : p.rough) / 100;
        const n = (ch) => fbm(fn, t, ch, p.seed, oct, rg), sx = p.sx == null ? 'xyz' : p.sx, rx = p.rx == null ? 'xyz' : p.rx;
        out.pos.set(sx.includes('x') ? n(0) * sh : 0, sx.includes('y') ? n(1) * sh : 0, sx.includes('z') ? n(2) * sh : 0);
        E1.set(rx.includes('x') ? n(3) * rt : 0, rx.includes('y') ? n(4) * rt : 0, rx.includes('z') ? n(5) * rt : 0, 'XYZ');
        out.quat.setFromEuler(E1);
        break;
      }
      case 'oscillate': {
        const f = OSC[p.wave] || OSC.sine, th = te * 2 * Math.PI / Math.max(0.05, p.period), sp = p.spread * D2R, lg = p.lag * D2R, n = Math.max(1.5, p.ratio || 3.5), sh = 1;
        out.pos.set(p.tx * sh * f(th, n), p.ty * sh * f(th + sp, n), p.tz * sh * f(th + 2 * sp, n));
        E1.set(p.ax * D2R * f(th + lg, n), p.ay * D2R * f(th + lg + sp, n), p.az * D2R * f(th + lg + 2 * sp, n), 'XYZ');
        out.quat.setFromEuler(E1);
        break;
      }
      case 'keys': {
        const v = keyEval(lay.keys, lay.t, mixNum); if (!v) break;
        out.pos.set(v.mx, v.my, v.mz);      // (mm)
        E1.set(v.rx * D2R, v.ry * D2R, v.rz * D2R, 'XYZ');
        out.quat.setFromEuler(E1);
        break;
      }
      case 'path': {
        const sh = SHAPES[p.shape] || SHAPES.circle;
        curveOf(lay).getPointAt(Math.min(1, Math.max(0, phase(lay, !sh.closed))), V1);
        out.pos.copy(V1).multiplyScalar(p.size * 0.5);      // (mm across)
        break;
      }
    }
  };
  // The waves of Oscillate: a number between −1 and 1 for an angle of the cycle (any angle: it repeats every turn, so it loops for ever).
  //   sine      the smooth to-and-fro
  //   piston    the real motion of a crank turning a rod: quicker through the middle at one end than the other (rod over crank = `ratio`)
  //   eased     the same distance with a rest at each end and a firm move between
  //   triangle  the same speed all the way, turning round at the ends
  const OSC = {
    sine: (a) => Math.sin(a),
    piston: (a, n) => { const s = Math.sin(a); return Math.cos(a) + Math.sqrt(Math.max(0, n * n - s * s)) - n; },
    eased: (a) => { const u = (2 / Math.PI * Math.asin(Math.sin(a)) + 1) / 2; return (u * u * (3 - 2 * u)) * 2 - 1; },
    triangle: (a) => 2 / Math.PI * Math.asin(Math.sin(a)),
  };
  // ---- keys: easing, what lies between two keys, the tracks of the scene, the look of a part ----
  const tOf = (lay) => lay.t + (lay.skip || 0);      // (the time a clip is at: a trimmed start skips what was cut off)
  const EASES = {
    linear: ['Linear', (u) => u],
    ease: ['Smooth', (u) => u * u * (3 - 2 * u)],
    in: ['Ease in', (u) => u * u * u],
    out: ['Ease out', (u) => 1 - (1 - u) ** 3],
    spring: ['Spring', (u) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (u - 1) ** 3 + c1 * (u - 1) ** 2; }],
    hold: ['Hold', (u) => (u >= 1 ? 1 : 0)],
  };
  // the value at time t between the keys (before the first and after the last it stays as the nearest key has it); mix(a, b, u) blends two
  function keyEval(keys, t, mix) {
    const n = keys.length; if (!n) return null;
    if (n === 1 || t <= keys[0].t) return keys[0].v;
    if (t >= keys[n - 1].t) return keys[n - 1].v;
    let i = 0; while (i < n - 2 && t >= keys[i + 1].t) i++;
    const a = keys[i], b = keys[i + 1];
    return mix(a.v, b.v, (EASES[a.e] || EASES.ease)[1]((t - a.t) / Math.max(1e-9, b.t - a.t)));
  }
  const mixNum = (a, b, u) => { const o = {}; for (const k in a) o[k] = typeof a[k] === 'number' && typeof b[k] === 'number' ? a[k] + (b[k] - a[k]) * u : a[k]; return o; };
  const lookCol = new THREE.Color(), lookCol2 = new THREE.Color();
  const mixLook = (a, b, u) => { const o = mixNum(a, b, u); o.c = '#' + lookCol.set(a.c || '#4f9dff').lerp(lookCol2.set(b.c || '#4f9dff'), u).getHexString(); return o; };
  // the camera goes round the middle it looks at: the distance and the middle are blended, the direction is turned (not cut through the model)
  const _cd = new THREE.Vector3(), _ce = new THREE.Vector3(), _cq = new THREE.Quaternion(), _cI = new THREE.Quaternion();
  function mixCam(a, b, u) {
    const L = (x, y) => x + (y - x) * u;
    const tx = L(a.tx, b.tx), ty = L(a.ty, b.ty), tz = L(a.tz, b.tz);
    _cd.set(a.px - a.tx, a.py - a.ty, a.pz - a.tz); _ce.set(b.px - b.tx, b.py - b.ty, b.pz - b.tz);
    const da = _cd.length(), db = _ce.length(), dist = L(da, db);
    if (da > 1e-9) _cd.divideScalar(da); else _cd.set(0, 0, 1);
    if (db > 1e-9) _ce.divideScalar(db); else _ce.set(0, 0, 1);
    _cq.setFromUnitVectors(_cd, _ce); _cI.identity().slerp(_cq, u); _cd.applyQuaternion(_cI);
    return { px: tx + _cd.x * dist, py: ty + _cd.y * dist, pz: tz + _cd.z * dist, tx, ty, tz, fov: L(a.fov, b.fov) };
  }
  function applyCamKey(v) {
    if (!(app.camera && app.controls && v)) return;
    app.camera.position.set(v.px, v.py, v.pz); app.controls.target.set(v.tx, v.ty, v.tz);
    if (app.camera.isPerspectiveCamera && Number.isFinite(v.fov) && Math.abs(app.camera.fov - v.fov) > 1e-4) { app.camera.fov = v.fov; app.camera.updateProjectionMatrix(); }
    app.camera.lookAt(app.controls.target);
    try { app.controls.update(); } catch (_) {}
    try { requestRender(); } catch (_) {}
  }
  let exSig = '', exUi = 0;
  // The scene's own tracks at time t: the explode of the view, and the camera. force: even when nothing seems to have changed.
  function applyScene(t, force, uiToo) {
    const ex = tracks.explode;
    if (ex && !ex.muted && ex.keys.length && state.parts && state.parts.length) {
      const v = keyEval(ex.keys, t, mixNum);
      const sg = Math.round(v.x * 10) + ',' + Math.round(v.y * 10) + ',' + Math.round(v.z * 10);
      if (force || sg !== exSig) {
        exSig = sg; state.explode = { x: v.x, y: v.y, z: v.z };
        try { applyExplode(); } catch (_) {}
        if (uiToo || (++exUi % 6) === 0) {      // (the Explode panel follows: not on every frame)
          try {
            const top = Math.max(v.x, v.y, v.z); if (top > 0) state._explodeLast = top;
            const sc = state._explodeScrubbers; if (sc) { sc.all?.setValue(top); for (const k of ['x', 'y', 'z']) sc[k]?.setValue(v[k]); }
            state._explodePaint?.();
          } catch (_) {}
        }
      }
    }
    const cm = tracks.camera;
    if (cm && !cm.muted && cm.keys.length) applyCamKey(keyEval(cm.keys, t, mixCam));
  }
  // Look: a part is drawn through a copy of its material (see-through, tinted) while a Look layer is on it; the material it had is put back after.
  function applyLook(rec) {
    let lay = null;
    for (const l of rec.layers) if (l.type === 'look' && !l.muted && l.keys && l.keys.length) lay = l;
    if (!lay) { if (rec.look && rec.look.size) restoreLook(rec); return; }
    const v = keyEval(lay.keys, lay.t, mixLook); if (!v) return;
    const ids = rec.kind === 'part' ? [rec.partId] : rec.members;
    if (!rec.look) rec.look = new Map();
    for (const id of ids) {
      const p = live(id); if (!p) continue;
      const mesh = p.mesh; let m = rec.look.get(id);
      if (!m || m.mesh !== mesh || mesh.material !== m.clone) {      // (new, or a view mode has put another material on it since)
        const orig = mesh.material;
        if (!orig || Array.isArray(orig) || typeof orig.clone !== 'function') continue;
        if (m && m.clone && m.clone !== orig) { try { m.clone.dispose(); } catch (_) {} }
        const clone = orig.clone(); clone.transparent = true; clone.depthWrite = false; clone.needsUpdate = true;
        m = { mesh, orig, clone, c0: orig.color ? orig.color.clone() : null };
        mesh.material = clone; rec.look.set(id, m);
      }
      m.clone.opacity = Math.max(0, Math.min(1, v.o));
      if (m.c0 && m.clone.color) { m.clone.color.copy(m.c0); if (v.tm > 0) m.clone.color.lerp(lookCol.set(v.c || '#4f9dff'), Math.max(0, Math.min(1, v.tm))); }
    }
  }
  function restoreLook(rec) {
    if (!rec.look) return;
    for (const m of rec.look.values()) { if (m.mesh.material === m.clone) m.mesh.material = m.orig; try { m.clone.dispose(); } catch (_) {} }
    rec.look.clear();
  }
  const POSE = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  // The layers of an animated object, added up, as one matrix about the middle (in the object's own axes).
  const deltaOf = (rec, out) => {
    out.identity();
    for (const lay of rec.layers) {
      layerPose(lay, rec.size, POSE);
      M1.makeTranslation(POSE.pos.x, POSE.pos.y, POSE.pos.z);
      out.multiply(M1).multiply(M2.makeRotationFromQuaternion(POSE.quat));
    }
    return out;
  };
  const DELTA = new THREE.Matrix4(), F4 = new THREE.Matrix4(), G4 = new THREE.Matrix4(), RG = new THREE.Matrix4(), W4 = new THREE.Matrix4(), T4 = new THREE.Matrix4(), N4 = new THREE.Matrix4();
  const stats = { ms: 0, parts: 0 };                 // the time of the last frame's work, and how many parts it moved
  // Parenting: an object can follow another animated object. What the parent does (its own motion and, in turn, what it follows) is put on the
  // child first, then the child's own motion on top: a piston on a crank turns with it and also slides on its own.
  // Returns that motion as a matrix in the root frame, or null when there is no parent.
  // The motion of a part as a rigid transform in the root frame. The part's matrix `rest` can hold a turn, a shift, a scale (and, for odd files, a
  // mirror or an uneven scale); the motion must hold none of the scale: it turns about the middle of the part's geometry (`c`, in the part's own
  // coordinates, so its place in the root frame is rest·c), along the part's own axes (the turn of `rest`, made exactly orthonormal), and a shift in
  // the animation's units is brought to the root frame's units by the part's overall scale. Written as T(P) · Rr · D · Rr⁻¹ · T(−P), so it is a
  // proper rigid motion whatever `rest` is, and what follows a part stays the shape it was.
  const _RM = { P: new THREE.Vector3(), pos: new THREE.Vector3(), sc: new THREE.Vector3(), q: new THREE.Quaternion(), Rr: new THREE.Matrix4(), Ri: new THREE.Matrix4(), Dt: new THREE.Matrix4(), tp: new THREE.Matrix4(), tn: new THREE.Matrix4(), B: new THREE.Matrix4() };
  function rigidPartMotion(rest, c, D, out) {
    const m = _RM;
    m.P.copy(c).applyMatrix4(rest);
    rest.decompose(m.pos, m.q, m.sc);
    // an uneven or mirrored scale leaves a turn that is still a pure rotation (decompose takes the sign of the mirror into the scale)
    const det = rest.determinant(), s = Math.cbrt(Math.abs(det)) || 1;
    m.Rr.makeRotationFromQuaternion(m.q); m.Ri.copy(m.Rr).invert();
    // D = T(shift) · R(turn) in the part's own axes with the shift in the part's own units: scale only the shift
    m.Dt.copy(D); m.Dt.elements[12] *= s; m.Dt.elements[13] *= s; m.Dt.elements[14] *= s;
    m.tp.makeTranslation(m.P.x, m.P.y, m.P.z); m.tn.makeTranslation(-m.P.x, -m.P.y, -m.P.z);
    return out.copy(m.tp).multiply(m.Rr).multiply(m.Dt).multiply(m.Ri).multiply(m.tn);
  }
  function parentDelta(rec, depth) {
    const par = rec.parent && rec.parent !== rec.key ? items.get(rec.parent) : null;
    if (!par || (depth || 0) > 8) return null;
    const up = parentDelta(par, (depth || 0) + 1);
    const D = deltaOf(par, new THREE.Matrix4()), out = new THREE.Matrix4();
    if (par.kind === 'part') {
      rigidPartMotion(restE(par.partId, par), par.c, D, out);
    } else {
      const F = new THREE.Matrix4().makeRotationFromQuaternion(par.Q);
      out.makeTranslation(par.C.x, par.C.y, par.C.z).multiply(F).multiply(D).multiply(F.clone().invert()).multiply(new THREE.Matrix4().makeTranslation(-par.C.x, -par.C.y, -par.C.z));
    }
    if (up) out.premultiply(up);
    return out;
  }
  // A part moved by the user while it is animated (dragged, typed, undone, aligned, placed: anything that changes where its mesh is, other
  // than this file) keeps its new place: it becomes the part's rest, and the animation goes on from there. Every part this file puts
  // somewhere is noted (PLACED: its place in the root frame, without the exploded offset); at the start of a pass, a part that is somewhere
  // else has been moved by someone else (MOVED: where to, and by how much). The check is made once for the pass, before any object places a
  // part: a part that two objects hold (a group inside a group) is put by each in turn, and the one that goes last is what is noted.
  const PLACED = new Map(), MOVED = new Map();
  let placedEx = '';
  const sameM = (x, y, eps) => { const p = x.elements, q = y.elements; for (let i = 0; i < 16; i++) if (Math.abs(p[i] - q[i]) > eps * (1 + Math.abs(q[i]))) return false; return true; };
  const rootPoseOf = (mesh, id, out, fresh) => {
    if (!fresh) mesh.updateWorldMatrix(true, false);      // (fresh: its world matrix was just made, by place())
    out.multiplyMatrices(FR.Ri, mesh.matrixWorld);
    if (id != null && FR.exploded) { exOff(id, OFF); out.premultiply(M1.makeTranslation(-OFF.x, -OFF.y, -OFF.z)); }
    return out;
  };
  const notePlaced = (id, mesh) => { PLACED.set(id, rootPoseOf(mesh, id, PLACED.get(id) || new THREE.Matrix4(), true)); placedEx = FR.exSig; };
  const forgetPlaced = (rec) => { for (const id of rec.rests.keys()) PLACED.delete(id); rec.lastG = rec.lastPW = null; };
  const idsOf = (rec) => rec.kind === 'part' ? [rec.partId] : rec.members;
  function detectMoved(recs) {
    MOVED.clear();
    if (!PLACED.size || placedEx !== FR.exSig) return;      // (an explode that has changed since: the offsets are not the ones the places were noted with)
    const cur = new THREE.Matrix4();
    for (const rec of recs) for (const id of idsOf(rec)) {
      if (MOVED.has(id)) continue;
      const was = PLACED.get(id), p = live(id); if (!was || !p) continue;
      rootPoseOf(p.mesh, id, cur);
      if (!sameM(cur, was, 1e-6)) MOVED.set(id, { cur: cur.clone(), d: cur.clone().multiply(new THREE.Matrix4().copy(was).invert()) });
    }
  }
  const MV_D = new THREE.Matrix4(), MV_I = new THREE.Matrix4();
  function adoptPart(rec) {
    const mv = MOVED.get(rec.partId); if (!mv) return;
    MV_D.copy(mv.d);
    if (rec.lastPW) MV_D.premultiply(MV_I.copy(rec.lastPW).invert()).multiply(rec.lastPW);      // (seen from what the part follows)
    rec.rests.set(rec.partId, MV_D.clone().multiply(rec.rests.get(rec.partId)));
  }
  // A group: if every part moved the same way (the whole group was moved), the rests and the middle the group turns about go with it; if only
  // some did, each of those is put where it stands now, taken back through the motion the group had when it was last placed.
  function adoptGroup(rec) {
    if (!MOVED.size || !rec.lastG) return;
    const ch = []; let n = 0;
    for (const id of rec.members) { if (!live(id)) continue; n++; const mv = MOVED.get(id); if (mv) ch.push({ id, cur: mv.cur, d: mv.d }); }
    if (!ch.length) return;
    if (ch.length === n && ch.every(c => sameM(c.d, ch[0].d, 1e-5))) {
      const d = ch[0].d, q = new THREE.Quaternion();
      for (const [id, r] of [...rec.rests]) rec.rests.set(id, d.clone().multiply(r));
      rec.C.applyMatrix4(d); d.decompose(V1, q, new THREE.Vector3()); rec.Q.premultiply(q);
    } else {
      MV_I.copy(rec.lastG).invert();
      for (const c of ch) rec.rests.set(c.id, MV_I.clone().multiply(c.cur));
    }
  }
  function applyRec(rec) {
    const PW = parentDelta(rec, 0);
    deltaOf(rec, DELTA);
    applyLook(rec);
    if (rec.kind === 'part') {
      // a deleted part keeps its record (−1: nothing moved, keep it): it comes back with its motion and its rest when the delete is
      // undone. The record used to be dropped on the first pass, with the only copy of the rest, so undo brought the part back frozen mid-turn.
      const p = live(rec.partId); if (!p) return getPart(rec.partId) ? -1 : 0;
      // rest · T(c) · delta · T(−c): the turn is about the middle of the part's own geometry
      adoptPart(rec);
      const R0 = restE(rec.partId, rec);
      rigidPartMotion(R0, rec.c, DELTA, M5); M5.multiply(R0);      // (the motion first as a rigid transform, then the part's rest under it)
      if (PW) M5.premultiply(PW);
      place(p.mesh, M5);
      notePlaced(rec.partId, p.mesh);
      if (PW) (rec.lastPW || (rec.lastPW = new THREE.Matrix4())).copy(PW); else rec.lastPW = null;
      return 1;
    }
    // a group: T(C) · F · delta · F⁻¹ · T(−C), then each part from where it started
    adoptGroup(rec);
    F4.makeRotationFromQuaternion(rec.Q);
    G4.makeTranslation(rec.C.x, rec.C.y, rec.C.z).multiply(F4).multiply(DELTA);
    F4.invert(); G4.multiply(F4).multiply(T4.makeTranslation(-rec.C.x, -rec.C.y, -rec.C.z));
    if (PW) G4.premultiply(PW);
    RG.multiplyMatrices(FR.R, G4);
    let n = 0, gone = 0;
    for (const id of rec.members) {
      const p = live(id); if (!p) { if (getPart(id)) gone++; continue; }
      const m = p.mesh;
      W4.multiplyMatrices(RG, restE(id, rec));
      (m.parent ? M3.copy(parentInv(m.parent)) : M3.identity()).multiply(W4).decompose(m.position, m.quaternion, m.scale);
      m.updateMatrixWorld(true);
      n++;
    }
    if (n) {
      for (const id of rec.members) { const p = live(id); if (p) notePlaced(id, p.mesh); }
      (rec.lastG || (rec.lastG = new THREE.Matrix4())).copy(G4);
    }
    return n || (gone ? -1 : 0);      // (a group whose members are all deleted waits for them, as a part does)
  }
  // one pass over some objects (all of them, or the one that changed); an object that has nothing left to move is dropped
  // (0), one whose parts are deleted is kept for their return (−1)
  function applyAll(recs) {
    beginFrame();
    let n = 0;
    const list = [...(recs || items.values())];
    detectMoved(list);
    for (const rec of list) { const k = applyRec(rec); if (k === 0) items.delete(rec.key); else if (k > 0) n += k; }
    MOVED.clear();
    return n;
  }
  const apply = (rec) => { beginFrame(); detectMoved([rec]); const r = applyRec(rec) > 0; MOVED.clear(); return r; };
  function tick(now) {
    raf = 0;
    if (suspended || held || paused || !anyAnim()) return;
    const t0 = performance.now();
    fpsNote(now - last);
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000)) * rate * (reverse ? -1 : 1) * bounce; last = now;
    clock += dt;
    for (const rec of items.values()) for (const lay of rec.layers) lay.t += dt;
    const D = durOf();
    if (clock >= D || clock < 0) {      // an end of the timeline: stop there (Once), turn round (Ping-pong) or go on at the other end (Loop)
      const fwd = clock >= D;
      if (!playLoop) { clock = fwd ? D : 0; paused = true; }
      else if (pingpong) { clock = fwd ? Math.max(0, 2 * D - clock) : Math.min(D, -clock); bounce = -bounce; }
      else clock = fwd ? clock % D : ((clock % D) + D) % D;
      for (const rec of items.values()) for (const lay of rec.layers) lay.t = clock;
    }
    applyScene(clock, false, false);
    stats.parts = applyAll();
    requestRender();
    stats.ms = stats.ms ? stats.ms * 0.8 + (performance.now() - t0) * 0.2 : performance.now() - t0;
    if (anyAnim() && !paused) raf = requestAnimationFrame(tick); else sync();
  }
  function loop() { if (!raf && anyAnim() && !suspended && !held && !paused) { last = performance.now(); raf = requestAnimationFrame(tick); } updateTag(); }
  // The pill of the animation, with the other status pills of the view (Isolated, Exploded, Measure: #vp-mode-pills, right of the camera
  // pill, the same size). "Animate mode" while the Animate window is open, and while something is animated "Playing" or "Paused" with a
  // pause / play button and an X. Pause keeps the poses and the animations; the X leaves: everything is paused and the controls go away.
  // A click on the pill itself brings the Animate window back.
  function updateTag() {
    try { applyDraft(); } catch (_) {}
    try { window.dispatchEvent(new Event('mo-anim')); } catch (_) {}      // (the Animation card in the right sidebar follows it)
    let el = document.getElementById('vp-animate-pill');
    if (!el) return;
    const mode = !!state._animMode, running = anyAnim() && !dismissed && !suspended && !held;      // (the pill stays when it is paused and says Paused, with its play button; Exit closes it)
    el.hidden = !(mode || running);
    if (el.hidden) return;
    if (!el._wired) {
      el._wired = true;
      el.innerHTML = '<span class="anim-pill-dot" aria-hidden="true"></span><span class="vp-pill-label"></span>' +
        '<span class="anim-pill-btn" role="button" tabindex="0" data-a="toggle"></span>' +
        '<span class="anim-pill-btn" role="button" tabindex="0" data-a="exit" title="Exit: pause everything and close these buttons" aria-label="Exit"><i data-lucide="x" aria-hidden="true"></i></span>';
      const act = (e) => {
        const b = e.target.closest('[data-a]');
        if (!b) { open(); return; }                       // the pill itself: the window comes back
        e.stopPropagation();
        if (b.dataset.a === 'exit') exit(); else if (paused) play(); else pause();
      };
      el.addEventListener('click', act);
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(e); } });
      try { _lucide(); } catch (_) {}
    }
    el.classList.toggle('is-paused', paused);
    el.classList.toggle('has-play', running);
    const label = [mode ? 'Animate mode' : '', running ? (paused ? 'Paused' : 'Playing') : ''].filter(Boolean).join(' · ');
    const lab = el.querySelector('.vp-pill-label'); if (lab && lab.textContent !== label) lab.textContent = label;
    for (const x of el.querySelectorAll('.anim-pill-dot,.anim-pill-btn')) x.hidden = !running;
    const tb = el.querySelector('[data-a="toggle"]'), st = paused ? 'play' : 'pause';
    if (tb && tb.dataset.s !== st) {
      tb.dataset.s = st; tb.innerHTML = `<i data-lucide="${st}" aria-hidden="true"></i>`;
      tb.title = paused ? 'Play every animation' : 'Pause every animation where it is'; tb.setAttribute('aria-label', paused ? 'Play' : 'Pause');
      try { _lucide(); } catch (_) {}
    }
    el.title = 'Open the Animate window';
  }
  // Leaving Animate mode puts everything back at the first frame (time 0, scene tracks too), as it was before the first play.
  function exit() { paused = true; dismissed = true; if (raf) { cancelAnimationFrame(raf); raf = 0; } try { seekTo(0); } catch (e) { console.warn('[animate] rewind on exit:', e); } updateTag(); sync(); }
  // The playhead of the timeline: where the animation of the selection is in its cycle (only while the window is open and it runs).
  function headTick() {
    headRaf = 0;
    if (!popup || !popup.el.classList.contains('show')) return;
    updatePlaybar();
    const head = popup.body.querySelector('#anim-tl-head');
    if (head) {
      const lay = headLay;
      if (lay && (lay.type === 'spin' || lay.type === 'path')) {
        head.hidden = false;
        head.style.left = (phase(lay, lay.type === 'path' && !(SHAPES[lay.p.shape] || SHAPES.circle).closed) * 100) + '%';
      } else head.hidden = true;
    }
    if (!paused && !suspended && anyAnim()) headRaf = requestAnimationFrame(headTick);
  }
  // ---- the playbar: rewind, play / pause, a scrubber over one cycle of the longest animation, the time ----
  const cycleOf = (l) => l.keys ? (l.keys.length ? l.keys[l.keys.length - 1].t : 0) : l.type === 'spin' ? 60 / Math.max(1, l.p.rpm) : l.type === 'noise' ? 10 : Math.max(0.2, +l.p.period || 1);
  let cycVer = -1, cycLen = 1;
  const cycleLength = () => { if (cycVer === ver) return cycLen; let m = 0; for (const r of items.values()) for (const l of r.layers) m = Math.max(m, cycleOf(l) + (l.keys ? 0 : (l.loop ? l.loop.delay || 0 : 0))); for (const nm of ['explode', 'camera']) if (tracks[nm] && tracks[nm].keys.length) m = Math.max(m, tracks[nm].keys[tracks[nm].keys.length - 1].t); cycVer = ver; cycLen = Math.min(60, Math.max(1, m)); return cycLen; };
  const fmtClock = (t) => { t = Math.max(0, t); const m = Math.floor(t / 60); return m + ':' + (t - m * 60).toFixed(1).padStart(4, '0'); };
  // Every animation goes to time `sec` (a new start of the playbar, or the place the scrubber is dragged to).
  function seekTo(sec) {
    clock = Math.max(0, Math.min(durOf(), sec));
    for (const rec of items.values()) for (const lay of rec.layers) lay.t = clock;
    applyScene(clock, true, false);
    applyAll();
    try { requestRender(); } catch (_) {}
    updatePlaybar();
  }
  function rewind() { seekTo(0); }
  const durOf = () => dur > 0 ? dur : Math.max(5, Math.ceil(cycleLength()));
  const PB = { frac: '', time: '', aria: '', len: '', off: null, st: '', rate: '' };
  const resetPB = () => { for (const k of Object.keys(PB)) PB[k] = k === 'off' ? null : ''; };
  function updatePlaybar() { if (!popup) return; if (popup === ui.dock) updateDockBar(); else updateMiniBar(); }
  function updateMiniBar() {
    const pb = popup.el.querySelector('#anim-pb'); if (!pb) return;
    const any = anyAnim(), len = durOf(), frac = any ? Math.min(1, clock / len) : 0;
    if (PB.off !== !any) { PB.off = !any; pb.classList.toggle('is-off', !any); }
    const f = (frac * 100).toFixed(2); if (f !== PB.frac) { PB.frac = f; pb.style.setProperty('--pb', f + '%'); }
    const tv = any ? fmtClock(Math.min(clock, len)) : '0:00.0'; if (tv !== PB.time) { PB.time = tv; const t = pb.querySelector('#anim-pb-time'); if (t) t.textContent = tv; }
    const av = any ? Math.round(frac * 100) + '|' + fmtClock(Math.min(clock, len)) + ' of ' + fmtClock(len) : 'nothing animated';
    if (av !== PB.aria) { PB.aria = av; const sc = pb.querySelector('#anim-pb-scrub'); if (sc) { sc.setAttribute('aria-valuenow', Math.round(frac * 100)); sc.setAttribute('aria-valuetext', any ? fmtClock(Math.min(clock, len)) + ' of ' + fmtClock(len) : 'nothing animated'); } }
    const st = !any ? 'off' : paused ? 'play' : 'pause';
    if (st !== PB.st) {
      PB.st = st;
      const pl = pb.querySelector('#anim-pb-play');
      if (pl) {
        pl.disabled = !any;
        pl.innerHTML = `<i data-lucide="${paused || !any ? 'play' : 'pause'}"></i>`;
        pl.setAttribute('aria-label', paused || !any ? 'Play' : 'Pause'); pl.title = !any ? 'Nothing is animated yet' : paused ? 'Play every animation (Space)' : 'Pause every animation where it is (Space)';
        try { _lucide(); } catch (_) {}
      }
      for (const b of pb.querySelectorAll('#anim-pb-rew,#anim-pb-rate')) b.disabled = !any;
    }
    const lv = any ? fmtClock(len) : ''; if (lv !== PB.len) { PB.len = lv; const le = pb.querySelector('#anim-pb-len'); if (le) le.textContent = lv; }
    const rv = (rate === 1 ? '1' : String(rate)) + '×'; if (rv !== PB.rate) { PB.rate = rv; const rb = pb.querySelector('#anim-pb-rate'); if (rb) { rb.textContent = rv; rb.title = 'Playback speed: ' + rv + ' (click for the next)'; } }
  }
  function pause() { paused = true; if (raf) { cancelAnimationFrame(raf); raf = 0; } updateTag(); sync(); }
  function play() { if (!anyAnim()) return; if (!playLoop && ((reverse ? -bounce : bounce) < 0 ? clock <= 0 : clock >= durOf())) seekTo((reverse ? -bounce : bounce) < 0 ? durOf() : 0); paused = false; dismissed = false; loop(); sync(); }

  // ---- what the selection is: the groups that are selected, else the parts ----
  function groupInfo(gid) {
    const numId = parseInt(gid, 10);
    let members = null, frame = null, label = '';
    if (!Number.isNaN(numId) && state.treeNodes) {
      const hn = state.treeNodes.find(n => n.kind === 'group' && n.id === numId);
      if (hn) { members = _treeGroupDescendants(numId); frame = hn.obj3d || null; label = hn.name || 'Group'; }
    }
    if (!members) {
      const ug = (state.userGroups || []).find(g => String(g.id) === String(gid));
      if (ug && ug.ref) { members = [...ug.partIds]; frame = ug.ref; label = ug.name || 'Group'; }
    }
    if (!members) return null;
    return { key: 'g:' + gid, kind: 'group', gid, members, frame, label };
  }
  function targets() {
    const gids = state.selectedGroupIds ? [...state.selectedGroupIds] : [];
    if (gids.length) {
      // (a group counts only while what is selected still is that group: a selection made some other way can leave an old group id behind)
      const gts = gids.map(groupInfo).filter(t => t && t.members.some(exists) && t.members.every(id => state.selected.has(id) || !exists(id)));
      if (gts.length) return gts;
    }
    return [...(state.selected || [])].map(exists).filter(Boolean).map(p => ({ key: 'p:' + p.partId, kind: 'part', partId: p.partId, p, label: p.name || ('Part ' + p.partId) }));
  }

  // Make the record of an object that is not animated yet (its start pose is taken now).
  function makeRec(t) {
    beginFrame();
    if (t.kind === 'part') {
      if (!promote(t.p)) return null;
      const { c, size } = centreOf(t.p.mesh);
      return { key: t.key, kind: 'part', label: t.label, partId: t.partId, layers: [], c, size, rests: new Map([[t.partId, restOf(t.p.mesh, t.partId)]]) };
    }
    for (const id of t.members) promote(exists(id));
    const parts = t.members.map(live).filter(p => p && !p.locked);
    if (!parts.length) return null;
    const box = new THREE.Box3();
    for (const p of parts) { const b = _partWorldBoxOwn(p.mesh); if (!b.isEmpty()) box.union(b); }
    const inv = new THREE.Matrix4().copy(FR.R).invert();
    const C = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3()).applyMatrix4(inv);
    // (the size is in the units the motion is worked out in, the root frame's: a scene scale of the file or the viewer is taken out of it)
    const sRoot = Math.cbrt(Math.abs(FR.R.determinant())) || 1;
    const size = box.isEmpty() ? 1 : Math.max(1e-6, box.getSize(new THREE.Vector3()).length() / sRoot);
    const Q = new THREE.Quaternion();
    if (t.frame) { t.frame.updateWorldMatrix(true, false); t.frame.getWorldQuaternion(Q); if (state.partsRoot) { const pq = new THREE.Quaternion(); state.partsRoot.getWorldQuaternion(pq); Q.premultiply(pq.invert()); } }
    return { key: t.key, kind: 'group', label: t.label, gid: t.gid, layers: [], members: parts.map(p => p.partId), C, Q, size, rests: new Map(parts.map(p => [p.partId, restOf(p.mesh, p.partId)])) };
  }
  // Give each of the objects a layer of this kind (it replaces one of that kind it already has). → how many, how many were locked
  function addTo(ts, type, p, loopSet) {
    let n = 0, locked = 0;
    const wasEmpty = !items.size;
    if (wasEmpty) clock = 0;
    for (const t of ts) {
      let rec = items.get(t.key);
      if (!rec) {
        if (t.kind === 'part' && t.p.locked) { locked++; continue; }
        rec = makeRec(t);
        if (!rec) { locked++; continue; }
        items.set(t.key, rec);
      }
      const lay = { id: nid(), type, p: { ...p }, loop: { ...loopSet }, t: clock };      // (a new layer starts at the time the others are at)
      let i = rec.layers.findIndex(l => l.id === selLid && l.type === type);      // (the one that is selected is the one that is replaced)
      if (i < 0) i = rec.layers.findIndex(l => l.type === type);
      if (i >= 0) { lay.t = rec.layers[i].t; lay.id = rec.layers[i].id; rec.layers[i] = lay; } else rec.layers.push(lay);
      selLid = lay.id;
      n++;
    }
    if (n && wasEmpty) { paused = true; if (raf) { cancelAnimationFrame(raf); raf = 0; } }      // (the first animation of a scene never starts by itself, even if the clock ran before the last one was removed)
    if (n) { dismissed = false; ver++; try { applyAll(); requestRender(); } catch (_) {} }      // (it does not start to play: the object shows its pose at the time the clock is at; Play is the user's)
    loop(); sync();
    if (n) commit('Animate');
    return { n, locked };
  }
  // The "Add" button: the kind and the settings that are in the window, on what is selected.
  function addLayer() {
    const ts = targets();
    if (!ts.length) { toast('Animate', 'Select a part or a group to animate first', 'warn', 3000); return; }
    const r = addTo(ts, cfg.type, cfg[cfg.type], { ...cfg.loop, delay: 0 });      // (a new clip starts at 0 s: where it goes later is the timeline's to say)
    if (!r.n && r.locked) toast('Animate', 'Those parts are locked: unlock them to animate', 'warn', 3000);
  }
  // A setting that is changed in the window changes the layer of that kind on what is selected.
  // A setting that is changed in the window changes the clips of that kind it is about: the one of each selected object, and every clip of
  // that kind that is picked on the timeline (Shift+click adds clips). With several clips only what was changed goes to all of them (the
  // axis of one, the speed of the other stay as they are when the speed is what was dragged); with one clip it is all of the settings.
  function retune() {
    const type = cfg.type, lays = new Map();
    for (const t of targets()) {
      const rec = items.get(t.key); const lay = rec && (rec.layers.find(l => l.id === selLid && l.type === type) || rec.layers.find(l => l.type === type));
      if (lay) lays.set(lay.id, lay);
    }
    if (selLids.size > 1) for (const x of clipsSelected()) if (x.lay.type === type && !KEYED.has(type)) lays.set(x.lay.id, x.lay);
    const many = lays.size > 1 && cfgSnap && cfgSnap.type === type, now = cfg[type] || {}, was = many ? cfgSnap.p : null, nowL = cfg.loop || {}, wasL = many ? cfgSnap.loop : null;
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    for (const lay of lays.values()) {
      if (many) {
        for (const k of Object.keys(now)) if (!same(now[k], was[k])) lay.p[k] = JSON.parse(JSON.stringify(now[k]));
        for (const k of Object.keys(nowL)) if (k !== 'delay' && k !== 'repeat' && !same(nowL[k], wasL[k])) lay.loop[k] = nowL[k];
      } else { lay.p = { ...now }; lay.loop = { ...nowL, delay: lay.loop.delay, repeat: lay.loop.repeat }; }      // (where a clip starts is the timeline's)
      ver++;
    }
    if (lays.size) snapCfg();
    commitSoon('Edit motion');
  }
  // (a deleted part's hidden mesh goes back to rest too, so an undo of the delete finds it there)
  function dropRec(rec) { forgetPlaced(rec); restoreLook(rec); for (const id of rec.rests.keys()) { const p = getPart(id); if (p && p.mesh) place(p.mesh, restE(id, rec)); } }
  function dropAll(recs) { beginFrame(); for (const rec of recs) dropRec(rec); }
  // Take a kind of layer (or everything) off the given keys; an object with no layer left goes back to where it started.
  function remove(keys, type) {
    for (const key of (keys || targets().map(t => t.key))) {
      const rec = items.get(key); if (!rec) continue;
      if (type) rec.layers = rec.layers.filter(l => l.type !== type);
      else rec.layers = [];
      ver++;
      if (!rec.layers.length) { items.delete(key); beginFrame(); dropRec(rec); }
      else apply(rec);
    }
    try { requestRender(); } catch (_) {}
    sync();
    commit('Remove animation');
  }
  // While a video is being made the animation is not run by the clock: each frame is put at its own time (seek), and the times that
  // were running are given back after.
  let held = null;
  function hold(on) {
    if (on) {
      if (held) return;
      held = new Map(); for (const rec of items.values()) for (const lay of rec.layers) held.set(lay, lay.t);      // (the tracks of the scene are put back by hold(false))
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      updateTag();
    } else if (held) {
      for (const [lay, t] of held) lay.t = t;
      held = null;
      applyScene(clock, true, true);
      applyAll();
      requestRender(); loop();
    }
  }
  function seek(sec) {
    for (const rec of items.values()) for (const lay of rec.layers) lay.t = sec;
    applyScene(sec, true, false);
    applyAll();
    try { state.partsRoot && state.partsRoot.updateMatrixWorld(true); } catch (_) {}
  }
  const heldNow = () => !!held;
  // The exploded view has moved the parts: the animated ones are put where their animation says (with the new offsets).
  function refresh() { if (!items.size || suspended || held) return; applyAll(); try { requestRender(); } catch (_) {} }
  // An export or a scene save sees everything where it started, and the motion goes on after it.
  function suspend() {
    if (suspended) return;
    suspended = true;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    dropAll(items.values());
    try { requestRender(); } catch (_) {}
    updateTag();
  }
  function resume() { if (!suspended) return; suspended = false; applyAll(); try { requestRender(); } catch (_) {} loop(); }
  function reset() { PLACED.clear(); for (const rec of items.values()) { try { restoreLook(rec); } catch (_) {} } items.clear(); tracks.explode = null; tracks.camera = null; selLids.clear(); selKeys.clear(); selLid = 0; base = EMPTY; clearTimeout(cTimer); cTimer = 0; ver++; clock = 0; suspended = false; paused = false; dismissed = false; if (raf) { cancelAnimationFrame(raf); raf = 0; } sync(); }
  // For the file export: step through the timeline and write down where every animated part is at each frame (its world matrix), as
  // Float32 arrays, together with where it is at rest. Parts that never move are left out. The parts go back to rest afterwards.
  // `fps` is lowered when the timeline is long or many parts move, to keep the file at a size that opens.
  function bake(fps) {
    const ids = new Set();
    for (const rec of items.values()) { if (!rec.layers.length) continue; if (rec.kind === 'part') ids.add(rec.partId); else for (const id of rec.members) ids.add(id); }
    if (!ids.size) return null;
    const D = durOf(), hold = { clock, ts: new Map() };
    for (const rec of items.values()) for (const lay of rec.layers) hold.ts.set(lay, lay.t);
    beginFrame(); dropAll(items.values());
    const meshes = [...ids].map(id => ({ id, p: live(id) })).filter(x => x.p && x.p.mesh);
    if (!meshes.length) return null;
    for (const x of meshes) { x.p.mesh.updateWorldMatrix(true, false); x.W0 = x.p.mesh.matrixWorld.clone(); }
    fps = Math.max(5, Math.min(60, Math.round(fps) || 30));
    while (fps > 5 && Math.ceil(D * fps) * meshes.length > 1.5e6) fps--;
    const n = Math.max(2, Math.floor(D * fps) + 1);
    for (const x of meshes) { x.mats = new Float32Array(16 * n); x.moves = false; }
    try {
      for (let i = 0; i < n; i++) {
        const t = Math.min(D, i / fps);
        for (const rec of items.values()) for (const lay of rec.layers) lay.t = t;
        beginFrame(); applyAll();
        for (const x of meshes) {
          x.p.mesh.updateWorldMatrix(true, false);
          const e = x.p.mesh.matrixWorld.elements, o16 = x.W0.elements;
          for (let k = 0; k < 16; k++) { const v = e[k]; x.mats[16 * i + k] = v; if (!x.moves && Math.abs(v - o16[k]) > 1e-7 * Math.max(1, Math.abs(v))) x.moves = true; }
        }
      }
    } finally {
      for (const [lay, t] of hold.ts) lay.t = t;
      clock = hold.clock; beginFrame(); dropAll(items.values());
    }
    const parts = new Map();
    for (const x of meshes) if (x.moves) parts.set(x.id, { W0: x.W0, mats: x.mats });
    return parts.size ? { fps, n, duration: (n - 1) / fps, parts } : null;
  }
  const run = async (fn) => { suspend(); try { return await fn(); } finally { resume(); } };

  // A press on a gizmo handle starts a drag of the selection: whatever is animated in it is put back first, so the drag starts from there.
  window.addEventListener('pointerdown', () => {
    if (!items.size || !state.gizmo || !state.gizmo.axis) return;
    const keys = targets().map(t => t.key).filter(k => items.has(k));
    if (keys.length) remove(keys);
  }, true);

  // ---- the window ----
  const f1 = (v) => String(Math.round(v * 10) / 10);
  function summary(lay) {
    const p = lay.p, L = lay.loop;
    if (lay.type === 'keys') return 'Pose · ' + lay.keys.length + (lay.keys.length === 1 ? ' key' : ' keys');
    if (lay.type === 'look') return 'Look · ' + lay.keys.length + (lay.keys.length === 1 ? ' key' : ' keys');
    const loopTxt = () => {
      const bits = [];
      if (L.mode !== 'loop') bits.push(L.mode === 'pingpong' ? 'ping-pong' : 'once');
      if (L.repeat > 0) bits.push('×' + L.repeat);
      if (L.delay > 0) bits.push('delay ' + f1(L.delay) + ' s');
      if (L.from !== 0 || L.to !== 100) bits.push(`points ${Math.round(L.from)}–${Math.round(L.to)}%`);
      return bits.length ? ' · ' + bits.join(' · ') : '';
    };
    switch (lay.type) {
      case 'spin':  return `Spin · ${p.axis} · ${p.dir < 0 ? 'clockwise' : 'counter-clockwise'} · ${p.rpm} rpm${loopTxt()}`;
      case 'swing': return `Swing · ${p.axis} · ±${p.amp}° · ${f1(p.period)} s`;
      case 'noise': return `Noise · ${p.type === 'random' ? 'random' : p.type === 'steps' ? 'steps' : 'wave'} · shift ${p.pos} mm ${(p.sx == null ? 'xyz' : p.sx).toUpperCase() || '–'} · turn ${p.rot}° ${(p.rx == null ? 'xyz' : p.rx).toUpperCase() || '–'} · ${f1(p.speed)}× · detail ${p.detail || 1} · seed ${p.seed}`;
      case 'oscillate': { const ax = (a, b, c) => ['X', 'Y', 'Z'].filter((_, i) => [a, b, c][i] > 0).join('') || '–'; return `Oscillate · ${p.wave} · shift ${ax(p.tx, p.ty, p.tz)} · turn ${ax(p.ax, p.ay, p.az)} · ${f1(p.period)} s`; }
      case 'path':  return `Path · ${p.shape === 'figure8' ? 'figure 8' : p.shape} · ${p.plane} · ${p.size}% · ${f1(p.period)} s${loopTxt()}`;
    }
    return lay.type;
  }
  // The short line on an animation's card: the basic values only (the whole of it is in the settings, and in summary() on the timeline)
  function brief(lay) {
    const p = lay.p;
    switch (lay.type) {
      case 'spin': return `${p.axis} · ${p.rpm} rpm`;
      case 'swing': return `${p.axis} · ±${p.amp}° · ${f1(p.period)} s`;
      case 'noise': return `${p.pos} mm · ${p.rot}° · ${f1(p.speed)}×`;
      case 'oscillate': return `${p.wave} · ${f1(p.period)} s`;
      case 'path': return `${p.shape === 'figure8' ? 'figure 8' : p.shape} · ${f1(p.period)} s`;
    }
    return summary(lay).replace(/^[A-Za-z]+ · /, '');
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const getP = (path) => { const [g, k] = path.split('.'); return cfg[g][k]; };
  const setP = (path, v) => { const [g, k] = path.split('.'); cfg[g][k] = v; };
  const fmtVal = (path, v, unit) => (path === 'loop.repeat' && !v) ? '∞' : (Number.isInteger(+v) ? String(v) : f1(+v)) + (unit || '');

  function sync(force) {
    updateTag();
    if (!popup) return;
    const q = (s) => popup.body.querySelector(s);
    popup.body.dataset.type = cfg.type;
    for (const b of popup.body.querySelectorAll('[data-type]')) if (b.tagName === 'BUTTON') b.classList.toggle('active', b.dataset.type === cfg.type);
    for (const el of popup.body.querySelectorAll('[data-for]')) el.hidden = !el.dataset.for.split(' ').includes(cfg.type);
    for (const b of popup.body.querySelectorAll('[data-set]')) b.classList.toggle('active', String(getP(b.dataset.set)) === b.dataset.val);
    for (const b of popup.body.querySelectorAll('[data-tog]')) { const on = String(getP(b.dataset.tog)).includes(b.dataset.val); b.classList.toggle('active', on); b.setAttribute('aria-pressed', on); }
    for (const el of popup.body.querySelectorAll('[data-p]')) {
      const v = getP(el.dataset.p);
      if (el.value !== String(v) && document.activeElement !== el) el.value = v;
      const lab = popup.body.querySelector(`[data-v="${el.dataset.p}"]`); if (lab) lab.textContent = fmtVal(el.dataset.p, v, lab.dataset.u || '');
    }
    // what the selection is, and its layers
    const ts = targets(), recs = ts.map(t => items.get(t.key));
    const on = recs.filter(Boolean).length, withType = recs.filter(r => r && r.layers.some(l => l.type === cfg.type)).length;
    const names = ts.length === 1 ? esc(ts[0].label) : ts.length ? `${ts.length} ${ts[0].kind === 'group' ? 'groups' : 'parts'}` : '';
    const layerTypes = Object.keys(TYPES).filter(k => recs.some(r => r && r.layers.some(l => l.type === k)));
    const selEl = q('#anim-sel');
    if (selEl) {
      const html1 = !ts.length ? '<span class="anim-none">Select a part or a group to animate it.</span>'
        : `<div class="anim-sel-n"><i data-lucide="${ts[0].kind === 'group' ? 'folder' : 'box'}"></i><b>${names}</b><span>${on ? (on === ts.length ? 'animated' : on + ' animated') : 'not animated'}</span>${popup === ui.dock ? `<div class="anim-sel-addwrap"><button type="button" class="anim-sel-add" data-cardadd aria-haspopup="menu" aria-expanded="false" title="Add an animation to ${ts.length === 1 ? 'this object' : 'these objects'}" aria-label="Add an animation"><i data-lucide="plus"></i></button><div class="adk-menu anim-sel-menu" hidden role="menu">${Object.entries(TYPES).filter(([k]) => !KEYED.has(k)).map(([k, [label, icon]]) => `<button type="button" role="menuitem" data-addtype="${k}"><i data-lucide="${icon}"></i><span>${label}</span></button>`).join('')}</div></div>` : ''}</div>` +
          (layerTypes.length ? `<div class="anim-lays">${layerTypes.map(k => {
            const have = recs.filter(r => r && r.layers.some(l => l.type === k)), lay = have[0].layers.find(l => l.type === k);
            return `<div class="anim-lay${k === cfg.type ? ' active' : ''}" data-type="${k}"><button type="button" class="anim-lay-b" data-layer="${k}" data-lid="${lay.id}" data-okey="${esc(have[0].key)}" title="Edit this animation"><i data-lucide="${TYPES[k][1]}"></i><span class="anim-lay-t"><b>${TYPES[k][0]}</b><em>${esc(brief(lay))}</em></span>${recs.length > 1 ? `<span class="anim-lay-n">${have.length}/${recs.length}</span>` : ''}</button><button type="button" class="anim-lay-x" data-rmlayer="${k}" aria-label="Remove ${TYPES[k][0]}" title="Remove it"><i data-lucide="x"></i></button></div>`;
          }).join('')}</div>` : '');
      let html2 = html1;
      if (popup === ui.dock && ts.length === 1 && recs[0]) {      // (what this object follows: any other animated object that does not follow it back)
        const me = recs[0], below = (r) => { for (let q = r, n = 0; q && n < 9; q = items.get(q.parent), n++) if (q === me) return true; return false; };
        const partsOf = (r) => r.kind === 'part' ? [r.partId] : r.members, mine = new Set(partsOf(me));      // (not one that shares a part with this object: the same mesh cannot follow itself)
        const opts = [...items.values()].filter(r => r !== me && !below(r) && !partsOf(r).some(id => mine.has(id))).map(r => `<option value="${esc(r.key)}"${me.parent === r.key ? ' selected' : ''}>${esc(r.label)}</option>`).join('');
        html2 += `<div class="anim-follow"><span class="anim-l">Follows</span><select class="mac-sel" data-follow="${esc(me.key)}" aria-label="Follows another object"><option value="">Nothing</option>${opts}</select></div>`;
      }
      const html = html2;
      if (selEl.dataset.h !== html) { selEl.dataset.h = html; selEl.innerHTML = html; try { _lucide(); } catch (_) {} }
      // In the dock, with a clip picked on the timeline, the object card and its list of layers are not needed (the timeline shows them): only that clip's settings
      const pick = selLids.size ? selLids : null;      // (a clip picked on the timeline: not the layer that was loaded when a part was selected)
      const editing = !!(popup === ui.dock && pick && recs.some(r => r && r.layers.some(l => pick.has(l.id))));
      selEl.hidden = editing;
      // The settings (axis, angle, speed, loop) belong to a clip: in the dock they are listed only while a clip is picked on the timeline.
      for (const c of popup.body.querySelectorAll('.anim-card')) c.hidden = popup === ui.dock && !editing ? true : (c.dataset.for ? !c.dataset.for.split(' ').includes(cfg.type) : false);
      { const rm = popup.el.querySelector('#anim-remove'); if (rm) { const t = editing ? 'Delete this clip' : 'Remove all'; if (rm.title !== t) { rm.title = t; rm.setAttribute('aria-label', t); } } }
      const tiles = q('.anim-types'); if (tiles) tiles.hidden = popup === ui.dock || editing;      // (the dock adds with the blue plus in its top bar, so it has no kind tiles)
      const eh = q('#anim-edit-h');      // (the title that says what kind of animation these settings are for)
      if (eh) { eh.hidden = !editing; if (editing) { const h = `<i data-lucide="${TYPES[cfg.type][1]}"></i><span>${TYPES[cfg.type][0]}${(() => { const n = selLids.size > 1 ? clipsSelected().filter(x => x.lay.type === cfg.type).length : 0; return n > 1 ? ' · ' + n + ' clips' : ''; })()}</span>`; if (eh.dataset.h !== h) { eh.dataset.h = h; eh.innerHTML = h; try { _lucide(); } catch (_) {} } } }      // (and the kind tiles: the clip's own settings are all that is listed)
    }
    updatePlaybar();
    if (popup === ui.dock) renderKeyPanel();
    const add = popup.el.querySelector('#anim-add'), rmAll = popup.el.querySelector('#anim-remove');
    if (add) { const lbl = withType ? `Apply ${TYPES[cfg.type][0]} again` : `Add ${TYPES[cfg.type][0]}`; add.disabled = !ts.length; add.title = withType ? 'Restart this animation on the selection' : lbl; add.setAttribute('aria-label', lbl); }      // (a round plus: the words are its tooltip)
    if (rmAll) rmAll.disabled = !on;
    { const hb = popup.el.querySelector('#adk-add'), hm = popup.el.querySelector('#adk-addmore'); if (hb) { hb.disabled = hm.disabled = !ts.length; hb.title = ts.length ? `Add ${TYPES[cfg.type][0]} to the selection` : 'Select a part or a group first'; } }
    // the loop points on the timeline, and the playhead on the layer of this kind that the selection has
    const tr = q('#anim-tl-track');
    if (tr) {
      const lo = Math.min(cfg.loop.from, cfg.loop.to), hi = Math.max(cfg.loop.from, cfg.loop.to);
      tr.style.setProperty('--f', lo + '%'); tr.style.setProperty('--t', hi + '%');
      const fe = q('#anim-tl-f'), te = q('#anim-tl-t'); if (fe) fe.textContent = Math.round(lo) + '%'; if (te) te.textContent = Math.round(hi) + '%';
      for (const h of tr.querySelectorAll('.anim-tl-h')) { const v = Math.round(h.dataset.h === 'from' ? lo : hi); h.style.left = v + '%'; h.setAttribute('aria-valuenow', v); }
      const rec = recs.find(r => r && r.layers.some(l => l.type === cfg.type));
      headLay = rec ? rec.layers.find(l => l.type === cfg.type) : null;
    }
    // the frame loop that moves the playbar's scrubber and time while it plays (it also moves the loop strip's playhead when there is one)
    if (!headRaf) headRaf = requestAnimationFrame(headTick);
    // every animated object in the scene, with all its properties
    const listSigNow = ver + '#' + ts.map(t => t.key).join(',') + (paused ? '|paused' : '') + '|' + items.size + '|' + cfg.type;
    if (force || listSigNow !== listSig) {
      listSig = listSigNow;
      if (popup === ui.dock) renderRows();
      const box = q('#anim-list'), cnt = q('#anim-count');
      if (cnt) cnt.textContent = items.size ? String(items.size) + (paused ? ' · paused' : '') : '';
      if (box) {
        const selKeys = new Set(ts.map(t => t.key));
        box.innerHTML = items.size ? [...items.values()].map(r => `
          <div class="anim-item${selKeys.has(r.key) ? ' is-sel' : ''}" data-key="${esc(r.key)}">
            <button type="button" class="anim-item-b" data-pick="${esc(r.key)}" title="Select it">
              <span class="anim-item-n"><i data-lucide="${r.kind === 'group' ? 'folder' : 'box'}"></i>${esc(r.label)}${r.kind === 'group' ? `<em>${r.members.length} parts</em>` : ''}</span>
              ${r.layers.map(l => `<span class="anim-ln"><i data-lucide="${TYPES[l.type][1]}"></i>${esc(brief(l))}<b>${TYPES[l.type][0]}</b></span>`).join('')}
            </button>
            <button type="button" class="anim-x" data-rmkey="${esc(r.key)}" aria-label="Remove its animation"><i data-lucide="trash-2"></i></button>
          </div>`).join('') : '<div class="anim-none">Nothing is animated in this scene.</div>';
        try { _lucide(); } catch (_) {}
      }
    }
  }
  // The window follows the selection: an object that has animation shows its settings.
  // a number for the selection that is cheap to work out (no list is made), to see that it has changed
  const selKey = () => { let h = (state.selected ? state.selected.size : 0) * 7919; if (state.selected) for (const id of state.selected) h = (h * 31 + id) | 0; const g = state.selectedGroupIds; let k = ''; if (g && g.size) for (const x of g) k += x + ','; return h + '|' + k; };
  // Names follow the scene: a part or group renamed in the tree is renamed in the timeline's list too.
  function refreshLabels() {
    let changed = false;
    for (const r of items.values()) {
      let nm = null;
      try { if (r.kind === 'part') { const p = exists(r.partId); nm = p ? (p.name || ('Part ' + p.partId)) : null; } else { const g = groupInfo(String(r.gid)); nm = g ? g.label : null; } } catch (_) {}
      if (nm && nm !== r.label) { r.label = nm; changed = true; }
    }
    return changed;
  }
  function follow() {
    const key = selKey();
    if (refreshLabels()) { listSig = ''; renderRows(); sync(true); }
    if (key !== sig) {
      sig = key;
      for (const t of targets()) { const r = items.get(t.key); if (r && r.layers.length) { load(r.layers.find(l => l.type === cfg.type) || r.layers[0]); break; } }
      sync();
    }
  }
  let cfgSnap = null;      // (the settings as they were loaded or last applied: an edit of several clips changes only what differs from it)
  const snapCfg = () => { cfgSnap = { type: cfg.type, p: JSON.parse(JSON.stringify(cfg[cfg.type] || {})), loop: JSON.parse(JSON.stringify(cfg.loop || {})) }; };
  function load(lay) { selLid = lay.id; if (KEYED.has(lay.type)) return; cfg.type = lay.type; cfg[lay.type] = { ...lay.p }; cfg.loop = { ...lay.loop }; snapCfg(); }
  function pick(key) {                                  // select what a row of the list is about
    const rec = items.get(key); if (!rec) return;
    if (rec.kind === 'part') { try { selectPart(rec.partId, 'single'); } catch (_) {} }
    else {
      // The row of a group in the tree may not be drawn (folded away, or out of view), so the selection is made here, as a click on the row does it.
      const gid = String(rec.gid), gi = groupInfo(gid), ids = gi ? gi.members : rec.members;
      state.selected.clear();
      for (const id of ids) { const p = getPart(id); if (p && !p.deleted) state.selected.add(id); }
      state.selectedGroupIds.clear(); state.selectedGroupIds.add(gid);
      try { applySelectionColors(); rebuildTreeSelectionOnly(); refreshPropertiesPanel(); updateGizmo(); } catch (_) {}
      try { const c = document.getElementById('del-sel-count'); if (c) c.textContent = state.selected.size; } catch (_) {}
      try { revealSelectedInTree(); } catch (_) {}
      requestRender();
    }
    sig = ''; follow();
  }
  function bodyMarkup(withList) {
    const seg = (set, list) => `<div class="cmd-seg">${list.map(([v, label, icon]) => `<button type="button" data-set="${set}" data-val="${v}">${icon ? `<i data-lucide="${icon}"></i>` : ''}${label}</button>`).join('')}</div>`;
    const rng = (path, label, min, max, step, unit) => `<div class="anim-row"><span class="anim-l">${label}</span><div class="anim-speed"><input type="range" class="range-bar" data-p="${path}" min="${min}" max="${max}" step="${step}" value="${getP(path)}" aria-label="${label}"><span class="anim-v" data-v="${path}" data-u="${unit || ''}"></span></div></div>`;
    const tog = (path) => `<div class="anim-togs">${['x', 'y', 'z'].map(c => `<button type="button" class="anim-tog" data-tog="${path}" data-val="${c}">${c.toUpperCase()}</button>`).join('')}</div>`;
    // three sliders in one row (X, Y, Z), each with its value under it
    const xyz = (keys, min, max, unit) => `<div class="anim-xyz">${['X', 'Y', 'Z'].map((c, i) => `<div class="anim-xyz-c"><span class="anim-l">${c}</span><input type="range" class="range-bar" data-p="${keys[i]}" min="${min}" max="${max}" step="1" value="${getP(keys[i])}" aria-label="${c}"><span class="anim-v" data-v="${keys[i]}" data-u="${unit}"></span></div>`).join('')}</div>`;
    const axisRow = (g) => `<div class="anim-row anim-row-bare" role="group" aria-label="Axis"><span class="anim-l">Axis</span>${seg(g + '.axis', [['X', 'X'], ['Y', 'Y'], ['Z', 'Z']])}</div>`;
    const bodyHtml = `
      <div class="anim-sel" id="anim-sel"></div>
      <div class="anim-edit-h" id="anim-edit-h" hidden></div>
      <div class="anim-types" role="tablist" aria-label="Kind of animation">${Object.entries(TYPES).filter(([k]) => !KEYED.has(k)).map(([k, [label, icon]]) => `<button type="button" role="tab" data-type="${k}"><i data-lucide="${icon}"></i><span>${label}</span></button>`).join('')}</div>
      <div class="anim-card">
        <div class="anim-props" data-for="spin">${axisRow('spin')}
          <div class="anim-row anim-row-bare" role="group" aria-label="Direction"><span class="anim-l">Direction</span>${seg('spin.dir', [['-1', 'Clockwise', 'rotate-cw'], ['1', 'Counter', 'rotate-ccw']])}</div>
          ${rng('spin.rpm', 'Speed', 1, 600, 1, ' rpm')}</div>
        <div class="anim-props" data-for="swing">${axisRow('swing')}
          ${rng('swing.amp', 'Angle', 1, 180, 1, '°')}${rng('swing.period', 'Time', 0.2, 20, 0.1, ' s')}</div>
        <div class="anim-props" data-for="noise">
          <div class="anim-row"><span class="anim-l">Type</span><select class="mac-sel" data-p="noise.type" aria-label="Kind of noise"><option value="wave">Wave</option><option value="random">Smooth random</option><option value="steps">Steps</option></select></div>
          <div class="anim-sub">Amplitude</div>
          ${rng('noise.pos', 'Position', 0, 200, 0.5, ' mm')}<div class="anim-row"><span class="anim-l">Axes</span>${tog('noise.sx')}</div>
          ${rng('noise.rot', 'Rotation', 0, 90, 1, '°')}<div class="anim-row"><span class="anim-l">Axes</span>${tog('noise.rx')}</div>
          <div class="anim-sub">Character</div>
          ${rng('noise.speed', 'Frequency', 0.1, 5, 0.1, '×')}${rng('noise.detail', 'Detail', 1, 4, 1, '')}${rng('noise.rough', 'Roughness', 0, 100, 1, '%')}
          <div class="anim-row"><span class="anim-l">Seed</span><div class="anim-speed"><input type="range" class="range-bar" data-p="noise.seed" min="1" max="99" step="1" value="${getP('noise.seed')}" aria-label="Seed"><span class="anim-v" data-v="noise.seed" data-u=""></span><button type="button" class="anim-dice" data-act="reseed" aria-label="New random seed" title="New random seed"><i data-lucide="dices"></i></button></div></div></div>
        <div class="anim-props" data-for="oscillate">
          <div class="anim-row"><span class="anim-l">Wave</span><select class="mac-sel" data-p="oscillate.wave" aria-label="Wave"><option value="sine">Sine</option><option value="piston">Piston (crank and rod)</option><option value="eased">Eased</option><option value="triangle">Triangle</option></select></div>
          <div class="anim-sub">Shift (% of the size)</div>
          ${xyz(['oscillate.tx', 'oscillate.ty', 'oscillate.tz'], 0, 500, ' mm')}
          <div class="anim-sub">Turn (degrees each way)</div>
          ${xyz(['oscillate.ax', 'oscillate.ay', 'oscillate.az'], 0, 180, '°')}
          <div class="anim-sub">Timing</div>
          ${rng('oscillate.period', 'Time', 0.2, 20, 0.1, ' s')}${rng('oscillate.spread', 'Axis lag', 0, 360, 5, '°')}${rng('oscillate.lag', 'Turn lag', 0, 360, 5, '°')}${rng('oscillate.ratio', 'Rod ratio', 1.5, 8, 0.1, '')}</div>
        <div class="anim-props" data-for="path">
          <div class="anim-row"><span class="anim-l">Shape</span><select class="mac-sel" data-p="path.shape" aria-label="Shape of the path"><option value="circle">Circle</option><option value="figure8">Figure of eight</option><option value="square">Rounded square</option><option value="wave">Wave</option><option value="line">Line</option></select></div>
          <div class="anim-row anim-row-bare" role="group" aria-label="Plane"><span class="anim-l">Plane</span>${seg('path.plane', [['XY', 'XY'], ['XZ', 'XZ'], ['YZ', 'YZ']])}</div>
          ${rng('path.size', 'Size', 5, 1000, 1, ' mm')}${rng('path.period', 'Time', 0.5, 60, 0.5, ' s')}</div>
      </div>
      <div class="anim-card" data-for="spin path">
        <div class="anim-row anim-row-bare" role="group" aria-label="Loop"><span class="anim-l">Loop</span>${seg('loop.mode', [['loop', 'Loop'], ['pingpong', 'Ping-pong'], ['once', 'Once']])}</div>
      </div>
      ${withList ? '<div class="anim-h">In the scene <span id="anim-count" class="anim-badge"></span></div><div class="anim-list" id="anim-list"></div>' : ''}`;
    return bodyHtml;
  }
  const footMarkup = '<button class="cq-btn cq-danger" id="anim-remove" type="button" title="Remove all" aria-label="Remove all"><i data-lucide="trash-2"></i></button><span class="cq-gap"></span><button class="cq-btn cq-primary" id="anim-add" type="button" title="Add" aria-label="Add"><i data-lucide="plus"></i></button>';
  function buildMini() {
    if (ui.mini) return ui.mini;
    const bodyHtml = bodyMarkup(true);
    const footHtml = `<button class="cq-btn cq-danger" id="anim-remove" type="button" title="Remove all" aria-label="Remove all"><i data-lucide="trash-2"></i></button><span class="cq-gap"></span><button class="cq-btn cq-primary" id="anim-add" type="button" title="Add" aria-label="Add"><i data-lucide="plus"></i></button>`;
    const fresh = (() => { try { return !localStorage.getItem('_dlg-pos:_anim-dialog'); } catch (_) { return true; } })();      // (blocked storage: Animate still opens)
    popup = app._DraggablePopup.create({ id: '_anim-dialog', title: 'Animate', subtitle: '', iconName: '', width: 360, height: 700, minWidth: 320, minHeight: 420, bodyHtml, footHtml, bodyScroll: true,
      onClose: () => { if (!switching) leave(); } });
    popup.foot.classList.add('anim-foot');
    popup.titleEl.insertAdjacentHTML('afterend', '<span class="anim-alpha" title="Alpha: Animate is a very early feature and can change">Alpha</span>');
    // the playbar, always in view under the title bar
    const bar = document.createElement('div');
    bar.id = 'anim-pb'; bar.className = 'anim-pb is-off';
    bar.innerHTML = `
      <div class="anim-pb-tr">
        <button type="button" class="anim-pb-b" id="anim-pb-rew" aria-label="Back to the start" title="Back to the start"><i data-lucide="skip-back"></i></button>
        <button type="button" class="anim-pb-play" id="anim-pb-play" aria-label="Play"><i data-lucide="play"></i></button>
      </div>
      <div class="anim-pb-tc" title="Time"><span id="anim-pb-time">0:00.0</span></div>
      <div class="anim-pb-scrub" id="anim-pb-scrub" role="slider" tabindex="0" aria-label="Playback position" aria-valuemin="0" aria-valuemax="100"><div class="anim-pb-track"><div class="anim-pb-fill"></div></div><div class="anim-pb-knob"></div></div>
      <span class="anim-pb-len" id="anim-pb-len" title="Length of the cycle"></span>
      <button type="button" class="anim-pb-rate" id="anim-pb-rate" aria-label="Playback speed">1×</button>`;
    popup.el.querySelector('.dlg-head').after(bar);
    bar.addEventListener('click', (e) => {
      if (e.target.closest('#anim-pb-rew')) { rewind(); return; }
      if (e.target.closest('#anim-pb-rate')) { const R = [0.25, 0.5, 1, 2, 4]; rate = R[(R.indexOf(rate) + 1) % R.length]; updatePlaybar(); return; }
      if (e.target.closest('#anim-pb-play')) { if (paused) play(); else pause(); }
    });
    // the scrubber: dragging pauses and puts everything at that time of the cycle; letting go plays on if it was playing
    const sc = bar.querySelector('#anim-pb-scrub');
    let scrub = null;
    const at = (e) => { const r = sc.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width))) * durOf(); };
    sc.addEventListener('pointerdown', (e) => { if (!items.size) return; scrub = { was: !paused }; if (scrub.was) { paused = true; if (raf) { cancelAnimationFrame(raf); raf = 0; } updateTag(); } try { sc.setPointerCapture(e.pointerId); } catch (_) {} seekTo(at(e)); e.preventDefault(); });
    sc.addEventListener('pointermove', (e) => { if (scrub) seekTo(at(e)); });
    for (const t of ['pointerup', 'pointercancel']) sc.addEventListener(t, () => { if (!scrub) return; const was = scrub.was; scrub = null; if (was) play(); });
    sc.addEventListener('keydown', (e) => {
      if (!items.size) return;
      const d = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
      if (!d) return;
      e.preventDefault(); seekTo(clock + d * (e.shiftKey ? 5 : 0.5));
    });
    popup.el.addEventListener('keydown', (e) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.target.closest('input,select,textarea,button,[role="slider"],[contenteditable]')) return;
      if (e.key === ' ' && items.size) { e.preventDefault(); if (paused) play(); else pause(); }
      else if (e.key === 'Home' && items.size) { e.preventDefault(); rewind(); }
    });
    if (fresh) { popup.card.style.left = Math.max(8, window.innerWidth - 360 - 24) + 'px'; popup.card.style.top = '64px'; }
    { // a button next to the close button: back to the timeline along the bottom
      const x = popup.el.querySelector('.dlg-head .dlg-x');
      if (x) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = x.className; b.title = 'Dock the timeline along the bottom'; b.setAttribute('aria-label', b.title);
        b.innerHTML = '<i data-lucide="panel-bottom"></i>';
        b.addEventListener('click', (e) => { e.stopPropagation(); toDock(); });
        x.parentNode.insertBefore(b, x);
      }
    }
    wireInspector(popup.body, popup.el);
    ui.mini = popup;
    return popup;
  }
  // The settings of a motion (the kinds, the cards, Add and Remove all): the same in the small window and in the dock.
  function wireInspector(body, root) {
    body.addEventListener('click', (e) => {
      const tg = e.target.closest('[data-tog]'), rs = e.target.closest('[data-act="reseed"]');
      if (tg) { const cur = String(getP(tg.dataset.tog)), v = tg.dataset.val; setP(tg.dataset.tog, ['x', 'y', 'z'].filter(c => c === v ? !cur.includes(c) : cur.includes(c)).join('')); save(); retune(); sync(); return; }
      if (rs) { cfg.noise.seed = 1 + Math.floor(Math.random() * 99); save(); retune(); sync(); return; }
      const ty = e.target.closest('button[data-type]'), st = e.target.closest('[data-set]'), ly = e.target.closest('[data-layer]'), rl = e.target.closest('[data-rmlayer]'),
        pk = e.target.closest('[data-pick]'), rk = e.target.closest('[data-rmkey]');
      // the plus on the object's card: a menu of every kind, the one picked is added to this object (and becomes the chosen kind)
      const ca = e.target.closest('[data-cardadd]'), cm = e.target.closest('.anim-sel-menu [data-addtype]');
      if (ca) {
        const m = ca.parentElement.querySelector('.anim-sel-menu'); if (!m) return;
        if (!m.hidden) { m.hidden = true; ca.setAttribute('aria-expanded', 'false'); return; }
        m.hidden = false; ca.setAttribute('aria-expanded', 'true');
        // (fixed, so that the scrolling body of the window does not cut it off; the dock is moved by a transform, which makes fixed
        // relative to the dock: the origin is read from where the menu lands at 0, 0 and taken off)
        const r = ca.getBoundingClientRect(), mh = m.offsetHeight, mw = m.offsetWidth;
        m.style.position = 'fixed'; m.style.right = 'auto'; m.style.bottom = 'auto'; m.style.left = '0px'; m.style.top = '0px';
        const o = m.getBoundingClientRect();
        const up = r.bottom + 6 + mh > window.innerHeight && r.top - 6 - mh > 0;
        m.style.left = Math.max(4 - o.left, r.right - mw - o.left) + 'px';
        m.style.top = ((up ? r.top - 6 - mh : r.bottom + 6) - o.top) + 'px';
        return;
      }
      if (cm) { const m = cm.closest('.anim-sel-menu'); m.hidden = true; m.parentElement.querySelector('[data-cardadd]')?.setAttribute('aria-expanded', 'false'); cfg.type = cm.dataset.addtype; save(); sync(); addLayer(); return; }
      if (ty) { cfg.type = ty.dataset.type; save(); sync(); return; }
      if (ly && popup === ui.dock && ly.dataset.lid) { selectLayer(ly.dataset.okey, +ly.dataset.lid, false); return; }      // (in the dock the list of an object's animations picks the clip on the timeline)
      if (ly) { const rec = targets().map(t => items.get(t.key)).find(r => r && r.layers.some(l => l.type === ly.dataset.layer)); if (rec) load(rec.layers.find(l => l.type === ly.dataset.layer)); save(); sync(); return; }
      if (rl) { remove(targets().map(t => t.key), rl.dataset.rmlayer); return; }
      if (rk) { remove([rk.dataset.rmkey]); return; }
      if (pk) { pick(pk.dataset.pick); return; }
      if (st) { const v = st.dataset.val; setP(st.dataset.set, st.dataset.set === 'spin.dir' ? +v : v); save(); retune(); sync(); }
    });
    const closeCardMenu = () => { for (const m of body.querySelectorAll('.anim-sel-menu:not([hidden])')) { m.hidden = true; m.parentElement.querySelector('[data-cardadd]')?.setAttribute('aria-expanded', 'false'); } };
    (root || body).addEventListener('pointerdown', (e) => { if (!e.target.closest('.anim-sel-addwrap')) closeCardMenu(); }, true);
    (root || body).addEventListener('keydown', (e) => { if (e.key === 'Escape' && body.querySelector('.anim-sel-menu:not([hidden])')) { closeCardMenu(); e.stopPropagation(); } }, true);
    body.addEventListener('change', (e) => {      // Follows: what this object moves along with
      const f = e.target.closest('[data-follow]'); if (!f) return;
      const rec = items.get(f.dataset.follow); if (!rec) return;
      rec.parent = f.value || null; ver++; applyAll(); try { requestRender(); } catch (_) {} sync(true); commit('Follow');
    });
    body.addEventListener('input', (e) => {
      const el = e.target.closest('[data-p]'); if (!el) return;
      const path = el.dataset.p, k = path.split('.')[1];
      if (el.type === 'range' || el.type === 'number') { const v = clampKey(k, el.value); if (v == null) return; setP(path, v); }
      else setP(path, el.value);
      if (path === 'loop.from' && cfg.loop.from > cfg.loop.to) cfg.loop.to = cfg.loop.from;
      if (path === 'loop.to' && cfg.loop.to < cfg.loop.from) cfg.loop.from = cfg.loop.to;
      save(); retune(); sync();
    });
    cfg.loop.from = 0; cfg.loop.to = 100; cfg.loop.delay = 0;      // (the loop points have no controls any more: a loop is the whole length, shortened by dragging the clip on the timeline)
    root.querySelector('#anim-add')?.addEventListener('click', () => addLayer());
    root.querySelector('#anim-remove').addEventListener('click', () => {
      // In the dock, with a clip (or a key) picked on the timeline, the trash deletes just that; otherwise it takes the animation off the selected objects
      const clipPicked = popup === ui.dock && (selKeys.size || (selLids.size && targets().some(t => { const r = items.get(t.key); return r && r.layers.some(l => selLids.has(l.id)); })));
      if (clipPicked) deleteSelection(); else remove();
    });
  }
  // ---- undo, and the whole animation as plain data (for Undo, for the scene file) ----
  // jsonRep leaves out what is only a cache or only a clock: the curve a path draws, and the time a layer is at (not a key's time).
  const jsonRep = function (k, v) {
    if (k && k[0] === '_') return undefined;
    if (k === 'axisVec') return undefined;
    if (k === 't' && this && this.type) return undefined;
    return v;
  };
  const EMPTY = JSON.stringify({ recs: [], tracks: { explode: null, camera: null } });
  // A part is found again by its id, then by its uid, then as the nth of the parts with its name: with several "Screw M6" the
  // first of them used to get the animation of whichever one was animated.
  const labelOf = (x) => x.name || ('Part ' + x.partId);
  const nthOf = (pid, label) => { let i = 0; for (const x of state.parts || []) { if (x.deleted || labelOf(x) !== label) continue; if (x.partId === pid) return i; i++; } return undefined; };
  const recData = (r) => ({ key: r.key, kind: r.kind, label: r.label, pid: r.partId, gid: r.gid, parent: r.parent || undefined, layers: r.layers,
    uid: r.kind === 'part' ? ((getPart(r.partId) || {}).uid || undefined) : undefined, nth: r.kind === 'part' ? nthOf(r.partId, r.label) : undefined });
  const snapStr = () => JSON.stringify({ recs: [...items.values()].map(recData), tracks }, jsonRep);
  let base = EMPTY, restoring = false, cTimer = 0;
  // Everything that changes the animation ends in commit(): the change since the last one becomes a step of Undo.
  function commit(label) {
    if (restoring) return;
    clearTimeout(cTimer); cTimer = 0;
    const now = snapStr();
    if (now === base) return;
    const op = { type: 'anim', label: label || 'Animate', before: base, after: now };
    base = now;
    try { pushUndo(op); } catch (_) {}
  }
  // …and a slider that is being dragged makes one step, not hundreds
  function commitSoon(label) { clearTimeout(cTimer); cTimer = setTimeout(() => commit(label), 450); }
  function targetOf(r) {
    if (String(r.key).startsWith('g:')) {
      const g = groupInfo(String(r.key).slice(2));
      if (g && (!r.label || g.label === r.label)) return g;
      for (const n of (state.treeNodes || [])) if (n.kind === 'group' && n.name === r.label) { const gi = groupInfo(String(n.id)); if (gi) return gi; }
      for (const ug of (state.userGroups || [])) if (ug && ug.name === r.label) { const gi = groupInfo(String(ug.id)); if (gi) return gi; }
      return g || null;
    }
    const id = r.pid != null ? r.pid : parseInt(String(r.key).slice(2), 10);
    let p = exists(id);
    if (!p || (r.label && labelOf(p) !== r.label)) {
      const same = (state.parts || []).filter(x => !x.deleted && labelOf(x) === r.label && exists(x.partId));
      const q = (r.uid && same.find(x => x.uid === r.uid)) || (Number.isInteger(r.nth) && same[r.nth]) || same[0];
      if (q) p = q;
    }
    return p ? { key: 'p:' + p.partId, kind: 'part', partId: p.partId, p, label: p.name || ('Part ' + p.partId) } : null;
  }
  const withIds = (layers) => (layers || []).map(l => {
    const o = { ...l, id: nid(), t: clock };
    if (Array.isArray(l.keys)) o.keys = l.keys.map(k => ({ ...k, id: nid(), v: { ...k.v } }));
    return o;
  });
  // Put the animation as `snap` says (an older or newer step of Undo).
  function restoreSnap(snap) {
    restoring = true;
    try {
      const want = new Map((snap.recs || []).map(r => [r.key, r]));
      for (const [key, rec] of [...items]) if (!want.has(key)) { beginFrame(); dropRec(rec); items.delete(key); }
      for (const r of (snap.recs || [])) {
        let rec = items.get(r.key);
        if (!rec) { const t = targetOf(r); rec = t && makeRec(t); if (!rec) continue; items.set(rec.key, rec); }
        rec.layers = (r.layers || []).map(l => ({ ...l, t: clock }));
        if (!rec.layers.length) { beginFrame(); dropRec(rec); items.delete(rec.key); }
      }
      for (const r of (snap.recs || [])) { const rec = items.get(r.key); if (rec) rec.parent = r.parent && items.has(r.parent) ? r.parent : null; }
      tracks.explode = (snap.tracks && snap.tracks.explode) || null;
      tracks.camera = (snap.tracks && snap.tracks.camera) || null;
      selLids.clear(); selKeys.clear(); selLid = 0;
      ver++; applyAll(); applyScene(clock, true, true);
    } finally { restoring = false; }
    try { requestRender(); } catch (_) {}
    sync(true);
  }
  // The scene file: what is animated is found again by its name (the ids of parts can change when a file is opened).
  function serialize() {
    if (!items.size && !sceneN()) return undefined;
    return JSON.parse(JSON.stringify({ v: 2, dur, recs: [...items.values()].map(recData), tracks }, jsonRep));
  }
  // A layer saved when positions were a % of the object's size (its box diagonal, rec.size): turned into mm, once.
  function legacyMm(l, size) {
    const k = (Number.isFinite(size) && size > 0 ? size : 1) / 100, p = l.p;
    if (l.type === 'noise' && p) p.pos = Math.round(p.pos * k * 100) / 100;
    else if (l.type === 'path' && p) p.size = Math.round(p.size * k * 100) / 100;
    else if (l.type === 'oscillate' && p) for (const c of ['tx', 'ty', 'tz']) p[c] = Math.round(p[c] * k * 100) / 100;
    else if (l.type === 'keys' && Array.isArray(l.keys)) for (const key of l.keys) if (key.v) for (const c of ['mx', 'my', 'mz']) if (typeof key.v[c] === 'number') key.v[c] = Math.round(key.v[c] * k * 100) / 100;
  }
  function deserialize(data) {
    if (!data || !Array.isArray(data.recs)) return 0;
    reset();
    if (data.dur > 0) dur = Math.min(600, +data.dur); else dur = 0;
    let n = 0; const keyMap = new Map();
    for (const r of data.recs) {
      const t = targetOf(r); const rec = t && makeRec(t); if (!rec || items.has(rec.key)) continue;
      rec.layers = withIds(r.layers); items.set(rec.key, rec); keyMap.set(r.key, rec.key); n++;
      if (!(data.v >= 2)) for (const l of rec.layers) legacyMm(l, rec.size);      // (a file from before positions were in mm)
    }
    for (const r of data.recs) { const rec = items.get(keyMap.get(r.key)); const pk = r.parent && keyMap.get(r.parent); if (rec) rec.parent = pk && pk !== rec.key ? pk : null; }
    for (const nm of ['explode', 'camera']) { const tr = data.tracks && data.tracks[nm]; tracks[nm] = tr && Array.isArray(tr.keys) && tr.keys.length ? { keys: tr.keys.map(k => ({ ...k, id: nid(), v: { ...k.v } })), muted: !!tr.muted } : null; }
    ver++; clock = 0; paused = true; dismissed = true;
    beginFrame(); applyAll(); applyScene(0, true, true);
    base = snapStr();
    try { requestRender(); } catch (_) {}
    sync(true);
    return n;
  }
  _UndoOps.register('anim', {
    undo(op) { clearTimeout(cTimer); cTimer = 0; restoreSnap(JSON.parse(op.before)); base = op.before; state.redo.push(op); _finalizeUndo(); },
    redo(op) { clearTimeout(cTimer); cTimer = 0; restoreSnap(JSON.parse(op.after)); base = op.after; state.history.push(op); _finalizeUndo(); },
  });

  // ---- keys, clips: making, finding, cutting ----
  const $id = (i) => document.getElementById(i);
  const FRAME_SNAP = (t) => Math.round(t / FRAME) * FRAME;
  const FINE = 0.1;      // Alt held while dragging: the pointer counts a tenth
  const sortKeys = (list) => list.sort((a, b) => a.t - b.t);
  function putKey(list, t, v, e) {      // a key at a time (one that is there already is replaced)
    t = Math.max(0, Math.round(t * 1000) / 1000);
    let k = list.find(x => Math.abs(x.t - t) < 0.0005);
    if (k) k.v = v; else { k = { id: nid(), t, v, e: e || 'ease' }; list.push(k); sortKeys(list); }
    return k;
  }
  const POSE0 = () => ({ mx: 0, my: 0, mz: 0, rx: 0, ry: 0, rz: 0 });
  const LOOK0 = () => ({ o: 1, tm: 0, c: '#4f9dff' });
  const valueNow = (lay, t) => { const v = lay.keys.length ? keyEval(lay.keys, t, lay.type === 'look' ? mixLook : mixNum) : null; return v ? { ...v } : (lay.type === 'look' ? LOOK0() : POSE0()); };
  const explodeNow = () => { const e = state.explode || {}; return { x: +e.x || 0, y: +e.y || 0, z: +e.z || 0 }; };
  const camNow = () => ({ px: app.camera.position.x, py: app.camera.position.y, pz: app.camera.position.z, tx: app.controls.target.x, ty: app.controls.target.y, tz: app.controls.target.z, fov: app.camera.fov || 45 });
  function locateKey(id) {
    for (const rec of items.values()) for (const lay of rec.layers) if (lay.keys) { const k = lay.keys.find(x => x.id === id); if (k) return { rec, lay, key: k, kind: lay.type === 'look' ? 'look' : 'pose', list: lay.keys }; }
    for (const nm of ['explode', 'camera']) { const tr = tracks[nm]; if (tr) { const k = tr.keys.find(x => x.id === id); if (k) return { track: tr, name: nm, key: k, kind: nm, list: tr.keys }; } }
    return null;
  }
  const newKeyLayer = (type) => ({ id: nid(), type, p: {}, loop: { ...DEFAULTS.loop }, t: clock, keys: [] });
  // A key at the playhead on what is selected: a pose (move and turn) or a look (see-through and tint). Its value is what the object has there now.
  function addObjectKey(type) {
    const ts = targets();
    if (!ts.length) { toast('Animate', 'Select a part or a group first', 'warn', 3000); return; }
    if (!items.size && !sceneN()) clock = 0;
    let last = null, locked = 0;
    for (const t of ts) {
      let rec = items.get(t.key);
      if (!rec) {
        if (t.kind === 'part' && t.p.locked) { locked++; continue; }
        rec = makeRec(t); if (!rec) { locked++; continue; }
        items.set(t.key, rec);
      }
      let lay = rec.layers.find(l => l.type === type);
      if (!lay) { lay = newKeyLayer(type); rec.layers.push(lay); }
      last = putKey(lay.keys, clock, valueNow(lay, clock));
      selLid = lay.id; selLids.clear(); selLids.add(lay.id);
    }
    if (!last) { if (locked) toast('Animate', 'Those parts are locked: unlock them to animate', 'warn', 3000); return; }
    selKeys.clear(); selKeys.add(last.id);
    dismissed = false; ver++; applyAll(); try { requestRender(); } catch (_) {}
    sync(true); commit('Add key');
  }
  function addSceneKey(nm, at) {
    if (nm === 'camera' && !(app.camera && app.controls)) return;
    const tr = tracks[nm] || (tracks[nm] = { keys: [], muted: false });
    const t = at == null ? clock : at;
    const v = at != null && tr.keys.length ? { ...keyEval(tr.keys, t, nm === 'camera' ? mixCam : mixNum) } : (nm === 'camera' ? camNow() : explodeNow());
    const k = putKey(tr.keys, t, v);
    selKeys.clear(); selKeys.add(k.id); selLids.clear();
    dismissed = false; ver++; sync(true); commit('Add key');
  }
  // a double-click on the lane of a row with keys: a key there
  function addKeyAt(row, t) {
    t = Math.max(0, Math.min(durOf(), FRAME_SNAP(t)));
    if (row.dataset.scene) { addSceneKey(row.dataset.scene, t); return; }
    const rec = items.get(row.dataset.key), lay = rec && rec.layers.find(l => l.id === +row.dataset.lid);
    if (!lay || !lay.keys) return;
    const k = putKey(lay.keys, t, valueNow(lay, t));
    selLid = lay.id; selLids.clear(); selLids.add(lay.id); selKeys.clear(); selKeys.add(k.id);
    ver++; applyAll(); sync(true); commit('Add key');
  }
  function deleteSelection() {
    let n = 0;
    if (selKeys.size) {
      for (const id of [...selKeys]) {
        const loc = locateKey(id); if (!loc) continue;
        loc.list.splice(loc.list.indexOf(loc.key), 1); n++;
        if (!loc.list.length) { if (loc.track) tracks[loc.name] = null; else { loc.rec.layers.splice(loc.rec.layers.indexOf(loc.lay), 1); } }
      }
      selKeys.clear();
    } else {
      const ids = selLids.size ? new Set(selLids) : (selLid ? new Set([selLid]) : new Set());
      for (const rec of [...items.values()]) {
        const before = rec.layers.length;
        rec.layers = rec.layers.filter(l => !ids.has(l.id));
        n += before - rec.layers.length;
      }
      selLids.clear();
    }
    if (!n) return;
    for (const [key, rec] of [...items]) if (!rec.layers.length) { beginFrame(); dropRec(rec); items.delete(key); }
    ver++; applyAll(); try { requestRender(); } catch (_) {}
    sync(true); commit('Delete');
  }
  const clipsSelected = () => {
    const ids = selLids.size ? selLids : (selLid ? new Set([selLid]) : new Set()), out = [];
    for (const rec of items.values()) for (const lay of rec.layers) if (ids.has(lay.id)) out.push({ rec, lay });
    return out;
  };
  // Cut the selected clips (or the motions of the selected objects) at the playhead: the second half is a clip of its own, carrying on from where the first stopped.
  function splitAtPlayhead() {
    const T = clock, D = durOf();
    let list = clipsSelected();
    if (!list.length) for (const t of targets()) { const rec = items.get(t.key); if (rec) for (const lay of rec.layers) list.push({ rec, lay }); }
    let n = 0;
    for (const { rec, lay } of list) {
      if (lay.keys) continue;
      const g = barGeom(lay, D), start = lay.loop.delay || 0;
      if (!(T > start + 0.02 && T < g.end - 0.02)) continue;
      const B = JSON.parse(JSON.stringify(lay, jsonRep));
      B.id = nid(); B.t = clock; B.loop.delay = T; B.skip = (lay.skip || 0) + (T - start);
      if (lay.end != null) B.end = lay.end; else delete B.end;
      lay.end = T;
      rec.layers.splice(rec.layers.indexOf(lay) + 1, 0, B);
      selLids.add(B.id); n++;
    }
    if (!n) { toast('Animate', 'Put the playhead inside a clip to cut it there', 'info', 2200); return; }
    ver++; applyAll(); sync(true); commit('Cut clip');
  }
  function duplicateClips() {
    const list = clipsSelected().filter(x => !x.lay.keys); let n = 0;
    for (const { rec, lay } of list) {
      const g = barGeom(lay, durOf()), B = JSON.parse(JSON.stringify(lay, jsonRep)), at = g.inf ? clock : g.end, shift = at - (lay.loop.delay || 0);
      B.id = nid(); B.t = clock; B.loop.delay = Math.max(0, at); if (lay.end != null) B.end = lay.end + shift;
      rec.layers.splice(rec.layers.indexOf(lay) + 1, 0, B); selLids.add(B.id); n++;
    }
    if (!n) return;
    ver++; applyAll(); sync(true); commit('Duplicate clip');
  }
  // Copy and paste of clips (Ctrl+C and Ctrl+V while the Animate window is open): the picked clips, or every animation of the picked objects,
  // are copied whole (settings, loop, keys, where they start and end); a paste puts them on the objects that are picked now, the first of them
  // at the playhead and the others as far after it as they were after it. The parts themselves are not copied while the window is open.
  let clipBoard = null;
  function copyClips() {
    let list = clipsSelected();
    if (!list.length) { list = []; for (const t of targets()) { const rec = items.get(t.key); if (rec) for (const lay of rec.layers) list.push({ rec, lay }); } }
    if (!list.length) return false;
    clipBoard = list.map(({ lay }) => JSON.parse(JSON.stringify(lay, jsonRep)));
    toast('Copied', clipBoard.length + (clipBoard.length === 1 ? ' clip' : ' clips'), 'info', 1600);
    return true;
  }
  function pasteClips() {
    if (!clipBoard || !clipBoard.length) return false;
    const ts = targets();
    if (!ts.length) { toast('Paste', 'Select an object to paste the clips on', 'info', 2600); return true; }
    const start = (b) => b.keys ? (b.keys.length ? b.keys[0].t : 0) : (b.loop.delay || 0);
    const t0 = Math.min(...clipBoard.map(start)), dt = clock - t0;
    const wasEmpty = !items.size; if (wasEmpty) clock = 0;
    let n = 0, locked = 0; const fresh = [];
    for (const t of ts) {
      let rec = items.get(t.key);
      if (!rec) {
        if (t.kind === 'part' && t.p.locked) { locked++; continue; }
        rec = makeRec(t); if (!rec) { locked++; continue; }
        items.set(t.key, rec);
      }
      for (const src of clipBoard) {
        const B = JSON.parse(JSON.stringify(src)); B.id = nid(); B.t = clock; delete B.axisVec;
        if (B.keys) for (const k of B.keys) { k.id = nid(); k.t = Math.max(0, k.t + dt); }
        else { B.loop.delay = Math.max(0, (B.loop.delay || 0) + dt); if (B.end != null) B.end = B.end + dt; }
        rec.layers.push(B); fresh.push(B.id); n++;
      }
    }
    if (!n) { if (locked) toast('Paste', 'Those parts are locked: unlock them to animate', 'warn', 3000); return true; }
    if (wasEmpty) { paused = true; if (raf) { cancelAnimationFrame(raf); raf = 0; } }
    dismissed = false; ver++; try { applyAll(); requestRender(); } catch (_) {}
    selLids.clear(); for (const id of fresh) selLids.add(id); selKeys.clear();
    loop(); sync(true); commit('Paste clips');
    return true;
  }
  const FPS = { e: 0, at: 0 };
  function fpsNote(ms) { if (ms > 1 && ms < 500) FPS.e = FPS.e ? FPS.e * 0.9 + ms * 0.1 : ms; }
  let draft = tlp.draft === true;
  // Draft: a lower resolution while it plays (a full one again when it stops)
  function applyDraft() {
    try {
      if (!app.renderer) return;
      const playing = anyAnim() && !paused && !suspended && !held && !!(ui.dock && ui.dock.root.classList.contains('show'));
      const rest = (typeof _MotionPerf !== 'undefined' && _MotionPerf.dprNow) ? _MotionPerf.dprNow() : (state._restDpr || 1);
      const want = draft && playing ? Math.max(0.5, rest * 0.6) : rest;
      if (Math.abs((app.renderer.getPixelRatio ? app.renderer.getPixelRatio() : 1) - want) > 0.01) { app.renderer.setPixelRatio(want); onResize(); requestRender(); }
    } catch (_) {}
  }

  // ---- the timeline dock: a drawer along the bottom of the viewport (#vp-animate-pop) ----
  // Rows: the scene's own tracks (Explode, Camera) and each animated object with a row for each of its motions. A motion is a clip, a
  // bar that starts at its delay and runs to the end of its repeats (or to the end of the timeline, faded, when it goes on for ever);
  // the marks inside it are the cycles. Drag a clip to move it, its edges to trim it. Pose, Look, Explode and Camera are made of keys,
  // the diamonds: drag one to move it in time, press the ruler to scrub.
  // the width of the column of names: full (280 px, or as dragged by its edge and kept), or just the icons when the left panel is folded
  const HWN = 44, HWF0 = 280, HW_KEY = 'stepopt-anim-names-w';
  let HWF = (() => { try { const v = parseInt(localStorage.getItem(HW_KEY), 10); return v >= 140 && v <= 640 ? v : HWF0; } catch (_) { return HWF0; } })();
  let HW = showL ? HWF : HWN;
  const fmtTC = (t) => { t = Math.max(0, t); const m = Math.floor(t / 60); return m + ':' + (t - m * 60).toFixed(2).padStart(5, '0'); };
  const parseTC = (s) => { s = String(s).trim(); if (!s) return null; let v = 0; for (const x of s.split(':')) { const n = parseFloat(x); if (!Number.isFinite(n)) return null; v = v * 60 + n; } return v; };
  const stepBy = (d) => { if (!paused) pause(); seekTo(FRAME_SNAP(clock) + d); };
  const TRACK_NAMES = { explode: ['Explode', 'scaling'], camera: ['Camera', 'video'] };

  function barGeom(l, D) {
    const cyc = cycleOf(l), dl = Math.min(D, (l.loop && l.loop.delay) || 0), cy = l.type === 'spin' || l.type === 'path', sk = l.skip || 0;
    let end = D, inf = true;
    if (cy) {
      if (l.loop.mode === 'once') { end = dl + Math.max(0, cyc - sk); inf = false; }
      else if (l.loop.repeat > 0) { end = dl + Math.max(0, l.loop.repeat * cyc - sk); inf = false; }
    }
    if (l.end != null && l.end < end) { end = l.end; inf = false; }
    if (end > D) { end = D; inf = true; }
    end = Math.max(end, dl + 0.05);
    return { l: dl * pps, w: Math.max(6, (end - dl) * pps), inf, cy, start: dl, end, cyc: l.type === 'noise' ? 99999 : Math.max(3, cyc * pps) };
  }
  function layoutPps() {
    const d = ui.dock, D = durOf();
    pps = Math.max(8, Math.max(200, d.scroll.clientWidth - HW - 1) / D * zoom);      // (the timeline runs to the right edge: no gap after the last second; it is fitted again when the width changes, a vertical bar coming or going included)
    d.scroll.style.overflowX = zoom <= 1 ? 'hidden' : '';      // (fully zoomed out the whole timeline fits: nothing to scroll sideways)
    d.inner.style.setProperty('--tw', (D * pps).toFixed(1) + 'px');
  }
  // The playhead line (and the snap line) is not drawn while it is scrolled away to the left of the timeline, under the object column.
  function lineVis(d, x) {
    const hide = x < d.scroll.scrollLeft - 1;
    if (d._lineHid !== hide) { d._lineHid = hide; d.ph.style.visibility = hide ? 'hidden' : ''; d.snap.style.visibility = hide ? 'hidden' : ''; }
  }
  function placeHead() {
    const d = ui.dock; if (!d || !d.hd) return;
    const x = Math.min(clock, durOf()) * pps, tr = 'translateX(' + x.toFixed(2) + 'px)';
    lineVis(d, x);
    if (d.last.x !== tr) {
      d.last.x = tr; d.ph.style.transform = tr; d.hd.style.transform = tr;
      if (!paused && !d.scrub && zoom > 1) {      // (playing: the view follows the playhead when it runs out of it; fully zoomed out the whole timeline is in view and must not move)
        const sc = d.scroll, vx = HW + x;
        if (vx > sc.scrollLeft + sc.clientWidth - 24 || vx < sc.scrollLeft + HW) sc.scrollLeft = Math.max(0, vx - HW - sc.clientWidth * 0.2);
      }
    }
  }
  function renderRuler() {
    const d = ui.dock, D = durOf();
    const STEPS = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const step = STEPS.find(s => s * pps >= 72) || 600, sub = step * pps >= 150 ? 10 : 5;
    const lab = (t) => t < 60 ? (Number.isInteger(t) ? t : +t.toFixed(2)) + 's' : Math.floor(t / 60) + ':' + String(Math.round(t % 60)).padStart(2, '0');
    let h = '';
    for (let i = 0; i < 3000; i++) {
      const t = i * step / sub; if (!(t <= D + 1e-9)) break;
      const M = i % sub === 0, x = (t * pps).toFixed(1);
      h += '<i class="adk-tk' + (M ? ' M' : '') + '" style="left:' + x + 'px"></i>';
      if (M) h += '<span class="adk-tlab" style="left:' + x + 'px">' + lab(t) + '</span>';
    }
    d.rl.innerHTML = h + '<i class="adk-hd"></i>';
    d.hd = d.rl.querySelector('.adk-hd'); d.last.x = '';
    d.inner.style.setProperty('--gs', (step * pps).toFixed(1) + 'px');
  }
  const kfHtml = (list, kid) => list.map(k => `<i class="adk-kf${selKeys.has(k.id) ? ' is-sel' : ''}${k.e === 'hold' ? ' is-hold' : ''}" data-kid="${k.id}" style="left:${(k.t * pps).toFixed(1)}px" title="${fmtTC(k.t)} · ${(EASES[k.e] || EASES.ease)[0]}"></i>`).join('');
  const spanHtml = (list) => list.length > 1 ? `<i class="adk-kspan" style="left:${(list[0].t * pps).toFixed(1)}px;width:${((list[list.length - 1].t - list[0].t) * pps).toFixed(1)}px"></i>` : '';
  function renderRows() {
    const d = ui.dock; if (!d || dragBar || !d.root.classList.contains('show')) return;
    layoutPps(); renderRuler();
    const D = durOf(), sel = new Set(targets().map(t => t.key)), out = [];
    const btn = (attrs, title, icon) => `<button type="button" class="adk-b" ${attrs} title="${title}" aria-label="${title}"><i data-lucide="${icon}"></i></button>`;
    // the scene's own tracks
    const names = Object.keys(TRACK_NAMES).filter(nm => tracks[nm] && tracks[nm].keys.length);
    if (names.length) {
      out.push(`<div class="adk-row adk-obj adk-scn-h"><div class="adk-rh"><i data-lucide="tv-minimal-play" class="adk-ico"></i><span class="adk-n">Scene</span><em></em></div><div class="adk-rl"></div></div>`);
      for (const nm of names) {
        const tr = tracks[nm], T = TRACK_NAMES[nm];
        out.push(`<div class="adk-row adk-lay adk-keys${tr.muted ? ' is-muted' : ''}" data-scene="${nm}"><div class="adk-rh" data-scenehead="${nm}"><i data-lucide="${T[1]}" class="adk-ico"></i><span class="adk-n">${T[0]}</span><em>${tr.keys.length} keys</em><span class="adk-act">${btn('data-smute="' + nm + '"', tr.muted ? 'Switch it on' : 'Switch it off', tr.muted ? 'eye-off' : 'eye')}${btn('data-srm="' + nm + '"', 'Remove this track', 'x')}</span></div><div class="adk-rl" data-kr="1">${spanHtml(tr.keys)}${kfHtml(tr.keys)}</div></div>`);
      }
    }
    for (const r of items.values()) {
      const s = sel.has(r.key), k = esc(r.key);
      out.push(`<div class="adk-row adk-obj${s ? ' is-sel' : ''}" data-key="${k}"><div class="adk-rh" data-pick="${k}">${r.layers.length ? `<button type="button" class="adk-fold" data-fold="${k}" aria-expanded="${!folded.has(r.key)}" aria-label="${folded.has(r.key) ? 'Show' : 'Hide'} its animations" title="${folded.has(r.key) ? 'Show' : 'Hide'} its animations"><i data-lucide="${folded.has(r.key) ? 'chevron-right' : 'chevron-down'}"></i></button>` : ''}<i data-lucide="${r.kind === 'group' ? 'folder' : 'box'}" class="adk-ico"></i><span class="adk-n">${esc(r.label)}</span><em>${r.parent && items.get(r.parent) ? esc('follows ' + items.get(r.parent).label) : (r.kind === 'group' ? r.members.length + ' parts' : '')}</em><span class="adk-act">${btn('data-rmkey="' + k + '"', 'Remove all its animation', 'trash-2')}</span></div><div class="adk-rl"></div></div>`);
      for (const l of (folded.has(r.key) ? [] : r.layers)) {
        const act = selLids.size ? selLids.has(l.id) : l.id === selLid, T = TYPES[l.type], mute = btn('data-mute="' + l.id + '"', l.muted ? 'Switch it on' : 'Switch it off', l.muted ? 'eye-off' : 'eye'), rm = btn('data-rmlay="' + l.id + '"', 'Remove this motion', 'x');
        if (l.keys) {
          out.push(`<div class="adk-row adk-lay adk-keys${act ? ' is-active' : ''}${l.muted ? ' is-muted' : ''}${s ? ' is-sel' : ''}" data-key="${k}" data-lid="${l.id}" data-type="${l.type}"><div class="adk-rh" data-lidhead="${l.id}"><i data-lucide="${T[1]}" class="adk-ico"></i><span class="adk-n">${T[0]}</span><em>${l.keys.length} keys</em><span class="adk-act">${mute}${rm}</span></div><div class="adk-rl" data-kr="1">${spanHtml(l.keys)}${kfHtml(l.keys)}</div></div>`);
          continue;
        }
        const g = barGeom(l, D);
        out.push(`<div class="adk-row adk-lay${act ? ' is-active' : ''}${l.muted ? ' is-muted' : ''}${s ? ' is-sel' : ''}" data-key="${k}" data-lid="${l.id}" data-type="${l.type}"><div class="adk-rh" data-lidhead="${l.id}"><i data-lucide="${T[1]}" class="adk-ico"></i><span class="adk-n">${T[0]}</span><em></em><span class="adk-act">${mute}${rm}</span></div><div class="adk-rl"><div class="adk-bar${g.inf ? ' is-inf' : ''}${act ? ' is-active' : ''}" data-key="${k}" data-lid="${l.id}" data-type="${l.type}" style="left:${g.l.toFixed(1)}px;width:${g.w.toFixed(1)}px;--cyc:${g.cyc.toFixed(1)}px"><i class="adk-bl"></i><span class="adk-bt">${esc(brief(l))}</span><i class="adk-be"></i></div></div></div>`);
      }
    }
    d.rows.innerHTML = out.length ? out.join('') : '<div class="adk-empty"><div class="adk-rh adk-empty-rh"></div><div class="adk-empty-msg">Empty timeline</div></div>';
    try { _lucide(); } catch (_) {}
    placeHead();
  }

  // ---- what is selected on the timeline: clips and keys ----
  function selectLayer(key, lid, add) {
    folded.delete(key);
    const rec = items.get(key), lay = rec && rec.layers.find(l => l.id === lid);
    if (add) { if (selLids.has(lid)) selLids.delete(lid); else selLids.add(lid); }
    else { selLids.clear(); selLids.add(lid); }
    selKeys.clear();
    pick(key);
    if (lay) { load(lay); if (!KEYED.has(lay.type)) save(); }
    sig = ''; sync(true);
  }
  function selectKey(id, add) {
    if (add) { if (selKeys.has(id)) selKeys.delete(id); else selKeys.add(id); } else { selKeys.clear(); selKeys.add(id); }
    const loc = locateKey(id);
    if (loc && loc.lay) { selLids.clear(); selLids.add(loc.lay.id); selLid = loc.lay.id; if (!add) pick(loc.rec.key); } else selLids.clear();
    sig = ''; sync(true);
  }
  // The panel of the key that is selected (its time, its easing, what it holds), made once per key and kept up to date after.
  const EASE_OPTS = () => Object.entries(EASES).map(([k, v]) => `<option value="${k}">${v[0]}</option>`).join('');
  function kpHtml(loc) {
    const rg = (kv, label, min, max, step, unit) => `<div class="anim-row"><span class="anim-l">${label}</span><div class="anim-speed"><input type="range" data-kv="${kv}" min="${min}" max="${max}" step="${step}" aria-label="${label}"><span class="anim-v" data-kl="${kv}" data-u="${unit || ''}"></span></div></div>`;
    const TITLE = { pose: 'Pose key', look: 'Look key', explode: 'Explode key', camera: 'Camera key' }[loc.kind];
    let rows = '';
    if (loc.kind === 'pose') rows = '<div class="anim-sub">Move, in mm</div>' + rg('mx', 'X', -500, 500, 0.5, ' mm') + rg('my', 'Y', -500, 500, 0.5, ' mm') + rg('mz', 'Z', -500, 500, 0.5, ' mm')
      + '<div class="anim-sub">Turn</div>' + rg('rx', 'X', -720, 720, 1, '°') + rg('ry', 'Y', -720, 720, 1, '°') + rg('rz', 'Z', -720, 720, 1, '°');
    else if (loc.kind === 'look') rows = rg('o', 'Opacity', 0, 1, 0.01, '%') + rg('tm', 'Tint', 0, 1, 0.01, '%') + '<div class="anim-row"><span class="anim-l">Colour</span><div class="anim-speed"><input type="color" class="adk-col" data-kv="c" aria-label="Tint colour"></div></div>';
    else if (loc.kind === 'explode') rows = rg('x', 'X', 0, 300, 1, '%') + rg('y', 'Y', 0, 300, 1, '%') + rg('z', 'Z', 0, 300, 1, '%') + '<div class="anim-row"><span class="anim-l"></span><button type="button" class="cq-btn adk-kbtn" data-kact="capture">Use the explode of the view</button></div>';
    else rows = rg('fov', 'Field of view', 10, 100, 1, '°') + '<div class="anim-row"><span class="anim-l"></span><button type="button" class="cq-btn adk-kbtn" data-kact="capture">Use the view as it is now</button></div><div class="anim-row"><span class="anim-l"></span><button type="button" class="cq-btn adk-kbtn" data-kact="show">Go to this view</button></div>';
    return `<div class="adk-kp-h"><i data-lucide="diamond"></i><b>${TITLE}</b><span class="adk-kp-s">${loc.rec ? esc(loc.rec.label) : 'Scene'}</span><button type="button" class="adk-b" data-kact="del" title="Delete this key" aria-label="Delete this key"><i data-lucide="trash-2"></i></button></div>
      <div class="anim-card"><div class="anim-row"><span class="anim-l">Time</span><div class="anim-speed"><input type="number" class="adk-in adk-num" data-kv="t" min="0" max="600" step="0.05"><span class="adk-unit">s</span><button type="button" class="adk-b" data-kact="goto" title="Put the playhead on this key" aria-label="Go to this key"><i data-lucide="locate-fixed"></i></button></div></div>
      <div class="anim-row"><span class="anim-l">Into the next</span><select class="mac-sel" data-kv="e" aria-label="Easing into the next key">${EASE_OPTS()}</select></div></div>
      <div class="anim-card">${rows}</div>`;
  }
  function renderKeyPanel() {
    const d = ui.dock; if (!d) return;
    const id = selKeys.size === 1 ? [...selKeys][0] : 0, loc = id ? locateKey(id) : null;
    d.body.dataset.kmode = loc ? 'key' : '';
    d.kp.hidden = !loc;
    if (!loc) { d.kpSig = ''; return; }
    if (d.kpSig !== id + '|' + loc.kind) { d.kpSig = id + '|' + loc.kind; d.kp.innerHTML = kpHtml(loc); try { _lucide(); } catch (_) {} }
    for (const el of d.kp.querySelectorAll('[data-kv]')) {
      const k = el.dataset.kv, v = k === 't' ? loc.key.t : k === 'e' ? (loc.key.e || 'ease') : loc.key.v[k];
      if (v == null) continue;
      if (document.activeElement !== el && String(el.value) !== String(v)) el.value = v;
      const lab = d.kp.querySelector('[data-kl="' + k + '"]');
      if (lab) lab.textContent = (lab.dataset.u === '%' && (k === 'o' || k === 'tm') ? Math.round(v * 100) : (Math.round(v * 10) / 10)) + (lab.dataset.u || '');
    }
  }
  function keyEdit(el) {
    const id = [...selKeys][0], loc = locateKey(id); if (!loc) return;
    const k = el.dataset.kv;
    if (k === 't') {
      const t = parseFloat(el.value); if (!Number.isFinite(t)) return;
      loc.key.t = Math.max(0, Math.min(600, t)); sortKeys(loc.list);
    } else if (k === 'e') loc.key.e = el.value;
    else if (k === 'c') loc.key.v.c = el.value;
    else { const n = parseFloat(el.value); if (!Number.isFinite(n)) return; loc.key.v[k] = n; }
    ver++;
    if (loc.track) applyScene(clock, true, true); else applyAll();
    try { requestRender(); } catch (_) {}
    renderRows(); sync(); commitSoon('Edit key');
  }
  function keyAction(act) {
    const id = [...selKeys][0], loc = locateKey(id); if (!loc) return;
    if (act === 'del') { deleteSelection(); return; }
    if (act === 'goto') { if (!paused) pause(); seekTo(loc.key.t); return; }
    if (act === 'capture') {
      if (loc.kind === 'explode') loc.key.v = explodeNow(); else if (loc.kind === 'camera' && app.camera && app.controls) loc.key.v = camNow();
      ver++; ui.dock.kpSig = ''; sync(true); commit('Update key');
    } else if (act === 'show') { applyCamKey(loc.key.v); }
  }

  // ---- snapping, and dragging clips and keys ----
  function snapPoints(skipL, skipK) {
    const D = durOf(), pts = [0, D, clock];
    for (const rec of items.values()) for (const l of rec.layers) {
      if (l.keys) { for (const k of l.keys) if (!skipK.has(k.id)) pts.push(k.t); continue; }
      if (skipL.has(l.id)) continue;
      const g = barGeom(l, D); pts.push(g.start); if (!g.inf) pts.push(g.end);
    }
    for (const nm of ['explode', 'camera']) if (tracks[nm]) for (const k of tracks[nm].keys) if (!skipK.has(k.id)) pts.push(k.t);
    return pts;
  }
  // The shift (seconds) that puts one of `ts` on the nearest point, within 8 pixels (0: nothing is near)
  function snapShift(ts, pts) {
    const lim = 8 / pps; let best = 0, bd = lim, at = null;
    for (const t of ts) for (const p of pts) { const dd = Math.abs(p - t); if (dd < bd) { bd = dd; best = p - t; at = p; } }
    return { shift: best, at };
  }
  function showSnap(t) {
    const d = ui.dock; if (!d || !d.snap) return;
    if (t == null) { d.snap.hidden = true; return; }
    d.snap.hidden = false; d.snap.style.transform = 'translateX(' + (t * pps).toFixed(1) + 'px)';
  }
  // Press on a clip: move it (all the selected ones go with it), or trim one edge of it.
  // Right-click on a clip of the timeline: copy its properties, paste them on another clip (of any object; a clip of another kind becomes
  // this kind, unless the object has one already), or add it as a new animation on this object; switch it off; remove it.
  let clipCopy = null;      // { type, p, loop }: what was copied (the timing of the clip, its delay and trim, is not part of it)
  const KIND = (t) => (TYPES[t] || [t])[0];
  function copyClip(lay) {
    if (!lay || lay.keys) return;
    clipCopy = { type: lay.type, p: JSON.parse(JSON.stringify(lay.p)), loop: { mode: lay.loop.mode, repeat: lay.loop.repeat, from: lay.loop.from, to: lay.loop.to } };
    toast('Copied', KIND(lay.type) + ' properties', 'info', 1600);
  }
  function pasteOnto(list) {
    if (!clipCopy) return;
    let n = 0; const recs = new Set();
    for (const { rec, lay } of list) {
      if (lay.keys) continue;
      if (lay.type !== clipCopy.type) {
        if (rec.layers.some(l => l !== lay && l.type === clipCopy.type)) continue;      // (the object has one of that kind already)
        lay.type = clipCopy.type; delete lay.axisVec;
      }
      lay.p = JSON.parse(JSON.stringify(clipCopy.p));
      Object.assign(lay.loop, clipCopy.loop);
      recs.add(rec); n++;
    }
    if (!n) { toast('Nothing pasted', 'The objects already have an animation of that kind', 'info', 2600); return; }
    ver++; try { applyAll([...recs]); requestRender(); } catch (_) {}
    const cur = list.find(x => x.lay.id === selLid && !x.lay.keys) || list.find(x => !x.lay.keys);
    if (cur) load(cur.lay);      // (the window's settings follow the clip that is selected, as they do when a clip is picked: else it shows the old ones, and the next change in it writes them back)
    sync(true); commit('Paste animation properties');
  }
  function clipMenu(e, bar) {
    const key = bar.dataset.key, lid = +bar.dataset.lid, rec = items.get(key), lay = rec && rec.layers.find(l => l.id === lid);
    if (!lay) return;
    e.preventDefault(); e.stopPropagation();
    if (!selLids.has(lid)) selectLayer(key, lid, false);
    const sel = clipsSelected(), list = sel.length > 1 && sel.some(x => x.lay === lay) ? sel : [{ rec, lay }];
    const keyed = !!lay.keys, ts = targets();
    const needCopy = clipCopy ? false : 'Copy the properties of a clip first';
    _ctxBuild([
      { icon: 'copy', label: list.length > 1 ? 'Copy ' + list.length + ' clips' : 'Copy clip', kbd: 'Ctrl+C', fn: () => copyClips() },
      { icon: 'clipboard-paste', label: 'Paste clips on the selected objects', kbd: 'Ctrl+V', off: clipBoard ? false : 'Copy a clip first', fn: () => pasteClips() },
      '---',
      { icon: 'copy', label: 'Copy ' + KIND(lay.type) + ' properties', off: keyed ? 'A pose has no properties to copy' : false, fn: () => copyClip(lay) },
      { icon: 'clipboard-paste', label: list.length > 1 ? 'Paste properties on ' + list.length + ' clips' : 'Paste properties', off: needCopy || (keyed ? 'A pose has no properties to paste on' : false), fn: () => pasteOnto(list) },
      { icon: 'plus', label: 'Add as a new animation on this object', off: needCopy || (rec.layers.some(l => l.type === clipCopy.type) ? 'It has ' + KIND(clipCopy.type) + ' already: paste the properties on it' : false),
        fn: () => { const nl = { id: nid(), type: clipCopy.type, p: JSON.parse(JSON.stringify(clipCopy.p)), loop: { ...DEFAULTS.loop, ...clipCopy.loop, delay: 0 }, t: clock }; rec.layers.push(nl); ver++; try { applyAll([rec]); requestRender(); } catch (_) {} selLids.clear(); selLids.add(nl.id); load(nl); sync(true); commit('Paste animation'); } },
      '---',
      { icon: lay.muted ? 'eye' : 'eye-off', label: lay.muted ? 'Switch on' : 'Switch off', fn: () => { lay.muted = !lay.muted; ver++; applyAll(); try { requestRender(); } catch (_) {} sync(true); commit('Switch'); } },
      { icon: 'trash-2', label: 'Remove', danger: true, fn: () => remove([key], lay.type) },
    ], e.clientX, e.clientY);
  }
  function barPress(e, bar) {
    const key = bar.dataset.key, lid = +bar.dataset.lid, rec = items.get(key), lay = rec && rec.layers.find(l => l.id === lid);
    if (!lay) return;
    e.preventDefault();
    const mode = e.target.closest('.adk-bl') ? 'left' : e.target.closest('.adk-be') ? 'right' : 'move';
    const add = e.shiftKey;
    if (!selLids.has(lid) && !add) { selLids.clear(); selLids.add(lid); }
    const group = clipsSelected().filter(x => x.lay.id === lid || selLids.has(x.lay.id));      // (the selected clips go together, whether the whole bar is dragged or one of its ends)
    if (!group.some(x => x.lay === lay)) group.push({ rec, lay });
    const D0 = durOf();
    const orig = group.map(x => ({ lay: x.lay, delay: x.lay.loop.delay || 0, skip: x.lay.skip || 0, end: x.lay.end, g: barGeom(x.lay, D0) }));
    const o0 = orig.find(o => o.lay === lay), skipL = new Set(group.map(x => x.lay.id));
    const pts = snapPoints(skipL, new Set());
    const st = { x: e.clientX, last: e.clientX, acc: 0, moved: false };      // (acc: how far the pointer has gone, a tenth as far for each step taken with Alt held)
    dragBar = true; bar.classList.add('is-drag');
    try { bar.setPointerCapture(e.pointerId); } catch (_) {}
    const move = (ev) => {
      st.acc += (ev.clientX - st.last) * (ev.altKey ? FINE : 1); st.last = ev.clientX;
      if (!st.moved && Math.abs(ev.clientX - st.x) < 3) return;
      st.moved = true;
      let dt = st.acc / pps, snapAt = null;
      if (ev.shiftKey && !ev.altKey) {      // (snapping only while Shift is held)
        if (mode === 'move') { const s = snapShift([o0.g.start + dt, o0.g.end + dt], pts); dt += s.shift; snapAt = s.at; }
        else if (mode === 'left') { const s = snapShift([o0.g.start + dt], pts); dt += s.shift; snapAt = s.at; }
        else { const s = snapShift([o0.g.end + dt], pts); dt += s.shift; snapAt = s.at; }
      }
      showSnap(snapAt);
      for (const o of orig) {
        const L = o.lay;
        if (mode === 'move') {
          const nd = Math.max(0, Math.min(60, Math.round((o.delay + dt) * 200) / 200));
          L.loop.delay = nd; if (o.end != null) L.end = o.end + (nd - o.delay);
        } else if (mode === 'left') {
          let d = Math.max(-o.delay, Math.min(dt, (o.g.end - 0.05) - o.delay));
          d = Math.round(d * 200) / 200;
          const fromSkip = Math.min(o.skip, Math.max(0, -d));      // (dragging back first gives back what was trimmed)
          if (d >= 0) { L.skip = o.skip + d; } else { L.skip = o.skip - fromSkip; }
          L.loop.delay = o.delay + d;
        } else {
          const ne = Math.max(o.delay + 0.05, o.g.end + dt);
          if (ne >= D0 - 1e-6 && o.end == null) delete L.end; else L.end = ne >= D0 - 1e-6 ? undefined : Math.round(ne * 200) / 200;
          if (L.end === undefined) delete L.end;
        }
        const el = ui.dock.rows.querySelector('.adk-bar[data-lid="' + L.id + '"]');
        if (el) { const g = barGeom(L, D0); el.style.left = g.l.toFixed(1) + 'px'; el.style.width = g.w.toFixed(1) + 'px'; el.classList.toggle('is-inf', g.inf); }
      }
      applyAll(); try { requestRender(); } catch (_) {}
    };
    const up = () => {
      bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); bar.removeEventListener('pointercancel', up);
      dragBar = false; bar.classList.remove('is-drag'); showSnap(null);
      if (st.moved) { ver++; selectLayer(key, lid, false); for (const o of orig) selLids.add(o.lay.id); if (mode === 'move') sync(true); commit(mode === 'move' ? 'Move clip' : 'Trim clip'); }
      else selectLayer(key, lid, add);
    };
    bar.addEventListener('pointermove', move); bar.addEventListener('pointerup', up); bar.addEventListener('pointercancel', up);
  }
  // Press on a key: select it, drag it (the selected keys go together), or, on the line between the keys, move them all.
  function keyPress(e, el) {
    e.preventDefault();
    const row = el.closest('.adk-row'), line = el.classList.contains('adk-kspan');
    const lid = row.dataset.lid ? +row.dataset.lid : 0, nm = row.dataset.scene || '';
    let lay = null, list = null;
    if (nm) list = tracks[nm].keys; else { const rec = items.get(row.dataset.key); lay = rec && rec.layers.find(l => l.id === lid); list = lay && lay.keys; }
    if (!list) return;
    const kid = line ? 0 : +el.dataset.kid, add = e.shiftKey;
    if (line) { selKeys.clear(); for (const k of list) selKeys.add(k.id); }
    else if (!selKeys.has(kid)) { if (add) selKeys.add(kid); else { selKeys.clear(); selKeys.add(kid); } }
    else if (add) { selKeys.delete(kid); }
    const moving = [];
    for (const id of selKeys) { const loc = locateKey(id); if (loc) moving.push({ loc, t0: loc.key.t }); }
    const lead = moving.find(m => m.loc.key.id === kid) || moving[0];
    if (!lead) return;
    const pts = snapPoints(new Set(), new Set(selKeys));
    const st = { x: e.clientX, last: e.clientX, acc: 0, moved: false };
    dragBar = true;
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
    const minT = Math.min(...moving.map(m => m.t0));
    const move = (ev) => {
      st.acc += (ev.clientX - st.last) * (ev.altKey ? FINE : 1); st.last = ev.clientX;
      if (!st.moved && Math.abs(ev.clientX - st.x) < 3) return;
      st.moved = true;
      let dt = st.acc / pps, at = null;
      if (ev.shiftKey && !ev.altKey) { const s = snapShift([lead.t0 + dt], pts); dt += s.shift; at = s.at; }      // (snapping only while Shift is held)
      dt = Math.max(-minT, Math.round(dt * 200) / 200);
      showSnap(at);
      for (const m of moving) m.loc.key.t = Math.round((m.t0 + dt) * 1000) / 1000;
      const kel = ui.dock.rows;
      for (const m of moving) { const k = kel.querySelector('.adk-kf[data-kid="' + m.loc.key.id + '"]'); if (k) k.style.left = (m.loc.key.t * pps).toFixed(1) + 'px'; }
      for (const m of moving) sortKeys(m.loc.list);
      ver++;
      if (moving.some(m => m.loc.track)) applyScene(clock, true, false);
      applyAll(); try { requestRender(); } catch (_) {}
    };
    const up = () => {
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      dragBar = false; showSnap(null);
      if (st.moved) { ver++; commit('Move keys'); }
      if (lay) { selLids.clear(); selLids.add(lay.id); selLid = lay.id; }
      sig = ''; sync(true);
    };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  }

  const RATES = [0.25, 0.5, 1, 2, 4];
  function updateDockBar() {
    const d = ui.dock; if (!d) return;
    const any = anyAnim(), D = durOf(), L = d.last;
    if (L.off !== !any) { L.off = !any; d.root.classList.toggle('is-off', !any); d.play.disabled = !any; }
    const t = fmtTC(Math.min(clock, D));
    if (L.t !== t) { L.t = t; if (document.activeElement !== d.time) d.time.value = t; }
    const ln = fmtTC(D); if (L.len !== ln) { L.len = ln; d.len.textContent = ln; }
    const st = !any ? 'off' : paused ? 'play' : 'pause';
    if (L.st !== st) {
      L.st = st;
      d.play.innerHTML = '<i data-lucide="' + (st === 'pause' ? 'pause' : 'play') + '"></i>';
      d.play.title = !any ? 'Nothing is animated yet' : st === 'play' ? 'Play (Space)' : 'Pause (Space)'; d.play.setAttribute('aria-label', st === 'pause' ? 'Pause' : 'Play');
      try { _lucide(); } catch (_) {}
    }
    const rv = rate + '×'; if (L.rate !== rv) { L.rate = rv; d.rate.textContent = rv; }
    if (L.loop !== playLoop) { L.loop = playLoop; d.loop.classList.toggle('active', playLoop); d.loop.setAttribute('aria-pressed', playLoop); d.loop.title = playLoop ? 'Playing wraps round to the start (on)' : 'Playing stops at the end (loop is off)'; }
    if (L.draft !== draft) { L.draft = draft; d.draftB.classList.toggle('active', draft); d.draftB.setAttribute('aria-pressed', draft); }
    const dv = dur > 0 ? String(dur) : ''; if (L.dur !== dv + '|' + D && document.activeElement !== d.dur) { L.dur = dv + '|' + D; d.dur.value = dv; d.dur.placeholder = String(D); }
    const now = performance.now();
    if (now - FPS.at > 350) {
      FPS.at = now;
      const playing = st === 'pause', f = FPS.e ? Math.round(1000 / FPS.e) : 0;
      const txt = playing && f ? f + ' fps' + (stats.ms ? ' · ' + stats.ms.toFixed(1) + ' ms' : '') : (any ? 'paused' : '');
      if (L.fps !== txt) { L.fps = txt; d.fps.textContent = txt; }
      d.fps.classList.toggle('is-slow', playing && f > 0 && f < 24);
    }
    placeHead();
  }
  function buildDock() {
    if (ui.dock) return ui.dock;
    const root = document.createElement('div');
    root.id = 'vp-animate-pop'; root.setAttribute('role', 'region'); root.setAttribute('aria-label', 'Animate timeline'); root.tabIndex = -1;
    const B = (id, icon, title, cls) => `<button type="button" class="adk-b${cls ? ' ' + cls : ''}" id="${id}" title="${title}" aria-label="${title}"><i data-lucide="${icon}"></i></button>`;
    root.innerHTML = `
      <div class="adk-grip" id="adk-grip" title="Drag to resize · double-click to reset"></div>
      <div class="lc-h mat-dock-h adk-h">
        <div class="lc-title">Animate</div><span class="anim-alpha" title="Alpha: Animate is a very early feature and can change">Alpha</span>
        <div class="lc-spacer"></div>
        <div class="adk-menuwrap adk-addwrap"><span class="adk-split">
          <button type="button" class="adk-addb" id="adk-add" title="Add the animation to the selection" aria-label="Add the animation to the selection"><i data-lucide="plus"></i></button>
          <button type="button" class="adk-addb adk-addmore" id="adk-addmore" title="Choose what to add" aria-haspopup="menu" aria-expanded="false" aria-label="Choose what to add"><i data-lucide="chevron-down"></i></button></span>
          <div class="adk-menu adk-addmenu" id="adk-addmenu" hidden role="menu">${Object.entries(TYPES).filter(([k]) => !KEYED.has(k)).map(([k, [label, icon]]) => `<button type="button" role="menuitem" data-addtype="${k}"><i data-lucide="${icon}"></i><span>${label}</span></button>`).join('')}</div></div>
        ${B('adk-render', 'film', 'Render the timeline as a video')}
        ${B('adk-tr2', 'panel-right', 'Show or hide the settings')}${B('adk-pop', 'picture-in-picture-2', 'Pop out as a small window')}${B('adk-close', 'x', 'Close (Shift+A)')}
      </div>
      <div class="adk-body">
        <div class="adk-names-grip" id="adk-names-grip" title="Drag to resize · double-click to reset"></div>
        <div class="adk-main">
        <div class="adk-scroll" id="adk-scroll"><div class="adk-inner" id="adk-inner">
          <div class="adk-ruler"><div class="adk-rh">${B('adk-tl', 'panel-left', 'Show or hide the list of objects')}<span id="adk-count"></span></div><div class="adk-rl" id="adk-rl"></div></div>
          <div id="adk-rows"></div>
          <div class="adk-ph" id="adk-ph"></div>
          <div class="adk-snap" id="adk-snap" hidden></div>
        </div></div>
        <div class="adk-pb" role="toolbar" aria-label="Playback">
        <div class="adk-tr">
          ${B('adk-rew', 'skip-back', 'Back to the start (Home)')}${B('adk-prev', 'chevron-left', 'One frame back (Left)')}${B('adk-play', 'play', 'Play (Space)', 'adk-play')}${B('adk-next', 'chevron-right', 'One frame on (Right)')}${B('adk-end', 'skip-forward', 'To the end (End)')}
        </div>
        <input class="adk-in adk-time" id="adk-time" value="0:00.00" spellcheck="false" autocomplete="off" aria-label="Time" title="Time: type one to go there">
        <span class="adk-len" id="adk-len"></span>
        ${B('adk-loop', 'repeat', 'Loop')}
        <button type="button" class="adk-b adk-rate" id="adk-rate" title="Playback speed (click for the next)">1×</button>
        <div class="adk-sep"></div>
        <div class="adk-menuwrap">${B('adk-key', 'diamond', 'Add a key at the playhead (K)')}
          <div class="adk-menu" id="adk-keymenu" hidden role="menu">
            <button type="button" role="menuitem" data-add="keys"><i data-lucide="move-3d"></i><span>Pose key<em>Move and turn the selection</em></span></button>
            <button type="button" role="menuitem" data-add="look"><i data-lucide="eye"></i><span>Look key<em>See-through and tint</em></span></button>
            <button type="button" role="menuitem" data-add="explode"><i data-lucide="scaling"></i><span>Explode key<em>The explode of the view as it is</em></span></button>
            <button type="button" role="menuitem" data-add="camera"><i data-lucide="video"></i><span>Camera key<em>The view as it is</em></span></button>
          </div></div>
        ${B('adk-cut', 'scissors', 'Cut the clip at the playhead (S)')}${B('adk-dup', 'copy', 'Duplicate the clip (Ctrl+D)')}
        <div class="lc-spacer"></div>
        <span class="adk-fps" id="adk-fps" title="How fast the picture is drawn while it plays"></span>
        ${B('adk-draft', 'gauge', 'Draft: draw at a lower resolution while it plays')}
        <label class="adk-lab" title="Frames per second of the project; clips export at this rate">FPS<select class="adk-in" id="adk-pfps" aria-label="Project frames per second"><option value="24">24</option><option value="30">30</option><option value="60">60</option></select></label>
        <label class="adk-lab" title="Timeline length; empty: as long as the longest motion">Length<input class="adk-in" id="adk-dur" inputmode="decimal" spellcheck="false" autocomplete="off" placeholder="auto">s</label>
        <div class="adk-zoom"><i data-lucide="zoom-out"></i><input type="range" id="adk-zoom" min="1" max="16" step="0.25" value="1" aria-label="Zoom"><i data-lucide="zoom-in"></i></div>
        ${B('adk-fit', 'maximize-2', 'Fit the timeline to the window')}
        </div>
        </div>
        <div class="mat-insp-grip adk-insp-grip" id="adk-insp-grip" title="Drag to resize · double-click to reset"></div>
        <aside class="adk-insp"><div class="dlg-body" id="adk-insp-body"><div class="adk-keypanel" id="adk-kp" hidden></div>${bodyMarkup(false)}</div><div class="dlg-foot anim-foot">${footMarkup.replace(/<span class="cq-gap"><\/span><button[^>]*id="anim-add"[\s\S]*?<\/button>/, '')}</div></aside>
      </div>`;
    document.body.appendChild(root);
    const g = (i) => root.querySelector('#' + i);
    const d = ui.dock = {
      root, el: root, body: g('adk-insp-body'), kp: g('adk-kp'), scroll: g('adk-scroll'), inner: g('adk-inner'), rl: g('adk-rl'), rows: g('adk-rows'), ph: g('adk-ph'), snap: g('adk-snap'), hd: null,
      play: g('adk-play'), time: g('adk-time'), len: g('adk-len'), loop: g('adk-loop'), rate: g('adk-rate'), dur: g('adk-dur'), zoom: g('adk-zoom'), fps: g('adk-fps'), draftB: g('adk-draft'), menu: g('adk-keymenu'),
      last: { x: '', off: null, t: '', len: '', st: '', rate: '', loop: null, dur: '', fps: '', draft: null }, scrub: null, kpSig: '',
      show() { openDock(); }, hide() { closeDock(); },
    };
    wireInspector(d.body, root);
    // the settings pane's width: dragged by its edge like the Library's and the Materials' inspectors (remembered; double-click resets)
    window.__moDockDrag?.(g('adk-insp-grip'), '--adk-iw', 'stepopt-anim-insp-w', false,
      () => root.querySelector('.adk-insp').getBoundingClientRect().width, () => 280, () => Math.max(280, root.getBoundingClientRect().width - 360));
    // transport
    g('adk-rew').addEventListener('click', () => rewind());
    g('adk-end').addEventListener('click', () => { if (!paused) pause(); seekTo(durOf()); });
    const pf = g('adk-pfps');
    if (pf) {
      pf.value = String(projFps);
      pf.addEventListener('change', () => {
        projFps = [24, 30, 60].includes(+pf.value) ? +pf.value : 30; FRAME = 1 / projFps; saveTl();
        try { seekTo(FRAME_SNAP(clock)); } catch (_) {}
        toast('Project frame rate', projFps + ' frames per second', 'info', 2500);
      });
    }
    g('adk-prev').addEventListener('click', () => stepBy(-FRAME));
    g('adk-next').addEventListener('click', () => stepBy(FRAME));
    d.play.addEventListener('click', () => { if (!anyAnim()) return; if (paused) play(); else pause(); });
    d.loop.addEventListener('click', () => { playLoop = !playLoop; if (!playLoop) { pingpong = false; bounce = 1; } saveTl(); updateDockBar(); });
    d.rate.addEventListener('click', () => { rate = RATES[(RATES.indexOf(rate) + 1) % RATES.length]; updateDockBar(); });
    d.time.addEventListener('change', () => { const v = parseTC(d.time.value); if (v != null) { if (!paused) pause(); seekTo(v); } d.last.t = ''; updateDockBar(); });
    d.time.addEventListener('keydown', (e) => { if (e.key === 'Enter') d.time.blur(); e.stopPropagation(); });
    d.dur.addEventListener('keydown', (e) => { if (e.key === 'Enter') d.dur.blur(); e.stopPropagation(); });
    d.dur.addEventListener('change', () => {
      const v = parseTC(d.dur.value);
      dur = v != null && v > 0 ? Math.min(600, Math.max(1, v)) : 0;
      saveTl(); d.last.dur = ''; cycVer = -1;
      if (clock > durOf()) seekTo(durOf());
      renderRows(); updateDockBar();
    });
    d.draftB.addEventListener('click', () => { draft = !draft; saveTl(); applyDraft(); updateDockBar(); });
    // keys, cutting, duplicating
    const closeMenu = () => { d.menu.hidden = true; };
    g('adk-key').addEventListener('click', (e) => { e.stopPropagation(); d.menu.hidden = !d.menu.hidden; });
    d.menu.addEventListener('click', (e) => {
      const b = e.target.closest('[data-add]'); if (!b) return; closeMenu();
      const a = b.dataset.add; if (a === 'keys' || a === 'look') addObjectKey(a); else addSceneKey(a);
    });
    root.addEventListener('pointerdown', (e) => { if (!e.target.closest('.adk-menuwrap')) closeMenu(); }, true);
    // the blue plus: adds the kind that is chosen to what is selected; its arrow lists the kinds to choose from
    { const am = g('adk-addmenu'), ab = g('adk-addmore');
      const closeAdd = () => { am.hidden = true; ab.setAttribute('aria-expanded', 'false'); };
      g('adk-add').addEventListener('click', () => { closeAdd(); addLayer(); });
      ab.addEventListener('click', (e) => { e.stopPropagation(); closeMenu(); am.hidden = !am.hidden; ab.setAttribute('aria-expanded', String(!am.hidden)); });
      am.addEventListener('click', (e) => { const b = e.target.closest('[data-addtype]'); if (!b) return; closeAdd(); cfg.type = b.dataset.addtype; save(); sync(); addLayer(); });
      root.addEventListener('pointerdown', (e) => { if (!e.target.closest('.adk-addwrap')) closeAdd(); }, true);
      root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !am.hidden) { closeAdd(); e.stopPropagation(); } }, true); }
    g('adk-cut').addEventListener('click', () => splitAtPlayhead());
    g('adk-dup').addEventListener('click', () => duplicateClips());
    g('adk-render').addEventListener('click', () => { if (!paused) pause(); try { _openTurntableDialog({ timeline: true, seconds: durOf() }); } catch (err) { console.warn('[animate] render', err); } });
    const setZoom = (z) => { zoom = Math.max(1, Math.min(16, z)); d.zoom.value = zoom; renderRows(); };
    d.zoom.addEventListener('input', () => setZoom(+d.zoom.value));
    g('adk-fit').addEventListener('click', () => { setZoom(1); d.scroll.scrollLeft = 0; });
    d.scroll.addEventListener('scroll', () => { lineVis(d, Math.min(clock, durOf()) * pps); }, { passive: true });
    try { let rw = 0; new ResizeObserver(() => { const w = d.scroll.clientWidth; if (w && w !== rw) { rw = w; renderRows(); } }).observe(d.scroll); } catch (_) {}      // (fitted again when the width changes)
    d.scroll.addEventListener('wheel', (e) => {      // Ctrl + wheel zooms about the pointer; a plain wheel scrolls (Shift: sideways)
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const r = d.scroll.getBoundingClientRect(), at = e.clientX - r.left + d.scroll.scrollLeft - HW, sec = Math.max(0, at / pps);
      setZoom(zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2));
      d.scroll.scrollLeft = Math.max(0, sec * pps + HW - (e.clientX - r.left));
    }, { passive: false });
    // Pan the timeline with the hand: a middle-button drag anywhere, or Alt + drag on empty space (not on a clip, a key or the ruler).
    // The hand shows while Alt is held over it and closes while it drags.
    { let pan = null;
      const sc = d.scroll;
      const free = (t) => !t.closest('.adk-bar,.adk-kf,.adk-kspan,.adk-rl,.adk-b,input,select,textarea,button');
      sc.addEventListener('pointerdown', (e) => {
        if (!(e.button === 1 || (e.button === 0 && e.altKey && free(e.target)))) return;
        e.preventDefault(); e.stopPropagation();      // (no auto-scroll circle of the browser, and no clip or key picks it up)
        pan = { id: e.pointerId, x: e.clientX, y: e.clientY, sl: sc.scrollLeft, st: sc.scrollTop };
        try { sc.setPointerCapture(e.pointerId); } catch (_) {}
        sc.classList.add('is-panning');
      }, true);
      sc.addEventListener('pointermove', (e) => {
        if (!pan || e.pointerId !== pan.id) return;
        sc.scrollLeft = pan.sl - (e.clientX - pan.x); sc.scrollTop = pan.st - (e.clientY - pan.y);
      });
      const end = (e) => { if (!pan || (e && e.pointerId !== pan.id)) return; pan = null; sc.classList.remove('is-panning'); };
      for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) sc.addEventListener(t, end);
      sc.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); }, true);
      sc.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
      const alt = (e) => sc.classList.toggle('alt-hand', e.altKey);
      root.addEventListener('keydown', alt); root.addEventListener('keyup', alt); window.addEventListener('blur', () => sc.classList.remove('alt-hand'));
    }
    // the ruler: press to put the playhead there, drag to scrub
    const tAt = (e) => Math.max(0, Math.min(durOf(), FRAME_SNAP((e.clientX - d.rl.getBoundingClientRect().left) / pps)));
    // With Alt held the playhead moves a tenth as far as the pointer, and not by whole frames: for putting it exactly where it should be
    const fineAt = (e) => { const sc = d.scrub; sc.pos += (e.clientX - sc.last) * (e.altKey ? FINE : 1); sc.last = e.clientX; const t = Math.max(0, Math.min(durOf(), sc.pos / pps)); return e.altKey ? Math.round(t * 1000) / 1000 : FRAME_SNAP(t); };
    d.rl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      d.scrub = { was: !paused && anyAnim(), last: e.clientX, pos: 0 };
      if (d.scrub.was) { paused = true; if (raf) { cancelAnimationFrame(raf); raf = 0; } updateTag(); }
      try { d.rl.setPointerCapture(e.pointerId); } catch (_) {}
      d.scrub.pos = (e.clientX - d.rl.getBoundingClientRect().left);      // (where the pointer is on the ruler; the playhead goes there at once)
      seekTo(tAt(e)); e.preventDefault();
    });
    d.rl.addEventListener('pointermove', (e) => { if (d.scrub) seekTo(fineAt(e)); });
    for (const t of ['pointerup', 'pointercancel']) d.rl.addEventListener(t, () => { if (!d.scrub) return; const was = d.scrub.was; d.scrub = null; if (was) play(); });
    // the rows
    d.rows.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const kf = e.target.closest('.adk-kf, .adk-kspan'); if (kf) { keyPress(e, kf); return; }
      const bar = e.target.closest('.adk-bar'); if (bar) barPress(e, bar);
    });
    d.rows.addEventListener('contextmenu', (e) => { const bar = e.target.closest('.adk-bar'); if (bar) clipMenu(e, bar); });
    d.rows.addEventListener('dblclick', (e) => {
      const lane = e.target.closest('.adk-rl[data-kr]'); if (!lane || e.target.closest('.adk-kf')) return;
      addKeyAt(lane.closest('.adk-row'), (e.clientX - lane.getBoundingClientRect().left) / pps);
    });
    // Moving the rows up and down: drag the name of an object to change the order of the objects, the name of one of its animations to change
    // the order of that object's animations (they are drawn in that order). A line shows where it goes; the click that ends a drag is not a click.
    { let drag = null, ended = false;
      const rowsOf = (dr) => dr.isObj ? [...d.rows.querySelectorAll('.adk-obj[data-key]')] : [...d.rows.querySelectorAll('.adk-lay[data-lid]')].filter(r => r.dataset.key === dr.key);
      const mark = (cls, el) => { for (const r of d.rows.querySelectorAll('.adk-drop-before, .adk-drop-after')) r.classList.remove('adk-drop-before', 'adk-drop-after'); if (el) el.classList.add(cls); };
      const place = (dr, y) => {
        const others = rowsOf(dr).filter(r => r !== dr.row), idx = others.filter(r => { const b = r.getBoundingClientRect(); return b.top + b.height / 2 < y; }).length;
        dr.others = others; dr.idx = idx;
        if (idx < others.length) mark('adk-drop-before', others[idx]);
        else { const last = others[others.length - 1]; const tail = last && dr.isObj ? [...d.rows.querySelectorAll('.adk-row[data-key]')].filter(r => r.dataset.key === last.dataset.key).pop() : last; mark('adk-drop-after', tail); }
      };
      const onMove = (e) => {
        if (!drag) return;
        if (!drag.on) { if (Math.abs(e.clientY - drag.y0) < 5) return; drag.on = true; d.rows.classList.add('is-reordering'); for (const r of d.rows.querySelectorAll('.adk-row[data-key]')) if (drag.isObj ? r.dataset.key === drag.key : r === drag.row) r.classList.add('adk-dragging'); }
        place(drag, e.clientY);
      };
      const onUp = () => {
        document.removeEventListener('pointermove', onMove, true); document.removeEventListener('pointerup', onUp, true); document.removeEventListener('pointercancel', onUp, true);
        const dr = drag; drag = null; if (!dr) return;
        d.rows.classList.remove('is-reordering'); mark('', null); for (const r of d.rows.querySelectorAll('.adk-dragging')) r.classList.remove('adk-dragging');
        if (!dr.on || dr.idx == null || !dr.others) return;
        ended = true; setTimeout(() => { ended = false; }, 0);
        if (dr.isObj) {
          const keys = dr.others.map(r => r.dataset.key); keys.splice(dr.idx, 0, dr.key);
          const was = [...items.keys()]; if (keys.join('|') === was.join('|')) return;
          const all = new Map(items); items.clear();
          for (const k of keys) if (all.has(k)) items.set(k, all.get(k));
          for (const [k, v] of all) if (!items.has(k)) items.set(k, v);
        } else {
          const rec = items.get(dr.key); if (!rec) return;
          const ids = dr.others.map(r => +r.dataset.lid); ids.splice(dr.idx, 0, dr.lid);
          const next = ids.map(id => rec.layers.find(l => l.id === id)).filter(Boolean);
          if (next.length !== rec.layers.length || next.every((l, i) => l === rec.layers[i])) return;
          rec.layers = next;
        }
        ver++; applyAll(); try { requestRender(); } catch (_) {}
        sig = ''; renderRows(); sync(true); commit('Reorder');
      };
      d.rows.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || e.target.closest('button, input, select, .adk-bar, .adk-kf, .adk-kspan')) return;
        const rh = e.target.closest('.adk-rh'), row = rh && rh.closest('.adk-row[data-key]');
        if (!row || row.dataset.scene || !row.dataset.key) return;
        drag = { row, key: row.dataset.key, isObj: row.classList.contains('adk-obj'), lid: +row.dataset.lid || 0, y0: e.clientY, on: false, idx: null, others: null };
        document.addEventListener('pointermove', onMove, true); document.addEventListener('pointerup', onUp, true); document.addEventListener('pointercancel', onUp, true);
      });
      d.rows.addEventListener('click', (e) => { if (ended) { ended = false; e.stopPropagation(); e.preventDefault(); } }, true);
    }
    d.rows.addEventListener('click', (e) => {
      const row = e.target.closest('.adk-row'); if (!row) return;
      const key = row.dataset.key, b = e.target.closest('button');
      if (b) {
        if (b.dataset.fold) { const fk = b.dataset.fold; if (folded.has(fk)) folded.delete(fk); else folded.add(fk); renderRows(); }
        else if (b.dataset.rmkey) remove([b.dataset.rmkey]);
        else if (b.dataset.rmlay) { const rec = items.get(key); if (rec) { rec.layers = rec.layers.filter(l => l.id !== +b.dataset.rmlay); if (!rec.layers.length) remove([key]); else { ver++; applyAll(); sync(true); commit('Remove'); } } }
        else if (b.dataset.mute) {
          const rec = items.get(key), lay = rec && rec.layers.find(l => l.id === +b.dataset.mute);
          if (lay) { lay.muted = !lay.muted; ver++; applyAll(); try { requestRender(); } catch (_) {} sync(true); commit('Switch'); }
        }
        else if (b.dataset.smute) { const tr = tracks[b.dataset.smute]; if (tr) { tr.muted = !tr.muted; ver++; sync(true); commit('Switch'); } }
        else if (b.dataset.srm) { tracks[b.dataset.srm] = null; selKeys.clear(); ver++; sync(true); commit('Remove'); }
        return;
      }
      if (e.target.closest('.adk-bar, .adk-kf, .adk-kspan')) return;      // (handled as they are let go of)
      if (row.dataset.scene) { const tr = tracks[row.dataset.scene]; if (tr && tr.keys.length) selectKey(tr.keys[0].id, false); return; }
      if (row.classList.contains('adk-lay')) selectLayer(key, +row.dataset.lid, e.shiftKey); else { selLids.clear(); selKeys.clear(); pick(key); sig = ''; sync(true); }      // (the object itself: the usual animation menu on the right, no clip)
    });
    // the panel of a key
    d.kp.addEventListener('input', (e) => { const el = e.target.closest('[data-kv]'); if (el) keyEdit(el); });
    d.kp.addEventListener('change', (e) => { const el = e.target.closest('[data-kv]'); if (el) { keyEdit(el); commit('Edit key'); } });
    d.kp.addEventListener('click', (e) => { const b = e.target.closest('[data-kact]'); if (b) keyAction(b.dataset.kact); });
    // keys, while the dock is where the work is
    root.addEventListener('pointerdown', (e) => { if (!e.target.closest('input,select,textarea')) { try { root.focus({ preventScroll: true }); } catch (_) {} } }, true);
    root.addEventListener('mousedown', (e) => { if (e.target.closest('button.adk-b')) e.preventDefault(); });
    root.addEventListener('keydown', (e) => {
      if (e.target.closest('input,select,textarea,[role="slider"]')) return;
      const k = e.key; let hit = true;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (k === 'd' || k === 'D')) duplicateClips();
      else if (e.ctrlKey || e.metaKey || e.altKey) hit = false;
      else if (k === ' ') { if (anyAnim()) { if (paused) play(); else pause(); } }
      else if (k === 'Home') rewind();
      else if (k === 'End') { if (!paused) pause(); seekTo(durOf()); }
      else if (k === 'ArrowLeft') stepBy(e.shiftKey ? -1 : -FRAME);
      else if (k === 'ArrowRight') stepBy(e.shiftKey ? 1 : FRAME);
      else if (k === 'Delete' || k === 'Backspace') deleteSelection();
      else if (k === 's' || k === 'S') splitAtPlayhead();
      else if (k === 'k' || k === 'K') addObjectKey('keys');
      else if (k === 'Escape') { if (!d.menu.hidden) closeMenu(); else if (selKeys.size) { selKeys.clear(); sig = ''; sync(true); } else hit = false; }
      else hit = false;
      if (hit) { e.preventDefault(); e.stopPropagation(); }
    });
    // the two side panels: the list of objects on the left (it folds to its icons) and the settings on the right
    // Narrow (a dock between two wide sidebars): the list folds to its icons, and the settings leave the row and come over the timeline
    // when asked for (the button), instead of squeezing the timeline to nothing. Wide again: they are back where they were.
    const narrow = () => root.clientWidth > 0 && root.clientWidth <= 820;
    const paintSides = () => {
      const w = root.clientWidth, tight = w > 0 && w <= 640;
      HW = showL && !tight ? HWF : HWN;
      const inspOn = narrow() ? root.classList.contains('insp-force') : showR;
      root.classList.toggle('no-left', HW === HWN); root.classList.toggle('no-insp', !showR);
      g('adk-tl').classList.toggle('active', HW === HWF); g('adk-tr2').classList.toggle('active', inspOn);
      g('adk-tl').setAttribute('aria-pressed', HW === HWF); g('adk-tr2').setAttribute('aria-pressed', inspOn);
      root.style.setProperty('--adk-hw', HW + 'px');
    };
    g('adk-tl').addEventListener('click', () => { showL = !showL; saveTl(); paintSides(); renderRows(); });
    g('adk-tr2').addEventListener('click', () => {
      if (narrow()) root.classList.toggle('insp-force'); else { showR = !showR; saveTl(); }
      paintSides(); renderRows();
    });
    paintSides();
    {
      const grip = g('adk-names-grip'); let from = null, raf = 0;
      const set = (w, keep) => {
        const hi = Math.max(200, Math.min(640, root.clientWidth - 360));
        HWF = Math.max(140, Math.min(hi, Math.round(w)));
        if (keep) { try { localStorage.setItem(HW_KEY, String(HWF)); } catch (_) {} }
        paintSides(); if (!raf) raf = requestAnimationFrame(() => { raf = 0; renderRows(); });
      };
      grip.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; from = { x: e.clientX, w: HWF }; try { grip.setPointerCapture(e.pointerId); } catch (_) {} grip.classList.add('dragging'); e.preventDefault(); });
      grip.addEventListener('pointermove', (e) => { if (from) set(from.w + e.clientX - from.x, false); });
      for (const t of ['pointerup', 'pointercancel']) grip.addEventListener(t, () => { if (!from) return; from = null; grip.classList.remove('dragging'); set(HWF, true); });
      grip.addEventListener('dblclick', () => set(HWF0, true));
    }
    g('adk-close').addEventListener('click', () => closeDock());
    g('adk-pop').addEventListener('click', () => toMini());
    // the height: the top edge
    {
      const grip = g('adk-grip'), vp = $id('viewport'), rootEl = document.documentElement, KEY = () => (window.__moDockHeightKey ? window.__moDockHeightKey('anim') : 'stepopt-dock-h');
      try { const v = parseInt(localStorage.getItem(KEY()), 10); if (v > 0) rootEl.style.setProperty('--dock-h', v + 'px'); } catch (_) {} try { window.__moDockHeightSync && window.__moDockHeightSync(); } catch (_) {}
      let from = null, want = '', fr = 0;
      const apply = () => { fr = 0; if (!want) return; root.style.height = 'min(' + want + ', 80vh)'; if (vp) vp.style.setProperty('--dock-h', want); };
      grip.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; from = { y: e.clientY, h: root.getBoundingClientRect().height }; try { grip.setPointerCapture(e.pointerId); } catch (_) {} grip.classList.add('dragging'); document.body.classList.add('dock-resizing'); e.preventDefault(); });
      grip.addEventListener('pointermove', (e) => { if (!from) return; want = Math.round(Math.max(170, Math.min(window.innerHeight * 0.8, from.h + from.y - e.clientY))) + 'px'; if (!fr) fr = requestAnimationFrame(apply); });
      const up = () => {
        if (!from) return;
        if (fr) { cancelAnimationFrame(fr); apply(); }
        from = null;
        if (want) { rootEl.style.setProperty('--dock-h', want); root.style.height = ''; if (vp) vp.style.removeProperty('--dock-h'); try { localStorage.setItem(KEY(), String(parseInt(want, 10))); } catch (_) {} }
        want = ''; grip.classList.remove('dragging'); document.body.classList.remove('dock-resizing');
        window.dispatchEvent(new Event('resize'));
      };
      grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
      grip.addEventListener('dblclick', () => { rootEl.style.removeProperty('--dock-h'); try { localStorage.removeItem(KEY()); } catch (_) {} window.dispatchEvent(new Event('resize')); });
    }
    // a new width of the view: the scale of the timeline is worked out again
    let rz = 0, lastW = 0;
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => {
        if (!root.classList.contains('show')) return;
        paintSides();
        const w = d.scroll.clientWidth; if (w === lastW) return;
        lastW = w; if (!rz) rz = requestAnimationFrame(() => { rz = 0; renderRows(); });
      });
      ro.observe(d.scroll); ro.observe(root);
    }
    // one drawer at a time: when the materials, the library or the console open, this one gives way
    for (const id of ['vp-materials-pop', 'vp-library-pop', 'log-console']) {
      const other = $id(id);
      if (other) new MutationObserver(() => { if (other.classList.contains('show') && !other.classList.contains('is-float') && root.classList.contains('show')) closeDock(); }).observe(other, { attributes: true, attributeFilter: ['class'] });
    }
    try { _lucide(); } catch (_) {}
    return d;
  }
  function closeOtherDrawers() {
    const mp = $id('vp-materials-pop'), lib = $id('vp-library-pop'), con = $id('log-console');
    if (mp && mp.classList.contains('show') && !mp.classList.contains('is-float')) $id('mat-dock-close')?.click();
    if (lib && lib.classList.contains('show') && !lib.classList.contains('is-float')) { try { _libShow(false); } catch (_) {} }
    if (con && con.classList.contains('show')) $id('lc-close')?.click();
  }
  // Edit mesh goes off while Animate is open (its buttons are hidden: .anim-mode), and so does the gizmo.
  function enter() {
    try { app._Elements.api.mode('model'); } catch (_) {}
    state._animMode = true; document.body.classList.add('anim-mode'); $id('tg-animate')?.classList.add('active'); updateTag(); try { updateGizmo(); } catch (_) {}
    if (!poll) poll = setInterval(() => { if (!popup || !popup.el.classList.contains('show')) { clearInterval(poll); poll = 0; return; } follow(); }, 200);
  }
  function leave() { clearInterval(poll); poll = 0; state._animMode = false; document.body.classList.remove('anim-mode'); $id('tg-animate')?.classList.remove('active'); updateTag(); applyDraft(); try { updateGizmo(); } catch (_) {} }
  function openDock() {
    const d = buildDock();
    closeOtherDrawers();
    popup = d; resetPB(); sig = ''; listSig = ''; d.last.dur = ''; d.last.st = ''; d.last.loop = null; d.last.draft = null; d.kpSig = '';
    d.root.classList.add('show'); document.body.classList.add('anim-dock-open'); $id('tg-animate')?.classList.add('active');
    enter(); follow(); sync(true); updatePlaybar(); applyDraft();
    try { _lucide(); } catch (_) {}
  }
  function closeDock() {
    const d = ui.dock; if (!d || !d.root.classList.contains('show')) return;
    d.root.classList.remove('show'); document.body.classList.remove('anim-dock-open'); $id('tg-animate')?.classList.remove('active');
    if (!switching) leave();
  }
  function openMini() {
    const p = buildMini();
    popup = p; resetPB(); sig = ''; listSig = '';
    enter(); p.show(); follow(); sync(true);
    try { _lucide(); } catch (_) {}
  }
  function toMini() { switching = true; try { closeDock(); mode = 'mini'; saveTl(); openMini(); } finally { switching = false; } }
  function toDock() { switching = true; try { if (ui.mini) ui.mini.hide(); mode = 'dock'; saveTl(); openDock(); } finally { switching = false; } }
  const shown = () => !!((ui.dock && ui.dock.root.classList.contains('show')) || (ui.mini && ui.mini.el.classList.contains('show')));
  function open() { if (mode === 'mini') openMini(); else openDock(); }
  function closeAll() { try { if (ui.dock && ui.dock.root.classList.contains('show')) closeDock(); if (ui.mini && ui.mini.el.classList.contains('show')) ui.mini.hide(); } catch (_) {} }      // (back to normal on a refresh and when a file opens)
  function toggle() { if (!shown()) open(); else if (ui.dock && ui.dock.root.classList.contains('show')) closeDock(); else ui.mini.hide(); }
  // the button on the bottom toolbar and Shift+A
  { const b = $id('tg-animate'); if (b) b.addEventListener('click', (e) => { e.stopPropagation(); toggle(); }); }
  // While the Animate window is open, Space plays and pauses wherever the focus is (not while typing in a field, or in a dialog or a menu).
  // The key is taken before anything else sees it, and a button that had the focus is not pressed by it.
  {
    const typing = (t) => !!t && !!t.closest && !!t.closest('textarea, select, [contenteditable=""], [contenteditable="true"], input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=color]):not([type=button])');
    const away = (t) => !!t && !!t.closest && !!t.closest('.cq-bg, .dlg-bg.show, .modal-bg.show, #ctx-menu');
    const mine = (e) => state._animMode && (e.key === ' ' || e.code === 'Space') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !typing(e.target) && !away(e.target) && !document.querySelector('.cq-bg');
    document.addEventListener('keydown', (e) => {
      if (!mine(e)) return;
      e.preventDefault(); e.stopPropagation();
      if (!e.repeat && anyAnim()) { if (paused) play(); else pause(); }
    }, true);
    document.addEventListener('keyup', (e) => { if (mine(e)) { e.preventDefault(); e.stopPropagation(); } }, true);      // (a focused button would be pressed on the release)
    // Ctrl+C and Ctrl+V copy and paste clips while the window is open (a copy with nothing animated picked is the app's own, of the parts)
    document.addEventListener('keydown', (e) => {
      if (!state._animMode || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || typing(e.target) || away(e.target)) return;
      const k = String(e.key).toLowerCase();
      if (k === 'c') { if (copyClips()) { e.preventDefault(); e.stopPropagation(); } else clipBoard = null; }
      else if (k === 'v') { if (clipBoard && clipBoard.length) { e.preventDefault(); e.stopPropagation(); pasteClips(); } }
    }, true);
  }
  // ---- for Claude (the animate_parts tool): which parts or groups move in the video, and how ----
  const num = (v, k, d) => { const x = clampKey(k, v); return x == null ? d : x; };
  const pickEnum = (v, list, d) => { const x = String(v == null ? '' : v).toLowerCase(); return list.find(e => e.toLowerCase() === x) || d; };
  function fromArgs(a) {
    const type = pickEnum(a.type, Object.keys(TYPES).filter(k => !KEYED.has(k)), 'spin');
    const D = DEFAULTS, p = { ...D[type] };
    if (type === 'spin' || type === 'swing') p.axis = pickEnum(a.axis, ['X', 'Y', 'Z'], D[type].axis).toUpperCase();
    if (type === 'spin') { p.dir = /^(counter|ccw|anti)/i.test(String(a.direction || '')) ? 1 : /^(clock|cw)/i.test(String(a.direction || '')) ? -1 : D.spin.dir; p.rpm = num(a.rpm, 'rpm', D.spin.rpm); }
    if (type === 'swing') { p.amp = num(a.angle_degrees, 'amp', D.swing.amp); p.period = num(a.seconds, 'period', D.swing.period); }
    if (type === 'noise') {
      p.type = pickEnum(a.noise_type, ['wave', 'random', 'steps'], D.noise.type);
      p.pos = num(a.shift_mm, 'pos', D.noise.pos); p.rot = num(a.turn_degrees, 'rot', D.noise.rot); p.speed = num(a.speed, 'speed', D.noise.speed);
      p.seed = Math.round(num(a.seed, 'seed', D.noise.seed)); p.detail = Math.round(num(a.detail, 'detail', D.noise.detail)); p.rough = num(a.roughness_percent, 'rough', D.noise.rough);
      const axes = (v, d) => v == null ? d : ['x', 'y', 'z'].filter(c => String(v).toLowerCase().includes(c)).join('');
      p.sx = axes(a.shift_axes, D.noise.sx); p.rx = axes(a.turn_axes, D.noise.rx);
    }
    if (type === 'oscillate') {
      p.wave = pickEnum(a.wave, ['sine', 'piston', 'eased', 'triangle'], D.oscillate.wave); p.period = num(a.seconds, 'period', D.oscillate.period);
      const sh = Array.isArray(a.shift_xyz_mm) ? a.shift_xyz_mm : null, tr = Array.isArray(a.turn_xyz_degrees) ? a.turn_xyz_degrees : null;
      if (sh) { p.tx = num(sh[0], 'tx', 0); p.ty = num(sh[1], 'ty', 0); p.tz = num(sh[2], 'tz', 0); } else if (!tr) { p.tx = D.oscillate.tx; p.ty = D.oscillate.ty; p.tz = D.oscillate.tz; } else { p.tx = p.ty = p.tz = 0; }
      if (tr) { p.ax = num(tr[0], 'ax', 0); p.ay = num(tr[1], 'ay', 0); p.az = num(tr[2], 'az', 0); } else { p.ax = p.ay = p.az = 0; }
      p.spread = num(a.axis_lag_degrees, 'spread', D.oscillate.spread); p.lag = num(a.turn_lag_degrees, 'lag', D.oscillate.lag); p.ratio = num(a.rod_ratio, 'ratio', D.oscillate.ratio);
    }
    if (type === 'path') { p.shape = pickEnum(a.shape, Object.keys(SHAPES), D.path.shape); p.plane = pickEnum(a.plane, ['XY', 'XZ', 'YZ'], D.path.plane).toUpperCase(); p.size = num(a.size_mm, 'size', D.path.size); p.period = num(a.seconds, 'period', D.path.period); }
    const L = { ...D.loop };
    L.mode = pickEnum(a.loop_mode, ['loop', 'pingpong', 'once'], L.mode);
    L.repeat = Math.round(num(a.repeats, 'repeat', L.repeat)); L.delay = num(a.delay_seconds, 'delay', L.delay);
    L.from = num(a.loop_from_percent, 'from', L.from); L.to = num(a.loop_to_percent, 'to', L.to);
    return { type, p, loop: L };
  }
  // The parts (by id) and groups (by a piece of the name) a call means.
  function namedTargets(ids, groupNames) {
    const out = [];
    for (const id of ids || []) { const p = exists(id); if (p) out.push({ key: 'p:' + p.partId, kind: 'part', partId: p.partId, p, label: p.name || ('Part ' + p.partId) }); }
    for (const q of (groupNames || []).map(x => String(x).trim().toLowerCase()).filter(Boolean)) {
      for (const n of (state.treeNodes || [])) if (n.kind === 'group' && String(n.name || '').toLowerCase().includes(q)) { const g = groupInfo(String(n.id)); if (g && !out.some(o => o.key === g.key)) out.push(g); }
      for (const ug of (state.userGroups || [])) if (ug && ug.ref && String(ug.name || '').toLowerCase().includes(q)) { const g = groupInfo(String(ug.id)); if (g && !out.some(o => o.key === g.key)) out.push(g); }
    }
    return out;
  }
  const api = {
    add(args) {
      const ts = namedTargets(args.ids, args.groups);
      if (!ts.length) throw new Error('Nothing to animate: give ids or groups that exist.');
      const { type, p, loop: L } = fromArgs(args);
      const r = addTo(ts, type, p, L);
      return { animated: r.n, locked: r.locked, type, settings: p, loop: ['spin', 'path'].includes(type) ? L : undefined };
    },
    remove(args) {
      const ts = namedTargets(args.ids, args.groups);
      const keys = ts.map(t => t.key).filter(k => items.has(k));
      const type = args.type && TYPES[String(args.type).toLowerCase()] ? String(args.type).toLowerCase() : undefined;
      remove(keys, type);
      return { removed_from: keys.length };
    },
    clear() { const n = items.size; remove([...items.keys()]); return { removed_from: n }; },
    stats() { return { animated: items.size, parts_moved_per_frame: stats.parts, ms_per_frame: Math.round(stats.ms * 100) / 100, playing: items.size > 0 && !paused, speed: rate, time: clock }; },
    list() {
      return [...items.values()].map(r => ({
        kind: r.kind === 'group' ? 'group' : 'part', name: r.label, id: r.kind === 'part' ? r.partId : undefined, parts: r.kind === 'group' ? r.members.length : undefined,
        layers: r.layers.map(l => ({ type: l.type, ...l.p, ...(['spin', 'path'].includes(l.type) ? { loop: l.loop } : {}), summary: summary(l) })),
      }));
    },
  };
  window.__moAnimStats = () => api.stats();
  window.__moAnimPlay = () => ctl.toggle();      // (tests/e2e-animate.mjs: Play is the user's, adding never starts it)
  window.__moAnimData = { save: () => serialize(), load: (d) => deserialize(d), snap: () => snapStr() };      // (tests/e2e-animate.mjs)      // (tests/e2e-animate.mjs)
  // What the Animation card of the right sidebar reads and does (the same things as the timeline's own buttons).
  const ctl = {
    info: () => ({ n: anyAnim() ? items.size + sceneN() : 0, playing: anyAnim() && !paused && !suspended, clock, dur: durOf(), rate, loop: playLoop, reverse, mode: !playLoop ? 'once' : pingpong ? 'pingpong' : 'loop', ver, open: shown() }),
    setMode: (m) => { playLoop = m !== 'once'; pingpong = m === 'pingpong'; bounce = 1; saveTl(); try { updatePlaybar(); } catch (_) {} },
    // the clips as spans of the timeline, for the card's miniature: [{ a, b, type, muted }]
    clips: () => { const D = durOf(), out = []; for (const rec of items.values()) for (const l of rec.layers) { if (l.keys) { if (!l.keys.length) continue; out.push({ a: l.keys[0].t, b: Math.max(l.keys[0].t + 0.05, l.keys[l.keys.length - 1].t), type: l.type, muted: !!l.muted }); continue; } const g = barGeom(l, D); out.push({ a: g.start, b: Math.min(D, g.end), type: l.type, muted: !!l.muted }); } return out; },
    setReverse: (b) => { reverse = !!b; if (!paused) { last = performance.now(); } try { updatePlaybar(); } catch (_) {} },
    toEnd: () => { if (!paused) pause(); seekTo(durOf()); },
    // the camera: keys of the view are on the timeline like any others; the switch lets them play or not
    sceneKeys: () => { const out = []; for (const nm of ['camera', 'explode']) { const tr = tracks[nm]; if (tr) for (const k of tr.keys) out.push({ t: k.t, name: nm, muted: !!tr.muted }); } return out; },
    camera: () => { const tr = tracks.camera, has = !!(tr && tr.keys.length); return { has, on: has && !tr.muted, keys: has ? tr.keys.length : 0 }; },
    setCamera: (on) => { const tr = tracks.camera; if (!tr || !tr.keys.length) return; tr.muted = !on; ver++; sync(true); commit('Switch'); },
    addCameraKey: () => { addSceneKey('camera'); const tr = tracks.camera; if (tr && tr.muted) { tr.muted = false; ver++; sync(true); } },
    toggle: () => { if (!anyAnim()) return; if (paused) play(); else pause(); },
    rewind: () => rewind(),
    seek: (sec) => { if (!paused) pause(); seekTo(sec); },
    setRate: (r) => { rate = r; try { updatePlaybar(); } catch (_) {} },
    setLoop: (b) => { playLoop = !!b; saveTl(); try { updatePlaybar(); } catch (_) {} },
    openTimeline: () => { if (!shown()) open(); },
    fmt: (t) => fmtTC(t),
    rates: RATES,
  };
  window.__moAnimTest = { api, ctl, refresh, sel: () => ({ lids: [...selLids], lid: selLid }) };      // (tests/e2e-animate-rest.mjs)
  return { ctl, open, closeAll, toggle, suspend, resume, reset, run, bake, remove, hold, seek, pause, play, exit, rewind, refresh, api, serialize, deserialize, hasScene: () => sceneN() > 0, count: () => items.size + sceneN(), isPlaying: () => anyAnim() && !paused, fps: () => projFps };
})();
}
