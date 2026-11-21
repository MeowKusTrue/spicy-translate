import type { AlignOptions } from './core/autoAlign.ts';

export type VocalCacheMode = 'auto' | 'generated';
const flights = new Map<string, Promise<Blob>>();

async function connectionHint(): Promise<string> {
  try {
    const response = await fetch('/api/version', { cache: 'no-store' });
    return response.ok
      ? 'Локальный сервер отвечает, но ответ WAV обрывается.'
      : `Проверка локального сервера вернула HTTP ${response.status}.`;
  } catch {
    return 'Локальный сервер сейчас не отвечает.';
  }
}

async function requestVocal(url: string): Promise<Blob> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const reason = body.error ? `${body.error} (HTTP ${response.status})` : `HTTP ${response.status}`;
        // Missing/invalid cache entries cannot be fixed by downloading the same URL again.
        if (response.status < 500) throw Object.assign(new Error(reason), { final: true });
        throw new Error(reason);
      }
      return await response.blob();
    } catch (error) {
      lastError = error;
      if ((error as { final?: boolean })?.final) break;
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt === 1 ? 500 : 1500));
    }
  }
  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  if ((lastError as { final?: boolean })?.final) {
    throw new Error(`Сервер не отдал вокал: ${reason}. Проверь, что выбранная модель действительно завершила выделение.`);
  }
  const health = await connectionHint();
  throw new Error(`Редактор не получил WAV после 3 попыток: ${reason}. ${health} Восстанови связь и повтори подключение вокала; готовый кэш не будет обрабатываться заново.`);
}

/** One shared download per source: restore and an explicit workflow must not fetch/decode duplicate WAVs. */
export function downloadVocal(audioKey: string, sep?: AlignOptions['sep'], cache: VocalCacheMode = 'auto'): Promise<Blob> {
  const query = new URLSearchParams({ audioKey });
  if (sep) query.set('sep', sep);
  if (cache === 'generated') query.set('operation', 'separate');
  const url = '/api/align/vocals?' + query;
  const existing = flights.get(url);
  if (existing) return existing;
  const pending = requestVocal(url);
  flights.set(url, pending);
  const clear = () => { if (flights.get(url) === pending) flights.delete(url); };
  pending.then(clear, clear);
  return pending;
}
