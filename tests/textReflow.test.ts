import {expect,it} from 'vitest';
import {reflowTextRows,type Line} from '../src/core/index.ts';

const lines = (): Line[] => [
  {t:0,end:5,text:'тихое мо|ре',tr:'',agent:'v2',sync:{orig:[{a:1,b:2,c:.9},{a:3,b:3.5},{a:3.5,b:4}]}},
  {t:6,end:9,text:'снова море',tr:'',agent:'v2',sync:{orig:[{a:6,b:7},{a:8,b:9}]}}
];
it('moves timed words and syllables across rows without changing order, flags or source',()=>{
  const source=lines(),before=structuredClone(source);
  const result=reflowTextRows(source,[{o:'тихое',t:''},{o:'мо|ре снова',t:''},{o:'море',t:''}],false)!;
  if(!('lines' in result)) throw Error(result.error);
  expect(result.lines.flatMap(l=>l.sync!.orig)).toEqual(source.flatMap(l=>l.sync!.orig));
  expect(result.lines.map(l=>[l.t,l.end,l.agent])).toEqual([[1,2,'v2'],[3,7,'v2'],[8,9,'v2']]);
  expect(source).toEqual(before);
});
it('splits only the moved word span and preserves all other word times exactly',()=>{
  const source:Line[]=[{t:0,end:9,text:'тихое корабля дальше',tr:'',sync:{orig:[{a:1,b:2},{a:3,b:6},{a:7,b:8}]}}];
  const result=reflowTextRows(source,[{o:'тихое ко',t:''},{o:'рабля дальше',t:''}],false)!;
  if(!('lines' in result)) throw Error(result.error);
  const spans=result.lines.flatMap(l=>l.sync!.orig!);
  expect(spans[0]).toEqual(source[0].sync!.orig![0]);expect(spans[3]).toEqual(source[0].sync!.orig![2]);
  expect(spans[1]).toEqual({a:3,b:3.857,g:1});expect(spans[2]).toEqual({a:3.857,b:6,g:1});
});
it('moves both languages and backings with their own sync, and keeps unchanged row bounds',()=>{
  const source:Line[]=[{t:0,end:10,text:'один два',tr:'one two',bg:{text:'эхо',tr:'echo'},sync:{orig:[{a:1,b:2},{a:3,b:4}],tr:[{a:1.1,b:2.1},{a:3.1,b:4.1}],bgo:[{a:3.4,b:4.4}],bg:[{a:3.5,b:4.5}]}}];
  const same=reflowTextRows(source,[{o:'один два (эхо)',t:'one two (echo)'}],true)!;
  if(!('lines' in same)) throw Error(same.error);
  expect(same.lines[0].t).toBe(0);expect(same.lines[0].end).toBe(10);
  const result=reflowTextRows(source,[{o:'один',t:'one'},{o:'два (эхо)',t:'two (echo)'}],true)!;
  if(!('lines' in result)) throw Error(result.error);
  for(const layer of ['orig','tr','bgo','bg'] as const) expect(result.lines.flatMap(l=>l.sync?.[layer]||[])).toEqual(source[0].sync![layer]);
});
it('refuses mixed singers instead of silently losing one, and leaves real text edits to normal mapping',()=>{
  const source=lines();source[1].agent='v1';
  expect(reflowTextRows(source,[{o:'тихое мо|ре снова море',t:''}],false)).toHaveProperty('error');
  expect(reflowTextRows(source,[{o:'другие слова',t:''}],false)).toBeNull();
  expect(reflowTextRows([{t:0,end:1,text:'abcdefghij',tr:'',sync:{orig:[{a:0,b:.001}]}}],[{o:'a',t:''},{o:'bcdefghij',t:''}],false)).toHaveProperty('error');
});
