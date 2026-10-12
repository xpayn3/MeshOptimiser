#!/usr/bin/env python3
"""Local server + CAD->GLB conversion entry point (STEP, IGES, BREP).

Run via:
    python serve.py                # start server, open browser empty
    python serve.py --open file    # start server, auto-load file
                                    # (asks about re-convert + quality if CAD)
"""
from __future__ import annotations
import math
import argparse, atexit, http.server, json, os, re, select, shutil, signal, subprocess
import sys, threading, time, uuid, webbrowser
from pathlib import Path
from urllib.parse import urlparse, parse_qs, quote
import updater                     # updating the app's own files: see updater.py

PORT = 4242
# CAD formats step2glb.py reads (its SUPPORTED_EXTS), and the name each is
# called in messages. /api/convert, --open and the inbox sweep all use this.
CAD_EXTS = (".step", ".stp", ".iges", ".igs", ".brep", ".brp")
_CAD_NAMES = {".step": "STEP", ".stp": "STEP", ".iges": "IGES", ".igs": "IGES",
              ".brep": "BREP", ".brp": "BREP"}
ROOT = Path(__file__).parent.resolve()
INBOX = ROOT / "inbox"
INBOX.mkdir(exist_ok=True)

# step2glb.py needs numpy / OCP / trimesh, which live in the project's .venv.
# Users routinely launch `python serve.py` from a global Python that has none of
# them, so we always prefer the venv's interpreter for the subprocess if it
# exists. Falls back to whatever's running serve.py.
def _resolve_python() -> str:
    if os.name == "nt":
        candidate = ROOT / ".venv" / "Scripts" / "python.exe"
    else:
        candidate = ROOT / ".venv" / "bin" / "python"
    return str(candidate) if candidate.exists() else sys.executable

PYTHON_BIN = _resolve_python()

# ─── Hard limits / safety knobs ─────────────────────────────────────────────
# 4 GB upload cap. STEP files for very large CAD assemblies can hit ~1 GB; 4 GB
# leaves headroom while preventing accidental DoS via runaway uploads.
MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024
# Keep at most this many completed jobs in memory. Prevents the JOBS dict from
# growing unbounded over a long-running server session.
MAX_JOBS_RETAINED = 50
# A job keeps the last this-many lines of the converter's output in "log".
# "log_base" counts the lines dropped before them, so line i of the whole
# output is log[i - log_base]: a client that remembers how many lines it has
# shown can carry on from there after the log has been trimmed.
MAX_LOG_LINES = 200
# Safe filename pattern: alphanum + a few separators. Strips path traversal,
# null bytes, control chars, etc. before we ever touch disk.
_SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9._\- ]")

# Background conversion job registry for the /api/convert browser endpoint
JOBS: dict[str, dict] = {}
JOBS_LOCK = threading.Lock()
# Converter processes still running, by job id (kept out of JOBS, which is
# served as JSON). /api/cancel/<id> uses this to stop one.
PROCS: dict[str, subprocess.Popen] = {}


def _kill_tree(proc: subprocess.Popen) -> None:
    """Stop a converter and anything it started (its heartbeat helper)."""
    try:
        if os.name == "nt":
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            # The converter runs in a session of its own (see _convert_thread),
            # so its process group is the converter and its helpers and nothing
            # else. Should the group turn out to be the server's own, only the
            # converter is stopped.
            try:
                group = os.getpgid(proc.pid)
            except OSError:
                group = None
            if group is not None and group != os.getpgrp():
                os.killpg(group, signal.SIGTERM)
            else:
                proc.terminate()
    except Exception:
        pass


def _stop_converters() -> None:
    """Stop every conversion still running: once the server goes, nobody is
    left to read what they produce."""
    with JOBS_LOCK:
        running = list(PROCS.values())
    for proc in running:
        _kill_tree(proc)


# --- Nothing is left running behind the app ---------------------------------
# 1. The server lives as long as its window. The page keeps one request open
#    (GET /api/alive, see Handler._handle_alive). When the last one closes (the
#    window was shut, the browser crashed or was killed: the operating system
#    closes the connection either way) and nobody comes back within the grace
#    period, the server stops its converters and exits. Only on when the server
#    opened the window itself (or with --exit-when-closed): a server started
#    for development with --no-browser keeps running, as before.
CLIENTS: dict[str, float] = {}
CLIENTS_LOCK = threading.Lock()
LIFE = {"ever": False, "left_at": time.time(), "started": time.time(),
        "exit_when_closed": False,
        "grace": 10.0,        # seconds: a reload closes the page for a moment
        "first_wait": 120.0}  # seconds to wait for the window to show up at all


def _watchdog(httpd) -> None:
    while True:
        time.sleep(1.0)
        if not LIFE["exit_when_closed"]:
            continue
        with CLIENTS_LOCK:
            n, ever, left = len(CLIENTS), LIFE["ever"], LIFE["left_at"]
        if n:
            continue
        waited = time.time() - (left if ever else LIFE["started"])
        if waited > (LIFE["grace"] if ever else LIFE["first_wait"]):
            print("\n  the window is closed: stopping.")
            _stop_converters()
            try: httpd.shutdown()
            except Exception: pass
            return


# 2. Windows: a converter belongs to a job that the system tears down when the
#    server's last handle to it closes, which happens however the server ends
#    (Ctrl+C, taskkill /F, a crash). Anything the converter started stays in it.
#    (Elsewhere a converter has a process group of its own, see _kill_tree.)
_JOB = None

def _job_object():
    global _JOB
    if _JOB is not None:
        return _JOB or None
    _JOB = 0
    if os.name != "nt":
        return None
    try:
        import ctypes
        from ctypes import wintypes
        k = ctypes.WinDLL("kernel32", use_last_error=True)
        k.CreateJobObjectW.restype = wintypes.HANDLE
        k.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        k.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]

        class _Basic(ctypes.Structure):
            _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64), ("PerJobUserTimeLimit", ctypes.c_int64),
                        ("LimitFlags", wintypes.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t),
                        ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wintypes.DWORD),
                        ("Affinity", ctypes.c_size_t), ("PriorityClass", wintypes.DWORD),
                        ("SchedulingClass", wintypes.DWORD)]

        class _Io(ctypes.Structure):
            _fields_ = [(n, ctypes.c_uint64) for n in ("ReadOps", "WriteOps", "OtherOps", "ReadBytes", "WriteBytes", "OtherBytes")]

        class _Ext(ctypes.Structure):
            _fields_ = [("Basic", _Basic), ("Io", _Io), ("ProcessMemoryLimit", ctypes.c_size_t),
                        ("JobMemoryLimit", ctypes.c_size_t), ("PeakProcessMemoryUsed", ctypes.c_size_t),
                        ("PeakJobMemoryUsed", ctypes.c_size_t)]

        h = k.CreateJobObjectW(None, None)
        if not h:
            return None
        info = _Ext()
        info.Basic.LimitFlags = 0x2000          # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not k.SetInformationJobObject(h, 9, ctypes.byref(info), ctypes.sizeof(info)):   # 9 = extended limit information
            return None
        _JOB = h
        return h
    except Exception:
        return None


def _contain(proc: subprocess.Popen) -> None:
    """Tie a converter's life to the server's (Windows). Best effort: a refusal
    (the server itself sits in a job that forbids it) only means the converter is
    stopped the ordinary way, by _stop_converters."""
    h = _job_object()
    if not h:
        return
    try:
        import ctypes
        from ctypes import wintypes
        k = ctypes.WinDLL("kernel32", use_last_error=True)
        k.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        k.AssignProcessToJobObject(h, wintypes.HANDLE(int(proc._handle)))
    except Exception:
        pass


# How to start this server again with the same settings (set by main() once the port is bound): the app's Restart server uses it.
RESTART_CMD = None

def _restart_server():
    """Stop this server and start a new one on the same port, in a window of its own. The page stays open and reconnects."""
    time.sleep(0.25)
    _mcp_log("restarting the server")
    _stop_converters()
    try:
        if HTTPD is not None:
            HTTPD.shutdown()
            HTTPD.server_close()           # (the new server must find the port free)
    except Exception:
        pass
    try:
        log = open(ROOT / "server.log", "ab")
        kw = {"cwd": str(ROOT), "stdin": subprocess.DEVNULL, "stdout": log, "stderr": log, "close_fds": True}
        if os.name == "nt": kw["creationflags"] = 0x00000008 | 0x00000200      # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
        else: kw["start_new_session"] = True
        subprocess.Popen(RESTART_CMD, **kw)
    except Exception as e:
        sys.stderr.write(f"  could not start the server again: {e}\n")

def _after_update(res):
    """The new files are in place: start the server again so it runs them. The page reloads when it is back."""
    if RESTART_CMD and os.path.isfile(RESTART_CMD[0]):
        updater._set(phase="restarting", message="Restarting…")
        threading.Thread(target=_restart_server, daemon=False).start()
    else:
        updater._set(phase="done", message="Updated. Close the app and start it again to use the new version.")

def _graceful(signum, frame):
    """A termination request ends the server the way Ctrl+C does."""
    raise KeyboardInterrupt

# Module-level reference set by main() once the server binds. The /api/quit
# handler reads this to schedule a clean shutdown — keeping it module-level
# (rather than a closure) means the Handler class doesn't need the httpd
# instance threaded through its constructor.
HTTPD: "http.server.ThreadingHTTPServer | None" = None


def _sanitize_filename(name: str, fallback: str = "upload.step") -> str:
    """Strip everything except a conservative alphabet + dot/dash/underscore/space.

    Path.name already strips directory components — this layer also defangs
    NUL bytes, control chars, leading dots ("hidden file" trick), and weird
    Unicode. The result always has a non-empty stem and a valid extension.
    """
    base = Path(name).name                               # drop dirs
    base = _SAFE_NAME_RE.sub("_", base)                  # drop unsafe chars
    base = base.strip().lstrip(".")                      # no leading dots
    if not base or base in {".", "..", "_"}:
        return fallback
    if len(base) > 200:
        # Prevent absurdly-long names that some filesystems reject.
        stem, ext = os.path.splitext(base)
        base = stem[:200 - len(ext)] + ext
    return base


def _prune_jobs() -> None:
    """Keep the JOBS dict bounded — drop oldest finished jobs over the cap."""
    with JOBS_LOCK:
        if len(JOBS) <= MAX_JOBS_RETAINED: return
        # Sort by start time; finished jobs evict before running ones.
        finished = [(jid, j) for jid, j in JOBS.items()
                    if j.get("status") in ("done", "error", "cancelled")]
        finished.sort(key=lambda kv: kv[1].get("started_at", 0))
        excess = len(JOBS) - MAX_JOBS_RETAINED
        for jid, _ in finished[:excess]:
            JOBS.pop(jid, None)


def _cancel_job(job_id: str) -> bool:
    """Mark a queued / running conversion cancelled and stop its process tree. False if there is no such job."""
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        proc = PROCS.get(job_id)
        if job is None:
            return False
        if job.get("status") in ("queued", "running"):
            job["status"] = "cancelled"
            job["message"] = "cancelled"
    if proc is not None:
        _kill_tree(proc)
    return True


# A conversion belongs to the page that started it, and the page polls /api/job/<id> every second. When the page goes away without
# cancelling (a reload, a crashed tab, a closed window while the server stays up) nothing was asking for the result any more, and the
# converter kept a CPU core and gigabytes of memory for hours. A job that has not been polled for this long is cancelled. It is far
# longer than a page needs: a background tab's timers are throttled to about one a minute.
ORPHAN_JOB_SECONDS = 600
_watchdog_started = False


def _job_watchdog() -> None:
    while True:
        time.sleep(30)
        now = time.time()
        with JOBS_LOCK:
            stale = [jid for jid, j in JOBS.items()
                     if j.get("status") in ("queued", "running")
                     and now - j.get("polled_at", j.get("started_at", now)) > ORPHAN_JOB_SECONDS]
        for jid in stale:
            print(f"  conversion {jid} was not asked about for {ORPHAN_JOB_SECONDS // 60} minutes: its page is gone, stopping it")
            _cancel_job(jid)


def _start_job_watchdog() -> None:
    global _watchdog_started
    if _watchdog_started: return
    _watchdog_started = True
    threading.Thread(target=_job_watchdog, daemon=True).start()


# job-id prefix length used by /api/convert when staging an upload.
# 12 lowercase hex chars from `uuid.uuid4().hex[:12]` — pinning the regex
# so the boot-time sweep never deletes a real user file that happens to
# contain an underscore.
_JOB_PREFIX_RE = re.compile(r"^[0-9a-f]{12}_")
# How long a stale upload artefact is allowed to sit before the boot sweep
# claims it. Anything younger than this stays — the user could be mid-job
# while a second `python serve.py` is launched (`allow_reuse_address`).
_STALE_AGE_SEC = 24 * 3600


def _sweep_stale_inbox() -> None:
    """Drop what earlier imports left behind in `inbox/`.

    Three things accumulate there over time:
      • `<job_id>_<name>.step|.stp|.iges|.igs|.brep|.brp` — staged uploads. The /api/convert
        thread removes these when a conversion ends, but a crash between
        upload and conversion (or a process kill mid-job) leaves the
        source behind.
      • `<job_id>_<name>.glb` and `<job_id>_<name>.glb.params.json` — the
        result of every STEP opened in the app. The app fetches the GLB
        once, straight after the conversion, and never asks for it again.
      • `*.xcaf-cache.xbf` — XCAF binary caches written by step2glb.py
        next to the source. Now orphaned because the source is gone.

    Anything older than _STALE_AGE_SEC is removed; younger files might
    belong to an in-flight job from a parallel server instance.

    Only names that start with a job id (_JOB_PREFIX_RE, the prefix this
    server puts on an upload) are touched. The user's own models in
    `inbox/` (`coral.glb`, the result of `--open part.step`) and any STEP
    they put there have no such prefix and are left alone.
    """
    if not INBOX.exists(): return
    now = time.time()
    deleted = 0
    for p in INBOX.iterdir():
        try:
            if not p.is_file(): continue
            age = now - p.stat().st_mtime
            if age < _STALE_AGE_SEC: continue
            name = p.name.lower()
            is_job_file = (
                _JOB_PREFIX_RE.match(p.name) is not None
                and name.endswith(CAD_EXTS + (".glb", ".glb.params.json"))
            )
            is_orphan_cache = name.endswith(".xcaf-cache.xbf")
            if is_job_file or is_orphan_cache:
                p.unlink()
                deleted += 1
        except OSError:
            # Locked file, race with antivirus, etc. — ignore and try next run.
            pass
    if deleted:
        print(f"  inbox sweep: removed {deleted} stale file(s) left by earlier imports")


