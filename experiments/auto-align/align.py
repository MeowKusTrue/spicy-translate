"""Approximate word timings for a Spicy Translate project (prototype).

python align.py song.mp3 project.spicy.json -o out.spicy.json [--device cuda|cpu] [--lang ru|en]

Demucs (htdemucs) -> vocals; optional UVR karaoke model (audio-separator) -> backing;
then CTC forced alignment (wav2vec2) of the KNOWN text of each line inside [t-pad, end+pad].
Fills lines[].sync.orig / .bgo with {a, b, g:1}; hand-marked spans (no g) are kept.
"""
import argparse, json, os, re, subprocess, sys, wave
import numpy as np

SR = 16000
FREE_PEN = 0.5   # per-frame cost of "not this line" at window edges; higher = line spreads wider
HOLD = 0.3       # s a word is held after its last letter if the next word starts later
MIN_W = 0.05     # s minimal unit length
BACK_MIN = 0.1   # backing stem quieter than this x vocals in a line window = split failed there, use vocals
MODELS = {'ru': 'jonatasgrosman/wav2vec2-large-xlsr-53-russian', 'en': 'jonatasgrosman/wav2vec2-large-xlsr-53-english'}
KARAOKE = 'UVR_MDXNET_KARA_2.onnx'


# ---- text units: same rule as src/core/words.ts units() ----
def units(text):
    out = []
    for tok in re.split(r'[^\S ]+', str(text or '')):
        parts = [p for p in tok.split('|') if p]
        out += [(w, j == len(parts) - 1) for j, w in enumerate(parts)]
    return out


def layer_text(line, layer):
    return line.get('text') or '' if layer == 'orig' else (line.get('bg') or {}).get('text') or ''


def hand_done(sync, n):
    """layer fully marked by hand (same test as the editor's auto-spread): leave it alone"""
    return isinstance(sync, list) and len(sync) == n > 0 and all(x and x.get('a') is not None and x.get('b') is not None and not x.get('g') for x in sync)


def lang_of(text):
    cyr = len(re.findall(r'[а-яё]', text, re.I)); lat = len(re.findall(r'[a-z]', text, re.I))
    return 'ru' if cyr >= lat else 'en'


# ---- CTC Viterbi with free (unaligned) frames before and after the line ----
def viterbi(lp, toks, blank, free_pen=FREE_PEN):
    """lp: (T, V) log-probs, toks: token ids. Returns [(start_frame, end_frame)] per token, or None."""
    T, L = len(lp), len(toks)
    if L == 0 or T < L: return None
    ext = np.full(2 * L + 1, blank); ext[1::2] = toks
    S, NEG = len(ext), -1e18
    skip = np.zeros(S, bool); skip[3::2] = ext[3::2] != ext[1:-2:2]
    free = lp.max(1) - free_pen
    bp = np.zeros((T, S), np.int8)          # 0 stay, 1 from s-1, 2 from s-2, 3 from pre
    pbp = np.zeros(T, np.int8)              # post: 0 stay, 1 from S-1, 2 from S-2
    dp = np.full(S, NEG); dp[0], dp[1] = lp[0, ext[0]], lp[0, ext[1]]; bp[0, :2] = 3
    pre, post = free[0], NEG
    for t in range(1, T):
        c = np.stack([dp, np.r_[NEG, dp[:-1]], np.where(skip, np.r_[NEG, NEG, dp[:-2]], NEG), np.full(S, NEG)])
        c[3, :2] = pre
        k = c.argmax(0); bp[t] = k
        po = [post, dp[S - 1], dp[S - 2]]; pk = int(np.argmax(po)); pbp[t] = pk
        dp, post, pre = c[k, np.arange(S)] + lp[t, ext], po[pk] + free[t], pre + free[t]
    end = [dp[S - 1], dp[S - 2], post]; e = int(np.argmax(end))
    st = np.empty(T, int); s = [S - 1, S - 2, S][e]
    for t in range(T - 1, -1, -1):
        st[t] = s
        if s == S:
            k = pbp[t]; s = S if k == 0 else S - k
        elif s >= 0:
            k = bp[t, s]; s = -1 if k == 3 else s - k
    spans = []
    for j in range(L):
        f = np.nonzero(st == 2 * j + 1)[0]
        if not len(f): return None
        spans.append((int(f[0]), int(f[-1]) + 1))
    return spans


