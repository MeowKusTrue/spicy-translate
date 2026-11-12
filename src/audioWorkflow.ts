import { S, emit, toast } from './state.ts';
import { checkServer } from './live.ts';
import { projectJSON, scheduleSave, snapshot } from './persist.ts';
import { transcriptionDraft } from './core/transcription.ts';
import { setLines } from './load.ts';
import { snap } from './sync.ts';
import { setPage } from './hotkeys.ts';
import { originalAudioKey, persistVoiceAudio } from './audioCache.ts';
import { cacheVoiceAudio } from './audio.ts';
import { buildVoicePeaks, drawWave } from './waveform/wave.ts';
import { session } from './projectSession.ts';
import type { AlignOptions } from './core/autoAlign.ts';
import type { Line } from './core/index.ts';

export type AudioOperation = 'separate' | 'words' | 'transcribe';
async function api(path: string, init?: RequestInit) {
  const response = await fetch(path, init), body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'HTTP ' + response.status);
  return body;
}
function capture() {
  const original = S.audioBlob!, generation = session.generation, title = S.meta.title, artist = S.meta.artist;
  return { original, generation, current: () => S.audioBlob === original && session.generation === generation && S.meta.title === title && S.meta.artist === artist };
}
async function uploadOriginal(original: Blob, sep: AlignOptions['sep']) {
  const key = await originalAudioKey(original);
  const query = new URLSearchParams({ ext: (original as File).name?.split('.').pop() || 'mp3', sep });
  const result = await api('/api/align/audio?' + query, { method: 'POST', body: original });
  if (result.audioKey !== key) throw new Error('Сервер не подтвердил аудио этого трека. Перезапусти сервер и повтори.');
  return { key, vocals: !!result.vocals };
}
async function attachVoice(original: Blob, vocal: Blob, current: () => boolean) {
  if (!current()) return;
  if (!await buildVoicePeaks(vocal) || !current()) throw new Error('Не удалось прочитать выделенный вокал.');
  cacheVoiceAudio(vocal);
  const saved = await persistVoiceAudio(original, vocal);
  if (!current()) return;
  toast(saved ? 'Микс и голос сохранены для этого аудио. «Слушать» переключает звук.' : 'Голос готов, но браузер не сохранил аудиокэш. После закрытия может потребоваться загрузка заново.', saved ? 'ok' : 'err');
}

export async function runAudioWorkflow(operation: AudioOperation, options: AlignOptions, hooks: { openSetup: () => Promise<void>; merge: (lines: Line[], only: number[] | null) => number }) {
  if (S.align || S.setup || S.busyAuto || S.transcriptionReview) return toast('Заверши текущую операцию или проверку распознанного текста.', 'err');
  if (!S.audioBlob) return toast('Сначала подключи исходный аудиофайл.', 'err');
  if (operation === 'words' && !S.lines.length) return toast('Сначала добавь текст или нажми «Распознать текст». Выделить голос можно и без текста.', 'err');
  if (operation === 'transcribe' && S.lines.length) return toast('В треке уже есть текст. Распознавание не перезаписывает существующие строки.', 'err');
  const only = operation === 'words' && S.picked.size ? [...S.picked].sort((a, b) => a - b) : null;
  if (operation === 'words' && options.locateLines && only) return toast('Поиск опор требует всей песни. Сними выделение строк.', 'err');
  const source = capture(), sourceLines = S.lines, sourceProject = projectJSON();
  S.align = { stage: 'start', done: 0, total: 0, device: '' }; emit();
  try {
    if (!await checkServer() || !source.current()) return;
    const state = await api('/api/align?sep=' + options.sep);
    if (!source.current()) return;
    if (!state.available) { S.align = null; emit(); await hooks.openSetup(); return; }
    const uploaded = await uploadOriginal(source.original, options.sep);
    if (!source.current()) return;
    if (operation !== 'separate' && !uploaded.vocals) throw new Error('Сначала нажми «Выделить голос» или загрузи вокал из RX. Обработка текста сама не запускает разделение.');
    if (operation === 'words') await snapshot('перед расстановкой слов');
    if (!source.current() || operation === 'words' && S.lines !== sourceLines) return;
    if (operation === 'transcribe' && (S.lines.length || projectJSON() !== sourceProject)) throw new Error('Проект изменился; распознавание не запущено.');
    const project = JSON.parse(projectJSON());
    const body = JSON.stringify(only ? { ...project, lines: only.map(i => project.lines[i]) } : project);
    const query = new URLSearchParams({ operation, audioKey: uploaded.key, sep: options.sep, asr: options.asr, aligner: options.aligner, locateLines: operation === 'words' && options.locateLines ? '1' : '0', detectBack: '0', lang: S.meta.lang });
    const started = await api('/api/align?' + query, { method: 'POST', body });
    for (;;) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const result = await api('/api/align?sep=' + options.sep);
      if (!source.current()) return;
      if (started.runId && result.runId !== started.runId) throw new Error('Другой запуск заменил результат на сервере. Чужие тайминги не применены.');
      if (result.audioKey && result.audioKey !== uploaded.key) throw new Error('Сервер переключился на другое аудио; результат не применён.');
      if (result.running) { S.align = { stage: result.stage || 'start', done: result.done || 0, total: result.total || 0, device: result.device || '', plan: result.plan, sub: result.sub, subDone: result.subDone, subTotal: result.subTotal, bytes: result.bytes, elapsed: result.elapsed }; emit(); continue; }
      if (result.error) throw new Error(result.error);
      let draft: Line[] | null = null;
      if (operation === 'transcribe') {
        if (S.lines.length || projectJSON() !== sourceProject) throw new Error('Проект изменился во время распознавания. Текст не заменён.');
        draft = transcriptionDraft(result.result?.lines);
      }
      if (operation === 'words') {
        if (S.lines !== sourceLines || !result.result?.lines) throw new Error('Текст проекта изменился или сервер не вернул тайминги.');
        const count = hooks.merge(result.result.lines as Line[], only);
        toast(`Расставлены слова в строках: ${count}. Только исходный текст и уже введённые бэки. Это черновик; Ctrl+Z — отмена.`, 'ok');
        for (const warning of result.result.warnings || []) toast(warning, 'err');
      }
      if (result.vocals) {
        if (operation === 'separate' && result.vocalSource === 'htdemucs' && options.sep === 'roformer') toast('RoFormer не применён: доступен сохранённый вокал HTDemucs. Это другой разделитель.', 'err');
        const response = await fetch('/api/align/vocals?' + new URLSearchParams({ audioKey: uploaded.key, sep: options.sep }));
        if (!response.ok) throw new Error('Не удалось получить вокал: HTTP ' + response.status);
        const vocal = await response.blob();
        if (source.current()) await attachVoice(source.original, vocal, source.current);
      } else if (operation === 'separate') throw new Error('Сервер завершил выделение, но не вернул вокал.');
      if (draft) {
        if (!source.current() || S.lines.length || projectJSON() !== sourceProject) throw new Error('Проект изменился. Черновик не применён.');
        S.transcriptionReview = { lines: draft, audio: source.original, generation: source.generation, project: sourceProject }; emit();
      }
      break;
    }
  } catch (error) { if (source.current()) toast((operation === 'separate' ? 'Выделение голоса: ' : operation === 'transcribe' ? 'Распознавание текста: ' : 'Расстановка слов: ') + (error as Error).message, 'err'); }
  finally { S.align = null; emit(); drawWave(); }
}

