// node tests/stylesheet-literals.test.cjs: the inline stylesheet in app/index.html, and the styles app.js, cloner.js and notes.js inject, may only get cleaner.
//
// appearance.js overrides the surface and accent tokens for the user's tone and accent, so a typed-in colour in a rule bypasses the
// theme. This counts (a) the lines with a literal hex colour outside a custom-property definition and (b) the var(--name) references
// to a token nothing defines, and (c) the z-index values typed in as a number of 10 or more (the layers are the --z-* tokens; a number
// under 10 is the stacking inside one component). Each count has a ceiling; the test fails, listing the lines, when a count goes above it.
//
// The ceilings are today's counts (2026-10-17). THEY MAY ONLY GO DOWN: when you replace literals with tokens, lower the number to
// what the test prints; never raise it to make a new colour pass (use a token, or define the missing one in :root).
const MAX_HEX_LINES = 42;          // app/index.html
const MAX_HEX_LINES_JS = 6;        // the injected styles: the colour picker's own red, white and black (the hue strip and the square)
const MAX_UNDEFINED_TOKENS = 0;
const MAX_Z_NUMBERS = 2;           // .adk-menu (20) and .adk-insp (12), inside the animation dock

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', 'app');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appearance = fs.readFileSync(path.join(root, 'js', 'appearance.js'), 'utf8');
const SCRIPTS = ['app.js', 'cloner.js', 'notes.js'];   // the scripts that build a <style> or set style.cssText

// Names the app sets per element from app.js (style.setProperty), so the stylesheet cannot define them.
const SET_BY_SCRIPT = new Set(['--c', '--i', '--n', '--w', '--u', '--d', '--s', '--k', '--j', '--dx', '--dy', '--fx', '--fy', '--tx', '--ty', '--tw', '--fh',
  '--sw', '--osr', '--pb', '--rb', '--rn-ox', '--rn-oy', '--ti-m', '--tip-rows', '--tree-sbw', '--doc-tab-w', '--mat-max-h', '--cf-foot', '--icon-cln', '--fw']);

const blank = (s) => s.replace(/[^\n]/g, '');   // keep the line breaks so a hit reports its line in index.html

