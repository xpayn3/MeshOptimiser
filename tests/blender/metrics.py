# blender --background --factory-startup --python tests/blender/metrics.py -- <original> <result> [<result> ...]
# How good a tool's result is, against the mesh it started from, measured the same way for the app's result and Blender's:
#   err_mean / err_max   distance between the two surfaces, both ways (points sampled evenly by area, the nearest point on the
#                        other surface), as a share of the original's box diagonal; err_max is the Hausdorff distance
#   tris, faces, quads, ngons   (faces as the file has them: an OBJ keeps quads and n-gons)
#   open_edges, nonmanifold     after welding by position
#   volume, inside_out          signed volume; faces whose normal points away from the nearest original face (for 'orient': those
#                               pointing into the shape, judged against the outward direction from the centre)
#   slivers                     triangles with an angle under 10 degrees, as a share
# One JSON line per result, between RESULT_BEGIN and RESULT_END.
import bpy, bmesh, sys, os, json, math, random
from mathutils.bvhtree import BVHTree
from mathutils import Vector
args = sys.argv[sys.argv.index('--') + 1:]

def load(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    ext = path.rsplit('.', 1)[-1].lower()
    if ext in ('glb', 'gltf'): bpy.ops.import_scene.gltf(filepath=path)
    elif ext == 'obj': bpy.ops.wm.obj_import(filepath=path)
    elif ext == 'stl': bpy.ops.wm.stl_import(filepath=path)
    dg = bpy.context.evaluated_depsgraph_get()
    bm = bmesh.new()
    faces = quads = ngons = 0
    for o in bpy.context.scene.objects:
        if o.type != 'MESH': continue
        me = o.evaluated_get(dg).to_mesh()
        for p in me.polygons:
            faces += 1
            if len(p.vertices) == 4: quads += 1
            elif len(p.vertices) > 4: ngons += 1
        t = bmesh.new(); t.from_mesh(me); t.transform(o.matrix_world)
        if o.matrix_world.determinant() < 0: bmesh.ops.reverse_faces(t, faces=t.faces[:])
        tmp = bpy.data.meshes.new('t'); t.to_mesh(tmp); t.free(); bm.from_mesh(tmp); bpy.data.meshes.remove(tmp)
        o.evaluated_get(dg).to_mesh_clear()
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    return bm, {'faces': faces, 'quads': quads, 'ngons': ngons}

def samples(bm, n, rnd):
    tris = [[v.co.copy() for v in f.verts] for f in bm.faces]
    areas = [max(0.0, ((b - a).cross(c - a)).length / 2) for a, b, c in tris]
    tot = sum(areas) or 1.0
    acc, cum = 0.0, []
    for a in areas: acc += a; cum.append(acc)
    pts = []
    import bisect
    for _ in range(n):
        i = min(len(cum) - 1, bisect.bisect_left(cum, rnd.random() * tot))
        a, b, c = tris[i]; r1, r2 = rnd.random(), rnd.random()
        s = math.sqrt(r1); pts.append(a * (1 - s) + b * (s * (1 - r2)) + c * (s * r2))
    return pts

def measure(bm):
    w = bm.copy()
    xs = [v.co for v in w.verts]
    lo = Vector([min(v[i] for v in xs) for i in range(3)]); hi = Vector([max(v[i] for v in xs) for i in range(3)])
    bmesh.ops.remove_doubles(w, verts=w.verts[:], dist=1e-5 * (hi - lo).length)
    vol = sum(f.verts[0].co.dot(f.verts[1].co.cross(f.verts[2].co)) / 6 for f in w.faces if len(f.verts) == 3)
    open_e = sum(1 for e in w.edges if len(e.link_faces) == 1); nonman = sum(1 for e in w.edges if len(e.link_faces) > 2)
    sl = 0
    for f in w.faces:
        a, b, c = (v.co for v in f.verts)
        angs = []
        for p, q, r in ((a, b, c), (b, c, a), (c, a, b)):
            u, v = q - p, r - p
            if u.length < 1e-12 or v.length < 1e-12: angs.append(0); continue
            angs.append(u.angle(v))
        if min(angs) < math.radians(10): sl += 1
    n = len(w.faces); w.free()
    return {'tris': n, 'volume': round(vol, 3), 'open_edges': open_e, 'nonmanifold': nonman, 'slivers': round(sl / max(1, n), 4), 'lo': lo, 'hi': hi}

orig, _ = load(os.path.abspath(args[0]))
om = measure(orig); diag = (om['hi'] - om['lo']).length
otree = BVHTree.FromBMesh(orig)
rnd = random.Random(1)
opts = samples(orig, 20000, rnd)
centre = (om['lo'] + om['hi']) / 2
for path in args[1:]:
    try:
        res, fc = load(os.path.abspath(path))
        rm = measure(res)
        rtree = BVHTree.FromBMesh(res)
        d1 = [rtree.find_nearest(p)[3] for p in opts]
        rp = samples(res, 20000, rnd)
        d2 = [otree.find_nearest(p)[3] for p in rp]
        d = [x for x in d1 + d2 if x is not None]
        # faces pointing into the shape (judged from the centre: right for the convex shapes of the orient case)
        inward = sum(1 for f in res.faces if f.normal.dot(f.calc_center_median() - centre) < 0) / max(1, len(res.faces))
        out = {'file': os.path.basename(path), **{k: v for k, v in rm.items() if k not in ('lo', 'hi')}, **fc,
               'err_mean': round(sum(d) / len(d) / diag, 6), 'err_max': round(max(d) / diag, 6), 'inward': round(inward, 4),
               'orig_tris': om['tris'], 'orig_volume': om['volume']}
    except Exception as ex:
        out = {'file': os.path.basename(path), 'error': repr(ex)}
    print('RESULT_BEGIN' + json.dumps(out) + 'RESULT_END', flush=True)
