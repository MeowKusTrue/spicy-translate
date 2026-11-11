import { expect, test } from '@playwright/test';

test.beforeEach(async ({page, request}) => {
  await request.put('/api/project?by=page', {data:{v:1,meta:{title:'Preview regression',artist:'Test',lang:'ru',mode:'original',md:[]},lines:[
    {t:1,end:4,text:'море',tr:'',sync:{orig:[{a:1,b:4}]}},
    {t:5,end:8,text:'небо',tr:'',sync:{orig:[{a:5,b:8}]}}
  ]}});
  await page.addInitScript(() => {localStorage.setItem('helpSeen','1');localStorage.setItem('sylMem','0');});
  await page.setViewportSize({width:1600,height:1000});await page.goto('/');await page.locator('#nav-sync').click();
  await page.locator('#ln0 .t').click();await page.locator('#pl0').dblclick();
});

test('boundary insertion rejects word edges and duplicate boundaries without corrupting text',async ({page})=>{
  const input=page.locator('#previewEditText');
  await input.press('End');await page.locator('#btnPreviewInsertBoundary').click();
  await expect(input).toHaveText('море');await expect(page.locator('#previewEditError')).toContainText('внутри слова');
  await input.press('Home');await input.press('ArrowRight');await input.press('ArrowRight');
  await page.locator('#btnPreviewInsertBoundary').click();await expect(input).toHaveText('мо|ре');
  await page.locator('#btnPreviewInsertBoundary').click();await expect(input).toHaveText('мо|ре');
});

test('composition Escape preserves editor and adjacent navigation validates and saves',async ({page,request})=>{
  const input=page.locator('#previewEditText');
  await input.dispatchEvent('keydown',{key:'Escape',isComposing:true,bubbles:true});await expect(input).toBeVisible();
  await input.fill('');await page.locator('#btnPreviewNext').click();
  await expect(page.locator('#previewEditError')).toContainText('Строка пуста');await expect(page.locator('.preview-edit-header')).toContainText('Строка 1');
  await input.fill('синее море');await page.locator('#btnPreviewNext').click();
  await expect(page.locator('.preview-edit-header')).toContainText('Строка 2');await expect(input).toHaveText('небо');
  await expect.poll(async ()=>(await (await request.get('/api/project')).json()).project.lines[0].text).toBe('синее море');
  await page.locator('#btnPreviewPrevious').click();await expect(input).toHaveText('синее море');
});
