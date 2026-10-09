#!/usr/bin/env python3
"""
End-to-end test of the converter (step2glb.py) and of /api/convert (serve.py).

It builds its own models with OpenCascade (a plate with a hole, four bolts that
are one product placed four times, a ball), writes them as STEP, IGES and BREP,
converts them with the real command line, and reads the GLBs back with a small
parser of its own (struct + json + numpy; no trimesh) to check what is in them:

  1. IGES and BREP input   triangles, node names, instancing, colours, the size
                           of the model; clear errors for an unknown extension,
                           a file with nothing to mesh, a damaged file
  2. --batch               table, batch-report.csv, one bad file does not stop
                           the run, exit code, name clashes, --recursive
  3. --lod                 the real triangle count of every level, the same
                           nodes and instances in each, the same size
  4. metadata (extras)     names, path, colour, part number, layers, material,
                           volume; --no-extras; what it costs in bytes; the
                           XCAF cache keeps it
  5. /api/convert          an upload of each format through serve.py

Run it with a Python that has cadquery-ocp, numpy and trimesh (the app's .venv):

    .venv/Scripts/python.exe tests/converter.test.py        (Windows)
    .venv/bin/python tests/converter.test.py                (macOS / Linux)

About a minute. Nothing is written inside the app folder: files go to a
temporary folder that is removed at the end (unless KEEP_TEST_FILES=1).
Needs Node.js for the LOD test (the app's bundled simplifier); without it that
test is skipped and said so.
"""
from __future__ import annotations
import csv, json, os, re, shutil, stat, struct, subprocess, sys, tempfile, threading, time, traceback
import urllib.error, urllib.request
from pathlib import Path

import numpy as np

try:                                      # the converter's log has check marks; Windows consoles are not UTF-8
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

APP = Path(__file__).resolve().parent.parent
STEP2GLB = APP / "step2glb.py"

from OCP.BRep import BRep_Builder
from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder, BRepPrimAPI_MakeSphere
from OCP.BRepTools import BRepTools
from OCP.BinXCAFDrivers import BinXCAFDrivers
from OCP.IGESCAFControl import IGESCAFControl_Writer
from OCP.IGESControl import IGESControl_Writer
from OCP.Quantity import Quantity_Color, Quantity_TOC_RGB
from OCP.STEPCAFControl import STEPCAFControl_Writer
from OCP.STEPControl import STEPControl_AsIs, STEPControl_Writer
from OCP.TCollection import TCollection_ExtendedString, TCollection_HAsciiString
from OCP.TDF import TDF_LabelSequence
from OCP.TDataStd import TDataStd_Name
from OCP.TDocStd import TDocStd_Document
from OCP.TopLoc import TopLoc_Location
from OCP.TopoDS import TopoDS_Compound
from OCP.XCAFApp import XCAFApp_Application
from OCP.XCAFDoc import XCAFDoc_Area, XCAFDoc_ColorType, XCAFDoc_DocumentTool, XCAFDoc_Volume
from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt, gp_Trsf, gp_Vec

# Where the test model sits (mm): plate 100 x 60 x 10, bolts up to z = 39, ball up to z = 55.
EXPECT_MIN = np.array([0.0, 0.0, 0.0])
EXPECT_MAX = np.array([100.0, 60.0, 55.0])
FINE = ["--quality", "0.05", "--angular", "0.1"]     # fine tessellation: plenty to simplify


# ─── building the models ───────────────────────────────────────────────────
def _name(label, text):
    TDataStd_Name.Set_s(label, TCollection_ExtendedString(text))


def _find_label(shape_tool, text):
    labels = TDF_LabelSequence()
    shape_tool.GetShapes(labels)
    for i in range(1, labels.Length() + 1):
        a = TDataStd_Name()
        if labels.Value(i).FindAttribute(TDataStd_Name.GetID_s(), a) and a.Get().ToExtString() == text:
            return labels.Value(i)
    raise KeyError(text)


