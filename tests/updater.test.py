"""python tests/updater.test.py

The in-app updater (updater.py) on a fake app folder, a feed on 127.0.0.1 and hand-made archives: the check and what it says, a
whole update (files replaced, created and removed, the rest left alone), the way back, and everything that must be refused
before a file is touched: a wrong checksum or size, a cut-short download, paths that climb out of the folder, protected and
launcher files, a redirect to another host, a requirements install that fails, a file that cannot be written.
"""
import hashlib, http.server, io, json, os, shutil, sys, tempfile, threading, time, zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent / "app"
sys.path.insert(0, str(HERE))
os.environ["MO_UPDATE_DEV"] = "1"
import updater

fails = 0
def ok(cond, name, extra=""):
    global fails
    print(("  ok    " if cond else "  FAIL  ") + name + ((" - " + str(extra)) if (extra and not cond) else ""))
    if not cond: fails += 1
def raises(fn, text, name):
    try: fn()
    except updater.UpdateError as e: ok(text.lower() in str(e).lower(), name, str(e))
    except Exception as e: ok(False, name, "wrong error: " + repr(e))
    else: ok(False, name, "did not raise")

sha = lambda b: hashlib.sha256(b).hexdigest()

# ── a fake app folder, and the module pointed at it ─────────────────────────
APP = Path(tempfile.mkdtemp(prefix="mo-app-"))
def reset_app():
    for _ in range(40):
        shutil.rmtree(APP, ignore_errors=True)
        if not APP.exists(): break
        time.sleep(0.15)
    APP.mkdir(parents=True, exist_ok=True)
    for rel, data in {"index.html": b"<html>old</html>", "app.js": b"old js", "serve.py": b"old serve", "requirements.txt": b"numpy\n",
                      "vendor/three/three.js": b"three", "assets/a.png": b"png", "obsolete.js": b"gone soon",
                      "start.bat": b"launcher v1", "inbox/model.glb": b"MY MODEL", "exports/x.glb": b"EXPORT", ".venv/pyvenv.cfg": b"venv"}.items():
        p = APP / rel; p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(data)
    (APP / "version.json").write_text(json.dumps({"version": "0.21.0", "launcher": 1}))
    updater.ROOT = APP; updater.UPDATE_DIR = APP / ".update"; updater.BACKUP_DIR = updater.UPDATE_DIR / "backup"
    updater.PENDING = updater.UPDATE_DIR / "pending.json"; updater.NOTICE = updater.UPDATE_DIR / "notice.json"; updater.VERSION_FILE = APP / "version.json"
    updater.STATE.update(phase="idle", message="", error=None)
def tree():
    out = {str(p.relative_to(APP)).replace("\\", "/"): p.read_bytes() for p in sorted(APP.rglob("*")) if p.is_file() and ".update" not in p.parts}
    if "version.json" in out: out["version.json"] = json.dumps(json.loads(out["version.json"]), sort_keys=True).encode()      # (whitespace is not content)
    return out

def make_zip(files, version="0.22.0", extra_manifest=None, tamper=None, raw=None):
    """files: {path: bytes}. tamper: {path: other bytes written to the zip but not hashed}. raw: extra zip members."""
    man = {"schema": 1, "version": version, "requirements_sha256": "", "files": [{"path": k, "sha256": sha(v), "size": len(v)} for k, v in files.items()], "delete": []}
    man.update(extra_manifest or {})
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("update-manifest.json", json.dumps(man))
        for k, v in files.items(): z.writestr(k, (tamper or {}).get(k, v))
        for k, v in (raw or {}).items(): z.writestr(k, v)
    return buf.getvalue()

# ── a feed server on 127.0.0.1 ─────────────────────────────────────────────
SERVED = {}                              # path → (status, body bytes, headers)
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        st, body, hd = SERVED.get(self.path.split("?")[0], (404, b"", {}))
        self.send_response(st)
        for k, v in hd.items(): self.send_header(k, v)
        self.send_header("Content-Length", str(len(body))); self.end_headers()
        if st != 304:
            cut = hd.get("X-Cut")
            self.wfile.write(body[:int(cut)] if cut else body)
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{PORT}"
os.environ["MO_UPDATE_FEED"] = BASE + "/latest.json"

def feed_for(zbytes, version="0.22.0", **kw):
    e = {"version": version, "date": "2026-10-20", "notes": ["A", "B"], "headline": "H", "archive": {"url": BASE + "/app.zip", "sha256": sha(zbytes), "size": len(zbytes)},
         "launcher": 1, "min_from": "", "requirements_changed": False}
    e.update(kw)
    return e
