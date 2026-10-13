// Панель редактора поверх Spotify. Логика разметки — порт reference/index.html (секция app), часы — плеер Spotify вместо <audio>.
import css from './style.css';
import { buildTTML, entriesToLines, fmtTime, getWords, parseLRC, parsePlain, plainW, qaCheck, splitWords, syllabify, syncComplete, units, unitsText, wordList,
  type Line, type Mode, type Span, type TTMLOpts, type Word } from './core.ts';
import { findLyrics, type TrackInfo } from './lrclib.ts';
import { putToSpicy } from './spicy.ts';

declare const Spicetify: any;
type Layer = 'tr' | 'orig';
type VW = { word: string; sp: boolean; a: number | null; b: number | null; real?: boolean; g?: boolean; ghost?: boolean };

const K = 'spicy-translate:';
const store = {
  get(k: string, d: string) { try { const v = Spicetify.LocalStorage.get(K + k); return v == null ? d : v; } catch { return d; } },
  set(k: string, v: string) { try { Spicetify.LocalStorage.set(K + k, v); return true; } catch { return false; } },
};
const S = {
  open: false, uri: '', meta: { title: '', artist: '', album: '', duration: 0 } as TrackInfo, lines: [] as Line[],
  layer: 'tr' as Layer, sel: null as null | { i: number; k: number }, undo: [] as string[], redo: [] as string[],
  snap: true, loop: false, fx: true, voff: 0, ver: 0, chips: [] as HTMLElement[], load: 0,
};
let root: HTMLElement;
const $ = (id: string): any => root.querySelector('#st-' + id);
const mode = (): Mode => (root.querySelector('input[name=st-mode]:checked') as HTMLInputElement).value as Mode;
const p2 = (n: number) => String(n).padStart(2, '0');
const mmss = (t: number) => { t = Math.max(0, t); return Math.floor(t / 60) + ':' + p2(Math.floor(t % 60)); };
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const P = () => Spicetify.Player;
const playing = () => !!P().isPlaying();

let toastT: any = null;
function msg(text: string, cls = '') { const e = $('status'); e.textContent = text; e.title = text; e.className = 'st-status ' + cls; clearTimeout(toastT); if (cls !== 'err') toastT = setTimeout(() => { e.textContent = ''; }, 8000); }

/* ---------- clock: Spotify progress, smoothed like now() in reference ---------- */
const CLK = { base: 0, pt: 0, hold: 0 };
function now() {
  const ct = (P().getProgress() || 0) / 1000, p = performance.now();
  if (!playing()) { if (p >= CLK.hold) CLK.base = ct; CLK.pt = p; return CLK.base; }
  const pred = CLK.base + (p - CLK.pt) / 1000, e = ct - pred;
  if (p < CLK.hold && Math.abs(e) > 0.1) return pred; // our own seek hasn't reached the player state yet
  CLK.base = Math.abs(e) > 0.1 ? ct : pred + e * 0.25; CLK.pt = p; // big jump = seek/stall -> snap; small = ease in
  return CLK.base;
}
function seekTo(t: number) {
  t = Math.max(0, t); P().seek(Math.round(t * 1000)); // integer = ms (fractions 0..1 would be read as percent)
  CLK.base = t; CLK.pt = performance.now(); CLK.hold = CLK.pt + 800; lastAct = -2;
}
let playStop: any = null;
function playWord(w: { a: number; b: number }) { clearTimeout(playStop); seekTo(w.a); P().play(); playStop = setTimeout(() => P().pause(), (w.b - w.a) * 1000 + 60); }

/* ---------- words / layers ---------- */
function layerText(l: Line, layer: Layer) { return layer === 'tr' ? (l.tr || '') : l.text; }
function wordsOf(i: number, layer: Layer) { return wordList(layerText(S.lines[i], layer)); }
function ensureSync(i: number, layer: Layer): Span[] {
  const l = S.lines[i], n = wordsOf(i, layer).length;
  l.sync = l.sync || {};
  let s = l.sync[layer];
  if (!s || s.length !== n) s = l.sync[layer] = Array.from({ length: n }, () => ({ a: null, b: null }));
  return s;
}
function viewWords(i: number, layer: Layer): VW[] {
  const l = S.lines[i], us = units(layerText(l, layer)), sy = l.sync && l.sync[layer];
  if (sy && sy.length === us.length) {
    return us.map((u, k) => (sy[k].a != null && sy[k].b != null) ? { word: u.w, sp: u.sp, a: sy[k].a, b: sy[k].b, real: true, g: !!sy[k].g } : { word: u.w, sp: u.sp, a: null, b: null });
  }
  return splitWords(layerText(l, layer), l.t, l.end).map(w => ({ ...w, ghost: true }));
}
// g:1 on a word = auto-placed (spread), not yet confirmed by hand; any real edit clears it
const conf = (...xs: (Span | null | undefined)[]) => xs.forEach(x => { if (x) delete x.g; });
function lineState(i: number, layer: Layer) {
  const n = wordsOf(i, layer).length, sy = S.lines[i].sync && S.lines[i].sync![layer];
  if (!n) return 'none';
  if (syncComplete(sy, n) && !sy.some(x => x.g)) return 'done';
  if (sy && sy.length === n && sy.some(x => !x.g && (x.a != null || x.b != null))) return 'part';
  return 'none';
}
function spreadLine(i: number, layer: Layer) {
  const l = S.lines[i]; if (!wordsOf(i, layer).length) return;
  l.sync = l.sync || {};
  l.sync[layer] = splitWords(layerText(l, layer), l.t, l.end).map(w => ({ a: r3(w.a), b: r3(w.b), g: 1 as const }));
}
// make every word of the line a real, draggable block right away (gaps are filled by an even spread, flagged g)
function fillLine(i: number, layer: Layer) {
  const l = S.lines[i], n = wordsOf(i, layer).length; if (!n || lineState(i, layer) === 'done') return false;
  const sy = ensureSync(i, layer);
  if (sy.every(x => x.a == null && x.b == null)) { spreadLine(i, layer); return true; }
  sy.forEach((x, k) => {
    const nx = sy.slice(k + 1).find(y => y.a != null);
    if (x.a != null && x.b == null) x.b = r3(Math.min(x.a + 0.3, nx ? nx.a! : l.end));
    else if (x.b != null && x.a == null) x.a = r3(Math.max(k && sy[k - 1].b != null ? sy[k - 1].b! : l.t, x.b - 0.3));
  });
  const ws = wordsOf(i, layer);
  for (let k = 0; k < n;) {
    if (sy[k].a != null) { k++; continue; }
    let e = k; while (e < n && sy[e].a == null) e++;
    const t0 = k && sy[k - 1].b != null ? sy[k - 1].b! : l.t, t1 = e < n ? sy[e].a! : Math.max(l.end, t0 + 0.3 * (e - k));
    splitWords(ws.slice(k, e).join(' '), t0, t1).forEach((w, j) => { sy[k + j].a = r3(w.a); sy[k + j].b = r3(w.b); sy[k + j].g = 1; });
    k = e;
  }
  return true;
}
function mainLayerFor(i: number): Layer { return mode() === 'bilingual' ? 'orig' : (S.lines[i].tr && S.lines[i].tr.trim() ? 'tr' : 'orig'); }

