"""Approximate word timings for a Spicy Translate project (prototype).

python align.py song.mp3 project.spicy.json -o out.spicy.json [--device auto|cuda|xpu|dml|cpu] [--lang ru|en]

Demucs (htdemucs; --sep roformer: MelBand-RoFormer) -> vocals; optional UVR karaoke model (audio-separator) -> backing;
then CTC forced alignment of the KNOWN text of each line inside [t-pad, end+pad]: wav2vec2 xlsr-53 for the lead,
torchaudio MMS-FA for backing vocals (what bench.py measured best). No lyrics: --transcribe (Whisper) writes them first.
Each auto word gets c = the model's confidence (the editor marks low ones for checking).
Fills lines[].sync.orig / .bgo with {a, b, g:1}; hand-marked spans (no g) are kept.
"""
import argparse, json, os, re, subprocess, sys, wave
import numpy as np
from line_windows import locate_line_windows

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
ROFORMER = 'vocals_mel_band_roformer.ckpt'
WHISPER_MODELS = {'turbo': 'openai/whisper-large-v3-turbo', 'large-v3': 'openai/whisper-large-v3'}
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


def needs_alignment(line, layer, force=False):
    n = len(units(layer_text(line, layer)))
    return bool(n and (force or not ((line.get('approved') or {}).get(layer) or hand_done((line.get('sync') or {}).get(layer), n))))


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
            k = int(pbp[t]); s = S if k == 0 else S - k  # int(): numpy 2 keeps int8 and overflows on long lines
        elif s >= 0:
            k = int(bp[t, s]); s = -1 if k == 3 else s - k
    spans = []
    for j in range(L):
        f = np.nonzero(st == 2 * j + 1)[0]
        if not len(f): return None
        spans.append((int(f[0]), int(f[-1]) + 1))
    return spans


def to_units(us, tok_unit, spans, fdur, t0, t1):
    """token spans -> [(a, b)] per unit; units without letters are put between neighbours"""
    n = len(us)
    # Output is millisecond-rounded: reserve a positive representable slot per unit.
    if not n or not np.isfinite(t0) or not np.isfinite(t1): return None
    t0, t1 = np.ceil(t0 * 1000) / 1000, np.floor(t1 * 1000) / 1000
    min_w = min(MIN_W, np.floor((t1 - t0) * 1000 / n + 1e-9) / 1000)
    if min_w < .001: return None
    a = [None] * n; rb = [None] * n
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
        ceiling = t1 - (n - i - 1) * min_w
        b = min(b, ceiling)
        if b - ai < SHORT:  # too short to see: start earlier, into the previous word's hold (CTC onsets run late anyway)
            floor = max(rb[i - 1], out[-1][0] + MIN_W) if out else t0
            ai = max(min(ai, b - SHORT), floor)
            if out and out[-1][1] > ai: out[-1] = (out[-1][0], ai)
        floor = out[-1][1] if out else t0
        ai = min(max(ai, floor), ceiling - min_w)
        out.append((ai, min(ceiling, max(b, ai + min_w))))
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


# ---- devices: any GPU, CPU when a stage can't run there ----
def pick_device(want=None):
    """auto: NVIDIA (cuda) > Intel Arc (xpu) > AMD / other via DirectML (torch-directml) > CPU"""
    import torch
    if want and want != 'auto':
        if want == 'dml':
            import torch_directml
            return torch_directml.device()
        return want
    if torch.cuda.is_available(): return 'cuda'
    if hasattr(torch, 'xpu') and torch.xpu.is_available(): return 'xpu'
    try:
        import torch_directml
        return torch_directml.device()
    except Exception:
        return 'cpu'


def dev_name(d): return 'dml' if str(d).startswith('privateuseone') else str(d)


def on_device(device, fn, what):
    """run fn(device); if the GPU backend can't do it (missing op, out of memory), run it on the CPU instead"""
    try:
        return fn(device)
    except Exception as e:
        if str(device) == 'cpu': raise
        print(f'{what}: {type(e).__name__} on {dev_name(device)} ({e}); running on CPU', file=sys.stderr)
        return fn('cpu')


