# MeshOptimiser v0.24.0

Into the mesh: an Edit mesh mode with points, edges and polygons, a shortcuts window with a picture of the keyboard and keys you can change, and a faster start.

## New

**Edit mesh: points, edges and polygons.** A mode button at the top of the left toolbar: Points, Edges, Polygons and Model (`1` `2` `3` `4`). In a piece mode the selected parts show their mesh lines as polygons, and the left button picks pieces of them with Click, Box or Brush; a double-click or *Pick loops* picks a loop. `Ctrl+A` takes all.

**Move, turn, scale, delete and reverse the picked pieces.** The gizmo (`E`, `R`, `T`, Shift to snap) sits in the middle of what is picked. `Del` takes the pieces out, *Reverse normals* turns picked polygons round. Each is one undo step, and the pieces are picked again after an undo.

**Dissolve, Planarize, Straighten, Weld, Fill and Extract.** Dissolve (`Ctrl+Backspace`) takes points out and closes the surface over them. Planarize makes picked polygons flat. Straighten puts the points of a picked line of edges on the straight line between its ends. Weld makes picked points one. Fill closes a hole whose whole rim is picked. Extract takes picked polygons out into a part of their own.

**The shortcuts window shows the keyboard, and every key can be changed.** The keys that do something are lit and carry the command's name; holding Ctrl, Shift or Alt shows the keys of that combination. Click a shortcut in the list and press the new keys. A combination that is taken warns with the command that has it and offers Replace. Changes are kept in named profiles in the browser; Default is the app's own keys. The command search, the tooltips and the right-click menu show the changed keys.

**Quick remesh (`B`).** A column of keep-levels under the pointer with a live preview; let go, or press Enter, to take the level as one undo step.

**The gizmo's axes: World or Local.** Hold or right-click Move, Rotate or Scale on the toolbar. In Edit mesh the list also has Normal.

**Transform panel: a Scale switch, and groups scale.** The third column can be a scale factor, and a scale typed for a group of the tree scales its parts.

**Untriangulate: Points on straight lines, and Dissolve nearly flat within.** The first takes away the points that only sit on a straight line of a face's outline; the second is a limited dissolve for faces that are only nearly flat.

**Claude's screenshots can fill the picture.** Claude can frame a screenshot on the whole model or on the selected parts.

**The quads and n-gons of an OBJ or FBX file are remembered** after the loader splits them into triangles.

## Around the app

- `1` `2` `3` `4` pick the Edit mesh mode. The view modes these keys were (Solid, Wireframe, X-ray, Heatmap) are on `Alt+1` to `Alt+4`.
- Settings › Appearance uses the app's own colour picker, and the window steps aside while you drag so you see the colour on the real interface.
- A faster start: the browser keeps the app's files and only asks the server whether one changed.
- Wireframe, Quads: parts above 20,000 triangles are worked out in a worker and no longer freeze the page.

## Fixed

- Edit mesh: a press on the gizmo without a drag no longer puts an empty Move step in the history, and leaving the mode in the middle of a drag finishes the move as one undo step.
- Edit mesh: Delete keeps the polygons of what stays, and Reverse normals no longer grows the mesh.
- `Alt+1` to `Alt+4` work on a Mac.
- After a big change of scale the far plane, the near plane and the grid follow, and parts are no longer hidden as too small while the camera moves.
