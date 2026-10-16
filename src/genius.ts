// Text from Genius (where Spicy Lyrics makers take lyrics from). Genius has no timings, so its text is laid
// over the lines we have (LRCLIB / LRC / auto-timing) through the «Текст» tab: rows are matched by similarity,
// timings of matched lines stay, translations follow their lines. The server fetches Genius (no CORS there).
import { alignRows, lineRow, splitHeaders, textDiff } from './core/index.ts';
import { snap } from './sync.ts';
import { scheduleSave } from './persist.ts';
import { drawWave } from './waveform/wave.ts';
import { S, emit, toast } from './state.ts';
import { fetchSearch, loadManual, loadTrack } from './load.ts';
import { setPage } from './hotkeys.ts';
import { applyFull } from './lineEdit.ts';

export interface GeniusHit { id: number; title: string; artist: string; url: string; art: string }
const api = async <T,>(path: string): Promise<T> => {
  const r = await fetch(path).catch(() => null);
  if (!r) throw new Error('нет связи с локальным сервером — открой редактор через Spicy Translate.bat или приложение');
  const j = await r.json().catch(() => ({ error: r.status === 404 ? 'сервер старой версии — перезапусти его' : 'HTTP ' + r.status }));
  if (!r.ok || j.error) throw new Error(j.error || 'HTTP ' + r.status);
  return j;
};
const busy = (msg: string) => { S.genius = { ...S.genius!, busy: true, msg, cls: '' }; emit(); };
const done = (msg: string, cls = 'ok') => { S.genius = { ...S.genius!, busy: false, msg, cls }; emit(); };

export function geniusQuery() { return S.genius?.q ?? [S.meta.artist, S.meta.title].filter(Boolean).join(' ') ?? ''; }
export async function geniusSearch(q = geniusQuery()) {
  q = q.trim(); S.genius = { q, hits: S.genius?.hits || [], busy: true, msg: 'Ищу на Genius…', cls: '', ignored: [] }; emit();
  if (!q) return done('Впиши исполнителя и название', 'err');
  try {
    const hits = await api<GeniusHit[]>('/api/genius/search?q=' + encodeURIComponent(q));
    S.genius = { ...S.genius!, hits }; done(hits.length ? `Нашлось: ${hits.length}. Выбери песню — текст ляжет на тайминги.` : 'На Genius ничего не нашлось', hits.length ? 'ok' : 'err');
  } catch (e) { done('Genius: ' + (e as Error).message, 'err'); }
}

/** songwriters into the metadata («Автор песни»): of the song picked on Genius, else the first search hit for artist + title */
export async function geniusWriters(id = S.genius?.id, title = S.genius?.title) {
  toast('Ищу авторов на Genius…', '');
  try {
    if (!id) {
      const q = [S.meta.artist, S.meta.title].filter(Boolean).join(' ').trim(); if (!q) return toast('Впиши исполнителя и название трека', 'err');
      const h = (await api<GeniusHit[]>('/api/genius/search?q=' + encodeURIComponent(q)))[0]; if (!h) return toast('На Genius ничего не нашлось', 'err');
      id = h.id; title = `${h.artist} — ${h.title}`;
    }
    const { writers } = await api<{ writers: string[] }>('/api/genius/writers?id=' + id);
    if (!writers.length) return toast(`У «${title}» на Genius не указаны авторы`, 'err');
    const e = S.meta.md.find(m => m.key === 'songwriter');
    if (e) e.value = writers; else S.meta.md.push({ key: 'songwriter', value: writers });
    emit(); scheduleSave(); toast(`Авторы с Genius («${title}»): ${writers.join(', ')}`, 'ok');
  } catch (e) { toast('Genius: ' + (e as Error).message, 'err'); }
}

