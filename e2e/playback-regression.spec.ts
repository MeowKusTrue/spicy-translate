import { expect, test } from '@playwright/test';
const fixture = { v: 1, meta: { title: 'Playback regression', artist: 'Test', lang: 'ru', mode: 'original', md: [] }, lines: [
 { t: 1, end: 7, text: 'тихое море', tr: '', bg: { text: 'эй', tr: 'hey' }, sync: { orig: [{ a: 1, b: 3 }, { a: 3, b: 7 }], bgo: [{ a: 2, b: 3 }], bg: [{ a: 2, b: 3 }] } },
 { t: 8, end: 14, text: 'новая строка', tr: '', sync: { orig: [{ a: 8, b: 10 }, { a: 10, b: 14 }] } },
] };
test.beforeEach(async ({ page, request }) => {
 await request.put('/api/project?by=page', { data: fixture });
 await page.addInitScript(() => { localStorage.setItem('helpSeen','1'); localStorage.setItem('dockH','340'); });
 await page.setViewportSize({ width: 1600, height: 1000 }); await page.goto('/'); await page.evaluate(() => document.documentElement.classList.add('app')); await page.locator('#nav-sync').click();
});
test('menus close on outside click, Escape and action; backing deletion is undoable', async ({ page, request }) => {
 const menu = page.locator('#ln0 .compact-menu'), summary = menu.locator('summary');
 await summary.click(); await expect(menu).toHaveAttribute('open','');
 await page.locator('.preview-edit-hint').click(); await expect(menu).not.toHaveAttribute('open');
 await summary.click(); await page.keyboard.press('Escape'); await expect(menu).not.toHaveAttribute('open');
 await summary.click(); await menu.getByRole('button',{name:'Голос:',exact:false}).click(); await expect(menu).not.toHaveAttribute('open');
 await page.getByRole('button',{name:'Удалить бэк строки 1',exact:true}).click();
 const project = async () => (await (await request.get('/api/project')).json()).project;
 await expect.poll(async () => (await project()).lines[0].bg).toBeUndefined();
 expect((await project()).lines[0].sync.orig).toEqual(fixture.lines[0].sync.orig);
 await page.getByRole('button',{name:'Отменить',exact:true}).click();
 await expect.poll(async () => (await project()).lines[0].bg).toEqual(fixture.lines[0].bg);
 expect((await project()).lines[0].sync.bgo).toEqual(fixture.lines[0].sync.bgo);
});
test('real pointer scrub works paused and playing, then Space toggles play once', async ({ page }) => {
 await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
 const canvasBefore = await page.locator('#wave').evaluate((el: HTMLCanvasElement) => el.toDataURL());
 const slider = page.locator('#seek'); const b = (await slider.boundingBox())!;
 await page.mouse.move(b.x + b.width*.15,b.y+b.height/2); await page.mouse.down(); await page.mouse.move(b.x+b.width*.65,b.y+b.height/2,{steps:15}); await page.mouse.up();
 await expect(page.locator('#clock')).toContainText('0:10');
 await expect.poll(() => page.locator('#wave').evaluate((el: HTMLCanvasElement) => el.toDataURL())).not.toBe(canvasBefore);
 await page.keyboard.press('Space'); await expect(page.locator('#btnPlay')).toHaveText('❚❚');
 await page.mouse.move(b.x+b.width*.65,b.y+b.height/2); await page.mouse.down(); await page.mouse.move(b.x+b.width*.25,b.y+b.height/2,{steps:15}); await page.mouse.up();
 await expect(page.locator('#clock')).toContainText('0:04');
 await page.keyboard.press('Space'); await expect(page.locator('#btnPlay')).toHaveText('▶');
 await page.locator('#nav-track').click(); await page.keyboard.press('Space'); await expect(page.locator('#btnPlay')).toHaveText('❚❚');
 await page.keyboard.press('Space'); await expect(page.locator('#btnPlay')).toHaveText('▶');
});
test('space types normally in text fields and works after saving or cancelling edits', async ({ page }) => {
 await page.locator('#ln0 .t').click(); await page.locator('#pl0').dblclick();
 await page.locator('#previewEditText').fill('тихое'); await page.keyboard.press('Space'); await page.keyboard.type('море');
 await expect(page.locator('#previewEditText')).toHaveText('тихое море'); await expect(page.locator('#btnPlay')).toHaveText('▶');
 await page.keyboard.press('Enter'); await page.keyboard.press('Space'); await expect(page.locator('#btnPlay')).toHaveText('❚❚');
 await page.keyboard.press('Space'); await expect(page.locator('#btnPlay')).toHaveText('▶');
});
