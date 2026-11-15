import { describe, expect, it } from 'vitest';
import { lintExport } from '../src/core/exportLint.ts';
import { syllableConsistency } from '../src/core/syllableConsistency.ts';
import type { Line } from '../src/core/types.ts';
const sample=():Line[]=>[
 {t:1,end:5,text:'У ко|ра|бля',tr:'',sync:{orig:[{a:1,b:2},{a:2,b:2.5},{a:2.5,b:3},{a:3,b:5}]}},
 {t:10,end:15,text:'У кора|бля',tr:'',approved:{orig:true,bgo:true},bg:{text:'эй',tr:''},sync:{orig:[{a:10,b:11},{a:11,b:13},{a:13,b:15}],bgo:[{a:11,b:12}]}}
];
const apply=(lines:Line[],changes:{i:number;line:Line}[])=>lines.map((l,i)=>changes.find(c=>c.i===i)?.line||l);
describe('export syllable consistency',()=>{
 it('reports words and complete repeat lines with locations without mutating the source',()=>{
   const lines=sample(),before=structuredClone(lines),issues=lintExport({lines,mode:'original'}).filter(x=>x.examples);
   expect(issues).toHaveLength(2);expect(issues[0].examples?.map(x=>x.text)).toEqual(['ко|ра|бля','кора|бля']);
   expect(issues[0].examples![1].locations).toEqual([{i:1,layer:'orig'}]);expect(lines).toEqual(before);
 });
 it('unifies splits and preserves each word envelope, existing shared boundary, other words and backing',()=>{
   const lines=sample(),issue=syllableConsistency({lines,mode:'original'})[0];
   const next=apply(lines,issue.batchFixes![0].changes);
   expect(next.map(l=>l.text)).toEqual(['У ко|ра|бля','У ко|ра|бля']);
   expect(next[1].sync!.orig).toEqual([{a:10,b:11},{a:11,b:12,g:1},{a:12,b:13,g:1},{a:13,b:15}]);
   expect(next[1].sync!.bgo).toEqual(lines[1].sync!.bgo);expect(next[1].approved).toEqual({bgo:true});expect(next[0]).toBe(lines[0]);
   expect(syllableConsistency({lines:next,mode:'original'})).toEqual([]);
 });
 it('offers joining syllables as well and keeps word start/end for every occurrence',()=>{
   const lines=sample();lines.push({t:20,end:23,text:'корабля',tr:'',sync:{orig:[{a:20,b:23}]}});
   const issue=syllableConsistency({lines,mode:'original'})[0],fix=issue.batchFixes!.find(f=>f.label.includes('«корабля»'))!;
   const next=apply(lines,fix.changes);expect(next[0].sync!.orig!.at(-1)).toEqual({a:2,b:5,g:1});expect(next[1].sync!.orig!.at(-1)).toEqual({a:11,b:15,g:1});expect(next[2]).toBe(lines[2]);
 });
 it('preserves case, punctuation and whitespace and handles several occurrences in the same row',()=>{
   const lines:Line[]=[{t:1,end:9,text:'«Ко|ра|бля»,  кора|бля!',tr:''}];
   const issue=syllableConsistency({lines,mode:'original'})[0];const next=apply(lines,issue.batchFixes![0].changes);
   expect(next[0].text).toBe('«Ко|ра|бля»,  ко|ра|бля!');expect(next[0].sync).toBeUndefined();
 });
 it('checks exported language and backing, excluding hidden translations and line-only exports',()=>{
   const lines=sample();lines[1].bg={text:'ко|рабля',tr:''};delete lines[1].sync!.bgo;
   expect(syllableConsistency({lines,mode:'original'})[0].examples).toHaveLength(3);
   lines.forEach(l=>l.tr='translation');expect(syllableConsistency({lines,mode:'bilingual'})).toHaveLength(2);
   expect(syllableConsistency({lines,mode:'original',wordSpread:false})).toEqual([]);
   expect(syllableConsistency({lines:sample().map(l=>({...l,tr:'translation'})),mode:'translation'})).toEqual([]);
 });
 it('offers a whole-line pattern to all repeats while preserving each occurrence duration',()=>{
   const lines=sample(),issue=syllableConsistency({lines,mode:'original'}).find(i=>i.msg.startsWith('Одинаковые'))!;
   const next=apply(lines,issue.batchFixes![1].changes);
   expect(next[0].text).toBe('У кора|бля');expect(next[0].sync!.orig!.slice(1)).toEqual([{a:2,b:3,g:1},{a:3,b:5}]);expect(next[1]).toBe(lines[1]);
 });
 it('does not invent a timing mapping for an inconsistent sync array',()=>{
   const lines=sample();lines[1].sync!.orig!.pop();const issues=syllableConsistency({lines,mode:'original'});
   expect(issues[0].batchFixes).toEqual([]);
 });
});
