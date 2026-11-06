// Waveform canvas: state W, peaks, drawing, zoom.
import { timelineExtent, timelineView, zoomTimeline, fitTimeline, timelineTick, mmss, plainW, secCategory, sectionsOf, type Section } from '../core/index.ts';
import { JOIN, bandRows as coreBandRows, lineAt as coreLineAt, trackRows, type Layer } from '../core/index.ts';
import { S, clamp, doubtful, emit, isBg, isTr, lineState, ls, mainLayerFor, mkLayer, status, viewWords } from '../state.ts';
import { now } from '../audio.ts';
import { computePeaks, onsets } from './peaks.ts';
import PeaksWorker from './peaks.worker.ts?worker&inline';
import SpecWorker from './spec.worker.ts?worker&inline';
import { ROWS, SPEC_FPS, fluxOnsets, spectrogram, type SpectralLevel } from './spec.ts';

export type Lane = 'main' | 'bg';
type Spec = { data: Uint8Array; cols: number; lod: SpectralLevel[]; tiles: Map<string, HTMLCanvasElement> };
export type Box = { i: number; k: number; a: number; b: number; y: number; h: number; real: boolean; g: boolean; lane: Lane; layer: Layer };
export const W = {
  viewportDirty: true, follow: true,
  peaks: null as Float32Array | null, pps: 200, px: 140, start: 0,
  G: { mY: 3, mH: 44, bY: 50, bH: 32, wY: 85, lY: 140, lH: 24 }, rows: [] as number[], nr: 1,
  wordRows: { main: [] as number[], bg: [] as number[] }, wordN: { main: 1, bg: 1 },
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
  return new Promise<ReturnType<typeof spectrogram> & { lod: SpectralLevel[] }>((res, rej) => {
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
    specInWorker(ch.slice(), buf.sampleRate).then(r => then({ data: r.data, cols: r.cols, lod: r.lod, tiles: new Map() }, fluxOnsets(r.flux, r.lead)), () => {}); // ponytail: no spectrogram without workers
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
function tile(s: Spec, level: SpectralLevel, k: number) {
  const key = `${level.step}:${k}`, cached = s.tiles.get(key);
  if (cached) { s.tiles.delete(key); s.tiles.set(key,cached); return cached; }
  const c0 = k * TILE, n = Math.min(TILE, level.cols - c0), cv = document.createElement('canvas'); cv.width = n; cv.height = ROWS;
  const g = cv.getContext('2d')!, img = g.createImageData(n, ROWS);
  for (let x = 0; x < n; x++) for (let r = 0; r < ROWS; r++) {
    const v = level.data[(c0 + x) * ROWS + r], o = ((ROWS - 1 - r) * n + x) * 4;
    img.data[o] = PAL[v * 4]; img.data[o + 1] = PAL[v * 4 + 1]; img.data[o + 2] = PAL[v * 4 + 2]; img.data[o + 3] = PAL[v * 4 + 3];
  }
  g.putImageData(img, 0, 0); s.tiles.set(key,cv);
  if (s.tiles.size > 16) s.tiles.delete(s.tiles.keys().next().value!);
  return cv;
}
function drawSpec(g: CanvasRenderingContext2D, s: Spec, t0: number, t1: number, y: number, h: number) {
  let level: SpectralLevel = { data: s.data, cols: s.cols, step: 1 };
  for (const next of s.lod) { if (SPEC_FPS / level.step / W.px <= 2) break; level = next; }
  const fps = SPEC_FPS / level.step;
  const c0 = Math.max(0, Math.floor(t0 * fps)), c1 = Math.min(level.cols, Math.ceil(t1 * fps)); if (c1 <= c0) return;
  g.imageSmoothingEnabled = true;
  for (let k = Math.floor(c0 / TILE); k * TILE < c1; k++) {
    const tc = k * TILE, sx = Math.max(0, c0 - tc), ex = Math.min(TILE, c1 - tc, level.cols - tc); if (ex <= sx) continue;
    g.drawImage(tile(s, level, k), sx, 0, ex - sx, ROWS, ((tc + sx) / fps - t0) * W.px, y, (ex - sx) / fps * W.px, h);
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
export const LANES_DEF = { m: 58, b: 42, l: 26 };
export const LANES: typeof LANES_DEF = (() => { try { return { ...LANES_DEF, ...JSON.parse(ls.get('lanes', '{}') || '{}') }; } catch { return { ...LANES_DEF }; } })();
function geo(h: number) {
  let mH = clamp(LANES.m, 22, 200), bH = clamp(LANES.b, 16, 160), lH = clamp(LANES.l, 16, 90);
  mH = Math.max(mH, W.wordN.main * 30); bH = Math.max(bH, W.wordN.bg * 24);
  const room = h - 9 - 64, sum = mH + bH + lH; // reserve an audio lane tall enough for source controls
  if (sum > room) { const k = Math.max(0.3, room / sum); mH *= k; bH *= k; lH *= k; }
  mH = Math.round(mH); bH = Math.round(bH); lH = Math.round(lH);
  const mY = 3, bY = mY + mH + 3, wY = bY + bH + 3, lY = h - lH;
  return { mY, mH, bY, bH, wY, lY, lH };
}
const laneFont = (hh: number, w = 600) => `${w} ${Math.round(clamp(hh * 0.36, 11, 24))}px system-ui`;
export const laneLayer = (lane: Lane): Layer => mkLayer(lane === 'bg', isTr(S.layer));
export function laneY(lane: Lane, line?: number) {
  const [y, h] = lane === 'bg' ? [W.G.bY, W.G.bH] : [W.G.mY, W.G.mH];
  if (line == null) return [y, h];
  const count = W.wordN[lane], row = Math.max(0, W.wordRows[lane][line] || 0);
  return [y + row * h / count, h / count];
}
export const lineAt = (t: number) => coreLineAt(S.lines, t);
export const bandRows = () => coreBandRows(S.lines);
let layoutVer = -1, layoutLayer: Layer | null = null;
const raster = document.createElement('canvas');
let rasterKey = '', rasterPeaks: Float32Array | null = null, rasterSpec: Spec | null = null;
export function drawWave() { renderWave(true); }
export function drawWaveFrame() { renderWave(false); }
function renderWave(force: boolean) {
  const cv = canvas(); if (!cv || !S.dock) return;
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d')!;
  W.viewportDirty = false;
  const t = now();
  if (S.playing && W.follow && !W.drag && (t < W.start || t > W.start + w / W.px * 0.8)) W.start = Math.max(0, t - w / W.px * 0.25);
  drawRuler(w,dpr);
  const key = [S.ver, w,h,dpr,W.start,W.px,S.layer,S.sel?.i,S.sel?.k,[...S.picked].join(','),W.multi.map(q=>`${q.i}:${q.k}:${q.layer}`).join(','),S.waveView,S.waveVoice,LANES.m,LANES.b,LANES.l,TH.t,TH.a,TH.a2].join('/');
  const canCache = !W.drag;
  if (!force && canCache && key === rasterKey && raster.width === cv.width && raster.height === cv.height && rasterPeaks === wavePeaks() && rasterSpec === waveSpec()) {
    g.setTransform(1,0,0,1,0,0); g.clearRect(0,0,cv.width,cv.height); g.drawImage(raster,0,0);
    g.setTransform(dpr,0,0,dpr,0,0); drawCursor(g,t,w,h); drawMini(t,w/W.px); publishViewport(); return;
  }
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  if (layoutVer !== S.ver || layoutLayer !== S.layer) {
    layoutVer = S.ver; layoutLayer = S.layer;
    for (const lane of ['main', 'bg'] as const) {
      W.wordRows[lane] = trackRows(S.lines, laneLayer(lane));
      W.wordN[lane] = Math.max(1, ...W.wordRows[lane].map(row => row + 1));
    }
    W.rows = bandRows(); W.nr = Math.max(1, ...W.rows.map(r => r + 1)); W.secs = sectionsOf(S.lines);
  }
  const G = W.G = geo(h);
  const t0 = W.start, t1 = t0 + w / W.px, X = (tt: number) => (tt - t0) * W.px;
  // a label starts at its block, or at the left edge when the block began off screen (zoomed in, it would be gone)
  const stick = (x: number) => Math.max(x, 0);
  const mid = (G.wY + G.lY - 2) / 2, amp = (G.lY - 2 - G.wY) / 2 - 2;
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
  for (const s of W.secs) {
    if (s.b < t0 || s.a > t1) continue;
    const x1 = X(s.a), x2 = X(s.b), col = secColor(s.label), y = G.wY + SEC_Y, on = W.drag?.type === 'sec' && W.drag.from === s.from;
    g.fillStyle = `rgba(${col},${on ? .45 : .22})`; g.fillRect(x1, y, Math.max(2, x2 - x1 - 1), SEC_H);
    g.fillStyle = `rgb(${col})`; g.fillRect(x1, y, 3, SEC_H);
    g.save(); g.beginPath(); g.rect(x1 + 5, y, Math.max(0, x2 - x1 - 8), SEC_H); g.clip();
    g.font = '700 10px system-ui'; g.textBaseline = 'middle'; g.fillStyle = `rgb(${TH.t})`; g.fillText(s.label, stick(x1) + 7, y + SEC_H / 2 + 1); g.restore();
  }
  if (S.onsetSnap && W.px > 50) { g.fillStyle = `rgba(${TH.t},.35)`; for (const o of waveOnsets()) if (o >= t0 && o <= t1) g.fillRect(X(o), G.lY - 7, 1, 5); } // attacks: magnet ticks
  // lanes: the active track is tinted and has a stripe on the left
  const act: Lane = isBg(S.layer) ? 'bg' : 'main';
  for (const lane of ['main', 'bg'] as const) {
    const [y, hh] = laneY(lane), col = lane === 'bg' ? TH.a2 : TH.a, on = lane === act;
    g.fillStyle = on ? `rgba(${col},.09)` : `rgba(${TH.t},.03)`; g.fillRect(0, y, w, hh);
    if (on) { g.fillStyle = `rgb(${col})`; g.fillRect(0, y, 3, hh); }
    g.fillStyle = `rgba(${on ? col : TH.t},${on ? .6 : .3})`; g.font = '700 9px ui-monospace,monospace'; g.textBaseline = 'top';
    const label = lane === 'bg' ? 'БЭК' : isTr(S.layer) ? 'ПЕРЕВОД' : 'ОРИГИНАЛ';
    for (let row = 0; row < W.wordN[lane]; row++) {
      const top = y + row * hh / W.wordN[lane];
      if (row) { g.fillStyle = `rgba(${TH.t},.15)`; g.fillRect(0, top, w, 1); }
      g.fillStyle = `rgba(${on ? col : TH.t},${on ? .6 : .3})`;
      if(W.wordN[lane]>1)g.fillText(String(row+1),7,top+2);
    }
  }
  // source lines band (drag = move the whole line with all its words, double click = edit it in the list)
  g.font = '12px system-ui'; g.textBaseline = 'middle';
  const rows = W.rows, nr = W.nr;
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
    g.save(); g.beginPath(); g.rect(x1 + 4, y, Math.max(0, x2 - x1 - 8), hh); g.clip(); g.fillText(main ? plainW(l.text) : '♪ ' + plainW(l.bg?.text || l.bg?.tr || 'только бэк'), stick(x1) + 6, y + hh / 2); g.restore();
  });
  // word boxes of both tracks; the inactive one is dimmed but clickable (click = switch to it)
  W.boxes = [];
  for (const lane of ['main', 'bg'] as const) {
    const layer = laneLayer(lane), on = layer === S.layer;
    g.textBaseline = 'middle'; g.globalAlpha = on ? 1 : .5;
    for (let i = 0; i < S.lines.length; i++) {
      const [y, hh] = laneY(lane, i), col = lane === 'bg' || S.lines[i].agent === 'v2' ? TH.a2 : TH.a;
      g.font = laneFont(lane === 'bg' ? hh * 0.92 : hh);
      const l = S.lines[i]; let lo = l.t, hi = l.end; // words may sit outside the line's own span: cull by their real timings
      for (const s of l.sync?.[layer] || []) { if (s.a != null && s.a < lo) lo = s.a; if (s.b != null && s.b > hi) hi = s.b; }
      if (hi < t0 || lo > t1) continue;
      viewWords(i, layer).forEach((wd, k) => {
        if (wd.a == null || wd.b == null) return;
        const x1 = X(wd.a), x2 = X(wd.b); if (x2 < -2 || x1 > w + 2) return;
        const sel = on && S.sel && S.sel.i === i && S.sel.k === k, bw = Math.max(2, x2 - x1);
        // Insets and quiet rounded blocks separate words without a wall of bright edges.
        const block = () => { g.beginPath(); g.roundRect(x1 + 1, y + 2, Math.max(1,bw-2), Math.max(1,hh-4), Math.max(0,Math.min(5,(bw-2)/2,(hh-4)/2))); };
        block();
        if (wd.real) {
          g.fillStyle = `rgba(${col},${sel ? .28 : wd.g ? .08 : .15})`; g.fill();
          if (on) { g.fillStyle = `rgba(${TH.t},.10)`; g.fillRect(x1, G.wY, 1, G.lY - G.wY); }
          g.strokeStyle = `rgba(${col},${sel ? 1 : wd.g ? .35 : .55})`; g.lineWidth = sel ? 2 : 1;
          if (wd.g) g.setLineDash([3,3]); g.stroke(); g.setLineDash([]); g.lineWidth=1;
          g.fillStyle=`rgba(${col},${sel ? 1 : .55})`; g.fillRect(x1+4,y+9,2,Math.max(3,hh-18));
          if (sel) { g.fillRect(x1+4,y+hh-6,Math.max(1,bw-8),3); g.fillRect(x2-6,y+9,2,Math.max(3,hh-18)); }
        } else { g.setLineDash([3,3]); g.strokeStyle = `rgba(${sel ? col : TH.t},${sel ? .9 : .25})`; g.stroke(); g.setLineDash([]); }
        if (bw >= 24) {
        g.save(); g.beginPath(); g.rect(x1 + 2, y, Math.max(0, x2 - x1 - 4), hh); g.clip();
        g.fillStyle = wd.real ? `rgb(${TH.t})` : `rgba(${TH.t},.45)`; g.fillText((wd.b - wd.a >= 1 ? '✦ ' : '') + plainW(wd.word) + (wd.sp === false ? '-' : ''), stick(x1) + 5, y + hh / 2 + 1); g.restore();
        }
        if (W.multi.some(m => m.i === i && m.k === k && m.layer === layer)) { g.globalAlpha = 1; g.strokeStyle = '#ffd166'; g.lineWidth = 2; g.strokeRect(x1 + 1, y + 1, bw - 2, hh - 2); g.lineWidth = 1; g.globalAlpha = on ? 1 : .5; }
        if (bw >= 14 && doubtful(S.lines[i].sync?.[layer]?.[k])) { // auto-timing was unsure here: check by ear (Q)
          g.strokeStyle = 'rgb(255,170,60)'; g.lineWidth = 1.5; g.strokeRect(x1 + 1, y + 1, bw - 2, hh - 2); g.lineWidth = 1;
          g.fillStyle = 'rgb(255,170,60)'; g.font = '800 10px system-ui'; g.textBaseline = 'top'; g.fillText('?', x2 - 9, y + 1); g.font = laneFont(lane === 'bg' ? hh * 0.92 : hh); g.textBaseline = 'middle';
        }
        W.boxes.push({ i, k, a: wd.a, b: wd.b, y, h: hh, real: !!wd.real, g: !!wd.g, lane, layer });
      });
    }
    // joined edges (touching words) get a bright joint so you can see what moves together
    const rb = W.boxes.filter(b => b.real && b.lane === lane).sort((p, q) => p.i - q.i || p.k - q.k);
    for (let q = 0; q + 1 < rb.length; q++) if (rb[q].i === rb[q + 1].i && Math.abs(rb[q].b - rb[q + 1].a) <= JOIN) { g.fillStyle = `rgb(${TH.t})`; g.fillRect(X(rb[q].b) - 1, rb[q].y + rb[q].h - 7, 2, 4); }
    g.globalAlpha = 1;
  }
  if (W.drag?.type === 'box') { // Shift+drag selection rectangle
    const d = W.drag, x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1);
    g.fillStyle = 'rgba(255,209,102,.12)'; g.fillRect(x, y, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
    g.strokeStyle = '#ffd166'; g.setLineDash([4, 3]); g.strokeRect(x + .5, y + .5, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0)); g.setLineDash([]);
  }
  if (W.drag?.type === 'mcopy') for (const c of W.drag.items) { // ghosts of a multi-copy
    const [y, hh] = laneY(isBg(c.layer) ? 'bg' : 'main', c.i), x1 = X(c.a + W.drag.d), x2 = X(c.b + W.drag.d);
    g.fillStyle = `rgba(${TH.t},.15)`; g.fillRect(x1, y, Math.max(2, x2 - x1), hh); g.setLineDash([4, 3]); g.strokeStyle = `rgb(${TH.t})`; g.strokeRect(x1 + .5, y + .5, Math.max(2, x2 - x1) - 1, hh - 1); g.setLineDash([]);
  }
  // Alt+drag: ghost of the word copy under the cursor
  if (W.drag?.type === 'wcopy') {
    const [y, hh] = laneY(W.drag.lane as Lane), x1 = X(W.drag.a), x2 = X(W.drag.a + W.drag.len);
    g.fillStyle = `rgba(${TH.t},.18)`; g.fillRect(x1, y, Math.max(2, x2 - x1), hh);
    g.setLineDash([4, 3]); g.strokeStyle = `rgb(${TH.t})`; g.strokeRect(x1 + .5, y + .5, Math.max(2, x2 - x1) - 1, hh - 1); g.setLineDash([]);
    g.fillStyle = `rgb(${TH.t})`; g.font = '600 13px system-ui'; g.textBaseline = 'middle'; g.fillText('+ ' + plainW(W.drag.w), x1 + 5, y + hh / 2 + 1);
  }
  if (canCache) {
    raster.width = cv.width; raster.height = cv.height;
    raster.getContext('2d')!.drawImage(cv,0,0);
    rasterKey = key; rasterPeaks = wavePeaks(); rasterSpec = waveSpec();
  } else rasterKey = '';
  drawCursor(g,t,w,h); drawMini(t,w/W.px,force); publishViewport();
}
function drawCursor(g: CanvasRenderingContext2D, t: number, w: number, h: number) {
  const X = (tt: number) => (tt-W.start)*W.px, G = W.G;
  // playhead
  const px = X(t); g.fillStyle = `rgb(${TH.t})`; g.fillRect(px, 0, 1.5, h);
  if (W.flash) { // F/G/H mark flash
    const age = (performance.now() - W.flash.at) / 800;
    if (age < 1) { const fx = X(W.flash.t), col = { F: '110,231,183', G: '182,156,255', H: '255,122,200' }[W.flash.kind]; g.fillStyle = `rgba(${col},${(1 - age).toFixed(2)})`; g.fillRect(fx - 1.5, 0, 3, h); g.font = '800 13px ui-monospace,monospace'; g.textBaseline = 'top'; g.fillText(W.flash.kind, fx + 5, G.wY + 2); }
    else W.flash = null;
  }
  if (W.snapAt != null && W.drag) { const sx = X(W.snapAt); g.fillStyle = '#ffd166'; g.fillRect(sx - 0.75, 0, 1.5, h); g.font = '11px ui-monospace,monospace'; g.fillText('🧲 ' + W.snapAt.toFixed(3), sx + 5, G.lY - 14); }
}
export const SEC_Y = 3, SEC_H = 15;
/** a section's color by its kind: chorus pink, verse green, bridge yellow… */
export function secColor(label: string) {
  const instr = '110,200,190', talk = '200,200,200';
  return ({ chorus: TH.a2, refrain: TH.a2, 'pre-chorus': '120,170,255', 'post-chorus': '120,170,255', verse: TH.a, bridge: '255,209,102', hook: '255,150,80',
    break: instr, interlude: instr, instrumental: instr, solo: instr, spoken: talk, skit: talk, sample: talk, intro: TH.t, outro: TH.t, other: '170,140,255' })[secCategory(label)];
}
/** whole-song strip over the wave: lines colored by sync state, background-only lines pink, the visible window, playhead */
let extentVer=-1, extentDuration=-1, extent=1;
export function songLen() { if(extentVer!==S.ver || extentDuration!==S.duration){extentVer=S.ver;extentDuration=S.duration;extent=timelineExtent(S.lines,S.duration);}return extent; }
const miniRaster = document.createElement('canvas');
let miniKey = '';
function drawMini(t: number, view: number, force = false) {
  const cv = document.getElementById('mini') as HTMLCanvasElement | null; if (!cv) return;
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  const D = songLen(), X = (s: number) => s / D * w;
  const key = [S.ver,w,h,dpr,D,W.start,view,S.meta.mode,TH.t,TH.a,TH.a2].join('/');
  if (!force && key === miniKey && miniRaster.width === cv.width && miniRaster.height === cv.height) {
    g.setTransform(1,0,0,1,0,0); g.drawImage(miniRaster,0,0); g.setTransform(dpr,0,0,dpr,0,0);
    g.fillStyle = `rgb(${TH.t})`; g.fillRect(X(t),0,1.5,h); return;
  }
  g.fillStyle = `rgba(${TH.t},.05)`; g.fillRect(0, 0, w, h);
  S.lines.forEach((l, i) => {
    const st = lineState(i, mainLayerFor(i)), bgOnly = !l.text.trim();
    g.fillStyle = bgOnly ? `rgba(${TH.a2},.75)` : st === 'done' ? `rgba(${TH.a},.85)` : st === 'part' ? 'rgba(251,191,36,.75)' : `rgba(${TH.t},.28)`;
    g.fillRect(X(l.t), bgOnly ? h * .6 : 3, Math.max(1.5, X(l.end) - X(l.t) - 1), bgOnly ? h * .4 - 2 : h * .55 - 3);
  });
  for (const s of W.secs) { g.fillStyle = `rgba(${secColor(s.label)},.9)`; g.fillRect(X(s.a), h - 2, Math.max(2, X(s.b) - X(s.a) - 1), 2); }
  g.strokeStyle = `rgba(${TH.t},.8)`; g.lineWidth = 1.5; g.strokeRect(X(W.start) + .75, .75, Math.max(4, X(view)) - 1.5, h - 1.5); g.lineWidth = 1;
  miniRaster.width = cv.width; miniRaster.height = cv.height; miniRaster.getContext('2d')!.drawImage(cv,0,0); miniKey = key;
  g.fillStyle = `rgb(${TH.t})`; g.fillRect(X(t), 0, 1.5, h);
}

let rulerKey='';
function drawRuler(w:number,dpr:number){
 const cv=document.getElementById('timelineRuler') as HTMLCanvasElement|null;if(!cv)return;const key=[w,dpr,W.start,W.px,TH.t].join(':');if(key===rulerKey&&cv.width===Math.round(w*dpr))return;rulerKey=key;cv.width=Math.round(w*dpr);cv.height=Math.round(24*dpr);const g=cv.getContext('2d')!;g.setTransform(dpr,0,0,dpr,0,0);g.font='11px Consolas,monospace';g.textBaseline='top';const step=timelineTick(W.px),end=W.start+w/W.px;g.fillStyle=`rgba(${TH.t},.7)`;for(let t=Math.ceil(W.start/step)*step;t<end;t+=step){const x=(t-W.start)*W.px;g.fillRect(x,17,1,7);const centis=Math.round(t*100);g.fillText(mmss(centis/100)+(step<1?'.'+String(centis%100).padStart(2,'0'):''),x+5,2);g.fillRect(x+step*W.px/2,21,1,3);}}
const viewportListeners=new Set<()=>void>();
let viewportSnapshot='', geometrySnapshot='', geometryRoot:HTMLElement|null=null;
export const subscribeViewport=(f:()=>void)=>{viewportListeners.add(f);return()=>{viewportListeners.delete(f);};};
export const getViewportSnapshot=()=>viewportSnapshot;
function publishViewport(){
 const cv=canvas(),next=[W.start,W.px,cv?.clientWidth||800,W.follow,W.wordN.main,W.wordN.bg].join(':');
 if(next!==viewportSnapshot){viewportSnapshot=next;viewportListeners.forEach(f=>f());}
 const root=document.getElementById('timelineTracks');
 const geo=Object.values(W.G).join(':');if(root&&(geo!==geometrySnapshot||root!==geometryRoot)){geometrySnapshot=geo;geometryRoot=root;for(const [k,v] of Object.entries(W.G))root.style.setProperty('--'+k,v+'px');}
}
export function requestWaveRender(){W.viewportDirty=true;}
export function navigateTimeline(start:number,px=W.px,manual=true){const view=timelineView(start,px,canvas()?.clientWidth||800,songLen());W.start=view.start;W.px=view.px;if(manual)W.follow=false;requestWaveRender();}
export function zoomAt(mx: number, f: number) {const v=zoomTimeline(W.start,W.px,canvas()?.clientWidth||800,songLen(),mx,f);navigateTimeline(v.start,v.px);}
export function fitSong(){const v=fitTimeline(0,songLen(),canvas()?.clientWidth||800,songLen(),0);navigateTimeline(v.start,v.px);}
export function fitSelection(){
 const refs=W.multi.length?W.multi:S.sel?[{...S.sel,layer:S.layer}]:[], times=refs.flatMap(q=>{const l=S.lines[q.i],x=l?.sync?.[q.layer]?.[q.k];return x?.a!=null&&x.b!=null?[{a:x.a,b:x.b}]:l?[{a:l.t,b:l.end}]:[];});
 if(S.picked.size){times.length=0;for(const i of S.picked){const l=S.lines[i];if(l)times.push({a:l.t,b:l.end});}}
 if(!times.length)return;
 const v=fitTimeline(Math.min(...times.map(x=>x.a)),Math.max(...times.map(x=>x.b)),canvas()?.clientWidth||800,songLen());navigateTimeline(v.start,v.px);
}
export function centerPlayhead(){navigateTimeline(now()-(canvas()?.clientWidth||800)/W.px*.4,W.px,false);W.follow=true;requestWaveRender();}
export function toggleFollow(){W.follow=!W.follow;if(W.follow)centerPlayhead();requestWaveRender();}

export function centerOnSel() {
  if (!S.sel) return; const vw = viewWords(S.sel.i, S.layer), ws = vw.filter(x => x.a != null); if (!ws.length) return;
  const a = ws[0].a!, b = ws[ws.length - 1].b!, width = canvas()?.clientWidth || 800;
  const v = fitTimeline(a,b,width,songLen()); navigateTimeline(v.start,v.px);
}
