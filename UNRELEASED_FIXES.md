# Fixes since the last release

The running log of bugs found and fixed after the last tag. Every fix goes in here the moment it is made (see `CLAUDE.md`), so that
it can be copied into `CHANGELOG.md` and the release notes when the next version ships, and so that there is a record of what was
wrong and why. When a version is released, its entries move into the changelog and this list starts again.

Entry format: the changelog's own (`![fix][fix] **What was wrong, in the user's words.** What now happens.`), written as one person
("I"), never "we". Under each entry, a line for the maintainer: `Cause:` and `Where:` (and `Test:` if one covers it).

Last release in the changelog: **v0.37.2**.

## New

![new][new] **Four more clean-up tools have a card, with a drawing that explains them.** Remove fillets, Remove thickness, Remove lettering and logos and Fill solid round (the make-solid command of Round parts) join the cards on the home and features pages, and their docs pages show the same drawing at the top. Each tells it in one beat: what is wrong lights up in the card's colour and goes, and the result is drawn in as one bright line (a round corner becomes a sharp one, a pipe's two rings become one, raised marks leave a flat plate, a gear's outline becomes a solid disc).
- Where: `tools/site/build-app-site.js` (the four drawings after `art-stack` in `tileArt`, `starArt`'s order and colours), `tools/site/app-entry.js` (`site.cleanup.more`), `site/site.css` (`art-old`; the result uses the existing `art-m-draw`). They use the same line, tokens and keyframe grammar as the other cards. The Round parts docs page shows the Fill solid round drawing; Fill round grooves and Belt have no card.
- Test: drawn at six points of the cycle in headless Chrome; every docs page has its drawing, a click on a card opens its page, no console errors. Not checked in Safari or Firefox, and not read by someone who has not seen the tools.

## Fixed

![fix][fix] **Remove lettering sat on one part of an engine for minutes (Engine_V8-XT-11_1_000345__geom_029, with a rise of 20 mm and a size of 1000 mm).** It now finishes that run in well under a second on the same model: the search that tells whether a small body lies in the part gave the same four bodies before and after, in 0.35 s instead of 26 s (measured in Node on the 1508 parts of Scania-Engine-V8-XT-Turbo.glb).
- Cause: how far a vertex stands out of a part was found by scanning a cube of grid cells whose side grows with the rise (limit 100 mm over cells of a few mm: tens of thousands of cells per vertex, and the Select similar-style candidates are every small part inside the selected one), with no stop once the nearest surface was found and no stop at the edge of the grid.
- Where: `app/js/emboss.js` (`distanceTo`: rings from the nearest cell outwards, stops when the best distance is closer than the next ring, and at the grid's edge); `emboss.js?v=8`, `mesh-worker.js?v=88`.
- Test: `node tests/emboss.test.mjs` passes; measured as above. Not yet run again in the app itself, so the app's own time for that run is not measured after the fix.

![new][new] **A running task shows as a small tab standing on the status bar.** While anything runs, its name and how far it is appear on a tab that rises from the bar above the Tasks ring, in the bar's own colour with round corners on top and a concave round where it meets the bar. A click on it opens the list of tasks above it. The ring stays in the bar; the text that used to sit beside it is on the tab. The tab slides in and is gone when nothing runs.
- Where: `app/js/app.js` (`renderBg`, `placeTab`, `openPop`), `app/index.html` (`#sb-bg-tab`).
- Test: syntax check only; not yet looked at in the browser (the tab's place and the concave corners are the things to look at).

![fix][fix] **The "closed unexpectedly" card squeezed its text into a column one word wide, with the buttons running out of the card.** The text now has the card's width and the buttons sit in a row under it, wrapping to a second row when they do not fit.
- Cause: the text and the buttons were side by side, and the buttons (which do not wrap) took all the room.
- Where: `app/index.html` (`#mo-recover`, `.mr-actions`).
- Test: not run; CSS read only, not yet looked at in the browser.

![fix][fix] **The Remove lettering and logos drawing showed a plain plate, with bars that did not read as lettering.** It now shows a raised M in the site's serif (Fraunces, weight 400) standing on the plate; the M lights up and goes.
- Cause: the drawing used six bars and a ring as stand-ins for lettering.
- Where: `tools/site/build-app-site.js` (`art-mark` in `tileArt`; the M outline is read from `site/fonts/fraunces-latin.woff2`, curves flattened, and drawn as an extruded isometric outline). The pages are regenerated.
- Test: drawn once in headless Chrome and looked at; not checked at the card's own size or in Safari or Firefox.

![fix][fix] **The number of a slider in the right sidebar sat inside the bar (Select similar, and the other bars there).** The number is in its own box beside the bar again, with the name inside the bar at its left.
- Cause: the sidebar rules for the fill-bar slider floated the number box over the bar with no border or background.
- Where: `app/index.html` (the `#sidebar-right .scrub.scrub-bar` block: the `.scrub-rhs`, `.scrub-row` and `.scrub-head` overrides are gone, so the shared bar rules apply); the bar and its number box are round on every corner, not square where they meet: `--bar-r-in` is now `var(--bar-r)`, which also rounds the same joint on the other bar rows and the Animate speed field).
- Test: not run; checked by reading the CSS only, not yet looked at in the browser.

