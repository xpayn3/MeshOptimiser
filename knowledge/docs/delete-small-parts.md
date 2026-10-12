# Delete small parts

Remove the screws, washers and clips that are too small to matter, with a slider and a preview of what will go.

A CAD assembly is mostly small things: screws, washers, clips, nuts. From a normal viewing distance nobody sees them, but there are hundreds of them and each one costs triangles. This card removes every part below a size you choose.

## When to use it

Early, when the model is for looking at as a whole and the small hardware does not matter. Do not use it when the fasteners are the point of the picture.

## Steps

1. Open the card **Delete small parts** in the right sidebar, under Clean up.
2. Drag the slider **Smaller than**. The value is a share of the whole model’s size. It starts at 2%.
3. Read the line under it. It says how many parts would go and how long that is, for example “710 parts under 70.5 mm corner to corner”.
4. Press **Isolate**. Only the parts that would be deleted are shown, so you can check them.
5. Drag the slider again if needed. While the small parts are isolated, the view follows the slider.
6. Press **Delete**. The button says how many small parts it will remove.
7. Press **Show all** to see the rest of the model again.

## What the options mean

- **Smaller than**: The threshold, in percent of the model’s size. A part below it counts as small.
- **Measured by: Diagonal**: The distance from corner to corner of the part’s bounding box. The usual choice.
- **Measured by: Longest side**: The part’s longest side. It keeps long thin parts such as rods and pipes, and is stricter with flat ones.
- **Measured by: Volume**: The volume of the part’s bounding box. It catches thin sheets and wires however long they are.

## Hidden parts are left alone

Only parts that are on show are looked at: the ones with an open eye in the parts tree. A part you hid is not counted, not isolated and not deleted. If there are hidden parts, the line under the slider says how many it skipped, for example “3 hidden parts are left alone”. Hiding or showing a part updates the count at once. While the small parts are isolated, the card goes on choosing from the parts that were on show before you pressed **Isolate**.

## See the small parts without deleting them

The button with the warning triangle on the viewport’s tool strip tints every part under the threshold. The same switch is **Highlight small parts** under **Settings**, **Viewport**.

## Undo

The delete is one undo step. Press `Ctrl + Z` and the parts are back.

> A common mistake is a threshold that is too high. At a few percent, handles, knobs, feet and hinges count as small too. Always press **Isolate** and look before you delete.

To remove only the hardware, and not every small part, use [Fasteners](meshoptimiser://docs/fasteners). [Smart optimise](meshoptimiser://docs/smart-optimise) has this step too, under the name **Remove parts under**.

Related: [select-hidden-parts](meshoptimiser://docs/select-hidden-parts), [fasteners](meshoptimiser://docs/fasteners), [smart-optimise](meshoptimiser://docs/smart-optimise), [read-the-numbers](meshoptimiser://docs/read-the-numbers), [workflow](meshoptimiser://docs/workflow)
