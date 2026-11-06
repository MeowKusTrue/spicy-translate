import { describe, expect, it } from 'vitest';
import { applySyllableDraft, buildTTML, planFitAll, splitRussian, syllableDraft, type Line } from '../src/core/index.ts';

describe('fit every line for export without changing word times', () => {
  const fixture = (): Line[] => [
    { t: 0, end: 9, text: 'раз два', tr: '', bg: { text: 'эй', tr: '' }, sync: { orig: [{ a: 2, b: 3 }, { a: 3, b: 4 }], bgo: [{ a: 1.5, b: 4.5 }] } },
    { t: 2.2, end: 10, text: 'другая партия', tr: '', sync: { orig: [{ a: 3, b: 4 }, { a: 4, b: 5 }] } },
    { t: 7, end: 15, text: 'не всё', tr: '', sync: { orig: [{ a: 8, b: 9 }, { a: null, b: null }] } },
  ];
  it('includes backing edges, preserves overlaps and leaves partial lines and input untouched', () => {
    const lines = fixture(), before = JSON.stringify(lines), r = planFitAll(lines, 'original');
    expect(r.changed).toBe(2); expect(r.skipped).toBe(1);
    expect(r.lines.map(l => [l.t, l.end])).toEqual([[1.5, 4.5], [3, 5], [7, 15]]);
    expect(r.lines.map(l => l.sync)).toEqual(lines.map(l => l.sync)); expect(JSON.stringify(lines)).toBe(before);
    expect(planFitAll(r.lines, 'original').changed).toBe(0);
  });
  it('does not trust invalid or mismatching sync arrays and uses the project language layer', () => {
    const lines = fixture(); lines[0].sync!.bgo![0].b = Infinity; expect(planFitAll(lines, 'original').lines[0]).toBe(lines[0]);
    lines[1].tr = 'перевод'; lines[1].sync!.tr = [{ a: 6, b: 7 }];
    expect(planFitAll(lines, 'translation').lines[1].t).toBe(6);
    expect(planFitAll(lines, 'original').lines[1].t).toBe(3);
  });
  it('fits even line-timing TTML exports, so callers cannot forget preparation', () => {
    const l: Line = { t: 0, end: 10, text: 'слово', tr: '', sync: { orig: [{ a: 2, b: 3 }] } };
    const out = buildTTML({ lines: [l], mode: 'original', wordSpread: false });
    expect(out).toContain('<p begin="0:02.000" end="0:03.000"'); expect(l.t).toBe(0);
  });
  it('exports in time order when fitting changes the original order of phrases', () => {
    const lines: Line[] = [
      { t: 0, end: 12, text: 'поздняя', tr: '', sync: { orig: [{ a: 8, b: 9 }] } },
      { t: 1, end: 7, text: 'ранняя', tr: '', sync: { orig: [{ a: 2, b: 3 }] } },
    ];
    const out = buildTTML({ lines, mode: 'original' });
    expect(out.indexOf('ранняя')).toBeLessThan(out.indexOf('поздняя')); expect(lines[0].text).toBe('поздняя');
  });
});
describe('Russian transfer patterns and explicit vocal approximation', () => {
  it('respects signs, й, doubled consonants and both cases without changing letters', () => {
    for (const [w, expected] of [['музыку', 'му|зы|ку'], ['район', 'рай|он'], ['подъезд', 'подъ|езд'], ['пальто', 'паль|то'], ['рассвет', 'рас|свет'], ['КРАСИВЫЙ', 'КРАСИВЫЙ'], ['«Красивый!»', '«Кра|си|вый!»']]) {
      expect(splitRussian(w).join('|')).toBe(expected); expect(splitRussian(w).join('')).toBe(w);
    }
    expect(splitRussian('по-моему').join('')).toBe('по-моему');
    expect(splitRussian('оставим', 'vocal')).toEqual(['о', 'ста', 'вим']);
  });
  it('does not apply Russian patterns to Kazakh, English, mixed script or numbers', () => {
    for (const w of ['әдемі', 'қайдан', 'hello', 'Пpивет', '20-й']) expect(splitRussian(w)).toEqual([w]);
  });
  it('preserves manual boundaries and the outer word span, flags new syllable timing as draft', () => {
    const l: Line = { t: 1, end: 5, text: 'музыку кра|си|вый', tr: '', sync: { orig: [{ a: 1, b: 3 }, { a: 3, b: 3.5 }, { a: 3.5, b: 4 }, { a: 4, b: 5 }] } };
    const text = syllableDraft(l, 'orig'); expect(text).toBe('му|зы|ку кра|си|вый');
    const r = applySyllableDraft(l, 'orig', text); if ('error' in r) throw new Error(r.error);
    expect(r.sync?.[0].a).toBe(1); expect(r.sync?.[2].b).toBe(3); expect(r.sync?.slice(0, 3).every(x => x.g)).toBe(true);
    expect(r.sync?.slice(3)).toEqual(l.sync!.orig!.slice(1));
    expect(applySyllableDraft(l, 'orig', 'новый текст')).toHaveProperty('error');
  });
});
