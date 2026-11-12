import { S } from '../state.ts';
import { DEVICES, STAGES, alignEta, alignPct, cancelAlign, stageFrac } from '../autoAlign.ts';

const mb = (bytes = 0) => (bytes / 1048576).toFixed(bytes > 1e8 ? 0 : 1);
export function AudioProgress({ location = 'timeline' }: { location?: 'audio' | 'timeline' }) {
  const a = S.align;
  if (!a) return null;
  const plan = a.plan?.length ? a.plan : ['demucs', 'karaoke', 'align'];
  const actual = plan.indexOf(a.stage), cur = actual >= 0 ? actual : plan.indexOf(a.phase || ''), fraction = stageFrac(), percent = alignPct();
  const eta = alignEta(), cancellable = a.stage !== 'import' && !a.cancelled;
  return <div className="alcard" id={location === 'audio' ? 'audioAlignCard' : 'alignCard'}>
    <div className="row" style={{ flexWrap: 'wrap' }}><b>{a.cancelled ? 'Отменяю обработку…' : plan.includes('transcribe') ? 'Получаю текст' : 'Обработка аудио'}</b><small>{a.device ? DEVICES[a.device] || a.device : ''}</small><span className="sp" />
      <b className="pct" title="Общий ход по этапам, приблизительно">{percent}%</b><small>{eta && 'ещё ' + eta}</small><button className="sm" id={location === 'audio' ? 'audioAlignCancel' : 'btnAlignCancel'} disabled={!cancellable} title={a.stage === 'import' ? 'Проверка загруженного файла: дождись завершения' : 'Остановить весь запуск'} onClick={cancelAlign}>{a.cancelled ? 'Отменяю…' : 'Отменить'}</button></div>
    <p role="status" aria-live="polite" style={{ margin: '6px 0' }}>{a.cancelled ? 'Следующий этап не будет запущен.' : STAGES[a.stage] || a.stage}{a.elapsed ? ` · прошло ${Math.floor(a.elapsed / 1000)} с` : ''}</p>
    <div className="track" role="progressbar" aria-label="Общий ход по этапам (приблизительно)" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><i style={{ width: percent + '%' }} /></div>
    <div className="stg">{plan.map((step, index) => <span key={step} className={index < cur ? 'ok' : index === cur ? 'on' : ''}>{index < cur ? '✓' : index === cur ? '⏳' : '○'} {STAGES[step] || step}{index === cur && (a.stage === 'align' && a.total ? ` ${a.done}/${a.total}` : fraction ? ` ${Math.round(fraction * 100)}%` : '')}</span>)}</div>
    {a.sub && <small className="sub">{a.bytes ? `скачиваю модель${!/^download/i.test(a.sub) ? ' ' + a.sub : ''} — ${mb(a.subDone)}${a.subTotal ? ' / ' + mb(a.subTotal) : ''} МБ (только в первый раз)` : a.sub}</small>}
    {a.stage === 'check' || a.stage === 'upload' || a.stage === 'cache' ? <small>Для этого этапа точный счётчик недоступен; остальные этапы обновляются по данным обработки.</small> : null}
  </div>;
}
