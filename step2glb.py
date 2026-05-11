#!/usr/bin/env python3
"""
step2glb.py — Native STEP to optimized GLB converter (Pixyz-style preprocessor).

Features:
  - XCAF-based STEP reader: extracts per-solid colors + names + assembly tree
  - PCA pose-normalized hash: same shape at different positions/rotations is detected
    as instances → one geometry on GPU + per-instance transforms
  - Configurable tessellation quality (absolute or relative to bbox diagonal)
  - Optional size threshold (drop tiny parts during conversion)
  - Writes GLB with PBR materials so the web viewer picks up color groups
  - Optional EXT_meshopt_compression via gltfpack (industry-standard, ~10x smaller)

Usage:
    python step2glb.py input.step
    python step2glb.py input.step --quality 0.2 --min-size 0.5
    python step2glb.py input.step --no-instance     # disable instancing
    python step2glb.py input.step --simplify 0.5    # halve triangle count (lossy)
    python step2glb.py input.step --no-meshopt      # disable auto-meshopt
    python step2glb.py input.step --relative        # quality is fraction of diag

Defaults:
    EXT_meshopt_compression turns on automatically when gltfpack is on PATH.
    Pass --no-meshopt to opt out, or --simplify <r> to additionally decimate.

Requirements:
    pip install cadquery-ocp trimesh numpy
    optional: gltfpack on PATH (https://meshoptimizer.org/gltf/)
"""
from __future__ import annotations
import argparse, hashlib, shutil, subprocess, sys, time
from dataclasses import dataclass
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
    def __init__(self, label: str, every_s: float = 5.0):
        self.label = label; self.every = every_s
        self._proc = None; self._t0 = 0.0
    def __enter__(self):
        import subprocess
        self._t0 = time.time()
        # Inline heartbeat script. -u keeps stdout unbuffered on Windows where
        # the cmd.exe pipe sometimes line-buffers Python output. We deliberately
        # do NOT check parent liveness via os.kill(ppid, 0) — it works on Linux
        # but raises OSError on Windows for signal 0, which silently killed the
        # subprocess after the first tick. Instead we rely on Popen.terminate()
        # in __exit__ to clean up. On a hard parent crash this leaves a brief
        # orphan that prints into a dead console, but that's strictly better
        # than a heartbeat that silently quits after 5 seconds.
        safe_label = self.label.encode("ascii", "replace").decode("ascii")
        code = (
            "import sys, time\n"
            f"EVERY = {float(self.every)}\n"
            f"LABEL = {safe_label!r}\n"
            "n = 0.0\n"
            "try:\n"
            "    while True:\n"
            "        time.sleep(EVERY)\n"
            "        n += EVERY\n"
            "        sys.stdout.write(f'  . ({LABEL}) still working... {n:.0f}s elapsed\\n')\n"
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
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_FACE, TopAbs_SOLID, TopAbs_REVERSED
from OCP.TopLoc import TopLoc_Location
from OCP.TopoDS import TopoDS_Shape, TopoDS
from OCP.TDocStd import TDocStd_Document
from OCP.TCollection import TCollection_ExtendedString
from OCP.XCAFDoc import XCAFDoc_DocumentTool, XCAFDoc_ColorType
from OCP.TDF import TDF_LabelSequence, TDF_Label, TDF_Tool
from OCP.Quantity import Quantity_Color
from OCP.TDataStd import TDataStd_Name
from OCP.TCollection import TCollection_AsciiString


def log(msg: str, kind: str = "") -> None:
    icon = {"ok": "✓", "warn": "!", "err": "✗"}.get(kind, "·")
    print(f"  {icon} {msg}", flush=True)


@dataclass
class Config:
    """All runtime knobs in one place. Replaces the prior globals()-poking pattern."""
    quality: float = 0.5         # linear deflection, mm (or fraction of diag if relative=True)
    relative: bool = False       # interpret quality as fraction of overall bbox diagonal
    angular: float = 0.5         # angular deflection, radians (~28.6 degrees default)
    min_size_pct: float = 0.0    # drop parts whose bbox-diag is < this % of model diag
    instance: bool = True        # collapse identical shapes into glTF refs
    pca_instances: bool = False  # apply PCA pose normalization for hash (rotation-invariant)
    with_props: bool = False     # compute volume + area (slow; needs separate BRepGProp pass)
    parallel: int = 0            # mesh-extraction worker count (0/1 = sequential)
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
    # XCAF read-mode toggles. `Transfer(doc)` time scales with how many of these
    # are enabled — SHUO in particular is expensive on instanced assemblies
    # because per-instance attribute overrides are resolved combinatorially.
    # Defaults match the historical behavior (everything ON) so plain CLI runs
    # don't change shape; the import-settings UI flips these off opportunistically.
    read_shuo: bool = True
    read_layers: bool = True
    read_materials: bool = True
    read_names: bool = True
    read_props: bool = True      # validation properties pass (NOT --props volume/area)


# Module-level Config — set once by main() and read elsewhere. Cleaner than
# poking into globals() but keeps the function-call overhead low.
CFG = Config()


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
    # Cached docs are always written with the full XCAF read set (names, layers,
    # materials, props, SHUO). If the user disabled any of those for this run,
    # a cache hit would silently give them attributes they asked us to skip —
    # so bypass the cache entirely (read AND write) when any mode is off.
    full_read = (CFG.read_shuo and CFG.read_layers and CFG.read_materials
                 and CFG.read_names and CFG.read_props)

    # Cache hit?
    if (full_read and not CFG.force
        and cache_path.exists()
        and cache_path.stat().st_mtime > path.stat().st_mtime):
        cache_mb = cache_path.stat().st_size / 1048576
        log(f"loading cached XCAF doc: {cache_path.name} ({cache_mb:.1f} MB)")
        try:
            t0 = time.time()
            with Heartbeat("XCAF cache load"):
                result = _load_xcaf_cache(cache_path)
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
    from OCP.TCollection import TCollection_ExtendedString

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
    status = app.SaveAs(doc, TCollection_ExtendedString(str(path)))
    # PCDM_StoreStatus enum: 0 == PCDM_SS_OK; non-zero is some failure mode.
    if int(status) != 0:
        raise RuntimeError(f"OCAF SaveAs returned status={status}")


def _load_xcaf_cache(path: Path):
    """Read an OCCT binary OCAF/XCAF file, returning the same 4-tuple as
    parse_step_xcaf so callers don't need to special-case the cached path."""
    from OCP.TDocStd import TDocStd_Document
    from OCP.TCollection import TCollection_ExtendedString
    from OCP.XCAFDoc import XCAFDoc_DocumentTool

    app = _xcaf_app()
    doc = TDocStd_Document(TCollection_ExtendedString("step-doc"))
    status = app.Open(TCollection_ExtendedString(str(path)), doc)
    if int(status) != 0:
        raise RuntimeError(f"OCAF Open returned status={status}")
    shape_tool = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
    color_tool = XCAFDoc_DocumentTool.ColorTool_s(doc.Main())
    free_labels = TDF_LabelSequence()
    shape_tool.GetFreeShapes(free_labels)
    return doc, shape_tool, color_tool, free_labels


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
                        ("SetMaterialMode", CFG.read_materials),
                        ("SetPropsMode",    CFG.read_props),
                        ("SetSHUOMode",     CFG.read_shuo)):
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
    with Heartbeat("XCAF transfer"):
        ok = reader.Transfer(doc)
    if not ok:
        raise RuntimeError("STEPCAF Transfer failed")
    shape_tool = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
    color_tool = XCAFDoc_DocumentTool.ColorTool_s(doc.Main())
    free_labels = TDF_LabelSequence()
    shape_tool.GetFreeShapes(free_labels)
    log(f"parsed in {time.time() - t0:.1f}s, top-level shapes: {free_labels.Length()}", "ok")
    return doc, shape_tool, color_tool, free_labels


