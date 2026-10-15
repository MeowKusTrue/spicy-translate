// Export (TTML/LRC/SRT/project) and QA panel actions.
import { buildLRC, buildSRT, buildTTML, qaCheck, type ExportOpts } from './core/index.ts';
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
export function download() {
  const x = checkExport(); if (!x) return;
  return saveText(`${fileBase()} (${S.meta.lang}).ttml`, x, 'application/xml');
}
export async function copyTTML() { const x = checkExport(); if (!x) return; (await copyText(x)) ? status('st2', 'TTML скопирован в буфер.', 'ok') : status('st2', 'Буфер заблокирован — нажми «Показать код» и скопируй вручную.', 'err'); }
export function toggleCode() { if (S.out == null) { const x = checkExport(); if (!x) return; S.out = x; } else S.out = null; emit(); }
export function saveLRC() { if (!S.lines.length) return; saveText(baseName() + '.lrc', buildLRC(opts())); }
export function saveSRT() { if (!S.lines.length) return; saveText(baseName() + '.srt', buildSRT(opts())); }
export function saveProjectFile() { if (!S.lines.length) return; saveText(baseName() + '.spicy.json', projectJSON(), 'application/json'); }

export function runQa() { S.qa = qaCheck(S.lines, S.meta.mode, { wordSpread: S.exp.spread }); emit(); }
export function gotoQa(i: number) { S.layer = mainLayerFor(i); seekTo(S.lines[i].t); if (!S.dock) toggleDock(true); selectWord(i, 0); centerOnSel(); }
