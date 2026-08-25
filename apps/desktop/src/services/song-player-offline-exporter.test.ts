import { beforeEach, describe, expect, it, vi } from "vitest";
const { exportScene } = vi.hoisted(() => ({ exportScene: vi.fn() }));
vi.mock("./offline-video-exporter", async (importOriginal) => ({ ...await importOriginal<typeof import("./offline-video-exporter")>(), exportOfflineSceneVideo: exportScene }));
import { exportSongPlayerOfflineVideo, songPlayerFragmentAudioSource, songPlayerOfflineFrameCount } from "./song-player-offline-exporter";
describe("song player exporter", () => {
  beforeEach(() => exportScene.mockReset().mockResolvedValue({ fileName: "song-player.mp4", width: 1080, height: 1920, fps: 30, encodedFrameCount: 600, audioPacketCount: 10 }));
  it("uses deterministic ceil frame count", () => { expect(songPlayerOfflineFrameCount(1.01, 30)).toBe(31); });
  it("uses fragment audio as the mux source", () => { expect(songPlayerFragmentAudioSource({ fragmentAudioUrl: "blob:fragment" })).toBe("blob:fragment"); });
  it("uses the shared playback range as the sole export duration authority", async () => { const renderer = { canvas: document.createElement("canvas"), setExportSize: vi.fn(), restorePreviewSize: vi.fn(), renderNow: vi.fn(), prepare: vi.fn().mockResolvedValue(undefined) }; const playbackRange = { startSeconds: 12, endSeconds: 32, durationSeconds: 20 }; const result = await exportSongPlayerOfflineVideo({ width: 1080, height: 1920, fps: 30, playbackRange, fragmentAudioUrl: "blob:fragment", aspectRatio: "9:16", projectName: "test", quality: "high", renderer }, new AbortController().signal); expect(exportScene).toHaveBeenCalledWith(expect.objectContaining({ durationSeconds: 20, sourceDuration: 20, sourceUrl: "blob:fragment" }), renderer, expect.any(Function), expect.any(AbortSignal), expect.any(Function)); expect(result.audioSource).toEqual({ sourceUrl: "blob:fragment", durationSeconds: 20 }); });
});
