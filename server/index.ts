#!/usr/bin/env node
// Spicy Translate: local server + MCP (stdio), zero runtime dependencies (Node >= 22.18 runs .ts directly).
//   node server/index.ts          -> MCP over stdio AND http://127.0.0.1:8787 (the editor, live-linked)
//   node server/index.ts --http   -> only the HTTP editor (no MCP)
// The editor polls /api/project, so whatever the agent changes appears there within ~1.5 s,
// and whatever you do in the editor is what the agent reads back.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import * as C from '../src/core/index.ts';
import type { Layer, Mode, Project } from '../src/core/index.ts';

// desktop app (single exe): the bundle runs as CommonJS, paths come from SPICY_ROOT / SPICY_HTML / SPICY_DIR
const root = process.env.SPICY_ROOT || path.resolve(path.dirname(typeof __filename === 'string' ? __filename : fileURLToPath(import.meta.url)), '..');
const PORT = +(process.env.SPICY_PORT || 0) || 8787;
const DATA = process.env.SPICY_DIR || root;
const FILE = path.join(DATA, 'spicy-project.json');
const htmlPath = process.env.SPICY_HTML || path.join(root, 'dist', 'index.html');

/* ---------- state ---------- */
fs.mkdirSync(path.dirname(FILE), { recursive: true });
type State = { rev: number; by: string; project: Project | null };
let state: State = { rev: 0, by: 'init', project: null };
try { state = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
let remote = false; // true when another instance already owns the port -> proxy to it
const base = `http://127.0.0.1:${PORT}/api/project`;
async function getState(): Promise<State> {
  if (!remote) return state;
  try { return await (await fetch(base)).json(); }
  catch { if (await takeOver()) return state; throw new Error('редактор (сервер на порту ' + PORT + ') закрыт'); } // the owner left: take the port
}
async function putProject(project: Project, by: string) {
  if (remote) { try { return await (await fetch(base + '?by=' + by, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(project) })).json(); } catch { if (!await takeOver()) throw new Error('сервер редактора недоступен'); } }
  state = { rev: state.rev + 1, by, project }; fs.writeFileSync(FILE, JSON.stringify(state)); return { rev: state.rev };
}

