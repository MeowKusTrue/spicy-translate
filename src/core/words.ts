import type { TimedWord, Unit, WordSync } from './types.ts';

export const NBSP = ' ';

// NBSP glues words into one timed block (two words = one span); everything else splits on whitespace
export function units(text: string | null | undefined): Unit[] {
  const out: Unit[] = [];
  String(text || '').split(/[^\S ]+/).filter(Boolean).forEach(tok => {
    const parts = tok.split('|').filter(Boolean);
    parts.forEach((w, j) => out.push({ w, sp: j === parts.length - 1 }));
  });
  return out;
}
export function wordList(text: string | null | undefined): string[] { return units(text).map(u => u.w); }
// units back to text: space between words, '|' between syllables of one word
export const unitsText = (us: Unit[]) => us.map((u, k) => u.w + (k < us.length - 1 ? (u.sp ? ' ' : '|') : '')).join('');

// rough syllable splitter (ru/en): V|CV, VC|CV, й/ь/ъ stay with the left part, latin vowel pairs stay together
const VOW = /[aeiouyаеёиоуыэюяіїєáéíóúàèìòùäöü]/i, LAT = /[a-z]/i;
export function syllabify(word: string): string[] {
  const ch = [...word], vi = ch.map((c, i) => VOW.test(c) ? i : -1).filter(i => i >= 0);
  if (LAT.test(word) && /[^aeiouy]e$/i.test(word) && vi.length > 1) vi.pop(); // silent final e
  const cuts: number[] = [];
  for (let q = 0; q + 1 < vi.length; q++) {
    const i = vi[q], j = vi[q + 1], mid = ch.slice(i + 1, j), real = mid.filter(c => !/[ьъ]/i.test(c)).length;
    if (!mid.length && LAT.test(ch[i])) continue;
    let c = real <= 1 ? i + 1 : i + 2;
    while (c < j && /[йьъ]/i.test(ch[c])) c++;
    if (real === 1 && /[ьъ]/i.test(ch[i + 1] || '')) c = i + 1;
    cuts.push(c);
  }
  const out: string[] = []; let st = 0;
  cuts.forEach(c => { if (c > st) { out.push(ch.slice(st, c).join('')); st = c; } });
  out.push(ch.slice(st).join(''));
  return out.filter(Boolean);
}

/** display form of a unit: NBSP -> space, syllable bars removed */
export const plainW = (w: string) => String(w).replace(/ /g, ' ').replace(/\|/g, '');

export function syncComplete(sync: WordSync[] | null | undefined, n: number): sync is (WordSync & { a: number; b: number })[] {
  return Array.isArray(sync) && sync.length === n && n > 0 && sync.every(x => x && x.a != null && x.b != null);
}

// spread words across [t0,t1] proportionally to their length
export function splitWords(text: string, t0: number, t1: number): TimedWord[] {
  const us = units(text);
  if (!us.length) return [];
  const w = us.map(u => Math.max(1, u.w.length) + (u.sp ? 0.5 : 0));
  const total = w.reduce((a, b) => a + b, 0);
  let acc = 0;
  return us.map((u, i) => {
    const a = t0 + (t1 - t0) * (acc / total);
    acc += w[i];
    const b = t0 + (t1 - t0) * (acc / total);
    return { word: u.w, sp: u.sp, a, b };
  });
}

// real (hand-synced) word timings if the layer is fully synced, otherwise an even spread
export function getWords(text: string, sync: WordSync[] | null | undefined, t0: number, t1: number): TimedWord[] {
  const us = units(text);
  if (syncComplete(sync, us.length)) return us.map((u, i) => ({ word: u.w, sp: u.sp, a: sync[i].a, b: sync[i].b, real: true }));
  return splitWords(text, t0, t1);
}
