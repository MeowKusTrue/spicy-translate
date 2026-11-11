// Live preview that moves like Spicy Lyrics, so a maker sees what listeners will see.
// Reimplemented from how Spicy behaves (its code is AGPL; nothing is copied):
// - word scale, lift and glow follow media progress directly, without a second delayed animation clock;
//   the fill is a soft gradient sweeping left to right;
// - a syllable that lasts ≥ 1 s is drawn letter by letter: the letters share its full timed duration
//   and the one being sung follows a gentle pulse that returns to rest at its boundary;
// - a gap of ≥ 3 s between lines shows three breathing dots;
// - lines not being sung are dimmed and blurred by their distance from the current one.
// Built imperatively into #lyrIn (React owns only the container): per-frame painting must not go through React.
import { karaokeMotion, getWords, liveLines, plainW, syncComplete, units, type Layer, type Line, type TimedWord } from './core/index.ts';
import { S, displayLine, layerText, mainLayerFor } from './state.ts';
import { seekTo } from './audio.ts';
import { PREVIEW_EDIT, editPreview } from './previewEdit.ts';

export const PV = { lastAct: -2 };
const inner = () => document.getElementById('lyrIn');

/* ---------- motion primitives ---------- */
/** natural cubic spline through the points (x ascending) */
function curve(pts: [number, number][]) {
  const n = pts.length, x = pts.map(p => p[0]), y = pts.map(p => p[1]), m = new Array(n).fill(0);
  const h = x.slice(1).map((v, i) => v - x[i]), c = new Array(n).fill(0), d = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) { // tridiagonal solve for the second derivatives
    const a = h[i - 1], b = 2 * (h[i - 1] + h[i]) - a * c[i - 1], r = 6 * ((y[i + 1] - y[i]) / h[i] - (y[i] - y[i - 1]) / h[i - 1]) - a * d[i - 1];
    c[i] = h[i] / b; d[i] = r / b;
  }
  for (let i = n - 2; i > 0; i--) m[i] = d[i] - c[i] * m[i + 1];
  return (t: number) => {
    let i = 0; while (i < n - 2 && t > x[i + 1]) i++;
    const a = x[i + 1] - t, b = t - x[i], w = h[i];
    return (m[i] * a * a * a + m[i + 1] * b * b * b) / (6 * w) + (y[i] / w - m[i] * w / 6) * a + (y[i + 1] / w - m[i + 1] * w / 6) * b;
  };
}
/** damped spring (frequency in Hz, damping ratio < 1), solved exactly per step, so any frame time is stable */
class Spring {
  v = 0; g: number; p: number; f: number; d: number;
  constructor(p: number, f: number, d: number) { this.p = this.g = p; this.f = f; this.d = d; }
  step(dt: number) {
    const w = this.f * 2 * Math.PI, z = this.d, wd = w * Math.sqrt(1 - z * z), o = this.p - this.g, e = Math.exp(-z * w * dt), cs = Math.cos(wd * dt), sn = Math.sin(wd * dt);
    this.p = this.g + e * (o * cs + (this.v + z * w * o) / wd * sn);
    this.v = e * (this.v * cs - (w * w * o + z * w * this.v) / wd * sn);
    return this.p;
  }
}
const C = {
  dScale: curve([[0, 0.75], [0.7, 1.05], [1, 1]]),
  dLift: curve([[0, 0], [0.9, -0.12], [1, 0]]),
  dGlow: curve([[0, 0], [0.6, 1], [1, 1]]),
  dOp: curve([[0, 0.35], [0.6, 1], [1, 1]]),
};
const LETTER_MIN = 1, GAP_DOTS = 3, DOT_PAD = 0.55, DOT_HIDE = 0.5, BLUR = 1.25;

type Springs = { s: Spring; y: Spring; g: Spring; o?: Spring };
const dotSprings = (): Springs => ({ s: new Spring(0.75, 0.7, 0.6), y: new Spring(0, 1.25, 0.4), g: new Spring(0, 1, 0.5), o: new Spring(0.35, 1, 0.5) });
interface Part { el: HTMLElement; a: number; b: number; sp?: Springs; c: Record<string, number> }
interface Word extends Part { letters?: Part[]; dot?: boolean }
interface PLine { ref?: Line; el: HTMLElement; a: number; b: number; words: Word[]; i: number; dots?: boolean; st?: string }

