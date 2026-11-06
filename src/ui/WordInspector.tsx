import { useState } from 'react';
import { editorReview, fmtTime, layerProgress, parseTimeExpr, plainW, sameLines } from '../core/index.ts';
import { S, emit, ls, viewWords } from '../state.ts';
import { pause, play, playWord, seekTo } from '../audio.ts';
import { setLoop } from '../hotkeys.ts';
import { openEdit, repeatSelectedLayer } from '../lineEdit.ts';
import { confirmPhrase, setWordTimes, stepReview } from '../sync.ts';
import { centerOnSel } from '../waveform/wave.ts';
import { BackingLink, TrackProgress } from './Studio.tsx';

export const inspectorOpen = () => ls.get('wordInspector', '0') !== '0';
export function toggleInspector() { ls.set('wordInspector', inspectorOpen() ? '0' : '1'); emit(); requestAnimationFrame(centerOnSel); }

export function ReviewBar() {
  const queue = editorReview(S.lines, S.layer), progress = layerProgress(S.lines, S.layer);
  const at = S.sel ? queue.findIndex(x => x.i === S.sel!.i && x.k === S.sel!.k) : -1;
  return <div className="review-bar" id="editorReviewBar">
    <span className={'review-count' + (queue.length ? ' pending' : '')} role="status" aria-atomic="true"><i />{queue.length ? `Проверить: ${queue.length}` : progress.words ? 'Черновиков и пропусков нет' : 'Выбери дорожку с текстом'}</span>
    <span className="review-nav"><button className="sm" id="btnReviewPrev" aria-label="Предыдущее место для проверки" disabled={!queue.length} onClick={() => stepReview(-1)}>←</button>
      <small>{at >= 0 ? `${at + 1} / ${queue.length}` : 'эта дорожка'}</small><button className="sm" id="btnReviewNext" disabled={!queue.length} title="J — дальше, Shift+J — назад" onClick={() => stepReview(1)}>Дальше <kbd>J</kbd> →</button></span>
    <span className="review-meter" title={`Слова с заданным временем: ${progress.marked} из ${progress.words}; авточерновик: ${progress.auto}`}><i style={{ width: `${progress.words ? progress.marked / progress.words * 100 : 0}%` }} /></span>
    <small className="review-words">Слова: {progress.marked}/{progress.words}{progress.auto ? ` · авто ${progress.auto}` : ''}</small>
  </div>;
}

function TimingForm({ i, k, a, b, auto }: { i: number; k: number; a: number; b: number; auto: boolean }) {
  const [start, setStart] = useState(fmtTime(a)), [end, setEnd] = useState(fmtTime(b));
  const [roll, setRoll] = useState(true), [error, setError] = useState('');
  const duration = parseTimeExpr(end.replace(',', '.')) - parseTimeExpr(start.replace(',', '.'));
  const apply = (next = false) => {
    const err = setWordTimes(parseTimeExpr(start.replace(',', '.')), parseTimeExpr(end.replace(',', '.')), roll);
    setError(err || '');
    if (!err) { if (next) stepReview(1); else document.getElementById('btnWordApply')?.focus(); }
  };
  return <form className="timing-form" onSubmit={e => { e.preventDefault(); apply(); }}>
    <div className="inspector-times">
      <label>Начало<input type="text" id="wordStart" aria-label="Начало выбранного слова" value={start} onChange={e => { setStart(e.target.value); setError(''); }} inputMode="decimal" spellCheck={false} /></label>
      <label>Конец<input type="text" id="wordEnd" aria-label="Конец выбранного слова" value={end} onChange={e => { setEnd(e.target.value); setError(''); }} inputMode="decimal" spellCheck={false} /></label>
    </div>
    <div className="timing-duration"><span>{Number.isFinite(duration) && duration > 0 ? `${Math.round(duration * 1000)} мс` : 'Проверь время'}</span><small>м:сс.ммм или секунды</small></div>
    <label className="inspector-check"><input type="checkbox" id="wordRoll" checked={roll} onChange={e => setRoll(e.target.checked)} />Двигать общие края соседних слов</label>
    <p className="inspector-error" role="status" aria-live="polite">{error}</p>
    <div className="inspector-apply"><button className="pri" id="btnWordApply" type="submit">{auto ? 'Подтвердить тайминг' : 'Применить время'}</button><button type="button" id="btnWordApplyNext" title="Применить время и перейти к следующему месту для проверки" onClick={() => apply(true)}>И дальше →</button></div>
    <button type="button" className="inspector-text-edit" id="btnInspectorEdit" onClick={() => openEdit(i, S.layer, k)}>Править текст слова <kbd>E</kbd></button>
  </form>;
}

