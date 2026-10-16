# The axis of a part: Axis Center

Centre the axis of a part, reset its rotation, move the axis or the object to the origin, the selection or the view, align it, and reset the scale, as in Cinema 4D.

Every part has an axis: the origin and the X, Y and Z the gizmo shows in **Local** axes. These commands move or turn the axis, and the shape stays exactly where it is (the points are carried the opposite way). Each is one undo step that puts back exactly what was there.

## Axis Center

Put the axis in the middle of the part and reset its rotation to 0, 0, 0. It is in the search as **Axis Center** and is the **Centre pivot** button of the parts tree toolbar. A part whose axis is already there is left alone: no change and no undo step.

## The Axis card

Search for **Axis…** to open the card. It works on the selected parts.

- **Center axis to**: The axis goes to the world origin, the middle of the selection, the axis of the part picked last, or the middle of the view. **Also reset its rotation** turns it as well.
- **Center object to**: The object moves so that its axis lands on the world origin, the part picked last or the middle of the view. The shape keeps its place around the axis.
- **Align axis to**: Turn the axis to the world (0, 0, 0), to its parent, or to the part’s own biggest flat faces. Curved shapes with no flat faces are left alone.
- **Reset Scale**: The scale goes back to 1, 1, 1 and is built into the mesh. The part looks the same. A mirrored part (a negative scale) is left alone.

## What to know

- Locked parts keep their axis. Copies that share one mesh get a mesh of their own first.

Related: [move-rotate-scale](meshoptimiser://docs/move-rotate-scale), [parts-tree](meshoptimiser://docs/parts-tree), [exploded-view](meshoptimiser://docs/exploded-view)
