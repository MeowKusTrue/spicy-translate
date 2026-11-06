import { useState } from 'react';
import { detachBacking, layerProgress, linkBacking, plainW, type Mode } from '../core/index.ts';
import { S, emit, isBg, isTr, mkLayer, toast } from '../state.ts';
import { setMode } from '../load.ts';
import { PREVIEW_EDIT } from '../previewEdit.ts';
import { afterSyncChange, selectWord, snap } from '../sync.ts';
import { buildPreview } from '../preview.ts';

export function ModePicker() {
  const modes: [Mode, string][] = [['original', 'Оригинал'], ['translation', 'Перевод'], ['bilingual', 'Два языка']];
  return <div className="project-mode" role="group" aria-label="Задача проекта">{modes.map(([v, label]) => <button key={v} id={'mode-' + v} aria-pressed={S.meta.mode === v} className={S.meta.mode === v ? 'on' : ''} onClick={() => { if (PREVIEW_EDIT.active) return toast('Сначала сохрани или отмени правку в просмотре.', 'err'); setMode(v); }}>{label}</button>)}</div>;
}

export function TrackProgress() {
  const orig = S.meta.mode !== 'translation', main = layerProgress(S.lines, orig ? 'orig' : 'tr'), bg = layerProgress(S.lines, orig ? 'bgo' : 'bg');
  return <section className="studio-progress" aria-label="Готовность дорожек"><small>ГОТОВНОСТЬ {orig ? 'ОРИГИНАЛА' : 'ПЕРЕВОДА'}</small>{[['Основа', main], ['Бэки', bg]].map(([title, p]) => {
    const v = p as typeof main; return <div key={title as string}><span>{title as string}</span><b>{v.done} / {v.total}</b><meter min={0} max={v.total || 1} value={v.done} aria-label={title as string} /></div>;
  })}<p>{S.meta.mode === 'original' ? 'Перевод не требуется. Импортированные тайминги проверь на слух.' : 'Считаются строки с текстом на выбранной дорожке.'}</p></section>;
}

export function BackingLink() {
  const [target, setTarget] = useState(''), i = S.sel?.i, l = i == null ? null : S.lines[i];
  if (i == null || !l?.bg || !isBg(S.layer)) return null;
  const apply = (detach = false) => {
    const r = detach ? detachBacking(S.lines, i) : linkBacking(S.lines, i, +target);
    if ('error' in r) return toast(r.error, 'err');
    snap(); S.lines = r.lines; S.picked.clear(); S.layer = mkLayer(true, isTr(S.layer)); S.sel = { i: r.at, k: 0 };
    buildPreview(true); afterSyncChange(true); selectWord(r.at, 0); toast(detach ? 'Бэк стал самостоятельной фразой. Ctrl+Z — отмена.' : 'Бэк привязан, его тайминги сохранены. Ctrl+Z — отмена.', 'ok'); setTarget('');
  };
  return <section className="backing-link"><small>СВЯЗЬ БЭКА</small><p>{l.text.trim() ? `К строке ${i + 1}: «${plainW(l.text).slice(0, 65)}»` : 'Самостоятельный бэк — без связанной основной фразы'}</p>
    <label>Основная фраза<select id="backingParent" value={target} onChange={e => setTarget(e.target.value)}><option value="">Выбери строку…</option>{S.lines.map((x, k) => k !== i && x.text.trim() && !(x.bg?.text.trim() || x.bg?.tr.trim()) ? <option value={k} key={k}>{k + 1}. {plainW(x.text).slice(0, 65)}</option> : null)}</select></label>
    <div className="row"><button id="btnLinkBacking" disabled={target === ''} onClick={() => apply()}>Привязать</button>{!!l.text.trim() && <button id="btnDetachBacking" onClick={() => apply(true)}>Отвязать</button>}</div><small>Текст другой фразы не заменяется. Есть отмена.</small>
  </section>;
}
