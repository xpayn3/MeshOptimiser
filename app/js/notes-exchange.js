// ========== NOTES: taking them out and bringing them in (CSV, JSON, BCF) ==========
// Pure functions, no page: notes-core.js (MONotes) is the only thing this needs. The page (notes.js) asks for a file and saves or reads it.
//   CSV   one row per note, for a spreadsheet (opens in Excel: UTF-8 with a BOM)
//   JSON  everything a note holds; "Bring in notes" reads it back
//   BCF   BIM Collaboration Format 2.1 (a zip of XML), the way design tools pass issues around: one topic per note, its messages as comments,
//         the saved view as a viewpoint (BCF is Z-up in metres; the scene here is Y-up, so a viewpoint is turned on the way out and back in)
// A BCF file made here carries each note's id in <ReferenceLink>, so bringing it back in joins the notes it came from instead of copying them.
// Tests: tests/notes.test.mjs.
(function (root) {
  'use strict';
  const C = typeof module !== 'undefined' && module.exports ? require('./notes-core.js') : root.MONotes;

  const enc = new TextEncoder(), dec = new TextDecoder();
  const live = (notes) => notes.filter(n => !n.deleted);
  const live1 = (n) => n.messages.filter(m => !m.deleted);

  // ── CSV ─────────────────────────────────────────────────────────────────────────────────────────────────
  const cell = (v) => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  // a cell that starts with = + - @ is read as a formula by a spreadsheet: a word is put in front of it so it stays text
  const safe = (v) => { const s = v == null ? '' : String(v); return /^[=+\-@\t\r]/.test(s) ? "'" + s : s; };
  function toCsv(notes, opts) {
    opts = opts || {};
    const head = ['Number', 'Title', 'Kind', 'Status', 'Priority', 'Due', 'Assigned to', 'Part', 'Other parts', 'Started by', 'Started', 'Last change', 'Comments', 'Description', 'Conversation', 'Position (x y z)'];
    const rows = [head];
    for (const n of live(notes).sort((a, b) => a.n - b.n)) {
      const ms = live1(n);
      const dm = ms.find(m => m.desc), cs = ms.filter(m => !m.desc);
      rows.push([n.n, C.noteTitle(n), C.tagLabel(n.tag), n.status === 'resolved' ? 'Resolved' : 'Open', n.priority || 'normal', n.due || '', n.assignee || '',
        n.kind === 'scene' ? 'Whole scene' : (n.part && n.part.name) || '', (n.also || []).map(p => p.name).join('; '), n.created.by, n.created.at, C.lastChange(n), cs.length,
        dm ? dm.text : '', ms.map(m => m.by + ' (' + C.stamp(m.at) + '): ' + m.text.replace(/\s+/g, ' ')).join(' | '), n.world ? n.world.map(x => +x.toFixed(4)).join(' ') : ''].map(safe));
    }
    return '﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
  }

  // ── JSON ────────────────────────────────────────────────────────────────────────────────────────────────
  function toJson(notes, reviews, opts) {
    opts = opts || {};
    return JSON.stringify({ app: 'MeshOptimiser', format: 'notes', version: 1, title: opts.title || '', exported: opts.at || new Date().toISOString(), notes: C.serialize(notes, opts.seen || {}, reviews || {}) }, null, 2);
  }
  // what a JSON file holds, or null when it is not ours (a bare payload { items } is taken too)
  function fromJson(text) {
    let j; try { j = JSON.parse(text); } catch (_) { return null; }
    const payload = j && j.notes && Array.isArray(j.notes.items) ? j.notes : j && Array.isArray(j.items) ? j : null;
    return payload ? C.parse(payload) : null;
  }

  // ── a zip with nothing squeezed (all BCF needs) and one that is read back ──────────────────────────────────
  let crcTable = null;
  const crc32 = (u8) => {
    if (!crcTable) { crcTable = new Uint32Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcTable[i] = c >>> 0; } }
    let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = crcTable[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0;
  };
  function zipStore(files) {
    const parts = [], central = []; let offset = 0;
    const u16 = (v) => [v & 255, (v >> 8) & 255], u32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
    for (const f of files) {
      const name = enc.encode(f.name), data = f.data instanceof Uint8Array ? f.data : enc.encode(String(f.data)), crc = crc32(data);
      const local = new Uint8Array([0x50, 0x4b, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)]);
      parts.push(local, name, data);
      central.push({ name, crc, size: data.length, offset });
      offset += local.length + name.length + data.length;
    }
    const cstart = offset; let csize = 0;
    for (const c of central) {
      const rec = new Uint8Array([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(c.crc), ...u32(c.size), ...u32(c.size), ...u16(c.name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(c.offset)]);
      parts.push(rec, c.name); csize += rec.length + c.name.length;
    }
    parts.push(new Uint8Array([0x50, 0x4b, 5, 6, ...u16(0), ...u16(0), ...u16(central.length), ...u16(central.length), ...u32(csize), ...u32(cstart), ...u16(0)]));
    let total = 0; for (const p of parts) total += p.length; const out = new Uint8Array(total); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  // { name: Uint8Array } for the files of a zip; stored or deflated entries; a file that is not a zip gives null. Size is capped: it is a file from anyone.
  async function unzip(buf, maxTotal) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); maxTotal = maxTotal || 200 * 1024 * 1024;
    let e = -1; for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) return null;
    const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const out = {}; let total = 0;
    for (let i = 0; i < n && i < 5000; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nl)); p += 46 + nl + xl + cl;
      if (name.endsWith('/') || name.includes('..')) continue;
      total += usize; if (total > maxTotal) throw new Error('That file is too big');
      const ln = dv.getUint16(lo + 26, true), lx = dv.getUint16(lo + 28, true), start = lo + 30 + ln + lx, raw = u8.subarray(start, start + csize);
      if (method === 0) out[name] = raw.slice();
      else if (method === 8) { const ds = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw')); out[name] = new Uint8Array(await new Response(ds).arrayBuffer()); }
    }
    return out;
  }

  // ── BCF ─────────────────────────────────────────────────────────────────────────────────────────────────
  const xe = (s) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const xu = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&');
  // a stable GUID from any text (the same note always gives the same one)
  function guid(seed) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57, h3 = 0x9e3779b9, h4 = 0x85ebca6b; const s = String(seed);
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); h3 = Math.imul(h3 ^ c, 2246822519); h4 = Math.imul(h4 ^ c, 3266489917); }
    const hex = [h1, h2, h3, h4].map(v => (v >>> 0).toString(16).padStart(8, '0')).join(''); const v = '4' + hex.slice(13, 16), y = '89ab'[parseInt(hex[16], 16) & 3] + hex.slice(17, 20);
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + v + '-' + y + '-' + hex.slice(20, 32);
  }
  const PRI_OUT = { normal: 'Normal', high: 'High', urgent: 'Critical' }, PRI_IN = { low: 'normal', normal: 'normal', medium: 'normal', high: 'high', major: 'high', critical: 'urgent', urgent: 'urgent', blocker: 'urgent' };
  // the scene is Y up, BCF is Z up: (x, y, z) -> (x, -z, y), and back
  const toZup = (v) => [v[0], -v[2], v[1]], toYup = (v) => [v[0], v[2], -v[1]];
  const vecXml = (tag, v) => '<' + tag + '><X>' + v[0] + '</X><Y>' + v[1] + '</Y><Z>' + v[2] + '</Z></' + tag + '>';
  function toBcf(notes, opts) {
    opts = opts || {}; const files = [], list = live(notes).sort((a, b) => a.n - b.n);
    files.push({ name: 'bcf.version', data: '<?xml version="1.0" encoding="UTF-8"?>\n<Version VersionId="2.1" xsi:noNamespaceSchemaLocation="version.xsd" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">\n  <DetailedVersion>2.1</DetailedVersion>\n</Version>\n' });
    files.push({ name: 'project.bcfp', data: '<?xml version="1.0" encoding="UTF-8"?>\n<ProjectExtension xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">\n  <Project ProjectId="' + guid('project:' + (opts.title || 'notes')) + '">\n    <Name>' + xe(opts.title || 'MeshOptimiser notes') + '</Name>\n  </Project>\n  <ExtensionSchema></ExtensionSchema>\n</ProjectExtension>\n' });
    for (const n of list) {
      const g = guid(n.id), ms = live1(n), dm = ms.find(m => m.desc), cs = ms.filter(m => !m.desc); const vg = guid('vp:' + n.id);
      const title = C.noteTitle(n).slice(0, 120);
      let x = '<?xml version="1.0" encoding="UTF-8"?>\n<Markup xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">\n';
      x += '  <Topic Guid="' + g + '" TopicType="' + xe(C.tagLabel(n.tag)) + '" TopicStatus="' + (n.status === 'resolved' ? 'Closed' : 'Open') + '">\n';
      x += '    <ReferenceLink>MeshOptimiser:note:' + xe(n.id) + '</ReferenceLink>\n    <Title>' + xe(title) + '</Title>\n    <Priority>' + PRI_OUT[n.priority || 'normal'] + '</Priority>\n';
      x += '    <Index>' + n.n + '</Index>\n    <CreationDate>' + xe(n.created.at) + '</CreationDate>\n    <CreationAuthor>' + xe(n.created.by) + '</CreationAuthor>\n';
      x += '    <ModifiedDate>' + xe(C.lastChange(n)) + '</ModifiedDate>\n';
      if (n.due) x += '    <DueDate>' + n.due + 'T00:00:00Z</DueDate>\n';
      if (n.assignee) x += '    <AssignedTo>' + xe(n.assignee) + '</AssignedTo>\n';
      x += '    <Description>' + xe(dm ? dm.text : '') + (n.kind !== 'scene' && n.part ? '\n\nPart: ' + xe([n.part.name].concat((n.also || []).map(p => p.name)).join(', ')) : '') + '</Description>\n  </Topic>\n';
      for (const m of cs) x += '  <Comment Guid="' + guid(m.id) + '">\n    <Date>' + xe(m.at) + '</Date>\n    <Author>' + xe(m.by) + '</Author>\n    <Comment>' + xe(m.text) + '</Comment>\n    <Viewpoint Guid="' + vg + '"/>\n  </Comment>\n';
      const withView = !!n.cam, snap = n.thumb && /^data:image\/jpeg;base64,/.test(n.thumb);
      if (withView) x += '  <Viewpoints Guid="' + vg + '">\n    <Viewpoint>viewpoint.bcfv</Viewpoint>\n' + (snap ? '    <Snapshot>snapshot.jpg</Snapshot>\n' : '') + '  </Viewpoints>\n';
      x += '</Markup>\n';
      files.push({ name: g + '/markup.bcf', data: x });
      if (withView) {
        const c = n.cam, p = toZup(c.pos), t = toZup(c.target); let d = [t[0] - p[0], t[1] - p[1], t[2] - p[2]]; const l = Math.hypot(d[0], d[1], d[2]) || 1; d = d.map(v => v / l);
        files.push({ name: g + '/viewpoint.bcfv', data: '<?xml version="1.0" encoding="UTF-8"?>\n<VisualizationInfo Guid="' + vg + '" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">\n  <PerspectiveCamera>\n    ' + vecXml('CameraViewPoint', p) + '\n    ' + vecXml('CameraDirection', d) + '\n    ' + vecXml('CameraUpVector', toZup(c.up)) + '\n    <FieldOfView>' + (c.fov || 50) + '</FieldOfView>\n  </PerspectiveCamera>\n</VisualizationInfo>\n' });
        if (snap) { const b = atob(n.thumb.slice(n.thumb.indexOf(',') + 1)); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); files.push({ name: g + '/snapshot.jpg', data: u }); }
      }
    }
    return zipStore(files);
  }
  // ── reading one back ──
  const tagText = (x, t) => { const m = new RegExp('<' + t + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + t + '>').exec(x); return m ? xu(m[1]).trim() : ''; };
  const attr = (x, t, a) => { const m = new RegExp('<' + t + '\\s[^>]*?\\b' + a + '="([^"]*)"').exec(x); return m ? xu(m[1]) : ''; };
  const num3 = (x, t) => { const m = new RegExp('<' + t + '>([\\s\\S]*?)</' + t + '>').exec(x); if (!m) return null; const v = ['X', 'Y', 'Z'].map(k => parseFloat(tagText(m[1], k))); return v.every(Number.isFinite) ? v : null; };
  const TYPE_IN = { issue: 'issue', error: 'issue', clash: 'issue', fault: 'issue', question: 'question', request: 'question', idea: 'idea', suggestion: 'idea', remark: 'info', info: 'info', comment: 'info' };
  // buf: a .bcf / .bcfzip. Returns { items, skipped } (items as a notes payload would give them). Never trusts the file: C.parse cuts everything to size.
  async function fromBcf(buf, existing) {
    const files = await unzip(buf); if (!files) return null;
    const raw = []; let skipped = 0; const names = Object.keys(files).filter(f => /(^|\/)markup\.bcf$/.test(f)).slice(0, C.LIMITS.notes);
    const known = new Map((existing || []).map(n => [n.id, n]));
    for (const f of names) {
      const x = dec.decode(files[f]), topic = /<Topic\s[\s\S]*?<\/Topic>/.exec(x); if (!topic) { skipped++; continue; }
      const t = topic[0], g = attr(t, 'Topic', 'Guid'), ref = /MeshOptimiser:note:([A-Za-z0-9_-]{1,40})/.exec(tagText(t, 'ReferenceLink')), id = ref ? ref[1] : 'bcf_' + g;
      const prior = known.get(id); const dir = f.includes('/') ? f.slice(0, f.lastIndexOf('/') + 1) : '';
      const desc = tagText(t, 'Description').replace(/\n\nPart: [\s\S]*$/, ''), title = tagText(t, 'Title');
      const created = tagText(t, 'CreationDate') || new Date().toISOString(), by = tagText(t, 'CreationAuthor') || 'Unknown';
      // a message already there (same words, same person, same time) keeps its own id, so the notes join and nothing is doubled
      const same = (nm, at, text) => { const m = prior && prior.messages.find(q => q.by === nm && q.text === text && (q.at === at)); return m ? m.id : ''; };
      const messages = desc ? [{ id: same(by, created, desc) || 'bm_' + g, by, at: created, text: desc, desc: true, updatedAt: created, edits: [], deleted: null, to: '', react: {} }] : [];
      const cm = /<Comment\s[\s\S]*?<\/Comment>\s*(?=<Comment\s|<Viewpoints|<\/Markup|$)/g; let m; const comments = x.match(/<Comment Guid="[^"]*">[\s\S]*?<\/Comment>(?:\s*<Viewpoint[^>]*\/>)?/g) || [];
      void cm; void m;
      for (const c of comments) {
        const text = tagText(c.replace(/<Viewpoint[^>]*\/>/, ''), 'Comment').replace(/^[\s\S]*?<Comment>/, ''); const at = tagText(c, 'Date') || created, nm = tagText(c, 'Author') || 'Unknown'; const body = /<Comment>([\s\S]*?)<\/Comment>\s*(?:<Viewpoint|<\/Comment>)/.exec(c); const tx = body ? xu(body[1]).trim() : text;
        if (!tx) continue; messages.push({ id: same(nm, at, tx) || 'bm_' + attr(c, 'Comment', 'Guid'), by: nm, at, text: tx, updatedAt: at, edits: [], deleted: null, to: '', react: {} });
      }
      let cam = null; const vf = files[dir + 'viewpoint.bcfv'];
      if (vf) { const vx = dec.decode(vf), p = num3(vx, 'CameraViewPoint'), d = num3(vx, 'CameraDirection'), u = num3(vx, 'CameraUpVector'); if (p && d && u) { const pp = toYup(p), dd = toYup(d), dist = 1; cam = { pos: pp, target: [pp[0] + dd[0] * dist, pp[1] + dd[1] * dist, pp[2] + dd[2] * dist], up: toYup(u), fov: parseFloat(tagText(vx, 'FieldOfView')) || 50 }; } }
      let thumb = ''; const sn = files[dir + 'snapshot.jpg'] || files[dir + 'snapshot.jpeg']; if (sn && sn.length < C.LIMITS.thumb * 0.74) { let s = ''; for (let i = 0; i < sn.length; i++) s += String.fromCharCode(sn[i]); thumb = 'data:image/jpeg;base64,' + btoa(s); }
      const type = tagText(t, 'Title') && attr(t, 'Topic', 'TopicType').toLowerCase(), status = attr(t, 'Topic', 'TopicStatus').toLowerCase();
      const due = /^(\d{4}-\d{2}-\d{2})/.exec(tagText(t, 'DueDate'));
      const mod = tagText(t, 'ModifiedDate') || created;      // (a change made in the other tool, later than ours, wins)
      raw.push({ id, n: 0, title: title || 'Note', titleAt: mod, kind: 'scene', part: null, cam, statusAt: mod, tagAt: mod, assigneeAt: mod, priorityAt: mod, dueAt: mod, tag: TYPE_IN[type] || 'info', assignee: tagText(t, 'AssignedTo'), status: /clos|resolv|done|fixed/.test(status) ? 'resolved' : 'open', priority: PRI_IN[tagText(t, 'Priority').toLowerCase()] || 'normal', due: due ? due[1] : '',
        messages, activity: prior ? [] : [{ id: 'ba_' + g, at: created, by, type: 'created', info: 'from BCF' }], created: { by, at: created }, thumb });
    }
    const p = C.parse({ items: raw });
    return { items: p.items, skipped };
  }

  const API = { toCsv, toJson, fromJson, toBcf, fromBcf, zipStore, unzip, guid, crc32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.MONotesIO = API;
})(typeof window !== 'undefined' ? window : globalThis);
