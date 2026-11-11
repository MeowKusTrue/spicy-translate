"""Conservative ASR anchors for known lyrics; never replace the source text."""
from collections import Counter
from difflib import SequenceMatcher
import math
import re


def _tokens(text):
    return re.findall(r"[^\W_]+", text.replace('|', '').casefold().replace('ё', 'е'))


def locate_line_windows(lines, words):
    """Return {line_index: (start, end)} only for supported, ordered matches.

    Both edge tokens must match and at least 80% of the line must be covered.
    A repeated one-word phrase cannot establish its own location. ASR anchors
    remain approximate, especially for repeated choruses and stretched vowels.
    """
    source, spans = [], []
    for line in lines:
        tokens = _tokens(line.get('text') or '')
        spans.append((len(source), len(tokens)))
        source.extend(tokens)
    heard, times = [], []
    for word in words:
        a, b = word.get('a'), word.get('b')
        if not isinstance(a, (int, float)) or not isinstance(b, (int, float)):
            continue
        if not math.isfinite(a) or not math.isfinite(b) or a < 0 or b <= a:
            continue
        tokens = _tokens(word.get('word') or '')
        for token in tokens:
            heard.append(token)
            times.append((a, b))
    if not source or not heard:
        return {}
    matches = {}
    for block in SequenceMatcher(None, source, heard, autojunk=False).get_matching_blocks():
        for offset in range(block.size):
            matches[block.a + offset] = block.b + offset
    source_counts, heard_counts = Counter(source), Counter(heard)
    result, previous_end = {}, 0.0
    for i, (start, count) in enumerate(spans):
        if not count:
            continue
        end = start + count - 1
        covered = sum(k in matches for k in range(start, end + 1))
        if start not in matches or end not in matches or covered < math.ceil(count * .8):
            continue
        if count == 1 and (source_counts[source[start]] > 1 or heard_counts[source[start]] > 1):
            continue
        a, b = times[matches[start]][0], times[matches[end]][1]
        if a < previous_end or b - a < .04 * count or b - a > max(20, count * 1.5):
            continue
        result[i] = (a, b)
        previous_end = b
    return result
