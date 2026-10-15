import { describe, expect, it } from 'vitest';
import { alignRows, buildTTML, findAll, insertLine, insertWord, lineFromWords, pasteTiming, shiftLine, timingOf, transferTiming, lineRow, parensToBg, parseRow, parseTTML, qaCheck, remapSync, repeatTiming, replaceUnit, type Line } from '../src/core/index.ts';

describe('whole-text rows', () => {
  it('alignRows keeps unchanged and edited rows on their lines, marks new ones', () => {
    expect(alignRows(['a b', 'c d', 'e f'], ['a b', 'new', 'c d!', 'e f'])).toEqual([0, -1, 1, 2]);
    expect(alignRows(['a', 'b', 'c'], ['a', 'c'])).toEqual([0, 2]);
  });
  it('lineRow / parseRow round-trip with background vocals', () => {
    const l: Line = { t: 0, end: 1, text: 'кактус спит', tr: '', bg: { text: 'ого ага', tr: '' } };
    expect(lineRow(l, false)).toBe('кактус спит (ого ага)');
    expect(parseRow('кактус спит (ого ага)')).toEqual({ main: 'кактус спит', bg: 'ого ага' });
    expect(parseRow('(ого)')).toEqual({ main: '', bg: 'ого' });
  });
});

describe('find & replace, chorus timing', () => {
  it('counts and replaces whole words, case-insensitive', () => {
    const ls: Line[] = [{ t: 0, end: 1, text: 'Луна и лунатик', tr: '' }, { t: 1, end: 2, text: 'луна', tr: '' }];
    const r = findAll(ls, { find: 'луна', repl: 'звезда', layers: ['orig'], word: true });
    expect(r.n).toBe(2);
    expect(r.edits.map(e => e.text)).toEqual(['звезда и лунатик', 'звезда']);
  });
  it('repeatTiming copies a timed chorus line, shifted, as auto', () => {
    const ls: Line[] = [
      { t: 1, end: 3, text: 'Ла-ла, кактус', tr: '', sync: { orig: [{ a: 1, b: 2 }, { a: 2, b: 3 }] } },
      { t: 10, end: 12, text: 'ла-ла кактус', tr: '' },
      { t: 20, end: 22, text: 'Ла-ла, кактус', tr: '', sync: { orig: [{ a: 20, b: 20.5 }, { a: 20.5, b: 22 }] } },
    ];
    expect(repeatTiming(ls, 0)).toBe(1); // case / punctuation differences don't matter
    expect(ls[1].sync!.orig).toEqual([{ a: 10, b: 11, g: 1 }, { a: 11, b: 12, g: 1 }]);
    expect(ls[2].sync!.orig![0].a).toBe(20); // done by hand: untouched
  });
});

// invented lines only
const S3 = [{ a: 1, b: 2 }, { a: 2, b: 3 }, { a: 3, b: 4 }];

describe('remapSync', () => {
  it('keeps timings of surviving words, new word gets an empty span', () => {
    expect(remapSync('сонный кактус спит', 'сонный зелёный кактус спит', S3))
      .toEqual([{ a: 1, b: 2 }, { a: null, b: null }, { a: 2, b: 3 }, { a: 3, b: 4 }]);
  });
  it('a fixed typo keeps its span, a replaced run spreads over the old window', () => {
    expect(remapSync('сонный кактс спит', 'сонный кактус спит', S3)).toEqual(S3);
    const r = remapSync('сонный кактус спит', 'сонный большой синий спит', S3)!;
    expect([r[1].a, r[2].b, r[1].g]).toEqual([2, 3, 1]);
  });
  it('deleted word drops its span', () => {
    expect(remapSync('сонный кактус спит', 'сонный спит', S3)).toEqual([{ a: 1, b: 2 }, { a: 3, b: 4 }]);
  });
});

describe('replaceUnit', () => {
  it('splits a word span among new words, empty value deletes', () => {
    const r = replaceUnit('лунный чайник', [{ a: 0, b: 1 }, { a: 1, b: 3 }], 1, 'чайник поёт')!;
    expect(r.text).toBe('лунный чайник поёт');
    expect(r.sync!.length).toBe(3);
    expect([r.sync![1].a, r.sync![2].b]).toEqual([1, 3]);
    expect(replaceUnit('лунный чайник', [{ a: 0, b: 1 }, { a: 1, b: 3 }], 0, '')).toEqual({ text: 'чайник', sync: [{ a: 1, b: 3 }] });
  });
  it('deleting the last syllable keeps the word boundary', () => {
    expect(replaceUnit('ча|йник поёт', null, 1, '')!.text).toBe('ча поёт');
  });
});

