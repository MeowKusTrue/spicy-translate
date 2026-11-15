import { describe, expect, it } from 'vitest';
import { agentRows, assignAgent, assignWordAgent } from '../src/core/agents.ts';
import type { Line } from '../src/core/types.ts';
import { buildTTML } from '../src/core/export.ts';

describe('singer assignment', () => {
  it('resolves whole rows, words on multiple rows, and a lone cursor', () => {
    expect(agentRows([2,0], [{i:1}], {i:1}, 3)).toEqual([0,2]);
    expect(agentRows([], [{i:2},{i:0},{i:2}], {i:1}, 3)).toEqual([0,2]);
    expect(agentRows([], [], {i:1}, 3)).toEqual([1]);
    expect(agentRows([-1,NaN,1.5,9], [], null, 3)).toEqual([]);
    expect(agentRows([], [], null, 3)).toEqual([]);
  });
  it('changes only singers, preserving text, syllables, timings, backing and approval', () => {
    const line: Line = {t:1,end:3,text:'мо|ре',tr:'sea',bg:{text:'эхо',tr:'echo'},sec:'Припев',approved:{orig:true},sync:{orig:[{a:1,b:2},{a:2,b:3}],bgo:[{a:1,b:3}]}};
    const lines=[line,{...line,agent:'v2' as const}], before=structuredClone(lines);
    const next=assignAgent(lines,[0],'v1000');
    expect(lines).toEqual(before);expect(next[0]).toEqual({...line,agent:'v1000'});expect(next[1]).toBe(lines[1]);
    expect(assignAgent(next,[0],'v1')).toEqual(lines);
    expect(assignAgent(lines,[1],'v2')[1]).toBe(lines[1]);
  });
  it('exports all three choices as TTML singers without altering timing spans', () => {
    const lines: Line[] = [0,1,2].map(i => ({t:i*3,end:i*3+2,text:'голос',tr:'',sync:{orig:[{a:i*3,b:i*3+2}]}}));
    const result=assignAgent(assignAgent(lines,[1],'v2'),[2],'v1000');
    const xml=buildTTML({lines:result,mode:'original'});
    for (const id of ['v1','v2','v1000']) expect(xml).toContain(`ttm:agent="${id}"`);
    expect(xml).toContain('<ttm:agent type="group" xml:id="v1000"/>');
    expect(result.map(l=>l.sync)).toEqual(lines.map(l=>l.sync));
  });
});

describe('singer for selected words',()=>{
  const source=():Line=>({t:1,end:4,text:'первый ти|хий голос',tr:'first quiet voice',sec:'Припев',approved:{orig:true},
    sync:{orig:[{a:1,b:2},{a:2,b:2.5},{a:2.5,b:3},{a:3,b:4}],tr:[{a:1,b:2},{a:2,b:3},{a:3,b:4}],bgo:[{a:1.5,b:1.8,g:1,c:.6}]},bg:{text:'эх',tr:''}});
  it('expands syllables, partitions original and translation, and retains backing singer and exact spans',()=>{
    const line=source(),before=structuredClone(line),plan=assignWordAgent([line],[{i:0,k:1,layer:'orig'}],'v2');
    if('error' in plan) throw Error(plan.error);
    const main=plan.lines.filter(l=>l.text);
    expect(main.map(l=>l.text)).toEqual(['первый','ти|хий','голос']);expect(main.map(l=>l.tr)).toEqual(['first','quiet','voice']);
    expect(main.map(l=>l.agent||'v1')).toEqual(['v1','v2','v1']);
    expect(main.flatMap(l=>l.sync!.orig!)).toEqual(line.sync!.orig);expect(main.flatMap(l=>l.sync!.tr!)).toEqual(line.sync!.tr);
    const bg=plan.lines.find(l=>l.bg)!;expect(bg.agent).toBeUndefined();expect(bg.bg).toEqual(line.bg);expect(bg.sync!.bgo).toEqual(line.sync!.bgo);
    expect(plan.lines.filter(l=>l.sec)).toHaveLength(1);expect(plan.lines[0].sec).toBe('Припев');expect(plan.lines[plan.selected[0]].text).toBe('ти|хий');
    expect(line).toEqual(before);
    expect(buildTTML({lines:plan.lines,mode:'original'})).toContain('ttm:agent="v2"');
  });
  it('moves only selected backing words into a new backing phrase',()=>{
    const line=source();line.bg!.text='эх ага';line.sync!.bgo=[{a:1,b:2},{a:3,b:4}];
    const plan=assignWordAgent([line],[{i:0,k:1,layer:'bgo'}],'v1000');if('error' in plan) throw Error(plan.error);
    const main=plan.lines.find(l=>l.text)!;expect(main.text).toBe(line.text);expect(main.tr).toBe(line.tr);expect(main.agent).toBeUndefined();expect(main.sync!.orig).toEqual(line.sync!.orig);
    expect(plan.lines.filter(l=>l.bg).map(l=>[l.bg!.text,l.agent||'v1'])).toEqual([['эх','v1'],['ага','v1000']]);
  });
  it('supports disjoint selection without giving intervening words the new singer',()=>{
    const line=source();const plan=assignWordAgent([line],[{i:0,k:0,layer:'orig'},{i:0,k:3,layer:'orig'}],'v1000');if('error' in plan) throw Error(plan.error);
    expect(plan.lines.filter(l=>l.text).map(l=>l.agent||'v1')).toEqual(['v1000','v1','v1000']);
  });
  it('rejects incomplete parallel timing atomically instead of guessing translated word boundaries',()=>{
    const line=source();delete line.sync!.tr;const before=structuredClone(line);
    const plan=assignWordAgent([source(),line],[{i:0,k:1,layer:'orig'},{i:1,k:1,layer:'orig'}],'v2');expect(plan).toHaveProperty('error');expect(line).toEqual(before);
  });
  it('supports whole-word selection without timing when no subdivision is needed, and skips no-ops',()=>{
    const line:Line={t:1,end:4,text:'голос',tr:''};const plan=assignWordAgent([line],[{i:0,k:0,layer:'orig'}],'v2');if('error' in plan) throw Error(plan.error);
    expect(plan.lines[0].agent).toBe('v2');expect(plan.lines[0].t).toBe(1);expect(plan.lines[0].end).toBe(4);
    expect(assignWordAgent([line],[{i:0,k:0,layer:'orig'}],'v1')).toEqual({lines:[line],selected:[]});
  });
});

// invented lines only
const L = (t: number, tr: string, agent?: Line['agent']): Line => ({ t, end: t + 2, text: 'x y', tr, ...(agent ? { agent } : {}) });

describe('singers (ttm:agent)', () => {
  it('defaults to v1 and declares only v1', () => {
    const x = buildTTML({ lines: [L(1, 'жёлтый чайник')] });
    expect(x).toContain('ttm:agent="v1" itunes:key="L1"');
    expect(x).toContain('<ttm:agent type="person" xml:id="v1"/>');
    expect(x).not.toContain('xml:id="v2"');
  });
  it('writes v2 / v1000 per line and declares them in head (v1000 = group)', () => {
    const x = buildTTML({ lines: [L(1, 'жёлтый чайник'), L(3, 'синий кактус', 'v2'), L(5, 'тихий фонарь', 'v1000')] });
    expect(x).toContain('ttm:agent="v2" itunes:key="L2"');
    expect(x).toContain('ttm:agent="v1000" itunes:key="L3"');
    expect(x).toContain('<ttm:agent type="person" xml:id="v2"/>');
    expect(x).toContain('<ttm:agent type="group" xml:id="v1000"/>');
  });
});