def build_assembly():
    """An XCAF document: TestAsm = Plate + 4 x Bolt (one product, four placements) + Ball.
    The bolt has a layer, a material and volume/area; every product has a colour."""
    app = XCAFApp_Application.GetApplication_s()
    BinXCAFDrivers.DefineFormat_s(app)
    doc = TDocStd_Document(TCollection_ExtendedString("BinXCAF"))
    app.NewDocument(TCollection_ExtendedString("BinXCAF"), doc)
    st = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
    ct = XCAFDoc_DocumentTool.ColorTool_s(doc.Main())
    lt = XCAFDoc_DocumentTool.LayerTool_s(doc.Main())
    mt = XCAFDoc_DocumentTool.MaterialTool_s(doc.Main())

    plate = BRepPrimAPI_MakeBox(100, 60, 10).Shape()
    hole = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(50, 30, -1), gp_Dir(0, 0, 1)), 12, 12).Shape()
    plate = BRepAlgoAPI_Cut(plate, hole).Shape()
    shaft = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), 3, 25).Shape()
    head = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0, 0, 25), gp_Dir(0, 0, 1)), 5.5, 4).Shape()
    bolt = BRepAlgoAPI_Fuse(shaft, head).Shape()
    ball = BRepPrimAPI_MakeSphere(gp_Pnt(0, 0, 0), 15).Shape()

    l_plate = st.AddShape(plate, False); _name(l_plate, "Plate")
    l_bolt = st.AddShape(bolt, False);   _name(l_bolt, "Bolt")
    l_ball = st.AddShape(ball, False);   _name(l_ball, "Ball")
    for lab, rgb in ((l_plate, (0.1, 0.3, 0.8)), (l_bolt, (0.9, 0.1, 0.1)), (l_ball, (0.1, 0.8, 0.2))):
        ct.SetColor(lab, Quantity_Color(*rgb, Quantity_TOC_RGB), XCAFDoc_ColorType.XCAFDoc_ColorSurf)

    layer = lt.AddLayer(TCollection_ExtendedString("FASTENERS"))
    lt.SetLayer(l_bolt, layer)
    mat = mt.AddMaterial(TCollection_HAsciiString("Steel 1.0037"), TCollection_HAsciiString("Structural steel"),
                         7.85, TCollection_HAsciiString("density"), TCollection_HAsciiString("g/cm3"))
    mt.SetMaterial(l_bolt, mat)
    XCAFDoc_Volume.Set_s(l_bolt, 1234.5)
    XCAFDoc_Area.Set_s(l_bolt, 678.9)

    asm = st.NewShape(); _name(asm, "TestAsm")

    def at(x, y, z):
        t = gp_Trsf(); t.SetTranslation(gp_Vec(x, y, z)); return TopLoc_Location(t)

    _name(st.AddComponent(asm, l_plate, TopLoc_Location()), "Plate-1")
    for i, (x, y) in enumerate([(10, 10), (90, 10), (10, 50), (90, 50)], 1):
        _name(st.AddComponent(asm, l_bolt, at(x, y, 10)), f"Bolt-{i}")
    _name(st.AddComponent(asm, l_ball, at(50, 30, 40)), "Ball-1")
    st.UpdateAssemblies()
    free = TDF_LabelSequence(); st.GetFreeShapes(free)
    return doc, st.GetShape_s(free.Value(1))


def write_models(d: Path) -> dict:
    """STEP, IGES (surfaces and solids) and BREP of the assembly, plus files with nothing to mesh."""
    doc, whole = build_assembly()
    files = {}

    w = STEPCAFControl_Writer()
    for m in ("SetNameMode", "SetColorMode", "SetLayerMode", "SetMaterialMode", "SetPropsMode"):
        getattr(w, m)(True)
    w.Transfer(doc, STEPControl_AsIs)
    w.Write(str(d / "asm.step"))
    # What a CAD system writes: a part number that is not the name. (OCCT's writer
    # puts the name in both; edit the text of one PRODUCT.)
    text = (d / "asm.step").read_text(encoding="latin-1")
    text, n = re.subn(r"PRODUCT\('Bolt','Bolt',''", "PRODUCT('BLT-0042','Bolt M6x25','Hex bolt DIN 933'", text)
    assert n == 1, "could not give the bolt a part number"
    (d / "asm.step").write_text(text, encoding="latin-1")
    files["step"] = d / "asm.step"

    iw = IGESCAFControl_Writer()                    # trimmed surfaces, names, colours (the usual IGES)
    iw.SetColorMode(True); iw.SetNameMode(True); iw.SetLayerMode(True)
    iw.Transfer(doc); iw.Write(str(d / "asm_surfaces.igs"))
    files["iges_surfaces"] = d / "asm_surfaces.igs"

    sw = IGESControl_Writer("MM", 1)                # B-rep solids (what some systems write)
    sw.AddShape(whole); sw.ComputeModel(); sw.Write(str(d / "asm_solids.iges"))
    files["iges_solids"] = d / "asm_solids.iges"

    BRepTools.Write_s(whole, str(d / "asm.brep"))
    files["brep"] = d / "asm.brep"

    # Surface models: shells and a loose face, no solid.
    comp = TopoDS_Compound(); b = BRep_Builder(); b.MakeCompound(comp)
    b.Add(comp, BRepPrimAPI_MakeBox(10, 10, 10).Shell())
    b.Add(comp, BRepPrimAPI_MakeBox(gp_Pnt(30, 0, 0), 10, 10, 10).Shell())
    face_only = BRepPrimAPI_MakeBox(gp_Pnt(60, 0, 0), 10, 10, 10).Shell()
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopAbs import TopAbs_FACE
    e = TopExp_Explorer(face_only, TopAbs_FACE)
    b.Add(comp, e.Current())
    BRepTools.Write_s(comp, str(d / "surfaces.brep"))
    files["surfaces_brep"] = d / "surfaces.brep"

    # Nothing to mesh: a single edge (BREP), a STEP that holds only a face.
    BRepTools.Write_s(BRepBuilderAPI_MakeEdge(gp_Pnt(0, 0, 0), gp_Pnt(10, 0, 0)).Shape(), str(d / "wire.brep"))
    files["wire_brep"] = d / "wire.brep"
    face_shape = TopoDS_Compound(); fb = BRep_Builder(); fb.MakeCompound(face_shape)
    fb.Add(face_shape, TopExp_Explorer(BRepPrimAPI_MakeBox(5, 5, 5).Shell(), TopAbs_FACE).Current())
    stw = STEPControl_Writer(); stw.Transfer(face_shape, STEPControl_AsIs); stw.Write(str(d / "face_only.step"))
    files["face_step"] = d / "face_only.step"

    # Damaged files.
    (d / "garbage.step").write_text("this is not a STEP file\n")
    (d / "garbage.igs").write_text("this is not an IGES file\n")
    (d / "empty.brep").write_bytes(b"")
    files.update(garbage_step=d / "garbage.step", garbage_igs=d / "garbage.igs", empty_brep=d / "empty.brep")
    (d / "model.xyz").write_text("whatever")
    files["unknown"] = d / "model.xyz"
    return files


