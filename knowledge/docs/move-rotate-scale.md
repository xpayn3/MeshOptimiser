# Move, rotate, scale and measure

Use the gizmo to move, turn and resize parts, drag a part over other surfaces with Dynamic place, type exact values in the transform card, and measure the distance between two points.

Select a part and a gizmo appears on it: a set of coloured handles. Red is the X axis, green is Y and blue is Z. Drag a handle to change the part along that axis.

- `E`: Move
- `R`: Rotate
- `T`: Scale
- `Q`: Hide the gizmo
- `D`: Dynamic place: drag the selected part over other surfaces
- `Shift`: Hold while dragging to snap to round steps

## Move a part

1. Select the part. To move several parts together, select them all, or group them first with `Ctrl + G`.
2. Press `E`.
3. Drag one of the arrows. A small read-out shows how far the part has moved.
4. Hold `Shift` while you drag to move in round steps sized to the model.

Rotate (`R`) and scale (`T`) work the same way. With `Shift` held, rotation snaps to 15° and scale to steps of 0.1.

## Choose the snap step

While you hold `Shift` and drag a handle, turn the mouse wheel to change the step. Wheel up gives a coarser step and wheel down a finer one. A move steps through 1, 2, 5, 10, 20, 50 and so on. A turn steps through 1°, 5°, 10°, 15°, 30°, 45° and 90°. A scale steps from 0.01 to 1. The part takes the new step at once, and the step is kept for your next drags.

While snap is on, a small green pill at the top of the viewport, beside the camera pill, shows the step, for example **Snap 10 mm** or **Snap 15°**.

## Type exact values

1. Click the transform panel button on the viewport’s tool strip, the fifth button from the top. The **Transform** card rises into place at the foot of the left sidebar, under the parts tree.
2. It has three columns, **Position**, **Rotation** and **Size**, with a row for X, Y and Z.
3. Click a number and type a value, or drag it sideways.
4. Press **Reset** to put position, rotation and size back.

Right-click a column heading to copy all three values or paste them onto another part. The units follow **Display units** under **Settings**, **Scene**.

## Dynamic place

Dynamic place moves a part by dragging it over the model, instead of by its handles. The part rests on whatever surface is under the pointer and turns to face it, as when you drag a part out of the [library](meshoptimiser://docs/library) onto a model. It is handy for putting a bolt on a plate or a bracket on a wall.

1. Select the part, or several parts.
2. Press `D`, or click the fourth button on the tool strip (an arrow pointing down at a dot). The **Dynamic place** card opens over the viewport. The gizmo is hidden, and a thin blue box appears round the selection to show which box is being set down.
3. Press on the selected part and drag. The part follows the pointer and rests on the surface under it. The underside of the box touches the surface and never sinks into it.
4. Let go to drop it there.
5. Press `Esc` or **Done** to close the card and get the gizmo back.

A press that is not on the selected part selects as usual, and a press with `Shift`, `Ctrl` or `Alt` held is left alone. If the view is exploded, put the parts back together first.

## What the options mean

- **Align to surface**: On to begin with. The part turns so that its top points away from the surface it rests on. Off: the part keeps the way it faces and only slides.
- **Land on the grid**: On to begin with. Where nothing is under the pointer, the part lands on the grid. Off: it stays where it last rested.
- **Top axis**: Which of the part’s own axes, X, Y or Z, counts as its top. It is the part’s axes as it stands when you first pick it up. Z is the default when Z is up.
- **Direction**: **+** or **−**: whether the top axis points away from the surface or into it. Choose **−** to put a part on upside down.
- **Gap**: How far the part floats above the surface, in millimetres. A negative number sinks it in.
- **Turn**: Turns the part about the surface it rests on. Type an angle, or press 0°, 90°, 180° or 270°.
- **Reset gap and turn**: Sets the gap and the turn back to 0.

While you hold a part, the mouse wheel turns it in steps of 15°, and the **Turn** box follows. Press `Esc` during a drag and the part goes back to where it was before the drag.

The whole drag is one undo step. Choosing a gizmo with `E`, `R` or `T` also ends Dynamic place and closes the card.

## Copy and duplicate

- `Ctrl + D`: Duplicate the selection
- `Ctrl + C`: Copy the selection
- `Ctrl + V`: Paste

## Lock a part

Right-click a part in the tree and choose **Lock**. A locked part cannot be moved, and delete skips it. Choose **Unlock** in the same menu to release it.

## Measure

1. Press `M`, or click the ruler on the bottom toolbar.
2. Click a point on the model. A dot follows the pointer to show where you will pick.
3. Click a second point. The distance appears between them.
4. Measure again, or press `M` or `Esc` to leave measure mode.

- Dragging still turns the view while you measure.
- While you measure, a yellow **Measure** pill sits at the top of the viewport. Click it to leave measure mode.
- Measurements stay on screen after you leave measure mode, and are listed in the card **Measurements** in the right sidebar. Click a row there to pick that measurement: its line gets thicker and its label turns yellow.
- **Clear all** in that card removes them.

## Undo

Moves, turns and scalings are undo steps, whether you dragged the gizmo or typed a value.

> Moving a part with the gizmo changes where it sits, not its mesh. To write the change into the mesh itself, use **Bake gizmo transforms** in the card **Edit selection**. Most people never need to.

Related: [align-to-floor](meshoptimiser://docs/align-to-floor), [select-parts](meshoptimiser://docs/select-parts), [cleanup](meshoptimiser://docs/cleanup)
