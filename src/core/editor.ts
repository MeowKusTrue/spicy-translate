import type { Layer, Line, WordSync } from './types.ts';
import { wordList } from './words.ts';
import { JOIN } from './timeline.ts';

export const editorText = (l: Line, layer: Layer) => layer === 'orig' ? l.text : layer === 'tr' ? l.tr : layer === 'bgo' ? l.bg?.text || '' : l.bg?.tr || '';
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const timed = (x: WordSync | undefined): x is WordSync & { a: number; b: number } => !!x && x.a != null && x.b != null && Number.isFinite(x.a) && Number.isFinite(x.b) && x.a >= 0 && x.b > x.a;

/** Plan an exact edit before taking an undo snapshot; other phrases may overlap independently. */
export function retimeWord(line: Line, layer: Layer, k: number, start: number, end: number, roll = true): { sync: WordSync[] } | { error: string } {
  const src = line.sync?.[layer], n = wordList(editorText(line, layer)).length;
  if (!src || src.length !== n || !src[k]) return { error: 'Сначала выбери слово на дорожке.' };
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { error: 'Укажи время: 1:04.300 или 64.300.' };
  const a = r3(start), b = r3(end);
  if (a < 0 || b - a < .02 - 1e-9) return { error: 'Начало должно быть не меньше нуля, длительность — от 20 мс.' };
  const sync = src.map(x => ({ ...x })), x = sync[k], prev = sync[k - 1], next = sync[k + 1];
  const left = roll && prev?.b != null && x.a != null && Math.abs(prev.b - x.a) <= JOIN;
  const right = roll && next?.a != null && x.b != null && Math.abs(next.a - x.b) <= JOIN;
  if (prev?.b != null && (left ? prev.a != null && a < prev.a + .02 - 1e-9 : a < prev.b - 1e-9)) return { error: 'Начало пересекает предыдущее слово. Измени общую границу или сдвинь соседнее слово.' };
  if (next?.a != null && (right ? next.b != null && b > next.b - .02 + 1e-9 : b > next.a + 1e-9)) return { error: 'Конец пересекает следующее слово. Измени общую границу или сдвинь соседнее слово.' };
  const confirm = (w: WordSync) => { delete w.g; delete w.c; };
  if (left && prev.b !== a) { prev.b = a; confirm(prev); }
  if (right && next.a !== b) { next.a = b; confirm(next); }
  x.a = a; x.b = b; confirm(x);
  return { sync };
}

export type ReviewItem = { i: number; k: number; reason: string };
export function confirmPhraseTiming(line: Line, layer: Layer): { sync: WordSync[] } | { error: string } {
  const ws = wordList(editorText(line, layer)), sy = line.sync?.[layer];
  if (!ws.length || !sy || sy.length !== ws.length || !sy.every(timed)) return { error: 'Сначала задай корректное время всех слов фразы.' };
  if (sy.some((x, k) => k > 0 && x.a! < sy[k - 1].b! - .002)) return { error: 'Сначала исправь пересечение слов одной фразы.' };
  return { sync: sy.map(({ a, b }) => ({ a, b })) };
}
/** A review pass on one track; punctuation is not a sung word with a minimum duration. */
export function editorReview(lines: Line[], layer: Layer): ReviewItem[] {
  const out: ReviewItem[] = [];
  lines.forEach((l, i) => { const ws = wordList(editorText(l, layer)); ws.forEach((w, k) => {
    if (!/[\p{L}\p{N}]/u.test(w)) return;
    const sy = l.sync?.[layer], x = sy?.length === ws.length ? sy[k] : undefined, prev = sy?.[k - 1];
    const reason = !timed(x) ? 'Нет корректного тайминга' : prev?.b != null && x.a < prev.b - .002 ? 'Перекрытие слов в строке'
      : x.b - x.a < .05 - 1e-9 ? 'Слово короче 50 мс' : x.g ? 'Авточерновик: проверь на слух' : '';
    if (reason) out.push({ i, k, reason });
  }); });
  return out;
}

export function layerProgress(lines: Line[], layer: Layer) {
  let total = 0, done = 0, words = 0, marked = 0, auto = 0;
  lines.forEach(l => {
    const ws = wordList(editorText(l, layer)); if (!ws.length) return;
    total++; words += ws.length;
    const sy = l.sync?.[layer], valid = sy?.length === ws.length;
    if (valid && sy.every(x => timed(x) && !x.g)) done++;
    if (valid) sy.forEach(x => { if (timed(x)) { marked++; if (x.g) auto++; } });
  });
  return { total, done, words, marked, auto };
}
