// Album cover behind the preview (like Spicy Lyrics' dynamic background).
// Sources, best first: a picture the maker chose (file / drop / found online, kept per track in IndexedDB),
// then the picture inside the MP3 (ID3). Nothing is fetched from the internet unless asked.
import { id3Cover } from './core/id3.ts';
import { S, emit, toast } from './state.ts';
import { idbDel, idbGet, idbPut, trackKey } from './persist.ts';

const key = () => { const k = trackKey(); return k ? 'cover:' + k : ''; };
let url = '', forKey = '';
function show(b: Blob | null) {
  if (url) URL.revokeObjectURL(url);
  url = b ? URL.createObjectURL(b) : ''; S.cover = url; emit();
}
async function fromAudio() {
  const a = S.audioBlob; if (!a) return null;
  const c = id3Cover(new Uint8Array(await a.slice(0, 16 << 20).arrayBuffer()));
  return c ? new Blob([c.data as BlobPart], { type: c.mime }) : null;
}
/** cover for the current track: the chosen one, else the one in the audio file */
export async function restoreCover(force?: boolean) {
  const k = key(); if (!force && k === forKey && S.cover) return; forKey = k;
  show((k ? await idbGet(k) : null) || await fromAudio());
}
export async function setCover(b: Blob) {
  if (!b.type.startsWith('image/')) return toast('Это не картинка', 'err');
  const k = key(); if (k) idbPut(k, b); forKey = k; show(b);
  toast(k ? 'Обложка сохранена для этого трека' : 'Обложка поставлена (загрузи трек, чтобы она запомнилась)', 'ok');
}
export async function clearCover() {
  const k = key();
  if (k) await idbDel(k);
  const a = await fromAudio(); show(a);
  toast(a ? 'Своя обложка убрана — показываю ту, что в аудиофайле' : 'Обложка убрана', 'ok');
}
/** iTunes Search: the artwork of the best match for artist + title, 1000×1000 */
export async function findCover() {
  const q = `${S.meta.artist} ${S.meta.title}`.trim();
  if (!q) return toast('Сначала загрузи трек — искать обложку не по чему', 'err');
  try {
    const r = await fetch(`https://itunes.apple.com/search?media=music&entity=song&limit=5&term=${encodeURIComponent(q)}`).then(r => r.json());
    const hit = (r.results || [])[0]; if (!hit?.artworkUrl100) return toast(`Обложку для «${q}» не нашёл — загрузи картинку вручную`, 'err');
    const img = await fetch(hit.artworkUrl100.replace('100x100bb', '1000x1000bb')).then(r => r.ok ? r.blob() : Promise.reject(new Error('HTTP ' + r.status)));
    await setCover(img);
  } catch (e) { toast('Не вышло найти обложку: ' + (e as Error).message, 'err'); }
}
