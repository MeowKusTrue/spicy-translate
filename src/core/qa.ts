import type { Line, Mode } from './types.ts';
import { getWords, plainW, syncComplete, wordList } from './words.ts';

export interface QaItem { i: number; sev: 'err' | 'warn'; msg: string }

// pre-export checks (shared with the MCP server)
export function qaCheck(lines: Line[], mode: Mode = 'translation'): QaItem[] {
  const out: QaItem[] = [], bil = mode === 'bilingual'; let prevEnd: number | null = null, prevI = -1;
  lines.forEach((l, i) => {
    const hasTr = l.tr && l.tr.trim(), layer = bil ? 'orig' : (hasTr ? 'tr' : 'orig');
    const text = layer === 'tr' ? l.tr.trim() : l.text;
    if (!text || !text.trim()) { if (!(l.bg && (l.bg.text.trim() || l.bg.tr.trim()))) out.push({ i, sev: 'err', msg: 'пустая строка — Spicy не загрузит файл' }); return; } // bg-only line is fine
    if (!hasTr) out.push({ i, sev: 'warn', msg: 'нет перевода — пойдёт оригинал' });
    const ww = wordList(text), sy = l.sync && l.sync[layer];
    if (!syncComplete(sy, ww.length)) out.push({ i, sev: 'warn', msg: 'слова не размечены — будет равномерный спред' });
    else {
      if (sy.some(x => x.g)) out.push({ i, sev: 'warn', msg: 'слова только раскиданы, не проверены вручную' });
      sy.forEach((x, k) => {
        const d = x.b - x.a, w = plainW(ww[k]);
        if (d <= 0) out.push({ i, sev: 'err', msg: `«${w}»: конец раньше начала` });
        else if (d < 0.04) out.push({ i, sev: 'warn', msg: `«${w}»: слишком короткое (${Math.round(d * 1000)} мс)` });
        else if (d > 8) out.push({ i, sev: 'warn', msg: `«${w}»: очень долгое (${d.toFixed(1)} с) — не тянется ли на инструментал?` });
        if (k && x.a < sy[k - 1].b - 0.002) out.push({ i, sev: 'err', msg: `«${w}»: перекрывает предыдущее слово` });
      });
    }
    const ws = getWords(text, sy, l.t, l.end), a = ws[0].a, b = ws[ws.length - 1].b;
    if (prevEnd != null && a < prevEnd - 0.05) out.push({ i, sev: 'warn', msg: `начинается раньше конца строки ${prevI + 1} на ${(prevEnd - a).toFixed(2)} с` });
    prevEnd = b; prevI = i;
  });
  return out;
}
