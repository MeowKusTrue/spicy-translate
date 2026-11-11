// Content-addressed audio cache. Project JSON never contains audio or browser object URLs.
import { S, ls, toast, status } from './state.ts';
import { cacheVoiceAudio } from './audio.ts';
import { buildVoicePeaks, drawWave } from './waveform/wave.ts';
import { idbGet, idbPutAudioRecords, trackKey } from './persist.ts';
import { session } from './projectSession.ts';

const REFERENCE = 'audio:last';
const originalKey = (key: string) => 'content:original:' + key;
const voiceKey = (key: string) => 'content:voice:' + key;
const hashes = new WeakMap<Blob, Promise<string>>();
const resolvedHashes = new WeakMap<Blob, string>();
export function originalAudioKey(blob: Blob): Promise<string> {
  let key = hashes.get(blob);
  if (!key) {
    key = blob.arrayBuffer().then(bytes => crypto.subtle.digest('SHA-256', bytes))
      .then(bytes => { const hash = Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, '0')).join(''); resolvedHashes.set(blob, hash); return hash; });
    hashes.set(blob, key);
    key.catch(() => hashes.delete(blob));
  }
  return key;
}
export const lastOriginalReference = () => ls.get(REFERENCE);
export function clearLastOriginalReference(blockLegacy = false) {
  // A failed replacement must not revive a previous, same-titled legacy recording.
  return ls.set(REFERENCE, blockLegacy ? JSON.stringify({ key: null, project: trackKey() }) : '');
}
/** Metadata edits may rename a project without replacing its already-committed original. */
export function syncOriginalReference(): boolean {
  const hash = S.audioBlob && resolvedHashes.get(S.audioBlob);
  if (!hash) return true;
  try {
    const ref = JSON.parse(lastOriginalReference() || 'null');
    if (ref?.key === hash) return ls.set(REFERENCE, JSON.stringify({ key: hash, project: trackKey() }));
  } catch { /* Invalid/missing references must not resurrect previously cached recordings. */ }
  return true;
}
function currentOriginal(original: Blob, checkMetadata = true) {
  const generation = session.generation, title = S.meta.title, artist = S.meta.artist;
  return () => generation === session.generation && S.audioBlob === original && (!checkMetadata || S.meta.title === title && S.meta.artist === artist);
}
function cacheWarning() {
  const message = 'Аудио не сохранено в браузере (лимит 120 МБ на файл или недостаточно места). После перезагрузки может понадобиться выбрать файл снова.';
  toast(message, 'err'); status('st1', message, 'err');
}
/** Capture this reference before startup loadProject, which intentionally detaches any previous audio. */
export async function readLastOriginal(reference: string | null): Promise<Blob | null> {
  try {
    const ref: unknown = JSON.parse(reference || 'null');
    if (!ref || typeof ref !== 'object' || !('key' in ref) || !('project' in ref)
      || typeof ref.key !== 'string' || !/^[a-f0-9]{64}$/.test(ref.key) || ref.project !== trackKey()) return null;
    const blob = await idbGet(originalKey(ref.key));
    return blob && await originalAudioKey(blob) === ref.key ? blob : null;
  } catch { return null; }
}
export async function persistOriginalAudio(original: Blob): Promise<boolean> {
  const current = currentOriginal(original, false);
  try {
    if (original.size > 120e6) { if (current()) cacheWarning(); return false; }
    const key = await originalAudioKey(original);
    const ok = await idbPutAudioRecords([[originalKey(key), original]]);
    if (!ok) { if (current()) cacheWarning(); return false; }
    if (!current()) return false;
    const saved = ls.set(REFERENCE, JSON.stringify({ key, project: trackKey() }));
    if (!saved) cacheWarning();
    return saved;
  } catch { if (current()) cacheWarning(); return false; }
}
/** Both blobs commit atomically; true means the IndexedDB transaction actually completed. */
export async function persistVoiceAudio(original: Blob, vocal: Blob): Promise<boolean> {
  const current = currentOriginal(original);
  try {
    if (original.size > 120e6 || vocal.size > 120e6) { if (current()) cacheWarning(); return false; }
    const key = await originalAudioKey(original);
    const ok = await idbPutAudioRecords([[originalKey(key), original], [voiceKey(key), vocal]]);
    if (!ok) { if (current()) cacheWarning(); return false; }
    if (current() && !ls.set(REFERENCE, JSON.stringify({ key, project: trackKey() }))) { cacheWarning(); return false; }
    return true;
  } catch { if (current()) cacheWarning(); return false; }
}
/** Restoration never plays audio or changes the original/export/align input. */
export async function restoreCachedVoice(original: Blob): Promise<boolean> {
  const current = currentOriginal(original);
  try {
    const key = await originalAudioKey(original);
    if (!current()) return false;
    let vocal = await idbGet(voiceKey(key));
    if (!current()) return false;
    const fromServer = !vocal;
    if (!vocal) {
      const response = await fetch('/api/align/vocals?audioKey=' + key);
      if (!response.ok || !current()) return false;
      vocal = await response.blob();
      if (!current()) return false;
    }
    if (!await buildVoicePeaks(vocal) || !current()) return false;
    if (fromServer) { await persistVoiceAudio(original, vocal); if (!current()) return false; }
    cacheVoiceAudio(vocal); drawWave();
    return true;
  } catch { return false; }
}