# ─── reading a GLB without a glTF library ──────────────────────────────────
_CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
_NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


class Glb:
    def __init__(self, path):
        self.path = Path(path)
        d = self.path.read_bytes()
        assert d[:4] == b"glTF", f"{path} is not a GLB"
        jl = struct.unpack_from("<I", d, 12)[0]
        self.json = json.loads(d[20:20 + jl].decode("utf-8"))
        self.bin = d[20 + jl + 8:] if len(d) > 20 + jl + 8 else b""
        self.size = len(d)
        assert "EXT_meshopt_compression" not in (self.json.get("extensionsUsed") or []), \
            "a meshopt-compressed GLB cannot be read by this test (gltfpack was on PATH?)"

    def accessor(self, i):
        a = self.json["accessors"][i]
        bv = self.json["bufferViews"][a["bufferView"]]
        n, dt = _NC[a["type"]], _CT[a["componentType"]]
        off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        arr = np.frombuffer(self.bin, dtype=dt, count=a["count"] * n, offset=off)
        return arr.reshape(a["count"], n) if n > 1 else arr

    def mesh_tris(self, mi):
        t = 0
        for prim in self.json["meshes"][mi]["primitives"]:
            idx = prim.get("indices")
            n = self.json["accessors"][idx]["count"] if idx is not None else \
                self.json["accessors"][prim["attributes"]["POSITION"]]["count"]
            t += n // 3
        return t

    @property
    def nodes(self):
        return self.json["nodes"]

    def unique_tris(self):
        return sum(self.mesh_tris(i) for i in range(len(self.json.get("meshes", []))))

    def rendered_tris(self):
        return sum(self.mesh_tris(n["mesh"]) for n in self.nodes if "mesh" in n)

    def mesh_users(self):
        users = {}
        for n in self.nodes:
            if "mesh" in n:
                users.setdefault(n["mesh"], []).append(n.get("name"))
        return users

    def world_bbox(self):
        lo = np.full(3, np.inf); hi = np.full(3, -np.inf)

        def mat(n):
            if "matrix" in n:
                return np.array(n["matrix"], dtype=np.float64).reshape(4, 4).T
            return np.eye(4)

        def walk(i, parent):
            n = self.nodes[i]
            m = parent @ mat(n)
            if "mesh" in n:
                for prim in self.json["meshes"][n["mesh"]]["primitives"]:
                    p = self.accessor(prim["attributes"]["POSITION"]).astype(np.float64)
                    w = p @ m[:3, :3].T + m[:3, 3]
                    np.minimum(lo, w.min(axis=0), out=lo); np.maximum(hi, w.max(axis=0), out=hi)
            for c in n.get("children", []):
                walk(c, m)

        scene = self.json["scenes"][self.json.get("scene", 0)]
        for r in scene["nodes"]:
            walk(r, np.eye(4))
        return lo, hi

    def extras_by_name(self):
        return {n["name"]: n["extras"] for n in self.nodes if n.get("extras")}

    def colours(self):
        out = set()
        for m in self.json.get("materials", []):
            c = m.get("pbrMetallicRoughness", {}).get("baseColorFactor")
            if c: out.add(tuple(round(v, 2) for v in c[:3]))
        return out


# ─── running the converter ─────────────────────────────────────────────────
def run(args, env=None, timeout=240):
    e = dict(os.environ, PYTHONIOENCODING="utf-8")
    if env: e.update(env)
    p = subprocess.run([sys.executable, str(STEP2GLB)] + [str(a) for a in args],
                       capture_output=True, text=True, encoding="utf-8", errors="replace",
                       env=e, timeout=timeout)
    return p.returncode, p.stdout + p.stderr


