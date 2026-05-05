import struct, sys, os
from collections import Counter

def parse(path):
    with open(path, 'rb') as f: data = f.read()
    sz = 8 if struct.unpack_from('<I', data, 23)[0] >= 7500 else 4
    fmt = '<Q' if sz == 8 else '<I'
    def pn(off):
        e = struct.unpack_from(fmt, data, off)[0]
        if e == 0: return None, off + (3*sz + 1)
        np = struct.unpack_from(fmt, data, off + sz)[0]
        pl = struct.unpack_from(fmt, data, off + 2*sz)[0]
        nl = data[off + 3*sz]
        return {'name': data[off+3*sz+1:off+3*sz+1+nl].decode('utf-8','replace'),
                'np': np, 'pl': pl, 'ps': off+3*sz+1+nl,
                'cs': off+3*sz+1+nl+pl, 'end': e}, e
    def pp(start, count):
        pos = start; out = []
        for _ in range(count):
            t = chr(data[pos]); pos += 1
            if t == 'I': out.append(struct.unpack_from('<i', data, pos)[0]); pos += 4
            elif t == 'L': out.append(struct.unpack_from('<q', data, pos)[0]); pos += 8
            elif t == 'D': out.append(struct.unpack_from('<d', data, pos)[0]); pos += 8
            elif t == 'C': out.append(data[pos]); pos += 1
            elif t in ('S','R'):
                ln = struct.unpack_from('<I', data, pos)[0]; pos += 4
                out.append(data[pos:pos+ln]); pos += ln
            elif t in 'fdli':
                ca = struct.unpack_from('<I', data, pos)[0]; pos += 4
                enc = struct.unpack_from('<I', data, pos)[0]; pos += 4
                cl = struct.unpack_from('<I', data, pos)[0]; pos += 4
                pos += cl
        return out

    counts = {}
    pos = 27
    while pos < len(data):
        n, nxt = pn(pos)
        if n is None: break
        if n['name'] == 'Objects':
            cp = n['cs']
            while cp < n['end']:
                cn, cnxt = pn(cp)
                if cn is None: break
                ps = pp(cn['ps'], cn['np'])
                if cn['name'] not in counts:
                    counts[cn['name']] = Counter()
                if len(ps) >= 2 and isinstance(ps[1], bytes):
                    name_bytes = ps[1]
                    counts[cn['name']][name_bytes] += 1
                cp = cnxt
            break
        pos = nxt
    return counts

for p in [r'C:\Users\Luka\Downloads\blender_convert.fbx', r'C:\Users\Luka\Downloads\step_optimized (18).fbx']:
    print(f'\n=== {os.path.basename(p)} ===')
    counts = parse(p)
    for typ, c in counts.items():
        unique = len(c)
        total = sum(c.values())
        most = c.most_common(3)
        print(f'  {typ}: {total} total, {unique} unique names')
        for name, cnt in most[:3]:
            short = name[:80].decode('utf-8', 'replace')
            print(f'    "{short}" x {cnt}')