export function WordInspector() {
  const sel = S.sel, l = sel && S.lines[sel.i], w = sel && l && viewWords(sel.i, S.layer)[sel.k];
  const title = S.layer === 'orig' ? 'Основа · оригинал' : S.layer === 'tr' ? 'Основа · перевод' : S.layer === 'bgo' ? 'Бэк · оригинал' : 'Бэк · перевод';
  if (!sel || !l || !w) return <aside className="word-inspector empty" id="wordInspector" aria-label="Свойства выбранного слова"><small className="inspector-eyebrow">СВОЙСТВА СЛОВА</small><h3>Выбери слово на дорожке</h3><p>Здесь можно задать точное время, послушать фразу и перенести её ритм на повторы.</p><button className="sm" disabled={!editorReview(S.lines, S.layer).length} onClick={() => stepReview(1)}>Начать проверку →</button></aside>;
  const reason = editorReview(S.lines, S.layer).find(x => x.i === sel.i && x.k === sel.k)?.reason;
  const repeats = sameLines(S.lines, sel.i).length;
  const phrase = () => {
    const ws = viewWords(sel.i, S.layer).filter(x => x.a != null && x.b != null); if (!ws.length) return;
    const a = Math.max(0, Math.min(...ws.map(x => x.a!)) - .15), b = Math.max(...ws.map(x => x.b!)) + .15;
    if (S.loop) { seekTo(a); play(); } else playWord({ a, b });
  };
  return <aside className="word-inspector" id="wordInspector" aria-label="Свойства выбранного слова">
    <div className="inspector-heading"><small className="inspector-eyebrow">{title}</small><button className="ic sm" aria-label="Скрыть свойства слова" onClick={toggleInspector}>×</button></div>
    <div className="inspector-review-heading"><b>Проверка дорожки</b><button className="sm" disabled={!editorReview(S.lines, S.layer).length} onClick={() => stepReview(1)}>Дальше <kbd>J</kbd> →</button></div>
    <h3 title={plainW(w.word)}>{plainW(w.word)}</h3><div className="inspector-sub"><span>Строка {sel.i + 1} · слово {sel.k + 1}</span><span className={w.g || w.ghost ? 'draft' : ''}>{w.g || w.ghost ? 'Черновик' : 'Тайминг задан'}</span></div>
    {reason && <p className="inspector-reason">{reason}</p>}
    {w.a != null && w.b != null && <TimingForm key={`${sel.i}:${sel.k}:${S.layer}:${w.a}:${w.b}:${!!w.g}`} i={sel.i} k={sel.k} a={w.a} b={w.b} auto={!!w.g || !!w.ghost} />}
    <div className="inspector-listen"><button id="btnInspectorListen" disabled={!S.hasAudio || w.a == null || w.b == null} onClick={() => playWord({ a: Math.max(0, w.a! - .1), b: w.b! + .1 })}>▷ Слово</button><button id="btnInspectorPhrase" disabled={!S.hasAudio} onClick={phrase}>▷ Фраза</button><button className="ic" aria-label="Остановить прослушивание" onClick={pause}>■</button></div>
    {!S.hasAudio && <p className="hint">Загрузи аудио, чтобы проверять на слух.</p>}
    <label className="inspector-check"><input type="checkbox" id="wordLoop" checked={S.loop} onChange={e => setLoop(e.target.checked)} />Повторять фразу по кругу <kbd>L</kbd></label>
    {l.sync?.[S.layer]?.some(x => x.g) && <button className="studio-confirm" id="btnConfirmPhrase" onClick={confirmPhrase}>Тайминги фразы проверены</button>}
    <BackingLink key={sel.i} />
    <TrackProgress />
    {!!repeats && <div className="inspector-automation"><small className="inspector-eyebrow">ПОВТОРЫ ФРАЗЫ · {repeats}</small><p>Перенести ритм этой дорожки на одинаковые фразы. Заданные без отметки «авто» тайминги сохраняются.</p><button id="btnInspectorRepeats" disabled={layerProgress([l], S.layer).done !== 1} onClick={repeatSelectedLayer}>Тайминги → на повторы</button><small>Копии будут черновиком. Ctrl+Z — отмена.</small></div>}
  </aside>;
}