def convert(src, out, *flags, expect_rc=0):
    rc, text = run([src, "--out", out, "--force", *flags])
    assert rc == expect_rc, f"exit {rc} (wanted {expect_rc}) for {Path(src).name}:\n{text[-1500:]}"
    return text


def close(a, b, tol):
    return np.all(np.abs(np.asarray(a) - np.asarray(b)) <= tol)


def check_model(g: Glb, label: str, instanced: bool, names: bool):
    """The model is the one that was built: its size, triangles, nodes."""
    lo, hi = g.world_bbox()
    assert close(lo, EXPECT_MIN, 0.5) and close(hi, EXPECT_MAX, 0.5), \
        f"{label}: size {lo.round(2)} .. {hi.round(2)}, wanted {EXPECT_MIN} .. {EXPECT_MAX}"
    assert g.unique_tris() > 100, f"{label}: only {g.unique_tris()} triangles"
    users = g.mesh_users()
    if instanced:
        assert max(len(v) for v in users.values()) == 4, f"{label}: the four bolts do not share a mesh ({ {k: len(v) for k, v in users.items()} })"
        assert g.rendered_tris() > g.unique_tris(), f"{label}: instancing saved nothing"
    if names:
        nm = " ".join(n.get("name", "") for n in g.nodes)
        for want in ("Plate-1", "Bolt-1", "Bolt-4", "Ball-1", "TestAsm"):
            assert want in nm, f"{label}: no node named {want}; nodes: {nm[:300]}"


# ─── the tests ─────────────────────────────────────────────────────────────
TESTS = []
def test(fn):
    TESTS.append(fn); return fn

W: Path          # work folder
F: dict          # the model files


@test
def t1_step_baseline():
    """STEP still works the way it did: names, colours, four bolts sharing one mesh."""
    out = W / "o_step.glb"
    convert(F["step"], out, "--quality", "0.2")
    g = Glb(out)
    check_model(g, "STEP", instanced=True, names=True)
    assert {(0.1, 0.3, 0.8), (0.9, 0.1, 0.1), (0.1, 0.8, 0.2)} <= {(round(a, 1), round(b, 1), round(c, 1)) for a, b, c in g.colours()}, g.colours()
    assert g.json["scenes"][0]["extras"]["hierarchical"] is True


@test
def t1_iges_surfaces():
    """IGES as most CAD systems write it: trimmed surfaces, no solid. Names and colours survive."""
    out = W / "o_igs.glb"
    text = convert(F["iges_surfaces"], out, "--quality", "0.2")
    g = Glb(out)
    check_model(g, "IGES surfaces", instanced=False, names=False)
    assert "IGES" in text.splitlines()[1], text[:300]
    assert "TestAsm" in " ".join(n.get("name", "") for n in g.nodes), "the IGES name was lost"
    assert len(g.colours()) >= 3, f"colours of the surfaces lost: {g.colours()}"


@test
def t1_iges_solids_upper_extension():
    """IGES with B-rep solids, and the extension in capitals (.IGES)."""
    src = W / "UPPER.IGES"
    shutil.copy(F["iges_solids"], src)
    out = W / "o_iges_solids.glb"
    convert(src, out, "--quality", "0.2")
    g = Glb(out)
    check_model(g, "IGES solids", instanced=False, names=False)
    # six solids: plate, four bolts, ball (the IGES file repeats the geometry: no instancing)
    assert len(g.json["meshes"]) == 6, f"{len(g.json['meshes'])} meshes, wanted 6 solids"


@test
def t1_iges_plain_reader():
    """--no-colors takes the plain IGES reader (IGESControl_Reader)."""
    out = W / "o_igs_plain.glb"
    text = convert(F["iges_solids"], out, "--quality", "0.2", "--no-colors")
    assert "plain reader" in text
    check_model(Glb(out), "IGES plain", instanced=False, names=False)


@test
def t1_brep():
    """BREP: solids from a file that has no names, colours or assembly. The extension .brp too."""
    src = W / "short.BRP"
    shutil.copy(F["brep"], src)
    out = W / "o_brep.glb"
    text = convert(src, out, "--quality", "0.2")
    assert "BREP" in text.splitlines()[1]
    g = Glb(out)
    check_model(g, "BREP", instanced=False, names=False)
    assert len(g.json["meshes"]) == 6
    # a BREP with no colour: every part the default grey
    assert len(g.colours()) == 1


@test
def t1_surface_models_are_meshed():
    """BREP with shells and a loose face but no solid: three bodies, 6 + 6 + 1 faces -> triangles."""
    out = W / "o_surfaces.glb"
    text = convert(F["surfaces_brep"], out)
    g = Glb(out)
    assert len(g.json["meshes"]) == 3, f"{len(g.json['meshes'])} meshes: {text[-600:]}"
    assert g.unique_tris() == 13 * 2, f"{g.unique_tris()} triangles, wanted 26 (13 faces x 2)"
    names = [n.get("name", "") for n in g.nodes]
    assert any(n.startswith("shell_00000") for n in names) and any(n.startswith("surfaces") for n in names), names


