import { expect, test, type Page, type APIRequestContext } from '@playwright/test';

async function seed(page:Page,request:APIRequestContext,lines:any[]) {
  await request.put('/api/project?by=page',{data:{v:1,meta:{title:'Usability',artist:'Test',lang:'ru',mode:'original',md:[]},lines}});
  await page.addInitScript(() => {localStorage.setItem('helpSeen','1');localStorage.setItem('sylMem','0');});
  await page.setViewportSize({width:1600,height:1000}); await page.goto('/');
}
const project = async (request:APIRequestContext) => (await (await request.get('/api/project')).json()).project;

test('lint cards identify lyrics, offer a draft and overlap shift, and navigate to the selected phrase', async ({page,request}) => {
  const lines = [{t:1,end:3.3,text:'Первая строка',tr:''},{t:3,end:5,text:'Вторая строка',tr:'',sync:{orig:[{a:3,b:4},{a:4,b:5}]}}];
  await seed(page,request,lines); await page.locator('#nav-export').click(); await page.locator('#btnShow').click();
  const dialog=page.locator('#exportPreflight'); await expect(dialog).toBeVisible();
  await expect(dialog.locator('blockquote').filter({hasText:'Первая строка'})).toBeVisible();
  const overlap=dialog.locator('.export-issue').filter({hasText:'начинается раньше конца'});
  await expect(overlap).toContainText('Предыдущая строка 1'); await expect(overlap).toContainText('Вторая строка');
  await page.screenshot({path:test.info().outputPath('actionable-lint.png')});
  await dialog.getByRole('button',{name:'Распределить неразмеченные слова (черновик)',exact:true}).click();
  await expect.poll(async ()=>(await project(request)).lines[0].sync?.orig?.length).toBe(2);
  await overlap.getByRole('button',{name:/Сдвинуть всю строку вправо/}).click();
  await expect.poll(async ()=>(await project(request)).lines[1].sync.orig[0].a).toBe(3.3);
  await dialog.getByRole('button',{name:'Открыть строку в редакторе'}).first().click();
  await expect(dialog).toHaveCount(0); await expect(page.locator('#nav-sync')).toHaveAttribute('aria-selected','true');
  await expect(page.locator('#ln0')).toHaveClass(/selected/);
  await page.getByRole('button',{name:'Отменить',exact:true}).click();
  await expect.poll(async ()=>(await project(request)).lines[1].sync.orig).toEqual(lines[1].sync!.orig);
});

test('intentional overlap can be confirmed without changing timing and stays confirmed for export',async ({page,request})=>{
  const lines=[{t:1,end:4,text:'Первый',tr:'',sync:{orig:[{a:1,b:4}]}},{t:3,end:5,text:'Второй',tr:'',sync:{orig:[{a:3,b:5}]}}];
  await seed(page,request,lines);await page.locator('#nav-export').click();await page.locator('#btnShow').click();
  await page.getByRole('button',{name:'Оставить наложение (так и задумано)'}).click();
  await expect(page.locator('#exportPreflight')).toContainText('Замечаний нет');await page.locator('#btnExportAnyway').click();
  await expect(page.locator('#out')).toContainText('Первый');expect((await project(request)).lines).toEqual(lines);
  await page.locator('#btnShow').click();await page.locator('#btnShow').click();await expect(page.locator('#exportPreflight')).toHaveCount(0);
});

test('inline editor labels track, reveals existing syllables, saves boundary removal and resets safely',async ({page,request})=>{
  const line={t:1,end:5,text:'ти|хое мо|ре',tr:'',sync:{orig:[{a:1,b:2},{a:2,b:3},{a:3,b:4},{a:4,b:5}]}};
  await seed(page,request,[line]);await page.locator('#nav-sync').click();await page.locator('#ln0 .t').click();await page.locator('#pl0').dblclick();
  await expect(page.locator('.preview-edit-header')).toContainText('Строка 1 · Оригинал');
  const input=page.locator('#previewEditText');await expect(input).toHaveText('тихое море');
  await page.locator('#btnPreviewMarkup').click();await expect(input).toHaveText('ти|хое мо|ре');
  await input.fill('ти|хое море');await expect(page.locator('.preview-edit-stats')).toContainText('Не сохранено');
  const saveBounds = await page.locator('#btnPreviewSave').boundingBox(), playerBounds = await page.locator('.stage .player').boundingBox();
  expect(saveBounds!.y + saveBounds!.height).toBeLessThanOrEqual(playerBounds!.y);
  await page.screenshot({path:test.info().outputPath('inline-editor.png')});
  await page.locator('#btnPreviewSave').click();await expect.poll(async ()=>(await project(request)).lines[0].text).toBe('ти|хое море');
  expect((await project(request)).lines[0].sync.orig.at(-1)).toMatchObject({a:3,b:5});
  await page.locator('#pl0').dblclick();await input.fill('Не сохранять');await page.locator('#btnPreviewReset').click();await expect(input).toHaveText('тихое море');
  await page.locator('#btnPreviewCancel').click();await expect.poll(async ()=>(await project(request)).lines[0].text).toBe('ти|хое море');
});

test('small preview keeps Save above the player and inserts a boundary at the caret',async ({page,request})=>{
  await seed(page,request,[{t:1,end:4,text:'море',tr:'',sync:{orig:[{a:1,b:4}]}}]);
  await page.setViewportSize({width:1280,height:720});await page.locator('#nav-sync').click();
  await page.locator('#ln0 .t').click({timeout:5000});
  await page.locator('#pl0').dblclick({timeout:5000});
  await expect(page.locator('#previewEditText')).toBeVisible();
  const input=page.locator('#previewEditText');await input.press('Home');await input.press('ArrowRight');await input.press('ArrowRight');
  await page.locator('#btnPreviewInsertBoundary').click();await expect(input).toHaveText('мо|ре');
  const save=await page.locator('#btnPreviewSave').boundingBox(),player=await page.locator('.stage .player').boundingBox();
  await page.screenshot({path:test.info().outputPath('inline-editor-small.png')});
  expect(save!.y+save!.height).toBeLessThanOrEqual(player!.y);
  await page.locator('#btnPreviewSave').click();await expect.poll(async ()=>(await project(request)).lines[0].text).toBe('мо|ре');
});
