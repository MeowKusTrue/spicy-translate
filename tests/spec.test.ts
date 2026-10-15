import { describe, expect, it } from 'vitest';
import { ROWS, SPEC_FPS, fluxOnsets, spectrogram } from '../src/waveform/spec.ts';

describe('spectrogram', () => {
  // 3 s at 16 kHz: silence, a 1 kHz tone from 1.0 s, a 300 Hz tone added at 2.0 s (low noise floor everywhere)
  const sr = 16000, ch = new Float32Array(sr * 3);
  let seed = 1; const noise = () => ((seed = seed * 16807 % 2147483647) / 2147483647 - 0.5) * 1e-4;
  for (let i = 0; i < ch.length; i++) { const t = i / sr; ch[i] = noise() + (t >= 1 ? 0.5 * Math.sin(2 * Math.PI * 1000 * t) : 0) + (t >= 2 ? 0.5 * Math.sin(2 * Math.PI * 300 * t) : 0); }
  const s = spectrogram(ch, sr);
  const row = (hz: number) => Math.floor(Math.log(hz / 60) / Math.log(8000 / 60) * ROWS);
  const at = (sec: number, hz: number) => s.data[Math.round(sec * SPEC_FPS) * ROWS + row(hz)];

  it('lights up the band of a tone only while it sounds', () => {
    expect(s.cols).toBe(3 * SPEC_FPS);
    expect(at(0.5, 1000)).toBeLessThan(60);
    expect(at(1.5, 1000)).toBeGreaterThan(200);
    expect(at(1.5, 300)).toBeLessThan(at(2.5, 300) - 100);
  });
  it('finds both attacks in the spectral flux', () => {
    const o = fluxOnsets(s.flux, s.lead);
    expect(o.some(x => Math.abs(x - 1) < 0.025)).toBe(true);
    expect(o.some(x => Math.abs(x - 2) < 0.025)).toBe(true);
  });
});
