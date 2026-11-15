import { AGENTS, selectedAgentWords, setAgent, setWordAgent } from '../agents.ts';
import { S } from '../state.ts';
import { PREVIEW_EDIT, setPreviewAgent } from '../previewEdit.ts';
import { useState } from 'react';

export function SelectionAgentPicker() {
  const [scope,setScope]=useState<'lines'|'words'>('lines');
  const words=selectedAgentWords();
  return <div className="agent-picker" role="group" aria-label="Исполнитель выделения">
    <select aria-label="Область назначения исполнителя" value={words.length?scope:'lines'} disabled={!!S.editDraft} onChange={e=>setScope(e.target.value as 'lines'|'words')}>
      <option value="lines">Для строк целиком</option><option value="words" disabled={!words.length}>Для выделенных слов</option>
    </select><span className="tseg">{AGENTS.map(a=><button key={a.id} type="button" disabled={!!S.editDraft} aria-label={a.id==='v1000'?'Вместе 1+2':'Исполнитель '+a.label}
      title={scope==='words'?'Выделить слова в самостоятельные фразы; перевод — по таймингам, бэк отдельно':a.title}
      onClick={()=>scope==='words'&&words.length?setWordAgent(a.id,words):setAgent(a.id)}>{a.label}</button>)}</span>
  </div>;
}

export function DraftAgentPicker() {
  return <div className="agent-picker" role="group" aria-label="Исполнитель строки в правке"><small>Исполнитель строки</small><span className="tseg">{AGENTS.map(a => <button key={a.id} type="button"
    aria-label={a.id === 'v1000' ? 'Вместе 1+2' : 'Исполнитель ' + a.label} aria-pressed={PREVIEW_EDIT.agent === a.id}
    onClick={() => setPreviewAgent(a.id)}>{a.label}</button>)}</span></div>;
}

export function AgentPicker({ ids, label = 'Исполнитель' }: { ids: number[]; label?: string }) {
  return <div className="agent-picker" role="group" aria-label={label}>
    <small>{label}</small><span className="tseg">{AGENTS.map(a => <button key={a.id} type="button" disabled={!!S.editDraft || !ids.length}
      aria-label={a.id === 'v1000' ? 'Вместе 1+2' : 'Исполнитель ' + a.label}
      aria-pressed={ids.length > 0 && ids.every(i => (S.lines[i]?.agent || 'v1') === a.id)} title={a.title}
      onClick={e => { e.stopPropagation(); setAgent(a.id, ids); }}>{a.label}</button>)}</span>
  </div>;
}
