// Editing texts and lines: the list inputs, the inline editor on the wave (double click / E), adding and removing
// lines (own words, background vocals with no lead line), "(…)" -> background vocals. bg = bg translation, bgo = bg original.
import { alignRows, findAll, insertLine, lineRow, parensToBg, parseRow, remapSync, repeatTiming, replaceUnit, sameLines, type Layer, type Line } from './core/index.ts';
import { S, clamp, emit, fillLine, isBg, isTr, layerText, lineState, r3, setText, toast, viewWords, wordsOf } from './state.ts';
import { now } from './audio.ts';
import { buildPreview } from './preview.ts';
import { scheduleSave } from './persist.ts';
import { CH, afterSyncChange, restore, selectWord, setLayer, snap } from './sync.ts';
import { W, drawWave, laneY } from './waveform/wave.ts';

const after = () => { buildPreview(true); emit(); drawWave(); scheduleSave(); };
/**
 * Unchanged words keep their timings, a fixed typo keeps its span, new words are placed into the gaps
 * (auto, dashed) so they can be dragged right away.
 */
export function editText(i: number, layer: Layer, v: string) { if (S.lines[i]) { keepText(i, layer, v); after(); } }
function keepText(i: number, layer: Layer, v: string) {
  const l = S.lines[i], old = layerText(l, layer); if (old === v) return;
  setText(i, layer, v);
  const ns = remapSync(old, v, l.sync && l.sync[layer]);
  if (ns) { l.sync![layer] = ns; fillLine(i, layer); } else if (l.sync) delete l.sync[layer];
}
export function addBg(i: number) { const l = S.lines[i]; if (l && !l.bg) { l.bg = { text: '', tr: '' }; emit(); } }
export function delBg(i: number) {
  const l = S.lines[i]; if (!l) return;
  snap(); delete l.bg; if (l.sync) { delete l.sync.bg; delete l.sync.bgo; }
  if (!l.text.trim() && !(l.tr || '').trim()) return delLine(i, false); // a background-only line without its background = nothing
  after();
}
/** focusing a text field in the list = work on that line and track; the wave follows */
export function focusLine(i: number, layer: Layer) {
  if (S.sel?.i === i && S.layer === layer) return;
  setLayer(layer); selectWord(i, 0);
  const l = S.lines[i], w = document.getElementById('wave')?.clientWidth || 800;
  if (l.t < W.start || l.end > W.start + w / W.px) { W.start = Math.max(0, l.t - (w * 0.15) / W.px); drawWave(); }
}

/* ---------- adding / removing lines ---------- */
function afterLines() { S.picked.clear(); S.pickAnchor = -1; S.duration = Math.max(S.duration, ...S.lines.map(l => l.end + 2)); buildPreview(true); afterSyncChange(true); }
export function focusRow(i: number, sel = 'input.o') {
  setTimeout(() => { const r = document.getElementById('ln' + i); if (!r) return; r.scrollIntoView({ block: 'center' }); r.querySelector<HTMLInputElement>(sel)?.focus(); });
}
export function addLineAt(t: number, bg = false) {
  snap(); const i = insertLine(S.lines, Math.max(0, r3(t)), bg ? { bg: { text: '', tr: '' } } : {});
  if (S.sel && S.sel.i >= i) S.sel.i++;
  afterLines(); return i;
}
export function addLineAfter(i: number) {
  const l = S.lines[i], nx = S.lines[i + 1];
  focusRow(addLineAt(nx && nx.t < l.end + 0.5 ? (l.t + nx.t) / 2 : l.end));
}
export const addLineHere = () => focusRow(addLineAt(now()));
export const addBgHere = () => focusRow(addLineAt(now(), true), '.bgrow input');
export function delLine(i: number, withSnap = true) {
  if (!S.lines[i]) return;
  if (withSnap) snap();
  S.lines.splice(i, 1);
  if (S.sel) { if (S.sel.i === i) S.sel = S.lines.length ? { i: Math.min(i, S.lines.length - 1), k: 0 } : null; else if (S.sel.i > i) S.sel.i--; }
  afterLines(); toast('Строка удалена. Ctrl+Z — вернуть.', 'ok');
}
export function bracketsToBg() {
  if (!S.lines.length) return toast('Нет строк.', 'err');
  snap(); let n = 0; S.lines.forEach(l => { if (parensToBg(l)) n++; });
  if (!n) { S.undo.pop(); return toast('Скобок в тексте нет — бэки добавь вручную: «+ бэк» у строки или двойной клик по дорожке «бэк».', 'err'); }
  afterLines(); toast(`Бэки из скобок: строк ${n}. Тайминги слов переехали вместе со словами. Ctrl+Z — отмена.`, 'ok');
}

