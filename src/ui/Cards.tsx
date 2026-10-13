// Left column: 1 search/load, 2 translation + line editor, 3 export + QA.
import { mmss, wordList } from '../core/index.ts';
import { S, emit, lineState, mainLayerFor, status } from '../state.ts';
import { seekTo } from '../audio.ts';
import { buildPreview } from '../preview.ts';
import { loadProject, scheduleSave } from '../persist.ts';
import { loadManual, loadTrack, search, setMode } from '../load.ts';
import { selectWord } from '../sync.ts';
import { LANGS, applyPaste, autoTranslate, clearTr, copyPrompt, llmTranslate } from '../translate.ts';
import { copyTTML, download, gotoQa, runQa, saveLRC, saveProjectFile, saveSRT, toggleCode } from '../exporting.ts';
import { drawWave } from '../waveform/wave.ts';

const set = (f: () => void) => { f(); emit(); };
const St = ({ id, m }: { id: string; m: { msg: string; cls: string } }) => <div className={'status ' + m.cls} id={id}>{m.msg}</div>;

export function SearchCard() {
  return <section className="card">
    <h2><b>1</b> Найти трек и тайминги</h2>
    <div className="row">
      <input type="text" id="q" placeholder="Исполнитель — название (например: Eminem Lose Yourself)" value={S.q}
        onChange={e => set(() => S.q = e.target.value)} onKeyDown={e => { if (e.key === 'Enter') search(); }} />
      <button className="pri" id="btnSearch" onClick={search}>Найти</button>
    </div>
    <div className="res" id="results">{S.results.slice(0, 25).map(d => {
      const synced = !!d.syncedLyrics;
      return <div className="item" key={d.id} onClick={() => loadTrack(d)}>
        <div><b>{d.trackName}</b><small>{`${d.artistName} · ${d.albumName || '—'} · ${mmss(d.duration || 0)}`}</small></div>
        <span className={'tag ' + (synced ? 'ok' : '')}>{synced ? 'synced' : 'plain'}</span>
      </div>;
    })}</div>
    <p className="hint">Источник синхро-текста — <a href="https://lrclib.net" target="_blank" rel="noreferrer">LRCLIB</a> (открытая база, без ключей). Если нужного трека нет — вставь свой LRC ниже.</p>
    <details style={{ marginTop: 10 }}>
      <summary style={{ cursor: 'pointer', color: 'var(--mut)', fontSize: 13 }}>Вставить LRC / текст вручную</summary>
      <textarea id="manual" placeholder={'[00:12.30] первая строка\n[00:15.80] вторая строка'} value={S.manual} onChange={e => set(() => S.manual = e.target.value)} />
      <div className="row" style={{ marginTop: 8 }}>
        <button id="btnManual" onClick={() => loadManual(S.manual)}>Загрузить из поля</button>
        <label className="btn">Файл .lrc / .txt<input type="file" id="fileLrc" accept=".lrc,.txt" hidden
          onChange={async e => { const f = e.target.files?.[0]; if (f) { const t = await f.text(); S.manual = t; loadManual(t); } }} /></label>
      </div>
    </details>
    <div className="grid2" style={{ marginTop: 12 }}>
      <input type="text" id="mTitle" placeholder="Название" value={S.meta.title} onChange={e => set(() => S.meta.title = e.target.value)} />
      <input type="text" id="mArtist" placeholder="Исполнитель" value={S.meta.artist} onChange={e => set(() => S.meta.artist = e.target.value)} />
    </div>
    <St id="st1" m={S.st1} />
  </section>;
}

