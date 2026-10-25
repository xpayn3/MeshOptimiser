# Undo and redo

Every editing action can be taken back with Ctrl + Z. What counts as one step, and how to go back to the file as it was opened.

- `Ctrl + Z`: Undo the last action
- `Ctrl + Y`: Redo: do it again
- `Ctrl + Shift + Z`: Redo as well

There are no undo buttons on screen. Use the keys, or run **Undo** and **Redo** from the search (`Ctrl + K`).

## What can be undone

Every editing action: deleting, hiding and showing, moving, renaming, grouping, flattening, recolouring, and every mesh tool such as Remove holes, Decimate, Smart fit and Split.

## What counts as one step

- A tool that changes many parts at once is one step. One `Ctrl + Z` takes back a whole Remove holes run or a whole Fit to budget.
- In Align to floor, a run of adjustments is one step.
- Changing the threshold of Delete small parts while its parts are isolated adds no step of its own.
- In [Edit mesh](meshoptimiser://docs/edit-mesh), a move, turn or scale of the picked pieces is one step, however long you drag, and so is each of Delete, Dissolve, Planarize, Straighten, Weld, Fill, Extract and Reverse normals. After an undo the pieces are picked again.
- Quick decimate (`B`) is one step, taken when you let go on a level.
- Each press of a button in [Align parts](meshoptimiser://docs/align-parts) is one step, and so is [Bake geo](meshoptimiser://docs/library) on a library shape (`Ctrl + Z` gives its parameters back).
- A number typed into the Transform panel with several parts selected is one step for all of them.

In Edit mesh, `Ctrl + Z` also takes back the last change of what is picked (a click, a box or a stroke of the brush).

## Each tab has its own history

Undo works on the scene in the tab you are looking at. Other tabs are not touched. See [Scene tabs](meshoptimiser://docs/scene-tabs).

## Start over

To throw away every edit and reload the file as it was, choose **Menu**, then **Revert to source…**. The app asks before it does this.

> Your original file on disk is never changed by anything you do in the app. Edits reach a file only when you save a scene or export.

> After a change that is too large to keep an undo copy of, the app clears the history and tells you so. This is rare. Save a scene before a very heavy operation if you want a way back.

Related: [save-scene](meshoptimiser://docs/save-scene), [scene-tabs](meshoptimiser://docs/scene-tabs), [shortcuts](meshoptimiser://docs/shortcuts), [edit-mesh](meshoptimiser://docs/edit-mesh), [align-parts](meshoptimiser://docs/align-parts)
