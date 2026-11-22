import {expect,test} from '@playwright/test';

test('balanced backing lookalike offers both alphabets and missing writers opens metadata',async({page,request})=>{
  const sync=[{a:1,b:2},{a:2,b:3}];
  await request.put('/api/project?by=page',{data:{v:1,meta:{title:'Balanced letters',artist:'Test',lang:'ru',mode:'original',md:[]},lines:[{t:1,end:3,text:'',tr:'',bg:{text:'Са cа',tr:''},sync:{bgo:sync}}]}});
  await page.addInitScript(()=>localStorage.setItem('helpSeen','1'));
  await page.goto('/');await page.locator('#nav-export').click();await page.locator('#btnShow').click();
  const dialog=page.locator('#exportPreflight');
  await expect(dialog.getByRole('button',{name:'Записать «ca» латиницей без сдвига времени',exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Записать «са» кириллицей без сдвига времени',exact:true}).click();
  await expect.poll(async()=>(await(await request.get('/api/project')).json()).project.lines[0].bg.text).toBe('Са са');
  expect((await(await request.get('/api/project')).json()).project.lines[0].sync.bgo).toEqual(sync);
  await dialog.getByRole('button',{name:'Указать авторов песни',exact:true}).click();
  await expect(dialog).toBeHidden();await expect(page.locator('#metaEd')).toBeVisible();
  const writer=page.locator('#metaEd input[data-k="songwriter"]').first();await expect(writer).toBeFocused();await writer.fill('Lucas Bradford');
  await page.locator('#metaEd button[title="Закрыть (Esc)"]').click();await page.locator('#btnShow').click();
  await expect(dialog).not.toContainText('Не указаны авторы песни');await page.locator('#btnExportAnyway').click();
  await expect(page.locator('#out')).toContainText('<songwriter>Lucas Bradford</songwriter>');
});

test('invisible character warning identifies the row, fixes fresh export and undoes without retiming',async({page,request})=>{
  const sync=[{a:.564,b:.983},{a:.983,b:1.151},{a:1.151,b:1.355},{a:1.355,b:1.889}];
  await request.put('/api/project?by=page',{data:{v:1,meta:{title:'Invisible text',artist:'Test',lang:'ru',mode:'original',md:[]},lines:[{t:.564,end:1.889,text:'\u200BRazov on the beat',tr:'',agent:'v2',sync:{orig:sync}}]}});
  await page.addInitScript(()=>localStorage.setItem('helpSeen','1'));
  await page.goto('/');await page.locator('#nav-export').click();await page.locator('#btnShow').click();
  const dialog=page.locator('#exportPreflight');await expect(dialog).toContainText('U+200B');await expect(dialog).toContainText('Razov on the beat');
  await dialog.getByRole('button',{name:'Удалить невидимые символы без изменения времени',exact:true}).click();
  await expect.poll(async()=>(await(await request.get('/api/project')).json()).project.lines[0].text).toBe('Razov on the beat');
  if(await dialog.isVisible()) await page.locator('#btnExportAnyway').click();
  expect((await page.locator('#out').textContent())!.includes('\u200B')).toBe(false);
  expect((await(await request.get('/api/project')).json()).project.lines[0].sync.orig).toEqual(sync);
  await page.keyboard.press('Control+z');
  await expect.poll(async()=>(await(await request.get('/api/project')).json()).project.lines[0].text).toBe('\u200BRazov on the beat');
});

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
