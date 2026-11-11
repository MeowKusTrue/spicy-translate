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
# a long line (> 63 letters -> > 127 states): the backtrace used to overflow int8 under numpy 2
T2 = 400; lpl = np.full((T2, V), -8.0); lpl[:, 0] = -0.01
for j in range(70): lpl[100 + 3 * j, 0] = -6.0; lpl[100 + 3 * j, 1 + j % 2] = -0.05
long = viterbi(lpl, [1 + j % 2 for j in range(70)], 0)
assert long and len(long) == 70 and long[0][0] == 100, long and long[:2]
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
# Tight windows retain usable spans without expanding past the audio window.
for us, owners, spans in [([('a', True)] * 3, [0, 1, 2], [(0, 1), (1, 2), (2, 3)]),
                          ([('a', True), ('—', True), ('b', True)], [0, 2], [(0, 1), (1, 3)])]:
    r = to_units(us, owners, spans, .02, 1., 1.06)
    assert r and len(r) == 3 and mono(r) and r[0][0] >= 1. and r[-1][1] <= 1.06, r
assert to_units([('a', True)], [0], [(0, 1)], .02, 1., 1.) is None
assert to_units([('a', True)] * 3, [0, 1, 2], [(0, 1)] * 3, .02, 0., .002) is None
r = to_units([('a', True)], [0], [(0, 1)], .02, 1.0004, 1.0206)
assert r and 1.0004 <= r[0][0] < r[0][1] <= 1.0206, r
# Even late token spans must not escape the available window.
r = to_units([('a', True)] * 3, [0, 1, 2], [(10, 11), (11, 12), (12, 13)], .02, 0., .06)
assert r and mono(r) and r[0][0] >= 0. and r[-1][1] <= .06, r
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

# untangle(): repair within each line only; legitimate cross-line overlap stays.
p2 = {'lines': [{'t': 0, 'end': 2, 'text': 'a b', 'sync': {'orig': [{'a': 0.5, 'b': 1.0, 'g': 1}, {'a': 1.0, 'b': 2.4, 'g': 1}]}},
                {'t': 2, 'end': 4, 'text': 'c d', 'sync': {'orig': [{'a': 2.1, 'b': 2.5}, {'a': 2.45, 'b': 3.0, 'g': 1}]}}]}
assert report(p2)['overlaps'] == 2
untangle(p2)
o0, o1 = p2['lines'][0]['sync']['orig'], p2['lines'][1]['sync']['orig']
assert o0[1]['b'] == 2.4 and o1[0] == {'a': 2.1, 'b': 2.5} and o1[1]['a'] == 2.5 and report(p2)['overlaps'] == 1, p2
assert o1[1]['c'] == 0.0
# A bad long span cannot push later independent phrases, in either vocal layer.
for layer in ('orig', 'bgo'):
    bad = {'a': 0., 'b': 90., 'g': 1, 'c': .99}
    later = {'a': 2., 'b': 3., 'g': 1, 'c': .98}
    p = {'lines': [{'sync': {layer: [bad]}}, {'sync': {layer: [later]}}]}
    untangle(p)
    assert bad == {'a': 0., 'b': 90., 'g': 1, 'c': .99}
    assert later == {'a': 2., 'b': 3., 'g': 1, 'c': .98}
# Both shortening and delaying an automatic span invalidate its confidence.
p = {'lines': [{'sync': {'orig': [{'a': 0., 'b': 2., 'g': 1, 'c': .99},
                                  {'a': 1., 'b': 1.5},
                                  {'a': 1.4, 'b': 2., 'g': 1, 'c': .99}]}}]}
untangle(p)
x, hand, y = p['lines'][0]['sync']['orig']
assert x == {'a': 0., 'b': 1., 'g': 1, 'c': 0.0} and y['a'] == 1.5 and y['c'] == 0.0
assert hand == {'a': 1., 'b': 1.5}
print('ok')

