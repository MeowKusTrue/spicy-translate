import { useState } from 'react';
import { applySyllableDraft, syllableDraft, type SyllableRule } from '../core/index.ts';
import { S, emit, fillLine, layerText, setText, toast } from '../state.ts';
import { PREVIEW_EDIT } from '../previewEdit.ts';
import { afterSyncChange, snap } from '../sync.ts';
import { buildPreview } from '../preview.ts';

export function openSyllableReview() {
  if (PREVIEW_EDIT.active) return toast('Сначала сохрани или отмени правку текста.', 'err');
  const i = S.sel?.i ?? S.lines.findIndex(l => layerText(l, S.layer).trim());
  if (i < 0 || !S.lines[i]) return toast('Выбери строку с текстом.', 'err');
  S.syllableReview = { i, layer: S.layer, text: layerText(S.lines[i], S.layer) }; emit();
}
export function SyllableReview() {
  const r = S.syllableReview; return r ? <ReviewForm key={`${r.i}:${r.layer}:${r.text}`} review={r} /> : null;
}
function ReviewForm({ review: r }: { review: NonNullable<typeof S.syllableReview> }) {
  const [rule, setRule] = useState<SyllableRule>('orthographic');
  const [text, setDraft] = useState(() => syllableDraft(S.lines[r.i], r.layer));
  const [error, setError] = useState('');
  const close = () => { S.syllableReview = null; emit(); };
  const apply = () => {
    const l = S.lines[r.i]; if (!l || layerText(l, r.layer) !== r.text) { setError('Текст строки изменился. Закрой и открой предпросмотр заново.'); return; }
    const plan = applySyllableDraft(l, r.layer, text);
    if ('error' in plan) { setError(plan.error || 'Проверь границы слогов.'); return; }
    if (plan.text === r.text) return close();
    snap(); setText(r.i, r.layer, plan.text); l.sync = { ...l.sync, [r.layer]: plan.sync }; fillLine(r.i, r.layer);
    S.layer = r.layer; S.sel = { i: r.i, k: 0 }; S.syllableReview = null; buildPreview(true); afterSyncChange(true);
    toast('Границы применены. Новые тайминги слогов — черновик. Ctrl+Z — отмена.', 'ok');
  };
  return <form className="syllable-review" id="syllableReview" onSubmit={e => { e.preventDefault(); apply(); }}>
    <div className="row"><b>Слоги · строка {r.i + 1}</b><select id="syllableRule" aria-label="Правила деления" value={rule} onChange={e => { const v = e.target.value as SyllableRule; setRule(v); const l = S.lines[r.i]; if (l && layerText(l, r.layer) === r.text) setDraft(syllableDraft(l, r.layer, v)); else setError('Строка изменилась. Открой предпросмотр заново.'); }}><option value="orthographic">Русский · орфографические границы</option><option value="vocal">Русский · вокальные слоги, приблизительно</option></select></div>
    <label>Границы можно поправить знаком |<textarea id="syllableText" rows={2} value={text} onChange={e => { setDraft(e.target.value); setError(''); }} /></label>
    <p className="hint">Русские правила переноса и слоги для пения различаются. Слова с латиницей и нерусскими буквами оставляются целиком. В смешанной песне проверь язык каждого слова; буквы и пробелы сохраняются. Уже заданные вручную границы не заменяются.</p>
    {error && <p className="status err" role="alert">{error}</p>}
    <div className="row"><button type="submit" className="pri" id="btnApplySyllables">Применить</button><button type="button" onClick={close}>Отмена</button></div>
  </form>;
}
