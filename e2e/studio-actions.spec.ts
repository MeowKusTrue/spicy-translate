import { expect, test } from '@playwright/test';
import fs from 'node:fs';
const fixture = {v:1,meta:{title:'Protected studio',artist:'Test',lang:'ru',mode:'original',md:[]},lines:[
 {t:0,end:20,text:'тихое море',tr:'quiet sea',sync:{orig:[{a:2,b:3,g:1},{a:5,b:6,g:1}],tr:[{a:2,b:3},{a:5,b:6}]}},
 {t:22,end:32,text:'тихое море',tr:'keep translation',sync:{orig:[{a:24,b:26,g:1},{a:28,b:30,g:1}]}},
 {t:34,end:44,text:'тихое море',tr:'',approved:{orig:true},sync:{orig:[{a:36,b:38},{a:40,b:42}]}},
]};
test.beforeEach(async({page,request})=>{await request.put('/api/project?by=page',{data:fixture});await page.addInitScript(()=>{localStorage.setItem('helpSeen','1');localStorage.setItem('dockH','340')});await page.setViewportSize({width:1600,height:1000});await page.goto('/');await page.locator('#nav-sync').click();});
test('manual timing protects a whole phrase and survives reload and subsequent automation',async({page,request})=>{
 const project=async()=>(await(await request.get('/api/project')).json()).project;
 await page.locator('#syncLines .sl.cur .chip').nth(1).click();await page.locator('#timelineExactTime').click();await page.locator('#wordEnd').fill('6.2');await page.locator('#btnWordApply').click();
 await expect.poll(async()=>(await project()).lines[0].approved?.orig).toBe(true);const manual=(await project()).lines[0].sync.orig;expect(manual.every((w:any)=>!w.g)).toBe(true);
 await page.reload();await page.locator('#nav-sync').click();await expect(page.locator('#ln0 .approved-line')).toBeVisible();
 let started=false;const next=structuredClone(fixture);next.lines[0].sync.orig=[{a:9,b:10,g:1},{a:11,b:12,g:1}];next.lines[1].sync.orig=[{a:23,b:24,g:1},{a:25,b:26,g:1}];
 await page.route('**/api/align',r=>r.fulfill({json:started?{running:false,result:next}:{available:true,running:false}}));await page.route('**/api/align?*',r=>{started=true;return r.fulfill({json:{ok:true}})});await page.route('**/api/align/audio?*',r=>r.fulfill({json:{ok:true}}));
 const b=Buffer.alloc(44+16000*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);
 await page.locator('#fileAudio').setInputFiles({name:'protected.wav',mimeType:'audio/wav',buffer:b});await page.locator('#btnEditorCommands').click();await page.locator('#btnAutoAlign').click();await expect.poll(async()=>(await project()).lines[1].sync.orig[0].a).toBe(23);expect((await project()).lines[0].sync.orig).toEqual(manual);
});
test('Ctrl and Shift select words; checkboxes select phrases; approval and undo preserve selection scope',async({page,request})=>{
 const project=async()=>(await(await request.get('/api/project')).json()).project;
 const chips=page.locator('#syncLines .sl.cur .chip');await chips.nth(0).click();await chips.nth(1).click({modifiers:['Control']});await expect(page.locator('#selectionBar')).toContainText('Выбрано слов: 2');await expect(page.locator('#syncLines .chip.multi')).toHaveCount(2);await page.locator('#btnWordsReady').click();await expect.poll(async()=>(await project()).lines[0].approved?.orig).toBe(true);expect((await project()).lines[1].sync.orig[0].g).toBe(1);
 await page.getByRole('button',{name:'Отменить',exact:true}).click();await expect.poll(async()=>(await project()).lines[0].sync.orig[0].g).toBe(1);
 await page.locator('#btnClearSelection').click();await page.getByRole('checkbox',{name:'Выбрать строку 1',exact:true}).check();await page.getByRole('checkbox',{name:'Выбрать строку 2',exact:true}).check();await page.locator('#btnLinesReady').click();await expect.poll(async()=>(await project()).lines.slice(0,2).every((l:any)=>l.approved?.orig)).toBe(true);
 await page.locator('#btnUnlockTiming').click();await expect.poll(async()=>(await project()).lines.slice(0,2).every((l:any)=>!l.approved?.orig&&l.sync.orig.every((w:any)=>w.g))).toBe(true);
});
test('copy all repeats preserves protected destinations unless explicitly enabled',async({page,request})=>{
 const project=async()=>(await(await request.get('/api/project')).json()).project;
 await page.locator('#syncLines .sl.cur .chip').first().click();await page.locator('#btnRepeatAllTiming').click();await page.locator('#btnApplyRepeatAll').click();await expect.poll(async()=>(await project()).lines[1].sync.orig[0].b).toBe(25);expect((await project()).lines[2].sync.orig[0].b).toBe(38);expect((await project()).lines[1].tr).toBe('keep translation');
 await page.locator('#btnRepeatAllTiming').click();await page.locator('#replaceApprovedRepeats').check();await page.locator('#btnApplyRepeatAll').click();await expect.poll(async()=>(await project()).lines[2].sync.orig[0].b).toBe(37);expect((await project()).lines[2].approved).toBeUndefined();await page.getByRole('button',{name:'Отменить',exact:true}).click();await expect.poll(async()=>(await project()).lines[2].approved?.orig).toBe(true);
});
test('volume is directly accessible, updates immediately and preserves mute on reload',async({page})=>{
 await expect(page.locator('#vol')).toBeVisible();await page.locator('#vol').fill('0.57');await expect(page.locator('.player-volume .val')).toHaveText('57%');await page.locator('#vol').focus();await page.locator('#vol').press('ArrowRight');await expect(page.locator('.player-volume .val')).toHaveText('58%');await page.locator('#btnMute').click();await expect(page.locator('#vol')).toHaveValue('0');await page.reload();await expect(page.locator('#vol')).toHaveValue('0');await page.locator('#btnMute').click();await expect(page.locator('#vol')).not.toHaveValue('0');
});
test('playback reuses raster; dragging one word does not rebuild the whole preview',async({page},info)=>{
 await page.evaluate(()=>{const old=CanvasRenderingContext2D.prototype.fillText;(window as any).waveText=0;CanvasRenderingContext2D.prototype.fillText=function(...a:Parameters<typeof old>){if(this.canvas.id==='wave')(window as any).waveText++;return old.apply(this,a)};});
 await page.locator('#btnPlay').click();await page.waitForTimeout(1200);await page.locator('#btnPlay').click();const paints=await page.evaluate(()=>(window as any).waveText);expect(paints).toBeLessThan(400);await info.attach('timeline-raster-paints.json',{body:JSON.stringify({textPaints:paints,seconds:1.2}),contentType:'application/json'});
 await page.locator('#ln0 .t').click();await page.evaluate(()=>{(window as any).rootChanges=0;new MutationObserver(r=>{(window as any).rootChanges+=r.reduce((n,x)=>n+x.addedNodes.length,0)}).observe(document.getElementById('lyrIn')!,{childList:true});});
 const cv=(await page.locator('#wave').boundingBox())!;await page.mouse.move(cv.x+5.5*140,cv.y+22);await page.mouse.down();await page.mouse.move(cv.x+5.5*140+18,cv.y+22,{steps:16});await page.mouse.up();await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));expect(await page.evaluate(()=>(window as any).rootChanges)).toBeLessThan(10);
});

