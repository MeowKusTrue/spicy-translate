import { describe, expect, it } from 'vitest';
import { applySplits, learnSplits, sylCuts } from '../src/core/words.ts';

describe('remembered syllable splits', () => {
  it('learns cuts in letters, ignoring case and punctuation', () => {
    expect(sylCuts('Ма|ли|на,')).toEqual(['малина', [2, 4]]);
    expect(sylCuts('малина')).toBeNull();
    const d: Record<string, number[]> = {};
    expect(learnSplits('я ем ма|ли|ну и «О|ни»', d)).toEqual(['малину', 'они']);
    expect(learnSplits('ма|ли|ну', d)).toEqual([]); // nothing new
  });
  it('splits whole words elsewhere, keeps case, punctuation and divides the timing', () => {
    const d = { малина: [2, 4] };
    const r = applySplits('Малина, малина и ма|ли|на', [{ a: 1, b: 1.6 }, { a: 2, b: 2.6 }, { a: 3, b: 3.1 }, { a: 4, b: 4.2 }, { a: 4.2, b: 4.4 }, { a: 4.4, b: 4.6 }], d)!;
    expect(r.text).toBe('Ма|ли|на, ма|ли|на и ма|ли|на');
    expect(r.n).toBe(2);
    expect(r.sync!.length).toBe(10);
    expect(r.sync![0].a).toBe(1); expect(r.sync![2].b).toBe(1.6);
    expect(r.sync![1].a).toBe(r.sync![0].b);
  });
  it('leaves unknown, glued and already split words; drops a broken sync', () => {
    expect(applySplits('груша ма|ли|на', null, { малина: [2, 4] })).toBeNull();
    const r = applySplits('малина груша', [{ a: 1, b: 2 }], { малина: [2, 4] })!;
    expect(r.text).toBe('ма|ли|на груша'); expect(r.sync).toBeNull();
  });
});