def get_label_color(label: TDF_Label, color_tool) -> tuple[float, float, float] | None:
    """Get the RGB color of a shape label, trying surface/generic/curve types in order."""
    c = Quantity_Color()
    for t in (XCAFDoc_ColorType.XCAFDoc_ColorSurf,
              XCAFDoc_ColorType.XCAFDoc_ColorGen,
              XCAFDoc_ColorType.XCAFDoc_ColorCurv):
        try:
            if color_tool.GetColor(label, t, c):
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


def get_label_name(label: TDF_Label) -> str | None:
    """Read the TDataStd_Name attribute from a label."""
    try:
        attr = TDataStd_Name()
        if label.FindAttribute(TDataStd_Name.GetID_s(), attr):
            return attr.Get().ToExtString()
    except Exception:
        pass
    return None


def collect_solids_with_meta(shape_tool, color_tool, free_labels) -> list[dict]:
    """Walk the assembly tree, return [{shape, color, name}, ...] per solid."""
    out = []
    def visit(label, parent_color):
        # Try to read color and name on this label; inherit from parent if absent
        col = get_label_color(label, color_tool) or parent_color
        name = get_label_name(label)
        # Recurse into components
        if shape_tool.IsAssembly_s(label):
            comps = TDF_LabelSequence()
            shape_tool.GetComponents_s(label, comps)
            for i in range(1, comps.Length() + 1):
                ref_label = TDF_Label()
                if shape_tool.GetReferredShape_s(comps.Value(i), ref_label):
                    # Component may override color
                    comp_col = get_label_color(comps.Value(i), color_tool) or col
                    visit(ref_label, comp_col)
            return
        # Leaf: get the shape
        try:
            shape = shape_tool.GetShape_s(label)
        except Exception:
            return
        # Walk solids inside this leaf
        exp = TopExp_Explorer(shape, TopAbs_SOLID)
        idx = 0
        while exp.More():
            solid = exp.Current()
            # Solid-specific color override?
            scol = None
            try:
                slbl = TDF_Label()
                if shape_tool.FindShape_s(solid, slbl):
                    scol = get_label_color(slbl, color_tool)
            except Exception:
                pass
            out.append({
                "shape": solid,
                "color": scol or col,
                "name": (name or "part") + f"_{idx:04d}",
            })
            idx += 1
            exp.Next()

    for i in range(1, free_labels.Length() + 1):
        visit(free_labels.Value(i), None)
    return out


