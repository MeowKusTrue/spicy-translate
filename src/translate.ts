// Translation: Google (unofficial gtx endpoint), copy-a-prompt, direct LLM call, paste a list/JSON back.
import { plainW } from './core/index.ts';
import { S, emit, ls, status } from './state.ts';
import { buildPreview } from './preview.ts';
import { scheduleSave } from './persist.ts';
import { drawWave } from './waveform/wave.ts';

export const LANGS: [string, string][] = [['ru', 'на русский'], ['en', 'на английский'], ['uk', 'на украинский'], ['kk', 'на казахский'], ['be', 'на белорусский'],
  ['es', 'на испанский'], ['de', 'на немецкий'], ['fr', 'на французский'], ['it', 'на итальянский'], ['pt', 'на португальский'], ['tr', 'на турецкий'],
  ['pl', 'на польский'], ['ja', 'на японский'], ['ko', 'на корейский'], ['zh-CN', 'на китайский']];
const langName = () => (LANGS.find(x => x[0] === S.meta.lang)?.[1] || LANGS[0][1]).replace('на ', '');
const refresh = () => { buildPreview(true); emit(); drawWave(); scheduleSave(); };

export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  try { const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; } catch { return false; }
}

async function gt(text: string, tl: string) {
  const u = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=' + encodeURIComponent(tl) + '&dt=t&q=' + encodeURIComponent(text);
  const r = await fetch(u); if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json(); return (j[0] as [string][]).map(x => x[0]).join('');
}
export async function autoTranslate() {
  if (!S.lines.length) return status('st2', 'Сначала загрузи текст.', 'err');
  const tl = S.meta.lang; S.busyAuto = true; emit();
  let done = 0, fail = 0, idx = 0;
  const worker = async () => {
    while (idx < S.lines.length) {
      const i = idx++, l = S.lines[i];
      try {
        l.tr = await gt(plainW(l.text), tl); if (l.sync) delete l.sync.tr;
        if (l.bg && l.bg.text.trim()) { l.bg.tr = await gt(plainW(l.bg.text), tl); if (l.sync) delete l.sync.bg; }
      }
      catch { fail++; }
      status('st2', `Перевожу… ${++done}/${S.lines.length}`);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  S.busyAuto = false; refresh();
  status('st2', fail ? `Готово, но ${fail} строк не перевелись — допиши руками.` : 'Готово. Проверь и поправь строки, машинный перевод песен бывает смешной.', fail ? 'err' : 'ok');
}
export function copyPrompt() {
  if (!S.lines.length) return status('st2', 'Сначала загрузи текст.', 'err');
  const p = `Переведи текст песни на язык: ${langName()}. Передавай смысл и настроение естественно, не дословно, сохраняй рифму там, где получается. ВАЖНО: ровно ${S.lines.length} строк в ответе, по одной на каждую строку оригинала, в том же порядке, только список без комментариев.\n\n` +
    S.lines.map((l, i) => `${i + 1}. ${plainW(l.text)}`).join('\n');
  copyText(p).then(ok => status('st2', ok ? 'Промпт скопирован. Вставь в LLM, потом ответ — через «Вставить перевод списком».' : 'Буфер заблокирован — промпт показан ниже, скопируй вручную.', ok ? 'ok' : 'err'));
}
export function parseLLM(txt: string) {
  const t = String(txt).replace(/```(?:json)?/g, ''), a = t.indexOf('['), b = t.lastIndexOf(']'); if (a < 0 || b < a) throw new Error('в ответе нет JSON-массива');
  const arr = JSON.parse(t.slice(a, b + 1)); if (!Array.isArray(arr)) throw new Error('ожидался массив');
  return arr.map((x, k) => typeof x === 'string' ? { i: k, tr: x } : { i: x.i ?? k, tr: String(x.tr ?? x.text ?? ''), ...(x.bg ? { bg: String(x.bg) } : {}) });
}
function applyTr(rows: { i: number; tr: string; bg?: string }[]) {
  let n = 0; rows.forEach(r => {
    const l = S.lines[r.i]; if (!l) return;
    if (r.tr.trim()) { l.tr = r.tr.trim(); if (l.sync) delete l.sync.tr; n++; }
    if (l.bg && r.bg && r.bg.trim()) { l.bg.tr = r.bg.trim(); if (l.sync) delete l.sync.bg; }
  });
  if (n) S.layer = S.layer === 'bg' || S.layer === 'bgo' ? 'bg' : 'tr';
  refresh(); return n;
}
export async function llmTranslate() {
  if (!S.lines.length) return status('st2', 'Сначала загрузи текст.', 'err');
  const { prov, key } = S.llm, model = S.llm.model.trim(), style = S.llm.style.trim();
  let url = S.llm.url.trim().replace(/\/+$/, ''); if (!url && prov === 'anthropic') url = 'https://api.anthropic.com';
  if (!model || !url) return status('st2', 'Укажи модель и Base URL.', 'err');
  ls.set('llm', JSON.stringify({ prov, model, key: key.trim(), url: S.llm.url.trim(), style }));
  const sys = 'Ты литературный переводчик текстов песен. Переводи на язык: ' + langName() + '. Передавай смысл, настроение, сленг и рифму естественно, не дословно; число слов в строке держи близко к оригиналу (подсветка идёт по словам). Одинаковые строки (припев) переводи одинаково. Не склеивай и не разбивай строки. Если у строки есть поле bg (фоновый вокал, бэки), переведи и его в поле bg. Ответ — ТОЛЬКО JSON-массив [{"i":число,"tr":"перевод","bg":"перевод бэка, только если был bg"}], ровно по одному элементу на каждую входную строку, без комментариев и markdown.';
  const user = 'Песня: ' + (S.meta.artist + ' — ' + S.meta.title) + '\n' + (style ? 'Заметки/глоссарий: ' + style + '\n' : '') + 'Строки:\n' + JSON.stringify(S.lines.map((l, i) => ({ i, text: plainW(l.text), ...(l.bg && l.bg.text.trim() ? { bg: plainW(l.bg.text) } : {}) })));
  S.busyLlm = true; status('st2', 'LLM переводит всю песню…');
  try {
    const k = key.trim();
    const r = prov === 'anthropic'
      ? await fetch(url + '/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': k, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify({ model, max_tokens: 8192, system: sys, messages: [{ role: 'user', content: user }] }) })
      : await fetch(url + '/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', ...(k ? { authorization: 'Bearer ' + k } : {}) }, body: JSON.stringify({ model, temperature: 0.4, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] }) });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 160));
    const j = await r.json(), txt = prov === 'anthropic' ? j.content.map((c: { text?: string }) => c.text || '').join('') : j.choices[0].message.content;
    const n = applyTr(parseLLM(txt));
    status('st2', n === S.lines.length ? 'Готово: переведена вся песня. Проверь и поправь.' : `Переведено ${n} из ${S.lines.length} строк — допиши недостающие.`, n === S.lines.length ? 'ok' : 'err');
  } catch (e) { status('st2', 'LLM: ' + (e as Error).message, 'err'); }
  S.busyLlm = false; emit();
}
export function applyPaste() {
  const raw = (S.paste || '').trim();
  if (/^[\[{`]/.test(raw)) { try { const n = applyTr(parseLLM(raw)); S.paste = null; return status('st2', `Применено строк: ${n} из ${S.lines.length}.`, n === S.lines.length ? 'ok' : 'err'); } catch (e) { return status('st2', 'JSON не разобрался: ' + (e as Error).message, 'err'); } }
  const rows = (S.paste || '').split(/\r?\n/).map(s => s.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean);
  rows.forEach((t, i) => { if (S.lines[i]) { S.lines[i].tr = t; if (S.lines[i].sync) delete S.lines[i].sync!.tr; } });
  S.paste = null; refresh();
  status('st2', rows.length === S.lines.length ? 'Перевод применён.' : `Внимание: строк в переводе ${rows.length}, в оригинале ${S.lines.length}.`, rows.length === S.lines.length ? 'ok' : 'err');
}
export function clearTr() { S.lines.forEach(l => { l.tr = ''; if (l.sync) delete l.sync.tr; }); buildPreview(true); emit(); drawWave(); status('st2', 'Перевод очищен.'); }
