#!/bin/bash
# step2glb - convert a STEP/IGES/BREP file to an optimized GLB (macOS).
# Usage from Terminal:  ./step2glb.command path/to/file.step
# (Drag-and-drop onto the icon in Finder doesn't pass the file in macOS the
#  way it does on Windows. From a Terminal you CAN drag the file onto the
#  window after typing the script path.)
set -e
cd "$(dirname "$0")"

if [ ! -f ".venv/bin/python" ] && [ ! -f ".venv/bin/python3" ]; then
  echo "  ERROR: .venv not found. Run start.command once first to install."
  read -n 1 -s -r -p "  Press any key to exit..."
  exit 1
fi
# shellcheck disable=SC1091
source .venv/bin/activate

if [ -z "$1" ]; then
  echo
  echo "  Usage: drop a .step file onto the Terminal after typing"
  echo "         ./step2glb.command  (with a trailing space), then hit Enter"
  echo "         - or run:  ./step2glb.command path/to/file.step"
  echo
  read -n 1 -s -r -p "  Press any key to exit..."
  exit 0
fi

python step2glb.py "$@"
echo
read -n 1 -s -r -p "  Press any key to close..."
