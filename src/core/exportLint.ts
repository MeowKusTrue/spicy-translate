import type { ExportOpts, Layer, Line } from './types.ts';
import { editorText } from './editor.ts';
import { qaCheck } from './qa.ts';

export type ExportIssue = { i: number; sev: 'err' | 'warn'; msg: string; fix?: { label: string; line: Line } };

/** Suggestions are plans: examining an export never modifies the project. */
export function lintExport(o: ExportOpts): ExportIssue[] {
  const mode = o.mode || 'translation', issues: ExportIssue[] = qaCheck(o.lines, mode, { wordSpread: o.wordSpread });
  const first = o.lines.reduce((best, l, i) => l.t < (o.lines[best]?.t ?? Infinity) ? i : best, 0);
  o.lines.forEach((line, i) => {
    if (!Number.isFinite(line.t) || !Number.isFinite(line.end) || line.t < 0 || line.end <= line.t) issues.push({ i, sev: 'err', msg: 'Некорректное начало или конец строки. Исправь время в редакторе.' });
    const main: Layer = mode === 'translation' && line.tr.trim() ? 'tr' : 'orig';
    const back: Layer = mode !== 'original' && line.bg?.tr.trim() ? 'bg' : 'bgo';
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
  return issues;
}
