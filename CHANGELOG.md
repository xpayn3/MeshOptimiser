# Changelog

All notable changes to MeshOptimiser. Newest on top.

Tag legend: &nbsp; ![new][new] new feature &nbsp;·&nbsp; ![fix][fix] bug fix &nbsp;·&nbsp; ![perf][perf] performance &nbsp;·&nbsp; ![polish][polish] UX / visual refinement &nbsp;·&nbsp; ![refactor][refactor] internal cleanup &nbsp;·&nbsp; ![docs][docs] documentation

## Unreleased

A read of the whole code base and a round of beta testing after v0.13.0:
what was found to be wrong is fixed, and the start screen is rebuilt.

**Start screen**

- ![polish][polish] **Recent files are a list you can read.** One row a
  file: its picture, its name, type and size, and when it was last opened.
  The rows no longer shrink into slivers when there are many; the list
  scrolls, and fades at the edge that has more. At most ten are kept.
- ![polish][polish] **Continue where you left off.** The file that was open
  last has a card of its own, with its picture across it, and is not
  listed a second time below.
- ![polish][polish] The filter sits in the heading's line and `Enter` opens
  the first match; the arrow keys walk the list; the remove button takes
  the place of the age while the pointer is on a row. An empty list says
  what will appear there.

**Export and scene settings**

- ![fix][fix] **Up axis and Scene scale stay out of the file, for every
  part.** A part moved after either setting changed was written turned or
  resized, the others were not, and instanced parts differed again. The
  two settings are how the scene is shown and measured; Export's own
  Scale and Axis decide the file.
- ![fix][fix] **A position typed in the Transform panel lands where the
  field says** in a Y-up or scaled scene.
- ![fix][fix] **Screenshots from Top, Front and Side are not stretched**
  when the picture has another shape than the viewport.
- ![fix][fix] Draco export names the file `.glb` when it had to fall back
  to an uncompressed one; CSV export honours "Selected parts only"; ASCII
  FBX gives repeated names a number, as the binary writer does.

**Security**

- ![fix][fix] **The local server answers only its own page.** Any web page
  open in the browser could send requests to `localhost:4242`: stop the
  server, or start a conversion on a file of its choosing. Requests are
  now refused unless they come from the app's own address, folders are no
  longer listed, and nothing is served from `.git` or `.venv`.
- ![fix][fix] **Names and scene data from a file are never run as markup.**
  Three places built HTML from them without escaping: measurements saved
  inside a GLB, the label that follows a dragged tree row, and the Flatten
  dialog. The `?file=` address is checked the way it will be fetched.

**Parts and scenes**

- ![fix][fix] **A fresh install converts STEP again.** The OpenCascade
  package had moved to a version the converter cannot import; the
  versions are pinned, and `start.bat` installs again when the
  requirements change or the first install failed.
- ![fix][fix] **Hidden instanced parts no longer wreck a Select all.** A
  hidden copy was made into a mesh from a zero matrix, and the NaN that
  came out spread to every selected part.
- ![fix][fix] **Undo brings back deleted instanced parts.** Deleting every
  copy of a repeated part removed the set from the scene; undo restored
  the rows but nothing drew them.
- ![fix][fix] **A colour changed in the material editor is exported**, and
  shows on the part's swatch in the tree. Duplicate and Split keep the
  material a part is wearing.
- ![fix][fix] **Smart fit, Centre pivot and Bake no longer fight the
  exploded view.** A fitted part jumped back to its old origin on the
  next move of the slider.
- ![fix][fix] **Clay does not stick.** A part made from an instance, or a
  cloner copy built while Clay was on, kept the clay material for good.
- ![fix][fix] **Split by proximity cannot freeze the tab.** Its grid is
  bounded: on a plate or a box one triangle used to fill millions of
  cells.
- ![fix][fix] **Measurements are shown in the unit chosen**, not in
  millimetres with another unit's name after them.
- ![fix][fix] **Files with invalid coordinates open.** NaN and Infinity
  are set to 0, with a notice; before, the camera became not-a-number
  and the viewport never recovered. A broken or empty file gets a plain
  message, and a file with no meshes says so.
- ![fix][fix] **Import no longer turns later Opens into appends**, and
  "Don't ask again" can be undone under Settings › Storage.
- ![fix][fix] **Quit asks about every open scene**, not only the one in
  front.

**Viewport**

- ![fix][fix] **HDRI works the second time.** Leaving it disposed the
  environment it would need again.
- ![fix][fix] **One slow frame no longer doubles the render loop**, and a
  long load is not reported as a stalled viewport.
- ![fix][fix] **Fit frames the model in orthographic views.**
- ![fix][fix] **Parts keep their size on screen after a scene scale.** The
  moving-view culling measured boxes from before the change.

**Interface**

- ![fix][fix] **Switches can be reached with Tab and flipped with Space.**
  All of them were out of the tab order.
- ![fix][fix] **Tooltips follow what they describe**: the save state on a
  tab, Collapse / Expand all. Icon-only buttons keep a name for screen
  readers.
- ![fix][fix] **Enter presses the button that has the focus** in a dialog,
  instead of always accepting. `Esc` in a dropdown closes the dropdown
  only.
- ![fix][fix] Single-key shortcuts (`4`, `5`, `M`, `F2`) no longer fire
  behind a dialog or while a dropdown has the focus.
- ![polish][polish] **British spelling throughout** the visible text.
- ![fix][fix] Lock / Unlock on a mixed selection; "Add group parts to
  selection" adds; plain Find & Replace treats `$` as text; OBJ export
  keeps non-Latin names; ASCII FBX keeps its precision at any export
  scale; cloner radial mode no longer leaves a copy at the centre.

- ![fix][fix] The unsaved dot survives more than 30 edits followed by
  undoing them; shortcuts no longer reach the scene from behind a dialog;
  the add-shape button answers the keyboard; `Alt` + right-drag zooms in
  orthographic views; snap follows the grid's own cell.
- ![fix][fix] Split: "Watertight regions" is gone (it did what Vertex
  connectivity does); the read-out and the preview agree with the split;
  undo frees what the split made. Merge keeps shading when one source had
  no normals. Fit to budget and Heatmap free what they replace.
- ![fix][fix] Cloner: redo of "create" and "add sources" no longer adds a
  second undo step or throws the remaining redos away, and undo puts the
  source parts back where they were.
- ![polish][polish] Labels and roles for screen readers on switches, fields,
  menus and windows; keyboard focus is visible on sliders, links and
  tick boxes; shortcut tips over the viewport are easier to read.
- ![refactor][refactor] About 2,000 lines of code and 150 style rules that
  nothing used are gone: the old flatten routines, the bounding-box
  overlay, the per-part colour picker, the old Add menu, the scene
  settings window.

**Launchers and converter**

- ![fix][fix] **A STEP file with nothing solid in it says so**, instead of
  a traceback. Cancelling a conversion stops the converter on macOS and
  Linux too, and a cancel that arrives early is not lost. A long
  conversion keeps printing its log past 200 lines.
- ![fix][fix] `--open` reuses a converted file only when it came from the
  same source; a `.gltf` with side files is refused with a reason.
- ![fix][fix] The launchers check for Python 3.10 to 3.12 and say what is
  wrong when it is another version; a hidden start no longer waits on a
  key nobody can press, and reports a failed start.
- ![docs][docs] A LICENSE file (MIT).

- ![fix][fix] `step2glb.bat` uses the project's own Python and passes
  every argument on. The macOS launchers are executable after a clone,
  and line endings are fixed by `.gitattributes`.
- ![fix][fix] Starting the app twice opens the window on the server that
  is already running instead of starting a second one.

## v0.13.0

v0.12 gave the app things to build with. v0.13 makes it feel like an app.
It installs to the desktop with an icon of its own, opens in a window
with no address bar, no browser tabs and no extension buttons, and can
fold its title bar away so the top bar is all there is. The scene tabs
grew up with it: drag them into the order you want, save from the tab's
icon, and keep your sidebars where you put them from one scene to the
next. And a view that is moving now gives up what you cannot see anyway.

**An app of its own**

- ![new][new] **Install it.** The app carries a web-app manifest and its own
  icon, so Chrome and Edge offer *Install*. Installed, it has a desktop and
  Start-menu shortcut and a window to itself.
- ![new][new] **A window with nothing of the browser in it.** `start.bat`
  (and `serve.py`) now open the app in Chrome's app mode, falling back to
  Edge, then Brave: a title bar and the app, no address bar, no tabs, no
  extensions button. It uses your usual browser profile, so settings and
  recent files are the ones you had. `python serve.py --tab` opens an
  ordinary browser tab as before.
- ![new][new] **Fold the title bar away.** In the installed app the `^` in
  the title bar hides it: the window's own buttons float over the top
  right corner and the app's top bar becomes the title bar. Its empty
  stretches drag the window; buttons, tabs and fields stay clickable, and
  Export and the screenshot button stay where they were.
- ![new][new] **A cover on the start screen.** The start screen opens with a
  wide clip across its top, the app's name over it and the essentials
  underneath.

**Tabs**

- ![new][new] **Drag tabs into order.** Press a tab and pull it sideways. It
  rides with the pointer, the others slide over to make room, and it
  drops into the place nearest to it. It moves left and right only and
  stops at the ends of the row; `Esc` puts it back. Nothing in the strip
  is rebuilt or measured again while a tab is held, so tabs of different
  widths cannot flicker between two places.
- ![polish][polish] **The tab, rearranged.** The icon on the left stays an
  icon and carries the status dot on its corner: yellow with unsaved
  changes, green when saved. A click on the icon saves. The close button
  is at the right end, always there on the open tab and under the pointer
  on the others. Other tabs show the yellow dot when they have unsaved
  changes.
- ![new][new] **Same sidebars in every tab.** Switching tabs keeps the
  sidebar widths, and the folded left sidebar, of the tab you came from,
  applied before the tab is shown so nothing slides. A switch under
  Settings › General turns it off, and each tab keeps its own again.

**While the view moves**

- ![perf][perf] **Tiny parts are skipped.** While you orbit, pan or zoom, a
  part that would be under about three pixels across is not drawn, and it
  is back on the first frame after the view stops. CAD assemblies are
  mostly screws, washers and clips: on the 1,583-part test assembly that
  is 77 parts at the opening view and 570 with the model zoomed out.
  Parts that are large for the model are always drawn, so a model seen
  from far away keeps its shape, and so is whatever is selected.
- ![perf][perf] **The resolution gives way before the frame rate does.**
  Only when moving frames are actually slow, the picture is drawn a step
  coarser (80%, 65%, 50%) until the view moves freely, and sharp again
  when it stops. A scene that already moves at the display's rate is left
  alone. The step that was needed is remembered for the next movement.
- Both are switches under Settings › Performance, on by default.

**Interface**

- ![polish][polish] **The renderer picker moved to Settings › Performance.**
  The top bar ends with Export and the screenshot button.
- ![polish][polish] **The Menu button has no arrow**, and drops its word for
  the icon alone when the sidebar's stretch of the top bar is too narrow
  for it.
- ![polish][polish] **One flat accent blue on the loading bar**, in place of
  the blue-to-purple gradient, with a faint band of light drifting across
  it while something loads.
- ![polish][polish] **The triangle count over the viewport's corner is gone.**
  Properties shows the same totals.
- ![fix][fix] **Properties no longer jumps when a tag appears.** The tag row
  under the name keeps its line, so "782 hidden" arriving on Isolate does
  not push the rest of the card down.

## v0.12.0

**The biggest release yet.** Until now MeshOptimiser opened a model and
made it lighter. From today it also *builds*. There is a library drawer
full of real parts — hex bolts, wing nuts, pillow blocks, I-beams, gears,
a stepper motor — and you drag them straight onto your model. A file
that arrives lying on its side forty metres from the origin stands up on
the floor from one card. A five-million-triangle scene comes down to the
budget you type. The screws nobody will ever see are found for you. And
for the first time a black part on a dark background actually looks like
something.

**New: the library drawer**

