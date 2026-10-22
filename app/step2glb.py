#!/usr/bin/env python3
"""
step2glb.py — Native CAD to optimized GLB converter (Pixyz-style preprocessor).
Reads STEP (.step .stp), IGES (.iges .igs) and BREP (.brep .brp).

Features:
  - XCAF-based STEP reader: extracts per-solid colors + names + assembly tree
  - PCA pose-normalized hash: same shape at different positions/rotations is detected
    as instances → one geometry on GPU + per-instance transforms
  - Configurable tessellation quality (absolute, or relative to the size of each edge)
  - Optional size threshold (drop tiny parts during conversion)
  - Writes GLB with PBR materials so the web viewer picks up color groups
  - Optional EXT_meshopt_compression via gltfpack (industry-standard, ~10x smaller)
  - What the CAD file knows (instance and product names, assembly path, colour, part
    number, layers, material, volume/area) goes into each glTF node's "extras"
  - LOD files (--lod 100,50,25) and whole folders (--batch DIR)

Usage:
    python step2glb.py input.step
    python step2glb.py input.step --quality 0.2 --min-size 0.5
    python step2glb.py input.step --simplify 0.5    # halve triangle count (lossy)
    python step2glb.py input.step --no-meshopt      # disable auto-meshopt
    python step2glb.py input.step --relative        # quality is a fraction of each edge's size
    python step2glb.py input.step --no-colors --no-instance   # plain reader, no instancing
    python step2glb.py part.iges                    # IGES / BREP: same options as STEP
    python step2glb.py input.step --lod 100,50,25   # also input_lod1.glb, input_lod2.glb
    python step2glb.py --batch DIR --out OUT --recursive    # every CAD file in DIR
    python step2glb.py input.step --no-extras       # leave the CAD metadata out of the nodes

Defaults:
    EXT_meshopt_compression turns on automatically when gltfpack is on PATH.
    Pass --no-meshopt to opt out, or --simplify <r> to additionally decimate.

Exit codes:
    0  converted (or the cached GLB is still current)
    1  the conversion failed
    3  the file was read but there was nothing to write: it has no solid
       bodies (IGES and BREP: no surfaces either), or --min-size removed
       every part. No GLB is written.
    --batch: 0 when every file converted, 1 when at least one did not.

Requirements:
    pip install cadquery-ocp trimesh numpy
    optional: gltfpack on PATH (https://meshoptimizer.org/gltf/)
"""
from __future__ import annotations
import argparse, csv, hashlib, json, math, os, shutil, struct, subprocess, sys, tempfile, time, traceback
from dataclasses import dataclass, replace as _dc_replace
from pathlib import Path
from collections import defaultdict

# Windows Python 3.12 defaults stdout/stderr to cp1252 — force UTF-8 so the
# Unicode box-drawing / arrow / check characters in our log output don't crash.
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass


# ─── heartbeat: prints periodic "still working" lines during long blocking calls
# Earlier this used a Python daemon thread, but OCCT's STEPCAFControl_Reader
# holds the GIL the entire time it's parsing — the heartbeat thread never got
# scheduled and only printed once at the very start. A subprocess sidesteps the
# GIL completely: it prints to the same console (inherited stdout) on its own
# OS-level scheduling, regardless of what the main interpreter is busy with.
class Heartbeat:
    def __init__(self, label: str, every_s: float = 5.0, expect_s: float = 0.0):
        # expect_s: a guess at how long the step takes, printed beside the elapsed time (0 = no guess)
        self.label = label; self.every = every_s; self.expect_s = expect_s
        self._proc = None; self._t0 = 0.0
    def __enter__(self):
        self._t0 = time.time()
        # --batch runs each file in a process of its own and reads the log
        # afterwards. A helper left behind by a crashed converter would run
        # for ever (see the note below), so the batch asks for none.
        if os.environ.get("STEP2GLB_NO_HEARTBEAT"):
            return self
        # Inline heartbeat script. -u keeps stdout unbuffered on Windows where
        # the cmd.exe pipe sometimes line-buffers Python output. We deliberately
        # do NOT check parent liveness via os.kill(ppid, 0) — it works on Linux
        # but raises OSError on Windows for signal 0, which silently killed the
        # subprocess after the first tick. Popen.terminate() in __exit__ is the
        # normal way out.
        #
        # A converter that is killed never reaches __exit__. Away from Windows
        # the helper notices on its next tick: an orphan is handed to another
        # parent, so os.getppid() stops being the converter's pid. On Windows
        # getppid() keeps returning the old pid, so the helper holds a handle
        # on the converter's process and asks whether it has ended. (It used
        # to skip the check there: after a native crash the orphan kept the
        # server's pipe open and kept printing, so the job never ended and
        # the server's crash fallback, the plain reader, was never reached.)
        safe_label = self.label.encode("ascii", "replace").decode("ascii")
        code = (
            "import os, sys, time\n"
            f"EVERY = {float(self.every)}\n"
            f"LABEL = {safe_label!r}\n"
            f"EXPECT = {float(self.expect_s)}\n"
            f"PARENT = {os.getpid()}\n"
            "if os.name == 'nt':\n"
            "    import ctypes\n"
            "    _H = ctypes.windll.kernel32.OpenProcess(0x00100000, False, PARENT)\n"      # SYNCHRONIZE: enough to wait on it
            "    def parent_gone(): return bool(_H) and ctypes.windll.kernel32.WaitForSingleObject(_H, 0) == 0\n"
            "else:\n"
            "    def parent_gone(): return os.getppid() != PARENT\n"
            "n = 0.0\n"
            "try:\n"
            "    while True:\n"
            "        time.sleep(EVERY)\n"
            "        if parent_gone():\n"
            "            break\n"
            "        n += EVERY\n"
            "        msg = f'  . ({LABEL}) still working... {n:.0f}s elapsed'\n"
            "        if EXPECT > 0: msg += f', about {EXPECT:.0f}s expected'\n"
            "        sys.stdout.write(msg + '\\n')\n"
            "        sys.stdout.flush()\n"
            "except KeyboardInterrupt:\n"
            "    pass\n"
        )
        try:
            self._proc = subprocess.Popen(
                [sys.executable, "-u", "-c", code],
                stdout=None, stderr=None,  # inherit parent's
            )
        except Exception:
            self._proc = None  # heartbeat is best-effort; silence is acceptable
        return self
    def __exit__(self, *exc):
        if self._proc is not None:
            try:
                self._proc.terminate()
                self._proc.wait(timeout=1.0)
            except Exception:
                try: self._proc.kill()
                except Exception: pass

import numpy as np
import trimesh
from trimesh.visual.material import PBRMaterial

# OCP (OpenCascade Python bindings) - same as CadQuery uses
from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.STEPControl import STEPControl_Reader
from OCP.IFSelect import IFSelect_RetDone
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.BRep import BRep_Tool
from OCP.TopExp import TopExp_Explorer, TopExp
from OCP.TopAbs import TopAbs_FACE, TopAbs_EDGE, TopAbs_SHELL, TopAbs_SOLID, TopAbs_REVERSED
from OCP.TopLoc import TopLoc_Location
from OCP.TopoDS import TopoDS_Shape, TopoDS
from OCP.TDocStd import TDocStd_Document
from OCP.TCollection import TCollection_ExtendedString
from OCP.XCAFDoc import XCAFDoc_DocumentTool, XCAFDoc_ColorType, XCAFDoc_ColorTool
from OCP.TDF import TDF_LabelSequence, TDF_Label, TDF_Tool, TDF_AttributeSequence
from OCP.Quantity import Quantity_Color
from OCP.TDataStd import TDataStd_Name, TDataStd_NamedData
from OCP.TCollection import TCollection_AsciiString
from OCP.TDF import TDF_AttributeIterator
from OCP.BRepTools import BRepTools
from OCP.BRep import BRep_Builder
try:                                     # IGES comes with the same OpenCascade wheel
    from OCP.IGESCAFControl import IGESCAFControl_Reader
    from OCP.IGESControl import IGESControl_Reader
except ImportError:                      # pragma: no cover - only a stripped build
    IGESCAFControl_Reader = IGESControl_Reader = None


def log(msg: str, kind: str = "") -> None:
    icon = {"ok": "✓", "warn": "!", "err": "✗"}.get(kind, "·")
    print(f"  {icon} {msg}", flush=True)


class NothingToWrite(RuntimeError):
    """The STEP was read, but nothing in it ends up in a GLB. main() reports
    the message and exits with code 3; no GLB and no params file are written."""


class NoSolids(NothingToWrite):
    """A file that holds no solid to mesh (a STEP with only surfaces or wires;
    for IGES and BREP, where surfaces are meshed, nothing but curves)."""
    def __init__(self):
        if CFG.fmt == "step":
            super().__init__("no solid bodies found in this STEP")
        else:
            super().__init__(f"no solid or surface bodies found in this "
                             f"{_KIND_LABEL.get(CFG.fmt, CFG.fmt)} file")


class AllTooSmall(NothingToWrite):
    """--min-size was set so high that no part is left."""
    def __init__(self):
        super().__init__(f"--min-size {CFG.min_size_pct} removed every part: nothing left to write")


# ─── Input formats: the extension picks the OpenCascade reader.
STEP_EXTS = (".step", ".stp")
IGES_EXTS = (".iges", ".igs")
BREP_EXTS = (".brep", ".brp")
SUPPORTED_EXTS = STEP_EXTS + IGES_EXTS + BREP_EXTS
_KIND_LABEL = {"step": "STEP", "iges": "IGES", "brep": "BREP"}


class UnsupportedFormat(ValueError):
    """The extension is not one the converter reads."""


def input_kind(path) -> str:
    """'step', 'iges' or 'brep' by the file extension (case does not matter)."""
    ext = Path(path).suffix.lower()
    if ext in STEP_EXTS: return "step"
    if ext in IGES_EXTS: return "iges"
    if ext in BREP_EXTS: return "brep"
    raise UnsupportedFormat(
        f"cannot read '{ext or Path(path).name}' files: step2glb reads "
        + ", ".join(SUPPORTED_EXTS))


@dataclass
class Config:
    """All runtime knobs in one place. Replaces the prior globals()-poking pattern."""
    quality: float = 0.5         # linear deflection, mm (or a fraction of each edge's size if relative=True)
    relative: bool = False       # OCCT's relative deflection: each edge gets quality x its own size, a face the largest of its edges
    size_cap: float = 0.0        # a solid's linear deflection at most this share of its own diagonal (0 = off; see _refine_small_solids)
    angular: float = 0.5         # angular deflection, radians (~28.6 degrees default)
    min_size_pct: float = 0.0    # drop parts whose bbox-diag is < this % of model diag
    instance: bool = True        # collapse identical shapes into glTF refs
    pca_instances: bool = False  # apply PCA pose normalization for hash (rotation-invariant)
    with_props: bool = False     # compute volume + area (slow; needs separate BRepGProp pass)
    parallel: int = 0            # mesh-extraction worker count (0/1 = sequential)
    mesh_jobs: int = -1          # XCAF path: worker processes that mesh and extract the bodies (-1 = by the size of the model, 0/1 = in this process)
    colors: str = "auto"         # 'auto' | 'on' | 'off' — XCAF read mode
    meshopt: bool = False        # post-process via gltfpack for EXT_meshopt_compression
    quantize: bool = False       # KHR_mesh_quantization via gltfpack (-cc)
    # Mesh simplification ratio passed to gltfpack -si <r>. 0.0 disables; values in
    # (0, 1) keep that fraction of triangles (e.g. 0.5 = halve). gltfpack uses
    # meshoptimizer's quadric-error simplifier with feature-edge preservation, so
    # holes/chamfers/fillets stay sharp. Implies meshopt=True since gltfpack runs
    # anyway. Lossy — the original GLB is replaced.
    simplify: float = 0.0
    force: bool = False          # ignore cached output even if newer than source
    xcaf_cache: bool = True      # keep the parsed document beside the STEP for the next run (off for the server's uploads)
    # XCAF read-mode toggles. `Transfer(doc)` time scales with how many of these
    # are enabled — SHUO in particular is expensive on instanced assemblies
    # because per-instance attribute overrides are resolved combinatorially.
    # Defaults match the historical behavior (everything ON) so plain CLI runs
    # don't change shape; the import-settings UI flips these off opportunistically.
    read_shuo: bool = True
    read_layers: bool = True
    read_materials: bool = True
    split_colours: bool = False  # a body painted in several colours as a piece a colour (open along the seams), not one body
    read_names: bool = True
    read_props: bool = True      # validation properties pass (NOT --props volume/area)
    extras: bool = True          # CAD metadata into the glTF node extras (--no-extras turns it off)
    lod: tuple = ()              # triangle percentages, e.g. (100, 50, 25); () = one output
    lod_error: float = 0.01      # simplifier error limit (fraction of a mesh's size), Node engine
    fmt: str = "step"            # 'step' | 'iges' | 'brep': set per file by convert()
    # Tessellation by part size (--tiers): None, or a dict with "split" (two
    # limits, in % of the size of the whole model: under the first a part is
    # small, from the second on it is large) and "small" / "medium" / "large",
    # each (linear deflection, angular deflection in radians).
    tiers: dict | None = None
    min_edge: float = 0.0        # smallest triangle edge the mesher may make (0 = no limit)
    grid: bool = False           # curved faces meshed along their own directions, in even strips (gridmesh.py)
    normals: bool = True         # write the CAD surface normals (smooth shading across face seams)
    surfaces: bool = True        # keep the parts of a STEP that are surfaces only (open shells, no solid)
    swap_yz: bool = False        # turn the model a quarter about X (a Z-up file for a Y-up scene, or back)
    brep: bool = False           # write the B-rep beside the GLB (<name>.glb.brep.json / .bin): CAD faces and true edges


# Module-level Config — set once by main() and read elsewhere. Cleaner than
# poking into globals() but keeps the function-call overhead low.
CFG = Config()

# What the last convert() did, for --batch and --summary-json: format, part and
# triangle counts, the LOD files. Cleared at the start of every conversion.
RESULT: dict = {}


def parse_step_xcaf_cached(path: Path):
    """Like parse_step_xcaf, but persists the parsed OCAF doc to a binary
    cache next to the STEP file. On subsequent runs the cache loads in
    seconds (typically 30-100x faster than re-parsing the STEP text).

    Cache file: <stem>.xcaf-cache.xbf in the same directory as the STEP.
    Invalidation:
      - STEP file mtime newer than cache mtime → stale, re-parse.
      - CFG.force is set → user explicitly asked for a clean re-run.
      - Cache load raises → likely OCCT version drift; transparently re-parse
        and overwrite the cache with a current-version copy.
    """
    cache_path = path.with_suffix(".xcaf-cache.xbf")
    if not CFG.xcaf_cache:
        return parse_step_xcaf(path)
    # The cache names the file it was made from (name, size, time to the nanosecond) in <cache>.src, and is used only for that file.
    # By date alone a newer revision with an older date (as a zip gives it) was read as the old one, and part.step and part.stp shared it.
    _st = path.stat()
    stamp = {"name": path.name, "size": _st.st_size, "mtime_ns": _st.st_mtime_ns}
    stamp_path = cache_path.with_name(cache_path.name + ".src")
    def _stamp_ok() -> bool:
        try: return json.loads(stamp_path.read_text(encoding="utf-8")) == stamp
        except Exception: return False
    # Cached docs are always written with the full XCAF read set (names, layers,
    # materials, props, SHUO). If the user disabled any of those for this run,
    # a cache hit would silently give them attributes they asked us to skip —
    # so bypass the cache entirely (read AND write) when any mode is off.
    full_read = (CFG.read_shuo and CFG.read_layers and CFG.read_materials
                 and CFG.read_names and CFG.read_props)

    # Cache hit?
    if (full_read and not CFG.force
        and cache_path.exists()
        and cache_path.stat().st_mtime > path.stat().st_mtime and _stamp_ok()):
        cache_mb = cache_path.stat().st_size / 1048576
        log(f"loading cached XCAF doc: {cache_path.name} ({cache_mb:.1f} MB)")
        try:
            t0 = time.time()
            with Heartbeat("XCAF cache load"):
                result = _load_xcaf_cache(cache_path)
            # A cache written before the product metadata was kept holds none;
            # parse again so the part numbers are not silently missing.
            if CFG.extras and not _doc_has_product_meta(result[0], result[1]):
                raise RuntimeError("cache has no product metadata")
            log(f"  → loaded in {time.time()-t0:.2f}s "
                f"({result[3].Length()} top-level shapes, STEP parse skipped)", "ok")
            return result
        except Exception as e:
            log(f"cache load failed ({e!r}), re-parsing STEP from scratch", "warn")

    # Fresh parse — slow path
    doc, shape_tool, color_tool, free_labels = parse_step_xcaf(path)

    # Skip cache write if the doc isn't a full-read result — see note above.
    if not full_read:
        log("XCAF cache write skipped (partial read mode)")
        return doc, shape_tool, color_tool, free_labels

    # Best-effort cache write. Failure here doesn't break the conversion;
    # the user just doesn't get the speedup on next run.
    try:
        log(f"writing XCAF binary cache: {cache_path.name}")
        t0 = time.time()
        with Heartbeat("XCAF cache write"):
            _save_xcaf_cache(doc, cache_path)
        out_mb = cache_path.stat().st_size / 1048576
        stamp_path.write_text(json.dumps(stamp), encoding="utf-8")
        log(f"  → cached in {time.time()-t0:.2f}s ({out_mb:.1f} MB) — re-runs will skip the STEP parse", "ok")
    except Exception as e:
        log(f"cache write failed ({e!r}); next run will re-parse from scratch", "warn")

    return doc, shape_tool, color_tool, free_labels


def _xcaf_app():
    """Return the XCAFApp_Application singleton with BinXCAF drivers registered.

    XCAFApp_Application (vs TDocStd_Application) is the right base for XCAF
    docs — it knows about XCAF-specific tools and binds documents correctly.
    The previous TDocStd_Application path raised
    'this document of format BinXCAF has not yet been opened by any
    application' on SaveAs because the doc wasn't actually owned by the app.
    """
    from OCP.XCAFApp import XCAFApp_Application
    from OCP.BinXCAFDrivers import BinXCAFDrivers
    app = XCAFApp_Application.GetApplication_s()
    BinXCAFDrivers.DefineFormat_s(app)
    return app


def _save_xcaf_cache(doc, path: Path) -> None:
    """Serialize an OCAF doc to OCCT's BinXCAF binary format."""
    app = _xcaf_app()
    doc.ChangeStorageFormat(TCollection_ExtendedString("BinXCAF"))
    # InitDocument registers an existing standalone doc with the application
    # so it's "opened" — required before SaveAs. Idempotent if already done.
    try:
        app.InitDocument(doc)
    except Exception:
        # Some OCP versions auto-init or expose this differently; if it's
        # not available the SaveAs will tell us with a clearer error.
        pass
    t0 = time.time()
    status = app.SaveAs(doc, TCollection_ExtendedString(str(path)))
    # PCDM_StoreStatus enum: 0 == PCDM_SS_OK; non-zero is some failure mode.
    if int(status) != 0:
        raise RuntimeError(f"OCAF SaveAs returned status={status}")
    # SaveAs has said OK and written "Document_" beside the STEP instead (after an Open in the same run): the cache was then
    # never renewed. A write that did not reach the file is an error.
    if not path.exists() or path.stat().st_mtime < t0 - 2:
        raise RuntimeError("OCAF SaveAs reported success but did not write the cache file")


def _load_xcaf_cache(path: Path):
    """Read an OCCT binary OCAF/XCAF file, returning the same 4-tuple as
    parse_step_xcaf so callers don't need to special-case the cached path."""
    app = _xcaf_app()
    doc = TDocStd_Document(TCollection_ExtendedString("BinXCAF"))
    # app.Open() fills a document of its own and hands it back through a C++ out-parameter, which OCP drops: the document
    # passed in stayed empty, every cache load failed ("no shapes") and the STEP was parsed again each time. The retrieval
    # driver reads into the document given to it.
    try:
        from OCP.BinXCAFDrivers import BinXCAFDrivers_DocumentRetrievalDriver
        drv = BinXCAFDrivers_DocumentRetrievalDriver()
        drv.Read(TCollection_ExtendedString(str(path)), doc, app)
        status = drv.GetStatus()
    except ImportError:
        status = app.Open(TCollection_ExtendedString(str(path)), doc)
    if int(status) != 0:
        raise RuntimeError(f"OCAF read returned status={status}")
    shape_tool = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
    color_tool = XCAFDoc_DocumentTool.ColorTool_s(doc.Main())
    free_labels = TDF_LabelSequence()
    shape_tool.GetFreeShapes(free_labels)
    # A cache that opens but holds no shapes is no cache: the caller parses the
    # STEP again (returning it empty gave a model without colours or names).
    if free_labels.Length() == 0:
        raise RuntimeError("cache loaded with no shapes")
    return doc, shape_tool, color_tool, free_labels


def _expected_transfer_s(size_mb: float) -> float:
    """A guess at the XCAF transfer (the long step) from the file size, for the progress line; OCCT reports no progress for it.
    Measured once, on a 167 MB car: 48 s, so 0.29 s per MB. Other files and computers differ, so it is only ever shown as "about".
    Small files are quick enough not to need one."""
    return float(round(size_mb * 0.29)) if size_mb >= 30 else 0.0


def parse_step_xcaf(path: Path):
    """Read STEP via XCAF — gets shapes + colors + names. Returns (doc, shape_tool, color_tool, free_labels)."""
    size_mb = path.stat().st_size / 1048576
    log(f"reading STEP via XCAF: {path.name} ({size_mb:.1f} MB)")
    if size_mb > 100: log(f"large file — expect 60-180s with no progress output during ReadFile", "warn")
    t0 = time.time()
    # Create the doc THROUGH the XCAF application from the start. The previous
    # standalone TDocStd_Document(name) construction left the doc unowned by
    # any application, which then caused 'this document of format BinXCAF has
    # not yet been opened by any application' on SaveAs. Trying to retrofit
    # ownership via InitDocument / doc.Open(app) didn't reliably work either.
    # The clean fix is to let the app create the doc — that binds them
    # properly for the lifetime of the doc.
    app = _xcaf_app()
    doc = TDocStd_Document(TCollection_ExtendedString("BinXCAF"))
    try:
        # NewDocument(format, OUT doc) — replaces the empty doc with one the
        # app owns. In OCP this is an out-param via the Handle's mutation.
        app.NewDocument(TCollection_ExtendedString("BinXCAF"), doc)
    except Exception as e:
        # Older / variant OCP signatures may not accept this call shape.
        # Fall back and warn — the conversion still works, just no cache write.
        log(f"app.NewDocument failed ({e!r}); cache write may not work", "warn")
    reader = STEPCAFControl_Reader()
    # Different OCP / OpenCascade builds expose different setters — try each.
    # ColorMode stays ON (we're inside the XCAF path because the caller wants
    # colors); the rest are CFG-driven so the UI can trade them off for speed.
    for setter, val in (("SetColorMode",    True),
                        ("SetNameMode",     CFG.read_names),
                        ("SetLayerMode",    CFG.read_layers),
                        # (the reader's is SetMatMode; SetMaterialMode is the writer's, and asking the reader for it found
                        # nothing, so "Materials" off was never passed on. Both are tried, for builds that name it otherwise.)
                        ("SetMatMode",      CFG.read_materials),
                        ("SetMaterialMode", CFG.read_materials),
                        ("SetPropsMode",    CFG.read_props),
                        ("SetSHUOMode",     CFG.read_shuo),
                        # Part number, name and description of every product go
                        # into the document as TDataStd_NamedData (read below).
                        ("SetProductMetaMode", CFG.extras)):
        try:
            fn = getattr(reader, setter, None)
            if fn is not None: fn(val)
        except Exception:
            pass
    _disabled = [k for k, v in (("names", CFG.read_names), ("layers", CFG.read_layers),
                                 ("materials", CFG.read_materials), ("props", CFG.read_props),
                                 ("shuo", CFG.read_shuo)) if not v]
    if _disabled:
        log(f"XCAF read modes disabled: {', '.join(_disabled)}")
    with Heartbeat("XCAF parsing"):
        status = reader.ReadFile(str(path))
    if status != IFSelect_RetDone:
        raise RuntimeError(f"STEP read failed (status={status})")
    log("transferring document to XCAF tree...")
    with Heartbeat("XCAF transfer", expect_s=_expected_transfer_s(size_mb)):
        ok = reader.Transfer(doc)
    if not ok:
        raise RuntimeError("STEPCAF Transfer failed")
    shape_tool = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
    color_tool = XCAFDoc_DocumentTool.ColorTool_s(doc.Main())
    free_labels = TDF_LabelSequence()
    shape_tool.GetFreeShapes(free_labels)
    log(f"parsed in {time.time() - t0:.1f}s, top-level shapes: {free_labels.Length()}", "ok")
    return doc, shape_tool, color_tool, free_labels


