// Read lyrics Spicy Lyrics already fetched for a track (its Cache Storage, same page origin) and turn them into our lines:
// singers (OppositeAligned -> v2) and, for syllable-synced lyrics, ready word/syllable timings of the original.
// This relies on Spicy internals (store name, record shape), not a public API — see NOTES.md.
import { units, unitsText, type Agent, type Line, type Span, type Unit } from './core.ts';

const NBSP = ' ';
const STORE = 'SpicyLyrics_LyricsStore_g1'; // Spicy: GetExpireStore(name) -> caches.open(name), key "/<trackId>", value { Content }
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);

export async function readSpicyCache(uri: string): Promise<any | null> {
  const id = uri.split(':')[2];
  if (!id || typeof caches === 'undefined') return null;
  try {
    const res = await (await caches.open(STORE)).match('/' + id);
    if (!res) return null;
    const w = await res.json();
    return w && w.Content ? w.Content : null; // expired entries are still valid lyrics, so no ExpiresAt check
  } catch { return null; }
}

/** Spicy lyrics object -> our lines. Returns null when there is nothing timed to take (e.g. Static lyrics). */
export function spicyToLines(d: any, duration = 0): Line[] | null {
  if (!d || !Array.isArray(d.Content) || d.Type === 'Static') return null;
  const out: Line[] = [];
  for (const c of d.Content) {
    if (!c || (c.Type && c.Type !== 'Vocal')) continue;
    const agent: Agent | undefined = c.OppositeAligned ? 'v2' : undefined;
    if (c.Lead && Array.isArray(c.Lead.Syllables)) {
      const us: Unit[] = [], sy: Span[] = [];
      for (const s of c.Lead.Syllables) {
        // a syllable with inner spaces becomes one glued block; IsPartOfWord = continues into the next syllable (no space)
        const w = String(s?.Text ?? '').trim().replace(/\|/g, '¦').replace(/\s+/g, NBSP);
        const a = num(s?.StartTime), b = num(s?.EndTime);
        if (!w || !Number.isFinite(a) || !Number.isFinite(b)) continue;
        us.push({ w, sp: !s.IsPartOfWord }); sy.push({ a: r3(a), b: r3(Math.max(a, b)) });
      }
      if (!us.length) continue;
      us[us.length - 1].sp = true;
      const text = unitsText(us), ok = units(text).length === sy.length;
      const t = Number.isFinite(num(c.Lead.StartTime)) ? c.Lead.StartTime : sy[0].a!;
      const end = Number.isFinite(num(c.Lead.EndTime)) ? c.Lead.EndTime : sy[sy.length - 1].b!;
      out.push({ t: r3(t), end: r3(Math.max(end, t + 0.3)), text, tr: '', ...(ok ? { sync: { orig: sy } } : {}), ...(agent ? { agent } : {}) });
    } else if (typeof c.Text === 'string' && c.Text.trim() && Number.isFinite(num(c.StartTime))) {
      const t = c.StartTime, end = Number.isFinite(num(c.EndTime)) ? c.EndTime : t + 3;
      out.push({ t: r3(t), end: r3(Math.max(end, t + 0.3)), text: c.Text.trim(), tr: '', ...(agent ? { agent } : {}) });
    }
  }
  if (!out.length) return null;
  // guard against a millisecond-based payload
  const last = Math.max(...out.map(l => l.end));
  if (duration > 0 && last > duration * 20) for (const l of out) {
    l.t = r3(l.t / 1000); l.end = r3(l.end / 1000);
    l.sync?.orig?.forEach(x => { x.a = r3(x.a! / 1000); x.b = r3(x.b! / 1000); });
  }
  return out.sort((x, y) => x.t - y.t);
}

/** Copy singers onto an existing project by matching line starts (keeps translation and timings). */
export function agentsByTime(lines: Line[], from: Line[], tol = 1.5): number {
  let n = 0;
  for (const l of lines) {
    let best: Line | null = null, d = tol;
    for (const s of from) { const dd = Math.abs(s.t - l.t); if (dd <= d) { d = dd; best = s; } }
    if (!best) continue;
    if (best.agent) l.agent = best.agent; else delete l.agent;
    n++;
  }
  return n;
}
