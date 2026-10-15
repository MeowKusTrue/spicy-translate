// DaVinci-style mouse editing on the wave: magnet snapping, roll (joined edges move together),
// Alt = detach, no overlaps, move with glued neighbours, paint in the lane, pan/seek on the wave, Ctrl+wheel zoom.
// Two word lanes (main track, background vocals): clicking the other lane switches to it. The lines band at the
// bottom drags a whole line (all its words on every track). Double click edits text in place.
import { S, clamp, conf, emit, ensureSync, isBg, isTr, ls, mkLayer, r3, spreadLine, wordsOf } from '../state.ts';
import { lineEdgeAt, moveEdge, moveLineEdge, moveWord, nearest, seqWords as coreSeq, shiftLine, snapSpan, startEdge, startMove, type Layer, type Seq, type WordSync } from '../core/index.ts';
import { now, playWord, seekTo } from '../audio.ts';
import { buildPreview, refreshPreviewLine } from '../preview.ts';
import { scheduleSave } from '../persist.ts';
import { fitLines, selectWord, setLayer, snap, stepSel } from '../sync.ts';
import { clearTiming, fitLines as fitToWords, closeEdit, copyTiming, delLine, dropCopies, dropTimingOnto, duplicateLine, editing, focusRow, newLineEdit, openEdit, pasteTimingHere } from '../lineEdit.ts';
import { JOIN, LANES, LANES_DEF, W, drawWave, waveOnsets, laneLayer, laneY, lineAt, songLen, zoomAt, type Box, type Lane } from './wave.ts';
import { fmtTime, plainW } from '../core/index.ts';

type Hit = { type: 'edge'; t: number; lane: Lane; d: number; b: Box; edge: 'a' | 'b' } | { type: 'word'; t: number; lane: Lane; b: Box }
  | { type: 'lane'; t: number; lane: Lane; b?: undefined } | { type: 'split'; t: number; which: 'm' | 'b' | 'l'; lane?: undefined; b?: undefined } | { type: 'wave'; t: number; lane?: undefined; b?: undefined } | { type: 'band'; t: number; i: number; lane?: undefined; b?: undefined } | { type: 'ledge'; t: number; i: number; edge: 'a' | 'b'; lane?: undefined; b?: undefined };

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
    else if (h.type === 'lane') html = `<small>2× — ${lineAt(h.t) >= 0 ? 'вписать текст строки' : 'новая строка'} на дорожке «${h.lane === 'bg' ? 'бэк' : 'основа'}» · Shift+тащи — выбрать рамкой</small>`;
  }
  el.hidden = !html; if (!html) return;
  el.innerHTML = html; el.style.left = Math.min(innerWidth - el.offsetWidth - 8, e.clientX + 14) + 'px'; el.style.top = (e.clientY - el.offsetHeight - 12) + 'px';
}
const esc = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));

