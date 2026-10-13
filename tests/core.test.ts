import { describe, expect, it } from 'vitest';
import {
  buildLRC, buildSRT, buildTTML, entriesToLines, getWords, NBSP, parseLRC, parsePlain, plainW,
  qaCheck, splitWords, syllabify, units, unitsText, wordList, type Line,
} from '../src/core/index.ts';

const line = (o: Partial<Line>): Line => ({ t: 1, end: 3, text: 'one two', tr: '', ...o });
const spansOf = (ttml: string) => [...ttml.matchAll(/<span begin="([^"]+)" end="([^"]+)">([^<]*)<\/span>/g)].map(m => m[3]);

describe('units / NBSP / syllables', () => {
  it('splits on whitespace, "|" makes syllables, NBSP glues', () => {
    expect(units('кра|си|вый день')).toEqual([
      { w: 'кра', sp: false }, { w: 'си', sp: false }, { w: 'вый', sp: true }, { w: 'день', sp: true },
    ]);
    expect(wordList(`мы${NBSP}с тобой`)).toEqual([`мы${NBSP}с`, 'тобой']);
    expect(unitsText(units('кра|си|вый  день'))).toBe('кра|си|вый день');
    expect(plainW(`a${NBSP}b|c`)).toBe('a bc');
  });

  it('syllabify ru', () => {
    expect(syllabify('красивый')).toEqual(['кра', 'си', 'вый']);
    expect(syllabify('газлайтер')).toEqual(['газ', 'лай', 'тер']);
    expect(syllabify('день')).toEqual(['день']);
  });

  it('syllabify en (silent e, vowel pairs stay together)', () => {
    expect(syllabify('make')).toEqual(['make']);
    expect(syllabify('yellow')).toEqual(['yel', 'low']);
    expect(syllabify('rain')).toEqual(['rain']);
  });
});

describe('TTML', () => {
  it('syllables -> spans with no space inside the word', () => {
    const sync = { tr: [{ a: 1, b: 1.2 }, { a: 1.2, b: 1.4 }, { a: 1.4, b: 1.8 }, { a: 1.9, b: 2.5 }] };
    const x = buildTTML({ lines: [line({ tr: 'кра|си|вый день', sync })] });
    expect(x).toContain('<span begin="0:01.000" end="0:01.200">кра</span><span begin="0:01.200" end="0:01.400">си</span><span begin="0:01.400" end="0:01.800">вый</span> <span begin="0:01.900" end="0:02.500">день</span>');
    expect(x).toContain('itunes:timing="Word"');
    expect(x).toContain('<p begin="0:01.000" end="0:02.500" ttm:agent="v1" itunes:key="L1">');
  });

  it('NBSP-glued words = one span, rendered with a normal space', () => {
    const x = buildTTML({ lines: [line({ tr: `мы${NBSP}с тобой` })] });
    expect(spansOf(x)).toEqual(['мы с', 'тобой']);
  });

  it('line timing, offset, songwriters, empty lines dropped, escaping', () => {
    const x = buildTTML({ lines: [line({ text: 'a < b' }), line({ t: 4, end: 5, text: '  ' })], wordSpread: false, offset: 500, songwriters: ['X', ''] });
    expect(x).toContain('itunes:timing="Line"');
    expect(x).toContain('<p begin="0:01.500" end="0:03.500" ttm:agent="v1" itunes:key="L1">a &lt; b</p>');
    expect(x).not.toContain('L2');
    expect(x).toContain('<songwriters><songwriter>X</songwriter></songwriters>');
  });

  it('bilingual: translation as x-bg without brackets', () => {
    const x = buildTTML({ lines: [line({ text: 'one two', tr: '(раз два)' })], mode: 'bilingual' });
    expect(x).toMatch(/<span ttm:role="x-bg"><span [^>]+>раз<\/span> <span [^>]+>два<\/span><\/span>/);
  });
});

describe('getWords / splitWords', () => {
  it('uses real timings only when the layer is fully synced', () => {
    expect(getWords('a b', [{ a: 1, b: 2 }, { a: null, b: null }], 0, 4).every(w => !w.real)).toBe(true);
    expect(getWords('a b', [{ a: 1, b: 2 }, { a: 2, b: 3 }], 0, 4).map(w => [w.a, w.b])).toEqual([[1, 2], [2, 3]]);
    const s = splitWords('aa b', 0, 4);
    expect(s[0].a).toBe(0); expect(s[1].b).toBe(4); expect(s[0].b).toBe(s[1].a);
  });
});

describe('LRC / SRT', () => {
  it('parses LRC (multi-stamps, enhanced tags, sorting)', () => {
    expect(parseLRC('[00:05.00]second\n[00:01.50][00:10.00] <00:01.60>first  line\nnoise')).toEqual([
      { t: 1.5, text: 'first line' }, { t: 5, text: 'second' }, { t: 10, text: 'first line' },
    ]);
    expect(parsePlain('a\n\n b ')).toEqual([{ t: 0, text: 'a' }, { t: 3.5, text: 'b' }]);
  });

  it('entriesToLines caps line length and drops empty entries', () => {
    expect(entriesToLines([{ t: 0, text: 'a' }, { t: 20, text: '' }, { t: 30, text: 'b' }], 31)).toEqual([
      { t: 0, end: 10, text: 'a', tr: '' }, { t: 30, end: 31, text: 'b', tr: '' },
    ]);
  });

  it('builds LRC and SRT', () => {
    const lines = [line({ t: 1.234, end: 2.5, text: 'one', tr: 'раз' }), line({ t: 62, end: 63, text: 'two' })];
    expect(buildLRC({ lines })).toBe('[00:01.23]раз\n[01:02.00]two\n');
    expect(buildSRT({ lines })).toBe('1\n00:00:01,234 --> 00:00:02,500\nраз\n\n2\n00:01:02,000 --> 00:01:03,000\ntwo\n');
    expect(buildLRC({ lines, mode: 'bilingual' })).toBe('[00:01.23]one / раз\n[01:02.00]two\n');
  });
});

describe('qaCheck', () => {
  it('flags empty, untranslated, unsynced, auto, short/overlap', () => {
    const r = qaCheck([
      line({ text: '', tr: '' }),
      line({ tr: '' }),
      line({ t: 4, end: 6, tr: 'раз два', sync: { tr: [{ a: 4, b: 4.02 }, { a: 4.01, b: 5, g: 1 }] } }),
      line({ t: 4.5, end: 7, tr: 'три' }),
    ]);
    const msgs = r.map(x => `${x.i}:${x.sev}:${x.msg}`);
    expect(msgs).toContain('0:err:пустая строка — Spicy не загрузит файл');
    expect(msgs).toContain('1:warn:нет перевода — пойдёт оригинал');
    expect(msgs).toContain('1:warn:слова не размечены — будет равномерный спред');
    expect(msgs).toContain('2:warn:слова только раскиданы, не проверены вручную');
    expect(msgs).toContain('2:warn:«раз»: слишком короткое (20 мс)');
    expect(msgs).toContain('2:err:«два»: перекрывает предыдущее слово');
    expect(msgs.some(m => m.startsWith('3:warn:начинается раньше конца строки 3'))).toBe(true);
  });
});
