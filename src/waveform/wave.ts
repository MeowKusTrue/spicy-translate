// Waveform canvas: state W, peaks, drawing, zoom.
import { mmss, plainW, secCategory, sectionsOf, type Section } from '../core/index.ts';
import { JOIN, bandRows as coreBandRows, lineAt as coreLineAt, type Layer } from '../core/index.ts';
import { S, clamp, emit, isBg, isTr, lineState, ls, mainLayerFor, mkLayer, status, viewWords } from '../state.ts';
import { now } from '../audio.ts';
import { computePeaks, onsets } from './peaks.ts';
import PeaksWorker from './peaks.worker.ts?worker&inline';
import SpecWorker from './spec.worker.ts?worker&inline';
import { ROWS, SPEC_FPS, fluxOnsets, spectrogram } from './spec.ts';

export type Lane = 'main' | 'bg';
type Spec = { data: Uint8Array; cols: number; tiles: (HTMLCanvasElement | null)[] };
export type Box = { i: number; k: number; a: number; b: number; real: boolean; g: boolean; lane: Lane; layer: Layer };
export const W = {
  peaks: null as Float32Array | null, pps: 200, px: 140, start: 0,
  G: { mY: 3, mH: 44, bY: 50, bH: 32, wY: 85, lY: 140, lH: 24 }, rows: [] as number[], nr: 1,
  multi: [] as { i: number; k: number; layer: Layer }[], // words picked with a Shift+drag box / Shift+click
  onsets: [] as number[], // note attacks found in the waveform (magnet targets)
  vpeaks: null as Float32Array | null, vonsets: [] as number[], // the same for the separated voice
  secs: [] as Section[], // song sections drawn as a strip on top of the wave (drag = move a whole section)
  spec: null as Spec | null, vspec: null as Spec | null, // spectrograms of the mix / the voice (built after the waveform)
  drag: null as any, pend: null as any, boxes: [] as Box[], ctrl: false,
  snapAt: null as number | null, flash: null as { t: number; kind: 'F' | 'G' | 'H'; at: number } | null,
};
export { JOIN };

function peaksInWorker(ch: Float32Array, per: number) {
  return new Promise<Float32Array>((res, rej) => {
    let wk: Worker; try { wk = new PeaksWorker(); } catch (e) { return rej(e); }
    wk.onmessage = e => { res(e.data); wk.terminate(); }; wk.onerror = e => { rej(e); wk.terminate(); };
    wk.postMessage({ ch, per }, [ch.buffer]);
  });
}
function specInWorker(ch: Float32Array, sr: number) {
  return new Promise<ReturnType<typeof spectrogram>>((res, rej) => {
    let wk: Worker; try { wk = new SpecWorker(); } catch (e) { return rej(e); }
    wk.onmessage = e => { res(e.data); wk.terminate(); }; wk.onerror = e => { rej(e); wk.terminate(); };
    wk.postMessage({ ch, sr }, [ch.buffer]);
  });
}
/** peaks now; the spectrogram (and its sharper attacks) arrives a few seconds later through `then` */
async function analyse(file: Blob, then: (s: Spec, on: number[]) => void) {
  const AC = window.AudioContext || (window as any).webkitAudioContext; if (!AC) return null;
  const ctx = new AC();
  try {
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    const per = Math.max(1, Math.floor(buf.sampleRate / W.pps)), ch = buf.getChannelData(0);
    specInWorker(ch.slice(), buf.sampleRate).then(r => then({ data: r.data, cols: r.cols, tiles: [] }, fluxOnsets(r.flux, r.lead)), () => {}); // ponytail: no spectrogram without workers
    try { return await peaksInWorker(ch.slice(), per); }
    catch { return computePeaks(ch, per); } // no workers -> same scan on the main thread
  } finally { ctx.close && ctx.close(); }
}
let gen = 0, vgen = 0; // a newer file drops the late spectrogram of an older one
export async function buildPeaks(file: Blob) {
  const my = ++gen; vgen++;
  W.peaks = null; W.vpeaks = null; W.vonsets = []; W.spec = null; W.vspec = null; S.waveVoice = false;
  try {
    const pk = await analyse(file, (s, on) => { if (my === gen) { W.spec = s; W.onsets = on; emit(); drawWave(); } });
    W.peaks = pk; if (pk && !W.spec) W.onsets = onsets(pk, W.pps);
  } catch (e) { status('st1', 'Волну построить не удалось (' + (e as Error).message + '), но аудио играет.', 'err'); }
}
/** the separated voice (from auto-timing): a much clearer waveform, spectrogram and attacks for the magnet */
export async function buildVoicePeaks(file: Blob) {
  const my = ++vgen, pk = await analyse(file, (s, on) => { if (my === vgen) { W.vspec = s; W.vonsets = on; emit(); drawWave(); } }); if (!pk) return false;
  W.vpeaks = pk; if (!W.vspec) W.vonsets = onsets(pk, W.pps); S.waveVoice = true; return true;
}
export const waveSpec = () => S.waveVoice && W.vpeaks ? W.vspec : W.spec;

