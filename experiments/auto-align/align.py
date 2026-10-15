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
SHORT = 0.08     # s: shorter units start earlier, into the previous word's hold
OUT_PEN = 1.0    # cost per letter frame outside the line's LRC t..end (+-LRC_TOL): keeps chorus lines from sliding
LRC_TOL = 0.3
BACK_MIN = 0.1   # backing stem quieter than this x vocals in a line window = split failed there, use vocals
MODELS = {'ru': 'jonatasgrosman/wav2vec2-large-xlsr-53-russian', 'en': 'jonatasgrosman/wav2vec2-large-xlsr-53-english'}
KARAOKE = 'UVR_MDXNET_KARA_2.onnx'
SLOT = 0.4       # s max slot for a unit without letters ("—", "2") in a long gap
# alignment-only transliteration for words in the other alphabet ("Say ahh" in a Russian line)
LAT2CYR = [('shch', 'щ'), ('sh', 'ш'), ('ch', 'ч'), ('zh', 'ж'), ('kh', 'х'), ('ts', 'ц'), ('ya', 'я'), ('yu', 'ю'), ('yo', 'ё'),
           ('ee', 'и'), ('oo', 'у'), ('ph', 'ф'), ('th', 'т'), ('j', 'дж'), ('x', 'кс'), *zip('abcdefghiklmnopqrstuvwyz', 'абкдефгхиклмнопкрстувуйз')]
CYR2LAT = [('щ', 'shch'), ('ш', 'sh'), ('ч', 'ch'), ('ж', 'zh'), ('х', 'kh'), ('ц', 'ts'), ('я', 'ya'), ('ю', 'yu'), ('ё', 'yo'), ('ъ', ''), ('ь', ''),
           *zip('абвгдезийклмнопрстуфыэ', 'abvgdeziyklmnoprstufye')]


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
def viterbi(lp, toks, blank, free_pen=FREE_PEN, bias=None):
    """lp: (T, V) log-probs, toks: token ids, bias: (T,) added to in-line frames. Returns [(start_frame, end_frame)] per token, or None."""
    T, L = len(lp), len(toks)
    if L == 0 or T < L: return None
    ext = np.full(2 * L + 1, blank); ext[1::2] = toks
    S, NEG = len(ext), -1e18
    skip = np.zeros(S, bool); skip[3::2] = ext[3::2] != ext[1:-2:2]
    free = lp.max(1) - free_pen
    E = lp if bias is None else lp + bias[:, None]
    if bias is not None: E[:, blank] = lp[:, blank]  # only letters pay: silence is free anywhere
    bp = np.zeros((T, S), np.int8)          # 0 stay, 1 from s-1, 2 from s-2, 3 from pre
    pbp = np.zeros(T, np.int8)              # post: 0 stay, 1 from S-1, 2 from S-2
    dp = np.full(S, NEG); dp[0], dp[1] = E[0, ext[0]], E[0, ext[1]]; bp[0, :2] = 3
    pre, post = free[0], NEG
    for t in range(1, T):
        c = np.stack([dp, np.r_[NEG, dp[:-1]], np.where(skip, np.r_[NEG, NEG, dp[:-2]], NEG), np.full(S, NEG)])
        c[3, :2] = pre
        k = c.argmax(0); bp[t] = k
        po = [post, dp[S - 1], dp[S - 2]]; pk = int(np.argmax(po)); pbp[t] = pk
        dp, post, pre = c[k, np.arange(S)] + E[t, ext], po[pk] + free[t], pre + free[t]
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
    if all(x is None for x in a): return None
    i = 0
    while i < n:  # a run of letterless units i..j-1 shares the gap between its aligned neighbours
        if a[i] is not None: i += 1; continue
        j = i
        while j < n and a[j] is None: j += 1
        k, p = j - i, i - 1
        lo = rb[p] if p >= 0 else max(t0, a[j] - SLOT * (j - i))
        hi = a[j] if j < n else min(t1, lo + SLOT * k)
        if hi - lo < MIN_W * k and p >= 0:  # no gap: split the left neighbour's span with it
            lo = a[p]; rb[p] = lo + (hi - lo) / (k + 1); lo = rb[p]
        step = min(max(hi - lo, MIN_W * k) / k, SLOT)
        for m in range(k): a[i + m] = lo + m * step; rb[i + m] = a[i + m] + step
        i = j
    out = []
    for i in range(n):  # held till the next word (at most HOLD), never overlapping
        ai = max(a[i], out[-1][1]) if out else a[i]
        b = rb[i] + HOLD
        if i + 1 < n: b = min(b, max(a[i + 1], rb[i]))
        b = min(b, t1)
        if b - ai < SHORT:  # too short to see: start earlier, into the previous word's hold (CTC onsets run late anyway)
            floor = max(rb[i - 1], out[-1][0] + MIN_W) if out else t0
            ai = max(min(ai, b - SHORT), floor)
            if out and out[-1][1] > ai: out[-1] = (out[-1][0], ai)
        out.append((ai, max(b, ai + MIN_W)))
    return [(round(x, 3), round(y, 3)) for x, y in out]


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


