import { expect, test } from '@playwright/test';

const fixture = { v: 1, meta: { title: 'Fit all', artist: 'Test', lang: 'ru', mode: 'original', md: [] }, lines: [
  { t: 0, end: 10, text: 'музыку', tr: '', bg: { text: 'эй', tr: '' }, sync: { orig: [{ a: 2, b: 4 }], bgo: [{ a: 1.5, b: 4.5 }] } },
  { t: 1, end: 12, text: 'другая партия', tr: '', sync: { orig: [{ a: 3, b: 4 }, { a: 4, b: 5 }] } },
  { t: 6, end: 10, text: '', tr: '', bg: { text: 'о', tr: '' }, sync: { bgo: [{ a: 6.5, b: 7 }] } },
  { t: 11, end: 15, text: 'без разметки', tr: '', sync: {} },
] };
test.beforeEach(async ({ page, request }) => {
  await request.put('/api/project?by=page', { data: fixture });
  await page.addInitScript(() => { localStorage.setItem('helpSeen', '1'); localStorage.setItem('dockH', '340'); });
  await page.setViewportSize({ width: 1600, height: 1000 }); await page.goto('/'); await page.locator('#nav-sync').click();
});

test('all commands move above the preview; timeline and lines can hide without hiding quick actions', async ({ page }) => {
  await expect(page.locator('#wordBar')).toBeHidden();
  await page.locator('#btnEditorCommands').click(); await expect(page.locator('#wbF')).toBeVisible(); await expect(page.locator('#btnJoin')).toBeVisible();
  const toolbar = (await page.locator('#editorToolbar').boundingBox())!, main = (await page.locator('main').boundingBox())!;
  expect(toolbar.y + toolbar.height).toBeLessThanOrEqual(main.y + 1);
  await page.locator('#btnEditorCommands').click(); await page.locator('#btnToggleTimeline').click(); await expect(page.locator('#dock')).toBeHidden();
  await expect(page.locator('#btnFitEveryLine')).toBeVisible(); await expect(page.locator('#btnQuickSyllables')).toBeVisible();
  await page.locator('#btnToggleLines').click(); await expect(page.locator('main>.col').first()).toBeHidden();
  await page.reload(); await page.locator('#nav-sync').click(); await expect(page.locator('#dock')).toBeHidden();
  await page.locator('#btnToggleTimeline').click(); await page.locator('#btnToggleLines').click(); await expect(page.locator('#dock')).toBeVisible();
});

test('fit ALL lines and repeat it automatically when exporting; undo preserves the backing-only bounds', async ({ page, request }) => {
  const project = async () => (await (await request.get('/api/project')).json()).project;
  const bounds = async () => (await project()).lines.map((l: any) => [l.t, l.end]);
  await page.locator('#btnFitEveryLine').click();
  await expect.poll(bounds).toEqual([[1.5, 4.5], [3, 5], [6.5, 7], [11, 15]]);
  expect((await project()).lines.map((l: any) => l.sync)).toEqual(fixture.lines.map(l => l.sync));
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect.poll(bounds).toEqual(fixture.lines.map(l => [l.t, l.end]));
  await page.locator('#btnStudioExport').click(); await page.locator('#btnShow').click();
  await expect.poll(bounds).toEqual([[1.5, 4.5], [3, 5], [6.5, 7], [11, 15]]);
  await expect(page.locator('#out')).toContainText('ttm:role="x-bg"');
});

test('Russian syllable preview is reversible and preserves word and backing spans', async ({ page, request }) => {
  const project = async () => (await (await request.get('/api/project')).json()).project;
  await page.locator('#ln0 .compact-text').first().click(); await page.locator('#btnQuickSyllables').click();
  await expect(page.locator('#syllableText')).toHaveValue('му|зы|ку');
  await page.locator('#btnApplySyllables').click();
  await expect.poll(async () => (await project()).lines[0].text).toBe('му|зы|ку');
  const l = (await project()).lines[0]; expect(l.sync.orig[0].a).toBe(2); expect(l.sync.orig[2].b).toBe(4);
  expect(l.sync.orig.every((x: any) => x.g === 1)).toBe(true); expect(l.sync.bgo).toEqual(fixture.lines[0].sync!.bgo);
  await page.getByRole('button', { name: 'Отменить', exact: true }).click(); await expect.poll(async () => (await project()).lines[0].text).toBe('музыку');
});

test('fitting can reorder phrases while the selected word follows its original phrase', async ({ page, request }) => {
  const project = async () => (await (await request.get('/api/project')).json()).project;
  const alternate = { ...fixture, lines: [
    { t: 0, end: 12, text: 'поздняя', tr: '', sync: { orig: [{ a: 8, b: 9 }] } },
    { t: 1, end: 7, text: 'ранняя', tr: '', sync: { orig: [{ a: 2, b: 3 }] } },
  ] };
  await page.locator('#nav-export').click();
  await page.locator('#fileProj').setInputFiles({ name: 'reorder.spicy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(alternate)) });
  await page.locator('#nav-sync').click();
  await page.locator('#lines').getByRole('button', { name: 'поздняя', exact: true }).click(); await page.locator('#btnFitEveryLine').click();
  await expect.poll(async () => (await project()).lines.map((l: any) => l.text)).toEqual(['ранняя', 'поздняя']);
  await expect(page.locator('#wordInspector h3')).toHaveText('поздняя');
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect.poll(async () => (await project()).lines.map((l: any) => [l.text, l.t, l.end])).toEqual([['поздняя', 0, 12], ['ранняя', 1, 7]]);
});