def to_units(us, tok_unit, spans, fdur, t0, t1):
    """token spans -> [(a, b)] per unit; units without letters are put between neighbours"""
    n = len(us); a = [None] * n; rb = [None] * n
    for u, (s, e) in zip(tok_unit, spans):
        if a[u] is None: a[u] = t0 + s * fdur
        rb[u] = t0 + e * fdur
    known = [i for i in range(n) if a[i] is not None]
    if not known: return None
    for i in range(n):  # ponytail: letterless units ("—", "2") get a fixed slot next to a neighbour
        if a[i] is None:
            p = max([k for k in known if k < i], default=None)
            a[i] = rb[p] if p is not None else a[min(k for k in known if k > i)] - 0.2
            rb[i] = a[i] + 0.2
    out = []
    for i in range(n):
        b = rb[i] + HOLD
        if i + 1 < n: b = min(b, max(a[i + 1], rb[i]))
        b = min(max(b, a[i] + MIN_W), t1)
        out.append((round(a[i], 3), round(max(b, a[i] + MIN_W), 3)))
    return out


# ---- audio ----
def decode(path, sr=SR, ch=1):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', str(ch), '-ar', str(sr), '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, ch).T.copy()


def write_wav(path, x, sr):
    x = np.clip(np.atleast_2d(x), -1, 1)
    with wave.open(path, 'wb') as w:
        w.setnchannels(x.shape[0]); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes((x.T * 32767).astype('<i2').tobytes())


def separate(song, work, device, karaoke=True):
    """-> (vocals_16k, backing_16k or None); stems cached in `work`"""
    os.makedirs(work, exist_ok=True)
    voc = os.path.join(work, 'vocals.wav')
    if not os.path.exists(voc):
        import torch
        from demucs.pretrained import get_model
        from demucs.apply import apply_model
        m = get_model('htdemucs').to(device).eval()
        wav = torch.from_numpy(decode(song, m.samplerate, m.audio_channels))
        ref = wav.mean(0); mu, sd = ref.mean(), ref.std() + 1e-8
        with torch.no_grad():
            out = apply_model(m, ((wav - mu) / sd)[None], device=device, split=True, overlap=0.25, progress=True)[0]
        write_wav(voc, (out[m.sources.index('vocals')] * sd + mu).cpu().numpy(), m.samplerate)
        del m; torch.cuda.empty_cache() if device == 'cuda' else None
    back = os.path.join(work, 'backing.wav')
    if karaoke and not os.path.exists(back):
        try:
            from audio_separator.separator import Separator
            sep = Separator(output_dir=work, output_format='WAV')
            sep.load_model(model_filename=KARAOKE)
            for f in sep.separate(voc):
                f = f if os.path.isabs(f) else os.path.join(work, f)
                if '(Instrumental)' in f: os.replace(f, back)
                else: os.remove(f)  # lead: the full vocal stem is safer for the main text
        except Exception as e:  # optional: no package / no model / no GPU provider
            print(f'karaoke split skipped ({type(e).__name__}: {e}); backing vocals aligned on the full vocal stem', file=sys.stderr)
    return decode(voc)[0], (decode(back)[0] if karaoke and os.path.exists(back) else None)


# ---- acoustic model ----
class Aligner:
    def __init__(self, device, model=None):
        self.device, self.override, self.m = device, model, {}

    def load(self, lang):
        if lang not in self.m:
            from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor
            name = self.override or MODELS[lang]
            proc = Wav2Vec2Processor.from_pretrained(name)
            self.m[lang] = (proc, Wav2Vec2ForCTC.from_pretrained(name).to(self.device).eval(), proc.tokenizer.get_vocab())
        return self.m[lang]

    def tokens(self, us, vocab, lang):
        ids, owner = [], []
        for i, (w, _) in enumerate(us):
            for ch in w.lower().replace(' ', ''):
                ch = ch if ch in vocab else ch.upper() if ch.upper() in vocab else 'е' if ch == 'ё' and 'е' in vocab else None
                if ch and ch.isalpha() or ch == "'":
                    ids.append(vocab[ch]); owner.append(i)
        return ids, owner

    def align(self, audio, t0, t1, text, lang):
        import torch
        us = units(text)
        proc, model, vocab = self.load(lang)
        ids, owner = self.tokens(us, vocab, lang)
        s0, s1 = max(0, int(t0 * SR)), min(len(audio), int(t1 * SR))
        if not ids or s1 - s0 < SR // 4: return None
        x = proc(audio[s0:s1], sampling_rate=SR, return_tensors='pt').input_values.to(self.device)
        with torch.no_grad():
            lp = torch.log_softmax(model(x).logits[0].float(), -1).cpu().numpy()
        spans = viterbi(lp, ids, proc.tokenizer.pad_token_id)
        return spans and to_units(us, owner, spans, (s1 - s0) / SR / len(lp), s0 / SR, s1 / SR)


