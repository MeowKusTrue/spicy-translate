// Text edits that keep word timings: retyping a line, replacing one word, inserting lines, "(bg)" -> background vocals.
import type { Layer, Line, Unit, WordSync } from './types.ts';
import { plainW, splitWords, syncComplete, units, unitsText, wordList } from './words.ts';

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const timed = (x: WordSync | undefined): x is WordSync & { a: number; b: number } => !!x && x.a != null && x.b != null;
const spread = (us: Unit[], a: number, b: number, g?: 1) => splitWords(unitsText(us), a, b).map(w => ({ a: r3(w.a), b: r3(w.b), ...(g ? { g } : {}) }));

/** LCS walk over two lists: `match(i, j)` for equal items, `gap(i0, i1, j0, j1)` for each run in between (either side may be empty) */
function lcsWalk(A: string[], B: string[], match: (i: number, j: number) => void, gap: (i0: number, i1: number, j0: number, j1: number) => void) {
  const n = A.length, m = B.length, L = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  let i = 0, j = 0, pi = 0, pj = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { gap(pi, i, pj, j); match(i, j); pi = ++i; pj = ++j; }
    else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
  }
  gap(pi, n, pj, m);
}

/**
 * Timings for `newText` after the layer was edited from `oldText`: words that survived (LCS) keep their spans,
 * a replaced run of words takes over the time window of what it replaced, brand-new words get empty spans
 * (fillLine places them). undefined = nothing to keep.
 */
export function remapSync(oldText: string, newText: string, sync: WordSync[] | null | undefined): WordSync[] | undefined {
  const A = wordList(oldText), B = units(newText);
  if (!sync || sync.length !== A.length || !B.length) return undefined;
  const out: WordSync[] = B.map(() => ({ a: null, b: null }));
  lcsWalk(A, B.map(u => u.w), (i, j) => { out[j] = { ...sync[i] }; }, (i0, i1, j0, j1) => {
    if (j1 <= j0) return;
    if (i1 - i0 === j1 - j0) { for (let q = 0; q < j1 - j0; q++) out[j0 + q] = { ...sync[i0 + q] }; return; }
    const old = sync.slice(i0, i1);
    if (old.length && old.every(timed)) spread(B.slice(j0, j1), old[0].a!, old[old.length - 1].b!, 1).forEach((x, q) => out[j0 + q] = x);
  });
  return out;
}

/** For each new row: index of the old row it continues (unchanged, or edited in place), or -1 = a new row. Old rows left out were removed. */
export function alignRows(oldRows: string[], newRows: string[]): number[] {
  const out = newRows.map(() => -1);
  const words = (s: string) => new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  const sim = (a: string, b: string) => { const A = words(a), B = words(b); let c = 0; A.forEach(w => { if (B.has(w)) c++; }); return c / Math.max(1, A.size, B.size); };
  lcsWalk(oldRows, newRows, (i, j) => { out[j] = i; }, (i0, i1, j0, j1) => {
    if (i1 - i0 === j1 - j0) { for (let q = 0; q < j1 - j0; q++) out[j0 + q] = i0 + q; return; } // edited in place
    let from = j0; // rows added/removed around edits: an old row goes to the most similar new row (in order)
    for (let i = i0; i < i1; i++) {
      let best = -1, bs = 0.5;
      for (let j = from; j < j1; j++) { const s = sim(oldRows[i], newRows[j]); if (s >= bs) { bs = s; best = j; if (s === 1) break; } }
      if (best >= 0) { out[best] = i; from = best + 1; }
    }
  });
  return out;
}

/** Replace unit k with `value` (several words or '|' syllables are fine, empty = delete). Its span is split among the new units. */
export function replaceUnit(text: string, sync: WordSync[] | null | undefined, k: number, value: string): { text: string; sync: WordSync[] | null } | null {
  const us = units(text), old = us[k]; if (!old) return null;
  const nu = units(value);
  if (nu.length) nu[nu.length - 1].sp = old.sp;
  else if (k > 0 && !us[k - 1].sp) us[k - 1].sp = old.sp; // deleted the last syllable of a word
  const ok = !!sync && sync.length === us.length;
  us.splice(k, 1, ...nu);
  if (!ok) return { text: unitsText(us), sync: null };
  const x = sync![k], ns = sync!.slice();
  ns.splice(k, 1, ...(timed(x) ? spread(nu, x.a!, x.b!, x.g) : nu.map(() => ({ a: null, b: null }))));
  return { text: unitsText(us), sync: ns };
}

/** New empty line at time t (kept sorted by start). Returns its index. */
export function insertLine(lines: Line[], t: number, extra: Partial<Line> = {}): number {
  let i = lines.findIndex(l => l.t > t); if (i < 0) i = lines.length;
  const nx = lines[i], end = Math.max(t + 0.5, Math.min(t + 3, nx ? nx.t : t + 3));
  lines.splice(i, 0, { t: r3(t), end: r3(end), text: '', tr: '', ...extra });
  return i;
}

