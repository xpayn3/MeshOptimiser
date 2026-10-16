#!/usr/bin/env python3
"""Build runtime/: a ready Python with every dependency installed, to be packed into the Windows download.

    python tools/build-runtime.py                       # uses ./.venv (the environment start.bat made) and the Python it was made from
    python tools/build-runtime.py --venv C:/path/.venv  # another environment
    python tools/build-runtime.py --slim                # also leave out what the app never imports (matplotlib and its fonts: a few tens of MB)

Why: the first start used to make a virtual environment and download about 600 MB with pip (cadquery-ocp pulls in vtk and more), which
fails on slow, filtered or offline PCs, and needs Python 3.10 - 3.12 on the PC first. With app/runtime/ in the zip, start.bat finds
runtime\\python.exe and starts the server at once: nothing to download, no Python to install.

What it makes: a normal Python layout (python.exe, python312.dll, the C runtime, DLLs/, Lib/ and Lib/site-packages with the packages of
requirements.txt) copied from a Python that is already on this PC and from the environment that has the packages. Nothing is
downloaded. runtime/MANIFEST.json says which Python, which packages and which requirements.txt it was built for (start.bat and the
updater compare that with requirements.txt). It is checked at the end by importing the three libraries and converting a STEP file.

app/runtime/ is a build product (git ignores it). tools/build-package.py --with-runtime packs it into MeshOptimiser-v<version>-windows.zip.
"""
from __future__ import annotations
import argparse, hashlib, json, os, shutil, subprocess, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
SKIP_LIB = {"test", "tests", "idlelib", "tkinter", "turtledemo", "lib2to3", "__pycache__", "site-packages", "ensurepip"}
SLIM_PACKAGES = ("matplotlib", "mpl_toolkits", "pylab.py", "fontTools", "contourpy", "kiwisolver", "cycler", "pyparsing", "dateutil")


def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def ignore_cache(_d, names):
    return [n for n in names if n == "__pycache__" or n.endswith((".pyc", ".pyo"))]


def copy_tree(src: Path, dst: Path, skip: set[str] = frozenset()):
    for item in src.iterdir():
        if item.name in skip: continue
        if item.is_dir(): shutil.copytree(item, dst / item.name, ignore=ignore_cache)
        else: dst.mkdir(parents=True, exist_ok=True); shutil.copy2(item, dst / item.name)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--venv", default=None, help="the environment that has the packages (default: .venv here, then app/.venv)")
    ap.add_argument("--out", default=str(APP / "runtime"))
    ap.add_argument("--slim", action="store_true", help="leave out matplotlib and what only it needs (the app never imports them)")
    ap.add_argument("--no-check", action="store_true")
    a = ap.parse_args()

    if os.name != "nt": raise SystemExit("The bundled runtime is for the Windows download: run this on Windows.")
    venv = Path(a.venv) if a.venv else next((p for p in (ROOT / ".venv", APP / ".venv") if (p / "Scripts" / "python.exe").is_file()), None)
    if not venv or not (venv / "Scripts" / "python.exe").is_file():
        raise SystemExit("No environment found. Run start.bat once (it makes .venv and installs the packages), or pass --venv.")
    cfg = {}
    for line in (venv / "pyvenv.cfg").read_text("utf-8").splitlines():
        if "=" in line: k, v = line.split("=", 1); cfg[k.strip()] = v.strip()
    base = Path(cfg.get("home", ""))
    if not (base / "python.exe").is_file(): raise SystemExit(f"The Python the environment was made from is not there any more: {base}")
    site = venv / "Lib" / "site-packages"
    py = subprocess.run([str(venv / "Scripts" / "python.exe"), "-c", "import sys;print('%d.%d.%d' % sys.version_info[:3])"], capture_output=True, text=True).stdout.strip()
    major_minor = "".join(py.split(".")[:2])
    print(f"Python {py} from {base}\npackages from {site}")

    out = Path(a.out)
    if out.exists(): shutil.rmtree(out)
    out.mkdir(parents=True)
    t0 = time.time()
    # the interpreter and the C runtime it needs
    for name in ("python.exe", "pythonw.exe", f"python{major_minor}.dll", "python3.dll", "vcruntime140.dll", "vcruntime140_1.dll", "LICENSE.txt"):
        if (base / name).is_file(): shutil.copy2(base / name, out / name)
    copy_tree(base / "DLLs", out / "DLLs")
    for dll in ("tcl86t.dll", "tk86t.dll"):                       # (nothing here uses Tk: its files go)
        for p in (out / "DLLs").glob(dll): p.unlink()
    for p in (out / "DLLs").glob("_tkinter*"): p.unlink()
    (out / "Lib").mkdir()
    copy_tree(base / "Lib", out / "Lib", SKIP_LIB)
    # the packages
    dst = out / "Lib" / "site-packages"
    skip = {"__pycache__"}
    if a.slim:
        skip |= set(SLIM_PACKAGES)
    dst.mkdir()
    for item in site.iterdir():
        if item.name in skip or item.name.startswith(tuple(s.replace(".py", "") + "-" for s in SLIM_PACKAGES)) and a.slim: continue
        if item.name.endswith(".pth") and "distutils" in item.name: continue
        if item.is_dir(): shutil.copytree(item, dst / item.name, ignore=ignore_cache)
        else: shutil.copy2(item, dst / item.name)

    frozen = subprocess.run([str(venv / "Scripts" / "python.exe"), "-m", "pip", "freeze"], capture_output=True, text=True).stdout.splitlines()
    req = APP / "requirements.txt"
    (out / "MANIFEST.json").write_text(json.dumps({
        "python": py, "built": time.strftime("%Y-%m-%d %H:%M"), "slim": a.slim,
        "requirements_sha256": sha256(req) if req.is_file() else "", "packages": frozen,
    }, indent=1), "utf-8")
    size = sum(f.stat().st_size for f in out.rglob("*") if f.is_file()) / 1048576
    print(f"copied in {time.time() - t0:.0f} s: {size:.0f} MB")

    if not a.no_check:
        rt = str(out / "python.exe")
        r = subprocess.run([rt, "-c", "import sys, OCP, trimesh, numpy; print(sys.version.split()[0], 'OCP', OCP.__file__.split(chr(92))[-2], 'trimesh', trimesh.__version__, 'numpy', numpy.__version__)"], capture_output=True, text=True, cwd=str(APP))
        print(r.stdout.strip() or r.stderr.strip()[-400:])
        if r.returncode: raise SystemExit("The runtime does not start: nothing is wrong with the app, but the zip must not be built from this.")
        test = ROOT / "tests" / "converter.test.py"       # (writes STEP, IGES and BREP files with OCP, converts them with step2glb.py and checks the result)
        if test.is_file():
            r = subprocess.run([rt, str(test)], capture_output=True, text=True, cwd=str(ROOT), timeout=1200)
            tail = (r.stdout + r.stderr).strip().splitlines()[-3:]
            import re
            m = re.search(r"(\d+) of (\d+) passed", r.stdout + r.stderr)
            print("Converter test: " + (m.group(0) if m else " | ".join(tail)[:300]) + "  (compare with the same test in .venv: a test that fails there fails here too)")
            if not m or int(m.group(1)) == 0: return 1
        else:
            print("(tests/converter.test.py is not here: only the imports were checked)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
