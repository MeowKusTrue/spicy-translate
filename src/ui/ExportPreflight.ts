import { lintExport, type ExportOpts } from '../core/index.ts';
import { S, emit } from '../state.ts';
import { afterSyncChange, snap } from '../sync.ts';
import { buildPreview } from '../preview.ts';

/** One open check shared by download, clipboard and folder exports. */
let pending: Promise<boolean> | null = null;
export function reviewExport(options: () => ExportOpts): Promise<boolean> {
  if (pending) return Promise.resolve(false);
  if (!lintExport(options()).length) return Promise.resolve(true);
  pending = new Promise<boolean>(resolve => {
    const dialog = document.createElement('dialog'); dialog.id = 'exportPreflight'; dialog.className = 'export-preflight';
    dialog.setAttribute('aria-labelledby', 'exportPreflightTitle');
    const title = document.createElement('h2'); title.id = 'exportPreflightTitle'; title.textContent = 'Проверка перед экспортом';
    const hint = document.createElement('p'); hint.textContent = 'Исправления меняют проект и отменяются через Ctrl+Z. Преобразование бэка выбирай только если он поётся отдельной фразой. Время слов сохраняется.';
    const summary = document.createElement('p'), list = document.createElement('ol'), actions = document.createElement('div'); actions.className = 'row';
    const finish = (ok: boolean) => { dialog.close(); dialog.remove(); resolve(ok); };
    const cancel = document.createElement('button'); cancel.textContent = 'Отмена'; cancel.onclick = () => finish(false);
    const save = document.createElement('button'); save.id = 'btnExportAnyway'; save.className = 'pri'; save.onclick = () => finish(true);
    actions.append(cancel, save); dialog.append(title, hint, summary, list, actions);
    const render = () => {
      const issues = lintExport(options()), errors = issues.filter(x => x.sev === 'err').length;
      summary.textContent = issues.length ? `Ошибок: ${errors}. Предупреждений: ${issues.length - errors}.` : 'Замечаний нет.';
      save.textContent = issues.length ? 'Экспортировать с замечаниями' : 'Экспортировать';
      list.replaceChildren();
      for (const issue of issues) {
        const item = document.createElement('li'), text = document.createElement('p');
        text.textContent = `${issue.sev === 'err' ? 'Ошибка' : 'Предупреждение'} · строка ${issue.i + 1}: ${issue.msg}`; item.append(text);
        if (issue.fix) {
          const fix = document.createElement('button'); fix.type = 'button'; fix.className = 'sm'; fix.textContent = issue.fix.label;
          fix.onclick = () => {
            snap(); S.lines[issue.i] = issue.fix!.line; S.out = null;
            buildPreview(true); afterSyncChange(true, 0, false); emit(); render();
          }; item.append(fix);
        }
        list.append(item);
      }
    };
    dialog.addEventListener('keydown', e => e.stopPropagation());
    dialog.addEventListener('cancel', e => { e.preventDefault(); finish(false); });
    render(); document.body.append(dialog); dialog.showModal(); cancel.focus();
  }).finally(() => { pending = null; });
  return pending;
}
