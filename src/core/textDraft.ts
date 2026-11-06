import type { Layer, Line, WordSync } from './types.ts';
import { editorText } from './editor.ts';
import { remapSync } from './edit.ts';
import { splitWords } from './words.ts';

/** A display-only candidate: original project data and autosave stay untouched until Enter. */
export function textDraftLine(line: Line, layer: Layer, text: string): Line {
  const before = line.sync?.[layer];
  const mapped = remapSync(editorText(line, layer), text, before);
  const sync: WordSync[] = mapped || splitWords(text, line.t, line.end).map(w => ({ a: w.a, b: w.b, g: 1 as const }));
  sync.forEach(x => { if (x.a != null && x.b != null && !before?.some(o => o.a === x.a && o.b === x.b)) { x.g = 1; delete x.c; } });
  const out: Line = { ...line, sync: { ...line.sync, [layer]: sync } };
  if (layer === 'orig') out.text = text; else if (layer === 'tr') out.tr = text;
  else out.bg = { text: line.bg?.text || '', tr: line.bg?.tr || '', [layer === 'bgo' ? 'text' : 'tr']: text };
  return out;
}
