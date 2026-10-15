# MeshOptimiser v0.31.1

Enter goes into Edit mesh and out of it, Edit mesh and Undo / Redo work together, and the viewport no longer stalls after editing.

## New

**Enter goes into Edit mesh and out of it.** With a part selected, Enter opens Edit mesh in the mode you used last (points, edges or polygons); Enter again goes back to Model mode. A command card that is waiting for its Enter still gets it first, and with nothing selected Enter does nothing.

**The colour picker can be moved.** Drag the strip along its top, or the hint along its bottom, to put it where it does not cover what you are colouring. It stays there while it is open.

## Around the app

**Heavy parts keeps its own ticks.** A row is ticked by clicking it there, which also selects the part. Selecting a part in the view no longer ticks it in the list, and the list no longer scrolls to follow a selection made in the view.

**The log console covers the toolbar at the bottom of the view** instead of sitting under it.

A few small things: the buttons at the foot of the Claude connection menu fit inside it, the icon-only buttons in the top bar draw at one size, the start screen cards show their shortcut when you point at them, and the search and filter boxes no longer show a tooltip.

## Fixed

- **The viewport stalled after editing.** The graphics card refused every frame for a mesh that had no normals, while the rest of the app went on working. Every shape that goes to the card now has its normals, and the app listens for the card's own error events: it gives a lit mesh the normals it needs, then uploads the parts again, and only then asks you to reload.
- **Redo left nothing picked in Edit mesh.** What was picked is picked again after Ctrl+Z and Ctrl+Y of a move, where the part still has the same triangles and polygons.
- **Materials disagreed with each other.** The Materials list, the card in Properties, the inspector and the colour dots in the part tree now follow a change at once, whether it came from a drop, Assign, the editor, a preset, a merge or Undo. The dot in the tree is the colour of the material the part wears, not a copy kept on the part.
- **Heavy parts replayed its bars at every edit.** The bars now grow only when the list first appears.
