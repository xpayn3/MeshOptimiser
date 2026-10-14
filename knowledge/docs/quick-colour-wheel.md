# Quick colour wheel: colour a part without a dialog

Hold a key, move, let go. The selected parts take the colour as you go.

Select one or more parts, point at the model, and hold `C`. A colour wheel opens at your pointer. Nothing changes until the pointer moves.

- **The angle**: Is the hue: the colour itself, red to yellow to green to blue and round.
- **The distance from the middle**: Is the saturation: the middle is white, and the rim is the full colour.
- **The scroll wheel**: Sets the brightness. The percentage shows under the wheel.

The selected parts change as you move, so you see the result on the model and not on a swatch. A small strip under the wheel shows the colour it was, the colour it is now, its hex code and the brightness.

## Keep it or cancel it

- Let go of `C`, or click, to keep the colour. It is one step in the undo list.
- Press `Esc` to put the old colour back.
- Or move the pointer far outside the wheel. The dot jumps to your pointer, turns black, and a **Cancel** pill appears. Let go there and the old colour comes back.

> The wheel changes the material of the selected parts. If a material is shared with parts you did not select, they change colour too, as they always do when a shared material is edited.

The key works over the view. It does not work while you are typing in a field or while a window is open. If nothing is selected, the app asks you to select a part first.

Related: [colours-materials](meshoptimiser://docs/colours-materials), [undo-redo](meshoptimiser://docs/undo-redo)
