import type { Agent, ExportOpts, TimedWord } from './types.ts';
import { getWords, plainW, syncComplete, units } from './words.ts';
import { hasCyr, translit } from './roman.ts';

const p2 = (n: number) => String(n).padStart(2, '0');
const p3 = (n: number) => String(n).padStart(3, '0');

export function fmtTime(t: number) {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000), r = ms % 1000;
  return h ? `${h}:${p2(m)}:${p2(s)}.${p3(r)}` : `${m}:${p2(s)}.${p3(r)}`;
}

export function mmss(t: number) { t = Math.max(0, t); return Math.floor(t / 60) + ':' + p2(Math.floor(t % 60)); }

export function esc(s: unknown) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

type Item = { a: number; b: number; mainText: string; main: TimedWord[] | null; bg: TimedWord[] | null; agent: Agent };

export function buildTTML(o: ExportOpts) {
  const { lines, mode = 'translation', wordSpread = true, lang = 'ru', offset = 0, songwriters = [], roman = false } = o;
  const shift = (offset || 0) / 1000;
  const bilingual = mode === 'bilingual';
  const wordTiming = bilingual || wordSpread;
  const sh = (ws: TimedWord[]) => ws.map(w => ({ word: w.word, sp: w.sp, a: Math.max(0, w.a + shift), b: Math.max(0, w.b + shift) }));
  const items: Item[] = [];
  for (const l of lines) {
    const hasTr = l.tr && l.tr.trim();
    const mainLayer = bilingual ? 'orig' : (hasTr ? 'tr' : 'orig');
    const mainText = mainLayer === 'tr' ? l.tr.trim() : l.text, hasMain = !!(mainText && mainText.trim());
    // a line may be background vocals only (empty lead): Spicy renders those in word mode
    if (!hasMain && !(wordTiming && l.bg && (l.bg.text.trim() || l.bg.tr.trim()))) continue;
    const sync = l.sync || {};
    const it: Item = { a: Math.max(0, l.t + shift), b: Math.max(0, l.end + shift), mainText, main: null, bg: null, agent: l.agent || 'v1' };
    if (wordTiming) {
      it.main = hasMain ? sh(getWords(mainText, sync[mainLayer], l.t, l.end)) : [];
      if (bilingual && hasTr && hasMain) it.bg = sh(getWords(l.tr.trim().replace(/[()]/g, ''), sync.tr, l.t, l.end));
      else if (l.bg && (!bilingual || !hasMain)) { // background vocals: translated if there is a translation, else the original; no parentheses (Spicy rule)
        const useTr = !!(l.bg.tr && l.bg.tr.trim()), text = (useTr ? l.bg.tr : l.bg.text || '').trim();
        if (text) {
          const so = sync.bgo, n = units(l.bg.text).length;
          const [b0, b1] = syncComplete(so, n) ? [so[0].a, so[n - 1].b] : [l.t, l.end];
          const ws = sh(getWords(text, sync[useTr ? 'bg' : 'bgo'], b0, b1)).map(w => ({ ...w, word: w.word.replace(/[()]/g, '') })).filter(w => w.word);
          if (ws.length) it.bg = ws;
        }
      }
      const all = it.main.concat(it.bg || []);
      if (!all.length) continue;
      it.a = Math.min(...all.map(w => w.a)); it.b = Math.max(...all.map(w => w.b));
    }
    items.push(it);
  }
  const dur = items.length ? Math.max(...items.map(i => i.b)) : 0;
  // syllables (sp:false): no space between spans
  const spans = (ws: TimedWord[], f = (s: string) => s) => ws.map((w, k) => `<span begin="${fmtTime(w.a)}" end="${fmtTime(w.b)}">${esc(f(plainW(w.word)))}</span>` + (k < ws.length - 1 && w.sp !== false ? ' ' : '')).join('');
  let body = '', roms = '';
  items.forEach((l, i) => {
    let inner;
    if (wordTiming) {
      inner = spans(l.main!);
      if (l.bg) inner += `<span ttm:role="x-bg">${spans(l.bg)}</span>`;
      // word mode: Spicy reads romanization from <head>, matched to each span by its exact begin/end
      if (roman && (l.main!.concat(l.bg || [])).some(w => hasCyr(w.word)))
        roms += `<text for="L${i + 1}">${spans(l.main!, translit)}${l.bg ? `<span ttm:role="x-bg">${spans(l.bg, translit)}</span>` : ''}</text>`;
    } else {
      inner = esc(plainW(l.mainText));
      if (roman && hasCyr(l.mainText)) inner += `<span ttm:role="x-roman">${esc(translit(plainW(l.mainText)))}</span>`;
    }
    body += `      <p begin="${fmtTime(l.a)}" end="${fmtTime(l.b)}" ttm:agent="${l.agent}" itunes:key="L${i + 1}">${inner}</p>\n`;
  });
  const used = ['v1', 'v2', 'v1000'].filter(id => id === 'v1' || items.some(i => i.agent === id));
  const agents = used.map(id => `      <ttm:agent type="${id === 'v1000' ? 'group' : 'person'}" xml:id="${id}"/>`).join('\n');
  const sw = songwriters.filter(Boolean).map(s => `<songwriter>${esc(s)}</songwriter>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" itunes:timing="${wordTiming ? 'Word' : 'Line'}" xml:lang="${esc(lang)}">
  <head>
    <metadata>
${agents}
      <iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal"><songwriters>${sw}</songwriters>${roms ? `<transliterations><transliteration xml:lang="${esc(lang)}-Latn">${roms}</transliteration></transliterations>` : ''}</iTunesMetadata>
    </metadata>
  </head>
  <body dur="${fmtTime(dur)}">
    <div begin="${fmtTime(items.length ? Math.min(...items.map(i => i.a)) : 0)}" end="${fmtTime(dur)}">
${body}    </div>
  </body>
</tt>
`;
}

export function lineSpans(o: ExportOpts) {
  const { lines, mode = 'translation', offset = 0 } = o, shift = (offset || 0) / 1000, bil = mode === 'bilingual';
  const out: { a: number; b: number; text: string }[] = [];
  for (const l of lines) {
    const hasTr = l.tr && l.tr.trim();
    const layer = bil ? 'orig' : (hasTr ? 'tr' : 'orig');
    const text = layer === 'tr' ? l.tr.trim() : l.text;
    if (!text || !text.trim()) continue;
    const ws = getWords(text, (l.sync || {})[layer], l.t, l.end);
    out.push({ a: Math.max(0, Math.min(...ws.map(w => w.a)) + shift), b: Math.max(0, Math.max(...ws.map(w => w.b)) + shift), text: plainW(bil && hasTr ? text + '\n' + l.tr.trim() : text) });
  }
  return out;
}
export function fmtLRC(t: number) { const cs = Math.round(Math.max(0, t) * 100), m = Math.floor(cs / 6000), s = (cs % 6000) / 100; return `${p2(m)}:${s.toFixed(2).padStart(5, '0')}`; }
export function fmtSRT(t: number) { const ms = Math.round(Math.max(0, t) * 1000); return `${p2(Math.floor(ms / 3600000))}:${p2(Math.floor((ms % 3600000) / 60000))}:${p2(Math.floor((ms % 60000) / 1000))},${p3(ms % 1000)}`; }
export function buildLRC(o: ExportOpts) { return lineSpans(o).map(x => `[${fmtLRC(x.a)}]${x.text.replace(/\n/g, ' / ')}`).join('\n') + '\n'; }
export function buildSRT(o: ExportOpts) { return lineSpans(o).map((x, i) => `${i + 1}\n${fmtSRT(x.a)} --> ${fmtSRT(x.b)}\n${x.text}\n`).join('\n'); }
