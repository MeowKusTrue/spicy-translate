// Data model (unchanged from the single-file version): S.lines[] with optional per-word sync layers.
export type Layer = 'tr' | 'orig';
export type Mode = 'translation' | 'bilingual';
/** Singer of a line (TTML ttm:agent). Spicy Lyrics: v1 = main (left), v2 = second (right, opposite-aligned), v1000 = together. */
export type Agent = 'v1' | 'v2' | 'v1000';

/** One timed unit. a/b in seconds, null = not marked yet. g:1 = auto-placed (spread), not confirmed by hand. */
export interface WordSync { a: number | null; b: number | null; g?: 1 }

export interface Line {
  t: number;      // line start from LRC (s)
  end: number;    // next line start, max t+10
  text: string;   // original
  tr: string;     // translation
  sync?: { tr?: WordSync[]; orig?: WordSync[] } | null;
  agent?: Agent;  // missing = v1
}

/** Text unit: word by whitespace, syllable by '|', NBSP glues two words into one unit. sp=false -> syllable continues. */
export interface Unit { w: string; sp: boolean }

export interface TimedWord { word: string; sp: boolean; a: number; b: number; real?: boolean }

export interface ExportOpts {
  lines: Line[];
  mode?: Mode;
  wordSpread?: boolean;
  lang?: string;
  offset?: number;
  songwriters?: string[];
}

export interface Project {
  v: 1;
  meta: { title: string; artist: string; lang: string; mode: Mode };
  lines: Line[];
}
