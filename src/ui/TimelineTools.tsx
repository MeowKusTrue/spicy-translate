import { useSyncExternalStore } from 'react';
import { S, emit, isTr, ls, mkLayer } from '../state.ts';
import { setLayer } from '../sync.ts';
import { W, subscribeViewport, getViewportSnapshot, songLen, zoomAt, fitSong, fitSelection, centerPlayhead, toggleFollow, navigateTimeline, drawWave } from '../waveform/wave.ts';
import { mmss, MAX_TIMELINE_SCALE } from '../core/index.ts';
export function TimelineTools(){
 useSyncExternalStore(subscribeViewport,getViewportSnapshot);
 const width=document.getElementById('wave')?.clientWidth||800, min=Math.min(20,width/songLen()), level=Math.log(W.px/min)/Math.log(MAX_TIMELINE_SCALE/min)*100;
 const view=(v:typeof S.waveView)=>{S.waveView=v;ls.set('waveView',v);emit();drawWave();};
 return <div className="timeline-tools" id="timelineTools">
  <div className="timeline-title"><b>Таймлайн</b><small>{S.layer==='orig'||S.layer==='bgo'?'Оригинал':'Перевод'}</small></div>
  <div className="timeline-views"><button aria-pressed={S.waveView==='wave'} onClick={()=>view('wave')}>Волна</button><button aria-pressed={S.waveView==='spec'} onClick={()=>view('spec')}>Спектр</button></div>
  <div className="timeline-navigation"><button id="timelineFitSong" onClick={fitSong}>Вся песня</button><button id="timelineFitSelection" disabled={!S.sel&&!S.picked.size&&!W.multi.length} onClick={fitSelection}>Выделение</button><button id="timelineCursor" onClick={centerPlayhead}>Курсор</button></div>
  <button className="timeline-follow" id="timelineFollow" aria-pressed={W.follow} onClick={toggleFollow}>{W.follow?'● Слежение':'○ Свободно'}</button>
  <div className="timeline-zoom"><button aria-label="Отдалить таймлайн" onClick={()=>zoomAt(width/2,1/1.35)}>−</button><input id="timelineZoom" aria-label="Масштаб таймлайна" type="range" min="0" max="100" step="0.25" value={Math.max(0,Math.min(100,level))} onKeyDown={e=>{if(e.key.startsWith('Arrow')||e.key==='Home'||e.key==='End')e.stopPropagation();}} onChange={e=>zoomAt(width/2,min*Math.pow(MAX_TIMELINE_SCALE/min,+e.target.value/100)/W.px)}/><button aria-label="Приблизить таймлайн" onClick={()=>zoomAt(width/2,1.35)}>+</button><output id="timelineScale" title="Пикселей на секунду">{Math.round(W.px)} px/с</output></div>
 </div>;
}
export function TimelineHeaders(){
 useSyncExternalStore(subscribeViewport,getViewportSnapshot);
 return <div className="timeline-headers" aria-label="Дорожки таймлайна">
  <button className={'lane-heading main-heading'+(!S.layer.startsWith('bg')?' active':'')} onClick={()=>setLayer(mkLayer(false,isTr(S.layer)))}><i/><b>Основа</b><small>{W.wordN.main>1?`${W.wordN.main} голоса`:'Ведущий голос'}</small></button>
  <button className={'lane-heading back-heading'+(S.layer.startsWith('bg')?' active':'')} onClick={()=>setLayer(mkLayer(true,isTr(S.layer)))}><i/><b>Бэки</b><small>{W.wordN.bg>1?`${W.wordN.bg} голоса`:'Второй план'}</small></button>
  <div className="lane-heading audio-heading"><b>Показать</b><small>{S.waveVoice?'Выделенный голос':'Весь трек'}</small><div><button aria-pressed={!S.waveVoice} aria-label="Показать полный микс" onClick={()=>{S.waveVoice=false;emit();drawWave();}}>Микс</button><button disabled={!W.vpeaks} aria-pressed={S.waveVoice} aria-label="Показать выделенный голос" title={W.vpeaks?'Показать волну голоса (не меняет звук)':'Сначала выдели голос через автоматизацию'} onClick={()=>{S.waveVoice=true;emit();drawWave();}}>Голос</button></div></div>
  <div className="lane-heading phrases-heading"><b>Строки</b></div>
 </div>;
}
export function TimelinePosition(){
 useSyncExternalStore(subscribeViewport,getViewportSnapshot);
 const width=document.getElementById('wave')?.clientWidth||800,span=width/W.px,end=Math.min(songLen(),W.start+span),max=Math.max(0,songLen()-span);
 return <div className="timeline-position"><span id="timelineRange">{mmss(W.start)} — {mmss(end)}</span><input id="timelinePan" aria-label="Перемещение по таймлайну" type="range" min="0" max={max} step="0.01" value={Math.min(max,W.start)} disabled={!max} onKeyDown={e=>{if(e.key.startsWith('Arrow')||e.key==='Home'||e.key==='End')e.stopPropagation();}} onChange={e=>navigateTimeline(+e.target.value)}/><small>Ctrl + колесо — масштаб у указателя</small></div>;
}
