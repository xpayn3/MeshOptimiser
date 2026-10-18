"""MeshOptimiser: updating the app itself, without the 2 GB Python environment.

A release is published as a small archive of the app's own files (the page, the scripts, serve.py, vendor/, assets/ ...) and a
`latest.json` that says what the newest version is and what its archive hashes to. This module checks that file, downloads the
archive, verifies it, and swaps the changed files in. The old files are kept in `.update/backup/` so one step back is always
possible. What it never touches: `.venv/`, `inbox/`, `exports/`, `.git/`, the launchers (see LAUNCHERS), and the user's settings
(those live in the browser).

The checks, in order, before a single file is replaced:
  - the feed and the archive are fetched over https, from a short list of hosts (FEED_HOSTS / ARCHIVE_HOSTS), also after a redirect;
  - the archive has the size and SHA-256 the feed promised;
  - every file in it matches the hash its own manifest gives, has a safe relative path, and is not in a protected place;
  - when the Python requirements changed, they are installed first, and a failure there stops the update before any file of the app is replaced
    (pip itself works on the live environment, so some packages may already be installed).
A file that cannot be written puts everything back at once. If the new version keeps failing (the server does not come up, or the page loads and never confirms: two runs in a row),
the next start puts the old version back.

Nothing here runs unless the page asks (serve.py's /api/update/* endpoints, which only this computer's own page can call).
"""
from __future__ import annotations

import hashlib, json, os, re, shutil, ssl, subprocess, sys, tempfile, threading, time, urllib.error, urllib.parse, urllib.request, zipfile
from pathlib import Path

ROOT = Path(__file__).parent.resolve()
UPDATE_DIR = ROOT / ".update"
BACKUP_DIR = UPDATE_DIR / "backup"
PENDING = UPDATE_DIR / "pending.json"          # an update that has been applied and not yet confirmed by a working page
NOTICE = UPDATE_DIR / "notice.json"            # one line for the page to show once ("Updated to ...", "Rolled back ...")
FEED_URL = "https://xpayn3.github.io/MeshOptimiser/latest.json"
FEED_HOSTS = {"xpayn3.github.io"}
ARCHIVE_HOSTS = {"xpayn3.github.io", "github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"}
MAX_FEED = 256 * 1024
MAX_ARCHIVE = 250 * 1024 * 1024
MAX_UNPACKED = 600 * 1024 * 1024
MAX_FILES = 20000
# Never written, replaced or deleted by an update, whatever an archive says.
PROTECTED = (".venv", "runtime", ".git", ".update", ".claude", "inbox", "exports", "__pycache__", "node_modules", "server.log", "server.log.1", "_archive")
# (Paths here are relative to this folder, app/. The thin launchers one level up, in the install folder, are outside it and never touched.)
# A running launcher is read by its shell line by line: replacing it under a running window breaks the window. A release that
# changes them raises `launcher` in its feed entry, and the page then offers the full download instead of an in-place update.
LAUNCHERS = ("start.bat", "start.command", "start.ico", "start_hidden.vbs", "start_hidden.ps1", "ui.ps1", "step2glb.bat", "step2glb.command")
# The version file is written by this module, never copied from an archive (it carries the launcher level of THIS install).
VERSION_FILE = ROOT / "version.json"
PYTHON = sys.executable                       # serve.py points this at the project's own environment

_lock = threading.RLock()
STATE: dict = {"phase": "idle", "message": "", "done": 0, "total": 0, "error": None, "version": None}
_cancel = threading.Event()
_swap = threading.Lock()                       # (the files are swapped by one thing at a time: an install or a rollback)


def _int(v, what: str) -> int:
    """A whole number from the feed or a manifest, or an UpdateError (a ValueError reached the page as \"did not answer\")."""
    try: return int(v or 0)
    except (TypeError, ValueError): raise UpdateError("The update list has an unreadable " + what + ".")
_marked: set = set()                          # (what this run has already written into pending.json: see _mark)


class UpdateError(Exception):
    """Something a person can read: what went wrong and what is unchanged."""


def _dev() -> bool:
    return os.environ.get("MO_UPDATE_DEV") == "1"          # tests only: a feed on 127.0.0.1


