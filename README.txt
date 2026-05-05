STEP Optimizer - quick start
============================

ONE CLICK:

  Windows : double-click  start.bat
  macOS   : double-click  start.command

That's it. The script will:
  - check Python is installed (auto-installs via winget on Windows or
    Homebrew on macOS if missing)
  - create a local Python virtual environment (.venv/)
  - install Python dependencies (cadquery-ocp, trimesh, numpy, ...)
  - launch the local server and open your browser to the viewer

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

  "ModuleNotFoundError: cadquery"
      Delete the .venv folder and run start.bat / start.command again
      to rebuild the environment from scratch.


WHAT'S INCLUDED:

  start.bat / start.command    one-click launchers
  step2glb.py                  STEP -> GLB converter (Python + OCCT)
  serve.py                     local HTTP server + /api/convert endpoint
  index.html, app-v2.js        the WebGPU viewer

  step2glb.bat / .command      direct CLI converter (no viewer)
  test-converter.bat / .command  smoke-test the converter
