// Remembered syllable splits: split a word once (U, «Разбить строку», "|" by hand) and it comes split in the
// whole song and in the next tracks. Kept per browser / app in localStorage.
import { applySplits, learnSplits, sylKey, type Layer } from './core/index.ts';
import { S, emit, layerText, ls, setText, toast } from './state.ts';

const KEY = 'sylDict';
export const SYL: Record<string, number[]> = (() => { try { return JSON.parse(ls.get(KEY, '{}') || '{}'); } catch { return {}; } })();
const save = () => ls.set(KEY, JSON.stringify(SYL));
const LAYERS: Layer[] = ['orig', 'tr', 'bgo', 'bg'];

/** split the known words of every line (only = just these keys); returns how many words were split */
export function spreadSplits(only?: Set<string>) {
  if (!S.sylMem) return 0;
  let n = 0;
  S.lines.forEach((l, i) => LAYERS.forEach(layer => {
    const r = applySplits(layerText(l, layer), l.sync && l.sync[layer], SYL, only); if (!r) return;
    setText(i, layer, r.text); n += r.n;
    if (r.sync !== undefined) { if (!l.sync) l.sync = {}; if (r.sync) l.sync[layer] = r.sync; else delete l.sync[layer]; }
  }));
  return n;
}
/** after a split by hand: remember the words of this text and split them elsewhere in the song */
export function learnAndSpread(text: string) {
  if (!S.sylMem) return;
  const got = learnSplits(text, SYL); if (!got.length) return;
  save(); const n = spreadSplits(new Set(got));
  toast(`Запомнил слоги: ${got.length === 1 ? '«' + got[0] + '»' : got.length + ' слов'}${n ? ` · ещё ${n} в песне разбито так же` : ''} — и в следующих треках.`, 'ok');
}
/** a word was put back together: forget it */
export function forgetWord(w: string) { const k = sylKey(w); if (k && SYL[k]) { delete SYL[k]; save(); } }
export function forgetAll() { for (const k of Object.keys(SYL)) delete SYL[k]; save(); emit(); toast('Запомненные слоги забыты.', 'ok'); }
export function setSylMem(on: boolean) { S.sylMem = on; ls.set('sylMem', on ? '1' : '0'); emit(); }
