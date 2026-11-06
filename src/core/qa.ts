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
    else if (d < SHORT_WORD && /[\p{L}\p{N}]/u.test(ww[k])) out.push({ i, sev: 'warn', msg: `${w}: слишком короткое (${Math.round(d * 1000)} мс) — в Spicy лишь мигнёт, растяни до ${SHORT_WORD * 1000} мс+` });
    else if (d > 8) out.push({ i, sev: 'warn', msg: `${w}: очень долгое (${d.toFixed(1)} с) — не тянется ли на инструментал?` });
    if (k && x.a < sy[k - 1].b - 0.002) out.push({ i, sev: 'err', msg: `${w}: перекрывает предыдущее слово` });
  });
  return true;
}
const mainLayer = (l: Line, mode: Mode) => mode !== 'translation' ? 'orig' : (l.tr && l.tr.trim() ? 'tr' : 'orig');
/**
 * Where the maker stopped: the first line (in song order) whose exported words are not all marked by hand,
 * plus how many lines are done. -1 = everything is marked.
 */
export function stopLine(lines: Line[], mode: Mode = 'translation') {
  const bil = mode === 'bilingual', order = lines.map((l, i) => i).sort((a, b) => lines[a].t - lines[b].t);
  let first = -1, done = 0, n = 0;
  for (const i of order) {
    const l = lines[i], layer = mainLayer(l, mode), text = layer === 'tr' ? l.tr.trim() : l.text.trim();
    const bgL = l.bg && (l.bg.tr.trim() && mode === 'translation' ? 'bg' : 'bgo'), bgT = l.bg && (bgL === 'bg' ? l.bg.tr : l.bg.text).trim();
    const parts = ([[text, layer], [bgT, bgL]] as [string, string][]).filter(([t]) => t);
    if (!parts.length) continue;
    n++;
    const ok = parts.every(([t, ly]) => { const sy = l.sync && l.sync[ly as 'tr']; return syncComplete(sy, wordList(t).length) && !sy.some(x => x.g); });
    if (ok) done++; else if (first < 0) first = i;
  }
  return { i: first, done, n };
}

const CYR = /\p{Script=Cyrillic}/u, LATN = /\p{Script=Latin}/u;
/** first letter of a line (after quotes, brackets, dashes) */
const firstLetter = (t: string) => plainW(t).match(/\p{L}/u)?.[0] || '';
/**
 * Text checks of one exported line: a word mixing Cyrillic and Latin letters (keyboard layout slip, «пpивет»),
 * Latin words in a Russian translation (anglicisms left untranslated), lowercase start when the song starts lines
 * with a capital (capsMost).
 */
export function textIssues(text: string, o: { tr?: boolean; capsMost?: boolean } = {}): string[] {
  const out: string[] = [], ws = wordList(text).map(w => plainW(w).replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, '')).filter(Boolean);
  const mixed = ws.filter(w => CYR.test(w) && LATN.test(w));
  if (mixed.length) out.push(`${mixed.map(w => '«' + w + '»').join(', ')}: латиница и кириллица в одном слове — опечатка раскладки?`);
  if (o.tr && ws.some(w => CYR.test(w))) {
    const lat = ws.filter(w => LATN.test(w) && !CYR.test(w) && !/^[A-Z0-9]{2,}$/.test(w)); // «DJ», «BMW» — names, fine
    if (lat.length) out.push(`латиница в переводе: ${lat.map(w => '«' + w + '»').join(', ')} — перевести или транслитерировать?`);
  }
  const c = firstLetter(text);
  if (o.capsMost && c && c !== c.toUpperCase()) out.push('строка с маленькой буквы, а остальные с заглавной');
  return out;
}

// pre-export checks (shared with the MCP server)
export function qaCheck(lines: Line[], mode: Mode = 'translation', o: { wordSpread?: boolean } = {}): QaItem[] {
  const words = mode === 'bilingual' || o.wordSpread !== false;
  const out: QaItem[] = [], bil = mode === 'bilingual'; let prevEnd: number | null = null, prevI = -1;
  const mains = lines.map(l => mode !== 'translation' || !(l.tr && l.tr.trim()) ? l.text : l.tr).map(firstLetter).filter(Boolean);
  const capsMost = mains.filter(c => c !== c.toLowerCase()).length >= mains.length * 0.6;
  lines.forEach((l, i) => {
    const hasTr = l.tr && l.tr.trim(), layer = mode !== 'translation' ? 'orig' : (hasTr ? 'tr' : 'orig');
    const text = layer === 'tr' ? l.tr.trim() : l.text;
    // what Spicy Lyrics would drop or show badly
    if (l.bg && (l.bg.text.trim() || l.bg.tr.trim())) {
      if (!words) out.push({ i, sev: 'warn', msg: 'бэк не попадёт в файл: без пословной подсветки Spicy не показывает бэки' });
      else if (mode !== 'bilingual' && wordList(l.bg.tr.trim() ? l.bg.tr : l.bg.text).some(w => !w.replace(/[()]/g, '').trim())) out.push({ i, sev: 'warn', msg: 'в бэке отдельные скобки — Spicy их уберёт, лучше удалить из текста' });
    }
    if (plainW(text || '').length > 70) out.push({ i, sev: 'warn', msg: `длинная строка (${plainW(text).length} символов) — в Spicy займёт 2–3 ряда, может, разбить?` });
    if (!text || !text.trim()) { if (!(l.bg && (l.bg.text.trim() || l.bg.tr.trim()))) out.push({ i, sev: 'err', msg: 'пустая строка — Spicy не загрузит файл' }); return; } // bg-only line is fine
    if (!hasTr && mode !== 'original') out.push({ i, sev: 'warn', msg: 'нет перевода — пойдёт оригинал' });
    for (const msg of textIssues(text, { tr: layer === 'tr', capsMost })) out.push({ i, sev: 'warn', msg });
    const sy = l.sync && l.sync[layer];
    if (!wordIssues(out, i, text, sy)) out.push({ i, sev: 'warn', msg: 'слова не размечены — будет равномерный спред' });
    else if (sy!.some(x => x.g)) out.push({ i, sev: 'warn', msg: 'слова только раскиданы, не проверены вручную' });
    if (words && l.bg) { const bl = mode === 'translation' && l.bg.tr.trim() ? 'bg' : 'bgo', bt = (bl === 'bg' ? l.bg.tr : l.bg.text).trim(); if (bt) wordIssues(out, i, bt, l.sync && l.sync[bl], 'бэк '); }
    const ws = getWords(text, sy, l.t, l.end), a = ws[0].a, b = ws[ws.length - 1].b;
    if (prevEnd != null && a < prevEnd - 0.05) out.push({ i, sev: 'warn', msg: `начинается раньше конца строки ${prevI + 1} на ${(prevEnd - a).toFixed(2)} с` });
    prevEnd = b; prevI = i;
  });
  return out;
}
