// App state: one mutable object S (same shape as the single-file version) + a change counter for React.
// Hot paths (rAF loop, wave drag) mutate S and paint the DOM/canvas directly; everything else calls emit().
import { useSyncExternalStore } from 'react';
import { splitWords, syncComplete, units, wordList } from './core/index.ts';
import type { Layer, Line, Mode, QaItem, WordSync } from './core/index.ts';

export type Msg = { msg: string; cls: string };
export type Page = 'track' | 'text' | 'tr' | 'sync' | 'export';
export interface LrclibHit { id: number; trackName: string; artistName: string; albumName: string | null; duration: number; syncedLyrics: string | null; plainLyrics: string | null }

export const ls = {
  get(k: string, d: string | null = null) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, String(v)); return true; } catch { return false; } },
};

export const S = {
  lines: [] as Line[],
  meta: { title: '', artist: '', lang: 'ru', mode: 'translation' as Mode },
  duration: 0,
  // playback / clock
  hasAudio: false, playing: false, vt: 0, vStart: 0, rate: 1, vol: 0.3,
  audioBlob: null as Blob | null, audioUrl: '',
  // word sync
  picked: new Set<number>(), pickAnchor: -1,
  layer: 'tr' as Layer, sel: null as { i: number; k: number } | null, undo: [] as string[], redo: [] as string[],
  cover: '', coverBg: true, blur: true, // preview: cover picture (object URL) behind the lyrics, blur of the other lines
  folder: null as null | { label: string; saved: number }, // the project folder of this track (src/folder.ts)
  srcDur: 0, // length of the track version the timings came from (LRCLIB), for «Растянуть»
  sylMem: true, // split a word once -> split everywhere (src/syllables.ts)
  waveView: 'wave' as 'wave' | 'spec', // the wave panel shows the waveform or a spectrogram
  chips: 'big' as 'big' | 'small' | 'off', // word chips under the wave
  dock: false, fx: true, snap: true, onsetSnap: true, waveVoice: false, autoFit: false, fitPad: { a: 0, b: 0 }, loop: false, voff: 0, lat: 100, // autoFit: line ends follow their words (+fitPad ms of slack)
  align: null as null | { stage: string; done: number; total: number; device: string }, // auto-timing in progress
  alignPanel: null as null | { gpu: import('./autoAlign.ts').Gpu | null; st: import('./autoAlign.ts').SetupState | null; pick: string; err: string },
  setup: null as null | { step: string; pct: number }, // auto-timing install in progress
  ver: 0, // bumps whenever preview timings change
  // form fields
  q: '', manual: '', results: [] as LrclibHit[],
  exp: { spread: true, offset: '0', writers: '', roman: false }, shiftMs: 100,
  llm: { prov: 'openai', model: '', url: '', key: '', style: '' },
  // ui
  st1: { msg: '', cls: '' } as Msg, st2: { msg: '', cls: '' } as Msg, toast: { msg: '', cls: '' } as Msg,
  save: { msg: '💾 —', cls: '' } as Msg, live: null as Msg | null,
  qa: null as QaItem[] | null, paste: null as string | null, out: null as string | null,
  help: false, typing: false, busyAuto: false, busyLlm: false,
  palette: null as null | { q: string; i: number }, // Ctrl+K
  maxed: false, // desktop app window maximized
  page: 'track' as Page, prevPage: 'tr' as Page, // the tab shown; the sync tab opens the dock
  genius: null as null | { q: string; hits: import('./genius.ts').GeniusHit[]; busy: boolean; msg: string; cls: string; text?: string; heads?: { row: number; label: string }[]; title?: string; ignored: string[] }, // «Текст с Genius» + its check
  full: null as null | { o: string; t: string; dirty: boolean }, // «Текст» tab draft
  find: null as null | { q: string; r: string; where: 'tr' | 'orig' | 'all'; cs: boolean; word: boolean },
};

/* ---------- change notification for React ---------- */
const subs = new Set<() => void>();
let rev = 0;
export function emit() { rev++; subs.forEach(f => f()); }
export function useS() { return useSyncExternalStore(cb => { subs.add(cb); return () => { subs.delete(cb); }; }, () => rev); }

export const r3 = (x: number) => Math.round(x * 1000) / 1000;
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export function status(which: 'st1' | 'st2', msg?: string, cls?: string) { S[which] = { msg: msg || '', cls: cls || '' }; emit(); }
let toastT: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string, cls?: string) {
  S.toast = { msg, cls: cls || '' }; clearTimeout(toastT); toastT = setTimeout(() => { S.toast = { msg: '', cls: '' }; emit(); }, 4000);
  status('st2', msg, cls);
}

