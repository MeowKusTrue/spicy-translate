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
  // similarity = Dice over letter pairs of the lead text (background in brackets ignored), so "water" -> "waters" still matches
  const pairs = (s: string) => { const t = s.replace(/\([^)]*\)?/g, ' ').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(), m = new Map<string, number>(); for (let k = 0; k + 1 < t.length; k++) { const p = t.slice(k, k + 2); m.set(p, (m.get(p) || 0) + 1); } return m; };
  const sim = (a: string, b: string) => {
    const A = pairs(a), B = pairs(b); let c = 0, na = 0, nb = 0;
    A.forEach((v, p) => { na += v; c += Math.min(v, B.get(p) || 0); }); B.forEach(v => { nb += v; });
    return na + nb ? 2 * c / (na + nb) : 0;
  };
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

/* ---------- copies: moving / duplicating lines, dropping a word copy ---------- */
/** shift a whole line (its span and every timed word on every track) by d seconds, measured from snapshot o */
export function shiftLine(l: Line, o: Line, d: number) {
  d = Math.max(d, -o.t);
  l.t = r3(o.t + d); l.end = r3(o.end + d);
  if (o.sync) for (const k of Object.keys(o.sync) as Layer[]) l.sync?.[k]?.forEach((x, j) => { const y = o.sync![k]![j]; if (y && y.a != null) x.a = r3(y.a + d); if (y && y.b != null) x.b = r3(y.b + d); });
}
/**
 * Another version of the track (sped up / slowed down, other master): every time t -> at + (t - at) * k,
 * lines and all their words. k = new length / old length.
 */
export function stretchLines(lines: Line[], k: number, at = 0) {
  const f = (x: number) => r3(Math.max(0, at + (x - at) * k));
  for (const l of lines) {
    l.t = f(l.t); l.end = f(l.end);
    if (l.sync) for (const ly of Object.keys(l.sync) as Layer[]) l.sync[ly]?.forEach(x => { if (x && x.a != null) x.a = f(x.a); if (x && x.b != null) x.b = f(x.b); });
  }
}
/** "3:42.5", "3:42" or "222.5" -> seconds (NaN if not a time) */
export const parseDur = (s: string) => { const m = String(s).trim().match(/^(?:(\d+):)?(\d+(?:[.,]\d+)?)$/); return m ? (+(m[1] || 0)) * 60 + +m[2].replace(',', '.') : NaN; };
const setTxt = (l: Line, layer: Layer, v: string) => {
  if (layer === 'tr') l.tr = v; else if (layer === 'orig') l.text = v;
  else { l.bg = l.bg || { text: '', tr: '' }; if (layer === 'bg') l.bg.tr = v; else l.bg.text = v; }
};
/**
 * Insert word(s) `w` into a line's layer at [a, b] (a dropped copy): goes between the words around that time,
 * never inside a word split into syllables; touching neighbours give way so nothing overlaps. Returns the unit index.
 * The layer should be fully timed (fillLine first); otherwise its timings are dropped.
 */
export function insertWord(l: Line, layer: Layer, w: string, a: number, b: number) {
  const us = units(txt(l, layer)), nu = units(w); if (!nu.length) return -1;
  if (!us.length) { l.sync = l.sync || {}; l.sync[layer] = []; } // empty track: the copy is its first word
  const sy = l.sync?.[layer], ok = !!sy && sy.length === us.length && sy.every(timed);
  let k = ok ? sy!.filter(x => x.a! + (x.b! - x.a!) / 2 < a + (b - a) / 2).length : us.length;
  while (k > 0 && k < us.length && !us[k - 1].sp) k++; // keep syllables of one word together
  nu[nu.length - 1].sp = true;
  us.splice(k, 0, ...nu); setTxt(l, layer, unitsText(us));
  if (!ok) { if (l.sync) delete l.sync[layer]; return k; }
  const p = sy![k - 1], n = sy![k];
  if (p && p.b! > a) { p.b = r3(Math.max(p.a! + 0.02, a)); a = Math.max(a, p.b!); }
  if (n && n.a! < b) { n.a = r3(Math.min(n.b! - 0.02, b)); b = Math.min(b, n.a!); }
  if (b < a + 0.02) b = a + 0.02;
  sy!.splice(k, 0, ...spread(nu, a, b));
  return k;
}

