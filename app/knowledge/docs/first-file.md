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

- **Surface quality**: How closely the triangles follow curved surfaces: **Coarse**, **Standard**, **Fine** or **Ultra**. Coarse is the fastest and shows facets on curves. Ultra is slow and very smooth. Standard is the recommended one. **Custom** means your own numbers, under Tessellation.
- **Tessellation**: The numbers behind that choice. Click the row to open it. It is explained below.
- **Colours and structure**: **Colours & hierarchy** reads colours, names and the assembly tree. **Geometry only** is the fastest and gives you neither colours nor a tree. It suits huge files where you only need the shape.
- **What to read**: Five switches for extra information in the file: **Instance overrides**, **Keep layers**, **Materials**, **Product names** and **Validation properties**. Each one adds a pass over the file. Instance overrides is the slowest on assemblies with many repeated parts. **Keep layers** keeps the CAD layer each part is on: it shows in the Properties card and **Select by layer** in the command search selects every part on one.
- **Drop small parts**: Leaves out parts smaller than this share of the model during conversion. 0 keeps everything.
- **Share identical shapes**: Stores a repeated shape once. Leave it on.
- **Swap Y and Z**: Stands a model up that comes in lying on its side.
- **Convert again**: Ignores a stored conversion of the same file, if there is one, and converts from scratch.
- **Add to the open scene**: Adds the file to the scene that is open, instead of opening it as a scene of its own.
- **Fit the view**: Moves the camera so the whole model is in view when it has loaded.
- **Don't ask again for this format**: Skips this window next time and uses the same answers. Leave it unticked until you know which settings you want.

IGES and BREP files, two other CAD formats, get the same window. FBX, OBJ, 3MF and STL files get a shorter version of it, with only the last three choices. GLB and glTF files open without it.

## Tessellation: how the surfaces become triangles

Tessellation is the step that covers the exact CAD surfaces with triangles. You do not have to open this block: the four choices of **Surface quality** fill it in for you. Open it when curves come in too faceted, or the model comes in too heavy.

- **Sag**: How far a triangle may stand off the true surface, in millimetres. Smaller is smoother, and makes more triangles.
- **Angle**: The most a curve may turn from one triangle to the next, in degrees. Smaller means rounder holes and rounder fillets (a fillet is a rounded edge).
- **Min edge**: The smallest triangle edge allowed, in millimetres. It keeps tiny fillets and threads from filling up with thin slivers. 0 is no limit.
- **The four choices and Custom**: Each choice sets the sag and the angle: Coarse is 1 mm and 30°, Standard 0.5 mm and 30°, Fine 0.2 mm and 20°, Ultra 0.05 mm and 12°. Type a number of your own and **Custom** is selected.
- **By part size**: Fine on the large parts, coarse on the small ones. Small, medium and large parts each get a sag and an angle of their own, so the housing comes in fine and the screws coarse. Two fields, **Small under** and **large from**, say where the limits are, as a share of the model’s size: 5% and 30% to begin with. While it is on, the four choices are greyed out. **Min edge** still applies.
- **Smooth shading**: Takes the normals, the directions the light is worked out from, from the real CAD surfaces. A fillet then runs into the faces beside it without a visible seam, and sharp edges stay sharp. On by default.

> A coarser setting here makes fewer triangles at the source. That usually looks better than reducing a fine mesh afterwards.

## Follow the progress, or stop it

- The progress card shows the latest message from the converter. **Copy log** copies all messages, which is useful when you report a problem.
- **Cancel** stops the conversion.
- If the conversion fails, the card says so. Press **Copy log** to keep the messages. See [Troubleshooting](meshoptimiser://docs/troubleshooting).

## Where the converted file goes

The converter writes the GLB into the folder `inbox`, inside `app`. The copy of your STEP file that was made for the conversion is removed when it finishes. To keep a GLB somewhere you choose, with a name you choose, use [Save a scene](meshoptimiser://docs/save-scene) or [Export](meshoptimiser://docs/export).

## More than one file

- Opening a second file does not replace the first. It opens in a new tab. See [Scene tabs](meshoptimiser://docs/scene-tabs).
- To put two files into one scene, use **Menu**, then **Import into scene…**, or press `Ctrl + Shift + O`.
- To throw away every edit and load the file again as it was, use **Menu**, then **Revert to source…**.

Related: [the-window](meshoptimiser://docs/the-window), [move-the-view](meshoptimiser://docs/move-the-view), [read-the-numbers](meshoptimiser://docs/read-the-numbers), [troubleshooting](meshoptimiser://docs/troubleshooting)
