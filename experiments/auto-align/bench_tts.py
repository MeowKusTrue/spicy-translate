"""Synthetic end-to-end check (Windows): TTS lead + backing voices over a fake backing track,
word starts from SAPI as ground truth, then `align.py --force` prints the error.
python bench_tts.py [--device cpu] [--no-karaoke]"""
import json, os, subprocess, sys
import numpy as np
from align import SR, decode, write_wav, units, main as align_main

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'sample')
LEAD, BACK = 'Microsoft Irina Desktop', 'Microsoft Pavel'
LINES = [  # (lead, backing); NBSP glues two words into one unit, as in the editor
    ('Ночью город тихо засыпает', ''),
    ('Я не знаю, где теперь твой дом', 'где твой дом'),
    ('Только ветер помнит наши имена', ''),
    ('', 'о-о, имена'),
    ('Мы идём по краю, не глядя вниз', 'не глядя вниз'),
    ('И снова утро над рекой', ''),
]
PS = r'''
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice($env:V)
$f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo 16000, ([System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen), ([System.Speech.AudioFormat.AudioChannel]::Mono)
$s.SetOutputToWaveFile($env:O, $f)
$s.add_SpeakProgress({ param($o, $e) [Console]::Out.WriteLine("$($e.CharacterPosition) $($e.AudioPosition.TotalMilliseconds)") })
$s.Speak([IO.File]::ReadAllText($env:T, [Text.Encoding]::UTF8))
$s.Dispose()
'''


def tts(text, voice, tmp):
    """-> (audio 16k, start time of each editor unit)"""
    plain = text.replace(' ', ' ')
    with open(tmp + '.txt', 'w', encoding='utf-8') as f: f.write(plain)
    r = subprocess.run(['powershell', '-NoProfile', '-Command', PS], capture_output=True, text=True, check=True,
                       env={**os.environ, 'V': voice, 'O': tmp + '.wav', 'T': tmp + '.txt'})
    ev = dict((int(c), float(ms) / 1000) for c, ms in (l.split() for l in r.stdout.split('\n') if l.strip()))
    starts, pos = [], 0
    for w, _ in units(text):
        pos = plain.index(w.split(' ')[0], pos)
        starts.append(ev.get(pos, min((v for k, v in ev.items() if k >= pos), default=None)))
        pos += len(w)
    return decode(tmp + '.wav')[0], starts


def main():
    os.makedirs(OUT, exist_ok=True); tmp = os.path.join(OUT, '_tts')
    rng = np.random.default_rng(0)
    mix, lines, t = np.zeros(SR * 120, np.float32), [], 1.0
    for text, bg in LINES:
        ln = {'t': round(t - 0.15, 2), 'end': 0, 'text': text, 'tr': '', 'sync': {}}
        cur = t
        for txt, voice, layer, gain in ((text, LEAD, 'orig', 1.0), (bg, BACK, 'bgo', 0.6)):
            if not txt: continue
            x, st = tts(txt, voice, tmp)
            at = cur if layer == 'orig' or not text else cur - 0.8   # backing overlaps the lead's tail
            i = int(at * SR); mix[i:i + len(x)] += gain * x
            ws = [{'a': round(at + s, 3), 'b': round(at + e, 3)} for s, e in zip(st, st[1:] + [len(x) / SR - 0.1])]
            ln['sync'][layer] = ws
            if layer == 'bgo': ln['bg'] = {'text': txt, 'tr': ''}
            cur = at + len(x) / SR
        lines.append(ln); t = cur + 0.7
    n = int((t + 1) * SR); mix = mix[:n]
    tt = np.arange(n) / SR   # fake backing track: chords changing every 2 s + noise
    chords = [[220, 277, 330], [196, 247, 294], [175, 220, 262], [165, 208, 247]]
    music = sum(np.sin(2 * np.pi * np.array(chords)[(tt // 2).astype(int) % 4, k] * tt) for k in range(3))
    mix = mix + 0.08 * music.astype(np.float32) + 0.02 * rng.standard_normal(n).astype(np.float32)
    for a, b in zip(lines, lines[1:]): a['end'] = b['t']
    lines[-1]['end'] = round(t, 2)
    write_wav(os.path.join(OUT, 'tts_song.wav'), mix / np.abs(mix).max() * 0.9, SR)
    with open(os.path.join(OUT, 'tts_truth.spicy.json'), 'w', encoding='utf-8') as f:
        json.dump({'v': 1, 'meta': {'title': 'tts bench', 'artist': '', 'lang': 'ru', 'mode': 'translation'}, 'lines': lines}, f, ensure_ascii=False, indent=1)
    for e in ('.wav', '.txt'): os.remove(tmp + e)
    align_main([os.path.join(OUT, 'tts_song.wav'), os.path.join(OUT, 'tts_truth.spicy.json'),
                '-o', os.path.join(OUT, 'tts_auto.spicy.json'), '--force'] + sys.argv[1:])


if __name__ == '__main__':
    main()
