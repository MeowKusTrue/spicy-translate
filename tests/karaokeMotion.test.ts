import { describe, expect, it } from 'vitest';
import { karaokeMotion } from '../src/core/index.ts';
describe('smooth karaoke motion stays on the word clock', () => {
 it('starts and ends at rest for words and letters', () => {
  for (const letter of [false,true]) for (const p of [-1,0,1,2]) { const m = karaokeMotion(p,letter); expect(m.s).toBeCloseTo(1); expect(m.y).toBeCloseTo(0); expect(m.g).toBeCloseTo(0); }
 });
 it('has a gentle symmetric peak and no jump at either boundary', () => {
  for (const letter of [false,true]) { const peak = karaokeMotion(.5,letter); expect(peak.s).toBeGreaterThan(1); expect(peak.s).toBeLessThanOrEqual(1.06); for (const key of ['s','y','g'] as const) expect(karaokeMotion(.25,letter)[key]).toBeCloseTo(karaokeMotion(.75,letter)[key]); expect(karaokeMotion(.0001,letter).s-1).toBeLessThan(.000001); expect(karaokeMotion(.9999,letter).s-1).toBeLessThan(.000001); }
 });
});