@test
def t1_errors():
    """Unknown extension, nothing to mesh, damaged files: a message that says why, and no GLB."""
    cases = [
        ("unknown", 1, "cannot read '.xyz'"),
        ("wire_brep", 3, "no solid or surface bodies found in this BREP file"),
        ("face_step", 3, "no solid bodies found in this STEP"),
        ("garbage_step", 1, "STEP read failed"),
        ("garbage_igs", 1, "IGES"),
        ("empty_brep", 1, "BREP read failed"),
    ]
    for key, want_rc, want_text in cases:
        out = W / f"err_{key}.glb"
        rc, text = run([F[key], "--out", out, "--force"])
        assert rc == want_rc, f"{key}: exit {rc}, wanted {want_rc}\n{text[-800:]}"
        assert want_text in text, f"{key}: message {want_text!r} not in:\n{text[-800:]}"
        assert not out.exists(), f"{key}: wrote a GLB although there was nothing to write"
    # IGES with nothing in it but a point of a curve is the same story as the wire above (BREP)


@test
def t2_batch():
    """--batch: every file in its own process; the bad ones are reported, the rest converted."""
    b = W / "batch"; (b / "sub").mkdir(parents=True)
    shutil.copy(F["step"], b / "a_good.step")
    shutil.copy(F["iges_solids"], b / "b_good.igs")
    shutil.copy(F["step"], b / "c_dup.step")                 # same stem, two formats
    shutil.copy(F["iges_surfaces"], b / "c_dup.iges")
    shutil.copy(F["garbage_step"], b / "d_bad.step")
    shutil.copy(F["wire_brep"], b / "e_wire.brep")
    shutil.copy(F["empty_brep"], b / "f_empty.brep")
    (b / "notes.txt").write_text("not a CAD file")
    shutil.copy(F["brep"], b / "sub" / "g_deep.brep")
    o = W / "batch_out"
    rc, text = run(["--batch", b, "--out", o, "--quality", "0.3"])
    assert rc == 1, f"exit {rc}, wanted 1 (some files are bad)\n{text[-1500:]}"
    rows = {r["file"]: r for r in csv.DictReader(open(o / "batch-report.csv", encoding="utf-8"))}
    assert set(rows) == {"a_good.step", "b_good.igs", "c_dup.step", "c_dup.iges", "d_bad.step", "e_wire.brep", "f_empty.brep"}, sorted(rows)
    st = {k: v["status"] for k, v in rows.items()}
    assert st["a_good.step"] == st["b_good.igs"] == st["c_dup.step"] == st["c_dup.iges"] == "ok", st
    assert st["d_bad.step"] == "failed" and st["f_empty.brep"] == "failed", st
    assert st["e_wire.brep"] == "no geometry", st
    assert "STEP read failed" in rows["d_bad.step"]["message"], rows["d_bad.step"]
    outs = {k: Path(v["output"]) for k, v in rows.items() if v["output"]}
    assert len(set(outs.values())) == 4 and all(p.exists() for p in outs.values()), outs   # no clash
    a = rows["a_good.step"]
    assert int(a["parts"]) == 6 and int(a["triangles_out"]) > 0 and int(a["triangles_in"]) >= int(a["triangles_out"]) and float(a["size_mb"]) > 0, a
    check_model(Glb(outs["a_good.step"]), "batch STEP", instanced=True, names=True)
    check_model(Glb(outs["b_good.igs"]), "batch IGES", instanced=False, names=False)
    for k in ("a_good.step", "d_bad.step"):
        assert k in text, "the table lacks " + k
    assert "4 of 7 converted" in text, text[-500:]
    assert not (o / "sub").exists() and "g_deep" not in text, "sub-folder converted without --recursive"
    # --recursive reaches the sub-folder, and keeps its place under --out
    rc, text = run(["--batch", b, "--out", o, "--recursive", "--quality", "0.3"])
    assert (o / "sub" / "g_deep.glb").exists(), text[-600:]
    # a batch of good files only exits 0; run again, the GLBs are found as cached
    g = W / "batch_good"; g.mkdir()
    shutil.copy(F["step"], g / "one.step"); shutil.copy(F["brep"], g / "two.brep")
    rc, text = run(["--batch", g, "--quality", "0.3"])
    assert rc == 0 and (g / "one.glb").exists() and (g / "two.glb").exists() and (g / "batch-report.csv").exists(), text[-800:]
    rc, text = run(["--batch", g, "--quality", "0.3"])
    assert rc == 0 and "cached" in text, text[-800:]
    # options go on to every file
    rc, text = run(["--batch", g, "--quality", "0.3", "--lod", "100,50", "--force"])
    assert rc == 0 and (g / "one_lod1.glb").exists() and (g / "two_lod1.glb").exists(), text[-800:]
    # a folder with nothing in it, and a path that is no folder
    (W / "empty_dir").mkdir()
    assert run(["--batch", W / "empty_dir"])[0] == 1
    assert run(["--batch", W / "nope"])[0] == 1


