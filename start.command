#!/bin/bash
# MeshOptimiser launcher (macOS). The program lives in the app folder; this
# file only hands over to app/start.command, so double-clicking this one works
# as before. Anything on the command line (a file to open, serve.py options)
# is passed on.
d="$(cd "$(dirname "$0")" && pwd)"
# A zip keeps no execute bits and Finder may have quarantined the download.
xattr -dr com.apple.quarantine "$d" 2>/dev/null || true
exec bash "$d/app/start.command" "$@"
