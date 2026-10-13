// Right column: Spicy-like preview (content painted by preview.ts into #lyrIn) + player.
import { memo } from 'react';
import { S, emit, ls } from '../state.ts';
import { pause, play, seekTo, setRate, setVolume } from '../audio.ts';
import { PV } from '../preview.ts';
import { loadAudioFile } from '../load.ts';

// React must never re-render the lyrics container's children: preview.ts owns them.
const Lyrics = memo(() => <div className="lyrics" id="lyr"><div className="lyrics-inner" id="lyrIn" /></div>);
const RATES = [0.5, 0.75, 1, 1.25];
let preMute = 0.3;

export function Stage() {
  const rates = RATES.includes(S.rate) ? RATES : [...RATES, S.rate];
  return <div className="stage">
    <div className="glow"></div>
    <div className="stage-top"><b id="pTitle">{S.meta.title || 'Превью'}</b><span id="pArtist">{S.lines.length || S.meta.artist ? S.meta.artist : 'Загрузи трек слева'}</span></div>
    <Lyrics />
    <div className="player">
      <button className="round" id="btnPlay" title="Играть / пауза (Space)" onClick={() => S.playing ? pause() : play()}>{S.playing ? '❚❚' : '▶'}</button>
      <input type="range" id="seek" min="0" max={S.duration} step="0.05" defaultValue="0" onChange={e => seekTo(parseFloat(e.target.value))} />
      <div className="time" id="clock">0:00 / 0:00</div>
      <label className="btn sm" title="Свой аудиофайл (можно просто перетащить на страницу)">♪ аудио<input type="file" id="fileAudio" accept="audio/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) loadAudioFile(f); }} /></label>
      <details className="menu up">
        <summary className="btn sm" title="Громкость, скорость, эффекты">⚙</summary>
        <div className="pop">
          <label className="opt"><span>Громкость</span><span className="row">
            <button className="sm" id="btnMute" onClick={() => { const v = S.vol; if (v > 0) { preMute = v; setVolume(0); } else setVolume(preMute || 0.3); }}>{S.vol === 0 ? '🔇' : '🔊'}</button>
            <input type="range" id="vol" min="0" max="1" step="0.01" value={S.vol} onChange={e => setVolume(parseFloat(e.target.value))} /></span></label>
          <label className="opt"><span>Скорость</span><select id="rate" value={String(S.rate)} onChange={e => setRate(parseFloat(e.target.value))}>{rates.map(r => <option key={r} value={String(r)}>{r}×</option>)}</select></label>
          <label className="opt"><span>Эффекты слов<small>подъём, свечение долгих</small></span><input type="checkbox" id="fxChk" checked={S.fx} onChange={e => { S.fx = e.target.checked; ls.set('fx', S.fx ? '1' : '0'); PV.lastAct = -2; emit(); }} /></label>
          <label className="opt"><span>Сдвиг анимации, мс<small>отстаёт → плюс, спешит → минус</small></span><input type="number" id="voff" step="10" defaultValue={S.voff} onChange={e => { S.voff = +e.target.value || 0; ls.set('voff', String(S.voff)); }} /></label>
        </div>
      </details>
    </div>
  </div>;
}
