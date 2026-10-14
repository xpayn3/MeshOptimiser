/* ===================================================================
   lite-shim.js — loaded first by the hosted demo (apps/meshoptimiser/lite/).

   The app is a web page that talks to a small local server for three
   things: a heartbeat, STEP conversion, and the inbox/ folder. On the site
   there is no server, so this file answers those requests itself:
     - /api/alive         404, so the app leaves the heartbeat alone
     - /api/convert       501 with a plain explanation of what Web opens
     - /api/job, cancel   404
   and adds the sample models (Khronos's glTF-Sample-Models, inbox/) as tiles on the
   app's own start screen, which is what opens first. The Web mark beside the logo opens
   a page that explains this version. Nothing is uploaded: the files stay in the page.
   =================================================================== */
(function () {
  'use strict';
  window.__MESHOPT_DEMO = true;

  var STEP_NOTE = 'STEP files are read by the full app, which runs on your computer. The online version opens GLB, glTF, FBX, OBJ, 3MF and STL files, and the sample model.';
  var json = function (status, body) { return new Response(JSON.stringify(body), { status: status, headers: { 'Content-Type': 'application/json' } }); };

  var SAMPLES = [
    ['GearboxAssy', 'Gearbox assembly'],
    ['2CylinderEngine', 'Two-cylinder engine'],
    ['ReciprocatingSaw', 'Reciprocating saw']
  ];

  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    try {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var path = new URL(url, location.href).pathname;
      if (/\/api\/convert$/.test(path)) return Promise.resolve(json(501, { error: STEP_NOTE }));
      if (/\/api\/(alive|job\/|cancel\/|quit)/.test(path)) return Promise.resolve(json(404, { error: 'online' }));
    } catch (_) { /* fall through to the real fetch */ }
    return realFetch(input, init);
  };

  var top = window.top === window;

  if (!top) return;

  // the welcome: what the Web version is, what it leaves out, what the installed app adds. It opens from the Web mark beside the logo, top left.
  var W_ICON = {
    try: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 16l.7 1.8L21.5 18.5l-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z"/></svg>',
    out: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>',
    pc: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
    tick: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    dash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 12h12"/></svg>',
    arrow: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'
  };
  var WELCOME_STATS = [
    ['−50%', 'triangles in one press of Smart optimise'],
    ['−79%', 'file size with Meshopt, on the gearbox'],
    ['0', 'uploads. Everything stays in this page']
  ];
  var WELCOME = [
    ['try', 'Try it here', [
      'Open GLB, glTF, FBX, OBJ, 3MF and STL files, or one of three sample models.',
      'Smart optimise, Decimate, Remove holes, Fasteners, Hidden parts and Smart fit.',
      'Edit mesh, Draw and Sweep, and the library of 112 parts.',
      'Exploded view, measuring, search, and export.'
    ]],
    ['out', 'Left out of the online version', [
      'STEP, IGES and BREP files. The CAD reader runs on your computer.',
      'Folder and command-line conversion.',
      'The Claude connection.',
      'Updates inside the app.'
    ]],
    ['pc', 'On your PC you also get', [
      'Full CAD conversion, with names, colours and part numbers kept and repeats stored once.',
      'Whole folders in one go, with size and detail targets.',
      'Claude doing the clean-up for you, with 65 tools.',
      'Updates in the app, and the old version kept.',
      'Free, open source, works offline. Windows and macOS.'
    ]]
  ];

  function showWelcome() {
    if (document.getElementById('meshopt-demo-welcome')) return;
    var calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var ease = 'cubic-bezier(.2,.8,.2,1)';
    var wrap = document.createElement('div');
    wrap.id = 'meshopt-demo-welcome';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-labelledby', 'meshopt-demo-welcome-title');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483100;display:grid;place-items:center;padding:20px;background:rgba(9,9,10,.8);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);opacity:0;transition:opacity .35s ease;font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;-webkit-font-smoothing:antialiased;';
    var mono = 'ui-monospace,Menlo,Consolas,monospace';
    var stats = WELCOME_STATS.map(function (s) {
      return '<div data-rise style="min-width:0;padding-top:16px;border-top:1px solid rgba(255,255,255,.14)">' +
        '<b style="display:block;font:400 clamp(34px,4.4vw,52px)/1 Inter,system-ui,sans-serif;letter-spacing:-.04em;color:#0d99ff">' + s[0] + '</b>' +
        '<span style="display:block;margin-top:10px;font-size:13px;line-height:1.4;color:#a3a3a8">' + s[1] + '</span></div>';
    }).join('');
    var cols = WELCOME.map(function (c, i) {
      var pc = c[0] === 'pc', out = c[0] === 'out';
      var mark = out ? W_ICON.dash : W_ICON.tick;
      var markCol = out ? '#6e6e72' : (pc ? '#3aadff' : '#8a8a8f');
      return '<section data-rise style="min-width:0;box-sizing:border-box;padding:22px 22px 24px;border-radius:14px;' +
        (pc ? 'background:#1d1d20;box-shadow:inset 0 0 0 1px rgba(13,153,255,.38)' : 'background:transparent;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)') + '">' +
        '<h3 style="display:flex;align-items:center;gap:10px;margin:0 0 18px;font:400 11px/1 ' + mono + ';letter-spacing:.1em;text-transform:uppercase;color:' + (pc ? '#3aadff' : '#8a8a8f') + '">' + W_ICON[c[0]] + c[1] + '</h3>' +
        '<ul style="margin:0;padding:0;list-style:none;display:grid;gap:13px">' +
        c[2].map(function (t) {
          return '<li style="display:grid;grid-template-columns:14px minmax(0,1fr);gap:11px;align-items:start;font-size:14px;line-height:1.45;color:' + (out ? '#a3a3a8' : '#e6e6e8') + '"><span style="margin-top:3px;color:' + markCol + ';display:inline-flex">' + mark + '</span><span>' + t + '</span></li>';
        }).join('') + '</ul></section>';
    }).join('');
    wrap.innerHTML =
      '<div data-card style="width:min(1040px,100%);max-height:100%;overflow:auto;box-sizing:border-box;padding:clamp(24px,4vw,52px);border-radius:20px;background:#161617;box-shadow:0 40px 120px rgba(0,0,0,.7),0 12px 32px rgba(0,0,0,.4),0 0 0 1px rgba(255,255,255,.09);color:#e6e6e8">' +
        '<div data-rise style="display:inline-flex;align-items:center;gap:10px;height:26px;padding:0 12px;border-radius:999px;background:rgba(13,153,255,.12);box-shadow:inset 0 0 0 1px rgba(13,153,255,.35);color:#3aadff;font:400 11px/1 ' + mono + ';letter-spacing:.1em;text-transform:uppercase"><i style="width:6px;height:6px;border-radius:50%;background:#0d99ff;display:block"></i>Web version</div>' +
        '<h2 id="meshopt-demo-welcome-title" data-rise style="margin:22px 0 0;max-width:18ch;font:500 clamp(30px,4.6vw,52px)/1.04 Inter,system-ui,sans-serif;letter-spacing:-.03em">Heavy CAD, light enough for your browser.</h2>' +
        '<p data-rise style="margin:18px 0 0;max-width:56ch;font-size:16px;line-height:1.55;color:#a3a3a8">This is the real app, running right here. Open a model, press a button, watch the triangles fall. Your files never leave this page.</p>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:24px;margin-top:34px">' + stats + '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px;margin-top:34px">' + cols + '</div>' +
        '<div data-rise style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:34px"><span style="font:400 11px/1 ' + mono + ';letter-spacing:.1em;text-transform:uppercase;color:#8a8a8f;margin-right:4px">Open a sample</span>' + SAMPLES.map(function (m) {
          return '<button type="button" data-sample="' + m[0] + '" style="all:unset;cursor:pointer;box-sizing:border-box;height:32px;padding:0 14px;display:inline-flex;align-items:center;border-radius:8px;background:#212123;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08);color:#e6e6e8;font:400 13px/1 Inter,system-ui,sans-serif">' + m[1] + '</button>';
        }).join('') + '</div>' +
        '<div data-rise style="display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-top:34px">' +
          '<button type="button" data-go style="all:unset;cursor:pointer;box-sizing:border-box;display:inline-flex;align-items:center;gap:10px;height:46px;padding:0 22px;border-radius:10px;background:#0d99ff;color:#fff;font:500 15px/1 Inter,system-ui,sans-serif">Start exploring' + W_ICON.arrow + '</button>' +
          '<a href="../download.html" style="display:inline-flex;align-items:center;height:46px;padding:0 20px;border-radius:10px;background:#212123;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08);color:#e6e6e8;font:500 15px/1 Inter,system-ui,sans-serif;text-decoration:none">Download the app</a>' +
          '<span style="margin-left:auto;font-size:12px;color:#6e6e72">Esc to close. Reopen it from the Web tag.</span>' +
        '</div>' +
      '</div>';
    var prev = document.activeElement;
    function close() {
      document.removeEventListener('keydown', onKey, true);
      wrap.style.opacity = '0';
      setTimeout(function () { wrap.remove(); }, calm ? 0 : 300);
      try { if (prev && prev.focus) prev.focus(); } catch (_) {}
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); }
      else if (e.key === 'Tab') {
        var f = wrap.querySelectorAll('button,a[href]');
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    wrap.addEventListener('mousedown', function (e) { if (e.target === wrap) close(); });
    wrap.querySelector('[data-go]').addEventListener('click', close);
    Array.prototype.forEach.call(wrap.querySelectorAll('[data-sample]'), function (b) {
      b.addEventListener('click', function () {
        var p = new URLSearchParams(location.search);
        p.set('file', 'inbox/' + b.getAttribute('data-sample') + '.glb');
        location.search = p.toString();
      });
    });
    document.addEventListener('keydown', onKey, true);
    // everything rises into place, one after another
    var card = wrap.querySelector('[data-card]');
    var rise = wrap.querySelectorAll('[data-rise]');
    if (!calm) {
      card.style.opacity = '0'; card.style.transform = 'translateY(18px) scale(.985)';
      card.style.transition = 'opacity .5s ' + ease + ',transform .6s ' + ease;
      Array.prototype.forEach.call(rise, function (el, i) {
        el.style.opacity = '0'; el.style.transform = 'translateY(10px)';
        el.style.transition = 'opacity .5s ' + ease + ' ' + (120 + i * 55) + 'ms,transform .6s ' + ease + ' ' + (120 + i * 55) + 'ms';
      });
    } else { wrap.style.transition = 'none'; }
    document.body.appendChild(wrap);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        wrap.style.opacity = '1';
        card.style.opacity = '1'; card.style.transform = 'none';
        Array.prototype.forEach.call(rise, function (el) { el.style.opacity = '1'; el.style.transform = 'none'; });
        wrap.querySelector('[data-go]').focus();
      });
    });
  }

  // a small "Web" mark beside the logo; it opens the welcome that explains this version
  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('btn-brand');
    if (!btn) return;
    var tag = document.createElement('button');
    tag.type = 'button';
    tag.textContent = 'Web';
    tag.title = 'The light version, in your browser. The full app runs on your computer.';
    tag.style.cssText = 'all:unset;cursor:pointer;align-self:center;margin-left:2px;padding:0 6px;height:16px;display:inline-flex;align-items:center;border-radius:4px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.14);color:#a8a8a8;font:400 9.5px/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.09em;text-transform:uppercase;user-select:none';
    tag.addEventListener('click', showWelcome);
    btn.parentNode.insertBefore(tag, btn.nextSibling);
  });

  // the app's own start screen gets a Library tab next to Settings: the sample models as cards with a picture, since there is no inbox/ folder to open from
  var LIBRARY = [
    ['GearboxAssy', 'Gearbox assembly', '95 parts · 646,064 triangles · 4.7 MB', 'A gearbox with shafts, gears and housings. Heavy enough to see what the tools do.'],
    ['2CylinderEngine', 'Two-cylinder engine', '115 parts · 121,496 triangles · 1.8 MB', 'Pistons, crank and cylinders.'],
    ['ReciprocatingSaw', 'Reciprocating saw', '113 parts · 198,470 triangles · 3.4 MB', 'A power tool with its motor, gears and casing.']
  ];
  document.addEventListener('DOMContentLoaded', function () {
    var nav = document.querySelector('.wl-nav'), pane = document.getElementById('welcome-pick-pane'), stage = document.getElementById('welcome-drop');
    if (!nav || !pane || !stage || document.getElementById('welcome-library')) return;
    var css = document.createElement('style');
    css.textContent =
      '#demo-library{position:relative;flex:1 1 auto;min-height:0;overflow:auto;padding:4px 24px 22px;display:none}' +
      '#demo-library.is-open{display:block}' +
      '#demo-library .dl-head{display:flex;align-items:baseline;gap:14px;margin:22px 0 16px}' +
      '#demo-library .dl-head .wl-label{margin:0}' +
      '#demo-library .dl-back{all:unset;box-sizing:border-box;cursor:pointer;font-size:var(--fs-12);color:var(--tx2);padding:4px 8px;margin-left:-8px;border-radius:var(--r-sm)}' +
      '#demo-library .dl-back:hover,#demo-library .dl-back:focus-visible{background:var(--s3);color:var(--tx)}' +
      '#demo-library .dl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}' +
      '#demo-library .dl-card{all:unset;box-sizing:border-box;display:flex;flex-direction:column;border-radius:var(--r-lg);background:var(--bg2);color:var(--tx);cursor:pointer;overflow:hidden;transition:var(--tr-bg)}' +
      '#demo-library .dl-card:hover,#demo-library .dl-card:focus-visible{background:var(--bg3)}' +
      '#demo-library .dl-pic{display:block;aspect-ratio:8/5;background:#111;overflow:hidden}' +
      '#demo-library .dl-pic img{display:block;width:100%;height:100%;object-fit:cover}' +
      '#demo-library .dl-txt{display:flex;flex-direction:column;gap:3px;padding:12px 14px 14px}' +
      '#demo-library .dl-t{font-size:var(--fs-13)}' +
      '#demo-library .dl-s{font-size:var(--fs-sm);color:var(--tx3)}' +
      '#demo-library .dl-d{font-size:var(--fs-sm);color:var(--tx2);margin-top:4px}';
    document.head.appendChild(css);

    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'wl-link'; btn.id = 'welcome-library';
    btn.title = 'Sample models to try the tools on';
    btn.textContent = 'Library';
    var settings = document.getElementById('welcome-settings');
    nav.insertBefore(btn, settings ? settings.nextSibling : null);

    var panel = document.createElement('div');
    panel.id = 'demo-library';
    panel.innerHTML =
      '<div class="dl-head"><button type="button" class="dl-back" data-back>← Start</button><div class="wl-label">Library</div></div>' +
      '<div class="dl-grid">' + LIBRARY.map(function (m) {
        return '<button type="button" class="dl-card" data-sample="' + m[0] + '"><span class="dl-pic"><img src="previews/' + m[0] + '.webp" alt="" width="720" height="450" decoding="async"></span>' +
          '<span class="dl-txt"><span class="dl-t">' + m[1] + '</span><span class="dl-s">' + m[2] + '</span><span class="dl-d">' + m[3] + '</span></span></button>';
      }).join('') + '</div>';
    stage.parentNode.insertBefore(panel, stage.nextSibling);

    function show(on) {
      panel.classList.toggle('is-open', on);
      stage.style.display = on ? 'none' : '';
      btn.style.background = on ? 'var(--s3)' : ''; btn.style.color = on ? 'var(--tx)' : '';
      var foot = pane.querySelector('.wl-foot'); if (foot) foot.style.display = on ? 'none' : '';
    }
    btn.addEventListener('click', function () { show(!panel.classList.contains('is-open')); });
    panel.querySelector('[data-back]').addEventListener('click', function () { show(false); });
    Array.prototype.forEach.call(panel.querySelectorAll('[data-sample]'), function (c) {
      c.addEventListener('click', function () { location.href = location.pathname + '?file=inbox/' + c.getAttribute('data-sample') + '.glb'; });
    });
    // whenever the start screen opens again it opens on Start
    var modal = document.getElementById('welcome-modal');
    if (modal && window.MutationObserver) new MutationObserver(function () { if (!modal.classList.contains('open') && !modal.classList.contains('show') && !modal.classList.contains('is-open')) show(false); }).observe(modal, { attributes: true, attributeFilter: ['class'] });
  });

  // what the online version leaves out stays visible in Settings, greyed out
  var GREYED = [['Claude', 'sparkles'], ['Updates', 'refresh-cw']];
  function greyOut() {
    var nav = document.getElementById('set-nav');
    if (!nav || nav.querySelector('[data-lite-off]')) return;
    var before = nav.querySelector('[data-pane="data"]');
    if (!before) return;
    GREYED.forEach(function (g) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'set-nav-item';
      b.setAttribute('data-lite-off', '');
      b.setAttribute('aria-disabled', 'true');
      b.title = 'In the full app, which runs on your computer.';
      b.style.cssText = 'opacity:.38;cursor:not-allowed';
      b.innerHTML = '<i data-lucide="' + g[1] + '"></i><span>' + g[0] + '</span><span class="set-nav-state" style="font-size:10px;letter-spacing:.06em;text-transform:uppercase">Full app</span>';
      b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); });
      nav.insertBefore(b, before);
    });
    try { if (window.lucide && lucide.createIcons) lucide.createIcons(); } catch (_) {}
  }
  document.addEventListener('DOMContentLoaded', function () {
    new MutationObserver(greyOut).observe(document.body, { childList: true, subtree: true });
  });

  // the start screen's list of formats: the CAD ones belong to the full app
  document.addEventListener('DOMContentLoaded', function () {
    var el = Array.prototype.find.call(document.querySelectorAll('span'), function (n) { return /^Opens STEP · IGES · BREP · /.test(n.textContent); });
    if (!el) return;
    var rest = el.textContent.replace('Opens STEP · IGES · BREP · ', '');
    el.innerHTML = 'Opens <span style="opacity:.38;cursor:not-allowed" title="CAD files are read by the full app, which runs on your computer.">STEP · IGES · BREP</span> · ' + rest;
  });
})();
