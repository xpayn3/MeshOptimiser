# blender --background --factory-startup --python tests/blender/make-usd.py -- <out folder>
# USD files of a known scene, for tests/e2e-usd-dae.mjs: a 100 mm box with its middle at (200, 0, 50) mm and a cylinder 60 mm across and
# 200 mm tall standing on the floor at (-200, 0, 0) mm, Z up in metres as Blender has them. Written as text (.usda), binary (.usdc) and
# zipped (.usdz), and, where this Blender's exporter offers it, turned to Y up and scaled to centimetres. Prints one JSON line between
# RESULT_BEGIN and RESULT_END: the files made, each with what the file says (up axis and metres per unit, read back from the .usda twin).
import bpy, sys, os, json
args = sys.argv[sys.argv.index('--') + 1:]
out = args[0]
os.makedirs(out, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_cube_add(size=0.1, location=(0.2, 0, 0.05))
bpy.context.object.name = 'Box'
bpy.ops.mesh.primitive_cylinder_add(radius=0.03, depth=0.2, location=(-0.2, 0, 0.1))
bpy.context.object.name = 'Can'

made = []
def export(name, **kw):
    path = os.path.join(out, name)
    try:
        bpy.ops.wm.usd_export(filepath=path, export_materials=True, **kw)
        made.append({'file': name, 'options': {k: str(v) for k, v in kw.items()}})
        return True
    except (TypeError, RuntimeError) as e:
        print('skipped', name, e)
        return False

for ext in ('usda', 'usdc', 'usdz'):
    export('scene.' + ext)
# Y up (the exporter turns the data and says so in the stage)
if export('scene-yup.usda', convert_orientation=True, export_global_forward_selection='NEGATIVE_Z', export_global_up_selection='Y'):
    export('scene-yup.usdc', convert_orientation=True, export_global_forward_selection='NEGATIVE_Z', export_global_up_selection='Y')
# centimetres (metersPerUnit 0.01)
if export('scene-cm.usda', convert_scene_units='CENTIMETERS'):
    export('scene-cm.usdz', convert_scene_units='CENTIMETERS')

# what each stage says, read from the text files
for m in made:
    twin = os.path.join(out, m['file'].rsplit('.', 1)[0] + '.usda')
    up, mpu = None, None
    if os.path.exists(twin):
        head = open(twin, encoding='utf-8', errors='replace').read(4000)
        import re
        a = re.search(r'upAxis\s*=\s*"(\w)"', head); b = re.search(r'metersPerUnit\s*=\s*([0-9.eE+-]+)', head)
        up = a.group(1) if a else None; mpu = float(b.group(1)) if b else None
    m['upAxis'] = up; m['metersPerUnit'] = mpu
print('RESULT_BEGIN')
print(json.dumps({'made': made}))
print('RESULT_END')