def _new_xcaf_doc():
    """An empty XCAF document made through the application (see parse_step_xcaf)."""
    app = _xcaf_app()
    doc = TDocStd_Document(TCollection_ExtendedString("BinXCAF"))
    try:
        app.NewDocument(TCollection_ExtendedString("BinXCAF"), doc)
    except Exception as e:
        log(f"app.NewDocument failed ({e!r})", "warn")
    return doc


def parse_iges_xcaf(path: Path):
    """Read IGES via XCAF: names, colours and layers where the file has them.
    Same return as parse_step_xcaf. IGES keeps no assembly structure of its
    own (instances come out as separate geometry) and no part numbers."""
    if IGESCAFControl_Reader is None:
        raise RuntimeError("this OpenCascade build has no IGES reader")
    size_mb = path.stat().st_size / 1048576
    log(f"reading IGES via XCAF: {path.name} ({size_mb:.1f} MB)")
    t0 = time.time()
    doc = _new_xcaf_doc()
    reader = IGESCAFControl_Reader()
    for setter, val in (("SetColorMode", True), ("SetNameMode", CFG.read_names),
                        ("SetLayerMode", CFG.read_layers)):
        try: getattr(reader, setter)(val)
        except Exception: pass
    with Heartbeat("IGES parsing"):
        status = reader.ReadFile(str(path))
    if status != IFSelect_RetDone:
        raise RuntimeError(f"IGES read failed (status={status})")
    with Heartbeat("IGES transfer"):
        ok = reader.Transfer(doc)
    if not ok:
        raise RuntimeError("IGES Transfer failed")
    shape_tool = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
    color_tool = XCAFDoc_DocumentTool.ColorTool_s(doc.Main())
    free_labels = TDF_LabelSequence()
    shape_tool.GetFreeShapes(free_labels)
    log(f"parsed in {time.time() - t0:.1f}s, top-level shapes: {free_labels.Length()}", "ok")
    return doc, shape_tool, color_tool, free_labels


def parse_xcaf_cached(path: Path):
    """The XCAF document of a STEP (cached) or IGES file."""
    if CFG.fmt == "iges":
        return parse_iges_xcaf(path)
    return parse_step_xcaf_cached(path)


def _nd_string(nd, key: str) -> str | None:
    """One string out of a TDataStd_NamedData, or None."""
    try:
        k = TCollection_ExtendedString(key)
        if nd.HasString(k):
            v = nd.GetString(k).ToExtString()
            return v if v else None
    except Exception:
        pass
    return None


def _find_attr(label, cls):
    """The attribute of type `cls` on a label, or None. Walks the attributes instead of calling label.FindAttribute(), which can crash the process
    on some labels of big assemblies (see get_label_name)."""
    it = TDF_AttributeIterator(label)
    while it.More():
        a = it.Value()
        if isinstance(a, cls):
            return a
        it.Next()
    return None


def _doc_has_product_meta(doc, shape_tool) -> bool:
    """True when some shape label of the document carries a product ID."""
    try:
        labels = TDF_LabelSequence()
        shape_tool.GetShapes(labels)
        for i in range(1, labels.Length() + 1):
            nd = _find_attr(labels.Value(i), TDataStd_NamedData)
            if nd is not None and _nd_string(nd, "ProductID"):
                return True
    except Exception:
        pass
    return False


def read_product_meta(label: TDF_Label, doc) -> dict:
    """What the CAD file says about one product (a part or an assembly), read
    from the XCAF document:
      partNumber   STEP PRODUCT.id, kept by OCCT's product-metadata mode
      description  STEP PRODUCT.description (same place)
      layers       layer names assigned to the product (STEP, IGES)
      material     {name, description, density, densityUnit} of the material tool
      volume, area the file's validation properties, in model units
    Only what is actually there is returned. Never raises."""
    meta: dict = {}
    if doc is None:
        return meta
    try:
        nd = _find_attr(label, TDataStd_NamedData)
        if nd is not None:
            pid = _nd_string(nd, "ProductID")
            if pid: meta["partNumber"] = pid
            desc = _nd_string(nd, "Description")
            if desc: meta["description"] = desc
    except Exception:
        pass
    try:
        from OCP.XCAFDoc import XCAFDoc, XCAFDoc_Material
        lt = XCAFDoc_DocumentTool.LayerTool_s(doc.Main())
        ls = TDF_LabelSequence()
        if lt.GetLayers(label, ls) and ls.Length():
            names = [get_label_name(ls.Value(k)) for k in range(1, ls.Length() + 1)]
            names = [n for n in names if n]
            if names: meta["layers"] = names
        mat_guid = XCAFDoc.MaterialRefGUID_s()
        it = TDF_AttributeIterator(label)
        while it.More():
            a = it.Value()
            tname = a.DynamicType().Name()
            if tname == "TDataStd_TreeNode" and a.ID().IsSame(mat_guid) and a.HasFather():
                ma = _find_attr(a.Father().Label(), XCAFDoc_Material)
                if ma is not None:
                    m = {}
                    nm = ma.GetName().ToCString() if ma.GetName() is not None else ""
                    if nm: m["name"] = nm
                    ds = ma.GetDescription().ToCString() if ma.GetDescription() is not None else ""
                    if ds: m["description"] = ds
                    if ma.GetDensity() > 0:
                        m["density"] = round(float(ma.GetDensity()), 6)
                        un = ma.GetDensName().ToCString() if ma.GetDensName() is not None else ""
                        if un and un != "density": m["densityUnit"] = un
                    if m: meta["material"] = m
            elif tname == "XCAFDoc_Volume":
                meta["volume"] = round(float(a.Get()), 4)
            elif tname == "XCAFDoc_Area":
                meta["area"] = round(float(a.Get()), 4)
            it.Next()
    except Exception:
        pass
    return meta


def _hex(c) -> str:
    return "#{:02x}{:02x}{:02x}".format(*(max(0, min(255, int(round(v * 255)))) for v in c))


def _surface_bodies(shape, color_tool, default_color):
    """The bodies of a shape that has no solid (IGES and BREP surface models):
    its faces, one body per face colour, so a coloured surface model keeps its
    colours. Returns (shapes, colours), parallel lists."""
    from OCP.TopoDS import TopoDS_Compound
    groups: dict = {}
    exp = TopExp_Explorer(shape, TopAbs_FACE)
    while exp.More():
        f = exp.Current()
        c = get_shape_color(f, color_tool) or default_color
        key = None if c is None else tuple(round(v, 4) for v in c)
        groups.setdefault(key, (c, []))[1].append(f)
        exp.Next()
    shapes, colours = [], []
    for c, faces in groups.values():
        comp = TopoDS_Compound()
        builder = BRep_Builder()
        builder.MakeCompound(comp)
        for f in faces:
            builder.Add(comp, f)
        shapes.append(comp)
        colours.append(c)
    return shapes, colours


def _loose_shells(shape, color_tool, default_color, shape_tool=None):
    """The shells of a shape that sit outside every solid (the open surface bodies a STEP can carry beside its
    solids), one body each; with `shape_tool` (the product has faces coloured in the document) a shell whose faces carry
    more than one colour keeps them, as a solid does: one body, a colour a run of its faces (_face_colour_groups).
    Returns (shapes, colours, face colours), parallel lists."""
    shapes, colours, fcs = [], [], []
    exp = TopExp_Explorer(shape, TopAbs_SHELL, TopAbs_SOLID)
    while exp.More():
        sh = exp.Current()
        col = get_shape_color(sh, color_tool) or default_color
        # (a surface body painted face by face, as the cab of the Scania 8x4 is: it came out in one colour, where Cinema 4D
        # shows its red panels and black trim)
        fc = _face_colour_groups(sh, shape_tool, color_tool, col) if shape_tool is not None else None
        if fc and CFG.split_colours:
            for piece, pk in _colour_pieces(fc):
                shapes.append(piece); colours.append(pk); fcs.append(None)
            RESULT["bodies_split_by_face_colour"] = RESULT.get("bodies_split_by_face_colour", 0) + 1
            exp.Next(); continue
        shapes.append(sh); fcs.append(fc)
        if fc:
            colours.append(fc[1][0])
            RESULT["bodies_with_face_colours"] = RESULT.get("bodies_with_face_colours", 0) + 1
        else:
            colours.append(col)
        exp.Next()
    # Faces in no shell at all (a surface model: trimmed or curve-bounded surfaces, as gear.stp of the AP203 samples has 32 of):
    # they were dropped, and such a STEP came out as "no solid bodies". One body a colour, as an IGES surface model gets.
    from OCP.TopoDS import TopoDS_Compound
    loose = TopoDS_Compound(); b = BRep_Builder(); b.MakeCompound(loose)
    n = 0
    exp = TopExp_Explorer(shape, TopAbs_FACE, TopAbs_SHELL)
    while exp.More():
        b.Add(loose, exp.Current()); n += 1
        exp.Next()
    if n:
        fs, fc = _surface_bodies(loose, color_tool, default_color)
        shapes += fs; colours += fc; fcs += [None] * len(fs)
    return shapes, colours, fcs


def get_label_color(label: TDF_Label, color_tool) -> tuple[float, float, float] | None:
    """Get the RGB color of a shape label, trying surface/generic/curve types in order.

    The label form of GetColor is static in OCP (GetColor_s); the bound method takes only a shape, so calling it with a label
    raised a TypeError that was swallowed here, and no colour on a label was ever read (only colours on shapes and through
    VisMaterials came through)."""
    c = Quantity_Color()
    get = getattr(XCAFDoc_ColorTool, "GetColor_s", None)
    for t in (XCAFDoc_ColorType.XCAFDoc_ColorSurf,
              XCAFDoc_ColorType.XCAFDoc_ColorGen,
              XCAFDoc_ColorType.XCAFDoc_ColorCurv):
        try:
            if (get(label, t, c) if get else color_tool.GetColor(label, t, c)):
                return (c.Red(), c.Green(), c.Blue())
        except Exception:
            pass
    return None


def _get_visual_material_color(label, doc) -> tuple[float, float, float] | None:
    """Some STEP exports attach color via XCAFDoc_VisMaterial (PBR-style)
    instead of XCAFDoc_Color. NX in particular tends to use this path.
    OCCT 7.5+ exposes a VisMaterialTool that walks the doc's material table.
    Returns the baseColor of the assigned material if any."""
    try:
        from OCP.XCAFDoc import XCAFDoc_VisMaterialTool
        mat_tool = XCAFDoc_VisMaterialTool.GetVisMaterialTool_s(doc.Main())
        if mat_tool is None:
            return None
        # GetShapeMaterial returns the VisMaterial assigned to this shape/label.
        # API shape varies across OCP builds — wrap defensively.
        try:
            mat = mat_tool.GetShapeMaterial_s(label)
        except Exception:
            mat = None
        if mat is None:
            return None
        # Prefer the PBR base color, fall back to the common (Phong) diffuse.
        try:
            pbr = mat.PbrMaterial()
            if pbr is not None and getattr(pbr, "IsDefined", lambda: False)():
                rgba = pbr.BaseColor
                # OCP exposes BaseColor as either a method or attr depending on build
                if callable(rgba): rgba = rgba()
                return (rgba.GetRGB().Red(), rgba.GetRGB().Green(), rgba.GetRGB().Blue())
        except Exception:
            pass
        try:
            common = mat.CommonMaterial()
            if common is not None and getattr(common, "IsDefined", lambda: False)():
                c = common.DiffuseColor
                if callable(c): c = c()
                return (c.Red(), c.Green(), c.Blue())
        except Exception:
            pass
    except Exception:
        pass
    return None


def get_shape_color(shape, color_tool) -> tuple[float, float, float] | None:
    """Look up a color via the actual TopoDS_Shape (not its label).

    Some STEP exporters (notably Siemens NX, also some CATIA paths) attach
    colors directly to sub-shapes — e.g., the per-solid TopoDS_Solid — rather
    than tagging the label that owns them. color_tool.GetColor accepts a
    Shape overload that walks XCAF's shape→color attachment table, which
    catches these cases.
    """
    if shape is None:
        return None
    c = Quantity_Color()
    for t in (XCAFDoc_ColorType.XCAFDoc_ColorSurf,
              XCAFDoc_ColorType.XCAFDoc_ColorGen,
              XCAFDoc_ColorType.XCAFDoc_ColorCurv):
        try:
            if color_tool.GetColor(shape, t, c):
                return (c.Red(), c.Green(), c.Blue())
        except Exception:
            pass
    return None


def _dominant_face_color(solid, shape_tool, color_tool):
    """The colour most of a solid's faces carry (by count), or None when none of them has one."""
    counts: dict = {}
    try:
        fx = TopExp_Explorer(solid, TopAbs_FACE)
        n = 0
        while fx.More() and n < 20000:
            face = fx.Current(); n += 1
            col = get_shape_color(face, color_tool)
            if col is None:
                try:
                    flbl = TDF_Label()
                    if shape_tool.FindShape_s(face, flbl): col = get_label_color(flbl, color_tool)
                except Exception:
                    col = None
            if col is not None:
                key = tuple(round(v, 4) for v in col)
                counts[key] = counts.get(key, 0) + 1
            fx.Next()
    except Exception:
        return None
    return max(counts.items(), key=lambda kv: kv[1])[0] if counts else None


def _face_colour_groups(solid, shape_tool, color_tool, body_color):
    """A solid whose faces carry more than one colour (a face painted apart from its body: SolidWorks, Creo), as its faces in
    colour order and the colour of each: (faces, keys); None when every face shows the same colour. A face with no colour of its
    own takes the body's. The solid stays one body: solid_to_mesh() meshes the faces in this order, so each colour is one run of
    triangles, and build_glb_hierarchical() writes the runs as primitives of one mesh. (Before, the body took one colour and faces
    in a second colour showed in the first; then each colour was a piece of its own, open along the seam.)"""
    groups: dict = {}
    order: list = []
    try:
        fx = TopExp_Explorer(solid, TopAbs_FACE)
        n = 0
        while fx.More():
            face = fx.Current(); n += 1
            if n > 50000:
                return None                   # (a body this big keeps one colour: the scan would cost more than it shows)
            col = get_shape_color(face, color_tool)
            if col is None:
                try:
                    flbl = TDF_Label()
                    if shape_tool.FindShape_s(face, flbl): col = get_label_color(flbl, color_tool)
                except Exception:
                    col = None
            key = tuple(round(v, 4) for v in (col or body_color)) if (col or body_color) else None
            if key not in groups:
                groups[key] = []; order.append(key)
            groups[key].append(face)
            fx.Next()
    except Exception:
        return None
    if len(groups) < 2:
        return None
    faces, keys = [], []
    for key in order:
        faces += groups[key]; keys += [key] * len(groups[key])
    return faces, keys


def _colour_pieces(fc) -> list:
    """--split-colours: the faces of _face_colour_groups() as a compound a colour, [(compound, colour), ...]. Each piece is open
    along the seam where its colour meets the next one."""
    from OCP.TopoDS import TopoDS_Compound
    faces, keys = fc
    out = []
    b = BRep_Builder()
    for f, k in zip(faces, keys):
        if not out or out[-1][1] != k:
            comp = TopoDS_Compound(); b.MakeCompound(comp); out.append((comp, k))
        b.Add(out[-1][0], f)
    return out


def get_label_name(label: TDF_Label) -> str | None:
    """Read the TDataStd_Name attribute from a label.

    The label's attributes are walked with an iterator and not looked up by id: label.FindAttribute() on a label without a name attribute can
    crash the whole process with an access violation (seen on coral.stp, an assembly label that holds only a shape, a tag source and a tree
    node), and a native crash cannot be caught here."""
    try:
        it = TDF_AttributeIterator(label)
        while it.More():
            a = it.Value()
            if isinstance(a, TDataStd_Name):
                return a.Get().ToExtString()
            it.Next()
    except Exception:
        pass
    return None


# ── Hierarchical XCAF walker ───────────────────────────────────────────────
# A flat list of solids (what the plain reader gives) drops two pieces of
# information that C4D and other proper STEP importers preserve:
#   1. The assembly hierarchy (NEXT_ASSEMBLY_USAGE_OCCURRENCE structure):
#      nested groups, with a "Null Object" container for each assembly node.
#   2. Explicit instancing — when an assembly references the same product
#      multiple times, that's the STEP file telling you "these are instances
#      of one part." A flat list holds each occurrence as a separate solid,
#      losing the reference-based instancing the file already encodes.
#
# walk_xcaf_tree below preserves both: products are cached by their TDF_Label
# entry (so the same product is extracted exactly once) and the instance tree
# carries each component's local transform from the parent's TopLoc_Location.
#
# Colour is per product (and per solid inside it). A colour given to one
# occurrence of a product only, or to an assembly as a whole, is not carried
# over: every occurrence shares the product's mesh and with it its material.

@dataclass
class XcafProduct:
    """A unique SimpleShape product (TDF_Label that is NOT an assembly).
    Solids are extracted ONCE in the product's local frame and reused by every
    occurrence in the instance tree."""
    name: str
    color: tuple | None         # default color for the product (if present)
    solids: list                # list[TopoDS_Shape]
    meshes: list                # filled by extract_product_meshes: list[(verts, tris)]
    solid_colors: list = None   # parallel to solids/meshes — per-solid color
                                # override. NX often colors at the solid level
                                # rather than the product level.
    face_colours: list = None   # parallel to solids: (faces, colour of each) for a solid with faces in several colours, else None
                                # (a coloured copy of the product has none: its occurrence shows in one colour)


@dataclass
class XcafNode:
    """A node in the instance hierarchy.

    Either a group (children populated, product_key is None) or a leaf
    (children empty, product_key points into the products dict). The
    transform is LOCAL — relative to the parent. World position is composed
    by glTF's standard parent-chain matrix multiplication.
    """
    name: str
    transform: np.ndarray  # 4x4
    children: list         # list[XcafNode]
    product_key: str | None
    extras: dict | None = None   # CAD metadata that goes into the glTF node's extras


def _label_entry(label: TDF_Label) -> str:
    """Stable per-document key for a TDF_Label (the OCAF entry like '0:1:1:2').
    Two components that GetReferredShape to the same label produce the same
    entry string — that's the signal we use to detect explicit instances."""
    try:
        s = TCollection_AsciiString()
        TDF_Tool.Entry_s(label, s)
        return s.ToCString()
    except Exception:
        return f"id_{id(label)}"


def _trsf_to_4x4(trsf) -> np.ndarray:
    """OCCT gp_Trsf is a 3x4 affine. Pad to a 4x4 row-major numpy matrix."""
    M = np.eye(4, dtype=np.float64)
    try:
        for r in range(3):
            for c in range(4):
                M[r, c] = trsf.Value(r + 1, c + 1)
    except Exception:
        pass
    return M


