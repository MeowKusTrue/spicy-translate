// DaVinci-style mouse editing on the wave: magnet snapping, roll (joined edges move together),
// Alt = detach, no overlaps, move with glued neighbours, paint in the top lane, pan/seek below, Ctrl+wheel zoom.
import { S, clamp, conf, emit, ensureSync, r3, spreadLine, wordsOf } from '../state.ts';
import type { WordSync } from '../core/index.ts';
import { now, playWord, seekTo } from '../audio.ts';
import { refreshPreviewLine } from '../preview.ts';
import { scheduleSave } from '../persist.ts';
import { selectWord, snap, stepSel } from '../sync.ts';
import { JOIN, W, drawWave, zoomAt, type Box } from './wave.ts';

type Seq = { i: number; k: number; x: WordSync & { a: number; b: number } };
type Hit = { type: 'edge'; t: number; d: number; b: Box; edge: 'a' | 'b' } | { type: 'word'; t: number; b: Box } | { type: 'lane' | 'bg'; t: number; b?: undefined };

function waveHit(mx: number, my: number): Hit {
  const t = W.start + mx / W.px, tol = 9 / W.px, lane = my < W.LANE;
  let best: { d: number; b: Box; edge: 'a' | 'b' } | null = null;
  for (const b of W.boxes) {
    if (!b.real) continue;
    for (const edge of ['a', 'b'] as const) { const d = Math.abs(b[edge] - t); if (d <= tol && (!best || d < best.d)) best = { d, b, edge }; }
  }
  if (best) return { type: 'edge', t, ...best };
  if (lane) for (const b of W.boxes) if (t >= b.a && t <= b.b) return { type: 'word', t, b };
  return { type: lane ? 'lane' : 'bg', t };
}
function seqWords(): Seq[] {
  const out: Seq[] = [];
  S.lines.forEach((l, i) => {
    const sy = l.sync && l.sync[S.layer]; if (!sy || sy.length !== wordsOf(i, S.layer).length) return;
    sy.forEach((x, k) => { if (x.a != null && x.b != null) out.push({ i, k, x: x as Seq['x'] }); });
  });
  return out;
}
function buildCands(excl: Set<WordSync>) {
  const out: number[] = []; seqWords().forEach(e => { if (!excl.has(e.x)) out.push(e.x.a, e.x.b); });
  S.lines.forEach(l => out.push(l.t)); return out;
}
function nearestCand(t: number, cands: number[]) {
  if (!S.snap || W.ctrl) return null;
  const tol = 10 / W.px; let best: { d: number; c: number } | null = null;
  for (const c of cands.concat([now()])) { const d = Math.abs(c - t); if (d <= tol && (!best || d < best.d)) best = { d, c }; }
  return best;
}
function snapOne(t: number, cands: number[]) { const n = nearestCand(t, cands); W.snapAt = n ? n.c : null; return n ? n.c : t; }