# words_to_lines(): Whisper words -> lyric lines: break at pauses / sentence ends, no one-word tail of a long run
from align import words_to_lines
from align import backing_candidates, WHISPER_MODELS
assert WHISPER_MODELS['large-v3'] == 'openai/whisper-large-v3'
source = [{'t': 2, 'end': 4, 'text': 'lead', 'bg': {'text': 'эй', 'tr': 'hey'}}]
assert not backing_candidates([['эй', 2.1, 2.4]], source)  # existing backing stays
assert not backing_candidates([['outside', 10, 11]], source)  # selected lines only
bc = backing_candidates([['новый', 2.1, 2.4], ['бэк', 2.5, 2.8]], source)
assert len(bc) == 1 and bc[0]['bg']['text'] == 'новый бэк' and bc[0]['text'] == ''
assert bc[0]['sync']['bgo'][0] == {'a': 2.1, 'b': 2.4, 'g': 1}
assert len(backing_candidates([['эй', 0, .5]], [])) == 1

# Exercise the runner without downloading models: selected ASR, separate backing input and safe failure.
import align as runner
import tempfile, json, os, sys, types
from contextlib import ExitStack
from unittest.mock import patch
from argparse import Namespace
# ASR morphology joins only adjacent pieces in the same inference window.
def chunk(text, a, b): return {'text': text, 'timestamp': (a, b)}
fake_torch = types.SimpleNamespace(float32='float32')
outputs = [
    {'chunks': [chunk('А', 0., .1), chunk('-а', .1, .2), chunk('-а', .2, .3),
                chunk('-late', 2., 2.2), chunk('–near', 2.2, 2.3), chunk('--dash', 2.3, 2.4)]},
    {'chunks': [chunk('-new', 0., .2)]},
    {'chunks': [chunk('open', 0., None), chunk('-far', 2., 2.2)]},
]
with patch.dict(sys.modules, {'torch': fake_torch, 'transformers': types.SimpleNamespace(pipeline=lambda *a, **k: iter_asr)}), \
     patch.object(runner, 'windows', return_value=[(0, runner.SR * 3), (runner.SR * 20, runner.SR * 23), (runner.SR * 30, runner.SR * 33)]), \
     patch.object(runner, 'stage'):
    from unittest.mock import Mock
    iter_asr = Mock(side_effect=outputs)
    got = runner.transcribe(np.ones(runner.SR * 33), 'cpu')
assert [w[0] for w in got] == ['А-а-а', '-late–near', '--dash', '-new', 'open', '-far'], got
assert got[0][1:] == [0., .3] and got[3][1:] == [20., 20.2], got
# Full Whisper must bound attention windows and disable inherited beam expansion.
stub_asr = Mock(return_value={})
with patch.dict(sys.modules, {'torch': fake_torch, 'transformers': types.SimpleNamespace(pipeline=lambda *a, **k: stub_asr)}), \
     patch.object(runner, 'windows', return_value=[(0, runner.SR)]) as window_mock, patch.object(runner, 'stage'):
    runner.transcribe(np.ones(runner.SR), 'cpu', model='large-v3')
    assert window_mock.call_args.kwargs == {'most': 12.0, 'least': 8.0}
    assert stub_asr.call_args.kwargs['generate_kwargs']['num_beams'] == 1
