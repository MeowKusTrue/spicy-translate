import type { Layer, Line, WordSync } from './types.ts';
import { units } from './words.ts';

/** Closing punctuation is part of the preceding word, never a separate sung block.
 * Keep line breaks, opening quotes, dashes and all other spacing as authored. */
export const attachPunctuation = (text: string): string => text.replace(/([^\s|])(?:[^\S\r\n]|\|)+(?=[,.;:!?…%‰)\]}»”’]+(?:[\s|]|$))/gu, '$1');

/** Drop standalone punctuation spans without extending/redistributing real word timings. */
export function punctuationTrack(text: string, sync?: WordSync[] | null): { text: string; sync: WordSync[] | undefined } {
  const next = attachPunctuation(text);
  if (next === text) return { text, sync: sync || undefined };
  const old = units(text), fresh = units(next);
  if (!sync || sync.length !== old.length) return { text: next, sync: undefined };
  let at = 0; const mapped: WordSync[] = [];
  for (const target of fresh) {
    const first = at; let joined = '';
    do { joined += attachPunctuation(old[at++]?.w || ''); } while (joined !== target.w && at < old.length && target.w.startsWith(joined));
    if (joined !== target.w) return { text: next, sync: undefined };
    mapped.push({ ...sync[first] });
  }
  return { text: next, sync: at === old.length ? mapped : undefined };
}

export function punctuationLine(line: Line): Line {
  let out = line;
  for (const layer of ['orig','tr','bgo','bg'] as Layer[]) {
    const text = layer === 'orig' ? line.text : layer === 'tr' ? line.tr : line.bg?.[layer === 'bgo' ? 'text' : 'tr'] || '';
    const next = punctuationTrack(text, line.sync?.[layer]);
    if (next.text === text) continue;
    if (out === line) out = structuredClone(line);
    if (layer === 'orig') out.text = next.text; else if (layer === 'tr') out.tr = next.text; else out.bg![layer === 'bgo' ? 'text' : 'tr'] = next.text;
    if (next.sync) (out.sync ||= {})[layer] = next.sync;
    else if (out.sync) delete out.sync[layer];
    if (!next.sync && out.approved) delete out.approved[layer];
  }
  return out;
}
