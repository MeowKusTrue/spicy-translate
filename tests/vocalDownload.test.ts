import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadVocal } from '../src/vocalDownload.ts';

beforeEach(() => { vi.useFakeTimers(); vi.unstubAllGlobals(); });
afterEach(() => { vi.useRealTimers(); });

describe('vocal download recovery', () => {
  it('retries a transient fetch failure and returns the committed vocal', async () => {
    const vocal = new Blob(['voice']);
    const request = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue({ ok: true, blob: async () => vocal });
    vi.stubGlobal('fetch', request);
    const pending = downloadVocal('a'.repeat(64), 'roformer');
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toBe(vocal);
    expect(request).toHaveBeenCalledTimes(3);
    expect(request).toHaveBeenLastCalledWith('/api/align/vocals?audioKey=' + 'a'.repeat(64) + '&sep=roformer', { cache: 'no-store' });
  });

  it('explains that processing is preserved when every download attempt fails', async () => {
    const request = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', request);
    const pending = downloadVocal('b'.repeat(64), 'htdemucs');
    const assertion = expect(pending).rejects.toThrow('Вокал сохранён на сервере');
    await vi.runAllTimersAsync();
    await assertion;
    await expect(pending).rejects.toThrow('Failed to fetch');
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('preserves the legacy URL when restoring the default cached separator', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['voice']) });
    vi.stubGlobal('fetch', request);
    await expect(downloadVocal('c'.repeat(64))).resolves.toBeInstanceOf(Blob);
    expect(request).toHaveBeenCalledWith('/api/align/vocals?audioKey=' + 'c'.repeat(64), { cache: 'no-store' });
  });
});
