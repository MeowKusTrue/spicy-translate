// Bottom dock: top bar, waveform, word chips, F/G/H toolbar with "Строка ⋯" and ⚙ menus.
import { useEffect, useRef } from 'react';
import { fmtTime, mmss, plainW, units } from '../core/index.ts';
import { S, isBg, isTr, layerText, lineState, ls, mkLayer, viewWords, wordsOf, emit } from '../state.ts';
import { playWord } from '../audio.ts';
import { dockMouseDown, setLoop, setSnap, toggleDock } from '../hotkeys.ts';
import { setupGrip } from '../dockSize.ts';
import { setAgent } from '../agents.ts';
import { copyTiming, fitLines, pasteTimingHere, repeatChorus, setAutoFit, setFitPad, shiftLines } from '../lineEdit.ts';
import { DEVICES, alignLabel, alignPct, autoAlign, openAlignPanel, setupLabel } from '../autoAlign.ts';
import { W } from '../waveform/wave.ts';
import {
  clearLayer, doRedo, doUndo, joinWords, mark, nudgeWord, playSel, resetLine, resetWord, selectWord, setLayer,
  splitWord, spreadAll, spreadSelLine, stepWord, syllabifyLine, wordLabel,
} from '../sync.ts';
import { centerOnSel, drawWave, zoomAt } from '../waveform/wave.ts';
import { setupMini, setupWave } from '../waveform/edit.ts';
import { stepInfo } from './App.tsx';

function Guide() {
  const { cur, n } = stepInfo();
  if (!n) return <>Сначала найди трек слева или перетащи .lrc / аудио.</>;
  if (!S.hasAudio) return <>Перетащи аудиофайл на страницу — без звука размечать нечего.</>;
  if (cur === 2 && S.layer === 'tr') return <>Перевода ещё нет — переведи слева или размечай оригинал.</>;
  if (S.sel) return <><b>«{wordLabel(S.sel.i, S.sel.k)}»</b> · строка {S.sel.i + 1} — Space и жми F, потом G на каждом слове</>;
  return <>Кликни слово, с которого начнёшь.</>;
}
function wordInfo() {
  const x = S.sel && S.lines[S.sel.i]?.sync && S.lines[S.sel.i].sync![S.layer], q = x && x[S.sel!.k];
  return q && q.a != null && q.b != null ? `${fmtTime(q.a)} → ${fmtTime(q.b)} (${Math.round((q.b - q.a) * 1000)} мс)${q.g ? ' · авто' : ''}${q.b - q.a >= 1 ? ' · ✦ долгое' : ''}` : '';
}

function Chips() {
  if (!S.lines.length) return <div className="keys">Загрузи трек и аудио (♪), затем жми F / G / H в такт слову.</div>;
  const ci = S.sel ? S.sel.i : 0, rows = [];
  for (let i = Math.max(0, ci - 1); i <= Math.min(S.lines.length - 1, ci + 2); i++) {
    const ws = wordsOf(i, S.layer), us = units(layerText(S.lines[i], S.layer)), vw = viewWords(i, S.layer), sy = S.lines[i].sync && S.lines[i].sync![S.layer];
    rows.push(<div key={i} className={'sl' + (i === ci ? ' cur' : '')}>
      <span className="lab">{mmss(S.lines[i].t)}</span>
      {!ws.length && <span className="keys">{isBg(S.layer) ? '(нет бэка — двойной клик по дорожке «бэк» или E)' : S.layer === 'tr' ? '(нет перевода — E, чтобы вписать)' : '(пусто — E, чтобы вписать)'}</span>}
      {ws.map((w, k) => {
        const x = sy && sy.length === ws.length ? sy[k] : null;
        let cls = 'chip' + (w.includes(' ') ? ' grp' : '');
        if (x && x.a != null && x.b != null && !x.g) cls += ' t'; else if (x && x.a != null && x.b != null) cls += ' half';
        if (S.sel && S.sel.i === i && S.sel.k === k) cls += ' sel';
        if (!us[k].sp && k < ws.length - 1) cls += ' syl'; if (k && !us[k - 1].sp) cls += ' cont';
        const v = vw[k], has = v && v.a != null;
        return <span key={k} className={cls} data-a={has ? v.a! : undefined} data-b={has ? v.b! : undefined}
          onClick={() => selectWord(i, k)}
          onContextMenu={e => { e.preventDefault(); const x = viewWords(i, S.layer)[k]; if (x && x.a != null) playWord(x as { a: number; b: number }); }}>{plainW(w)}</span>;
      })}
    </div>);
  }
  return <>{rows}</>;
}

