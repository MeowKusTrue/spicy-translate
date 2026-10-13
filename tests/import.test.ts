import { describe, expect, it } from 'vitest';
import { buildTTML, importLyrics, parseSRT, parseTTML, parseTimeExpr, units, type Line } from '../src/core/index.ts';

// invented lines only
const TT = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Word">
  <head><metadata><ttm:agent type="person" xml:id="v1"/><ttm:agent type="person" xml:id="v2"/></metadata></head>
  <body><div>
    <p begin="0:01.000" end="0:03.000" ttm:agent="v1"><span begin="0:01.000" end="0:01.300">жёл</span><span begin="0:01.300" end="0:01.600">тый</span> <span begin="0:01.600" end="0:02.200">чайник</span><span ttm:role="x-bg"><span begin="0:02.300" end="0:02.600">(ого</span> <span begin="0:02.600" end="0:03.000">ага)</span></span></p>
    <p begin="0:04.000" end="0:05.500" ttm:agent="v2"><span begin="4.0" end="4.6">синий</span> <span begin="4.6" end="5.5">кактус</span></p>
    <p begin="00:06.000" end="00:07.000">тихий &amp; фонарь</p>
  </div></body>
</tt>`;

describe('import', () => {
  it('time expressions', () => {
    expect(parseTimeExpr('1:02.5')).toBeCloseTo(62.5);
    expect(parseTimeExpr('01:00:01.25')).toBeCloseTo(3601.25);
    expect(parseTimeExpr('4.6')).toBeCloseTo(4.6);
    expect(parseTimeExpr('1500ms')).toBeCloseTo(1.5);
    expect(parseTimeExpr('2.5s')).toBeCloseTo(2.5);
  });
  it('TTML: syllables, background vocals, singers, line timing', () => {
    const L = parseTTML(TT);
    expect(L.length).toBe(3);
    expect(L[0].text).toBe('жёл|тый чайник');
    expect(L[0].sync!.orig!.length).toBe(units(L[0].text).length);
    expect(L[0].bg).toEqual({ text: '(ого ага)', tr: '' });
    expect(L[0].sync!.bgo).toEqual([{ a: 2.3, b: 2.6 }, { a: 2.6, b: 3 }]);
    expect(L[1].agent).toBe('v2');
    expect(L[2].text).toBe('тихий & фонарь');
    expect(L[2].sync).toBeUndefined();
  });
  it('round trip: our TTML export imports back with the same words and singers', () => {
    const src: Line[] = [
      { t: 1, end: 3, text: 'x', tr: 'жёл|тый чайник', sync: { tr: [{ a: 1, b: 1.3 }, { a: 1.3, b: 1.6 }, { a: 1.6, b: 2.2 }] }, bg: { text: 'ого', tr: 'ага' } },
      { t: 4, end: 5.5, text: 'y', tr: 'синий кактус', agent: 'v2' },
    ];
    const back = parseTTML(buildTTML({ lines: src }));
    expect(back.map(l => l.text)).toEqual(['жёл|тый чайник', 'синий кактус']);
    expect(back[0].bg!.text).toBe('ага');
    expect(back[1].agent).toBe('v2');
  });
  it('background vocals are exported as x-bg in translation mode, without parentheses', () => {
    const x = buildTTML({ lines: [{ t: 1, end: 3, text: 'a b', tr: 'жёлтый чайник', bg: { text: '(ого)', tr: '' } }] });
    expect(x).toMatch(/<span ttm:role="x-bg"><span begin="[^"]+" end="[^"]+">ого<\/span><\/span>/);
  });
  it('SRT and plain text', () => {
    expect(parseSRT('1\n00:00:01,000 --> 00:00:02,500\nжёлтый\nчайник\n\n2\n00:00:03,000 --> 00:00:04,000\nсиний кактус\n'))
      .toEqual([{ t: 1, end: 2.5, text: 'жёлтый чайник', tr: '' }, { t: 3, end: 4, text: 'синий кактус', tr: '' }]);
    const r = importLyrics('[Куплет]\nжёлтый чайник\n\nсиний кактус\n', 'song.txt', 100);
    expect(r.kind).toBe('text');
    expect(r.lines.map(l => l.text)).toEqual(['жёлтый чайник', 'синий кактус']);
    expect(r.lines[1].t).toBeGreaterThan(r.lines[0].t);
    expect(importLyrics('[00:01.00] жёлтый чайник').kind).toBe('lrc');
  });
});
