import { useEffect, useRef, useState } from 'react';
import { S } from '../state.ts';
import { fmtTime } from '../core/index.ts';
import { playWord } from '../audio.ts';
import { applyAlignmentCandidates, canApplyAlignmentCandidate, closeAlignmentReview } from '../autoAlign.ts';

export function AlignmentReview() {
  const draft = S.alignmentReview, box = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (!draft) return;
    setPicked(new Set());
    const previous = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const key = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); closeAlignmentReview(); }
      if (event.key !== 'Tab') return;
      const controls = [...(box.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') || [])];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || !box.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !box.current?.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('keydown', key, true); if (previous?.isConnected) previous.focus(); };
  }, [draft]);
  if (!draft) return null;
  const selected = draft.candidates.filter(c => picked.has(c.row) && canApplyAlignmentCandidate(c.row)).map(c => c.row);
  return <div className="modal" id="alignmentReview" role="dialog" aria-modal="true" aria-labelledby="alignmentReviewTitle">
    <div className="help alignment-review" ref={box}>
      <button className="sm ic close" title="Закрыть без применения оставшихся вариантов" onClick={closeAlignmentReview}>✕</button>
      <h3 id="alignmentReviewTitle">Восстановление пропущенных строк</h3>
      <p>Готовый текст сопоставлен с вокалом между соседними опорами. Проверь начало слов и нужный повтор припева. Эти варианты ещё не применены.</p>
      <button onClick={() => setPicked(new Set(draft.candidates.filter(c => canApplyAlignmentCandidate(c.row)).map(c => c.row)))}>Выбрать все</button>
      <ol className="alignment-candidates">{draft.candidates.map(({ row, line }) => {
        const spans = line.sync!.orig!, a = spans[0].a!, b = spans.at(-1)!.b!, available = canApplyAlignmentCandidate(row);
        return <li key={row} value={row + 1}>
          <label><input type="checkbox" checked={picked.has(row)} disabled={!available} onChange={e => setPicked(old => { const next = new Set(old); if (e.target.checked) next.add(row); else next.delete(row); return next; })} />
            <span><b>Строка {row + 1}</b><br />{line.text}<br /><small>{fmtTime(a)}–{fmtTime(b)}</small></span></label>
          {!available && <p role="status">Строка или трек изменились; вариант недоступен.</p>}
          <div className="row"><button disabled={!available} onClick={() => playWord({ a: Math.max(0, a - .3), b: b + .3 })}>Прослушать строку {row + 1}</button>
            <button disabled={!available} onClick={() => applyAlignmentCandidates([row])}>Применить</button></div>
        </li>;
      })}</ol>
      <div className="row alignment-review-actions"><button onClick={closeAlignmentReview}>Оставить прежние</button>
        <button className="pri" disabled={!selected.length} onClick={() => applyAlignmentCandidates(selected)}>Применить выбранные ({selected.length})</button></div>
    </div>
  </div>;
}
