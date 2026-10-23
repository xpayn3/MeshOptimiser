# Fixes since the last release

The running log of bugs found and fixed after the last tag. Every fix goes in here the moment it is made (see `CLAUDE.md`), so that
it can be copied into `CHANGELOG.md` and the release notes when the next version ships, and so that there is a record of what was
wrong and why. When a version is released, its entries move into the changelog and this list starts again.

Entry format: the changelog's own (`![fix][fix] **What was wrong, in the user's words.** What now happens.`), written as one person
("I"), never "we". Under each entry, a line for the maintainer: `Cause:` and `Where:` (and `Test:` if one covers it).

Last release in the changelog: **v0.36.1**.

## New

- ![new][new] **Section view.** Command search: *Section view* puts one plane through the whole scene. A small card gives the axis
  (X, Y, Z), *Flip* (keep the other side) and *Position* (0 to 100 % of the scene's extent along that axis); a *Section* pill in the
  view turns it off. The parts are cut by the plane and the inside of the cut is drawn in one flat blue, so a hollow solid reads as
  solid there. How: three r186's WebGPURenderer ignores `renderer.clippingPlanes` and `material.clippingPlanes` (that is probably why
  the earlier attempt on the older three.js did nothing); it clips only inside a `ClippingGroup`, so `state.partsRoot` is one (off
  until the section is on). Each part mesh gets a back-face twin, drawn first in one flat colour inside a second ClippingGroup with the
  same plane; a second render pass was tried first and lost to the MSAA buffer, which does not keep a first pass.
  Where: `app/js/section-plane.js` (new), `state.partsRoot` and the frame render in `app/js/app.js`, `#vp-section-pop` in `app/index.html`.
  It is for looking at the cut, so nothing can be selected while it is on: a click or hover on the view and a click on a row of the
  tree do nothing, Ctrl+A is ignored and the selection is cleared when it is turned on. The panels are not touched: Explode works and
  the cut faces follow the parts, as they do a move or a hide (each frame compares every part's world matrix, geometry and
  visibility with what it was, a few numbers each). The camera still orbits, pans and zooms; Esc turns it off. It is light: only the
  meshes the plane passes through get a back-face copy (made when first needed), their boxes are measured when it is turned on and
  again when a part changes, and moving the plane is a comparison per mesh, no scene walk.
  Test: `tests/e2e-section-plane.mjs` (on the Gearbox Assy, on WebGL2 and on WebGPU with CAPTURE_GPU=1: it cuts, the cut is
  the flat colour, Flip and the axes change it, a click selects nothing while it is on and does when it is off, the panels are not
  dimmed, Explode moves the parts and the cut faces with them, Esc turns it off, off gives the first picture back).
  Not yet: the selection outlines, wireframes and CAD edges are not cut; transparent parts get no cut face; no outline or hatching on the cut; one plane only (no section box); the position is a percentage,
  not millimetres; not tried on the 3 M-triangle scene (the twins double the back-face draw calls while it is on).


- ![new][new] **Remove thickness.** A thin-walled part becomes the one surface it stands for: a hollow pipe keeps its outside (the
  inside and the rings at its ends go), a part bent from sheet keeps one face (the other and the strip round its edge go), and
  **Move into the wall** 50 % makes it the middle surface instead. Walls up to **Thickness up to** are found by looking straight into
  the material from each triangle; the sides that face each other are gathered into walls (a surface in several pieces still counts as
  one) and the smaller side of each goes. With CAD faces, whole faces go or stay. A wall that cannot be split in two sides (folded,
  or a solid part with only fine features) is left alone and the card says why. Command search: Remove thickness; Claude:
  `remove_thickness`. The surface left is open, one layer.
  On the Scania oil pump pipe: walls 1.005 mm, the outside kept, 2,376 → 1,148 triangles, open only at its two ends.
  Where: `app/js/thickness.js` (new), `app/js/meshops.js`, the card, command and tool in `app/js/app.js`, `app/serve.py`.
  Test: `tests/thickness.test.mjs` (a hollow pipe, a sheet with its edge strip, the same as a middle plane, an L of sheet, a solid
  block left alone). Not yet: a help article on the site, and parts with no CAD faces were only tried in the tests.

- ![new][new] **OBJ and FBX exports carry their textures.** An OBJ is written with each picture beside it (<name>_BaseColor.jpg,
  <name>_Normal.png, ...) and its .mtl points at them: `map_Kd`, `norm` and `map_Bump` (the normal map), `map_Pr`, `map_Pm`, `map_d`.
  A binary FBX carries the colour map and the normal map inside it (Video and Texture, connected to DiffuseColor and NormalMap, as
  Blender writes them). Pictures keep their size and their own format; a normal map drawn the DirectX way goes out OpenGL's way.
  Before, both formats left every picture out (a 2048 px textured square came out as a 14 KB FBX). The app's OBJ reader now also
  reads `norm` / `map_Bump` and the PBR values and maps of a .mtl, so an OBJ goes out and comes back with its normal map.
  Where: `app/js/app.js`, `_exportObjStreaming`, `_objTextureFiles`, `_exportFbxBinary`, `_parseMtl` / `_objApplyMtl`.
  Test: `tests/e2e-export-texture-size.mjs` (OBJ files and .mtl lines; FBX opened again, both maps at 2048 px),
  `tests/e2e-normal-map-direction.mjs` (GLB → OBJ and GLB → FBX → open, bumps the right way). Checked by hand in Blender 5.2: OBJ
  and FBX both import with the colour map on Base Color and the normal map through a Normal Map node, at 2048 px.

