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

import { units } from '../src/core/words.ts';
import { repeatSyllablePlans } from '../src/core/russianSyllables.ts';
import type { Line } from '../src/core/types.ts';

it('keeps hyphens with the preceding syllable for remembered and existing splits', () => {
  const dict = {}; learnSplits('а-|а-|а Бо-|боюсь,', dict);
  expect(applySplits('а-а-а Бо-боюсь,', null, dict)!.text).toBe('а-|а-|а Бо-|боюсь,');
  expect(units('а|-а|-а').map(u => u.w)).toEqual(['а-', 'а-', 'а']);
});
it('applies word boundaries only to repeat lines and retains their own timing', () => {
  const lines: Line[] = [
    { t: 1, end: 3, tr: '', text: 'Это малина', sync: { orig: [{a:1,b:2},{a:2,b:3}] } },
    { t: 10, end: 12, tr: '', text: 'Это ма|лина', sync: { orig: [{a:10,b:11},{a:11,b:11.4},{a:11.4,b:12}] } },
    { t: 20, end: 22, tr: '', text: 'Там малина' }
  ];
  const plans = repeatSyllablePlans(lines, lines[0], 'orig', 1, 'ма|ли|на');
  expect(plans.map(p => p.i)).toEqual([0, 1]);
  expect(plans[1].text).toBe('Это ма|ли|на');
  expect(plans[1].sync![0]).toEqual({a:10,b:11});
  expect(plans[1].sync!.at(-1)!.b).toBe(12);
  expect(lines[1].text).toBe('Это ма|лина');
});

import { buildTTML } from '../src/core/export.ts';

it('exports hyphens on the left syllable with exact original timing on lead and background', () => {
  for (const text of ['а-|а-|а', 'а|-а|-а']) {
    const sync = [{ a: 1, b: 2 }, { a: 2, b: 3 }, { a: 3, b: 4 }];
    const xml = buildTTML({ lines: [{ t: 1, end: 4, text, tr: '', bg: {text, tr: ''}, sync: { orig: sync, bgo: sync } }], mode: 'original' });
    const expected = '<span begin="0:01.000" end="0:02.000">а-</span><span begin="0:02.000" end="0:03.000">а-</span><span begin="0:03.000" end="0:04.000">а</span>';
    expect(xml).toContain(expected + '<span ttm:role="x-bg">' + expected + '</span>');
    expect(xml).not.toMatch(/>[-‐‑]а/);
  }
});
