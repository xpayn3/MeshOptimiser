# The parts tree

Search, rename, group and reorder the parts of a model, rename many at once, and flatten a hierarchy that is deeper than you need.

The parts tree in the left sidebar lists everything in the scene. A part is one row. A group is a folder that holds parts or other groups. A STEP file usually arrives with the groups its designer made.

## Read a row

- A part row shows its name and its triangle count.
- A group row shows how many parts it holds. A group with nothing in it says “empty”.
- The eye at the right hides or shows the row.
- Click the small box in front of a group to open or close it.

## The three buttons

- **Collapse**: Closes every group. When every group is closed, the button says **Expand** and opens them all. The small arrow beside it, or a right-click on the button, opens a menu with more choices. See below.
- **Rename**: Renames many parts at once. `F2`.
- **Flatten**: Removes levels of grouping.

## Collapse and expand part of the tree

A big assembly has many groups. Sometimes you want to close only some of them. Click the arrow beside **Collapse** to choose. Select a part or a group in the tree first, for the choices that need a selection.

- **Collapse the whole tree**: Closes every group. The same as pressing **Collapse**.
- **Collapse the selection**: Closes the groups you selected and every group inside them. For a selected part, it closes the group the part is in.
- **Collapse from here on**: Closes the first selected row and every group after it in the tree. The groups above stay as they are, so the row you are on stays in view.
- **Expand the whole tree**: Opens every group.
- **Expand the selection**: Opens the groups you selected and every group inside them. For a selected part, it opens every group on the way down to it.
- **Expand from here on**: Opens the first selected row and every group after it.

The choices that need a selection are dimmed while nothing is selected.

## Find the selected part

Picked a part in the 3D view and want to see where it sits in the tree? Press `Shift + S`. The tree scrolls to the part, opens the groups it is in and flashes its row. A click on a part in the 3D view also scrolls the tree to it.

## A file you add to the scene

When you add a file to a scene that is already open (**Import into scene…**, or a dropped file with **Add to this scene**), the new parts are selected, shown in the tree and framed in the 3D view. That tells you where they landed.

## Search

Type in **Search parts…** above the tree. Only the rows whose names match stay, including matches inside closed groups. Press the small cross in the field to clear the search.

## Rename one row

1. Double-click the name of a part or a group.
2. Type the new name.
3. Press `Enter`.

## Rename many rows

CAD files often come with names like `Part_0031_geom`. Batch rename changes many names in one go.

1. Select the parts to rename.
2. Press `F2` or the **Rename** button. The **Batch rename** window opens.
3. Choose a tab. **Find & Replace** swaps one piece of text for another. **Pattern** builds each name from pieces such as `{name}`, `{parent}` and `{counter:003}`. **Presets** has ready-made rules, such as lower-casing every name or removing a number at the end.
4. Look at the **Preview**. It shows every name before and after.
5. Press **Apply**, or `Ctrl + Enter`.

## Group and ungroup

- `Ctrl + G`: Put the selected parts in a new group
- `Ctrl + Shift + G`: Ungroup: remove the selected group and keep what was inside
- `Del`: Delete the selected parts. With a group selected, the group and everything in it.

A new group is called “Group” with a number. Double-click it to give it a name. Parts in a group move together when you move the group.

## Drag and drop

Drag a row onto a group to move it into that group, or between two rows to change the order. A group cannot be dropped into itself.

## Flatten

A STEP file can have groups inside groups ten levels deep. Flatten removes levels you do not need. Press **Flatten** to open the **Advanced flatten** window.

- **Scope**: The whole tree, or only the groups you selected.
- **Total flatten**: Removes every group inside the scope. All parts end up side by side.
- **Keep top N levels**: Keeps the first levels of grouping and removes everything deeper.
- **Flatten last level only**: Removes only the deepest groups, the ones that hold nothing but parts.
- **Collapse single-child chains**: Removes groups that hold nothing but one other group. This is a common tidy-up for STEP files.
- **Ungroup (dissolve scope itself)**: Removes the selected groups and moves what they held one level up.
- **Preserve user groups**: Leaves alone the groups you made yourself.
- **Remove empty groups left behind**: Deletes groups that end up with nothing in them.

## The right-click menu

Right-click a part row for frame, isolate, hide, select similar, group, merge, Split, Fill holes, lock, Smart fit, copy, duplicate and delete. Right-click a group row to select its parts, frame it, rename it, ungroup it or delete it with its contents.

A locked part cannot be moved, and delete skips it. Use the same menu entry to unlock it.

## Undo

Every change to the tree is an undo step: renames, groups, drags, flatten and deletes. Press `Ctrl + Z`.

> By default an emptied group stays in the tree, marked “empty”, so you can fill it again. To have such groups removed automatically, switch on **Delete groups when they become empty** under **Settings**, **General**.

Related: [select-parts](meshoptimiser://docs/select-parts), [undo-redo](meshoptimiser://docs/undo-redo), [cleanup](meshoptimiser://docs/cleanup)
