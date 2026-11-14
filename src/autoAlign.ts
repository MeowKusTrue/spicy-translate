// «Авто-тайминг»: the local server runs the experiments/auto-align prototype (Demucs + wav2vec2) on the track's audio;
// word timings come back flagged auto (dashed), hand-marked words are never touched. Also brings the separated voice.
import { mergeWordAlignment } from './core/index.ts';
import { audioProgressPercent, audioStageFraction } from './core/audioProgress.ts';
import { S, emit, ls, toast } from './state.ts';
import { alignOptions, type AlignOptions } from './core/autoAlign.ts';
import { checkServer } from './live.ts';
import { scheduleSave } from './persist.ts';
import { afterSyncChange, snap } from './sync.ts';

import type { Line } from './core/index.ts';
import { cancelAudioWorkflow, importVocalFile, runAudioWorkflow, type AudioOperation } from './audioWorkflow.ts';

export let modelOptions: AlignOptions = (() => { try { return { ...alignOptions(JSON.parse(ls.get('alignModels', '{}')!) || {}), detectBack: false }; } catch { return alignOptions(); } })();
export function setModelOptions(value: Partial<AlignOptions>) { modelOptions = { ...alignOptions({ ...modelOptions, ...value }), detectBack: false }; ls.set('alignModels', JSON.stringify(modelOptions)); emit(); }
export const STAGES: Record<string, string> = { check: 'проверяю сервер и кэш', upload: 'подключаю исходное аудио', cache: 'сохраняю аудио и готовлю результат', start: 'запуск', import: 'подключаю вокал', device: 'загружаю модели', demucs: 'выделяю голос', karaoke: 'делю голос и бэк', transcribe: 'распознаю текст', locate: 'ищу строки по аудио', backing: 'распознаю бэки', align: 'подгоняю слова' };
export const stageFrac = (state = S.align) => audioStageFraction(state);
export const alignLabel = () => { const a = S.align; if (!a) return ''; const f = stageFrac(); return `${STAGES[a.stage] || a.stage}${a.stage === 'align' && a.total ? ` ${a.done}/${a.total}` : f ? ` ${Math.round(f * 100)}%` : '…'}`; };
/** overall progress of a run, 0..100, by the stages it will go through (plan from align.py) */
export const alignPct = () => audioProgressPercent(S.align);
/** «ещё ~1:20» from the time so far (once there is something to go by) */
export function alignEta() {
  const a = S.align, p = alignPct(); if (!a?.elapsed || p < 8 || p >= 99) return '';
  const s = Math.round(a.elapsed / 1000 * (100 - p) / p); return s < 60 ? `~${s} с` : `~${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
export async function cancelAlign() { if (S.align?.stage === 'import') return toast('Проверка загруженного вокала уже идёт. Дождись завершения; исходный микс не меняется.'); cancelAudioWorkflow(); try { await api('/api/align', { method: 'DELETE' }); toast('Авто-тайминг: отменяю…'); } catch (e) { toast('Не вышло отменить: ' + (e as Error).message, 'err'); } }
export const DEVICES: Record<string, string> = { cuda: 'видеокарта NVIDIA', xpu: 'видеокарта Intel', dml: 'видеокарта (DirectML)', cpu: 'процессор' };

async function api(path: string, init?: RequestInit) { const r = await fetch(path, init); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status); return j; }
export function autoAlign(operation: AudioOperation = 'words') {
  return runAudioWorkflow(operation, { ...modelOptions, detectBack: false }, { openSetup: openAlignPanel, merge });
}
export function importVocals(file: File) { return importVocalFile(file, modelOptions.sep); }
/** Legacy review state cannot insert newly recognized backing phrases. */
export function acceptBacking() { S.backingReview = null; emit(); toast('Используются только бэки, уже введённые внутри строк.'); }
/** take auto timings for lines whose texts still match; anything marked by hand here stays as it is */
function merge(res: Line[], only: number[] | null, before: Line[], replace = false) {
  const changes = S.lines.flatMap((line, i) => {
    const result = res[only ? only.indexOf(i) : i];
    if (!result || !before[i]) return [];
    const next = mergeWordAlignment(line, result, before[i], replace);
    return next ? [{ i, next }] : [];
  });
  if (!changes.length) return 0;
  snap(); for (const { i, next } of changes) S.lines[i] = next;
  afterSyncChange(true); scheduleSave(); return changes.length;
}

/* ---------- the «Авто-тайминг» panel: GPU found, which PyTorch build, install with progress, cancel, remove ---------- */
export type Gpu = { names: string[]; backend: string; why: string; cu?: string; memoryTotal?: number; memoryFree?: number };
export type SetupState = { running: boolean; step: string; pct: number; error: string; installed: boolean; backend: string; file: string; got: number; size: number; last: string; bytes?: number; dir: string; external: boolean };
let polling = false;
async function refresh(withSize = false) {
  const p = S.alignPanel; if (!p) return;
  p.st = await api('/api/align/setup' + (withSize ? '?size=1' : '')); emit();
}
export async function openAlignPanel() {
  S.alignPanel = { gpu: null, st: null, pick: 'auto', err: '' }; emit();
  const fail = (m: string) => { if (S.alignPanel) { S.alignPanel.err = m; emit(); } };
  try { await refresh(); }
  catch { return fail(await checkServer().catch(() => false)
    ? 'Сервер не ответил на запрос установки — попробуй ещё раз.'
    : 'Сервер старой версии или недоступен. Перезапусти его: в Claude Code /mcp → spicy-translate → Reconnect (или закрой Claude Code), либо открой редактор приложением / батником.'); }
  api('/api/align/gpu').then(g => { if (S.alignPanel) { S.alignPanel.gpu = g; emit(); } }).catch(() => { if (S.alignPanel) { S.alignPanel.gpu = { names: [], backend: 'cpu', why: 'не удалось определить видеокарту' }; emit(); } });
  if (S.alignPanel?.st?.running) poll();
}
export const refreshAlignSize = () => refresh(true).catch(() => {});
export const closeAlignPanel = () => { S.alignPanel = null; emit(); };
async function poll() {
  if (polling) return; polling = true;
  try {
    for (;;) {
      await new Promise(r => setTimeout(r, 1000));
      if (!S.alignPanel && !S.setup) break;
      const j: SetupState = await api('/api/align/setup');
      S.setup = j.running ? { step: j.step, pct: j.pct } : null;
      if (S.alignPanel) S.alignPanel.st = j;
      emit();
      if (!j.running) {
        if (j.error) toast('Установка авто-тайминга: ' + j.error, j.error === 'отменено' ? 'ok' : 'err');
        else if (j.installed) toast('Авто-тайминг установлен. Жми «✨ Авто-тайминг».', 'ok');
        if (S.alignPanel) await refresh(true);
        break;
      }
    }
  } finally { polling = false; }
}
export async function installAlign(reinstall = false) {
  const p = S.alignPanel; if (!p) return;
  await api('/api/align/setup', { method: 'POST', body: JSON.stringify({ backend: p.pick === 'auto' ? undefined : p.pick, reinstall }) });
  S.setup = { step: 'старт', pct: 0 }; emit(); poll();
}
export async function cancelOrRemoveAlign() {
  const p = S.alignPanel; if (!p?.st) return;
  if (!p.st.running && !await confirm(`Удалить авто-тайминг${p.st.bytes ? ` (${(p.st.bytes / 1e9).toFixed(1)} ГБ)` : ''}? Модели в кэше HuggingFace / torch останутся.`)) return;
  await api('/api/align/setup', { method: 'DELETE' }); await refresh(true);
}
export const openFolder = (what: 'python' | 'data') => api('/api/open?what=' + what, { method: 'POST' }).catch(e => toast((e as Error).message, 'err'));
export const setupLabel = () => S.setup ? `${S.setup.step}${S.setup.pct ? ' · ' + S.setup.pct + '%' : ''}` : '';
