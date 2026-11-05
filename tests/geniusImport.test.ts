import { describe, expect, it } from 'vitest';
import { applyGeniusChanges, geniusChanges, selectGeniusChanges, setGeniusSections } from '../src/core/geniusImport.ts';
import type { Line } from '../src/core/types.ts';

const lines = (): Line[] => [
  { t: 1, end: 3, text: 'мо|ре песок', tr: 'sea sand', sec: 'Своя секция', agent: 'v2',
    sync: { orig: [{ a: 1, b: 1.3 }, { a: 1.3, b: 1.7 }, { a: 2, b: 3 }], tr: [{ a: 1, b: 2 }, { a: 2, b: 3 }] } },
  { t: 5, end: 6, text: 'лишняя строка', tr: 'keep me', bg: { text: 'эй', tr: 'hey' } },
  { t: 9, end: 11, text: 'дальше идём', tr: 'moving on' },
];
const rows = ['новое интро', 'море, песок', 'дальше идём', 'новый финал'];

describe('selective Genius import', () => {
  it('add-only keeps every existing row exactly, including translations, timing and sections', () => {
    const before = lines(), diff = geniusChanges(before, rows);
    const result = applyGeniusChanges(before, selectGeniusChanges(diff, 'add'));
    expect(result.map(l => l.text)).toEqual(['новое интро', 'мо|ре песок', 'лишняя строка', 'дальше идём', 'новый финал']);
    expect(result.slice(1, 4)).toEqual(before);
    expect(before).toEqual(lines());
  });

  it('edit-only cannot insert or delete; surviving word markup and timings remain', () => {
    const before = lines();
    const result = applyGeniusChanges(before, selectGeniusChanges(geniusChanges(before, rows), 'edit', true));
    expect(result).toHaveLength(3);
    expect(result[0].text).toBe('мо|ре, песок');
    expect(result[0].sync).toEqual(before[0].sync);
    expect(result[0].tr).toBe('sea sand');
    expect(result[0].sec).toBe('Своя секция');
    expect(result.slice(1)).toEqual(before.slice(1));
  });

  it('merge preserves our extra rows unless deletion is explicitly enabled', () => {
    const before = lines(), changes = geniusChanges(before, rows);
    const safe = applyGeniusChanges(before, selectGeniusChanges(changes, 'merge'));
    expect(safe.some(l => l.text === 'лишняя строка')).toBe(true);
    const exact = applyGeniusChanges(before, selectGeniusChanges(changes, 'merge', true));
    expect(exact.map(l => l.text)).toEqual(['новое интро', 'мо|ре, песок', 'дальше идём', 'новый финал']);
  });

  it('multiple additions at the same anchor retain reference order', () => {
    const before: Line[] = [{ t: 5, end: 6, text: 'начало песни', tr: '' }];
    const after = ['интро один', 'интро два', 'начало песни', 'финал один', 'финал два'];
    expect(applyGeniusChanges(before, geniusChanges(before, after)).map(l => l.text)).toEqual(after);
  });

  it('duplicates have distinct skip keys that survive an insertion before them', () => {
    const before = [{ t: 2, end: 3, text: 'лишняя', tr: '' }, { t: 5, end: 6, text: 'лишняя', tr: '' }];
    const changes = geniusChanges(before, []);
    expect(new Set(changes.map(d => d.key)).size).toBe(2);
    const prefixed = [{ t: 0, end: 1, text: 'вступление', tr: '' }, ...before];
    expect(geniusChanges(prefixed, []).slice(1).map(d => d.key)).toEqual(changes.map(d => d.key));
  });

  it('sections change only when requested and map to matching lines', () => {
    const before = lines(), result = applyGeniusChanges(before, []);
    expect(result[0].sec).toBe('Своя секция');
    setGeniusSections(result, ['море песок', 'лишняя строка', 'дальше идём'], [{ row: 0, label: 'Куплет' }, { row: 2, label: 'Припев' }]);
    expect(result.map(l => l.sec)).toEqual(['Куплет', undefined, 'Припев']);
    expect(before[0].sec).toBe('Своя секция');
  });

  it('an empty project can import with LRCLIB timing references', () => {
    const reference = [{ t: 10, end: 12, text: 'начало песни', tr: '' }];
    const result = applyGeniusChanges([], geniusChanges([], ['начало песни']), reference);
    expect(result).toEqual(reference);
  });
});
