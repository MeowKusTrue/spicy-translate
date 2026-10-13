import { describe, expect, it } from 'vitest';
import { liveLines } from '../src/core/index.ts';

describe('liveLines', () => {
  const R = [{ a: 1, b: 3 }, { a: 2.8, b: 5 }, { a: 8, b: 9 }];
  it('overlapping lines are both active; the newest is the scroll target', () => {
    expect(liveLines(R, 2.9)).toEqual({ act: 1, live: [0, 1], active: [0, 1], idx: 1 });
  });
  it('the previous line keeps painting after it stops being active (no frozen half-filled word)', () => {
    const r = liveLines(R, 3.4);
    expect(r.active).toEqual([1]);
    expect(r.live).toEqual([0, 1]);
  });
  it('next line activates `look` seconds early; gaps have no active line', () => {
    expect(liveLines(R, 7.75).active).toEqual([2]);
    expect(liveLines(R, 6.5)).toMatchObject({ act: 1, active: [], idx: -1 });
  });
});
