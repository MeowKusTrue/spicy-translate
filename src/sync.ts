// Word sync actions (hotkeys AND toolbar buttons use these) + undo/redo on text+sync snapshots.
import { fitBgOnly, plainW, sameLines, splitWords, syllabify, units, unitsText, type Layer } from './core/index.ts';
import { S, conf, emit, ensureSync, fillLine, layerText, lineState, r3, setText, spreadLine, toast, viewWords, wordsOf, type ViewWord } from './state.ts';
import { now, playWord } from './audio.ts';
import { buildPreview, refreshPreviewLine } from './preview.ts';
import { scheduleSave } from './persist.ts';
import { W, drawWave } from './waveform/wave.ts';

/* ---------- undo ---------- */
// whole lines: undo also covers inserted / deleted / moved lines
const stateJSON = () => JSON.stringify(S.lines);
export function snap() { S.undo.push(stateJSON()); if (S.undo.length > 200) S.undo.shift(); S.redo = []; }
export function restore(json: string) {
  const txt = (ls: typeof S.lines) => JSON.stringify(ls.map(l => [l.t, l.end, l.text, l.tr, l.bg, l.agent]));
  const before = txt(S.lines); S.lines = JSON.parse(json); W.multi = [];
  if (S.sel && S.sel.i >= S.lines.length) S.sel = S.lines.length ? { i: S.lines.length - 1, k: 0 } : null;
  if (txt(S.lines) !== before) { S.picked.clear(); buildPreview(true); }
  afterSyncChange(true);
}
export function doUndo() { if (!S.undo.length) return; S.redo.push(stateJSON()); restore(S.undo.pop()!); }
export function doRedo() { if (!S.redo.length) return; S.undo.push(stateJSON()); restore(S.redo.pop()!); }
/** background-only lines follow their words; lines stay ordered by start, the selection follows its line */
export function fitLines() {
  const sl = S.sel ? S.lines[S.sel.i] : null; let moved = false;
  S.lines.forEach(l => { const t = l.t; fitBgOnly(l); if (l.t !== t) moved = true; });
  if (!moved) return false;
  S.lines.sort((x, y) => x.t - y.t); if (sl && S.sel) S.sel.i = S.lines.indexOf(sl); S.picked.clear(); buildPreview(true);
  return true;
}
export function afterSyncChange(all: boolean, i = 0) {
  if (fitLines()) all = true;
  if (all) S.lines.forEach((_, k) => refreshPreviewLine(k)); else refreshPreviewLine(i);
  emit(); drawWave(); scheduleSave();
}

/* ---------- word selection + marking ---------- */
/** switch what the keys and the wave edit: track (main / bg) × language; both tracks stay visible on the wave */
export function setLayer(l: Layer) {
  S.layer = l;
  if (S.sel) S.sel.k = Math.max(0, Math.min(S.sel.k, wordsOf(S.sel.i, l).length - 1));
  emit(); drawWave();
}
export function selectWord(i: number, k: number) {
  if (i < 0 || i >= S.lines.length) return;
  S.sel = { i, k };
  let ch = false; for (let j = Math.max(0, i - 1); j <= Math.min(S.lines.length - 1, i + 2); j++) ch = fillLine(j, S.layer) || ch;
  if (ch) afterSyncChange(true); else emit();
}
function posList() { const out: { i: number; k: number }[] = []; S.lines.forEach((_, i) => wordsOf(i, S.layer).forEach((_, k) => out.push({ i, k }))); return out; }
export function stepSel(d: number) {
  const L = posList(); if (!L.length) return null;
  let cur = S.sel ? L.findIndex(p => p.i === S.sel!.i && p.k === S.sel!.k) : -1;
  if (cur < 0) cur = 0; return L[Math.max(0, Math.min(L.length - 1, cur + d))];
}
export function stepWord(d: number) { const n = stepSel(d); if (n) selectWord(n.i, n.k); }
export function flashBtn(id: string) { const b = document.getElementById(id); if (!b) return; b.classList.remove('hit'); void b.offsetWidth; b.classList.add('hit'); }
function flashChip() { requestAnimationFrame(() => { const c = document.querySelector<HTMLElement>('#syncLines .chip.sel'); if (c) { c.classList.remove('hit'); void c.offsetWidth; c.classList.add('hit'); } }); }