export function SyncDock() {
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => setupWave(cv.current!), []);
  const mini = useRef<HTMLCanvasElement>(null);
  useEffect(() => setupMini(mini.current!), []);
  const gr = useRef<HTMLDivElement>(null);
  useEffect(() => setupGrip(gr.current!), []);
  useEffect(() => { const f = () => drawWave(); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); }, []);
  let done = 0; S.lines.forEach((_, i) => { if (lineState(i, S.layer) === 'done') done++; });
  const width = () => cv.current?.clientWidth || 800;
  return <div className={'dock' + (S.playing ? ' rec' : '')} id="dock" hidden={!S.dock} onMouseDown={dockMouseDown}>
    <div className="grip" ref={gr} title="Потяни, чтобы изменить высоту панели (двойной клик — как было)"></div>
    <div className="bar">
      <b className="ttl">Разметка слов</b>
      <span className="tseg" title="Что размечаем: перевод или оригинал (T)">
        <button className={isTr(S.layer) ? 'on' : ''} id="segTr" onClick={() => setLayer(mkLayer(isBg(S.layer), true))}>Перевод</button>
        <button className={isTr(S.layer) ? '' : 'on'} id="segOrig" onClick={() => setLayer(mkLayer(isBg(S.layer), false))}>Оригинал</button>
      </span>
      <span className="tseg trk" title="Дорожка: основная строка или бэк (B). Клик по дорожке на волне тоже переключает">
        <button className={isBg(S.layer) ? '' : 'on'} id="segMain" onClick={() => setLayer(mkLayer(false, isTr(S.layer)))}>Основа</button>
        <button className={isBg(S.layer) ? 'on bg' : ''} id="segBg" onClick={() => setLayer(mkLayer(true, isTr(S.layer)))}>Бэк</button>
      </span>
      <button className={'sm' + (S.align || S.setup ? ' busy' : '')} id="btnAutoAlign" disabled={!!S.align || !!S.setup} title="Нейросеть расставит слова оригинала и бэка по аудио (черновик пунктиром; размеченное вручную не трогает). Нужен локальный сервер и Python-прототип." onClick={autoAlign}>{S.setup ? '⬇ ' + setupLabel() : S.align ? '⏳ ' + alignLabel() : '✨ Авто-тайминг'}</button>
      <button className="sm ic" id="btnAlignPanel" title="Авто-тайминг: видеокарта, установка, удаление" onClick={openAlignPanel}>⋯</button>
      {W.vpeaks && <span className="tseg" title="Волна по всему миксу или по вырезанному голосу"><button className={S.waveVoice ? '' : 'on'} onClick={() => { S.waveVoice = false; emit(); drawWave(); }}>микс</button><button className={S.waveVoice ? 'on' : ''} onClick={() => { S.waveVoice = true; emit(); drawWave(); }}>голос</button></span>}
      <span className="hint-line" id="guideTxt"><Guide /></span>
      <small id="dockMsg" className={S.toast.cls}>{S.toast.msg}</small><span className={'kbd' + (S.typing ? ' warn' : '')} id="kbd">{S.typing ? '⌨ клавиши выключены — кликни по волне' : ''}</span>
      <small className="stat" id="syncStat">{S.lines.length ? `синхронизировано строк: ${done}/${S.lines.length}` : ''}</small>
      <details className="menu">
        <summary className="btn sm" title="Настройки разметки">⚙</summary>
        <div className="pop">
          <label className="opt"><span>Реакция, мс<small>вычитается из момента нажатия</small></span><input type="number" id="lat" defaultValue={S.lat} step="10" min="0" max="500" onChange={e => { S.lat = +e.target.value || 0; ls.set('lat', e.target.value); }} /></label>
          <label className="opt"><span>Магнит <kbd>N</kbd><small>края прилипают при перетаскивании</small></span><input type="checkbox" id="snapChk" checked={S.snap} onChange={e => setSnap(e.target.checked)} /></label>
          <label className="opt"><span>…и к атакам звука<small>начала нот на волне (метки внизу волны)</small></span><input type="checkbox" id="onsetChk" checked={S.onsetSnap} onChange={e => { S.onsetSnap = e.target.checked; ls.set('onsetSnap', S.onsetSnap ? '1' : '0'); emit(); }} /></label>
          <label className="opt"><span>Строки сами по словам<small>начало и конец строки следуют за её размеченными словами</small></span><input type="checkbox" id="autoFitChk" checked={S.autoFit} onChange={e => setAutoFit(e.target.checked)} /></label>
          <div className="opt"><span>Запас строки, мс<small>до первого / после последнего слова; минус — короче слов</small></span><span className="row"><input type="number" id="padA" step="50" value={S.fitPad.a} onChange={e => setFitPad('a', +e.target.value || 0)} style={{ width: 70 }} /><input type="number" id="padB" step="50" value={S.fitPad.b} onChange={e => setFitPad('b', +e.target.value || 0)} style={{ width: 70 }} /></span></div>
          <div className="opt"><span>Сдвиг строк<small>со всеми словами; LRC от другой версии трека</small></span><span className="row"><input type="number" id="shiftMs" step="50" value={S.shiftMs} onChange={e => { S.shiftMs = +e.target.value || 0; emit(); }} style={{ width: 76 }} /><small>мс</small></span></div>
          <span className="row"><button className="sm" id="btnShiftAfter" title="Строки, начинающиеся после курсора воспроизведения" onClick={() => shiftLines(S.shiftMs)}>→ после курсора</button><button className="sm" id="btnShiftAll" onClick={() => shiftLines(S.shiftMs, true)}>→ вся песня</button></span>
          <button className={'sm' + (S.loop ? ' pri' : '')} id="btnLoop" title="L" onClick={() => setLoop(!S.loop)}>{S.loop ? '🔁 Кручу строку (L)' : '🔁 Крутить строку по кругу (L)'}</button>
          <span className="row"><button className="sm" id="btnZoomOut" title="Ctrl+колесо" onClick={() => zoomAt(width() / 2, 1 / 1.4)}>− зум</button><button className="sm" id="btnZoomIn" onClick={() => zoomAt(width() / 2, 1.4)}>+ зум</button><button className="sm" id="btnFit" onClick={centerOnSel}>⤢ вписать строку</button></span>
        </div>
      </details>
      <button className="sm" id="btnHelp" title="Как размечать" onClick={() => { S.help = !S.help; emit(); }}>?</button>
      <button className="sm" id="btnDockClose" title="Закрыть" onClick={() => toggleDock(false)}>✕</button>
    </div>
    {(S.align || S.setup) && <div className="runbar" title={S.align ? `Авто-тайминг: ${alignLabel()}${S.align.device ? ' · ' + (DEVICES[S.align.device] || S.align.device) : ''}` : 'Установка авто-тайминга: ' + setupLabel()}><i style={{ width: (S.align ? alignPct() : S.setup!.pct) + '%' }} /></div>}
    <canvas id="mini" ref={mini} title="Вся песня: клик/тяни — показать это место, 2× — играть отсюда. Зелёное — размечено, жёлтое — частично, розовое — отдельные бэки"></canvas>
    <canvas id="wave" ref={cv}></canvas>
    <div id="waveTip" className="wtip" hidden></div>
    <div className="sync-lines" id="syncLines"><Chips /></div>
    <div className="actions" id="wordBar">
      <span className="grp"><button className="sm ic" id="wbPrev" title="Предыдущее слово (A)" onClick={() => stepWord(-1)}>‹</button><button className="sm ic" id="wbNext" title="Следующее слово (D)" onClick={() => stepWord(1)}>›</button></span>
      <span className="grp marks">
        <button className="mk kf" id="wbF" title="Жми, когда певец НАЧАЛ слово" onClick={() => mark('F')}><kbd>F</kbd>Начало</button>
        <button className="mk kg" id="wbG" title="Жми, когда началось СЛЕДУЮЩЕЕ слово: текущее закроется, следующее откроется. Основная клавиша." onClick={() => mark('G')}><kbd>G</kbd>Следующее</button>
        <button className="mk kh" id="wbH" title="Жми в конце слова, только если дальше пауза / вдох / конец строки" onClick={() => mark('H')}><kbd>H</kbd>Конец</button>
      </span>
      <span className="grp">
        <button className="sm ic" id="wbBack" title="Сдвинуть слово −10 мс (,)" onClick={() => nudgeWord(-0.01)}>−10</button><button className="sm ic" id="wbFwd" title="Сдвинуть слово +10 мс (.)" onClick={() => nudgeWord(0.01)}>+10</button>
        <button className="sm ic" id="wbPlay" title="Проиграть слово (ПКМ по слову)" onClick={playSel}>▶</button>
        <button className="sm ic" id="wbReset" title="Сбросить слово (Del)" onClick={resetWord}>⌫</button>
      </span>
      <span className="grp voice"><small>голос</small>
        <button className="sm ic" data-agent="v1" title="Исполнитель 1 — слева (клавиша 1). Выдели строки слева: клик, Shift — диапазон, Ctrl — по одной" onClick={() => setAgent('v1')}>1</button>
        <button className="sm ic" data-agent="v2" title="Исполнитель 2 — справа (клавиша 2)" onClick={() => setAgent('v2')}>2</button>
        <button className="sm ic" data-agent="v1000" title="Вместе (клавиша 3)" onClick={() => setAgent('v1000')}>1+2</button>
      </span>
      <span className="grp">
        <button className="sm" id="btnJoin" title="Склеить со следующим (M): два слова → один блок, два слога → один" onClick={joinWords}>⛓ Склеить</button>
        <button className="sm" id="btnSplit" title="Разделить (U): обычное слово → слоги, склеенный блок → слова" onClick={splitWord}>✂ Слоги</button>
        <details className="menu up">
          <summary className="btn sm">Строка ⋯</summary>
          <div className="pop">
            <button className="sm" id="btnSylLine" onClick={syllabifyLine}>✂ Разбить строку на слоги</button>
            <button className="sm" id="btnCopyTiming" title="Ctrl+Shift+C — запомнить, как размечены слова этой строки" onClick={copyTiming}>⧉ Копировать тайминг строки</button>
            <button className="sm" id="btnPasteTiming" title="Ctrl+Shift+V — на выделенные строки (или строку выбранного слова); разное число слов — ритм растягивается" onClick={pasteTimingHere}>⧉ Вставить тайминг в строку</button>
            <button className="sm" id="btnChorus" title="C — та же разметка слов на все строки с таким же текстом (припев), со сдвигом по началу строки" onClick={repeatChorus}>⧉ Тайминг строки → на повторы (C)</button>
            <button className="sm" id="btnFitLine" title="Начало и конец строки = её размеченные слова (полоса строк под волной). Края строки можно и тянуть мышью." onClick={() => fitLines(S.sel?.i)}>⇔ Подогнать строку под слова</button>
            <button className="sm" id="btnFitAll" onClick={() => fitLines()}>⇔ Подогнать все строки под слова</button>
            <button className="sm" id="btnLineSpread" onClick={spreadSelLine}>↔ Раскидать слова строки ровно</button>
            <button className="sm" id="btnAllSpread" onClick={spreadAll}>↔ Раскидать все неразмеченные строки</button>
            <button className="sm" id="btnLineReset" onClick={resetLine}>⌫ Сбросить строку</button>
            <button className="sm danger" id="btnLayerClear" onClick={clearLayer}>🗑 Очистить весь слой</button>
          </div>
        </details>
      </span>
      <span className="grp"><button className="sm ic" id="wbUndo" title="Отменить (Ctrl+Z)" onClick={doUndo}>↶</button><button className="sm ic" id="wbRedo" title="Вернуть (Ctrl+Shift+Z)" onClick={doRedo}>↷</button></span>
      <span id="wordInfo">{wordInfo()}</span>
    </div>
  </div>;
}