// Only the content of the <style> blocks; every other character becomes a blank, so line numbers stay those of index.html.
let css = '', last = 0, m;
const styleRe = /(<style\b[^>]*>)([\s\S]*?)<\/style>/gi;
while ((m = styleRe.exec(html))) {
  css += blank(html.slice(last, m.index + m[1].length)) + m[2];
  last = m.index + m[1].length + m[2].length;
}
css += blank(html.slice(last));
css = css.replace(/\/\*[\s\S]*?\*\//g, blank);   // comments

const lineText = (n) => html.split('\n')[n - 1].trim().slice(0, 120);
const failures = [];
let bad = 0;
const check = (what, hits, max) => {
  console.log(what + ': ' + hits.length + ' (ceiling ' + max + ')');
  if (hits.length > max) {
    bad++;
    failures.push('FAIL ' + what + ': ' + hits.length + ' is above the ceiling of ' + max + '. Lines:');
    hits.forEach((h) => failures.push('  ' + (h.file || 'app/index.html') + ':' + h.line + '  ' + h.text));
  } else if (hits.length < max) {
    console.log('  lower than the ceiling: set the ceiling at the top of this file to ' + hits.length);
  }
};

// (a) hex colours. Not counted: custom-property definitions (--name: value), data: URLs (the SVGs of --tick, --select-arrow,
// mask-image), selectors such as #abc, and anything inside a comment.
const noData = css.replace(/url\(\s*(["'])data:[\s\S]*?\1\s*\)|url\(\s*data:[^)]*\)/g, blank);
const noDefs = noData.replace(/--[\w-]+\s*:[^;{}]*/g, blank);
const hexIn = (text, file, src) => {
  const hits = [];
  text.split('\n').forEach((l, i) => {
    const open = l.indexOf('{');
    const decl = open >= 0 ? l.slice(open) : l;     // what follows the selector on this line
    if (/:[^]*?#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![0-9a-z_-])/i.test(decl)) hits.push({ file, line: i + 1, text: src.split('\n')[i].trim().slice(0, 120) });
  });
  return hits;
};
check('lines with a literal hex colour', hexIn(noDefs, 'app/index.html', html), MAX_HEX_LINES);

// The styles the scripts inject: the template literals and strings that are handed to a <style> or to style.cssText. Everything
// else in the script becomes a blank, so a hit reports its line in the script. (A ${...} inside them is left as it is.)
const scriptCss = {};
for (const name of SCRIPTS) {
  const js = fs.readFileSync(path.join(root, 'js', name), 'utf8');
  let out = '', at = 0, hit;
  const re = /(?:textContent|innerHTML|cssText|css)\s*=\s*(`[\s\S]*?`|'[^'\n]*'|"[^"\n]*")/g;
  while ((hit = re.exec(js))) {
    const body = hit[1].slice(1, -1);
    if (!/[a-z-]+\s*:[^;{}]+;[\s\S]*[a-z-]+\s*:/.test(body)) continue;   // not CSS (one declaration or none)
    const start = hit.index + hit[0].length - hit[1].length + 1;
    out += blank(js.slice(at, start)) + body; at = start + body.length;
  }
  out += blank(js.slice(at));
  scriptCss[name] = { css: out.replace(/\/\*[\s\S]*?\*\//g, blank), src: js };
}
let jsHex = [];
for (const name of SCRIPTS) {
  const { css: c, src } = scriptCss[name];
  const noUrl = c.replace(/url\(\s*(["'])data:[\s\S]*?\1\s*\)|url\(\s*data:[^)]*\)/g, blank).replace(/--[\w-]+\s*:[^;{}]*/g, blank);
  jsHex = jsHex.concat(hexIn(noUrl, 'app/js/' + name, src));
}
check('lines with a literal hex colour in the injected styles', jsHex, MAX_HEX_LINES_JS);

// (b) var(--name) with no fallback, where no rule of the stylesheet and no set('--name' in appearance.js defines --name.
// (A name defined only on a component, such as --pc on a pill, counts as defined: it is the component's own input.)
const defined = new Set([...css.matchAll(/(?:^|[;{\s])(--[\w-]+)\s*:/g)].map((x) => x[1]));
for (const x of appearance.matchAll(/set\(\s*'(--[\w-]+)'/g)) defined.add(x[1]);
const undef = [];
const lines = css.split('\n');
lines.forEach((l, i) => {
  for (const r of l.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)) {
    if (r[2] === ',' || defined.has(r[1]) || SET_BY_SCRIPT.has(r[1])) continue;   // a fallback makes it optional
    undef.push({ line: i + 1, text: r[1] + '  in  ' + lineText(i + 1) });
  }
});
check('var() references to an undefined token', undef, MAX_UNDEFINED_TOKENS);

// (c) z-index as a number of 10 or more: the layer belongs in a --z-* token (the --z-* definitions themselves are not counted).
const zIn = (text, file, src) => {
  const hits = [];
  text.replace(/--[\w-]+\s*:[^;{}]*/g, blank).split('\n').forEach((l, i) => {
    if (/z-index\s*:\s*(?:[1-9][0-9]+)(?![0-9])/.test(l)) hits.push({ file, line: i + 1, text: src.split('\n')[i].trim().slice(0, 120) });
  });
  return hits;
};
let zHits = zIn(css, 'app/index.html', html);
const inlineZ = [...html.matchAll(/style="[^"]*z-index\s*:\s*[1-9][0-9]+[^"]*"/g)];
inlineZ.forEach((x) => zHits.push({ file: 'app/index.html', line: html.slice(0, x.index).split('\n').length, text: x[0].slice(0, 120) }));
for (const name of SCRIPTS) zHits = zHits.concat(zIn(scriptCss[name].css, 'app/js/' + name, scriptCss[name].src));
check('z-index typed in as a number of 10 or more', zHits, MAX_Z_NUMBERS);

if (bad) { failures.forEach((f) => console.error(f)); process.exit(1); }
console.log('ok');
