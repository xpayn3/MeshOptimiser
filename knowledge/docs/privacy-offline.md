# Privacy and offline use

MeshOptimiser runs on your own computer. What stays local, when the internet is used, and what the browser remembers.

## Your files stay on your computer

MeshOptimiser is not an online service. The viewer runs in your browser, and the converter runs in Python on your machine. The local server answers only on your own computer, at an address that starts with `localhost`.

When you drop a STEP file, the page hands it to that local server, which converts it in the app’s `inbox` folder. The file does not go anywhere else. There is no account and no sign-in.

## When the internet is used

- **The first start**: The launcher downloads the Python add-ons the converter needs (cadquery-ocp, trimesh, numpy). If Python itself is missing and you agree, it downloads Python too.
- **Every later start**: Nothing. The libraries the viewer needs are bundled in the `vendor` folder, so the app opens, edits and exports with no connection at all.
- **A few rarely used converters**: Fetched from the internet the first time they are needed: the transcoder for compressed textures, and the converters behind Draco export and some older FBX files.

## What the browser remembers

The app keeps a few things in your browser’s storage, on this computer:

- your settings;
- the list of recent files, with a small picture of each;
- permission to reopen a recent file without asking where it is;
- the sizes of the sidebars and docks.

You can clear each of these under **Settings**, **Storage**. Because they live in the browser’s profile, they survive an update of the app, and they are separate for each browser you use.

## What is written to disk

- Converted GLB files, in the `inbox` folder.
- Scenes you save and files you export, where you choose.
- The Python environment, in `.venv`.

Related: [requirements](not in this knowledge base), [files-in-folder](not in this knowledge base), [settings](meshoptimiser://docs/settings)