/** Genius title without the translated name in brackets: «Буду твоей пальмой! (I'll Be Your Palm!)» */
const bare = (t: string) => t.replace(/\s*[([][^)\]]*[)\]]\s*$/, '').trim() || t;
export async function geniusPick(h: GeniusHit) {
  busy(`Беру текст «${h.title}»…`);
  let text: string;
  try { text = (await api<{ text: string }>('/api/genius/lyrics?url=' + encodeURIComponent(h.url))).text; }
  catch (e) { return done('Genius: ' + (e as Error).message, 'err'); }
  const { rows, heads } = splitHeaders(text); text = rows.join('\n'); // [Припев] headers -> sections
  if (!S.lines.length) { // nothing to lay the text on yet: timings from LRCLIB, else the text spread evenly
    busy('Ищу тайминги этой песни в LRCLIB…');
    const synced = (await fetchSearch(`${h.artist} ${bare(h.title)}`).catch(() => [])).filter(d => d.syncedLyrics);
    if (S.hasAudio) synced.sort((a, b) => Math.abs((a.duration || 0) - S.duration) - Math.abs((b.duration || 0) - S.duration));
    if (synced.length) loadTrack(synced[0]);
    else {
      loadManual(text); S.meta.title = bare(h.title); S.meta.artist = h.artist;
      return done('Тайминги в LRCLIB не нашлись: текст Genius разложен по времени ровно. Подгони строки на волне или запусти ✨ Авто-тайминг.', 'err');
    }
  }
  S.genius = { ...S.genius!, text, heads, title: h.title, id: h.id, ignored: [] };
  if (!S.meta.md.some(m => m.key === 'songwriter' && m.value.some(v => v.trim()))) geniusWriters(h.id, h.title);
  if (heads.length) snap();
  const ns = applySections(), n = geniusDiff().length, sec = ns ? ` Секции с Genius: ${ns} — цветные блоки над волной.` : '';
  done((n ? `Сверка с «${h.title}»: отличий ${n}. Принимай по строке (✓) или все сразу — разметка совпавших слов сохранится.` : `Текст совпадает с Genius («${h.title}») — править нечего.`) + sec);
}
/** Genius section headers onto our lines (the line where the header's first row starts); returns how many */
export function applySections() {
  const g = S.genius; if (!g?.text || !g.heads?.length) return 0;
  const rows = g.text.split('\n'), map = textDiff(S.lines.map(l => lineRow(l, false)), rows).rowLine;
  S.lines.forEach(l => { delete l.sec; });
  let n = 0;
  g.heads.forEach((h, x) => {
    const end = x + 1 < g.heads!.length ? g.heads![x + 1].row : rows.length;
    for (let r = h.row; r < end; r++) if (map[r] >= 0) { const l = S.lines[map[r]]; if (!l.sec) { l.sec = h.label; n++; } break; }
  });
  emit(); drawWave(); scheduleSave();
  return n;
}

/* ---------- line-by-line check of the current text against Genius ---------- */
export interface DiffItem { kind: 'edit' | 'add' | 'del'; m: number; to: string; from: string; key: string; j: number }
/** what differs, word by word: our lines keep their breaks; edit = new words for line m, add = a new line after m, del = line m */
export function geniusDiff(): DiffItem[] {
  const g = S.genius; if (!g?.text) return [];
  const old = S.lines.map(l => lineRow(l, false)), d = textDiff(old, g.text.split('\n')), out: DiffItem[] = [];
  d.edits.forEach(e => out.push({ kind: 'edit', m: e.m, to: e.row, from: old[e.m], key: 'edit:' + old[e.m] + '→' + e.row, j: 0 }));
  d.adds.forEach((e, j) => out.push({ kind: 'add', m: e.after, to: e.row, from: '', key: 'add:' + e.row, j }));
  d.dels.forEach(m => out.push({ kind: 'del', m, to: '', from: old[m], key: 'del:' + old[m], j: 0 }));
  return out.filter(x => !g.ignored.includes(x.key)).sort((a, b) => a.m - b.m || (a.kind === 'add' ? 1 : -1) || a.j - b.j);
}
/** apply some differences through the «Текст» machinery (timings of unchanged words, translations, bg stay) */
export function acceptDiff(items: DiffItem[]) {
  if (!items.length) return;
  const o = S.lines.map(l => lineRow(l, false)), t = S.lines.map(l => lineRow(l, true));
  // bottom-up so earlier indexes stay valid; additions after a line go in before it changes, last first
  for (const d of [...items].sort((a, b) => b.m - a.m || (a.kind === 'add' ? -1 : 1) || b.j - a.j)) {
    if (d.kind === 'edit') o[d.m] = d.to;
    else if (d.kind === 'add') { o.splice(d.m + 1, 0, d.to); t.splice(d.m + 1, 0, ''); }
    else { o.splice(d.m, 1); t.splice(d.m, 1); }
  }
  S.full = { o: o.join('\n'), t: t.some(Boolean) ? t.join('\n') : '', dirty: true };
  applyFull(); applySections();
  const left = geniusDiff().length; S.genius = { ...S.genius!, msg: left ? `Осталось отличий: ${left}` : 'Текст совпадает с Genius ✓', cls: 'ok' }; emit();
}
export function ignoreDiff(d: DiffItem) { S.genius = { ...S.genius!, ignored: [...S.genius!.ignored, d.key] }; emit(); }
/** the whole Genius text into the «Текст» tab, to edit by hand */
export function geniusToText() { if (S.genius?.text) layOver(S.genius.text); }
/** Genius rows into the «Текст» draft; each row brings the translation of the line it matched */
function layOver(text: string) {
  const rows = text.split('\n'), map = alignRows(S.lines.map(l => lineRow(l, false)), rows);
  const tr = map.map(m => m >= 0 ? lineRow(S.lines[m], true) : '');
  S.full = { o: rows.join('\n'), t: tr.some(Boolean) ? tr.join('\n') : '', dirty: true };
  const kept = map.filter(m => m >= 0).length;
  setPage('text');
  toast(`Genius: строк ${rows.length}, совпало с текущими ${kept} — их тайминги и перевод сохранятся. «Применить» — Ctrl+Enter.`, 'ok');
}