/* ---------- track + project ---------- */
function curTrack(): (TrackInfo & { uri: string }) | null {
  const it = P().data && P().data.item; if (!it || !it.uri) return null;
  const md = it.metadata || {};
  return { uri: it.uri, title: it.name || md.title || '', artist: (it.artists || []).map((a: any) => a.name).join(', ') || md.artist_name || '',
    album: (it.album && it.album.name) || md.album_title || '', duration: ((it.duration && it.duration.milliseconds) || P().getDuration() || 0) / 1000 };
}
function projectJSON() { // same shape as the web editor's .spicy.json (+ uri)
  return JSON.stringify({ v: 1, meta: { uri: S.uri, title: S.meta.title, artist: S.meta.artist, lang: $('lang').value, mode: mode() },
    lines: S.lines.map(l => ({ t: l.t, end: l.end, text: l.text, tr: l.tr || '', sync: l.sync || null })) });
}
let saveT: any = null;
function scheduleSave() { clearTimeout(saveT); saveT = setTimeout(saveProject, 600); }
// ponytail: whole project per track in Spicetify.LocalStorage (~20-50 KB each, quota ~5 MB); move to IndexedDB if hundreds of projects pile up
function saveProject() {
  clearTimeout(saveT); if (!S.uri || !S.lines.length) return;
  if (!store.set('proj:' + S.uri, projectJSON())) msg('Не удалось сохранить проект (переполнен LocalStorage?) — скачай TTML.', 'err');
}
function setLines(lines: Line[]) {
  S.lines = lines; S.undo = []; S.redo = []; S.sel = null;
  S.layer = lines.some(l => l.tr && l.tr.trim()) ? 'tr' : 'orig'; $('layer').value = S.layer;
  renderEditor(); buildPreview();
  if (lines.length) selectWord(0, 0); else renderSync();
}
function applyProject(p: any) {
  const m = p.meta || {};
  if (m.lang) $('lang').value = m.lang;
  if (m.mode) { const r = root.querySelector(`input[name=st-mode][value=${m.mode}]`) as HTMLInputElement | null; if (r) r.checked = true; }
  setLines(p.lines.map((l: any) => ({ t: l.t, end: l.end, text: l.text, tr: l.tr || '', sync: l.sync || undefined })));
}
async function loadTrack(force = false) {
  const tr = curTrack();
  if (!tr) return msg('Spotify ничего не играет — включи трек.', 'err');
  if (!force && tr.uri === S.uri) return;
  saveProject();
  S.uri = tr.uri; S.meta = tr; $('title').textContent = tr.title; $('artist').textContent = tr.artist;
  const load = ++S.load;
  const saved = force ? null : store.get('proj:' + tr.uri, '');
  if (saved) { try { applyProject(JSON.parse(saved)); return msg('Восстановил твой проект для этого трека.', 'ok'); } catch {} }
  setLines([]); msg('Ищу текст в LRCLIB…');
  try {
    const d = await findLyrics({ ...tr, artist: tr.artist.split(', ')[0] });
    if (load !== S.load) return; // track changed meanwhile
    if (!d) return msg('LRCLIB ничего не нашёл — вставь LRC или текст вручную (меню «Текст»).', 'err');
    const synced = !!d.syncedLyrics;
    setLines(entriesToLines(synced ? parseLRC(d.syncedLyrics!) : parsePlain(d.plainLyrics || ''), tr.duration));
    scheduleSave();
    const off = Math.abs((d.duration || 0) - tr.duration);
    msg(!synced ? 'Нашёл только текст без таймингов — строки расставлены равномерно, поправь или вставь LRC.'
      : off > 3 ? `Нашёл ${d.artistName} — ${d.trackName}, но длительность отличается на ${Math.round(off)} с — проверь тайминги.`
      : `LRCLIB: ${d.artistName} — ${d.trackName}, строк ${S.lines.length}.`, synced && off <= 3 ? 'ok' : 'err');
  } catch (e: any) { if (load === S.load) msg('Не достучался до LRCLIB: ' + e.message, 'err'); }
}
function loadManual(text: string) {
  if (!S.uri) return msg('Сначала включи трек.', 'err');
  const e = parseLRC(text), synced = e.length > 0;
  setLines(entriesToLines(synced ? e : parsePlain(text), S.meta.duration)); scheduleSave();
  msg(synced ? `Строк: ${S.lines.length}` : 'Меток времени нет — тайминги выдуманы (по 3.5 с на строку).', synced ? 'ok' : 'err');
}

/* ---------- lines editor ---------- */
function renderEditor() {
  const box = $('lines'); box.innerHTML = '';
  if (!S.lines.length) box.innerHTML = '<div class="st-hint">Тут будут строки трека.</div>';
  S.lines.forEach((l, i) => {
    const row = document.createElement('div'); row.className = 'st-ln'; row.id = 'st-ln' + i;
    row.innerHTML = '<div class="t"></div><div><div class="o"></div><input type="text" placeholder="перевод…"></div>';
    const t = row.querySelector('.t') as HTMLElement; t.textContent = mmss(l.t) + '.' + Math.floor((l.t % 1) * 10);
    t.onclick = () => { seekTo(l.t); selectWord(i, 0); };
    (row.querySelector('.o') as HTMLElement).textContent = l.text;
    const inp = row.querySelector('input') as HTMLInputElement; inp.value = l.tr || '';
    inp.oninput = () => {
      l.tr = inp.value;
      if (l.sync && l.sync.tr && l.sync.tr.length !== wordList(l.tr).length) delete l.sync.tr; // text changed -> old word timings no longer fit
      refreshRowMark(i); buildPreview(true); renderSync(); scheduleSave();
    };
    box.appendChild(row); refreshRowMark(i);
  });
}
function refreshRowMark(i: number) {
  const row = root.querySelector('#st-ln' + i); if (!row) return;
  const t = row.querySelector('.t') as HTMLElement; let d = t.querySelector('.st-sd');
  const st = lineState(i, mainLayerFor(i));
  if (st === 'done' && !d) { d = document.createElement('i'); d.className = 'st-sd'; t.appendChild(d); }
  if (st !== 'done' && d) d.remove();
}

