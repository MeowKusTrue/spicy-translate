// Singers per line (duets): v1 left, v2 right (opposite-aligned in Spicy Lyrics), v1000 together.
import type { Agent } from './core/index.ts';
import { S, emit } from './state.ts';
import { buildPreview } from './preview.ts';
import { scheduleSave } from './persist.ts';

export const AGENTS: { id: Agent; label: string; title: string }[] = [
  { id: 'v1', label: '1', title: 'Исполнитель 1 — строка слева' },
  { id: 'v2', label: '2', title: 'Исполнитель 2 — строка справа' },
  { id: 'v1000', label: '1+2', title: 'Вместе' },
];
export const agentOf = (i: number) => AGENTS.find(a => a.id === (S.lines[i]?.agent || 'v1'))!;
export function cycleAgent(i: number) {
  const l = S.lines[i]; if (!l) return;
  const next = AGENTS[(AGENTS.indexOf(agentOf(i)) + 1) % AGENTS.length].id;
  if (next === 'v1') delete l.agent; else l.agent = next;
  buildPreview(true); emit(); scheduleSave();
}