def walk_xcaf_tree(shape_tool, color_tool, free_labels, doc=None, surfaces=False, loose_shells=False):
    """Build (products, roots) from the XCAF document.

    products  — dict[label_entry → XcafProduct], one entry per unique product.
    roots     — list[XcafNode], top-level nodes in the instance hierarchy.

    Walking strategy:
      - For each free shape, visit recursively.
      - On an assembly label, walk its components. Each component is a
        reference (XCAFDoc_Component) carrying:
          (a) a TopLoc_Location — its placement in the parent
          (b) a referred TDF_Label — what product/sub-assembly it instances
        We capture (a) on the child node's transform field, then recurse
        into (b). If the referred is itself an assembly we recurse further;
        if it's a SimpleShape we cache it as a product.
      - On a SimpleShape label encountered directly (a free top-level part),
        cache it as a product and emit a leaf with identity transform.

    surfaces=True (IGES and BREP): a product with no solid is not dropped, its
    faces become the bodies (one per colour).
    With CFG.extras every node gets the metadata of the CAD file in .extras:
    its name in the CAD tree, the path of instance names from the root, the
    product it instances, part number, colour, layers, material, volume/area.
    """
    from OCP.XCAFDoc import XCAFDoc_ShapeTool

    products: dict[str, XcafProduct] = {}

    def get_or_create_product(label: TDF_Label) -> str:
        key = _label_entry(label)
        if key in products:
            return key
        name = get_label_name(label) or "part"
        # Color lookup chain: try in order of how STEP exporters typically
        # attach colors. Different CAD systems write colors in different
        # places, and OCCT only auto-finds one at a time.
        color = (get_label_color(label, color_tool)        # 1. on the label
                 or _get_visual_material_color(label, doc))  # 2. via VisMaterial
        try:
            shape = shape_tool.GetShape_s(label)
        except Exception:
            products[key] = XcafProduct(name=name, color=color, solids=[], meshes=[],
                                         solid_colors=[])
            return key
        if color is None:
            color = get_shape_color(shape, color_tool)     # 3. on the shape
        # Walk the SOLIDS inside this product, capturing per-solid color too.
        # NX/CATIA frequently color at the solid level (not the product level)
        # — without this lookup we get all-grey on those files even though the
        # STEP carries colors. Cinema 4D (HOOPS-based) finds them; OCCT's
        # stock label-only lookup doesn't.
        solids = []
        solid_colors = []
        solid_faces = []
        # faces have colours of their own only where the product has sub-shapes in the document (no scan elsewhere)
        try:
            subs = TDF_LabelSequence()
            face_colours = bool(XCAFDoc_ShapeTool.GetSubShapes_s(label, subs)) and subs.Length() > 0
        except Exception:
            face_colours = False
        exp = TopExp_Explorer(shape, TopAbs_SOLID)
        while exp.More():
            solid = exp.Current()
            scol = None
            # First try: find the solid's own label and read its color.
            try:
                slbl = TDF_Label()
                if shape_tool.FindShape_s(solid, slbl):
                    scol = get_label_color(slbl, color_tool)
                    if scol is None:
                        scol = _get_visual_material_color(slbl, doc)
            except Exception:
                pass
            # Fallback: shape-direct color attachment.
            if scol is None:
                scol = get_shape_color(solid, color_tool)
            # Then the faces: a SolidWorks STEP often colours faces and neither the body nor the part, and the part came out grey.
            # The body takes the colour most of its faces carry (one colour a body: faces in a second colour show in the first).
            if scol is None and color is None:
                scol = _dominant_face_color(solid, shape_tool, color_tool)
            # Final fallback: inherit the product's color.
            fc = _face_colour_groups(solid, shape_tool, color_tool, scol or color) if face_colours else None
            if fc and CFG.split_colours:
                for piece, pk in _colour_pieces(fc):
                    solids.append(piece); solid_faces.append(None); solid_colors.append(pk)
                RESULT["bodies_split_by_face_colour"] = RESULT.get("bodies_split_by_face_colour", 0) + 1
                exp.Next(); continue
            solids.append(solid)
            solid_faces.append(fc)
            if fc:
                solid_colors.append(fc[1][0])
                RESULT["bodies_with_face_colours"] = RESULT.get("bodies_with_face_colours", 0) + 1
            else:
                solid_colors.append(scol or color)
            exp.Next()
        if not solids and surfaces:
            # An IGES or BREP surface model: no solid, so the faces are the body.
            solids, solid_colors = _surface_bodies(shape, color_tool, color)
        elif loose_shells:
            # A STEP with surface-only parts beside its solids: each open shell is a body of its own.
            sh, shc, shf = _loose_shells(shape, color_tool, color, shape_tool if face_colours else None)
            solid_faces += [None] * (len(solids) - len(solid_faces)) + shf
            solids += sh; solid_colors += shc
        products[key] = XcafProduct(name=name, color=color, solids=solids,
                                     meshes=[], solid_colors=solid_colors,
                                     face_colours=solid_faces + [None] * (len(solids) - len(solid_faces)))
        return key

    # An instance can carry a colour of its own: on its component label (every part under that instance takes it), or a SHUO
    # (specified higher usage occurrence: one occurrence, named by its whole path of components, coloured apart from the other
    # copies of the same part). Such an occurrence gets a copy of the product in that colour; the copy shares the solids, so
    # it is meshed once (extract_product_meshes) and only its material differs. Before, neither was read and every copy came
    # out in the product's colour, while the "Instance overrides (SHUO)" switch made reading slower for nothing.
    def coloured_variant(prod_key: str, col) -> str:
        prod = products[prod_key]
        if col is None or not prod.solids:
            return prod_key
        if prod.color == col and all(c in (None, col) for c in (prod.solid_colors or [])):
            return prod_key
        key = f"{prod_key}|{_hex(col)}"
        if key not in products:
            products[key] = XcafProduct(name=prod.name, color=col, solids=prod.solids, meshes=[],
                                         solid_colors=[col] * len(prod.solids))
        return key

    shuo_on: dict[str, bool] = {}

    def has_shuo(comp: TDF_Label) -> bool:
        key = _label_entry(comp)
        if key not in shuo_on:
            try:
                seq = TDF_AttributeSequence()
                shuo_on[key] = XCAFDoc_ShapeTool.GetAllComponentSHUO_s(comp, seq) and seq.Length() > 0
            except Exception:
                shuo_on[key] = False
        return shuo_on[key]

    def shuo_color(prod_label: TDF_Label, locs: list, comps: list):
        """The colour a SHUO gives this occurrence (locs, comps: the placements and labels of its components, from the top
        down). GetInstanceColor also answers for an occurrence with no SHUO (with the part's own colour), and FindSHUO matches
        paths that have none, so a SHUO counts only where a component on the path carries one and its colour differs from the
        part's: a SHUO that gives a part its own colour back inside a coloured sub-assembly is not seen (not met in a file yet)."""
        if not CFG.read_shuo or len(locs) < 2 or not any(has_shuo(c) for c in comps):
            return None
        try:
            whole = TopLoc_Location()
            for l in locs:
                whole = whole * l
            occ = shape_tool.GetShape_s(prod_label).Moved(whole)
            c = Quantity_Color()
            for t in (XCAFDoc_ColorType.XCAFDoc_ColorSurf, XCAFDoc_ColorType.XCAFDoc_ColorGen):
                if color_tool.GetInstanceColor(occ, t, c):
                    return (c.Red(), c.Green(), c.Blue())
        except Exception:
            pass
        return None

    shuo_hits = [0, 0]                                 # occurrences coloured by a SHUO, by their component

    meta_cache: dict[str, dict] = {}

    def product_meta(label: TDF_Label) -> dict:
        key = _label_entry(label)
        if key not in meta_cache:
            meta_cache[key] = read_product_meta(label, doc)
        return meta_cache[key]

    def node_extras(inst_name: str, parent_path: str, label: TDF_Label,
                    color, product_name: str | None) -> dict | None:
        """The extras of one node: label is the product (part or assembly) it
        instances, inst_name its own name in the tree."""
        if not CFG.extras:
            return None
        ex = {"name": inst_name,
              "path": f"{parent_path}/{inst_name}" if parent_path else inst_name}
        if product_name and product_name != inst_name:
            ex["product"] = product_name
        ex.update(product_meta(label))
        if color is not None:
            ex["color"] = _hex(color)
        return ex

    def visit(label: TDF_Label, location: TopLoc_Location,
              parent_path: str = "", name_override: str | None = None,
              locs: tuple = (), inherited=None, comps_path: tuple = ()):
        # Better default name by context: "Assembly" for nested assemblies,
        # "Part" for leaf products. Was "node" / "part" — too generic to be
        # useful when scanning a tree of 5000 nodes.
        is_asm = shape_tool.IsAssembly_s(label)
        own_name = get_label_name(label) or ("Assembly" if is_asm else "Part")
        name = name_override or own_name
        local_t = _trsf_to_4x4(location.Transformation()) if location is not None else np.eye(4)

        if is_asm:
            comps = TDF_LabelSequence()
            shape_tool.GetComponents_s(label, comps)
            kids = []
            path_here = f"{parent_path}/{name}" if parent_path else name
            for i in range(1, comps.Length() + 1):
                comp = comps.Value(i)
                # TDF_Label has no .Location() method directly. The location
                # of a component-instance label lives in its XCAFDoc_Location
                # attribute, which XCAFDoc_ShapeTool.GetLocation_s reads for us.
                # Returns identity if no location attribute is set.
                comp_loc = XCAFDoc_ShapeTool.GetLocation_s(comp)
                ref_label = TDF_Label()
                if not shape_tool.GetReferredShape_s(comp, ref_label):
                    continue
                # Per-occurrence name lives on the COMPONENT label, not the
                # referred product — preserves the "Bolt_M6 :3" style names
                # CAD systems write into the assembly tree. Better default
                # ("Component") so generic fallbacks at least communicate
                # role rather than just saying "part" everywhere.
                comp_name = (get_label_name(comp) or get_label_name(ref_label)
                             or ("Subassembly" if shape_tool.IsAssembly_s(ref_label) else "Component"))
                locs_here = locs + (comp_loc,)
                comps_here = comps_path + (comp,)
                inst_col = get_label_color(comp, color_tool) or inherited
                if shape_tool.IsAssembly_s(ref_label):
                    sub = visit(ref_label, comp_loc, path_here, comp_name, locs_here, inst_col, comps_here)
                    if sub is not None:
                        kids.append(sub)
                else:
                    prod_key = get_or_create_product(ref_label)
                    own = shuo_color(ref_label, list(locs_here), list(comps_here))
                    base = products[prod_key]
                    if own is not None and own == (base.color or next((c for c in (base.solid_colors or []) if c), None)):
                        own = None
                    if own is not None:
                        shuo_hits[0] += 1
                    elif inst_col is not None:
                        shuo_hits[1] += 1
                    prod_key = coloured_variant(prod_key, own if own is not None else inst_col)
                    prod = products[prod_key]
                    col = prod.color or next((c for c in (prod.solid_colors or []) if c), None)
                    kids.append(XcafNode(
                        name=comp_name,
                        transform=_trsf_to_4x4(comp_loc.Transformation()),
                        children=[],
                        product_key=prod_key,
                        extras=node_extras(comp_name, path_here, ref_label, col, prod.name),
                    ))
            return XcafNode(name=name, transform=local_t,
                            children=kids, product_key=None,
                            extras=node_extras(name, parent_path, label,
                                               get_label_color(label, color_tool), own_name))
        else:
            prod_key = get_or_create_product(label)
            prod = products[prod_key]
            col = prod.color or next((c for c in (prod.solid_colors or []) if c), None)
            return XcafNode(name=name, transform=local_t,
                            children=[], product_key=prod_key,
                            extras=node_extras(name, parent_path, label, col, own_name))

    roots: list[XcafNode] = []
    identity = TopLoc_Location()
    for i in range(1, free_labels.Length() + 1):
        n = visit(free_labels.Value(i), identity)
        if n is not None:
            roots.append(n)
    if RESULT.get("bodies_split_by_face_colour"):
        log(f"{RESULT['bodies_split_by_face_colour']:,} bodies have faces in more than one colour: each colour is a piece of its own", "ok")
    if RESULT.get("bodies_with_face_colours"):
        log(f"{RESULT['bodies_with_face_colours']:,} bodies have faces in more than one colour: each stays one body, with a material a colour", "ok")
    if shuo_hits[0] or shuo_hits[1]:
        log(f"instance colours: {shuo_hits[0]} occurrence(s) from SHUO, {shuo_hits[1]} from their component", "ok")
    return products, roots


