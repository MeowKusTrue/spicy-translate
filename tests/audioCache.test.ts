import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => {
  const storage = new Map<string, string>();
  return {
    state: { audioBlob: null as Blob | null, meta: { title: 'Track', artist: 'Artist' } },
    session: { generation: 0 }, storage,
    get: vi.fn(), put: vi.fn(), voice: vi.fn(), peaks: vi.fn(), warning: vi.fn(),
  };
});
vi.mock('../src/state.ts', () => ({ S: mock.state, ls: { get: (key: string) => mock.storage.get(key) ?? null, set: (key: string, value: string) => { mock.storage.set(key, value); return true; } }, toast: mock.warning, status: vi.fn() }));
vi.mock('../src/persist.ts', () => ({ idbGet: mock.get, idbPutAudioRecords: mock.put, trackKey: () => mock.state.meta.artist + ' - ' + mock.state.meta.title }));
vi.mock('../src/audio.ts', () => ({ cacheVoiceAudio: mock.voice }));
vi.mock('../src/waveform/wave.ts', () => ({ buildVoicePeaks: mock.peaks, drawWave: vi.fn() }));
vi.mock('../src/projectSession.ts', () => ({ session: mock.session }));
import { clearLastOriginalReference, lastOriginalReference, originalAudioKey, persistOriginalAudio, persistVoiceAudio, readLastOriginal, restoreCachedVoice, syncOriginalReference } from '../src/audioCache.ts';

beforeEach(() => {
  vi.clearAllMocks(); vi.unstubAllGlobals(); mock.storage.clear();
  mock.state.audioBlob = null; mock.state.meta = { title: 'Track', artist: 'Artist' }; mock.session.generation = 0;
  mock.get.mockResolvedValue(null); mock.put.mockResolvedValue(true); mock.peaks.mockResolvedValue(true);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
});
describe('content-addressed durable audio', () => {
  it('hashes actual original bytes, independent of title/name, and writes originals+stems atomically', async () => {
    const original = new Blob(['abc']), vocal = new Blob(['voice']); mock.state.audioBlob = original;
    const key = await originalAudioKey(original);
    expect(key).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await originalAudioKey(new Blob(['different']))).not.toBe(key);
    expect(await persistVoiceAudio(original, vocal)).toBe(true);
    expect(mock.put).toHaveBeenCalledWith([['content:original:' + key, original], ['content:voice:' + key, vocal]]);
  });
  it('reports quota/transaction failures and oversized files without claiming durable success', async () => {
    const original = new Blob(['original']); mock.state.audioBlob = original; mock.put.mockResolvedValue(false);
    clearLastOriginalReference(true);
    expect(await persistOriginalAudio(original)).toBe(false);
    expect(await persistVoiceAudio(original, new Blob(['voice']))).toBe(false);
    expect(JSON.parse(lastOriginalReference()!).key).toBeNull();
    expect(mock.warning).toHaveBeenCalled();
    mock.put.mockClear();
    const huge = { size: 120e6 + 1 } as Blob; mock.state.audioBlob = huge;
    expect(await persistOriginalAudio(huge)).toBe(false);
    expect(await persistVoiceAudio(huge, original)).toBe(false);
    expect(mock.put).not.toHaveBeenCalled();
  });
  it('binds only a successfully committed current original, including audio-only projects', async () => {
    const original = new Blob(['original']); mock.state.audioBlob = original;
    expect(await persistOriginalAudio(original)).toBe(true);
    const reference = lastOriginalReference(); mock.get.mockResolvedValue(original);
    expect(await readLastOriginal(reference)).toBe(original);
    mock.state.meta.title = 'Different project'; expect(await readLastOriginal(reference)).toBeNull();
    clearLastOriginalReference(true); expect(await readLastOriginal(lastOriginalReference())).toBeNull();
  });
  it('keeps a committed original through metadata edits, but never revives a cleared reference', async () => {
    const original = new Blob(['original']); mock.state.audioBlob = original; await persistOriginalAudio(original);
    mock.state.meta.title = 'Renamed'; expect(syncOriginalReference()).toBe(true);
    mock.get.mockResolvedValue(original); expect(await readLastOriginal(lastOriginalReference())).toBe(original);
    clearLastOriginalReference(true); syncOriginalReference();
    expect(await readLastOriginal(lastOriginalReference())).toBeNull();
  });
  it('does not publish a session reference when the project changes during the commit', async () => {
    const original = new Blob(['original']); mock.state.audioBlob = original;
    mock.put.mockImplementation(async () => { mock.session.generation++; return true; });
    expect(await persistOriginalAudio(original)).toBe(false); expect(lastOriginalReference()).toBeNull();
  });
  it('restores only the original hash and never starts playback', async () => {
    const original = new Blob(['original']), voice = new Blob(['voice']); mock.state.audioBlob = original;
    mock.get.mockResolvedValue(voice);
    expect(await restoreCachedVoice(original)).toBe(true);
    expect(mock.get).toHaveBeenCalledWith('content:voice:' + await originalAudioKey(original));
    expect(mock.voice).toHaveBeenCalledWith(voice); expect(fetch).not.toHaveBeenCalled();
  });
  it('drops a voice result when the original or project changes during decoding', async () => {
    const original = new Blob(['original']); mock.state.audioBlob = original; mock.get.mockResolvedValue(new Blob(['voice']));
    mock.peaks.mockImplementation(async () => { mock.state.audioBlob = new Blob(['replacement']); return true; });
    expect(await restoreCachedVoice(original)).toBe(false); expect(mock.voice).not.toHaveBeenCalled();
  });
  it('uses a hash-qualified server fallback, persists it, and still checks project identity', async () => {
    const original = new Blob(['original']), voice = new Blob(['voice']); mock.state.audioBlob = original;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => voice }));
    expect(await restoreCachedVoice(original)).toBe(true);
    expect(fetch).toHaveBeenCalledWith('/api/align/vocals?audioKey=' + await originalAudioKey(original));
    expect(mock.put).toHaveBeenCalledTimes(1); expect(mock.voice).toHaveBeenCalledWith(voice);
  });
});
