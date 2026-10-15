# Save a scene

Save your work as a scene file so you can carry on later. What a scene file is, how to name it with the file-name buttons, and how it differs from an export.

Saving a scene keeps your work so you can open it again and carry on. Exporting writes a file for another program. Do both: save a scene for yourself, export for whoever gets the result.

## What a scene file is

A scene file is a `.glb` file. It holds the model as it is now, after everything you deleted, reduced and recoloured. It also remembers things only MeshOptimiser uses: the camera, the view settings, which parts were hidden or flagged, your measurements and the [notes](meshoptimiser://docs/notes) people left on the model. Other programs can open the file as an ordinary GLB and ignore the rest.

## Save

1. Press `Ctrl + S`. You can also click the dot on the scene’s tab, or choose **Menu**, then **Save scene…**.
2. The **Save scene** window opens. At the top it says what is about to be written: how many parts, how many triangles and about how big the file will be.
3. Check the **Filename**, or type your own. The ending `.glb` is added for you. The buttons under the name can build it for you (see below).
4. Look at the options under the name, and press **Save…**.
5. Where the browser allows it, a file window opens. Choose a folder and confirm. Otherwise the file goes to your downloads folder.
6. The dot on the tab turns green.

Saving again under the same name writes to the same file without asking where. The window then says “Saves over” and the name of the file, and the button reads **Save**.

## Build the file name

Under the name are small buttons. Each one adds a piece to the name. Press it again and the piece comes off. The numbers are those of what is about to be written, and they follow the options below, so the name stays true.

- **+ date**: Today’s date, like `2026-10-08`.
- **+ time**: The time now, like `1432h`.
- **+ version**: A version number like `v2`. Press it again to raise the number. Hold `Shift` while you press to take it off.
- **+ triangles**: How many triangles the file holds, like `17k-tris`.
- **+ parts**: How many parts, like `67-parts`.
- **+ size**: About how big the file is, like `370KB`.
- **+ saving**: How much lighter than the file you opened, like `-42pct`. It shows only when the new file is lighter.
- **+ optimised**: Adds the word `optimised`, to mark the file as the optimised one.
- **+ selection**: Adds the word `selection`, to mark the file as a part of the scene.
- **Source name**: Starts again from the name of the file you opened.

A button that is in use shows a minus sign instead of the plus. You can also type in the name by hand.

## The options

- **Whole scene**: On: every part. Off: only the selected parts. It is dimmed when nothing is selected, and says how many parts are selected.
- **Include hidden parts**: Hidden parts are written too, and come back hidden when you open the scene again. It says how many are hidden.
- **Remember the view and settings**: Stores the camera, the display settings, flags and measurements in the file. Other programs ignore them.
- **Save as a copy**: Writes the file without making it this scene’s file. The scene keeps its unsaved mark, and the next save goes where it went before.

A file that holds only some of the scene (only the selection, or no hidden parts) is never the scene’s own file. The app turns on **Save as a copy** for you.

## Know whether you have saved

The dot on the tab is yellow while there are changes that are not saved, and green when the scene is saved. Other tabs show a yellow dot too when they have unsaved changes. Closing a tab or quitting with unsaved changes asks first.

## Open a scene again

Open the `.glb` like any other file: drop it on the window, press `Ctrl + O`, or pick it from the recent files on the start screen. The camera and the view settings come back with it, and hidden parts are still hidden.

## Scene or export?

- **Save scene**: Everything, including hidden parts, at the scene’s own scale and orientation. For continuing your work.
- **Export**: What you choose, in the format, scale and orientation the next program needs. For handing over.

> Your original file is never overwritten by a save, unless you choose its name and folder yourself. Give the scene a name of its own.

Related: [export](meshoptimiser://docs/export), [scene-tabs](meshoptimiser://docs/scene-tabs), [undo-redo](meshoptimiser://docs/undo-redo), [crash-recovery](meshoptimiser://docs/crash-recovery)
