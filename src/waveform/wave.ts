// Waveform canvas: state W, peaks, drawing, zoom.
import { mmss, plainW } from '../core/index.ts';
import type { Layer } from '../core/index.ts';
import { S, clamp, isBg, isTr, mkLayer, status, viewWords } from '../state.ts';
import { now } from '../audio.ts';
import { computePeaks } from './peaks.ts';
import PeaksWorker from './peaks.worker.ts?worker&inline';

export type Lane = 'main' | 'bg';
export type Box = { i: number; k: number; a: number; b: number; real: boolean; g: boolean; lane: Lane; layer: Layer };
export const W = {
  peaks: null as Float32Array | null, pps: 200, px: 140, start: 0,
  G: { mY: 3, mH: 44, bY: 50, bH: 32, wY: 85, lY: 140, lH: 24 },
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
/* theme colors ("r,g,b") for the canvas, read from CSS tokens on theme change */
export const TH = { t: '255,255,255', a: '30,215,96', a2: '255,122,200' };
export function readTheme() {
  const pr = document.createElement('i'); document.body.appendChild(pr);
  const rgb = (v: string) => { pr.style.color = `var(${v})`; return (getComputedStyle(pr).color.match(/[\d.]+/g) || []).slice(0, 3).join(','); };
  TH.t = rgb('--txt') || TH.t; TH.a = rgb('--acc') || TH.a; TH.a2 = rgb('--acc2') || TH.a2; pr.remove();
}
/* stacked: main-track words, background-vocals words, the waveform, source lines; ruler at the bottom */
function geo(h: number) {
  const mH = Math.round(clamp(h * 0.2, 30, 46)), bH = Math.round(clamp(h * 0.15, 22, 36)), lH = Math.round(clamp(h * 0.13, 18, 30));
  const mY = 3, bY = mY + mH + 3, wY = bY + bH + 3, lY = h - 17 - lH;
  return { mY, mH, bY, bH, wY, lY, lH };
}
export const laneLayer = (lane: Lane): Layer => mkLayer(lane === 'bg', isTr(S.layer));
export const laneY = (lane: Lane) => lane === 'bg' ? [W.G.bY, W.G.bH] : [W.G.mY, W.G.mH];
export function lineAt(t: number) { let r = -1; S.lines.forEach((l, i) => { if (t >= l.t && t <= l.end) r = i; }); return r; }
export function drawWave() {
  const cv = canvas(); if (!cv || !S.dock) return;
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  const t = now(), G = W.G = geo(h);
  if (S.playing && !W.drag) { if (t < W.start || t > W.start + w / W.px * 0.8) W.start = Math.max(0, t - w / W.px * 0.25); }
  const t0 = W.start, t1 = t0 + w / W.px, X = (tt: number) => (tt - t0) * W.px;
  const mid = (G.wY + G.lY - 2) / 2, amp = (G.lY - 2 - G.wY) / 2 - 2;
  // ruler
  g.fillStyle = `rgba(${TH.t},.35)`; g.font = '10px ui-monospace,monospace'; g.textBaseline = 'top';
  const step = W.px > 400 ? 0.5 : W.px > 150 ? 1 : W.px > 60 ? 2 : 5;
  for (let s = Math.ceil(t0 / step) * step; s < t1; s += step) { const x = X(s); g.fillRect(x, h - 6, 1, 6); g.fillText(mmss(s) + (step < 1 ? '.' + Math.round((s % 1) * 10) : ''), x + 3, h - 15); }
  // waveform
  if (W.peaks) {
    g.fillStyle = `rgba(${TH.a},.55)`;
    for (let x = 0; x < w; x++) {
      const a = Math.floor((t0 + x / W.px) * W.pps), b = Math.max(a + 1, Math.floor((t0 + (x + 1) / W.px) * W.pps));
      let m = 0; for (let i = Math.max(0, a); i < b && i < W.peaks.length; i++) if (W.peaks[i] > m) m = W.peaks[i];
      const hh = Math.max(1, m * amp); g.fillRect(x, mid - hh, 1, hh * 2);
    }
  } else { g.fillStyle = `rgba(${TH.t},.25)`; g.font = '12px system-ui'; g.textBaseline = 'middle'; g.fillText('Загрузи аудио (♪ аудио) — тут появится волна', 14, mid); }
  // lanes: the active track is tinted and has a stripe on the left
  const act: Lane = isBg(S.layer) ? 'bg' : 'main';
  for (const lane of ['main', 'bg'] as const) {
    const [y, hh] = laneY(lane), col = lane === 'bg' ? TH.a2 : TH.a, on = lane === act;
    g.fillStyle = on ? `rgba(${col},.09)` : `rgba(${TH.t},.03)`; g.fillRect(0, y, w, hh);
    if (on) { g.fillStyle = `rgb(${col})`; g.fillRect(0, y, 3, hh); }
    g.fillStyle = `rgba(${on ? col : TH.t},${on ? .6 : .3})`; g.font = '700 9px ui-monospace,monospace'; g.textBaseline = 'top';
    g.fillText(lane === 'bg' ? 'БЭК' : isTr(S.layer) ? 'ПЕРЕВОД' : 'ОРИГИНАЛ', 7, y + 2);
  }
  // source lines band (drag = move the whole line with all its words, double click = edit it in the list)
  g.font = '12px system-ui'; g.textBaseline = 'middle';
  S.lines.forEach((l, li) => {
    if (l.end < t0 || l.t > t1) return;
    const x1 = X(l.t), x2 = X(l.end), ac = l.agent === 'v2' ? TH.a2 : l.agent === 'v1000' ? TH.a : TH.t, other = !!l.agent && l.agent !== 'v1', y = G.lY, hh = G.lH;
    g.fillStyle = `rgba(${ac},${other ? .2 : .08})`; g.fillRect(x1, y, Math.max(2, x2 - x1 - 2), hh);
    g.fillStyle = `rgba(${ac},${other ? .9 : .35})`; g.fillRect(x1, y, other ? 3 : 1, hh);
    if (S.picked.has(li) || S.sel?.i === li) { g.strokeStyle = S.picked.has(li) ? `rgb(${TH.a})` : `rgba(${TH.t},.4)`; g.lineWidth = 1.5; g.strokeRect(x1 + .75, y + .75, Math.max(2, x2 - x1 - 3.5), hh - 1.5); g.lineWidth = 1; }
    const main = l.text.trim();
    g.fillStyle = main ? `rgba(${TH.t},.65)` : `rgba(${TH.a2},.85)`;
    g.save(); g.beginPath(); g.rect(x1 + 4, y, Math.max(0, x2 - x1 - 8), hh); g.clip(); g.fillText(main ? plainW(l.text) : '♪ ' + plainW(l.bg?.text || l.bg?.tr || 'только бэк'), x1 + 6, y + hh / 2); g.restore();
  });
  // word boxes of both tracks; the inactive one is dimmed but clickable (click = switch to it)
  W.boxes = [];
  for (const lane of ['main', 'bg'] as const) {
    const layer = laneLayer(lane), on = layer === S.layer, [y, hh] = laneY(lane), col = lane === 'bg' ? TH.a2 : TH.a;
    g.font = lane === 'bg' ? '600 13px system-ui' : '600 15px system-ui'; g.textBaseline = 'middle'; g.globalAlpha = on ? 1 : .5;
    for (let i = 0; i < S.lines.length; i++) {
      const l = S.lines[i]; if (l.end + 8 < t0 || l.t - 8 > t1) continue;
      viewWords(i, layer).forEach((wd, k) => {
        if (wd.a == null || wd.b == null) return;
        const x1 = X(wd.a), x2 = X(wd.b); if (x2 < -2 || x1 > w + 2) return;
        const sel = on && S.sel && S.sel.i === i && S.sel.k === k, bw = Math.max(2, x2 - x1);
        if (wd.real) {
          g.fillStyle = sel ? `rgba(${TH.t},.3)` : wd.g ? `rgba(${col},.16)` : `rgba(${col},.35)`; g.fillRect(x1, y, bw, hh);
          if (on) { g.fillStyle = `rgba(${TH.t},.22)`; g.fillRect(x1, G.wY, 1, G.lY - G.wY); g.fillRect(x2, G.wY, 1, G.lY - G.wY); }
          g.strokeStyle = sel ? `rgb(${TH.t})` : `rgba(${col},.9)`; g.fillStyle = sel ? `rgb(${TH.t})` : `rgba(${col},.95)`; g.fillRect(x1, y, 3, hh); g.fillRect(x2 - 3, y, 3, hh);
          g.lineWidth = sel ? 2 : 1; if (wd.g) g.setLineDash([3, 3]); g.strokeRect(x1 + .5, y + .5, bw - 1, hh - 1); g.setLineDash([]); g.lineWidth = 1;
        } else { g.setLineDash([3, 3]); g.strokeStyle = sel ? `rgb(${TH.t})` : `rgba(${TH.t},.25)`; g.strokeRect(x1 + .5, y + .5, bw - 1, hh - 1); g.setLineDash([]); }
        g.save(); g.beginPath(); g.rect(x1 + 2, y, Math.max(0, x2 - x1 - 4), hh); g.clip();
        g.fillStyle = wd.real ? `rgb(${TH.t})` : `rgba(${TH.t},.45)`; g.fillText((wd.b - wd.a >= 1 ? '✦ ' : '') + plainW(wd.word) + (wd.sp === false ? '-' : ''), x1 + 5, y + hh / 2 + 1); g.restore();
        W.boxes.push({ i, k, a: wd.a, b: wd.b, real: !!wd.real, g: !!wd.g, lane, layer });
      });
    }
    // joined edges (touching words) get a bright joint so you can see what moves together
    const rb = W.boxes.filter(b => b.real && b.lane === lane).sort((p, q) => p.a - q.a);
    for (let q = 0; q + 1 < rb.length; q++) if (Math.abs(rb[q].b - rb[q + 1].a) <= JOIN) { g.fillStyle = `rgb(${TH.t})`; g.fillRect(X(rb[q].b) - 1, y, 2, hh); }
    g.globalAlpha = 1;
  }
  // playhead
  const px = X(t); g.fillStyle = `rgb(${TH.t})`; g.fillRect(px, 0, 1.5, h);
  if (W.flash) { // F/G/H mark flash
    const age = (performance.now() - W.flash.at) / 800;
    if (age < 1) { const fx = X(W.flash.t), col = { F: '110,231,183', G: '182,156,255', H: '255,122,200' }[W.flash.kind]; g.fillStyle = `rgba(${col},${(1 - age).toFixed(2)})`; g.fillRect(fx - 1.5, 0, 3, h); g.font = '800 13px ui-monospace,monospace'; g.textBaseline = 'top'; g.fillText(W.flash.kind, fx + 5, G.wY + 2); }
    else W.flash = null;
  }
  if (W.snapAt != null && W.drag) { const sx = X(W.snapAt); g.fillStyle = '#ffd166'; g.fillRect(sx - 0.75, 0, 1.5, h); g.font = '11px ui-monospace,monospace'; g.fillText('🧲 ' + W.snapAt.toFixed(3), sx + 5, G.lY - 14); }
}

export function zoomAt(mx: number, f: number) { const ta = W.start + mx / W.px; W.px = Math.min(1500, Math.max(20, W.px * f)); W.start = Math.max(0, ta - mx / W.px); }
export function centerOnSel() {
  if (!S.sel) return; const vw = viewWords(S.sel.i, S.layer), ws = vw.filter(x => x.a != null); if (!ws.length) return;
  const a = ws[0].a!, b = ws[ws.length - 1].b!, width = canvas()?.clientWidth || 800;
  W.px = clamp(width * 0.8 / Math.max(0.5, b - a), 40, 600); W.start = Math.max(0, a - (width * 0.1) / W.px);
}
