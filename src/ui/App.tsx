import { S, lineState, mainLayerFor, useS } from '../state.ts';
import { PAGES, setPage } from '../hotkeys.ts';
import { AudioCard, ExportCard, HistoryCard, LinesCard, Next, SearchCard, TextCard, TranslateCard } from './Cards.tsx';
import { Stage } from './Stage.tsx';
import { SyncDock } from './SyncDock.tsx';
import { HelpModal } from './HelpModal.tsx';
import { Drop } from './Drop.tsx';
import { Palette, openPalette } from './Palette.tsx';
import { AlignPanel } from './AlignPanel.tsx';
import { isApp, winClose, winMax, winMin } from '../desktop.ts';

export function stepInfo() {
  const n = S.lines.length, tr = S.lines.filter(l => l.tr && l.tr.trim()).length;
  let done = 0; S.lines.forEach((_, i) => { if (lineState(i, mainLayerFor(i)) === 'done') done++; });
  const st: [string, boolean][] = [['1 Текст', n > 0], ['2 Аудио', S.hasAudio], ['3 Перевод', n > 0 && tr === n], ['4 Синхра ' + (n ? done + '/' + n : ''), n > 0 && done === n], ['5 QA и экспорт', false]];
  const f = st.findIndex(x => !x[1]); return { st, cur: f < 0 ? 4 : f, n, tr, done };
}

/** tabs in the header: each shows how far that step is */
function Nav() {
  const { n, tr, done } = stepInfo(), errs = (S.qa || []).filter(x => x.sev === 'err').length;
  const badge: Record<string, [string, boolean]> = {
    track: [n ? (S.hasAudio ? '✓' : 'без ♪') : '', n > 0 && S.hasAudio],
    text: [n ? String(n) : '', false],
    tr: [n ? `${tr}/${n}` : '', n > 0 && tr === n],
    sync: [n ? `${done}/${n}` : '', n > 0 && done === n],
    export: [S.qa ? (errs ? '!' + errs : '✓') : '', !!S.qa && !errs],
  };
  return <nav className="nav" role="tablist">{PAGES.map(([id, label], k) => {
    const [b, ok] = badge[id];
    return <button key={id} role="tab" id={'nav-' + id} className={S.page === id ? 'on' : ''} title={`Alt+${k + 1}`} disabled={!n && id !== 'track'} onClick={() => setPage(id)}>
      <i>{k + 1}</i>{label}{id === 'text' && S.full?.dirty ? ' •' : ''}{b && <em className={ok ? 'ok' : ''}>{b}</em>}
    </button>;
  })}</nav>;
}

function Page() {
  switch (S.page) {
    case 'track': return <><SearchCard /><AudioCard />{S.lines.length > 0 && <Next to="text" label="Дальше: текст" />}<HistoryCard /></>;
    case 'text': return <><TextCard />{S.lines.length > 0 && <Next to="tr" label="Дальше: перевод" />}</>;
    case 'tr': return <><TranslateCard /><LinesCard /><Next to="sync" label="Дальше: синхра по словам" /></>;
    case 'sync': return <LinesCard />;
    case 'export': return <ExportCard />;
  }
}

export function App() {
  useS();
  return <>
    <header data-tauri-drag-region={isApp || undefined}>
      <div className="logo" data-tauri-drag-region={isApp || undefined}>S</div>
      <div className="brand" data-tauri-drag-region={isApp || undefined}><h1 data-tauri-drag-region={isApp || undefined}>Spicy Translate</h1><span data-tauri-drag-region={isApp || undefined}>синхронный перевод для Spicy Lyrics · TTML</span></div>
      <Nav />
      <div style={{ flex: 1, alignSelf: 'stretch' }} data-tauri-drag-region={isApp || undefined}></div>
      <button className="sm palbtn" id="btnPalette" title="Все действия с поиском" onClick={openPalette}>⌘ <kbd>Ctrl+K</kbd></button>
      <span className={'pill ' + (S.live?.cls || '')} id="liveLink" title="Связь с локальным сервером / MCP" hidden={!S.live}>{S.live?.msg}</span>
      <span className={'pill ' + S.save.cls} id="saveInd" title="Проект сохраняется автоматически в браузере">{S.save.msg}</span>
      {isApp && <WinButtons />}
    </header>
    <main className={'page-' + S.page}>
      <div className="col" key={S.page}><Page /></div>
      <div className="col"><Stage /></div>
    </main>
    <SyncDock />
    <HelpModal />
    <Palette />
    <AlignPanel />
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
