import { expect, test } from '@playwright/test';

const fixture = { v: 1, meta: { title: 'Backing fixture', artist: 'Test', lang: 'ru', mode: 'translation', md: [] }, lines: [
  { t: 0, end: 1, text: 'основная строка', tr: 'lead line', sync: { orig: [{ a: 0, b: .5 }, { a: .5, b: 1 }] } },
] };
function wav() {
  const b = Buffer.alloc(44 + 16000 * 2);
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(b.length - 44, 40);
  return b;
}

test('model choices reach the run; backing candidates require selection, preserve lead and undo', async ({ page, request }) => {
  await request.put('/api/project?by=page', { data: fixture });
  let started = false, query = '';
  await page.route('**/api/align', route => route.fulfill({ json: started
    ? { running: false, result: { ...fixture, backingCandidates: [{ t: .2, end: .8, text: '', tr: '', bg: { text: 'новый бэк', tr: '' }, sync: { bgo: [{ a: .2, b: .5, g: 1 }, { a: .5, b: .8, g: 1 }] } }] } }
    : { available: true, running: false } }));
  await page.route('**/api/align?*', route => { query = route.request().url(); started = true; return route.fulfill({ json: { ok: true } }); });
  await page.route('**/api/align/audio?*', route => route.fulfill({ json: { ok: true } }));
  await page.goto('/');
  await page.locator('input[type=file][accept="audio/*"]').first().setInputFiles({ name: 'test.wav', mimeType: 'audio/wav', buffer: wav() });
  await page.locator('#nav-sync').click();
  await page.locator('#helpClose').click();
  await page.locator('#btnAlignPanel').click();
  await page.locator('#alignSeparator').selectOption('roformer');
  await page.locator('#alignAsr').selectOption('large-v3');
  await page.locator('#alignModel').selectOption('mms');
  await page.locator('#alignDetectBack').check();
  await page.locator('#alignPanel .close').click();
  await page.locator('#btnAutoAlign').click();
  await expect(page.locator('#backingReview')).toBeVisible();
  expect(query).toContain('asr=large-v3'); expect(query).toContain('sep=roformer');
  expect(query).toContain('aligner=mms'); expect(query).toContain('detectBack=1');
  await expect(page.locator('#btnBackingApply')).toBeDisabled();
  expect((await (await request.get('/api/project')).json()).project.lines).toEqual(fixture.lines);
  await page.locator('#backingReview input[type=checkbox]').check();
  await page.locator('#btnBackingApply').click();
  await expect.poll(async () => (await (await request.get('/api/project')).json()).project.lines.length).toBe(2);
  expect((await (await request.get('/api/project')).json()).project.lines[0]).toEqual(fixture.lines[0]);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await (await request.get('/api/project')).json()).project.lines).toEqual(fixture.lines);
  await page.reload();
  await page.locator('#nav-sync').click();
  await page.locator('#btnAlignPanel').click();
  await expect(page.locator('#alignAsr')).toHaveValue('large-v3');
  await expect(page.locator('#alignDetectBack')).toBeChecked();
});

test('desktop asynchronous confirmation: Cancel prevents deleting the timing installation', async ({ page, request }) => {
  await request.put('/api/project?by=page', { data: fixture });
  let deletes = 0;
  await page.route('**/api/align/setup*', route => {
    if (route.request().method() === 'DELETE') deletes++;
    return route.fulfill({ json: { installed: true, external: false, backend: 'cpu', running: false } });
  });
  await page.addInitScript(() => {
    (window as any).confirm = async () => { await new Promise(r => setTimeout(r, 50)); (window as any).answered = true; return false; };
  });
  await page.goto('/');
  await page.locator('#nav-sync').click(); await page.locator('#helpClose').click();
  await page.locator('#btnAlignPanel').click();
  await page.locator('#btnAlignRemove').click();
  await expect.poll(() => page.evaluate(() => (window as any).answered)).toBe(true);
  expect(deletes).toBe(0);
  await expect(page.locator('#btnAlignRemove')).toBeVisible();
});
