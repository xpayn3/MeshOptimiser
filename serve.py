#!/usr/bin/env python3
"""Local server + STEP->GLB conversion entry point.

Run via:
    python serve.py                # start server, open browser empty
    python serve.py --open file    # start server, auto-load file
                                    # (asks about re-convert + quality if STEP)
"""
from __future__ import annotations
import argparse, http.server, json, os, re, shutil, subprocess
import sys, threading, time, uuid, webbrowser
from pathlib import Path
from urllib.parse import urlparse, parse_qs, quote

PORT = 4242
ROOT = Path(__file__).parent.resolve()
INBOX = ROOT / "inbox"
INBOX.mkdir(exist_ok=True)

# ─── Hard limits / safety knobs ─────────────────────────────────────────────
# 4 GB upload cap. STEP files for very large CAD assemblies can hit ~1 GB; 4 GB
# leaves headroom while preventing accidental DoS via runaway uploads.
MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024
# Keep at most this many completed jobs in memory. Prevents the JOBS dict from
# growing unbounded over a long-running server session.
MAX_JOBS_RETAINED = 50
# Safe filename pattern: alphanum + a few separators. Strips path traversal,
# null bytes, control chars, etc. before we ever touch disk.
_SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9._\- ]")

# Background conversion job registry for the /api/convert browser endpoint
JOBS: dict[str, dict] = {}
JOBS_LOCK = threading.Lock()


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
                    if j.get("status") in ("done", "error")]
        finished.sort(key=lambda kv: kv[1].get("started_at", 0))
        excess = len(JOBS) - MAX_JOBS_RETAINED
        for jid, _ in finished[:excess]:
            JOBS.pop(jid, None)


def _ask(prompt: str, default: str = "") -> str:
    """Prompt the user; returns stripped answer or default if blank/EOF."""
    print(prompt, end="", flush=True)
    try:
        a = input().strip()
        return a if a else default
    except EOFError:
        return default


def interactive_convert(src: Path) -> Path | None:
    """Ask user about caching + quality, then run step2glb.py.
    Returns the path of the resulting GLB (relative to ROOT)."""
    dst = INBOX / (src.stem + ".glb")
    quality = "0.5"
    force = False

    if dst.exists() and dst.stat().st_mtime > src.stat().st_mtime:
        cache_age = time.time() - dst.stat().st_mtime
        ans = _ask(
            f"\n  Cached GLB found:\n"
            f"    {dst.name}  ({dst.stat().st_size/1048576:.1f} MB, "
            f"converted {cache_age/60:.0f} min ago)\n"
            f"  Re-convert? [y/N]: ", "n")
        if ans.lower() not in ("y", "yes"):
            print(f"  Using cached GLB.\n")
            return dst

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
    # Sensible default: physical cores - 1, capped at 8. Past ~8 the per-worker
    # BREP-load overhead (each worker re-loads the serialized compound) starts
    # to dominate the per-solid extraction time, so more workers stop helping.
    # Users with beefy CPUs can override and try higher numbers — the full
    # range is just bounded below by 0.
    try:
        cpu_count = os.cpu_count() or 4
    except Exception:
        cpu_count = 4
    suggested = min(8, max(2, cpu_count - 1))
    par_ans = _ask(
        f"  Parallel workers for mesh extraction (0 = sequential, "
        f"recommended = {suggested} on your {cpu_count}-core CPU, max useful ~{cpu_count}): ",
        str(suggested))
    try: parallel = int(par_ans)
    except ValueError: parallel = 0

    print()
    cmd = [sys.executable, str(ROOT / "step2glb.py"), str(src),
           "--out", str(dst), "--quality", quality, "--force-colors"]
    # --force-colors guarantees the XCAF reader runs regardless of file size,
    # so the new hierarchical path (assembly tree + instance detection) always
    # fires. Without this, files over the auto-threshold silently fall back to
    # the flat plain reader and you lose names + hierarchy + instances.
    if force: cmd.append("--force")
    if parallel > 1: cmd += ["--parallel", str(parallel)]
    print(f"  Running: step2glb.py {src.name} --quality {quality} --force-colors"
          + (" --force" if force else "")
          + (f" --parallel {parallel}" if parallel > 1 else ""))
    print()
    rc = subprocess.call(cmd, cwd=ROOT)
    if rc != 0:
        print(f"\n  Conversion failed with exit code {rc}.")
        return None
    return dst


