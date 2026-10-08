// node tests/appearance.test.cjs — appearance.js sets the right tokens for each choice and none for the defaults (against a stub document).
const props = {}; const classes = new Set(); let stored = {};
global.window = global;
global.localStorage = { getItem: () => JSON.stringify(stored) };
global.document = { documentElement: { style: { setProperty: (k, v) => { props[k] = v; }, removeProperty: (k) => { delete props[k]; } }, classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) } }, querySelector: () => ({ setAttribute: (a, v) => { props['meta:' + a] = v; } }) };
require(require('path').join(__dirname, '..', 'appearance.js'));
const A = window.MOAppearance; let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.error('FAIL', m); } };
const reset = () => { for (const k of Object.keys(props)) delete props[k]; classes.clear(); };
// defaults: nothing is set, the stylesheet's own values stay
stored = {}; reset(); A.apply(); ok(Object.keys(props).filter(k => !k.startsWith('meta:')).length === 0, 'defaults must leave no inline tokens: ' + Object.keys(props));
// accent
stored = { uiAccent: '#ec5b98' }; reset(); A.apply();
ok(props['--ac'] === '#ec5b98', '--ac'); ok(/^rgba\(236,91,152,0\.1\)$/.test(props['--ac-soft']), '--ac-soft ' + props['--ac-soft']); ok(props['--ac-tint-55'] === 'rgba(236,91,152,0.55)', 'tint 55');
ok(props['--tx-on-accent'] === '#ffffff', 'white text on pink'); ok(/^#[0-9a-f]{6}$/.test(props['--ac-text']), 'ac-text hex');
stored = { uiAccent: '#f5e64a' }; reset(); A.apply(); ok(props['--tx-on-accent'] === '#14161a', 'dark text on a light accent');
stored = { uiAccent: 'not a colour' }; reset(); A.apply(); ok(!props['--ac'], 'a bad colour falls back to the default');
// tone
stored = { uiTone: 'midnight' }; reset(); A.apply(); ok(props['--bg'] === '#0e1116' && props['--surface-pop'] === '#141820', 'midnight'); ok(props['meta:content'] === '#0e1116', 'theme-color');
stored = { uiTone: 'nonsense' }; reset(); A.apply(); ok(!props['--bg'], 'unknown tone = default');
// type and size
stored = { uiFont: 'mono' }; reset(); A.apply(); ok(/ui-monospace/.test(props['--font-sans']), 'mono font');
stored = { uiTextScale: 1.2 }; reset(); A.apply(); ok(props['--fs-12'] === '14px' && props['--fs-md'] === '16px', 'text scale ' + props['--fs-12'] + ' ' + props['--fs-md']);
stored = { uiDensity: 0.88 }; reset(); A.apply(); ok(props['--btn-h-md'] === '28px' && props['--btn-h-sm'] === '23px', 'density ' + props['--btn-h-md']);
// shape, motion
stored = { uiRadius: 'round' }; reset(); A.apply(); ok(props['--r-sm'] === '9.6px' && props['--r-lg'] === '14px', 'round ' + props['--r-sm'] + ' ' + props['--r-lg']);
stored = { uiRadius: 'sharp' }; reset(); A.apply(); ok(props['--r-lg'] === '2.5px', 'sharp ' + props['--r-lg']);
stored = { uiMotion: false }; reset(); A.apply(); ok(classes.has('no-motion'), 'no-motion class');
stored = { uiMotion: true }; reset(); A.apply(); ok(!classes.has('no-motion'), 'motion on');
// corrupt storage
global.localStorage = { getItem: () => '{broken' }; reset(); A.apply(); ok(true, 'corrupt prefs do not throw');
console.log(bad ? bad + ' failed' : 'appearance.js: all checks pass');
process.exit(bad ? 1 : 0);
