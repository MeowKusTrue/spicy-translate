import type { Layer, Line } from './types.ts';
import { editorText, confirmPhraseTiming } from './editor.ts';
import { units, wordList } from './words.ts';

/** A touched phrase is protected as a whole, even when some words still need timing. */
export function protectTiming(line: Line, layer: Layer) {
  line.approved = { ...line.approved, [layer]: true };
  const plan = confirmPhraseTiming(line, layer);
  if (!('error' in plan)) (line.sync ||= {})[layer] = plan.sync;
}
export function allowAutomation(line: Line, layer: Layer) {
  if (line.approved) { delete line.approved[layer]; if (!Object.keys(line.approved).length) delete line.approved; }
  line.sync?.[layer]?.forEach(w => { if (w.a != null && w.b != null) w.g = 1; });
}
export function approveWords(lines: Line[], selected: { i: number; k: number; layer: Layer }[]) {
  let changed = 0, skipped = 0;
  for (const { i, k, layer } of selected) {
    const l = lines[i], sy = l?.sync?.[layer], w = sy?.[k];
    if (!l || !w || w.a == null || w.b == null || !Number.isFinite(w.a) || !Number.isFinite(w.b) || w.a < 0 || w.b <= w.a || sy!.length !== units(editorText(l, layer)).length) { skipped++; continue; }
    if ((k > 0 && sy![k-1].b != null && w.a! < sy![k-1].b!-.002) || (k+1 < sy!.length && sy![k+1].a != null && w.b! > sy![k+1].a!+.002)) { skipped++; continue; }
    delete w.g; delete w.c; changed++;
    if (!('error' in confirmPhraseTiming(l, layer)) && !sy!.some(x => x.g)) l.approved = { ...l.approved, [layer]: true };
  }
  return { changed, skipped };
}
export function approvePhrases(lines: Line[], ids: number[], layer: Layer) {
  let changed = 0, skipped = 0;
  for (const i of new Set(ids)) {
    const l = lines[i]; if (!l || 'error' in confirmPhraseTiming(l, layer)) { skipped++; continue; }
    protectTiming(l, layer); changed++;
  }
  return { changed, skipped };
}
/** Re-aligning must preserve approved phrases and individually hand-marked words too. */
export function mergeAutoLayer(line: Line, result: Line, layer: Layer) {
  if (line.approved?.[layer] || editorText(line, layer) !== editorText(result, layer)) return false;
  const next = result.sync?.[layer], old = line.sync?.[layer], n = wordList(editorText(line, layer)).length;
  if (!n || next?.length !== n) return false;
  const merged = next.map((w, k) => old?.length === n && old[k].a != null && old[k].b != null && !old[k].g ? { ...old[k] } : { ...w, g: 1 as const });
  if (JSON.stringify(merged) === JSON.stringify(old)) return false;
  (line.sync ||= {})[layer] = merged; return true;
}
