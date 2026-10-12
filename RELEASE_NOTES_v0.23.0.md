# MeshOptimiser v0.23.0

Back to the mesh itself: you decide how a CAD file becomes triangles when it is opened, Fill holes is now Remove holes and closes far more, three tools clean up what is left, and the search looks through Settings.

## New

**Tessellation settings on import.** The import window for STEP, IGES and BREP has a Tessellation block: the sag (how far a triangle may stand off the surface, in mm), the angle a curve may turn per triangle, and the smallest edge allowed. The four presets set the first two, and your own numbers select Custom. **By part size** gives small, medium and large parts a sag and an angle each, so the housing comes in fine and the screws coarse. On the command line: `--tiers`, `--min-edge`, `--angular`.

**Smooth shading from the CAD surfaces.** The converter writes the normals of the real surfaces into the GLB. A fillet runs into the faces beside it without a seam, and sharp edges stay sharp. On by default (`--no-normals` switches it off). **Swap Y and Z** stands up a file that comes in lying on its side (`--swap-yz`).

**Remove holes** is the new name of Fill holes (panel, toolbar, search, Help and the knowledge base). It also takes out the loose walls a broken file leaves floating where a hole was, closes an opening into a hollow space flush from outside, and removes the ring of vertices a closed hole used to leave in its face. **Surface may move** lets it tidy a gently curved panel within a distance you set.

**Remove floating pieces.** Deletes the small loose pieces of a part that touch nothing: plugs, shavings, dots of a thread. A size limit (5 mm by default), an optional triangle limit, and the biggest piece of a part always stays. One undo step.

**Remesh.** Untriangulate and Triangulate in one panel, with a button on the bottom toolbar. Untriangulate joins flat triangles into polygons, with Even triangles, Flatten shading on flat faces, a Shading tolerance and Surface may move. Triangulate is the way back. `U` and `Shift+U` run them on the selection.

**Split by faces.** A new method cuts a mesh at its creases, by a Face angle (20° by default), and **Smallest part** gathers the pieces under a number of triangles into one part. Split itself was rewritten and runs in time linear in the triangles.

**A search that looks through Settings.** The rows of the Settings window are found by name (`#` in front lists settings only), and a switch that is found is drawn in its result and turned there. What is typed is read more loosely: words in any order, another word for the same thing ("remove" finds Delete), one slip of the finger, initials ("rh" finds Remove holes). A command that cannot run now is greyed out with the reason. **Settings › Search** is a new pane for all of it.

**Materials and Library pop out as floating windows.** Drag by the head, resize by any edge or corner, and have both open side by side. **Drag a material onto the view** to assign it to the selection, or to the part under the pointer; Shift-drag one material onto another to merge them.

**An arrow to a selection that is out of sight.** A faint arrow at the edge of the view points to it; a click frames it.

**Orbit around: Selection, Scene or Cursor** in Settings, with Invert orbit direction, Stop at the horizon and a Pan speed.

**A right-click menu on every number field:** Cut, Copy, Paste, Select all, Reset and quick edits of the number.

## Around the app

- Frame stops where the whole selection is in the picture, and no further. Dynamic place sets a part down by a box turned with the part, the same way every time.
- The shelves of the library are tabs. Hold the + in Materials for the presets, or click the arrow beside it.
- The material editor has the look of the newer panels, stays where you put it and scrolls; a double-click on a material card renames it.
- The quick ring shows icons only and takes about 40% less room.
- `Shift+C` opens the search, as well as `Ctrl+K`. New scene is `Alt+N`. Esc closes the Export, Import and Save-scene dialogs, and a tool's key closes its panel when it is open.
- Arrow keys in the tree: Up and Down move a row, Shift extends, Right and Left open and close a group, Home and End.
- A click anywhere on a switch row turns the switch. A right-click menu opens beside what was clicked; a tree row's opens at the pointer.
- Command panels have the label on the left and the number on the right. Sweep is opened from the search.
- Remove holes shows in the Tasks list while it runs. The Draw tool's readouts look like the gizmo's.
- A STEP conversion that fails because a Python package is missing names the package and the command that installs it.

## Fixed

- Remove holes no longer leaves the ring of vertices behind, no longer finds the same hole again and again, closes holes it used to leave (a sheet with one face wound the wrong way round, the far opening of a countersink), and no longer gives up on a whole face when two openings meet at one point.
- Tidy could delete a small piece whose hole had just been closed.
- The Drop small parts field in the import window could not be seen.
- A changed angle did not count as a changed setting, so a re-run with another `--angular` handed back the old file.
- The search, Settings and Keyboard shortcuts kept the keyboard after they were closed.
- The material editor went back above the dock every time; a popped-out window could not stand in front of it; menus and Settings opened behind floating windows.
- The centre handle of the scale gizmo jumped when it was pressed near the middle.
- The grid blurred after focusing on a tiny part, and faded away when pulling back.
- Centre pivot pressed a second time made the gizmo disappear.
- Shift+click in the tree starts from the row picked last.

## Known

- With *Close openings into hollow spaces* on, a bore deeper than the depth limit is sealed at its mouth and the rest of its wall stays inside the part as a loose piece.
- The size limit of Remove holes is read in the scene's units, so on a model in metres the default 12 means 12 m.
