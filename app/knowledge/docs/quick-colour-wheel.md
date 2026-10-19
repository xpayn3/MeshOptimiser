# Quick colour wheel: colour a part without a dialog

Hold a key, move, click. The selected parts take the colour as you go.

Select one or more parts, point at the model, and hold `C`. A colour wheel opens at your pointer, placed so that the colour the part has now lies under it. Nothing changes until the pointer moves.

- **The angle**: Is the hue: the colour itself, red to yellow to green to blue and round.
- **The distance from the middle**: Is the saturation: the middle is white, and the rim is the full colour.
- **The scroll wheel**: Sets the brightness. The percentage shows under the wheel.

The selected parts change as you move, so you see the result on the model and not on a swatch. A small strip under the wheel shows the colour it was, the colour it is now, its hex code and the brightness.

While the wheel is open the pointer is hidden over it, and a dot shows where the colour is. The selection outline and the move gizmo are put away so that they do not cover the colour, and they come back when the wheel closes. Inside the middle hole the dot stays on the edge of the hole, on the side the pointer is.

## Keep it or cancel it

- Click to keep the colour. It is one step in the undo list.
- Let go of `C` or press `Esc` to put the old colour back.
- A press of the right or the middle mouse button puts the old colour back too.

> The wheel changes the material of the selected parts. If a material is shared with parts you did not select, they change colour too, as they always do when a shared material is edited.

The key works over the view. It does not work while you are typing in a field or while a window is open. If nothing is selected, the app asks you to select a part first.

Related: [colours-materials](meshoptimiser://docs/colours-materials), [undo-redo](meshoptimiser://docs/undo-redo)
