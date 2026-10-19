# Get your scene back after a crash

While a scene has changes that are not saved, a copy is kept inside your browser. If the app crashes, it offers the scene back the next time it starts.

A crash, a browser that is killed or a power cut used to take the scene you were working on with it, because a scene is only a file once you save it. Now the app keeps a recovery copy while there is something to lose, and offers it back when the app comes up again.

## What is kept, and when

- A copy of the scene, the same file **Save scene** would write, with the camera and the view. It is stored inside the browser, on this computer, and goes nowhere else.
- Only while the scene has changes that are not saved, and only when something changed since the last copy. Every minute, every 2 minutes (the default) or every 5 minutes, as you choose in **Settings**, **General**, **Recovery**.
- Not while you are dragging, and not while a file is loading. It also takes one when the browser tab goes to the background, because that is where trouble is likeliest.
- When the app hits a string of errors, or the graphics card is lost, it takes one straight away.
- A big scene takes a moment to copy, so it is copied less often. Each scene tab has a copy of its own; up to six are kept, for 14 days.

Saving the scene clears the copy, and so does undoing back to the saved state. Closing a scene tab on purpose, or closing or reloading the window and choosing to leave without saving, does not bring the scene back: the copy is for a crash. If the browser has no room left for copies, the app says so and pauses them.

## When the app comes back

1. The app notices that the last run did not end properly and says **MeshOptimiser closed unexpectedly last time**, with the name of the scene and how long ago the copy was made.
2. Press **Recover** (the button carries the scene’s name, or the number of scenes) and the scene opens as a scene with changes that are not saved, with the unit and up axis it had. Press **Reopen** (the button carries the file’s name) for the file you had open, **Safe mode** if the crashes keep coming, **Delete the copy** to let it go, or **Not now** to leave it for later.
3. The same scene is on the start screen, first in the list of recent files: a wide yellow card tagged **Continue** (more than one are tagged **Recovered**), marked “not saved”. Click it to bring the scene back, or the × to delete the copy.
4. Save the recovered scene to keep it. Until you do, it stays a scene with changes that are not saved.

## Turn it off

In **Settings**, **General**, **Recovery**, choose **Off**. **Recovery copies** under **Storage** deletes the copies that are kept. The online version keeps none.

> A recovery copy is not a backup. It lives in the browser that made it: clearing the site’s data deletes it, and another browser or another computer cannot see it. Save the scene to a file as you go.

Related: [save-scene](meshoptimiser://docs/save-scene), [settings](meshoptimiser://docs/settings), [troubleshooting](meshoptimiser://docs/troubleshooting), [undo-redo](meshoptimiser://docs/undo-redo)