- ![new][new] **86 parts, one drawer.** Flip the left sidebar from the
  parts tree to the library and there they are, each with its own
  picture, on six shelves:
  - **Shapes** — cube, sphere, torus, capsule, wedge, rounded box, star…
  - **Fasteners** — hex bolt, Allen screw, countersunk, button head,
    carriage bolt, U-bolt, eye bolt, set screw, threaded rod, rivet,
    washer, spring washer, retaining ring, standoff…
  - **Nuts** — hex, lock, jam, flange, cap, castle, wing, thumb, square,
    coupling, eye and T-slot nuts.
  - **Pipes and flanges** — tube, elbow, tee, cross, reducer, pipe cap,
    flange.
  - **Profiles and plates** — I-beam, box tube, angle, C-channel, T and Z
    profiles, T-slot extrusion, flat bar, round and hex bar,
    perforated and slotted plate, gusset, hinge.
  - **Machine parts** — gear, rack, sprocket, pulley, bearing, bushing,
    pillow block, shaft collar, linear rail, spring, handwheel, star
    knob, pull handle, levelling foot, wheel, enclosure, a stepper motor.

  Search the drawer, pick a thread size and length once at the top (M6 ×
  24 by default) and every fastener comes out in it. The six parts used
  last wait at the top. Nothing in it is a dead mesh: every part stays
  parametric, and its Shape card changes it afterwards.
- ![new][new] **Drag it onto the model.** Pull a part out of the drawer
  and a see-through copy follows the pointer, already standing where it
  will land: square to the face under the pointer, or upright on the floor
  where there is none. Let go and a bolt sits on the plate, the right way
  up. The ghost lives outside the parts, so it is never picked, counted
  or exported.
- ![new][new] **A bolt that brings its own nut.** Tick *Nut on the bolt*
  on a hex bolt, an Allen screw, a threaded rod or an eye bolt, choose
  the nut (a wing nut, a castle nut, a flange nut…) and how far from the
  head it sits. It is part of the bolt's own shape, in the bolt's
  thread, so it follows Size, Length and Orientation, is one row in the
  tree and one undo step, and cannot sit past the end of the thread. A
  nut with a side to it goes on facing the head, as it would be tightened.
- ![new][new] **Type "add flange".** The search (`Ctrl+K`) reaches into
  the drawer too: `Enter` adds the part.

**New: stand it up**

- ![new][new] **Align to floor.** Files arrive anywhere and any way up: a
  part modelled 40 m from its origin, an assembly on its side, a scan
  centred on nothing. One card fixes all of it. Turn the model in steps
  about X, Y and Z (90° by default, any angle you like) and say, for each
  axis, which side goes to zero: low, middle, high, or leave it. Middle /
  middle / floor stands it on the grid over 0,0,0. You watch it move,
  a whole run of adjustments is one undo step, and the transform is worked
  out from scratch each time, so nothing drifts. Group origins and the
  exploded view go along with it. Switch it on for every file you open and
  never see a model lying down again.

**New: make it lighter, faster**

- ![new][new] **Select hidden parts.** The screws inside a housing, the
  board under a cover, the bearing nobody will ever see: one command finds
  every part that cannot be seen from outside and selects it, ready to
  delete or isolate. It has a panel of its own, with a looping clip of
  what it does.
- ![new][new] **Fit to budget.** Type the number of triangles the scene is
  allowed to have. The densest meshes are reduced first until the total
  fits. One undo step, a preview before anything is committed, and Cancel
  while it runs.
- ![new][new] **Smart fit learned shapes.** One box says where a part is
  and nothing of what it is: a bracket becomes a brick, a frame a slab.
  Two new stand-ins keep the outline.
  - **Boxes** covers the part with a handful of boxes, each sized and
    turned to one piece of it. A levelling foot becomes a slab and a bar,
    an L two bars, a frame four. 12 triangles a box.
  - **Blocks** rebuilds it from a coarse grid, with its steps, arms and
    openings in the right places, in a few dozen to a few hundred
    triangles — whatever the part had.

  Both fall back to a plain box when they would not be clearly lighter.
- ![new][new] **Optimisation report.** The scene as it was opened against
  the scene now, plus the size of the last export: the number to show
  whoever asked for a lighter file.
- ![new][new] **Preview and Cancel.** Decimate and Fit to budget show
  their result before it is applied, and the long jobs can be stopped.
- ![polish][polish] **Delete small parts shows what it will delete.** With
  the small parts isolated, what is on screen follows the threshold as
  you drag the slider. It is the same isolation, adjusted, so it adds no
  undo step of its own.

**New: see what you are looking at**

- ![new][new] **Clay (`5`).** One key and the colours are gone: every
  part in the same plain material, so all that is left is form — edges,
  curvature, what stands in front of what. It is a real lit material, so
  the lights, the headlight and the studio reflections shape it.
  Right-click the button for porcelain, steel or red wax. Export and Save
  switch to Solid while they run; nothing of it reaches a file.
- ![fix][fix] **Parts no longer show through thin covers from a distance.**
  Zoomed out, the parts under a sheet-metal cover or a thin panel used to
  flicker through it, worse the further away the camera was. The depth
  buffer loses precision with distance, and the camera's near plane sat a
  millimetre or so in front of the lens however far out the view was. It
  now follows the camera out: while the camera is outside the model the
  near plane moves to half the empty gap in front of it, and comes back as
  you zoom in. On a 0.7 m test assembly seen from 5.7 m that takes depth
  precision from about 1.6 mm to under a thousandth of a millimetre.
  Orthographic views never had the problem and are unchanged; saved scenes
  still store the clip preset's own near value.
- ![new][new] **Dark parts have a shape.** On a plain background the scene
  was lit by three lights and had nothing to reflect, so a dark part came
  out as a flat near-black silhouette and dark parts in front of dark parts
  could not be told apart. The plain backgrounds now carry a soft studio as
  their surroundings: it is never shown, only reflected and used as gentle
  fill, so dark parts get an edge, a sheen and a visible top and side
  while colours stay what they were. HDRI mode replaces it with the chosen
  environment and puts it back on exit.
- ![new][new] **A headlight that follows the view.** The three scene lights
  are fixed, so a face turned away from all of them stayed flat however
  you orbited. A soft light now travels with the camera, from just above
  and beside the eye: it always falls on what you are looking at, and its
  highlight slides across the surfaces as the view turns, which is what
  makes their form readable. It is off in HDRI mode, where the environment
  does the lighting.
- ![polish][polish] **Lighting rebalanced** to make room for the two above:
  the sky light and the key light are a little lower, so overall
  brightness and colours are unchanged.

**Search and input**

