import type { Line, Mode, WordSync } from './types.ts';
import { getWords, plainW, syncComplete, wordList } from './words.ts';

export interface QaItem { i: number; sev: 'err' | 'warn'; msg: string }
/** shorter than this a word only flickers in Spicy */
export const SHORT_WORD = 0.05;

/** word-timing problems of one synced layer (both the main line and its background vocals) */
function wordIssues(out: QaItem[], i: number, text: string, sy: WordSync[] | null | undefined, what = '') {
  const ww = wordList(text);
  if (!syncComplete(sy, ww.length)) return false;
  sy.forEach((x, k) => {
    const d = x.b - x.a, w = what + '«' + plainW(ww[k]) + '»';
    if (d <= 0) out.push({ i, sev: 'err', msg: `${w}: конец раньше начала` });
    else if (d < SHORT_WORD) out.push({ i, sev: 'warn', msg: `${w}: слишком короткое (${Math.round(d * 1000)} мс) — в Spicy лишь мигнёт, растяни до ${SHORT_WORD * 1000} мс+` });
    else if (d > 8) out.push({ i, sev: 'warn', msg: `${w}: очень долгое (${d.toFixed(1)} с) — не тянется ли на инструментал?` });
    if (k && x.a < sy[k - 1].b - 0.002) out.push({ i, sev: 'err', msg: `${w}: перекрывает предыдущее слово` });
  });
  return true;
}
const mainLayer = (l: Line, bil: boolean) => bil ? 'orig' : (l.tr && l.tr.trim() ? 'tr' : 'orig');
/**
 * Where the maker stopped: the first line (in song order) whose exported words are not all marked by hand,
 * plus how many lines are done. -1 = everything is marked.
 */
export function stopLine(lines: Line[], mode: Mode = 'translation') {
  const bil = mode === 'bilingual', order = lines.map((l, i) => i).sort((a, b) => lines[a].t - lines[b].t);
  let first = -1, done = 0, n = 0;
  for (const i of order) {
    const l = lines[i], layer = mainLayer(l, bil), text = layer === 'tr' ? l.tr.trim() : l.text.trim();
    const bgL = l.bg && (l.bg.tr.trim() && !bil ? 'bg' : 'bgo'), bgT = l.bg && (bgL === 'bg' ? l.bg.tr : l.bg.text).trim();
    const parts = ([[text, layer], [bgT, bgL]] as [string, string][]).filter(([t]) => t);
    if (!parts.length) continue;
    n++;
    const ok = parts.every(([t, ly]) => { const sy = l.sync && l.sync[ly as 'tr']; return syncComplete(sy, wordList(t).length) && !sy.some(x => x.g); });
    if (ok) done++; else if (first < 0) first = i;
  }
  return { i: first, done, n };
}

// pre-export checks (shared with the MCP server)
export function qaCheck(lines: Line[], mode: Mode = 'translation', o: { wordSpread?: boolean } = {}): QaItem[] {
  const words = mode === 'bilingual' || o.wordSpread !== false;
  const out: QaItem[] = [], bil = mode === 'bilingual'; let prevEnd: number | null = null, prevI = -1;
  lines.forEach((l, i) => {
    const hasTr = l.tr && l.tr.trim(), layer = bil ? 'orig' : (hasTr ? 'tr' : 'orig');
    const text = layer === 'tr' ? l.tr.trim() : l.text;
    // what Spicy Lyrics would drop or show badly
    if (l.bg && (l.bg.text.trim() || l.bg.tr.trim())) {
      if (!words) out.push({ i, sev: 'warn', msg: 'бэк не попадёт в файл: без пословной подсветки Spicy не показывает бэки' });
      else if (mode !== 'bilingual' && wordList(l.bg.tr.trim() ? l.bg.tr : l.bg.text).some(w => !w.replace(/[()]/g, '').trim())) out.push({ i, sev: 'warn', msg: 'в бэке отдельные скобки — Spicy их уберёт, лучше удалить из текста' });
    }
    if (plainW(text || '').length > 70) out.push({ i, sev: 'warn', msg: `длинная строка (${plainW(text).length} символов) — в Spicy займёт 2–3 ряда, может, разбить?` });
    if (!text || !text.trim()) { if (!(l.bg && (l.bg.text.trim() || l.bg.tr.trim()))) out.push({ i, sev: 'err', msg: 'пустая строка — Spicy не загрузит файл' }); return; } // bg-only line is fine
    if (!hasTr) out.push({ i, sev: 'warn', msg: 'нет перевода — пойдёт оригинал' });
    const sy = l.sync && l.sync[layer];
    if (!wordIssues(out, i, text, sy)) out.push({ i, sev: 'warn', msg: 'слова не размечены — будет равномерный спред' });
    else if (sy!.some(x => x.g)) out.push({ i, sev: 'warn', msg: 'слова только раскиданы, не проверены вручную' });
    if (words && l.bg) { const bl = !bil && l.bg.tr.trim() ? 'bg' : 'bgo', bt = (bl === 'bg' ? l.bg.tr : l.bg.text).trim(); if (bt) wordIssues(out, i, bt, l.sync && l.sync[bl], 'бэк '); }
    const ws = getWords(text, sy, l.t, l.end), a = ws[0].a, b = ws[ws.length - 1].b;
    if (prevEnd != null && a < prevEnd - 0.05) out.push({ i, sev: 'warn', msg: `начинается раньше конца строки ${prevI + 1} на ${(prevEnd - a).toFixed(2)} с` });
    prevEnd = b; prevI = i;
  });
  return out;
}
