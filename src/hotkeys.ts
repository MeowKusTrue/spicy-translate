// Sync dock toggling + keyboard: F/G/H, A/D, Space, arrows, [ ] ', , . nudge, M/U join/split, N magnet, L loop, R, Del, Ctrl+Z.
import { S, emit, isBg, isTr, ls, mkLayer, toast, viewWords, wordsOf, type Page } from './state.ts';
import { now, pause, play, seekTo, setRate } from './audio.ts';
import { PV } from './preview.ts';
import { doRedo, doUndo, joinWords, mark, nudgeWord, resetWord, setLayer, splitWord, stepWord } from './sync.ts';
import { copyLines, fullDraft, openEdit, pasteLines, repeatChorus } from './lineEdit.ts';
import { W, drawWave } from './waveform/wave.ts';
import { cycleAgent, setAgent } from './agents.ts';

export const PAGES: [Page, string][] = [['track', 'Трек'], ['text', 'Текст'], ['tr', 'Перевод'], ['sync', 'Синхра'], ['export', 'Экспорт']];
/** switch the tab; «Синхра» opens the word-sync dock (wave, keys), the others close it */
export function setPage(p: Page) {
  if (p !== 'sync' && p !== S.page) S.prevPage = p;
  S.page = p; ls.set('page', p);
  if (p === 'text' && (!S.full || !S.full.dirty)) S.full = fullDraft();
  const dock = p === 'sync';
  if (dock !== S.dock) {
    S.dock = dock; document.body.classList.toggle('dock-open', dock);
    if (dock && document.activeElement instanceof HTMLElement) document.activeElement.blur();
    if (dock) { setTimeout(drawWave, 30); if (!ls.get('helpSeen', '')) { S.help = true; ls.set('helpSeen', '1'); } }
    PV.lastAct = -2;
  }
  updateKbd(); emit(); window.scrollTo({ top: 0 });
}
export function toggleDock(on?: boolean) { setPage((on ?? !S.dock) ? 'sync' : S.prevPage || 'tr'); }
export function setSnap(on: boolean) { S.snap = on; ls.set('snap', on ? '1' : '0'); toast(on ? '🧲 Магнит включён (N). Ctrl при перетаскивании — отключает на лету.' : 'Магнит выключен (N).', 'ok'); }
export function setLoop(on: boolean) { S.loop = on; toast(on ? '🔁 Цикл выбранной строки включён (L). Жми Space.' : 'Цикл выключен.', 'ok'); }
export function updateKbd() {
  const a = document.activeElement as HTMLInputElement | null;
  const typing = !!a && (a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || (a.tagName === 'INPUT' && ['text', 'number', 'search'].includes(a.type)));
  if (typing !== S.typing) { S.typing = typing; emit(); }
}
const blurActive = () => { const a = document.activeElement; if (a instanceof HTMLElement && a !== document.body) a.blur(); };

const KEYS = new Set(['KeyC', 'KeyB', 'KeyT', 'KeyE', 'Digit1', 'Digit2', 'Digit3', 'KeyV', 'KeyM', 'KeyU', 'KeyN', 'KeyL', 'KeyR', 'Comma', 'Period', 'Space', 'KeyF', 'KeyG', 'KeyH', 'KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight', 'BracketLeft', 'BracketRight', 'Quote', 'Delete', 'Backspace']);
function onKey(e: KeyboardEvent) {
  if (!S.dock || S.help) return;
  const tg = e.target as HTMLInputElement, tag = tg.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && tg.type !== 'range' && tg.type !== 'checkbox' && tg.type !== 'radio' && tg.type !== 'file')) return;
  const c = e.code;
  if ((e.ctrlKey || e.metaKey) && c === 'KeyZ') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (c === 'KeyC' || c === 'KeyV')) { e.preventDefault(); return c === 'KeyC' ? copyLines() : pasteLines(); }
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
  if (c === 'Digit1') return setAgent('v1');
  if (c === 'Digit2') return setAgent('v2');
  if (c === 'Digit3') return setAgent('v1000');
  if (c === 'KeyV') { if (S.sel) cycleAgent(S.sel.i); return; }
  if (c === 'KeyM') return joinWords();
  if (c === 'KeyU') return splitWord();
  if (e.repeat) return;
  if (c === 'KeyB') { setLayer(mkLayer(!isBg(S.layer), isTr(S.layer))); return toast(isBg(S.layer) ? 'Дорожка: бэк (B — обратно на основу).' : 'Дорожка: основа.', 'ok'); }
  if (c === 'KeyT') { setLayer(mkLayer(isBg(S.layer), !isTr(S.layer))); return toast(isTr(S.layer) ? 'Размечаем перевод (T).' : 'Размечаем оригинал (T).', 'ok'); }
  if (c === 'KeyE') { if (S.sel) openEdit(S.sel.i, S.layer, wordsOf(S.sel.i, S.layer).length ? S.sel.k : -1); return; }
  if (c === 'KeyC') return repeatChorus();
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
  document.addEventListener('keydown', e => { // Alt+1..5 = tabs
    const n = /^Digit([1-5])$/.exec(e.code); if (!n || !e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault(); setPage(PAGES[+n[1] - 1][0]);
  });
  document.addEventListener('keydown', e => {
    if (e.code !== 'Escape') return;
    if (S.help) { S.help = false; emit(); }
    if (W.multi.length) { W.multi = []; drawWave(); }
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
