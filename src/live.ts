// Live link to the local server / MCP: GET/PUT /api/project, poll every 1.5 s.
import { S, emit, toast } from './state.ts';
import { isApp } from './desktop.ts';
import { W } from './waveform/wave.ts';
import { idbGet, loadProject, projectJSON, snapshot, trackKey } from './persist.ts';
import { loadAudioFile } from './load.ts';
import { snap } from './sync.ts';

// in the desktop app the server is the app's own (or a running MCP server it found): say «сервер», not «MCP»
const OK = isApp ? 'сервер ✓' : 'MCP: связь ✓', BAD = isApp ? 'нет связи с сервером' : 'MCP: нет связи';
export const LIVE = { on: false, rev: -1, applying: false };
function livePill(ok: boolean, msg: string) { S.live = { msg, cls: ok ? 'ok' : 'warn' }; emit(); }
export function pushLive() {
  if (!LIVE.on || LIVE.applying) return;
  fetch('/api/project', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: projectJSON() }).then(r => r.json()).then(j => { LIVE.rev = j.rev; livePill(true, OK); }).catch(() => livePill(false, BAD));
}
type Proj = { meta?: { title?: string; artist?: string }; lines?: { text: string }[] } | null;
const name = (p: Proj) => [p?.meta?.artist, p?.meta?.title].filter(Boolean).join(' — ') || 'без названия';
/** a server project that is a different song than the one open here (same song with edits from the agent is fine) */
function otherSong(p: Proj) {
  if (!S.lines.length || !p?.lines?.length) return false;
  const a = (S.meta.artist + ' ' + S.meta.title).toLowerCase().trim(), b = ((p.meta?.artist || '') + ' ' + (p.meta?.title || '')).toLowerCase().trim();
  return a !== b || p.lines.length !== S.lines.length && !p.lines.some((l, i) => l.text === S.lines[i]?.text);
}
function applyLive(j: { project: unknown }) {
  snapshot('перед обновлением с сервера'); // both sides are kept: ours here, the server's after it lands
  LIVE.applying = true;
  snap(); // Ctrl+Z takes the agent's edit back
  try { loadProject(JSON.stringify(j.project), true); idbGet(trackKey()).then(b => { if (b && !S.hasAudio) loadAudioFile(b, true); }); } finally { setTimeout(() => { LIVE.applying = false; }, 300); }
}
async function livePoll() {
  if (W.drag || W.pend) return;
  try {
    const j = await (await fetch('/api/project')).json(); LIVE.on = true;
    if (j.rev !== LIVE.rev) { const fromAgent = j.by === 'mcp' && LIVE.rev >= 0; LIVE.rev = j.rev; if (fromAgent || (!S.lines.length && j.project && j.project.lines)) {
        if (otherSong(j.project) && !confirm(`Агент (MCP) открыл другой проект: «${name(j.project)}». Заменить им «${name({ meta: S.meta })}»? (текущий сохранится в снимках)`)) { snapshot('проект агента (не открыт)', JSON.stringify(j.project)); return; }
        applyLive(j); toast('Агент (MCP) обновил проект. Отменить его правку — Ctrl+Z.', 'ok');
      } }
    livePill(true, OK);
  } catch { if (LIVE.on) livePill(false, BAD); }
}
export async function liveInit() {
  if (!/^https?:$/.test(location.protocol)) return;
  addEventListener('pagehide', () => navigator.sendBeacon?.('/api/bye')); // a server started by the launcher stops when the last tab closes
  try {
    const r = await fetch('/api/project'); if (!r.ok) return; const j = await r.json(); LIVE.on = true; LIVE.rev = j.rev;
    if (j.project && j.project.lines && j.project.lines.length) {
      if (otherSong(j.project) && !confirm(`На сервере (MCP) открыт другой проект: «${name(j.project)}».\nЗдесь сейчас: «${name({ meta: S.meta })}».\n\nOK — открыть проект с сервера (твой сохранится в снимках).\nОтмена — оставить свой и отправить его на сервер (серверный сохранится в снимках).`)) {
        snapshot('проект с сервера (не открыт)', JSON.stringify(j.project)); pushLive();
      } else applyLive(j);
    } else if (S.lines.length) pushLive();
    livePill(true, OK); setInterval(livePoll, 1500);
    checkServer();
  } catch {}
}

/** the editor is newer than the running server (e.g. the MCP server started before an update): say so and how to fix */
export const SERVER_API = 7; // Genius (text, songwriters) goes through the server
export async function checkServer() {
  const api = await fetch('/api/version').then(r => r.ok ? r.json() : {}).then((j: { api?: number }) => +(j.api || 0)).catch(() => 0);
  if (api >= SERVER_API) return true;
  S.live = { msg: 'сервер устарел ⟳', cls: 'warn' }; emit();
  toast('Сервер на этом порту запущен из старой версии (часто это MCP-сервер Claude, запущенный до обновления): Genius, авто-тайминг и папки не заработают. Перезапусти его: в Claude Code /mcp → spicy-translate → Reconnect, или закрой Claude Code и открой редактор снова.', 'err');
  return false;
}
