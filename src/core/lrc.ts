export interface Entry { t: number; text: string }

export function parseLRC(text: string): Entry[] {
  const out: Entry[] = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const re = /\[(\d+):(\d+(?:[.:]\d+)?)\]/g;
    const stamps: number[] = [];
    let m: RegExpExecArray | null, last = 0;
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
export function parsePlain(text: string, perLine = 3.5): Entry[] {
  return String(text).split(/\r?\n/).map(s => s.trim()).filter(Boolean)
    .map((s, i) => ({ t: i * perLine, text: s }));
}

export function entriesToLines(entries: Entry[], duration?: number) {
  const lines: { t: number; end: number; text: string; tr: string }[] = [];
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
