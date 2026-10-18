# Troubleshooting

Fixes for the usual problems: Python not found, a blocked launcher on macOS, missing modules, a blank view and slow conversions.

Find the heading that matches what you see. If nothing here helps, use [Report a problem](https://xpayn3.github.io/MeshOptimiser/report.html). It asks for what I need and packs it into one file. Say which version you have, and add the log: **Copy log** on the progress card, or the copy button in the console. In **Settings**, **About**, the button **Copy details** copies the version, your browser and your graphics card in one go.

## “python is not on PATH” on Windows

Windows cannot find Python. Run the Python installer again and tick “Add Python to PATH”. Or close and reopen the terminal or the launcher, so the new PATH is picked up. See [What you need](not in this knowledge base).

## “Operation not permitted” on macOS

Right-click `start.command` and choose “Open”. macOS blocks a double-click on a freshly unzipped script the first time.

## “ModuleNotFoundError: No module named ‘OCP’”

The Python environment is incomplete. The same goes for a missing `numpy` or `trimesh`. Quit the app, delete the folder `.venv` inside the app folder, and start the launcher again. It rebuilds the environment from scratch.

## The first run stops while installing

- Check your internet connection. The first run has to download the add-ons.
- Check your Python version. The converter needs 3.10, 3.11 or 3.12. With 3.13 the add-ons cannot be installed. Install a supported version, delete the folder `.venv` if one was created, and start again.
- Check that the drive has about 2 GB free.

## “This page needs a local server”

You opened `index.html` directly. Browsers do not let the app run that way. Start it with `start.bat` or `start.command`, and use the address the launcher prints, normally `http://localhost:4242`.

## The app window is empty, or the browser cannot reach the page

The local server is not running. This happens when you open the installed app or a bookmark without starting the launcher first, or after you closed the launcher window. Start the launcher again.

## The address is not localhost:4242

Something else on your computer was already using port 4242, so the server chose another one. That is fine. The launcher window prints the address it is using.

## The app starts twice

If the app is already running, starting the launcher again does not start a second copy. It opens a window on the one that is running.

## The app opened in a normal browser tab

The launcher found no Chrome, Edge or Brave, so it used your default browser. The app works the same in a tab.

## The window looks squeezed, or has scroll bars

The window cannot be smaller than 960 by 560 pixels. In a smaller window the app scrolls instead of squeezing its panels. Make the window bigger, or drag the edge of a sidebar to make the sidebar narrower. The left one cannot go under 220 pixels and the right one not under 240. See [The window](meshoptimiser://docs/the-window).

## The 3D view is empty or looks wrong

- Press `F` to frame the model, and `Alt + H` to show hidden parts.
- The viewer uses WebGPU when the browser has it and falls back to WebGL2 when it does not. To switch by hand, open **Settings**, **Performance** and set **Renderer** to WebGL2. The page reloads.
- If a message says the GPU was lost, reload the page.
- Update your browser and your graphics driver.

## A STEP conversion takes very long

Large assemblies take time, and the reading of names, colours and the tree is the slowest part. The progress card keeps showing the converter’s latest message while it works. To make it faster, change the import settings:

- Under **What to read**, leave **Instance overrides**, **Keep layers** and **Validation properties** off.
- Choose a coarser **Surface quality**.
- Set **Drop small parts** above 0 to skip tiny fasteners.
- For a huge file where you only need the shape, choose **Geometry only** under **Colours and structure**.

**Cancel** on the progress card stops a conversion that is running.

## “Conversion failed”

A STEP file with nothing solid in it gets a plain message that says so. For any other failure, press **Copy log** on the progress card and read the last lines. To see everything the converter prints, drag the STEP file onto `test-converter.bat` or `test-converter.command`. Include the log when you report the problem.

When the conversion fails because a Python package is not installed, the log and the notice name the package and the command that installs it: `python -m pip install -r requirements.txt`.

## The model has no colours or no parts tree

A STEP file may have been converted with geometry only. Open it again and choose **Colours & hierarchy** under **Colours and structure**. A GLB, FBX, OBJ or STL file can only show what the file itself contains.

## The view stutters on a heavy model

- Open **Settings**, **Performance**. Keep **Skip tiny parts** and **Lower the resolution if it stutters** on, and try **Quality** on Low.
- Make the model lighter. See [A sensible order to work in](meshoptimiser://docs/workflow).

## Small parts disappear while I turn the view

That is **Skip tiny parts** at work. They come back the moment the view stops. Switch it off under **Settings**, **Performance** if you prefer.

## A recent file asks me to pick it again

The browser needs a fresh permission before the app may read that file. Open it once more with **Open file…**, or drop it on the window.

## The exported model is the wrong size or lies on its side

Export again with a different **Unit scale** or the other **Up axis**. A model that came from Cinema 4D or a glTF already stands Y up, so choose **Keep as in the scene** for it. See [Export](meshoptimiser://docs/export).

## Cinema 4D or Maya cannot open an FBX I exported long ago

FBX files written by versions before 0.14.0 are refused by the FBX software in Cinema 4D and Maya. Export the file again with this version, or open it in Blender and save it again.

## An export fails on a very large model

Text formats such as OBJ can run out of memory. Use GLB or STL, which are binary.

## I closed the window and the app is still running

Closing the window does not stop the server. Close the launcher window too, or next time use **Menu**, then **Quit app**.

Related: [requirements](not in this knowledge base), [first-start](not in this knowledge base), [faq](meshoptimiser://docs/faq), [self-test](not in this knowledge base), [crash-recovery](meshoptimiser://docs/crash-recovery)
