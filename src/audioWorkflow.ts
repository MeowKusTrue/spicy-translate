import { S, emit, toast } from './state.ts';
import { checkServer } from './live.ts';
import { projectJSON, scheduleSave, snapshot } from './persist.ts';
import { transcriptionDraft } from './core/transcription.ts';
import { setLines } from './load.ts';
import { snap } from './sync.ts';
import { setPage } from './hotkeys.ts';
import { originalAudioKey, persistVoiceAudio } from './audioCache.ts';
import { cacheVoiceAudio } from './audio.ts';
import { buildVoicePeaks, drawWave, W } from './waveform/wave.ts';
import { session } from './projectSession.ts';
import { alignmentSelection, prepareWordAlignment, wordAlignmentScope, type AlignOptions } from './core/autoAlign.ts';
import type { Line } from './core/index.ts';

export type AudioOperation = 'separate' | 'words' | 'transcribe';
let workflow: { cancelled: boolean } | null = null;
export function cancelAudioWorkflow() {
  if (workflow) workflow.cancelled = true;
  if (S.align) { S.align.cancelled = true; emit(); }
}
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

export async function runAudioWorkflow(operation: AudioOperation, options: AlignOptions, hooks: { openSetup: () => Promise<void>; merge: (lines: Line[], only: number[] | null, before: Line[], replace: boolean) => number }) {
  if (S.align || S.setup || S.busyAuto || S.transcriptionReview) return toast('Заверши текущую операцию или проверку распознанного текста.', 'err');
  if (!S.audioBlob) return toast('Сначала подключи исходный аудиофайл.', 'err');
  if (operation === 'words' && !S.lines.length) return toast('Сначала добавь текст или нажми «Получить текст». Выделить голос можно и без текста.', 'err');
  if (operation === 'transcribe' && S.lines.length) return toast('В треке уже есть текст. Получение текста не перезаписывает существующие строки.', 'err');
  const only = operation === 'words' ? alignmentSelection(S.picked, W.multi, S.lines.length) : null;
  const source = capture(), sourceLines = S.lines, sourceProject = projectJSON(), begun = Date.now();
  if (operation === 'words' && only && options.locateLines) {
    const useWindows = await confirm(`Выделено строк: ${only.length}. Поиск опор через распознавание рассчитан на всю песню и может пропускать повторы.\nРасставить только выделенные строки внутри их текущих временных границ, без поиска опор?\nЕсли времена самих строк неверны, нажми «Отмена» и сначала поправь их либо запусти поиск по всей песне.`);
    if (!useWindows || !source.current() || projectJSON() !== sourceProject || S.align || S.setup || S.busyAuto) return;
    options = { ...options, locateLines: false };
  }
  const before = structuredClone(S.lines);
  let replace = false;
  if (operation === 'words') {
    const scope = wordAlignmentScope(only ? only.map(i => before[i]) : before);
    if (!scope.pending && scope.protectedLayers) {
      replace = await confirm(`Все исходные строки уже размечены или защищены (${scope.protectedLayers} дорожек). Поэтому обычная расстановка их пропускает.\nРасставить их заново, заменив прежние тайминги? Перевод не меняется. Перед запуском будет снимок; после применения доступна Ctrl+Z.`);
      if (!replace || !source.current() || projectJSON() !== sourceProject || S.align || S.busyAuto) return;
    } else if (!scope.pending) return toast('Нет исходного текста или бэков для расстановки. Добавь оригинал: перевод автоматически не размечается.', 'err');
  }
  const token = { cancelled: false }; workflow = token;
  const active = () => source.current() && !token.cancelled;
  let plan = operation === 'transcribe' ? ['upload', 'demucs', 'transcribe', 'align', 'cache'] : operation === 'separate' ? ['upload', 'demucs', 'cache'] : ['upload', ...(options.locateLines ? ['locate'] : []), 'align', 'cache'];
  const stage = (name: string) => { S.align = { stage: name, phase: name, done: 0, total: 0, device: '', plan, elapsed: Date.now() - begun }; emit(); };
  stage('check');
  try {
    if (!await checkServer() || !active()) return;
    const state = await api('/api/align?sep=' + options.sep);
    if (!active()) return;
    if (!state.available) { S.align = null; emit(); await hooks.openSetup(); return; }
    stage('upload');
    const uploaded = await uploadOriginal(source.original, options.sep);
    if (!active()) return;
    if (operation === 'words' && !uploaded.vocals) throw new Error('Сначала нажми «Выделить голос» или загрузи вокал из RX. Расстановка слов сама не запускает разделение.');
    if (operation === 'transcribe' && uploaded.vocals) plan = ['upload', 'transcribe', 'align', 'cache'];
    if (operation === 'words') await snapshot('перед расстановкой слов');
    if (!active() || operation === 'words' && S.lines !== sourceLines) return;
    const project = JSON.parse(projectJSON());
    if (operation === 'words') project.lines = prepareWordAlignment(before, replace);
    const body = JSON.stringify(only ? { ...project, lines: only.map(i => project.lines[i]) } : project);
    async function execute(step: AudioOperation) {
      if (!active()) return null;
      if (operation === 'transcribe' && (S.lines.length || projectJSON() !== sourceProject)) throw new Error('Проект изменился; получение текста остановлено.');
      stage(step === 'separate' ? 'demucs' : step === 'transcribe' ? 'transcribe' : options.locateLines ? 'locate' : 'align');
      const query = new URLSearchParams({ operation: step, audioKey: uploaded.key, sep: options.sep, asr: options.asr, aligner: options.aligner, locateLines: step === 'words' && options.locateLines ? '1' : '0', detectBack: '0', lang: S.meta.lang });
      const started = await api('/api/align?' + query, { method: 'POST', body });
      try {
        for (;;) {
          if (!active()) return null;
          await new Promise(resolve => setTimeout(resolve, 1000));
          if (!active()) return null;
          const result = await api('/api/align?sep=' + options.sep);
          if (!active()) return null;
          if (started.runId && result.runId !== started.runId) throw new Error('Другой запуск заменил результат на сервере. Чужие данные не применены.');
          if (result.audioKey && result.audioKey !== uploaded.key) throw new Error('Сервер переключился на другое аудио; результат не применён.');
          if (result.running) {
            S.align = { stage: result.stage || 'start', phase: step === 'separate' ? 'demucs' : step === 'transcribe' ? 'transcribe' : options.locateLines ? 'locate' : 'align', done: result.done || 0, total: result.total || 0, device: result.device || '', plan, sub: result.sub, subDone: result.subDone, subTotal: result.subTotal, bytes: result.bytes, elapsed: Date.now() - begun }; emit(); continue;
          }
          if (result.error) throw new Error(result.error);
          return result;
        }
      } finally {
        // Cancellation can arrive while POST is starting. Stop that owned job once its id is known.
        if (token.cancelled && started.runId) {
          try { const owner = await api('/api/align?sep=' + options.sep); if (owner.running && owner.runId === started.runId) await api('/api/align', { method: 'DELETE' }); } catch { /* The visible cancel action reports server errors. */ }
        }
      }
    }
    if (operation === 'transcribe' && !uploaded.vocals) {
      const separated = await execute('separate');
      if (!separated || !active()) return;
      if (!separated.vocals) throw new Error('Выделение закончилось без вокала. Распознавание не запущено.');
      if (separated.vocalSource === 'htdemucs' && options.sep === 'roformer') toast('RoFormer не применён: используется вокал HTDemucs.', 'err');
    }
    const result = await execute(operation);
    if (!result || !active()) return;
    let draft: Line[] | null = null, wordSummary = '', wordCount = 0;
    if (operation === 'transcribe') {
      if (S.lines.length || projectJSON() !== sourceProject) throw new Error('Проект изменился во время обработки. Текст не заменён.');
      draft = transcriptionDraft(result.result?.lines);
    }
    if (operation === 'words') {
      if (S.lines !== sourceLines || !result.result?.lines) throw new Error('Текст проекта изменился или сервер не вернул тайминги.');
      const count = hooks.merge(result.result.lines as Line[], only, before, replace);
      const scope = wordAlignmentScope(only ? only.map(i => before[i]) : before);
      wordSummary = count ? `Расставлены слова в строках: ${count}. Это черновик; Ctrl+Z — отмена.${!replace && scope.protectedLayers ? ` Защищённых дорожек пропущено: ${scope.protectedLayers}.` : ''}` : 'Ни одна строка не обновлена: результат совпадает с прежним, текст изменился или модель не нашла новые времена. Проверь защиту строк и режим «Сначала найти строки по аудио».';
      wordCount = count;
    }
    if (result.vocals) {
      if (operation === 'separate' && result.vocalSource === 'htdemucs' && options.sep === 'roformer') toast('RoFormer не применён: доступен сохранённый вокал HTDemucs. Это другой разделитель.', 'err');
      stage('cache');
      const response = await fetch('/api/align/vocals?' + new URLSearchParams({ audioKey: uploaded.key, sep: options.sep }));
      if (!response.ok) throw new Error('Не удалось получить вокал: HTTP ' + response.status);
      const vocal = await response.blob();
      if (active()) await attachVoice(source.original, vocal, active);
    } else if (operation === 'separate') throw new Error('Сервер завершил выделение, но не вернул вокал.');
    if (wordSummary && active()) {
      const warnings: string[] = result.result.warnings || [];
      if (only) wordSummary += ` Область: только выделенные строки (${only.map(i => i + 1).join(', ')}), текущие времена строк.`;
      toast(wordSummary + (warnings.length ? ' ' + warnings.join(' ') : ''), wordCount && !warnings.length ? 'ok' : 'err');
    }
    if (draft && active()) {
      if (S.lines.length || projectJSON() !== sourceProject) throw new Error('Проект изменился. Черновик не применён.');
      S.transcriptionReview = { lines: draft, audio: source.original, generation: source.generation, project: sourceProject }; emit();
    }
  } catch (error) { if (active()) toast((operation === 'separate' ? 'Выделение голоса: ' : operation === 'transcribe' ? 'Получение текста: ' : 'Расстановка слов: ') + (error as Error).message, 'err'); }
  finally {
    if (workflow === token) workflow = null;
    S.align = null; emit(); drawWave();
    if (token.cancelled && source.current()) toast('Обработка отменена.');
  }
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
