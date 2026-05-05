"""Mirror of the JS FBX binary writer to verify the format produces
loadable files. Generates a minimal scene with one cube mesh."""
import struct, random

class W:
    def __init__(self): self.b = bytearray()
    def u8(self, v): self.b.append(v & 0xFF)
    def u32(self, v): self.b.extend(struct.pack('<I', v & 0xFFFFFFFF))
    def i32(self, v): self.b.extend(struct.pack('<i', v))
    def u64(self, v): self.b.extend(struct.pack('<Q', v & 0xFFFFFFFFFFFFFFFF))
    def i64(self, v): self.b.extend(struct.pack('<q', v))
    def f32(self, v): self.b.extend(struct.pack('<f', v))
    def f64(self, v): self.b.extend(struct.pack('<d', v))
    def bytes_(self, x): self.b.extend(x)
    def patch_u64(self, at, v): struct.pack_into('<Q', self.b, at, v & 0xFFFFFFFFFFFFFFFF)
    @property
    def pos(self): return len(self.b)

def write_scalar(w, t, v):
    w.u8(ord(t))
    if t == 'I': w.i32(v)
    elif t == 'C': w.u8(v if isinstance(v, int) else (89 if v else 78))
    elif t == 'D': w.f64(v)
    elif t == 'L': w.i64(v)
    elif t in ('S', 'R'):
        if isinstance(v, str): v = v.encode('utf-8')
        w.u32(len(v)); w.bytes_(v)

def write_array(w, t, arr):
    w.u8(ord(t))
    if t == 'd': raw = struct.pack('<' + str(len(arr)) + 'd', *arr)
    elif t == 'f': raw = struct.pack('<' + str(len(arr)) + 'f', *arr)
    elif t == 'i': raw = struct.pack('<' + str(len(arr)) + 'i', *arr)
    w.u32(len(arr)); w.u32(0); w.u32(len(raw)); w.bytes_(raw)

def write_node(w, n):
    start = w.pos
    w.u32(0); w.u32(len(n.get('props', [])))
    pl = w.pos; w.u32(0)
    nm = n['name'].encode('utf-8')
    w.u8(len(nm)); w.bytes_(nm)
    ps = w.pos
    for p in n.get('props', []):
        if p['type'] in 'fdli':
            write_array(w, p['type'], p['value'])
        else:
            write_scalar(w, p['type'], p['value'])
    struct.pack_into('<I', w.b, pl, (w.pos - ps) & 0xFFFFFFFF)
    if 'children' in n:
        for c in n['children']: write_node(w, c)
        w.u32(0); w.u32(0); w.u32(0); w.u8(0)
    struct.pack_into('<I', w.b, start, w.pos & 0xFFFFFFFF)

def P(name, t1, t2, t3, *vals):
    int_t = t1 in ('int', 'Integer', 'enum')
    long_t = t1 == 'KTime'
    props = [{'type':'S','value':name},{'type':'S','value':t1},{'type':'S','value':t2},{'type':'S','value':t3}]
    for v in vals:
        if isinstance(v, str): props.append({'type':'S','value':v})
        elif isinstance(v, bool): props.append({'type':'C','value':v})
        elif isinstance(v, int) and int_t: props.append({'type':'I','value':v})
        elif isinstance(v, int) and long_t: props.append({'type':'L','value':v})
        elif isinstance(v, (int, float)): props.append({'type':'D','value':float(v)})
    return {'name':'P','props':props}

fid = bytes(random.randint(0,255) for _ in range(16))
verts = [-1.0,-1.0,-1.0, 1.0,-1.0,-1.0, 1.0,1.0,-1.0, -1.0,1.0,-1.0,
         -1.0,-1.0,1.0, 1.0,-1.0,1.0, 1.0,1.0,1.0, -1.0,1.0,1.0]
verts = [v * 100.0 for v in verts]
idx = [0,1,2, 0,2,~3,
       4,5,6, 4,6,~7,
       0,4,5, 0,5,~1,
       1,5,6, 1,6,~2,
       2,6,7, 2,7,~3,
       3,7,4, 3,4,~0]

w = W()
w.bytes_(b'Kaydara FBX Binary  ')
w.u8(0); w.u8(0x1A); w.u8(0)
w.u32(7400)

