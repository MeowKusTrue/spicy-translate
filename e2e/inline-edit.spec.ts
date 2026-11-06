import { expect, test } from '@playwright/test';
const fixture = { v: 1, meta: { title: 'Inline fixture', artist: 'Test', lang: 'ru', mode: 'original', md: [] }, lines: [
  { t: 1, end: 6, text: 'тихое море', tr: 'quiet sea', sync: { orig: [{ a: 1, b: 2 }, { a: 3, b: 6 }], tr: [{ a: 1, b: 2 }, { a: 3, b: 6 }] } },
  { t: 7, end: 10, text: 'другая строка', tr: '', sync: { orig: [{ a: 7, b: 8 }, { a: 8, b: 10 }] } },
] };
test.beforeEach(async ({ page, request }) => {
  await request.put('/api/project?by=page', { data: fixture });
  await page.addInitScript(() => { localStorage.setItem('helpSeen', '1'); localStorage.setItem('dockH', '340'); });
  await page.setViewportSize({ width: 1600, height: 1000 }); await page.goto('/'); await page.evaluate(() => document.documentElement.classList.add('app')); await page.locator('#nav-sync').click();
});
test('per-line back supports Enter, cancel, independent language and undo', async ({ page, request }) => {
  const project = async () => (await (await request.get('/api/project')).json()).project;
  await page.getByRole('button', { name: 'Добавить бэк к строке 1', exact: true }).click();
  await page.locator('#backInlineText').fill('эй рядом');
  expect((await project()).lines[0].bg).toBeUndefined();
  await page.locator('#backInlineText').press('Escape'); await expect(page.locator('#backInlineText')).toHaveCount(0);
  expect((await project()).lines[0].bg).toBeUndefined();
  await page.getByRole('button', { name: 'Добавить бэк к строке 1', exact: true }).click();
  await page.locator('#backInlineText').fill('эй рядом'); await page.locator('#backInlineText').press('Enter');
  await expect.poll(async () => (await project()).lines[0].bg?.text).toBe('эй рядом');
  expect((await project()).lines[0].text).toBe('тихое море'); expect((await project()).lines[0].sync.orig).toEqual(fixture.lines[0].sync.orig);
  await page.getByRole('button', { name: 'Отменить', exact: true }).click(); await expect.poll(async () => (await project()).lines[0].bg).toBeUndefined();
  await page.locator('.list-language').getByRole('button', { name: 'Перевод', exact: true }).click();
  await expect(page.locator('#ln0 .compact-text')).toHaveText('quiet sea');
  await page.getByRole('button', { name: 'Добавить бэк к строке 1', exact: true }).click();
  await page.locator('#backInlineText').fill('hey'); await page.locator('#backInlineText').press('Enter');
  await expect.poll(async () => (await project()).lines[0].bg?.tr).toBe('hey'); expect((await project()).meta.mode).toBe('original');
  await page.getByRole('button', { name: 'Править бэк строки 1', exact: true }).click();
  await page.locator('#backInlineText').fill('hey there'); await page.locator('#backInlineText').press('Enter');
  await expect.poll(async () => (await project()).lines[0].bg?.tr).toBe('hey there');
  const overlap = await page.locator('#ln0').evaluate(el => el.getBoundingClientRect().bottom > document.getElementById('ln1')!.getBoundingClientRect().top + 1); expect(overlap).toBe(false);
});
test('sidebar can drag, resize by keyboard and retain width on reload', async ({ page }) => {
  const separator = page.locator('#sidebarResize'), box = (await separator.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 90); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 110, box.y + 90, { steps: 5 }); await page.mouse.up();
  await expect(separator).toHaveAttribute('aria-valuenow', '365');
  await separator.focus(); await separator.press('ArrowRight'); await expect(separator).toHaveAttribute('aria-valuenow', '381');
  await page.reload(); await page.locator('#nav-sync').click(); await expect(separator).toHaveAttribute('aria-valuenow', '381');
  const left = (await page.locator('main>.col').first().boundingBox())!; expect(left.width).toBeCloseTo(381, 0);
});
test('preview shows draft syllables before saving, Escape discards and Enter commits', async ({ page, request }) => {
  const project = async () => (await (await request.get('/api/project')).json()).project;
  await page.locator('#ln0 .t').click(); await page.locator('#pl0').dblclick(); await page.locator('#previewEditText').fill('тихое мо|ре');
  await expect(page.locator('#syncLines .sl.cur .chip')).toHaveCount(3); expect((await project()).lines[0].text).toBe('тихое море');
  await page.locator('#previewEditText').press('Escape'); await expect(page.locator('#syncLines .sl.cur .chip')).toHaveCount(2);
  await page.locator('#pl0').dblclick(); await page.locator('#previewEditText').fill('тихое мо|ре'); await page.locator('#previewEditText').press('Enter');
  await expect(page.locator('#previewEdit')).toHaveCount(0); await expect.poll(async () => (await project()).lines[0].text).toBe('тихое мо|ре');
});
test('quick syllables affect only the chosen word and show live boundaries before Enter', async ({ page, request }) => {
  const project = async () => (await (await request.get('/api/project')).json()).project;
  await page.locator('#ln0 .t').click(); await page.locator('#syncLines .sl.cur .chip').filter({ hasText: /^море$/ }).click(); await page.locator('#btnQuickSyllables').click();
  await expect(page.locator('#syllableText')).toHaveValue('мо|ре'); await expect(page.locator('#syncLines .sl.cur .chip')).toHaveCount(3);
  expect((await project()).lines[0].text).toBe('тихое море');
  await page.locator('#syllableText').fill('мор|е'); await expect(page.locator('#syncLines .sl.cur .chip').nth(1)).toHaveText('мор');
  await page.locator('#syllableText').press('Enter'); await expect.poll(async () => (await project()).lines[0].text).toBe('тихое мор|е');
  expect((await project()).lines[0].sync.orig[0]).toEqual(fixture.lines[0].sync.orig[0]);
});
test('long-word fill advances left to right over the complete timed word, including the ending', async ({ page }) => {
  const seek = async (t: number) => { await page.locator('#seek').evaluate((el, t) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, String(t)); el.dispatchEvent(new Event('input', { bubbles: true })); }, t); };
  await seek(4.5); await expect(page.locator('#pl0')).toHaveClass(/act/);
  const letters = page.locator('#pl0>.w').nth(1).locator('.lt');
  await expect.poll(() => letters.first().evaluate(el => el.style.getPropertyValue('--gp'))).toBe('100.0%');
  expect(await letters.last().evaluate(el => el.style.getPropertyValue('--gp'))).toBe('-20.0%');
  const alpha = await page.locator('#pl0').evaluate(el => getComputedStyle(el).getPropertyValue('--ge')); expect(Number(alpha)).toBeLessThanOrEqual(.4);
  await seek(5.9); await expect.poll(() => letters.last().evaluate(el => parseFloat(el.style.getPropertyValue('--gp')))).toBeGreaterThan(0);
  await seek(6); await expect.poll(() => letters.last().evaluate(el => el.style.getPropertyValue('--gp'))).toBe('100.0%');
  await seek(3); await expect.poll(() => letters.first().evaluate(el => el.style.getPropertyValue('--gp'))).toBe('-20.0%');
});

