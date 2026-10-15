"""Self-check without models/audio: python test_align.py"""
import numpy as np
from align import units, viterbi, to_units, fill, untangle, report, Aligner

# units(): same split as src/core/words.ts
assert units('a  b\tc') == [('a', True), ('b', True), ('c', True)]
assert units('a b c') == [('a b', True), ('c', True)]
assert units('при|вет мир') == [('при', False), ('вет', True), ('мир', True)]
assert units('') == [] and units(None) == []

# viterbi(): finds the line among a neighbour's speech at both window edges
T, V = 60, 5
lp = np.full((T, V), -8.0); lp[:, 0] = -0.01
def say(f, tok): lp[f, 0] = -6.0; lp[f, tok] = -0.05
for f in range(0, 10): say(f, 3)        # previous line's tail
say(20, 1); say(21, 2); say(22, 2); say(30, 1)
for f in range(50, 60): say(f, 4)       # next line's head
spans = viterbi(lp, [1, 2, 1], 0)
assert spans == [(20, 21), (21, 23), (30, 31)], spans
assert viterbi(lp, [1] * 61, 0) is None
# the LRC prior picks the occurrence inside the line's LRC interval (chorus lines repeat)
lp2 = np.full((T, V), -8.0); lp2[:, 0] = -0.01
for f in (5, 54): lp2[f, 0] = -6.0; lp2[f, 1] = -0.05
bias = np.where(np.arange(T) < 30, -0.1, 0.0)
assert viterbi(lp2, [1], 0, bias=bias) == [(54, 55)] and viterbi(lp2, [1], 0, bias=bias[::-1]) == [(5, 6)]

def mono(r): return all(a < b for a, b in r) and all(x[1] <= y[0] + 1e-9 for x, y in zip(r, r[1:]))
# to_units(): letterless unit takes the gap after its neighbour, b never past next a
r = to_units([('ab', True), ('—', True), ('c', True)], [0, 0, 2], [(10, 11), (12, 13), (40, 41)], 0.02, 1.0, 3.0)
assert r == [(1.18, 1.26), (1.26, 1.8), (1.8, 2.12)], r  # 'ab' too short -> starts earlier
# bug: two letterless words at line start used to share one 0.2 s slot (palma line 27)
r = to_units([('Say', True), ('ahh,', True), ('море', True)], [2, 2], [(100, 101), (103, 104)], 0.02, 75.0, 80.0)
assert mono(r) and r[0][0] < r[1][0] < r[2][0], r
# ...and with no gap at all they split the left neighbour's span instead of stacking
r = to_units([('ой', True), ('—', True), ('—', True), ('да', True)], [0, 3], [(10, 12), (12, 13)], 0.02, 0.0, 2.0)
assert mono(r) and len({x[0] for x in r}) == 4, r
# bug: one-letter word got MIN_W but the next word was not pushed (palma line 3)
r = to_units([('у', True), ('меня', True)], [0, 1], [(100, 101), (101, 103)], 0.02, 15.0, 20.0)
assert mono(r) and r[0][1] - r[0][0] >= 0.05 - 1e-9, r
# Latin words in a Russian line are transliterated for alignment instead of becoming letterless
ru = {c: i for i, c in enumerate('<pad>|абвгдеёжзийклмнопрстуфхцчшщъыьэюя')}
ids, owner = Aligner(None).tokens(units('Say ahh, море'), ru, 'ru')
assert sorted(set(owner)) == [0, 1, 2] and owner.count(0) == 3, owner

# fill(): hand spans kept, hand-done layers skipped unless --force, bg-only lines get bgo
proj = {'v': 1, 'meta': {}, 'lines': [
    {'t': 0, 'end': 2, 'text': 'a b', 'tr': '', 'sync': {'orig': [{'a': 0.1, 'b': 0.5}, {'a': None, 'b': None}]}},
    {'t': 2, 'end': 4, 'text': 'c', 'tr': '', 'sync': {'orig': [{'a': 2.0, 'b': 3.0}]}},
    {'t': 4, 'end': 6, 'text': '', 'tr': '', 'bg': {'text': 'd e', 'tr': ''}},
]}
fake = lambda i, ln, layer, text: [(ln['t'] + k + 0.3, ln['t'] + k + 0.6) for k in range(len(units(text)))]
fill(proj, fake)
L = proj['lines']
assert L[0]['sync']['orig'] == [{'a': 0.1, 'b': 0.5}, {'a': 1.3, 'b': 1.6, 'g': 1}]
assert L[1]['sync']['orig'] == [{'a': 2.0, 'b': 3.0}]
assert L[2]['sync'] == {'bgo': [{'a': 4.3, 'b': 4.6, 'g': 1}, {'a': 5.3, 'b': 5.6, 'g': 1}]}
errs = fill(proj, fake, force=True)
assert abs(errs['orig'][0] - 0.3) < 1e-9 and L[1]['sync']['orig'][0]['g'] == 1

# untangle(): last word of a line stops at the next line's first word; hand spans stay
p2 = {'lines': [{'t': 0, 'end': 2, 'text': 'a b', 'sync': {'orig': [{'a': 0.5, 'b': 1.0, 'g': 1}, {'a': 1.0, 'b': 2.4, 'g': 1}]}},
                {'t': 2, 'end': 4, 'text': 'c d', 'sync': {'orig': [{'a': 2.1, 'b': 2.5}, {'a': 2.45, 'b': 3.0, 'g': 1}]}}]}
assert report(p2)['overlaps'] == 2
untangle(p2)
o0, o1 = p2['lines'][0]['sync']['orig'], p2['lines'][1]['sync']['orig']
assert o0[1]['b'] == 2.1 and o1[0] == {'a': 2.1, 'b': 2.5} and o1[1]['a'] == 2.5 and report(p2)['overlaps'] == 0, p2
print('ok')
