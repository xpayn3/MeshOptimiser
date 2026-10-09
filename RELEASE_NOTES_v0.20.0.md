# MeshOptimiser v0.20.0

Draw lines and shapes, sweep along them, and keep them in the tree like any other part. The tree gets organising commands, the converter reads IGES and BREP, copies are found in files from other tools, and the app looks after itself: it closes its server with the window, handles a crash and tells you when the graphics card is not in use.

## New

**Draw lines and shapes (L).** Pen, Rectangle, Circle, Arc, Polygon, Freehand and Edit. Pick Bezier, Cubic, B-spline or Linear for the curve, and a work plane: ground, front, side, view, or the face of a part. A field of dots follows the grid near the pointer, and a click a few pixels off still lands on a dot; points snap to other points, Shift snaps the angle in 15° steps. A rectangle, circle or polygon is placed with two clicks and can be typed in (`20 x 10`, Enter); the arrow keys change corners and sides. In Edit you drag points and handles, click a curve to add a point, double-click a point to make it smooth or sharp, and the line follows live. Bezier handles snap to the grid, and Ctrl-drag breaks one from its partner.

**Round and Bevel corners.** A rectangle or polygon that is still a shape shows a ring on its first corner in the Edit tool: drag it to round or cut every corner at once, and click Round or Bevel beside it.

**Lines are parts.** A line is a row in the tree: rename, hide, delete, undo, drag it, put it in a group, nest groups. The gizmo moves, turns and scales it. GLB and glTF files with lines open them as lines, and lines go back out into GLB, glTF and saved scenes.

**Properties of a line.** A Shape card (width, height, radius, sides, star, inner radius, corner type and size) for a rectangle, circle, ellipse, polygon or star that is still a shape, and a Spline card as in Cinema 4D: Type, Close Spline, Interpolation (None, Natural, Uniform, Adaptive, Subdivided), Points, Angle and Maximum length.

**Sweep.** Pick a path and a profile (a circle, a rectangle or another line), set the scale at both ends, a twist, closed ends and a hard-edge angle: the result is a normal part.

**Organise the tree.** In a group's right-click menu: Remove group, keep contents (for all selected groups, one undo), Flatten this group, Sort inside A to Z and Z to A, Move group up and down, Delete empty groups, Expand and Collapse this branch. Ctrl toggles a row as a unit, Shift selects the range from the last clicked row, and groups and parts can be picked together.

**The converter reads more.** `step2glb.py` and the upload take `.iges`, `.igs`, `.brep` and `.brp` as well as STEP. `--batch DIR` converts a whole folder with a report, `--lod 100,50,25` writes `name.glb`, `name_lod1.glb`, `name_lod2.glb`, and each node carries the CAD file's own data in its `extras`.

**Lighter files, and promises you can check.** Copies are found in GLB, FBX, OBJ and 3MF files from other tools when they open (a 600-mesh test file goes from 2.72 MB to 186 KB; every vertex stays within 0.01 mm). Decimate can work "Within … mm" and the result is measured. The Export window can check the scene against the published guidance for a web page, a Shopify product page, Apple AR Quick Look or a phone app. Smart optimise keeps recipes, and Merge by colour is in the command list. Copy diagnostics makes a bug report with no file names in it.

**The app looks after itself.** The server exits about ten seconds after the last window closes (`--keep-running` turns it off) and the converters it started go with it; an unclean exit is noticed at the next start, with Reopen last file and Safe mode; a flood of errors and a lost graphics device get a panel; Settings › Performance has a Graphics row and the app warns at start when hardware acceleration is off.

## Fixed

- **Deduplicate geometry deleted real parts:** 400 placed copies of one bolt became one. It now removes a part only when an identical one sits in the same place.
- **Scan whole model froze the app** on a large model. It works in slices now, with progress and Cancel.
- **A leak in Split:** each split and undo left about 130 outline geometries on the graphics card.
- **The floor grid was cut off when zoomed in close.** It now starts at the camera.
- **A scene scale change stranded the view.** The camera, its clip planes and the grid follow the scale.
- **Shift lit up the button you had just clicked** (the Tab ring). It stays hidden while only a modifier is pressed.
- **A slip of the mouse ate the click in the tree.** Ctrl and Shift clicks never start a drag, and a press that lets go on its own row is a click.
- **The tree's guide lines** ended wrongly on the last row of a group.
- **Orbit around the selection and F (frame)** now include lines.

## Interface

- The Draw card is compact, with the tool's name in its title, and its keys are listed at the bottom right with the other shortcuts.
- Smart fit has a tidier layout, its Advanced section has a reset button next to its name, and the video on a card gets smaller while Advanced is open. The command cards have no description lines.
- Tooltips follow the pointer: once one is up, the next button's tip appears at once.
