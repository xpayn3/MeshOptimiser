# blender --background --factory-startup --python tests/blender/inspect.py -- <model file> [<model file> ...]
# Opens each model with Blender's own importer (glb, gltf, obj, fbx, stl, ply, usd/usdz, blend) and reports every mesh object, in world
# space, as JSON: name, parent, triangles, box, area, signed volume (positive = faces point out), open edges (after welding by position,
# so seams that a format splits do not count), UV pairs, smooth corners, the material's colour and the node's custom properties (a glTF
# node's extras). An object of several materials also gets 'colours': [[colour, triangles], ...], one entry a material slot that a
# triangle wears (slots of one colour together). One line per file, between RESULT_BEGIN and RESULT_END.
import bpy, bmesh, sys, os, json, hashlib, re
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []

def load(path):
    ext = path.rsplit('.', 1)[-1].lower()
    if ext == 'blend':
        bpy.ops.wm.open_mainfile(filepath=path); return
    bpy.ops.wm.read_factory_settings(use_empty=True)
    {
        'glb': lambda: bpy.ops.import_scene.gltf(filepath=path), 'gltf': lambda: bpy.ops.import_scene.gltf(filepath=path),
        'obj': lambda: bpy.ops.wm.obj_import(filepath=path), 'fbx': lambda: bpy.ops.import_scene.fbx(filepath=path),
        'stl': lambda: bpy.ops.wm.stl_import(filepath=path), 'ply': lambda: bpy.ops.wm.ply_import(filepath=path),
        'usd': lambda: bpy.ops.wm.usd_import(filepath=path), 'usdz': lambda: bpy.ops.wm.usd_import(filepath=path),
        'usda': lambda: bpy.ops.wm.usd_import(filepath=path), 'usdc': lambda: bpy.ops.wm.usd_import(filepath=path),
    }[ext]()

def colour(m):
    if m is None: return None
    try:
        if m.use_nodes:
            for n in m.node_tree.nodes:
                if n.type == 'BSDF_PRINCIPLED':
                    c = n.inputs['Base Color']
                    if not c.is_linked: return [round(x, 3) for x in c.default_value[:3]]
                    return 'texture'
    except Exception: pass
    return [round(x, 3) for x in m.diffuse_color[:3]]

def props(o):
    out = {}
    while o is not None:
        for k in o.keys():
            if k.startswith('_') or k in out: continue
            v = o[k]
            if isinstance(v, (int, float, str)): out[k] = v
        o = o.parent
    return out

# A part's group: the converter writes a solid that has faces of several colours as one node per colour (<name>__geom_000, _001 ...).
# They are measured together too, welded, so a solid that is closed as a whole is not counted as open.
def ancestry(o):
    names = []
    while o is not None: names.append(o.name); o = o.parent
    return '/'.join(reversed(names))

def group_key(name):
    return re.sub(r'(__geom(_\d+)?)(\.\d+)?$', '', name)

def measure(tris_xyz):
    if not tris_xyz: return None
    bm = bmesh.new(); vs = [bm.verts.new(p) for p in tris_xyz]
    for i in range(0, len(vs) - 2, 3):
        try: bm.faces.new((vs[i], vs[i + 1], vs[i + 2]))
        except ValueError: pass
    lo = [min(p[i] for p in tris_xyz) for i in range(3)]; hi = [max(p[i] for p in tris_xyz) for i in range(3)]
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5 * max(1e-9, max(h - l for h, l in zip(hi, lo))))
    vol = 0.0
    for fc in bm.faces:
        if len(fc.loops) != 3: continue
        a, b, c = (lp.vert.co for lp in fc.loops); vol += a.dot(b.cross(c)) / 6.0
    r = {'open_edges': sum(1 for e in bm.edges if len(e.link_faces) == 1), 'volume': round(vol, 5), 'area': round(sum(fc.calc_area() for fc in bm.faces), 5)}
    bm.free(); return r

