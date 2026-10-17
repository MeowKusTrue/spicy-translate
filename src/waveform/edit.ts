// DaVinci-style mouse editing on the wave: magnet snapping, roll (joined edges move together),
// Alt = detach, no overlaps, move with glued neighbours, Alt+drag in the lane paints, a drag on empty space draws a
// pick box (words and lines, like in Explorer), pan/seek on the wave, Ctrl+wheel zoom.
// Two word lanes (main track, background vocals): clicking the other lane switches to it. The lines band at the
// bottom drags a whole line (all its words on every track). Double click edits text in place.
import { S, clamp, conf, emit, ensureSync, isBg, isTr, ls, mkLayer, r3, spreadLine, toast, wordsOf } from '../state.ts';
import { lineEdgeAt, moveEdge, moveLineEdge, moveWord, nearest, seqWords as coreSeq, shiftLine, snapSpan, startEdge, startMove, type Layer, type Seq, type WordSync } from '../core/index.ts';
import { now, playWord, seekTo } from '../audio.ts';
import { buildPreview, refreshPreviewLine } from '../preview.ts';
import { scheduleSave } from '../persist.ts';
import { fitLines, selectWord, setLayer, snap, stepSel } from '../sync.ts';
import { pickLine } from '../agents.ts';
import { clearTiming, fitLines as fitToWords, closeEdit, copyTiming, delLine, dropCopies, dropTimingOnto, duplicateLine, editing, focusRow, newLineEdit, openEdit, pasteTimingHere } from '../lineEdit.ts';
import { SEC_H, SEC_Y, JOIN, LANES, LANES_DEF, W, drawWave, waveOnsets, laneLayer, laneY, lineAt, songLen, zoomAt, type Box, type Lane } from './wave.ts';
import { fmtTime, plainW, secCategory, type Section } from '../core/index.ts';

type Hit = { type: 'edge'; t: number; lane: Lane; d: number; b: Box; edge: 'a' | 'b' } | { type: 'word'; t: number; lane: Lane; b: Box }
  | { type: 'lane'; t: number; lane: Lane; b?: undefined } | { type: 'split'; t: number; which: 'm' | 'b' | 'l'; lane?: undefined; b?: undefined } | { type: 'wave'; t: number; lane?: undefined; b?: undefined } | { type: 'band'; t: number; i: number; lane?: undefined; b?: undefined } | { type: 'ledge'; t: number; i: number; edge: 'a' | 'b'; lane?: undefined; b?: undefined } | { type: 'sec'; t: number; s: Section; lane?: undefined; b?: undefined };

function waveHit(mx: number, my: number): Hit {
  const t = W.start + mx / W.px, tol = 9 / W.px, G = W.G;
  // borders between lanes: drag = taller / shorter
  if (Math.abs(my - (G.bY - 1.5)) <= 3) return { type: 'split', t, which: 'm' };
  if (Math.abs(my - (G.wY - 1.5)) <= 3) return { type: 'split', t, which: 'b' };
  if (Math.abs(my - (G.lY - 1)) <= 3) return { type: 'split', t, which: 'l' };
  if (my >= G.lY - 1 && my <= G.lY + G.lH + 1) { // the line in that band row
    const row = clamp(Math.floor((my - G.lY) / (G.lH / W.nr)), 0, W.nr - 1);
    const le = lineEdgeAt(S.lines, t, 6 / W.px, W.rows, row); if (le) return { type: 'ledge', t, i: le.i, edge: le.edge }; // an end of a line: drag = longer / shorter
    let i = -1; S.lines.forEach((l, k) => { if (W.rows[k] === row && t >= l.t && t <= l.end) i = k; });
    return { type: 'band', t, i };
  }
  if (W.secs.length && my >= G.wY + SEC_Y && my <= G.wY + SEC_Y + SEC_H) { const s = W.secs.find(q => t >= q.a && t <= q.b); if (s) return { type: 'sec', t, s }; }
  if (my >= G.wY - 1) return { type: 'wave', t };
  const lane: Lane = my < G.bY - 1 ? 'main' : 'bg', bs = W.boxes.filter(b => b.lane === lane);
  let best: { d: number; b: Box; edge: 'a' | 'b' } | null = null;
  for (const b of bs) {
    if (!b.real) continue;
    for (const edge of ['a', 'b'] as const) { const d = Math.abs(b[edge] - t); if (d <= tol && (!best || d < best.d)) best = { d, b, edge }; }
  }
  if (best) return { type: 'edge', t, lane, ...best };
  for (const b of bs) if (t >= b.a && t <= b.b) return { type: 'word', t, lane, b };
  return { type: 'lane', t, lane };
}
const seqWords = (layer: Layer = S.layer) => coreSeq(S.lines, layer);
// magnet targets: other words of this track, words of the other track (align backing to lead), line starts
function buildCands(excl: Set<WordSync>) {
  const out: number[] = [], other = mkLayer(!isBg(S.layer), isTr(S.layer));
  seqWords().concat(seqWords(other)).forEach(e => { if (!excl.has(e.x)) out.push(e.x.a, e.x.b); });
  S.lines.forEach(l => out.push(l.t));
  if (S.onsetSnap) out.push(...waveOnsets()); // note attacks in the audio (or in the separated voice)
  return out;
}
function nearestCand(t: number, cands: number[]) { return S.snap && !W.ctrl ? nearest(t, cands.concat([now()]), 10 / W.px) : null; }
function snapOne(t: number, cands: number[]) { const n = nearestCand(t, cands); W.snapAt = n ? n.c : null; return n ? n.c : t; }

