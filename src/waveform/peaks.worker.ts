import { computePeaks } from './peaks.ts';

onmessage = (e: MessageEvent<{ ch: Float32Array; per: number }>) => {
  const pk = computePeaks(e.data.ch, e.data.per);
  (postMessage as (m: unknown, t: Transferable[]) => void)(pk, [pk.buffer]);
};
