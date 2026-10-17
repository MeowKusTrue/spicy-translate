// «Авто-тайминг»: the local server runs the experiments/auto-align prototype (Demucs + wav2vec2) on the track's audio;
// word timings come back flagged auto (dashed), hand-marked words are never touched. Also brings the separated voice.
import { S, emit, lineState, toast } from './state.ts';
import { checkServer } from './live.ts';
import { projectJSON, scheduleSave, snapshot } from './persist.ts';
import { afterSyncChange, snap } from './sync.ts';
import { buildVoicePeaks, drawWave } from './waveform/wave.ts';
import type { Layer, Line } from './core/index.ts';
import { setLines } from './load.ts';

let sentAudio: Blob | null = null;
export const STAGES: Record<string, string> = { start: 'запуск', device: 'загружаю модели', demucs: 'вырезаю голос', karaoke: 'делю голос и бэк', transcribe: 'распознаю текст', align: 'подгоняю слова' };
const WEIGHT: Record<string, number> = { demucs: 30, karaoke: 15, transcribe: 25, align: 30 };
/** how far the current stage is, 0..1: its own counter, else the bar inside it (not a download: that only waits) */
export function stageFrac(a = S.align) {
  if (!a) return 0;
  if (a.total) return Math.min(1, a.done / a.total);
  return a.subTotal && !a.bytes ? Math.min(1, (a.subDone || 0) / a.subTotal) : 0;
}
export const alignLabel = () => { const a = S.align; if (!a) return ''; const f = stageFrac(); return `${STAGES[a.stage] || a.stage}${a.stage === 'align' && a.total ? ` ${a.done}/${a.total}` : f ? ` ${Math.round(f * 100)}%` : '…'}`; };
/** overall progress of a run, 0..100, by the stages it will go through (plan from align.py) */
export function alignPct() {
  const a = S.align; if (!a) return 0;
  const plan = a.plan?.length ? a.plan : ['demucs', 'karaoke', 'align'], all = plan.reduce((s, x) => s + (WEIGHT[x] || 10), 0);
  const k = plan.indexOf(a.stage); if (k < 0) return 1;
  const before = plan.slice(0, k).reduce((s, x) => s + (WEIGHT[x] || 10), 0);
  return Math.max(1, Math.round((before + (WEIGHT[a.stage] || 10) * stageFrac()) / all * 100));
}
/** «ещё ~1:20» from the time so far (once there is something to go by) */
export function alignEta() {
  const a = S.align, p = alignPct(); if (!a?.elapsed || p < 8 || p >= 99) return '';
  const s = Math.round(a.elapsed / 1000 * (100 - p) / p); return s < 60 ? `~${s} с` : `~${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
export async function cancelAlign() { try { await api('/api/align', { method: 'DELETE' }); toast('Авто-тайминг: отменяю…'); } catch (e) { toast('Не вышло отменить: ' + (e as Error).message, 'err'); } }
export const DEVICES: Record<string, string> = { cuda: 'видеокарта NVIDIA', xpu: 'видеокарта Intel', dml: 'видеокарта (DirectML)', cpu: 'процессор' };

async function api(path: string, init?: RequestInit) { const r = await fetch(path, init); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status); return j; }
export async function autoAlign() {
  if (S.align) return;
  if (!S.audioBlob) return toast('Нужно аудио трека — вкладка «Трек» → «Выбрать аудиофайл».', 'err');
  // no lyrics: write them from the voice (Whisper), then time every word
  const transcribe = !S.lines.length;
  if (transcribe && !confirm('Текста нет — распознать его по голосу?\n\nНейросеть (Whisper) запишет слова и расставит их по времени — черновик, его надо будет проверить. В первый раз скачает модель (~1.6 ГБ).')) return;
  let st; try { st = await api('/api/align'); } catch { return toast('Авто-тайминг работает через локальный сервер: открой редактор с `npm run serve` или MCP-сервера (http://127.0.0.1:8787).', 'err'); }
  if (!st.available) return st.canSetup ? openAlignPanel() : toast('Авто-тайминг не установлен: нужен прототип experiments/auto-align и его Python — см. experiments/auto-align/README.md.', 'err');
  const only = !transcribe && S.picked.size ? [...S.picked].sort((a, b) => a - b) : null; // picked lines: just those
  S.align = { stage: 'start', done: 0, total: 0, device: '' }; emit();
  try {
    if (sentAudio !== S.audioBlob) { await api('/api/align/audio?ext=' + ((S.audioBlob as File).name?.split('.').pop() || 'mp3'), { method: 'POST', body: S.audioBlob }); sentAudio = S.audioBlob; }
    await snapshot('перед авто-таймингом');
    const body = only ? JSON.stringify({ ...JSON.parse(projectJSON()), lines: only.map(i => JSON.parse(projectJSON()).lines[i]) }) : projectJSON();
    await api('/api/align' + (transcribe ? '?transcribe=1' : ''), { method: 'POST', body });
    for (;;) {
      await new Promise(r => setTimeout(r, 1000));
      const j = await api('/api/align');
      if (j.running) { S.align = { stage: j.stage || 'start', done: j.done || 0, total: j.total || 0, device: j.device || '', plan: j.plan, sub: j.sub, subDone: j.subDone, subTotal: j.subTotal, bytes: j.bytes, elapsed: j.elapsed }; emit(); continue; }
      if (j.error) throw new Error(j.error);
      if (!j.result) throw new Error('сервер не вернул результат');
      if (transcribe) {
        const ls = j.result.lines as Line[]; if (!ls.length) throw new Error('в голосе не нашлось слов');
        setLines(ls, S.duration); scheduleSave();
        toast(`Текст распознан: строк ${ls.length}, слова расставлены (пунктир). Это черновик — проверь слова (вкладка «Текст») и тайминги на слух; лучше взять текст с Genius и наложить его («Трек» → «Текст с Genius»).`, 'ok');
      } else {
      const n = merge(j.result.lines as Line[], only);
      toast(`Авто-тайминг: расставлены слова в строках: ${n}. Это черновик (пунктир) — пройдись на слух, поправь мышью или G/H. ${S.autoFit ? 'Строки подогнаны под слова.' : 'Подогнать строки под слова — ⚙ → «Строки сами по словам».'} Ctrl+Z — отмена.`, 'ok');
      }
      if (j.vocals) { const b = await fetch('/api/align/vocals').then(r => r.blob()); if (await buildVoicePeaks(b)) toast('Волна теперь по чистому голосу (переключатель «волна» в панели).', 'ok'); }
      break;
    }
  } catch (e) { toast('Авто-тайминг: ' + (e as Error).message, 'err'); }
  S.align = null; emit(); drawWave();
}
/** take auto timings for lines whose texts still match; anything marked by hand here stays as it is */
function merge(res: Line[], only: number[] | null = null) {
  snap(); let n = 0;
  S.lines.forEach((l, i) => {
    const r = res[only ? only.indexOf(i) : i]; if (!r || r.text !== l.text) return;
    let did = false;
    for (const k of ['orig', 'bgo'] as Layer[]) {
      const sy = r.sync?.[k]; if (!sy || lineState(i, k) === 'done' || (k === 'bgo' && (r.bg?.text || '') !== (l.bg?.text || ''))) continue;
      (l.sync = l.sync || {})[k] = sy.map(x => ({ ...x, g: x.g ?? 1 })); did = true;
    }
    if (did) n++;
  });
  if (!n) S.undo.pop(); else { afterSyncChange(true); scheduleSave(); }
  return n;
}

/* ---------- the «Авто-тайминг» panel: GPU found, which PyTorch build, install with progress, cancel, remove ---------- */
export type Gpu = { names: string[]; backend: string; why: string; cu?: string };
export type SetupState = { running: boolean; step: string; pct: number; error: string; installed: boolean; backend: string; file: string; got: number; size: number; last: string; bytes?: number; dir: string; external: boolean };
let polling = false;
async function refresh(withSize = false) {
  const p = S.alignPanel; if (!p) return;
  p.st = await api('/api/align/setup' + (withSize ? '?size=1' : '')); emit();
}
export async function openAlignPanel() {
  S.alignPanel = { gpu: null, st: null, pick: 'auto', err: '' }; emit();
  const fail = (m: string) => { if (S.alignPanel) { S.alignPanel.err = m; emit(); } };
  try { await refresh(true); }
  catch { return fail(await checkServer().catch(() => false)
    ? 'Сервер не ответил на запрос установки — попробуй ещё раз.'
    : 'Сервер старой версии или недоступен. Перезапусти его: в Claude Code /mcp → spicy-translate → Reconnect (или закрой Claude Code), либо открой редактор приложением / батником.'); }
  api('/api/align/gpu').then(g => { if (S.alignPanel) { S.alignPanel.gpu = g; emit(); } }).catch(() => { if (S.alignPanel) { S.alignPanel.gpu = { names: [], backend: 'cpu', why: 'не удалось определить видеокарту' }; emit(); } });
  if (S.alignPanel?.st?.running) poll();
}
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
  if (!p.st.running && !confirm(`Удалить авто-тайминг${p.st.bytes ? ` (${(p.st.bytes / 1e9).toFixed(1)} ГБ)` : ''}? Модели в кэше HuggingFace / torch останутся.`)) return;
  await api('/api/align/setup', { method: 'DELETE' }); await refresh(true);
}
export const openFolder = (what: 'python' | 'data') => api('/api/open?what=' + what, { method: 'POST' }).catch(e => toast((e as Error).message, 'err'));
export const setupLabel = () => S.setup ? `${S.setup.step}${S.setup.pct ? ' · ' + S.setup.pct + '%' : ''}` : '';