/** hover hint over the wave: what is under the cursor and what you can do with it */
function tip(e: MouseEvent, h: Hit | null) {
  const el = document.getElementById('waveTip'); if (!el) return;
  let html = '';
  if (h && W.drag == null && W.pend == null) {
    if (h.b) {
      const w = wordsOf(h.b.i, h.b.layer)[h.b.k] || '', d = Math.round((h.b.b - h.b.a) * 1000);
      html = `<b>${esc(plainW(w))}</b> ${fmtTime(h.b.a)}–${fmtTime(h.b.b)} · ${d} мс${h.b.g ? ' · авто' : ''}<br><small>тащи — сдвинуть · края — длина · Alt — копия · Shift — в выбор · 2× — править · ПКМ — слушать</small>`;
    } else if (h.type === 'band' && h.i >= 0) {
      const l = S.lines[h.i];
      html = `<b>${esc(plainW(l.text) || '♪ ' + plainW(l.bg?.text || l.bg?.tr || 'бэк'))}</b> ${fmtTime(l.t)}–${fmtTime(l.end)}<br><small>тащи — сдвинуть · Alt+тащи — копия, а на другую строку — её тайминг · ПКМ — меню · 2× — в список</small>`;
    } else if (h.type === 'ledge') { const l = S.lines[h.i]; html = `<b>${h.edge === 'a' ? 'начало' : 'конец'} строки</b> ${fmtTime(h.edge === 'a' ? l.t : l.end)}<br><small>тяни — длиннее / короче (липнет к словам) · 2× — подогнать под слова</small>`; }
    else if (h.type === 'split') html = '<small>тяни — выше / ниже · 2× — как было</small>';
    else if (h.type === 'sec') html = `<b>${esc(h.s.label)}</b> ${fmtTime(h.s.a)}–${fmtTime(h.s.b)} · строки ${h.s.from + 1}–${h.s.to + 1}<br><small>тащи — сдвинуть всю секцию со словами · клик — играть отсюда · ПКМ — меню</small>`;
    else if (h.type === 'lane') html = `<small>2× — ${lineAt(h.t) >= 0 ? 'вписать текст строки' : 'новая строка'} на дорожке «${h.lane === 'bg' ? 'бэк' : 'основа'}» · тащи — выбрать рамкой (Ctrl — добавить) · Alt+тащи — нарисовать выбранное слово</small>`;
  }
  el.hidden = !html; if (!html) return;
  el.innerHTML = html; el.style.left = Math.min(innerWidth - el.offsetWidth - 8, e.clientX + 14) + 'px'; el.style.top = (e.clientY - el.offsetHeight - 12) + 'px';
}
const esc = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));

