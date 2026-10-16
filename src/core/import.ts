// Import lyrics from files: TTML (ours / Apple / Spicy style — singers, background vocals, word & syllable timings),
// SRT, LRC and plain text. Pure functions (no DOM), so the web editor, the extension and the MCP server share them.
import type { Agent, Line, Unit, WordSync } from './types.ts';
import { entriesToLines, parseLRC } from './lrc.ts';
import { NBSP, units, unitsText } from './words.ts';

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** TTML time expressions: "1:02.345", "01:02:03.4", "62.3", "62.3s", "1500ms", "00:01:02:12" (frames ignored). */
export function parseTimeExpr(v: string | null | undefined): number {
  if (v == null) return NaN;
  const s = String(v).trim();
  let m = s.match(/^([\d.]+)(h|m|s|ms)$/);
  if (m) { const n = parseFloat(m[1]); return m[2] === 'h' ? n * 3600 : m[2] === 'm' ? n * 60 : m[2] === 'ms' ? n / 1000 : n; }
  const p = s.split(':');
  if (p.length > 4 || p.some(x => !/^\d+(\.\d+)?$/.test(x))) return NaN;
  if (p.length === 4) p.pop(); // frames
  return p.reduce((acc, x) => acc * 60 + parseFloat(x), 0);
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unesc = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (all, e: string) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENT[e.toLowerCase()] ?? all));
const attr = (a: string, name: string) => { const m = a.match(new RegExp('(?:^|\\s)' + name.replace(':', '\\:') + '\\s*=\\s*"([^"]*)"')); return m ? unesc(m[1]) : null; };

type TU = Unit & { a: number; b: number };
function finish(us: TU[]): { text: string; sync: WordSync[] } | null {
  const clean = us.map(u => ({ ...u, w: u.w.trim().replace(/\|/g, '¦').replace(/\s+/g, NBSP) })).filter(u => u.w);
  if (!clean.length) return null;
  clean[clean.length - 1].sp = true;
  const text = unitsText(clean);
  return { text, sync: clean.map(u => ({ a: r3(u.a), b: r3(Math.max(u.a, u.b)) })) };
}

/** TTML -> lines. Word/syllable spans become our units (no whitespace between spans = syllables of one word). */
export function parseTTML(xml: string): Line[] {
  const out: Line[] = [];
  const re = /<!--[\s\S]*?-->|<(\/?)([\w:.-]+)((?:\s[^>]*?)?)(\/?)>|([^<]+)/g;
  let p: null | { t: number; end: number; agent: string | null; sec: string | null; main: TU[]; bg: TU[]; plain: string } = null;
  // sections: amll:section ids (NaeNae's TTML tool) with labels from <amll:meta key="amll:sections">, or Apple's <div itunes:song-part>
  const secName = new Map<string, string>(); let part = '', divN = 0, lastSec = '';
  let target: 'main' | 'bg' = 'main';
  const stack: ({ kind: 'timed'; a: number; b: number; text: string } | { kind: 'bg' } | { kind: 'other' })[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    if (m[0].startsWith('<!--')) continue;
    const [, close, rawName, attrs = '', selfClose, text] = m;
    if (text != null) {
      if (!p) continue;
      const tx = unesc(text), top = stack[stack.length - 1];
      if (top && top.kind === 'timed') top.text += tx;
      else {
        const list = p[target];
        if (/\s/.test(tx) && list.length) list[list.length - 1].sp = true; // whitespace between spans = word boundary
        if (!p.main.length && !p.bg.length) p.plain += tx;
      }
      continue;
    }
    const name = rawName.replace(/^.*:/, '').toLowerCase();
    if (name === 'p') {
      if (!close) { p = { t: parseTimeExpr(attr(attrs, 'begin')), end: parseTimeExpr(attr(attrs, 'end')), agent: attr(attrs, 'ttm:agent'), sec: attr(attrs, 'amll:section'), main: [], bg: [], plain: '' }; target = 'main'; stack.length = 0; if (selfClose) p = null; }
      else if (p) {
        const main = finish(p.main), bg = finish(p.bg);
        const text = main ? main.text : p.plain.replace(/\s+/g, ' ').trim();
        if ((text || bg) && Number.isFinite(p.t)) { // a <p> with only x-bg = background-only line
          const ok = main && units(main.text).length === main.sync.length;
          const bgOk = bg && units(bg.text).length === bg.sync.length;
          const last = main || bg, t = p.t, end = Number.isFinite(p.end) ? p.end : (last ? last.sync[last.sync.length - 1].b! : t + 3);
          const agent = (p.agent === 'v2' || p.agent === 'v2000') ? 'v2' : (p.agent === 'v1000' ? 'v1000' : undefined) as Agent | undefined;
          const sync: Line['sync'] = {};
          if (ok) sync!.orig = main!.sync;
          if (bgOk) sync!.bgo = bg!.sync;
          const key = p.sec || (part ? 'd' + divN : ''), label = p.sec ? secName.get(p.sec) || p.sec : part, sec = key && key !== lastSec ? label : '';
          lastSec = key;
          out.push({ t: r3(t), end: r3(Math.max(end, t + 0.3)), text, tr: '',
            ...(ok || bgOk ? { sync } : {}), ...(agent ? { agent } : {}), ...(bg ? { bg: { text: bg.text, tr: '' } } : {}), ...(sec ? { sec } : {}) });
        }
        p = null;
      }
      continue;
    }
    if (name === 'meta' && attr(attrs, 'key') === 'amll:sections') {
      try { for (const s of JSON.parse(attr(attrs, 'value') || '{}').sections || []) if (s && s.id) secName.set(String(s.id), String(s.label || s.category || s.id)); } catch { /* optional metadata */ }
      continue;
    }
    if (name === 'div') { if (!close) { part = attr(attrs, 'itunes:song-part') || ''; divN++; } else part = ''; continue; }
    if (!p) continue;
    if (name === 'br' && p) { const list = p[target]; if (list.length) list[list.length - 1].sp = true; else p.plain += ' '; continue; }
    if (name !== 'span') continue;
    if (!close) {
      const role = attr(attrs, 'ttm:role') || '';
      if (/x-bg/.test(role)) { stack.push({ kind: 'bg' }); target = 'bg'; }
      else {
        const a = parseTimeExpr(attr(attrs, 'begin')), b = parseTimeExpr(attr(attrs, 'end'));
        stack.push(Number.isFinite(a) && Number.isFinite(b) ? { kind: 'timed', a, b, text: '' } : { kind: 'other' });
      }
      if (selfClose) stack.pop();
    } else {
      const top = stack.pop();
      if (!top) continue;
      if (top.kind === 'bg') target = 'main';
      else if (top.kind === 'timed') {
        const w = top.text;
        if (w.trim()) p[target].push({ w, sp: /\s$/.test(w), a: top.a, b: top.b });
        else if (/\s/.test(w) && p[target].length) p[target][p[target].length - 1].sp = true;
      }
    }
  }
  return out.sort((x, y) => x.t - y.t);
}

