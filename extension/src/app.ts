// Панель редактора поверх Spotify. Логика разметки — порт reference/index.html (секция app), часы — плеер Spotify вместо <audio>.
import css from './style.css';
import { importLyrics, liveLines } from './core.ts';
import { JOIN, bandRows as coreBandRows, fitAndSort, fitLineToWords, lineEdgeAt, moveLineEdge, lineAt as coreLineAt, moveEdge, moveWord, nearest, seqWords as coreSeq, snapSpan, startEdge, startMove, alignRows, buildTTML, entriesToLines, fitBgOnly, fmtTime, getWords, insertLine, lineFromWords, lineRow, parensToBg, parseRow, shiftLine, parseLRC, parsePlain, plainW, qaCheck, remapSync, replaceUnit, splitWords, syllabify, syncComplete, units, unitsText, wordList,
  type Line, type Mode, type Span, type TTMLOpts, type Word } from './core.ts';
import { findLyrics, type TrackInfo } from './lrclib.ts';
import { agentsByTime, readSpicyCache, spicyToLines } from './spicyCache.ts';
import { putToSpicy } from './spicy.ts';

declare const Spicetify: any;
type Layer = 'tr' | 'orig' | 'bg' | 'bgo'; // bg/bgo = background vocals: translation / original
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
  picked: new Set<number>(), pickAnchor: -1,
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

/* ---------- clock ----------
   Player.getProgress() extrapolates the player *state*, which trails the audio. Like Spicy Lyrics, prefer the
   audio-side position (PlayerAPI._contextPlayer.getPositionState, async IPC): stamp each sample at the round-trip
   midpoint, keep the anchor while the value doesn't move (extrapolate through gaps), fall back to getProgress()
   if it stalls or is missing. Then add a small lead for audio-output latency and low-pass the result. */
const LEAD = 0.1;          // s, output-latency compensation (user fine-tunes with "сдвиг")
const STALL = 500;         // ms without a new audio-side value while playing -> use player state
const SNAP = 0.5;          // s, larger corrections jump (seek / track change)
const TAU = 300;           // ms, smoothing time constant (frame-rate independent)
const POS = { pos: 0, at: 0, fresh: -1e9, raw: NaN, busy: false, ok: false };
function pollPosition() {
  const cp = (Spicetify as any).Platform?.PlayerAPI?._contextPlayer;
  if (!cp?.getPositionState || POS.busy) return;
  POS.busy = true; const t0 = performance.now();
  Promise.resolve(cp.getPositionState({})).then((r: any) => {
    const t1 = performance.now(), v = Number(r && r.position);
    if (!Number.isFinite(v)) return;
    POS.ok = true;
    if (v !== POS.raw || !playing()) { POS.raw = v; POS.pos = v; POS.at = (t0 + t1) / 2; POS.fresh = t1; }
  }).catch(() => { POS.ok = false; }).finally(() => { POS.busy = false; });
}
function rawPos() { // seconds
  const p = performance.now();
  if (POS.ok && (!playing() || p - POS.fresh < STALL)) return (playing() ? POS.pos + (p - POS.at) : POS.pos) / 1000;
  return (P().getProgress() || 0) / 1000;
}
const CLK = { base: 0, pt: 0, hold: 0 };
/* theme colors for the canvas ("r,g,b"), read from the CSS tokens whenever the theme changes */
const TH = { t: '255,255,255', a: '30,215,96', a2: '255,122,200' };
function readTheme() {
  if (!root) return;
  const pr = document.createElement('i'); root.appendChild(pr);
  const rgb = (v: string) => { pr.style.color = `var(${v})`; return (getComputedStyle(pr).color.match(/[\d.]+/g) || []).slice(0, 3).join(','); };
  TH.t = rgb('--txt') || TH.t; TH.a = rgb('--acc') || TH.a; TH.a2 = rgb('--acc2') || TH.a2; pr.remove();
}
function setTheme(th: string) { root.dataset.theme = th; store.set('theme', th); readTheme(); drawWave(); }
function now() {
  pollPosition();
  const p = performance.now(), target = rawPos() + (playing() ? LEAD : 0);
  if (!playing()) { if (p >= CLK.hold) CLK.base = target; CLK.pt = p; return CLK.base; }
  const dt = p - CLK.pt, pred = CLK.base + dt / 1000, e = target - pred;
  CLK.pt = p;
  if (p < CLK.hold && Math.abs(e) > 0.1) { CLK.base = pred; return pred; } // our own seek hasn't reached the player yet
  CLK.base = Math.abs(e) > SNAP ? target : pred + e * (1 - Math.exp(-dt / TAU));
  return CLK.base;
}
function seekTo(t: number) {
  t = Math.max(0, t); P().seek(Math.round(t * 1000)); // integer = ms (fractions 0..1 would be read as percent)
  CLK.base = t; CLK.pt = performance.now(); CLK.hold = CLK.pt + 800; POS.raw = NaN; POS.fresh = -1e9; lastAct = -2;
}
let playStop: any = null;
function playWord(w: { a: number; b: number }) { clearTimeout(playStop); seekTo(w.a); P().play(); playStop = setTimeout(() => P().pause(), (w.b - w.a) * 1000 + 60); }