/** words inside (...) go to the background part; timings travel with their words */
function splitParens(text: string, sync: WordSync[] | null | undefined) {
  const us = units(text), ok = !!sync && sync.length === us.length;
  const parts = { main: { us: [] as Unit[], sy: [] as WordSync[] }, bg: { us: [] as Unit[], sy: [] as WordSync[] } };
  let depth = 0;
  us.forEach((u, k) => {
    const open = (u.w.match(/\(/g) || []).length, close = (u.w.match(/\)/g) || []).length, inBg = depth > 0 || open > 0;
    depth = Math.max(0, depth + open - close);
    const w = inBg ? u.w.replace(/[()]/g, '') : u.w, dst = inBg ? parts.bg : parts.main;
    if (!w) { if (dst.us.length) dst.us[dst.us.length - 1].sp = true; return; }
    dst.us.push({ w, sp: u.sp }); if (ok) dst.sy.push(sync![k]);
  });
  const fin = (p: { us: Unit[]; sy: WordSync[] }) => { if (p.us.length) p.us[p.us.length - 1].sp = true; return { text: unitsText(p.us), sync: ok && p.us.length ? p.sy : null }; };
  return { main: fin(parts.main), bg: fin(parts.bg) };
}

/** "main (backing)" -> main text + background vocals, for the original and the translation. false = nothing to move. */
export function parensToBg(l: Line): boolean {
  if (!/\(/.test(l.text + (l.tr || ''))) return false;
  const o = splitParens(l.text, l.sync?.orig), t = splitParens(l.tr || '', l.sync?.tr);
  if (!o.bg.text && !t.bg.text) return false;
  const had = !!(l.bg && (l.bg.text.trim() || l.bg.tr.trim())), bg = l.bg || { text: '', tr: '' };
  const join = (a: string, b: string) => [a.trim(), b].filter(Boolean).join(' ');
  l.text = o.main.text; l.tr = t.main.text;
  bg.text = join(bg.text, o.bg.text); bg.tr = join(bg.tr, t.bg.text); l.bg = bg;
  const sy = l.sync = l.sync || {};
  const put = (k: 'orig' | 'tr' | 'bg' | 'bgo', v: WordSync[] | null) => { if (v) sy[k] = v; else delete sy[k]; };
  put('orig', o.main.sync); put('tr', t.main.sync);
  if (had) { delete sy.bg; delete sy.bgo; } else { put('bgo', o.bg.sync); put('bg', t.bg.sync); }
  return true;
}

/* ---------- whole-song text, find & replace, chorus timing ---------- */
const NB = /[^\S\u00a0]+/g; // whitespace except NBSP (NBSP glues two words into one timed block)
const txt = (l: Line, layer: Layer) => layer === 'tr' ? (l.tr || '') : layer === 'orig' ? l.text : layer === 'bg' ? (l.bg?.tr || '') : (l.bg?.text || '');
/** one row of the whole-text editor: "main (background)" */
export function lineRow(l: Line, tr: boolean) {
  const m = txt(l, tr ? 'tr' : 'orig').trim(), b = txt(l, tr ? 'bg' : 'bgo').trim();
  return b ? (m ? m + ' ' : '') + '(' + b + ')' : m;
}
/** "main (background)" -> parts; several (…) groups are joined */
export function parseRow(row: string) {
  const bg = [...row.matchAll(/\(([^)]*)\)/g)].map(m => m[1].replace(NB, ' ').trim()).filter(Boolean).join(' ');
  return { main: row.replace(/\([^)]*\)?/g, ' ').replace(NB, ' ').trim(), bg };
}

export interface FindOpts { find: string; repl: string; layers: Layer[]; cs?: boolean; word?: boolean }
export function findRegex(o: Pick<FindOpts, 'find' | 'cs' | 'word'>) {
  const e = o.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(o.word ? `(?<![\\p{L}\\p{N}])${e}(?![\\p{L}\\p{N}])` : e, 'gu' + (o.cs ? '' : 'i'));
}
/** count matches per layer text; replace() returns new texts only for changed (line, layer) pairs */
export function findAll(lines: Line[], o: FindOpts) {
  if (!o.find) return { n: 0, edits: [] as { i: number; layer: Layer; text: string }[] };
  const re = findRegex(o); let n = 0;
  const edits: { i: number; layer: Layer; text: string }[] = [];
  lines.forEach((l, i) => o.layers.forEach(layer => {
    const t = txt(l, layer), c = (t.match(re) || []).length; if (!c) return;
    n += c; edits.push({ i, layer, text: t.replace(re, () => o.repl).replace(NB, ' ').trim() });
  }));
  return { n, edits };
}

const norm = (s: string) => plainW(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** lines whose original reads the same as line i (a chorus); empty lead lines never match */
export function sameLines(lines: Line[], i: number) {
  const k = norm(lines[i]?.text || ''); if (!k) return [];
  return lines.map((l, j) => j !== i && norm(l.text) === k ? j : -1).filter(j => j >= 0);
}
/**
 * Copy the word timings of line i onto the lines that read the same (chorus), shifted by the line start difference.
 * Per layer: only where the source is fully timed, the target has the same words and is not done by hand yet.
 * Copied words are flagged auto (g) — they still need a look. Returns the number of lines changed.
 */
export function repeatTiming(lines: Line[], i: number, layers: Layer[] = ['orig', 'tr', 'bgo', 'bg']) {
  const s = lines[i]; let n = 0;
  for (const j of sameLines(lines, i)) {
    const d = lines[j], off = d.t - s.t; let did = false;
    for (const layer of layers) {
      const ws = wordList(txt(s, layer)), src = s.sync?.[layer];
      if (!syncComplete(src, ws.length) || wordList(txt(d, layer)).map(norm).join('\n') !== ws.map(norm).join('\n')) continue;
      const cur = d.sync?.[layer];
      if (syncComplete(cur, ws.length) && !cur.some(x => x.g)) continue; // already marked by hand
      d.sync = d.sync || {};
      d.sync[layer] = src.map(x => ({ a: r3(x.a + off), b: r3(x.b + off), g: 1 as const }));
      did = true;
    }
    if (did) n++;
  }
  return n;
}
