/** Keep native process crashes distinct from the last harmless library warning. */
export function alignmentFailure(code: number | null, signal: string | null, stage: string, tail: string): string {
  const phase = ['locate','transcribe','backing'].includes(stage) ? 'распознавания Whisper' : stage === 'align' ? 'расстановки слов' : 'обработки аудио';
  if (code !== null && (code >>> 0) === 0xc0000005) return `Аварийный сбой Python/библиотеки во время ${phase} (Windows 0xC0000005). Результат не применён.`;
  if (signal) return `Процесс ${phase} завершён сигналом ${signal}. Результат не применён.`;
  const detail = tail.replace(/\x1b\[[0-9;]*m/g, '').trim().slice(-400);
  return code ? `align.py завершился с кодом ${code}${detail ? ': ' + detail : ''}` : 'Обработка завершилась без результата. Тайминги не изменены.';
}
