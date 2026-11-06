// The preview owns its DOM; keep the editing form in the very same lyric block.
import { S, layerText, mainLayerFor, setEditDraft, toast } from './state.ts';
import { pause } from './audio.ts';
import { editText } from './lineEdit.ts';
import { buildPreview } from './preview.ts';
import { drawWave } from './waveform/wave.ts';
import { snap } from './sync.ts';
import { mergeMarkup, textDraftLine, type Layer } from './core/index.ts';

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
  S.syllableReview = null; S.layer = layer; S.sel = { i, k: 0 };
  PREVIEW_EDIT.active = true; PREVIEW_EDIT.dirty = false; document.body.classList.add('preview-drafting');
  host.classList.add('preview-edit-host');
  const form = document.createElement('form'); form.className = 'preview-edit'; form.id = 'previewEdit';
  const input = document.createElement('span'); input.id = 'previewEditText'; input.contentEditable = 'plaintext-only'; input.textContent = visible; input.setAttribute('role', 'textbox');
  input.setAttribute('aria-label', 'Текст строки в просмотре'); input.setAttribute('aria-multiline', 'false');
  const error = document.createElement('p'); error.className = 'preview-edit-error'; error.setAttribute('role', 'alert');
  const actions = document.createElement('div'); actions.className = 'preview-edit-actions';
  const save = document.createElement('button'); save.type = 'submit'; save.className = 'pri'; save.textContent = 'Сохранить'; save.id = 'btnPreviewSave';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Отмена'; cancel.id = 'btnPreviewCancel';

  const close = () => { finishEdit = null; document.body.classList.remove('preview-drafting'); PREVIEW_EDIT.active = false; PREVIEW_EDIT.dirty = false; setEditDraft(null); form.remove(); host.classList.remove('preview-edit-host'); buildPreview(true); document.getElementById('pl' + i)?.focus({ preventScroll: true }); };
  finishEdit = () => {
    const value = (input.textContent || '').replace(/\r?\n/g, ' ').trim();
    if (!value) { error.textContent = 'Строка пуста. Введи текст или нажми «Отмена».'; input.focus(); return false; }
    if (S.lines[i] !== line || layerText(line, layer) !== old) { error.textContent = 'Строка обновилась в другом окне. Скопируй правку и открой строку заново.'; return false; }
    if (value !== visible) { finishEdit = null; document.body.classList.remove('preview-drafting'); snap(); PREVIEW_EDIT.active = false; PREVIEW_EDIT.dirty = false; setEditDraft(null); editText(i, layer, mergeMarkup(old, value)); toast('Текст изменён. Ctrl+Z — отмена.', 'ok'); }
    else close();
    return true;
  };
  form.onsubmit = e => { e.preventDefault(); savePreviewEdit(); };
  cancel.onclick = close;
  form.onclick = e => e.stopPropagation(); form.ondblclick = e => e.stopPropagation();
  input.oninput = () => { PREVIEW_EDIT.dirty = input.textContent !== visible; error.textContent = ''; setEditDraft({ i, layer, owner: 'preview', line: textDraftLine(line, layer, mergeMarkup(old, input.textContent || '')) }); drawWave(); };
  input.onkeydown = e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); close(); } else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } };
  actions.append(save, cancel); form.append(input, error, actions); host.append(form);
  input.focus({ preventScroll: true }); const range = document.createRange(); range.selectNodeContents(input); range.collapse(false); const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
}
window.addEventListener('beforeunload', e => { if (PREVIEW_EDIT.dirty) { e.preventDefault(); e.returnValue = ''; } });
