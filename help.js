/* Help: the knowledge base inside the app (F1, or Menu › Help & docs).
 *
 * The articles are the website's (lukagrcar.com/apps/meshoptimiser/docs), copied into help-content.js by
 * tools/build-help.mjs and loaded the first time the window opens, so start-up pays nothing for them and Help
 * works offline. Pictures are the website's and are loaded from there; one that cannot load is left out.
 * The frame of the window is in index.html (#help-modal); this fills it.
 */
(function () {
  'use strict';
  var DATA_URL = 'help-content.js?v=6';
  var LAST_KEY = 'stepopt-help-last';
  var data = null, loading = null, wired = false, current = null, query = '';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var slug = function (s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); };

  // Text in an article may hold `code`, [[Ctrl + K]] for keys, {{Fill holes}} for the name of something in the app,
  // [words](#article) for another article and [words](https://…) for a link out.
  function rich(text) {
    return esc(text)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[\[([^\]]+)\]\]/g, function (_, k) { return k.split(/\s+\+\s+/).map(function (x) { return '<kbd class="kbd-chip">' + x + '</kbd>'; }).join('<span class="sc-plus">+</span>'); })
      .replace(/\{\{([^}]+)\}\}/g, '<span class="hp-ui">$1</span>')
      .replace(/\[([^\]]+)\]\(#([a-z0-9-]+)\)/g, '<a href="#" data-help="$2">$1</a>')
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }
  var byslug = function (s) { return data.articles.filter(function (a) { return a.slug === s; })[0]; };

  // One block of an article: [type, …]  p note h steps list terms keys code img see
  function block(b) {
    var t = b[0], a = b[1], c = b[2];
    switch (t) {
      case 'p': return '<p>' + rich(a) + '</p>';
      case 'h': return '<h3>' + rich(a) + '</h3>';
      case 'note': return '<aside class="hp-note"><p>' + rich(a) + '</p></aside>';
      case 'steps': return '<ol class="hp-steps">' + a.map(function (x) { return '<li>' + rich(x) + '</li>'; }).join('') + '</ol>';
      case 'list': return '<ul class="hp-points">' + a.map(function (x) { return '<li>' + rich(x) + '</li>'; }).join('') + '</ul>';
      case 'terms': return '<dl class="hp-terms">' + a.map(function (p) { return '<div><dt>' + rich(p[0]) + '</dt><dd>' + rich(p[1]) + '</dd></div>'; }).join('') + '</dl>';
      case 'keys': return '<dl class="hp-terms hp-keys">' + a.map(function (p) { return '<div><dt>' + p[0].split(/\s+\+\s+/).map(function (x) { return '<kbd class="kbd-chip">' + esc(x) + '</kbd>'; }).join('<span class="sc-plus">+</span>') + '</dt><dd>' + rich(p[1]) + '</dd></div>'; }).join('') + '</dl>';
      case 'code': return '<div class="hp-code"><code>' + esc(a) + '</code><button type="button" class="btn-sm" data-copy="' + esc(a) + '">Copy</button></div>';
      case 'img': return '<figure class="hp-fig"><img loading="lazy" decoding="async" src="' + esc(data.site + a) + '" alt="' + esc(c || '') + '">' + (c ? '<figcaption>' + rich(c) + '</figcaption>' : '') + '</figure>';
      case 'see': return '<div class="hp-see"><h3>Related</h3><ul>' + a.filter(byslug).map(function (s) { return '<li><a href="#" data-help="' + s + '">' + esc(byslug(s).title) + '</a></li>'; }).join('') + '</ul></div>';
      default: return '';
    }
  }
  // plain text of a block, for the search
  function plain(b) {
    var a = b[1];
    if (typeof a === 'string') return a + (b[2] ? ' ' + b[2] : '');
    if (Array.isArray(a)) return a.map(function (x) { return Array.isArray(x) ? x.join(' ') : x; }).join(' ');
    return '';
  }
  function strip(t) { return String(t).replace(/\[\[|\]\]|\{\{|\}\}|`/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'); }

  function renderNav() {
    var nav = $('hp-nav'); if (!nav) return;
    nav.innerHTML = data.groups.map(function (g) {
      var items = data.articles.filter(function (a) { return a.group === g.id; });
      return '<div class="hp-group">' + esc(g.title) + '</div>' + items.map(function (a) {
        return '<button type="button" class="hp-nav-item' + (current === a.slug ? ' is-on' : '') + '" data-help="' + a.slug + '">' + esc(a.title) + '</button>';
      }).join('');
    }).join('');
  }
  function renderResults(q) {
    var nav = $('hp-nav'); if (!nav) return;
    var terms = q.toLowerCase().split(/\s+/).filter(Boolean), rows = [];
    data.articles.forEach(function (a) {
      var title = a.title.toLowerCase(), sum = strip(a.summary).toLowerCase();
      var body = a.blocks.map(function (b) { return strip(plain(b)); }).join(' \n ');
      var low = body.toLowerCase(), score = 0, ok = true;
      terms.forEach(function (t) {
        var inT = title.indexOf(t) >= 0, inS = sum.indexOf(t) >= 0, inB = low.indexOf(t) >= 0;
        if (!inT && !inS && !inB) ok = false;
        score += (inT ? 10 : 0) + (inS ? 4 : 0) + (inB ? Math.min(5, low.split(t).length - 1) : 0);
      });
      if (!ok) return;
      var at = low.indexOf(terms[0]), snip = '';
      if (at >= 0) { var s = Math.max(0, at - 50); snip = (s ? '…' : '') + body.slice(s, at + 90).replace(/\s+/g, ' ') + '…'; }
      rows.push({ a: a, score: score, snip: snip });
    });
    rows.sort(function (x, y) { return y.score - x.score; });
    nav.innerHTML = rows.length
      ? '<div class="hp-group">' + rows.length + ' result' + (rows.length === 1 ? '' : 's') + '</div>' + rows.slice(0, 40).map(function (r) {
          return '<button type="button" class="hp-result" data-help="' + r.a.slug + '"><b>' + esc(r.a.title) + '</b>' + (r.snip ? '<span>' + esc(r.snip) + '</span>' : '') + '</button>';
        }).join('')
      : '<div class="hp-none">Nothing matches “' + esc(q) + '”.<br>Try fewer or different words.</div>';
  }
  // the words searched for, marked in the article that opens
  function mark(root, terms) {
    if (!terms.length) return;
    var re = new RegExp('(' + terms.map(function (t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|') + ')', 'gi');
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), nodes = [], n;
    while ((n = walker.nextNode())) { if (!n.parentNode.closest('script,style,mark,button') && re.test(n.nodeValue)) nodes.push(n); re.lastIndex = 0; }
    nodes.forEach(function (node) {
      var span = document.createElement('span'); span.innerHTML = esc(node.nodeValue).replace(re, '<mark>$1</mark>'); node.replaceWith.apply(node, Array.prototype.slice.call(span.childNodes));
    });
  }
  function open(slugName) {
    var a = byslug(slugName) || data.articles[0];
    current = a.slug;
    try { localStorage.setItem(LAST_KEY, current); } catch (e) {}
    var g = data.groups.filter(function (x) { return x.id === a.group; })[0], i = data.articles.indexOf(a);
    var prev = data.articles[i - 1], next = data.articles[i + 1];
    var main = $('hp-main');
    main.innerHTML = '<article class="hp-art"><p class="hp-crumb">' + esc(g ? g.title : '') + '</p><h2>' + esc(a.title) + '</h2><p class="hp-sum">' + rich(a.summary) + '</p>' +
      a.blocks.map(block).join('') +
      '<nav class="hp-pager">' + (prev ? '<button type="button" data-help="' + prev.slug + '"><small>Previous</small>' + esc(prev.title) + '</button>' : '<span></span>') + (next ? '<button type="button" data-help="' + next.slug + '" class="hp-next"><small>Next</small>' + esc(next.title) + '</button>' : '<span></span>') + '</nav></article>';
    mark(main, query.toLowerCase().split(/\s+/).filter(Boolean));
    main.scrollTop = 0;
    if (!query) renderNav(); else { var b = $('hp-nav').querySelector('[data-help="' + a.slug + '"]'); $('hp-nav').querySelectorAll('.is-on').forEach(function (x) { x.classList.remove('is-on'); }); if (b) b.classList.add('is-on'); }
    var on = $('hp-nav').querySelector('.hp-nav-item.is-on'); if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
  }
  function loadData() {
    if (data) return Promise.resolve(data);
    if (loading) return loading;
    loading = new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = DATA_URL;
      s.onload = function () { data = window.MOHelpData; data ? res(data) : rej(new Error('empty')); };
      s.onerror = function () { rej(new Error('missing')); };
      document.head.appendChild(s);
    });
    loading.catch(function () { loading = null; });
    return loading;
  }
  function wire() {
    if (wired) return; wired = true;
    var bg = $('help-modal'); if (!bg) return;
    $('help-close').addEventListener('click', hide);
    bg.addEventListener('click', function (e) {
      if (e.target === bg) { hide(); return; }
      var link = e.target.closest('[data-help]');
      if (link) { e.preventDefault(); open(link.getAttribute('data-help')); return; }
      var copy = e.target.closest('[data-copy]');
      if (copy) { try { navigator.clipboard.writeText(copy.getAttribute('data-copy')); copy.textContent = 'Copied'; setTimeout(function () { copy.textContent = 'Copy'; }, 1400); } catch (err) {} }
    });
    $('hp-main').addEventListener('error', function (e) { var f = e.target && e.target.closest && e.target.closest('figure'); if (f) f.hidden = true; }, true);   // a picture that cannot load (offline) is left out
    var search = $('help-search');
    search.addEventListener('input', function () { query = search.value.trim(); if (!query) renderNav(); else renderResults(query); });
    search.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { var first = $('hp-nav').querySelector('.hp-result'); if (first) { e.preventDefault(); open(first.getAttribute('data-help')); } }
    });
    document.addEventListener('keydown', function (e) {
      if (!bg.classList.contains('show')) return;
      var typing = document.activeElement === search;
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        if (search.value) { search.value = ''; query = ''; renderNav(); } else hide();
      } else if (!typing && e.key === '/' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); search.focus(); search.select(); }
    }, true);
  }
  function show(slugName) {
    var bg = $('help-modal'); if (!bg) return;
    wire();
    bg.classList.add('show');
    var main = $('hp-main');
    if (!data) main.innerHTML = '<div class="hp-load">Loading…</div>';
    loadData().then(function () {
      var want = slugName || current || (function () { try { return localStorage.getItem(LAST_KEY); } catch (e) { return null; } })() || 'what-it-is';
      query = ''; $('help-search').value = '';
      open(want);
      setTimeout(function () { if (!slugName) $('help-search').focus(); }, 40);
    }).catch(function () {
      main.innerHTML = '<div class="hp-load">The help pages could not be loaded.<br><a href="https://lukagrcar.com/apps/meshoptimiser/docs.html" target="_blank" rel="noopener">Open them on the website</a></div>';
    });
  }
  function hide() { var bg = $('help-modal'); if (bg) bg.classList.remove('show'); }
  window.MOHelp = { show: show, hide: hide, isOpen: function () { var bg = $('help-modal'); return !!bg && bg.classList.contains('show'); } };
})();
