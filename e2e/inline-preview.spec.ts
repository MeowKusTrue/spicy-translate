import {expect,test} from '@playwright/test';
test.use({storageState:{cookies:[],origins:[]}});
const line={t:1,end:5,text:'ти|хое мо|ре',tr:'',sync:{orig:[{a:1,b:2},{a:2,b:3},{a:3,b:4},{a:4,b:5}],bgo:[{a:1.5,b:2.5}]},bg:{text:'эх',tr:''}};
test.beforeEach(async({page,request})=>{
 await request.put('/api/project?by=page',{data:{v:1,meta:{title:'Inline preview',artist:'Test',lang:'ru',mode:'original',md:[]},lines:[line,{t:6,end:8,text:'сле|дом',tr:'',sync:{orig:[{a:6,b:7},{a:7,b:8}]}}]}});
 await page.addInitScript(()=>{localStorage.setItem('helpSeen','1');localStorage.setItem('sylMem','0');localStorage.setItem('theme','dark');});
 await page.setViewportSize({width:1440,height:900});await page.goto('/');await page.locator('#nav-sync').click();await page.locator('#ln0 .t').click();
});
test('whole line edits in place with visible pipes, stable position, timing and backing',async({page,request})=>{
 await page.locator('#lyrIn').evaluate(async e=>{await Promise.all(e.getAnimations().map(a=>a.finished.catch(()=>{})));});
 const row=page.locator('#pl0'), before=await row.boundingBox(), scroll=await page.locator('#lyrIn').evaluate(e=>getComputedStyle(e).transform);
 await page.locator('#btnStageEditText').click();const input=page.locator('#previewEditText');
 await expect(input).toHaveText('ти|хое мо|ре');await expect(page.locator('.preview-edit')).toHaveCount(0);
 expect(await input.evaluate(e=>getComputedStyle(e).webkitTextFillColor)).not.toBe('rgba(0, 0, 0, 0)');
 await page.screenshot({path:test.info().outputPath('inline-line.png')});
 const after=await row.boundingBox();expect(Math.abs(after!.y-before!.y)).toBeLessThan(2);
 expect(await page.locator('#lyrIn').evaluate(e=>getComputedStyle(e).transform)).toBe(scroll);
 await expect(page.locator('#pl1')).toBeVisible();
 await input.fill('ти|хое мо|ря');await input.press('Enter');await expect(input).toHaveCount(0);
 const project=async()=>(await(await request.get('/api/project')).json()).project;
 await expect.poll(async()=>(await project()).lines[0].text).toBe('ти|хое мо|ря');
 expect((await project()).lines[0].sync.orig).toEqual(line.sync.orig);expect((await project()).lines[0].sync.bgo).toEqual(line.sync.bgo);
 await page.keyboard.press('Control+z');await expect.poll(async()=>(await project()).lines[0].text).toBe(line.text);
});
test('double-click syllable edits only its complete word and keeps other syllables and timing',async({page,request})=>{
 await page.locator('#pl0>.w').nth(2).dblclick();const input=page.locator('#previewEditText');await expect(input).toHaveText('мо|ре');
 await expect(page.locator('#pl0>.w')).toHaveCount(2);await expect(page.locator('#pl0 .bg')).toHaveText('эх');
 await page.screenshot({path:test.info().outputPath('inline-word.png')});
 await input.fill('мо|ря');await input.press('Enter');
 const project=async()=>(await(await request.get('/api/project')).json()).project;
 await expect.poll(async()=>(await project()).lines[0].text).toBe('ти|хое мо|ря');
 expect((await project()).lines[0].sync.orig).toEqual(line.sync.orig);
});
test('cancel, invalid boundaries and Tab navigation retain visible source splits',async({page,request})=>{
 await page.locator('#btnStageEditText').click();const input=page.locator('#previewEditText');
 await input.fill('ти||хое мо|ре');await input.press('Enter');await expect(page.locator('#previewEditError')).toContainText('внутри слова');
 await input.press('Escape');await expect(input).toHaveCount(0);
 await page.locator('#btnStageEditText').click();await expect(input).toHaveText(line.text);await input.press('Tab');
 await expect(input).toHaveText('сле|дом');await input.press('Escape');
 expect((await(await request.get('/api/project')).json()).project.lines[0].text).toBe(line.text);
});
test('background word editing never changes main text',async({page,request})=>{
 await page.locator('#pl0 .bg>.w').dblclick();const input=page.locator('#previewEditText');await expect(input).toHaveText('эх');
 await input.fill('ах');await input.press('Enter');
 await expect.poll(async()=>(await(await request.get('/api/project')).json()).project.lines[0].bg.text).toBe('ах');
 expect((await(await request.get('/api/project')).json()).project.lines[0].text).toBe(line.text);
});

test('first timeline click saves the inline draft with its pipes',async({page,request})=>{
 await page.locator('#btnStageEditText').click();const input=page.locator('#previewEditText');
 await input.fill('ти|хое мо|ря');await expect(page.locator('#wave')).toHaveCSS('pointer-events','auto');
 const box=(await page.locator('#wave').boundingBox())!;await page.mouse.click(box.x+100,box.y+10);
 await expect(input).toHaveCount(0);
 await expect.poll(async()=>(await(await request.get('/api/project')).json()).project.lines[0].text).toBe('ти|хое мо|ря');
});

test('creating an empty backing never hides or erases the lead',async({page,request})=>{
 await page.locator('#ln1 .t').click();await page.locator('#segBg').click();await page.locator('#btnStageEditText').click();
 const input=page.locator('#previewEditText');await expect(page.locator('#pl1>.w')).toHaveCount(2);
 await input.fill('э|хо');await input.press('Enter');
 await expect.poll(async()=>(await(await request.get('/api/project')).json()).project.lines[1].bg?.text).toBe('э|хо');
 expect((await(await request.get('/api/project')).json()).project.lines[1].text).toBe('сле|дом');
});