def roformer_vocals(song, voc, work):
    """MelBand-RoFormer through audio-separator (torch, uses the GPU when torch has one)"""
    from audio_separator.separator import Separator
    # fp16, light overlap, 60 s pieces: the defaults (fp32, overlap 8, whole song) fill an 8 GB card and crawl in shared memory
    sep = Separator(output_dir=work, output_format='WAV', output_single_stem='Vocals', use_autocast=True, chunk_duration=60,
                    mdxc_params={'segment_size': 256, 'override_model_segment_size': False, 'batch_size': 1, 'overlap': 2, 'pitch_shift': 0})
    sep.load_model(model_filename=ROFORMER)
    for f in sep.separate(song):
        f = f if os.path.isabs(f) else os.path.join(work, f)
        if '(vocals)' in os.path.basename(f).lower(): os.replace(f, voc)  # the stem is named song_(vocals)_<model>.wav
        elif os.path.exists(f): os.remove(f)
    if not os.path.exists(voc): raise RuntimeError('RoFormer gave no vocal stem')


def separate(song, work, device, karaoke=True, emit=lambda **k: None, sep='htdemucs'):
    """-> (vocals_16k, backing_16k or None, vocals path); stems cached in `work`, per separator"""
    os.makedirs(work, exist_ok=True)
    tag = '' if sep == 'htdemucs' else '-' + sep
    voc = os.path.join(work, f'vocals{tag}.wav')
    def committed(file, source):
        try:
            with open(file + '.json', encoding='utf-8') as f: meta = json.load(f)
            return os.path.isfile(file) and os.path.getsize(file) > 0 and meta == {'source': source, 'model': ROFORMER if source == 'roformer' else 'htdemucs'}
        except (OSError, ValueError): return False
    emit(stage='demucs', done=0, total=1)
    fallback = os.path.join(work, 'vocals.wav')
    ready = committed(voc, sep)
    if sep == 'roformer' and not ready:
        if committed(fallback, 'htdemucs'): voc, ready = fallback, True
        else:
            temp_voc = voc + '.tmp.wav'
            try:
                roformer_vocals(song, temp_voc, work)
                os.replace(temp_voc, voc)
                ready = True
            except Exception as e:
                print(f'roformer failed ({type(e).__name__}: {e}); using htdemucs', file=sys.stderr)
                voc, ready = fallback, committed(fallback, 'htdemucs')
            finally:
                if os.path.exists(temp_voc): os.remove(temp_voc)
    if not ready:
        import torch
        from demucs.pretrained import get_model
        from demucs.apply import apply_model
        def demucs(dev):
            m = get_model('htdemucs').to(dev).eval()
            wav = torch.from_numpy(decode(song, m.samplerate, m.audio_channels))
            ref = wav.mean(0); mu, sd = ref.mean(), ref.std() + 1e-8
            with torch.no_grad():
                out = apply_model(m, ((wav - mu) / sd)[None], device=dev, split=True, overlap=0.25, progress=True)[0]  # progress: tqdm -> hook_tqdm
            temp_voc = voc + '.tmp.wav'
            try:
                write_wav(temp_voc, (out[m.sources.index('vocals')] * sd + mu).cpu().numpy(), m.samplerate)
                os.replace(temp_voc, voc)
            finally:
                if os.path.exists(temp_voc): os.remove(temp_voc)
            del m; torch.cuda.empty_cache() if str(dev) == 'cuda' else None
        # DirectML has no complex STFT, which htdemucs needs: Demucs goes to the CPU there right away
        on_device('cpu' if dev_name(device) == 'dml' else device, demucs, 'demucs')
    actual_sep = 'roformer' if os.path.basename(voc) == 'vocals-roformer.wav' else 'htdemucs'
    marker = voc + '.json.tmp'
    try:
        with open(marker, 'w', encoding='utf-8') as f:
            json.dump({'source': actual_sep, 'model': ROFORMER if actual_sep == 'roformer' else 'htdemucs'}, f)
        os.replace(marker, voc + '.json')
    finally:
        if os.path.exists(marker): os.remove(marker)
    emit(stage='demucs', done=1, total=1)
    back = os.path.join(work, f'backing{tag}.wav')
    lead = os.path.join(work, f'lead{tag}.wav')
    if karaoke: emit(stage='karaoke', done=0, total=1)
    if karaoke and (not os.path.exists(back) or not os.path.exists(lead)):
        try:
            from audio_separator.separator import Separator
            sep = Separator(output_dir=work, output_format='WAV')
            sep.load_model(model_filename=KARAOKE)
            for f in sep.separate(voc):
                f = f if os.path.isabs(f) else os.path.join(work, f)
                name = os.path.basename(f).lower()
                if '(instrumental)' in name or '(backing vocals)' in name: os.replace(f, back)
                elif '(vocals)' in name or '(lead vocals)' in name: os.replace(f, lead)
        except Exception as e:  # optional: no package / no model / no GPU provider
            print(f'karaoke split skipped ({type(e).__name__}: {e}); backing vocals aligned on the full vocal stem', file=sys.stderr)
    if karaoke: emit(stage='karaoke', done=1, total=1)
    return decode(voc)[0], (decode(back)[0] if karaoke and os.path.exists(back) else None), voc


