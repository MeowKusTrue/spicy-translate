// Live preview that moves like Spicy Lyrics, so a maker sees what listeners will see.
// Reimplemented from how Spicy behaves (its code is AGPL; nothing is copied):
// - every word rides three springs (scale, lift, glow) whose goals follow curves over the word's progress;
//   the fill is a soft gradient sweeping left to right;
// - a syllable that lasts ≥ 1 s is drawn letter by letter: the letters share the time (ending 0.25 s early)
//   and the one being sung swells, its neighbours a little less;
// - a gap of ≥ 3 s between lines shows three breathing dots;
// - lines not being sung are dimmed and blurred by their distance from the current one.
// Built imperatively into #lyrIn (React owns only the container): per-frame painting must not go through React.
import { getWords, liveLines, plainW, syncComplete, units, type Layer, type TimedWord } from './core/index.ts';
import { S, layerText, mainLayerFor } from './state.ts';
import { seekTo } from './audio.ts';

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
const easeSinOut = (t: number) => Math.sin(t * Math.PI / 2);
const C = {
  scale: curve([[0, 0.95], [0.7, 1.0505], [1, 1]]),
  lift: curve([[0, 0.01], [0.9, -1 / 60], [1, 0]]), // × font size
  glow: curve([[0, 0], [0.15, 1], [0.6, 1], [1, 0]]),
  lScale: curve([[0, 0.95], [0.7, 1.175], [1, 1]]),
  lLift: curve([[0, 0.01], [0.9, -1 / 56], [1, 0]]),
  dScale: curve([[0, 0.75], [0.7, 1.05], [1, 1]]),
  dLift: curve([[0, 0], [0.9, -0.12], [1, 0]]),
  dGlow: curve([[0, 0], [0.6, 1], [1, 1]]),
  dOp: curve([[0, 0.35], [0.6, 1], [1, 1]]),
};
const LETTER_MIN = 1, LETTER_EARLY = 0.25, GAP_DOTS = 3, DOT_PAD = 0.55, DOT_HIDE = 0.5, BLUR = 1.25;

type Springs = { s: Spring; y: Spring; g: Spring; o?: Spring };
const wordSprings = (): Springs => ({ s: new Spring(0.95, 0.88, 0.64), y: new Spring(0.01, 1.45, 0.4), g: new Spring(0, 1.18, 0.56) });
const dotSprings = (): Springs => ({ s: new Spring(0.75, 0.7, 0.6), y: new Spring(0, 1.25, 0.4), g: new Spring(0, 1, 0.5), o: new Spring(0.35, 1, 0.5) });
interface Part { el: HTMLElement; a: number; b: number; sp?: Springs; c: Record<string, number> }
interface Word extends Part { letters?: Part[]; dot?: boolean }
interface PLine { el: HTMLElement; a: number; b: number; words: Word[]; i: number; dots?: boolean; st?: string }

