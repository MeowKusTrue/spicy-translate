import { describe, expect, it } from 'vitest';
import { textDiff } from '../src/core/edit.ts';

describe('textDiff (Genius over synced lines)', () => {
  it('keeps our line breaks and syllable splits, fixes words', () => {
    const d = textDiff(['Ааа, мо|ре, песок', 'Ложись в мою тень', 'Я буду твоей пальмой'], ['А-ах, море, песок', 'Ложись в мою тень, я буду твоей пальмой']);
    expect(d.edits).toEqual([{ m: 0, row: 'А-ах, мо|ре, песок' }]);
    expect(d.adds).toEqual([]); expect(d.dels).toEqual([]);
  });
  it('whole rows we lack become additions, rows the reference lacks deletions', () => {
    const d = textDiff(['раз два', 'лишняя строка', 'три четыре'], ['Эй, фью', 'раз два', 'три четыре', 'пять']);
    expect(d.adds).toEqual([{ after: -1, row: 'Эй, фью' }, { after: 2, row: 'пять' }]);
    expect(d.dels).toEqual([1]); expect(d.edits).toEqual([]);
  });
  it('reference rows around a changed word are new lines, not glued to ours', () => {
    const d = textDiff(['Ааа, море', 'пальмой', 'дальше'], ['Эй, фью', 'А-ах, море', 'пальмой', 'Эй, эй', 'дальше']);
    expect(d.edits).toEqual([{ m: 0, row: 'А-ах, море' }]);
    expect(d.adds).toEqual([{ after: -1, row: 'Эй, фью' }, { after: 1, row: 'Эй, эй' }]);
  });
  it('a lone ad-lib does not anchor to an ad-lib elsewhere', () => {
    const d = textDiff(['Я буду твоей пальмой', 'дальше идём', 'и ещё (эй)'], ['Я буду твоей пальмой', 'Эй, эй, эй', 'дальше идём', 'и ещё (эй)']);
    expect(d.adds).toEqual([{ after: 0, row: 'Эй, эй, эй' }]); expect(d.edits).toEqual([]);
  });
  it('ad-libs heading a reference row go to our next line', () => {
    const d = textDiff(['Я буду твоей пальмой', 'Просыпаюсь от того'], ['Я буду твоей пальмой', 'Эй, эй, просыпаюсь от того']);
    expect(d.edits).toEqual([{ m: 1, row: 'Эй, эй, просыпаюсь от того' }]);
  });
  it('an extra word inside a row joins that row', () => {
    const d = textDiff(['я вижу', 'тебя'], ['я всё вижу', 'тебя (эй)']);
    expect(d.edits).toEqual([{ m: 0, row: 'я всё вижу' }, { m: 1, row: 'тебя (эй)' }]);
  });
});
