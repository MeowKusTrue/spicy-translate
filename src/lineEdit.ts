// Editing texts and lines: the list inputs, the inline editor on the wave (double click / E), adding and removing
// lines (own words, background vocals with no lead line), "(…)" -> background vocals. bg = bg translation, bgo = bg original.
import { stretchLines, alignRows, findAll, fmtTime, insertLine, lineFromWords, lineRow, fitLineToWords, fitsWords, pasteTiming, repeatTranslations, timingOf, transferTiming, parensToBg, parseRow, plainW, remapSync, repeatTiming, replaceUnit, sameLines, shiftLine, type Layer, type Line } from './core/index.ts';
import { S, clamp, emit, ls, fillLine, isBg, isTr, layerText, lineState, r3, setText, toast, viewWords, wordsOf } from './state.ts';
import { now } from './audio.ts';
import { learnAndSpread, spreadSplits } from './syllables.ts';
import { buildPreview } from './preview.ts';
import { scheduleSave } from './persist.ts';
import { CH, afterSyncChange, restore, selectWord, setLayer, snap } from './sync.ts';
import { W, drawWave, laneY } from './waveform/wave.ts';

const after = () => { buildPreview(true); emit(); drawWave(); scheduleSave(); };
/**
 * Unchanged words keep their timings, a fixed typo keeps its span, new words are placed into the gaps
 * (auto, dashed) so they can be dragged right away.
 */
export function editText(i: number, layer: Layer, v: string) { if (S.lines[i]) { keepText(i, layer, v); learnAndSpread(v); after(); } }
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
function afterLines() { W.multi = []; S.picked.clear(); S.pickAnchor = -1; S.duration = Math.max(S.duration, ...S.lines.map(l => l.end + 2)); buildPreview(true); afterSyncChange(true); }
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
    learnAndSpread(r.text);
    S.sel = { i, k: clamp(k, 0, Math.max(0, wordsOf(i, layer).length - 1)) };
    buildPreview(true); afterSyncChange(false, i);
  } else {
    if (v === layerText(l, layer)) return;
    if (!fresh) snap();
    keepText(i, layer, v); learnAndSpread(v);
    if (fresh) l.end = r3(Math.min(l.end, l.t + Math.max(0.6, 0.45 * wordsOf(i, layer).length)));
    fillLine(i, layer); buildPreview(true); afterSyncChange(false, i);
  }
}

/* ---------- whole-song text (the «Текст» tab): original and translation side by side ---------- */
export const fullDraft = () => ({ o: S.lines.map(l => lineRow(l, false)).join('\n'), t: S.lines.map(l => lineRow(l, true)).join('\n'), dirty: false });
export function resetFull() { S.full = fullDraft(); emit(); }
const rowsOf = (s: string) => { const r = s.split(/\r?\n/).map(x => x.trim()); while (r.length && !r[r.length - 1]) r.pop(); return r; };
/** rows of both columns + for each row the line it continues (-1 = new) */
export function fullRows() {
  const f = S.full!, o = rowsOf(f.o), t = rowsOf(f.t);
  return { o, t, map: alignRows(S.lines.map(l => lineRow(l, false)), o) };
}
/**
 * Apply the «Текст» tab: a row = a line, "(…)" = its background vocals, a row of only "(…)" = background-only line.
 * Original rows can be added / removed / edited (lines are matched by text; timings of unchanged words stay);
 * translation rows sit next to their original rows (empty = no translation).
 */