- ![new][new] **Photo mode has softboxes in its reflections.** Metal and gloss reflected the studio as a dim grey blur; Photo mode
  now lights reflections from the studio with four bright panels hung in it (a key box, an overhead strip, two tall strips behind),
  made twice as sharp (512 px a side), so chrome shows clean streaks along its curves. A Softboxes switch on the card (on) and
  `softboxes` in Claude's `photo_mode` leave them out: shiny flat surfaces read a little lighter with them.
  Where: `app/js/app.js`, `_Photo` softboxEnv / softApply; `app/index.html` #photo-softbox; `app/serve.py` photo_mode.
  Test: `tests/e2e-mcp-photo.mjs`. Judged by eye on the Scania engine (with and without, same camera).

- ![polish][polish] **No Edit mesh in Photo mode.** Entering Photo mode leaves Edit mesh, its mode button is hidden, and it cannot be
  opened until Photo mode is left (as in Animate). Its marks were drawn into the picture.
  Where: `app/js/app.js` `_Photo` enter, `_Elements` setMode; `app/index.html` `body.photo-mode #vp-mode-bar`. Test: `tests/e2e-mcp-photo.mjs`.

- ![polish][polish] **Explode's Fine tune each axis: the X, Y and Z bars sit 8 px apart** (were 20). Each field kept the 12 px
  bottom margin every slider field gets, which outranked the card's own 0.
  Where: `app/index.html`, `:is(.ex-fine>.field.has-scrub-bar, ...)`. Measured in headless Chrome.

- ![polish][polish] **The right sidebar's slider bars are as tall as its buttons** (32 px, were 28), and its lists of buttons sit as
  far apart as its slider rows (8 px, were 6): in Filters & flags the two sliders and the two Flag buttons are one even column.
  Where: `app/index.html`, `#sidebar-right{--bar-h}`, `#sidebar-right .btn-list`, the Filters & flags card. Photo mode keeps its
  smaller sliders. Measured in headless Chrome; other cards of the sidebar not looked at one by one.

- ![polish][polish] **The Edit mesh bar on the right has the spacing of the tool bar on the left**: 4 px round the buttons, 2 px
  between them and 4 px above and below a divider (it had 6, 4 and 8, so it stood wider and looser). Both are 38 px wide now.
  Where: `app/index.html`, `.vpc.el-bar`, `.el-bar .el-row`, `.el-bar .vpb-sep`. Measured in headless Chrome; not checked in the user's own window.

- ![new][new] **Claude can set up Photo mode.** A new MCP tool, `photo_mode`, switches it on or off and sets the lights, backdrop,
  finish, quality, floor, every effect (depth of field, occlusion, glow, vignette, grain, colour fringe, contact shadow, floor
  reflection) and the focus (the pivot, the middle of the view, or a part by id or name); the Photo mode card shows what was set.
  `render_image` and `screenshot` with `photo_mode` true keep those settings. `set_camera_view` can now also turn, tilt and zoom the
  camera round the model (`turn_deg`, `tilt_deg`, `zoom`, and `view` current) and set the lens (`lens_mm`, the camera moved so the
  model keeps its size: 85 mm gives the flat look of a product photo).
  Where: `app/js/app.js` tools `photo_mode`, `set_camera_view`, `_Photo.setFocus` / `hitAt`; `app/serve.py` `MCP_TOOLS`.
  Test: `tests/e2e-mcp-photo.mjs` (24 checks); `e2e-mcp-tools` still passes (199). Needs serve.py restarted to be listed to Claude.

- ![new][new] **Picture quality switches** under Settings › Performance. *Sharp textures at an angle* (on) keeps textures on a
  slanted surface sharp; *Finer shadows* (off) draws the sun's shadow from a 4096 px picture instead of 2048, for crisper edges on a
  large model and up close (about 50 MB more graphics memory). Both apply at once, are remembered, and every open tab follows.
  Where: `app/js/app.js`, `_gfxSharpTex` / `_gfxApplySharpTex`, `_gfxFineShadows` / `_shadowMapSize` / `_gfxApplyShadows`, the Performance pane.
  Test: `tests/e2e-texture-anisotropy.mjs` (both switches, SwiftShader and GPU); `e2e-shadows` and `e2e-copy-shadows` still pass. The
  difference Finer shadows makes has not been judged by eye yet.
