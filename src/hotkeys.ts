// Sync dock toggling + keyboard: F/G/H, A/D, Space, arrows, [ ] ', , . nudge, M/U join/split, N magnet, L loop, R, Del, Ctrl+Z.
import { S, emit, ls, toast, viewWords } from './state.ts';
import { now, pause, play, seekTo, setRate } from './audio.ts';
import { PV } from './preview.ts';
import { doRedo, doUndo, joinWords, mark, nudgeWord, resetWord, splitWord, stepWord } from './sync.ts';
import { drawWave } from './waveform/wave.ts';

export function toggleDock(on?: boolean) {
  S.dock = on === undefined ? !S.dock : on;
  if (S.dock && document.activeElement instanceof HTMLElement) document.activeElement.blur();
  updateKbd(); document.body.classList.toggle('dock-open', S.dock);
  if (S.dock) { setTimeout(drawWave, 30); if (!ls.get('helpSeen', '')) { S.help = true; ls.set('helpSeen', '1'); } }
  PV.lastAct = -2; emit();
}
export function setSnap(on: boolean) { S.snap = on; ls.set('snap', on ? '1' : '0'); toast(on ? '🧲 Магнит включён (N). Ctrl при перетаскивании — отключает на лету.' : 'Магнит выключен (N).', 'ok'); }
export function setLoop(on: boolean) { S.loop = on; toast(on ? '🔁 Цикл выбранной строки включён (L). Жми Space.' : 'Цикл выключен.', 'ok'); }
export function updateKbd() {
  const a = document.activeElement as HTMLInputElement | null;
  const typing = !!a && (a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || (a.tagName === 'INPUT' && ['text', 'number', 'search'].includes(a.type)));
  if (typing !== S.typing) { S.typing = typing; emit(); }
}
const blurActive = () => { const a = document.activeElement; if (a instanceof HTMLElement && a !== document.body) a.blur(); };

const KEYS = new Set(['KeyM', 'KeyU', 'KeyN', 'KeyL', 'KeyR', 'Comma', 'Period', 'Space', 'KeyF', 'KeyG', 'KeyH', 'KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight', 'BracketLeft', 'BracketRight', 'Quote', 'Delete', 'Backspace']);
function onKey(e: KeyboardEvent) {
  if (!S.dock || S.help) return;
  const tg = e.target as HTMLInputElement, tag = tg.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && tg.type !== 'range' && tg.type !== 'checkbox' && tg.type !== 'radio' && tg.type !== 'file')) return;
  const c = e.code;
  if ((e.ctrlKey || e.metaKey) && c === 'KeyZ') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (!KEYS.has(c)) return;
  e.preventDefault();
  if (c === 'Space') { if (!e.repeat) S.playing ? pause() : play(); return; }
  if (c === 'ArrowLeft') return seekTo(now() - (e.shiftKey ? 1 : 5));
  if (c === 'ArrowRight') return seekTo(now() + (e.shiftKey ? 1 : 5));
  if (c === 'BracketLeft') return setRate(S.rate - 0.25);
  if (c === 'BracketRight') return setRate(S.rate + 0.25);
  if (c === 'Quote') return setRate(1);
  if (c === 'Comma' || c === 'Period') return nudgeWord((c === 'Comma' ? -1 : 1) * (e.shiftKey ? 0.05 : 0.01));
  if (c === 'KeyM') return joinWords();
  if (c === 'KeyU') return splitWord();
  if (e.repeat) return;
  if (c === 'KeyN') return setSnap(!S.snap);
  if (c === 'KeyL') return setLoop(!S.loop);
  if (c === 'KeyR') { if (S.sel) { const vw = viewWords(S.sel.i, S.layer).filter(x => x.a != null); seekTo(Math.max(0, (vw.length ? vw[0].a! : S.lines[S.sel.i].t) - 0.4)); } return; }
  if (c === 'KeyA') return stepWord(-1);
  if (c === 'KeyD') return stepWord(1);
  if (c === 'Delete' || c === 'Backspace') return resetWord();
  mark(c === 'KeyF' ? 'F' : c === 'KeyG' ? 'G' : 'H');
}

/** global listeners (installed once) */
export function installHotkeys() {
  document.addEventListener('keydown', onKey);
  document.addEventListener('keydown', e => {
    if (e.code !== 'Escape') return;
    if (S.help) { S.help = false; emit(); }
    document.querySelectorAll<HTMLDetailsElement>('details.menu[open]').forEach(d => d.open = false);
    blurActive(); updateKbd();
  });
  // buttons/sliders shouldn't swallow Space/arrows after a click
  document.addEventListener('mouseup', e => { const t = (e.target as Element).closest?.('button,input[type=range]') as HTMLElement | null; if (t) setTimeout(() => t.blur(), 0); });
  document.addEventListener('focusin', updateKbd); document.addEventListener('focusout', () => setTimeout(updateKbd, 0));
  document.addEventListener('click', e => document.querySelectorAll<HTMLDetailsElement>('details.menu[open]').forEach(d => { if (!d.contains(e.target as Node)) d.open = false; }));
}
/** clicking the dock / waveform / chips takes focus out of any text field so F/G/H work */
export function dockMouseDown(e: { target: EventTarget }) { if (!(e.target as Element).closest('input,select,textarea')) { blurActive(); updateKbd(); } }
