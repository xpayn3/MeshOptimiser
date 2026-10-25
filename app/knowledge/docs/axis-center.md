# The pivot of a part: Centre pivot

Centre the pivot of a part, reset its rotation, move the pivot or the object to the origin, the selection or the view, align it, and reset the scale.

Every part has a pivot: its origin and the X, Y and Z axes the gizmo shows in **Local**. These commands move or turn the pivot, and the shape stays exactly where it is (the points are carried the opposite way). Each is one undo step that puts back exactly what was there.

## Centre pivot

Put the pivot in the middle of the part and reset its rotation to 0, 0, 0. It is **Centre pivot** in the search and in the right-click menu of a selection. A part whose pivot is already there is left alone: no change and no undo step.

## The Pivot card

Search for **Pivot…** to open the card. It works on the selected parts.

- **Pivot to**: The pivot goes to the world origin, the middle of the selection, the pivot of the part picked last, or the middle of the view. **Also reset its rotation** turns it as well.
- **Move object to**: The object moves so that its pivot lands on the world origin, the part picked last or the middle of the view. The shape keeps its place around the pivot.
- **Align pivot to**: Turn the pivot to the world (0, 0, 0), to its parent, or to the part’s own biggest flat faces. Curved shapes with no flat faces are left alone.
- **Reset Scale**: The scale goes back to 1, 1, 1 and is built into the mesh. The part looks the same. A mirrored part (a negative scale) is left alone.

## What to know

- Locked parts keep their pivot. Copies that share one mesh get a mesh of their own first.

Related: [move-rotate-scale](meshoptimiser://docs/move-rotate-scale), [parts-tree](meshoptimiser://docs/parts-tree), [exploded-view](meshoptimiser://docs/exploded-view)
