// Spicy-like karaoke preview. Built imperatively into #lyrIn (React owns only the container):
// per-frame painting of hundreds of spans must not go through React.
import { getWords, plainW, type TimedWord } from './core/index.ts';
import { S, layerText, mainLayerFor } from './state.ts';
import { seekTo } from './audio.ts';

export const PV = { lastAct: -2 };
const inner = () => document.getElementById('lyrIn');

function mkWords(arr: TimedWord[]) { return arr.map(w => `<span class="w${w.b - w.a >= 1 ? ' em' : ''}" data-a="${w.a ?? ''}" data-b="${w.b ?? ''}"></span>${w.sp === false ? '' : ' '}`).join(''); }
export function buildPreview(keepPos?: boolean) {
  S.ver++;
  const box = inner(); if (!box) return;
  box.innerHTML = '';
  if (!S.lines.length) { box.innerHTML = '<div class="empty">Тут появится живое превью лирики</div>'; return; }
  const bi = S.meta.mode === 'bilingual';
  S.lines.forEach((l, i) => {
    const mainLayer = mainLayerFor(i);
    const wm = getWords(layerText(l, mainLayer), l.sync && l.sync[mainLayer], l.t, l.end);
    const wb = bi && l.tr && l.tr.trim() ? getWords(l.tr.trim(), l.sync && l.sync.tr, l.t, l.end) : null;
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
  const l = S.lines[i], bi = S.meta.mode === 'bilingual', ml = mainLayerFor(i);
  const wm = getWords(layerText(l, ml), l.sync && l.sync[ml], l.t, l.end);
  const nodes = el.querySelectorAll<HTMLElement>(':scope > .w');
  if (nodes.length !== wm.length) return buildPreview(true);
  nodes.forEach((n, k) => { n.dataset.a = String(wm[k].a); n.dataset.b = String(wm[k].b); n.classList.toggle('em', wm[k].b - wm[k].a >= 1); });
  if (bi && l.tr && l.tr.trim()) {
    const wb = getWords(l.tr.trim(), l.sync && l.sync.tr, l.t, l.end), bn = el.querySelectorAll<HTMLElement>('.bg .w');
    bn.forEach((n, k) => { if (wb[k]) { n.dataset.a = String(wb[k].a); n.dataset.b = String(wb[k].b); } });
  }
}

const RNG = { ver: -1, r: [] as { a: number; b: number }[] };
function ranges() { // per-line [start,end] for the main layer, recomputed only when lyrics/timings change
  if (RNG.ver === S.ver && RNG.r.length === S.lines.length) return RNG.r;
  RNG.ver = S.ver; RNG.r = S.lines.map((l, i) => {
    const ml = mainLayerFor(i), ws = getWords(layerText(l, ml), l.sync && l.sync[ml], l.t, l.end);
    return ws.length ? { a: Math.min(l.t, ws[0].a), b: Math.max(l.end, ws[ws.length - 1].b) } : { a: l.t, b: l.end };
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

let actNodes: WNode[] = [], nodesVer = -1;
const LOOK = 0.3; // activate/scroll a line slightly before its first word, so CSS transitions finish on time
/** one animation frame of the preview at playback time t */
export function previewFrame(t: number) {
  const T = t + (S.voff || 0) / 1000, R = ranges();
  let act = -1;
  for (let i = 0; i < R.length; i++) { if (T + LOOK >= R[i].a) act = i; else break; }
  const idx = act >= 0 && T <= R[act].b + 0.4 ? act : -1;
  if (idx !== PV.lastAct) {
    paintWords(actNodes, T); PV.lastAct = idx;
    document.querySelectorAll('.pl').forEach((e, i) => e.className = 'pl' + (S.fx ? ' fx' : '') + (i === idx ? ' act' : (Math.abs(i - idx) === 1 ? ' near' : '')));
    document.querySelectorAll('.ln').forEach((e, i) => e.classList.toggle('on', i === idx));
    const target = document.getElementById('pl' + (idx >= 0 ? idx : Math.max(0, act)));
    const box = inner();
    if (target && box) box.style.transform = `translateY(${-(target.offsetTop - 20)}px)`;
    if (idx >= 0 && S.playing) { const r = document.getElementById('ln' + idx); if (r) r.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    nodesVer = -1;
  }
  if (nodesVer !== S.ver) { nodesVer = S.ver; actNodes = idx >= 0 ? [...document.querySelectorAll<WNode>('#pl' + idx + ' .w')] : []; }
  paintWords(actNodes, T);
}
