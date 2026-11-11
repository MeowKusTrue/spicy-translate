import type { ExportOpts, Layer, Line } from './types.ts';
import { editorText } from './editor.ts';
import { qaCheck } from './qa.ts';
import { shiftLine } from './edit.ts';
import { getWords, splitWords, syncComplete, wordList } from './words.ts';

export type ExportIssue = {
  i: number; sev: 'err' | 'warn'; msg: string;
  layer?: Layer; advice?: string; ignoredKey?: string;
  fix?: { label: string; line: Line };
  fixes?: { label: string; line: Line }[];
};

/** Suggestions are plans: examining an export never modifies the project. */
export function lintExport(o: ExportOpts): ExportIssue[] {
  const mode = o.mode || 'translation', issues: ExportIssue[] = qaCheck(o.lines, mode, { wordSpread: o.wordSpread });
  const first = o.lines.reduce((best, l, i) => l.t < (o.lines[best]?.t ?? Infinity) ? i : best, 0);
  let previous: { i: number; end: number } | undefined;
  o.lines.forEach((line, i) => {
    if (!Number.isFinite(line.t) || !Number.isFinite(line.end) || line.t < 0 || line.end <= line.t) issues.push({ i, sev: 'err', msg: 'Некорректное начало или конец строки. Исправь время в редакторе.' });
    const main: Layer = mode === 'translation' && line.tr.trim() ? 'tr' : 'orig';
    const back: Layer = mode !== 'original' && line.bg?.tr.trim() ? 'bg' : 'bgo';
    const mainText = editorText(line, main);
    if (mainText.trim()) {
      const ws = getWords(mainText, line.sync?.[main], line.t, line.end);
      const overlap = previous ? previous.end - ws[0].a : 0;
      const issue = issues.find(x => x.i === i && x.msg.startsWith('начинается раньше конца строки '));
      if (issue && previous && Number.isFinite(overlap) && overlap > 0.05) {
        issue.layer = main;
        issue.advice = 'Перекрытие может быть намеренным дуэтом. Проверь на слух; можно подтвердить его для этой сессии или явно сдвинуть всю текущую строку вправо.';
        issue.ignoredKey = `overlap:${previous.i}:${i}:${main}:${JSON.stringify([o.lines[previous.i], line])}`;
        const shifted = structuredClone(line);
        shiftLine(shifted, line, overlap);
        issue.fix = { label: `Сдвинуть всю строку вправо на +${overlap.toFixed(3)} с`, line: shifted };
        issue.fixes = [issue.fix];
      }
      previous = { i, end: ws[ws.length - 1].b };
    }
    if (!editorText(line, main).trim() && (line.bg?.text.trim() || line.bg?.tr.trim())) {
      const promoted = structuredClone(line);
      promoted.text = line.bg!.text; promoted.tr = line.bg!.tr;
      promoted.sync = { ...line.sync, orig: line.sync?.bgo, tr: line.sync?.bg };
      delete promoted.bg; delete promoted.sync.bgo; delete promoted.sync.bg;
      if (line.approved) {
        promoted.approved = { orig: line.approved.bgo, tr: line.approved.bg };
      }
      issues.push({ i, sev: 'warn', msg: (i === first ? 'Песня начинается с бэка без основного вокала.' : 'Отдельная строка бэка без основного вокала.') + ' Если фраза поётся самостоятельно — сделай её основной. Если поверх вокала — прикрепи к соответствующей строке в редакторе.',
        ...(!line.text.trim() && !line.tr.trim() ? { fix: { label: 'Сделать основной строкой (сохранить времена)', line: promoted } } : {}) });
    }
    const layers = new Set<Layer>([main]);
    if (mode === 'bilingual' && line.tr.trim()) layers.add('tr');
    if (line.bg && (mode !== 'bilingual' || !editorText(line, main).trim() || !line.tr.trim())) layers.add(back);
    for (const layer of layers) {
      const before = editorText(line, layer);
      if (!before.trim()) continue;
      const replaceText = (text: string): Line => {
        const fixed = structuredClone(line);
        if (layer === 'orig') fixed.text = text;
        else if (layer === 'tr') fixed.tr = text;
        else if (fixed.bg) fixed.bg[layer === 'bg' ? 'tr' : 'text'] = text;
        return fixed;
      };
      const lookalikes: Record<string, string> = { А:'A', В:'B', С:'C', Е:'E', Н:'H', К:'K', М:'M', О:'O', Р:'P', Т:'T', Х:'X', а:'a', е:'e', о:'o', р:'p', с:'c', у:'y', х:'x' };
      const reverse = Object.fromEntries(Object.entries(lookalikes).map(([a,b]) => [b,a]));
      const mixed = [...before.matchAll(/[\p{L}|]+/gu)].filter(m => /[\p{Script=Cyrillic}]/u.test(m[0]) && /[\p{Script=Latin}]/u.test(m[0]));
      for (const match of mixed) {
        const word = match[0], cyr = [...word].filter(c => /\p{Script=Cyrillic}/u.test(c)).length, lat = [...word].filter(c => /\p{Script=Latin}/u.test(c)).length;
        const minority = cyr < lat ? /\p{Script=Cyrillic}/u : /\p{Script=Latin}/u, mapping = cyr < lat ? lookalikes : reverse;
        const canFix = cyr !== lat && [...word].every(c => !minority.test(c) || mapping[c]);
        const corrected = [...word].map(c => minority.test(c) ? mapping[c] || c : c).join('');
        const text = before.slice(0,match.index) + corrected + before.slice(match.index! + word.length);
        issues.push({ i, layer, sev:'err', msg:`«${word.replace(/\|/g,'')}»: русские и английские буквы в одном слове.`,
          advice:'Проверь язык слова. Похожие буквы из другой раскладки нужно заменить; произвольные смешанные названия требуют ручной проверки.',
          ...(canFix ? {fix:{label:`Заменить на «${corrected.replace(/\|/g,'')}» без сдвига времени`,line:replaceText(text)}} : {}) });
      }
      if (/…|\.{3,}/u.test(before)) {
        const remove = before.replace(/…|\.{3,}/gu,''), dash = before.replace(/…|\.{3,}/gu,'—');
        const fixes = [{label:'Фраза оборвана — заменить многоточие на —',line:replaceText(dash)}];
        if (wordList(remove).length === wordList(before).length) fixes.unshift({label:'Фраза закончена — убрать многоточие',line:replaceText(remove)});
        issues.push({i,layer,sev:'warn',msg:'Многоточие: проверь, закончена фраза или слово оборвано.',advice:'Пауза обозначается временем, а не многоточием. Оборванное слово заканчивается на —. Выбери вариант на слух; времена слов сохраняются.',fixes});
      }
      const sy = line.sync?.[layer], words = wordList(before);
      if (!syncComplete(sy, words.length) && (mode === 'bilingual' || o.wordSpread !== false)) {
        const issue = layer === main ? issues.find(x => x.i === i && x.msg === 'слова не размечены — будет равномерный спред') : undefined;
        const missing: ExportIssue = issue || { i, sev: 'warn', msg: `${layer}: слова не размечены — будет равномерный спред` };
        missing.layer = layer;
        missing.advice = 'Черновое распределение заполняет только отсутствующие границы слов. Уже заданные времена сохраняются; результат нужно проверить на слух.';
        // A mismatched array cannot safely be mapped back to the current text.
        if ((!sy || sy.length <= words.length) && Number.isFinite(line.t) && Number.isFinite(line.end) && line.t >= 0 && line.end > line.t) {
          const positions = splitWords(before, 0, 1).flatMap(w => [w.a, w.b]);
          const bounds = words.flatMap((_, k) => [sy?.[k]?.a ?? null, sy?.[k]?.b ?? null]);
          // Interpolate each missing run between its nearest explicit bounds; equal
          // positions join adjacent words without spending any of the gap on silence.
          for (let start = 0; start < bounds.length;) {
            if (bounds[start] != null) { start++; continue; }
            let end = start;
            while (end < bounds.length && bounds[end] == null) end++;
            const a = start ? bounds[start - 1]! : line.t, b = end < bounds.length ? bounds[end]! : line.end;
            const left = start ? positions[start - 1] : 0, right = end < bounds.length ? positions[end] : 1;
            for (let k = start; k < end; k++) bounds[k] = a + (b - a) * (positions[k] - left) / (right - left);
            start = end;
          }
          const draft = words.map((_, k) => {
            const old = sy?.[k];
            return { ...old, a: bounds[2 * k], b: bounds[2 * k + 1],
              ...(old?.a == null || old.b == null ? { g: 1 as const } : {}) };
          });
          if (draft.every((x, k) => x.a != null && x.b != null && Number.isFinite(x.a) && Number.isFinite(x.b) && x.a >= 0 && x.b > x.a
            && (!k || (sy?.[k - 1]?.b != null && sy?.[k]?.a != null) || x.a >= draft[k - 1].b!))) {
            const fixed = structuredClone(line);
            fixed.sync = { ...fixed.sync, [layer]: draft };
            missing.fix = { label: 'Распределить неразмеченные слова (черновик)', line: fixed };
            missing.fixes = [missing.fix];
          }
        }
        if (!issue) issues.push(missing);
      }
      if (line.sync?.[layer]?.some(x => (x.a != null && (!Number.isFinite(x.a) || x.a < 0)) || (x.b != null && (!Number.isFinite(x.b) || x.b < 0)))) issues.push({ i, sev: 'err', msg: `${layer}: некорректное время слова. Исправь его в редакторе.` });
      const after = before.replace(/\|([-‐‑]+)/gu, '$1|').replace(/(^|\s)[–-](?=\s|$)/g, '$1—');
      if (after !== before) {
        const fixed = structuredClone(line);
        if (layer === 'orig') fixed.text = after;
        else if (layer === 'tr') fixed.tr = after;
        else if (fixed.bg) fixed.bg[layer === 'bg' ? 'tr' : 'text'] = after;
        issues.push({ i, sev: 'warn', msg: `${layer}: «${before}» → «${after}». Дефисы остаются слева от границы слога; отдельное тире — «—».`, fix: { label: 'Исправить знаки без изменения времени', line: fixed } });
      }
      if (/[?!]{2,}/.test(before)) issues.push({ i, sev: 'warn', msg: `${layer}: сочетание ?! или повтор знаков. Проверь пунктуацию; она может быть авторской.` });
    }
  });
  return issues.map(issue => {
    const line = o.lines[issue.i];
    issue.layer ??= mode === 'translation' && line.tr.trim() ? 'tr' : 'orig';
    issue.advice ??= issue.fix ? 'Примени предложенное исправление и проверь результат.' : 'Проверь строку в редакторе и на слух перед экспортом.';
    if (issue.fix && !issue.fixes) issue.fixes = [issue.fix];
    return issue;
  });
}
