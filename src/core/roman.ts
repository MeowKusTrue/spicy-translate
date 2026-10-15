// Cyrillic -> Latin for the romanization line Spicy Lyrics shows under the lyrics (readable, not a strict standard).
const MAP: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  і: 'i', ї: 'yi', є: 'ye', ґ: 'g', ў: 'w',
};
export const hasCyr = (s: string) => /[а-яёіїєґў]/i.test(s);
export function translit(s: string) {
  const up = s === s.toUpperCase() && s !== s.toLowerCase() && [...s].filter(c => /\p{L}/u.test(c)).length > 1;
  const out = [...s].map(c => {
    const lo = c.toLowerCase(), m = MAP[lo]; if (m == null) return c;
    return c === lo ? m : m.charAt(0).toUpperCase() + m.slice(1);
  }).join('');
  return up ? out.toUpperCase() : out;
}
