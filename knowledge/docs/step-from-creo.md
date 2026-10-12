# How to export a STEP assembly from PTC Creo

Save a Creo assembly as one STEP file with Save a Copy, set the application protocol and keep Export assembly as on Single File.

Creo exports STEP with Save a Copy. The settings live in a window called STEP Export Profile Settings.

## Steps

1. Open the assembly.
2. Choose **File**, **Save As**, then **Save a Copy**.
3. In the **Type** list, choose **STEP (*.stp)**.
4. Enter a file name, or accept the default.
5. Click **Options**. The editor **STEP Export Profile Settings** opens.
6. Set **Application protocol** to **ap214_is**.
7. Check that **Export assembly as** is on **Single File**. That is the default.
8. Press **OK** in the editor, and **OK** in the Save a Copy window.

## What the choices mean

- **Application protocol**: Creo lists ap202_is, ap203_is (the default), ap203_is_ext, ap203_e2, ap209_dis, ap214_is, ap242 and ap242_e3. ap214_is is the AP214 protocol, the one that adds colours and layers in other CAD programs. Open the result in MeshOptimiser and check that the colours came through.
- **Export assembly as: Single File**: Writes all the geometry of the assembly into one file. This is what MeshOptimiser needs.
- **Export assembly as: Separate Parts**: Writes the structure to one file and every part as a file of its own. Do not use it for this.
- **Export assembly as: Separate All**: Writes the assembly, every sub-assembly and every part as files of their own. Do not use it for this.

The **Export assembly as** choice appears when the application protocol is ap214_is, ap203_e2, ap242 or ap242_e3. PTC’s help says Separate Parts and Separate All are offered only for those protocols.

## Other things in the export

- Tick **Customize Export** in the Save a Copy window if you want to choose which layers go in, or the coordinate system. The defaults are fine to begin with.
- The profile can be saved and loaded again with **Load Profile**, so you set it up once.

## If the assembly is very large

Work on a copy, remove what you will not show, such as hardware inside housings, and export that. A smaller file converts faster. See also [Troubleshooting](meshoptimiser://docs/troubleshooting) for ways to speed up the conversion.

> Menus differ between Creo releases. If yours does, search PTC’s help for “Exporting Part or Assembly to STEP”.

## Next

Open the file in MeshOptimiser: see [Open your first file](meshoptimiser://docs/first-file).

Related: [cad-files-step-first](meshoptimiser://docs/cad-files-step-first), [first-file](meshoptimiser://docs/first-file), [convert-step-to-glb](meshoptimiser://docs/convert-step-to-glb)
