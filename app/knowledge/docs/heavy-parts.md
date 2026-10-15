# Heavy parts

A list of the parts that hold the most triangles, heaviest first, with a count beside its title. Tick the ones you do not need and delete them in one step.

A few parts often hold a large share of a model’s triangles. The card **Heavy parts** lists them, so you can see where the weight is without searching the tree.

## What the card lists

Only parts with more than 10,000 triangles are listed. The heaviest is at the top, and the list holds at most 500 parts. Each row shows the part’s place in the list, its name, its triangle count (for example 12.4k) and a bar that compares it with the heaviest part. Hover over a row to see the full name, the exact count and the rank.

The bar is a rounded pill, coloured by rank from red for the heaviest to green for the lightest, and it grows in from the left when the list is drawn. Ticked rows that touch join into one shape.

The card is in the right sidebar, under Inspect. Beside its title is a small number: how many parts are over the limit. You can read it while the card is folded. It goes down as you delete or reduce parts, and it reads 0, dimmed, when no part is that big.

## Steps

1. Open the card **Heavy parts** in the right sidebar, under Inspect.
2. Click a row to tick it. The part is selected in the viewport. Click the row again to take the tick off. Rows you ticked before stay ticked.
3. To tick a run of rows, click the first one, then hold `Shift` and click the last.
4. To see where a part is, right-click its row. The view moves to the part. The ticks stay as they are.
5. Press the button under the list. It says what it will remove, for example “Delete 3 parts · 171.3k triangles”. It cannot be pressed until a row is ticked.
6. If you removed too much, press `Ctrl + Z`. The whole delete is one undo step.

> A tick is the same thing as selecting the part. A part that you selected in the viewport or in the tree is ticked in the list too, if it is listed. The button deletes only the ticked rows, never a selected part that is not on the list.

## What to do with a heavy part

- Delete it, if nobody will miss it. Deleting costs no quality.
- Reduce it with [Decimate](meshoptimiser://docs/decimate), if it matters and is simply too dense.
- Replace it with a simple stand-in using [Smart fit](meshoptimiser://docs/smart-fit), if only its size and place matter.
- Leave it, if it is the part everybody will look at.

## Good to know

- The list follows the scene. After a delete, an undo or a decimate it updates a moment later.
- The limit of 10,000 triangles is fixed. A scene made of many lighter parts can be heavy without one part in the list. To bring a whole scene down to a number, use [Fit to budget](meshoptimiser://docs/fit-to-budget) or [Smart optimise](meshoptimiser://docs/smart-optimise).
- For a picture of where the density is, press `Alt + 4` for the heatmap. See [How to read the numbers](meshoptimiser://docs/read-the-numbers).

Related: [read-the-numbers](meshoptimiser://docs/read-the-numbers), [decimate](meshoptimiser://docs/decimate), [smart-fit](meshoptimiser://docs/smart-fit), [fit-to-budget](meshoptimiser://docs/fit-to-budget)