/* ---------- translation ---------- */
const langName = () => ($('lang') as HTMLSelectElement).selectedOptions[0].textContent!.replace('на ', '');
function copyPrompt() {
  if (!S.lines.length) return msg('Сначала загрузи текст.', 'err');
  const p = `Переведи текст песни на язык: ${langName()}. Передавай смысл и настроение естественно, не дословно, сохраняй рифму там, где получается. ВАЖНО: ровно ${S.lines.length} строк в ответе, по одной на каждую строку оригинала, в том же порядке, только список без комментариев.\n\n` +
    S.lines.map((l, i) => `${i + 1}. ${plainW(l.text)}`).join('\n');
  copyText(p).then(ok => msg(ok ? 'Промпт скопирован. Ответ LLM вставь в поле ниже и нажми «Применить».' : 'Буфер заблокирован.', ok ? 'ok' : 'err'));
}
function parseLLM(txt: string) {
  const t = String(txt).replace(/```(?:json)?/g, ''), a = t.indexOf('['), b = t.lastIndexOf(']'); if (a < 0 || b < a) throw new Error('в ответе нет JSON-массива');
  const arr = JSON.parse(t.slice(a, b + 1)); if (!Array.isArray(arr)) throw new Error('ожидался массив');
  return arr.map((x: any, k: number) => typeof x === 'string' ? { i: k, tr: x } : { i: x.i ?? k, tr: String(x.tr ?? x.text ?? '') });
}
function applyTr(rows: { i: number; tr: string }[]) {
  let n = 0; rows.forEach(r => { const l = S.lines[r.i]; if (l && r.tr.trim()) { l.tr = r.tr.trim(); if (l.sync) delete l.sync.tr; n++; } });
  if (n) { S.layer = 'tr'; $('layer').value = 'tr'; }
  renderEditor(); buildPreview(true); renderSync(); scheduleSave(); return n;
}
function applyPaste() {
  const raw = $('paste').value.trim(); if (!raw) return;
  let n: number;
  if (/^[\[{`]/.test(raw)) { try { n = applyTr(parseLLM(raw)); } catch (e: any) { return msg('JSON не разобрался: ' + e.message, 'err'); } }
  else n = applyTr(raw.split(/\r?\n/).map((s: string) => s.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean).map((tr: string, i: number) => ({ i, tr })));
  msg(n === S.lines.length ? 'Перевод применён.' : `Применено строк: ${n} из ${S.lines.length}.`, n === S.lines.length ? 'ok' : 'err');
}
async function llmTranslate() {
  if (!S.lines.length) return msg('Сначала загрузи текст.', 'err');
  const prov = $('llmProv').value, model = $('llmModel').value.trim(), key = $('llmKey').value.trim(), style = $('llmStyle').value.trim();
  let url = $('llmUrl').value.trim().replace(/\/+$/, ''); if (!url && prov === 'anthropic') url = 'https://api.anthropic.com';
  if (!model || !url) return msg('Укажи модель и Base URL.', 'err');
  store.set('llm', JSON.stringify({ prov, model, key, url: $('llmUrl').value.trim(), style }));
  const sys = 'Ты литературный переводчик текстов песен. Переводи на язык: ' + langName() + '. Передавай смысл, настроение, сленг и рифму естественно, не дословно; число слов в строке держи близко к оригиналу (подсветка идёт по словам). Одинаковые строки (припев) переводи одинаково. Не склеивай и не разбивай строки. Ответ — ТОЛЬКО JSON-массив [{"i":число,"tr":"перевод"}], ровно по одному элементу на каждую входную строку, без комментариев и markdown.';
  const user = 'Песня: ' + S.meta.artist + ' — ' + S.meta.title + '\n' + (style ? 'Заметки/глоссарий: ' + style + '\n' : '') + 'Строки:\n' + JSON.stringify(S.lines.map((l, i) => ({ i, text: plainW(l.text) })));
  $('llm').disabled = true; msg('LLM переводит всю песню…');
  try {
    const r = prov === 'anthropic'
      ? await fetch(url + '/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify({ model, max_tokens: 8192, system: sys, messages: [{ role: 'user', content: user }] }) })
      : await fetch(url + '/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { authorization: 'Bearer ' + key } : {}) }, body: JSON.stringify({ model, temperature: 0.4, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] }) });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 160));
    const j = await r.json(), txt = prov === 'anthropic' ? j.content.map((c: any) => c.text || '').join('') : j.choices[0].message.content;
    const n = applyTr(parseLLM(txt));
    msg(n === S.lines.length ? 'Готово: переведена вся песня. Проверь и поправь.' : `Переведено ${n} из ${S.lines.length} строк — допиши недостающие.`, n === S.lines.length ? 'ok' : 'err');
  } catch (e: any) { msg('LLM: ' + e.message, 'err'); }
  $('llm').disabled = false;
}

/* ---------- preview ---------- */
function mkWords(arr: Word[]) { return arr.map(w => `<span class="w${w.b - w.a >= 1 ? ' em' : ''}" data-a="${w.a}" data-b="${w.b}"></span>${w.sp === false ? '' : ' '}`).join(''); }
function lineWords(i: number) {
  const l = S.lines[i], ml = mainLayerFor(i);
  const wm = getWords(layerText(l, ml), l.sync && l.sync[ml], l.t, l.end);
  const wb = mode() === 'bilingual' && l.tr && l.tr.trim() ? getWords(l.tr.trim(), l.sync && l.sync.tr, l.t, l.end) : null;
  return { wm, wb };
}
function buildPreview(keepPos?: boolean) {
  S.ver++;
  const inner = $('lyrIn'); inner.innerHTML = '';
  if (!S.lines.length) { inner.innerHTML = '<div class="st-empty">Тут появится превью караоке</div>'; return; }
  S.lines.forEach((l, i) => {
    const { wm, wb } = lineWords(i);
    const el = document.createElement('div'); el.className = 'st-pl'; el.id = 'st-pl' + i;
    el.innerHTML = mkWords(wm) + (wb ? `<span class="bg">${mkWords(wb)}</span>` : '');
    el.querySelectorAll<HTMLElement>(':scope > .w').forEach((n, k) => n.textContent = plainW(wm[k].word));
    if (wb) el.querySelectorAll<HTMLElement>('.bg .w').forEach((n, k) => n.textContent = plainW(wb[k].word));
    el.onclick = () => seekTo(l.t);
    inner.appendChild(el);
  });
  if (!keepPos) lastAct = -2;
}
function refreshPreviewLine(i: number) {
  S.ver++;
  const el = root.querySelector('#st-pl' + i); if (!el) return;
  const { wm, wb } = lineWords(i), nodes = el.querySelectorAll<HTMLElement>(':scope > .w');
  if (nodes.length !== wm.length) return buildPreview(true);
  nodes.forEach((n, k) => { n.dataset.a = String(wm[k].a); n.dataset.b = String(wm[k].b); n.classList.toggle('em', wm[k].b - wm[k].a >= 1); });
  if (wb) el.querySelectorAll<HTMLElement>('.bg .w').forEach((n, k) => { if (wb[k]) { n.dataset.a = String(wb[k].a); n.dataset.b = String(wb[k].b); } });
}
const RNG = { ver: -1, r: [] as { a: number; b: number }[] };
function ranges() { // per-line [start,end] for the main layer, recomputed only when lyrics/timings change
  if (RNG.ver === S.ver && RNG.r.length === S.lines.length) return RNG.r;
  RNG.ver = S.ver; RNG.r = S.lines.map((l, i) => {
    const ws = lineWords(i).wm;
    return ws.length ? { a: Math.min(l.t, ws[0].a), b: Math.max(l.end, ws[ws.length - 1].b) } : { a: l.t, b: l.end };
  });
  return RNG.r;
}
function paintWords(nodes: any[], T: number) {
  for (const n of nodes) {
    const a = +n.dataset.a, b = +n.dataset.b, p = Math.max(0, Math.min(1, (T - a) / Math.max(0.001, b - a)));
    const on = T >= a - 0.05 && T < b + 0.25, lift = on ? (T < b ? Math.min(1, (T - a + 0.05) / 0.12) : 1 - (T - b) / 0.25) : 0;
    const g = (p * 116 - 6).toFixed(1), lf = Math.max(0, lift).toFixed(2);
    if (n._g !== g) { n._g = g; n.style.setProperty('--g', g); }
    if (n._l !== lf) { n._l = lf; n.style.setProperty('--lift', lf); }
    if (n._on !== on) { n._on = on; n.classList.toggle('on', on); }
    const d = T >= b; if (n._d !== d) { n._d = d; n.classList.toggle('done', d); }
  }
}
let lastAct = -2, actNodes: any[] = [], nodesVer = -1, wasPlaying = false;
const LOOK = 0.3; // activate/scroll a line slightly before its first word, so CSS transitions finish on time
function frame() {
  if (!S.open) return;
  if (performance.now() - placedAt > 250) place();
  const t = now(), T = t + S.voff / 1000, R = ranges(), pl = playing();
  if (pl !== wasPlaying) { wasPlaying = pl; $('dock').classList.toggle('rec', pl); }
  let act = -1;
  for (let i = 0; i < R.length; i++) { if (T + LOOK >= R[i].a) act = i; else break; }
  const idx = act >= 0 && T <= R[act].b + 0.4 ? act : -1;
  if (idx !== lastAct) {
    paintWords(actNodes, T); lastAct = idx;
    root.querySelectorAll('.st-pl').forEach((e, i) => e.className = 'st-pl' + (S.fx ? ' fx' : '') + (i === idx ? ' act' : (Math.abs(i - idx) === 1 ? ' near' : '')));
    root.querySelectorAll('.st-ln').forEach((e, i) => e.classList.toggle('on', i === idx));
    const target = root.querySelector('#st-pl' + (idx >= 0 ? idx : Math.max(0, act))) as HTMLElement | null;
    if (target) $('lyrIn').style.transform = `translateY(${-(target.offsetTop - 20)}px)`;
    if (idx >= 0 && pl) { const r = root.querySelector('#st-ln' + idx); if (r) r.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    nodesVer = -1;
  }
  if (nodesVer !== S.ver) { nodesVer = S.ver; actNodes = idx >= 0 ? [...root.querySelectorAll('#st-pl' + idx + ' .w')] : []; }
  paintWords(actNodes, T);
  for (const c of S.chips) { const on = c.dataset.a != null && T >= +c.dataset.a && T < +c.dataset.b!; if ((c as any)._now !== on) { (c as any)._now = on; c.classList.toggle('now', on); } }
  if (S.loop && S.sel && pl) {
    const vw = viewWords(S.sel.i, S.layer).filter(x => x.a != null);
    if (vw.length) { const a = vw[0].a! - 0.4, b = vw[vw.length - 1].b! + 0.4; if (t > b || t < a - 1) seekTo(Math.max(0, a)); }
  }
  drawWave();
  requestAnimationFrame(frame);
}

/* ---------- undo ---------- */
const stateJSON = () => JSON.stringify(S.lines.map(l => ({ s: l.sync || null, x: l.text, t: l.tr || '' })));
function snap() { S.undo.push(stateJSON()); if (S.undo.length > 200) S.undo.shift(); S.redo = []; }
function restore(json: string) {
  const arr = JSON.parse(json); let txt = false;
  S.lines.forEach((l, i) => { const a = arr[i]; if (!a) return; if (a.s) l.sync = a.s; else delete l.sync; if (l.text !== a.x || (l.tr || '') !== a.t) txt = true; l.text = a.x; l.tr = a.t; });
  if (txt) { renderEditor(); buildPreview(true); }
  afterSyncChange(true);
}
function doUndo() { if (!S.undo.length) return; S.redo.push(stateJSON()); restore(S.undo.pop()!); }
function doRedo() { if (!S.redo.length) return; S.undo.push(stateJSON()); restore(S.redo.pop()!); }
function afterSyncChange(all: boolean, i = 0) {
  if (all) S.lines.forEach((_, k) => { refreshPreviewLine(k); refreshRowMark(k); }); else { refreshPreviewLine(i); refreshRowMark(i); }
  renderSync(); scheduleSave();
}

/* ---------- word selection + marking ---------- */
function selectWord(i: number, k: number) {
  if (i < 0 || i >= S.lines.length) return;
  S.sel = { i, k };
  let ch = false; for (let j = Math.max(0, i - 1); j <= Math.min(S.lines.length - 1, i + 2); j++) ch = fillLine(j, S.layer) || ch;
  if (ch) afterSyncChange(true); else renderSync();
}
function posList() { const out: { i: number; k: number }[] = []; S.lines.forEach((_, i) => wordsOf(i, S.layer).forEach((_, k) => out.push({ i, k }))); return out; }
function stepSel(d: number) {
  const L = posList(); if (!L.length) return null;
  let cur = S.sel ? L.findIndex(p => p.i === S.sel!.i && p.k === S.sel!.k) : -1;
  if (cur < 0) cur = 0; return L[Math.max(0, Math.min(L.length - 1, cur + d))];
}
function mark(kind: 'F' | 'G' | 'H') {
  if (!S.sel) return;
  const ws = wordsOf(S.sel.i, S.layer);
  if (!ws.length) { const n = stepSel(1); if (n) selectWord(n.i, n.k); return; }
  if (S.sel.k >= ws.length) S.sel.k = 0;
  snap();
  const sy = ensureSync(S.sel.i, S.layer), w = sy[S.sel.k];
  const t = r3(Math.max(0, now() - (+$('lat').value || 0) / 1000));
  const last = S.sel.k === ws.length - 1, li = S.sel.i;
  W.flash = { t, kind, at: performance.now() };
  if (kind === 'F') { w.a = t; if (w.b != null && w.b < t) w.b = null; }
  else {
    if (w.a == null) w.a = (S.sel.k > 0 && sy[S.sel.k - 1].b != null) ? sy[S.sel.k - 1].b : r3(Math.max(0, t - 0.15));
    w.b = Math.max(t, w.a!); conf(w);
    if (kind === 'G' && !last) { const n = sy[S.sel.k + 1]; n.a = w.b; if (n.b != null && n.b < n.a) n.b = null; }
    const nx = stepSel(1); if (nx) S.sel = { i: nx.i, k: nx.k };
  }
  afterSyncChange(false, li);
}
function nudgeWord(d: number) {
  if (!S.sel) return msg('Сначала выбери слово.', 'err');
  const sy = S.lines[S.sel.i].sync && S.lines[S.sel.i].sync![S.layer], x = sy && sy[S.sel.k];
  if (!x || x.a == null || x.b == null || x.a + d < 0) return;
  snap(); x.a = r3(x.a + d); x.b = r3(x.b + d); conf(x); afterSyncChange(false, S.sel.i);
}
function resetWord() {
  if (!S.sel) return msg('Сначала выбери слово.', 'err');
  snap(); const x = ensureSync(S.sel.i, S.layer)[S.sel.k]; if (x) { x.a = null; x.b = null; delete x.g; }
  fillLine(S.sel.i, S.layer); afterSyncChange(false, S.sel.i);
}
function playSel() { if (!S.sel) return; const w = viewWords(S.sel.i, S.layer)[S.sel.k]; if (w && w.a != null) playWord(w as any); }
function setLayerText(i: number, layer: Layer, text: string) {
  if (layer === 'tr') { S.lines[i].tr = text; const el = root.querySelector('#st-ln' + i + ' input') as HTMLInputElement | null; if (el) el.value = text; } else S.lines[i].text = text;
}
function joinWords() {
  if (!S.sel) return msg('Выбери первое из двух слов.', 'err');
  const { i, k } = S.sel, layer = S.layer, us = units(layerText(S.lines[i], layer));
  if (k >= us.length - 1) return msg('После этого слова нет следующего в строке.', 'err');
  snap(); const sy = ensureSync(i, layer), a = sy[k], b = sy[k + 1], syl = !us[k].sp;
  const m: Span = { a: a.a, b: b.b != null ? b.b : a.b }; if (a.g || b.g) m.g = 1;
  us.splice(k, 2, { w: us[k].w + (syl ? '' : ' ') + us[k + 1].w, sp: us[k + 1].sp }); sy.splice(k, 2, m);
  setLayerText(i, layer, unitsText(us)); S.lines[i].sync![layer] = sy;
  buildPreview(true); afterSyncChange(false, i);
  msg(syl ? 'Слоги склеены.' : 'Склеено: два слова — один блок тайминга. U — разделить.', 'ok');
}
function splitWord() {
  if (!S.sel) return msg('Выбери слово.', 'err');
  const { i, k } = S.sel, layer = S.layer, us = units(layerText(S.lines[i], layer)), u = us[k]; if (!u) return;
  const glued = u.w.includes(' '), parts = glued ? u.w.split(' ') : syllabify(u.w);
  if (parts.length < 2) return msg('Один слог — делить нечего. Можно вписать «|» в текст строки (газ|лай|тер).', 'err');
  snap(); const sy = ensureSync(i, layer), x = sy[k];
  const a = x.a != null ? x.a : S.lines[i].t, b = x.b != null ? x.b : S.lines[i].end;
  const nu = parts.map((w, j) => ({ w, sp: j === parts.length - 1 ? u.sp : glued }));
  const nw = splitWords(unitsText(nu), a, b).map(w => ({ a: r3(w.a), b: r3(w.b), ...(x.g ? { g: 1 as const } : {}) }));
  us.splice(k, 1, ...nu); sy.splice(k, 1, ...nw);
  setLayerText(i, layer, unitsText(us)); S.lines[i].sync![layer] = sy;
  buildPreview(true); afterSyncChange(false, i);
  msg(glued ? 'Разделено на отдельные слова.' : 'Слоги: ' + parts.join(' · ') + ' — размечай каждый как слово (F / G / H).', 'ok');
}
function syllabifyLine() {
  if (!S.sel) return msg('Выбери строку (клик по слову).', 'err');
  const i = S.sel.i, layer = S.layer, us = units(layerText(S.lines[i], layer)); if (!us.length) return;
  snap(); const sy = ensureSync(i, layer), nu: typeof us = [], ns: Span[] = []; let n = 0;
  us.forEach((u, k) => {
    const whole = u.sp && (k === 0 || us[k - 1].sp) && !u.w.includes(' '), parts = whole ? syllabify(u.w) : [u.w], x = sy[k];
    if (parts.length < 2) { nu.push(u); ns.push(x); return; }
    n++; const a = x.a != null ? x.a : S.lines[i].t, b = x.b != null ? x.b : S.lines[i].end;
    const pu = parts.map((w, j) => ({ w, sp: j === parts.length - 1 }));
    nu.push(...pu); ns.push(...splitWords(unitsText(pu), a, b).map(w => ({ a: r3(w.a), b: r3(w.b), ...(x.g ? { g: 1 as const } : {}) })));
  });
  if (!n) { S.undo.pop(); return msg('В строке нет многосложных слов.', 'err'); }
  setLayerText(i, layer, unitsText(nu)); S.lines[i].sync![layer] = ns;
  buildPreview(true); afterSyncChange(false, i); msg(`Разбито на слоги слов: ${n}. M — склеить слог обратно, Ctrl+Z — отмена.`, 'ok');
}

/* ---------- sync panel (chips) ---------- */
function renderSync() {
  const box = $('syncLines'); box.innerHTML = ''; S.chips = [];
  if (!S.lines.length) { box.innerHTML = '<div class="st-hint">Нет строк.</div>'; $('syncStat').textContent = ''; updateGuide(); return; }
  const ci = S.sel ? S.sel.i : 0;
  for (let i = Math.max(0, ci - 1); i <= Math.min(S.lines.length - 1, ci + 2); i++) {
    const row = document.createElement('div'); row.className = 'st-sl' + (i === ci ? ' cur' : '');
    const lab = document.createElement('span'); lab.className = 'lab'; lab.textContent = mmss(S.lines[i].t); row.appendChild(lab);
    const ws = wordsOf(i, S.layer), us = units(layerText(S.lines[i], S.layer)), vw = viewWords(i, S.layer), sy = S.lines[i].sync && S.lines[i].sync![S.layer];
    if (!ws.length) { const e = document.createElement('span'); e.className = 'st-hint'; e.textContent = S.layer === 'tr' ? '(нет перевода)' : '(пусто)'; row.appendChild(e); }
    ws.forEach((w, k) => {
      const c = document.createElement('span'); c.className = 'st-chip' + (w.includes(' ') ? ' grp' : ''); c.textContent = plainW(w);
      const x = sy && sy.length === ws.length ? sy[k] : null;
      if (x && x.a != null && x.b != null) c.classList.add(x.g ? 'half' : 't');
      if (S.sel && S.sel.i === i && S.sel.k === k) c.classList.add('sel');
      if (!us[k].sp && k < ws.length - 1) c.classList.add('syl'); if (k && !us[k - 1].sp) c.classList.add('cont');
      if (vw[k] && vw[k].a != null) { c.dataset.a = String(vw[k].a); c.dataset.b = String(vw[k].b); }
      c.onclick = () => selectWord(i, k);
      c.oncontextmenu = e => { e.preventDefault(); const v = viewWords(i, S.layer)[k]; if (v && v.a != null) playWord(v as any); };
      row.appendChild(c);
    });
    box.appendChild(row);
  }
  S.chips = [...(box as HTMLElement).querySelectorAll<HTMLElement>('.st-chip')];
  let done = 0; S.lines.forEach((_, i) => { if (lineState(i, S.layer) === 'done') done++; });
  $('syncStat').textContent = `строк готово: ${done}/${S.lines.length}`;
  updateGuide();
}
function updateGuide() {
  let m: string;
  if (!S.lines.length) m = 'Включи трек в Spotify — текст подтянется из LRCLIB.';
  else if (S.layer === 'tr' && !S.lines.some(l => l.tr && l.tr.trim())) m = 'Перевода ещё нет — меню «Перевод» или размечай оригинал.';
  else if (S.sel) { const w = wordsOf(S.sel.i, S.layer)[S.sel.k]; m = '<b>«' + (w ? plainW(w).replace(/</g, '&lt;') : '—') + '»</b> · строка ' + (S.sel.i + 1) + ' — Space и жми F, потом G на каждом слове'; }
  else m = 'Кликни слово, с которого начнёшь.';
  $('guide').innerHTML = m;
  const x = S.sel && S.lines[S.sel.i].sync && S.lines[S.sel.i].sync![S.layer], q = x && x[S.sel!.k];
  $('info').textContent = q && q.a != null && q.b != null ? `${fmtTime(q.a)} → ${fmtTime(q.b)} (${Math.round((q.b - q.a) * 1000)} мс)${q.g ? ' · авто' : ''}` : '';
}

/* ---------- timeline (word blocks instead of a waveform — the stream is DRM) ---------- */
const W = { px: 140, start: 0, drag: null as any, pend: null as any, boxes: [] as any[], LANE: 46, flash: null as any, snapAt: null as number | null, ctrl: false };
const JOIN = 0.0015;
function drawWave() {
  const cv = $('wave') as HTMLCanvasElement;
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  const t = now();
  if (playing() && !W.drag) { if (t < W.start || t > W.start + w / W.px * 0.8) W.start = Math.max(0, t - w / W.px * 0.25); }
  const t0 = W.start, t1 = t0 + w / W.px, X = (tt: number) => (tt - t0) * W.px, LANE = W.LANE;
  // ruler
  g.fillStyle = 'rgba(255,255,255,.35)'; g.font = '10px ui-monospace,monospace'; g.textBaseline = 'top';
  const step = W.px > 400 ? 0.5 : W.px > 150 ? 1 : W.px > 60 ? 2 : 5;
  for (let s = Math.ceil(t0 / step) * step; s < t1; s += step) { const x = X(s); g.fillRect(x, h - 6, 1, 6); g.fillText(mmss(s) + (step < 1 ? '.' + Math.round((s % 1) * 10) : ''), x + 3, h - 15); }
  // lower band: source lines (LRC timing) with original text, for orientation
  g.font = '12px system-ui'; g.textBaseline = 'middle';
  S.lines.forEach(l => {
    if (l.end < t0 || l.t > t1) return;
    const x1 = X(l.t), x2 = X(l.end);
    g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(x1, LANE + 6, Math.max(2, x2 - x1 - 2), h - LANE - 26);
    g.fillStyle = 'rgba(255,255,255,.3)'; g.fillRect(x1, LANE + 6, 1, h - LANE - 26);
    g.save(); g.beginPath(); g.rect(x1 + 4, LANE + 6, Math.max(0, x2 - x1 - 8), h - LANE - 26); g.clip(); g.fillText(plainW(l.text), x1 + 6, LANE + 6 + (h - LANE - 26) / 2); g.restore();
  });
  // word boxes
  W.boxes = [];
  g.font = '600 14px system-ui';
  for (let i = 0; i < S.lines.length; i++) {
    const l = S.lines[i]; if (l.end + 8 < t0 || l.t - 8 > t1) continue;
    viewWords(i, S.layer).forEach((wd, k) => {
      if (wd.a == null || wd.b == null) return;
      const x1 = X(wd.a), x2 = X(wd.b); if (x2 < -2 || x1 > w + 2) return;
      const sel = S.sel && S.sel.i === i && S.sel.k === k;
      if (wd.real) {
        g.fillStyle = sel ? 'rgba(255,122,200,.45)' : wd.g ? 'rgba(182,156,255,.16)' : 'rgba(182,156,255,.35)'; g.fillRect(x1, 3, Math.max(2, x2 - x1), LANE - 6);
        g.strokeStyle = sel ? '#ff7ac8' : 'rgba(182,156,255,.9)'; g.fillStyle = sel ? '#ff7ac8' : 'rgba(182,156,255,.95)'; g.fillRect(x1, 3, 3, LANE - 6); g.fillRect(x2 - 3, 3, 3, LANE - 6); if (wd.g) g.setLineDash([3, 3]); g.strokeRect(x1 + .5, 3.5, Math.max(2, x2 - x1) - 1, LANE - 7); g.setLineDash([]);
      } else { g.setLineDash([3, 3]); g.strokeStyle = sel ? '#ff7ac8' : 'rgba(255,255,255,.25)'; g.strokeRect(x1 + .5, 3.5, Math.max(2, x2 - x1) - 1, LANE - 7); g.setLineDash([]); }
      g.save(); g.beginPath(); g.rect(x1 + 2, 3, Math.max(0, x2 - x1 - 4), LANE - 6); g.clip();
      g.fillStyle = wd.real ? '#fff' : 'rgba(255,255,255,.45)'; g.fillText((wd.b - wd.a >= 1 ? '✦ ' : '') + plainW(wd.word) + (wd.sp === false ? '-' : ''), x1 + 5, LANE / 2 + 1); g.restore();
      W.boxes.push({ i, k, a: wd.a, b: wd.b, real: !!wd.real });
    });
  }
  // joined edges (touching words) get a bright joint so you can see what moves together
  const rb = W.boxes.filter(b => b.real).sort((p, q) => p.a - q.a);
  for (let q = 0; q + 1 < rb.length; q++) if (Math.abs(rb[q].b - rb[q + 1].a) <= JOIN) { g.fillStyle = '#fff'; g.fillRect(X(rb[q].b) - 1, 3, 2, LANE - 6); }
  g.fillStyle = '#fff'; g.fillRect(X(t), 0, 1.5, h); // playhead
  if (W.flash) {
    const age = (performance.now() - W.flash.at) / 800;
    if (age < 1) { const fx = X(W.flash.t), col = ({ F: '110,231,183', G: '182,156,255', H: '255,122,200' } as any)[W.flash.kind]; g.fillStyle = `rgba(${col},${(1 - age).toFixed(2)})`; g.fillRect(fx - 1.5, 0, 3, h); g.font = '800 13px ui-monospace,monospace'; g.textBaseline = 'top'; g.fillText(W.flash.kind, fx + 5, LANE + 4); }
    else W.flash = null;
  }
  if (W.snapAt != null && W.drag) { const sx = X(W.snapAt); g.fillStyle = '#ffd166'; g.fillRect(sx - 0.75, 0, 1.5, h); }
}
function waveHit(mx: number, my: number) {
  const t = W.start + mx / W.px, tol = 9 / W.px, lane = my < W.LANE;
  let best: any = null;
  for (const b of W.boxes) {
    if (!b.real) continue;
    for (const edge of ['a', 'b']) { const d = Math.abs(b[edge] - t); if (d <= tol && (!best || d < best.d)) best = { d, b, edge }; }
  }
  if (best) return { type: 'edge', t, ...best };
  if (lane) for (const b of W.boxes) if (t >= b.a && t <= b.b) return { type: 'word', t, b };
  return { type: lane ? 'lane' : 'bg', t };
}
/* DaVinci-style editing: magnet snapping, roll (joined edges move together), Alt = detach, no overlaps */
function seqWords() {
  const out: { i: number; k: number; x: { a: number; b: number; g?: 1 } }[] = [];
  S.lines.forEach((l, i) => {
    const sy = l.sync && l.sync[S.layer]; if (!sy || sy.length !== wordsOf(i, S.layer).length) return;
    sy.forEach((x, k) => { if (x.a != null && x.b != null) out.push({ i, k, x: x as any }); });
  });
  return out;
}
function buildCands(excl: Set<any>) { const out: number[] = []; seqWords().forEach(e => { if (!excl.has(e.x)) out.push(e.x.a, e.x.b); }); S.lines.forEach(l => out.push(l.t)); return out; }
function nearestCand(t: number, cands: number[]) {
  if (!S.snap || W.ctrl) return null;
  const tol = 10 / W.px; let best: { d: number; c: number } | null = null;
  for (const c of cands.concat([now()])) { const d = Math.abs(c - t); if (d <= tol && (!best || d < best.d)) best = { d, c }; }
  return best;
}
function snapOne(t: number, cands: number[]) { const n = nearestCand(t, cands); W.snapAt = n ? n.c : null; return n ? n.c : t; }
function setupWave() {
  const cv = $('wave') as HTMLCanvasElement;
  const tAt = (mx: number) => Math.max(0, r3(W.start + mx / W.px));
  cv.onmousedown = e => {
    const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, h = waveHit(mx, my);
    W.ctrl = e.ctrlKey || e.metaKey;
    if (e.button === 2) { if (h.b) playWord({ a: h.b.a, b: h.b.b }); return; }
    if (h.type === 'edge') {
      const sq = seqWords(), idx = sq.findIndex(q => q.i === h.b.i && q.k === h.b.k); if (idx < 0) return;
      const me = sq[idx], x = me.x; let partner = null;
      if (h.edge === 'b') { const n = sq[idx + 1]; if (n && Math.abs(n.x.a - x.b) <= JOIN) partner = n; }
      else { const p = sq[idx - 1]; if (p && Math.abs(p.x.b - x.a) <= JOIN) partner = p; }
      let target = { e: me, edge: h.edge };
      if (partner && e.altKey) { // detach: trim only the side the cursor is on
        const bt = h.edge === 'b' ? x.b : x.a, leftWord = h.edge === 'b' ? me : partner, rightWord = h.edge === 'b' ? partner : me;
        target = h.t < bt ? { e: leftWord, edge: 'b' } : { e: rightWord, edge: 'a' };
      }
      snap(); selectWord(h.b.i, h.b.k);
      const excl = new Set([x]); if (partner) excl.add(partner.x);
      W.drag = { type: 'edge', roll: !!partner && !e.altKey, me, partner, target, sq, edge: h.edge, cands: buildCands(excl), i: h.b.i };
    }
    else if (h.type === 'word') { selectWord(h.b.i, h.b.k); W.pend = { type: 'move', i: h.b.i, k: h.b.k, x0: mx, off: h.t - h.b.a, ghost: !h.b.real }; }
    else if (h.type === 'lane' && S.sel) W.pend = { type: 'paint', x0: mx, t0: h.t };
    else W.pend = { type: 'pan', x0: mx, start0: W.start, t0: h.t };
  };
  window.addEventListener('mousemove', e => {
    if (!S.open) return;
    const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    W.ctrl = e.ctrlKey || e.metaKey;
    if (W.pend && !W.drag && Math.abs(mx - W.pend.x0) > 3) {
      const p = W.pend;
      if (p.type === 'move') {
        snap(); if (p.ghost) spreadLine(p.i, S.layer);
        const sq = seqWords(), idx = sq.findIndex(q => q.i === p.i && q.k === p.k);
        if (idx >= 0) {
          const me = sq[idx], pv = sq[idx - 1], nx = sq[idx + 1];
          const jp = !!(pv && Math.abs(pv.x.b - me.x.a) <= JOIN), jn = !!(nx && Math.abs(nx.x.a - me.x.b) <= JOIN);
          const excl = new Set([me.x]); if (jp) excl.add(pv.x); if (jn) excl.add(nx.x);
          W.drag = { type: 'move', i: p.i, me, pv, nx, jp, jn, off: p.off, len: me.x.b - me.x.a, cands: buildCands(excl) };
        }
      }
      else if (p.type === 'paint') { snap(); const sx = ensureSync(S.sel!.i, S.layer)[S.sel!.k]; W.drag = { type: 'paint', i: S.sel!.i, k: S.sel!.k, t0: p.t0, cands: buildCands(new Set([sx])) }; }
      else W.drag = { type: 'pan', x0: p.x0, start0: p.start0 };
      W.pend = null;
    }
    const d = W.drag;
    if (d) {
      if (d.type === 'pan') { W.start = Math.max(0, d.start0 - (mx - d.x0) / W.px); cv.style.cursor = 'grabbing'; return; }
      const traw = tAt(mx);
      if (d.type === 'paint') {
        const t = snapOne(traw, d.cands), w = S.lines[d.i].sync![S.layer]![d.k]; w.a = Math.min(d.t0, t); w.b = Math.max(d.t0, t, w.a + 0.02); conf(w);
      } else if (d.type === 'edge') {
        const t0 = snapOne(traw, d.cands), sq = d.sq;
        if (d.roll) {
          const L = d.edge === 'b' ? d.me : d.partner, R = d.edge === 'b' ? d.partner : d.me;
          const T = clamp(t0, L.x.a + 0.02, R.x.b - 0.02); if (T !== t0) W.snapAt = null;
          L.x.b = T; R.x.a = T; conf(L.x, R.x);
        } else {
          const te = d.target.e, ti = sq.indexOf(te), pv = sq[ti - 1], nx = sq[ti + 1];
          if (d.target.edge === 'a') { const T = clamp(t0, pv ? pv.x.b : 0, te.x.b - 0.02); if (T !== t0) W.snapAt = null; te.x.a = T; conf(te.x); }
          else { const T = clamp(t0, te.x.a + 0.02, nx ? nx.x.a : 1e9); if (T !== t0) W.snapAt = null; te.x.b = T; conf(te.x); }
        }
      } else if (d.type === 'move') {
        const w = d.me.x, len = d.len, follow = !e.altKey;
        let a = Math.max(0, traw - d.off);
        const na = nearestCand(a, d.cands), nb = nearestCand(a + len, d.cands);
        if (na && (!nb || na.d <= nb.d)) { a = na.c; W.snapAt = na.c; } else if (nb) { a = nb.c - len; W.snapAt = nb.c; } else W.snapAt = null;
        const pv = d.pv, nx = d.nx;
        const lo = follow && d.jp ? pv.x.a + 0.02 : (pv ? pv.x.b : 0);
        const hi = follow && d.jn ? nx.x.b - 0.02 - len : (nx ? nx.x.a - len : 1e9);
        const a2 = clamp(a, lo, hi); if (a2 !== a) W.snapAt = null;
        w.a = r3(a2); w.b = r3(a2 + len); conf(w, follow && d.jp ? pv.x : null, follow && d.jn ? nx.x : null);
        if (follow && d.jp) pv.x.b = w.a; if (follow && d.jn) nx.x.a = w.b;
      }
      refreshPreviewLine(d.i); return;
    }
    if (mx >= 0 && mx <= r.width && my >= 0 && my <= r.height) { const h = waveHit(mx, my); cv.style.cursor = h.type === 'edge' ? 'ew-resize' : h.type === 'word' ? 'grab' : h.type === 'lane' && S.sel ? 'crosshair' : 'default'; }
  });
  window.addEventListener('mouseup', () => {
    if (W.pend) { if (W.pend.type === 'pan' || W.pend.type === 'paint') seekTo(W.pend.t0); W.pend = null; return; }
    if (W.drag) {
      const d = W.drag; W.drag = null; W.snapAt = null;
      if (d.type === 'paint') { const n = stepSel(1); if (n) S.sel = { i: n.i, k: n.k }; }
      if (d.type !== 'pan') { S.lines.forEach((_, i) => { refreshPreviewLine(i); refreshRowMark(i); }); renderSync(); scheduleSave(); }
    }
  });
  cv.oncontextmenu = e => e.preventDefault();
  cv.onwheel = e => {
    e.preventDefault(); const r = cv.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) zoomAt(e.clientX - r.left, e.deltaY < 0 ? 1.18 : 1 / 1.18);
    else W.start = Math.max(0, W.start + (e.deltaX || e.deltaY) / W.px * 1.2);
  };
}
function zoomAt(mx: number, f: number) { const ta = W.start + mx / W.px; W.px = Math.min(1500, Math.max(20, W.px * f)); W.start = Math.max(0, ta - mx / W.px); }
function centerOnSel() {
  if (!S.sel) return; const ws = viewWords(S.sel.i, S.layer).filter(x => x.a != null); if (!ws.length) return;
  const a = ws[0].a!, b = ws[ws.length - 1].b!, width = $('wave').clientWidth || 800;
  W.px = clamp(width * 0.8 / Math.max(0.5, b - a), 40, 600); W.start = Math.max(0, a - (width * 0.1) / W.px);
}

/* ---------- export ---------- */
async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  try { const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; } catch { return false; }
}
function opts(): TTMLOpts {
  return { lines: S.lines, mode: mode(), wordSpread: $('spread').checked, lang: $('lang').value,
    offset: parseInt($('offset').value, 10) || 0, songwriters: $('writers').value.split(',').map((s: string) => s.trim()) };
}
function ttml() {
  if (!S.lines.length) { msg('Нечего экспортировать — нет строк.', 'err'); return null; }
  return buildTTML(opts());
}
async function toSpicy() {
  const x = ttml(); if (!x) return;
  try {
    await putToSpicy(S.uri, x);
    msg('Залито в Spicy Lyrics (Local DB) для этого трека. Чтобы увидеть — переключи на другой трек и обратно: текущую лирику Spicy держит в памяти.', 'ok');
  } catch (e: any) { msg('Не вышло записать в Spicy Lyrics (' + (e && e.message || e) + '). Скачай .ttml → Lyrics Manager → Upload TTML.', 'err'); }
}
function download() {
  const x = ttml(); if (!x) return;
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([x], { type: 'application/xml' }));
  a.download = `${(S.meta.artist + ' - ' + S.meta.title).replace(/[\\/:*?"<>|]/g, '').trim() || 'lyrics'} (${$('lang').value}).ttml`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  msg('Файл отдан на скачивание. Не появился — жми «Копировать TTML».', 'ok');
}
function runQa() {
  const r = qaCheck(S.lines, mode()), box = $('qaOut'); box.innerHTML = '';
  const e = r.filter(x => x.sev === 'err').length;
  msg(S.lines.length ? (r.length ? `QA: ошибок ${e}, замечаний ${r.length - e}` : 'QA: всё чисто ✓') : '', e ? 'err' : 'ok');
  r.slice(0, 80).forEach(x => {
    const d = document.createElement('div'); d.className = x.sev; d.textContent = `строка ${x.i + 1}: ${x.msg}`;
    d.onclick = () => { S.layer = mainLayerFor(x.i); $('layer').value = S.layer; seekTo(S.lines[x.i].t); selectWord(x.i, 0); centerOnSel(); };
    box.appendChild(d);
  });
}

