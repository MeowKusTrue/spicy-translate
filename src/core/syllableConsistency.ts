import { editorText } from './editor.ts';
import { units, unitsText } from './words.ts';
import type { ExportOpts, Layer, Line, WordSync } from './types.ts';
import type { ExportIssue } from './exportLint.ts';

type Word = { start:number; end:number; k:number; raw:string; plain:string; key:string; prefix:number; size:number; cuts:number[] };
type Row = { i:number; layer:Layer; words:Word[]; text:string };
export function exportedLayers(line:Line, mode:ExportOpts['mode']='translation'):Layer[] {
  const main:Layer=mode==='translation'&&line.tr.trim()?'tr':'orig';
  const result:Layer[]=[main];
  if(mode==='bilingual'&&line.tr.trim()) result.push('tr');
  if(line.bg&&(mode!=='bilingual'||!editorText(line,main).trim()||!line.tr.trim())) result.push(mode!=='original'&&line.bg.tr.trim()?'bg':'bgo');
  return result;
}
function words(text:string):Word[] {
  let k=0;
  return [...text.matchAll(/[^\s\u00a0]+(?:\u00a0[^\s\u00a0]+)*/gu)].map(m=>{
    const us=units(m[0]),raw=unitsText(us),plain=raw.replace(/\|/g,''),prefix=plain.search(/[\p{L}\p{N}]/u);
    const tail=plain.match(/[^\p{L}\p{N}]*$/u)?.[0].length||0,size=plain.length-prefix-tail;
    let offset=0;const cuts:number[]=[];
    for(const u of us.slice(0,-1)){offset+=u.w.length;if(offset>prefix&&offset<prefix+size)cuts.push(offset-prefix);}
    const result={start:m.index!,end:m.index!+m[0].length,k,raw,plain,key:prefix<0?'':plain.slice(prefix,prefix+size).toLowerCase(),prefix,size,cuts};k+=us.length;return result;
  });
}
function marked(word:Word,cuts:number[]) {
  let result='',at=0;
  for(const cut of cuts){const end=word.prefix+cut;result+=word.plain.slice(at,end)+'|';at=end;}
  return (result+word.plain.slice(at)).replace(/\|([-‐‑]+)/gu,'$1|');
}
/** Keep old matching boundaries and interpolate only genuinely new ones inside the word. */
function retime(old:string,next:string,sy:WordSync[]):WordSync[] {
  let at=0;const spans=units(old).map((u,k)=>{const span={start:at,end:at+u.w.length,sy:sy[k]};at=span.end;return span;});
  const time=(offset:number,end:boolean) => {
    const span=spans.find(s=>end?s.start<offset&&offset<=s.end:s.start<=offset&&offset<s.end);
    if(!span)return null;
    if(offset===span.start)return span.sy.a;if(offset===span.end)return span.sy.b;
    if(span.sy.a==null||span.sy.b==null||!Number.isFinite(span.sy.a)||!Number.isFinite(span.sy.b))return null;
    return span.sy.a+(span.sy.b-span.sy.a)*(offset-span.start)/(span.end-span.start);
  };
  at=0;return units(next).map(u=>{
    const start=at,end=at+u.w.length;at=end;const same=spans.find(s=>s.start===start&&s.end===end);
    return same?{...same.sy}:{a:time(start,false),b:time(end,true),g:1};
  });
}
/** No text/spacing/case changes; one row can contain multiple changed words and layers. */
function changes(lines:Line[], edits:{row:Row; replacements:Map<number,number[]>}[]):{i:number;line:Line}[] | null {
  const result=new Map<number,Line>();
  for(const {row,replacements} of edits){
    const source=result.get(row.i)||lines[row.i],text=editorText(source,row.layer),tokens=words(text),sy=source.sync?.[row.layer];
    if(sy&&sy.length!==units(text).length)return null;
    let updated='',at=0,changed=false;const sync:WordSync[]=[];
    for(const w of tokens){
      const cuts=replacements.get(w.start),next=cuts?marked(w,cuts):w.raw;
      updated+=text.slice(at,w.start)+(cuts?next:text.slice(w.start,w.end));at=w.end;
      const differs=next!==w.raw;changed ||= differs;
      if(sy){const slice=sy.slice(w.k,w.k+units(w.raw).length);sync.push(...(differs?retime(w.raw,next,slice):slice.map(s=>({...s}))));}
    }
    if(!changed)continue;
    updated+=text.slice(at);const line=structuredClone(source);
    if(row.layer==='orig')line.text=updated;else if(row.layer==='tr')line.tr=updated;else line.bg![row.layer==='bgo'?'text':'tr']=updated;
    if(sy)line.sync={...line.sync,[row.layer]:sync};
    if(line.approved){delete line.approved[row.layer];if(!Object.keys(line.approved).length)delete line.approved;}
    result.set(row.i,line);
  }
  return [...result].map(([i,line])=>({i,line}));
}
const language=(layer:Layer)=>layer==='orig'||layer==='bgo'?'orig':'tr';
const signature=(w:Word)=>w.cuts.join(',');
/** Offer existing patterns, including an unsplit word; never silently choose the majority. */
export function syllableConsistency(o:ExportOpts):ExportIssue[] {
  if(o.wordSpread===false&&o.mode!=='bilingual')return [];
  const rows:Row[]=o.lines.flatMap((line,i)=>exportedLayers(line,o.mode||'translation').map(layer=>({i,layer,text:editorText(line,layer),words:words(editorText(line,layer))}))).filter(r=>r.words.length);
  const wordGroups=new Map<string,{row:Row;word:Word}[]>(),lineGroups=new Map<string,Row[]>();
  for(const row of rows){
    const key=language(row.layer)+':'+row.words.map(w=>w.plain.toLowerCase()).join(' ');lineGroups.set(key,[...(lineGroups.get(key)||[]),row]);
    for(const word of row.words)if(word.key&&!word.plain.includes('\u00a0')){const key=language(row.layer)+':'+word.key;wordGroups.set(key,[...(wordGroups.get(key)||[]),{row,word}]);}
  }
  const issues:ExportIssue[]=[];
  const advice='Выбери один из существующих вариантов или оставь разные, если так поётся. Начало и конец каждого слова сохраняются; новые границы слогов будут черновиком. Ctrl+Z отменяет всё применение.';
  for(const group of wordGroups.values()){
    const variants=new Map<string,typeof group>();for(const x of group){const key=signature(x.word);variants.set(key,[...(variants.get(key)||[]),x]);}
    if(variants.size<2)continue;
    const first=group[0],batchFixes:NonNullable<ExportIssue['batchFixes']>=[];
    for(const variant of variants.values()){
      const source=variant[0].word,byRow=new Map<Row,Map<number,number[]>>();
      for(const {row,word} of group){const map=byRow.get(row)||new Map();map.set(word.start,source.cuts);byRow.set(row,map);}
      const plan=changes(o.lines,[...byRow].map(([row,replacements])=>({row,replacements})));
      if(plan?.length)batchFixes.push({label:`Везде «${marked({...source,plain:source.key,prefix:0},source.cuts)}» (${group.length} вхожд.)`,changes:plan});
    }
    issues.push({i:first.row.i,layer:first.row.layer,sev:'warn',msg:`Разное разбиение слова «${first.word.key}».`,advice,batchFixes,
      examples:[...variants.values()].map(variant=>({text:variant[0].word.raw,locations:variant.map(x=>({i:x.row.i,layer:x.row.layer}))}))});
  }
  for(const group of lineGroups.values()){
    const variants=new Map<string,Row[]>();for(const row of group){const key=row.words.map(signature).join(';');variants.set(key,[...(variants.get(key)||[]),row]);}
    if(variants.size<2)continue;
    const batchFixes:NonNullable<ExportIssue['batchFixes']>=[];
    for(const variant of variants.values()){
      const source=variant[0];
      const plan=changes(o.lines,group.map(row=>({row,replacements:new Map(row.words.map((w,k)=>[w.start,source.words[k].cuts]))})));
      if(plan?.length)batchFixes.push({label:`Повторы — как в строке ${source.i+1}: «${source.text}»`,changes:plan});
    }
    issues.push({i:group[0].i,layer:group[0].layer,sev:'warn',msg:'Одинаковые строки разбиты по слогам по-разному.',advice,batchFixes,
      examples:[...variants.values()].map(variant=>({text:variant[0].text,locations:variant.map(r=>({i:r.i,layer:r.layer}))}))});
  }
  return issues.map(issue=>issue.batchFixes?.length?issue:{...issue,advice:'Разбиение отличается, но массив таймингов не соответствует тексту. Сначала исправь разметку этой дорожки в редакторе; автоматическое сопоставление здесь ненадёжно.'});
}
