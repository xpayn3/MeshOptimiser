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

Frame stops where everything it frames is in the picture, with a small margin. A long thin part seen from the side fills the width, and a small part in a big assembly fills the view.

If you get lost, click an empty spot to clear the selection and press `F`. The whole model comes back into view.

## The arrow to a selection out of sight

When something is selected and none of it is in the picture, a faint arrow sits at the edge of the view, on the side the selection is on. Click the arrow and the view frames the selection. To switch the arrow off, open **Settings**, **Viewport** and turn off **Arrow to a selection out of view**.

## Standard views

The small pill in the top left corner of the viewport shows the current view as an icon: a camera for the free camera, or a cube with the face looked at for Top, Front and Side. Click it to choose another.

- `Ctrl + 1`: Cam: the free camera with perspective
- `Ctrl + 2`: Top
- `Ctrl + 3`: Front
- `Ctrl + 4`: Side

Top, Front and Side are flat views without perspective, like a technical drawing. As soon as you orbit out of one, the app returns to the free camera from where you are.

## The view cube

The small cube in the top right corner turns with the model. Click one of its faces, or the dot at the end of an axis, to look straight along that axis: Top, Bottom, Front, Back, Side or Left. When the view is Top, Front or Side, the camera pill shows it.

## The floor grid

The grid marks the floor of the scene. Press `G` to hide or show it.

## Settings that change how the view moves

Under **Settings**, **Camera**:

- **Projection**: Perspective, where far things look smaller, or Orthographic, where they do not.
- **Field of view**: How wide the lens is.
- **Clip planes**: How near and how far the camera can see. Leave it on Auto unless parts of a very small or very large model are cut off.
- **Orbit around**: What the view turns around. **Selection**: the selected parts, or the centre of the view when nothing is selected. **Scene**: always the centre of the view. **Cursor**: the point under the pointer when the drag starts.
- **Zoom toward the cursor**: The wheel zooms toward the pointer instead of the centre.
- **Pan speed**: How far a pan drag moves the view. Orbit speed and Zoom speed are beside it.
- **Invert orbit direction**: The view turns the other way for a drag: drag right and the model turns left.
- **Stop at the horizon**: The camera cannot go below the grid, so you do not end up looking at the model from underneath by accident.

> On a heavy model, very small parts are left out while the view is moving and drawn again the moment it stops. This keeps movement smooth. You can turn it off under **Settings**, **Performance**, **Skip tiny parts**.

Related: [select-parts](meshoptimiser://docs/select-parts), [view-modes](meshoptimiser://docs/view-modes), [settings](meshoptimiser://docs/settings), [shortcuts](meshoptimiser://docs/shortcuts)