def _ask(prompt: str, default: str = "") -> str:
    """Prompt the user; returns stripped answer or default if blank/EOF."""
    print(prompt, end="", flush=True)
    try:
        a = input().strip()
        return a if a else default
    except EOFError:
        return default


def _same_path(a: str, b: str) -> bool:
    """Two spellings of one path (Windows ignores case and mixes slashes)."""
    return os.path.normcase(os.path.normpath(a)) == os.path.normcase(os.path.normpath(b))


def _gltf_side_files(path: Path) -> list[str]:
    """The separate files a .gltf keeps its data in (.bin buffers, textures).
    Empty for a .gltf that carries everything inside itself."""
    try:
        with path.open("r", encoding="utf-8-sig") as f:
            doc = json.load(f)
    except Exception:
        return []        # not readable as glTF: the app says so when it loads it
    if not isinstance(doc, dict): return []
    side = []
    for key in ("buffers", "images"):
        for item in doc.get(key) or []:
            uri = item.get("uri") if isinstance(item, dict) else None
            if isinstance(uri, str) and uri and not uri.lower().startswith("data:"):
                side.append(uri)
    return side


def interactive_convert(src: Path) -> Path | None:
    """Ask user about caching + quality, then run step2glb.py.
    Returns the path of the resulting GLB (relative to ROOT)."""
    dst = INBOX / (src.stem + ".glb")
    quality = "0.5"
    force = False

    if dst.exists() and dst.stat().st_mtime > src.stat().st_mtime:
        cache_age = time.time() - dst.stat().st_mtime
        # Read the *.params.json sidecar that step2glb.py writes alongside
        # successful conversions and surface the cached quality so the user
        # isn't silently re-using a coarser/finer mesh than they wanted.
        params_path = dst.with_suffix(dst.suffix + ".params.json")
        cached = {}
        try:
            if params_path.exists():
                with params_path.open("r", encoding="utf-8") as pf:
                    cached = json.load(pf)
        except Exception:
            cached = {}
        if not isinstance(cached, dict): cached = {}
        # inbox/<name>.glb is named after the file alone, so B/assembly.step
        # finds the GLB that A/assembly.step left there. The sidecar records
        # which file a GLB was made from; only that file may reuse it. (A GLB
        # with no record, from an older version, is converted again.)
        made_from = cached.get("source")
        if isinstance(made_from, str) and _same_path(made_from, str(src)):
            q = cached.get("quality")
            cached_q_label = f", quality={q}" if q is not None else ""
            ans = _ask(
                f"\n  Cached GLB found:\n"
                f"    {dst.name}  ({dst.stat().st_size/1048576:.1f} MB, "
                f"converted {cache_age/60:.0f} min ago{cached_q_label})\n"
                f"  Re-convert? [y/N]: ", "n")
            if ans.lower() not in ("y", "yes"):
                print(f"  Using cached GLB.\n")
                return dst
        else:
            print(f"\n  inbox/{dst.name} was not made from this file - converting again.")

        force = True

    print()
    print(f"  Tessellation quality:")
    print(f"    [1] fast       (linear deflection 1.0  - coarse mesh, fastest)")
    print(f"    [2] default    (linear deflection 0.5  - balanced)")
    print(f"    [3] fine       (linear deflection 0.2  - smooth surfaces)")
    print(f"    [4] very fine  (linear deflection 0.05 - slow but pristine)")
    print(f"    [c] custom...")
    ans = _ask("  Choose [2]: ", "2")
    if ans == "1": quality = "1.0"
    elif ans == "3": quality = "0.2"
    elif ans == "4": quality = "0.05"
    elif ans.lower() == "c":
        q = _ask("    Enter linear deflection (smaller = finer): ", "0.5")
        try: float(q); quality = q
        except ValueError: quality = "0.5"
    else: quality = "0.5"

    print()
    cmd = [PYTHON_BIN, str(ROOT / "step2glb.py"), str(src),
           "--out", str(dst), "--quality", quality, "--force-colors",
           "--no-meshopt"]
    # --force-colors guarantees the XCAF reader runs regardless of file size,
    # so the new hierarchical path (assembly tree + instance detection) always
    # fires. Without this, files over the auto-threshold silently fall back to
    # the flat plain reader and you lose names + hierarchy + instances.
    # --no-meshopt: left alone, the converter compresses the GLB whenever
    # gltfpack happens to be installed; what the app opens should not depend
    # on that.
    # (No question about worker processes here: --parallel only applies to the
    # plain reader, and --force-colors rules that reader out.)
    if force: cmd.append("--force")
    print(f"  Running: step2glb.py {src.name} --quality {quality} --force-colors --no-meshopt"
          + (" --force" if force else ""))
    print()
    rc = subprocess.call(cmd, cwd=ROOT)
    if rc != 0:
        print(f"\n  Conversion failed with exit code {rc}.")
        return None
    return dst


# ─── /api/convert background job runner (for in-browser drag-and-drop)
def _convert_thread(job_id: str, src_path: Path, dst_path: Path,
                     quality: float, min_size: float,
                     opts: dict | None = None) -> None:
    """Spawn step2glb.py for the queued upload.

    `opts` carries the optional import-settings modal flags. None / missing
    keys preserve the old defaults so existing callers (interactive_convert,
    older clients without the modal) keep working unchanged.
    """
    opts = opts or {}
    cad_name = _CAD_NAMES.get(src_path.suffix.lower(), "CAD")
    with JOBS_LOCK:
        # Cancel can arrive before this thread gets going. Then there is
        # nothing to start, and the job must stay "cancelled".
        cancelled = JOBS[job_id].get("status") == "cancelled"
        if not cancelled:
            JOBS[job_id]["status"] = "running"
            JOBS[job_id]["log"] = []
            JOBS[job_id]["log_base"] = 0
    if cancelled:
        try: src_path.unlink(missing_ok=True)
        except OSError: pass
        return
    try:
        # Color mode: 'on' = always XCAF (what we used to always do via
        # --force-colors); 'auto' = step2glb.py's size-aware default; 'off'
        # = plain reader, fastest, no colors/hierarchy.
        colors = opts.get("colors", "on")
        # --no-meshopt: left alone, the converter compresses the GLB whenever
        # gltfpack happens to be installed; what the app gets should not
        # depend on that.
        cmd = [PYTHON_BIN, str(ROOT / "step2glb.py"), str(src_path),
               "--out", str(dst_path), "--quality", str(quality),
               "--no-meshopt"]
        if colors == "on":   cmd += ["--force-colors"]
        elif colors == "off": cmd += ["--no-colors"]
        # XCAF read-mode toggles — only meaningful when colors != 'off'.
        if colors != "off":
            if not opts.get("shuo",      True): cmd += ["--no-shuo"]
            if not opts.get("layers",    True): cmd += ["--no-layers"]
            if not opts.get("materials", True): cmd += ["--no-materials"]
            if not opts.get("names",     True): cmd += ["--no-step-names"]
            if not opts.get("props",     True): cmd += ["--no-step-props"]
        if not opts.get("instance", True):       cmd += ["--no-instance"]
        if opts.get("force"):                    cmd += ["--force"]
        if min_size > 0: cmd += ["--min-size", str(min_size)]
        # Tessellation settings of the import window. Each is left out when it
        # is the converter's own default, so an older client changes nothing.
        if opts.get("angular"):  cmd += ["--angular", f"{opts['angular']:.6f}"]
        if opts.get("tiers"):    cmd += ["--tiers", opts["tiers"]]
        if opts.get("min_edge"): cmd += ["--min-edge", str(opts["min_edge"])]
        if not opts.get("normals", True): cmd += ["--no-normals"]
        if opts.get("swap_yz"):  cmd += ["--swap-yz"]
        # Log which Python interpreter we're calling — makes it obvious in the
        # browser conversion log when a stale serve.py is still using the
        # global Python instead of the venv one.
        with JOBS_LOCK:
            JOBS[job_id]["log"].append(f"using Python: {PYTHON_BIN}")
            JOBS[job_id]["message"] = f"using Python: {PYTHON_BIN}"
        # The converter prints UTF-8. Decoding with the Windows code page
        # garbled its log and could raise on a path with accented letters.
        # Away from Windows the converter gets a session of its own, so that
        # Cancel can stop it together with its heartbeat helper (_kill_tree
        # signals the whole process group). On Windows taskkill /T does that.
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, encoding="utf-8", errors="replace",
                                bufsize=1, cwd=ROOT,
                                start_new_session=(os.name != "nt"))
        _contain(proc)
        with JOBS_LOCK:
            PROCS[job_id] = proc
            cancelled = JOBS[job_id].get("status") == "cancelled"
        # Cancelled while the process was starting: /api/cancel found nothing
        # to stop then, so it is stopped here.
        if cancelled: _kill_tree(proc)
        for line in proc.stdout:
            line = line.rstrip()
            with JOBS_LOCK:
                job = JOBS[job_id]
                job["log"].append(line)
                dropped = len(job["log"]) - MAX_LOG_LINES
                if dropped > 0:
                    job["log"] = job["log"][dropped:]
                    job["log_base"] = job.get("log_base", 0) + dropped
                job["message"] = line
        rc = proc.wait()
        with JOBS_LOCK:
            PROCS.pop(job_id, None)
            cancelled = JOBS[job_id].get("status") == "cancelled"
            # the converter's last error line, for the message below
            said = next((l.strip()[1:].strip() for l in reversed(JOBS[job_id]["log"])
                         if l.strip().startswith("✗")), "")
        if cancelled:
            for stale in (src_path, src_path.with_suffix(".xcaf-cache.xbf"), dst_path):
                try: stale.unlink(missing_ok=True)
                except OSError: pass
            return
        # 3 is the converter's "read the file, found nothing to write": no
        # solid bodies in it, or the minimum-size setting removed every part.
        if rc == 3:
            raise RuntimeError("Nothing to convert: " + (said or f"this {cad_name} file has no solid bodies in it"))
        if rc != 0:
            raise RuntimeError(f"step2glb.py exited with code {rc}")
        # The converter can finish without an error and without a file: a STEP
        # that holds only surfaces or wires has no solid for it to mesh.
        if not dst_path.exists():
            for stale in (src_path, src_path.with_suffix(".xcaf-cache.xbf")):
                try: stale.unlink(missing_ok=True)
                except OSError: pass
            raise RuntimeError(f"Nothing to convert: this {cad_name} file has no solid bodies in it")
        # Drop the uploaded STEP + its XCAF binary cache — both are large
        # (often hundreds of MB) and only useful during the conversion. The
        # .glb is the durable artifact the user keeps.
        for stale in (src_path, src_path.with_suffix(".xcaf-cache.xbf")):
            try: stale.unlink(missing_ok=True)
            except OSError: pass
        with JOBS_LOCK:
            JOBS[job_id]["status"] = "done"
            JOBS[job_id]["result"] = dst_path.name
            JOBS[job_id]["progress"] = 100
    except Exception as e:
        with JOBS_LOCK:
            PROCS.pop(job_id, None)
            if JOBS[job_id].get("status") != "cancelled":
                JOBS[job_id]["status"] = "error"
                JOBS[job_id]["message"] = str(e)
        # A failed job leaves nothing worth keeping; don't let uploads pile up.
        for stale in (src_path, src_path.with_suffix(".xcaf-cache.xbf")):
            try: stale.unlink(missing_ok=True)
            except OSError: pass


# ─── HTTP handler ─────────────────────────────────────────────────────────
# ── Claude connection (MCP) ───────────────────────────────────────────────
# Claude talks to this server at /mcp (Streamable HTTP, plain JSON replies). The
# app in the browser cannot be called, so it calls us: while "Let Claude
# connect" is on in Settings, the page keeps one request open at
# /api/bridge/poll, we hand it the command there, and it posts the answer to
# /api/bridge/result. Nothing here runs unless a page is polling.
MCP_VERSIONS = ("2025-06-18", "2025-03-26", "2024-11-05")
BRIDGE = {"cv": threading.Condition(), "queue": [], "results": {}, "last_poll": 0.0, "prog": {}, "cancel": set(), "rpc": {}}
# What Claude asked for since the server started: printed in this window as it happens, and read at /api/bridge/status.
MCP_STATS = {"since": time.time(), "calls": 0, "errors": 0, "connects": 0, "tools": {}}

def _mcp_log(text):
    """One line in the window that runs the app. A log line must never break a call (a console that cannot show a character, a closed pipe)."""
    try:
        line = f"  {time.strftime('%H:%M:%S')}  mcp  {text}\n"
        enc = getattr(sys.stderr, "encoding", None) or "utf-8"
        sys.stderr.write(line.encode(enc, "replace").decode(enc, "replace")); sys.stderr.flush()
    except Exception:
        pass

def _brief(args):
    try:
        parts = []
        for k, v in (args or {}).items():
            parts.append(f"{k}={len(v)} items" if isinstance(v, (list, dict)) else f"{k}={json.dumps(v)[:24]}")
        return " ".join(parts)[:90]
    except Exception: return ""

def _obj(props=None, required=None):
    s = {"type": "object", "properties": props or {}}
    if required: s["required"] = required
    return s

