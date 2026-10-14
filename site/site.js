// ========== MESHOPTIMISER SITE ==========
// The few things the app's site (apps/meshoptimiser/*.html) does beyond
// being read: the menu on a phone, the paged strip of screenshots,
// pictures that open full size, clips that play while they are on screen,
// commands that copy, the search of the docs, and the Quick wand demo. Look: site.css.
// Nothing here runs while the page is idle.
(function () {
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];
  const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text) node.textContent = text; return node; };
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const mouse = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  // ---- the menu on a phone ----
  const menu = $('#menu'), nav = $('#nav');
  if (menu && nav) {
    const set = (open) => { nav.classList.toggle('is-open', open); menu.setAttribute('aria-expanded', String(open)); document.documentElement.classList.toggle('nav-open', open); };
    menu.addEventListener('click', () => set(!nav.classList.contains('is-open')));
    nav.addEventListener('click', (e) => { if (e.target.closest('a')) set(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && nav.classList.contains('is-open')) { set(false); menu.focus(); } });
    document.addEventListener('click', (e) => { if (nav.classList.contains('is-open') && !e.target.closest('#bar')) set(false); });
    const wide = window.matchMedia('(min-width: 761px)');
    const onWide = (e) => { if (e.matches) set(false); };
    if (wide.addEventListener) wide.addEventListener('change', onWide); else wide.addListener(onWide);
  }

  // ---- the bar: a hairline appears once the page has moved ----
  const bar = $('#bar');
  if (bar) {
    let tick = false;
    const mark = () => { tick = false; bar.classList.toggle('is-scrolled', window.scrollY > 6); };
    window.addEventListener('scroll', () => { if (!tick) { tick = true; requestAnimationFrame(mark); } }, { passive: true });
    mark();
  }

  // ---- the strip of screenshots: paged ----
  // Wherever it is let go it settles with one picture in the middle (the
  // first and the last rest against its ends), and a flick takes it on to
  // the next. Touch and trackpads get this from scroll snapping; a mouse
  // drag is settled here, with snapping off (.is-free) while it has the strip.
  const restOf = (strip, fig) => {
    const max = strip.scrollWidth - strip.clientWidth;
    const middle = fig.offsetLeft - strip.offsetLeft + fig.offsetWidth / 2 - strip.clientWidth / 2;
    return Math.max(0, Math.min(max, middle));
  };
  // the feature cards: the arrows move one card; an arrow is off at its end
  $$('[data-fcar]').forEach((car) => {
    const track = car.querySelector('.fcar-track'), prev = car.querySelector('[data-dir="-1"]'), next = car.querySelector('[data-dir="1"]');
    const sync = () => { prev.disabled = track.scrollLeft < 4; next.disabled = track.scrollLeft > track.scrollWidth - track.clientWidth - 4; };
    car.querySelectorAll('[data-dir]').forEach(b => b.addEventListener('click', () => {
      const card = track.firstElementChild;
      track.scrollBy({ left: Number(b.dataset.dir) * (card.offsetWidth + 16), behavior: 'smooth' });
    }));
    // a mouse can grab the row and drag it. Snapping is off for the whole gesture; on release the row glides, with the speed of the throw, to the nearest card, and snapping comes back only when it has landed
    let down = false, moved = false, startX = 0, startLeft = 0, lastX = 0, lastT = 0, speed = 0, glide = 0;
    const stop = () => { cancelAnimationFrame(glide); glide = 0; };
    track.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      stop(); down = true; moved = false; startX = lastX = e.clientX; startLeft = track.scrollLeft; lastT = performance.now(); speed = 0;
      track.classList.add('is-drag');
    });
    window.addEventListener('pointermove', (e) => {
      if (!down) return;
      const now = performance.now(), dx = e.clientX - startX;
      if (!moved && Math.abs(dx) > 4) moved = true;
      if (!moved) return;
      const dt = Math.max(1, now - lastT);
      speed = speed * 0.6 + ((lastX - e.clientX) / dt) * 0.4;
      lastX = e.clientX; lastT = now;
      track.scrollLeft = startLeft - dx;
    });
    const release = () => {
      if (!down) return;
      down = false;
      if (!moved) { track.classList.remove('is-drag'); return; }
      const step = track.firstElementChild.offsetWidth + 16, max = track.scrollWidth - track.clientWidth;
      const from = track.scrollLeft, throwTo = from + (performance.now() - lastT < 80 ? speed * 220 : 0);
      const to = Math.max(0, Math.min(max, Math.round(throwTo / step) * step)), t0 = performance.now(), dur = 380 + Math.min(260, Math.abs(to - from) * 0.25);
      const tick = (now) => {
        const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
        track.scrollLeft = from + (to - from) * e;
        if (k < 1) glide = requestAnimationFrame(tick);
        else { glide = 0; track.classList.remove('is-drag'); }
      };
      glide = requestAnimationFrame(tick);
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    track.addEventListener('wheel', stop, { passive: true });
    track.addEventListener('click', (e) => { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } }, true);
    track.addEventListener('dragstart', (e) => e.preventDefault());
    track.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    sync();
  });
  $$('[data-strip]').forEach((strip) => {
    const figs = [...strip.children];
    // the resting places are measured once (reading offsets on every scroll event forces a layout each time) and again when the size changes
    let measured = null;
    const rests = () => measured || (measured = figs.map(fig => restOf(strip, fig)));
    window.addEventListener('resize', () => { measured = null; });
    strip.addEventListener('load', () => { measured = null; }, true);
    const nearest = (list, x) => list.reduce((at, rest, i) => (Math.abs(rest - x) < Math.abs(list[at] - x) ? i : at), 0);

    // the dots under it: one per picture, the lit one is the picture in the middle
    const row = strip.nextElementSibling && strip.nextElementSibling.classList.contains('dots') ? strip.nextElementSibling : null;
    if (row) {
      const marks = figs.map(() => row.appendChild(el('i')));
      let lit = -1, queued = false;
      const sync = () => { queued = false; const now = nearest(rests(), strip.scrollLeft); if (now === lit) return; lit = now; marks.forEach((mark, i) => mark.classList.toggle('is-active', i === now)); };
      strip.addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(sync); } }, { passive: true });
      sync();
    }

    let startX = 0, startLeft = 0, lastX = 0, lastT = 0, speed = 0, held = false, moved = false, glide = 0, gliding = false;
    const settle = () => {
      const list = rests(), from = strip.scrollLeft;
      let at = nearest(list, from);
      const dir = speed < -2 ? 1 : speed > 2 ? -1 : 0;      // the strip moves against the mouse
      if (dir && (list[at] - from) * dir <= 0) at = Math.max(0, Math.min(list.length - 1, at + dir));
      const to = list[at];
      const done = () => { strip.scrollLeft = to; gliding = false; strip.classList.remove('is-free'); };
      if (Math.abs(to - from) < 1 || calm) return done();
      const t0 = performance.now(), time = Math.min(520, 260 + Math.abs(to - from) * 0.4);
      gliding = true;
      const step = (now) => {
        const t = Math.min(1, (now - t0) / time);
        strip.scrollLeft = from + (to - from) * (1 - Math.pow(1 - t, 3));
        if (t < 1) glide = requestAnimationFrame(step); else done();
      };
      glide = requestAnimationFrame(step);
    };
    strip.addEventListener('pointerdown', (e) => {
      delete strip.dataset.dragged;
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      cancelAnimationFrame(glide);
      held = true; moved = false;
      startX = lastX = e.clientX; lastT = e.timeStamp; startLeft = strip.scrollLeft; speed = 0;
    });
    window.addEventListener('pointermove', (e) => {
      if (!held) return;
      const dx = e.clientX - startX;
      if (!moved && Math.abs(dx) < 4) return;
      if (!moved) { moved = true; strip.classList.add('is-held', 'is-free'); strip.dataset.dragged = '1'; }
      const dt = Math.max(1, e.timeStamp - lastT);
      speed = 0.7 * speed + 0.3 * ((e.clientX - lastX) / dt * 16);
      lastX = e.clientX; lastT = e.timeStamp;
      strip.scrollLeft = startLeft - dx;
    });
    const release = (e) => {
      if (!held) return;
      held = false;
      strip.classList.remove('is-held');
      if (e.timeStamp - lastT > 80) speed = 0;
      if (moved || gliding) settle();
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    strip.addEventListener('dragstart', e => e.preventDefault());
    // a press that became a drag is not a click on the picture under it
    strip.addEventListener('click', (e) => { if (strip.dataset.dragged) { e.preventDefault(); e.stopPropagation(); } }, true);
  });

  // ---- pictures that open full size ----
  // Every a.zoom is a link to its picture, so it works without this script. With it the picture opens in the same viewer as on
  // lukagrcar.com (/overlay.js and /overlay.css: thumbnail strip, swipe, pinch and double-tap zoom, room round the picture). It is
  // loaded the first time a picture is clicked, so a visit that never opens one does not pay for it.
  const zooms = $$('a.zoom');
  if (zooms.length) {
    // (the same files and versions as lab.html: the viewer needs the project template before it starts, one after the other)
    // (on lukagrcar.com they are at the root; the standalone copy carries its own in viewer/, named by data-viewer on this script)
    const base = (document.currentScript && document.currentScript.dataset.viewer) || '/';
    const VIEWER = { css: base + 'overlay.css?v=38', js: [base + 'project-template.js?v=4', base + 'overlay.js?v=48'] };
    let viewer = null;
    const loadScript = (src) => new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src; el.onload = () => resolve(); el.onerror = () => reject(new Error(src));
      document.head.append(el);
    });
    const loadViewer = () => viewer || (viewer = (() => {
      if (!window.projects) window.projects = {};                       // (the viewer is written for the portfolio's project list; here there is none)
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = VIEWER.css;
      document.head.append(css);
      return VIEWER.js.reduce((p, src) => p.then(() => loadScript(src)), Promise.resolve()).catch((err) => { viewer = null; throw err; });
    })());
    const open = (link) => loadViewer().then(() => {
      const set = zooms.filter(z => z.dataset.group === link.dataset.group);
      window.setLightboxItems(set.map(z => z.href), false);              // false: not the Lab (no file details or histogram)
      window.openLightbox(Math.max(0, set.indexOf(link)));
    }).catch(() => { window.location.href = link.href; });              // no viewer: the picture itself, as the link says
    zooms.forEach(link => link.addEventListener('click', (e) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
      e.preventDefault();
      open(link);
    }));
    // a hint of what is coming: start fetching the viewer when a picture is first pointed at
    const warm = () => { loadViewer().catch(() => {}); zooms.forEach(z => { z.removeEventListener('pointerenter', warm); z.removeEventListener('touchstart', warm); }); };
    zooms.forEach(z => { z.addEventListener('pointerenter', warm, { once: true }); z.addEventListener('touchstart', warm, { once: true, passive: true }); });
  }

  // ---- the opening: the part steps out of the window ----
  // The scroll through .pop sets --p (0 to 1); the styles do the rest. The
  // listener exists only while the section is on screen, and only one frame
  // is scheduled per scroll event, so nothing runs while the page is still.
  // the part beside the example session on claude.html (chat3d.js): a real mesh, on a wide screen with motion allowed
  const cx3d = $('[data-cx3d]');
  if (cx3d && window.matchMedia('(min-width: 1000px) and (hover: hover)').matches && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const when = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      when.disconnect();
      import('./chat3d.js?v=4').then((m) => m.start(cx3d, '')).catch(() => {});
    }, { rootMargin: '600px 0px' });
    when.observe(cx3d.closest('[data-cx-grid]') || cx3d);
  }

  // the live models of the features page (features3d.js): a real mesh, loaded when the section is near, on a wide screen with a mouse and with
  // motion allowed; elsewhere (a phone, Data Saver, no WebGL2, reduced motion) the picture in the page stays and nothing is fetched
  const lives = $$('[data-live]');
  if (lives.length && 'IntersectionObserver' in window && window.matchMedia('(min-width: 1000px) and (hover: hover)').matches && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    let webgl = false;
    try { webgl = !!document.createElement('canvas').getContext('webgl2'); } catch (e) { webgl = false; }
    const net = navigator.connection;
    if (webgl && !(net && (net.saveData || /(^|-)2g$/.test(net.effectiveType || '')))) {
      const near = new IntersectionObserver((entries) => {
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          near.unobserve(en.target);
          import('./features3d.js?v=7').then((m) => m.start(en.target, '')).catch(() => {});
        }
      }, { rootMargin: '500px 0px' });
      lives.forEach((el) => near.observe(el));
    }
  }

  const pop = $('[data-pop]');
  if (pop && !calm && 'IntersectionObserver' in window) {
    let queued = false, last = -1, hero3d = null, asked = false;
    // the real mesh (hero3d.js): fetched once the section is near, and only where WebGL works
    const wakeMesh = () => {
      if (asked) return;
      asked = true;
      try { const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl'); if (!gl) return; } catch (e) { return; }
      // Data Saver, or a slow connection: the poster stays, and nothing of the 3D (the library, 1.3 MB of model) is fetched
      const net = navigator.connection;
      if (net && (net.saveData || /(^|-)2g$/.test(net.effectiveType || ''))) return;
      const load = () => import('./hero3d.js?v=26').then(m => m.start(pop, '')).then((h) => { hero3d = h; h.setP(Math.max(0, last)); }).catch(() => {});
      // on a phone it waits for the first touch or scroll, so a visit that goes no further costs nothing but the poster
      if (window.matchMedia('(pointer: coarse)').matches) { let done = false; const go = () => { if (done) return; done = true; window.removeEventListener('scroll', go); window.removeEventListener('touchstart', go); load(); }; window.addEventListener('scroll', go, { passive: true }); window.addEventListener('touchstart', go, { passive: true }); }
      else load();
    };
    // with a mouse the model is fetched as soon as the page is idle, not when the section comes near: a quick scroll down then finds it ready
    // (a phone still waits for its first touch or scroll, see wakeMesh)
    if (!window.matchMedia('(pointer: coarse)').matches) (window.requestIdleCallback || ((fn) => setTimeout(fn, 600)))(wakeMesh, { timeout: 2500 });
    pop.classList.add('is-armed');                       // (the graph's bars start empty and grow in when the section comes into view)
    const cards = $$('.pop-parts li', pop); let lit = -2;
    const pct = $('[data-pop-pct]', pop);
    const place = () => {
      queued = false;
      const rect = pop.getBoundingClientRect();
      const room = rect.height - ($('.pop-pin', pop).offsetHeight || window.innerHeight);
      const p = Math.max(0, Math.min(1, room > 0 ? -rect.top / room : 0));
      const eased = p * p * (3 - 2 * p);
      if (Math.abs(eased - last) > 0.0005) {
        last = eased; pop.style.setProperty('--p', eased.toFixed(4)); if (hero3d) hero3d.setP(eased);
        if (pct) pct.textContent = String(Math.round(eased * 165));
        // the part card the scroll is on lights up, and moves down the list as the model pulls apart
        if (cards.length) { const cur = Math.max(-1, Math.min(cards.length - 1, Math.floor((eased - 0.16) / 0.075))); if (cur !== lit) { lit = cur; cards.forEach((c, k) => c.classList.toggle('is-cur', k === cur && k > 0)); } }
      }
    };
    const onScroll = () => { if (!queued) { queued = true; requestAnimationFrame(place); } };
    new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { pop.classList.add('is-in'); wakeMesh(); window.addEventListener('scroll', onScroll, { passive: true }); window.addEventListener('resize', onScroll); onScroll(); }
      else { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); }
    }, { rootMargin: '200px 0px' }).observe(pop);
  }

  // the glow of the Download button in the top bar is on only at the top of the page (see .is-scrolled in site.css)
  {
    const root = document.documentElement;
    const mark = () => root.classList.toggle('is-scrolled', window.scrollY > 24);
    window.addEventListener('scroll', mark, { passive: true });
    mark();
  }

  // ---- the Quick remesh picture tips up out of the page as it scrolls in (like a tvOS cover), ----
  const rm = $('.rm-shot');
  if (rm && !calm && 'IntersectionObserver' in window) {
    let queued = false;
    const tilt = () => {
      queued = false;
      const r = rm.getBoundingClientRect(), vh = window.innerHeight;
      const mid = (vh - r.height) / 2;   // flat when the picture is centred, tilted while it comes up from the bottom edge
      const t = Math.max(0, Math.min(1, (vh - r.top) / Math.max(1, vh - mid)));
      const e = 1 - Math.pow(1 - t, 3);
      rm.style.setProperty('--t', e.toFixed(4));
    };
    const onScroll = () => { if (!queued) { queued = true; requestAnimationFrame(tilt); } };
    rm.classList.add('is-tilt');
    tilt();
    new IntersectionObserver(([en]) => {
      if (en.isIntersecting) { window.addEventListener('scroll', onScroll, { passive: true }); window.addEventListener('resize', onScroll); onScroll(); }
      else { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); }
    }, { rootMargin: '100px 0px' }).observe(rm);
  }

  // ---- things that arrive as they come into view ----
  const reveal = $$('[data-reveal]');
  if (reveal.length && !calm && 'IntersectionObserver' in window) {
    document.documentElement.classList.add('has-reveal');
    const seen = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (entry.isIntersecting) { entry.target.classList.add('is-in'); seen.unobserve(entry.target); }
    }), { threshold: 0.15, rootMargin: '0px 0px -6% 0px' });
    reveal.forEach(node => seen.observe(node));
  }

  // ---- the design band: the app's own parts on a stage ----
  // ui-parts.json holds each part's markup and ui.css the app's own rules for
  // them. Every part gets a shadow root, so its ids and selectors work as they
  // do in the app without touching the page. The stage is scaled to fit; the
  // pointer moves the parts a little by depth (only while it moves).
  $$('[data-appui]').forEach((stageEl) => {
    const stage = $('.appui-stage', stageEl);
    const fit = () => stageEl.style.setProperty('--k', String(stageEl.clientWidth / 1240));
    fit();
    if ('ResizeObserver' in window) new ResizeObserver(fit).observe(stageEl); else window.addEventListener('resize', fit);

    let loaded = false;
    const load = async () => {
      if (loaded) return; loaded = true;
      let parts, css;
      try {
        [parts, css] = await Promise.all([fetch('ui-parts.json?v=7').then(r => r.json()), fetch('ui.css?v=7').then(r => r.text())]);
      } catch (e) { return; }
      const sheet = new CSSStyleSheet(); sheet.replaceSync(css);
      $$('.ap', stageEl).forEach((host) => {
        const html = parts[host.dataset.part]; if (!html) return;
        const root = host.attachShadow({ mode: 'open' });
        root.adoptedStyleSheets = [sheet];
        const box = document.createElement('div'); box.innerHTML = html; root.append(...box.childNodes);
        wire(root);
        if (host.dataset.part === 'props') { const sub = $('.prop-hero-sub', root), badge = $('.prop-hero-badge', root); if (sub) sub.style.visibility = 'hidden'; if (badge) badge.style.visibility = 'hidden'; }
      });
      stageEl.classList.add('is-loaded');
    };

    // what the parts do when you use them
    const count = (el, from, to, ms, done) => {
      const t0 = performance.now(), fmt = (n) => Math.round(n).toLocaleString('en-US');
      const step = (now) => { const t = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - t, 3); el.textContent = fmt(from + (to - from) * e); if (t < 1) requestAnimationFrame(step); else if (done) done(); };
      requestAnimationFrame(step);
    };
    const reduce = (root, on) => {
      const num = $('.prop-hero-num', root); if (!num) return;
      const hero = $('.prop-hero', root), bar = $('.prop-bar-fill', root), cap = $('.prop-hero-cap span', root), per = $('.prop-hero-cap span:last-child', root), sub = $('.prop-hero-sub', root), badge = $('.prop-hero-badge', root), vals = $$('.prop-value', root);
      const from = 1103373, to = on ? 552115 : 1103373;
      if (calm) { num.textContent = to.toLocaleString('en-US'); }
      else count(num, parseFloat((num.dataset.v || String(from))), to, 900);
      num.dataset.v = String(to);
      hero.classList.toggle('is-reduced', on);
      if (bar) bar.style.width = (to / from * 100).toFixed(2) + '%';
      if (cap) cap.textContent = (to / from * 100).toFixed(1) + '% of original';
      if (per) per.textContent = '≈ ' + (on ? '13,146' : '25,660') + ' per part';
      if (vals[0]) vals[0].textContent = on ? '42' : '43';
      if (vals[1]) vals[1].textContent = on ? '365,912' : '668,150';
      if (vals[3]) vals[3].textContent = on ? '12.2 MB' : '22.6 MB';
      if (sub) sub.style.visibility = on ? '' : 'hidden';
      if (badge) badge.style.visibility = on ? '' : 'hidden';
    };
    const wire = (root) => {
      root.addEventListener('click', (e) => {
        const seg = e.target.closest('.cmd-seg > button');
        if (seg) { $$('.cmd-seg > button', seg.parentElement).forEach(b => b.classList.toggle('active', b === seg)); return; }
        const head = e.target.closest('.section-h');
        if (head && !head.closest('.section-fixed') && !head.closest('.section-cmd')) {
          const body = head.nextElementSibling; const open = head.classList.toggle('collapsed') === false;
          if (body) body.style.display = open ? '' : 'none';
          return;
        }
        const tile = e.target.closest('.lib-item'); if (tile) { $$('.lib-item', root).forEach(t => t.classList.toggle('selected', t === tile)); return; }
        const row = e.target.closest('.tree-node'); if (row) { $$('.tree-node', root).forEach(t => t.classList.toggle('selected', t === row)); return; }
        const vp = e.target.closest('.vpb'); if (vp) { vp.classList.toggle('active'); return; }
        const tab = e.target.closest('.cs-trigger, .lib-view-btn'); if (tab && tab.classList.contains('lib-view-btn')) { $$('.lib-view-btn', root).forEach(t => t.classList.toggle('active', t === tab)); return; }
        const go = e.target.closest('#btn-smart-run');
        if (go) { const host = stageEl.querySelector('.ap-props'); if (host && host.shadowRoot) { const done = go.classList.toggle('is-done'); reduce(host.shadowRoot, done); } }
      });
      root.addEventListener('input', (e) => {
        const r = e.target.closest('.scrub-range'); if (!r) return;
        const scrub = r.closest('.scrub'), val = $('.scrub-value', scrub), pct = (+r.value / +r.max * 100) + '%';
        scrub.style.setProperty('--scrub-pct', pct); if (val) val.textContent = String(Math.round(+r.value * 5));
        const label = ($('.scrub-label', scrub) || {}).textContent || '';
        if (/All axes/i.test(label)) $$('.scrub-range', root).forEach((o) => { o.value = r.value; const sc = o.closest('.scrub'); sc.style.setProperty('--scrub-pct', pct); const v = $('.scrub-value', sc); if (v) v.textContent = String(Math.round(+r.value * 5)); });
      });
      // the value shown is what the slider holds
      $$('.scrub-range', root).forEach((r) => { const v = $('.scrub-value', r.closest('.scrub')); if (v) r.value = String(Math.round((+v.textContent || 0) / 5)); });
      const vid = $('video', root); if (vid && mouse && !calm && 'IntersectionObserver' in window) {
        new IntersectionObserver(([en]) => { if (en.isIntersecting) { vid.play().catch(() => {}); } else vid.pause(); }, { threshold: 0.4 }).observe(vid);
      }
    };

    // the first time it is near: fetch, build, and let the parts arrive
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(([en], obs) => {
        if (!en.isIntersecting) return;
        obs.disconnect(); load().then(() => requestAnimationFrame(() => { stageEl.classList.add('is-in'); }));
      }, { rootMargin: '300px 0px' }).observe(stageEl);
    } else { load().then(() => stageEl.classList.add('is-in')); }

    // a little depth under the pointer
    if (mouse && !calm) {
      let queued = false, px = 0, py = 0;
      stageEl.addEventListener('pointermove', (e) => {
        const r = stageEl.getBoundingClientRect(); px = (e.clientX - r.left) / r.width * 2 - 1; py = (e.clientY - r.top) / r.height * 2 - 1;
        if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; stageEl.style.setProperty('--mx', px.toFixed(3)); stageEl.style.setProperty('--my', py.toFixed(3)); }); }
      });
      stageEl.addEventListener('pointerleave', () => { stageEl.style.setProperty('--mx', '0'); stageEl.style.setProperty('--my', '0'); });
    }
  });

  // ---- the search, working ----
  // The same shape as the app's: parts of the scene, the library, commands,
  // and a sum when what you type is one. Everything is typed words against
  // a list that came with the page; nothing leaves it.
  $$('[data-demo]').forEach((demo) => {
    const data = JSON.parse($('[data-demo-data]', demo).textContent);
    const input = $('input', demo), list = $('.pal-list', demo), out = $('.demo-out', demo);
    const icon = {
      Parts: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M12 3 4 7.5v9L12 21l8-4.500v-9L12 3Z"/><path d="m4 7.500 8 4.500 8-4.500M12 12v9"/></svg>',
      Library: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="3.500" y="13" width="7" height="7" rx="1.500"/><circle cx="7" cy="7" r="3.500"/><path d="m17 3.500 3.500 6.500h-7L17 3.500Z"/></svg>',
      Commands: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m5 8 4 4-4 4M12 17h7"/></svg>',
    };
    const verb = { Parts: 'Part', Library: 'Add', Commands: '' };
    let rows = [], at = 0;

    // "12*25.4", "2 in", "300 mm" ... one number and a unit, or arithmetic
    const sum = (text) => {
      const t = text.trim().toLowerCase().replace(/,/g, '.');
      if (!t) return null;
      const unit = t.match(/^(-?\d+(?:\.\d+)?)\s*(mm|cm|m|in|inch|inches|ft)$/);
      if (unit) {
        const n = parseFloat(unit[1]), f = { mm: 1, cm: 10, m: 1000, in: 25.4, inch: 25.4, inches: 25.4, ft: 304.8 }[unit[2]];
        const mm = n * f, show = (v) => (Math.round(v * 1000) / 1000).toString();
        return { label: `${unit[1]} ${unit[2]}`, value: `${show(mm)} mm`, copy: show(mm) };
      }
      if (/^[\d\s.+\-*/()x×÷]+$/.test(t) && /[+\-*/x×÷]/.test(t.replace(/^-/, ''))) {
        try {
          const v = Function('"use strict"; return (' + t.replace(/[x×]/g, '*').replace(/÷/g, '/') + ')')();
          if (typeof v === 'number' && isFinite(v)) { const r = (Math.round(v * 1e6) / 1e6).toString(); return { label: text.trim(), value: r, copy: r }; }
        } catch (e) { /* not a sum */ }
      }
      return null;
    };
    const mark = (name, words) => {
      const lower = name.toLowerCase(); let out = '', i = 0;
      const spans = [];
      words.forEach((w) => { const k = lower.indexOf(w); if (k >= 0) spans.push([k, k + w.length]); });
      spans.sort((a, b) => a[0] - b[0]);
      spans.forEach(([a, b]) => { if (a < i) return; out += esc(name.slice(i, a)) + '<mark>' + esc(name.slice(a, b)) + '</mark>'; i = b; });
      return out + esc(name.slice(i));
    };
    const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // With data.icons the list is the app's own: each command has its icon and the colour of its kind (the app's --cat-* colours), a shortcut
    // drawn as keys, and nothing is cut off; the list scrolls. Without it the older typed lists are shown with the plain icons above.
    const rich = !!data.icons;
    const glyph = (name, colour) => {
      const nodes = (data.icons || {})[name];
      if (!nodes) return '';
      return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="color:${colour}" aria-hidden="true">${nodes.map(([t, a]) => '<' + t + Object.entries(a).map(([k, v]) => ' ' + k + '="' + String(v).replace(/"/g, '') + '"').join('') + '/>').join('')}</svg>`;
    };
    const keys = (k) => (k ? k.split(' + ').map((x) => `<kbd>${esc(x)}</kbd>`).join('') : '');
    const find = (group, words, max) => {
      const label = (item) => (group === 'Commands' && rich ? item[0] + ' ' + item[4] + ' ' + item[5] : item[0] + ' ' + (item[2] || '')).toLowerCase();   // (a command also answers to its group and its hidden words: "toggle grid")
      let hits = data[group.toLowerCase()].filter(item => words.every(w => label(item).includes(w)));
      // nothing: forgive a slip of the keys ("fastners"), as the app's search does: each word may be a letter or two off a word of the name
      if (!hits.length && words.join('').length >= 4) {
        const off = (a, b) => { const d = Array.from({ length: b.length + 1 }, (_, j) => j); for (let i = 1; i <= a.length; i++) { let prev = d[0]; d[0] = i; for (let j = 1; j <= b.length; j++) { const keep = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = keep; } } return d[b.length]; };
        hits = data[group.toLowerCase()].filter(item => { const tokens = label(item).split(/[^a-z0-9]+/).filter(Boolean); return words.every(w => w.length >= 4 && tokens.some(t => Math.abs(t.length - w.length) <= 2 && off(w, t) <= (w.length >= 7 ? 2 : 1))); });
      }
      // names that start with what was typed come first
      hits.sort((a, b) => (b[0].toLowerCase().startsWith(words[0]) ? 1 : 0) - (a[0].toLowerCase().startsWith(words[0]) ? 1 : 0));
      return hits.slice(0, max);
    };
    const draw = () => {
      const q = input.value.trim().toLowerCase(), words = q.split(/\s+/).filter(Boolean);
      rows = [];
      let html = '';
      const s = sum(input.value);
      if (s) { html += `<li class="pal-sum" role="presentation"><span>${esc(s.label)} =</span><b>${esc(s.value)}</b></li>`; rows.push({ kind: 'sum', s }); }
      const colours = data.colours || {};
      // (as in the app, commands lead the list; with none for what was typed, the parts do)
      (rich ? ['Commands', 'Parts', 'Library'] : ['Parts', 'Library', 'Commands']).forEach((group) => {
        let title = group, hits;
        if (words.length) hits = find(group, words, rich ? (group === 'Commands' ? 90 : 24) : (group === 'Parts' ? 6 : 5));
        else if (group === 'Commands') {
          // nothing typed: what the app suggests with a model open
          const picked = rich ? (data.suggest || []).map((id) => data.commands.find((c) => c[6] === id)).filter(Boolean) : [];
          title = picked.length ? 'Suggested' : group;
          hits = picked.length ? picked : data.commands.slice(0, 5);
        } else hits = [];
        if (!hits.length) return;
        html += `<li class="pal-h" role="presentation">${title}</li>`;
        hits.forEach((item) => {
          const id = rows.length;
          rows.push({ kind: group, item });
          let ico = icon[group], right;
          if (rich) {
            if (group === 'Commands') { ico = glyph(item[3], colours[item[2]] || colours.app); right = (item[4] ? '<em class="pal-g">' + esc(item[4]) + '</em>' : '') + keys(item[1]); }
            else if (group === 'Parts') { ico = glyph('box', colours.part); right = esc(verb[group]); }
            else { ico = glyph('blocks', colours.library); right = esc(verb[group]); }
          } else right = esc(group === 'Commands' ? (item[1] || '') : verb[group]);
          html += `<li class="pal-r" role="option" data-i="${id}">${ico}<b>${mark(item[0], words)}</b><span>${right}</span></li>`;
        });
      });
      if (!rows.length) html = `<li class="pal-none" role="presentation">${q ? 'Nothing called “' + esc(input.value.trim()) + '”' : 'Type a part, a command or a sum'}</li>`;
      list.innerHTML = html;
      at = Math.min(at, Math.max(0, rows.length - 1));
      mark_on();
    };
    const mark_on = () => {
      $$('.pal-r', list).forEach((row) => row.classList.toggle('is-on', +row.dataset.i === at));
      const row = $('.pal-r.is-on', list);
      if (row) { const top = row.offsetTop, bottom = top + row.offsetHeight; if (top < list.scrollTop + 28) list.scrollTop = Math.max(0, top - 36); else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight + 6; }
    };
    const run = (i) => {
      const r = rows[i]; if (!r) return;
      if (r.kind === 'sum') {
        out.innerHTML = `Copied <b>${esc(r.s.copy)}</b>`;
        if (navigator.clipboard) navigator.clipboard.writeText(r.s.copy).catch(() => {});
      } else if (r.kind === 'Parts') out.innerHTML = `Selected <b>${esc(r.item[0])}</b> and framed it${r.item[2] ? ' · ' + esc(r.item[2]) : ''}`;
      else if (r.kind === 'Library') out.innerHTML = `Added <b>${esc(r.item[0])}</b> to the scene${r.item[2] ? ' · ' + esc(r.item[2]) : ''}`;
      else if (rich) out.innerHTML = `<b>${esc(r.item[0])}</b> runs${r.item[1] ? ' · shortcut ' + esc(r.item[1].split(' + ').join('+')) : ''}`;
      else out.innerHTML = `<b>${esc(r.item[0])}</b> opens${r.item[2] ? ': ' + esc(r.item[2]) : ' its panel'}`;
    };
    input.addEventListener('input', () => { at = 0; out.textContent = ''; draw(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); at = Math.min(rows.length - 1, at + 1); mark_on(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); at = Math.max(0, at - 1); mark_on(); }
      else if (e.key === 'Enter') { e.preventDefault(); run(at); }
      else if (e.key === 'Escape') { input.value = ''; at = 0; out.textContent = ''; draw(); }
    });
    list.addEventListener('mousemove', (e) => { const row = e.target.closest('.pal-r'); if (row && +row.dataset.i !== at) { at = +row.dataset.i; mark_on(); } });
    list.addEventListener('click', (e) => { const row = e.target.closest('.pal-r,.pal-sum'); if (!row) return; if (row.dataset.i) { at = +row.dataset.i; mark_on(); } run(row.dataset.i ? at : 0); });
    draw();

    // When the search comes into view it types for itself, to show what it does: one command, deleted, the next, and back to the first.
    // Any touch of it (a click, a key, a finger) stops it where it is; nothing runs with reduced motion or without IntersectionObserver.
    if (!calm && 'IntersectionObserver' in window) {
      // the commands worth showing, by words that find them in the app's own list, with a few playful ones (a typo it forgives, a sum, odd parts); the last is what the box held at the start
      const examples = ['hidden parts', 'fastners', '12*25.4', 'smart optimise', 'micro servo', '2 in', 'remove holes', 'circuit board', 'heatmap', 'wing nut', input.value];
      let timer = 0, stopped = false;
      const set = (text) => { input.value = text; at = 0; out.textContent = ''; draw(); };
      const stop = () => { stopped = true; clearTimeout(timer); };
      ['pointerdown', 'keydown', 'focusin', 'touchstart'].forEach((type) => demo.addEventListener(type, stop, { once: true, passive: true }));
      const wait = (ms, next) => { timer = setTimeout(() => { if (!stopped) next(); }, ms); };
      const type = (text, i, done) => { if (i > text.length) return wait(1100, done); set(text.slice(0, i)); wait(70 + Math.random() * 50, () => type(text, i + 1, done)); };
      const erase = (done) => { if (!input.value) return wait(260, done); set(input.value.slice(0, -1)); wait(34, () => erase(done)); };
      const play = (k) => { if (k >= examples.length) return; erase(() => type(examples[k], 1, () => (k === examples.length - 1 ? undefined : play(k + 1)))); };
      const seen = new IntersectionObserver((entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        seen.disconnect();
        wait(900, () => play(0));
      }, { threshold: 0.6 });
      seen.observe(demo);
    }
  });

  // ---- the Quick wand, working ----
  // The app's ring (see _Wand in its app-v2.js: the numbers, the icons and the
  // styles are the same), on three parts. It rests open in the middle of the
  // stage: point at a slice and it lights up, a slice that holds a group fans
  // its commands out, and a click runs the one you are on. Click a part first
  // and the ring changes to work on it. Hold W over the stage, or press and
  // hold, and the ring moves to the pointer as it does in the app: let go on a
  // slice to run it. Esc, any other key, the wheel or a lost focus put it back.
  $$('[data-wand]').forEach((demo) => {
    const stage = $('[data-wand-stage]', demo), out = $('[data-wand-out]', demo);
    const data = JSON.parse($('[data-wand-data]', demo).textContent), ICONS = data.icons || {};
    const parts = data.parts.map(([name, tris], i) => ({ name, orig: tris, tris, hidden: false, gone: false, on: false }));
    const fmt = (n) => n.toLocaleString('en-US');
    let K, R_IN, R_OUT, F_IN, F_OUT, DEAD, V, R_ICON; const POP = 0.075, POP2 = 0.03;
    // the ring's size follows the window when it opens (the window may still have been settling when the page started)
    const setK = () => { K = (window.innerWidth > 0 && window.innerWidth <= 760) ? 1.3 : 1.7; R_IN = 22 * K; R_OUT = 58 * K; F_IN = 64 * K; F_OUT = 94 * K; DEAD = 12 * K; V = F_OUT + 24; R_ICON = (R_IN + R_OUT) / 2; }; setK();
    let isolated = false, view = 'solid', grid = true, root = null, open = false, sticky = false, rested = false, viaPointer = false;
    let startedAt = 0, moved = false, ox = 0, oy = 0, px = 0, py = 0, lastX = 0, lastY = 0, over = false, closedAt = -1e9;
    let slots = [], slice = 90, hot = -1, sub = -1, fanFor = -1, entryD = 0, committed = false, hold = null;
    const live = () => parts.filter((p) => !p.gone), sel = () => live().filter((p) => p.on);
    const say = (text) => { out.textContent = text; };
    const names = (a) => (a.length === 1 ? a[0].name : a.length + ' parts');
    const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const ico = (name) => {
      const nodes = ICONS[name];
      return nodes ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + nodes.map(([t, a]) => '<' + t + Object.entries(a).map(([k, v]) => ' ' + k + '="' + v + '"').join('') + '/>').join('') + '</svg>' : '';
    };
    const paint = () => {
      stage.classList.toggle('v-wire', view === 'wire');
      stage.classList.toggle('v-xray', view === 'xray');
      stage.classList.toggle('no-grid', !grid);
      const one = sel().length > 0;
      $$('[data-wand-mode]', demo).forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.wandMode === 'part') === one)));
    };
    const HINT = 'Point at a slice and click a command. Click a part first, and the ring changes to work on it.';
    const reset = () => {
      parts.forEach((p) => { p.tris = p.orig; p.hidden = p.gone = p.on = false; });
      isolated = false; view = 'solid'; grid = true;
      paint(); say(HINT);
      if (rested) rebuild();
    };

    // what the commands do to the three parts; the ones that open a card or touch a file in the app only say what they do there
    const note = (text) => () => say(text);
    const cmd = {
      hide: () => { const a = sel(); a.forEach((p) => { p.hidden = true; p.on = false; }); say('Hid ' + names(a) + '.'); },
      del: () => { const a = sel(); a.forEach((p) => { p.gone = true; p.on = false; }); say('Deleted ' + names(a) + '.'); },
      dec: (v) => () => {
        const a = sel(); a.forEach((p) => { p.tris = Math.max(12, Math.round(p.tris * (1 - v))); });
        say('Decimate −' + Math.round(v * 100) + ' %: ' + a.map((p) => p.name + ' is now ' + fmt(p.tris)).join(', ') + ' triangles.');
      },
      fit: (all) => () => {
        const a = all ? live() : sel(); a.forEach((p) => { p.tris = Math.max(12, Math.round(p.orig * 0.0016)); });
        say('Smart fit: ' + a.map((p) => p.name + ' is now ' + fmt(p.tris)).join(', ') + ' triangles, and the outline is kept.');
      },
      isolate: () => { const a = sel(); live().forEach((p) => { if (!p.on) p.hidden = true; }); isolated = true; say('Isolated ' + names(a) + '.'); },
      others: () => { live().forEach((p) => { if (!p.on) p.hidden = true; }); say('Hid everything that was not selected.'); },
      showAll: () => { parts.forEach((p) => { p.hidden = false; }); isolated = false; say('Every part is shown.'); },
      selAll: () => { live().forEach((p) => { p.on = !p.hidden; }); say('Selected ' + sel().length + ' parts.'); },
      colour: () => { live().forEach((p) => { p.on = !p.hidden; }); say('Selected every part of the same colour: all ' + sel().length + '.'); },
      view: (m, label) => () => { view = m; say(label + '.'); },
      grid: () => { grid = !grid; say(grid ? 'The ground grid is shown.' : 'The ground grid is hidden.'); },
    };
    const L = (label, icon, right, fn, o) => Object.assign({ label, icon, right, fn }, o || {});
    // what is on the ring: the app's own slices. With a selection it works on that, with none on the whole scene; what cannot run stays, dimmed
    const layout = () => {
      const a = sel(), anyHidden = live().some((p) => p.hidden), none = live().length ? false : 'The scene is empty';
      const showAll = L('Show all', 'eye', 'Alt+H', cmd.showAll, { off: anyHidden ? false : 'Nothing is hidden' });
      if (a.length) {
        const total = a.reduce((n, p) => n + p.tris, 0), few = total < 12 ? 'Too few triangles to take away' : false;
        const dec = (v) => L('Decimate −' + Math.round(v * 100) + '%', 'triangle', fmt(total) + ' → ' + fmt(Math.round(total * (1 - v))), cmd.dec(v), { off: few });
        return [
          { leaf: L('Hide', 'eye-off', 'H', cmd.hide) },
          { group: 'Reduce', icon: 'triangle', items: [dec(0.5), dec(0.25), dec(0.75), dec(0.9), L('Smart fit', 'wand-2', 'Ctrl+B', cmd.fit(false)), L('Split…', 'split', 'X', note('Split… opens a card in the app, where you choose how strict to be.')), L('Remove holes…', 'circle-off', 'P', note('Remove holes… opens a card in the app, where you set the size and the depth.'))] },
          { leaf: L('Delete', 'trash-2', 'Del', cmd.del, { danger: true }) },
          { group: 'More', icon: 'ellipsis', items: [
            isolated ? L('Show all', 'eye', 'Alt+H', cmd.showAll) : L('Isolate', 'focus', 'S', cmd.isolate),
            L('Frame', 'scan', 'F', note('Frame zooms the camera to the selection.')),
            L('Select similar', 'shapes', '', note('Select similar picks every part of the same shape. No other part here has this one.')),
            L('Select same colour', 'palette', '', cmd.colour),
            L('Group', 'folder-plus', 'Ctrl+G', note('Group puts the selection in a new group in the tree.')),
            L('Duplicate', 'copy-plus', 'Ctrl+D', note('Duplicate makes a copy in place.')),
            L('Merge', 'combine', 'Ctrl+M', note('Merge joins the selection into one part.'), { off: a.length > 1 ? false : 'Select two or more parts' }),
            L('Hide others', 'eye-off', 'Shift+H', cmd.others)].concat(isolated ? [] : [showAll]) },
        ];
      }
      const mode = (m, label, kbd, icon) => L(label, icon, kbd, cmd.view(m, label));
      return [
        { leaf: L('Fit view', 'maximize', 'F', note('Fit view zooms the camera to the whole model.'), { off: none }) },
        { leaf: L('Select all', 'check', 'Ctrl+A', cmd.selAll, { off: none }) },
        { group: 'View', icon: 'video', items: [
          L('Camera view', 'video', 'Ctrl+1', note('Camera view is the perspective camera.')), L('Top view', 'square', 'Ctrl+2', note('Top view looks from above.')),
          L('Front view', 'square', 'Ctrl+3', note('Front view looks from the front.')), L('Side view', 'square', 'Ctrl+4', note('Side view looks from the side.')),
          mode('solid', 'Solid view', '1', 'box'), mode('wire', 'Wireframe view', '2', 'grid-3x3'), mode('xray', 'X-ray view', '3', 'crosshair'),
          L(grid ? 'Hide ground grid' : 'Show ground grid', grid ? 'eye-off' : 'eye', 'G', cmd.grid)] },
        { leaf: showAll },
        { group: 'File', icon: 'folder', items: [
          L('Save screenshot…', 'camera', '', note('Save screenshot saves an image of the viewport.'), { off: none }),
          L('Save scene…', 'save', 'Ctrl+S', note('Save scene keeps the view, the selection and the recolouring in a small file.'), { off: none }),
          L('Revert to source file…', 'rotate-ccw', '', note('Revert goes back to the file as it was opened.'), { off: none })] },
        { group: 'Clean', icon: 'sparkles', items: [
          L('Recentre on origin', 'target', '', note('Recentre moves the model to the origin.'), { off: none }),
          L('Align to the floor…', 'arrow-down-to-line', '', note('Align to the floor stands a model that arrived on its side on the grid.'), { off: none }),
          L('Smart fit all parts', 'box-select', '', cmd.fit(true), { off: none }),
          L('Remove empty parts', 'circle-minus', '', note('Remove empty parts deletes parts without geometry. All three here have some.'), { off: none }),
          L('Deduplicate geometry', 'copy', '', note('Deduplicate shares geometry between equal parts. These three are all different.'), { off: none }),
          L('Fix degenerate parts', 'asterisk', '', note('Fix degenerate parts repairs broken triangles. These are sound.'), { off: none })] },
      ];
    };

    // drawing: a ring segment, with some corners softened for the fan
    const pol = (r, a) => [r * Math.sin(a * Math.PI / 180), -r * Math.cos(a * Math.PI / 180)];
    const f2 = (n) => n.toFixed(2);
    const arc = (r0, r1, a0, a1) => {
      const [x0, y0] = pol(r1, a0), [x1, y1] = pol(r1, a1), [x2, y2] = pol(r0, a1), [x3, y3] = pol(r0, a0), big = (a1 - a0) > 180 ? 1 : 0;
      return 'M' + f2(x0) + ' ' + f2(y0) + 'A' + r1 + ' ' + r1 + ' 0 ' + big + ' 1 ' + f2(x1) + ' ' + f2(y1) + 'L' + f2(x2) + ' ' + f2(y2) + 'A' + r0 + ' ' + r0 + ' 0 ' + big + ' 0 ' + f2(x3) + ' ' + f2(y3) + 'Z';
    };
    const arcR = (r0, r1, a0, a1, c, rho) => {
      const k = (on) => (on ? rho : 0), d = (on, r) => (on ? rho / r * 180 / Math.PI : 0), P = (r, a) => pol(r, a), f = (p) => f2(p[0]) + ' ' + f2(p[1]);
      return 'M' + f(P(r1, a0 + d(c[0], r1))) + 'A' + r1 + ' ' + r1 + ' 0 0 1 ' + f(P(r1, a1 - d(c[1], r1))) +
        'Q' + f(P(r1, a1)) + ' ' + f(P(r1 - k(c[1]), a1)) + 'L' + f(P(r0 + k(c[2]), a1)) +
        'Q' + f(P(r0, a1)) + ' ' + f(P(r0, a1 - d(c[2], r0))) + 'A' + r0 + ' ' + r0 + ' 0 0 0 ' + f(P(r0, a0 + d(c[3], r0))) +
        'Q' + f(P(r0, a0)) + ' ' + f(P(r0 + k(c[3]), a0)) + 'L' + f(P(r1 - k(c[0]), a0)) +
        'Q' + f(P(r1, a0)) + ' ' + f(P(r1, a0 + d(c[0], r1))) + 'Z';
    };
    const build = () => {
      if (!root) { root = el('div', 'wq'); root.setAttribute('aria-hidden', 'true'); stage.appendChild(root); }
      setK(); root.style.setProperty('--k', K);
      slots = layout().filter((sl) => sl && (sl.leaf || (sl.items && sl.items.length))); slice = 360 / slots.length;
      let svg = '<g class="wq-slices">', items = '';
      slots.forEach((sl, i) => {
        const a = i * slice, leaf = sl.leaf;
        sl.off = leaf ? leaf.off : (sl.items.every((x) => x.off) ? 'Nothing here can run now' : false);
        const label = leaf ? leaf.label : sl.group, icon = leaf ? leaf.icon : sl.icon, danger = leaf && leaf.danger;
        const [x, y] = pol(R_ICON, a), [gx, gy] = pol(R_ICON * POP, a);
        svg += '<path class="wq-slice' + (sl.off ? ' is-off' : '') + (danger ? ' danger' : '') + '" data-i="' + i + '" d="' + arc(R_IN, R_OUT, a - slice / 2, a + slice / 2) + '"/>';
        items += '<div class="wq-item' + (sl.off ? ' is-off' : '') + (danger ? ' danger' : '') + '" data-i="' + i + '" style="left:' + x.toFixed(1) + 'px;top:' + y.toFixed(1) + 'px;--dx:' + gx.toFixed(1) + 'px;--dy:' + gy.toFixed(1) + 'px">' + ico(icon) + '<span>' + esc(label) + '</span></div>';
      });
      svg += '</g><g class="wq-fan"></g><path class="wq-pop" d=""/><path class="wq-pop2" d=""/><g class="wq-fanico"></g>';
      root.innerHTML = '<div class="wq-ring"><svg class="wq-svg" viewBox="-' + V + ' -' + V + ' ' + 2 * V + ' ' + 2 * V + '" width="' + 2 * V + '" height="' + 2 * V + '" style="left:-' + V + 'px;top:-' + V + 'px">' + svg + '</svg><div class="wq-items">' + items + '</div><div class="wq-fanlabels"></div></div>';
    };
    const place = () => {
      const w = stage.clientWidth, h = stage.clientHeight;
      const cx = w < 2 * V ? w / 2 : Math.max(V, Math.min(w - V, ox)), cy = h < 2 * V ? h / 2 : Math.max(V, Math.min(h - V, oy));
      root.style.left = cx + 'px'; root.style.top = cy + 'px';
    };
    // The lit slice grows out of the ring a little: a copy of its shape drawn above its neighbours, scaled up with a small overshoot
    const popTo = (p, d, danger) => {
      if (!p) return;
      p.style.transition = 'none'; p.classList.remove('is-on');
      if (!d) { void p.getBoundingClientRect(); p.style.transition = ''; return; }
      p.setAttribute('d', d); p.classList.toggle('danger', !!danger);
      void p.getBoundingClientRect(); p.style.transition = ''; p.classList.add('is-on');
    };
    const fanOpen = (i) => {
      const g = $('.wq-fan', root), lab = $('.wq-fanlabels', root), fi = $('.wq-fanico', root);
      fanFor = i; sub = -1;
      popTo($('.wq-pop2', root), null);
      if (i < 0) { g.innerHTML = ''; lab.innerHTML = ''; fi.innerHTML = ''; return; }
      const sl = slots[i], n = sl.items.length, step = n <= 5 ? 30 : n <= 7 ? 26 : 22, total = step * n, a0 = i * slice - total / 2;
      sl.fan = { step, total, a0 };
      let paths = '', labels = '', icons = '';
      sl.items.forEach((it, j) => {
        const aa = a0 + j * step, am = aa + step / 2, first = j === 0, last = j === n - 1;
        const dn = arcR(F_IN, F_OUT, aa, aa + step, [first, last, last, first], 6), dl = arcR(F_IN, F_OUT, aa, aa + step, [true, true, true, true], 6);
        paths += '<path class="wq-sub' + (it.off ? ' is-off' : '') + (it.danger ? ' danger' : '') + '" data-j="' + j + '" data-d="' + dn + '" data-dh="' + dl + '" d="' + dn + '" style="--j:' + j + '"/>';
        const [ix, iy] = pol((F_IN + F_OUT) / 2, am), [kx, ky] = pol((F_IN + F_OUT) / 2 * POP2, am);
        icons += '<foreignObject x="' + (ix - 9 * K).toFixed(1) + '" y="' + (iy - 9 * K).toFixed(1) + '" width="' + (18 * K).toFixed(1) + '" height="' + (18 * K).toFixed(1) + '" class="wq-subico' + (it.off ? ' is-off' : '') + '" data-j="' + j + '" style="--j:' + j + ';--dx:' + kx.toFixed(1) + 'px;--dy:' + ky.toFixed(1) + 'px"><div xmlns="http://www.w3.org/1999/xhtml">' + ico(it.icon) + '</div></foreignObject>';
        const [lx, ly] = pol(F_OUT + 10, am), sx = Math.sin(am * Math.PI / 180);
        const al = Math.abs(sx) > 0.2 ? (sx > 0 ? '0 -50%' : '-100% -50%') : '-50% ' + (-Math.cos(am * Math.PI / 180) > 0 ? '0' : '-100%');
        labels += '<div class="wq-lab' + (it.off ? ' is-off' : '') + '" data-j="' + j + '" style="--j:' + j + ';left:' + lx.toFixed(1) + 'px;top:' + ly.toFixed(1) + 'px;translate:' + al + '">' + esc(it.label) + ((it.off || it.right) ? '<span class="wq-lab-r">' + esc(it.off ? String(it.off) : it.right) + '</span>' : '') + '</div>';
      });
      g.innerHTML = paths; lab.innerHTML = labels; fi.innerHTML = icons;
    };
    // following the pointer: the slice it is toward, and the command of the fan it has gone out onto
    const aim = () => {
      const dx = px - ox, dy = py - oy, d = Math.hypot(dx, dy);
      let a = Math.atan2(dx, -dy) * 180 / Math.PI; if (a < 0) a += 360;
      let h = -1, sj = -1;
      const reach = rested ? (fanFor >= 0 ? F_OUT + 16 : R_OUT + 12) : Infinity;
      if (d >= DEAD && d <= reach) {
        h = Math.round(a / slice) % slots.length;
        // a fan lies across the directions of other slices: once the pointer has gone on outward from the group it was on, the group is kept
        if (fanFor >= 0) {
          if (d - entryD > 12) committed = true; else if (d < entryD + 2) committed = false;
          if (committed && d > R_IN + 6) h = fanFor;
        }
        if (fanFor >= 0 && d > R_OUT + 4 && slots[fanFor] && slots[fanFor].fan) {
          const { step, total, a0 } = slots[fanFor].fan, rel = ((a - a0) % 360 + 360) % 360;
          if (rel < total) { sj = Math.floor(rel / step); h = fanFor; } else h = fanFor;
        }
      }
      if (h !== hot) {
        hot = h;
        const grp = h >= 0 && slots[h] && slots[h].items && !slots[h].off ? h : -1;
        if (grp !== fanFor) { fanOpen(grp); entryD = d; committed = false; }
        $$('.wq-slice,.wq-item', root).forEach((n) => n.classList.toggle('is-hot', +n.dataset.i === h));
        const hs = h >= 0 ? slots[h] : null, hp = hs && !hs.off ? $('.wq-slice[data-i="' + h + '"]', root) : null;
        popTo($('.wq-pop', root), hp ? hp.getAttribute('d') : null, hs && hs.leaf && hs.leaf.danger);
      }
      if (sj !== sub) {
        sub = sj;
        $$('.wq-sub,.wq-lab,.wq-subico', root).forEach((n) => n.classList.toggle('is-hot', +n.dataset.j === sj));
        $$('.wq-sub', root).forEach((n) => n.setAttribute('d', +n.dataset.j === sj ? n.dataset.dh : n.dataset.d));
        const sp = sj >= 0 ? $('.wq-sub[data-j="' + sj + '"]', root) : null, si = sp && slots[fanFor] ? slots[fanFor].items[sj] : null;
        popTo($('.wq-pop2', root), sp && si && !si.off ? sp.dataset.dh : null, si && si.danger);
      }
      root.classList.toggle('is-aim', d >= DEAD);
    };
    const current = () => {
      if (hot < 0 || !slots[hot]) return null;
      const sl = slots[hot];
      if (sub >= 0 && sl.items && sl.items[sub]) return sl.items[sub];
      return sl.leaf || { isGroup: true };
    };
    const runnable = (c) => !!(c && !c.isGroup && !c.off);
    const centre = () => { lastX = stage.clientWidth / 2; lastY = stage.clientHeight / 2; };
    const show = (asSticky) => {
      if (open) return;
      ox = px = lastX; oy = py = lastY; sticky = !!asSticky; moved = false; startedAt = performance.now(); hot = -1; sub = -1; fanFor = -1; committed = false;
      setK(); build(); place();
      open = true; demo.classList.add('is-open');
      root.classList.remove('is-in'); root.style.display = 'block'; void root.offsetWidth; root.classList.add('is-in');
      aim();
    };
    // the ring comes back to rest in the middle of the stage, built again for what is there now
    const rest = () => { if (open) return; centre(); show(true); rested = true; };
    const rebuild = () => { hot = -1; sub = -1; fanFor = -1; committed = false; build(); place(); root.style.display = 'block'; root.classList.add('is-in'); px = ox; py = oy; aim(); };
    const hide = () => { open = false; sticky = false; rested = false; viaPointer = false; closedAt = performance.now(); root.classList.remove('is-in'); root.style.display = 'none'; demo.classList.remove('is-open'); };
    // run: whether to run what the pointer is on. A ring at rest stays where it is; a ring that was moved to the pointer goes back to rest.
    const close = (run) => {
      if (!open) return false;
      const c = run ? current() : null, go = runnable(c);
      if (rested) {
        if (go) { c.fn(); paint(); rebuild(); }
        else { px = ox; py = oy; aim(); }
        return go;
      }
      hide();
      setTimeout(() => { if (go) { c.fn(); paint(); } else if (run) say('Nothing run. Flick toward a slice, or a command of its fan, before you let go.'); rest(); }, 0);
      return go;
    };
    const moveToPointer = () => { if (!rested) return; hide(); show(false); };

    // the pointer: a click runs what is lit, or selects the part under it; a press held for a moment moves the ring to the pointer (like W held)
    const local = (e) => { const r = stage.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    stage.addEventListener('pointerenter', () => { over = true; });
    stage.addEventListener('pointerleave', (e) => { over = false; if (e.pointerType === 'mouse' && rested && open) { px = ox; py = oy; aim(); } });
    stage.addEventListener('contextmenu', (e) => { if (open || performance.now() - closedAt < 400) e.preventDefault(); });
    // The stage lets a finger scroll the page (touch-action: pan-y), so a swipe that starts on it moves the page. Only a ring that was opened by a press held
    // on it takes the finger over: the scroll has not started yet (the finger stayed still for the hold), so it can still be stopped here.
    stage.addEventListener('touchmove', (e) => { if (hold && hold.fired && open && e.cancelable) e.preventDefault(); }, { passive: false });
    stage.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const [x, y] = local(e); lastX = x; lastY = y;
      if (open && rested) {                                              // a press on the resting ring: aim there, then run or fan out
        px = x; py = y; aim();
        const c = current();
        if (c) { e.preventDefault(); if (runnable(c)) close(true); return; }
      } else if (open) { e.preventDefault(); close(true); return; }      // a ring left open by a tap of W: the press picks
      const h = hold = { x: e.clientX, y: e.clientY, id: e.pointerId, part: e.target.closest('.wand-part'), fired: false, t: 0 };
      h.t = setTimeout(() => {
        if (hold !== h) return;
        h.fired = true; viaPointer = true;
        try { stage.setPointerCapture(h.id); } catch (_) { /* a pointer that is gone */ }
        moveToPointer(); if (!open) show(false);
      }, 230);
    });
    window.addEventListener('pointermove', (e) => {
      const [x, y] = local(e); lastX = x; lastY = y;
      if (hold && !hold.fired && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 8) { clearTimeout(hold.t); hold = null; }
      if (!open) return;
      if (rested && !over) return;
      px = x; py = y;
      if (Math.hypot(px - ox, py - oy) >= DEAD) moved = true;
      aim();
    }, true);
    window.addEventListener('pointerup', (e) => {
      if (!hold || e.pointerId !== hold.id) return;
      const h = hold; hold = null; clearTimeout(h.t);
      if (h.fired) { viaPointer = false; close(true); return; }
      const p = h.part ? parts[+h.part.dataset.i] : null;               // a click: select the part under it
      parts.forEach((q) => { q.on = q === p; });
      paint();
      say(p ? p.name + ' is selected. The ring now works on it.' : 'Nothing is selected, so the ring works on the whole scene.');
      if (rested) rebuild();
    }, true);
    window.addEventListener('pointercancel', () => { if (hold) { clearTimeout(hold.t); hold = null; } close(false); }, true);

    // the keyboard: W held moves the ring to the pointer, a quick tap leaves it open there; anything else puts it back
    const typing = (e) => { const t = e.target; return !!(t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))); };
    const isW = (e) => e.key === 'w' || e.key === 'W';
    window.addEventListener('keydown', (e) => {
      if (e.isComposing || typing(e)) return;
      if (e.key === 'Escape' && open && !rested) { e.preventDefault(); close(false); return; }
      if (isW(e) && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        if (open && rested) { if (e.repeat || !over) return; e.preventDefault(); ox = px = lastX; oy = py = lastY; moveToPointer(); return; }
        if (open) { e.preventDefault(); if (sticky && !e.repeat) close(false); return; }
        if (e.repeat || !over) return;
        e.preventDefault(); show(false);
        return;
      }
      if (open && !rested && !/^(Shift|Control|Alt|Meta|CapsLock)$/.test(e.key)) close(false);
    }, true);
    window.addEventListener('keyup', (e) => {
      if (!open || rested || !isW(e) || viaPointer) return;
      e.preventDefault();
      if (sticky) return;
      if (performance.now() - startedAt < 260 && !moved) { sticky = true; aim(); say('The ring stays open here. Click a command to run it, Esc to put it back.'); return; }
      close(true);
    }, true);
    window.addEventListener('wheel', () => { if (open && !rested) close(false); }, { capture: true, passive: true });
    window.addEventListener('blur', () => { if (open && !rested) close(false); });
    window.addEventListener('resize', () => { if (open && rested) { centre(); ox = px = lastX; oy = py = lastY; place(); } else if (open) close(false); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && open && !rested) close(false); });

    $$('[data-wand-mode]', demo).forEach((b) => b.addEventListener('click', () => {
      const on = b.dataset.wandMode === 'part';
      if (open && !rested) hide();
      parts.forEach((q, i) => { q.on = on && i === 0 && !q.gone; });
      paint(); say(on ? parts[0].name + ' is selected. The ring now works on it.' : 'Nothing is selected, so the ring works on the whole scene.');
      if (rested) rebuild(); else rest();
    }));
    $('[data-wand-reset]', demo).addEventListener('click', () => { if (open && !rested) hide(); reset(); if (!open) rest(); });
    reset();
    rest();
  });

  // ---- clips ----
  // A clip is fetched and played only while it is on screen and stops when
  // it leaves, on a phone as well (muted and inline, which is what lets it
  // start without a tap). A tap pauses it or starts it again. With reduced
  // motion it stays a poster until it is tapped.
  const clips = $$('video[data-src]');
  if (clips.length) {
    const start = (v) => { if (!v.src) v.src = v.dataset.src; v.muted = true; v.setAttribute('playsinline', ''); const p = v.play(); if (p && p.catch) p.catch(() => {}); };
    const toggle = (v) => { if (v.paused) { v.dataset.held = ''; start(v); } else { v.dataset.held = '1'; v.pause(); } };
    clips.forEach((v) => {
      // a phone drops the poster the moment a source is set and shows an empty box until the first frame is ready (the blink): the same
      // picture stays under the video as its background, so the first frame lands on it without a gap
      if (v.poster) v.style.background = 'var(--surface) url("' + v.poster + '") center / cover no-repeat';
      v.tabIndex = 0;
      v.setAttribute('role', 'button');
      v.addEventListener('click', () => toggle(v));
      v.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(v); } });
    });
    if (!calm && 'IntersectionObserver' in window) {
      const watch = new IntersectionObserver(entries => entries.forEach((entry) => {
        const v = entry.target;
        if (entry.isIntersecting) { if (!v.dataset.held) start(v); } else v.pause();
      }), { threshold: 0.35 });
      clips.forEach(v => watch.observe(v));
      // a clip starts loading a little before it scrolls into view, so it is ready when it arrives
      const near = new IntersectionObserver(entries => entries.forEach((entry) => {
        const v = entry.target;
        if (entry.isIntersecting) { if (!v.src) { v.preload = 'auto'; v.src = v.dataset.src; } near.unobserve(v); }
      }), { rootMargin: '400px 0px' });
      clips.forEach(v => near.observe(v));
    } else {
      clips.forEach(v => v.parentElement.classList.add('is-tap'));
    }
  }

  // ---- tile drawings move only while their tile is on screen ----
  const tiles = $$('.tile, .clip, .star');
  if (tiles.length && 'IntersectionObserver' in window) {
    const live = new IntersectionObserver(entries => entries.forEach(e => e.target.classList.toggle('is-live', e.isIntersecting)), { threshold: 0.2 });
    tiles.forEach(t => live.observe(t));
  }

  // ---- commands that copy ----
  $$('.copy').forEach(button => button.addEventListener('click', () => {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(button.dataset.copy).then(() => {
      button.textContent = 'Copied';
      button.classList.add('is-done');
      setTimeout(() => { button.textContent = 'Copy'; button.classList.remove('is-done'); }, 1400);
    }).catch(() => {});
  }));

  // ---- docs: search the list of articles ----
  // Every word typed must be in an article's title, summary, headings or
  // terms (data-words). Groups with nothing left are put away.
  const search = $('#kbSearch');
  if (search) {
    const rows = $$('.kb-list li'), groups = $$('.kb-group'), none = $('#kbNone');
    const filter = () => {
      const words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
      let shown = 0;
      rows.forEach((row) => {
        const hit = words.every(word => row.dataset.words.includes(word));
        row.hidden = !hit;
        if (hit) shown++;
      });
      groups.forEach((group) => { group.hidden = !$('.kb-list li:not([hidden])', group); });
      if (none) none.hidden = shown > 0;
    };
    search.addEventListener('input', filter);
    // "/" puts the cursor in the search, Enter opens the first article left
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== search && !e.ctrlKey && !e.metaKey) { e.preventDefault(); search.focus(); }
    });
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { search.value = ''; filter(); }
      if (e.key === 'Enter') { const first = $('.kb-list li:not([hidden]) a'); if (first) location.href = first.href; }
    });
    if (search.value) filter();          // a value the browser kept across a reload
  }

  // ---- docs: the index beside an article shows where you are ----
  const here = $('.kb-nav a[aria-current]');
  if (here) { const nav = here.parentElement; nav.scrollTop = Math.max(0, here.offsetTop - nav.clientHeight / 2); }
})();
