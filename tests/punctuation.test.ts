import { describe, expect, it } from 'vitest';
import { attachPunctuation, punctuationLine, punctuationTrack } from '../src/core/punctuation.ts';
import { remapSync, replaceUnit } from '../src/core/edit.ts';
import { textDraftLine } from '../src/core/textDraft.ts';
import { importLyrics, parseTTML } from '../src/core/import.ts';
import { buildTTML } from '../src/core/export.ts';
import { transcriptionDraft } from '../src/core/transcription.ts';
import type { Line } from '../src/core/types.ts';

const line = (): Line => ({ t:1,end:5,text:'нам , пора !',tr:'us , now !',approved:{orig:true},sync:{orig:[{a:1,b:2},{a:2,b:2.4,g:1},{a:3,b:4,c:.9},{a:4,b:5,g:1}]},bg:{text:'эй !',tr:''}});
describe('automatic punctuation attachment',()=>{
 it('attaches closing punctuation immediately without touching openings, dashes or line breaks',()=>{
  expect(attachPunctuation('нам , пора ! ? … ( эй ) « да » — вот - так')).toBe('нам, пора!?… ( эй) « да» — вот - так');
  expect(attachPunctuation('нам\n, тебе\n!')).toBe('нам\n, тебе\n!');
  expect(attachPunctuation('сло|во , два\u00a0слова !')).toBe('сло|во, два\u00a0слова!');
 });
 it('removes punctuation blocks while retaining exact word spans, flags, syllables and other fields',()=>{
  const src=line(),before=structuredClone(src),fixed=punctuationLine(src);
  expect(fixed.text).toBe('нам, пора!');expect(fixed.tr).toBe('us, now!');expect(fixed.bg!.text).toBe('эй!');
  expect(fixed.sync!.orig).toEqual([src.sync!.orig![0],src.sync!.orig![2]]);expect(fixed.approved).toEqual(src.approved);expect(src).toEqual(before);
  expect(punctuationLine(fixed)).toBe(fixed);
  expect(punctuationTrack('сло|во|,', [{a:1,b:2},{a:2,b:3},{a:3,b:4}]).sync).toEqual([{a:1,b:2},{a:2,b:3}]);
 });
 it('preserves nonbreaking glued words and does not guess mismatched timing arrays',()=>{
  expect(punctuationTrack('нам\u00a0, потом', [{a:1,b:2},{a:3,b:4}])).toEqual({text:'нам, потом',sync:[{a:1,b:2},{a:3,b:4}]});
  expect(punctuationTrack('нам ,', [{a:1,b:2}])).toEqual({text:'нам,',sync:undefined});
 });
 it('keeps timing through normal text edits, word replacement and display drafts',()=>{
  const src=line();expect(remapSync(src.text,'нам, пора!',src.sync!.orig)).toEqual([src.sync!.orig![0],src.sync!.orig![2]]);
  const draft=textDraftLine(src,'orig','нам , пора !');expect(draft.text).toBe('нам, пора!');expect(draft.sync!.orig).toEqual([src.sync!.orig![0],src.sync!.orig![2]]);
  expect(replaceUnit('нам ,', [{a:1,b:2},{a:2,b:3}],1,',')!.sync).toEqual([{a:1,b:2}]);
  expect(replaceUnit('нам', [{a:1,b:2}],0,'нам ,')!.sync).toEqual([{a:1,b:2}]);
 });
 it('normalizes imports, recognition and exports automatically with no separate punctuation span',()=>{
  const src=line();expect(importLyrics('нам , пора !').lines[0].text).toBe('нам, пора!');
  expect(transcriptionDraft([src])[0].text).toBe('нам, пора!');
  const xml=buildTTML({lines:[src],mode:'original'});expect(xml).not.toContain('>,</span>');expect(xml).toContain('>нам,</span>');
  const parsed=parseTTML(xml)[0];expect(parsed.text).toBe('нам, пора!');expect(parsed.sync!.orig!.map(w=>[w.a,w.b])).toEqual([[1,2],[3,4]]);
 });
});
