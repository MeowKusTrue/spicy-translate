import { describe, expect, it } from 'vitest';
import { bandRows, fitAndSort, fitLineToWords, fitsWords, lineAt, lineEdgeAt, moveLineEdge, moveEdge, moveWord, seqWords, snapSpan, startEdge, startMove, type Line } from '../src/core/index.ts';

const mk = (): Line[] => [{ t: 0, end: 3, text: 'раз два три', tr: '', sync: { orig: [{ a: 0, b: 1 }, { a: 1, b: 2 }, { a: 2.5, b: 3 }] } }];

describe('timeline core', () => {
  it('glued edges roll together; Alt detaches; no overlaps', () => {
    const ls = mk(), sq = seqWords(ls, 'orig');
    const roll = startEdge(sq, 0, 'b', false, 1);
    expect(roll.roll).toBe(true);
    moveEdge({ ...roll, edge: 'b' }, 1.4);
    expect([ls[0].sync!.orig![0].b, ls[0].sync!.orig![1].a]).toEqual([1.4, 1.4]);
    const det = startEdge(sq, 0, 'b', true, 1.2); // cursor right of the joint -> trims the right word
    expect(det.roll).toBe(false);
    expect(moveEdge({ ...det, edge: 'b' }, 5)).toBe(false); // clamped by the word's own end
  });
  it('moving a word keeps it between neighbours; glued neighbours stretch unless alone', () => {
    const ls = mk(), sq = seqWords(ls, 'orig'), d = startMove(sq, 1);
    moveWord(d, 1.3, false);
    expect([ls[0].sync!.orig![0].b, ls[0].sync!.orig![1].a, ls[0].sync!.orig![1].b]).toEqual([1.3, 1.3, 2.3]);
    expect(moveWord(d, 9, true)).toBe(false); // can't jump over the next word
    expect(snapSpan(0.98, 0.5, [1], 0.05)).toEqual({ a: 1, at: 1 });
  });
  it('band rows and lineAt for overlapping lines', () => {
    const ls: Line[] = [{ t: 0, end: 4, text: 'a', tr: '' }, { t: 1, end: 2, text: '', tr: '', bg: { text: 'ой', tr: '' } }, { t: 5, end: 6, text: 'b', tr: '' }];
    expect(bandRows(ls)).toEqual([0, 1, 0]);
    expect(lineAt(ls, 1.5)).toBe(0); // the lead line wins over a bg-only one
  });
});

describe('line span', () => {
  it('drag an end, fit to words', () => {
    const l: Line = { t: 11.44, end: 13.52, text: 'ааа море', tr: '', sync: { orig: [{ a: 10.9, b: 12 }, { a: 12, b: 13.6 }] } };
    expect(lineEdgeAt([l], 11.46, 0.05, null, 0)).toEqual({ i: 0, edge: 'a', d: expect.any(Number) });
    moveLineEdge(l, 'a', 14); expect(l.t).toBe(13.42); // never past its end
    moveLineEdge(l, 'b', 1); expect(l.end).toBe(13.52);
    expect(fitLineToWords(l)).toBe(true);
    expect([l.t, l.end]).toEqual([10.9, 13.6]);
  });
});

describe('auto fit', () => {
  it('pads the span, and only lines with a fully timed track follow their words', () => {
    const a: Line = { t: 5, end: 9, text: 'раз два', tr: '', sync: { orig: [{ a: 6, b: 7 }, { a: 7, b: 8 }] } };
    const b: Line = { t: 1, end: 4, text: 'три четыре', tr: '', sync: { orig: [{ a: 2, b: 3 }, { a: null, b: null }] } };
    const ls = [b, a];
    expect([fitsWords(a), fitsWords(b)]).toEqual([true, false]);
    fitAndSort(ls, null, { a: 0.2, b: -0.1 });
    expect([a.t, a.end, b.t, b.end]).toEqual([5.8, 7.9, 1, 4]);
    expect(fitLineToWords({ ...a }, { a: 9, b: 0 })).toBe(true); // never below 0
  });
});
