# How to export a STEP assembly from Autodesk Inventor

Save an Inventor assembly as one STEP file with Save Copy As, pick AP214, and learn what Shrinkwrap can do for a very large assembly.

Inventor writes STEP with Save Copy As. When you save an assembly this way, the assembly and all the parts it refers to go into a single file, which is what MeshOptimiser wants.

## Steps

1. Open the assembly (the `.iam` file).
2. Choose **File**, **Save As**, then **Save Copy As**.
3. In **Save as type**, choose the STEP files entry (`*.stp`, `*.ste`, `*.step`).
4. Click **Options**. The STEP options window opens.
5. Under the application protocol, choose **214**.
6. Leave the spline fit accuracy as it is, press **OK**, name the file and press **Save**.

## What the choices mean

- **203**: Configuration Controlled Design. The plain protocol, without colours.
- **214**: Automotive Design. The one to choose here, because it also carries colours and layers.
- **242**: Managed Model Based 3D Engineering. It includes product manufacturing information. Inventor does not offer it for assemblies.
- **Spline fit accuracy**: How closely curves are approximated, between 0.00001 cm and 0.001 cm. A smaller value is more exact and makes a bigger file. The default is fine.

## If the assembly is very large

Inventor has a command called Shrinkwrap that builds a single simplified part from an assembly. One of its options, **Remove internal parts**, is on by default. It looks at the model from 14 directions and drops the parts that cannot be seen, which is close to what **Select hidden parts** does in MeshOptimiser. You can export the shrinkwrapped part as STEP instead of the full assembly. Autodesk’s help describes the command under “Create a Shrinkwrap part”.

You do not have to do this. MeshOptimiser finds the hidden parts itself, so the full assembly works too. Shrinkwrap is useful when the full assembly is too big for your computer to export or convert comfortably, or when you want a simplified part for other reasons.

> If your version of Inventor looks different, search Autodesk’s help for “Save As Export Options”.

## Next

Open the file in MeshOptimiser: see [Open your first file](meshoptimiser://docs/first-file). To take out the hidden parts there, see [Select hidden parts](meshoptimiser://docs/select-hidden-parts).

Related: [cad-files-step-first](meshoptimiser://docs/cad-files-step-first), [select-hidden-parts](meshoptimiser://docs/select-hidden-parts), [convert-step-to-glb](meshoptimiser://docs/convert-step-to-glb)