MCP_TOOLS = [
    {"name": "scene_summary", "description": "What is open in MeshOptimiser: file name, number of parts, triangles and vertices, overall size, how many are selected or hidden, the view mode, and whether the view is isolated.", "inputSchema": _obj()},
    {"name": "list_parts", "description": "List parts of the open scene with id, name, triangles, vertices, size, colour, visibility and selection. Filter by name, restrict to the selection, sort, and page through with limit and offset. Sizes are in the scene's units (usually millimetres).",
     "inputSchema": _obj({
         "name_contains": {"type": "string", "description": "Keep parts whose name contains this text (case-insensitive)."},
         "selected_only": {"type": "boolean", "description": "Only the parts that are selected now."},
         "hidden_only": {"type": "boolean", "description": "Only the parts that are hidden."},
         "sort_by": {"type": "string", "enum": ["triangles", "size", "name"], "description": "Largest first for triangles and size; A to Z for name. Default: the order in the tree."},
         "limit": {"type": "integer", "description": "How many to return (default 40, at most 500)."},
         "offset": {"type": "integer", "description": "How many to skip (default 0)."}})},
    {"name": "get_selection", "description": "The parts that are selected now (up to 100), with the total.", "inputSchema": _obj()},
    {"name": "select_parts", "description": "Change the selection in the app: by part ids, by a piece of the name, or both. Mode replace (default), add or remove. Non-destructive: nothing is edited or deleted.",
     "inputSchema": _obj({
         "ids": {"type": "array", "items": {"type": "integer"}, "description": "Part ids from list_parts."},
         "name_contains": {"type": "string", "description": "Every part whose name contains this text (case-insensitive)."},
         "mode": {"type": "string", "enum": ["replace", "add", "remove"]}})},
    {"name": "frame_selection", "description": "Move the camera to frame the selected parts (the F key). Select something first.", "inputSchema": _obj()},
    {"name": "screenshot", "description": "A picture of the viewport, so you can see what the user sees. To SHOW a result (what was found or selected, before and after) pass frame \"model\" or \"selection\": the picture is framed edge to edge on it, without the move handles, and the user's camera is put back afterwards.",
     "inputSchema": _obj({"width": {"type": "integer", "description": "Width in pixels (default 1280, at most 2400). The height follows the viewport's shape."},
                          "frame": {"type": "string", "enum": ["view", "model", "selection"], "description": "view (default): the viewport exactly as it is. model: every visible part fills the picture. selection: the selected parts fill it."}})},
]

_IDS = {"type": "array", "items": {"type": "integer"}, "description": "From list_parts."}
_NAME = {"type": "string", "description": "Parts whose name contains this."}
_WHICH = "Parts: ids, name_contains, or the selection."
MCP_TOOLS += [
    {"name": "hide_parts", "description": "Hide parts (the H key). " + _WHICH + " Hidden parts are only hidden, not removed.", "inputSchema": _obj({"ids": _IDS, "name_contains": _NAME})},
    {"name": "isolate_parts", "description": "Show only these parts and hide the rest (the S key). " + _WHICH + " Use show_all to leave the isolation.", "inputSchema": _obj({"ids": _IDS, "name_contains": _NAME})},
    {"name": "show_all", "description": "Show every hidden part again and leave an isolated view (Alt+H).", "inputSchema": _obj()},
    {"name": "set_view_mode", "description": "Change how the viewport draws the model: solid (key 1), wire (2), xray (3), heat (4, the triangle-density heatmap), clay (5) or cad (6).", "inputSchema": _obj({"mode": {"type": "string", "enum": ["solid", "wire", "xray", "heat", "clay", "cad"]}}, ["mode"])},
    {"name": "select_all", "description": "Select every visible part, or with invert true flip the selection (Ctrl+A, Ctrl+I).", "inputSchema": _obj({"invert": {"type": "boolean"}})},
    {"name": "duplicate_parts", "description": "Duplicate parts (Ctrl+D). The user is asked to allow it. " + _WHICH, "inputSchema": _obj({"ids": _IDS, "name_contains": _NAME})},
    {"name": "group_parts", "description": "Put parts into one group in the tree (Ctrl+G). The user is asked to allow it. " + _WHICH, "inputSchema": _obj({"ids": _IDS, "name_contains": _NAME})},
    {"name": "merge_by_colour", "description": "Merge parts that share a colour into one mesh per colour. The user is asked to allow it. " + _WHICH + " With neither, it works on the selection, or the whole visible scene if nothing is selected.", "inputSchema": _obj({"ids": _IDS, "name_contains": _NAME})},
    {"name": "set_explode", "description": "Explode the view: push the parts apart from the centre of the model (the Explode panel's Amount slider). Only moves the view, nothing is changed in the model. Amount 0 puts the parts back. It lets go of the selection.",
     "inputSchema": _obj({"amount": {"type": "number", "description": "Percent, 0 to 300 (the panel's presets are 25 to 100). 0 = back together."},
         "axes": {"type": "array", "items": {"type": "string", "enum": ["x", "y", "z"]}, "description": "Which axes move (default all three)."}}, ["amount"])},
    {"name": "set_grid", "description": "Show or hide the ground grid (G).", "inputSchema": _obj({"visible": {"type": "boolean", "description": "true shows it (default), false hides it."}})},
    {"name": "measure_parts", "description": "Distance between two parts: centre to centre, and the gap between their bounding boxes, with each part's size. In the scene's units (usually mm).", "inputSchema": _obj({"ids": {"type": "array", "items": {"type": "integer"}, "description": "Exactly two part ids from list_parts."}}, ["ids"])},
    {"name": "find_stacked_copies", "description": "Find parts that sit on an identical copy (same shape, same place) and select the extra copies; the first of each group is kept. Delete them afterwards with delete_parts.", "inputSchema": _obj({"tolerance_percent": {"type": "number", "description": "How close counts as the same place, in percent of the part (0 to 5, default what the app uses)."}, "near_copies": {"type": "boolean", "description": "Also count parts whose triangle count differs a little."}})},
    {"name": "list_groups", "description": "The groups in the tree: the ones made in the app (user groups, which ungroup can dissolve) and the ones that come from the file's own hierarchy.", "inputSchema": _obj()},
    {"name": "ungroup", "description": "Dissolve groups made in the app (Ctrl+Shift+G). The user is asked to allow it. The parts stay.", "inputSchema": _obj({"group_ids": {"type": "array", "items": {"type": "string"}, "description": "Ids from list_groups."}, "name_contains": {"type": "string", "description": "Every group whose name contains this."}})},
    {"name": "scene_tabs", "description": "The scene tabs of the app: list them, switch to one (later tools act on the scene that is on screen), or open a new empty one.", "inputSchema": _obj({"action": {"type": "string", "enum": ["list", "switch", "new"]}, "index": {"type": "integer"}, "title_contains": {"type": "string"}})},
    {"name": "rename_parts", "description": "Rename parts. The user is asked to allow it. Either renames: [{id, name}], or find + replace and/or prefix / suffix applied to the parts chosen. " + _WHICH, "inputSchema": _obj({"renames": {"type": "array", "items": _obj({"id": {"type": "integer"}, "name": {"type": "string"}}, ["id", "name"])}, "find": {"type": "string"}, "replace": {"type": "string"}, "prefix": {"type": "string"}, "suffix": {"type": "string"}, "ids": _IDS, "name_contains": _NAME})},
    {"name": "transform_parts", "description": "Move, turn and/or scale parts, relative to where they are, along the scene's axes. Turning and scaling are about the middle of the chosen parts together. The user is asked to allow it. Not while the view is exploded. " + _WHICH, "inputSchema": _obj({"move": {"type": "array", "items": {"type": "number"}, "description": "[x, y, z] in the scene's units."}, "rotate_degrees": {"type": "array", "items": {"type": "number"}, "description": "[x, y, z] degrees."}, "scale": {"description": "A number (all axes) or [x, y, z]; not together with a turn when the axes differ."}, "ids": _IDS, "name_contains": _NAME})},
    {"name": "recenter_model", "description": "Move the whole model so its middle is at the origin. The user is asked to allow it.", "inputSchema": _obj()},
    {"name": "align_to_floor", "description": "Stand the whole model on the floor, centred over 0,0,0 (with the choices of the app's Align to floor card). The user is asked to allow it.", "inputSchema": _obj()},
    {"name": "split_parts", "description": "Split meshes into their disconnected pieces, as separate parts. The user is asked to allow it. " + _WHICH + " Or whole_scene true to scan everything.", "inputSchema": _obj({"ids": _IDS, "name_contains": _NAME, "whole_scene": {"type": "boolean"}, "method": {"type": "string", "enum": ["vertex", "edge", "spatial", "hybrid"], "description": "How pieces are found (default vertex: triangles that share a vertex)."}})},
    {"name": "repair_mesh", "description": "Mend broken geometry: join doubled vertices, remove empty and doubled triangles, turn faces the same way. The user is asked to allow it. " + _WHICH + " With neither, the whole scene.", "inputSchema": _obj({"ids": _IDS, "name_contains": _NAME, "weld": {"type": "boolean"}, "degenerate": {"type": "boolean"}, "orient": {"type": "boolean"}, "smooth_normals": {"type": "boolean"}})},
    {"name": "remove_hidden_faces", "description": "Delete faces that can never be seen from outside (the inside of a housing, where parts press together). Slow on big scenes: start with a few parts. The user is asked to allow it. " + _WHICH, "inputSchema": _obj({"ids": _IDS, "name_contains": _NAME, "whole_scene": {"type": "boolean"}, "views": {"type": "integer", "enum": [26, 64, 128], "description": "Directions looked from: 26 fast, 64 normal (default), 128 thorough."}, "keep_neighbours": {"type": "boolean", "description": "Keep faces next to visible ones (default true)."}})},
    {"name": "smart_optimise", "description": "The app's Smart optimise: every clean-up in the right order on the whole scene, as ONE undo step. The user is asked to allow it. Levels: auto (picks from the size of the scene), light (only empty and broken parts), balanced (also hidden parts, bolts to cylinders, parts under 1% of the model, half the triangles), strong (parts under 2%, fills holes, a quarter of the triangles). Every step can be overridden. Read playbook optimise first; start with light or balanced and look.",
     "inputSchema": _obj({"level": {"type": "string", "enum": ["auto", "light", "balanced", "strong"], "description": "How far to go (default auto)."},
         "target_triangles": {"type": "integer", "description": "Triangles the whole scene may have after the run."},
         "reduce_triangles": {"type": "boolean", "description": "false: only remove and tidy, keep every triangle of what stays."},
         "remove_empty": {"type": "boolean"}, "remove_hidden": {"type": "boolean", "description": "Remove parts that cannot be seen from outside. Not for a model that will be opened or exploded."},
         "fasteners": {"type": "string", "enum": ["keep", "simplify", "delete"], "description": "Bolts, nuts and washers: keep, turn into plain cylinders, or delete."},
         "remove_parts_under_percent": {"type": "number", "description": "Remove parts smaller than this share of the model (0 leaves small parts alone)."},
         "fill_holes": {"type": "boolean"}, "remove_exact_copies": {"type": "boolean"}, "reduce_within_mm": {"type": "number", "description": "Take out triangles for as long as no point of a surface moves more than this (0 leaves it out)."}})},
    {"name": "find_hidden_parts", "description": "Find parts that cannot be seen from outside from any direction (screws in a housing, a board under a cover) and select them. Only selects; isolate_parts to look, then delete_parts. Not for a model that will be opened, looked into or exploded.",
     "inputSchema": _obj({"accuracy": {"type": "string", "enum": ["fast", "normal", "thorough"], "description": "How many directions it looks from (default normal)."},
         "selection_only": {"type": "boolean"}, "see_through_hides": {"type": "boolean", "description": "Glass and clear covers hide what is behind them (default: they do not)."},
         "max_size_percent": {"type": "number", "description": "Keep only hidden parts up to this share of the model's size."}, "name_contains": {"type": "string"}, "add": {"type": "boolean", "description": "Add to the selection instead of replacing it."}})},
    {"name": "smart_fit", "description": "Replace parts with a simple shape of the same size and place: box, turned_box, cylinder, few_boxes (keeps a bracket's outline in a handful of boxes) or blocks (a coarse grid that keeps steps and openings). The most drastic reducing tool: the part's own mesh is thrown away. The user is asked to allow it. " + _WHICH,
     "inputSchema": _obj({"ids": _IDS, "name_contains": _NAME, "shape": {"type": "string", "enum": ["auto", "box", "turned_box", "cylinder", "few_boxes", "blocks"], "description": "Default auto."},
         "max_boxes": {"type": "integer", "description": "For few_boxes: the most boxes a part may become (1 to 32, default 6)."}, "blocks_detail": {"type": "integer", "description": "For blocks: cells along the longest side (2 to 48, default 8)."}})},
    {"name": "untriangulate", "description": "Join neighbouring triangles that lie in one plane and triangulate each flat face again with the fewest triangles. The shape does not change at all: a free reduction on CAD models. The user is asked to allow it. Works on the chosen parts, or on the whole scene if none are given.",
     "inputSchema": _obj({"ids": _IDS, "name_contains": _NAME})},
    {"name": "search_docs", "description": "Search the app's own knowledge base: the playbooks (how to optimise, recipes by goal, judgement, safety, troubleshooting) and about 50 help articles, one per tool and job. Use it before guessing how a tool works, and for a symptom (flicker, lying on its side, too big). Answered by the server: the app need not be open.",
     "inputSchema": _obj({"query": {"type": "string", "description": "Words or a question."}, "limit": {"type": "integer", "description": "How many results (1 to 10, default 5)."}}, ["query"])},
    {"name": "read_doc", "description": "Read one article or playbook of the knowledge base in full. name: a slug from search_docs (smart-optimise, fasteners, fill-holes, workflow, ...) or a playbook (optimise, goals, judgement, tools, safety, troubleshooting).",
     "inputSchema": _obj({"name": {"type": "string"}}, ["name"])},
    {"name": "render_image", "description": "A picture for a client or a report: big and smooth (up to 8192 px), saved as a PNG in the exports folder, with a small preview returned so you can judge it. Choose the camera (view or views: several make a contact sheet and one file each), the look (mode: solid, clay, cad, ...), the background (transparent, white, light, grey, dark, black) and whether the grid is hidden. The model is framed to fill the picture (fit). For a quick look at the viewport use screenshot.",
     "inputSchema": _obj({"width": {"type": "integer", "description": "Pixels, 320 to 8192 (default 2560); a picture is kept under about 36 million pixels in all, so 8192 x 8192 is made 6000 x 6000."}, "height": {"type": "integer", "description": "Pixels, 180 to 8192 (default 1440)."},
         "view": {"type": "string", "enum": ["current", "perspective", "top", "front", "side"]}, "views": {"type": "array", "items": {"type": "string", "enum": ["current", "perspective", "top", "front", "side"]}, "description": "Up to 6 views: one file each, one contact sheet as the preview."},
         "mode": {"type": "string", "enum": ["current", "solid", "clay", "cad", "wire", "xray", "heat"], "description": "How the model is drawn for this picture (default: as now)."},
         "background": {"type": "string", "enum": ["current", "transparent", "white", "light", "grey", "dark", "black"]}, "hide_grid": {"type": "boolean", "description": "Default true."},
         "fit": {"type": "boolean", "description": "Frame the whole model first (default true). false keeps the camera where it is."}, "quality": {"type": "string", "enum": ["high", "draft"], "description": "high draws at twice the size and scales down (default); draft is quicker."},
         "preview": {"type": "boolean", "description": "Return a small picture as well as the file path (default true)."}})},
    {"name": "select_similar", "description": "Select the parts that are the same shape as the chosen ones (or close to it): the other copies of a bolt, every washer of one kind. " + _WHICH, "inputSchema": _obj({"ids": _IDS, "name_contains": _NAME})},
    {"name": "select_by_colour", "description": "Select every visible part with the same colour as the chosen parts, or with a colour you give. Only selects.", "inputSchema": _obj({"ids": _IDS, "name_contains": _NAME, "colour": {"type": "string", "description": "A hex colour such as #ff8800, instead of taking it from parts."}, "mode": {"type": "string", "enum": ["replace", "add", "remove"]}})},
    {"name": "list_materials", "description": "The materials of the scene: name, colour, how many parts use each, metalness, roughness and opacity.", "inputSchema": _obj({"name_contains": _NAME})},
    {"name": "select_by_material", "description": "Select the visible parts that use a material (by part of its name, see list_materials). Only selects.", "inputSchema": _obj({"name_contains": {"type": "string"}, "mode": {"type": "string", "enum": ["replace", "add", "remove"]}}, ["name_contains"])},
    {"name": "check_model", "description": "A health check in one call, as an experienced user would do in the first minute: where the triangles are (the heaviest parts and their share), how many parts are tiny, very thin, empty, drawn twice, hidden or instanced, whether the size looks like millimetres, and advice on what to do next. Changes nothing. Start here after scene_summary.", "inputSchema": _obj({"low_triangles": {"type": "integer", "description": "Parts under this many triangles count as low (default 12)."}})},
    {"name": "optimisation_report", "description": "The app's Optimisation report as data: triangles, vertices, parts, draw calls, materials, mesh memory and file size, the file as it was opened against now, with the change in percent, and the largest surface move the reductions caused. For a client note or a before-and-after line.", "inputSchema": _obj()},
    {"name": "estimate_export_size", "description": "What a GLB of the visible parts would weigh (plain and with Draco, estimated) and whether it fits the app's usual limits for a web page (5 MB, 100k triangles), Shopify (15 MB), Apple AR Quick Look (10 MB) and a phone app (25 MB, 200k). Use it to know how far to optimise before you export.", "inputSchema": _obj()},
    {"name": "list_recipes", "description": "The Smart optimise recipes saved in the app: a name and the steps (clean, copies, hidden, fasteners, small parts, holes, tolerance, reduce, target).", "inputSchema": _obj()},
    {"name": "run_recipe", "description": "Run a saved Smart optimise recipe on the whole scene: the user's own house settings. One undo step. The user is asked to allow it.", "inputSchema": _obj({"name": {"type": "string", "description": "From list_recipes."}}, ["name"])},
    {"name": "list_library", "description": "The app's library of standard parts (shapes, fasteners, nuts, pipes, profiles, machine parts and more), by shelf.", "inputSchema": _obj({"query": {"type": "string", "description": "Filter by a word."}})},
    {"name": "add_library_part", "description": "Add a standard part from the library to the scene. The user is asked to allow it. Move it afterwards with transform_parts.", "inputSchema": _obj({"kind": {"type": "string", "description": "From list_library, the word before the bracket."}, "count": {"type": "integer", "description": "1 to 20 (default 1)."}}, ["kind"])},
    {"name": "save_scene", "description": "Save the scene as a scene file (a GLB that keeps the hierarchy and the hidden parts, with every edit) in the exports folder. Reopen it with open_file.", "inputSchema": _obj({"file_name": {"type": "string", "description": "A name without the extension."}})},
    {"name": "set_camera_view", "description": "Move the camera to a standard view, or fit the whole model.", "inputSchema": _obj({"view": {"type": "string", "enum": ["perspective", "top", "front", "side", "fit"]}}, ["view"])},
    {"name": "undo", "description": "Undo the last step in the app (Ctrl+Z), once or several times.", "inputSchema": _obj({"steps": {"type": "integer", "description": "How many steps (default 1, at most 20)."}})},
    {"name": "redo", "description": "Redo what was undone (Ctrl+Y).", "inputSchema": _obj({"steps": {"type": "integer", "description": "How many steps (default 1, at most 20)."}})},
    {"name": "find_fasteners", "description": "Find bolts, screws, nuts and washers by their shape (whatever the parts are called), and select them so you can isolate, hide, smart_fit (cylinder) or delete them. Only selects. Returns the count, the triangles, and the sizes found per kind.",
     "inputSchema": _obj({"kinds": {"type": "array", "items": {"type": "string", "enum": ["bolts", "nuts", "washers", "pins"]}, "description": "Default bolts, nuts and washers."},
         "max_thread_mm": {"type": "number", "description": "Largest thread to look for, M-size in mm (default 30)."}, "min_thread_mm": {"type": "number"}, "certain_only": {"type": "boolean", "description": "Only clear fastener shapes (default: likely ones too)."},
         "used_at_least": {"type": "integer", "description": "Only fasteners of a shape and size that the scene holds at least this many times."}, "selection_only": {"type": "boolean"}, "add": {"type": "boolean"}})},
    {"name": "delete_parts", "description": "Delete parts. The user is asked to allow it in the app. " + _WHICH + " Can be undone with the undo tool.", "inputSchema": _obj({"ids": _IDS, "name_contains": _NAME})},
    {"name": "merge_parts", "description": "Merge two or more parts into one mesh. The user is asked to allow it. " + _WHICH, "inputSchema": _obj({"ids": _IDS, "name_contains": _NAME})},
    {"name": "decimate", "description": "Reduce the triangles of parts. The user is asked to allow it. " + _WHICH + " Give target_triangles (for the whole group of parts) or reduce_percent. Returns the triangle counts before and after.",
     "inputSchema": _obj({"ids": _IDS, "name_contains": _NAME,
         "target_triangles": {"type": "integer", "description": "Triangles to keep, in total, across these parts."},
         "reduce_percent": {"type": "number", "description": "Share of the triangles to remove, 5 to 95."}})},
    {"name": "fit_to_budget", "description": "Reduce the whole scene to a triangle budget, taking from the parts that can best spare it. The user is asked to allow it.", "inputSchema": _obj({"target_triangles": {"type": "integer"}}, ["target_triangles"])},
    {"name": "fill_holes", "description": "Close bolt holes, slots and pockets in flat faces up to a size. The user is asked to allow it. Acts on the selected parts, or on the visible scene if nothing is selected and no ids are given.",
     "inputSchema": _obj({"max_hole_mm": {"type": "number", "description": "The largest hole to fill, in mm (default 10)."}, "ids": _IDS, "name_contains": _NAME})},
    {"name": "remove_small_parts", "description": "Delete every part whose longest side is below a size, in the scene's units (usually mm). The user is asked to allow it.", "inputSchema": _obj({"max_size": {"type": "number", "description": "Parts shorter than this are removed."}}, ["max_size"])},
    {"name": "clean_up", "description": "Tidy the scene. The user is asked to allow it. Choose what to do: remove empty parts, share the geometry of identical parts (duplicates), and repair degenerate triangles.",
     "inputSchema": _obj({"empty": {"type": "boolean"}, "duplicates": {"type": "boolean"}, "degenerate": {"type": "boolean"}})},
    {"name": "export_model", "description": "Export the open scene to a file in MeshOptimiser's exports folder and return its path. Use a preset for where the file is going (web: GLB with Draco; ar: USDZ; unreal and unity: FBX; print: STL) or give a format.",
     "inputSchema": _obj({"preset": {"type": "string", "enum": ["web", "ar", "unreal", "unity", "print"]},
         "format": {"type": "string", "enum": ["glb", "gltf", "fbx", "usdz", "obj", "stl"]},
         "file_name": {"type": "string", "description": "A name without the extension."},
         "compression": {"type": "string", "enum": ["none", "draco", "meshopt"], "description": "For a GLB: none, draco (the safe choice, every viewer), or meshopt (usually smaller and faster to open; the viewer must read EXT_meshopt_compression: three.js, Babylon.js and model-viewer do). Overrides the preset."},
         "faster_to_draw": {"type": "boolean", "description": "For a GLB without compression: reorder the triangles and vertices for the graphics card. The shape does not change; any viewer opens it. Meshopt already does this."}})},
    {"name": "turntable_video", "description": "Render a video of the model turning once (WebM) into the exports folder and return its path.",
     "inputSchema": _obj({"seconds": {"type": "integer", "description": "4 to 12 (default 6)."}, "width": {"type": "integer", "description": "Default 1280."}, "height": {"type": "integer", "description": "Default 720."}, "fps": {"type": "integer", "description": "24, 30 or 60 (default 30)."}})},
    {"name": "open_file", "description": "Open a model file from this computer in the app (STEP, IGES, BREP, GLB, glTF, FBX, OBJ, 3MF, STL). It opens in a new scene tab if something is already open.",
     "inputSchema": _obj({"path": {"type": "string", "description": "The full path of the file."}}, ["path"])},
]