/* ---------- words / layers ---------- */
export function layerText(l: Line, layer: Layer) { return layer === 'tr' ? (l.tr || '') : layer === 'orig' ? l.text : layer === 'bg' ? (l.bg?.tr || '') : (l.bg?.text || ''); }
export function wordsOf(i: number, layer: Layer) { return wordList(layerText(S.lines[i], layer)); }
export function ensureSync(i: number, layer: Layer): WordSync[] {
  const l = S.lines[i], n = wordsOf(i, layer).length;
  l.sync = l.sync || {};
  let s = l.sync[layer];
  if (!s || s.length !== n) s = l.sync[layer] = Array.from({ length: n }, () => ({ a: null, b: null }));
  return s;
}
export type ViewWord = { word: string; sp: boolean; a: number | null; b: number | null; real?: boolean; g?: boolean; pending?: boolean; ghost?: boolean };
// what to show/draw for a line+layer: real timings where set, ghost spread otherwise
export function viewWords(i: number, layer: Layer): ViewWord[] {
  const l = S.lines[i], us = units(layerText(l, layer)), sy = l.sync && l.sync[layer];
  if (sy && sy.length === us.length) {
    return us.map((u, k) => (sy[k].a != null && sy[k].b != null) ? { word: u.w, sp: u.sp, a: sy[k].a, b: sy[k].b, real: true, g: !!sy[k].g } : { word: u.w, sp: u.sp, a: null, b: null, pending: true });
  }
  return splitWords(layerText(l, layer), l.t, l.end).map(w => ({ ...w, ghost: true }));
}
// g:1 on a word = auto-placed (spread), not yet confirmed by hand; any real edit clears it
export const conf = (...xs: (WordSync | null | undefined)[]) => xs.forEach(x => { if (x) delete x.g; });
export function lineState(i: number, layer: Layer): 'none' | 'part' | 'done' {
  const n = wordsOf(i, layer).length, sy = S.lines[i].sync && S.lines[i].sync![layer];
  if (!n) return 'none';
  if (syncComplete(sy, n) && !sy.some(x => x.g)) return 'done';
  if (sy && sy.length === n && sy.some(x => !x.g && (x.a != null || x.b != null))) return 'part';
  return 'none';
}
export function spreadLine(i: number, layer: Layer) {
  const l = S.lines[i], ws = wordsOf(i, layer); if (!ws.length) return;
  l.sync = l.sync || {};
  l.sync[layer] = splitWords(layerText(l, layer), l.t, l.end).map(w => ({ a: r3(w.a), b: r3(w.b), g: 1 as const }));
}
// make every word of the line a real, draggable block right away (gaps are filled by an even spread, flagged g)
export function fillLine(i: number, layer: Layer) {
  const l = S.lines[i], n = wordsOf(i, layer).length; if (!n || lineState(i, layer) === 'done') return false;
  const sy = ensureSync(i, layer), full = sy.every(x => x.a == null && x.b == null);
  if (full) { spreadLine(i, layer); return true; }
  sy.forEach((x, k) => {
    const nx = sy.slice(k + 1).find(y => y.a != null);
    if (x.a != null && x.b == null) x.b = r3(Math.min(x.a + 0.3, nx ? nx.a! : l.end));
    else if (x.b != null && x.a == null) x.a = r3(Math.max(k && sy[k - 1].b != null ? sy[k - 1].b! : l.t, x.b - 0.3));
  });
  const ws = wordsOf(i, layer);
  for (let k = 0; k < n;) {
    if (sy[k].a != null) { k++; continue; }
    let e = k; while (e < n && sy[e].a == null) e++;
    const t0 = k && sy[k - 1].b != null ? sy[k - 1].b! : l.t, t1 = e < n ? sy[e].a! : Math.max(l.end, t0 + 0.3 * (e - k));
    splitWords(ws.slice(k, e).join(' '), t0, t1).forEach((w, j) => { sy[k + j].a = r3(w.a); sy[k + j].b = r3(w.b); sy[k + j].g = 1; });
    k = e;
  }
  return true;
}
export function mainLayerFor(i: number): Layer { return S.meta.mode === 'bilingual' ? 'orig' : (S.lines[i].tr && S.lines[i].tr.trim() ? 'tr' : 'orig'); }
/* a layer = track (main / bg) × language (translation / original); the wave shows both tracks of the language */
export const isBg = (l: Layer) => l === 'bg' || l === 'bgo';
export const isTr = (l: Layer) => l === 'tr' || l === 'bg';
export const mkLayer = (bg: boolean, tr: boolean): Layer => bg ? (tr ? 'bg' : 'bgo') : (tr ? 'tr' : 'orig');
export function setText(i: number, layer: Layer, v: string) {
  const l = S.lines[i];
  if (layer === 'tr') l.tr = v; else if (layer === 'orig') l.text = v;
  else { l.bg = l.bg || { text: '', tr: '' }; if (layer === 'bg') l.bg.tr = v; else l.bg.text = v; }
}
