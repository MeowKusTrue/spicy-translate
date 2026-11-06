import type { Layer, Line } from './types.ts';
import { editorText, confirmPhraseTiming } from './editor.ts';
const key = (s: string) => s.replace(/\|/g,'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim().toLocaleLowerCase();
/** Copy the active track's exact rhythm to every matching phrase, relative to each phrase's own start. */
export function repeatAllPlan(lines: Line[], from: number, layer: Layer, replaceApproved = false) {
  const source = lines[from]; if (!source) return { error: 'Выбери исходную строку.' };
  const ready = confirmPhraseTiming(source,layer); if ('error' in ready) return { error: ready.error };
  const text = editorText(source,layer), normalized = key(text);
  const out = structuredClone(lines); let matched = 0, changed = 0, skipped = 0;
  for (let i = 0; i < out.length; i++) {
    if (i === from || !normalized || key(editorText(out[i],layer)) !== normalized) continue;
    matched++; const l = out[i];
    if (l.approved?.[layer] && !replaceApproved) { skipped++; continue; }
    const off = l.t-source.t, sync = ready.sync.map(w => ({ a: Math.round((w.a!+off)*1000)/1000, b: Math.round((w.b!+off)*1000)/1000, g: 1 as const }));
    if (sync.some(w => w.a < 0)) { skipped++; continue; }
    if (JSON.stringify(l.sync?.[layer]) === JSON.stringify(sync) && editorText(l,layer) === text) continue;
    if (layer === 'orig') l.text = text; else if (layer === 'tr') l.tr = text; else l.bg = { text: l.bg?.text || '', tr: l.bg?.tr || '', [layer === 'bgo' ? 'text':'tr']:text };
    (l.sync ||= {})[layer] = sync;
    if (l.approved) { delete l.approved[layer]; if (!Object.keys(l.approved).length) delete l.approved; }
    changed++;
  }
  return { lines: out, matched, changed, skipped };
}
