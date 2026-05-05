#!/bin/bash
# STEP Optimizer launcher (macOS)
# Double-click to start the local server. First run sets up a venv + installs deps.
set -e
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
echo "  STEP Optimizer (macOS)"
echo "  ======================"
echo

# 1) Make sure python3 is available - try a brew auto-install if missing.
if ! command -v python3 >/dev/null 2>&1; then
  echo "  python3 is not installed."
  if command -v brew >/dev/null 2>&1; then
    echo "  Homebrew is available - installing Python 3 (this takes a minute)..."
    if brew install python; then
      echo "  Python installed via Homebrew."
    else
      echo
      echo "  Homebrew install failed. Install Python manually from"
      echo "  https://www.python.org/downloads/ and double-click this script again."
      read -n 1 -s -r -p "  Press any key to exit..."
      exit 1
    fi
  else
    echo "  Homebrew is not installed either. Install Python from"
    echo "  https://www.python.org/downloads/  (or install Homebrew first:"
    echo "  https://brew.sh) and double-click this script again."
    read -n 1 -s -r -p "  Press any key to exit..."
    exit 1
  fi
fi

# 2) Create / repair the virtualenv.
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
  echo "  Creating virtual environment in .venv ..."
  python3 -m venv .venv
fi

# 3) Activate + install deps if missing
# shellcheck disable=SC1091
source .venv/bin/activate

# Upgrade pip + install requirements only when something is missing.
# We re-install any time requirements.txt is newer than the marker file.
MARKER=".venv/.requirements.installed"
if [ ! -f "$MARKER" ] || [ requirements.txt -nt "$MARKER" ]; then
  echo "  Installing/updating Python dependencies..."
  python -m pip install --upgrade pip >/dev/null
  python -m pip install -r requirements.txt
  touch "$MARKER"
fi

# 4) Launch the server (it opens the browser itself)
echo
echo "  Starting server..."
echo
python serve.py "$@"
