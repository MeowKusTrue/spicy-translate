import { describe, expect, it } from 'vitest';
import { parseDur, stretchLines, type Line } from '../src/core/index.ts';

describe('stretchLines', () => {
  it('scales lines and every word layer from the anchor', () => {
    const l: Line[] = [{ t: 10, end: 12, text: 'a b', tr: '', sync: { orig: [{ a: 10, b: 11 }, { a: 11, b: null }], bgo: [{ a: 20, b: 21, g: 1 }] } }];
    stretchLines(l, 1.1);
    expect([l[0].t, l[0].end]).toEqual([11, 13.2]);
    expect(l[0].sync!.orig).toEqual([{ a: 11, b: 12.1 }, { a: 12.1, b: null }]);
    expect(l[0].sync!.bgo![0]).toEqual({ a: 22, b: 23.1, g: 1 });
  });
  it('parses durations', () => {
    expect(parseDur('3:42.5')).toBe(222.5); expect(parseDur('222')).toBe(222); expect(parseDur('1:05,5')).toBe(65.5); expect(parseDur('abc')).toBeNaN();
  });
});
