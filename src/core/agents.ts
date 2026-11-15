import type { Agent, Layer, Line, WordSync } from './types.ts';
import { units, unitsText } from './words.ts';
import { editorText } from './editor.ts';

/** All rows represented by the selection, including words picked across several rows. */
export function agentRows(picked: Iterable<number>, words: { i: number }[], cursor: { i: number } | null, count: number): number[] {
  const rows = [...picked];
  return [...new Set(rows.length ? rows : words.length ? words.map(w => w.i) : cursor ? [cursor.i] : [])]
    .filter(i => Number.isInteger(i) && i >= 0 && i < count).sort((a,b) => a-b);
}

/** Preserve all text, timing, approval and section data; default singer stays implicit. */
export function assignAgent(lines: Line[], ids: number[], agent: Agent): Line[] {
  const selected = new Set(ids);
  return lines.map((line, i) => {
    if (!selected.has(i) || (line.agent || 'v1') === agent) return line;
    const next = { ...line };
    if (agent === 'v1') delete next.agent; else next.agent = agent;
    return next;
  });
}

export type AgentWord = { i: number; k: number; layer: Layer };
const validTiming = (sy: WordSync[] | undefined, n: number): sy is WordSync[] => !!sy && sy.length === n && sy.every(w => Number.isFinite(w.a) && Number.isFinite(w.b) && w.a! >= 0 && w.b! > w.a!);
const groups: Layer[][] = [['orig','tr'], ['bgo','bg']];
/** Split only at whole-word boundaries. Parallel language follows its own timing; backing keeps its singer. */
export function assignWordAgent(lines: Line[], words: AgentWord[], agent: Agent): { lines: Line[]; selected: number[] } | { error: string } {
  const out: Line[] = [], selected: number[] = [];
  for (const [i, line] of lines.entries()) {
    const picked = words.filter(w => w.i === i && units(editorText(line,w.layer))[w.k]);
    if (!picked.length || (line.agent || 'v1') === agent) { out.push(line); continue; }
    const fragments: { line: Line; chosen: boolean }[] = [];
    for (const pair of groups) {
      const chosen = picked.filter(w => pair.includes(w.layer));
      if (!pair.some(layer => editorText(line,layer).trim())) continue;
      const make = () => { const l: Line = {...line,text:'',tr:'',sync:{}}; delete l.bg; delete l.approved; delete l.sec; return l; };
      const put = (l: Line, layer: Layer, ids?: number[]) => {
        const text = ids ? unitsText(ids.map(k=>units(editorText(line,layer))[k])) : editorText(line,layer);
        if (!text) return;
        if (layer === 'orig') l.text = text; else if (layer === 'tr') l.tr = text;
        else { l.bg ||= {text:'',tr:''}; l.bg[layer === 'bgo' ? 'text' : 'tr'] = text; }
        if (line.sync?.[layer]) l.sync![layer] = (ids ? ids.map(k=>line.sync![layer]![k]) : line.sync[layer]!).map(w=>({...w}));
        if (line.approved?.[layer]) (l.approved ||= {})[layer] = true;
      };
      if (!chosen.length) { const l = make(); pair.forEach(layer=>put(l,layer)); fragments.push({line:l,chosen:false}); continue; }
      const layer = chosen[0].layer;
      if (chosen.some(w=>w.layer !== layer)) return {error:`Строка ${i+1}: для отдельных слов выдели один язык — оригинал или перевод.`};
      const us = units(editorText(line,layer)), ids = new Set(chosen.map(w=>w.k));
      // A picked syllable means its whole word, including adjacent syllables and the hyphen.
      for (const k of [...ids]) {
        for (let j=k; j>0 && !us[j-1].sp; j--) ids.add(j-1);
        for (let j=k; j<us.length-1 && !us[j].sp; j++) ids.add(j+1);
      }
      if (ids.size === us.length) {
        const l=make(); pair.forEach(p=>put(l,p)); const assigned=assignAgent([l],[0],agent)[0]; fragments.push({line:assigned,chosen:true}); continue;
      }
      const sy=line.sync?.[layer];
      if (!validTiming(sy,us.length) || sy.some((w,k)=>k>0 && w.a! < sy[k-1].b!-.002)) return {error:`Строка ${i+1}: сначала задай времена слов без наложений или выбери «Для строк целиком».`};
      const runs: { ids:number[]; chosen:boolean; line:Line }[]=[];
      us.forEach((_,k)=>{const flag=ids.has(k);if (!runs.length || runs.at(-1)!.chosen !== flag) runs.push({ids:[],chosen:flag,line:make()});runs.at(-1)!.ids.push(k);});
      for (const run of runs) {
        put(run.line,layer,run.ids);run.line.t=sy[run.ids[0]].a!;run.line.end=sy[run.ids.at(-1)!].b!;
        if (run.chosen) run.line=assignAgent([run.line],[0],agent)[0];
      }
      const other=pair.find(p=>p!==layer)!;
      const parallel=units(editorText(line,other));
      if (parallel.length) {
        const timing=line.sync?.[other];
        if (!validTiming(timing,parallel.length)) return {error:`Строка ${i+1}: для разделения фразы нужны времена и оригинала, и перевода. Разметь вторую дорожку или назначь исполнителя строке целиком.`};
        const buckets=runs.map(()=>[] as number[]);
        for (let k=0;k<parallel.length;) {
          let end=k;while(end<parallel.length-1 && !parallel[end].sp) end++;
          const a=Math.min(...timing.slice(k,end+1).map(w=>w.a!)), b=Math.max(...timing.slice(k,end+1).map(w=>w.b!));
          let best=0, score=-Infinity;
          runs.forEach((r,j)=>{const overlap=Math.max(0,Math.min(b,r.line.end)-Math.max(a,r.line.t));const rank=overlap>0?overlap: -Math.abs((a+b-r.line.t-r.line.end)/2);if(rank>score){score=rank;best=j;}});
          for(;k<=end;k++) buckets[best].push(k);
        }
        buckets.forEach((bucket,j)=>{if(bucket.length) put(runs[j].line,other,bucket);});
      }
      for (const run of runs) {
        const times=Object.values(run.line.sync!).flat();
        run.line.t=Math.min(...times.map(w=>w.a!));run.line.end=Math.max(...times.map(w=>w.b!));
        fragments.push({line:run.line,chosen:run.chosen});
      }
    }
    fragments.sort((a,b)=>a.line.t-b.line.t);
    if (line.sec && fragments.length) fragments[0].line.sec=line.sec;
    for(const fragment of fragments){if(fragment.chosen) selected.push(out.length);out.push(fragment.line);}
  }
  return {lines:out,selected};
}
