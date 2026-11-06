import { describe, expect, it } from 'vitest';
import { buildTTML, confirmPhraseTiming, detachBacking, linkBacking, qaCheck, stopLine, type Line } from '../src/core/index.ts';

const fixture = (): Line[] => [
  { t: 1, end: 3, text: 'Original', tr: 'Перевод', sync: { orig: [{ a: 1, b: 3 }], tr: [{ a: 1, b: 3 }] } },
  { t: 2, end: 2.5, text: '', tr: '', bg: { text: 'Hey', tr: 'Эй' }, sync: { bgo: [{ a: 2, b: 2.5 }], bg: [{ a: 2, b: 2.5 }] } },
];
describe('studio original-only mode', () => {
  it('exports originals and original backing even when translations exist, preserving overlaps', () => {
    const lines = fixture(), x = buildTTML({ lines, mode: 'original' });
    expect(x).toContain('Original'); expect(x).toContain('Hey'); expect(x).not.toContain('Перевод'); expect(x).not.toContain('Эй');
    expect(x.startsWith('<tt ')).toBe(true); expect(stopLine(lines, 'original').done).toBe(2);
  });
  it('does not require translations and does not complain about punctuation as a sung word', () => {
    const lines: Line[] = [{ t: 1, end: 2, text: 'Привет —', tr: '', sync: { orig: [{ a: 1, b: 1.97 }, { a: 1.97, b: 2 }] } }];
    expect(qaCheck(lines, 'original')).toEqual([]);
    expect(qaCheck(lines, 'translation').some(x => x.msg.includes('нет перевода'))).toBe(true);
  });
});
describe('visible backing links', () => {
  it('links standalone backing without losing either language, singer or timings, leaving input untouched', () => {
    const lines = fixture(), before = JSON.stringify(lines), r = linkBacking(lines, 1, 0);
    expect('error' in r).toBe(false); if ('error' in r) return;
    expect(r.lines).toHaveLength(1); expect(r.lines[0].bg).toEqual(lines[1].bg); expect(r.lines[0].sync?.bgo).toEqual(lines[1].sync?.bgo);
    expect(r.lines[0].sync?.orig).toEqual(lines[0].sync?.orig); expect(JSON.stringify(lines)).toBe(before);
    expect(buildTTML({ lines: r.lines, mode: 'original' })).toContain('ttm:role="x-bg"');
  });
  it('never overwrites an existing backing and keeps main text on a source with two parts', () => {
    const lines = fixture(); lines[0].bg = { text: 'Taken', tr: '' };
    expect(linkBacking(lines, 1, 0)).toHaveProperty('error');
    expect(linkBacking(lines, 0, 0)).toHaveProperty('error');
    expect(linkBacking(lines, 1, 99)).toHaveProperty('error');
  });
  it('does not silently lose a backing singer or section boundary', () => {
    const lines = fixture(); lines[1].agent = 'v2';
    expect(linkBacking(lines, 1, 0)).toHaveProperty('error');
    delete lines[1].agent; lines[1].sec = 'Припев'; expect(linkBacking(lines, 1, 0)).toHaveProperty('error');
  });
  it('detaches to a standalone backing and roundtrips without mutating its former lead', () => {
    const linked = linkBacking(fixture(), 1, 0); if ('error' in linked) throw new Error(linked.error);
    const r = detachBacking(linked.lines, 0); if ('error' in r) throw new Error(r.error);
    expect(r.lines[0].bg).toBeUndefined(); expect(r.lines[1].t).toBe(2); expect(r.lines[1].sync?.bgo?.[0]).toEqual({ a: 2, b: 2.5 });
    expect(linked.lines[0].bg?.text).toBe('Hey');
    const back = linkBacking(r.lines, 1, 0); if ('error' in back) throw new Error(back.error);
    expect(back.lines).toEqual(linked.lines);
  });
});
it('confirms only complete non-overlapping phrase timing without changing the input', () => {
  const line: Line = { t: 0, end: 2, text: 'два слова', tr: '', sync: { orig: [{ a: 0, b: 1, g: 1, c: .1 }, { a: 1, b: 2, g: 1 }] } };
  expect(confirmPhraseTiming(line, 'orig')).toEqual({ sync: [{ a: 0, b: 1 }, { a: 1, b: 2 }] });
  expect(line.sync?.orig?.[0].g).toBe(1);
  line.sync!.orig![1].a = .5; expect(confirmPhraseTiming(line, 'orig')).toHaveProperty('error');
  line.sync!.orig![1].a = null; expect(confirmPhraseTiming(line, 'orig')).toHaveProperty('error');
});
