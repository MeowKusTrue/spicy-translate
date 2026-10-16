// Getting lyrics and audio in: LRCLIB search, manual LRC, audio file (+ lyrics auto-pick by file name).
import { entriesToLines, mmss, parseLRC, parsePlain, type Line, type Mode, importLyrics, ttmlMeta } from './core/index.ts';
import { S, emit, status, type LrclibHit } from './state.ts';
import { audio, pause, seekTo } from './audio.ts';
import { buildPreview } from './preview.ts';
import { restoreCover } from './cover.ts';
import { spreadSplits } from './syllables.ts';
import { setMeta, splitArtists } from './metadata.ts';
import { idbGet, idbPut, restoreProject, snapshot, trackKey } from './persist.ts';
import { CH, selectWord } from './sync.ts';
import { W, buildPeaks, drawWave } from './waveform/wave.ts';

export async function fetchSearch(q: string): Promise<LrclibHit[]> {
  const r = await fetch('https://lrclib.net/api/search?q=' + encodeURIComponent(q));
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
export async function search() {
  const q = S.q.trim(); if (!q) return;
  status('st1', 'Ищу…');
  try {
    const data = await fetchSearch(q);
    if (!data.length) { S.results = []; status('st1', 'Ничего не найдено. Попробуй вставить LRC вручную.', 'err'); return; }
    S.results = data;
    status('st1', `Найдено: ${data.length}. Выбери версию с меткой synced.`, 'ok');
  } catch (e) { status('st1', 'Не вышло достучаться до LRCLIB: ' + (e as Error).message, 'err'); }
}
export function loadTrack(d: LrclibHit) {
  S.meta.title = d.trackName; S.meta.artist = d.artistName; S.meta.md = [];
  const synced = !!d.syncedLyrics;
  const entries = synced ? parseLRC(d.syncedLyrics!) : parsePlain(d.plainLyrics || '');
  setLines(entriesToLines(entries, d.duration), d.duration); S.srcDur = d.duration || 0;
  const restored = restoreProject();
  setMeta('musicName', [d.trackName]); setMeta('artists', splitArtists(d.artistName)); // LRCLIB album is user-typed and often junk: album comes from Genius
  import('./genius.ts').then(g => g.geniusWriters(0, '', true));
  status('st1', (synced ? `Загружено строк: ${S.lines.length}` : 'Только plain-текст: тайминги выдуманы, лучше выбери synced-версию.') + (restored ? ' · восстановил твою прошлую работу над треком' : ''), synced ? 'ok' : 'err');
  if (!S.hasAudio) idbGet(trackKey()).then(b => { if (b) { loadAudioFile(b, true); } });
  else if (S.audioBlob) idbPut(trackKey(), S.audioBlob);
}
/** Text from the field or a file: .ttml (with singers, background vocals, word timings), .srt, .lrc or plain text. */
export function loadManual(text: string, fileName = '') {
  const dur = S.hasAudio ? audio.duration || 0 : 0;
  const { lines, kind } = importLyrics(text, fileName, dur);
  if (!lines.length) return status('st1', 'Не нашёл строк в тексте.', 'err');
  setLines(lines, dur);
  const extra = [lines.some(l => l.sync?.orig) && 'разметка слов', lines.some(l => l.agent) && 'исполнители', lines.some(l => l.bg) && 'бэки', lines.some(l => l.sec) && 'секции'].filter(Boolean).join(', ');
  status('st1', `${kind.toUpperCase()}: строк ${S.lines.length}${extra ? ' · ' + extra : ''}${kind === 'text' ? (dur ? ' · без таймингов: строки разложены по треку, точную синхру задай F/G' : ' · без таймингов: по 3.5 с на строку; с аудио разложу по длине трека') : ''}`, kind === 'text' ? 'err' : 'ok');
}
/** keep = the same song edited elsewhere (the agent): undo, layer, selection and playhead stay */
export function setLines(lines: Line[], dur: number, keep = false) {
  if (S.lines.length && !keep) snapshot('перед загрузкой нового текста'); // the replaced project stays in the snapshots
  S.lines = lines; spreadSplits(); S.picked.clear(); S.pickAnchor = -1; // remembered syllable splits come in by themselves
  if (!keep) { S.undo = []; S.redo = []; S.layer = lines.some(l => l.tr && l.tr.trim()) ? 'tr' : 'orig'; }
  else if (S.sel && S.sel.i >= lines.length) S.sel = lines.length ? { i: lines.length - 1, k: 0 } : null;
  S.duration = Math.max(dur || 0, lines.length ? lines[lines.length - 1].end + 2 : 0, S.hasAudio ? audio.duration || 0 : 0);
  buildPreview();
  if (!keep) { seekTo(0); if (lines.length) selectWord(0, 0); }
  emit();
}
export function setMode(m: Mode) {
  S.meta.mode = m;
  S.exp.spread = true; // bilingual always exports word timing
  buildPreview(true); emit(); drawWave();
}

export function guessNames(fname: string) {
  let b = fname.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/^\s*\d{1,3}\s*[-.)]\s*/, '');
  b = b.replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/\s+/g, ' ').trim();
  const m = b.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: '', title: b };
}
export async function loadAudioFile(file: Blob & { name?: string }, fromCache?: boolean) {
  pause();
  const a = audio; if (S.audioUrl) URL.revokeObjectURL(S.audioUrl);
  S.audioUrl = URL.createObjectURL(file); a.src = S.audioUrl; S.hasAudio = true; S.audioBlob = file; a.playbackRate = S.rate; a.volume = S.vol;
  const meta = new Promise<number>(r => { a.onloadedmetadata = () => { S.duration = Math.max(S.duration, a.duration); emit(); r(a.duration); }; setTimeout(() => r(0), 4000); });
  a.onended = pause;
  status('st1', fromCache ? 'Подтянул сохранённое аудио этого трека. Строю волну…' : 'Аудио подключено. Строю волну…', 'ok');
  const dur = await meta;
  restoreCover(true);
  await buildPeaks(file); drawWave();
  if (!S.lines.length && file.name) await autoFromAudio(file.name, dur);
  else if (trackKey()) idbPut(trackKey(), file);
  if (S.lines.length) status('st1', W.peaks ? 'Аудио и волна готовы.' : 'Аудио подключено (без волны).', 'ok');
}
async function autoFromAudio(fname: string, dur: number) {
  const { artist, title } = guessNames(fname); if (!title) return;
  status('st1', `Ищу текст по имени файла: «${(artist + ' ' + title).trim()}»…`);
  try {
    let q = (artist + ' ' + title).trim(), data = await fetchSearch(q);
    if (!data.length && artist) { q = title; data = await fetchSearch(q); }
    S.q = q;
    if (!data.length) { status('st1', 'Аудио есть, но текст по имени файла не нашёл — введи поиск вручную.', 'err'); return; }
    S.results = data;
    const sy = data.filter(d => d.syncedLyrics);
    if (!sy.length) { status('st1', 'Нашёл только текст без таймингов — выбери вариант вручную.', 'err'); return; }
    sy.sort((x, y) => Math.abs((x.duration || 0) - dur) - Math.abs((y.duration || 0) - dur));
    const best = sy[0], close = !dur || Math.abs((best.duration || 0) - dur) <= 3;
    loadTrack(best);
    if (S.audioBlob) idbPut(trackKey(), S.audioBlob);
    status('st1', close ? `Подобрал автоматически: ${best.artistName} — ${best.trackName} (длительность совпала). Если не тот трек — выбери другой в списке.` : `Подобрал ближайший вариант, но длительность отличается (${mmss(best.duration)} против ${mmss(dur)}) — проверь тайминги или выбери другую версию.`, close ? 'ok' : 'err');
  } catch (e) { status('st1', 'Не вышло найти текст: ' + (e as Error).message, 'err'); }
}

/** one door for files with lyrics: TTML (ours / Apple / Spicy / NaeNae — singers, bg, words, sections), LRC, SRT, text, our project */
export async function openLyricsFile(f: File) {
  const t = await f.text();
  if (/\.json$/i.test(f.name)) { try { const { loadProject } = await import('./persist.ts'); loadProject(t); } catch (e) { status('st1', 'Проект не открылся: ' + (e as Error).message, 'err'); } return; }
  if (!/\.(ttml|xml)$/i.test(f.name)) S.manual = t;
  loadManual(t, f.name);
  const md = ttmlMeta(t); if (md.length) S.meta.md = md;
  const g = guessNames(f.name); if (S.lines.length && g.title) { S.meta.title = g.title; if (g.artist) S.meta.artist = g.artist; emit(); } // "Artist - Title (ru).ttml"
}
