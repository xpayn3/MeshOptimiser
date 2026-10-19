# The parts tree

Search, rename, group and reorder the parts of a model, rename many at once, and flatten a hierarchy that is deeper than you need.

The parts tree in the left sidebar lists everything in the scene. A part is one row. A group is a folder that holds parts or other groups. A STEP file usually arrives with the groups its designer made.

## Read a row

- A part row shows its name and its triangle count.
- A group row shows how many parts it holds. A group with nothing in it says “empty”.
- The eye at the right hides or shows the row.
- Click the small box in front of a group to open or close it.

## The buttons above the tree

- **Collapse**: A click, or a right-click, opens a menu to close or open every group, the groups you selected, or the groups from the selected row on. See below.
- **Rename**: Renames many parts at once. A click, or a right-click, opens a menu: **Batch rename…** first (`F2` opens it too), then your saved rules and the built-in ones. A rule opens the window with its settings filled in.
- **Flatten**: Removes levels of grouping. A click, or a right-click, opens a menu: **Advanced flatten…** first, then quick choices such as flattening the deepest level.
- **Transform**: Shows or hides the Transform card at the foot of the sidebar. See [Move, rotate, scale](meshoptimiser://docs/move-rotate-scale).
- **Recentre, Centre pivot, Bake transforms**: One press each. See [Clean up](meshoptimiser://docs/cleanup) and [The axis of a part](meshoptimiser://docs/axis-center).

## Collapse and expand part of the tree

A big assembly has many groups. Sometimes you want to close only some of them. Click **Collapse** to choose. Select a part or a group in the tree first, for the choices that need a selection.

- **Collapse the whole tree**: Closes every group.
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

The search reads more than a plain word. Case, accents and the marks `_`, `-` and `.` are ignored, and so are the joins inside a name such as GearBox, so `gearbox` finds Gear_Box and `gear box` finds GearBox. You can combine these:

- **`gear box`**: Several words: every word has to be in the name, in any order.
- **`"m6 bolt"`**: Words in quotes are matched together, as you wrote them.
- **`bolt, nut`**: A comma means or: names with either.
- **`-washer`**: A minus sign leaves out the names that have the word.
- **`>5000`, `<200`**: Parts with more or fewer triangles than the number. `5k` and `1.2m` work as numbers.
- **`is:hidden`, `is:visible`, `is:selected`**: Parts by state.

When nothing at all is found, the search tries again more forgivingly. In a word of four letters or more, one letter may be wrong, missing, extra or swapped with its neighbour, and in a word of eight letters or more, two. So `braket` finds Bracket. Groups are matched by their names only, so the triangle and state marks do not apply to them.

## Rename one row

1. Double-click the name of a part or a group.
2. Type the new name.
3. Press `Enter`.

## Rename many rows

CAD files often come with names like `Part_0031_geom`. Batch rename changes many names in one go.

1. Select the parts to rename.
2. Press `F2`, or press the **Rename** button and choose **Batch rename…**. The **Batch rename** window opens.
3. Choose a tab. **Replace** swaps one piece of text for another. **Quick** adds text before or after the name, changes the letters (UPPER, lower, Title Case, snake_case and more), cleans up and numbers the names. **Pattern** builds each name from pieces such as `{name}`, `{parent}` and `{counter:003}`. **Presets** has ready-made rules, such as lower-casing every name or removing a number at the end.
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

A STEP file can have groups inside groups ten levels deep. Flatten removes levels you do not need. Press **Flatten** and choose **Advanced flatten…** to open the **Advanced flatten** window; the other choices in that menu do the common cases in one step.

- **Scope**: The whole tree, or only the groups you selected.
- **Total flatten**: Removes every group inside the scope. All parts end up side by side.
- **Keep top N levels**: Keeps the first levels of grouping and removes everything deeper.
- **Flatten last level only**: Removes only the deepest groups, the ones that hold nothing but parts.
- **Collapse single-child chains**: Removes groups that hold nothing but one other group. This is a common tidy-up for STEP files.
- **Ungroup (dissolve scope itself)**: Removes the selected groups and moves what they held one level up.
- **Preserve user groups**: Leaves alone the groups you made yourself.
- **Remove empty groups left behind**: Deletes groups that end up with nothing in them.

## Walk the tree with the keyboard

Click a row in the tree, and the arrow keys work in it until you click somewhere else. `↑` and `↓` go to the row above and below. Hold `Shift` to add rows to the selection one at a time. `→` opens a closed group, and on an open group steps to its first row. `←` closes an open group, and on a part or a closed group goes to the group that holds it. `Home` and `End` go to the first and the last row.

## The right-click menu

The menu opens where you clicked. Right-click a part row for frame, isolate, animate, toggle visibility, group, lock, copy, duplicate and delete; the ones used less are one level in: **Visibility** (hide unselected, show all), **Select** (similar shape, all instances, the original, same colour, make unique), **Mesh** (merge, split, remove holes), **Fit** (Smart fit and the boxes) and **Tree** (expand and collapse all). Right-click a group row to select its parts, frame it, rename it, show or hide it, lock everything in it or animate it, with **Group** (ungroup, remove keeping the contents, flatten, delete empty groups), **Order** (sort and move) and **Expand and collapse** one level in, and delete it with its contents.

A locked part cannot be moved, and delete skips it. Use the same menu entry to unlock it.

## Undo

Every change to the tree is an undo step: renames, groups, drags, flatten and deletes. Press `Ctrl + Z`.

> By default an emptied group stays in the tree, marked “empty”, so you can fill it again. To have such groups removed automatically, switch on **Delete groups when they become empty** under **Settings**, **General**.

Related: [select-parts](meshoptimiser://docs/select-parts), [undo-redo](meshoptimiser://docs/undo-redo), [cleanup](meshoptimiser://docs/cleanup)