/* ---------- hotkeys (capture phase: Spotify must not see the keys we use, e.g. Space) ---------- */
const KEYS = new Set(['KeyM', 'KeyU', 'KeyN', 'KeyL', 'KeyR', 'Comma', 'Period', 'Space', 'KeyF', 'KeyG', 'KeyH', 'KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight', 'Delete', 'Backspace']);
function onKey(e: KeyboardEvent) {
  if (!S.open) return;
  const tg = e.target as HTMLElement, tag = tg && tg.tagName;
  if (e.code === 'Escape') { // peel one layer per press: help → menus → text field → the panel itself
    e.stopImmediatePropagation();
    const menus = root.querySelectorAll('details[open]'), act = document.activeElement as HTMLElement | null;
    if (!$('help').hidden) $('help').hidden = true;
    else if (menus.length) menus.forEach(d => (d as HTMLDetailsElement).open = false);
    else if (act && root.contains(act) && /^(INPUT|TEXTAREA|SELECT)$/.test(act.tagName)) act.blur();
    else toggle(false);
    return;
  }
  if (tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && !['range', 'checkbox', 'radio'].includes((tg as HTMLInputElement).type))) return;
  if (!$('help').hidden) return;
  const c = e.code;
  if ((e.ctrlKey || e.metaKey) && c === 'KeyZ') { e.preventDefault(); e.stopImmediatePropagation(); e.shiftKey ? doRedo() : doUndo(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey || !KEYS.has(c)) return;
  e.preventDefault(); e.stopImmediatePropagation();
  if (c === 'Space') { if (!e.repeat) P().togglePlay(); return; }
  if (c === 'ArrowLeft') return seekTo(now() - (e.shiftKey ? 1 : 5));
  if (c === 'ArrowRight') return seekTo(now() + (e.shiftKey ? 1 : 5));
  if (c === 'Comma' || c === 'Period') return nudgeWord((c === 'Comma' ? -1 : 1) * (e.shiftKey ? 0.05 : 0.01));
  if (c === 'KeyM') return joinWords();
  if (c === 'KeyU') return splitWord();
  if (e.repeat) return;
  if (c === 'KeyN') { S.snap = !S.snap; $('snapChk').checked = S.snap; store.set('snap', S.snap ? '1' : '0'); return msg(S.snap ? '🧲 Магнит включён (N). Ctrl при перетаскивании — отключает на лету.' : 'Магнит выключен (N).', 'ok'); }
  if (c === 'KeyL') return setLoop(!S.loop);
  if (c === 'KeyR') { if (S.sel) { const vw = viewWords(S.sel.i, S.layer).filter(x => x.a != null); seekTo(Math.max(0, (vw.length ? vw[0].a! : S.lines[S.sel.i].t) - 0.4)); } return; }
  if (c === 'KeyA' || c === 'KeyD') { const n = stepSel(c === 'KeyA' ? -1 : 1); if (n) selectWord(n.i, n.k); return; }
  if (c === 'Delete' || c === 'Backspace') return resetWord();
  mark(c === 'KeyF' ? 'F' : c === 'KeyG' ? 'G' : 'H');
}
function setLoop(on: boolean) { S.loop = on; $('loop').classList.toggle('pri', on); msg(on ? '🔁 Цикл выбранной строки включён (L).' : 'Цикл выключен.', 'ok'); }

