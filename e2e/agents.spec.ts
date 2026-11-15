import { expect, test } from '@playwright/test';
test.use({storageState:{cookies:[],origins:[]}});
const lines = [
 {t:1,end:4,text:'первый голос',tr:'first voice',approved:{orig:true},sync:{orig:[{a:1,b:2},{a:2,b:4}]}},
 {t:5,end:8,text:'второй голос',tr:'second voice',sync:{orig:[{a:5,b:6},{a:6,b:8}]}},
 {t:9,end:12,text:'третий голос',tr:'third voice',sync:{orig:[{a:9,b:10},{a:10,b:12}]}},
];
const wordLine={t:1,end:4,text:'первый тихий голос',tr:'first quiet voice',sync:{orig:[{a:1,b:2},{a:2,b:3},{a:3,b:4}],tr:[{a:1,b:2},{a:2,b:3},{a:3,b:4}]}};
test.beforeEach(async({page,request},info)=>{
 await request.put('/api/project?by=page',{data:{v:1,meta:{title:'Singers',artist:'Test',lang:'ru',mode:'original',md:[]},lines:info.title.startsWith('word-only')?[wordLine]:lines}});
 await page.addInitScript(()=>{localStorage.setItem('helpSeen','1');localStorage.setItem('sylMem','0');});
 await page.setViewportSize({width:1440,height:900});await page.goto('/');await page.locator('#nav-sync').click();
});
test('right-click preserves selected rows, supports all singers, persists and undoes once',async({page,request})=>{
 const current=async()=>(await(await request.get('/api/project')).json()).project.lines;
 await page.getByRole('checkbox',{name:'Выбрать строку 1',exact:true}).check();await page.getByRole('checkbox',{name:'Выбрать строку 2',exact:true}).check();
 await page.locator('#ln0 .compact-text').first().click({button:'right'});
 await expect(page.getByRole('menu')).toHaveAttribute('aria-label','Исполнитель · строк: 2');
 await page.getByRole('menuitemradio',{name:'1+2 — Вместе',exact:true}).click();
 await expect.poll(async()=>(await current()).map((l:any)=>l.agent||'v1')).toEqual(['v1000','v1000','v1']);
 expect((await current()).map(({agent,...l}:any)=>l)).toEqual(lines);
 await page.keyboard.press('Control+z');await expect.poll(current).toEqual(lines);
 await page.locator('#ln2 .compact-text').first().click({button:'right'});await page.getByRole('menuitemradio',{name:'2 — Исполнитель 2',exact:true}).click();
 await expect.poll(async()=>(await current())[2].agent).toBe('v2');await page.reload();await page.locator('#nav-sync').click();
 await page.locator('#ln2 .compact-text').first().click({button:'right'});await expect(page.getByRole('menuitemradio',{name:'2 — Исполнитель 2',exact:true})).toHaveAttribute('aria-checked','true');
 await page.getByRole('menuitemradio',{name:'1 — Исполнитель 1',exact:true}).click();await expect.poll(current).toEqual(lines);
});
test('right-click on selected words uses every represented row; Escape and outside dismiss without changes',async({page,request})=>{
 const current=async()=>(await(await request.get('/api/project')).json()).project.lines;
 await page.getByRole('button',{name:'Прежний вид',exact:true}).click();
 await page.locator('#btnEditorCommands').click();
 await page.locator('#syncLines .chip[data-a="1"]').click();await page.locator('#syncLines .chip[data-a="5"]').click({modifiers:['Control']});
 await expect(page.locator('#selectionBar')).toContainText('Выбрано слов: 2');
 await page.locator('#syncLines .chip[data-a="1"]').click({button:'right'});
 await expect(page.getByRole('menu')).toHaveAttribute('aria-label','Исполнитель · строк: 2');await page.keyboard.press('Escape');await expect(page.getByRole('menu')).toHaveCount(0);expect(await current()).toEqual(lines);
 await page.locator('#syncLines .chip[data-a="1"]').click({button:'right'});await page.keyboard.press('End');await page.keyboard.press('ArrowUp');await page.keyboard.press('Enter');
 await expect.poll(async()=>(await current()).map((l:any)=>l.agent||'v1')).toEqual(['v2','v2','v1']);
 await page.locator('#syncLines .chip[data-a="1"]').click({button:'right'});await page.locator('#nav-sync').click();await expect(page.getByRole('menu')).toHaveCount(0);
});
test('timeline word context menu changes singer without moving the word',async({page,request})=>{
 const current=async()=>(await(await request.get('/api/project')).json()).project.lines;
 const wave=(await page.locator('#wave').boundingBox())!;
 await page.mouse.click(wave.x+210,wave.y+20,{button:'right'});
 await expect(page.getByRole('menu')).toHaveAttribute('aria-label','Исполнитель · строк: 1');
 await page.getByRole('menuitemradio',{name:'2 — Исполнитель 2',exact:true}).click();
 await expect.poll(async()=>(await current())[0].agent).toBe('v2');expect((await current())[0].sync).toEqual(lines[0].sync);
 await page.screenshot({path:test.info().outputPath('singer-timeline.png')});
});
test('word-only assignment splits a phrase and parallel translation, preserves spans, reloads and undoes once',async({page,request})=>{
 const line=wordLine;
 const current=async()=>(await(await request.get('/api/project')).json()).project.lines;
 const wave=(await page.locator('#wave').boundingBox())!;await page.mouse.click(wave.x+350,wave.y+20,{button:'right'});
 await page.getByRole('menuitem',{name:'Только слова: Исполнитель 2',exact:true}).click();
 await expect.poll(async()=>(await current()).map((l:any)=>[l.text,l.agent||'v1'])).toEqual([['первый','v1'],['тихий','v2'],['голос','v1']]);
 expect((await current()).flatMap((l:any)=>l.sync.orig)).toEqual(line.sync.orig);expect((await current()).map((l:any)=>l.tr)).toEqual(['first','quiet','voice']);
 await page.keyboard.press('Control+z');await expect.poll(current).toEqual([line]);
 await page.mouse.click(wave.x+350,wave.y+20,{button:'right'});await page.getByRole('menuitem',{name:'Только слова: Вместе 1+2',exact:true}).click();
 await expect.poll(async()=>(await current()).length).toBe(3);await page.reload();await expect.poll(async()=>(await current())[1].agent).toBe('v1000');
});
test('classic text editor resets and saves singer-only drafts without altering words',async({page,request})=>{
 const current=async()=>(await(await request.get('/api/project')).json()).project.lines;
 await page.getByRole('button',{name:'Прежний вид',exact:true}).click();await page.locator('#ln0 .t').click();await page.locator('#pl0').dblclick();
 await page.locator('#previewAgent').selectOption('v2');await page.locator('#btnPreviewReset').click();await expect(page.locator('#previewAgent')).toHaveValue('v1');
 await page.locator('#previewAgent').selectOption('v1000');await page.locator('#btnPreviewSave').click();
 await expect.poll(async()=>(await current())[0].agent).toBe('v1000');expect((await current())[0].sync).toEqual(lines[0].sync);expect((await current())[0].text).toBe(lines[0].text);
 await page.keyboard.press('Control+z');await expect.poll(current).toEqual(lines);
});
test('preview singer is a draft: Cancel discards it; Save and undo include text and singer together',async({page,request})=>{
 const current=async()=>(await(await request.get('/api/project')).json()).project.lines;
 await page.locator('#ln0 .t').click();await page.locator('#btnStageEditText').click();
 const draft=page.getByRole('group',{name:'Исполнитель строки в правке',exact:true});
 await draft.getByRole('button',{name:'Исполнитель 2',exact:true}).click();await expect(draft.getByRole('button',{name:'Исполнитель 2',exact:true})).toHaveAttribute('aria-pressed','true');
 expect(await current()).toEqual(lines);await page.locator('#btnPreviewCancel').click();expect(await current()).toEqual(lines);
 await page.locator('#btnStageEditText').click();await page.locator('#previewEditText').fill('первый певец');await draft.getByRole('button',{name:'Вместе 1+2',exact:true}).click();await page.locator('#btnPreviewSave').click();
 await expect.poll(async()=>(await current())[0].agent).toBe('v1000');expect((await current())[0].text).toBe('первый певец');
 await page.keyboard.press('Control+z');await expect.poll(current).toEqual(lines);
 await page.locator('#btnStageEditText').click();await draft.getByRole('button',{name:'Исполнитель 2',exact:true}).click();await page.locator('#btnPreviewSave').click();
 await expect.poll(async()=>(await current())[0].agent).toBe('v2');expect((await current())[0].sync).toEqual(lines[0].sync);
});
