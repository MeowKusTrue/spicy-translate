import type { Layer, Line, Mode } from './types.ts';
import { wordList } from './words.ts';
import { editorText } from './editor.ts';

/** Fit complete exported tracks only. Partial/invalid timings must never trim unmarked words away. */
export function planFitAll(lines: Line[], mode: Mode, pad = { a: 0, b: 0 }) {
  let changed = 0, skipped = 0;
  const fitted = lines.map(l => {
    const main: Layer = mode === 'translation' && l.tr.trim() ? 'tr' : 'orig';
    const back: Layer = mode === 'translation' && l.bg?.tr.trim() ? 'bg' : 'bgo';
    const layers: Layer[] = [main, back]; if (mode === 'bilingual' && l.tr.trim()) layers.push('tr');
    const populated = layers.filter(k => wordList(editorText(l, k)).length);
    if (!populated.length) return l;
    const complete = populated.every(k => {
      const sy = l.sync?.[k]; return sy?.length === wordList(editorText(l, k)).length && sy.every(x => x.a != null && x.b != null && Number.isFinite(x.a) && Number.isFinite(x.b) && x.a >= 0 && x.b > x.a);
    });
    if (!complete) { skipped++; return l; }
    const ws = populated.flatMap(k => l.sync![k]!);
    const t = Math.round(Math.max(0, Math.min(...ws.map(x => x.a!)) - pad.a) * 1000) / 1000;
    const end = Math.round(Math.max(t + .02, Math.max(...ws.map(x => x.b!)) + pad.b) * 1000) / 1000;
    if (t === l.t && end === l.end) return l;
    changed++; return { ...l, t, end };
  });
  return { lines: fitted, changed, skipped };
}