def feed_url() -> str:
    return os.environ.get("MO_UPDATE_FEED") or FEED_URL


# ── versions ────────────────────────────────────────────────────────────────
_VER = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.]+))?$")


def parse_version(v: str):
    """'0.22.0' → (0, 22, 0, 1, ()); '0.22.0-beta.2' sorts before '0.22.0'. None when it is not a version."""
    m = _VER.match(str(v or "").strip())
    if not m: return None
    pre = tuple((0, int(p)) if p.isdigit() else (1, p) for p in (m.group(4) or "").split(".")) if m.group(4) else ()
    return (int(m.group(1)), int(m.group(2)), int(m.group(3)), 0 if pre else 1, pre)


def newer(a: str, b: str) -> bool:
    """Is version a newer than version b?"""
    pa, pb = parse_version(a), parse_version(b)
    return bool(pa and pb and pa > pb)


def _read_version_file() -> dict:
    try:
        d = json.loads(VERSION_FILE.read_text("utf-8"))
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def current_version() -> str:
    v = str(_read_version_file().get("version") or "")
    return v if parse_version(v) else "0.0.0"


def launcher_level() -> int:
    try: return int(_read_version_file().get("launcher") or 0)
    except Exception: return 0


# ── small helpers ───────────────────────────────────────────────────────────
def _sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""): h.update(chunk)
    return h.hexdigest()


def _set(**kw):
    with _lock: STATE.update(kw)


def status() -> dict:
    with _lock: s = dict(STATE)
    s.update(current=current_version(), backup=backup_info(), notice=_read_json(NOTICE))
    return s


def _read_json(p: Path):
    try: return json.loads(p.read_text("utf-8"))
    except Exception: return None


def _retry(fn, *args, tries: int = 40, delay: float = 0.15):
    """A file the server is reading, or that antivirus or the indexer holds for a moment, cannot be replaced or removed on
    Windows ("Access is denied", "in use"). Wait and try again for a few seconds before giving up."""
    for i in range(tries):
        try: return fn(*args)
        except FileNotFoundError: raise
        except PermissionError:
            if i == tries - 1: raise
            time.sleep(delay)
        except OSError as e:
            if getattr(e, "winerror", None) not in (5, 32, 33) or i == tries - 1: raise
            time.sleep(delay)


def _remove_tree(path: Path) -> None:
    """Remove a folder without making the next one of the same name wait for it: rename it away first."""
    if not path.exists(): return
    trash = path.with_name(path.name + ".old-" + str(int(time.time() * 1000)))
    try: _retry(os.replace, path, trash)
    except Exception: trash = path
    shutil.rmtree(trash, ignore_errors=True)


def _write_json(p: Path, obj) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(p.name + ".tmp")
    tmp.write_text(json.dumps(obj, indent=1), "utf-8")
    _retry(os.replace, tmp, p)


def _check_url(url: str, hosts: set) -> None:
    u = urllib.parse.urlparse(url)
    if u.scheme == "https" and (u.hostname or "").lower() in hosts: return
    if _dev() and u.scheme in ("http", "https") and (u.hostname or "") in ("127.0.0.1", "localhost"): return
    raise UpdateError("The update address is not one this app trusts: " + (u.hostname or url)[:80])


class _Redirects(urllib.request.HTTPRedirectHandler):
    """A redirect may only lead to another trusted host (GitHub sends release files to its own storage host)."""
    def __init__(self, hosts): self.hosts = hosts
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        _check_url(newurl, self.hosts)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _open(url: str, hosts: set, timeout: float):
    _check_url(url, hosts)
    opener = urllib.request.build_opener(_Redirects(hosts))
    req = urllib.request.Request(url, headers={"User-Agent": "MeshOptimiser-updater/1", "Accept": "*/*", "Cache-Control": "no-cache"})
    try:
        return opener.open(req, timeout=timeout)
    except urllib.error.HTTPError as e:
        raise UpdateError(f"The update server answered {e.code}.")
    except (urllib.error.URLError, TimeoutError, ssl.SSLError, OSError) as e:
        raise UpdateError("Could not reach the update server. Check the internet connection.")


def _https(v) -> str:
    """A link from the feed is shown as a link: https only (never javascript: or data:)."""
    v = str(v or "").strip()[:300]
    return v if v.lower().startswith("https://") else ""