function LineRow({ i }: { i: number }) {
  const l = S.lines[i];
  return <div className="ln" id={'ln' + i}>
    <div className="t" onClick={() => { seekTo(l.t); selectWord(i, 0); }}>
      {mmss(l.t) + '.' + String(Math.floor((l.t % 1) * 10))}
      {lineState(i, mainLayerFor(i)) === 'done' && <i className="sd" title="слова синхронизированы" />}
    </div>
    <div>
      <div className="o">{l.text}</div>
      <input type="text" placeholder="перевод…" value={l.tr || ''} onChange={e => {
        l.tr = e.target.value;
        if (l.sync && l.sync.tr && l.sync.tr.length !== wordList(l.tr).length) delete l.sync.tr; // text changed -> old word timings no longer fit
        buildPreview(true); emit(); drawWave(); scheduleSave();
      }} />
    </div>
  </div>;
}

export function TranslateCard() {
  const llm = (k: keyof typeof S.llm) => ({ value: S.llm[k], onChange: (e: { target: { value: string } }) => set(() => S.llm[k] = e.target.value) });
  return <section className="card">
    <h2><b>2</b> Перевод</h2>
    <div className="grid2">
      <select id="lang" value={S.meta.lang} onChange={e => set(() => S.meta.lang = e.target.value)}>
        {LANGS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
      <button className="pri" id="btnAuto" disabled={S.busyAuto} onClick={autoTranslate}>Автоперевод (Google)</button>
    </div>
    <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
      <button id="btnPrompt" title="Скопирует промпт со строками — вставь в Claude/ChatGPT для художественного перевода" onClick={copyPrompt}>Промпт для LLM</button>
      <button id="btnPaste" onClick={() => { set(() => S.paste = S.paste ?? ''); setTimeout(() => document.getElementById('pasteTa')?.focus()); }}>Вставить перевод списком</button>
      <button id="btnClear" onClick={clearTr}>Очистить</button>
    </div>
    <details className="llm" id="llmBox">
      <summary>🤖 Перевод через LLM (с контекстом всей песни)</summary>
      <div className="grid2">
        <select id="llmProv" {...llm('prov')}><option value="openai">OpenAI-совместимый (OpenRouter, Ollama, LM Studio…)</option><option value="anthropic">Anthropic (Claude)</option></select>
        <input type="text" id="llmModel" placeholder="модель, напр. claude-sonnet-5-5" {...llm('model')} />
      </div>
      <div className="grid2">
        <input type="text" id="llmUrl" placeholder="Base URL (openai: https://openrouter.ai/api/v1)" {...llm('url')} />
        <input type="text" id="llmKey" placeholder="API-ключ (хранится только в этом браузере)" {...llm('key')} />
      </div>
      <textarea id="llmStyle" style={{ minHeight: 60, marginTop: 8 }} placeholder="Стиль и глоссарий: «разговорный, мат оставляй», «gaslighter = газлайтер», имена не переводить…" {...llm('style')} />
      <div className="row" style={{ marginTop: 8 }}><button className="pri" id="btnLlm" disabled={S.busyLlm} onClick={llmTranslate}>Перевести через LLM</button><small className="hint" style={{ margin: 0 }}>Ключ уходит напрямую провайдеру. Нет ключа — используй «Промпт для LLM».</small></div>
    </details>
    <div id="pasteBox" hidden={S.paste == null} style={{ marginTop: 10 }}>
      <textarea id="pasteTa" placeholder="Вставь сюда готовый перевод — по одной строке на строку оригинала (нумерация «1.» тоже ок)" value={S.paste || ''} onChange={e => set(() => S.paste = e.target.value)} />
      <div className="row" style={{ marginTop: 8 }}><button className="pri" id="btnPasteApply" onClick={applyPaste}>Применить</button><button id="btnPasteCancel" onClick={() => set(() => S.paste = null)}>Отмена</button></div>
    </div>
    <St id="st2" m={S.st2} />
    <div className="lines" id="lines" style={{ marginTop: 10 }}>{S.lines.map((_, i) => <LineRow key={i} i={i} />)}</div>
  </section>;
}

export function ExportCard() {
  const bi = S.meta.mode === 'bilingual', qa = S.qa, errs = qa ? qa.filter(x => x.sev === 'err').length : 0;
  return <section className="card">
    <h2><b>3</b> Экспорт TTML</h2>
    <div className="seg">
      <label><input type="radio" name="mode" value="translation" checked={!bi} onChange={() => setMode('translation')} /><span>Только перевод</span></label>
      <label><input type="radio" name="mode" value="bilingual" checked={bi} onChange={() => setMode('bilingual')} /><span>Оригинал + перевод</span></label>
    </div>
    <p className="hint" id="modeHint">{bi
      ? 'Экспериментально: оригинал — основная строка, перевод — мелким фоновым вокалом под ней. Пословный режим включается сам; слои синхронизируются отдельно (переключатель в панели синхры).'
      : 'Переведённый текст становится основной лирикой — самый безопасный вариант для Spicy Lyrics.'}</p>
    <label className="chk"><input type="checkbox" id="spread" checked={S.exp.spread} disabled={bi} onChange={e => set(() => S.exp.spread = e.target.checked)} /><span>Пословная подсветка (караоке)<small>Слова равномерно размазываются по длительности строки. Тайминг приблизительный, но выглядит живо.</small></span></label>
    <div className="grid2">
      <div><small style={{ color: 'var(--mut)' }}>Сдвиг, мс</small><input type="number" id="offset" step="50" value={S.exp.offset} onChange={e => set(() => S.exp.offset = e.target.value)} /></div>
      <div><small style={{ color: 'var(--mut)' }}>Авторы текста (через запятую)</small><input type="text" id="writers" placeholder="необязательно" value={S.exp.writers} onChange={e => set(() => S.exp.writers = e.target.value)} /></div>
    </div>
    <div className="row" style={{ marginTop: 12 }}>
      <button className="pri" id="btnDl" onClick={download}>Скачать .ttml</button>
      <button id="btnCopy" onClick={copyTTML}>Копировать</button>
      <button id="btnShow" onClick={toggleCode}>{S.out == null ? 'Показать код' : 'Скрыть код'}</button>
    </div>
    <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
      <button className="sm" id="btnLrc" onClick={saveLRC}>LRC</button><button className="sm" id="btnSrt" onClick={saveSRT}>SRT (субтитры)</button>
      <button className="sm" id="btnProjSave" onClick={saveProjectFile}>Сохранить проект</button>
      <label className="btn sm" style={{ padding: '6px 10px', fontSize: 12.5 }}>Открыть проект<input type="file" id="fileProj" accept=".json" hidden
        onChange={async e => { const f = e.target.files?.[0]; if (!f) return; try { loadProject(await f.text()); } catch (err) { status('st1', 'Не открылось: ' + (err as Error).message, 'err'); } }} /></label>
    </div>
    <div className="row" style={{ marginTop: 8 }}><button className="sm" id="btnQa" title="Проверка перед экспортом: пустые, перекрытия, слишком короткие слова…" onClick={runQa}>✔ Проверка (QA)</button>
      <small className="hint" id="qaSum" style={{ margin: 0 }}>{qa && S.lines.length ? (qa.length ? `ошибок: ${errs}, замечаний: ${qa.length - errs}` : 'всё чисто ✓') : ''}</small></div>
    <div className="qa" id="qaOut">{(qa || []).slice(0, 80).map((x, k) => <div key={k} className={x.sev} onClick={() => gotoQa(x.i)}>{`строка ${x.i + 1}: ${x.msg}`}</div>)}</div>
    <pre className="out" id="out" hidden={S.out == null}>{S.out}</pre>
    <ol className="steps" style={{ marginTop: 14 }}>
      <li>Открой песню в Spotify со Spicy Lyrics, нажми <b>Lyrics Manager</b>.</li>
      <li><b>Upload TTML</b> → выбери файл → <b>Persistent Upload</b> (останется в локальной библиотеке).</li>
      <li>Если не обновилось — очисти кэш Spicy Lyrics и открой трек заново.</li>
    </ol>
  </section>;
}
