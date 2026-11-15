import {expect,test} from '@playwright/test';
test.use({storageState:{cookies:[],origins:[]}});
const line={t:1,end:4,text:'нам , пора !',tr:'',sync:{orig:[{a:1,b:2},{a:2,b:2.4},{a:2.5,b:3.5},{a:3.5,b:4}]}};
test.beforeEach(async({page,request})=>{
 await request.put('/api/project?by=page',{data:{v:1,meta:{title:'Punctuation',artist:'Test',lang:'ru',mode:'original',md:[]},lines:[line]}});
 await page.addInitScript(()=>{localStorage.setItem('helpSeen','1');localStorage.setItem('sylMem','0');});
 await page.goto('/');await page.locator('#nav-sync').click();await page.locator('#ln0 .t').click();
});
test('existing standalone punctuation is glued on load and inline input commits it without a prompt or retiming',async({page,request})=>{
 await expect(page.locator('#pl0>.w')).toHaveCount(2);await expect(page.locator('#ln0 .compact-text').first()).toHaveText('нам, пора!');
 await page.locator('#btnStageEditText').click();const input=page.locator('#previewEditText');await expect(input).toHaveText('нам, пора!');
 await input.fill('нам , пора ?');await input.press('Enter');await expect(input).toHaveCount(0);
 const current=async()=>(await(await request.get('/api/project')).json()).project.lines[0];
 await expect.poll(async()=>(await current()).text).toBe('нам, пора?');expect((await current()).sync.orig).toEqual([line.sync.orig[0],line.sync.orig[2]]);
 await page.keyboard.press('Control+z');await expect.poll(async()=>(await current()).text).toBe('нам, пора!');
 await page.reload();await page.locator('#nav-sync').click();await expect(page.locator('#ln0 .compact-text').first()).toHaveText('нам, пора!');
});
test('export has punctuation on the word, never a separate timed comma',async({page})=>{
 await page.locator('#nav-export').click();await page.locator('#btnShow').click();
 const dialog=page.locator('#exportPreflight');if(await dialog.isVisible())await page.locator('#btnExportAnyway').click();
 await expect(page.locator('#out')).toContainText('>нам,</span>');await expect(page.locator('#out')).not.toContainText('>,</span>');
});
