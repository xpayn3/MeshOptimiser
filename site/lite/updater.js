/* Updates: finding a newer version, telling the user, and installing it (serve.py's /api/update/*, see updater.py).
   Everything about it is optional and visible: Settings › Updates holds the switches, the corner card is the only thing that
   ever appears on its own, and nothing is downloaded or installed without a press on "Update now".
   The page talks to its own server only; the server is the one that fetches the small list of releases from the website. */
(() => {
  'use strict';
  const KEY = 'mo-updates';
  const DEFAULTS = { auto: true, every: 'start', channel: 'stable', notify: true, skipped: '', remindAt: 0, lastChecked: 0, last: null };
  const EVERY = [['Every start', 'start'], ['Daily', 'daily'], ['Weekly', 'weekly']];
  const CHANNELS = [['Stable', 'stable'], ['Beta', 'beta']];
  const DAY = 86400e3;
  const noop = () => {};
  const stub = { supported: false, mount: noop, refresh: noop, openFromMenu: noop, check: noop, onChange: noop };
  if (window.top !== window || window.__MESHOPT_DEMO || !/^https?:$/.test(location.protocol) || /[?&]selftest\b/.test(location.search)) { window.MOUpdater = stub; return; }

  // ── settings (kept in this browser) ───────────────────────────────────────
  const load = () => { try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (_) { return { ...DEFAULTS }; } };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (_) {} };
  let S = load();

  // ── what the page knows right now ─────────────────────────────────────────
  const ui = { supported: null, phase: 'idle', error: '', server: null, progress: null, target: '', armed: '', cardState: '' };
  const listeners = [];
  const emit = () => { paint(); for (const f of listeners) { try { f(ui, S); } catch (_) {} } };
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ago = (t) => { if (!t) return 'never'; const d = Math.max(0, Math.round((Date.now() - t) / 1000)); return d < 10 ? 'just now' : d < 60 ? d + ' s ago' : d < 3600 ? Math.round(d / 60) + ' min ago' : d < 86400 ? Math.round(d / 3600) + ' h ago' : Math.round(d / 86400) + ' days ago'; };
  const niceDate = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); if (!m) return ''; return +m[3] + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2] - 1] + ' ' + m[1]; };
  const mb = (n) => (n / 1048576 >= 10 ? Math.round(n / 1048576) : Math.round(n / 104857.6) / 10) + ' MB';
  const current = () => (ui.server && ui.server.current) || (S.last && S.last.current) || '';
  const available = () => !!(S.last && S.last.available && S.last.latest && S.last.current === current());

  async function api(path, body) {
    const r = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
    let j = null; try { j = await r.json(); } catch (_) {}
    if (!r.ok && !(j && (j.error || j.ok === false))) throw new Error('The app\'s server did not answer (' + r.status + ').');
    return j || {};
  }

  // ── talking to the server ─────────────────────────────────────────────────
  async function refreshServer() {
    try { ui.server = await api('/api/update/status'); ui.supported = true; }
    catch (_) { ui.supported = ui.supported === true ? true : false; }
    return ui.server;
  }

  async function check({ manual = false } = {}) {
    if (ui.supported === false || busy()) return null;
    ui.phase = 'checking'; ui.error = ''; emit();
    let res = null;
    try { res = await api('/api/update/check', { channel: S.channel }); }
    catch (e) { res = { ok: false, error: 'The app\'s server did not answer.' }; }
    ui.phase = 'idle';
    if (!res || res.ok === false) {
      ui.error = (res && res.error) || 'Could not check for updates.';
      if (manual) ui.error += '';
      emit(); return res;
    }
    S.lastChecked = Date.now();
    S.last = { available: !!res.available, latest: res.latest || '', current: res.current || '', date: res.date || '', notes: res.notes || [], headline: res.headline || '', more: res.more || '', size: res.size || 0,
      installable: res.installable !== false, reason: res.reason || '', requires_pip: !!res.requires_pip, channel: res.channel, checked: S.lastChecked };
    save();
    await refreshServer();
    emit();
    if (res.available && (manual || (S.notify && S.skipped !== res.latest && Date.now() >= S.remindAt))) showCard('available');
    else if (!res.available) hideCard();
    return res;
  }

  const busy = () => ['checking', 'installing', 'restarting'].includes(ui.phase);

  function unsaved() { try { return typeof window.__moHasUnsaved === 'function' && window.__moHasUnsaved(); } catch (_) { return false; } }

  async function install({ force = false } = {}) {
    if (busy() || !available()) return;
    if (!S.last.installable) { return; }
    if (!force && unsaved()) { showCard('unsaved'); return; }
    ui.phase = 'installing'; ui.error = ''; ui.target = S.last.latest; ui.progress = { phase: 'downloading', done: 0, total: 0, message: 'Starting…' }; emit(); showCard('progress');
    let r;
    try { r = await api('/api/update/install', { channel: S.channel }); } catch (e) { r = { ok: false, error: e.message }; }
    if (!r || r.ok === false) { fail(r && r.error || 'The update could not start.'); return; }
    watch();
  }

  // Follow the server's own account of the update until it restarts (or fails), then wait for it to come back. The restarted
  // server starts with a clean state, so "it is back and runs the new version" is as good a sign as "restarting".
  async function watch() {
    let lost = 0;
    for (let i = 0; i < 4000; i++) {
      await sleep(450);
      let s = null;
      try { s = await api('/api/update/status'); lost = 0; } catch (_) { if (++lost >= 2) { ui.phase = 'restarting'; emit(); return restarting(); } continue; }
      ui.server = s;
      ui.progress = { phase: s.phase, done: s.done || 0, total: s.total || 0, message: s.message || '' };
      if (s.phase === 'error') { fail(s.error || 'The update failed. Nothing was changed.'); return; }
      if (s.phase === 'done') { ui.phase = 'idle'; ui.progress = null; S.last = null; save(); emit(); showCard('manual'); return; }
      if (s.phase === 'restarting' || (s.phase === 'idle' && ui.target && s.current === ui.target)) { ui.phase = 'restarting'; emit(); return restarting(); }
      paint();
    }
  }
  async function restarting() {
    const want = ui.target;
    const t0 = Date.now();
    await sleep(1200);
    while (Date.now() - t0 < 120000) {
      try {
        const s = await api('/api/update/status');
        if (s && s.current === want && s.phase !== 'restarting') { S.last = null; save(); location.reload(); return; }
      } catch (_) {}
      await sleep(700);
    }
    fail('The app did not come back by itself. Close it and start it again from its launcher; if the update went through you will see the new version.');
  }
  function fail(msg) { ui.phase = 'error'; ui.error = msg; ui.progress = null; emit(); showCard('error'); }

  async function cancel() { try { await api('/api/update/cancel', {}); } catch (_) {} }

  async function rollback() {
    if (busy() || !(ui.server && ui.server.backup)) return;
    ui.target = ui.server.backup.version; ui.phase = 'installing'; ui.progress = { phase: 'installing', done: 0, total: 0, message: 'Putting the earlier version back…' }; emit(); showCard('progress');
    let r; try { r = await api('/api/update/rollback', {}); } catch (e) { r = { ok: false, error: e.message }; }
    if (!r || r.ok === false) { fail(r && r.error || 'Could not go back.'); return; }
    S.last = null; save();
    ui.phase = 'restarting'; emit(); restarting();
  }

  function skip() { if (S.last) { S.skipped = S.last.latest; save(); } hideCard(); emit(); }
  function later() { S.remindAt = Date.now() + DAY; save(); hideCard(); emit(); }
  function set(k, v) { S[k] = v; if (k === 'channel') { S.last = null; S.skipped = ''; } save(); emit(); if (k === 'channel' || (k === 'auto' && v)) check({ manual: false }); }
  function reset() { const keep = { last: S.last, lastChecked: S.lastChecked }; S = Object.assign({}, DEFAULTS, keep); save(); emit(); }

  // ── the card in the corner ────────────────────────────────────────────────
  let card = null, hideTimer = 0;
  function ensureCard() {
    if (card) return card;
    card = document.createElement('div');
    card.id = 'mo-update-card'; card.className = 'up-card'; card.setAttribute('role', 'status'); card.hidden = true;
    card.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const a = b.dataset.act;
      if (a === 'update') install();
      else if (a === 'force') install({ force: true });
      else if (a === 'later') later();
      else if (a === 'skip') skip();
      else if (a === 'notes') { hideCard(); try { window.__openSettings('updates'); } catch (_) {} }
      else if (a === 'close') { hideCard(); if (ui.phase === 'error') { ui.phase = 'idle'; ui.error = ''; emit(); } }
      else if (a === 'cancel') cancel();
      else if (a === 'dismiss') { hideCard(); api('/api/update/dismiss', {}).catch(noop); }
      else if (a === 'download') window.open('https://lukagrcar.com/apps/meshoptimiser/download.html', '_blank', 'noopener');
    });
    document.body.appendChild(card);
    return card;
  }
  function showCard(kind) { ui.cardState = kind; ensureCard(); clearTimeout(hideTimer); card.hidden = false; paintCard(); requestAnimationFrame(() => card.classList.add('is-in')); }
  function hideCard() { ui.cardState = ''; if (!card) return; card.classList.remove('is-in'); clearTimeout(hideTimer); hideTimer = setTimeout(() => { if (!ui.cardState) card.hidden = true; }, 220); }
  function paintCard() {
    if (!card || card.hidden && !ui.cardState) return;
    const L = S.last, v = L && L.latest, k = ui.cardState, p = ui.progress;
    const btn = (act, label, cls = '') => `<button type="button" class="btn ${cls}" data-act="${act}">${label}</button>`;
    let h = '';
    if (k === 'available' && L) {
      const notes = (L.notes || []).slice(0, 3).map((n) => `<li>${esc(n)}</li>`).join('');
      const more = (L.notes || []).length > 3 ? `<li class="up-more">and ${(L.notes.length - 3)} more</li>` : '';
      h = `<div class="up-c-h"><b>Version ${esc(v)} is available</b><button type="button" class="up-x" data-act="later" title="Later" aria-label="Later">✕</button></div>
        <div class="up-c-s">You have ${esc(L.current)}${L.date ? ' · released ' + esc(niceDate(L.date)) : ''}${L.size ? ' · ' + mb(L.size) + ' download' : ''}</div>
        ${L.headline ? `<p class="up-c-p">${esc(L.headline)}</p>` : ''}${notes ? `<ul class="up-c-l">${notes}${more}</ul>` : ''}
        ${L.installable ? '' : `<p class="up-c-p up-warn">${esc(L.reason)}</p>`}
        <div class="up-c-a">${L.installable ? btn('update', 'Update now', 'primary') : btn('download', 'Open download page', 'primary')}${btn('later', 'Later')}${btn('notes', 'Details')}<button type="button" class="up-link" data-act="skip">Skip this version</button></div>`;
    } else if (k === 'unsaved') {
      h = `<div class="up-c-h"><b>Save your scene first</b></div>
        <div class="up-c-p">The app restarts to finish the update, and the scene you have open has changes that are not saved. Save it (Menu › Save scene), then press Update now.</div>
        <div class="up-c-a">${btn('force', 'Update anyway')}${btn('later', 'Cancel')}</div>`;
    } else if (k === 'progress') {
      const pct = p && p.phase === 'downloading' && p.total ? Math.min(100, Math.round(p.done / p.total * 100)) : null;
      const label = ui.phase === 'restarting' ? 'Restarting the app…' : p && p.phase === 'downloading' ? 'Downloading ' + (v || ui.target) + (pct != null ? ' · ' + pct + '%' : '…')
        : p && p.phase === 'verifying' ? 'Checking the download…' : p && p.phase === 'installing' && p.message ? p.message : 'Installing…';
      h = `<div class="up-c-h"><b>${esc(label)}</b></div>
        <div class="up-bar${pct == null ? ' is-wait' : ''}"><i style="width:${pct == null ? 40 : pct}%"></i></div>
        <div class="up-c-s">Your files and settings are not touched. The window reloads by itself.</div>
        ${ui.phase === 'installing' && p && p.phase === 'downloading' ? `<div class="up-c-a">${btn('cancel', 'Cancel')}</div>` : ''}`;
    } else if (k === 'error') {
      h = `<div class="up-c-h"><b>The update did not go through</b><button type="button" class="up-x" data-act="close" aria-label="Close">✕</button></div>
        <div class="up-c-p">${esc(ui.error)}</div><div class="up-c-a">${btn('update', 'Try again')}${btn('close', 'Close')}</div>`;
    } else if (k === 'manual') {
      h = `<div class="up-c-h"><b>Updated</b><button type="button" class="up-x" data-act="close" aria-label="Close">✕</button></div>
        <div class="up-c-p">The new version is in place. Close the app and start it again from its launcher to use it.</div>`;
    } else if (k === 'updated') {
      const n = ui.server && ui.server.notice;
      h = `<div class="up-c-h"><b>Updated to ${esc(n && n.to || current())}</b><button type="button" class="up-x" data-act="dismiss" aria-label="Close">✕</button></div>
        <div class="up-c-s">${n && n.from ? 'You had ' + esc(n.from) + '. ' : ''}The earlier version is kept in case you want it back (Settings › Updates).</div>
        <div class="up-c-a">${btn('notes', 'See what is new')}${btn('dismiss', 'Close')}</div>`;
    } else if (k === 'rolled_back') {
      const n = ui.server && ui.server.notice;
      h = `<div class="up-c-h"><b>Back on ${esc(n && n.to || current())}</b><button type="button" class="up-x" data-act="dismiss" aria-label="Close">✕</button></div>
        <div class="up-c-p">${n && n.reason && /did not start/i.test(n.reason) ? 'Version ' + esc(n.from || '') + ' did not start properly, so the earlier version was put back.' : 'The earlier version is back.'}</div>
        <div class="up-c-a">${btn('dismiss', 'Close')}</div>`;
    }
    if (h) card.innerHTML = h;
    card.dataset.kind = k;
  }

  // ── Settings › Updates ────────────────────────────────────────────────────
  let pane = null, nav = null, boundPane = null;
  function mount(paneEl, navEl) { pane = paneEl; nav = navEl; bindPane(); refresh(); }
  async function refresh() { await refreshServer(); paint(); }

  function toggleRow(id, label, on, help) {
    return `<div class="toggle set-row"><span>${label}${help ? `<span class="set-help">${help}</span>` : ''}</span><label><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span class="switch"></span></label></div>`;
  }
  const group = (t) => `<div class="set-group-title">${t}</div>`;
  const chips = (key, list, cur, off) => `<div class="set-chips" data-up="${key}"${off ? ' aria-disabled="true" style="opacity:.5;pointer-events:none"' : ''}>${list.map(([l, v]) => `<button type="button" class="sv-chip${String(cur) === String(v) ? ' is-on' : ''}" data-v="${v}">${l}</button>`).join('')}</div>`;

  function headline() {
    const L = S.last, p = ui.progress;
    if (ui.supported === false) return ['off', 'Updates are not available here', 'This copy of the app is not running from its own server (a hosted copy or a plain file server), so it cannot update itself. Download the newest version from the website.'];
    if (ui.phase === 'checking') return ['busy', 'Checking for updates…', 'Asking the website which version is newest.'];
    if (ui.phase === 'installing') return ['busy', p && p.phase === 'downloading' ? 'Downloading ' + ui.target : p && p.message || 'Installing ' + ui.target, 'Your files and settings are not touched.'];
    if (ui.phase === 'restarting') return ['busy', 'Restarting the app…', 'The window reloads by itself.'];
    if (ui.phase === 'error') return ['warn', ui.error && /reach|server|internet/i.test(ui.error) ? 'Could not check for updates' : 'The update did not go through', ui.error];
    if (available()) return ['new', 'Version ' + L.latest + ' is available', 'You have ' + current() + '.' + (L.date ? ' Released ' + niceDate(L.date) + '.' : '') + (L.size ? ' ' + mb(L.size) + ' to download.' : '')];
    if (L && L.checked) return ['ok', 'MeshOptimiser is up to date', 'You have ' + current() + '. Last checked ' + ago(S.lastChecked) + (S.channel === 'beta' ? ' (Beta channel)' : '') + '.'];
    return ['idle', current() ? 'You have ' + current() : 'Updates', S.lastChecked ? 'Last checked ' + ago(S.lastChecked) + '.' : 'Not checked yet.'];
  }

  function paint() {
    paintNav(); paintBrand(); paintCard();
    if (!pane) return;
    const [state, title, detail] = headline(), L = S.last, srv = ui.server || {}, canAct = ui.supported !== false;
    const working = busy();
    let h = `<div class="set-row up-status" data-state="${state}"><span><span class="up-state"><i class="set-nav-dot"></i><b>${esc(title)}</b></span><span class="set-help">${esc(detail)}</span></span>
      <span class="up-btns">${available() && L.installable && canAct ? `<button class="btn primary" data-up-act="update"${working ? ' disabled' : ''}>Update now</button>` : ''}${canAct ? `<button class="btn" data-up-act="check"${working ? ' disabled' : ''}>${ui.phase === 'checking' ? 'Checking…' : 'Check now'}</button>` : ''}</span></div>`;
    if (available() && !L.installable) h += `<div class="set-row set-stack"><span class="set-help up-warn">${esc(L.reason)}</span><a class="btn" href="https://lukagrcar.com/apps/meshoptimiser/download.html" target="_blank" rel="noopener">Open the download page</a></div>`;
    if (available() && ((L.notes && L.notes.length) || L.headline)) {
      h += `<div class="set-row set-stack up-notes"><span>What is new in ${esc(L.latest)}${L.headline ? `<span class="set-help">${esc(L.headline)}</span>` : ''}</span>${L.notes && L.notes.length ? `<ul class="up-c-l">${L.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
        <a class="up-link" href="${esc(L.more || 'https://lukagrcar.com/apps/meshoptimiser/changelog.html')}" target="_blank" rel="noopener">Full changelog</a></div>`;
    }
    if (canAct) {
      h += group('Checking') +
        toggleRow('up-auto', 'Check for updates automatically', S.auto, 'Asks the website for the newest version. Off: the app never looks unless you press Check now.') +
        `<div class="set-row set-stack"><span>How often<span class="set-help">Checked when the app opens, if this much time has passed since the last check.</span></span>${chips('every', EVERY, S.every, !S.auto)}</div>` +
        `<div class="set-row set-stack"><span>Update channel<span class="set-help">Stable is what everyone gets. Beta brings new things earlier and may have rough edges; a newer stable version is always offered too.</span></span>${chips('channel', CHANNELS, S.channel)}</div>` +
        group('When one is found') +
        toggleRow('up-notify', 'Show a notice in the corner', S.notify, 'A small card with what is new. Nothing is downloaded or installed until you press Update now.') +
        (S.skipped ? `<div class="set-row set-action"><span>Skipped version<span class="set-help">${esc(S.skipped)} is not announced again. Newer versions still are.</span></span><button class="btn" data-up-act="unskip">Offer it again</button></div>` : '') +
        (S.remindAt > Date.now() ? `<div class="set-row set-action"><span>Reminder<span class="set-help">You asked to be reminded later: no notice until ${esc(new Date(S.remindAt).toLocaleString())}.</span></span><button class="btn" data-up-act="unremind">Remind me now</button></div>` : '') +
        group('This version') +
        `<div class="set-row"><span>Installed</span><span class="set-val">${esc(current() || '—')}</span></div>` +
        (srv.backup ? `<div class="set-row set-action"><span>Earlier version<span class="set-help">${esc(srv.backup.version)} is kept from before the last update${srv.backup.at ? ' (' + esc(new Date(srv.backup.at * 1000).toLocaleDateString()) + ')' : ''}. Going back keeps your settings and files.</span></span><button class="btn${ui.armed === 'rollback' ? ' danger' : ''}" data-up-act="rollback"${working ? ' disabled' : ''}>${ui.armed === 'rollback' ? 'Press again to restore ' + esc(srv.backup.version) : 'Restore ' + esc(srv.backup.version)}</button></div>` : '') +
        `<div class="set-row set-action"><span>Release notes<span class="set-help">Every version and what changed, on the website.</span></span><a class="btn" href="https://lukagrcar.com/apps/meshoptimiser/changelog.html" target="_blank" rel="noopener">Open</a></div>` +
        group('Privacy') +
        `<div class="set-row"><span class="set-help" style="margin:0">A check downloads one small file from lukagrcar.com that lists the newest version. Nothing about you, this computer or your models is sent. The update itself comes from the project's GitHub releases and is checked against a fingerprint before any file is replaced; your scenes, settings, the inbox and exports folders and the Python environment are never touched.</span></div>` +
        `<div class="set-row set-action"><span>Updates<span class="set-help">Put these choices back to their defaults.</span></span><button class="btn" data-up-act="reset">Reset</button></div>`;
    }
    pane.innerHTML = h;
    const q = $('settings-search'); if (q && q.value) q.dispatchEvent(new Event('input'));
  }
  function bindPane() {
    if (!pane || boundPane === pane) return; boundPane = pane;
    pane.addEventListener('click', (e) => {
      const chip = e.target.closest('.sv-chip[data-v]'), grp = chip && chip.closest('[data-up]');
      if (grp) { set(grp.dataset.up, chip.dataset.v); return; }
      const b = e.target.closest('[data-up-act]'); if (!b) return;
      const a = b.dataset.upAct;
      if (a === 'check') check({ manual: true });
      else if (a === 'update') { install(); }
      else if (a === 'unskip') { S.skipped = ''; save(); emit(); if (available()) showCard('available'); }
      else if (a === 'unremind') { S.remindAt = 0; save(); emit(); if (available()) showCard('available'); }
      else if (a === 'reset') reset();
      else if (a === 'rollback') {
        if (ui.armed === 'rollback') { ui.armed = ''; rollback(); }
        else { ui.armed = 'rollback'; paint(); setTimeout(() => { if (ui.armed === 'rollback') { ui.armed = ''; paint(); } }, 4000); }
      }
    });
    pane.addEventListener('change', (e) => {
      if (e.target.id === 'up-auto') set('auto', e.target.checked);
      else if (e.target.id === 'up-notify') set('notify', e.target.checked);
    });
  }
  function paintNav() {
    if (!nav) return;
    const st = ui.phase === 'checking' || ui.phase === 'installing' || ui.phase === 'restarting' ? 'busy' : available() ? 'new' : '';
    nav.dataset.state = st; nav.hidden = !st;
    const t = nav.querySelector('.set-nav-txt'); if (t) t.textContent = st === 'new' ? 'New' : st === 'busy' ? '…' : '';
    nav.title = st === 'new' ? 'Version ' + S.last.latest + ' is available' : '';
  }
  // the app menu: a dot on the logo and a line that says what it does
  function paintBrand() {
    const mark = document.querySelector('.brand-mark'), item = $('brand-menu-updates');
    const isNew = available();
    if (mark) { if (isNew) mark.dataset.update = 'new'; else delete mark.dataset.update; }
    if (item) {
      item.hidden = ui.supported === false;
      const l = item.querySelector('.lbl'); if (l) l.textContent = isNew ? 'Update to ' + S.last.latest : 'Check for updates';
      item.classList.toggle('is-new', isNew);
    }
  }
  // the app menu's line (wired in app-v2.js next to Help): open Settings › Updates, and look if nothing is known yet
  function openFromMenu() {
    try { window.__openSettings('updates'); } catch (_) {}
    if (available()) showCard('available'); else check({ manual: true });
  }

  // ── start-up ──────────────────────────────────────────────────────────────
  async function start() {
    for (let i = 0; i < 100 && !document.body.classList.contains('app-ready'); i++) await sleep(300);   // (the app is up: say so to the server)
    try { await api('/api/update/confirm', {}); } catch (_) {}
    await refreshServer(); paint();
    if (ui.supported === false) return;
    const n = ui.server && ui.server.notice;
    if (n && (n.kind === 'updated' || n.kind === 'rolled_back')) showCard(n.kind);
    if (S.last && S.last.current && S.last.current !== current()) { S.last = null; save(); }       // (remembered from before an update or a rollback)
    await sleep(2500);
    const gap = S.every === 'weekly' ? 7 * DAY : S.every === 'daily' ? DAY : 0;
    if (S.auto && navigator.onLine !== false && (Date.now() - S.lastChecked >= gap || !S.last)) await check({ manual: false });
    else if (available() && S.notify && S.skipped !== S.last.latest && Date.now() >= S.remindAt && !ui.cardState) showCard('available');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  window.MOUpdater = { supported: true, mount, refresh, openFromMenu, check, install, rollback, onChange: (f) => listeners.push(f), get state() { return { ...ui, settings: { ...S } }; }, set, reset };
})();
