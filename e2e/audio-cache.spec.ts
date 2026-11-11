import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

const fixture = { v: 1, meta: { title: 'Durable audio', artist: 'Test', lang: 'ru', mode: 'original', md: [] }, lines: [{ t: 0, end: 8, text: 'voice cache', tr: '' }] };
function wav(hz: number) {
  const samples = 16000 * 10, b = Buffer.alloc(44 + samples * 2);
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) b.writeInt16LE(Math.round(3000 * Math.sin(i * 2 * Math.PI * hz / 16000)), 44 + i * 2);
  return b;
}
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
async function init(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('helpSeen', '1');
    const create = document.createElement.bind(document);
    document.createElement = ((tag: string, options?: ElementCreationOptions) => {
      const element = create(tag, options); if (tag === 'audio') (window as any).testAudio = element; return element;
    }) as typeof document.createElement;
  });
  // Content-keyed server mock, never serves another recording's stem.
  let current = '';
  const stems = new Map<string, Buffer>();
  await page.route('**/api/align/audio?*', route => {
    current = hash(route.request().postDataBuffer()!);
    return route.fulfill({ json: { ok: true, audioKey: current, vocals: stems.has(current) } });
  });
  await page.route('**/api/align/vocals*', async route => {
    const key = new URL(route.request().url()).searchParams.get('audioKey') || current;
    if (route.request().method() === 'POST') {
      stems.set(key, route.request().postDataBuffer()!);
      return route.fulfill({ json: { ok: true, audioKey: key, vocals: true, vocalSource: 'import' } });
    }
    const stem = stems.get(key);
    return stem ? route.fulfill({ contentType: 'audio/wav', body: stem }) : route.fulfill({ status: 404, json: { error: 'no matching stem' } });
  });
  await page.route('**/lrclib.net/api/search?*', route => route.fulfill({ json: [] }));
}
async function loadOriginal(page: Page, bytes: Buffer) {
  await page.locator('#fileAudio').setInputFiles({ name: 'same-title.wav', mimeType: 'audio/wav', buffer: bytes });
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('audio:last') || 'null')?.key)).toBe(hash(bytes));
}
async function importStem(page: Page, bytes: Buffer) {
  await page.locator('#fileVocalsCard').setInputFiles({ name: 'rx-voice.wav', mimeType: 'audio/wav', buffer: bytes });
  await expect(page.locator('#playbackSource option[value=voice]')).toHaveJSProperty('disabled', false);
  // The UI can expose the decoded stem before the persistence transaction commits.
  await expect.poll(() => page.evaluate(() => new Promise<string[]>(resolve => {
    const request = indexedDB.open('spicy-translate'); request.onsuccess = () => {
      const db = request.result, tx = db.transaction('audio'), keys = tx.objectStore('audio').getAllKeys();
      keys.onsuccess = () => { resolve(keys.result.map(String)); db.close(); };
    };
  }))).toContain('content:voice:' + await page.evaluate(() => JSON.parse(localStorage.getItem('audio:last')!).key));
}
async function mediaHash(page: Page) {
  return page.evaluate(async () => {
    const audio = (window as any).testAudio as HTMLAudioElement;
    const bytes = await (await fetch(audio.src)).arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return { hash: Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join(''), paused: audio.paused };
  });
}

test('original and imported RX vocal survive reload by content, not same-titled metadata', async ({ page, request }) => {
  const original = wav(220), vocal = wav(440), replacement = wav(330);
  await request.put('/api/project?by=page', { data: fixture }); await init(page); await page.goto('/'); await page.locator('#nav-track').click();
  await loadOriginal(page, original); await importStem(page, vocal);
  // Restore from IndexedDB even if the server has lost all stem files.
  await page.route('**/api/align/vocals*', route => route.fulfill({ status: 404, json: { error: 'server cache unavailable' } }));
  await page.reload();
  await expect(page.locator('#playbackSource option[value=voice]')).toHaveJSProperty('disabled', false);
  expect(await mediaHash(page)).toEqual({ hash: hash(original), paused: true });
  await page.locator('#playbackSource').selectOption('voice');
  await expect.poll(async () => (await mediaHash(page)).hash).toBe(hash(vocal));
  expect((await mediaHash(page)).paused).toBe(true);
  await loadOriginal(page, replacement);
  await expect(page.locator('#playbackSource option[value=voice]')).toHaveJSProperty('disabled', true);
  await page.reload();
  await expect(page.locator('#playbackSource')).toBeEnabled();
  expect(await mediaHash(page)).toEqual({ hash: hash(replacement), paused: true });
  await expect(page.locator('#playbackSource option[value=voice]')).toHaveJSProperty('disabled', true);
  const json = (await (await request.get('/api/project')).json()).project;
  expect(JSON.stringify(json)).not.toContain('content:'); expect(JSON.stringify(json)).not.toContain('blob:');
});

