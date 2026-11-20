import {expect,test} from '@playwright/test';

test('full-width text editing carries word sync across line breaks, reloads and undoes',async({page,request})=>{
  const sync=[{a:1,b:2},{a:3,b:6},{a:7,b:8}];
  const project={v:1,meta:{title:'Text reflow',artist:'Test',lang:'ru',mode:'original',md:[]},lines:[{t:0,end:9,text:'тихое корабля дальше',tr:'',agent:'v2',sync:{orig:sync}}]};
  await request.put('/api/project?by=page',{data:project});
  await page.addInitScript(()=>{localStorage.setItem('helpSeen','1');localStorage.setItem('sylMem','0');});
  await page.setViewportSize({width:1440,height:900});await page.goto('/');await page.locator('#nav-text').click();
  const editor=page.locator('#fullO');await expect(editor).toBeVisible();await expect(page.locator('#fullT')).toBeHidden();
  expect((await editor.boundingBox())!.width).toBeGreaterThan(1150);
  await page.screenshot({path:test.info().outputPath('text-editor.png'),animations:'disabled'});
  const current=async()=> (await(await request.get('/api/project')).json()).project;
  await editor.fill('тихое\nкорабля дальше');expect((await current()).lines).toEqual(project.lines);
  await page.locator('#btnFullApply').click();
  await expect.poll(async()=>(await current()).lines.length).toBe(2);
  expect((await current()).lines.flatMap((l:any)=>l.sync.orig)).toEqual(sync);
  await page.reload();await expect(editor).toHaveValue('тихое\nкорабля дальше');
  await editor.fill('тихое ко\nрабля дальше');await page.locator('#btnFullApply').click();
  await expect.poll(async()=>(await current()).lines[0].text).toBe('тихое ко');
  expect((await current()).lines.flatMap((l:any)=>l.sync.orig)).toEqual([sync[0],{a:3,b:3.857,g:1},{a:3.857,b:6,g:1},sync[2]]);
  await editor.focus();await page.keyboard.press('Control+z');
  await expect.poll(async()=>(await current()).lines.flatMap((l:any)=>l.sync.orig)).toEqual(sync);
  await expect(editor).toHaveValue('тихое\nкорабля дальше');
  await page.keyboard.press('Control+Shift+z');
  await expect(editor).toHaveValue('тихое ко\nрабля дальше');
});
