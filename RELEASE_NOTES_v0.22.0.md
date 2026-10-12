# MeshOptimiser v0.22.0

Claude can drive the optimiser, the app can update itself, and a crash no longer costs the scene.

## New

**Work with Claude.** Switch on **Let Claude connect** in Settings, add the app to Claude once with `claude mcp add --transport http meshoptimiser http://localhost:4242/mcp`, and Claude can use the same tools you click, on the scene you have open: 65 of them, from finding bolts and hidden parts to Smart optimise, reducing to a size, pictures and exports. It is off until you switch it on. Four switches decide what it may do, an Allow or Don't allow prompt comes before every edit, deleting always asks, and every change is one undo step. Sixteen steps take a dry run (the app does it, reads the numbers and takes it back), `optimise_to_target` goes to a size in one call, `compare_images` draws before and after, `batch_optimise` does a folder, and long jobs show their progress with a Stop button. It arrives knowing the app: six playbooks, about fifty help articles and six ready-made jobs.

**Updates inside the app.** Settings, Updates looks for a newer version and installs it: a few megabytes of the app's own files, checked against a fingerprint before any file is replaced, with one earlier version kept and a way back that works by itself if the new one does not start. Check automatically, Stable or Beta, a notice in the corner. Versions before this one need one manual update.

**Your scene back after a crash.** While a scene has changes that are not saved, a copy is kept in the browser (every 2 minutes by default; Settings, General, Recovery). After a crash the app offers it back, and the start screen shows it first as a yellow Continue card. Saving clears it.

**Keep sharp edges.** Decimate and Fit to budget hold on to rims, steps and corners while triangles go. On by default; parts that are mostly hard edges, like gears, are reduced as before.

**Meshopt compression and Faster to draw** in Export (GLB). Meshopt is about a quarter of the plain size, Draco is smaller still. Faster to draw only reorders for the graphics card, and any viewer opens it.

**New scenes start your way.** A unit and an up axis in Settings, General.

## Around the app

- A Tasks chip in the status bar for every tab's running job, with Cancel.
- Hover a tree row and the part pulses; hover a part and its row lights up. A soft glow on the selection.
- Explode along each part's own axis, Recentre moves only the selected parts, a Shading angle in Properties, and about forty more actions in the search.
- Drop a folder to open the model in it; a glTF with external files asks for its folder; a converted STEP opens at once from Recent.
- A new loader, a six-step list when a STEP opens, a camera pill under the view cube, a wider left sidebar, sharper turntable videos.

## Fixed

- Closing or reloading a tab while a conversion runs stops the converter at once; the server cancels jobs nobody asks about for ten minutes.
- The selection stays while exploding, and an exploded model's bounding box is no longer offset twice.
- The grid refits after a model is added to a scene or a library part arrives.
- Smart fit's cylinder copes with a ring that has a tab or ears.