test('real audio, faster playback and pause keep lyric fill on the media clock', async ({ page }) => {
  await page.evaluate(() => { const original = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { (window as any).__testMedia = this; return original.call(this); }; });
  const sr = 8000, samples = sr * 10, wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sr, 24); wav.writeUInt32LE(sr * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  await page.locator('#fileAudio').setInputFiles({ name: 'clock.wav', mimeType: 'audio/wav', buffer: wav });
  await expect(page.locator('#nav-track em')).toHaveText('✓');
  await page.locator('#seek').evaluate(el => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, '4'); el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('#btnPlay').click();
  await page.evaluate(() => { (window as any).__testMedia.playbackRate = 1.5; });
  const error = () => page.evaluate(() => {
    const a = (window as any).__testMedia as HTMLMediaElement;
    const letters = [...document.querySelectorAll<HTMLElement>('#pl0>.w:nth-of-type(2) .lt')];
    const fill = letters.reduce((n, e) => n + Math.max(0, Math.min(1, (parseFloat(e.style.getPropertyValue('--gp')) + 20) / 120)), 0) / letters.length;
    return Math.abs(fill - Math.max(0, Math.min(1, (a.currentTime - 3) / 3)));
  });
  await expect.poll(error).toBeLessThan(.025);
  await page.locator('#btnPlay').click();
  await expect.poll(error).toBeLessThan(.002);
  const frozen = await page.locator('#pl0>.w').nth(1).getAttribute('style');
  await page.waitForTimeout(150); expect(await page.locator('#pl0>.w').nth(1).getAttribute('style')).toBe(frozen);
});

test('long-song preview skips invisible glyphs and records frame budget', async ({ page }, info) => {
  const many = { ...fixture, lines: Array.from({ length: 180 }, (_, i) => ({ t: i * 4 + 1, end: i * 4 + 4, text: 'тихая музыка рядом снова слышна нам сегодня здесь', tr: '', sync: {} })) };
  await page.locator('#nav-export').click(); await page.locator('#fileProj').setInputFiles({ name: 'long.spicy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(many)) }); await page.locator('#nav-sync').click(); await expect(page.locator('#pl179')).toHaveCount(1); await page.locator('#ln0 .t').click();
  await page.locator('#btnPlay').click();
  const frames = await page.evaluate(() => new Promise<number[]>(resolve => { const values: number[] = []; let last = performance.now(); function frame(t: number) { values.push(t - last); last = t; if (values.length === 60) resolve(values.slice(2)); else requestAnimationFrame(frame); } requestAnimationFrame(frame); }));
  const sorted = frames.sort((a, b) => a - b), report = { lines: 180, words: 1440, medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.floor(sorted.length * .95)] };
  await info.attach('preview-frame-budget.json', { body: JSON.stringify(report), contentType: 'application/json' });
  await expect(page.locator('#pl179>.w').first()).not.toHaveAttribute('style');
  await expect(page.locator('#pl0>.w').first()).toHaveAttribute('style', /--gp/);
  console.log('Preview frame budget:', JSON.stringify(report));
});
