# Fixes since the last release

The running log of bugs found and fixed after the last tag. Every fix goes in here the moment it is made (see `CLAUDE.md`), so that
it can be copied into `CHANGELOG.md` and the release notes when the next version ships, and so that there is a record of what was
wrong and why. When a version is released, its entries move into the changelog and this list starts again.

Entry format: the changelog's own (`![fix][fix] **What was wrong, in the user's words.** What now happens.`), written as one person
("I"), never "we". Under each entry, a line for the maintainer: `Cause:` and `Where:` (and `Test:` if one covers it).

Last release in the changelog: **v0.34.0**.

## New

![new][new] **Claude can close open edges:** `fix_mesh` with `action: close_open_edges` caps every rim where the surface of the chosen parts stops (missing faces: an open bore, a side that was never exported), as the Edit mesh Close button does with nothing picked, in one undo step. A rim that folds over itself, or edges that meet others at a point, are left and counted in the answer.
- Where: `app/js/app.js` (`_Elements.closeOpen` takes `{ ids, quiet }` and returns the counts; bridge tool `fix_mesh`, its Allow prompt), `app/serve.py` (`fix_mesh` schema and description). Cache-buster `app.js?v=…-cl2`.
- Test: none of its own yet; the e2e Claude tool run (`tests/e2e-mcp-tools.mjs`) calls `fix_mesh` with its other actions. Not yet tried in the browser.

![new][new] **A STEP converts to a GLB 4 to 6 % smaller, with nothing moved.** Every CAD face is meshed with points of its own, so where two faces meet smoothly (a fillet running into a wall) the points along the seam were written twice, bit for bit the same in position and normal: 7 % of the vertices of the Front Axle sample, 10 % of a duct. Those are joined now. Only exact copies are joined, so the shading and the shape are the same; with the CAD faces kept (B-rep) nothing is joined, since the CAD-face tools expect each face to have its own points.
- Where: `app/step2glb.py` (`solid_to_mesh`; the count is logged at the end).
- Measured: the Front Axle 8x8 sample 13.90 to 13.31 MB (24,663 vertices joined), a duct 3.83 to 3.60 MB, same triangle count, nodes and bounds. The app's own GLB exports (the Gearbox Assy) have no exact copies and no unused or constant attributes, so a weld or prune at export would save nothing there; the backlog item "vertex and attribute clean-up at export" is answered by this.

![new][new] **Simplify round faces.** A new command (and Claude tool `simplify_round_faces`) for parts that still have their CAD faces: the cylinders, cones, spheres and tori get fewer facets, as coarse as a deviation allows, with the flat faces following at the rims so nothing cracks. A point goes by an edge collapse onto a neighbour that lies on every CAD face the point lies on (a rim point goes along its rim, a point inside a face anywhere in it, a corner where three faces meet never), when no triangle round it turns over, the point ends up within the deviation of the surface that replaces it, and the turn the edge makes afterwards (or, inside a face, the dihedral of the new facets) stays under 360° / segments; the cheapest collapses go first, pass after pass. Nothing is moved and nothing is triangulated anew, so nothing can fold. Two settings on the card: the deviation (a share of the part's size, 0.05 % to begin with) and the least number of facets a full turn keeps (12). The part keeps its CAD faces afterwards: the triangles come back grouped by face with new ranges and areas, the edge polylines without the points that went, and the geometry adopts the record (`_Brep.adopt`), so Remove holes, Untriangulate and Remove fillets and chamfers still know the faces. Runs on the selection, or on every shown part when nothing is selected.
- Where: `app/js/roundfaces.js` (`simplifyRoundFaces`), `app/js/meshops.js` (the tool), `app/js/app.js` (the command `roundFaces`, the card's settings, `_Brep.adopt` after the swap, the Claude tool), `app/serve.py` (`MCP_TOOLS`), `site/docs-content.js` (article `simplify-round-faces`; help, knowledge and site rebuilt). Cache-busters: `roundfaces.js?v=1`, `meshops.js?v=8`, `mesh-worker.js?v=60`.
- Test: `node tests/roundfaces.test.mjs` (a capped cylinder of 72 facets: fewer facets, closed, volume within 3 %, the record sound, the rim polylines thinned to the rims, the least-segments cap on both rims, a deviation under the mesh's own sag changes nothing; a sphere of 36 × 18: fewer triangles and points, closed, the volume within what the deviation allows and within 3 % at a fine one). Not yet run on a real STEP in the browser.
- Tried offline on the mudguards of the Scania sample with a deviation of 0.74 mm (0.05 % of their size) and 12 segments at least: 65,612 to 9,650 and 88,624 to 12,084 triangles, both closed, volume within 1.4 %. A first version on the app's limited dissolve folded triangles on a sphere and left over a thousand open edges on the mudguard; the collapse replaced it before anything shipped.

![new][new] **The Animate window's title is set in Fraunces,** the serif of the other headings, a little larger than the sans titles so it reads the same size.
- Where: `app/index.html` (`#vp-animate-pop .adk-h .lc-title`), cache-buster. Not yet checked in the browser.

