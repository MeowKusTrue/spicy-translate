// Left column: 1 search/load, 2 translation + line editor, 3 export + QA.
import { mmss, plainW, stopLine, wordList } from '../core/index.ts';
import { S, doubtful, emit, lineState, mainLayerFor, status } from '../state.ts';
import { seekTo } from '../audio.ts';
import { buildPreview } from '../preview.ts';
import { idbPut, listSnaps, loadProject, restoreSnap, scheduleSave, snapshot, trackKey, type Snap } from '../persist.ts';
import { loadManual, loadTrack, openLyricsFile, search, setMode } from '../load.ts';
import { selectWord } from '../sync.ts';
import { LANGS, applyPaste, autoTranslate, clearTr, copyPrompt, llmTranslate } from '../translate.ts';
import { copyTTML, download, gotoQa, runQa, saveLRC, saveProjectFile, saveSRT, toggleCode } from '../exporting.ts';
import { drawWave } from '../waveform/wave.ts';
import { agentOf, cycleAgent, pickLine } from '../agents.ts';
import { Fragment, useEffect, useRef, useState, type CSSProperties } from 'react';
import { secPick } from '../waveform/edit.ts';
import { secColor } from '../waveform/wave.ts';
import { addBg, addBgHere, addLineAfter, addLineHere, applyFull, bracketsToBg, delBg, delLine, editText, fillRepeats, findOpts, focusLine, fullRows, replaceEverywhere, resetFull } from '../lineEdit.ts';
import { setPage } from '../hotkeys.ts';
import { META_KEYS, openMeta } from './MetaModal.tsx';
/** «✍ Автор: A, B · 💿 Album» for the export card */
const metaSummary = () => S.meta.md.map(m => { const v = m.value.filter(x => x.trim()); const d = META_KEYS.find(k => k[0] === m.key); return v.length ? (d ? d[2] : m.key + ':') + ' ' + v.join(', ') : ''; }).filter(Boolean).join(' · ');
import { openFolder } from '../autoAlign.ts';
import { loadAudioFile } from '../load.ts';
import { W } from '../waveform/wave.ts';
import type { Page } from '../state.ts';
import { findAll } from '../core/index.ts';
import { folderSupported, openProjectFolder, pickFolder, saveToFolder, unlinkFolder } from '../folder.ts';
import { acceptDiff, geniusDiff, geniusPick, geniusQuery, geniusSearch, geniusToText, ignoreDiff } from '../genius.ts';

const set = (f: () => void) => { f(); emit(); };
/** the audio is cached in IndexedDB under «artist - title»: after renaming, keep it under the new name too */
const rekeyAudio = () => { if (S.audioBlob) idbPut(trackKey(), S.audioBlob); };
const St = ({ id, m }: { id: string; m: { msg: string; cls: string } }) => <div className={'status ' + m.cls} id={id}>{m.msg}</div>;

