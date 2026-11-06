import { useEffect, useState } from 'react';
import { applySyllableDraft, selectedWordRange, splitRussian, textDraftLine, type SyllableRule } from '../core/index.ts';
import { S, emit, fillLine, layerText, setEditDraft, setText, toast } from '../state.ts';
import { PREVIEW_EDIT } from '../previewEdit.ts';
import { afterSyncChange, snap } from '../sync.ts';
import { buildPreview } from '../preview.ts';
import { drawWave } from '../waveform/wave.ts';

export function openSyllableReview() {
  if (PREVIEW_EDIT.active || S.editDraft) return toast('Сначала сохрани или отмени правку текста.', 'err');
  const i = S.sel?.i, k = S.sel?.k;
  if (i == null || k == null || !S.lines[i]) return toast('Сначала выбери слово на дорожке.', 'err');
  if (!selectedWordRange(layerText(S.lines[i], S.layer), k)) return toast('Сначала выбери слово на дорожке.', 'err');
  S.syllableReview = { i, k, layer: S.layer, text: layerText(S.lines[i], S.layer) }; emit();
}
export function SyllableReview() {
  const r = S.syllableReview; return r ? <ReviewForm key={`${r.i}:${r.k}:${r.layer}:${r.text}`} review={r} /> : null;
}
function ReviewForm({ review: r }: { review: NonNullable<typeof S.syllableReview> }) {
  const [rule, setRule] = useState<SyllableRule>('orthographic');
  const range = selectedWordRange(r.text, r.k)!;
  const [text, setDraft] = useState(() => range.word.includes('|') ? range.word : splitRussian(range.word).join('|'));
  const [error, setError] = useState('');
  const fullText = r.text.slice(0, range.start) + text + r.text.slice(range.end);
  useEffect(() => {
    const l = S.lines[r.i]; if (!l || layerText(l, r.layer) !== r.text) return;
    setEditDraft({ i: r.i, layer: r.layer, owner: 'syllables', line: textDraftLine(l, r.layer, fullText) }); buildPreview(true); drawWave();
    return () => { if (S.editDraft?.owner === 'syllables') { setEditDraft(null); buildPreview(true); drawWave(); } };
  }, [fullText, r]);
  const close = () => { setEditDraft(null); S.syllableReview = null; emit(); };
  const apply = () => {
    const l = S.lines[r.i]; if (!l || layerText(l, r.layer) !== r.text) { setError('Текст строки изменился. Закрой и открой предпросмотр заново.'); return; }
    const plan = applySyllableDraft(l, r.layer, fullText);
    if ('error' in plan) { setError(plan.error || 'Проверь границы слогов.'); return; }
    if (plan.text === r.text) return close();
    snap(); setEditDraft(null); setText(r.i, r.layer, plan.text); l.sync = { ...l.sync, [r.layer]: plan.sync }; fillLine(r.i, r.layer);
    S.layer = r.layer; S.sel = { i: r.i, k: range.k }; S.syllableReview = null; buildPreview(true); afterSyncChange(true);
    toast('Границы применены. Новые тайминги слогов — черновик. Ctrl+Z — отмена.', 'ok');
  };
  return <form className="syllable-review" id="syllableReview" onSubmit={e => { e.preventDefault(); apply(); }}>
    <div className="row"><b>Выбранное слово: «{range.word.replace(/\|/g, '')}»</b><select id="syllableRule" aria-label="Правила деления" value={rule} onChange={e => { const v = e.target.value as SyllableRule; setRule(v); setDraft(splitRussian(range.word.replace(/\|/g, ''), v).join('|')); }}><option value="orthographic">Русский · орфографические границы</option><option value="vocal">Русский · вокальные слоги, приблизительно</option></select></div>
    <label>Границы | сразу видны на дорожке. Enter — сохранить<textarea id="syllableText" autoFocus rows={1} value={text} onChange={e => { setDraft(e.target.value); setError(''); }} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); apply(); } if (e.key === 'Escape') { e.preventDefault(); close(); } }} /></label>
    <p className="hint">Русские правила переноса и слоги для пения различаются. Слова с латиницей и нерусскими буквами оставляются целиком. В смешанной песне проверь язык каждого слова; буквы и пробелы сохраняются. Уже заданные вручную границы не заменяются.</p>
    {error && <p className="status err" role="alert">{error}</p>}
    <div className="row"><button type="submit" className="pri" id="btnApplySyllables">Применить</button><button type="button" onClick={close}>Отмена</button></div>
  </form>;
}
