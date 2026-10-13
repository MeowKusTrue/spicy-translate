// Playback + clock. now() is smoothed (audio.currentTime updates in coarse steps); without audio a virtual clock runs.
import { S, emit, ls } from './state.ts';
import { PV } from './preview.ts';

export const audio = document.createElement('audio');
audio.preload = 'auto';

const CLK = { raw: -1, base: 0, pt: 0 };
export function now() {
  if (!S.hasAudio) return S.vt + (S.playing ? (performance.now() - S.vStart) / 1000 * S.rate : 0);
  const a = audio, ct = a.currentTime, p = performance.now();
  if (a.paused || a.seeking || !S.playing) { CLK.raw = ct; CLK.base = ct; CLK.pt = p; return ct; }
  const pred = CLK.base + (p - CLK.pt) / 1000 * a.playbackRate;
  if (ct === CLK.raw) return pred;
  CLK.raw = ct; const e = ct - pred;
  CLK.base = Math.abs(e) > 0.1 ? ct : pred + e * 0.25; CLK.pt = p; // big jump = seek/stall -> snap; small = ease in
  return CLK.base;
}
export function play() { if (S.hasAudio) audio.play(); else S.vStart = performance.now(); S.playing = true; emit(); }
export function pause() { if (S.hasAudio) audio.pause(); else if (S.playing) S.vt = now(); S.playing = false; emit(); }
export function seekTo(t: number) {
  t = Math.max(0, t);
  if (S.hasAudio) audio.currentTime = t; else { S.vt = t; S.vStart = performance.now(); }
  PV.lastAct = -2;
}
export function setRate(r: number) {
  r = Math.min(2, Math.max(0.25, r));
  if (!S.hasAudio && S.playing) { S.vt = now(); S.vStart = performance.now(); }
  S.rate = r; audio.playbackRate = r; emit();
}
export function setVolume(v: number) { audio.volume = v; S.vol = v; ls.set('vol', v); emit(); }
let playStop: ReturnType<typeof setTimeout> | undefined;
export function playWord(w: { a: number; b: number }) {
  clearTimeout(playStop); seekTo(w.a); play();
  playStop = setTimeout(pause, ((w.b - w.a) / S.rate) * 1000 + 60);
}
