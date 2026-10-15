// The project folder: TTML, project (.spicy.json) and the audio side by side. Ctrl+S writes there without asking.
// App: the Windows folder dialog + app commands (lyrics / project / audio files only). Chrome / Edge: the browser's
// folder picker, its handle kept in IndexedDB. A folder is linked per track (by artist - title).
import { buildTTML } from './core/index.ts';
import { S, emit, status } from './state.ts';
import { idbDel, idbGet, idbPut, loadProject, projectJSON, trackKey } from './persist.ts';
import { opts } from './exporting.ts';

type Invoke = (c: string, a?: unknown, o?: { headers: Record<string, string> }) => Promise<unknown>;
const invoke = (window as unknown as { __TAURI__?: { core?: { invoke: Invoke } } }).__TAURI__?.core?.invoke;
type DirHandle = { name: string; queryPermission(o: object): Promise<string>; requestPermission(o: object): Promise<string>; entries(): AsyncIterable<[string, { kind: string; getFile(): Promise<File> }]>; getFileHandle(n: string, o?: object): Promise<{ getFile(): Promise<File>; createWritable(): Promise<{ write(d: Blob | string): Promise<void>; close(): Promise<void> }> }> };
const picker = (window as unknown as { showDirectoryPicker?: (o: object) => Promise<DirHandle> }).showDirectoryPicker;
/** the folder in use: a path in the app, a directory handle in the browser */
type Folder = { label: string; list(): Promise<string[]>; text(n: string): Promise<string>; blob(n: string): Promise<Blob>; write(n: string, d: string | Blob): Promise<void> };
let cur: Folder | null = null, curKey = '', curDir = '', curH: DirHandle | null = null;
export const folderSupported = () => !!invoke || (!!picker && window.self === window.top);

const hex = (s: string) => [...new TextEncoder().encode(s)].map(b => b.toString(16).padStart(2, '0')).join('');
function appFolder(dir: string): Folder {
  return {
    label: dir,
    list: () => invoke!('list_dir', { dir }) as Promise<string[]>,
    text: n => invoke!('read_text', { dir, name: n }) as Promise<string>,
    blob: async n => new Blob([await invoke!('read_bytes', { dir, name: n }) as ArrayBuffer]),
    write: async (n, d) => { if (typeof d === 'string') await invoke!('write_text', { dir, name: n, text: d }); else await invoke!('write_bytes', new Uint8Array(await d.arrayBuffer()), { headers: { 'x-dir': hex(dir), 'x-name': hex(n) } }); },
  };
}
function webFolder(h: DirHandle): Folder {
  return {
    label: h.name,
    list: async () => { const out: string[] = []; for await (const [n, e] of h.entries()) if (e.kind === 'file') out.push(n); return out; },
    text: async n => (await (await h.getFileHandle(n)).getFile()).text(),
    blob: async n => (await h.getFileHandle(n)).getFile(),
    write: async (n, d) => { const w = await (await h.getFileHandle(n, { create: true })).createWritable(); await w.write(d); await w.close(); },
  };
}
/* links per track: app paths in localStorage, browser handles in IndexedDB */
const links = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem('folders') || '{}'); } catch { return {}; } };
async function remember(f: { dir?: string; h?: DirHandle }) {
  const k = trackKey(); if (!k) return;
  if (f.dir) { const l = links(); l[k] = f.dir; try { localStorage.setItem('folders', JSON.stringify(l)); } catch {} }
  if (f.h) await idbPut('dir:' + k, f.h as unknown as Blob);
}
const use = (f: Folder | null, saved = 0) => { cur = f; curKey = trackKey(); S.folder = f ? { label: f.label, saved } : null; emit(); };

