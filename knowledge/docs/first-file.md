# Open your first file

Drop a file on the window. What the import settings mean, what conversion does, how to follow its progress, and where the result is kept.

The app opens STEP (`.step`, `.stp`), GLB, glTF, FBX, OBJ, 3MF and STL files. A STEP file is converted first. The other formats open directly.

## Open a file

1. Drag the file from your file manager onto the app window. You can drop it on the start screen or on the 3D view. While you hold it over the view, the words **Drop to open** appear.
2. Or press `Ctrl + O` and pick the file. On the start screen the same button is called **Open file…**.
3. For a STEP file, a window called **Import settings** appears. The first time, leave everything as it is and press **Import**.
4. A progress card shows what is happening, with a running clock and a log of messages. A large assembly can take several minutes.
5. When it is done, the model appears in the 3D view. The parts tree on the left fills with its parts, and **Properties** on the right shows its totals.

> Your original file is never changed. The app works on its own copy, and nothing is written to a file until you save or export.

## What conversion does

A STEP file holds exact surfaces. The converter, running in Python on your computer, turns it into a GLB file made of triangles. Along the way it:

- reads the names and colours of the parts and the tree they are arranged in;
- tessellates the surfaces, which means it covers them with triangles;
- finds parts that have the same shape and stores that shape once (instancing);
- leaves out parts below a size you choose, if you ask for it;
- compresses the result with Meshopt, if the tool gltfpack is installed.

## The import settings for a STEP file

- **Tessellation quality**: How closely the triangles follow curved surfaces. The choices run from Coarse (1.0), the fastest with visibly faceted curves, to Ultra (0.05), slow and very smooth. Standard (0.5) is the recommended one.
- **Colours & materials**: Read colours, names and the hierarchy, or geometry only. Geometry only is the fastest and gives you neither colours nor a tree. It suits huge files where you only need the shape.
- **XCAF read modes**: Five switches for extra information in the file. Each one costs time. Turning off **SHUO overrides** saves the most on assemblies with many repeated parts.
- **Drop parts smaller than (% of model)**: Leaves out tiny parts during conversion. 0 keeps everything.
- **Force re-convert**: Ignores a stored conversion of the same file, if there is one, and converts from scratch.
- **Collapse identical shapes into instances**: Stores a repeated shape once. Leave it on.
- **Append to current scene**: Adds the file to the scene that is open, instead of opening it as a scene of its own.
- **Fit view after loading**: Moves the camera so the whole model is in view when it has loaded.
- **Don't ask again for this format**: Skips this window next time and uses the same answers. Leave it unticked until you know which settings you want.

FBX, OBJ, 3MF and STL files get a shorter version of this window, with only the last three choices. GLB and glTF files open without it.

## Follow the progress, or stop it

- The progress card shows the latest message from the converter. **Copy log** copies all messages, which is useful when you report a problem.
- **Cancel** stops the conversion.
- If the conversion fails, the card says so. Press **Copy log** to keep the messages. See [Troubleshooting](meshoptimiser://docs/troubleshooting).

## Where the converted file goes

The converter writes the GLB into the folder `inbox`, inside the app folder. The copy of your STEP file that was made for the conversion is removed when it finishes. To keep a GLB somewhere you choose, with a name you choose, use [Save a scene](meshoptimiser://docs/save-scene) or [Export](meshoptimiser://docs/export).

## More than one file

- Opening a second file does not replace the first. It opens in a new tab. See [Scene tabs](meshoptimiser://docs/scene-tabs).
- To put two files into one scene, use **Menu**, then **Import into scene…**, or press `Ctrl + Shift + O`.
- To throw away every edit and load the file again as it was, use **Menu**, then **Revert to source…**.

Related: [the-window](meshoptimiser://docs/the-window), [move-the-view](meshoptimiser://docs/move-the-view), [read-the-numbers](meshoptimiser://docs/read-the-numbers), [troubleshooting](meshoptimiser://docs/troubleshooting)