/* spectrogram tiles: 1024 columns (10 s) each, painted once on first view */
const TILE = 1024, PAL = (() => { // dark violet -> magenta -> orange -> pale yellow; quiet = transparent
  const st = [[0, 0, 0, 4], [.3, 87, 16, 110], [.55, 188, 55, 84], [.8, 249, 142, 9], [1, 252, 255, 164]], p = new Uint8ClampedArray(256 * 4);
  for (let v = 0; v < 256; v++) {
    const x = v / 255, k = Math.max(1, st.findIndex(s => s[0] >= x)), a = st[k - 1], b = st[k], f = (x - a[0]) / (b[0] - a[0]);
    for (let c = 0; c < 3; c++) p[v * 4 + c] = a[c + 1] + (b[c + 1] - a[c + 1]) * f;
    p[v * 4 + 3] = Math.min(255, v * 2.2);
  }
  return p;
})();
function tile(s: Spec, k: number) {
  if (s.tiles[k]) return s.tiles[k]!;
  const c0 = k * TILE, n = Math.min(TILE, s.cols - c0), cv = document.createElement('canvas'); cv.width = n; cv.height = ROWS;
  const g = cv.getContext('2d')!, img = g.createImageData(n, ROWS);
  for (let x = 0; x < n; x++) for (let r = 0; r < ROWS; r++) {
    const v = s.data[(c0 + x) * ROWS + r], o = ((ROWS - 1 - r) * n + x) * 4;
    img.data[o] = PAL[v * 4]; img.data[o + 1] = PAL[v * 4 + 1]; img.data[o + 2] = PAL[v * 4 + 2]; img.data[o + 3] = PAL[v * 4 + 3];
  }
  g.putImageData(img, 0, 0); return s.tiles[k] = cv;
}
function drawSpec(g: CanvasRenderingContext2D, s: Spec, t0: number, t1: number, y: number, h: number) {
  const c0 = Math.max(0, Math.floor(t0 * SPEC_FPS)), c1 = Math.min(s.cols, Math.ceil(t1 * SPEC_FPS)); if (c1 <= c0) return;
  g.imageSmoothingEnabled = true;
  for (let k = Math.floor(c0 / TILE); k * TILE < c1; k++) {
    const tc = k * TILE, sx = Math.max(0, c0 - tc), ex = Math.min(TILE, c1 - tc, s.cols - tc); if (ex <= sx) continue;
    g.drawImage(tile(s, k), sx, 0, ex - sx, ROWS, ((tc + sx) / SPEC_FPS - t0) * W.px, y, (ex - sx) / SPEC_FPS * W.px, h);
  }
}
export const wavePeaks = () => S.waveVoice && W.vpeaks ? W.vpeaks : W.peaks;
export const waveOnsets = () => S.waveVoice && W.vpeaks ? W.vonsets : W.onsets;

