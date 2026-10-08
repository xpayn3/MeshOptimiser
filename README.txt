MeshOptimiser - quick start
============================

ONE CLICK:

  Windows : double-click  start.bat
  macOS   : double-click  start.command

That's it. The script will:
  - check Python is installed (auto-installs via winget on Windows or
    Homebrew on macOS if missing)
  - create a local Python virtual environment (.venv/)
  - install Python dependencies (cadquery-ocp, trimesh, numpy)
  - start the local server and open the app in a window of its own
    (Chrome, Edge or Brave; without one of those it opens in a tab of
    your default browser). For an ordinary tab:  python serve.py --tab

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
      Delete the .venv folder and run start.bat / start.command again
      to rebuild the environment from scratch.

  "MeshOptimiser needs Python 3.10, 3.11 or 3.12"
      The launcher found another version. On Windows it offers to install
      3.12 next to the one you have. On macOS it installs 3.12 through
      Homebrew when Homebrew is there; without it, install Python 3.12
      from python.org and start again. If the message is about the
      .venv folder, delete that folder first.


WHAT'S INCLUDED:

  start.bat / start.command    one-click launchers
  start_hidden.vbs             start.bat without the console window (Windows)
  step2glb.py                  STEP -> GLB converter (Python + OCCT)
  serve.py                     local HTTP server + /api/convert endpoint
  index.html, app-v2.js        the WebGPU viewer
  cloner.js                    cloner (linear / grid / radial arrays)
  holefill.js                  hole filler
  mesh-worker.js               background worker for Fill holes and Decimate

  step2glb.bat / .command      direct CLI converter (no viewer)
  test-converter.bat / .command  smoke-test the converter