with tempfile.TemporaryDirectory() as tmp:
    inp, out = os.path.join(tmp, 'in.json'), os.path.join(tmp, 'out.json')
    original = {'lines': [{'t': 0, 'end': 1, 'text': 'lead', 'tr': 'translation'}]}
    with open(inp, 'w', encoding='utf-8') as f: json.dump(original, f)
    args = dict(device='cpu', project=inp, out=out, audio='unused.wav', transcribe=False, detect_back=True,
                no_separation=False, no_karaoke=False, sep='roformer', asr='large-v3', song_lang='ru',
                model=None, aligner='w2v', bg_aligner='mms', snap=0, shift=0, force=False)
    voice, backing = np.ones(16000), np.full(16000, .5)
    with ExitStack() as stack:
        stack.enter_context(patch.dict(sys.modules, {'torch': types.ModuleType('torch')}))
        stack.enter_context(patch.object(runner, 'pick_device', return_value='cpu'))
        stack.enter_context(patch.object(runner, 'hook_tqdm'))
        split = stack.enter_context(patch.object(runner, 'separate', return_value=(voice, backing, 'voice.wav')))
        asr = stack.enter_context(patch.object(runner, 'transcribe', return_value=[['эй', .2, .4]]))
        stack.enter_context(patch.object(runner, 'Aligner', return_value=types.SimpleNamespace(device='cpu')))
        stack.enter_context(patch.object(runner, 'fill', return_value={}))
        runner.run(Namespace(**args), lambda **k: None)
        assert split.call_args.args[-1] == 'roformer'
        assert asr.call_args.args[0] is backing and asr.call_args.args[3:] == ('large-v3', 'backing')
        result = json.load(open(out, encoding='utf-8'))
        assert result['lines'] == original['lines'] and result['backingCandidates'][0]['bg']['text'] == 'эй'
        split.return_value = (voice, None, 'voice.wav'); asr.reset_mock()
        runner.run(Namespace(**args), lambda **k: None)
        result = json.load(open(out, encoding='utf-8'))
        assert not asr.called and result['warnings'] and result['backingCandidates'] == []
W = [[w, i * 0.3, i * 0.3 + 0.25] for i, w in enumerate('раз два три, четыре пять шесть семь восемь девять десять'.split())]
L = words_to_lines(W)
assert all(2 <= len(l['text'].split()) <= 9 for l in L) and sum(len(l['sync']['orig']) for l in L) == 10, [l['text'] for l in L]
L = words_to_lines([['эй', 0, 0.2], ['да.', 0.3, 0.5], ['новая', 2.0, 2.3], ['строка,', 2.4, 2.6]])
assert [l['text'] for l in L] == ['эй да', 'новая строка'], [l['text'] for l in L]  # no trailing punctuation
print('ok')

# Explicit approval protects an entire partially automatic phrase through every timing pass.
import copy
from align import snap_starts
protected = {'lines': [{'t': 0, 'end': 8, 'text': 'one two', 'tr': '', 'approved': {'orig': True}, 'sync': {'orig': [{'a': 1., 'b': 2., 'g': 1}, {'a': 1.9, 'b': 3., 'g': 1}]}}]}
before = copy.deepcopy(protected)
def forbidden(*args): raise AssertionError('approved phrase was sent to alignment')
fill(protected, forbidden)
snap_starts(protected, np.array([1.1, 2.1]), .2, .4)
untangle(protected)
assert protected == before, 'approval was not preserved through alignment / snap / untangle'
print('approval checks passed')

# The final postprocessor must not expand a feasible dense alignment past its window.
dense = to_units([('a', False), ('b', True), ('c', True)], [0, 1, 2], [(0, 1), (1, 2), (2, 3)], .02, 0, .06)
dense_project = {'lines': [{'sync': {'orig': [{'a': a, 'b': b, 'g': 1} for a, b in dense]}}]}
untangle(dense_project)
assert [(x['a'], x['b']) for x in dense_project['lines'][0]['sync']['orig']] == dense
print('dense alignment survives final postprocessing')

# Real model output contains NumPy scalars; progress/report JSON must remain serializable.
from align import report
import json
numpy_project = {'lines': [{'t': 0, 'end': 1, 'sync': {'orig': [{'a': np.float64(.1), 'b': np.float64(.12), 'g': 1}, {'a': np.float64(.11), 'b': np.float64(.3), 'g': 1}]}}]}
json.dumps(report(numpy_project))
print('NumPy alignment report serializes')
