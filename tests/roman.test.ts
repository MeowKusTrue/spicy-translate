import { describe, expect, it } from 'vitest';
import { buildTTML, qaCheck, repeatTranslations, translit, type Line } from '../src/core/index.ts';

describe('romanization', () => {
  it('translit keeps case and leaves Latin alone', () => {
    expect(translit('Щука и Ёж, OK')).toBe('Shchuka i Yozh, OK');
    expect(translit('ЖАРА')).toBe('ZHARA');
  });
  it('word mode: <head> transliterations with the same span times; line mode: inline x-roman', () => {
    const lines: Line[] = [{ t: 1, end: 2, text: 'ты моя', tr: '', sync: { orig: [{ a: 1, b: 1.5 }, { a: 1.5, b: 2 }] } }];
    const x = buildTTML({ lines, roman: true });
    expect(x).toContain('<text for="L1"><span begin="0:01.000" end="0:01.500">ty</span> <span begin="0:01.500" end="0:02.000">moya</span></text>');
    expect(buildTTML({ lines, roman: true, wordSpread: false })).toContain('<span ttm:role="x-roman">ty moya</span>');
    expect(buildTTML({ lines })).not.toContain('transliteration');
  });
});

describe('translation memory and Spicy rules', () => {
  it('repeats get an existing translation, translated lines stay', () => {
    const ls: Line[] = [{ t: 0, end: 1, text: 'Ла-ла', tr: 'Ля-ля' }, { t: 1, end: 2, text: 'ла ла', tr: '' }, { t: 2, end: 3, text: 'ла-ла', tr: 'своё' }];
    expect(repeatTranslations(ls)).toEqual([1]);
    expect(ls.map(l => l.tr)).toEqual(['Ля-ля', 'Ля-ля', 'своё']);
  });
  it('warns about bg lost without word timing and stray brackets', () => {
    const ls: Line[] = [{ t: 0, end: 1, text: 'раз', tr: '', bg: { text: '( ого )', tr: '' } }];
    expect(qaCheck(ls, 'translation', { wordSpread: false }).some(q => q.msg.startsWith('бэк не попадёт'))).toBe(true);
    expect(qaCheck(ls).some(q => q.msg.includes('скобки'))).toBe(true);
  });
});