@test
def t3_lod():
    """--lod 100,50,25: the real triangle counts, same nodes and instances, same size."""
    if not shutil.which("node") and not shutil.which("gltfpack"):
        print("      (skipped: neither Node.js nor gltfpack found)")
        return
    out = W / "lod" / "m.glb"; out.parent.mkdir()
    text = convert(F["step"], out, *FINE, "--lod", "100,50,25", "--no-meshopt")
    paths = [out, out.with_name("m_lod1.glb"), out.with_name("m_lod2.glb")]
    assert all(p.exists() for p in paths), [p.name for p in paths if not p.exists()]
    gs = [Glb(p) for p in paths]
    tris = [g.unique_tris() for g in gs]
    print(f"      triangles per level (unique meshes): {tris}  = {[round(100 * t / tris[0], 1) for t in tris]} %")
    print(f"      rendered (instances counted):        {[g.rendered_tris() for g in gs]}")
    print(f"      file sizes:                          {[g.size for g in gs]} bytes")
    assert tris[0] > tris[1] > tris[2] > 0
    for pct, t in zip((50, 25), tris[1:]):
        assert 0.8 * pct <= 100 * t / tris[0] <= 1.1 * pct, f"level {pct}% has {100 * t / tris[0]:.1f}% of the triangles"
    assert gs[1].size < gs[0].size and gs[2].size < gs[1].size
    base_names = [n.get("name") for n in gs[0].nodes]
    for g in gs[1:]:
        assert [n.get("name") for n in g.nodes] == base_names, "the nodes differ between levels"
        assert max(len(v) for v in g.mesh_users().values()) == 4, "the bolts lost their instancing"
        assert g.extras_by_name() == gs[0].extras_by_name(), "metadata differs between levels"
        lo, hi = g.world_bbox()
        assert close(lo, EXPECT_MIN, 1.0) and close(hi, EXPECT_MAX, 1.0), f"size changed: {lo} {hi}"
    if shutil.which("gltfpack") is None:
        assert "node simplifier" in text


@test
def t3_lod_options():
    """--lod input checks, the cache knows about LOD files, --lod and --simplify do not mix."""
    for bad in ("0,50", "150", "a,b", "100,,200", ""):
        rc, text = run([F["brep"], "--lod", bad])
        assert rc == 2 and "--lod" in text, f"--lod {bad!r}: exit {rc}\n{text[-300:]}"
    rc, text = run([F["brep"], "--lod", "100,50", "--simplify", "0.5"])
    assert rc == 2 and "use one of them" in text, text[-300:]
    if not shutil.which("node") and not shutil.which("gltfpack"):
        return
    out = W / "lodc" / "c.glb"; out.parent.mkdir()
    convert(F["step"], out, "--quality", "0.2", "--lod", "100,50", "--no-meshopt")
    assert out.with_name("c_lod1.glb").exists()
    rc, text = run([F["step"], "--out", out, "--quality", "0.2", "--lod", "100,50", "--no-meshopt"])
    assert rc == 0 and "cached" in text, text[-500:]
    out.with_name("c_lod1.glb").unlink()
    rc, text = run([F["step"], "--out", out, "--quality", "0.2", "--lod", "100,50", "--no-meshopt"])
    assert rc == 0 and out.with_name("c_lod1.glb").exists() and "cached:" not in text, "a missing LOD file must be made again"


@test
def t3_lod_with_gltfpack_present():
    """With gltfpack on PATH the LOD files go through it (-si ratio). A stand-in records the call:
    this checks the wiring, not gltfpack itself (it is not installed here)."""
    fake = W / "fakebin"; fake.mkdir()
    log = W / "gltfpack-calls.txt"
    py = fake / "fake_gltfpack.py"
    py.write_text("import sys, shutil\nargs = sys.argv[1:]\n"
                  f"open({str(log)!r}, 'a').write(' '.join(args) + '\\n')\n"
                  "shutil.copyfile(args[args.index('-i') + 1], args[args.index('-o') + 1])\n")
    if os.name == "nt":
        (fake / "gltfpack.cmd").write_text(f'@echo off\r\n"{sys.executable}" "{py}" %*\r\n')
    else:
        sh = fake / "gltfpack"
        sh.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{py}" "$@"\n'); sh.chmod(sh.stat().st_mode | stat.S_IEXEC)
    out = W / "lodg" / "g.glb"; out.parent.mkdir()
    rc, text = run([F["step"], "--out", out, "--force", "--quality", "0.2", "--lod", "100,50,25", "--no-meshopt"],
                   env={"PATH": str(fake) + os.pathsep + os.environ["PATH"]})
    assert rc == 0, text[-1200:]
    calls = log.read_text().splitlines()
    assert "gltfpack simplifier" in text
    assert len(calls) == 2 and "-si 0.500" in calls[0] and "-si 0.250" in calls[1], calls
    assert all("-kn" in c and "-km" in c and "-ke" in c for c in calls), calls
    assert out.with_name("g_lod1.glb").exists() and out.with_name("g_lod2.glb").exists()


