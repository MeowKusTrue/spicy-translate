import { spectrogram, spectralLevels } from './spec.ts';

onmessage = (e: MessageEvent<{ ch: Float32Array; sr: number }>) => {
  const r = spectrogram(e.data.ch, e.data.sr);
  const lod = spectralLevels(r.data, r.cols);
  (postMessage as (m: unknown, t: Transferable[]) => void)({ ...r, lod }, [r.data.buffer, r.flux.buffer, ...lod.map(l => l.data.buffer)]);
};