/** words of the main line + the small line under it (translation in bilingual mode, background vocals otherwise) */
function lineWords(i: number) {
  const l = displayLine(i, S.layer), ml = mainLayerFor(i);
  const wm = getWords(layerText(l, ml), l.sync && l.sync[ml], l.t, l.end);
  let wb: TimedWord[] | null = null;
  if (S.meta.mode === 'bilingual') { if (l.tr && l.tr.trim()) wb = getWords(l.tr.trim(), l.sync && l.sync.tr, l.t, l.end); }
  else if (l.bg) {
    const bl: Layer = S.meta.mode !== 'original' && l.bg.tr && l.bg.tr.trim() ? 'bg' : 'bgo', txt = layerText(l, bl).trim();
    if (txt) {
      const so = l.sync && l.sync.bgo, n = units(l.bg.text).length;
      const [b0, b1] = syncComplete(so, n) ? [so[0].a, so[n - 1].b] : [l.t, l.end];
      wb = getWords(txt, l.sync && l.sync[bl], b0, b1);
    }
  }
  return { wm, wb };
}

/* ---------- building ---------- */
let LINES: PLine[] = [], dirty = false;
const dirtyRows = new Set<number>();
let visibility: IntersectionObserver | null = null;
const visible = new Set<Element>();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const span = (cls: string, text = '') => { const e = document.createElement('span'); e.className = cls; e.textContent = text; return e; };
function mkWords(host: HTMLElement, arr: TimedWord[], out: Word[]) {
  arr.forEach(w => {
    const txt = plainW(w.word), chars = [...txt], d = w.b - w.a;
    let wd: Word;
    if (d >= LETTER_MIN && chars.length) { // long syllable: letter by letter
      const el = span('w lg'), b = w.b, step = (b - w.a) / chars.length;
      wd = { el, a: w.a, b, c: {}, letters: chars.map((ch, k) => { const le = span('lt' + (ch.trim() ? '' : ' sp'), ch); el.appendChild(le); return { el: le, a: w.a + k * step, b: w.a + (k + 1) * step, c: {} }; }) };
    } else wd = { el: span('w', txt), a: w.a, b: w.b, c: {} };
    host.appendChild(wd.el); out.push(wd);
    if (w.sp !== false) host.appendChild(document.createTextNode(' '));
  });
}
function mkDots(a: number, b: number, agent: string): PLine {
  const el = document.createElement('div'); el.className = 'pl dots'; el.dataset.agent = agent;
  const g = document.createElement('div'); g.className = 'dg'; el.appendChild(g);
  const T = b - a, ends = [a + T / 3 - DOT_PAD / 3, a + 2 * T / 3 - 2 * DOT_PAD / 3, b - DOT_PAD];
  const words: Word[] = ends.map((e, k) => { const d = span('dot', '•'); g.appendChild(d); return { el: d, a: k ? ends[k - 1] : a, b: e, c: {}, dot: true }; });
  el.onclick = () => seekTo(a);
  return { el, a, b, words, i: -1, dots: true };
}
export function buildPreview(keepPos?: boolean) {
  if (PREVIEW_EDIT.active) { dirty = true; return; }
  S.ver++; dirty = false; dirtyRows.clear();
  const box = inner(); if (!box) return;
  visibility?.disconnect(); visible.clear();
  box.innerHTML = ''; LINES = [];
  if (!S.lines.length) { box.innerHTML = '<div class="empty">Тут появится живое превью лирики</div>'; return; }
  const R = ranges();
  S.lines.forEach((l, i) => {
    const gapFrom = i ? R[i - 1].b : 0;
    if (R[i].a - gapFrom >= GAP_DOTS) { const d = mkDots(gapFrom, R[i].a, l.agent || 'v1'); box.appendChild(d.el); LINES.push(d); }
    const { wm, wb } = lineWords(i), words: Word[] = [];
    const el = document.createElement('div'); el.className = 'pl'; el.id = 'pl' + i; el.dataset.agent = l.agent || 'v1';
    mkWords(el, wm, words);
    if (wb) { const b = span('bg'); el.appendChild(b); mkWords(b, wb, words); }
    el.tabIndex = 0; el.title = 'Двойной клик или Enter — изменить текст прямо здесь';
    el.onclick = () => { if (!PREVIEW_EDIT.active) seekTo(l.t); };
    el.ondblclick = e => {
      e.preventDefault(); const bg = (e.target as HTMLElement).closest('.bg') as HTMLElement | null;
      const layer = bg ? (S.meta.mode === 'bilingual' ? 'tr' : S.meta.mode !== 'original' && l.bg?.tr.trim() ? 'bg' : 'bgo') : mainLayerFor(i);
      const host = bg || el, word = (e.target as HTMLElement).closest('.w');
      const wordIndex = word ? [...host.children].filter(node => node.classList.contains('w')).indexOf(word) : -1;
      editPreview(i, host, layer, wordIndex >= 0 ? wordIndex : undefined);
    };
    el.onkeydown = e => { if (e.key === 'Enter' && e.target === el) { e.preventDefault(); editPreview(i, el); } };
    box.appendChild(el); LINES.push({ el, ref: l, a: R[i].a, b: R[i].b, words, i });
  });
  visibility = new IntersectionObserver(entries => { for (const e of entries) { if (e.isIntersecting) visible.add(e.target); else visible.delete(e.target); } }, { root: box.parentElement, rootMargin: '200px 0px' });
  LINES.forEach(l => visibility!.observe(l.el));
  lastBlur = '';
  if (!keepPos) PV.lastAct = -2;
}
/** a line's words or timings changed: rebuilt on the next frame (several edits in one frame cost one rebuild) */
export function refreshPreviewLine(i: number) { S.ver++; dirty = true; dirtyRows.add(i); }

