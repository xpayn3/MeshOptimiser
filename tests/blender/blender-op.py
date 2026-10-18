# blender --background --factory-startup --python tests/blender/blender-op.py -- <op> <in.glb> <out file> [json params]
# Blender's own tool for each case of the comparison, at its usual settings, timed. The result is written as GLB (or OBJ, which keeps
# quads and n-gons, when the out file ends in .obj). Prints OP_SECONDS <s>.
import bpy, bmesh, sys, os, json, time, math
args = sys.argv[sys.argv.index('--') + 1:]
op, src, dst = args[:3]; P = json.loads(args[3]) if len(args) > 3 else {}
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
for o in meshes:        # the transforms into the points, so every tool works in the file's own units
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

def bm_op(o, fn):
    bm = bmesh.new(); bm.from_mesh(o.data); fn(bm); bm.to_mesh(o.data); bm.free(); o.data.update()

t0 = time.perf_counter()
if P.get('weld'):                             # Merge by Distance first (a GLB arrives with its points split wherever normals or UVs differ)
    for o in meshes: bm_op(o, lambda bm: bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-4))
if op == 'decimate':                          # Decimate modifier, Collapse, to a share of the triangles
    for o in meshes:
        m = o.modifiers.new('dec', 'DECIMATE'); m.decimate_type = 'COLLAPSE'; m.ratio = P.get('ratio', 0.25)
        bpy.context.view_layer.objects.active = o; bpy.ops.object.modifier_apply(modifier=m.name)
elif op == 'fill_holes':                      # Mesh > Clean Up > Fill Holes (sides 0: every hole)
    for o in meshes: bm_op(o, lambda bm: bmesh.ops.holes_fill(bm, edges=bm.edges[:], sides=0))
elif op == 'grid_fill':                       # not a tool of its own for any hole: Fill (beauty) on every rim, then smooth the patch
    for o in meshes:
        def f(bm):
            r = bmesh.ops.holes_fill(bm, edges=bm.edges[:], sides=0)
            nf = r['faces']; bmesh.ops.triangulate(bm, faces=nf); bmesh.ops.beautify_fill(bm, faces=[x for x in bm.faces if x in set(nf)] if nf else [], edges=bm.edges[:])
        bm_op(o, f)
elif op == 'orient':                          # Mesh > Normals > Recalculate Outside
    for o in meshes: bm_op(o, lambda bm: bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:]))
elif op == 'voxel':                           # Remesh > Voxel, the size given
    for o in meshes:
        o.data.remesh_voxel_size = P['voxel']; o.data.remesh_voxel_adaptivity = 0.0
        bpy.context.view_layer.objects.active = o; bpy.ops.object.voxel_remesh()
elif op == 'quads':                           # Face > Triangles to Quads (40 degrees, the default)
    for o in meshes: bm_op(o, lambda bm: bmesh.ops.join_triangles(bm, faces=bm.faces[:], angle_face_threshold=math.radians(40), angle_shape_threshold=math.radians(40)))
elif op == 'dissolve':                        # Limited Dissolve (5 degrees, the default)
    for o in meshes: bm_op(o, lambda bm: bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(5), verts=bm.verts[:], edges=bm.edges[:]))
elif op == 'union':                           # Boolean modifier, Exact, Union of A with B
    a = next(o for o in meshes if o.name.startswith('A')); b = next(o for o in meshes if o.name.startswith('B'))
    m = a.modifiers.new('bool', 'BOOLEAN'); m.operation = 'UNION'; m.solver = 'EXACT'; m.object = b
    bpy.context.view_layer.objects.active = a; bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.data.objects.remove(b, do_unlink=True); meshes = [a]
elif op == 'convex':                          # Mesh > Convex Hull
    for o in meshes:
        def f(bm):
            r = bmesh.ops.convex_hull(bm, input=bm.verts[:])
            bmesh.ops.delete(bm, geom=list(set(r['geom_interior']) | set(r['geom_unused'])), context='VERTS')
        bm_op(o, f)
elif op == 'smooth':                          # Smooth Vertices, factor 0.5, the repeats given
    for o in meshes:
        for _ in range(P.get('repeat', 5)): bm_op(o, lambda bm: bmesh.ops.smooth_vert(bm, verts=bm.verts[:], factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True))
else:
    raise SystemExit('unknown op ' + op)
secs = time.perf_counter() - t0
print('OP_SECONDS', round(secs, 4))
bpy.ops.object.select_all(action='SELECT')
if dst.lower().endswith('.obj'): bpy.ops.wm.obj_export(filepath=dst, export_materials=False, export_triangulated_mesh=False)
else: bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB')
