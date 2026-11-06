import { describe, expect, it } from 'vitest';
import { editorReview, layerProgress, retimeWord } from '../src/core/editor.ts';
import type { Line } from '../src/core/types.ts';

const line = (): Line => ({ t: 1, end: 4, text: 'раз два три', tr: '', sync: { orig: [{ a: 1, b: 2, g: 1, c: .1 }, { a: 2, b: 3, g: 1 }, { a: 3, b: 4 }] } });
describe('word editing', () => {
  it('plans an exact edit with shared boundaries atomically, keeping the input untouched', () => {
    const l = line(), original = structuredClone(l), result = retimeWord(l, 'orig', 1, 2.1254, 3.2);
    expect(result).toEqual({ sync: [{ a: 1, b: 2.125 }, { a: 2.125, b: 3.2 }, { a: 3.2, b: 4 }] });
    expect(l).toEqual(original);
  });
  it('rejects crossing same-line neighbours without changing the phrase', () => {
    const l = line();
    expect(retimeWord(l, 'orig', 1, 1.5, 3, false)).toHaveProperty('error');
    expect(retimeWord(l, 'orig', 1, 2, 4.1)).toHaveProperty('error');
    expect(l).toEqual(line());
  });
  it('accepts independent times without constraining them to the phrase end', () => {
    const result = retimeWord(line(), 'orig', 2, 3, 6);
    expect('sync' in result && result.sync[2]).toEqual({ a: 3, b: 6 });
  });
  it('validates finite nonnegative times and minimum duration after rounding', () => {
    for (const [a, b] of [[NaN, 2], [1, Infinity], [-1, 2], [2, 2], [2, 2.0194]]) expect(retimeWord(line(), 'orig', 1, a, b)).toHaveProperty('error');
    expect(retimeWord(line(), 'orig', 1, 2, 2.02)).toHaveProperty('sync');
    expect(retimeWord(line(), 'bgo', 0, 1, 2)).toHaveProperty('error');
  });
  it('does not confirm neighbouring auto words when their boundary is unchanged', () => {
    const result = retimeWord(line(), 'orig', 1, 2, 3);
    expect('sync' in result && result.sync[0]).toEqual(line().sync!.orig![0]);
    expect('sync' in result && result.sync[1]).toEqual({ a: 2, b: 3 });
  });
});
describe('editor review and progress', () => {
  it('finds auto drafts, missing spans and same-line errors while ignoring short punctuation', () => {
    const ls: Line[] = [line(), { t: 5, end: 8, text: 'эх — да', tr: '', sync: { orig: [{ a: 5, b: 5.025 }, { a: 5.1, b: 5.12 }, { a: 6, b: 6.5 }] } }, { t: 10, end: 11, text: 'новое', tr: '' }];
    expect(editorReview(ls, 'orig').map(x => [x.i, x.k])).toEqual([[0, 0], [0, 1], [1, 0], [2, 0]]);
    ls[0].sync!.orig![1].a = 1.9;
    expect(editorReview(ls, 'orig')[1].reason).toContain('Перекрытие');
  });
  it('treats a word-count mismatch as unmarked, not as valid reused timings', () => {
    const l = line(); l.text = 'первый второй';
    expect(editorReview([l], 'orig')).toHaveLength(2);
    expect(layerProgress([l], 'orig').marked).toBe(0);
  });
  it('counts only populated lines of the selected layer and keeps the background separate', () => {
    const ls: Line[] = [line(), { t: 2, end: 3, text: '', tr: '', bg: { text: 'эй', tr: '' }, sync: { bgo: [{ a: 2, b: 3 }] } }];
    expect(layerProgress(ls, 'orig')).toEqual({ total: 1, done: 0, words: 3, marked: 3, auto: 2 });
    expect(layerProgress(ls, 'bgo')).toEqual({ total: 1, done: 1, words: 1, marked: 1, auto: 0 });
  });
});