const RNG = { ver: -1, r: [] as { a: number; b: number }[] };
function ranges() { // per-line [start,end] for the main layer, recomputed only when lyrics/timings change
  if (RNG.ver === S.ver && RNG.r.length === S.lines.length) return RNG.r;
  RNG.ver = S.ver; const old = RNG.r; RNG.r = S.lines.map((l, i) => {
    if (old.length === S.lines.length && dirtyRows.size && !dirtyRows.has(i)) return old[i];
    const { wm, wb } = lineWords(i), ws = wm.concat(wb || []);
    return ws.length ? { a: Math.min(l.t, ...ws.map(w => w.a)), b: Math.max(l.end, ...ws.map(w => w.b)) } : { a: l.t, b: l.end };
  });
  return RNG.r;
}

/** Mouse timing edits usually affect one phrase; keep every other preview node and its state. */
function updatePreviewRows() {
  if (!dirtyRows.size || dirtyRows.size > 12) return false;
  const R = ranges(), rows = [...dirtyRows].map(i => LINES.find(l => l.i === i));
  if (rows.some((row,j) => !row || row.ref !== S.lines[row.i] || !R[[...dirtyRows][j]] || row.a !== R[row.i].a || row.b !== R[row.i].b)) return false;
  for (const row of rows as PLine[]) {
    const {wm,wb} = lineWords(row.i); row.words = []; row.el.replaceChildren(); mkWords(row.el,wm,row.words);
    if (wb) { const b = span('bg'); row.el.appendChild(b); mkWords(b,wb,row.words); }
  }
  dirtyRows.clear(); dirty = false; return true;
}

/* ---------- painting ---------- */
/** write a style only when it moved by more than eps (most words are at rest most of the time) */
function put(p: Part, prop: string, v: number, eps: number, css: (v: number) => string) {
  const o = p.c[prop]; if (o !== undefined && Math.abs(o - v) <= eps) return;
  p.c[prop] = v; p.el.style.setProperty(prop, css(v));
}
const px = (v: number) => v.toFixed(2) + 'px', pct = (v: number) => v.toFixed(1) + '%', num = (v: number) => v.toFixed(4);
const lift = (v: number) => `translate3d(0,calc(var(--ls) * ${v.toFixed(5)}),0)`;
const stateOf = (T: number, a: number, b: number) => T < a ? 0 : T >= b ? 2 : 1; // not sung · active · sung
const prog = (T: number, a: number, b: number) => T <= a ? 0 : T >= b ? 1 : (T - a) / (b - a);

function springs(p: Part, mk: () => Springs, s: number, y: number, g: number, o: number | undefined, dt: number) {
  if (!p.sp) { p.sp = mk(); p.sp.s.p = s; p.sp.y.p = y; p.sp.g.p = g; if (p.sp.o && o !== undefined) p.sp.o.p = o; } // start where it belongs: no jump after a rebuild
  p.sp.s.g = s; p.sp.y.g = y; p.sp.g.g = g; if (p.sp.o && o !== undefined) p.sp.o.g = o;
  return { s: p.sp.s.step(dt), y: p.sp.y.step(dt), g: p.sp.g.step(dt), o: p.sp.o ? p.sp.o.step(dt) : 1 };
}
function paintWord(w: Word, T: number, dt: number, fx: boolean) {
  const st = stateOf(T, w.a, w.b), p = prog(T, w.a, w.b);
  if (w.dot) {
    const q = st === 1 ? p : st / 2;
    const v = springs(w, dotSprings, C.dScale(q), C.dLift(q), C.dGlow(q), C.dOp(q), dt);
    put(w, 'transform', v.y, 1e-4, lift); put(w, 'scale', v.s, 1e-3, num); put(w, 'opacity', v.o, 1e-3, num);
    put(w, '--gb', 4 + 6 * v.g, 0.5, px); put(w, '--go', v.g * 0.9, 0.01, num);
    return;
  }
  const v = fx ? karaokeMotion(p) : { s: 1, y: 0, g: 0 };
  put(w, 'scale', v.s, 1e-3, num); put(w, 'transform', v.y, 1e-4, lift);
  if (!w.letters) {
    put(w, '--gp', st === 0 ? -20 : st === 2 ? 100 : -20 + 120 * p, 0.05, pct);
    put(w, '--gb', 4 + 2 * v.g, 0.5, px); put(w, '--go', Math.min(v.g * 0.35, 1), 0.01, num);
    return;
  }
  w.letters.forEach(l => {
    const ls = stateOf(T, l.a, l.b), lp = prog(T, l.a, l.b);
    const gp = ls === 0 ? -20 : ls === 2 ? 100 : -20 + 120 * lp;
    const lv = fx ? karaokeMotion(lp, true) : { s: 1, y: 0, g: 0 };
    put(l, '--gp', gp, 0.05, pct); put(l, 'transform', lv.y * 2, 1e-4, lift); put(l, 'scale', lv.s, 1e-3, num);
    put(l, '--gb', 4 + 6 * lv.g, 0.5, px); put(l, '--go', Math.min(lv.g * .3, .3), 0.01, num);
  });
}

