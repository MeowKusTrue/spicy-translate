// «Авто-тайминг» panel: the GPU that was found, which PyTorch build to install, install progress, cancel / remove.
import { S, emit } from '../state.ts';
import { DEVICES, cancelOrRemoveAlign, closeAlignPanel, installAlign, openFolder } from '../autoAlign.ts';

const GB = (b: number) => b >= 1e9 ? (b / 1e9).toFixed(2) + ' ГБ' : Math.round(b / 1e6) + ' МБ';
const OPTS: [string, string, string][] = [
  ['auto', 'Авто', 'по найденной видеокарте'],
  ['cuda', 'NVIDIA (CUDA)', '≈3 ГБ, быстро; RTX 50xx тоже'],
  ['xpu', 'Intel Arc (XPU)', '≈2.5 ГБ'],
  ['dml', 'AMD / другая (DirectML)', '≈1 ГБ; голос режется на процессоре'],
  ['cpu', 'Только процессор', '≈1 ГБ, медленнее в 5–10 раз'],
];

export function AlignPanel() {
  const p = S.alignPanel; if (!p) return null;
  const st = p.st, gpu = p.gpu, busy = !!st?.running;
  return <div className="modal" id="alignPanel" onMouseDown={e => { if ((e.target as Element).id === 'alignPanel' && !busy) closeAlignPanel(); }}>
    <div className="help apanel">
      <button className="sm ic close" title="Закрыть (установка продолжится)" onClick={closeAlignPanel}>✕</button>
      <h3>✨ Авто-тайминг</h3>
      <p>Нейросеть вырезает голос и расставляет слова оригинала и бэка — черновиком (пунктир), размеченное вручную не трогает. Ставится в папку приложения: свой Python, PyTorch и модели, система не меняется.</p>
      {p.err && <div className="aprog"><small className="aerr">{p.err}</small></div>}
      <div className="arow"><b>Видеокарта</b><span>{gpu ? <>{gpu.names.join(', ') || '—'}<small>{gpu.why}</small></> : 'определяю…'}</span></div>
      <div className="arow"><b>Состояние</b><span>{!st ? '…' : st.external ? 'используется Python-окружение разработчика (experiments/auto-align/.venv)'
        : st.installed ? <>установлен · {DEVICES[st.backend] || st.backend || '—'}{st.bytes ? ` · ${GB(st.bytes)}` : ''}</> : busy ? 'ставится…' : 'не установлен'}</span></div>
      {!st?.external && <>
        <div className="aopts">{OPTS.map(([v, t, h]) => <label key={v} className={p.pick === v ? 'on' : ''}>
          <input type="radio" name="abk" checked={p.pick === v} disabled={busy} onChange={() => { p.pick = v; emit(); }} />
          <span><b>{t}{v === 'auto' && gpu ? ` → ${DEVICES[gpu.backend] || gpu.backend}` : ''}</b><small>{h}</small></span>
        </label>)}</div>
        {busy || st?.error ? <div className="aprog">
          <div className="abar"><i style={{ width: (st?.pct || 0) + '%' }} /></div>
          <div className="astep"><b>{st?.step || 'старт'}</b><span>{st?.pct || 0}%</span></div>
          {st?.file && <small className="afile">{st.file}{st.size ? ` — ${GB(st.got)} из ${GB(st.size)}` : ''}</small>}
          {st?.error ? <small className="aerr">{st.error}</small> : st?.last && <small className="alog">{st.last}</small>}
        </div> : null}
        <div className="row" style={{ marginTop: 14, flexWrap: 'wrap' }}>
          {busy ? <button className="danger" id="btnAlignCancel" onClick={cancelOrRemoveAlign}>Отменить установку</button>
            : st?.installed ? <>
              <button id="btnAlignReinstall" title="Удалит текущий Python и поставит под выбранную видеокарту" onClick={() => installAlign(true)}>Переустановить под выбранное</button>
              <button className="danger" id="btnAlignRemove" onClick={cancelOrRemoveAlign}>Удалить{st.bytes ? ` (${GB(st.bytes)})` : ''}</button>
            </> : <button className="pri" id="btnAlignInstall" onClick={() => installAlign(false)}>Установить</button>}
          <button onClick={() => openFolder('python')}>📂 Открыть папку</button>
        </div>
        <p className="hint">Плюс ~1.5 ГБ моделей скачается при первом запуске. Установка идёт в фоне — окно можно закрыть, прогресс виден на кнопке «Авто-тайминг».</p>
      </>}
    </div>
  </div>;
}
