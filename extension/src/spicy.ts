// Пишем TTML прямо в локальную БД Spicy Lyrics (см. NOTES.md): IndexedDB "spicylyrics" v1, store "lyricsStore",
// ключ = track URI, значение = сырой TTML. Это внутренности Spicy, не публичный API — при ошибке остаются скачивание/копирование.
const DB = 'spicylyrics', STORE = 'lyricsStore';

const req = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

function open(version?: number) {
  const r = indexedDB.open(DB, version);
  // same upgrade as Spicy's own openDB(), so an empty DB we create is one Spicy accepts as-is
  r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
  return req(r);
}

export async function putToSpicy(uri: string, ttml: string) {
  // v1 = Spicy's current schema; if they bumped the version, open whatever is there
  const db = await open(1).catch(e => e?.name === 'VersionError' ? open() : Promise.reject(e));
  try {
    if (!db.objectStoreNames.contains(STORE)) throw new Error('в БД Spicy Lyrics нет хранилища ' + STORE);
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(ttml, uri);
    await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = tx.onabort = () => rej(tx.error); });
  } finally { db.close(); }
}