const canvas = () => document.getElementById('wave') as HTMLCanvasElement | null;
/* theme colors ("r,g,b") for the canvas, read from CSS tokens on theme change */
export const TH = { t: '255,255,255', a: '30,215,96', a2: '255,122,200' };
export function readTheme() {
  const pr = document.createElement('i'); document.body.appendChild(pr);
  const rgb = (v: string) => { pr.style.color = `var(${v})`; return (getComputedStyle(pr).color.match(/[\d.]+/g) || []).slice(0, 3).join(','); };
  TH.t = rgb('--txt') || TH.t; TH.a = rgb('--acc') || TH.a; TH.a2 = rgb('--acc2') || TH.a2; pr.remove();
}
/* stacked: main-track words, background-vocals words, the waveform, source lines; ruler at the bottom */
/** lane heights set by dragging the borders between them (remembered); the waveform gets whatever is left */
export const LANES_DEF = { m: 44, b: 34, l: 26 };
export const LANES: typeof LANES_DEF = (() => { try { return { ...LANES_DEF, ...JSON.parse(ls.get('lanes', '{}') || '{}') }; } catch { return { ...LANES_DEF }; } })();
function geo(h: number) {
  let mH = clamp(LANES.m, 22, 200), bH = clamp(LANES.b, 16, 160), lH = clamp(LANES.l, 16, 90);
  const room = h - 17 - 9 - 40, sum = mH + bH + lH; // 40 px of waveform at least
  if (sum > room) { const k = Math.max(0.3, room / sum); mH *= k; bH *= k; lH *= k; }
  mH = Math.round(mH); bH = Math.round(bH); lH = Math.round(lH);
  const mY = 3, bY = mY + mH + 3, wY = bY + bH + 3, lY = h - 17 - lH;
  return { mY, mH, bY, bH, wY, lY, lH };
}
const laneFont = (hh: number, w = 600) => `${w} ${Math.round(clamp(hh * 0.36, 11, 24))}px system-ui`;
export const laneLayer = (lane: Lane): Layer => mkLayer(lane === 'bg', isTr(S.layer));
export const laneY = (lane: Lane) => lane === 'bg' ? [W.G.bY, W.G.bH] : [W.G.mY, W.G.mH];
export const lineAt = (t: number) => coreLineAt(S.lines, t);
export const bandRows = () => coreBandRows(S.lines);
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
  const PK = wavePeaks(), SP = S.waveView === 'spec' ? waveSpec() : null;
  if (SP) drawSpec(g, SP, t0, t1, G.wY, G.lY - 2 - G.wY);
  if (PK) { // over a spectrogram the waveform is only a faint outline
    g.fillStyle = SP ? `rgba(${TH.t},.18)` : S.waveVoice && W.vpeaks ? `rgba(${TH.a2},.6)` : `rgba(${TH.a},.55)`;
    for (let x = 0; x < w; x++) {
      const a = Math.floor((t0 + x / W.px) * W.pps), b = Math.max(a + 1, Math.floor((t0 + (x + 1) / W.px) * W.pps));
      let m = 0; for (let i = Math.max(0, a); i < b && i < PK.length; i++) if (PK[i] > m) m = PK[i];
      const hh = Math.max(1, m * amp); if (SP) { g.fillRect(x, mid - hh, 1, 1); g.fillRect(x, mid + hh, 1, 1); } else g.fillRect(x, mid - hh, 1, hh * 2);
    }
  } else { g.fillStyle = `rgba(${TH.t},.25)`; g.font = '12px system-ui'; g.textBaseline = 'middle'; g.fillText('Загрузи аудио (♪ аудио) — тут появится волна', 14, mid); }
  // song sections: colored blocks over the top of the wave
  W.secs = sectionsOf(S.lines);
  for (const s of W.secs) {
    if (s.b < t0 || s.a > t1) continue;
    const x1 = X(s.a), x2 = X(s.b), col = secColor(s.label), y = G.wY + SEC_Y, on = W.drag?.type === 'sec' && W.drag.from === s.from;
    g.fillStyle = `rgba(${col},${on ? .45 : .22})`; g.fillRect(x1, y, Math.max(2, x2 - x1 - 1), SEC_H);
    g.fillStyle = `rgb(${col})`; g.fillRect(x1, y, 3, SEC_H);
    g.save(); g.beginPath(); g.rect(x1 + 5, y, Math.max(0, x2 - x1 - 8), SEC_H); g.clip();
    g.font = '700 10px system-ui'; g.textBaseline = 'middle'; g.fillStyle = `rgb(${TH.t})`; g.fillText(s.label, x1 + 7, y + SEC_H / 2 + 1); g.restore();
  }
  if (S.onsetSnap && W.px > 50) { g.fillStyle = `rgba(${TH.t},.35)`; for (const o of waveOnsets()) if (o >= t0 && o <= t1) g.fillRect(X(o), G.lY - 7, 1, 5); } // attacks: magnet ticks
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
  const rows = W.rows = bandRows(), nr = W.nr = Math.max(1, ...rows.map(r => r + 1));
  S.lines.forEach((l, li) => {
    if (l.end < t0 || l.t > t1) return;
    const hh = G.lH / nr, y = G.lY + rows[li] * hh;
    const x1 = X(l.t), x2 = X(l.end), ac = l.agent === 'v2' ? TH.a2 : l.agent === 'v1000' ? TH.a : TH.t, other = !!l.agent && l.agent !== 'v1';
    g.fillStyle = `rgba(${ac},${other ? .2 : .08})`; g.fillRect(x1, y + .5, Math.max(2, x2 - x1 - 2), hh - 1);
    g.fillStyle = `rgba(${ac},${other ? .9 : .35})`; g.fillRect(x1, y, other ? 3 : 1, hh);
    if (W.drag?.type === 'line' && W.drag.onto === li) { g.fillStyle = 'rgba(255,209,102,.25)'; g.fillRect(x1, y, Math.max(2, x2 - x1 - 2), hh); g.strokeStyle = '#ffd166'; g.lineWidth = 2; g.strokeRect(x1 + 1, y + 1, Math.max(2, x2 - x1 - 4), hh - 2); g.lineWidth = 1; }
    if (S.picked.has(li) || S.sel?.i === li) { g.strokeStyle = S.picked.has(li) ? `rgb(${TH.a})` : `rgba(${TH.t},.4)`; g.lineWidth = 1.5; g.strokeRect(x1 + .75, y + .75, Math.max(2, x2 - x1 - 3.5), hh - 1.5); g.lineWidth = 1; }
    const main = l.text.trim();
    g.fillStyle = main ? `rgba(${TH.t},.65)` : `rgba(${TH.a2},.85)`;
    g.save(); g.beginPath(); g.rect(x1 + 4, y, Math.max(0, x2 - x1 - 8), hh); g.clip(); g.fillText(main ? plainW(l.text) : '♪ ' + plainW(l.bg?.text || l.bg?.tr || 'только бэк'), x1 + 6, y + hh / 2); g.restore();
  });
  // word boxes of both tracks; the inactive one is dimmed but clickable (click = switch to it)
  W.boxes = [];
  for (const lane of ['main', 'bg'] as const) {
    const layer = laneLayer(lane), on = layer === S.layer, [y, hh] = laneY(lane), col = lane === 'bg' ? TH.a2 : TH.a;
    g.font = laneFont(lane === 'bg' ? hh * 0.92 : hh); g.textBaseline = 'middle'; g.globalAlpha = on ? 1 : .5;
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
        if (W.multi.some(m => m.i === i && m.k === k && m.layer === layer)) { g.globalAlpha = 1; g.strokeStyle = '#ffd166'; g.lineWidth = 2; g.strokeRect(x1 + 1, y + 1, bw - 2, hh - 2); g.lineWidth = 1; g.globalAlpha = on ? 1 : .5; }
        W.boxes.push({ i, k, a: wd.a, b: wd.b, real: !!wd.real, g: !!wd.g, lane, layer });
      });
    }
    // joined edges (touching words) get a bright joint so you can see what moves together
    const rb = W.boxes.filter(b => b.real && b.lane === lane).sort((p, q) => p.a - q.a);
    for (let q = 0; q + 1 < rb.length; q++) if (Math.abs(rb[q].b - rb[q + 1].a) <= JOIN) { g.fillStyle = `rgb(${TH.t})`; g.fillRect(X(rb[q].b) - 1, y, 2, hh); }
    g.globalAlpha = 1;
  }
  if (W.drag?.type === 'box') { // Shift+drag selection rectangle
    const d = W.drag, x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1);
    g.fillStyle = 'rgba(255,209,102,.12)'; g.fillRect(x, y, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
    g.strokeStyle = '#ffd166'; g.setLineDash([4, 3]); g.strokeRect(x + .5, y + .5, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0)); g.setLineDash([]);
  }
  if (W.drag?.type === 'mcopy') for (const c of W.drag.items) { // ghosts of a multi-copy
    const [y, hh] = laneY(isBg(c.layer) ? 'bg' : 'main'), x1 = X(c.a + W.drag.d), x2 = X(c.b + W.drag.d);
    g.fillStyle = `rgba(${TH.t},.15)`; g.fillRect(x1, y, Math.max(2, x2 - x1), hh); g.setLineDash([4, 3]); g.strokeStyle = `rgb(${TH.t})`; g.strokeRect(x1 + .5, y + .5, Math.max(2, x2 - x1) - 1, hh - 1); g.setLineDash([]);
  }
  // Alt+drag: ghost of the word copy under the cursor
  if (W.drag?.type === 'wcopy') {
    const [y, hh] = laneY(W.drag.lane as Lane), x1 = X(W.drag.a), x2 = X(W.drag.a + W.drag.len);
    g.fillStyle = `rgba(${TH.t},.18)`; g.fillRect(x1, y, Math.max(2, x2 - x1), hh);
    g.setLineDash([4, 3]); g.strokeStyle = `rgb(${TH.t})`; g.strokeRect(x1 + .5, y + .5, Math.max(2, x2 - x1) - 1, hh - 1); g.setLineDash([]);
    g.fillStyle = `rgb(${TH.t})`; g.font = '600 13px system-ui'; g.textBaseline = 'middle'; g.fillText('+ ' + plainW(W.drag.w), x1 + 5, y + hh / 2 + 1);
  }
  // playhead
  const px = X(t); g.fillStyle = `rgb(${TH.t})`; g.fillRect(px, 0, 1.5, h);
  if (W.flash) { // F/G/H mark flash
    const age = (performance.now() - W.flash.at) / 800;
    if (age < 1) { const fx = X(W.flash.t), col = { F: '110,231,183', G: '182,156,255', H: '255,122,200' }[W.flash.kind]; g.fillStyle = `rgba(${col},${(1 - age).toFixed(2)})`; g.fillRect(fx - 1.5, 0, 3, h); g.font = '800 13px ui-monospace,monospace'; g.textBaseline = 'top'; g.fillText(W.flash.kind, fx + 5, G.wY + 2); }
    else W.flash = null;
  }
  if (W.snapAt != null && W.drag) { const sx = X(W.snapAt); g.fillStyle = '#ffd166'; g.fillRect(sx - 0.75, 0, 1.5, h); g.font = '11px ui-monospace,monospace'; g.fillText('🧲 ' + W.snapAt.toFixed(3), sx + 5, G.lY - 14); }
  drawMini(t, w / W.px);
}
export const SEC_Y = 3, SEC_H = 15;
/** a section's color by its kind: chorus pink, verse green, bridge yellow… */
export function secColor(label: string) {
  const instr = '110,200,190', talk = '200,200,200';
  return ({ chorus: TH.a2, refrain: TH.a2, 'pre-chorus': '120,170,255', 'post-chorus': '120,170,255', verse: TH.a, bridge: '255,209,102', hook: '255,150,80',
    break: instr, interlude: instr, instrumental: instr, solo: instr, spoken: talk, skit: talk, sample: talk, intro: TH.t, outro: TH.t, other: '170,140,255' })[secCategory(label)];
}
/** whole-song strip over the wave: lines colored by sync state, background-only lines pink, the visible window, playhead */
export const songLen = () => Math.max(S.duration || 0, ...S.lines.map(l => l.end + 1), 1);
function drawMini(t: number, view: number) {
  const cv = document.getElementById('mini') as HTMLCanvasElement | null; if (!cv) return;
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  const D = songLen(), X = (s: number) => s / D * w;
  g.fillStyle = `rgba(${TH.t},.05)`; g.fillRect(0, 0, w, h);
  S.lines.forEach((l, i) => {
    const st = lineState(i, mainLayerFor(i)), bgOnly = !l.text.trim();
    g.fillStyle = bgOnly ? `rgba(${TH.a2},.75)` : st === 'done' ? `rgba(${TH.a},.85)` : st === 'part' ? 'rgba(251,191,36,.75)' : `rgba(${TH.t},.28)`;
    g.fillRect(X(l.t), bgOnly ? h * .6 : 3, Math.max(1.5, X(l.end) - X(l.t) - 1), bgOnly ? h * .4 - 2 : h * .55 - 3);
  });
  for (const s of W.secs) { g.fillStyle = `rgba(${secColor(s.label)},.9)`; g.fillRect(X(s.a), h - 2, Math.max(2, X(s.b) - X(s.a) - 1), 2); }
  g.strokeStyle = `rgba(${TH.t},.8)`; g.lineWidth = 1.5; g.strokeRect(X(W.start) + .75, .75, Math.max(4, X(view)) - 1.5, h - 1.5); g.lineWidth = 1;
  g.fillStyle = `rgb(${TH.t})`; g.fillRect(X(t), 0, 1.5, h);
}

export function zoomAt(mx: number, f: number) { const ta = W.start + mx / W.px; W.px = Math.min(1500, Math.max(20, W.px * f)); W.start = Math.max(0, ta - mx / W.px); }
export function centerOnSel() {
  if (!S.sel) return; const vw = viewWords(S.sel.i, S.layer), ws = vw.filter(x => x.a != null); if (!ws.length) return;
  const a = ws[0].a!, b = ws[ws.length - 1].b!, width = canvas()?.clientWidth || 800;
  W.px = clamp(width * 0.8 / Math.max(0.5, b - a), 40, 600); W.start = Math.max(0, a - (width * 0.1) / W.px);
}
