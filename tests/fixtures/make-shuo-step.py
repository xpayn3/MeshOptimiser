"""Writes tests/fixtures/shuo.step: a STEP whose instances carry colours of their own.

Top assembly
  SubA (instance 1) -> Bolt 1 (grey, the product colour), Bolt 2 (red: a SHUO, set for this path only)
  SubA (instance 2, coloured blue on the component) -> Bolt 1, Bolt 2 (both blue)

Run with the app's Python: app/.venv/Scripts/python.exe tests/fixtures/make-shuo-step.py [out.step]
(tests/converter.test.py runs it into its own folder.)
"""
from pathlib import Path

from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox
from OCP.gp import gp_Trsf, gp_Vec
from OCP.TopLoc import TopLoc_Location
from OCP.TCollection import TCollection_ExtendedString
from OCP.TDocStd import TDocStd_Document
from OCP.XCAFDoc import XCAFDoc_DocumentTool, XCAFDoc_ColorType
from OCP.TDataStd import TDataStd_Name
from OCP.Quantity import Quantity_Color, Quantity_TOC_RGB
from OCP.STEPCAFControl import STEPCAFControl_Writer
from OCP.STEPControl import STEPControl_AsIs
from OCP.Interface import Interface_Static


def loc(x, y, z):
    t = gp_Trsf(); t.SetTranslation(gp_Vec(x, y, z)); return TopLoc_Location(t)


def rgb(r, g, b):
    return Quantity_Color(r, g, b, Quantity_TOC_RGB)


doc = TDocStd_Document(TCollection_ExtendedString("XmlOcaf"))
st = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
ct = XCAFDoc_DocumentTool.ColorTool_s(doc.Main())
name = lambda lab, s: TDataStd_Name.Set_s(lab, TCollection_ExtendedString(s))

bolt = st.AddShape(BRepPrimAPI_MakeBox(10, 10, 40).Shape(), False)
name(bolt, "Bolt")
ct.SetColor(bolt, rgb(0.5, 0.5, 0.5), XCAFDoc_ColorType.XCAFDoc_ColorSurf)

sub = st.NewShape(); name(sub, "SubA")
b1 = st.AddComponent(sub, bolt, loc(0, 0, 0)); name(b1, "Bolt 1")
b2 = st.AddComponent(sub, bolt, loc(30, 0, 0)); name(b2, "Bolt 2")

top = st.NewShape(); name(top, "Top")
s1 = st.AddComponent(top, sub, loc(0, 0, 0)); name(s1, "SubA 1")
s2 = st.AddComponent(top, sub, loc(0, 60, 0)); name(s2, "SubA 2")
st.UpdateAssemblies()

# a colour on the component label: every bolt of the second SubA is blue
ct.SetColor(s2, rgb(0, 0, 1), XCAFDoc_ColorType.XCAFDoc_ColorSurf)

# a SHUO: Bolt 2 in SubA 1 only is red. The shape of that occurrence is the bolt moved by both placements.
occ = st.GetShape_s(bolt).Moved(loc(0, 0, 0) * loc(30, 0, 0))
ok = ct.SetInstanceColor(occ, XCAFDoc_ColorType.XCAFDoc_ColorSurf, rgb(1, 0, 0))
print("SHUO set:", ok)

Interface_Static.SetIVal_s("write.step.schema", 4)
w = STEPCAFControl_Writer()
w.SetColorMode(True); w.SetNameMode(True)
w.Transfer(doc, STEPControl_AsIs)
import sys
out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).with_name("shuo.step")
print("written:", int(w.Write(str(out))), out)