/** the line finished last (H/G on its last word moves the selection on, C still means that line) */
export const CH = { last: -1 };
export function mark(kind: 'F' | 'G' | 'H') {
  if (!S.sel) return;
  const ws = wordsOf(S.sel.i, S.layer);
  if (!ws.length) { const n = stepSel(1); if (n) selectWord(n.i, n.k); return; }
  if (S.sel.k >= ws.length) S.sel.k = 0;
  snap();
  const sy = ensureSync(S.sel.i, S.layer), w = sy[S.sel.k];
  const t = r3(Math.max(0, now() - (S.lat || 0) / 1000 * S.rate));
  const last = S.sel.k === ws.length - 1, li = S.sel.i;
  W.flash = { t, kind, at: performance.now() }; flashBtn('wb' + kind);
  if (kind === 'F') { w.a = t; if (w.b != null && w.b < t) w.b = null; }
  else {
    if (w.a == null) w.a = (S.sel.k > 0 && sy[S.sel.k - 1].b != null) ? sy[S.sel.k - 1].b : r3(Math.max(0, t - 0.15));
    w.b = Math.max(t, w.a!); conf(w);
    if (kind === 'G' && !last) { const n = sy[S.sel.k + 1]; n.a = w.b; if (n.b != null && n.b < n.a) n.b = null; }
    const nx = stepSel(1); if (nx) S.sel = { i: nx.i, k: nx.k };
  }
  afterSyncChange(false, li);
  if (kind !== 'F' && last && lineState(li, S.layer) === 'done') { CH.last = li; const k = sameLines(S.lines, li).length; if (k) toast(`Эта строка повторяется ещё ${k} раз — C (или «Строка ⋯ → ⧉ на повторы») перенесёт тайминг.`, 'ok'); }
}
export function nudgeWord(d: number) {
  if (!S.sel) return toast('Сначала выбери слово.', 'err');
  const sy = S.lines[S.sel.i].sync && S.lines[S.sel.i].sync![S.layer], x = sy && sy[S.sel.k];
  if (!x || x.a == null || x.b == null || x.a + d < 0) return;
  snap(); x.a = r3(x.a + d); x.b = r3(x.b + d); conf(x); afterSyncChange(false, S.sel.i);
}
export function resetWord() {
  if (!S.sel) return toast('Сначала выбери слово.', 'err');
  snap(); const x = ensureSync(S.sel.i, S.layer)[S.sel.k]; if (x) { x.a = null; x.b = null; delete x.g; }
  fillLine(S.sel.i, S.layer); afterSyncChange(false, S.sel.i);
}
export function playSel() { if (!S.sel) return; const w = viewWords(S.sel.i, S.layer)[S.sel.k]; if (w && w.a != null) playWord(w as ViewWord & { a: number; b: number }); }
const setLayerText = setText;

