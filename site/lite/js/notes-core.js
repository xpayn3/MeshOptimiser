// ========== NOTES: the data of the notes on a model ==========
// No page, no scene in here: notes as plain data, the steps that change them, the way they are written into a scene file and read back
// (a file from anyone is untrusted: everything is cut to size and checked), how two copies of the same notes are joined, and the
// notes as text, Markdown and one HTML page. The pins, the card and the pop-up are in notes.js. Tests: tests/notes.test.mjs.
//
// A note is a conversation about a place in the model:
//   { id, n, kind: 'pin' | 'part' | 'scene', part: { uid, name } | null, local, world, normal, cam,
//     tag, assignee, status, messages: [ { id, by, at, text, updatedAt, edits: [ { by, at, was } ], deleted } ],
//     activity: [ { id, at, by, type, info } ], created: { by, at }, deleted: { by, at } | null, thumb,
//     statusAt, tagAt, assigneeAt, anchorAt, deletedAt }
// Nothing is ever lost by a step: an edit keeps the text it replaced, a delete leaves who deleted it and when, and each change is a line in
// the note's activity. Every change by a person carries the name that person typed (nobody is signed in: it is what they said they are).
(function (root) {
  'use strict';

  const VERSION = 1;
  const TAGS = [
    { id: 'info', label: 'Info', color: '#4da3ff' },
    { id: 'question', label: 'Question', color: '#b58cff' },
    { id: 'issue', label: 'Issue', color: '#ff6b5e' },
    { id: 'idea', label: 'Idea', color: '#3ecf8e' },
  ];
  const TAG_IDS = TAGS.map(t => t.id);
  const LIMITS = { notes: 2000, messages: 400, activity: 600, edits: 40, text: 6000, name: 60, partName: 200, thumb: 30000, tagless: 'info' };

  let seq = 0;
  const rnd = () => Math.random().toString(36).slice(2, 8);
  const newId = (p) => (p || 'n') + '_' + Date.now().toString(36) + (++seq).toString(36) + rnd();
  const isoNow = () => new Date().toISOString();

  // ── what a person types, and what a file says ────────────────────────────────────────────────────
  const str = (v, max) => (typeof v === 'string' ? v.replace(/\u0000/g, '').slice(0, max) : '');
  const name = (v) => str(v, LIMITS.name).replace(/\s+/g, ' ').trim();
  const text = (v) => str(v, LIMITS.text);
  const iso = (v) => { if (typeof v !== 'string') return ''; const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : ''; };
  const vec = (v) => (Array.isArray(v) && v.length === 3 && v.every(Number.isFinite) ? v.map(Number) : null);
  const oneOf = (v, list, d) => (list.includes(v) ? v : d);
  const who = (v) => { const n = name(v); if (!n) throw new Error('A name is needed'); return n; };

  // ── making a note and changing it ─────────────────────────────────────────────────────────────────
  function log(note, by, type, info, at) {
    note.activity.push({ id: newId('a'), at, by, type, info: info == null ? '' : str(String(info), 200) });
    if (note.activity.length > LIMITS.activity) note.activity.splice(0, note.activity.length - LIMITS.activity);
  }
  function nextNumber(notes) { let m = 0; for (const n of notes) if (n.n > m) m = n.n; return m + 1; }

  // opts: { kind, part: { uid, name }, local, world, normal, cam, tag, thumb, text, by, now }
  function create(notes, opts) {
    const by = who(opts.by), at = opts.now || isoNow();
    const body = text(opts.text).trim();
    if (!body) throw new Error('A note needs some text');
    const kind = oneOf(opts.kind, ['pin', 'part', 'scene'], 'pin');
    const note = {
      id: newId('n'), n: nextNumber(notes), kind,
      part: opts.part && (opts.part.uid || opts.part.name) ? { uid: str(opts.part.uid, 60), name: str(opts.part.name, LIMITS.partName) } : null,
      local: vec(opts.local), world: vec(opts.world), normal: vec(opts.normal), cam: camOf(opts.cam),
      tag: oneOf(opts.tag, TAG_IDS, 'info'), assignee: '', status: 'open',
      messages: [{ id: newId('m'), by, at, text: body, updatedAt: at, edits: [], deleted: null }],
      activity: [], created: { by, at }, deleted: null, thumb: str(opts.thumb, LIMITS.thumb),
      statusAt: at, tagAt: at, assigneeAt: at, anchorAt: at, deletedAt: at,
    };
    log(note, by, 'created', '', at);
    notes.push(note);
    return note;
  }
  const find = (notes, id) => notes.find(n => n.id === id) || null;
  const msgOf = (note, id) => note.messages.find(m => m.id === id) || null;

  function reply(note, by, body, now) {
    by = who(by); body = text(body).trim(); if (!body) throw new Error('Nothing to send');
    if (note.messages.length >= LIMITS.messages) throw new Error('This note has as many messages as a note can hold');
    const at = now || isoNow();
    const m = { id: newId('m'), by, at, text: body, updatedAt: at, edits: [], deleted: null };
    note.messages.push(m); log(note, by, 'replied', '', at);
    return m;
  }
  // Anyone can edit any message; the text it had is kept, with who changed it and when.
  function edit(note, msgId, by, body, now) {
    by = who(by); body = text(body).trim();
    const m = msgOf(note, msgId); if (!m || m.deleted) throw new Error('That message is not there');
    if (!body) throw new Error('A message needs some text (delete it instead)');
    if (body === m.text) return m;
    const at = now || isoNow();
    m.edits.push({ by, at, was: m.text }); if (m.edits.length > LIMITS.edits) m.edits.splice(0, m.edits.length - LIMITS.edits);
    m.text = body; m.updatedAt = at; log(note, by, 'edited', m.by === by ? '' : m.by, at);
    return m;
  }
  function removeMessage(note, msgId, by, now) {
    by = who(by); const m = msgOf(note, msgId); if (!m || m.deleted) throw new Error('That message is not there');
    const at = now || isoNow(); m.deleted = { by, at }; m.updatedAt = at; log(note, by, 'removed', m.by === by ? '' : m.by, at);
    return m;
  }
  function restoreMessage(note, msgId, by, now) {
    by = who(by); const m = msgOf(note, msgId); if (!m || !m.deleted) return m;
    const at = now || isoNow(); m.deleted = null; m.updatedAt = at; log(note, by, 'restored message', '', at);
    return m;
  }
  function setStatus(note, by, status, now) {
    by = who(by); status = oneOf(status, ['open', 'resolved'], 'open'); if (note.status === status) return note;
    const at = now || isoNow(); note.status = status; note.statusAt = at; log(note, by, status === 'resolved' ? 'resolved' : 'reopened', '', at);
    return note;
  }
  function setTag(note, by, tag, now) {
    by = who(by); tag = oneOf(tag, TAG_IDS, 'info'); if (note.tag === tag) return note;
    const at = now || isoNow(); const was = note.tag; note.tag = tag; note.tagAt = at; log(note, by, 'tagged', was + ' → ' + tag, at);
    return note;
  }
  function assign(note, by, to, now) {
    by = who(by); to = name(to); if (note.assignee === to) return note;
    const at = now || isoNow(); note.assignee = to; note.assigneeAt = at; log(note, by, to ? 'assigned' : 'unassigned', to, at);
    return note;
  }
  // opts: { part, local, world, normal, cam }
  function moveAnchor(note, by, opts, now) {
    by = who(by); const at = now || isoNow();
    if (opts.part !== undefined) note.part = opts.part && (opts.part.uid || opts.part.name) ? { uid: str(opts.part.uid, 60), name: str(opts.part.name, LIMITS.partName) } : null;
    if (opts.local !== undefined) note.local = vec(opts.local);
    if (opts.world !== undefined) note.world = vec(opts.world);
    if (opts.normal !== undefined) note.normal = vec(opts.normal);
    if (opts.cam !== undefined) note.cam = camOf(opts.cam);
    if (note.kind === 'scene' && (note.world || note.local)) note.kind = 'pin';
    note.anchorAt = at; log(note, by, 'moved', '', at);
    return note;
  }
  function removeNote(note, by, now) {
    by = who(by); if (note.deleted) return note;
    const at = now || isoNow(); note.deleted = { by, at }; note.deletedAt = at; log(note, by, 'deleted', '', at);
    return note;
  }
  function restoreNote(note, by, now) {
    by = who(by); if (!note.deleted) return note;
    const at = now || isoNow(); note.deleted = null; note.deletedAt = at; log(note, by, 'restored', '', at);
    return note;
  }
  function camOf(c) {
    if (!c) return null;
    const pos = vec(c.pos), target = vec(c.target); if (!pos || !target) return null;
    return { pos, target, up: vec(c.up) || [0, 1, 0], fov: Number.isFinite(c.fov) ? +c.fov : null, ortho: !!c.ortho, half: Number.isFinite(c.half) ? +c.half : null };
  }

  // ── asking about them ──────────────────────────────────────────────────────────────────────────────
  const live = (notes) => notes.filter(n => !n.deleted);
  function stats(notes) {
    const s = { total: 0, open: 0, resolved: 0, deleted: 0, messages: 0 };
    for (const n of notes) {
      if (n.deleted) { s.deleted++; continue; }
      s.total++; if (n.status === 'resolved') s.resolved++; else s.open++;
      s.messages += n.messages.filter(m => !m.deleted).length;
    }
    return s;
  }
  function authors(notes) {
    const set = new Set();
    for (const n of notes) { set.add(n.created.by); if (n.assignee) set.add(n.assignee); for (const m of n.messages) { set.add(m.by); for (const e of m.edits) set.add(e.by); } for (const a of n.activity) set.add(a.by); }
    set.delete(''); return [...set].sort((a, b) => a.localeCompare(b));
  }
  // the time of the last change to a note by anyone
  function lastChange(n) {
    let t = n.created.at;
    for (const a of n.activity) if (a.at > t) t = a.at;
    for (const m of n.messages) if (m.updatedAt > t) t = m.updatedAt;
    return t;
  }
  // The last change made by somebody else than `me`: what to show as new to `me` after `since`.
  function lastOthers(n, me) {
    let t = '';
    for (const a of n.activity) if (a.by !== me && a.at > t) t = a.at;
    return t;
  }
  function unread(n, me, since) { if (!me || n.deleted) return false; const t = lastOthers(n, me); return !!t && (!since || t > since); }
  // text of one message as it reads now, and a line saying what happened to it
  const activityLine = (a) => {
    const i = a.info ? ' ' + a.info : '';
    switch (a.type) {
      case 'created': return a.by + ' started the note';
      case 'replied': return a.by + ' replied';
      case 'edited': return a.by + ' edited' + (a.info ? ' ' + a.info + '’s message' : ' a message');
      case 'removed': return a.by + ' deleted' + (a.info ? ' ' + a.info + '’s message' : ' a message');
      case 'resolved': return a.by + ' marked it resolved';
      case 'reopened': return a.by + ' reopened it';
      case 'tagged': return a.by + ' changed the tag' + i;
      case 'assigned': return a.by + ' assigned it to' + i;
      case 'unassigned': return a.by + ' took the assignment off';
      case 'moved': return a.by + ' moved the pin';
      case 'deleted': return a.by + ' deleted the note';
      case 'restored': return a.by + ' brought the note back';
      case 'restored message': return a.by + ' brought a message back';
      default: return a.by + ' ' + a.type + i;
    }
  };

  // ── in a file, and out of one ─────────────────────────────────────────────────────────────────────────
  function cleanMessage(m) {
    if (!m || typeof m !== 'object') return null;
    const by = name(m.by), body = text(m.text); if (!by && !body) return null;
    const at = iso(m.at) || isoNow();
    return {
      id: str(m.id, 40) || newId('m'), by: by || 'Unknown', at, text: body, updatedAt: iso(m.updatedAt) || at,
      edits: (Array.isArray(m.edits) ? m.edits : []).slice(-LIMITS.edits).map(e => (e && typeof e === 'object' ? { by: name(e.by) || 'Unknown', at: iso(e.at) || at, was: text(e.was) } : null)).filter(Boolean),
      deleted: m.deleted && typeof m.deleted === 'object' ? { by: name(m.deleted.by) || 'Unknown', at: iso(m.deleted.at) || at } : null,
    };
  }
  function cleanNote(r) {
    if (!r || typeof r !== 'object') return null;
    const created = { by: name(r.created && r.created.by) || 'Unknown', at: iso(r.created && r.created.at) || isoNow() };
    const messages = (Array.isArray(r.messages) ? r.messages : []).slice(0, LIMITS.messages).map(cleanMessage).filter(Boolean);
    if (!messages.length) return null;
    const at = created.at;
    return {
      id: str(r.id, 40) || newId('n'), n: Number.isFinite(+r.n) && +r.n > 0 ? Math.floor(+r.n) : 0,
      kind: oneOf(r.kind, ['pin', 'part', 'scene'], 'pin'),
      part: r.part && typeof r.part === 'object' && (r.part.uid || r.part.name) ? { uid: str(r.part.uid, 60), name: str(r.part.name, LIMITS.partName) } : null,
      local: vec(r.local), world: vec(r.world), normal: vec(r.normal), cam: camOf(r.cam),
      tag: oneOf(r.tag, TAG_IDS, 'info'), assignee: name(r.assignee), status: oneOf(r.status, ['open', 'resolved'], 'open'),
      messages,
      activity: (Array.isArray(r.activity) ? r.activity : []).slice(-LIMITS.activity).map(a => (a && typeof a === 'object' && a.type ? { id: str(a.id, 40) || newId('a'), at: iso(a.at) || at, by: name(a.by) || 'Unknown', type: str(a.type, 30), info: str(a.info, 200) } : null)).filter(Boolean),
      created, deleted: r.deleted && typeof r.deleted === 'object' ? { by: name(r.deleted.by) || 'Unknown', at: iso(r.deleted.at) || at } : null,
      thumb: typeof r.thumb === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]*$/.test(r.thumb) && r.thumb.length <= LIMITS.thumb ? r.thumb : '',
      statusAt: iso(r.statusAt) || at, tagAt: iso(r.tagAt) || at, assigneeAt: iso(r.assigneeAt) || at, anchorAt: iso(r.anchorAt) || at, deletedAt: iso(r.deletedAt) || at,
    };
  }
  // The numbers of the notes are theirs for good (they are quoted in conversations); two notes with the same number, which two copies of a
  // file can make, are told apart by when they began: the later one takes the next free number.
  function renumber(notes) {
    const byTime = notes.slice().sort((a, b) => (a.created.at < b.created.at ? -1 : a.created.at > b.created.at ? 1 : a.id < b.id ? -1 : 1));
    const used = new Set(); let max = 0;
    for (const n of byTime) if (n.n > max) max = n.n;
    for (const n of byTime) { if (n.n > 0 && !used.has(n.n)) used.add(n.n); else { n.n = ++max; used.add(n.n); } }
    return notes;
  }
  // raw: what the file holds ({ v, items, seen }); returns { items, seen }. Never throws.
  function parse(raw) {
    const out = { items: [], seen: {} };
    try {
      if (!raw || typeof raw !== 'object') return out;
      const list = Array.isArray(raw.items) ? raw.items : [];
      const ids = new Set();
      for (const r of list.slice(0, LIMITS.notes)) { const n = cleanNote(r); if (n && !ids.has(n.id)) { ids.add(n.id); out.items.push(n); } }
      renumber(out.items);
      if (raw.seen && typeof raw.seen === 'object') for (const k of Object.keys(raw.seen).slice(0, 200)) { const nm = name(k), t = iso(raw.seen[k]); if (nm && t) out.seen[nm] = t; }
    } catch (_) { /* a file that is not ours: no notes */ }
    return out;
  }
  function serialize(notes, seen) {
    return { v: VERSION, items: JSON.parse(JSON.stringify(notes)), seen: Object.assign({}, seen || {}) };
  }

  // ── two copies of the same notes become one ───────────────────────────────────────────────────────────
  // For a thing both copies changed, the later change wins; what is only in one copy is added. Messages, activity and the earlier texts of an
  // edited message are joined, so nobody's words are lost. Returns { items, added, changed } (the numbers of notes and messages that came in).
  function merge(mine, theirs) {
    const items = JSON.parse(JSON.stringify(mine)); let added = 0, changed = 0;
    const by = new Map(items.map(n => [n.id, n]));
    for (const t of JSON.parse(JSON.stringify(theirs))) {
      const a = by.get(t.id);
      if (!a) { items.push(t); by.set(t.id, t); added++; continue; }
      let did = false;
      const ms = new Map(a.messages.map(m => [m.id, m]));
      for (const m of t.messages) {
        const x = ms.get(m.id);
        if (!x) { a.messages.push(m); ms.set(m.id, m); did = true; continue; }
        const seen = new Set(x.edits.map(e => e.at + '|' + e.by));
        for (const e of m.edits) if (!seen.has(e.at + '|' + e.by)) { x.edits.push(e); did = true; }
        x.edits.sort((p, q) => (p.at < q.at ? -1 : 1));
        if (m.updatedAt > x.updatedAt) { x.text = m.text; x.updatedAt = m.updatedAt; x.deleted = m.deleted; did = true; }
      }
      a.messages.sort((p, q) => (p.at < q.at ? -1 : p.at > q.at ? 1 : p.id < q.id ? -1 : 1));
      const acts = new Set(a.activity.map(x => x.id));
      for (const x of t.activity) if (!acts.has(x.id)) { a.activity.push(x); did = true; }
      a.activity.sort((p, q) => (p.at < q.at ? -1 : p.at > q.at ? 1 : 0));
      if (t.statusAt > a.statusAt) { a.status = t.status; a.statusAt = t.statusAt; did = true; }
      if (t.tagAt > a.tagAt) { a.tag = t.tag; a.tagAt = t.tagAt; did = true; }
      if (t.assigneeAt > a.assigneeAt) { a.assignee = t.assignee; a.assigneeAt = t.assigneeAt; did = true; }
      if (t.deletedAt > a.deletedAt) { a.deleted = t.deleted; a.deletedAt = t.deletedAt; did = true; }
      if (t.anchorAt > a.anchorAt) { a.part = t.part; a.local = t.local; a.world = t.world; a.normal = t.normal; a.cam = t.cam; a.kind = t.kind; a.anchorAt = t.anchorAt; did = true; }
      if (!a.thumb && t.thumb) a.thumb = t.thumb;
      if (did) changed++;
    }
    renumber(items);
    return { items, added, changed };
  }

  // ── the notes as words ────────────────────────────────────────────────────────────────────────────────────
  const pad = (n) => String(n).padStart(2, '0');
  function stamp(t) { const d = new Date(t); if (!Number.isFinite(+d)) return ''; return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function ago(t, nowMs) {
    const d = Date.parse(t); if (!Number.isFinite(d)) return '';
    const s = Math.max(0, Math.round(((nowMs == null ? Date.now() : nowMs) - d) / 1000));
    if (s < 45) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 86400) return Math.round(s / 3600) + ' h ago';
    if (s < 86400 * 7) return Math.round(s / 86400) + ' d ago'; return stamp(t).slice(0, 10);
  }
  const tagLabel = (id) => (TAGS.find(t => t.id === id) || TAGS[0]).label;
  const where = (n) => (n.kind === 'scene' ? 'Whole scene' : n.part && n.part.name ? n.part.name : 'a point in the scene');
  function toMarkdown(notes, opts) {
    opts = opts || {};
    const list = live(notes).filter(n => !opts.openOnly || n.status === 'open').sort((a, b) => a.n - b.n);
    const s = stats(notes);
    let out = '# ' + (opts.title || 'Notes') + '\n\n' + s.total + ' note' + (s.total === 1 ? '' : 's') + ' · ' + s.open + ' open · ' + s.resolved + ' resolved' + (opts.at ? ' · ' + stamp(opts.at) : '') + '\n\n';
    for (const n of list) {
      out += '## ' + n.n + '. ' + tagLabel(n.tag) + ' · ' + where(n) + (n.status === 'resolved' ? ' · resolved' : '') + (n.assignee ? ' · for ' + n.assignee : '') + '\n\n';
      for (const m of n.messages) {
        if (m.deleted) { out += '- ~~Message deleted by ' + m.deleted.by + '~~\n'; continue; }
        out += '- **' + m.by + '** (' + stamp(m.at) + '): ' + m.text.replace(/\n+/g, ' ') + (m.edits.length ? ' _(edited by ' + [...new Set(m.edits.map(e => e.by))].join(', ') + ')_' : '') + '\n';
      }
      out += '\n';
    }
    return out;
  }
  function toText(notes, opts) { return toMarkdown(notes, opts).replace(/[*_#~]/g, ''); }
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // One page that opens in any browser, with no app and nothing to load.
  function toHtml(notes, opts) {
    opts = opts || {};
    const list = live(notes).filter(n => !opts.openOnly || n.status === 'open').sort((a, b) => a.n - b.n);
    const s = stats(notes), col = (id) => (TAGS.find(t => t.id === id) || TAGS[0]).color;
    let body = '';
    for (const n of list) {
      body += '<section class="note' + (n.status === 'resolved' ? ' done' : '') + '"><header><span class="num" style="background:' + col(n.tag) + '">' + n.n + '</span><b>' + esc(tagLabel(n.tag)) + '</b><span>' + esc(where(n)) + '</span>'
        + (n.status === 'resolved' ? '<em>resolved</em>' : '') + (n.assignee ? '<em>for ' + esc(n.assignee) + '</em>' : '') + '</header>';
      if (n.thumb) body += '<img alt="" src="' + n.thumb + '">';
      for (const m of n.messages) {
        if (m.deleted) { body += '<p class="gone">Message deleted by ' + esc(m.deleted.by) + ' · ' + esc(stamp(m.deleted.at)) + '</p>'; continue; }
        body += '<div class="msg"><div class="who"><b>' + esc(m.by) + '</b> ' + esc(stamp(m.at)) + '</div><p>' + esc(m.text).replace(/\n/g, '<br>') + '</p>';
        if (m.edits.length) body += '<div class="ed">Edited by ' + esc([...new Set(m.edits.map(e => e.by))].join(', ')) + ' · last ' + esc(stamp(m.updatedAt)) + '<ul>' + m.edits.map(e => '<li>' + esc(e.by) + ' ' + esc(stamp(e.at)) + ', it said: “' + esc(e.was) + '”</li>').join('') + '</ul></div>';
        body += '</div>';
      }
      body += '<details><summary>History</summary><ul>' + n.activity.map(a => '<li>' + esc(stamp(a.at)) + ' · ' + esc(activityLine(a)) + '</li>').join('') + '</ul></details></section>';
    }
    return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(opts.title || 'Notes') + '</title><style>'
      + 'body{font:15px/1.5 system-ui,sans-serif;max-width:760px;margin:32px auto;padding:0 16px;color:#1b1b1d;background:#fff}h1{font-size:24px;margin:0 0 4px}.sum{color:#666;margin:0 0 24px}'
      + '.note{border:1px solid #ddd;border-radius:12px;padding:14px 16px;margin:0 0 16px}.note.done{opacity:.65}header{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px}'
      + '.num{display:inline-grid;place-items:center;min-width:24px;height:24px;border-radius:12px;color:#fff;font-weight:600;font-size:13px}em{font-style:normal;background:#eee;border-radius:10px;padding:1px 8px;font-size:12px}'
      + 'img{max-width:100%;border-radius:8px;margin:4px 0 8px}.msg{margin:8px 0}.who{color:#666;font-size:13px}.msg p{margin:2px 0}.ed{color:#777;font-size:12px}.ed ul,details ul{margin:4px 0;padding-left:18px}.gone{color:#999;font-style:italic}'
      + 'details{margin-top:8px;color:#666;font-size:13px}</style></head><body><h1>' + esc(opts.title || 'Notes') + '</h1><p class="sum">' + s.total + ' note' + (s.total === 1 ? '' : 's') + ' · ' + s.open + ' open · ' + s.resolved + ' resolved'
      + (opts.at ? ' · written ' + esc(stamp(opts.at)) : '') + '</p>' + (body || '<p>No notes.</p>') + '</body></html>';
  }

  // ── the notes inside a scene file that is not open ────────────────────────────────────────────────────────
  // A scene file is a GLB. This reads its JSON part and finds the node the app writes its state on (named `key`, with the state in its
  // extras under the same name). Used to bring the notes of another copy of a scene into this one without opening it.
  function fromGlb(buf, key) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (u8.length < 20) return null;
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (dv.getUint32(0, true) !== 0x46546C67) return null;                 // "glTF"
    const len0 = dv.getUint32(12, true), type0 = dv.getUint32(16, true);
    if (type0 !== 0x4E4F534A || 20 + len0 > u8.length) return null;       // "JSON"
    let json;
    try { json = JSON.parse(new TextDecoder().decode(u8.subarray(20, 20 + len0))); } catch (_) { return null; }
    for (const n of json.nodes || []) {
      const st = n && n.extras && n.extras[key];
      if (st && typeof st === 'object') return st;
    }
    return null;
  }

  const API = {
    VERSION, TAGS, LIMITS, newId,
    create, find, msgOf, reply, edit, removeMessage, restoreMessage, setStatus, setTag, assign, moveAnchor, removeNote, restoreNote,
    live, stats, authors, lastChange, lastOthers, unread, activityLine, tagLabel, where,
    parse, serialize, merge, renumber, fromGlb,
    stamp, ago, toMarkdown, toText, toHtml, name,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.MONotes = API;
})(typeof window !== 'undefined' ? window : globalThis);
