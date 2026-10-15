import { spectrogram } from './spec.ts';

onmessage = (e: MessageEvent<{ ch: Float32Array; sr: number }>) => {
  const r = spectrogram(e.data.ch, e.data.sr);
  (postMessage as (m: unknown, t: Transferable[]) => void)(r, [r.data.buffer, r.flux.buffer]);
};
