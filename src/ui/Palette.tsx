// Ctrl+K: every action with its hotkey, searchable. Enter runs it.
import { S, emit, isBg, isTr, mkLayer } from '../state.ts';
import { PAGES, setLoop, setPage, setSnap } from '../hotkeys.ts';
import { doRedo, doUndo, resetLine, setLayer, spreadAll, spreadSelLine, syllabifyLine } from '../sync.ts';
import { addBgHere, addLineHere, bracketsToBg, copyLines, copyTiming, fillRepeats, fitLines, setAutoFit, pasteLines, pasteTimingHere, repeatChorus, shiftLines } from '../lineEdit.ts';
import { autoTranslate, copyPrompt, llmTranslate } from '../translate.ts';
import { copyTTML, download, runQa, saveLRC, saveProjectFile, saveSRT } from '../exporting.ts';
import { snapshot } from '../persist.ts';
import { openMeta } from './MetaModal.tsx';
import { geniusWriters } from '../genius.ts';
import { centerOnSel } from '../waveform/wave.ts';
import { autoAlign, openAlignPanel } from '../autoAlign.ts';

type Cmd = [title: string, keys: string, run: () => unknown];
const cmds = (): Cmd[] => [
  ...PAGES.map(([id, name], k): Cmd => [`Вкладка: ${name}`, `Alt+${k + 1}`, () => setPage(id)]),
  ['Метаданные песни (авторы, альбом…)', '', openMeta],
  ['Авторы песни с Genius', '', () => geniusWriters()],
  ['Найти трек (LRCLIB)', '', () => { setPage('track'); setTimeout(() => document.getElementById('q')?.focus()); }],
  ['Весь текст: оригинал и перевод рядом', 'Alt+2', () => setPage('text')],
  ['Автоперевод (Google)', '', autoTranslate],
  ['Перевести через LLM', '', llmTranslate],
  ['Скопировать промпт для LLM', '', copyPrompt],
  ['Перевод на повторы (припев)', '', () => fillRepeats()],
  ['Найти и заменить', '', () => { setPage('tr'); S.find = S.find || { q: '', r: '', where: 'all', cs: false, word: true }; emit(); setTimeout(() => document.getElementById('findQ')?.focus()); }],
  ['( ) → бэки: текст в скобках в фоновый вокал', '', bracketsToBg],
  ['Новая строка у курсора', '', addLineHere],
  ['Новый бэк у курсора', '', addBgHere],
  ['Копировать строки', 'Ctrl+C', copyLines],
  ['Вставить строки у курсора', 'Ctrl+V', () => pasteLines()],
  ['Копировать тайминг строки', 'Ctrl+Shift+C', copyTiming],
  ['Вставить тайминг в выделенные строки', 'Ctrl+Shift+V', pasteTimingHere],
  ['Тайминг строки → на повторы (припев)', 'C', repeatChorus],
  ['Авто-тайминг нейросетью (черновик)', '', autoAlign],
  ['Авто-тайминг: установка, видеокарта, удаление', '', openAlignPanel],
  ['Дорожка: основа ↔ бэк', 'B', () => setLayer(mkLayer(!isBg(S.layer), isTr(S.layer)))],
  ['Размечать: перевод ↔ оригинал', 'T', () => setLayer(mkLayer(isBg(S.layer), !isTr(S.layer)))],
  ['Раскидать слова строки ровно', '', spreadSelLine],
  ['Раскидать все неразмеченные строки', '', spreadAll],
  ['Разбить строку на слоги', '', syllabifyLine],
  ['Сбросить разметку строки', '', resetLine],
  ['Подогнать начало и конец строки под слова', '', () => fitLines(S.sel?.i)],
  ['Подогнать все строки под их слова', '', () => fitLines()],
  [S.autoFit ? 'Строки сами по словам: выключить' : 'Строки сами по словам: включить', '', () => setAutoFit(!S.autoFit)],
  [`Сдвинуть строки после курсора на +${S.shiftMs} мс`, '', () => shiftLines(S.shiftMs)],
  [`Сдвинуть строки после курсора на −${S.shiftMs} мс`, '', () => shiftLines(-S.shiftMs)],
  ['Вписать строку в волну', '', centerOnSel],
  [S.snap ? 'Магнит: выключить' : 'Магнит: включить', 'N', () => setSnap(!S.snap)],
  [S.loop ? 'Цикл строки: выключить' : 'Цикл строки: включить', 'L', () => setLoop(!S.loop)],
  ['Отменить', 'Ctrl+Z', doUndo],
  ['Вернуть', 'Ctrl+Shift+Z', doRedo],
  ['Скачать .ttml', '', download],
  ['Копировать TTML', '', copyTTML],
  ['Скачать LRC', '', saveLRC],
  ['Скачать SRT', '', saveSRT],
  ['Сохранить проект в файл', '', saveProjectFile],
  ['Проверка перед экспортом (QA)', '', () => { setPage('export'); runQa(); }],
  ['Снимок проекта сейчас', '', () => snapshot('вручную')],
  ['Как размечать (справка)', '?', () => { S.help = true; emit(); }],
];
const match = (q: string) => { const ws = q.toLowerCase().split(/\s+/).filter(Boolean); return cmds().filter(([t, k]) => ws.every(w => (t + ' ' + k).toLowerCase().includes(w))); };

export function openPalette() { S.palette = { q: '', i: 0 }; emit(); setTimeout(() => document.getElementById('palQ')?.focus()); }
const close = () => { S.palette = null; emit(); };
function run(c: Cmd | undefined) { if (!c) return; close(); c[2](); }

export function Palette() {
  const p = S.palette; if (!p) return null;
  const list = match(p.q), i = Math.min(p.i, Math.max(0, list.length - 1));
  return <div className="modal pal" id="palette" onMouseDown={e => { if ((e.target as Element).id === 'palette') close(); }}>
    <div className="palbox">
      <input id="palQ" type="text" placeholder="Что сделать?  (например: тайминг, бэк, ttml)" value={p.q} autoComplete="off"
        onChange={e => { S.palette = { q: e.target.value, i: 0 }; emit(); }}
        onKeyDown={e => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
          else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); S.palette = { q: p.q, i: Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))) }; emit(); }
          else if (e.key === 'Enter') { e.preventDefault(); run(list[i]); }
        }} />
      <div className="pallist">{list.length ? list.map((c, k) => <button key={c[0]} className={k === i ? 'on' : ''} onMouseEnter={() => { if (k !== i) { S.palette = { q: p.q, i: k }; emit(); } }} onClick={() => run(c)}>
        <span>{c[0]}</span>{c[1] && <kbd>{c[1]}</kbd>}
      </button>) : <p className="hint">Ничего не нашлось.</p>}</div>
    </div>
  </div>;
}
