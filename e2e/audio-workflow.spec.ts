import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
function wav(){ const b=Buffer.alloc(44+32000);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);return b; }
const original=wav(), key=createHash('sha256').update(original).digest('hex');
const project={v:1,meta:{title:'Separate operations',artist:'Test',lang:'ru',mode:'original',md:[]},lines:[{t:0,end:1,text:'known text',tr:'',sync:null,bg:{text:'known echo',tr:''}}]};

test('words without saved vocals never secretly start separation or add lyrics',async({page,request})=>{
 await request.put('/api/project?by=page',{data:project});let jobs=0;
 await page.addInitScript(()=>localStorage.setItem('helpSeen','1'));
 await page.route(/\/api\/align(?:\?.*)?$/,route=>{if(route.request().method()==='POST')jobs++;return route.fulfill({json:{available:true,running:false,audioKey:key,vocals:false}});});
 await page.route('**/api/align/audio?*',route=>route.fulfill({json:{ok:true,audioKey:key,vocals:false}}));
 await page.route('**/api/align/vocals*',route=>route.fulfill({status:404}));
 await page.goto('/');await page.locator('#fileAudio').setInputFiles({name:'source.wav',mimeType:'audio/wav',buffer:original});
 await page.locator('#nav-sync').click();await page.locator('#btnEditorCommands').click();await page.locator('#btnAutoAlign').click();
 await expect(page.locator('#dockMsg')).toContainText('Сначала нажми «Выделить голос»');
 expect(jobs).toBe(0);expect((await(await request.get('/api/project')).json()).project.lines).toEqual(project.lines);
});

test('separation without lyrics saves a vocal but never applies returned text',async({page,request})=>{
 const empty={...project,lines:[]};await request.put('/api/project?by=page',{data:empty});let started=false, operation='';
 await page.addInitScript(()=>localStorage.setItem('helpSeen','1'));
 await page.route('**/lrclib.net/api/search?*',route=>route.fulfill({json:[]}));
 await page.route(/\/api\/align(?:\?.*)?$/,route=>{
  if(route.request().method()==='POST'){operation=new URL(route.request().url()).searchParams.get('operation')!;started=true;return route.fulfill({json:{ok:true}});}
  return route.fulfill({json:{available:true,running:false,audioKey:key,vocals:started,result:started?project:null}});
 });
 await page.route('**/api/align/audio?*',route=>route.fulfill({json:{ok:true,audioKey:key,vocals:false}}));
 await page.route('**/api/align/vocals*',route=>started?route.fulfill({contentType:'audio/wav',body:original}):route.fulfill({status:404}));
 await page.goto('/');await page.locator('#fileAudioCard').setInputFiles({name:'source.wav',mimeType:'audio/wav',buffer:original});await page.locator('#btnExtractVocals').click();
 await expect(page.locator('#playbackSource option[value=voice]')).toHaveJSProperty('disabled',false);
 await expect(page.locator('#btnExtractVocals')).toBeEnabled();expect(operation).toBe('separate');
 expect((await(await request.get('/api/project')).json()).project.lines).toEqual([]);
});


test('completed alignment is reapplied only after consent, persists new timing and undoes in one step',async({page,request})=>{
 const lines=[{t:0,end:1,text:'known text',tr:'перевод',approved:{orig:true},sync:{orig:[{a:0,b:.5},{a:.5,b:1}],tr:[{a:0,b:1}]}}];
 await request.put('/api/project?by=page',{data:{...project,lines}});
 let started=false,jobs=0,submitted:any;
 await page.addInitScript(()=>{localStorage.setItem('helpSeen','1');localStorage.setItem('sylMem','0');(window as any).confirm=async()=> (window as any).retryAllowed===true;});
 await page.route(/\/api\/align(?:\?.*)?$/,route=>{
  if(route.request().method()==='POST'){jobs++;submitted=route.request().postDataJSON();started=true;return route.fulfill({json:{ok:true,runId:'retry'}});}
  return route.fulfill({json:{available:true,running:false,runId:started?'retry':'',audioKey:key,vocals:true,result:started?{...project,lines:[{...lines[0],sync:{orig:[{a:.1,b:.4,g:1},{a:.6,b:.9,g:1}]}}]}:null}});
 });
 await page.route('**/api/align/audio?*',route=>route.fulfill({json:{ok:true,audioKey:key,vocals:true}}));
 await page.route('**/api/align/vocals*',route=>route.fulfill({contentType:'audio/wav',body:original}));
 await page.goto('/');await page.locator('#fileAudio').setInputFiles({name:'source.wav',mimeType:'audio/wav',buffer:original});
 await page.locator('#nav-sync').click();await page.locator('#btnEditorCommands').click();
 await page.locator('#btnAutoAlign').click();expect(jobs).toBe(0);
 const current=async()=> (await(await request.get('/api/project')).json()).project;
 expect((await current()).lines).toEqual(lines);
 await page.evaluate(()=>{(window as any).retryAllowed=true;});await page.locator('#btnAutoAlign').click();
 await expect.poll(()=>jobs).toBe(1);expect(submitted.lines[0].approved).toBeUndefined();expect(submitted.lines[0].sync.orig.every((w:any)=>w.g)).toBe(true);
 await expect.poll(async()=> (await current()).lines[0].sync.orig[0].a).toBe(.1);
 await expect(page.locator('#btnAutoAlign')).toBeEnabled();await expect(page.locator('#dockMsg')).toContainText('Расставлены слова в строках: 1');
 expect((await current()).lines[0].sync.tr).toEqual(lines[0].sync.tr);
 await page.keyboard.press('Control+z');await expect.poll(async()=> (await current()).lines[0].sync.orig).toEqual(lines[0].sync.orig);
 expect((await current()).lines[0].approved.orig).toBe(true);
});

