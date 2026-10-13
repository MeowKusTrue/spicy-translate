// Singers per line (duets): v1 left, v2 right (opposite-aligned in Spicy Lyrics), v1000 together.
import type { Agent } from './core/index.ts';
import { S, emit, toast } from './state.ts';
import { buildPreview } from './preview.ts';
import { scheduleSave } from './persist.ts';

export const AGENTS: { id: Agent; label: string; title: string }[] = [
  { id: 'v1', label: '1', title: 'Исполнитель 1 — строка слева' },
  { id: 'v2', label: '2', title: 'Исполнитель 2 — строка справа' },
  { id: 'v1000', label: '1+2', title: 'Вместе' },
];
export const agentOf = (i: number) => AGENTS.find(a => a.id === (S.lines[i]?.agent || 'v1'))!;
/** Line picking like in an editor: click, Shift = range, Ctrl = toggle. */
export function pickLine(i: number, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) {
  const P = S.picked;
  if (e.shiftKey && S.pickAnchor >= 0) { P.clear(); for (let k = Math.min(S.pickAnchor, i); k <= Math.max(S.pickAnchor, i); k++) P.add(k); }
  else if (e.ctrlKey || e.metaKey) { if (P.has(i)) P.delete(i); else P.add(i); S.pickAnchor = i; }
  else { P.clear(); P.add(i); S.pickAnchor = i; }
  emit();
}
export function clearPicked() { if (!S.picked.size) return false; S.picked.clear(); emit(); return true; }
/** Assign a singer to the picked lines (or the line of the selected word). */
export function setAgent(agent: Agent) {
  const ids = S.picked.size ? [...S.picked] : S.sel ? [S.sel.i] : [];
  if (!ids.length) return toast('Выдели строки слева (клик, Shift — диапазон, Ctrl — по одной) или выбери слово.', 'err');
  for (const i of ids) { const l = S.lines[i]; if (!l) continue; if (agent === 'v1') delete l.agent; else l.agent = agent; }
  buildPreview(true); emit(); scheduleSave();
  toast(`Голос «${AGENTS.find(a => a.id === agent)!.label}» → строк: ${ids.length}`, 'ok');
}
export function cycleAgent(i: number) {
  const l = S.lines[i]; if (!l) return;
  const next = AGENTS[(AGENTS.indexOf(agentOf(i)) + 1) % AGENTS.length].id;
  if (next === 'v1') delete l.agent; else l.agent = next;
  buildPreview(true); emit(); scheduleSave();
}
