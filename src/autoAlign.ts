// «Авто-тайминг»: the local server runs the experiments/auto-align prototype (Demucs + wav2vec2) on the track's audio;
// word timings come back flagged auto (dashed), hand-marked words are never touched. Also brings the separated voice.
import { S, emit, lineState, toast } from './state.ts';
import { projectJSON, scheduleSave, snapshot } from './persist.ts';
import { afterSyncChange, snap } from './sync.ts';
import { buildVoicePeaks, drawWave } from './waveform/wave.ts';
import type { Layer, Line } from './core/index.ts';

let sentAudio: Blob | null = null;
const STAGES: Record<string, string> = { start: 'запуск', demucs: 'вырезаю голос', karaoke: 'делю голос и бэк', align: 'подгоняю слова' };
export const alignLabel = () => S.align ? `${STAGES[S.align.stage] || S.align.stage}${S.align.total ? ` ${S.align.done}/${S.align.total}` : '…'}` : '';

async function api(path: string, init?: RequestInit) { const r = await fetch(path, init); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status); return j; }
export async function autoAlign() {
  if (S.align) return;
  if (!S.lines.length) return toast('Сначала загрузи текст.', 'err');
  if (!S.audioBlob) return toast('Нужно аудио трека — вкладка «Трек» → «Выбрать аудиофайл».', 'err');
  let st; try { st = await api('/api/align'); } catch { return toast('Авто-тайминг работает через локальный сервер: открой редактор с `npm run serve` или MCP-сервера (http://127.0.0.1:8787).', 'err'); }
  if (!st.available) return toast('Не найден прототип автоподгонки с Python (experiments/auto-align/.venv) — см. experiments/auto-align/README.md.', 'err');
  S.align = { stage: 'start', done: 0, total: 0 }; emit();
  try {
    if (sentAudio !== S.audioBlob) { await api('/api/align/audio?ext=' + ((S.audioBlob as File).name?.split('.').pop() || 'mp3'), { method: 'POST', body: S.audioBlob }); sentAudio = S.audioBlob; }
    await snapshot('перед авто-таймингом');
    await api('/api/align', { method: 'POST', body: projectJSON() });
    for (;;) {
      await new Promise(r => setTimeout(r, 1000));
      const j = await api('/api/align');
      if (j.running) { S.align = { stage: j.stage || 'start', done: j.done || 0, total: j.total || 0 }; emit(); continue; }
      if (j.error) throw new Error(j.error);
      if (!j.result) throw new Error('сервер не вернул результат');
      const n = merge(j.result.lines as Line[]);
      toast(`Авто-тайминг: расставлены слова в строках: ${n}. Это черновик (пунктир) — пройдись на слух, поправь мышью или G/H. Ctrl+Z — отмена.`, 'ok');
      if (j.vocals) { const b = await fetch('/api/align/vocals').then(r => r.blob()); if (await buildVoicePeaks(b)) toast('Волна теперь по чистому голосу (переключатель «волна» в панели).', 'ok'); }
      break;
    }
  } catch (e) { toast('Авто-тайминг: ' + (e as Error).message, 'err'); }
  S.align = null; emit(); drawWave();
}
/** take auto timings for lines whose texts still match; anything marked by hand here stays as it is */
function merge(res: Line[]) {
  snap(); let n = 0;
  S.lines.forEach((l, i) => {
    const r = res[i]; if (!r || r.text !== l.text) return;
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
