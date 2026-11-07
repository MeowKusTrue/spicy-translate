// The preview owns its DOM; keep the editing form in the very same lyric block.
import { S, layerText, mainLayerFor, setEditDraft, toast } from './state.ts';
import { pause } from './audio.ts';
import { editText } from './lineEdit.ts';
import { buildPreview } from './preview.ts';
import { drawWave } from './waveform/wave.ts';
import { snap } from './sync.ts';
import { fmtTime, mergeMarkup, slashSyl, textDraftLine, units, type Layer } from './core/index.ts';

export const PREVIEW_EDIT = { active: false, dirty: false };
let finishEdit: (() => boolean) | null = null;
export function savePreviewEdit() { return finishEdit ? finishEdit() : true; }
function beforeTimelineAction(e: Event) {
  if (!PREVIEW_EDIT.active || !(e.target instanceof Element) || !e.target.closest('#dock, #editorToolbar, #wordInspector, .player, .compact-lines, .studio-nav')) return;
  if (!savePreviewEdit()) { e.preventDefault(); e.stopImmediatePropagation(); }
}
document.addEventListener('pointerdown', beforeTimelineAction, true);
document.addEventListener('wheel', beforeTimelineAction, { capture: true, passive: false });
document.addEventListener('click', beforeTimelineAction, true);
document.addEventListener('keydown', beforeTimelineAction, true);
export function editPreview(i: number, host: HTMLElement, layer: Layer = mainLayerFor(i)) {
  if (PREVIEW_EDIT.active || S.editDraft) return toast('Сохрани или отмени текущую правку текста.', 'err');
  const line = S.lines[i]; if (!line) return;
  pause();
  const old = layerText(line, layer), visible = old.replace(/\|/g, '');
  let marked = old, showSyllables = false;
  S.syllableReview = null; S.layer = layer; S.sel = { i, k: 0 };
  PREVIEW_EDIT.active = true; PREVIEW_EDIT.dirty = false; document.body.classList.add('preview-drafting');
  host.classList.add('preview-edit-host');
  const form = document.createElement('form'); form.className = 'preview-edit'; form.id = 'previewEdit';
  const header = document.createElement('div'); header.className = 'preview-edit-header';
  const heading = document.createElement('b'); heading.textContent = `Строка ${i + 1} · ${{orig:'Оригинал',tr:'Перевод',bgo:'Бэк · оригинал',bg:'Бэк · перевод'}[layer]}`;
  const time = document.createElement('small'); time.textContent = `${fmtTime(line.t)} — ${fmtTime(line.end)}`; header.append(heading, time);
  const tools = document.createElement('div'); tools.className = 'preview-edit-tools';
  const mode = document.createElement('button'); mode.type = 'button'; mode.id = 'btnPreviewMarkup'; mode.textContent = 'Показать слоги'; mode.setAttribute('aria-pressed','false');
  const insert = document.createElement('button'); insert.type = 'button'; insert.id = 'btnPreviewInsertBoundary'; insert.textContent = 'Вставить |'; insert.title = 'Граница слога в месте курсора';
  const reset = document.createElement('button'); reset.type = 'button'; reset.textContent = 'Сбросить правку'; reset.id = 'btnPreviewReset';
  tools.append(mode, insert, reset);
  const input = document.createElement('span'); input.id = 'previewEditText'; input.contentEditable = 'plaintext-only'; input.textContent = visible; input.setAttribute('role', 'textbox');
  input.setAttribute('aria-label', 'Текст строки в просмотре'); input.setAttribute('aria-multiline', 'false');
  input.setAttribute('aria-describedby','previewEditHelp previewEditError'); input.spellcheck = true;
  const help = document.createElement('p'); help.id = 'previewEditHelp'; help.className = 'preview-edit-help'; help.textContent = 'Enter — сохранить · Esc — отменить. Границы слогов скрыты, но сохраняются.';
  const stats = document.createElement('span'); stats.className = 'preview-edit-stats'; stats.setAttribute('aria-live','polite');
  const error = document.createElement('p'); error.className = 'preview-edit-error'; error.id = 'previewEditError'; error.setAttribute('role', 'alert');
  const actions = document.createElement('div'); actions.className = 'preview-edit-actions';
  const save = document.createElement('button'); save.type = 'submit'; save.className = 'pri'; save.textContent = 'Сохранить'; save.id = 'btnPreviewSave';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Отмена'; cancel.id = 'btnPreviewCancel';

  const close = () => { finishEdit = null; document.body.classList.remove('preview-drafting'); PREVIEW_EDIT.active = false; PREVIEW_EDIT.dirty = false; setEditDraft(null); form.remove(); host.classList.remove('preview-edit-host'); buildPreview(true); document.getElementById('pl' + i)?.focus({ preventScroll: true }); };
  finishEdit = () => {
    const raw = (input.textContent || '').replace(/\r?\n/g, ' ').trim();
    const value = slashSyl(showSyllables ? raw : mergeMarkup(marked, raw), old);
    if (!value) { error.textContent = 'Строка пуста. Введи текст или нажми «Отмена».'; input.focus(); return false; }
    if (/(^|\s|\|)\||\|($|\s)/.test(value)) { error.textContent = 'Граница | должна стоять внутри слова, между слогами.'; input.focus(); return false; }
    if (S.lines[i] !== line || layerText(line, layer) !== old) { error.textContent = 'Строка обновилась в другом окне. Скопируй правку и открой строку заново.'; return false; }
    if (value !== old) { finishEdit = null; document.body.classList.remove('preview-drafting'); snap(); PREVIEW_EDIT.active = false; PREVIEW_EDIT.dirty = false; setEditDraft(null); editText(i, layer, value); toast('Текст изменён. Ctrl+Z — отмена.', 'ok'); }
    else close();
    return true;
  };
  form.onsubmit = e => { e.preventDefault(); savePreviewEdit(); };
  cancel.onclick = close;
  form.onclick = e => e.stopPropagation(); form.ondblclick = e => e.stopPropagation();
  form.onkeydown = e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); close(); } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } };
  const update = () => {
    const raw = (input.textContent || '').replace(/\r?\n/g, ' ');
    marked = slashSyl(showSyllables ? raw : mergeMarkup(marked, raw), old);
    PREVIEW_EDIT.dirty = marked.trim() !== old; error.textContent = '';
    const ws = units(marked); stats.textContent = `${ws.filter(w => w.sp).length} слов · ${ws.length} блоков${PREVIEW_EDIT.dirty ? ' · Не сохранено' : ' · Без изменений'}`;
    setEditDraft({ i, layer, owner: 'preview', line: textDraftLine(line, layer, marked) }); drawWave();
  };
  input.oninput = update;
  const caret = () => {
    const sel = window.getSelection(); if (!sel?.rangeCount || !input.contains(sel.anchorNode)) return (input.textContent || '').length;
    const prefix = sel.getRangeAt(0).cloneRange(); prefix.selectNodeContents(input); prefix.setEnd(sel.anchorNode!, sel.anchorOffset); return prefix.toString().length;
  };
  const focusAt = (offset: number) => {
    input.focus({ preventScroll: true }); const range = document.createRange();
    if (!input.firstChild) input.append(document.createTextNode(''));
    range.setStart(input.firstChild!, Math.min(offset, input.firstChild!.textContent?.length || 0)); range.collapse(true);
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
  };
  const switchMode = () => {
    const offset = caret(), oldVisible = (input.textContent || '').slice(0, offset).replace(/\|/g,'').length;
    update(); showSyllables = !showSyllables; input.textContent = showSyllables ? marked : marked.replace(/\|/g,'');
    mode.setAttribute('aria-pressed',String(showSyllables)); mode.textContent = showSyllables ? 'Скрыть слоги' : 'Показать слоги';
    help.textContent = showSyllables ? 'Ставь | между слогами; дефис — перед |. Enter — сохранить · Esc — отменить.' : 'Enter — сохранить · Esc — отменить. Границы слогов скрыты, но сохраняются.';
    let target = 0, letters = 0; const value = input.textContent || '';
    while (target < value.length && letters < oldVisible) { if (value[target] !== '|') letters++; target++; }
    focusAt(target);
  };
  mode.onmousedown = e => e.preventDefault(); mode.onclick = switchMode;
  insert.onmousedown = e => e.preventDefault(); insert.onclick = () => {
    if (!showSyllables) switchMode();
    const offset = caret(), value = input.textContent || '';
    input.textContent = value.slice(0,offset) + '|' + value.slice(offset); focusAt(offset + 1); update();
  };
  reset.onclick = () => { marked = old; input.textContent = showSyllables ? old : visible; update(); focusAt((input.textContent || '').length); };
  input.onkeydown = e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); close(); } else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } };
  actions.append(stats, cancel, save); form.append(header, tools, input, help, error, actions); host.append(form);
  update(); focusAt(visible.length);
}
window.addEventListener('beforeunload', e => { if (PREVIEW_EDIT.dirty) { e.preventDefault(); e.returnValue = ''; } });
