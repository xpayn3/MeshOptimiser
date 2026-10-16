// Pull real components out of the running app: their markup and every CSS rule that applies to them.
const S = window.__s;
const q = (s) => document.querySelector(s);
const secOf = (name) => [...document.querySelectorAll('.section')].find(s => (s.querySelector('.section-h')?.textContent || '').trim().startsWith(name));
const roots = {
  smart: secOf('Smart optimise'),
  explode: secOf('Exploded view'),
  props: q('.section-fixed'),
  fasteners: q('.section-cmd[data-cmd=fasteners]'),
  dock: q('#tg-library').closest('.vpc'),
  topbar: q('#tb'),
  library: q('#vp-library-pop'),
  tree: q('#tree'),
  tips: q('.vp-tips'),
  small: secOf('Delete small parts'),
  similar: secOf('Select similar'),
};
const missing = Object.entries(roots).filter(([k, v]) => !v).map(([k]) => k);
const stripState = (sel) => sel.replace(/::?(hover|focus|focus-visible|focus-within|active|disabled|checked|before|after|placeholder|-webkit-[a-z-]+|-moz-[a-z-]+|first-child|last-child|nth-child\([^)]*\)|not\([^)]*\)|is\([^)]*\)|where\([^)]*\)|has\([^)]*\))/g, '').trim();
const sheets = [...document.styleSheets, ...document.adoptedStyleSheets];
const used = new Map();   // cssText -> true
const vars = [];
const matches = (root, sel) => { try { const t = stripState(sel); if (!t) return false; return root.matches(t) || !!root.querySelector(t); } catch (e) { return false; } };
for (const sh of sheets) {
  let rules; try { rules = sh.cssRules; } catch (e) { continue; }
  for (const r of rules) {
    if (r.type !== 1) continue;
    const sels = r.selectorText.split(',').map(s => s.trim());
    if (sels.some(s => /^(:root|html)(\[[^\]]*\])?$/.test(s))) { vars.push(r.cssText); continue; }
    for (const root of Object.values(roots)) {
      if (root && sels.some(s => matches(root, s))) { used.set(r.cssText, true); break; }
    }
  }
}
const clean = (el, name) => {
  const c = el.cloneNode(true);
  if (name === 'library') {
    c.querySelectorAll('#lib-inspector, #lib-insp-grip, #lib-dock-grip').forEach(e => e.remove());
    c.querySelectorAll('.lib-sec[hidden]').forEach(e => e.remove()); const secs = [...c.querySelectorAll('.lib-sec')]; secs.slice(2).forEach(e => e.remove());
    secs.slice(0, 2).forEach(sec => { const items = [...sec.querySelectorAll('.lib-item')]; items.slice(8).forEach(e => e.remove()); });
  }
  if (name === 'tree') { const rows = [...c.querySelectorAll('.tree-node')]; rows.slice(11).forEach(e => e.remove()); }
  c.querySelectorAll('*').forEach(e => { for (const a of [...e.attributes]) { if (/^(on|data-(?!icon|lib|cmd)|aria-live|draggable)/.test(a.name) || a.name === 'loading') e.removeAttribute(a.name); } });
  c.querySelectorAll('script').forEach(e => e.remove());
  return c;
};
const out = {};
for (const [k, el] of Object.entries(roots)) if (el) out[k] = clean(el, k).outerHTML;
return JSON.stringify({ missing, parts: out, rules: [...used.keys()], vars, nRules: used.size });