/* ---------- auto-timing: runs the experiments/auto-align prototype (Python) on the uploaded audio ---------- */
// Where the prototype and its Python live: SPICY_ALIGN_DIR / SPICY_ALIGN_PY, else experiments/auto-align of this repo
// with its .venv or the private Python (pyHome). Old copies in .claude/worktrees are never used: they ran stale code.
function alignEnv(): { dir: string; py: string } | null {
  const pyIn = (d: string) => [path.join(d, '.venv', 'Scripts', 'python.exe'), path.join(d, '.venv', 'bin', 'python')].find(f => fs.existsSync(f))
    || (SETUP.done || fs.existsSync(path.join(pyHome(), '.ready')) ? pyExe() : undefined); // the private Python installed from the editor
  const dirs = [process.env.SPICY_ALIGN_DIR, path.join(root, 'experiments', 'auto-align')];
  for (const d of dirs) {
    if (!d || !fs.existsSync(path.join(d, 'align.py'))) continue;
    const py = process.env.SPICY_ALIGN_PY || pyIn(d); if (py) return { dir: d, py };
  }
  return null;
}
/* ---------- one-click install of auto-timing: a private Python in SPICY_DIR/python, nothing system-wide ---------- */
// python-build-standalone (portable CPython) -> pip: a PyTorch build for the GPU that is there (NVIDIA: CUDA by driver
// version, Intel Arc: XPU, AMD / other: DirectML, else CPU), the prototype's requirements, imageio-ffmpeg (its
// ffmpeg.exe is copied next to python.exe, which goes first on PATH for align.py).
// the browser launcher keeps its data in the repo; the desktop app installs into %LOCALAPPDATA%: one install serves both
const APP_PY = process.platform === 'win32' && process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'dev.spicytranslate.editor', 'python') : '';
const pyHome = () => { const own = path.join(DATA, 'python'); return !fs.existsSync(path.join(own, '.ready')) && APP_PY && fs.existsSync(path.join(APP_PY, '.ready')) ? APP_PY : own; };
const pyExe = () => path.join(pyHome(), process.platform === 'win32' ? 'python.exe' : path.join('bin', 'python3'));
type Backend = 'cuda' | 'xpu' | 'dml' | 'cpu';
const SETUP = { running: false, step: '', pct: 0, error: '', done: false, backend: '' as Backend | '', file: '', got: 0, size: 0, log: [] as string[], child: null as ReturnType<typeof spawn> | null, abort: null as AbortController | null, cancel: false };
const readyInfo = (): { backend?: Backend; at?: string } | null => { try { const t = fs.readFileSync(path.join(pyHome(), '.ready'), 'utf8'); return t.trim().startsWith('{') ? JSON.parse(t) : { at: t }; } catch { return null; } };
const run = (cmd: string, args: string[], onLine: (l: string) => void, env: NodeJS.ProcessEnv = process.env) => new Promise<void>((res, rej) => {
  const p = spawn(cmd, args, { env, windowsHide: true }); let buf = ''; SETUP.child = p;
  const eat = (d: Buffer) => { buf += d; const parts = buf.split(/\r?\n|\r/); buf = parts.pop() || ''; parts.forEach(l => { if (l.trim()) onLine(l.trim()); }); };
  p.stdout!.on('data', eat); p.stderr!.on('data', eat);
  p.on('error', rej); p.on('close', code => { SETUP.child = null; if (SETUP.cancel) rej(new Error('отменено')); else if (code) rej(new Error(`${path.basename(cmd)} ${args[0]} → код ${code}: ${SETUP.log.slice(-3).join(' | ')}`)); else res(); });
});
const out1 = (cmd: string, args: string[]) => new Promise<string>(r => { let o = ''; const p = spawn(cmd, args, { windowsHide: true }); p.stdout.on('data', d => o += d); p.on('error', () => r('')); p.on('close', () => r(o)); });
/** what GPU is there and which PyTorch build fits it */
async function detectGpu() {
  const names = (await out1('powershell', ['-NoProfile', '-Command', '(Get-CimInstance Win32_VideoController).Name'])).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  // nvidia-smi says "CUDA Version: 12.8" (older drivers) or "CUDA UMD Version: 13.4" (newer); else infer from the driver
  const smi = await out1('nvidia-smi', []), cv = smi.match(/CUDA (?:UMD )?Version\s*:\s*(\d+)\.(\d+)/i);
  const drv = +((smi.match(/(?:Driver|KMD) Version\s*:\s*(\d+)/i) || [])[1] || 0);
  const cuda = cv ? +cv[1] + +cv[2] / 10 : drv >= 572 ? 12.8 : drv >= 560 ? 12.6 : drv >= 551 ? 12.4 : drv >= 522 ? 11.8 : 0;
  // PyTorch wheels per CUDA: cu128 needs a 12.8+ driver (and is the only one for RTX 50xx), older drivers get older builds
  const cu = cuda >= 12.8 ? 'cu128' : cuda >= 12.6 ? 'cu126' : cuda >= 12.4 ? 'cu124' : cuda >= 11.8 ? 'cu118' : '';
  const nv = names.find(n => /nvidia/i.test(n)), arc = names.find(n => /intel.*arc/i.test(n)), amd = names.find(n => /amd|radeon/i.test(n));
  const pick: { backend: Backend; why: string } = nv && cu ? { backend: 'cuda', why: `${nv} → CUDA (${cu}, драйвер CUDA ${cuda.toFixed(1)})` }
    : arc ? { backend: 'xpu', why: `${arc} → Intel XPU` }
    : amd ? { backend: 'dml', why: `${amd} → DirectML (Demucs на процессоре)` }
    : nv ? { backend: 'cpu', why: `${nv}: драйвер слишком старый для CUDA (обнови драйвер) → процессор` }
    : { backend: 'cpu', why: 'подходящей видеокарты нет → процессор' };
  return { names, cuda, cu: cu || 'cu124', ...pick };
}
const TORCH: Record<Backend, (cu: string) => string[]> = {
  cuda: cu => ['torch', 'torchaudio', '--index-url', `https://download.pytorch.org/whl/${cu}`],
  xpu: () => ['torch', 'torchaudio', '--index-url', 'https://download.pytorch.org/whl/xpu'],
  dml: () => ['torch-directml', 'torchaudio==2.4.1'], // torch-directml pins torch 2.4.1
  cpu: () => ['torch', 'torchaudio', '--index-url', 'https://download.pytorch.org/whl/cpu'],
};
function dirSize(d: string): number { let n = 0; try { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); n += e.isDirectory() ? dirSize(f) : fs.statSync(f).size; } } catch {} return n; }
async function setupAlign(want?: Backend) {
  if (process.platform !== 'win32') throw new Error('установка в один клик пока только для Windows — см. experiments/auto-align/README.md');
  const step = (s: string, pct: number) => Object.assign(SETUP, { step: s, pct });
  const log = (l: string) => { SETUP.log.push(l); if (SETUP.log.length > 60) SETUP.log.shift(); };
  const gpu = await detectGpu(), backend = want || gpu.backend; SETUP.backend = backend;
  fs.mkdirSync(DATA, { recursive: true });
  if (!fs.existsSync(pyExe())) {
    step('Python: ищу сборку', 1);
    const rel = await (await fetch('https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest', { headers: { 'user-agent': 'spicy-translate' } })).json();
    const asset = (rel.assets || []).find((a: { name: string }) => /^cpython-3\.12\.\d+\+\d+-x86_64-pc-windows-msvc-install_only\.tar\.gz$/.test(a.name));
    if (!asset) throw new Error('не нашёл сборку Python 3.12 для Windows в python-build-standalone');
    SETUP.abort = new AbortController();
    const tgz = path.join(DATA, 'python.tar.gz'), r = await fetch(asset.browser_download_url, { signal: SETUP.abort.signal });
    if (!r.ok || !r.body) throw new Error('скачивание Python: HTTP ' + r.status);
    const total = +(r.headers.get('content-length') || 0), f = fs.createWriteStream(tgz); let got = 0;
    Object.assign(SETUP, { file: asset.name, size: total, got: 0 });
    for await (const ch of r.body as unknown as AsyncIterable<Uint8Array>) { f.write(ch); got += ch.length; SETUP.got = got; if (total) step('Python: скачиваю', 1 + Math.round(got / total * 7)); }
    await new Promise(res => f.end(res)); SETUP.abort = null;
    step('Python: распаковываю', 8); Object.assign(SETUP, { file: '', got: 0, size: 0 });
    await run(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xzf', tgz, '-C', DATA], log); // the archive holds python/
    fs.rmSync(tgz, { force: true });
  }
  const units: Record<string, number> = { kB: 1e3, MB: 1e6, GB: 1e9 };
  const pip = (args: string[], label: string, from: number, to: number) => run(pyExe(), ['-m', 'pip', ...args, '--progress-bar', 'raw', '--disable-pip-version-check'], l => {
    log(l);
    const d = l.match(/^Downloading (\S+?)(?: \((\d+(?:\.\d+)?) (kB|MB|GB)\))?$/); if (d) Object.assign(SETUP, { file: d[1].split('/').pop(), size: d[2] ? +d[2] * units[d[3]] : 0, got: 0 });
    const m = l.match(/Progress (\d+) of (\d+)/); if (m) { SETUP.got = +m[1]; SETUP.size = +m[2]; step(label, Math.round(from + (to - from) * (+m[1] / +m[2]))); }
  });
  step('pip', 9); await run(pyExe(), ['-m', 'pip', 'install', '--upgrade', 'pip', '--disable-pip-version-check'], log);
  const label = { cuda: `PyTorch для NVIDIA (${gpu.cu})`, xpu: 'PyTorch для Intel Arc', dml: 'PyTorch + DirectML', cpu: 'PyTorch для процессора' }[backend];
  step(label, 10); await pip(['install', ...TORCH[backend](gpu.cu)], label, 10, 75);
  const req = path.join(process.env.SPICY_ALIGN_DIR || path.join(root, 'experiments', 'auto-align'), 'requirements.txt');
  step('Demucs, wav2vec2, karaoke', 76); await pip(['install', '-r', req, 'imageio-ffmpeg'], 'Demucs, wav2vec2, karaoke', 76, 96);
  step('ffmpeg', 97); Object.assign(SETUP, { file: '', got: 0, size: 0 });
  let ff = ''; await run(pyExe(), ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'], l => { ff = l; });
  if (ff && fs.existsSync(ff)) fs.copyFileSync(ff, path.join(pyHome(), 'ffmpeg.exe'));
  fs.writeFileSync(path.join(pyHome(), '.ready'), JSON.stringify({ backend, at: new Date().toISOString(), gpu: gpu.why }));
  step('готово', 100); SETUP.done = true;
}
/** bump when the editor needs new server endpoints (3: auto-timing install / GPU / open folder) */
const API = 9; // 4: /api/yield, --auto-exit, /api/bye · 5: /api/genius · 6: /api/genius/writers · 7: + album · 8: auto-timing transcribe / cancel / stage progress · 9: shared Python, no worktree prototypes
/* ---------- Genius (lyrics makers take the text from there). No CORS for pages, so the server fetches them. ---------- */
const GH = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', 'accept-language': 'en-US,en;q=0.9' };
type GeniusHit = { id: number; title: string; artist: string; url: string; art: string };
async function geniusSearch(q: string): Promise<GeniusHit[]> {
  const r = await fetch('https://genius.com/api/search/song?per_page=10&q=' + encodeURIComponent(q), { headers: GH });
  if (!r.ok) throw new Error('Genius HTTP ' + r.status);
  const j = await r.json() as { response?: { sections?: { hits?: { result: any }[] }[] } };
  return (j.response?.sections?.[0]?.hits || []).map(({ result: s }) => ({ id: s.id, title: s.title, artist: s.primary_artist?.name || s.artist_names || '', url: s.url, art: s.song_art_image_thumbnail_url || '' }));
}
async function geniusText(url: string) {
  if (!/^https:\/\/genius\.com\/[\w%.-]+-lyrics$/.test(url)) throw new Error('нужна ссылка на песню genius.com/…-lyrics');
  const r = await fetch(url, { headers: GH }); if (!r.ok) throw new Error('Genius HTTP ' + r.status);
  const text = C.geniusLyrics(await r.text(), true); if (!text) throw new Error('на странице нет текста (инструментал или Genius поменял вёрстку)');
  return text;
}
/** songwriters (Genius «Written By») and album of a song by its Genius id */
async function geniusWriters(id: string): Promise<{ writers: string[]; album: string }> {
  if (!/^\d+$/.test(id)) throw new Error('нужен id песни Genius');
  const r = await fetch('https://genius.com/api/songs/' + id, { headers: GH }); if (!r.ok) throw new Error('Genius HTTP ' + r.status);
  const s = (await r.json() as { response?: { song?: { writer_artists?: { name: string }[]; album?: { name?: string } | null } } }).response?.song;
  return { writers: (s?.writer_artists || []).map(a => a.name), album: s?.album?.name || '' };
}
const AL = { running: false, stage: '', done: 0, total: 0, error: '', out: '', vocals: '', audio: '', device: '', log: [] as string[],
  plan: [] as string[], sub: '', subDone: 0, subTotal: 0, bytes: false, t0: 0, child: null as ReturnType<typeof spawn> | null, cancel: false };
const alDir = () => { const d = path.join(DATA, 'align'); fs.mkdirSync(d, { recursive: true }); return d; };
function readBody(req: http.IncomingMessage): Promise<Buffer> { return new Promise((res, rej) => { const ch: Buffer[] = []; req.on('data', c => ch.push(c)); req.on('end', () => res(Buffer.concat(ch))); req.on('error', rej); }); }
const json = (res: http.ServerResponse, o: unknown, code = 200) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
async function alignRoute(req: http.IncomingMessage, res: http.ServerResponse, u: URL) {
  if (u.pathname === '/api/align/audio' && req.method === 'POST') { // the page uploads its audio once per track
    const ext = (u.searchParams.get('ext') || 'mp3').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'mp3';
    AL.audio = path.join(alDir(), 'audio.' + ext); fs.writeFileSync(AL.audio, await readBody(req));
    fs.rmSync(path.join(alDir(), 'out.spicy.stems'), { recursive: true, force: true }); // the prototype caches stems next to its output (OUT minus .json + .stems): new audio = new stems
    AL.vocals = '';
    return json(res, { ok: true, bytes: fs.statSync(AL.audio).size });
  }
  if (u.pathname === '/api/align' && req.method === 'POST') {
    if (AL.running) return json(res, { error: 'уже идёт' }, 409);
    const env = alignEnv();
    if (!env) return json(res, { error: 'авто-тайминг не установлен — нажми «Установить авто-тайминг» (или поставь по experiments/auto-align/README.md, SPICY_ALIGN_DIR / SPICY_ALIGN_PY)' }, 501);
    if (!AL.audio || !fs.existsSync(AL.audio)) return json(res, { error: 'сначала загрузи аудио' }, 400);
    const inp = path.join(alDir(), 'in.spicy.json'), out = path.join(alDir(), 'out.spicy.json');
    fs.writeFileSync(inp, await readBody(req)); try { fs.unlinkSync(out); } catch {}
    Object.assign(AL, { running: true, stage: 'start', done: 0, total: 0, error: '', out: '', vocals: '', device: '', log: [], plan: [], sub: '', subDone: 0, subTotal: 0, bytes: false, t0: Date.now(), cancel: false });
    // options from the editor, whitelisted: transcribe (no lyrics yet), separator, aligner, snap to attacks
    const q = u.searchParams, opt: string[] = [];
    if (q.get('transcribe') === '1') opt.push('--transcribe');
    if (/^(ru|en|uk|de|fr|es|it|pt|ja|ko|zh)$/.test(q.get('lang') || '')) opt.push('--song-lang', q.get('lang')!);
    if (/^(htdemucs|roformer)$/.test(q.get('sep') || '')) opt.push('--sep', q.get('sep')!);
    if (/^(w2v|mms)$/.test(q.get('aligner') || '')) opt.push('--aligner', q.get('aligner')!);
    const p = spawn(env.py, [path.join(env.dir, 'align.py'), AL.audio, inp, '-o', out, '--json-progress', ...opt], { cwd: env.dir, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8', PATH: path.dirname(env.py) + path.delimiter + (process.env.PATH || '') } });
    let buf = '';
    p.stdout.on('data', d => {
      buf += d; let k;
      while ((k = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, k).trim(); buf = buf.slice(k + 1); if (!line.startsWith('{')) continue;
        try {
          const m = JSON.parse(line); if (m.error) AL.error = m.error; if (m.device) AL.device = m.device; if (Array.isArray(m.plan)) AL.plan = m.plan;
          if (m.sub !== undefined) Object.assign(AL, { stage: m.stage || AL.stage, sub: String(m.sub), subDone: +m.sub_done || 0, subTotal: +m.sub_total || 0, bytes: !!m.bytes });
          else if (m.stage) Object.assign(AL, { stage: m.stage, done: m.done || 0, total: m.total || 0, sub: '', subDone: 0, subTotal: 0 });
          if (m.done === true) Object.assign(AL, { out: m.out || out, vocals: m.vocals || '' });
        } catch {}
      }
    });
    p.stderr.on('data', d => { AL.log.push(String(d)); if (AL.log.length > 40) AL.log.shift(); });
    AL.child = p;
    p.on('error', e => { AL.running = false; AL.error = e.message; });
    p.on('close', code => { AL.running = false; AL.child = null; if (AL.cancel) AL.error = 'отменено'; if (code && !AL.error) AL.error = `align.py завершился с кодом ${code}: ${AL.log.join('').slice(-400)}`; if (!AL.out && fs.existsSync(out)) AL.out = out; });
    return json(res, { ok: true });
  }
  if (u.pathname === '/api/align/gpu') return json(res, process.platform === 'win32' ? await detectGpu() : { names: [], backend: 'cpu', why: 'не Windows' });
  if (u.pathname === '/api/align/setup' && req.method === 'POST') {
    const body = JSON.parse(String(await readBody(req)) || '{}'), want = ['cuda', 'xpu', 'dml', 'cpu'].includes(body.backend) ? body.backend as Backend : undefined;
    if (!SETUP.running && !AL.running) {
      if (body.reinstall) fs.rmSync(pyHome(), { recursive: true, force: true }); // switch the GPU build: start clean
      Object.assign(SETUP, { running: true, error: '', done: false, cancel: false, step: 'старт', pct: 0, log: [], file: '', got: 0, size: 0 });
      setupAlign(want).catch(e => { SETUP.error = String(e?.message || e); }).finally(() => { SETUP.running = false; SETUP.child = null; SETUP.abort = null; });
    }
  }
  if (u.pathname === '/api/align/setup' && req.method === 'DELETE') { // remove the private Python (several GB)
    if (SETUP.running) { SETUP.cancel = true; SETUP.child?.kill(); SETUP.abort?.abort(); return json(res, { ok: true, cancelled: true }); }
    if (AL.running) return json(res, { error: 'идёт авто-тайминг' }, 409);
    fs.rmSync(pyHome(), { recursive: true, force: true }); SETUP.done = false; return json(res, { ok: true });
  }
  if (u.pathname === '/api/align/setup') {
    const info = readyInfo(), installed = !!info || (SETUP.done && fs.existsSync(pyExe()));
    return json(res, { running: SETUP.running, step: SETUP.step, pct: SETUP.pct, error: SETUP.error, done: SETUP.done || !!alignEnv(), installed, backend: info?.backend || SETUP.backend,
      file: SETUP.file, got: SETUP.got, size: SETUP.size, last: SETUP.log.slice(-1)[0] || '', bytes: u.searchParams.has('size') && installed ? dirSize(pyHome()) : undefined, dir: pyHome(),
      external: !installed && !!alignEnv() }); // a dev venv (worktree / experiments) is in use instead
  }
  if (u.pathname === '/api/open' && req.method === 'POST') { // open a data folder in Explorer (local server only)
    const what = u.searchParams.get('what') === 'python' ? pyHome() : DATA; fs.mkdirSync(what, { recursive: true });
    spawn(process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open', [what], { detached: true, stdio: 'ignore' }).unref();
    return json(res, { ok: true });
  }
  if (u.pathname === '/api/align' && req.method === 'DELETE') { // cancel a run: the whole process tree (Python + its workers)
    if (AL.child?.pid) { AL.cancel = true; if (process.platform === 'win32') spawn('taskkill', ['/pid', String(AL.child.pid), '/t', '/f'], { windowsHide: true }); else AL.child.kill(); }
    return json(res, { ok: true });
  }
  if (u.pathname === '/api/align' && req.method === 'GET') {
    const env = alignEnv(), result = !AL.running && AL.out && fs.existsSync(AL.out) ? JSON.parse(fs.readFileSync(AL.out, 'utf8')) : null;
    return json(res, { available: !!env, canSetup: process.platform === 'win32' && !!(process.env.SPICY_ALIGN_DIR || fs.existsSync(path.join(root, 'experiments', 'auto-align'))), running: AL.running, stage: AL.stage, done: AL.done, total: AL.total, device: AL.device, error: AL.error, plan: AL.plan, sub: AL.sub, subDone: AL.subDone, subTotal: AL.subTotal, bytes: AL.bytes, elapsed: AL.running ? Date.now() - AL.t0 : 0, hasAudio: !!AL.audio, vocals: !!AL.vocals && fs.existsSync(AL.vocals), result });
  }
  if (u.pathname === '/api/align/vocals' && req.method === 'GET') { // the separated voice, for a clearer waveform
    if (!AL.vocals || !fs.existsSync(AL.vocals)) return json(res, { error: 'нет' }, 404);
    res.setHeader('content-type', 'audio/wav'); return fs.createReadStream(AL.vocals).pipe(res);
  }
  json(res, { error: 'not found' }, 404);
}

/* ---------- http (editor + api) ---------- */
const server = http.createServer((req, res) => {
  const u = new URL(req.url || '/', 'http://x');
  if (u.pathname !== '/api/bye') lastSeen = Date.now();
  if (u.pathname === '/api/version') return json(res, { api: API, pid: process.pid, autoExit: AUTO_EXIT }); // launchers and the editor check it
  if (u.pathname === '/api/yield' && req.method === 'POST') { // a newer server wants this port: hand it over, keep serving MCP through it
    json(res, { ok: true }); setTimeout(() => server.close(() => { remote = true; log('port handed over to a newer server -> proxying'); }), 50); return;
  }
  if (u.pathname === '/api/bye') { // the editor tab is closing: with --auto-exit, go away soon unless another tab still polls
    if (AUTO_EXIT) lastSeen = Math.min(lastSeen, Date.now() - IDLE_MS + 8000); res.statusCode = 204; return res.end();
  }
  if (u.pathname === '/api/project') {
    if (req.method === 'GET') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(state)); }
    if (req.method === 'PUT') {
      let body = ''; req.on('data', c => body += c); req.on('end', () => {
        try { const p = JSON.parse(body); state = { rev: state.rev + 1, by: u.searchParams.get('by') || 'page', project: p }; fs.writeFileSync(FILE, JSON.stringify(state)); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ rev: state.rev })); }
        catch (e) { res.statusCode = 400; res.end(String((e as Error).message)); }
      }); return;
    }
  }
  if (u.pathname === '/api/genius/search') { geniusSearch(u.searchParams.get('q') || '').then(h => json(res, h), e => json(res, { error: e.message }, 502)); return; }
  if (u.pathname === '/api/genius/writers') { geniusWriters(u.searchParams.get('id') || '').then(r => json(res, r), e => json(res, { error: e.message }, 502)); return; }
  if (u.pathname === '/api/genius/lyrics') { geniusText(u.searchParams.get('url') || '').then(text => json(res, { text }), e => json(res, { error: e.message }, 502)); return; }
  if (u.pathname.startsWith('/api/align')) { alignRoute(req, res, u).catch(e => json(res, { error: String(e?.message || e) }, 500)); return; }
  if (u.pathname === '/' || u.pathname === '/index.html') {
    if (!fs.existsSync(htmlPath)) { res.statusCode = 503; res.setHeader('content-type', 'text/plain; charset=utf-8'); return res.end('Редактор не собран: запусти `npm run build` в ' + root); }
    res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end(fs.readFileSync(htmlPath));
  }
  res.statusCode = 404; res.end('not found');
});
server.on('error', (e: NodeJS.ErrnoException) => { if (e.code === 'EADDRINUSE') { remote = true; log(`port ${PORT} busy -> proxying to the running instance`); } else log('http error: ' + e.message); });
server.listen(PORT, '127.0.0.1', () => log(`editor: http://127.0.0.1:${PORT}`));
/** the instance we proxied to is gone (closed editor): serve the port ourselves again */
function takeOver() {
  return new Promise<boolean>(r => {
    const fail = () => r(false);
    server.once('error', fail);
    server.listen(PORT, '127.0.0.1', () => { server.off('error', fail); remote = false; log('took the port over'); r(true); });
  });
}
// --auto-exit (the launcher): no editor tab for a while -> stop. Background tabs poll at least once a minute.
const AUTO_EXIT = process.argv.includes('--auto-exit'), IDLE_MS = 180_000;
let lastSeen = Date.now();
if (AUTO_EXIT) setInterval(() => { if (Date.now() - lastSeen > IDLE_MS && !AL.running && !SETUP.running) { log('no editor open -> exit'); process.exit(0); } }, 5000).unref();
function log(m: string) { process.stderr.write('[spicy] ' + m + '\n'); }

