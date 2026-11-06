import { describe, it, expect } from 'vitest';
import { timelineExtent, timelineView, zoomTimeline, fitTimeline, wheelZoomFactor, timelineTick, MAX_TIMELINE_SCALE } from '../src/core/viewport.ts';
import { spectralLevels } from '../src/waveform/spec.ts';
describe('timeline navigation',()=>{
 it('keeps the time beneath the pointer fixed while zooming both directions',()=>{for(const x of [0,111,799])for(const factor of [.8,1.2,3]){const v=zoomTimeline(30,100,800,300,x,factor);expect(v.start+x/v.px).toBeCloseTo(30+x/100,9);}});
 it('bounds scale and scroll without blank time after the song',()=>{expect(timelineView(-9,1e9,800,240)).toEqual({start:0,px:MAX_TIMELINE_SCALE});expect(timelineView(999,1,800,240)).toEqual({start:0,px:800/240});const v=timelineView(999,100,800,240);expect(v.start+800/v.px).toBe(240);});
 it('fits a selection with padding and the entire song exactly',()=>{const v=fitTimeline(30,40,800,240);expect(v.start).toBeLessThan(30);expect(v.start+800/v.px).toBeGreaterThan(40);expect(fitTimeline(0,240,800,240,0)).toEqual({start:0,px:800/240});});
 it('normalizes wheel units and caps high speed gestures',()=>{expect(wheelZoomFactor(1,1)).toBe(wheelZoomFactor(16));expect(wheelZoomFactor(1,2)).toBe(wheelZoomFactor(600));expect(wheelZoomFactor(1)).toBeGreaterThan(wheelZoomFactor(16));expect(wheelZoomFactor(1e6)).toBe(wheelZoomFactor(120));expect(wheelZoomFactor(-120)*wheelZoomFactor(120)).toBeCloseTo(1);});
 it('includes outlying words and bounds tick labels at any zoom',()=>{expect(timelineExtent([{t:0,end:5,text:'a',tr:'',sync:{bgo:[{a:30,b:45}]}}],20)).toBe(46);for(const px of [.01,.1,1,20,140,1500])expect(1600/px/timelineTick(px)).toBeLessThan(20);});
});
describe('spectral zoom levels',()=>{
 it('preserves narrow attacks, partial final columns and the source',()=>{const input=new Uint8Array(5001*2);input[700*2]=255;input[5000*2+1]=199;const copy=input.slice(),levels=spectralLevels(input,5001,2);expect(levels.map(x=>x.step)).toEqual([4,16]);expect(levels[0].data[175*2]).toBe(255);expect(levels.at(-1)!.data[Math.floor(5000/16)*2+1]).toBe(199);expect(levels.at(-1)!.cols).toBe(Math.ceil(5001/16));expect(input).toEqual(copy);expect(levels.reduce((n,l)=>n+l.data.length,0)).toBeLessThan(input.length*.34);});
 it('needs no reduced copy for short audio',()=>{expect(spectralLevels(new Uint8Array(128*100),100)).toEqual([]);});
});