/* ---------- inline editor over the wave ---------- */
const WE = { el: null as HTMLInputElement | null, i: -1, layer: 'tr' as Layer, k: -1, fresh: false };
export const editing = () => !!WE.el;
export function newLineEdit(t: number, layer: Layer) {
  const i = addLineAt(t, isBg(layer));
  setLayer(layer); S.sel = { i, k: 0 }; openEdit(i, layer, -1, true);
}
/** k >= 0: one word (spaces add words, empty deletes it); k = -1: the whole text of the line on this track */
export function openEdit(i: number, layer: Layer, k = -1, fresh = false) {
  closeEdit(true);
  const cv = document.getElementById('wave'), l = S.lines[i]; if (!cv || !l) return;
  const r = cv.getBoundingClientRect(), [y, hh] = laneY(isBg(layer) ? 'bg' : 'main');
  const vw = viewWords(i, layer).filter(x => x.a != null), one = k >= 0 ? viewWords(i, layer)[k] : null;
  const a = one && one.a != null ? one.a : vw.length ? vw[0].a! : l.t, b = one && one.b != null ? one.b : vw.length ? vw[vw.length - 1].b! : l.end;
  const X = (t: number) => (t - W.start) * W.px;
  const left = clamp(X(a) - 4, 0, Math.max(0, r.width - 160)), width = clamp(X(b) - X(a) + 30, k >= 0 ? 130 : 300, Math.max(160, r.width - left));
  const el = document.createElement('input'); el.type = 'text'; el.className = 'wedit' + (isBg(layer) ? ' bg' : '');
  el.value = k >= 0 ? (wordsOf(i, layer)[k] || '') : layerText(l, layer);
  el.placeholder = k >= 0 ? 'слово · пробел — ещё слова · пусто — удалить' : (isBg(layer) ? 'бэк' : 'строка') + (isTr(layer) ? ' (перевод)' : ' (оригинал)') + ' · Enter — готово, Esc — отмена';
  Object.assign(el.style, { left: r.left + left + 'px', top: r.top + y + 'px', width: width + 'px', height: Math.max(28, hh) + 'px' });
  Object.assign(WE, { el, i, layer, k, fresh });
  el.onkeydown = ev => {
    ev.stopPropagation();
    if (ev.key === 'Enter') { ev.preventDefault(); closeEdit(true); }
    else if (ev.key === 'Escape') { ev.preventDefault(); closeEdit(false); }
  };
  el.onblur = () => closeEdit(true);
  document.body.appendChild(el); el.focus(); el.select();
}
export function closeEdit(commit: boolean) {
  const el = WE.el; if (!el) return;
  WE.el = null; el.onblur = null; el.remove();
  const { i, layer, k, fresh } = WE, l = S.lines[i]; if (!l) return;
  const v = el.value.replace(/[^\S ]+/g, ' ').trim();
  if (fresh && (!commit || !v)) { const u = S.undo.pop(); if (u) restore(u); return; } // empty new line = never mind
  if (!commit) return;
  if (k >= 0) {
    if (v === (wordsOf(i, layer)[k] || '')) return;
    snap(); const r = replaceUnit(layerText(l, layer), l.sync && l.sync[layer], k, v); if (!r) return;
    setText(i, layer, r.text); l.sync = l.sync || {};
    if (r.sync && r.sync.length) { l.sync[layer] = r.sync; fillLine(i, layer); } else delete l.sync[layer];
    S.sel = { i, k: clamp(k, 0, Math.max(0, wordsOf(i, layer).length - 1)) };
    buildPreview(true); afterSyncChange(false, i);
  } else {
    if (v === layerText(l, layer)) return;
    if (!fresh) snap();
    editText(i, layer, v); fillLine(i, layer); afterSyncChange(false, i);
  }
}

/* ---------- whole-song text ---------- */
export function openFull(tr = isTr(S.layer)) { S.full = { tr, text: S.lines.map(l => lineRow(l, tr)).join('\n') }; emit(); }
/**
 * Apply the whole-song editor: one row per line, "(…)" = background vocals. In the original, rows can be added,
 * removed and reordered by editing (lines are matched by text, timings of unchanged words stay). The translation
 * goes row-for-row, so its row count must match.
 */
