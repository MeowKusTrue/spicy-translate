import { expect,test } from '@playwright/test';
const fixture={v:1,meta:{title:'Montage',artist:'Test',mode:'original',lang:'ru',md:[]},lines:[{t:1,end:5,text:'тихое море',tr:'',bg:{text:'эй',tr:''},sync:{orig:[{a:1,b:3},{a:3,b:5}],bgo:[{a:2,b:3}]}},{t:6,end:9,text:'новая строка',tr:'',sync:{orig:[{a:6,b:7},{a:7,b:9}]}}]};
test.beforeEach(async({page,request})=>{await request.put('/api/project?by=page',{data:fixture});await page.addInitScript(()=>{localStorage.setItem('helpSeen','1');localStorage.setItem('dockH','440');});await page.setViewportSize({width:1600,height:1000});await page.goto('/');await page.evaluate(()=>document.documentElement.classList.add('app'));await page.locator('#nav-sync').click();});
test('montage keeps the full-width preview while exact timing opens next to the lower canvas',async({page,request})=>{
 await expect(page.locator('#wordInspector')).toHaveCount(0);const preview=(await page.locator('.stage').boundingBox())!;
 await page.locator('#syncLines .chip').first().click();await expect(page.locator('#timelineSelection')).toContainText('тихое');await expect(page.locator('#timelineWordTime')).toContainText('0:01.000');
 await page.locator('#timelineExactTime').click();await expect(page.locator('#wordInspector')).toBeVisible();expect((await page.locator('.stage').boundingBox())!.width).toBe(preview.width);expect((await page.locator('#wordInspector').boundingBox())!.y).toBeGreaterThan((await page.locator('#dock').boundingBox())!.y);
 await page.locator('#wordStart').fill('1.1');await page.locator('#btnWordApply').click();await expect.poll(async()=>(await(await request.get('/api/project')).json()).project.lines[0].sync.orig[0].a).toBe(1.1);
 await page.locator('#timelineExactTime').click();await expect(page.locator('#wordInspector')).toHaveCount(0);await page.getByRole('button',{name:'Следующее слово на таймлайне',exact:true}).click();await expect(page.locator('#timelineSelection')).toContainText('море');
 await page.reload();await expect(page.locator('#wordInspector')).toHaveCount(0);
});
test('keyboard resizes the dock; preview editing auto-saves before selecting the next word',async({page,request})=>{
 const grip=page.getByRole('separator',{name:'Высота таймлайна',exact:true}),before=(await page.locator('#dock').boundingBox())!.height;await grip.focus();await page.keyboard.press('ArrowUp');await expect.poll(async()=>(await page.locator('#dock').boundingBox())!.height).toBeGreaterThan(before);
 await page.locator('#ln0 .t').click();await page.locator('#pl0').dblclick();await page.locator('#previewEditText').fill('тихое синее море');await page.getByRole('button',{name:'Следующее слово на таймлайне',exact:true}).click();await expect(page.locator('#previewEditText')).toHaveCount(0);await expect.poll(async()=>(await(await request.get('/api/project')).json()).project.lines[0].text).toBe('тихое синее море');await expect(page.locator('#timelineSelection')).toContainText('синее');
});
