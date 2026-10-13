// The extension uses the shared core of the web editor (src/core) — one implementation for TTML, words, syllables, QA.
export * from '../../src/core/index.ts';
export type { WordSync as Span, TimedWord as Word, ExportOpts as TTMLOpts } from '../../src/core/index.ts';
