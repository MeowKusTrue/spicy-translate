import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addBacking, alignArgs, recommendedModels } from '../src/core/autoAlign.ts';
import type { Line } from '../src/core/types.ts';

describe('auto alignment models and backing import', () => {
  it('suggests a starting point for the selected hardware and song language', () => {
    expect(recommendedModels('cuda', 'ru')).toEqual({ sep: 'roformer', asr: 'turbo', aligner: 'w2v' });
    expect(recommendedModels('cpu', 'en')).toEqual({ sep: 'htdemucs', asr: 'turbo', aligner: 'w2v' });
    expect(recommendedModels('dml', 'fr')).toEqual({ sep: 'htdemucs', asr: 'turbo', aligner: 'mms' });
    expect(recommendedModels('xpu', 'ru').sep).toBe('htdemucs');
  });
  it('forwards supported models and backing recognition only', () => {
    expect(alignArgs(new URLSearchParams('sep=roformer&asr=large-v3&aligner=mms&detectBack=1&transcribe=1&lang=ru')))
      .toEqual(['--sep', 'roformer', '--asr', 'large-v3', '--aligner', 'mms', '--transcribe', '--detect-back', '--song-lang', 'ru']);
    expect(alignArgs(new URLSearchParams('sep=../../file&asr=--force&aligner=evil&lang=--force&detectBack=true')))
      .toEqual(['--sep', 'htdemucs', '--asr', 'turbo', '--aligner', 'w2v']);
  });
  it('adds overlapping backing lines without changing lead, translation or hand timings; skips duplicates', () => {
    const lines: Line[] = [{ t: 1, end: 4, text: 'original', tr: 'перевод', sync: { orig: [{ a: 1, b: 4 }] }, bg: { text: 'эхо', tr: 'echo' } }];
    const original = structuredClone(lines);
    const c: Line = { t: 2, end: 3, text: '', tr: '', bg: { text: 'новый бэк', tr: '' }, sync: { bgo: [{ a: 2, b: 2.5, g: 1 }, { a: 2.5, b: 3, g: 1 }] } };
    const result = addBacking(lines, [c, c, { ...c, bg: { text: 'Э|ХО!', tr: '' } }, { ...c, end: NaN }]);
    expect(lines).toEqual(original);
    expect(result).toHaveLength(2); expect(result[0]).toEqual(lines[0]);
    expect(result[1].sync?.bgo).toEqual(c.sync?.bgo);
    expect(addBacking(result, [c])).toEqual(result);
  });
  it('allows the dialog command used by native confirmation in the desktop editor', () => {
    const c = JSON.parse(fs.readFileSync(new URL('../desktop/src-tauri/capabilities/editor.json', import.meta.url), 'utf8'));
    expect(c.permissions).toContain('dialog:allow-message');
    expect(c.windows).toContain('main');
  });
});
