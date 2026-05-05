// Mirrors the JS FBX writer minus the THREE.js dependency. Generates the
// same minimal cube scene as fbx_test.py. If this output differs from the
// Python output byte-for-byte, the discrepancy reveals the JS bug.
import { writeFileSync } from 'node:fs';

class W {
  constructor() {
    this.buf = new ArrayBuffer(64 * 1024);
    this.view = new DataView(this.buf);
    this.bytes = new Uint8Array(this.buf);
    this.pos = 0;
  }
  _ensure(n) {
    if (this.pos + n <= this.buf.byteLength) return;
    let cap = this.buf.byteLength;
    while (this.pos + n > cap) cap *= 2;
    const nb = new ArrayBuffer(cap);
    new Uint8Array(nb).set(this.bytes.subarray(0, this.pos));
    this.buf = nb;
    this.view = new DataView(nb);
    this.bytes = new Uint8Array(nb);
  }
  u8(v)  { this._ensure(1); this.view.setUint8(this.pos, v); this.pos += 1; }
  i32(v) { this._ensure(4); this.view.setInt32(this.pos, v, true); this.pos += 4; }
  u32(v) { this._ensure(4); this.view.setUint32(this.pos, v >>> 0, true); this.pos += 4; }
  u64(v) {
    this._ensure(8);
    const lo = v >>> 0;
    const hi = Math.floor(v / 4294967296) >>> 0;
    this.view.setUint32(this.pos, lo, true);
    this.view.setUint32(this.pos + 4, hi, true);
    this.pos += 8;
  }
  patchU64(at, v) {
    const lo = v >>> 0;
    const hi = Math.floor(v / 4294967296) >>> 0;
    this.view.setUint32(at, lo, true);
    this.view.setUint32(at + 4, hi, true);
  }
  f64(v) { this._ensure(8); this.view.setFloat64(this.pos, v, true); this.pos += 8; }
  i64(v) { this._ensure(8); this.view.setBigInt64(this.pos, BigInt(v), true); this.pos += 8; }
  bytes_(b) { this._ensure(b.byteLength); this.bytes.set(b, this.pos); this.pos += b.byteLength; }
  finalize() { return new Uint8Array(this.buf, 0, this.pos); }
}

const TENC = new TextEncoder();

function writeScalar(w, type, value) {
  w.u8(type.charCodeAt(0));
  switch (type) {
    case 'I': w.i32(value); break;
    case 'C':
      if (typeof value === 'boolean') w.u8(value ? 89 : 78);
      else w.u8(value | 0);
      break;
    case 'D': w.f64(value); break;
    case 'L': w.i64(value); break;
    case 'S':
    case 'R': {
      const buf = typeof value === 'string' ? TENC.encode(value) : value;
      w.u32(buf.byteLength);
      w.bytes_(buf);
      break;
    }
  }
}

function writeArray(w, type, array) {
  w.u8(type.charCodeAt(0));
  let raw;
  switch (type) {
    case 'd': raw = new Uint8Array(new Float64Array(array).buffer); break;
    case 'i': raw = new Uint8Array(new Int32Array(array).buffer); break;
  }
  w.u32(array.length);
  w.u32(0);
  w.u32(raw.byteLength);
  w.bytes_(raw);
}

function writeNode(w, n) {
  const start = w.pos;
  w.u64(0);
  w.u64(n.props ? n.props.length : 0);
  const pl = w.pos;
  w.u64(0);
  const nm = TENC.encode(n.name || '');
  w.u8(nm.byteLength);
  w.bytes_(nm);
  const ps = w.pos;
  if (n.props) {
    for (const p of n.props) {
      if (p.type === 'd' || p.type === 'i' || p.type === 'f' || p.type === 'l' || p.type === 'b') {
        writeArray(w, p.type, p.value);
      } else {
        writeScalar(w, p.type, p.value);
      }
    }
  }
  w.patchU64(pl, w.pos - ps);
  if (n.children !== undefined) {
    for (const c of n.children) writeNode(w, c);
    w.u64(0); w.u64(0); w.u64(0); w.u8(0);
  }
  w.patchU64(start, w.pos);
}

function P(name, t1, t2, t3, ...vals) {
  const intT = t1 === 'int' || t1 === 'Integer' || t1 === 'enum';
  const longT = t1 === 'KTime';
  const props = [
    { type: 'S', value: name },
    { type: 'S', value: t1 },
    { type: 'S', value: t2 },
    { type: 'S', value: t3 },
  ];
  for (const v of vals) {
    if (typeof v === 'string') props.push({ type: 'S', value: v });
    else if (typeof v === 'boolean') props.push({ type: 'C', value: v });
    else if (typeof v === 'number') {
      if (intT) props.push({ type: 'I', value: v | 0 });
      else if (longT) props.push({ type: 'L', value: v });
      else props.push({ type: 'D', value: v });
    }
  }
  return { name: 'P', props };
}

const fid = new Uint8Array(16);
for (let i = 0; i < 16; i++) fid[i] = (Math.random() * 256) | 0;
const verts = [-1,-1,-1, 1,-1,-1, 1,1,-1, -1,1,-1, -1,-1,1, 1,-1,1, 1,1,1, -1,1,1].map(v => v * 100.0);
const idx = [
  0,1,2, 0,2,~3,
  4,5,6, 4,6,~7,
  0,4,5, 0,5,~1,
  1,5,6, 1,6,~2,
  2,6,7, 2,7,~3,
  3,7,4, 3,4,~0,
];

const w = new W();
w.bytes_(TENC.encode('Kaydara FBX Binary  '));
w.u8(0); w.u8(0x1A); w.u8(0);
w.u32(7500);

