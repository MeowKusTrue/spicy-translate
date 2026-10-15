// Timeline maths shared by the web editor's wave and the Spicetify extension's timeline (pure: no DOM, no canvas).
// DaVinci-style editing: touching ("glued") edges roll together, Alt detaches, no overlaps, magnet snapping.
import type { Layer, Line, WordSync } from './types.ts';
import { fitBgOnly } from './edit.ts';
import { wordList } from './words.ts';

export const JOIN = 0.0015; // edges closer than this are glued
export type Seq = { i: number; k: number; x: WordSync & { a: number; b: number } };
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const txt = (l: Line, k: Layer) => k === 'tr' ? (l.tr || '') : k === 'orig' ? l.text : k === 'bg' ? (l.bg?.tr || '') : (l.bg?.text || '');
/** g:1 = auto-placed; any hand edit confirms the word */
export const conf = (...xs: (WordSync | null | undefined)[]) => xs.forEach(x => { if (x) delete x.g; });

/** every timed word of a track, in song order */
export function seqWords(lines: Line[], layer: Layer): Seq[] {
  const out: Seq[] = [];
  lines.forEach((l, i) => {
    const sy = l.sync && l.sync[layer]; if (!sy || sy.length !== wordList(txt(l, layer)).length) return;
    sy.forEach((x, k) => { if (x.a != null && x.b != null) out.push({ i, k, x: x as Seq['x'] }); });
  });
  return out;
}
/** the closest magnet target within tol seconds */
export function nearest(t: number, cands: number[], tol: number) {
  let best: { d: number; c: number } | null = null;
  for (const c of cands) { const d = Math.abs(c - t); if (d <= tol && (!best || d < best.d)) best = { d, c }; }
  return best;
}
/** the line at time t (lead lines win over background-only ones); -1 = none */
export function lineAt(lines: Line[], t: number) {
  let r = -1; lines.forEach((l, i) => { if (t >= l.t && t <= l.end && (r < 0 || l.text.trim() || !lines[r].text.trim())) r = i; }); return r;
}
/** overlapping lines (duets, background-only lines) get their own rows in the lines band, up to 3 */
export function bandRows(lines: Line[]) {
  const ends: number[] = [];
  return lines.map(l => { let r = ends.findIndex(e => e <= l.t + 0.01); if (r < 0) { r = Math.min(2, ends.length); if (r === ends.length) ends.push(0); } ends[r] = Math.max(ends[r], l.end); return r; });
}
/** background-only lines follow their words and lines stay ordered by start; returns the new index of `keep` (or -1) */
export function fitAndSort(lines: Line[], keep?: Line | null) {
  let moved = false;
  lines.forEach(l => { const t = l.t; fitBgOnly(l); if (l.t !== t) moved = true; });
  if (moved) lines.sort((x, y) => x.t - y.t);
  return { moved, at: keep ? lines.indexOf(keep) : -1 };
}

/* ---------- dragging a word edge ---------- */
export interface EdgeDrag { roll: boolean; me: Seq; partner: Seq | null; target: { e: Seq; edge: 'a' | 'b' }; sq: Seq[] }
/** grab the edge of word sq[idx]; a glued neighbour rolls with it unless `detach` (Alt), then the cursor side is trimmed */
export function startEdge(sq: Seq[], idx: number, edge: 'a' | 'b', detach: boolean, tCursor: number): EdgeDrag {
  const me = sq[idx], x = me.x; let partner: Seq | null = null;
  if (edge === 'b') { const n = sq[idx + 1]; if (n && Math.abs(n.x.a - x.b) <= JOIN) partner = n; }
  else { const p = sq[idx - 1]; if (p && Math.abs(p.x.b - x.a) <= JOIN) partner = p; }
  let target = { e: me, edge };
  if (partner && detach) {
    const bt = edge === 'b' ? x.b : x.a, left = edge === 'b' ? me : partner, right = edge === 'b' ? partner : me;
    target = tCursor < bt ? { e: left, edge: 'b' } : { e: right, edge: 'a' };
  }
  return { roll: !!partner && !detach, me, partner, target, sq };
}
/** move the grabbed edge to t; returns false when it had to be clamped (the magnet mark should go) */
export function moveEdge(d: EdgeDrag & { edge: 'a' | 'b' }, t: number) {
  let T: number;
  if (d.roll) {
    const L = d.edge === 'b' ? d.me : d.partner!, R = d.edge === 'b' ? d.partner! : d.me;
    T = clamp(t, L.x.a + 0.02, R.x.b - 0.02); L.x.b = T; R.x.a = T; conf(L.x, R.x);
  } else {
    const te = d.target.e, ti = d.sq.indexOf(te), pv = d.sq[ti - 1], nx = d.sq[ti + 1];
    if (d.target.edge === 'a') { T = clamp(t, pv ? pv.x.b : 0, te.x.b - 0.02); te.x.a = T; }
    else { T = clamp(t, te.x.a + 0.02, nx ? nx.x.a : 1e9); te.x.b = T; }
    conf(te.x);
  }
  return T === t;
}

/* ---------- dragging a whole word ---------- */
export interface MoveDrag { me: Seq; pv?: Seq; nx?: Seq; jp: boolean; jn: boolean; len: number }
export function startMove(sq: Seq[], idx: number): MoveDrag {
  const me = sq[idx], pv = sq[idx - 1], nx = sq[idx + 1];
  return { me, pv, nx, jp: !!(pv && Math.abs(pv.x.b - me.x.a) <= JOIN), jn: !!(nx && Math.abs(nx.x.a - me.x.b) <= JOIN), len: me.x.b - me.x.a };
}
/** put the word's start at a; glued neighbours follow (stretch) unless `alone` (Shift); never overlaps. false = clamped */
export function moveWord(d: MoveDrag, a: number, alone: boolean) {
  const w = d.me.x, len = d.len, follow = !alone, pv = d.pv, nx = d.nx;
  const lo = follow && d.jp ? pv!.x.a + 0.02 : (pv ? pv.x.b : 0);
  const hi = follow && d.jn ? nx!.x.b - 0.02 - len : (nx ? nx.x.a - len : 1e9);
  const a2 = clamp(a, lo, hi);
  w.a = r3(a2); w.b = r3(a2 + len); conf(w, follow && d.jp ? pv!.x : null, follow && d.jn ? nx!.x : null);
  if (follow && d.jp) pv!.x.b = w.a; if (follow && d.jn) nx!.x.a = w.b;
  return a2 === a;
}
/** snap a word of length len starting near a: whichever of its two edges is closer to a magnet target wins */
export function snapSpan(a: number, len: number, cands: number[], tol: number) {
  const na = nearest(a, cands, tol), nb = nearest(a + len, cands, tol);
  if (na && (!nb || na.d <= nb.d)) return { a: na.c, at: na.c };
  if (nb) return { a: nb.c - len, at: nb.c };
  return { a, at: null as number | null };
}
