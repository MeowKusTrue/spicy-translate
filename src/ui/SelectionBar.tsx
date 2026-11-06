import { useState } from 'react';
import { S } from '../state.ts';
import { W } from '../waveform/wave.ts';
import { markSelectionReady, unlockSelectedTiming } from '../sync.ts';
import { clearSelection } from '../selection.ts';
import { repeatAllTiming } from '../lineEdit.ts';
export function SelectionBar() {
  const [repeat, setRepeat] = useState(false), [replace, setReplace] = useState(false);
  if (!S.sel && !S.picked.size && !W.multi.length) return null;
  return <div className="selection-bar" id="selectionBar">
    <span className="selection-count" aria-live="polite">{[W.multi.length && `Выбрано слов: ${W.multi.length}`, S.picked.size && `Выбрано строк: ${S.picked.size}`].filter(Boolean).join(' · ') || 'Текущее слово'}</span>
    <button className="sm" id="btnWordsReady" disabled={!!S.editDraft || (!W.multi.length && !S.sel)} onClick={() => markSelectionReady('words')}>✓ Слова готовы</button>
    <button className="sm" id="btnLinesReady" disabled={!!S.editDraft || (!S.picked.size && !W.multi.length && !S.sel)} onClick={() => markSelectionReady('lines')}>✓ Строки готовы</button>
    <button className="sm" id="btnRepeatAllTiming" disabled={!!S.editDraft || !S.sel} onClick={() => setRepeat(!repeat)}>Тайминг → все повторы</button>
    <button className="sm" id="btnUnlockTiming" disabled={!!S.editDraft || (!S.picked.size && !W.multi.length && !S.sel)} onClick={unlockSelectedTiming} title="Снять защиту и разрешить повторную автоматизацию на активной дорожке">Разрешить автоматику</button>
    <button className="sm" id="btnClearSelection" onClick={clearSelection}>Снять выбор</button>
    {repeat && <div className="repeat-review" id="repeatTimingReview"><b>Тайминг строки {(S.sel?.i || 0)+1} → все строки с таким же текстом на активной дорожке</b><p>Время отсчитывается от начала каждой строки. Другие дорожки сохраняются. Копии отмечаются черновиком.</p><label><input type="checkbox" id="replaceApprovedRepeats" checked={replace} onChange={e => setReplace(e.target.checked)} /> Заменить также защищённые строки</label><div className="row"><button className="sm pri" id="btnApplyRepeatAll" onClick={() => { repeatAllTiming(replace); setRepeat(false); }}>Применить ко всем совпадениям</button><button className="sm" onClick={() => setRepeat(false)}>Отмена</button></div></div>}
    <small>Ctrl — по одному · Shift — диапазон</small>
  </div>;
}
