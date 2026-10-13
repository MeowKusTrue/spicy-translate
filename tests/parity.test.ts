// The migrated core must behave exactly like the core <script> section of reference/index.html.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as C from '../src/core/index.ts';

const src = fs.readFileSync(new URL('../reference/index.html', import.meta.url), 'utf8');
const ref: any = (() => {
  const a = src.indexOf('/* ---------- core'), b = src.indexOf('/* ---------------- app');
  const mod = { exports: {} as any }; new Function('module', src.slice(a, b))(mod); return mod.exports;
})();

const NB = ' ';
const texts = ['', 'one', 'кра|си|вый день', `мы${NB}с тобой`, '  a   b|c  d ', 'make yellow rain', 'подъезд объём район',
  'газлайтер', 'beautiful', 'strength', 'aeiou', 'ёлка', 'x|', '|y'];
const lines: C.Line[] = [
  { t: 0.5, end: 3, text: 'one two three', tr: 'раз два три', sync: { tr: [{ a: 0.6, b: 1 }, { a: 1, b: 2, g: 1 }, { a: 2.1, b: 2.9 }] } },
  { t: 3, end: 6, text: 'four five', tr: `кра|си|вый${NB}день`, sync: { tr: [{ a: 3, b: 3.2 }, { a: null, b: null }, { a: 3.4, b: 4 }] } },
  { t: 6, end: 7, text: '  ', tr: '' },
  { t: 7, end: 12, text: 'six (seven)', tr: '(шесть) семь', sync: { orig: [{ a: 7, b: 8 }, { a: 7.5, b: 7.4 }] } },
  { t: 3600.2, end: 3602, text: 'late & <tag>', tr: '' },
];

describe('parity with reference core', () => {
  it('words', () => {
    for (const t of texts) {
      expect(C.units(t)).toEqual(ref.units(t));
      expect(C.plainW(t)).toEqual(ref.plainW(t));
      expect(C.splitWords(t, 1, 4)).toEqual(ref.splitWords(t, 1, 4));
      for (const w of C.wordList(t)) expect(C.syllabify(w)).toEqual(ref.syllabify(w));
    }
  });

  it('exports and qa', () => {
    for (const mode of ['translation', 'bilingual'] as const)
      for (const wordSpread of [true, false])
        for (const offset of [0, -700, 250]) {
          const o = { lines, mode, wordSpread, offset, lang: 'ru', songwriters: ['A & B'] };
          expect(C.buildTTML(o)).toBe(ref.buildTTML(o));
          expect(C.buildLRC(o)).toBe(ref.buildLRC(o));
          expect(C.buildSRT(o)).toBe(ref.buildSRT(o));
        }
    expect(C.qaCheck(lines.filter(l => l.text.trim()), 'translation')).toEqual(ref.qaCheck(lines.filter(l => l.text.trim()), 'translation'));
    expect(C.qaCheck(lines, 'bilingual')).toEqual(ref.qaCheck(lines, 'bilingual'));
  });

  it('parsers', () => {
    const lrc = '[00:01.5]a\n[01:02:50] b <00:01.00>c\n[00:00.10][00:09.99]x\nplain';
    expect(C.parseLRC(lrc)).toEqual(ref.parseLRC(lrc));
    expect(C.parsePlain(lrc)).toEqual(ref.parsePlain(lrc));
    expect(C.entriesToLines(C.parseLRC(lrc), 70)).toEqual(ref.entriesToLines(ref.parseLRC(lrc), 70));
    expect(C.fmtTime(3725.4567)).toBe(ref.fmtTime(3725.4567));
  });
});
