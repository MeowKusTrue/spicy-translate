import { AGENTS, selectedAgentRows, setAgent, setWordAgent } from './agents.ts';
import { popMenu } from './contextMenu.ts';
import { S, emit, toast, viewWords } from './state.ts';
import { W, drawWave } from './waveform/wave.ts';
import { playWord } from './audio.ts';
import type { Layer } from './core/types.ts';

export function agentContextRows(i: number, word?: { k: number; layer: Layer }) {
  const selected = S.picked.has(i) || W.multi.some(w => w.i === i && (!word || w.k === word.k && w.layer === word.layer));
  if (!selected) { S.picked.clear(); W.multi = []; }
  S.sel = { i, k: word?.k ?? 0 }; if (word) S.layer = word.layer;
  emit(); drawWave();
  return selectedAgentRows();
}
export function agentMenuItems(item: (label: string, f: () => void, off?: boolean, checked?: boolean) => void, ids: number[]) {
  for (const a of AGENTS) item(`${a.label} — ${a.id === 'v1000' ? 'Вместе' : 'Исполнитель ' + a.label}`, () => setAgent(a.id, ids), false,
    ids.length > 0 && ids.every(i => (S.lines[i]?.agent || 'v1') === a.id));
}
export function openAgentMenu(e: { clientX: number; clientY: number; preventDefault(): void }, i: number, word?: { k: number; layer: Layer }) {
  e.preventDefault();
  if (S.editDraft) return toast('Сначала сохрани или отмени правку текста.', 'err');
  if (!S.lines[i]) return;
  const ids = agentContextRows(i, word);
  popMenu(e, `Исполнитель · строк: ${ids.length}`, item => {
    if (word || W.multi.length) {
      const words = W.multi.length ? [...W.multi] : [{i,k:word!.k,layer:word!.layer}];
      item('Для выделенных слов · отдельными фразами',()=>{},true);
      for(const a of AGENTS) item(`Только слова: ${a.id === 'v1000' ? 'Вместе 1+2' : 'Исполнитель '+a.label}`,()=>setWordAgent(a.id,words));
    }
    item('Для строк целиком',()=>{},true);
    agentMenuItems(item, ids);
    if (word) {
      const timing = viewWords(i, word.layer)[word.k];
      item('Прослушать слово', () => playWord({ a: timing.a!, b: timing.b! }), !S.hasAudio || timing?.a == null || timing?.b == null);
    }
  });
}