/** a background-only line spans exactly its timed background words (so it neither hides nor swallows its neighbours) */
export function fitBgOnly(l: Line) {
  if (l.text.trim()) return false;
  const xs = [...(l.sync?.bgo || []), ...(l.sync?.bg || [])].filter(timed);
  if (!xs.length) return false;
  const a = r3(Math.min(...xs.map(x => x.a!))), b = r3(Math.max(a + 0.3, ...xs.map(x => x.b!)));
  if (a === l.t && b === l.end) return false;
  l.t = a; l.end = b; return true;
}
/** Alt+drag copies: a NEW line made of copied words (each keeps its track and timing), like a duplicated clip */
export function lineFromWords(ws: { layer: Layer; w: string; a: number; b: number }[]): Line | null {
  const l: Line = { t: 0, end: 0, text: '', tr: '' }, all: number[] = [];
  for (const layer of ['orig', 'tr', 'bgo', 'bg'] as Layer[]) {
    const us: Unit[] = [], sy: WordSync[] = [];
    ws.filter(x => x.layer === layer).sort((p, q) => p.a - q.a).forEach(x => {
      const nu = units(x.w); if (!nu.length) return;
      nu[nu.length - 1].sp = true; us.push(...nu); sy.push(...spread(nu, r3(x.a), r3(Math.max(x.a + 0.02, x.b)))); all.push(x.a, x.b);
    });
    if (us.length) { setTxt(l, layer, unitsText(us)); (l.sync = l.sync || {})[layer] = sy; }
  }
  if (!all.length) return null;
  l.t = r3(Math.max(0, Math.min(...all))); l.end = r3(Math.max(l.t + 0.3, ...all));
  return l;
}

/* ---------- copy a line's timing onto other lines ---------- */
/** the timing of a line track as offsets from the line start (null unless every word is timed) */
export function timingOf(l: Line, layer: Layer) {
  const sy = l.sync?.[layer], n = wordList(txt(l, layer)).length;
  return syncComplete(sy, n) ? sy.map(x => ({ a: x.a - l.t, b: x.b - l.t })) : null;
}
/**
 * Put a copied timing onto n words starting at line start t0. Same word count = exact copy; otherwise the
 * rhythm is resampled (word j sits where position j·m/n falls in the source). Flagged auto (g) for a check.
 */
export function pasteTiming(rel: { a: number; b: number }[], n: number, t0: number): WordSync[] {
  const m = rel.length; if (!m || !n) return [];
  if (m === n) return rel.map(x => ({ a: r3(t0 + x.a), b: r3(t0 + x.b), g: 1 as const }));
  const at = (x: number) => { const k = Math.min(m - 1, Math.floor(x)), f = x - k; const s = rel[k].a, e = k + 1 < m ? rel[k + 1].a : rel[m - 1].b; return s + f * (e - s); };
  return Array.from({ length: n }, (_, j) => {
    const a = at(j * m / n), b = j + 1 < n ? at((j + 1) * m / n) : rel[m - 1].b;
    return { a: r3(t0 + a), b: r3(t0 + Math.max(a + 0.02, b)), g: 1 as const };
  });
}

/**
 * Give line `dst` the word timing of `src` on every track both have words on (Alt+drag a line onto another):
 * dst keeps its texts, the rhythm starts at t0 (where src was dropped). Returns the number of tracks changed.
 */
export function transferTiming(src: Line, dst: Line, t0: number) {
  let n = 0;
  for (const k of ['orig', 'tr', 'bgo', 'bg'] as Layer[]) {
    const rel = timingOf(src, k), w = wordList(txt(dst, k)).length;
    if (!rel || !w) continue;
    (dst.sync = dst.sync || {})[k] = pasteTiming(rel, w, t0); n++;
  }
  if (n) { const all = Object.values(dst.sync || {}).flat().filter(timed); dst.t = r3(Math.min(t0, ...all.map(x => x.a!))); dst.end = r3(Math.max(dst.t + 0.3, ...all.map(x => x.b!))); }
  return n;
}

/**
 * Translation memory for repeats: lines that read the same in the original (a chorus) and have no translation yet
 * get the translation of a translated one (and of its background vocals, when those read the same too).
 * `from` = only spread this line's translation. Returns the changed line indexes.
 */
export function repeatTranslations(lines: Line[], from?: number) {
  const changed = new Set<number>();
  for (const i of from != null ? [from] : lines.map((_, k) => k)) {
    const s = lines[i]; if (!s || !(s.tr || '').trim()) continue;
    for (const j of sameLines(lines, i)) {
      const d = lines[j];
      if (!(d.tr || '').trim()) { d.tr = s.tr; changed.add(j); }
      if (s.bg?.tr.trim() && d.bg && !d.bg.tr.trim() && norm(d.bg.text) === norm(s.bg.text)) { d.bg.tr = s.bg.tr; changed.add(j); }
    }
  }
  return [...changed];
}

/**
 * A corrected row (e.g. from Genius) that keeps our markup on the words it did not change:
 * a word equal to an old one apart from "|" syllable splits comes back with its splits.
 */
export function mergeMarkup(oldRow: string, newRow: string) {
  const A = oldRow.split(' ').filter(Boolean), B = newRow.split(' ').filter(Boolean), out = B.slice();
  lcsWalk(A.map(w => w.replace(/\|/g, '')), B, (i, j) => { out[j] = A[i]; }, () => {});
  return out.join(' ');
}

