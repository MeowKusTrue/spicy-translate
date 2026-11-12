import { createHash } from 'node:crypto';
import { expect, test, type Page, type APIRequestContext } from '@playwright/test';
const empty={v:1,meta:{title:'Recognition draft',artist:'Test',lang:'ru',mode:'original',md:[]},lines:[]};
function wav(sample=0){const b=Buffer.alloc(44+64000);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);b.writeInt16LE(sample,44);return b;}
const original=wav(), key=createHash('sha256').update(original).digest('hex');
const recognized={t:0,end:2,text:'ти|хое море',tr:'not allowed',bg:{text:'invented',tr:''},approved:{orig:true},sync:{orig:[{a:0,b:.5},{a:.5,b:1},{a:1,b:2}]}};
async function prepare(page:Page,request:APIRequestContext,ready=true){
 await request.put('/api/project?by=page',{data:empty});let posts=0;
 await page.addInitScript(()=>localStorage.setItem('helpSeen','1'));
 await page.route('**/lrclib.net/api/search?*',route=>route.fulfill({json:[]}));
 await page.route('**/api/align/audio?*',route=>route.fulfill({json:{ok:true,audioKey:createHash('sha256').update(route.request().postDataBuffer()!).digest('hex'),vocals:ready}}));
 await page.route('**/api/align/vocals*',route=>ready?route.fulfill({contentType:'audio/wav',body:original}):route.fulfill({status:404}));
 await page.route(/\/api\/align(?:\?.*)?$/,route=>{
  if(route.request().method()==='POST'){
   const q=new URL(route.request().url()).searchParams;expect(q.get('operation')).toBe('transcribe');expect(q.get('detectBack')).toBe('0');expect(q.get('locateLines')).toBe('0');
   expect(route.request().postDataJSON().lines).toEqual([]);posts++;return route.fulfill({json:{ok:true,runId:'recognition-'+posts}});
  }
  return route.fulfill({json:{available:true,running:false,audioKey:key,runId:'recognition-'+posts,vocals:ready,result:posts?{...empty,lines:[recognized]}:null}});
 });
 await page.goto('/');await page.locator('#fileAudioCard').setInputFiles({name:'source.wav',mimeType:'audio/wav',buffer:original});
 return {posts:()=>posts};
}
test('recognition previews only, applies safe draft explicitly, preserves audio and supports undo',async({page,request})=>{
 const state=await prepare(page,request);await page.locator('#btnTranscribeText').click();await expect(page.locator('#transcriptionReview')).toBeVisible();
 await expect(page.locator('#transcriptionLines')).toContainText('ти|хое море');
 expect((await(await request.get('/api/project')).json()).project.lines).toEqual([]);expect(state.posts()).toBe(1);
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
test('recognition without ready vocal never starts implicit separation',async({page,request})=>{
 const state=await prepare(page,request,false);await page.locator('#btnTranscribeText').click();await expect(page.locator('#dockMsg')).toContainText('Сначала нажми «Выделить голос»');expect(state.posts()).toBe(0);
 await expect(page.locator('#transcriptionReview')).toHaveCount(0);
});
