# Quick wand

Hold Q and a ring of commands opens under the pointer. Flick toward one and let go.

The Quick wand puts the commands you use most under your hand, so you do not have to go to a button. Hold `Q` with the pointer over the viewport and a ring opens around the pointer. Move toward a slice and let go of `Q`. That runs it.

Only the direction counts, not the distance, so a short flick is enough. The slices are always in the same places, so after a while your hand knows where Hide is without looking.

## Hold, flick, let go

1. Put the pointer over the viewport and hold `W`. The ring opens around the pointer.
2. Move the pointer toward a slice. It lights up.
3. Let go of `W`. The command runs.

To change your mind, let go with the pointer in the middle of the ring, or press `Esc`. Nothing happens.

## With something selected

The ring works on the selection, and has six slices.

- **Isolate**: Shows only the selected parts. While the view is isolated, the slice reads Show all.
- **Hide**: Hides the selected parts.
- **Delete**: Deletes the selection. It is red, so it is hard to pick by mistake.
- **Reduce**: Opens a fan of commands: Decimate −50 %, −25 %, −75 % and −90 % (each shows how many triangles there are before and after), Smart fit, Split and Remove holes.
- **Select**: Opens a fan of commands: Select similar, Select same colour, Invert selection and Show in tree.
- **More**: Opens a fan of commands: Frame, Duplicate, Group, Merge, Centre pivot, Hide others and Show all (Show all is left out while the view is isolated).

## With nothing selected

The ring works on the whole scene, and has six slices.

- **Fit view**: Zooms to the whole model.
- **Select all**: Selects every part.
- **View**: Opens a fan of commands: Camera, Top, Front and Side views, Solid, Wireframe and X-ray, the ground grid and Show all.
- **Save screenshot**: Saves a picture of the view.
- **File**: Opens a fan of commands: Turntable video, Save scene and Revert to source file.
- **Clean**: Opens a fan of commands: Recentre on origin, Align to the floor, Align parts, Smart fit all parts, Remove empty parts, Deduplicate geometry and Fix degenerate parts.

## The fans

A slice that holds a group opens its fan as soon as the pointer is on it. Keep going outward onto a command and let go. You can head straight for a command: the ring remembers which group you were going for, so it does not turn into another slice on the way.

The ring shows icons only. In a fan, the command under the pointer shows its name and its shortcut in a small label beside it. A command that cannot run right now stays on the ring, dimmed, and says why: “Nothing is hidden”, “Select two or more parts” or “Too few triangles to take away”.

## Tap instead of hold

A quick tap of `W` leaves the ring open. Click a slice or a command to run it. Press `W` or `Esc` to close it. The same thing is in the command palette: press `Ctrl + K` and type “wand”.

## It will not act by accident

- Esc, any other key, the scroll wheel, a click outside the ring, a window that loses focus and a resize all close it without running anything.
- It does not open while a mouse button is down (when you are orbiting or dragging a gizmo), in a text field, behind a dialog, or when the pointer is not over the viewport.
- The right-click menu does not open on top of it.
- The ring stays inside the window, however close to the edge you are.

> What a command does is what it does anywhere else, and the same Undo takes it back.

Related: [hide-isolate](meshoptimiser://docs/hide-isolate), [select-parts](meshoptimiser://docs/select-parts), [search-and-commands](meshoptimiser://docs/search-and-commands), [shortcuts](meshoptimiser://docs/shortcuts)
