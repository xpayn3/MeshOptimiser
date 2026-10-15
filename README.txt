MeshOptimiser - quick start
============================

ONE CLICK:

  Windows : double-click  start.bat
  macOS   : double-click  start.command

That's it. The script will:
  - check Python is installed (auto-installs via winget on Windows or
    Homebrew on macOS if missing)
  - create a local Python virtual environment (app/.venv/)
  - install Python dependencies (cadquery-ocp, trimesh, numpy)
  - start the local server and open the app in a window of its own
    (Chrome, Edge or Brave; without one of those it opens in a tab of
    your default browser). For an ordinary tab:  python app/serve.py --tab

To start it and open a file in one go, drop a .step / .glb file on
start.bat, or from a terminal:  start.bat part.step   (./start.command part.step)

First run takes ~3 minutes (downloads + builds dependencies).
Every run after that is 1-2 seconds - the venv is reused.


REQUIREMENTS:

  - Python 3.10, 3.11, or 3.12 (3.13 not yet supported by cadquery-ocp)
  - About 2 GB of free disk for the .venv on first install
  - A modern browser (Chrome, Edge, Firefox, Safari)


TROUBLESHOOTING:

  "python is not on PATH" on Windows
      Re-run the Python installer and tick "Add Python to PATH",
      or close + reopen the terminal so the new PATH is picked up.

  "Operation not permitted" on macOS
      Right-click start.command -> Open. macOS Gatekeeper may block
      double-click on a freshly-unzipped script the first time.

  "ModuleNotFoundError: No module named 'OCP'"  (or 'numpy', 'trimesh')
      Delete the app\.venv folder and run start.bat / start.command again
      to rebuild the environment from scratch.

  "MeshOptimiser needs Python 3.10, 3.11 or 3.12"
      The launcher found another version. On Windows it offers to install
      3.12 next to the one you have. On macOS it installs 3.12 through
      Homebrew when Homebrew is there; without it, install Python 3.12
      from python.org and start again. If the message is about the
      app\.venv folder, delete that folder first.


WHAT'S INCLUDED:

  start.bat / start.command    one-click launchers (they hand over to app/)
  start_hidden.vbs, start.ico  the shortcut launcher without a console window (Windows)
  Install MeshOptimiser.bat    the Windows installer
  app/                         the program:
    start.bat, start.command, start_hidden.vbs, ui.ps1   the real launchers
    step2glb.py                STEP -> GLB converter (Python + OCCT)
    serve.py                   local HTTP server + /api/convert endpoint
    index.html                 the WebGPU viewer
    js/                        its scripts: app.js, mesh-worker.js, holefill.js, cloner.js ...
    vendor/, assets/, knowledge/   libraries, pictures, what Claude reads
    step2glb.bat / .command    direct CLI converter (no viewer)
    test-converter.bat / .command  smoke-test the converter
    .venv/, inbox/, exports/   made on this PC (the environment, your models, your exports)