def serve_feed(stable=None, beta=None, schema=1):
    f = {"schema": schema}
    if stable is not None: f["stable"] = stable
    if beta is not None: f["beta"] = beta
    SERVED["/latest.json"] = (200, json.dumps(f).encode(), {})

def run_install(channel="stable", guard=None, timeout=30):
    done = {}
    updater.start_install(channel, lambda r: done.update(r), guard)
    t0 = time.time()
    while time.time() - t0 < timeout:
        s = updater.status()
        if s["phase"] in ("error", "restarting"): return s, done
        time.sleep(0.05)
    return updater.status(), done

# ── versions ────────────────────────────────────────────────────────────────
print("versions")
ok(updater.newer("0.22.0", "0.21.0") and updater.newer("0.10.0", "0.9.9") and updater.newer("1.0.0", "0.99.99"), "numbers compare as numbers (0.10 > 0.9)")
ok(updater.newer("0.22.0", "0.22.0-beta.3") and not updater.newer("0.22.0-beta.3", "0.22.0"), "a beta is older than its release")
ok(updater.newer("0.22.0-beta.2", "0.22.0-beta.1") and updater.newer("0.22.0-beta.10", "0.22.0-beta.9"), "betas count up")
ok(not updater.newer("0.21.0", "0.21.0"), "the same version is not newer")
ok(updater.parse_version("banana") is None and updater.parse_version("1.2") is None and updater.parse_version("") is None, "junk is not a version")

# ── the check ───────────────────────────────────────────────────────────────
print("check")
reset_app()
z1 = make_zip({"index.html": b"<html>new</html>", "app.js": b"new js", "newfile.js": b"brand new", "vendor/three/three.js": b"three"})
serve_feed(stable=feed_for(z1))
r = updater.check("stable")
ok(r["available"] and r["latest"] == "0.22.0" and r["current"] == "0.21.0" and r["installable"] and r["notes"] == ["A", "B"], "a newer version is found, with its notes", r)
ok("_entry" in r, "the entry it came from is returned for the installer (the endpoint strips it)")
serve_feed(stable=feed_for(z1, version="0.21.0"))
ok(not updater.check("stable")["available"], "the same version: up to date")
serve_feed(stable=feed_for(z1, version="0.20.0"))
ok(not updater.check("stable")["available"], "an older version: up to date")
serve_feed(stable=feed_for(z1), beta=feed_for(z1, version="0.23.0-beta.1"))
ok(updater.check("stable")["latest"] == "0.22.0" and updater.check("beta")["latest"] == "0.23.0-beta.1", "channels are separate")
serve_feed(stable=feed_for(z1, version="0.24.0"), beta=feed_for(z1, version="0.23.0-beta.1"))
ok(updater.check("beta")["latest"] == "0.24.0", "beta also sees a newer stable release")
serve_feed(stable=feed_for(z1, launcher=2))
r = updater.check("stable"); ok(r["available"] and not r["installable"] and "launcher" in r["reason"].lower(), "a release that changes the launcher is not installed in place", r)
serve_feed(stable=feed_for(z1, min_from="0.21.5"))
r = updater.check("stable"); ok(r["available"] and not r["installable"] and "0.21.5" in r["reason"], "min_from is honoured", r)
e = feed_for(z1); e["archive"] = {}
serve_feed(stable=e); r = updater.check("stable"); ok(r["available"] and not r["installable"], "no archive: shown, but not installable", r)
serve_feed(stable=feed_for(z1), schema=2); raises(lambda: updater.check("stable"), "format", "an unknown feed schema is refused")
SERVED["/latest.json"] = (200, b"{not json", {}); raises(lambda: updater.check("stable"), "could not be read", "a feed that is not JSON is refused")
SERVED["/latest.json"] = (200, b"x" * (updater.MAX_FEED + 10), {}); raises(lambda: updater.check("stable"), "larger", "an oversized feed is refused")
SERVED["/latest.json"] = (500, b"", {}); raises(lambda: updater.check("stable"), "500", "a server error is reported")
SERVED.pop("/latest.json"); raises(lambda: updater.check("stable"), "404", "a missing feed is reported")
os.environ["MO_UPDATE_FEED"] = "http://127.0.0.1:1/latest.json"; raises(lambda: updater.check("stable"), "could not reach", "an unreachable server is reported")
os.environ["MO_UPDATE_FEED"] = "http://example.com/latest.json"; raises(lambda: updater.check("stable"), "trust", "an http address on another host is refused")
os.environ["MO_UPDATE_FEED"] = "https://evil.example.com/latest.json"; raises(lambda: updater.check("stable"), "trust", "an https address on another host is refused")
os.environ["MO_UPDATE_FEED"] = BASE + "/latest.json"
os.environ["MO_UPDATE_DEV"] = "0"; os.environ["MO_UPDATE_FEED"] = "http://127.0.0.1:%d/latest.json" % PORT
raises(lambda: updater.check("stable"), "trust", "without dev mode even 127.0.0.1 over http is refused")
os.environ["MO_UPDATE_DEV"] = "1"; os.environ["MO_UPDATE_FEED"] = BASE + "/latest.json"
SERVED["/latest.json"] = (302, b"", {"Location": "http://example.com/steal.json"}); raises(lambda: updater.check("stable"), "trust", "a redirect to another host is refused")

