// Autosave: localStorage (per-track project + last session), audio blobs in IndexedDB; project file import/export.
import type { Mode, Project } from './core/index.ts';
import { plainW } from './core/index.ts';
import { S, emit, ls, status } from './state.ts';
import { buildPreview } from './preview.ts';
import { LIVE, pushLive } from './live.ts';
import { setLines, setMode } from './load.ts';
import { audio, pause } from './audio.ts';
import { clearProjectWave } from './waveform/wave.ts';
import { detachFolder } from './folder.ts';
import { session } from './projectSession.ts';
import { PREVIEW_EDIT } from './previewEdit.ts';
import { setPage } from './hotkeys.ts';
function transitionBlocked() { return S.busyAuto || S.busyLlm || S.align || S.setup || S.editDraft || PREVIEW_EDIT.active; }

export const explicitProject = () => ls.get('project:explicit') === '1';
function detachProject() {
  session.generation++; clearTimeout(saveT); pause();
  audio.onloadedmetadata = null; audio.removeAttribute('src'); audio.load();
  if (S.audioUrl) URL.revokeObjectURL(S.audioUrl);
  S.audioUrl = ''; S.audioBlob = null; S.hasAudio = false; S.duration = S.srcDur = S.vt = 0;
  S.sel = null; S.picked.clear(); S.pickAnchor = -1; S.undo = []; S.redo = [];
  S.editDraft = null; S.syllableReview = null; S.full = null; S.find = null; S.qa = null; S.out = null;
  S.q = ''; S.manual = ''; S.results = []; S.genius = null; S.spell = null; S.backingReview = null;
  S.cover = ''; S.loop = false; S.waveVoice = false; S.typing = false;
  document.body.classList.remove('text-drafting'); clearProjectWave(); detachFolder();
}
/** A destructive transition must wait for the IndexedDB transaction, not a swallowed snapshot error. */
export async function durableBackup(reason: string) {
  if (!S.lines.length) return;
  const json = projectJSON();
  const rec: Snap = { at: Date.now(), key: trackKey(), title: S.meta.title, artist: S.meta.artist, n: S.lines.length, tr: S.lines.filter(l => l.tr?.trim()).length, reason, json };
  const db = await idb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('snaps', 'readwrite');
    tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error || new Error('Backup transaction failed'));
    tx.objectStore('snaps').add(rec);
  });
}
export async function newEmptyProject() {
  if (transitionBlocked()) { status('st1', 'Дождись завершения текущей операции перед сменой проекта.', 'err'); return false; }
  try {
    const before = projectJSON(), generation = session.generation;
    await durableBackup('перед новым пустым проектом');
    if (generation !== session.generation || projectJSON() !== before || transitionBlocked()) throw new Error('Проект изменился во время сохранения — повтори попытку');
    const empty = JSON.stringify({ v: 1, meta: { title: '', artist: '', lang: 'ru', mode: 'original', md: [] }, lines: [] });
    // Persist before changing the visible project; failure leaves the current editor untouched.
    if (!ls.set('project:explicit', '1') || !ls.set('last', empty)) throw new Error('Браузер не сохранил пустой проект');
    loadProject(empty); saveProject(); setPage('track'); emit(); return true;
  } catch (e) { status('st1', 'Новый проект не создан: ' + (e as Error).message, 'err'); return false; }
}

