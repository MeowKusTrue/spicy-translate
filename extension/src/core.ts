// TODO: заменить импортом общего core после мержа master (Vite+TS-перенос веб-редактора).
// Временная копия чистых функций из reference/index.html (секция «core» до «app»), логика не менялась, добавлены только типы.

export type Span = { a: number | null; b: number | null; g?: 1 };
/** Singer of a line (TTML ttm:agent). Spicy Lyrics: v1 = main (left), v2 = second (right), v1000 = together. */
export type Agent = 'v1' | 'v2' | 'v1000';
export type Line = { t: number; end: number; text: string; tr: string; sync?: { tr?: Span[]; orig?: Span[] }; agent?: Agent };
export type Unit = { w: string; sp: boolean };
export type Word = { word: string; sp: boolean; a: number; b: number; real?: boolean };
export type Mode = 'translation' | 'bilingual';

const p2 = (n: number) => String(n).padStart(2, '0');
const p3 = (n: number) => String(n).padStart(3, '0');

export function fmtTime(t: number) {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000), r = ms % 1000;
  return h ? `${h}:${p2(m)}:${p2(s)}.${p3(r)}` : `${m}:${p2(s)}.${p3(r)}`;
}

export function esc(s: unknown) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function parseLRC(text: string) {
  const out: { t: number; text: string }[] = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const re = /\[(\d+):(\d+(?:[.:]\d+)?)\]/g;
    const stamps: number[] = [];
    let m, last = 0;
    while ((m = re.exec(raw)) !== null) {
      stamps.push(parseInt(m[1], 10) * 60 + parseFloat(m[2].replace(':', '.')));
      last = re.lastIndex;
    }
    if (!stamps.length) continue;
    // drop enhanced-LRC word tags like <00:12.34>
    const body = raw.slice(last).replace(/<\d+:\d+(?:[.:]\d+)?>/g, '').replace(/\s+/g, ' ').trim();
    for (const t of stamps) out.push({ t, text: body });
  }
  return out.sort((a, b) => a.t - b.t);
}

// plain text (no timestamps) -> fake even timing so the editor still works
export function parsePlain(text: string, perLine = 3.5) {
  return String(text).split(/\r?\n/).map(s => s.trim()).filter(Boolean)
    .map((s, i) => ({ t: i * perLine, text: s }));
}

export function entriesToLines(entries: { t: number; text: string }[], duration: number): Line[] {
  const lines: Line[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e.text) continue;
    const nxt = entries[i + 1];
    let end = nxt ? nxt.t : (duration && duration > e.t ? duration : e.t + 5);
    end = Math.min(end, e.t + 10);
    if (end - e.t < 0.3) end = e.t + 0.3;
    lines.push({ t: e.t, end, text: e.text, tr: '' });
  }
  return lines;
}

// spread words across [t0,t1] proportionally to their length
export function splitWords(text: string, t0: number, t1: number): Word[] {
  const us = units(text);
  if (!us.length) return [];
  const w = us.map(u => Math.max(1, u.w.length) + (u.sp ? 0.5 : 0));
  const total = w.reduce((a, b) => a + b, 0);
  let acc = 0;
  return us.map((u, i) => {
    const a = t0 + (t1 - t0) * (acc / total);
    acc += w[i];
    const b = t0 + (t1 - t0) * (acc / total);
    return { word: u.w, sp: u.sp, a, b };
  });
}

// NBSP glues words into one timed block (two words = one span); everything else splits on whitespace
export function units(text: string): Unit[] {
  const out: Unit[] = [];
  String(text || '').split(/[^\S ]+/).filter(Boolean).forEach(tok => {
    const parts = tok.split('|').filter(Boolean);
    parts.forEach((w, j) => out.push({ w, sp: j === parts.length - 1 }));
  });
  return out;
}
export function wordList(text: string) { return units(text).map(u => u.w); }
// units back to text: space between words, '|' between syllables of one word
export const unitsText = (us: Unit[]) => us.map((u, k) => u.w + (k < us.length - 1 ? (u.sp ? ' ' : '|') : '')).join('');
// rough syllable splitter (ru/en): V|CV, VC|CV, й/ь/ъ stay with the left part, latin vowel pairs stay together
const VOW = /[aeiouyаеёиоуыэюяіїєáéíóúàèìòùäöü]/i, LAT = /[a-z]/i;
export function syllabify(word: string) {
  const ch = [...word], vi = ch.map((c, i) => VOW.test(c) ? i : -1).filter(i => i >= 0);
  if (LAT.test(word) && /[^aeiouy]e$/i.test(word) && vi.length > 1) vi.pop(); // silent final e
  const cuts: number[] = [];
  for (let q = 0; q + 1 < vi.length; q++) {
    const i = vi[q], j = vi[q + 1], mid = ch.slice(i + 1, j), real = mid.filter(c => !/[ьъ]/i.test(c)).length;
    if (!mid.length && LAT.test(ch[i])) continue;
    let c = real <= 1 ? i + 1 : i + 2;
    while (c < j && /[йьъ]/i.test(ch[c])) c++;
    if (real === 1 && /[ьъ]/i.test(ch[i + 1] || '')) c = i + 1;
    cuts.push(c);
  }
  const out: string[] = []; let st = 0; cuts.forEach(c => { if (c > st) { out.push(ch.slice(st, c).join('')); st = c; } }); out.push(ch.slice(st).join(''));
  return out.filter(Boolean);
}
export const plainW = (w: string) => String(w).replace(/ /g, ' ').replace(/\|/g, '');
export function syncComplete(sync: Span[] | undefined | null, n: number): sync is { a: number; b: number; g?: 1 }[] {
  return Array.isArray(sync) && sync.length === n && n > 0 && sync.every(x => x && x.a != null && x.b != null);
}
// real (hand-synced) word timings if the layer is fully synced, otherwise an even spread
export function getWords(text: string, sync: Span[] | undefined | null, t0: number, t1: number): Word[] {
  const us = units(text);
  if (syncComplete(sync, us.length)) return us.map((u, i) => ({ word: u.w, sp: u.sp, a: sync[i].a, b: sync[i].b, real: true }));
  return splitWords(text, t0, t1);
}

