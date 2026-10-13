#!/usr/bin/env node
// Spicy Translate: local server + MCP (stdio) in one zero-dependency file.
//   node spicy-mcp.mjs          -> MCP over stdio AND http://127.0.0.1:8787 (the editor, live-linked)
//   node spicy-mcp.mjs --http   -> only the HTTP editor (no MCP)
// The editor (index.html) polls /api/project, so whatever the agent changes appears there within ~1.5 s,
// and whatever you do in the editor is what the agent reads back.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const PORT = +process.env.SPICY_PORT || 8787;
const FILE = path.join(process.env.SPICY_DIR || dir, 'spicy-project.json');
const htmlPath = path.join(dir, 'index.html');

// reuse the editor's own pure functions (single source of truth: the <script> core section of index.html)
const src = fs.readFileSync(htmlPath, 'utf8');
const a = src.indexOf('/* ---------- core'), b = src.indexOf('/* ---------------- app');
if (a < 0 || b < 0) throw new Error('core markers not found in index.html');
const mod = { exports: {} }; new Function('module', src.slice(a, b))(mod);
const C = mod.exports;

/* ---------- state ---------- */
fs.mkdirSync(path.dirname(FILE), { recursive: true });
let state = { rev: 0, by: 'init', project: null };
try { state = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
let remote = false; // true when another instance already owns the port -> proxy to it
const base = `http://127.0.0.1:${PORT}/api/project`;
async function getState() { return remote ? (await fetch(base)).json() : state; }
async function putProject(project, by) {
  if (remote) return (await fetch(base + '?by=' + by, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(project) })).json();
  state = { rev: state.rev + 1, by, project }; fs.writeFileSync(FILE, JSON.stringify(state)); return { rev: state.rev };
}

/* ---------- http (editor + api) ---------- */
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/project') {
    if (req.method === 'GET') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(state)); }
    if (req.method === 'PUT') {
      let body = ''; req.on('data', c => body += c); req.on('end', () => {
        try { const p = JSON.parse(body); state = { rev: state.rev + 1, by: u.searchParams.get('by') || 'page', project: p }; fs.writeFileSync(FILE, JSON.stringify(state)); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ rev: state.rev })); }
        catch (e) { res.statusCode = 400; res.end(String(e.message)); }
      }); return;
    }
  }
  if (u.pathname === '/' || u.pathname === '/index.html') { res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end(fs.readFileSync(htmlPath)); }
  res.statusCode = 404; res.end('not found');
});
server.on('error', e => { if (e.code === 'EADDRINUSE') { remote = true; log(`port ${PORT} busy -> proxying to the running instance`); } else log('http error: ' + e.message); });
server.listen(PORT, '127.0.0.1', () => log(`editor: http://127.0.0.1:${PORT}`));
function log(m) { process.stderr.write('[spicy] ' + m + '\n'); }

/* ---------- tools ---------- */
const lastSearch = [];
const need = async () => { const s = await getState(); if (!s.project || !s.project.lines) throw new Error('проект пуст: сначала lyrics_search + load_lyrics (или открой проект в редакторе)'); return s.project; };
const layerText = (l, layer) => layer === 'tr' ? (l.tr || '') : l.text;
const summary = p => ({
  meta: p.meta, lines: p.lines.map((l, i) => ({ i, t: +l.t.toFixed(2), end: +l.end.toFixed(2), text: l.text, tr: l.tr || '',
    wordsSynced: !!(l.sync && ['tr', 'orig'].some(k => l.sync[k] && l.sync[k].length && l.sync[k].every(x => x.a != null && x.b != null && !x.g))) }))
});