_TARGETS = {"preset": {"type": "string", "enum": ["web", "shopify", "ar", "phone"], "description": "The app's own guidelines: web about 5 MB and 100,000 triangles; shopify 15 MB; ar (Apple AR Quick Look) 10 MB and 100,000; phone 25 MB and 200,000."},
            "target_mb": {"type": "number", "description": "The size to stay under, in MB (as estimated for the GLB the Export dialog would write)."},
            "target_triangles": {"type": "integer", "description": "The triangles to stay under."},
            "level": {"type": "string", "enum": ["none", "light", "balanced", "strong"], "description": "How hard Smart optimise works first (default light; none skips it and only tidies and reduces)."},
            "draco": {"type": "boolean", "description": "Count the size as a GLB with Draco, about a fifth of the plain size (default true, false for ar)."}}
MCP_TOOLS += [
    {"name": "optimise_to_target", "description": "Get the whole scene under a size or triangle goal in one call: tidy up, Smart optimise, then reduce the triangles in rounds, checking the app's own size estimate each time, until it fits or nothing more can go. The user is asked once and can stop it from the Claude pill. Reports before and after and how many undo steps it took. Try dry_run first to see what it would reach.",
     "inputSchema": _obj({**_TARGETS, "max_rounds": {"type": "integer", "description": "Rounds of triangle reduction, 1 to 6 (default 4)."}})},
    {"name": "compare_images", "description": "One picture with the model as it was opened on the left and as it is now on the right, same camera, with the triangle and part counts and the size under each. Made by stepping back through the undo history and forward again: the scene ends exactly as it was. Saved as a PNG in the exports folder. The proof for a client or a report after optimising.",
     "inputSchema": _obj({"steps_back": {"type": "integer", "description": "How many undo steps to compare against (default: all of them, up to 60)."},
         "view": {"type": "string", "enum": ["current", "perspective", "front", "side", "top"]}, "mode": {"type": "string", "enum": ["solid", "wire", "xray", "heat", "clay", "cad", "current"], "description": "Default solid. heat shows the triangle density."},
         "background": {"type": "string", "enum": ["white", "light", "grey", "dark", "black", "transparent", "current"], "description": "Default white."},
         "width": {"type": "integer", "description": "Width of each half (default 1600, at most 2048)."}, "height": {"type": "integer", "description": "Height (default 1000, at most 1536)."},
         "quality": {"type": "string", "enum": ["draft", "smooth"]}})},
    {"name": "list_folder", "description": "The model files in a folder on this computer (STEP, IGES, BREP, GLB, glTF, FBX, OBJ, 3MF, STL): name, path and size. Read only. Use it before batch_optimise.",
     "inputSchema": _obj({"path": {"type": "string", "description": "The full path of the folder."}, "recursive": {"type": "boolean", "description": "Look inside sub-folders too."}}, ["path"])},
    {"name": "batch_optimise", "description": "Optimise a whole folder of models, one after another: each file opens in a scene tab of its own (the scene the user has open is not touched), is optimised (a saved recipe, a size or triangle goal, or Smart optimise), is exported into the exports folder as name_optimised, and its tab is closed. The user is asked once and can stop it from the Claude pill. Returns one line per file. Try dry_run first to list what would be processed.",
     "inputSchema": _obj({"folder": {"type": "string", "description": "A folder with model files."}, "files": {"type": "array", "items": {"type": "string"}, "description": "Or a list of full paths."},
         "recursive": {"type": "boolean"}, "max_files": {"type": "integer", "description": "At most this many files (default 20, at most 100)."},
         "recipe": {"type": "string", "description": "A saved Smart optimise recipe (list_recipes) to run on each file."}, **_TARGETS,
         "export_preset": {"type": "string", "enum": ["web", "ar", "unreal", "unity", "print"], "description": "Default web (GLB with Draco)."},
         "export_format": {"type": "string", "enum": ["glb", "gltf", "fbx", "usdz", "obj", "stl"], "description": "Instead of a preset."},
         "timeout_seconds": {"type": "integer", "description": "How long to wait for one file to open (default 900; STEP conversion can be slow)."},
         "dry_run": {"type": "boolean", "description": "Only list what would be processed. Opens nothing."}})},
]
_SHARP_TOOLS = {"decimate", "fit_to_budget", "smart_optimise", "optimise_to_target"}
_DRY_TOOLS = {"delete_parts", "remove_small_parts", "merge_parts", "merge_by_colour", "decimate", "fit_to_budget", "fill_holes", "remove_hidden_faces", "repair_mesh",
              "clean_up", "duplicate_parts", "smart_optimise", "smart_fit", "untriangulate", "run_recipe", "optimise_to_target"}
for _t in MCP_TOOLS:
    if _t["name"] in _SHARP_TOOLS:
        _t["inputSchema"].setdefault("properties", {})["keep_sharp_edges"] = {"type": "boolean", "description": "Hold on to the hard edges of each part (rims, steps, corners) while triangles are taken out, as far as the goal allows. Default: what the Keep sharp edges switch in the app says (on). Parts that are mostly hard edges, like gears, are reduced as before."}
    if _t["name"] in _DRY_TOOLS:
        _t["inputSchema"].setdefault("properties", {})["dry_run"] = {"type": "boolean", "description": "Try it without keeping it: the step is done, the numbers are read, and it is taken back with undo. Nothing is asked and nothing stays changed. The reply says what it would do."}