/** words of the main line + the small line under it (translation in bilingual mode, background vocals otherwise) */
function lineWords(i: number) {
  const l = S.lines[i], ml = mainLayerFor(i);
  const wm = getWords(layerText(l, ml), l.sync && l.sync[ml], l.t, l.end);
  let wb: TimedWord[] | null = null;
  if (S.meta.mode === 'bilingual') { if (l.tr && l.tr.trim()) wb = getWords(l.tr.trim(), l.sync && l.sync.tr, l.t, l.end); }
  else if (l.bg) {
    const bl: Layer = l.bg.tr && l.bg.tr.trim() ? 'bg' : 'bgo', txt = layerText(l, bl).trim();
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
const span = (cls: string, text = '') => { const e = document.createElement('span'); e.className = cls; e.textContent = text; return e; };
function mkWords(host: HTMLElement, arr: TimedWord[], out: Word[]) {
  arr.forEach(w => {
    const txt = plainW(w.word), chars = [...txt], d = w.b - w.a;
    let wd: Word;
    if (d >= LETTER_MIN && chars.length) { // long syllable: letter by letter
      const el = span('w lg'), b = w.b - LETTER_EARLY, step = (b - w.a) / chars.length;
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
  S.ver++; dirty = false;
  const box = inner(); if (!box) return;
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
    el.onclick = () => seekTo(l.t);
    box.appendChild(el); LINES.push({ el, a: R[i].a, b: R[i].b, words, i });
  });
  lastBlur = -2;
  if (!keepPos) PV.lastAct = -2;
}
/** a line's words or timings changed: rebuilt on the next frame (several edits in one frame cost one rebuild) */
export function refreshPreviewLine(_i: number) { S.ver++; dirty = true; } // ponytail: whole-preview rebuild; per-line patching if long songs get slow

const RNG = { ver: -1, r: [] as { a: number; b: number }[] };
function ranges() { // per-line [start,end] for the main layer, recomputed only when lyrics/timings change
  if (RNG.ver === S.ver && RNG.r.length === S.lines.length) return RNG.r;
  RNG.ver = S.ver; RNG.r = S.lines.map((l, i) => {
    const { wm, wb } = lineWords(i), ws = wm.concat(wb || []);
    return ws.length ? { a: Math.min(l.t, ...ws.map(w => w.a)), b: Math.max(l.end, ...ws.map(w => w.b)) } : { a: l.t, b: l.end };
  });
  return RNG.r;
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
  const q = st === 1 ? p : st / 2; // rest = curve(0), sung = curve(1)
  const v = fx ? springs(w, wordSprings, C.scale(q), C.lift(q), C.glow(q), undefined, dt) : { s: 1, y: 0, g: 0 };
  put(w, 'scale', v.s, 1e-3, num); put(w, 'transform', v.y, 1e-4, lift);
  if (!w.letters) {
    put(w, '--gp', st === 0 ? -20 : st === 2 ? 100 : -20 + 120 * p, 0.05, pct);
    put(w, '--gb', 4 + 2 * v.g, 0.5, px); put(w, '--go', Math.min(v.g * 0.35, 1), 0.01, num);
    return;
  }
  const L = w.letters, act = st === 1 ? L.findIndex(l => T >= l.a && T < l.b) : -1, ap = act >= 0 ? prog(T, L[act].a, L[act].b) : 0;
  L.forEach((l, k) => {
    const ls = stateOf(T, l.a, l.b);
    let s = C.lScale(0), y = C.lLift(0), g = C.glow(0), gp = -20;
    if (st === 2) { s = C.lScale(1); y = C.lLift(1); g = C.glow(1); gp = 100; }
    else if (st === 1) {
      if (act >= 0) { // the sung letter swells, its neighbours follow with a steep falloff
        const d = Math.abs(k - act), f = 1 / (1 + Math.pow(d, 2.8)), gf = 1 / (1 + d * 0.9);
        s += (C.lScale(ap) - s) * f; y += (C.lLift(ap) - y) * f; g += (C.glow(ap) - g) * gf;
      }
      if (ls === 0) { s = C.lScale(0); y = C.lLift(0); g = C.glow(0); }
      else if (ls === 2 && act < 0) g = C.glow(0.2);
      gp = ls === 0 ? -20 : ls === 2 ? 100 : k === act ? -20 + 120 * easeSinOut(ap) : -20;
    }
    const lv = fx ? springs(l, wordSprings, s, y, g, undefined, dt) : { s: 1, y: 0, g: 0 };
    put(l, '--gp', gp, 0.05, pct); put(l, 'transform', lv.y * 2, 1e-4, lift); put(l, 'scale', lv.s, 1e-3, num);
    put(l, '--gb', 4 + 12 * lv.g, 0.5, px); put(l, '--go', Math.min(lv.g * 1.85, 1), 0.01, num);
  });
}

let lastT = performance.now(), lastBlur = -2, scrCur = -2, wheelOn = false;
const LOOK = 0.3; // scroll to a line slightly before its first word
/* wheel over the preview scrolls it by hand; it returns to the current line 3 s after the last wheel */
const SCR = { base: 0, manual: 0, until: 0 };
function applyScroll() { const el = inner(); if (!el) return; el.style.transition = SCR.manual ? 'transform .12s ease-out' : ''; el.style.transform = `translateY(${SCR.base + SCR.manual}px)`; }
/** one animation frame of the preview at playback time t */
export function previewFrame(t: number) {
  if (dirty) buildPreview(true);
  const nowMs = performance.now(), dt = Math.min(0.25, (nowMs - lastT) / 1000); lastT = nowMs;
  const T = t + (S.voff || 0) / 1000, R = ranges();
  if (!wheelOn) { const lyr = inner()?.parentElement; if (lyr) { wheelOn = true; lyr.addEventListener('wheel', e => { e.preventDefault(); SCR.manual -= e.deltaY; SCR.until = performance.now() + 3000; applyScroll(); }, { passive: false }); } }
  // line states; the blur map is redrawn only when the current line changes
  let cur = -1;
  LINES.forEach((L, k) => {
    const st = T < L.a ? 'ns' : T >= L.b ? 'sung' : 'act';
    if (st === 'act' && cur < 0) cur = k;
    const cls = 'pl' + (L.dots ? ' dots' : '') + ' ' + st + (L.dots && st === 'act' && T > L.b - DOT_HIDE ? ' hide' : '');
    if (L.st !== cls) { L.st = cls; L.el.className = cls; }
  });
  if (cur < 0) cur = LINES.reduce((m, L, k) => L.a <= T ? k : m, -1);
  if (cur !== lastBlur) {
    lastBlur = cur;
    LINES.forEach((L, k) => { const d = Math.abs(k - cur); L.el.style.setProperty('--blur', S.blur && d && cur >= 0 ? Math.min(BLUR * d, BLUR * 5.465).toFixed(2) + 'px' : '0px'); });
  }
  const { act, active, idx } = liveLines(R, T, LOOK), key = idx + ':' + cur;
  if (key !== PV.lastAct + ':' + scrCur) {
    PV.lastAct = idx; scrCur = cur;
    document.querySelectorAll('.ln').forEach((e, i) => e.classList.toggle('on', active.includes(i)));
    const dl = LINES[cur]?.dots && T >= LINES[cur].a && T < LINES[cur].b ? LINES[cur].el : null; // an interlude: centre the dots
    const target = dl || document.getElementById('pl' + (idx >= 0 ? idx : Math.max(0, act))), box = inner();
    if (target && box) { const lyr = box.parentElement as HTMLElement; SCR.base = -(target.offsetTop + target.offsetHeight / 2 - lyr.clientHeight / 2); if (!SCR.manual) applyScroll(); }
    if (idx >= 0 && S.playing) { const r = document.getElementById('ln' + idx); if (r) r.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  }
  if (SCR.manual && performance.now() > SCR.until) { SCR.manual = 0; applyScroll(); }
  for (const L of LINES) for (const w of L.words) paintWord(w, T, dt, S.fx);
}

