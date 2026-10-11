"""
从 PE(.exe) 中提取 RT_GROUP_ICON / RT_ICON 资源，重建 ICO 并导出 PNG，
用于确认打包后的 exe 确实内嵌了我们的自定义图标（而非 Electron 默认图标）。
"""
import struct, sys, os

def read_pe_resources(exe_path):
    with open(exe_path, 'rb') as f:
        data = f.read()

    e_lfanew = struct.unpack_from('<I', data, 0x3C)[0]
    assert data[e_lfanew:e_lfanew + 4] == b'PE\x00\x00', 'not a PE file'
    coff = e_lfanew + 4
    num_sections = struct.unpack_from('<H', data, coff + 2)[0]
    opt_size = struct.unpack_from('<H', data, coff + 16)[0]
    opt_off = coff + 20

    magic = struct.unpack_from('<H', data, opt_off)[0]
    assert magic == 0x20B, 'expected PE32+'
    # data directory 起始：PE32+ 固定 112 字节
    dd_off = opt_off + 112
    res_rva, res_size = struct.unpack_from('<II', data, dd_off + 2 * 8)

    sect_off = opt_off + opt_size
    sections = []
    for i in range(num_sections):
        o = sect_off + i * 40
        name = data[o:o + 8].rstrip(b'\x00').decode('latin1')
        vsize, vaddr, rsize, raddr = struct.unpack_from('<IIII', data, o + 8)
        sections.append((vaddr, vsize, raddr, rsize))

    def rva2off(rva):
        for vaddr, vsize, raddr, rsize in sections:
            if vaddr <= rva < vaddr + max(vsize, rsize):
                return raddr + (rva - vaddr)
        raise ValueError(f'RVA 0x{rva:x} 未映射到任何节')

    base = rva2off(res_rva)

    def parse_dir(off, level, path):
        """递归解析资源目录，返回 {type: {name: {lang: dataentry}}}"""
        result = {}
        n_named, n_id = struct.unpack_from('<HH', data, off + 12)
        total = n_named + n_id
        for i in range(total):
            e = off + 16 + i * 8
            name_id, offset = struct.unpack_from('<II', data, e)
            if offset & 0x80000000:
                sub = base + (offset & 0x7FFFFFFF)
                result[name_id] = parse_dir(sub, level + 1, path + [name_id])
            else:
                sub = base + offset
                # data entry: RVA, size, codepage, reserved
                d_rva, d_size = struct.unpack_from('<II', data, sub)
                result[name_id] = (rva2off(d_rva), d_size)
        return result

    return data, parse_dir(base, 0, [])


def rebuild_ico(exe_path, out_ico):
    data, root = read_pe_resources(exe_path)
    RT_ICON = 3
    RT_GROUP_ICON = 14

    if RT_GROUP_ICON not in root:
        raise SystemExit('exe 中没有 RT_GROUP_ICON 资源')
    # 结构：type -> name -> lang -> (off,size)
    group_names = root[RT_GROUP_ICON]
    g_name = next(iter(group_names))
    group_langs = group_names[g_name]
    g_lang = next(iter(group_langs))
    g_off, g_size = group_langs[g_lang]

    # GRPICONDIR: reserved(2) type(2) count(2) then count * GRPICONDIRENTRY(14)
    count = struct.unpack_from('<H', data, g_off + 4)[0]
    entries = []
    for i in range(count):
        eo = g_off + 6 + i * 14
        w, h, colors, res, planes, bpp, size, ico_id = struct.unpack_from('<BBBBHHIH', data, eo)
        entries.append((w, h, colors, res, planes, bpp, size, ico_id))

    icon_names = root[RT_ICON]
    blobs = []
    for (w, h, colors, res, planes, bpp, size, ico_id) in entries:
        if ico_id not in icon_names:
            continue
        langs = icon_names[ico_id]
        l_id = next(iter(langs))
        b_off, b_size = langs[l_id]
        blobs.append((w, h, colors, res, planes, bpp, data[b_off:b_off + b_size]))

    # 写出 ICO
    n = len(blobs)
    header = struct.pack('<HHH', 0, 1, n)
    dir_entries = b''
    payload = b''
    offset = 6 + n * 16
    for (w, h, colors, res, planes, bpp, blob) in blobs:
        # ICO 目录项中，宽/高为 0 表示 256
        dir_entries += struct.pack('<BBBBHHII', w, h, colors, res, planes, bpp, len(blob), offset)
        payload += blob
        offset += len(blob)
    with open(out_ico, 'wb') as f:
        f.write(header + dir_entries + payload)

    return [(b[0] or 256, b[1] or 256, len(b[6])) for b in blobs], out_ico


if __name__ == '__main__':
    exe = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else 'extracted.ico'
    info, path = rebuild_ico(exe, out)
    print('提取到图标尺寸(宽,高,字节):')
    for t in info:
        print('  ', t)
    print('输出:', path)

    from PIL import Image
    ico = Image.open(path)
    print('ICO 含尺寸:', sorted(ico.info.get('sizes', [])))
