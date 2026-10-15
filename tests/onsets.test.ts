import { describe, expect, it } from 'vitest';
import { onsets } from '../src/waveform/peaks.ts';

describe('onsets', () => {
  it('finds sharp rises in a quiet envelope, not the steady parts', () => {
    const pps = 200, pk = new Float32Array(pps * 4).fill(0.02);
    for (const s of [0.5, 1.7, 3.1]) for (let i = Math.round(s * pps); i < Math.round((s + 0.4) * pps); i++) pk[i] = 0.8; // three notes
    const o = onsets(pk, pps);
    expect(o.length).toBe(3);
    o.forEach((t, k) => expect(Math.abs(t - [0.5, 1.7, 3.1][k])).toBeLessThan(0.02));
  });
});
