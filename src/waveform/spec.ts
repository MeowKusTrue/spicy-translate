// Spectrogram for the wave panel + spectral-flux onsets (attacks of consonants and notes, sharper than loudness alone).
// 100 columns per second, ROWS log-spaced bands 60 Hz…8 kHz (where the voice lives), bytes 0..255 over the top 70 dB.
export const SPEC_FPS = 100, ROWS = 128;
const F_LO = 60, F_HI = 8000, RANGE_DB = 70;

function fftTables(N: number) {
  const bits = Math.log2(N), rev = new Uint32Array(N), cos = new Float64Array(N / 2), sin = new Float64Array(N / 2);
  for (let i = 0; i < N; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
  for (let i = 0; i < N / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / N); sin[i] = -Math.sin(2 * Math.PI * i / N); }
  return { rev, cos, sin };
}
/** in-place radix-2 FFT */
function fft(re: Float64Array, im: Float64Array, T: ReturnType<typeof fftTables>) {
  const N = re.length;
  for (let i = 0; i < N; i++) { const j = T.rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1, step = N / size;
    for (let s = 0; s < N; s += size) for (let k = 0; k < half; k++) {
      const c = T.cos[k * step], si = T.sin[k * step], a = s + k, b = a + half;
      const tr = re[b] * c - im[b] * si, ti = re[b] * si + im[b] * c;
      re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
    }
  }
}

/** spectrogram bytes (column after column, ROWS each, low frequencies first) and the spectral flux per column */
export function spectrogram(ch: Float32Array, sr: number) {
  const N = 2 ** Math.round(Math.log2(sr * 0.04)); // ~40 ms window: 2048 at 44.1 / 48 kHz
  const hop = sr / SPEC_FPS, cols = Math.max(1, Math.floor(ch.length / hop)), T = fftTables(N);
  const win = new Float64Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
  // band edges in FFT bins, log-spaced; low bands narrower than a bin share it (no shift of the axis)
  const edge = new Int32Array(ROWS + 1);
  for (let r = 0; r <= ROWS; r++) edge[r] = Math.floor(F_LO * Math.pow(F_HI / F_LO, r / ROWS) * N / sr);
  const db = new Float32Array(cols * ROWS), flux = new Float32Array(cols), re = new Float64Array(N), im = new Float64Array(N), mag = new Float64Array(N / 2);
  let top = -Infinity;
  for (let c = 0; c < cols; c++) {
    const s0 = Math.round(c * hop + hop / 2 - N / 2);
    for (let i = 0; i < N; i++) { const j = s0 + i; re[i] = j >= 0 && j < ch.length ? ch[j] * win[i] : 0; im[i] = 0; }
    fft(re, im, T);
    for (let k = 0; k < N / 2; k++) mag[k] = re[k] * re[k] + im[k] * im[k];
    let fl = 0;
    for (let r = 0; r < ROWS; r++) {
      let e = 0; const a = edge[r], b = Math.min(N / 2, Math.max(a + 1, edge[r + 1])); for (let k = a; k < b; k++) e += mag[k];
      const v = 10 * Math.log10(1e-12 + e / Math.max(1, b - a)), o = c * ROWS + r; db[o] = v; if (v > top) top = v;
      if (c) fl += Math.max(0, v - db[o - ROWS]);
    }
    flux[c] = fl / ROWS;
  }
  const data = new Uint8Array(cols * ROWS), lo = top - RANGE_DB;
  for (let i = 0; i < data.length; i++) data[i] = Math.max(0, Math.min(255, Math.round((db[i] - lo) / RANGE_DB * 255)));
  return { data, cols, flux, lead: N / 2 / sr }; // lead: a centred window hears a sound half a window early
}

/**
 * Peaks of an onset curve (fps values per second) that stand out against the surrounding second, ≥ 80 ms apart.
 * Shared by the loudness onsets and the spectral-flux ones.
 */
export function pickOnsets(d: Float32Array, fps: number, k = 1.6, floor = 0.04): number[] {
  const n = d.length, win = Math.round(fps * 0.5), pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + d[i];
  const out: number[] = [], gap = Math.round(fps * 0.08); let last = -gap;
  for (let i = 1; i + 1 < n; i++) {
    if (d[i] < d[i - 1] || d[i] <= d[i + 1] || i - last < gap) continue;
    const a = Math.max(0, i - win), b = Math.min(n, i + win), thr = k * (pre[b] - pre[a]) / (b - a) + floor;
    if (d[i] > thr) { out.push(Math.round(i / fps * 1000) / 1000); last = i; }
  }
  return out;
}
/** spectral-flux attacks: rises of energy across the bands (in dB per band per 10 ms), moved to where the sound starts */
export const fluxOnsets = (flux: Float32Array, lead: number) => pickOnsets(flux.subarray(0, Math.max(0, flux.length - 3)), SPEC_FPS, 1.5, 0.6).map(t => Math.round((t + lead) * 1000) / 1000);
