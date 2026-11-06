// Text from Genius (where Spicy Lyrics makers take lyrics from). Genius has no timings, so its text is laid
// over the lines we have (LRCLIB / LRC / auto-timing) through the «Текст» tab: rows are matched by similarity,
// timings of matched lines stay, translations follow their lines. The server fetches Genius (no CORS there).
import { geniusSongUrl, alignRows, entriesToLines, lineRow, parseLRC, splitHeaders } from './core/index.ts';
import { applyGeniusChanges, geniusChanges, setGeniusSections, type GeniusChange } from './core/geniusImport.ts';
import { doUndo, snap } from './sync.ts';
import { scheduleSave, snapshot } from './persist.ts';
import { drawWave, W } from './waveform/wave.ts';
import { buildPreview } from './preview.ts';
import { S, emit, toast } from './state.ts';
import { fetchSearch } from './load.ts';
import { setPage } from './hotkeys.ts';
import { setMeta } from './metadata.ts';

export interface GeniusHit { id: number; title: string; artist: string; url: string; art: string }
const api = async <T,>(path: string): Promise<T> => {
  const r = await fetch(path, {signal:AbortSignal.timeout(20000)}).catch(() => null);
  if (!r) throw new Error('нет связи с локальным сервером — открой редактор через Spicy Translate.bat или приложение');
  const j = await r.json().catch(() => ({ error: r.status === 404 ? 'сервер старой версии — перезапусти его' : 'HTTP ' + r.status }));
  if (!r.ok || j.error) throw new Error(j.error || 'HTTP ' + r.status);
  return j;
};
const busy = (msg: string) => { S.genius = { ...S.genius!, busy: true, msg, cls: '' }; emit(); };
const done = (msg: string, cls = 'ok') => { S.genius = { ...S.genius!, busy: false, msg, cls }; emit(); };
let pickRequest = 0;

export function geniusQuery() { return S.genius?.q ?? [S.meta.artist, S.meta.title].filter(Boolean).join(' ') ?? ''; }
export async function geniusSearch(q = geniusQuery()) {
  const request = ++pickRequest;
  q = q.trim(); S.genius = { q, hits: S.genius?.hits || [], busy: true, msg: 'Ищу на Genius…', cls: '', ignored: [] }; emit();
  if (!q) return done('Впиши исполнителя и название', 'err');
  const url = geniusSongUrl(q); if (url) return geniusPick({ id:0, title:S.meta.title || 'Песня Genius',artist:S.meta.artist,url,art:'' });
  try {
    const hits = await api<GeniusHit[]>('/api/genius/search?q=' + encodeURIComponent(q));
    if (request !== pickRequest) return;
    S.genius = { ...S.genius!, hits }; done(hits.length ? `Нашлось: ${hits.length}. Выбери песню — текст ляжет на тайминги.` : 'На Genius ничего не нашлось', hits.length ? 'ok' : 'err');
  } catch (e) { if (request !== pickRequest) return; done('Genius: ' + (e as Error).message, 'err'); if (/403|проверк.*браузер/.test((e as Error).message) && (window as any).__TAURI__?.core?.invoke) await openGeniusBrowser(q); }
}

const norm = (x: string) => x.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim();
/**
 * Songwriters and album into the metadata. Button (auto = false): the song picked on Genius, else the first hit for
 * artist + title; overwrites the authors. On load (auto): only a hit whose title and artist match, only empty fields, quietly.
 */
export async function geniusWriters(id = S.genius?.id, title = S.genius?.title, auto = false) {
  if (!auto) toast('Ищу авторов на Genius…', '');
  try {
    if (!id) {
      const q = [S.meta.artist, S.meta.title].filter(Boolean).join(' ').trim(); if (!q) return auto || toast('Впиши исполнителя и название трека', 'err');
      const hits = await api<GeniusHit[]>('/api/genius/search?q=' + encodeURIComponent(q));
      const t = norm(bare(S.meta.title)), ar = norm(S.meta.artist).split(' ');
      const h = auto ? hits.find(x => { const xt = norm(bare(x.title)); return t && (xt === t || xt.startsWith(t + ' ')) && norm(x.artist).split(' ').some(w => w.length > 1 && ar.includes(w)); }) : hits[0];
      if (!h) return auto || toast('На Genius ничего не нашлось', 'err');
      id = h.id; title = `${h.artist} — ${h.title}`;
    }
    const { writers, album = '' } = await api<{ writers: string[]; album?: string }>('/api/genius/writers?id=' + id);
    const w = setMeta('songwriter', writers, auto), al = setMeta('album', [album]);
    if (w || al) { emit(); scheduleSave(); }
    if (auto) { if (w || al) toast(`С Genius: ${[w && 'авторы ' + writers.join(', '), al && 'альбом «' + album + '»'].filter(Boolean).join(', ')}`, 'ok'); return; }
    toast(writers.length ? `Авторы с Genius («${title}»): ${writers.join(', ')}` : `У «${title}» на Genius не указаны авторы`, writers.length ? 'ok' : 'err');
  } catch (e) { if (!auto) toast('Genius: ' + (e as Error).message, 'err'); }
}

