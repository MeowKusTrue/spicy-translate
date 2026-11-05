import { describe, expect, it } from 'vitest';
import { geniusAccessError, geniusLyrics } from '../src/core/genius.ts';

const page = `<html><body><div class="x"><div data-lyrics-container="true" class="Lyrics">
<div data-exclude-from-selection="true" class="Header"><button><span>29 Contributors</span></button><div><div>Translations</div></div></div>
[Куплет 1]<br/>Первая <a href="/x"><span>строка</span></a><br>Вторая &amp; ещё (бэк)<br/><br/>[Припев: Кто-то]<br/>It&#x27;s&nbsp;fine
</div><div class="Ad">реклама</div><div data-lyrics-container="true" class="Lyrics"><i>Третья</i><br/>&#1063;етвёртая</div></div></body></html>`;

describe('geniusLyrics', () => {
  it('joins the containers, drops headers, sections and the ad', () => {
    expect(geniusLyrics(page)).toBe('Первая строка\nВторая & ещё (бэк)\nIt\'s fine\nТретья\nЧетвёртая');
  });
  it('empty for a page without lyrics', () => {
    expect(geniusLyrics('<html><div>nothing</div></html>')).toBe('');
  });
  it('recognizes the regional redirect even though Genius returns HTTP 200', () => {
    expect(geniusAccessError('<title>The Page You&#39;re Attempting to Visit Is Not Available in Your Region | Genius</title>')).toContain('регион');
    expect(geniusAccessError('', 'https://genius.com/a/the-page-you-re-attempting-to-visit-is-not-available-in-your-region')).toContain('Вставить текст');
    expect(geniusAccessError(page)).toBeNull();
  });
});
