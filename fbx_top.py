"""Dump top-level node order + a few key children for any FBX file."""
import struct, sys

def dump(path):
    with open(path, 'rb') as f: data = f.read()
    print(f'\n=== {path} ({len(data):,} bytes) ===')
    ver = struct.unpack_from('<I', data, 23)[0]
    print(f'  version={ver}')
    sz = 8 if ver >= 7500 else 4
    fmt = '<Q' if sz==8 else '<I'

    def parse_node(off):
        e = struct.unpack_from(fmt,data,off)[0]
        if e == 0: return None, off+(3*sz+1)
        np = struct.unpack_from(fmt,data,off+sz)[0]
        pl = struct.unpack_from(fmt,data,off+2*sz)[0]
        nl = data[off+3*sz]
        return {'name':data[off+3*sz+1:off+3*sz+1+nl].decode('utf-8','replace'),
                'np':np,'pl':pl,'ps':off+3*sz+1+nl,'cs':off+3*sz+1+nl+pl,'end':e}, e

    pos = 27
    while pos < len(data):
        n, nxt = parse_node(pos)
        if n is None:
            print(f'  [{pos:>10,}] NULL terminator')
            break
        print(f'  [{pos:>10,}] {n["name"]:<24s} props={n["np"]} prop_bytes={n["pl"]:,} end={n["end"]:,}')
        pos = nxt

for p in [r'C:\Users\Luka\Downloads\blender_convert.fbx',
          r'C:\Users\Luka\Downloads\step_optimized (12).fbx']:
    dump(p)