/**
 * Correct our rows by a reference text with other line breaks (Genius): words are matched across the whole song,
 * so our lines (and their timings) stay and only get the reference's words. Reference rows we lack entirely
 * come back as additions (after our row `after`), our rows the reference lacks as deletions.
 */
export function textDiff(oldRows: string[], newRows: string[]) {
  const keyOf = (w: string) => w.replace(/\|/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '') || w;
  const tok = (rows: string[]) => rows.flatMap((row, r) => row.split(/[ \u00a0]+/).filter(Boolean).map(w => ({ w, k: keyOf(w), r })));
  const A = tok(oldRows), B = tok(newRows), out: string[][] = oldRows.map(() => []), adds: { after: number; row: string }[] = [];
  const rowSpan = new Map<number, [number, number]>(); B.forEach((t, j) => { const s = rowSpan.get(t.r); rowSpan.set(t.r, s ? [s[0], j] : [j, j]); });
  let last = -1; // our row of the last placed word
  // same word: keep our syllable splits; where only our line breaks, keep the line's capital (if it still starts it) and its end without a comma
  const same = (i: number, j: number) => {
    const o = A[i].w.replace(/\|/g, ''), n = B[j].w;
    return o === n || (!out[A[i].r].length && o.toLowerCase() === n.toLowerCase()) || (A[i + 1]?.r !== A[i].r && o === n.replace(/[,;]$/, ''));
  };
  const rowLine: number[] = newRows.map(() => -1);
  const match = (i: number, j: number) => { out[A[i].r].push(same(i, j) ? A[i].w : B[j].w); last = A[i].r; if (rowLine[B[j].r] < 0) rowLine[B[j].r] = A[i].r; };
  const gap = (i0: number, i1: number, j0: number, j1: number) => {
    if (j1 <= j0) return; // only our words: dropped
    const full = (q: number) => { const [s, e] = rowSpan.get(B[q].r)!; return s >= j0 && e < j1; };
    if (i1 > i0) { // replaced words go to the rows of the words they replace, in proportion
      let p0 = j0, p1 = j1; // whole reference rows around the replaced words (ad-libs, intros) are lines of their own
      while (p0 < p1 && full(p0)) p0++;
      while (p1 > p0 && full(p1 - 1)) p1--;
      if (p0 === p1) { p0 = j0; p1 = j1; }
      const rows = (a: number, b: number, after: number) => { for (let q = a; q < b;) { const r = B[q].r, e = rowSpan.get(r)![1] + 1; adds.push({ after, row: B.slice(q, e).map(t => t.w).join(' ') }); q = e; } };
      rows(j0, p0, last);
      for (let q = p0; q < p1; q++) out[A[i0 + Math.min(i1 - i0 - 1, Math.floor((q - p0) * (i1 - i0) / (p1 - p0)))].r].push(B[q].w);
      last = A[i1 - 1].r; rows(p1, j1, last); return;
    }
    for (let q = j0; q < j1;) { // inserted words: whole reference rows become new lines, pieces join a neighbour
      const r = B[q].r, [s, e] = rowSpan.get(r)!, end = Math.min(j1, e + 1);
      const words = B.slice(q, end).map(t => t.w);
      if (s >= j0 && e < j1) adds.push({ after: last, row: words.join(' ') });
      else { const to = B[q - 1]?.r === r && last >= 0 ? last : A[i1]?.r ?? Math.max(0, last); out[to].push(...words); } // a row's tail joins the line before, its head the line after
      q = end;
    }
  };
  // matches across the whole song; a lone short word ("эй") matched far from its row is noise, not an anchor
  const pairs: [number, number][] = []; lcsWalk(A.map(t => t.k), B.map(t => t.k), (i, j) => pairs.push([i, j]), () => {});
  const near = (p: [number, number], q?: [number, number]) => !!q && Math.abs(q[0] - p[0]) === 1 && Math.abs(q[1] - p[1]) === 1;
  let pi = 0, pj = 0;
  pairs.forEach((p, x) => {
    if (A[p[0]].k.length < 4 && !near(p, pairs[x - 1]) && !near(p, pairs[x + 1])) return;
    gap(pi, p[0], pj, p[1]); match(p[0], p[1]); pi = p[0] + 1; pj = p[1] + 1;
  });
  gap(pi, A.length, pj, B.length);
  const edits: { m: number; row: string }[] = [], dels: number[] = [];
  oldRows.forEach((r, m) => { const n = out[m].join(' '); if (!r.trim()) return; if (!n) dels.push(m); else if (n !== r.trim().split(/ +/).join(' ')) edits.push({ m, row: n }); });
  return { edits, adds, dels, rowLine };
}
