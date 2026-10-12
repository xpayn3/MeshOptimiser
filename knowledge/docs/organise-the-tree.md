# Organise the tree: groups, sorting and picking

Pick groups and parts together, take a group out of the tree without losing what is in it, flatten, sort and move groups.

The parts tree can be tidied from the right-click menu of a group, and groups and parts can be picked together. Everything here is one undo step.

## Pick groups and parts together

- `Click`: Picks this row alone. A group brings all its parts.
- `Ctrl + Click`: Adds the row to the selection, or takes it out again. A group goes in or out with all its parts.
- `Shift + Click`: Picks every row from the last one you clicked to this one, groups and parts alike. Only the rows you can see count: a closed group comes with its group, not row by row.
- `Ctrl + Shift + Click`: Adds that range to what is already picked.

Control and Shift never start a drag, so a slip of the mouse cannot move rows when you only meant to pick them.

## The right-click menu of a group

- **Ungroup**: Dissolves this group; its children move up one level.
- **Remove group, keep contents**: Takes the group, or every selected group when it is one of them, out of the tree. What was inside stays as it was, nesting included, and moves up to where the group stood.
- **Flatten this group**: Keeps the group but dissolves every group inside it, so all its parts sit directly under it.
- **Sort inside A to Z and Z to A**: Orders what is directly inside the group by name. Numbers go by value (part 2 before part 10) and groups come first.
- **Move group up and Move group down**: Moves the group one place among the rows beside it, with its contents.
- **Delete empty groups**: Removes every group that holds no part.
- **Expand this branch and Collapse this branch**: Opens or closes this group and every group inside it.
- **Delete group + contents**: Deletes the group and everything in it. Ctrl + Z brings it back.

> Lines you draw are rows of the tree too, so they can be grouped, nested, sorted and moved in the same way.

Related: [parts-tree](meshoptimiser://docs/parts-tree), [select-parts](meshoptimiser://docs/select-parts), [undo-redo](meshoptimiser://docs/undo-redo), [draw-lines](meshoptimiser://docs/draw-lines)