export function applyFull() {
  if (!S.full) return;
  const { o, t } = fullRows(), hasT = t.some(Boolean);
  while (hasT && t.length < o.length) t.push(''); // the last lines may just be untranslated
  if (hasT && t.length !== o.length) return toast(`Строк: оригинал ${o.length}, перевод ${t.length}. Выровняй столбцы: строка перевода стоит напротив своей строки (пустая — без перевода).`, 'err');
  const rows = o.map((x, j) => ({ o: x, t: t[j] || '' })).filter(r => r.o || r.t);
  if (!rows.length) return toast('Пусто — так весь текст не удалить.', 'err');
  snap();
  const map = alignRows(S.lines.map(l => lineRow(l, false)), rows.map(r => r.o));
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
  rows.forEach((r, j) => {
    const l = S.lines[j];
    for (const tr of hasT ? [false, true] : [false]) {
      const { main, bg } = parseRow(tr ? r.t : r.o), bl: Layer = tr ? 'bg' : 'bgo';
      keepText(j, tr ? 'tr' : 'orig', main);
      if (bg || layerText(l, bl)) keepText(j, bl, bg);
    }
    if (l.bg && !l.bg.text.trim() && !l.bg.tr.trim()) { delete l.bg; if (l.sync) { delete l.sync.bg; delete l.sync.bgo; } }
  });
  if (S.sel && S.sel.i >= S.lines.length) S.sel = { i: S.lines.length - 1, k: 0 };
  const added = map.filter(m => m < 0).length, removed = old.length - map.filter(m => m >= 0).length;
  spreadSplits(); // remembered syllable splits
  afterLines(); S.full = fullDraft(); emit();
  toast(`Текст применён${added ? `, новых строк: ${added}` : ''}${removed ? `, удалено: ${removed}` : ''}. Тайминги неизменённых слов на месте. Ctrl+Z — отмена.`, 'ok');
}

