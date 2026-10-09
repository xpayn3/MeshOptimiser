# MeshOptimiser v0.15.0

The commands come to the pointer. A Quick wand ring opens under the pointer when you hold W, four new tools clean a model up and make it lighter, Untriangulate takes out the triangles that only cut a flat face up, the Wireframe view shows polygons, the simplifier looks after normals, UVs and colours, and Dynamic place gets a scale handle.

## New

**Quick wand (hold W).** Hold W over the viewport and a ring opens around the pointer. Move toward a slice and let go of W to run it. Only the direction counts, not the distance, so a short flick is enough; the middle of the ring (or Esc) does nothing. It works on the selection when there is one and on the whole scene when there is not. The slices are always in the same places, so the hand learns them, and Delete is red.

- **With a selection** the ring has four slices: Hide, Reduce, Delete and More. Reduce fans out Decimate −50 %, −25 %, −75 % and −90 % (each shows the triangle count before and after), Smart fit, Split and Fill holes. More fans out Isolate (Show all while the view is isolated), Select similar, Select same colour, Group, Duplicate, Merge, Frame, Hide others and Show all.
- **With nothing selected** it has six: Fit view, Select all, View (Camera, Top, Front and Side views, Solid, Wireframe and X-ray, the ground grid), Show all, File (Save screenshot, Save scene, Revert to source file) and Clean (Recentre on origin, Align to the floor, Smart fit all parts, Remove empty parts, Deduplicate geometry, Fix degenerate parts).
- **A slice that holds a group opens its fan as soon as the pointer is on it.** Move out onto a command and let go. The ring remembers which group you were heading for, so going straight to a command does not turn into another slice on the way. Commands show their shortcut, and one that cannot run right now stays on the ring, dimmed, with the reason.
- **A quick tap of W leaves the ring open:** click a slice or a command to run it, W or Esc to close. It is also in the command palette (Ctrl+K) as Quick wand.
- **It cannot act by accident.** Esc, any other key, the scroll wheel, a click outside, a window that loses focus, a hidden tab and a resize all close it without running anything. It does not open while a mouse button is down, in a text field, behind a dialog or outside the viewport, and it keeps the right-click menu from opening on top of it.

**Repair mesh.** Joins doubled vertices, removes empty and doubled triangles, turns faces so that neighbours agree on which side is out, and can work the shading out again with a smoothing angle. It works on the selected parts or the whole scene, leaves a part that is already sound as it is, keeps UV seams and materials, and reports what it did. One Ctrl+Z takes it back.

**Remove hidden faces.** The polygon-level partner of Select hidden parts: each part is looked at from many sides (Fast, Normal or Thorough), and the faces that never show are deleted: the inside of a housing, the faces where two parts press together. A face next to a visible one stays, so no holes open in the surface. Can be undone.

**Merge by material or by group.** Joins parts into one mesh per material, or one per group. A merged mesh keeps its material. A whole run is one step to undo.

**Select by rule.** Rules on a part's name, material, group, triangles, size as a share of the model, and whether it is shown, flagged, instanced or selected. Match all rules or any, and replace, add to, remove from or narrow the selection; the card says how many parts fit as you type.

**Dynamic place has a scale handle.** A small solid cube floats on the middle of the selected part's top face. Drag it up and the part grows, down and it shrinks, evenly in all three directions (Shift: steps of 5 %). The part is scaled about the middle of its underside, so one resting on a surface stays on it, and a see-through ghost of the part at its old size stays behind while you drag. One Ctrl+Z takes the whole drag back, and Esc cancels it.

## Wireframe and Untriangulate

**Untriangulate.** Cinema 4D's command of the same name, in Reduce triangles and in the command palette. Neighbouring triangles that lie in one plane become one polygon, the vertices that touch only that polygon are removed, and the polygon is triangulated again from its outline with the fewest triangles, so a flat plate cut into a grid of 200 triangles becomes 38. The shape does not change at all. A polygon is only rebuilt when it is flat, its normals agree with its plane, every vertex on its outline is kept (so no crack opens) and the area adds up; anything else is left as it was and counted in the message. Strict, Normal and Loose set how flat neighbouring triangles must be to join. It is one step to undo. The file formats and the graphics card still use triangles: this removes the ones that only cut a flat face up, it does not give OBJ or FBX real n-gon faces.

**Wireframe is the surfaces with a thin black line on every edge.** Like Gouraud Shading (Lines) in Cinema 4D. Before, it drew the surfaces themselves as lines in their own colours, see-through, so an assembly turned into coloured thread. Now the colours, lighting and opacity of the Solid view stay, and a thin black line follows every edge on top. Settings › Viewport › Wireframe chooses the lines: Triangles (every edge of the mesh), Polygons (the outline of each flat polygon, curved faces included) or Outline (only the sharp edges and borders), and Flat within sets how flat neighbouring triangles must be to count as one polygon.

## Decimate and Fit to budget

**Normals, UVs and vertex colours now steer which triangles are removed.** Before, only positions counted, so a crease, a UV seam or a colour edge could be flattened as readily as a smooth patch. Now the simplifier weighs them in first and falls back to the old position-only pass only when that does not reach the target.

**The report shows how far the surfaces moved.** It shows as "Surface deviation (est.)" in the Optimisation report and in the toast after a run, in the unit the scene is shown in. Undo and redo take it back with the step. It is an estimate, not a measured distance: on a test sphere it came out about a third under what was measured, so read it as a floor, not a limit.

## Interface

- The sidebar drag handles sit on the status-bar row, so nothing over the viewport or a sidebar is caught by accident.
- The buttons above the tree are cards, with the same fill as the cards in the right sidebar.
- The four new tool buttons are not on the bottom toolbar: Repair mesh, Remove hidden faces, Merge by material or by group and Select by rule are opened from the command palette.
- The animations at the top of the Help cards are redrawn so that they match: one lighting, one grey material, and the accent blue for what is selected.

## Upgrading

Nothing to do. Scenes saved by v0.14.0 open as before. The Wireframe view looks different (see above); Settings › Viewport › Wireframe changes the lines.
