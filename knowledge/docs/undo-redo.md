# Undo and redo

Every editing action can be taken back with Ctrl + Z. What counts as one step, and how to go back to the file as it was opened.

- `Ctrl + Z`: Undo the last action
- `Ctrl + Y`: Redo: do it again
- `Ctrl + Shift + Z`: Redo as well

There are no undo buttons on screen. Undo and redo are keyboard only.

## What can be undone

Every editing action: deleting, hiding and showing, moving, renaming, grouping, flattening, recolouring, and every mesh tool such as Fill holes, Decimate, Smart fit and Split.

## What counts as one step

- A tool that changes many parts at once is one step. One `Ctrl + Z` takes back a whole Fill holes run or a whole Fit to budget.
- In Align to floor, a run of adjustments is one step.
- Changing the threshold of Delete small parts while its parts are isolated adds no step of its own.

## Each tab has its own history

Undo works on the scene in the tab you are looking at. Other tabs are not touched. See [Scene tabs](meshoptimiser://docs/scene-tabs).

## Start over

To throw away every edit and reload the file as it was, choose **Menu**, then **Revert to source…**. The app asks before it does this.

> Your original file on disk is never changed by anything you do in the app. Edits reach a file only when you save a scene or export.

> After a change that is too large to keep an undo copy of, the app clears the history and tells you so. This is rare. Save a scene before a very heavy operation if you want a way back.

Related: [save-scene](meshoptimiser://docs/save-scene), [scene-tabs](meshoptimiser://docs/scene-tabs), [shortcuts](meshoptimiser://docs/shortcuts)
