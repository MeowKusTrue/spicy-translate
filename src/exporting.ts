// Export (TTML/LRC/SRT/project) and QA panel actions.
import { SHORT_WORD, buildLRC, buildSRT, buildTTML, qaCheck, stopLine, type ExportOpts } from './core/index.ts';
import { S, emit, mainLayerFor, status } from './state.ts';
import { seekTo } from './audio.ts';
import { projectJSON, saveText } from './persist.ts';
import { selectWord } from './sync.ts';
import { toggleDock } from './hotkeys.ts';
import { centerOnSel } from './waveform/wave.ts';
import { copyText } from './translate.ts';

const fileBase = () => (S.meta.artist + ' - ' + S.meta.title).replace(/[\\/:*?"<>|]/g, '').trim() || 'lyrics';
const baseName = () => fileBase() + ` (${S.meta.lang})`;
export function opts(): ExportOpts {
  return { lines: S.lines, mode: S.meta.mode, wordSpread: S.exp.spread, lang: S.meta.lang,
    offset: parseInt(S.exp.offset, 10) || 0, songwriters: S.exp.writers.split(',').map(s => s.trim()), roman: S.exp.roman };
}
function checkExport() {
  if (!S.lines.length) { status('st2', 'Нечего экспортировать — загрузи текст.', 'err'); return null; }
  const missing = S.lines.filter(l => !l.tr || !l.tr.trim()).length;
  if (missing) status('st2', `У ${missing} строк нет перевода — в файл попадёт оригинал.`, 'err');
  return buildTTML(opts());
}
/** the check before a file goes out: errors ask first, short words and unfinished lines are said after */
export function preflight() {
  runQa();
  const qa = S.qa!, errs = qa.filter(x => x.sev === 'err'), short = qa.filter(x => x.msg.includes('слишком короткое')), st = stopLine(S.lines, S.meta.mode);
  if (errs.length && !confirm(`Ошибок: ${errs.length} (первая — строка ${errs[0].i + 1}: ${errs[0].msg}).\nSpicy может не загрузить такой файл. Всё равно сохранить?`)) return null;
  const notes = [st.i >= 0 && `размечено строк ${st.done} из ${st.n}, остановился на строке ${st.i + 1}`, short.length && `слов короче ${SHORT_WORD * 1000} мс: ${short.length}`].filter(Boolean);
  return notes.length ? 'Сохранено, но ' + notes.join('; ') + ' — список во вкладке «Экспорт».' : '';
}
export async function download() {
  const x = checkExport(); if (!x) return;
  const note = preflight(); if (note == null) return;
  const ok = await saveText(`${fileBase()} (${S.meta.lang}).ttml`, x, 'application/xml');
  if (ok && note) status('st2', note, 'err');
  return ok;
}
export async function copyTTML() { const x = checkExport(); if (!x) return; (await copyText(x)) ? status('st2', 'TTML скопирован в буфер.', 'ok') : status('st2', 'Буфер заблокирован — нажми «Показать код» и скопируй вручную.', 'err'); }
export function toggleCode() { if (S.out == null) { const x = checkExport(); if (!x) return; S.out = x; } else S.out = null; emit(); }
export function saveLRC() { if (!S.lines.length) return; saveText(baseName() + '.lrc', buildLRC(opts())); }
export function saveSRT() { if (!S.lines.length) return; saveText(baseName() + '.srt', buildSRT(opts())); }
export function saveProjectFile() { if (!S.lines.length) return; saveText(baseName() + '.spicy.json', projectJSON(), 'application/json'); }

export function runQa() { S.qa = qaCheck(S.lines, S.meta.mode, { wordSpread: S.exp.spread }); emit(); }
export function gotoQa(i: number) { S.layer = mainLayerFor(i); seekTo(S.lines[i].t); if (!S.dock) toggleDock(true); selectWord(i, 0); centerOnSel(); }
