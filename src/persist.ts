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
  if (k) ok = ls.set('proj:' + k, JSON.stringify({ lang: S.meta.lang, lines: S.lines.map(l => ({ t: l.t, end: l.end, text: l.text, tr: l.tr || '', sync: l.sync || null, agent: l.agent, bg: l.bg, sec: l.sec })) }));
  ok = ls.set('last', projectJSON()) && ok;
  S.save = ok ? { msg: '💾 сохранено ' + new Date().toLocaleTimeString().slice(0, 8), cls: 'ok' } : { msg: '💾 браузер не даёт сохранить — скачай проект', cls: 'warn' }; emit();
  pushLive();
}
export function restoreProject() {
  const k = trackKey(); if (!k) return false;
  let p; try { p = JSON.parse(ls.get('proj:' + k, 'null')!); } catch { return false; }
  if (p && p.lines && p.lines.length && p.lines.every((x: { t?: number }) => typeof x.t === 'number')) {
    // saved with timings: take it whole (keeps added / removed / moved lines, background-only lines, singers)
    S.lines = p.lines.map((x: any) => ({ t: x.t, end: x.end, text: x.text, tr: x.tr || '', ...(x.sync ? { sync: x.sync } : {}), ...(x.agent ? { agent: x.agent } : {}), ...(x.bg ? { bg: x.bg } : {}), ...(x.sec ? { sec: x.sec } : {}) }));
    if (p.lang) S.meta.lang = p.lang;
    S.sel = S.lines.length ? { i: 0, k: 0 } : null; buildPreview(); emit(); return true;
  }
  if (!p || !p.lines || p.lines.length !== S.lines.length || !p.lines.every((x: { text: string }, i: number) => plainW(x.text) === plainW(S.lines[i].text))) return false;
  p.lines.forEach((x: { text: string; tr?: string; sync?: any }, i: number) => { S.lines[i].text = x.text; S.lines[i].tr = x.tr || ''; if (x.sync) S.lines[i].sync = x.sync; });
  if (p.lang) S.meta.lang = p.lang;
  buildPreview(); emit(); return p.lines.some((x: { tr?: string; sync?: unknown }) => x.tr || x.sync);
}

