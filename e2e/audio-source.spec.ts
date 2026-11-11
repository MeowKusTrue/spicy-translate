import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';

const fixture = { v: 1, meta: { title: 'Audio sources', artist: 'Test', lang: 'ru', mode: 'original', md: [] }, lines: [{ t: 0, end: 20, text: 'test voice', tr: '' }] };
function wav(hz: number) {
  const samples = 16000 * 24, b = Buffer.alloc(44 + samples * 2);
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) b.writeInt16LE(Math.round(3000 * Math.sin(i * 2 * Math.PI * hz / 16000)), 44 + i * 2);
  return b;
}

test('listening source switches real audio independently of waveform, preserving transport; new original clears stem', async ({ page, request }) => {
  const original = wav(220), vocals = wav(440);
  await request.put('/api/project?by=page', { data: fixture });
  await page.addInitScript(() => {
    localStorage.setItem('helpSeen', '1');
    const create = document.createElement.bind(document);
    document.createElement = ((tag: string, options?: ElementCreationOptions) => {
      const el = create(tag, options);
      if (tag === 'audio') (window as any).testAudio = el;
      return el;
    }) as typeof document.createElement;
  });
  let started = false;
  await page.route(/\/api\/align(?:\?.*)?$/, route => {
    if (route.request().method() === 'POST') { expect(new URL(route.request().url()).searchParams.get('operation')).toBe('separate'); started = true; return route.fulfill({ json: { ok: true } }); }
    return route.fulfill({ json: { available: true, running: false, vocals: started, audioKey: createHash('sha256').update(original).digest('hex'), result: started ? fixture : null } });
  });
  await page.route('**/api/align/audio?*', route => {
    expect(route.request().postDataBuffer()).toEqual(original);
    return route.fulfill({ json: { ok: true, audioKey: createHash('sha256').update(original).digest('hex'), vocals: false } });
  });
  await page.route('**/api/align/vocals*', route => started ? route.fulfill({ contentType: 'audio/wav', body: vocals }) : route.fulfill({ status: 404 }));
  await page.goto('/');
  await page.locator('#fileAudio').setInputFiles({ name: 'original.wav', mimeType: 'audio/wav', buffer: original });
  await page.locator('#nav-sync').click();
  await page.locator('#btnEditorCommands').click();
  await page.locator('#btnSeparateVoice').click();
  await expect(page.locator('#playbackSource option[value=voice]')).toHaveJSProperty('disabled', false);
  const state = () => page.evaluate(() => {
    const a = (window as any).testAudio as HTMLAudioElement;
    return { src: a.src, time: a.currentTime, paused: a.paused, rate: a.playbackRate, volume: a.volume, muted: a.muted, ready: a.readyState };
  });
  const mix = (await state()).src;
  await page.evaluate(() => { const a = (window as any).testAudio as HTMLAudioElement; a.currentTime = 5; a.playbackRate = .75; a.volume = .42; a.muted = true; });
  // Use the app speed setting as well, so the transport state and media rate agree.
  await page.locator('.stset summary').click();
  await page.locator('.stset').getByRole('button', { name: '0.75×', exact: true }).click();
  await page.locator('.stset summary').click();
  await page.locator('#playbackSource').selectOption('voice');
  await expect.poll(async () => (await state()).ready).toBeGreaterThanOrEqual(1);
  const voice = await state();
  expect(voice.src).not.toBe(mix); expect(voice.paused).toBe(true); expect(voice.time).toBeCloseTo(5, 1);
  expect(voice.rate).toBe(.75); expect(voice.volume).toBe(.42); expect(voice.muted).toBe(true);
  const bytes = await page.evaluate(async () => Array.from(new Uint8Array(await (await fetch((window as any).testAudio.src)).arrayBuffer())));
  expect(Buffer.from(bytes)).toEqual(vocals);
  await page.getByRole('button', { name: 'Показать полный микс', exact: true }).click();
  expect((await state()).src).toBe(voice.src);
  await page.locator('#btnPlay').click();
  await expect.poll(async () => (await state()).paused).toBe(false);
  await page.locator('#playbackSource').selectOption('mix');
  await expect.poll(async () => (await state()).paused).toBe(false);
  await expect.poll(async () => (await state()).src).toBe(mix);
  const resumed = await state(); expect(resumed.time).toBeGreaterThanOrEqual(5); expect(resumed.time).toBeLessThan(8); expect(resumed.rate).toBe(.75);
  await page.locator('#btnPlay').click();
  await page.locator('#playbackSource').selectOption('voice');
  await expect.poll(async () => (await state()).ready).toBeGreaterThanOrEqual(1);
  expect((await state()).paused).toBe(true);
  await page.locator('#fileAudio').setInputFiles({ name: 'replacement.wav', mimeType: 'audio/wav', buffer: wav(330) });
  await expect(page.locator('#playbackSource')).toHaveValue('mix');
  await expect(page.locator('#playbackSource option[value=voice]')).toHaveJSProperty('disabled', true);
  expect((await state()).paused).toBe(true);
  expect(await page.evaluate(async url => { try { await fetch(url); return false; } catch { return true; } }, voice.src)).toBe(true);
});

test('late vocals response cannot attach to a replacement original or autoplay it', async ({ page, request }) => {
  await request.put('/api/project?by=page', { data: fixture });
  await page.addInitScript(() => localStorage.setItem('helpSeen', '1'));
  const original = wav(220);
  let started = false;
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  await page.route(/\/api\/align(?:\?.*)?$/, route => {
    if (route.request().method() === 'POST') { expect(new URL(route.request().url()).searchParams.get('operation')).toBe('separate'); started = true; return route.fulfill({ json: { ok: true } }); }
    return route.fulfill({ json: { available: true, running: false, vocals: started, audioKey: createHash('sha256').update(original).digest('hex'), result: started ? fixture : null } });
  });
  await page.route('**/api/align/audio?*', route => route.fulfill({ json: { ok: true, audioKey: createHash('sha256').update(original).digest('hex'), vocals: false } }));
  await page.route('**/api/align/vocals*', async route => { if (!started) return route.fulfill({ status: 404 }); await blocked; await route.fulfill({ contentType: 'audio/wav', body: wav(440) }); });
  await page.goto('/');
  await page.locator('#fileAudio').setInputFiles({ name: 'original.wav', mimeType: 'audio/wav', buffer: wav(220) });
  await page.locator('#nav-sync').click(); await page.locator('#btnEditorCommands').click();
  const vocalsRequested = page.waitForRequest('**/api/align/vocals?*');
  await page.locator('#btnSeparateVoice').click(); await vocalsRequested;
  await page.locator('#fileAudio').setInputFiles({ name: 'replacement.wav', mimeType: 'audio/wav', buffer: wav(330) });
  release();
  await expect(page.locator('#btnAutoAlign')).toBeEnabled();
  await expect(page.locator('#playbackSource')).toHaveValue('mix');
  await expect(page.locator('#playbackSource option[value=voice]')).toHaveJSProperty('disabled', true);
  await expect(page.locator('#btnPlay')).toHaveText('▶');
  await expect(page.getByRole('button', { name: 'Показать выделенный голос', exact: true })).toBeDisabled();
});
