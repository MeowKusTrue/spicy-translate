// Waveform canvas: state W, peaks, drawing, zoom.
import { mmss, plainW } from '../core/index.ts';
import { S, clamp, status, viewWords } from '../state.ts';
import { now } from '../audio.ts';
import { computePeaks } from './peaks.ts';
import PeaksWorker from './peaks.worker.ts?worker&inline';

export type Box = { i: number; k: number; a: number; b: number; real: boolean; g: boolean };
export const W = {
  peaks: null as Float32Array | null, pps: 200, px: 140, start: 0, LANE: 46,
  drag: null as any, pend: null as any, boxes: [] as Box[], ctrl: false,
  snapAt: null as number | null, flash: null as { t: number; kind: 'F' | 'G' | 'H'; at: number } | null,
};
export const JOIN = 0.0015; // edges closer than this are "glued" and roll together

function peaksInWorker(ch: Float32Array, per: number) {
  return new Promise<Float32Array>((res, rej) => {
    let wk: Worker; try { wk = new PeaksWorker(); } catch (e) { return rej(e); }
    wk.onmessage = e => { res(e.data); wk.terminate(); }; wk.onerror = e => { rej(e); wk.terminate(); };
    wk.postMessage({ ch, per }, [ch.buffer]);
  });
}
export async function buildPeaks(file: Blob) {
  W.peaks = null;
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext; if (!AC) return;
    const ctx = new AC(); const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    const per = Math.max(1, Math.floor(buf.sampleRate / W.pps)), ch = buf.getChannelData(0).slice();
    try { W.peaks = await peaksInWorker(ch, per); }
    catch { W.peaks = computePeaks(buf.getChannelData(0), per); } // no workers -> same scan on the main thread
    ctx.close && ctx.close();
  } catch (e) { status('st1', 'Волну построить не удалось (' + (e as Error).message + '), но аудио играет.', 'err'); }
}