# Jobs that stream progress to a client that asks for it (a progress token and text/event-stream)
_STREAMED = {"optimise_to_target", "batch_optimise", "compare_images", "turntable_video", "fit_to_budget", "smart_optimise", "run_recipe"}
MCP_TIMEOUT_MORE = {"optimise_to_target": 1800, "compare_images": 900, "batch_optimise": 7200, "list_folder": 60}
# Long jobs get longer: seconds the server waits for the app's answer.
MCP_TIMEOUT = {"decimate": 900, "fit_to_budget": 900, "fill_holes": 900, "merge_parts": 600, "export_model": 600,
               "turntable_video": 900, "open_file": 600, "find_fasteners": 300, "clean_up": 600, "remove_small_parts": 300,
               "split_parts": 600, "repair_mesh": 600, "remove_hidden_faces": 900, "duplicate_parts": 300, "merge_by_colour": 600,
               "smart_optimise": 1800, "render_image": 900, "run_recipe": 1800, "save_scene": 600, "check_model": 300, "find_hidden_parts": 600, "smart_fit": 600, "untriangulate": 900}
MCP_TIMEOUT.update(MCP_TIMEOUT_MORE)
OPEN_EXT = {".step", ".stp", ".iges", ".igs", ".brep", ".brp", ".glb", ".gltf", ".fbx", ".obj", ".3mf", ".stl"}
EXPORT_DIR = Path(__file__).resolve().parent / "exports"
# ── What Claude is told: hints on every tool, a guide it can read, and ready-made jobs ─────────────────────────────────────────
# MCP lets a server say more than "here are my tools": each tool can say whether it only reads or changes things (Claude's
# client uses that to decide what to ask), the server can offer documents to read (resources) and jobs to start (prompts), and
# it sends a short brief when the connection opens (instructions). The app still asks the user before it changes anything.
_READ_ONLY = {"scene_summary", "list_parts", "get_selection", "screenshot", "measure_parts", "list_groups", "search_docs", "read_doc", "check_model", "optimisation_report", "estimate_export_size", "list_materials", "list_recipes", "list_library", "list_folder"}
_CHANGES_MODEL = {"delete_parts", "remove_small_parts", "merge_parts", "merge_by_colour", "decimate", "fit_to_budget", "fill_holes",
                  "remove_hidden_faces", "repair_mesh", "clean_up", "split_parts", "duplicate_parts", "group_parts", "ungroup",
                  "rename_parts", "transform_parts", "recenter_model", "align_to_floor", "smart_optimise", "smart_fit", "untriangulate", "run_recipe", "add_library_part", "optimise_to_target"}
_TITLES = {"scene_summary": "What is open", "list_parts": "List parts", "get_selection": "What is selected", "select_parts": "Select parts",
           "select_all": "Select all or invert", "frame_selection": "Fly to the selection", "screenshot": "Take a screenshot", "hide_parts": "Hide parts",
           "isolate_parts": "Isolate parts", "show_all": "Show everything", "set_view_mode": "Change the view mode", "set_explode": "Explode the view",
           "set_grid": "Show or hide the grid", "set_camera_view": "Move the camera", "undo": "Undo", "redo": "Redo", "find_fasteners": "Find bolts and nuts",
           "find_stacked_copies": "Find stacked copies", "measure_parts": "Measure between parts", "list_groups": "List groups", "scene_tabs": "Scene tabs",
           "delete_parts": "Delete parts", "remove_small_parts": "Delete small parts", "merge_parts": "Merge parts", "merge_by_colour": "Merge by colour",
           "decimate": "Reduce triangles", "fit_to_budget": "Fit to a triangle budget", "fill_holes": "Remove holes", "remove_hidden_faces": "Remove hidden faces",
           "repair_mesh": "Repair meshes", "clean_up": "Clean up", "split_parts": "Split into pieces", "duplicate_parts": "Duplicate parts", "group_parts": "Group parts",
           "ungroup": "Ungroup", "rename_parts": "Rename parts", "transform_parts": "Move, turn, scale", "recenter_model": "Recentre the model",
           "align_to_floor": "Stand on the floor", "export_model": "Export the model", "turntable_video": "Turntable video", "render_image": "Render a picture", "open_file": "Open a file", "select_similar": "Select similar parts", "select_by_colour": "Select by colour", "list_materials": "List materials", "select_by_material": "Select by material", "check_model": "Check the model", "optimisation_report": "Optimisation report", "estimate_export_size": "Estimate the export size", "list_recipes": "List recipes", "run_recipe": "Run a recipe", "list_library": "List the library", "add_library_part": "Add a library part", "save_scene": "Save the scene", "smart_optimise": "Smart optimise", "optimise_to_target": "Optimise to a size", "compare_images": "Before and after picture", "list_folder": "List a folder", "batch_optimise": "Optimise a folder", "find_hidden_parts": "Find hidden parts", "smart_fit": "Replace with simple shapes",
           "untriangulate": "Untriangulate flat faces", "search_docs": "Search the app's help", "read_doc": "Read a help article or playbook"}
for _t in MCP_TOOLS:
    _t["annotations"] = {"title": _TITLES.get(_t["name"], _t["name"].replace("_", " ")), "readOnlyHint": _t["name"] in _READ_ONLY,
                         "destructiveHint": _t["name"] in _CHANGES_MODEL, "idempotentHint": _t["name"] in _READ_ONLY, "openWorldHint": False}

MCP_INSTRUCTIONS = (
    "Tools act on the scene open in the MeshOptimiser app in the user's browser. You are working as an experienced MeshOptimiser user would: "
    "first READ the playbook (resource meshoptimiser://playbook/optimise, or read_doc name 'optimise'), then look (scene_summary, list_parts sorted by triangles, "
    "screenshot) before you change anything. The app's own help articles are available through search_docs and read_doc: use them for any tool or symptom you have "
    "not handled before instead of guessing. Rules: ask what the model is for and the triangle budget; the cheapest and most reversible step first; delete before you "
    "reduce; say what you are about to change and why; give the before and after numbers; hide before you delete; every change is one undo step (the undo tool). "
    "The app asks the user to allow each change to the model; if they say no, stop and ask what they want instead. Prompts optimise_for_web, remove_fasteners and review_scene start common jobs. To reach a size or a place in one call use optimise_to_target; ask what a step would save with dry_run before asking the user to allow it; compare_images shows before and after; batch_optimise does a folder. Long jobs show progress and the user can stop them.")

# What an agent knows about optimising: the playbooks (written by hand, knowledge/playbooks) and the app's help articles (built from the
# website's docs by tools/build-knowledge.mjs, knowledge/docs). Served as resources, and searched and read by the search_docs and
# read_doc tools, which the server answers itself (the app does not need to be open for them).
KNOWLEDGE = Path(__file__).resolve().parent / "knowledge"
_PLAYBOOKS = [("optimise", "How to optimise a model (start here)", "The rules, the order of work, every tool in its place, and how to report."),
              ("goals", "Recipes by goal", "Web viewer, AR, game engine, 3D printing, sending to a customer, a review: the tool calls for each."),
              ("judgement", "Judgement: what is heavy, what may go", "How to read a scene, what each step costs in looks, when to ask."),
              ("tools", "The tools by job", "Every tool grouped by what you want to do, with its options."),
              ("safety", "What is safe to do", "What can be undone, what asks the user, what never to do without saying so."),
              ("problems", "When something does not work", "Connection problems, refusals, and results that are not what you expected.")]

def _load_knowledge():
    items = []
    for name, title, summary in _PLAYBOOKS:
        f = KNOWLEDGE / "playbooks" / f"{name}.md"
        if f.exists(): items.append({"uri": f"meshoptimiser://playbook/{name}", "slug": name, "title": title, "summary": summary, "group": "Playbooks", "text": f.read_text(encoding="utf8"), "playbook": True})
    idx = KNOWLEDGE / "index.json"
    if idx.exists():
        try: index = json.loads(idx.read_text(encoding="utf8"))
        except Exception: index = []
        for a in index:
            f = KNOWLEDGE / "docs" / f"{a['slug']}.md"
            if f.exists(): items.append({"uri": f"meshoptimiser://docs/{a['slug']}", "slug": a["slug"], "title": a["title"], "summary": a["summary"], "group": a.get("groupTitle") or "", "text": f.read_text(encoding="utf8"), "playbook": False})
    return items