test('zero applied timings are reported after vocal caching, not hidden by a success message',async({page,request})=>{
 await request.put('/api/project?by=page',{data:project});let started=false;
 await page.addInitScript(()=>localStorage.setItem('helpSeen','1'));
 await page.route(/\/api\/align(?:\?.*)?$/,route=>{
  if(route.request().method()==='POST'){started=true;return route.fulfill({json:{ok:true}});}
  return route.fulfill({json:{available:true,running:false,audioKey:key,vocals:true,result:started?project:null}});
 });
 await page.route('**/api/align/audio?*',route=>route.fulfill({json:{ok:true,audioKey:key,vocals:true}}));
 await page.route('**/api/align/vocals*',route=>route.fulfill({contentType:'audio/wav',body:original}));
 await page.goto('/');await page.locator('#fileAudio').setInputFiles({name:'source.wav',mimeType:'audio/wav',buffer:original});
 await page.locator('#nav-sync').click();await page.locator('#btnEditorCommands').click();await page.locator('#btnAutoAlign').click();
 await expect.poll(()=>started).toBe(true);await expect(page.locator('#btnAutoAlign')).toBeEnabled();
 await expect(page.locator('#dockMsg')).toContainText('Ни одна строка не обновлена');
});


test('word-box selection plus unlock aligns only those rows even when global locate mode is saved',async({page,request})=>{
 const lines=[{t:0,end:.5,text:'first half',tr:'',approved:{orig:true},sync:{orig:[{a:0,b:.2},{a:.2,b:.5}]}},{t:.5,end:1,text:'second half',tr:'',approved:{orig:true},sync:{orig:[{a:.5,b:.7},{a:.7,b:1}]}}];
 await request.put('/api/project?by=page',{data:{...project,lines}});let started=false,query='',submitted:any;
 await page.addInitScript(()=>{localStorage.setItem('helpSeen','1');localStorage.setItem('layout','classic');localStorage.setItem('alignModels',JSON.stringify({locateLines:true}));(window as any).confirm=async()=>{throw new Error('Selection must not disable audio lookup or prompt to use rough windows');};});
 await page.route(/\/api\/align(?:\?.*)?$/,route=>{
  if(route.request().method()==='POST'){query=route.request().url();submitted=route.request().postDataJSON();started=true;return route.fulfill({json:{ok:true}});}
  return route.fulfill({json:{available:true,running:false,audioKey:key,vocals:true,result:started?{...project,lines:[{...lines[0],sync:{orig:[{a:.1,b:.3,g:1},{a:.3,b:.4,g:1}]}},{...lines[1],approved:undefined,sync:{orig:[{a:.55,b:.75,g:1},{a:.8,b:.95,g:1}]}}]}:null}});
 });
 await page.route('**/api/align/audio?*',route=>route.fulfill({json:{ok:true,audioKey:key,vocals:true}}));
 await page.route('**/api/align/vocals*',route=>route.fulfill({contentType:'audio/wav',body:original}));
 await page.setViewportSize({width:1600,height:1000});await page.goto('/');await page.locator('#fileAudio').setInputFiles({name:'source.wav',mimeType:'audio/wav',buffer:original});
 await page.locator('#nav-sync').click();await page.locator('#ln1 .t').click();
 const chips=page.locator('#syncLines .sl.cur .chip');await chips.nth(0).click();await chips.nth(1).click({modifiers:['Control']});
 await expect(page.locator('#selectionBar')).toContainText('Выбрано слов: 2');await page.locator('#btnUnlockTiming').click();
 await page.locator('#btnEditorCommands').click();await expect(page.locator('#btnAutoAlign')).toHaveText('Расставить слова · строк: 1');
 await page.locator('#btnAutoAlign').click();
 await expect.poll(()=>query).toContain('locateLines=1');expect(submitted.lines).toHaveLength(2);
 expect(submitted.lines[0].approved).toEqual({orig:true,bgo:true});expect(submitted.lines[0].sync).toEqual(lines[0].sync);
 expect(submitted.lines[1].text).toBe('second half');expect(submitted.lines[1].approved?.orig).toBeFalsy();
 const current=async()=> (await(await request.get('/api/project')).json()).project;
 await expect.poll(async()=> (await current()).lines[1].sync.orig[0].a).toBe(.55);
 expect((await current()).lines[0]).toEqual(lines[0]);
 await expect(page.locator('#btnAutoAlign')).toBeEnabled();await expect(page.locator('#dockMsg')).toContainText('только выделенные строки (2)');
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('alignModels')!).locateLines)).toBe(true);
 await page.keyboard.press('Control+z');await expect.poll(async()=> (await current()).lines[1].sync.orig[0].a).toBe(.5);
 expect((await current()).lines[0]).toEqual(lines[0]);
});
