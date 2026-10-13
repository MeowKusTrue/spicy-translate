// Autosave: localStorage (per-track project + last session), audio blobs in IndexedDB; project file import/export.
import type { Mode, Project } from './core/index.ts';
import { plainW } from './core/index.ts';
import { S, emit, ls, status } from './state.ts';
import { buildPreview } from './preview.ts';
import { LIVE, pushLive } from './live.ts';
import { setLines, setMode } from './load.ts';

const norm = (x: unknown) => String(x || '').toLowerCase().replace(/\s+/g, ' ').trim();
export function trackKey() { const k = norm(S.meta.artist + ' - ' + S.meta.title); return k === '-' ? '' : k; }
let saveT: ReturnType<typeof setTimeout> | undefined;
export function scheduleSave() {
  if (LIVE.applying || !S.lines.length) return;
  S.save = { msg: '💾 сохраняю…', cls: 'warn' }; emit();
  clearTimeout(saveT); saveT = setTimeout(() => (window.requestIdleCallback || ((f: () => void) => f()))(saveProject, { timeout: 1500 }), 600);
}
export function saveProject() {
  if (!S.lines.length) return; clearTimeout(saveT);
  const k = trackKey(); let ok = true;
  if (k) ok = ls.set('proj:' + k, JSON.stringify({ lang: S.meta.lang, lines: S.lines.map(l => ({ text: l.text, tr: l.tr || '', sync: l.sync || null, agent: l.agent, bg: l.bg })) }));
  ok = ls.set('last', projectJSON()) && ok;
  S.save = ok ? { msg: '💾 сохранено ' + new Date().toLocaleTimeString().slice(0, 8), cls: 'ok' } : { msg: '💾 браузер не даёт сохранить — скачай проект', cls: 'warn' }; emit();
  pushLive();
}
export function restoreProject() {
  const k = trackKey(); if (!k) return false;
  let p; try { p = JSON.parse(ls.get('proj:' + k, 'null')!); } catch { return false; }
  if (!p || !p.lines || p.lines.length !== S.lines.length || !p.lines.every((x: { text: string }, i: number) => plainW(x.text) === plainW(S.lines[i].text))) return false;
  p.lines.forEach((x: { text: string; tr?: string; sync?: any }, i: number) => { S.lines[i].text = x.text; S.lines[i].tr = x.tr || ''; if (x.sync) S.lines[i].sync = x.sync; });
  if (p.lang) S.meta.lang = p.lang;
  buildPreview(); emit(); return p.lines.some((x: { tr?: string; sync?: unknown }) => x.tr || x.sync);
}

function idb() {
  return new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open('spicy-translate', 1); r.onupgradeneeded = () => r.result.createObjectStore('audio'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
export async function idbPut(k: string, blob: Blob | null) { if (!k || !blob || blob.size > 120e6) return; try { const db = await idb(); db.transaction('audio', 'readwrite').objectStore('audio').put(blob, k); } catch {} }
export async function idbGet(k: string): Promise<Blob | null> { if (!k) return null; try { const db = await idb(); return await new Promise(res => { const r = db.transaction('audio').objectStore('audio').get(k); r.onsuccess = () => res(r.result || null); r.onerror = () => res(null); }); } catch { return null; } }

export function projectJSON() {
  const p: Project = { v: 1, meta: { ...S.meta }, lines: S.lines.map(l => ({ t: l.t, end: l.end, text: l.text, tr: l.tr || '', sync: l.sync || null, agent: l.agent, bg: l.bg })) };
  return JSON.stringify(p, null, 1);
}
export function loadProject(txt: string, keepSel?: boolean) {
  const p = JSON.parse(txt); if (!p.lines) throw new Error('это не проект Spicy Translate');
  const m = p.meta || {}, sel = keepSel && S.sel ? { ...S.sel } : null;
  S.meta.title = m.title || ''; S.meta.artist = m.artist || ''; if (m.lang) S.meta.lang = m.lang;
  if (m.mode && m.mode !== S.meta.mode) setMode(m.mode as Mode);
  setLines(p.lines.map((l: any) => ({ t: l.t, end: l.end, text: l.text, tr: l.tr || '', sync: l.sync || undefined, agent: l.agent, bg: l.bg })), 0);
  if (sel && sel.i < S.lines.length) S.sel = sel;
  buildPreview(); status('st1', `Проект загружен: строк ${S.lines.length}`, 'ok');
}
export function saveText(name: string, text: string, mime?: string) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: mime || 'text/plain' })); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  status('st2', window.self !== window.top ? 'Если файл не появился — страница во встроенном просмотре: открой в обычном браузере.' : 'Файл скачан.', window.self !== window.top ? 'err' : 'ok');
}