KB = _load_knowledge()
KB_BY_URI = {k["uri"]: k for k in KB}
MCP_RESOURCES = [{"uri": k["uri"], "name": ("playbook-" if k["playbook"] else "doc-") + k["slug"], "title": k["title"], "description": k["summary"], "mimeType": "text/markdown"} for k in KB]
_STOP = {"the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "it", "how", "do", "i", "my", "me", "what", "with", "by", "be", "can", "this", "that", "are", "does", "from", "at", "as"}

def _stem(w):
    for suf in ("ing", "ed", "es", "s", "ly"):
        if len(w) > len(suf) + 3 and w.endswith(suf) and not w.endswith("ss"): return w[:-len(suf)]
    return w

def _words(text):
    return [_stem(w) for w in re.findall(r"[a-z0-9]+", str(text).lower()) if len(w) > 1 and w not in _STOP]

_DF = {}
def _doc_freq():
    if not _DF:
        for k in KB:
            for w in set(_words(k["text"])): _DF[w] = _DF.get(w, 0) + 1
    return _DF

def _kb_search(query, limit=5):
    qw = list(dict.fromkeys(_words(query)))
    if not qw: return []
    df, n = _doc_freq(), max(1, len(KB))
    scored = []
    for k in KB:
        tw = set(_words(k["title"])); sw = set(_words(k["summary"]))
        hw = set(_words(" ".join(re.findall(r"^#{2,} (.+)$", k["text"], re.M))))
        counts = {}
        for w in _words(k["text"]): counts[w] = counts.get(w, 0) + 1
        score, matched = 0.0, 0
        for w in qw:
            # a word that few articles use says more than one that most use
            idf = 1.0 + (n / (1 + df.get(w, 0))) ** 0.5
            part = idf * (10 * (w in tw) + 4 * (w in sw) + 3 * (w in hw) + min(counts.get(w, 0), 3))
            score += part; matched += part > 0
        if score <= 0: continue
        score *= (matched / len(qw)) ** 2          # an article that has all the words beats one with a single strong word
        if k["playbook"]: score *= 1.2
        best, bestn = "", 0
        for line in k["text"].split("\n"):
            hit = len(set(qw) & set(_words(line)))
            if hit > bestn and len(line) > 30: best, bestn = line, hit
        scored.append((score, k, best.strip(" #>-*")[:300]))
    scored.sort(key=lambda x: -x[0])
    return [{"uri": k["uri"], "name": k["slug"], "title": k["title"], "about": k["summary"][:160], "snippet": sn} for sc, k, sn in scored[:max(1, min(10, int(limit or 5)))]]

def _kb_get(name):
    name = str(name or "").strip()
    if name in KB_BY_URI: return KB_BY_URI[name]
    low = name.lower().replace(" ", "-")
    for k in KB:
        if k["slug"] == low or k["uri"].endswith("/" + low): return k
    hits = _kb_search(name, 1)
    # a fuzzy name only counts if a word of it is in the title: "zzzz-no-such" must not open some article
    if hits and set(_words(name)) & set(_words(hits[0]["title"] + " " + hits[0]["name"].replace("-", " "))): return KB_BY_URI.get(hits[0]["uri"])
    return None

def _reload_knowledge():
    """Read knowledge/ again (after the playbooks or the docs changed), without restarting the server."""
    global KB, KB_BY_URI, MCP_RESOURCES
    KB = _load_knowledge()
    KB_BY_URI = {k["uri"]: k for k in KB}
    MCP_RESOURCES = [{"uri": k["uri"], "name": ("playbook-" if k["playbook"] else "doc-") + k["slug"], "title": k["title"], "description": k["summary"], "mimeType": "text/markdown"} for k in KB]
    _DF.clear()

_LOCAL_TOOLS = {"search_docs", "read_doc"}
def _mcp_local(name, args):
    """Tools the server answers itself: the knowledge base. The app does not need to be open."""
    if name == "search_docs":
        q = (args or {}).get("query", "")
        hits = _kb_search(q, (args or {}).get("limit") or 5)
        if not hits: return _mcp_text("Nothing in the knowledge base matches. Try other words, or read_doc with name 'optimise' for the playbook.", True)
        return _mcp_text(json.dumps({"query": q, "results": hits, "next": "read_doc with a name to read one in full."}, separators=(",", ":"), ensure_ascii=False))
    if name == "read_doc":
        k = _kb_get((args or {}).get("name"))
        if not k: return _mcp_text("No article of that name. search_docs finds one by words; playbooks are optimise, goals, judgement, tools, safety, problems.", True)
        return _mcp_text(k["text"])
    return _mcp_text("Unknown local tool.", True)

MCP_PROMPTS = [
    {"name": "optimise_for_web", "title": "Optimise for the web",
     "description": "Look at the open scene, then lighten it step by step to a triangle target, asking before each change.",
     "arguments": [{"name": "target_triangles", "description": "Triangles to end under, for the whole scene (default 300000).", "required": False},
                   {"name": "keep_fasteners", "description": "yes if bolts and nuts must stay.", "required": False}]},
    {"name": "smart_optimise_it", "title": "Lighten it in one go",
     "description": "Run Smart optimise at a level after looking at the scene, and report what it did.",
     "arguments": [{"name": "level", "description": "light, balanced or strong (default balanced).", "required": False}]},
    {"name": "remove_fasteners", "title": "Take the bolts out",
     "description": "Find the bolts, screws, nuts and washers, show them, and hide, simplify or delete them.",
     "arguments": [{"name": "action", "description": "hide (default), simplify (plain cylinders) or delete.", "required": False}]},
    {"name": "make_safe_to_send", "title": "Make it safe to send to a customer",
     "description": "Remove what is inside and what reveals the design, simplify the secret parts, clean the names, export a GLB.", "arguments": []},
    {"name": "render_for_client", "title": "Pictures for a client",
     "description": "Render clean pictures of the optimised model: a set of angles on a plain background, saved as PNG, with a before and after if you ask.",
     "arguments": [{"name": "background", "description": "white (default), light, dark or transparent.", "required": False}, {"name": "before_after", "description": "yes to render the model before optimising too.", "required": False}]},
    {"name": "review_scene", "title": "Review the scene",
     "description": "Report what is heavy and what could go, without changing anything.", "arguments": []},
]

def _mcp_prompt(name, args):
    a = args or {}
    read = "First read the playbook (read_doc optimise, and goals for the recipe). "
    if name == "optimise_for_web":
        target = str(a.get("target_triangles") or "300000").strip() or "300000"
        keep = str(a.get("keep_fasteners") or "").lower() in ("yes", "true", "1")
        return ("Optimise the model open in MeshOptimiser for a web viewer, to under " + target + " triangles in total.\n\n" + read +
                "Then look: scene_summary, list_parts sorted by triangles (top 20), a screenshot. Tell me what is heavy and your plan, in order from the least visible change to the most, with the triangle count you expect after each step.\n\n"
                "Check estimate_export_size against the web guideline (about 5 MB and 100,000 triangles) so we know how far to go. Then work step by step: clean_up, find_stacked_copies, find_hidden_parts (check, then delete), remove_hidden_faces on the heaviest parts" + ("" if keep else ", find_fasteners and hide them (then delete or simplify with smart_fit cylinder if I agree)") +
                ", fill_holes, untriangulate, then fit_to_budget (" + target + ") if it is still over (or optimise_to_target with dry_run first, if I just want it under the limit). " + ("Keep the bolts and nuts. " if keep else "") +
                "After each step say what changed with the before and after triangle counts, and finish with compare_images so I can see before and after. "
                "The app asks me to allow each change: if I say no, stop and ask what I want. Do not delete anything without showing me first.")
    if name == "smart_optimise_it":
        level = str(a.get("level") or "balanced").strip().lower()
        level = level if level in ("light", "balanced", "strong", "auto") else "balanced"
        return ("Lighten the model open in MeshOptimiser with smart_optimise at level " + level + ". " + read +
                "Look first (scene_summary, list_parts sorted by triangles, a screenshot) and tell me what the level will do to this scene (its reply includes the plan). Run it once, then screenshot and compare. "
                "Report triangles and parts before and after, what was removed, and say that undo takes it all back in one step. If it is too rough, undo and try one level lighter; if there is room, tell me what the next level would do and ask.")
    if name == "remove_fasteners":
        action = str(a.get("action") or "hide").strip().lower()
        what = {"delete": "Then delete them (delete_parts) and report the triangle counts before and after.",
                "simplify": "Then replace each with a plain cylinder (smart_fit, shape cylinder) and report the triangle counts before and after."}.get(action, "Do not delete them: only hide, and tell me how to bring them back (show_all).")
        return ("In the model open in MeshOptimiser, find the fasteners (find_fasteners) and tell me how many there are and how many triangles they hold. Hide them and take a screenshot so I can see the model without them. " + what)
    if name == "make_safe_to_send":
        return ("Prepare the model open in MeshOptimiser to send to a customer without handing over the design. " + read +
                "Follow recipe E of the goals playbook: find_hidden_parts (check, delete), find_fasteners (delete), smart_fit few_boxes or blocks on the parts whose shape is the secret (ask me which), fill_holes, rename_parts to remove names that say too much, then export a GLB. "
                "Show me what goes before it goes, one step at a time, and tell me what the file will still reveal: no file is a guarantee.")
    if name == "render_for_client":
        bg = str(a.get("background") or "white").strip().lower()
        bg = bg if bg in ("white", "light", "dark", "transparent", "grey", "black") else "white"
        ba = str(a.get("before_after") or "").lower() in ("yes", "true", "1")
        return ("Make pictures of the model open in MeshOptimiser for a client. " + read + "Follow recipe H of the goals playbook. " +
                ("First render the model as it is now (before anything is optimised) with render_image, then tell me when to optimise and render the same views again, so I get a before and after with the same camera, mode and size. " if ba else "") +
                "Use render_image with views perspective, front, side and top, mode clay (or solid if colour matters), background " + bg + ", 2560 by 1440, grid hidden. Look at the contact sheet, tell me what you see and whether an angle is wrong, and give me the file paths. "
                "Ask me first if I have a house style for the background or the angle.")
    if name == "review_scene":
        return ("Review the model open in MeshOptimiser and report, without changing anything: scene_summary, the 20 heaviest parts (list_parts sorted by triangles) and what share of the triangles they hold, "
                "whether there are stacked copies (find_stacked_copies), hidden parts (find_hidden_parts) and fasteners (find_fasteners), and parts under 1% of the model's size (list_parts sorted by size). "
                "Start with check_model and optimisation_report. Take a screenshot, a heatmap one (set_view_mode heat, then back to solid) and an exploded one (set_explode 50, then 0). Finish with a short list of what you would do first and what each step would save. " + read)
    return None

MCP_TOOL_NAMES = {t["name"] for t in MCP_TOOLS}

def _mcp_text(text, error=False):
    r = {"content": [{"type": "text", "text": text}]}
    if error: r["isError"] = True
    return r

def _mcp_call(name, args, on_progress=None, rpc_id=None):
    """Run one tool in the open app and wait for its answer; count it and say so in this window."""
    t0 = time.time()
    res = _mcp_local(name, args) if name in _LOCAL_TOOLS else _mcp_call_inner(name, args, on_progress, rpc_id)
    dt = time.time() - t0
    bad = bool(res.get("isError"))
    st = MCP_STATS["tools"].setdefault(name, {"n": 0, "errors": 0, "ms": 0, "max_ms": 0})
    st["n"] += 1; st["ms"] += int(dt * 1000); st["max_ms"] = max(st["max_ms"], int(dt * 1000)); MCP_STATS["calls"] += 1
    if bad: st["errors"] += 1; MCP_STATS["errors"] += 1
    first = ((res.get("content") or [{}])[0].get("text") or "") if bad else ""
    _mcp_log(f"{name}{(' (' + _brief(args) + ')') if args else ''} -> {'ERROR: ' + first[:110].replace(chr(10), ' ') if bad else 'ok'} in {dt:.1f} s")
    return res

def _mcp_call_inner(name, args, on_progress=None, rpc_id=None):
    """Run one tool in the open app and wait for its answer. A job that reports progress is passed on to on_progress while it runs."""
    cv = BRIDGE["cv"]
    if not BRIDGE.get("inflight") and time.time() - BRIDGE["last_poll"] > 35:
        return _mcp_text("MeshOptimiser is not listening. Open the app in a browser and turn on Settings > General > Let Claude connect.", True)
    cid = uuid.uuid4().hex
    with cv:
        BRIDGE["queue"].append({"id": cid, "tool": name, "args": args or {}})
        BRIDGE["inflight"] = BRIDGE.get("inflight", 0) + 1
        if rpc_id is not None: BRIDGE["rpc"][str(rpc_id)] = cid
        cv.notify_all()
        deadline = time.time() + MCP_TIMEOUT.get(name, 120)
        try:
            while cid not in BRIDGE["results"]:
                if on_progress is not None:
                    pr = BRIDGE["prog"].pop(cid, None)
                    if pr:
                        try: on_progress(pr)
                        except Exception: BRIDGE["cancel"].add(cid); on_progress = None        # the client went away: ask the app to stop
                left = deadline - time.time()
                if left <= 0:
                    BRIDGE["queue"][:] = [c for c in BRIDGE["queue"] if c["id"] != cid]
                    return _mcp_text("The app did not answer in time. Is the page open and in front? (If it asked for permission, it was not answered.)", True)
                cv.wait(min(left, 2.0))
            res = BRIDGE["results"].pop(cid)
        finally:
            BRIDGE["inflight"] = max(0, BRIDGE.get("inflight", 1) - 1)
            BRIDGE["prog"].pop(cid, None); BRIDGE["cancel"].discard(cid)
            if rpc_id is not None: BRIDGE["rpc"].pop(str(rpc_id), None)
    if res.get("ok"):
        content = res.get("content")
        return {"content": content if isinstance(content, list) and content else [{"type": "text", "text": "Done."}]}
    return _mcp_text(str(res.get("error") or "The app reported an error."), True)

def _mcp_dispatch(msg):
    """One JSON-RPC message in, one reply (or None for a notification)."""
    if not isinstance(msg, dict): return {"jsonrpc": "2.0", "id": None, "error": {"code": -32600, "message": "Invalid request"}}
    mid, method, params = msg.get("id"), msg.get("method"), msg.get("params") or {}
    if method == "notifications/cancelled":          # the client gave up on a request: ask the app to stop that job
        with BRIDGE["cv"]:
            cid = BRIDGE["rpc"].get(str(params.get("requestId")))
            if cid: BRIDGE["cancel"].add(cid); _mcp_log("the client cancelled a request")
        return None
    if method is None or mid is None:        # a notification, or a reply to us: nothing to say
        return None
    def ok(result): return {"jsonrpc": "2.0", "id": mid, "result": result}
    def err(code, text): return {"jsonrpc": "2.0", "id": mid, "error": {"code": code, "message": text}}
    if method == "initialize":
        want = params.get("protocolVersion")
        return ok({"protocolVersion": want if want in MCP_VERSIONS else MCP_VERSIONS[0],
                   "capabilities": {"tools": {"listChanged": False}, "resources": {"listChanged": False}, "prompts": {"listChanged": False}},
                   "serverInfo": {"name": "meshoptimiser", "title": "MeshOptimiser", "version": "0.1.0"},
                   "instructions": MCP_INSTRUCTIONS})
    if method == "ping": return ok({})
    if method == "tools/list": return ok({"tools": MCP_TOOLS})
    if method == "resources/list": return ok({"resources": MCP_RESOURCES})
    if method == "resources/templates/list": return ok({"resourceTemplates": []})
    if method == "resources/read":
        uri = params.get("uri")
        if uri not in KB_BY_URI: return err(-32002, f"Resource not found: {uri}")
        return ok({"contents": [{"uri": uri, "mimeType": "text/markdown", "text": KB_BY_URI[uri]["text"]}]})
    if method == "prompts/list": return ok({"prompts": MCP_PROMPTS})
    if method == "prompts/get":
        text = _mcp_prompt(params.get("name"), params.get("arguments"))
        if text is None: return err(-32602, f"Unknown prompt: {params.get('name')}")
        return ok({"description": next((p["description"] for p in MCP_PROMPTS if p["name"] == params.get("name")), ""), "messages": [{"role": "user", "content": {"type": "text", "text": text}}]})
    if method == "tools/call":
        name = params.get("name")
        if name not in MCP_TOOL_NAMES: return err(-32602, f"Unknown tool: {name}")
        args = params.get("arguments")
        return ok(_mcp_call(name, args if isinstance(args, dict) else {}))
    return err(-32601, f"Method not found: {method}")


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.js': 'application/javascript', '.mjs': 'application/javascript',
        '.wasm': 'application/wasm', '.html': 'text/html',
        '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
        '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
    }

    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'credentialless')
        # The browser keeps every file but asks the server each time whether it
        # changed (a 304 with no body when it has not), so an edit still shows on
        # reload and nothing stale is ever used. Keeping the file is what lets the
        # browser also keep the compiled code of the 2.8 MB app script, and not
        # download three.js and the rest on every start. Only the server's own
        # answers (/api/..., /mcp: jobs, the bridge, the event stream) are never kept.
        p = (getattr(self, 'path', '') or '').split('?')[0]
        live = p.startswith('/api/') or p.startswith('/mcp')
        self.send_header('Cache-Control', 'no-store' if live else 'no-cache')
        super().end_headers()

    def log_message(self, format, *args):
        try: msg = format % args
        except Exception: msg = str(args)
        if "/favicon.ico" in msg or "/api/bridge/poll" in msg or "/api/bridge/result" in msg or "/api/bridge/progress" in msg: return
        sys.stderr.write(f"  {self.address_string()} - {msg}\n")

    # Who is asking. The server only listens on this computer, but any web page
    # open in the browser can still send requests to http://localhost:<port>.
    # Two checks keep those out:
    #   Host    must be this server's own address. A page that points its own
    #           domain at 127.0.0.1 (DNS rebinding) arrives with its domain here.
    #   Origin  (sent with every cross-site POST) must be this server, or absent
    #           (the app's own GETs, curl, the launcher).
    def _trusted(self) -> bool:
        port = self.server.server_address[1]
        hosts = {f"localhost:{port}", f"127.0.0.1:{port}"}
        if (self.headers.get("Host") or "").strip().lower() not in hosts:
            return False
        origin = self.headers.get("Origin")
        return origin is None or origin.strip().lower() in {"http://" + h for h in hosts}

    def _refuse(self):
        return self._json({"error": "forbidden"}, 403)

    # No folder listings, and nothing from a dot-folder (.git, .venv): the app
    # asks for files by name and never for either.
    def list_directory(self, path):
        self.send_error(404, "Not found")
        return None

    def do_GET(self):
        if not self._trusted(): return self._refuse()
        u = urlparse(self.path)
        if u.path == "/favicon.ico":
            self.send_response(204); self.end_headers(); return
        if any(seg.startswith(".") for seg in u.path.split("/") if seg):
            self.send_error(404, "Not found"); return
        if u.path == "/api/alive":
            return self._handle_alive()
        if u.path == "/api/bridge/poll":
            return self._handle_bridge_poll()
        if u.path == "/api/bridge/status":
            return self._handle_bridge_status()
        if u.path == "/api/update/status":
            return self._json(updater.status())
        if u.path == "/mcp":
            self.send_response(405); self.send_header("Allow", "POST"); self.send_header("Content-Length", "0"); self.end_headers(); return
        if u.path.startswith("/api/job/"):
            job_id = u.path.rsplit("/", 1)[-1]
            # A copy taken under the lock, so "log" and "log_base" belong together.
            with JOBS_LOCK:
                job = JOBS.get(job_id)
                if job is not None:
                    job["polled_at"] = time.time()
                    job = {**job, "log": list(job.get("log") or [])}
            if job is None: return self._json({"error": "not found"}, 404)
            return self._json(job)
        return super().do_GET()

    def do_HEAD(self):
        if not self._trusted(): return self._refuse()
        u = urlparse(self.path)
        if any(seg.startswith(".") for seg in u.path.split("/") if seg):
            self.send_error(404, "Not found"); return
        return super().do_HEAD()

    def do_POST(self):
        if not self._trusted(): return self._refuse()
        u = urlparse(self.path)
        if u.path == "/api/bridge/off": return self._handle_bridge_off()
        if u.path == "/api/bridge/restart": return self._handle_bridge_restart()
        if u.path == "/api/restart": return self._handle_restart()
        if u.path.startswith("/api/update/"): return self._handle_update(u.path[len("/api/update/"):])
        if u.path == "/mcp":         return self._handle_mcp()
        if u.path == "/api/bridge/result": return self._handle_bridge_result()
        if u.path == "/api/bridge/file": return self._handle_bridge_file()
        if u.path == "/api/bridge/open": return self._handle_bridge_open()
        if u.path == "/api/bridge/progress": return self._handle_bridge_progress()
        if u.path == "/api/bridge/list": return self._handle_bridge_list()
        if u.path == "/api/convert": return self._handle_convert()
        if u.path == "/api/quit":    return self._handle_quit()
        if u.path.startswith("/api/cancel/"):
            return self._handle_cancel(u.path.rsplit("/", 1)[-1])
        return self._json({"error": "unknown endpoint"}, 404)

    def _read_json(self, limit=8 * 1024 * 1024):
        try: n = int(self.headers.get("Content-Length") or 0)
        except ValueError: n = 0
        if n <= 0 or n > limit: return None
        try: return json.loads(self.rfile.read(n).decode("utf-8"))
        except Exception: return None

    def _handle_mcp(self):
        body = self._read_json(1024 * 1024)
        if body is None:
            return self._json({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}}, 400)
        if isinstance(body, dict) and body.get("method") == "tools/call" and body.get("id") is not None:
            p = body.get("params") or {}
            if (p.get("_meta") or {}).get("progressToken") is not None and p.get("name") in _STREAMED and "text/event-stream" in (self.headers.get("Accept") or ""):
                return self._stream_call(body)
        msgs = body if isinstance(body, list) else [body]
        out = [r for r in (_mcp_dispatch(m) for m in msgs) if r is not None]
        if not out:
            self.send_response(202); self.send_header("Content-Length", "0"); self.end_headers(); return
        return self._json(out if isinstance(body, list) else out[0])

    def _stream_call(self, body):
        """A long job for a client that wants progress: the answer comes as an event stream, progress notices first, the result last."""
        p = body.get("params") or {}
        name, token = p.get("name"), (p.get("_meta") or {}).get("progressToken")
        args = p.get("arguments") if isinstance(p.get("arguments"), dict) else {}
        self.send_response(200); self.send_header("Content-Type", "text/event-stream"); self.send_header("Cache-Control", "no-cache"); self.end_headers()
        self.close_connection = True
        last = {"p": 0.0, "key": None}
        def send(obj):
            self.wfile.write(("event: message\ndata: " + json.dumps(obj) + "\n\n").encode("utf-8")); self.wfile.flush()
        def on_progress(pr):
            key = (pr.get("progress"), pr.get("total"), pr.get("message"))
            if key == last["key"]: return
            last["key"] = key
            v = float(pr.get("progress") or 0)
            if v <= last["p"]: v = last["p"] + 0.01
            last["p"] = v
            n = {"progressToken": token, "progress": v, "message": pr.get("message") or ""}
            if pr.get("total"): n["total"] = pr["total"]
            send({"jsonrpc": "2.0", "method": "notifications/progress", "params": n})
        res = _mcp_call(name, args, on_progress, body.get("id"))
        try: send({"jsonrpc": "2.0", "id": body.get("id"), "result": res})
        except Exception: pass

    def _handle_bridge_progress(self):
        """The app reports how far a long job is, and learns whether the client has cancelled it."""
        body = self._read_json(64 * 1024) or {}
        cid = str(body.get("id") or "")
        with BRIDGE["cv"]:
            if cid:
                BRIDGE["prog"][cid] = {"progress": body.get("progress") or 0, "total": body.get("total") or 0, "message": str(body.get("message") or "")[:200]}
                BRIDGE["last_poll"] = time.time()             # a busy page is an alive page
                BRIDGE["cv"].notify_all()
            cancel = cid in BRIDGE["cancel"]
        return self._json({"ok": True, "cancel": cancel})

    def _handle_bridge_list(self):
        """The model files in a folder (for Claude's list_folder and batch_optimise): names, paths and sizes, nothing else."""
        body = self._read_json(1 << 20) or {}
        try: p = Path(str(body.get("path", ""))).expanduser().resolve()
        except Exception: p = None
        if not p or not p.is_dir():
            return self._json({"error": "not a folder: " + str(body.get("path", ""))}, 400)
        found = []
        try:
            for f in (p.rglob("*") if body.get("recursive") else p.iterdir()):
                try:
                    if f.is_file() and f.suffix.lower() in OPEN_EXT and not any(s.startswith(".") for s in f.relative_to(p).parts):
                        size = f.stat().st_size
                        if size <= 2 * 1024 ** 3: found.append({"name": str(f.relative_to(p)).replace("\\", "/"), "path": str(f), "megabytes": round(size / 1048576, 2)})
                except OSError: continue
                if len(found) >= 5000: break
        except OSError as e:
            return self._json({"error": "cannot read that folder: " + str(e)}, 400)
        found.sort(key=lambda r: r["name"].lower())
        return self._json({"folder": str(p), "total": len(found), "files": found[:300]})

    def _handle_bridge_restart(self):
        """Start the connection from scratch: forget the window that had it, answer what was waiting, read the knowledge again."""
        with BRIDGE["cv"]:
            for cmd in BRIDGE["queue"]: BRIDGE["results"][cmd["id"]] = {"ok": False, "error": "The connection was restarted before the app could answer."}
            BRIDGE["queue"][:] = []
            BRIDGE["last_poll"] = 0.0; BRIDGE["active"] = None; BRIDGE["inflight"] = 0
            BRIDGE["cv"].notify_all()
        _reload_knowledge()
        _mcp_log(f"the connection was restarted ({len(KB)} knowledge entries, {len(MCP_TOOLS)} tools)")
        return self._json({"ok": True, "knowledge": len(KB), "tools": len(MCP_TOOLS)})

    def _handle_restart(self):
        """The whole server: stop it and start it again. The page and its scenes stay; it reconnects within seconds."""
        if not RESTART_CMD or not os.path.isfile(RESTART_CMD[0]):
            return self._json({"ok": False, "error": "This server cannot restart itself. Start it again from its launcher."}, 501)
        self._json({"ok": True, "status": "restarting"})
        threading.Thread(target=_restart_server, daemon=False).start()      # (not a daemon: the process waits for it)

    def _handle_update(self, action: str):
        """Updating the app's own files (updater.py). Only this computer's own page can reach these: _trusted() has already run."""
        body = self._read_json(4096) or {}
        channel = body.get("channel") if body.get("channel") in ("stable", "beta") else "stable"
        try:
            if action == "check":
                if updater.busy(): return self._json({"ok": False, "error": "An update is already running."}, 409)
                res = updater.check(channel)
                return self._json({k: v for k, v in res.items() if not k.startswith("_")})
            if action == "install":
                def guard():
                    with JOBS_LOCK: running = any(j.get("status") in ("queued", "running") for j in JOBS.values())
                    return "A conversion is still running. Let it finish first, then update." if running else ""
                updater.start_install(channel, _after_update, guard)
                return self._json({"ok": True})
            if action == "cancel":
                updater.cancel(); return self._json({"ok": True})
            if action == "rollback":
                if updater.busy(): return self._json({"ok": False, "error": "An update is running."}, 409)
                res = updater.rollback("You asked for the earlier version.")
                _after_update({"to": res["restored"]})
                return self._json({"ok": True, **res})
            if action == "confirm":
                updater.confirm(); return self._json({"ok": True})
            if action == "dismiss":
                updater.clear_notice(); return self._json({"ok": True})
        except updater.UpdateError as e:
            return self._json({"ok": False, "error": str(e)}, 200 if action == "check" else 409)
        return self._json({"error": "unknown endpoint"}, 404)

    def _handle_bridge_off(self):
        """The page switched "Let Claude connect" off: from now on a request is refused at once, not after two minutes of waiting."""
        with BRIDGE["cv"]:
            was = BRIDGE.get("active")
            BRIDGE["last_poll"] = 0.0; BRIDGE["active"] = None
            for cmd in BRIDGE["queue"]: BRIDGE["results"][cmd["id"]] = {"ok": False, "error": "The app was switched off (Let Claude connect) before it could answer."}
            BRIDGE["queue"][:] = []
            BRIDGE["cv"].notify_all()
        if was: _mcp_log("the app switched the connection off")
        return self._json({"ok": True})

    def _handle_bridge_status(self):
        """What the connection looks like from here: is the app asking for work, and what has Claude asked for."""
        age = time.time() - BRIDGE["last_poll"] if BRIDGE["last_poll"] else None
        with BRIDGE["cv"]:
            queued, inflight = len(BRIDGE["queue"]), BRIDGE.get("inflight", 0)
        tools = {k: {"calls": v["n"], "errors": v["errors"], "avg_ms": int(v["ms"] / max(1, v["n"])), "max_ms": v["max_ms"]} for k, v in MCP_STATS["tools"].items()}
        return self._json({"pid": os.getpid(), "listening": age is not None and age <= 35, "seconds_since_the_app_asked": None if age is None else round(age, 1),
                           "window": BRIDGE.get("active"), "queued": queued, "in_flight": inflight, "tools_offered": len(MCP_TOOLS),
                           "since": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(MCP_STATS["since"])), "connects": MCP_STATS["connects"],
                           "calls": MCP_STATS["calls"], "errors": MCP_STATS["errors"], "tools": tools})

    def _handle_bridge_poll(self):
        """The page asks for work and waits up to 20 s for it."""
        cv = BRIDGE["cv"]
        q = parse_qs(urlparse(self.path).query)
        cid, fresh = (q.get("c") or [""])[0], (q.get("new") or [""])[0] == "1"
        deadline = time.time() + 20
        cmd = None
        with cv:
            BRIDGE["seq"] = BRIDGE.get("seq", 0) + 1; mine = BRIDGE["seq"]     # (a newer poll from the page replaces this one: see below)
            # One window at a time: the one that switched it on last. An older
            # window is told so (409) and stops asking.
            active = BRIDGE.get("active")
            if fresh or not active or time.time() - BRIDGE["last_poll"] > 35:
                if active != cid or time.time() - BRIDGE["last_poll"] > 35:
                    gap = time.time() - BRIDGE["last_poll"] if BRIDGE["last_poll"] else None
                    MCP_STATS["connects"] += 1
                    _mcp_log(f"the app is listening (window {cid[:6]}{', quiet for ' + str(int(gap)) + ' s' if gap and gap > 35 else ''})")
                BRIDGE["active"] = cid
            elif active != cid:
                _mcp_log(f"window {cid[:6]} was turned away: window {str(active)[:6]} has the connection")
                self.send_response(409); self.send_header("Content-Length", "0"); self.end_headers(); return
            BRIDGE["last_poll"] = time.time()
            while not BRIDGE["queue"]:
                left = deadline - time.time()
                if left <= 0: break
                cv.wait(min(left, 2.0))
                if BRIDGE.get("seq") != mine:                # the page asked again (it was switched off and on, or restarted): this poll is a dead connection
                    self.send_response(204); self.send_header("Content-Length", "0"); self.end_headers(); return
                act = BRIDGE.get("active")
                if act is None: BRIDGE["active"] = cid       # (the connection was restarted while this window waited: it keeps it)
                elif act != cid:                             # a newer window took over while this one waited
                    self.send_response(409); self.send_header("Content-Length", "0"); self.end_headers(); return
                BRIDGE["last_poll"] = time.time()
            if BRIDGE.get("seq") != mine and BRIDGE["queue"]:        # a command must go to the live poll only
                self.send_response(204); self.send_header("Content-Length", "0"); self.end_headers(); return
            if BRIDGE["queue"]: cmd = BRIDGE["queue"].pop(0)
        if cmd is None:
            self.send_response(204); self.end_headers(); return
        return self._json(cmd)

    def _handle_bridge_file(self):
        """The app hands over a file it made (an export, a video). It is written into exports/ and nowhere else."""
        q = parse_qs(urlparse(self.path).query)
        name = Path((q.get("name") or ["export"])[0]).name
        name = re.sub(r"[^A-Za-z0-9._ -]+", "_", name).strip(". ") or "export"
        try: n = int(self.headers.get("Content-Length") or 0)
        except ValueError: n = 0
        if n <= 0 or n > 2 * 1024 ** 3:
            return self._json({"error": "bad size"}, 400)
        EXPORT_DIR.mkdir(exist_ok=True)
        dest = EXPORT_DIR / name
        k = 1
        while dest.exists():
            dest = EXPORT_DIR / f"{Path(name).stem}-{k}{Path(name).suffix}"; k += 1
        left = n
        with open(dest, "wb") as f:
            while left > 0:
                chunk = self.rfile.read(min(left, 1 << 20))
                if not chunk: break
                f.write(chunk); left -= len(chunk)
        return self._json({"path": str(dest), "bytes": n - left})

    def _handle_bridge_open(self):
        """Send the app a model file from disk, so Claude can open it by path. Model types only."""
        body = self._read_json(1 << 20)
        try: p = Path(str((body or {}).get("path", ""))).expanduser().resolve()
        except Exception: p = None
        if not p or not p.is_file() or p.suffix.lower() not in OPEN_EXT or p.stat().st_size > 2 * 1024 ** 3:
            return self._json({"error": "not a model file that can be opened: " + str((body or {}).get("path", ""))}, 400)
        size = p.stat().st_size
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(size))
        self.send_header("X-File-Name", quote(p.name))
        self.end_headers()
        with open(p, "rb") as f:
            while True:
                chunk = f.read(1 << 20)
                if not chunk: break
                self.wfile.write(chunk)

    def _handle_bridge_result(self):
        body = self._read_json()
        if not isinstance(body, dict) or not body.get("id"):
            return self._json({"error": "bad result"}, 400)
        with BRIDGE["cv"]:
            BRIDGE["results"][str(body["id"])] = body
            BRIDGE["last_poll"] = time.time()      # an answer proves the page is alive, even if a long job kept it from asking again yet
            BRIDGE["cv"].notify_all()
        return self._json({"ok": True})

    def _handle_alive(self):
        """One open request per window: it never ends while the page is there.
        The server writes a byte every few seconds and also watches the socket,
        so a window that closes (or a browser that is killed) is noticed within
        seconds: see the watchdog."""
        self.close_connection = True
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.end_headers()
        cid = uuid.uuid4().hex
        with CLIENTS_LOCK:
            CLIENTS[cid] = time.time()
            LIFE["ever"] = True
        conn = self.connection
        try:
            while True:
                ready, _, _ = select.select([conn], [], [], 3.0)
                if ready:
                    try: data = conn.recv(64)          # b'' = the other end has closed
                    except OSError: break
                    if not data: break
                self.wfile.write(b'.')
                self.wfile.flush()
                with CLIENTS_LOCK:
                    CLIENTS[cid] = time.time()
        except (OSError, ValueError):
            pass
        finally:
            with CLIENTS_LOCK:
                CLIENTS.pop(cid, None)
                if not CLIENTS:
                    LIFE["left_at"] = time.time()

    def _handle_cancel(self, job_id: str):
        """Stop a running conversion (the loader's Cancel button)."""
        if not _cancel_job(job_id):
            return self._json({"error": "not found"}, 404)
        return self._json({"ok": True})

    def _handle_quit(self):
        """Graceful shutdown triggered by the in-app Quit menu item.

        We send the JSON ack first, then spawn a thread to call
        httpd.shutdown(). Calling shutdown() inline would deadlock — it waits
        for serve_forever() to exit, but serve_forever is the thread that's
        currently running this handler. The 0.1 s delay gives the wfile
        flush time to land before the socket goes away.
        """
        self._json({"status": "shutting down"})
        def _stop():
            time.sleep(0.1)
            _stop_converters()
            try:
                if HTTPD is not None: HTTPD.shutdown()
            except Exception: pass
        threading.Thread(target=_stop, daemon=True).start()

    def _json(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _handle_convert(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)

        # ── Validate inputs BEFORE we touch disk
        raw_name = q.get("name", ["upload.step"])[0]
        name = _sanitize_filename(raw_name)
        # Extension allow-list — never write anything that's not a CAD file
        # step2glb.py reads (it picks its reader by the extension).
        if not name.lower().endswith(CAD_EXTS):
            return self._json({"error": "filename must end in .step, .stp, .iges, .igs, .brep or .brp"}, 400)

        try:
            quality = float(q.get("quality", ["0.5"])[0])
            min_size = float(q.get("min_size", ["0"])[0])
        except ValueError:
            return self._json({"error": "quality and min_size must be numeric"}, 400)
        if not (1e-6 <= quality <= 1e3):
            return self._json({"error": "quality out of range (1e-6 .. 1000)"}, 400)
        if not (0.0 <= min_size <= 100.0):
            return self._json({"error": "min_size out of range (0 .. 100)"}, 400)

        # Optional import-settings modal flags. All have safe defaults that
        # match the historical behavior, so missing/malformed values simply
        # fall back. `colors` is a string enum; the rest are booleans encoded
        # as "1"/"0".
        def _qbool(key: str, default: bool) -> bool:
            v = q.get(key, [None])[0]
            if v is None: return default
            return v not in ("0", "false", "False", "no", "off", "")
        colors_in = (q.get("colors", ["on"])[0] or "on").lower()
        if colors_in not in ("auto", "on", "off"): colors_in = "on"
        opts = {
            "colors":    colors_in,
            "shuo":      _qbool("shuo",      True),
            "layers":    _qbool("layers",    True),
            "materials": _qbool("materials", True),
            "names":     _qbool("names",     True),
            "props":     _qbool("props",     True),
            "instance":  _qbool("instance",  True),
            "force":     _qbool("force",     False),
            "normals":   _qbool("normals",   True),
            "swap_yz":   _qbool("swap_yz",   False),
        }
        # Angle in degrees (the converter takes radians), the smallest edge in
        # model units, and the three size groups as the converter's --tiers
        # string. All checked here: they end up on a command line.
        try:
            ang = float(q.get("angle", ["0"])[0])
            min_edge = float(q.get("min_edge", ["0"])[0])
        except ValueError:
            return self._json({"error": "angle and min_edge must be numeric"}, 400)
        if ang:
            if not (0.06 <= ang <= 180):
                return self._json({"error": "angle out of range (0.06 .. 180 degrees)"}, 400)
            opts["angular"] = math.radians(ang)
        if not (0.0 <= min_edge <= 1000.0):
            return self._json({"error": "min_edge out of range (0 .. 1000)"}, 400)
        opts["min_edge"] = min_edge
        tiers = q.get("tiers", [""])[0]
        if tiers:
            if not re.fullmatch(r"[0-9.]+,[0-9.]+(:[0-9.]+,[0-9.]+){3}", tiers):
                return self._json({"error": "tiers must look like 5,30:2,60:0.2,30:0.05,10"}, 400)
            opts["tiers"] = tiers

        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return self._json({"error": "Content-Length must be integer"}, 400)
        if size <= 0:
            return self._json({"error": "empty body"}, 400)
        if size > MAX_UPLOAD_BYTES:
            return self._json({
                "error": f"upload too large ({size / 1048576:.1f} MB > "
                         f"{MAX_UPLOAD_BYTES / 1048576:.0f} MB cap)"
            }, 413)

        # Bound the job dict before we start (cheap, idempotent).
        _prune_jobs()

        job_id = uuid.uuid4().hex[:12]
        # Both names already sanitized + extension-checked; resolve() asserts
        # the final path stays inside INBOX (defense-in-depth against a
        # sanitizer regression).
        src = (INBOX / f"{job_id}_{name}").resolve()
        try:
            src.relative_to(INBOX.resolve())
        except ValueError:
            return self._json({"error": "path traversal attempt blocked"}, 400)
        dst = src.with_suffix(".glb")

        # Stream-read the body, enforcing the cap precisely (Content-Length
        # could lie). Cleanup the partial file on any failure.
        remaining = size
        try:
            with open(src, "xb") as f:
                while remaining > 0:
                    chunk = self.rfile.read(min(remaining, 1048576))
                    if not chunk: break
                    f.write(chunk)
                    remaining -= len(chunk)
            if remaining > 0:
                raise RuntimeError(f"upload truncated: {remaining} bytes missing")
        except Exception as e:
            try: src.unlink(missing_ok=True)
            except Exception: pass
            return self._json({"error": f"upload failed: {e}"}, 500)

        with JOBS_LOCK:
            JOBS[job_id] = {
                "id": job_id, "status": "queued", "started_at": time.time(), "polled_at": time.time(),
                "src_name": name, "src_size_mb": size / 1048576,
                "log": [], "log_base": 0, "message": "queued", "progress": 0, "result": None,
            }
        _start_job_watchdog()
        threading.Thread(target=_convert_thread,
                         args=(job_id, src, dst, quality, min_size, opts),
                         daemon=True).start()
        return self._json({"job_id": job_id})


# ─── The app's own window ─────────────────────────────────────────────────
# A Chromium browser started with --app=<url> draws the page in a window of
# its own: a title bar and nothing else. No tabs, no address bar, and none of
# the toolbar an installed web app gets (the extensions button, the menu).
# It uses the browser's usual profile, so settings and recent files are the
# ones the app already had in a tab. Returns False when no such browser is
# found, and the caller falls back to an ordinary tab.
def _default_browser_exe() -> str | None:
    """Windows: the program file of the default browser, when it is one that
    can open an app window (Chrome, Edge, Brave). None for anything else."""
    if sys.platform != "win32": return None
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                            r"Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice") as key:
            prog_id = str(winreg.QueryValueEx(key, "ProgId")[0])
    except Exception:
        return None
    # ChromeHTML, MSEdgeHTM, BraveHTML; an install for one user only adds a
    # suffix to the name (ChromeHTML.ABC123…).
    for prefix, exe in (("ChromeHTML", "chrome.exe"), ("MSEdgeHTM", "msedge.exe"), ("BraveHTML", "brave.exe")):
        if prog_id.startswith(prefix): return exe
    return None