# ── Hierarchical XCAF walker ───────────────────────────────────────────────
# The flat collect_solids_with_meta path drops two pieces of information that
# C4D and other proper STEP importers preserve:
#   1. The assembly hierarchy (NEXT_ASSEMBLY_USAGE_OCCURRENCE structure).
#      That's why our tree shows a flat list while C4D shows nested groups
#      with "Null Object" containers for each assembly node.
#   2. Explicit instancing — when an assembly references the same product
#      multiple times, that's the STEP file telling you "these are instances
#      of one part." The flat path extracts each occurrence as a separate
#      solid, losing the reference-based instancing the file already encodes.
#
# walk_xcaf_tree below preserves both: products are cached by their TDF_Label
# entry (so the same product is extracted exactly once) and the instance tree
# carries each component's local transform from the parent's TopLoc_Location.

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
    color: tuple | None
    children: list         # list[XcafNode]
    product_key: str | None


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


def walk_xcaf_tree(shape_tool, color_tool, free_labels, doc=None):
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
    """
    from OCP.TopLoc import TopLoc_Location
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
        exp = TopExp_Explorer(shape, TopAbs_SOLID)
        while exp.More():
            solid = exp.Current()
            solids.append(solid)
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
            # Final fallback: inherit the product's color.
            solid_colors.append(scol or color)
            exp.Next()
        products[key] = XcafProduct(name=name, color=color, solids=solids,
                                     meshes=[], solid_colors=solid_colors)
        return key

    def visit(label: TDF_Label, location: TopLoc_Location, parent_color):
        # Better default name by context: "Assembly" for nested assemblies,
        # "Part" for leaf products. Was "node" / "part" — too generic to be
        # useful when scanning a tree of 5000 nodes.
        is_asm = shape_tool.IsAssembly_s(label)
        name = get_label_name(label) or ("Assembly" if is_asm else "Part")
        own_color = get_label_color(label, color_tool) or parent_color
        local_t = _trsf_to_4x4(location.Transformation()) if location is not None else np.eye(4)

        if is_asm:
            comps = TDF_LabelSequence()
            shape_tool.GetComponents_s(label, comps)
            kids = []
            for i in range(1, comps.Length() + 1):
                comp = comps.Value(i)
                comp_color = get_label_color(comp, color_tool) or own_color
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
                if shape_tool.IsAssembly_s(ref_label):
                    sub = visit(ref_label, comp_loc, comp_color)
                    if sub is not None:
                        sub.name = comp_name
                        kids.append(sub)
                else:
                    prod_key = get_or_create_product(ref_label)
                    kids.append(XcafNode(
                        name=comp_name,
                        transform=_trsf_to_4x4(comp_loc.Transformation()),
                        color=comp_color,
                        children=[],
                        product_key=prod_key,
                    ))
            return XcafNode(name=name, transform=local_t, color=own_color,
                            children=kids, product_key=None)
        else:
            prod_key = get_or_create_product(label)
            return XcafNode(name=name, transform=local_t, color=own_color,
                            children=[], product_key=prod_key)

    roots: list[XcafNode] = []
    identity = TopLoc_Location()
    for i in range(1, free_labels.Length() + 1):
        n = visit(free_labels.Value(i), identity, None)
        if n is not None:
            roots.append(n)
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
    with Heartbeat("product mesh extraction"):
        for prod in products.values():
            meshes = []
            for solid in prod.solids:
                r = solid_to_mesh(solid)
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
    n_geoms = 0
    n_colored = 0
    for key, prod in products.items():
        sc = prod.solid_colors or []
        for i, (verts, tris) in enumerate(prod.meshes):
            if len(verts) == 0 or len(tris) == 0:
                continue
            mesh = trimesh.Trimesh(vertices=verts, faces=tris, process=False)
            # Per-solid color (NX/CATIA pattern) takes precedence over the
            # product-level fallback. _apply_color handles None → neutral grey.
            mcolor = sc[i] if i < len(sc) else prod.color
            _apply_color(mesh, mcolor)
            if mcolor is not None:
                n_colored += 1
            # Sanitize the entry string ('0:1:1:2' has colons that trimesh's
            # graph naming sometimes mangles when it derives node names).
            short_key = key.replace(":", "_")
            gname = f"prod_{short_key}_{i:03d}"
            scene.geometry[gname] = mesh
            geom_names[(key, i)] = gname
            n_geoms += 1
    log(f"applied colors to {n_colored}/{n_geoms} mesh geometries", "ok" if n_colored else "warn")

    if n_geoms == 0:
        log("no geometry to write — everything was empty", "err")
        return

    # ─── Walk the tree. Track frame uniqueness with a counter so duplicate
    # node names (very common in CAD: "Bolt", "Bolt", "Bolt") don't collide
    # in the graph. The original name is preserved in metadata for the viewer.
    n_nodes = [0]
    n_geom_refs = [0]
    n_product_uses: dict[str, int] = defaultdict(int)
    seen_frames: set = set()

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
        if node.product_key is not None:
            prod = products[node.product_key]
            n_product_uses[node.product_key] += 1
            # Attach each of the product's solids as a child geom-frame. For
            # the common case of a single solid we keep the mesh directly on
            # this frame to avoid an extra empty layer in the tree.
            geom_keys = [(node.product_key, i) for i in range(len(prod.meshes))
                         if (node.product_key, i) in geom_names]
            if len(geom_keys) == 1:
                gname = geom_names[geom_keys[0]]
                scene.graph.update(
                    frame_to=frame + "__geom",
                    frame_from=frame,
                    matrix=np.eye(4),
                    geometry=gname,
                )
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
    try:
        scene.metadata.update(scene_meta)
    except Exception:
        pass

    log(f"scene assembled in {time.time() - t0:.1f}s", "ok")
    log(f"writing GLB: {output}")
    t0 = time.time()
    scene.export(output)
    out_mb = output.stat().st_size / 1048576
    log(f"wrote {out_mb:.2f} MB in {time.time() - t0:.1f}s", "ok")


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


def tessellate(shape: TopoDS_Shape, linear_deflection: float = 0.5,
               angular_deflection: float = 0.5, relative: bool = False) -> None:
    """Tessellate every face on `shape` in place.

    `relative=True` interprets `linear_deflection` as a fraction of each shape's
    own bbox diagonal — gives unit-independent quality (0.001 == 0.1% of diag).
    Default is absolute deflection in model units (typically mm).

    Last argument is parallel=True — OCCT splits faces across threads.
    """
    mode = "relative" if relative else "absolute"
    log(f"tessellating (linear={linear_deflection} {mode}, angular={angular_deflection}, parallel)")
    t0 = time.time()
    with Heartbeat("tessellation"):
        BRepMesh_IncrementalMesh(shape, linear_deflection, relative, angular_deflection, True).Perform()
    log(f"tessellated in {time.time() - t0:.1f}s", "ok")


def _identity_trsf(t) -> bool:
    """gp_Trsf is identity? Cheap check before allocating + matmul."""
    try:
        return (t.Value(1, 1) == 1.0 and t.Value(2, 2) == 1.0 and t.Value(3, 3) == 1.0
                and t.Value(1, 2) == 0.0 and t.Value(1, 3) == 0.0 and t.Value(1, 4) == 0.0
                and t.Value(2, 1) == 0.0 and t.Value(2, 3) == 0.0 and t.Value(2, 4) == 0.0
                and t.Value(3, 1) == 0.0 and t.Value(3, 2) == 0.0 and t.Value(3, 4) == 0.0)
    except Exception:
        return False


def solid_to_mesh(solid: TopoDS_Shape):
    """Walk faces of a solid, return concatenated (vertices, triangles) or None.

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
    offset = 0
    exp = TopExp_Explorer(solid, TopAbs_FACE)
    loc = TopLoc_Location()
    while exp.More():
        face = TopoDS.Face_s(exp.Current())
        tri = BRep_Tool.Triangulation_s(face, loc)
        if tri is None:
            exp.Next(); continue
        n_nodes = tri.NbNodes(); n_tris = tri.NbTriangles()
        if n_nodes == 0 or n_tris == 0:
            exp.Next(); continue

        # ── vertices: list-comp of (X,Y,Z) tuples then a single asarray
        v_local = [(p.X(), p.Y(), p.Z()) for p in (tri.Node(j) for j in range(1, n_nodes + 1))]
        v_arr = np.asarray(v_local, dtype=np.float64)

        # ── apply face transform (gp_Trsf is 3x4). Fast-path identity.
        t = loc.Transformation()
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

        # ── triangles: collect once, vectorize orientation flip + offset
        # Only flip winding for REVERSED faces. Earlier `!= 0` flipped
        # INTERNAL (2) and EXTERNAL (3) faces too, producing back-face
        # artefacts on cellular / boundary faces.
        reverse = (face.Orientation() == TopAbs_REVERSED)
        tris_buf = np.empty((n_tris, 3), dtype=np.uint32)
        for j in range(1, n_tris + 1):
            a, b, c = tri.Triangle(j).Get()
            tris_buf[j - 1, 0] = a - 1
            tris_buf[j - 1, 1] = b - 1
            tris_buf[j - 1, 2] = c - 1
        if reverse:
            tris_buf = tris_buf[:, [1, 0, 2]]
        if offset:
            tris_buf = tris_buf + np.uint32(offset)

        all_verts.append(verts); all_tris.append(tris_buf)
        offset += n_nodes
        exp.Next()
    if not all_verts: return None
    return np.vstack(all_verts), np.vstack(all_tris)


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

    for h, group in groups.items():
        ref = group[0]
        if instance and len(group) > 1:
            # Build ONE mesh in canonical pose, reuse via geom_name across instances
            verts = ref["canonical"]; tris = ref["tris"]
            if len(verts) == 0 or len(tris) == 0: continue
            mesh = trimesh.Trimesh(vertices=verts, faces=tris, process=False)
            _apply_color(mesh, ref.get("color"))
            geom_name = f"shape_{h[:10]}"
            for p in group:
                # Pass the part's world transform — trimesh stores it on the node
                scene.add_geometry(
                    mesh,
                    geom_name=geom_name,
                    node_name=p["name"],
                    transform=p["transform"],
                    metadata=_node_meta(p),
                )
        else:
            # Singletons: bake into world coords (no transform, simplest)
            for p in group:
                if len(p["verts"]) == 0 or len(p["tris"]) == 0: continue
                mesh = trimesh.Trimesh(vertices=p["verts"], faces=p["tris"], process=False)
                _apply_color(mesh, p.get("color"))
                scene.add_geometry(mesh, node_name=p["name"], metadata=_node_meta(p))

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
    use_xcaf = (CFG.colors == "on") or (CFG.colors == "auto" and size_mb <= 1024)

    # ─── cache check: skip conversion if output is newer than input AND the
    # sidecar params match. mtime alone misses the "user re-ran with a tighter
    # --quality but got the stale GLB" footgun.
    import json as _json
    params_path = output_path.with_suffix(output_path.suffix + ".params.json")
    current_params = {
        "quality": CFG.quality,
        "min_size_pct": CFG.min_size_pct,
        "relative": CFG.relative,
        "meshopt": CFG.meshopt,
        "quantize": CFG.quantize,
        "simplify": CFG.simplify,
        "instance": CFG.instance,
        "colors": CFG.colors,
    }
    if not CFG.force and output_path.exists():
        if output_path.stat().st_mtime > input_path.stat().st_mtime:
            cached_params = None
            if params_path.exists():
                try:
                    cached_params = _json.loads(params_path.read_text())
                except Exception:
                    cached_params = None
            if cached_params == current_params:
                out_mb = output_path.stat().st_size / 1048576
                log(f"cached: {output_path.name} ({out_mb:.1f} MB) is newer than source and params match — skipping conversion (use --force to re-convert)", "ok")
                return
            log("cache stale: conversion params changed — re-converting", "warn")

    print()
    print(f"╭─ STEP → GLB")
    print(f"│  input:    {input_path}  ({size_mb:.1f} MB)")
    print(f"│  output:   {output_path}")
    print(f"│  quality:  linear deflection {CFG.quality} ({'relative' if CFG.relative else 'absolute'})")
    print(f"│  min size: {CFG.min_size_pct}% of model" if CFG.min_size_pct > 0 else "│  min size: keep all")
    print(f"│  instance: {CFG.instance}")
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
        log("using fast plain reader (no colors / names / materials)", "warn")
        scene_meta = {}
        reader = STEPControl_Reader()
        with Heartbeat("plain parsing"):
            status = reader.ReadFile(str(input_path))
        if status != IFSelect_RetDone: raise RuntimeError("plain STEP read failed")
        with Heartbeat("plain transfer"):
            reader.TransferRoots()
        shape = reader.OneShape()
        tessellate(shape, linear_deflection=CFG.quality, angular_deflection=CFG.angular, relative=CFG.relative)
        solid_meta = []
        exp = TopExp_Explorer(shape, TopAbs_SOLID); idx = 0
        while exp.More():
            solid_meta.append({"shape": exp.Current(), "color": None, "name": f"solid_{idx:05d}"})
            idx += 1; exp.Next()
        log(f"found {len(solid_meta)} solids", "ok")
        # Jump straight to mesh extraction below
        return _finish_convert(input_path, output_path, solid_meta, scene_meta, t_total)

    # Read with XCAF for colors + names + materials + layers + assembly tree.
    # parse_step_xcaf_cached transparently uses a binary OCAF cache file
    # (next to the STEP, .xcaf-cache.xbf) so re-runs skip the slow ReadFile.
    try:
        doc, shape_tool, color_tool, free_labels = parse_step_xcaf_cached(input_path)
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
        tessellate(comp, linear_deflection=CFG.quality, angular_deflection=CFG.angular, relative=CFG.relative)

        # ── Hierarchical path: walk the XCAF tree, cache products, write GLB
        # with proper parent/child structure and reference-based instancing.
        # This replaces the flat collect_solids_with_meta + flat build_glb path
        # so the assembly hierarchy and explicit STEP instances survive into
        # the GLB (and thence the viewer).
        log("walking XCAF assembly tree...")
        t_walk = time.time()
        products, roots = walk_xcaf_tree(shape_tool, color_tool, free_labels, doc=doc)
        log(f"  → {len(products)} unique products, {len(roots)} top-level roots "
            f"in {time.time()-t_walk:.2f}s", "ok")
        extract_product_meshes(products)

        if CFG.min_size_pct > 0:
            # Apply size threshold AT THE PRODUCT LEVEL — drop products whose
            # largest solid bbox-diag is below cutoff, then prune leaf nodes
            # in the tree that referenced them. Hierarchy threshold deliberately
            # keeps assembly group nodes even if their children are gone — it's
            # less surprising than collapsing nulls behind the user's back.
            bbox_min = np.full(3,  np.inf, dtype=np.float64)
            bbox_max = np.full(3, -np.inf, dtype=np.float64)
            for prod in products.values():
                for verts, _ in prod.meshes:
                    if len(verts) == 0: continue
                    np.minimum(bbox_min, verts.min(axis=0), out=bbox_min)
                    np.maximum(bbox_max, verts.max(axis=0), out=bbox_max)
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

        build_glb_hierarchical(roots, products, output_path, scene_meta, instance=CFG.instance)
        gltfpack_postprocess(output_path, CFG.meshopt, CFG.quantize, CFG.simplify)

        try: params_path.write_text(_json.dumps(current_params))
        except OSError: pass

        in_mb = input_path.stat().st_size / 1048576
        out_mb = output_path.stat().st_size / 1048576
        ratio = in_mb / out_mb if out_mb else 1
        print()
        print(f"  done in {time.time() - t_total:.1f}s  {in_mb:.1f} MB -> {out_mb:.1f} MB ({ratio:.1f}x smaller)")
        print()
        return
    except Exception as e:
        log(f"XCAF reader failed ({e}), falling back to plain reader (no hierarchy)", "warn")
        import traceback; traceback.print_exc()
        scene_meta = {}
        reader = STEPControl_Reader()
        if reader.ReadFile(str(input_path)) != IFSelect_RetDone:
            raise RuntimeError("plain STEP read also failed")
        reader.TransferRoots()
        shape = reader.OneShape()
        tessellate(shape, linear_deflection=CFG.quality, angular_deflection=CFG.angular, relative=CFG.relative)
        # Build solid_meta without color/name — flat output
        solid_meta = []
        exp = TopExp_Explorer(shape, TopAbs_SOLID); idx = 0
        while exp.More():
            solid_meta.append({"shape": exp.Current(), "color": None, "name": f"solid_{idx:05d}"})
            idx += 1; exp.Next()
        return _finish_convert(input_path, output_path, solid_meta, scene_meta, t_total)


