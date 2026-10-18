# app/.venv/Scripts/python.exe tests/blender/step-reference.py <file.stp> [...]
# The exact numbers of a STEP file, read from its B-rep with OpenCASCADE (not from a mesh): solids, their total volume and area, and the
# box. They are what a converted mesh is judged against: a good tessellation is closed and lands within a fraction of a percent of these.
# Prints one JSON line per file.
import sys, json, os
from OCP.STEPControl import STEPControl_Reader
from OCP.IFSelect import IFSelect_RetDone
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_SOLID, TopAbs_FACE, TopAbs_SHELL
from OCP.GProp import GProp_GProps
from OCP.BRepGProp import BRepGProp
from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepCheck import BRepCheck_Analyzer

for path in sys.argv[1:]:
    r = STEPControl_Reader()
    if r.ReadFile(path) != IFSelect_RetDone:
        print(json.dumps({'file': path, 'error': 'not read'})); continue
    r.TransferRoots(); shape = r.OneShape()
    solids, vol, area, bad = 0, 0.0, 0.0, 0
    ex = TopExp_Explorer(shape, TopAbs_SOLID)
    while ex.More():
        s = ex.Current(); solids += 1
        g = GProp_GProps(); BRepGProp.VolumeProperties_s(s, g); vol += abs(g.Mass())
        if not BRepCheck_Analyzer(s).IsValid(): bad += 1
        ex.Next()
    g = GProp_GProps(); BRepGProp.SurfaceProperties_s(shape, g); area = g.Mass()
    faces = 0; ex = TopExp_Explorer(shape, TopAbs_FACE)
    while ex.More(): faces += 1; ex.Next()
    b = Bnd_Box(); BRepBndLib.AddOptimal_s(shape, b, False, False)
    if b.IsVoid():        # no B-rep at all (a file of tessellated geometry only)
        print(json.dumps({'file': os.path.basename(path), 'solids': solids, 'faces': faces, 'error': 'no B-rep geometry'})); continue
    x0, y0, z0, x1, y1, z1 = b.Get()
    print(json.dumps({'file': path.replace('\\', '/').split('/')[-1], 'solids': solids, 'invalid_solids': bad, 'faces': faces,
                      'volume': round(vol, 3), 'area': round(area, 3), 'size': [round(x1 - x0, 3), round(y1 - y0, 3), round(z1 - z0, 3)]}))
