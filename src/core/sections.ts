// Song sections (verse, chorus…): a label on the first line of each section (Line.sec); a section runs until the
// next label. They come from Genius headers ([Припев]) or TTML (amll:section / itunes:song-part) and go back into TTML.
import type { Line } from './types.ts';

export type SecCategory = 'chorus' | 'pre-chorus' | 'verse' | 'bridge' | 'intro' | 'outro' | 'hook' | 'other';
/** what kind of section a label names (Russian or English) */
export function secCategory(label: string): SecCategory {
  const s = label.toLowerCase();
  if (/пред\s*-?\s*припев|pre-?\s*chorus|бридж перед/.test(s)) return 'pre-chorus';
  if (/припев|chorus|refrain/.test(s)) return 'chorus';
  if (/хук|hook/.test(s)) return 'hook';
  if (/куплет|verse/.test(s)) return 'verse';
  if (/бридж|мост|bridge/.test(s)) return 'bridge';
  if (/интро|вступлен|intro/.test(s)) return 'intro';
  if (/аутро|концовк|outro|кода|coda/.test(s)) return 'outro';
  return 'other';
}

export interface Section { label: string; from: number; to: number; a: number; b: number }
/** sections in line order (lines sorted by start): lines before the first label belong to none */
export function sectionsOf(lines: Line[]): Section[] {
  const out: Section[] = [];
  lines.forEach((l, i) => {
    if (l.sec) out.push({ label: l.sec, from: i, to: i, a: l.t, b: l.end });
    else if (out.length) out[out.length - 1].to = i;
  });
  for (const s of out) for (let i = s.from; i <= s.to; i++) { s.a = Math.min(s.a, lines[i].t); s.b = Math.max(s.b, lines[i].end); }
  return out;
}

/** "[Припев: MORGENSHTERN]" -> "Припев"; not a header -> '' */
export const headerLabel = (row: string) => { const m = row.trim().match(/^\[([^\]]+)\]$/); return m ? m[1].split(':')[0].trim() : ''; };
/** lyrics rows without the section headers, and which row each header starts */
export function splitHeaders(text: string) {
  const rows: string[] = [], heads: { row: number; label: string }[] = [];
  for (const r of text.split('\n')) { const h = headerLabel(r); if (h) heads.push({ row: rows.length, label: h }); else if (r.trim()) rows.push(r); }
  return { rows, heads: heads.filter(h => h.row < rows.length) };
}
