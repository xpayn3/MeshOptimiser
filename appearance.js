/* Appearance: how the interface looks (accent, surfaces, type, size, corners, motion).
 *
 * The choices are a few preferences in the app's prefs (localStorage 'stepopt-prefs') and are applied as CSS custom
 * properties on <html>, which override the defaults in the stylesheet's :root. This file is loaded in the head so the
 * choice is in place before the first paint (no flash of the default look). Settings › Appearance calls apply() again
 * after every change. A value equal to the default removes its property, so the stylesheet stays the one source of
 * the defaults. */
(function () {
  'use strict';
  var KEY = 'stepopt-prefs';
  var root = document.documentElement;

  var DEFAULTS = { uiAccent: '#0d99ff', uiTone: 'graphite', uiFont: 'inter', uiTextScale: 1, uiDensity: 1, uiRadius: 'default', uiMotion: true, uiTreeColors: false };

  // Colours that hold white text. (A lighter custom colour gets dark text: see onAccent.)
  var ACCENTS = [
    ['Blue', '#0d99ff'], ['Indigo', '#6f7cff'], ['Violet', '#9a6bff'], ['Pink', '#ec5b98'], ['Red', '#f0504f'],
    ['Orange', '#ee7d22'], ['Green', '#22a876'], ['Teal', '#12a6b3'], ['Graphite', '#7a8496']
  ];
  // Surfaces: the ramp the whole interface is built from.
  var TONES = {
    graphite: { label: 'Graphite', '--bg': '#101010', '--bg1': '#141414', '--bg2': '#1c1c1c', '--bg3': '#252525', '--bg4': '#2f2f2f', '--bd': '#2c2c2c', '--bd2': '#444444', '--surface-pop': '#161616', '--bg-checker': '#181818', '--surface-bar': 'rgba(16,16,16,.94)', '--glass-strong': 'rgba(20,20,20,.92)' },
    midnight: { label: 'Midnight', '--bg': '#0e1116', '--bg1': '#12151b', '--bg2': '#191d25', '--bg3': '#222833', '--bg4': '#2c3441', '--bd': '#283040', '--bd2': '#41506a', '--surface-pop': '#141820', '--bg-checker': '#171b22', '--surface-bar': 'rgba(14,17,22,.94)', '--glass-strong': 'rgba(18,21,27,.92)' },
    warm:     { label: 'Warm',     '--bg': '#121110', '--bg1': '#171514', '--bg2': '#1f1c1a', '--bg3': '#292623', '--bg4': '#35312d', '--bd': '#332f2a', '--bd2': '#4d4740', '--surface-pop': '#181615', '--bg-checker': '#1a1816', '--surface-bar': 'rgba(18,17,16,.94)', '--glass-strong': 'rgba(23,21,20,.92)' },
    black:    { label: 'Black',    '--bg': '#000000', '--bg1': '#060606', '--bg2': '#0e0e0e', '--bg3': '#171717', '--bg4': '#212121', '--bd': '#1f1f1f', '--bd2': '#3a3a3a', '--surface-pop': '#0a0a0a', '--bg-checker': '#0c0c0c', '--surface-bar': 'rgba(0,0,0,.94)', '--glass-strong': 'rgba(6,6,6,.92)' }
  };
  var FONTS = {
    inter:  { label: 'Inter',  stack: "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" },
    system: { label: 'System', stack: "system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif" },
    mono:   { label: 'Mono',   stack: "ui-monospace,'Cascadia Mono','SF Mono',Menlo,Consolas,monospace" },
    serif:  { label: 'Serif',  stack: "'Iowan Old Style','Palatino Linotype',Palatino,Georgia,serif" }
  };
  var TEXT_SCALES = [['Small', 0.92], ['Default', 1], ['Large', 1.1], ['Larger', 1.2]];
  var DENSITIES = [['Compact', 0.88], ['Default', 1], ['Roomy', 1.12]];
  var RADII = [['Sharp', 'sharp', 0.25], ['Default', 'default', 1], ['Round', 'round', 1.6]];

  // The scale tokens and their stylesheet values (px).
  var FS = { '--fs-9': 9, '--fs-10': 10, '--fs-11': 11, '--fs-12': 12, '--fs-13': 13, '--fs-2xs': 10, '--fs-xs': 11, '--fs-sm': 12, '--fs-md': 13, '--fs-lg': 13, '--fs-xl': 14, '--fs-2xl': 16, '--btn-fs-sm': 12, '--btn-fs-md': 12, '--btn-fs-lg': 13 };
  var HT = { '--btn-h-sm': 26, '--btn-h-md': 32, '--btn-h-lg': 40 };
  var RD = { '--r-2xs': 2, '--r-xs': 4, '--r-sm': 6, '--r-md': 6, '--r-lg': 10, '--r-xl': 10, '--btn-r-sm': 6, '--btn-r-md': 6, '--btn-r-lg': 6, '--surface-pop-r': 10, '--surface-win-r': 10 };
  var AC_TINTS = [4, 8, 12, 14, 15, 18, 20, 25, 35, 40, 45, 55];

  var set = function (name, value) { if (value == null) root.style.removeProperty(name); else root.style.setProperty(name, value); };

  // ── colour ──
  function hexToRgb(h) {
    h = String(h || '').replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var n = parseInt(h, 16);
    return isNaN(n) || h.length !== 6 ? null : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  var toHex = function (c) { return '#' + c.map(function (v) { return ('0' + Math.round(Math.max(0, Math.min(255, v))).toString(16)).slice(-2); }).join(''); };
  var mix = function (a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; };
  var lum = function (c) { var f = c.map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };

  function read() {
    var p = {};
    try { p = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { p = {}; }
    var out = {};
    for (var k in DEFAULTS) out[k] = p[k] === undefined ? DEFAULTS[k] : p[k];
    return out;
  }

  function applyAccent(hex) {
    var rgb = hexToRgb(hex);
    if (!rgb || String(hex).toLowerCase() === DEFAULTS.uiAccent) {
      ['--ac', '--ac-text', '--ac-hover', '--ac-active', '--ac-soft', '--ac-line', '--tx-on-accent'].forEach(function (n) { set(n, null); });
      AC_TINTS.forEach(function (t) { set('--ac-tint-' + ('0' + t).slice(-2), null); });
      return;
    }
    var black = [0, 0, 0], white = [255, 255, 255];
    set('--ac', toHex(rgb));
    set('--ac-hover', toHex(mix(rgb, black, 0.10)));
    set('--ac-active', toHex(mix(rgb, black, 0.20)));
    set('--ac-text', toHex(mix(rgb, white, 0.32)));          // the accent as text and icons on a dark surface
    var rgba = function (a) { return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + a + ')'; };
    set('--ac-soft', rgba(0.10)); set('--ac-line', rgba(0.30));
    AC_TINTS.forEach(function (t) { set('--ac-tint-' + ('0' + t).slice(-2), rgba(t / 100)); });
    set('--tx-on-accent', lum(rgb) > 0.45 ? '#14161a' : '#ffffff');   // dark text on a light accent
  }
  function applyTone(name) {
    var tone = TONES[name] || TONES.graphite;
    for (var k in TONES.graphite) if (k !== 'label') set(k, name === 'graphite' || !TONES[name] ? null : tone[k]);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', (TONES[name] || TONES.graphite)['--bg']);
  }
  function applyScale(map, factor, unit, round) {
    for (var k in map) set(k, factor === 1 ? null : (round ? Math.round(map[k] * factor) : Math.round(map[k] * factor * 100) / 100) + unit);
  }
  function apply(prefs) {
    var p = prefs || read();
    applyAccent(p.uiAccent);
    applyTone(p.uiTone);
    var font = FONTS[p.uiFont];
    set('--font-sans', !font || p.uiFont === 'inter' ? null : font.stack);
    applyScale(FS, +p.uiTextScale || 1, 'px', true);        // type sizes stay whole pixels at every text size
    applyScale(HT, +p.uiDensity || 1, 'px', true);
    var r = RADII.filter(function (x) { return x[1] === p.uiRadius; })[0] || RADII[1];
    for (var k in RD) set(k, r[2] === 1 ? null : Math.min(14, Math.round(RD[k] * r[2] * 10) / 10) + 'px');
    root.classList.toggle('no-motion', p.uiMotion === false);
    root.classList.toggle('tree-icons-coded', p.uiTreeColors === true);
  }

  window.MOAppearance = { DEFAULTS: DEFAULTS, ACCENTS: ACCENTS, TONES: TONES, FONTS: FONTS, TEXT_SCALES: TEXT_SCALES, DENSITIES: DENSITIES, RADII: RADII, read: read, apply: apply };
  try { apply(); } catch (e) { /* the default look stays */ }
})();