- ![new][new] **Profile: clean outline does more than clean.** *Round corners up to* rounds every corner, outside and inside
  (smaller where the edges beside it are short). *Grow outline by* makes the section bigger or, below 0, smaller: walls get thicker,
  chambers smaller, outlines that come close join. *Ends* cuts both ends again, square or mitred at an angle with the short side
  picked as drawn in the preview, and *Extend each end by* makes the bar longer or shorter (a bent one along its curve). Under
  Advanced: *Keep chambers wider than* leaves the big chambers open while the small ones are filled, *Keep holes wider than* cuts the
  wide drilled holes and slots into the new part again (through the filled chambers too), *Make symmetric* turns a section within
  2 % of a mirror image into an exact one, and *Same edit on matching profiles* carries an Edit points edit to every other selected
  profile with the same section, turned or mirrored, of any length. The readout shows the new length, the chambers kept, the
  symmetry and the holes kept; it is folded under *Details* (opened once, it stays open). Every value slider in the app's cards has a new look (the Properties panel and the material rows keep their compact ones; all of it drawn from `--bar-*` tokens): the name above, under it one row with a bar that fills in blue (from the middle, with a faint mark at 0, for the ones that go both ways) and the number at its end (`initScrubber` with `bar`, `zero`); the white handle grows under the pointer and shows a hand, and Shift while dragging snaps to twentieths of the range and onto 0. The preview stays at the top while the options scroll, without a scroll bar. The Now / New key is gone from the Profile and Round part previews. The fill bar is now in every card and the right sidebar (Exploded view, Decimate, Filters & flags, Shape parameters, Photo mode with check boxes, Remove holes, Smart fit, Select hidden); in the sidebar and in rows of a number field the name sits inside the bar and fades while it is dragged; the fill is light grey and ends exactly at the handle, which shows only under the pointer; the bar and its number box meet square. No `:has()` or universal rules: a press anywhere costs nothing extra (measured).
  Where: `app/js/section2d.js` (new: union of loops by winding, offset, corner rounding, mirror, matching), `app/js/profile.js`
  (`shapeProfile` options, `trimPath`, `keepHoles`), `app/js/meshops.js` (`runMeshOp` runs `keepHoles` with Manifold),
  `app/js/profile-card.js` (the fields, `spread`), `app/index.html` (the card).
  Test: `tests/profile.test.mjs` (32 new checks), `tests/e2e-profile-options.mjs` (new, 15 checks); `e2e-profile` still passes
  (17). Keep holes needs a closed part (Manifold); it has been checked on a test bar, not yet on a customer's machined profile. A
  bent profile keeps square ends (Ends applies to straight ones).

- ![new][new] **Every sliding highlight stretches as it moves.** The option pickers of the cards (Notes' All / Open / Done, Align,
  Place, Draw and the rest), the Library and Materials view toggles, and the edit bar's pivot buttons: the highlight's leading edge
  leaves at once and the trailing edge follows on a spring, so it stretches across, lands a hair narrow and settles under the
  option. A change made by undo or a preset just slides. Reduced motion still jumps.
  Where: `app/index.html`, `--seg-lead` / `--seg-trail`, the `::before` of `.cmd-seg`, `.lib-view-toggle`, `.mat-view-toggle` and
  `#el-space`; `app/js/app.js`, the click listener after the switch-row one marks the way (`data-seg-dir`).
  Test: `tests/e2e-seg-thumb.mjs` (18 checks).

  Fixed with it: **the edit bar's pivot highlight sat 2 px (Local) and 4 px (Normal) above its button.** It stopped at 32 and 64 px
  while the buttons are 4 px apart (34, 68); it now follows the row's gap.

- ![new][new] **The Shading angle in Properties is a fill-bar scrubber**, like every other value: the name, a bar that fills, the number
  in its box at the end (click it to type). Letting go of the bar applies the angle as one undo step; a typed number or the arrow keys
  apply it after a short pause. Nothing is worked out while it is dragged (reshading builds the panel again: the row would be swapped
  under the pointer).
  Where: `app/js/app.js` `_wireShadeAngle` (initScrubber), the `#prop-shade` row in `refreshPropertiesPanel`; the old thin-row CSS in
  `app/index.html` is gone. Test: `tests/e2e-shade-scrub.mjs` (7 checks); `e2e-profile` reads the new row (17 pass).
- ![new][new] **The Animate window's sliders are fill-bars too** (Noise, Spin, Swing, Oscillate, Path), the number in the box joined to
  the end of the bar; the X, Y, Z triplets are bars rounded at both ends.
  Where: `app/js/app.js` `bodyMarkup` (`range-bar` on its range inputs), `app/index.html` the `.anim-speed` rules.
