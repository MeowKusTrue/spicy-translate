// Genius: the lyrics text of a song page. Genius has no lyrics API: the text sits in
// <div data-lyrics-container="true"> blocks (several, split around ads), with headers marked data-exclude-from-selection.

/** end index (after "</div>") of the <div> starting at `start`, counting nested divs */
function divEnd(h: string, start: number) {
  const re = /<div\b|<\/div>/gi; re.lastIndex = start; let depth = 0, m: RegExpExecArray | null;
  while ((m = re.exec(h))) { depth += m[0][1] === '/' ? -1 : 1; if (!depth) return re.lastIndex; }
  return h.length;
}
/** the divs carrying `attr`, cut out of `h` (keep = the divs themselves, else the rest) */
function divsWith(h: string, attr: string, keep: boolean) {
  const out: string[] = []; let from = 0;
  for (;;) {
    const i = h.indexOf(attr, from); if (i < 0) break;
    const s = h.lastIndexOf('<div', i), e = divEnd(h, s);
    out.push(keep ? h.slice(s, e) : h.slice(from, s)); from = e;
  }
  if (!keep) out.push(h.slice(from));
  return out.join(keep ? '\n' : '');
}
const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()] ?? m);

/**
 * Plain lyrics from a Genius song page: one row per sung line, "(…)" kept (they are backing vocals, our bg convention),
 * section headers like [Куплет 1] and empty rows dropped.
 */
export function geniusLyrics(html: string): string {
  const body = divsWith(divsWith(html, 'data-lyrics-container="true"', true), 'data-exclude-from-selection', false);
  const text = decode(body.replace(/<br\s*\/?>/gi, '\n').replace(/<\/div>/gi, '\n').replace(/<[^>]+>/g, ''));
  return text.split('\n').map(r => r.replace(/[ \t ]+/g, ' ').trim()).filter(r => r && !/^\[[^\]]*\]$/.test(r)).join('\n');
}
