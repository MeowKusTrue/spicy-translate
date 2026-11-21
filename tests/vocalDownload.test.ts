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

  it('diagnoses server loss without falsely asserting that a new stem exists', async () => {
    const request = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', request);
    const pending = downloadVocal('b'.repeat(64), 'htdemucs');
    const assertion = expect(pending).rejects.toThrow('Локальный сервер сейчас не отвечает');
    await vi.runAllTimersAsync();
    await assertion;
    await expect(pending).rejects.toThrow('Failed to fetch');
    expect(request).toHaveBeenCalledTimes(4); // three WAV attempts plus a lightweight server-health check
  });

  it('distinguishes a broken WAV response from a stopped local server', async () => {
    const request = vi.fn((url: string) => url === '/api/version'
      ? Promise.resolve({ ok: true })
      : Promise.reject(new TypeError('Failed to fetch')));
    vi.stubGlobal('fetch', request);
    const pending = downloadVocal('g'.repeat(64), 'kim-vocal-2');
    const assertion = expect(pending).rejects.toThrow('Локальный сервер отвечает, но ответ WAV обрывается');
    await vi.runAllTimersAsync();
    await assertion;
    expect(request).toHaveBeenCalledTimes(4);
    expect(request).toHaveBeenLastCalledWith('/api/version', { cache: 'no-store' });
  });

  it('preserves the legacy URL when restoring the default cached separator', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['voice']) });
    vi.stubGlobal('fetch', request);
    await expect(downloadVocal('c'.repeat(64))).resolves.toBeInstanceOf(Blob);
    expect(request).toHaveBeenCalledWith('/api/align/vocals?audioKey=' + 'c'.repeat(64), { cache: 'no-store' });
  });

  it('requests the generated stem after explicit separation instead of an imported override', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['voice']) });
    vi.stubGlobal('fetch', request);
    await downloadVocal('d'.repeat(64), 'kim-vocal-2', 'generated');
    expect(request).toHaveBeenCalledWith('/api/align/vocals?audioKey=' + 'd'.repeat(64) + '&sep=kim-vocal-2&operation=separate', { cache: 'no-store' });
  });

  it('shares one in-flight download between simultaneous consumers', async () => {
    let respond!: (value: { ok: boolean; blob: () => Promise<Blob> }) => void;
    const request = vi.fn().mockReturnValue(new Promise(resolve => { respond = resolve; }));
    vi.stubGlobal('fetch', request);
    const first = downloadVocal('e'.repeat(64), 'roformer');
    const second = downloadVocal('e'.repeat(64), 'roformer');
    expect(request).toHaveBeenCalledTimes(1);
    respond({ ok: true, blob: async () => new Blob(['voice']) });
    const blobs = await Promise.all([first, second]);
    expect(blobs[0].size).toBe(5); expect(blobs[1].size).toBe(5);
  });

  it('does not retry a missing cache entry as though the network failed', async () => {
    const request = vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: 'нет' }) });
    vi.stubGlobal('fetch', request);
    const pending = downloadVocal('f'.repeat(64), 'kim-vocal-2');
    const assertion = expect(pending).rejects.toThrow('HTTP 404');
    await vi.runAllTimersAsync();
    await assertion;
    expect(request).toHaveBeenCalledTimes(1);
  });
});
