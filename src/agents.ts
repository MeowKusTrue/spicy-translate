// Singers per line (duets): v1 left, v2 right (opposite-aligned in Spicy Lyrics), v1000 together.
import { W, drawWave } from './waveform/wave.ts';
import type { Agent, Layer } from './core/index.ts';
import { S, emit, toast, layerText } from './state.ts';
import { buildPreview } from './preview.ts';
import { scheduleSave } from './persist.ts';
import { snap } from './sync.ts';
import { agentRows, assignAgent, assignWordAgent, type AgentWord } from './core/agents.ts';

export const AGENTS: { id: Agent; label: string; title: string }[] = [
  { id: 'v1', label: '1', title: 'Исполнитель 1 — строка слева' },
  { id: 'v2', label: '2', title: 'Исполнитель 2 — строка справа' },
  { id: 'v1000', label: '1+2', title: 'Вместе' },
];
export const agentOf = (i: number) => AGENTS.find(a => a.id === (S.lines[i]?.agent || 'v1'))!;
/** Line picking like in an editor: click, Shift = range, Ctrl = toggle. */
export function pickLine(i: number, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) {
  W.multi = [];
  const P = S.picked;
  if (e.shiftKey && S.pickAnchor >= 0) { P.clear(); for (let k = Math.min(S.pickAnchor, i); k <= Math.max(S.pickAnchor, i); k++) P.add(k); }
  else if (e.ctrlKey || e.metaKey) { if (P.has(i)) P.delete(i); else P.add(i); S.pickAnchor = i; }
  else { P.clear(); P.add(i); S.pickAnchor = i; }
  emit(); drawWave();
}
export function clearPicked() { if (!S.picked.size) return false; S.picked.clear(); emit(); return true; }
/** Assign a singer to the picked lines (or the line of the selected word). */
export const selectedAgentRows = () => agentRows(S.picked, W.multi, S.sel, S.lines.length);
export const selectedAgentWords = (): AgentWord[] => W.multi.length ? [...W.multi] : !S.picked.size && S.sel ? [{...S.sel,layer:S.layer}] : [];
export function setWordAgent(agent: Agent, words = selectedAgentWords()) {
  if (S.editDraft) return toast('Сначала сохрани или отмени правку текста.', 'err');
  if (!words.length) return toast('Выдели слова на таймлайне.', 'err');
  const plan=assignWordAgent(S.lines,words,agent);
  if ('error' in plan) return toast(plan.error,'err');
  if (plan.lines.length===S.lines.length && plan.lines.every((l,i)=>l===S.lines[i])) return;
  snap();S.lines=plan.lines;W.multi=[];S.picked=new Set(plan.selected);
  if(plan.selected.length) {
    S.sel={i:plan.selected[0],k:0};
    if (!layerText(S.lines[S.sel.i],S.layer).trim()) S.layer=(['orig','tr','bgo','bg'] as Layer[]).find(layer=>layerText(S.lines[S.sel!.i],layer).trim()) || S.layer;
  }
  buildPreview(true);emit();drawWave();scheduleSave();
  toast('Исполнитель назначен словам: они выделены в самостоятельные фразы. Тайминги сохранены; перевод распределён по его таймингам. Ctrl+Z — отмена.','ok');
}
export function setAgent(agent: Agent, ids = selectedAgentRows()) {
  if (S.editDraft) return toast('Сначала сохрани или отмени правку текста.', 'err');
  if (!ids.length) return toast('Выдели строки слева (клик, Shift — диапазон, Ctrl — по одной) или выбери слово.', 'err');
  const next = assignAgent(S.lines, ids, agent);
  if (next.every((l,i) => l === S.lines[i])) return;
  snap(); S.lines = next;
  buildPreview(true); emit(); drawWave(); scheduleSave();
  toast(`Голос «${AGENTS.find(a => a.id === agent)!.label}» → строк: ${ids.length}`, 'ok');
}
export function cycleAgent(i: number) {
  const l = S.lines[i]; if (!l) return;
  const next = AGENTS[(AGENTS.indexOf(agentOf(i)) + 1) % AGENTS.length].id;
  setAgent(next, [i]);
}
