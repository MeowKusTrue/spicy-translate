import {expect, test} from '@playwright/test';

test.use({storageState:{cookies:[],origins:[]}});
const lines=[
  {t:1,end:5,text:'Небо в ночи',tr:'Sky at night',sync:{orig:[{a:1,b:2},{a:2,b:2.3},{a:2.3,b:5}]}},
  {t:5.5,end:9,text:'малиновый рассвет',tr:'Crimson sunrise',sync:{orig:[{a:5.5,b:7},{a:7,b:9}]}},
  {t:10,end:13,text:'Лето дарит мысли',tr:'',sync:{orig:[{a:10,b:11},{a:11,b:12},{a:12,b:13}]}}
];
test.beforeEach(async({page,request})=>{
  await request.put('/api/project?by=page',{data:{v:1,meta:{title:'Малиновый рассвет',artist:'Эндшпиль',lang:'ru',mode:'original',md:[]},lines}});
  await page.addInitScript(()=>{localStorage.setItem('helpSeen','1');localStorage.setItem('theme','dark');});
  await page.setViewportSize({width:1440,height:900});await page.goto('/');await page.locator('#nav-sync').click();
});

test('new default has focused actions, classic switch persists and karaoke settings/content survive',async({page})=>{
  await expect(page.locator('html')).toHaveAttribute('data-layout','studio');
  await expect(page.locator('#btnStudioExport')).toHaveText('Проверить и экспортировать');
  await expect(page.locator('#btnFitEveryLine')).toBeHidden();
  await expect(page.locator('#syncLines')).toBeHidden();
  await expect(page.locator('#btnEditorCommands')).toBeVisible();
  await page.locator('#ln0 .t').click();
  await expect(page.locator('#btnStageEditText')).toBeVisible();
  const glyphs=await page.locator('#pl0 .lt').count();expect(glyphs).toBeGreaterThan(0);
  await page.locator('.stset>summary').click();await expect(page.locator('#fxChk')).toBeChecked();await page.keyboard.press('Escape');
  await page.locator('#btnWorkspaceLayout').click();await expect(page.locator('html')).toHaveAttribute('data-layout','classic');
  await expect(page.locator('#btnStudioExport')).toHaveText('Экспорт TTML');
  expect(await page.locator('#pl0 .lt').count()).toBe(glyphs);
  await page.reload();await expect(page.locator('html')).toHaveAttribute('data-layout','classic');
  await page.locator('#btnWorkspaceLayout').click();await expect(page.locator('html')).toHaveAttribute('data-layout','studio');
  await page.locator('.stset>summary').click();await expect(page.locator('#fxChk')).toBeChecked();
});

test('tools retain advanced actions and selected text can be edited without touching other words',async({page,request})=>{
  await page.locator('#ln0 .t').click();
  const before = await page.locator('.stage').boundingBox();
  await page.locator('#btnEditorCommands').click();
  await expect(page.locator('#editorCommands')).toBeVisible();await expect(page.locator('#btnFitEveryLine')).toBeVisible();
  await expect(page.locator('#syncLines')).toBeVisible();
  const after = await page.locator('.stage').boundingBox();expect(after!.height).toBeGreaterThanOrEqual(before!.height - 8);
  await page.keyboard.press('Escape');await expect(page.locator('#editorCommands')).toBeHidden();
  await page.locator('#btnStageEditText').click();await expect(page.locator('#previewEditText')).toHaveText('Небо в ночи');
  await page.locator('#previewEditText').fill('Небо в тиши');await page.locator('#btnPreviewSave').click();
  await expect.poll(async()=>(await(await request.get('/api/project')).json()).project.lines[0].text).toBe('Небо в тиши');
  const saved=(await(await request.get('/api/project')).json()).project;
  expect(saved.lines[0].sync.orig[0]).toEqual(lines[0].sync.orig[0]);
  await page.locator('#btnStageExactTime').click();await expect(page.locator('#wordInspector')).toBeVisible();
});

test('project and language actions remain available and sidebar matches its accessible width',async({page})=>{
  await page.locator('.workspace-menu>summary').click();await page.locator('.workspace-menu #mode-bilingual').click();
  await expect(page.locator('#nav-tr')).toBeVisible();
  if (!await page.locator('.workspace-menu').evaluate(el=>(el as HTMLDetailsElement).open)) await page.locator('.workspace-menu>summary').click();
  await page.locator('.workspace-menu #mode-original').click();
  await expect(page.locator('#nav-tr')).toHaveCount(0);
  const grip=page.locator('#sidebarResize');await grip.focus();await grip.press('End');
  await expect(grip).toHaveAttribute('aria-valuenow','600');
  await expect.poll(async()=>Math.round((await page.locator('main>.col').first().boundingBox())!.width)).toBe(600);
  await grip.press('Home');await expect.poll(async()=>Math.round((await page.locator('main>.col').first().boundingBox())!.width)).toBe(180);
  await page.locator('#btnWorkspaceProjects').click();await expect(page.locator('#btnNewProject')).toBeVisible();
  await page.locator('#btnNewProject').click();await expect(page.locator('#snaps')).toContainText('Малиновый рассвет');
});

for(const size of [{width:1440,height:900},{width:1280,height:720}]) {
  test(`studio surfaces and editor fit ${size.width}x${size.height}`,async({page})=>{
    await page.setViewportSize(size);await page.locator('#ln0 .t').click();
    const stage=await page.locator('.stage').boundingBox(),dock=await page.locator('#dock').boundingBox();
    expect(stage!.height).toBeGreaterThan(230);expect(stage!.y+stage!.height).toBeLessThanOrEqual(dock!.y+2);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:test.info().outputPath('studio.png')});
    await page.locator('#btnStageEditText').click();await expect(page.locator('#previewEditText')).toBeVisible();
    const save=await page.locator('#btnPreviewSave').boundingBox(),player=await page.locator('.stage .player').boundingBox();
    expect(save!.y+save!.height).toBeLessThanOrEqual(player!.y+1);
    await page.locator('#btnPreviewCancel').click();await page.locator('#btnStudioExport').click();
    await expect(page.locator('#btnDl')).toBeVisible();
  });
}
