/* ===================================================================
   project-template.js — the markup of a project view, as one pure
   function of the project data. Used in two places so they can never
   drift apart:

   - in the browser by overlay.js, which renders a project in place;
   - in Node by tools/build-pages.js, which writes the static
     work/<id>.html pages (the same view, already in the HTML, for
     search engines and for sharing).

   Layout: intro (counter · title · fact sheet) → hero → labelled rows
   (brief / challenge / process / result / about / tools / gallery) →
   next project → colophon. Styles: "PROJECT VIEW" in overlay.css.
   =================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ProjectTemplate = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const TOOL_ICONS = {
    'Cinema 4D': 'Images/tools/Cinema4D-Logo-Icon-Small.png',
    'Redshift': 'Images/tools/Redshift-Logo-Icon-Small.png',
    'After Effects': 'Images/tools/after-effects-1.svg',
    'Photoshop': 'Images/tools/adobe-photoshop.svg',
    'InDesign': 'Images/tools/adobe-indesign-cc-icon.svg',
    'Illustrator': 'Images/tools/adobe-illustrator-cc-3.svg',
    'Houdini': 'Images/tools/Houdini3D_icon.png',
    'ZBrush': 'Images/tools/ZBrush-new-logo.jpg 1.png',
    'Substance 3D': 'Images/tools/substance-3d-painter-1.svg',
  };
  // Gallery rhythm: column spans (of 12) per row, cycled.
  const GALLERY_ROWS = [[12], [7, 5], [5, 7], [12], [4, 4, 4], [6, 6]];
  // Optional story rows: add any of these fields to a project in projects.js
  // (a string, or an array of paragraphs) and the row appears.
  const STORY_ROWS = [['challenge', 'Challenge'], ['process', 'Process'], ['result', 'Result']];

  const isVideo = src => /\.(webm|mp4)$/i.test(src);
  const posterOf = src => (isVideo(src) ? src.replace(/\.(webm|mp4)$/i, '_thumb.webp') : src);
  const pad2 = n => String(n).padStart(2, '0');
  const attr = text => String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const paragraphs = value => [].concat(value).map(t => `<p>${t}</p>`).join('');
  const projectIds = projects => Object.keys(projects).filter(id => id !== 'lab');
  const metaLine = p => [(p.category || []).join(', '), p.year].filter(Boolean).join(' · ');
  const altFor = p => attr(`${p.name} — ${(p.category || []).join(', ') || 'project'} by Luka Grčar`);

  // A clip always starts as its poster; overlay.js gives it a source and plays
  // it when it comes into view.
  // The poster is also the clip's background. A phone drops the poster the
  // moment play() is called and shows nothing until the first frame has
  // arrived, which on a slow connection (or where the clip cannot be played
  // at all) is an empty box. The background keeps the picture there.
  const clip = src => `<video data-src="${src}" poster="${posterOf(src)}" style="background:url('${posterOf(src)}') center / cover no-repeat" muted loop playsinline preload="none"></video>`;

  // `prerender` is true for the static pages: pictures carry a real `src`
  // (lazy-loaded natively) so they exist without JavaScript. In the browser
  // they carry `data-src` and overlay.js loads them as they near the screen.
  function media(src, alt, opts) {
    if (isVideo(src)) return clip(src);
    return opts.prerender
      ? `<img src="${src}" alt="${alt}" loading="lazy" decoding="async" />`
      : `<img data-src="${src}" alt="${alt}" decoding="async" />`;
  }

  function galleryHTML(items, alt, opts) {
    const reveal = opts.prerender ? '' : ' pv-reveal';
    let html = '<div class="proj-media-grid pv-grid">';
    for (let i = 0, r = 0; i < items.length; r++) {
      let row = GALLERY_ROWS[r % GALLERY_ROWS.length];
      const left = items.length - i;
      if (left < row.length) row = left === 2 ? [6, 6] : [12];
      for (const span of row) {
        html += `<div class="media-cell${reveal} span-${span}">${media(items[i++], alt, opts)}</div>`;
      }
    }
    return html + '</div>';
  }

  // opts.linkFor(id) → href of another project (default: in-page hash link)
  // opts.prerender   → see media()
  function html(projects, projId, options) {
    const opts = Object.assign({ linkFor: id => '#project=' + id, prerender: false }, options);
    const proj = projects[projId];
    const ids = projectIds(projects);
    const pos = ids.indexOf(projId);
    const nextId = ids[(pos + 1) % ids.length];
    const next = projects[nextId];
    const alt = altFor(proj);
    const reveal = opts.prerender ? '' : ' pv-reveal';

    // each title word sits in a clipping box and rises into it (.pv-word)
    const title = proj.name.split(/\s+/).map((w, i) =>
      `<span class="pv-word"><span style="--i:${i}">${w}</span></span>`).join(' ');

    const facts = [
      ['Client', proj.client], ['Year', proj.year], ['With', proj.collab], ['Location', proj.location],
      ['Theme', proj.theme], ['Type', proj.type], ['Award', proj.award],
    ].filter(f => f[1]).map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');

    // Labelled rows. Each becomes a sticky label + a content cell on one
    // shared grid, which is what lets the labels pile up (see .pv-body).
    const rows = [];
    if (proj.brief) rows.push(['Brief', `<p class="pv-statement">${proj.brief}</p>`]);
    STORY_ROWS.forEach(([field, label]) => {
      if (proj[field]) rows.push([label, `<div class="pv-text">${paragraphs(proj[field])}</div>`]);
    });
    if ((proj.desc && proj.desc.length) || proj.link) {
      const link = proj.link
        ? `<p><a href="${proj.link}" target="_blank" rel="noopener noreferrer">${proj.link} ↗</a></p>` : '';
      rows.push(['About', `<div class="pv-text">${paragraphs(proj.desc || [])}${link}</div>`]);
    }
    if (proj.tools && proj.tools.length) {
      const chips = proj.tools.map(t =>
        `<span>${TOOL_ICONS[t] ? `<img src="${TOOL_ICONS[t]}" alt="" class="tool-icon" />` : ''}${t}</span>`).join('');
      rows.push(['Tools', `<div class="pv-tools">${chips}</div>`]);
    }
    if (proj.images.length > 1) rows.push(['Gallery', galleryHTML(proj.images.slice(1), alt, opts)]);

    const body = rows.map(([label, content], i) =>
      `<h2 class="pv-label" style="--r:${i + 1}"><button type="button" class="pv-jump"><i>${pad2(i + 1)}</i>${label}</button></h2>` +
      `<div class="pv-cell" data-row="${label.toLowerCase()}" style="--r:${i + 1}">${content}</div>`).join('');

    // the hero is on screen as the project opens: loaded straight away
    const hero = isVideo(proj.images[0])
      ? clip(proj.images[0])
      : `<img src="${proj.images[0]}" alt="${alt}" decoding="async" />`;

    return {
      nextId,
      html: `
      <article class="pv">
        <header class="pv-intro">
          <div class="pv-kicker"><span>Project ${pad2(pos + 1)} / ${pad2(ids.length)}</span><span>${(proj.category || []).join(' · ')}</span></div>
          <h1 class="pv-title">${title}</h1>
          ${facts ? `<dl class="pv-facts">${facts}</dl>` : ''}
        </header>

        <div class="media-cell pv-hero${reveal}">${hero}</div>

        <div class="pv-body" style="--n:${rows.length}">
          ${body}
          <div class="pv-progress" aria-hidden="true"><i></i><span>0%</span></div>
        </div>

        <a class="pv-next" href="${opts.linkFor(nextId)}">
          <span class="pv-label">Next project</span>
          <span class="pv-next-card">
            <span class="pv-next-thumb"><img src="${posterOf(next.images[0])}" alt="" loading="lazy" /></span>
            <span class="pv-next-text">
              <span class="pv-next-name">${next.name}</span>
              <span class="pv-next-meta">${metaLine(next)}</span>
            </span>
            <span class="pv-next-arrow" aria-hidden="true">→</span>
          </span>
        </a>
        <div class="pv-colophon">
          <span>&copy; ${proj.year || new Date().getFullYear()} Luka Grčar. All rights reserved. All work shown is original and may not be reproduced without permission.</span>
          <button type="button" class="pv-top">Back to top ↑</button>
        </div>
      </article>`,
    };
  }

  return { html, isVideo, posterOf, projectIds, altFor };
});
