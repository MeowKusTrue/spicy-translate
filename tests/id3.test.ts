import { describe, expect, it } from 'vitest';
import { id3Cover } from '../src/core/id3.ts';

const ss = (n: number) => [n >> 21 & 127, n >> 14 & 127, n >> 7 & 127, n & 127];
function tag(ver: 3 | 4, frames: number[][]) {
  const body = frames.flat();
  return new Uint8Array([0x49, 0x44, 0x33, ver, 0, 0, ...ss(body.length + 16), ...body, ...new Array(16).fill(0), 0xff, 0xfb]);
}
const frame = (ver: 3 | 4, id: string, data: number[]) => {
  const n = data.length, size = ver === 4 ? ss(n) : [n >>> 24, n >> 16 & 255, n >> 8 & 255, n & 255];
  return [...[...id].map(c => c.charCodeAt(0)), ...size, 0, 0, ...data];
};
const str = (s: string) => [...s].map(c => c.charCodeAt(0));

describe('id3Cover', () => {
  it('finds APIC after other frames (v2.3, latin1 description)', () => {
    const img = [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3];
    const b = tag(3, [frame(3, 'TIT2', [0, ...str('Song')]), frame(3, 'APIC', [0, ...str('image/jpeg'), 0, 3, ...str('cover'), 0, ...img])]);
    const c = id3Cover(b)!;
    expect(c.mime).toBe('image/jpeg');
    expect([...c.data]).toEqual(img);
  });
  it('handles UTF-16 descriptions and syncsafe sizes (v2.4)', () => {
    const img = [0x89, 0x50, 0x4e, 0x47, 9, 9];
    const c = id3Cover(tag(4, [frame(4, 'APIC', [1, ...str('image/png'), 0, 3, 0xff, 0xfe, 0x41, 0, 0, 0, ...img])]))!;
    expect(c.mime).toBe('image/png');
    expect([...c.data]).toEqual(img);
  });
  it('null without a tag or picture', () => {
    expect(id3Cover(new Uint8Array([0xff, 0xfb, 0, 0]))).toBeNull();
    expect(id3Cover(tag(3, [frame(3, 'TIT2', [0, ...str('x')])]))).toBeNull();
  });
});
