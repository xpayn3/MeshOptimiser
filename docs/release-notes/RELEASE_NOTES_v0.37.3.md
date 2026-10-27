# MeshOptimiser v0.37.3

Save writes over the file, the window's title follows the scene, Open with from Explorer, notifications for long jobs, and the material names of an FBX.

## New

- **Save** (Ctrl+S) writes over the file the scene came from or was saved to, without asking; **Save scene as…** (Ctrl+Shift+S) always asks.
- The window's **title** is the scene's name, with a small orange diamond while changes are not saved, and the percent of a running job in front.
- **Open with:** the installer lists MeshOptimiser for glb, gltf, obj, fbx, stl, 3mf, usd, usdz, dae and the CAD types; OBJ, FBX, STL, 3MF, USD and Collada can now be handed to the program.
- **Settings › General › Notifications:** a system notification when a long job ends in the background.
- A running task shows as a **tab on the status bar**; a click on the Properties card **folds** its rows.

## Fixed

- **Material names** of an FBX (and other files) were lost; they now come in.
- An object with objects under it (Cinema 4D) opens as a group; the **pivots** set in Cinema 4D are on the parts of an FBX.
- A part in a turned group reads its **rotation** from the group's axes.
- The **Heatmap** no longer glows to white.
- **Remove lettering** finds marks when the limit is set high, and no longer sits for minutes on a large part.
- The "closed unexpectedly" card and the numbers of the sidebar sliders are laid out right again.
