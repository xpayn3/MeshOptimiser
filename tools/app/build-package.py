#!/usr/bin/env python3
"""Build the full download: MeshOptimiser-v<version>.zip, what the website's Download button and install.ps1 fetch.

    python tools/app/build-package.py                  # into dist/, version from app/version.json
    python tools/app/build-package.py --out some/dir
    python tools/app/build-package.py --with-runtime   # the Windows download with Python and every package inside: MeshOptimiser-v<version>-windows.zip

The zip holds the install folder as it is meant to look: the thin launchers (start.bat, start_hidden.vbs, start.command,
start.ico, Install MeshOptimiser.bat), README.md, README.txt, LICENSE and the app/ folder, with the files at the root of the
zip (unpacking it with "Extract all" makes one folder named after the zip). Left out: tests/, tools/, docs/, site/, .github/,
dist/, the changelog and the release notes, the test-converter scripts, and everything git ignores (.venv, inbox, exports ...).
It is built from the tracked files of the working tree (what git archive would pack, plus staged changes). Nothing is uploaded:
attach the zip to the GitHub release https://github.com/xpayn3/MeshOptimiser/releases/tag/v<version>.
"""
from __future__ import annotations
import argparse, json, subprocess, sys, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
SKIP_DIRS = {"tests", "tools", "docs", "site", "dist", ".github", "_archive", "__pycache__", ".claude", ".update"}
SKIP_FILES = {"changelog.md", "unreleased_fixes.md", ".gitignore", ".gitattributes", "claude.md", "server.log"}
SKIP_GLOBS = ("RELEASE_NOTES_", "test-converter.")


def files() -> list[str]:
    out = subprocess.run(["git", "ls-files", "-c", "-z"], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    keep = []
    for rel in sorted(p for p in out.split("\0") if p):
        parts = rel.split("/")
        name = parts[-1]
        if parts[0].lower() in SKIP_DIRS or (len(parts) == 1 and name.lower() in SKIP_FILES): continue
        if name.startswith(SKIP_GLOBS) or rel.endswith((".pyc", ".pyo", ".tmp", ".part")): continue
        if not (ROOT / rel).is_file(): continue                  # (staged for removal)
        keep.append(rel)
    return keep


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", default="dist")
    ap.add_argument("--with-runtime", action="store_true", help="also pack app/runtime (built by tools/app/build-runtime.py): nothing to install on first start")
    a = ap.parse_args()
    ver = json.loads((ROOT / "app" / "version.json").read_text("utf-8"))["version"]
    names = files()
    for need in ("start.bat", "start_hidden.vbs", "start.command", "start.ico", "app/serve.py", "app/index.html", "app/js/app.js", "app/updater.py"):
        if need not in names: raise SystemExit(f"{need} is missing from the file list: this does not look like the app.")
    out = ROOT / a.out; out.mkdir(parents=True, exist_ok=True)
    rt = ROOT / "app" / "runtime"
    if a.with_runtime:
        if not (rt / "python.exe").is_file(): raise SystemExit("app/runtime is not there: run python tools/app/build-runtime.py first.")
        names += sorted(p.relative_to(ROOT).as_posix() for p in rt.rglob("*") if p.is_file())
    zpath = out / (f"MeshOptimiser-v{ver}-windows.zip" if a.with_runtime else f"MeshOptimiser-v{ver}.zip")
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for rel in names:
            lvl = 6 if rel.startswith("app/runtime/") else 9
            zi = zipfile.ZipInfo.from_file(ROOT / rel, rel)
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = ((0o755 if rel.endswith(".command") else 0o644) << 16)      # (a Mac needs the execute bit on .command)
            with open(ROOT / rel, "rb") as f: z.writestr(zi, f.read(), compresslevel=lvl)
    print(f"{zpath.relative_to(ROOT)}  {zpath.stat().st_size / 1048576:.1f} MB, {len(names)} files, version {ver}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
