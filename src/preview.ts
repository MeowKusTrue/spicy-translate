// Spicy-like karaoke preview. Built imperatively into #lyrIn (React owns only the container):
// per-frame painting of hundreds of spans must not go through React.
import { getWords, liveLines, plainW, syncComplete, units, type Layer, type TimedWord } from './core/index.ts';
import { S, layerText, mainLayerFor } from './state.ts';
import { seekTo } from './audio.ts';

export const PV = { lastAct: -2 };
const inner = () => document.getElementById('lyrIn');

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

function mkWords(arr: TimedWord[]) { return arr.map(w => `<span class="w${w.b - w.a >= 1 ? ' em' : ''}" data-a="${w.a ?? ''}" data-b="${w.b ?? ''}"></span>${w.sp === false ? '' : ' '}`).join(''); }
export function buildPreview(keepPos?: boolean) {
  S.ver++;
  const box = inner(); if (!box) return;
  box.innerHTML = '';
  if (!S.lines.length) { box.innerHTML = '<div class="empty">Тут появится живое превью лирики</div>'; return; }
  S.lines.forEach((l, i) => {
    const { wm, wb } = lineWords(i);
    const el = document.createElement('div'); el.className = 'pl'; el.id = 'pl' + i; el.dataset.agent = l.agent || 'v1';
    el.innerHTML = mkWords(wm) + (wb ? `<span class="bg">${mkWords(wb)}</span>` : '');
    el.querySelectorAll<HTMLElement>(':scope > .w').forEach((n, k) => n.textContent = plainW(wm[k].word));
    if (wb) el.querySelectorAll<HTMLElement>('.bg .w').forEach((n, k) => n.textContent = plainW(wb[k].word));
    el.onclick = () => seekTo(l.t);
    box.appendChild(el);
  });
  if (!keepPos) PV.lastAct = -2;
}
export function refreshPreviewLine(i: number) {
  S.ver++;
  const el = document.getElementById('pl' + i); if (!el) return;
  const { wm, wb } = lineWords(i);
  const nodes = el.querySelectorAll<HTMLElement>(':scope > .w');
  if (nodes.length !== wm.length) return buildPreview(true);
  nodes.forEach((n, k) => { n.dataset.a = String(wm[k].a); n.dataset.b = String(wm[k].b); n.classList.toggle('em', wm[k].b - wm[k].a >= 1); });
  const bn = el.querySelectorAll<HTMLElement>('.bg .w');
  if ((wb ? wb.length : 0) !== bn.length) return buildPreview(true);
  if (wb) bn.forEach((n, k) => { n.dataset.a = String(wb[k].a); n.dataset.b = String(wb[k].b); });
}

const RNG = { ver: -1, r: [] as { a: number; b: number }[] };
function ranges() { // per-line [start,end] for the main layer, recomputed only when lyrics/timings change
  if (RNG.ver === S.ver && RNG.r.length === S.lines.length) return RNG.r;
  RNG.ver = S.ver; RNG.r = S.lines.map((l, i) => {
    const { wm, wb } = lineWords(i), ws = wm.concat(wb || []);
    return ws.length ? { a: Math.min(l.t, ...ws.map(w => w.a)), b: Math.max(l.end, ...ws.map(w => w.b)) } : { a: l.t, b: l.end };
  });
  return RNG.r;
}
type WNode = HTMLElement & { _g?: string; _l?: string; _on?: boolean; _d?: boolean };
function paintWords(nodes: WNode[], T: number) {
  for (const n of nodes) {
    const a = +n.dataset.a!, b = +n.dataset.b!, p = Math.max(0, Math.min(1, (T - a) / Math.max(0.001, b - a)));
    const on = T >= a - 0.05 && T < b + 0.25, lift = on ? (T < b ? Math.min(1, (T - a + 0.05) / 0.12) : 1 - (T - b) / 0.25) : 0;
    const g = (p * 116 - 6).toFixed(1), lf = Math.max(0, lift).toFixed(2);
    if (n._g !== g) { n._g = g; n.style.setProperty('--g', g); }
    if (n._l !== lf) { n._l = lf; n.style.setProperty('--lift', lf); }
    if (n._on !== on) { n._on = on; n.classList.toggle('on', on); }
    const d = T >= b; if (n._d !== d) { n._d = d; n.classList.toggle('done', d); }
  }
}

let nodesVer = -1, actKey = '', wheelOn = false;
const liveNodes = new Map<number, WNode[]>();
const LOOK = 0.3; // activate/scroll a line slightly before its first word, so CSS transitions finish on time
/* wheel over the preview scrolls it by hand; it returns to the current line 3 s after the last wheel */
const SCR = { base: 0, manual: 0, until: 0 };
function applyScroll() { const el = inner(); if (!el) return; el.style.transition = SCR.manual ? 'transform .12s ease-out' : ''; el.style.transform = `translateY(${SCR.base + SCR.manual}px)`; }
/** one animation frame of the preview at playback time t */
export function previewFrame(t: number) {
  const T = t + (S.voff || 0) / 1000, R = ranges();
  if (!wheelOn) { const lyr = inner()?.parentElement; if (lyr) { wheelOn = true; lyr.addEventListener('wheel', e => { e.preventDefault(); SCR.manual -= e.deltaY; SCR.until = performance.now() + 3000; applyScroll(); }, { passive: false }); } }
  const { act, live, active, idx } = liveLines(R, T, LOOK), key = active.join(',');
  if (key !== actKey || idx !== PV.lastAct) {
    actKey = key; PV.lastAct = idx;
    document.querySelectorAll('.pl').forEach((e, i) => e.className = 'pl' + (S.fx ? ' fx' : '') + (active.includes(i) ? ' act' : (Math.abs(i - idx) === 1 ? ' near' : '')));
    document.querySelectorAll('.ln').forEach((e, i) => e.classList.toggle('on', active.includes(i)));
    const target = document.getElementById('pl' + (idx >= 0 ? idx : Math.max(0, act))), box = inner();
    if (target && box) { const lyr = box.parentElement as HTMLElement; SCR.base = -(target.offsetTop + target.offsetHeight / 2 - lyr.clientHeight / 2); if (!SCR.manual) applyScroll(); }
    if (idx >= 0 && S.playing) { const r = document.getElementById('ln' + idx); if (r) r.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  }
  if (SCR.manual && performance.now() > SCR.until) { SCR.manual = 0; applyScroll(); }
  if (nodesVer !== S.ver) { nodesVer = S.ver; liveNodes.clear(); }
  for (const [i, nodes] of liveNodes) if (!live.includes(i)) { paintWords(nodes, T); liveNodes.delete(i); } // final state on leave
  for (const i of live) { let n = liveNodes.get(i); if (!n) { n = [...document.querySelectorAll<WNode>('#pl' + i + ' .w')]; liveNodes.set(i, n); } paintWords(n, T); }
}
