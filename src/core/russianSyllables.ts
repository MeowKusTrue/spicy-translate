import Hypher from 'hypher';
import russian from 'hyphenation.ru';
import { units, unitsText } from './words.ts';
import { remapSync } from './edit.ts';
import { editorText } from './editor.ts';
import type { Layer, Line } from './types.ts';

const ru = new Hypher(russian);
export type SyllableRule = 'orthographic' | 'vocal';
/** Keep foreign/mixed-script words whole: Russian transfer patterns do not describe Kazakh or English. */
export function splitRussian(word: string, rule: SyllableRule = 'orthographic'): string[] {
  const m = word.match(/^([^\p{L}]*)([а-яё]+(?:[-‐‑][а-яё]+)*)([^\p{L}]*)$/iu);
  if (!m || /[A-ZА-ЯЁ]{2}/u.test(m[2])) return [word];
  if (rule === 'vocal') {
    const pieces = m[2].split(/(?<=[-‐‑])/u).flatMap(part => {
      const chars = [...part], vowels = chars.flatMap((c, i) => /[аеёиоуыэюя]/i.test(c) ? [i] : []), cuts: number[] = [];
      for (let k = 0; k + 1 < vowels.length; k++) {
        const a = vowels[k], b = vowels[k + 1], mid = chars.slice(a + 1, b).join('');
        let cut = a + 1;
        if (/^й/i.test(mid) || /^[рлмн][ьъ]?[бвгджзйклмнпрстфхцчшщ]/i.test(mid) || /ъ/i.test(mid)) {
          cut = a + 2; while (cut < b && /[ьъ]/i.test(chars[cut])) cut++;
          if (/ъ/i.test(mid)) cut = a + 1 + mid.indexOf('ъ') + 1;
        }
        cuts.push(cut);
      }
      const out: string[] = []; let start = 0; for (const cut of cuts) { out.push(chars.slice(start, cut).join('')); start = cut; } out.push(chars.slice(start).join('')); return out;
    });
    pieces[0] = m[1] + pieces[0]; pieces[pieces.length - 1] += m[3]; return pieces;
  }
  const parts = m[2].split(/(?<=[-‐‑])/u).flatMap(part => {
    const hyphen = /[-‐‑]$/.test(part) ? part.slice(-1) : '', body = hyphen ? part.slice(0, -1) : part;
    const chunks = ru.hyphenate(body);
    // A written transfer can contain several syllables; reject unsafe boundaries from pattern edge cases.
    for (let k = 1; k < chunks.length;) {
      if (chunks[k - 1].length < 2 || /^[йьъы]/i.test(chunks[k]) || !/[аеёиоуыэюя]/i.test(chunks[k - 1])) { chunks[k - 1] += chunks.splice(k, 1)[0]; }
      else k++;
    }
    if (chunks.length > 1 && (chunks.at(-1)!.length < 2 || !/[аеёиоуыэюя]/i.test(chunks.at(-1)!))) chunks[chunks.length - 2] += chunks.pop();
    chunks[chunks.length - 1] += hyphen; return chunks;
  });
  parts[0] = m[1] + parts[0]; parts[parts.length - 1] += m[3]; return parts;
}

export function syllableDraft(line: Line, layer: Layer, rule: SyllableRule = 'orthographic') {
  const us = units(editorText(line, layer));
  return unitsText(us.flatMap((u, k) => {
    const whole = u.sp && (!k || us[k - 1].sp) && !u.w.includes(' ');
    const parts = whole ? splitRussian(u.w, rule) : [u.w];
    return parts.map((w, j) => ({ w, sp: j === parts.length - 1 ? u.sp : false }));
  }));
}

export function applySyllableDraft(line: Line, layer: Layer, text: string) {
  const old = editorText(line, layer);
  if (text.replace(/\|/g, '') !== old.replace(/\|/g, '') || /(^|\s|\|)\||\|($|\s)/.test(text)) return { error: 'Меняй только границы «|», сохраняя буквы и пробелы.' };
  const sync = remapSync(old, text, line.sync?.[layer]);
  sync?.forEach(x => { if (x.a != null && x.b != null && !line.sync?.[layer]?.some(o => o.a === x.a && o.b === x.b)) { x.g = 1; delete x.c; } });
  return { text, sync };
}

/** Locate the complete word around a selected syllable, retaining exact spaces and other words. */
export function selectedWordRange(text: string, k: number) {
  let n = 0;
  for (const m of text.matchAll(/[^\s]+(?:\u00a0[^\s]+)*/gu)) {
    const count = units(m[0]).length;
    if (k >= n && k < n + count) return { start: m.index!, end: m.index! + m[0].length, word: m[0], k: n };
    n += count;
  }
  return null;
}