- ![new][new] **The Animate dock's settings pane can be made wider or narrower** by dragging its left edge, like the Library's and the
  Materials' inspectors; it is remembered, a double-click puts it back, and Reset layout forgets it.
  Where: `app/js/app.js` the dock-size helper is `window.__moDockDrag` (the Animate dock is built later), `#adk-insp-grip`,
  `stepopt-anim-insp-w`. Test: `tests/e2e-anim-bars.mjs` (8 checks, both changes).

- ![new][new] **Photo mode has a button on the tool pill and a toolbar of its own.** The camera at the foot of the tool pill on the
  left switches Photo mode on and off. While it is on, a floating pill takes the bottom toolbar's place: leave, Lights, Backdrop,
  Look and Quality (each button names what is chosen; a click lists the others), Effects (a panel with the floor disc, softboxes,
  every effect's switch and bar, and the focus), the size of the saved picture, and Save photo.
  Where: `app/js/app.js` `_PhotoBar` (after `_Photo`; it drives the card's own selects and moves the card's own rows, so nothing is
  kept twice), `#tg-photo-mode` and `#vp-photo-bar` in `app/index.html`.
  Test: `tests/e2e-photo-bar.mjs` (14 checks).

- ![new][new] **Settings › Performance › Edges and resolution.** *Smooth edges* switches the view's multisampling (four samples a
  pixel, on by default) off or on; the renderer is made with it, so a Reload row offers to apply it. *Resolution* (Auto, Full, Low) is
  the Quality of the view's settings, shown and set from here too. (*Lower the resolution if it stutters*, under While the view moves,
  was already there.)
  Where: `app/js/app.js` `_gfxMsaa` (read by the renderer's `create`), the Performance pane; `stepopt-gfx-msaa`.
  Test: `tests/e2e-aa-settings.mjs` (8 checks, a reload with it off draws with 0 samples).

- ![new][new] **Round part: the profile shows the whole part.** The preview drew one half of a turned part's profile (from the axis
  out), a thin line a bolt could not be told by. The other half is now drawn too, mirrored across the axis (a dashed line), lighter
  and with no points on it: it follows the half that is edited. A belt's cross-section stays one-sided.
  A button in the preview's top right corner switches the other half off and on (remembered).
  Where: `app/js/section-view.js` (`mirrorY`), `app/js/round-card.js` (asks for it except for a belt), `.pf-mirror` / `.pf-axis` in
  `app/index.html`. Test: `tests/e2e-round-card.mjs` (28, two new checks); `e2e-profile` still passes (17).

