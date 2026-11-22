import { fmtTime, lintExport, plainW, type ExportOpts, type Layer } from '../core/index.ts';
import { S, emit, layerText, mainLayerFor } from '../state.ts';
import { afterSyncChange, selectWord, setLayer, snap } from '../sync.ts';
import { buildPreview } from '../preview.ts';
import { seekTo } from '../audio.ts';
import { setPage } from '../hotkeys.ts';
import { centerOnSel } from '../waveform/wave.ts';
import { openSongwriters } from './MetaModal.tsx';

/** One open check shared by download, clipboard and folder exports. */
let pending: Promise<boolean> | null = null;
const acceptedOverlaps = new Set<string>();
const trackNames: Record<Layer,string> = { orig:'Оригинал', tr:'Перевод', bgo:'Бэк · оригинал', bg:'Бэк · перевод' };
const issuesFor = (o: ExportOpts) => lintExport(o).filter(x => !x.ignoredKey || !acceptedOverlaps.has(x.ignoredKey));
export function reviewExport(options: () => ExportOpts): Promise<boolean> {
  if (pending) return Promise.resolve(false);
  if (!issuesFor(options()).length) return Promise.resolve(true);
  pending = new Promise<boolean>(resolve => {
    const dialog = document.createElement('dialog'); dialog.id = 'exportPreflight'; dialog.className = 'export-preflight';
    dialog.setAttribute('aria-labelledby', 'exportPreflightTitle');
    const title = document.createElement('h2'); title.id = 'exportPreflightTitle'; title.textContent = 'Проверка перед экспортом';
    const hint = document.createElement('p'); hint.textContent = 'Выбери исправление или открой строку в редакторе. Каждое изменение отменяется через Ctrl+Z. Наложение голосов можно оставить, если оно задумано.';
    const summary = document.createElement('p'), list = document.createElement('div'), actions = document.createElement('div'); actions.className = 'row'; list.className = 'export-issue-list'; summary.setAttribute('aria-live','polite');
    const finish = (ok: boolean) => { dialog.close(); dialog.remove(); resolve(ok); };
    const cancel = document.createElement('button'); cancel.textContent = 'Отмена'; cancel.onclick = () => finish(false);
    const save = document.createElement('button'); save.id = 'btnExportAnyway'; save.className = 'pri'; save.onclick = () => finish(true);
    actions.append(cancel, save); dialog.append(title, hint, summary, list, actions);
    const render = () => {
      const before = JSON.stringify(S.lines);
      const issues = issuesFor(options()), errors = issues.filter(x => x.sev === 'err').length;
      summary.textContent = issues.length ? `Ошибок: ${errors}. Предупреждений: ${issues.length - errors}.` : 'Замечаний нет.';
      save.textContent = issues.length ? 'Экспортировать с замечаниями' : 'Экспортировать';
      list.replaceChildren();
      for (const issue of issues) {
        const item = document.createElement('section'); item.className = 'export-issue';
        const line = S.lines[issue.i], layer = issue.layer || mainLayerFor(issue.i);
        const heading = document.createElement('div'); heading.className = 'export-issue-heading';
        const title = document.createElement('b'); title.textContent = issue.action === 'metadata' ? 'Метаданные песни' : `Строка ${issue.i + 1} · ${fmtTime(line.t)} — ${fmtTime(line.end)}`;
        const badge = document.createElement('span'); badge.textContent = issue.sev === 'err' ? 'Ошибка' : 'Проверить'; badge.className = issue.sev;
        heading.append(title,badge);
        const lyric = document.createElement('blockquote'); lyric.textContent = plainW(layerText(line,layer) || line.bg?.text || line.bg?.tr || 'Пустая строка');
        const track = document.createElement('small'); track.textContent = trackNames[layer];
        const text = document.createElement('p'); text.textContent = issue.msg === 'слова не размечены — будет равномерный спред' ? 'У слов ещё нет индивидуального времени. Можно распределить их внутри строки как черновик.' : issue.msg;
        const related = issue.msg.match(/конца строки (\d+)/), previous = related ? S.lines[+related[1] - 1] : null;
        if (issue.action === 'metadata') item.append(heading,text); else item.append(heading, track, lyric, text);
        for(const example of issue.examples || []) {
          const context=document.createElement('p');context.className='export-issue-context';
          context.textContent=`«${example.text}» — ${example.locations.map(x=>`строка ${x.i+1} (${trackNames[x.layer]})`).join(', ')}`;item.append(context);
        }
        if (previous) {
          const context = document.createElement('p'); context.className = 'export-issue-context';
          const otherLayer = mainLayerFor(+related![1] - 1);
          context.textContent = `Предыдущая строка ${related![1]} · ${fmtTime(previous.t)} — ${fmtTime(previous.end)}: «${plainW(layerText(previous,otherLayer))}»`;
          item.append(context);
        }
        const advice = document.createElement('p'); advice.className = 'export-issue-advice';
        advice.textContent = issue.advice || (issue.fix ? 'Предложенное исправление применяется только по кнопке ниже.' : 'Открой строку, проверь её на слух и поправь текст или границы слов на таймлайне.'); item.append(advice);
        const buttons = document.createElement('div'); buttons.className = 'export-issue-actions';
        if (issue.action === 'metadata') {
          const metadata = document.createElement('button'); metadata.type='button'; metadata.className='sm'; metadata.textContent='Указать авторов песни';
          metadata.onclick=()=>{finish(false);openSongwriters();}; buttons.append(metadata); item.append(buttons); list.append(item); continue;
        }
        for(const plan of issue.batchFixes || []) {
          const fix=document.createElement('button');fix.type='button';fix.className='sm';fix.textContent=plan.label;
          fix.onclick=()=>{
            if(JSON.stringify(S.lines)!==before){render();return;}
            snap();for(const change of plan.changes)S.lines[change.i]=change.line;S.out=null;
            buildPreview(true);afterSyncChange(true,0,false);emit();render();
          };buttons.append(fix);
        }
        for (const plan of issue.fixes || (issue.fix ? [issue.fix] : [])) {
          const fix = document.createElement('button'); fix.type = 'button'; fix.className = 'sm'; fix.textContent = plan.label;
          fix.onclick = () => {
            snap(); S.lines[issue.i] = plan.line; S.out = null;
            buildPreview(true); afterSyncChange(true, 0, false); emit(); render();
          }; buttons.append(fix);
        }
        if (issue.ignoredKey) {
          const keep = document.createElement('button'); keep.type = 'button'; keep.className = 'sm'; keep.textContent = 'Оставить наложение (так и задумано)';
          keep.onclick = () => { acceptedOverlaps.add(issue.ignoredKey!); render(); }; buttons.append(keep);
        }
        if (previous) {
          const openPrevious = document.createElement('button'); openPrevious.type = 'button'; openPrevious.className = 'sm'; openPrevious.textContent = 'Открыть предыдущую строку';
          openPrevious.onclick = () => { const index = +related![1] - 1; finish(false); setPage('sync'); setLayer(mainLayerFor(index)); seekTo(previous.t); selectWord(index,0); centerOnSel(); requestAnimationFrame(() => document.getElementById('ln'+index)?.scrollIntoView({block:'nearest'})); }; buttons.append(openPrevious);
        }
        const open = document.createElement('button'); open.type = 'button'; open.className = 'sm'; open.textContent = 'Открыть строку в редакторе';
        open.onclick = () => { finish(false); setPage('sync'); setLayer(layer); seekTo(line.t); selectWord(issue.i,0); centerOnSel(); requestAnimationFrame(() => document.getElementById('ln'+issue.i)?.scrollIntoView({block:'nearest'})); }; buttons.append(open);
        item.append(buttons);
        list.append(item);
      }
    };
    dialog.addEventListener('keydown', e => e.stopPropagation());
    dialog.addEventListener('cancel', e => { e.preventDefault(); finish(false); });
    render(); document.body.append(dialog); dialog.showModal(); cancel.focus();
  }).finally(() => { pending = null; });
  return pending;
}
