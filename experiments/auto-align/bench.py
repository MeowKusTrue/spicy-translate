"""Auto-timing accuracy on hand-marked songs.

bench/<song>/song.mp3 + bench/<song>/hand.spicy.json (marked by hand in the editor; not in git)
python bench.py [--variant NAME] [align.py options...]  ->  table: start error of every hand-marked word

The hand project is re-aligned with --force (hand words included), each word's auto start is compared to the hand one.
Stems are cached per separator (bench/<song>/<sep>.stems), so trying aligners is quick.
"""
import json, os, subprocess, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))


def units_n(text):
    import re
    return sum(len([p for p in t.split('|') if p]) for t in re.split(r'[^\S ]+', str(text or '')) if t)


def errors(hand, auto):
    """{layer: [auto_start - hand_start]} over words marked by hand (no g) on both sides of the same text"""
    out = {'orig': [], 'bgo': []}
    for h, a in zip(hand['lines'], auto['lines']):
        for layer in out:
            hs, as_ = (h.get('sync') or {}).get(layer) or [], (a.get('sync') or {}).get(layer) or []
            if len(hs) != len(as_): continue
            out[layer] += [y['a'] - x['a'] for x, y in zip(hs, as_) if x and y and x.get('a') is not None and y.get('a') is not None and not x.get('g')]
    return out


def stats(e):
    if not e: return None
    a = np.abs(np.array(e))
    return {'n': len(e), 'median_ms': round(float(np.median(a)) * 1000), 'p90_ms': round(float(np.percentile(a, 90)) * 1000),
            'le100': round(float(np.mean(a <= 0.1)) * 100), 'le200': round(float(np.mean(a <= 0.2)) * 100), 'bias_ms': round(float(np.median(e)) * 1000)}


def main():
    args = sys.argv[1:]
    name = 'base'
    if '--variant' in args: i = args.index('--variant'); name = args[i + 1]; del args[i:i + 2]
    sep = args[args.index('--sep') + 1] if '--sep' in args else 'htdemucs'
    rows = []
    for song in sorted(os.listdir(os.path.join(HERE, 'bench'))):
        d = os.path.join(HERE, 'bench', song); hand_p = os.path.join(d, 'hand.spicy.json')
        if not os.path.exists(hand_p): continue
        out = os.path.join(d, f'{sep}.json')  # stems go to <out>.stems: one cache per separator
        cmd = [sys.executable, os.path.join(HERE, 'align.py'), os.path.join(d, 'song.mp3'), hand_p, '-o', out, '--force', *args]
        r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
        if r.returncode: print(song, 'FAILED', r.stderr[-800:]); continue
        res = os.path.join(d, f'result-{name}.json'); os.replace(out, res)
        with open(hand_p, encoding='utf-8') as f: hand = json.load(f)
        with open(res, encoding='utf-8') as f: auto = json.load(f)
        for layer, e in errors(hand, auto).items():
            s = stats(e)
            if s: rows.append((song, layer, s))
    print(f'\n== {name} ({" ".join(args) or "defaults"})')
    print(f'{"song":12} {"layer":5} {"words":>5} {"median":>7} {"p90":>6} {"<=100":>6} {"<=200":>6} {"bias":>6}')
    for song, layer, s in rows:
        print(f'{song:12} {layer:5} {s["n"]:5} {s["median_ms"]:6}ms {s["p90_ms"]:5}ms {s["le100"]:5}% {s["le200"]:5}% {s["bias_ms"]:5}ms')
    log = os.path.join(HERE, 'bench', 'results.jsonl')
    with open(log, 'a', encoding='utf-8') as f: f.write(json.dumps({'variant': name, 'args': args, 'rows': rows}, ensure_ascii=False) + '\n')


if __name__ == '__main__':
    main()
