# How to convert a STEP file to GLB

Convert a STEP CAD file to a small GLB for the web, on your own computer and for free. The model is never uploaded. Drop it in, check it, export.

A STEP file is how engineers share a design. A web page cannot show one. GLB is the format it can show: a compact 3D file that browsers, AR viewers and most 3D programs open. This page takes you from one to the other with MeshOptimiser, on your own computer. Nothing is uploaded, and there is nothing to pay.

## What you need

- MeshOptimiser, started once. See [What you need](not in this knowledge base) and [Start it the first time](not in this knowledge base).
- Your model as a STEP file (`.step` or `.stp`). If it is still in your CAD program, see [Native CAD files: export a STEP file first](meshoptimiser://docs/cad-files-step-first).

## Steps

1. Start the app with `start.bat` (Windows) or `start.command` (macOS).
2. Drag the STEP file onto the window.
3. In the **Import settings** window, leave everything as it is and press **Import**. **Standard** under **Surface quality** is the recommended choice. See [Open your first file](meshoptimiser://docs/first-file).
4. Wait while the progress card works. A big assembly can take several minutes. Repeated parts are found and stored once, and the result is compressed. Open the same file again later, with the same settings, and it appears at once: the converted model is kept.
5. Look at the model. **Properties** on the right shows how heavy it is. Press `Alt + 1` for the normal view.
6. Press `Ctrl + E` and choose **GLB**. In the Export window, check **Unit scale** and **Up axis** (below).
7. Press **Export GLB**. The file arrives in your downloads folder.

## Two settings that save a second try

- **Unit scale**: CAD models are usually in millimetres, and glTF and most web viewers expect metres. If the model shows up a thousand times too big in the viewer, export again with **× 0.001 (mm → m)**.
- **Up axis**: CAD uses Z as up. glTF uses Y. If the model lies on its back in the viewer, export with **Y-up (glTF, OBJ, Maya)**.

Leave **Draco compression** off unless the viewer you use can read it. See [Which format should I choose](meshoptimiser://docs/choose-format).

## Smoother curves, or fewer triangles

How round a hole looks, and how heavy the GLB is, is decided when the CAD surfaces are turned into triangles. That step is called tessellation. In the **Import settings** window, the four choices under **Surface quality** set it for you. Open **Tessellation** under them to see the numbers, or to type your own.

- **Sag**: How far a triangle may stand off the true surface, in millimetres. Smaller is smoother, with more triangles.
- **Angle**: The most a curve may turn from one triangle to the next, in degrees. Smaller means rounder holes and fillets.
- **Min edge**: The smallest triangle edge allowed. It keeps tiny fillets and threads from filling up with slivers. 0 is no limit.
- **Coarse, Standard, Fine, Ultra**: Each sets a sag and an angle: 1 mm and 30°, 0.5 mm and 30°, 0.2 mm and 20°, 0.05 mm and 12°. The finer choices tighten the angle too, which is what rounds small holes.
- **Custom**: Selected as soon as you type a sag or an angle of your own.
- **By part size**: Small, medium and large parts each get a sag and an angle, so the housing comes in fine and the screws coarse. You set where small ends and large begins, as a share of the model’s size.
- **Smooth shading**: Writes the normals of the real CAD surfaces into the GLB. A fillet runs into the faces beside it without a visible seam, and sharp edges stay sharp. On by default.
- **Swap Y and Z**: In the same window, under Clean-up. For a file that comes in lying on its side.

If the model is too heavy, try a coarser choice here before you reduce triangles afterwards. Fewer triangles at the source usually look better than a fine mesh that was thinned out.

## How small will it be?

It depends on the model. The app’s README gives one example: a 320 MB STEP file became an 11 MB compressed GLB. Assemblies with many identical parts, such as bolts, shrink the most, because each shape is stored once. That is an example, not a promise for every file.

If the GLB is still too heavy, remove what nobody will see before you export. [A sensible order to work in](meshoptimiser://docs/workflow) shows how, and [Fit to budget](meshoptimiser://docs/fit-to-budget) takes a triangle count for the whole scene.

## Without opening the viewer

To convert a file and do nothing else, drag it onto `step2glb.bat` (Windows) or `step2glb.command` (macOS). The GLB is written next to it. Or use the command line:

```
python step2glb.py input.step --meshopt
```

The command line is described in [The command-line converter](not in this knowledge base). Meshopt compression needs the free tool gltfpack on your PATH. If a viewer cannot open a Meshopt-compressed GLB, convert again with `--no-meshopt`, or export from the app instead.

> A common mistake is to send the file from the `inbox` folder. That folder is where the app keeps its working copy. The file you export is the one to send, because it has your clean-up in it.

## Next

To see what the conversion did, read [How to read the numbers](meshoptimiser://docs/read-the-numbers). For the file formats in detail, see [Export](meshoptimiser://docs/export).

Related: [first-file](meshoptimiser://docs/first-file), [export](meshoptimiser://docs/export), [workflow](meshoptimiser://docs/workflow)
