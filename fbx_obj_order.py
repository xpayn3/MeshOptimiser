import struct, sys
def parse(path, label):
    with open(path,'rb') as f: data = f.read()
    sz = 8 if struct.unpack_from('<I',data,23)[0]>=7500 else 4
    fmt = '<Q' if sz==8 else '<I'
    def pn(off):
        e = struct.unpack_from(fmt,data,off)[0]
        if e == 0: return None, off+(3*sz+1)
        np = struct.unpack_from(fmt,data,off+sz)[0]
        pl = struct.unpack_from(fmt,data,off+2*sz)[0]
        nl = data[off+3*sz]
        nm = data[off+3*sz+1:off+3*sz+1+nl].decode()
        return {'name':nm,'cs':off+3*sz+1+nl+pl,'end':e}, e
    pos = 27
    while pos < len(data):
        n, nxt = pn(pos)
        if n is None: break
        if n['name'] == 'Objects':
            print(label, '- first 12 objects:')
            cp = n['cs']; cnt = 0
            seen_types = []
            while cp < n['end']:
                cn, cnxt = pn(cp)
                if cn is None: break
                if cnt < 20:
                    print(f'  [{cnt}] {cn["name"]}')
                if not seen_types or seen_types[-1] != cn['name']:
                    seen_types.append(cn['name'])
                cnt += 1
                cp = cnxt
            print(f'  Type sequence: {seen_types}')
            print()
            return
        pos = nxt

parse(r'C:\Users\Luka\Downloads\blender_convert.fbx', 'BLENDER')
parse(r'C:\Users\Luka\Downloads\step_optimized (17).fbx', 'OURS')