/** a small context menu at the mouse: a title and buttons */
function popMenu(e: MouseEvent, title: string, build: (item: (label: string, f: () => void, off?: boolean) => void) => void) {
  document.getElementById('lineMenu')?.remove();
  const m = document.createElement('div'); m.id = 'lineMenu'; m.className = 'pop ctx';
  const h = document.createElement('small'); h.textContent = title; m.appendChild(h);
  build((label, f, off = false) => { const b = document.createElement('button'); b.className = 'sm'; b.textContent = label; b.disabled = off; b.onclick = () => { m.remove(); f(); }; m.appendChild(b); });
  document.body.appendChild(m);
  m.style.left = Math.min(innerWidth - m.offsetWidth - 8, e.clientX) + 'px'; m.style.top = Math.max(8, e.clientY - m.offsetHeight - 6) + 'px';
  const off = (ev: MouseEvent) => { if (!m.contains(ev.target as Node)) { m.remove(); removeEventListener('mousedown', off, true); } };
  setTimeout(() => addEventListener('mousedown', off, true));
}
/** sections: name one from a line / rename / remove (undoable); ask = type the name (prompt) */
function setSec(i: number, label: string | null, ask = true) {
  const l = S.lines[i]; if (!l) return;
  if (label === null) { snap(); delete l.sec; }
  else { const v = (ask ? prompt('Название секции (Припев, Куплет 1, Бридж…): строки от этой до следующей секции', label) : label)?.trim(); if (!v) return; snap(); l.sec = v; }
  emit(); drawWave(); scheduleSave();
}
/** a section starting at line i: quick picks (Куплет gets the next number), own name, rename / remove */
export function secPick(e: MouseEvent, i: number) {
  const l = S.lines[i]; if (!l) return;
  const verses = S.lines.slice(0, i).filter(x => x.sec && secCategory(x.sec) === 'verse').length;
  popMenu(e, l.sec ? `секция «${l.sec}» со строки ${i + 1}` : `секция со строки ${i + 1} до следующей`, item => {
    for (const v of ['Интро', `Куплет ${verses + 1}`, 'Пред-припев', 'Припев', 'Пост-припев', 'Бридж', 'Проигрыш', 'Аутро']) item(v, () => setSec(i, v, false), l.sec === v);
    item('✎ Своё название…', () => setSec(i, l.sec || ''));
    if (l.sec) item('✕ Убрать секцию (строки остаются)', () => setSec(i, null));
  });
}
function secMenu(e: MouseEvent, s: Section) {
  popMenu(e, `${s.label}: строки ${s.from + 1}–${s.to + 1}, ${fmtTime(s.a)}–${fmtTime(s.b)}`, item => {
    item('✎ Переименовать', () => setSec(s.from, s.label));
    item('☰ Выделить строки секции', () => { S.picked = new Set(Array.from({ length: s.to - s.from + 1 }, (_, k) => s.from + k)); S.sel = { i: s.from, k: 0 }; emit(); drawWave(); });
    item('▶ Играть с начала секции', () => seekTo(s.a));
    item('✕ Убрать секцию (строки остаются)', () => setSec(s.from, null));
  });
}
/** right click on a line in the band: what you can do with that line */
function lineMenu(e: MouseEvent, i: number) {
  document.getElementById('lineMenu')?.remove(); if (i < 0) return;
  const sel = () => { S.sel = { i, k: 0 }; S.picked.clear(); };
  popMenu(e, `строка ${i + 1}: ${plainW(S.lines[i].text || S.lines[i].bg?.text || 'бэк')}`, item => {
  item('⧉ Копировать тайминг строки', () => { sel(); copyTiming(); });
  item('⧉ Вставить тайминг сюда', () => { sel(); pasteTimingHere(); });
  item('⇔ Подогнать строку под слова', () => fitToWords(i), !S.lines[i].sync);
  item('⌫ Очистить тайминг (освободить)', () => clearTiming(i), !S.lines[i].sync);
  item('⎘ Дублировать строку', () => duplicateLine(i));
  item('✎ К строке в списке', () => focusRow(i, isTr(S.layer) ? 'input.tr' : 'input.o'));
  item(S.lines[i].sec ? `§ Секция «${S.lines[i].sec}»…` : '§ Секция с этой строки…', () => secPick(e, i));
  item('🗑 Удалить строку', () => delLine(i));
  });
}