let lastT = performance.now(), lastBlur = '', scrCur = -2, wheelOn = false;
const LOOK = 0.3; // scroll to a line slightly before its first word
/* wheel over the preview scrolls it by hand; it returns to the current line 3 s after the last wheel */
const SCR = { base: 0, manual: 0, until: 0 };
function applyScroll() { const el = inner(); if (!el) return; el.style.transition = SCR.manual ? 'transform .12s ease-out' : ''; el.style.transform = `translateY(${SCR.base + SCR.manual}px)`; }
/** one animation frame of the preview at playback time t */
export function previewFrame(t: number) {
  if (PREVIEW_EDIT.active) return;
  if (dirty && !updatePreviewRows()) buildPreview(true);
  const nowMs = performance.now(), dt = Math.min(0.25, (nowMs - lastT) / 1000); lastT = nowMs;
  const T = t + (S.voff || 0) / 1000, R = ranges();
  if (!wheelOn) { const lyr = inner()?.parentElement; if (lyr) { wheelOn = true; lyr.addEventListener('wheel', e => { if (PREVIEW_EDIT.active) return; e.preventDefault(); SCR.manual -= e.deltaY; SCR.until = performance.now() + 3000; applyScroll(); }, { passive: false }); } }
  // line states; the blur map is redrawn only when the current line changes
  let cur = -1;
  LINES.forEach((L, k) => {
    const st = T < L.a ? 'ns' : T >= L.b ? 'sung' : 'act';
    if (st === 'act' && cur < 0) cur = k;
    const cls = 'pl' + (L.dots ? ' dots' : '') + ' ' + st + (L.dots && st === 'act' && T > L.b - DOT_HIDE ? ' hide' : '');
    if (L.st !== cls) { L.st = cls; L.el.className = cls; }
  });
  if (cur < 0) cur = LINES.reduce((m, L, k) => L.a <= T ? k : m, -1);
  const sounding = LINES.flatMap((line, k) => T >= line.a && T < line.b ? [k] : []);
  const blurKey = `${cur}:${sounding.join(',')}:${S.blur}`;
  if (blurKey !== lastBlur) {
    lastBlur = blurKey;
    LINES.forEach((L, k) => { const d = sounding.length ? Math.min(...sounding.map(i => Math.abs(k - i))) : Math.abs(k - cur); L.el.style.setProperty('--blur', S.blur && d && cur >= 0 ? Math.min(BLUR * d, BLUR * 5.465).toFixed(2) + 'px' : '0px'); });
  }
  const { act, active, idx } = liveLines(R, T, LOOK), key = idx + ':' + cur;
  if (key !== PV.lastAct + ':' + scrCur) {
    PV.lastAct = idx; scrCur = cur;
    document.querySelectorAll('.ln').forEach(e => e.classList.toggle('on', active.includes(+e.id.slice(2))));
    const dl = LINES[cur]?.dots && T >= LINES[cur].a && T < LINES[cur].b ? LINES[cur].el : null; // an interlude: centre the dots
    const target = dl || document.getElementById('pl' + (idx >= 0 ? idx : Math.max(0, act))), box = inner();
    if (target && box) { const lyr = box.parentElement as HTMLElement; SCR.base = -(target.offsetTop + target.offsetHeight / 2 - lyr.clientHeight / 2); if (!SCR.manual) applyScroll(); }
    if (idx >= 0 && S.playing) { const r = document.getElementById('ln' + idx); if (r) r.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  }
  if (SCR.manual && performance.now() > SCR.until) { SCR.manual = 0; applyScroll(); }
  // Hidden lines need no per-letter style writes; active overlaps still paint even outside the viewport.
  for (const L of LINES) if (visible.has(L.el) || (T >= L.a && T < L.b)) for (const w of L.words) paintWord(w, T, dt, S.fx && !reducedMotion.matches);
}