def _app_browsers():
    if sys.platform == "win32":
        roots = [os.environ.get(k) for k in ("ProgramFiles", "ProgramFiles(x86)", "LocalAppData")]
        tails = [r"Google\Chrome\Application\chrome.exe", r"Microsoft\Edge\Application\msedge.exe",
                 r"BraveSoftware\Brave-Browser\Application\brave.exe"]
        found = [os.path.join(r, t) for t in tails for r in roots if r]
        # The browser the user has chosen as their default goes first. The
        # others stay behind it, in the same order, as fallbacks.
        default = _default_browser_exe()
        if default:
            found.sort(key=lambda p: os.path.basename(p).lower() != default)
        return found
    if sys.platform == "darwin":
        return [f"/Applications/{n}.app/Contents/MacOS/{n}" for n in ("Google Chrome", "Microsoft Edge", "Brave Browser")]
    return [p for p in (shutil.which(n) for n in ("google-chrome", "chromium", "chromium-browser", "microsoft-edge", "brave-browser")) if p]

def _already_running(port: int) -> bool:
    """True when a MeshOptimiser server answers on this port."""
    import urllib.request
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/manifest.webmanifest", timeout=0.6) as r:
            return json.loads(r.read().decode("utf-8", "replace")).get("name") == "MeshOptimiser"
    except Exception:
        return False