/* ---------- words / layers ---------- */
function layerText(l: Line, layer: Layer) { return layer === 'tr' ? (l.tr || '') : layer === 'orig' ? l.text : layer === 'bg' ? (l.bg?.tr || '') : (l.bg?.text || ''); }
function wordsOf(i: number, layer: Layer) { return wordList(layerText(S.lines[i], layer)); }
/* a layer = track (main / bg) × language (translation / original); the timeline shows both tracks of the language */
const isBg = (l: Layer) => l === 'bg' || l === 'bgo';
const isTr = (l: Layer) => l === 'tr' || l === 'bg';
const mkLayer = (bg: boolean, tr: boolean): Layer => bg ? (tr ? 'bg' : 'bgo') : (tr ? 'tr' : 'orig');
function setLayer(l: Layer) {
  S.layer = l;
  root.querySelectorAll<HTMLElement>('#st-seg button').forEach(b => b.classList.toggle('on', b.dataset.v === (isTr(l) ? 'tr' : 'orig')));
  root.querySelectorAll<HTMLElement>('#st-trk button').forEach(b => b.classList.toggle('on', b.dataset.v === (isBg(l) ? 'bg' : 'main')));
  if (S.sel) S.sel.k = Math.max(0, Math.min(S.sel.k, wordsOf(S.sel.i, l).length - 1));
  renderSync();
}
function setText(i: number, layer: Layer, v: string) {
  const l = S.lines[i];
  if (layer === 'tr') l.tr = v; else if (layer === 'orig') l.text = v;
  else { l.bg = l.bg || { text: '', tr: '' }; if (layer === 'bg') l.bg.tr = v; else l.bg.text = v; }
}
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
    lines: S.lines.map(l => ({ t: l.t, end: l.end, text: l.text, tr: l.tr || '', sync: l.sync || null, agent: l.agent, bg: l.bg })) });
}
let saveT: any = null;
function scheduleSave() { clearTimeout(saveT); saveT = setTimeout(saveProject, 600); }
// ponytail: whole project per track in Spicetify.LocalStorage (~20-50 KB each, quota ~5 MB); move to IndexedDB if hundreds of projects pile up
function saveProject() {
  clearTimeout(saveT); if (!S.uri || !S.lines.length) return;
  if (!store.set('proj:' + S.uri, projectJSON())) msg('Не удалось сохранить проект (переполнен LocalStorage?) — скачай TTML.', 'err');
}
function setLines(lines: Line[]) {
  TX.dirty = false;
  S.lines = lines; S.undo = []; S.redo = []; S.sel = null; S.picked.clear(); S.pickAnchor = -1;
  renderEditor(); buildPreview(); setLayer(lines.some(l => l.tr && l.tr.trim()) ? 'tr' : 'orig');
  if (lines.length) selectWord(0, 0); else renderSync();
}
function applyProject(p: any) {
  const m = p.meta || {};
  if (m.lang) $('lang').value = m.lang;
  if (m.mode) { const r = root.querySelector(`input[name=st-mode][value=${m.mode}]`) as HTMLInputElement | null; if (r) r.checked = true; }
  setLines(p.lines.map((l: any) => ({ t: l.t, end: l.end, text: l.text, tr: l.tr || '', sync: l.sync || undefined, agent: l.agent, bg: l.bg })));
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
  setLines([]); msg('Ищу текст…');
  const sp = spicyToLines(await readSpicyCache(tr.uri), tr.duration);
  if (load !== S.load) return;
  if (sp) { setLines(sp); scheduleSave(); return msg(spicyMsg(sp), 'ok'); }
  msg('В Spicy Lyrics этого трека нет — ищу в LRCLIB…');
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
const spicyMsg = (sp: Line[]) => `Взял из Spicy Lyrics: строк ${sp.length}${sp.some(l => l.agent) ? ', с исполнителями' : ''}${sp.some(l => l.sync) ? ', оригинал уже размечен по слогам' : ''}.`;
const NO_SPICY = 'В кэше Spicy Lyrics нет текста этого трека — открой его текст в Spicy Lyrics (кнопка в плеере) и нажми снова.';
async function fromSpicy() {
  if (!S.uri) return msg('Сначала включи трек.', 'err');
  const sp = spicyToLines(await readSpicyCache(S.uri), S.meta.duration);
  if (!sp) return msg(NO_SPICY, 'err');
  if (S.lines.some(l => l.tr || l.sync) && !confirm('Заменить проект текстом из Spicy Lyrics? Перевод и разметка этого трека пропадут.')) return;
  setLines(sp); scheduleSave(); msg(spicyMsg(sp), 'ok');
}
async function agentsFromSpicy() {
  if (!S.lines.length) return msg('Сначала загрузи строки.', 'err');
  const sp = spicyToLines(await readSpicyCache(S.uri), S.meta.duration);
  if (!sp) return msg(NO_SPICY, 'err');
  const n = agentsByTime(S.lines, sp);
  renderEditor(); buildPreview(true); drawWave(); scheduleSave();
  msg(`Исполнители из Spicy: сопоставил строк ${n} из ${S.lines.length} (по времени начала).`, n ? 'ok' : 'err');
}
async function importFile(f: File) {
  if (!S.uri) return msg('Сначала включи трек — проект привязывается к треку Spotify.', 'err');
  const { lines, kind } = importLyrics(await f.text(), f.name, S.meta.duration);
  if (!lines.length) return msg('В файле не нашлось строк.', 'err');
  if (S.lines.some(l => l.tr || l.sync) && !confirm(`Заменить проект строками из «${f.name}»? Перевод и разметка этого трека пропадут.`)) return;
  setLines(lines); scheduleSave();
  const extra = [lines.some(l => l.sync?.orig) && 'разметка слов', lines.some(l => l.agent) && 'исполнители', lines.some(l => l.bg) && 'бэки'].filter(Boolean).join(', ');
  msg(`Импорт ${kind.toUpperCase()}: строк ${lines.length}${extra ? ' · ' + extra : ''}${kind === 'text' ? ' · без таймингов: строки разложены по треку, точную синхру задай F/G' : ''}.`, 'ok');
}
function loadManual(text: string) {
  if (!S.uri) return msg('Сначала включи трек.', 'err');
  const e = parseLRC(text), synced = e.length > 0;
  setLines(entriesToLines(synced ? e : parsePlain(text), S.meta.duration)); scheduleSave();
  msg(synced ? `Строк: ${S.lines.length}` : 'Меток времени нет — тайминги выдуманы (по 3.5 с на строку).', synced ? 'ok' : 'err');
}

/* ---------- lines editor ---------- */
/* singers per line (duets): v1 left, v2 right (opposite-aligned in Spicy Lyrics), v1000 together */
const AGENTS = [
  { id: 'v1', label: '1', title: 'Исполнитель 1 — строка слева' },
  { id: 'v2', label: '2', title: 'Исполнитель 2 — строка справа' },
  { id: 'v1000', label: '1+2', title: 'Вместе' },
] as const;
const agentOf = (i: number) => AGENTS.find(a => a.id === (S.lines[i]?.agent || 'v1'))!;
function paintAgent(b: HTMLElement, i: number) { const a = agentOf(i); b.textContent = a.label; b.title = a.title + ' (клик или V — сменить)'; b.dataset.agent = a.id; }
function cycleAgent(i: number) {
  const l = S.lines[i]; if (!l) return;
  const next = AGENTS[(AGENTS.indexOf(agentOf(i)) + 1) % AGENTS.length].id;
  if (next === 'v1') delete l.agent; else l.agent = next;
  const b = root.querySelector('#st-ln' + i + ' .st-ag') as HTMLElement | null; if (b) paintAgent(b, i);
  buildPreview(true); scheduleSave();
}
function pickLine(i: number, e: MouseEvent) {
  const P = S.picked;
  if (e.shiftKey && S.pickAnchor >= 0) { P.clear(); for (let k = Math.min(S.pickAnchor, i); k <= Math.max(S.pickAnchor, i); k++) P.add(k); }
  else if (e.ctrlKey || e.metaKey) { if (P.has(i)) P.delete(i); else P.add(i); S.pickAnchor = i; }
  else { P.clear(); P.add(i); S.pickAnchor = i; }
  paintPicked(); drawWave();
}
function paintPicked() { root.querySelectorAll('.st-ln').forEach((r, k) => r.classList.toggle('picked', S.picked.has(k))); }
function setAgent(agent: 'v1' | 'v2' | 'v1000') {
  const ids = S.picked.size ? [...S.picked] : S.sel ? [S.sel.i] : [];
  if (!ids.length) return msg('Выдели строки слева (клик, Shift — диапазон, Ctrl — по одной) или выбери слово.', 'err');
  for (const i of ids) {
    const l = S.lines[i]; if (!l) continue;
    if (agent === 'v1') delete l.agent; else l.agent = agent;
    const b = root.querySelector('#st-ln' + i + ' .st-ag') as HTMLElement | null; if (b) paintAgent(b, i);
  }
  buildPreview(true); drawWave(); scheduleSave();
  msg(`Голос «${AGENTS.find(a => a.id === agent)!.label}» → строк: ${ids.length}`, 'ok');
}
function renderEditor() {
  const box = $('lines'), top = box.scrollTop; box.innerHTML = '';
  if (!S.lines.length) box.innerHTML = '<div class="st-hint">Тут будут строки трека. Нет в LRCLIB и Spicy? «Текст» → импорт файла или вставь текст. Или «+ строка» — и пиши свои.</div>';
  S.lines.forEach((l, i) => {
    const row = document.createElement('div'); row.className = 'st-ln' + (S.picked.has(i) ? ' picked' : '') + (l.text.trim() ? '' : ' bgonly'); row.id = 'st-ln' + i;
    row.onclick = e => { if (!(e.target as HTMLElement).closest('input,button,.t')) pickLine(i, e); };
    row.innerHTML = '<div class="t"></div><div class="st-txt"><input class="o" type="text" title="Оригинал — можно править" placeholder="(без основной строки — только бэк)"><input class="tr" type="text" placeholder="перевод…"><div class="st-bgrow"></div></div>'
      + '<span class="st-rowact"><button class="st-ins" title="Вставить пустую строку после этой">+</button><button class="st-del" title="Удалить строку (Ctrl+Z вернёт)">🗑</button></span>';
    const t = row.querySelector('.t') as HTMLElement; t.textContent = mmss(l.t) + '.' + Math.floor((l.t % 1) * 10);
    t.onclick = () => { seekTo(l.t); selectWord(i, 0); };
    const ag = document.createElement('button'); ag.className = 'st-ag'; paintAgent(ag, i);
    ag.onclick = e => { e.stopPropagation(); cycleAgent(i); }; t.after(ag);
    const o = row.querySelector('input.o') as HTMLInputElement, inp = row.querySelector('input.tr') as HTMLInputElement;
    o.value = l.text; inp.value = l.tr || '';
    o.oninput = () => editText(i, 'orig', o.value);
    inp.oninput = () => editText(i, 'tr', inp.value);
    o.onfocus = inp.onfocus = () => focusLine(i, inp === document.activeElement ? 'tr' : 'orig');
    (row.querySelector('.st-ins') as HTMLElement).onclick = e => { e.stopPropagation(); addLineAfter(i); };
    (row.querySelector('.st-del') as HTMLElement).onclick = e => { e.stopPropagation(); delLine(i); };
    renderBgRow(row.querySelector('.st-bgrow') as HTMLElement, i);
    box.appendChild(row); refreshRowMark(i);
  });
  box.scrollTop = top;
}
/** focusing a text field in the list = work on that line and track (timeline follows) */
function focusLine(i: number, layer: Layer) {
  if (S.sel?.i === i && S.layer === layer) return;
  setLayer(layer); selectWord(i, 0);
  const l = S.lines[i], w = ($('wave') as HTMLCanvasElement).clientWidth || 800; // bring the line into view
  if (l.t < W.start || l.end > W.start + w / W.px) W.start = Math.max(0, l.t - (w * 0.15) / W.px);
}
/**
 * Text edits keep word timings: unchanged words keep their spans, a fixed typo keeps its span, new words are placed
 * into the gaps (auto, dashed) so they can be dragged right away.
 */
function keepText(i: number, layer: Layer, v: string) {
  const l = S.lines[i], old = layerText(l, layer); if (old === v) return;
  setText(i, layer, v);
  const ns = remapSync(old, v, l.sync && l.sync[layer]);
  if (ns) { l.sync![layer] = ns; fillLine(i, layer); } else if (l.sync) delete l.sync[layer];
}
function editText(i: number, layer: Layer, v: string) {
  const l = S.lines[i]; keepText(i, layer, v);
  root.querySelector('#st-ln' + i)?.classList.toggle('bgonly', !l.text.trim());
  refreshRowMark(i); buildPreview(true); renderSync(); scheduleSave();
}
function renderBgRow(box: HTMLElement, i: number) {
  const l = S.lines[i]; box.innerHTML = '';
  if (!l.bg) {
    const add = document.createElement('button'); add.className = 'st-addbg'; add.textContent = '+ бэк'; add.title = 'Добавить фоновый вокал (бэки, ад-либы) к этой строке';
    add.onclick = e => { e.stopPropagation(); l.bg = { text: '', tr: '' }; renderBgRow(box, i); (box.querySelector('input') as HTMLInputElement)?.focus(); };
    box.appendChild(add); return;
  }
  box.innerHTML = '<span class="st-bglab" title="Фоновый вокал: в Spicy мелкой строкой под основной">бэк</span><input class="bo" type="text" placeholder="бэк: оригинал"><input class="btr" type="text" placeholder="бэк: перевод"><button class="st-delbg" title="Убрать бэк">✕</button>';
  const bo = box.querySelector('input.bo') as HTMLInputElement, btr = box.querySelector('input.btr') as HTMLInputElement;
  bo.value = l.bg.text; btr.value = l.bg.tr;
  bo.oninput = () => editText(i, 'bgo', bo.value);
  btr.oninput = () => editText(i, 'bg', btr.value);
  bo.onfocus = () => focusLine(i, 'bgo'); btr.onfocus = () => focusLine(i, 'bg');
  (box.querySelector('.st-delbg') as HTMLElement).onclick = e => {
    e.stopPropagation(); snap(); delete l.bg; if (l.sync) { delete l.sync.bg; delete l.sync.bgo; }
    if (!l.text.trim() && !(l.tr || '').trim()) return delLine(i, false);
    renderBgRow(box, i); buildPreview(true); renderSync(); scheduleSave();
  };
}
/* ---------- adding / removing lines ---------- */
function afterLines() { S.picked.clear(); S.pickAnchor = -1; renderEditor(); buildPreview(true); afterSyncChange(true); }
function focusRow(i: number, sel = 'input.o') {
  const r = root.querySelector('#st-ln' + i) as HTMLElement | null; if (!r) return;
  r.scrollIntoView({ block: 'center' }); (r.querySelector(sel) as HTMLInputElement | null)?.focus();
}
function addLineAt(t: number, bg = false) {
  snap(); const i = insertLine(S.lines, Math.max(0, r3(t)), bg ? { bg: { text: '', tr: '' } } : {});
  if (S.sel && S.sel.i >= i) S.sel.i++;
  afterLines(); return i;
}
function addLineAfter(i: number) {
  const l = S.lines[i], nx = S.lines[i + 1];
  const j = addLineAt(nx && nx.t < l.end + 0.5 ? (l.t + nx.t) / 2 : l.end);
  focusRow(j);
}
function delLine(i: number, withSnap = true) {
  if (!S.lines[i]) return;
  if (withSnap) snap();
  S.lines.splice(i, 1);
  if (S.sel) { if (S.sel.i === i) S.sel = S.lines.length ? { i: Math.min(i, S.lines.length - 1), k: 0 } : null; else if (S.sel.i > i) S.sel.i--; }
  afterLines(); msg('Строка удалена. Ctrl+Z — вернуть.', 'ok');
}
function bracketsToBg() {
  if (!S.lines.length) return msg('Нет строк.', 'err');
  snap(); let n = 0; S.lines.forEach(l => { if (parensToBg(l)) n++; });
  if (!n) { S.undo.pop(); return msg('Скобок в тексте нет — бэки добавь вручную: «+ бэк» у строки или двойной клик на дорожке «бэк».', 'err'); }
  afterLines(); msg(`Бэки из скобок: строк ${n}. Тайминги слов переехали вместе со словами. Ctrl+Z — отмена.`, 'ok');
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
  return arr.map((x: any, k: number) => typeof x === 'string' ? { i: k, tr: x } : { i: x.i ?? k, tr: String(x.tr ?? x.text ?? ''), ...(x.bg ? { bg: String(x.bg) } : {}) });
}
function applyTr(rows: { i: number; tr: string; bg?: string }[]) {
  let n = 0; rows.forEach(r => {
    const l = S.lines[r.i]; if (!l) return;
    if (r.tr.trim()) { l.tr = r.tr.trim(); if (l.sync) delete l.sync.tr; n++; }
    if (l.bg && r.bg && r.bg.trim()) { l.bg.tr = r.bg.trim(); if (l.sync) delete l.sync.bg; }
  });
  renderEditor(); buildPreview(true); if (n) setLayer(isBg(S.layer) ? 'bg' : 'tr'); else renderSync(); scheduleSave(); return n;
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
  const sys = 'Ты литературный переводчик текстов песен. Переводи на язык: ' + langName() + '. Передавай смысл, настроение, сленг и рифму естественно, не дословно; число слов в строке держи близко к оригиналу (подсветка идёт по словам). Одинаковые строки (припев) переводи одинаково. Не склеивай и не разбивай строки. Если у строки есть поле bg (фоновый вокал, бэки), переведи и его в поле bg. Ответ — ТОЛЬКО JSON-массив [{"i":число,"tr":"перевод","bg":"перевод бэка, только если был bg"}], ровно по одному элементу на каждую входную строку, без комментариев и markdown.';
  const user = 'Песня: ' + S.meta.artist + ' — ' + S.meta.title + '\n' + (style ? 'Заметки/глоссарий: ' + style + '\n' : '') + 'Строки:\n' + JSON.stringify(S.lines.map((l, i) => ({ i, text: plainW(l.text), ...(l.bg && l.bg.text.trim() ? { bg: plainW(l.bg.text) } : {}) })));
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
  const l = S.lines[i], ml = mainLayerFor(i), bi = mode() === 'bilingual';
  const wm = getWords(layerText(l, ml), l.sync && l.sync[ml], l.t, l.end);
  let wb: Word[] | null = null;
  if (bi) { if (l.tr && l.tr.trim()) wb = getWords(l.tr.trim(), l.sync && l.sync.tr, l.t, l.end); }
  else if (l.bg) { // background vocals under the line (translated if there is a translation)
    const bl: Layer = l.bg.tr && l.bg.tr.trim() ? 'bg' : 'bgo', txt = layerText(l, bl).trim();
    if (txt) {
      const so = l.sync && l.sync.bgo, n = units(l.bg.text).length;
      const [b0, b1] = syncComplete(so, n) ? [so[0].a!, so[n - 1].b!] : [l.t, l.end];
      wb = getWords(txt, l.sync && l.sync[bl], b0, b1);
    }
  }
  return { wm, wb };
}
function buildPreview(keepPos?: boolean) {
  S.ver++;
  const inner = $('lyrIn'); inner.innerHTML = '';
  if (!S.lines.length) { inner.innerHTML = '<div class="st-empty">Тут появится превью караоке</div>'; return; }
  S.lines.forEach((l, i) => {
    const { wm, wb } = lineWords(i);
    const el = document.createElement('div'); el.className = 'st-pl'; el.id = 'st-pl' + i; el.dataset.agent = l.agent || 'v1';
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
  const bn = el.querySelectorAll<HTMLElement>('.bg .w');
  if ((wb ? wb.length : 0) !== bn.length) return buildPreview(true);
  if (wb) bn.forEach((n, k) => { n.dataset.a = String(wb[k].a); n.dataset.b = String(wb[k].b); });
}
const RNG = { ver: -1, r: [] as { a: number; b: number }[] };
function ranges() { // per-line [start,end] for the main layer, recomputed only when lyrics/timings change
  if (RNG.ver === S.ver && RNG.r.length === S.lines.length) return RNG.r;
  RNG.ver = S.ver; RNG.r = S.lines.map((l, i) => {
    const { wm, wb } = lineWords(i), ws = wm.concat(wb || []);
    return ws.length ? { a: Math.min(l.t, ...ws.map(w => w.a)), b: Math.max(l.end, ...ws.map(w => w.b)) } : { a: l.t, b: l.end };
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
let lastAct = -2, nodesVer = -1, wasPlaying = false, actKey = '';
const liveNodes = new Map<number, any[]>();
/* wheel over the preview scrolls it by hand; it returns to the current line 3 s after the last wheel */
const SCR = { base: 0, manual: 0, until: 0 };
function applyScroll() { const el = $('lyrIn') as HTMLElement; el.style.transition = SCR.manual ? 'transform .12s ease-out' : ''; el.style.transform = `translateY(${SCR.base + SCR.manual}px)`; }
const LOOK = 0.3; // activate/scroll a line slightly before its first word, so CSS transitions finish on time
function frame() {
  if (!S.open) return;
  if (performance.now() - placedAt > 250) place();
  const t = now(), T = t + S.voff / 1000, R = ranges(), pl = playing();
  if (pl !== wasPlaying) { wasPlaying = pl; $('dock').classList.toggle('rec', pl); }
  const { act, live, active, idx } = liveLines(R, T, LOOK), key = active.join(',');
  if (key !== actKey || idx !== lastAct) {
    actKey = key; lastAct = idx;
    root.querySelectorAll('.st-pl').forEach((e, i) => e.className = 'st-pl' + (S.fx ? ' fx' : '') + (active.includes(i) ? ' act' : (Math.abs(i - idx) === 1 ? ' near' : '')));
    root.querySelectorAll('.st-ln').forEach((e, i) => e.classList.toggle('on', active.includes(i)));
    const target = root.querySelector('#st-pl' + (idx >= 0 ? idx : Math.max(0, act))) as HTMLElement | null;
    if (target) { const box = $('lyrIn').parentElement as HTMLElement; SCR.base = -(target.offsetTop + target.offsetHeight / 2 - box.clientHeight / 2); if (!SCR.manual) applyScroll(); }
    if (idx >= 0 && pl) { const r = root.querySelector('#st-ln' + idx); if (r) r.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  }
  if (SCR.manual && performance.now() > SCR.until) { SCR.manual = 0; applyScroll(); }
  if (nodesVer !== S.ver) { nodesVer = S.ver; liveNodes.clear(); }
  for (const [i, nodes] of liveNodes) if (!live.includes(i)) { paintWords(nodes, T); liveNodes.delete(i); } // final state on leave
  for (const i of live) { let n = liveNodes.get(i); if (!n) { n = [...root.querySelectorAll('#st-pl' + i + ' .w')]; liveNodes.set(i, n); } paintWords(n, T); }
  for (const c of S.chips) { const on = c.dataset.a != null && T >= +c.dataset.a && T < +c.dataset.b!; if ((c as any)._now !== on) { (c as any)._now = on; c.classList.toggle('now', on); } }
  if (S.loop && S.sel && pl) {
    const vw = viewWords(S.sel.i, S.layer).filter(x => x.a != null);
    if (vw.length) { const a = vw[0].a! - 0.4, b = vw[vw.length - 1].b! + 0.4; if (t > b || t < a - 1) seekTo(Math.max(0, a)); }
  }
  drawWave();
  requestAnimationFrame(frame);
}

/* ---------- undo ---------- */
// whole lines: undo also covers inserted / deleted lines
const stateJSON = () => JSON.stringify(S.lines);
function snap() { S.undo.push(stateJSON()); if (S.undo.length > 200) S.undo.shift(); S.redo = []; }
function restore(json: string) {
  const txt = (ls: Line[]) => JSON.stringify(ls.map(l => [l.t, l.text, l.tr, l.bg, l.agent]));
  const before = txt(S.lines); S.lines = JSON.parse(json);
  if (S.sel && S.sel.i >= S.lines.length) S.sel = S.lines.length ? { i: S.lines.length - 1, k: 0 } : null;
  if (txt(S.lines) !== before) { S.picked.clear(); renderEditor(); buildPreview(true); }
  afterSyncChange(true);
}
function doUndo() { if (!S.undo.length) return; S.redo.push(stateJSON()); restore(S.undo.pop()!); }
function doRedo() { if (!S.redo.length) return; S.undo.push(stateJSON()); restore(S.redo.pop()!); }
/** background-only lines span exactly their words; lines stay ordered by start, the selection follows its line */
function fitLines() {
  const r = fitAndSort(S.lines, S.sel ? S.lines[S.sel.i] : null); if (!r.moved) return false;
  if (S.sel) S.sel.i = r.at; S.picked.clear(); renderEditor(); buildPreview(true); return true;
}
function afterSyncChange(all: boolean, i = 0) {
  if (fitLines()) all = true;
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
function setLayerText(i: number, layer: Layer, text: string) { setText(i, layer, text); syncRow(i); }
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
    if (!ws.length) { const e = document.createElement('span'); e.className = 'st-hint'; e.textContent = isBg(S.layer) ? '(нет бэка — двойной клик по дорожке «бэк» или E)' : S.layer === 'tr' ? '(нет перевода — E, чтобы вписать)' : '(пусто — E, чтобы вписать)'; row.appendChild(e); }
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
const W = { px: 140, start: 0, drag: null as any, pend: null as any, boxes: [] as any[], flash: null as any, snapAt: null as number | null, ctrl: false, rows: [] as number[], nr: 1,
  G: { mY: 3, mH: 46, bY: 52, bH: 34, lY: 90, lH: 40 } };
type Lane = 'main' | 'bg';
/* three stacked lanes: main track words, background vocals words, source lines (+ ruler under them) */
function geo(h: number) {
  const mH = Math.round(clamp(h * 0.34, 28, 46)), bH = Math.round(clamp(h * 0.26, 22, 36)), mY = 3, bY = mY + mH + 3, lY = bY + bH + 4;
  return { mY, mH, bY, bH, lY, lH: Math.max(12, h - lY - 18) };
}
const laneLayer = (lane: Lane) => mkLayer(lane === 'bg', isTr(S.layer));
const laneY = (lane: Lane) => lane === 'bg' ? [W.G.bY, W.G.bH] : [W.G.mY, W.G.mH];
const lineAt = (t: number) => coreLineAt(S.lines, t);
const bandRows = () => coreBandRows(S.lines);
function drawWave() {
  const cv = $('wave') as HTMLCanvasElement;
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  const t = now(), G = W.G = geo(h);
  if (playing() && !W.drag) { if (t < W.start || t > W.start + w / W.px * 0.8) W.start = Math.max(0, t - w / W.px * 0.25); }
  const t0 = W.start, t1 = t0 + w / W.px, X = (tt: number) => (tt - t0) * W.px;
  // ruler
  g.fillStyle = `rgba(${TH.t},.35)`; g.font = '10px ui-monospace,monospace'; g.textBaseline = 'top';
  const step = W.px > 400 ? 0.5 : W.px > 150 ? 1 : W.px > 60 ? 2 : 5;
  for (let s = Math.ceil(t0 / step) * step; s < t1; s += step) { const x = X(s); g.fillRect(x, h - 6, 1, 6); g.fillText(mmss(s) + (step < 1 ? '.' + Math.round((s % 1) * 10) : ''), x + 3, h - 15); }
  // lane backgrounds: the active track is tinted and has a stripe on the left
  const actLane: Lane = isBg(S.layer) ? 'bg' : 'main';
  for (const lane of ['main', 'bg'] as const) {
    const [y, hh] = laneY(lane), col = lane === 'bg' ? TH.a2 : TH.a, on = lane === actLane;
    g.fillStyle = on ? `rgba(${col},.08)` : `rgba(${TH.t},.025)`; g.fillRect(0, y, w, hh);
    if (on) { g.fillStyle = `rgb(${col})`; g.fillRect(0, y, 3, hh); }
    g.fillStyle = `rgba(${on ? col : TH.t},${on ? .55 : .25})`; g.font = '700 9px ui-monospace,monospace'; g.textBaseline = 'top';
    g.fillText(lane === 'bg' ? 'БЭК' : isTr(S.layer) ? 'ПЕРЕВОД' : 'ОРИГИНАЛ', 7, y + 2);
  }
  // lower band: source lines (LRC timing) with original text, for orientation
  g.font = '12px system-ui'; g.textBaseline = 'middle';
  const rows = W.rows = bandRows(), nr = W.nr = Math.max(1, ...rows.map(r => r + 1));
  S.lines.forEach((l, li) => {
    if (l.end < t0 || l.t > t1) return;
    const hh = G.lH / nr, y = G.lY + rows[li] * hh;
    const x1 = X(l.t), x2 = X(l.end), ac = l.agent === 'v2' ? TH.a2 : l.agent === 'v1000' ? TH.a : TH.t, other = !!l.agent && l.agent !== 'v1';
    g.fillStyle = `rgba(${ac},${other ? .18 : .06})`; g.fillRect(x1, y, Math.max(2, x2 - x1 - 2), hh);
    g.fillStyle = `rgba(${ac},${other ? .9 : .3})`; g.fillRect(x1, y, other ? 3 : 1, hh);
    if (S.picked.has(li) || S.sel?.i === li) { g.strokeStyle = S.picked.has(li) ? `rgb(${TH.a})` : `rgba(${TH.t},.35)`; g.lineWidth = 1.5; g.strokeRect(x1 + .75, y + .75, Math.max(2, x2 - x1 - 3.5), hh - 1.5); g.lineWidth = 1; }
    const main = l.text.trim();
    g.fillStyle = main ? `rgba(${TH.t},.6)` : `rgba(${TH.a2},.8)`;
    g.save(); g.beginPath(); g.rect(x1 + 4, y, Math.max(0, x2 - x1 - 8), hh); g.clip(); g.fillText(main ? plainW(l.text) : '♪ ' + plainW(l.bg?.text || l.bg?.tr || 'только бэк'), x1 + 6, y + hh / 2); g.restore();
  });
  // word boxes of both tracks; the inactive one is dimmed but still clickable (click = switch to it)
  W.boxes = [];
  for (const lane of ['main', 'bg'] as const) {
    const layer = laneLayer(lane), on = layer === S.layer, [y, hh] = laneY(lane), col = lane === 'bg' ? TH.a2 : TH.a;
    g.font = lane === 'bg' ? '600 12.5px system-ui' : '600 14px system-ui'; g.textBaseline = 'middle'; g.globalAlpha = on ? 1 : .5;
    for (let i = 0; i < S.lines.length; i++) {
      const l = S.lines[i]; if (l.end + 8 < t0 || l.t - 8 > t1) continue;
      viewWords(i, layer).forEach((wd, k) => {
        if (wd.a == null || wd.b == null) return;
        const x1 = X(wd.a), x2 = X(wd.b); if (x2 < -2 || x1 > w + 2) return;
        const sel = on && S.sel && S.sel.i === i && S.sel.k === k, bw = Math.max(2, x2 - x1);
        if (wd.real) {
          g.fillStyle = sel ? `rgba(${TH.t},.3)` : wd.g ? `rgba(${col},.16)` : `rgba(${col},.35)`; g.fillRect(x1, y, bw, hh);
          g.strokeStyle = sel ? `rgb(${TH.t})` : `rgba(${col},.9)`; g.fillStyle = sel ? `rgb(${TH.t})` : `rgba(${col},.95)`; g.fillRect(x1, y, 3, hh); g.fillRect(x2 - 3, y, 3, hh);
          g.lineWidth = sel ? 2 : 1; if (wd.g) g.setLineDash([3, 3]); g.strokeRect(x1 + .5, y + .5, bw - 1, hh - 1); g.setLineDash([]); g.lineWidth = 1;
        } else { g.setLineDash([3, 3]); g.strokeStyle = sel ? `rgb(${TH.t})` : `rgba(${TH.t},.25)`; g.strokeRect(x1 + .5, y + .5, bw - 1, hh - 1); g.setLineDash([]); }
        g.save(); g.beginPath(); g.rect(x1 + 2, y, Math.max(0, x2 - x1 - 4), hh); g.clip();
        g.fillStyle = wd.real ? `rgb(${TH.t})` : `rgba(${TH.t},.45)`; g.fillText((wd.b - wd.a >= 1 ? '✦ ' : '') + plainW(wd.word) + (wd.sp === false ? '-' : ''), x1 + 5, y + hh / 2 + 1); g.restore();
        W.boxes.push({ i, k, a: wd.a, b: wd.b, real: !!wd.real, lane, layer });
      });
    }
    // joined edges (touching words) get a bright joint so you can see what moves together
    const rb = W.boxes.filter(b => b.real && b.lane === lane).sort((p, q) => p.a - q.a);
    for (let q = 0; q + 1 < rb.length; q++) if (Math.abs(rb[q].b - rb[q + 1].a) <= JOIN) { g.fillStyle = `rgb(${TH.t})`; g.fillRect(X(rb[q].b) - 1, y, 2, hh); }
    g.globalAlpha = 1;
  }
  if (W.drag?.type === 'wcopy') { // Alt+drag: ghost of the copy under the cursor
    const [y, hh] = laneY(W.drag.lane), x1 = X(W.drag.a), x2 = X(W.drag.a + W.drag.len);
    g.fillStyle = `rgba(${TH.t},.18)`; g.fillRect(x1, y, Math.max(2, x2 - x1), hh);
    g.setLineDash([4, 3]); g.strokeStyle = `rgb(${TH.t})`; g.strokeRect(x1 + .5, y + .5, Math.max(2, x2 - x1) - 1, hh - 1); g.setLineDash([]);
    g.fillStyle = `rgb(${TH.t})`; g.font = '600 13px system-ui'; g.textBaseline = 'middle'; g.fillText('+ ' + plainW(W.drag.w), x1 + 5, y + hh / 2 + 1);
  }
  g.fillStyle = `rgb(${TH.t})`; g.fillRect(X(t), 0, 1.5, h); // playhead
  if (W.flash) {
    const age = (performance.now() - W.flash.at) / 800;
    if (age < 1) { const fx = X(W.flash.t), col = ({ F: '110,231,183', G: '182,156,255', H: '255,122,200' } as any)[W.flash.kind]; g.fillStyle = `rgba(${col},${(1 - age).toFixed(2)})`; g.fillRect(fx - 1.5, 0, 3, h); g.font = '800 13px ui-monospace,monospace'; g.textBaseline = 'top'; g.fillText(W.flash.kind, fx + 5, G.lY + 2); }
    else W.flash = null;
  }
  if (W.snapAt != null && W.drag) { const sx = X(W.snapAt); g.fillStyle = '#ffd166'; g.fillRect(sx - 0.75, 0, 1.5, h); }
}
function waveHit(mx: number, my: number): any {
  const t = W.start + mx / W.px, tol = 9 / W.px, G = W.G;
  if (my >= G.lY - 2) { // the line in that band row
    const row = clamp(Math.floor((my - G.lY) / (G.lH / W.nr)), 0, W.nr - 1);
    const le = lineEdgeAt(S.lines, t, 6 / W.px, W.rows, row); if (le) return { type: 'ledge', t, i: le.i, edge: le.edge };
    let i = -1; S.lines.forEach((l, k) => { if (W.rows[k] === row && t >= l.t && t <= l.end) i = k; });
    return { type: 'band', t, i };
  }
  const lane: Lane = my < G.bY - 1 ? 'main' : 'bg', bs = W.boxes.filter(b => b.lane === lane);
  let best: any = null;
  for (const b of bs) {
    if (!b.real) continue;
    for (const edge of ['a', 'b']) { const d = Math.abs(b[edge] - t); if (d <= tol && (!best || d < best.d)) best = { d, b, edge }; }
  }
  if (best) return { type: 'edge', t, lane, ...best };
  for (const b of bs) if (t >= b.a && t <= b.b) return { type: 'word', t, lane, b };
  return { type: 'lane', t, lane };
}
/* DaVinci-style editing: magnet snapping, roll (joined edges move together), Alt = detach, no overlaps */
const seqWords = (layer: Layer = S.layer) => coreSeq(S.lines, layer);
// magnet targets: other words of this track, words of the other track (align backing to lead), line starts
function buildCands(excl: Set<any>) {
  const out: number[] = [], other = mkLayer(!isBg(S.layer), isTr(S.layer));
  seqWords().concat(seqWords(other)).forEach(e => { if (!excl.has(e.x)) out.push(e.x.a, e.x.b); }); S.lines.forEach(l => out.push(l.t)); return out;
}
function nearestCand(t: number, cands: number[]) { return S.snap && !W.ctrl ? nearest(t, cands.concat([now()]), 10 / W.px) : null; }
function snapOne(t: number, cands: number[]) { const n = nearestCand(t, cands); W.snapAt = n ? n.c : null; return n ? n.c : t; }
function setupWave() {
  const cv = $('wave') as HTMLCanvasElement;
  const tAt = (mx: number) => Math.max(0, r3(W.start + mx / W.px));
  cv.onmousedown = e => {
    const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, h = waveHit(mx, my);
    W.ctrl = e.ctrlKey || e.metaKey;
    if (e.button === 2) { if (h.b) playWord({ a: h.b.a, b: h.b.b }); return; }
    if (WE.el) closeEdit(true);
    if (h.type === 'ledge' && !e.altKey) { snap(); S.sel = { i: h.i, k: 0 }; W.drag = { type: 'ledge', l: S.lines[h.i], i: h.i, edge: h.edge, cands: buildCands(new Set()) }; return; }
    // clicking the other track switches to it (main <-> background vocals)
    const switched = !!h.lane && laneLayer(h.lane) !== S.layer;
    if (switched) setLayer(laneLayer(h.lane));
    if (h.type === 'edge') {
      const sq = seqWords(), idx = sq.findIndex(q => q.i === h.b.i && q.k === h.b.k); if (idx < 0) return;
      const ed = startEdge(sq, idx, h.edge, e.altKey, h.t);
      snap(); selectWord(h.b.i, h.b.k);
      const excl = new Set([ed.me.x]); if (ed.partner) excl.add(ed.partner.x);
      W.drag = { type: 'edge', ...ed, edge: h.edge, cands: buildCands(excl), i: h.b.i };
    }
    else if (h.type === 'word') { selectWord(h.b.i, h.b.k); W.pend = { type: 'move', i: h.b.i, k: h.b.k, x0: mx, off: h.t - h.b.a, ghost: !h.b.real, alt: e.altKey, a: h.b.a, len: h.b.b - h.b.a, lane: h.lane }; }
    else if (h.type === 'lane' && !switched && S.sel && wordsOf(S.sel.i, S.layer).length) W.pend = { type: 'paint', x0: mx, t0: h.t };
    else if (h.type === 'band' && h.i >= 0) W.pend = { type: 'line', x0: mx, t0: h.t, i: h.i, alt: e.altKey };
    else W.pend = { type: 'pan', x0: mx, start0: W.start, t0: h.t };
  };
  window.addEventListener('mousemove', e => {
    if (!S.open) return;
    const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    W.ctrl = e.ctrlKey || e.metaKey;
    if (W.pend && !W.drag && Math.abs(mx - W.pend.x0) > 3) {
      const p = W.pend;
      if (p.type === 'move' && p.alt) // Alt+drag = a copy of the word becomes a new line (bg track: a separate background line)
        W.drag = { type: 'wcopy', w: wordsOf(p.i, S.layer)[p.k], off: p.off, a: p.a, len: Math.max(0.05, p.len), lane: p.lane, cands: buildCands(new Set()) };
      else if (p.type === 'move') {
        snap(); if (p.ghost) spreadLine(p.i, S.layer);
        const sq = seqWords(), idx = sq.findIndex(q => q.i === p.i && q.k === p.k);
        if (idx >= 0) {
          const md = startMove(sq, idx), excl = new Set([md.me.x]); if (md.jp) excl.add(md.pv!.x); if (md.jn) excl.add(md.nx!.x);
          W.drag = { type: 'move', i: p.i, ...md, off: p.off, cands: buildCands(excl) };
        }
      }
      else if (p.type === 'line') {
        snap(); let l = S.lines[p.i];
        if (p.alt) { l = JSON.parse(JSON.stringify(l)); S.lines.splice(p.i + 1, 0, l); if (S.sel && S.sel.i > p.i) S.sel.i++; S.picked.clear(); renderEditor(); buildPreview(true); } // Alt = drag out a copy
        W.drag = { type: 'line', t0: p.t0, o: JSON.parse(JSON.stringify(l)), l, cands: buildCands(new Set(Object.values(l.sync || {}).flat())).filter(c => c !== l.t) }; }
      else if (p.type === 'paint') { snap(); const sx = ensureSync(S.sel!.i, S.layer)[S.sel!.k]; W.drag = { type: 'paint', i: S.sel!.i, k: S.sel!.k, t0: p.t0, cands: buildCands(new Set([sx])) }; }
      else W.drag = { type: 'pan', x0: p.x0, start0: p.start0 };
      W.pend = null;
    }
    const d = W.drag;
    if (d) {
      if (d.type === 'pan') { W.start = Math.max(0, d.start0 - (mx - d.x0) / W.px); cv.style.cursor = 'grabbing'; return; }
      const traw = tAt(mx);
      if (d.type === 'wcopy') {
        let a = Math.max(0, traw - d.off);
        const na = nearestCand(a, d.cands), nb = nearestCand(a + d.len, d.cands);
        if (na && (!nb || na.d <= nb.d)) { a = na.c; W.snapAt = na.c; } else if (nb) { a = nb.c - d.len; W.snapAt = nb.c; } else W.snapAt = null;
        d.a = r3(a); if (my < W.G.bY - 1) d.lane = 'main'; else if (my < W.G.lY - 2) d.lane = 'bg';
        cv.style.cursor = 'copy'; return;
      }
      if (d.type === 'ledge') { moveLineEdge(d.l, d.edge, snapOne(traw, d.cands.filter((c: number) => c !== (d.edge === 'a' ? d.l.t : d.l.end)))); cv.style.cursor = 'ew-resize'; refreshPreviewLine(S.lines.indexOf(d.l)); return; }
      if (d.type === 'line') { const a = snapOne(d.o.t + traw - d.t0, d.cands); shiftLine(d.l, d.o, a - d.o.t); refreshPreviewLine(S.lines.indexOf(d.l)); return; }
      if (d.type === 'paint') {
        const t = snapOne(traw, d.cands), w = S.lines[d.i].sync![S.layer]![d.k]; w.a = Math.min(d.t0, t); w.b = Math.max(d.t0, t, w.a + 0.02); conf(w);
      } else if (d.type === 'edge') {
        const t0 = snapOne(traw, d.cands); if (!moveEdge(d, t0)) W.snapAt = null;
      } else if (d.type === 'move') {
        const s = S.snap && !W.ctrl ? snapSpan(Math.max(0, traw - d.off), d.len, d.cands.concat([now()]), 10 / W.px) : { a: Math.max(0, traw - d.off), at: null };
        W.snapAt = s.at; if (!moveWord(d, s.a, e.shiftKey)) W.snapAt = null; // Shift = move alone (glued neighbours stay)
      }
      refreshPreviewLine(d.i); return;
    }
    if (mx >= 0 && mx <= r.width && my >= 0 && my <= r.height) { const h = waveHit(mx, my); cv.style.cursor = h.type === 'ledge' ? 'ew-resize' : e.altKey && (h.b || (h.type === 'band' && h.i >= 0)) ? 'copy' : h.type === 'edge' ? 'ew-resize' : h.type === 'word' ? 'grab' : h.type === 'lane' && laneLayer(h.lane) === S.layer && S.sel ? 'crosshair' : h.type === 'band' && h.i >= 0 ? 'move' : 'default'; }
  });
  window.addEventListener('mouseup', () => {
    if (W.pend) { if (W.pend.type === 'pan' || W.pend.type === 'paint' || W.pend.type === 'line') seekTo(W.pend.t0); W.pend = null; return; }
    if (W.drag) {
      const d = W.drag; W.drag = null; W.snapAt = null;
      if (d.type === 'wcopy') return dropCopy(laneLayer(d.lane), d.w, d.a, d.a + d.len);
      if (d.type === 'paint') { const n = stepSel(1); if (n) S.sel = { i: n.i, k: n.k }; }
      if (d.type === 'ledge') { const sl = S.sel ? S.lines[S.sel.i] : null; S.lines.sort((x, y) => x.t - y.t); if (sl && S.sel) S.sel.i = S.lines.indexOf(sl); renderEditor(); buildPreview(true); }
      if (d.type === 'line') { // keep lines ordered by start; the selection follows its line
        const sl = S.sel ? S.lines[S.sel.i] : null; S.lines.sort((x, y) => x.t - y.t);
        if (sl && S.sel) S.sel.i = S.lines.indexOf(sl); S.picked.clear(); renderEditor(); buildPreview(true);
      }
      if (d.type !== 'pan') { fitLines(); S.lines.forEach((_, i) => { refreshPreviewLine(i); refreshRowMark(i); }); renderSync(); scheduleSave(); }
    }
  });
  cv.oncontextmenu = e => e.preventDefault();
  // double click: word = edit it, empty space of a line = edit the whole line text of that track, nowhere = new line here
  cv.ondblclick = e => {
    const r = cv.getBoundingClientRect(), h = waveHit(e.clientX - r.left, e.clientY - r.top);
    W.pend = null; W.drag = null;
    if (h.b) { setLayer(h.b.layer); S.sel = { i: h.b.i, k: h.b.k }; return openEdit(h.b.i, h.b.layer, h.b.k); }
    if (h.type === 'band') return h.i >= 0 ? focusRow(h.i) : newLineEdit(h.t, mkLayer(false, isTr(S.layer)));
    const layer = laneLayer(h.lane), i = lineAt(h.t);
    if (i < 0) return newLineEdit(h.t, layer);
    setLayer(layer); selectWord(i, 0); openEdit(i, layer);
  };
  cv.onwheel = e => {
    e.preventDefault(); const r = cv.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) zoomAt(e.clientX - r.left, e.deltaY < 0 ? 1.18 : 1 / 1.18);
    else W.start = Math.max(0, W.start + (e.deltaX || e.deltaY) / W.px * 1.2);
  };
}
/** Alt+drag drop: the copy becomes a NEW line (on the bg track: a background-only line), like a duplicated clip */
function dropCopy(layer: Layer, w: string, a: number, b: number) {
  const l = lineFromWords([{ layer, w, a, b }]); if (!l) return;
  snap(); S.lines.push(l); S.lines.sort((x, y) => x.t - y.t);
  setLayer(layer); S.sel = { i: S.lines.indexOf(l), k: 0 }; afterLines();
  msg(`Копия «${plainW(w)}» — новая ${isBg(layer) ? 'бэк-строка' : 'строка'}. Ctrl+Z — отмена.`, 'ok');
}

/* ---------- «Текст»: the whole song, original and translation side by side ---------- */
const TX = { o: '', t: '', dirty: false };
const rowsOf = (v: string) => { const r = v.split(/\r?\n/).map(x => x.trim()); while (r.length && !r[r.length - 1]) r.pop(); return r; };
function setLeftTab(text: boolean) {
  root.querySelectorAll<HTMLElement>('#st-ltabs button').forEach(b => b.classList.toggle('on', (b.dataset.v === 'text') === text));
  $('ltools').hidden = text; $('lines').hidden = text; $('text').hidden = !text;
  if (text && !TX.dirty) resetText();
}
function resetText() {
  TX.o = S.lines.map(l => lineRow(l, false)).join('\n'); TX.t = S.lines.map(l => lineRow(l, true)).join('\n'); TX.dirty = false;
  $('tO').value = TX.o; $('tT').value = TX.t; textStat();
}
function textStat() {
  const o = rowsOf(TX.o), t = rowsOf(TX.t), map = alignRows(S.lines.map(l => lineRow(l, false)), o), bad = t.some(Boolean) && t.length !== o.length;
  const added = map.filter(m => m < 0).length, removed = S.lines.length - map.filter(m => m >= 0).length;
  $('tStat').textContent = bad ? `оригинал ${o.length} строк, перевод ${t.length} — выровняй столбцы` : TX.dirty ? `не применено${added ? ` · новых ${added}` : ''}${removed ? ` · удалится ${removed}` : ''}` : 'строка = строка песни · (в скобках) = бэк';
  $('tStat').className = 'st-hint' + (bad ? ' err' : '');
  $('tApply').disabled = !TX.dirty; $('tReset').disabled = !TX.dirty;
  $('tGut').innerHTML = o.map((_, j) => `<div class="${map[j] < 0 ? 'new' : ''}">${map[j] >= 0 ? mmss(S.lines[map[j]].t) : '+ new'}</div>`).join('');
}
function applyText() {
  const o = rowsOf(TX.o), t = rowsOf(TX.t), hasT = t.some(Boolean);
  if (hasT && t.length !== o.length) return msg(`Строк: оригинал ${o.length}, перевод ${t.length}. Строка перевода стоит напротив своей строки (пустая — без перевода).`, 'err');
  const rows = o.map((x, j) => ({ o: x, t: t[j] || '' })).filter(r => r.o || r.t);
  if (!rows.length) return msg('Пусто — так весь текст не удалить.', 'err');
  snap();
  const map = alignRows(S.lines.map(l => lineRow(l, false)), rows.map(r => r.o));
  const old = S.lines, next: Line[] = map.map(m => m >= 0 ? old[m] : { t: -1, end: -1, text: '', tr: '' });
  for (let j = 0; j < next.length;) { // new lines go evenly into the time between their neighbours
    if (next[j].t >= 0) { j++; continue; }
    let e = j; while (e < next.length && next[e].t < 0) e++;
    const P = next[j - 1], N = next[e], k = e - j;
    let a = P ? P.end : N ? Math.max(0, N.t - 3 * k) : 0, b = N ? N.t : a + 3 * k;
    if (b - a < 0.8 * k) { a = P ? (P.t + P.end) / 2 : Math.max(0, b - 0.8 * k); b = Math.max(b, a + 0.8 * k); }
    for (let q = 0; q < k; q++) { next[j + q].t = r3(a + (b - a) * q / k); next[j + q].end = r3(a + (b - a) * (q + 1) / k); }
    j = e;
  }
  S.lines = next;
  rows.forEach((r, j) => {
    const l = S.lines[j];
    for (const tr of hasT ? [false, true] : [false]) {
      const { main, bg } = parseRow(tr ? r.t : r.o), bl: Layer = tr ? 'bg' : 'bgo';
      keepText(j, tr ? 'tr' : 'orig', main);
      if (bg || layerText(l, bl)) keepText(j, bl, bg);
    }
    if (l.bg && !l.bg.text.trim() && !l.bg.tr.trim()) { delete l.bg; if (l.sync) { delete l.sync.bg; delete l.sync.bgo; } }
  });
  if (S.sel && S.sel.i >= S.lines.length) S.sel = { i: S.lines.length - 1, k: 0 };
  afterLines(); resetText(); msg('Текст применён. Тайминги неизменённых слов на месте. Ctrl+Z — отмена.', 'ok');
}
function setupText() {
  root.querySelectorAll<HTMLElement>('#st-ltabs button').forEach(b => b.onclick = () => setLeftTab(b.dataset.v === 'text'));
  const g = $('tGut'), o = $('tO') as HTMLTextAreaElement, t = $('tT') as HTMLTextAreaElement;
  const sync = (src: HTMLElement) => { for (const x of [g, o, t]) if (x !== src) x.scrollTop = src.scrollTop; };
  for (const [ta, k] of [[o, 'o'], [t, 't']] as const) {
    ta.oninput = () => { TX[k] = ta.value; TX.dirty = true; textStat(); };
    ta.onscroll = () => sync(ta);
    ta.onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); applyText(); } };
  }
  $('tApply').onclick = applyText; $('tReset').onclick = resetText;
}

/* ---------- inline text editor on the timeline ---------- */
const WE = { el: null as HTMLInputElement | null, i: -1, layer: 'tr' as Layer, k: -1, fresh: false };
function newLineEdit(t: number, layer: Layer) {
  const i = addLineAt(t, isBg(layer));
  setLayer(layer); S.sel = { i, k: 0 }; openEdit(i, layer, -1, true);
}
/** k >= 0: one word (spaces add words, empty deletes it); k = -1: the whole text of the line on this track */
function openEdit(i: number, layer: Layer, k = -1, fresh = false) {
  closeEdit(true);
  const cv = $('wave') as HTMLCanvasElement, l = S.lines[i]; if (!l) return;
  const [y, hh] = laneY(isBg(layer) ? 'bg' : 'main'), vw = viewWords(i, layer).filter(x => x.a != null), one = k >= 0 ? viewWords(i, layer)[k] : null;
  const a = one && one.a != null ? one.a : vw.length ? vw[0].a! : l.t, b = one && one.b != null ? one.b : vw.length ? vw[vw.length - 1].b! : l.end;
  const X = (t: number) => (t - W.start) * W.px, cw = cv.clientWidth || 800;
  const left = clamp(X(a) - 4, 0, Math.max(0, cw - 160)), width = clamp(X(b) - X(a) + 30, k >= 0 ? 130 : 280, Math.max(160, cw - left));
  const el = document.createElement('input'); el.type = 'text'; el.className = 'st-wedit' + (isBg(layer) ? ' bg' : '');
  el.value = k >= 0 ? (wordsOf(i, layer)[k] || '') : layerText(l, layer);
  el.placeholder = k >= 0 ? 'слово · пробел — ещё слова · пусто — удалить' : (isBg(layer) ? 'бэк' : 'строка') + (isTr(layer) ? ' (перевод)' : ' (оригинал)') + ' · Enter — готово, Esc — отмена';
  Object.assign(el.style, { left: cv.offsetLeft + left + 'px', top: cv.offsetTop + y + 'px', width: width + 'px', height: Math.max(26, hh) + 'px' });
  Object.assign(WE, { el, i, layer, k, fresh });
  el.onkeydown = ev => { ev.stopPropagation(); if (ev.key === 'Enter') { ev.preventDefault(); closeEdit(true); } };
  el.onblur = () => closeEdit(true);
  $('dock').appendChild(el); el.focus(); el.select();
}
function closeEdit(commit: boolean) {
  const el = WE.el; if (!el) return;
  WE.el = null; el.onblur = null; el.remove();
  const { i, layer, k, fresh } = WE, l = S.lines[i]; if (!l) return;
  const v = el.value.replace(/[^\S\u00a0]+/g, ' ').trim();
  if (fresh && (!commit || !v)) { const u = S.undo.pop(); if (u) restore(u); return; } // empty new line = never mind
  if (!commit) return;
  if (k >= 0) {
    if (v === (wordsOf(i, layer)[k] || '')) return;
    snap(); const r = replaceUnit(layerText(l, layer), l.sync && l.sync[layer], k, v); if (!r) return;
    setText(i, layer, r.text); l.sync = l.sync || {};
    if (r.sync && r.sync.length) { l.sync[layer] = r.sync; fillLine(i, layer); } else delete l.sync[layer];
    S.sel = { i, k: clamp(k, 0, Math.max(0, wordsOf(i, layer).length - 1)) };
    syncRow(i); buildPreview(true); afterSyncChange(false, i);
  } else {
    if (v === layerText(l, layer)) return;
    if (!fresh) snap();
    keepText(i, layer, v);
    if (fresh) l.end = r3(Math.min(l.end, l.t + Math.max(0.6, 0.45 * wordsOf(i, layer).length))); // not 3 s: don't swallow neighbours
    fillLine(i, layer); syncRow(i); buildPreview(true); afterSyncChange(false, i);
  }
}
function syncRow(i: number) { // list row <- model, without rebuilding the whole list (keeps focus)
  const r = root.querySelector('#st-ln' + i), l = S.lines[i]; if (!r || !l) return;
  (r.querySelector('input.o') as HTMLInputElement).value = l.text; (r.querySelector('input.tr') as HTMLInputElement).value = l.tr || '';
  r.classList.toggle('bgonly', !l.text.trim()); renderBgRow(r.querySelector('.st-bgrow') as HTMLElement, i);
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
    offset: parseInt($('offset').value, 10) || 0, songwriters: $('writers').value.split(',').map((s: string) => s.trim()), roman: $('roman').checked };
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
  const r = qaCheck(S.lines, mode(), { wordSpread: $('spread').checked }), box = $('qaOut'); box.innerHTML = '';
  const e = r.filter(x => x.sev === 'err').length;
  msg(S.lines.length ? (r.length ? `QA: ошибок ${e}, замечаний ${r.length - e}` : 'QA: всё чисто ✓') : '', e ? 'err' : 'ok');
  r.slice(0, 80).forEach(x => {
    const d = document.createElement('div'); d.className = x.sev; d.textContent = `строка ${x.i + 1}: ${x.msg}`;
    d.onclick = () => { setLayer(mainLayerFor(x.i)); seekTo(S.lines[x.i].t); selectWord(x.i, 0); centerOnSel(); };
    box.appendChild(d);
  });
}

/* ---------- hotkeys (capture phase: Spotify must not see the keys we use, e.g. Space) ---------- */
const KEYS = new Set(['KeyB', 'KeyT', 'KeyE', 'Digit1', 'Digit2', 'Digit3', 'KeyV', 'KeyM', 'KeyU', 'KeyN', 'KeyL', 'KeyR', 'Comma', 'Period', 'Space', 'KeyF', 'KeyG', 'KeyH', 'KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight', 'Delete', 'Backspace']);
function onKey(e: KeyboardEvent) {
  if (!S.open) return;
  const tg = e.target as HTMLElement, tag = tg && tg.tagName;
  if (e.code === 'Escape') { // peel one layer per press: help → menus → text field → the panel itself
    e.stopImmediatePropagation();
    const menus = root.querySelectorAll('details[open]'), act = document.activeElement as HTMLElement | null;
    if (WE.el) closeEdit(false);
    else if (!$('help').hidden) $('help').hidden = true;
    else if (menus.length) menus.forEach(d => (d as HTMLDetailsElement).open = false);
    else if (act && root.contains(act) && /^(INPUT|TEXTAREA|SELECT)$/.test(act.tagName)) act.blur();
    else if (S.picked.size) { S.picked.clear(); paintPicked(); drawWave(); }
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
  if (c === 'Digit1') return setAgent('v1');
  if (c === 'Digit2') return setAgent('v2');
  if (c === 'Digit3') return setAgent('v1000');
  if (c === 'KeyV') { if (S.sel) cycleAgent(S.sel.i); return; }
  if (c === 'KeyM') return joinWords();
  if (c === 'KeyU') return splitWord();
  if (e.repeat) return;
  if (c === 'KeyB') { setLayer(mkLayer(!isBg(S.layer), isTr(S.layer))); return msg(isBg(S.layer) ? 'Дорожка: бэк (B — обратно на основу).' : 'Дорожка: основа.', 'ok'); }
  if (c === 'KeyT') { setLayer(mkLayer(isBg(S.layer), !isTr(S.layer))); return msg(isTr(S.layer) ? 'Размечаем перевод (T).' : 'Размечаем оригинал (T).', 'ok'); }
  if (c === 'KeyE') { if (S.sel) openEdit(S.sel.i, S.layer, wordsOf(S.sel.i, S.layer).length ? S.sel.k : -1); return; }
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
    <button id="st-fromSpicy">⇣ Взять из Spicy Lyrics (текст, исполнители, слоги)</button>
    <button id="st-agentsSpicy">⇣ Только исполнители из Spicy (перевод не трогает)</button>
    <button id="st-reload">↻ Заново из LRCLIB (сбросит проект)</button>
    <textarea id="st-manual" placeholder="[00:12.30] первая строка&#10;[00:15.80] вторая строка&#10;или просто текст, строка за строкой"></textarea>
    <button id="st-manualApply">Загрузить LRC / текст</button>
    <label class="st-btn" title="Свой текст для нового трека: .txt, .lrc, .srt, .ttml (наш, Apple, Spicy — с исполнителями, бэками и разметкой). Можно просто перетащить файл на панель.">📄 Импорт файла…<input type="file" id="st-file" accept=".txt,.lrc,.srt,.ttml,.xml" hidden></label>
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
    <label class="st-opt"><span>Транслитерация<small>латиница под кириллицей в Spicy</small></span><input type="checkbox" id="st-roman"></label>
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
    <label class="st-opt"><span>Тема</span><select id="st-theme"><option value="auto">как в Spotify</option><option value="dark">чёрная</option><option value="light">белая</option></select></label>
    <label class="st-opt"><span>Сдвиг превью, мс<small>отстаёт → плюс, спешит → минус</small></span><input type="number" id="st-voff" value="0" step="10"></label>
    <label class="st-opt"><span>Магнит <kbd>N</kbd></span><input type="checkbox" id="st-snapChk" checked></label>
    <label class="st-opt"><span>Эффекты слов в превью</span><input type="checkbox" id="st-fxChk" checked></label>
  </div></details>
  <button id="st-helpBtn" title="Как размечать">?</button>
  <button id="st-close" title="Закрыть">✕</button>
</div>
<div class="st-main">
  <div class="st-left">
    <div class="st-ltabs" id="st-ltabs"><button data-v="lines" class="on">Строки</button><button data-v="text" title="Весь текст: оригинал и перевод рядом, (в скобках) = бэк">Текст</button></div>
    <div class="st-text" id="st-text" hidden>
      <div class="st-trow"><button class="pri" id="st-tApply" title="Ctrl+Enter" disabled>Применить</button><button id="st-tReset" disabled>Сбросить</button><span class="st-hint" id="st-tStat"></span></div>
      <div class="st-tgrid"><div class="th">#</div><div class="th">Оригинал</div><div class="th">Перевод</div>
        <div class="st-tgut" id="st-tGut"></div><textarea id="st-tO" wrap="off" spellcheck="false"></textarea><textarea id="st-tT" wrap="off" spellcheck="false" placeholder="перевод — напротив своей строки"></textarea></div>
    </div>
    <div class="st-ltools" id="st-ltools">
      <button id="st-addAt" title="Пустая строка в точке воспроизведения — для своих слов или бэка, которого нет в найденном тексте">+ строка у курсора</button>
      <button id="st-addBgAt" title="Отдельный бэк (без основной строки) в точке воспроизведения">+ бэк у курсора</button>
      <button id="st-parens" title="«текст (бэк)» → «(бэк)» уходит в фоновый вокал строки, тайминги слов переезжают вместе со словами">( ) → бэки</button>
    </div>
    <div class="st-lines" id="st-lines"></div>
  </div>
  <div class="st-stage"><div class="st-lyr"><div class="st-lyrIn" id="st-lyrIn"></div></div></div>
</div>
<div class="st-dock" id="st-dock">
  <div class="st-grip" id="st-grip" title="Потяни, чтобы изменить высоту панели (двойной клик — как было)"></div>
  <div class="st-dbar">
    <span class="st-seg" id="st-seg" title="Что размечаем: перевод или оригинал (T)"><button data-v="tr">Перевод</button><button data-v="orig">Оригинал</button></span>
    <span class="st-seg st-trk" id="st-trk" title="Дорожка: основная строка или бэк (B). Клик по дорожке на таймлайне тоже переключает"><button data-v="main">Основа</button><button data-v="bg">Бэк</button></span>
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
    <span class="st-grp st-voice"><small>голос</small><button id="st-ag1" data-agent="v1" title="Исполнитель 1 — слева (клавиша 1). Выдели строки слева: клик, Shift — диапазон, Ctrl — по одной">1</button><button id="st-ag2" data-agent="v2" title="Исполнитель 2 — справа (клавиша 2)">2</button><button id="st-ag3" data-agent="v1000" title="Вместе (клавиша 3)">1+2</button></span>
    <span class="st-grp"><button id="st-join" title="M">⛓ Склеить</button><button id="st-split" title="U">✂ Слоги</button>
      <details class="st-menu up"><summary class="st-btn">Строка ⋯</summary><div class="st-pop">
        <button id="st-sylLine">✂ Разбить строку на слоги</button>
        <button id="st-lineSpread">↔ Раскидать слова строки ровно</button>
        <button id="st-allSpread">↔ Раскидать все неразмеченные строки</button>
        <button id="st-lineReset">⌫ Сбросить строку</button>
        <button id="st-lineFit" title="Начало и конец строки = её размеченные слова. Края строки в полосе внизу можно и тянуть мышью.">⇔ Подогнать строку под слова</button>
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
  <p><b>Дорожки.</b> Сверху — основная строка, под ней — бэк, ниже — строки трека. Клик по дорожке (или <kbd>B</kbd>) переключает основу/бэк, <kbd>T</kbd> — перевод/оригинал. <b>Двойной клик</b>: по слову — исправить его (пробел добавит слова, пусто — удалит), по пустому месту строки — вписать/исправить всю строку этой дорожки, там, где строк нет, — новая строка (на дорожке «бэк» — отдельный бэк). <kbd>E</kbd> — править выбранное слово. Тайминги неизменённых слов сохраняются.</p>
  <p>Полоса строк внизу: тащи строку — едет целиком со всеми словами на обеих дорожках. <b>Копии как в монтажке:</b> <kbd>Alt</kbd>+тащи слово — копия станет новой строкой (на дорожке «бэк» — отдельным бэком), <kbd>Alt</kbd>+тащи строку — копия строки; <kbd>Shift</kbd>+тащи слово — двигать без склеенных соседей. Вкладка «Текст» слева — вся песня: оригинал и перевод рядом.</p>
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
  on('addAt', () => focusRow(addLineAt(now())));
  on('addBgAt', () => { const i = addLineAt(now(), true); renderBgRow(root.querySelector('#st-ln' + i + ' .st-bgrow') as HTMLElement, i); focusRow(i, '.st-bgrow input'); });
  on('parens', bracketsToBg);
  on('fromSpicy', fromSpicy); on('agentsSpicy', agentsFromSpicy);
  on('ag1', () => setAgent('v1')); on('ag2', () => setAgent('v2')); on('ag3', () => setAgent('v1000'));
  ($('file') as HTMLInputElement).onchange = (e: Event) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) importFile(f); (e.target as HTMLInputElement).value = ''; };
  root.addEventListener('dragover', e => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
  root.addEventListener('drop', e => { const f = e.dataTransfer?.files?.[0]; if (f && /\.(txt|lrc|srt|ttml|xml)$/i.test(f.name)) { e.preventDefault(); importFile(f); } });
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
  on('lineFit', () => { if (!S.sel) return msg('Сначала выбери слово.', 'err'); snap(); if (!fitLineToWords(S.lines[S.sel.i])) { S.undo.pop(); return msg('В строке нет размеченных слов.', 'err'); } const sl = S.lines[S.sel.i]; S.lines.sort((x, y) => x.t - y.t); S.sel.i = S.lines.indexOf(sl); afterLines(); });
  on('lineReset', () => { if (!S.sel) return; snap(); const l = S.lines[S.sel.i]; if (l.sync) delete l.sync[S.layer]; afterSyncChange(false, S.sel.i); });
  root.querySelectorAll<HTMLElement>('#st-seg button').forEach(b => b.onclick = () => setLayer(mkLayer(isBg(S.layer), b.dataset.v === 'tr')));
  root.querySelectorAll<HTMLElement>('#st-trk button').forEach(b => b.onclick = () => setLayer(mkLayer(b.dataset.v === 'bg', isTr(S.layer))));
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
  { const th = store.get('theme', 'auto'); $('theme').value = th; root.dataset.theme = th; $('theme').onchange = () => setTheme($('theme').value); }
  setupGrip();
  ($('lyrIn').parentElement as HTMLElement).addEventListener('wheel', (e: WheelEvent) => { e.preventDefault(); SCR.manual -= e.deltaY; SCR.until = performance.now() + 3000; applyScroll(); }, { passive: false });
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('beforeunload', saveProject);
  setupWave(); setupText(); renderEditor(); buildPreview(); renderSync();
  if (!store.get('helpSeen', '')) { $('help').hidden = false; store.set('helpSeen', '1'); }
}

/* bottom panel height: drag the grip; the timeline grows with it */
function setDockH(h: number) {
  const max = Math.max(220, (root.clientHeight || innerHeight) - 160);
  h = clamp(Math.round(h), 250, max);
  root.style.setProperty('--dockH', h + 'px'); root.style.setProperty('--waveH', Math.round(clamp(h * 0.42, 140, 330)) + 'px');
  store.set('dockH', String(h)); drawWave();
}
function setupGrip() {
  const g = $('grip'), dock = $('dock');
  setDockH(+store.get('dockH', '330') || 330);
  g.onpointerdown = (e: PointerEvent) => {
    e.preventDefault(); g.setPointerCapture(e.pointerId); g.classList.add('drag');
    const y0 = e.clientY, h0 = dock.getBoundingClientRect().height;
    g.onpointermove = (m: PointerEvent) => setDockH(h0 + (y0 - m.clientY));
    g.onpointerup = () => { g.onpointermove = null; g.classList.remove('drag'); };
  };
  g.ondblclick = () => setDockH(330);
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
  if (open) { place(); readTheme(); }
  if (open) { loadTrack(); lastAct = -2; requestAnimationFrame(frame); } else saveProject();
}
export function onSongChange() { if (S.open) loadTrack(); }
