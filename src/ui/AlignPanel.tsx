// «Авто-тайминг» panel: the GPU that was found, which PyTorch build to install, install progress, cancel / remove.
import { S, emit } from '../state.ts';
import { DEVICES, acceptBacking, cancelOrRemoveAlign, closeAlignPanel, installAlign, modelOptions, openFolder, setModelOptions } from '../autoAlign.ts';
import { fmtTime, recommendedModels } from '../core/index.ts';
import { pause, playWord } from '../audio.ts';
import { useEffect } from 'react';

function useDialogFocus(id: string, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const box = document.getElementById(id), previous = document.activeElement as HTMLElement | null;
    box?.querySelector<HTMLElement>('button')?.focus();
    const keys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key !== 'Tab' || !box) return;
      const all = [...box.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]')].filter(x => x.getClientRects().length);
      const first = all[0], last = all.at(-1); if (!first) return;
      if (e.shiftKey && (document.activeElement === first || !box.contains(document.activeElement))) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !box.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keys, true);
    return () => { document.removeEventListener('keydown', keys, true); previous?.focus({ preventScroll: true }); };
  }, [id, open, close]);
}

const GB = (b: number) => b >= 1e9 ? (b / 1e9).toFixed(2) + ' ГБ' : Math.round(b / 1e6) + ' МБ';
const OPTS: [string, string, string][] = [
  ['auto', 'Авто', 'по найденной видеокарте'],
  ['cuda', 'NVIDIA (CUDA)', '≈3 ГБ, быстро; RTX 50xx тоже'],
  ['xpu', 'Intel Arc (XPU)', '≈2.5 ГБ'],
  ['dml', 'AMD / другая (DirectML)', '≈1 ГБ; голос режется на процессоре'],
  ['cpu', 'Только процессор', '≈1 ГБ, обработка дольше'],
];