def _open_app_window(url: str) -> bool:
    for exe in _app_browsers():
        if not os.path.isfile(exe): continue
        try:
            # (a session of its own, so Ctrl+C in the server's terminal does not reach the browser)
            subprocess.Popen([exe, f"--app={url}"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                             start_new_session=(os.name != "nt"))
            return True
        except Exception:
            continue
    return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=PORT)
    ap.add_argument("--open", "-o", type=str)
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--tab", action="store_true", help="open in an ordinary browser tab instead of the app's own window")
    ap.add_argument("--keep-running", action="store_true", help="keep the server running after the window is closed")
    ap.add_argument("--exit-when-closed", action="store_true", help="stop the server when its window is closed, also with --no-browser")
    args = ap.parse_args()
    os.chdir(ROOT)
    updater.PYTHON = _resolve_python()
    # An update that never got a working page is taken back here, and the old files started in its place.
    if updater.on_startup():
        print("  The last update did not start properly: the earlier version was put back. Starting it.")
        try: subprocess.Popen([sys.executable, str(Path(__file__).resolve()), *sys.argv[1:]], cwd=str(ROOT))
        except Exception as e: print(f"  Start the app again from its launcher ({e}).")
        return 0

    # However the server ends, converters it started do not outlive it.
    atexit.register(_stop_converters)
    for name in ("SIGTERM", "SIGHUP", "SIGBREAK"):
        sig = getattr(signal, name, None)
        if sig is not None:
            try: signal.signal(sig, _graceful)
            except (OSError, ValueError): pass
    LIFE["exit_when_closed"] = (args.exit_when_closed or not args.no_browser) and not args.keep_running

    # Reclaim space + clear orphaned uploads from prior runs before we start
    # accepting new jobs. Cheap (single iterdir on a small directory).
    _sweep_stale_inbox()

    auto_load = ""
    if args.open:
        src = Path(args.open).expanduser().resolve()
        if not src.exists():
            print(f"  ERROR: file not found: {src}"); return 1
        ext = src.suffix.lower()
        if ext in CAD_EXTS:
            # Always interactive: ask about the cached result and the quality
            dst = interactive_convert(src)
            if dst is None: return 1
            auto_load = "inbox/" + dst.name
        elif ext in (".glb", ".gltf"):
            # A .gltf may keep its geometry and textures in files beside it.
            # The app loads the one file it is given and would not find them.
            side = _gltf_side_files(src) if ext == ".gltf" else []
            if side:
                shown = ", ".join(side[:3]) + (f" and {len(side) - 3} more" if len(side) > 3 else "")
                print(f"  {src.name} keeps part of the model in separate files ({shown}),")
                print(f"  and --open can only hand the app a single file.")
                print(f"  Save the model as one .glb and open that instead.")
                return 1
            dst = INBOX / src.name
            # Already in inbox/ (`--open inbox/x.glb`): nothing to copy, and
            # copying a file onto itself is an error.
            if not (dst.exists() and os.path.samefile(src, dst)):
                shutil.copy2(src, dst)
            auto_load = "inbox/" + dst.name
        else:
            print(f"  Unsupported file type: {ext}"); return 1

    # ThreadingHTTPServer handles concurrent requests — single-threaded TCPServer
    # would block /api/job polling while a parallel /api/convert was uploading,
    # making the loader appear stuck. http.server.ThreadingHTTPServer was added
    # in Python 3.7 and is the standard for local dev tools.
    #
    # allow_reuse_address is SO_REUSEADDR. On Windows that lets a second server
    # bind a port another one is already serving (both "start", only one gets
    # the requests), so it is left off there; elsewhere it only allows a quick
    # restart on the same port.
    class _Server(http.server.ThreadingHTTPServer):
        allow_reuse_address = (os.name != "nt")
        daemon_threads = True

    # Already running? Then this launch is "open the window again": show it on
    # the server that is there instead of starting a second one on another
    # port (an installed copy of the app only knows the first address).
    if _already_running(args.port):
        url = f"http://localhost:{args.port}/index.html"
        if auto_load: url += "?file=" + quote(auto_load)
        print(f"\n  MeshOptimiser is already running at  {url}\n")
        if not args.no_browser:
            if args.tab or not _open_app_window(url):
                try: webbrowser.open(url)
                except Exception: pass
        return 0

    candidate_ports = list(dict.fromkeys([args.port, 4242, 5173, 8765, 9090, 7373, 3737, 8181, 0]))
    httpd = None; chosen_port = None; last_err = None
    for p in candidate_ports:
        try:
            httpd = _Server(("127.0.0.1", p), Handler)
            chosen_port = httpd.server_address[1]; break
        except OSError as e:
            last_err = e
            print(f"  port {p} unavailable, trying next...")
    if httpd is None:
        print(f"\n  ERROR: couldn't bind to any port. Last error: {last_err}"); return 1

    # Expose for the /api/quit handler — it can't reach this local otherwise.
    global HTTPD, RESTART_CMD
    HTTPD = httpd
    RESTART_CMD = ([sys.executable, str(Path(__file__).resolve()), "--port", str(chosen_port), "--no-browser"]
                   + (["--exit-when-closed"] if LIFE["exit_when_closed"] else []) + (["--keep-running"] if args.keep_running else []))

    with httpd:
        url = f"http://localhost:{chosen_port}/index.html"
        if auto_load: url += "?file=" + quote(auto_load)
        print(f"\n  MeshOptimiser running at  {url}\n  (press Ctrl+C to stop"
              + ("; it also stops when its window is closed)" if LIFE["exit_when_closed"] else ")") + "\n")
        if not args.no_browser:
            if args.tab or not _open_app_window(url):
                try: webbrowser.open(url)
                except Exception: pass
        threading.Thread(target=_watchdog, args=(httpd,), daemon=True).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            # A converter in a session of its own does not get the Ctrl+C.
            _stop_converters()
            print("\n  stopped."); return 0
        _stop_converters()
        return 0


if __name__ == "__main__":
    sys.exit(main())