const norm = (x: unknown) => String(x || '').toLowerCase().replace(/\s+/g, ' ').trim();
export function trackKey() { const k = norm(S.meta.artist + ' - ' + S.meta.title); return k === '-' ? '' : k; }
let saveT: ReturnType<typeof setTimeout> | undefined;
export function scheduleSave() {
  if (LIVE.applying || (!S.lines.length && !explicitProject())) return;
  S.save = { msg: '💾 сохраняю…', cls: 'warn' }; emit();
  clearTimeout(saveT); saveT = setTimeout(() => (window.requestIdleCallback || ((f: () => void) => f()))(saveProject, { timeout: 1500 }), 600);
}
export function saveProject() {
  if (!S.lines.length && !explicitProject()) return; clearTimeout(saveT);
  const k = trackKey(); let ok = true;
  if (k) ok = ls.set('proj:' + k, JSON.stringify({ lang: S.meta.lang, md: S.meta.md, lines: S.lines.map(l => ({ t: l.t, end: l.end, text: l.text, tr: l.tr || '', sync: l.sync || null, agent: l.agent, bg: l.bg, sec: l.sec, approved: l.approved })) }));
  ok = ls.set('last', projectJSON()) && ok;
  S.save = ok ? { msg: '💾 сохранено ' + new Date().toLocaleTimeString().slice(0, 8), cls: 'ok' } : { msg: '💾 браузер не даёт сохранить — скачай проект', cls: 'warn' }; emit();
  pushLive();
}
export function restoreProject() {
  const k = trackKey(); if (!k) return false;
  let p; try { p = JSON.parse(ls.get('proj:' + k, 'null')!); } catch { return false; }
  if (p && p.lines && p.lines.length && p.lines.every((x: { t?: number }) => typeof x.t === 'number')) {
    // saved with timings: take it whole (keeps added / removed / moved lines, background-only lines, singers)
    S.lines = p.lines.map((x: any) => ({ t: x.t, end: x.end, text: x.text, tr: x.tr || '', ...(x.sync ? { sync: x.sync } : {}), ...(x.agent ? { agent: x.agent } : {}), ...(x.bg ? { bg: x.bg } : {}), ...(x.sec ? { sec: x.sec } : {}), ...(x.approved ? { approved: x.approved } : {}) }));
    if (p.lang) S.meta.lang = p.lang;
    if (p.md) S.meta.md = p.md;
    S.sel = S.lines.length ? { i: 0, k: 0 } : null; buildPreview(); emit(); return true;
  }
  if (!p || !p.lines || p.lines.length !== S.lines.length || !p.lines.every((x: { text: string }, i: number) => plainW(x.text) === plainW(S.lines[i].text))) return false;
  p.lines.forEach((x: { text: string; tr?: string; sync?: any }, i: number) => { S.lines[i].text = x.text; S.lines[i].tr = x.tr || ''; if (x.sync) S.lines[i].sync = x.sync; });
  if (p.lang) S.meta.lang = p.lang;
  if (p.md) S.meta.md = p.md;
  buildPreview(); emit(); return p.lines.some((x: { tr?: string; sync?: unknown }) => x.tr || x.sync);
}

/**
 * One connection per tab. It never waits forever: another editor tab holding the database (Firefox just waits on
 * a blocked open) used to freeze whatever awaited it — auto-timing hung at «запуск…» on its snapshot. Now it gives up
 * after 3 s (callers carry on without the snapshot), and this tab lets go when another one needs to upgrade.
 */
let dbP: Promise<IDBDatabase> | null = null;
function idb() {
  if (dbP) return dbP;
  dbP = new Promise<IDBDatabase>((res, rej) => {
    const t = setTimeout(() => rej(new Error('IndexedDB не открылась за 3 с — другая вкладка редактора держит её?')), 3000);
    let r: IDBOpenDBRequest;
    try { r = indexedDB.open('spicy-translate', 2); } catch (e) { clearTimeout(t); return rej(e); }
    r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio'); if (!db.objectStoreNames.contains('snaps')) db.createObjectStore('snaps', { keyPath: 'id', autoIncrement: true }); };
    r.onblocked = () => { clearTimeout(t); rej(new Error('IndexedDB занята другой вкладкой редактора')); };
    r.onsuccess = () => { clearTimeout(t); const db = r.result; db.onversionchange = () => { db.close(); dbP = null; }; db.onclose = () => { dbP = null; }; res(db); };
    r.onerror = () => { clearTimeout(t); rej(r.error); };
  });
  dbP.catch(() => { dbP = null; }); // try again next time
  return dbP;
}

