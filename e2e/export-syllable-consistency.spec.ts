import { expect, test } from '@playwright/test';
const lines=[
 {t:1,end:4,text:'ко|ра|бля',tr:'',sync:{orig:[{a:1,b:2},{a:2,b:3},{a:3,b:4}]}},
 {t:10,end:14,text:'кора|бля',tr:'',sync:{orig:[{a:10,b:12},{a:12,b:14}]}}
];
test.beforeEach(async({page,request})=>{
 await request.put('/api/project?by=page',{data:{v:1,meta:{title:'Consistent syllables',artist:'Test',lang:'ru',mode:'original',md:[]},lines}});
 await page.addInitScript(()=>{localStorage.setItem('helpSeen','1');localStorage.setItem('sylMem','0');});await page.goto('/');await page.locator('#nav-export').click();await page.locator('#btnShow').click();
});
test('pre-export offers existing word splits with row labels; cancel is read-only, apply exports fresh markup and undoes once',async({page,request})=>{
 const current=async()=>(await(await request.get('/api/project')).json()).project.lines;
 const dialog=page.locator('#exportPreflight'),issue=dialog.locator('.export-issue').filter({hasText:'Разное разбиение слова'});
 await expect(issue).toContainText('ко|ра|бля');await expect(issue).toContainText('кора|бля');await expect(issue).toContainText('строка 2 (Оригинал)');
 expect(await current()).toEqual(lines);await dialog.getByRole('button',{name:'Отмена',exact:true}).click();expect(await current()).toEqual(lines);
 await page.locator('#btnShow').click();await issue.getByRole('button',{name:'Везде «ко|ра|бля» (2 вхожд.)',exact:true}).click();
 await expect(dialog).not.toContainText('Разное разбиение слова');await page.locator('#btnExportAnyway').click();
 await expect.poll(async()=>(await current()).map((l:any)=>l.text)).toEqual(['ко|ра|бля','ко|ра|бля']);
 expect((await current())[1].sync.orig).toEqual([{a:10,b:11,g:1},{a:11,b:12,g:1},{a:12,b:14}]);
 await expect(page.locator('#out')).not.toContainText('>кора</span>');await expect(page.locator('#out')).toContainText('>ко</span>');
 await page.locator('body').click({position:{x:5,y:5}});await page.keyboard.press('Control+z');await expect.poll(current).toEqual(lines);
});
test('repeat-line template can choose the alternative split, without making word times equal across repeats',async({page,request})=>{
 const current=async()=>(await(await request.get('/api/project')).json()).project.lines;
 const issue=page.locator('#exportPreflight .export-issue').filter({hasText:'Одинаковые строки разбиты'});
 await issue.getByRole('button',{name:'Повторы — как в строке 2: «кора|бля»',exact:true}).click();
 await expect.poll(async()=>(await current())[0].text).toBe('кора|бля');expect((await current())[0].sync.orig).toEqual([{a:1,b:3,g:1},{a:3,b:4}]);expect((await current())[1]).toEqual(lines[1]);
 await page.locator('#exportPreflight').getByRole('button',{name:'Отмена',exact:true}).click();await page.locator('body').click({position:{x:5,y:5}});await page.keyboard.press('Control+z');await expect.poll(current).toEqual(lines);
});
