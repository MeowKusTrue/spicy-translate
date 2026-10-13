import { expect, test } from '@playwright/test';

// made-up lines, not real lyrics
const LRC = '[00:01.00]paper lanterns drifting\n[00:04.00]over quiet water\n[00:07.00]morning comes again';

test('load, F/G/H, join/syllables, export TTML', async ({ page }) => {
  await page.goto('/');
  await page.getByText('Вставить LRC / текст вручную').click();
  await page.locator('#manual').fill(LRC);
  await page.locator('#btnManual').click();
  await expect(page.locator('#lines .ln')).toHaveCount(3);
  await page.locator('#mTitle').fill('Lanterns');
  await page.locator('#mArtist').fill('Nobody');
  // translation of line 1 with a pre-split syllable
  await page.locator('#ln0 input.tr').fill('бумажные фо|на|ри плывут');

  await page.locator('#btnDock').click();
  await page.locator('#help #helpClose').click();
  await page.locator('#layer').selectOption('tr');
  await page.locator('#syncLines .chip', { hasText: 'бумажные' }).click();

  // mark: F on word 1, G through the syllables, H at the end (virtual clock, no audio)
  await page.keyboard.press('Space');
  for (const k of ['f', 'g', 'g', 'g', 'g', 'h']) { await page.keyboard.press(k); await page.waitForTimeout(80); }
  await page.keyboard.press('Space');
  await expect(page.locator('#syncLines .sl.cur .chip.t')).toHaveCount(5);
  await expect(page.locator('#syncStat')).toContainText('синхронизировано строк: 1/3');

  // join "фо|на" (syllables) and glue two words with M, then split one back with U
  await page.locator('#syncLines .chip', { hasText: /^фо$/ }).click();
  await page.keyboard.press('m');
  await expect(page.locator('#ln0 input.tr')).toHaveValue('бумажные фона|ри плывут');
  await page.locator('#syncLines .chip', { hasText: 'бумажные' }).click();
  await page.keyboard.press('m');
  await expect(page.locator('#syncLines .chip.grp')).toHaveText('бумажные фона');
  await page.keyboard.press('u');
  await expect(page.locator('#syncLines .chip.grp')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(page.locator('#syncLines .chip.grp')).toHaveCount(1);

  // export (the fixed dock covers the export card, close it first)
  await page.locator('#btnDockClose').click();
  await page.locator('#btnShow').click();
  const ttml = await page.locator('#out').textContent();
  expect(ttml).toContain('itunes:timing="Word"');
  expect(ttml).toMatch(/<span [^>]+>бумажные фона<\/span><span [^>]+>ри<\/span> <span [^>]+>плывут<\/span>/);
  const parseErr = await page.evaluate(x => new DOMParser().parseFromString(x!, 'application/xml').getElementsByTagName('parsererror').length, ttml);
  expect(parseErr).toBe(0);
  const dl = page.waitForEvent('download');
  await page.locator('#btnDl').click();
  expect((await dl).suggestedFilename()).toBe('Nobody - Lanterns (ru).ttml');

  // autosave + live-link: the server sees the project
  await expect.poll(async () => (await (await page.request.get('/api/project')).json()).project?.meta?.title).toBe('Lanterns');
});
