#!/bin/bash
# Quick test harness for step2glb.py on macOS - runs with --force so you can
# see the full Python output even when a cached GLB exists.
set -e
# The folder is not changed here: the path you give means what it means where
# you are. The script's own files are found through DIR.
DIR="$(cd "$(dirname "$0")" && pwd)"

if [ ! -f "$DIR/.venv/bin/python" ] && [ ! -f "$DIR/.venv/bin/python3" ]; then
  echo "  ERROR: .venv missing. Run start.command once first to install."
  read -n 1 -s -r -p "  Press any key to exit..."
  exit 1
fi
# shellcheck disable=SC1091
source "$DIR/.venv/bin/activate"

if [ -z "$1" ]; then
  echo
  echo "  Usage: drop a .step file onto the Terminal after typing"
  echo "         ./test-converter.command  (with a trailing space), then hit Enter"
  echo "         - or run:  ./test-converter.command path/to/file.step"
  echo
  read -n 1 -s -r -p "  Press any key to exit..."
  exit 0
fi

echo
echo "  Running step2glb.py on: \"$1\""
echo "  ====================================================================="
echo
set +e
python "$DIR/step2glb.py" "$1" --force
RC=$?
set -e
echo
echo "  ====================================================================="
echo "  step2glb.py exit code: $RC"
echo
read -n 1 -s -r -p "  Press any key to close..." || true
echo
# the converter's exit code is this script's exit code
exit $RC
