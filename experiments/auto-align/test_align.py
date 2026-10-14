"""Self-check without models/audio: python test_align.py"""
import numpy as np
from align import units, viterbi, to_units, fill

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

# to_units(): letterless unit sits after its neighbour, b never past next a
r = to_units([('ab', True), ('—', True), ('c', True)], [0, 0, 2], [(10, 11), (12, 13), (40, 41)], 0.02, 1.0, 3.0)
assert r == [(1.2, 1.26), (1.26, 1.76), (1.8, 2.12)], r

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
print('ok')
