// Song metadata (S.meta.md): filled from LRCLIB / Genius on load without overwriting what the user typed.
import { S } from './state.ts';

export const metaHas = (key: string) => S.meta.md.some(m => m.key === key && m.value.some(v => v.trim()));
/** set a field's values; keep = only when the field has nothing yet. Returns whether it changed. */
export function setMeta(key: string, values: string[], keep = true) {
  values = [...new Set(values.map(v => v.trim()).filter(Boolean))];
  if (!values.length || (keep && metaHas(key))) return false;
  const e = S.meta.md.find(m => m.key === key);
  if (e) e.value = values; else S.meta.md.push({ key, value: values });
  return true;
}
/** "A feat. B & C" -> A, B, C: AMLL wants one artist per value */
export const splitArtists = (s: string) => s.split(/\s*(?:[,;&]|\s(?:feat|ft)\.?\s|\sx\s)\s*/i).map(x => x.trim()).filter(Boolean);
