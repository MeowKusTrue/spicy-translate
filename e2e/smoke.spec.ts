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
  await page.locator('#segTr').click();
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

test('background vocals: (…) -> bg, bg-only line, delete + undo, word edit on the wave', async ({ page }) => {
  await page.goto('/');
  await page.getByText('Вставить LRC / текст вручную').click();
  await page.locator('#manual').fill('[00:01.00]paper lanterns (lanterns) drifting\n[00:04.00]over quiet water\n[00:08.00]');
  await page.locator('#btnManual').click();
  await page.locator('#btnParens').click();
  await expect(page.locator('#ln0 input.o')).toHaveValue('paper lanterns drifting');
  await expect(page.locator('#ln0 .bgrow input').first()).toHaveValue('lanterns');

  // a background-only line at the playhead (no lead line in the found lyrics)
  await page.locator('#btnAddBg').click();
  await page.locator('#ln0 .bgrow input').first().fill('ooh');
  await expect(page.locator('#lines .ln')).toHaveCount(3);
  await expect(page.locator('#lines .ln.bgonly')).toHaveCount(1);

  // delete a line, Ctrl+Z brings it back
  await page.locator('#ln2 .rowact button[title^="Удалить"]').click();
  await expect(page.locator('#lines .ln')).toHaveCount(2);
  await page.locator('#btnDock').click();
  await page.locator('#help #helpClose').click();
  await page.keyboard.press('Control+z');
  await expect(page.locator('#lines .ln')).toHaveCount(3);

  // E on the selected word opens the inline editor; a space adds a word
  await page.locator('#segMain').click(); // focusing the bg field switched the dock to the bg track
  await page.locator('#syncLines .chip', { hasText: 'over' }).click();
  await page.keyboard.press('e');
  await page.locator('input.wedit').fill('over and');
  await page.keyboard.press('Enter');
  await expect(page.locator('#ln2 input.o')).toHaveValue('over and quiet water');

  await page.locator('#btnDockClose').click();
  await page.locator('#btnShow').click();
  const ttml = await page.locator('#out').textContent();
  expect(ttml).toMatch(/<p [^>]+><span ttm:role="x-bg"><span [^>]+>ooh<\/span><\/span><\/p>/);
});

test('whole text, find & replace, chorus timing', async ({ page }) => {
  await page.goto('/');
  await page.getByText('Вставить LRC / текст вручную').click();
  await page.locator('#manual').fill('[00:01.00]hello moon\n[00:04.00]quiet water\n[00:07.00]hello moon\n[00:10.00]');
  await page.locator('#btnManual').click();

  // whole text: insert a line, add a background part, fix a word
  await page.locator('#btnFull').click();
  await page.locator('#fullTa').fill('hello moon\nnew line here\nquiet waters (oh)\nhello moon');
  await page.locator('#btnFullApply').click();
  await expect(page.locator('#lines .ln')).toHaveCount(4);
  await expect(page.locator('#ln1 input.o')).toHaveValue('new line here');
  await expect(page.locator('#ln2 input.o')).toHaveValue('quiet waters');
  await expect(page.locator('#ln2 .bgrow input').first()).toHaveValue('oh');

  // find & replace in the original
  await page.locator('#btnFind').click();
  await page.locator('#findWhere').selectOption('orig');
  await page.locator('#findQ').fill('HELLO');
  await expect(page.locator('#findN')).toHaveText('совпадений: 2');
  await page.locator('#findR').fill('hi');
  await page.locator('#btnReplace').click();
  await expect(page.locator('#ln3 input.o')).toHaveValue('hi moon');

  // mark line 1 on the original and copy its timing to the repeat with C
  await page.locator('#btnDock').click();
  await page.locator('#help #helpClose').click();
  await page.locator('#segOrig').click();
  await page.locator('#syncLines .chip', { hasText: 'hi' }).first().click();
  await page.keyboard.press('Space');
  for (const k of ['f', 'g', 'h']) { await page.keyboard.press(k); await page.waitForTimeout(120); }
  await page.keyboard.press('Space');
  await page.keyboard.press('c');
  // the repeat got the same word lengths, shifted by the line start difference (7 - 1 = 6 s), flagged auto
  await expect.poll(async () => {
    const ls = (await (await page.request.get('/api/project')).json()).project?.lines;
    const a = ls?.[0]?.sync?.orig, b = ls?.[3]?.sync?.orig;
    return a && b && !a.some((x: { g?: 1 }) => x.g) ? [Math.round((b[0].a - a[0].a) * 1000), Math.round((b[1].b - a[1].b) * 1000), b[0].g] : null;
  }).toEqual([6000, 6000, 1]);
});
