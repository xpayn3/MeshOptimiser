#!/bin/bash
# step2glb - convert a STEP file to an optimized GLB (macOS).
# Usage from Terminal:  ./step2glb.command path/to/file.step [options]
# (Drag-and-drop onto the icon in Finder doesn't pass the file in macOS the
#  way it does on Windows. From a Terminal you CAN drag the file onto the
#  window after typing the script path.)
set -e
# The folder is not changed here: the paths you give (the file, --out) mean
# what they mean where you are. The script's own files are found through DIR.
DIR="$(cd "$(dirname "$0")" && pwd)"

if [ ! -f "$DIR/.venv/bin/python" ] && [ ! -f "$DIR/.venv/bin/python3" ]; then
  echo "  ERROR: .venv not found. Run start.command once first to install."
  read -n 1 -s -r -p "  Press any key to exit..."
  exit 1
fi
# shellcheck disable=SC1091
source "$DIR/.venv/bin/activate"

if [ -z "$1" ]; then
  echo
  echo "  Usage: drop a .step file onto the Terminal after typing"
  echo "         ./step2glb.command  (with a trailing space), then hit Enter"
  echo "         - or run:  ./step2glb.command path/to/file.step"
  echo
  read -n 1 -s -r -p "  Press any key to exit..."
  exit 0
fi

# The converter's exit code is this script's exit code (0 converted, 1 failed,
# 3 nothing in the file to convert). `set -e` is lifted for the one command,
# or a failed conversion would end the script before the code is passed on.
set +e
python "$DIR/step2glb.py" "$@"
RC=$?
set -e
echo
read -n 1 -s -r -p "  Press any key to close..." || true
echo
exit $RC
