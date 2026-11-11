// Playback + clock. Read the media clock on every frame; timeupdate events alone are coarse.
import { S, emit, ls } from './state.ts';
import { PV } from './preview.ts';

export const audio = document.createElement('audio');
audio.preload = 'auto';

let playStop: ReturnType<typeof setTimeout> | undefined;
let voiceBlob: Blob | null = null, voiceUrl = '';
let source: 'mix' | 'voice' = 'mix';
let pending: { time: number; ready: () => void } | null = null;
export const playbackSource = () => source;
export const hasVoiceAudio = () => !!voiceBlob;
function cancelSourceLoad() {
  if (pending) audio.removeEventListener('loadedmetadata', pending.ready);
  pending = null;
}
/** Discard project-local stems; stop voice playback before restoring/removing the original. */
export function clearVoiceAudio() {
  cancelSourceLoad();
  if (source === 'voice') {
    pause(); audio.src = S.audioUrl; audio.playbackRate = S.rate;
  }
  if (voiceUrl) URL.revokeObjectURL(voiceUrl);
  voiceBlob = null; voiceUrl = ''; source = 'mix';
}
export function cacheVoiceAudio(blob: Blob) {
  if (source === 'voice') setPlaybackSource('mix');
  if (voiceUrl) URL.revokeObjectURL(voiceUrl);
  voiceBlob = blob; voiceUrl = URL.createObjectURL(blob); emit();
}
/** Only the media element changes: original/export/align blob and timeline data stay intact. */
export function setPlaybackSource(next: 'mix' | 'voice') {
  if (!S.hasAudio || next === source || next === 'voice' && !voiceBlob) return;
  const time = now(), original = S.audioBlob;
  cancelSourceLoad(); audio.pause(); source = next;
  const url = next === 'voice' ? voiceUrl : S.audioUrl;
  const ready = () => {
    if (pending?.ready !== ready || S.audioBlob !== original || audio.src !== url) return;
    const target = pending.time; cancelSourceLoad();
    audio.currentTime = target; audio.playbackRate = S.rate;
    if (S.playing) void audio.play().catch(() => { if (audio.src === url) pause(); });
  };
  pending = { time, ready };
  audio.addEventListener('loadedmetadata', ready);
  audio.src = url; audio.playbackRate = S.rate;
  emit();
}
export function now() {
  if (!S.hasAudio) return S.vt + (S.playing ? (performance.now() - S.vStart) / 1000 * S.rate : 0);
  return pending ? pending.time : audio.currentTime;
}
export function play() { clearTimeout(playStop); playStop = undefined; if (S.hasAudio) { if (!pending) void audio.play().catch(() => pause()); } else S.vStart = performance.now(); S.playing = true; emit(); }
export function pause() { clearTimeout(playStop); playStop = undefined; if (S.hasAudio) audio.pause(); else if (S.playing) S.vt = now(); S.playing = false; emit(); }
export function seekTo(t: number) {
  t = Math.max(0, t);
  if (S.hasAudio) { if (pending) pending.time = t; else audio.currentTime = t; } else { S.vt = t; S.vStart = performance.now(); }
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
