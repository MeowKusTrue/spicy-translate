import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addBacking, alignArgs, recommendedModels, wordAlignmentScope, prepareWordAlignment, mergeWordAlignment, alignmentSelection } from '../src/core/autoAlign.ts';
import type { Line } from '../src/core/types.ts';

describe('auto alignment models and backing import', () => {
  it('suggests a starting point for the selected hardware and song language', () => {
    expect(recommendedModels('cuda', 'ru')).toEqual({ sep: 'roformer', asr: 'turbo', aligner: 'w2v' });
    expect(recommendedModels('cpu', 'en')).toEqual({ sep: 'htdemucs', asr: 'turbo', aligner: 'w2v' });
    expect(recommendedModels('dml', 'fr')).toEqual({ sep: 'htdemucs', asr: 'turbo', aligner: 'mms' });
    expect(recommendedModels('xpu', 'ru').sep).toBe('htdemucs');
  });
  it('forwards supported models and backing recognition only', () => {
    expect(alignArgs(new URLSearchParams('sep=roformer&asr=large-v3&aligner=mms&detectBack=1&transcribe=1&lang=ru')))
      .toEqual(['--sep', 'roformer', '--asr', 'large-v3', '--aligner', 'mms', '--transcribe', '--detect-back', '--song-lang', 'ru']);
    expect(alignArgs(new URLSearchParams('sep=../../file&asr=--force&aligner=evil&lang=--force&detectBack=true')))
      .toEqual(['--sep', 'htdemucs', '--asr', 'turbo', '--aligner', 'w2v']);
  });
  it('opts into locating known lyrics explicitly and rejects truthy strings', () => {
    expect(alignArgs(new URLSearchParams('locateLines=1'))).toContain('--locate-lines');
    expect(alignArgs(new URLSearchParams('locateLines=true'))).not.toContain('--locate-lines');
    expect(alignArgs(new URLSearchParams(''))).not.toContain('--locate-lines');
  });
  it('adds overlapping backing lines without changing lead, translation or hand timings; skips duplicates', () => {
    const lines: Line[] = [{ t: 1, end: 4, text: 'original', tr: 'перевод', sync: { orig: [{ a: 1, b: 4 }] }, bg: { text: 'эхо', tr: 'echo' } }];
    const original = structuredClone(lines);
    const c: Line = { t: 2, end: 3, text: '', tr: '', bg: { text: 'новый бэк', tr: '' }, sync: { bgo: [{ a: 2, b: 2.5, g: 1 }, { a: 2.5, b: 3, g: 1 }] } };
    const result = addBacking(lines, [c, c, { ...c, bg: { text: 'Э|ХО!', tr: '' } }, { ...c, end: NaN }]);
    expect(lines).toEqual(original);
    expect(result).toHaveLength(2); expect(result[0]).toEqual(lines[0]);
    expect(result[1].sync?.bgo).toEqual(c.sync?.bgo);
    expect(addBacking(result, [c])).toEqual(result);
  });
  it('keeps API versions aligned and packages the lyric locator', () => {
    const files = ['../server/index.ts', '../src/live.ts', '../scripts/launch.mjs', '../desktop/src-tauri/src/main.rs'];
    const versions = files.map(file => fs.readFileSync(new URL(file, import.meta.url), 'utf8').match(/(?:SERVER_API|API)(?::\s*u32)?\s*=\s*(\d+)/)?.[1]);
    expect(versions).not.toContain(undefined); expect(new Set(versions).size).toBe(1);
    const config = JSON.parse(fs.readFileSync(new URL('../desktop/src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
    expect(config.bundle.resources['../../experiments/auto-align/line_windows.py']).toBe('auto-align/line_windows.py');
  });
  it('allows the dialog command used by native confirmation in the desktop editor', () => {
    const c = JSON.parse(fs.readFileSync(new URL('../desktop/src-tauri/capabilities/editor.json', import.meta.url), 'utf8'));
    expect(c.permissions).toContain('dialog:allow-message');
    expect(c.windows).toContain('main');
  });
});


describe('word timing retry on already synced projects', () => {
  const line = (): Line => ({ t: 0, end: 3, text: 'Старые слова', tr: 'Translation', approved: {orig:true}, sync: {orig:[{a:0,b:1},{a:1,b:3}],tr:[{a:0,b:3}]} });
  const result = (): Line => ({t:0,end:3,text:'Старые слова',tr:'',sync:{orig:[{a:.3,b:1.2,g:1},{a:1.5,b:2.8,g:1}]}});
  it('identifies complete and protected layers rather than starting a silent no-op',()=>{
    expect(wordAlignmentScope([line()])).toEqual({pending:0,protectedLayers:1});
    expect(wordAlignmentScope([{t:0,end:3,text:'Новый текст',tr:''}])).toEqual({pending:1,protectedLayers:0});
  });
  it('unlocks only request copies and applies an explicitly confirmed replacement with translation intact',()=>{
    const before=line(), request=prepareWordAlignment([before],true);
    expect(before.approved?.orig).toBe(true); expect(request[0].approved).toBeUndefined();
    expect(request[0].sync!.orig!.every(w=>w.g)).toBe(true);
    expect(mergeWordAlignment(before,result(),before)).toBeNull();
    const next=mergeWordAlignment(before,result(),before,true)!;
    expect(next.sync!.orig).toEqual(result().sync!.orig);expect(next.sync!.tr).toEqual(before.sync!.tr);
    expect(next.tr).toBe(before.tr);expect(next.approved).toBeUndefined();expect(before.approved?.orig).toBe(true);
  });
  it('never applies a stale retry or unlocks a protected layer without valid timings',()=>{
    const before=line(), changed=structuredClone(before);changed.sync!.orig![0].b=.9;
    expect(mergeWordAlignment(changed,result(),before,true)).toBeNull();
    const bad=result();bad.sync!.orig![0].b=NaN;
    expect(mergeWordAlignment(before,bad,before,true)).toBeNull();
    expect(before.approved?.orig).toBe(true);
  });
  it('sends the full song for repeat context while protecting everything outside the selection',()=>{
    const lines: Line[]=[line(),line(),{...result(),approved:{bgo:true}}];
    const before=structuredClone(lines), request=prepareWordAlignment(lines,true,[1]);
    expect(request).toHaveLength(3);
    expect(request[0].approved).toEqual({orig:true,bgo:true});
    expect(request[0].sync).toEqual(lines[0].sync);
    expect(request[1].approved).toBeUndefined();expect(request[1].sync!.orig!.every(w=>w.g)).toBe(true);
    expect(request[2].approved).toEqual({orig:true,bgo:true});
    expect(request[2].sync).toEqual(lines[2].sync);
    expect(lines).toEqual(before);
  });
});

it('uses selected phrase rows or canvas words consistently and never treats a lone cursor as selection',()=>{
  expect(alignmentSelection(new Set(),[{i:18},{i:17},{i:18}],35)).toEqual([17,18]);
  expect(alignmentSelection(new Set([25,22]),[{i:17}],35)).toEqual([22,25]);
  expect(alignmentSelection(new Set(),[],35)).toBeNull();
});