/** right click on a line in the band: what you can do with that line */
function lineMenu(e: MouseEvent, i: number) {
  document.getElementById('lineMenu')?.remove(); if (i < 0) return;
  const m = document.createElement('div'); m.id = 'lineMenu'; m.className = 'pop ctx';
  const item = (label: string, f: () => void, off = false) => { const b = document.createElement('button'); b.className = 'sm'; b.textContent = label; b.disabled = off; b.onclick = () => { m.remove(); f(); }; m.appendChild(b); };
  const sel = () => { S.sel = { i, k: 0 }; S.picked.clear(); };
  const h = document.createElement('small'); h.textContent = `строка ${i + 1}: ${plainW(S.lines[i].text || S.lines[i].bg?.text || 'бэк')}`; m.appendChild(h);
  item('⧉ Копировать тайминг строки', () => { sel(); copyTiming(); });
  item('⧉ Вставить тайминг сюда', () => { sel(); pasteTimingHere(); });
  item('⇔ Подогнать строку под слова', () => fitToWords(i), !S.lines[i].sync);
  item('⌫ Очистить тайминг (освободить)', () => clearTiming(i), !S.lines[i].sync);
  item('⎘ Дублировать строку', () => duplicateLine(i));
  item('✎ К строке в списке', () => focusRow(i, isTr(S.layer) ? 'input.tr' : 'input.o'));
  item('🗑 Удалить строку', () => delLine(i));
  document.body.appendChild(m);
  m.style.left = Math.min(innerWidth - m.offsetWidth - 8, e.clientX) + 'px'; m.style.top = Math.max(8, e.clientY - m.offsetHeight - 6) + 'px';
  const off = (ev: MouseEvent) => { if (!m.contains(ev.target as Node)) { m.remove(); removeEventListener('mousedown', off, true); } };
  setTimeout(() => addEventListener('mousedown', off, true));
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
    if (e.button === 2) { if (h.b) playWord({ a: h.b.a, b: h.b.b }); else if ((h.type === 'band' || h.type === 'ledge') && h.i >= 0) lineMenu(e, h.i); return; }
    lineMenu(e, -1);
    if (editing()) closeEdit(true);
    if (h.type === 'split') { W.drag = { type: 'split', which: h.which, y0: my, v0: { m: W.G.mH, b: W.G.bH, l: W.G.lH }[h.which] }; return; }
    if (h.type === 'ledge' && !e.altKey) { snap(); S.sel = { i: h.i, k: 0 }; W.drag = { type: 'ledge', l: S.lines[h.i], i: h.i, edge: h.edge, cands: buildCands(new Set()) }; return; }
    // Shift: click a word = add/remove it from the pick, drag on empty space = pick words with a box
    if (e.shiftKey && h.b) { const m = W.multi, x = m.findIndex(q => q.i === h.b!.i && q.k === h.b!.k && q.layer === h.b!.layer); if (x >= 0) m.splice(x, 1); else m.push({ i: h.b.i, k: h.b.k, layer: h.b.layer }); drawWave(); return; }
    if (e.shiftKey && !h.b && h.type !== 'band') { W.pend = { type: 'box', x0: mx, y0: my }; return; }
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
    else if (h.type === 'lane' && !switched && S.sel && wordsOf(S.sel.i, S.layer).length) W.pend = { type: 'paint', x0: mx, t0: h.t };
    else if (h.type === 'band' && h.i >= 0) W.pend = { type: 'line', x0: mx, t0: h.t, i: h.i, alt: e.altKey };
    else W.pend = { type: 'pan', x0: mx, start0: W.start, t0: h.t };
  };
  const onMove = (e: MouseEvent) => {
    const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    W.ctrl = e.ctrlKey || e.metaKey;
    if (W.pend && !W.drag && Math.abs(mx - W.pend.x0) > 3) {
      const p = W.pend;
      if (p.type === 'box') W.drag = { type: 'box', x0: p.x0, y0: p.y0, x1: mx, y1: my };
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
      const h = waveHit(mx, my); cv.style.cursor = h.type === 'split' ? 'row-resize' : h.type === 'ledge' ? 'ew-resize' : e.altKey && (h.b || (h.type === 'band' && h.i >= 0)) ? 'copy' : h.type === 'edge' ? 'ew-resize' : h.type === 'word' ? 'grab' : h.type === 'lane' && laneLayer(h.lane) === S.layer && S.sel ? 'crosshair' : h.type === 'band' && h.i >= 0 ? 'move' : 'default';
      tip(e, h);
    } else tip(e, null);
  };
  const onUp = () => {
    if (W.pend) { if (W.pend.type === 'pan' || W.pend.type === 'paint' || W.pend.type === 'line') seekTo(W.pend.t0); W.pend = null; return; }
    if (W.drag) {
      const d = W.drag; W.drag = null; W.snapAt = null;
      if (d.type === 'split') { LANES.m = W.G.mH; LANES.b = W.G.bH; LANES.l = W.G.lH; ls.set('lanes', JSON.stringify(LANES)); return; }
      if (d.type === 'wcopy') return dropCopies([{ layer: laneLayer(d.lane), w: d.w, a: d.a, b: d.a + d.len }]);
      if (d.type === 'box') { // pick every word whose block meets the box; a box only over the wave picks both tracks
        const t0 = W.start + Math.min(d.x0, d.x1) / W.px, t1 = W.start + Math.max(d.x0, d.x1) / W.px, y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1);
        const lanes = (['main', 'bg'] as Lane[]).filter(l => { const [y, hh] = laneY(l); return y1 >= y && y0 <= y + hh; });
        W.multi = W.boxes.filter(b => b.real && b.b >= t0 && b.a <= t1 && (!lanes.length || lanes.includes(b.lane))).map(b => ({ i: b.i, k: b.k, layer: b.layer }));
        drawWave(); return;
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
      if (d.type === 'line') { // keep lines ordered by start; the selection follows its line
        const sl = S.sel ? S.lines[S.sel.i] : null; S.lines.sort((x, y) => x.t - y.t);
        if (sl && S.sel) S.sel.i = S.lines.indexOf(sl); S.picked.clear(); buildPreview(true);
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
