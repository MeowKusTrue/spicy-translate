// Spelling of the lyrics through the local server (Yandex Speller): the translation (or the original when there is none),
// each mistake with suggestions; a suggestion replaces the word in place (its timing stays, syllable bars of it go).
import type { Layer } from './core/index.ts';
import { plainW } from './core/index.ts';
import { S, emit, layerText } from './state.ts';
import { editText } from './lineEdit.ts';
import { snap } from './sync.ts';

export interface SpellHit { i: number; layer: Layer; word: string; s: string[] }
const word = (w: string) => new RegExp('(?<![\\p{L}|])' + [...w].map(c => c.replace(/[.*+?^${}()[\]\\]/g, '\\$&')).join('\\|?') + '(?![\\p{L}|])', 'u');

export async function spellCheck() {
  const tr = S.lines.some(l => (l.tr || '').trim()), layers: Layer[] = tr ? ['tr', 'bg'] : ['orig', 'bgo'];
  const items = S.lines.flatMap((l, i) => layers.map(layer => ({ i, layer, text: plainW(layerText(l, layer)) })).filter(x => x.text.trim()));
  S.spell = { busy: true, hits: [], msg: 'Проверяю…', ignored: S.spell?.ignored || [] }; emit();
  try {
    const r = await fetch('/api/spell', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ texts: items.map(x => x.text), lang: tr ? S.meta.lang : 'ru' }) }).catch(() => null);
    if (!r) throw new Error('нет связи с локальным сервером');
    const j = await r.json().catch(() => ({ error: r.status === 404 ? 'сервер старой версии — перезапусти его' : 'HTTP ' + r.status }));
    if (j.error) throw new Error(j.error);
    const hits = (j as { word: string; s: string[] }[][]).flatMap((ms, k) => ms.map(m => ({ i: items[k].i, layer: items[k].layer, word: m.word, s: m.s.slice(0, 4) })));
    S.spell = { ...S.spell!, busy: false, hits, msg: '' };
  } catch (e) { S.spell = { ...S.spell!, busy: false, msg: 'Орфография: ' + (e as Error).message }; }
  emit();
}
export const spellLeft = () => (S.spell?.hits || []).filter(h => !S.spell!.ignored.includes(h.word.toLowerCase()));
/** the suggestion goes into the line in place of the word (all its occurrences in that line) */
export function spellFix(h: SpellHit, v: string) {
  const l = S.lines[h.i]; if (!l) return;
  const t = layerText(l, h.layer), re = new RegExp(word(h.word).source, 'gu'), n = t.replace(re, v);
  if (n !== t) { snap(); editText(h.i, h.layer, n); }
  S.spell!.hits = S.spell!.hits.filter(x => !(x.i === h.i && x.layer === h.layer && x.word === h.word)); emit();
}
export function spellIgnore(h: SpellHit) { S.spell!.ignored.push(h.word.toLowerCase()); emit(); }
