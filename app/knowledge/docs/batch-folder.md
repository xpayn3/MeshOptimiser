# Batch optimise a folder

Optimise every model in a folder, one after another, and find the lighter copies in the exports folder.

When there are many models to make lighter, opening each one by hand is slow. Batch optimise takes a folder, runs **Smart optimise** on each model in it, and saves each result next to the others in the exports folder. The scene you have open is not touched.

## Start it

- Press **Batch folder…** on the start screen and choose a folder.
- Or drop a folder on the window. With two or more models in it, the card below opens. (With one model, that model opens as it always did.)
- Or search for **Batch optimise a folder…** (`Ctrl + K`).

## What happens

1. The card lists the models it found, sub-folders included, up to 100. A file that is not a model is left out.
2. Choose how far to go: **Light**, **Balanced** or **Strong**. They are the levels of [Smart optimise](meshoptimiser://docs/smart-optimise).
3. Press **Optimise**. Each model opens in a scene tab of its own, is optimised, is saved in the exports folder as **name_optimised** (the Web preset, a GLB) and its tab closes. Each row says what became of it: the triangles before and after, or why it failed.
4. Press **Stop** to end the run after the file that is being worked on. Closing the card does the same.

> Every model opens with the import settings you last used for its format, with no window per file. The files themselves are never changed, and they do not appear in the Recent list of the start screen.

**Open one model instead** on the card opens the first model of the folder as a scene, the old way.

## Good to know

- A big folder takes a while: STEP files are converted first, and each model is optimised in full. Start with a few.
- A .gltf finds its pictures and its data file in the folder; if they are missing, that row fails and the rest go on.
- Claude can do the same through the **batch_optimise** tool, with a folder path on this computer.

Related: [smart-optimise](meshoptimiser://docs/smart-optimise), [export](meshoptimiser://docs/export), [work-with-claude](not in this knowledge base)
