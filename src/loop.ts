// The one requestAnimationFrame loop: clock/seek bar, preview karaoke, "now" chip, line loop (L), waveform.
import { mmss } from './core/index.ts';
import { S, viewWords } from './state.ts';
import { now, pause, seekTo } from './audio.ts';
import { previewFrame } from './preview.ts';
import { W, drawWaveFrame } from './waveform/wave.ts';

let clockTxt = '';
let lastWave = 0, lastWaveVer = -1, lastWaveT = NaN;
function frame() {
  let t = now();
  if (!S.hasAudio && t > S.duration && S.playing) { pause(); S.vt = 0; t = 0; }
  const seek = document.getElementById('seek') as HTMLInputElement | null; if (seek) seek.value = String(t);
  const ct = mmss(t) + ' / ' + mmss(S.duration), clock = document.getElementById('clock');
  if (clock && ct !== clockTxt) { clockTxt = ct; clock.textContent = ct; }
  previewFrame(t);
  if (S.dock) {
    const T = t + (S.voff || 0) / 1000;
    // React may rewrite a chip's className, so compare with the DOM rather than a cached flag
    document.querySelectorAll<HTMLElement>('#syncLines .chip').forEach(c => {
      const on = c.dataset.a != null && T >= +c.dataset.a && T < +c.dataset.b!;
      if (c.classList.contains('now') !== on) c.classList.toggle('now', on);
    });
  }
  if (S.loop && S.sel && S.playing) {
    const vw = viewWords(S.sel.i, S.layer).filter(x => x.a != null);
    if (vw.length) { const a = vw[0].a! - 0.4, b = vw[vw.length - 1].b! + 0.4; if (t > b || t < a - 1) seekTo(Math.max(0, a)); }
  }
  // The expensive editor canvas gets 30 fps; lyric fill keeps the display's full frame rate.
  // Paused edits redraw from their event handlers, rather than burning every idle frame.
  const ms = performance.now();
  if (S.dock && (S.playing || W.flash || W.drag || S.ver !== lastWaveVer || t !== lastWaveT || W.viewportDirty) && (!S.playing || W.viewportDirty || ms - lastWave >= 1000 / 30)) { lastWave = ms; drawWaveFrame(); lastWaveVer = S.ver; lastWaveT = t; }
  requestAnimationFrame(frame);
}
export function startLoop() { requestAnimationFrame(frame); }