- ![new][new] **Search finds parts and the library.** `Ctrl+K` used to find
  commands. It now also finds parts by name (`Enter` selects and frames
  one, hidden ones included) and library parts (`Enter` adds one; "add
  flange" works too). Commands run lately lead the list while nothing is
  typed, and the card eases to the height of its results.
- ![new][new] **A calculator in the search.** Type a sum (`12*25.4`) or a
  length (`2 in`, `50 mm in in`, `3 thou`) and `Enter` copies the answer.
- ![new][new] **Every number field drags.** Not only the fields a panel set
  up: any number field is wired the first time the pointer comes over it,
  with its own min, max and step, or a step read off the number in it
  (12.50 moves in hundredths, 24 in ones). Dialogs and the Properties
  panel are covered as they are built.
- ![polish][polish] **Move snaps to a step you can see.** A fixed 10 units
  was invisible on a model metres across and a leap on one of a few
  millimetres. The step is now a round number near a twentieth of the
  scene's size, and always a multiple of the floor grid's lines.

**Interface**

- ![polish][polish] **Right sidebar regrouped** into Inspect, Clean up and
  Reduce; Measure, highlight and the grid and sun toggles moved to where
  they are used.
- ![polish][polish] **Selection in the tree is easier to find.** The
  selected row sits on a faint accent wash that runs the full width, and
  the groups above it are clearly tinted instead of only hinted.
- ![polish][polish] **Unsaved is a dot** on the tab, yellow or green,
  instead of a pill.
- ![new][new] **Help clips** for Split and Select hidden parts, and a
  re-cut one for Smart fit. The app's own pictures and clips are now kept
  by the browser between reloads and only checked for changes.
- ![new][new] **Drop overlay** on the viewport while a file is dragged in.
- ![fix][fix] **Recent files keep their location** after a drag-and-drop,
  a re-pick, and when the file has changed size.
- ![refactor][refactor] **Section plane removed**, along with the clipping
  code it threaded through every material. Isolate, X-ray and Select
  hidden parts are the ways to see inside a model.
- ![refactor][refactor] **Stylesheet consolidated** — overridden and dead
  rules removed, duplicate selectors folded. No visual change.

## v0.11.0

v0.10 made the app fast. This one changes how it is *used*. Scenes open
in tabs, tools appear where you are working instead of sitting in a
sidebar, every number can be dragged, and one Settings window replaces
three places that used to hold options. The interface is darker,
quieter and more of one piece — and Fill holes, the tool people came
for, got options and a much harder test. Underneath, a speed pass on a
5.4-million-triangle assembly took the pauses out of orbiting, selecting,
scrolling the tree and switching view modes.

**Highlights**

- ![new][new] **Scene tabs.** Every tab is a scene of its own, with its own
  parts, materials, undo history and camera. *New scene* and *Open* never
  replace a scene that has something in it — they open a tab. A spare
  tab is kept warm in the background, so a new one is there at once, and
  switching does not reload anything. The tab shows the scene's name
  (double-click to rename) and an **Unsaved** pill that saves on click;
  hover a tab and its icon becomes the close button.
- ![new][new] **Command panels.** Split and Fill holes are no longer cards in
  the sidebar. Run the command — `X`, `P`, the search, the right-click
  menu, the toolbar — and its panel appears over the bottom-left of the
  viewport, the way Plasticity does it. `Enter` runs it, `Esc` puts it
  away (and only then clears the selection).
- ![new][new] **Fill holes shows itself.** A six-second silent loop runs
  across the top of its panel and dissolves into the card: the holes of a
  real part closing a few at a time (90 KB). It plays only while the
  panel is open.
- ![new][new] **Fill holes, advanced.** An *Advanced* fold in the panel: fill
  through holes, blind holes and open holes separately; ignore holes
  under a size; a depth limit; a flatness tolerance for meshes whose
  flat faces are not quite flat; and a switch for the rule that keeps
  openings which shape the part. Stress-tested on a 5.4-million-triangle
  assembly across nine option sets — 334 meshes compared edge by edge
  before and after, none left with a new open edge — and two ways it
  could have left a crack are closed for good (see Fixes).
- ![new][new] **Everything a number can be dragged.** Shape parameters take one
  line each: no slider underneath, drag the number or its label
  sideways, click to type. Shift is ten times faster, Alt ten times
  finer. The size limit of Fill holes and the numbers beside the sidebar
  sliders work the same way.
- ![new][new] **One Settings window.** General, Viewport, Camera, Performance,
  Scene and Storage in one place, with a search across all of them. The
  viewport's display popover and the separate Scene settings window are
  gone — their controls moved in, so nothing changed underneath.
- ![new][new] **Properties always has something to say.** With nothing selected
  it describes the scene. With a selection the triangle count leads the
  card, and when triangles were saved that is the headline: "21,688
  triangles −34% · was 32,728 · saved 11,040", the share of the scene,
  and where the part ranks by weight.
- ![new][new] **All commands in one list.** The "…" at the end of the bottom
  toolbar opens every command that acts on the model, with its shortcut;
  what cannot run right now is dimmed. The search is its own popup,
  standing on its button, with suggestions that follow what is selected.
- ![new][new] **Shortcuts that make sense together.** `H` hide · `Shift+H` hide
  the rest · `Alt+H` show all · `S` isolate · `X` split · `P` fill holes
  · `Ctrl+M` merge · `Ctrl+B` smart fit · `Ctrl+Shift+G` ungroup ·
  `Ctrl+I` invert selection · `Ctrl+E` export · `Shift+M` materials. One
  table, exact combinations, nothing fighting (Ctrl+R no longer also
  switched the gizmo; `S` over the tree no longer did two things).

**Also new**

- ![new][new] **What an action saved** shows beside the triangle count for a few
  seconds: "−427,543 (−38%)".
- ![new][new] **Isolate says so:** a pill at the top of the viewport reads
  "Isolated · 3 of 1,583 parts"; click it to show everything again.
- ![new][new] **Materials dock can be resized** — drag its top edge and the edge
  of its inspector; both are remembered, double-click resets.
- ![new][new] The bottom toolbar never runs into the shortcut tips: when it
  would, the tips step aside; on a viewport narrower than the toolbar
  itself, buttons fold away from the right into the "…" list.
- ![new][new] **The tree scrolls sideways, and its indent holds still.**
  The indent used to be recalculated from the width of the sidebar and
  the depth of the hierarchy, so the whole tree slid left and right
  while a sidebar edge was dragged; and long names ended in an ellipsis.
  The indent is now one fixed step per level and names are shown in
  full. When a row is wider than the panel a scrollbar appears under the
  tree (Shift + wheel and a sideways swipe work too): the names slide,
  the eye and colour column stays where it is.

**Fixes**

- ![fix][fix] **Material names keep up.** A new material is named after its
  colour (it used to get a random code that looked like one) and such a
  name follows the colour. Applying a preset — or undoing one — while
  the editor is open refreshes the editor's name, colour, sliders and
  preview; undo gives the name back too.
- ![fix][fix] **Fill holes can no longer leave a crack.** A fill is accepted only
  if every edge it cuts is covered by a cap and every cap can be closed
  completely; and the zero-area stitch triangles CAD meshes carry are
  removed with the wall they were stitched to instead of being left
  hanging.
- ![fix][fix] A scene made only of added shapes showed 0 triangles in the status
  bar and no viewport statistics.
- ![fix][fix] The start screen's four shape tiles all showed the torus: their
  thumbnails were rendered at the same time through one shared mesh.
- ![fix][fix] The status bar and Properties gave different sizes for the same
  mesh data right after loading; both count shared geometry once now.
- ![fix][fix] Dragging a number in Shape parameters could go on following the
  mouse after the button was released, and a click did not always put
  the caret in the field.
- ![fix][fix] Tooltips inside a command panel appeared instantly and cut to the
  first words, like the toolbar's; they now wait and show the whole tip.
- ![fix][fix] **Undoing a group could throw its parts across the scene.**
  A selected part hangs on the move gizmo's pivot, and the undo entry of
  a new group recorded that pivot as the part's parent. Group some parts,
  select something else, press Ctrl+Z: the grouped parts jumped (1,300
  units in the test) and stayed attached to the gizmo. The gizmo now lets
  go before the entry is recorded. The same for groups in a flat list.
- ![fix][fix] **Redoing "group a group" moved everything inside it.** Clicking
  a group selects its parts, so grouping it also listed every part in it;
  redo re-attached each of those parts to the new group with a matrix
  meant for its old parent. Only what the action really moved is redone.
- ![fix][fix] **Hide selected (`H`) is an undo step.** It had none: Ctrl+Z
  after `H` undid whatever came before it.
- ![fix][fix] The flat-list rule that hides the expand column no longer
  depends on which rows happen to be filled.

**Faster**

A speed pass, measured in Chrome on a 1,583-part, 5.4-million-triangle
assembly in two forms: flat, and with its full hierarchy (2,768 groups,
ten levels deep). Every number below is that model on one machine.

- ![perf][perf] **Group dots are one draw.** Every group has a dot at its
  origin, and each dot was a sprite of its own: 2,768 extra draw calls
  per frame on the nested model, four fifths of the frame. They are now
  one instanced sprite. Orbiting went from 47–50 fps with dropped frames
  to the display's full rate.
- ![perf][perf] **Group origins in one pass.** They were worked out by walking
  the whole tree once per group, and that was repeated once per group on
  every selection change. A click on a part took 64 ms; it takes 8–10.
  The same loop was the 4.5-second freeze while a nested model opened.
- ![perf][perf] **The tree keeps its rows.** A rebuild used to throw every
  row away and make it again. Rows that are still needed are now kept
  and corrected, the ones whose place changed are moved, and the browser
  is no longer asked for a layout in the middle of it. Hide, isolate and
  show all: 55 ms → 16–20. Undo or redo of a group: 115 ms → 24.
  Grouping 445 parts: 137 ms → 63. Typing in the search: 170 ms → 35–55.
- ![perf][perf] **The tree scrolls as a layer.** It had a see-through
  background, so the browser repainted every visible row on each scroll
  step; and every row was `content-visibility:auto`, which with 4,350
  rows cost more per frame than it saved. Rows away from the view are
  plain empty boxes, rows are filled a screenful ahead rather than one
  per scroll step, and rows left far behind are emptied again. Wheel
  scrolling dropped 28 % of frames; it now drops about 1 %.
- ![perf][perf] **Fewer, larger instance groups.** A shape that repeats was
  drawn as one instanced object from three copies up. Each such object
  needs a shader and a GPU pipeline of its own, rebuilt on every change
  of view mode: 106 of them on the nested model, 2.7 seconds frozen per
  switch to wireframe or x-ray. Instancing now starts at 32 copies.
  A switch takes 0.3–0.5 s, and the frame rate is unchanged.
- ![perf][perf] **X-ray draws each surface once**, not twice (its blending has
  no order, so one pass gives the same picture).
- ![perf][perf] **Select all on an assembly with instances** refreshed every
  matrix in the model once per instance: half a second the first time.
  It refreshes the one mesh it has just made.
- ![perf][perf] **Dragging a sidebar edge** set a variable on the page root on
  every mouse move, which restyled the whole document several times per
  move (15 fps). The width is applied once per frame, directly, and the
  variable is set when the drag ends: 20–30 fps on the nested model's
  4,350-row tree, where every row still has to be laid out at the new
  width. Dragging the materials dock is once per frame too.
- ![perf][perf] The shortcut tips are measured in the next frame instead of
  in the middle of a selection change (13 ms per change saved), the
  document tab is aligned without laying the page out twice, and numbers
  in the tree are formatted by one shared formatter.
- ![perf][perf] The split preview no longer runs on every selection change — only
  while the Split panel is open.
- ![perf][perf] The Materials card in the sidebar is gone, and with it a rebuild of
  its list on every change to the tree.

**Look**

- ![polish][polish] The interface black is `#101010`, floating surfaces `#161616`:
  menus, popups, tooltips, dialogs and panels are one darker tone.
- ![polish][polish] No pure-white text on controls — one set of tokens
  (`--tx-control…`) for buttons, dropdowns, fields and menu rows.
- ![polish][polish] Flat slider dots, no outlines around sidebar cards, Properties as a
  fixed dark card, tighter tree rows (25px), every control in the
  materials bar one height, grey instead of blue for what is switched on
  in the bottom toolbar (blue stays for the active tool).
- ![polish][polish] Export sits on the right with Screenshot; Undo and Redo are
  keyboard-only; the start screen uses the plain white mark.

**Removed**

- ![polish][polish] **The GPU path tracer** (the Render button, `pathtracer.js` and the
  second three.js build only it used). Nothing is fetched from a CDN at
  start-up any more.
- ![polish][polish] The Materials card in the right sidebar (the dock is the one place
  for materials), the "N parts in hierarchy" line, the viewport settings
  popover and the Scene settings window (both now in Settings).

**Tests**

- ![new][new] 41 in-app tests (was 31) and 88 hole-filler checks (was 76): scene
  tabs, command panels, dragging numbers, the scene card and triangle
  delta, isolate, material names and presets, the fill options and the
  stitch-triangle case; a rebuilt tree equals one built from nothing
  after every kind of change; group dots are one draw; group undo and
  redo leave every part in place; Hide is one undo step.
- ![docs][docs] A performance driver in `tests/perf/` measures frame gaps under
  real input in a Chrome it starts itself.

## v0.10.1

- ![perf][perf] **Starts without the internet.** The libraries the app
  needs to start are bundled in `vendor/` instead of being fetched from
  a CDN on every launch: three.js r172 (both builds and the add-ons in
  use), three-mesh-bvh, meshoptimizer and the lucide icon set — 37
  files, 4.2 MB, each with its licence. Startup no longer waits on
  unpkg, and the app opens, edits and exports with no connection at
  all. Still fetched on demand: the path tracer, the KTX2 texture
  transcoder and the in-browser STEP / glTF-Transform / Assimp
  converters.
- ![fix][fix] **The icon set is pinned** (lucide 1.52.0). It was loaded
  as "latest", so an upstream release could rename or drop an icon
  without warning.
- ![polish][polish] Text on buttons, dropdowns and slider values is a
  soft grey instead of white (it brightens on hover); two-button rows
  split evenly, including the Smart fit / Merge row; a slider's value
  field keeps its size when you click it to type.

## v0.10.0

The biggest release so far. v0.9.0 made the app trustworthy; this one
makes it *fast* and gives it tools it did not have. There is a real
hole filler now, a proper materials panel, a decimator that keeps your
normals and UVs, and a parts tree that keeps up with 5 million
triangles — plus a long list of bugs that only show up on real
assemblies, found by working through one.

**Highlights**

- ![new][new] **Fill holes.** One click closes the bolt holes, slots,
  pockets and engraved lettering in flat faces and leaves the rest of
  every mesh untouched. It can tell a hole from a boss, from the bore of
  a washer and from an opening into a cavity. 4,136 holes — 427,543
  triangles — gone in about two seconds on the test assembly.
- ![new][new] **Decimate, rebuilt** on meshoptimizer: keeps normals, UVs
  and colours, takes a triangle budget, and its result reaches the
  export.
- ![new][new] **Materials dock** — slides up like the console: filter,
  sort, inspect, select or isolate the parts that use a material,
  assign it to the selection.
- ![perf][perf] **Everything you touch is immediate.** Selecting,
  hovering, deleting, undoing, switching views, dragging a slider: each
  was measured on a 1,583-part / 5.4M-triangle assembly and the slow
  step removed. Heavy tools run in background workers.
- ![fix][fix] **The hierarchy shows what is there.** Empty groups stay
  listed, the tree scrolls in one direction with everything lined up,
  and every editing action can be undone.
- ![polish][polish] **A calmer interface** — Plasticity-style viewport
  and view cube, one button scale, three corner radii, Inter bundled,
  fewer pop-ups.

**Fill holes**

- ![new][new] **Fill holes** (Optimize card, and the command palette)
  closes holes in flat faces and leaves the rest of each mesh exactly as
  it is — no remeshing, no decimation. It finds the flat faces, the
  loops cut into them and the surface behind each loop, and only acts
  when that surface is a hole:
  - through holes, blind holes, counterbores, slots, pockets and
    engraved lettering are closed; a counterbore or a pocket with a hole
    in its floor goes as one feature or not at all;
  - a boss or pin standing on a face is left alone (it rises above the
    face instead of sinking into it);
  - an opening that is what the part *is* — the bore of a washer, a nut
    or a bushing — is left alone (it is wide both for its face and for
    the part as a whole);
  - an opening that leads into a cavity or out through a curved surface
    is left alone;
  - plunged and flow-drilled holes, which are a plain hole on one side
    and a collar on the other, are filled from the hole's side and the
    collar stays;
  - "up to N mm" sets the largest hole, measured across its widest
    point.
  The cap is triangulated flush with the face from the face's own
  vertices, so normals, UVs, vertex colours and material ranges carry
  over and the mesh stays closed. Works on the selection, or on every
  visible part when nothing is selected; one undo step; the result is
  what gets exported. The search runs in background workers: on the
  1,583-part test assembly at 12 mm it closes 4,136 holes in 438 parts
  (427,543 triangles fewer) in about two seconds, and none of the 110
  changed meshes that were checked gained an open edge.

**Decimate**

- ![new][new] **meshoptimizer simplifier** — reduction runs on the index
  buffer and keeps normals, UVs and vertex colours (the old path
  stripped parts to bare positions). Multi-material parts keep their
  material ranges. Falls back to the basic simplifier offline.
- ![new][new] **Target…** — a triangle budget for the whole selection,
  next to the −25 … −90% presets, with a live "12,400 → about 6,200
  triangles" readout.
- ![perf][perf] Runs in background workers, several parts at a time; the
  page stays responsive during a large run.

**Materials**

- ![new][new] **Materials dock** — the materials panel was a 228 px
  popover that ran off the top of the viewport. It is now a dock that
  slides up from the bottom like the console, as wide as the viewport:
  filter by name, colour or type; order by use, triangles, name or
  colour; a grid that uses the whole width; and an inspector for the
  picked material (colour, roughness, metalness, opacity, textures, how
  many parts and triangles use it) with Edit, Select parts, Isolate and
  Assign to the selection. The bottom toolbar and the tips ride up with
  it; the console and the dock take turns.

**Parts tree and groups**

- ![fix][fix] **The tree hides nothing.** A group vanished from the
  hierarchy as soon as it had no live parts — after its parts were
  dragged out or deleted — although it still existed in the scene. Every
  group is now listed; one with nothing in it says "empty" and can be
  filled again, renamed or deleted. Empty containers in an imported file
  are listed too.
- ![fix][fix] **Deleting a group deletes the group.** Delete on a
  selected group, and "Delete group" in the context menu, remove the
  group row with its contents, and one undo brings both back. (Deleting
  only the parts inside a group leaves the group, empty.)
- ![new][new] **Settings → Delete groups when they become empty** (off by
  default). When on, a group that held something before an action and
  holds nothing after it is removed with that action — one undo restores
  both. Groups that were already empty are never touched.
- ![fix][fix] **Parts tree scrolls in one direction.** It used to scroll
  sideways with the eye / colour column pinned to the right edge; rows
  were as wide as their own text, so pinning only worked for long rows —
  scrolled sideways, the eyes of short rows slid left while the others
  stayed, and the pinned column trailed behind the wheel. Every row is
  now exactly as wide as the panel, the icon column is an ordinary last
  cell, long names end in an ellipsis (the full name shows on hover),
  and deep hierarchies get a narrower indent step instead of running
  off the edge.
- ![polish][polish] **Parts tree** — neutral icons, selection shown on
  the label and icon in the accent blue, group rows show their part
  count, more room at the right edge. Only the row that was clicked is
  bright: clicking a group hints the parts inside it instead of lighting
  them all up, and parents of a selected part are hinted the same way.
- ![polish][polish] **Parts search** has a clear button, is dimmed while
  empty and idle, and the six buttons under it span the panel's width.
- ![fix][fix] **Import → Append keeps the existing tree** instead of
  moving every existing part into "Untraced"; totals and model size
  cover the whole scene afterwards. A failed load no longer turns the
  next Open into an append, or replaces the file Revert reloads.

**Speed**

- ![perf][perf] **Selection is immediate on large models.** Every
  selection change re-created every icon in the document (about 90 ms on
  a 1,500-part tree); icons are now rendered once. Selection outlines no
  longer block the click: cached edges are drawn at once, small parts
  are built inline within a few milliseconds, and anything heavier gets
  a bounding box while its edges are computed in a worker. On the
  1,583-part assembly a click went from ~140 ms to under 15 ms, and the
  first click on a 125k-triangle part from a one-second freeze to none.
- ![perf][perf] **Highlight and gizmo appear with the press.** A tree row
  is selected when the mouse button goes down rather than when it comes
  back up, and the outline and gizmo are rebuilt before the next paint
  instead of one frame later. Outlines of heavy parts are computed in
  the background after a model loads, so the first click on a large
  part shows its real outline at once. Measured on the same assembly:
  selected 4–8 ms after the press, outline and gizmo ready by 15 ms.
- ![perf][perf] **Hovering the parts tree keeps up with the pointer.**
  Finding the row under the cursor walked all 1,500+ rows — about 7 ms
  each time, several times per mouse move, so a row lit up some 22 ms
  late. Off-screen rows are now skipped (`content-visibility`); the same
  measurement is 0.3 ms and hover starts within about 2 ms.
- ![perf][perf] **The parts tree only builds the rows you can see.** A
  rebuild used to write every row and then replace ten thousand icon
  placeholders: 325 ms on a 4,350-row tree, paid again by every undo,
  search keystroke and visibility toggle. Rows are now empty shells
  until they scroll into view and icons are CSS masks. A rebuild takes
  about 60 ms, and undoing a 710-part delete went from 700 ms to 80.
- ![perf][perf] **Delete is immediate.** Deleting parts rebuilt the tree
  twice (once hidden inside the "recount flagged parts" step). The rows
  of the deleted parts are now taken out and the group counts updated in
  place: about 30 ms for 710 parts instead of 780, with a result
  identical to a full rebuild.
- ![perf][perf] **Fill holes and Decimate run in background workers**,
  up to four meshes at a time. A whole-model hole fill went from 4–5
  seconds of frozen page to 1.7 seconds of a page that still responds.
  Where workers cannot start, the tools run on the page as before.
- ![perf][perf] **Switching between Cam, Top, Front and Side is
  instant.** Each switch built a new camera, and the renderer prepares
  every part again for a camera it has not seen — seconds on a large
  model, every time. One camera now changes its projection in place; the
  first frame after a switch costs the same as any other frame.
- ![perf][perf] **No stalls after loading.** The pick-acceleration trees
  were built 25 meshes at a time with rendering paused. They are now
  built in 8 ms slices while the browser is idle, without touching the
  buffers the renderer uses.
- ![perf][perf] **The size-threshold slider recounts when it is let
  go**, not on every pixel of the drag, and no longer rebuilds the tree.
  The Delete button reads "Calculating…" until the new count is in.
- ![fix][fix] Collapsing and re-expanding a group no longer brings the
  rows of deleted parts back.

**Viewport and camera**

- ![polish][polish] **Viewport** — Plasticity's cool grey background
  (`#28282b` on screen; the old value came out near-black); a view cube
  in the top-right corner, sitting in the corner of its three axes with
  a labelled dot at the end of each — click a dot or a face to look
  along that axis; triangle statistics moved to the
  top-left as a quiet readout; the grid toggle left the toolbar (`G`
  and the command palette still switch it); nothing drawn over the
  viewport can be selected as text.
- ![new][new] **View cube** — click a dot or a face for the orthographic
  view along that axis; the view pill names it (Top, Bottom, Front,
  Back, Side, Left). Orbiting out of an axis view returns to the
  perspective camera from where you are, at the same size on screen —
  it used to be locked until you picked "Cam". The face under the
  pointer takes its axis colour.
- ![polish][polish] **Viewport toolbars** — two dark pills in the manner
  of Plasticity: tools down the left edge, display controls along the
  bottom centre with a search button that opens the command palette.
  Contextual shortcut tips sit, faintly, at the bottom right; the
  triangle readout moved to the top right.
- ![polish][polish] **Floor grid** adapts to zoom the way Cinema 4D,
  Blender and Houdini do: finer lines fade out and the next decade
  takes over, so density on screen stays constant and the horizon no
  longer shimmers. Quieter overall.
- ![polish][polish] The selection box is a soft blue pane with a thin
  dashed edge and square corners.
- ![fix][fix] **The move readout showed "Y +0.00" and "Z +0.00"** while
  dragging a part that is rotated: it read the travel along the wrong
  axes. Move and rotate readouts now follow the gizmo's own axes.
- ![polish][polish] Scrollbars have no arrow buttons; tooltips on the
  viewport tools appear at once and show only the name and the
  shortcut, beside the tool pill rather than over its icons; group names
  are a soft grey instead of white; the renderer picker ends level with
  the sidebar.

**Interface**

- ![new][new] **The command search finds every sidebar control.** Every
  button, dropdown, slider, switch and field in the sidebars is listed
  under its card's name when the palette opens (read from the page, so
  it cannot fall out of step). A button entry runs the button; any
  other entry opens its card, scrolls to the control and focuses it.