@test
def t4_metadata():
    """The CAD file's own data in the node extras, and where each piece comes from."""
    out = W / "o_meta.glb"
    convert(F["step"], out, "--quality", "0.2")
    g = Glb(out)
    ex = g.extras_by_name()
    bolt = next(v for k, v in ex.items() if k.startswith("Bolt-1_"))
    print("      Bolt-1 extras:", json.dumps(bolt))
    assert bolt["name"] == "Bolt-1" and bolt["path"] == "TestAsm/Bolt-1", bolt        # XCAF component label, assembly walk
    assert bolt["product"] == "Bolt M6x25"                                           # name of the referred product
    assert bolt["partNumber"] == "BLT-0042", bolt                                     # STEP PRODUCT.id
    assert bolt["description"] == "Hex bolt DIN 933", bolt                            # STEP PRODUCT.description
    assert bolt["color"] == "#e51a1a", bolt                                           # XCAF colour tool
    assert bolt["layers"] == ["FASTENERS"], bolt                                      # XCAF layer tool
    assert bolt["material"]["name"] == "Steel 1.0037" and abs(bolt["material"]["density"] - 7.85) < 1e-9, bolt   # material tool
    assert abs(bolt["volume"] - 1234.5) < 1e-6 and abs(bolt["area"] - 678.9) < 1e-6, bolt                           # validation properties
    plate = next(v for k, v in ex.items() if k.startswith("Plate-1_"))
    assert plate["path"] == "TestAsm/Plate-1" and plate["color"] == "#1a4dcc" and "layers" not in plate and "material" not in plate, plate
    root = next(v for k, v in ex.items() if k.startswith("TestAsm_"))
    assert root["path"] == "TestAsm", root
    assert g.json["scenes"][0]["extras"]["source_format"] == "step"
    # all four bolts carry their own name and path though they share one mesh
    paths = sorted(v["path"] for k, v in ex.items() if k.startswith("Bolt-"))
    assert paths == [f"TestAsm/Bolt-{i}" for i in (1, 2, 3, 4)], paths
    # the geometry-holder child nodes carry nothing
    assert all(not n.get("extras") for n in g.nodes if n.get("name", "").endswith("__geom"))


@test
def t4_metadata_iges_has_no_part_numbers():
    """IGES has no product structure: names, colour and layers where the file has them, no part number."""
    out = W / "o_meta_igs.glb"
    convert(F["iges_surfaces"], out, "--quality", "0.2")
    ex = Glb(out).extras_by_name()
    assert ex, "no extras on the IGES model"
    for v in ex.values():
        assert "partNumber" not in v and "description" not in v, v
    assert any(v["name"] == "TestAsm" for v in ex.values()), ex
    assert Glb(out).json["scenes"][0]["extras"]["source_format"] == "iges"


@test
def t4_no_extras_and_size():
    """--no-extras leaves the nodes bare. The extras cost this many bytes."""
    a, b = W / "ex_on.glb", W / "ex_off.glb"
    convert(F["step"], a, "--quality", "0.2")
    convert(F["step"], b, "--quality", "0.2", "--no-extras")
    ga, gb = Glb(a), Glb(b)
    assert ga.extras_by_name() and not gb.extras_by_name(), "--no-extras left extras on the nodes"
    assert "source_format" not in gb.json["scenes"][0]["extras"]
    grow = ga.size - gb.size
    print(f"      GLB with extras {ga.size} bytes, without {gb.size}: +{grow} bytes (+{100 * grow / gb.size:.1f}%) for {len(ga.extras_by_name())} nodes"
          f" = {grow / len(ga.extras_by_name()):.0f} bytes per node")
    assert gb.json["nodes"] == [{k: v for k, v in n.items() if k != "extras"} for n in ga.nodes], "extras changed something else"
    assert ga.unique_tris() == gb.unique_tris()


@test
def t4_cache_keeps_metadata():
    """The second conversion of a STEP reads the XCAF cache (no STEP parse); the part numbers must still be there."""
    src = W / "cachetest.step"; shutil.copy(F["step"], src)
    convert(src, W / "cache1.glb", "--quality", "0.2")
    assert src.with_suffix(".xcaf-cache.xbf").exists()
    rc, text = run([src, "--out", W / "cache2.glb", "--quality", "0.2"])
    assert rc == 0 and "loading cached XCAF doc" in text, text[-800:]
    ex = Glb(W / "cache2.glb").extras_by_name()
    bolt = next(v for k, v in ex.items() if k.startswith("Bolt-2_"))
    assert bolt["partNumber"] == "BLT-0042" and bolt["layers"] == ["FASTENERS"] and "material" in bolt, bolt
    # ... and a cache written before part numbers were kept is not trusted
    old = W / "oldcache.step"; shutil.copy(F["step"], old)
    convert(old, W / "old1.glb", "--quality", "0.2", "--no-extras")     # a --no-extras run still writes a complete cache
    rc, text = run([old, "--out", W / "old2.glb", "--quality", "0.2"])
    assert rc == 0 and Glb(W / "old2.glb").extras_by_name(), text[-500:]