const tools = {
  lyrics_search: {
    description: 'Поиск синхронизированного текста песни в LRCLIB. Возвращает кандидатов с id; дальше load_lyrics.',
    schema: { type: 'object', properties: { q: { type: 'string', description: 'исполнитель и название' } }, required: ['q'] },
    async run({ q }) {
      const r = await fetch('https://lrclib.net/api/search?q=' + encodeURIComponent(q)); if (!r.ok) throw new Error('LRCLIB HTTP ' + r.status);
      const d = (await r.json()).slice(0, 15); lastSearch.length = 0; lastSearch.push(...d);
      return d.map(x => ({ id: x.id, track: x.trackName, artist: x.artistName, album: x.albumName, duration: x.duration, synced: !!x.syncedLyrics }));
    }
  },
  load_lyrics: {
    description: 'Создать новый проект из результата lyrics_search (id) или из своего LRC/plain текста. Заменяет текущий проект.',
    schema: { type: 'object', properties: { id: { type: 'number' }, lrc: { type: 'string' }, title: { type: 'string' }, artist: { type: 'string' }, lang: { type: 'string', description: 'код языка перевода, напр. ru' } } },
    async run({ id, lrc, title, artist, lang }) {
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
  get_project: {
    description: 'Текущий проект: мета и строки (оригинал, перевод, таймкоды, синхронизированы ли слова). Читай перед переводом/правками.',
    schema: { type: 'object', properties: {} },
    async run() { return summary(await need()); }
  },
  set_translations: {
    description: 'Записать перевод строк. Передай всю песню за раз для связного перевода. Старые пословные тайминги перевода у изменённых строк сбрасываются.',
    schema: { type: 'object', properties: { lines: { type: 'array', items: { type: 'object', properties: { i: { type: 'number' }, tr: { type: 'string' } }, required: ['i', 'tr'] } }, lang: { type: 'string' } }, required: ['lines'] },
    async run({ lines, lang }) {
      const p = await need(); let n = 0;
      for (const x of lines) { const l = p.lines[x.i]; if (!l) continue; const t = String(x.tr).trim(); if (t !== (l.tr || '')) { l.tr = t; if (l.sync) delete l.sync.tr; } n++; }
      if (lang) p.meta.lang = lang;
      await putProject(p, 'mcp'); return { ok: true, applied: n, total: p.lines.length };
    }
  },
  set_word_timings: {
    description: 'Задать пословные тайминги строки (секунды). words — по одному {a,b} на слово слоя (единицы = слова по пробелам и слоги через «|» в тексте; NBSP склеивает два слова в один блок). Тайминги, выставленные агентом, помечаются как авто (не подтверждены человеком).',
    schema: { type: 'object', properties: { i: { type: 'number' }, layer: { type: 'string', enum: ['tr', 'orig'] }, words: { type: 'array', items: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] } } }, required: ['i', 'layer', 'words'] },
    async run({ i, layer, words }) {
      const p = await need(), l = p.lines[i]; if (!l) throw new Error('нет строки ' + i);
      const n = C.wordList(layerText(l, layer)).length; if (n !== words.length) throw new Error(`в слое ${layer} строки ${i} слов: ${n}, передано: ${words.length}`);
      l.sync = l.sync || {}; l.sync[layer] = words.map(w => ({ a: +w.a.toFixed(3), b: +w.b.toFixed(3), g: 1 }));
      await putProject(p, 'mcp'); return { ok: true };
    }
  },
  auto_spread: {
    description: 'Равномерно раскидать слова строк, где слои ещё не размечены (черновик, который человек доведёт на волне).',
    schema: { type: 'object', properties: { layer: { type: 'string', enum: ['tr', 'orig'] } }, required: ['layer'] },
    async run({ layer }) {
      const p = await need(); let n = 0;
      p.lines.forEach(l => { const t = layerText(l, layer); if (!t.trim() || (l.sync && l.sync[layer])) return; l.sync = l.sync || {}; l.sync[layer] = C.splitWords(t, l.t, l.end).map(w => ({ a: +w.a.toFixed(3), b: +w.b.toFixed(3), g: 1 })); n++; });
      await putProject(p, 'mcp'); return { ok: true, spread: n };
    }
  },
  qa_check: {
    description: 'Проверка перед экспортом по правилам Spicy Lyrics: пустые строки, нет перевода, неразмеченные/авто-слова, слишком короткие/долгие, перекрытия.',
    schema: { type: 'object', properties: { mode: { type: 'string', enum: ['translation', 'bilingual'] } } },
    async run({ mode }) { const p = await need(); const r = C.qaCheck(p.lines, mode || p.meta.mode || 'translation'); return { errors: r.filter(x => x.sev === 'err').length, warnings: r.filter(x => x.sev === 'warn').length, items: r.slice(0, 100).map(x => ({ line: x.i, ...x })) }; }
  },
  export_ttml: {
    description: 'Собрать TTML для Spicy Lyrics. Сохраняет файл в папку exports/ рядом с сервером и возвращает путь (и текст, если include_text).',
    schema: { type: 'object', properties: { mode: { type: 'string', enum: ['translation', 'bilingual'] }, wordSpread: { type: 'boolean' }, offset_ms: { type: 'number' }, songwriters: { type: 'array', items: { type: 'string' } }, include_text: { type: 'boolean' } } },
    async run({ mode, wordSpread = true, offset_ms = 0, songwriters = [], include_text }) {
      const p = await need();
      const ttml = C.buildTTML({ lines: p.lines, mode: mode || p.meta.mode || 'translation', wordSpread, lang: p.meta.lang || 'ru', offset: offset_ms, songwriters });
      const out = path.join(process.env.SPICY_DIR || dir, 'exports'); fs.mkdirSync(out, { recursive: true });
      const f = path.join(out, `${(p.meta.artist + ' - ' + p.meta.title).replace(/[\\/:*?"<>|]/g, '').trim() || 'lyrics'} (${p.meta.lang || 'ru'}).ttml`);
      fs.writeFileSync(f, ttml); return { path: f, ...(include_text ? { ttml } : {}) };
    }
  }
};

/* ---------- MCP over stdio (newline-delimited JSON-RPC 2.0) ---------- */
if (!process.argv.includes('--http')) {
  const send = m => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
  const handle = async msg => {
    const { id, method, params } = msg;
    if (id === undefined) return; // notification
    try {
      if (method === 'initialize') return send({ id, result: { protocolVersion: params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'spicy-translate', version: '1.0.0' } } });
      if (method === 'ping') return send({ id, result: {} });
      if (method === 'tools/list') return send({ id, result: { tools: Object.entries(tools).map(([name, t]) => ({ name, description: t.description, inputSchema: t.schema })) } });
      if (method === 'tools/call') {
        const t = tools[params.name]; if (!t) return send({ id, error: { code: -32602, message: 'unknown tool ' + params.name } });
        try { const r = await t.run(params.arguments || {}); return send({ id, result: { content: [{ type: 'text', text: JSON.stringify(r, null, 1) }] } }); }
        catch (e) { return send({ id, result: { isError: true, content: [{ type: 'text', text: String(e.message) }] } }); }
      }
      send({ id, error: { code: -32601, message: 'method not found: ' + method } });
    } catch (e) { send({ id, error: { code: -32603, message: String(e.message) } }); }
  };
  let buf = ''; process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { buf += d; let k; while ((k = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, k).trim(); buf = buf.slice(k + 1); if (line) { try { handle(JSON.parse(line)); } catch (e) { log('bad json: ' + e.message); } } } });
  process.stdin.on('end', () => process.exit(0));
}