- ![polish][polish] **Startup screen** redesigned in two columns: drop
  zone, Open / Import / New, start from a shape, and three option
  switches on the left; resume and a filterable recent-files list on
  the right.
- ![polish][polish] **Top bar** — Add, Cloner and Fit are gone (shapes
  are added from the tool pill, Cloner from the command palette);
  Screenshot and Render sit on the right, ending at the viewport's
  edge. The status bar spans the viewport only, so both sidebars run
  to the bottom of the window.
- ![polish][polish] **Top bar and edges** — the app icon is a plain
  white mark with a menu arrow instead of a blue tile; the sidebar
  toggle's pressed state is a quiet fill, not a glowing ring; the right
  sidebar starts and ends level with the viewport, and so does the
  search field; the FPS readout sits beside Console and keeps its
  width.
- ![polish][polish] **Three corner radii for the whole page** — 4px for
  tiny chips, 6px for every control, 10px for every container (cards,
  menus, tool pills, the viewport, dialogs, docks). The page used
  thirteen values between 2 and 16px.
- ![polish][polish] **One surface for everything that floats** — menus,
  popovers, tooltips, toasts, dialogs and windows take their colour,
  radius, ring and shadow from a single set of `--surface-*` tokens
  instead of each defining its own.
- ![polish][polish] **Inter is bundled** (`vendor/inter`, SIL Open Font
  License), so the app looks the same on every machine, and nothing in
  the interface is bold.
- ![polish][polish] **Fewer status messages.** Everyday edits — delete,
  paste, duplicate, group, add a shape, new scene — no longer pop a
  toast; the result is on screen already. They are still written to the
  log console. Toasts remain for what you could not otherwise see:
  clean-up and mesh-operation results, files written, the reason a
  command did nothing, and every warning and error.
- ![polish][polish] **Card headers** have a real chevron in a small hit
  area instead of a 7px text triangle, centred on whole pixels, with
  equal space above and below; sliders keep the normal pointer over the
  thumb as well as the track.
- ![polish][polish] **Shape picker** uses flat line icons like the rest
  of the toolbar (it showed small shaded renders) and opens beside its
  button.
- ![polish][polish] Properties rows fit on one line (Diagonal removed),
  the viewport has rounded corners, the right sidebar scrolls without a
  scrollbar and clips its cards on rounded corners, the app icon is the
  same size as the other top-bar buttons, sliders keep the normal
  cursor, and keyboard focus shows one consistent ring.
- ![fix][fix] **Small windows** — the right sidebar was pushed off the
  edge when the window got narrow (the status bar's text held the
  viewport column open). The column now shrinks; the status bar drops
  the vertex and memory counts, then the file name, instead of wrapping
  or overlapping; the shortcut tips fold into one column and move above
  the bottom toolbar rather than sitting on top of it.

**Fixes**

- ![fix][fix] **A second geometry edit on the same part could stop the
  viewport from drawing** ("setIndexBuffer … is not of type GPUBuffer",
  every frame). The WebGPU renderer decides whether an object's buffers
  need uploading by comparing attribute names and version numbers, not
  the geometry's identity, so a freshly built geometry that replaced
  another freshly built one went unnoticed whenever the part shared its
  material with other visible parts. Every tool that swaps geometry
  (Fill holes, Decimate, Smart fit, bake, and their undo / redo) now
  gives the new geometry version numbers of its own.
- ![fix][fix] **The remaining gaps are closed** — values typed into the
  transform panel (steppers, wheel and Reset included; a held stepper is
  one step), tree drag-and-drop, the eye icon on a group row and every
  other visibility toggle, Materials-panel Add / Duplicate / Merge /
  Delete / presets, context-menu "Rename group" and deleting an empty
  group are all undoable.
- ![fix][fix] **Visibility toggles reach instanced parts** — the eye
  icon, Hide unselected, group toggles and hide-by-colour all go through
  one helper.
- ![fix][fix] **Cloner copies are exported and saved** (only the source
  part used to be written). Exports also reuse one material per
  (material, colour) pair instead of one per part, "Origin: bbox centre"
  is centred correctly, and a merged export keeps mirrored parts facing
  outward.
- ![fix][fix] **Cancel stops a STEP conversion** — the loader's Cancel
  ends the polling and kills the converter on the server
  (`POST /api/cancel/<job>`); opening another file does the same. A
  conversion can no longer finish later and replace the scene, and the
  loader no longer polls forever after a server restart.
- ![fix][fix] Adding a shape highlighted the previously selected row in
  the tree instead of the new part.
- ![fix][fix] Undoing the creation of a selected group left Properties
  showing a group that no longer existed ("Group -2").
- ![fix][fix] Opening the Export menu flipped the arrow on the **File**
  button instead of its own (both wrappers share a class and the code
  took the first one).
- ![polish][polish] The "Instances promoted" notice goes to the log
  console instead of popping a toast on every click.

**Testing**

- ![new][new] **`tests/selftest.js`** — open the app with `?selftest` to
  run 31 regression tests inside the live app (groups, flatten, every
  undo path, export, save round trip, import-append, decimate,
  shortcuts, selection speed). `?selftest=groups` runs a subset.
- ![new][new] **`tests/holefill.test.mjs`** — `node tests/holefill.test.mjs`
  checks the hole filler on shapes built in the test (through, blind,
  counterbored, pockets, engraved letters, a boss, a washer, a hollow
  box): the result must be closed, the right volume, and untouched
  where it should be.

**Known issues**

- Fill holes works on flat faces; holes in curved surfaces are left
  alone. A flow-drilled hole is closed but its collar stays, as a small
  stub on the inside.
- Merge cannot be redone after an undo.
- Dragging a part out of a cloner is not undoable, and undoing a cloner
  does not always return its sources to their original group.
- Values typed into the transform panel do not refresh a group's stored
  origin on undo.
- A newly created group appears collapsed.
- `serve.py` never clears converted files out of `inbox/`.

## v0.9.0

v0.8.0 modernised the plumbing. v0.9.0 is a *reliability* release: a
stress test on a 1,583-part / 5.4M-triangle assembly plus three code
audits turned up tools that destroyed geometry, exports that ignored
edits, and a group of actions that Ctrl+Z could not undo. Those are
fixed. The interface also gets one button scale, readable secondary
text, and a full proofreading pass. The app is now called
**MeshOptimiser** everywhere.