@test
def t5_api_convert():
    """serve.py /api/convert takes each format and refuses the rest (a copy of the app in a temp folder)."""
    app = W / "app_copy"; app.mkdir()
    for n in ("serve.py", "step2glb.py"):
        shutil.copy(APP / n, app / n)
    proc = subprocess.Popen([sys.executable, "-u", str(app / "serve.py"), "--no-browser", "--port", "0"],
                            cwd=app, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8")
    port = None
    try:
        t0 = time.time()
        buf = []
        def reader():
            for line in proc.stdout: buf.append(line)
        threading.Thread(target=reader, daemon=True).start()
        while time.time() - t0 < 30 and port is None:
            m = re.search(r"running at\s+http://localhost:(\d+)", "".join(buf))
            if m: port = int(m.group(1))
            else: time.sleep(0.2)
        assert port, "serve.py did not start:\n" + "".join(buf)[-800:]
        base = f"http://localhost:{port}"

        def post(name, path, extra=""):
            req = urllib.request.Request(f"{base}/api/convert?name={name}&quality=0.3{extra}", data=Path(path).read_bytes(), method="POST")
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    return r.status, json.loads(r.read())
            except urllib.error.HTTPError as e:
                return e.code, json.loads(e.read())

        def wait(job_id):
            t0 = time.time()
            while time.time() - t0 < 90:
                with urllib.request.urlopen(f"{base}/api/job/{job_id}", timeout=10) as r:
                    j = json.loads(r.read())
                if j["status"] in ("done", "error", "cancelled"): return j
                time.sleep(0.3)
            raise AssertionError("job did not finish")

        for name, key in (("model.step", "step"), ("model.IGES", "iges_solids"), ("model.igs", "iges_surfaces"),
                          ("model.brep", "brep"), ("model.BRP", "brep")):
            code, j = post(name, F[key])
            assert code == 200, (name, code, j)
            job = wait(j["job_id"])
            assert job["status"] == "done", (name, job["status"], job.get("message"))
            glb = app / "inbox" / job["result"]
            assert glb.exists() and Glb(glb).unique_tris() > 100, name
            check_model(Glb(glb), "api " + name, instanced=(key == "step"), names=(key == "step"))
        # refused
        code, j = post("model.txt", F["unknown"])
        assert code == 400 and ".iges" in j["error"] and ".brep" in j["error"], (code, j)
        code, j = post("model.xyz", F["unknown"])
        assert code == 400
        # nothing to mesh: the job fails with the converter's reason
        code, j = post("wire.brep", F["wire_brep"])
        job = wait(j["job_id"])
        assert job["status"] == "error" and "Nothing to convert" in job["message"] and "BREP" in job["message"], job
        code, j = post("face.step", F["face_step"])
        job = wait(j["job_id"])
        assert job["status"] == "error" and "no solid bodies" in job["message"], job
        # uploads are removed after the job
        left = [p.name for p in (app / "inbox").iterdir() if p.suffix.lower() in (".step", ".igs", ".iges", ".brep", ".brp")]
        assert not left, f"uploads left in inbox: {left}"
    finally:
        proc.terminate()
        try: proc.wait(timeout=10)
        except Exception: proc.kill()


def main() -> int:
    global W, F
    keep = os.environ.get("KEEP_TEST_FILES") == "1"
    W = Path(tempfile.mkdtemp(prefix="converter-test-"))
    only = sys.argv[1:]
    t_all = time.time()
    failed = []
    try:
        print(f"work folder: {W}")
        F = write_models(W)
        for fn in TESTS:
            if only and not any(o in fn.__name__ for o in only):
                continue
            t0 = time.time()
            try:
                print(f"- {fn.__name__}: {(fn.__doc__ or '').strip().splitlines()[0]}")
                fn()
                print(f"  ok  ({time.time() - t0:.1f}s)")
            except Exception as e:
                failed.append(fn.__name__)
                print(f"  FAILED ({time.time() - t0:.1f}s): {type(e).__name__}: {e}")
                if not isinstance(e, AssertionError):
                    traceback.print_exc()
    finally:
        if keep:
            print(f"kept {W}")
        else:
            shutil.rmtree(W, ignore_errors=True)
    n = len(TESTS) if not only else sum(1 for fn in TESTS if any(o in fn.__name__ for o in only))
    print(f"\n{n - len(failed)} of {n} passed in {time.time() - t_all:.0f}s" + (f"; failed: {', '.join(failed)}" if failed else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