# ── 1. the check ────────────────────────────────────────────────────────────
def check(channel: str = "stable", quiet: bool = False) -> dict:
    """Ask the feed what is newest on `channel`. Returns what the page needs to say; never changes anything.
    `quiet`: called from inside an update, which owns the state. The entry the answer came from comes back as "_entry"."""
    channel = channel if channel in ("stable", "beta") else "stable"
    with _lock:                                   # (a plain check never touches the state of an update that is running)
        mine = not quiet and not busy()
        if mine: STATE.update(phase="checking", message="Looking for updates…", error=None)
    try:
        with _open(feed_url(), FEED_HOSTS, 10) as r:
            raw = r.read(MAX_FEED + 1)
        if len(raw) > MAX_FEED: raise UpdateError("The update list is larger than expected.")
        try: feed = json.loads(raw.decode("utf-8"))
        except Exception: raise UpdateError("The update list could not be read.")
        if not isinstance(feed, dict) or feed.get("schema") != 1: raise UpdateError("The update list is in a format this version does not know. Download the app again from the website.")
        entry = feed.get(channel)
        if channel == "beta":               # the beta channel also offers a stable release that is newer than the beta
            st = feed.get("stable")
            if isinstance(st, dict) and (not isinstance(entry, dict) or newer(str(st.get("version")), str(entry.get("version")))): entry = st
        cur = current_version()
        out = {"ok": True, "channel": channel, "current": cur, "checked_at": int(time.time()), "available": False}
        if not isinstance(entry, dict) or not parse_version(str(entry.get("version"))):
            return out | {"latest": cur}
        out["_entry"] = entry
        ver = str(entry["version"]).lstrip("v")
        arch = entry.get("archive") if isinstance(entry.get("archive"), dict) else {}
        out.update(latest=ver, date=str(entry.get("date") or "")[:32], notes=[str(n)[:300] for n in (entry.get("notes") or [])][:30],
                   headline=str(entry.get("headline") or "")[:300], more=_https(entry.get("more")),
                   size=_int(arch.get("size"), "size"), requires_pip=bool(entry.get("requirements_changed")))
        out["available"] = newer(ver, cur)
        if out["available"]:
            min_from = str(entry.get("min_from") or "")
            if _int(entry.get("launcher"), "launcher level") > launcher_level():
                out.update(installable=False, reason="This release changes the launcher, which cannot be replaced while it runs. Download the full version from the website.")
            elif min_from and parse_version(min_from) and newer(min_from, cur):
                out.update(installable=False, reason=f"This release can only be installed over {min_from} or newer. Download the full version from the website.")
            elif not (arch.get("url") and arch.get("sha256") and arch.get("size")):
                out.update(installable=False, reason="This release has no in-app download. Get it from the website.")
            else:
                out["installable"] = True
        return out
    finally:
        if mine:
            with _lock:
                if STATE["phase"] == "checking": STATE.update(phase="idle", message="")


# ── 2. download ─────────────────────────────────────────────────────────────
def _download(arch: dict, dest: Path) -> None:
    url, want_sha, want_size = str(arch["url"]), str(arch["sha256"]).lower(), _int(arch["size"], "size")
    if want_size <= 0 or want_size > MAX_ARCHIVE: raise UpdateError("The update archive has an unexpected size.")
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(".part")
    h = hashlib.sha256(); got = 0
    _set(phase="downloading", message="Downloading…", done=0, total=want_size)
    with _open(url, ARCHIVE_HOSTS, 30) as r, open(part, "wb") as f:
        while True:
            if _cancel.is_set(): raise UpdateError("Cancelled. Nothing was changed.")
            chunk = r.read(1 << 17)
            if not chunk: break
            got += len(chunk)
            if got > want_size or got > MAX_ARCHIVE: raise UpdateError("The download is larger than the update list said. Nothing was changed.")
            h.update(chunk); f.write(chunk)
            _set(done=got)
    if got != want_size: raise UpdateError("The download was cut short. Nothing was changed.")
    if h.hexdigest() != want_sha: raise UpdateError("The download does not match its checksum, so it was not used. Nothing was changed.")
    _retry(os.replace, part, dest)


