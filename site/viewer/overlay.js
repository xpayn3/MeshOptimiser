// ========== SHARED OVERLAY / LIGHTBOX / MOBILE LIST / SCROLL LOCK ==========
// Lifted out of script.js so both grid.html and index.html can use the same
// slide-up project overlay. Depends on projects.js (window.projects etc.)
// and GSAP + ScrollTrigger + Lenis CDN libs.

// Pictures that load late (lazy tiles, gallery images, covers) fade in when
// they arrive instead of popping. Every <img> gets `is-loaded` once it has
// loaded (or failed, so its alt text still shows); overlay.css does the fade
// and only hides pictures while `html.fade-imgs` says this script is running.
(function fadeLazyImages() {
  const mark = (e) => { if (e.target.tagName === 'IMG') e.target.classList.add('is-loaded'); };
  document.documentElement.classList.add('fade-imgs');
  document.addEventListener('load', mark, true);     // load doesn't bubble: capture it
  document.addEventListener('error', mark, true);
  // pictures that had already arrived before this script ran
  const sweep = () => {
    for (const img of document.images) if (img.complete && img.getAttribute('src')) img.classList.add('is-loaded');
  };
  sweep();
  document.addEventListener('DOMContentLoaded', sweep);
})();

(function () {
  const isMobile = window.innerWidth < 768;

  // ---- Ensure overlay/lightbox/mobile-list DOM exists ----------------------
  // grid.html hard-codes the markup. index.html does not — inject if missing.
  function ensureMarkup() {
    if (!document.getElementById('overlay')) {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'overlay-close';
      closeBtn.id = 'overlayClose';
      closeBtn.setAttribute('aria-label', 'Close');
      closeBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="17" y2="17"/><line x1="17" y1="1" x2="1" y2="17"/></svg>';
      document.body.appendChild(closeBtn);

      const ov = document.createElement('div');
      ov.className = 'overlay';
      ov.id = 'overlay';
      ov.innerHTML = '<div class="overlay-inner" id="overlayInner"></div>';
      document.body.appendChild(ov);
    }
    if (!document.getElementById('lightbox')) {
      const lb = document.createElement('div');
      lb.className = 'lightbox';
      lb.id = 'lightbox';
      lb.innerHTML = `
        <button class="lightbox-close" id="lightboxClose"><svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="17" y2="17"/><line x1="17" y1="1" x2="1" y2="17"/></svg></button>
        <div class="lightbox-content" id="lightboxContent"></div>
        <div class="lightbox-info" id="lightboxInfo"></div>
        <canvas class="lightbox-histogram" id="lightboxHistogram" width="200" height="80"></canvas>
        <div class="lightbox-bottom">
          <div class="lightbox-strip" id="lightboxStrip"></div>
          <div class="lightbox-controls">
            <button class="lb-ctrl-btn" id="lightboxPrev"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="15,4 7,12 15,20"/></svg></button>
            <span class="lightbox-counter" id="lightboxCounter"></span>
            <button class="lb-ctrl-btn" id="lightboxNext"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="9,4 17,12 9,20"/></svg></button>
          </div>
        </div>`;
      document.body.appendChild(lb);
    }
    if (!document.getElementById('mobileProjList')) {
      const mpl = document.createElement('div');
      mpl.className = 'mobile-proj-list';
      mpl.id = 'mobileProjList';
      mpl.innerHTML = `
        <div class="mobile-proj-bg" id="mobileProjBg"></div>
        <button class="mobile-proj-close" id="mobileProjClose"><svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="17" y2="17"/><line x1="17" y1="1" x2="1" y2="17"/></svg></button>
        <div class="mobile-proj-scroll" id="mobileProjScroll"></div>`;
      document.body.appendChild(mpl);
    }
  }
  ensureMarkup();

  const overlay = document.getElementById('overlay');
  const overlayInner = document.getElementById('overlayInner');
  const overlayClose = document.getElementById('overlayClose');
  let keyboardUser = false;
  addEventListener('keydown', () => { keyboardUser = true; }, true);
  addEventListener('pointerdown', () => { keyboardUser = false; }, true);
  const lightbox = document.getElementById('lightbox');
  const lightboxContent = document.getElementById('lightboxContent');
  const lightboxCounter = document.getElementById('lightboxCounter');
  const lightboxStrip = document.getElementById('lightboxStrip');
  const mobileProjList = document.getElementById('mobileProjList');
  const mobileProjScroll = document.getElementById('mobileProjScroll');
  const mobileProjClose = document.getElementById('mobileProjClose');
  const mobileProjBg = document.getElementById('mobileProjBg');

  // ---- Scroll lock ---------------------------------------------------------
  let savedScrollY = 0;
  let scrollLockCount = 0;

  // Locking pins <body> and the page's scroll position reads as 0 until it is
  // released. The gallery's scroll-driven parallax would follow that and
  // slide every picture inside its cell, visibly, behind the lightbox as it
  // fades in. Hold the parallax where it is for the length of the lock.
  function freezeParallax(frozen) {
    if (typeof ScrollTrigger === 'undefined') return;
    overlayScrollTriggers.forEach(st => {
      if (!st) return;
      if (frozen) st.disable(false); else st.enable(false, false);
    });
  }

  // Touch devices get a "soft" lock: the page is left exactly as it is and
  // the touchmove guard below simply refuses to scroll it. Pinning <body>
  // (the hard lock) makes a phone browser treat the page as unscrollable and
  // redraw its toolbars as solid bands, cropping the page top and bottom, and
  // they don't always go back afterwards. Nothing to restore, either.
  const softLock = () => window.matchMedia('(pointer: coarse)').matches;
  let lockIsSoft = false;

  function lockScroll() {
    if (scrollLockCount === 0) {
      freezeParallax(true);
      lockIsSoft = softLock();
      if (!lockIsSoft) {
        savedScrollY = window.scrollY;
        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';
        document.body.style.position = 'fixed';
        document.body.style.top = `-${savedScrollY}px`;
        document.body.style.width = '100%';
        document.body.classList.add('scroll-locked');
      }
    }
    scrollLockCount++;
  }

  // A smooth-scroll instance that lives through a lock (or through the page
  // being swapped for a project) is left with stale numbers: it saw the page
  // at 0, and it caches the page's scrollable height, refreshing that only a
  // quarter of a second after the layout changes. A wheel tick inside that
  // window would be clamped to the stale height (0 while locked) and throw
  // the page to the top. Re-measure and re-seat it right away instead. (The
  // caller sets the window's own scroll position afterwards.)
  function syncSmoothScroll(y) {
    const lenis = overlayLenis || window.pageLenis;
    if (!lenis) return;
    lenis.resize();
    lenis.scrollTo(y, { immediate: true, force: true });
  }

  function unlockScroll() {
    scrollLockCount = Math.max(0, scrollLockCount - 1);
    if (scrollLockCount === 0 && lockIsSoft) {
      lockIsSoft = false;
      freezeParallax(false);
      return;
    }
    if (scrollLockCount === 0) {
      const y = savedScrollY;
      // Remove overflow first so scrollTo works
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
      document.body.classList.remove('scroll-locked');
      // Remove fixed positioning and restore scroll in one go
      document.body.style.cssText = '';
      syncSmoothScroll(y);
      window.scrollTo({ top: y, behavior: 'instant' });
      freezeParallax(false);
    }
  }

  // iOS bfcache / navigation cleanup: if the page is restored from back-forward
  // cache while scroll was locked (overlay open), body stays position:fixed with
  // a negative top offset — touch hit-testing then registers above the visual
  // position, making the top items of bar dropdowns unclickable. Reset here.
  function resetStaleScrollLock() {
    if (document.body.classList.contains('scroll-locked') || document.body.style.position === 'fixed') {
      scrollLockCount = 0;
      document.documentElement.style.overflow = '';
      document.body.style.cssText = '';
      document.body.classList.remove('scroll-locked');
    }
    // a soft lock leaves no trace on the page, only the counter: clear it
    // unless something that needs it is actually still open
    if (!lightbox.classList.contains('open') && !mobileProjList.classList.contains('open')) {
      scrollLockCount = 0;
      lockIsSoft = false;
    }
  }
  window.addEventListener('pageshow', resetStaleScrollLock);
  document.addEventListener('DOMContentLoaded', resetStaleScrollLock);

  // iOS scroll leak prevention — block touchmove on non-scrollable areas,
  // prevent bounce at scroll boundaries
  let _touchStartY = 0;
  document.addEventListener('touchstart', (e) => {
    _touchStartY = e.touches[0].clientY;
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (scrollLockCount === 0) return;
    // the lightbox thumbnail strip scrolls sideways; let it
    if (e.target.closest && e.target.closest('.lightbox-strip')) return;

    // Find nearest scrollable ancestor
    let scrollable = null;
    let el = e.target;
    while (el && el !== document.body && el !== document.documentElement) {
      const style = getComputedStyle(el);
      const isScrollable = el.scrollHeight > el.clientHeight + 1 &&
        (style.overflowY === 'auto' || style.overflowY === 'scroll');
      if (isScrollable) { scrollable = el; break; }
      el = el.parentElement;
    }

    // No scrollable parent — block
    if (!scrollable) { e.preventDefault(); return; }

    // At scroll boundary — block to prevent rubber-band leak
    const dy = _touchStartY - e.touches[0].clientY;
    const st = scrollable.scrollTop;
    const atTop = st <= 0 && dy < 0;
    const atBottom = st + scrollable.clientHeight >= scrollable.scrollHeight - 1 && dy > 0;
    if (atTop || atBottom) e.preventDefault();
  }, { passive: false });

  // ---- Overlay parallax ---------------------------------------------------
  let overlayLenis = null;
  let overlayScrollTriggers = [];
  let overlayTickerFn = null;
  let currentOverlayObs = null;

  // A project is shown as the page itself, not as a panel scrolling inside
  // the page: the rest of the page is hidden (body.project-page) and the
  // window does the scrolling. That is what lets phone browsers draw the
  // content under their translucent bars, exactly as on the home page, and
  // it needs no scroll lock.
  let pageScrollY = 0;        // where the host page was, to return to on close

  // the smooth-scroll instance driving the window, if any (the home page has
  // its own; elsewhere one runs while a project is open)
  const viewLenis = () => overlayLenis || window.pageLenis || null;
  function jumpTo(y) {
    syncSmoothScroll(y);
    window.scrollTo({ top: y, behavior: 'instant' });
  }

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const coarsePointer = window.matchMedia('(pointer: coarse)');

  // One smooth-scroll feel for the whole site: motion.js sets the settings
  // and runs the page's own scroll (window.pageLenis) on every page.
  const SMOOTH_SCROLL = window.SMOOTH_SCROLL || { lerp: 0.24, wheelMultiplier: 1.1, smoothWheel: true };

  // Browser UI tint (address bar / status bar areas on phones).
  let themeColorBefore;
  function setThemeColor(color) {
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    if (themeColorBefore === undefined) themeColorBefore = meta.content || '';
    meta.content = color;
  }
  function restoreThemeColor() {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && themeColorBefore !== undefined) {
      if (themeColorBefore) meta.content = themeColorBefore; else meta.remove();
    }
    themeColorBefore = undefined;
  }
  const pageBg = () => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#ffffff';

  function initOverlayParallax() {
    // Smooth scroll and parallax are desktop enhancements. Skip them when the
    // CDN libraries didn't load, the visitor prefers reduced motion, or the
    // device is touch-first: phones scroll natively, which is both smoother
    // and much cheaper than scrubbing a transform on every picture.
    const libs = typeof Lenis !== 'undefined' && typeof gsap !== 'undefined' && typeof ScrollTrigger !== 'undefined';
    const enhance = libs && !reducedMotion.matches && !coarsePointer.matches;
    overlay.classList.toggle('no-parallax', !enhance);   // drops the parallax over-scale (overlay.css)
    if (!enhance) return;

    // The page's own smooth scroll (motion.js) also scrolls the project.
    // Only a page without one runs one for as long as the project is open.
    if (!window.pageLenis && !window.PAGE_SMOOTH_SCROLL) overlayLenis = new Lenis(SMOOTH_SCROLL);

    if (overlayLenis) {
      overlayLenis.on('scroll', ScrollTrigger.update);
      overlayTickerFn = (time) => { if (overlayLenis) overlayLenis.raf(time * 1000); };
      gsap.ticker.add(overlayTickerFn);
      gsap.ticker.lagSmoothing(0);
    }

    // Parallax: images drift up inside their cropped container
    gsap.registerPlugin(ScrollTrigger);
    overlayInner.querySelectorAll('.media-cell img, .media-cell video').forEach(el => {
      const st = gsap.fromTo(el, {
        yPercent: -5,
      }, {
        yPercent: 5,
        ease: 'none',
        scrollTrigger: {
          trigger: el.parentElement,
          start: 'top bottom',
          end: 'bottom top',
          scrub: true,
        }
      });
      overlayScrollTriggers.push(st.scrollTrigger || ScrollTrigger.getAll().pop());
    });
  }

  function cleanupOverlayParallax() {
    if (overlayTickerFn) {
      gsap.ticker.remove(overlayTickerFn);
      overlayTickerFn = null;
    }
    if (overlayLenis) {
      overlayLenis.destroy();
      overlayLenis = null;
      // Lenis can re-add its marker classes from a timer just after being
      // destroyed; clear them once it is truly gone so the page's own CSS
      // scroll behaviour comes back.
      setTimeout(() => {
        if (!overlayLenis && !window.pageLenis) {
          document.documentElement.classList.remove('lenis', 'lenis-smooth', 'lenis-scrolling', 'lenis-stopped');
        }
      }, 700);
    }
    overlayScrollTriggers.forEach(st => st && st.kill());
    overlayScrollTriggers = [];
    if (typeof ScrollTrigger !== 'undefined') ScrollTrigger.getAll().forEach(st => st.kill());
  }

  // Teardown callbacks registered by whatever view is currently in the
  // overlay (scroll listeners, observers). Run on every open and close.
  const viewCleanups = [];

  function cleanupOverlay() {
    cleanupOverlayParallax();
    viewCleanups.splice(0).forEach(fn => fn());
    // Disconnect old observer
    if (currentOverlayObs) {
      currentOverlayObs.disconnect();
      currentOverlayObs = null;
    }
    // Pause and destroy all videos
    overlayInner.querySelectorAll('video').forEach(vid => {
      vid.pause();
      vid.removeAttribute('src');
    });
    overlayInner.innerHTML = '';
  }

  // ---- Project view --------------------------------------------------------
  // The markup comes from project-template.js (shared with the static
  // work/<id>.html pages); this file fills it in and brings it to life.
  const { isVideo, posterOf } = window.ProjectTemplate;

  // A static project page (work/<id>.html) names its project here. The view
  // is then the whole page: there is nothing underneath to return to, so
  // Close goes to the Work page and Next is an ordinary link.
  const STANDALONE = window.PROJECT_PAGE || null;
  const projectUrl = id => 'work/' + id + '.html';

  function projectViewHTML(projId) {
    return window.ProjectTemplate.html(window.projects, projId, { linkFor: projectUrl });
  }

  function wireProjectView(nextId) {
    const scrollToY = (y, duration) => {
      const lenis = viewLenis();
      if (lenis) lenis.scrollTo(y, { duration });
      else window.scrollTo({ top: y, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    };

    // in the site the next project opens in place; on a static page the link
    // simply navigates to that project's own page
    if (!STANDALONE) {
      overlayInner.querySelector('.pv-next').addEventListener('click', (e) => {
        e.preventDefault();
        openProject(nextId, { replace: true });
      });
    }
    overlayInner.querySelector('.pv-top').addEventListener('click', () => scrollToY(0, 1.2));

    // The stacked labels are a section index: click one to glide to its row.
    const labels = overlayInner.querySelectorAll('.pv-body > .pv-label');
    const cells = overlayInner.querySelectorAll('.pv-body > .pv-cell');
    const gallery = overlayInner.querySelector('.pv-cell[data-row="gallery"]');
    const progress = overlayInner.querySelector('.pv-progress');
    const progressPct = progress.querySelector('span');
    const cellTop = c => c.getBoundingClientRect().top;
    // The gallery's label has "arrived" once it is pinned in the pile of
    // labels, i.e. the gallery has started sliding up past it. Where the
    // labels don't stick (phones), once it is near the top of the screen.
    const galleryLabel = gallery ? gallery.previousElementSibling : null;
    const galleryLabelArrived = () => {
      const cs = getComputedStyle(galleryLabel);
      if (cs.position !== 'sticky') return cellTop(galleryLabel) <= 72;
      return cellTop(galleryLabel) - cellTop(gallery) > parseFloat(cs.marginTop) + 0.5;
    };
    labels.forEach((label, i) => {
      label.querySelector('.pv-jump').addEventListener('click', () => {
        scrollToY(window.scrollY + cellTop(cells[i]) + 1, 1.1);
      });
    });

    // One scroll handler keeps three things in step with the scroll position:
    // the active label, the progress read, and gallery (dark) mode. Scroll
    // events are already delivered at most once per frame.
    const onScroll = () => {
      // While the lightbox has the page pinned, its scroll position reads 0
      // and the sticky labels let go, so everything below would be judged
      // wrongly (dark mode switched off behind the lightbox, then a white
      // flash as it came back on close). Keep the state as it was.
      if (scrollLockCount > 0) return;
      const h = window.innerHeight;
      let active = 0;
      cells.forEach((c, i) => { if (cellTop(c) <= h * 0.45) active = i; });
      labels.forEach((l, i) => l.classList.toggle('is-active', i === active));

      const range = document.documentElement.scrollHeight - h;
      const p = range > 0 ? Math.min(1, Math.max(0, window.scrollY / range)) : 0;
      progress.style.setProperty('--p', p.toFixed(4));
      progressPct.textContent = Math.round(p * 100) + '%';

      // lights down once the gallery's label has reached the top of the screen
      const dark = !!galleryLabel && galleryLabelArrived();
      if (dark !== document.body.classList.contains('project-dark')) {
        document.body.classList.toggle('project-dark', dark);
        setThemeColor(dark ? '#0d0d0f' : pageBg());
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    viewCleanups.push(() => window.removeEventListener('scroll', onScroll));
    onScroll();

    // Media rises into place the first time it scrolls into view.
    const revealObs = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        revealObs.unobserve(entry.target);
      });
    }, { threshold: 0.08 });
    overlayInner.querySelectorAll('.pv-reveal').forEach(el => revealObs.observe(el));

    // Gallery images start downloading about a screen before they are needed.
    const lazyObs = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.src = entry.target.dataset.src;
        lazyObs.unobserve(entry.target);
      });
    }, { rootMargin: '100% 0px' });
    overlayInner.querySelectorAll('img[data-src]').forEach(img => lazyObs.observe(img));

    viewCleanups.push(() => { revealObs.disconnect(); lazyObs.disconnect(); });
  }

  // ---- Deep links + back button --------------------------------------------
  // An open project lives in the URL as #project=<id>, so it can be shared
  // and the browser's back button closes it instead of leaving the site.
  const projectInHash = () => {
    const m = location.hash.match(/project=([\w-]+)/);
    return m ? m[1] : null;
  };
  function recordOpenInHistory(projId, replace) {
    if (STANDALONE) return;                         // the page's own URL already says it
    const current = projectInHash();
    if (current === projId) return;                 // came from the URL or back/forward
    // moving between projects replaces the entry, so one "back" always closes
    const push = !current && !replace;
    const pushed = push || !!(history.state && history.state.pushed);
    history[push ? 'pushState' : 'replaceState']({ project: projId, pushed }, '', '#project=' + projId);
  }
  function recordCloseInHistory(y) {
    if (!projectInHash()) return;
    if (history.state && history.state.pushed) {
      pendingScrollY = y;              // re-applied after the browser's own scroll restoration
      history.back();                  // popstate has nothing left to close
    }
    else history.replaceState(null, '', location.pathname + location.search);
  }

  // ---- Open / close ---------------------------------------------------------
  let currentProjectId = null;
  let pageMeta = null;        // the host page's title / og tags, restored on close
  let focusBeforeOpen = null;
  const metaTag = prop => document.querySelector(`meta[property="og:${prop}"]`);
  const setMeta = (prop, value) => { const el = metaTag(prop); if (el) el.content = value; };

  function openProject(projId, opts) {
    const proj = window.projects && window.projects[projId];
    if (!proj) return;
    // The Lab is a page of its own, not a project.
    if (projId === 'lab') {
      if (!/lab\.html$/.test(location.pathname)) location.href = 'lab.html';
      return;
    }
    const wasOpen = overlay.classList.contains('open');

    // Must happen before the page is scroll-locked: the browser remembers the
    // page's scroll position for the history entry at this moment, and
    // restores it when "back" closes the project.
    recordOpenInHistory(projId, opts && opts.replace);

    cleanupOverlay();

    if (!wasOpen) {
      focusBeforeOpen = document.activeElement;
      pageMeta = {
        title: document.title,
        ogTitle: (metaTag('title') || {}).content,
        ogDesc: (metaTag('description') || {}).content,
        ogImg: (metaTag('image') || {}).content,
      };
      pageScrollY = window.scrollY;
    }
    document.body.classList.add('project-page');   // hides the rest of the page (overlay.css)
    document.body.classList.remove('project-dark');
    overlay.classList.add('open');                  // in the layout before anything is measured

    const view = projectViewHTML(projId);
    overlayInner.innerHTML = view.html;
    wireProjectView(view.nextId);

    // Videos load when they near the viewport, play while visible, pause after.
    currentOverlayObs = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const vid = entry.target;
        if (entry.isIntersecting) {
          if (!vid.src && vid.dataset.src) vid.src = vid.dataset.src;
          vid.play().catch(() => {});
        } else {
          vid.pause();
        }
      });
    }, { rootMargin: '200px' });
    // On phones only the hero clip plays in the page. Each gallery clip keeps
    // its poster (tap it and the lightbox plays it): several clips decoding
    // at once is what drains a phone.
    const autoplaying = coarsePointer.matches ? '.pv-hero video[data-src]' : 'video[data-src]';
    overlayInner.querySelectorAll(autoplaying).forEach(vid => currentOverlayObs.observe(vid));

    // Every piece of media opens the lightbox at its own index.
    lightboxItems = proj.images;
    lbIsLab = false;
    overlayInner.querySelectorAll('.media-cell img, .media-cell video').forEach((el) => {
      const idx = proj.images.indexOf(el.getAttribute('src') || el.dataset.src);
      // passing the cell lets the lightbox grow the picture out of it
      el.addEventListener('click', () => openLightbox(idx >= 0 ? idx : 0, el.closest('.media-cell')));
    });

    overlay.setAttribute('role', 'region');
    overlay.setAttribute('aria-label', proj.name);
    overlayClose.classList.add('visible');
    document.body.classList.add('project-open');
    jumpTo(0);
    // move focus to Close for keyboard users only; after a mouse or touch
    // open it would just draw a focus ring around the button
    if (!STANDALONE && keyboardUser) overlayClose.focus({ preventScroll: true });
    setThemeColor(pageBg());

    // Page meta for sharing (a static project page already carries its own)
    if (!STANDALONE) {
      document.title = proj.name + ' — Luka Grčar';
      setMeta('title', proj.name + ' — Luka Grčar');
      setMeta('description', (proj.desc && proj.desc[0]) ? proj.desc[0].substring(0, 160) : 'Portfolio of Luka Grčar');
      setMeta('image', 'https://lukagrcar.com/' + posterOf(proj.images[0]));
    }

    currentProjectId = projId;

    // Init smooth scroll + parallax after DOM settles
    requestAnimationFrame(() => initOverlayParallax());
  }

  // `fromHistory` is true only when the browser's back/forward triggered the
  // close (the URL has already changed then). Used as an event handler too,
  // in which case the argument is an event and counts as false.
  function closeOverlay(fromHistory) {
    if (!overlay.classList.contains('open')) return;
    if (STANDALONE) { location.href = 'grid.html'; return; }
    // e.g. the back button pressed with a picture open: don't leave the
    // lightbox hanging over the page the project is about to hand back
    if (lightbox.classList.contains('open')) { closeLightbox(); endFlight(); }
    overlayClose.style.display = 'none';
    cleanupOverlay();
    overlay.classList.remove('open');
    overlayClose.classList.remove('visible');
    const y = pageScrollY;   // where the host page was
    document.body.classList.remove('project-open', 'project-page', 'project-dark');
    currentProjectId = null;
    // Always fully clear the body-fixed state. If `scrollLockCount` drifted
    // (e.g. lightbox/mobile-list flows nested on top) a counter decrement is
    // not enough — the body would stay `position: fixed; top: -Ypx` and
    // touch-event coordinates would register offset, making the bar
    // dropdowns' lower items unreachable.
    scrollLockCount = 0;
    lockIsSoft = false;
    document.documentElement.style.overflow = '';
    document.body.classList.remove('scroll-locked');
    document.body.style.cssText = '';
    syncSmoothScroll(y);
    window.scrollTo({ top: y, behavior: 'instant' });

    if (pageMeta) {
      document.title = pageMeta.title;
      if (pageMeta.ogTitle != null) setMeta('title', pageMeta.ogTitle);
      if (pageMeta.ogDesc != null) setMeta('description', pageMeta.ogDesc);
      if (pageMeta.ogImg != null) setMeta('image', pageMeta.ogImg);
      pageMeta = null;
    }
    restoreThemeColor();
    if (focusBeforeOpen && focusBeforeOpen.focus) focusBeforeOpen.focus({ preventScroll: true });
    focusBeforeOpen = null;
    setTimeout(() => { overlayClose.style.display = ''; }, 500);

    if (fromHistory !== true) recordCloseInHistory(y);
  }

  // Back / forward: follow the URL.
  let pendingScrollY = null;
  window.addEventListener('popstate', () => {
    if (STANDALONE) return;
    if (pendingScrollY != null) {
      const y = pendingScrollY;
      pendingScrollY = null;
      requestAnimationFrame(() => window.scrollTo({ top: y, behavior: 'instant' }));
    }
    const id = projectInHash();
    if (id && window.projects && window.projects[id]) {
      if (id !== currentProjectId) openProject(id);
    } else {
      closeOverlay(true);
    }
  });
  // A static project page opens its project at once (re-rendering the same
  // markup it shipped with, now interactive). Elsewhere, a deep link
  // <page>#project=<id> opens that project on load.
  // (deferred a tick: the lightbox state further down this file has to be
  // set up before a project can open)
  if (STANDALONE) setTimeout(() => openProject(STANDALONE), 0);
  else if (projectInHash()) setTimeout(() => openProject(projectInHash()), 100);

  overlayClose.addEventListener('click', closeOverlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeOverlay();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (lightbox.classList.contains('open')) closeLightbox();
      else if (mobileProjList.classList.contains('open')) closeMobileList();
      else if (overlay.classList.contains('open')) closeOverlay();
    }
  });

  // ========== MOBILE PROJECT LIST ==========
  function openMobileProjectList() {
    const projects = window.projects;
    const activeFilters = window.activeFilters || { project: null };
    mobileProjScroll.innerHTML = '';

    // "All" option
    const allItem = document.createElement('div');
    allItem.className = 'mobile-proj-item' + (activeFilters.project === null ? ' active' : '');
    allItem.innerHTML = '<div class="mobile-proj-item-inner"><div class="mobile-proj-name">All Projects</div></div>';
    allItem.addEventListener('click', () => {
      if (typeof window.setFilter === 'function') window.setFilter('project', null);
      const af = window.activeFilters;
      if (af) af.project = null;
      if (typeof window.applyFilters === 'function') window.applyFilters();
      closeMobileList();
    });
    mobileProjScroll.appendChild(allItem);

    const projIds = Object.keys(projects);
    projIds.forEach(id => {
      const proj = projects[id];
      const item = document.createElement('div');
      item.className = 'mobile-proj-item';
      item.dataset.projId = id;
      if (activeFilters.project === id) item.classList.add('active');

      const inner = document.createElement('div');
      inner.className = 'mobile-proj-item-inner';

      const name = document.createElement('div');
      name.className = 'mobile-proj-name';
      name.textContent = proj.name;
      inner.appendChild(name);

      if (proj.year) {
        const year = document.createElement('div');
        year.className = 'mobile-proj-year';
        year.textContent = proj.year;
        inner.appendChild(year);
      }

      item.appendChild(inner);
      item.addEventListener('click', () => {
        if (typeof window.setFilter === 'function') window.setFilter('project', id);
        closeMobileList();
      });

      mobileProjScroll.appendChild(item);
    });

    // Add spacers top/bottom so first/last can center
    const topSpacer = document.createElement('div');
    topSpacer.className = 'mobile-proj-spacer';
    mobileProjScroll.prepend(topSpacer);
    const bottomSpacer = document.createElement('div');
    bottomSpacer.className = 'mobile-proj-spacer';
    mobileProjScroll.appendChild(bottomSpacer);

    mobileProjList.classList.add('open');
    lockScroll();

    // Scroll to active item
    requestAnimationFrame(() => {
      const active = mobileProjScroll.querySelector('.active');
      if (active) active.scrollIntoView({ block: 'center', behavior: 'instant' });
      updateCenterItem();
    });
  }

  // Single scroll listener for project picker
  let pickerTick = false;
  mobileProjScroll.addEventListener('scroll', () => {
    if (!pickerTick) {
      requestAnimationFrame(() => {
        updateCenterItem();
        pickerTick = false;
      });
      pickerTick = true;
    }
  }, { passive: true });

  let currentBgProjId = null;

  function updateCenterItem() {
    const projects = window.projects;
    const items = mobileProjScroll.querySelectorAll('.mobile-proj-item');
    const scrollRect = mobileProjScroll.getBoundingClientRect();
    const center = scrollRect.top + scrollRect.height / 2;
    let closest = null;
    let closestDist = Infinity;

    items.forEach(item => {
      const rect = item.getBoundingClientRect();
      const itemCenter = rect.top + rect.height / 2;
      const dist = Math.abs(itemCenter - center);
      item.classList.remove('center');
      if (dist < closestDist) {
        closestDist = dist;
        closest = item;
      }
    });

    if (closest) {
      closest.classList.add('center');
      const projId = closest.dataset.projId;
      if (projId && projId !== currentBgProjId && projects[projId]) {
        currentBgProjId = projId;
        const proj = projects[projId];
        const firstSrc = proj.images[0];
        const isVid = firstSrc.endsWith('.webm') || firstSrc.endsWith('.mp4');
        const src = isVid ? firstSrc.replace(/\.(webm|mp4)$/, '_thumb.webp') : firstSrc;
        const mobileSrcFinal = isMobile ? src.replace('Images/', 'Images/mobile/') : src;
        mobileProjBg.innerHTML = `<img src="${mobileSrcFinal}" alt="" />`;
        mobileProjBg.classList.add('visible');
      } else if (!projId) {
        mobileProjBg.classList.remove('visible');
        currentBgProjId = null;
      }
    }
  }

  function closeMobileList() {
    mobileProjList.classList.remove('open');
    unlockScroll();
  }

  mobileProjClose.addEventListener('click', closeMobileList);

  // ========== LIGHTBOX ==========
  let lightboxItems = [];
  let lightboxIndex = 0;
  let lbFrameRAF = null;
  let lbDirection = 'init';
  let lbIsLab = false;

  function drawHistogram(source, canvas) {
    try {
      const ctx = canvas.getContext('2d');
      const w = canvas.width, h = canvas.height;

      // Sample source to small canvas
      const tmp = document.createElement('canvas');
      tmp.width = 100; tmp.height = 100;
      const tctx = tmp.getContext('2d', { willReadFrequently: true });
      tctx.drawImage(source, 0, 0, 100, 100);
      const data = tctx.getImageData(0, 0, 100, 100).data;

      // Build RGB histograms
      const rHist = new Uint32Array(256);
      const gHist = new Uint32Array(256);
      const bHist = new Uint32Array(256);

      for (let i = 0; i < data.length; i += 4) {
        rHist[data[i]]++;
        gHist[data[i + 1]]++;
        bHist[data[i + 2]]++;
      }

      // Find max for scaling
      let max = 1;
      for (let i = 0; i < 256; i++) {
        max = Math.max(max, rHist[i], gHist[i], bHist[i]);
      }

      // Draw
      ctx.clearRect(0, 0, w, h);
      const barW = w / 256;

      // Draw each channel
      function drawChannel(hist, color) {
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let i = 0; i < 256; i++) {
          const x = i * barW;
          const barH = (hist[i] / max) * h;
          ctx.lineTo(x, h - barH);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
      }

      ctx.globalCompositeOperation = 'screen';
      drawChannel(rHist, 'rgba(255,60,60,0.6)');
      drawChannel(gHist, 'rgba(60,255,60,0.6)');
      drawChannel(bHist, 'rgba(60,60,255,0.6)');
      ctx.globalCompositeOperation = 'source-over';
    } catch (e) {
      // canvas tainted — skip
    }
  }

  function buildLightboxStrip() {
    lightboxStrip.innerHTML = '';
    lightboxItems.forEach((src, i) => {
      const isVid = src.endsWith('.webm') || src.endsWith('.mp4');
      const thumbSrc = isVid ? src.replace(/\.(webm|mp4)$/, '_thumb.webp') : src;
      const item = document.createElement('div');
      item.className = 'lightbox-strip-item' + (i === lightboxIndex ? ' active' : '') + (isVid ? ' is-film' : '');
      item.innerHTML = `<img src="${thumbSrc}" alt="" />`;
      item.addEventListener('click', () => lbGo(i, i > lightboxIndex ? 1 : -1));
      lightboxStrip.appendChild(item);
    });
  }

  function updateStripActive() {
    const items = lightboxStrip.querySelectorAll('.lightbox-strip-item');
    items.forEach((item, i) => {
      item.classList.toggle('active', i === lightboxIndex);
    });
    // while a finger is scrubbing the strip, don't pull it back to centre
    const active = lightboxStrip.querySelector('.active');
    if (active && !stripScrubbing) active.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }

  // ---- Strip scrubbing (touch) ----------------------------------------------
  // Like the Photos app on a phone: swipe the thumbnail strip and whichever
  // thumbnail sits under its centre becomes the picture on screen. Momentum
  // after the finger lifts keeps scrubbing; when it settles the strip snaps
  // the current thumbnail to the centre.
  let stripScrubbing = false;
  let stripTouching = false;
  let stripIdleTimer = 0;
  let stripRenderedAt = 0;

  lightboxStrip.addEventListener('touchstart', () => {
    stripScrubbing = stripTouching = true;
    clearTimeout(stripIdleTimer);
  }, { passive: true });
  const stripTouchEnd = () => {
    stripTouching = false;
    clearTimeout(stripIdleTimer);
    stripIdleTimer = setTimeout(settleStrip, 160);
  };
  lightboxStrip.addEventListener('touchend', stripTouchEnd, { passive: true });
  lightboxStrip.addEventListener('touchcancel', stripTouchEnd, { passive: true });

  function settleStrip() {
    if (stripTouching) return;
    stripScrubbing = false;
    renderLightbox();          // full render of where we landed (also re-centres)
  }

  lightboxStrip.addEventListener('scroll', () => {
    if (!stripScrubbing) return;
    const box = lightboxStrip.getBoundingClientRect();
    const mid = box.left + box.width / 2;
    let best = lightboxIndex, bestDist = Infinity;
    lightboxStrip.querySelectorAll('.lightbox-strip-item').forEach((item, i) => {
      const r = item.getBoundingClientRect();
      const dist = Math.abs(r.left + r.width / 2 - mid);
      if (dist < bestDist) { bestDist = dist; best = i; }
    });
    if (best !== lightboxIndex) {
      lightboxIndex = best;
      lbDirection = 'init';   // no slide animation while scrubbing
      // swapping the big picture is the costly part: at most ~10 times a second
      const now = performance.now();
      if (now - stripRenderedAt > 90) { stripRenderedAt = now; renderLightbox(); }
      else updateStripActive();
    }
    clearTimeout(stripIdleTimer);
    stripIdleTimer = setTimeout(settleStrip, 160);
  }, { passive: true });

  // ---- Lightbox zoom transition --------------------------------------------
  // Opening from a gallery cell: a stand-in picture lifts out of the cell,
  // moves to the centre and un-crops to full size while the lightbox fades in
  // behind it. Closing runs it backwards, into the cell of whichever picture
  // is showing (if that cell is on screen).
  //
  // The stand-in (.lb-fly) is laid out once, at the picture's final lightbox
  // rect, and only its `transform` and `clip-path` are animated, so the motion
  // stays on the compositor. Its "in the cell" pose is computed from where the
  // real picture is actually drawn in the cell (cover crop, parallax scale and
  // offset included), so both ends line up exactly and nothing pops.
  const ZOOM = { duration: 480, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' };
  // Opening: the move and the un-crop run as two web animations on the
  // stand-in (the page is locked, so nothing moves under them).
  function fling(fly, from, to) {
    const clip = fly.animate([{ clipPath: from.clipPath }, { clipPath: to.clipPath }], ZOOM);
    const anim = fly.animate([{ transform: from.transform }, { transform: to.transform }], ZOOM);
    return { anim, clip };
  }
  // the same curve as ZOOM.easing, as a function (ease-out quint)
  const easeOut = (t) => 1 - Math.pow(1 - t, 5);
  const FULL_POSE = { transform: 'translate(0px, 0px) scale(1)', clipPath: 'inset(0px 0px 0px 0px round 0px)' };
  // The flight in progress, if any: { fly, media, src, full, ar }, plus
  // { anim, clip } while opening or { pose } (where it has got to) while closing.
  // There is only ever one; a new one takes over from or replaces the old.
  let flight = null;

  function cellFor(index) {
    const src = lightboxItems[index];
    for (const el of overlayInner.querySelectorAll('.media-cell img, .media-cell video')) {
      if (el.dataset.src === src || el.getAttribute('src') === src) return el.parentElement;
    }
    return null;
  }
  const onScreen = (r) => r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
  const aspectOf = (el) => {
    const w = el && (el.naturalWidth || el.videoWidth), h = el && (el.naturalHeight || el.videoHeight);
    return w && h ? w / h : 0;
  };

  // The rect the picture itself occupies inside its lightbox element (a
  // full-width box with the picture `contain`ed in it), or null if unknown.
  function containedRect(el) {
    const box = el.getBoundingClientRect();
    const ar = aspectOf(el);
    if (!ar || !box.width || !box.height) return null;
    const w = box.width / box.height > ar ? box.height * ar : box.width;
    const h = w / ar;
    return { left: box.left + (box.width - w) / 2, top: box.top + (box.height - h) / 2, width: w, height: h };
  }
  // The same rect worked out from the lightbox's layout rules (.lightbox-content
  // in overlay.css: full width, at most the screen minus 180px tall, sitting
  // 120px above centre-bottom), for when the big picture hasn't loaded yet.
  function expectedRect(ar) {
    const box = lightbox.getBoundingClientRect();
    let w = box.width, h = w / ar;
    const maxH = box.height - 180;
    if (h > maxH) { h = maxH; w = h * ar; }
    return { left: box.left + (box.width - w) / 2, top: box.top + (box.height - (h + 120)) / 2, width: w, height: h };
  }

  // The pose (transform + clip) that makes a stand-in laid out at `full`
  // coincide with the picture as it is drawn inside `cell` right now.
  function cellPose(cell, full, ar) {
    const media = cell.querySelector('img, video');
    const c = cell.getBoundingClientRect();
    const m = media.getBoundingClientRect();              // includes parallax scale + offset
    // the picture covers the media box
    const w = m.width / m.height > ar ? m.width : m.height * ar;
    const h = w / ar;
    const left = m.left + (m.width - w) / 2, top = m.top + (m.height - h) / 2;
    const k = w / full.width;
    const dx = left + w / 2 - (full.left + full.width / 2);
    const dy = top + h / 2 - (full.top + full.height / 2);
    const inset = [c.top - top, left + w - c.right, top + h - c.bottom, c.left - left].map(v => Math.max(0, v / k));
    const radius = (parseFloat(getComputedStyle(cell).borderTopLeftRadius) || 0) / k;
    return poseStyle({ dx, dy, k, inset, radius });
  }
  // A pose as numbers (dx, dy, k, inset[4], radius) and as the two CSS values
  // that draw it. The numbers ride along on the style object.
  function poseStyle(n) {
    return {
      n,
      transform: `translate(${n.dx}px, ${n.dy}px) scale(${n.k})`,
      clipPath: `inset(${n.inset.map(v => v + 'px').join(' ')} round ${n.radius}px)`,
    };
  }
  const FULL_N = { dx: 0, dy: 0, k: 1, inset: [0, 0, 0, 0], radius: 0 };
  const mixPose = (a, b, t) => ({
    dx: a.dx + (b.dx - a.dx) * t, dy: a.dy + (b.dy - a.dy) * t, k: a.k + (b.k - a.k) * t,
    inset: a.inset.map((v, i) => v + (b.inset[i] - v) * t), radius: a.radius + (b.radius - a.radius) * t,
  });
  const poseOk = (n) => [n.dx, n.dy, n.k, n.radius, ...n.inset].every(Number.isFinite) && n.k > 0;
  // Where a stand-in is right now, read back from how it is being drawn
  // (used to turn an opening flight around part-way).
  function poseOf(fly) {
    const cs = getComputedStyle(fly);
    const m = (cs.transform.match(/matrix\(([^)]+)\)/) || [, '1,0,0,1,0,0'])[1].split(',').map(parseFloat);
    const clip = cs.clipPath.match(/inset\(([^)]*)\)/);
    let inset = [0, 0, 0, 0], radius = 0;
    if (clip) {
      const [sides, round] = clip[1].split('round');
      const v = sides.trim().split(/\s+/).map(parseFloat);
      // CSS shorthand: 1, 2, 3 or 4 values
      inset = [v[0], v.length > 1 ? v[1] : v[0], v.length > 2 ? v[2] : v[0], v.length > 3 ? v[3] : (v.length > 1 ? v[1] : v[0])];
      radius = round ? parseFloat(round) || 0 : 0;
    }
    const n = { dx: m[4], dy: m[5], k: m[0], inset, radius };
    return poseOk(n) ? n : FULL_N;
  }

  function makeFlyer(src, rect, pose) {
    const fly = document.createElement('div');
    fly.className = 'lb-fly';
    fly.innerHTML = `<img src="${posterOf(src)}" alt="" />`;
    // Positioned in page coordinates (relative to <body>, which is where the
    // page's scroll offset lives whether or not it is locked), so if the page
    // scrolls mid-flight the stand-in travels with the gallery.
    const page = document.body.getBoundingClientRect();
    Object.assign(fly.style, {
      left: rect.left - page.left + 'px', top: rect.top - page.top + 'px',
      width: rect.width + 'px', height: rect.height + 'px',
      transform: pose.transform, clipPath: pose.clipPath,
    });
    document.body.appendChild(fly);
    // where it was laid out, and where the page stood then (see zoomOut)
    fly.home = { rect, page };
    return fly;
  }

  // Drop the current flight where it stands and put its cell back to normal.
  function endFlight() {
    if (!flight) return;
    if (flight.anim) flight.anim.cancel();
    if (flight.clip) flight.clip.cancel();
    flight.media.style.visibility = '';
    flight.fly.remove();
    flight = null;
  }

  function zoomIn(cell) {
    endFlight();
    const media = cell.querySelector('img, video');
    const real = lightboxContent.querySelector('img, video');
    const ar = aspectOf(media) || aspectOf(real);
    if (!ar || !real) return;                              // nothing to measure: plain fade
    const src = lightboxItems[lightboxIndex];
    const full = containedRect(real) || expectedRect(ar);
    const from = cellPose(cell, full, ar);
    const fly = makeFlyer(src, full, from);
    const { anim, clip } = fling(fly, from, FULL_POSE);
    const mine = flight = { fly, media, anim, clip, src, full, ar };
    media.style.visibility = 'hidden';
    lightboxContent.style.visibility = 'hidden';

    // swap to the real picture only once the flight is over AND it can paint
    const ready = real.tagName === 'IMG'
      ? real.decode().catch(() => {})
      : new Promise(res => (real.readyState >= 2 ? res() : real.addEventListener('loadeddata', res, { once: true })));
    const patience = new Promise(res => setTimeout(res, ZOOM.duration + 1500));
    Promise.all([anim.finished, Promise.race([ready, patience])]).then(() => {
      if (flight !== mine) return;                         // closed or replaced meanwhile
      flight = null;
      media.style.visibility = '';
      lightboxContent.style.visibility = '';
      requestAnimationFrame(() => fly.remove());           // one frame of overlap: no gap
    }, () => { /* cancelled: whoever cancelled it cleaned up */ });
  }

  // `full` is where the picture was in the lightbox, measured before closing.
  // Returns false when there is nothing sensible to fly to.
  //
  // Closing is steered by hand, one frame at a time, instead of handed to the
  // browser as an animation. While the picture flies back the page is free to
  // scroll, and the gallery's parallax keeps sliding the picture inside its
  // cell; a landing spot measured once at the start would be stale by the
  // end, and the picture would jump as the real one takes over. So every
  // frame the cell is measured again and the stand-in is drawn part-way
  // between where it started and where the cell is now. (Re-aiming a browser
  // animation every frame does the same on paper, but can leave it waiting
  // to start for ever, with the cell's own picture hidden.)
  function zoomOut(cell, src, full, ar) {
    // Closed while still flying: carry on with that same stand-in from
    // wherever it has got to, rather than starting a second one.
    const turning = flight && flight.src === src ? flight : null;
    if (turning) { full = turning.full; ar = turning.ar; }
    if (!full || !ar || !onScreen(cell.getBoundingClientRect())) return false;

    const media = cell.querySelector('img, video');
    let fly, start = FULL_N;
    if (turning) {
      fly = turning.fly;
      start = turning.pose || poseOf(fly);
      // freeze it where it is, then let go of whatever was moving it
      const frozen = poseStyle(start);
      fly.style.transform = frozen.transform;
      fly.style.clipPath = frozen.clipPath;
      if (turning.anim) turning.anim.cancel();
      if (turning.clip) turning.clip.cancel();
      if (turning.media !== media) turning.media.style.visibility = '';
      flight = null;
    } else {
      endFlight();
      fly = makeFlyer(src, full, FULL_POSE);
    }
    const mine = flight = { fly, media, src, full, ar, pose: start };
    media.style.visibility = 'hidden';

    const { rect, page } = fly.home;           // where it was laid out, and where the page stood then
    let target = null;
    const aim = () => {
      if (!cell.isConnected) return;
      try {
        const now = document.body.getBoundingClientRect();
        const pose = cellPose(cell, {
          left: rect.left + now.left - page.left, top: rect.top + now.top - page.top,
          width: rect.width, height: rect.height,
        }, ar).n;
        // a cell that is hidden or has no size measures as nonsense: keep the last good aim
        if (poseOk(pose)) target = pose;
      } catch (err) { /* keep the last good aim */ }
    };
    const land = () => {
      if (flight !== mine) return;
      flight = null;
      // the cell's own picture never left, it was only hidden: swap in the same frame
      media.style.visibility = '';
      fly.remove();
      if (!lightbox.classList.contains('open')) lightbox.classList.remove('lb-zoom');
    };
    const t0 = performance.now();
    const step = (now) => {
      if (flight !== mine) return;                        // closed, reopened or replaced meanwhile
      aim();
      if (!target) { land(); return; }                    // nowhere to go: just put the picture back
      const t = Math.min((now - t0) / ZOOM.duration, 1);
      mine.pose = mixPose(start, target, easeOut(t));
      const drawn = poseStyle(mine.pose);
      fly.style.transform = drawn.transform;
      fly.style.clipPath = drawn.clipPath;
      if (t < 1) requestAnimationFrame(step);
      else land();
    };
    requestAnimationFrame(step);
    return true;
  }

  // The gallery cell the current lightbox picture can fly back into, if any.
  // Touch devices skip the flight altogether: the lightbox simply fades and
  // settles in (see "lbSettle" in overlay.css), which is lighter and smoother
  // on a phone.
  function zoomTarget() {
    if (!overlay.classList.contains('open') || reducedMotion.matches || coarsePointer.matches) return null;
    const cell = cellFor(lightboxIndex);
    return cell && onScreen(cell.getBoundingClientRect()) ? cell : null;
  }

  let lbCloseRun = 0;

  function openLightbox(index, fromCell) {
    lightboxIndex = index;
    lbDirection = 'init';
    const zoom = !!fromCell && !reducedMotion.matches && !coarsePointer.matches
      && onScreen(fromCell.getBoundingClientRect());
    lightbox.classList.toggle('lb-zoom', zoom);   // no slide-in animation under the stand-in
    lbCloseRun++;                                 // cancels a pending teardown from a close
    buildLightboxStrip();
    renderLightbox();
    lightbox.classList.add('open');
    // Lock first: hiding the scrollbar can nudge the layout, and the zoom has
    // to measure the cell where it ends up.
    lockScroll();
    if (zoom) zoomIn(fromCell);
  }

  function closeLightbox() {
    if (!lightbox.classList.contains('open')) return;
    lbSettleNow();                               // a slide still in flight lands first
    const src = lightboxItems[lightboxIndex];
    const real = lightboxContent.querySelector('img, video');
    const full = real && containedRect(real);   // measured before it is torn down
    const ar = aspectOf(real);
    // It can only fly back if there is a cell on screen AND the picture's
    // place and shape are known (or it is still flying and carries them).
    // Otherwise it fades out with the lightbox, picture and all.
    const target = zoomTarget();
    const cell = target && ((flight && flight.src === src) || (full && ar)) ? target : null;
    lightbox.classList.toggle('lb-zoom', !!cell);

    lightbox.classList.remove('open');
    if (cell) {
      // the stand-in takes over at once, so the real picture can go now
      lightboxContent.innerHTML = '';
      lightboxContent.style.visibility = '';
    } else {
      // plain close: leave the picture in place while the lightbox fades out
      // (0.3s in overlay.css), then clear it
      if (real && real.tagName === 'VIDEO') real.pause();
      const run = ++lbCloseRun;
      setTimeout(() => {
        if (run !== lbCloseRun || lightbox.classList.contains('open')) return;
        lightboxContent.innerHTML = '';
        lightboxContent.style.visibility = '';
      }, 320);
    }
    if (lbFrameRAF) cancelAnimationFrame(lbFrameRAF);
    lbFrameRAF = null;
    unlockScroll();

    // Fly the picture back into its gallery cell. Measured only now: the page
    // is unlocked and back in its normal layout.
    if (!(cell && zoomOut(cell, src, full, ar))) {
      endFlight();
      lightbox.classList.remove('lb-zoom');
    }
    lbPoseReset();
  }

  function renderLightbox() {
    lbPoseReset();                               // a new picture starts unzoomed
    // Pause any playing video before switching
    const oldVid = lightboxContent.querySelector('video');
    if (oldVid) { oldVid.pause(); oldVid.removeAttribute('src'); }

    // Bounds check
    if (lightboxIndex < 0) lightboxIndex = 0;
    if (lightboxIndex >= lightboxItems.length) lightboxIndex = lightboxItems.length - 1;

    const src = lightboxItems[lightboxIndex];
    const isVid = src.endsWith('.webm') || src.endsWith('.mp4');
    lightboxContent.className = 'lightbox-content slide-' + lbDirection;
    if (isVid) {
      // the poster shows while the clip loads, and stands in for it on a
      // phone that can't play the format
      lightboxContent.innerHTML = `<video src="${src}" poster="${posterOf(src)}" style="background:url('${posterOf(src)}') center / contain no-repeat" autoplay muted loop playsinline></video>`;
    } else {
      lightboxContent.innerHTML = `<img src="${src}" alt="" />`;
    }
    lightboxCounter.textContent = `${lightboxIndex + 1} / ${lightboxItems.length}`;

    updateStripActive();

    // File info + histogram — only for Lab
    const info = document.getElementById('lightboxInfo');
    const histCanvas = document.getElementById('lightboxHistogram');
    if (lbFrameRAF) cancelAnimationFrame(lbFrameRAF);

    if (!lbIsLab) {
      info.style.display = 'none';
      histCanvas.style.display = 'none';
      return;
    }

    info.style.display = '';
    histCanvas.style.display = '';
    const filename = src.split('/').pop();
    const ext = filename.split('.').pop().toUpperCase();
    const folder = src.split('/').slice(-2, -1)[0] || '';
    const isVidFile = ext === 'WEBM' || ext === 'MP4';
    info.innerHTML = `${filename}<br>${ext} ${isVidFile ? '· VIDEO' : '· IMAGE'}<br>${folder}`;

    if (isVidFile) {
      const vid = lightboxContent.querySelector('video');
      if (vid) {
        const fps = 24;
        function updateFrameCount() {
          const current = Math.floor(vid.currentTime * fps);
          const total = Math.floor((vid.duration || 0) * fps);
          info.innerHTML = `${filename}<br>${ext} · VIDEO<br>${folder}<br>F ${current} / ${total}`;
          lbFrameRAF = requestAnimationFrame(updateFrameCount);
        }
        vid.addEventListener('loadeddata', updateFrameCount, { once: true });
        if (vid.readyState >= 2) updateFrameCount();
      }
    }

    if (!isVidFile) {
      const imgEl = lightboxContent.querySelector('img');
      if (imgEl) {
        const drawHist = () => drawHistogram(imgEl, histCanvas);
        if (imgEl.complete) drawHist();
        else imgEl.addEventListener('load', drawHist, { once: true });
      }
    } else {
      const vid = lightboxContent.querySelector('video');
      if (vid) {
        vid.addEventListener('loadeddata', () => drawHistogram(vid, histCanvas), { once: true });
      }
    }
  }

  document.getElementById('lightboxClose').addEventListener('click', closeLightbox);

  // ---- Lightbox gestures ------------------------------------------------------
  // The picture is handled the way a phone's photo app handles it:
  // - drag sideways and it follows the finger while the next (or previous)
  //   picture comes in beside it; let go past a fifth of the screen, or with
  //   a flick, and the new one slides into place, otherwise it springs back.
  //   At either end of the set it resists and springs back.
  // - pinch to zoom in (up to 4x), drag to move around while zoomed, and
  //   double-tap to zoom in on a spot or back out.
  // - drag down to put the picture away.
  // A mouse can drag sideways and double-click to zoom. The arrows, the
  // keys, the wheel and the thumbnails use the same slide (lbGo).
  //
  // How it is built: #lightboxContent always holds the picture that is
  // "current" (the rest of this file measures it there). The neighbour that
  // slides in is a stand-in laid over the same spot (.lb-peek); when a slide
  // lands, the index changes, the real picture is rendered in place, and the
  // stand-in stays on top until the real one can paint, so nothing blinks.
  const LB_GAP = 24;                      // px between two pictures while sliding
  const LB_MAX_ZOOM = 4;
  const lbPose = { s: 1, x: 0, y: 0 };    // zoom and offset of the current picture
  let lbPeek = null;                      // { el, dir, index }: the neighbour being dragged in
  let lbHold = null;                      // a landed stand-in waiting for the real picture
  let lbPending = null;                   // finishes the slide or spring-back in progress, now
  let lbPendingTimer = 0;
  let lbGesture = null;                   // the touch or mouse gesture in progress
  let lbLastTap = null;                   // { t, x, y } of the last tap, for double-tap

  const lbMedia = () => lightboxContent.querySelector('img, video');
  const lbWidth = () => lightbox.clientWidth + LB_GAP;
  const lbClamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  // past a limit the picture still moves, but only a third as far
  const lbRubber = (v, max) => (Math.abs(v) <= max ? v : Math.sign(v) * (max + (Math.abs(v) - max) * 0.33));

  // "Swipe down to close" hint behind the content
  const lbSwipeHint = document.createElement('div');
  lbSwipeHint.className = 'lb-swipe-hint';
  lbSwipeHint.innerHTML = '<span>↓</span> Swipe to close';
  lightbox.appendChild(lbSwipeHint);

  // -- zoom ------------------------------------------------------------------
  function lbApplyPose(animate) {
    const m = lbMedia();
    if (!m) return;
    const plain = lbPose.s === 1 && !lbPose.x && !lbPose.y;
    m.style.animation = 'none';          // the slide-in animation would otherwise keep its last frame on top
    m.style.transition = animate ? 'transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)' : 'none';
    m.style.transform = plain ? 'none' : `translate3d(${lbPose.x}px, ${lbPose.y}px, 0) scale(${lbPose.s})`;
    lightbox.classList.toggle('lb-zoomed', lbPose.s > 1.01);
  }
  function lbPoseReset() {
    lbPose.s = 1; lbPose.x = 0; lbPose.y = 0;
    lightbox.classList.remove('lb-zoomed');
  }
  // the picture's own size on screen at 1x (its box is wider than the picture when it is letterboxed)
  function lbBaseSize(m) {
    const bw = m.offsetWidth || 1, bh = m.offsetHeight || 1;
    const ar = aspectOf(m) || bw / bh;
    const w = bw / bh > ar ? bh * ar : bw;
    return { w, h: w / ar };
  }
  // where the picture's centre sits when it is not moved
  function lbCentre(m) {
    const r = m.getBoundingClientRect();
    return { x: r.left + r.width / 2 - lbPose.x, y: r.top + r.height / 2 - lbPose.y };
  }
  // How far the zoomed picture may be moved. Sideways it is symmetric. Up and
  // down it is not: the picture rests above the middle of the screen (the
  // thumbnails sit under it), so zoomed in it is allowed down far enough to
  // fill the screen, or to sit in the middle of it if it is still shorter.
  function lbLimits(m, s) {
    const base = lbBaseSize(m);
    const H = lightbox.clientHeight, half = base.h * s / 2, cy = lbCentre(m).y;
    const tall = half * 2 >= H;
    return {
      x: Math.max(0, (base.w * s - lightbox.clientWidth) / 2),
      yMin: tall ? H - half - cy : H / 2 - cy,
      yMax: tall ? half - cy : H / 2 - cy,
    };
  }
  const lbRubberY = (v, lim) => (v < lim.yMin ? lim.yMin - (lim.yMin - v) * 0.33 : v > lim.yMax ? lim.yMax + (v - lim.yMax) * 0.33 : v);
  // bring zoom and offset back inside what is allowed
  function lbSettlePose(animate) {
    const m = lbMedia();
    if (!m) return;
    if (lbPose.s < 1.02) { lbPose.s = 1; lbPose.x = 0; lbPose.y = 0; }
    else {
      lbPose.s = Math.min(lbPose.s, LB_MAX_ZOOM);
      const lim = lbLimits(m, lbPose.s);
      lbPose.x = lbClamp(lbPose.x, -lim.x, lim.x);
      lbPose.y = lbClamp(lbPose.y, lim.yMin, lim.yMax);
    }
    lbApplyPose(animate);
  }
  // zoom to `s` keeping the point (x, y) of the screen under the finger
  function lbZoomAbout(x, y, s, animate) {
    const m = lbMedia();
    if (!m) return;
    const c = lbCentre(m);
    const px = (x - c.x - lbPose.x) / lbPose.s, py = (y - c.y - lbPose.y) / lbPose.s;
    lbPose.s = s;
    lbPose.x = x - c.x - px * s;
    lbPose.y = y - c.y - py * s;
    lbSettlePose(animate);
  }
  function lbToggleZoom(x, y) {
    if (lbPose.s > 1.01) { lbPoseReset(); lbApplyPose(true); }
    else lbZoomAbout(x, y, 2.5, true);
  }

  // -- sliding ---------------------------------------------------------------
  function lbRemovePeek() {
    if (lbPeek) { lbPeek.el.remove(); lbPeek = null; }
  }
  function lbDropHold() {
    if (lbHold) { lbHold.remove(); lbHold = null; }
  }
  function lbMakePeek(index, dir) {
    lbRemovePeek();
    const el = document.createElement('div');
    el.className = 'lightbox-content lb-peek';
    const img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    img.src = posterOf(lightboxItems[index]);
    el.appendChild(img);
    lightbox.appendChild(el);
    lbPeek = { el, dir, index };
  }
  // put the current picture `dx` px off its place, and the stand-in beside it
  function lbSetSlide(dx, ms) {
    const t = ms ? `transform ${ms}ms cubic-bezier(0.22, 1, 0.36, 1)` : 'none';
    lightboxContent.style.transition = t;
    lightboxContent.style.transform = dx ? `translate3d(${dx}px, 0, 0)` : 'none';
    if (lbPeek) {
      lbPeek.el.style.transition = t;
      lbPeek.el.style.transform = `translate3d(${dx + lbPeek.dir * lbWidth()}px, 0, 0)`;
    }
  }
  function lbClearSlide() {
    // drop the offset with transitions off first: the stylesheet gives this
    // box a transform transition on touch screens, which would otherwise
    // replay the slide backwards
    lightboxContent.style.transition = 'none';
    lightboxContent.style.transform = '';
    void lightboxContent.offsetWidth;
    lightboxContent.style.transition = '';
    lightboxContent.style.transform = '';
    lightboxContent.style.opacity = '';
  }
  // run `done` after `ms`, or at once if anything needs the slide finished first
  function lbAfter(ms, done) {
    const run = () => {
      if (lbPending !== run) return;
      lbPending = null;
      clearTimeout(lbPendingTimer);
      done();
    };
    lbPending = run;
    lbPendingTimer = setTimeout(run, ms);
  }
  function lbSettleNow() {
    if (lbPending) lbPending();
    lbRemovePeek();
    lbDropHold();
    if (lbGesture) { lbGesture = null; lbSwipeHint.style.opacity = '0'; }
    lbClearSlide();
  }
  // The stand-in for picture `index` (already made, sitting `fromDx` px into
  // its journey) slides the rest of the way in, then becomes the real picture.
  function lbCommit(index, dir, fromDx, speed) {
    const left = lbWidth() - Math.abs(fromDx);
    // a flick finishes at the speed it was thrown; a slow release takes its time
    const ms = Math.round(lbClamp(left / Math.max(Math.abs(speed), 1.4), 150, 340));
    lbSetSlide(-dir * lbWidth(), ms);
    lbAfter(ms + 20, () => {
      const peek = lbPeek;
      lbPeek = null;
      lightboxIndex = index;
      lbDirection = 'none';                        // rendered in place: the slide was the animation
      lbClearSlide();
      renderLightbox();
      if (!peek) return;
      // The stand-in now lies exactly over the real picture. Keep it there
      // until the real one can paint, so there is no blank frame between.
      peek.el.style.transition = 'none';
      peek.el.style.transform = 'none';
      lbHold = peek.el;
      const real = lbMedia();
      const ready = !real ? Promise.resolve()
        : real.tagName === 'IMG' ? (real.decode ? real.decode().catch(() => {}) : Promise.resolve())
        : new Promise(res => (real.readyState >= 2 ? res() : real.addEventListener('loadeddata', res, { once: true })));
      const patience = new Promise(res => setTimeout(res, 1200));
      Promise.race([ready, patience]).then(() => requestAnimationFrame(() => {
        if (lbHold === peek.el) lbHold = null;
        peek.el.remove();
      }));
    });
  }
  // Step to picture `index` with a slide (dir: 1 = it comes from the right).
  // Used by the arrows, the keys, the wheel and the thumbnails; wraps round.
  function lbGo(index, dir) {
    const n = lightboxItems.length;
    if (!n) return;
    lbSettleNow();
    index = ((index % n) + n) % n;
    if (index === lightboxIndex) return;
    if (reducedMotion.matches || !lightbox.classList.contains('open')) {
      lightboxIndex = index;
      lbDirection = 'none';
      renderLightbox();
      return;
    }
    lbPoseReset();
    lbApplyPose(false);
    lbMakePeek(index, dir);
    lbSetSlide(0, 0);
    void lightbox.offsetWidth;                     // the stand-in must be drawn at its start before it moves
    lbCommit(index, dir, 0, 0);
  }

  // -- one finger, or the mouse ----------------------------------------------
  function lbBegin(x, y, kind) {
    lbSettleNow();
    const m = lbMedia();
    if (m) m.style.animation = 'none';
    lbGesture = { mode: 'pending', kind, x0: x, y0: y, t0: performance.now(), lastX: x, lastT: performance.now(), vx: 0, px: lbPose.x, py: lbPose.y, eff: 0, dy: 0, want: 0, target: -1 };
  }
  function lbMove(x, y) {
    const g = lbGesture;
    if (!g || g.mode === 'pinch' || g.mode === 'ignore') return;
    const dx = x - g.x0, dy = y - g.y0;
    const now = performance.now();
    if (now > g.lastT) {
      g.vx = 0.6 * g.vx + 0.4 * ((x - g.lastX) / (now - g.lastT));   // px per ms, smoothed
      g.lastX = x; g.lastT = now;
    }
    if (g.mode === 'pending') {
      if (Math.hypot(dx, dy) < 8) return;                            // still a tap
      if (lbPose.s > 1.01) g.mode = 'pan';
      else if (Math.abs(dx) > Math.abs(dy)) g.mode = 'slide';
      else if (dy > 0 && g.kind === 'touch') g.mode = 'dismiss';
      else { g.mode = 'ignore'; return; }
      if (g.mode === 'dismiss') lightboxContent.style.transition = 'none';
    }
    if (g.mode === 'pan') {
      const m = lbMedia();
      if (!m) return;
      const lim = lbLimits(m, lbPose.s);
      lbPose.x = lbRubber(g.px + dx, lim.x);
      lbPose.y = lbRubberY(g.py + dy, lim);
      lbApplyPose(false);
    } else if (g.mode === 'slide') {
      const want = dx < 0 ? 1 : -1;                                  // 1: the next picture comes from the right
      const target = lightboxIndex + want;
      const exists = target >= 0 && target < lightboxItems.length;
      if (exists) { if (!lbPeek || lbPeek.index !== target) lbMakePeek(target, want); }
      else lbRemovePeek();
      g.want = want;
      g.target = exists ? target : -1;
      g.eff = exists ? dx : dx * 0.3;                                // nothing that way: resist
      lbSetSlide(g.eff, 0);
    } else if (g.mode === 'dismiss') {
      g.dy = Math.max(0, dy);
      const progress = Math.min(g.dy / 200, 1);
      lightboxContent.style.transform = `translate3d(0, ${g.dy}px, 0) scale(${1 - progress * 0.1})`;
      lightboxContent.style.opacity = String(1 - progress * 0.3);
      lbSwipeHint.style.opacity = String(progress);
    }
  }
  function lbEnd(x, y) {
    const g = lbGesture;
    lbGesture = null;
    if (!g) return;
    if (g.mode === 'pending') {
      // a tap: two close together zoom in on that spot, or back out
      const now = performance.now();
      if (g.kind === 'touch' && lbLastTap && now - lbLastTap.t < 320 && Math.hypot(x - lbLastTap.x, y - lbLastTap.y) < 36) {
        lbLastTap = null;
        lbToggleZoom(x, y);
      } else lbLastTap = { t: now, x, y };
      return;
    }
    if (g.mode === 'pan' || g.mode === 'pinch') { lbSettlePose(true); return; }
    if (g.mode === 'slide') {
      const w = lightbox.clientWidth;
      const flick = Math.abs(g.vx) > 0.4 && Math.sign(g.vx) === -g.want;   // thrown the way it was dragged
      const far = Math.abs(g.eff) > w * 0.2 && Math.sign(g.eff) === -g.want;
      if (g.target >= 0 && lbPeek && lbPeek.index === g.target && (flick || far)) {
        lbCommit(g.target, g.want, g.eff, g.vx);
      } else {
        lbSetSlide(0, 260);                                          // spring back
        lbAfter(280, () => { lbRemovePeek(); lbClearSlide(); });
      }
      return;
    }
    if (g.mode === 'dismiss') {
      lbSwipeHint.style.opacity = '0';
      if (g.dy > 100 && zoomTarget()) {
        // let go far enough down: the picture flies from where the finger
        // left it straight back into its gallery cell
        closeLightbox();
        lbClearSlide();
      } else if (g.dy > 100) {
        lightboxContent.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
        lightboxContent.style.transform = 'translate3d(0, 100vh, 0) scale(0.8)';
        lightboxContent.style.opacity = '0';
        lbAfter(300, () => {
          closeLightbox();
          lightboxContent.innerHTML = '';   // already swiped away: don't let it show again during the fade
          lbClearSlide();
        });
      } else {
        lightboxContent.style.transition = 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s ease';
        lightboxContent.style.transform = 'none';
        lightboxContent.style.opacity = '';
        lbAfter(300, lbClearSlide);
      }
    }
  }

  // -- two fingers -----------------------------------------------------------
  const lbSpread = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const lbMid = (t) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
  function lbPinchBegin(touches) {
    lbSettleNow();
    const m = lbMedia();
    if (!m) return;
    m.style.animation = 'none';
    const c = lbCentre(m), f = lbMid(touches);
    lbGesture = {
      mode: 'pinch', kind: 'touch', d0: lbSpread(touches) || 1, s0: lbPose.s, c,
      px: (f.x - c.x - lbPose.x) / lbPose.s, py: (f.y - c.y - lbPose.y) / lbPose.s,   // the spot under the fingers
    };
  }
  function lbPinchMove(touches) {
    const g = lbGesture;
    let s = g.s0 * lbSpread(touches) / g.d0;
    // it gives a little beyond the limits, and settles back on release
    if (s < 1) s = 1 - (1 - s) * 0.5;
    if (s > LB_MAX_ZOOM) s = LB_MAX_ZOOM + (s - LB_MAX_ZOOM) * 0.3;
    const f = lbMid(touches);
    lbPose.s = s;
    lbPose.x = f.x - g.c.x - g.px * s;
    lbPose.y = f.y - g.c.y - g.py * s;
    lbApplyPose(false);
  }

  // -- wiring ----------------------------------------------------------------
  // Touches are taken anywhere on the lightbox, not only on the picture: the
  // picture is off to one side while a slide lands, and the next swipe must
  // still count. The thumbnails, arrows and close button keep their own.
  const lbOwnsTouch = (e) => !e.target.closest('.lightbox-bottom, .lightbox-close, .lightbox-info, .lightbox-histogram');
  let lbTouchAt = 0;                      // when a finger last touched, to tell real double-clicks from double-taps
  lightbox.addEventListener('touchstart', (e) => {
    if (!lightbox.classList.contains('open') || !lbOwnsTouch(e)) return;
    lbTouchAt = performance.now();
    if (e.touches.length >= 2) lbPinchBegin(e.touches);
    else lbBegin(e.touches[0].clientX, e.touches[0].clientY, 'touch');
  }, { passive: true });
  lightbox.addEventListener('touchmove', (e) => {
    if (!lbGesture) return;
    if (e.cancelable) e.preventDefault();          // the gesture is ours: no page scroll or browser zoom
    if (e.touches.length >= 2) {
      if (lbGesture.mode !== 'pinch') lbPinchBegin(e.touches);   // a second finger joined
      if (lbGesture && lbGesture.mode === 'pinch') lbPinchMove(e.touches);
    } else if (lbGesture.mode !== 'pinch') {
      lbMove(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, { passive: false });
  lightbox.addEventListener('touchend', (e) => {
    lbTouchAt = performance.now();
    if (!lbGesture) return;
    if (e.touches.length === 0) {
      const t = e.changedTouches[0];
      lbEnd(t.clientX, t.clientY);
    } else if (lbGesture.mode === 'pinch' && e.touches.length === 1) {
      // one finger lifted out of a pinch: tidy the zoom, and let the finger
      // that is still down carry on as a drag
      lbSettlePose(true);
      lbGesture = null;
      lbBegin(e.touches[0].clientX, e.touches[0].clientY, 'touch');
    }
  }, { passive: true });
  lightbox.addEventListener('touchcancel', () => {
    if (!lbGesture) return;
    const zooming = lbGesture.mode === 'pan' || lbGesture.mode === 'pinch';
    lbSettleNow();
    if (zooming) lbSettlePose(true);
  }, { passive: true });

  // mouse: drag sideways to slide (or to move around when zoomed), double-click to zoom
  lightboxContent.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || !lightbox.classList.contains('open')) return;
    lbBegin(e.clientX, e.clientY, 'mouse');
    try { lightboxContent.setPointerCapture(e.pointerId); } catch (err) { /* released already */ }
  });
  lightboxContent.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse' && lbGesture && lbGesture.kind === 'mouse') lbMove(e.clientX, e.clientY);
  });
  const lbMouseUp = (e) => {
    if (e.pointerType === 'mouse' && lbGesture && lbGesture.kind === 'mouse') lbEnd(e.clientX, e.clientY);
  };
  lightboxContent.addEventListener('pointerup', lbMouseUp);
  lightboxContent.addEventListener('pointercancel', lbMouseUp);
  lightboxContent.addEventListener('dblclick', (e) => {
    if (performance.now() - lbTouchAt < 700) return;      // a double-tap, already handled as touches
    if (lightbox.classList.contains('open')) lbToggleZoom(e.clientX, e.clientY);
  });
  lightboxContent.addEventListener('dragstart', (e) => e.preventDefault());   // no ghost image when dragging a picture

  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) closeLightbox();
  });

  // Mouse wheel navigation in lightbox
  // A wheel or trackpad gesture sends a burst of events; step one picture
  // per burst instead of re-rendering the big picture for every event.
  let lbWheelAt = 0;
  lightbox.addEventListener('wheel', (e) => {
    if (!lightbox.classList.contains('open')) return;
    e.preventDefault();
    const now = performance.now();
    if (Math.abs(e.deltaY) < 4 || now - lbWheelAt < 280) return;
    lbWheelAt = now;
    lbGo(lightboxIndex + (e.deltaY > 0 ? 1 : -1), e.deltaY > 0 ? 1 : -1);
  }, { passive: false });

  document.getElementById('lightboxPrev').addEventListener('click', () => lbGo(lightboxIndex - 1, -1));
  document.getElementById('lightboxNext').addEventListener('click', () => lbGo(lightboxIndex + 1, 1));

  document.addEventListener('keydown', (e) => {
    if (!lightbox.classList.contains('open')) return;
    if (e.key === 'ArrowRight') lbGo(lightboxIndex + 1, 1);
    if (e.key === 'ArrowLeft') lbGo(lightboxIndex - 1, -1);
  });

  // ---- Expose API ---------------------------------------------------------
  window.openProject = openProject;
  window.closeOverlay = closeOverlay;
  window.openLightbox = openLightbox;
  window.closeLightbox = closeLightbox;
  window.openMobileProjectList = openMobileProjectList;
  window.setLightboxItems = function (items, isLab) {
    lightboxItems = items || [];
    lbIsLab = !!isLab;
  };
  window._overlayLockScroll = lockScroll;
  window._overlayUnlockScroll = unlockScroll;
})();