/** wire mouse handling to the canvas; returns cleanup */
export function setupWave(cv: HTMLCanvasElement) {
  const tAt = (mx: number) => Math.max(0, r3(W.start + mx / W.px));
  cv.onmousedown = e => {
    const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, h = waveHit(mx, my);
    W.ctrl = e.ctrlKey || e.metaKey;
    if (e.button === 2) { if (h.b) playWord({ a: h.b.a, b: h.b.b }); return; }
    if (h.type === 'edge') {
      const sq = seqWords(), idx = sq.findIndex(q => q.i === h.b.i && q.k === h.b.k); if (idx < 0) return;
      const me = sq[idx], x = me.x; let partner: Seq | null = null;
      if (h.edge === 'b') { const n = sq[idx + 1]; if (n && Math.abs(n.x.a - x.b) <= JOIN) partner = n; }
      else { const p = sq[idx - 1]; if (p && Math.abs(p.x.b - x.a) <= JOIN) partner = p; }
      let target = { e: me, edge: h.edge };
      if (partner && e.altKey) { // detach: trim only the side the cursor is on
        const bt = h.edge === 'b' ? x.b : x.a, leftWord = h.edge === 'b' ? me : partner, rightWord = h.edge === 'b' ? partner : me;
        target = h.t < bt ? { e: leftWord, edge: 'b' } : { e: rightWord, edge: 'a' };
      }
      snap(); selectWord(h.b.i, h.b.k);
      const excl = new Set<WordSync>([x]); if (partner) excl.add(partner.x);
      W.drag = { type: 'edge', roll: !!partner && !e.altKey, me, partner, target, sq, edge: h.edge, cands: buildCands(excl), i: h.b.i };
    }
    else if (h.type === 'word') { selectWord(h.b.i, h.b.k); W.pend = { type: 'move', i: h.b.i, k: h.b.k, x0: mx, off: h.t - h.b.a, ghost: !h.b.real }; }
    else if (h.type === 'lane' && S.sel) W.pend = { type: 'paint', x0: mx, t0: h.t };
    else W.pend = { type: 'pan', x0: mx, start0: W.start, t0: h.t };
  };
  const onMove = (e: MouseEvent) => {
    const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    W.ctrl = e.ctrlKey || e.metaKey;
    if (W.pend && !W.drag && Math.abs(mx - W.pend.x0) > 3) {
      const p = W.pend;
      if (p.type === 'move') {
        snap(); if (p.ghost) spreadLine(p.i, S.layer);
        const sq = seqWords(), idx = sq.findIndex(q => q.i === p.i && q.k === p.k);
        if (idx >= 0) {
          const me = sq[idx], pv = sq[idx - 1], nx = sq[idx + 1];
          const jp = !!(pv && Math.abs(pv.x.b - me.x.a) <= JOIN), jn = !!(nx && Math.abs(nx.x.a - me.x.b) <= JOIN);
          const excl = new Set<WordSync>([me.x]); if (jp) excl.add(pv.x); if (jn) excl.add(nx.x);
          W.drag = { type: 'move', i: p.i, me, pv, nx, jp, jn, off: p.off, len: me.x.b - me.x.a, cands: buildCands(excl) };
        }
      }
      else if (p.type === 'paint') { snap(); const sx = ensureSync(S.sel!.i, S.layer)[S.sel!.k]; W.drag = { type: 'paint', i: S.sel!.i, k: S.sel!.k, t0: p.t0, cands: buildCands(new Set([sx])) }; }
      else W.drag = { type: 'pan', x0: p.x0, start0: p.start0 };
      W.pend = null;
    }
    const d = W.drag;
    if (d) {
      if (d.type === 'pan') { W.start = Math.max(0, d.start0 - (mx - d.x0) / W.px); cv.style.cursor = 'grabbing'; return; }
      const traw = tAt(mx);
      if (d.type === 'paint') {
        const t = snapOne(traw, d.cands), w = S.lines[d.i].sync![S.layer]![d.k]; w.a = Math.min(d.t0, t); w.b = Math.max(d.t0, t, w.a + 0.02); conf(w);
      } else if (d.type === 'edge') {
        const t0 = snapOne(traw, d.cands), sq: Seq[] = d.sq;
        if (d.roll) {
          const L = d.edge === 'b' ? d.me : d.partner, R = d.edge === 'b' ? d.partner : d.me;
          const T = clamp(t0, L.x.a + 0.02, R.x.b - 0.02); if (T !== t0) W.snapAt = null;
          L.x.b = T; R.x.a = T; conf(L.x, R.x);
        } else {
          const te: Seq = d.target.e, ti = sq.indexOf(te), pv = sq[ti - 1], nx = sq[ti + 1];
          if (d.target.edge === 'a') { const T = clamp(t0, pv ? pv.x.b : 0, te.x.b - 0.02); if (T !== t0) W.snapAt = null; te.x.a = T; conf(te.x); }
          else { const T = clamp(t0, te.x.a + 0.02, nx ? nx.x.a : 1e9); if (T !== t0) W.snapAt = null; te.x.b = T; conf(te.x); }
        }
      } else if (d.type === 'move') {
        const w = d.me.x, len = d.len, follow = !e.altKey;
        let a = Math.max(0, traw - d.off);
        const na = nearestCand(a, d.cands), nb = nearestCand(a + len, d.cands);
        if (na && (!nb || na.d <= nb.d)) { a = na.c; W.snapAt = na.c; } else if (nb) { a = nb.c - len; W.snapAt = nb.c; } else W.snapAt = null;
        const pv = d.pv, nx = d.nx;
        const lo = follow && d.jp ? pv.x.a + 0.02 : (pv ? pv.x.b : 0);
        const hi = follow && d.jn ? nx.x.b - 0.02 - len : (nx ? nx.x.a - len : 1e9);
        const a2 = clamp(a, lo, hi); if (a2 !== a) W.snapAt = null;
        w.a = r3(a2); w.b = r3(a2 + len); conf(w, follow && d.jp ? pv.x : null, follow && d.jn ? nx.x : null);
        if (follow && d.jp) pv.x.b = w.a; if (follow && d.jn) nx.x.a = w.b;
      }
      refreshPreviewLine(d.i); return;
    }
    if (mx >= 0 && mx <= r.width && my >= 0 && my <= r.height) { const h = waveHit(mx, my); cv.style.cursor = h.type === 'edge' ? 'ew-resize' : h.type === 'word' ? 'grab' : h.type === 'lane' && S.sel ? 'crosshair' : 'default'; }
  };
  const onUp = () => {
    if (W.pend) { if (W.pend.type === 'pan' || W.pend.type === 'paint') seekTo(W.pend.t0); W.pend = null; return; }
    if (W.drag) {
      const d = W.drag; W.drag = null; W.snapAt = null;
      if (d.type === 'paint') { const n = stepSel(1); if (n) S.sel = { i: n.i, k: n.k }; }
      if (d.type !== 'pan') { S.lines.forEach((_, i) => refreshPreviewLine(i)); emit(); drawWave(); scheduleSave(); }
    }
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  cv.oncontextmenu = e => e.preventDefault();
  const onWheel = (e: WheelEvent) => {
    e.preventDefault(); const r = cv.getBoundingClientRect(), mx = e.clientX - r.left;
    if (e.ctrlKey || e.metaKey) zoomAt(mx, e.deltaY < 0 ? 1.18 : 1 / 1.18);
    else W.start = Math.max(0, W.start + (e.deltaX || e.deltaY) / W.px * 1.2);
  };
  cv.addEventListener('wheel', onWheel, { passive: false });
  return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); cv.removeEventListener('wheel', onWheel); };
}