/** the folder linked to the current track (after a track change); the browser asks for access again on first use */
export async function restoreFolder() {
  const k = trackKey(); if (k === curKey && cur) return;
  if (invoke) { const d = links()[k]; curDir = d || ''; return use(d ? appFolder(d) : null); }
  const h = k ? await idbGet('dir:' + k) as unknown as DirHandle | null : null;
  if (trackKey() !== k || (curKey === k && cur)) return; // a newer link won meanwhile
  curH = h && typeof h.getFileHandle === 'function' ? h : null; use(curH ? webFolder(curH) : null);
}
/** choose (or change) the folder of this project */
export async function pickFolder() {
  try {
    if (invoke) { const d = await invoke('pick_folder') as string | null; if (!d) return false; curDir = d; await remember({ dir: d }); use(appFolder(d)); return true; }
    if (!picker) return false;
    const h = await picker({ id: 'spicy-project', mode: 'readwrite' }); curH = h; await remember({ h }); use(webFolder(h)); return true;
  } catch (e) { if ((e as Error).name !== 'AbortError') status('st2', 'Папку выбрать не вышло: ' + (e as Error).message, 'err'); return false; }
}
export function unlinkFolder() {
  const k = trackKey(), l = links(); delete l[k]; try { localStorage.setItem('folders', JSON.stringify(l)); } catch {}
  idbDel('dir:' + k); use(null); status('st2', 'Папка отвязана от трека (файлы в ней остались).', 'ok');
}
async function access() { // the browser forgets the permission between sessions: ask again (Ctrl+S is a user gesture)
  if (invoke || !cur) return true;
  const h = curH; if (!h) return true;
  return (await h.queryPermission({ mode: 'readwrite' })) === 'granted' || (await h.requestPermission({ mode: 'readwrite' })) === 'granted';
}
const AUDIO_EXT: Record<string, string> = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/flac': 'flac', 'audio/x-flac': 'flac', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'audio/opus': 'opus', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac' };
const base = () => ((S.meta.artist + ' - ' + S.meta.title).replace(/[\\/:*?"<>|]/g, '').trim() || 'lyrics') + ` (${S.meta.lang})`;

/** Ctrl+S: TTML + project into the folder (asks for one the first time), the audio once */
export async function saveToFolder() {
  if (!S.lines.length) return status('st2', 'Нечего сохранять — загрузи текст.', 'err');
  if (!cur && !(await pickFolder())) return;
  if (!(await access())) return status('st2', 'Нет доступа к папке — разреши запись или выбери её заново.', 'err');
  const f = cur!, b = base();
  try {
    const have = new Set(await f.list());
    await f.write(b + '.ttml', buildTTML(opts()));
    await f.write(b + '.spicy.json', projectJSON());
    let audio = '';
    if (S.audioBlob && ![...have].some(n => /\.(mp3|flac|wav|ogg|opus|m4a|aac)$/i.test(n))) { audio = b + '.' + (AUDIO_EXT[S.audioBlob.type] || 'mp3'); await f.write(audio, S.audioBlob); }
    use(f, Date.now());
    status('st2', `Сохранено в «${f.label}»: ${b}.ttml, проект${audio ? ', аудио' : ''}.`, 'ok');
  } catch (e) { status('st2', 'Не вышло сохранить в папку: ' + ((e as Error).message || e), 'err'); }
}
/** open a project folder: the project (or a TTML) and the audio found there */
export async function openProjectFolder() {
  if (!(await pickFolder())) return;
  const f = cur!, names = await f.list();
  const proj = names.find(n => /\.spicy\.json$/i.test(n)), ttml = names.find(n => /\.ttml$/i.test(n)), audio = names.find(n => /\.(mp3|flac|wav|ogg|opus|m4a|aac)$/i.test(n));
  if (!proj && !ttml) return status('st1', `В «${f.label}» нет проекта (.spicy.json) или .ttml — сохрани в неё проект (Ctrl+S).`, 'err');
  const { loadAudioFile, openLyricsFile } = await import('./load.ts');
  if (proj) loadProject(await f.text(proj));
  else await openLyricsFile(new File([await f.text(ttml!)], ttml!));
  await remember(invoke ? { dir: curDir } : { h: curH! }); // re-link under the loaded track's name
  use(f);
  if (audio) loadAudioFile(new File([await f.blob(audio)], audio, { type: 'audio/' + (audio.split('.').pop() === 'mp3' ? 'mpeg' : audio.split('.').pop()) }));
}