# ---- project ----
def fill(project, aligned_for, force=False):
    """aligned_for(i, line, layer, text) -> [(a,b)] | None. Returns {layer: [abs start errors vs old hand marks]}"""
    errs = {'orig': [], 'bgo': []}
    for i, ln in enumerate(project['lines']):
        for layer in ('orig', 'bgo'):
            text = layer_text(ln, layer); n = len(units(text))
            cur = (ln.get('sync') or {}).get(layer)
            if not n or (hand_done(cur, n) and not force): continue
            got = aligned_for(i, ln, layer, text)
            if not got: continue
            if hand_done(cur, n): errs[layer] += [abs(g[0] - c['a']) for g, c in zip(got, cur)]
            keep = cur if isinstance(cur, list) and len(cur) == n and not force else [None] * n
            new = [k if k and not k.get('g') and k.get('a') is not None and k.get('b') is not None
                   else {'a': a, 'b': b, 'g': 1} for k, (a, b) in zip(keep, got)]
            ln['sync'] = {**(ln.get('sync') or {}), layer: new}
    return errs


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('audio'); ap.add_argument('project')
    ap.add_argument('-o', '--out', required=True)
    ap.add_argument('--device', default=None, help='cuda | cpu (default: cuda if available)')
    ap.add_argument('--lang', choices=list(MODELS), help='default: per line by alphabet')
    ap.add_argument('--model', help='HF wav2vec2 CTC model instead of the per-language default')
    ap.add_argument('--pad', type=float, default=1.5, help='s of slack around LRC t..end (default 1.5)')
    ap.add_argument('--no-separation', action='store_true', help='align on the mix as is (a cappella / tests)')
    ap.add_argument('--no-karaoke', action='store_true', help='skip lead/backing split')
    ap.add_argument('--force', action='store_true', help='re-align hand-marked layers too and print error vs them')
    a = ap.parse_args(argv)
    import torch
    dev = a.device or ('cuda' if torch.cuda.is_available() else 'cpu')
    with open(a.project, encoding='utf-8') as f: proj = json.load(f)
    if not proj.get('lines'): sys.exit('not a Spicy Translate project (no lines)')

    if a.no_separation: voc, back = decode(a.audio)[0], None
    else: voc, back = separate(a.audio, os.path.splitext(a.out)[0] + '.stems', dev, not a.no_karaoke)
    al = Aligner(dev, a.model)

    def aligned_for(i, ln, layer, text):
        t, end = float(ln['t']), float(ln.get('end') or ln['t'] + 10)
        src = voc
        if layer == 'bgo' and back is not None:
            w = slice(max(0, int((t - a.pad) * SR)), int((end + a.pad) * SR))
            if np.sqrt(np.mean(back[w] ** 2)) >= BACK_MIN * np.sqrt(np.mean(voc[w] ** 2) + 1e-12): src = back
        print(f'\r{i + 1}/{len(proj["lines"])} {layer}', end='', file=sys.stderr)
        return al.align(src, t - a.pad, end + a.pad, text, a.lang or lang_of(text))

    errs = fill(proj, aligned_for, a.force)
    print(file=sys.stderr)
    with open(a.out, 'w', encoding='utf-8') as f: json.dump(proj, f, ensure_ascii=False, indent=1)
    for layer, e in errs.items():
        if e: print(f'{layer}: {len(e)} words, start error median {np.median(e) * 1000:.0f} ms, p90 {np.percentile(e, 90) * 1000:.0f} ms, <=200ms {np.mean(np.array(e) <= 0.2) * 100:.0f}%')
    print('written', a.out)


if __name__ == '__main__':
    main()
