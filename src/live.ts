// Live link to the local server / MCP: GET/PUT /api/project, poll every 1.5 s.
import { S, emit, toast } from './state.ts';
import { W } from './waveform/wave.ts';
import { idbGet, loadProject, projectJSON, trackKey } from './persist.ts';
import { loadAudioFile } from './load.ts';

export const LIVE = { on: false, rev: -1, applying: false };
function livePill(ok: boolean, msg: string) { S.live = { msg, cls: ok ? 'ok' : 'warn' }; emit(); }
export function pushLive() {
  if (!LIVE.on || LIVE.applying) return;
  fetch('/api/project', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: projectJSON() }).then(r => r.json()).then(j => { LIVE.rev = j.rev; livePill(true, 'MCP: связь ✓'); }).catch(() => livePill(false, 'MCP: нет связи'));
}
function applyLive(j: { project: unknown }) {
  LIVE.applying = true;
  try { loadProject(JSON.stringify(j.project), true); idbGet(trackKey()).then(b => { if (b && !S.hasAudio) loadAudioFile(b, true); }); } finally { setTimeout(() => { LIVE.applying = false; }, 300); }
}
async function livePoll() {
  if (W.drag || W.pend) return;
  try {
    const j = await (await fetch('/api/project')).json(); LIVE.on = true;
    if (j.rev !== LIVE.rev) { const fromAgent = j.by === 'mcp' && LIVE.rev >= 0; LIVE.rev = j.rev; if (fromAgent || (!S.lines.length && j.project && j.project.lines)) { applyLive(j); toast('Агент (MCP) обновил проект.', 'ok'); } }
    livePill(true, 'MCP: связь ✓');
  } catch { if (LIVE.on) livePill(false, 'MCP: нет связи'); }
}
export async function liveInit() {
  if (!/^https?:$/.test(location.protocol)) return;
  try {
    const r = await fetch('/api/project'); if (!r.ok) return; const j = await r.json(); LIVE.on = true; LIVE.rev = j.rev;
    if (j.project && j.project.lines && j.project.lines.length) applyLive(j); else if (S.lines.length) pushLive();
    livePill(true, 'MCP: связь ✓'); setInterval(livePoll, 1500);
  } catch {}
}