def inspect(path):
    load(path)
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    objs = []; groups = {}
    for o in bpy.context.scene.objects:
        if o.type != 'MESH': continue
        me = o.evaluated_get(dg).to_mesh()
        mw = o.matrix_world
        bm = bmesh.new(); bm.from_mesh(me); bm.transform(mw)
        uvl = bm.loops.layers.uv.active
        uvs = set()
        if uvl is not None:
            for fc in bm.faces:
                for l in fc.loops: uv = l[uvl].uv; uvs.add((round(uv.x, 3), round(uv.y, 3)))
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
        area = sum(fc.calc_area() for fc in bm.faces)
        per_slot = {}
        for fc in bm.faces: per_slot[fc.material_index] = per_slot.get(fc.material_index, 0) + 1
        flip = mw.determinant() < 0
        g = groups.setdefault(group_key(o.name), [])
        for fc in bm.faces:
            q = [tuple(lp.vert.co) for lp in fc.loops]
            g.extend(q[::-1] if flip else q)
        tris = len(bm.faces)
        xs = [v.co for v in bm.verts]
        lo = [min(v[i] for v in xs) for i in range(3)] if xs else [0, 0, 0]
        hi = [max(v[i] for v in xs) for i in range(3)] if xs else [0, 0, 0]
        bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5 * max(1e-9, max(h - l for h, l in zip(hi, lo))))
        vol = 0.0
        for fc in bm.faces:
            if len(fc.loops) != 3: continue
            a, b, c = (lp.vert.co for lp in fc.loops)
            vol += a.dot(b.cross(c)) / 6.0
        if mw.determinant() < 0: vol = -vol        # a mirrored object is drawn with its faces turned, so they point the other way
        open_edges = sum(1 for ed in bm.edges if len(ed.link_faces) == 1)
        nonman = sum(1 for ed in bm.edges if len(ed.link_faces) > 2)
        # smooth: share of corners whose normal is off the face normal by more than ~2 degrees
        sm = tot = 0
        try:
            cn = me.corner_normals
            for poly in me.polygons:
                for li in poly.loop_indices:
                    tot += 1
                    if cn[li].vector.dot(poly.normal) < 0.9994: sm += 1
        except Exception: pass
        bm.free()
        m = o.material_slots[0].material if o.material_slots else None
        cols = {}
        for si, n in sorted(per_slot.items()):
            sm_ = o.material_slots[si].material if si < len(o.material_slots) else None
            k = json.dumps(colour(sm_))
            cols[k] = cols.get(k, 0) + n
        su = sorted(uvs)
        objs.append({
            'name': o.name, 'parent': o.parent.name if o.parent else None, 'tris': tris, 'verts': len(me.vertices),
            'min': [round(x, 5) for x in lo], 'max': [round(x, 5) for x in hi], 'area': round(area, 5), 'volume': round(vol, 5),
            'open_edges': open_edges, 'nonmanifold': nonman, 'uv_layers': len(me.uv_layers), 'uv_count': len(su),
            'uv_hash': hashlib.md5(json.dumps(su).encode()).hexdigest()[:10], 'uvs': su if len(su) <= 2000 else None,
            'smooth': round(sm / tot, 3) if tot else 0, 'material': m.name if m else None, 'colour': colour(m),
            'colours': [[json.loads(k), n] for k, n in cols.items()], 'slots': len(o.material_slots),
            'mirrored': mw.determinant() < 0, 'props': props(o), 'path': ancestry(o),
        })
        o.evaluated_get(dg).to_mesh_clear()
    gout = []
    for k, tri in groups.items():
        members = [o for o in objs if group_key(o['name']) == k]
        if len(members) < 2: continue
        m = measure(tri)
        if m: gout.append({'name': k, 'parts': len(members), **m})
    return {'file': os.path.basename(path), 'objects': objs, 'groups': gout}

for a in args:
    p = os.path.abspath(a)
    try: res = inspect(p)
    except Exception as ex: res = {'file': os.path.basename(p), 'error': repr(ex)}
    print('RESULT_BEGIN' + json.dumps(res) + 'RESULT_END', flush=True)
