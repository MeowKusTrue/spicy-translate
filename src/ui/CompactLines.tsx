import { useState } from 'react';
import { S, isTr, layerText, mainLayerFor, mkLayer } from '../state.ts';
import { plainW, mmss, type Layer } from '../core/index.ts';
import { focusLine, addLineHere, addBgHere, bracketsToBg, delLine, addLineAfter } from '../lineEdit.ts';
import { pickLine, cycleAgent, agentOf } from '../agents.ts';
import { pause, seekTo } from '../audio.ts';
import { editPreview, PREVIEW_EDIT } from '../previewEdit.ts';

export function editPreviewRow(i: number, layer: Layer) {
  if (PREVIEW_EDIT.active) return;
  pause(); focusLine(i, layer); seekTo(S.lines[i].t);
  requestAnimationFrame(() => { const p = document.getElementById('pl' + i); const host = layer === 'bg' || layer === 'bgo' ? (p?.querySelector<HTMLElement>('.bg') || p) : p; if (host) editPreview(i, host, layer); });
}
export function CompactLines() {
  const [query, setQuery] = useState('');
  const choose = (i: number, layer: Layer) => { focusLine(i, layer); seekTo(S.lines[i].t); };
  return <section className="card linescard compact-lines"><h2>Строки <small>{S.lines.length}</small></h2>
    <div className="row compact-tools"><button className="sm" id="btnAddLine" onClick={addLineHere}>+ строка</button><button className="sm" id="btnAddBg" onClick={addBgHere}>+ бэк</button><button className="sm" id="btnParens" onClick={bracketsToBg}>( ) → бэки</button></div>
    <label className="line-search"><input id="lineSearch" type="search" aria-label="Найти строку" placeholder="Найти строку…" value={query} onChange={e => setQuery(e.target.value)} /></label>
    <div id="lines" className="lines">{S.lines.map((l, i) => {
      if (query && ![l.text, l.tr, l.bg?.text, l.bg?.tr].join(' ').toLowerCase().includes(query.toLowerCase())) return null;
      const main = mainLayerFor(i), back = mkLayer(true, isTr(main));
      return <div id={'ln' + i} key={i} className={'ln compact-line' + (S.picked.has(i) ? ' picked' : '') + (S.sel?.i === i ? ' selected' : '') + (!l.text.trim() ? ' bgonly' : '')}>
        <button className="t" aria-label={`Строка ${i + 1}, ${mmss(l.t)}`} onClick={() => choose(i, l.text.trim() || !l.bg ? main : back)}>{mmss(l.t)}</button>
        <div className="txt">{l.sec && <small className="compact-section">{l.sec}</small>}
          {!!(l.text.trim() || l.tr.trim()) && <button className="compact-text" onClick={e => { pickLine(i, e); choose(i, main); }} onDoubleClick={() => editPreviewRow(i, main)}>{plainW(layerText(l, main)) || plainW(l.text)}</button>}
          {S.meta.mode === 'bilingual' && !!l.tr.trim() && <button className="compact-translation" onClick={() => editPreviewRow(i, 'tr')}>{plainW(l.tr)}</button>}
          {!l.text.trim() && !l.tr.trim() && !l.bg && <button className="compact-text" onClick={() => editPreviewRow(i, main)}>+ Вписать строку</button>}
          {l.bg && <div className="bgrow"><button className="compact-text compact-back" onClick={() => choose(i, back)} onDoubleClick={() => editPreviewRow(i, back)}>{plainW(layerText(l, back)) || plainW(l.bg.text) || '+ вписать бэк'}</button><small>{l.text.trim() ? `↳ к строке ${i + 1}` : 'самостоятельный бэк'}</small><button className="compact-edit-back" aria-label={`Править бэк строки ${i + 1}`} onClick={() => editPreviewRow(i, back)}>Править</button></div>}
        </div>
        <details className="compact-menu"><summary aria-label={`Действия со строкой ${i + 1}`}>⋯</summary><div className="compact-pop"><button onClick={() => editPreviewRow(i, l.text.trim() || !l.bg ? main : back)}>Изменить текст</button><button onClick={() => addLineAfter(i)}>Добавить после</button><button onClick={() => cycleAgent(i)}>Голос: {agentOf(i).label}</button><button onClick={() => delLine(i)}>Удалить строку</button></div></details>
      </div>;
    })}</div><p className="hint">Двойной клик — правка в просмотре. Ctrl / Shift — выбор нескольких строк.</p>
  </section>;
}
