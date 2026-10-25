#!/usr/bin/env python3
"""serve.py: paths that name a dot-folder or dot-file are never served, also when the dot is written %2e or the slash %2f."""
import importlib.util, sys
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent / "app"))
from pathlib import Path

spec = importlib.util.spec_from_file_location("serve", Path(__file__).resolve().parent.parent / "app" / "serve.py")
serve = importlib.util.module_from_spec(spec); spec.loader.exec_module(serve)
hidden = serve.Handler._hidden
bad = 0
def ok(c, m):
    global bad
    print(("  ok    " if c else "  FAIL  ") + m)
    if not c: bad += 1

for p in ["/.venv/pyvenv.cfg", "/%2evenv/pyvenv.cfg", "/%2Evenv%2Fpyvenv.cfg", "/js/%2e%2e/.git/config", "/a/.update/x", "/%252evenv/x", "/.show-console", "/a%5c.git%5cconfig"]:
    ok(hidden(p), "hidden: " + p)
for p in ["/", "/index.html", "/js/app.js?v=1", "/assets/help/clip.webm", "/vendor/three.min.js", "/inbox/a.b.glb"]:
    ok(not hidden(p.split("?")[0]), "served: " + p)

# a long name leaves room for the inbox folder and the converter's files (Windows without long paths stops at 260)
lim = serve._name_limit()
long_name = ("a" * 400) + ".step"
cut = serve._sanitize_filename(long_name, limit=lim)
ok(cut.endswith(".step") and len(cut) <= lim, "a 400-character name is cut to the limit (%d) and keeps its extension" % lim)
ok(serve._sanitize_filename("part.stp", limit=lim) == "part.stp", "a short name is left as it is")
if serve.os.name == "nt":
    full = len(str(serve.INBOX.resolve())) + 1 + 13 + lim + len(".glb.brep.json.tmp")
    ok(full < 260, "on Windows the longest file the converter writes for it stays under 260 characters (%d)" % full)

# who is trusted: this server's own page (and curl, node, the launcher), never another site's page
import email.message, types
def trusted(**headers):
    h = serve.Handler.__new__(serve.Handler)
    h.headers = email.message.Message()
    for k, v in headers.items(): h.headers[k.replace("_", "-")] = v
    h.server = types.SimpleNamespace(server_address=("127.0.0.1", 4242))
    return h._trusted()
ok(trusted(Host="localhost:4242"), "trusted: the app's own GET (no Origin, no Sec-Fetch-Site: curl, node)")
ok(trusted(Host="127.0.0.1:4242", Sec_Fetch_Site="same-origin"), "trusted: the page's own fetch")
ok(trusted(Host="localhost:4242", Sec_Fetch_Site="none"), "trusted: an address typed in")
ok(trusted(Host="localhost:4242", Origin="http://localhost:4242", Sec_Fetch_Site="same-origin"), "trusted: the page's own POST")
ok(not trusted(Host="localhost:4242", Sec_Fetch_Site="cross-site"), "refused: another site's GET (no-cors fetch, <img>)")
ok(not trusted(Host="localhost:4242", Sec_Fetch_Site="same-site"), "refused: another local port's page")
ok(not trusted(Host="localhost:4242", Origin="http://localhost:8080"), "refused: another local port's POST")
ok(not trusted(Host="evil.example:4242"), "refused: DNS rebinding (another Host)")
ok(not trusted(Host="localhost:4242", Origin="null"), "refused: Origin null")

# The sample models live in the repository's inbox/, the app's own inbox is app/inbox: /inbox/<name> falls back to the repository
# when the app's inbox has no such file (the e2e tests open inbox/GearboxAssy.glb), and nothing else changes.
h = serve.Handler.__new__(serve.Handler); h.directory = str(serve.ROOT)
repo_inbox = serve.ROOT.parent / "inbox"
sample = next((f for f in (repo_inbox.glob("*.glb") if repo_inbox.is_dir() else []) if not (serve.INBOX / f.name).exists()), None)
if sample: ok(Path(h.translate_path("/inbox/" + sample.name)) == sample, "a sample model of the repository's inbox is served")
else: print("  (no sample model in the repository's inbox to check with)")
ok(Path(h.translate_path("/inbox/no-such-file.glb")) == serve.INBOX / "no-such-file.glb", "a file in neither inbox stays in the app's inbox (404)")
ok(Path(h.translate_path("/inbox/../serve.py")) == serve.ROOT / "serve.py", "no climbing out through /inbox/ (the stock rule: .. is dropped)")

print("\nall checks passed" if not bad else f"\n{bad} FAILED")
sys.exit(1 if bad else 0)
