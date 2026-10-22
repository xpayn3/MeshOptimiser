# Fixes since the last release

The running log of bugs found and fixed after the last tag. Every fix goes in here the moment it is made (see `CLAUDE.md`), so that
it can be copied into `CHANGELOG.md` and the release notes when the next version ships, and so that there is a record of what was
wrong and why. When a version is released, its entries move into the changelog and this list starts again.

Entry format: the changelog's own (`![fix][fix] **What was wrong, in the user's words.** What now happens.`), written as one person
("I"), never "we". Under each entry, a line for the maintainer: `Cause:` and `Where:` (and `Test:` if one covers it).

Last release in the changelog: **v0.36.0**.

## New

- ![new][new] **Round part, Make solid: the axis can be chosen.** Auto (the one the part is roundest round, as before), X, Y or Z, in
  the part's own directions; the outline is then spun round that axis through the middle of the part. A part that is not round
  round any of its own axes is no longer left out of Make solid: it opens with Auto saying why, and an axis can be picked for it.
  Changing the axis drops an edit by hand (it is another profile) and, after Apply, builds the parts again in the same step. Claude
  and the tests pass `axis` to `roundCard` and `roundCardSet`. A row of four in a segmented control now draws its highlight the
  right width (the rule for four was missing).
  Where: `outlineRevolve` in `app/js/revolve.js` (`opts.axis`), `setAxis`, `profileOf` and `open` in `app/js/round-card.js`,
  `#rc-axis-row` and `.cmd-seg` in `index.html`. Test: `e2e-round-card` 26/26 (each axis picked, the profile changes, Auto gives it
  back). Not yet tried by hand on a part that is not round.

- ![polish][polish] **Round part: no readout under the view.** The list of axis, grooves filled, segments around and triangles, and
  the "Built · … Ctrl+Z takes the whole step back" line after Apply, are gone from the card; the list shows only when the part cannot
  be done the way chosen, to say why. Claude's summary still has the numbers. Where: `preview` and `build` in `app/js/round-card.js`.

- ![new][new] **Profile and Round: several points picked and moved at once.** In the section view with Edit points on, a click picks a
  point, Shift-click adds one, Ctrl-click takes one away, a drag on the background picks every point in its box (Shift adds them,
  Ctrl takes them away; a click on the background picks none) and Ctrl+A picks them all. Dragging any picked point moves them all as
  far: the point held snaps or lines up (Shift), the others keep their place relative to it, and Esc puts them all back. Delete takes
  every picked point out (each outline keeps three). A pan from the middle or right button no longer loses its hold when the pointer
  leaves the view (a mistake of this session's earlier change).
  Where: `app/js/section-view.js` (`sel`, `move`, `takeOut`, the box), `.pf-box` and the labels in `index.html`. Not yet tried by hand.

- ![polish][polish] **Profile and Round: a faint grid in the section view, and no instructions under it.** The grid fills the box,
  one line every 24 to 60 pixels whatever the zoom, with a line through 0. The long "Drag a point …" text under the view is gone; one
  short line says when a part is built from a section edited by hand, and the instructions are the view's label for screen readers.
  Where: `draw` in `app/js/section-view.js`, `markEdited` in `profile-card.js`, `marks` in `round-card.js`, `.pf-grid` and the
  labels in `index.html`. Not yet tried by hand.

- ![polish][polish] **Profile and Round: Shift lines a point up with the others, as in Illustrator.** While editing the section, a point
  dragged with Shift held takes the x of another point straight above or below it and the y of one level with it (each within 6 pixels,
  each on its own), so an edge comes out exactly upright or level; a thin amber line runs to the point it lines up with. With nothing
  that close it moves freely, as Shift did before; without Shift it still snaps onto the profile as it was.
  Where: `app/js/section-view.js` (`alignTo`, the pointermove handler, `draw`), hints in `profile-card.js` and `round-card.js`, `.pf-guide`
  in `index.html`. Syntax check only; not yet tried by hand.

- ![polish][polish] **Profile and Round: no grab hand over the section view, and no blue ring round it.** The ordinary pointer over
  it, points included (a point still lights up under it); the view pans with the middle or the right button held, as the 3D view does, with the grabbing hand while it pans,
  and a left drag on the background does nothing (the right button no longer opens the browser's menu there); a key pressed while it has focus (Shift, to line
  points up) no longer draws the keyboard-focus ring round the view. Where: `.pf-preview svg` and the `no-mod-ring` class on `#pf-svg`
  and `#rc-svg` in `app/index.html`.

- ![perf][perf] **Profile and Round: editing the section and moving the scrubbers keep up on a big part.** A dragged point is drawn once
  a frame, and the slow look at the part (its axis, its ends, the cut through it) is no longer done again at each move of a point or
  each step of Fill gaps and Straighten: it is kept for the part while the card is open. The Round card keeps its profile for the
  options it was made with, so an edit by hand does not cut the part again.
  Cause: every pointer move ran the whole `cleanProfile` (or `fillRoundGrooves` and its kin) over every triangle of the part, and
  rebuilt the drawing, once per event. Where: `app/js/profile.js` (`cleanProfile` split into `analyse`, kept in a WeakMap per array, and
  `shapeProfile`), `app/js/round-card.js` (`profileOf`), `app/js/section-view.js` (`move`, `later`). Test: `tests/profile.test.mjs`
  55/55, `e2e-profile` 17/17, `e2e-round-card` 24/24 (its drag check now waits a frame). Not timed on a big part, not tried by hand.

- ![fix][fix] **The section editor could lose a drag, or show points the card no longer used.** A click on a point (without moving it)
  froze the handles on that section, so after a change of Fill gaps the handles stayed where the old section was and the next drag
  sent it back; a drag went on after the card showed another part or editing was switched off; a lost pointer left a drag hanging;
  the wheel zoomed without end. Now the section is copied only when a point really moves, a drag ends cleanly whenever the card
  changes under it or the pointer is lost, Esc puts the point back (and the section back to the options' own if it was the first
  edit), a point let go on its neighbour becomes one with it, and the zoom stays between a ten-thousandth and fifty times the section.
  Edges that cross another are drawn red; that part is not built (Apply says why) until they no longer cross.
  Cause: `own()` at pointerdown, no ending of a drag from outside, no `lostpointercapture`. Where: `app/js/section-view.js`
  (`pointerdown`, `end`, `keys`, `drop`, `crossings`), `onEdit` and `build` in `profile-card.js` and `round-card.js`, `.pf-bad` in
  `index.html`. Test: the e2e above; the red edges, Esc and the lost pointer not yet tried by hand.

## Fixed

- ![fix][fix] **A glTF with KTX2 textures fetched an old decoder from the internet.** The decoder for KTX2 (Basis Universal)
  textures was taken from unpkg.com at three.js r172, while the loader that drives it is r186, and it needed a connection. It is now
  three r186's own, shipped with the app in `vendor/three/examples/jsm/libs/basis/`, and Basis Universal is in the credits (Settings ›
  About, the README and the site).
  Cause: the transcoder path was left at the old version in the upgrade to r186. Where: `app/js/app.js` (the KTX2 setup in the glTF
  loader, `_CREDITS`). Not yet tried with a KTX2 file.

