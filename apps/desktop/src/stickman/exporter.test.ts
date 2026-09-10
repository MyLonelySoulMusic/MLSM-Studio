import { afterEach, describe, expect, it, vi } from "vitest";
import { exportBivioVideo } from "./exporter";
import { defaultBivioSettings } from "./settings";
import { exportOfflineSceneVideo } from "../services/offline-video-exporter";
import { renderBivioFrame } from "./renderer";

vi.mock("./renderer", () => ({ ensureBivioFont: vi.fn().mockResolvedValue(undefined), renderBivioFrame: vi.fn() }));
vi.mock("../services/offline-video-exporter", () => ({ exportOfflineSceneVideo: vi.fn().mockResolvedValue({ fileName: "bivio.mp4", audioPacketCount: 8, encodedFrameCount: 242 }) }));
afterEach(() => vi.clearAllMocks());

describe("Bivio export", () => {
  it("exports the entire audio duration, using the same deterministic renderer and no decorative overlays", async () => {
    const signal = new AbortController().signal;
    await exportBivioVideo({ sourceUrl: "blob:song", durationSeconds: 8.04, settings: defaultBivioSettings, resolution: 1080, fps: 30 }, signal, vi.fn());
    const [options, renderer] = vi.mocked(exportOfflineSceneVideo).mock.calls[0]!;
    expect(options).toMatchObject({ sourceUrl: "blob:song", sourceDuration: 8.04, durationSeconds: 8.04, width: 1080, height: 1920, fps: 30, aspectRatio: "9:16", background: { effects: { glow: false, particles: false, vignette: false } }, ball: { endRevealEnabled: false } });
    renderer.setExportSize(1080, 1920); renderer.renderNow(8.04);
    expect(renderBivioFrame).toHaveBeenCalledWith(renderer.canvas, { timeSeconds: 8.04, durationSeconds: 8.04, settings: defaultBivioSettings });
    renderer.restorePreviewSize(); expect(renderer.canvas.width * renderer.canvas.height).toBe(1);
  });

  it("rejects missing audio, unsafe dimensions and cancelled jobs before encoding", async () => {
    const settings = { sourceUrl: "blob:song", durationSeconds: 0, settings: defaultBivioSettings, resolution: 720 as const, fps: 24 as const };
    await expect(exportBivioVideo(settings, new AbortController().signal, vi.fn())).rejects.toThrow("audio valido");
    const controller = new AbortController(); controller.abort();
    await expect(exportBivioVideo({ ...settings, durationSeconds: 8 }, controller.signal, vi.fn())).rejects.toMatchObject({ name: "AbortError" });
    expect(exportOfflineSceneVideo).not.toHaveBeenCalled();
  });
});
