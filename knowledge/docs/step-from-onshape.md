# How to export a STEP assembly from Onshape

Export an Onshape assembly or Part Studio as STEP by right-clicking its tab, and why STEP is a better start than Onshape’s own glTF export.

Onshape works in the browser, and so does its export. You export from the tab at the bottom of the window.

## Steps

1. Open your model. For a whole assembly, open the Assembly tab. For parts, open the Part Studio.
2. Right-click the tab at the bottom of the window and choose **Export**.
3. Choose **STEP** as the format.
4. Check the options (below). The defaults are fine for a first try.
5. Choose how you want the file: **Download** saves it to your computer.
6. Press **Export**.

In an assembly, the tab’s Export writes the whole assembly at once.

## The options that matter

- **Use latest version**: On by default. The latest supported version of STEP is written.
- **Use custom units for export**: STEP only. Choose Millimeter, Centimeter, Meter, Inch or Foot. Millimetres are the usual choice for CAD.
- **Preprocessing**: STEP only. Options to remove small entities or to convert all surfaces to b-surfaces before export. Leave it as it is.

## Why STEP and not glTF

Onshape can also export glTF and GLB directly. People on Onshape’s own forum report that this export writes a separate mesh for every face of a part, which is slow to draw in real-time viewers. Exporting STEP and letting MeshOptimiser build the mesh avoids that, and it lets MeshOptimiser find the copies of repeated parts.

> If Onshape’s dialog looks different in your version, search its help for “Exporting files”.

## Next

Open the file in MeshOptimiser: see [Open your first file](meshoptimiser://docs/first-file).

Related: [cad-files-step-first](meshoptimiser://docs/cad-files-step-first), [first-file](meshoptimiser://docs/first-file), [convert-step-to-glb](meshoptimiser://docs/convert-step-to-glb)