![fix][fix] **The cards could not be clicked, only their small "Read more" link could.** The whole card is now the link to its page, as the hover fill suggests. The carousel's "Read more" no longer slides up 4 px as it fades in (a moved link cannot be stretched over the card); a drag in the carousel still does not open a page.
- Cause: only the "Read more" link was a link; the picture and text were not part of it.
- Where: `site/site.css` (`:is(.clip, .star):not(.kb-anim)`, `.fcar-stars .star figcaption .clip-more`).
- Test: a click on the picture of the Fasteners and the Voxel remesh cards opens `docs/fasteners.html` and `docs/voxel-remesh.html`; a drag was not tried.

![fix][fix] **The rings in the middle of the gears (Select hidden parts) and on the holes (Remove holes) were wobbly, thick at the sides and thin on top.** They were circles inside an isometric group, and a 1 px stroke under that shear is uneven. They are now drawn straight in screen space (ellipses and a projected gear outline), and the gears still spin, as 12 drawn frames each (2.5 degrees apart, one visible at a time; 12 teeth make the picture repeat every 30 degrees, so the loop has no seam), because a turning group needs the shear. The gears had three near-identical rings at the centre; they have two.
- Cause: a non-scaling stroke inside a sheared group.
- Where: `tools/site/build-app-site.js` (`isoGear`, the `art-hole` rings, the `art-hidden` drawing), `site/site.css` (`.art-gf`, `art-gframe`).
- Test: seen at 4x in headless Chrome; the visible frame was sampled while the card was on screen and advances 0 to 11 and round. Not compared with the old spin by eye side by side, and not tried with reduced motion (the first frame stays). The other drawings that use `rotate()` (Smart fit) were not changed: a plain rotation keeps the line even.

![fix][fix] **The drawings on the website's feature cards were drawn with lines of different weights, some with glows and filled shapes.** The twelve cards (Remove holes, Select hidden parts, Fasteners, Smart fit, Split, Smart optimise, Remove floating pieces, Remove hidden faces, Triangulation, Delete small parts, Repair mesh, Stacked copies) are now drawn with one line: 1 px on screen at any card size, round ends and joins, no coloured glow, no filled shapes, no see-through lines. Before, the lines measured from 0.7 to 1.9 px depending on the drawing and its size. A hole that closes is now a ring that turns bright and goes, a cut face is an outline, found parts go from the dim line to the bright one, and the dotted guide is the same dot on every card. The hex nuts on the Delete small parts card, whose edges were drawn on the wrong corners, are now proper nuts: a hexagon top with its hole, the front faces only, a solid outline, a little larger. The Fasteners bracket is drawn the same way as the one on Remove floating pieces (it had an extra dim line from its back edges running across the plate). On Triangulation the mesh no longer has lines that run exactly vertical, which lined up with the block's corner edges and looked doubled, and its side faces are cut into as many strips as the top has cells along the same edge. The five claim tiles at the top of the home page are unchanged. On the docs page of each function the picture at the top no longer floods with colour under the pointer: it is a picture there, not a card (`.kb-anim` takes no pointer events).
- Cause: the stroke was in the drawing's own units, so every card's scale, and the extra scale of the drawings that are enlarged to fill the card, changed its width; some parts set their own width (1, 1.2, 1.7 px); glows came from `drop-shadow` in nine keyframes, fills from the closing holes and the cut face, and dimming from `opacity`.
- Where: `site/site.css` (`:is(.clip, .star) .clip-art` and its `--art-sw`, the `art-close`, `art-snap0` to `art-snap4`, `art-find`, `art-edge`, `art-m-small`, `art-found` and `art-dense2` keyframes, `.art-hole`, `.art-face`, `.art-found`, `.art-shell-dash`), `tools/site/build-app-site.js` (the holes drawing, the Smart optimise mesh now 28 by 12 lines instead of 36 by 14, `CSS_V` 525).
- Test: measured in headless Chrome on the built home page: every path of the twelve drawings computes to 1 px with `vector-effect: non-scaling-stroke`, at rest and at four points of the cycle; hover (the card fills with its colour, lines go black) checked on three cards at 2x. Not checked in Safari or Firefox, where `pathLength` with a non-scaling stroke was not tried. The docs pages that carry the same drawings were rebuilt, not looked at one by one.

