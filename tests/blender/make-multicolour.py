# blender --background --factory-startup --python tests/blender/make-multicolour.py -- <out folder>
# The fixture of tests/e2e-multicolour.mjs: one object with several materials, as Cinema 4D and Blender make them, and one plain part.
#   Painted   a cube in Red, its top face Blue and its +X face Green (one object, three material slots, a material a face)
#   Plain     a cube in one material (Yellow), for colouring faces in the app
# Written as multicolour.glb, .obj (with its .mtl), .fbx and .blend.
import bpy, bmesh, sys, os
out = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else os.path.join(os.getcwd(), 'multicolour')
os.makedirs(out, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.unit_settings.system = 'METRIC'
bpy.context.scene.unit_settings.scale_length = 1.0

def mat(name, rgb):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*rgb, 1)
    m.diffuse_color = (*rgb, 1)
    return m

red, blue, green, yellow = mat('Red', (0.8, 0.05, 0.05)), mat('Blue', (0.05, 0.1, 0.8)), mat('Green', (0.05, 0.6, 0.1)), mat('Yellow', (0.9, 0.8, 0.05))

bpy.ops.mesh.primitive_cube_add(size=2.0, location=(0, 0, 1))
a = bpy.context.active_object; a.name = 'Painted'; a.data.name = 'Painted'
for m in (red, blue, green): a.data.materials.append(m)
for p in a.data.polygons:
    p.material_index = 1 if p.normal.z > 0.9 else 2 if p.normal.x > 0.9 else 0

bpy.ops.mesh.primitive_cube_add(size=2.0, location=(4, 0, 1))
b = bpy.context.active_object; b.name = 'Plain'; b.data.name = 'Plain'
b.data.materials.append(yellow)

bpy.context.view_layer.update()
bpy.ops.object.select_all(action='SELECT')
p = lambda ext: os.path.join(out, 'multicolour.' + ext)
bpy.ops.wm.save_as_mainfile(filepath=p('blend'))
bpy.ops.export_scene.gltf(filepath=p('glb'), export_format='GLB')
bpy.ops.wm.obj_export(filepath=p('obj'), export_materials=True)
bpy.ops.export_scene.fbx(filepath=p('fbx'))
print('FIXTURE_OK', out)