export function AlignPanel() {
  useDialogFocus('alignPanel', !!S.alignPanel, closeAlignPanel);
  const p = S.alignPanel; if (!p) return null;
  const st = p.st, gpu = p.gpu, busy = !!st?.running;
  const backend = p.pick === 'auto' ? gpu?.backend || '' : p.pick;
  const rec = recommendedModels(backend, S.meta.lang);
  return <div className="modal" id="alignPanel" role="dialog" aria-modal="true" aria-labelledby="alignPanelTitle" onMouseDown={e => { if ((e.target as Element).id === 'alignPanel' && !busy) closeAlignPanel(); }}>
    <div className="help apanel">
      <button className="sm ic close" title="Закрыть (установка продолжится)" onClick={closeAlignPanel}>✕</button>
      <h3 id="alignPanelTitle">Автоматизация</h3>
      <p>Нейросеть вырезает голос и расставляет слова оригинала и бэка — черновиком (пунктир), размеченное вручную не трогает. Ставится в папку приложения: свой Python, PyTorch и модели, система не меняется.</p>
      <fieldset disabled={!!S.align}>
        <div className="align-presets" role="group" aria-label="Набор моделей">
          <button id="alignBalanced" className={!modelOptions.detectBack && modelOptions.asr === 'turbo' ? 'on' : ''} onClick={() => setModelOptions({ ...rec, sep: 'htdemucs', detectBack: false })}><b>Сбалансированный</b><small>Текст уже есть. Начни с таймингов основы.</small></button>
          <button id="alignBackingPreset" className={modelOptions.detectBack ? 'on' : ''} onClick={() => setModelOptions({ ...rec, asr: 'large-v3', detectBack: true })}><b>Вокал и бэки</b><small>Поиск дополнительных фраз с прослушиванием перед импортом.</small></button>
          <button id="alignLightPreset" onClick={() => { setModelOptions({ sep: 'htdemucs', asr: 'turbo', aligner: 'w2v', detectBack: false }); p.pick = 'cpu'; emit(); }}><b>Без мощной видеокарты</b><small>Лёгкий набор на процессоре. Обработка будет дольше.</small></button>
        </div>
        <legend>Модели следующего запуска</legend>
        <div className="aprog" id="alignRecommendation">
          <b>С чего начать</b>
          <p>{backend ? `Для ${DEVICES[backend] || backend}: ${rec.sep === 'roformer' ? 'MelBand-RoFormer' : 'HTDemucs'} + Whisper Turbo + ${rec.aligner === 'w2v' ? 'wav2vec2' : 'MMS-FA'}.` : 'Определяю оборудование — затем предложу стартовый набор.'} Это начальные настройки, качество проверь на слух.</p>
          <button className="sm" id="btnAlignRecommended" disabled={!backend} onClick={() => setModelOptions(rec)}>Выбрать стартовый набор</button>
        </div>
        <details className="align-advanced" id="alignAdvanced"><summary>Настроить модели вручную</summary>
        <label className="fld">Выделение вокала<select id="alignSeparator" aria-describedby="alignSepHint" value={modelOptions.sep} onChange={e => setModelOptions({ sep: e.target.value as typeof modelOptions.sep })}><option value="htdemucs">HTDemucs</option><option value="roformer">MelBand-RoFormer</option></select></label>
        <p className="hint" id="alignSepHint">{modelOptions.sep === 'roformer' ? 'Попробуй на NVIDIA, если инструменты мешают слышать слова. Сравни с HTDemucs; на процессоре обработка может быть долгой.' : 'Начни с него на процессоре, AMD или Intel. Выделяет весь вокал; для поиска бэков дополнительно включи опцию ниже.'}</p>
        <label className="fld">Распознавание текста и новых бэков<select id="alignAsr" aria-describedby="alignAsrHint" value={modelOptions.asr} onChange={e => setModelOptions({ asr: e.target.value as typeof modelOptions.asr })}><option value="turbo">Whisper large-v3-turbo — быстрее</option><option value="large-v3">Whisper large-v3 — полная модель, медленнее</option></select></label>
        <p className="hint" id="alignAsrHint">{modelOptions.asr === 'turbo' ? 'Первый выбор для быстрого черновика и поиска бэков. Если пропускает слова — сравни с полной large-v3.' : 'Попробуй, если Turbo ошибается в словах. Требует больше памяти и времени; при нехватке памяти верни Turbo.'} На тайминги уже введённого текста этот выбор не влияет.</p>
        {gpu?.memoryTotal != null && <p className="hint" id="alignMemory">Память NVIDIA: {(gpu.memoryTotal / 1024).toFixed(1)} ГБ всего, {((gpu.memoryFree || 0) / 1024).toFixed(1)} ГБ свободно на момент проверки. Свободная память меняется; это не гарантия, что модель поместится.</p>}
        <label className="fld">Тайминги известного текста<select id="alignModel" aria-describedby="alignTimingHint" value={modelOptions.aligner} onChange={e => setModelOptions({ aligner: e.target.value as typeof modelOptions.aligner })}><option value="w2v">wav2vec2 — русский / английский</option><option value="mms">MMS-FA — многоязычный</option></select></label>
        <p className="hint" id="alignTimingHint">{modelOptions.aligner === 'w2v' ? 'Начни с него для русского или английского текста. Если тайминги съезжают, сравни ту же строку с MMS-FA.' : 'Попробуй для других языков или как альтернативу при неточных таймингах. Для русско-английского текста сравни с wav2vec2.'} Расставляет известные слова, новые слова не распознаёт.</p>
        <label className="row"><input id="alignDetectBack" type="checkbox" checked={modelOptions.detectBack} onChange={e => setModelOptions({ detectBack: e.target.checked })} />Искать новые бэки по аудио</label>
        <p className="hint">Включи, если нужны новые ад-либы и фоновые фразы. Выключи, если нужны только тайминги готового текста: обработка будет короче. Найденные бэки сначала откроются для прослушивания и выбора; существующие бэки размечаются и без поиска новых. Модели скачиваются при первом запуске.</p>
        </details>
      </fieldset>
      {p.err && <div className="aprog"><small className="aerr">{p.err}</small></div>}
      <div className="arow"><b>Видеокарта</b><span>{gpu ? <>{gpu.names.join(', ') || '—'}<small>{gpu.why}</small></> : 'определяю…'}</span></div>
      <div className="arow"><b>Состояние</b><span>{!st ? '…' : st.external ? 'используется Python-окружение разработчика (experiments/auto-align/.venv)'
        : st.installed ? <>установлен · {DEVICES[st.backend] || st.backend || '—'}{st.bytes ? ` · ${GB(st.bytes)}` : ''}</> : busy ? 'ставится…' : 'не установлен'}</span></div>
      {!st?.external && <>
        <details className="align-hardware"><summary>Оборудование и переустановка</summary><div className="aopts">{OPTS.map(([v, t, h]) => <label key={v} className={p.pick === v ? 'on' : ''}>
          <input type="radio" name="abk" checked={p.pick === v} disabled={busy} onChange={() => { p.pick = v; emit(); }} />
          <span><b>{t}{v === 'auto' && gpu ? ` → ${DEVICES[gpu.backend] || gpu.backend}` : ''}</b><small>{h}</small></span>
        </label>)}</div></details>
        <div className="align-install">{busy || st?.error ? <div className="aprog">
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
        </div><p className="hint">Плюс ~1.5 ГБ моделей скачается при первом запуске. Установка идёт в фоне — окно можно закрыть, прогресс виден на кнопке «Авто-тайминг».</p>
      </>}
    </div>
  </div>;
}

export function BackingReview() {
  const r = S.backingReview; if (!r) return null;
  return <div className="modal" id="backingReview" role="dialog" aria-modal="true" aria-labelledby="backingTitle"><div className="help apanel">
    <h3 id="backingTitle">Найденные бэки — проверь на слух</h3>
    <p>Ничего из этого списка ещё не добавлено. Выбери нужные фразы: они появятся отдельными бэк-строками. Существующий текст и бэки сохранятся; Ctrl+Z отменит добавление.</p>
    {r.candidates.map((c, i) => <div className="row" key={i}><label className="row"><input type="checkbox" checked={r.picked.has(i)} onChange={e => { if (e.target.checked) r.picked.add(i); else r.picked.delete(i); emit(); }} /><span><small>{fmtTime(c.t)}–{fmtTime(c.end)}</small> {c.bg?.text}</span></label><button className="sm" onClick={() => playWord({ a: c.t, b: c.end })}>Слушать</button></div>)}
    <div className="row"><button className="sm" onClick={pause}>Стоп</button><button className="pri" id="btnBackingApply" disabled={!r.picked.size} onClick={acceptBacking}>Добавить выбранные ({r.picked.size})</button><button id="btnBackingCancel" onClick={() => { pause(); S.backingReview = null; emit(); }}>Закрыть без добавления</button></div>
  </div></div>;
}