# ── 3. read and verify the archive ──────────────────────────────────────────
_RESERVED = re.compile(r"^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$", re.I)      # (Windows opens these as devices, extension or not)


def _safe_rel(name: str) -> str:
    """A relative path inside the app folder, or an UpdateError."""
    if not name or "\\" in name or ":" in name or name.startswith("/") or "\x00" in name:
        raise UpdateError("The update contains a file with an unsafe path: " + name[:80])
    parts = name.split("/")
    if any(p in ("", ".", "..") or p.endswith((".", " ")) for p in parts): raise UpdateError("The update contains a file with an unsafe path: " + name[:80])
    if any(_RESERVED.match(p) for p in parts): raise UpdateError("The update contains a file with a reserved name: " + name[:80])
    low = name.lower()      # (Windows and macOS treat Inbox/ and inbox/ as one folder)
    if parts[0].lower() in PROTECTED or parts[0].startswith(".") or low in LAUNCHERS or low == "version.json" or low == "update-manifest.json":
        raise UpdateError("The update tries to change a protected file: " + name[:80])
    return name


def verify_archive(zpath: Path, expect_version: str | None = None) -> dict:
    """Open the archive, check its manifest and every file against it. Returns the manifest."""
    try: z = zipfile.ZipFile(zpath)
    except Exception: raise UpdateError("The update archive could not be opened. Nothing was changed.")
    with z:
        infos = {i.filename: i for i in z.infolist() if not i.is_dir()}
        if len(infos) > MAX_FILES or sum(i.file_size for i in infos.values()) > MAX_UNPACKED: raise UpdateError("The update archive is larger than expected.")
        if "update-manifest.json" not in infos: raise UpdateError("The update archive has no manifest.")
        try: man = json.loads(z.read("update-manifest.json").decode("utf-8"))
        except Exception: raise UpdateError("The update manifest could not be read.")
        if not isinstance(man, dict) or man.get("schema") != 1 or not parse_version(str(man.get("version"))): raise UpdateError("The update manifest is not valid.")
        if expect_version and str(man["version"]) != str(expect_version): raise UpdateError("The archive is for another version than the update list said.")
        files = man.get("files")
        if not isinstance(files, list) or not files: raise UpdateError("The update manifest lists no files.")
        seen = set()
        for i, f in enumerate(files):
            if not isinstance(f, dict): raise UpdateError("The update manifest is not valid.")
            rel = _safe_rel(str(f.get("path") or ""))
            if rel.lower() in seen: raise UpdateError("The update lists a file twice: " + rel)      # (case-folded: Windows and macOS see one file)
            seen.add(rel.lower())
            info = infos.get(rel)
            if info is None: raise UpdateError("The update archive is missing " + rel)
            h = hashlib.sha256()
            with z.open(info) as fh:
                n = 0
                for chunk in iter(lambda: fh.read(1 << 20), b""):
                    n += len(chunk); h.update(chunk)
                    if n > info.file_size + 1: break
            if h.hexdigest() != str(f.get("sha256") or "").lower(): raise UpdateError("A file in the update does not match its checksum: " + rel)
        dels = man.get("delete") or []
        if not isinstance(dels, list) or not all(isinstance(d, str) for d in dels):      # (a string would be walked letter by letter)
            raise UpdateError("The update manifest is not valid.")
        for d in dels:
            if _safe_rel(str(d)).lower() in seen: raise UpdateError("The update both installs and removes a file: " + str(d)[:80])
        man["_files"] = [str(f["path"]) for f in files]
        return man


# ── 4. swap the files in ────────────────────────────────────────────────────
def backup_info():
    b = _read_json(BACKUP_DIR / "backup.json")
    return {"version": b.get("from"), "to": b.get("to"), "at": b.get("at")} if isinstance(b, dict) and b.get("from") else None


def _pip_needed(man: dict) -> bool:
    want = str(man.get("requirements_sha256") or "").lower()
    have = _sha256_file(ROOT / "requirements.txt") if (ROOT / "requirements.txt").is_file() else ""
    return bool(want) and want != have


