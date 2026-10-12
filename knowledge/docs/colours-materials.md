# Colours and materials

Open the materials dock to see every material in the scene, recolour all the parts that share one, and assign materials to parts.

A material is what a surface looks like: its colour, and how rough or metallic it is. Parts share materials. A CAD file with fifty grey brackets usually has one grey material that all fifty use. Change that material and all fifty change.

## Open the materials dock

Press `Shift + M`, or click the palette button on the bottom toolbar. The dock slides up from the bottom of the window and shows every material as a small ball, with the number of parts that use it.

## Find a material

- Type in **Filter…** to filter by name, by colour (as a hex code such as `#ff6600`) or by type.
- Choose the order: **Most used**, **Most triangles**, **Name** or **Colour**.
- Switch between a grid and a list with the two small buttons.
- Select a part in the viewport and look at **Properties**: it shows the part’s material.

## See where a material is used

1. Click a material in the dock.
2. The inspector at the right of the dock shows its colour, roughness, metalness and opacity, and how many parts and triangles use it.
3. Press **Select parts** to select every part that uses it, or **Isolate** to see only those parts.

## Recolour

1. Double-click a material in the dock, or select it and press **Edit** in the inspector.
2. Change the colour in the editor that opens. You can also change how rough or metallic the surface is.
3. Every part that shares the material changes at once.

- **Roughness**: How matt the surface is. Low is glossy, high is dull.
- **Metalness**: How much the surface behaves like metal.
- **Opacity**: How solid the surface is. Lower values are see-through.

## Give parts a different material

1. Select the parts in the viewport or in the tree.
2. Click the material you want in the dock.
3. Press **Assign** in the inspector.

## Make, copy, merge, delete

The buttons at the right of the dock’s header:

- **New material**: Makes a new material. If parts are selected, they get it.
- **Duplicate**: Copies the picked material.
- **Merge**: Turns several picked materials into one. Hold `Ctrl` and click to pick several.
- **Delete**: Deletes the picked materials.
- **Industry presets**: Applies a ready-made look to the picked material, such as brushed steel, glass or rubber.

A right-click on a material gives the same commands, and one to copy its colour code.

## Good to know

- A new material is named after its colour, and the name follows the colour when you change it.
- Every change in the dock is an undo step.
- Drag the top edge of the dock to make it taller. Double-click the edge to reset it.
- The dock and the console share the same place and take turns.

Related: [view-modes](meshoptimiser://docs/view-modes), [select-parts](meshoptimiser://docs/select-parts), [export](meshoptimiser://docs/export)