# ── a whole update ──────────────────────────────────────────────────────────
print("install")
reset_app(); before = tree()
z1 = make_zip({"index.html": b"<html>new</html>", "app.js": b"new js", "newfile.js": b"brand new", "vendor/three/three.js": b"three", "assets/b/c.png": b"deep"},
              extra_manifest={"delete": ["obsolete.js"]})
SERVED["/app.zip"] = (200, z1, {}); serve_feed(stable=feed_for(z1))
mt = (APP / "vendor/three/three.js").stat().st_mtime_ns
st, done = run_install()
ok(st["phase"] == "restarting" and done.get("to") == "0.22.0", "the update runs to the restart step", st)
now = tree()
ok(now["index.html"] == b"<html>new</html>" and now["app.js"] == b"new js", "changed files are replaced")
ok(now["newfile.js"] == b"brand new" and now["assets/b/c.png"] == b"deep", "new files are created, with their folders")
ok("obsolete.js" not in now, "a file the release removes is removed")
ok(now["serve.py"] == b"old serve" and now["assets/a.png"] == b"png", "files the release does not list are left alone")
ok((APP / "vendor/three/three.js").stat().st_mtime_ns == mt, "an identical file is not rewritten")
ok(now["inbox/model.glb"] == b"MY MODEL" and now["exports/x.glb"] == b"EXPORT" and now[".venv/pyvenv.cfg"] == b"venv", "inbox, exports and .venv are untouched")
ok(now["start.bat"] == b"launcher v1", "the launcher is untouched")
v = json.loads((APP / "version.json").read_text()); ok(v == {"version": "0.22.0", "launcher": 1}, "version.json says 0.22.0 and keeps the launcher level", v)
ok(updater.backup_info() and updater.backup_info()["version"] == "0.21.0", "a backup of the old version exists")
ok(updater.PENDING.is_file(), "the update waits for the page to confirm it")
ok(not list(APP.rglob("*.new")) and not list(APP.rglob("*.part")), "no temporary files are left behind")
# the way back
res = updater.rollback("test")
back = tree()
ok(res["restored"] == "0.21.0", "rollback names the version it went back to")
ok(back == before, "rollback puts every file back exactly, including the removed one and without the created ones", set(back) ^ set(before))
ok(json.loads((APP / "version.json").read_text())["version"] == "0.21.0", "…and the version")
ok(updater.backup_info() is None and not updater.PENDING.is_file(), "the backup is used up and nothing is pending")
ok(json.loads(updater.NOTICE.read_text())["kind"] == "rolled_back", "the page is told once what happened")
raises(lambda: updater.rollback(), "no earlier", "rollback with nothing to go back to is refused")
# the page confirms a good update
reset_app(); SERVED["/app.zip"] = (200, z1, {}); st, _ = run_install(); updater.confirm()
ok(not updater.PENDING.is_file() and json.loads(updater.NOTICE.read_text())["kind"] == "updated", "confirm clears the pending update and leaves the 'updated' notice")
updater.clear_notice(); ok(not updater.NOTICE.is_file(), "the notice is shown once")
ok(updater.backup_info() is not None, "the backup stays after a confirmed update (one step back stays possible)")
# nothing newer (a real restart clears the state; here it is cleared by hand)
updater.STATE.update(phase="idle")
st, _ = run_install(); ok(st["phase"] == "error" and "newest" in st["error"].lower(), "installing when up to date says so", st)