function idb() {
  return new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open('spicy-translate', 2);
    r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio'); if (!db.objectStoreNames.contains('snaps')) db.createObjectStore('snaps', { keyPath: 'id', autoIncrement: true }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}

/* ---------- snapshots: the project as it was, kept in IndexedDB (auto every 3 min, before anything replaces it) ---------- */
export interface Snap { id?: number; at: number; key: string; title: string; artist: string; n: number; tr: number; reason: string; json: string }
const SNAP_MAX = 80;
let lastSnap = '';
/** save the current project (or a given project JSON); identical consecutive snapshots are skipped */
export async function snapshot(reason: string, json?: string) {
  const body = json ?? (S.lines.length ? projectJSON() : ''); if (!body || body === lastSnap) return;
  lastSnap = body;
  try {
    const p = JSON.parse(body), lines: { tr?: string }[] = p.lines || []; if (!lines.length) return;
    const rec: Snap = { at: Date.now(), key: norm((p.meta?.artist || '') + ' - ' + (p.meta?.title || '')), title: p.meta?.title || '', artist: p.meta?.artist || '', n: lines.length, tr: lines.filter(l => l.tr && l.tr.trim()).length, reason, json: body };
    const db = await idb(), st = db.transaction('snaps', 'readwrite').objectStore('snaps');
    st.add(rec);
    const keys: IDBValidKey[] = await new Promise(r => { const q = st.getAllKeys(); q.onsuccess = () => r(q.result); q.onerror = () => r([]); });
    keys.slice(0, Math.max(0, keys.length - SNAP_MAX)).forEach(k => st.delete(k));
  } catch {}
}
export async function listSnaps(): Promise<Snap[]> {
  try { const db = await idb(); return await new Promise(res => { const q = db.transaction('snaps').objectStore('snaps').getAll(); q.onsuccess = () => res((q.result as Snap[]).sort((a, b) => b.at - a.at)); q.onerror = () => res([]); }); } catch { return []; }
}
/** open a snapshot (the current project is snapshotted first, so this can be undone the same way) */
export async function restoreSnap(s: Snap) {
  await snapshot('перед возвратом снимка');
  loadProject(s.json); scheduleSave();
  status('st1', `Вернул снимок «${s.title || 'без названия'}» от ${new Date(s.at).toLocaleString()}. Предыдущее состояние тоже в снимках.`, 'ok');
}
export async function idbPut(k: string, blob: Blob | null) { if (!k || !blob || blob.size > 120e6) return; try { const db = await idb(); db.transaction('audio', 'readwrite').objectStore('audio').put(blob, k); } catch {} }
export async function idbDel(k: string) { try { const db = await idb(); db.transaction('audio', 'readwrite').objectStore('audio').delete(k); } catch {} }
export async function idbGet(k: string): Promise<Blob | null> { if (!k) return null; try { const db = await idb(); return await new Promise(res => { const r = db.transaction('audio').objectStore('audio').get(k); r.onsuccess = () => res(r.result || null); r.onerror = () => res(null); }); } catch { return null; } }

export function projectJSON() {
  const p: Project = { v: 1, meta: { ...S.meta }, lines: S.lines.map(l => ({ t: l.t, end: l.end, text: l.text, tr: l.tr || '', sync: l.sync || null, agent: l.agent, bg: l.bg, sec: l.sec })) };
  return JSON.stringify(p, null, 1);
}
export function loadProject(txt: string, keepSel?: boolean) {
  const p = JSON.parse(txt); if (!p.lines) throw new Error('это не проект Spicy Translate');
  const m = p.meta || {}, sel = keepSel && S.sel ? { ...S.sel } : null;
  S.meta.title = m.title || ''; S.meta.artist = m.artist || ''; if (m.lang) S.meta.lang = m.lang;
  if (m.mode && m.mode !== S.meta.mode) setMode(m.mode as Mode);
  setLines(p.lines.map((l: any) => ({ t: l.t, end: l.end, text: l.text, tr: l.tr || '', sync: l.sync || undefined, agent: l.agent, bg: l.bg, ...(l.sec ? { sec: l.sec } : {}) })), 0);
  if (sel && sel.i < S.lines.length) S.sel = sel;
  buildPreview(); status('st1', `Проект загружен: строк ${S.lines.length}`, 'ok');
}
type Picker = (o: object) => Promise<{ createWritable(): Promise<{ write(d: string): Promise<void>; close(): Promise<void> }> }>;
/**
 * Save a file asking where (app: the Windows «Save as» dialog; Chrome / Edge: the browser's own),
 * else the usual download. Resolves false when the user cancelled.
 */
export async function saveText(name: string, text: string, mime?: string) {
  const ext = name.slice(name.lastIndexOf('.')), invoke = (window as unknown as { __TAURI__?: { core?: { invoke(c: string, a: object): Promise<string | null> } } }).__TAURI__?.core?.invoke;
  try {
    if (invoke) {
      const p = await invoke('save_file', { name, text });
      status('st2', p ? 'Сохранено: ' + p : 'Сохранение отменено.', p ? 'ok' : ''); return !!p;
    }
    const pick = (window as unknown as { showSaveFilePicker?: Picker }).showSaveFilePicker;
    if (pick && window.self === window.top) {
      const h = await pick({ suggestedName: name, id: 'spicy-export', types: [{ description: ext.slice(1).toUpperCase(), accept: { [mime || 'text/plain']: [ext] } }] });
      const w = await h.createWritable(); await w.write(text); await w.close();
      status('st2', 'Сохранено: ' + name, 'ok'); return true;
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') { status('st2', 'Сохранение отменено.'); return false; }
    if (invoke) { status('st2', 'Не вышло сохранить: ' + ((e as Error).message || e), 'err'); return false; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: mime || 'text/plain' })); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  status('st2', window.self !== window.top ? 'Если файл не появился — страница во встроенном просмотре: открой в обычном браузере.' : 'Файл скачан.', window.self !== window.top ? 'err' : 'ok');
  return true;
}