def gltfpack_postprocess(glb_path: Path, meshopt: bool, quantize: bool,
                         simplify: float = 0.0) -> None:
    """Optional industry-standard compression via the `gltfpack` CLI.

    EXT_meshopt_compression is the modern replacement for Draco (faster decode,
    better ratio with brotli). KHR_mesh_quantization halves attribute byte size
    by storing positions/normals/UVs as int16 instead of float32.

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
    flags = []
    if quantize: flags.append("-cc")     # combined: quantize + meshopt
    elif meshopt: flags.append("-c")     # meshopt only (no quantization)
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
    # Re-import inside worker — multiprocessing fresh process needs the imports
    from OCP.TopoDS import TopoDS_Shape
    from OCP.BRepTools import BRepTools
    from OCP.BRep import BRep_Builder
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopAbs import TopAbs_SOLID
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
                out[i] = solid_to_mesh(solids[i])
            except Exception as ex:
                out[i] = None
    return out


def parallel_extract_meshes(solid_meta, num_workers):
    """Distribute solid_to_mesh across `num_workers` processes.
    Returns list aligned with solid_meta: [(verts, tris) or None, ...]."""
    import os, tempfile
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
                    results[i] = mesh
                done += 1
                log(f"worker {done}/{num_workers} returned {len(chunk_result)} meshes")
    finally:
        try: os.unlink(brep_path)
        except Exception: pass
    log(f"parallel extraction done in {time.time() - t0:.1f}s", "ok")
    return results


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
            })
            # Periodic progress for huge files (was silent during extraction)
            if (idx + 1) % log_every == 0:
                pct = (idx + 1) * 100.0 / max(1, n_total)
                log(f"extracted {idx + 1}/{n_total} ({pct:.0f}%)")
    log(f"extracted {len(parts)} meshes in {time.time() - t0:.1f}s"
        + (f", {skipped} skipped (empty)" if skipped else ""), "ok")

    if CFG.min_size_pct > 0 and parts:
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
        log("nothing to write", "err"); return

    total_tris = sum(len(p["tris"]) for p in parts)
    total_verts = sum(len(p["verts"]) for p in parts)
    n_colored = sum(1 for p in parts if p.get("color") is not None)
    log(f"total: {total_verts:,} verts, {total_tris:,} tris, {n_colored}/{len(parts)} colored")
    build_glb(parts, output_path, scene_meta, instance=CFG.instance)

    # Optional industry-standard post-processing for ~10x smaller files
    gltfpack_postprocess(output_path, CFG.meshopt, CFG.quantize, CFG.simplify)

    # Mirror the cache sidecar from the XCAF success path so the fallback
    # output also gets re-generated when conversion params change.
    try:
        import json as _json
        params_path = output_path.with_suffix(output_path.suffix + ".params.json")
        params_path.write_text(_json.dumps({
            "quality": CFG.quality, "min_size_pct": CFG.min_size_pct,
            "relative": CFG.relative, "meshopt": CFG.meshopt,
            "quantize": CFG.quantize, "instance": CFG.instance,
            "colors": CFG.colors,
        }))
    except OSError: pass

    in_mb = input_path.stat().st_size / 1048576
    out_mb = output_path.stat().st_size / 1048576
    ratio = in_mb / out_mb if out_mb else 1
    print()
    print(f"  done in {time.time() - t_total:.1f}s  {in_mb:.1f} MB -> {out_mb:.1f} MB ({ratio:.1f}x smaller)")
    print()


def main() -> int:
    ap = argparse.ArgumentParser(description="STEP -> optimized GLB")
    ap.add_argument("input", type=Path, nargs="+")
    ap.add_argument("--out", "-o", type=Path)
    ap.add_argument("--quality", "-q", type=float, default=0.5,
                    help="Linear deflection. Smaller = finer mesh. Default 0.5 (mm).")
    ap.add_argument("--relative", action="store_true",
                    help="Interpret --quality as fraction of bbox diagonal (unit-independent).")
    ap.add_argument("--angular", type=float, default=0.5,
                    help="Angular deflection in radians. Default 0.5 (~28.6°).")
    ap.add_argument("--min-size", type=float, default=0.0)
    ap.add_argument("--no-instance", action="store_true")
    ap.add_argument("--no-colors", action="store_true")
    ap.add_argument("--force-colors", action="store_true")
    ap.add_argument("--pca-instances", action="store_true",
                    help="Experimental aggressive PCA-based instance detection")
    ap.add_argument("--props", action="store_true",
                    help="Compute per-solid volume + surface area (slow on big files)")
    ap.add_argument("--force", action="store_true",
                    help="Re-convert even if cached output is newer than source")
    ap.add_argument("--parallel", type=int, default=0,
                    help="Use N worker processes for mesh extraction (default 0 = sequential)")
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
                         "Big speedup on instanced assemblies; lose per-instance color overrides.")
    ap.add_argument("--no-layers",    action="store_true", help="Skip CAD layer attributes.")
    ap.add_argument("--no-materials", action="store_true", help="Skip material attributes.")
    ap.add_argument("--no-step-names",action="store_true",
                    help="Skip product names — parts get generic IDs in the tree.")
    ap.add_argument("--no-step-props",action="store_true",
                    help="Skip validation properties (mass, area). Cheap; safe to disable.")
    args = ap.parse_args()
    if args.out and len(args.input) > 1:
        ap.error("--out can only be used with a single input file")

    # Validate ranges — rejecting silly inputs early avoids long OCCT runs that
    # would have produced garbage anyway.
    if not (1e-6 <= args.quality <= 1e3):
        ap.error(f"--quality {args.quality} out of sensible range (1e-6 .. 1000)")
    if not (1e-3 <= args.angular <= 3.14159):
        ap.error(f"--angular {args.angular} out of sensible range (0.001 .. π)")
    if args.parallel < 0:
        ap.error("--parallel must be >= 0")
    if args.simplify and not (0 < args.simplify <= 1.0):
        ap.error(f"--simplify {args.simplify} out of range (must be in (0, 1])")

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

    # Populate the module-level config once. Conversion code reads CFG directly.
    global CFG
    CFG = Config(
        quality       = args.quality,
        relative      = bool(args.relative),
        angular       = args.angular,
        min_size_pct  = args.min_size,
        instance      = not args.no_instance,
        pca_instances = bool(args.pca_instances),
        with_props    = bool(args.props),
        parallel      = int(args.parallel) if args.parallel else 0,
        colors        = "off" if args.no_colors else ("on" if args.force_colors else "auto"),
        meshopt       = bool(meshopt_resolved),
        quantize      = bool(args.quantize),
        simplify      = float(args.simplify) if args.simplify else 0.0,
        force         = bool(args.force),
        read_shuo      = not args.no_shuo,
        read_layers    = not args.no_layers,
        read_materials = not args.no_materials,
        read_names     = not args.no_step_names,
        read_props     = not args.no_step_props,
    )
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
        except Exception as e:
            log(f"conversion failed: {e}", "err")
            import traceback; traceback.print_exc()
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
            from dataclasses import replace as _dc_replace
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
        from dataclasses import replace as _dc_replace
        CFG = _dc_replace(CFG, quality=new_quality)
    log(f"budget not hit after {MAX_ITERS} passes (started at q={initial_quality}, ended at q={CFG.quality:.4f})", "warn")


if __name__ == "__main__":
    sys.exit(main())
