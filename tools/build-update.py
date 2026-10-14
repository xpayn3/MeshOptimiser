#!/usr/bin/env python3
"""Build the in-app update for a release: the archive of the app's own files and its entry in latest.json.

    python tools/build-update.py                       # version from the top of CHANGELOG.md, channel stable
    python tools/build-update.py --version 0.22.0 --channel beta
    python tools/build-update.py --feed path/to/old-latest.json --out dist

Writes, into --out (default dist/):
    meshoptimiser-app-<version>.zip   the files the running app is made of, plus update-manifest.json (a SHA-256 for each)
    latest.json                       the feed: the old one with this version put in its channel (or a new one)

Then, by hand (nothing here uploads anything):
    1. attach the zip to the GitHub release  https://github.com/xpayn3/MeshOptimiser/releases/tag/v<version>
       (the URL the feed holds is that release's download address; change it with --url-base if it lives elsewhere)
    2. put latest.json on the website at  https://lukagrcar.com/apps/meshoptimiser/latest.json
The feed is on the website and the archive on GitHub on purpose: both would have to be changed to push a bad file, and the
archive is checked against the SHA-256 and size that only the feed holds.

What ships: everything git knows about (tracked, or untracked and not ignored) except the tests and tools, the docs and
release notes, the launchers (they cannot be replaced while running: if one changed, raise "launcher" in version.json and
the app tells people to download the full version), version.json (the updater writes it) and the user's own folders.
What the updater never touches is listed in updater.py (PROTECTED, LAUNCHERS).
"""
from __future__ import annotations
import argparse, hashlib, json, re, subprocess, sys, time, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import updater                                                    # (PROTECTED and LAUNCHERS live there, once)

SKIP_DIRS = {"tests", "tools", "docs", "dist", "site", ".github", "__pycache__"} | {p.lower() for p in updater.PROTECTED}
SKIP_FILES = {"claude.md", "changelog.md", "readme.md", "readme.txt", "license", "version.json", "update-manifest.json", "server.log", ".gitignore", ".gitattributes"} | set(updater.LAUNCHERS)
SKIP_GLOBS = ("RELEASE_NOTES_", "test-converter.")


def files_to_ship() -> list[str]:
    out = subprocess.run(["git", "ls-files", "-co", "--exclude-standard", "-z"], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    keep = []
    for rel in sorted(p for p in out.split("\0") if p):
        parts = rel.split("/")
        low = rel.lower()
        if parts[0].lower() in SKIP_DIRS or low in SKIP_FILES or rel.endswith((".pyc", ".pyo", ".tmp", ".part")): continue
        if len(parts) == 1 and parts[0].startswith(SKIP_GLOBS): continue
        if not (ROOT / rel).is_file(): continue                   # (listed but deleted in the working tree)
        keep.append(rel)
    return keep


def changelog_top() -> tuple[str, str, list[str]]:
    """(version, date, short notes) from the newest section of CHANGELOG.md: the bold title of each bullet."""
    text = (ROOT / "CHANGELOG.md").read_text("utf-8")
    m = re.search(r"^## v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)\s*\n(.*?)(?=^## v|\Z)", text, re.S | re.M)
    if not m: raise SystemExit("CHANGELOG.md has no '## vX.Y.Z' section.")
    ver, body = m.group(1), m.group(2)
    date = ""
    d = re.search(r"Released\s+(\d{1,2}\s+\w{3}\s+\d{4})", body)
    if d:
        try: date = time.strftime("%Y-%m-%d", time.strptime(d.group(1), "%d %b %Y"))
        except ValueError: date = ""
    notes = []
    for line in body.splitlines():
        if not line.lstrip().startswith("- "): continue
        b = re.search(r"\*\*(.+?)\*\*", line)
        if b: notes.append(re.sub(r"\s+", " ", b.group(1)).strip())
    return ver, date, notes[:12]


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""): h.update(chunk)
    return h.hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--version"); ap.add_argument("--channel", choices=["stable", "beta"], default="stable")
    ap.add_argument("--out", default="dist"); ap.add_argument("--feed", help="the feed as it is now; this release is put into it")
    ap.add_argument("--url-base", help="where the zip will be downloaded from (default: the GitHub release of this tag)")
    ap.add_argument("--min-from", default="", help="the oldest version that may update to this one in the app")
    ap.add_argument("--headline", default="", help="one sentence for the update notice (default: none)")
    ap.add_argument("--delete", action="append", default=[], help="a file the previous version had that this one does not (repeatable)")
    a = ap.parse_args()

    ver, date, notes = changelog_top()
    if a.version: ver = a.version.lstrip("v")
    if not updater.parse_version(ver): raise SystemExit(f"'{ver}' is not a version (use 0.22.0 or 0.22.0-beta.1).")
    out = (ROOT / a.out); out.mkdir(parents=True, exist_ok=True)

    files = files_to_ship()
    if "serve.py" not in files or "index.html" not in files or "updater.py" not in files: raise SystemExit("The file list does not look like the app (serve.py, index.html or updater.py missing).")
    req = ROOT / "requirements.txt"
    req_sha = sha256_file(req) if req.is_file() else ""
    manifest = {"schema": 1, "version": ver, "built": int(time.time()), "requirements_sha256": req_sha,
                "files": [{"path": f, "sha256": sha256_file(ROOT / f), "size": (ROOT / f).stat().st_size} for f in files],
                "delete": [d for d in a.delete]}
    zpath = out / f"meshoptimiser-app-{ver}.zip"
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        z.writestr("update-manifest.json", json.dumps(manifest, indent=1))
        for f in files: z.write(ROOT / f, f)
    # the archive must pass the same checks the app runs
    updater.verify_archive(zpath, ver)

    feed = {"schema": 1}
    if a.feed and Path(a.feed).is_file():
        try: feed = json.loads(Path(a.feed).read_text("utf-8")); feed["schema"] = 1
        except Exception: raise SystemExit(f"{a.feed} is not readable JSON.")
    prev = feed.get(a.channel) if isinstance(feed.get(a.channel), dict) else {}
    base = (a.url_base or f"https://github.com/xpayn3/MeshOptimiser/releases/download/v{ver}/").rstrip("/") + "/"
    launcher = int(updater._read_version_file().get("launcher") or 0)
    feed[a.channel] = {
        "version": ver, "date": date, "headline": a.headline, "notes": notes, "more": f"https://lukagrcar.com/apps/meshoptimiser/changelog.html",
        "archive": {"url": base + zpath.name, "sha256": sha256_file(zpath), "size": zpath.stat().st_size},
        "requirements_sha256": req_sha, "requirements_changed": bool(prev.get("requirements_sha256")) and prev.get("requirements_sha256") != req_sha,
        "launcher": launcher, "min_from": a.min_from,
    }
    (out / "latest.json").write_text(json.dumps(feed, indent=1) + "\n", "utf-8")
    mb = zpath.stat().st_size / 1048576
    print(f"{zpath.relative_to(ROOT)}  {mb:.1f} MB, {len(files)} files, version {ver} ({a.channel})")
    print(f"{(out / 'latest.json').relative_to(ROOT)}  {len(notes)} notes; launcher level {launcher}; requirements {'CHANGED' if feed[a.channel]['requirements_changed'] else 'unchanged'}")
    print(f"  upload the zip to {base}   and latest.json to https://lukagrcar.com/apps/meshoptimiser/latest.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