# ─── /api/convert background job runner (for in-browser drag-and-drop)
def _convert_thread(job_id: str, src_path: Path, dst_path: Path,
                     quality: float, min_size: float) -> None:
    with JOBS_LOCK:
        JOBS[job_id]["status"] = "running"
        JOBS[job_id]["log"] = []
    try:
        # --force-colors keeps the XCAF reader on for any size — without it,
        # the in-browser drag of a 300+ MB STEP would silently use the flat
        # plain reader and lose hierarchy/instances/names.
        cmd = [sys.executable, str(ROOT / "step2glb.py"), str(src_path),
               "--out", str(dst_path), "--quality", str(quality), "--force-colors"]
        if min_size > 0: cmd += ["--min-size", str(min_size)]
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, bufsize=1, cwd=ROOT)
        for line in proc.stdout:
            line = line.rstrip()
            with JOBS_LOCK:
                JOBS[job_id]["log"].append(line)
                if len(JOBS[job_id]["log"]) > 200:
                    JOBS[job_id]["log"] = JOBS[job_id]["log"][-200:]
                JOBS[job_id]["message"] = line
        rc = proc.wait()
        if rc != 0:
            raise RuntimeError(f"step2glb.py exited with code {rc}")
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
            JOBS[job_id]["status"] = "error"
            JOBS[job_id]["message"] = str(e)


# ─── HTTP handler ─────────────────────────────────────────────────────────
class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.js': 'application/javascript', '.mjs': 'application/javascript',
        '.wasm': 'application/wasm', '.html': 'text/html',
        '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
    }

    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'credentialless')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, format, *args):
        try: msg = format % args
        except Exception: msg = str(args)
        if "/favicon.ico" in msg: return
        sys.stderr.write(f"  {self.address_string()} - {msg}\n")

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/favicon.ico":
            self.send_response(204); self.end_headers(); return
        if u.path == "/api/jobs": return self._json(JOBS)
        if u.path.startswith("/api/job/"):
            job_id = u.path.rsplit("/", 1)[-1]
            with JOBS_LOCK: job = JOBS.get(job_id)
            if job is None: return self._json({"error": "not found"}, 404)
            return self._json(job)
        return super().do_GET()

    def do_POST(self):
        u = urlparse(self.path)
        if u.path == "/api/convert": return self._handle_convert()
        return self._json({"error": "unknown endpoint"}, 404)

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
        # Extension allow-list — never write anything that's not STEP-shaped.
        if not name.lower().endswith((".step", ".stp")):
            return self._json({"error": "filename must end in .step or .stp"}, 400)

        try:
            quality = float(q.get("quality", ["0.5"])[0])
            min_size = float(q.get("min_size", ["0"])[0])
        except ValueError:
            return self._json({"error": "quality and min_size must be numeric"}, 400)
        if not (1e-6 <= quality <= 1e3):
            return self._json({"error": "quality out of range (1e-6 .. 1000)"}, 400)
        if not (0.0 <= min_size <= 100.0):
            return self._json({"error": "min_size out of range (0 .. 100)"}, 400)

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
                "log": [], "message": "queued", "progress": 0, "result": None,
            }
        threading.Thread(target=_convert_thread,
                         args=(job_id, src, dst, quality, min_size),
                         daemon=True).start()
        return self._json({"job_id": job_id})


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=PORT)
    ap.add_argument("--open", "-o", type=str)
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()
    os.chdir(ROOT)

    auto_load = ""
    if args.open:
        src = Path(args.open).expanduser().resolve()
        if not src.exists():
            print(f"  ERROR: file not found: {src}"); return 1
        ext = src.suffix.lower()
        if ext in (".step", ".stp"):
            # Always interactive: ask about cache + quality + parallel
            dst = interactive_convert(src)
            if dst is None: return 1
            auto_load = "inbox/" + dst.name
        elif ext in (".glb", ".gltf"):
            dst = INBOX / src.name
            shutil.copy2(src, dst)
            auto_load = "inbox/" + dst.name
        else:
            print(f"  Unsupported file type: {ext}"); return 1

    # ThreadingHTTPServer handles concurrent requests — single-threaded TCPServer
    # would block /api/job polling while a parallel /api/convert was uploading,
    # making the loader appear stuck. http.server.ThreadingHTTPServer was added
    # in Python 3.7 and is the standard for local dev tools.
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    candidate_ports = [args.port, 4242, 5173, 8765, 9090, 7373, 3737, 8181, 0]
    httpd = None; chosen_port = None; last_err = None
    for p in candidate_ports:
        try:
            httpd = http.server.ThreadingHTTPServer(("127.0.0.1", p), Handler)
            chosen_port = httpd.server_address[1]; break
        except OSError as e:
            last_err = e
            print(f"  port {p} unavailable, trying next...")
    if httpd is None:
        print(f"\n  ERROR: couldn't bind to any port. Last error: {last_err}"); return 1

    with httpd:
        url = f"http://localhost:{chosen_port}/index.html"
        if auto_load: url += "?file=" + quote(auto_load)
        print(f"\n  STEP Optimizer running at  {url}\n  (press Ctrl+C to stop)\n")
        if not args.no_browser:
            try: webbrowser.open(url)
            except Exception: pass
        try: httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n  stopped."); return 0


if __name__ == "__main__":
    sys.exit(main())
