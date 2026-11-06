import { useEffect, useRef, useState } from 'react';
import { drawWave } from '../waveform/wave.ts';
const maximum = () => Math.min(600, Math.max(180, window.innerWidth * .48));
const clamp = (n: number) => Math.round(Math.max(180, Math.min(maximum(), n)));
export function SidebarResize() {
  const [width, setWidth] = useState(() => clamp(Number(localStorage.getItem('studioLinesWidth')) || 255));
  const drag = useRef<{ x: number; w: number } | null>(null);
  const change = (n: number) => { const w = clamp(n); setWidth(w); localStorage.setItem('studioLinesWidth', String(w)); };
  useEffect(() => { document.documentElement.style.setProperty('--studioLinesWidth', width + 'px'); requestAnimationFrame(drawWave); }, [width]);
  useEffect(() => { const resize = () => setWidth(w => clamp(w)); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, []);
  return <div className="sidebar-resize" id="sidebarResize" role="separator" aria-label="Ширина списка строк" aria-orientation="vertical" aria-valuemin={180} aria-valuemax={maximum()} aria-valuenow={width} tabIndex={0}
    title="Потяни для изменения ширины · стрелки ← → · двойной клик — сброс"
    onPointerDown={e => { if (e.button !== 0) return; e.preventDefault(); e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, w: width }; }}
    onPointerMove={e => { if (drag.current) change(drag.current.w + e.clientX - drag.current.x); }}
    onPointerUp={e => { drag.current = null; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
    onPointerCancel={() => { drag.current = null; }} onDoubleClick={() => change(255)}
    onKeyDown={e => { const n = e.key === 'ArrowLeft' ? width - 16 : e.key === 'ArrowRight' ? width + 16 : e.key === 'Home' ? 180 : e.key === 'End' ? maximum() : null; if (n != null) { e.preventDefault(); e.stopPropagation(); change(n); } }} />;
}
