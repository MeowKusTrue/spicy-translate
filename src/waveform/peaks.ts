/** max |sample| per bucket of `per` samples (every 2nd sample, like before), normalised to 0..1 */
export function computePeaks(ch: Float32Array, per: number) {
  const n = Math.ceil(ch.length / per), pk = new Float32Array(n); let mx = 0;
  for (let i = 0; i < n; i++) { let m = 0; const end = Math.min(ch.length, (i + 1) * per); for (let j = i * per; j < end; j += 2) { const v = ch[j] < 0 ? -ch[j] : ch[j]; if (v > m) m = v; } pk[i] = m; if (m > mx) mx = m; }
  if (mx > 0) for (let i = 0; i < n; i++) pk[i] /= mx;
  return pk;
}