def extract_product_meshes(products: dict) -> None:
    """Tessellate-already-done; just walk solids and build (verts, tris) arrays.
    Runs ONCE per unique product — the whole point of this rewrite vs. the
    flat extractor that ran once per occurrence."""
    log("extracting per-product meshes (one pass per unique product)")
    t0 = time.time()
    n = len(products)
    if n == 0:
        log("no products to extract", "warn")
        return
    log_every = max(50, n // 20)
    done = 0
    total_meshes = 0
    skipped = 0
    seen: dict[int, object] = {}                      # (a coloured copy of a product shares its solids)
    with Heartbeat("product mesh extraction"):
        for prod in products.values():
            meshes = []
            for si, solid in enumerate(prod.solids):
                fc = prod.face_colours[si] if prod.face_colours and si < len(prod.face_colours) else None
                if id(solid) in seen:
                    r = seen[id(solid)]
                else:
                    # (a solid with faces in several colours is meshed face by face in colour order; its product comes before any
                    # coloured copy of it, which shares the mesh and ignores the runs)
                    r =seen[id(solid)] = solid_to_mesh(solid, fc)
                if r is None:
                    skipped += 1
                    continue
                meshes.append(r)
            prod.meshes = meshes
            total_meshes += len(meshes)
            done += 1
            if done % log_every == 0:
                log(f"extracted {done}/{n} products")
    log(f"extracted {total_meshes} solid meshes across {n} unique products"
        + (f" ({skipped} empty solids skipped)" if skipped else "")
        + f" in {time.time()-t0:.1f}s", "ok")


def build_glb_hierarchical(roots: list, products: dict, output: Path,
                           scene_meta: dict, instance: bool = True) -> None:
    """Walk the instance tree, emit a hierarchical glTF scene with sharing.

    Each XcafNode becomes a glTF node frame. Empty assembly nodes (no
    product_key) become group/null nodes — that's what C4D shows as
    "Null Object [Next assembly relationship]". Leaf nodes attach the
    product's cached meshes by name; multiple leaves referencing the same
    product share the same mesh, so glTF instancing fires for free.

    GLTFLoader on the web side then materializes N THREE.Mesh objects
    sharing one BufferGeometry, and the viewer's _autoInstanceFromGLB
    collapses them into a single InstancedMesh draw call.
    """
    log("building GLB scene (hierarchical, with reference instancing)")
    t0 = time.time()
    scene = trimesh.Scene()

    # ─── Pre-build all unique geometries once. trimesh.Scene.geometry is a
    # dict of {name → Trimesh} that the exporter de-dupes on; multiple graph
    # frames pointing at the same name produce one glTF mesh + N nodes.
    geom_names: dict[tuple[str, int], str] = {}
    brep_out: dict = {}        # geometry name -> B-rep record (--brep), for the sidecar
    multi_out: dict = {}       # geometry name -> colour runs: written as one primitive a colour after the export
    n_geoms = 0
    n_colored = 0
    for key, prod in products.items():
        sc = prod.solid_colors or []
        for i, (verts, tris) in enumerate(prod.meshes):
            if len(verts) == 0 or len(tris) == 0:
                continue
            mesh = _trimesh(verts, tris)
            # Per-solid color (NX/CATIA pattern) takes precedence over the
            # product-level fallback. _apply_color handles None → neutral grey.
            mcolor = sc[i] if i < len(sc) else prod.color
            _apply_color(mesh, mcolor)
            runs = _groups_of(verts, len(tris)) if (prod.face_colours and i < len(prod.face_colours) and prod.face_colours[i]) else None
            if mcolor is not None:
                n_colored += 1
            # Sanitize the entry string ('0:1:1:2' has colons that trimesh's
            # graph naming sometimes mangles when it derives node names).
            short_key = key.replace(":", "_")
            gname = f"prod_{short_key}_{i:03d}"
            scene.geometry[gname] = mesh
            geom_names[(key, i)] = gname
            if runs: multi_out[gname] = runs
            n_geoms += 1
            hit = _BREP.get(id(verts)) if CFG.brep else None
            if hit is not None and hit[0] is verts:
                brep_out[gname] = hit[1]
    log(f"applied colors to {n_colored}/{n_geoms} mesh geometries", "ok" if n_colored else "warn")

    # Nothing to put in a GLB (surfaces or wires only). The caller decides
    # what happens next; no file is written here.
    if n_geoms == 0:
        raise NoSolids()

    # ─── Walk the tree. Track frame uniqueness with a counter so duplicate
    # node names (very common in CAD: "Bolt", "Bolt", "Bolt") don't collide
    # in the graph. The original name is preserved in metadata for the viewer.
    n_nodes = [0]
    n_geom_refs = [0]
    n_parts = [0]
    n_product_uses: dict[str, int] = defaultdict(int)
    node_extras: dict[str, dict] = {}     # frame name -> CAD metadata for the node's extras

    def safe_frame(parent: str, name: str) -> str:
        n_nodes[0] += 1
        # trimesh uses string frame names — colons / slashes confuse the
        # graph, replace with underscores; suffix with monotonic counter for
        # uniqueness across siblings.
        clean = (name or "node").replace("/", "_").replace(":", "_")
        return f"{clean}_{n_nodes[0]:06d}"

    def walk(node: XcafNode, parent_frame: str):
        frame = safe_frame(parent_frame, node.name)
        # trimesh stores arbitrary kwargs on the edge but doesn't forward them
        # to glTF node.extras during export — keep the call minimal. Hierarchy
        # itself is preserved via frame_from / frame_to + sanitized names.
        scene.graph.update(
            frame_to=frame,
            frame_from=parent_frame,
            matrix=node.transform,
        )
        if node.extras:
            node_extras[frame] = node.extras      # written into the GLB after the export
        if node.product_key is not None:
            prod = products[node.product_key]
            n_product_uses[node.product_key] += 1
            # Attach each of the product's solids as a child geom-frame. For
            # the common case of a single solid we keep the mesh directly on
            # this frame to avoid an extra empty layer in the tree.
            geom_keys = [(node.product_key, i) for i in range(len(prod.meshes))
                         if (node.product_key, i) in geom_names]
            if geom_keys:
                n_parts[0] += 1
            if len(geom_keys) == 1:
                gname = geom_names[geom_keys[0]]
                scene.graph.update(
                    frame_to=frame + "__geom",
                    frame_from=frame,
                    matrix=np.eye(4),
                    geometry=gname,
                )
                if gname in brep_out: node_extras[frame + "__geom"] = {"brep": gname}
                n_geom_refs[0] += 1
            else:
                for k in geom_keys:
                    _, idx = k
                    gname = geom_names[k]
                    scene.graph.update(
                        frame_to=f"{frame}__geom_{idx:03d}",
                        frame_from=frame,
                        matrix=np.eye(4),
                        geometry=gname,
                    )
                    if gname in brep_out: node_extras[f"{frame}__geom_{idx:03d}"] = {"brep": gname}
                    n_geom_refs[0] += 1
        else:
            for child in node.children:
                walk(child, frame)

    world = "world"
    for r in roots:
        walk(r, world)

    instanced_products = sum(1 for c in n_product_uses.values() if c > 1)
    instanced_uses = sum(c for c in n_product_uses.values() if c > 1)
    log(f"{n_nodes[0]} graph nodes, {n_geom_refs[0]} geometry refs, "
        f"{len(products)} unique products")
    if instance and instanced_products:
        log(f"  → {instanced_products} products are referenced multiple times "
            f"({instanced_uses} occurrences share geometry)", "ok")

    # Stash some scene-level metadata so the web side can render it
    if scene_meta is None:
        scene_meta = {}
    scene_meta = dict(scene_meta)  # copy so we don't mutate caller's dict
    scene_meta["hierarchical"] = True
    scene_meta["unique_products"] = len(products)
    scene_meta["instance_groups"] = instanced_products
    if CFG.extras:
        scene_meta["source_format"] = CFG.fmt
    try:
        scene.metadata.update(scene_meta)
    except Exception:
        pass

    log(f"scene assembled in {time.time() - t0:.1f}s", "ok")
    log(f"writing GLB: {output}")
    t0 = time.time()
    scene.export(output)
    if multi_out:
        n_done = _split_primitives(output, multi_out)
        log(f"{n_done} of {len(multi_out)} bodies with faces in several colours written as one mesh, a primitive a colour",
            "ok" if n_done == len(multi_out) else "warn")
    if node_extras:
        n_done = _inject_node_extras(output, node_extras)
        log(f"CAD metadata on {n_done} of {len(node_extras)} nodes", "ok" if n_done == len(node_extras) else "warn")
    if brep_out:
        write_brep_sidecar(brep_out, output)
    RESULT["parts"] = n_parts[0]
    RESULT["unique_products"] = len(products)
    out_mb = output.stat().st_size / 1048576
    log(f"wrote {out_mb:.2f} MB in {time.time() - t0:.1f}s", "ok")


def _swap_yz_glb(glb_path: Path) -> bool:
    """Turn the whole scene a quarter about X (Z-up to Y-up) by hanging its
    root nodes under one new node. Only the JSON chunk is rewritten."""
    data = glb_path.read_bytes()
    if data[:4] != b"glTF" or data[16:20] != b"JSON":
        return False
    jlen = int.from_bytes(data[12:16], "little")
    gltf = json.loads(data[20:20 + jlen].decode("utf-8"))
    scenes = gltf.get("scenes") or []
    if not scenes or not scenes[gltf.get("scene", 0)].get("nodes"):
        return False
    sc = scenes[gltf.get("scene", 0)]
    nodes = gltf.setdefault("nodes", [])
    h = 0.5 ** 0.5
    nodes.append({"name": "Y-up", "rotation": [-h, 0.0, 0.0, h], "children": list(sc["nodes"])})
    sc["nodes"] = [len(nodes) - 1]
    body = json.dumps(gltf, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    body += b" " * (-len(body) % 4)
    rest = data[20 + jlen:]
    total = 12 + 8 + len(body) + len(rest)
    out = (b"glTF" + data[4:8] + total.to_bytes(4, "little")
           + len(body).to_bytes(4, "little") + b"JSON" + body + rest)
    tmp = glb_path.with_name(glb_path.name + ".tmp")
    tmp.write_bytes(out)
    os.replace(tmp, glb_path)
    return True


def _split_primitives(glb_path: Path, runs_by_name: dict) -> int:
    """Give each mesh named in runs_by_name one primitive a colour: the primitives read the same POSITION and NORMAL accessors (so
    the points along a colour seam are shared, and the body is as closed as it is in one colour), each with its own run of the
    index accessor and a material of its colour. Only the JSON chunk is rewritten: the runs are views into the index data trimesh
    wrote, which is in triangle order. Returns how many meshes were split."""
    data = glb_path.read_bytes()
    if data[:4] != b"glTF" or data[16:20] != b"JSON":
        return 0
    jlen = int.from_bytes(data[12:16], "little")
    gltf = json.loads(data[20:20 + jlen].decode("utf-8"))
    accs = gltf.get("accessors", []); mats = gltf.setdefault("materials", [])
    sizes = {5121: 1, 5123: 2, 5125: 4}
    by_colour: dict = {}
    n = 0
    for mesh in gltf.get("meshes", []):
        runs = runs_by_name.get(mesh.get("name"))
        prims = mesh.get("primitives") or []
        if not runs or len(prims) != 1 or prims[0].get("indices") is None or prims[0].get("mode", 4) != 4:
            continue
        prim = prims[0]
        ia = accs[prim["indices"]]
        size = sizes.get(ia.get("componentType"))
        if size is None or ia.get("sparse") or ia.get("count") != 3 * sum(r[2] for r in runs):
            continue
        tmpl = mats[prim["material"]] if prim.get("material") is not None and prim["material"] < len(mats) else {}
        out = []
        for col, start, count in runs:
            acc = {k: v for k, v in ia.items() if k not in ("min", "max")}
            acc["byteOffset"] = ia.get("byteOffset", 0) + start * 3 * size
            acc["count"] = count * 3
            accs.append(acc)
            ck = tuple(round(float(c), 4) for c in col) if col is not None else None
            mi = by_colour.get(ck)
            if mi is None:
                m = json.loads(json.dumps(tmpl))
                pbr = m.setdefault("pbrMetallicRoughness", {})
                pbr["baseColorFactor"] = [float(c) for c in ck] + [1.0] if ck is not None else [0.7, 0.7, 0.72, 1.0]
                m["name"] = "colour_" + _hex(ck) if ck is not None else "colour_default"
                mats.append(m); mi = by_colour[ck] = len(mats) - 1
            p = {k: v for k, v in prim.items() if k not in ("indices", "material")}
            p["indices"] = len(accs) - 1; p["material"] = mi
            out.append(p)
        mesh["primitives"] = out
        n += 1
    if not n:
        return 0
    body = json.dumps(gltf, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    body += b" " * (-len(body) % 4)
    rest = data[20 + jlen:]
    total = 12 + 8 + len(body) + len(rest)
    out_b = (b"glTF" + data[4:8] + total.to_bytes(4, "little")
             + len(body).to_bytes(4, "little") + b"JSON" + body + rest)
    tmp = glb_path.with_name(glb_path.name + ".tmp")
    tmp.write_bytes(out_b)
    os.replace(tmp, glb_path)
    return n


def _inject_node_extras(glb_path: Path, extras_by_name: dict) -> int:
    """Put `extras` on the glTF nodes whose name is a key of extras_by_name
    (trimesh writes none of its own). Only the JSON chunk is rewritten; the
    binary chunk is copied as it is. Returns how many nodes got extras."""
    data = glb_path.read_bytes()
    if data[:4] != b"glTF" or data[16:20] != b"JSON":
        return 0
    jlen = int.from_bytes(data[12:16], "little")
    gltf = json.loads(data[20:20 + jlen].decode("utf-8"))
    n = 0
    for node in gltf.get("nodes", []):
        ex = extras_by_name.get(node.get("name"))
        if ex:
            node["extras"] = {**node.get("extras", {}), **ex}
            n += 1
    if not n:
        return 0
    body = json.dumps(gltf, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    body += b" " * (-len(body) % 4)
    rest = data[20 + jlen:]
    total = 12 + 8 + len(body) + len(rest)
    out = (b"glTF" + data[4:8] + total.to_bytes(4, "little")
           + len(body).to_bytes(4, "little") + b"JSON" + body + rest)
    tmp = glb_path.with_name(glb_path.name + ".tmp")
    tmp.write_bytes(out)
    os.replace(tmp, glb_path)
    return n


def collect_metadata(shape_tool, color_tool, doc, free_labels) -> dict:
    """Best-effort: pull layers, materials, units, etc. from the XCAF document.
    Returns a top-level metadata dict that's stored as scene.extras in the GLB."""
    meta = {}
    # Material tool — names + density + descriptions
    try:
        mat_tool = XCAFDoc_DocumentTool.MaterialTool_s(doc.Main())
        mat_labels = TDF_LabelSequence()
        mat_tool.GetMaterialLabels(mat_labels)
        materials = []
        for i in range(1, mat_labels.Length() + 1):
            ml = mat_labels.Value(i)
            n = get_label_name(ml) or f"material_{i}"
            try:
                # Density / description sometimes present via dedicated APIs
                from OCP.TCollection import TCollection_HAsciiString
                name_h = TCollection_HAsciiString(); desc_h = TCollection_HAsciiString()
                density = [0.0]; dens_name_h = TCollection_HAsciiString(); dens_unit_h = TCollection_HAsciiString()
                # OCP API varies — wrap in try blocks
                try:
                    mat_tool.GetMaterial(ml, name_h, desc_h, density, dens_name_h, dens_unit_h)
                    materials.append({"name": name_h.ToCString(), "density": density[0], "description": desc_h.ToCString()})
                except Exception:
                    materials.append({"name": n})
            except Exception:
                materials.append({"name": n})
        if materials: meta["materials"] = materials
    except Exception as e:
        log(f"materials read skipped: {e}", "warn")

    # Layer tool — list of layer names
    try:
        layer_tool = XCAFDoc_DocumentTool.LayerTool_s(doc.Main())
        layer_labels = TDF_LabelSequence()
        layer_tool.GetLayerLabels(layer_labels)
        layers = [get_label_name(layer_labels.Value(i)) or f"layer_{i}"
                  for i in range(1, layer_labels.Length() + 1)]
        if layers: meta["layers"] = layers
    except Exception:
        pass

    # Top-level product info: free shape names
    try:
        roots = []
        for i in range(1, free_labels.Length() + 1):
            n = get_label_name(free_labels.Value(i))
            if n: roots.append(n)
        if roots: meta["root_products"] = roots
    except Exception:
        pass

    return meta


# The mesher's own threads. Off in the worker processes of parallel_mesh_products(): there are as many of them as cores.
_MESH_IN_PARALLEL = True


def _mesh_shape(shape, linear: float, angular: float, relative: bool) -> None:
    """One run of the mesher. (The constructor does the work: calling
    Perform() after it, as this used to, walked every face a second time.)
    With CFG.grid the curved faces that are whole four-sided patches (fillets, blends) are then meshed again in even
    strips along their own directions (gridmesh.py), keeping the points the mesher put on their outlines."""
    from OCP.IMeshTools import IMeshTools_Parameters
    prm = IMeshTools_Parameters()
    prm.Deflection = float(linear)
    prm.Angle = float(angular)
    prm.Relative = bool(relative)
    prm.InParallel = _MESH_IN_PARALLEL
    if CFG.min_edge > 0:
        prm.MinSize = float(CFG.min_edge)
    t_mesh = time.time()
    m = BRepMesh_IncrementalMesh(shape, prm)
    RESULT["time_mesher"] = RESULT.get("time_mesher", 0.0) + time.time() - t_mesh
    # BRepMesh_Status: 1 an open wire, 2 a wire that crosses itself, 4 a face it could not mesh, 8 a face meshed again. It was
    # never read: a face the mesher gave up on simply had no triangles. The flags of every run are kept and told at the end.
    try:
        st = int(m.GetStatusFlags())
    except Exception:
        st = 0
    if st:
        RESULT["mesher_status"] = RESULT.get("mesher_status", 0) | st
    if CFG.grid:
        import gridmesh
        # points along long straight edges between wide faces first (no star of triangles from an edge's two ends), then
        # the strips, which use them
        t1 = time.time()
        for k2, v in gridmesh.split_edges(shape, None if relative else float(linear)).items():
            RESULT.setdefault("grid_edges", {})[k2] = RESULT.get("grid_edges", {}).get(k2, 0) + v
        t2 = time.time()
        for k2, v in gridmesh.apply(shape, float(angular), None if relative else float(linear)).items():
            RESULT.setdefault("grid", {})[k2] = RESULT.get("grid", {}).get(k2, 0) + v
        RESULT["time_split"] = RESULT.get("time_split", 0.0) + t2 - t1
        RESULT["time_strips"] = RESULT.get("time_strips", 0.0) + time.time() - t2


def _shape_diag(shape) -> float:
    """Diagonal of a shape's bounding box, from its geometry (no mesh needed)."""
    from OCP.Bnd import Bnd_Box
    from OCP.BRepBndLib import BRepBndLib
    box = Bnd_Box()
    try:
        BRepBndLib.Add_s(shape, box, False)
        if box.IsVoid(): return 0.0
        x0, y0, z0, x1, y1, z1 = box.Get()
        return float(((x1 - x0) ** 2 + (y1 - y0) ** 2 + (z1 - z0) ** 2) ** 0.5)
    except Exception:
        return 0.0


def _refine_small_solids(shape, linear: float, angular: float) -> int:
    """A fixed deflection is coarse on a small part: 0.5 mm leaves a 63 mm round plate 18 segments round, a polygon 2 % smaller
    than the circle (NIST's FTC 11), while the same 0.5 mm is fine on a part a metre long. So after the whole shape is meshed, a
    solid whose CFG.size_cap share of its own diagonal is under the deflection is meshed again at that share (never under a
    tenth of the deflection, so a tiny screw is not cut into thousands of triangles). Big parts keep the mesh they had; a shape
    placed several times is refined once (meshing it again at the same setting does nothing). Returns how many were refined."""
    n = 0
    exp = TopExp_Explorer(shape, TopAbs_SOLID)
    while exp.More():
        s = exp.Current(); exp.Next()
        lin = max(linear * 0.1, CFG.size_cap * _shape_diag(s))
        if 0 < lin < linear * 0.999:
            _mesh_shape(s, lin, angular, False); n += 1
    return n


def tessellate(shape: TopoDS_Shape, linear_deflection: float = 0.5,
               angular_deflection: float = 0.5, relative: bool = False) -> None:
    """Tessellate every face on `shape` in place.

    `relative=True` is OCCT's relative deflection: each edge is meshed to `linear_deflection` times its own size, and a face to
    the largest deflection of its edges. Not a share of the model's size: small edges get fine meshes, long ones coarse.
    Default is absolute deflection in model units (typically mm).

    With CFG.tiers the solids are sorted by size into small / medium / large
    (their own bounding box against the whole model's) and each group is meshed
    with its own pair of deflections: fine on the big visible parts, coarse on
    the screws. A shape that is placed several times is meshed once; when its
    copies fall in different groups the finer setting wins.
    """
    mode = "relative" if relative else "absolute"
    t0 = time.time()
    tiers = CFG.tiers
    if not tiers:
        log(f"tessellating (linear={linear_deflection} {mode}, angular={angular_deflection}, parallel)")
        with Heartbeat("tessellation"):
            _mesh_shape(shape, linear_deflection, angular_deflection, relative)
            if CFG.size_cap > 0 and not relative:
                k = _refine_small_solids(shape, linear_deflection, angular_deflection)
                if k: log(f"   {k} small solid{'s' if k != 1 else ''} meshed finer (at most {CFG.size_cap * 100:g} % of their size)")
        log(f"tessellated in {time.time() - t0:.1f}s", "ok")
        _log_grid()
        return

    from OCP.TopoDS import TopoDS_Compound
    model = _shape_diag(shape)
    lo, hi = (model * tiers["split"][0] / 100.0, model * tiers["split"][1] / 100.0)
    names = ("small", "medium", "large")
    groups = {n: TopoDS_Compound() for n in names}
    counts = {n: 0 for n in names}
    builder = BRep_Builder()
    for c in groups.values(): builder.MakeCompound(c)
    exp = TopExp_Explorer(shape, TopAbs_SOLID)
    while exp.More():
        d = _shape_diag(exp.Current())
        n = "small" if d < lo else ("large" if d >= hi else "medium")
        builder.Add(groups[n], exp.Current()); counts[n] += 1
        exp.Next()
    # faces that belong to no solid (surface models) take the medium setting
    exp = TopExp_Explorer(shape, TopAbs_FACE, TopAbs_SOLID)
    loose = 0
    while exp.More():
        builder.Add(groups["medium"], exp.Current()); loose += 1
        exp.Next()
    log(f"tessellating by part size (model {model:.1f}; small < {lo:.1f} <= medium < {hi:.1f} <= large)")
    with Heartbeat("tessellation"):
        # coarse first: a shared shape met again by a finer group is refined
        for n in sorted(names, key=lambda k: -tiers[k][0]):
            if not counts[n] and not (n == "medium" and loose): continue
            lin, ang = tiers[n]
            log(f"   {n}: {counts[n]} solids, linear={lin} {mode}, angular={ang:.3f}")
            _mesh_shape(groups[n], lin, ang, relative)
    log(f"tessellated in {time.time() - t0:.1f}s", "ok")
    _log_grid()


def _log_grid() -> None:
    """With --grid: what the even strips did, and where the time went."""
    if not CFG.grid: return
    g = RESULT.get("grid", {}); e = RESULT.get("grid_edges", {})
    log(f"   even strips: {g.get('grid', 0):,} faces rebuilt, {sum(v for k, v in g.items() if k != 'grid'):,} left as meshed; "
        f"{e.get('points', 0):,} points on {e.get('edges', 0):,} long edges "
        f"(mesher {RESULT.get('time_mesher', 0):.1f}s, edges {RESULT.get('time_split', 0):.1f}s, strips {RESULT.get('time_strips', 0):.1f}s)")


# Surface normals of the meshes solid_to_mesh() has made, kept beside the
# (verts, tris) pairs the rest of the pipeline passes around: id(verts) ->
# (verts, normals). Holding verts here keeps the id from being reused.
_NORMALS: dict = {}

def _normals_of(verts):
    hit = _NORMALS.get(id(verts))
    if hit is not None and hit[0] is verts and len(hit[1]) == len(verts):
        return hit[1]
    return None

# The colour runs of a solid with faces in several colours, filed the same way: id(verts) -> (verts, [(colour, first triangle,
# triangle count), ...]), the runs in triangle order and covering every triangle.
_GROUPS: dict = {}

def _groups_of(verts, n_tris):
    hit = _GROUPS.get(id(verts))
    if hit is not None and hit[0] is verts and sum(r[2] for r in hit[1]) == n_tris:
        return hit[1]
    return None


# ─── The B-rep of a solid, kept beside its mesh (--brep).
# For every solid solid_to_mesh() meshes it also notes what the mesh came from: the CAD faces (kind, size, which
# triangles) and the real CAD edges (the polylines the mesher put on them). The record is filed under id(verts), as
# _NORMALS is, and written beside the GLB by write_brep_sidecar().
_BREP: dict = {}

# Face kinds, in the order of the codes the viewer reads (see _brepKinds in app.js).
_FACE_KINDS = ("plane", "cylinder", "cone", "sphere", "torus", "bezier", "bspline", "revolution", "extrusion", "offset", "other")


def _face_kind(face) -> tuple:
    """(kind code, [numbers]) of a CAD face: plane / cylinder / cone / sphere / torus ... and the radii that describe it
    (frame independent: radius; semi-angle in degrees and reference radius; major and minor radius)."""
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.GeomAbs import GeomAbs_SurfaceType as T
    try:
        ad = BRepAdaptor_Surface(face, True)
        t = ad.GetType()
        if t == T.GeomAbs_Plane: return 0, []
        if t == T.GeomAbs_Cylinder: return 1, [ad.Cylinder().Radius()]
        if t == T.GeomAbs_Cone: return 2, [math.degrees(ad.Cone().SemiAngle()), ad.Cone().RefRadius()]
        if t == T.GeomAbs_Sphere: return 3, [ad.Sphere().Radius()]
        if t == T.GeomAbs_Torus: return 4, [ad.Torus().MajorRadius(), ad.Torus().MinorRadius()]
        if t == T.GeomAbs_BezierSurface: return 5, []
        if t == T.GeomAbs_BSplineSurface: return 6, []
        if t == T.GeomAbs_SurfaceOfRevolution: return 7, []
        if t == T.GeomAbs_SurfaceOfExtrusion: return 8, []
        if t == T.GeomAbs_OffsetSurface: return 9, []
    except Exception:
        pass
    return 10, []


def _solid_edges(solid, faces: dict, fmap) -> tuple:
    """The CAD edges of a solid as polylines on its mesh. `fmap` is the solid's face map; `faces` maps a face's index in
    it to (triangulation, location, transformed vertices, record number). Returns (rows, points):
      rows    [first point, point count, smooth (1 = the two faces meet tangent), face a, face b] per edge
      points  float32 (N, 3), the same space as the mesh
    A seam (an edge that closes a cylinder on itself) and a degenerate edge (the tip of a cone) are not CAD lines
    and are left out."""
    from OCP.TopTools import TopTools_IndexedDataMapOfShapeListOfShape
    from OCP.GeomAbs import GeomAbs_Shape
    emap = TopTools_IndexedDataMapOfShapeListOfShape()
    TopExp.MapShapesAndAncestors_s(solid, TopAbs_EDGE, TopAbs_FACE, emap)
    rows, chunks, n = [], [], 0
    for i in range(1, emap.Extent() + 1):
        edge = TopoDS.Edge_s(emap.FindKey(i))
        if BRep_Tool.Degenerated_s(edge): continue
        owners = [TopoDS.Face_s(f) for f in emap.FindFromIndex(i)]
        if not owners: continue
        seam = any(BRep_Tool.IsClosed_s(edge, f) for f in owners)
        if seam: continue
        pts = None
        for f in owners:
            hit = faces.get(fmap.FindIndex(f))
            if not hit: continue
            tri, floc, fverts, _ = hit
            poly = BRep_Tool.PolygonOnTriangulation_s(edge, tri, floc)
            if poly is None: continue
            idx = poly.Nodes()
            ids = [idx.Value(k) - 1 for k in range(idx.Lower(), idx.Upper() + 1)]
            if len(ids) >= 2 and max(ids) < len(fverts):
                pts = fverts[ids]; break
        if pts is None: continue
        nums = []
        for f in owners[:2]:
            hit = faces.get(fmap.FindIndex(f))
            nums.append(hit[3] if hit else -1)
        while len(nums) < 2: nums.append(-1)
        smooth = 0
        if len(owners) == 2 and not owners[0].IsSame(owners[1]):
            try: smooth = 1 if BRep_Tool.Continuity_s(edge, owners[0], owners[1]) != GeomAbs_Shape.GeomAbs_C0 else 0
            except Exception: smooth = 0
        rows.append([n, len(pts), smooth, nums[0], nums[1]])
        chunks.append(np.asarray(pts, dtype=np.float32)); n += len(pts)
    return rows, (np.vstack(chunks) if chunks else np.zeros((0, 3), np.float32))


def write_brep_sidecar(solids: dict, output: Path) -> None:
    """Write <output>.brep.json (the index) and <output>.brep.bin (the edge points, float32 xyz) from
    {geometry key: record}. The key is what the GLB names on the node that carries the geometry (extras.brep)."""
    if not solids: return
    index, blobs, off = {}, [], 0
    for key, rec in solids.items():
        pts = rec["points"]
        index[key] = {"faces": rec["faces"], "edges": rec["edges"], "tris": rec["tris"], "pts": [off, int(len(pts))]}
        blobs.append(pts.astype("<f4", copy=False)); off += len(pts)
    base = output.with_suffix(output.suffix + ".brep")
    body = {"v": 1, "kinds": list(_FACE_KINDS), "solids": index}
    tmp = base.with_name(base.name + ".bin.tmp")
    with tmp.open("wb") as f:
        for b in blobs: f.write(b.tobytes())
    os.replace(tmp, base.with_name(base.name + ".bin"))
    tmpj = base.with_name(base.name + ".json.tmp")
    tmpj.write_text(json.dumps(body, separators=(",", ":")), encoding="utf-8")
    os.replace(tmpj, base.with_name(base.name + ".json"))
    n_faces = sum(len(r["faces"]) for r in solids.values()); n_edges = sum(len(r["edges"]) for r in solids.values())
    log(f"B-rep: {n_faces:,} faces, {n_edges:,} edges, {off:,} edge points for {len(solids)} solids", "ok")


def _identity_trsf(t) -> bool:
    """gp_Trsf is identity? Cheap check before allocating + matmul."""
    try:
        return (t.Value(1, 1) == 1.0 and t.Value(2, 2) == 1.0 and t.Value(3, 3) == 1.0
                and t.Value(1, 2) == 0.0 and t.Value(1, 3) == 0.0 and t.Value(1, 4) == 0.0
                and t.Value(2, 1) == 0.0 and t.Value(2, 3) == 0.0 and t.Value(2, 4) == 0.0
                and t.Value(3, 1) == 0.0 and t.Value(3, 2) == 0.0 and t.Value(3, 4) == 0.0)
    except Exception:
        return False


def solid_to_mesh(solid: TopoDS_Shape, face_colours=None):
    """Walk faces of a solid, return concatenated (vertices, triangles) or None.

    face_colours: (faces, colour of each) from _face_colour_groups(): the faces are meshed in that order and the colour runs are
    filed in _GROUPS (triangle start, count, colour), for build_glb_hierarchical() to write as primitives.

    Optimized:
      - Collect per-face arrays in lists, single np.vstack at the end.
      - Build the 3×4 face transform via tuple comprehension (12 attribute reads
        as one expression instead of a nested Python loop).
      - Skip the matmul when the face transform is identity (very common for
        free-floating solids that aren't part of an OCCT assembly tree).
      - Read triangle indices via `tri.Triangle(j).Get()` once per triangle and
        feed straight into a numpy array — uses array() + reshape vs vstack().
    """
    all_verts: list[np.ndarray] = []
    all_tris:  list[np.ndarray] = []
    all_norms: list[np.ndarray] = []
    want_normals = CFG.normals
    if want_normals:
        from OCP.BRepLib import BRepLib_ToolTriangulatedShape
    offset = 0
    if face_colours:
        face_seq, face_keys = face_colours
    else:
        face_seq, face_keys = [], None
        exp = TopExp_Explorer(solid, TopAbs_FACE)
        while exp.More():
            face_seq.append(exp.Current()); exp.Next()
    runs: list = []                    # [colour, first triangle, triangle count] in mesh order (face_colours only)
    tri_seen = 0
    loc = TopLoc_Location()
    want_brep = CFG.brep
    if want_brep:
        from OCP.TopTools import TopTools_IndexedMapOfShape
        fmap = TopTools_IndexedMapOfShape()
        brep_faces: list = []          # per CAD face: [kind, first triangle, triangle count, area, *numbers]
        brep_hits: dict = {}           # face map index -> (triangulation, location, vertices, record number)
        tri_total = 0
    for fi, face_shape in enumerate(face_seq):
        face = TopoDS.Face_s(face_shape)
        tri = BRep_Tool.Triangulation_s(face, loc)
        if tri is None:
            RESULT["faces_untessellated"] = RESULT.get("faces_untessellated", 0) + 1      # (counted: they used to vanish without a word)
            continue
        n_nodes = tri.NbNodes(); n_tris = tri.NbTriangles()
        if n_nodes == 0 or n_tris == 0:
            RESULT["faces_untessellated"] = RESULT.get("faces_untessellated", 0) + 1
            continue
        if face_keys is not None:
            if runs and runs[-1][0] == face_keys[fi]: runs[-1][2] += n_tris
            else: runs.append([face_keys[fi], tri_seen, n_tris])
        tri_seen += n_tris

        # ── vertices: list-comp of (X,Y,Z) tuples then a single asarray
        v_local = [(p.X(), p.Y(), p.Z()) for p in (tri.Node(j) for j in range(1, n_nodes + 1))]
        v_arr = np.asarray(v_local, dtype=np.float64)

        # ── apply face transform (gp_Trsf is 3x4). Fast-path identity.
        t = loc.Transformation()
        mirrored = False
        if _identity_trsf(t):
            verts = v_arr.astype(np.float32, copy=False)
        else:
            # 12 reads as one tuple — faster than nested for-loops with index assignment
            m = np.array((
                (t.Value(1, 1), t.Value(1, 2), t.Value(1, 3), t.Value(1, 4)),
                (t.Value(2, 1), t.Value(2, 2), t.Value(2, 3), t.Value(2, 4)),
                (t.Value(3, 1), t.Value(3, 2), t.Value(3, 3), t.Value(3, 4)),
            ), dtype=np.float64)
            v_world = v_arr @ m[:, :3].T + m[:, 3]
            verts = v_world.astype(np.float32, copy=False)
            mirrored = bool(np.linalg.det(m[:, :3]) < 0)

        # ── triangles: collect once, vectorize orientation flip + offset
        # Only flip winding for REVERSED faces. Earlier `!= 0` flipped
        # INTERNAL (2) and EXTERNAL (3) faces too, producing back-face
        # artefacts on cellular / boundary faces.
        # A face whose location is a mirror (a reflecting placement inside the
        # shape: det < 0) turns the winding over as well, so the two cancel
        # when both apply (what OCCT's own writers do: REVERSED xor mirrored).
        # The normals are carried through the same matrix, so without this
        # they and the winding disagreed and the face shaded inside-out.
        reverse = (face.Orientation() == TopAbs_REVERSED) != mirrored
        tris_buf = np.empty((n_tris, 3), dtype=np.uint32)
        for j in range(1, n_tris + 1):
            a, b, c = tri.Triangle(j).Get()
            tris_buf[j - 1, 0] = a - 1
            tris_buf[j - 1, 1] = b - 1
            tris_buf[j - 1, 2] = c - 1
        if reverse:
            tris_buf = tris_buf[:, [1, 0, 2]]
        # A face meshed round points placed inside it (--grid) can come back with a node the mesher made room for and
        # never filled: no triangle uses it, and its position is whatever was in memory (not a number, or 1e308). It takes
        # the place of a used node, so the node numbers the CAD edges refer to stay as they are and no NaN or infinity
        # reaches the file.
        unset = None
        used = np.zeros(n_nodes, dtype=bool); used[tris_buf.ravel()] = True
        if not used.all():
            unset = ~used
            v_arr[unset] = v_arr[np.argmax(used)]
            verts = np.array(verts, dtype=np.float32); verts[unset] = verts[np.argmax(used)]
        # A face that is only triangles (AP242 tessellated geometry: a COMPLEX_TRIANGULATED_FACE has no surface under it) carries
        # normals of its own, and they are what says which side is out. Files are written whose triangles run the other way round
        # to those normals (NIST's FTC 08 tessellated test part: every triangle), so the winding follows the normals, not the order.
        if tri.HasNormals() and BRep_Tool.Surface_s(face) is None:
            try:
                nl = np.asarray([(q.X(), q.Y(), q.Z()) for q in (tri.Normal(j) for j in range(1, n_nodes + 1))], dtype=np.float64)
                t0 = tris_buf if not reverse else tris_buf[:, [1, 0, 2]]       # (the order as the file has it)
                cr = np.cross(v_arr[t0[:, 1]] - v_arr[t0[:, 0]], v_arr[t0[:, 2]] - v_arr[t0[:, 0]])
                if float(np.einsum('ij,ij->', cr, nl[t0[:, 0]] + nl[t0[:, 1]] + nl[t0[:, 2]])) < 0:
                    tris_buf = tris_buf[:, [1, 0, 2]]
                    RESULT['faces_turned_to_normals'] = RESULT.get('faces_turned_to_normals', 0) + 1
            except Exception:
                pass
        if want_brep:
            try:
                a = verts[tris_buf[:, 1]].astype(np.float64) - verts[tris_buf[:, 0]]
                b = verts[tris_buf[:, 2]].astype(np.float64) - verts[tris_buf[:, 0]]
                area = float(0.5 * np.linalg.norm(np.cross(a, b), axis=1).sum())
                kind, nums = _face_kind(face)
                brep_faces.append([kind, tri_total, n_tris, round(area, 4)] + [round(float(x), 5) for x in nums])
                brep_hits[fmap.Add(face)] = (tri, loc.Multiplied(TopLoc_Location()), verts, len(brep_faces) - 1)
                tri_total += n_tris
            except Exception:
                want_brep = False       # (an odd face: this solid goes without a B-rep, and the mesh is unharmed)
        if offset:
            tris_buf = tris_buf + np.uint32(offset)

        # ── normals: the surface's own, at every node. This is what makes a
        # fillet run smoothly into the faces beside it: every face has nodes
        # of its own, so normals worked out from the triangles alone leave a
        # visible seam wherever two faces meet, however smooth the joint is.
        if want_normals:
            n_arr = None
            try:
                if not tri.HasNormals():
                    BRepLib_ToolTriangulatedShape.ComputeNormals_s(face, tri)
                if tri.HasNormals():
                    n_arr = np.asarray([(d.X(), d.Y(), d.Z()) for d in (tri.Normal(j) for j in range(1, n_nodes + 1))],
                                       dtype=np.float64)
                    if not _identity_trsf(t):
                        n_arr = n_arr @ m[:, :3].T
                    if reverse:
                        n_arr = -n_arr
                    if unset is not None: n_arr[unset] = (0.0, 0.0, 1.0)      # (nodes no triangle uses, above)
                    ln = np.linalg.norm(n_arr, axis=1)
                    if not np.all(np.isfinite(ln)) or np.any(ln < 1e-6):
                        n_arr = None          # a degenerate point of the surface (a cone's tip): leave this solid to the viewer
                    else:
                        n_arr = (n_arr / ln[:, None]).astype(np.float32)
            except Exception:
                n_arr = None
            if n_arr is None:
                want_normals = False
            else:
                all_norms.append(n_arr)

        all_verts.append(verts); all_tris.append(tris_buf)
        offset += n_nodes
    if not all_verts: return None
    out_v = np.vstack(all_verts)
    out_t = np.vstack(all_tris)
    if want_normals and len(all_norms) == len(all_verts):
        out_n = np.vstack(all_norms)
        # Every CAD face is meshed with points of its own, so where two faces meet smoothly (a fillet into a wall) the points
        # along the seam are written twice with the same position and the same normal: 4 to 10 % of the vertices of a STEP.
        # They are joined here, bit for bit equal only, so nothing moves and no shading changes. Not with the B-rep kept: the
        # CAD-face tools expect each face to have its own points.
        if not want_brep and not CFG.brep and len(out_v) > 1:
            rows = np.ascontiguousarray(np.hstack([out_v, out_n])).view(np.dtype((np.void, out_v.itemsize * 6))).ravel()
            _, first, inv = np.unique(rows, return_index=True, return_inverse=True)
            if len(first) < len(rows):
                order = np.argsort(first, kind="stable")
                rank = np.empty_like(order); rank[order] = np.arange(len(order))
                keep = first[order]
                RESULT["vertices_joined"] = RESULT.get("vertices_joined", 0) + int(len(rows) - len(keep))
                out_v = np.ascontiguousarray(out_v[keep]); out_n = np.ascontiguousarray(out_n[keep])
                out_t = rank[inv.ravel()][out_t].astype(np.uint32)
        _NORMALS[id(out_v)] = (out_v, out_n)
    if want_brep and brep_faces:
        try:
            rows, pts = _solid_edges(solid, brep_hits, fmap)
            _BREP[id(out_v)] = (out_v, {"faces": brep_faces, "edges": rows, "points": pts, "tris": tri_total})
        except Exception as e:
            log(f"B-rep edges of one solid skipped: {e}", "warn")
    if len(runs) > 1:
        _GROUPS[id(out_v)] = (out_v, [tuple(r) for r in runs])
    return out_v, out_t


def _trimesh(verts, tris, normals=None) -> "trimesh.Trimesh":
    """The trimesh for one body, with its surface normals when there are any
    (the glTF writer then stores them as NORMAL)."""
    if normals is None:
        normals = _normals_of(verts)
    if normals is not None and normals is not False:
        return trimesh.Trimesh(vertices=verts, faces=tris, vertex_normals=normals, process=False)
    return trimesh.Trimesh(vertices=verts, faces=tris, process=False)


def solid_volume_area(solid: TopoDS_Shape) -> tuple[float, float]:
    """Read the CAD-precise volume and surface area via OCCT."""
    try:
        from OCP.GProp import GProp_GProps
        from OCP.BRepGProp import BRepGProp
        vp = GProp_GProps(); ap = GProp_GProps()
        BRepGProp.VolumeProperties_s(solid, vp)
        BRepGProp.SurfaceProperties_s(solid, ap)
        return float(vp.Mass()), float(ap.Mass())
    except Exception:
        return 0.0, 0.0


def pca_canonical(verts: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Return (canonical_vertices, world_from_canonical_4x4).

    Translate to centroid, rotate so principal axes align with X/Y/Z,
    then sign-canonicalize so chiral copies of the same shape match.
    The 4x4 transform maps canonical vertices back to their world position.
    """
    if len(verts) < 4:
        return verts.copy(), np.eye(4, dtype=np.float64)
    centroid = verts.mean(axis=0)
    centered = (verts - centroid).astype(np.float64)
    # 3x3 covariance + eigendecomposition (eigh: symmetric, ascending eigenvalues)
    try:
        cov = np.cov(centered.T)
        eigvals, eigvecs = np.linalg.eigh(cov)
    except np.linalg.LinAlgError:
        return verts.copy(), np.eye(4, dtype=np.float64)
    order = np.argsort(eigvals)[::-1]   # descending eigenvalues
    R = eigvecs[:, order]
    # Reject near-symmetric shapes: PCA axes are unstable when eigenvalues are close.
    # Two parts with similar eigenvalue ratios will pick inconsistent rotations
    # and end up rendering at the wrong angle.
    e = eigvals[order]
    e0 = max(abs(e[0]), 1e-12)
    if abs(e[1] - e[0]) / e0 < 0.05 or abs(e[2] - e[1]) / e0 < 0.05:
        # Near-symmetric — don't try to canonicalize, fall back to identity
        return verts.copy(), np.eye(4, dtype=np.float64)
    canonical = centered @ R
    # Sign-canonicalize first 2 axes by median; force det(R)=+1 by deriving axis 2.
    # This keeps R a proper rotation (no reflections, normals stay correct).
    for axis in range(2):
        if np.median(canonical[:, axis]) < 0:
            canonical[:, axis] = -canonical[:, axis]
            R[:, axis] = -R[:, axis]
    if np.linalg.det(R) < 0:
        canonical[:, 2] = -canonical[:, 2]
        R[:, 2] = -R[:, 2]
    T = np.eye(4, dtype=np.float64)
    T[:3, :3] = R.T   # canonical = (v - c) @ R  →  v = canonical @ R^T + c
    T[:3, 3] = centroid
    return canonical.astype(np.float32), T


def hash_canonical(verts: np.ndarray, tris: np.ndarray) -> str:
    """Hash a canonical-pose mesh in a scale-aware, noise-tolerant way."""
    if len(verts) == 0:
        return "empty"
    diag = float(np.linalg.norm(verts.max(axis=0) - verts.min(axis=0)))
    scale = max(diag, 1e-9)
    # Quantize at 1/2000 of bbox diagonal — tolerant to floating-point noise
    quant = np.round(verts * (2000.0 / scale)).astype(np.int64)
    # Sort along axis=0 (lexicographic on rows = vertex-order-insensitive)
    # rather than flattening — flattening collapsed all axes into one bag and
    # would hash-collide shapes that share a coordinate multiset but differ
    # geometrically (e.g. a cube and its reflection through the diagonal).
    # axis=0 keeps each (x,y,z) tuple intact; pca_canonical already
    # canonicalised pose+sign so two equivalent shapes still hash equal.
    rows = np.ascontiguousarray(quant)
    order = np.lexsort((rows[:, 2], rows[:, 1], rows[:, 0]))
    quant_sorted = rows[order].tobytes()
    h = hashlib.blake2b(quant_sorted, digest_size=10)
    h.update(np.asarray([len(verts), len(tris)], dtype=np.int64).tobytes())
    return h.hexdigest()


def bbox_diag(verts: np.ndarray) -> float:
    if len(verts) == 0: return 0.0
    return float(np.linalg.norm(verts.max(axis=0) - verts.min(axis=0)))


def build_glb(parts: list[dict], output: Path, scene_meta: dict, instance: bool = True) -> None:
    """Build a trimesh.Scene with proper instancing + colors + per-node metadata."""
    log("building GLB scene")
    t0 = time.time()
    scene = trimesh.Scene()

    # Group by canonical hash
    groups: dict[str, list[dict]] = defaultdict(list)
    for p in parts: groups[p["hash"]].append(p)

    n_total = len(parts)
    n_unique = len(groups)
    n_instanced = sum(len(v) for v in groups.values() if len(v) > 1)
    log(f"{n_total} parts → {n_unique} unique shapes (after PCA pose-normalization)")
    if instance and n_instanced:
        log(f"  → {n_instanced} parts will be instanced ({n_total - n_unique} draws saved)", "ok")

    brep_out: dict = {}        # key on the node (extras.brep) -> B-rep record (--brep), for the sidecar
    for h, group in groups.items():
        ref = group[0]
        if instance and len(group) > 1:
            # Build ONE mesh in canonical pose, reuse via geom_name across instances
            verts = ref["canonical"]; tris = ref["tris"]
            if len(verts) == 0 or len(tris) == 0: continue
            # (the canonical pose is the mesh itself unless --pca-instances turned it)
            mesh = _trimesh(verts, tris, None if verts is ref["verts"] else False)
            _apply_color(mesh, ref.get("color"))
            geom_name = f"shape_{h[:10]}"
            bkey = None
            if ref.get("brep") is not None and verts is ref["verts"]:       # (a turned copy no longer matches the B-rep)
                bkey = geom_name; brep_out[bkey] = ref["brep"]
            for p in group:
                # Pass the part's world transform — trimesh stores it on the node
                scene.add_geometry(
                    mesh,
                    geom_name=geom_name,
                    node_name=p["name"],
                    transform=p["transform"],
                    metadata=({**_node_meta(p), "brep": bkey} if bkey else _node_meta(p)),
                )
        else:
            # Singletons: bake into world coords (no transform, simplest)
            for p in group:
                if len(p["verts"]) == 0 or len(p["tris"]) == 0: continue
                mesh = _trimesh(p["verts"], p["tris"])
                _apply_color(mesh, p.get("color"))
                meta = _node_meta(p)
                if p.get("brep") is not None:
                    bkey = f"part_{len(brep_out):06d}"; brep_out[bkey] = p["brep"]; meta["brep"] = bkey
                scene.add_geometry(mesh, node_name=p["name"], metadata=meta)

    # Stash document-level metadata so the web side can show it
    if scene_meta:
        try: scene.metadata.update(scene_meta)
        except Exception: pass

    log(f"scene assembled in {time.time() - t0:.1f}s", "ok")
    log(f"writing GLB: {output}")
    t0 = time.time()
    scene.export(output)
    out_mb = output.stat().st_size / 1048576
    log(f"wrote {out_mb:.2f} MB in {time.time() - t0:.1f}s", "ok")
    if brep_out:
        write_brep_sidecar(brep_out, output)


def _apply_color(mesh: trimesh.Trimesh, color):
    """Apply an (r,g,b) tuple in [0..1] as a PBR baseColor material."""
    if color is None:
        # Default neutral gray
        try:
            mesh.visual.material = PBRMaterial(baseColorFactor=[0.7, 0.7, 0.72, 1.0],
                                                metallicFactor=0.1, roughnessFactor=0.6)
        except Exception:
            pass
        return
    r, g, b = color
    try:
        mesh.visual.material = PBRMaterial(baseColorFactor=[float(r), float(g), float(b), 1.0],
                                            metallicFactor=0.15, roughnessFactor=0.55)
    except Exception:
        # Fallback: face colors
        mesh.visual.face_colors = [int(r*255), int(g*255), int(b*255), 255]


def _node_meta(p: dict) -> dict:
    """Build per-part metadata dict that goes into glTF node.extras."""
    md = {}
    if "volume" in p: md["volume"] = float(p["volume"])
    if "area" in p: md["area"] = float(p["area"])
    if "color" in p and p["color"] is not None:
        r, g, b = p["color"]; md["color_hex"] = f"#{int(r*255):02x}{int(g*255):02x}{int(b*255):02x}"
    if "material" in p and p["material"]: md["material"] = p["material"]
    return md


def _params_path(output_path: Path) -> Path:
    """<name>.glb.params.json, the record kept beside a converted GLB."""
    return output_path.with_suffix(output_path.suffix + ".params.json")


def _cache_params(input_path: Path) -> dict:
    """What a GLB was made from, and with which settings. Written beside the
    GLB after a conversion and compared on the next run: a GLB is only reused
    for the same file with the same settings. (serve.py reads "source" and
    "quality" from it too.) Built in this one place, so the two ways a
    conversion can end, hierarchical and flat, record the same things."""
    return {
        "source": str(input_path.resolve()),
        "quality": CFG.quality,
        "min_size_pct": CFG.min_size_pct,
        "relative": CFG.relative,
        "angular": CFG.angular,
        "size_cap": CFG.size_cap,
        "tiers": CFG.tiers,
        "min_edge": CFG.min_edge,
        "grid": CFG.grid,
        "normals": CFG.normals,
        "swap_yz": CFG.swap_yz,
        "surfaces": CFG.surfaces,
        "meshopt": CFG.meshopt,
        "quantize": CFG.quantize,
        "simplify": CFG.simplify,
        "instance": CFG.instance,
        "colors": CFG.colors,
        "split_colours": CFG.split_colours,
        "extras": CFG.extras,
        "brep": CFG.brep,
        "lod": list(CFG.lod),
        "lod_error": CFG.lod_error if CFG.lod else None,
        # (these change what is in the file too: without them, a run with --no-step-names and then a plain run got the nameless
        # GLB back, and a new converter served what an older one had made)
        "with_props": CFG.with_props,
        "pca_instances": CFG.pca_instances,
        "read": [CFG.read_shuo, CFG.read_layers, CFG.read_materials, CFG.read_names, CFG.read_props],
        "converter": _converter_version(),
        # (the file itself, not only its date: a revision copied in with an older date was served the GLB of the one before)
        "source_size": _stat_or(input_path, "st_size"),
        "source_mtime_ns": _stat_or(input_path, "st_mtime_ns"),
    }


def _stat_or(p: Path, field: str):
    try: return getattr(p.stat(), field)
    except OSError: return None


_CONVERTER_VERSION = None
def _converter_version() -> str:
    """A short fingerprint of this script: a GLB made by another version of the converter is not reused."""
    global _CONVERTER_VERSION
    if _CONVERTER_VERSION is None:
        try: _CONVERTER_VERSION = hashlib.sha1(Path(__file__).read_bytes()).hexdigest()[:12]
        except Exception: _CONVERTER_VERSION = "?"
    return _CONVERTER_VERSION


def _write_params(input_path: Path, output_path: Path) -> None:
    """Record what the GLB was made from. Only for a GLB that exists: a
    record with no GLB beside it would describe a conversion that never
    happened."""
    if not output_path.exists(): return
    try: _params_path(output_path).write_text(json.dumps(_cache_params(input_path)))
    except OSError: pass


def _assembled_bbox(roots: list, products: dict) -> tuple[np.ndarray, np.ndarray]:
    """Bounding box of the model as it is put together: every occurrence of
    every product, at its place in the assembly.

    A product's mesh is in the product's own frame (that is what lets its
    occurrences share it), so the boxes of the meshes alone say nothing about
    how large the assembly is: a hundred bolts along a two-metre rail are all
    the same small box at the origin. Here each product's box is carried
    through the transforms on the way down from the root, corner by corner.
    Returns (min, max); min is +inf when there is nothing to measure.
    """
    corners: dict[str, np.ndarray] = {}                 # product key → the 8 corners of its box
    for key, prod in products.items():
        lo = np.full(3,  np.inf, dtype=np.float64)
        hi = np.full(3, -np.inf, dtype=np.float64)
        for verts, _ in prod.meshes:
            if len(verts) == 0: continue
            np.minimum(lo, verts.min(axis=0), out=lo)
            np.maximum(hi, verts.max(axis=0), out=hi)
        if np.all(np.isfinite(lo)):
            corners[key] = np.array([(x, y, z) for x in (lo[0], hi[0])
                                               for y in (lo[1], hi[1])
                                               for z in (lo[2], hi[2])], dtype=np.float64)
    bbox_min = np.full(3,  np.inf, dtype=np.float64)
    bbox_max = np.full(3, -np.inf, dtype=np.float64)

    def walk(node, parent_world: np.ndarray) -> None:
        world = parent_world @ node.transform
        c = corners.get(node.product_key) if node.product_key is not None else None
        if c is not None:
            placed = c @ world[:3, :3].T + world[:3, 3]
            np.minimum(bbox_min, placed.min(axis=0), out=bbox_min)
            np.maximum(bbox_max, placed.max(axis=0), out=bbox_max)
        for child in node.children:
            walk(child, world)

    for r in roots:
        walk(r, np.eye(4, dtype=np.float64))
    return bbox_min, bbox_max


# ─── Levels of detail (--lod) ──────────────────────────────────────────────
# The simplifier is meshoptimizer's. gltfpack (-si) is what the converter uses
# for --simplify, so it is also used for the LOD files when it is installed.
# Without it the same library runs from the app's own bundled copy
# (vendor/meshoptimizer, a WebAssembly module) through Node.js and
# lod-simplify.mjs: the browser app simplifies with that very file.
LOD_HELPER = Path(__file__).resolve().parent / "js" / "lod-simplify.mjs"
LOD_WASM = Path(__file__).resolve().parent / "vendor" / "meshoptimizer" / "meshopt_simplifier.module.js"


def _lod_engine() -> str:
    """'gltfpack' or 'node'; RuntimeError when neither can simplify."""
    if shutil.which("gltfpack"):
        return "gltfpack"
    if shutil.which("node") and LOD_HELPER.exists() and LOD_WASM.exists():
        return "node"
    raise RuntimeError(
        "--lod needs a mesh simplifier and found none: install gltfpack (npm i -g gltfpack) "
        "or Node.js (the app's bundled meshoptimizer runs through it)")


def _lod_paths(output_path: Path) -> list:
    """<name>.glb for the first level, then <name>_lod1.glb, <name>_lod2.glb ..."""
    n = max(1, len(CFG.lod))
    return [output_path] + [output_path.with_name(f"{output_path.stem}_lod{i}{output_path.suffix}")
                            for i in range(1, n)]


def _weld(verts: np.ndarray, tris: np.ndarray):
    """Merge vertices that sit at the same place (the tessellation gives every
    face its own, so the faces of a part are not joined: a simplifier would
    take each face for a separate mesh with a border). Returns (first, tris):
    first[k] is the index in `verts` of welded vertex k, tris index the welded
    vertices; triangles that collapse to a line are dropped."""
    v = np.asarray(verts, dtype=np.float64)
    span = float(np.linalg.norm(v.max(axis=0) - v.min(axis=0))) if len(v) else 0.0
    tol = max(span * 1e-6, 1e-9)
    q = np.round(v / tol).astype(np.int64)
    _, first, inv = np.unique(q, axis=0, return_index=True, return_inverse=True)
    t = np.asarray(inv).reshape(-1)[np.asarray(tris, dtype=np.int64)]
    ok = (t[:, 0] != t[:, 1]) & (t[:, 1] != t[:, 2]) & (t[:, 0] != t[:, 2])
    return first, t[ok]


def _simplify_batch(meshes: list, ratio: float, err: float) -> list:
    """Simplify (verts, tris) meshes to `ratio` of their triangles with the
    bundled meshoptimizer (Node engine). Returns, per mesh, (sel, new_tris):
    the new mesh is verts[sel] with the triangles new_tris. Borders are locked
    first so the outline of a surface model does not creep; where that stops
    the reduction well short of the target it runs again without the lock
    (the same two steps as mesh-worker.js)."""
    node = shutil.which("node")
    prepared = []
    for verts, tris in meshes:
        first, wt = _weld(verts, tris)
        target = min(len(wt), max(1, int(len(tris) * ratio)))
        prepared.append((first, wt, target))
    tmp = tempfile.mkdtemp(prefix="step2glb_lod_")
    try:
        inp, outp = os.path.join(tmp, "in.bin"), os.path.join(tmp, "out.bin")
        with open(inp, "wb") as f:
            f.write(struct.pack("<I", len(prepared)))
            for (first, wt, target), (verts, _) in zip(prepared, meshes):
                pos = np.ascontiguousarray(np.asarray(verts, dtype=np.float32)[first])
                idx = np.ascontiguousarray(wt, dtype=np.uint32)
                f.write(struct.pack("<III", len(pos), idx.size, target * 3))
                f.write(pos.tobytes())
                f.write(idx.tobytes())
        r = subprocess.run([node, str(LOD_HELPER), inp, outp, repr(float(err))],
                           capture_output=True, text=True, encoding="utf-8", errors="replace")
        if r.returncode != 0:
            raise RuntimeError("the simplifier failed: " + (r.stderr.strip()[-400:] or f"exit {r.returncode}"))
        data = Path(outp).read_bytes()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    off = 0
    results = []
    for first, wt, _target in prepared:
        n = struct.unpack_from("<I", data, off)[0]
        off += 4
        res = np.frombuffer(data, dtype=np.uint32, count=n, offset=off).astype(np.int64)
        off += 4 * n
        if n == 0:                       # nothing came back: keep the welded mesh
            res = wt.reshape(-1).astype(np.int64)
        used, inv = np.unique(res, return_inverse=True)
        results.append((first[used], np.asarray(inv).reshape(-1, 3).astype(np.uint32)))
    return results


def _simplified_products(products: dict, ratio: float) -> dict:
    """The products with every mesh simplified (once per product: all its
    occurrences share it, so the LOD keeps the instancing)."""
    items = []                                    # (key, mesh number, run colour or None, (verts, tris))
    for key, p in products.items():
        for i, m in enumerate(p.meshes):
            runs = _groups_of(m[0], len(m[1])) if (p.face_colours and i < len(p.face_colours) and p.face_colours[i]) else None
            if runs:          # (a body with faces in several colours: each colour is simplified on its own and the runs kept)
                for col, s, c in runs: items.append((key, i, col, (m[0], np.asarray(m[1])[s:s + c])))
            else:
                items.append((key, i, None, m))
    res = _simplify_batch([m for *_, m in items], ratio, CFG.lod_error)
    out = {key: _dc_replace(p, meshes=list(p.meshes)) for key, p in products.items()}
    parts: dict = defaultdict(list)
    for (key, i, col, (verts, _t)), (sel, nt) in zip(items, res):
        if col is None:
            out[key].meshes[i] = (np.asarray(verts)[sel], nt)
        else:
            parts[(key, i)].append((col, np.asarray(sel)[np.asarray(nt, dtype=np.int64)].reshape(-1, 3)))
    for (key, i), runs in parts.items():
        verts = np.asarray(products[key].meshes[i][0])
        allt = np.vstack([t for _, t in runs]) if runs else np.zeros((0, 3), np.int64)
        used, inv = np.unique(allt.ravel(), return_inverse=True)
        nv = np.ascontiguousarray(verts[used]); nt = inv.reshape(-1, 3).astype(np.uint32)
        hit = _NORMALS.get(id(verts))
        if hit is not None and hit[0] is verts: _NORMALS[id(nv)] = (nv, np.ascontiguousarray(hit[1][used]))
        s, rr = 0, []
        for col, t in runs:
            if len(t): rr.append((col, s, len(t))); s += len(t)
        if len(rr) > 1: _GROUPS[id(nv)] = (nv, rr)
        out[key].meshes[i] = (nv, nt)
    return out


def _simplified_parts(parts: list, ratio: float) -> list:
    """The flat reader's parts, simplified: the ones build_glb really writes
    (singletons, and the first of each group of instances)."""
    groups: dict[str, list[int]] = defaultdict(list)
    for i, p in enumerate(parts):
        groups[p["hash"]].append(i)
    need = []
    for idxs in groups.values():
        if CFG.instance and len(idxs) > 1: need.append(idxs[0])
        else: need.extend(idxs)
    res = _simplify_batch([(parts[i]["canonical"], parts[i]["tris"]) for i in need],
                          ratio, CFG.lod_error)
    out = list(parts)
    for i, (sel, nt) in zip(need, res):
        p = dict(parts[i])
        p["verts"] = p["verts"][sel]
        p["canonical"] = p["canonical"][sel]
        p["tris"] = nt
        p["brep"] = None            # (the faces and edges belong to the full mesh, not this one)
        out[i] = p
    return out


def _write_levels(output_path: Path, write_full, simplified_copy) -> None:
    """Write the GLB, and with --lod the other levels. write_full(path) builds
    the GLB from the full-resolution meshes; simplified_copy(ratio) returns a
    writer for the same scene with every mesh reduced to `ratio`."""
    levels = CFG.lod or (100.0,)
    engine = _lod_engine() if any(p < 100 for p in levels) else None
    if engine:
        log(f"LOD levels {', '.join(f'{p:g}%' for p in levels)} ({engine} simplifier)")
    for pct, path in zip(levels, _lod_paths(output_path)):
        ratio = pct / 100.0
        if ratio >= 1.0:
            write_full(path)
            gltfpack_postprocess(path, CFG.meshopt, CFG.quantize, CFG.simplify)
        elif engine == "gltfpack":
            write_full(path)
            gltfpack_postprocess(path, CFG.meshopt, CFG.quantize, ratio)
        else:
            simplified_copy(ratio)(path)
            gltfpack_postprocess(path, CFG.meshopt, CFG.quantize, 0.0)
        if CFG.swap_yz and path.exists() and _swap_yz_glb(path):
            log(f"swapped Y and Z in {path.name}", "ok")


def _write_levels_hier(roots, products, output_path, scene_meta) -> None:
    _write_levels(
        output_path,
        lambda path: build_glb_hierarchical(roots, products, path, scene_meta, instance=CFG.instance),
        lambda ratio: (lambda path, _p=_simplified_products(products, ratio):
                       build_glb_hierarchical(roots, _p, path, scene_meta, instance=CFG.instance)))


def _write_levels_flat(parts, output_path, scene_meta) -> None:
    _write_levels(
        output_path,
        lambda path: build_glb(parts, path, scene_meta, instance=CFG.instance),
        lambda ratio: (lambda path, _p=_simplified_parts(parts, ratio):
                       build_glb(_p, path, scene_meta, instance=CFG.instance)))


def _collect_outputs(output_path: Path) -> None:
    """Fill RESULT with what is on disk: size and triangles of every level."""
    levels = []
    pcts = CFG.lod or (100.0,)
    for pct, path in zip(pcts, _lod_paths(output_path)):
        if not path.exists():
            continue
        tris, size_mb = _glb_metrics(path)
        levels.append({"file": path.name, "percent": pct, "tris": tris, "size_mb": round(size_mb, 4)})
    if not levels:
        return
    RESULT["levels"] = levels
    RESULT["tris_out"] = levels[0]["tris"]
    gaps = RESULT.get("faces_untessellated", 0)
    if gaps:
        log(f"{gaps:,} CAD faces could not be meshed and are missing from the model (holes where they were). "
            "A finer --quality, or another export of the STEP from the CAD program, may bring them back.", "warn")
    joined = RESULT.get("vertices_joined", 0)
    if joined:
        log(f"{joined:,} vertices written twice along smooth seams between CAD faces were joined (nothing moved)", "ok")
    st = RESULT.get("mesher_status", 0)
    said = [w for bit, w in ((1, "a face outline that is not closed"), (2, "a face outline that crosses itself"),
                             (4, "faces it could not mesh")) if st & bit]
    if said:
        log("the mesher met " + ", ".join(said) + ": look for gaps or odd triangles there"
            + ("" if gaps else " (every face still has triangles)"), "warn")
    RESULT["size_mb"] = levels[0]["size_mb"]
    if len(levels) > 1:
        for i, lv in enumerate(levels):
            log(f"LOD {i}: {lv['percent']:g}% -> {lv['tris']:,} triangles, {lv['size_mb']:.2f} MB  ({lv['file']})", "ok")


# ─── Reading without XCAF (no colours, names or assembly): STEP, IGES, BREP.
def _read_plain_shape(input_path: Path):
    kind = CFG.fmt
    if kind == "brep":
        shape = TopoDS_Shape()
        with Heartbeat("BREP parsing"):
            ok = BRepTools.Read_s(shape, str(input_path), BRep_Builder())
        if not ok or shape.IsNull():
            raise RuntimeError("BREP read failed: not a BREP file, or it is empty")
        return shape
    if kind == "iges":
        if IGESControl_Reader is None:
            raise RuntimeError("this OpenCascade build has no IGES reader")
        reader = IGESControl_Reader()
        with Heartbeat("plain parsing"):
            status = reader.ReadFile(str(input_path))
        if status != IFSelect_RetDone or reader.NbRootsForTransfer() == 0:
            raise RuntimeError("plain IGES read failed: not an IGES file, or it holds nothing to transfer")
        with Heartbeat("plain transfer"):
            reader.TransferRoots()
        return reader.OneShape()
    reader = STEPControl_Reader()
    with Heartbeat("plain parsing"):
        status = reader.ReadFile(str(input_path))
    if status != IFSelect_RetDone:
        raise RuntimeError("plain STEP read failed")
    with Heartbeat("plain transfer"):
        reader.TransferRoots()
    return reader.OneShape()


def _plain_bodies(shape) -> list:
    """The bodies of a shape read without XCAF: its solids. A STEP without
    solids has nothing to write. An IGES or BREP surface model is meshed as it
    is: each shell is a body, the faces that belong to no shell are one more."""
    bodies = []
    exp = TopExp_Explorer(shape, TopAbs_SOLID); idx = 0
    while exp.More():
        bodies.append({"shape": exp.Current(), "color": None, "name": f"solid_{idx:05d}"})
        idx += 1; exp.Next()
    if bodies or (CFG.fmt == "step" and not CFG.surfaces):
        log(f"found {len(bodies)} solids", "ok")
        return bodies
    if CFG.fmt == "step":
        # A STEP with no solid: faceted breps (a mesh exported from 3ds Max or CAD Exchanger) are read as closed shells, not solids.
        log("found 0 solids, looking for shells (faceted breps, surface bodies)", "warn")
    from OCP.TopoDS import TopoDS_Compound
    exp = TopExp_Explorer(shape, TopAbs_SHELL); idx = 0
    while exp.More():
        bodies.append({"shape": exp.Current(), "color": None, "name": f"shell_{idx:05d}"})
        idx += 1; exp.Next()
    comp = TopoDS_Compound(); builder = BRep_Builder(); builder.MakeCompound(comp)
    loose = 0
    exp = TopExp_Explorer(shape, TopAbs_FACE, TopAbs_SHELL)
    while exp.More() and CFG.fmt != "step":       # (a STEP that holds only loose faces still has nothing to write)
        builder.Add(comp, exp.Current()); loose += 1; exp.Next()
    if loose:
        bodies.append({"shape": comp, "color": None, "name": "surfaces"})
    log(f"no solids: meshing {len(bodies)} surface bodies ({idx} shells, {loose} loose faces)",
        "ok" if bodies else "warn")
    return bodies


def convert(input_path: Path, output_path: Path) -> None:
    """Run the full STEP→GLB pipeline using the module-level CFG.

    Assumes main() has populated CFG already. Cache hit (output newer than
    input) is a fast no-op unless CFG.force is set.
    """
    size_mb = input_path.stat().st_size / 1048576
    # Auto threshold raised from 200 MB → 1024 MB. The 200 MB cap dated from
    # before the hierarchical XCAF path existed — back then XCAF only added
    # names + colors and 60–180s of parse cost wasn't always worth it. Now
    # XCAF also unlocks the assembly tree + reference-based instancing, which
    # is structurally important. Keep the override path: pass --no-colors to
    # skip XCAF on enormous files where you only want geometry as fast as
    # possible.
    kind = input_kind(input_path)
    CFG.fmt = kind
    RESULT.clear()
    RESULT["format"] = kind
    # A BREP file holds neither colours nor names nor an assembly: nothing for XCAF to read.
    use_xcaf = kind != "brep" and ((CFG.colors == "on") or (CFG.colors == "auto" and size_mb <= 1024))

    # ─── cache check: skip conversion if output is newer than input AND the
    # sidecar params match. mtime alone misses the "user re-ran with a tighter
    # --quality but got the stale GLB" footgun.
    params_path = _params_path(output_path)
    current_params = _cache_params(input_path)
    if not CFG.force and output_path.exists():
        if output_path.stat().st_mtime > input_path.stat().st_mtime:
            cached_params = None
            if params_path.exists():
                try:
                    cached_params = json.loads(params_path.read_text())
                except Exception:
                    cached_params = None
            if cached_params == current_params and all(p.exists() for p in _lod_paths(output_path)):
                out_mb = output_path.stat().st_size / 1048576
                log(f"cached: {output_path.name} ({out_mb:.1f} MB) is newer than source and params match — skipping conversion (use --force to re-convert)", "ok")
                RESULT["cached"] = True
                _collect_outputs(output_path)
                return
            log("cache stale: conversion params changed — re-converting", "warn")

    print()
    print(f"╭─ {_KIND_LABEL[kind]} → GLB")
    print(f"│  input:    {input_path}  ({size_mb:.1f} MB)")
    print(f"│  output:   {output_path}")
    print(f"│  quality:  linear deflection {CFG.quality} ({'relative' if CFG.relative else 'absolute'}), angular {CFG.angular:.3f} rad")
    if CFG.tiers:
        print("│  by size:  " + "  ".join(f"{n} {CFG.tiers[n][0]:g}/{CFG.tiers[n][1]:.3f}" for n in ("small", "medium", "large"))
              + f"  (limits {CFG.tiers['split'][0]:g}% / {CFG.tiers['split'][1]:g}% of the model)")
    print(f"│  min size: {CFG.min_size_pct}% of model" if CFG.min_size_pct > 0 else "│  min size: keep all")
    print(f"│  instance: {CFG.instance}")
    if CFG.lod:
        print(f"│  lod:      {', '.join(f'{p:g}%' for p in CFG.lod)}  (files {', '.join(p.name for p in _lod_paths(output_path))})")
    print(f"│  colors:   {'XCAF (slow on big files)' if use_xcaf else 'OFF (plain reader, fast)'}"
          f"{'  -- forced --no-colors' if CFG.colors=='off' else ''}"
          f"{'  -- file > 1 GB, skipping XCAF' if CFG.colors=='auto' and not use_xcaf else ''}")
    if CFG.meshopt or CFG.quantize or CFG.simplify > 0:
        feats = []
        if CFG.simplify > 0: feats.append(f"simplify {CFG.simplify:.2f}")
        if CFG.quantize: feats.append("KHR_mesh_quantization")
        if CFG.meshopt:  feats.append("EXT_meshopt_compression")
        print(f"│  post:     gltfpack ({', '.join(feats)})")
    print(f"╰────────────────────────────────────────────────────────────")
    print()

    t_total = time.time()
    if not use_xcaf:
        if kind == "brep":
            log("BREP holds no colours, names or assembly: using the plain reader", "warn")
        else:
            log("using fast plain reader (no colors / names / materials)", "warn")
        scene_meta = {}
        shape = _read_plain_shape(input_path)
        tessellate(shape, linear_deflection=CFG.quality, angular_deflection=CFG.angular, relative=CFG.relative)
        solid_meta = _plain_bodies(shape)
        # Jump straight to mesh extraction below
        return _finish_convert(input_path, output_path, solid_meta, scene_meta, t_total)

    # Read with XCAF for colors + names + materials + layers + assembly tree.
    # parse_step_xcaf_cached transparently uses a binary OCAF cache file
    # (next to the STEP, .xcaf-cache.xbf) so re-runs skip the slow ReadFile.
    # Only the reading is in the try: writing the GLB comes after it, so a disk that is full is reported as that, and not as
    # "XCAF reader failed" followed by reading the whole STEP again with the plain reader.
    ready = None
    try:
        doc, shape_tool, color_tool, free_labels = parse_xcaf_cached(input_path)
        scene_meta = collect_metadata(shape_tool, color_tool, doc, free_labels)
        log(f"document metadata: {len(scene_meta)} top-level entries")
        for k, v in scene_meta.items():
            log(f"   {k}: {len(v) if hasattr(v, '__len__') else v}")
        # Combine all free shapes for tessellation. One BRep_Builder, one
        # MakeCompound — the original instantiated Builder() inside the loop
        # which is wasteful (each call does a vtable lookup + alloc).
        from OCP.TopoDS import TopoDS_Compound
        from OCP.BRep import BRep_Builder
        comp = TopoDS_Compound()
        builder = BRep_Builder()
        builder.MakeCompound(comp)
        for i in range(1, free_labels.Length() + 1):
            try:
                sh = shape_tool.GetShape_s(free_labels.Value(i))
                builder.Add(comp, sh)
            except Exception:
                pass
        # (with worker processes the model is meshed after the walk, a body at a time; the walk does not need the mesh)
        meshed = not _mesh_jobs_wanted()
        if meshed:
            tessellate(comp, linear_deflection=CFG.quality, angular_deflection=CFG.angular, relative=CFG.relative)

        # ── Hierarchical path: walk the XCAF tree, cache products, write GLB
        # with proper parent/child structure and reference-based instancing,
        # so the assembly hierarchy and explicit STEP instances survive into
        # the GLB (and thence the viewer). The flat build_glb path further
        # down is what the plain reader uses.
        log("walking XCAF assembly tree...")
        t_walk = time.time()
        products, roots = walk_xcaf_tree(shape_tool, color_tool, free_labels, doc=doc,
                                         surfaces=(kind != "step"), loose_shells=(kind == "step" and CFG.surfaces))
        log(f"  → {len(products)} unique products, {len(roots)} top-level roots "
            f"in {time.time()-t_walk:.2f}s", "ok")
        if meshed or not parallel_mesh_products(comp, products):
            if not meshed:
                tessellate(comp, linear_deflection=CFG.quality, angular_deflection=CFG.angular, relative=CFG.relative)
            extract_product_meshes(products)
        RESULT["tris_in"] = sum(len(t) for p in products.values() for _, t in p.meshes)

        if CFG.min_size_pct > 0:
            # Apply size threshold AT THE PRODUCT LEVEL — drop products whose
            # largest solid bbox-diag is below cutoff, then prune leaf nodes
            # in the tree that referenced them. Hierarchy threshold deliberately
            # keeps assembly group nodes even if their children are gone — it's
            # less surprising than collapsing nulls behind the user's back.
            #
            # The cutoff is a share of the size of the whole model, so the
            # model is measured as assembled. (The product meshes on their own
            # all sit at their own origins: measured that way a large assembly
            # of small parts looked small, and the cutoff came out too low.)
            bbox_min, bbox_max = _assembled_bbox(roots, products)
            model_diag = float(np.linalg.norm(bbox_max - bbox_min)) if np.all(np.isfinite(bbox_min)) else 0.0
            cutoff = (CFG.min_size_pct / 100.0) * model_diag
            dropped = set()
            for key, prod in products.items():
                max_diag = max((bbox_diag(v) for v, _ in prod.meshes), default=0.0)
                if max_diag < cutoff:
                    dropped.add(key)
            if dropped:
                log(f"size threshold dropped {len(dropped)} products (cutoff {cutoff:.3f})", "warn")
                def prune(node):
                    if node.product_key in dropped: return None
                    node.children = [c for c in (prune(c) for c in node.children) if c is not None]
                    if node.product_key is None and not node.children:
                        return None  # empty group — collapse
                    return node
                roots = [r for r in (prune(r) for r in roots) if r is not None]
                if not roots:
                    raise AllTooSmall()
                # The dropped products go from the products too: the writer puts every product's meshes in the file whether
                # a node uses them or not, so the file stayed as big as before and the triangle count included them.
                products = {k: v for k, v in products.items() if k not in dropped}

        ready = (roots, products, scene_meta)
    except AllTooSmall:
        raise                # the plain reader would only remove them all again
    except NoSolids:
        # The plain reader gets its turn before the file is given up on; it
        # is the one that raises for good when it finds no solid either.
        log("no solid bodies in the XCAF document, trying the plain reader", "warn")
    except Exception as e:
        log(f"XCAF reader failed ({e}), falling back to plain reader (no hierarchy)", "warn")
        traceback.print_exc()
    if ready is not None:
        roots, products, scene_meta = ready
        try:
            _write_levels_hier(roots, products, output_path, scene_meta)
        except NoSolids:
            ready = None          # (nothing to put in the file: the plain reader gets its turn, as before)
            log("no solid bodies in the XCAF document, trying the plain reader", "warn")
    if ready is not None:
        _write_params(input_path, output_path)
        _collect_outputs(output_path)

        in_mb = input_path.stat().st_size / 1048576
        out_mb = output_path.stat().st_size / 1048576
        ratio = in_mb / out_mb if out_mb else 1
        print()
        print(f"  done in {time.time() - t_total:.1f}s  {in_mb:.1f} MB -> {out_mb:.1f} MB ({ratio:.1f}x smaller)")
        print()
        return
    scene_meta = {}
    shape = _read_plain_shape(input_path)
    tessellate(shape, linear_deflection=CFG.quality, angular_deflection=CFG.angular, relative=CFG.relative)
    # Bodies without colour or name -- flat output
    solid_meta = _plain_bodies(shape)
    return _finish_convert(input_path, output_path, solid_meta, scene_meta, t_total)


def gltfpack_postprocess(glb_path: Path, meshopt: bool, quantize: bool,
                         simplify: float = 0.0) -> None:
    """Optional industry-standard compression via the `gltfpack` CLI.

    EXT_meshopt_compression is the modern replacement for Draco (faster decode,
    better ratio with brotli). KHR_mesh_quantization halves attribute byte size
    by storing positions/normals/UVs as int16 instead of float32. gltfpack
    quantizes unless told not to (-noq), so that flag is passed whenever
    `quantize` is off: positions then stay the floats the converter wrote.

    gltfpack also merges nodes and materials and drops extras by default. The
    app builds its tree from the node names and reads the scene's extras, so
    -kn (keep named nodes), -km (keep named materials) and -ke (keep extras)
    are always passed.

    Optional simplification (`-si <ratio>`) runs meshoptimizer's quadric-error
    decimator with feature-edge preservation BEFORE compression, so holes,
    chamfers, fillets keep sharp. ratio is the fraction of triangles to keep
    (0.5 → halve). Lossy.

    Both extensions are read by GLTFLoader if MeshoptDecoder is registered on
    the loader (the web app does this when available).
    """
    if not (meshopt or quantize or simplify > 0):
        return
    gltfpack = shutil.which("gltfpack")
    if not gltfpack:
        log("gltfpack not on PATH — skipping meshopt/quantize/simplify. Install with: npm i -g gltfpack", "warn")
        return
    flags = ["-kn", "-km", "-ke"]        # keep node names, material names, extras
    if quantize: flags.append("-cc")     # quantized attributes + meshopt, the higher compression level
    elif meshopt: flags.append("-c")     # meshopt compression
    if not quantize: flags.append("-noq")   # ... and no quantization unless it was asked for
    if simplify > 0:
        # Clamp to (0, 1]. 1.0 is technically a no-op and gltfpack treats it
        # that way, but values >1 would be a config error and gltfpack rejects them.
        ratio = min(1.0, max(0.01, simplify))
        flags += ["-si", f"{ratio:.3f}"]
    tmp = glb_path.with_suffix(".tmp.glb")
    # Prefix file args with ./ when the path begins with '-' so gltfpack can't
    # interpret a leading-dash filename as another flag.
    def _safe(p: str) -> str:
        return f"./{p}" if p.startswith("-") else p
    cmd = [gltfpack, "-i", _safe(str(glb_path)), "-o", _safe(str(tmp)), *flags]
    log(f"gltfpack: {' '.join(flags)} {glb_path.name}")
    t0 = time.time()
    rc = subprocess.call(cmd)
    if rc != 0:
        log(f"gltfpack failed (rc={rc}); keeping uncompressed GLB", "warn")
        try: tmp.unlink(missing_ok=True)
        except Exception: pass
        return
    in_mb = glb_path.stat().st_size / 1048576
    out_mb = tmp.stat().st_size / 1048576
    ratio = in_mb / out_mb if out_mb else 1
    shutil.move(str(tmp), str(glb_path))
    log(f"gltfpack {in_mb:.1f} → {out_mb:.1f} MB ({ratio:.1f}x smaller) in {time.time()-t0:.1f}s", "ok")


# ─── Parallel mesh extraction via multiprocessing.
# Each worker loads the same compound BREP file (which already carries the
# tessellation) and extracts its assigned slice of solids. This sidesteps the
# per-vertex Python loop bottleneck by running multiple Pythons.

def _worker_extract(args):
    """Worker process: load compound BREP, extract assigned solids' meshes."""
    brep_path, indices = args
    # (the rest of what this needs is imported at the top of the module, which
    # a worker process loads like any other)
    from OCP.BRepTools import BRepTools
    from OCP.BRep import BRep_Builder
    shape = TopoDS_Shape()
    BRepTools.Read_s(shape, brep_path, BRep_Builder())
    solids = []
    exp = TopExp_Explorer(shape, TopAbs_SOLID)
    while exp.More():
        solids.append(exp.Current())
        exp.Next()
    out = {}
    for i in indices:
        if 0 <= i < len(solids):
            try:
                r = solid_to_mesh(solids[i])
                out[i] = r if r is None else (r[0], r[1], _normals_of(r[0]))
            except Exception:
                out[i] = None
    return out


def parallel_extract_meshes(solid_meta, num_workers):
    """Distribute solid_to_mesh across `num_workers` processes.
    Returns list aligned with solid_meta: [(verts, tris) or None, ...]."""
    from concurrent.futures import ProcessPoolExecutor
    from OCP.TopoDS import TopoDS_Compound
    from OCP.BRep import BRep_Builder
    from OCP.BRepTools import BRepTools

    # Serialize all solids into one compound BREP file (includes tessellation)
    log(f"serializing {len(solid_meta)} solids to BREP for {num_workers} workers...")
    t0 = time.time()
    compound = TopoDS_Compound()
    builder = BRep_Builder()
    builder.MakeCompound(compound)
    for entry in solid_meta:
        builder.Add(compound, entry["shape"])
    fd, brep_path = tempfile.mkstemp(suffix=".brep", prefix="step2glb_")
    os.close(fd)
    BRepTools.Write_s(compound, brep_path)
    brep_size = os.path.getsize(brep_path) / 1048576
    log(f"BREP serialized ({brep_size:.1f} MB) in {time.time() - t0:.1f}s", "ok")

    # Round-robin index distribution so workers get even-sized chunks
    n = len(solid_meta)
    chunks = [list(range(i, n, num_workers)) for i in range(num_workers)]

    log(f"extracting in parallel across {num_workers} workers...")
    t0 = time.time()
    results = [None] * n
    try:
        with ProcessPoolExecutor(max_workers=num_workers) as pool:
            futures = [pool.submit(_worker_extract, (brep_path, chunk)) for chunk in chunks]
            done = 0
            for fut in futures:
                chunk_result = fut.result()
                for i, mesh in chunk_result.items():
                    if mesh is not None:
                        v, tr, nr = mesh
                        if nr is not None: _NORMALS[id(v)] = (v, nr)
                        mesh = (v, tr)
                    results[i] = mesh
                done += 1
                log(f"worker {done}/{num_workers} returned {len(chunk_result)} meshes")
    finally:
        try: os.unlink(brep_path)
        except Exception: pass
    log(f"parallel extraction done in {time.time() - t0:.1f}s", "ok")
    return results


# ─── Meshing and extraction of the XCAF path in worker processes.
# OCCT's mesher runs its faces on threads, but on a real assembly it reached about 1.4 cores of 24 (the V8 engine STEP: 8.8 s
# against 17.6 s on one), and the extraction is Python, which holds the GIL (so do OCP's calls: Python threads gain nothing).
# So the unique bodies are written to a few binary B-rep files and each worker process meshes its share and returns the arrays.
# Every body is meshed with exactly the passes tessellate() would give it (the whole model at the deflection, then the small
# parts again, or the size groups coarse to fine), so the GLB is the same; where that can not be promised, nothing is done here
# and the caller meshes in its own process as before.

_MESH_JOBS_MIN_FACES = 5000      # under this many CAD faces starting the processes costs more than it saves (auto only)


def _mesh_jobs_wanted() -> int:
    """How many worker processes parallel_mesh_products() may use: 0 when it must not run at all."""
    if CFG.mesh_jobs in (0, 1) or CFG.brep or CFG.split_colours:
        return 0           # (--brep: the B-rep records point into this process's shapes; split pieces: meshed as their solid)
    if CFG.mesh_jobs > 1:
        return CFG.mesh_jobs
    return max(2, min(8, (os.cpu_count() or 2) // 2))


def _compound_of(shapes):
    from OCP.TopoDS import TopoDS_Compound
    comp = TopoDS_Compound(); b = BRep_Builder(); b.MakeCompound(comp)
    for sh in shapes:
        b.Add(comp, sh)
    return comp


def _worker_mesh_extract(args):
    """Worker process: read one share of the bodies, mesh them with their passes, return (verts, tris, normals, runs) each."""
    path, cfg, specs = args
    global _MESH_IN_PARALLEL
    os.environ["STEP2GLB_NO_HEARTBEAT"] = "1"
    for k, v in cfg.items():
        setattr(CFG, k, v)
    _MESH_IN_PARALLEL = False
    RESULT.clear(); _NORMALS.clear(); _GROUPS.clear()
    from OCP.BinTools import BinTools
    from OCP.TopoDS import TopoDS_Iterator
    from OCP.TopTools import TopTools_IndexedMapOfShape
    shape = TopoDS_Shape()
    BinTools.Read_s(shape, path)
    bodies = []
    it = TopoDS_Iterator(shape)
    while it.More():
        bodies.append(it.Value()); it.Next()
    if len(bodies) != len(specs):
        raise RuntimeError(f"{len(bodies)} bodies read back, {len(specs)} expected")
    t0 = time.time()
    if CFG.tiers:
        # as tessellate(): a group a size, coarse first, so a body in two groups ends with the finer mesh
        for name in sorted(("small", "medium", "large"), key=lambda k: -CFG.tiers[k][0]):
            group = [b for b, sp in zip(bodies, specs) if name in sp["tiers"]]
            if group:
                lin, ang = CFG.tiers[name]
                _mesh_shape(_compound_of(group), lin, ang, CFG.relative)
    else:
        _mesh_shape(shape, CFG.quality, CFG.angular, CFG.relative)
        for b, sp in zip(bodies, specs):
            for lin in sp["refine"]:             # (as _refine_small_solids(): once a copy, in the order of the copies)
                _mesh_shape(b, lin, CFG.angular, False)
    t_mesh = time.time() - t0
    out = []
    for b, sp in zip(bodies, specs):
        fc = None
        if sp["fc"]:
            fmap = TopTools_IndexedMapOfShape()
            TopExp.MapShapes_s(b, TopAbs_FACE, fmap)
            idxs, keys = sp["fc"]
            fc = ([fmap.FindKey(i) for i in idxs], keys)
        r = solid_to_mesh(b, fc)
        if r is None:
            out.append(None); continue
        v, t = r
        n = _NORMALS.get(id(v)); g = _GROUPS.get(id(v))
        out.append((v, t, n[1] if n is not None and n[0] is v else None, g[1] if g is not None and g[0] is v else None))
    return out, dict(RESULT), t_mesh, time.time() - t0 - t_mesh


def _merge_result(part: dict) -> None:
    """A worker's RESULT counts into this process's."""
    for k, v in part.items():
        if k == "mesher_status":
            RESULT[k] = RESULT.get(k, 0) | v
        elif isinstance(v, dict):
            d = RESULT.setdefault(k, {})
            for k2, v2 in v.items():
                d[k2] = d.get(k2, 0) + v2
        elif isinstance(v, (int, float)) and not isinstance(v, bool):
            RESULT[k] = RESULT.get(k, 0) + v
        else:
            RESULT[k] = v


def parallel_mesh_products(comp, products: dict) -> bool:
    """Mesh and extract every unique body of `products` in worker processes and fill prod.meshes, as tessellate(comp) followed
    by extract_product_meshes(products) would. `comp` is the assembled model (the copies of each solid, placed), which says
    which passes each body gets. Returns False, having changed nothing, when this path does not apply or fails."""
    jobs = _mesh_jobs_wanted()
    if not jobs:
        return False
    from OCP.TopTools import TopTools_IndexedMapOfShape
    from OCP.TopLoc import TopLoc_Location
    from OCP.BinTools import BinTools
    t0 = time.time()

    # the unique bodies, in product order (the first product with a body decides its colour runs, as in extract_product_meshes)
    bmap = TopTools_IndexedMapOfShape()
    body_of: dict = {}             # (map index, orientation) -> body number
    bodies: list = []              # [shape, face colours, faces]
    uses: list = []                # per product: its body numbers, in order
    n_faces = 0
    for prod in products.values():
        nums = []
        for si, solid in enumerate(prod.solids):
            key = (bmap.Add(solid), int(solid.Orientation()))
            if key not in body_of:
                fc = prod.face_colours[si] if prod.face_colours and si < len(prod.face_colours) else None
                nf = 0
                exp = TopExp_Explorer(solid, TopAbs_FACE)
                while exp.More():
                    nf += 1; exp.Next()
                body_of[key] = len(bodies)
                bodies.append([solid, fc, nf])
                n_faces += nf
            nums.append(body_of[key])
        uses.append(nums)
    if not bodies or (CFG.mesh_jobs < 0 and n_faces < _MESH_JOBS_MIN_FACES):
        return False

    # the passes of each body, from its copies in the model (what tessellate() and _refine_small_solids() measure)
    smap = TopTools_IndexedMapOfShape()       # solids without their placement: one entry per solid, however often it is placed
    refine: dict = {}                          # solid -> deflections it is meshed again at, in the order of its copies
    tiers_of: dict = {}                        # solid -> the size groups its copies fall in
    refining = not CFG.tiers and CFG.size_cap > 0 and not CFG.relative
    if CFG.tiers:
        model = _shape_diag(comp)
        lo, hi = (model * CFG.tiers["split"][0] / 100.0, model * CFG.tiers["split"][1] / 100.0)
    if refining or CFG.tiers:
        exp = TopExp_Explorer(comp, TopAbs_SOLID)
        while exp.More():
            occ = exp.Current(); exp.Next()
            i = smap.Add(occ.Located(TopLoc_Location()))
            if refining:
                lin = max(CFG.quality * 0.1, CFG.size_cap * _shape_diag(occ))
                if 0 < lin < CFG.quality * 0.999:
                    refine.setdefault(i, []).append(lin)
            else:
                d = _shape_diag(occ)
                tiers_of.setdefault(i, set()).add("small" if d < lo else ("large" if d >= hi else "medium"))
    specs = []
    for solid, fc, _nf in bodies:
        sp = {"refine": [], "tiers": ["medium"], "fc": None}
        if solid.ShapeType() == TopAbs_SOLID and (refining or CFG.tiers):
            i = smap.FindIndex(solid.Located(TopLoc_Location()))
            if i == 0:
                log("a body is not among the solids of the model; meshing in this process", "warn")
                return False
            sp["refine"] = refine.get(i, [])
            sp["tiers"] = sorted(tiers_of.get(i, ()))
        if fc:
            fmap = TopTools_IndexedMapOfShape()
            TopExp.MapShapes_s(solid, TopAbs_FACE, fmap)
            idxs = [fmap.FindIndex(f) for f in fc[0]]
            if 0 in idxs:
                log("a coloured face is not found in its body; meshing in this process", "warn")
                return False
            sp["fc"] = (idxs, list(fc[1]))
        specs.append(sp)

    # shares: largest bodies first, each to the share with the fewest faces; surface bodies (not solids) all in the first share,
    # so the edges they share are meshed together as in one run
    n_chunks = min(len(bodies), jobs * 3)
    chunks = [[] for _ in range(n_chunks)]
    load = [0] * n_chunks
    order = sorted(range(len(bodies)), key=lambda k: (bodies[k][0].ShapeType() == TopAbs_SOLID, -bodies[k][2]))
    for k in order:
        c = 0 if bodies[k][0].ShapeType() != TopAbs_SOLID else min(range(n_chunks), key=lambda j: load[j])
        chunks[c].append(k); load[c] += bodies[k][2]
    chunks = [c for c in chunks if c]
    n_refined = sum(len(v) for v in refine.values())

    mode = "relative" if CFG.relative else "absolute"
    log(f"tessellating and extracting {len(bodies)} unique bodies ({n_faces} faces) in {min(jobs, len(chunks))} parallel "
        f"processes (linear={CFG.quality} {mode}, angular={CFG.angular})")
    if n_refined:
        log(f"   {n_refined} small solid{'s' if n_refined != 1 else ''} meshed finer (at most {CFG.size_cap * 100:g} % of their size)")
    cfg = {k: getattr(CFG, k) for k in Config.__dataclass_fields__}
    tmp = tempfile.mkdtemp(prefix="step2glb_mesh_")
    results: list = [None] * len(bodies)
    parts: list = []
    try:
        from concurrent.futures import ProcessPoolExecutor, as_completed
        t_write = time.time()
        jobs_args = []
        for ci, ch in enumerate(chunks):
            path = os.path.join(tmp, f"share{ci}.bin")
            BinTools.Write_s(_compound_of([bodies[k][0] for k in ch]), path)
            jobs_args.append((path, cfg, [specs[k] for k in ch]))
        log(f"   bodies written for the processes in {time.time() - t_write:.1f}s")
        t_mesh = t_extract = 0.0
        with Heartbeat("tessellation + extraction"), ProcessPoolExecutor(max_workers=min(jobs, len(chunks))) as pool:
            futs = {pool.submit(_worker_mesh_extract, a): ci for ci, a in enumerate(jobs_args)}
            done = 0
            for fut in as_completed(futs):
                out, res, tm, te = fut.result()
                parts.append(res); t_mesh += tm; t_extract += te
                for k, r in zip(chunks[futs[fut]], out):
                    results[k] = r
                done += 1
                if done % max(1, len(chunks) // 4) == 0 or done == len(chunks):
                    log(f"   {done}/{len(chunks)} shares meshed and extracted")
    except Exception as e:
        log(f"parallel tessellation failed ({e!r}); meshing in this process", "warn")
        return False
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    for res in parts:
        _merge_result(res)
    meshes = []
    skipped = 0
    for r in results:
        if r is None:
            meshes.append(None); continue
        v, t, n, runs = r
        if n is not None: _NORMALS[id(v)] = (v, n)
        if runs: _GROUPS[id(v)] = (v, runs)
        meshes.append((v, t))
    total = 0
    for prod, nums in zip(products.values(), uses):
        prod.meshes = []
        for k in nums:
            if meshes[k] is None:
                skipped += 1
            else:
                prod.meshes.append(meshes[k])
        total += len(prod.meshes)
    log(f"tessellated and extracted in {time.time() - t0:.1f}s (in the processes: mesher {t_mesh:.1f}s, extraction "
        f"{t_extract:.1f}s together)", "ok")
    _log_grid()
    log(f"extracted {total} solid meshes across {len(products)} unique products"
        + (f" ({skipped} empty solids skipped)" if skipped else ""), "ok")
    return True


def _finish_convert(input_path, output_path, solid_meta, scene_meta, t_total):
    # Extract meshes (optionally in parallel) + run PCA + collect validation properties
    log("extracting meshes + computing canonical pose for instance detection")
    t0 = time.time()
    parts = []
    skipped = 0

    # Parallel path if CFG.parallel > 1 (and big enough for the BREP overhead)
    extracted = None
    if CFG.parallel > 1 and len(solid_meta) > 100:
        try:
            extracted = parallel_extract_meshes(solid_meta, CFG.parallel)
        except Exception as e:
            log(f"parallel extraction failed ({e}), falling back to sequential", "warn")
            extracted = None

    n_total = len(solid_meta)
    log_every = max(50, n_total // 20)  # ~20 progress lines for any input size
    with Heartbeat("mesh extraction"):
        for idx, entry in enumerate(solid_meta):
            if extracted is not None:
                result = extracted[idx]
            else:
                result = solid_to_mesh(entry["shape"])
            if result is None: skipped += 1; continue
            verts, tris = result
            if CFG.pca_instances:
                canonical, world_from_can = pca_canonical(verts)
            else:
                # Safe default: no PCA → no rotation bugs. Hash uses raw vertices,
                # so instancing only fires when two parts truly coincide in world space.
                canonical, world_from_can = verts, np.eye(4, dtype=np.float64)
            # Volume+area are expensive (separate BRepGProp pass per solid). Skip
            # unless caller explicitly wants them — usually only used in the
            # Properties panel, easy to compute on demand later from the mesh.
            if CFG.with_props:
                vol, area = solid_volume_area(entry["shape"])
            else:
                vol, area = 0.0, 0.0
            parts.append({
                "name": entry["name"],
                "verts": verts, "tris": tris,
                "canonical": canonical, "transform": world_from_can,
                "hash": hash_canonical(canonical, tris),
                "color": entry.get("color"),
                "volume": vol, "area": area,
                "diag": bbox_diag(verts),
                "brep": (lambda h: h[1] if h is not None and h[0] is verts else None)(_BREP.get(id(verts)) if CFG.brep else None),
            })
            # Periodic progress for huge files (was silent during extraction)
            if (idx + 1) % log_every == 0:
                pct = (idx + 1) * 100.0 / max(1, n_total)
                log(f"extracted {idx + 1}/{n_total} ({pct:.0f}%)")
    log(f"extracted {len(parts)} meshes in {time.time() - t0:.1f}s"
        + (f", {skipped} skipped (empty)" if skipped else ""), "ok")

    # No solid came out of the file at all: nothing is written, and the run
    # ends with an error instead of a quiet "done" and no GLB.
    if not parts:
        raise NoSolids()

    RESULT["tris_in"] = sum(len(p["tris"]) for p in parts)
    if CFG.min_size_pct > 0:
        # Streaming bbox: avoids np.vstack(all parts) which on 100k-part assemblies
        # could allocate gigabytes. min/max accumulators per axis are O(n) memory
        # in part count, not in total vertices.
        bbox_min = np.full(3,  np.inf, dtype=np.float64)
        bbox_max = np.full(3, -np.inf, dtype=np.float64)
        for p in parts:
            v = p["verts"]
            if len(v) == 0: continue
            np.minimum(bbox_min, v.min(axis=0), out=bbox_min)
            np.maximum(bbox_max, v.max(axis=0), out=bbox_max)
        model_diag = float(np.linalg.norm(bbox_max - bbox_min)) if np.all(np.isfinite(bbox_min)) else 0.0
        cutoff = (CFG.min_size_pct / 100.0) * model_diag
        before = len(parts)
        parts = [p for p in parts if p["diag"] >= cutoff]
        log(f"size threshold removed {before - len(parts)} parts (cutoff {cutoff:.3f})", "warn")

    if not parts:
        raise AllTooSmall()

    total_tris = sum(len(p["tris"]) for p in parts)
    total_verts = sum(len(p["verts"]) for p in parts)
    n_colored = sum(1 for p in parts if p.get("color") is not None)
    log(f"total: {total_verts:,} verts, {total_tris:,} tris, {n_colored}/{len(parts)} colored")
    RESULT["parts"] = len(parts)
    RESULT["unique_products"] = len({p["hash"] for p in parts})
    # Writes the GLB (and the other LOD levels), then the optional gltfpack
    # post-processing for ~10x smaller files.
    _write_levels_flat(parts, output_path, scene_meta)

    # The same record the XCAF path writes, so this output is found in the
    # cache again, and is made again when the settings change.
    _write_params(input_path, output_path)
    _collect_outputs(output_path)

    in_mb = input_path.stat().st_size / 1048576
    out_mb = output_path.stat().st_size / 1048576
    ratio = in_mb / out_mb if out_mb else 1
    print()
    print(f"  done in {time.time() - t_total:.1f}s  {in_mb:.1f} MB -> {out_mb:.1f} MB ({ratio:.1f}x smaller)")
    print()


def _child_flags(ap, args, skip) -> list:
    """The options of this run as command-line flags for one file's process:
    every option that differs from its default, except the batch-only ones."""
    out = []
    for act in ap._actions:
        if not act.option_strings or act.dest in skip or isinstance(act, argparse._HelpAction):
            continue
        val = getattr(args, act.dest, None)
        if val is None or val == act.default:
            continue
        flag = ([o for o in act.option_strings if o.startswith("--")] or act.option_strings)[-1]
        if isinstance(act, argparse._StoreTrueAction):
            out.append(flag)
        else:
            out += [flag, str(val)]
    return out


def _kill_tree(proc) -> None:
    """Stop a converter process and what it started."""
    try:
        if os.name == "nt":
            subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                           capture_output=True)
        else:
            import signal
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
    except Exception:
        try: proc.kill()
        except Exception: pass


def _last_problem(log_text: str) -> str:
    """The converter's last error line (marked with the cross), else its last line."""
    lines = [l.strip() for l in log_text.splitlines() if l.strip()]
    for l in reversed(lines):
        if l.startswith("\u2717"):
            return l.lstrip("\u2717").strip()
    return lines[-1] if lines else ""


def run_batch(ap, args) -> int:
    """--batch DIR: convert every CAD file of a folder, each in a process of
    its own (OpenCascade can crash on a damaged file; that must not take the
    run with it), print a table and write batch-report.csv."""
    root = args.batch
    if not root.is_dir():
        log(f"--batch: {root} is not a folder", "err")
        return 1
    it = root.rglob("*") if args.recursive else root.iterdir()
    files = sorted(p for p in it if p.is_file() and p.suffix.lower() in SUPPORTED_EXTS)
    out_root = args.out
    if out_root is not None:
        out_root.mkdir(parents=True, exist_ok=True)
    report_dir = out_root if out_root is not None else root
    if not files:
        log(f"no {' '.join(SUPPORTED_EXTS)} files in {root}" + (" (or below it)" if args.recursive else ""), "err")
        return 1

    skip = {"input", "out", "batch", "recursive", "file_timeout", "summary_json"}
    flags = _child_flags(ap, args, skip)
    me = str(Path(__file__).resolve())
    env = dict(os.environ, STEP2GLB_NO_HEARTBEAT="1", PYTHONIOENCODING="utf-8")

    def out_for(f: Path, claimed: set) -> Path:
        base = (out_root / f.relative_to(root).parent) if out_root is not None else f.parent
        base.mkdir(parents=True, exist_ok=True)
        cand = base / (f.stem + ".glb")
        if cand in claimed:               # part.step and part.iges side by side
            cand = base / f"{f.stem}_{f.suffix.lstrip('.').lower()}.glb"
        n = 2
        while cand in claimed:
            cand = base / f"{f.stem}_{n}.glb"; n += 1
        claimed.add(cand)
        return cand

    width = max(len(str(f.relative_to(root))) for f in files)
    width = min(max(width, 4), 48)
    head = (f"{'file':<{width}}  {'parts':>6}  {'tris in':>10}  {'tris out':>10}  "
            f"{'size':>9}  {'sec':>6}  status")
    print()
    print(f"  batch: {len(files)} file(s) from {root}" + (" (recursive)" if args.recursive else ""))
    print(f"  options: {' '.join(flags) if flags else '(defaults)'}")
    print()
    print("  " + head)
    print("  " + "-" * len(head))

    rows = []
    claimed: set = set()
    tmp = Path(tempfile.mkdtemp(prefix="step2glb_batch_"))
    try:
        for n, f in enumerate(files, 1):
            out = out_for(f, claimed)
            summ = tmp / f"{n}.json"
            logf = tmp / f"{n}.log"
            cmd = [sys.executable, "-u", me, str(f), "--out", str(out),
                   "--summary-json", str(summ), *flags]
            t0 = time.time()
            status, rc = "failed", None
            with open(logf, "wb") as lf:
                proc = subprocess.Popen(cmd, stdout=lf, stderr=subprocess.STDOUT, env=env,
                                        start_new_session=(os.name != "nt"))
                try:
                    rc = proc.wait(timeout=args.file_timeout or None)
                except subprocess.TimeoutExpired:
                    _kill_tree(proc)
                    proc.wait()
                    rc = "timeout"
            secs = time.time() - t0
            text = logf.read_text(encoding="utf-8", errors="replace") if logf.exists() else ""
            info = {}
            if summ.exists():
                try: info = json.loads(summ.read_text(encoding="utf-8"))
                except Exception: info = {}
            message = ""
            if rc == 0:
                status = "cached" if info.get("cached") else "ok"
            elif rc == "timeout":
                status, message = "timeout", f"no result after {args.file_timeout:g} s"
            elif rc == 3:
                status, message = "no geometry", _last_problem(text)
            elif rc == 1:
                status, message = "failed", _last_problem(text)
            else:
                status, message = f"crashed ({rc})", _last_problem(text)
            ok = status in ("ok", "cached")
            lods = [lv["file"] for lv in info.get("levels", [])[1:]] if ok else []
            row = {
                "file": str(f.relative_to(root)), "format": info.get("format") or input_kind(f),
                "parts": info.get("parts", ""), "unique_products": info.get("unique_products", ""),
                "triangles_in": info.get("tris_in", ""), "triangles_out": info.get("tris_out", ""),
                "size_mb": info.get("size_mb", "") if ok else "",
                "seconds": round(secs, 2), "status": status,
                "output": str(out) if ok else "", "lod_files": ";".join(lods), "message": message,
            }
            rows.append(row)
            nm = row["file"] if len(row["file"]) <= width else "..." + row["file"][-(width - 3):]
            def num(v): return f"{v:,}" if isinstance(v, int) else "-"
            size = f"{row['size_mb']:.2f} MB" if isinstance(row["size_mb"], (int, float)) else "-"
            print(f"  {nm:<{width}}  {num(row['parts']):>6}  {num(row['triangles_in']):>10}  "
                  f"{num(row['triangles_out']):>10}  {size:>9}  {secs:>6.1f}  {status}"
                  + (f": {message}" if message and not ok else ""), flush=True)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    report = report_dir / "batch-report.csv"
    cols = ["file", "format", "parts", "unique_products", "triangles_in", "triangles_out",
            "size_mb", "seconds", "status", "output", "lod_files", "message"]
    with open(report, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)
    bad = [r for r in rows if r["status"] not in ("ok", "cached")]
    print()
    print(f"  {len(rows) - len(bad)} of {len(rows)} converted"
          + (f", {len(bad)} did not" if bad else "") + f".  Report: {report}")
    print()
    return 1 if bad else 0


def main() -> int:
    ap = argparse.ArgumentParser(description="STEP / IGES / BREP -> optimized GLB")
    ap.add_argument("input", type=Path, nargs="*",
                    help="CAD file(s): " + " ".join(SUPPORTED_EXTS) + ". Not needed with --batch.")
    ap.add_argument("--out", "-o", type=Path,
                    help="Output GLB (one input file), or with --batch the folder the GLBs and "
                         "batch-report.csv go to (default: beside each source file).")
    ap.add_argument("--quality", "-q", type=float, default=0.5,
                    help="Linear deflection. Smaller = finer mesh. Default 0.5 (mm).")
    ap.add_argument("--relative", action="store_true",
                    help="Read --quality as a fraction of each edge's own size (OpenCascade's relative deflection), not a distance.")
    ap.add_argument("--angular", type=float, default=0.5,
                    help="Angular deflection in radians. Default 0.5 (~28.6°).")
    ap.add_argument("--size-cap", type=float, default=0.002,
                    help="A solid's linear deflection at most this share of its own diagonal, so small round parts are not "
                         "left polygonal (default 0.002, 0.2 %%; 0 turns it off; ignored with --relative and --tiers).")
    ap.add_argument("--min-size", type=float, default=0.0)
    ap.add_argument("--tiers", type=str, default=None, metavar="A,B:Ls,As:Lm,Am:Ll,Al",
                    help="Tessellate by part size. A and B are the limits between small / medium / "
                         "large parts in %% of the size of the whole model; then linear,angular "
                         "(mm, degrees) for small, medium and large. "
                         "Example: 5,30:2,60:0.2,30:0.05,10")
    ap.add_argument("--grid", action="store_true",
                    help="Mesh curved faces along their own directions: a fillet in even strips, a curved panel in a grid "
                         "(as Cinema 4D does), not a scatter of triangles.")
    ap.add_argument("--min-edge", type=float, default=0.0,
                    help="Smallest triangle edge the mesher may make, in model units (0 = no limit). "
                         "Stops tiny fillets and threads from filling up with slivers.")
    ap.add_argument("--brep", action="store_true",
                    help="Also write the B-rep beside the GLB (<name>.glb.brep.json and .brep.bin): the CAD faces "
                         "(type, size, which triangles) and the true CAD edges, for the viewer.")
    ap.add_argument("--no-normals", action="store_true",
                    help="Do not write the CAD surface normals (the viewer then shades from the triangles).")
    ap.add_argument("--no-surfaces", action="store_true",
                    help="STEP: leave out the parts that are surfaces only (open shells), keep the solids.")
    ap.add_argument("--swap-yz", action="store_true",
                    help="Turn the model a quarter about X: a Z-up CAD file for a Y-up scene.")
    # Four options below only do something in the plain (non-XCAF) reader:
    # the one --no-colors asks for, and the one a file over 1 GB gets unless
    # --force-colors is given. The XCAF reader takes its instancing from the
    # assembly structure in the file and has no use for them.
    ap.add_argument("--no-instance", action="store_true",
                    help="Do not merge identical solids into instances. Plain (non-XCAF) reader only: "
                         "the XCAF reader takes its instances from the assembly structure of the file.")
    ap.add_argument("--no-colors", action="store_true")
    ap.add_argument("--force-colors", action="store_true")
    ap.add_argument("--pca-instances", action="store_true",
                    help="Experimental aggressive PCA-based instance detection. "
                         "Plain (non-XCAF) reader only.")
    ap.add_argument("--props", action="store_true",
                    help="Compute per-solid volume + surface area (slow on big files). "
                         "Plain (non-XCAF) reader only.")
    ap.add_argument("--force", action="store_true",
                    help="Re-convert even if cached output is newer than source")
    ap.add_argument("--no-xcaf-cache", dest="no_xcaf_cache", action="store_true",
                    help="Neither read nor write the <name>.xcaf-cache.xbf beside the STEP (a file that is converted once)")
    ap.add_argument("--parallel", type=int, default=0,
                    help="Use N worker processes for mesh extraction (default 0 = sequential). "
                         "Plain (non-XCAF) reader only.")
    ap.add_argument("--mesh-jobs", type=int, default=-1,
                    help="Worker processes that mesh and extract the bodies (colour reader). Default: chosen by the size "
                         "of the model (none for a small one); 0 or 1 = in this process.")
    ap.add_argument("--meshopt", action="store_true",
                    help="Apply EXT_meshopt_compression via gltfpack (industry standard, ~10x smaller)")
    ap.add_argument("--no-meshopt", dest="no_meshopt", action="store_true",
                    help="Disable the auto-meshopt-when-gltfpack-on-PATH default")
    ap.add_argument("--quantize", action="store_true",
                    help="Quantize positions/normals/uvs to int16 via gltfpack (KHR_mesh_quantization)")
    ap.add_argument("--simplify", type=float, default=0.0,
                    help="Mesh simplification ratio in (0,1] — fraction of triangles to keep "
                         "(e.g. 0.5 halves triangle count). Uses gltfpack -si with feature-edge "
                         "preservation. Lossy. Implies --meshopt.")
    ap.add_argument("--target-tris", type=int, default=0,
                    help="Auto-tune --quality to land at or under this triangle count. "
                         "Re-runs conversion up to 5 times, scaling deflection between iterations.")
    ap.add_argument("--target-size-mb", type=float, default=0.0,
                    help="Auto-tune --quality to land at or under this output GLB size (MB). "
                         "Combine with --target-tris; whichever budget is tighter wins.")
    # XCAF read-mode toggles (all default ON = current behavior). Disabling
    # them speeds up the slow STEPCAF Transfer pass — SHUO is the biggest win
    # on instanced assemblies; the others are cheaper but stack up.
    ap.add_argument("--no-shuo",      action="store_true",
                    help="Skip Specified Higher-Usage Occurrence override resolution. "
                         "Big speedup on instanced assemblies. Parts are coloured per product: "
                         "per-occurrence colour overrides are not applied, with or without this option.")
    ap.add_argument("--no-layers",    action="store_true", help="Skip CAD layer attributes.")
    ap.add_argument("--no-materials", action="store_true", help="Skip material attributes.")
    ap.add_argument("--split-colours", action="store_true",
                    help="A body whose faces carry several colours becomes a piece a colour (each open along the colour "
                         "seams), not one body with a material a colour.")
    ap.add_argument("--no-step-names",action="store_true",
                    help="Skip product names — parts get generic IDs in the tree.")
    ap.add_argument("--no-step-props",action="store_true",
                    help="Skip validation properties (mass, area). Cheap; safe to disable.")
    ap.add_argument("--no-extras", action="store_true",
                    help="Do not write the CAD metadata (instance/product name, assembly path, "
                         "colour, part number, layers, material, volume/area) into the glTF node extras.")
    ap.add_argument("--lod", type=str, default=None, metavar="100,50,25",
                    help="Levels of detail as percentages of the triangles. The first level is written to "
                         "<name>.glb, the others to <name>_lod1.glb, <name>_lod2.glb ... "
                         "Simplified by gltfpack if it is installed, else by the app's bundled meshoptimizer "
                         "through Node.js. Cannot be combined with --simplify.")
    ap.add_argument("--lod-error", type=float, default=0.01, metavar="E",
                    help="Error limit of the LOD simplifier (Node engine), as a fraction of each mesh's size. "
                         "Default 0.01 (1%%, gltfpack's own default). A level stays above its percentage "
                         "where reaching it would exceed this.")
    ap.add_argument("--batch", type=Path, default=None, metavar="DIR",
                    help="Convert every STEP/IGES/BREP file in DIR with these options, one process per file "
                         "(a file that fails or crashes does not stop the run). Prints a table and writes "
                         "batch-report.csv; exit code 1 if any file failed.")
    ap.add_argument("--recursive", action="store_true", help="With --batch: include sub-folders.")
    ap.add_argument("--file-timeout", type=float, default=0.0, metavar="SECONDS",
                    help="With --batch: give up on a file after this long (default 0 = no limit).")
    ap.add_argument("--summary-json", type=Path, default=None, help=argparse.SUPPRESS)
    args = ap.parse_args()
    if args.batch is None and not args.input:
        ap.error("give a file to convert, or --batch DIR")
    if args.batch is not None and args.input:
        ap.error("--batch takes a folder: do not list files as well")
    if args.batch is None and (args.recursive or args.file_timeout):
        ap.error("--recursive and --file-timeout only go with --batch")
    if args.out and len(args.input) > 1:
        ap.error("--out can only be used with a single input file")

    # Validate ranges — rejecting silly inputs early avoids long OCCT runs that
    # would have produced garbage anyway.
    if not (1e-6 <= args.quality <= 1e3):
        ap.error(f"--quality {args.quality} out of sensible range (1e-6 .. 1000)")
    if not (1e-3 <= args.angular <= 3.14159):
        ap.error(f"--angular {args.angular} out of sensible range (0.001 .. π)")
    if args.mesh_jobs < -1:
        ap.error("--mesh-jobs must be -1 (auto) or more")
    if args.parallel < 0:
        ap.error("--parallel must be >= 0")
    if args.simplify and not (0 < args.simplify <= 1.0):
        ap.error(f"--simplify {args.simplify} out of range (must be in (0, 1])")
    lod_levels = ()
    if args.lod is not None:
        try:
            vals = [float(x) for x in args.lod.replace(" ", "").split(",") if x]
        except ValueError:
            ap.error(f"--lod {args.lod!r}: give percentages like 100,50,25")
        if not vals or len(vals) > 8 or any(not (0 < v <= 100) for v in vals):
            ap.error(f"--lod {args.lod!r}: one to eight percentages, each above 0 and at most 100")
        lod_levels = tuple(sorted(set(vals), reverse=True))
        if args.simplify:
            ap.error("--lod and --simplify both reduce triangles: use one of them")
    if not (0 <= args.lod_error <= 1):
        ap.error("--lod-error must be between 0 and 1")

    # Default meshopt to ON when gltfpack is available — most users want the
    # smaller GLB but never remember to pass --meshopt. --no-meshopt opts out.
    # --simplify implies meshopt regardless (simplify only runs through gltfpack).
    _has_gltfpack = bool(shutil.which("gltfpack"))
    if args.simplify > 0:
        meshopt_resolved = True
    elif args.no_meshopt:
        meshopt_resolved = False
    elif args.meshopt:
        meshopt_resolved = True
    else:
        meshopt_resolved = _has_gltfpack

    tiers = None
    if args.tiers:
        try:
            head, *rest = args.tiers.split(":")
            a, b = (float(x) for x in head.split(","))
            pairs = [tuple(float(x) for x in r.split(",")) for r in rest]
            if len(pairs) != 3 or any(len(pr) != 2 for pr in pairs): raise ValueError
            if not (0 < a < b <= 100): raise ValueError
            for lin, deg in pairs:
                if not (1e-6 <= lin <= 1e3) or not (0.06 <= deg <= 180): raise ValueError
            import math
            tiers = {"split": [a, b]}
            for n, (lin, deg) in zip(("small", "medium", "large"), pairs):
                tiers[n] = [lin, math.radians(deg)]
        except ValueError:
            ap.error("--tiers wants A,B:lin,deg:lin,deg:lin,deg with 0 < A < B <= 100, e.g. 5,30:2,60:0.2,30:0.05,10")
    if not (0.0 <= args.min_edge <= 1e3):
        ap.error(f"--min-edge {args.min_edge} out of range (0 .. 1000)")

    # Populate the module-level config once. Conversion code reads CFG directly.
    global CFG
    CFG = Config(
        quality       = args.quality,
        relative      = bool(args.relative),
        angular       = args.angular,
        size_cap      = max(0.0, args.size_cap),
        min_size_pct  = args.min_size,
        instance      = not args.no_instance,
        pca_instances = bool(args.pca_instances),
        with_props    = bool(args.props),
        parallel      = int(args.parallel) if args.parallel else 0,
        mesh_jobs     = int(args.mesh_jobs),
        colors        = "off" if args.no_colors else ("on" if args.force_colors else "auto"),
        meshopt       = bool(meshopt_resolved),
        quantize      = bool(args.quantize),
        simplify      = float(args.simplify) if args.simplify else 0.0,
        force         = bool(args.force),
        xcaf_cache    = not args.no_xcaf_cache,
        read_shuo      = not args.no_shuo,
        read_layers    = not args.no_layers,
        read_materials = not args.no_materials,
        split_colours  = bool(args.split_colours),
        read_names     = not args.no_step_names,
        read_props     = not args.no_step_props,
        extras         = not args.no_extras,
        lod            = lod_levels,
        lod_error      = float(args.lod_error),
        tiers          = tiers,
        min_edge       = float(args.min_edge),
        grid           = bool(args.grid),
        normals        = not args.no_normals,
        surfaces       = not args.no_surfaces,
        swap_yz        = bool(args.swap_yz),
        brep           = bool(args.brep),
    )
    if any(p < 100 for p in CFG.lod):
        try:
            _lod_engine()
        except RuntimeError as e:
            log(str(e), "err")
            return 1
    if args.batch is not None:
        return run_batch(ap, args)
    if CFG.pca_instances:
        log("PCA instancing ENABLED -- may cause rotation glitches on symmetric parts", "warn")
    if CFG.parallel > 1:
        log(f"parallel mesh extraction: {CFG.parallel} workers", "ok")
    if (CFG.meshopt or CFG.quantize or CFG.simplify > 0) and not _has_gltfpack:
        log("gltfpack not found on PATH — meshopt/quantize/simplify will be skipped. Install: npm i -g gltfpack", "warn")
    elif CFG.meshopt and not args.meshopt and not args.no_meshopt:
        # User didn't explicitly opt in or out; we defaulted them on. Mention it
        # once so the smaller-than-expected output isn't a surprise.
        log("meshopt: ON (default — pass --no-meshopt to disable)", "ok")

    target_tris    = int(args.target_tris) if args.target_tris > 0 else 0
    target_size_mb = float(args.target_size_mb) if args.target_size_mb > 0 else 0.0
    if target_tris or target_size_mb:
        msg = []
        if target_tris:    msg.append(f"≤{target_tris:,} tris")
        if target_size_mb: msg.append(f"≤{target_size_mb:.1f} MB")
        log(f"budget mode: {' + '.join(msg)} (will re-tune --quality up to 5x)", "ok")

    rc = 0
    for in_path in args.input:
        if not in_path.exists():
            log(f"file not found: {in_path}", "err"); rc = 1; continue
        out_path = args.out if args.out else in_path.with_suffix(".glb")
        try:
            if target_tris or target_size_mb:
                _convert_with_budget(in_path, out_path, target_tris, target_size_mb)
            else:
                convert(in_path, out_path)
            if args.summary_json:
                try: args.summary_json.write_text(json.dumps(RESULT), encoding="utf-8")
                except OSError: pass
        except UnsupportedFormat as e:
            log(str(e), "err")
            rc = 1
        except NothingToWrite as e:
            # Not a crash, so no traceback: say what is wrong with the file.
            # 3 lets a caller (serve.py) tell this apart from a failure.
            log(str(e) + (f" ({in_path.name})" if len(args.input) > 1 else ""), "err")
            rc = rc or 3
        except Exception as e:
            log(f"conversion failed: {e}", "err")
            traceback.print_exc()
            rc = 1
    return rc


def _glb_metrics(path: Path) -> tuple[int, float]:
    """Return (triangle_count, size_mb) for a GLB on disk.

    Reads the JSON chunk of the GLB directly and sums primitive accessor
    counts. This works on meshopt-compressed GLBs (which trimesh cannot
    decode) — the indices/POSITION accessor `count` field reflects the
    decoded mesh size regardless of compression. Falls back to trimesh
    only for malformed headers.
    """
    size_mb = path.stat().st_size / 1048576
    tris = 0
    try:
        with path.open("rb") as f:
            magic = f.read(4)
            if magic != b"glTF":
                raise ValueError(f"not a GLB file ({path.name})")
            f.read(8)  # version + total length
            chunk_len = int.from_bytes(f.read(4), "little")
            chunk_type = f.read(4)
            if chunk_type != b"JSON":
                raise ValueError(f"first chunk not JSON ({path.name})")
            payload = f.read(chunk_len)
            gltf = json.loads(payload.decode("utf-8"))
        accessors = gltf.get("accessors", [])
        for mesh in gltf.get("meshes", []):
            for prim in mesh.get("primitives", []):
                # mode 4 = TRIANGLES (default); 5/6 = strip/fan, both N-2 tris
                mode = prim.get("mode", 4)
                idx = prim.get("indices")
                if idx is not None and 0 <= idx < len(accessors):
                    n = accessors[idx].get("count", 0)
                else:
                    pos = prim.get("attributes", {}).get("POSITION")
                    n = accessors[pos].get("count", 0) if pos is not None and 0 <= pos < len(accessors) else 0
                if mode == 4:    tris += n // 3
                elif mode in (5, 6): tris += max(0, n - 2)
                else: tris += n // 3
    except Exception as e:
        log(f"could not parse {path.name} for metrics: {e}", "warn")
        return 0, size_mb
    return tris, size_mb


def _convert_with_budget(in_path: Path, out_path: Path, target_tris: int, target_size_mb: float) -> None:
    """Wrapper around convert() that auto-tunes CFG.quality to hit a budget.

    Strategy: trial-and-iterate with a sqrt scaling step.
        tris ~ 1 / quality²  (linear deflection halved → ~4× tris on smooth surfaces)
        so   quality_new = quality_cur × sqrt(actual / budget)
    A 1.1 safety factor pushes the result slightly under budget so it doesn't
    yo-yo across the line. Capped at 5 iterations — past that the budget is
    likely impossible at the current --angular setting.

    Each iteration after the first sets CFG.force = True so the cache check
    inside convert() doesn't short-circuit the re-run.
    """
    global CFG
    MAX_ITERS = 5
    initial_quality = CFG.quality
    history = []
    for it in range(1, MAX_ITERS + 1):
        log(f"budget pass {it}/{MAX_ITERS}: --quality {CFG.quality:.4f}", "ok")
        if it > 1:
            CFG = _dc_replace(CFG, force=True)
        convert(in_path, out_path)
        if not out_path.exists():
            log("output missing — cannot evaluate budget", "warn"); return
        tris, size_mb = _glb_metrics(out_path)
        history.append((CFG.quality, tris, size_mb))
        log(f"  → {tris:,} tris · {size_mb:.2f} MB", "ok")

        tri_over  = (target_tris    > 0 and tris    > target_tris)
        size_over = (target_size_mb > 0 and size_mb > target_size_mb)
        if not (tri_over or size_over):
            log(f"budget hit in {it} pass{'es' if it > 1 else ''}", "ok")
            return

        # Pick the worst over-shoot ratio across both budgets — that's the one
        # we need to crush to come in under everything.
        ratio = 1.0
        if tri_over and target_tris > 0:
            ratio = max(ratio, tris / target_tris)
        if size_over and target_size_mb > 0:
            ratio = max(ratio, size_mb / target_size_mb)
        # 1.1 safety overshoot so the next pass lands just under budget rather
        # than oscillating around it.
        new_quality = CFG.quality * (ratio ** 0.5) * 1.1
        # Cap absolute deflection at something sane so we don't accidentally
        # fall off the smoothness cliff (where every face becomes one triangle).
        new_quality = min(new_quality, 1e3)
        if abs(new_quality - CFG.quality) / max(CFG.quality, 1e-9) < 0.02:
            log("converged (Δ<2%) but still over budget — increase --angular or relax target", "warn")
            return
        CFG = _dc_replace(CFG, quality=new_quality)
    log(f"budget not hit after {MAX_ITERS} passes (started at q={initial_quality}, ended at q={CFG.quality:.4f})", "warn")


if __name__ == "__main__":
    sys.exit(main())
