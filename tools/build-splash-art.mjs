// node tools/build-splash-art.mjs — draws the little clip on the splash screen (index.html) as inline SVG.
//
// An isometric cube in two states that the CSS (index.html, "Start-up") fades between: a dense wireframe, and the
// same cube as six flat triangles in the CAD view's colours. The markup between the splash-art markers is replaced.
import fs from 'fs';

const N = 8, K = 34;                                                   // cells per side, size in svg units
const P = (x, y, z) => [(x - y) * 0.866 * K, ((x + y) * 0.5 - z) * K];  // the isometric corner of a point of the unit cube
const f = (n) => (Math.round(n * 100) / 100).toString();
const face = {                                                         // (u, v) in 0..1 on each of the three faces that show
  top:   (u, v) => P(u, v, 1),
  left:  (u, v) => P(u, 1, v),
  right: (u, v) => P(1, u, v),
};
const COLOUR = { top: '#b39c88', left: '#8d95a0', right: '#2f3033' };   // the CAD view's ceramic look: warm up, light left, dark right

function dense(fn) {                                                   // a triangulated grid: lines both ways, a diagonal in each cell
  const d = [];
  for (let i = 0; i <= N; i++) {
    const a = fn(i / N, 0), b = fn(i / N, 1), c = fn(0, i / N), e = fn(1, i / N);
    d.push(`M${f(a[0])} ${f(a[1])}L${f(b[0])} ${f(b[1])}`, `M${f(c[0])} ${f(c[1])}L${f(e[0])} ${f(e[1])}`);
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const a = fn(i / N, j / N), b = fn((i + 1) / N, (j + 1) / N);
    d.push(`M${f(a[0])} ${f(a[1])}L${f(b[0])} ${f(b[1])}`);
  }
  return d.join('');
}
const quad = (fn) => [fn(0, 0), fn(1, 0), fn(1, 1), fn(0, 1)].map(p => f(p[0]) + ',' + f(p[1])).join(' ');
const diag = (fn) => { const a = fn(0, 0), b = fn(1, 1); return `M${f(a[0])} ${f(a[1])}L${f(b[0])} ${f(b[1])}`; };

const svg = `<svg class="splash-clip" viewBox="-44 -44 88 88" width="132" height="132" aria-hidden="true" focusable="false">
      <g class="sp-lite">
        ${['top', 'left', 'right'].map(k => `<polygon points="${quad(face[k])}" fill="${COLOUR[k]}"/><path d="${diag(face[k])}" class="sp-diag"/>`).join('\n        ')}
        <path class="sp-edge" d="M${f(P(0, 0, 1)[0])} ${f(P(0, 0, 1)[1])}L${f(P(1, 0, 1)[0])} ${f(P(1, 0, 1)[1])}L${f(P(1, 1, 1)[0])} ${f(P(1, 1, 1)[1])}L${f(P(0, 1, 1)[0])} ${f(P(0, 1, 1)[1])}Z M${f(P(0, 1, 1)[0])} ${f(P(0, 1, 1)[1])}L${f(P(0, 1, 0)[0])} ${f(P(0, 1, 0)[1])}L${f(P(1, 1, 0)[0])} ${f(P(1, 1, 0)[1])}L${f(P(1, 0, 0)[0])} ${f(P(1, 0, 0)[1])}L${f(P(1, 0, 1)[0])} ${f(P(1, 0, 1)[1])} M${f(P(1, 1, 1)[0])} ${f(P(1, 1, 1)[1])}L${f(P(1, 1, 0)[0])} ${f(P(1, 1, 0)[1])}"/>
      </g>
      <g class="sp-dense"><path d="${['top', 'left', 'right'].map(k => dense(face[k])).join('')}"/></g>
    </svg>`;

const file = new URL('../index.html', import.meta.url);
let html = fs.readFileSync(file, 'utf8');
const wrapped = `<!-- splash-art -->\n    ${svg}\n    <!-- /splash-art -->`;
if (html.includes('<!-- splash-art -->')) html = html.replace(/<!-- splash-art -->[\s\S]*?<!-- \/splash-art -->/, () => wrapped);
else {
  const old = html.match(/<svg class="splash-mark"[\s\S]*?<\/svg>/);
  if (!old) throw new Error('no splash mark to replace');
  html = html.replace(old[0], () => wrapped);
}
fs.writeFileSync(file, html);
console.log('splash art written:', svg.length, 'bytes');
