#!/usr/bin/env python3
"""Local server + CAD->GLB conversion entry point (STEP, IGES, BREP).

Run via:
    python serve.py                # start server, open browser empty
    python serve.py --open file    # start server, auto-load file
                                    # (asks about re-convert + quality if CAD)
"""
from __future__ import annotations
import argparse, atexit, http.server, json, os, re, select, shutil, signal, subprocess
import sys, threading, time, uuid, webbrowser
from pathlib import Path
from urllib.parse import urlparse, parse_qs, quote

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
        # Everything is fetched fresh, so an edit shows on reload. The app's own
        # pictures and clips (assets/) are the exception: the browser may keep
        # them and only asks whether they changed (a 304 with no body).
        own_asset = (getattr(self, 'path', '') or '').split('?')[0].startswith('/assets/')
        self.send_header('Cache-Control', 'no-cache' if own_asset else 'no-store')
        super().end_headers()

    def log_message(self, format, *args):
        try: msg = format % args
        except Exception: msg = str(args)
        if "/favicon.ico" in msg: return
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
        if u.path.startswith("/api/job/"):
            job_id = u.path.rsplit("/", 1)[-1]
            # A copy taken under the lock, so "log" and "log_base" belong together.
            with JOBS_LOCK:
                job = JOBS.get(job_id)
                if job is not None: job = {**job, "log": list(job.get("log") or [])}
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
        if u.path == "/api/convert": return self._handle_convert()
        if u.path == "/api/quit":    return self._handle_quit()
        if u.path.startswith("/api/cancel/"):
            return self._handle_cancel(u.path.rsplit("/", 1)[-1])
        return self._json({"error": "unknown endpoint"}, 404)

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
        with JOBS_LOCK:
            job = JOBS.get(job_id)
            proc = PROCS.get(job_id)
            if job is None:
                return self._json({"error": "not found"}, 404)
            if job.get("status") in ("queued", "running"):
                job["status"] = "cancelled"
                job["message"] = "cancelled"
        if proc is not None:
            _kill_tree(proc)
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
        }

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
                "id": job_id, "status": "queued", "started_at": time.time(),
                "src_name": name, "src_size_mb": size / 1048576,
                "log": [], "log_base": 0, "message": "queued", "progress": 0, "result": None,
            }
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
    global HTTPD
    HTTPD = httpd

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