const tree = [];
tree.push({ name: 'FBXHeaderExtension', props: [], children: [
  { name: 'FBXHeaderVersion', props: [{ type: 'I', value: 1004 }] },
  { name: 'FBXVersion', props: [{ type: 'I', value: 7500 }] },
  { name: 'EncryptionType', props: [{ type: 'I', value: 0 }] },
  { name: 'CreationTimeStamp', props: [], children: [
    { name: 'Version', props: [{ type: 'I', value: 1000 }] },
    { name: 'Year', props: [{ type: 'I', value: 2026 }] },
    { name: 'Month', props: [{ type: 'I', value: 5 }] },
    { name: 'Day', props: [{ type: 'I', value: 5 }] },
    { name: 'Hour', props: [{ type: 'I', value: 12 }] },
    { name: 'Minute', props: [{ type: 'I', value: 0 }] },
    { name: 'Second', props: [{ type: 'I', value: 0 }] },
    { name: 'Millisecond', props: [{ type: 'I', value: 0 }] },
  ]},
  { name: 'Creator', props: [{ type: 'S', value: 'test' }] },
]});
tree.push({ name: 'FileId', props: [{ type: 'R', value: fid }] });
tree.push({ name: 'CreationTime', props: [{ type: 'S', value: '2026-05-05 12:00:00:000' }] });
tree.push({ name: 'Creator', props: [{ type: 'S', value: 'test' }] });
tree.push({ name: 'GlobalSettings', props: [], children: [
  { name: 'Version', props: [{ type: 'I', value: 1000 }] },
  { name: 'Properties70', props: [], children: [
    P('UpAxis','int','Integer','',1),
    P('UpAxisSign','int','Integer','',1),
    P('FrontAxis','int','Integer','',2),
    P('FrontAxisSign','int','Integer','',1),
    P('CoordAxis','int','Integer','',0),
    P('CoordAxisSign','int','Integer','',1),
    P('UnitScaleFactor','double','Number','',1),
  ]},
]});
tree.push({ name: 'Documents', props: [], children: [
  { name: 'Count', props: [{ type: 'I', value: 1 }] },
  { name: 'Document', props: [
    { type: 'L', value: 1 },
    { type: 'S', value: '' },
    { type: 'S', value: 'Scene' },
  ], children: [
    { name: 'Properties70', props: [], children: [] },
    { name: 'RootNode', props: [{ type: 'L', value: 0 }] },
  ]},
]});
tree.push({ name: 'References', props: [], children: [] });
tree.push({ name: 'Definitions', props: [], children: [
  { name: 'Version', props: [{ type: 'I', value: 100 }] },
  { name: 'Count', props: [{ type: 'I', value: 3 }] },
  { name: 'ObjectType', props: [{ type: 'S', value: 'GlobalSettings' }], children: [
    { name: 'Count', props: [{ type: 'I', value: 1 }] },
  ]},
  { name: 'ObjectType', props: [{ type: 'S', value: 'Geometry' }], children: [
    { name: 'Count', props: [{ type: 'I', value: 1 }] },
  ]},
  { name: 'ObjectType', props: [{ type: 'S', value: 'Model' }], children: [
    { name: 'Count', props: [{ type: 'I', value: 1 }] },
  ]},
]});
tree.push({ name: 'Objects', props: [], children: [
  { name: 'Geometry', props: [
    { type: 'L', value: 100 },
    { type: 'S', value: 'Geometry::cube\x00\x01Geometry' },
    { type: 'S', value: 'Mesh' },
  ], children: [
    { name: 'Vertices', props: [{ type: 'd', value: verts }] },
    { name: 'PolygonVertexIndex', props: [{ type: 'i', value: idx }] },
    { name: 'GeometryVersion', props: [{ type: 'I', value: 124 }] },
  ]},
  { name: 'Model', props: [
    { type: 'L', value: 200 },
    { type: 'S', value: 'Model::cube\x00\x01Model' },
    { type: 'S', value: 'Mesh' },
  ], children: [
    { name: 'Version', props: [{ type: 'I', value: 232 }] },
    { name: 'Properties70', props: [], children: [] },
    { name: 'Shading', props: [{ type: 'C', value: 89 }] },
    { name: 'Culling', props: [{ type: 'S', value: 'CullingOff' }] },
  ]},
]});
tree.push({ name: 'Connections', props: [], children: [
  { name: 'C', props: [{ type: 'S', value: 'OO' }, { type: 'L', value: 200 }, { type: 'L', value: 0 }] },
  { name: 'C', props: [{ type: 'S', value: 'OO' }, { type: 'L', value: 100 }, { type: 'L', value: 200 }] },
]});
tree.push({ name: 'Takes', props: [], children: [
  { name: 'Current', props: [{ type: 'S', value: '' }] },
]});

for (const n of tree) writeNode(w, n);
w.u64(0); w.u64(0); w.u64(0); w.u8(0);

const FOOT_CODE = new Uint8Array([0xfa,0xbc,0xab,0x09,0xd0,0xc8,0xd4,0x66,0xb1,0x76,0xfb,0x83,0x1c,0xf7,0x26,0x7e]);
const POST = new Uint8Array([0xf8,0x5a,0x8c,0x6a,0xde,0xf5,0xd9,0x7e,0xec,0xe9,0x0c,0xe3,0x75,0x8f,0x29,0x0b]);
w.bytes_(FOOT_CODE);
while (w.pos % 16 !== 0) w.u8(0);
w.u32(0);
w.u32(7500);
for (let i = 0; i < 120; i++) w.u8(0);
w.bytes_(POST);

const out = w.finalize();
writeFileSync('test_out_js.fbx', out);
console.log('wrote', out.byteLength, 'bytes to test_out_js.fbx');
