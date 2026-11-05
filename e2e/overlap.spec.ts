import { expect, test } from '@playwright/test';

test('overlapping phrases have separate hit targets, edit independently, undo and export', async ({ page, request }) => {
  const fixture = { v: 1, meta: { title: 'Vocal overlap', artist: 'Two singers', lang: 'ru', mode: 'bilingual', md: [] }, lines: [
    { t: 0, end: 3, text: 'первый хвост', tr: '', agent: 'v1', sync: { orig: [{ a: 0, b: 1 }, { a: 1, b: 3 }] } },
    { t: 2, end: 5, text: 'второй голос', tr: '', agent: 'v2', sync: { orig: [{ a: 2, b: 3 }, { a: 3, b: 5 }] } },
  ] };
  await request.put('/api/project?by=page', { data: fixture });
  await page.addInitScript(() => {
    localStorage.setItem('lanes', JSON.stringify({ m: 88, b: 34, l: 26 }));
    localStorage.setItem('dockH', '500');
  });
  await page.goto('/');
  await page.locator('#nav-sync').click();
  await page.locator('#help #helpClose').click();
  await page.locator('#segMain').click();
  await page.locator('#segOrig').click();
  const canvas = page.locator('#wave');
  const box = (await canvas.boundingBox())!;
  const scale = Math.max(0.3, Math.min(1, (box.height - 17 - 9 - 40) / (88 + 34 + 26)));
  const rowHeight = Math.round(88 * scale) / 2;
  const firstY = box.y + 3 + rowHeight / 2, secondY = box.y + 3 + rowHeight * 1.5;
  // The exact same time points to different phrases depending on its row.
  await page.mouse.click(box.x + 2.4 * 140, secondY);
  await expect(page.locator('#syncLines .sl.cur .chip.sel')).toHaveText('второй');
  await page.mouse.click(box.x + 2.4 * 140, firstY);
  await expect(page.locator('#syncLines .sl.cur .chip.sel')).toHaveText('хвост');
  // Extend the first phrase beyond the second's start; the other singer must not move.
  await page.mouse.move(box.x + 3 * 140 - 1, firstY);
  await page.mouse.down();
  await page.mouse.move(box.x + 4.2 * 140, firstY, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await (await request.get('/api/project')).json()).project.lines[0].sync.orig[1].b).toBe(4.2);
  const imported = (await (await request.get('/api/project')).json()).project;
  expect(imported.lines[1].sync).toEqual(fixture.lines[1].sync);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await (await request.get('/api/project')).json()).project.lines[0].sync.orig[1].b).toBe(3);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(async () => (await (await request.get('/api/project')).json()).project.lines[0].sync.orig[1].b).toBe(4.2);
  await page.locator('#seek').evaluate(input => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '2.5');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.locator('#pl0')).toHaveClass(/act/);
  await expect(page.locator('#pl1')).toHaveClass(/act/);
  await expect(page.locator('#pl0')).toHaveCSS('--blur', '0px');
  await expect(page.locator('#pl1')).toHaveCSS('--blur', '0px');
  await page.screenshot({ path: test.info().outputPath('overlap-editor.png') });
  await page.locator('#nav-export').click();
  await page.locator('#btnShow').click();
  const times = await page.locator('#out').evaluate(output => {
    const xml = new DOMParser().parseFromString(output.textContent || '', 'application/xml');
    return [...xml.getElementsByTagName('p')].map(p => [p.getAttribute('begin'), p.getAttribute('end')]);
  });
  const seconds = (time: string | null) => Number(time?.split(':').at(-1));
  expect(seconds(times[0][1])).toBe(4.2);
  expect(seconds(times[1][0])).toBe(2);
});
