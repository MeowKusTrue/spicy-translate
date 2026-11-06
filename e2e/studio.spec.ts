import { expect, test } from '@playwright/test';

const fixture = { v: 1, meta: { title: 'Studio fixture', artist: 'Test', lang: 'ru', mode: 'original', md: [] }, lines: [
  { t: 1, end: 4, text: 'тихое море', tr: 'quiet sea', sync: { orig: [{ a: 1, b: 2 }, { a: 2, b: 4 }], tr: [{ a: 1, b: 2 }, { a: 2, b: 4 }] } },
  { t: 2.5, end: 3.5, text: '', tr: '', bg: { text: 'эй', tr: 'hey' }, sync: { bgo: [{ a: 2.5, b: 3.5 }], bg: [{ a: 2.5, b: 3.5 }] } },
  { t: 5, end: 8, text: 'следующая строка', tr: 'next line', sync: { orig: [{ a: 5, b: 6 }, { a: 6, b: 8 }] } },
] };
test.beforeEach(async ({ page, request }) => {
  await request.put('/api/project?by=page', { data: fixture });
  await page.addInitScript(() => { localStorage.setItem('helpSeen', '1'); localStorage.setItem('dockH', '400'); });
  await page.setViewportSize({ width: 1600, height: 1000 }); await page.goto('/'); await page.locator('#nav-sync').click();
});

test('edit actual large preview text, preserve word times and other layers, undo, cancel and validate', async ({ page, request }) => {
  const project = async () => (await (await request.get('/api/project')).json()).project;
  await page.locator('#ln0 .t').click(); await page.locator('#pl0').dblclick();
  await expect(page.locator('#previewEditText')).toHaveText('тихое море');
  await page.locator('#previewEditText').fill('тихое море рядом'); await page.keyboard.press('Control+Enter');
  await expect(page.locator('#previewEdit')).toHaveCount(0);
  await expect.poll(async () => (await project()).lines[0].text).toBe('тихое море рядом');
  const changed = (await project()).lines[0]; expect(changed.sync.orig[0]).toEqual(fixture.lines[0].sync!.orig![0]); expect(changed.sync.tr).toEqual(fixture.lines[0].sync!.tr);
  await page.keyboard.press('Control+z'); await expect.poll(async () => (await project()).lines[0].text).toBe('тихое море');
  await page.locator('#pl0').dblclick(); await page.locator('#previewEditText').fill(''); await page.locator('#btnPreviewSave').click();
  await expect(page.locator('.preview-edit-error')).toContainText('Строка пуста'); await page.locator('#previewEditText').fill('не сохранять'); await page.keyboard.press('Escape');
  await expect(page.locator('#previewEdit')).toHaveCount(0); expect((await project()).lines[0].text).toBe('тихое море');
});

test('original mode excludes translations from TTML and row action buttons never overlap text', async ({ page }) => {
  await expect(page.locator('#ln0 .compact-translation')).toBeHidden();
  const overlaps = await page.locator('#ln0').evaluate(el => { const a = el.querySelector('.txt')!.getBoundingClientRect(), b = el.querySelector('.compact-menu')!.getBoundingClientRect(); return a.right > b.left; });
  expect(overlaps).toBe(false);
  await page.locator('#mode-bilingual').click(); await expect(page.locator('#ln0 .compact-translation')).toBeVisible();
  await page.locator('#mode-original').click(); await page.locator('#btnStudioExport').click(); await page.locator('#btnShow').click();
  await expect(page.locator('#out')).toContainText('тихое'); await expect(page.locator('#out')).not.toContainText('quiet');
});

test('link and detach a real background phrase, preserve timings, undo linking', async ({ page, request }) => {
  const project = async () => (await (await request.get('/api/project')).json()).project;
  await page.locator('#ln1 .compact-back').click(); await page.locator('#segBg').click();
  await page.locator('#backingParent').selectOption('0'); await page.locator('#btnLinkBacking').click();
  await expect.poll(async () => (await project()).lines.length).toBe(2);
  expect((await project()).lines[0].sync.bgo).toEqual(fixture.lines[1].sync!.bgo);
  await page.locator('#btnDetachBacking').click(); await expect.poll(async () => (await project()).lines.length).toBe(3);
  expect((await project()).lines[1].bg.text).toBe('эй');
  await page.keyboard.press('Control+z'); await expect.poll(async () => (await project()).lines.length).toBe(2);
  await page.keyboard.press('Control+z'); await expect.poll(async () => (await project()).lines.length).toBe(3);
});

test('long preview edits scroll inside the field instead of moving the lyric preview', async ({ page }) => {
  await page.locator('#ln0 .t').click(); await page.locator('#pl0').dblclick();
  await page.locator('#previewEditText').fill('длинная строка для проверки прокрутки '.repeat(60));
  const field = page.locator('#previewEditText'), rect = (await field.boundingBox())!;
  expect(rect.height).toBeLessThanOrEqual(240);
  const before = await page.locator('#lyrIn').evaluate(e => getComputedStyle(e).transform);
  await field.evaluate(e => { e.scrollTop = 0; }); await field.hover(); await page.mouse.wheel(0, 400);
  await expect.poll(() => field.evaluate(e => e.scrollTop)).toBeGreaterThan(0);
  expect(await page.locator('#lyrIn').evaluate(e => getComputedStyle(e).transform)).toBe(before);
  await page.locator('#btnPreviewCancel').click();
});
