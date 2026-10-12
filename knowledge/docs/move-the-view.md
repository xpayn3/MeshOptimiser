# Move the view

Orbit, pan and zoom with the mouse, frame a part with F, and switch between the camera, Top, Front and Side views.

Moving the view never changes the model. You are only moving the camera.

## With the mouse

- `Drag`: Orbit: turn the view around the model (left mouse button)
- `Middle drag`: Pan: slide the view sideways (press the wheel and drag)
- `Right drag`: Pan as well
- `Scroll`: Zoom in and out
- `Alt + Right drag`: Zoom smoothly: drag up to come closer

## Bring things into view

- `F`: Frame: fit the selected parts in the view, or the whole model when nothing is selected

If you get lost, click an empty spot to clear the selection and press `F`. The whole model comes back into view.

## Standard views

The pill at the top centre of the viewport names the current view. Click it to choose another.

- `Ctrl + 1`: Cam: the free camera with perspective
- `Ctrl + 2`: Top
- `Ctrl + 3`: Front
- `Ctrl + 4`: Side

Top, Front and Side are flat views without perspective, like a technical drawing. As soon as you orbit out of one, the app returns to the free camera from where you are.

## The view cube

The small cube in the top right corner turns with the model. Click one of its faces, or the dot at the end of an axis, to look straight along that axis: Top, Bottom, Front, Back, Side or Left. The view pill shows the name.

## The floor grid

The grid marks the floor of the scene. Press `G` to hide or show it.

## Settings that change how the view moves

Under **Settings**, **Camera**:

- **Projection**: Perspective, where far things look smaller, or Orthographic, where they do not.
- **Field of view**: How wide the lens is.
- **Clip planes**: How near and how far the camera can see. Leave it on Auto unless parts of a very small or very large model are cut off.
- **Orbit around the selection**: With something selected, the view turns around it. Off, or with nothing selected, it turns around the centre of the view.
- **Zoom toward the cursor**: The wheel zooms toward the pointer instead of the centre.

> On a heavy model, very small parts are left out while the view is moving and drawn again the moment it stops. This keeps movement smooth. You can turn it off under **Settings**, **Performance**, **Skip tiny parts**.

Related: [select-parts](meshoptimiser://docs/select-parts), [view-modes](meshoptimiser://docs/view-modes), [settings](meshoptimiser://docs/settings), [shortcuts](meshoptimiser://docs/shortcuts)