const canvas = () => document.getElementById('wave') as HTMLCanvasElement | null;
export function drawWave() {
  const cv = canvas(); if (!cv || !S.dock) return;
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  const t = now();
  if (S.playing && !W.drag) { if (t < W.start || t > W.start + w / W.px * 0.8) W.start = Math.max(0, t - w / W.px * 0.25); }
  const t0 = W.start, t1 = t0 + w / W.px, X = (tt: number) => (tt - t0) * W.px;
  const LANE = W.LANE, mid = LANE + (h - LANE) / 2, amp = (h - LANE) / 2 - 4;
  // ruler
  g.fillStyle = 'rgba(255,255,255,.35)'; g.font = '10px ui-monospace,monospace'; g.textBaseline = 'top';
  const step = W.px > 400 ? 0.5 : W.px > 150 ? 1 : W.px > 60 ? 2 : 5;
  for (let s = Math.ceil(t0 / step) * step; s < t1; s += step) { const x = X(s); g.fillRect(x, h - 6, 1, 6); g.fillText(mmss(s) + (step < 1 ? '.' + Math.round((s % 1) * 10) : ''), x + 3, h - 15); }
  // waveform
  if (W.peaks) {
    g.fillStyle = 'rgba(182,156,255,.55)';
    for (let x = 0; x < w; x++) {
      const a = Math.floor((t0 + x / W.px) * W.pps), b = Math.max(a + 1, Math.floor((t0 + (x + 1) / W.px) * W.pps));
      let m = 0; for (let i = Math.max(0, a); i < b && i < W.peaks.length; i++) if (W.peaks[i] > m) m = W.peaks[i];
      const hh = Math.max(1, m * amp); g.fillRect(x, mid - hh, 1, hh * 2);
    }
  } else { g.fillStyle = 'rgba(255,255,255,.25)'; g.font = '12px system-ui'; g.textBaseline = 'middle'; g.fillText('Загрузи аудио (♪ аудио) — тут появится волна', 14, mid); }
  // word boxes
  W.boxes = [];
  g.font = '600 15px system-ui'; g.textBaseline = 'middle';
  for (let i = 0; i < S.lines.length; i++) {
    const l = S.lines[i]; if (l.end + 8 < t0 || l.t - 8 > t1) continue;
    const vw = viewWords(i, S.layer);
    vw.forEach((wd, k) => {
      if (wd.a == null || wd.b == null) return;
      const x1 = X(wd.a), x2 = X(wd.b); if (x2 < -2 || x1 > w + 2) return;
      const sel = S.sel && S.sel.i === i && S.sel.k === k;
      if (wd.real) {
        g.fillStyle = sel ? 'rgba(255,122,200,.45)' : wd.g ? 'rgba(182,156,255,.16)' : 'rgba(182,156,255,.35)'; g.fillRect(x1, 3, Math.max(2, x2 - x1), LANE - 6);
        g.fillStyle = 'rgba(255,255,255,.28)'; g.fillRect(x1, LANE, 1, h - LANE); g.fillRect(x2, LANE, 1, h - LANE);
        g.strokeStyle = sel ? '#ff7ac8' : 'rgba(182,156,255,.9)'; g.lineWidth = 1; g.fillStyle = sel ? '#ff7ac8' : 'rgba(182,156,255,.95)'; g.fillRect(x1, 3, 3, LANE - 6); g.fillRect(x2 - 3, 3, 3, LANE - 6); if (wd.g) g.setLineDash([3, 3]); g.strokeRect(x1 + .5, 3.5, Math.max(2, x2 - x1) - 1, LANE - 7); g.setLineDash([]);
      } else { g.setLineDash([3, 3]); g.strokeStyle = sel ? '#ff7ac8' : 'rgba(255,255,255,.25)'; g.strokeRect(x1 + .5, 3.5, Math.max(2, x2 - x1) - 1, LANE - 7); g.setLineDash([]); }
      g.save(); g.beginPath(); g.rect(x1 + 2, 3, Math.max(0, x2 - x1 - 4), LANE - 6); g.clip();
      g.fillStyle = wd.real ? '#fff' : 'rgba(255,255,255,.45)'; g.fillText((wd.b - wd.a >= 1 ? '✦ ' : '') + plainW(wd.word) + (wd.sp === false ? '-' : ''), x1 + 5, LANE / 2 + 1); g.restore();
      W.boxes.push({ i, k, a: wd.a, b: wd.b, real: !!wd.real, g: !!wd.g });
    });
  }
  // joined edges (touching words) get a bright joint so you can see what moves together
  const rb = W.boxes.filter(b => b.real).sort((p, q) => p.a - q.a);
  for (let q = 0; q + 1 < rb.length; q++) if (Math.abs(rb[q].b - rb[q + 1].a) <= JOIN) { const jx = X(rb[q].b); g.fillStyle = '#fff'; g.fillRect(jx - 1, 3, 2, LANE - 6); }
  // playhead
  const px = X(t); g.fillStyle = '#fff'; g.fillRect(px, 0, 1.5, h);
  if (W.flash) { // F/G/H mark flash
    const age = (performance.now() - W.flash.at) / 800;
    if (age < 1) { const fx = X(W.flash.t), col = { F: '110,231,183', G: '182,156,255', H: '255,122,200' }[W.flash.kind]; g.fillStyle = `rgba(${col},${(1 - age).toFixed(2)})`; g.fillRect(fx - 1.5, 0, 3, h); g.font = '800 13px ui-monospace,monospace'; g.textBaseline = 'top'; g.fillText(W.flash.kind, fx + 5, LANE + 4); }
    else W.flash = null;
  }
  if (W.snapAt != null && W.drag) { const sx = X(W.snapAt); g.fillStyle = '#ffd166'; g.fillRect(sx - 0.75, 0, 1.5, h); g.font = '11px ui-monospace,monospace'; g.fillText('🧲 ' + W.snapAt.toFixed(3), sx + 5, h - 24); }
}

export function zoomAt(mx: number, f: number) { const ta = W.start + mx / W.px; W.px = Math.min(1500, Math.max(20, W.px * f)); W.start = Math.max(0, ta - mx / W.px); }
export function centerOnSel() {
  if (!S.sel) return; const vw = viewWords(S.sel.i, S.layer), ws = vw.filter(x => x.a != null); if (!ws.length) return;
  const a = ws[0].a!, b = ws[ws.length - 1].b!, width = canvas()?.clientWidth || 800;
  W.px = clamp(width * 0.8 / Math.max(0.5, b - a), 40, 600); W.start = Math.max(0, a - (width * 0.1) / W.px);
}
