import { S, emit, wordsOf } from './state.ts';
import { selectWord } from './sync.ts';
import { W, drawWave } from './waveform/wave.ts';
let anchor: { i: number; k: number; layer: typeof S.layer } | null = null;
export function pickWord(i: number, k: number, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) {
  if (S.editDraft) return;
  S.picked.clear();
  const at = { i, k, layer: S.layer }, same = (q: typeof at, x: typeof at) => q.i === x.i && q.k === x.k && q.layer === x.layer;
  if (e.shiftKey && anchor?.layer === S.layer) {
    const all = S.lines.flatMap((_, li) => wordsOf(li, S.layer).map((_, wi) => ({ i: li, k: wi, layer: S.layer })));
    const a = all.findIndex(q => same(q, anchor!)), b = all.findIndex(q => same(q, at));
    W.multi = a >= 0 && b >= 0 ? all.slice(Math.min(a,b), Math.max(a,b)+1) : [at];
  } else if (e.ctrlKey || e.metaKey) {
    if (!W.multi.length && S.sel) W.multi = [{ ...S.sel, layer: S.layer }];
    const n = W.multi.findIndex(q => same(q, at)); if (n < 0) W.multi.push(at); else W.multi.splice(n,1);
    if (!anchor || anchor.layer !== S.layer) anchor = at;
  } else { W.multi = []; anchor = at; }
  selectWord(i,k); emit(); drawWave();
}
export function toggleLinePick(i: number) {
  if (S.editDraft) return;
  W.multi = []; if (S.picked.has(i)) S.picked.delete(i); else S.picked.add(i);
  S.pickAnchor = i; emit(); drawWave();
}
export function clearSelection() { W.multi = []; S.picked.clear(); anchor = null; emit(); drawWave(); }