- ![fix][fix] **The blue focus ring came back round a view after Shift and a click.** An element that is never to show the ring
  when only a modifier is pressed (the section view of the Profile and Round cards) lost that after Shift was pressed and then let go
  and clicked: from then on the ring showed at every key. Now it keeps it.
  Cause: the modifier-ring helper took `no-mod-ring` off on the next click from whatever had focus at Shift, also when the class was
  the element's own. Where: `app/js/app.js`, `_wireModifierRing`. Not yet tried by hand.

## Found, not fixed yet

- **`e2e-edit-sheet` gives different results from run to run since the three.js r186 upgrade**: the sheet's dots seen from the front or
  the back, and the picked edges, are counted as not drawn in some runs (the dark pixels with the dots on equal those with them off). The
  same with three-mesh-bvh 0.8.3 and 0.9.16, so it is the rendering of the marks, not the picking. Not looked into.

- **`inbox/GearboxAssy.glb` carries a note now** ("Check this bolt please.", with a screenshot), saved into it on 2026-10-22 at 15:46,
  most likely by a Claude session (`add_note` and a save over the file). The file is local (git ignores `inbox/`); tests that count
  notes on it were off by one. Worth putting the clean sample back.

- **`e2e-isolate` on the Gearbox, seed 4242, fails at its eighth step on a busy machine**: after a second scene tab is opened and the
  first one switched back to, the first shows no parts for the moment the test looks. It passed 84/84 on 19cbd3f, and passes for
  another session on the same checkout as it fails here; seed 618581 failed at the same step earlier and passed alone. Timing under
  load (several sessions running headless Chrome at once), not seen by hand: a probe that waits after the load saw all 95 parts at
  every moment after the switch. Not looked into further.

- **A STEP whose name is about 190 characters long fails late on Windows without long paths** (Settings › long paths off, the default):
  it uploads and converts, then fails writing its B-rep file with "step2glb.py exited with code 1". Where: `app/serve.py`,
  `_sanitize_filename` (a cap of 200 characters that does not count the folder). Found in the review of 2026-10-21; not seen here, where
  long paths are on.


