/* ========== MESHOPTIMISER SITE: REPORT A PROBLEM ==========
   The script of report.html. A report is put together here, in the browser:
   nothing leaves the computer until one of the send buttons is pressed, and
   the model file never does unless the person adds it themselves.

   There is no server behind this site, so there are four ways out:
     - Send       the text of the report, through the same form service the
                  portfolio's contact form uses (no files);
     - Download   everything as one .zip (report, logs, pictures, files), to
                  attach to an email or an issue;
     - GitHub     a new issue with the text filled in (public);
     - Email      a message with the text filled in.
   Written by hand, not generated. Bump RP_V in tools/build-app-site.js when
   this file changes. */
(() => {
  'use strict';

  const CONFIG = {
    endpoint: 'https://api.web3forms.com/submit',
    accessKey: 'd40b8189-988b-4e6f-83db-6c8b8b386e8e',   // the portfolio's contact-form key: public by design
    email: 'luka.grcar@me.com',
    repo: 'https://github.com/xpayn3/MeshOptimiser',
    maxFileMB: 50,          // a file bigger than this is listed, not put in the zip
    maxZipMB: 150,          // the zip is built in memory
    hashMaxMB: 150,         // the fingerprint of a bigger file is not worked out
    logSend: 6000,          // characters of each log in the sent text (the whole log is in the zip)
    logIssue: 1200,         // ... and in the GitHub issue
    logCopy: 20000,
    draftKey: 'mo-report-draft-v1',
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const form = $('#rp-form');
  if (!form) return;

  // ── what kinds of problem there are, and what helps most for each ──
  const CATS = {
    install: { label: 'It will not install or start', tip: 'Most useful: the text of the launcher window (the black window on Windows, the Terminal on a Mac), the Python version it printed, and your system.', logTab: 'launch' },
    open: { label: 'A file will not open or convert', tip: 'Most useful: the conversion log (the progress card has a Copy log button), the import settings you chose, and the file itself or a smaller file that shows the same problem.', logTab: 'conv' },
    looks: { label: 'The model looks wrong', tip: 'Most useful: a picture of what you see, a picture or a description of what you expected, and the file. Say which view mode you were in.', logTab: 'console' },
    slow: { label: 'It is slow, or freezes', tip: 'Most useful: how big the scene is (parts and triangles), your graphics card, and whether the renderer is WebGPU or WebGL2. The details from Settings, About have all of it.', logTab: 'console' },
    export: { label: 'An export is wrong', tip: 'Most useful: the format and the settings you chose in the Export window, the program you opened the result in, and a picture of what is wrong.', logTab: 'console' },
    tool: { label: 'A tool gives a wrong result', tip: 'Most useful: which tool, the settings you used, a picture before and after, and the file.', logTab: 'console' },
    crash: { label: 'It crashed or shows an error', tip: 'Most useful: the exact words of the error, the log, and what you did just before.', logTab: 'console' },
    other: { label: 'Something else', tip: 'Describe what you did, what you expected and what happened. A picture helps.', logTab: 'conv' },
  };

  // ── small helpers ──
  const val = (id) => { const el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; };
  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  const fmtBytes = (n) => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : n < 1073741824 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1073741824).toFixed(2) + ' GB';
  const slugName = (s) => String(s).toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'file';
  const clip = (text, max) => { text = String(text || ''); if (text.length <= max) return text; const h = Math.floor(max / 2); return text.slice(0, h) + '\n… ' + (text.length - max) + ' characters left out here; the whole text is in the .zip …\n' + text.slice(-h); };
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const pad2 = (n) => String(n).padStart(2, '0');
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
  const stamp = () => { const d = new Date(); return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' + pad2(d.getHours()) + pad2(d.getMinutes()); };
  const newRef = () => { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; const r = crypto.getRandomValues(new Uint8Array(6)); for (const b of r) s += a[b % a.length]; return 'MO-' + s; };
  const safeStore = {
    get() { try { return JSON.parse(localStorage.getItem(CONFIG.draftKey) || 'null'); } catch (_) { return null; } },
    set(v) { try { localStorage.setItem(CONFIG.draftKey, JSON.stringify(v)); } catch (_) {} },
    clear() { try { localStorage.removeItem(CONFIG.draftKey); } catch (_) {} },
  };

  // ── state that is not in a field: the pictures, the files, the reference ──
  const state = { ref: newRef(), shots: [], models: [], sending: false };

  // ───────────────────────── the zip file ─────────────────────────
  // A zip with nothing compressed: the pictures and most logs gain nothing
  // from it, and this is short and has no library behind it.
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const te = new TextEncoder();
  function makeZip(entries) {
    const parts = [], central = []; let offset = 0;
    for (const e of entries) {
      const name = te.encode(e.name), data = e.data, crc = crc32(data), d = e.date || new Date();
      const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
      const date = (((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate());
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.byteLength, true); lh.setUint32(22, data.byteLength, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(lh.buffer, name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, time, true); ch.setUint16(14, date, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, data.byteLength, true); ch.setUint32(24, data.byteLength, true); ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(ch.buffer, name);
      offset += 30 + name.length + data.byteLength;
    }
    const cdSize = central.reduce((s, b) => s + b.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
  }

  // ───────────────────────── reading what the person pasted ─────────────────────────
  // The text of Settings, About, "Copy details": one "Key: value" per line.
  function parseDetails(text) {
    const out = {};
    for (const line of String(text || '').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z ]{2,24}):\s*(.+?)\s*$/);
      if (m) out[m[1].trim().toLowerCase()] = m[2];
    }
    return out;
  }
  function fillFromDetails(text, onlyEmpty) {
    const d = parseDetails(text), put = (id, v) => { if (v && (!onlyEmpty || !val(id))) setVal(id, v); };
    if (d.version) put('f-version', d.version.replace(/^v/i, ''));
    if (d.renderer) { const r = /webgpu/i.test(d.renderer) ? 'WebGPU' : /webgl/i.test(d.renderer) ? 'WebGL2' : ''; if (r && (!onlyEmpty || !val('f-renderer'))) setVal('f-renderer', r); }
    if (d.scene) put('f-scene', d.scene);
    if (d.gpu && !/not available/i.test(d.gpu)) put('f-gpu', d.gpu);
    if (d.browser) {
      const parts = d.browser.split(/\s·\s/);
      put('f-browser', parts.length > 1 ? parts.slice(1).join(' · ') : parts[0]);
      if (parts.length > 1) put('f-os', parts[0]);
    }
  }
  async function thisBrowser() {
    const info = {};
    const brands = navigator.userAgentData && navigator.userAgentData.brands;
    const real = brands && brands.find(x => !/not.?a.?brand|chromium/i.test(x.brand));
    let name = real ? real.brand + ' ' + real.version : '';
    if (!name) { for (const [n, re] of [['Edge', /Edg[/]([0-9.]+)/], ['Firefox', /Firefox[/]([0-9.]+)/], ['Chrome', /Chrome[/]([0-9.]+)/], ['Safari', /Version[/]([0-9.]+)/]]) { const m = navigator.userAgent.match(re); if (m) { name = n + ' ' + m[1]; break; } } }
    info.browser = name || navigator.userAgent.slice(0, 60);
    info.os = (navigator.userAgentData && navigator.userAgentData.platform) || (/Mac/.test(navigator.platform) ? 'macOS' : /Win/.test(navigator.platform) ? 'Windows' : navigator.platform || '');
    info.webgpu = !!navigator.gpu;
    info.screen = screen.width + ' × ' + screen.height + ' at ' + (Math.round(devicePixelRatio * 100) / 100) + '×';
    info.gpu = '';
    try { if (navigator.gpu) { const a = await navigator.gpu.requestAdapter(); const i = a && (a.info || (a.requestAdapterInfo && await a.requestAdapterInfo())); if (i) info.gpu = [i.vendor, i.architecture, i.description].filter(Boolean).join(' '); } } catch (_) {}
    if (!info.gpu) { try { const gl = document.createElement('canvas').getContext('webgl2'), x = gl && gl.getExtension('WEBGL_debug_renderer_info'); if (x) info.gpu = gl.getParameter(x.UNMASKED_RENDERER_WEBGL); } catch (_) {} }
    return info;
  }

  // ───────────────────────── the report itself ─────────────────────────
  const radio = (name) => { const el = form.querySelector('input[name="' + name + '"]:checked'); return el ? el.value : ''; };
  const catKey = () => radio('cat') || '';
  const logs = () => ({ conv: val('f-log-conv'), launch: val('f-log-launch'), console: val('f-log-console') });
  const LOG_LABEL = { conv: 'Conversion log', launch: 'Launcher window', console: 'Browser console' };

  function fields() {
    return {
      ref: state.ref, date: today(), category: catKey(), categoryLabel: (CATS[catKey()] || {}).label || '',
      title: val('f-title'), steps: val('f-steps'), expected: val('f-expected'), actual: val('f-actual'), where: val('f-where'),
      often: val('f-often'), before: val('f-before'),
      version: val('f-version'), os: val('f-os'), browser: val('f-browser'), renderer: val('f-renderer'), gpu: val('f-gpu'), python: val('f-python'), scene: val('f-scene'),
      details: val('f-details'),
      model: radio('model'), modelInfo: val('f-modelinfo'), modelLink: val('f-modellink'),
      email: val('f-email'), name: val('f-name'),
    };
  }
  const row = (k, v) => v ? '| ' + k + ' | ' + String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ') + ' |\n' : '';
  const fence = (t) => '```\n' + String(t).replace(/```/g, "'''") + '\n```\n';

  // limits: how much of each log goes into this form of the report
  function markdown(f, limits, extras) {
    let m = '# ' + (f.title || 'Report') + '\n\n';
    m += 'Reference **' + f.ref + '**' + (f.categoryLabel ? ' · ' + f.categoryLabel : '') + ' · ' + f.date + '\n\n';
    if (f.steps || f.actual || f.expected || f.where) {
      m += '## What happened\n\n';
      if (f.where) m += '**Where in the app:** ' + f.where + '\n\n';
      if (f.steps) m += '**What I did**\n\n' + f.steps + '\n\n';
      if (f.expected) m += '**What I expected**\n\n' + f.expected + '\n\n';
      if (f.actual) m += '**What happened instead**\n\n' + f.actual + '\n\n';
      const extra = [f.often && 'How often: ' + f.often, f.before && 'Worked before: ' + f.before].filter(Boolean);
      if (extra.length) m += extra.join(' · ') + '\n\n';
    }
    const setup = row('MeshOptimiser', f.version && 'v' + f.version.replace(/^v/i, '')) + row('System', f.os) + row('Browser', f.browser) + row('Renderer', f.renderer) + row('Graphics card', f.gpu) + row('Python', f.python) + row('Scene', f.scene);
    if (setup) m += '## Setup\n\n| | |\n|---|---|\n' + setup + '\n';
    if (f.details && limits.details) m += '<details><summary>Details copied from the app</summary>\n\n' + fence(f.details) + '\n</details>\n\n';
    const L = logs(), shown = Object.keys(L).filter(k => L[k]);
    if (shown.length && limits.log) {
      m += '## Logs\n\n';
      for (const k of shown) m += '**' + LOG_LABEL[k] + '**\n\n' + fence(clip(L[k], limits.log)) + '\n';
    }
    const modelLines = [];
    if (f.model === 'attach') modelLines.push('The file is attached' + (extras.zipHasModels ? ' in the zip.' : '.'));
    if (f.model === 'link') modelLines.push('The file can be downloaded here: ' + (f.modelLink || '(link missing)'));
    if (f.model === 'nofile') modelLines.push('The file cannot be shared.');
    if (f.modelInfo) modelLines.push('About the file: ' + f.modelInfo);
    for (const x of extras.modelFiles) modelLines.push('- ' + x.name + ' (' + fmtBytes(x.size) + (x.hash ? ', SHA-256 ' + x.hash.slice(0, 16) + '…' : '') + (x.inZip ? '' : ', not in the zip: too large') + ')');
    if (modelLines.length) m += '## The model\n\n' + modelLines.join('\n') + '\n\n';
    if (extras.shotNames.length) m += '## Pictures\n\n' + extras.shotNames.map(s => '- ' + s).join('\n') + '\n\n';
    if (f.email || f.name) m += '## Contact\n\n' + [f.name, f.email].filter(Boolean).join(' · ') + '\n';
    return m.trim() + '\n';
  }

  async function assemble() {
    const f = fields();
    const modelFiles = state.models.map(x => ({ name: x.file.name, size: x.file.size, hash: x.hash || '', inZip: x.inZip }));
    const shotNames = state.shots.map((s, i) => 'screenshots/' + shotName(s, i) + (s.caption ? ' — ' + s.caption : ''));
    const extras = { modelFiles, shotNames, zipHasModels: modelFiles.some(x => x.inZip) };
    return {
      f, extras,
      mdZip: markdown(f, { details: true, log: 1e9 }, extras),
      mdSend: markdown(f, { details: true, log: CONFIG.logSend }, extras),
      mdIssue: markdown(f, { details: false, log: CONFIG.logIssue }, extras),
      mdCopy: markdown(f, { details: true, log: CONFIG.logCopy }, extras),
    };
  }
  function shotName(s, i) { const ext = (s.file.name.match(/\.[A-Za-z0-9]{1,5}$/) || [''])[0].toLowerCase() || (s.file.type.startsWith('video') ? '.mp4' : '.png'); return pad2(i + 1) + '-' + slugName(s.file.name.replace(/\.[^.]+$/, '')) + ext; }

  async function buildZip() {
    const r = await assemble(), f = r.f, entries = [], now = new Date();
    const add = (name, text) => entries.push({ name, data: te.encode(text), date: now });
    add('report.md', r.mdZip);
    const L = logs();
    for (const k of Object.keys(L)) if (L[k]) add('logs/' + LOG_LABEL[k].toLowerCase().replace(/ /g, '-') + '.txt', L[k] + '\n');
    if (f.details) add('details-from-the-app.txt', f.details + '\n');
    let total = 0;
    for (let i = 0; i < state.shots.length; i++) { const s = state.shots[i]; const data = new Uint8Array(await s.file.arrayBuffer()); total += data.byteLength; entries.push({ name: 'screenshots/' + shotName(s, i), data, date: new Date(s.file.lastModified || now) }); }
    const modelInfo = [];
    for (const x of state.models) {
      modelInfo.push({ name: x.file.name, size: x.file.size, sha256: x.hash || null, includedInZip: !!x.inZip });
      if (x.inZip && total + x.file.size <= CONFIG.maxZipMB * 1048576) { const data = new Uint8Array(await x.file.arrayBuffer()); total += data.byteLength; entries.push({ name: 'files/' + x.file.name.replace(/[\\/]/g, '_'), data, date: new Date(x.file.lastModified || now) }); }
      else if (x.inZip) { modelInfo[modelInfo.length - 1].includedInZip = false; }
    }
    const json = { reference: f.ref, date: f.date, category: f.category, title: f.title, fields: { ...f }, logs: L, screenshots: state.shots.map((s, i) => ({ file: 'screenshots/' + shotName(s, i), caption: s.caption || '', size: s.file.size })), model: modelInfo, madeWith: 'report page of MeshOptimiser site' };
    delete json.fields.ref;
    add('report.json', JSON.stringify(json, null, 2) + '\n');
    return { blob: makeZip(entries), ref: f.ref, count: entries.length, size: total };
  }

  // ───────────────────────── what is still needed ─────────────────────────
  const has = (s, n) => String(s || '').trim().length >= n;
  function checklist() {
    const f = fields(), L = logs(), c = f.category, items = [];
    const add = (id, label, ok, required) => items.push({ id, label, ok: !!ok, required: !!required });
    add('kind', 'The kind of problem', c, true);
    add('title', 'A short title', has(f.title, 5), true);
    add('what', 'What you did, and what went wrong', has(f.steps, 10) || has(f.actual, 10), true);
    add('version', 'The version of MeshOptimiser', has(f.version, 1), false);
    add('system', 'Your system, Windows or macOS', has(f.os, 2), false);
    const shots = state.shots.length > 0, anyLog = !!(L.conv || L.launch || L.console);
    const modelOk = f.model === 'attach' ? state.models.length > 0 : f.model === 'link' ? has(f.modelLink, 8) : f.model === 'nofile' ? has(f.modelInfo, 10) : false;
    if (c === 'install') { add('launch', 'The text of the launcher window', has(L.launch, 20), false); add('python', 'The Python version', has(f.python, 3), false); }
    if (c === 'open') { add('conv', 'The conversion log', has(L.conv, 20), false); add('model', 'The file, a link to it, or a description of it', modelOk, false); }
    if (c === 'looks') { add('shot', 'A picture of what is wrong', shots, false); add('gpu', 'Your graphics card and renderer', has(f.gpu, 3) && has(f.renderer, 3), false); add('model', 'The file, a link to it, or a description of it', modelOk, false); }
    if (c === 'slow') { add('scene', 'How big the scene is', has(f.scene, 3), false); add('gpu', 'Your graphics card and renderer', has(f.gpu, 3) && has(f.renderer, 3), false); }
    if (c === 'export') { add('where', 'The format and settings you exported with', has(f.where, 3), false); add('shot', 'A picture of what is wrong', shots, false); }
    if (c === 'tool') { add('where', 'Which tool, and its settings', has(f.where, 3), false); add('shot', 'A picture, before and after', shots, false); add('model', 'The file, a link to it, or a description of it', modelOk, false); }
    if (c === 'crash') { add('err', 'The exact words of the error, as a log or a picture', anyLog || shots, false); }
    return items;
  }
  function renderChecklist() {
    const items = checklist(), ul = $('#rp-check');
    ul.textContent = '';
    for (const it of items) {
      const li = document.createElement('li');
      li.dataset.ok = it.ok ? '1' : '0';
      const mark = document.createElement('span'); mark.className = 'rp-mark'; mark.setAttribute('aria-hidden', 'true');
      const text = document.createElement('span'); text.textContent = it.label;
      const sr = document.createElement('span'); sr.className = 'sr'; sr.textContent = it.ok ? ' (done)' : it.required ? ' (needed)' : ' (would help)';
      li.append(mark, text, sr);
      ul.appendChild(li);
    }
    const done = items.filter(i => i.ok).length;
    $('#rp-meter').textContent = done + ' of ' + items.length + ' covered';
    const bar = $('#rp-bar'); if (bar) bar.style.width = Math.round(done / Math.max(items.length, 1) * 100) + '%';
    const missing = items.filter(i => i.required && !i.ok);
    return { items, missing, ready: missing.length === 0 };
  }

  // ───────────────────────── updating the page ─────────────────────────
  let lastReady = false;
  const refresh = () => {
    const { ready, missing } = renderChecklist();
    lastReady = ready;
    const refEl = $('#rp-ref'); if (refEl) refEl.textContent = state.ref;
    const consent = $('#f-consent').checked;
    const canSend = ready && consent;
    const blockedWhy = !ready ? 'Still needed: ' + missing.map(m => m.label.toLowerCase()).join(', ') + '.' : (!consent ? 'Tick the box above to say that you have read what will be sent.' : '');
    for (const b of $$('[data-act]')) {
      const need = b.dataset.act === 'download' || b.dataset.act === 'copy' ? ready : canSend;
      b.disabled = !need || state.sending;
    }
    const why = $('#rp-why'); if (why) why.textContent = blockedWhy;
    for (const t of $$('.rp-tab')) t.classList.toggle('has', !!val('f-log-' + t.dataset.tab));
    updateCounts(); updatePreviewSoon(); saveDraftSoon();
  };
  function updateCounts() {
    const set = (id, text) => { const e = document.getElementById(id); if (e) e.textContent = text; };
    set('rp-shots-count', state.shots.length ? state.shots.length + (state.shots.length === 1 ? ' file' : ' files') : '');
  }
  const updatePreview = async () => { const d = $('#rp-preview'); if (!d || !d.open) return; const r = await assemble(); $('#rp-preview-text').textContent = r.mdSend; };
  const updatePreviewSoon = debounce(updatePreview, 250);

  function setCategory(c) {
    const el = form.querySelector('input[name="cat"][value="' + c + '"]'); if (el) el.checked = true;
    const cat = CATS[c];
    $('#rp-cat-tip').textContent = cat ? cat.tip : 'Pick the one that is closest. It decides what the list on the right asks for.';
    $('#rp-cat-tip').dataset.set = cat ? '1' : '0';
    if (cat) selectTab(cat.logTab, false);
  }
  function selectTab(name, focus) {
    for (const t of $$('.rp-tab')) { const on = t.dataset.tab === name; t.setAttribute('aria-selected', on ? 'true' : 'false'); t.tabIndex = on ? 0 : -1; if (on && focus) t.focus(); }
    for (const p of $$('.rp-panel')) p.hidden = p.dataset.tab !== name;
  }
  function setModelMode(mode) {
    const el = form.querySelector('input[name="model"][value="' + mode + '"]'); if (el) el.checked = true;
    $('#rp-model-attach').hidden = mode !== 'attach';
    $('#rp-model-link').hidden = mode !== 'link';
    $('#rp-model-info').hidden = !mode || mode === 'na';
  }

  // ───────────────────────── pictures and files ─────────────────────────
  function addShots(files) {
    let skipped = 0;
    for (const file of files) {
      if (!/^(image|video)\//.test(file.type) && !/\.(png|jpe?g|webp|gif|mp4|webm|mov)$/i.test(file.name)) { skipped++; continue; }
      if (file.size > CONFIG.maxFileMB * 1048576) { skipped++; continue; }
      if (state.shots.some(s => s.file.name === file.name && s.file.size === file.size)) continue;
      state.shots.push({ file, caption: '', url: URL.createObjectURL(file) });
    }
    if (skipped) status('Skipped ' + skipped + (skipped === 1 ? ' file' : ' files') + ': pictures and recordings only, up to ' + CONFIG.maxFileMB + ' MB each.', 'warn');
    renderShots(); refresh();
  }
  function renderShots() {
    const box = $('#rp-shots'); box.textContent = '';
    state.shots.forEach((s, i) => {
      const li = document.createElement('li');
      const isVideo = s.file.type.startsWith('video') || /\.(mp4|webm|mov)$/i.test(s.file.name);
      const media = document.createElement(isVideo ? 'video' : 'img');
      media.src = s.url; media.className = 'rp-thumb';
      if (isVideo) { media.muted = true; media.preload = 'metadata'; } else { media.alt = ''; media.loading = 'lazy'; }
      const cap = document.createElement('input'); cap.type = 'text'; cap.placeholder = 'What does this show? (optional)'; cap.value = s.caption; cap.setAttribute('aria-label', 'Caption for ' + s.file.name); cap.maxLength = 140;
      cap.addEventListener('input', () => { s.caption = cap.value; updatePreviewSoon(); saveDraftSoon(); });
      const meta = document.createElement('span'); meta.className = 'rp-meta'; meta.textContent = s.file.name + ' · ' + fmtBytes(s.file.size);
      const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'rp-x'; rm.setAttribute('aria-label', 'Remove ' + s.file.name); rm.textContent = '×';
      rm.addEventListener('click', () => { URL.revokeObjectURL(s.url); state.shots.splice(i, 1); renderShots(); refresh(); });
      li.append(media, meta, cap, rm); box.appendChild(li);
    });
  }
  async function fingerprint(file) {
    if (file.size > CONFIG.hashMaxMB * 1048576 || !crypto.subtle) return '';
    try { const buf = await file.arrayBuffer(); const h = await crypto.subtle.digest('SHA-256', buf); return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join(''); } catch (_) { return ''; }
  }
  function addModels(files) {
    for (const file of files) {
      if (state.models.some(x => x.file.name === file.name && x.file.size === file.size)) continue;
      const entry = { file, hash: '', inZip: file.size <= CONFIG.maxFileMB * 1048576, working: true };
      state.models.push(entry);
      fingerprint(file).then((h) => { entry.hash = h; entry.working = false; renderModels(); updatePreviewSoon(); });
    }
    renderModels(); refresh();
  }
  function renderModels() {
    const box = $('#rp-models'); box.textContent = '';
    state.models.forEach((x, i) => {
      const li = document.createElement('li');
      const name = document.createElement('strong'); name.textContent = x.file.name;
      const meta = document.createElement('span'); meta.className = 'rp-meta';
      meta.textContent = fmtBytes(x.file.size) + ' · ' + (x.inZip ? 'goes into the zip' : 'too big for the zip: only its name, size and fingerprint are listed. Send it through a link.') + (x.working ? ' · working out its fingerprint…' : x.hash ? ' · SHA-256 ' + x.hash.slice(0, 12) + '…' : '');
      const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'rp-x'; rm.setAttribute('aria-label', 'Remove ' + x.file.name); rm.textContent = '×';
      rm.addEventListener('click', () => { state.models.splice(i, 1); renderModels(); refresh(); });
      li.append(name, meta, rm); box.appendChild(li);
    });
  }
  async function loadLogFile(file, tab) {
    if (file.size > 3 * 1048576) { status('That file is bigger than 3 MB. Paste only the last part of it.', 'warn'); return; }
    const text = await file.text(), id = 'f-log-' + tab, cur = val(id);
    setVal(id, cur ? cur + '\n\n' + text : text);
    refresh();
  }

  // ───────────────────────── sending ─────────────────────────
  function status(text, kind) {
    const s = $('#rp-status'); s.textContent = text; s.dataset.kind = kind || '';
  }
  const subject = (f) => '[MeshOptimiser] ' + (f.title || f.categoryLabel || 'Report') + ' (' + f.ref + ')';
  async function sendText() {
    if (state.sending) return;
    if ($('#f-botcheck') && $('#f-botcheck').value) { status('Sent.', 'ok'); return; }   // a robot filled the hidden field
    state.sending = true; refresh(); status('Sending…', '');
    const r = await assemble(), f = r.f;
    const fd = new FormData();
    fd.append('access_key', CONFIG.accessKey);
    fd.append('subject', subject(f));
    fd.append('from_name', f.name || 'MeshOptimiser report');
    if (f.email) fd.append('email', f.email);
    fd.append('message', clip(r.mdSend, 28000));
    fd.append('botcheck', '');
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 25000);
    try {
      const res = await fetch(CONFIG.endpoint, { method: 'POST', body: fd, headers: { Accept: 'application/json' }, signal: ctl.signal });
      let j = null; try { j = await res.json(); } catch (_) {}
      if (res.ok && j && j.success) {
        status('Sent. Your reference is ' + f.ref + '. Pictures and files are not in this message: download the .zip and send it too, with that reference.', 'ok');
        $('#rp-after').hidden = false;
      } else {
        status('The message could not be sent' + (j && j.message ? ' (' + j.message + ')' : '') + '. Download the .zip and email it, or open a GitHub issue instead.', 'err');
      }
    } catch (e) {
      status(e && e.name === 'AbortError' ? 'The message took too long. Download the .zip and email it, or open a GitHub issue instead.' : 'The message could not be sent: no connection, or the browser blocked it. Download the .zip and email it, or open a GitHub issue instead.', 'err');
    } finally { clearTimeout(timer); state.sending = false; refresh(); }
  }
  async function downloadZip() {
    status('Putting the zip together…', '');
    try {
      const z = await buildZip();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(z.blob); a.download = 'meshoptimiser-report-' + z.ref + '-' + stamp() + '.zip';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 20000);
      status('The zip is saved (' + z.count + ' files, ' + fmtBytes(z.blob.size) + '). Attach it to an email or to a GitHub issue, and mention ' + z.ref + '.', 'ok');
      $('#rp-after').hidden = false;
    } catch (e) { status('The zip could not be made: ' + (e && e.message ? e.message : 'out of memory? Try with fewer or smaller files.'), 'err'); }
  }
  async function openIssue() {
    const r = await assemble();
    let body = r.mdIssue + '\n\n---\nReference ' + r.f.ref + '. I will attach the .zip from the report page to this issue.\n';
    let url = CONFIG.repo + '/issues/new?title=' + encodeURIComponent(r.f.title || 'Report') + '&body=' + encodeURIComponent(body);
    while (url.length > 7000 && body.length > 600) { body = body.slice(0, Math.floor(body.length * 0.8)) + '\n\n(cut short: the full text is in the .zip)\n'; url = CONFIG.repo + '/issues/new?title=' + encodeURIComponent(r.f.title || 'Report') + '&body=' + encodeURIComponent(body); }
    window.open(url, '_blank', 'noopener');
    status('A new issue is open in another tab. Issues are public: read it once before you press Submit, and drag the .zip into it to attach your files.', '');
  }
  async function openEmail() {
    const r = await assemble();
    let body = 'Reference ' + r.f.ref + '\n(Attach the .zip from the report page to this message.)\n\n' + r.mdIssue;
    body = body.length > 1800 ? body.slice(0, 1800) + '\n… (cut short: the full text is in the .zip)\n' : body;
    const a = document.createElement('a');
    a.href = 'mailto:' + CONFIG.email + '?subject=' + encodeURIComponent(subject(r.f)) + '&body=' + encodeURIComponent(body);
    document.body.appendChild(a); a.click(); a.remove();
    status('Your email program should open with the text filled in. Attach the .zip before you send it.', '');
  }
  async function copyText() {
    const r = await assemble();
    try { await navigator.clipboard.writeText(r.mdCopy); status('Copied. Paste it wherever you like.', 'ok'); }
    catch (_) { const d = $('#rp-preview'); d.open = true; await updatePreview(); status('The browser did not allow copying. The text is open below: select it and copy it by hand.', 'warn'); }
  }

  // ───────────────────────── the draft ─────────────────────────
  const DRAFT_IDS = ['f-title', 'f-steps', 'f-expected', 'f-actual', 'f-where', 'f-often', 'f-before', 'f-details', 'f-version', 'f-os', 'f-browser', 'f-renderer', 'f-gpu', 'f-python', 'f-scene', 'f-log-conv', 'f-log-launch', 'f-log-console', 'f-modelinfo', 'f-modellink', 'f-email', 'f-name'];
  const saveDraft = () => {
    const values = {}; for (const id of DRAFT_IDS) values[id] = val(id);
    safeStore.set({ ref: state.ref, cat: catKey(), model: radio('model'), values, at: Date.now() });
  };
  const saveDraftSoon = debounce(saveDraft, 400);
  function restoreDraft() {
    const d = safeStore.get();
    if (!d || !d.values || (Date.now() - (d.at || 0)) > 14 * 86400000) return false;
    for (const id of DRAFT_IDS) if (d.values[id]) setVal(id, d.values[id]);
    if (d.ref) state.ref = d.ref;
    if (d.cat) setCategory(d.cat);
    if (d.model) setModelMode(d.model);
    return DRAFT_IDS.some(id => d.values[id]);
  }
  function startOver() {
    form.reset(); safeStore.clear();
    for (const s of state.shots) URL.revokeObjectURL(s.url);
    state.shots = []; state.models = []; state.ref = newRef();
    renderShots(); renderModels(); setCategory(''); setModelMode(''); selectTab('conv', false);
    $('#rp-after').hidden = true; status('', ''); refresh();
    $('#rp-start-over').textContent = 'Start over'; $('#rp-start-over').dataset.sure = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ───────────────────────── wiring ─────────────────────────
  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('input', () => refresh());
  // pasted details fill the boxes under them; typing in them afterwards is left alone
  $('#f-details').addEventListener('paste', () => setTimeout(() => { fillFromDetails(val('f-details'), false); refresh(); }, 0));
  $('#f-details').addEventListener('change', () => { fillFromDetails(val('f-details'), true); refresh(); });
  form.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'cat') setCategory(t.value);
    if (t.name === 'model') setModelMode(t.value);
    refresh();
  });
  $('#f-consent').addEventListener('change', refresh);
  $('#rp-preview').addEventListener('toggle', updatePreview);

  // the tabs of the logs: arrow keys move between them
  $$('.rp-tab').forEach((t, i, all) => {
    t.addEventListener('click', () => selectTab(t.dataset.tab, false));
    t.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const n = all[(i + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length]; selectTab(n.dataset.tab, true); } });
  });

  // drop zones: a click opens the picker, a drop adds the files
  const wireDrop = (zone, onFiles) => {
    const input = $('input[type=file]', zone);
    input.addEventListener('change', () => { onFiles(Array.from(input.files)); input.value = ''; });
    for (const ev of ['dragenter', 'dragover']) zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('is-over'); });
    for (const ev of ['dragleave', 'drop']) zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('is-over'); });
    zone.addEventListener('drop', (e) => onFiles(Array.from(e.dataTransfer.files || [])));
  };
  wireDrop($('#rp-drop-shots'), addShots);
  wireDrop($('#rp-drop-models'), addModels);
  wireDrop($('#rp-drop-logs'), (files) => { const tab = ($('.rp-tab[aria-selected="true"]') || {}).dataset ? $('.rp-tab[aria-selected="true"]').dataset.tab : 'conv'; files.forEach(f => loadLogFile(f, tab)); });
  // a picture pasted from the clipboard (a screenshot) goes into the pictures
  document.addEventListener('paste', (e) => {
    const files = Array.from((e.clipboardData && e.clipboardData.files) || []).filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    addShots(files.map((f, i) => f.name && f.name !== 'image.png' ? f : new File([f], 'pasted-' + stamp() + '-' + (i + 1) + '.png', { type: f.type, lastModified: Date.now() })));
    status('Picture added from the clipboard.', 'ok');
  });

  $('#rp-detect').addEventListener('click', async () => {
    const info = await thisBrowser();
    const put = (id, v) => { if (v && !val(id)) setVal(id, v); };
    put('f-browser', info.browser); put('f-os', info.os); put('f-gpu', info.gpu); put('f-renderer', info.webgpu ? 'WebGPU' : 'WebGL2');
    $('#rp-detect-note').textContent = 'Filled in from this browser: ' + [info.os, info.browser, info.gpu || 'graphics card not shown', info.webgpu ? 'WebGPU available' : 'no WebGPU'].filter(Boolean).join(' · ') + '. Only the empty fields were filled.';
    refresh();
  });

  for (const b of $$('[data-act]')) b.addEventListener('click', () => {
    ({ send: sendText, download: downloadZip, github: openIssue, email: openEmail, copy: copyText })[b.dataset.act]();
  });
  $('#rp-start-over').addEventListener('click', (e) => {
    const b = e.currentTarget;
    if (b.dataset.sure) { startOver(); return; }
    b.dataset.sure = '1'; b.textContent = 'Really clear everything?';
    setTimeout(() => { b.dataset.sure = ''; b.textContent = 'Start over'; }, 4000);
  });
  window.addEventListener('beforeunload', (e) => { if (state.shots.length || state.models.length) { e.preventDefault(); e.returnValue = ''; } });

  // ── start: a draft, then whatever the app handed over in the address ──
  const restored = restoreDraft();
  // The app can open this page with what it knows in the address: #details=<its Copy details text>&kind=<install|open|…>
  function applyHash() {
    const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (hash.get('details')) { setVal('f-details', hash.get('details')); fillFromDetails(hash.get('details'), false); }
    if (hash.get('kind') && CATS[hash.get('kind')]) setCategory(hash.get('kind'));
    if (hash.get('details') || hash.get('kind')) { history.replaceState(null, '', location.pathname + location.search); refresh(); }
  }
  window.addEventListener('hashchange', applyHash);
  applyHash();
  if (!catKey()) setCategory('');
  if (!radio('model')) setModelMode('');
  selectTab(((CATS[catKey()] || {}).logTab) || 'conv', false);
  if (restored) { const n = $('#rp-restored'); if (n) n.hidden = false; }
  refresh();
})();
