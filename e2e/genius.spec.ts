import { expect, test } from '@playwright/test';
import { geniusAccessError } from '../src/core/genius.ts';

const fixture = {
  v: 1, meta: { title: 'Import fixture', artist: 'Test artist', lang: 'ru', mode: 'translation', md: [] },
  lines: [
    { t: 1, end: 3, text: 'мо|ре песок', tr: 'sea sand', sec: 'Своя секция', sync: {
      orig: [{ a: 1, b: 1.3 }, { a: 1.3, b: 1.7 }, { a: 2, b: 3 }], tr: [{ a: 1, b: 2 }, { a: 2, b: 3 }],
    } },
    { t: 5, end: 6, text: 'лишняя строка', tr: 'keep me' },
    { t: 9, end: 11, text: 'дальше идём', tr: 'moving on' },
  ],
};

test.beforeEach(async ({ page, request }) => {
  await request.put('/api/project?by=page', { data: fixture });
  await page.route('**/api/genius/search?*', route => route.fulfill({ json: [
    { id: 123, title: 'Reference song', artist: 'Other artist', url: 'https://genius.com/test-lyrics', art: '' },
  ] }));
  await page.route('**/api/genius/lyrics?*', route => route.fulfill({ json: {
    text: '[Куплет]\nновое интро\nморе, песок\n[Припев]\nдальше идём\nновый финал',
  } }));
  await page.goto('/');
  await expect(page.locator('#mTitle')).toHaveValue('Import fixture');
  await page.locator('#btnGenius').click();
  await page.locator('#gres .item').click();
  await expect(page.locator('#geniusMode')).toBeVisible();
});

test('Genius import: preview is read-only, add-only and one-click rollback preserve our project', async ({ page, request }) => {
  const before = (await (await request.get('/api/project')).json()).project;
  expect(before).toEqual(fixture);
  await page.locator('#geniusMode').selectOption('add');
  await expect(page.locator('.gdiff .gd')).toHaveCount(2);
  await page.locator('#btnGeniusAll').click();
  await expect(page.locator('#nav-text em')).toHaveText('5');
  await expect(page.locator('#btnGeniusUndo')).toBeEnabled();
  await expect.poll(async () => (await (await request.get('/api/project')).json()).project.lines.length).toBe(5);
  const imported = (await (await request.get('/api/project')).json()).project;
  expect(imported.meta).toEqual(fixture.meta);
  expect(imported.lines.slice(1, 4).map((l: { text: string }) => l.text)).toEqual(fixture.lines.map(l => l.text));
  expect(imported.lines[1].sync.orig).toEqual(fixture.lines[0].sync?.orig);
  expect(imported.lines[1].sec).toBe('Своя секция');
  await page.locator('#btnGeniusUndo').click();
  await expect(page.locator('#nav-text em')).toHaveText('3');
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('#nav-text em')).toHaveText('5');
});

test('Genius import: edit-only keeps extras; deletion and section replacement require opt-in', async ({ page, request }) => {
  await page.locator('#geniusMode').selectOption('edit');
  await expect(page.locator('.gdiff .gd')).toHaveCount(1);
  await expect(page.locator('#geniusRemove')).toBeDisabled();
  await page.locator('#btnGeniusAll').click();
  await expect(page.locator('#nav-text em')).toHaveText('3');
  await expect.poll(async () => (await (await request.get('/api/project')).json()).project.lines[0].text).toBe('мо|ре, песок');
  const changed = (await (await request.get('/api/project')).json()).project;
  expect(changed.lines[0].tr).toBe('sea sand');
  expect(changed.lines[0].sync.orig).toEqual(fixture.lines[0].sync?.orig);
  expect(changed.lines[1].text).toBe('лишняя строка');
  await page.locator('#btnGeniusUndo').click();
  await page.locator('#geniusMode').selectOption('merge');
  await page.locator('#geniusRemove').check();
  await page.locator('#geniusSections').check();
  await expect(page.locator('.gdiff .gd')).toHaveCount(4);
  await page.locator('#btnGeniusAll').click();
  await expect(page.locator('#nav-text em')).toHaveText('4');
  await expect.poll(async () => (await (await request.get('/api/project')).json()).project.lines.length).toBe(4);
  const replaced = (await (await request.get('/api/project')).json()).project;
  expect(replaced.lines.map((l: { text: string }) => l.text)).toEqual(['новое интро', 'мо|ре, песок', 'дальше идём', 'новый финал']);
  expect(replaced.lines[0].sec).toBe('Куплет');
  expect(replaced.lines[2].sec).toBe('Припев');
});

test('Genius import: undo of first import stays empty after reload', async ({ page }) => {
  let project: { lines: unknown[]; meta: typeof fixture.meta; v: number } = { ...fixture, lines: [] }, rev = 1, acceptWrites = false;
  await page.route('**/api/project**', async route => {
    if (route.request().method() === 'PUT') {
      if (acceptWrites) project = route.request().postDataJSON();
      await route.fulfill({ json: { rev: ++rev } });
    } else await route.fulfill({ json: { rev, by: 'page', project } });
  });
  await page.route('https://lrclib.net/api/search?*', route => route.fulfill({ json: [] }));
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('empty-fixture-ready')) {
      localStorage.clear(); sessionStorage.setItem('empty-fixture-ready', '1');
    }
  });
  await page.reload();
  await expect(page.locator('#nav-text')).toBeDisabled();
  acceptWrites = true;
  await page.locator('#gq').fill('Test song');
  await page.locator('#btnGenius').click();
  await page.locator('#gres .item').click();
  await page.locator('#btnGeniusAll').click();
  await expect(page.locator('#nav-text em')).toHaveText('4');
  await page.locator('#btnGeniusUndo').click();
  await expect(page.locator('#nav-text')).toBeDisabled();
  await expect.poll(() => project.lines.length).toBe(0);
  await page.reload();
  await expect(page.locator('#nav-text')).toBeDisabled();
});

test('Genius regional restriction: pasted browser text previews safely and supports rollback', async ({ page, request }) => {
  const error = geniusAccessError('<title>Not Available in Your Region | Genius</title>');
  await page.route('**/api/genius/lyrics?*', route => route.fulfill({ status: 502, json: { error } }));
  await page.locator('#gres .item').click();
  await expect(page.locator('.genius .status')).toContainText('регион');
  await page.locator('#btnGeniusPaste').click();
  await page.locator('#geniusPaste').fill('[Куплет]\nморе, песок\nлишняя строка\nдальше идём');
  await page.locator('#btnGeniusPastePreview').click();
  await expect(page.locator('.genius .status')).toContainText('Проект не изменён');
  expect((await (await request.get('/api/project')).json()).project).toEqual(fixture);
  await page.locator('#geniusMode').selectOption('edit');
  await page.locator('#btnGeniusAll').click();
  await expect.poll(async () => (await (await request.get('/api/project')).json()).project.lines[0].text).toBe('мо|ре, песок');
  await page.locator('#btnGeniusUndo').click();
  await expect.poll(async () => (await (await request.get('/api/project')).json()).project.lines[0].text).toBe('мо|ре песок');
});
