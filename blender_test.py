"""Run via blender --background --python blender_test.py -- <fbx_path>"""
import bpy, sys, os

# Blender forwards args after '--' to the script.
argv = sys.argv
if '--' in argv:
    argv = argv[argv.index('--') + 1:]
else:
    argv = []

fbx = argv[0] if argv else 'test_out.fbx'
fbx = os.path.abspath(fbx)
print('=== Testing FBX import:', fbx)

# Wipe default scene.
bpy.ops.wm.read_factory_settings(use_empty=True)

try:
    result = bpy.ops.import_scene.fbx(filepath=fbx)
    print('=== IMPORT RESULT:', result)
    print('=== Objects in scene:')
    for obj in bpy.data.objects:
        print('  ', obj.name, obj.type)
    print('=== SUCCESS')
except Exception as e:
    print('=== IMPORT FAILED:', type(e).__name__, e)