**Data loss and wrong output**

- ![fix][fix] **Decimate destroyed parts** — the removal count was taken
  from the un-indexed corner count (three per triangle) instead of the
  welded vertex count, so at −50% most parts were reduced to zero
  triangles. −25 / −50 / −75% now remove that share (a 2,208-triangle
  sphere becomes 1,656 / 1,102 / 550).
- ![fix][fix] **Decimate never reached the export** — the reduced
  geometry was not registered under the part's hash, so export, merge
  and the memory readout still used the original mesh. Export now reads
  the geometry the part is actually drawing.
- ![fix][fix] **Save scene lost its state** — the state marker node was
  flagged invisible and `GLTFExporter` skips invisible objects, so the
  camera, view settings, hidden parts and measurements were never
  written. Hidden / flagged state now travels on each part's own node,
  so duplicate part names can no longer mis-assign it.
- ![fix][fix] **Save scene mangled names and nested the scene** — glTF
  loaders rewrite node names (`Group 2` → `Group_2`, `Cube.001` →
  `Cube001`) and every save / reopen wrapped the scene in one more
  `Group`. Real names are stored in node extras and restored on load;
  the wrapper is gone. Two consecutive round trips now return an
  identical tree.
- ![fix][fix] **Exporting in Wireframe / X-ray / Heatmap** baked the view
  mode into the file (line primitives, see-through or heat-coloured
  materials). Export and Save scene run in Solid and restore the view
  mode afterwards.
- ![fix][fix] **Recenter and Center pivot did not reach the export** —
  the exported file kept the old positions. Bake transforms also
  displaced parts that sat under a moved parent.
- ![fix][fix] **PLY export hung on "Preparing export…"** whenever the tab
  was in the background. Long jobs (load, decimate, screenshots) no
  longer stall in a background tab either.
- ![fix][fix] **Hidden instanced parts exported with NaN transforms**;
  they now export from the matrix they were built with.
- ![fix][fix] **Bake / Center pivot on shared geometry** — a part that
  shared its buffer with another part (any duplicate) was transformed
  twice, or moved a part that was not selected. Shared buffers are now
  copied before they are edited.
- ![fix][fix] A new model no longer inherits the previous model's
  Recenter offset, and Save scene no longer silently overwrites the
  previous model's file.
- ![fix][fix] An export that fails before the writer starts now takes
  the loader down and reports the error instead of leaving
  "Preparing export…" on screen.

**Undo / redo**

- ![fix][fix] **Six tools pushed no undo entry**, so Ctrl+Z reverted an
  older, unrelated action: Decimate, Recenter on origin, Bake
  transforms, Center pivot, Recompute normals and Delete empty groups.
  All six now undo and redo.
- ![fix][fix] **Undo of Isolate / Show all / Hide unselected** now
  restores instanced parts as well.
- ![fix][fix] **Redo of Smart fit and Paste group** no longer discards
  the rest of the redo stack; a co-fitted sibling is restored to its
  real parent.
- ![fix][fix] A change too large to keep an undo copy of now clears the
  history (with a notice) instead of leaving Ctrl+Z pointing at an
  older step.

**Groups, Flatten and cleanup**

- ![fix][fix] **Flatten and "Delete empty groups" now work from the
  tree.** Selecting a part moves its mesh out of its group in the scene
  graph, and both tools trusted the scene graph: "last level" and
  "keep N levels" over-flattened, rows reshuffled, and a group full of
  live parts could be judged empty. All five Flatten modes, scoped and
  whole-tree, pass with undo and redo; rows keep their order and group
  ids.
- ![fix][fix] **Grouping parts from different levels** no longer pulls
  the outside part into the first part's group; the new group is
  created at the level the selection shares.
- ![polish][polish] A flatten that changes nothing says why instead of
  reporting success, "Preserve user groups" defaults off when every
  group is one you created, and the depth readout is no longer off by
  one.
- ![polish][polish] **Group rows show their part count**, so a collapsed
  group says what it holds. New groups no longer reuse a name.
- ![polish][polish] **Cinema 4D-style nesting** — a child's icon sits one
  step in from its parent's and the connector runs right up to it; a
  flat list drops the empty arrow column.

**Selection, shortcuts and measuring**

- ![fix][fix] **The ruler only measured on Ctrl+click** while the
  on-screen hint said "Click two points". A plain click now picks,
  dragging still orbits, and picking no longer changes the selection.
- ![fix][fix] **Delete acted on the scene behind an open dialog**, and
  Ctrl+S also toggled Isolate. Global shortcuts are ignored while a
  dialog is open or a dropdown has focus.
- ![fix][fix] **Shift-click range** no longer sweeps up rows hidden by a
  search or a collapsed group; a search shows matches inside collapsed
  groups; selection back / forward never restores deleted parts.
- ![fix][fix] Wrong shortcut hints: move / rotate / scale are `E` / `R`
  / `T` (not `W` / `E` / `R`), and Reveal in tree is `Shift+S`.
- ![fix][fix] "% of model" showed 173% for a single cube in a new
  scene; it now measures against what is in the scene.
- ![fix][fix] Three sidebar cards (Selection & actions, Auto cleanup,
  Optimize) would not collapse.
- ![polish][polish] The Measurements card only appears while there is a
  measurement to list.

**Interface**

- ![polish][polish] **One button scale** — every button, dropdown
  trigger and close button uses three sizes (26 / 32 / 40px) from
  tokens at the end of the stylesheet. Heights previously ran from 17 to
  40px, text from 10 to 13px and radius from 4 to 8px depending on the
  panel. Full-width action buttons are left-aligned so their icons form
  one column.
- ![polish][polish] **Readable secondary text** — tertiary text (labels,
  triangle counts, status bar) measured about 3:1 against the 4.5:1
  minimum and now passes. Accent-coloured text uses a lighter tint;
  fills and borders keep the brand colour.
- ![polish][polish] **Selected rows** get a filled background as well as
  the label colour, and keyboard focus shows one consistent ring.
- ![polish][polish] More room at the right edge of the parts list.
- ![polish][polish] The top bar uses the same dark surface as the two
  sidebars.
- ![polish][polish] **Menus restyled** — every dropdown and context menu
  is a dark rounded panel with a solid accent bar under the pointer and
  white text; shortcuts are plain text at the right, and menus that pick
  a value mark the current one with a check.
- ![polish][polish] **New primary colour** — the accent is now blue
  (`#0d99ff`) instead of indigo, across buttons, sliders, highlights and
  the primitive thumbnails.

**Copy**

- ![docs][docs] **Proofreading pass** — about a hundred corrections to
  labels, tooltips, toasts and loader messages: stale or wrong
  information (the Add tooltip listed a shape that isn't in the menu,
  Blender listed as Y-up, "Open or drop a .step file" ignoring seven
  other formats), self-contradicting tooltips, developer jargon in
  user-facing text, plurals ("1 parts"), and consistent American
  spelling and `…`.
- ![fix][fix] "Decimated" / "Decimate failed" toasts used a type with no
  styling; cancelling the path-tracer save showed "Render saved — null";
  every FBX load failure was titled "FBX too old to read".
- ![docs][docs] **Renamed to MeshOptimiser** in the app, launchers,
  server banner and exported-file headers. The default export name is
  now `mesh_optimised`. The saved-scene format id and browser storage
  keys are unchanged, so existing scenes and settings keep working.

**Known issues**

- No undo yet for: values typed into the transform panel, tree
  drag-and-drop, the eye icon on a group row, Materials-panel actions
  (Add, Duplicate, Merge, Delete, presets) and context-menu "Rename
  group". Ctrl+Z after any of these undoes the action before it.
- Import → Append replaces the existing tree hierarchy.
- Cloner output is not included in exports or saved scenes.
- Cancel does not stop a STEP conversion that is already running.
- The eye icon on a single part and "Hide unselected" have no visible
  effect on instanced parts.
- Merge cannot be redone after an undo.

## v0.8.0

v0.7.0 made *presentation and discoverability* feel modern. v0.8.0 makes
the *plumbing* feel modern: the floor grid rewritten as an
industry-standard ray-marched shader, a single keycap-chip primitive
that ties every shortcut surface together, the undo system rebuilt as a
flat command registry (no more wrapper chains), and every runtime-
injected `<style>` block lifted out of the JS and into the stylesheet.

**Viewport — ray-marched infinite grid**

- ![new][new] **Ray-marched floor grid** — `_makeShaderGrid` rewritten
  to the industry-standard pattern (Blender / Godot / Bevy / Fyrestar's
  `InfiniteGridHelper`). The shader runs on a fullscreen NDC quad,
  reconstructs the eye ray per pixel, intersects with the active plane,
  and writes its own analytic depth biased along the plane normal. No
  more `PlaneGeometry(2e6, 2e6)` losing vertex precision at distance, no
  plane edge to fall off the screen at oblique angles, no
  `polygonOffset` quirks under WebGPU — coplanar geometry (e.g. a cube
  bottom sitting at `z=0`) always wins the depth test cleanly.
- ![fix][fix] **Sub-pixel grid jitter under orbit** — the previous
  camera-follow shifted `mesh.position` by sub-pixel amounts every frame
  which shifted `positionWorld` of each vertex which made `fwidth()` /
  `fract()` read slightly different values per frame (visible 1–2 px
  shimmer along the grid lines). The ray-marched shader is camera-
  independent, so there's no mesh to drift.
- ![fix][fix] **Cube-on-grid Z-fight** — solved analytically by the
  shader's depth write + `uPlaneBias` instead of the previous
  `depthFunc:LessDepth` strict-less trick that occasionally lost ties.

**Keyboard shortcuts — unified across the app**

- ![new][new] **Redesigned Shortcuts modal** — sticky search input at
  the top, category headers with lucide icons (File / Edit / Selection /
  View / App), 2-column grid per group, multi-key combos rendered as
  separate keycap chips joined by a faint `+`. Footer hint points at
  the command palette. Opens via `?` or the logo-dropdown "Keyboard
  shortcuts" item.
- ![polish][polish] **`.kbd-chip` shared primitive** — single class now
  owns the keycap look on the bottom-center hint strip, tooltips, the
  command palette rows, the brand menu's mini-changelog, the Shortcuts
  modal, and the cmdk `↵` indicator. Combo splitting (`Ctrl+Shift+O` →
  three chips joined by `+`) is consistent everywhere.
- ![polish][polish] **Bottom-center hint strip — faint and chip-based**
  — transparent (no card chrome), each input verb (`Click`, `Drag`,
  `Scroll`, `Right-click`, `Esc`, `Shift`, `W` / `E` / `R`) renders as a
  small keycap chip. The hint reads as a row of pills instead of a
  paragraph of `<span>` separators.

**Selection & Actions card — Smart fit polish**

- ![polish][polish] **Smart fit + caret merged** — same background, no
  inner seam, rounded outer corners only. Hover lights each half
  independently (no `:has()` cross-highlight). Subtle hairline divider
  between them. Yellow accent scoped to `--ac → --wn` inside the
  popover so its sliders + checkbox match the warn-yellow trigger.
- ![polish][polish] **Smart fit dropdown sliders** — switched from the
  default 18 px white-thumb `<input type=range>` to the same
  `.scrub-range` 4 px track + 12 px accent thumb the sidebar's
  Threshold slider uses. Gradient fill animates with the value.
- ![polish][polish] **Sidebar card spacing** — Selection & Actions,
  Auto cleanup and Optimize cards converted from inline
  `<div style="height:Npx">` spacer divs to flex+gap on `.section-b`.
  Uniform 6 px gaps; no more arbitrary 6 / 10 mix.

**Fixes**

- ![fix][fix] **Tree summary stuck at "1 parts in hierarchy"** —
  `totalParts` was counting every part-kind tree node, including
  deleted-but-tracked ones. Now counts only live parts; deleting the
  last part correctly shows "0 parts in hierarchy".
- ![fix][fix] **Stranded group origin dot after delete** — when every
  part inside a group was deleted, the group's origin-dot sprite
  remained at the stale world position. The dot reconcile walk now
  bubbles "has live descendant" up the ancestor chain and skips groups
  with zero live parts.
- ![fix][fix] **Group selection no longer prompts for a name** — the
  toolbar "Group selection" button used to pop a "New group" dialog
  asking for a name. Now it acts exactly like the `Ctrl+G` shortcut:
  creates the group with `Group N` and lets you rename inline.
- ![fix][fix] **Path tracer on empty scene** — clicking the aperture
  button with no model loaded now toasts "Nothing to render — load a
  model or add a primitive first" instead of throwing `Scene is empty`
  into the console and opening a broken modal.
