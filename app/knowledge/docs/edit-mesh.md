# Edit mesh: points, edges and polygons

Pick and change the pieces a part is made of: its points, edges and polygons. Move, delete, dissolve, planarize, straighten, weld, fill and extract them, from a bar at the right of the view.

Until now a click in the 3D view picked a whole part. Edit mesh lets you into the part. You pick its points, its edges or its polygons, and you can move them, take them out, join them or close a hole. If you have used Cinema 4D, it works the same way.

A mesh is made of three kinds of piece. A **point** is a corner (the glossary calls it a vertex). An **edge** is the line between two points. A **polygon** is a flat face. Two triangles that together make a four-sided shape count as one polygon, as a cell of a grid or a strip of a tube wall does. A triangle with no such partner is a polygon of its own. See [Words you will meet](meshoptimiser://docs/glossary).

## Go in and out

The mode button is at the top of the tool strip on the left edge of the view. It offers four modes: **Points**, **Edges**, **Polygons** and **Model**. **Model** is the app as it always was: a click picks a part.

- `1`: Points
- `2`: Edges
- `3`: Polygons
- `4`: Model: leave Edit mesh
- `Enter`: Go in with a part selected, and out again

- Click the button once to go into the last piece mode you used, or back out again.
- With a part selected, **Enter** does the same: it goes into the last piece mode you used, and **Enter** again goes back to **Model**. A command card that is waiting for its **Enter** gets it first, and with nothing selected it does nothing.
- Hold the button to see the list of all four.
- While Edit mesh is on, three more buttons appear under the mode button: **Points**, **Edges** and **Polygons**. The lit one is the kind of piece you are picking, and a click on another switches to it. The mode button itself shows the Model icon then, and a click on it goes back to Model.
- The view modes (solid, wireframe, X-ray, heatmap) that these keys used to switch are now on `Alt + 1` to `Alt + 4`. See [View modes](meshoptimiser://docs/view-modes).

> Select the part or parts first. In a piece mode only the selected parts show their mesh lines, and only they can be picked.

> A shape from the [library](meshoptimiser://docs/library) that still has **Shape parameters** is not edited in place, because its parameters would build it again. When you go into a piece mode with one selected, the app says **Bake geo first**. Press **Bake geo** under the shape’s parameters in **Properties** to turn it into an ordinary mesh, then pick its pieces.

## What you see

- The selected parts show their mesh lines in blue, as polygons rather than triangles.
- The pieces you have picked are orange. The one under the pointer is light.
- In Points mode every point of the part is shown.

## Pick pieces

The Edit mesh tools are a bar at the right edge of the view, under the view cube. It replaces the card that earlier versions had. At the top of the bar are three tools that decide how the left mouse button picks. With all three, `Shift` adds to what is picked and `Ctrl` takes away from it.

- **Click**: One piece at a time. A click beside the model clears the pick. A double-click picks a loop. With Click, a point is taken only when the pointer is within 16 pixels of it, and an edge within 12 pixels.
- **Box**: Drag a rectangle. What lies in it whole, and can be seen, is picked. The pick is live: it follows the box while you drag, and pieces the box lets go of are let go. The gizmo is put away during the drag. The history gets one entry when you let go. If you change tool, or the pointer is lost, in the middle of a drag, the box is cancelled and what you had picked comes back.
- **Brush**: Paint over the model. What the brush passes over is picked. Hold the middle button and drag to change the size of the brush, or type it in the bar.

With Box and Brush, `Alt` and drag turns the view. **Loops** in the bar does what a double-click does for every click, and lights the loop under the pointer before you click.

A loop of polygons runs across four-sided polygons like a ring round a tube. Where the polygons are not four-sided, the loop is the whole face. A loop of edges is the outline of a face when the edge is sharp or open, and the row of edges when it is smooth.

- `Ctrl + A`: Pick everything of the selected parts
- `Ctrl + Z`: Take back the last change of what is picked

## Move, turn and scale

The gizmo sits in the middle of what is picked. `E` moves, `R` turns and `T` scales, and `Shift` snaps, as for a whole part (see [Move, rotate, scale](meshoptimiser://docs/move-rotate-scale)). It moves the points the pieces stand on, so everything that uses those points follows.

The bar also sets the gizmo’s axes: **World**, **Local** or **Normal**. With **Normal** the gizmo’s Z points along the average normal of the picked pieces, so a polygon can be pulled straight out of itself.

Letting go of the gizmo is one undo step, and the pieces stay picked. Clicking a handle without dragging adds nothing to the history. In the wireframe view the part keeps one set of lines while its pieces are worked on, and they follow the move.

## Delete and reverse

- `Del` takes the picked pieces out. A point or an edge takes every polygon that uses it. A part is never emptied this way. The polygons of what stays are kept.
- **Reverse normals** turns the picked polygons round, so their front becomes their back. Use it for faces that came in the wrong way, which look dark or see-through from one side.

## The tools that change the mesh

Each one is a button in the bar, below the gizmo’s axes, and each is one undo step. A button works on one kind of piece and is dimmed when something else is picked.

- **Dissolve**: With `Ctrl + Backspace`. Picked points are taken out and the surface closes over them. For picked edges and polygons the polygons become one, and the points left inside them, or on a straight line of their outline, go. The shape does not change there.
- **Planarize**: For polygons. Moves the points of each picked polygon onto its best-fit plane. A polygon that would have to bend a long way, such as a curved face, is left as it is.
- **Straighten**: For edges. Moves the points along a picked line of edges onto the straight line between its two ends.
- **Weld**: For points and edges. Opens a small card of its own, with **Join within** and a **Weld** button. Picked points become one, at their middle. With a distance in **Join within**, the points that are that close to each other become one each. With 0, all the picked points become one. Picked edges collapse to a point. Triangles that are left with two corners in one place go.
- **Fill**: For edges. Closes a hole whose whole rim is picked. A double-click on an open edge picks the whole loop. The cap has points of its own, so it shades on its own.
- **Close**: Close open edges. With nothing picked it caps every rim where the surface stops, on the selected parts, which is Fill for all the open rims at once: for a part that is missing faces, open bores or a side that was never exported, that should be watertight. A rim that folds over, or that meets another rim at a point, is left, and the message says how many. With one rim picked (edges; a double-click picks the loop) it caps that rim. With two rims picked it closes the gap between them with a strip of triangles from one to the other: the ring floor between the two rims of a counterbore, the wall between its floor and its mouth, the missing length of a tube. The two rims need not be the same size or have the same number of points. It is also in the search as **Close open edges**, from Model mode too. One undo step.
- **Extract**: For polygons. Takes the picked polygons out into a part of their own, in the same place and with the same material.
- **Reverse normals**: For polygons. Described above.

## Key tips

While Edit mesh is on, the faint list of tips at the bottom right of the view shows what the mouse and keys do right now. It follows the tool you hold and what is picked. With nothing picked it tells you how to pick, and that `Ctrl + A` picks all and `Esc` goes back to Model. With something picked it adds `Del` to delete, `Ctrl + Backspace` to dissolve and `Esc` to let go.

## Good to know

- The quads and n-gons of an OBJ or FBX file are remembered after the file is read, so the polygons of the file are known afterwards.
- [Quick remesh](meshoptimiser://docs/remesh) does not run while Edit mesh is on. Go back to Model first.
- Leaving Edit mesh in the middle of a drag finishes the move as one undo step.
- Everything here is one undo step. After an undo, or a redo of a move, the pieces are picked again; a delete that is done again picks nothing, because what it picked is gone. See [Undo and redo](meshoptimiser://docs/undo-redo).

Related: [move-rotate-scale](meshoptimiser://docs/move-rotate-scale), [view-modes](meshoptimiser://docs/view-modes), [remesh](meshoptimiser://docs/remesh), [fill-holes](meshoptimiser://docs/fill-holes), [library](meshoptimiser://docs/library), [undo-redo](meshoptimiser://docs/undo-redo), [shortcuts](meshoptimiser://docs/shortcuts)
