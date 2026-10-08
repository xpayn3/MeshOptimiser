// Performance driver: measures the app in a real Chrome window through the
// DevTools protocol. Frame rates only mean something in a window that is
// actually painting, so start one first (a separate profile; it must stay
// visible, the flags stop Chrome from slowing it down when it is not in front):
//
//   chrome --remote-debugging-port=9333 --user-data-dir=<any empty folder> \
//     --disable-backgrounding-occluded-windows --disable-renderer-backgrounding \
//     --disable-background-timer-throttling --window-size=1920,1080 \
//     "http://localhost:4242/?file=inbox/<model>.glb"
//
// Then, from this folder (a script file is the body of an async function and
// returns a value; stress-core.js must be evaluated once per page load, it
// sets up window.__stress):
//
//   node cdp.mjs nav <url>                      load a page
//   node cdp.mjs eval <file.js> [timeoutSec]    run a script in the page, print what it returns
//   node cdp.mjs prof <file.js> [rows]          the same under the CPU profiler: self and inclusive time per function
//   node cdp.mjs gesture <gestures.json>        real mouse / wheel / key input; prints animation-frame gaps per gesture
//                                               (PROF=30 adds a CPU profile, TRACE=20 the browser's own layout / paint
//                                               time on the page's main thread, TRACEALL=1 every busy browser thread,
//                                               ONLY=<regex> runs the gestures whose name matches)
//   node cdp.mjs shot <out.png>                 screenshot
//
// A gesture file is [{ name, before?, events: [...], settle?, after? }], where
// each event is an Input.dispatchMouseEvent (or, with kind:'key', a key event)
// plus `wait` in ms; `before` and `after` are script bodies run in the page.
//
// In the page, window.__stress gives: step(name, fn) to time one action,
// frameCost() for the cost of a frame measured around the renderer itself,
// rafFps() for what the screen really gets, mem(), table().
//
// Needs Node 22 or newer: the connection to Chrome uses the WebSocket that is
// built into Node from that version on (no package to install). On an older
// Node it stops at "WebSocket is not defined".
import fs from 'node:fs';
const PORT = process.env.CDP_PORT || 9333;
const [, , cmd, arg, arg2] = process.argv;
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = targets.find(t => t.type === 'page' && /localhost:\d+/.test(t.url)) || targets.find(t => t.type === 'page');
if (!page) { console.error('no page'); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// Prints a CPU profile as self time and inclusive time per function, the top
// N rows of each. `hide` is the rows left out of the two lists.
const summarise = (pr, N = 30, hide = /^\(idle\)|^\(root\)/) => {
  const byId = new Map(pr.nodes.map(n => [n.id, n]));
  const parent = new Map(); for (const n of pr.nodes) for (const c of (n.children || [])) parent.set(c, n.id);
  const self = new Map(), incl = new Map();
  const dts = pr.timeDeltas; let total = 0;
  const key = (n) => `${n.callFrame.functionName || '(anon)'} ${(n.callFrame.url || '').split('/').pop().split('?')[0]}:${n.callFrame.lineNumber + 1}`;
  pr.samples.forEach((id, i) => {
    const dt = (dts[i] || 0) / 1000; total += dt;
    const k = key(byId.get(id));
    self.set(k, (self.get(k) || 0) + dt);
    const seen = new Set(); let cur = id;
    while (cur !== undefined) { const kk = key(byId.get(cur)); if (!seen.has(kk)) { seen.add(kk); incl.set(kk, (incl.get(kk) || 0) + dt); } cur = parent.get(cur); }
  });
  const fmt = (m) => [...m.entries()].filter(([k]) => !hide.test(k)).sort((a, b) => b[1] - a[1]).slice(0, N).map(([k, v]) => v.toFixed(1).padStart(8) + '  ' + k).join('\n');
  console.log('total ms', total.toFixed(0), ' idle', (self.get('(idle) :1') || 0).toFixed(0));
  console.log('--- SELF\n' + fmt(self)); console.log('--- INCLUSIVE\n' + fmt(incl));
};
try {
  if (cmd === 'eval') {
    const src = fs.readFileSync(arg, 'utf8');
    const r = await send('Runtime.evaluate', { expression: `(async () => {\n${src}\n})()`, awaitPromise: true, returnByValue: true, timeout: (+arg2 || 120) * 1000 });
    if (r.error) console.log('CDP ERROR', JSON.stringify(r.error));
    else if (r.result.exceptionDetails) console.log('EXCEPTION', r.result.exceptionDetails.exception?.description || JSON.stringify(r.result.exceptionDetails));
    else { const v = r.result.result.value; console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 1)); }
  } else if (cmd === 'prof') {
    // CPU profile around the file's evaluation; prints self time and inclusive time per function.
    const src = fs.readFileSync(arg, 'utf8');
    await send('Profiler.enable'); await send('Profiler.setSamplingInterval', { interval: 100 }); await send('Profiler.start');
    const r = await send('Runtime.evaluate', { expression: `(async () => {\n${src}\n})()`, awaitPromise: true, returnByValue: true });
    const pr = (await send('Profiler.stop')).result.profile;
    if (r.result?.exceptionDetails) console.log('EXCEPTION', r.result.exceptionDetails.exception?.description);
    else console.log('RESULT', JSON.stringify(r.result?.result?.value));
    // (here the browser's own "(program)" time is left out of the lists as well)
    summarise(pr, +arg2 || 30, /^\(idle\)|^\(program\)|^\(root\)/);
  } else if (cmd === 'gesture') {
    // node cdp.mjs gesture <gestures.json>   [{name, events:[...mouse/key events...], settle}]
    // Real input through the browser; reports animation-frame gaps while each gesture ran.
    const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
    const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
    const traceEv = [];
    if (process.env.TRACE) {
      const prev = ws.onmessage;
      ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.method === 'Tracing.dataCollected') traceEv.push(...d.params.value); else if (d.method === 'Tracing.tracingComplete') pending.get('trace')?.(); else prev(m); };
      await send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink', 'cc', 'gpu', 'v8'] } });
    }
    if (process.env.PROF) { await send('Profiler.enable'); await send('Profiler.setSamplingInterval', { interval: 100 }); await send('Profiler.start'); }
    for (const g of JSON.parse(fs.readFileSync(arg, 'utf8'))) {
      if (only && !only.test(g.name)) continue;
      if (g.before) await ev(`(async()=>{${g.before}})()`);
      await ev('window.__stress.g0 = performance.now()');
      for (const e of g.events) {
        const { wait, vk, kind, ...p } = e;
        if (kind === 'key') await send('Input.dispatchKeyEvent', { windowsVirtualKeyCode: vk, ...p });
        else await send('Input.dispatchMouseEvent', { button: 'none', ...p });
        if (wait) await sleep(wait);
      }
      await sleep(g.settle ?? 120);
      const r = await ev(`(() => { const S = window.__stress, t0 = S.g0, t1 = performance.now(); const f = S.frames.filter(x => x.t >= t0 && x.t <= t1).map(x => x.d); const s = [...f].sort((a,b)=>a-b); const long = S.long.filter(l => l.t + l.d >= t0 && l.t <= t1).map(l => Math.round(l.d)); return { frames: f.length, ms: Math.round(t1 - t0), over20: f.filter(d => d > 20).length, over34: f.filter(d => d > 34).length, p95: s.length ? +s[Math.floor(s.length*0.95)].toFixed(1) : null, max: s.length ? +s[s.length-1].toFixed(1) : null, long, extra: ${g.after ? `(()=>{${g.after}})()` : 'null'} }; })()`);
      console.log(g.name.padEnd(44), JSON.stringify(r));
    }
    if (process.env.TRACE) {
      const done = new Promise(r => pending.set('trace', r));
      await send('Tracing.end'); await done;
      // self time per event name on the busiest thread (the page's main thread)
      const byThread = new Map();
      for (const e of traceEv) if (e.ph === 'X' && e.dur) { const k = e.pid + ':' + e.tid; byThread.set(k, (byThread.get(k) || 0) + (e.name === 'RunTask' ? e.dur : 0)); }
      const mains = traceEv.filter(e => e.ph === 'M' && e.name === 'thread_name' && e.args?.name === 'CrRendererMain').map(e => e.pid + ':' + e.tid);
      const main = mains.sort((a, b) => (byThread.get(b) || 0) - (byThread.get(a) || 0))[0] || [...byThread.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const evs = traceEv.filter(e => e.ph === 'X' && e.dur && (e.pid + ':' + e.tid) === main).sort((a, b) => a.ts - b.ts || b.dur - a.dur);
      const self = new Map(), cnt = new Map(); const stack = [];
      for (const e of evs) {
        while (stack.length && stack[stack.length - 1].end <= e.ts) stack.pop();
        if (stack.length) stack[stack.length - 1].child += e.dur;
        const fr = { name: e.name, end: e.ts + e.dur, child: 0, dur: e.dur, _e: e }; stack.push(fr); e._fr = fr;
      }
      for (const e of evs) { const sdur = e.dur - Math.min(e.dur, e._fr.child); self.set(e.name, (self.get(e.name) || 0) + sdur); cnt.set(e.name, (cnt.get(e.name) || 0) + 1); }
      console.log('--- TRACE main thread, self ms (count)');
      console.log([...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, +process.env.TRACE > 1 ? +process.env.TRACE : 22).map(([k, v]) => (v / 1000).toFixed(1).padStart(9) + '  ' + k + ' (' + cnt.get(k) + ')').join('\n'));
      if (process.env.TRACEALL) {
        const names = new Map(); for (const e of traceEv) if (e.ph === 'M' && e.name === 'thread_name') names.set(e.pid + ':' + e.tid, e.args?.name);
        const per = new Map();
        for (const e of traceEv) if (e.ph === 'X' && e.dur) { const k = e.pid + ':' + e.tid; if (!per.has(k)) per.set(k, []); per.get(k).push(e); }
        const rows = [];
        for (const [k, list] of per) {
          list.sort((a, b) => a.ts - b.ts || b.dur - a.dur);
          const st = [], selfm = new Map(); let top = 0;
          for (const e of list) { while (st.length && st[st.length - 1].end <= e.ts) st.pop(); if (st.length) st[st.length - 1].child += e.dur; else top += e.dur; const fr = { end: e.ts + e.dur, child: 0, e }; st.push(fr); e.__f = fr; }
          for (const e of list) selfm.set(e.name, (selfm.get(e.name) || 0) + e.dur - Math.min(e.dur, e.__f.child));
          const idle = /Sleep|WaitForVSync|ThreadPool_RunWorker$|MessagePumpForUI/;
          const busy = [...selfm.entries()].filter(([n]) => !idle.test(n));
          rows.push({ k, name: names.get(k), busy: busy.reduce((a, b) => a + b[1], 0), top: busy.sort((a, b) => b[1] - a[1]).slice(0, 7) });
        }
        rows.sort((a, b) => b.busy - a.busy);
        for (const r of rows.slice(0, 6)) console.log(`== ${r.name} busy ${(r.busy / 1000).toFixed(0)} ms: ` + r.top.map(([n, v]) => `${n} ${(v / 1000).toFixed(1)}`).join(' | '));
      }
      if (process.env.TRACEOUT) fs.writeFileSync(process.env.TRACEOUT, JSON.stringify(evs.map(({ _fr, ...e }) => e)));
    }
    if (process.env.PROF) summarise((await send('Profiler.stop')).result.profile, +process.env.PROF > 1 ? +process.env.PROF : 30);
  } else if (cmd === 'nav') {
    await send('Page.enable'); await send('Page.navigate', { url: arg }); await sleep(500); console.log('navigated');
  } else if (cmd === 'shot') {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(arg, Buffer.from(r.result.data, 'base64')); console.log('saved', arg);
  } else if (cmd === 'mouse') {
    for (const e of JSON.parse(fs.readFileSync(arg, 'utf8'))) {
      const { wait, ...p } = e;
      await send('Input.dispatchMouseEvent', { button: 'none', ...p });
      if (wait) await sleep(wait);
    }
    console.log('ok');
  } else if (cmd === 'key') {
    for (const e of JSON.parse(fs.readFileSync(arg, 'utf8'))) {
      const { wait, vk, ...p } = e;
      await send('Input.dispatchKeyEvent', { windowsVirtualKeyCode: vk, ...p });
      if (wait) await sleep(wait);
    }
    console.log('ok');
  }
} finally { ws.close(); }
process.exit(0);
