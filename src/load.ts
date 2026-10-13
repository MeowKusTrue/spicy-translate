// Getting lyrics and audio in: LRCLIB search, manual LRC, audio file (+ lyrics auto-pick by file name).
import { entriesToLines, mmss, parseLRC, parsePlain, type Line, type Mode } from './core/index.ts';
import { S, emit, status, type LrclibHit } from './state.ts';
import { audio, pause, seekTo } from './audio.ts';
import { buildPreview } from './preview.ts';
import { idbGet, idbPut, restoreProject, trackKey } from './persist.ts';
import { selectWord } from './sync.ts';
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
  S.meta.title = d.trackName; S.meta.artist = d.artistName;
  const synced = !!d.syncedLyrics;
  const entries = synced ? parseLRC(d.syncedLyrics!) : parsePlain(d.plainLyrics || '');
  setLines(entriesToLines(entries, d.duration), d.duration);
  const restored = restoreProject();
  status('st1', (synced ? `Загружено строк: ${S.lines.length}` : 'Только plain-текст: тайминги выдуманы, лучше выбери synced-версию.') + (restored ? ' · восстановил твою прошлую работу над треком' : ''), synced ? 'ok' : 'err');
  if (!S.hasAudio) idbGet(trackKey()).then(b => { if (b) { loadAudioFile(b, true); } });
  else if (S.audioBlob) idbPut(trackKey(), S.audioBlob);
}
export function loadManual(text: string) {
  const e = parseLRC(text), synced = e.length > 0;
  setLines(entriesToLines(synced ? e : parsePlain(text), 0), 0);
  status('st1', synced ? `Строк: ${S.lines.length}` : 'Меток времени нет — тайминги выдуманы (по 3.5 с на строку).', synced ? 'ok' : 'err');
}
export function setLines(lines: Line[], dur: number) {
  S.lines = lines; S.undo = []; S.redo = []; S.sel = null;
  S.layer = lines.some(l => l.tr && l.tr.trim()) ? 'tr' : 'orig';
  S.duration = Math.max(dur || 0, lines.length ? lines[lines.length - 1].end + 2 : 0, S.hasAudio ? audio.duration || 0 : 0);
  buildPreview(); seekTo(0);
  if (lines.length) selectWord(0, 0);
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
