import { afterEach, expect, it, vi } from 'vitest';
import { importVideoEditorAsset } from './video-editor-import';
const mocks = vi.hoisted(() => ({ track: vi.fn(), audio: vi.fn(), dispose: vi.fn() }));
vi.mock('mediabunny', () => ({
  ALL_FORMATS: [],
  BlobSource: class {},
  Input: class { getPrimaryVideoTrack = mocks.track; getPrimaryAudioTrack = mocks.audio; dispose = mocks.dispose; },
}));
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
it('prepares video metadata with audio intact without decoding audio or generating thumbnails', async () => {
  URL.createObjectURL = vi.fn(() => 'blob:video'); URL.revokeObjectURL = vi.fn();
  const audioContext = vi.fn(); vi.stubGlobal('AudioContext', audioContext);
  mocks.track.mockResolvedValue({ computeDuration: async () => 20, displayWidth: 1920, displayHeight: 1080 });
  mocks.audio.mockResolvedValue({});
  const result = await importVideoEditorAsset(new File([''], 'clip.mp4'), { metadataOnly: true });
  expect(result.asset).toMatchObject({ durationSeconds: 20, width: 1920, height: 1080, hasAudio: true, waveform: [], thumbnailUrl: null });
  expect(audioContext).not.toHaveBeenCalled(); expect(mocks.dispose).toHaveBeenCalledOnce();
});
it('fails with the file name and releases resources when metadata never resolves', async () => {
  vi.useFakeTimers();
  URL.createObjectURL = vi.fn(() => 'blob:video'); URL.revokeObjectURL = vi.fn();
  mocks.track.mockImplementation(() => new Promise(() => {}));
  const pending = importVideoEditorAsset(new File([''], 'blocked.mp4'), { metadataOnly: true });
  const assertion = expect(pending).rejects.toThrow('Timeout lettura video: blocked.mp4');
  await vi.advanceTimersByTimeAsync(20001);
  await assertion;
  expect(mocks.dispose).toHaveBeenCalledOnce();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:video');
});
