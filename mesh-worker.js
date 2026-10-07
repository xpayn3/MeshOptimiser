// mesh-worker.js — heavy per-mesh work off the main thread.
//
// The app keeps a small pool of these (see _MeshWorkers in app-v2.js) and
// hands each one mesh at a time: plain typed arrays in, plain typed arrays
// out. Nothing here touches three.js or the page.
//
//   { op: 'fill',     positions, index, opts }            → what fillFlatHoles returns
//   { op: 'simplify', positions, index, groups, keep, url } → index ranges per material group
//
// Every reply carries the request's id and ok: true / false.

import { fillFlatHoles } from './holefill.js?v=8';

let simplifier = null;          // meshoptimizer's simplifier, loaded on first use
async function getSimplifier(url) {
  if (simplifier) return simplifier;
  const mod = await import(url);
  await mod.MeshoptSimplifier.ready;
  if (!mod.MeshoptSimplifier.supported) throw new Error('meshoptimizer is not supported here');
  simplifier = mod.MeshoptSimplifier;
  return simplifier;
}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.op === 'fill') {
      const res = fillFlatHoles(m.positions, m.index, m.opts);
      const out = { id: m.id, ok: true, res };
      const transfer = [];
      if (res.removed) transfer.push(res.removed.buffer, res.caps.buffer, res.capOwner.buffer);
      self.postMessage(out, transfer);
      return;
    }
    if (m.op === 'simplify') {
      const S = await getSimplifier(m.url);
      const parts = [], transfer = [];
      for (const g of m.groups) {
        const sub = m.index.subarray(g.start, g.start + g.count);
        const target = Math.max(3, Math.floor((sub.length / 3) * m.keep) * 3);
        let idx;
        if (sub.length <= target) idx = sub.slice();
        else {
          // Open edges are locked first so outlines don't creep. If that
          // stops the reduction well short of the target (a mesh that is
          // mostly border), run again without the lock.
          let res = S.simplify(sub, m.positions, 3, target, 1.0, ['LockBorder'])[0];
          if (res.length > target * 1.25) {
            const free = S.simplify(sub, m.positions, 3, target, 1.0)[0];
            if (free.length < res.length) res = free;
          }
          idx = res.slice();                       // off the WASM heap, into a buffer of its own
        }
        parts.push({ idx, materialIndex: g.materialIndex });
        transfer.push(idx.buffer);
      }
      self.postMessage({ id: m.id, ok: true, parts }, transfer);
      return;
    }
    throw new Error('unknown op ' + m.op);
  } catch (err) {
    self.postMessage({ id: m.id, ok: false, error: String((err && err.message) || err) });
  }
};
