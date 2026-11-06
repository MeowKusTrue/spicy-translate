// Playback + clock. Read the media clock on every frame; timeupdate events alone are coarse.
import { S, emit, ls } from './state.ts';
import { PV } from './preview.ts';

export const audio = document.createElement('audio');
audio.preload = 'auto';

let playStop: ReturnType<typeof setTimeout> | undefined;
export function now() {
  if (!S.hasAudio) return S.vt + (S.playing ? (performance.now() - S.vStart) / 1000 * S.rate : 0);
  return audio.currentTime;
}
export function play() { clearTimeout(playStop); playStop = undefined; if (S.hasAudio) audio.play(); else S.vStart = performance.now(); S.playing = true; emit(); }
export function pause() { clearTimeout(playStop); playStop = undefined; if (S.hasAudio) audio.pause(); else if (S.playing) S.vt = now(); S.playing = false; emit(); }
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
export function playWord(w: { a: number; b: number }) {
  clearTimeout(playStop); seekTo(w.a); play();
  playStop = setTimeout(pause, ((w.b - w.a) / S.rate) * 1000 + 60);
}
