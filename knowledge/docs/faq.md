# Frequently asked questions

Short answers: cost and licence, privacy, browsers, file sizes, whether Python is needed, and where to report a bug.

## Is it free?

Yes. MeshOptimiser is free and open source.

## What is the licence?

MIT. In short, you may use, copy and change it, also for commercial work, as long as the licence text stays with it. It comes with no warranty.

## Can I send the exported file to a customer?

Yes, once you have taken out what they should not see. See [How to make a CAD model safe to send to a customer](meshoptimiser://docs/make-model-safe-to-send).

## Does my file leave my computer?

No. The viewer and the converter both run on your machine. See [Privacy and offline use](meshoptimiser://docs/privacy-offline).

## Do I need an internet connection?

Only for the first start, which downloads the Python add-ons. After that the app runs offline, and so does the help window (`F1`). A few rarely used converters are fetched the first time they are needed.

## Which browsers work?

A recent Chrome, Edge, Firefox or Safari. The viewer uses WebGPU and falls back to WebGL2. For the app to open in a window of its own, the launcher needs Chrome, Edge or Brave. Installing it as an app is offered by Chrome and Edge.

## Which systems does it run on?

Windows and macOS.

## Can I use it without Python?

No. The app is served by a small Python program on your computer, and STEP files are converted in Python. On Windows, the launcher offers to install Python for you if it is missing.

## Which Python version?

3.10, 3.11 or 3.12. Version 3.13 is not supported yet.

## How big a file can it handle?

There is no fixed limit in these pages, because it depends on your computer’s memory and graphics card. The app is tested on assemblies of thousands of parts and millions of triangles. The README’s example is a 320 MB STEP file. The local server accepts STEP files up to 4 GB.

## Does it change my original file?

No. Nothing reaches a file until you save a scene or export, and both write a new file.

## Can it open SolidWorks, Inventor, Creo or CATIA files?

Not the files those programs save for themselves. Export a STEP file from your CAD program first. See [Native CAD files: export a STEP file first](meshoptimiser://docs/cad-files-step-first).

## Can it write STEP files?

No. It reads STEP and writes mesh formats: GLB, glTF, FBX, USDZ, OBJ, STL and PLY, and a parts list as CSV.

## Where is the converted file?

In the folder `inbox` inside the app folder. To put a file where you want it, save a scene or export.

## Can I undo everything?

Every editing action can be undone with `Ctrl + Z`. By default the history goes back 200 steps, and **Settings**, **General** can make it 50 or 500. **Revert to source…** in the **Menu** reloads the file as it was. See [Undo and redo](meshoptimiser://docs/undo-redo).

## Why do I have to start it with a launcher?

Because the converter is a Python program, and a web page cannot start one. The launcher starts a small local server that connects the two.

## How do I update?

Download the new zip and unpack it into a new folder. See [Stop, restart and update](not in this knowledge base).

## Where do I find help inside the app?

Press `F1`. The help window holds these same articles, with a search. See [The help window](not in this knowledge base).

## Where do I report a bug or ask for a feature?

On the [Report a problem](https://lukagrcar.com/apps/meshoptimiser/report.html) page. The app’s mark in the top bar has a link called **Report a problem** that opens it with your version and system already filled in. Say what you did, what you expected and what happened, and add the version number and the log. **Settings**, **About**, **Copy details** copies the version number, your browser and your graphics card for you.

Related: [troubleshooting](meshoptimiser://docs/troubleshooting), [privacy-offline](meshoptimiser://docs/privacy-offline), [what-it-is](meshoptimiser://docs/what-it-is)
