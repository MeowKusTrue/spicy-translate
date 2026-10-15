import { pickOnsets } from './spec.ts';
/** max |sample| per bucket of `per` samples (every 2nd sample, like before), normalised to 0..1 */
export function computePeaks(ch: Float32Array, per: number) {
  const n = Math.ceil(ch.length / per), pk = new Float32Array(n); let mx = 0;
  for (let i = 0; i < n; i++) { let m = 0; const end = Math.min(ch.length, (i + 1) * per); for (let j = i * per; j < end; j += 2) { const v = ch[j] < 0 ? -ch[j] : ch[j]; if (v > m) m = v; } pk[i] = m; if (m > mx) mx = m; }
  if (mx > 0) for (let i = 0; i < n; i++) pk[i] /= mx;
  return pk;
}

/**
 * Note attacks in a peak envelope (pps values per second): rises of log-energy over the last 50 ms that stand
 * out against their surroundings, at least 80 ms apart. Times in seconds — a magnet for word edges.
 */
export function onsets(pk: Float32Array, pps: number): number[] {
  const n = pk.length, e = new Float32Array(n), d = new Float32Array(n), back = Math.max(2, Math.round(pps * 0.05));
  for (let i = 0; i < n; i++) e[i] = Math.log10(1e-3 + pk[i]);
  let run = 0; // running sum of the previous `back` values
  for (let i = 0; i < n; i++) { if (i >= 1) run += e[i - 1]; if (i > back) run -= e[i - 1 - back]; const m = run / Math.min(Math.max(i, 1), back); d[i] = i ? Math.max(0, e[i] - m) : 0; }
  return pickOnsets(d, pps);
}
