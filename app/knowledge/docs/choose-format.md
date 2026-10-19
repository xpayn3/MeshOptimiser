# Which format should I choose

A short guide by purpose: the web, Blender, game engines, AR on an iPhone, 3D printing, or a parts list.

If you are not sure, export GLB. It is one file, it is compact, and it keeps the parts tree, the materials and the colours. The app’s own format sheet calls it the best all-round choice.

- **A web page or a web viewer**: GLB. Switch on **Draco compression** only if the viewer you use can read it.
- **Blender or another 3D program**: FBX.
- **Unreal**: FBX. The app lists Unreal under FBX.
- **Unity**: The app does not name Unity for any format. FBX is the usual choice for game engines.
- **AR on an iPhone or iPad**: USDZ, the format of Apple Quick Look.
- **3D printing**: STL. Switch on **Merge into one mesh** if the printer software wants one object.
- **A program that reads nothing else**: OBJ. It is understood almost everywhere, but it carries no hierarchy: the tree is flattened into the names of the parts.
- **Research or scanning tools**: PLY, which holds geometry and a colour for every vertex.
- **A list of parts for a spreadsheet**: CSV.
- **Carrying on later in MeshOptimiser**: Not an export at all: [Save a scene](meshoptimiser://docs/save-scene).

## What each format keeps

- **GLB and glTF**: The parts tree, full materials, vertex colours.
- **FBX**: The parts tree and materials. No vertex colours.
- **USDZ**: The parts tree and materials. No vertex colours.
- **OBJ**: Materials through a separate `.mtl` file. A flat list of parts, no tree.
- **STL**: Geometry only, as a single mesh. No colours.
- **PLY**: Geometry as a single mesh, with vertex colours.
- **CSV**: No geometry.
- **A part with several colours**: Keeps all of them in GLB, glTF, OBJ, FBX and USDZ, and as colours on the points in PLY. STL holds no colour.

## Two settings that go with the format

- Scale. A CAD model is usually in millimetres. Many 3D programs and the glTF format work in metres. The default, **The format’s own**, already writes GLB, glTF and USDZ in metres. If the next program still shows the model at the wrong size, set **Unit scale** by hand, for example **× 0.001 (mm → m)**.
- Up axis. CAD uses Z as up. glTF and OBJ use Y. The default, **The format’s own**, writes GLB, glTF, USDZ and OBJ Y up and FBX, STL and PLY Z up. If the model still arrives lying down, try the other choice, **Turn Z-up into Y-up** or **Keep as in the scene**.

> These are safe starting points. The program you are exporting to has the last word, so do one test export before you spend time on the model.

Related: [export](meshoptimiser://docs/export), [file-formats](meshoptimiser://docs/file-formats), [save-scene](meshoptimiser://docs/save-scene)