/* ---------- copies: Alt+drag a word on the wave, Ctrl+C / Ctrl+V lines ---------- */
/** Alt+drag drop: copies become a NEW line (on the bg track: a background-only line), like a duplicated clip */
export function dropCopies(ws: { layer: Layer; w: string; a: number; b: number }[], groups: number[] = [ws.length]) {
  const made: Line[] = []; let at = 0;
  for (const n of groups) { const l = lineFromWords(ws.slice(at, at + n)); at += n; if (l) made.push(l); }
  if (!made.length) return;
  snap();
  S.lines.push(...made); S.lines.sort((x, y) => x.t - y.t);
  const first = made[0], layer = (['orig', 'tr', 'bgo', 'bg'] as Layer[]).find(k => first.sync?.[k]) || S.layer;
  setLayer(layer); S.sel = { i: S.lines.indexOf(first), k: 0 };
  afterLines(); made.forEach(l => S.picked.add(S.lines.indexOf(l))); emit();
  toast(made.length > 1 ? `Копия: новых строк ${made.length}. Ctrl+Z — отмена.` : `Копия «${plainW(ws.map(x => x.w).join(' '))}» — новая ${isBg(layer) ? 'бэк-строка' : 'строка'}. Ctrl+Z — отмена.`, 'ok');
}
let CLIP: Line[] = [];
const clone = (l: Line): Line => JSON.parse(JSON.stringify(l));
/** Ctrl+C: the picked lines (or the line of the selected word), with all tracks and timings; also as text */
export function copyLines() {
  const ids = S.picked.size ? [...S.picked].sort((x, y) => x - y) : S.sel ? [S.sel.i] : [];
  if (!ids.length) return toast('Выдели строки (клик / Shift / Ctrl в списке) или выбери слово.', 'err');
  CLIP = ids.map(i => clone(S.lines[i]));
  navigator.clipboard?.writeText(CLIP.map(l => lineRow(l, false)).join('\n')).catch(() => {});
  toast(`Скопировано строк: ${CLIP.length}. Ctrl+V — вставить у курсора (тайминги сохранятся).`, 'ok');
}
/** Ctrl+V: the copied lines at the playhead, keeping their spacing and word timings */
export function pasteLines(at = now()) {
  if (!CLIP.length) return toast('Сначала скопируй строки (Ctrl+C) или тащи строку с Alt.', 'err');
  snap();
  const d = at - CLIP[0].t, add = CLIP.map(o => { const c = clone(o); shiftLine(c, o, d); return c; });
  S.lines.push(...add); S.lines.sort((x, y) => x.t - y.t);
  S.sel = { i: S.lines.indexOf(add[0]), k: 0 };
  afterLines(); add.forEach(l => S.picked.add(S.lines.indexOf(l))); emit();
  toast(`Вставлено строк: ${add.length} с ${fmtTime(Math.max(0, at))}. Ctrl+Z — отмена.`, 'ok');
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

/* ---------- copy one line's word timing onto other lines (Ctrl+Shift+C / Ctrl+Shift+V) ---------- */
let TCLIP: { rel: { a: number; b: number }[]; from: number } | null = null;
export function copyTiming() {
  if (!S.sel) return toast('Выбери слово в размеченной строке.', 'err');
  const rel = timingOf(S.lines[S.sel.i], S.layer);
  if (!rel) return toast('Эта строка размечена не до конца — сначала разметь все её слова.', 'err');
  TCLIP = { rel, from: S.sel.i };
  toast(`Тайминг строки ${S.sel.i + 1} скопирован (${rel.length} слов). Выдели строки в списке (клик / Shift / Ctrl) или кликни слово другой строки → Ctrl+Shift+V.`, 'ok');
}
/** onto the picked lines (or the line of the selected word), current track; anchored at its first hand-marked word or the line start */
export function pasteTimingHere() {
  if (!TCLIP) return toast('Сначала скопируй тайминг строки: Ctrl+Shift+C на размеченной строке.', 'err');
  const ids = S.picked.size ? [...S.picked] : S.sel ? [S.sel.i] : [];
  if (!ids.length) return toast('Выдели строки, куда вставить тайминг.', 'err');
  snap(); let n = 0;
  for (const i of ids) {
    const l = S.lines[i], k = wordsOf(i, S.layer).length; if (!l || !k) continue;
    const first = l.sync?.[S.layer]?.[0], t0 = first && first.a != null && !first.g ? first.a - TCLIP.rel[0].a : l.t;
    (l.sync = l.sync || {})[S.layer] = pasteTiming(TCLIP.rel, k, t0); n++;
  }
  if (!n) { S.undo.pop(); return toast('В выделенных строках нет слов на этой дорожке.', 'err'); }
  afterSyncChange(true);
  toast(`Тайминг вставлен в строк: ${n}. Пунктир = авто, проверь на слух. Разное число слов — ритм растянут под них. Ctrl+Z — отмена.`, 'ok');
}

/* ---------- shift every line after the playhead (or the whole song) — LRC from another version of the track ---------- */
export function shiftLines(ms: number, all = false) {
  if (!ms || !S.lines.length) return;
  const from = all ? -1 : now() - 0.01; let n = 0;
  snap();
  for (const l of S.lines) if (l.t >= from) { shiftLine(l, clone(l), ms / 1000); n++; }
  if (!n) { S.undo.pop(); return toast('После курсора строк нет.', 'err'); }
  S.lines.sort((x, y) => x.t - y.t); afterLines();
  toast(`${ms > 0 ? '+' : ''}${ms} мс: сдвинуто строк ${n}${all ? ' (вся песня)' : ' после курсора'}, со всеми словами. Ctrl+Z — отмена.`, 'ok');
}

/** fit the timings to another version of the track: old length -> new length (s) */
export function stretchAll(from: number, to: number) {
  if (!S.lines.length || !(from > 0) || !(to > 0)) return toast('Укажи обе длительности, например 3:42 и 3:31.', 'err');
  const k = to / from; if (Math.abs(k - 1) < 1e-4) return toast('Длительности совпадают — растягивать нечего.', 'err');
  snap(); stretchLines(S.lines, k); S.duration = Math.max(S.duration, to); S.srcDur = to;
  afterLines();
  toast(`Тайминги ${k > 1 ? 'растянуты' : 'сжаты'} на ${Math.abs((k - 1) * 100).toFixed(2)}% (${fmtTime(from)} → ${fmtTime(to)}). Если начало «уехало» — поправь «Сдвигом строк». Ctrl+Z — отмена.`, 'ok');
}
/** clear every word timing of a line (all tracks) — room to paste a timing into */
export function clearTiming(i: number) {
  const l = S.lines[i]; if (!l?.sync) return toast('У строки и так нет разметки.', 'err');
  snap(); delete l.sync; afterSyncChange(false, i);
  toast(`Разметка строки ${i + 1} очищена — слова снова равномерные (пунктир). Ctrl+Z — отмена.`, 'ok');
}
export function duplicateLine(i: number) {
  const l = S.lines[i]; if (!l) return;
  snap(); const c = clone(l); shiftLine(c, l, Math.max(0.5, l.end - l.t)); S.lines.push(c); S.lines.sort((x, y) => x.t - y.t);
  S.sel = { i: S.lines.indexOf(c), k: 0 }; afterLines(); S.picked.add(S.sel.i); emit();
  toast('Копия строки поставлена сразу за ней — тащи её за полосу строк куда нужно.', 'ok');
}
/** Alt+drag of a line dropped onto another line: that line gets the dragged rhythm (its own words stay) */
export function dropTimingOnto(src: Line, dst: number, t0: number) {
  const d = S.lines[dst]; if (!d) return;
  const n = transferTiming(src, d, t0);
  if (!n) return toast('Нечего переносить: у перетащенной строки нет полностью размеченных дорожек, общих с этой.', 'err');
  S.lines.sort((x, y) => x.t - y.t); S.sel = { i: S.lines.indexOf(d), k: 0 }; afterLines();
  toast(`Тайминг перенесён на строку «${plainW(d.text || d.bg?.text || '')}» (дорожек: ${n}). Пунктир — проверь на слух. Ctrl+Z — отмена.`, 'ok');
}

/** a translation typed on a line goes to its repeats (same original) that have none yet */
export function fillRepeats(from?: number) {
  if (!repeatTranslations(JSON.parse(JSON.stringify(S.lines)), from).length) { if (from == null) toast('Повторов без перевода нет.', 'err'); return; } // dry run: blur must not clear redo
  snap(); const n = repeatTranslations(S.lines, from).length;
  after(); toast(`Перевод подставлен в повторы той же строки: ${n}. Ctrl+Z — отмена.`, 'ok');
}

/** a line's start / end = its timed words (one line, or every line when i is omitted) */
export function fitLines(i?: number) {
  const ids = i != null ? [i] : S.lines.map((_, k) => k);
  snap(); let n = 0;
  for (const k of ids) { const l = S.lines[k], t = l.t, e = l.end; if (fitLineToWords(l, { a: S.fitPad.a / 1000, b: S.fitPad.b / 1000 }) && (l.t !== t || l.end !== e)) n++; }
  if (!n) { S.undo.pop(); return toast(i != null ? 'Строка уже по словам (или в ней нет размеченных слов).' : 'Все строки уже по словам.', 'ok'); }
  const sl = S.sel ? S.lines[S.sel.i] : null; S.lines.sort((x, y) => x.t - y.t); if (sl && S.sel) S.sel.i = S.lines.indexOf(sl);
  afterLines(); toast(`Строк подогнано под слова: ${n}. Ctrl+Z — отмена.`, 'ok');
}

/** «Строки сами по словам»: from now on every line with a fully timed track follows its words (with the slack) */
export function setAutoFit(on: boolean) {
  S.autoFit = on; ls.set('autoFit', on ? '1' : '0');
  if (on) { snap(); const n = S.lines.filter(fitsWords).length; afterSyncChange(true); afterLines(); toast(`Строки следуют за своими словами (сейчас размечено строк: ${n}). Ctrl+Z — отменить подгонку.`, 'ok'); }
  else { emit(); toast('Автоподгонка строк выключена — края строк остаются, где их оставили.', 'ok'); }
}
export function setFitPad(k: 'a' | 'b', ms: number) { S.fitPad = { ...S.fitPad, [k]: ms }; ls.set('fitPad', JSON.stringify(S.fitPad)); if (S.autoFit) afterSyncChange(true); else emit(); }