export type TTMLOpts = { lines: Line[]; mode?: Mode; wordSpread?: boolean; lang?: string; offset?: number; songwriters?: string[] };

export function buildTTML(o: TTMLOpts) {
  const { lines, mode = 'translation', wordSpread = true, lang = 'ru', offset = 0, songwriters = [] } = o;
  const shift = (offset || 0) / 1000;
  const bilingual = mode === 'bilingual';
  const wordTiming = bilingual || wordSpread;
  const sh = (ws: Word[]) => ws.map(w => ({ word: w.word, sp: w.sp, a: Math.max(0, w.a + shift), b: Math.max(0, w.b + shift) }));
  const items: { a: number; b: number; mainText: string; main: Word[] | null; bg: Word[] | null; agent: Agent }[] = [];
  for (const l of lines) {
    const hasTr = l.tr && l.tr.trim();
    const mainLayer = bilingual ? 'orig' : (hasTr ? 'tr' : 'orig');
    const mainText = mainLayer === 'tr' ? l.tr.trim() : l.text;
    if (!mainText || !mainText.trim()) continue;
    const sync = l.sync || {};
    const it = { a: Math.max(0, l.t + shift), b: Math.max(0, l.end + shift), mainText, main: null as Word[] | null, bg: null as Word[] | null, agent: (l.agent || 'v1') as Agent };
    if (wordTiming) {
      it.main = sh(getWords(mainText, sync[mainLayer], l.t, l.end));
      if (bilingual && hasTr) it.bg = sh(getWords(l.tr.trim().replace(/[()]/g, ''), sync.tr, l.t, l.end));
      const all = it.main.concat(it.bg || []);
      it.a = Math.min(...all.map(w => w.a)); it.b = Math.max(...all.map(w => w.b));
    }
    items.push(it);
  }
  const dur = items.length ? Math.max(...items.map(i => i.b)) : 0;
  const spans = (ws: Word[]) => ws.map((w, k) => `<span begin="${fmtTime(w.a)}" end="${fmtTime(w.b)}">${esc(plainW(w.word))}</span>` + (k < ws.length - 1 && w.sp !== false ? ' ' : '')).join(''); // syllables: no space between spans
  let body = '';
  items.forEach((l, i) => {
    let inner;
    if (wordTiming) {
      inner = spans(l.main!);
      if (l.bg) inner += `<span ttm:role="x-bg">${spans(l.bg)}</span>`;
    } else inner = esc(plainW(l.mainText));
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
      <iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal"><songwriters>${sw}</songwriters></iTunesMetadata>
    </metadata>
  </head>
  <body dur="${fmtTime(dur)}">
    <div begin="${fmtTime(items.length ? Math.min(...items.map(i => i.a)) : 0)}" end="${fmtTime(dur)}">
${body}    </div>
  </body>
</tt>
`;
}

// pre-export checks (shared with the MCP server)
export function qaCheck(lines: Line[], mode: Mode = 'translation') {
  const out: { i: number; sev: 'err' | 'warn'; msg: string }[] = [], bil = mode === 'bilingual'; let prevEnd: number | null = null, prevI = -1;
  lines.forEach((l, i) => {
    const hasTr = l.tr && l.tr.trim(), layer = bil ? 'orig' : (hasTr ? 'tr' : 'orig');
    const text = layer === 'tr' ? l.tr.trim() : l.text;
    if (!text || !text.trim()) { out.push({ i, sev: 'err', msg: 'пустая строка — Spicy не загрузит файл' }); return; }
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