- ![new][new] **Photo mode: lens rings, and the left sidebar steps aside.** Ctrl+click on the model (depth of field on) sets the
  focus; holding V over the view shows a lens's three rings at the pointer (moving it up or down turns one), hollow, and turns one of them smoothly: focus (round distances on a
  log scale), aperture (f/1.4 to f/16, the depth of field's strength) or zoom (the lens in millimetres, the camera moved so the model
  keeps its size). The wheel, while V is held, goes from ring to ring (stopping at the outer and the inner one); the one turned is solid with white figures and a red mark at its
  setting. Each ring is drawn once and turned as one, once a frame. It replaces the small label that followed the pointer, and Alt as
  the key (Ctrl+drag box-selects as before everywhere else). Photo mode also folds the left sidebar away and opens it again on leaving
  if it was open (not saved as the sidebar's setting).
  The rings have light detents: within two or three degrees of a round distance, a stop or a classic lens they hold on it until turned past (Shift
  turns finely, without them). Zoom is a plain zoom: the camera stays where it is. Measured: the ring costs under 0.1 ms a frame; the
  focus readout is written once at the end of a drag (it restyled the panel at every move: style per move 2.5 ms, now 0.6 ms).
  Where: `app/js/app.js` `_Photo` (`wireFocus`: `RINGS`, `ringMake`, `ringDraw`, `turnFocus` / `turnAperture` / `turnZoom`, `turnSoon`;
  `enter` / `leave`: `kept.leftOpen`), `_leftSidebarShow`; `.photo-focus-ring` in `app/index.html`. Test: `tests/e2e-focus-ring.mjs` (21).
  Fixed with it: a failed switch-on of Photo mode left `body.photo-mode` on.

- ![new][new] **Sounds for the viewport's gizmos and quick wheels.** The lens rings of Photo mode tick as their ridges go by and click
  as they catch a mark or the wheel goes to another ring; the command wheel (Q), the colour wheel and the quick remesh pill (B) pop as
  they open, tick from one choice to the next and click when one is run or kept. Nothing else makes a sound (switches, pickers and
  panels stay silent). Made by the app with Web Audio (no sound files), quiet and a few milliseconds long, each a little different, the
  ticks softer and higher the faster a ring is spun, all through one gentle filter and limiter; the audio sleeps a moment after the last
  sound and in the background (left running, the sound card streamed silence and some drivers ticked while nothing was going on).
  Settings › General › Sound ›
  Interface sounds switches them off.
  Where: `app/js/app.js` `_UiSound` (before `_Photo`) and its calls in the lens rings, `_Wand`, `_QuickColour` and the quick remesh pill;
  `uiSounds` in the prefs. Test: `tests/e2e-focus-ring.mjs` (32: the rings, the command wheel, the sleep; the colour wheel and the B pill are
  not tested). How they sound is not tested.

- ![new][new] **The quick wheels wear the lens rings' look.** The quick remesh pill (B), the command wheel (Q) and the colour wheel
  (C) are near-black with white figures, as the lens rings of Photo mode: one set of colours for all of them (`--gz-*` in `:root`).
  The B pill is squared off (small round corners), the level it is on a lifted block with a red mark (where the blue block was), its
  readout a black chip; as it slides, the block springs to the level. The Q wheel's slices are black, the one under the pointer lifted a shade (in place of blue; Delete keeps its red). The colour
  wheel's chips (the colour under it, Cancel) are black.
  Where: `app/index.html` (`--gz-*`, the `#quick-wand` rules at the end of its block), `app/js/app.js` the pill's `styleOnce` and
  `setLevel`, the colour wheel's `paint` and styles. Test: `tests/e2e-quick-remesh-look.mjs` (5, and pictures with SHOT).

- ![polish][polish] **The Properties card is the same height for every selection.** The name has a line under it saying what is
  selected (`Single part`, `Instance · ×42`, `5 groups · 1,508 parts · 16 materials`, `Whole scene · 12 parts`). The triangle count,
  the saving (held empty when there is none), the bar and its caption, Vertices and Box volume side by side and the Size on a line
  of its own sit in one card; the Size no longer shares its line with its label and is not cut off. The bar is plain grey when
  the whole scene is selected. A line shows its points there. The tags are one line that slides sideways with the wheel or a swipe
  (`3 flagged`, `12 hidden`, `40 instanced`, in sentence case; "Nothing flagged" when there are none). Lock is an icon. The
  "Properties" heading above the card is gone (the name leads). The
  material strip and the Shading angle are as they were.
  Where: `refreshPropertiesPanel`, `_wireTagSlider`, `_updateSplineReadouts` in `app/js/app.js`; the `.prop-card` block in `app/index.html`.
  Test: `tests/selftest.js` ("the card is as high for the scene, a part and two parts"); the two scene-card checks now read "2 parts" and "1 part".
  Not yet checked in the browser with a very large scene or a line.

## Fixed

- ![fix][fix] **The Properties card said a group's volume was larger than the group.** The card showed 5.54 m³ for a group whose box
  (1.19 × 1.78 × 1.41 m) holds 2.98 m³. It added up the box of every part, and boxes overlap. It now shows the volume of the box of the
  whole selection, the one the Size beside it describes, and the row is called **Box volume** (for one part it was always its box, not
  the material it is made of; the name says so now).
  Cause: the sum of per-part box volumes for a selection of several parts. Where: `refreshPropertiesPanel` in `app/js/app.js`.
  Not yet: the volume of the material (the mesh's own), which would need a pass over every triangle of the selection.

- ![fix][fix] **The updater's browser test stopped before its first check.** `tests/e2e-update.mjs` copied
  `tools/build-update.py`, which moved to `tools/app/` on 2026-10-18; it now copies it from there, and 40 of its 43 checks pass
  (the other three are in *Found, not fixed yet*).
  Cause: the test was not changed when the release tools moved.
  Where: `tests/e2e-update.mjs` (the copy of build-update.py into the second app folder).
  Test: `node tests/e2e-update.mjs` (40 passed, 3 failed on 2026-10-23).

- ![fix][fix] **Remove thickness and Simplify round faces changed the shading of the faces they kept** (flat metal next to a fillet
  took on a gradient at its edge, reflections bent). Both only take triangles away, so every point now keeps the part's own normal (a
  CAD part's are exact); before, the tool runner worked them all out again from the triangles, smoothed across edges under 30°.
  On the Scania oil pump pipe: each remaining point within 0.02° of its old normal (before: 9° and more on some).
  Cause: `shade()` in meshops.js recomputed normals after every tool.
  Where: `app/js/meshops.js` (`keepNormals`), the part's normals handed to the tools in `app/js/app.js`, `thickness.js`, `roundfaces.js`.
  Test: `tests/thickness.test.mjs` (normals through the tool runner unchanged).

- ![fix][fix] **Simplify round faces crumpled pipes and bends** (long slivers along the straight runs, bends folded into fans: the
  rings were pulled out of line one point at a time). It now takes whole edge loops out first: on every round face that is a clean
  grid, whole rings of a bend (the two ends stay, so the neighbours match) and whole lines along a tube (the same ones through every
  run and bend of it), as many as the deviation and Segments per turn allow. Quads stay quads in line; the flat ends and an uneven run
  (a ring a point short, as CAD meshes have) are joined up again round what is left. Points are not moved. What is not a clean grid
  still goes point by point, as before. The card says how many rings and lines went. On the Scania oil pump pipe (2% deviation, 12
  segments): 18 rings and 30 lines, 2,376 → 1,040 triangles, closed, bends of 5 steps now 3.
  Cause: roundfaces.js only collapsed points one by one.
  Where: `app/js/pipegrid.js` (new), `app/js/roundfaces.js` (`simplifyRoundFaces` runs it first), the card's summary line in `app/js/app.js`.
  Test: `tests/pipegrid.test.mjs` (a pipe with a quarter bend, and with an uneven run), `tests/roundfaces.test.mjs` (the capped
  cylinder now loses whole lines: its volume checked against the even prism that is left). The help article (site docs) still
  describes the old behaviour.

- ![fix][fix] **The scene tab's menu said "Open&"**, and six other places had the same slip: "Remove lettering and logos&" and
  "Select by layer&" in the command search, "Working&" and "Let go to rebuild&" while a card rebuilds. They end in "…" again.
  Cause: the ellipsis of those strings had become '&' some time before v0.36.1.
  Where: `app/js/app.js`. Test: `tests/ellipsis-labels.test.cjs` (no word in the scripts or the page ends in a stray '&').
- ![fix][fix] **Edit mesh: zoomed out, the points were too big, the picked ones bigger still.** The dots were a fixed size on the
  screen (6 px, the picked ones 9 px), so zoomed out they ran together into a dark crust over the mesh, and the picked ones into an
  orange one. Each dot is now sized by how far its point is from the nearest other point, as that gap is on the screen: crowded points
  (a fillet, a thread) shrink as the view zooms out, down to 3.5 px, while a lone corner keeps its full 6 px. A picked point is the
  size of the others, only orange. And the dots are drawn after the lines: zoomed out, the blue lines were drawn over them.
  Where: `app/js/app.js` Edit mesh: `DOT`, `DOT_GAP_SHARE`, `pointGaps` (each point's nearest neighbour, once per mesh, in a grid),
  `dotLayer` (the size worked out in the shader, the ring and the lift with it), `fillDots`; `marks().dotPx` for the test.
  Test: `tests/e2e-edit-dot-size.mjs` (8 checks).

- ![fix][fix] **The CAD view's looks made the model dark and lit it strangely.** Ceramic and Mono left about half of the model in
  near-black (every face turned right or down was almost black), their lightest tone was a mid grey, a grey part was darkened a second
  time, and every face looking up went orange-brown. Measured on the Gearbox, the model averaged 0.22 (Ceramic, Mono) and 0.34 (Light)
  against 0.44 in the plain view; now 0.37, 0.35 and 0.42: the side away from the light is a soft grey, the lit side light, top faces
  only a hint warm, and coloured parts as deep in every look.
  Cause: the matcap's colours (dark 38 and 30, light 150 to 171), a light that stopped at the side of each part, a part's grey taken in
  linear light (a mid grey halved the matcap), and the warm top at full strength.
  Where: `app/js/app.js` `_CAD_LOOKS`, `_cadPaintMatcap`, `_cadMatcap` (`_cadLumRef`), `_cadMaterialFor`.
  Test: `tests/e2e-cad-looks.mjs` (11 checks; 8 of them fail on the old looks); `e2e-cad-lines` still passes (17).

- ![fix][fix] **Photo mode's occlusion drew dark blotches on gently uneven surfaces (a scanned table top) and showed the triangles of
  faceted curves.** A point now shades by how steeply it rises over the surface, and not at all below about 17°: a wall at a corner
  shades as before, the far rim of a shallow hollow does not. On a crest or in a dip the surface's slope is now the mean of both sides,
  so the plane a pixel is judged against no longer tilts there.
  Cause: any point a hair (2 % of the reach) above the pixel's plane counted in full, so every shallow dip of a scan went dark at full
  strength; and the gentler of the two one-sided slopes was always taken, which tilts the plane on a crest or in a dip.
  Where: `app/js/photo.js`, the occlusion (`blocks`, `planeAt`'s `slope`).
  Checked in headless Chrome (GPU) on a wavy surface with a box (the troughs were black, now even; the box still shades the ground) and
  on the Gearbox (creases still shaded); `e2e-photo` passes (22). `e2e-photo-average` misses its frame counts in headless both before
  and after the change (15 and 18 of 32 frames): its time limits, not this. Not yet checked on the table scan itself.


- ![fix][fix] **Bumps of an OBJ, FBX, 3MF, USD or Collada model pointed the wrong way** (a normal map's dents came out as bumps and
  its bumps as dents, lit from the wrong side). The app turns those files' UVs to run from the top, as glTF's do, and now turns the
  normal maps' green with them (as three's glTF reader does for a GLB). DirectX maps (`_Normal_DX`) come out right too.
  Cause: the UV turn on import (`_ingestSceneRoot`) left `normalScale.y` at +1; a GLB's is -1.
  Where: `app/js/app.js`, `_ingestSceneRoot` (the turn of V).
  Test: `tests/e2e-normal-map-direction.mjs` (a square lit from the side its normal map leans to: GLB, OBJ, OBJ with a DirectX map).

- ![fix][fix] **The material editor's Normal scale turned a GLB's bumps inside out, and a normal map loaded into the editor came in
  inside out.** The knob wrote the same value to both directions of the map, wiping the turned green a glTF has; a map put on where
  there was none got +1. The knob now keeps the turn, and a new map is given the turn the scene's UVs need.
  Where: `app/js/app.js`, the Normal scale scrubber and `_setTexFromFile`. Not covered by a test (the editor was not driven); the
  sign rule is the one the import test checks.

- ![fix][fix] **A USDZ export shrank every picture to 1024 px** (a 4K map came out at a sixteenth of its pixels). Pictures keep their
  size up to 4096, the most AR Quick Look takes.
  Cause: three's USDZExporter has `maxTextureSize: 1024` unless told otherwise.
  Where: `app/js/app.js`, the USDZ branch of the export.
  Test: `tests/e2e-export-texture-size.mjs` (2048 px colour and normal maps through GLB, meshopt, the web preset, glTF and USDZ).
- ![fix][fix] **The sun gizmo covered the docks.** With an HDRI on, the round sun dial in the view's bottom-left corner sat over an
  open Animate, Materials or Library dock (and over command cards), on top of their buttons. It now goes under them, like the view.
  Cause: it is a `.vpc` view toolbar (layer 96), and the bottom docks are under that layer (90) by design.
  Where: `app/index.html`, `#sun-gizmo-wrap{z-index}`. Test: `tests/e2e-anim-bars.mjs` (fails without it).

- ![fix][fix] **In Edit mesh, the grey highlight of World / Local / Normal (and of the pick modes) sat below its button.** It lands
  on the button that is on, the third one too (it was 4 px low, touching the divider under it).
  Cause: the highlight slid 34 px per button (30 and a 4 px gap) while the buttons are 32 px apart (a 2 px gap).
  Where: `app/index.html`, `.el-bar` (`--el-row-gap`, used by the row's gap and by `--el-step`).
  Checked in an 8× picture of the bar in headless Chrome; no test covers the look.


- ![polish][polish] **The Library's Add to scene is a floating +.** The blue + (the one the Animate dock adds with) floats in
  the bottom right corner of the part's panel, and the line with its triangles and size is under its name, so the parameters have the room below.
  Where: `app/js/app.js` `_libInspectorRender`; `app/index.html` `.lib-inspector .li-add`, `.li-facts`; `app/knowledge/docs/library.md`.

- ![fix][fix] **Photo mode pictures had the CAD edge lines on them** (thin dark outlines round every face, like ink on a render).
  Photo mode now hides them, and they come back when it is left.
  Cause: the edge lines are children of the parts and Photo mode drew the scene as the viewport has it.
  Where: `app/js/app.js`, `_Photo` enter / leave (the shared `_CAD_EDGE_MAT` hidden).
  Test: `tests/e2e-mcp-photo.mjs` (89 edge lines on the Gearbox, none drawn in Photo mode, drawn again after).
  (A report that Photo mode renders were stretched was measured and is not a bug: a sphere comes out round at 16:9, 1:1 and 9:16. The
  long look was the wide 45 degree lens close up; `lens_mm` is the answer.)

- ![fix][fix] **Profile: clean outline and Round part stayed on the old part when I selected another one.** With either card open
  (before or after Apply), selecting another part moves the card to it, as if it were opened there: its cross-section or profile,
  its own gap width and straightening, and Apply again (what was applied to the first part stays, its own undo step). The
  switches carry over (Profile: Fill chambers, Fill holes and cuts; Round part: the mode). Round part puts the view back from
  Wireframe when it moves on. Clicking empty space keeps the card where it is; selecting a part that does not fit says so once and
  the card stays.
  Cause: the cards only read the selection when they opened. Where: `follow()` in `app/js/profile-card.js` and
  `app/js/round-card.js`, run from `applySelectionColors` in `app/js/app.js` (the list `_selFollowers`). Test:
  `tests/e2e-profile-scene.mjs` ("the card follows the selection", 4 checks), `tests/e2e-round-wire.mjs` (5 more checks).

- ![fix][fix] **Merge by showed the old preview when I picked other parts, as many as before**, and **Align and spread kept saying
  how many were selected when it opened.** Merge by now looks again whenever the selected parts change, not only their number;
  Align and spread's line counts the selection as it is now.
  Cause: Merge by compared only the number of selected parts; Align and spread wrote its line only on opening. Where:
  `app/js/app.js` `_mergeBy` (`selSig`), `_Arrange` (`selLine`, `follow`). Test: `tests/e2e-cards-follow.mjs` (6 checks).

- ![fix][fix] **Textures went blurry on a surface seen at a slant** (a table top going away from the camera smeared into a soft
  wash). Every texture of a model, and every texture added in the material editor, is now filtered at the graphics card's best
  (anisotropic filtering, 16 on nearly every card), so the grain stays sharp at a grazing angle.
  Cause: three.js loads textures with anisotropy 1, so a slanted surface is read from the small mip levels; nothing in the app raised it
  (only the paint flakes and the measure labels had their own).
  Where: `app/js/app.js`, `_sharpTex` / `_sharpenTextures`, called from `_ingestSceneRoot` (every format), the material editor's `_loadTexture`,
  `_applyTextureSets` (textures picked from a folder) and `_pasteForeign` (parts pasted from another window).
  Test: `tests/e2e-texture-anisotropy.mjs` (SwiftShader and, with `CAPTURE_GPU=1`, the machine's GPU; fails with 1 without the fix). Not
  checked by eye on the table model, and textures made inside the app (baked, painted) are not covered.

## Found, not fixed yet

- **After a model opens, "Preparing the view" can stay up for the full 12 seconds on a slow graphics path**, even for a sheet
  of 128 triangles (seen in headless Chrome with software WebGL: the Gearbox at 14 s from file to view, the sheet at 11 s and more).
  The settle loop waits for four frames in a row no slower than 1.5 times the quickest frame so far (34 ms at least); one quick frame
  early on (a frame with little to draw) sets a bar that 150 to 200 ms frames never meet, so it runs to its cap. Since v0.36.0, not
  new. It also keeps the `load` task listed, which spoils several browser tests (`e2e-edit-sheet`, `e2e-edit-ortho-switch`,
  `e2e-recovery`: the loader covers what they measure). Not checked on a real graphics card.
  Where: `_settleView` in `app/js/app.js` (`even` / `best`). Found 2026-10-23 (`docs/test-sweep-2026-10-23.md`).

- **F5 while "Preparing the view" is up says "A file is still converting… you would have to start the import again"**, though
  the model is already in the scene. The reload guard counts the tab's `load` task as a conversion, and that task stays listed through
  the settle stage. Seen in `e2e-recovery` (2026-10-23).
  Where: `_convertingNow` and the F5 / Ctrl+R handler in `app/js/app.js`.

- **`tests/stylesheet-literals.test.cjs` fails: 37 lines with a typed-in hex colour, ceiling 35.** Four are new in the uncommitted
  work of 2026-10-23: `.sc-key.is-held` (`var(--white,#fff)`) and three `.photo-focus-tag` rules (`#16181d`, `#6a6f78`).
  Where: `app/index.html`.

- **Browser tests that are out of date** (they test what the app no longer does; the app is right), found 2026-10-23:
  `e2e-dof` (presses Alt+click to set the focus; it is Ctrl+click since the lens rings), `e2e-texsets` (expects a DirectX OBJ normal
  map at `normalScale.y = -1`; since 9a8bc49 OBJ maps are turned on import and a DirectX one ends at +1, which
  `e2e-normal-map-direction` proves by its picture), `e2e-edit-cache` (looks for the picked dots at `renderOrder` 12; now 19),
  `e2e-drag-cursor` (scrubs the first `.scrub-value` it finds, now the greyed Shading angle bar with nothing selected),
  `e2e-mcp-server` (expects the Claude pill's dropdown below the pill; the pill is in the status bar since v0.35.3 and opens upward),
  `e2e-update` (rewrites `v0.21.0` in the brand menu's version, which now reads `v0.36.1`, so the reload checks never see the
  new version). Five tests (`e2e-animate-multi`, `-cmd-card-grow`, `-dof`, `-photo-pictures`, `-split-material`) default to
  port 4343 and need `APP_PORT=4242` against the user's server.

- **ASCII FBX (the export dialog's ASCII option) still leaves the pictures out**; the binary FBX (the default) carries them. Found
  2026-10-23.

- **Blender marks an OBJ's normal map as sRGB** instead of Non-Color (its OBJ importer does it whatever the .mtl says; it reads
  `map_Bump`, not `norm`), which bends the normals a little. The FBX's comes in as Non-Color. Nothing to do in the .mtl.

- **`e2e-photo-average` fails 7 of 15 on 2026-10-23**: the average of a still view reaches 15 to 25 of its 32 frames before the test
  stops waiting, so the checks that need all 32 fail. The same with the new softboxes switched off, so not from them. Looks like time
  (SwiftShader, with another session's headless Chrome running on the same machine); not compared with v0.36.1, which would need a
  second server. Not looked into further.

- **`e2e-edit-sheet` gives different results from run to run since the three.js r186 upgrade**: the sheet's dots seen from the front or
  the back, and the picked edges, are counted as not drawn in some runs (the dark pixels with the dots on equal those with them off). The
  same with three-mesh-bvh 0.8.3 and 0.9.16, so it is the rendering of the marks, not the picking. On 2026-10-23 its screenshots showed
  the dots drawn from both sides, with the "Preparing the view" loader still over the middle of the view where the test counts (see the
  12-second settle entry above): the count is spoiled, not the dots.

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
