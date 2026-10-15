# MeshOptimiser v0.29.0

Work with big assemblies: groups align and copy as one piece, and the whole workspace looks and moves like a finished app.

## New

**Align and Spread work on groups.** A selected group is one item, measured by the box round all its parts, and it moves whole. A group inside another selected group goes with it, and loose parts can be lined up beside groups.

**Copy several groups at once.** Each selected group is copied as a whole folder next to its original, with its own pivot, turn and scale, and one Undo for each.

**Copy, duplicate and paste in the materials window.** Ctrl+C, Ctrl+D and Ctrl+V work on the picked material when that window was the last one you worked in; the inspector has Duplicate and Delete.

**A macOS feel.** A layered shadow on the window in front, windows and dialogs that spring open, menus that fade out, and a minimize when a floating Materials or Library window closes. Select is the blue tool and the gizmo tools are grey; Dynamic place sits beside Measure and Draw lines; the Shading angle lives in the Shading section.

## Around the app

A tighter quick colour wheel that clears the view while it is open and picks without scanning every part. Edges and icon lines on whole device pixels. Heavy parts has better bars, and rows selected together join into one shape. A part in the Library view keeps turning a little after you let go.

## Fixed

Pivots of copied groups, and of groups moved together, stay where they belong. Undo no longer leaves a ghost copy that comes back on the next click. A copied shape keeps its parameters. The name row of the Properties card no longer changes height. The material in the sidebar follows a colour pick. The gizmo is put away while Quick remesh picks a level. A second click on Collapse, Rename or Flatten closes its menu.
