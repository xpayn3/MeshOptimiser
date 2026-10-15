# Words you will meet

A plain-language glossary: STEP, mesh, triangle, GLB, instancing, decimation, WebGPU, virtual environment and the other terms these pages use.

You do not need to learn these before you start. Come back to this page when a word is new.

## Files and formats

- **CAD**: Computer-aided design. The programs engineers use to design real objects, such as SolidWorks or NX.
- **STEP (.step, .stp)**: A file format for exchanging CAD designs between programs. It stores exact surfaces, part names, colours and how the parts fit together.
- **GLB**: A compact 3D file made of triangles, with colours and part names inside one file. Browsers and most 3D programs can open it. This is the format MeshOptimiser writes by default.
- **glTF**: The same format as GLB, written as readable text. The app’s own format sheet describes it as the same capabilities, larger.
- **FBX, OBJ, STL, PLY, USDZ, 3MF**: Other 3D file formats. [File formats](meshoptimiser://docs/file-formats) says what each one is for.
- **XCAF**: The part of a STEP file that holds names, colours and the assembly tree. You see the word in the import settings.

## What a model is made of

- **Part**: One piece of the model: a bolt, a cover, a bracket. Each part has a row in the parts tree.
- **Assembly**: A model made of many parts, often arranged in groups inside groups.
- **Group**: A folder in the parts tree. It holds parts or other groups.
- **Mesh**: The surface of a part, built from many small flat triangles.
- **Triangle (tri)**: The smallest piece of a mesh. The app counts everything in triangles: more triangles mean a heavier model.
- **Polygon (n-gon)**: A flat face with any number of corners. Several triangles that lie in one plane can be joined into one polygon. [Remesh](meshoptimiser://docs/remesh) does that, and turns polygons back into triangles. In [Edit mesh](meshoptimiser://docs/edit-mesh), two triangles that make a four-sided shape count as one polygon.
- **Vertex**: A corner point of a triangle. The plural is vertices. In [Edit mesh](meshoptimiser://docs/edit-mesh) it is called a point.
- **Edge**: The line between two points where two polygons meet, or where a surface ends.
- **Loop**: A row of polygons or edges that runs round a part, like a ring round a tube. [Edit mesh](meshoptimiser://docs/edit-mesh) picks one with a double-click.
- **Normal**: A hidden arrow on the surface that tells the light which way the surface faces. Wrong normals make a part look oddly shaded.
- **Bounding box (bbox)**: The smallest box that a part fits inside. The app uses it to measure how big a part is.
- **Origin and pivot**: The origin is the point 0,0,0 of the scene. A pivot is the point a part turns around.
- **Material**: What a surface looks like: its colour and how shiny or metallic it is. Many parts can share one material.

## What the app does to a model

- **Tessellation**: Turning the exact curved surfaces of a CAD file into triangles. Finer tessellation means smoother curves and more triangles.
- **Instancing**: Storing one mesh for a shape that repeats, plus the list of places where it sits. 400 identical bolts become one bolt and 400 positions.
- **Decimation**: Removing triangles from a mesh while keeping its overall shape. It is lossy: detail that is removed does not come back, except through undo.
- **Lossy**: An action that throws detail away to save size.
- **Compression**: Packing the same data into a smaller file. Meshopt and Draco are two methods for 3D files.
- **Meshopt**: A compression method for GLB files. The converter applies it through a separate tool called gltfpack, when that tool is installed.
- **Draco**: Another compression method for GLB files. It is a switch in the Export window.
- **Scene**: Everything in one tab of the app: the parts, their materials, the camera and the undo history.
- **BOM**: Bill of materials: a parts list. The CSV export writes one.

## The screen

- **Viewport**: The large 3D view in the middle of the window.
- **Parts tree**: The list of parts and groups in the left sidebar.
- **Gizmo**: The coloured arrows, rings or handles that appear on a selected part, for moving, rotating or scaling it. In Edit mesh it moves the picked points, edges or polygons instead.
- **Orbit, pan, zoom**: Turning the view around the model, sliding it sideways, and moving closer or further away.
- **Isolate**: Showing only the selected parts and hiding everything else for a moment.
- **Edit mesh**: A mode in which you pick and change the points, edges and polygons of a part instead of whole parts. See [Edit mesh](meshoptimiser://docs/edit-mesh).
- **Bake geo**: A button in **Properties** that turns a library shape into an ordinary mesh. The shape’s numbers go, and the mesh tools work on it. See [The parts library](meshoptimiser://docs/library).
- **Align and spread**: Lining parts up on one side or the middle along an axis, or spacing them evenly. See [Align parts](meshoptimiser://docs/align-parts).
- **Dissolve, weld**: Two Edit mesh tools. Dissolve takes pieces out and closes the surface over them. Weld makes several points one.
- **Shortcut profile**: A named set of keys that you changed. The app’s own keys are the Default profile, which cannot be changed. See [Keyboard shortcuts](meshoptimiser://docs/shortcuts).
- **Draw call**: One instruction to the graphics card to draw something. Fewer draw calls usually mean a smoother view. The optimisation report counts them.

## The technical side

- **Python**: A programming language. The converter and the small local server are written in it, so Python has to be installed.
- **Virtual environment (.venv)**: A private folder of Python add-ons that belongs to this app only. The launcher creates it inside the `app` folder the first time, so nothing else on your computer is changed.
- **Terminal**: A window where you type commands. On Windows it is called Command Prompt or PowerShell, on macOS it is called Terminal.
- **Local server**: A small program on your own computer that hands the app’s pages to your browser. Its address is normally `http://localhost:4242`. Localhost means this computer.
- **PATH**: The list of folders where your computer looks for programs. Python has to be on it for the launcher to find it.
- **WebGPU**: The modern way for a browser to use the graphics card. The viewer uses it when the browser has it.
- **WebGL2**: An older way to do the same. The viewer uses it when WebGPU is not available.
- **Installing the app (PWA)**: Chrome and Edge can add a web page to your desktop and Start menu as if it were a program. A page that supports this is called a progressive web app, or PWA.

Related: [what-it-is](meshoptimiser://docs/what-it-is), [file-formats](meshoptimiser://docs/file-formats), [read-the-numbers](meshoptimiser://docs/read-the-numbers)
