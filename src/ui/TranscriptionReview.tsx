import { useEffect, useRef } from 'react';
import { S } from '../state.ts';
import { fmtTime } from '../core/index.ts';
import { applyTranscription, canApplyTranscription, closeTranscription } from '../audioWorkflow.ts';

export function TranscriptionReview() {
  const draft = S.transcriptionReview, box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!draft) return;
    const previous = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const key = (event: KeyboardEvent) => {
      event.stopPropagation(); // Keep editor shortcuts from changing the underlying project while reviewing.
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeTranscription(); }
      if (event.key !== 'Tab') return;
      const buttons = [...(box.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])];
      const first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && (document.activeElement === first || !box.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !box.current?.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('keydown', key, true); if (previous?.isConnected) previous.focus(); };
  }, [draft]);
  if (!draft) return null;
  const applicable = canApplyTranscription();
  return <div className="modal" id="transcriptionReview" role="dialog" aria-modal="true" aria-labelledby="transcriptionTitle">
    <div className="help" ref={box} style={{ width: 'min(760px, 94vw)', maxHeight: '85dvh', overflowY: 'auto' }}>
      <button className="sm ic close" title="Отменить добавление текста" onClick={closeTranscription}>✕</button>
      <h3 id="transcriptionTitle">Распознанный текст — черновик</h3>
      <p>Проверь слова: на песнях модель может пропускать и выдумывать текст. Времена приблизительные. Ничего ещё не добавлено; новые бэки не создаются.</p>
      <div id="transcriptionLines">{draft.lines.map((line, index) => <p key={index} style={{ whiteSpace: 'pre-wrap' }}><small>{fmtTime(line.t)}–{fmtTime(line.end)}</small><br />{line.text}</p>)}</div>
      {!applicable && !S.align && <p role="alert">Трек изменился. Черновик нельзя применить поверх другого аудио или существующего текста.</p>}
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button id="btnTranscriptionCancel" onClick={closeTranscription}>Не добавлять</button>
        <button className="pri" id="btnTranscriptionApply" disabled={!applicable} onClick={() => void applyTranscription()}>Использовать черновик</button>
      </div>
    </div>
  </div>;
}
