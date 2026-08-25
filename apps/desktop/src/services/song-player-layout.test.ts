import { describe, expect, it } from "vitest";
import { formatSongPlayerTime, resolveSongPlayerLayout } from "./song-player-layout";
describe("song player layout", () => {
  it("keeps a deterministic cover/spectrogram layout for every supported ratio", () => {
    for (const ratio of ["9:16", "16:9", "1:1", "4:5"]) { const layout = resolveSongPlayerLayout(1080, 1920, ratio); expect(layout.cover.width).toBeGreaterThan(0); expect(layout.spectrogram.y + layout.spectrogram.height).toBeLessThanOrEqual(1920); }
  });
  it("formats timeline values", () => { expect(formatSongPlayerTime(65.2)).toBe("1:05"); });
});
