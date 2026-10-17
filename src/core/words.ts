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
  // a hyphen between letters always ends a syllable and stays with the left part: «из-за» -> из- | за
  const parts = word.split(/(?<=\p{L}[-‐‑])(?=\p{L})/u);
  return parts.length > 1 ? parts.flatMap(syllabify) : syllables(word);
}
function syllables(word: string): string[] {
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

/* ---------- remembered syllable splits: split a word once, it comes split everywhere ---------- */
/** letters of a word, lowercase: the key of a remembered split */
export const sylKey = (w: string) => w.replace(/\|/g, '').toLowerCase().replace(/[^\p{L}]+/gu, '');
/** "Ма|ли|на," -> ['малина', [2, 4]]: cuts counted in letters, so case and punctuation don't matter */
export function sylCuts(token: string): [string, number[]] | null {
  if (!token.includes('|')) return null;
  let n = 0; const cuts: number[] = [];
  for (const ch of token) { if (ch === '|') { if (n && cuts[cuts.length - 1] !== n) cuts.push(n); } else if (/\p{L}/u.test(ch)) n++; }
  const key = sylKey(token);
  return key && cuts.length && cuts[cuts.length - 1] < key.length ? [key, cuts] : null;
}
/** every token with "|" of a text into the dictionary; returns the keys learned */
export function learnSplits(text: string, dict: Record<string, number[]>) {
  const got: string[] = [];
  for (const tok of String(text || '').split(/[^\S\u00a0]+/)) { const c = sylCuts(tok); if (c && String(dict[c[0]]) !== String(c[1])) { dict[c[0]] = c[1]; got.push(c[0]); } }
  return got;
}
function cutWord(w: string, cuts: number[]) {
  const parts: string[] = []; let cur = '', n = 0, c = 0;
  for (const ch of w) { cur += ch; if (/\p{L}/u.test(ch) && ++n === cuts[c]) { parts.push(cur); cur = ''; c++; } }
  if (cur) { if (/\p{L}/u.test(cur) || !parts.length) parts.push(cur); else parts[parts.length - 1] += cur; } // trailing punctuation stays on the last syllable
  return parts;
}
/**
 * Split the whole words of a layer that the dictionary knows (only = just these keys). Timings of a split word
 * are shared by its syllables in proportion. null = nothing changed.
 */
export function applySplits(text: string, sync: WordSync[] | null | undefined, dict: Record<string, number[]>, only?: Set<string>) {
  const us = units(text); if (!us.length) return null;
  const sy = Array.isArray(sync) && sync.length === us.length ? sync : null, nu: Unit[] = [], ns: WordSync[] = []; let n = 0;
  us.forEach((u, k) => {
    const whole = u.sp && (k === 0 || us[k - 1].sp) && !u.w.includes(NBSP), key = whole ? sylKey(u.w) : '';
    const cuts = key && (!only || only.has(key)) ? dict[key] : undefined, parts = cuts ? cutWord(u.w, cuts) : [u.w];
    if (parts.length < 2) { nu.push(u); if (sy) ns.push(sy[k]); return; }
    n++; const pu = parts.map((w, j) => ({ w, sp: j === parts.length - 1 })); nu.push(...pu);
    if (!sy) return;
    const x = sy[k];
    if (x.a == null || x.b == null) ns.push(...pu.map(() => ({ a: null, b: null })));
    else ns.push(...splitWords(unitsText(pu), x.a, x.b).map(w => ({ a: Math.round(w.a * 1000) / 1000, b: Math.round(w.b * 1000) / 1000, ...(x.g ? { g: 1 as const } : {}) })));
  });
  return n ? { text: unitsText(nu), sync: sy ? ns : sync ? null : sync, n } : null;
}