- ![fix][fix] **Material panel: add no longer toasts a confusing hint**
  — the "Material added — Select parts and use Duplicate to assign"
  toast is gone. Creating a material just creates it; the new entry is
  visually selected in the panel.
- ![fix][fix] **Material panel: duplicate works without a part
  selection** — duplicating a material previously demanded parts be
  selected ("Select parts first" toast). Now duplicate always clones
  the material into `state.userMaterials`; if parts happen to be
  selected they receive the clone as a convenience.
- ![fix][fix] **Material panel: merge cleans up properly** — absorbed
  materials are now removed from `state.userMaterials` and disposed,
  matching Delete's cleanup. Previously they lingered as zero-count
  ghost rows in the panel and leaked GPU resources.

**Internals — industry-standard rewrites**

- ![refactor][refactor] **All runtime `<style>` injections lifted into
  the stylesheet** — 8 blocks (~490 lines) across app dialog, Save
  Screenshot dialog, material editor popup, custom select widget,
  Advanced flatten dialog, `_DraggablePopup` chrome, Batch Rename
  dialog, and tree drag-and-drop. Every block lives under a labelled
  `── Section ──` comment header in `index.html`. No more sweep
  gotchas where the same CSS exists in two places.
- ![refactor][refactor] **Undo as a command registry** — 11
  monkey-patches around `undoLast` / `redoLast` collapsed into a single
  `_UndoOps.register('typename', {undo, redo})` dispatch table covering
  21 op types (boxify, merge, group, flatten, batchRename, duplicate,
  paste-group, measure-add / -delete / -clear, addPart, primParams,
  vis, hierGroup, hierUngroup, userGroupRemove, materialEdit, color,
  delete, split, transform, transformGroup, groupTransform). New op
  types now register with one call; no more 19-deep chain-of-
  responsibility indirection on every Ctrl+Z. The plugin-facing
  `_appHooks.undoHandlers` extension API (used by `cloner.js`) is
  preserved by design.
- ![refactor][refactor] **Renderer lifecycle owner** — `_RendererOwner`
  module encapsulates create + apply-config + device-lost glue. The
  fallback retry no longer duplicates the option list; `applyConfig`
  is re-usable for any future rebuild path.
- ![refactor][refactor] **Popover dismiss helper** — `_Popover.dismiss`
  centralises outside-click + Escape for the context menu, brand menu,
  export menu, and add-primitive menu. ~20 lines of duplicated
  `addEventListener('click') / keydown` boilerplate gone. Future
  popovers declare intent (containers, isOpen, capture, escape) instead
  of owning the glue.
- ![refactor][refactor] **Right-click context menu CSS** — `_ctxBuild`
  used to write `row.style.cssText` and add per-row `mouseenter` /
  `mouseleave` listeners. Replaced with proper `.ctx-menu-row` /
  `.ctx-menu-sep` / `.ctx-menu-icon` classes and a CSS `:hover` rule.
  Shortcut chips inside rows reuse `.kbd-chip` for consistency.
- ![refactor][refactor] **Off-grid design tokens audit** — dropped 5
  unused space tokens (`--space-3`, `--space-5`, `--space-9`,
  `--space-11`, `--space-18`). The remaining off-grid escape hatches
  (`--space-7` and `--fs-9/10/11/12`) all have real callers.

## v0.7.0

v0.6.0 made authoring feel modern. v0.7.0 makes *presentation and
discoverability* feel modern: a GPU path tracer that turns the viewport
into a portfolio-grade render, a contextual hint strip that teaches the
UI as you use it, a Cloner you can build C4D-style by dragging parts in,
and a Revert-to-source escape hatch for when the edit pile gets away
from you.

**Path tracer — portfolio renders from the viewport**

- ![new][new] **New `pathtracer.js` module** — three-gpu-pathtracer hooked
  up to the viewport via a new aperture button (top-right of the canvas).
  Click to open a render modal that accumulates samples in the background
  while the live WebGPU viewport keeps responding. Save the result via the
  shared FSA picker (same naming + folder memory as the Screenshot flow).
- ![new][new] **Parallel WebGL2 scene** — the host runs WebGPU but
  three-gpu-pathtracer needs WebGL2, so the module spins up a separate
  offscreen `WebGLRenderer` and mirrors meshes / camera / lights into a
  classic-three scene. Geometries are shared, materials are re-bound as
  fresh `MeshStandardMaterial`s, GPU resources tear down on close.
- ![new][new] **Aperture button** in the viewport (`#tg-render`,
  lavender tint) sits beside Screenshot. Pre-1.0: slow, beautiful,
  on-demand — no per-frame accumulation.

**Cloner — drag-to-build + centred arrays**

- ![new][new] **Standalone Cloner** — top-bar **Cloner** button now creates
  an empty cloner with no sources when nothing is selected. Drag parts
  into the cloner row in the tree to register them as sources (C4D-style).
  Rebuild is reactive; empty cloners emit nothing but remain fully
  functional until you populate them.
- ![new][new] **`centerArray`** — toggle centres linear / grid arrays on
  the cloner origin instead of growing in +direction. With the source
  hidden, every position is a synthetic clone (offsets 0..N-1) so the
  array straddles the pivot symmetrically. No-op for radial (already
  centred by definition).
- ![new][new] **`hideSources`** — hide the original mesh from the viewport
  so only generated clones render. Useful when the array is symmetric and
  the source-at-origin is already represented by clone-0.

**Workspace — discoverability and polish**

- ![new][new] **Contextual hint strip** (`#vp-hint`) at the bottom-centre
  of the viewport. Reads selection count, gizmo mode, and measure mode to
  emit one-line tips — "Click to select · Drag to orbit · Scroll to zoom"
  empty, "N selected · Drag gizmo to move · Shift to snap" translating,
  "Measure · Click two points · Esc to exit" mid-measure. Pointer-events:
  none so it never blocks the gizmo or marquee underneath.
- ![new][new] **Add-primitive button — long-hold picker, click-to-repeat**.
  Click adds the last-used shape (cube by default). Hold for 400 ms to
  open a 13-shape picker (cube, sphere, cylinder, cone, torus, plane,
  capsule, icosahedron, dodecahedron, hex bolt, hex nut, socket-head
  screw, washer). A tiny corner triangle hints at the long-press
  affordance, Figma / Photoshop tool-group convention. Last-used shape
  + per-kind thumbnails persist in localStorage.
- ![polish][polish] **Brand menu moved to top-left** — the *About / GitHub
  / What's new* dropdown now anchors to a brand mark at the start of the
  top bar instead of the right corner. Right side stays free for the
  Export + cog cluster. Left-anchored variant (`.brand-left`) overrides
  the transform-origin so the popover grows from the top-left edge.
- ![polish][polish] **Cloner promoted to the top bar** — was a sidebar
  affordance, now a first-class `#btn-cloner` button next to File. Single
  click whether you have a selection (wraps it) or not (creates standalone).
- ![polish][polish] **Status bar + log console layering** — the status
  bar lost its top border and gained a higher z-index so the global log
  console now slides up *behind* it instead of overlapping. Console
  bottom-offset trimmed from 28 → 22 px to match.
- ![polish][polish] **Format card selection** in the Export modal uses
  tokenized accent tints (`--ac-tint-12` / `--ac-tint-20`) instead of
  baked `rgba(107,141,255,…)`. Selected cards now follow accent-colour
  changes without a stale highlight.

**File menu — Revert to source**

- ![new][new] **Revert to source file…** — drops every edit and re-parses
  the on-disk file the scene was loaded from. Destructive confirmation
  dialog ("Revert to original model?" / "Revert"). Works for STEP, GLB,
  GLTF, FBX, OBJ, 3MF, STL via the same drag-and-drop dispatcher, so the
  revert path is identical to the open path.

## v0.6.0

v0.5.0 made sessions feel modern. v0.6.0 makes the *authoring loop* feel modern:
a C4D-style live Cloner, a Ctrl-click measure tool, per-group origin markers
that follow your gizmo, a Spline-style two-panel Export modal, mesh
simplification on the backend, and a CAD-correct mouse mapping.

**Cloner — C4D-style live instancing**

- ![new][new] **New `cloner.js` module** wraps the current selection in a
  cloner group with three modes: **Linear** (count + per-step XYZ / rotation
  / scale), **Radial** (count + radius + axis + start/end angle + faceCenter),
  **Grid** (nx/ny/nz × dx/dy/dz). Defaults to **InstancedMesh** for fast
  high counts; flip to independent Mesh siblings when each clone needs to
  be individually editable. Undoable.

**Measure tool**

- ![new][new] **Measure mode** (`M` to toggle, ruler button in the viewport).
  Ctrl-click two points on geometry to drop a measurement. Left-drag still
  orbits, Esc cancels. Accent-blue **hover dot** follows the cursor while
  active. Measurements stay visible after you exit pick mode (Pixyz /
  Onshape behaviour).

**Origin markers**

- ![new][new] **Per-group origin axes** visualise each group's pivot. Drag
  with the gizmo and the origin tracks in real time; the new position
  persists on drag-end so re-selecting reads the moved pivot, not the
  stale pre-drag one.
- ![new][new] **Scene origin** — axes helper at world 0,0,0 rendered with
  `depthTest:false` so it stays visible through geometry.

**Export modal — Spline-style two-panel**

- ![new][new] **Redesigned Export window**. Left sidebar (200 px):
  categorised format list — **3D Formats** (GLB / GLTF / FBX / USDZ / OBJ),
  **3D Printing** (STL), **Point Cloud** (PLY), **Data** (CSV). Right panel:
  sticky header with live title + description, Compare button, scrollable
  options grid, full-width primary **Export {FMT}** button.

**Pipeline — smaller GLBs by default + simplification**

- ![new][new] **`--simplify <ratio>`** — meshoptimizer quadric-error
  decimation via `gltfpack -si`, with feature-edge preservation (holes /
  chamfers / fillets stay sharp). `0.5` halves the triangle count. Lossy.
- ![new][new] **Meshopt is now ON by default** when `gltfpack` is on PATH —
  most users wanted the ~10× smaller GLB and never remembered to pass
  `--meshopt`. Pass `--no-meshopt` to opt out.
- ![new][new] **XCAF read-mode toggles** — `--no-shuo` / `--no-layers` /
  `--no-materials` / `--no-step-names` / `--no-step-props` skip parts of
  the slow STEPCAF `Transfer(doc)` pass. SHUO is the biggest win on
  instanced assemblies. All five flow through `/api/convert` so the
  in-browser drag accepts the same options.
- ![fix][fix] **Face winding** — only `TopAbs_REVERSED` flips now; the old
  `!= 0` check incorrectly flipped INTERNAL / EXTERNAL faces and produced
  back-face artefacts on cellular geometry.
- ![fix][fix] **PCA hash collision** — `lexsort` along axis=0 instead of
  flattening all axes into one bag, so a cube and its diagonal mirror no
  longer collide.
- ![fix][fix] **GLB metrics on meshopt files** — direct JSON-chunk reader
  replaces `trimesh.load`, which can't decode compressed GLBs (the
  `--target-tris` auto-tune was blind to its own output).
- ![new][new] **Partial-read cache bypass** — `*.xcaf-cache.xbf` is skipped
  on both read and write when any read-mode flag is off, so a partial run
  can't be silently upgraded by a cached full-read doc. Interactive
  prompt now shows the cached GLB's `quality=X` before asking to reuse it.

**Server — boot hygiene**

- ![new][new] **Inbox sweep on boot** — drops orphaned `<job_id>_*.step|.stp`
  uploads and `*.xcaf-cache.xbf` caches older than 24 h from crashed
  previous runs. User-placed files (no job-id prefix) are left alone.

**Authoring overlay — add primitive**