![new][new] **Remove fillets and chamfers.** A new command (and Claude tool `remove_fillets`) for parts that still have their CAD faces: the small rounds and chamfers come off and the edges are sharp again. Each blend's two neighbouring faces are extended until they meet (the line of two planes; the curve of a plane and a cylinder, found by projecting back and forth), the blend's triangles go, the two rims are moved onto that curve and cut point for point into each other so the surface closes without a sliver, and the end arcs fold onto the rim ends. It runs on the selected parts, or on every shown part when nothing is selected (the Claude tool the same: ids, a name, the selection, or everything shown). Two limits on the card, as shares of the part's size: fillets up to a radius, chamfers up to a width (2 % each to begin with; 0 leaves that kind). Fillets are told from small cylinders by the CAD edges: a fillet meets two different faces tangent, a pin or a hole does not. A chamfer is a narrow plane between two faces that meet at a real angle and whose normal lies between theirs (the thin top of a rib is not one).
- Tried on a real part (a mudguard of the Scania 8x4 STEP, 494 CAD faces): the first run tore the faces, for two reasons, both fixed. The triangles that one group's splits made were invisible to the next group (it read the original triangle list), so a fillet at each end of the same wall tore it between them: the triangles are a live list now and every group reads it. And two fillets that only touch at a point (at a sharp corner of a face) each moved the shared point to their own curve: blends that touch are now a cluster, taken off whole when they can be (the shared point goes to where all their supports meet), and otherwise chain by chain, a chain that would move an already settled point being left and counted ("touching a blend already taken off"). Within a cluster every chain aims a shared point at where all the cluster's blends at that point want it, so chains that touch usually agree and both come off; only a disagreement leaves the second one. The card's two sliders go to 50 % now and its result line says what the limits are in the part's units (on a 1.6 m part 2.9 % is 46 mm, which takes a 45 mm half-round bracket as a fillet: that is the rule, so the line says so). The mudguards of the Scania sample now come back closed: 76 and 119 fillets off, 65,612 to 33,010 and 88,624 to 45,710 triangles, no open edges; what stays is counted on the card (supports that are not planes or cylinders, odd shapes, a few fits and touches).
- Corners: a group of blends that meets at a corner (three edge fillets and the spherical patch between them, or three chamfers and their corner triangle) goes as one. Each rim point goes to the curve of the two faces its blend runs between, and a point where blends meet goes to the point where three faces meet; the rims are zipped pair by pair, and a face triangle that gets points on two of its edges (the corner of the face) is fanned from its middle. Left alone and counted: blends on a cone, sphere, torus or free-form support; a point where four or more faces meet; blends whose rims would move further than four times their size (the fit failed).
- Where: `app/js/defeature.js` (`removeBlends`), `app/js/meshops.js` (the tool), `app/js/app.js` (the command `removeBlends`, the card's settings in `_MeshOps.OPS` with `allowZero`, `cadOf` now hands the faces, edges and edge points along, the Claude tool `remove_fillets`), `app/serve.py` (`MCP_TOOLS`), `site/docs-content.js` (article `remove-fillets`; help, knowledge and site rebuilt). Cache-busters: `defeature.js?v=2`, `meshops.js?v=5`, `mesh-worker.js?v=57`.
- Test: `node tests/defeature.test.mjs` (a block with a filleted edge and with a chamfered edge come back as the exact sharp block, closed; a round boss with a torus fillet at its foot between a plane and a cylinder comes back as plate plus boss, exact volume, closed; a block with three fillets meeting at a corner under a spherical patch comes back as the exact sharp block, closed; limits and the thin-rib rule). Not yet run on a real STEP: the repository's B-rep fixture has no fillets, and the Scania sample is a GLB without CAD faces.

![new][new] **The right-click menu of selected parts is in a new order.** Frame selected, Isolate and Reveal in tree come first, then Copy, Paste and Duplicate, then the Select commands (same colour now before the original), then Animate and the two note items, and Delete last.
- Where: `app/js/app.js` (the viewport menu in the `contextmenu` handler), cache-buster in `index.html`. Not yet checked in the browser.

![new][new] **The right-click menu of the empty view is shorter.** The four views (Camera, Top, Front, Side) are in *Views*, Solid, Wireframe and X-ray in *Display*, and Save screenshot, Turntable video and Revert to source file in *More*. Fit view, the ground grid, Select all, Show all parts and the note items stay in the list; Save scene is no longer in it (Ctrl+S and the File menu still save).
- Where: `app/js/app.js` (the viewport menu in the `contextmenu` handler), cache-buster in `index.html`. Not yet checked in the browser.

![new][new] **Remove holes and Untriangulate use the CAD faces of a STEP.** On a part that still carries its CAD faces (a STEP opened with them, or a scene saved from one), a face the CAD file calls a plane is one flat region exactly, whatever its triangles' normals say, and two neighbouring plane faces are never joined however flat they lie to each other. Before, both tools found the flat faces from the angles between triangles with a tolerance of about half a degree: a plane whose tessellation wobbled fell apart into facets and its holes were missed, and two faces meeting at a shallow angle were taken for one and then left alone as not flat. The rest of the part is handled as before; parts without CAD faces are not affected.
- Where: `app/js/app.js` (`_Brep.planePoly`: the plane face per triangle from the B-rep record, cached per geometry; `_fillHolesRun` and `_untriangulateRun` pass it to the worker and the local call), `app/js/holefill.js` (`opts.cadPoly`: a plane face is a region before the growth by normals), `app/js/untriangulate.js` (`opts.poly`), `app/js/wirelines.js` (`analysePolygons` takes a partial polygon map: known polygons stay, the rest grow by angle and never into them, numbers compacted), `app/js/mesh-worker.js` (the map per material group; one pass when the faces are the CAD's). Cache-busters: `holefill.js?v=32`, `untriangulate.js?v=11`, `wirelines.js?v=3`, `mesh-worker.js?v=55`.
- Test: `node tests/cad-planes.test.mjs` (two planes at 0.5° stay two, a wobbling plane's hole is found; a map of the wrong length is ignored). The plumbing was checked in headless Chrome on `tests/fixtures/test-model.brep` (converted with its faces, both tools run through the bridge). Not yet checked on a real STEP whose tessellation wobbles, which is where it should show.
- Not done: a part Remove holes or Untriangulate rebuilds loses its CAD faces afterwards (as every edit does today), so the second tool run on the same part no longer has them; carrying the face map through an edit is the next step.

![new][new] **Remesh evenly and Smooth surface keep the CAD edges of a STEP part.** On a part from a STEP opened with its CAD faces and edges (the CAD edges pill), the edges these two tools keep sharp are the CAD file's own: an edge between two CAD faces stays sharp even when it is shallower than *Keep edges sharper than*, an edge where two faces run into each other smoothly (a fillet's border) is not held, and the seams between the facets of a coarsely tessellated cylinder are no longer taken for edges. The card's summary says so ("the CAD edges"). Parts without CAD faces, and a part already changed by another tool, work by angle as before.
- Where: `app/js/remesh.js` (`remeshEvenly`, `opts.cad`), `app/js/smooth.js` (`smoothSurface`, `opts.cad`), `app/js/meshfix.js` (`weld` also returns which input triangle each one was), `app/js/app.js` (`cadOf` and `runOne` in `_MeshOps`, the two summaries), cache-busters in `meshops.js`, `booleans.js`, `mesh-worker.js` and `index.html`.
- Test: `tests/cad-edges.test.mjs` (a 10° crease kept with CAD faces and not without, the same crease marked tangent not kept, the facet seams of an 8-sided cylinder not kept while its rims are, Smooth surface keeping the crease); `remesh`, `smooth`, `meshtools` and `booleans` tests still pass. Not yet checked in the app with a real STEP part (the Scania file in Downloads would do), and the angle slider still shows on the card though it only decides where a part has no CAD faces.

![new][new] **Parts keep their CAD layers.** A STEP file imported with {{Layers}} on (Import settings, What to read) gives each part the name of the layer it is on. The Properties card shows it as a badge (a click selects every shown part on that layer), *Select by layer…* in the command search lists the layers of the scene with how many parts are on each and selects one, a duplicate keeps its layer, and a saved scene carries the layers through save and reopen. For Claude, `list_parts` reports `layer` when a part has one and the new tool `select_by_layer` selects by part of a layer name (without a name it lists the layers). The switch is still off by default, because reading layers is one more pass over the file.
- Where: `app/step2glb.py` (already wrote `layers` into each product node's extras; unchanged), `app/js/app.js` (`_layersOfNode` in the loader, `soLayers` in the scene save, `selectByLayer`, `_selectByLayerMenu`, the `selLayer` action, the badge in `refreshPropertiesPanel`, `select_by_layer` and the `layer` row in the Claude tools), `app/serve.py` (`MCP_TOOLS`), `app/index.html` (the tooltip of the switch), `site/docs-content.js` (first-file, select-parts, command-line), `tools/site/app-entry.js`, `app/knowledge/playbooks/tools.md`. The parts tree has no layer filter yet, and a part whose layer comes from the STEP's in-browser fallback reader (no server) has none.
- Test: `tests/e2e-mcp-tools.mjs` (the fixture `tests/fixtures/layers-test.glb` from `tests/make-layers-glb.mjs`: list_parts, select_by_layer, the badge, save and reopen); `tests/converter.test.py` (`t4_metadata`, the FASTENERS layer in the extras). The converter side is checked with a STEP written by the test (`t4_metadata`); the app side with the GLB fixture, not yet with a STEP file carried through the app's own import dialog.

![new][new] **The two Round part commands have names that say what they do.** In the command palette (and in the messages they show), "Round part: remove ridges" is now *Fill round grooves* and "Round part: make solid" is *Fill solid round*. The old words are still found by the search. The tool name for Claude (`simplify_round_part`) is unchanged.
- Where: `app/js/app.js` (`fillGrooves`, `fillGroovesOutline`, the notices of the Round part run). The docs articles and the site do not name the commands this way yet: not checked.

![new][new] **The Notes menu ("…") is in groups:** Pins, Sort by, Review and Share open a second menu; a round eye button beside the search shows or hides the pins; New note is yellow. The list rows show only the tick, the title and the line underneath (no number badge, priority mark, unread dot or assignee circle).
- Where: `app/js/notes.js` (`rowEl`, the bar and the menu), `app/js/app.js` (`ctxClose` in the notes host). Not yet checked in the browser. Unread and high-priority notes can no longer be told apart in the list.

![new][new] **Right-click menus keep no empty icon column when none of their items has an icon** (the scene tab menu has none now).
- Where: `app/js/app.js` (`_ctxFill`, the tab menu). Not yet checked in the browser.

![new][new] **The Steps in the Smart optimise card have short names.** Target, Empty parts, Hidden parts, Fasteners, Small parts, Holes, Exact copies and Tolerance (they were "Remove empty and broken pa…", "Remove parts hidden inside", "Bolts, nuts, washers" and so on, which did not fit on one line). The tooltips still say in full what each one does.
- Where: `app/index.html` (the Steps in `#smart-*`). Not yet checked in the browser; the help article and the Claude tools still use the long names.

![new][new] **The sliders in the other cards of the right sidebar (Properties, effects, cloners and the rest that are built by script) look like the dragged number fields too:** the name on the left, the number on the right in a box that fills as the value grows. Drag the number or the name sideways, or click the number to type. The materials dock keeps its own look.
- Where: `app/index.html` (`#sidebar-right .scrub`, last of the slider rules). CSS only; the slider code is unchanged. Not yet checked in the browser.

![new][new] **The other sliders of the right sidebar are the dragged number fields with a fill too:** Fog intensity, Field of view, Exposure, Ambient, Sun intensity, Sun azimuth and Sun elevation (HDRI Intensity was first). Drag the field or its label, or click and type; a typed number is brought into range; the fill follows when the sun gizmo or a loaded scene sets the value; Ctrl+Z still undoes them.
- Where: `app/index.html` (the rows in the Scene, Camera and Lights cards), `app/js/app.js` (`_fillField`). Not yet checked in the browser; sliders that are built by script (material and other properties) are still the old kind.

![new][new] **The HDRI Intensity is the dragged number field with a fill, like the Photo mode ones.** Drag it sideways (or its label), or click and type; 0 to 4 in steps of 0.05; Ctrl+Z still undoes it. The size and fill colour of these fields are tokens now: `--scrub-w` (104 px), `--scrub-h` (the control height, `--num-h`), `--scrub-px` and `--scrub-fill`; an older rule that set the size by itself, so the tokens did not apply, is gone.
- Where: `app/index.html` (`#hdri-int`, `:root`, `.prim-val-wrap`), `app/js/app.js` (the HDRI controls, the undo of sliders). Not yet checked in the browser.

![new][new] **Photo mode always starts with the loft studio light.** It used to keep an HDRI that was already chosen. Now the loft studio lights the model whatever was set, and leaving Photo mode puts back the earlier background and environment (a bundled photo or a preset; an HDRI file you loaded yourself is replaced and not brought back).
- Where: `app/js/app.js` (`_Photo` enter and leave). Not yet checked in the browser.

![new][new] **Every switch of the right sidebar is the small one that Photo mode has.** Its size is four tokens now (`--switch-w`, `--switch-h`, `--switch-knob`, `--switch-pad`), used by the sidebar's switches and by the Shape parameters and Photo mode ones. Settings and the floating command cards keep their switches as they were.
- Where: `app/index.html` (`:root`, `.prim-row .prim-toggle`, `#sidebar-right .toggle .switch`). Not yet checked in the browser.

![new][new] **The environments are cards with a picture.** Under Background › HDRI environment, the nine environments (Studio, Soft, Loft, Daylight, Outdoor, Sunset, Venice, Overcast, Grey sky) are 72 px cards, the size of the material cards at the top of Properties, each with a small picture of the environment, in a strip that scrolls sideways (drag, flick, rubber band). The one in use is outlined. They replace the two grids of text buttons.
- Where: `app/index.html` (`#hdri-strip`, `.hdri-card`), `app/js/app.js` (`_markHdriPresetActive` sets a class instead of inline colours; `_stripPhysics` on the strip), `app/assets/hdri/thumbs/` (nine 144 px WebP pictures, 11 KB in all; the five photographs were made from the .hdr files, the four built-in ones drawn from their colours). Checked in headless Chrome (sizes, active card, strip scrolls); not by eye in the real window.

![new][new] **Project frame rate on the timeline.** An *FPS* box (24, 30 or 60) beside Length in the Animate timeline bar. The playhead snaps to frames of that rate, the arrow keys step one frame of it, and the clip export starts at it. It is kept with the timeline's length, in this browser, not in the scene file.
- Where: `app/js/app.js` (`projFps` and `FRAME` in `_Anim`, `#adk-pfps`, the clip dialog's `load`). Not yet checked in the browser.

![new][new] **Photo mode.** Its own *Photo mode* card in the View group of the side panel (and the commands *Photo mode* and *Save a photo of the model*): the viewport is drawn the slow, pretty way, for pictures rather than for working. The loft studio lights the model (an HDRI you already chose stays, background included), the sun's shadows go on, the grid and origin marker are hidden, a round stage under the model catches its shadow, and the picture gets 4x multisampling, ACES tone mapping, ambient occlusion, glow, lens fringe, a vignette and film grain, each with its own switch and slider. *Quality* (Draft, Good, Best, Maximum) sets the multisampling and the samples of the occlusion and the glow; a switched-off effect is left out of the chain and costs nothing. *Save photo* writes a PNG at 1x to 4x the viewport's pixel density (kept under 8192 pixels). Switching it off puts the background, shadows and grid back. It is not saved with the scene and starts off. Screenshots and Claude's pictures still draw straight to the canvas, without the effects.
- Where: `app/js/photo.js` (the effect chain, written in three's shader language because the vendored r172 bundle has no bloom or occlusion nodes), `app/js/app.js` (`_Photo`, the render hook in the loop, `_shadowRefit` moves the stage), `app/index.html` (`#photo-section`).
- Test: `node tests/e2e-photo.mjs inbox/GearboxAssy.glb shot.png` (headless Chrome, software WebGL2: the picture draws, no shader errors, every effect off, every quality, Save photo, and switching off restores the viewport). Not yet checked on a real WebGPU backend or on a slow machine; with a 646,000-triangle model on a weak GPU the multisampled pass and the 16-tap occlusion cost frames.
- Found on the way: the first glow took 8 random samples per ring, which shimmered and drew white streaks on thin bright edges; it is now a steady two-width Gaussian blur of the highlights. Also: three's `ShadowMaterial` writes `null` into the lighting shader when a light that casts no shadow is in the scene, so the program does not compile (the stage uses a lit material with a faded rim instead).

![new][new] **The bottom docks share one height.** Materials, Library and Animate keep the height set by dragging the top edge of any of them when you switch between them (they each had their own). A double-click on the edge puts the default back (330 px). The height an earlier version had saved is carried over once. The Console keeps its own height.
- Where: `app/index.html` (`--dock-h` in place of `--mat-dock-h`, `--lib-dock-h`, `--anim-dock-h`), `app/js/app.js` (`_wireMatDockResize`, the Animate dock's grip, the reset in Settings). Not yet checked in the browser.
![new][new] **A switch for it, in Settings › General › Bottom docks.** *Same height for every dock* is on by default; off, Materials, Library and Animate each keep their own height again (the one that opens puts its height in place).
- Where: `app/js/app.js` (`shareDockHeight` pref, the Settings row, `_wireMatDockResize`: `_dockKey`, `_dockApply`, `__moDockHeightSync`). Not yet checked in the browser.

![new][new] **Switching from one open bottom dock to another fades instead of sliding.** Opening Library while Materials is open (or any pair of Materials, Library, Animate) fades the one out and the other in, in place. Opening the first dock, or closing one, slides as before.
- Where: `app/js/app.js` (`_dockSwapFade`), `app/index.html` (`body.dock-swap`). Not yet checked in the browser; a dock opened from the command search or a shortcut slides as before.

![new][new] **Show or hide the HDRI as the background.** A new *Show as background* switch under the HDRI controls: off, the environment still lights the model and shows in its reflections, but the background is the usual dark colour. It is saved with the scene.
- Where: `app/js/app.js` (`_hdriBackground`, `state.hdriShowBg`, the scene save and restore), `app/index.html` (`#hdri-show-bg`). Not yet checked in the browser.

![new][new] **Five photographed environments come with the app.** Under Background › HDRI environment in the Scene card: Soft studio, Loft studio, Daylight, Sunset sky and Overcast sky (1k, about 7 MB in all, from Poly Haven, CC0). One click loads it as the background and the lighting; the intensity and the sun dial work on it as on a file you load yourself.
- Where: `app/assets/hdri/`, `app/index.html` (`.hdri-photo` buttons), `app/js/app.js` (the photo-environment handlers next to the presets). The online version (`tools/site/build-lite.js`) copies `assets/`, so it grows by the same amount: not yet decided whether to leave them out there. Not yet checked in the browser.

![new][new] **Background and HDRI are in the Scene card.** The Background select and the HDRI controls (presets, Load HDRI…, intensity, the sun dial switch) moved from the Review section to the Scene card of the right sidebar, below Shadows. They work as before.
- Where: `app/index.html` (`#bg-mode`, `#hdri-controls` moved; no script change, they are found by id). Not yet checked in the browser.

![new][new] **The view button in the left toolbar turns the Wireframe on and off.** A click toggles the Wireframe (a look under it, such as Clay, stays); holding the button, or a right-click, lists Solid, Wireframe, X-ray and Heatmap as before. It used to step through the four views.
- Where: `app/js/app.js` (`_ViewModeButton`). Not yet checked in the browser.

![new][new] **The start screen lists recent files in rows.** Each recent file is a row with a small preview, its name, type, size and age, instead of a grid of large cards. The shape tiles (Cube, Sphere, Cylinder, Torus) and the Keyboard shortcuts and Settings links at the top are gone; the shortcuts window is still on `?`.
- Where: `app/index.html` (`.wl-recents`, `.welcome-recent`), `app/js/app.js` (`_renderRecents`). Not yet checked in the browser.

![fix][fix] **The confirm and prompt dialogs (for example Clear recent files) still looked like the old interface.** They now use the same bar as the other windows: the title alone, a small round close button, small flat buttons, the message below, and the danger button drawn from the error token instead of typed-in colours.
- Where: `app/index.html` (`.dlg-head`, `.dlg-icon`, `.dlg-title`, `.dlg-foot`, `.dlg-btn-ok.danger`, `.dlg-close`). Not yet checked in the browser.

![new][new] **Close open edges, in Edit mesh.** A mesh that is missing faces (open bores, a side that was never exported) can be made watertight in one click: the new *Close* button in the Edit mesh bar, and *Close open edges* in the search, cap every rim where the surface stops on the selected parts, as *Fill* does for one picked rim. Each cap faces the way that closes the surface and has points of its own. With rims picked, Close works on those instead: one rim is capped, and two rims are closed between with a strip of triangles from one to the other, matched by their angle round the common axis (the ring floor between the two rims of a counterbore, the wall between its floor and its mouth, the missing length of a tube: a Bridge, in other programs). The rims need not have the same number of points. The strip is written as its own quads and triangles (two triangles that share their diagonal and lie within 10° of one plane are one four-sided cell), so the wire view and Edit mesh show its edges; a cap stays one polygon, as Fill makes it. Found when the first bridge showed as one blank polygon in the wire view. A rim that folds over or crosses itself, or one that meets another rim at a point, is left, and the message says how many; those are filled by hand with *Fill*. One undo step for all the parts.
- Where: `app/js/meshtools.js` (`fillOpen`: walks the open edges the way a cap runs, one rim at a time, and caps each with `fillLoops`; `closeBetween`: the picked rims, one capped, two stitched with the shorter diagonal at each step), `app/js/app.js` (`_Elements.closeOpen` and `closePicked`, the action `closeOpenEdges`), `app/index.html` (`btn-el-close`), the Edit mesh docs article.
- Test: `tests/meshtools.test.mjs` (a plate with a hole: both rims capped, each facing the right way; a size limit; a closed cube; two holes that touch at a corner are left; a pipe with its middle missing, 12 and 16 segments, stitched with 28 triangles all facing outward; a counterbore floor between a plate's hole and a bore wall, 18 triangles all facing up; one rim capped; three rims refused). Checked in Node on the Scania part Engine_V8-XT-03B_1_000193__geom, which showed it: 354 open edges, 12 round rims at the ends of its bores, all 12 capped with 330 triangles in 51 ms. Not yet tried in the app itself. Claude runs it as `fix_mesh` with `action: close_open_edges` (see New).

## Fixed

![fix][fix] **Undoing a step Claude made in one call could take one of my own earlier steps with it, and redo could lose another.** A compound step (one call of Claude's that made several changes) now undoes and redoes each change inside it the way a step of its own is, and takes only its own entries off the history. A change inside it that cannot be redone (Split) or that a module handles itself (the cloner) no longer takes an older step along. When such a step is undone, the redo steps above it are dropped, since they were made on top of it.
- Cause: the compound handler did a blind `state.redo.pop()` after every undone change and a `state.history.pop()` after every redone one, whether or not that change had pushed anything. It also went to the registry only, so cloner changes inside were never undone.
- Where: `app/js/app.js` (`_compoundSub` and `_UndoOps.register('compound')`, `_UndoOps.canRedo`).
- Test: `node tests/undo-redo.test.mjs` (a compound with Split inside, one that can be redone, one with a hooked change: the user's older step stays and the redo steps are right). Not yet tried in the browser with a real Claude call.

![fix][fix] **After undoing Split, Merge or Group, redo was still lit and redid steps made on the parts that were gone.** Those steps were dropped one by one without a word, or could act on a group that had been given the old id since. Undoing a step that cannot be redone now clears the redo steps above it.
- Cause: those undo handlers did not push to the redo stack (by design) but left it as it was.
- Where: `app/js/app.js` (`undoLast`, `_dropRedo`).
- Test: `node tests/undo-redo.test.mjs` (Split then a move: undoing both leaves nothing to redo).

![fix][fix] **Duplicate, move the copy, undo twice, redo twice: the copy came back but stayed where it was made.** The redo of a duplicate, a paste and a paste of a tree folder now brings back the same copies (same ids, same rows and groups), so the redo steps made on them still work.
- Cause: the redo made new copies with new part ids, and the redo steps above it named the old ids, which no longer existed.
- Where: `app/js/app.js` (`_stashOut` / `_stashIn`; the `duplicate`, `paste-group` and `paste-hier` handlers keep what the undo took out and the redo puts it back).
- Test: `node tests/undo-redo.test.mjs` (duplicate, then a move of the copy: the redo brings the same copy back and the move is redone); `tests/e2e-paste-group.mjs` and `tests/e2e-delete-undo.mjs` pass. A paste of a tree folder was not tried in the browser.

![fix][fix] **Redo with the material editor open could replay an old step over an edit I had just made.** Redo now records the editor's pending edit first, as undo already did. The edit is a new action, so the old redo steps end there.
- Cause: only the undo wrapper flushed the material editor.
- Where: `app/js/app.js` (the outermost undo / redo wrapper, `_flushMatEditor`).
- Test: source check in `tests/undo-redo.test.mjs`. Not yet tried in the browser.

![fix][fix] **Ctrl+Z while dragging the gizmo undid an older step, and letting go brought it back.** Undo and redo now wait until the gizmo is let go, and say so.
- Cause: the drag keeps where the parts were when it began, and its step, pushed on release, put back what the undo had taken away (and cleared the redo).
- Where: `app/js/app.js` (the outermost undo / redo wrapper, `_dragging`).
- Test: source check in `tests/undo-redo.test.mjs`. Not yet tried in the browser.

![fix][fix] **Redoing a Smart fit could leave the steps after it in a muddle.** Its redo runs the fit again as a job and finishes later: a compound step or compare_images that needs it done at once now counts it as a step that cannot be replayed, the redo of a following auto step waits for the next redo, and a fit that could not start (another job running) leaves the step on the redo stack instead of losing it.
- Cause: the callers treated the return of the redo call as the end of it; the restored redo stack was the one taken before the auto step was redone, so that step ended up in both stacks.
- Where: `app/js/app.js` (`_UndoOps.register('boxify')` with `asyncRedo`, `_UndoOps.canRedo(op, sync)`, the auto loop in the redo wrapper).
- Test: source check in `tests/undo-redo.test.mjs`. Not yet tried in the browser.

![fix][fix] **compare_images could leave the scene stepped back, or redo steps that had been undone before it ran.** It now walks back by steps (an auto step goes with its action, and all of them are checked), stops when the app refuses an undo, refuses to start while a job is running, and puts forward only what it took back.
- Cause: the check looked at the last n entries while one undo can take two, a refused undo was counted as done, and the walk forward redid that many steps whatever they were.
- Where: `app/js/app.js` (bridge tool `compare_images`).
- Test: source check in `tests/undo-redo.test.mjs`. Not yet run through Claude.

![fix][fix] **Claude's undo and redo said steps were taken back when nothing had changed (a job was still running).** They now refuse while a job runs and count only the steps that were really undone or done again; redo waits for a Smart fit it set going.
- Cause: the loop counted calls, not steps.
- Where: `app/js/app.js` (bridge tools `undo` and `redo`).
- Test: source check in `tests/undo-redo.test.mjs`.

![fix][fix] **A scene slider undone and then changed with the arrow keys (it still had focus) could record the wrong value, or nothing.** The value an undo or redo sets is now the starting point of the slider's next change.
- Cause: the starting value was taken again only on pointer down and on focus.
- Where: `app/js/app.js` (`_uiSliderSet`, `_uiSliderLast`).
- Test: source check in `tests/undo-redo.test.mjs`.

![fix][fix] **Parts deleted by Claude stayed in memory after their step fell off the end of the history.** A delete inside a compound step is now freed like any other, and an auto step whose action fell off goes with it (Ctrl+Z no longer undoes a group clean-up on its own).
- Cause: only a delete at the top level of the history was purged when it fell off.
- Where: `app/js/app.js` (`pushUndo`, `_purgeDropped`).
- Test: source check in `tests/undo-redo.test.mjs`. Not measured.

![fix][fix] **An FBX export (and the Unreal and Unity presets, which are FBX) had no texture coordinates: a texture put on the model in another program showed one colour.** Binary and ASCII FBX now write a UV layer (ByPolygonVertex, IndexToDirect), quads and n-gons included. A part drawn with a glTF texture has its V turned for the file, as FBX counts V from the bottom.
- Cause: both built-in FBX writers wrote only the normals and the material layer.
- Where: `app/js/app.js` (`_fbxUvData`; `_fbxBakeMeshGeom` and `_exportFbxBinary` for the binary file, `_exportFbxAscii` for the ASCII one).
- Test: `node tests/e2e-export-uv.mjs` (headless Chrome, the app on :4242): a UV sphere exported as binary and as ASCII FBX and read back with three's FBXLoader has the same set of UVs, to four decimals. Not yet opened in Blender, Unreal or Unity.

![fix][fix] **Merging parts (and exporting with Merge on) threw textures away, and could garble quantised positions and UVs.** When a merged part has a texture, every part keeps its own material as a group of the merged mesh, so each texture keeps its part's UVs. Plain parts still merge into one material with their colours on the vertices. Positions, normals and UVs are read as real coordinates, whatever the file stored them as.
- Cause: the merge made one vertex-colour material for everything, and copied the attributes' raw arrays (a quantised UV, Uint16 0 to 65535, came out as that number).
- Where: `app/js/app.js` (`_mergeSelectedCore`: the reading of each part and the material groups; the merge path of `buildExportRoot`: the same).
- Test: `node tests/e2e-import-textures.mjs`: a textured box merged with a plain ball keeps two materials, the texture and the UVs; plain parts still give one vertex-colour material. The quantised case is not yet checked with a real quantised file.

![fix][fix] **Decimate lost the second UV set (an ambient occlusion or light map then lay wrong), and without WebAssembly it lost all the UVs.** The weld before reducing keeps every UV set apart (uv, uv1, uv2, uv3). The basic simplifier, used when meshoptimizer cannot load, has the UVs read back onto its result from the part as it was. UVs also count by how far they span: UVs that tile a texture many times no longer hold the reduction back, and UVs that do not change no longer count at all.
- Cause: `_weldForReduction` copied only position, uv and color; the fallback stripped everything but positions; the UV weight was a fixed 0.2 whatever the UVs' range.
- Where: `app/js/app.js` (`_weldForReduction`, the fallback in the decimate loop, `_withCarriedUvs`), `app/js/simplify-core.js` (`packAttributes`).
- Test: `node tests/e2e-uv-carry.mjs` (Decimate by half keeps the sphere's UVs, within 0.004); `node tests/simplify-core.test.mjs`, `reduce-quality.test.mjs`, `decimate-align.test.mjs` still pass. The fallback is not yet run in a test (it needs meshoptimizer to fail to load).

![fix][fix] **Smart fit's Boxes and Blocks proxies had every UV at 0, 0: a texture showed one texel, and a car paint drew them black.** Each face of a proxy now gets UVs projected from the side it faces, over the proxy's size.
- Where: `app/js/app.js` (`_boxProjectUvs`, used by the Boxes and Blocks builders).
- Test: `node tests/e2e-uv-carry.mjs` (a Blocks proxy's UVs span the square).

![fix][fix] **A Draco or Meshopt GLB moved UVs that tile a texture many times (or are in millimetres) by a visible part of a tile.** The UVs now get one more bit for every doubling of their span past 1, up to 16, instead of the encoders' default 12.
- Where: `app/js/app.js` (`_uvQuantBits`, in `_compressGLBWithDraco` and `_postProcessGLBMeshopt`).
- Test: `node tests/e2e-export-uv.mjs` (UVs tiled 500 times come back within 0.02 of a tile from both; at 12 bits a step is 0.12 of a tile). I did not run the test against the old 12 bits.

![fix][fix] **A part whose UVs were flat only in places (a merge of parts of which some had no UVs) still drew black there with a car paint, and the clear coat's normal map was not looked at.** The guard now finds the triangles whose UVs do not change across them. When most do, the part gets projected UVs. When some do, only the vertices that belong to such triangles alone get them, and the rest keeps its own.
- Where: `app/js/app.js` (`_guardNormalMapUvs`, `_boxProjectUvs`).
- Checked in headless Chrome: Flip-flop spheres with all-flat UVs and with the upper half flat both draw shaded in Photo mode. And on the Scania 8x4 (`node tests/e2e-scania-uv.mjs`, its 1,377 parts all without UVs, as STEP parts come): the cab (484,176 triangles) with the Flip-flop paint draws violet in Photo mode, keeps its UVs through Decimate 50 % (10 s), and its FBX has a UV layer; Close cracks, Smooth surface and Decimate on a mudguard (88,624 triangles) take 1 to 2 s each, and a merge of two axle parts works. Known gap, as before: the guard still writes UVs on the part from the draw loop, with no undo step.

![fix][fix] **A textured model from another tool (GLB, OBJ, FBX) opened with its textures gone: every part was one flat colour, and "Keep texture coordinates" kept UVs for nothing.** A material that carries a texture is kept now, with all its maps. An OBJ's or an FBX's material (Phong, Lambert) becomes a standard one with the same maps, colour and see-through. A part with several materials keeps them all when one has a texture. A material without a texture still gets the app's own look, so a CAD model opens as it did. With the import dialog's "Keep texture coordinates" switch off, a part whose file material has a texture keeps its UVs.
- Cause: the import swapped every material of a file not saved by this app for a plain colour one (`getOrCreateMaterial`), and disposed the original. The attributes to keep were then worked out from that new plain material, so with the switch off the UVs always went.
- Where: `app/js/app.js` (`_fileMaterial`, `_standardFromLegacy`, `_hasTexture`, and in `_ingestSceneRoot` the material choice, the dispose of only the materials not kept, and `_attributeKeepSet` over the file's material as well as the new one). Cache-buster in `index.html`.
- Test: `node tests/e2e-import-textures.mjs` (headless Chrome, the app on :4242): a GLB box made with three's exporter, with a colour map and a normal map, keeps both maps and its UVs, with the switch on and off; a plain colour GLB still gets metalness 0.15 and roughness 0.55. The OBJ and FBX conversion is not yet checked with a real textured file (a dropped OBJ cannot reach the image files its .mtl names).

![fix][fix] **The mesh tools threw away a part's texture coordinates: after Close cracks, Remove slivers, Patch holes, Remesh evenly, Smooth surface, Convex hull, Merge bodies, Union / Subtract / Intersect, Voxel remesh or Round part, a texture on the part showed one colour.** The part keeps its UVs (every set it has). Where the tool only moved points (Smooth), they are copied as they were. Where it built new triangles, each corner reads the UV of the closest point on the part as it was, from one UV island per triangle, and a vertex on a UV seam is split in two as the original was.
- Cause: the tools work on positions and triangles only, and the result was built with positions, normals and an index (`_roundGeom`), never a UV.
- Where: `app/js/uvcarry.js` (new: `carryUvs`, islands joined through shared edges, a bounding-volume tree for the closest point), `app/js/meshops.js` (`withUvs`, `opts.uv` in `runMeshOp` and `runBoolean`), `app/js/mesh-worker.js` (the voxel branch), `app/js/app.js` (`_uvSetsOf`; the mesh tools' `source` and `runOne`, the boolean, Voxel remesh's `source` and page fallback, the Round part tools and their segment slider, `_roundGeom` sets the UVs). Cache-busters in `index.html` and for the worker.
- Test: `node tests/uvcarry.test.mjs` (moved points keep their UVs; a plane triangulated again reads UV = (x, y) everywhere; a cube welded into eight corners gets its six islands back, split at the seams, with a second UV set carried too). `node tests/e2e-uv-carry.mjs` (headless Chrome, the app on :4242): UV spheres through each tool, the UVs at the middle of every triangle within 0.007 of the sphere's own (median 0.0003 to 0.0009).
- A 500,000-triangle part takes about 2.7 s, in the background workers. Not yet checked on a textured real model. Split, hole fill and the shading angle kept UVs already. Decimate, merge parts and FBX export are still to do (see the UV audit).

![fix][fix] **The "Instance overrides (SHUO)" switch in Import settings cost reading time and changed nothing: a copy of a part coloured apart from the others came out in the part's colour.** A colour given to one occurrence (a SHUO) now colours that occurrence only, and a colour on a component (an instance of a sub-assembly) colours everything under it. The switch's line says what it does.
- Cause: `walk_xcaf_tree` never looked at component labels or SHUO attributes. An occurrence with a colour of its own now gets a copy of its product in that colour; the copy shares the solids, so it is meshed once. OCCT's `GetInstanceColor` also answers for occurrences with no SHUO (with the part's own colour) and `FindSHUO` matches paths that have none, so a SHUO colour counts only where a component on the path carries one and the colour differs from the part's: a SHUO that gives a part its own colour back inside a coloured sub-assembly is not seen (not met in a file yet).
- Where: `app/step2glb.py` (`walk_xcaf_tree`: `coloured_variant`, `shuo_color`, `has_shuo`; `extract_product_meshes` meshes a shared solid once), `app/index.html` (the switch's line). Found in the v0.34.0 review.
- Test: `tests/converter.test.py` `t4_instance_colours` (a STEP made by `tests/fixtures/make-shuo-step.py`: two sub-assemblies of two bolts, one bolt red by a SHUO, the second sub-assembly blue on its component: grey, red, blue, blue; with `--no-shuo` grey, grey, blue, blue).

![fix][fix] **No colour set on a part's label in a STEP or IGES ever came through, only colours set on its shapes.** They are read now.
- Cause: `get_label_color` called `color_tool.GetColor(label, …)`; in OCP the label form is the static `XCAFDoc_ColorTool.GetColor_s`, so the call raised a TypeError that was swallowed, and the function always returned nothing. Most files also attach the colour to the shape, which is why it went unseen.
- Where: `app/step2glb.py` (`get_label_color`).
- Checked: three real STEP files (a pedal, a duct, the Front Axle sample, 295 nodes) give the same colour on every node as before; the component colours of the SHUO test need it.

![fix][fix] **A STEP from SolidWorks or Creo with one face painted apart from its body came out in one colour: the painted face took the body's.** A body whose faces carry more than one colour is split into one piece a colour, each in its own colour; a face with no colour of its own takes the body's.
- Cause: a body took one colour (its own, or the one most of its faces carry), so faces in a second colour showed in the first.
- Where: `app/step2glb.py` (`_split_by_face_color`, used in `walk_xcaf_tree` only for products that have sub-shapes in the document, so other files are not scanned). Only the assembly (hierarchical) path; a body of more than 50,000 faces keeps one colour.
- Test: `tests/converter.test.py` `t4_face_colours` (a blue box with one red face: both colours, 12 triangles, the same size). On the Front Axle sample 25 bodies have faces in two colours and now show both; not yet looked at in the app.

![fix][fix] **A STEP that is a surface model (faces in no shell, as `gear.stp` of the AP203 samples is) would not open: "no solid bodies found in this STEP".** Its faces are the bodies now, one a colour, as for an IGES surface model.
- Cause: `_loose_shells` took the open shells beside the solids but not faces that belong to no shell.
- Where: `app/step2glb.py` (`_loose_shells`). Found in a batch of the 50 AP203 samples: 48 converted before, 49 now; the last one (`snet.stp`) has no geometry OpenCascade can read at all.

![fix][fix] **Faces the mesher gave up on were not reported unless they had no triangles at all.** The mesher's status is read after every run, and an open or self-crossing face outline, or a face it could not mesh, is said at the end of the conversion.
- Cause: `BRepMesh_IncrementalMesh`'s status flags were never read.
- Where: `app/step2glb.py` (`_mesh_shape`, the end of `_collect_outputs`). Seen on the Front Axle sample (one face could not be meshed). Found in the v0.34.0 review.

![fix][fix] **The STEP cache never worked: every second open of the same STEP parsed it again, and a file called `Document_` appeared beside the STEP.** The parsed document is read back from `<name>.xcaf-cache.xbf` now (the Front Axle sample: 12.2 s the first time, 4.8 s the next). A `Document_` left beside a STEP by an earlier version can be deleted.
- Cause: `app.Open()` hands the opened document back through a C++ out-parameter, which OCP drops, so the document passed in stayed empty and every load failed ("cache loaded with no shapes"); the STEP was parsed again and the cache written again, and after that failed Open the save went to `Document_` instead of the cache while saying it succeeded. The test only looked for the line "loading cached XCAF doc", which is said before the load is tried.
- Where: `app/step2glb.py` (`_load_xcaf_cache` reads with `BinXCAFDrivers_DocumentRetrievalDriver`; `_save_xcaf_cache` checks the file was written).
- Test: `tests/converter.test.py` `t4_cache_keeps_metadata` now asserts "STEP parse skipped", no "cache load failed", and no `Document_`.

![fix][fix] **In a browser without Web Locks, any window open for more than 15 seconds counted as gone when another window started, so its recovery copies could be offered while it still ran.** Without Web Locks each window now says it is alive in the browser's storage every 20 seconds, and a window counts as gone only when it has not said so for two and a half minutes (a hidden tab's timers can be held back to once a minute).
- Cause: `_Session.begin` and `_Autosave.orphans` fell back to the session's start time and the copy's write time.
- Where: `app/js/app.js` (`_Beat`, `_Session.begin`, `_Autosave`'s lock, `_Autosave.orphans`). Found in the v0.34.0 review. Every current browser has Web Locks, so this path is not exercised by the tests; checked by reading only.

![fix][fix] **After a click on a switch or a slider, Ctrl+S, Alt+N and the drawing tools' keys did nothing until I clicked somewhere else; with a dropdown focused, a letter could start a shortcut.** Every key handler now asks the same question (is a text field, or a control that uses this key, focused?).
- Cause: five handlers had their own check of the focused element; they treated a focused switch as a text field and some forgot dropdowns.
- Where: `app/js/app.js` (the global key handler, the pen tool's keys, `_matKeysOwn`, the tree's arrow keys, the paint tool's keys: all through `_typingTarget`). Found in the v0.34.0 review. Not yet checked in the browser.

![fix][fix] **Clean up with "empty parts", and the first step of Claude's `optimise_to_target`, deleted every cloner and every drawn line.** They have no triangles of their own, but they are not empty parts; `check_model` no longer counts lines as empty either.
- Cause: `cleanEmpty` took every part with no triangles.
- Where: `app/js/app.js` (`cleanEmpty`, bridge `check_model`). Found in the review of the Claude tools.

![fix][fix] **A dry run through Claude could make a real change with no prompt and no way back, and take the oldest steps off my undo history.** Once the history was full, each step the trial added pushed the oldest off, so the trial counted none of its own and undid nothing. Nothing falls off the history while a dry run runs now, and the trial is undone step by step until the history is as it was; an exploded view comes back as it was too. The other tools that count their steps (the "nothing to undo" note, `optimise_to_target`, `recenter_model`, `align_to_floor`) count the steps pushed, not the history's length.
- Cause: counting by `state.history.length` before and after.
- Where: `app/js/app.js` (`_undoPushes`, `_undoKeepAll`, `pushUndo`, `__moDryRun`, `snap`/`diff`, the three tools).

![fix][fix] **`remove_fillets` and `simplify_round_faces` with `dry_run` changed the model for real, and ran even with Geometry set to "Don't allow".** Both are dry-run tools and Geometry tools on the page now, as the server already said.
- Where: `app/js/app.js` (`DRY`, `CAT`).

![fix][fix] **Several of Claude's changes made more than one undo step, or skipped a prompt or a block.**
- `ungroup` of several groups and `add_library_part` with a count are one undo step now (they made one a group or a part: one undo took back only the last). Such a step counts as heavy when a step in it is, so it is held to the cap of 30 heavy steps like the others.
- `batch_optimise` asks, or is blocked, by the stricter of Files and Geometry (it reads and writes files but only Geometry counted); `compare_images` asks before it writes its picture, as `render_image` does; `redo` of a delete is blocked when deleting is.
- A locked part is left out by every tool that changes chosen parts (delete, reduce, merge, mend…); only looking, hiding, isolating, renaming and `lock_parts` reach it. Before, only moves honoured the lock. Tools that act on the whole scene without ids (`remove_small_parts`, `clean_up`) still do not look at locks.
- `merge_parts`, `smart_fit`, `merge_by_colour` and `split_parts` say so when another job of the app is still running, instead of reporting a merge that never ran.
- `transform_parts` that moved nothing (every part locked or an instanced copy) says so instead of offering an undo of the step before; a `move` that is not a list no longer breaks the prompt.
- `boolean_parts` checks its ids (deleted parts, lines and cloners are refused).
- `compare_images` puts the selection back if drawing fails; `render_image` keeps its "shrunk" note (`size_note`); the `open_file` prompt no longer speaks of adding to the scene.
- An edit that finishes after Claude stopped waiting is told in a toast and the log ("the change is made: undo takes it back"), so a retry does not do it twice; the feed keeps the 12 latest pictures instead of 40.
- After a restart of the server, an Allow given to a request of the old server is called off, and an answer the server never asked for is not kept.
- Cause: found in a review of the page side of the Claude connection (it had not been reviewed).
- Where: `app/js/app.js` (bridge: `needIds`, `asOneStep`, `notBusy`, `handle`, the tools named), `app/serve.py` (`_handle_bridge_progress`, `_handle_bridge_result`).
- Test: `tests/e2e-mcp-tools.mjs` has new checks (a locked part is left alone by `delete_parts` and `fix_mesh`; `fix_mesh close_open_edges` answers with its counts in one undo step; a dry run on a full history, 32 copies made first, changes nothing and loses no step). 196 of 199 pass; the three that fail also fail on the last commit (two corner colours of `render_image` in software rendering, and the note check, whose expected step count was wrong and is corrected now: three note steps undone take the note itself). `tests/e2e-mcp-server.mjs` passes. The Allow prompt layer (`handle`) is not exercised by these tests: the gate changes are checked by reading only.

![fix][fix] **Undoing a slider move in the material editor closed the Clearcoat, Sheen and Specular sections I had opened.** A section stays open or closed as I left it when the editor is drawn again (after an undo, a redo, or for another material).
- Cause: the editor is drawn afresh after an undo, and each section started from its default (those three closed).
- Where: `app/js/app.js` (`_matSectionCollapsed`, `section()` and the header click in `_openMaterialEditor`), cache-buster in `index.html`. Not yet checked in the browser.

![fix][fix] **A part with a car paint (a Flip-flop or any preset with flakes) went pitch black, mostly in Photo mode, with a black cloud round it, and no slider of the material changed it.** The part is shaded in the paint's colour now, with its flakes.
- Cause: the flakes are a normal map, and the shading builds its tangent frame from how the UVs change across each triangle. A part whose UVs are all the same (a STEP part, or one whose UVs were put away at import and came back as zeros) made that a division by zero, so every pixel of it was NaN; Photo mode's blurs then spread it round the part. It was not the roughness or the inside-out faces (a test sphere with flat UVs was black at every roughness, and fine with real UVs).
- Where: `app/js/app.js` (`_guardNormalMapUvs`, called before each draw): the first time a part is drawn with a normal map and its UVs are missing or flat, it gets plain UVs, each vertex projected from the side its surface faces over the part's size. Cache-buster in `index.html`.
- Checked in headless Chrome on spheres with the Flip-flop preset and all-zero UVs (black before, shaded after, at roughness 0.2 and 1). Not yet checked on the Scania cab itself. Known gap: a geometry whose UVs are flattened in place after it was first drawn is not checked again (the app's edits make new geometry, so this should not happen in use).

![fix][fix] **Isolate did nothing when the view was already isolated and I had selected other parts: S, the Isolate button of the selection bar and the Quick wand showed everything instead of isolating them.** Now they isolate the selection whenever the selected parts are not already the only ones on show, and leave the isolation only then (or when nothing is selected). The button's title, the wand's label and the viewport hint say which of the two the next press does. `isolate_parts` through Claude always isolated and is unchanged; the docs article says the rule.
- Cause: the S key, the selection bar's button and the wand's entry asked only whether the view was isolated and left it when it was, whatever was selected.
- Where: `app/js/app.js` (`_isolateWouldLeave`, `toggleIsolate`; the S handler in `_wireRevealAndKeys`, the `sel-isolate` click, `_syncSelBarToggles`, the wand's isolate entry, `_updateVpHint`), `site/docs-content.js` (article `hide-isolate`; help, knowledge and site rebuilt, `help-content.js?v=34`, `help.js?v=16`). Cache-buster `app.js?v=…-iso1`.
- Test: `node tests/e2e-isolate.mjs [model] [rounds] [seed]` (headless Chrome against the app on :4242): a random mix of isolate by ids and by name, with and without a selection, S and Alt+H as key events, the selection bar button, a tree eye, Remove holes and its undo, a camera change, a screenshot framed on the selection, a second scene tab, an undo of an isolate; after every step it checks the page's own state and `scene_summary`. Run on the Gearbox Assy with seeds 7, 123 (60 rounds) and 999 (100 rounds) and on `tests/fixtures/test-model.glb`: the isolate tools, the tree eyes, the camera, the screenshot, the scene tabs and undo kept the isolation every time; the failures were the three entries here. Not run on the Scania scene.

![fix][fix] **After Remove holes through Claude with no ids, the selection was gone: `get_selection` said nothing was selected and a screenshot framed on the selection found nothing.** `fill_holes` without ids now leaves the selection alone (it runs on the selected parts, or on every shown part when nothing is selected, as its description says). `remove_floating_pieces` without ids runs on every shown part, as its description says, and puts the selection back afterwards.
- Cause: both tools emptied the selection (`pickSel([])`) so that the card would take the shown parts.
- Where: `app/js/app.js` (bridge tools `fill_holes`, `remove_floating_pieces`).
- Test: `node tests/e2e-isolate.mjs` (Remove holes with no ids keeps the isolation and the selection).

![fix][fix] **An isolation (or a hide) vanished after a Remove holes run that found nothing to fill, and no one had called show_all.** The tool's reply said "The undo tool (or Ctrl+Z) takes this back" although nothing had changed and no undo step existed, so Claude called undo, and the undo took back the step before: the isolate. A tool that changed nothing now says so in its reply and tells Claude not to call undo for it. The same line is in every tool that reports before and after.
- Cause: `diff()` in the bridge wrote the undo line whatever had happened.
- Where: `app/js/app.js` (`snap` remembers how many undo steps there were, `diff` compares).
- Test: `node tests/e2e-isolate.mjs` (the Remove holes reply says whether there is a step to undo). The undo tool itself still takes back whatever the last step was: a call to it after such a reply is Claude's own doing.

![fix][fix] **The CAD edges of a STEP part went away when the part was changed.** They now stay through Bake transforms, Centre pivot, Orient and Set transform (moved with the vertices, so they stay on the surface), Make unique, Decimate, Quick remesh, Fit to budget, Untriangulate, Repair, Reverse normals and Remove hidden faces, and come back with Undo. A part replaced by its bounding box, or whose triangles were moved or deleted by hand in Edit mesh, still loses them: those are no longer the CAD surface.
- Cause: the CAD edges are a record tied to one geometry. Tools that build a new geometry handed the record on only on undo / redo and in a few mesh tools (`_cadEdgesPartSwapped`), and tools that move the vertices in place dropped it (`_disposeEdgesFor` with `edited`) without moving the edge points.
- Where: `app/js/app.js`: `_Brep` (`carry`, `carryFor` with the old geometry, `seen`, `moved`, `put`, `copy`, `skip`), `_cadEdgesBuild` (carries the record from the geometry the lines were drawn for, parts and instanced copies), `_decSnap` and `_cadEdgesAttach` (remember the geometry), `_ownGeometryFor` (a copy keeps it), `bakeTransforms`, `centerPivotsOnSelection`, the Orient and Set transform loops (`_Brep.moved`), `_snapGeomXform` / `_restoreGeomXform` (undo). Cache-buster `brc1`.
- Not yet checked in the browser with a STEP opened as B-rep; syntax check only. A decimated part's edges are the original surface's lines, so on a heavy reduction they can sit a little off the coarser surface.

![fix][fix] **Mirrored parts came out inside-out in OBJ, STL, PLY and FBX files.** Their triangles are turned the right way round when the writer bakes the transform into the points; glTF and USDZ, which keep the transform, are unchanged.
- Cause: a part with a negative determinant turns its triangles over when its transform is applied to the points; only the merge path swapped corners.
- Where: `app/js/app.js` (`_flipMirroredForBake`, called before the OBJ, STL and PLY writers and the two built-in FBX writers). Not yet checked with a real mirrored part opened in Blender or Cinema 4D.

![fix][fix] **The same scene exported to FBX came out at another size, or lying down, depending on whether its parts had quads.** The built-in FBX writer, which says in the file what a unit is and which way is up, is now used for every binary FBX; Assimp is the fallback only when it fails.
- Cause: with no quads the file went through Assimp, given a GLB that carries neither the unit nor the up axis; with quads the built-in writer ran.
- Where: `app/js/app.js` (the FBX branch of the export). A change of behaviour: files that went through Assimp before now come from the built-in writer, which the Cinema 4D fixes in its comments were made for. Not yet opened in Unreal, Maya or Blender after the change.

![fix][fix] **A repainted part was exported in its old colour when "Merge into one mesh" was on.** The merged mesh takes the colour each part shows, as the path that keeps parts apart already did. A part without normals no longer takes the normals away from the whole merged mesh (it gets its own), and points stored in a shared (interleaved) buffer are read correctly.
- Where: `app/js/app.js` (the merge path of `buildExportRoot`).

![fix][fix] **The size estimate in the Export window (and Claude's estimate_export_size) counted only positions and normals.** Texture coordinates, colours, tangents and the pictures of the materials, which the GLB embeds, count now (the pictures at about a byte a pixel: a rough figure). Claude's tools ask about the visible parts as they say, not about whatever the Export window's switches were left at.
- Where: `app/js/app.js` (`_exportEstimate`, the three tools that call it).

![fix][fix] **"Selected parts only" with a cloner in the scene exported the cloner's hidden source part, and left it visible afterwards.** Export and Save scene turn only the parts' own flags for the moment of the file, and a cloner's source is known from the cloner, also while it is selected (and so hangs under the gizmo). A hidden copy of an instanced part that is saved with "hidden too" is written where it is, not squashed to nothing.
- Where: `app/js/app.js` (`_exportDrawList`, the Export and Save scene flips, `_resolvePartWorldMatrix`).

![fix][fix] **Undoing "Make cloner" moved its parts out of the groups they were in, to the top level of the tree.** They go back where they were, in the scene and in the tree.
- Cause: undo put each source back under its old parent and then the cloner's dissolve moved every source to the top level again; the tree rows were set to the top level too.
- Where: `app/js/cloner.js` (`_clonerDissolve` moves only what is still in the cloner; the undo of `clonerAdd` puts the rows back from `prevTree`).

![fix][fix] **After deleting a copy of an instanced part, its siblings could drop out of exports a few minutes later.** The shared geometry is kept while any part still draws it.
- Cause: `_purgeDeleted` counted only meshes as users of a geometry, not the instanced meshes and the geometry table.
- Where: `app/js/app.js` (`_purgeDeleted`). Found by reading the code; not reproduced.

![fix][fix] **Explode pushed parts out from a lopsided centre in scenes with hidden or deleted parts, or with instanced copies.** The centre is the middle of the parts that are shown, each measured by its own geometry.
- Cause: `Box3.setFromObject(partsRoot)` counted hidden and deleted meshes and every squashed instance slot (a point at the instanced mesh's origin).
- Where: `app/js/app.js` (`_ensureExplodeBaseline`).

![fix][fix] **Undo of a delete made while exploded showed a hidden instanced part again.** It stays hidden.
- Where: `app/js/app.js` (the undo of `delete`).

![fix][fix] **Undo of Split showed a hidden part in the tree but not in the view.** The part comes back as it was shown, the flag and the mesh agreeing.
- Where: `app/js/app.js` (`_splitOnePart` records `_splitWasVisible`; `_undoSplitBatch`).

![fix][fix] **A mesh job that never finished in the background workers made every later tool answer "Still working" for the rest of the session.** A job now ends after 30 minutes with an error, its worker is stopped and replaced, and a job on the Tasks list can be stopped from there (Stop ends only the jobs of that tool; Quick remesh's levels are its own).
- Cause: nothing timed out or released a worker that did not reply.
- Where: `app/js/app.js` (`_MeshWorkers`: `kill`, `cancelAll`, the timeout in `run`; `_Job` gives its task a stop).

![fix][fix] **Quick remesh could overwrite a change Claude (or an undo) made to a part while the pill was open.** A part that something else changed is let go: it is not shown at a level, put back or kept.
- Where: `app/js/app.js` (`_QuickRemesh`: `ours`, `wear`, `cancel`, `commit`). Opening Quick remesh still turns an instanced copy into a mesh of its own without an undo step, as a dozen other tools do; it looks the same and is left as a design choice.

![fix][fix] **Decimate could reduce a part that was deleted while it was being worked out.** It is skipped and named.
- Where: `app/js/app.js` (`_decimateSelectedRun`).

![fix][fix] **On a part scaled more along one axis than the others, Decimate's and the mesh tools' tolerances in mm could be passed along the stretched axis.** They use the largest of the three scales.
- Where: `app/js/app.js` (`unitsOf` in Decimate, the scale in the mesh tools' runner and in Voxel remesh's).

![fix][fix] **After the graphics driver recovered, the 3D view stayed without its lighting and the "lost" card stayed up.** When the browser gives the context back, the environment is built again and the card says the view is back (with Save and Reload).
- Where: `app/js/app.js` (`webglcontextrestored`). Not checked on a real driver reset.

![fix][fix] **A change in Settings › Appearance reached only the tab the Settings window was in.** Every open tab takes the new look at once.
- Where: `app/js/appearance.js` (a `storage` listener).

![fix][fix] **A note pinned on a copy of an instanced part stayed where it was put when the part moved (Explode, the gizmo).** The pin is kept in the copy's own frame and follows it.
- Where: `app/js/app.js` (the note pick), `app/js/notes.js` (`frameOf`, `worldOf`). Not yet checked in the browser.

![fix][fix] **While pins showed, the page measured the 3D view twice in every frame.** The sizes are measured once and again only when the view or the window changes size.
- Where: `app/js/notes.js` (`rectsOf`).

![fix][fix] **The backtick opened the console over the Export window, and ? with a dropdown focused opened the shortcuts.** Both use the app's own test for typing and dialogs.
- Where: `app/js/app.js` (the console key, the shortcuts key). The other hand-written key checks the review named were not changed.

![fix][fix] **A damaged setting in the browser's storage (a word where a number belongs) was used as it was.** A stored value of the wrong kind falls back to its default; numbers and switches saved as text are read as what they say.
- Where: `app/js/app.js` (`_Prefs.load`).

![fix][fix] **A long turntable video needed several times its own size in memory while it was being finished.** The video file is put together from the recorded frames without copying them; the bytes are the same as before.
- Where: `app/js/app.js` (`_WebmMux.mux`).
- Test: the old and the new muxer were run on the same 1, 5 and 40 frames and wrote identical files.

![fix][fix] **The group dots and the point picker's dots changed size with zoom in the Top, Front and Side views.** They keep their size in every view.
- Cause: a sprite of fixed screen size picks its perspective or orthographic formula when its shader is built, and the camera changes kind in place.
- Where: `app/js/app.js` (`DualCamera.setOrtho` marks those materials for a rebuild). Found by reading three.js; not yet seen on screen before or after.

![fix][fix] **Two windows brought back together after a crash could delete each other's recovery copies.** The first window to find the crash leaves a note for a few minutes; the second keeps the copies and lets the first offer them.
- Where: `app/js/app.js` (`_Session.begin`). Not checked with two real windows after a crash.

![fix][fix] **With several parts of one name ("Screw M6"), a saved animation came back on the first of them.** It comes back on the part it was on: by id, then by the part's own id kept in the file, then as the nth of the parts of that name.
- Where: `app/js/app.js` (`recData`, `targetOf` in `_Anim`).

![fix][fix] **The file handles of the start screen's recent files piled up in the browser for ever.** A file that leaves the list takes its handle with it, and once a start the ones left by older versions are cleared.
- Where: `app/js/app.js` (`pushRecent`, `_pruneStore`). Two different files with the same name still share one card: the app cannot see where a file is.

![fix][fix] **Claude's calls could hang until their timeout, or an edit could happen after Claude was told it had failed.** A call whose window was closed, replaced, switched off or restarted ends at once; a call that times out is called off and its late answer is thrown away; an edit allowed after Claude stopped waiting is not made; a page whose poll had gone takes no command; an answer too big to pass on (a big screenshot) says so instead of hanging; a request with malformed arguments gets an error instead of a dropped connection; a cancel works on plain calls too, and one client cannot cancel another's job; `list_folder` stops at 5,000 files, 20,000 folders or 20 seconds and says so (a folder it cannot read is still reported as such). An answer that comes after its call was given up is dropped, so the server does not keep it.
- Where: `app/serve.py` (`_fail_taken`, `taken` and `expired`, `_peer_gone`, `_mcp_dispatch`, `_handle_bridge_result`, `_handle_bridge_list`), `app/js/app.js` (`post`, `stillWanted` in the Claude bridge).
- Test: `tests/e2e-mcp-server.mjs`, 161 of 161 (it also had a check that read the old "ask" key after the dropdown's switch started writing a mode per kind of change; the check now reads the mode and clears it after, and the playbook no longer names an option `part_id` that does not exist).

![fix][fix] **"Ask before edits" did not ask before Claude opened, exported or saved files.** Opening a file, looking in a folder, exporting, saving the scene, recording a video, saving a picture and writing the notes to a file ask when Settings › Claude › Files is set to ask. A picture Claude only looks at does not ask.
- Cause: the prompt was shown only for tools with a prompt text, and no file tool had one.
- Where: `app/js/app.js` (`EDITS`). A change of behaviour: with the default settings these now ask.

![fix][fix] **Claude's tool list said less than the tools take:** `turntable_video` takes `animations`, `export_model` takes `animation`, `export_notes` is not marked read-only (it can write a file), and `read_doc` names the playbook "problems" (and "troubleshooting" as the help article it is).
- Where: `app/serve.py` (`MCP_TOOLS`, `_READ_ONLY`).

![fix][fix] **A STEP that holds only a face is converted (a surface part), as the app's "Surface parts" switch says; with the switch off it is refused as before.** The tests had expected it to be refused in every case.
- Where: `tests/converter.test.py` (`t1_errors`, `t5_api_convert`); the converter was right.
- Test: `tests/converter.test.py`.

![fix][fix] **"Drop small parts" did not make the file smaller: the dropped parts were still in it.** They are left out of the file and of the triangle count.
- Where: `app/step2glb.py` (the XCAF path: the dropped products leave `products`).

![fix][fix] **A converted file was reused for other settings or another converter.** The kept result now also depends on the reading switches (names, layers, materials, overrides, properties), `--props`, `--pca-instances`, the converter itself and the file's size and date, not only its date; in the app, on the OpenCascade runtime too, and "Share identical shapes" no longer makes a second copy where it changes nothing (colours on, not a BREP; with "auto" a file over 1 GB is read plain, and the switch counts).
- Where: `app/step2glb.py` (`_cache_params`, `_converter_version`), `app/serve.py` (`_cache_key`, `_ocp_signature`).

![fix][fix] **The kept results could lose a model's CAD faces first, empty the whole cache for one big result, or hand out a half-copied file.** A result is kept and dropped as a whole (its GLB, record and CAD faces together), the newest stays, files are written under a temporary name and renamed (a failed copy removes it), a cancelled job leaves no file behind, and a model made by the plain reader after the colour reader crashed is not kept as the result with colours.
- Where: `app/serve.py` (`_cache_store`, `_cache_lookup`, `_convert_thread`, the retry).

![fix][fix] **CAD faces that could not be meshed vanished without a word.** The converter counts them and says how many are missing.
- Where: `app/step2glb.py` (`solid_to_mesh`, `_collect_outputs`). The mesher's own status is still not read.

![fix][fix] **A SolidWorks STEP that colours faces, not bodies, came out grey.** A body with no colour of its own takes the colour most of its faces carry. Faces in a second colour still show in the body's main colour.
- Where: `app/step2glb.py` (`_dominant_face_color`). Not yet checked with a real SolidWorks file.

![fix][fix] **A full disk while writing the GLB was reported as "XCAF reader failed", and the STEP was read a second time without colours.** Only the reading falls back to the plain reader now; a failure while writing is reported as itself.
- Where: `app/step2glb.py` (`convert`).

![fix][fix] **The help and the docs said `--relative` is a share of the model's size.** It is OpenCascade's relative deflection: a share of each edge's own size. The comments, `--help` and the docs say so.
- Where: `app/step2glb.py`, `site/docs-content.js`.

![fix][fix] **An upload the server refused (too big, a wrong name, no room on the disk) showed "Failed to fetch" instead of the reason.** The server reads the upload before it answers, so the reason arrives.
- Where: `app/serve.py` (`_refuse_upload`).

![fix][fix] **After a slow restart the server could close itself with the window still open.** The page tries to link again for two minutes, as long as the server waits for it.
- Where: `app/js/app.js` (the link to the server).

![fix][fix] **The server's log grew without end.** Past 5 MB it is kept as `server.log.1` and a new one begins (the updater, the installer and git leave both alone).
- Where: `app/serve.py` (`_restart_server`), `app/updater.py`, `app/install.ps1`, `.gitignore`.

![fix][fix] **A release's feed could miss its installer and never say that the Python packages changed.** `build-update.py` reads `site/latest.json` and the `MeshOptimiser-v<version>.zip` in its output folder by default, and says so when the installer zip is not there.
- Where: `tools/app/build-update.py`.

![fix][fix] **In a copy of the repository, the server would hand out any file on the disk through `/tests/C:/...`.** A path under `/tests/` or `/inbox/` that names a drive, starts with a slash or climbs out is refused now; only files inside those two folders are served. (The installed app has no `tests` folder beside it and was not open to this.)
- Cause: `translate_path` joined the rest of the URL onto the folder, and `Path / "C:/x"` or `/ "/x"` throws the folder away; `normpath` keeps a drive letter.
- Where: `app/serve.py` (`_inside`, `translate_path`). Checked against a second server on port 4251: `/tests/C:/Windows/win.ini`, its `%3A` spelling, `/tests//etc/passwd`, `%2E%2E` and `/inbox/C:/...` give 404, a test file and `/inbox/GearboxAssy.glb` still load. Not in the test suite.

![fix][fix] **A dot-folder could be read under its Windows short name** (`/VENV~1/pyvenv.cfg` for `.venv`) in a copy of the repository. A path with a short name in it is refused like one with a dot-folder.
- Cause: `_hidden` looked only at the spelled name.
- Where: `app/serve.py` (`_hidden`). `/VENV~1/pyvenv.cfg` gives 404 on the same test server.

![fix][fix] **On the WebGL2 renderer the floor grid and the red and green axes were drawn over parts** standing more than about half way to the floor behind them. The grid is hidden by parts as on WebGPU.
- Cause: the grid writes its own depth from the projected z, which is 0..1 on WebGPU and -1..1 on WebGL; it was written unconverted, so too near.
- Where: `app/js/app.js` (`_makeShaderGrid`, `ndcZ`). Not yet checked in the browser on WebGL2 (`?webgl=1`).

![fix][fix] **Animate did not open when the browser blocks site storage.** It opens; its window just starts in its default place.
- Cause: the one `localStorage` read in the app outside a `try`.
- Where: `app/js/app.js` (`buildMini` in `_Anim`).

![fix][fix] **After an OBJ export the whole exported model stayed in memory until the next OBJ export.** The names list of an export is local to that export now.
- Cause: `_exportObjStreaming` kept its names map and the export root as properties of the function.
- Where: `app/js/app.js` (`_exportObjStreaming`).

![fix][fix] **A Draco-compressed export could carry stray bytes** when the compressor handed back a view into a bigger buffer. Only the file's own bytes are written now, as the meshopt branch already did.
- Cause: `compressed.buffer` returned the whole underlying buffer.
- Where: `app/js/app.js` (the Draco step of the export). Not seen in a real file; found by reading the code.

![fix][fix] **Merging parts failed with a stack error in a scene of about 100,000 parts or more.** It works at any count.
- Cause: `Math.max(...state.parts.map(...))` spreads every id as an argument.
- Where: `app/js/app.js` (`_mergeSelectedCore`).

![fix][fix] **Check model could crawl on a big unwelded mesh (a soup of loose triangles).** Its edge table is kept at most half full, so lookups stay quick.
- Cause: the table was sized for 3 edges a triangle, which is also how many edges an unwelded mesh has: nearly full, and linear probing slows to a crawl.
- Where: `app/js/meshcheck.js` (the edge table, now 6 slots a triangle).

![fix][fix] **Holding S or M flipped isolate or Measure on and off for as long as the key was down.** A held key acts once.
- Cause: no `e.repeat` check on the two toggles.
- Where: `app/js/app.js` (`_wireRevealAndKeys`, the Measure key handler).

![fix][fix] **Fit to budget planned every part down to 16 triangles when the scene had a part of no size** (flat to a point or a line). A part like that no longer throws the plan off.
- Cause: its weight was 1e-12, so the top of the search was near 1e17 and 48 halvings never came down far enough.
- Where: `app/js/app.js` (`_budgetPlan`: a part of no size weighs a millionth of the largest one). Found by reading the code; not reproduced with a real file.

![fix][fix] **A second confirm or input box opened while one was showing left the first one waiting for ever** (whatever asked it never went on). They now wait their turn: the second shows when the first is answered.
- Cause: `_Dialog` kept one shared `onClose`, and the second open replaced the first one's.
- Where: `app/js/app.js` (`_Dialog`: a queue in front of `confirm` and `prompt`).

![fix][fix] **The updater could put old files over a newer installation, or report a rollback that did not happen.** "Restore the earlier version" (and the automatic rollback at start-up) now refuses a backup taken for another version than the one installed (one left behind by a reinstall), refuses a backup with saved files missing, before touching anything, and refuses to run while an update is moving files. The installer clears the old backup and the unconfirmed-update marker after it copies a version in, and asks for MeshOptimiser to be closed first instead of stopping half-way on a file the running app holds. A feed with a size or launcher level that is not a number now says so instead of "did not answer", and a manifest whose delete list is not a list of names is refused.
- Cause: `rollback` checked only that a backup existed; `_restore` skipped files it could not find and still wrote the old version number; `install.ps1` keeps `.update`; `int()` on feed values raised `ValueError`.
- Where: `app/updater.py` (`rollback`/`_rollback`, `_swap`, `_int`, `verify_archive`), `app/serve.py` (the rollback action), `app/install.ps1` (the running-app check, the stale backup).
- Test: `tests/updater.test.py` (a backup for another version, a backup with a file missing, a size and a launcher level that are not numbers, a delete list that is a string). The installer changes are checked by parsing the script only, not by running an install.

![fix][fix] **The update card said "did not come back" on two occasions when nothing was wrong:** after "Restore the earlier version" on an install that cannot restart itself (it now says to start the app again), and when the server missed two status answers during a long download (it now waits much longer before taking silence for a restart, unless the files are already being swapped).
- Where: `app/js/updater.js` (`watch`, `rollback`), `app/serve.py` (the rollback answer names the phase). Not yet checked in the browser.

![fix][fix] **A recovery copy taken while the Save dialog was writing made the saved file remember the Solid view** instead of the view that was on. The two now share one switch to Solid, and the view is put back when both are done.
- Cause: `_withSolidView` was entered twice, and the inner one, ending first, cleared what the file should record.
- Where: `app/js/app.js` (`_withSolidView`).

![fix][fix] **Someone working in Clay, Wireframe, X-ray or Heatmap all session got no periodic recovery copy.** Copies are taken in those views too: less often (a quarter as often) and only after 20 seconds without input, because the view shows Solid while a copy is written.
- Cause: the timer skipped every view but Solid.
- Where: `app/js/app.js` (`_Autosave`, `tick`). Not yet checked in the browser.

![fix][fix] **In a browser without the save dialog (Firefox, Safari), cancelling the download's save sheet left the scene marked as saved with no recovery copy.** The scene is still marked as saved (the browser does not say whether the download was cancelled), but the last recovery copy is kept until the scene changes again.
- Cause: the download path marked the scene saved and dropped the copy before the browser had written anything.
- Where: `app/js/app.js` (`_Dirty.mark({ keepCopy })`, `_Autosave.hold`, the end of the scene save). Not yet checked in Firefox.

![fix][fix] **Saving with "camera / view" unchecked and no notes dropped the animation from the file.** The scene's state goes in every saved file; with the box unchecked it holds the notes and the animation, as intended, and not the camera or view.
- Cause: the marker that carries the scene state was added only when the view or notes were saved.
- Where: `app/js/app.js` (the scene save). The review also named the explode amount and the measurements: those belong to "camera / view" and are still left out when it is unchecked.

![fix][fix] **A recovery copy that failed to load made the next file opened count as the recovered scene** (marked unsaved, its crash copy replaced). Only the copy itself counts now.
- Cause: `state._recoveredFile` was set before the load and read by whatever loaded next.
- Where: `app/js/app.js` (`_Autosave.recovered` checks the loaded file's name).

![fix][fix] **In Claude mode, opening or dropping a file replaced a scene with unsaved changes without asking.** It asks first ("Replace the unsaved scene?"), as the tabs make that question unnecessary elsewhere.
- Cause: Claude mode has no tabs, and the open path did not check for unsaved changes there.
- Where: `app/js/app.js` (`_handleSelectedFile`). Not yet checked in Claude mode.

![fix][fix] **A part lost its CAD lines after Remesh or Close holes.** It keeps them now: the lines of the CAD file are on the surface, and the new shape still lies there. The CAD faces (the hover tip) do not carry over, so the part has lines but no face info after such a tool.
- Cause: a changed geometry dropped its B-rep record (`_disposeEdgesFor` -> `_Brep.drop`) and the new geometry got none, so the lines fell back to the angle-based ones, and the pill's data was gone for that part.
- Where: `app/js/app.js` (`_Brep.carryFor`, called from `_cadEdgesPartSwapped`; `drop` keeps the dropped record for it). Only tools that call `_cadEdgesPartSwapped` are covered; not yet checked in the app with a STEP part, and a tool that moves vertices far from the surface (Convex hull, Voxel remesh) would draw lines that no longer sit on it.
- Test: none yet.

![fix][fix] **After a mesh tool (Remove fillets and chamfers, Remove holes, Remesh evenly, Voxel remesh, Round part and the others), undo brought the part back without its CAD faces: the CAD edges pill no longer counted it, and the tools that need the faces said the part had none.** Undo brings the CAD faces back with the part now, and the CAD edge lines are drawn from them again.
- Cause: when a tool swaps a part's geometry, the old geometry is freed two frames later with `_disposeEdgesFor`, which also dropped its B-rep record; undo then put the same geometry back, record gone. And the edge-line builder never asked the record when its cache was empty.
- Where: `app/js/app.js` (`_disposeEdgesFor(g, edited)`: a geometry that is only freed keeps its record, an edit in place still drops it; the four freed loops pass `false`; `_Brep.rebuild` and the first lines of `_getEdgesGeom`). Not yet checked in the browser; the part of the Scania scene on which this was found has to be opened again to get its faces back, since the record was lost in the running session.

![fix][fix] **A big model (the Scania truck, 5.8 million vertices) still floated above the floor after Align to the floor.** The floor now meets the lowest real vertex however many vertices the model has.
- Cause: above 3 million vertices `_liveModelBox` measured every part by the corners of its box, and a part that is turned (a wheel, a round part) has a box that reaches below the part itself; the model was then placed on that lower line.
- Where: `app/js/app.js` (`_liveModelBox`, `_ALIGN_EXACT_VERTS` now 60 million): a part square to the axes is measured by its box (exact), a part whose box lies inside the box found so far is skipped, any other part by its vertices. Not yet checked with the truck itself (I could not open it here), and a model past 60 million vertices still uses boxes.
- Test: none yet.

![fix][fix] **The icon of a right-click menu row greyed out while the pointer was in its second menu.** The row that opened the second menu now keeps its white icon and shortcut text, like a hovered row.
- Cause: only `:hover` made the icon white; the open row (`.is-open`) had the accent background but kept the grey icon colour.
- Where: `app/index.html` (`#ctx-menu .ctx-menu-row.is-open` rules). Not yet checked in the browser.

![fix][fix] **Second menus (the lists that open beside a right-click menu) showed icons.** They now show only the words; the first list keeps its icons.
- Cause: `_ctxFill` drew `icon` for every list, submenus included.
- Where: `app/js/app.js` (`_ctxFill`), cache-buster in `index.html`. Not yet checked in the browser.

![fix][fix] **The Layers switch in the STEP import settings had a long description that named Claude.** It is *Keep layers* now, with one line: each part remembers its CAD layer, for Properties and Select by layer. The docs article says the same.
- Where: `app/index.html` (`#imp-step-layers-lbl`), `site/docs-content.js` (help, knowledge and site rebuilt).

![fix][fix] **A STEP opened with its CAD edges lost them after I saved it as a GLB and opened the GLB again** (the CAD edges pill and the true edges were gone). A GLB saved from the app (Export, and Save scene) now carries the CAD faces and edges inside the file, and opening it brings the pill and the lines back. Not carried: a GLB saved with Draco or Meshopt, merged into one mesh, or as .gltf; a part another tool has changed has no CAD edges to save. The first version of this fix covered Export only, so a scene saved with Save scene still lost the pill; that path writes them too now.
- Cause: the CAD faces and edges are read from a sidecar (`<name>.glb.brep.json` / `.bin`) that only the STEP conversion writes beside its GLB; the exporter wrote nothing of it, so a saved GLB had no record to attach on load.
- Where: `app/js/app.js` (`_Brep.noteExport`, `pack`, `embedGlb`, `stageFromGltf`; `getSharedGeom`, `_doExportImpl` and `_saveSceneImpl` on export; the GLB loader before `_Brep.attach`), cache-buster in `index.html`. The points are one more bufferView of the GLB and the records sit in the file's root `extras.moBrep`.
- Test: the byte-level writer was checked on a minimal GLB (sizes, padding, points read back). Not yet checked in the app with a real STEP part, saved and reopened.

![fix][fix] **The Claude tools test kept answering about the first scene tab after `open_file` opened a second one.** It looked like the tools did not follow the tab; the app was right all along: every scene tab is a page of its own with its own tools, and the bridge in the app hands each call to the active tab's page (`activeWin`). The test called the first page's tools directly. It now picks the active tab's tools the way the bridge does, and checks that `open_file` while a scene is open lands in a new tab that the next calls see (the reopened file's name, no undo steps, the part that was hidden in the file).
- Cause: `tests/e2e-mcp-tools.mjs` read `window.__moBridgeTools` of the first page, not of the active tab.
- Where: `tests/e2e-mcp-tools.mjs` (`call`). Not an app change.

![fix][fix] **The browser tests opened nothing: the sample model `inbox/GearboxAssy.glb` was not served.** Since the repository tidy the app's own inbox is `app/inbox`, and the sample models stayed in the repository's `inbox/` beside it, so every e2e test that opens `inbox/GearboxAssy.glb` got a 404 and a page with no parts. The server now serves a file from the repository's `inbox/` when the app's inbox has none of that name (the same rule it already had for `tests/`).
- Cause: `translate_path` in `app/serve.py` mapped `/tests/` to the repository but not `/inbox/`.
- Where: `app/serve.py` (`translate_path`). Checked with `tests/serve-paths.test.py`; the e2e suite was run with the sample copied into `app/inbox/` because the server that was running was the older code (the fix takes effect when the server is started again).

![fix][fix] **The Remove holes switch "Raised lettering and logos" read as a typography option, so nobody would raise its limit to take a boss or a stamped collar, which is exactly what it does.** It is now *Raised details (lettering, bosses)*, and its tooltip and the *Raised, up to* tooltip say that embossed type is 0.1 to 0.5 mm, a boss or a stamped collar a few mm, and that the limit should sit just above what should go, or ribs and pins go too. Same in the docs article and the Help window; no change in what it does.
- Where: `app/index.html` (`#fh-raised-lbl` and the two tooltips), `site/docs-content.js` (the fill-holes article; help, knowledge and site pages rebuilt).

![fix][fix] **The Layers switch on STEP import did nothing I could see.** The converter read the layers and wrote them into the file, but the app never looked at them. Now it does: see *Parts keep their CAD layers* under New.
- Cause: the loader ignored the `layers` extras of the converter's product nodes, so the pass the switch paid for was thrown away.
- Where: `app/js/app.js` (`_layersOfNode`, called from `_ingestSceneRoot`).
- Test: `tests/e2e-mcp-tools.mjs`.

![fix][fix] **The search bar of the Notes card closed itself when I clicked elsewhere, and the search button flickered.** The bar now stays until the search button is pressed again.
- Cause: it closed when the box lost focus, and pressing the button took the focus first, so it closed and opened again.
- Where: `app/js/notes.js`. Not yet checked in the browser.

![fix][fix] **Pressing the Notes "…" button again did not close its menu.** The press closed it and the click opened it again. The button now notes whether the menu was open on the press (a first version tested `offsetParent`, which is always null for this fixed menu, so it never worked; it tests the menu's display now).
- Where: `app/js/notes.js` (`moreWasOpen`). Not yet checked in the browser.

![fix][fix] **Leaving Photo mode left its loft studio HDRI behind as if it were the chosen one,** when the background had not been an HDRI before. It is let go of and the HDRI controls read "Built-in studio" again.
- Where: `app/js/app.js` (`_Photo` leave). Not yet checked in the browser.

![fix][fix] **With one height per dock, a dock that was open at start came up with the height of another.** The height of the open dock is applied at start.
- Where: `app/js/app.js` (`_wireMatDockResize`, the Animate dock). Not yet checked in the browser.

![fix][fix] **The Pick parts and Filters & flags cards had uneven gaps** (a margin, the card gap and the hint's margin added up).
- Where: `app/index.html`. Not yet checked in the browser.

![fix][fix] **The docs and the knowledge base still used the old step names of Smart optimise** (Remove parts hidden inside, Bolts, nuts, washers, Triangle target …). They use Empty parts, Hidden parts, Fasteners, Small parts, Holes and Target now; the generated pages and knowledge files were rebuilt.
- Where: `site/docs-content.js`, then `tools/app/build-help.mjs`, `tools/site/build-app-site.js`, `tools/app/build-knowledge.mjs`. The Exact copies and Tolerance steps are not described in the article yet.

![fix][fix] **Small clean-ups from a review:** a job says itself whether it puts a task on the Tasks list (`_Job.run(name, fn, { task: false })` instead of a list of names); the drawn Studio gradient is made once; the drag on a row is set up by one helper (`_scrubDragAll`) instead of six copies of a loop.
- Where: `app/js/app.js`. Not yet checked in the browser.

![fix][fix] **Between the name of a slider row and its number field there was a stretch that could not be dragged, and its width differed from card to card.** The space is part of the name now (it is padding, not a gap), so the whole row from the name to the field drags, in every card: the sliders, the Scene, Camera, Lights and Photo mode rows and the Smart optimise style rows.
- Where: `app/index.html` (`.scrub` in the right sidebar, `.prim-row`, `.cmd-num`). Not yet checked in the browser.

![fix][fix] **The app lagged after the drag-hover rules were added.** Two of them were written with `:has()` on every element in the page, which makes the browser re-check the whole page after each change; they are plain class rules on the number rows now.
- Cause: `:has(> .size-field):hover > .size-field`, `:has(> .size-field) > span:first-child` and `.prim-row:has(.prim-val-wrap) .prim-label` in `app/index.html`.
- Where: `app/index.html` (the slider hover rules after `.mat-row-val:hover`). Confirmed by the user: the lag was gone after the change (not measured with a profiler).

![fix][fix] **In the Smart optimise card (and other cards with a name and a number field), the number could only be dragged on the field itself.** The name of the row drags it too, the pointer is the drag one over the whole row, and the field's edge lights while the pointer is anywhere on the row.
- Cause: those rows are a name and a `.size-field`; only the input was made draggable, and nothing reacted to the row.
- Where: `app/js/app.js` (`_autoScrubField`, its `wire`), `app/index.html` (the row hover and cursor rules after `.mat-row-val:hover`). Not checked in the browser: a headless test of dragging from the name did not reach the row.

![fix][fix] **Remove holes left two of the four port collars of the Scania V8 oil cooler as dark dimples, and no second run would take them.** A raised detail (a boss, a stamped collar) that is flattened now takes along whatever other geometry stood inside its volume: on this cooler the collars are stamped domes with an inner skin under them, and once the dome was gone the skin stood out of the new flat face, facing inwards, as a dark disc (two of the four happened to be swept up by a neighbouring hole; two were not). With *Hole width up to* 35 mm or more and *Raised, up to* 5 mm or more, one run now gives the plain bevelled block (109,712 triangles to 3,182); before, it took three runs with rising limits to get there, and the one-run result could not be repaired by running again (the skin had no face to be a hole in).
- Cause: `fillFlatHoles` removed a raised detail's own surface and capped its footprint, and never looked at what the closed surface had hidden. What was inside the detail is outside the part afterwards, and the enclosed-pieces sweep does not see it because it is not enclosed.
- Where: `app/js/holefill.js` (`removeInsideRaised`, called after a raised detail is accepted: every triangle above the face, within the detail's box, that a ray along the face normal leaves through an odd number of the detail's triangles). `holefill.js?v=31`, `mesh-worker.js?v=54`.
- Test: `tests/holefill.test.mjs` (14: a sheet hidden inside a low boss goes with it, the same sheet beside the boss stays). Checked offline on the exported part with the three settings tried (12 then 25 then 35 mm; 35 mm with raised 5 mm; 56 mm with raised 25 mm and *Keep openings that shape the part* off): all give the same 3,182 triangles, and the headless render shows a flat front. Not yet run in the browser on the open scene.

![fix][fix] **Switching Shadows off in the Scene card while Photo mode was on flooded the console with "binding should be available" and "Unable to serialize Texture".** Photo mode keeps the shadows on, so the Shadows switch is greyed out while it is on (with a tooltip) and comes back when Photo mode is left; the value from before is restored then.
- Cause: switching off the sun's shadows removed its shadow map while the Photo floor, which receives it, was still drawn with it.
- Where: `app/js/app.js` (`_Photo` enter and leave). Not yet checked in the browser; I did not look for the same fault with the other things that change shadows during Photo mode.

![fix][fix] **The small switches in the sidebar cards (Photo mode, Floor disc, the effects, and every Shape parameters switch) were pale blue, not the app's colour.** They are grey when off and the accent blue when on, with a white knob, like the other switches.
- Where: `app/index.html` (`.prim-row .prim-toggle`). Not yet checked in the browser.

![fix][fix] **In the "..." menu of all commands, the submenus (Select, Edit, Repair, Share) did not show, and a horizontal scrollbar appeared at the bottom of the list.** The submenu now opens beside the list and is visible.
- Cause: the list scrolls (`overflow-y:auto`), which also clips sideways, and the submenu was positioned inside it, so it was cut off and made the list scroll sideways.
- Where: `app/js/app.js` (`_ctxSub`: the submenu is `position:fixed` and placed from the window), `app/index.html` (`#ctx-menu.is-commands` gets `overflow-x:hidden`). Checked in headless Chrome (Edit opens its submenu, hit-tested as visible, no horizontal scroll); not by eye, and not with the right-click menus.

![fix][fix] **The icons in the Animate title bar were smaller than those of the Library and Materials.** Film, panel, pop-out and close were 18 px, theirs are 20 px, and the pop-out sat 2 px from the close button instead of 8. They now match. Measured in headless Chrome (button and icon sizes); not looked at in a browser by eye.
- Where: `app/index.html` (the Animate lines after the "pop-out and close" rule of the docks).

![fix][fix] **The number boxes of Shape parameters did not follow the mouse when dragged.** The fill in the box moved faster or slower than the pointer, depending on the range of the value. Dragging across the whole box now covers the whole range, so the fill stays under the pointer (Shift still goes ten times faster, Alt ten times finer). The Photo mode card uses the same boxes.
- Cause: a fixed number of pixels per step, whatever the range the fill is drawn against.
- Where: `app/js/app.js` (`_scrubDrag` takes a function for `pxPerStep`, `_fillPxPerStep`; the Shape parameters card and the Library inspector). Not yet checked in the browser with a mouse; the Photo card's boxes are covered by `tests/e2e-photo.mjs` only for typing.

![fix][fix] **The bottom docks (Animate, Library, Materials) faded a shadow in and out when switching between them.** The soft shadow along their top edge went with each dock as it slid. It is gone; the thin border line stays.
- Where: `app/index.html` (`box-shadow` of `#vp-animate-pop`, `#vp-library-pop`, `#vp-materials-pop.mat-dock`). Not yet checked in the browser.

![fix][fix] **Most commands that take a while were not on the Tasks list in the status bar.** Reduce, Split, Merge, Merge by colour, Merge triangles, Triangulate, Flatten, Smart fit, Fit to a budget and Smart optimise now show there while they work (no percentage: they do not report one). Voxel remesh, Remove holes, lettering and loading already did.
- Cause: only the commands that report progress put themselves on the list; the shared job runner did not.
- Where: `app/js/app.js` (`_Job.run`, `_JOB_OWN_TASK`). Not yet checked in the browser.

![fix][fix] **The Studio gradient background was a flat colour, not a gradient.** It is a blue-grey sky fading to dark navy at the bottom again.
- Cause: the gradient was built with `THREE.mix`, `THREE.color` and `THREE.uv`, which do not exist (they are in `THREE.TSL`); the call threw and the flat fallback colour was drawn every time. `uv` was also the wrong input: on the background it is one value over the whole picture.
- Where: `app/js/app.js` (`setBackground`, mode `grad`): `THREE.TSL.mix` with `screenUV.y` on the WebGPU renderer, a drawn ramp as the background texture on any other. Not yet checked in the browser (neither renderer).

![fix][fix] **A dropdown open in the sidebar stayed open, in the wrong place, when I scrolled.** It now closes as soon as the sidebar (or anything else behind it) scrolls; scrolling inside the list itself still works.
- Cause: the list is placed from the button's position when it opens and nothing listened for scrolling.
- Where: `app/js/app.js` (the shared dropdown listeners after `_initCustomSelects`). Not yet checked in the browser; the colour picker and the other pop-ups were not changed.

![fix][fix] **With Shadows on, the model also threw a shadow on the ground grid.** The floor shadow is off now: the sun's shadows fall on the parts themselves only. The switch's tooltip says so.
- Where: `app/js/app.js` (`_FLOOR_SHADOW` before `_shadowFloor`; set it to true to bring the floor picture back), `app/index.html` (tooltip). Not yet checked in the browser.

![fix][fix] **Choosing a look on the Shading card (Clay, Steel, Red wax, Ceramic, Light …) switched the Wireframe off.** With the Wireframe on, a look is now dressed under the lines and the lines stay; choosing the same look again takes it off, and Solid or any other view still replaces both.
- Cause: a view mode was one value, so a look and the Wireframe could not be on together.
- Where: `app/js/app.js` (`_wireShade` and `state.shadeUnder` in the Wireframe wrapper of `setViewMode`; `choose` and `sync` of the Shading card; `_shadeKind`; `_withSolidView` puts the look back after an export). Not yet checked in the browser, nor with CAD looks over a very large model.

![fix][fix] **Repair mesh and Fix normals › Align made a part worse: after them the Model inspector found more empty and doubled triangles and more edges shared by three or more triangles than before.** On the Scania engine, Repair mesh took the counts from 1,625 empty triangles to 7,413, and from 60 such edges to 255. Turned faces now keep their own corners. Repair also now uses the inspector's own idea of which points are one and which triangles have no area, so it mends what the inspector counts. On the same engine, Repair now takes every one of those counts to 0 (empty 1,625, doubled 21, edges of three or more triangles 60, pinched corners 130, inside-out pieces 11).
- Cause: when a triangle was turned, its second and third corners swapped places, but the step that builds the output still read each corner's own vertex (and its normal) from the old place. A vertex shared with other triangles then took the position of its neighbour, which tore the turned faces apart. Only a part with normals took that path, which is nearly every part; it was there before this release's changes. Separately, Repair welded points by rounding them to a grid half the inspector's size and called a triangle empty only by its area, so it missed points a hair apart across a grid line and triangles whose corners lie on one line.
- Where: `app/js/meshrepair.js` (`repairMesh` step 3 records `turned`, step 4 `cornerOf` follows it; the weld by position and the empty test are `weldByDistance` and `flatness`, now exported from `app/js/meshcheck.js`; `splitNonManifold` first pairs the faces that are already one surface round both ends of the edge; `repairMesh` runs up to three passes while the last one took surfaces apart).
- Test: `tests/meshrepair.test.mjs` (an inside-out box with shared corners and normals: the old code left 4 doubled triangles and 3 edges of three or more triangles). Checked on five models by running the inspector's check before and after Repair on every mesh (a script in the scratch folder, not in `tests/`, since the models are not in the repository): no mesh got worse on any of them. Left after Repair: 5 pinched corners on the watch's face, 1 on a bolt of the drive unit, and 14 faces turned the wrong way on the coral scan (17 before). Not yet tried in the app.

![fix][fix] **The Model inspector's Repair mesh button on "Edges shared by three or more triangles" and "Pinched corners" changed nothing.** Repair mesh had no step for either. It now has one, Separate surfaces that only touch (on by default): round such an edge the faces are paired as the solids they close, a face left over (a fin, an inner wall) lets go of the edge, and at every point where the faces make more than one fan the smaller fans get their own corners, moved into their own faces by about a hundred-thousandth of the part's size, so the surfaces no longer meet there. No face is removed. Claude's `repair_mesh` takes it as `separate_touching`.
- Cause: the rows pointed at Repair mesh, which only welded, removed empty and doubled triangles and turned faces.
- Where: `app/js/meshrepair.js` (`splitNonManifold`, step 5 of `repairMesh`), `app/js/app.js` (`_repair` card: `rp-manifold`, the result line; `_driveCard` call of `repair_mesh`), `app/index.html` (the toggle), `app/serve.py` (`repair_mesh` schema).
- Test: `tests/meshrepair.test.mjs` (two boxes on one edge, two boxes on one corner, a fin on a sheet, a sound box left alone; after the repair the inspector's own `checkMesh` finds no such edges or corners). Not yet tried in the app on the engine model. The corners move by a hair, so a part that only touched another now has a seam there, not a join.

![fix][fix] **Repair mesh did not remove a triangle stored twice when the two copies had different uvs.** The Model inspector counted it as doubled; Repair mesh now does too, and also judges empty triangles by position.
- Cause: the weld Repair mesh works on keeps corners with different uvs apart (so the uv seams stay), and the doubled and empty tests used that weld.
- Where: `app/js/meshrepair.js` (`repairMesh` steps 2 and 3 now use a weld by position).
- Test: `tests/meshrepair.test.mjs` (a doubled triangle with other uvs).

![fix][fix] **Fix normals › Align did nothing on a part the Model inspector said had faces turned the wrong way, and could turn a whole part to match a small wrong patch.** Align now finds a face's neighbours by position, also across uv seams, so a face turned the wrong way next to a seam is turned. When some faces of a piece disagree with the rest, the side that covers most of the surface keeps its direction and only the smaller side is turned (a closed piece is still turned to face outward).
- Cause: the weld that Align works on also kept corners with different uvs apart, so across every uv seam the faces did not count as neighbours and were never compared (a CAD part with a seam on every face looked like loose open patches). And the walk over a piece kept the direction of the triangle it started from, so a start inside a small turned patch turned everything else.
- Where: `app/js/meshrepair.js` (`repairMesh` step 3: a position-only weld for the turning; `orientTriangles`: the larger side by area wins).
- Test: `tests/meshrepair.test.mjs` (inside-out cube with uv seams; a 4-triangle patch on a 200-triangle sheet, where the old code turned 196). Not yet tried in the app on the part that showed it (Engine_V8-XT-03B_1_000193__geom). A patch cut off from the rest by an edge that three faces share, or by a gap, is still not turned to match.

![fix][fix] **Split blew a part into hundreds of pieces, and glued separate solids together.** Three things were wrong. The weld rounded every point to a grid, so two copies of the same corner that differed by one float step could fall on both sides of a grid line and stay apart: about 2 % of such pairs, each one a face cut loose. The panel started on *Tight*, which welds only exact duplicates, with *Strict* (nothing welded, a CAD mesh falls into its faces) as the first button, and it remembered the *Faces* algorithm from the last session, so a mesh could come out as 500 or 850 "parts". And the only connection rule was shared points, so two solids that touch at a corner, along an edge or face to face (a bolt in its hole, two discs stacked) stayed one part. Now the weld joins every pair of points within the tolerance wherever they fall; the panel starts on *Normal* (one millionth of the model, a few float steps at its far end) with *Exact* last; *Faces* is chosen each time; and the new default algorithm, *Bodies*, treats a body as a closed surface: where more than two triangles meet at an edge they are paired into wedges of material, so each solid keeps its own and they come apart, while a T-junction inside one solid does not cut it. A split that would make hundreds of pieces of a few triangles each is named in the preview and asked about before it runs. Measured on the Scania V8 (254 meshes): the same 290 pieces as before plus 7 real ones; on the drive unit the three bolts and the two stacked flange discs come apart; on the chronograph the markers come off the dial; the gearbox is unchanged. Part 1295 of the Scania (the tensioner pulley with its bracket) is one closed surface in the STEP file, one solid by design, and no connection rule takes it apart: the docs say so now.
- Cause: `weld` in `split.js` hashed `Math.round(p / eps)`; `_wireMeshSplitter` started at `activeEps = 1e-9`, `activeMethod = 'vertex'`, and restored `method` from `localStorage`; only `byVertex` / `byEdges` existed.
- Where: `app/js/split.js` (`weld` is a union-find over a grid of 2·eps cells with the 8 nearest cells probed; `weldExact` for the bit-exact case; new `byBodies`: edge table, wedge pairing, T-junction join, crumbs); `app/js/app.js` (`_SPLIT_EPS_DEFAULT`, `_splitDispatchStats`, `_splitLooksWild`, `_splitConfirmed`, the panel defaults, the MCP `split_parts` default); `app/index.html` (the presets and the Algorithm list); `app/serve.py` (`split_parts` method enum); `site/docs-content.js` (the Split article; help and knowledge rebuilt).
- Test: `tests/split.test.mjs` (drifted duplicates at 40 places on the grid, boxes touching at a corner, an edge and a face, four boxes in contact, a T-junction box, a sliver and a flap on a seam, a cylinder, a sheet). Measured in Node on the four sample files; not yet tried in the app, and the confirm dialog is not yet checked there.

![fix][fix] **The Model inspector forgot its geometry scan when I isolated a part.** Isolating, hiding or showing parts now keeps the scan. After a fix, only the meshes the fix changed (and new ones) are scanned again, and their rows update, so a part that is fixed leaves the list and one that is not stays; the rest of the model keeps its result. Opening another file still drops the scan. Each row that is about parts can also be opened with its arrow to list them, the parts with the most of the problem first; a click on one selects it so it shows highlighted in the viewport, a double-click also frames it. The Heaviest parts section is gone from the card.
- Cause: the card checks a signature of the scene every 0.9 s and cleared the scan on any change, and the signature counted hidden parts; every change then meant a whole new scan.
- Where: `app/js/app.js` (`_ModelInspector`: `geoSignature`, `signature`, `row`, `partList`, `markSelected`, `fpOf` and the per-mesh `cache` in `runScan`, the timer in `open`). Syntax checked only; not yet tried in the app.

![fix][fix] **A good update could be taken back by itself.** After an update, three starts without the page confirming put the old version back, including starts where I had only run the server, or Claude had, and nobody opened a window. Now a start counts as failed only when the server did not come up, or the page was handed out and never confirmed; two such runs in a row are needed, and a quiet run starts the count again.
- Cause: `on_startup` counted every start, and only the page's confirm cleared the count.
- Where: `app/updater.py` (`on_startup`, `mark_listening`, `mark_page_served`), `app/serve.py` (calls them when it listens and when it serves `index.html`).
- Test: `tests/updater.test.py` (start-up).

![fix][fix] **An update could get stuck "running" until the app was restarted.** If the temporary folder for the download could not be made (disk full, no rights on `.update`), the updater never left its download state and every later check or install answered "An update is already running". The folder is now made inside the guarded part, so the error shows and the state resets.
- Cause: `tempfile.mkdtemp` ran before the `try` in the install thread.
- Where: `app/updater.py` (`start_install`, `run`). Not covered by a test (a failing temp folder is hard to stage); the code path was read, not run.

![fix][fix] **The Windows installer could write a file outside its folder.** A zip entry such as `../MeshOptimiser-x/file` passed the check that keeps files inside the install folder, because the check compared text with no trailing separator. Entries with `..` are now skipped and the check includes the separator.
- Cause: `$dest.StartsWith($root)` without a trailing `\`.
- Where: `app/install.ps1` (unpack loop). Parsed with PowerShell's parser; the installer was not run against a crafted zip.

![fix][fix] **The Windows installer did not check its download.** The installer unpacked whatever it got from the release address. The feed can now carry the full download's address, SHA-256 and size (`build-update.py --installer <zip>`); when it does, the installer uses only that file and stops if the checksum differs. The current `latest.json` has no such entry yet, so until a release is published with `--installer` the installer still runs unchecked and says so.
- Cause: the feed's checksum is for the in-app update archive, a different file from the installer's zip, and the installer never read it.
- Where: `app/install.ps1` (steps 1 and 2), `tools/app/build-update.py` (`--installer`). Not run end to end; needs a release built with `--installer`.

![fix][fix] **A release could list the same file to install and to remove.** Such an update would fail half-way, put everything back, and could never install. It is now refused before anything is touched, with a plain message.
- Cause: `verify_archive` checked each `delete` path but not that it was absent from `files`.
- Where: `app/updater.py` (`verify_archive`).
- Test: `tests/updater.test.py` (refusals).

![fix][fix] **Checking for updates while one was installing could reset it.** The check set the update's state back to idle, so the page showed nothing running and a second install could start. A plain check now leaves a running update's state alone.
- Cause: `check()` wrote `phase="idle"` whenever it was not called from inside an update.
- Where: `app/updater.py` (`check`).
- Test: `tests/updater.test.py` (check).

![fix][fix] **If the "update to confirm" note could not be written, the message was wrong.** The files were already new but it said the old version was still in place, and the safety net that takes a failing update back was not armed. Writing the note is now part of the step that is undone on any error.
- Cause: `_write_json(PENDING, ...)` ran after the try that restores.
- Where: `app/updater.py` (`apply_archive`). Not covered by a test (a failing write is hard to stage).

![fix][fix] **The installer ran Chrome's setup without checking who made it.** It now runs it only when the file is signed by Google and the signature is valid; otherwise it says Chrome could not be installed and carries on.
- Cause: the downloaded `ChromeStandaloneSetup64.exe` was started as is.
- Where: `app/install.ps1` (step 4). Parsed with PowerShell's parser; not run against a real download.

![fix][fix] **A failed package install said "Nothing was changed".** The app's files were indeed untouched, but pip works on the live Python environment, so some packages could already be new. The message now says the files were not changed and that some packages may already have been installed.
- Cause: the wording promised more than the step can: pip runs before the file swap, in the real environment.
- Where: `app/updater.py` (`_pip_install` messages and the module header). A real rollback of the packages (installing into a separate environment and swapping it in) is not done. Cancel is still not checked while pip runs.


![fix][fix] **A good update could be taken back after I closed the window early twice.** A run in which the page was served but did not confirm in time counted as a failed start, so two early closes rolled the update back. A page that loads and never confirms now has to happen three runs in a row; a server that never comes up still counts after two.
- Cause: a closed window looks the same as a broken page to the server.
- Where: `app/updater.py` (`on_startup`, new `dead` counter). Test: `tests/updater.test.py`.

![fix][fix] **An update could install a file and delete it again when the two paths differed only in capitals.** The check "installs and removes the same file" (and the duplicate check) compared exact spelling, but Windows sees one file. Both now compare lower-cased.
- Where: `app/updater.py` (`verify_archive`). Test: `tests/updater.test.py`.

![fix][fix] **Claude mode, split view: the Properties card was copied from the sidebar twice a second, and its copied styles repeated unrelated rules.** It is now copied only when the sidebar's card changes, and only the `#prop-body` selectors of a rule are carried over.
- Where: `app/js/app.js` (`stats`, the style copy in `ensure`). Syntax-checked only; not run in the browser.

![fix][fix] **Folders that start with a dot (`.venv`, `.git`, the update backup) could still be read from the local address.** Writing the dot as `%2e` in the address got past the check, because the file server decodes the address after it. The check now decodes first (twice, and also `%2f` / `%5c`).
- Cause: `do_GET` / `do_HEAD` looked at the raw path; `SimpleHTTPRequestHandler.translate_path` unquotes it afterwards.
- Where: `app/serve.py` (`Handler._hidden`). Test: `tests/serve-paths.test.py`. Seen on the running server before the fix (`/%2evenv/pyvenv.cfg` answered 200); the fixed server has not been restarted and checked yet.

![fix][fix] **Exporting an exploded view wrote a mix: some parts together, some apart.** Save already put the parts back together before writing; Export did not. Ordinary parts were written from their saved rest position and instanced parts from where the view had them, so the file had two layouts. Export now builds the file with the parts together and leaves the view exploded afterwards.
- Cause: `_doExportImpl` called `buildExportRoot` with the view still exploded; `_resolvePartWorldMatrix` reads `_exactWorld` for meshes and the live instance matrix for instances.
- Where: `app/js/app.js` (`_whileTogether`, used in `_doExportImpl`). Test: `tests/e2e-export-exploded.mjs` (fails without the change, passes with it; run against the Gearbox sample in headless Chrome).
- Not changed: a part that was moved with the gizmo while the view was exploded may still have the explode offset in its saved matrix (`_exactWorld` is refreshed on a drag); I did not check that case.
- Looked at and left alone: the recovery copy does not go through `_Anim.run` like Save, but a copy taken while a part spins still wrote the part at rest (same test), so nothing was changed there.

![fix][fix] **Undoing the delete of a whole group brought the parts back invisible, and the group stayed gone.** Deleting the last members of a user group dissolved the group after the members had already been taken out of it, so their meshes stayed under a container that was no longer in the scene: after Ctrl+Z the tree listed them and the viewport drew nothing until one was clicked. The delete now dissolves the group first (the meshes go back under the model), and its undo step carries the dissolved groups and the dropped memberships, so undo brings the group and its members back; redo takes them out again. A part deleted out of a group that survived also goes back into that group on undo.
- Cause: `deleteParts` removed the ids from `g.partIds` before calling `removeUserGroup`, whose re-attach loop then found nobody; the group went with `skipUndo`.
- Where: `app/js/app.js` (`deleteParts`, `removeUserGroup` now hands back what undo needs, `_userGroupPutBack` / `_userGroupTakeOut`, the `delete` undo and redo handlers).
- Test: `tests/user-groups-undo.test.mjs` (source-level). Not yet checked in the browser with a model.

![fix][fix] **Grouping parts that were already in a group, then undoing it, made the parts vanish.** The new group emptied the old one and dropped it without a trace; undo hung the parts back under the old group's container, which was no longer in the scene. The emptied groups are now recorded on the group's undo step and put back first, each part goes back into its previous group, and a previous parent that is not in the scene is never used.
- Cause: `addUserGroup` filtered the emptied groups out of `state.userGroups` without recording them; the `group` undo trusted `prevParent`.
- Where: `app/js/app.js` (`addUserGroup`, the `group` undo handler).
- Test: `tests/user-groups-undo.test.mjs` (source-level). Not yet checked in the browser.

![fix][fix] **After "Close without saving", no recovery copy was written for the rest of the session.** Closing the last scene (or the main one) from the strip and choosing to close without saving threw the copy away and then kept the same window for the next model; the autosave's "closing" flag stayed set, so a scene opened afterwards was never covered by a crash copy. The flag is cleared when the window is emptied and reused.
- Cause: `closing` in `_Autosave` was only ever set (`discardHere`, `pagehide`), never cleared; `_Tabs.close` reuses the window through `__moResetScene`.
- Where: `app/js/app.js` (`_Autosave.resume`, called from `_newSceneHere`). Not covered by a test; the path was read, not run.

![fix][fix] **A scene with a file imported into it read as saved: the tab closed without asking and no recovery copy was written.** Importing a model into an open scene cleared the history that the unsaved-changes tracking is built on, so the merged scene looked exactly like the saved file. An import into a scene that has parts now marks the scene unsaved (an import into an empty scene is an ordinary open).
- Cause: the import branch of `_ingestSceneRoot` did `state.history.length = 0` without telling `_Dirty`, whose `dirty()` compares the top of the history with the saved mark.
- Where: `app/js/app.js` (`_ingestSceneRoot`, import branch: `_Dirty.force()`). Not covered by a test; read, not run.

![fix][fix] **The Origin choice in Export never did anything.** "Recentre to bbox centre" and "Centre XY, drop to floor (Z=0)" (and the `ar` and `print` presets Claude uses, which ask for the floor) wrote the file exactly like "Keep model origin". The export builder only understood a value nothing sent. Centre now puts the middle of the model's box at the origin; floor puts the middle on X and Y at the origin and the lowest point at Z = 0 (in the app's own up axis, before the file's axis and unit scale are applied).
- Cause: `buildExportRoot` checked `origin === 'bbox'`; the dialog sends `keep` / `center` / `floor`, the presets `model` / `floor`, and there was no floor logic at all.
- Where: `app/js/app.js` (`buildExportRoot`). Not yet checked with an exported file; read, not run.

![fix][fix] **Remove hidden faces, Remove holes or Remove floating pieces could make a two-material part disappear.** When a tool removed every triangle of one material of a part with several, the rebuilt geometry got no draw groups at all, and a part with an array material is drawn group by group, so nothing was drawn while the triangle count still said most of it was there. The rebuilt geometry now carries one draw group per group of the source, in the source's order, also when a group is empty.
- Cause: `_geomFromIndexParts` added groups only when more than one part came back or the source had exactly one group; the callers leave empty groups out.
- Where: `app/js/app.js` (`_geomFromIndexParts`). Not covered by a test; read, not run against such a model.

![fix][fix] **An update whose page never came up confirmed itself after half a minute, so a broken version stayed.** The page waited up to 30 s for the app to be ready and then told the server the update was good whether or not it was, which disarmed the automatic rollback. It now confirms only when the app really came up.
- Cause: the wait loop in `start()` ran out and the confirm call followed unconditionally.
- Where: `app/js/updater.js` (`start`); `?v=` bumped in `index.html`. Not covered by a test; read, not run.

![fix][fix] **A crash in the middle of an update left the app half old and half new, and a retry threw the only backup away.** The note that arms the rollback was written only after every file had been replaced, so power loss or a kill during the swap left a mixed install that no start ever repaired; running the update again discarded the partial backup and skipped the files already replaced. The note is now written before the first file is touched, marked "applying", and a start that finds it puts the old version back from the backup. If putting the files back fails during an update, the note stays and the message says to start the app again (it used to say the old version was in place).
- Cause: `_write_json(PENDING, …)` came after the loop in `apply_archive`; `on_startup` had nothing to go on.
- Where: `app/updater.py` (`apply_archive`, `on_startup`).
- Test: `tests/updater.test.py` (start-up: "an apply that stopped half-way is undone at the next start").

![fix][fix] **On a bundled-runtime install, an update that changed the Python packages stopped the launcher from starting the app.** The update installed the packages into the bundled runtime and worked until the next start, when the launcher compared the requirements file with the runtime's manifest, saw an older hash, and looked for a system Python instead. The manifest now gets the new hash after the packages are installed.
- Cause: `_pip_install` only wrote the `.venv` marker; `runtime/MANIFEST.json` kept `requirements_sha256` of the build; `start.bat` goes to `no_runtime` when it is not found.
- Where: `app/updater.py` (`_runtime_manifest_note`, called from `_pip_install`).
- Test: `tests/updater.test.py` ("the runtime manifest gets the new requirements hash"). Not run on a real bundled-runtime install.

![fix][fix] **Repair mesh smoothed every hard edge of a sound CAD part, and called it a repair.** The weld joined vertices that share a place whatever their normals and kept the first one's normal for all of them; a clean 24-vertex cube came out as 8 vertices with wrong normals on every face, and because vertices had been joined it counted as changed. Corners now keep their own normal through the weld (they are one vertex for the topology, so faces still join across the edge, but stay apart in the output), and a part that comes out as it went in is left as it is. When the normals are rebuilt by the repair, the weld joins across them as before.
- Cause: `repairMesh` used one weld, by position and UV, both for the topology and for the output vertices.
- Where: `app/js/meshrepair.js` (`repairMesh`, step 4; the `normals` option), `app/js/app.js` (passes `normals`).
- Test: `tests/meshrepair.test.mjs` (normal checks).

![fix][fix] **A native crash in the STEP converter left the conversion "running" for ever.** The converter's heartbeat helper, which prints "still working" during long phases, inherited the server's pipe and on Windows never noticed that the converter had died, so the server kept reading a live-looking log, the job never ended, and the plain-reader retry that exists for exactly this case was never reached. On Windows the helper now holds a handle on the converter's process and stops when it ends.
- Cause: the helper's parent check was skipped on Windows (`os.getppid()` keeps returning the old pid there); `serve.py` reads the pipe to its end before looking at the exit code.
- Where: `app/step2glb.py` (`Heartbeat.__enter__`, the inline helper). Checked with a small script that lets a parent die under a helper and waits for the pipe to close; not with a real converter crash.

![fix][fix] **Deleting an animated part and undoing it brought the part back frozen mid-turn, with its animation gone.** Animate dropped the record of a part as soon as it was deleted, and the only copy of the part's rest position went with it. A deleted part now keeps its record and waits; the undo of the delete finds it moving again, and clearing the animation while the part is deleted puts its hidden mesh back to rest too.
- Cause: `applyRec` answered 0 ("nothing left to move") for a part that was merely deleted, and `applyAll` dropped every record that answered 0.
- Where: `app/js/app.js` (`_Anim`: `applyRec`, `applyAll`, `dropRec`).
- Test: `tests/animate-delete.test.mjs` (source-level). Not yet checked in the browser.

![fix][fix] **Splitting a part while the view was exploded left the pieces apart when the view was put back.** The pieces took the exploded place as their rest position. Split now puts the view together first and explodes it again after, as Merge did.
- Cause: `splitSelectedParts` copied `mesh.position` under an active explode and never called `resetExplode()`.
- Where: `app/js/app.js` (`splitSelectedParts` wraps `_splitSelectedPartsCore` in `_settledView`, the helper Merge now uses as well).
- Test: `tests/explode-undo.test.mjs` (part 4). Not yet checked in the browser.

![fix][fix] **Flattening the tree while the view was exploded made the exploded layout permanent.** Every part's rest position was measured again at its exploded place, so sliding the explode back to 0 left the model apart; a part deleted before the flatten was left at its exploded spot. Flatten now puts the view together once its dialog is answered and explodes it again after.
- Cause: `flattenTree_job` called `invalidateExplodeBaseline()` with the explode still active and never settled the view.
- Where: `app/js/app.js` (`flattenTree_job` runs `_flattenTreeCore` in `_settledView`).
- Test: `tests/explode-undo.test.mjs` (part 4). Not yet checked in the browser.

![fix][fix] **An exported animation of an exploded view circled each part around its explode offset.** The file's parts were written together, but the animation was baked after the view had been exploded again, so the clip carried the offsets: at time 0 the part was right, then it orbited instead of turning in place. The animation is now baked in the same breath as the parts, while they are together.
- Cause: `_animationClipForExport` ran after `_whileTogether` had restored the view; `_Anim.bake` reads the live matrices.
- Where: `app/js/app.js` (`_doExportImpl`: the clip is made inside the `_whileTogether` callback).
- Test: `tests/explode-undo.test.mjs` (part 5). Not yet checked with an exported file.

![fix][fix] **Another web page open in the browser could take over, or starve, the Claude connection.** The poll the app's window keeps open is a plain GET, and a request without an Origin header was trusted, so a page on any other site (or another local port) could become "the window", push the app's own poll away and swallow Claude's next command. Browsers say where a request comes from in `Sec-Fetch-Site`; anything but the app's own page (or an address typed in) is now refused.
- Cause: `_trusted` checked only Host and Origin; a no-cors GET carries no Origin.
- Where: `app/serve.py` (`Handler._trusted`). Takes effect after the server is restarted.
- Test: `tests/serve-paths.test.py` (trust). Not checked against a live cross-site page.

![fix][fix] **A STEP or IGES part placed with a mirror came out inside-out.** When a face carries a reflecting placement inside its shape, its triangles must be turned over as well; the converter turned them over only for faces marked reversed, so the normals and the winding disagreed and the face shaded inside-out (the model inspector called the part inside-out; viewers that cull back faces showed holes). Mirrored placements of whole parts were already right.
- Cause: `solid_to_mesh` flipped on `TopAbs_REVERSED` only, not on `det(location) < 0`.
- Where: `app/step2glb.py` (`solid_to_mesh`). The converter suite (`tests/converter.test.py`) was run after the change; no model with a mirrored face location is in it, so the case itself is not covered by a test.

![fix][fix] **Remove holes took minutes on a hole whose outline has thousands of points.** A finely tessellated round pocket (3,000 points on its rim) took almost seven minutes to close, in a worker that cannot be stopped. The test that decides whether a corner can be clipped off the outline ran over every point of the outline for every corner, for every clip. It now looks only at the corners that turn the wrong way, which are the only ones that can lie inside an ear; a round hole has none. The same 3,000-point hole closes in well under a second, and the triangles that come out are the same.
- Cause: `earClip`'s `blocked()` walked the whole ring.
- Where: `app/js/holefill.js` (`earClip`); `?v=` of the module bumped in `app.js` and `mesh-worker.js`.
- Test: `tests/holefill-proof.test.mjs` (600 and 3,000-point outlines under 5 s); `tests/holefill.test.mjs` unchanged and green.

![fix][fix] **A hole exactly as wide as the size limit was left alone.** A Ø10 hole measured 10.000000000000002 from its single-precision corners, so "holes up to 10 mm" skipped it as too large. The comparison now allows one part in a million.
- Cause: `f.size > maxSize` with no tolerance against the rounding of the mesh's own coordinates.
- Where: `app/js/holefill.js` (step 5, the size test).
- Test: `tests/holefill-proof.test.mjs` ("a Ø10 hole is closed with the limit at exactly 10").

![fix][fix] **Find stacked copies missed a duplicate whose vertices were welded differently.** The same part twice in the same place, once with its vertices shared (8 on a box) and once with a set per triangle (24, as CAD writes them), has the same triangles but not the same vertex count, and the card required both to match unless "Also near copies" was on. The vertex count is no longer required; the triangle count, the box and the centre of the surface are.
- Cause: `_findStackedCopies` compared `vertCount` in its exact mode.
- Where: `app/js/app.js` (`_findStackedCopies`).
- Test: `tests/stacked-copies.test.mjs` (case B; it drives the app's own function on built parts).

![fix][fix] **"Also near copies" missed a re-meshed duplicate whenever the finer triangles sat on one side.** Two exports of one part, one with a fillet meshed finer, have the same surface in the same place, but the mean of their vertices is not the same: it leans towards the denser side, and the check threw the pair out even at 2 %. The placement is now judged by the centre of the surface (each triangle's middle, weighted by its area), which does not move with the tessellation.
- Cause: `_stkMeanWorld` averaged the vertices.
- Where: `app/js/app.js` (`_stkMeanWorld`). The Clean up › duplicates step uses the same finder at its tightest and benefits too.
- Test: `tests/stacked-copies.test.mjs` (cases C and D). Not yet checked in the browser with a model.

![fix][fix] **Decimate at −75 % or −90 % could take a small part down to a sliver.** Quick remesh (B) refuses a result that has lost most of its surface and shows the next gentler level instead; Decimate had no such guard, so a bolt or a thin bracket could be reduced to a shape that reads as the part disappearing. Decimate now holds the result against the same guard (at least 60 % of the surface and 90 % of the size must remain), tries gentler shares first, and leaves a part alone, saying so, when none keeps its shape. Not applied in "Within…" mode, where the measured deviation already bounds it.
- Cause: the guard lived inside `_QuickRemesh` only.
- Where: `app/js/app.js` (`_shapeOf`, `_keepsShape`, shared; `_decimateSelectedRun`).
- Test: `tests/decimate-align.test.mjs` (source-level). Not yet checked in the browser.

![fix][fix] **Quick remesh (B) and Decimate gave different results for the same share.** B cleaned the flat faces before and after the reduction (Untriangulate and Un-Subdivide passes in the worker); Decimate did not, so "50 %" on B and "−50 %" on the card were not the same thing and nothing said so. The card now has a switch, {{Smart: tidy flat faces}}, on by default and remembered; both tools read it, and the hidden `window.__moQuickPlain` still turns it off.
- Cause: the `smart` flag was set only in `_QuickRemesh`'s worker message.
- Where: `app/js/app.js` (`_smartOn`, `_smartPayload`, shared by `_decimateSelectedRun` and `_QuickRemesh`), `app/index.html` (`#decimate-smart`).
- Test: `tests/decimate-align.test.mjs`. Not yet checked in the browser; the docs article `decimate` (site) and the help text do not mention the switch yet and need a line at release.

![fix][fix] **Reducing a CAD part broke its surface long before the triangles ran out.** A part from STEP (and from most glTF exporters) comes with a vertex per face corner, split at every hard edge for flat shading. The simplifier may only collapse along such a seam, so on a machined part every face was an island; the reduction missed its target, fell through to its loosest setting, and tore outlines and borders. Only meshes without an index were welded before. Every mesh is now welded by position first (UVs and colours kept apart, the normals re-creased afterwards at 30°), unless its vertices are already shared. Measured on the three heaviest parts of the Scania V8 at 10 %: the worst distance between the old surface and the new fell from 9.1 to 1.05 mm, from 73 to 10 mm (and that part's 98 border edges, of which 11 had been left, all stay), and from 24.5 to 4.5 mm; at 25 % from 1.4 to 0.5, 6.7 to 2.7 and 3.7 to 1.9 mm. Quick remesh (B) goes the same way.
- Cause: `_weldForReduction` returned an indexed geometry untouched; Decimate's worker path sent the split mesh as it was.
- Where: `app/js/app.js` (`_weldForReduction`, `_decimateSelectedRun`, `_QuickRemesh.levelOf`).
- Test: `tests/reduce-quality.test.mjs` (the real parts, about half a minute; `tests/draco-node.cjs` reads the Draco file in Node), `tests/decimate-align.test.mjs`. Not yet checked in the browser. A smooth mesh with custom normals that are split at edges (some game assets) now gets its normals re-creased at 30° after a reduction.

![fix][fix] **Keep sharp edges could make the rest of a part drift several times further.** Locking the vertices on hard edges spends the whole budget elsewhere; on one engine part at 10 % the locked result was 25 mm off where the plain one was 4.5 mm, and the lock was taken whenever it reached the target. The plain reductions are now always run as well, and the locked one is kept only when the simplifier's own error estimate for it is not clearly worse (within one and a half times) than the plain one's.
- Cause: `reduceIndex` returned the sharp-edge result as soon as it reached the target.
- Where: `app/js/simplify-core.js` (`reduceIndex`: `sharpR`, `pick`).
- Test: `tests/simplify-core.test.mjs` (the sharp path still wins on the rim test), `tests/reduce-quality.test.mjs`.
- Looked at and left alone: a bounded error limit per step (meshoptimizer's `target_error`) made no difference to the collapse order in share mode on these parts (measured: identical results at every limit from 0.2 % to 100 % of the extent), so it was not added.

![fix][fix] **After Remove holes, stray lines and points stayed inside a part.** A part's mesh can hold separate closed pieces inside its body: the oil pump of the Scania V8 (`Oil_Pump_V8-XT-08_1_001097__geom_009`) has four, each about 4 mm and 1,500 to 1,800 triangles, the balls of its valves. They were seen through the bores; with the holes closed they were sealed inside, never visible again, but still drawn, and in the edge overlay they showed through as floating lines and points. Remove holes now takes out every piece that lies entirely inside the closed part (new switch under Advanced, {{Remove what is sealed inside}}, on by default; the Claude tool `fill_holes` takes `remove_enclosed`). The part must be closed for it to judge; a part with an opening left anywhere is not touched by this step. On the oil pump: 10 holes closed, the four bodies gone, one closed piece of 97,326 triangles left (109,712 before).
- Cause: nothing looked at what the caps enclosed.
- Where: `app/js/holefill.js` (`removeEnclosedPieces`, `opts.enclosed`), `app/js/app.js` (`_fillHoleOpts`, the tally and toast, the `fill_holes` tool), `app/index.html` (`#fh-enclosed`), `app/serve.py` (the tool's schema).
- Test: `tests/holefill-proof.test.mjs` (part 6: a body in a bore goes, a free one stays, an open bore or an open shell leaves everything). The oil pump itself was run from the file in Node, not yet in the browser. The docs article `fill-holes` needs a line about the switch at release.

![new][new] **Lettering and logos: one card for text however the CAD system made it.** The cap `Oil_Pump_V8-XT-09A` of the Scania V8 carries raised lettering that Remove holes could not touch: the letters are a body of their own (996 triangles), sunk 3 mm into the cap and standing 0.5 mm proud, as CAD text usually arrives; a second body lies entirely inside the cap. The new card {{Remove lettering and logos…}} (search, or the Edit group) finds all three forms: raised text cut into a part's own mesh (flattened into the face, up to a rise), engraved text (closed as a shallow pocket, down to a depth; new `maxDepth` in the hole filler), and text modelled as separate bodies laid over a part (a small part that lies mostly inside another closed part and stands out by no more than the rise: `app/js/emboss.js`), plus bodies hidden entirely inside a part. {{Find lettering}} selects the bodies and counts the marks without changing anything; {{Remove}} deletes the bodies and flattens or closes the marks, two undo steps. Limits: raised up to (0.6 mm: the cap's text, drawn 0.5 mm high, measures 0.53 once tessellated), engraved down to (0.5 mm), largest mark (40 mm); the three kinds can be switched off one by one; the settings are remembered. Over the whole engine in world space (1,295 parts, 4 s) the finder names the cap's two bodies and two more small bodies set into other parts, and nothing else; Find only selects, so those two are there to be looked at. Scope: the selection only. The selected parts are judged and changed, and so is what is laid over them: a visible part whose box lies within a selected part's box and is well smaller than it (so selecting the cap finds its lettering, and selecting the letters alone finds their cap); with nothing selected the card does nothing and says so, and the command is greyed out in the search. The number fields can be dragged and scrolled like the others, so the card has a Reset to defaults link. Claude's tool wants ids, name_contains or a selection and errors otherwise. The search for bodies runs in a mesh worker (the first try ran it on the page and froze the window on the whole engine); with hidden bodies off, only parts no wider than the largest mark are judged at all. Claude has it as `remove_lettering` (with `dry_run`), under the delete permission.
- Where: `app/js/emboss.js` (`findEmbossedBodies`: ray-parity inside test against a closed host, closest-point distance for the rise; an open host judges nothing), `app/js/holefill.js` (`opts.maxDepth`), `app/js/app.js` (`_letteringFind`, `_letteringRemove`, `_wireLettering`; `_fillHolesRun` takes an override with `dryRun` and `quiet`; `_Actions` entry `lettering`; the `remove_lettering` tool, `EDITS` and `CAT`), `app/index.html` (section `data-cmd="lettering"`), `app/serve.py` (tool schema and label).
- Test: `tests/emboss.test.mjs` (a letter sunk and 0.4 mm proud is found, one 2 mm proud is not, one beside the plate is not, one buried is found and marked hidden, an open host judges nothing, welded input gives the same answer, a body as large as its host is not judged), `tests/holefill-proof.test.mjs` (part 7, the depth limit). On the engine file in Node, both bodies of the cap were found and the cap was not; not yet pressed in the browser. The "Raised details" switch under Remove holes stays for now. Docs: the site needs an article (`lettering`) and the knowledge base a line at release; `site.claude` tool list too.

A new test, `tests/holefill-proof.test.mjs`, checks what the hole filler must keep on any mesh rather than what it does on a particular one: a watertight input stays watertight with no edge used three times; a closed through or blind hole gives back exactly the solid's volume and the caps wind with their face; the triangles that stay are written unchanged and in order; filling again finds nothing; the same answer turned, moved 1e4 and 1e5 away, scaled by 1e-3 and 1e3, with the triangles shuffled, a Uint16 index, no index, welded vertices, the whole mesh wound inside-out, a doubled triangle or a zero-area stitch; 60 random plates with one to four round holes, through and blind, against a random limit (the holes within it are closed, the others stay, exact volume). All 44 checks pass. Not covered yet: outlines that touch themselves, walls with doubled or non-manifold edges, and the raised, ring-groove and floating-wall paths beyond what `tests/holefill.test.mjs` already has.

![fix][fix] **The line drawings on the command cards used colours the app does not define.** The drawings at the top of Remove holes, Split, Select hidden, Fasteners and Smart fit were written with the site's token names (`--accent`, `--surface`, `--tx-3`, `--mono`), which the app does not have, so the accent flash in one animation, the fill of the solid shapes and the small label text fell back to the browser's own values. They now use the app's tokens (`--ac-text`, `--surface-pop`, `--tx3` and a new `--font-mono`). Found by a design-system audit of the stylesheet (`docs/review-design-system.md`); fixed in the stylesheet, not yet looked at in the app.
- Cause: the block was brought over from `site/site.css`, where those names exist.
- Where: `app/index.html`, `<style id="cmd-art">` (`.tile-art .art-hot`, `.art-t`, `.art-solid`, `.art-fnd`, keyframes `art-core` and `art-lockc`); `--font-mono` is new in `:root` next to `--font-sans`.

![fix][fix] **Two rules named tokens that do not exist, so their padding and weight were lost.** The loading steps on the start screen asked for `--space-2` and the lock note in the properties card for `--fw-normal`; neither is defined. They now use `--space-xs` and `--fw-regular`. Found by the same audit, not checked on screen.
- Where: `app/index.html` stylesheet (`#welcome-load-pane .ld-step`, `.prop-lock-note`).

![fix][fix] **The Midnight, Warm and Black tones left graphite patches behind.** The shortcuts window's keys, the library cards and inspector, the material dock, the animation dock (its rows, ruler, lanes, inspector and footer buttons), the share menu under Export, the knob of the material editor's toggle and the splash card were painted with literal greys, so they stayed graphite whatever tone was chosen in Settings › Appearance. They now take their colour from the surface and text tokens (`--bg1`…`--bg4`, `--surface-pop`, `--tx`…`--tx3`), so a tone reaches them too. The shortcuts keys' three raised states are mixes of `--bg4` with a little white. Not yet checked in the app in any tone; the splash card's text is a step lighter than before (`--tx2` / `--tx3` instead of the old greys).
- Cause: these parts were added after the token pass, with the greys typed in.
- Where: `app/index.html` stylesheet (`.sc-key` and its states, `.exp-share-menu`, `.lib-item`, `.lib-inspector .li-view`, `#vp-materials-pop.mat-dock`, `.adk-scroll`, `.adk-ruler`, `.adk-rh`, `.adk-insp`, `.adk-bar`, `.cq-btn` disabled and danger, `.adk-addb:disabled`, `.mat-edit-toggle`, `.sp-card`, `.sp-art`, `.sp-info`, `.sp-word`, `#sp-status`). Left as they are: the two greys of the card drawings (`#77777c`, `#46464a`, the drawing's own palette) and the animation clip colours.

![fix][fix] **The colours a few parts paint from script stayed graphite in the other tones.** The dots of the mesh check, the quick wheel's cap and dot, the colour picker's surface and cursors, the quick ring and the frame of a scene tab had their colours typed into the style that app.js builds, so a tone or accent chosen in Settings › Appearance did not reach them. They now use the status, surface and text tokens; the quick ring also drops its typed-in fallbacks. The colour picker keeps the pure red, white and black of its hue strip and square: those are the picker itself, not the theme. Not checked on screen.
- Cause: styles built in app.js were written with the colours in, like the ones in the stylesheet fixed above.
- Where: `app/js/app.js` (`.mi2-dot` in the mesh check, `#qc-wheel`, `.cp-pop` / `.cp-cur` / `.cp-bar-cur`, `.qr`, the tab frame's cssText in `spawn`). Test: `tests/stylesheet-literals.test.cjs` now reads the styles app.js, cloner.js and notes.js inject too, and fails if a colour is typed in there.

![refactor][refactor] **Every layer has a name.** The 22 z-index values that were typed in as numbers (10 to 2147483000) are now `--z-*` tokens in one block of `:root`, lowest first, each keeping the number it had, so nothing stacks differently; the ones under 10 and two inside the animation dock stay numbers, as the stacking within one component. The window layer app.js hands out (`WIN_LAYER`) is read from `--z-window`. The test fails if a new z-index of 10 or more is typed in as a number. Not checked on screen.
- Where: `app/index.html` (`:root`, "Z-index scale"; `#tb`, `#vp-drop`, `#vp-settings-pop`, `#vp-brep-pop` / `-tip`, `.export-menu`, `.dlg-popup`, `#loader`, `#marquee-box`, `.toasts`, `.dlg-bg`, `#ctx-menu`, `#quick-wand`, `.brn-token-pop`, `#claude-pop`, `#mo-recover`, `.cq-bg`, `.mat-ghost`), `app/js/app.js` (`#qc-wheel`, `.cp-pop`, `.qr`, the brush ring, the tab frame in `spawn`, `WIN_LAYER`). Test: `tests/stylesheet-literals.test.cjs`.

![fix][fix] **The 3D view stayed soft (or needlessly heavy) after zooming the browser or moving the window to another screen.** The view's pixel ratio was set at start and when a model loaded, and nothing noticed devicePixelRatio change afterwards. Now the view picks up the new ratio as soon as it changes (still capped by the model's weight and Settings › Performance). Checked with the syntax check only, not on screen.
- Cause: no listener for a change of devicePixelRatio; a window resize does not always come with one, and onResize keeps the ratio it has.
- Where: `app/js/app.js`, `initRenderer` (`_followPixelRatio`, a media query on the current ratio that runs `applyPerfMode`).

![fix][fix] **The thumbnails of the shapes in the Add menu opened a second WebGPU device.** Their small renderer asked for WebGPU next to the viewport's and kept it for the session. It now draws on WebGL, like the library preview, with a context that keeps its picture for the read-back a frame later. The thumbnails keep their own tone mapping (ACES, brighter): they are accent-coloured icons, not previews of the view. Thumbnails already saved in the browser are kept. Checked with the syntax check only, not on screen.
- Cause: `new THREE.WebGPURenderer` without `forceWebGL`.
- Where: `app/js/app.js`, `_primThumb` → `init`.

![refactor][refactor] **A setting that did nothing is gone.** The renderer setup switched on `dithering` against banding, but this three.js version's WebGPU renderer has no such setting, so the line was skipped every time; a note says so in its place. Nothing on screen changes.
- Where: `app/js/app.js`, `_RendererOwner.applyConfig`.

![fix][fix] **Taking a screenshot made the view flicker, and the recent-file thumbnails did the same.** Every picture was meant to be drawn off screen and read back from the GPU, but that read-back failed every time, so each one fell back to resizing the live view for a frame. Pictures (Screenshot, Claude's render_image and the thumbnails) are now drawn off screen and read back without touching the view, with the same tone mapping and colour as the view shows; the old way stays as the fallback when a read-back is not possible (a picture larger than the GPU allows, for one). Checked headlessly on both renderers: the picture read back matches the one from the canvas pixel for pixel, the right way up, at 1000 px wide. Not checked by hand in the app.
- Cause: the pixel buffer was passed to `readRenderTargetPixelsAsync` as a sixth argument, as for the WebGL renderer; in three r172 that is the texture index (the data is returned instead), so the call threw "Invalid value used as weak map key", which a comment put down to "a known three.js issue". Fixing only that would have given darker pictures: a render target gets no tone mapping and stays linear. And on WebGPU r172 pads rows to 256 bytes without padding its buffer, and returns the top row first where WebGL returns the bottom row first.
- Where: `app/js/app.js`, new `_gpuCapture` (scene into a half-float target, a full-screen pass with `renderOutput` into an 8-bit one 64-px aligned on WebGPU, read back, cropped, rows in order), used by `_captureFrameAsBlobRun` and `_captureRecentThumb`. Test: `tests/e2e-capture.mjs` (`CAPTURE_GPU=1` for WebGPU on the machine's own GPU; headless SwiftShader has WebGL2 only).

![fix][fix] **The studio light and the HDRI lit a model from the side, and the HDRI's sky stood beside it.** The environments (the soft studio behind the plain backgrounds, the HDRI presets, a loaded .hdr or .exr) are made with their sky at +Y, and the scene is Z-up, so the studio's ceiling light fell on one side of every part instead of its top, and an HDRI's sky and ground lay to the left and right. They are now made standing on the scene's floor, and made again when Scene › Up axis changes; the HDRI background turns about the up axis, and in a Y-up scene the HDRI's sun light stands above the floor as well. Checked headlessly on WebGL2 and WebGPU with a white cube lit only by the environment: its top is now twice as bright as a side in the studio and blue-violet under Sunset with the side orange, in a Z-up scene exactly as in a Y-up one. Not checked by hand in the app; the reflections still do not turn with the sun puck (only the background and the sun light do: three r172 cannot turn an environment once it is made).
- Cause: three's environments are Y-up, and the node materials of three r172 ignore `scene.environmentRotation`; the background was turned about Z only. A comment said the turn worked for the diffuse light on WebGL2; it did not, on either renderer.
- Where: `app/js/app.js`, new `_envFromRoom`, `_envFromEquirect` (an equirect drawn onto a box round the PMREM camera with its lookup turned) and `_envFollowUp`; used by `_ensureStudioReflections`, `_ensurePresetEnv`, `_ensureHdriEnvironment`, `_loadCustomHdri` (which keeps the HDRI's source for a later change of axis); `_applyHdriRotation`, `_applyHdriSunPosition`, `_applySceneUpAxis`. Test: `tests/e2e-env-up.mjs`.

![fix][fix] **Remove lettering found nothing on the turbo's compressor housing, where "GARRETT" and the part numbers are cast into a curved face.** The marks in a part's own mesh were found by the hole filler's raised-details path, which needs a flat face to measure against: the housing's letters stand on a curved casting and are stitched into it, so there is no plane round them and no floor under them, and the card reported no lettering however the limits were set. The card now finds marks in a mesh by their shape instead: the mesh is cut into smooth patches at its sharp edges, and a mark is a small group of patches (its top, its walls, the island of face inside an O) sitting on exactly one big face and standing out of it, or sinking into it, by no more than the limits, measured along the face's own normal at the mark's rim, so the face may curve. The mark's triangles go and its footprint is capped flush with the face, with the face's own vertices, so there is no seam; the caps, the rim normals, the tidy and the undo step are the hole filler's. On the housing (`Engine_V8-XT-11_1_000345__geom_025`, 25,985 triangles) with the rise at 2 mm it finds the 15 marks of the lettering (1.5 to 1.6 mm proud) and takes 2,044 triangles out for 528 cap triangles, in under 40 ms; the two 3 mm features and the hole chamfers stay. At the default rise of 0.6 mm those letters are rightly left alone, and the card now says why: "18 raised marks stand higher than the rise (1.5 to 4.4 mm)" (the letters and the two bosses), so the limit can be set from what is there; the help on the rise field says that cast lettering stands 1 to 2 mm where CAD text stands half a millimetre. The hole filler's own raised-details path stays under Remove holes › Advanced, for flat faces.
- Cause: `_ltMeshAdv` sent the hole filler (`fillFlatHoles` with `opts.raised`), whose raised path looks for the loop round a letter on a flat face; a curved face has none, and a ray from the top of a stitched-in letter meets nothing under it.
- Where: `app/js/emboss.js` (`findSurfaceMarks`: patches by dihedral angle, 35°; a piece is a patch under half the square of the largest mark, so that limit also says what counts as a face; a face must have three times the mark's area; `earClip2D` for the caps; `tallest`, `lowestTall`, `deepest` and `shallowestDeep` for what was left), `app/js/mesh-worker.js` (op `marks`, the shape of a `fill` result), `app/js/app.js` (`_fillHolesRun` takes `over.op` and `over.undoLabel` and carries the heights of what was left in its tally; `_ltMeshAdv`, `_ltMeshRun`, `_ltLeft`, `_ltRange`), `app/index.html` (the card's words, tag `let6`), `app/serve.py` (`in_mesh` text).
- Test: `tests/emboss.test.mjs` (a plate with a 0.4 mm letter, a 0.3 mm pocket and a 2 mm boss stitched into its top face: the first two go with sound caps that use the face's vertices and face up, the boss is left and its height reported, each kind can be switched off, a 9 mm limit leaves the 10 mm letter and still closes the 8 mm pocket, welded input agrees, a mark that runs over the edge of its face is not touched). On the housing in Node the mesh has no open edge before and none after (the caps close exactly what was opened) and no cap is degenerate; that check is a scratch script, since the engine file is not in the repository. Not yet pressed in the browser: the page needs a reload. A mark whose rim has T-junctions (one edge of the mark meeting two edges of the face) counts as open and is left alone, so a hole is never left behind. On a small cap whose top is under half the square of the largest mark, the top counts as a piece and its letters are not found until the limit is lowered.

![fix][fix] **Remove lettering took two presses, Find and then Remove, and it was not clear why.** Remove lettering is now the card's one main button (Enter): it finds the lettering on the selected parts and takes it away in one go, and the card says what went (Ctrl+Z brings it back; two steps when there were both separate bodies and marks in the meshes). Find only, a smaller button beside it, still shows what would go without changing anything: it selects the separate bodies, counts the marks, and offers Isolate to look at the bodies. Nothing else changed: the limits, the three switches and Claude's `remove_lettering` tool are as they were.
- Cause: the card copied the Find › Isolate › Delete pattern of Stacked copies, where looking first matters more; here the user wanted the result.
- Where: `app/index.html` (section `data-cmd="lettering"`: `lt-remove` is the primary button, `lt-find` and `lt-isolate` a row under it), `app/js/app.js` (`_letteringFind`, `_letteringRemove`, `_wireLettering`: Isolate shows only after a Find that found bodies).
- Test: none; checked by eye in the browser is still to do (the user's page needs a reload).

![fix][fix] **On the turbo housing, Find only threw the selection away, and Isolate showed parts behind the housing instead of lettering.** Find selected the separate bodies it found; with none (the housing's letters are in its mesh) it selected nothing, so the selection was gone and Remove had nothing to work on. And the bodies it did find were the turbo's inner parts: a body counted as lettering when it lay mostly inside a closed part and stood out by no more than the rise, which a wheel or a fitting inside a housing's shell does. Now a body counts only when it also lies close under the face, no deeper than `sink` (4 mm, or five times the rise when that is more: the cap's letters are sunk 3 mm), so a thin letter or a logo's plate qualifies and a part deep inside a housing does not; Hidden parts remains the tool for those. Find keeps the selection when it finds no bodies.
- Cause: `_letteringFind` called `_ltPick` with an empty list; `findEmbossedBodies` had no limit on how deep inside the host a body may reach.
- Where: `app/js/emboss.js` (`findEmbossedBodies` `opts.sink`, `judge` returns `sunk`), `app/js/app.js` (`_letteringFind`), `app/index.html` (the hidden-bodies switch's help).
- Test: `tests/emboss.test.mjs` (a body 16 mm inside a thick block is not lettering, one 1 to 3 mm under its top is and its depth is measured, a wider sink lets the deep one through). On the turbo family in Node, with the card's defaults, the finder now names one body at a rise of 0.6 or 2 mm: `geom_018` (620 triangles, 55 % inside `geom_014`, 0.2 mm deep, 0.16 mm proud), a thin disc or plate for the user to judge with Find only; the inner parts no longer appear. The turbo case is not in the suite (the engine file is not in the repository); not yet pressed in the browser.

![fix][fix] **Remove lettering left a mess where the letters had been: stray edges and dark slivers across the patch (the turbo's `geom_024`).** The caps that close a mark's footprint were ear-clipped in the first order that worked, which on a thin stroke leaves a third of the triangles as slivers and some with no area at all; a triangle like that takes any normal it likes, so it shaded dark and the feature edges drew its sides. And the vertices on the cap's rim kept the normal they had with the letter's wall, so the face shaded with a ring round every cap. The clipper now takes the best-shaped ear at every step (the largest smallest angle) and never makes a triangle without area, and after the caps are in, every rim vertex takes the mean of the normals of the triangles that use it now, on a flat or a curved face.
- Cause: `earClip2D` took the first ear; `flattenRimNormals` (the hole filler's) turns a rim's normals to one plane, which on a curved face it rightly refuses to do, so the old normals stayed.
- Where: `app/js/emboss.js` (`earClip2D`, `smoothRimNormals`), `app/js/app.js` (`_fillHolesRun`: `smoothRimNormals` for op `marks`, `flattenRimNormals` for the hole filler as before).
- Test: `tests/emboss.test.mjs` (every cap triangle on the plate has an angle over 15 degrees, where the pocket's rim has corners on a straight run; smoothRimNormals turns the rim of the flat plate to straight up). On `geom_024` in Node (6 marks, 252 cap triangles): the caps with no area are gone (the thinnest was 0.0 degrees, now 0.1) and the slivers under 5 degrees fell from 98 to 27; every cap meets the flat face next to it at 0 degrees. On the housing (528 caps on a curved face) the slivers fell from 211 to 79 and the worst crease between a cap and its neighbour from 96 to 71 degrees: the thin triangles that remain are forced by short runs of the rim (a letter's rounded corner, sampled every few hundredths of a millimetre, must be the side of some triangle), and they do no harm to the shading, which uses the smoothed vertex normals, or to the outline, which leaves out an edge the mesh shades as smooth. In the wire view the caps show as the triangles they are. Not yet pressed in the browser.

## Found, not fixed yet

![fix][fix] **A closed body with a face painted in a second colour now arrives as two open pieces, one a colour.** The colours are right, but each piece has an open rim along the colour seam, so Close open edges and Check model see open edges that are not holes in the part.
- Where: `app/step2glb.py` (`_split_by_face_color`). A fix keeps the body whole with one primitive a colour sharing its vertices, which the app's loading would also have to keep as one part. Found in a review of today's changes.

![fix][fix] **Copies of a part coloured apart (a SHUO, or a colour on a component) each carry their own copy of the mesh in the GLB.** An assembly with many differently coloured copies of one bolt loses most of what instancing saves.
- Where: `app/step2glb.py` (`coloured_variant`, and the writer, which makes a mesh per product). Found in a review of today's changes; no sample file has many such copies yet.
