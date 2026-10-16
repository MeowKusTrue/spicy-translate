// Song sections (verse, chorus…): a label on the first line of each section (Line.sec); a section runs until the
// next label. They come from Genius headers ([Припев]) or TTML (amll:section / itunes:song-part) and go back into TTML.
import type { Line } from './types.ts';

/** the AMLL / NaeNae TTML tool categories */
export type SecCategory = 'intro' | 'verse' | 'pre-chorus' | 'chorus' | 'post-chorus' | 'refrain' | 'hook' | 'bridge' | 'break' | 'interlude'
  | 'instrumental' | 'solo' | 'spoken' | 'skit' | 'sample' | 'outro' | 'other';
// first match wins, so «пред-припев» / «пост-припев» go before «припев»; a pattern matches from the start of a word
const CATS: [SecCategory, string][] = [
  ['pre-chorus', 'пред\\s*-?\\s*припев|пре\\s*-?\\s*припев|бридж перед|pre\\s*-?\\s*(?:chorus|refrain)'],
  ['post-chorus', 'пост\\s*-?\\s*припев|после припева|post\\s*-?\\s*chorus'],
  ['refrain', 'рефрен|refrain'],
  ['chorus', 'припев|chorus'],
  ['hook', 'хук|hook'],
  ['verse', 'куплет|строф|verse|couplet'],
  ['bridge', 'бридж|мост|bridge'],
  ['break', 'брейк|break'],
  ['interlude', 'интерлюди|проигрыш|interlude'],
  ['instrumental', 'инструментал|instrumental'],
  ['solo', 'соло|solo'],
  ['spoken', 'реч[иь]|разговор|монолог|диалог|spoken|speech'],
  ['skit', 'скит|сценка|skit'],
  ['sample', 'с[еэ]мпл|sample'],
  ['intro', 'интро|вступлен|intro'],
  ['outro', 'аутро|концовк|кода|outro|coda'],
];
const CAT_RE = CATS.map(([c, re]) => [c, new RegExp('(?:^|[^a-zа-яё])(?:' + re + ')', 'i')] as const);
/** what kind of section a label names (Russian or English) */
export function secCategory(label: string): SecCategory {
  const s = label.toLowerCase().replace(/ё/g, 'е');
  return CAT_RE.find(([, re]) => re.test(s))?.[0] ?? 'other';
}

const ORD_WORDS: Record<string, number> = {
  первый: 1, второй: 2, третий: 3, четвертый: 4, пятый: 5, шестой: 6, one: 1, first: 1, two: 2, second: 2, three: 3, third: 3,
  four: 4, fourth: 4, five: 5, fifth: 5, six: 6, sixth: 6,
};
const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
/** which one of its kind: «Куплет 2», «2-й куплет», «Verse II», «Второй куплет» -> 2; «Припев (x2)» is a repeat count, not an ordinal */
export function secOrdinal(label: string): number | undefined {
  const s = label.toLowerCase().replace(/ё/g, 'е').replace(/(?:^|[^a-zа-я])[x×х]\s*\d+|\d+\s*[x×х](?![а-яa-z])/g, ' ');
  const n = s.match(/\d+/); if (n) return +n[0] || undefined;
  for (const w of s.split(/[^a-zа-я]+/)) if (ORD_WORDS[w]) return ORD_WORDS[w];
  const r = s.match(/\s([ivx]+)\s*$/); return r ? ROMAN[r[1]] : undefined;
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
