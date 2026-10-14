# Align parts

Line the selected parts up along an axis, or space them evenly, with one press. Each press is one undo step.

Align parts moves the selected parts so they line up on one side or on the middle along X, Y or Z, or so they stand evenly apart. It is a floating card over the viewport. It moves whole parts, the way a layout program moves boxes, and does not change their meshes.

To stand the whole model on the floor, use [Align to floor](meshoptimiser://docs/align-to-floor) instead.

## Groups

Select a group in the tree, or several, and each group is lined up as one item. It is measured by the box round all its parts and it moves whole, so its parts keep their places against each other. A group inside another selected group goes along with it. You can mix groups and loose parts. A group with a locked part stays where it is, and the card says how many parts were locked.

## Open the card

- Press `Ctrl + K` and choose **Align and spread parts…**.
- Or choose **Align parts…** in the **Clean** slice of the [Quick wand](meshoptimiser://docs/quick-wand) when nothing is selected. It has no key of its own.
- Select the parts first. The card says how many are selected. Press `Esc` or **Done** to put it away.

## Align to

Three choices at the top say what the parts line up on.

- **Selection**: The box round the whole selection. The parts line up on its low side, its middle or its high side.
- **Last picked**: The part you picked last. It stays where it is, and the others line up on it.
- **Origin**: Zero. The parts line up on 0 on that axis. This is the only choice that works with a single part.

## Align and spread

There is a row for each of X, Y and Z, with two groups of buttons.

- **Align**: Three buttons: the low sides, the middles and the high sides of the parts go to one place along that axis.
- **Spread, middles**: The middles of the parts end up the same distance apart. The two outermost parts stay where they are, and the ones between move.
- **Spread, gaps**: The gaps between the parts become equal. Without a number in **Gap**, the parts are spread evenly between the two outermost ones, which stay where they are.

The **Gap** field sets a fixed gap for the second Spread button, in the scene’s units. The parts are laid out one after the other with that gap between them, counted from the lowest part. Leave it empty for an even spread.

## Steps

1. Select two or more parts.
2. Choose what to align to.
3. Press a button in the row of the axis you want. The parts move at once.
4. A line under the buttons says what moved, for example how many parts moved, or that they were already in line.

## What to know

- Parts are measured by their box in the scene, as they stand now.
- Align needs at least two parts, or one part and the Origin. Spread needs three parts, or two when a gap is typed in. Otherwise the line under the buttons says so.
- Locked parts stay where they are. The line under the buttons says how many were locked.
- If the view is exploded, the parts are put back together first, because the parts at rest are what is lined up.
- Each press is one undo step, so `Ctrl + Z` takes back one press.

> Which axis is up is a setting of the scene: **Up axis (viewport)** under **Settings**, **Scene**. The pictures on the buttons stand upright for the axis that is up.

Related: [align-to-floor](meshoptimiser://docs/align-to-floor), [move-rotate-scale](meshoptimiser://docs/move-rotate-scale), [select-parts](meshoptimiser://docs/select-parts), [search-and-commands](meshoptimiser://docs/search-and-commands), [undo-redo](meshoptimiser://docs/undo-redo)