# ---- acoustic model ----
class MmsProc:
    """the bits of a HF processor the aligner uses, for torchaudio's MMS-FA"""
    class tokenizer: pad_token_id = 0
    def __call__(self, x, sampling_rate=SR, return_tensors='pt'):
        import torch
        class R: pass
        r = R(); r.input_values = torch.from_numpy(np.ascontiguousarray(x, np.float32))[None]; return r


class MmsModel:
    def __init__(self, m): self.m = m
    def to(self, d): self.m = self.m.to(d); return self
    def eval(self): self.m.eval(); return self
    def __call__(self, x):
        class O: pass
        o = O(); o.logits = self.m(x)[0]; return o


class Aligner:
    def __init__(self, device, model=None, kind='w2v'):
        self.device, self.override, self.m, self.kind = device, model, {}, kind

    def load(self, lang):
        if self.kind == 'mms': lang = 'mms'  # one model for every language
        if lang == 'mms' and lang not in self.m:
            import torchaudio
            b = torchaudio.pipelines.MMS_FA
            mdl = MmsModel(b.get_model(with_star=False)).eval()
            try: mdl = mdl.to(self.device)
            except Exception as e:
                print(f'mms: {type(e).__name__} on {dev_name(self.device)} ({e}); running on CPU', file=sys.stderr); self.device = 'cpu'
            self.m[lang] = (MmsProc(), mdl, {c: i for i, c in enumerate(b.get_labels())})
        if lang == 'mms': return self.m[lang]
        if lang not in self.m:
            from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor
            name = self.override or MODELS[lang]
            proc = Wav2Vec2Processor.from_pretrained(name)
            mdl = Wav2Vec2ForCTC.from_pretrained(name).eval()
            try:
                mdl = mdl.to(self.device)
            except Exception as e:  # backend not usable at all (driver, missing build): stay on the CPU
                print(f'wav2vec2: {type(e).__name__} on {dev_name(self.device)} ({e}); running on CPU', file=sys.stderr)
                self.device = 'cpu'
            self.m[lang] = (proc, mdl, proc.tokenizer.get_vocab())
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
        ids, owner = self.tokens(us, vocab, 'mms' if self.kind == 'mms' else lang)
        s0, s1 = max(0, int(t0 * SR)), min(len(audio), int(t1 * SR))
        if not ids or s1 - s0 < SR // 4: return None
        x = proc(audio[s0:s1], sampling_rate=SR, return_tensors='pt').input_values
        try:
            with torch.no_grad():
                lp = torch.log_softmax(model(x.to(self.device)).logits[0].float(), -1).cpu().numpy()
        except Exception as e:  # this GPU backend can't run wav2vec2: move every loaded model to the CPU for good
            if str(self.device) == 'cpu': raise
            print(f'wav2vec2: {type(e).__name__} on {dev_name(self.device)} ({e}); running on CPU', file=sys.stderr)
            self.device = 'cpu'
            for k, (p_, m_, v_) in list(self.m.items()): self.m[k] = (p_, m_.to('cpu'), v_)
            model = self.m['mms' if self.kind == 'mms' else lang][1]
            with torch.no_grad():
                lp = torch.log_softmax(model(x).logits[0].float(), -1).cpu().numpy()
        fdur = (s1 - s0) / SR / len(lp)
        bias = None
        if core:
            ft = s0 / SR + np.arange(len(lp)) * fdur
            bias = np.where((ft < core[0] - LRC_TOL) | (ft > core[1] + LRC_TOL), -OUT_PEN, 0.0)
        spans = viterbi(lp, ids, proc.tokenizer.pad_token_id, bias=bias)
        got = spans and to_units(us, owner, spans, fdur, s0 / SR, s1 / SR)
        if not got: return got
        # how sure the model is of each word: mean probability of its letters on the frames it got (no letters: unknown)
        conf = [[] for _ in us]
        for u, (s, e), tok in zip(owner, spans, ids): conf[u].append(float(np.exp(lp[s:e, tok]).mean()))
        return [(a, b, round(float(np.mean(c)), 2) if c else None) for (a, b), c in zip(got, conf)]


