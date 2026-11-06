import { S, useS } from '../state.ts';
import { PAGES, setPage } from '../hotkeys.ts';
import { MetaModal } from './MetaModal.tsx';
import { AudioCard, ExportCard, HistoryCard, LinesCard, Next, SearchCard, TextCard, TranslateCard } from './Cards.tsx';
import { Stage } from './Stage.tsx';
import { SyncDock } from './SyncDock.tsx';
import { HelpModal } from './HelpModal.tsx';
import { Drop } from './Drop.tsx';
import { Palette, openPalette } from './Palette.tsx';
import { AlignPanel, BackingReview } from './AlignPanel.tsx';
import { isApp, winClose, winMax, winMin } from '../desktop.ts';
import { stopLine } from '../core/index.ts';
import { ModePicker } from './Studio.tsx';
import { WordInspector, inspectorOpen } from './WordInspector.tsx';
import { doRedo, doUndo } from '../sync.ts';
import { openAlignPanel } from '../autoAlign.ts';

export function stepInfo() {
  const n = S.lines.length, tr = S.lines.filter(l => l.tr && l.tr.trim()).length;
  const done = stopLine(S.lines, S.meta.mode).done;
  const st: [string, boolean][] = [['1 Текст', n > 0], ['2 Аудио', S.hasAudio], ['3 Перевод', S.meta.mode === 'original' || n > 0 && tr === n], ['4 Синхра ' + (n ? done + '/' + n : ''), n > 0 && done === n], ['5 QA и экспорт', false]];
  const f = st.findIndex(x => !x[1]); return { st, cur: f < 0 ? 4 : f, n, tr, done };
}

/** tabs in the header: each shows how far that step is */
function Nav() {
  const { n, tr, done } = stepInfo(), errs = (S.qa || []).filter(x => x.sev === 'err').length;
  const badge: Record<string, [string, boolean]> = {
    track: [n ? (S.hasAudio ? '✓' : 'без ♪') : '', n > 0 && S.hasAudio],
    text: [n ? String(n) : '', false],
    tr: [S.meta.mode === 'original' ? 'не требуется' : n ? `${tr}/${n}` : '', S.meta.mode === 'original' || n > 0 && tr === n],
    sync: [n ? `${done}/${n}` : '', n > 0 && done === n],
    export: [S.qa ? (errs ? '!' + errs : '✓') : '', !!S.qa && !errs],
  };
  return <nav className="nav" role="tablist">{PAGES.map(([id, label], k) => {
    const [b, ok] = badge[id];
    return <button key={id} role="tab" aria-selected={S.page === id} id={'nav-' + id} className={S.page === id ? 'on' : ''} title={`Alt+${k + 1}`} disabled={!n && id !== 'track'} onClick={() => setPage(id)}>
      <i>{k + 1}</i>{label}{id === 'text' && S.full?.dirty ? ' •' : ''}{b && <em className={ok ? 'ok' : ''}>{b}</em>}
    </button>;
  })}</nav>;
}

function Page() {
  switch (S.page) {
    case 'track': return <><SearchCard /><AudioCard />{S.lines.length > 0 && <Next to="text" label="Дальше: текст" />}<HistoryCard /></>;
    case 'text': return <><TextCard />{S.lines.length > 0 && <Next to={S.meta.mode === 'original' ? 'sync' : 'tr'} label={S.meta.mode === 'original' ? 'Дальше: редактор слов' : 'Дальше: перевод'} />}</>;
    case 'tr': return <><TranslateCard /><LinesCard /><Next to="sync" label="Дальше: синхра по словам" /></>;
    case 'sync': return <LinesCard />;
    case 'export': return <ExportCard />;
  }
}

export function App() {
  useS();
  return <>
    <header className="studio-header" data-tauri-drag-region={isApp || undefined}>
      <div className="logo" data-tauri-drag-region={isApp || undefined}>S</div>
      <div className="brand" data-tauri-drag-region={isApp || undefined}><h1 data-tauri-drag-region={isApp || undefined}>Spicy Translate</h1><span data-tauri-drag-region={isApp || undefined}>синхронный перевод для Spicy Lyrics · TTML</span></div>
      <div className="studio-track"><b>{S.meta.title || 'Новый проект'}</b><small>{S.meta.artist || 'Загрузи текст и аудио, чтобы начать'}</small></div>
      <div style={{ flex: 1, alignSelf: 'stretch' }} data-tauri-drag-region={isApp || undefined}></div>
      <button className="sm palbtn" id="btnPalette" title="Все действия с поиском" onClick={openPalette}>⌘ <kbd>Ctrl+K</kbd></button>
      <span className={'pill ' + (S.live?.cls || '')} id="liveLink" title="Связь с локальным сервером / MCP" hidden={!S.live}>{S.live?.msg}</span>
      <span className={'pill ' + S.save.cls} id="saveInd" title="Проект сохраняется автоматически в браузере">{S.save.msg}</span>
      <button className="sm studio-undo" aria-label="Отменить" title="Ctrl+Z" disabled={!S.undo.length} onClick={doUndo}>↶</button><button className="sm studio-undo" aria-label="Повторить" title="Ctrl+Shift+Z" disabled={!S.redo.length} onClick={doRedo}>↷</button>
      <button className="pri sm" id="btnStudioExport" disabled={!S.lines.length} onClick={() => setPage('export')}>Экспорт TTML</button>
      {isApp && <WinButtons />}
    </header>
    <div className="studio-nav"><Nav /><button className="sm" id="btnStudioModels" onClick={openAlignPanel}>Автоматизация</button><div className="studio-mode"><small>Задача проекта</small><ModePicker /></div></div>
    <main className={'page-' + S.page + (S.page === 'sync' && inspectorOpen() && !document.body.classList.contains('editor-focus') ? ' studio-inspecting' : '')}>
      <div className="col" key={S.page}><Page /></div>
      <div className="col"><Stage /></div>
      {S.page === 'sync' && inspectorOpen() && !document.body.classList.contains('editor-focus') && <WordInspector />}
    </main>
    <SyncDock />
    <HelpModal />
    <MetaModal />
    <Palette />
    <AlignPanel />
    <BackingReview />
    <Drop />
  </>;
}

/** the desktop app has no system frame: minimize / maximize / close live in our title bar */
function WinButtons() {
  const ico = (d: string) => <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d={d} fill="none" stroke="currentColor" strokeWidth="1" /></svg>;
  return <div className="winctl">
    <button title="Свернуть" onClick={winMin}>{ico('M0 5.5h10')}</button>
    <button title={S.maxed ? 'Восстановить' : 'Развернуть'} onClick={winMax}>{S.maxed ? ico('M2.5 .5h7v7M.5 2.5h7v7h-7z') : ico('M.5 .5h9v9h-9z')}</button>
    <button className="x" title="Закрыть" onClick={winClose}>{ico('M0 0l10 10M10 0L0 10')}</button>
  </div>;
}