- ![new][new] **Add-primitive button** in the viewport overlay. Click adds
  your last-used kind (C4D's "last tool used"); long-press opens a picker
  with thumbnails. Catalog expanded with **capsule, icosahedron,
  dodecahedron, hex bolt, hex nut, socket-head screw, washer**.

**Camera — CAD-correct mouse mapping**

- ![new][new] **LEFT = orbit, MIDDLE = pan, RIGHT = pan, wheel = zoom**
  (middle was DOLLY by default; CAD apps reserve it for pan).
  **Alt + RMB-drag = dolly** (C4D convention) — exponential, drag up
  zooms in. Windows' middle-mouse autoscroll glyph suppressed on canvas.

**Right sidebar + status bar**

- ![new][new] **Collapsible sections** with persisted state. Default: only
  Properties + "Selection & actions" expanded (was 12 always-open sections).
- ![new][new] **Renderer selector** in the status bar — direct WebGPU /
  WebGL2 dropdown with logos, replacing the text-only status.
- ![new][new] **Scene rename** — double-click the status pill; export uses
  `state.sceneName` over the source filename. Snap-gizmo-to-grid toggle
  added under Display.
- ![polish][polish] **Tighter sidebar sizing** — buttons / dropdowns /
  toggles 30→28 px, 11→10 px font. Selected dropdown row shows a trailing
  ● instead of a leading ✓. Name-regex inline input removed (the "By name"
  button still drives the flow).

**Materials**

- ![new][new] **Grid ↔ List view toggle** in the materials popup,
  persisted via localStorage. **"Show N more"** overflow on long lists.

**Brand menu + design tokens**

- ![polish][polish] **Accent-gradient brand menu** with white-tinted text
  variants; WebGPU + WebGL logos in the footer.
- ![polish][polish] **Accent shift** `--ac` `#6b8dff` → `#5b67f5` — less
  violet, marginally more saturated. All 15 `--ac-tint-XX` triplets
  re-derived.
- ![refactor][refactor] **Off-grid spacing tokens** — `--space-3` / `-5` /
  `-7` / `-9` / `-11` / `-18` named, were raw literals.
- ![polish][polish] **Properties value rows** — font-weight 500 → normal,
  size 11 px for a denser read. Welcome modal gains a **New scene** button
  alongside Browse; resume card 140 → 180 px tall, simplified hover.

**Launcher**

- ![new][new] **`start_hidden.vbs`** — silent .lnk launcher (no console
  window). Use `start.bat` directly when you want boot logs.

## v0.5.0

v0.4.0 made the viewport feel modern. v0.5.0 makes the *session* feel modern:
real scene management (start empty, merge files in, edit scene-level
settings as a first-class modal), parametric primitives that round-trip
cleanly through the transform panel with mm-snapped inputs, unit-aware
transforms that follow the right-sidebar display unit, a banding-free
background pipeline, and a clean-shutdown server endpoint.

**Scene management — File menu**

- ![new][new] **New scene** action — boots straight into an empty viewport
  instead of forcing a load to start working. The toolbar, gizmos, and
  right sidebar all initialize from the empty-state path so primitives
  / imports can land into a known-clean scene.
- ![new][new] **Import (merge)** — load a STEP / GLB / GLTF / FBX file
  *into* the current scene instead of replacing it, with the imported
  hierarchy folded into the existing tree under its own root node.
- ![new][new] **Scene settings** is now a dedicated modal in the File
  menu, lifted out of the viewport cog popup. Camera controls remain in
  the cog popup where they're contextual to the viewport.

**Primitives — parameter polish**

- ![new][new] **Editable number inputs** for every primitive parameter —
  any size slider can be type-edited directly with the keyboard.
- ![polish][polish] **Round defaults** on insertion (whole-mm radii /
  heights / tube thicknesses) so freshly-added primitives don't show
  long decimal trails.
- ![polish][polish] Size sliders now **snap to whole-mm increments** —
  drag-edits land on round values without needing the input field.
- ![fix][fix] **Transform panel refreshes** after a parametric rebuild,
  so the displayed translation / rotation / scale matches the new
  geometry's bounds instead of staying stuck on pre-rebuild values.

**Transform — unit alignment**

- ![polish][polish] Transform panel units now **follow the right-sidebar
  `displayUnit`** (mm / cm / m / in). Switching the global unit updates
  the transform readouts in lockstep so the two panels can never disagree.

**Visual — banding-free backgrounds**

- ![new][new] Gradient backgrounds get a **per-pixel dither pass** that
  breaks up the smooth ramp into a high-frequency noise pattern. Eight
  bits of colour can no longer band visibly across the viewport, even
  on dark gradients where banding was most obvious.
- ![refactor][refactor] **Design-token expansion** — font-weight tokens
  (`--fw-regular/-medium/-semibold/-bold`), select-arrow tokens
  (`--select-arrow` / `--select-arrow-color`), and unified button-height
  rules (`.tbtn` 26px, `.btn` 32px). Native `<select>` and the JS-injected
  custom selects now share the same chevron SVG.

**Server — clean shutdown**

- ![new][new] **`/api/quit` endpoint** for graceful shutdown — the desktop
  shell can now close the bundled server cleanly instead of hard-killing
  the process and leaking the port.

## v0.4.0

v0.3.0 hardened the editing surface. v0.4.0 makes the viewport itself feel modern:
HDRI environment lighting with procedural presets and a draggable sun, an
LOD-aware infinite floor grid with spline-style hairlines, atmospheric fog,
parametric primitive insertion, a pill-shaped camera-view selector at the
top centre, full keyboard shortcuts (Ctrl+1..4) for standard CAD views, a
borderless popup language across every modal/popover, and an accent-token
refresh toward IBM blue with strict token-only colour usage.

**Lighting — HDRI environment**

- ![new][new] New **HDRI** mode in Background settings. Loads any `.hdr` /
  `.exr` file as an image-based environment that lights every PBR
  material in the scene. Plus 4 **procedural presets** so a user can ship
  a polished look without sourcing an HDRI file.
- ![new][new] **Custom HDR / EXR loader** wired to the file picker — the
  loaded environment becomes both the scene background AND the IBL light
  source.
- ![new][new] **Draggable sun gizmo** repurposed to drive HDRI rotation:
  rotating the sun rotates the whole environment, and the model relights
  in real time as the gizmo moves.
- ![new][new] **HDRI intensity slider** under Display → Lighting. Forces a
  full re-light pass on change so the model brightness updates instantly.
- ![fix][fix] Fixed black-scene bug when switching back to HDRI mode after
  having loaded a different background.
- ![polish][polish] Sun rig dims automatically when HDRI is active so it
  doesn't double-up over the IBL.

**Atmosphere — floor grid + fog**

- ![new][new] Replaced the finite `THREE.GridHelper` with an "infinite"
  axis-coloured `LineSegments` grid that scales to ~200× the model
  footprint. Centre row red (X axis) / green (Y axis); every other line
  thin grey.
- ![new][new] **Spline-style hairline fade** — per-vertex alpha smoothsteps
  out toward the horizon, with corners past the fadeEnd dropped at build
  time so the vertex budget stays under 50k even on a 1mm-unit model.
- ![new][new] **LOD on the minor cells** — minor hairlines fade out when
  zoomed out so far the cells become visual noise; restore correctly on
  zoom-in.
- ![polish][polish] Overall grid opacity dropped 0.55 → 0.22 — the grid now
  reads as a quiet reference plane instead of a dominant element.
- ![new][new] **Scene fog** enabled by default with Display-section
  controls for **near**, **far**, and **intensity**. Fog colour picks
  itself from the active background mode so the horizon dissolves cleanly.

**Primitives — direct mesh creation**

- ![new][new] New toolbar dropdown to **add primitives** (`+` icon) —
  Cube, Sphere, Cylinder, Cone, Torus, plus more. Inserted directly into
  the scene with proper materials and a fresh tree node so they're
  immediately editable like any other part.
- ![new][new] **Parametric Shape-parameters panel** in the C4D
  Attributes-Manager style. After insertion the panel exposes all the
  generator parameters (radius, segments, height, etc.) — re-edits
  rebuild the geometry in place.
- ![fix][fix] Deferred geometry dispose on parameter edits to fix the
  WebGPU `setIndexBuffer` race that would crash the renderer on rapid
  re-evaluations.

**Camera views — top-center pill**

- ![new][new] Removed the four `T / F / S / Persp` buttons from the
  top-left toolbar in favour of a single **pill button at the top centre
  of the viewport**. The pill shows the active view's name (Cam / Top /
  Front / Side); clicking it reveals a dropdown of the alternatives.
- ![new][new] **`Ctrl/⌘ + 1..4`** keyboard shortcuts: 1 = Cam
  (Perspective), 2 = Top, 3 = Front, 4 = Side. Each row in the pill
  dropdown shows its shortcut as a kbd chip; the prefix is platform-aware
  (`⌘` on macOS, `Ctrl` everywhere else). Existing bare `1/2/3` keys
  for view modes (solid / wireframe / x-ray) now require *no* modifier
  so the two systems don't collide.
- ![new][new] Pill auto-syncs back to **Cam** the instant the user starts
  orbiting, so the toolbar can never lie about the active view.
- ![polish][polish] Pill label centered, lucide camera icon, slight black
  glaze background, no stroke, blur backdrop. Camera-view shortcuts also
  added to the command palette and Shortcuts overlay.

**Viewport — render-to-PNG enhancements**

- ![new][new] **Camera-shutter flash fires on icon click**, *before* the
  Save Screenshot dialog opens — the visual snap precedes the
  configuration step rather than firing after, so the click-to-shutter
  feedback feels like a real camera. The dialog now lands ~120 ms later,
  just as the flash fades, with the OS save picker still firing on Save.
- ![new][new] Right-click on empty viewport space now exposes **17
  actions** (was 5): Fit / Reset camera, all 4 standard views with
  shortcuts, all 3 render modes, live-state toggles for grid /
  bounding-boxes / auto-rotate (label flips `Show ↔ Hide`, `Start ↔ Stop`
  based on current state), Select all / Show all parts, Save
  screenshot…, Save scene.
- ![fix][fix] **Right-click viewport menu was completely broken** —
  another `contextmenu` capture-phase listener in `app-v2.js:16359`
  unconditionally `preventDefault`s on every non-input target to
  suppress the native browser menu, which set `defaultPrevented=true`
  before the app's custom menu builder ran. The custom builder bailed
  on the first line via `if (e.defaultPrevented) return;`. Removed the
  guard — each branch is target-scoped, so unconditional run is safe
  and the bubble-phase tree-row handler still wins for tree clicks.

**Tooltips — bulletproof against navigation**

- ![fix][fix] Tooltips no longer get stranded when a popup opens, a modal
  shows, the page loses focus, the anchor's DOM gets rebuilt, or the
  cursor sits still while a panel slides in over the button. Six
  layered safeguards added without changing the happy path:
  - Defensive `document.contains(target)` check inside `show()` so a
    detached anchor doesn't render at a stale rect.
  - `mousedown / pointerdown / touchstart / contextmenu` capture-phase
    hides — fire before `click` and catch drag-starts the original
    listener missed.
  - `focusin` (capture) — palette open, form focus, etc.
  - `visibilitychange` — alt-tab + return no longer leaves stale tips.
  - **rAF-coalesced `mousemove` validator** that uses
    `document.elementFromPoint` to verify the cursor is still inside
    `currentTarget`. Catches "popup slid over my anchor without me
    moving" instantly.
  - **MutationObserver on `class` / `style`** at `<body>` watches for
    `.modal-bg.show`, `.dlg-popup.show`, `.vp-pill-menu.show`,
    `#vp-settings-pop.show`, `#vp-materials-pop.show`, `.ctx-menu`
    appearing — any of those gaining `.show` retires the tip.
  - Detach observer (`childList:true subtree:true`) re-checks
    `document.contains(currentTarget)` whenever the DOM mutates, so
    tree rebuilds / panel refreshes can't park a tooltip on a removed
    row. `pagehide` added too.

**Visual language — borderless popups**

- ![polish][polish] Removed the 1px stroke from every popup card sitewide.
  `.dlg-popup .dlg-pop` (Save Screenshot, Batch Rename, Material editor,
  any `_DraggablePopup`), `.modal` (Welcome, Settings, Shortcuts,
  Cmd-K, Save Scene, Export), `#vp-materials-pop`, `#vp-settings-pop`,
  and the camera-view dropdown all now sit flush on their `var(--bg1)`
  / blurred backgrounds with `box-shadow:var(--sh)` for depth.
- ![polish][polish] Removed the world-axis triad button (`tg-axes`) and the
  in-scene `THREE.AxesHelper` it controlled. Boot path, scene init,
  thumbnail capture, command palette, scene-state save/restore — all
  references swept. The bottom-left axis-gizmo SVG (camera-orient
  click target) is unaffected.

**Visual language — accent refresh**

- ![polish][polish] Accent token `--ac` shifted from `#6ea8ff` (sky blue)
  toward IBM blue: **`#6b8dff`** rgb(107,141,255). Slightly more
  saturated, marginally less violet. Gradient companion `#4f8be5` →
  `#4f7ce0`. All `rgba(110,168,255, X)` triplets updated to
  `rgba(107,141,255, X)` sitewide.
