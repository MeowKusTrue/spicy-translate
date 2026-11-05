import { describe, expect, it } from 'vitest';
import { bandRows, buildTTML, fitAndSort, fitLineToWords, fitsWords, intervalRows, lineAt, lineEdgeAt, moveLineEdge, moveEdge, moveWord, parseTTML, seqWords, snapSpan, startEdge, startMove, trackRows, type Line } from '../src/core/index.ts';

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

describe('overlapping vocal lines', () => {
  const duet = (): Line[] => [
    { t: 0, end: 2, text: 'первый голос', tr: '', agent: 'v1', sync: { orig: [{ a: 0, b: 1 }, { a: 1, b: 2 }] } },
    { t: 2, end: 5, text: 'второй голос', tr: '', agent: 'v2', sync: { orig: [{ a: 2, b: 3 }, { a: 3, b: 5 }] } },
  ];

  it('touching words in different lines never roll or trim one another', () => {
    const lines = duet(), sq = seqWords(lines, 'orig'), edge = startEdge(sq, 1, 'b', false, 2);
    expect(edge.roll).toBe(false);
    expect(moveEdge({ ...edge, edge: 'b' }, 3.5)).toBe(true);
    expect(lines[0].sync!.orig![1].b).toBe(3.5);
    expect(lines[1].sync!.orig![0]).toEqual({ a: 2, b: 3 });
    expect(trackRows(lines, 'orig')).toEqual([0, 1]);
  });

  it('a whole word crosses another line while its own neighbours still constrain it', () => {
    const lines = duet(), sq = seqWords(lines, 'orig');
    expect(moveWord(startMove(sq, 1), 2.5, true)).toBe(true);
    expect(lines[0].sync!.orig![1]).toEqual({ a: 2.5, b: 3.5 });
    expect(lines[1]).toEqual(duet()[1]);
    expect(moveWord(startMove(sq, 1), 0.5, true)).toBe(false);
  });

  it('the start of a second vocal line moves into the first without altering it', () => {
    const lines = duet(), sq = seqWords(lines, 'orig'), edge = startEdge(sq, 2, 'a', false, 2);
    expect(moveEdge({ ...edge, edge: 'a' }, 1.25)).toBe(true);
    expect(lines[0]).toEqual(duet()[0]);
    expect(lines[1].sync!.orig![0].a).toBe(1.25);
  });

  it('interval packing handles unsorted input and more than three simultaneous voices', () => {
    const spans = [{ a: 8, b: 9 }, { a: 0, b: 5 }, { a: 1, b: 6 }, { a: 2, b: 7 }, { a: 3, b: 8 }];
    expect(intervalRows(spans)).toEqual([0, 0, 1, 2, 3]);
  });

  it('empty backing tracks do not reserve vocal rows', () => {
    const lines = duet(); lines[1].bg = { text: 'эх', tr: '' };
    expect(trackRows(lines, 'bgo')).toEqual([-1, 0]);
  });

  it('TTML roundtrip keeps the actual overlap and both singers', () => {
    const lines = duet(); lines[0].sync!.orig![1].b = 3.5;
    const imported = parseTTML(buildTTML({ lines, mode: 'bilingual' }));
    expect(imported.map(l => l.agent || 'v1')).toEqual(['v1', 'v2']);
    expect(imported[0].sync!.orig![1].b).toBe(3.5);
    expect(imported[1].sync!.orig![0].a).toBe(2);
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
