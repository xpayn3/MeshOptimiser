// STEP Optimizer — viewport stress test.
//
// Usage (paste into DevTools console once the app has finished booting):
//   await StressTest.run()                              // 3000 mixed parts
//   await StressTest.run({ parts: 10000 })              // bigger
//   await StressTest.run({ parts: 50000 })              // torture
//   await StressTest.run({ parts: 5000, sharedGeom: 30 }) // GLB-style instancing scenario
//
// Returns an object with all metrics (also logged to console). Tears down via
// the app's clearModel() so save your real model first.
//
// What's measured:
//   buildMs       — synthetic scene construction time
//   orbit.avgMs   — mean frame time during a 120-frame scripted camera arc
//   orbit.p95/p99 — frame-time tail (jitter signal)
//   draws         — draw calls per frame after build (renderer.info.render.calls)
//   sel.ms        — wall-clock for select-all + highlight repaint
//   instancedBoundsIssues — InstancedMesh bounds that don't enclose all instances
//                           (catches the "groups disappear at angle" bug)

(function attach() {
  if (typeof window === 'undefined') return;

  function fns() {
    if (!window._appFns) throw new Error('App not booted yet — wait for the loader to finish.');
    return window._appFns;
  }
  function THREE() { return fns().THREE; }
  function st()    { return window.state; }

  function makeBox(sx, sy, sz)       { return new (THREE().BoxGeometry)(sx, sy, sz, 1, 1, 1); }
  function makeCyl(r, h)             { return new (THREE().CylinderGeometry)(r, r, h, 16, 1); }
  function makeSph(r)                { return new (THREE().SphereGeometry)(r, 24, 16); }
  function makeTor(r, t)             { return new (THREE().TorusGeometry)(r, t, 16, 32); }

  function buildScene({ parts = 3000, sharedGeom = 0 } = {}) {
    const T = THREE();
    const S = st();
    if (!S?.partsRoot) throw new Error('App state not initialised.');

    fns().clearModel();
    // clearModel queues old resources for deferred dispose; the build below
    // creates fresh ones so there's no contention.

    const partsRoot = S.partsRoot;
    const overallBox = new T.Box3();
    let totalTris = 0, totalVerts = 0;

    // Palette: when sharedGeom > 0, every part picks from a small set so the
    // GLB-style auto-instancing path has something to coalesce.
    const palette = [];
    if (sharedGeom > 0) {
      for (let i = 0; i < sharedGeom; i++) {
        const pick = i % 4;
        const g = pick === 0 ? makeBox(1 + Math.random() * 2, 1 + Math.random() * 2, 1 + Math.random() * 2)
                : pick === 1 ? makeCyl(0.5 + Math.random(), 1 + Math.random() * 3)
                : pick === 2 ? makeSph(0.6 + Math.random())
                :              makeTor(0.8 + Math.random(), 0.2 + Math.random() * 0.3);
        g.computeBoundingBox(); g.computeBoundingSphere();
        palette.push(g);
      }
    }

    const t0 = performance.now();
    const side = Math.ceil(Math.cbrt(parts));
    const spacing = 4;

    for (let i = 0; i < parts; i++) {
      let geom;
      if (sharedGeom > 0) {
        geom = palette[i % palette.length];
      } else {
        const pick = i % 4;
        geom = pick === 0 ? makeBox(1 + (i % 5), 1 + ((i * 3) % 5), 1 + ((i * 7) % 5))
             : pick === 1 ? makeCyl(0.5 + (i % 3) * 0.3, 1 + (i % 4))
             : pick === 2 ? makeSph(0.5 + (i % 5) * 0.2)
             :              makeTor(0.8 + (i % 3) * 0.3, 0.2 + (i % 4) * 0.1);
        geom.computeBoundingBox(); geom.computeBoundingSphere();
      }

      const colorKey = (i * 137) & 0xff;
      const r = ((colorKey * 7) & 0xff) / 255;
      const g = ((colorKey * 13) & 0xff) / 255;
      const b = ((colorKey * 19) & 0xff) / 255;
      const colorHex = (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
      let mat = S.materialByColor.get(colorHex);
      if (!mat) {
        mat = new T.MeshStandardMaterial({ color: new T.Color(r, g, b), metalness: 0.15, roughness: 0.55, side: T.DoubleSide });
        S.materialByColor.set(colorHex, mat);
      }

      const mesh = new T.Mesh(geom, mat);
      mesh.userData.partId = i;
      const ix = i % side;
      const iy = Math.floor(i / side) % side;
      const iz = Math.floor(i / (side * side));
      mesh.position.set((ix - side / 2) * spacing, (iy - side / 2) * spacing, (iz - side / 2) * spacing);
      mesh.updateMatrix();
      partsRoot.add(mesh);

      const triCount = (geom.index ? geom.index.count : geom.attributes.position.count) / 3;
      const vertCount = geom.attributes.position.count;
      totalTris += triCount; totalVerts += vertCount;
      const bbox = geom.boundingBox.clone();
      mesh.updateWorldMatrix(true, false);
      bbox.applyMatrix4(mesh.matrixWorld);
      if (!bbox.isEmpty()) overallBox.union(bbox);

      S.parts.push({
        partId: i, name: `stress_${i}`, hash: geom.uuid,
        triCount, vertCount, bbox,
        sizeMetrics: { diag: bbox.getSize(new T.Vector3()).length(), vol: 1, max: 1 },
        visible: true, deleted: false, flagged: false,
        originalColor: new T.Color(r, g, b), mesh, group: null, instanceIndex: -1, instancedMesh: null,
      });
      if (!S.geomByHash.has(geom.uuid)) S.geomByHash.set(geom.uuid, geom);
    }

    partsRoot.updateMatrixWorld(true);
    const buildMs = performance.now() - t0;

    fns().reindexParts();
    fns().applyPerfMode();
    fns().fitToView();

    return { buildMs, totalTris, totalVerts, overallBox };
  }

  async function orbitBenchmark(frames = 120) {
    const T = THREE();
    const cam = fns().camera;
    const ctrls = fns().controls;
    if (!cam) { console.warn('[stresstest] camera not available'); return null; }

    const target = ctrls?.target?.clone?.() || new T.Vector3();
    const start = cam.position.clone();
    const r = start.distanceTo(target) || 100;
    const upZ = start.z;

    const frameTimes = [];
    let lastT = performance.now();
    for (let i = 0; i < frames; i++) {
      const ang = (i / frames) * Math.PI * 2;
      cam.position.set(target.x + Math.cos(ang) * r, target.y + Math.sin(ang) * r, upZ);
      cam.lookAt(target);
      fns().requestRender();
      await new Promise(r => requestAnimationFrame(r));
      const now = performance.now();
      frameTimes.push(now - lastT);
      lastT = now;
    }
    // Restore camera so we don't strand the user mid-orbit.
    cam.position.copy(start);
    cam.lookAt(target);
    fns().requestRender();

    frameTimes.sort((a, b) => a - b);
    const p = (q) => frameTimes[Math.min(frameTimes.length - 1, Math.floor(frameTimes.length * q))];
    const avg = frameTimes.reduce((s, v) => s + v, 0) / frameTimes.length;
    return {
      frames,
      avgMs: avg,
      fps: 1000 / avg,
      p50Ms: p(0.5),
      p95Ms: p(0.95),
      p99Ms: p(0.99),
      maxMs: frameTimes[frameTimes.length - 1],
    };
  }

  // Idle benchmark: with render-on-demand, a static scene should produce
  // ZERO frames in 1 second (FPS counter ticks but renderer.info.render.calls
  // shouldn't grow). If it grows, something is dirtying needsRender every frame.
  async function idleCheck(ms = 1000) {
    const r = fns().renderer;
    if (!r?.info?.render) return null;
    const startCalls = r.info.render.calls;
    const startFrame = r.info.render.frame ?? 0;
    fns().requestRender(); // baseline frame
    await new Promise(res => requestAnimationFrame(res));
    await new Promise(res => requestAnimationFrame(res));
    const baselineCalls = r.info.render.calls;
    await new Promise(res => setTimeout(res, ms));
    const endCalls = r.info.render.calls;
    return {
      idleMs: ms,
      framesRenderedDuringIdle: Math.max(0, (r.info.render.frame ?? 0) - startFrame - 2),
      drawsBeforeIdle: baselineCalls,
      drawsAfterIdle: endCalls,
      drawsDelta: endCalls - baselineCalls,
    };
  }

  function checkInstancedBounds() {
    const T = THREE();
    const issues = [];
    for (const g of (st()?.instancedGroups || [])) {
      const inst = g.instanced;
      if (!inst || !inst.geometry) continue;
      const bs = inst.geometry.boundingSphere;
      if (!bs) { issues.push({ name: inst.name, reason: 'no boundingSphere' }); continue; }
      const m = new T.Matrix4();
      const v = new T.Vector3();
      let maxOver = 0;
      const N = inst.count;
      for (let k = 0; k < N; k++) {
        inst.getMatrixAt(k, m);
        v.setFromMatrixPosition(m);
        const d = v.distanceTo(bs.center);
        if (d > bs.radius + 1e-3) maxOver = Math.max(maxOver, d - bs.radius);
      }
      if (maxOver > 0) issues.push({ name: inst.name, instances: N, maxOverflow: maxOver, sphereRadius: bs.radius });
    }
    return issues;
  }

  async function selectAllBenchmark() {
    const S = st();
    if (!S?.parts?.length) return null;
    const t0 = performance.now();
    S.selected = new Set(S.parts.map(p => p.partId));
    fns().applySelectionColors();
    await new Promise(r => requestAnimationFrame(r));
    await new Promise(r => requestAnimationFrame(r));
    const t1 = performance.now();
    return { ms: t1 - t0, count: S.selected.size };
  }

  async function run(opts = {}) {
    console.group('[stresstest] starting', opts);
    const build = buildScene(opts);
    console.log(`build: ${st().parts.length.toLocaleString()} parts, ` +
                `${build.totalTris.toLocaleString()} tris in ${build.buildMs.toFixed(0)} ms`);

    await new Promise(r => setTimeout(r, 250)); // let initial frames settle

    const idle = await idleCheck(800);
    if (idle) {
      const verdict = idle.drawsDelta === 0 ? 'OK (idle truly idle)'
                    : `LEAK — ${idle.drawsDelta} extra draws during idle window`;
      console.log(`idle: ${verdict}`);
    }

    const orbit = await orbitBenchmark(120);
    if (orbit) {
      console.log(`orbit: ${orbit.fps.toFixed(0)} fps avg | p95 ${orbit.p95Ms.toFixed(2)} ms | ` +
                  `p99 ${orbit.p99Ms.toFixed(2)} ms | max ${orbit.maxMs.toFixed(2)} ms`);
    }

    const r = fns().renderer;
    const draws = r?.info?.render?.calls;
    if (draws != null) console.log(`draws/frame: ${draws}`);

    const sel = await selectAllBenchmark();
    if (sel) console.log(`select-all repaint (${sel.count} parts): ${sel.ms.toFixed(0)} ms`);

    const issues = checkInstancedBounds();
    if (issues.length === 0) console.log('InstancedMesh bounds: OK');
    else console.warn('InstancedMesh bounds: FAIL', issues);

    console.groupEnd();
    return { build, idle, orbit, draws, sel, instancedBoundsIssues: issues };
  }

  window.StressTest = { run, buildScene, orbitBenchmark, idleCheck, selectAllBenchmark, checkInstancedBounds };
  console.log('[stresstest] loaded — call: await StressTest.run({ parts: 5000 })');
})();
