import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import './styles.css';
import { S, emit, ls, toast, type Page } from './state.ts';
import { setVolume } from './audio.ts';
import { buildPreview } from './preview.ts';
import { idbGet, loadProject, saveProject, snapshot, trackKey } from './persist.ts';
import { LIVE, liveInit } from './live.ts';
import { loadAudioFile } from './load.ts';
import { installHotkeys, setPage } from './hotkeys.ts';
import { initDesktop } from './desktop.ts';
import { startLoop } from './loop.ts';
import { App } from './ui/App.tsx';
import { initTheme } from './theme.ts';

// prefs
S.snap = ls.get('snap', '1') !== '0';
S.fx = ls.get('fx', '1') !== '0';
S.onsetSnap = ls.get('onsetSnap', '1') !== '0';
S.coverBg = ls.get('coverBg', '1') !== '0';
S.blur = ls.get('blur', '1') !== '0';
S.chips = (['big', 'small', 'off'] as const).find(x => x === ls.get('chips', 'big')) || 'big';
S.autoFit = ls.get('autoFit', '0') === '1';
try { S.fitPad = { a: 0, b: 0, ...JSON.parse(ls.get('fitPad', '{}') || '{}') }; } catch {}
S.lat = +(ls.get('lat', '100') || 0) || 0;
S.voff = +(ls.get('voff', '0') || 0) || 0;
try { const c = JSON.parse(ls.get('llm', 'null')!); if (c) S.llm = { prov: c.prov, model: c.model, key: c.key || '', url: c.url || '', style: c.style || '' }; } catch {}

// render synchronously: preview/wave code paints into elements React creates
flushSync(() => createRoot(document.getElementById('root')!).render(<App />));

window.addEventListener('error', e => toast('Ошибка: ' + e.message, 'err'));
window.addEventListener('unhandledrejection', e => toast('Ошибка: ' + (e.reason && e.reason.message || e.reason), 'err'));
window.addEventListener('beforeunload', saveProject);
document.addEventListener('visibilitychange', () => { if (document.hidden) saveProject(); });
installHotkeys();
initDesktop();
initTheme();
setVolume(Math.min(1, Math.max(0, parseFloat(ls.get('vol', '0.3')!) || 0.3)));
buildPreview();
startLoop();
// restore the last session (text, translation, word timings, cached audio) automatically
try {
  const last = ls.get('last', null);
  if (last) {
    LIVE.applying = true; loadProject(last); LIVE.applying = false;
    idbGet(trackKey()).then(b => { if (b) loadAudioFile(b, true); });
    S.save = { msg: '💾 восстановлено', cls: 'ok' }; emit();
  }
} catch { LIVE.applying = false; }
setPage(S.lines.length ? (ls.get('page', 'tr') as Page) : 'track');
liveInit();
setInterval(() => snapshot('авто'), 180000); // ponytail: fixed 3 min, 80 kept; a setting if anyone wants more