/* ---------- tools ---------- */
type LrclibHit = { id: number; trackName: string; artistName: string; albumName: string; duration: number; syncedLyrics: string | null; plainLyrics: string | null };
const lastSearch: LrclibHit[] = [];
const need = async () => { const s = await getState(); if (!s.project || !s.project.lines) throw new Error('проект пуст: сначала lyrics_search + load_lyrics (или открой проект в редакторе)'); return s.project; };
const layerText = (l: C.Line, layer: Layer) => layer === 'tr' ? (l.tr || '') : l.text;
const summary = (p: Project) => ({
  meta: p.meta, lines: p.lines.map((l, i) => ({ i, t: +l.t.toFixed(2), end: +l.end.toFixed(2), text: l.text, tr: l.tr || '', agent: l.agent || 'v1', ...(l.bg ? { bg: l.bg } : {}), ...(l.sec ? { section: l.sec } : {}),
    wordsSynced: !!(l.sync && (['tr', 'orig'] as const).some(k => l.sync![k] && l.sync![k]!.length && l.sync![k]!.every(x => x.a != null && x.b != null && !x.g))) }))
});

type Tool = { description: string; schema: object; run(args: any): Promise<unknown> };
const tools: Record<string, Tool> = {
  lyrics_search: {
    description: 'Поиск синхронизированного текста песни в LRCLIB. Возвращает кандидатов с id; дальше load_lyrics.',
    schema: { type: 'object', properties: { q: { type: 'string', description: 'исполнитель и название' } }, required: ['q'] },
    async run({ q }: { q: string }) {
      const r = await fetch('https://lrclib.net/api/search?q=' + encodeURIComponent(q)); if (!r.ok) throw new Error('LRCLIB HTTP ' + r.status);
      const d = ((await r.json()) as LrclibHit[]).slice(0, 15); lastSearch.length = 0; lastSearch.push(...d);
      return d.map(x => ({ id: x.id, track: x.trackName, artist: x.artistName, album: x.albumName, duration: x.duration, synced: !!x.syncedLyrics }));
    }
  },
  genius_lyrics: {
    description: 'Текст песни с Genius — эталонный текст для Spicy Lyrics (таймингов там нет). Без url — поиск: кандидаты + текст лучшего совпадения. Строка = строка песни, (…) = бэк-вокал, [Припев] — заголовок секции. Тайминги бери из LRCLIB (lyrics_search + load_lyrics); положить текст Genius на них пользователь может в редакторе: «Трек» → «Текст с Genius».',
    schema: { type: 'object', properties: { q: { type: 'string', description: 'исполнитель и название' }, url: { type: 'string', description: 'ссылка genius.com/…-lyrics из прошлого поиска' } } },
    async run({ q, url }: { q?: string; url?: string }) {
      if (url) return { url, text: await geniusText(url) };
      const hits = await geniusSearch(q || ''); if (!hits.length) throw new Error('на Genius ничего не нашлось');
      return { best: { ...hits[0], text: await geniusText(hits[0].url) }, others: hits.slice(1, 6) };
    }
  },
  load_lyrics: {
    description: 'Создать новый проект из результата lyrics_search (id) или из своего LRC/plain текста. Заменяет текущий проект.',
    schema: { type: 'object', properties: { id: { type: 'number' }, lrc: { type: 'string' }, title: { type: 'string' }, artist: { type: 'string' }, lang: { type: 'string', description: 'код языка перевода, напр. ru' } } },
    async run({ id, lrc, title, artist, lang }: { id?: number; lrc?: string; title?: string; artist?: string; lang?: string }) {
      let entries, dur = 0;
      if (id != null) {
        const d = lastSearch.find(x => x.id === id); if (!d) throw new Error('id нет в последнем поиске — вызови lyrics_search');
        entries = d.syncedLyrics ? C.parseLRC(d.syncedLyrics) : C.parsePlain(d.plainLyrics || ''); dur = d.duration || 0; title = title || d.trackName; artist = artist || d.artistName;
      } else if (lrc) { entries = C.parseLRC(lrc); if (!entries.length) entries = C.parsePlain(lrc); } else throw new Error('нужен id или lrc');
      const lines = C.entriesToLines(entries, dur).map(l => ({ t: l.t, end: l.end, text: l.text, tr: '', sync: null }));
      await putProject({ v: 1, meta: { title: title || '', artist: artist || '', lang: lang || 'ru', mode: 'translation' }, lines }, 'mcp');
      return { ok: true, lines: lines.length };
    }
  },
  import_lyrics: {
    description: 'Создать проект из содержимого файла с текстом: TTML (с исполнителями, бэками и пословной разметкой), SRT, LRC или просто текст (строки разложатся по длительности). Для новых треков, которых нет в LRCLIB. Заменяет текущий проект.',
    schema: { type: 'object', properties: { text: { type: 'string', description: 'содержимое файла' }, file_name: { type: 'string', description: 'имя файла — помогает определить формат' }, duration: { type: 'number', description: 'длительность трека, с (для простого текста)' }, title: { type: 'string' }, artist: { type: 'string' }, lang: { type: 'string' } }, required: ['text'] },
    async run({ text, file_name, duration, title, artist, lang }: { text: string; file_name?: string; duration?: number; title?: string; artist?: string; lang?: string }) {
      const { lines, kind } = C.importLyrics(text, file_name || '', duration || 0);
      if (!lines.length) throw new Error('в тексте не нашлось строк');
      await putProject({ v: 1, meta: { title: title || '', artist: artist || '', lang: lang || 'ru', mode: 'translation' }, lines }, 'mcp');
      return { ok: true, kind, lines: lines.length, singers: lines.some(l => l.agent), backgroundVocals: lines.filter(l => l.bg).length, wordTimings: lines.some(l => l.sync && l.sync.orig) };
    }
  },
  get_project: {
    description: 'Текущий проект: мета и строки (оригинал, перевод, таймкоды, синхронизированы ли слова). Читай перед переводом/правками.',
    schema: { type: 'object', properties: {} },
    async run() { return summary(await need()); }
  },
  set_translations: {
    description: 'Записать перевод строк. Передай всю песню за раз для связного перевода. Старые пословные тайминги перевода у изменённых строк сбрасываются.',
    schema: { type: 'object', properties: { lines: { type: 'array', items: { type: 'object', properties: { i: { type: 'number' }, tr: { type: 'string' } }, required: ['i', 'tr'] } }, lang: { type: 'string' } }, required: ['lines'] },
    async run({ lines, lang }: { lines: { i: number; tr: string }[]; lang?: string }) {
      const p = await need(); let n = 0;
      for (const x of lines) { const l = p.lines[x.i]; if (!l) continue; const t = String(x.tr).trim(); if (t !== (l.tr || '')) { l.tr = t; if (l.sync) delete l.sync.tr; } n++; }
      if (lang) p.meta.lang = lang;
      await putProject(p, 'mcp'); return { ok: true, applied: n, total: p.lines.length };
    }
  },
  set_agents: {
    description: 'Назначить исполнителя строкам (дуэты). v1 — основной (слева), v2 — второй (справа, как в Spicy Lyrics), v1000 — вместе. Строки без назначения считаются v1.',
    schema: { type: 'object', properties: { lines: { type: 'array', items: { type: 'object', properties: { i: { type: 'number' }, agent: { type: 'string', enum: ['v1', 'v2', 'v1000'] } }, required: ['i', 'agent'] } } }, required: ['lines'] },
    async run({ lines }: { lines: { i: number; agent: 'v1' | 'v2' | 'v1000' }[] }) {
      const p = await need(); let n = 0;
      for (const x of lines) { const l = p.lines[x.i]; if (!l || !['v1', 'v2', 'v1000'].includes(x.agent)) continue; if (x.agent === 'v1') delete l.agent; else l.agent = x.agent; n++; }
      await putProject(p, 'mcp'); return { ok: true, applied: n };
    }
  },
  set_word_timings: {
    description: 'Задать пословные тайминги строки (секунды). words — по одному {a,b} на слово слоя (единицы = слова по пробелам и слоги через «|» в тексте; NBSP склеивает два слова в один блок). Тайминги, выставленные агентом, помечаются как авто (не подтверждены человеком).',
    schema: { type: 'object', properties: { i: { type: 'number' }, layer: { type: 'string', enum: ['tr', 'orig', 'bg', 'bgo'], description: 'tr/orig — основная строка, bg/bgo — бэк (перевод/оригинал)' }, words: { type: 'array', items: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] } } }, required: ['i', 'layer', 'words'] },
    async run({ i, layer, words }: { i: number; layer: Layer; words: { a: number; b: number }[] }) {
      const p = await need(), l = p.lines[i]; if (!l) throw new Error('нет строки ' + i);
      const n = C.wordList(layerText(l, layer)).length; if (n !== words.length) throw new Error(`в слое ${layer} строки ${i} слов: ${n}, передано: ${words.length}`);
      l.sync = l.sync || {}; l.sync[layer] = words.map(w => ({ a: +w.a.toFixed(3), b: +w.b.toFixed(3), g: 1 as const }));
      await putProject(p, 'mcp'); return { ok: true };
    }
  },
  auto_spread: {
    description: 'Равномерно раскидать слова строк, где слои ещё не размечены (черновик, который человек доведёт на волне).',
    schema: { type: 'object', properties: { layer: { type: 'string', enum: ['tr', 'orig', 'bg', 'bgo'], description: 'tr/orig — основная строка, bg/bgo — бэк (перевод/оригинал)' } }, required: ['layer'] },
    async run({ layer }: { layer: Layer }) {
      const p = await need(); let n = 0;
      p.lines.forEach(l => { const t = layerText(l, layer); if (!t.trim() || (l.sync && l.sync[layer])) return; l.sync = l.sync || {}; l.sync[layer] = C.splitWords(t, l.t, l.end).map(w => ({ a: +w.a.toFixed(3), b: +w.b.toFixed(3), g: 1 as const })); n++; });
      await putProject(p, 'mcp'); return { ok: true, spread: n };
    }
  },
  qa_check: {
    description: 'Проверка перед экспортом по правилам Spicy Lyrics: пустые строки, нет перевода, неразмеченные/авто-слова, слишком короткие/долгие, перекрытия.',
    schema: { type: 'object', properties: { mode: { type: 'string', enum: ['translation', 'bilingual'] } } },
    async run({ mode }: { mode?: Mode }) { const p = await need(); const r = C.qaCheck(p.lines, mode || p.meta.mode || 'translation'); return { errors: r.filter(x => x.sev === 'err').length, warnings: r.filter(x => x.sev === 'warn').length, items: r.slice(0, 100).map(x => ({ line: x.i, ...x })) }; }
  },
  export_ttml: {
    description: 'Собрать TTML для Spicy Lyrics. Сохраняет файл в папку exports/ рядом с сервером и возвращает путь (и текст, если include_text).',
    schema: { type: 'object', properties: { mode: { type: 'string', enum: ['translation', 'bilingual'] }, wordSpread: { type: 'boolean' }, offset_ms: { type: 'number' }, songwriters: { type: 'array', items: { type: 'string' } }, include_text: { type: 'boolean' } } },
    async run({ mode, wordSpread = true, offset_ms = 0, songwriters = [], include_text }: { mode?: Mode; wordSpread?: boolean; offset_ms?: number; songwriters?: string[]; include_text?: boolean }) {
      const p = await need();
      const ttml = C.buildTTML({ lines: p.lines, mode: mode || p.meta.mode || 'translation', wordSpread, lang: p.meta.lang || 'ru', offset: offset_ms, songwriters, meta: p.meta.md });
      const out = path.join(DATA, 'exports'); fs.mkdirSync(out, { recursive: true });
      const f = path.join(out, `${(p.meta.artist + ' - ' + p.meta.title).replace(/[\\/:*?"<>|]/g, '').trim() || 'lyrics'} (${p.meta.lang || 'ru'}).ttml`);
      fs.writeFileSync(f, ttml); return { path: f, ...(include_text ? { ttml } : {}) };
    }
  }
};

