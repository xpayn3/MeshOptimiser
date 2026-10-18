# blender --background --factory-startup --python tests/blender/attr-metrics.py -- <original.obj> <result.obj> [...]
# What a reduction costs besides the shape: the shading normal and the texture coordinate at matched points. Points are sampled evenly
# on the original; each is found on the result (nearest point), and the corner normals and UVs of both are interpolated there:
#   normal_deg   mean angle between the two shading normals, in degrees (what the light shows)
#   uv_err       mean distance between the two UVs (share of the 0..1 square: what a texture shows), seams left out (a point whose
#                nearest corners on the result disagree by more than 0.25 sits on a seam and has no single UV)
#   err_mean     mean distance to the result's surface, as a share of the box diagonal
# Both files must be OBJ written with vn and vt. One JSON line per result, between RESULT_BEGIN and RESULT_END.
import bpy, bmesh, sys, os, json, math, random, bisect
from mathutils.bvhtree import BVHTree
from mathutils import Vector
from mathutils.geometry import barycentric_transform
args = sys.argv[sys.argv.index('--') + 1:]

def load(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.wm.obj_import(filepath=path, forward_axis='NEGATIVE_Z', up_axis='Y')
    o = next(x for x in bpy.context.scene.objects if x.type == 'MESH')
    me = o.data
    cn = [Vector(c.vector) for c in me.corner_normals]
    uvl = me.uv_layers.active.data if me.uv_layers.active else None
    tris = []      # (3 positions, 3 normals, 3 uvs)
    me.calc_loop_triangles()
    for lt in me.loop_triangles:
        P = [Vector(me.vertices[me.loops[l].vertex_index].co) for l in lt.loops]
        N = [cn[l] for l in lt.loops]
        U = [Vector((uvl[l].uv[0], uvl[l].uv[1], 0)) if uvl else Vector((0, 0, 0)) for l in lt.loops]
        tris.append((P, N, U))
    verts = []; polys = []
    for P, _, _ in tris: base = len(verts); verts += P; polys.append((base, base + 1, base + 2))
    tree = BVHTree.FromPolygons(verts, polys, all_triangles=True)
    return tris, tree

orig, _ = load(os.path.abspath(args[0]))
lo = Vector([min(p[i] for t in orig for p in t[0]) for i in range(3)]); hi = Vector([max(p[i] for t in orig for p in t[0]) for i in range(3)])
diag = (hi - lo).length
areas = [((t[0][1] - t[0][0]).cross(t[0][2] - t[0][0])).length / 2 for t in orig]
cum, acc = [], 0.0
for a in areas: acc += a; cum.append(acc)
rnd = random.Random(3)
pts = []
for _ in range(15000):
    i = min(len(cum) - 1, bisect.bisect_left(cum, rnd.random() * acc)); P, N, U = orig[i]
    r1, r2 = rnd.random(), rnd.random(); s = math.sqrt(r1); w = (1 - s, s * (1 - r2), s * r2)
    p = P[0] * w[0] + P[1] * w[1] + P[2] * w[2]
    pts.append((p, (N[0] * w[0] + N[1] * w[1] + N[2] * w[2]).normalized(), U[0] * w[0] + U[1] * w[1] + U[2] * w[2]))
for path in args[1:]:
    tris, tree = load(os.path.abspath(path))
    na, ua, da, nu = 0.0, 0.0, 0.0, 0
    for p, n0, u0 in pts:
        loc, _, fi, dist = tree.find_nearest(p)
        P, N, U = tris[fi]
        n1 = barycentric_transform(loc, P[0], P[1], P[2], N[0], N[1], N[2]).normalized()
        na += math.degrees(n0.angle(n1, 0.0)); da += dist
        if max((U[0] - U[1]).length, (U[1] - U[2]).length, (U[0] - U[2]).length) < 0.25:
            u1 = barycentric_transform(loc, P[0], P[1], P[2], U[0], U[1], U[2]); ua += (u1 - u0).length; nu += 1
    n = len(pts)
    print('RESULT_BEGIN' + json.dumps({'file': os.path.basename(path), 'tris': len(tris), 'normal_deg': round(na / n, 3), 'uv_err': round(ua / max(1, nu), 5), 'err_mean': round(da / n / diag, 6)}) + 'RESULT_END', flush=True)
