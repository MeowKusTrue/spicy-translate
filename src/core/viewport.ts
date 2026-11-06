import type { Line } from './types.ts';
export const MAX_TIMELINE_SCALE = 1500;
export function timelineExtent(lines: Line[], declared=0) {
 let end=Math.max(1,Number.isFinite(declared)?declared:0);
 for(const l of lines){if(Number.isFinite(l.end))end=Math.max(end,l.end+1);for(const sy of Object.values(l.sync||{}))for(const x of sy||[])if(x.b!=null&&Number.isFinite(x.b))end=Math.max(end,x.b+1);}
 return end;
}
export function timelineView(start:number, scale:number, width:number, duration:number) {
 const w=Math.max(1,width), d=Math.max(1,duration), min=Math.min(20,w/d);
 const px=Math.max(min,Math.min(MAX_TIMELINE_SCALE,Number.isFinite(scale)?scale:140));
 return {px,start:Math.max(0,Math.min(Number.isFinite(start)?start:0,Math.max(0,d-w/px)))};
}
export function zoomTimeline(start:number,scale:number,width:number,duration:number,x:number,factor:number) {
 const anchor=Math.max(0,Math.min(width,x)), time=start+anchor/scale;
 const next=timelineView(start,scale*factor,width,duration);
 return timelineView(time-anchor/next.px,next.px,width,duration);
}
export function wheelZoomFactor(delta:number,mode=0,height=600) {
 const pixels=delta*(mode===1?16:mode===2?height:1);
 return Math.exp(-Math.max(-120,Math.min(120,pixels))*.0015);
}
export function fitTimeline(a:number,b:number,width:number,duration:number,padding=.12) {
 const span=Math.max(.12,b-a), pad=span*padding;
 return timelineView(Math.max(0,a-pad),width/(span+2*pad),width,duration);
}
/** Time divisions adapt to zoom instead of drawing thousands of labels in a wide view. */
export function timelineTick(scale:number) { const need=85/scale;return [ .05,.1,.2,.5,1,2,5,10,15,30,60,120,300,600,1800,3600 ].find(x=>x>=need)||Math.ceil(need/3600)*3600; }
