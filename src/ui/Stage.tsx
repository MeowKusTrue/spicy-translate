// Right column: Spicy-like preview (content painted by preview.ts into #lyrIn) over the album cover,
// its settings in the top-right corner, the player at the bottom.
import { memo, useEffect, type CSSProperties } from 'react';
import { S, emit, ls } from '../state.ts';
import { pause, play, seekTo, setRate, setVolume } from '../audio.ts';
import { PV } from '../preview.ts';
import { loadAudioFile } from '../load.ts';
import { trackKey } from '../persist.ts';
import { clearCover, findCover, restoreCover, setCover } from '../cover.ts';
import { restoreFolder } from '../folder.ts';
import { setTheme, theme, type Theme } from '../theme.ts';

// React must never re-render the lyrics container's children: preview.ts owns them.
const Lyrics = memo(() => <div className="lyrics" id="lyr"><div className="lyrics-inner" id="lyrIn" /></div>);
const RATES = [0.5, 0.75, 1, 1.25, 1.5];
let preMute = 0.3;

const flag = (k: 'fx' | 'blur' | 'coverBg', v: boolean) => { S[k] = v; ls.set(k, v ? '1' : '0'); PV.lastAct = -2; emit(); };
function Slider({ min, max, step, value, onChange, id, title }: { min: number; max: number; step: number; value: number; onChange: (v: number) => void; id?: string; title?: string }) {
  return <input type="range" className="rng" id={id} title={title} min={min} max={max} step={step} value={value}
    style={{ '--p': ((value - min) / (max - min)) * 100 + '%' } as CSSProperties} onChange={e => onChange(parseFloat(e.target.value))} />;
}
function Switch({ id, label, hint, on, set }: { id: string; label: string; hint?: string; on: boolean; set: (v: boolean) => void }) {
  return <label className="srow sw"><span>{label}{hint && <small>{hint}</small>}</span><input type="checkbox" role="switch" id={id} checked={on} onChange={e => set(e.target.checked)} /></label>;
}
function Seg<T extends string | number>({ items, value, set }: { items: [T, string][]; value: T; set: (v: T) => void }) {
  return <span className="sseg">{items.map(([v, t]) => <button key={String(v)} className={v === value ? 'on' : ''} onClick={() => set(v)}>{t}</button>)}</span>;
}

function Settings() {
  const voff = S.voff || 0, setVoff = (v: number) => { S.voff = v; ls.set('voff', String(v)); emit(); };
  return <details className="menu stset">
    <summary className="sbtn" title="Настройки превью и плеера">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 6h10M19 6h1M4 12h3M12 12h8M4 18h12M20 18h0" /><circle cx="16.5" cy="6" r="2.2" /><circle cx="9.5" cy="12" r="2.2" /><circle cx="18" cy="18" r="2.2" /></svg>
    </summary>
    <div className="pop sets">
      <div className="sh">Звук</div>
      <div className="srow">
        <button className="ic" id="btnMute" title="Без звука" onClick={() => { const v = S.vol; if (v > 0) { preMute = v; setVolume(0); } else setVolume(preMute || 0.3); }}>{S.vol === 0 ? '🔇' : S.vol < 0.4 ? '🔉' : '🔊'}</button>
        <Slider id="vol" min={0} max={1} step={0.01} value={S.vol} onChange={setVolume} title="Громкость" /><span className="val">{Math.round(S.vol * 100)}%</span>
      </div>
      <div className="srow" title="Клавиши [ и ] — медленнее / быстрее, ' — обычная"><span>Скорость</span><Seg items={RATES.map(r => [r, r + '×'] as [number, string])} value={S.rate} set={setRate} /></div>
      <div className="sh">Анимация</div>
      <Switch id="fxChk" label="Анимация как в Spicy Lyrics" hint="подъём и свечение слов, долгие слоги по буквам" on={S.fx} set={v => flag('fx', v)} />
      <Switch id="blurChk" label="Размывать соседние строки" on={S.blur} set={v => flag('blur', v)} />
      <div className="srow col">
        <span>Сдвиг анимации<small>отстаёт от звука → вправо, спешит → влево</small></span>
        <span className="srow"><Slider id="voff" min={-500} max={500} step={10} value={voff} onChange={setVoff} /><span className="val">{voff > 0 ? '+' : ''}{voff} мс</span>
          <button className="ic" title="Сбросить" disabled={!voff} onClick={() => setVoff(0)}>↺</button></span>
      </div>
      <div className="sh">Обложка</div>
      <Switch id="coverChk" label="Обложка за текстом" hint="размытый фон из обложки, как в Spicy" on={S.coverBg} set={v => flag('coverBg', v)} />
      <div className="srow cov">
        {S.cover ? <img src={S.cover} alt="" /> : <span className="noimg">нет</span>}
        <span className="row">
          <label className="btn sm" title="Картинку можно и просто перетащить на страницу">Файл…<input type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) setCover(f); e.target.value = ''; }} /></label>
          <button className="sm" title="Поиск обложки по исполнителю и названию (iTunes)" disabled={!S.meta.title} onClick={findCover}>Найти</button>
          <button className="sm" disabled={!S.cover} onClick={clearCover}>Убрать</button>
        </span>
      </div>
      <div className="sh">Интерфейс</div>
      <div className="srow"><span>Тема редактора</span><Seg items={[['auto', 'авто'], ['dark', 'чёрная'], ['light', 'белая']] as [Theme, string][]} value={theme()} set={t => { setTheme(t); emit(); }} /></div>
    </div>
  </details>;
}

export function Stage() {
  const key = trackKey();
  useEffect(() => { restoreCover(); restoreFolder(); }, [key]);
  const bg = S.coverBg && S.cover;
  return <div className={'stage' + (bg ? ' hascover' : '')}>
    {bg ? <div className="cbg" aria-hidden="true"><img src={S.cover} alt="" /><img src={S.cover} alt="" /></div> : <div className="glow"></div>}
    <div className="stage-top">
      {S.cover && <img className="art" src={S.cover} alt="" />}
      <div className="ttl"><b id="pTitle">{S.meta.title || 'Превью'}</b><span id="pArtist">{S.lines.length || S.meta.artist ? S.meta.artist : 'Загрузи трек слева'}</span></div>
      <Settings />
    </div>
    <Lyrics />
    <div className="player">
      <button className="round" id="btnPlay" title="Играть / пауза (Space)" onClick={() => S.playing ? pause() : play()}>{S.playing ? '❚❚' : '▶'}</button>
      <input type="range" id="seek" min="0" max={S.duration} step="0.05" defaultValue="0" onChange={e => seekTo(parseFloat(e.target.value))} />
      <div className="time" id="clock">0:00 / 0:00</div>
      <label className="btn sm" title="Свой аудиофайл (можно просто перетащить на страницу)">♪ аудио<input type="file" id="fileAudio" accept="audio/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) loadAudioFile(f); }} /></label>
    </div>
  </div>;
}
