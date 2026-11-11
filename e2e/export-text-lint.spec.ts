import {expect,test} from '@playwright/test';

test('preflight fixes lookalike letters and offers both ellipsis choices without retiming',async({page,request})=>{
  const sync=[{a:1,b:2},{a:2,b:3}];
  await request.put('/api/project?by=page',{data:{v:1,meta:{title:'Text checks',artist:'Test',lang:'ru',mode:'original',md:[]},lines:[{t:1,end:3,text:'plеase играешь…',tr:'',sync:{orig:sync}}]}});
  await page.addInitScript(()=>localStorage.setItem('helpSeen','1'));
  await page.goto('/');await page.locator('#nav-export').click();await page.locator('#btnShow').click();
  const dialog=page.locator('#exportPreflight');await expect(dialog).toBeVisible();
  await dialog.getByRole('button',{name:'Заменить на «please» без сдвига времени',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Фраза закончена — убрать многоточие',exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Фраза оборвана — заменить многоточие на —',exact:true}).click();
  await page.locator('#btnExportAnyway').click();
  await expect(page.locator('#out')).toContainText('please');await expect(page.locator('#out')).toContainText('играешь—');
  await expect.poll(async()=>(await(await request.get('/api/project')).json()).project.lines[0].text).toBe('please играешь—');
  expect((await(await request.get('/api/project')).json()).project.lines[0].sync.orig).toEqual(sync);
});