/* ---------- MCP over stdio (newline-delimited JSON-RPC 2.0) ---------- */
// started by the desktop app: leave together with it, even if the app is killed or crashes
const parent = +(process.env.SPICY_PARENT_PID || 0);
if (parent) setInterval(() => { try { process.kill(parent, 0); } catch { process.exit(0); } }, 2000).unref();

if (!process.argv.includes('--http')) {
  const send = (m: object) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
  const handle = async (msg: { id?: number | string; method: string; params?: any }) => {
    const { id, method, params } = msg;
    if (id === undefined) return; // notification
    try {
      if (method === 'initialize') return send({ id, result: { protocolVersion: params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'spicy-translate', version: '1.0.0' } } });
      if (method === 'ping') return send({ id, result: {} });
      if (method === 'tools/list') return send({ id, result: { tools: Object.entries(tools).map(([name, t]) => ({ name, description: t.description, inputSchema: t.schema })) } });
      if (method === 'tools/call') {
        const t = tools[params.name]; if (!t) return send({ id, error: { code: -32602, message: 'unknown tool ' + params.name } });
        try { const r = await t.run(params.arguments || {}); return send({ id, result: { content: [{ type: 'text', text: JSON.stringify(r, null, 1) }] } }); }
        catch (e) { return send({ id, result: { isError: true, content: [{ type: 'text', text: String((e as Error).message) }] } }); }
      }
      send({ id, error: { code: -32601, message: 'method not found: ' + method } });
    } catch (e) { send({ id, error: { code: -32603, message: String((e as Error).message) } }); }
  };
  let buf = ''; process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { buf += d; let k; while ((k = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, k).trim(); buf = buf.slice(k + 1); if (line) { try { handle(JSON.parse(line)); } catch (e) { log('bad json: ' + (e as Error).message); } } } });
  process.stdin.on('end', () => process.exit(0));
}