export function SearchCard() {
  return <section className="card">
    <h2>Найти трек и тайминги</h2>
    <div className="row">
      <input type="text" id="q" placeholder="Исполнитель — название (например: Eminem Lose Yourself)" value={S.q}
        onChange={e => set(() => S.q = e.target.value)} onKeyDown={e => { if (e.key === 'Enter') search(); }} />
      <button className="pri" id="btnSearch" onClick={search}>Найти</button>
    </div>
    <div className="row" style={{ marginTop: 8 }}>
      {folderSupported() && <button id="btnOpenFolder" className="sm" title="Папка проекта: подниму проект (или TTML) и аудио из неё" onClick={openProjectFolder}>📂 Папка проекта</button>}
      <label className="btn sm" id="btnOpenFile" title="TTML (свой, Apple, Spicy, NaeNae — с исполнителями, бэками, пословной разметкой и секциями), LRC, SRT, текст или проект .spicy.json. Можно и просто перетащить файл на страницу.">📂 Открыть файл<input type="file" accept=".ttml,.xml,.lrc,.srt,.txt,.json" hidden onChange={e => { const f = e.target.files?.[0]; if (f) openLyricsFile(f); e.target.value = ''; }} /></label>
    </div>
    <div className="res" id="results">{S.results.slice(0, 25).map(d => {
      const synced = !!d.syncedLyrics;
      return <div className="item" key={d.id} onClick={() => loadTrack(d)}>
        <div><b>{d.trackName}</b><small>{`${d.artistName} · ${d.albumName || '—'} · ${mmss(d.duration || 0)}`}</small></div>
        <span className={'tag ' + (synced ? 'ok' : '')}>{synced ? 'synced' : 'plain'}</span>
      </div>;
    })}</div>
    <p className="hint">Источник синхро-текста — <a href="https://lrclib.net" target="_blank" rel="noreferrer">LRCLIB</a> (открытая база, без ключей). Если нужного трека нет — вставь свой LRC ниже.</p>
    <Genius />
    <details style={{ marginTop: 10 }}>
      <summary style={{ cursor: 'pointer', color: 'var(--mut)', fontSize: 13 }}>Вставить LRC / текст вручную</summary>
      <textarea id="manual" placeholder={'[00:12.30] первая строка\n[00:15.80] вторая строка'} value={S.manual} onChange={e => set(() => S.manual = e.target.value)} />
      <div className="row" style={{ marginTop: 8 }}>
        <button id="btnManual" onClick={() => loadManual(S.manual)}>Загрузить из поля</button>
        <label className="btn" title="Свой текст для нового трека: .txt, .lrc, .srt, .ttml (наш, Apple, Spicy — с исполнителями, бэками и разметкой)">Файл .txt .lrc .srt .ttml<input type="file" id="fileLrc" accept=".lrc,.txt,.srt,.ttml,.xml" hidden
          onChange={async e => { const f = e.target.files?.[0]; if (f) { const t = await f.text(); if (!/\.(ttml|xml)$/i.test(f.name)) S.manual = t; loadManual(t, f.name); } e.target.value = ''; }} /></label>
      </div>
    </details>
    <div className="grid2" style={{ marginTop: 12 }}>
      <label className="fld"><small>Название</small><input type="text" id="mTitle" placeholder="Название трека" value={S.meta.title} onChange={e => { set(() => S.meta.title = e.target.value); scheduleSave(); }} onBlur={rekeyAudio} /></label>
      <label className="fld"><small>Исполнитель</small><input type="text" id="mArtist" placeholder="Исполнитель" value={S.meta.artist} onChange={e => { set(() => S.meta.artist = e.target.value); scheduleSave(); }} onBlur={rekeyAudio} /></label>
    </div>
    <St id="st1" m={S.st1} />
  </section>;
}

