// Drag & drop anywhere: audio -> player (+ lyrics auto-pick), .lrc/.txt -> lyrics.
import { useEffect, useState } from 'react';
import { S } from '../state.ts';
import { loadAudioFile, loadManual } from '../load.ts';

export function Drop() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const enter = (e: DragEvent) => { if (hasFiles(e)) { depth++; setOn(true); } };
    const leave = () => { depth = Math.max(0, depth - 1); if (!depth) setOn(false); };
    const over = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    const drop = async (e: DragEvent) => {
      e.preventDefault(); depth = 0; setOn(false);
      for (const f of e.dataTransfer!.files) {
        if (f.type.startsWith('audio/') || /\.(mp3|flac|wav|ogg|m4a|aac|opus)$/i.test(f.name)) await loadAudioFile(f);
        else if (/\.(lrc|txt|srt|ttml|xml)$/i.test(f.name)) { const t = await f.text(); if (!/\.(ttml|xml)$/i.test(f.name)) S.manual = t; loadManual(t, f.name); }
      }
    };
    window.addEventListener('dragenter', enter); window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over); window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragenter', enter); window.removeEventListener('dragleave', leave); window.removeEventListener('dragover', over); window.removeEventListener('drop', drop); };
  }, []);
  return <div className={'drop' + (on ? ' on' : '')} id="drop"><div>Брось сюда аудио или текст (.lrc .txt .srt .ttml)<small>аудио → подберу текст по имени файла и построю волну</small></div></div>;
}