/** <songwriter> names from a TTML <head> (Apple iTunesMetadata, what our export writes) */
export const ttmlSongwriters = (xml: string) => [...xml.matchAll(/<songwriter>([^<]*)<\/songwriter>/g)].map(m => unesc(m[1]).trim()).filter(Boolean);

/** SRT -> lines (one cue = one line; multi-line cues are joined with a space). */
export function parseSRT(text: string): Line[] {
  const out: Line[] = [];
  const t = (h: string, mi: string, s: string, ms: string) => +h * 3600 + +mi * 60 + +s + +ms / 1000;
  for (const block of String(text).replace(/\r/g, '').split(/\n\s*\n/)) {
    const m = block.match(/(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)[^\n]*\n([\s\S]*)/);
    if (!m) continue;
    const body = m[9].replace(/<[^>]+>/g, '').split('\n').map(s => s.trim()).filter(Boolean).join(' ');
    if (!body) continue;
    const a = t(m[1], m[2], m[3], m[4]), b = t(m[5], m[6], m[7], m[8]);
    out.push({ t: r3(a), end: r3(Math.max(b, a + 0.3)), text: body, tr: '' });
  }
  return out;
}

export type ImportKind = 'ttml' | 'srt' | 'lrc' | 'text';
/**
 * Any lyrics file -> lines. Plain text (no timings) is laid out evenly over the track so the lines are in the right
 * area of the timeline; exact timing then comes from F/G/H marking.
 */
export function importLyrics(text: string, fileName = '', duration = 0): { lines: Line[]; kind: ImportKind } {
  const s = String(text || '').replace(/^﻿/, '');
  if (/\.ttml$|\.xml$/i.test(fileName) || /<tt[\s>]/.test(s)) return { lines: parseTTML(s), kind: 'ttml' };
  if (/\.srt$/i.test(fileName) || /\d+:\d+:\d+[,.]\d+\s*-->/.test(s)) return { lines: parseSRT(s), kind: 'srt' };
  const e = parseLRC(s);
  if (e.length) return { lines: entriesToLines(e, duration), kind: 'lrc' };
  const rows = s.split(/\r?\n/).map(x => x.trim()).filter(x => x && !/^\[.*\]$/.test(x)); // drop "[Chorus]"-style headers
  const n = rows.length, start = duration > 0 ? Math.min(10, duration * 0.05) : 0;
  const per = duration > 0 && n ? Math.max(1.5, (duration - start - 5) / n) : 3.5;
  return { lines: rows.map((text, i) => ({ t: r3(start + i * per), end: r3(start + (i + 1) * per - 0.05), text, tr: '' })), kind: 'text' };
}
