export type LrcRec = { trackName: string; artistName: string; albumName?: string; duration?: number; syncedLyrics?: string | null; plainLyrics?: string | null };
export type TrackInfo = { title: string; artist: string; album: string; duration: number };

const API = 'https://lrclib.net/api/';
async function get<T>(path: string, q: Record<string, string>): Promise<T | null> {
  const r = await fetch(API + path + '?' + new URLSearchParams(q));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('LRCLIB HTTP ' + r.status);
  return r.json();
}

// exact match first (LRCLIB tolerates ±2 s), then search: synced versions closest by duration win
export async function findLyrics(t: TrackInfo): Promise<LrcRec | null> {
  const exact = await get<LrcRec>('get', { track_name: t.title, artist_name: t.artist, album_name: t.album, duration: String(Math.round(t.duration)) });
  if (exact && exact.syncedLyrics) return exact;
  const list = (await get<LrcRec[]>('search', { track_name: t.title, artist_name: t.artist })) || [];
  const dd = (x: LrcRec) => Math.abs((x.duration || 0) - t.duration);
  const synced = list.filter(x => x.syncedLyrics).sort((a, b) => dd(a) - dd(b));
  return synced[0] || exact || list[0] || null;
}