/** the whole-song strip: click / drag = move the view there, double click = play from there */
export function setupMini(cv: HTMLCanvasElement) {
  const at = (e: MouseEvent) => { const r = cv.getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width, 0, 1) * songLen(); };
  const go = (e: MouseEvent) => { const w = (document.getElementById('wave')?.clientWidth || 800) / W.px; W.start = Math.max(0, at(e) - w / 2); drawWave(); };
  cv.onmousedown = e => { go(e); const mv = (m: MouseEvent) => go(m), up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); }; addEventListener('mousemove', mv); addEventListener('mouseup', up); };
  cv.ondblclick = e => seekTo(at(e));
}

/** wire mouse handling to the canvas; returns cleanup */
export function setupWave(cv: HTMLCanvasElement) {
  const tAt = (mx: number) => Math.max(0, r3(W.start + mx / W.px));
  cv.onmousedown = e => {
    const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, h = waveHit(mx, my);
    W.ctrl = e.ctrlKey || e.metaKey;
    if (e.button === 2) { if (h.b) playWord({ a: h.b.a, b: h.b.b }); else if ((h.type === 'band' || h.type === 'ledge') && h.i >= 0) lineMenu(e, h.i); else if (h.type === 'sec') secMenu(e, h.s); return; }
    lineMenu(e, -1);
    if (editing()) closeEdit(true);
    if (h.type === 'split') { W.drag = { type: 'split', which: h.which, y0: my, v0: { m: W.G.mH, b: W.G.bH, l: W.G.lH }[h.which] }; return; }
    if (h.type === 'ledge' && !e.altKey) { snap(); S.sel = { i: h.i, k: 0 }; W.drag = { type: 'ledge', l: S.lines[h.i], i: h.i, edge: h.edge, cands: buildCands(new Set()) }; return; }
    // Shift / Ctrl + click a word = add/remove it from the pick
    if ((e.shiftKey || W.ctrl) && h.b) { const m = W.multi, x = m.findIndex(q => q.i === h.b!.i && q.k === h.b!.k && q.layer === h.b!.layer); if (x >= 0) m.splice(x, 1); else m.push({ i: h.b.i, k: h.b.k, layer: h.b.layer }); drawWave(); return; }
    // like in Explorer: a drag on empty space draws a box (words in the lanes, lines in the band); Ctrl adds to the pick
    if (!h.b && (h.type === 'lane' && !e.altKey || (h.type === 'band' && h.i < 0) || (e.shiftKey && h.type !== 'band' && h.type !== 'sec'))) { W.pend = { type: 'box', x0: mx, y0: my, add: W.ctrl || e.shiftKey, t0: h.t, lane: h.lane }; return; }
    // picked lines: Ctrl / Shift + click = pick (on release); dragging one of several picked lines moves them all (Alt: copies)
    if (h.type === 'band' && h.i >= 0 && (W.ctrl || e.shiftKey)) { W.pend = { type: 'pick', x0: mx, i: h.i, e: { shiftKey: e.shiftKey, ctrlKey: true, metaKey: false } }; return; }
    if (h.type === 'band' && h.i >= 0 && S.picked.size > 1 && S.picked.has(h.i)) { W.pend = { type: 'lines', x0: mx, t0: h.t, i: h.i, alt: e.altKey }; return; }
    // a word of the pick: move (or Alt: copy) the whole pick
    if (h.b && W.multi.length > 1 && W.multi.some(q => q.i === h.b!.i && q.k === h.b!.k && q.layer === h.b!.layer)) { W.pend = { type: 'multi', x0: mx, t0: h.t, alt: e.altKey }; return; }
    if (W.multi.length) W.multi = [];
    // clicking the other track switches to it (main <-> background vocals)
    const switched = !!h.lane && laneLayer(h.lane) !== S.layer;
    if (switched) setLayer(laneLayer(h.lane!));
    if (h.type === 'edge') {
      const sq = seqWords(), idx = sq.findIndex(q => q.i === h.b.i && q.k === h.b.k); if (idx < 0) return;
      const ed = startEdge(sq, idx, h.edge, e.altKey, h.t);
      snap(); selectWord(h.b.i, h.b.k);
      const excl = new Set<WordSync>([ed.me.x]); if (ed.partner) excl.add(ed.partner.x);
      W.drag = { type: 'edge', ...ed, edge: h.edge, cands: buildCands(excl), i: h.b.i };
    }
    else if (h.type === 'word') { selectWord(h.b.i, h.b.k); W.pend = { type: 'move', i: h.b.i, k: h.b.k, x0: mx, off: h.t - h.b.a, ghost: !h.b.real, alt: e.altKey, a: h.b.a, len: h.b.b - h.b.a, lane: h.lane }; }
    else if (h.type === 'lane' && !switched && S.sel && wordsOf(S.sel.i, S.layer).length) W.pend = { type: 'paint', x0: mx, t0: h.t }; // Alt+drag on an empty lane: draw the selected word
    else if (h.type === 'band' && h.i >= 0) W.pend = { type: 'line', x0: mx, t0: h.t, i: h.i, alt: e.altKey };
    else if (h.type === 'sec') W.pend = { type: 'sec', x0: mx, t0: h.t, s: h.s };
    else W.pend = { type: 'pan', x0: mx, start0: W.start, t0: h.t };
  };
  const onMove = (e: MouseEvent) => {
    const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    W.ctrl = e.ctrlKey || e.metaKey;
    if (W.pend && !W.drag && Math.abs(mx - W.pend.x0) > 3) {
      const p = W.pend;
      if (p.type === 'box') W.drag = { type: 'box', x0: p.x0, y0: p.y0, x1: mx, y1: my, add: p.add };
      else if (p.type === 'pick') { W.pend = null; return; }
      else if (p.type === 'lines') { // several picked lines at once, every word on every track; the grabbed line's start snaps
        snap(); let ls = [...S.picked].sort((a, b) => a - b).map(i => S.lines[i]).filter(Boolean);
        if (p.alt) { ls = ls.map(l => JSON.parse(JSON.stringify(l))); S.lines.push(...ls); } // Alt: drag out copies
        const grab = ls[[...S.picked].sort((a, b) => a - b).indexOf(p.i)] || ls[0], own = new Set(ls.flatMap(l => Object.values(l.sync || {}).flat()) as WordSync[]);
        W.drag = { type: 'lines', t0: p.t0, a0: grab.t, ls, o: JSON.parse(JSON.stringify(ls)), min: Math.min(...ls.map(l => l.t)), copy: p.alt, cands: buildCands(own).filter(c => !ls.some(l => l.t === c)) };
        if (p.alt) buildPreview(true);
      }
      else if (p.type === 'multi') {
        const items = W.multi.map(q => ({ ...q, x: S.lines[q.i]?.sync?.[q.layer]?.[q.k] })).filter(q => q.x && q.x.a != null && q.x.b != null)
          .map(q => ({ i: q.i, layer: q.layer, w: wordsOf(q.i, q.layer)[q.k], x: q.x!, a: q.x!.a!, b: q.x!.b! }));
        if (!p.alt) snap();
        const lo = Math.min(...items.map(q => q.a));
        W.drag = { type: p.alt ? 'mcopy' : 'mmove', items, t0: p.t0, d: 0, lo, cands: buildCands(new Set(items.map(q => q.x))) };
      }
      else if (p.type === 'move' && p.alt) // Alt+drag = drop a copy of the word (onto either track)
        W.drag = { type: 'wcopy', w: wordsOf(p.i, S.layer)[p.k], off: p.off, a: p.a, len: Math.max(0.05, p.len), lane: p.lane, cands: buildCands(new Set()) };
      else if (p.type === 'move') {
        snap(); if (p.ghost) spreadLine(p.i, S.layer);
        const sq = seqWords(), idx = sq.findIndex(q => q.i === p.i && q.k === p.k);
        if (idx >= 0) {
          const md = startMove(sq, idx), excl = new Set<WordSync>([md.me.x]); if (md.jp) excl.add(md.pv!.x); if (md.jn) excl.add(md.nx!.x);
          W.drag = { type: 'move', i: p.i, ...md, off: p.off, cands: buildCands(excl) };
        }
      }
      else if (p.type === 'paint') { snap(); const sx = ensureSync(S.sel!.i, S.layer)[S.sel!.k]; W.drag = { type: 'paint', i: S.sel!.i, k: S.sel!.k, t0: p.t0, cands: buildCands(new Set([sx])) }; }
      else if (p.type === 'line') {
        snap(); let l = S.lines[p.i];
        if (p.alt) { // Alt+drag = drag out a copy of the whole line
          l = JSON.parse(JSON.stringify(l)); S.lines.splice(p.i + 1, 0, l);
          if (S.sel && S.sel.i > p.i) S.sel.i++; S.picked.clear(); buildPreview(true);
        }
        W.drag = { type: 'line', i: p.i, src: p.alt ? S.lines[p.i] : null, onto: -1, t0: p.t0, o: JSON.parse(JSON.stringify(l)), l, cands: buildCands(new Set(Object.values(l.sync || {}).flat() as WordSync[])).filter(c => c !== l.t) }; }
      else if (p.type === 'sec') { // a whole section: all its lines with every word, start sticks to magnet targets
        snap(); const ls = S.lines.slice(p.s.from, p.s.to + 1), own = new Set(ls.flatMap(l => Object.values(l.sync || {}).flat()) as WordSync[]);
        W.drag = { type: 'sec', from: p.s.from, t0: p.t0, a0: p.s.a, ls, o: JSON.parse(JSON.stringify(ls)), min: Math.min(...ls.map(l => l.t)), cands: buildCands(own).filter(c => !ls.some(l => l.t === c)) };
      }
      else W.drag = { type: 'pan', x0: p.x0, start0: p.start0 };
      W.pend = null;
    }
    const d = W.drag;
    if (d) {
      if (d.type === 'pan') { W.start = Math.max(0, d.start0 - (mx - d.x0) / W.px); cv.style.cursor = 'grabbing'; return; }
      const traw = tAt(mx);
      if (d.type === 'ledge') { moveLineEdge(d.l, d.edge, snapOne(traw, d.cands.filter((c: number) => c !== (d.edge === 'a' ? d.l.t : d.l.end)))); cv.style.cursor = 'ew-resize'; refreshPreviewLine(S.lines.indexOf(d.l)); drawWave(); return; }
      if (d.type === 'split') { LANES[d.which as 'm'] = Math.round(d.v0 + (d.which === 'l' ? -1 : 1) * (my - d.y0)); cv.style.cursor = 'row-resize'; drawWave(); return; }
      if (d.type === 'box') { d.x1 = mx; d.y1 = my; drawWave(); return; }
      if (d.type === 'mmove' || d.type === 'mcopy') { // the first word of the pick snaps, the rest keep their spacing
        const a = snapOne(d.lo + traw - d.t0, d.cands); d.d = Math.max(-d.lo, a - d.lo);
        if (d.type === 'mmove') { for (const q of d.items) { q.x.a = r3(q.a + d.d); q.x.b = r3(q.b + d.d); conf(q.x); } new Set<number>(d.items.map((q: { i: number }) => q.i)).forEach(i => refreshPreviewLine(i)); }
        cv.style.cursor = d.type === 'mcopy' ? 'copy' : 'grabbing'; drawWave(); return;
      }
      if (d.type === 'wcopy') {
        let a = Math.max(0, traw - d.off);
        const na = nearestCand(a, d.cands), nb = nearestCand(a + d.len, d.cands);
        if (na && (!nb || na.d <= nb.d)) { a = na.c; W.snapAt = na.c; } else if (nb) { a = nb.c - d.len; W.snapAt = nb.c; } else W.snapAt = null;
        d.a = r3(a); if (my < W.G.bY - 1) d.lane = 'main'; else if (my < W.G.wY) d.lane = 'bg';
        cv.style.cursor = 'copy'; drawWave(); return;
      }
      if (d.type === 'line' && d.src) { // Alt-copy over another line in the band = give it this timing
        const t = W.start + mx / W.px, inBand = my >= W.G.lY - 2 && my <= W.G.lY + W.G.lH + 2;
        d.onto = inBand ? S.lines.findIndex(l => l !== d.l && l !== d.src && t >= l.t && t <= l.end) : -1;
        cv.style.cursor = 'copy';
      }
      if (d.type === 'sec' || d.type === 'lines') {
        if (d.type === 'lines') cv.style.cursor = d.copy ? 'copy' : 'grabbing';
        const dd = Math.max(-d.min, snapOne(d.a0 + traw - d.t0, d.cands) - d.a0);
        d.ls.forEach((l: typeof S.lines[0], j: number) => { shiftLine(l, d.o[j], dd); refreshPreviewLine(S.lines.indexOf(l)); }); return;
      }
      if (d.type === 'line') { // drag the line start onto a magnet target
        const a = snapOne(d.o.t + traw - d.t0, d.cands); shiftLine(d.l, d.o, a - d.o.t); refreshPreviewLine(S.lines.indexOf(d.l)); return;
      }
      if (d.type === 'paint') {
        const t = snapOne(traw, d.cands), w = S.lines[d.i].sync![S.layer]![d.k]; w.a = Math.min(d.t0, t); w.b = Math.max(d.t0, t, w.a + 0.02); conf(w);
      } else if (d.type === 'edge') {
        const t0 = snapOne(traw, d.cands); if (!moveEdge(d, t0)) W.snapAt = null;
      } else if (d.type === 'move') {
        const s = S.snap && !W.ctrl ? snapSpan(Math.max(0, traw - d.off), d.len, d.cands.concat([now()]), 10 / W.px) : { a: Math.max(0, traw - d.off), at: null };
        W.snapAt = s.at; if (!moveWord(d, s.a, e.shiftKey)) W.snapAt = null; // Shift = move alone (glued neighbours stay)
      }
      refreshPreviewLine(d.i); return;
    }
    if (mx >= 0 && mx <= r.width && my >= 0 && my <= r.height) {
      const h = waveHit(mx, my); cv.style.cursor = h.type === 'split' ? 'row-resize' : h.type === 'ledge' ? 'ew-resize' : e.altKey && (h.b || (h.type === 'band' && h.i >= 0)) ? 'copy' : h.type === 'edge' ? 'ew-resize' : h.type === 'word' ? 'grab' : h.type === 'lane' && laneLayer(h.lane) === S.layer && S.sel && e.altKey ? 'crosshair' : (h.type === 'band' && h.i >= 0) || h.type === 'sec' ? 'move' : 'default';
      tip(e, h);
    } else tip(e, null);
  };
  const onUp = () => {
    if (W.pend) {
      const p = W.pend; W.pend = null;
      if (p.type === 'pick') { pickLine(p.i, p.e); drawWave(); return; }
      if (p.type === 'box' && !p.add) { // a click on empty space: deselect, go there (a click on the other track switches to it)
        W.multi = []; if (S.picked.size) { S.picked.clear(); emit(); } if (p.lane && laneLayer(p.lane) !== S.layer) setLayer(laneLayer(p.lane)); seekTo(p.t0); return;
      }
      if (p.type === 'pan' || p.type === 'paint' || p.type === 'line' || p.type === 'lines') seekTo(p.t0); else if (p.type === 'sec') seekTo(p.s.a);
      return;
    }
    if (W.drag) {
      const d = W.drag; W.drag = null; W.snapAt = null;
      if (d.type === 'split') { LANES.m = W.G.mH; LANES.b = W.G.bH; LANES.l = W.G.lH; ls.set('lanes', JSON.stringify(LANES)); return; }
      if (d.type === 'wcopy') return dropCopies([{ layer: laneLayer(d.lane), w: d.w, a: d.a, b: d.a + d.len }]);
      if (d.type === 'box') { // pick every word whose block meets the box; a box only over the wave picks both tracks
        const t0 = W.start + Math.min(d.x0, d.x1) / W.px, t1 = W.start + Math.max(d.x0, d.x1) / W.px, y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1);
        const lanes = (['main', 'bg'] as Lane[]).filter(l => { const [y, hh] = laneY(l); return y1 >= y && y0 <= y + hh; });
        const G = W.G, band = y1 >= G.lY && y0 <= G.lY + G.lH, onlyBand = band && y0 >= G.lY - 2, hh = G.lH / W.nr;
        const words = onlyBand ? [] : W.boxes.filter(b => b.real && b.b >= t0 && b.a <= t1 && (!lanes.length || lanes.includes(b.lane))).map(b => ({ i: b.i, k: b.k, layer: b.layer }));
        W.multi = d.add ? [...W.multi, ...words.filter(q => !W.multi.some(m => m.i === q.i && m.k === q.k && m.layer === q.layer))] : words;
        if (band) { // lines whose bar in the band meets the box
          const got = S.lines.map((l, i) => ({ l, i })).filter(({ l, i }) => l.end >= t0 && l.t <= t1 && y1 >= G.lY + W.rows[i] * hh && y0 <= G.lY + (W.rows[i] + 1) * hh).map(x => x.i);
          if (!d.add) S.picked.clear(); got.forEach(i => S.picked.add(i)); if (got.length) S.pickAnchor = got[0];
        } else if (!d.add) S.picked.clear();
        emit(); drawWave();
        if (W.multi.length || S.picked.size) toast(`Выбрано${W.multi.length ? ` слов: ${W.multi.length}` : ''}${S.picked.size ? ` строк: ${S.picked.size}` : ''} — тащи любое из них (Alt — копия), Esc — снять выбор.`, 'ok');
        return;
      }
      if (d.type === 'mcopy') { // each source line -> one new line with its copied words
        const by = new Map<number, typeof d.items>(); d.items.forEach((q: { i: number }) => { by.set(q.i, [...(by.get(q.i) || []), q]); });
        const ws: { layer: Layer; w: string; a: number; b: number }[] = [], groups: number[] = [];
        by.forEach(qs => { qs.forEach((q: { layer: Layer; w: string; a: number; b: number }) => ws.push({ layer: q.layer, w: q.w, a: q.a + d.d, b: q.b + d.d })); groups.push(qs.length); });
        W.multi = []; return dropCopies(ws, groups);
      }
      if (d.type === 'paint') { const n = stepSel(1); if (n) S.sel = { i: n.i, k: n.k }; }
      if (d.type === 'line' && d.src && d.onto >= 0) { // dropped onto a line: the copy becomes that line's timing
        const onto = S.lines[d.onto]; S.lines.splice(S.lines.indexOf(d.l), 1);
        return dropTimingOnto(d.l, S.lines.indexOf(onto), d.l.t);
      }
      if (d.type === 'ledge') { const sl = S.sel ? S.lines[S.sel.i] : null; S.lines.sort((x, y) => x.t - y.t); if (sl && S.sel) S.sel.i = S.lines.indexOf(sl); buildPreview(true); }
      if (d.type === 'line' || d.type === 'sec' || d.type === 'lines') { // keep lines ordered by start; the selection follows its line
        const sl = S.sel ? S.lines[S.sel.i] : null; S.lines.sort((x, y) => x.t - y.t);
        if (sl && S.sel) S.sel.i = S.lines.indexOf(sl); S.picked.clear();
        if (d.type === 'lines') d.ls.forEach((l: typeof S.lines[0]) => S.picked.add(S.lines.indexOf(l))); // the moved lines stay picked
        buildPreview(true);
      }
      if (d.type !== 'pan') { if (fitLines()) W.multi = []; S.lines.forEach((_, i) => refreshPreviewLine(i)); emit(); drawWave(); scheduleSave(); }
    }
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  cv.oncontextmenu = e => e.preventDefault();
  cv.onmouseleave = e => tip(e, null);
  // double click: word = edit it, empty space of a line = edit that line's text on this track, nowhere = new line here
  cv.ondblclick = e => {
    const r = cv.getBoundingClientRect(), h = waveHit(e.clientX - r.left, e.clientY - r.top);
    W.pend = null; W.drag = null;
    if (h.type === 'split') { Object.assign(LANES, LANES_DEF); ls.set('lanes', JSON.stringify(LANES)); return drawWave(); }
    if (h.b) { setLayer(h.b.layer); S.sel = { i: h.b.i, k: h.b.k }; return openEdit(h.b.i, h.b.layer, h.b.k); }
    if (h.type === 'band') return h.i >= 0 ? focusRow(h.i, isTr(S.layer) ? 'input.tr' : 'input.o') : newLineEdit(h.t, mkLayer(false, isTr(S.layer)));
    if (h.type === 'wave') return;
    if (h.type === 'sec') return setSec(h.s.from, h.s.label); // double click on a section = rename it
    if (h.type === 'ledge') return fitToWords(h.i); // double click on an end of a line = fit it to its words
    const layer = laneLayer(h.lane), i = lineAt(h.t);
    if (i < 0) return newLineEdit(h.t, layer);
    setLayer(layer); selectWord(i, 0); openEdit(i, layer);
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault(); const r = cv.getBoundingClientRect(), mx = e.clientX - r.left;
    if (e.ctrlKey || e.metaKey) zoomAt(mx, e.deltaY < 0 ? 1.18 : 1 / 1.18);
    else W.start = Math.max(0, W.start + (e.deltaX || e.deltaY) / W.px * 1.2);
  };
  cv.addEventListener('wheel', onWheel, { passive: false });
  return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); cv.removeEventListener('wheel', onWheel); };
}