def _pip_install(req: Path) -> None:
    _set(phase="installing", message="Installing the Python packages this version needs…", done=0, total=0)
    py = PYTHON
    try:
        p = subprocess.run([py, "-m", "pip", "install", "-r", str(req), "--disable-pip-version-check"], cwd=str(ROOT), capture_output=True, text=True, timeout=1800)
    except Exception as e:
        raise UpdateError("The Python packages could not be installed (" + str(e)[:80] + "). The app's files were not changed; some packages may already have been installed.")
    if p.returncode != 0:
        tail = " ".join((p.stdout + p.stderr).strip().splitlines()[-2:])[:200]
        raise UpdateError("The Python packages could not be installed: " + tail + " The app's files were not changed; some packages may already have been installed.")
    marker = ROOT / ".venv" / ".requirements.installed"
    try:
        if marker.parent.is_dir(): shutil.copyfile(req, marker)
    except Exception: pass
    _runtime_manifest_note(req)


def _runtime_manifest_note(req: Path) -> bool:
    """A bundled runtime (app/runtime, no .venv) got the packages too: its MANIFEST.json must name the new requirements hash, or the
    launcher (start.bat) reads the runtime as built for another requirements.txt and refuses to start with it. True when it was written."""
    mf = ROOT / "runtime" / "MANIFEST.json"
    try:
        m = _read_json(mf)
        if not isinstance(m, dict): return False
        m["requirements_sha256"] = _sha256_file(req)
        _write_json(mf, m)
        return True
    except Exception:
        return False


def apply_archive(zpath: Path, man: dict) -> dict:
    """Replace the files that differ. Everything replaced or deleted is saved first; an error puts it all back."""
    with _swap:
        return _apply_archive(zpath, man)


def _apply_archive(zpath: Path, man: dict) -> dict:
    files = man["_files"]
    new_ver = str(man["version"])
    old_ver = current_version()
    changed = []
    hashes = {f["path"]: str(f["sha256"]).lower() for f in man["files"]}
    with zipfile.ZipFile(zpath) as z:
        for rel in files:
            dst = ROOT / rel
            want = hashes[rel]
            if dst.is_file() and _sha256_file(dst) == want: continue
            changed.append(rel)
        deletes = [d for d in (man.get("delete") or []) if (ROOT / d).is_file()]
        # the previous backup goes; this one replaces it
        _remove_tree(BACKUP_DIR)
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        meta = {"from": old_ver, "to": new_ver, "at": int(time.time()), "launcher": launcher_level(), "replaced": [], "created": [], "deleted": []}
        _write_json(BACKUP_DIR / "backup.json", meta)
        _set(phase="installing", message="Installing…", done=0, total=len(changed) + len(deletes))
        # The marker goes down before the first file is touched. A crash in the middle of the swap (power, kill, antivirus) used to leave
        # a half-replaced app that nothing rolled back, and a retry threw the only backup away; now the next start sees "applying" and
        # puts the old version back from the backup (on_startup).
        _write_json(PENDING, {"from": old_ver, "to": new_ver, "boots": 0, "at": int(time.time()), "applying": True})
        n = 0
        try:
            for rel in changed + deletes:
                dst = ROOT / rel
                if dst.is_file():                                     # save what is there
                    keep = BACKUP_DIR / "files" / rel
                    keep.parent.mkdir(parents=True, exist_ok=True)
                    _retry(shutil.copy2, dst, keep)
                    meta["deleted" if rel in deletes else "replaced"].append(rel)
                else:
                    meta["created"].append(rel)
                _write_json(BACKUP_DIR / "backup.json", meta)          # (so a crash half-way still knows what to undo)
                if rel in deletes:
                    _retry(dst.unlink)
                else:
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    tmp = dst.with_name(dst.name + ".new")
                    h = hashlib.sha256()
                    with z.open(rel) as src, open(tmp, "wb") as out:      # (hashed again as it is written: the archive could have been swapped since it was checked)
                        for chunk in iter(lambda: src.read(1 << 20), b""): h.update(chunk); out.write(chunk)
                    if h.hexdigest() != hashes[rel]:
                        try: tmp.unlink()
                        except Exception: pass
                        raise UpdateError("A file changed after it was checked: " + rel)
                    _retry(os.replace, tmp, dst)
                n += 1; _set(done=n)
            _write_json(VERSION_FILE, {"version": new_ver, "launcher": launcher_level()})
            _write_json(PENDING, {"from": old_ver, "to": new_ver, "boots": 0, "at": int(time.time())})      # (inside the try: if it cannot be written, everything goes back)
        except Exception as e:
            try: _restore(meta)
            except Exception as e2:        # (the marker keeps saying "applying": the next start finishes putting the old version back)
                raise UpdateError("The files could not be written (" + str(e)[:80] + ") and not all of them could be put back (" + str(e2)[:80]
                                  + "). Start the app again: it puts the old version back then.")
            try: PENDING.unlink()
            except Exception: pass
            if isinstance(e, UpdateError): raise UpdateError(str(e) + " The old version was put back.")
            raise UpdateError("The files could not be written (" + str(e)[:100] + "). The old version was put back.")
    return {"changed": len(changed), "deleted": len(deletes), "from": old_ver, "to": new_ver}