## Found, not fixed yet

- **`e2e-uv-split` fails "the toolbar is at the foot of the pane, under the layout"**: in the pane the tool pill (Select, Move, Rotate, Scale, the pick modes) lies over the foot of the layout, not under it. 65 of 66 checks pass. Not from the colouring fix; the pane (`uv-split.js`, `#uv-pane`) is another session's unreleased work. Found 2026-10-24.
  Where: `tests/e2e-uv-split.mjs`, the layout of `#uv-pane` in `app/index.html`.

- **Other places still swap a part's geometry on their own.** Reduce (`decimate-card.js`) does not refresh the CAD lines of the part (`_cadEdgesPartSwapped`), clear the old edge buffers or free the old name; Bake frees no old name; Remove holes keeps one geometry for parts that share a shape, so it cannot use the per-part routine as it is; about 25 places in `app.js` have their own copy. Whether the missing steps leave stale CAD lines after Reduce on a part with its lines shown has not been tried.
  Where: `_swapPartGeometry` (the model), `app/js/decimate-card.js`, `app/js/bake-card.js`.

- **`e2e-round-card` fails its last-but-one check, "and say why"**: it expects "This step is no longer the last one" after Apply, Ctrl+Z and a change of Segments around, but `round-card.js` now clears the card's step on undo (the card goes back to Apply, uncommitted work of another session), so the options build nothing and say nothing. The test needs the new behaviour. Found 2026-10-24.
  Where: `tests/e2e-round-card.mjs` (line 203), `app/js/round-card.js` (the undo handler).

- **ASCII FBX still leaves the pictures out** (the export dialog now says so beside the switch; the binary FBX, the default, carries them). Blender cannot read ASCII FBX at all, and no reader that can was at hand to try pictures against, so
  the writer was not extended. Where: `_exportFbxAscii` in `app/js/export-writers.js`. Found 2026-10-23.

- **Blender marks an OBJ's normal map as sRGB** instead of Non-Color (its OBJ importer does it whatever the .mtl says; it reads
  `map_Bump`, not `norm`), which bends the normals a little. The FBX's comes in as Non-Color. Nothing to do in the .mtl.

- **`e2e-edit-sheet` gives different results from run to run since the three.js r186 upgrade**: the sheet's dots seen from the front or
  the back, and the picked edges, are counted as not drawn in some runs (the dark pixels with the dots on equal those with them off). The
  same with three-mesh-bvh 0.8.3 and 0.9.16, so it is the rendering of the marks, not the picking. On 2026-10-23 its screenshots showed
  the dots drawn from both sides, with the "Preparing the view" loader still over the middle of the view where the test counts (see the
  12-second settle entry above): the count is spoiled, not the dots. Run again on 2026-10-24, after the settle change above: `e2e-edit-sheet` 7 of 7 and `e2e-edit-ortho-switch` 6 of 6 in one run each, so the loader no longer covers the view; one run is not enough to call it stable, so the entry stays until it has held for a few more.

- **`e2e-isolate` on the Gearbox, seed 4242, fails at its eighth step on a busy machine**: after a second scene tab is opened and the
  first one switched back to, the first shows no parts for the moment the test looks. It passed 84/84 on 19cbd3f, and passes for
  another session on the same checkout as it fails here; seed 618581 failed at the same step earlier and passed alone. Timing under
  load (several sessions running headless Chrome at once), not seen by hand: a probe that waits after the load saw all 95 parts at
  every moment after the switch. Not looked into further. On 2026-10-24 it passed 79 of 79 with a random seed (377253) on a quiet machine.
