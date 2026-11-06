import { describe, it, expect } from 'vitest';
import { selectedWordRange, textDraftLine, applySyllableDraft, type Line } from '../src/core/index.ts';

describe('live text drafts and single-word syllables', () => {
  const line = (): Line => ({ t: 1, end: 6, text: 'тихое море', tr: 'quiet sea', bg: { text: 'эй', tr: 'hey' }, sync: { orig: [{ a: 1, b: 2 }, { a: 3, b: 6 }], bgo: [{ a: 2, b: 3 }] } });
  it('splits immediately without touching saved data or the other language and back', () => {
    const l = line(), before = JSON.stringify(l), draft = textDraftLine(l, 'orig', 'тихое мо|ре');
    expect(JSON.stringify(l)).toBe(before); expect(draft.sync!.orig).toHaveLength(3);
    expect(draft.sync!.orig![0]).toEqual({ a: 1, b: 2 });
    expect(draft.sync!.orig![1].a).toBe(3); expect(draft.sync!.orig![2].b).toBe(6);
    expect(draft.sync!.orig!.slice(1).every(w => w.g === 1)).toBe(true);
    expect(draft.bg).toEqual(l.bg); expect(draft.tr).toBe('quiet sea');
  });
  it('can preview a new back independently', () => {
    const l = line(); delete l.bg;
    const draft = textDraftLine(l, 'bgo', 'э|й'); expect(l.bg).toBeUndefined();
    expect(draft.bg).toEqual({ text: 'э|й', tr: '' }); expect(draft.sync!.orig).toEqual(l.sync!.orig); expect(draft.sync!.bgo).toHaveLength(2);
  });
  it('locates the complete selected word including its syllables, preserving whitespace and glued tokens', () => {
    expect(selectedWordRange('ти|хое  мо|ре дальше', 3)).toEqual({ start: 8, end: 13, word: 'мо|ре', k: 2 });
    expect(selectedWordRange('раз два\u00a0три четыре', 1)?.word).toBe('два\u00a0три');
    expect(selectedWordRange('слово', 7)).toBeNull();
  });
  it('applying boundaries of the selected word preserves its neighbours exactly', () => {
    const l = line(), r = selectedWordRange(l.text, 1)!;
    const full = l.text.slice(0, r.start) + 'мо|ре' + l.text.slice(r.end);
    const result = applySyllableDraft(l, 'orig', full);
    expect(result.text).toBe('тихое мо|ре'); expect(result.sync![0]).toEqual(l.sync!.orig![0]);
  });
});
