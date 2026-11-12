import { createHash } from 'node:crypto';
import { expect, test, type Page, type APIRequestContext } from '@playwright/test';
const empty={v:1,meta:{title:'Recognition draft',artist:'Test',lang:'ru',mode:'original',md:[]},lines:[]};
function wav(sample=0){const b=Buffer.alloc(44+64000);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);b.writeInt16LE(sample,44);return b;}
const original=wav(), key=createHash('sha256').update(original).digest('hex');
const recognized={t:0,end:2,text:'ти|хое море',tr:'not allowed',bg:{text:'invented',tr:''},approved:{orig:true},sync:{orig:[{a:0,b:.5},{a:.5,b:1},{a:1,b:2}]}};
async function prepare(page:Page,request:APIRequestContext,ready=true,hold=false){
 await request.put('/api/project?by=page',{data:empty});
 const operations:string[]=[],audioKeys:string[]=[];let uploads=0,deletes=0,vocals=ready,runId='',stage='demucs';
 const running={separate:hold,transcribe:hold};
 await page.addInitScript(()=>localStorage.setItem('helpSeen','1'));
 await page.route('**/lrclib.net/api/search?*',route=>route.fulfill({json:[]}));
 await page.route('**/api/align/audio?*',route=>{
  expect(route.request().method()).toBe('POST');uploads++;
  return route.fulfill({json:{ok:true,audioKey:createHash('sha256').update(route.request().postDataBuffer()!).digest('hex'),vocals}});
 });
 await page.route('**/api/align/vocals*',route=>vocals?route.fulfill({contentType:'audio/wav',body:original}):route.fulfill({status:404}));
 await page.route(/\/api\/align(?:\?.*)?$/,route=>{
  const method=route.request().method();
  if(method==='DELETE'){deletes++;return route.fulfill({json:{ok:true}});}
  if(method==='POST'){
   const q=new URL(route.request().url()).searchParams,operation=q.get('operation')!;
   expect(['separate','transcribe']).toContain(operation);expect(q.get('audioKey')).toBe(key);
   expect(q.get('detectBack')).toBe('0');expect(q.get('locateLines')).toBe('0');expect(route.request().postDataJSON().lines).toEqual([]);
   operations.push(operation);audioKeys.push(q.get('audioKey')!);runId='recognition-'+operations.length;stage=operation==='separate'?'demucs':'transcribe';
   return route.fulfill({json:{ok:true,runId}});
  }
  expect(method).toBe('GET');
  const operation=operations.at(-1),active=operation==='separate'?running.separate:operation==='transcribe'?running.transcribe:false;
  if(operation==='separate'&&!active)vocals=true;
  return route.fulfill({json:{available:true,running:active,audioKey:key,runId,vocals,stage,done:1,total:4,device:'cpu',plan:operation==='separate'?['demucs']:['transcribe','align'],result:operation==='transcribe'&&!active?{...empty,lines:[recognized]}:null}});
 });
 await page.goto('/');await page.locator('#fileAudioCard').setInputFiles({name:'source.wav',mimeType:'audio/wav',buffer:original});
 return {posts:()=>operations.length,operations,audioKeys,uploads:()=>uploads,deletes:()=>deletes,
  finish:(operation:'separate'|'transcribe')=>{running[operation]=false;},stage:(value:string)=>{stage=value;}};
}
test('recognition previews only, applies safe draft explicitly, preserves audio and supports undo',async({page,request})=>{
 const state=await prepare(page,request);await page.locator('#btnTranscribeText').click();await expect(page.locator('#transcriptionReview')).toBeVisible();
 await expect(page.locator('#transcriptionLines')).toContainText('ти|хое море');
 expect((await(await request.get('/api/project')).json()).project.lines).toEqual([]);expect(state.posts()).toBe(1);
 expect(state.operations).toEqual(['transcribe']);expect(state.uploads()).toBe(1);expect(state.audioKeys).toEqual([key]);
 await page.locator('#btnTranscriptionApply').click();await expect(page.locator('#transcriptionReview')).toHaveCount(0);
 await expect.poll(async()=>(await(await request.get('/api/project')).json()).project.lines[0]?.text).toBe('ти|хое море');
 const line=(await(await request.get('/api/project')).json()).project.lines[0];expect(line.bg).toBeUndefined();expect(line.tr).toBe('');expect(line.approved).toBeUndefined();expect(line.sync.orig.every((w:any)=>w.g===1)).toBe(true);
 await expect(page.locator('#playbackSource option[value=voice]')).toHaveJSProperty('disabled',false);await expect(page.locator('#btnTranscribeText')).toHaveCount(0);
 await page.keyboard.press('Control+z');await expect.poll(async()=>(await(await request.get('/api/project')).json()).project.lines.length).toBe(0);
});
test('declining recognition leaves an empty project',async({page,request})=>{
 await prepare(page,request);await page.locator('#btnTranscribeText').click();await expect(page.locator('#transcriptionReview')).toBeVisible();await page.locator('#btnTranscriptionCancel').click();
 await expect(page.locator('#transcriptionReview')).toHaveCount(0);expect((await(await request.get('/api/project')).json()).project.lines).toEqual([]);
});
test('replacing original audio invalidates its recognition draft',async({page,request})=>{
 await prepare(page,request);await page.locator('#btnTranscribeText').click();await expect(page.locator('#transcriptionReview')).toBeVisible();
 await page.locator('#fileAudioCard').setInputFiles({name:'other.wav',mimeType:'audio/wav',buffer:wav(1)});await expect(page.locator('#transcriptionReview')).toHaveCount(0);
 expect((await(await request.get('/api/project')).json()).project.lines).toEqual([]);
});
test('get lyrics separates missing vocal then transcribes with one original upload',async({page,request})=>{
 const state=await prepare(page,request,false),button=page.locator('#btnTranscribeText');
 await expect(button).toHaveText('Получить текст');await button.click();await expect(page.locator('#transcriptionReview')).toBeVisible();
 expect(state.operations).toEqual(['separate','transcribe']);expect(state.uploads()).toBe(1);expect(state.audioKeys).toEqual([key,key]);
 await expect(page.locator('#transcriptionLines')).toContainText('ти|хое море');
 expect((await(await request.get('/api/project')).json()).project.lines).toEqual([]);
});

