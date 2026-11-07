import { expect, test } from '@playwright/test';

const line = { t: 1, end: 4, text: 'а|-а|-а – да', tr: '', sync: { orig: [{a:1,b:1.5},{a:1.5,b:2},{a:2,b:2.5},{a:2.5,b:3},{a:3,b:4}] } };
test('export review cancels, applies a fix, exports fresh XML and supports undo', async ({page, request}) => {
  await request.put('/api/project?by=page', {data: {v:1,meta:{title:'Lint',artist:'Test',lang:'ru',mode:'original',md:[]},lines:[line]}});
  await page.addInitScript(() => localStorage.setItem('helpSeen','1'));
  await page.goto('/'); await page.locator('#nav-export').click(); await page.locator('#btnShow').click();
  const dialog = page.locator('#exportPreflight'); await expect(dialog).toBeVisible();
  await page.screenshot({path:test.info().outputPath('export-review.png')});
  await dialog.getByRole('button',{name:'Отмена',exact:true}).click(); await expect(page.locator('#out')).toBeHidden();
  await page.locator('#btnShow').click(); await dialog.getByRole('button',{name:'Исправить знаки без изменения времени'}).click();
  await page.locator('#btnExportAnyway').click();
  await expect(page.locator('#out')).toContainText('а-</span><span'); await expect(page.locator('#out')).not.toContainText('>-а');
  const project = async () => (await (await request.get('/api/project')).json()).project;
  await expect.poll(async () => (await project()).lines[0].text).toBe('а-|а-|а — да');
  expect((await project()).lines[0].sync.orig).toEqual(line.sync.orig);
  await page.locator('body').click({position:{x:5,y:5}}); await page.keyboard.press('Control+z');
  await expect.poll(async () => (await project()).lines[0].text).toBe(line.text);
});

test('word split can be applied to repeat lines with separate timings and undone together', async ({page,request}) => {
  const lines = [1,10].map(t => ({t,end:t+3,text:'музыку',tr:'',sync:{orig:[{a:t,b:t+3}]}}));
  await request.put('/api/project?by=page',{data:{v:1,meta:{title:'Repeats',artist:'Test',lang:'ru',mode:'original',md:[]},lines}});
  await page.addInitScript(() => localStorage.setItem('helpSeen','1'));
  await page.setViewportSize({width:1600,height:1000});
  await page.goto('/'); await page.locator('#nav-sync').click(); await page.locator('#ln0 .compact-text').first().click();
  await page.locator('#btnQuickSyllables').click(); await expect(page.locator('#syllableText')).toBeVisible(); await page.getByRole('checkbox',{name:'Применить к одинаковым строкам на этой дорожке'}).check();
  await page.locator('#btnApplySyllables').click();
  const project = async () => (await (await request.get('/api/project')).json()).project;
  await expect.poll(async () => (await project()).lines.map((l:any) => l.text)).toEqual(['му|зы|ку','му|зы|ку']);
  expect((await project()).lines[1].sync.orig.at(-1).b).toBe(13);
  await page.getByRole('button',{name:'Отменить',exact:true}).click();
  await expect.poll(async () => (await project()).lines.map((l:any) => l.text)).toEqual(['музыку','музыку']);
});
