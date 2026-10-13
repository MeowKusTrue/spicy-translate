// Выдуманные строки, никаких реальных текстов песен.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTTML, entriesToLines, parseLRC, units, unitsText, syllabify, getWords, type Line } from '../src/core.ts';

test('parseLRC + entriesToLines', () => {
  const lines = entriesToLines(parseLRC('[00:01.00]лунный чайник поёт\n[00:04.50]<00:05.00>сонный кактус\n'), 9);
  assert.equal(lines.length, 2);
  assert.deepEqual([lines[0].t, lines[0].end, lines[1].text, lines[1].end], [1, 4.5, 'сонный кактус', 9]);
});

test('units: NBSP glues, | splits syllables', () => {
  assert.deepEqual(units('ку|ку мыш кот'), [{ w: 'ку', sp: false }, { w: 'ку мыш', sp: true }, { w: 'кот', sp: true }]);
  assert.equal(unitsText(units('ку|ку мыш')), 'ку|ку мыш');
  assert.deepEqual(syllabify('черепаха'), ['че', 'ре', 'па', 'ха']);
});

test('getWords uses real sync only when complete', () => {
  assert.equal(getWords('раз два', [{ a: 1, b: 2 }, { a: null, b: null }], 0, 10)[0].a, 0);
  assert.equal(getWords('раз два', [{ a: 1, b: 2 }, { a: 2, b: 3 }], 0, 10)[1].a, 2);
});

test('buildTTML: translation layer, syllables without space, glued words in one span, empty lines dropped', () => {
  const lines: Line[] = [
    { t: 1, end: 3, text: 'paper moon', tr: 'бу|маж луна', sync: { tr: [{ a: 1, b: 1.5 }, { a: 1.5, b: 2.5 }] } },
    { t: 3, end: 5, text: '', tr: '' },
  ];
  const x = buildTTML({ lines, lang: 'ru' });
  assert.match(x, /itunes:timing="Word"/);
  assert.match(x, /<span begin="0:01.000" end="0:01.500">бу<\/span><span begin="0:01.500" end="0:02.500">маж луна<\/span><\/p>/);
  assert.equal((x.match(/<p /g) || []).length, 1);
});
