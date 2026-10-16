import { describe, expect, it } from 'vitest';
import { buildTTML, parseTTML, sectionsOf, secCategory, secOrdinal, splitHeaders, textDiff, type Line } from '../src/core/index.ts';

const L = (t: number, text: string, sec?: string): Line => ({ t, end: t + 2, text, tr: '', ...(sec ? { sec } : {}) });

describe('sections', () => {
  it('a label runs until the next one', () => {
    const s = sectionsOf([L(0, 'intro'), L(2, 'a', 'Куплет 1'), L(4, 'b'), L(6, 'c', 'Припев'), L(8, 'd')]);
    expect(s.map(x => [x.label, x.from, x.to, x.a, x.b])).toEqual([['Куплет 1', 1, 2, 2, 6], ['Припев', 3, 4, 6, 10]]);
    expect([secCategory('Припев'), secCategory('Pre-Chorus'), secCategory('Куплет 2'), secCategory('Бридж')]).toEqual(['chorus', 'pre-chorus', 'verse', 'bridge']);
  });
  it('all AMLL categories, Russian and English, and the ordinal', () => {
    const c = (xs: string[]) => xs.map(secCategory);
    expect(c(['Пред-припев', 'Пост-припев', 'Рефрен', 'Post-Chorus', 'Refrain', 'Брейк', 'Breakdown', 'Проигрыш', 'Интерлюдия', 'Инструментал', 'Соло', 'Guitar Solo', 'Речь', 'Скит', 'Сэмпл', 'Sample', 'Вступление', 'Кода', 'Голос']))
      .toEqual(['pre-chorus', 'post-chorus', 'refrain', 'post-chorus', 'refrain', 'break', 'break', 'interlude', 'interlude', 'instrumental', 'solo', 'solo', 'spoken', 'skit', 'sample', 'sample', 'intro', 'outro', 'other']);
    expect(['Куплет 2', '2-й куплет', 'Verse II', 'Второй куплет', 'Verse Three', 'Припев (x2)', 'Припев х2', 'Припев'].map(secOrdinal)).toEqual([2, 2, 2, 2, 3, undefined, undefined, undefined]);
    const x = buildTTML({ lines: [L(1, 'а', 'Куплет 2'), L(3, 'б', 'Соло')] });
    expect(x).toContain(JSON.stringify({ version: 1, sections: [{ id: 's1', label: 'Куплет 2', category: 'verse', ordinal: 2 }, { id: 's2', label: 'Соло', category: 'solo' }] }).replace(/"/g, '&quot;'));
  });
  it('Genius headers become row starts', () => {
    const r = splitHeaders('[Интро]\nэй\n[Куплет 1: Артист]\nраз\nдва\n[Припев]\nтри');
    expect(r.rows).toEqual(['эй', 'раз', 'два', 'три']);
    expect(r.heads).toEqual([{ row: 0, label: 'Интро' }, { row: 1, label: 'Куплет 1' }, { row: 3, label: 'Припев' }]);
    expect(textDiff(['раз два', 'три'], r.rows).rowLine).toEqual([-1, 0, 0, 1]);
  });
  it('round-trip through TTML (amll:section), Apple song-part divs too', () => {
    const lines = [L(1, 'раз два', 'Куплет 1'), L(3, 'три'), L(5, 'четыре', 'Припев')];
    const back = parseTTML(buildTTML({ lines, wordSpread: true }));
    expect(back.map(l => l.sec || '')).toEqual(['Куплет 1', '', 'Припев']);
    const apple = '<tt><body><div itunes:song-part="Verse"><p begin="1" end="2">a</p><p begin="2" end="3">b</p></div><div itunes:song-part="Chorus"><p begin="3" end="4">c</p></div><div itunes:song-part="Chorus"><p begin="5" end="6">d</p></div></body></tt>';
    expect(parseTTML(apple).map(l => l.sec || '')).toEqual(['Verse', '', 'Chorus', 'Chorus']);
  });
});
