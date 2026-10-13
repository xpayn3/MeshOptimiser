# MeshOptimiser v0.25.0

More to build with and a better way to line it up: 26 new library parts, an Align parts panel, a Transform panel that works on several parts, a tree search that forgives a typo, and a command search you can move.

## New

**26 new library parts, and two new shelves.** The library has 112 parts on eight shelves, up from 86 on six. Fasteners gain Flange bolt, Clevis pin, Wood screw and Thumb screw. Machine parts gain Thrust bearing, Flanged bearing, Roller bearing, Stepped shaft, Shaft coupler, Timing pulley (GT2) and Rail carriage. Profiles and plates gains Strut channel. The new Electronics shelf holds Axial fan, Heatsink, Pin header, Circuit board and Micro servo. The new Brackets and connectors shelf holds nine brackets and plates.

**Align parts.** Find it in the search as *Align and spread parts…*, or in the Quick wand. Align or spread along X, Y and Z, to the selection, the last part picked or the origin, with an optional fixed gap. One undo step each press; locked parts stay.

**The Transform panel works on several parts.** A field shows the number when every selected part has it, and *mixed* when they differ. A number typed in goes to each part on its own, about its own origin. One undo step.

**Move the search.** Hold the search icon and drag; drag the right edge to change the width; double-click the icon to put it back. The place is remembered.

**The part tree's search reads more.** Several words in any order, `"two words"`, a comma for or, `-word` to leave one out, `>5000` and `<200` for triangles, `is:hidden`, `is:visible`, `is:selected`, and a forgiving second try for a typo.

**Bake geo.** Turns a library shape into an ordinary mesh. Ctrl+Z gives the parameters back.

**Edit mesh tools in a bar.** A vertical icon bar at the right of the view replaces the card: Click, Box and Brush, the gizmo axes, Loops, Planarize, Straighten, Weld, Fill, Reverse normals, Dissolve and Extract. The icons are one calm colour, and the tool you are using is lit. Box pick follows the box while you drag.

## Fixes

Frame selected from an orthographic camera, wireframe lines showing through a thin part, Edit mesh edges that vanished close to the camera, Quick remesh ruining a small part, and a smoother drag on heavy shapes.

Full details are in the CHANGELOG.
