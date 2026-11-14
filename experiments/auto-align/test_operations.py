"""No models/downloads: separation-only preserves projects and cached words never separate."""
import json
import io
import os
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
import numpy as np
import align


class OperationsTest(unittest.TestCase):
    def test_locate_selected_repeat_uses_manual_context_and_preserves_other_rows(self):
        from unittest.mock import Mock
        for ambiguous in (False, True):
            with self.subTest(ambiguous=ambiguous), tempfile.TemporaryDirectory() as tmp:
                source, output, vocal = [os.path.join(tmp, x) for x in ('in.json', 'out.json', 'RX.wav')]
                # This is the full-song request produced when only the last row is selected.
                first = {'t': 10, 'end': 12, 'text': 'это припев', 'approved': {'orig': True, 'bgo': True},
                         'sync': {'orig': [{'a': 10, 'b': 11}, {'a': 11, 'b': 12}]}}
                target = {'t': 0, 'end': 2, 'text': 'это припев', 'sync': {'orig': [{'a': 0, 'b': 1, 'g': 1}, {'a': 1, 'b': 2, 'g': 1}]}}
                if ambiguous:  # A nonselected draft is protected but is not a trusted time anchor.
                    for word in first['sync']['orig']: word['g'] = 1
                project = {'lines': [first, target]}
                with open(source, 'w', encoding='utf8') as f: json.dump(project, f)
                with open(vocal, 'wb') as f: f.write(b'cached input')
                refine = Mock(return_value=[(60.1, 60.9), (61, 61.7)])
                model = types.SimpleNamespace(device='cpu', align=refine)
                with patch.dict(sys.modules, {'torch': types.ModuleType('torch')}), \
                     patch.object(align, 'pick_device', return_value='cpu'), patch.object(align, 'hook_tqdm'), \
                     patch.object(align, 'separate', side_effect=AssertionError('separator forbidden')), \
                     patch.object(align, 'decode', return_value=np.zeros((1, 16000))), \
                     patch.object(align, 'transcribe', return_value=[('это', 60, 60.8), ('припев', 61, 61.8)]), \
                     patch.object(align, 'Aligner', return_value=model):
                    align.main(['original.wav', source, '-o', output, '--vocal-file', vocal, '--locate-lines', '--snap', '0'])
                with open(output, encoding='utf8') as f: result = json.load(f)
                self.assertEqual(result['lines'][0], first)
                if ambiguous:
                    refine.assert_not_called()
                    self.assertEqual(result['lines'][1], target)
                    self.assertIn('для строк: 2.', result['warnings'][0])
                else:
                    refine.assert_called_once()
                    self.assertEqual(refine.call_args.args[-1], (60, 61.8))
                    self.assertEqual(result['lines'][1]['sync']['orig'][0]['a'], 60.1)
                    self.assertFalse(result.get('warnings'))
                with open(source, encoding='utf8') as f: self.assertEqual(json.load(f), project)

    def test_separate_only_never_recognizes_or_aligns(self):
        for project in ({'lines': [], 'meta': {'title': 'empty'}},
                        {'lines': [{'t': 1, 'end': 3, 'text': 'hello', 'tr': 'hi', 'sync': {'orig': [{'a': 1, 'b': 2}]}}], 'warnings': ['keep']}):
            with self.subTest(project=project), tempfile.TemporaryDirectory() as tmp:
                source, output = os.path.join(tmp, 'in.json'), os.path.join(tmp, 'out.json')
                with open(source, 'w', encoding='utf8') as f: json.dump(project, f)
                with patch.dict(sys.modules, {'torch': types.ModuleType('torch')}), \
                     patch.object(align, 'pick_device', return_value='cpu'), patch.object(align, 'hook_tqdm'), \
                     patch.object(align, 'separate', return_value=(np.zeros(10), None, 'vocals.wav')) as separate, \
                     patch.object(align, 'transcribe', side_effect=AssertionError('ASR forbidden')), \
                     patch.object(align, 'Aligner', side_effect=AssertionError('CTC forbidden')):
                    progress = io.StringIO()
                    with patch.object(sys, 'stdout', progress):
                        align.main(['original.wav', source, '-o', output, '--json-progress', '--separate-only', '--transcribe', '--detect-back', '--locate-lines'])
                    events = [json.loads(line) for line in progress.getvalue().splitlines()]
                    self.assertEqual(next(e['plan'] for e in events if 'plan' in e), ['demucs'])
                    self.assertTrue(events[-1]['done'])
                    self.assertEqual(events[-1]['out'], os.path.abspath(output))
                    self.assertFalse(separate.call_args.args[3], 'karaoke must be disabled')
                with open(output, encoding='utf8') as f: self.assertEqual(json.load(f), project)

    def test_cached_separate_only_and_words_skip_separator(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, output, vocal = [os.path.join(tmp, x) for x in ('in.json', 'out.json', 'RX.wav')]
            with open(source, 'w') as f: json.dump({'lines': [{'t': 0, 'end': 1, 'text': 'hello'}]}, f)
            with open(vocal, 'wb') as f: f.write(b'checked by server')
            with patch.dict(sys.modules, {'torch': types.ModuleType('torch')}), \
                 patch.object(align, 'pick_device', return_value='cpu'), patch.object(align, 'hook_tqdm'), \
                 patch.object(align, 'separate', side_effect=AssertionError('separator forbidden')), \
                 patch.object(align, 'decode', return_value=np.zeros((1, 16000))) as decode, \
                 patch.object(align, 'Aligner', return_value=types.SimpleNamespace(device='cpu')), \
                 patch.object(align, 'fill', return_value={}):
                align.main(['original.wav', source, '-o', output, '--vocal-file', vocal, '--separate-only'])
                decode.assert_not_called()
                align.main(['original.wav', source, '-o', output, '--vocal-file', vocal, '--no-karaoke'])
                decode.assert_called_once_with(vocal)

    def test_cached_transcribe_recognizes_full_vocal_without_separation(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, output, vocal = [os.path.join(tmp, x) for x in ('in.json', 'out.json', 'RX.wav')]
            project = {'lines': [], 'meta': {'title': 'no lyrics', 'artist': 'preserve'}, 'warnings': ['keep'], 'backingCandidates': []}
            with open(source, 'w', encoding='utf8') as f: json.dump(project, f)
            with open(vocal, 'wb') as f: f.write(b'cached input')
            audio = np.zeros(16000)
            model = types.SimpleNamespace(device='cpu', align=lambda *args: [(0.1, 0.4), (0.5, 0.9)])
            with patch.dict(sys.modules, {'torch': types.ModuleType('torch')}), \
                 patch.object(align, 'pick_device', return_value='cpu'), patch.object(align, 'hook_tqdm'), \
                 patch.object(align, 'separate', side_effect=AssertionError('separation/karaoke forbidden')), \
                 patch.object(align, 'decode', return_value=audio[None, :]) as decode, \
                 patch.object(align, 'transcribe', return_value=[('recognized', .1, .4), ('words', .5, .9)]) as asr, \
                 patch.object(align, 'Aligner', return_value=model):
                progress = io.StringIO()
                with patch.object(sys, 'stdout', progress):
                    align.main(['original.wav', source, '-o', output, '--vocal-file', vocal, '--transcribe', '--json-progress'])
                decode.assert_called_once_with(vocal)
                asr.assert_called_once()
                self.assertTrue(np.shares_memory(asr.call_args.args[0], audio))
                self.assertEqual(asr.call_args.args[1:], ('cpu', None, 'turbo'))
                events = [json.loads(line) for line in progress.getvalue().splitlines()]
                self.assertEqual(next(e['plan'] for e in events if 'plan' in e), ['transcribe', 'align'])
                self.assertEqual(events[-1]['vocals'], os.path.abspath(vocal))
            with open(output, encoding='utf8') as f: result = json.load(f)
            self.assertEqual({**result, 'lines': []}, project)
            self.assertEqual(result['lines'][0]['text'], 'recognized words')
            self.assertTrue(all(w['g'] == 1 for w in result['lines'][0]['sync']['orig']))
            self.assertNotIn('bg', result['lines'][0])
            with open(source, encoding='utf8') as f: self.assertEqual(json.load(f), project)
            with open(vocal, 'rb') as f: self.assertEqual(f.read(), b'cached input')
            self.assertFalse(os.path.exists(os.path.splitext(output)[0] + '.stems'))

    def test_separator_requires_committed_identity_and_reuses_actual_fallback(self):
        with tempfile.TemporaryDirectory() as tmp:
            direct, fallback = os.path.join(tmp, 'vocals-roformer.wav'), os.path.join(tmp, 'vocals.wav')
            def generate(song, output, work):
                with open(output, 'wb') as f: f.write(b'new stem')
            with open(direct, 'wb') as f: f.write(b'uncommitted old stem')
            with patch.object(align, 'roformer_vocals', side_effect=generate) as generate_mock, \
                 patch.object(align, 'decode', return_value=np.zeros((1, 16))):
                self.assertEqual(align.separate('original', tmp, 'cpu', False, sep='roformer')[2], direct)
                generate_mock.assert_called_once()
                with open(direct + '.json', encoding='utf8') as f:
                    self.assertEqual(json.load(f), {'source': 'roformer', 'model': align.ROFORMER})
                self.assertFalse(os.path.exists(direct + '.json.tmp'))
                align.separate('original', tmp, 'cpu', False, sep='roformer')
                generate_mock.assert_called_once()  # committed same identity is reusable
                with open(direct + '.json', 'w') as f: json.dump({'source': 'roformer', 'model': 'wrong'}, f)
                align.separate('original', tmp, 'cpu', False, sep='roformer')
                self.assertEqual(generate_mock.call_count, 2)
                with open(direct + '.json', 'w') as f: json.dump({'source': 'htdemucs', 'model': 'htdemucs'}, f)
                with open(fallback, 'wb') as f: f.write(b'completed fallback')
                with open(fallback + '.json', 'w') as f: json.dump({'source': 'htdemucs', 'model': 'htdemucs'}, f)
                self.assertEqual(align.separate('original', tmp, 'cpu', False, sep='roformer')[2], fallback)
                self.assertEqual(generate_mock.call_count, 2, 'completed fallback must not extract again')
                with open(fallback + '.json', encoding='utf8') as f:
                    self.assertEqual(json.load(f), {'source': 'htdemucs', 'model': 'htdemucs'})


if __name__ == '__main__': unittest.main()