/** Genius title without the translated name in brackets: «Буду твоей пальмой! (I'll Be Your Palm!)» */
const bare = (t: string) => t.replace(/\s*[([][^)\]]*[)\]]\s*$/, '').trim() || t;
export async function geniusPick(h: GeniusHit) {
  const request = ++pickRequest;
  busy(`Беру текст «${h.title}»…`);
  let text: string;
  try { text = (await api<{ text: string }>('/api/genius/lyrics?url=' + encodeURIComponent(h.url))).text; }
  catch (e) { if (request === pickRequest) { done('Genius: ' + (e as Error).message, 'err'); if (/403|проверк.*браузер/.test((e as Error).message) && (window as any).__TAURI__?.core?.invoke) await openGeniusBrowser(h.url); } return; }
  if (request !== pickRequest) return;
  const { rows, heads } = splitHeaders(text); text = rows.join('\n'); // [Припев] headers -> sections
  let seed: typeof S.lines = [];
  if (!S.lines.length) { // prepare optional timing references without modifying the project
    busy('Ищу тайминги этой песни в LRCLIB…');
    const synced = (await fetchSearch(`${h.artist} ${bare(h.title)}`).catch(() => [])).filter(d => d.syncedLyrics);
    if (S.hasAudio) synced.sort((a, b) => Math.abs((a.duration || 0) - S.duration) - Math.abs((b.duration || 0) - S.duration));
    if (synced.length) seed = entriesToLines(parseLRC(synced[0].syncedLyrics!), synced[0].duration);
  }
  if (request !== pickRequest) return;
  S.genius = { ...S.genius!, text, heads, seed, title: h.title, id: h.id, ignored: [] };
  const n = geniusDiff().length;
  done(n ? `Сверка с «${h.title}»: отличий ${n}. Выбери режим и проверь изменения перед импортом.` : `Текст совпадает с Genius («${h.title}»). Можно отдельно импортировать секции.`);
}

/** A browser may have access through its own VPN/proxy; pasted lyrics use the same safe preview. */
export function geniusPaste(text: string): boolean {
  const { rows, heads } = splitHeaders(text);
  if (!rows.length) { toast('Вставь текст песни со страницы Genius.', 'err'); return false; }
  pickRequest++;
  S.genius = { q: geniusQuery(), hits: S.genius?.hits || [], busy: false, cls: 'ok',
    text: rows.join('\n'), heads, seed: [], title: 'Текст из браузера', ignored: [],
    msg: 'Текст вставлен для сверки. Проект не изменён — выбери режим и примени нужные отличия.' };
  emit(); return true;
}

/* ---------- line-by-line check of the current text against Genius ---------- */
export type DiffItem = GeniusChange;
/** what differs, word by word: our lines keep their breaks; edit = new words for line m, add = a new line after m, del = line m */
export function geniusDiff(): DiffItem[] {
  const g = S.genius; if (!g?.text) return [];
  return geniusChanges(S.lines, g.text.split('\n')).filter(d => !g.ignored.includes(d.key));
}
let lastImport: { before: string; after: string; full: typeof S.full } | null = null;
export function canUndoGenius() {
  return !!lastImport && JSON.stringify(S.lines) === lastImport.after && S.undo.at(-1) === lastImport.before;
}
export function undoGenius() {
  if (!canUndoGenius()) return;
  doUndo(); S.full = lastImport!.full;
  done('Импорт Genius отменён. Ctrl+Shift+Z — вернуть.');
}
/** Each import is one undo step; untouched rows bypass whole-song rematching entirely. */
export function acceptDiff(items: DiffItem[], sections = false) {
  const g = S.genius; if (!g?.text || (!items.length && !sections)) return;
  if (S.full?.dirty) return toast('Во вкладке «Текст» есть неприменённые правки. Примени или сбрось их перед импортом Genius.', 'err');
  const valid = new Set(geniusDiff().map(d => d.key)); items = items.filter(d => valid.has(d.key));
  const next = applyGeniusChanges(S.lines, items, g.seed);
  if (sections && g.heads?.length) setGeniusSections(next, g.text.split('\n'), g.heads);
  const before = JSON.stringify(S.lines), after = JSON.stringify(next);
  if (before === after) return done('В выбранном режиме изменений нет.');
  snapshot('перед импортом Genius');
  lastImport = { before, after, full: S.full ? structuredClone(S.full) : null };
  snap(); S.lines = next; S.full = null; S.sel = null; S.picked.clear(); W.multi = [];
  S.duration = Math.max(S.duration, ...next.map(l => l.end + 2));
  buildPreview(true); drawWave(); scheduleSave();
  const count = (kind: DiffItem['kind']) => items.filter(d => d.kind === kind).length;
  done(`Импортировано: добавлено ${count('add')}, заменено ${count('edit')}, удалено ${count('del')}. Ctrl+Z — отмена.`);
}
export function ignoreDiff(d: DiffItem) { S.genius = { ...S.genius!, ignored: [...S.genius!.ignored, d.key] }; emit(); }
export function resetIgnored() { if (S.genius) { S.genius.ignored = []; emit(); } }
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

export async function openGeniusBrowser(query = geniusQuery()) {
  const t = (window as any).__TAURI__;
  if (!t?.core?.invoke) return toast('В браузерной версии открой Genius отдельно и вставь текст для сверки.', '');
  try { await t.core.invoke('open_genius',{query:geniusSongUrl(query) || query}); }
  catch(e) { toast('Окно Genius: '+String(e),'err'); }
}
export function receiveGeniusBrowser(payload: unknown) {
  const p = payload as { text?: unknown; url?: unknown; title?: unknown };
  if (!p || typeof p.text !== 'string' || p.text.length > 1_000_000 || typeof p.url !== 'string' || !geniusSongUrl(p.url)) return;
  if (S.editDraft || document.getElementById('previewEdit')) return toast('Сначала сохрани или отмени правку. Затем снова нажми «Взять текст» в окне Genius.','err');
  if (geniusPaste(p.text)) { if (typeof p.title === 'string') S.genius!.title = p.title.slice(0,300); setPage('track'); emit(); }
}