test('Genius native browser imports into preview without changing the project',async({page,request})=>{
 await page.addInitScript(()=>{const w={isMaximized:async()=>false,onResized:async()=>()=>{},minimize:async()=>{},toggleMaximize:async()=>{},close:async()=>{}};(window as any).__TAURI__={window:{getCurrentWindow:()=>w},core:{invoke:async(c:string,args:any)=>{(window as any).nativeCall={c,args}}},event:{listen:async(name:string,cb:any)=>{if(name==='genius-import')(window as any).geniusImport=cb;return()=>{}}}};});
 await page.reload();await page.locator('#nav-track').click();await page.locator('#btnGeniusBrowser').click();expect(await page.evaluate(()=>(window as any).nativeCall.c)).toBe('open_genius');
 await page.evaluate(()=>(window as any).geniusImport({payload:{url:'https://genius.com/Test-song-lyrics',title:'Test lyrics',text:'[Припев]\nтихое море рядом'}}));await expect(page.locator('.genius .status')).toContainText('сверки');expect((await(await request.get('/api/project')).json()).project.lines[0].text).toBe('тихое море');
});
test('Genius browser extraction ignores excluded labels and keeps line breaks',async({page})=>{
 const script=fs.readFileSync('desktop/src-tauri/src/genius-browser.js','utf8');await page.addInitScript(()=>{(window as any).__TAURI_INTERNALS__={invoke:async(c:string,args:any)=>{(window as any).captured={c,args}}};});await page.addInitScript({content:script});await page.route('https://genius.com/Test-song-lyrics',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<html><meta charset="utf-8"><title>Test</title><body><div data-lyrics-container="true"><div data-exclude-from-selection="true">advertisement</div>[Припев]<br/>тихое <a>море</a><br/>ещё строка</div></body></html>'}));await page.goto('https://genius.com/Test-song-lyrics');await page.getByRole('button',{name:'Взять текст в Spicy Translate',exact:true}).click();const result=await page.evaluate(()=>(window as any).captured);expect(result.c).toBe('genius_capture');expect(result.args.text).toBe('[Припев]\nтихое море\nещё строка');
});
