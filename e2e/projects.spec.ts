import { expect, test } from '@playwright/test';

const fixture = { v: 1, meta: { title: 'Previous project', artist: 'Sandbox', lang: 'ru', mode: 'original', md: [] }, lines: [{ t: 1, end: 4, text: 'previous project words', tr: 'translation' }] };
test.beforeEach(async ({ page, request }) => {
  await request.put('/api/project?by=page', { data: fixture });
  await page.addInitScript(() => localStorage.setItem('helpSeen', '1'));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showDirectoryPicker', { value: async () => ({
      name: 'sandbox-project-folder', queryPermission: async () => 'granted', requestPermission: async () => 'granted',
      async *entries() {}, getFileHandle: async () => ({ createWritable: async () => ({ write: async () => {}, close: async () => {} }) }),
    }) });
  });
  await page.goto('/');
  await page.locator('#nav-track').click();
});

test('new empty project is durable, keeps history and restores a previous project', async ({ page, request }) => {
  await page.locator('#btnNewProject').click();
  await expect.poll(async () => JSON.parse((await page.evaluate(() => localStorage.getItem('last')))!)).toMatchObject({ lines: [], meta: { title: '', artist: '' } });
  await expect(page.locator('#snaps')).toContainText('Previous project');
  // Simulate an older server state surviving while this browser is closed.
  await request.put('/api/project?by=page', { data: fixture });
  await page.reload();
  await expect(page.locator('#btnNewProject')).toBeVisible();
  await expect.poll(async () => (await (await request.get('/api/project')).json()).project.lines).toEqual([]);
  await expect(page.locator('#snaps')).toContainText('Previous project');
  await page.locator('#snaps .item').filter({ hasText: 'Previous project' }).first().getByRole('button', { name: 'Вернуть' }).click();
  await expect.poll(async () => (await (await request.get('/api/project')).json()).project.meta.title).toBe('Previous project');
  await expect(page.getByText('✓ аудио подключено', { exact: true })).toHaveCount(0);
});

test('new project detaches audio and folder; history does not inherit them', async ({ page }) => {
  const b = Buffer.alloc(44 + 16000 * 2 * 2);
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(b.length - 44, 40);
  await page.locator('#fileAudioCard').setInputFiles({ name: 'sandbox.wav', mimeType: 'audio/wav', buffer: b });
  await expect(page.getByText('✓ аудио и волна готовы', { exact: true })).toBeVisible();
  await page.locator('#nav-export').click();
  await page.locator('#btnFolderPick').click();
  await expect(page.locator('#projFolder')).toContainText('sandbox-project-folder');
  await page.locator('#exportPreflight').getByRole('button', { name: 'Отмена', exact: true }).click();
  await page.locator('#nav-track').click(); await page.locator('#btnNewProject').click();
  await expect(page.getByText('✓ аудио и волна готовы', { exact: true })).toHaveCount(0);
  await page.locator('#snaps .item').first().getByRole('button', { name: 'Вернуть' }).click();
  await expect(page.getByText('✓ аудио и волна готовы', { exact: true })).toHaveCount(0);
  await page.locator('#nav-export').click();
  await expect(page.locator('#btnFolderPick')).toBeVisible();
});

test('backup transaction failure leaves the current project intact', async ({ page }) => {
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args: Parameters<IDBDatabase['transaction']>) {
      if (args[0] === 'snaps' && args[1] === 'readwrite') throw new Error('Injected durable backup failure');
      return original.apply(this, args);
    };
  });
  await page.locator('#btnNewProject').click();
  await expect(page.locator('#st1')).toContainText('Новый проект не создан');
  await expect(page.locator('#st1')).toContainText('Injected durable backup failure');
  await page.reload();
  await page.locator('#nav-track').click();
  await page.locator('#btnSnapNow').click();
  await expect(page.locator('#snaps')).toContainText('Previous project');
});
