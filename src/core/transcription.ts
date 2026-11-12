import type { Line, WordSync } from './types.ts';
import { units } from './words.ts';

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const time = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Recognition creates an unapproved original-text draft, never translations or backings. */
export function transcriptionDraft(value: unknown): Line[] {
  if (!Array.isArray(value) || !value.length || value.length > 2000) throw new Error('Распознавание не вернуло непустой список строк.');
  return value.map(raw => {
    if (!record(raw) || typeof raw.text !== 'string' || !raw.text.trim() || !time(raw.t) || !time(raw.end) || raw.end <= raw.t) throw new Error('Распознавание вернуло некорректную строку.');
    const text = raw.text.trim(), line: Line = { t: raw.t, end: raw.end, text, tr: '' };
    const spans = record(raw.sync) ? raw.sync.orig : null;
    if (Array.isArray(spans) && spans.length === units(text).length && spans.every(w => record(w) && time(w.a) && time(w.b) && w.b > w.a)) {
      line.sync = { orig: spans.map((w: Record<string, unknown>): WordSync => ({ a: w.a as number, b: w.b as number, g: 1,
        ...(typeof w.c === 'number' && Number.isFinite(w.c) ? { c: Math.max(0, Math.min(1, w.c)) } : {}) })) };
    }
    return line;
  });
}