tree = []
tree.append({'name':'FBXHeaderExtension','props':[],'children':[
    {'name':'FBXHeaderVersion','props':[{'type':'I','value':1004}]},
    {'name':'FBXVersion','props':[{'type':'I','value':7400}]},
    {'name':'EncryptionType','props':[{'type':'I','value':0}]},
    {'name':'CreationTimeStamp','props':[],'children':[
        {'name':'Version','props':[{'type':'I','value':1000}]},
        {'name':'Year','props':[{'type':'I','value':2026}]},
        {'name':'Month','props':[{'type':'I','value':5}]},
        {'name':'Day','props':[{'type':'I','value':5}]},
        {'name':'Hour','props':[{'type':'I','value':12}]},
        {'name':'Minute','props':[{'type':'I','value':0}]},
        {'name':'Second','props':[{'type':'I','value':0}]},
        {'name':'Millisecond','props':[{'type':'I','value':0}]},
    ]},
    {'name':'Creator','props':[{'type':'S','value':'test'}]},
]})
tree.append({'name':'FileId','props':[{'type':'R','value':fid}]})
tree.append({'name':'CreationTime','props':[{'type':'S','value':'2026-05-05 12:00:00:000'}]})
tree.append({'name':'Creator','props':[{'type':'S','value':'test'}]})
tree.append({'name':'GlobalSettings','props':[],'children':[
    {'name':'Version','props':[{'type':'I','value':1000}]},
    {'name':'Properties70','props':[],'children':[
        P('UpAxis','int','Integer','',1),
        P('UpAxisSign','int','Integer','',1),
        P('FrontAxis','int','Integer','',2),
        P('FrontAxisSign','int','Integer','',1),
        P('CoordAxis','int','Integer','',0),
        P('CoordAxisSign','int','Integer','',1),
        P('UnitScaleFactor','double','Number','',1),
    ]},
]})
tree.append({'name':'Documents','props':[],'children':[
    {'name':'Count','props':[{'type':'I','value':1}]},
    {'name':'Document','props':[{'type':'L','value':1},{'type':'S','value':''},{'type':'S','value':'Scene'}],'children':[
        {'name':'Properties70','props':[],'children':[]},
        {'name':'RootNode','props':[{'type':'L','value':0}]},
    ]},
]})
tree.append({'name':'References','props':[],'children':[]})
tree.append({'name':'Definitions','props':[],'children':[
    {'name':'Version','props':[{'type':'I','value':100}]},
    {'name':'Count','props':[{'type':'I','value':3}]},
    {'name':'ObjectType','props':[{'type':'S','value':'GlobalSettings'}],'children':[
        {'name':'Count','props':[{'type':'I','value':1}]},
    ]},
    {'name':'ObjectType','props':[{'type':'S','value':'Geometry'}],'children':[
        {'name':'Count','props':[{'type':'I','value':1}]},
    ]},
    {'name':'ObjectType','props':[{'type':'S','value':'Model'}],'children':[
        {'name':'Count','props':[{'type':'I','value':1}]},
    ]},
]})
tree.append({'name':'Objects','props':[],'children':[
    {'name':'Geometry','props':[{'type':'L','value':100},{'type':'S','value':'Geometry::cube\x00\x01Geometry'},{'type':'S','value':'Mesh'}],'children':[
        {'name':'Vertices','props':[{'type':'d','value':verts}]},
        {'name':'PolygonVertexIndex','props':[{'type':'i','value':idx}]},
        {'name':'GeometryVersion','props':[{'type':'I','value':124}]},
    ]},
    {'name':'Model','props':[{'type':'L','value':200},{'type':'S','value':'Model::cube\x00\x01Model'},{'type':'S','value':'Mesh'}],'children':[
        {'name':'Version','props':[{'type':'I','value':232}]},
        {'name':'Properties70','props':[],'children':[]},
        {'name':'Shading','props':[{'type':'C','value':89}]},
        {'name':'Culling','props':[{'type':'S','value':'CullingOff'}]},
    ]},
]})
tree.append({'name':'Connections','props':[],'children':[
    {'name':'C','props':[{'type':'S','value':'OO'},{'type':'L','value':200},{'type':'L','value':0}]},
    {'name':'C','props':[{'type':'S','value':'OO'},{'type':'L','value':100},{'type':'L','value':200}]},
]})
tree.append({'name':'Takes','props':[],'children':[
    {'name':'Current','props':[{'type':'S','value':''}]},
]})

for n in tree:
    write_node(w, n)
w.u32(0); w.u32(0); w.u32(0); w.u8(0)

FOOT_CODE = bytes([0xfa,0xbc,0xab,0x09,0xd0,0xc8,0xd4,0x66,0xb1,0x76,0xfb,0x83,0x1c,0xf7,0x26,0x7e])
POST = bytes([0xf8,0x5a,0x8c,0x6a,0xde,0xf5,0xd9,0x7e,0xec,0xe9,0x0c,0xe3,0x75,0x8f,0x29,0x0b])
w.bytes_(FOOT_CODE)
while w.pos % 16 != 0: w.u8(0)
w.u32(0); w.u32(7400)
for _ in range(120): w.u8(0)
w.bytes_(POST)

import os
out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'test_out.fbx')
with open(out_path, 'wb') as f:
    f.write(w.b)
print('wrote', len(w.b), 'bytes to', out_path)