def separate(song, work, device, karaoke=True, emit=lambda **k: None):
    """-> (vocals_16k, backing_16k or None); stems cached in `work`"""
    os.makedirs(work, exist_ok=True)
    voc = os.path.join(work, 'vocals.wav')
    emit(stage='demucs', done=0, total=1)
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
    emit(stage='demucs', done=1, total=1)
    back = os.path.join(work, 'backing.wav')
    if karaoke: emit(stage='karaoke', done=0, total=1)
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
    if karaoke: emit(stage='karaoke', done=1, total=1)
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
        tr = LAT2CYR if 'а' in vocab else CYR2LAT
        for i, (w, _) in enumerate(us):
            w = w.lower().replace(' ', '')
            for src, dst in tr:
                if src[0] not in vocab: w = w.replace(src, dst)
            for ch in w:
                ch = ch if ch in vocab else ch.upper() if ch.upper() in vocab else 'е' if ch == 'ё' and 'е' in vocab else None
                if ch and ch.isalpha() or ch == "'":
                    ids.append(vocab[ch]); owner.append(i)
        return ids, owner

    def align(self, audio, t0, t1, text, lang, core=None):
        """core: (t, end) from LRC; letters outside it cost OUT_PEN per frame"""
        import torch
        us = units(text)
        proc, model, vocab = self.load(lang)
        ids, owner = self.tokens(us, vocab, lang)
        s0, s1 = max(0, int(t0 * SR)), min(len(audio), int(t1 * SR))
        if not ids or s1 - s0 < SR // 4: return None
        x = proc(audio[s0:s1], sampling_rate=SR, return_tensors='pt').input_values.to(self.device)
        with torch.no_grad():
            lp = torch.log_softmax(model(x).logits[0].float(), -1).cpu().numpy()
        fdur = (s1 - s0) / SR / len(lp)
        bias = None
        if core:
            ft = s0 / SR + np.arange(len(lp)) * fdur
            bias = np.where((ft < core[0] - LRC_TOL) | (ft > core[1] + LRC_TOL), -OUT_PEN, 0.0)
        spans = viterbi(lp, ids, proc.tokenizer.pad_token_id, bias=bias)
        return spans and to_units(us, owner, spans, fdur, s0 / SR, s1 / SR)


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



def untangle(project):
    """per layer, all lines as one sequence: an auto span (g) starts after the previous span ends and stops
    at the next span's start (so a line's last word stops at the next line's first word); hand spans never move"""
    for layer in ('orig', 'bgo'):
        seq = [x for ln in project['lines'] for x in ((ln.get('sync') or {}).get(layer) or [])
               if x and x.get('a') is not None and x.get('b') is not None]
        for i, x in enumerate(seq):
            if not x.get('g'): continue
            if i: x['a'] = round(max(x['a'], seq[i - 1]['b']), 3)
            if i + 1 < len(seq) and seq[i + 1]['a'] >= x['a'] + MIN_W: x['b'] = min(x['b'], seq[i + 1]['a'])
            x['b'] = round(max(x['b'], x['a'] + MIN_W), 3)


