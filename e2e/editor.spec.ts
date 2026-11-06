import { expect, test } from '@playwright/test';

const fixture = { v: 1, meta: { title: 'Editor fixture', artist: 'Test', lang: 'ru', mode: 'translation', md: [] }, lines: [
  { t: 1, end: 4, text: 'первый хвост', tr: '', sync: { orig: [{ a: 1, b: 2 }, { a: 2, b: 4 }] } },
  { t: 2.5, end: 5, text: 'другая партия', tr: '', sync: { orig: [{ a: 2.5, b: 3.5 }, { a: 3.5, b: 5 }] } },
  { t: 8, end: 11, text: 'первый хвост', tr: 'keep translation', sync: { tr: [{ a: 8, b: 9 }, { a: 9, b: 11 }] } },
  { t: 13, end: 16, text: 'первый хвост', tr: '', sync: { orig: [{ a: 13, b: 14.2 }, { a: 14.2, b: 16 }] } },
  { t: 16, end: 17, text: '', tr: '', bg: { text: 'эй', tr: '' }, sync: { bgo: [{ a: 16, b: 17, g: 1 }] } },
] };
test.beforeEach(async ({ page, request }) => {
  await request.put('/api/project?by=page', { data: fixture });
  await page.addInitScript(() => { localStorage.setItem('helpSeen', '1'); localStorage.setItem('dockH', '600'); });
  await page.goto('/'); await page.locator('#nav-sync').click();
  await page.locator('#segOrig').click();
  await expect(page.locator('#segOrig')).toHaveClass('on');
});

test('exact word editing preserves overlapping phrases, rolls shared edges, validates and undoes', async ({ page, request }) => {
  const project = async () => (await (await request.get('/api/project')).json()).project;
  await page.locator('#syncLines .sl').first().locator('.chip').nth(1).click();
  await expect(page.locator('#wordInspector h3')).toHaveText('хвост');
  await page.locator('#wordEnd').fill('4.200'); await page.locator('#btnWordApply').click();
  await expect.poll(async () => (await project()).lines[0].sync.orig[1].b).toBe(4.2);
  expect((await project()).lines[1].sync).toEqual(fixture.lines[1].sync);
  await page.locator('#wordStart').fill('2,300'); await page.locator('#btnWordApply').click();
  await expect.poll(async () => (await project()).lines[0].sync.orig[0].b).toBe(2.3);
  await page.locator('#wordRoll').uncheck();
  await page.locator('#wordStart').fill('1.500'); await page.locator('#btnWordApply').click();
  await expect(page.locator('.inspector-error')).toContainText('пересекает предыдущее');
  expect((await project()).lines[0].sync.orig[1].a).toBe(2.3);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await project()).lines[0].sync.orig[1].a).toBe(2);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await project()).lines[0].sync.orig[1].b).toBe(4);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(async () => (await project()).lines[0].sync.orig[1].b).toBe(4.2);
});

test('repeat automation copies only the active layer, preserves existing times and undoes in one step', async ({ page, request }) => {
  const project = async () => (await (await request.get('/api/project')).json()).project;
  await page.locator('#syncLines .sl').first().locator('.chip').first().click();
  await expect.poll(async () => (await project()).lines[2].sync.orig?.length).toBe(2);
  const before = await project();
  await page.locator('#btnInspectorRepeats').click();
  await expect.poll(async () => (await project()).lines[2].sync.orig?.[0]?.b).toBe(9);
  const after = await project();
  expect(after.lines[2].sync.orig).toEqual([{ a: 8, b: 9, g: 1 }, { a: 9, b: 11, g: 1 }]);
  expect(after.lines[2].sync.tr).toEqual(fixture.lines[2].sync!.tr);
  expect(after.lines[3].sync).toEqual(fixture.lines[3].sync);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await project()).lines[2].sync.orig).toEqual(before.lines[2].sync.orig);
});

test('review flow confirms a background draft; focus mode and inspector can be toggled', async ({ page, request }) => {
  await page.locator('#segBg').click();
  await expect(page.locator('#syncStat')).toContainText('0/1');
  await page.locator('#btnReviewNext').click();
  await expect(page.locator('#wordInspector h3')).toHaveText('эй');
  await expect(page.locator('.inspector-reason')).toContainText('Авточерновик');
  await page.locator('#btnWordApplyNext').click();
  await expect(page.locator('#syncStat')).toContainText('1/1');
  await expect(page.locator('#btnReviewNext')).toBeDisabled();
  await expect.poll(async () => (await (await request.get('/api/project')).json()).project.lines[4].sync.bgo[0].g).toBeUndefined();
  await page.locator('#btnEditorCommands').click();
  await page.locator('#btnEditorFocus').click();
  await expect(page.locator('body')).toHaveClass(/editor-focus/);
  await page.locator('#btnWordInspector').click();
  await expect(page.locator('#wordInspector')).toHaveCount(0);
  await page.locator('#btnWordInspector').click();
  await expect(page.locator('#wordInspector')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('editor-focus.png'), animations: 'disabled' });
  await page.locator('#nav-text').click();
  await expect(page.locator('body')).not.toHaveClass(/editor-focus/);
});

test('phrase loop keeps playing after a previous word preview timer', async ({ page }) => {
  const b = Buffer.alloc(44 + 16000 * 6 * 2);
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(b.length - 44, 40);
  await page.locator('#fileAudio').setInputFiles({ name: 'preview.wav', mimeType: 'audio/wav', buffer: b });
  await page.locator('#syncLines .sl').first().locator('.chip').first().click();
  await page.locator('#btnInspectorListen').click();
  await page.locator('#wordLoop').check(); await page.locator('#btnInspectorPhrase').click();
  await page.waitForTimeout(1400); // the preceding single-word preview timer must no longer stop playback
  await expect(page.locator('#btnPlay')).toHaveText('❚❚');
  expect(await page.locator('#seek').inputValue().then(Number)).toBeGreaterThan(1.5);
  await page.waitForTimeout(2600); // the phrase has now wrapped to its beginning
  await expect(page.locator('#btnPlay')).toHaveText('❚❚');
  expect(await page.locator('#seek').inputValue().then(Number)).toBeLessThan(3);
  await page.getByRole('button', { name: 'Остановить прослушивание', exact: true }).click();
  await expect(page.locator('#btnPlay')).toHaveText('▶');
});
