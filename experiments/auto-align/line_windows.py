"""Conservative, ordered ASR anchors for known lyrics, including repeated choruses."""
from collections import Counter
from difflib import SequenceMatcher
import math
import re
from numbers import Real


def _tokens(text):
    return re.findall(r"[^\W_]+", text.replace('|', '').casefold().replace('ё', 'е'))


def _valid(a, b):
    return (isinstance(a, Real) and not isinstance(a, bool) and isinstance(b, Real) and not isinstance(b, bool)
            and math.isfinite(a) and math.isfinite(b) and 0 <= a < b)


def _ordered_windows(lines, words):
    """Keep only matches shared by every best ordered assignment, never pick a repeat by chance."""
    source = [_tokens(line.get('text') or '') for line in lines]
    heard, times = [], []
    for word in words:
        for token in _tokens(word.get('word') or ''):
            heard.append(token)
            times.append((word['a'], word['b']))
    if not heard:
        return {}
    source_counts = Counter(token for row in source for token in row)
    heard_counts = Counter(heard)
    positions = {}
    for j, token in enumerate(heard):
        positions.setdefault(token, []).append(j)
    # Time coordinates also prohibit assigning overlapping ASR words to separate lines.
    points = sorted({t for pair in times for t in pair})
    index = {t: i for i, t in enumerate(points)}
    candidates = []
    for tokens in source:
        row, n = [], len(tokens)
        if n and not (n == 1 and (source_counts[tokens[0]] > 1 or heard_counts[tokens[0]] > 1)):
            for start in positions.get(tokens[0], []):
                # Tolerate a few missing/inserted ASR words; require both edges and 80% coverage.
                for end in range(start, min(len(heard), start + n + max(2, n // 4))):
                    if heard[end] != tokens[-1]:
                        continue
                    a, b = times[start][0], times[end][1]
                    if b - a < .04 * n or b - a > max(20, n * 1.5):
                        continue
                    covered = sum(block.size for block in SequenceMatcher(None, tokens, heard[start:end+1], autojunk=False).get_matching_blocks())
                    if covered >= math.ceil(n * .8):
                        row.append((index[a], index[b], covered))
        candidates.append(list(set(row)))
    m = len(points)
    forward = [[0] * m]
    for row in candidates:
        prev, cur = forward[-1], forward[-1].copy()
        for a, b, score in row:
            cur[b] = max(cur[b], prev[a] + score)
        for j in range(1, m):
            cur[j] = max(cur[j], cur[j-1])
        forward.append(cur)
    backward = [[0] * m for _ in range(len(lines) + 1)]
    for i in range(len(lines)-1, -1, -1):
        nxt, cur = backward[i+1], backward[i+1].copy()
        for a, b, score in candidates[i]:
            cur[a] = max(cur[a], score + nxt[b])
        for j in range(m-2, -1, -1):
            cur[j] = max(cur[j], cur[j+1])
        backward[i] = cur
    best, result = forward[-1][-1], {}
    for i, row in enumerate(candidates):
        # If omitting the line is equally good, even a single candidate is not reliable.
        if any(a + b == best for a, b in zip(forward[i], backward[i+1])):
            continue
        choices = {(a, b) for a, b, score in row if forward[i][a] + score + backward[i+1][b] == best}
        if len(choices) == 1:
            a, b = choices.pop()
            result[i] = (points[a], points[b])
    return result


def locate_line_windows(lines, words, anchors=None):
    """Locate each occurrence in song order, bounded by trusted manual word timings.

    Rough line t/end values are not anchors. If ASR missed a repeat and its
    occurrence is ambiguous, leave it unchanged. Inputs are never modified.
    """
    words = sorted((word for word in words if _valid(word.get('a'), word.get('b'))), key=lambda w: w['a'])
    anchors = {i: pair for i, pair in (anchors or {}).items()
               if isinstance(i, int) and 0 <= i < len(lines) and _valid(*pair)}
    result = dict(anchors)
    bounds = [(-1, (0, 0)), *sorted(anchors.items()), (len(lines), (math.inf, math.inf))]
    for (left, (_, lower)), (right, (upper, _)) in zip(bounds, bounds[1:]):
        if right <= left + 1 or lower >= upper:
            continue
        segment = [word for word in words if word['a'] >= lower and word['b'] <= upper]
        for i, window in _ordered_windows(lines[left+1:right], segment).items():
            result[left+1+i] = window
    return dict(sorted(result.items()))


def recovery_groups(lines, located, duration, max_window=30):
    """Bound missing lyrics by neighboring occurrences, never guessed LRC coordinates.

    Long unanchored regions need another anchor; forcing them into short guessed
    windows could assign a repeated chorus to the wrong occurrence.
    """
    if any(not 0 <= i < len(lines) or not _valid(*pair) or pair[1] > duration for i, pair in located.items()):
        return
    anchors = sorted(located.items())
    if not anchors:
        return
    bounds = [(-1, (0, 0)), *anchors, (len(lines), (duration, duration))]
    for (left, start), (right, end) in zip(bounds, bounds[1:]):
        missing = [i for i in range(left + 1, right) if _tokens(lines[i].get('text') or '')]
        if not missing or start[1] > end[0]:
            continue
        context = ([left] if left >= 0 else []) + missing + ([right] if right < len(lines) else [])
        lo, hi = max(0, start[0] - .4), min(duration, end[1] + .4)
        if .25 <= hi - lo <= max_window:
            yield missing, context, lo, hi


def recover_line_candidates(lines, located, duration, refine, unitize, eligible):
    """Return review-only acoustic candidates. Never promotes them to trusted anchors."""
    candidates = []
    for missing, context, lo, hi in recovery_groups(lines, located, duration):
        targets = [i for i in missing if eligible(i)]
        if not targets:
            continue
        counts = [len(unitize(lines[i]['text'])) for i in context]
        got = refine(lo, hi, ' '.join(lines[i]['text'] for i in context))
        if not got or len(got) != sum(counts):
            continue
        if any(len(w) < 3 or not _valid(w[0], w[1]) or w[0] < lo or w[1] > hi
               or w[2] is not None and (not math.isfinite(w[2]) or not 0 <= w[2] <= 1) for w in got):
            continue
        if any(got[k][0] < got[k-1][1] - .002 for k in range(1, len(got))):
            continue
        offset, spans = 0, {}
        for i, count in zip(context, counts):
            spans[i] = got[offset:offset+count]
            offset += count
        # A badly misplaced context phrase makes every proposal in this window suspect.
        if any(i in located and (abs(spans[i][0][0] - located[i][0]) > .75
                                 or abs(spans[i][-1][1] - located[i][1]) > .75) for i in context):
            continue
        for i in targets:
            if not spans[i]:
                continue
            candidates.append({'row': i, 'spans': spans[i]})
    return candidates