export function applyFull() {
  const f = S.full; if (!f) return;
  let rows = f.text.split(/\r?\n/).map(s => s.trim());
  if (f.tr) { while (rows.length > S.lines.length && !rows[rows.length - 1]) rows.pop(); }
  else rows = rows.filter(Boolean);
  if (f.tr && rows.length !== S.lines.length) return toast(`В переводе строк ${rows.length}, а в песне ${S.lines.length}: перевод идёт строка в строку. Строки добавляй и удаляй в оригинале.`, 'err');
  if (!rows.length) return toast('Пусто — удалять весь текст так нельзя.', 'err');
  snap();
  const map = f.tr ? rows.map((_, j) => j) : alignRows(S.lines.map(l => lineRow(l, false)), rows);
  const old = S.lines, next: Line[] = map.map(m => m >= 0 ? old[m] : { t: -1, end: -1, text: '', tr: '' });
  for (let j = 0; j < next.length;) { // new lines go evenly into the time between their neighbours
    if (next[j].t >= 0) { j++; continue; }
    let e = j; while (e < next.length && next[e].t < 0) e++;
    const P = next[j - 1], N = next[e], k = e - j;
    let a = P ? P.end : N ? Math.max(0, N.t - 3 * k) : 0, b = N ? N.t : a + 3 * k;
    if (b - a < 0.8 * k) { a = P ? (P.t + P.end) / 2 : Math.max(0, b - 0.8 * k); b = Math.max(b, a + 0.8 * k); }
    for (let q = 0; q < k; q++) { next[j + q].t = r3(a + (b - a) * q / k); next[j + q].end = r3(a + (b - a) * (q + 1) / k); }
    j = e;
  }
  S.lines = next;
  const ml: Layer = f.tr ? 'tr' : 'orig', bl: Layer = f.tr ? 'bg' : 'bgo';
  rows.forEach((row, j) => {
    const { main, bg } = parseRow(row), l = S.lines[j];
    keepText(j, ml, main);
    if (bg || l.bg) keepText(j, bl, bg);
    if (l.bg && !l.bg.text.trim() && !l.bg.tr.trim()) { delete l.bg; if (l.sync) { delete l.sync.bg; delete l.sync.bgo; } }
  });
  if (S.sel && S.sel.i >= S.lines.length) S.sel = { i: S.lines.length - 1, k: 0 };
  const added = map.filter(m => m < 0).length, removed = old.length - map.filter(m => m >= 0).length;
  S.full = null; afterLines();
  toast(`Текст применён${added ? `, новых строк: ${added}` : ''}${removed ? `, удалено: ${removed}` : ''}. Тайминги неизменённых слов на месте. Ctrl+Z — отмена.`, 'ok');
}

/* ---------- find & replace ---------- */
const WHERE: Record<'tr' | 'orig' | 'all', Layer[]> = { tr: ['tr', 'bg'], orig: ['orig', 'bgo'], all: ['orig', 'tr', 'bgo', 'bg'] };
export const findOpts = () => { const f = S.find!; return { find: f.q, repl: f.r, layers: WHERE[f.where], cs: f.cs, word: f.word }; };
export function replaceEverywhere() {
  if (!S.find) return;
  const { n, edits } = findAll(S.lines, findOpts());
  if (!n) return toast('Ничего не нашлось.', 'err');
  snap(); edits.forEach(e => keepText(e.i, e.layer, e.text));
  afterLines(); toast(`Заменено: ${n} в строках: ${new Set(edits.map(e => e.i)).size}. Тайминги остальных слов на месте. Ctrl+Z — отмена.`, 'ok');
}

/* ---------- chorus: reuse word timings on repeated lines ---------- */
export function repeatChorus() {
  // the selected line, or the one just finished (after H the selection has already moved to the next line)
  const ok = (i: number | undefined) => i != null && i >= 0 && i < S.lines.length && sameLines(S.lines, i).length > 0;
  const i = [S.sel?.i, CH.last].find(x => ok(x) && lineState(x!, S.layer) === 'done') ?? [S.sel?.i, CH.last].find(ok);
  if (i == null) return toast('У этой строки нет повторов с таким же текстом. Выбери слово в размеченной строке припева.', 'err');
  const same = sameLines(S.lines, i);
  snap(); const n = repeatTiming(S.lines, i);
  if (!n) { S.undo.pop(); return toast('Переносить нечего: строка размечена не до конца, или повторы уже размечены вручную.', 'err'); }
  afterSyncChange(true);
  toast(`Тайминг перенесён на строк: ${n} из ${same.length}. Пунктир = авто, проверь на слух (G/H или мышью). Ctrl+Z — отмена.`, 'ok');
}
