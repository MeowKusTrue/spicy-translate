// Editing line texts in the list: original, translation, background vocals (bg = its translation, bgo = original).
import { wordList, type Layer } from './core/index.ts';
import { S, emit, layerText } from './state.ts';
import { buildPreview } from './preview.ts';
import { scheduleSave } from './persist.ts';
import { drawWave } from './waveform/wave.ts';

const after = () => { buildPreview(true); emit(); drawWave(); scheduleSave(); };
/** keeps word timings while the word count is unchanged; otherwise that layer's timings are dropped */
export function editText(i: number, layer: Layer, v: string) {
  const l = S.lines[i]; if (!l) return;
  if (layer === 'tr') l.tr = v; else if (layer === 'orig') l.text = v;
  else { l.bg = l.bg || { text: '', tr: '' }; if (layer === 'bg') l.bg.tr = v; else l.bg.text = v; }
  if (l.sync && l.sync[layer] && l.sync[layer]!.length !== wordList(layerText(l, layer)).length) delete l.sync[layer];
  after();
}
export function addBg(i: number) { const l = S.lines[i]; if (l && !l.bg) { l.bg = { text: '', tr: '' }; emit(); } }
export function delBg(i: number) { const l = S.lines[i]; if (!l) return; delete l.bg; if (l.sync) { delete l.sync.bg; delete l.sync.bgo; } after(); }
