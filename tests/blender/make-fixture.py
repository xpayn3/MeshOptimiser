# blender --background --factory-startup --python tests/blender/make-fixture.py -- <out folder>
# Builds the round-trip fixture in Blender and writes it in every format Blender exports: fixture.glb, .gltf, .obj, .fbx, .stl, .ply,
# .usdz, plus fixture.blend. Six parts, each there to catch one kind of mistake:
#   Box_UV    a cube with its own UVs, moved                        (UVs, place)
#   Ball      a UV sphere, turned 30 degrees and scaled 1.5         (turn, scale, smooth normals, UVs)
#   Mirror    a cube with scale -1 on X                             (mirrored parts: faces must not turn inside out)
#   Holey     a cube with its top face removed                      (4 open edges: Fill holes / Close open edges)
#   Flipped   a cube with every face turned inside out              (Align / fix normals)
#   Child     a small cube parented to Ball                         (hierarchy: the child follows its parent)
import bpy, bmesh, sys, os, math
out = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else os.path.join(os.getcwd(), 'roundtrip')
os.makedirs(out, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1.0

def mat(name, rgb):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*rgb, 1)
    m.diffuse_color = (*rgb, 1)
    return m

def cube(name, loc, size=2.0):
    bpy.ops.mesh.primitive_cube_add(size=size, location=loc)        # the primitive comes with UVs (the cross layout)
    o = bpy.context.active_object; o.name = name; o.data.name = name
    return o

red, blue, green, grey, yellow, white = (mat('Red', (0.8, 0.05, 0.05)), mat('Blue', (0.05, 0.1, 0.8)), mat('Green', (0.05, 0.6, 0.1)),
                                         mat('Grey', (0.5, 0.5, 0.5)), mat('Yellow', (0.9, 0.8, 0.05)), mat('White', (0.9, 0.9, 0.9)))

a = cube('Box_UV', (3, 0, 1)); a.data.materials.append(red)

bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=1, location=(0, 3, 1.5))
b = bpy.context.active_object; b.name = 'Ball'; b.data.name = 'Ball'
b.rotation_euler = (0, 0, math.radians(30)); b.scale = (1.5, 1.5, 1.5)
bpy.ops.object.shade_smooth()
b.data.materials.append(blue)

c = cube('Mirror', (-3, 0, 1)); c.scale = (-1, 1, 1); c.data.materials.append(green)
# make it lopsided so a mirror that is lost shows in the box: one corner pulled out along +X (local)
c.data.vertices[[i for i, v in enumerate(c.data.vertices) if v.co.x > 0 and v.co.y > 0 and v.co.z > 0][0]].co.x += 1.0

d = cube('Holey', (0, -3, 1)); d.data.materials.append(grey)
bm = bmesh.new(); bm.from_mesh(d.data)
top = [f for f in bm.faces if f.normal.z > 0.9]
bmesh.ops.delete(bm, geom=top, context='FACES_ONLY'); bm.to_mesh(d.data); bm.free()

e = cube('Flipped', (0, 0, 5)); e.data.materials.append(yellow)
bm = bmesh.new(); bm.from_mesh(e.data); bmesh.ops.reverse_faces(bm, faces=bm.faces[:]); bm.to_mesh(e.data); bm.free()

f = cube('Child', (0, 0, 0), size=0.5); f.data.materials.append(white)
f.parent = b; f.location = (0, 0, 1.6)        # local to Ball: on top of it, scaled with it

bpy.context.view_layer.update()
bpy.ops.object.select_all(action='SELECT')
p = lambda ext: os.path.join(out, 'fixture.' + ext)
bpy.ops.wm.save_as_mainfile(filepath=p('blend'))
bpy.ops.export_scene.gltf(filepath=p('glb'), export_format='GLB')
bpy.ops.export_scene.gltf(filepath=p('gltf'), export_format='GLTF_SEPARATE')
try: bpy.context.preferences.addons['io_scene_gltf2'].preferences.allow_embedded_format = True      # (Blender 4.2+ hides the embedded choice)
except Exception as ex: print('embedded glTF preference:', ex)
bpy.ops.export_scene.gltf(filepath=os.path.join(out, 'fixture-embedded.gltf'), export_format='GLTF_EMBEDDED')     # (one file: what a single upload can carry)
bpy.ops.wm.obj_export(filepath=p('obj'), export_materials=True)
bpy.ops.export_scene.fbx(filepath=p('fbx'))
bpy.ops.wm.stl_export(filepath=p('stl'))
bpy.ops.wm.ply_export(filepath=p('ply'))
try:
    bpy.ops.wm.usd_export(filepath=p('usdz'))
except Exception as ex:
    print('USDZ export failed:', ex)
print('FIXTURE_OK', out)
