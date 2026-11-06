import type { Line } from './types.ts';

/** Linking means moving the nested backing to its lead, retaining all word times. Never overwrite a backing. */
export function linkBacking(lines: Line[], from: number, to: number): { lines: Line[]; at: number } | { error: string } {
  const src = lines[from], dst = lines[to];
  if (!src?.bg || !dst || from === to || !dst.text.trim()) return { error: 'Выбери бэк и другую основную фразу.' };
  if ((src.agent || 'v1') !== (dst.agent || 'v1')) return { error: 'У бэка и основы разные исполнители. Оставь бэк самостоятельным или сначала согласуй исполнителя.' };
  if (!src.text.trim() && !src.tr.trim() && src.sec && src.sec !== dst.sec) return { error: 'У бэка своя граница секции. Сначала перенеси её, чтобы привязка не потеряла секцию.' };
  if (dst.bg && (dst.bg.text.trim() || dst.bg.tr.trim())) return { error: 'У этой фразы уже есть бэк. Выбери другую: существующий текст не заменяется.' };
  const out: Line[] = lines.map(l => ({ ...l, sync: l.sync ? { ...l.sync } : undefined }));
  out[to].bg = { ...src.bg }; out[to].sync = { ...out[to].sync, bg: src.sync?.bg?.map(x => ({ ...x })), bgo: src.sync?.bgo?.map(x => ({ ...x })) };
  delete out[from].bg;
  if (out[from].sync) { delete out[from].sync!.bg; delete out[from].sync!.bgo; }
  let at = to;
  if (!src.text.trim() && !src.tr.trim()) { out.splice(from, 1); if (from < to) at--; }
  return { lines: out, at };
}

export function detachBacking(lines: Line[], from: number): { lines: Line[]; at: number } | { error: string } {
  const src = lines[from]; if (!src?.bg || !src.text.trim()) return { error: 'Выбери бэк, связанный с основной строкой.' };
  const times = [...(src.sync?.bgo || []), ...(src.sync?.bg || [])];
  const starts = times.flatMap(x => x.a == null ? [] : [x.a]), ends = times.flatMap(x => x.b == null ? [] : [x.b]);
  const bg: Line = { t: starts.length ? Math.min(...starts) : src.t, end: ends.length ? Math.max(...ends) : src.end, text: '', tr: '', bg: { ...src.bg }, agent: src.agent, sync: { bgo: src.sync?.bgo?.map(x => ({ ...x })), bg: src.sync?.bg?.map(x => ({ ...x })) } };
  const out: Line[] = lines.map(l => ({ ...l, sync: l.sync ? { ...l.sync } : undefined }));
  delete out[from].bg; if (out[from].sync) { delete out[from].sync!.bgo; delete out[from].sync!.bg; }
  out.splice(from + 1, 0, bg); return { lines: out, at: from + 1 };
}
