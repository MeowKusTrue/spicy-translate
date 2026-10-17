// node ttml2proj.ts song.ttml out.spicy.json — a hand-marked TTML as a project for bench.py (same parser as the editor)
import fs from 'node:fs';
import { importLyrics } from '../../src/core/index.ts';

const [, , src, out] = process.argv;
const { lines } = importLyrics(fs.readFileSync(src, 'utf8'), src, 0);
fs.writeFileSync(out, JSON.stringify({ v: 1, meta: { title: '', artist: '', lang: 'ru', mode: 'translation' }, lines }, null, 1));
console.log(out, lines.length, 'lines,', lines.reduce((n, l) => n + (l.sync?.orig?.length || 0), 0), 'lead words,', lines.reduce((n, l) => n + (l.sync?.bgo?.length || 0), 0), 'bg words');
