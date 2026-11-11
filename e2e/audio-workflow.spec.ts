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