export function canApplyTranscription() {
  const draft = S.transcriptionReview;
  return !!draft && !S.align && !S.busyAuto && !S.editDraft && !S.lines.length && S.audioBlob === draft.audio && session.generation === draft.generation && projectJSON() === draft.project;
}
export function closeTranscription() { S.transcriptionReview = null; emit(); }
export async function applyTranscription() {
  const draft = S.transcriptionReview;
  if (!draft || !canApplyTranscription()) return toast('Трек изменился. Распознанный текст не применён.', 'err');
  await snapshot('перед применением распознанного текста');
  if (S.transcriptionReview !== draft || !canApplyTranscription()) return toast('Трек изменился. Распознанный текст не применён.', 'err');
  snap(); S.transcriptionReview = null;
  setLines(structuredClone(draft.lines), S.duration, true);
  if (S.lines.length) S.sel = { i: 0, k: 0 };
  scheduleSave(); setPage('sync'); emit();
  toast('Распознанный черновик добавлен. Проверь слова и времена на слух. Ctrl+Z — отмена.', 'ok');
}

export async function importVocalFile(file: File, sep: AlignOptions['sep']) {
  if (S.align || S.setup || S.busyAuto || S.transcriptionReview) return toast('Заверши текущую операцию или проверку распознанного текста.', 'err');
  if (!S.audioBlob) return toast('Сначала загрузи исходный микс, затем вокал той же длительности.', 'err');
  const source = capture(); S.align = { stage: 'import', done: 0, total: 0, device: '' }; emit();
  try {
    if (!await checkServer() || !source.current()) return;
    const { key } = await uploadOriginal(source.original, sep);
    if (!source.current()) return;
    await api('/api/align/vocals?audioKey=' + key, { method: 'POST', body: file });
    if (!source.current()) return;
    // Play and cache exactly the validated WAV used by the server's word aligner.
    const response = await fetch('/api/align/vocals?' + new URLSearchParams({ audioKey: key, sep }));
    if (!response.ok) throw new Error('Сервер сохранил вокал, но загрузка WAV не удалась: HTTP ' + response.status);
    const vocal = await response.blob();
    if (source.current()) await attachVoice(source.original, vocal, source.current);
  } catch (error) { if (source.current()) toast('Вокал не подключён: ' + (error as Error).message, 'err'); }
  finally { S.align = null; emit(); drawWave(); }
}