- ![refactor][refactor] Audit + sweep: every hardcoded accent reference (the
  Z-axis label, gizmo HUD Z value, mixed-material gradient, view-mode
  + gizmo + grid `--btn-tint` declarations) now uses `var(--ac)`. The
  only remaining literal `#6b8dff` is the token definition itself and
  the material-color-picker `PRESETS` array (a list of distinct user
  swatches).
- ![polish][polish] **iOS switch tint** flipped from `var(--ok)` (green) to
  `var(--ac)` (accent blue) — single rule
  `.toggle input:checked+.switch` changes every checkbox switch in
  Display, Export, Save Scene, dynamic-template toggles, etc.

**Right sidebar — readability**

- ![polish][polish] Yellow `.btn.warn` text on the right sidebar
  (`Smart fit`, `Remove empty parts`, `Deduplicate geometry`, `Fix
  degenerate parts`, `Delete empty groups`, `Flag low-triangle parts`,
  `Flag thin slivers`, `Smart-fit all parts`, `Decimate`) flipped to
  `var(--tx)` white. The yellow-tinted hover background still flags
  them as lossy/destructive ops; only the resting label/icon colour
  changed.
- ![polish][polish] Right-sidebar button font weight 500 → 400 so a column
  of buttons reads quieter at the 11 px size.

**Material editor + popups**

- ![new][new] Single-click swap when the material editor is already
  open — clicking a different material in the grid switches the editor
  contents to that material in place instead of needing close/reopen.
- ![polish][polish] Materials popup actions row promoted to the top of the
  panel (action bar above grid) so the most-used buttons are always
  reachable without scrolling.

**Toolbar**

- ![polish][polish] Only one toolbar dropdown can be open at a time —
  opening any of the format / primitive / export menus auto-closes the
  others.

## v0.3.0

v0.2.0 was the editing surface. v0.3.0 hardens it: a real material editor with
shader-ball previews, transform-gizmo polish (scale + snap + live HUD),
screenshot capture with custom resolutions and a system save dialog,
orthographic Top/Front/Side viewport toggles, FBX legacy-format rescue,
and a long tail of fixes around dispose hygiene, drag perf, and context
menus.

**Viewport — standard CAD views**

- ![new][new] New `T` / `F` / `S` viewport buttons → switch to orthographic
  and align to Top, Front, or Side. Z-up CAD scenes use the CAD convention
  (Y forward); Y-up scenes (glTF / Blender) flip accordingly. The active
  button highlights itself, and the highlight clears the instant the user
  orbits — no stale active state.
- ![new][new] New `Persp` button (`video` icon) → snap back to a 3/4
  isometric perspective view. Restores the scene's CAD up-axis, re-enables
  the FOV slider, and clears the ortho-view active state in one click.

**Viewport — screenshot capture**

- ![new][new] New camera button (top-right of the viewport) opens a custom
  draggable, resizable **Save Screenshot** popup with:
  - 6 resolution presets — Viewport 1×/2×/4×, 1080p, 1440p, 4K — in a 3×2
    grid; the active preset auto-highlights when W/H matches.
  - Custom width × height inputs with live aspect ratio + megapixel readout.
  - Filename field auto-populated as `<modelStem>_<ISO timestamp>.png`,
    pre-selected on open for instant rename.
- ![new][new] Save uses the **File System Access API** (`showSaveFilePicker`)
  on supported browsers so you pick the destination + filename in the OS
  dialog. Falls back to a regular browser download otherwise.
- ![new][new] Optional bottom-left info stamp burnt into the saved PNG —
  filename, dimensions, timestamp.
- ![new][new] Camera-shutter flash effect — a white overlay fades in (~65 ms)
  and out (~280 ms) as the frame is captured, masking the unintentional
  swap-chain blink during readback so the capture feels like a real shutter
  click.
- ![new][new] Capture pipeline renders into a `WebGLRenderTarget` at the
  chosen resolution and reads back via `readRenderTargetPixels`. Identical
  output on WebGL and WebGPU; for perspective cameras it temporarily
  adjusts `camera.aspect` so a 16:9 export of a square viewport isn't
  squashed.
- ![fix][fix] 3-phase File System Access error handling — `showSaveFilePicker`
  returns null on user cancel, but `createWritable` can also reject (write
  denial, OneDrive lock). All three failure modes now route to the regular
  download fallback instead of silently dropping the save.
- ![fix][fix] Stop the double-prompt corrupted-file bug where the save dialog
  fired twice and produced a 0-byte PNG.

**Materials — full editor + shader-ball preview**

- ![new][new] Disney-style **shader-ball preview** assembly replaces the
  bare sphere — sphere + cylinder + ground disk + back-card geometry, lit
  with a PMREM env map + a side-key fill so PBR responses read the way
  they would in a real DCC viewport.
- ![new][new] Same shader-ball geometry now powers the materials grid
  thumbnails, not just the editor's hero preview.
- ![new][new] Material editor switched to **C4D / Redshift-style row
  layout** — each property is a single horizontal row; map slots, intensity
  scalars, and the eyedropper sit inline with the property they belong to.
- ![new][new] Per-property texture slots covering the full PBR set — base
  color, normal, roughness, metalness, AO, emissive, bump, displacement,
  alpha, env, clearcoat (×3), sheen (×2), transmission, thickness, specular
  (×2), iridescence (×2), anisotropy. Map intensity scalars per slot.
- ![new][new] Floating texture-attach popover anchored to each `.mat-row-tex`,
  plus an eyedropper button flush with the colour picker.
- ![fix][fix] Texture leak on model swap — `material.dispose()` doesn't dispose
  textures, and `_loadTexture` only revoked its blob URL on error. The
  deferred-dispose drain now walks all 25 PBR map slots, revokes any
  `userData.dataUrl` blob URL, disposes the texture, and nulls the slot.
- ![fix][fix] Material thumbnails fall back to a lightweight 2D canvas paint
  when `WebGLRenderer` is unavailable, instead of showing blank tiles.

**Gizmo — scale, snap, HUD**

- ![new][new] Added a **scale gizmo** (`T` shortcut, `scaling` icon).
- ![new][new] Global **Shift-to-snap** across all three gizmo modes —
  10 units for translate, 15° for rotate, 0.1-step for scale.
- ![new][new] Live **gizmo HUD** — readout panel next to the gizmo while
  dragging, showing the current delta in world units / degrees / scale
  factor.
- ![polish][polish] HUD only shows the axis you're actually grabbing, not the
  full XYZ block, while a single-axis handle is active.

**Transform panel**

- ![new][new] Right-click on the Position / Rotation / Size column headers
  for **Copy / Paste XYZ** — round-trips the three values as
  `x, y, z` text via the clipboard, so transforms move between objects in
  one keystroke pair.
- ![perf][perf] Skip `_readStableSize()` while a translate or rotate gizmo
  drag is in flight — the size readout doesn't change during pure
  position/rotation, and the per-frame box recompute was a measurable
  hit on 50K-tri parts.
- ![fix][fix] Restored the **native browser context menu** on form inputs —
  Copy / Paste / Select All works again on every numeric/text field. The
  custom right-click was eating those events project-wide.

**Loaders & format coverage**

- ![new][new] Legacy **FBX rescue path** — FBX FileVersion 6100 (and any
  ASCII variant Three.js's loader chokes on) now routes through Assimp.js
  → GLB → GLTFLoader. Saves files that were previously stuck at "loader
  threw, no model on screen".
- ![polish][polish] When both Three.js and Assimp give up, the toast names
  the actual cause instead of a generic "loader failed".

**Tree / sidebar**

- ![polish][polish] Tree rows: object/group labels shrink from 12.5 px → 11.5 px,
  and group rows lose the bold weight. Reads denser without losing
  hierarchy.
- ![polish][polish] Sidebar: compact sidebar buttons; the "draws" stat was
  noise alongside "tris/parts/instanced" — dropped.
- ![polish][polish] Welcome modal: drop zone pushed lower so the recent-files
  list breathes.

**Visual polish**

- ![polish][polish] Background: Blender-grey preset lightened — the previous
  shade tipped too dark and competed with the grid's contrast.
- ![polish][polish] Chromium scrollbars: `::-webkit-scrollbar` set to match
  Firefox's `scrollbar-width: thin` so the sidebar reads consistent
  across browsers.

**Internal**

- ![refactor][refactor] Removed dead `_tfStashQuat` global (declared, never
  referenced).
- ![refactor][refactor] Scoped four `_shearTmp*` THREE-object globals into the
  `_matrixHasShear` IIFE; same per-call profile, no module-level pollution.
- ![refactor][refactor] Collapsed `_Welcome._fmtBytes` (7 lines) into a one-line
  wrapper around the global `fmtBytes` — kept the `Number.isFinite` guard
  for stored-state reads.

**Docs**

- ![docs][docs] README: ASCII logo centered, Pre-1.0 R&D section added,
  marketing copy toned down across About + Updates.

## v0.2.0

v0.1.0 could open and render. v0.2.0 adds the editing surface around it.

**Added**

- Welcome modal with drag-drop, file picker, and recent files (FS Access API + IndexedDB handle persistence).
- Command palette (⌘K / Ctrl-K) over a unified action registry.
- Shortcuts overlay (`?` to open).
- Settings modal — persistent prefs for renderer, perf mode, background, FPS pill, instancing, material sharing, auto-rotate, highlight thresholds.
- Section / clip planes via TSL `discardNode` (real GPU clipping).
- Renderer hot-swap between WebGPU and WebGL2 from the toolbar.
- Batch rename (F2) with token templates, regex find/replace, presets, live preview.
- Hierarchy flatten / dissolve / ungroup, undoable.
- Undo / redo for tree edits, recolours, renames, flatten ops.
- Right-click context menu on tree rows.
- Save Scene — view + selection + recolours.
- Brand menu (about / GitHub / version / shortcuts).
- FPS pill with colour-coded stutter detection.
- CSS design-token system — surfaces, radii, type scale, easings.
- Cancel + copy-log on every long-running load.

**Changed**

- Tree expand/collapse on 10K+ nodes: ~1s → <10ms, by flipping a class instead of rebuilding the DOM.
- Modal body scrolls so the footer stays visible on short screens.
- Export consolidated into a single toolbar dropdown + settings modal.
- Added a highlight-small-parts toggle with tinted rows.
- Viewport perf cleanups, dead-button fixes, stale experiments archived.

## v0.1.0 — first public commit (2026-05-05)

What landed in the initial commit:

- **STEP → GLB pipeline** (`step2glb.py`) — OCCT-backed XCAF reader, PCA pose-normalized
  instance hashing, adaptive tessellation (absolute or relative to bbox diagonal),
  size culling, optional Meshopt compression via `gltfpack`.
- **WebGPU viewer** (`index.html` + `app-v2.js`) — full assembly tree, picking,
  hide / isolate, per-group colouring, fit-to-view, viewport modes (shaded / wireframe / matcap).
- **Local server** (`serve.py`) — static file server + `/api/convert` endpoint that
  spawns the converter as a background job.
- **One-click launchers** — `start.bat` / `start.command` bootstraps the `.venv`, pulls
  deps, and opens the browser. Subsequent runs are sub-second.
- **Vendored decoders** — Draco encoder/decoder and Assimp.js shipped as WASM under
  `vendor/`, so no CDN is required at runtime.

<!-- ── Changelog tag badges ───────────────────────────────────────────────
     Reference-style image defs used by every entry above. Single source of
     truth: change the colour / label here once and every row updates.
     Modern Linear / Vercel-inspired palette tuned for cohesion: every swatch
     is the same Tailwind-500 luminance so the changelog reads as one cohesive
     design system rather than six unrelated swatches. `style=flat` for soft
     pill chips with rounded corners — the contemporary take on shield badges.
       new      #10b981  emerald 500  — feature additions
       fix      #f43f5e  rose 500     — bug fixes (warmer than fire-engine red)
       perf     #f59e0b  amber 500    — performance work
       polish   #a855f7  purple 500   — UX / visual refinement
       refactor #3b82f6  blue 500     — internal cleanup
       docs     #64748b  slate 500    — documentation
-->
[new]:      https://img.shields.io/badge/new-10b981?style=flat
[fix]:      https://img.shields.io/badge/fix-f43f5e?style=flat
[perf]:     https://img.shields.io/badge/perf-f59e0b?style=flat
[polish]:   https://img.shields.io/badge/polish-a855f7?style=flat
[refactor]: https://img.shields.io/badge/refactor-3b82f6?style=flat
[docs]:     https://img.shields.io/badge/docs-64748b?style=flat
