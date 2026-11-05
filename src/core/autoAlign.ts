import type { Line } from './types.ts';

export interface AlignOptions { sep: 'htdemucs' | 'roformer'; asr: 'turbo' | 'large-v3'; aligner: 'w2v' | 'mms'; detectBack: boolean }
export function alignOptions(value: Partial<AlignOptions> = {}): AlignOptions {
  return { sep: value.sep === 'roformer' ? 'roformer' : 'htdemucs', asr: value.asr === 'large-v3' ? 'large-v3' : 'turbo',
    aligner: value.aligner === 'mms' ? 'mms' : 'w2v', detectBack: value.detectBack === true };
}
/** Only known Python options may cross the HTTP boundary. */
export function alignArgs(q: URLSearchParams): string[] {
  const o = alignOptions({ sep: q.get('sep'), asr: q.get('asr'), aligner: q.get('aligner'), detectBack: q.get('detectBack') === '1' } as AlignOptions);
  const args = ['--sep', o.sep, '--asr', o.asr, '--aligner', o.aligner];
  if (q.get('transcribe') === '1') args.push('--transcribe');
  if (o.detectBack) args.push('--detect-back');
  if (/^(ru|en|uk|de|fr|es|it|pt|ja|ko|zh)$/.test(q.get('lang') || '')) args.push('--song-lang', q.get('lang')!);
  return args;
}

/** Import reviewed backing phrases as independent lines; never overwrite an existing backing part. */
export function addBacking(lines: Line[], candidates: Line[]): Line[] {
  const out = structuredClone(lines);
  const norm = (s: string) => s.replace(/\|/g, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  for (const c of candidates) {
    if (!c.bg?.text.trim() || !Number.isFinite(c.t) || !Number.isFinite(c.end) || c.end <= c.t) continue;
    if (out.some(l => l.bg && norm(l.bg.text) === norm(c.bg!.text) && l.t < c.end && c.t < l.end)) continue;
    out.push({ t: c.t, end: c.end, text: '', tr: '', bg: { text: c.bg.text, tr: '' }, sync: { bgo: structuredClone(c.sync?.bgo || []) } });
  }
  return out.sort((a, b) => a.t - b.t);
}
