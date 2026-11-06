import { expect, test } from '@playwright/test';
const fixture={v:1,meta:{title:'Zoom regression',artist:'Test',lang:'ru',mode:'original',md:[]},lines:Array.from({length:120},(_,i)=>({t:1+i*3,end:4+i*3,text:'тихое море',tr:'',sync:{orig:[{a:1+i*3,b:2+i*3},{a:2+i*3,b:4+i*3}]}}))};
test.beforeEach(async({page,request})=>{await request.put('/api/project?by=page',{data:fixture});await page.addInitScript(()=>{localStorage.setItem('helpSeen','1');localStorage.setItem('dockH','420')});await page.setViewportSize({width:1600,height:1000});await page.goto('/');await page.locator('#nav-sync').click();});
test('paused Ctrl+wheel paints promptly, coalesces a burst and preserves timing',async({page,request})=>{
 const wave=page.locator('#wave');const before=await wave.evaluate((e:HTMLCanvasElement)=>e.toDataURL());const scale=await page.locator('#timelineScale').textContent();
 await wave.dispatchEvent('wheel',{deltaY:-80,ctrlKey:true,clientX:600,bubbles:true});
 await expect(page.locator('#timelineScale')).not.toHaveText(scale!);await expect.poll(()=>wave.evaluate((e:HTMLCanvasElement)=>e.toDataURL())).not.toBe(before);await expect(page.locator('#timelineFollow')).toHaveAttribute('aria-pressed','false');
 const elapsed=await wave.evaluate(async(el)=>{const begin=performance.now();let clears=0;const original=CanvasRenderingContext2D.prototype.clearRect;CanvasRenderingContext2D.prototype.clearRect=function(...args){clears++;return original.apply(this,args)};for(let i=0;i<1000;i++)el.dispatchEvent(new WheelEvent('wheel',{deltaY:i%2?3:-3,ctrlKey:true,clientX:600,bubbles:true,cancelable:true}));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));CanvasRenderingContext2D.prototype.clearRect=original;return {ms:performance.now()-begin,clears};});console.log('1000-event zoom burst',elapsed);expect(elapsed.ms).toBeLessThan(1500);expect(elapsed.clears).toBeLessThan(20);
 await page.locator('#timelineFitSong').click();await expect(page.locator('#timelinePan')).toBeDisabled();await page.getByRole('button',{name:'Приблизить таймлайн',exact:true}).click();await expect(page.locator('#timelinePan')).toBeEnabled();
 const project=(await(await request.get('/api/project')).json()).project;expect(project.lines).toEqual(fixture.lines);
});
test('text saves before the first timeline drag and before zoom, with undo',async({page,request})=>{
 await page.locator('#ln0 .t').click();await page.locator('#pl0').dblclick();await page.locator('#previewEditText').fill('тихое синее море');
 const b=(await page.locator('#wave').boundingBox())!;
 await page.mouse.move(b.x+210,b.y+20);await page.mouse.down();await page.mouse.move(b.x+230,b.y+20,{steps:5});await page.mouse.up();await expect(page.locator('#previewEditText')).toHaveCount(0);
 const project=async()=>(await(await request.get('/api/project')).json()).project;await expect.poll(async()=>(await project()).lines[0].text).toBe('тихое синее море');expect((await project()).lines[0].sync.orig[0].a).not.toBe(1);
 await page.getByRole('button',{name:'Отменить',exact:true}).click();await expect.poll(async()=>(await project()).lines[0].sync.orig[0].a).toBe(1);
 await page.locator('#ln0 .t').click();await page.locator('#pl0').dblclick();await page.locator('#previewEditText').fill('новое синее море');await page.locator('#wave').dispatchEvent('wheel',{deltaY:-60,ctrlKey:true,clientX:500,bubbles:true});await expect(page.locator('#previewEditText')).toHaveCount(0);await expect.poll(async()=>(await project()).lines[0].text).toBe('новое синее море');
});

test('invalid auto-save keeps the draft; keyboard zoom and manual navigation keep their state during playback',async({page,request})=>{
 await page.locator('#ln0 .t').click();await page.locator('#pl0').dblclick();await page.locator('#previewEditText').fill('');const scale=await page.locator('#timelineScale').textContent();await page.locator('#timelineFitSong').click();await expect(page.locator('.preview-edit-error')).toContainText('Строка пуста');await expect(page.locator('#previewEditText')).toBeVisible();await expect(page.locator('#timelineScale')).toHaveText(scale!);await page.locator('#btnPreviewCancel').click();
 await page.locator('#timelineFitSong').click();await page.locator('#timelineZoom').focus();await page.keyboard.press('End');await expect(page.locator('#timelineScale')).toContainText('1500');await page.locator('#timelinePan').focus();await page.keyboard.press('End');await expect(page.locator('#timelineFollow')).toHaveAttribute('aria-pressed','false');const range=await page.locator('#timelineRange').textContent();await page.locator('#btnPlay').click();await expect(page.locator('#btnPlay')).toHaveText('❚❚');await page.waitForTimeout(200);await expect(page.locator('#timelineRange')).toHaveText(range!);await page.locator('#timelineCursor').click();await expect(page.locator('#timelineFollow')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#timelineRange')).not.toHaveText(range!);await page.locator('#btnPlay').click();
 expect((await(await request.get('/api/project')).json()).project.lines).toEqual(fixture.lines);
});

test('switching to playback saves the changed preview and executes the first click',async({page,request})=>{
 await page.locator('#ln0 .t').click();await page.locator('#pl0').dblclick();await page.locator('#previewEditText').fill('новое море');await page.locator('#btnPlay').click();await expect(page.locator('#previewEditText')).toHaveCount(0);await expect(page.locator('#btnPlay')).toHaveText('❚❚');await expect.poll(async()=>(await(await request.get('/api/project')).json()).project.lines[0].text).toBe('новое море');await page.locator('#btnPlay').click();
});
