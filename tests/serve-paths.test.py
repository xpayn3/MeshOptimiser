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
print("\nall checks passed" if not bad else f"\n{bad} FAILED")
sys.exit(1 if bad else 0)