/* ---------- mount ---------- */
const LANGS: [string, string][] = [['ru', 'русский'], ['en', 'английский'], ['uk', 'украинский'], ['kk', 'казахский'], ['be', 'белорусский'], ['es', 'испанский'], ['de', 'немецкий'], ['fr', 'французский'], ['it', 'итальянский'], ['pt', 'португальский'], ['tr', 'турецкий'], ['pl', 'польский'], ['ja', 'японский'], ['ko', 'корейский'], ['zh-CN', 'китайский']];
const HTML = `
<div class="st-bar">
  <div class="st-logo">S</div>
  <div class="st-ttl"><b id="st-title">Spicy Translate</b><small id="st-artist"></small></div>
  <span class="st-status" id="st-status"></span>
  <details class="st-menu"><summary class="st-btn">Текст</summary><div class="st-pop">
    <button id="st-reload">↻ Заново из LRCLIB (сбросит проект)</button>
    <textarea id="st-manual" placeholder="[00:12.30] первая строка&#10;[00:15.80] вторая строка&#10;или просто текст, строка за строкой"></textarea>
    <button id="st-manualApply">Загрузить LRC / текст</button>
  </div></details>
  <details class="st-menu"><summary class="st-btn">Перевод</summary><div class="st-pop wide">
    <select id="st-lang">${LANGS.map(([v, n]) => `<option value="${v}">на ${n}</option>`).join('')}</select>
    <button id="st-prompt">Скопировать промпт для LLM</button>
    <textarea id="st-paste" placeholder="Вставь перевод: строка на строку оригинала (нумерация «1.» ок) или JSON [{&quot;i&quot;:0,&quot;tr&quot;:&quot;…&quot;}]"></textarea>
    <button id="st-pasteApply">Применить вставку</button>
    <p class="st-hint">LLM с контекстом всей песни (ключ хранится только в этом Spotify):</p>
    <select id="st-llmProv"><option value="openai">OpenAI-совместимый (OpenRouter, Ollama, LM Studio…)</option><option value="anthropic">Anthropic (Claude)</option></select>
    <input type="text" id="st-llmModel" placeholder="модель, напр. claude-sonnet-5-5">
    <input type="text" id="st-llmUrl" placeholder="Base URL (openai: https://openrouter.ai/api/v1)">
    <input type="password" id="st-llmKey" placeholder="API-ключ">
    <textarea id="st-llmStyle" style="min-height:50px" placeholder="Стиль и глоссарий: «разговорный», имена не переводить…"></textarea>
    <button class="pri" id="st-llm">Перевести через LLM</button>
  </div></details>
  <details class="st-menu"><summary class="st-btn pri">Экспорт</summary><div class="st-pop">
    <label class="st-opt"><span>Только перевод<small>перевод = основная лирика (надёжно)</small></span><input type="radio" name="st-mode" value="translation" checked></label>
    <label class="st-opt"><span>Оригинал + перевод<small>перевод фоновым вокалом (x-bg), экспериментально</small></span><input type="radio" name="st-mode" value="bilingual"></label>
    <label class="st-opt"><span>Пословная подсветка<small>неразмеченные слова — равномерно</small></span><input type="checkbox" id="st-spread" checked></label>
    <label class="st-opt"><span>Сдвиг, мс</span><input type="number" id="st-offset" value="0" step="50"></label>
    <input type="text" id="st-writers" placeholder="Авторы текста через запятую (необязательно)">
    <button class="pri" id="st-toSpicy">⇪ Залить в Spicy Lyrics</button>
    <button id="st-dl">Скачать .ttml</button>
    <button id="st-copy">Копировать TTML</button>
    <button id="st-qa">✔ Проверка (QA)</button>
    <div class="st-qa" id="st-qaOut"></div>
  </div></details>
  <details class="st-menu"><summary class="st-btn">⚙</summary><div class="st-pop">
    <label class="st-opt"><span>Реакция, мс<small>вычитается из момента нажатия F/G/H</small></span><input type="number" id="st-lat" value="100" step="10" min="0" max="500"></label>
    <label class="st-opt"><span>Сдвиг превью, мс<small>отстаёт → плюс, спешит → минус</small></span><input type="number" id="st-voff" value="0" step="10"></label>
    <label class="st-opt"><span>Магнит <kbd>N</kbd></span><input type="checkbox" id="st-snapChk" checked></label>
    <label class="st-opt"><span>Эффекты слов в превью</span><input type="checkbox" id="st-fxChk" checked></label>
  </div></details>
  <button id="st-helpBtn" title="Как размечать">?</button>
  <button id="st-close" title="Закрыть">✕</button>
</div>
<div class="st-main">
  <div class="st-lines" id="st-lines"></div>
  <div class="st-stage"><div class="st-lyr"><div class="st-lyrIn" id="st-lyrIn"></div></div></div>
</div>
<div class="st-dock" id="st-dock">
  <div class="st-dbar">
    <select id="st-layer" title="Что размечаем"><option value="tr">перевод</option><option value="orig">оригинал</option></select>
    <span class="st-guide" id="st-guide"></span>
    <small class="st-stat" id="st-syncStat"></small>
    <button id="st-zoomOut" title="Ctrl+колесо">−</button><button id="st-zoomIn">+</button><button id="st-fit">⤢ строка</button>
    <button id="st-loop" title="L">🔁</button>
  </div>
  <canvas class="st-wave" id="st-wave"></canvas>
  <div class="st-sync" id="st-syncLines"></div>
  <div class="st-actions">
    <span class="st-grp"><button id="st-prev" title="A">‹</button><button id="st-next" title="D">›</button></span>
    <span class="st-grp">
      <button class="st-mk" id="st-F" title="Певец НАЧАЛ слово"><kbd>F</kbd>Начало</button>
      <button class="st-mk kg" id="st-G" title="Началось СЛЕДУЮЩЕЕ слово"><kbd>G</kbd>Следующее</button>
      <button class="st-mk kh" id="st-H" title="Конец перед паузой / концом строки"><kbd>H</kbd>Конец</button>
    </span>
    <span class="st-grp"><button id="st-back" title=",">−10</button><button id="st-fwd" title=".">+10</button><button id="st-play" title="Проиграть слово">▶</button><button id="st-reset" title="Del">⌫</button></span>
    <span class="st-grp"><button id="st-join" title="M">⛓ Склеить</button><button id="st-split" title="U">✂ Слоги</button>
      <details class="st-menu up"><summary class="st-btn">Строка ⋯</summary><div class="st-pop">
        <button id="st-sylLine">✂ Разбить строку на слоги</button>
        <button id="st-lineSpread">↔ Раскидать слова строки ровно</button>
        <button id="st-allSpread">↔ Раскидать все неразмеченные строки</button>
        <button id="st-lineReset">⌫ Сбросить строку</button>
      </div></details>
    </span>
    <span class="st-grp"><button id="st-undo" title="Ctrl+Z">↶</button><button id="st-redo" title="Ctrl+Shift+Z">↷</button></span>
    <span class="st-info" id="st-info"></span>
  </div>
</div>
<div class="st-help" id="st-help" hidden><div>
  <h3>Как размечать слова</h3>
  <ol>
    <li>Включи трек в Spotify и открой панель — текст подтянется из LRCLIB, проект сохраняется на этот трек.</li>
    <li>Переведи (меню «Перевод») или размечай оригинал (селектор слева внизу).</li>
    <li>Кликни первое слово, <kbd>Space</kbd> — играть. <kbd>F</kbd> начало слова, <kbd>G</kbd> — началось следующее, <kbd>H</kbd> — конец перед паузой.</li>
    <li>Промах — <kbd>Ctrl+Z</kbd> или тащи блок/край на таймлайне.</li>
    <li>«Экспорт» → «Залить в Spicy Lyrics», потом переключи трек туда-обратно.</li>
  </ol>
  <p><kbd>A</kbd>/<kbd>D</kbd> слово · <kbd>←</kbd>/<kbd>→</kbd> ±5 с (Shift ±1) · <kbd>L</kbd> цикл строки · <kbd>R</kbd> к началу строки · <kbd>,</kbd> <kbd>.</kbd> сдвиг ±10 мс (Shift ±50) · <kbd>Del</kbd> сбросить · <kbd>M</kbd> склеить · <kbd>U</kbd> слоги/разделить · <kbd>N</kbd> магнит</p>
  <p>Таймлайн: тащи блок или край · белая перемычка = края склеены (<kbd>Alt</kbd> — отцепить, <kbd>Ctrl</kbd> — без магнита) · верх: зажми и проведи = «нарисовать» слово · низ: тащи = листать, клик = перемотка · <kbd>Ctrl</kbd>+колесо = зум · ПКМ = проиграть слово. Слоги: впиши <b>|</b> в тексте (кра|си|вый). Скорость воспроизведения в Spotify для музыки не меняется.</p>
  <button id="st-helpClose">Понятно</button>
</div></div>`;

