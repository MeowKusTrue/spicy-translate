import { describe, expect, it } from 'vitest';
import { audioProgressPercent, audioStageFraction } from '../src/core/audioProgress.ts';
const plan=['upload','demucs','transcribe','align','cache'];
describe('combined audio progress',()=>{
 it('uses chunk counts when a stage only exposes a binary completion flag',()=>{
  expect(audioStageFraction({stage:'demucs',done:0,total:1,subDone:5,subTotal:10})).toBe(.5);
  expect(audioStageFraction({stage:'demucs',done:1,total:1,subDone:5,subTotal:10})).toBe(1);
 });
 it('prefers actual stage counters and does not count model bytes as recognized words',()=>{
  expect(audioStageFraction({stage:'transcribe',done:1,total:4,subDone:9,subTotal:10})).toBe(.25);
  expect(audioStageFraction({stage:'device',done:0,total:1,bytes:true,subDone:9,subTotal:10})).toBe(0);
 });
 it('retains completed separation when the next job loads recognition models',()=>{
  const separated=audioProgressPercent({stage:'demucs',done:1,total:1,plan});
  expect(audioProgressPercent({stage:'device',phase:'transcribe',done:0,total:0,plan,bytes:true,subDone:5,subTotal:10})).toBe(separated);
  expect(audioProgressPercent({stage:'transcribe',done:1,total:4,plan})).toBeGreaterThan(separated);
 });
 it('starts cached vocals directly at recognition without a separation stage',()=>{
  expect(audioProgressPercent({stage:'transcribe',done:0,total:4,plan:['upload','transcribe','align','cache']})).toBe(8);
 });
 it('does not invent progress when there is no counter or known phase',()=>{
  expect(audioProgressPercent({stage:'check',done:0,total:0,plan})).toBe(0);
  expect(audioStageFraction({stage:'align',done:-1,total:4})).toBe(0);
  expect(audioProgressPercent(null)).toBe(0);expect(audioStageFraction(null)).toBe(0);
 });
});
