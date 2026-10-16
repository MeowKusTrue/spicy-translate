// «Метаданные песни» like the AMLL TTML tool: a key with several values. «Автор песни» goes to Apple <songwriters>
// (Spicy Lyrics shows them as «Written by»), the rest to <amll:meta key value>.
import { useState } from 'react';
import type { MetaEntry } from '../core/index.ts';
import { S, emit } from '../state.ts';
import { scheduleSave } from '../persist.ts';
import { geniusWriters } from '../genius.ts';

export const META_KEYS: [key: string, label: string, icon: string][] = [
  ['musicName', 'Название трека', '♪'], ['artists', 'Исполнители', '👤'], ['songwriter', 'Автор песни', '✍'],
  ['album', 'Название альбома', '💿'], ['cover_art', 'Обложка (ссылка)', '🖼'],
];
const ONE_NAME = new Set(['artists', 'songwriter']); // one person per value, like AMLL asks
const NAMES_SEP = /\s*[,;、，；]\s*|\s+&\s+/;

const change = (f: () => void) => { f(); emit(); scheduleSave(); };
export const openMeta = () => { S.metaEd = true; emit(); };
const close = () => { S.metaEd = false; emit(); };
const focusAt = (key: string, i: number) => setTimeout(() => {
  const all = document.querySelectorAll<HTMLInputElement>(`#metaEd input[data-k="${CSS.escape(key)}"]`), el = all[Math.min(i, all.length - 1)];
  el?.focus(); el?.setSelectionRange(el.value.length, el.value.length);
});
function add(key: string, v = '') {
  let i = 0;
  change(() => { const e = S.meta.md.find(m => m.key === key); if (e) { e.value.push(v); i = e.value.length - 1; } else S.meta.md.push({ key, value: [v] }); });
  focusAt(key, i);
}
/** every standard field that is missing; title and artist come from the track */
function presets() {
  change(() => META_KEYS.forEach(([k]) => {
    if (S.meta.md.some(m => m.key === k)) return;
    S.meta.md.push({ key: k, value: [k === 'musicName' ? S.meta.title : k === 'artists' ? S.meta.artist : ''] });
  }));
}

function Entry({ e }: { e: MetaEntry }) {
  const def = META_KEYS.find(k => k[0] === e.key), joined = ONE_NAME.has(e.key) && e.value.some(v => NAMES_SEP.test(v.trim()));
  const del = (i: number) => change(() => { e.value.splice(i, 1); if (!e.value.length) S.meta.md.splice(S.meta.md.indexOf(e), 1); });
  const split = () => change(() => { e.value = [...new Set(e.value.flatMap(v => v.split(NAMES_SEP)).map(v => v.trim()).filter(Boolean))]; });
  return <tbody>
    {e.value.map((v, i) => <tr key={i}>
      <td>{i === 0 && <span className="mkey">{def ? <>{def[2]} {def[1]}<small>{e.key}</small></> : e.key}</span>}</td>
      <td><div className="row"><input type="text" data-k={e.key} value={v} onChange={x => change(() => { e.value[i] = x.target.value; })}
        onKeyDown={x => {
          if (x.key === 'Enter') { x.preventDefault(); change(() => e.value.splice(i + 1, 0, '')); focusAt(e.key, i + 1); }
          else if (x.key === 'Backspace' && !v && !x.repeat) { x.preventDefault(); del(i); focusAt(e.key, i - 1); }
        }} />
        <button className="sm ic" title="Удалить значение" onClick={() => del(i)}>✕</button></div></td>
    </tr>)}
    <tr><td /><td>
      {joined && <p className="hint warn">По одному имени в поле, а не через запятую. <button className="sm" onClick={split}>Разделить</button></p>}
      <button className="sm" title="Ещё значение (или Enter в поле)" onClick={() => add(e.key)}>+ ещё</button>
    </td></tr>
  </tbody>;
}

export function MetaModal() {
  const [ck, setCk] = useState(''), md = S.meta.md;
  const addCustom = () => { const k = ck.trim(); if (k && !k.startsWith('amll:')) { add(k); setCk(''); } };
  return <div className="modal" id="metaEd" hidden={!S.metaEd} onClick={e => { if ((e.target as Element).id === 'metaEd') close(); }}>
    <div className="help meta">
      <button className="sm ic close" title="Закрыть (Esc)" onClick={close}>✕</button>
      <h3>Метаданные песни</h3>
      <table className="mtable">
        <thead><tr><th>Ключ</th><th>Значение</th></tr></thead>
        {md.length ? md.map(e => <Entry key={e.key} e={e} />) : <tbody><tr><td colSpan={2} className="hint" style={{ textAlign: 'center', padding: 18 }}>Нет метаданных</td></tr></tbody>}
      </table>
      <div className="row mfoot">
        <select value="" onChange={x => { if (x.target.value) add(x.target.value); }}>
          <option value="">Добавить поле…</option>
          {META_KEYS.map(([k, label, icon]) => <option key={k} value={k}>{icon} {label} — {k}</option>)}
        </select>
        <input type="text" placeholder="Свой ключ" value={ck} onChange={x => setCk(x.target.value)} onKeyDown={x => { if (x.key === 'Enter') addCustom(); }} style={{ flex: '1 1 110px' }} />
        <button className="sm" title="Добавить свой ключ" onClick={addCustom}>+</button>
      </div>
      <div className="row mfoot">
        <button className="sm pri" title={S.genius?.id ? `Песня с Genius: «${S.genius.title}»` : 'Поиск на Genius по исполнителю и названию трека'} onClick={() => geniusWriters()}>🔍 Авторы песни с Genius</button>
        <button className="sm" onClick={presets}>Все стандартные поля</button>
        <button className="sm danger" disabled={!md.length} onClick={() => { if (confirm('Удалить все метаданные?')) change(() => { S.meta.md = []; }); }}>Очистить</button>
      </div>
      <p className="hint">«Автор песни» Spicy Lyrics покажет как «Written by». Остальное пишется в TTML как в AMLL (<code>amll:meta</code>). Enter — ещё значение, Backspace в пустом — удалить.</p>
    </div>
  </div>;
}