describe('background-only lines', () => {
  it('insertLine keeps order', () => {
    const ls: Line[] = [{ t: 1, end: 3, text: 'a', tr: '' }, { t: 5, end: 7, text: 'b', tr: '' }];
    expect(insertLine(ls, 3.5)).toBe(1);
    expect([ls[1].t, ls[1].end]).toEqual([3.5, 5]);
  });
  it('parensToBg moves (…) with timings', () => {
    const l: Line = { t: 1, end: 4, text: 'кактус (ого ага) спит', tr: '', sync: { orig: [{ a: 1, b: 2 }, { a: 2, b: 2.5 }, { a: 2.5, b: 3 }, { a: 3, b: 4 }] } };
    expect(parensToBg(l)).toBe(true);
    expect([l.text, l.bg!.text]).toEqual(['кактус спит', 'ого ага']);
    expect(l.sync!.orig).toEqual([{ a: 1, b: 2 }, { a: 3, b: 4 }]);
    expect(l.sync!.bgo).toEqual([{ a: 2, b: 2.5 }, { a: 2.5, b: 3 }]);
    const only: Line = { t: 1, end: 2, text: '(ого)', tr: '' };
    parensToBg(only);
    expect([only.text, only.bg!.text]).toEqual(['', 'ого']);
  });
  it('export, import and QA keep a line with only background vocals', () => {
    const ls: Line[] = [{ t: 1, end: 2, text: '', tr: '', bg: { text: 'ого ага', tr: '' }, sync: { bgo: [{ a: 1.2, b: 1.5 }, { a: 1.5, b: 1.9 }] } }];
    const x = buildTTML({ lines: ls });
    expect(x).toMatch(/<p begin="0:01.200" end="0:01.900"[^>]*><span ttm:role="x-bg"><span begin="0:01.200"/);
    const back = parseTTML(x);
    expect([back.length, back[0].text, back[0].bg!.text]).toEqual([1, '', 'ого ага']);
    expect(qaCheck(ls).filter(q => q.sev === 'err')).toEqual([]);
  });
});

describe('copies', () => {
  it('insertWord drops a word between neighbours, they give way', () => {
    const l: Line = { t: 0, end: 4, text: 'раз два', tr: '', sync: { orig: [{ a: 0, b: 2 }, { a: 2, b: 4 }] } };
    expect(insertWord(l, 'orig', 'эх', 1.5, 2.5)).toBe(1);
    expect(l.text).toBe('раз эх два');
    expect(l.sync!.orig).toEqual([{ a: 0, b: 1.5 }, { a: 1.5, b: 2.5 }, { a: 2.5, b: 4 }]);
    const b: Line = { t: 0, end: 4, text: '', tr: '' };
    insertWord(b, 'bgo', 'ого', 1, 2);
    expect(b.bg!.text).toBe('ого');
  });
  it('shiftLine moves every track', () => {
    const o: Line = { t: 1, end: 2, text: 'a', tr: 'б', sync: { orig: [{ a: 1, b: 2 }], bgo: [{ a: 1.5, b: 1.8 }] }, bg: { text: 'x', tr: '' } };
    const l: Line = JSON.parse(JSON.stringify(o));
    shiftLine(l, o, 2);
    expect([l.t, l.end, l.sync!.orig![0].a, l.sync!.bgo![0].b]).toEqual([3, 4, 3, 3.8]);
  });
});

describe('lineFromWords', () => {
  it('a copied bg word becomes its own background-only line', () => {
    const l = lineFromWords([{ layer: 'bgo', w: 'эй', a: 5, b: 5.4 }])!;
    expect([l.text, l.bg!.text, l.t, l.sync!.bgo]).toEqual(['', 'эй', 5, [{ a: 5, b: 5.4 }]]);
    const m = lineFromWords([{ layer: 'orig', w: 'два', a: 2, b: 3 }, { layer: 'orig', w: 'раз', a: 1, b: 2 }, { layer: 'bgo', w: 'ой', a: 1.5, b: 2 }])!;
    expect([m.text, m.bg!.text, m.t, m.end]).toEqual(['раз два', 'ой', 1, 3]);
  });
});

describe('copy line timing', () => {
  it('same word count: exact rhythm moved to the target line start; otherwise resampled', () => {
    const src: Line = { t: 10, end: 13, text: 'раз два три', tr: '', sync: { orig: [{ a: 10, b: 10.5 }, { a: 10.5, b: 12 }, { a: 12, b: 13 }] } };
    const rel = timingOf(src, 'orig')!;
    expect(pasteTiming(rel, 3, 20)).toEqual([{ a: 20, b: 20.5, g: 1 }, { a: 20.5, b: 22, g: 1 }, { a: 22, b: 23, g: 1 }]);
    const six = pasteTiming(rel, 6, 0);
    expect(six.length).toBe(6);
    expect([six[0].a, six[5].b]).toEqual([0, 3]);
    expect(six.every((x, k) => !k || x.a! >= six[k - 1].a!)).toBe(true);
    expect(timingOf({ ...src, sync: {} }, 'orig')).toBeNull();
  });
});

describe('transferTiming', () => {
  it('copies the rhythm of every shared track onto another line, keeping its words', () => {
    const src: Line = { t: 1, end: 3, text: 'раз два', tr: 'one two', sync: { orig: [{ a: 1, b: 2 }, { a: 2, b: 3 }], tr: [{ a: 1, b: 1.5 }, { a: 1.5, b: 3 }] } };
    const dst: Line = { t: 10, end: 12, text: 'три четыре', tr: '' };
    expect(transferTiming(src, dst, 20)).toBe(1); // tr of dst is empty
    expect([dst.text, dst.sync!.orig, dst.t, dst.end]).toEqual(['три четыре', [{ a: 20, b: 21, g: 1 }, { a: 21, b: 22, g: 1 }], 20, 22]);
  });
});