/* ---------- snapshots: the project as it was, kept in IndexedDB (auto every 3 min, before anything replaces it) ---------- */
export interface Snap { id?: number; at: number; key: string; title: string; artist: string; n: number; tr: number; reason: string; json: string }
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
    // History is never pruned implicitly.
  } catch {}
}
export async function listSnaps(): Promise<Snap[]> {
  try { const db = await idb(); return await new Promise(res => { const q = db.transaction('snaps').objectStore('snaps').getAll(); q.onsuccess = () => res((q.result as Snap[]).sort((a, b) => b.at - a.at)); q.onerror = () => res([]); }); } catch { return []; }
}
/** open a snapshot (the current project is snapshotted first, so this can be undone the same way) */
export async function restoreSnap(s: Snap) {
  if (transitionBlocked()) { status('st1', 'Заверши текущую операцию или правку перед открытием проекта.', 'err'); return; }
  const before = projectJSON(), generation = session.generation;
  try {
    await durableBackup('перед возвратом снимка');
    if (generation !== session.generation || projectJSON() !== before || transitionBlocked()) throw new Error('Проект изменился во время сохранения — повтори попытку');
  }
  catch (e) { status('st1', 'Не удалось сохранить текущий проект: ' + (e as Error).message, 'err'); return; }
  ls.set('project:explicit', '1');
  loadProject(s.json); saveProject();
  status('st1', `Вернул снимок «${s.title || 'без названия'}» от ${new Date(s.at).toLocaleString()}. Предыдущее состояние тоже в снимках.`, 'ok');
}
export async function idbPut(k: string, blob: Blob | null) { if (!k || !blob || blob.size > 120e6) return; try { const db = await idb(); db.transaction('audio', 'readwrite').objectStore('audio').put(blob, k); } catch {} }
export async function idbDel(k: string) { try { const db = await idb(); db.transaction('audio', 'readwrite').objectStore('audio').delete(k); } catch {} }
export async function idbGet(k: string): Promise<Blob | null> { if (!k) return null; try { const db = await idb(); return await new Promise(res => { const r = db.transaction('audio').objectStore('audio').get(k); r.onsuccess = () => res(r.result || null); r.onerror = () => res(null); }); } catch { return null; } }

export function projectJSON() {
  const p: Project = { v: 1, meta: { ...S.meta }, lines: S.lines.map(l => ({ t: l.t, end: l.end, text: l.text, tr: l.tr || '', sync: l.sync || null, agent: l.agent, bg: l.bg, sec: l.sec, approved: l.approved })) };
  return JSON.stringify(p, null, 1);
}
/** keep = the same song updated by the agent: undo, layer, selection and playhead stay */
export function loadProject(txt: string, keep?: boolean) {
  const p = JSON.parse(txt); if (!p.lines) throw new Error('это не проект Spicy Translate');
  if (!Array.isArray(p.lines)) throw new Error('Некорректный проект');
  const lines = p.lines.map((l: any) => {
    if (!l || typeof l.text !== 'string' || !Number.isFinite(l.t) || !Number.isFinite(l.end)) throw new Error('Некорректная строка проекта');
    return { t: l.t, end: l.end, text: l.text, tr: l.tr || '', sync: l.sync || undefined, agent: l.agent, bg: l.bg, ...(l.sec ? { sec: l.sec } : {}), ...(l.approved ? { approved: l.approved } : {}) };
  });
  if (!keep) { snapshot('перед загрузкой проекта'); detachProject(); }
  const m = p.meta || {};
  S.meta.title = m.title || ''; S.meta.artist = m.artist || ''; if (m.lang) S.meta.lang = m.lang;
  S.meta.md = m.md || [];
  if (m.mode && m.mode !== S.meta.mode) setMode(m.mode as Mode, false);
  setLines(lines, 0, keep, true);
  buildPreview(); status('st1', `Проект загружен: строк ${S.lines.length}`, 'ok');
  if (!keep) scheduleSave();
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
