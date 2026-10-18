# blender --background --factory-startup --python tests/blender/make-compare.py -- <out folder>
# The meshes the app's tools are compared on with Blender's (tests/blender/compare-tools.mjs). Each is about 100 units across, the size
# of a part in millimetres, so the app's settings in mm mean what they say. Written as GLB, one file per case:
#   organic.glb   Suzanne, subdivided twice and triangulated (15.7k triangles): Decimate, Voxel remesh
#   holes.glb     a UV sphere with three holes of different sizes (faces taken out): Fill holes
#   flipped.glb   an icosphere with a third of its faces turned inside out (fixed seed): Recalculate normals
#   quads.glb     a subdivided cube and Suzanne, quads cut into triangles (beauty): Tris to quads / Untriangulate
#   bool.glb      two overlapping spheres, A and B: Boolean union
#   hull.glb      Suzanne again, for Convex hull
import bpy, bmesh, sys, os, random, math
out = sys.argv[sys.argv.index('--') + 1]
os.makedirs(out, exist_ok=True)

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def save(name):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=os.path.join(out, name + '.glb'), export_format='GLB', export_apply=True)

def apply_all(o):
    bpy.context.view_layer.objects.active = o
    for m in list(o.modifiers): bpy.ops.object.modifier_apply(modifier=m.name)

def triangulate(o, quad='BEAUTY'):
    bm = bmesh.new(); bm.from_mesh(o.data); bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method=quad); bm.to_mesh(o.data); bm.free()

def scale_to(o, size=100.0):
    d = max(o.dimensions); f = size / d
    o.scale = (f, f, f); bpy.context.view_layer.objects.active = o; o.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

def suzanne(name, levels=2):
    bpy.ops.mesh.primitive_monkey_add(size=2)
    o = bpy.context.active_object; o.name = name; o.data.name = name
    m = o.modifiers.new('sub', 'SUBSURF'); m.levels = levels; m.render_levels = levels
    apply_all(o); scale_to(o)
    return o

# organic
reset(); o = suzanne('Organic'); triangulate(o); bpy.ops.object.shade_smooth(); save('organic')
# hull
reset(); o = suzanne('Hull', 1); triangulate(o); save('hull')

# holes: a sphere with three holes (a pole cap of ~4 rings, a band patch, a single quad)
reset()
bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=50)
o = bpy.context.active_object; o.name = 'Holes'; o.data.name = 'Holes'
bm = bmesh.new(); bm.from_mesh(o.data)
gone = [f for f in bm.faces if f.calc_center_median().z > 46]                                                      # the top cap
gone += [f for f in bm.faces if abs(f.calc_center_median().z) < 9 and 0 < math.atan2(f.calc_center_median().y, f.calc_center_median().x) < 0.6]   # a patch on the side
side = [f for f in bm.faces if abs(f.calc_center_median().z + 25) < 4 and abs(math.atan2(f.calc_center_median().y, f.calc_center_median().x) - 2.5) < 0.07]
gone += side[:1]                                                                                                  # one quad
bmesh.ops.delete(bm, geom=list(set(gone)), context='FACES_ONLY')
bmesh.ops.triangulate(bm, faces=bm.faces[:]); bm.to_mesh(o.data); bm.free()
bpy.ops.object.shade_smooth(); save('holes')

# flipped: a third of the faces turned
reset()
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=4, radius=50)
o = bpy.context.active_object; o.name = 'Flipped'; o.data.name = 'Flipped'
bm = bmesh.new(); bm.from_mesh(o.data); rnd = random.Random(7)
bmesh.ops.reverse_faces(bm, faces=[f for f in bm.faces if rnd.random() < 0.33]); bm.to_mesh(o.data); bm.free()
save('flipped')

# quads: a subdivided cube (all quads) and a Suzanne (quads and a few triangles), cut into triangles
reset()
bpy.ops.mesh.primitive_cube_add(size=2, location=(-1.6, 0, 0)); c = bpy.context.active_object; c.name = 'QuadCube'; c.data.name = 'QuadCube'
m = c.modifiers.new('sub', 'SUBSURF'); m.levels = 2; m.subdivision_type = 'SIMPLE'; apply_all(c)
bpy.ops.mesh.primitive_monkey_add(size=2, location=(1.6, 0, 0)); s = bpy.context.active_object; s.name = 'QuadMonkey'; s.data.name = 'QuadMonkey'
m = s.modifiers.new('sub', 'SUBSURF'); m.levels = 1; apply_all(s)
quads_before = {o.name: sum(1 for p in o.data.polygons if len(p.vertices) == 4) for o in (c, s)}
for o in (c, s): scale_to(o, 50); triangulate(o)
print('QUADS_BEFORE', quads_before)
save('quads')

# bool: two overlapping spheres
reset()
bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=30, location=(-15, 0, 0)); a = bpy.context.active_object; a.name = 'A'; a.data.name = 'A'
bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=30, location=(15, 0, 0)); b = bpy.context.active_object; b.name = 'B'; b.data.name = 'B'
for o in (a, b): triangulate(o)
save('bool')
print('COMPARE_FIXTURES_OK', out)
