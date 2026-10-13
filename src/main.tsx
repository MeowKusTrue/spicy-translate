import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import './styles.css';
import { S, emit, ls, toast } from './state.ts';
import { setVolume } from './audio.ts';
import { buildPreview } from './preview.ts';
import { idbGet, loadProject, saveProject, trackKey } from './persist.ts';
import { LIVE, liveInit } from './live.ts';
import { loadAudioFile } from './load.ts';
import { installHotkeys } from './hotkeys.ts';
import { startLoop } from './loop.ts';
import { App } from './ui/App.tsx';

// prefs
S.snap = ls.get('snap', '1') !== '0';
S.fx = ls.get('fx', '1') !== '0';
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
liveInit();