# ---- progress: the stage we are in + every tqdm bar inside it (model downloads, Demucs chunks, separator) ----
PROG = {'stage': 'start', 'emit': lambda **k: None, 'last': 0.0}


def stage(name, done=0, total=1, **extra):
    PROG['stage'] = name; PROG['emit'](stage=name, done=done, total=total, **extra)


def hook_tqdm():
    """libraries report progress through tqdm: forward it (throttled) as `sub` progress of the current stage"""
    import time, tqdm.std as T
    if getattr(T.tqdm, '_spicy', False): return
    upd, close = T.tqdm.update, T.tqdm.close
    def send(bar, force=False):
        now = time.time()
        if not force and now - PROG['last'] < 0.4: return
        PROG['last'] = now
        try:
            tot = bar.total or 0; desc = str(bar.desc or '').strip(': ')
            byte = bar.unit in ('B', 'iB') or 'download' in desc.lower()
            PROG['emit'](stage=PROG['stage'], sub=desc[:60] or ('загрузка' if byte else ''), sub_done=float(bar.n), sub_total=float(tot), bytes=byte)
        except Exception: pass
    def update(self, n=1):
        r = upd(self, n); send(self); return r
    def close_(self):
        send(self, True); return close(self)
    T.tqdm.update, T.tqdm.close, T.tqdm._spicy = update, close_, True
    it = T.tqdm.__iter__
    def iter_(self):
        for x in it(self): send(self); yield x
    T.tqdm.__iter__ = iter_


# ---- lyrics from the voice when there are none: Whisper words -> lines ----
HALLUCINATIONS = re.compile(r'субтитр|продолжение следует|спасибо за просмотр|подписывайтесь|редактор субтитров|amara\.org|thanks for watching', re.I)