function mount() {
  const style = document.createElement('style'); style.id = 'spicy-translate-css'; style.textContent = css; document.head.appendChild(style);
  root = document.createElement('div'); root.className = 'st'; root.hidden = true; root.innerHTML = HTML; document.body.appendChild(root);
  const on = (id: string, f: () => unknown) => { $(id).onclick = f; };
  on('close', () => toggle(false));
  on('helpBtn', () => { $('help').hidden = false; }); on('helpClose', () => { $('help').hidden = true; });
  on('reload', () => { if (confirm('Перезагрузить текст из LRCLIB? Перевод и разметка этого трека пропадут.')) loadTrack(true); });
  on('manualApply', () => loadManual($('manual').value));
  on('prompt', copyPrompt); on('pasteApply', applyPaste); on('llm', llmTranslate);
  on('toSpicy', toSpicy); on('dl', download); on('qa', runQa);
  on('copy', async () => { const x = ttml(); if (x) msg((await copyText(x)) ? 'TTML скопирован в буфер.' : 'Буфер заблокирован.', 'ok'); });
  on('zoomIn', () => zoomAt(($('wave').clientWidth || 800) / 2, 1.4)); on('zoomOut', () => zoomAt(($('wave').clientWidth || 800) / 2, 1 / 1.4)); on('fit', centerOnSel);
  on('loop', () => setLoop(!S.loop));
  on('prev', () => { const n = stepSel(-1); if (n) selectWord(n.i, n.k); }); on('next', () => { const n = stepSel(1); if (n) selectWord(n.i, n.k); });
  on('F', () => mark('F')); on('G', () => mark('G')); on('H', () => mark('H'));
  on('back', () => nudgeWord(-0.01)); on('fwd', () => nudgeWord(0.01)); on('play', playSel); on('reset', resetWord);
  on('join', joinWords); on('split', splitWord); on('sylLine', syllabifyLine); on('undo', doUndo); on('redo', doRedo);
  on('lineSpread', () => { if (!S.sel) return msg('Сначала выбери слово.', 'err'); snap(); spreadLine(S.sel.i, S.layer); afterSyncChange(false, S.sel.i); });
  on('allSpread', () => { snap(); S.lines.forEach((_, i) => { if (lineState(i, S.layer) !== 'done') spreadLine(i, S.layer); }); afterSyncChange(true); });
  on('lineReset', () => { if (!S.sel) return; snap(); const l = S.lines[S.sel.i]; if (l.sync) delete l.sync[S.layer]; afterSyncChange(false, S.sel.i); });
  $('layer').onchange = () => { S.layer = $('layer').value; renderSync(); };
  root.querySelectorAll('input[name=st-mode]').forEach(r => (r as HTMLInputElement).onchange = () => {
    const bi = mode() === 'bilingual'; $('spread').checked = true; $('spread').disabled = bi;
    S.lines.forEach((_, i) => refreshRowMark(i)); buildPreview(true); renderSync(); scheduleSave();
  });
  $('lang').onchange = scheduleSave;
  $('lat').value = store.get('lat', '100'); $('lat').onchange = () => store.set('lat', $('lat').value);
  S.voff = +store.get('voff', '0') || 0; $('voff').value = S.voff; $('voff').onchange = () => { S.voff = +$('voff').value || 0; store.set('voff', String(S.voff)); };
  S.snap = store.get('snap', '1') !== '0'; $('snapChk').checked = S.snap; $('snapChk').onchange = () => { S.snap = $('snapChk').checked; store.set('snap', S.snap ? '1' : '0'); };
  S.fx = store.get('fx', '1') !== '0'; $('fxChk').checked = S.fx; $('fxChk').onchange = () => { S.fx = $('fxChk').checked; store.set('fx', S.fx ? '1' : '0'); lastAct = -2; };
  try { const c = JSON.parse(store.get('llm', 'null')); if (c) { $('llmProv').value = c.prov; $('llmModel').value = c.model; $('llmKey').value = c.key || ''; $('llmUrl').value = c.url || ''; $('llmStyle').value = c.style || ''; } } catch {}
  // clicks on buttons shouldn't keep focus (Space would re-press them); clicks outside menus close them
  root.addEventListener('mouseup', e => { const t = (e.target as HTMLElement).closest('button'); if (t) setTimeout(() => t.blur(), 0); });
  root.addEventListener('click', e => root.querySelectorAll('details[open]').forEach(d => { if (!d.contains(e.target as Node)) (d as HTMLDetailsElement).open = false; }));
  $('help').onclick = (e: MouseEvent) => { if (e.target === $('help')) $('help').hidden = true; };
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('beforeunload', saveProject);
  setupWave(); renderEditor(); buildPreview(); renderSync();
  if (!store.get('helpSeen', '')) { $('help').hidden = false; store.set('helpSeen', '1'); }
}

