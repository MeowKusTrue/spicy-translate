// Cover art from an MP3's ID3v2 tag (APIC frame, v2.3 / v2.4; PIC in v2.2). Other containers: null.
export function id3Cover(b: Uint8Array): { mime: string; data: Uint8Array } | null {
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return null; // "ID3"
  const ver = b[3], syncsafe = (o: number) => (b[o] & 127) << 21 | (b[o + 1] & 127) << 14 | (b[o + 2] & 127) << 7 | (b[o + 3] & 127);
  const end = Math.min(b.length, 10 + syncsafe(6));
  let o = 10;
  if (b[5] & 0x40 && ver > 2) o += ver === 4 ? syncsafe(10) : (b[10] << 24 | b[11] << 16 | b[12] << 8 | b[13]) + 4; // extended header
  const idLen = ver === 2 ? 3 : 4, hdr = ver === 2 ? 6 : 10;
  while (o + hdr <= end) {
    const id = String.fromCharCode(...b.subarray(o, o + idLen));
    if (!/^[A-Z0-9]+$/.test(id)) break; // padding
    const size = ver === 2 ? b[o + 3] << 16 | b[o + 4] << 8 | b[o + 5] : ver === 4 ? syncsafe(o + 4) : (b[o + 4] << 24 | b[o + 5] << 16 | b[o + 6] << 8 | b[o + 7]) >>> 0;
    const f = o + hdr; o = f + size;
    if (id !== 'APIC' && id !== 'PIC') continue;
    const enc = b[f], wide = enc === 1 || enc === 2;
    let p = f + 1, mime: string;
    if (ver === 2) { const fmt = String.fromCharCode(...b.subarray(p, p + 3)).toLowerCase(); mime = fmt === 'png' ? 'image/png' : 'image/jpeg'; p += 3; }
    else { const z = b.indexOf(0, p); mime = String.fromCharCode(...b.subarray(p, z)) || 'image/jpeg'; p = z + 1; }
    p++; // picture type
    if (wide) { while (p + 1 < o && (b[p] || b[p + 1])) p += 2; p += 2; } else { while (p < o && b[p]) p++; p++; } // description
    if (!mime.includes('/')) mime = 'image/' + mime.toLowerCase().replace('jpg', 'jpeg');
    return p < o ? { mime, data: b.slice(p, Math.min(o, end)) } : null;
  }
  return null;
}
