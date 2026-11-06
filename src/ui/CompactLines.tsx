import { toggleLinePick } from '../selection.ts';
import { useEffect, useState } from 'react';
import { S, isTr, layerText, mainLayerFor, mkLayer, setEditDraft, toast } from '../state.ts';
import { plainW, mmss, textDraftLine, type Layer } from '../core/index.ts';
import { focusLine, addLineHere, addBgHere, bracketsToBg, delLine, delBg, addLineAfter, editText } from '../lineEdit.ts';
import { pickLine, cycleAgent, agentOf } from '../agents.ts';
import { pause, seekTo } from '../audio.ts';
import { editPreview, PREVIEW_EDIT } from '../previewEdit.ts';
import { buildPreview } from '../preview.ts';
import { drawWave } from '../waveform/wave.ts';
import { snap } from '../sync.ts';

export function editPreviewRow(i: number, layer: Layer) {
  if (PREVIEW_EDIT.active || S.editDraft) return toast('Сначала сохрани или отмени правку.', 'err');
  pause(); focusLine(i, layer); seekTo(S.lines[i].t);
  requestAnimationFrame(() => { const p = document.getElementById('pl' + i); const host = layer === 'bg' || layer === 'bgo' ? (p?.querySelector<HTMLElement>('.bg') || p) : p; if (host) editPreview(i, host, layer); });
}
function BackEditor({ i, layer, close }: { i: number; layer: Layer; close: () => void }) {
  const [base] = useState(() => ({ line: S.lines[i], text: layerText(S.lines[i], layer) }));
  const [text, setText] = useState(base.text), [error, setError] = useState('');
  useEffect(() => {
    setEditDraft({ i, layer, owner: 'back', line: textDraftLine(base.line, layer, text) }); buildPreview(true); drawWave();
    return () => { if (S.editDraft?.owner === 'back') { setEditDraft(null); buildPreview(true); drawWave(); } };
  }, [i, layer, text, base]);
  const save = () => {
    if (!text.trim()) return setError('Впиши текст бэка или нажми «Отмена».');
    if (S.lines[i] !== base.line || layerText(base.line, layer) !== base.text) return setError('Строка изменилась. Открой бэк заново.');
    setEditDraft(null);
    if (text.trim() !== base.text) { snap(); S.layer = layer; S.sel = { i, k: 0 }; editText(i, layer, text.trim()); }
    close();
  };
  return <form className="back-inline" onSubmit={e => { e.preventDefault(); save(); }} onClick={e => e.stopPropagation()}>
    <label htmlFor="backInlineText">Бэк к строке {i + 1} · {isTr(layer) ? 'перевод' : 'оригинал'}</label>
    <input autoFocus id="backInlineText" value={text} onChange={e => { setText(e.target.value); setError(''); }} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); close(); } }} />
    {error && <small role="alert">{error}</small>}
    <div className="row"><button type="submit" className="sm pri">Сохранить</button><button type="button" className="sm" onClick={close}>Отмена</button></div>
  </form>;
}
type ListLanguage = 'follow' | 'orig' | 'tr' | 'both';
export function CompactLines() {
  const [query, setQuery] = useState('');
  const [language, setLanguage] = useState<ListLanguage>(() => { const v = localStorage.getItem('studioListLanguage'); return v === 'orig' || v === 'tr' || v === 'both' ? v : 'follow'; });
  const [editing, setEditing] = useState<{ i: number; layer: Layer } | null>(null);
  const shown = language === 'follow' ? S.meta.mode === 'original' ? 'orig' : S.meta.mode === 'bilingual' ? 'both' : 'tr' : language;
  const blocked = () => { if (PREVIEW_EDIT.active || S.editDraft) { toast('Сначала сохрани или отмени правку.', 'err'); return true; } return false; };
  const choose = (i: number, layer: Layer) => { if (blocked()) return; focusLine(i, layer); seekTo(S.lines[i].t); };
  const removeBack = (i: number) => { if (blocked()) return; delBg(i); toast('Бэк удалён. Ctrl+Z — вернуть.', 'ok'); };
  const startBack = (i: number, layer: Layer) => { if (blocked()) return; pause(); focusLine(i, layer); seekTo(S.lines[i].t); setEditing({ i, layer }); };
  return <section className="card linescard compact-lines"><h2>Строки <small>{S.lines.length}</small></h2>
    <div className="row compact-tools"><button className="sm" id="btnAddLine" disabled={!!S.editDraft} onClick={addLineHere}>+ строка</button><button className="sm" id="btnAddBg" disabled={!!S.editDraft} onClick={addBgHere}>+ бэк</button><button className="sm" id="btnParens" disabled={!!S.editDraft} onClick={bracketsToBg}>( ) → бэки</button></div>
    <div className="list-language" aria-label="Язык списка">{([['orig', 'Оригинал'], ['tr', 'Перевод'], ['both', 'Оба']] as const).map(([v, label]) => <button className="sm" key={v} aria-pressed={shown === v} onClick={() => { if (!blocked()) { setLanguage(v); localStorage.setItem('studioListLanguage', v); } }}>{label}</button>)}</div>
    <label className="line-search"><input id="lineSearch" type="search" aria-label="Найти строку" placeholder="Найти строку…" disabled={!!S.editDraft} value={query} onChange={e => setQuery(e.target.value)} /></label>
    <div id="lines" className="lines">{S.lines.map((l, i) => {
      if (query && ![l.text, l.tr, l.bg?.text, l.bg?.tr].join(' ').toLowerCase().includes(query.toLowerCase())) return null;
      const main: Layer = shown === 'tr' ? (language === 'follow' ? mainLayerFor(i) : 'tr') : 'orig', back = mkLayer(true, isTr(main));
      return <div id={'ln' + i} key={i} className={'ln compact-line' + (S.picked.has(i) ? ' picked' : '') + (S.sel?.i === i ? ' selected' : '') + (!l.text.trim() ? ' bgonly' : '')}>
        <div className="compact-time"><input type="checkbox" className="line-check" aria-label={`Выбрать строку ${i + 1}`} checked={S.picked.has(i)} disabled={!!S.editDraft} onChange={() => toggleLinePick(i)} /><button className="t" aria-label={`Строка ${i + 1}, ${mmss(l.t)}`} onClick={() => choose(i, l.text.trim() || !l.bg ? main : back)}>{mmss(l.t)}</button></div>
        <div className="txt">{l.approved?.[main] && <small className="approved-line" title="Ручная правка или одобрение: автоматизация не заменит тайминги этой дорожки">✓ Защищена</small>}{l.sec && <small className="compact-section">{l.sec}</small>}
          <button className="compact-text" onClick={e => { if (!S.editDraft && !PREVIEW_EDIT.active) pickLine(i, e); choose(i, main); }} onDoubleClick={() => editPreviewRow(i, main)}>{plainW(layerText(l, main)) || (main === 'tr' ? '+ Вписать перевод' : '+ Вписать строку')}</button>
          {shown === 'both' && <button className="compact-translation" onClick={() => editPreviewRow(i, 'tr')}>{plainW(l.tr) || '+ Перевод'}</button>}
          {l.bg && <div className="bgrow"><button className="compact-text compact-back" onClick={() => choose(i, back)} onDoubleClick={() => startBack(i, back)}>{plainW(layerText(l, back)) || '+ вписать бэк'}</button><small>{l.text.trim() ? `↳ к строке ${i + 1}` : 'самостоятельный бэк'}</small><button className="compact-edit-back" aria-label={`Править бэк строки ${i + 1}`} onClick={() => startBack(i, back)}>Править</button><button className="compact-edit-back compact-delete-back" disabled={!!S.editDraft} aria-label={`Удалить бэк строки ${i + 1}`} onClick={() => removeBack(i)}>Удалить</button></div>}
          {editing?.i === i ? <BackEditor key={`${i}:${editing.layer}`} i={i} layer={editing.layer} close={() => setEditing(null)} /> : !l.bg && <button className="addbg" disabled={!!S.editDraft} aria-label={`Добавить бэк к строке ${i + 1}`} onClick={() => startBack(i, back)}>+ бэк</button>}
        </div>
        <details className="compact-menu" onClickCapture={e => { if ((e.target as Element).closest("button")) e.currentTarget.open = false; }}><summary aria-label={`Действия со строкой ${i + 1}`}>⋯</summary><div className="compact-pop"><button disabled={!!S.editDraft} onClick={() => editPreviewRow(i, l.text.trim() || !l.bg ? main : back)}>Изменить текст</button><button disabled={!!S.editDraft} onClick={() => startBack(i, back)}>{l.bg ? 'Править бэк' : 'Добавить бэк к строке'}</button>{l.bg && <button disabled={!!S.editDraft} onClick={() => removeBack(i)}>Удалить бэк</button>}<button disabled={!!S.editDraft} onClick={() => addLineAfter(i)}>Добавить после</button><button disabled={!!S.editDraft} onClick={() => cycleAgent(i)}>Голос: {agentOf(i).label}</button><button disabled={!!S.editDraft} onClick={() => delLine(i)}>Удалить строку</button></div></details>
      </div>;
    })}</div><p className="hint">Двойной клик — правка в просмотре. Enter — сохранить, Esc — отменить. Ctrl / Shift — выбор строк.</p>
  </section>;
}
