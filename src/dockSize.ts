// Bottom dock height: drag the grip; the waveform grows with it. Remembered per browser.
import { clamp, ls } from './state.ts';
import { drawWave } from './waveform/wave.ts';
const DEF = 400;
export function setDockH(h: number) {
  h = clamp(Math.round(h), 260, Math.max(300, innerHeight - 220));
  const r = document.documentElement.style;
  r.setProperty('--dockH', h + 'px'); r.setProperty('--waveH', Math.round(clamp(h * 0.42, 140, 380)) + 'px');
  ls.set('dockH', String(h)); drawWave();
}
export function setupGrip(g: HTMLElement) {
  setDockH(+(ls.get('dockH', String(DEF)) || DEF) || DEF);
  g.onpointerdown = e => {
    e.preventDefault(); g.setPointerCapture(e.pointerId); g.classList.add('drag');
    const y0 = e.clientY, h0 = g.parentElement!.getBoundingClientRect().height;
    g.onpointermove = m => setDockH(h0 + (y0 - m.clientY));
    g.onpointerup = () => { g.onpointermove = null; g.classList.remove('drag'); };
  };
  g.ondblclick = () => setDockH(DEF);
}