export function joinWords() {
  if (!S.sel) return toast('Выбери первое из двух слов.', 'err');
  const { i, k } = S.sel, layer = S.layer, us = units(layerText(S.lines[i], layer));
  if (k >= us.length - 1) return toast('После этого слова нет следующего в строке.', 'err');
  snap(); const sy = ensureSync(i, layer), a = sy[k], b = sy[k + 1], syl = !us[k].sp;
  const m: typeof a = { a: a.a, b: b.b != null ? b.b : a.b }; if (a.g || b.g) m.g = 1;
  us.splice(k, 2, { w: us[k].w + (syl ? '' : ' ') + us[k + 1].w, sp: us[k + 1].sp }); sy.splice(k, 2, m);
  setLayerText(i, layer, unitsText(us)); S.lines[i].sync![layer] = sy;
  buildPreview(true); afterSyncChange(false, i); flashChip();
  toast(syl ? 'Слоги склеены.' : 'Склеено: два слова — один блок тайминга. U — разделить.', 'ok');
}
export function splitWord() {
  if (!S.sel) return toast('Выбери слово.', 'err');
  const { i, k } = S.sel, layer = S.layer, us = units(layerText(S.lines[i], layer)), u = us[k]; if (!u) return;
  const glued = u.w.includes(' '), parts = glued ? u.w.split(' ') : syllabify(u.w);
  if (parts.length < 2) return toast('Один слог — делить нечего. Можно вписать «|» в текст строки вручную (газ|лай|тер).', 'err');
  snap(); const sy = ensureSync(i, layer), x = sy[k];
  const a = x.a != null ? x.a : S.lines[i].t, b = x.b != null ? x.b : S.lines[i].end;
  const nu = parts.map((w, j) => ({ w, sp: j === parts.length - 1 ? u.sp : glued }));
  const nw = splitWords(unitsText(nu), a, b).map(w => ({ a: r3(w.a), b: r3(w.b), ...(x.g ? { g: 1 as const } : {}) }));
  us.splice(k, 1, ...nu); sy.splice(k, 1, ...nw);
  setLayerText(i, layer, unitsText(us)); S.lines[i].sync![layer] = sy;
  buildPreview(true); afterSyncChange(false, i); flashChip();
  toast(glued ? 'Разделено на отдельные слова.' : 'Слоги: ' + parts.join(' · ') + ' — размечай каждый как слово (F / G / H).', 'ok');
}
export function syllabifyLine() {
  if (!S.sel) return toast('Выбери строку (клик по слову).', 'err');
  const i = S.sel.i, layer = S.layer, us = units(layerText(S.lines[i], layer)); if (!us.length) return;
  snap(); const sy = ensureSync(i, layer), nu: typeof us = [], ns: typeof sy = []; let n = 0;
  us.forEach((u, k) => {
    const whole = u.sp && (k === 0 || us[k - 1].sp) && !u.w.includes(' '), parts = whole ? syllabify(u.w) : [u.w], x = sy[k];
    if (parts.length < 2) { nu.push(u); ns.push(x); return; }
    n++; const a = x.a != null ? x.a : S.lines[i].t, b = x.b != null ? x.b : S.lines[i].end;
    const pu = parts.map((w, j) => ({ w, sp: j === parts.length - 1 }));
    nu.push(...pu); ns.push(...splitWords(unitsText(pu), a, b).map(w => ({ a: r3(w.a), b: r3(w.b), ...(x.g ? { g: 1 as const } : {}) })));
  });
  if (!n) { S.undo.pop(); return toast('В строке нет многосложных слов.', 'err'); }
  setLayerText(i, layer, unitsText(nu)); S.lines[i].sync![layer] = ns;
  buildPreview(true); afterSyncChange(false, i); toast(`Разбито на слоги слов: ${n}. M — склеить слог обратно, Ctrl+Z — отмена.`, 'ok');
}

/* ---------- toolbar "Строка ⋯" menu ---------- */
export function spreadSelLine() { if (!S.sel) return toast('Сначала выбери слово (клик по чипу или плашке).', 'err'); snap(); spreadLine(S.sel.i, S.layer); afterSyncChange(false, S.sel.i); toast('Слова строки раскиданы — теперь их можно двигать и растягивать.', 'ok'); }
export function spreadAll() { if (!S.lines.length) return toast('Нет строк.', 'err'); snap(); let n = 0; S.lines.forEach((_, i) => { if (lineState(i, S.layer) !== 'done') { spreadLine(i, S.layer); n++; } }); afterSyncChange(true); toast(`Раскидано строк: ${n} (готовые не тронул). Ctrl+Z — отмена.`, 'ok'); }
export function resetLine() { if (!S.sel) return toast('Сначала выбери слово.', 'err'); snap(); const l = S.lines[S.sel.i]; if (l.sync) delete l.sync[S.layer]; afterSyncChange(false, S.sel.i); toast('Синхра строки сброшена. Ctrl+Z — отмена.', 'ok'); }
export function clearLayer() { if (!S.lines.length) return; snap(); S.lines.forEach(l => { if (l.sync) delete l.sync[S.layer]; }); afterSyncChange(true); toast('Синхра слоя очищена. Ctrl+Z вернёт.', 'ok'); }
export const wordLabel = (i: number, k: number) => { const w = wordsOf(i, S.layer)[k]; return w ? plainW(w) : '—'; };
