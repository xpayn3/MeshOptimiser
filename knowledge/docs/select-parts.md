# Select parts

Click, add with Shift, toggle with Ctrl, drag a box, or let the app select by shape, colour or name.

Most tools work on the parts you have selected. A selected part gets an outline in the viewport and its row is highlighted in the parts tree.

## In the viewport

- `Click`: Select one part. The tree scrolls to its row.
- `Shift + Click`: Add a part to the selection
- `Ctrl + Click`: Add a part, or take it out if it was selected
- `Ctrl + Drag`: Box select: draw a rectangle around parts
- `Ctrl + Shift + Drag`: Box select and add to what is already selected
- `Esc`: Select nothing. A click on empty space does the same.

## Click, Box or Brush

The selection-tool button in the left toolbar chooses what a drag does. Press it and let go over a row of its list to pick that tool, or let go on the button and click a row. With **Edit mesh** on, the same button picks pieces of a mesh instead of whole parts.

- **Click**: The usual way: click a part.
- **Box**: A plain left drag draws a rectangle. A part is picked only when one of its own triangles is under the rectangle, not when its bounding box is.
- **Brush**: A left drag paints: every part under the circle is picked. Hold `Shift` to add to what is picked; without it, every stroke starts from nothing. Drag with the middle button to change the size of the circle: to the right is bigger, to the left smaller.

In every tool, `Alt` + drag turns the camera.

## In the parts tree

- `Click`: Select one part. Click a group to select every part inside it.
- `Ctrl + Click`: Add or remove one row
- `Shift + Click`: Select every row between the last one you clicked and this one

## Let the app select

The card **Selection & actions** in the right sidebar has buttons for the common cases:

- **All**: Selects every visible part. `Ctrl + A`.
- **Invert**: Selects what was not selected, and the other way round. `Ctrl + I`.
- **Clear**: Selects nothing. `Esc`.
- **Select similar**: Adds every part that has the same shape as the selection. Select one bolt, press it, and all the bolts like it are selected.
- **By colour**: Selects every part that shares a colour with the selection.
- **By name**: Asks for a pattern and selects every part whose name matches it. Typing `screw` selects every part with screw in its name, in capitals or not. The pattern is a regular expression, a compact way to describe text, so some characters such as `.` and `*` have a special meaning.

Two tools select for you in a cleverer way: [Select hidden parts](meshoptimiser://docs/select-hidden-parts) and the size threshold of [Delete small parts](meshoptimiser://docs/delete-small-parts).

## Find what you selected

- Press `Shift + S` to scroll the tree to the selected part and open the groups it is in.
- Press `F` to frame the selection in the viewport.
- The status bar shows how many parts are selected. Click that number to frame them.
- When none of the selection is in the picture, a faint arrow at the edge of the view points to the side it is on. Click the arrow to frame the selection. See [Move the view](meshoptimiser://docs/move-the-view).
- **Properties** shows the triangle count of the selection and its share of the scene.

## The right-click menu

Right-click a part, in the viewport or in the tree, for a menu of things to do with the selection: frame it, isolate it, select similar parts, copy, duplicate or delete.

> A common mistake: dragging without `Ctrl` turns the view instead of drawing a selection box. Hold `Ctrl` first, then drag.

Related: [hide-isolate](meshoptimiser://docs/hide-isolate), [parts-tree](meshoptimiser://docs/parts-tree), [search-and-commands](meshoptimiser://docs/search-and-commands)
