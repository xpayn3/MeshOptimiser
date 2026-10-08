# MeshOptimiser v0.14.0

The biggest release so far: a CAD view with a Shading card, Dynamic place, an Align to floor that shows what it will do, a Help window with the whole knowledge base inside the app, a Settings window that can change the look of the interface, a rebuilt Export window, three tools that clean up a scene for you, and a long list of fixes from reading the whole code base and testing it hard on a 1,583-part assembly. Opening a big model is faster too. The full list is in `CHANGELOG.md`.

## New

**A CAD view (key 6) and a Shading card.** No lights or reflections: every surface is shaded by which way it faces the camera, read from a small picture of a lit sphere, with a dark line on every sharp edge. Three looks: Ceramic, Light and Mono. The Shading card under Properties holds every look as a small 3D nut: Default, Clay, Porcelain, Steel and Red wax, and the three CAD looks. One Outlines switch draws the edge lines in every view.

**Dynamic place (key D).** Press the selected part and drag it over other surfaces: it rests on the surface under the cursor and turns to face it, like dragging a part out of a library onto a model. Align to surface, land on the grid, which side of the part points away from the surface, a gap, and a turn (the wheel turns it while held). One undo step.

**Align to floor shows what it will do.** A small 3D drawing of the floor, the origin and the model, with the point that goes to zero ringed and arrows for its top and front. Nothing moves until you press Align to floor. It is a floating card now.

**Help inside the app (F1).** The whole knowledge base of the website, with search, works offline.

**Settings can change the look.** An Appearance page with accent colours, four tones, fonts, text size, corners and density, an About page, camera speed, undo history size, a warning before leaving with unsaved changes, and a switch for the splash screen.

**A splash screen** while the app starts: the rear derailleur drawn as glowing 3D lines, then the app fades in part by part.

**Cards over the viewport can be moved,** and Stacked copies and Align to floor are cards of that kind now. Heavy parts are the parts over 10,000 triangles, with a count beside the title.

**Smart optimise.** One card, one button, at the top of Reduce. It runs every clean-up the app has, one after another, on the whole scene: empty and broken parts, parts hidden inside, bolts, nuts and washers, small parts, holes in flat faces, and (if you want) a triangle reduction to a target you set. Pick Light, Balanced or Strong, or leave it on Auto and it chooses from how heavy the scene is. Every step has its own switch. The whole run is one undo step.

**Fasteners.** One command finds the bolts, screws, nuts and washers of a scene and selects them, ready to isolate, simplify or delete. It goes by shape, not by name, so it works on exported assemblies whose parts are called `=>0_1_1_9_000009`. On the 1,583-part test assembly it finds 130 fasteners in two to three seconds and leaves bushings, bearings, O-rings and cable glands alone.

**Stacked copies.** Finds parts that sit on an identical copy of themselves, the kind that are drawn twice and flicker where they meet. It selects the extras and keeps one of each. Isolate to check them, Delete to remove them, Ctrl+Z to bring them back.

**Select similar, with a strictness slider.** "Similar shape" used to mean identical. A new card sets how close a part has to be, from 0 % (about the same size and weight) to 100 % (the very same shape). It starts at 60 %.

**The library is a drawer.** It slides up under the viewport like the materials (Shift + L), with a view of the part you can turn on every axis, its triangle count and size, and the same parameters as Shape parameters. What you set there is what you get when the part goes in. Favourites shelf, large or small tiles.

**Add a dropped file to the open scene.** Dropping a file on a scene that already has parts now asks: Add to this scene, or Open in new tab.

**Exploded view pill.** While the view is exploded, a pill beside the camera pill says so and puts the parts back with one click. Status pills (isolate, exploded, measure, snap) always sit just right of the camera pill, filled in their own colour.

**Measure.** Yellow button and a Measure pill while the mode is on. A click on a measurement in the card picks it and highlights it in the viewport.

**Heavy parts: tick and delete.** Tick the heavy parts you want gone and delete them in one step.

**Gizmo snap step.** Hold Shift while dragging a handle to snap, and turn the wheel to change the step. A Snap pill shows it.

**Right-click a tab.** Duplicate scene, Close all, Close others, Open and Open recent.

**A rebuilt start screen**, with a search of your recent files, tiles to start from, and a card for each recent file. Drop a file anywhere on the window.

## Export

The Export window is rebuilt: a file name with the same pills as Save scene, a summary of what will be written, Flatten groups, ASCII STL, only the options that apply to the format, and your choices remembered. Ctrl+E opens it.

Exports now open in Cinema 4D. All eight formats were exported from a 778-part, 793,550-triangle model and opened in Cinema 4D 2026.4.

- The binary FBX carries a file id, time and code that agree, so the FBX SDK (Cinema 4D, Maya) accepts it.
- An FBX states its units and which way is up. A 2.6 m machine no longer arrives 26 m long.
- The binary FBX shares its materials: 40 instead of 778, and 1.4 s to open instead of 13 s.
- OBJ keeps parts that share a name separate (778 parts arrived as 325 before).
- The Up axis choice says what it does: Keep as in the scene, or Turn Z-up into Y-up.

## Viewport and interface

- The view cube turns to the new view instead of jumping.
- The 2D views (Top, Front, Side) have their grid back.
- Less flicker between panels lying on each other: the near plane follows the model's nearest depth, which gives the depth buffer several times the resolution at normal distances.
- Orbiting out of a 2D view returns to the perspective camera.
- The material used by the selected part is lit in the materials drawer.
- The top bar slides with the sidebar when you fold it, and the fold button stays on the sidebar's edge at every width.
- Number fields are bigger and never cut off a number.
- Cards in the right sidebar slide open and shut.
- Undo goes back 200 steps (30 for operations that carry geometry).
- Delete small parts only looks at parts that are on show.
- Merge leaves the merged part where the first part was in the tree.
- The exploded view survives Smart fit, Merge and their undo.
- Smart fit no longer fits and moves neighbouring parts that merely share a shape.

## Security

- The local server answers only the app's own page. Before, any web page open in your browser could send requests to `localhost:4242`.
- Names and scene data from a file are never run as markup.

## Fixes worth knowing

- A fresh install converts STEP again (the OpenCascade package version is pinned).
- Hidden instanced parts no longer break Select all, and undo brings back deleted instanced parts.
- Files with invalid coordinates open; broken or empty files get a plain message.
- FBX files with leftover geometry open directly instead of going through the slower conversion.
- Split by proximity cannot freeze the tab on a plate or a box.
- A colour changed in the material editor is exported.
- Quit asks about every open scene, not only the one in front.
- Dozens of smaller fixes in dialogs, shortcuts, tooltips, keyboard use and the converter launchers. The full list is in `CHANGELOG.md`.

## Upgrading

Nothing to do. Scenes saved by v0.13.0 open as before. Two settings start differently: Show origin points is off, and Lower the resolution if it stutters is off. An FBX exported by an older version can be re-exported to open in Cinema 4D.

The three.js `FBXLoader.js` in `vendor/` carries a local patch (marked "MeshOptimiser patch") that has to be carried over when three.js is updated.
