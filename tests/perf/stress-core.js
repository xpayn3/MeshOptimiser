// Stress harness core — evaluated in the live app by cdp.mjs (see its header).
// window.__stress.step(name, fn) times one user-level action:
//   sync   – time fn() itself held the main thread (ms)
//   settle – time until two animation frames have been presented after it
//   long   – long tasks (>50 ms) seen during the step
//   gap    – the longest gap between animation frames during the step
(() => {
  if (window.__stress) return;
  const S = window.__stress = { rows: [], long: [], frames: [] };
  const F = () => window._appFns;
  try {
    new PerformanceObserver(l => { for (const e of l.getEntries()) S.long.push({ t: e.startTime, d: e.duration }); })
      .observe({ entryTypes: ['longtask'] });
  } catch (_) {}
  let last = performance.now();
  const loop = (t) => { S.frames.push({ t, d: t - last }); if (S.frames.length > 4000) S.frames.splice(0, 2000); last = t; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  S.sleep = (ms) => new Promise(r => setTimeout(r, ms));
  S.raf = () => new Promise(r => requestAnimationFrame(r));
  S.scene = () => { let s = state.partsRoot; while (s.parent) s = s.parent; return s; };
  S.gpuDone = async () => { const d = F().renderer?.backend?.device; if (d?.queue?.onSubmittedWorkDone) await d.queue.onSubmittedWorkDone(); };
  S.step = async (name, fn, { settleMs = 0 } = {}) => {
    const t0 = performance.now();
    let err = null, ret;
    try { ret = await fn(); } catch (e) { err = String(e && e.message || e); }
    const t1 = performance.now();
    await S.raf(); await S.raf();
    if (settleMs) await S.sleep(settleMs);
    const t2 = performance.now();
    const long = S.long.filter(l => l.t + l.d >= t0 && l.t <= t2).map(l => Math.round(l.d));
    const gaps = S.frames.filter(f => f.t >= t0 && f.t <= t2 + 1).map(f => f.d);
    const row = { name, sync: +(t1 - t0).toFixed(1), settle: +(t2 - t0 - settleMs).toFixed(1), long, gap: gaps.length ? +Math.max(...gaps).toFixed(1) : null };
    if (err) row.err = err;
    if (ret !== undefined && typeof ret !== 'object') row.ret = ret;
    S.rows.push(row);
    return row;
  };
  // Cost of one frame, measured around the renderer itself so a throttled
  // window cannot hide it: cpu = renderer.render(), gpu = until the GPU is done.
  S.frameCost = async (n = 40, orbit = true) => {
    const { renderer, camera, controls, THREE } = F();
    const scene = S.scene(), cpu = [], tot = [];
    const axis = new THREE.Vector3(0, 0, 1), off = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      if (orbit) { off.copy(camera.position).sub(controls.target).applyAxisAngle(axis, 0.02); camera.position.copy(controls.target).add(off); camera.lookAt(controls.target); camera.updateMatrixWorld(); }
      const t0 = performance.now();
      renderer.render(scene, camera);
      const t1 = performance.now();
      await S.gpuDone();
      const t2 = performance.now();
      cpu.push(t1 - t0); tot.push(t2 - t0);
    }
    const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(2); };
    const i = renderer.info;
    return { cpuMed: q(cpu, 0.5), cpuP95: q(cpu, 0.95), totMed: q(tot, 0.5), totP95: q(tot, 0.95), calls: i.render?.calls ?? i.render?.drawCalls, tris: i.render?.triangles, dpr: renderer.getPixelRatio() };
  };
  // What the screen really gets: animation frames while the scene is redrawn
  // every frame for `ms` (window must be focused).
  S.rafFps = async (ms = 2000) => {
    const { camera, controls, THREE, requestRender } = F();
    const axis = new THREE.Vector3(0, 0, 1), off = new THREE.Vector3(), d = [];
    const t0 = performance.now(); let prev = t0;
    while (performance.now() - t0 < ms) {
      off.copy(camera.position).sub(controls.target).applyAxisAngle(axis, 0.01); camera.position.copy(controls.target).add(off); camera.lookAt(controls.target);
      requestRender();
      const t = await S.raf(); d.push(t - prev); prev = t;
    }
    d.shift();
    const s = [...d].sort((a, b) => a - b);
    return { fps: +(1000 / (d.reduce((a, b) => a + b, 0) / d.length)).toFixed(1), med: +s[s.length >> 1].toFixed(1), p95: +s[Math.floor(s.length * 0.95)].toFixed(1), max: +s[s.length - 1].toFixed(1), n: d.length };
  };
  S.mem = () => ({ heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, geoms: F().renderer.info.memory?.geometries, parts: state.parts.filter(p => !p.deleted).length, rows: document.querySelectorAll('#tree .tree-node').length, dom: document.getElementsByTagName('*').length });
  S.table = () => S.rows.map(r => `${r.name.padEnd(46)} sync ${String(r.sync).padStart(8)}  settle ${String(r.settle).padStart(8)}  gap ${String(r.gap).padStart(7)}  long [${r.long.join(',')}]${r.err ? '  ERR ' + r.err : ''}`).join('\n');
})();
return 'stress harness ready';