def _restore(meta: dict) -> None:
    """Put back what a backup holds: saved files, minus what the update created, plus what it removed."""
    files = BACKUP_DIR / "files"
    for rel in meta.get("created") or []:
        try: _retry((ROOT / rel).unlink)
        except Exception: pass
    for rel in (meta.get("replaced") or []) + (meta.get("deleted") or []):
        src = files / rel
        if src.is_file():
            dst = ROOT / rel; dst.parent.mkdir(parents=True, exist_ok=True)
            tmp = dst.with_name(dst.name + ".old")
            _retry(shutil.copy2, src, tmp); _retry(os.replace, tmp, dst)
    _write_json(VERSION_FILE, {"version": meta.get("from") or current_version(), "launcher": int(meta.get("launcher") or launcher_level())})


def rollback(reason: str = "") -> dict:
    with _lock: moving = STATE["phase"] in ("downloading", "verifying", "installing")      # (not "restarting": the files are in place by then)
    if moving: raise UpdateError("An update is running. Try again when it has finished.")
    if not _swap.acquire(blocking=False): raise UpdateError("The app's files are being changed. Try again in a moment.")
    try:
        return _rollback(reason)
    finally:
        _swap.release()


def _rollback(reason: str) -> dict:
    meta = _read_json(BACKUP_DIR / "backup.json")
    if not isinstance(meta, dict) or not meta.get("from"): raise UpdateError("There is no earlier version to go back to.")
    # A backup belongs to the version it was taken for: one left from before a reinstall of a newer version would put old files
    # over it. (In the middle of a swap the version file still names the old version: the backup is right for that too.)
    if current_version() not in (str(meta.get("to")), str(meta.get("from"))):
        raise UpdateError("The saved earlier version is not from this installation (it was taken for " + str(meta.get("to"))[:20] + "), so it was not used.")
    # Every file the backup says it saved must be there, or going back would leave new files under the old number.
    missing = [rel for rel in (meta.get("replaced") or []) + (meta.get("deleted") or []) if not (BACKUP_DIR / "files" / rel).is_file()]
    if missing:
        raise UpdateError("The saved earlier version is incomplete (" + str(len(missing)) + " files missing, such as " + missing[0][:60] + "), so nothing was changed.")
    _restore(meta)
    bad = meta.get("to")
    _remove_tree(BACKUP_DIR)
    try: PENDING.unlink()
    except Exception: pass
    _write_json(NOTICE, {"kind": "rolled_back", "from": bad, "to": meta["from"], "reason": reason, "at": int(time.time())})
    return {"restored": meta["from"], "from": bad}


# ── 5. the whole update, run in a thread ────────────────────────────────────
def busy() -> bool:
    with _lock: return STATE["phase"] in ("downloading", "verifying", "installing", "restarting")


