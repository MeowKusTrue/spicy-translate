import { S, lineState, mainLayerFor, useS } from '../state.ts';
import { toggleDock } from '../hotkeys.ts';
import { ExportCard, SearchCard, TranslateCard } from './Cards.tsx';
import { Stage } from './Stage.tsx';
import { SyncDock } from './SyncDock.tsx';
import { HelpModal } from './HelpModal.tsx';
import { Drop } from './Drop.tsx';

export function stepInfo() {
  const n = S.lines.length, tr = S.lines.filter(l => l.tr && l.tr.trim()).length;
  let done = 0; S.lines.forEach((_, i) => { if (lineState(i, mainLayerFor(i)) === 'done') done++; });
  const st: [string, boolean][] = [['1 Текст', n > 0], ['2 Аудио', S.hasAudio], ['3 Перевод', n > 0 && tr === n], ['4 Синхра ' + (n ? done + '/' + n : ''), n > 0 && done === n], ['5 QA и экспорт', false]];
  const f = st.findIndex(x => !x[1]); return { st, cur: f < 0 ? 4 : f, n, tr, done };
}

function Stepper() {
  const { st, cur } = stepInfo();
  return <div className="stepper" id="stepper">{st.map((x, k) => <span key={k} className={x[1] ? 'ok' : k === cur ? 'cur' : ''}>{(x[1] ? '✓ ' : '') + x[0]}</span>)}</div>;
}

export function App() {
  useS();
  return <>
    <header>
      <div className="logo">S</div>
      <div><h1>Spicy Translate</h1><span>синхронный перевод для Spicy Lyrics · TTML</span></div>
      <div style={{ flex: 1 }}></div>
      <span className={'pill ' + (S.live?.cls || '')} id="liveLink" title="Связь с локальным сервером / MCP" hidden={!S.live}>{S.live?.msg}</span>
      <span className={'pill ' + S.save.cls} id="saveInd" title="Проект сохраняется автоматически в браузере">{S.save.msg}</span>
      <button className="pri" id="btnDock" title="Пословная синхронизация с волной и хоткеями" onClick={() => toggleDock()}>Синхра по словам</button>
    </header>
    <main>
      <div className="col">
        <Stepper />
        <SearchCard />
        <TranslateCard />
        <ExportCard />
      </div>
      <div className="col"><Stage /></div>
    </main>
    <SyncDock />
    <HelpModal />
    <Drop />
  </>;
}