test('audio-only project survives reload, but a new empty project never resurrects its audio', async ({ page, request }) => {
  await request.put('/api/project?by=page', { data: fixture }); await init(page); await page.goto('/'); await page.locator('#nav-track').click();
  await page.locator('#btnNewProject').click();
  const original = wav(220), vocal = wav(440);
  await loadOriginal(page, original); await importStem(page, vocal);
  await page.reload();
  await expect(page.locator('#playbackSource option[value=voice]')).toHaveJSProperty('disabled', false);
  expect(await mediaHash(page)).toEqual({ hash: hash(original), paused: true });
  await page.locator('#btnNewProject').click();
  await expect(page.locator('#playbackSource')).toBeDisabled();
  await page.reload();
  await expect(page.locator('#playbackSource')).toBeDisabled();
  await expect(page.locator('#playbackSource option[value=voice]')).toHaveJSProperty('disabled', true);
});

test('failed replacement transaction warns honestly and cannot restore the old same-titled original', async ({ page, request }) => {
  await request.put('/api/project?by=page', { data: fixture }); await init(page); await page.goto('/'); await page.locator('#nav-track').click();
  await loadOriginal(page, wav(220));
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'audio') throw new DOMException('Test quota exhaustion', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  await page.locator('#fileAudio').setInputFiles({ name: 'same-title.wav', mimeType: 'audio/wav', buffer: wav(330) });
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('audio:last') || 'null')?.key)).toBeNull();
  await expect(page.locator('#st1')).toContainText('Аудио не сохранено в браузере');
  await page.reload();
  await expect(page.locator('#playbackSource')).toBeDisabled();
});

for (const found of [true, false]) {
  test(`late filename search for replaced audio cannot mutate current project (${found ? 'found lyrics' : 'empty result'})`, async ({ page, request }) => {
    await request.put('/api/project?by=page', { data: fixture }); await init(page);
    let release!: () => void, fallbackRequests = 0;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const hit = (artist: string, title: string, text: string) => ({ id: 1, artistName: artist, trackName: title, albumName: null, duration: 10, syncedLyrics: `[00:00.00]${text}\n[00:06.00]end`, plainLyrics: null });
    await page.route('**/lrclib.net/api/search?*', async route => {
      const query = new URL(route.request().url()).searchParams.get('q');
      if (query === 'Artist A Track A') { await blocked; return route.fulfill({ json: found ? [hit('Artist A', 'Track A', 'stale A lyrics')] : [] }); }
      if (query === 'Track A') { fallbackRequests++; return route.fulfill({ json: [] }); }
      return route.fulfill({ json: [hit('Artist B', 'Track B', 'current B lyrics')] });
    });
    await page.goto('/'); await page.locator('#nav-track').click(); await page.locator('#btnNewProject').click();
    const firstRequested = page.waitForRequest(request => new URL(request.url()).searchParams.get('q') === 'Artist A Track A');
    await page.locator('#fileAudio').setInputFiles({ name: 'Artist A - Track A.wav', mimeType: 'audio/wav', buffer: wav(220) });
    await firstRequested;
    const originalB = wav(330);
    await page.locator('#fileAudio').setInputFiles({ name: 'Artist B - Track B.wav', mimeType: 'audio/wav', buffer: originalB });
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('last') || 'null')?.meta.title)).toBe('Track B');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('audio:last') || 'null')?.key)).toBe(hash(originalB));
    await expect(page.locator('#st1')).toContainText('Аудио и волна готовы');
    const before = await page.evaluate(() => ({ project: localStorage.getItem('last'), audio: localStorage.getItem('audio:last') }));
    const response = page.waitForResponse(response => new URL(response.url()).searchParams.get('q') === 'Artist A Track A');
    release(); await (await response).finished();
    // Let the fetch JSON continuation and a full UI paint complete, without timing sleeps.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(await page.evaluate(() => ({ project: localStorage.getItem('last'), audio: localStorage.getItem('audio:last') }))).toEqual(before);
    expect(fallbackRequests).toBe(0);
    expect(await mediaHash(page)).toEqual({ hash: hash(originalB), paused: true });
    await expect(page.locator('#pTitle')).toHaveText('Track B');
  });
}
