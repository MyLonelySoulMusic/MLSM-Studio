import { describe, expect, it } from "vitest";
import { fitSongPlayerPreviewFrame } from "../services/song-player-preview-size";

describe("SongPlayerPreview sizing", () => {
  it.each([
    ["16:9" as const, 800, 450, 1600, 900],
    ["9:16" as const, 337.5, 600, 675, 1200],
    ["1:1" as const, 600, 600, 1200, 1200],
    ["4:5" as const, 480, 600, 960, 1200]
  ])("fits %s without changing its ratio and sizes the backing store for DPR", (ratio, cssWidth, cssHeight, pixelWidth, pixelHeight) => {
    expect(fitSongPlayerPreviewFrame(800, 600, ratio, 1, 1, 2)).toMatchObject({ cssWidth, cssHeight, pixelWidth, pixelHeight });
  });

  it("uses the persisted custom dimensions as the custom aspect authority", () => {
    const frame = fitSongPlayerPreviewFrame(800, 600, "custom", 1200, 800, 1.5);
    expect(frame).toMatchObject({ cssWidth: 800, pixelWidth: 1200, pixelHeight: 800, sourceWidth: 1200, sourceHeight: 800 });
    expect(frame.cssHeight).toBeCloseTo(533.333, 3);
  });
});