/* the panel covers only Spotify's main view: top bar (window controls), sidebars and the player stay usable */
const ANCHORS = ['.Root__main-view', '#main-view', '.main-view-container'];
const BARS = ['.Root__now-playing-bar', '[data-testid="now-playing-bar"]', 'footer'];
let placedAt = 0;
function place() {
  placedAt = performance.now();
  if (!root || root.hidden) return;
  const vis = (sels: string[]) => sels.map(s => document.querySelector(s) as HTMLElement | null).find(e => e && e.getBoundingClientRect().width > 300 && e.getBoundingClientRect().height > 0);
  const a = vis(ANCHORS);
  let top: number, left: number, width: number, height: number;
  if (a) ({ top, left, width, height } = a.getBoundingClientRect());
  else { // unknown layout: leave room for the window top bar and the player
    const bar = vis(BARS), bottom = bar ? innerHeight - bar.getBoundingClientRect().top : 90;
    top = 64; left = 0; width = innerWidth; height = innerHeight - top - bottom;
  }
  const st = root.style, px = (n: number) => Math.round(n) + 'px';
  if (st.top !== px(top) || st.left !== px(left) || st.width !== px(width) || st.height !== px(height)) {
    Object.assign(st, { top: px(top), left: px(left), width: px(width), height: px(height) });
    drawWave();
  }
}

export function toggle(open = !S.open) {
  if (!root) { mount(); addEventListener('resize', place); }
  S.open = open; root.hidden = !open;
  if (open) place();
  if (open) { loadTrack(); lastAct = -2; requestAnimationFrame(frame); } else saveProject();
}
export function onSongChange() { if (S.open) loadTrack(); }