function Genius() {
  const g = S.genius;
  return <div className="genius">
    <h3><span className="gl">G</span>Текст с Genius<small>эталонный текст для Spicy: ляжет на тайминги, совпавшие строки сохранят разметку и перевод</small></h3>
    <div className="row">
      <input type="text" id="gq" placeholder="Исполнитель название" value={geniusQuery()} onChange={e => set(() => S.genius = { hits: [], busy: false, msg: '', cls: '', ignored: [], ...S.genius, q: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') geniusSearch(); }} />
      <button id="btnGenius" disabled={g?.busy} onClick={() => geniusSearch()}>{g?.busy ? '…' : 'Найти на Genius'}</button>
    </div>
    {!!g?.hits.length && <div className="res" id="gres">{g.hits.map(h => <div className="item" key={h.id} onClick={() => !g.busy && geniusPick(h)}>
      {h.art ? <img src={h.art} alt="" /> : <span className="noart" />}<div><b>{h.title}</b><small>{h.artist}</small></div><span className="tag">взять текст</span>
    </div>)}</div>}
    {g?.msg && <div className={'status ' + g.cls}>{g.msg}</div>}
    {g?.text && <GeniusDiff />}
  </div>;
}
const KIND = { edit: 'правка', add: 'нет у нас', del: 'нет на Genius' };
function GeniusDiff() {
  const ds = geniusDiff();
  return <div className="gdiff">
    <div className="row"><b>Сверка с Genius{S.genius?.title ? ` · ${S.genius.title}` : ''}</b><span className="sp" />
      <button className="sm pri" id="btnGeniusAll" disabled={!ds.length} onClick={() => acceptDiff(ds)}>✓ Принять все ({ds.length})</button>
      <button className="sm" title="Весь текст Genius во вкладку «Текст» — править руками" onClick={geniusToText}>В «Текст»</button>
      <button className="sm ic" title="Закрыть сверку" onClick={() => set(() => { S.genius = { ...S.genius!, text: undefined, msg: '' }; })}>✕</button></div>
    {ds.map((d, x) => <div key={x + d.key} className={'gd ' + d.kind}>
      <span className="k">{KIND[d.kind]}{d.kind !== 'add' && <small> · стр. {d.m + 1}</small>}</span>
      <span className="tx">{d.from && <s>{d.from}</s>}{d.to && <ins>{d.to}</ins>}</span>
      {d.kind !== 'add' && <button className="sm ic" title="Показать строку" onClick={() => { seekTo(S.lines[d.m].t); focusLine(d.m, 'orig'); }}>▶</button>}
      <button className="sm ic ok" title={d.kind === 'del' ? 'Удалить строку' : d.kind === 'add' ? 'Добавить строку (время — между соседями)' : 'Принять текст Genius; разметка совпавших слов останется'} onClick={() => acceptDiff([d])}>✓</button>
      <button className="sm ic" title="Оставить как у нас" onClick={() => ignoreDiff(d)}>✕</button>
    </div>)}
  </div>;
}

function LineRow({ i }: { i: number }) {
  const l = S.lines[i];
  return <div className={'ln' + (S.picked.has(i) ? ' picked' : '') + (l.text.trim() ? '' : ' bgonly')} id={'ln' + i} onClick={e => { if (!(e.target as HTMLElement).closest('input,button,.t')) pickLine(i, e); }}>
    <div className="t" onClick={() => { seekTo(l.t); selectWord(i, 0); }}>
      {mmss(l.t) + '.' + String(Math.floor((l.t % 1) * 10))}
      {lineState(i, mainLayerFor(i)) === 'done' && <i className="sd" title="слова синхронизированы" />}
      {!l.sec && <button className="secb" title="Секция с этой строки (Припев, Куплет…)" onClick={e => { e.stopPropagation(); secPick(e.nativeEvent, i); }}>§</button>}
      <button className="ag" data-agent={agentOf(i).id} title={agentOf(i).title + ' (клик или V — сменить)'} onClick={e => { e.stopPropagation(); cycleAgent(i); }}>{agentOf(i).label}</button>
    </div>
    <div className="txt">
      <input className="o" type="text" title="Оригинал — можно править" placeholder="(без основной строки — только бэк)" value={l.text} onFocus={() => focusLine(i, 'orig')} onChange={e => editText(i, 'orig', e.target.value)} />
      <input className="tr" type="text" placeholder="перевод…" value={l.tr || ''} onFocus={() => focusLine(i, 'tr')} onChange={e => editText(i, 'tr', e.target.value)} onBlur={() => fillRepeats(i)} />
      {l.bg
        ? <div className="bgrow">
            <span className="bglab" title="Фоновый вокал: в Spicy мелкой строкой под основной">бэк</span>
            <input type="text" placeholder="бэк: оригинал" value={l.bg.text} onFocus={() => focusLine(i, 'bgo')} onChange={e => editText(i, 'bgo', e.target.value)} />
            <input type="text" placeholder="бэк: перевод" value={l.bg.tr} onFocus={() => focusLine(i, 'bg')} onChange={e => editText(i, 'bg', e.target.value)} />
            <button className="sm ic" title="Убрать бэк" onClick={e => { e.stopPropagation(); delBg(i); }}>✕</button>
          </div>
        : <button className="addbg" title="Добавить фоновый вокал (бэки, ад-либы) к этой строке" onClick={e => { e.stopPropagation(); addBg(i); }}>+ бэк</button>}
    </div>
    <span className="rowact">
      <button className="sm ic" title="Вставить пустую строку после этой" onClick={e => { e.stopPropagation(); addLineAfter(i); }}>+</button>
      <button className="sm ic" title="Удалить строку (Ctrl+Z вернёт)" onClick={e => { e.stopPropagation(); delLine(i); }}>🗑</button>
    </span>
  </div>;
}

export function TranslateCard() {
  const llm = (k: keyof typeof S.llm) => ({ value: S.llm[k], onChange: (e: { target: { value: string } }) => set(() => S.llm[k] = e.target.value) });
  return <section className="card">
    <h2>Перевод</h2>
    <div className="grid2">
      <select id="lang" value={S.meta.lang} onChange={e => set(() => S.meta.lang = e.target.value)}>
        {LANGS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
      <button className="pri" id="btnAuto" disabled={S.busyAuto} onClick={autoTranslate}>Автоперевод (Google)</button>
    </div>
    <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
      <button id="btnPrompt" title="Скопирует промпт со строками — вставь в Claude/ChatGPT для художественного перевода" onClick={copyPrompt}>Промпт для LLM</button>
      <button id="btnPaste" onClick={() => { set(() => S.paste = S.paste ?? ''); setTimeout(() => document.getElementById('pasteTa')?.focus()); }}>Вставить перевод списком</button>
      <button id="btnClear" className="danger" title="Стереть весь перевод (Ctrl+Z — вернуть)" onClick={clearTr}>Очистить</button>
      <button id="btnRepeats" title="Повторы строк (припев) получают уже сделанный перевод, если у них его нет" disabled={!S.lines.length} onClick={() => fillRepeats()}>↻ Перевод на повторы</button>
      <button id="btnFind" title="Найти и заменить по всей песне" disabled={!S.lines.length} onClick={() => set(() => S.find = S.find ? null : { q: '', r: '', where: 'all', cs: false, word: true })}>🔎 Заменить</button>
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
    {S.find && <FindBox />}
    <St id="st2" m={S.st2} />
  </section>;
}

/** the lines list (translation and sync tabs): texts, singers, background vocals, add / delete lines */
export function LinesCard() {
  if (!S.lines.length) return null;
  return <section className="card linescard">
    <h2>Строки <small>{S.lines.length}</small></h2>
    <div className="row ltools" style={{ flexWrap: 'wrap' }}>
      <button className="sm" id="btnAddLine" title="Пустая строка в точке воспроизведения — для своих слов или бэка, которого нет в найденном тексте" onClick={addLineHere}>+ строка у курсора</button>
      <button className="sm" id="btnAddBg" title="Отдельный бэк (без основной строки) в точке воспроизведения" onClick={addBgHere}>+ бэк у курсора</button>
      <button className="sm" id="btnParens" title="«текст (бэк)» → «(бэк)» уходит в фоновый вокал строки, тайминги слов переезжают вместе со словами" onClick={bracketsToBg}>( ) → бэки</button>
    </div>
    <div className="lines" id="lines" style={{ marginTop: 10 }}>{S.lines.map((l, i) => <Fragment key={i}>
      {l.sec && <button className="sechd" style={{ '--sc': secColor(l.sec) } as CSSProperties} title="Секция до следующей: клик — сменить / убрать" onClick={e => secPick(e.nativeEvent, i)}>{l.sec}</button>}
      <LineRow i={i} />
    </Fragment>)}</div>
  </section>;
}


const doubts = () => S.lines.reduce((n, l) => n + Object.values(l.sync || {}).reduce((m, ws) => m + (ws || []).filter(doubtful).length, 0), 0);
export function ExportCard() {
  const bi = S.meta.mode === 'bilingual', qa = S.qa, errs = qa ? qa.filter(x => x.sev === 'err').length : 0, st = stopLine(S.lines, S.meta.mode);
  return <section className="card">
    <h2>Экспорт TTML</h2>
    <div className="seg">
      <label><input type="radio" name="mode" value="translation" checked={!bi} onChange={() => setMode('translation')} /><span>Только перевод</span></label>
      <label><input type="radio" name="mode" value="bilingual" checked={bi} onChange={() => setMode('bilingual')} /><span>Оригинал + перевод</span></label>
    </div>
    <p className="hint" id="modeHint">{bi
      ? 'Экспериментально: оригинал — основная строка, перевод — мелким фоновым вокалом под ней. Пословный режим включается сам; слои синхронизируются отдельно (переключатель в панели синхры).'
      : 'Переведённый текст становится основной лирикой — самый безопасный вариант для Spicy Lyrics.'}</p>
    <label className="chk"><input type="checkbox" id="spread" checked={S.exp.spread} disabled={bi} onChange={e => set(() => S.exp.spread = e.target.checked)} /><span>Пословная подсветка (караоке)<small>Слова равномерно размазываются по длительности строки. Тайминг приблизительный, но выглядит живо.</small></span></label>
    <label className="chk"><input type="checkbox" id="roman" checked={S.exp.roman} onChange={e => set(() => S.exp.roman = e.target.checked)} /><span>Транслитерация латиницей<small>Spicy покажет под строкой кириллицы, как читается: «ty moya» — для тех, кто не читает по-русски.</small></span></label>
    <button className="metarow" id="btnMeta" title="Название, исполнители, авторы, альбом — как в AMLL" onClick={openMeta}>
      <span><small>Метаданные песни</small>{metaSummary() || 'Авторы, альбом — добавить'}</span><span aria-hidden="true">›</span>
    </button>
    <label className="offset">Сдвиг всей лирики, мс<input type="number" id="offset" step="50" value={S.exp.offset} onChange={e => set(() => S.exp.offset = e.target.value)} /></label>
    {S.lines.length > 0 && <div className={'stop ' + (st.i < 0 ? 'ok' : '')} id="stopLine">{st.i < 0
      ? <>Все строки размечены вручную ✓ ({st.n})</>
      : <><span>Размечено строк: <b>{st.done}</b> из {st.n}.{doubts() ? <> Сомнительных слов авто-тайминга: <b>{doubts()}</b> (<kbd>Q</kbd> на вкладке «Синхра»).</> : null} Ты остановился на строке <b>{st.i + 1}</b>: «{plainW(S.lines[st.i].tr.trim() || S.lines[st.i].text || S.lines[st.i].bg?.text || '').slice(0, 60)}»</span>
        <button className="sm" id="btnStop" onClick={() => { gotoQa(st.i); setPage('sync'); }}>Продолжить отсюда →</button></>}</div>}
    <div className="row" style={{ marginTop: 12 }}>
      <button className="pri" id="btnDl" title="Перед сохранением — проверка: ошибки, слова короче 50 мс, неразмеченные строки" onClick={download}>Скачать .ttml</button>
      <button id="btnCopy" onClick={copyTTML}>Копировать</button>
      <button id="btnShow" onClick={toggleCode}>{S.out == null ? 'Показать код' : 'Скрыть код'}</button>
    </div>
    <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
      <button className="sm" id="btnLrc" onClick={saveLRC}>LRC</button><button className="sm" id="btnSrt" onClick={saveSRT}>SRT (субтитры)</button>
      <button className="sm" id="btnProjSave" onClick={saveProjectFile}>Сохранить проект</button>
      <label className="btn sm" style={{ padding: '6px 10px', fontSize: 12.5 }} title="Проект .spicy.json или готовый TTML (тайминги, бэки, секции)">Открыть проект / TTML<input type="file" id="fileProj" accept=".json,.ttml,.xml,.lrc" hidden
        onChange={e => { const f = e.target.files?.[0]; if (f) openLyricsFile(f); e.target.value = ''; }} /></label>
    </div>
    {folderSupported() && <div className="pfolder" id="projFolder">
      {S.folder
        ? <><span>📁 <b title={S.folder.label}>{S.folder.label.split(/[\\/]/).pop()}</b><small>{S.folder.saved ? `сохранено в ${new Date(S.folder.saved).toLocaleTimeString().slice(0, 5)}` : 'TTML, проект и аудио — сюда'}</small></span>
          <button className="sm pri" id="btnFolderSave" onClick={saveToFolder}>Сохранить сюда <kbd>Ctrl+S</kbd></button><button className="sm" onClick={pickFolder}>Сменить</button><button className="sm ic" title="Отвязать папку от трека" onClick={unlinkFolder}>✕</button></>
        : <><span>Папка проекта<small>TTML, проект и аудио лежат вместе; <kbd>Ctrl+S</kbd> сохраняет туда без вопросов</small></span><button className="sm" id="btnFolderPick" onClick={() => saveToFolder()}>📁 Выбрать папку и сохранить</button></>}
    </div>}
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

function FindBox() {
  const f = S.find!, n = findAll(S.lines, findOpts()).n;
  const up = (p: Partial<NonNullable<typeof S.find>>) => set(() => Object.assign(S.find!, p));
  return <div className="findbox" id="findBox">
    <div className="grid2">
      <input type="text" id="findQ" placeholder="найти…" value={f.q} autoFocus onChange={e => up({ q: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') replaceEverywhere(); }} />
      <input type="text" id="findR" placeholder="заменить на… (пусто = удалить)" value={f.r} onChange={e => up({ r: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') replaceEverywhere(); }} />
    </div>
    <div className="row" style={{ marginTop: 6, flexWrap: 'wrap' }}>
      <select id="findWhere" value={f.where} onChange={e => up({ where: e.target.value as 'tr' | 'orig' | 'all' })} style={{ width: 'auto' }}>
        <option value="tr">в переводе</option><option value="orig">в оригинале</option><option value="all">везде</option>
      </select>
      <label className="chk inline"><input type="checkbox" checked={f.word} onChange={e => up({ word: e.target.checked })} />целое слово</label>
      <label className="chk inline"><input type="checkbox" checked={f.cs} onChange={e => up({ cs: e.target.checked })} />Аа</label>
      <small className="hint" id="findN" style={{ margin: 0 }}>{f.q ? `совпадений: ${n}` : ''}</small>
      <button className="sm pri" id="btnReplace" disabled={!n} onClick={replaceEverywhere}>Заменить всё</button>
    </div>
  </div>;
}

/** «Текст» tab: the whole song, original and translation side by side, row = line, (…) = background vocals */
function TextTab() {
  const refs = { g: useRef<HTMLDivElement>(null), o: useRef<HTMLTextAreaElement>(null), t: useRef<HTMLTextAreaElement>(null) };
  const f = S.full; if (!f) return null;
  const { o, t, map } = fullRows(), n = Math.max(o.length, t.length, 1), hasT = t.some(Boolean), bad = hasT && t.length !== o.length;
  const added = map.filter(m => m < 0).length, removed = S.lines.length - map.filter(m => m >= 0).length;
  const scroll = (src: HTMLElement) => { for (const r of [refs.g, refs.o, refs.t]) if (r.current && r.current !== src) r.current.scrollTop = src.scrollTop; };
  const edit = (k: 'o' | 't', v: string) => set(() => { S.full![k] = v; S.full!.dirty = true; });
  const key = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); applyFull(); } };
  return <div className="textab-wrap">
    <div className="row" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
      <button className="pri sm" id="btnFullApply" disabled={!f.dirty} title="Ctrl+Enter" onClick={applyFull}>Применить</button>
      <button className="sm" id="btnFullReset" disabled={!f.dirty} onClick={resetFull}>Сбросить</button>
      <small className={'hint' + (bad ? ' err' : '')} id="fullStat" style={{ margin: 0 }}>{bad ? `оригинал ${o.length} строк, перевод ${t.length} — выровняй столбцы`
        : f.dirty ? `не применено${added ? ` · новых строк ${added}` : ''}${removed ? ` · удалится ${removed}` : ''}` : 'строка = строка песни · (в скобках) = бэк · | = граница слога'}</small>
    </div>
    <div className="textab">
      <div className="th">#</div><div className="th">Оригинал</div><div className="th">Перевод</div>
      <div className="gut" ref={refs.g}>{Array.from({ length: n }, (_, j) => {
        const m = j < o.length ? map[j] : -2, l = m >= 0 ? S.lines[m] : null;
        return <div key={j} className={m === -1 ? 'new' : ''} title={l ? 'перейти к строке' : m === -1 ? 'новая строка' : ''} onClick={() => { if (l) seekTo(l.t); }}>{l ? mmss(l.t) : m === -1 ? '+ new' : ''}</div>;
      })}</div>
      <textarea id="fullO" ref={refs.o} wrap="off" spellCheck={false} value={f.o} onScroll={e => scroll(e.currentTarget)} onKeyDown={key} onChange={e => edit('o', e.target.value)} />
      <textarea id="fullT" ref={refs.t} wrap="off" spellCheck={false} value={f.t} placeholder="перевод — напротив своей строки" onScroll={e => scroll(e.currentTarget)} onKeyDown={key} onChange={e => edit('t', e.target.value)} />
    </div>
  </div>;
}

/** «Текст» tab: the whole song */
export function TextCard() {
  if (!S.lines.length) return <section className="card"><h2>Текст песни</h2><p className="hint">Сначала загрузи текст на вкладке «Трек».</p><Next to="track" label="К выбору трека" /></section>;
  return <section className="card textcard"><h2>Текст песни <small>оригинал и перевод рядом</small></h2><TextTab /></section>;
}
export function AudioCard() {
  return <section className="card">
    <h2>Аудио</h2>
    <div className="row" style={{ flexWrap: 'wrap' }}>
      <label className="btn pri">♪ Выбрать аудиофайл<input type="file" accept="audio/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) loadAudioFile(f); e.target.value = ''; }} /></label>
      <span className={'hint' + (S.hasAudio ? ' okc' : '')} style={{ margin: 0 }}>{S.hasAudio ? (W.peaks ? '✓ аудио и волна готовы' : '✓ аудио подключено') : 'Или перетащи файл на страницу — по имени файла подберу текст.'}</span>
    </div>
  </section>;
}
/** big "next step" button at the bottom of a tab */
export function Next({ to, label }: { to: Page; label: string }) {
  return <button className="next" id={'next-' + to} onClick={() => setPage(to)}>{label} →</button>;
}

/** history: every project version kept in this browser (auto every 3 min and before anything replaces it) */
export function HistoryCard() {
  const [list, setList] = useState<Snap[] | null>(null), [q, setQ] = useState('');
  const load = () => listSnaps().then(setList);
  useEffect(() => { load(); }, []);
  const f = q.trim().toLowerCase(), shown = (list || []).filter(s => !f || (s.artist + ' ' + s.title).toLowerCase().includes(f));
  return <section className="card">
    <h2>Проекты и история <small>снимки в этом браузере</small></h2>
    <div className="row">
      <input type="text" placeholder="найти по названию…" value={q} onChange={e => setQ(e.target.value)} />
      <button className="sm" id="btnSnapNow" disabled={!S.lines.length} onClick={() => snapshot('вручную').then(load)}>📸 Снимок</button>
      <button className="sm" title="Обновить список" onClick={load}>↻</button>
      <button className="sm" id="btnDataDir" title="Папка с проектом сервера, экспортом и авто-таймингом (нужен локальный сервер: приложение, батник, npm run serve)" onClick={() => openFolder('data')}>📂 Папка</button>
    </div>
    <div className="snaps" id="snaps">{list == null ? <p className="hint">Загружаю…</p> : !shown.length ? <p className="hint">Снимков пока нет — они появятся сами через пару минут работы.</p>
      : shown.slice(0, 40).map(s => <div className="item" key={s.id}>
        <div><b>{s.title || 'без названия'}</b><small>{`${s.artist || '—'} · ${new Date(s.at).toLocaleString()} · строк ${s.n}, перевод ${s.tr}/${s.n} · ${s.reason}`}</small></div>
        <button className="sm" onClick={() => restoreSnap(s).then(load)}>Вернуть</button>
      </div>)}</div>
  </section>;
}
