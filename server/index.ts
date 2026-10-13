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
import * as C from '../src/core/index.ts';
import type { Layer, Mode, Project } from '../src/core/index.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +(process.env.SPICY_PORT || 0) || 8787;
const DATA = process.env.SPICY_DIR || root;
const FILE = path.join(DATA, 'spicy-project.json');
const htmlPath = path.join(root, 'dist', 'index.html');

/* ---------- state ---------- */
fs.mkdirSync(path.dirname(FILE), { recursive: true });
type State = { rev: number; by: string; project: Project | null };
let state: State = { rev: 0, by: 'init', project: null };
try { state = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
let remote = false; // true when another instance already owns the port -> proxy to it
const base = `http://127.0.0.1:${PORT}/api/project`;
async function getState(): Promise<State> { return remote ? (await fetch(base)).json() : state; }
async function putProject(project: Project, by: string) {
  if (remote) return (await fetch(base + '?by=' + by, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(project) })).json();
  state = { rev: state.rev + 1, by, project }; fs.writeFileSync(FILE, JSON.stringify(state)); return { rev: state.rev };
}

/* ---------- http (editor + api) ---------- */
const server = http.createServer((req, res) => {
  const u = new URL(req.url || '/', 'http://x');
  if (u.pathname === '/api/project') {
    if (req.method === 'GET') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(state)); }
    if (req.method === 'PUT') {
      let body = ''; req.on('data', c => body += c); req.on('end', () => {
        try { const p = JSON.parse(body); state = { rev: state.rev + 1, by: u.searchParams.get('by') || 'page', project: p }; fs.writeFileSync(FILE, JSON.stringify(state)); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ rev: state.rev })); }
        catch (e) { res.statusCode = 400; res.end(String((e as Error).message)); }
      }); return;
    }
  }
  if (u.pathname === '/' || u.pathname === '/index.html') {
    if (!fs.existsSync(htmlPath)) { res.statusCode = 503; res.setHeader('content-type', 'text/plain; charset=utf-8'); return res.end('Редактор не собран: запусти `npm run build` в ' + root); }
    res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end(fs.readFileSync(htmlPath));
  }
  res.statusCode = 404; res.end('not found');
});
server.on('error', (e: NodeJS.ErrnoException) => { if (e.code === 'EADDRINUSE') { remote = true; log(`port ${PORT} busy -> proxying to the running instance`); } else log('http error: ' + e.message); });
server.listen(PORT, '127.0.0.1', () => log(`editor: http://127.0.0.1:${PORT}`));
function log(m: string) { process.stderr.write('[spicy] ' + m + '\n'); }

/* ---------- tools ---------- */
type LrclibHit = { id: number; trackName: string; artistName: string; albumName: string; duration: number; syncedLyrics: string | null; plainLyrics: string | null };
const lastSearch: LrclibHit[] = [];
const need = async () => { const s = await getState(); if (!s.project || !s.project.lines) throw new Error('проект пуст: сначала lyrics_search + load_lyrics (или открой проект в редакторе)'); return s.project; };
const layerText = (l: C.Line, layer: Layer) => layer === 'tr' ? (l.tr || '') : l.text;
const summary = (p: Project) => ({
  meta: p.meta, lines: p.lines.map((l, i) => ({ i, t: +l.t.toFixed(2), end: +l.end.toFixed(2), text: l.text, tr: l.tr || '', agent: l.agent || 'v1', ...(l.bg ? { bg: l.bg } : {}),
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
      const ttml = C.buildTTML({ lines: p.lines, mode: mode || p.meta.mode || 'translation', wordSpread, lang: p.meta.lang || 'ru', offset: offset_ms, songwriters });
      const out = path.join(DATA, 'exports'); fs.mkdirSync(out, { recursive: true });
      const f = path.join(out, `${(p.meta.artist + ' - ' + p.meta.title).replace(/[\\/:*?"<>|]/g, '').trim() || 'lyrics'} (${p.meta.lang || 'ru'}).ttml`);
      fs.writeFileSync(f, ttml); return { path: f, ...(include_text ? { ttml } : {}) };
    }
  }
};

/* ---------- MCP over stdio (newline-delimited JSON-RPC 2.0) ---------- */
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
