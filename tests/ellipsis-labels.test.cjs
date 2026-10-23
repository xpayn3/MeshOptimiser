// node tests/ellipsis-labels.test.cjs
//
// No text of the app ends a word in a stray '&' where an ellipsis was meant ("Open&", "Working&"). Some time before v0.36.1 the '…'
// of seven labels and messages became '&' (the scene tab's menu said "Open&"). Every script and the page are read for a letter, digit
// or ')' followed by '&' and then the end of a string or a tag (a quote, a backtick or '<'); '&&' and HTML entities do not match.
const fs = require('fs');
const path = require('path');
const APP = path.join(__dirname, '..', 'app');
const files = [path.join(APP, 'index.html'), ...fs.readdirSync(path.join(APP, 'js')).filter(f => f.endsWith('.js') && f !== 'help-content.js').map(f => path.join(APP, 'js', f))];
const bad = [];
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  lines.forEach((l, i) => { if (/[A-Za-z0-9)]&['`"<]/.test(l)) bad.push(path.relative(APP, f) + ':' + (i + 1) + '  ' + l.trim().slice(0, 120)); });
}
if (bad.length) { console.log('FAIL a stray & where an ellipsis (…) was meant:\n  ' + bad.join('\n  ')); process.exitCode = 1; }
else console.log('PASS no stray & at the end of a word in ' + files.length + ' files');
