import { alignRows, lineRow, mergeMarkup, parseRow, remapSync, textDiff } from './edit.ts';
import type { Line } from './types.ts';

export type GeniusMode = 'merge' | 'add' | 'edit';
export interface GeniusChange { kind: 'edit' | 'add' | 'del'; m: number; to: string; from: string; key: string; j: number }

export function geniusChanges(lines: Line[], rows: string[]): GeniusChange[] {
  const old = lines.map(l => lineRow(l, false)), diff = textDiff(old, rows);
  const occurrences = new Map<string, number>();
  return [
    ...diff.edits.map(e => ({ kind: 'edit' as const, m: e.m, to: mergeMarkup(old[e.m], e.row), from: old[e.m], j: 0 })),
    ...diff.adds.map((e, j) => ({ kind: 'add' as const, m: e.after, to: e.row, from: '', j })),
    ...diff.dels.map(m => ({ kind: 'del' as const, m, to: '', from: old[m], j: 0 })),
  ].map(d => {
    const key = `${d.kind}:${lines[d.m]?.t ?? -1}:${d.from}→${d.to}`;
    const n = occurrences.get(key) || 0; occurrences.set(key, n + 1);
    return { ...d, key: `${key}:${n}` };
  })
    .sort((a, b) => a.m - b.m || Number(a.kind === 'add') - Number(b.kind === 'add') || a.j - b.j);
}

export function selectGeniusChanges(changes: GeniusChange[], mode: GeniusMode, removeMissing = false) {
  return changes.filter(d => d.kind === 'del' ? mode === 'merge' && removeMissing
    : mode === 'merge' || (mode === 'add' ? d.kind === 'add' : d.kind === 'edit'));
}

function replaceOriginal(line: Line, row: string) {
  const { main, bg } = parseRow(row);
  const update = (layer: 'orig' | 'bgo', before: string, after: string) => {
    if (before === after) return;
    if (line.approved) { delete line.approved[layer]; if (!Object.keys(line.approved).length) delete line.approved; }
    const sync = remapSync(before, after, line.sync?.[layer]);
    if (sync) { line.sync ||= {}; line.sync[layer] = sync; }
    else if (line.sync) delete line.sync[layer];
  };
  update('orig', line.text, main);
  update('bgo', line.bg?.text || '', bg);
  line.text = main;
  if (bg || line.bg) line.bg = { text: bg, tr: line.bg?.tr || '' };
  if (line.bg && !line.bg.text && !line.bg.tr) delete line.bg;
}

/** Apply the preview's exact row identities: never re-match existing rows after inserting/removing others. */
export function applyGeniusChanges(lines: Line[], changes: GeniusChange[], seed: Line[] = []): Line[] {
  const next = structuredClone(lines);
  for (const d of [...changes].sort((a, b) => b.m - a.m
    || Number(b.kind === 'add') - Number(a.kind === 'add') || b.j - a.j)) {
    if (d.kind === 'edit') replaceOriginal(next[d.m], d.to);
    else if (d.kind === 'del') next.splice(d.m, 1);
    else {
      const line: Line = { t: -1, end: -1, text: '', tr: '' };
      replaceOriginal(line, d.to); next.splice(d.m + 1, 0, line);
    }
  }
  if (!lines.length && seed.length) {
    const map = alignRows(seed.map(l => lineRow(l, false)), next.map(l => lineRow(l, false)));
    map.forEach((m, j) => { if (m >= 0) { next[j].t = seed[m].t; next[j].end = seed[m].end; } });
  }
  for (let j = 0; j < next.length;) {
    if (next[j].t >= 0) { j++; continue; }
    let end = j; while (end < next.length && next[end].t < 0) end++;
    const before = next[j - 1], after = next[end], count = end - j;
    let a = before ? before.end : after ? Math.max(0, after.t - 3.5 * count) : 0;
    let b = after ? after.t : a + 3.5 * count;
    if (b - a < 0.8 * count) { a = before ? (before.t + before.end) / 2 : Math.max(0, b - 0.8 * count); b = Math.max(b, a + 0.8 * count); }
    for (let k = 0; k < count; k++) {
      next[j + k].t = Math.round((a + (b - a) * k / count) * 1000) / 1000;
      next[j + k].end = Math.round((a + (b - a) * (k + 1) / count) * 1000) / 1000;
    }
    j = end;
  }
  return next;
}

export function setGeniusSections(lines: Line[], rows: string[], heads: { row: number; label: string }[]) {
  const map = textDiff(lines.map(l => lineRow(l, false)), rows).rowLine;
  lines.forEach(l => { delete l.sec; });
  heads.forEach((head, j) => {
    const end = heads[j + 1]?.row ?? rows.length;
    for (let r = head.row; r < end; r++) if (map[r] >= 0) { lines[map[r]].sec = head.label; break; }
  });
}
