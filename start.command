#!/bin/bash
# MeshOptimiser launcher (macOS)
# Double-click to start the local server. First run sets up a venv + installs deps.
# From a Terminal:
#   ./start.command               start the app
#   ./start.command part.step     start it and open that file
#   ./start.command --tab         options of serve.py are passed straight on
set -e

# A file named on the command line, as a full path, worked out before the
# folder changes: a path relative to where you are would not be found from the
# project folder. It goes to serve.py as --open (serve.py has no other way to
# be handed a file). Anything that starts with a dash is one of serve.py's own
# options and is passed on as it is.
OPEN=()
if [ $# -gt 0 ] && [ "${1#-}" = "$1" ]; then
  case "$1" in
    /*) SRC="$1" ;;
    *)  SRC="$PWD/$1" ;;
  esac
  shift
  OPEN=(--open "$SRC")
fi
cd "$(dirname "$0")"

# Self-heal the executable bit. Zip files don't preserve Unix execute
# permissions, so a freshly-unzipped start.command often won't run from
# Finder until the user `chmod +x`'s it. Doing it here is a no-op on
# subsequent runs and avoids that confusing first-launch failure mode.
chmod +x "$0" 2>/dev/null || true
chmod +x ./*.command 2>/dev/null || true

# Strip Gatekeeper quarantine flag so macOS doesn't block the script.
xattr -d com.apple.quarantine "$0" 2>/dev/null || true
xattr -dr com.apple.quarantine . 2>/dev/null || true

echo
echo "  MeshOptimiser (macOS)"
echo "  ======================"
echo

# MeshOptimiser needs Python 3.10, 3.11 or 3.12: the versions the CAD library
# it depends on is built for. Any other version is turned down here, with a
# message, instead of failing later in the middle of pip install.
SUPPORTED='import sys; sys.exit(0 if (3,10) <= sys.version_info[:2] <= (3,12) else 1)'

# Sets PY to a supported Python. The numbered names come first, so 3.12 is
# used even where `python3` is something newer (or the old one macOS ships).
pick_python() {
  PY=""
  for c in python3.12 python3.11 python3.10 python3; do
    if command -v "$c" >/dev/null 2>&1 && "$c" -c "$SUPPORTED" >/dev/null 2>&1; then
      PY="$c"
      return 0
    fi
  done
  return 1
}

# 1) Create / repair the virtualenv.
#    A .venv built on Windows (has Scripts/ instead of bin/) is unusable here -
#    detect that case and rebuild.
NEED_VENV=0
if [ ! -d ".venv" ]; then
  NEED_VENV=1
elif [ ! -f ".venv/bin/python3" ] && [ ! -f ".venv/bin/python" ]; then
  echo "  Detected a non-macOS .venv (probably built on Windows). Rebuilding..."
  rm -rf .venv
  NEED_VENV=1
fi

if [ "$NEED_VENV" = "1" ]; then
  # A supported Python to build it with - Homebrew can install one if missing.
  if ! pick_python; then
    if command -v python3 >/dev/null 2>&1; then
      echo "  Found $(python3 --version 2>&1), but MeshOptimiser needs Python 3.10, 3.11 or 3.12."
    else
      echo "  python3 is not installed."
    fi
    if command -v brew >/dev/null 2>&1; then
      echo "  Homebrew is available - installing Python 3.12 (this takes a minute)..."
      if brew install python@3.12 && pick_python; then
        echo "  Python 3.12 installed via Homebrew."
      else
        echo
        echo "  That did not give a usable Python. Install Python 3.12 from"
        echo "  https://www.python.org/downloads/ and double-click this script again."
        read -n 1 -s -r -p "  Press any key to exit..."
        exit 1
      fi
    else
      echo "  Install Python 3.12 from https://www.python.org/downloads/"
      echo "  (or install Homebrew first: https://brew.sh) and double-click"
      echo "  this script again."
      read -n 1 -s -r -p "  Press any key to exit..."
      exit 1
    fi
  fi
  echo "  Creating virtual environment in .venv with $("$PY" --version 2>&1) ..."
  "$PY" -m venv .venv
fi

# 2) Activate + install deps if missing
# shellcheck disable=SC1091
source .venv/bin/activate

# The environment's own Python is the one that runs from here on, so that is
# the one that has to be a supported version (an older .venv may not be).
if ! python -c "$SUPPORTED" >/dev/null 2>&1; then
  echo "  The environment in .venv was made with $(python --version 2>&1)."
  echo "  MeshOptimiser needs Python 3.10, 3.11 or 3.12."
  echo "  Delete the .venv folder and double-click this script again to rebuild it."
  read -n 1 -s -r -p "  Press any key to exit..."
  exit 1
fi

# Upgrade pip + install requirements only when something is missing.
# We re-install any time requirements.txt is newer than the marker file.
MARKER=".venv/.requirements.installed"
if [ ! -f "$MARKER" ] || [ requirements.txt -nt "$MARKER" ]; then
  echo "  Installing/updating Python dependencies..."
  python -m pip install --upgrade pip >/dev/null
  python -m pip install -r requirements.txt
  touch "$MARKER"
fi

# 3) Launch the server (it opens the app's window itself)
echo
echo "  Starting server..."
echo
python serve.py "${OPEN[@]}" "$@"