def start_install(channel: str, on_done, guard=None) -> None:
    """Begin an update in a thread of its own. `on_done(result)` runs after a success (serve.py restarts the server there)."""
    with _lock:
        if busy(): raise UpdateError("An update is already running.")
        _cancel.clear()
        STATE.update(phase="downloading", message="Starting…", done=0, total=0, error=None, version=None)
    def run():
        tmp = None
        try:
            UPDATE_DIR.mkdir(parents=True, exist_ok=True)
            tmp = Path(tempfile.mkdtemp(prefix="mo-update-", dir=str(UPDATE_DIR)))
            info = check(channel, quiet=True)
            if not info.get("available"): raise UpdateError("You already have the newest version.")
            if not info.get("installable"): raise UpdateError(info.get("reason") or "This release cannot be installed from here.")
            if guard:
                why = guard()
                if why: raise UpdateError(why)
            entry = info["_entry"]
            _set(version=info["latest"], phase="downloading")
            z = tmp / "update.zip"
            _download(entry["archive"], z)
            _set(phase="verifying", message="Checking the download…")
            man = verify_archive(z, info["latest"])
            if _pip_needed(man):
                with zipfile.ZipFile(z) as zf: (tmp / "requirements.txt").write_bytes(zf.read("requirements.txt"))
                _pip_install(tmp / "requirements.txt")
            if _cancel.is_set(): raise UpdateError("Cancelled. Nothing was changed.")
            res = apply_archive(z, man)
            _set(phase="restarting", message="Restarting…")
            on_done(res)
        except UpdateError as e:
            _set(phase="error", error=str(e), message="")
        except Exception as e:
            _set(phase="error", error="The update stopped unexpectedly: " + str(e)[:140] + ". The old version is still in place.", message="")
        finally:
            if tmp is not None: shutil.rmtree(tmp, ignore_errors=True)
    threading.Thread(target=run, daemon=True).start()


def cancel() -> None:
    _cancel.set()


# ── 6. at start-up, and when the page is up ─────────────────────────────────
def _mark(key: str) -> None:
    """Note, once per run, in pending.json that this run of the server reached `key` ("listened": it came up; "served": it handed out the page)."""
    with _lock:
        if key in _marked: return
        _marked.add(key)
        p = _read_json(PENDING)
        if isinstance(p, dict) and not p.get(key):
            p[key] = True
            try: _write_json(PENDING, p)
            except Exception: pass


def mark_listening() -> None: _mark("listened")
def mark_page_served() -> None: _mark("served")


def on_startup() -> bool:
    """An update that was applied and then failed on its next starts is taken back. True when it was.
    A run before this one counts as failed when the server never came up, or when it handed out the page and the page never
    confirmed. A run in which nobody opened the page (a start from a script, or by Claude, with no window) counts as neither:
    it resets the count. A server that never came up twice in a row, or a page that loaded and never confirmed three times in a row
    (a window closed early looks the same as a broken page, so that needs more evidence), and the next start puts the old version back."""
    try:                                           # folders an earlier run could not delete at once
        for old in UPDATE_DIR.glob("*.old-*"): shutil.rmtree(old, ignore_errors=True)
        for old in UPDATE_DIR.glob("mo-update-*"): shutil.rmtree(old, ignore_errors=True)
    except Exception: pass
    p = _read_json(PENDING)
    if not isinstance(p, dict): return False
    if p.get("applying"):                          # the last run stopped in the middle of swapping the files: back to the old version
        try:
            rollback("The update did not finish.")
            return True
        except UpdateError:
            try: PENDING.unlink()
            except Exception: pass
            return False
    if int(p.get("boots") or 0) > 0:
        failed = (not p.get("listened")) or bool(p.get("served"))
        p["bad"] = int(p.get("bad") or 0) + 1 if failed else 0
        p["dead"] = int(p.get("dead") or 0) + 1 if not p.get("listened") else 0      # (runs in a row in which the server never came up)
    p["listened"] = False; p["served"] = False
    p["boots"] = int(p.get("boots") or 0) + 1
    if int(p.get("bad") or 0) >= 3 or int(p.get("dead") or 0) >= 2:
        try:
            rollback("The new version did not start properly.")
            return True
        except UpdateError:
            try: PENDING.unlink()
            except Exception: pass
            return False
    _write_json(PENDING, p)
    return False


def confirm() -> None:
    """The page of the new version is up: the update is good."""
    with _lock:
        p = _read_json(PENDING)
        if isinstance(p, dict):
            _write_json(NOTICE, {"kind": "updated", "from": p.get("from"), "to": p.get("to"), "at": int(time.time())})
            try: PENDING.unlink()
            except Exception: pass


def clear_notice() -> None:
    try: NOTICE.unlink()
    except Exception: pass