# ── what must be refused, with nothing changed ─────────────────────────────
print("refusals")
def refuse_case(name, zbytes, why, feed_kw=None, headers=None, status=200, feed_zbytes=None):
    reset_app(); before = tree()
    SERVED["/app.zip"] = (status, zbytes, headers or {})
    serve_feed(stable=feed_for(feed_zbytes if feed_zbytes is not None else zbytes, **(feed_kw or {})))
    st, _ = run_install()
    ok(st["phase"] == "error" and why.lower() in (st["error"] or "").lower(), name + ": refused", st)
    ok(tree() == before and not updater.backup_info() and not updater.PENDING.is_file(), name + ": nothing was changed")
    ok(updater.STATE["phase"] == "error" and not list(APP.rglob("mo-update-*")), name + ": no temporary folder is left")

good = make_zip({"index.html": b"<html>new</html>"})
refuse_case("a wrong checksum in the feed", good, "checksum", feed_kw={"archive": {"url": BASE + "/app.zip", "sha256": "0" * 64, "size": len(good)}})
refuse_case("a wrong size in the feed", good, "larger", feed_kw={"archive": {"url": BASE + "/app.zip", "sha256": sha(good), "size": len(good) - 5}})
refuse_case("a download cut short", good, "cut short", headers={"X-Cut": str(len(good) // 2)})
refuse_case("an archive that is not a zip", b"this is not a zip file at all", "could not be opened")
refuse_case("an archive for another version", make_zip({"index.html": b"x"}, version="0.30.0"), "another version", feed_zbytes=None, feed_kw={"version": "0.22.0"})
refuse_case("an archive without a manifest", (lambda b: (zipfile.ZipFile(b, "w").writestr("index.html", "x"), b.getvalue())[1])(io.BytesIO()), "no manifest")
tampered = make_zip({"index.html": b"<html>new</html>"}, tamper={"index.html": b"<html>EVIL</html>"})
refuse_case("a file that differs from its own hash", tampered, "checksum")
refuse_case("a file missing from the archive", make_zip({"index.html": b"x"}, extra_manifest={"files": [{"path": "index.html", "sha256": sha(b"x")}, {"path": "ghost.js", "sha256": sha(b"y")}]}), "missing")
refuse_case("a missing file listed twice", make_zip({"index.html": b"x"}, extra_manifest={"files": [{"path": "index.html", "sha256": sha(b"x")}] * 2}), "twice")
for bad in ["../evil.txt", "a/../../evil.txt", "/abs/evil.txt", "C:/Windows/evil.txt", "..\\evil.txt", "a\\b.js", "dir/./x.js", "x:stream.js", "name .js/../x", "trail./x.js", "sp /x.js",
            "inbox/model.glb", "Inbox/model.glb", "EXPORTS/x.glb", ".venv/Scripts/python.exe", ".git/config", ".update/pending.json", ".hidden", "__pycache__/x.pyc", "server.log",
            "start.bat", "START.BAT", "start.command", "step2glb.bat", "version.json", "Version.JSON", "update-manifest.json", ""]:
    refuse_case("path " + repr(bad), make_zip({bad: b"x"}) if bad else make_zip({"index.html": b"x"}, extra_manifest={"files": [{"path": "", "sha256": sha(b"x")}]}), "")
# a zip bomb by count
refuse_case("too many files", make_zip({f"f{i}.js": b"x" for i in range(5)}), "", ) if False else None

# reserved Windows device names, even with an extension or in a folder
for bad in ["assets/aux.png", "CON", "nul.txt", "a/COM1.js", "Lpt3.x/y.js"]:
    refuse_case("reserved name " + repr(bad), make_zip({bad: b"x"}), "reserved")
# an archive swapped after it was checked: caught while writing, everything put back
reset_app(); before = tree()
zgood = make_zip({"index.html": b"<html>new</html>", "app.js": b"new js"})
tmpz = APP.parent / "swap-test.zip"; tmpz.write_bytes(zgood)
man = updater.verify_archive(tmpz, "0.22.0")
tmpz.write_bytes(make_zip({"index.html": b"<html>new</html>", "app.js": b"new js"}, tamper={"app.js": b"EVIL js"}))
raises(lambda: updater.apply_archive(tmpz, man), "changed after it was checked", "a file swapped after the check is caught as it is written")
ok(tree() == before and not updater.PENDING.is_file(), "…and the files already replaced are put back")
tmpz.unlink()
# a hostile link in the feed never becomes a link
serve_feed(stable=feed_for(z1, more="javascript:alert(1)")); ok(updater.check("stable")["more"] == "", "a javascript: link from the feed is dropped")
serve_feed(stable=feed_for(z1, more="https://lukagrcar.com/x")); ok(updater.check("stable")["more"] == "https://lukagrcar.com/x", "an https link is kept")

# a file that cannot be written: the folder of the new file is in the way of a file → put everything back
reset_app()
(APP / "blocked").write_bytes(b"i am a file where the update wants a folder")
before = tree()
zb = make_zip({"index.html": b"<html>new</html>", "app.js": b"new js", "blocked/inner.js": b"cannot exist"})
SERVED["/app.zip"] = (200, zb, {}); serve_feed(stable=feed_for(zb))
st, _ = run_install()
ok(st["phase"] == "error" and "put back" in st["error"].lower(), "a file that cannot be written stops the update", st)
ok(tree() == before, "…and every file replaced before it is put back", set(tree()) ^ set(before))
ok(json.loads((APP / "version.json").read_text())["version"] == "0.21.0" and not updater.PENDING.is_file(), "…the version is unchanged and nothing is pending")

# requirements: installed first; a failure changes nothing
reset_app(); before = tree(); calls = []
zr = make_zip({"index.html": b"<html>new</html>", "requirements.txt": b"numpy\ncadquery-ocp\n"}, extra_manifest={"requirements_sha256": sha(b"numpy\ncadquery-ocp\n")})
SERVED["/app.zip"] = (200, zr, {}); serve_feed(stable=feed_for(zr))
real_pip = updater._pip_install
def failing(req): calls.append(req.read_bytes()); raise updater.UpdateError("The Python packages could not be installed: no network. Nothing was changed.")
updater._pip_install = failing
st, _ = run_install()
ok(calls == [b"numpy\ncadquery-ocp\n"], "a changed requirements.txt is installed before any file is replaced")
ok(st["phase"] == "error" and tree() == before, "a failed install changes nothing", st)
updater._pip_install = lambda req: calls.append(b"ok")
reset_app(); SERVED["/app.zip"] = (200, zr, {}); st, done = run_install()
ok(st["phase"] == "restarting" and (APP / "requirements.txt").read_bytes() == b"numpy\ncadquery-ocp\n", "…and then the update goes through")
updater._pip_install = real_pip
reset_app(); calls.clear(); updater._pip_install = lambda req: calls.append(1)
zn = make_zip({"index.html": b"<html>new</html>", "requirements.txt": b"numpy\n"}, extra_manifest={"requirements_sha256": sha(b"numpy\n")})
SERVED["/app.zip"] = (200, zn, {}); serve_feed(stable=feed_for(zn)); st, _ = run_install()
ok(st["phase"] == "restarting" and not calls, "an unchanged requirements.txt is not installed again")
updater._pip_install = real_pip

# the guard (a conversion is running), and cancel
reset_app(); before = tree(); SERVED["/app.zip"] = (200, z1, {}); serve_feed(stable=feed_for(z1))
st, _ = run_install(guard=lambda: "A conversion is still running. Let it finish first, then update.")
ok(st["phase"] == "error" and "conversion" in st["error"] and tree() == before, "an update waits for a running conversion")
reset_app()
updater.start_install("stable", lambda r: None, None)
try: updater.start_install("stable", lambda r: None, None); second = "started"
except updater.UpdateError as e: second = "refused"
for _ in range(200):
    if updater.status()["phase"] in ("error", "restarting"): break
    time.sleep(0.05)
ok(second == "refused", "a second update cannot start while one runs")

# ── start-up: an update the page never confirmed is taken back ──────────────
print("start-up")
reset_app(); SERVED["/app.zip"] = (200, z1, {}); serve_feed(stable=feed_for(z1)); run_install()
ok(updater.on_startup() is False and json.loads(updater.PENDING.read_text())["boots"] == 1, "first start after an update: counted, kept")
ok(updater.on_startup() is False and json.loads(updater.PENDING.read_text())["boots"] == 2, "second start: counted, kept")
ok(updater.on_startup() is True and json.loads((APP / "version.json").read_text())["version"] == "0.21.0", "third start with no confirmation: the old version is put back")
ok(json.loads(updater.NOTICE.read_text())["kind"] == "rolled_back" and not updater.PENDING.is_file(), "…and the page will say so")
reset_app(); run_install(); updater.on_startup(); updater.confirm()
ok(updater.on_startup() is False and (APP / "version.json").read_text().count("0.22.0") == 1, "a confirmed update is never taken back")
ok(updater.on_startup() is False, "no pending update: nothing happens")

# ── status for the page ─────────────────────────────────────────────────────
s = updater.status(); ok(s["current"] == "0.22.0" and "phase" in s and "backup" in s, "status has the version, the phase and the backup", s)

srv.shutdown(); time.sleep(0.3); shutil.rmtree(APP, ignore_errors=True)
print(f"\n{'all checks passed' if not fails else str(fails) + ' FAILED'}")
sys.exit(1 if fails else 0)
