import type { AlignOptions } from './core/autoAlign.ts';

/** The server has already committed the stem; a transient browser/network failure must not discard it. */
export async function downloadVocal(audioKey: string, sep?: AlignOptions['sep']): Promise<Blob> {
  const query = new URLSearchParams({ audioKey });
  if (sep) query.set('sep', sep);
  const url = '/api/align/vocals?' + query;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'HTTP ' + response.status);
      }
      return await response.blob();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 250));
    }
  }
  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Вокал сохранён на сервере, но редактор не смог скачать его после 3 попыток: ${reason}. Проверь связь с приложением и повтори операцию — готовый файл уже в серверном кэше.`);
}