def windows(voc, most=28.0, least=18.0):
    """cut the voice into pieces Whisper takes in one go (<= `most` s), each cut at the quietest 0.1 s after `least` s"""
    n, fr, cuts = len(voc), SR // 10, [0]
    while cuts[-1] + most * SR < n:
        s, e = cuts[-1] + int(least * SR), cuts[-1] + int(most * SR)
        rms = np.sqrt(np.mean(voc[s:e - (e - s) % fr].reshape(-1, fr) ** 2, 1))
        cuts.append(s + int(np.argmin(rms)) * fr + fr // 2)
    return list(zip(cuts, cuts[1:] + [n]))


def transcribe(voc, device, lang=None, model='turbo', progress_stage='transcribe'):
    """[(word, a, b)] from the vocal stem: piece by piece (long-form chunking in transformers crashes with word times)"""
    import torch
    from transformers import pipeline
    d = dev_name(device); cuda = d == 'cuda'
    asr = pipeline('automatic-speech-recognition', model=WHISPER_MODELS[model], dtype=torch.float16 if cuda else torch.float32,
                   device=device if d in ('cuda', 'xpu', 'cpu') else 'cpu')
    gen = {'task': 'transcribe', 'num_beams': 1, **({'language': lang} if lang else {})}
    loud = np.sqrt(np.mean(voc ** 2)) + 1e-9
    # Full large-v3 word timestamps retain cross-attention; 28 s can exhaust a 10 GB GPU.
    words, ws = [], (windows(voc, most=12.0, least=8.0) if model == 'large-v3' else windows(voc))
    for k, (s, e) in enumerate(ws):
        stage(progress_stage, k, len(ws))
        x = voc[s:e]
        if np.sqrt(np.mean(x ** 2)) < 0.08 * loud: continue  # no singing here: Whisper would make something up
        out = asr({'raw': x, 'sampling_rate': SR}, return_timestamps='word', generate_kwargs=gen)
        if HALLUCINATIONS.search(out.get('text') or ''): continue
        chunk_start = len(words)
        for c in out.get('chunks') or []:
            w = (c.get('text') or '').strip(); a, b = (c.get('timestamp') or (None, None))
            if not w or a is None: continue
            if (len(words) > chunk_start and w[0] in '-–' and not w.startswith('--')
                    and words[-1][2] is not None and words[-1][1] <= s / SR + float(a)
                    and abs(s / SR + float(a) - words[-1][2]) <= 0.15):  # adjacent «А», «-а», «-а»: one word
                words[-1][0] += w; words[-1][2] = s / SR + float(b if b is not None else a + 0.3); continue
            words.append([w, s / SR + float(a), s / SR + float(b) if b is not None else None])
    for k, w in enumerate(words):  # whisper leaves some ends open
        if w[2] is None or w[2] <= w[1]: w[2] = min(w[1] + 0.4, words[k + 1][1]) if k + 1 < len(words) else w[1] + 0.4
    del asr; torch.cuda.empty_cache() if cuda else None
    return words


def words_to_lines(words, gap=0.6, most=9):
    """break on a pause, after . ! ? (or , once the line is long enough), and at `most` words"""
    lines, cur = [], []
    def flush():
        if cur: lines.append({'t': round(cur[0][1], 3), 'end': round(cur[-1][2], 3), 'text': ' '.join(w for w, _, _ in cur), 'tr': '',
                              'sync': {'orig': [{'a': round(a, 3), 'b': round(b, 3), 'g': 1} for _, a, b in cur]}})
        cur.clear()
    for w in words:
        if cur and (w[1] - cur[-1][2] > gap or cur[-1][0][-1:] in '.!?…' or (cur[-1][0][-1:] in ',;:' and len(cur) >= 4)): flush()
        elif len(cur) >= most:  # too long: cut in its second half after a comma, else at the longest pause
            k = max(range(len(cur) // 2, len(cur)), key=lambda j: (cur[j - 1][0][-1:] in ',;:', cur[j][1] - cur[j - 1][2]))
            tail = cur[k:]; del cur[k:]; flush(); cur.extend(tail)
        cur.append(w)
    flush()
    for ln in lines:  # lyrics style: no trailing comma / period at the end of a line
        ln['text'] = re.sub(r'[,.;:]+$', '', ln['text'])
    return lines


def backing_candidates(words, lines):
    """Review-only phrases from the backing stem, limited to the requested line windows."""
    def norm(text): return re.sub(r'[^\w]+', ' ', text.replace('|', '').casefold()).strip()
    out = []
    for ln in words_to_lines(words):
        if lines and not any(ln['t'] < l['end'] and l['t'] < ln['end'] for l in lines): continue
        if any(norm((l.get('bg') or {}).get('text', '')) == norm(ln['text'])
               and ln['t'] < l['end'] and l['t'] < ln['end'] for l in lines): continue
        out.append({'t': ln['t'], 'end': ln['end'], 'text': '', 'tr': '', 'bg': {'text': ln['text'], 'tr': ''},
                    'sync': {'bgo': [{**w, 'g': 1} for w in ln['sync']['orig']]}})
    return out


# ---- attacks in the vocal stem: spectral flux (same idea as the editor's magnet) ----
def flux_onsets(x, sr=SR):
    n, hop = 512, sr // 100
    if len(x) < n: return np.zeros(0)
    fr = np.lib.stride_tricks.sliding_window_view(x, n)[::hop] * np.hanning(n)
    mag = np.log10(1e-10 + np.abs(np.fft.rfft(fr, axis=1)) ** 2) * 10
    lo, hi = int(60 * n / sr), int(8000 * n / sr)
    d = np.r_[0, np.maximum(0, np.diff(mag[:, lo:hi], axis=0)).mean(1)]
    w, gap, out, last = 50, 8, [], -8
    cs = np.r_[0, np.cumsum(d)]
    for i in range(1, len(d) - 1):
        if d[i] < d[i - 1] or d[i] <= d[i + 1] or i - last < gap: continue
        a, b = max(0, i - w), min(len(d), i + w)
        if d[i] > 1.5 * (cs[b] - cs[a]) / (b - a) + 0.6: out.append((i * hop + n / 2) / sr); last = i
    return np.array(out)


def snap_starts(project, onsets, win, shift=0.0):
    """auto word starts (g) move to the nearest attack within win s; then everything auto shifts by `shift` s"""
    if not len(onsets) and not shift: return
    for ln in project['lines']:
        for layer in ('orig', 'bgo'):
            if (ln.get('approved') or {}).get(layer): continue
            for x in (ln.get('sync') or {}).get(layer) or []:
                if not x or not x.get('g') or x.get('a') is None: continue
                a = x['a']
                if win and len(onsets):
                    k = int(np.searchsorted(onsets, a)); c = [onsets[j] for j in (k - 1, k) if 0 <= j < len(onsets)]
                    o = min(c, key=lambda v: abs(v - a)) if c else None
                    if o is not None and abs(o - a) <= win: a = float(o)
                x['a'] = round(max(0.0, a + shift), 3); x['b'] = round(max(x['b'] + shift, x['a'] + MIN_W), 3)


# ---- project ----
def fill(project, aligned_for, force=False):
    """aligned_for(i, line, layer, text) -> [(a,b)] | None. Returns {layer: [abs start errors vs old hand marks]}"""
    errs = {'orig': [], 'bgo': []}
    for i, ln in enumerate(project['lines']):
        for layer in ('orig', 'bgo'):
            text = layer_text(ln, layer); n = len(units(text))
            cur = (ln.get('sync') or {}).get(layer)
            if not needs_alignment(ln, layer, force): continue
            got = aligned_for(i, ln, layer, text)
            if not got: continue
            if hand_done(cur, n): errs[layer] += [abs(g[0] - c['a']) for g, c in zip(got, cur)]  # g: (a, b[, confidence])
            keep = cur if isinstance(cur, list) and len(cur) == n and not force else [None] * n
            new = [k if k and not k.get('g') and k.get('a') is not None and k.get('b') is not None
                   else {'a': g[0], 'b': g[1], 'g': 1, **({'c': g[2]} if len(g) > 2 and g[2] is not None else {})} for k, g in zip(keep, got)]
            ln['sync'] = {**(ln.get('sync') or {}), layer: new}
    return errs



def untangle(project):
    """Repair auto spans within each independent line/layer; hand and approved spans never move."""
    for ln in project['lines']:
        for layer in ('orig', 'bgo'):
            if (ln.get('approved') or {}).get(layer): continue
            seq = [x for x in ((ln.get('sync') or {}).get(layer) or [])
                   if x and x.get('a') is not None and x.get('b') is not None]
            for i, x in enumerate(seq):
                if not x.get('g'): continue
                old = (x['a'], x['b'])
                min_w = min(MIN_W, max(.001, x['b'] - x['a']))
                if i: x['a'] = round(max(x['a'], seq[i - 1]['b']), 3)
                if i + 1 < len(seq) and seq[i + 1]['a'] >= x['a'] + min_w: x['b'] = min(x['b'], seq[i + 1]['a'])
                x['b'] = round(max(x['b'], x['a'] + min_w), 3)
                if (x['a'], x['b']) != old: x['c'] = 0.0


def report(project):
    """overlaps the way qaCheck sees them (inside a line; a line starting >50 ms before the previous ends) + stats"""
    L, r, prev, d = project['lines'], {'overlaps': 0, 'short': 0, 'past_next_lrc': 0}, None, []
    for i, ln in enumerate(L):
        for layer in ('orig', 'bgo'):
            s = (ln.get('sync') or {}).get(layer) or []
            r['overlaps'] += sum(int(s[k]['a'] < s[k - 1]['b'] - 0.002) for k in range(1, len(s)))
            r['short'] += sum(int(x['b'] - x['a'] < 0.08) for x in s)
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
    ap.add_argument('--device', default='auto', help='auto | cuda | xpu | dml | cpu (auto: NVIDIA > Intel Arc > DirectML > CPU)')
    ap.add_argument('--lang', choices=list(MODELS), help='default: per line by alphabet')
    ap.add_argument('--model', help='HF wav2vec2 CTC model instead of the per-language default')
    ap.add_argument('--pad', type=float, default=1.5, help='s of slack around LRC t..end (default 1.5)')
    ap.add_argument('--no-separation', action='store_true', help='align on the mix as is (a cappella / tests)')
    ap.add_argument('--separate-only', action='store_true', help='extract vocals and return the unchanged project; no ASR or alignment')
    ap.add_argument('--vocal-file', help='existing local vocal stem; never run separation when supplied')
    ap.add_argument('--no-karaoke', action='store_true', help='skip lead/backing split')
    ap.add_argument('--force', action='store_true', help='re-align hand-marked layers too and print error vs them')
    ap.add_argument('--json-progress', action='store_true', help='stdout: one JSON object per line (for the editor server)')
    ap.add_argument('--sep', choices=['htdemucs', 'roformer'], default='htdemucs', help='vocal separator')
    ap.add_argument('--transcribe', action='store_true', help='write the lyrics from the voice (Whisper) first; on by itself when the project has no lines')
    ap.add_argument('--locate-lines', action='store_true', help='find known lyrics in ASR before fine alignment; skip unsupported lines rather than guess')
    ap.add_argument('--asr', choices=list(WHISPER_MODELS), default='turbo', help='Whisper model for lyrics and backing recognition')
    ap.add_argument('--detect-back', action='store_true', help='recognize new backing phrases; return review candidates, do not insert them')
    ap.add_argument('--song-lang', help='language of the song for --transcribe (ru, en…); default: detect')
    ap.add_argument('--aligner', choices=['w2v', 'mms'], default='w2v', help='w2v: wav2vec2 xlsr per language; mms: torchaudio MMS-FA (multilingual)')
    ap.add_argument('--bg-aligner', choices=['w2v', 'mms'], default='mms', help='aligner for backing vocals (default mms: bench.py median 416 -> 137 ms on «Пальма»)')
    ap.add_argument('--snap', type=float, default=0.0, help='s: move auto word starts to the nearest attack of the vocal stem within this window')
    ap.add_argument('--shift', type=float, default=0.0, help='s added to every auto word (constant model delay)')
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
    dev = pick_device(a.device)
    def stage_emit(**k): stage(k.pop('stage'), **k) if 'stage' in k else emit(**k)
    emit(stage='device', device=dev_name(dev), done=0, total=0)
    PROG['emit'] = emit; hook_tqdm()
    with open(a.project, encoding='utf-8') as f: proj = json.load(f)
    if 'lines' not in proj: raise ValueError('not a Spicy Translate project (no lines)')
    vocal_file = getattr(a, 'vocal_file', None)
    separate_only = bool(getattr(a, 'separate_only', False))
    if vocal_file and not os.path.isfile(vocal_file): raise ValueError('vocal file does not exist')
    if separate_only:
        if a.no_separation: raise ValueError('--separate-only cannot use --no-separation')
        emit(plan=[] if vocal_file else ['demucs'])
        work = os.path.abspath(os.path.splitext(a.out)[0] + '.stems')
        if vocal_file: vpath = os.path.abspath(vocal_file)
        else: _, _, vpath = separate(a.audio, work, dev, False, stage_emit, a.sep)
        # Preserve every project field, including empty lyrics, timings and review candidates.
        with open(a.out, 'w', encoding='utf-8') as f: json.dump(proj, f, ensure_ascii=False, indent=1)
        emit(done=True, device=dev_name(dev), out=os.path.abspath(a.out), vocals=vpath)
        return
    tr = a.transcribe or not proj['lines']
    locate = bool(getattr(a, 'locate_lines', False)) and not tr
    if a.detect_back and (a.no_separation or a.no_karaoke or vocal_file): raise ValueError('для поиска бэков нужно отдельное разделение вокала и бэка; готовая дорожка вокала его не содержит')
    karaoke = not a.no_karaoke and (not tr or a.detect_back)
    source_lines = list(proj['lines'])
    emit(plan=[s for s, on in (('demucs', not a.no_separation and not vocal_file), ('karaoke', not a.no_separation and karaoke and not vocal_file), ('transcribe', tr), ('locate', locate), ('backing', a.detect_back), ('align', True)) if on])
    work = os.path.abspath(os.path.splitext(a.out)[0] + '.stems')
    if vocal_file: voc, back, vpath = decode(vocal_file)[0], None, os.path.abspath(vocal_file)
    elif a.no_separation: voc, back, vpath = decode(a.audio)[0], None, None
    else: voc, back, vpath = separate(a.audio, work, dev, karaoke, stage_emit, a.sep)
    if tr:  # no lyrics: Whisper writes them, the aligner below then times every word precisely
        stage('transcribe', 0, 1)
        lead_path = os.path.join(work, 'lead' + ('' if a.sep == 'htdemucs' else '-' + a.sep) + '.wav')
        lead = decode(lead_path)[0] if a.detect_back and os.path.exists(lead_path) else voc
        proj['lines'] = words_to_lines(transcribe(lead, dev, a.song_lang, a.asr)); a.force = True
        stage('transcribe', 1, 1, lines=len(proj['lines']))
        if not proj['lines']: raise ValueError('в голосе не нашлось слов')
    located = None
    if locate:
        stage('locate', 0, 1)
        recognized = transcribe(voc, dev, a.song_lang, a.asr, 'locate')
        located = locate_line_windows(proj['lines'], [{'word': w, 'a': start, 'b': end} for w, start, end in recognized])
        missing = [str(i + 1) for i, ln in enumerate(proj['lines']) if needs_alignment(ln, 'orig', a.force) and i not in located]
        if missing:
            proj.setdefault('warnings', []).append('Не найдено надёжных опор для строк: ' + ', '.join(missing) + '. Их тайминги не изменены. Проверь текст и повторы припева.')
        stage('locate', 1, 1, lines=len(located))
    if a.detect_back:
        stage('backing', 0, 1)
        if back is None:
            proj.setdefault('warnings', []).append('Не удалось выделить отдельную дорожку бэков. Новые бэки не распознавались; существующие строки обработаны.')
            proj['backingCandidates'] = []
        else:
            # The separator leaks lead vocals; candidates stay outside lines[] until reviewed.
            try: proj['backingCandidates'] = backing_candidates(transcribe(back, dev, a.song_lang, a.asr, 'backing'), source_lines)
            except Exception as e:
                proj.setdefault('warnings', []).append(f'Распознавание новых бэков не удалось: {type(e).__name__}: {e}')
                proj['backingCandidates'] = []
        stage('backing', 1, 1, candidates=len(proj['backingCandidates']))
    al, total = Aligner(dev, a.model, a.aligner), len(proj['lines'])
    bal = al if a.bg_aligner == a.aligner else Aligner(dev, None, a.bg_aligner)  # backing vocals: its own model
    nonlocal_bal = [bal]

    def aligned_for(i, ln, layer, text):
        if located is not None and i not in located:
            return None
        t, end = located[i] if located is not None else (float(ln['t']), float(ln.get('end') or ln['t'] + 10))
        src = voc
        if layer == 'bgo' and back is not None:
            w = slice(max(0, int((t - a.pad) * SR)), int((end + a.pad) * SR))
            if np.sqrt(np.mean(back[w] ** 2)) >= BACK_MIN * np.sqrt(np.mean(voc[w] ** 2) + 1e-12): src = back
        print(f'\r{i + 1}/{total} {layer}', end='', file=sys.stderr); stage('align', i, total)
        args = (src, t - a.pad, end + a.pad, text, a.lang or lang_of(text), (t, end))
        if layer == 'bgo' and nonlocal_bal[0] is not al:
            try: return nonlocal_bal[0].align(*args)
            except Exception as e:  # MMS can't load (no internet on the first run, old torchaudio): the lead model does backing too
                print(f'backing aligner failed ({type(e).__name__}: {e}); using the lead one', file=sys.stderr); nonlocal_bal[0] = al
        return (nonlocal_bal[0] if layer == 'bgo' else al).align(*args)

    errs = fill(proj, aligned_for, a.force)
    if tr:  # lines Whisper made: their ends follow their (now precisely aligned) words
        for ln in proj['lines']:
            ws = [x for x in (ln.get('sync') or {}).get('orig') or [] if x and x.get('a') is not None]
            if ws: ln['t'], ln['end'] = ws[0]['a'], ws[-1]['b']
    snap_starts(proj, flux_onsets(voc) if a.snap else np.zeros(0), a.snap, a.shift)
    untangle(proj)
    print(file=sys.stderr)
    with open(a.out, 'w', encoding='utf-8') as f: json.dump(proj, f, ensure_ascii=False, indent=1)
    for layer, e in errs.items():
        if e: print(f'{layer}: {len(e)} words, start error median {np.median(e) * 1000:.0f} ms, p90 {np.percentile(e, 90) * 1000:.0f} ms, <=200ms {np.mean(np.array(e) <= 0.2) * 100:.0f}%')
    rep = report(proj)
    print('written', a.out, json.dumps(rep))
    emit(stage='align', done=total, total=total)
    # device: where it really ran (a GPU stage may have fallen back to the CPU)
    emit(done=True, device=dev_name(al.device), out=os.path.abspath(a.out), vocals=vpath, overlaps=rep['overlaps'])


if __name__ == '__main__':
    main()
