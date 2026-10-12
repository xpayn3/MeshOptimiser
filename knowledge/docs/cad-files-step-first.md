# Native CAD files: export a STEP file first

MeshOptimiser opens STEP, not SolidWorks, Inventor, Creo or CATIA files. Why, which STEP version to pick, and where to find the steps for your program.

MeshOptimiser reads STEP files. It does not read the files your CAD program saves for itself, such as SolidWorks (`.sldprt`, `.sldasm`), Inventor (`.ipt`, `.iam`), Creo (`.prt`, `.asm`), Fusion (`.f3d`), Rhino (`.3dm`), CATIA or NX files. Those formats belong to the company that made the program, and reading them needs that company’s own software, which a free app cannot include.

Almost every CAD program can write STEP, and STEP is the one format they all share. So the job is always the same: open your model in your CAD program, save a copy as STEP, and open that copy in MeshOptimiser.

## Pick your program

- [Autodesk Inventor](meshoptimiser://docs/step-from-inventor)
- [Onshape](meshoptimiser://docs/step-from-onshape)
- [PTC Creo](meshoptimiser://docs/step-from-creo)
- [Rhino](meshoptimiser://docs/step-from-rhino)

Using something else, such as NX, CATIA or Solid Edge? Look for Export or Save As in its File menu and choose STEP. The ideas below apply to any program.

## What a STEP file keeps, and what it leaves behind

- **Kept**: The exact shape of every part, the assembly tree with the names of the parts, and the colours, if the STEP version you choose carries them.
- **Left behind**: The feature tree, sketches, dimensions and the history of how the part was made.

## Which STEP version to choose

Many programs ask for an “application protocol”, a short code for how much information goes into the file.

- **AP203**: The plain one: geometry, the structure and configuration data. No colours and no layers.
- **AP214**: Everything AP203 has, plus colours and layers. This is the usual choice for MeshOptimiser, because the colours arrive.
- **AP242**: The newest. It merges AP203 and AP214 and adds more manufacturing information. Not every program offers it, and some do not offer it for assemblies.

If your program offers AP214, choose it. If it does not, use whatever it calls its normal STEP export and check the colours after opening the file.

## Export the whole assembly into one file

MeshOptimiser opens one file. Several programs can also write an assembly as a top-level file plus one file per part. Leave that switched off, so that everything is in one STEP file.

## If you cannot get a STEP file

Export a mesh instead, as OBJ, FBX, STL or GLB. MeshOptimiser opens those directly. You lose something: the copies of a repeated part are found when a STEP file is converted, so a mesh file arrives with every copy as a mesh of its own, and the model is heavier to start with.

> Menu names change a little from one version of a CAD program to the next. If your screen differs from these steps, search your program’s own help for “export STEP”.

Related: [first-file](meshoptimiser://docs/first-file), [file-formats](meshoptimiser://docs/file-formats), [convert-step-to-glb](meshoptimiser://docs/convert-step-to-glb)