def report(project):
    """overlaps the way qaCheck sees them (inside a line; a line starting >50 ms before the previous ends) + stats"""
    L, r, prev, d = project['lines'], {'overlaps': 0, 'short': 0, 'past_next_lrc': 0}, None, []
    for i, ln in enumerate(L):
        for layer in ('orig', 'bgo'):
            s = (ln.get('sync') or {}).get(layer) or []
            r['overlaps'] += sum(s[k]['a'] < s[k - 1]['b'] - 0.002 for k in range(1, len(s)))
            r['short'] += sum(x['b'] - x['a'] < 0.08 for x in s)
        s = (ln.get('sync') or {}).get('orig')
        if not s: continue
        r['overlaps'] += int(prev is not None and s[0]['a'] < prev - 0.05)
        r['past_next_lrc'] += int(i + 1 < len(L) and s[-1]['b'] > L[i + 1]['t'])
        prev = s[-1]['b']; d.append(abs(s[0]['a'] - ln['t']))
    if d: r['first_vs_lrc_ms'] = {'median': round(float(np.median(d)) * 1000), 'p90': round(float(np.percentile(d, 90)) * 1000), 'max': round(max(d) * 1000)}
    return r


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
    ap.add_argument('--json-progress', action='store_true', help='stdout: one JSON object per line (for the editor server)')
    a = ap.parse_args(argv)
    if not a.json_progress: return run(a, lambda **k: None)
    out, sys.stdout = sys.stdout, sys.stderr  # stdout carries only our JSON lines; library chatter goes to stderr
    def emit(**k): out.write(json.dumps(k, ensure_ascii=False) + '\n'); out.flush()
    try: run(a, emit)
    except Exception as e:
        emit(error=f'{type(e).__name__}: {e}'); sys.exit(1)
    finally: sys.stdout = out


def run(a, emit):
    import torch
    dev = a.device or ('cuda' if torch.cuda.is_available() else 'cpu')
    with open(a.project, encoding='utf-8') as f: proj = json.load(f)
    if not proj.get('lines'): raise ValueError('not a Spicy Translate project (no lines)')
    work = os.path.abspath(os.path.splitext(a.out)[0] + '.stems')
    if a.no_separation: voc, back = decode(a.audio)[0], None
    else: voc, back = separate(a.audio, work, dev, not a.no_karaoke, emit)
    al, total = Aligner(dev, a.model), len(proj['lines'])

    def aligned_for(i, ln, layer, text):
        t, end = float(ln['t']), float(ln.get('end') or ln['t'] + 10)
        src = voc
        if layer == 'bgo' and back is not None:
            w = slice(max(0, int((t - a.pad) * SR)), int((end + a.pad) * SR))
            if np.sqrt(np.mean(back[w] ** 2)) >= BACK_MIN * np.sqrt(np.mean(voc[w] ** 2) + 1e-12): src = back
        print(f'\r{i + 1}/{total} {layer}', end='', file=sys.stderr); emit(stage='align', done=i, total=total)
        return al.align(src, t - a.pad, end + a.pad, text, a.lang or lang_of(text), (t, end))

    errs = fill(proj, aligned_for, a.force)
    untangle(proj)
    print(file=sys.stderr)
    with open(a.out, 'w', encoding='utf-8') as f: json.dump(proj, f, ensure_ascii=False, indent=1)
    for layer, e in errs.items():
        if e: print(f'{layer}: {len(e)} words, start error median {np.median(e) * 1000:.0f} ms, p90 {np.percentile(e, 90) * 1000:.0f} ms, <=200ms {np.mean(np.array(e) <= 0.2) * 100:.0f}%')
    rep = report(proj)
    print('written', a.out, json.dumps(rep))
    emit(stage='align', done=total, total=total)
    emit(done=True, out=os.path.abspath(a.out), vocals=None if a.no_separation else os.path.join(work, 'vocals.wav'), overlaps=rep['overlaps'])


if __name__ == '__main__':
    main()