test('get lyrics shows separation, transcription and alignment progress on Track',async({page,request})=>{
 const state=await prepare(page,request,false,true);await page.locator('#btnTranscribeText').click();
 const progress=page.locator('#audioAlignCard'),audioCard=page.locator('section').filter({has:page.locator('#fileAudioCard')});
 await expect(audioCard.locator('#audioAlignCard')).toBeVisible();
 await expect(progress.locator('.stg .on')).toContainText(/выделяю голос/i);
 await expect(progress).toContainText(/распознаю текст/i);await expect(progress).toContainText(/подгоняю слова/i);
 await expect(page.locator('#audioAlignCancel')).toBeVisible();await expect(page.locator('#transcriptionReview')).toHaveCount(0);
 const separationPct=Number((await progress.locator('.pct').innerText()).replace('%',''));
 state.finish('separate');await expect(progress.locator('.stg .on')).toContainText(/распознаю текст/i);
 expect(state.operations).toEqual(['separate','transcribe']);expect(state.uploads()).toBe(1);
 expect(Number((await progress.locator('.pct').innerText()).replace('%',''))).toBeGreaterThanOrEqual(separationPct);
 await expect(progress).toBeVisible();await expect(page.locator('#transcriptionReview')).toHaveCount(0);
 state.stage('align');await expect(progress.locator('.stg .on')).toContainText(/подгоняю слова/i);
 await expect(progress).toBeVisible();await expect(page.locator('#transcriptionReview')).toHaveCount(0);
 state.finish('transcribe');await expect(page.locator('#transcriptionReview')).toBeVisible();await expect(progress).toHaveCount(0);
 expect(state.audioKeys).toEqual([key,key]);
});

test('cancelling separation on Track never starts transcription or review',async({page,request})=>{
 const state=await prepare(page,request,false,true);await page.locator('#btnTranscribeText').click();
 const progress=page.locator('#audioAlignCard');await expect(progress.locator('.stg .on')).toContainText(/выделяю голос/i);
 await page.locator('#audioAlignCancel').click();await expect.poll(state.deletes).toBe(1);
 // Even a successful separation response racing with DELETE must not start ASR.
 state.finish('separate');await expect(progress).toHaveCount(0);await expect(page.locator('#btnTranscribeText')).toBeEnabled();
 expect(state.operations).toEqual(['separate']);expect(state.uploads()).toBe(1);expect(state.audioKeys).toEqual([key]);
 await expect(page.locator('#transcriptionReview')).toHaveCount(0);
 expect((await(await request.get('/api/project')).json()).project.lines).toEqual([]);
});
